const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { WebSocketServer } = require("ws");
const { chromium } = require("playwright");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { runScraper } = require("./scraper");
const { browserSemaphore } = require("./browserLimiter");

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
app.get("/", (req, res) => res.sendFile(path.join(clientDir, "DOMA.html")));

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
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
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
const VIEWPORT = { width: 960, height: 600 };
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
    if (!c || c.includes('-')) return false;
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

  function buildSelector(el) {
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
      try {
        if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
      } catch(e) {}
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  return {
    selector: buildSelector(el),
    text: (el.textContent || '').trim().slice(0, 120),
    tag: el.tagName.toLowerCase(),
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
      releaseSemaphore();
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
        await page.mouse.move(msg.x, msg.y);
      }

      if (msg.type === "click" && ready) {
        const result = await page.evaluate(
          new Function("args", `return (${GET_SELECTOR_FN})(args)`),
          { x: msg.x, y: msg.y },
        );
        if (result && result.blocked) {
          send({ type: "blocked", tag: result.tag, reason: result.reason });
        } else if (result) {
          send({ type: "selector", ...result });
        }
      }

      if (msg.type === "test_selector" && ready) {
        try {
          const result = await page.evaluate((sel) => {
            try {
              const el = document.querySelector(sel);
              if (!el) return { found: false };
              return {
                found: true,
                text: (el.textContent || "")
                  .trim()
                  .replace(/\s+/g, " ")
                  .slice(0, 120),
              };
            } catch (e) {
              return { found: false, error: e.message };
            }
          }, msg.selector);
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
