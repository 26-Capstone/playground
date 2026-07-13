const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { WebSocketServer } = require("ws");
const { chromium } = require("playwright");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { runScraper } = require("./scraper");
const { browserSemaphore } = require("./browserLimiter");
const { extractDisplayText } = require("./extractText");
const { VIEWPORT } = require("./viewport");

const PORT = process.env.PORT || 3001;
const SPRING_URL =
  process.env.SPRING_SERVICE_URL || "http://spring-server:8080";
const SNAPSHOTS_DIR = path.join(__dirname, "snapshots");

const app = express();

// 프록시를 express.json() 보다 먼저 등록 — body stream을 consume하기 전에 Spring으로 전달
app.use(
  ["/api", "/fetch-html", "/heal"],
  createProxyMiddleware({
    target: SPRING_URL,
    changeOrigin: true,
  }),
);

app.use(express.json({ limit: "10mb" }));

// 프론트엔드 정적 파일 서빙
const clientDir = path.join(__dirname, "client");
app.use(express.static(clientDir));
app.get("/", (req, res) => res.sendFile(path.join(clientDir, "index.html")));

// ─── Internal API (Spring Boot 전용) ─────────────────────────────────────────

// Spring이 스크래퍼 정보를 body에 담아 호출 → Playwright 실행 결과 반환
app.post("/internal/run", async (req, res) => {
  const { id, name, url, css_selector, user_intent, extra_fields } = req.body;
  if (!id || !url || !css_selector) {
    return res
      .status(400)
      .json({ error: "id, url, css_selector 필드가 필요합니다." });
  }
  try {
    const result = await runScraper({
      id,
      name,
      url,
      css_selector,
      user_intent,
      extra_fields,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Spring이 heal 요청 전 v1_html을 조회할 때 사용
app.get("/internal/snapshot/:id", (req, res) => {
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${req.params.id}_v1.html`);
  if (!fs.existsSync(snapshotPath)) {
    return res.status(404).json({ error: "V1 스냅샷 없음" });
  }
  res.json({ html: fs.readFileSync(snapshotPath, "utf-8") });
});

// 셀렉터 변경 시 Spring이 기존 V1 스냅샷 삭제 요청
app.delete("/internal/snapshot/:id", (req, res) => {
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${req.params.id}_v1.html`);
  if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
  res.json({ ok: true });
});

// 셀렉터 지정 UI에서 현재 페이지 HTML 수집
app.post("/internal/fetch-html", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "url 필드가 필요합니다." });
  await browserSemaphore.acquire(); // 동시 Chromium 실행 수 제한 (OOM 방지)
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORT }); // 피커/스크래퍼와 동일 뷰포트
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    // domcontentloaded는 CSR 앱에서 실제 데이터가 렌더링되기 전에 끝난다 — 자가치유가
    // 이 HTML(V2)을 후보 요소 없는 빈 뼈대로 받으면 ML 모델에 0개 샘플이 들어가 터진다.
    // 본문에 어느 정도 텍스트가 쌓일 때까지 짧게 더 기다린다(실패해도 있는 그대로 진행).
    await page
      .waitForFunction(() => document.body && document.body.innerText.trim().length > 200, {
        timeout: 10000,
      })
      .catch(() => {});
    const html = await page.content();
    res.json({ html });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await browser.close();
    browserSemaphore.release();
  }
});

// ─── WebSocket (원격 브라우저 스트리밍) ──────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 960x600 + quality 55 — 원래 1280x800/quality 80이었는데 EC2 인스턴스가 작아서
// (RAM 2GB) 프레임 인코딩이 병목이 되어 커서/화면이 느리게 느껴지는 문제 개선용.
// 클라이언트(screens.jsx)의 REMOTE_W/REMOTE_H와 반드시 같이 맞춰야 함.
// scraper.js도 이 값을 그대로 가져다 쓴다 — 피커와 실제 스크래퍼가 다른 뷰포트를 쓰면
// 반응형 페이지에서 서로 다른 DOM을 보게 돼서 피커로 고른 셀렉터가 실제 실행 시
// "요소를 찾을 수 없음"으로 깨지는 원인이 된다.
const SCREENCAST_QUALITY = 55;

