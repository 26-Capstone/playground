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

// Register the proxy before express.json() — forward to Spring before the body stream is consumed
app.use(
  ["/api", "/fetch-html", "/heal"],
  createProxyMiddleware({
    target: SPRING_URL,
    changeOrigin: true,
  }),
);

app.use(express.json({ limit: "10mb" }));

// Serve frontend static files
const clientDir = path.join(__dirname, "client");
app.use(express.static(clientDir));
app.get("/", (req, res) => res.sendFile(path.join(clientDir, "index.html")));

// ─── Internal API (Spring Boot only) ─────────────────────────────────────────

// Spring calls this with scraper info in the body → returns the Playwright run result
app.post("/internal/run", async (req, res) => {
  const { id, name, url, css_selector, user_intent, extra_fields } = req.body;
  if (!id || !url || !css_selector) {
    return res
      .status(400)
      .json({ error: "id, url, css_selector fields are required." });
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

// Used by Spring to look up v1_html before a heal request
app.get("/internal/snapshot/:id", (req, res) => {
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${req.params.id}_v1.html`);
  if (!fs.existsSync(snapshotPath)) {
    return res.status(404).json({ error: "V1 snapshot not found" });
  }
  res.json({ html: fs.readFileSync(snapshotPath, "utf-8") });
});

// Spring requests deletion of the existing V1 snapshot when the selector changes
app.delete("/internal/snapshot/:id", (req, res) => {
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${req.params.id}_v1.html`);
  if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
  res.json({ ok: true });
});

// Collects the current page HTML for the selector-picking UI
app.post("/internal/fetch-html", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "url field is required." });
  await browserSemaphore.acquire(); // Limit concurrent Chromium instances (avoid OOM)
  let browser;
  try {
    // If launch were outside the try block, a failure would skip finally and
    // leak the semaphore permit permanently (with MAX_CONCURRENT_BROWSERS=2,
    // just 2 failures would make every subsequent run wait forever).
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: VIEWPORT }); // Same viewport as the picker/scraper
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    // domcontentloaded fires before real data has rendered in a CSR app — if
    // self-heal receives this HTML (V2) as an empty skeleton (just nav/header/
    // footer, no real content), the ML candidates end up either zero or all
    // irrelevant elements, causing it to mistake something wrong (e.g. a menu
    // tab link) for the answer.
    // networkidle never fires on sites that keep running ads/analytics
    // scripts (e.g. Musinsa), so it just burns the timeout (measured: still
    // not idle after waiting the full 10s). Instead, we wait until the body
    // text length "stops changing significantly" — small fluctuations from
    // things like live counters (measured around ±30 chars) are tolerated,
    // while only a large jump during initial load (e.g. 107 chars → 3347
    // chars) is treated as the stabilization signal. Confirmed this
    // stabilizes in about 4.3s on the actual Musinsa ranking page.
    await page.evaluate(
      (maxWaitMs) =>
        new Promise((resolve) => {
          const start = Date.now();
          let lastLen = -1;
          let stableCount = 0;
          const check = () => {
            const len = document.body.innerText.trim().length;
            const closeEnough = lastLen >= 0 && Math.abs(len - lastLen) < 100;
            stableCount = closeEnough ? stableCount + 1 : 0;
            lastLen = len;
            if ((stableCount >= 2 && len > 50) || Date.now() - start > maxWaitMs) {
              resolve();
            } else {
              setTimeout(check, 500);
            }
          };
          check();
        }),
      15000,
    );
    const html = await page.content();
    res.json({ html });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await browser?.close().catch(() => {});
    browserSemaphore.release();
  }
});

// ─── WebSocket (remote browser streaming) ──────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 960x600 + quality 55 — originally 1280x800/quality 80, but the small EC2
// instance (2GB RAM) made frame encoding a bottleneck, making the cursor/
// screen feel laggy; these values fix that.
// Must always be kept in sync with REMOTE_W/REMOTE_H in the client (screens.jsx).
// scraper.js also reuses this value directly — if the picker and the actual
// scraper used different viewports, they'd see different DOMs on responsive
// pages, causing selectors chosen in the picker to break with "element not
// found" during the actual run.
const SCREENCAST_QUALITY = 55;

const GET_SELECTOR_FN = `
(function({ x, y }) {
  const el = document.elementFromPoint(x, y);
  if (!el || el.id === '__doma_hl__') return null;

  const BLOCKED_TAGS = new Set(['img','picture','video','audio','canvas','svg','iframe','object','embed','script','style','meta','link','noscript','br','hr','wbr','source','track','col','colgroup','head','base','template']);
  const tagName = el.tagName.toLowerCase();
  if (BLOCKED_TAGS.has(tagName)) return { blocked: true, tag: tagName, reason: 'Cannot extract from <' + tagName + '> elements' };
  if (tagName === 'input') {
    const t = (el.type || '').toLowerCase();
    if (['image','file','color','range','submit','button','reset','checkbox','radio'].includes(t))
      return { blocked: true, tag: 'input[type=' + t + ']', reason: 'Cannot extract text from this input type' };
  }

  function isHashClass(c) {
    if (!c) return false;
    // Having a hyphen doesn't automatically make a class "stable" — utility
    // classes like Tailwind's (flex-col, text-gray-500) use hyphens too, but
    // so do hashed classes generated by CSS-in-JS libraries like Toss's
    // (tw69-y90cyth, tw3w-1qmwwzma), which also contain hyphens. The old
    // logic (pass immediately if a hyphen is present) didn't filter these out
    // at all. The vowel-ratio check is now always applied regardless of
    // whether a hyphen is present.
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

  // For diagnostics: checks whether the moment buildSelector decides a
  // selector is "unique" and stops differs from a re-match performed right
  // after (tens to hundreds of ms later) — meant to reveal whether this is
  // the cause of the symptom where pages that keep re-rendering live (e.g.
  // Toss) show "it was unique when picked, but can't be found when tested
  // right after."
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

  // On heavy pages that keep re-rendering live, like Toss Securities, a
  // single page.mouse.move() CDP round trip can take longer than the 45ms
  // throttle interval — if handled sequentially with await, backlogged
  // coordinates pile up in the queue, so even after the user stops moving
  // the cursor, it keeps visibly following the "backlogged path" for a
  // while. We keep only the latest coordinate and drop the rest
  // (coalescing) so the cursor always tracks the "current position" only.
  const flushMove = async () => {
    if (moveInFlight || !pendingMove) return;
    const { x, y } = pendingMove;
    pendingMove = null;
    moveInFlight = true;
    try {
      await page?.mouse.move(x, y);
    } catch (e) {
      // Ignore transient failures, e.g. during page navigation — the next coordinate will arrive shortly
    } finally {
      moveInFlight = false;
      if (pendingMove) flushMove();
    }
  };

  // The semaphore must be released exactly once — both the close handler and
  // the error path can trigger it, so a guard is needed
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
      await browserSemaphore.acquire(); // Limit concurrent Chromium instances (avoid OOM)
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
          send({ type: "blocked", reason: "No element found at this position" });
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