const GET_SELECTOR_FN = `
(function({ x, y }) {
  const el = document.elementFromPoint(x, y);
  if (!el || el.id === '__doma_hl__') return null;

  const BLOCKED_TAGS = new Set(['img','picture','video','audio','canvas','svg','iframe','object','embed','script','style','meta','link','noscript','br','hr','wbr','source','track','col','colgroup','head','base','template']);
  const tagName = el.tagName.toLowerCase();
  if (BLOCKED_TAGS.has(tagName)) return { blocked: true, tag: tagName, reason: '<' + tagName + '> 요소는 추출할 수 없습니다' };
  if (tagName === 'input') {
    const t = (el.type || '').toLowerCase();
    if (['image','file','color','range','submit','button','reset','checkbox','radio'].includes(t))
      return { blocked: true, tag: 'input[type=' + t + ']', reason: '이 input 유형에서는 텍스트를 추출할 수 없습니다' };
  }

  function isHashClass(c) {
    if (!c) return false;
    // 하이픈이 있다고 무조건 "안정적인 클래스"로 취급하지 않는다 — Tailwind 같은
    // 유틸리티 클래스(flex-col, text-gray-500)도 하이픈을 쓰지만, 토스처럼 CSS-in-JS가
    // 찍어내는 해시 클래스(tw69-y90cyth, tw3w-1qmwwzma)도 하이픈이 낀 형태라
    // 예전 로직(하이픈 있으면 바로 통과)으로는 전혀 걸러지지 않았다. 모음 비율 체크를
    // 하이픈 유무와 무관하게 항상 적용한다.
    const letters = c.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 3) return false;
    const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
    return vowels / letters.length < 0.25;
  }

  function stableAttr(el) {
    for (const attr of ['data-testid','data-test','data-id','data-name','aria-label','name']) {
      if (el.hasAttribute(attr)) {
        const v = el.getAttribute(attr);
        return '[' + attr + '=' + JSON.stringify(v) + ']';
      }
    }
    return '';
  }

  function buildSelector(el, debugTrace) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.tagName && cur !== document.documentElement) {
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      let s = cur.tagName.toLowerCase();
      const attr = stableAttr(cur);
      if (attr) {
        s += attr;
      } else {
        const cls = Array.from(cur.classList)
          .filter(c => c !== '__doma_hl__' && !isHashClass(c))
          .slice(0, 2)
          .map(c => '.' + CSS.escape(c))
          .join('');
        s += cls;
      }
      const sameTagSibs = Array.from(cur.parentElement?.children || [])
        .filter(n => n.tagName === cur.tagName);
      if (sameTagSibs.length > 1)
        s += ':nth-of-type(' + (sameTagSibs.indexOf(cur) + 1) + ')';
      parts.unshift(s);
      let count = -1;
      try {
        count = document.querySelectorAll(parts.join(' > ')).length;
      } catch(e) {}
      if (debugTrace) debugTrace.push({ chain: parts.join(' > '), count });
      if (count === 1) break;
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  ${extractDisplayText.toString()}

  // 진단용: buildSelector가 "유일하다"고 판단해서 멈춘 시점과, 그 직후(수십~수백ms 뒤)
  // 다시 매칭해봤을 때가 다른지 확인한다 — 실시간으로 계속 리렌더링되는 페이지(토스 등)에서
  // "고를 땐 유일했는데 방금 테스트하면 못 찾는다"는 증상의 원인이 여기 있는지 보기 위함.
  const debugTrace = [];
  const selector = buildSelector(el, debugTrace);
  const recheckCount = (() => {
    try { return document.querySelectorAll(selector).length; } catch (e) { return -1; }
  })();
  const recheckMatchesEl = (() => {
    try { return document.querySelector(selector) === el; } catch (e) { return false; }
  })();

  return {
    selector,
    text: extractDisplayText(el).slice(0, 120),
    tag: el.tagName.toLowerCase(),
    debug: { trace: debugTrace, recheckCount, recheckMatchesEl },
  };
})
`;

const OVERLAY_SCRIPT = `
(function() {
  if (document.getElementById('__doma_hl__')) return;
  const ov = document.createElement('div');
  ov.id = '__doma_hl__';
  ov.style.cssText = [
    'position:fixed', 'pointer-events:none', 'z-index:2147483647',
    'outline:2px solid #3182F6', 'background:rgba(49,130,246,0.10)',
    'box-shadow:0 0 0 4px rgba(49,130,246,0.15)', 'border-radius:3px',
    'transition:left 60ms,top 60ms,width 60ms,height 60ms', 'display:none'
  ].join(';');
  document.body.appendChild(ov);

  const BLOCKED_OV = new Set(['img','picture','video','audio','canvas','svg','iframe','object','embed','script','style','meta','link','noscript','br','hr','source','track']);
  document.addEventListener('mousemove', function(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.id === '__doma_hl__') { ov.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const isBlocked = BLOCKED_OV.has(tag) || (tag === 'input' && ['image','file','color','range','submit','button','reset','checkbox','radio'].includes((el.type||'').toLowerCase()));
    ov.style.display    = 'block';
    ov.style.left       = r.left   + 'px';
    ov.style.top        = r.top    + 'px';
    ov.style.width      = r.width  + 'px';
    ov.style.height     = r.height + 'px';
    ov.style.outline    = isBlocked ? '2px solid #E04A4A' : '2px solid #3182F6';
    ov.style.background = isBlocked ? 'rgba(224,74,74,0.10)' : 'rgba(49,130,246,0.10)';
    ov.style.boxShadow  = isBlocked ? '0 0 0 4px rgba(224,74,74,0.15)' : '0 0 0 4px rgba(49,130,246,0.15)';
  });
})();
`;

wss.on("connection", (ws) => {
  let browser = null;
  let page = null;
  let cdp = null;
  let ready = false;
  let lastMoveAt = 0;
  let semaphoreReleased = false;
  let pendingMove = null;
  let moveInFlight = false;

  // 토스증권처럼 실시간으로 계속 리렌더링되는 무거운 페이지는 page.mouse.move() 한 번의
  // CDP 왕복이 45ms 스로틀 간격보다 오래 걸릴 수 있다 — await로 순서대로 처리하면 뒤에
  // 밀린 좌표들이 큐에 쌓여서, 사용자가 커서를 멈춰도 한참 동안 "밀린 경로"를 따라가는
  // 것처럼 보인다. 최신 좌표 하나만 남기고 나머지는 버려서(coalescing) 항상 "지금 커서
  // 위치"만 쫓아가게 한다.
  const flushMove = async () => {
    if (moveInFlight || !pendingMove) return;
    const { x, y } = pendingMove;
    pendingMove = null;
    moveInFlight = true;
    try {
      await page?.mouse.move(x, y);
    } catch (e) {
      // 페이지 네비게이션 중 등 일시적 실패는 무시 — 다음 좌표가 곧 다시 온다
    } finally {
      moveInFlight = false;
      if (pendingMove) flushMove();
    }
  };

  // 세마포어는 정확히 한 번만 release — close 핸들러와 에러 경로가 둘 다 탈 수 있어서 가드 필요
  const releaseSemaphore = () => {
    if (semaphoreReleased) return;
    semaphoreReleased = true;
    browserSemaphore.release();
  };

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  (async () => {
    try {
      await browserSemaphore.acquire(); // 동시 Chromium 실행 수 제한 (OOM 방지)
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        viewport: VIEWPORT,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      });
      page = await ctx.newPage();
      cdp = await ctx.newCDPSession(page);

      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: SCREENCAST_QUALITY,
        maxWidth: VIEWPORT.width,
        maxHeight: VIEWPORT.height,
      });

      cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
        send({ type: "frame", data });
        await cdp
          .send("Page.screencastFrameAck", { sessionId })
          .catch(() => {});
      });

      send({ type: "status", status: "connected" });
    } catch (err) {
      send({ type: "error", message: err.message });
      await browser?.close().catch(() => {});
      releaseSemaphore();
      ws.close();
    }
  })();

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (!page) return;

      if (msg.type === "navigate") {
        ready = false;
        send({ type: "status", status: "navigating" });
        await page.goto(msg.url, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await page.evaluate(OVERLAY_SCRIPT).catch(() => {});
        const nodeCount = await page
          .evaluate(() => document.querySelectorAll("*").length)
          .catch(() => 0);
        ready = true;
        send({ type: "status", status: "ready", nodeCount });
      }

      if (msg.type === "mousemove" && ready) {
        const now = Date.now();
        if (now - lastMoveAt < 45) return;
        lastMoveAt = now;
        pendingMove = { x: msg.x, y: msg.y };
        flushMove();
      }

      if (msg.type === "click" && ready) {
        const result = await page.evaluate(
          new Function("args", `return (${GET_SELECTOR_FN})(args)`),
          { x: msg.x, y: msg.y },
        );
        if (result && result.blocked) {
          send({ type: "blocked", tag: result.tag, reason: result.reason });
        } else if (result) {
          if (result.debug) {
            console.log(
              `[picker-debug] selector="${result.selector}" recheckCount=${result.debug.recheckCount} recheckMatchesEl=${result.debug.recheckMatchesEl}\n` +
                result.debug.trace
                  .map((t, i) => `  [${i}] count=${t.count}  ${t.chain}`)
                  .join("\n"),
            );
          }
          send({ type: "selector", ...result });
        } else {
          send({ type: "blocked", reason: "이 위치에서 요소를 찾지 못했습니다" });
        }
      }

      if (msg.type === "test_selector" && ready) {
        try {
          const result = await page.evaluate(
            new Function(
              "sel",
              `
              ${extractDisplayText.toString()}
              try {
                const el = document.querySelector(sel);
                if (!el) return { found: false };
                return { found: true, text: extractDisplayText(el).slice(0, 120) };
              } catch (e) {
                return { found: false, error: e.message };
              }
              `,
            ),
            msg.selector,
          );
          send({ type: "test_result", ...result });
        } catch (e) {
          send({ type: "test_result", found: false, error: e.message });
        }
      }

      if (msg.type === "scroll" && ready) {
        await page.mouse.wheel(0, msg.dy);
      }

      if (msg.type === "keypress" && ready) {
        await page.keyboard.press(msg.key);
      }

      if (msg.type === "remove_overlays" && ready) {
        const removed = await page.evaluate(() => {
          const isOverlay = (el) => {
            const s = getComputedStyle(el);
            const pos = s.position;
            if (pos !== "fixed" && pos !== "sticky" && pos !== "absolute")
              return false;
            const z = parseInt(s.zIndex, 10);
            if (isNaN(z) || z < 10) return false;
            const r = el.getBoundingClientRect();
            return r.width > 80 && r.height > 80;
          };
          let count = 0;
          document
            .querySelectorAll(
              '[role="dialog"],[role="alertdialog"],[aria-modal="true"]',
            )
            .forEach((el) => {
              el.remove();
              count++;
            });
          [...document.querySelectorAll("*")]
            .filter(isOverlay)
            .forEach((el) => {
              el.remove();
              count++;
            });
          document
            .querySelectorAll(
              [
                ".modal,.modal-backdrop,.overlay,.popup,.popup-overlay",
                ".dialog,.cookie-banner,.cookie-notice,.gdpr-banner",
                '[class*="modal"],[class*="popup"],[class*="overlay"],[class*="cookie"]',
              ].join(","),
            )
            .forEach((el) => {
              el.remove();
              count++;
            });
          document.body.style.overflow = "";
          document.documentElement.style.overflow = "";
          return count;
        });
        send({ type: "overlays_removed", count: removed });
      }

      if (msg.type === "remove_element" && ready) {
        await page.evaluate(
          ({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            if (el && el !== document.body && el !== document.documentElement)
              el.remove();
          },
          { x: msg.x, y: msg.y },
        );
      }
    } catch (err) {
      send({ type: "error", message: err.message });
      await browser?.close().catch(() => {});
      releaseSemaphore();
      ws.close();
    }
  });

  ws.on("close", async () => {
    await browser?.close().catch(() => {});
    releaseSemaphore();
  });
});

server.listen(PORT, () => {
  console.log(`DOMA Scraper Service → http://localhost:${PORT}`);
});
