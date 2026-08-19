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

// On a page that keeps re-rendering (ad rotation, carousels, live counters —
// e.g. Musinsa's ranking page), an unthrottled screencast pushes a new frame
// almost continuously, and each one round-trips over the same CDP connection
// as every other command (mouse moves, scroll, test_selector's evaluate).
// A flood of frame events + ACKs can starve those other commands long enough
// that test_selector's page.evaluate() misses its own timeout entirely, not
// just occasionally but on every attempt on a busy-enough page. Only sending
// every Nth frame trades a bit of stream smoothness for keeping the CDP
// connection responsive to everything else sharing it.
const SCREENCAST_EVERY_NTH_FRAME = 3;

// Off by default — every click during picking logs a multi-line selector
// debug trace unconditionally, and console.log is an async stream write, not
// a synchronous print. Firing it dozens of times in quick succession (a user
// re-picking through many near-identical candidates) faster than the
// container's log driver can drain it lets writes back up in the process's
// own memory instead of actually reaching the log — a real contributor to a
// heap-exhaustion crash we hit in production. Set DEBUG_PICKER=1 to opt in
// locally when actually debugging selector generation.
const DEBUG_PICKER = process.env.DEBUG_PICKER === "1";

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

  function stableAttrName(el) {
    // aria-colindex encodes which column of an ARIA grid this cell is —
    // semantic and stable across page loads, unlike CSS-in-JS hash classes
    // (e.g. Spotify's track-row cells) that can regenerate on every render
    // even though the tracklist-row wrapper's data-testid stays constant.
    for (const attr of ['data-testid','data-test','data-id','data-name','aria-colindex','aria-label','name']) {
      if (el.hasAttribute(attr)) return attr;
    }
    return null;
  }

  function buildSelector(el, debugTrace) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.tagName && cur !== document.documentElement) {
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      let s = cur.tagName.toLowerCase();
      const attrName = stableAttrName(cur);
      let skipPosition = false;
      if (attrName) {
        const v = cur.getAttribute(attrName);
        s += '[' + attrName + '=' + JSON.stringify(v) + ']';
        // An attribute like data-testid="tracklist-row" repeats across every
        // row, so position is still needed to say which one. An attribute
        // like aria-colindex="3" is already unique among this node's
        // same-tag siblings — appending nth-of-type on top is redundant, and
        // actively fragile: if sibling structure shifts slightly on a later
        // page load (e.g. a conditionally-rendered column), the DOM-order
        // count can stop landing on the element the attribute already
        // uniquely identifies.
        const sameAttrSibs = Array.from(cur.parentElement?.children || [])
          .filter(n => n.tagName === cur.tagName && n.getAttribute(attrName) === v);
        skipPosition = sameAttrSibs.length === 1;
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
      if (!skipPosition && sameTagSibs.length > 1)
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

wss.on("connection", (ws) => {
  let browser = null;
  let page = null;
  let cdp = null;
  let ready = false;
  let semaphoreReleased = false;
  let pendingMove = null;
  let moveInFlight = false;

  // On heavy pages, a single mouse.move()+evaluate() CDP round-trip can take
  // longer than the interval between incoming mousemove messages. If handled
  // sequentially with await, backlogged coordinates pile up and the cursor
  // keeps following a stale "backlogged path" after the user stops moving.
  // We coalesce: keep only the latest coordinate and drop all intermediate
  // ones, so the overlay always tracks the current cursor position only.
  const flushMove = async () => {
    if (moveInFlight || !pendingMove) return;
    const { x, y } = pendingMove;
    pendingMove = null;
    moveInFlight = true;
    try {
      await page?.mouse.move(x, y);
      // Get hovered element rect and send immediately — much faster than waiting
      // for a screencast JPEG frame to carry the overlay back to the client.
      const rect = await page?.evaluate(({ px, py }) => {
        const BLOCKED = new Set(['img','picture','video','audio','canvas','svg','iframe','object','embed','script','style','meta','link','noscript','br','hr','source','track']);
        const el = document.elementFromPoint(px, py);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return null;
        const tag = el.tagName.toLowerCase();
        const blocked = BLOCKED.has(tag) || (tag === 'input' && ['image','file','color','range','submit','button','reset','checkbox','radio'].includes((el.type || '').toLowerCase()));
        return { left: r.left, top: r.top, width: r.width, height: r.height, blocked };
      }, { px: x, py: y });
      send({ type: 'hittest', rect: rect || null });
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
        everyNthFrame: SCREENCAST_EVERY_NTH_FRAME,
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
        const nodeCount = await page
          .evaluate(() => document.querySelectorAll("*").length)
          .catch(() => 0);
        ready = true;
        send({ type: "status", status: "ready", nodeCount });
      }

      if (msg.type === "mousemove" && ready) {
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
          if (result.debug && DEBUG_PICKER) {
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
          // page.evaluate() has no built-in timeout — if the page is mid
          // re-render or otherwise busy when this fires, the call can hang
          // indefinitely and we'd never send test_result at all, leaving the
          // client's own 12s timeout to fire a generic "Response timed out"
          // with no real explanation. Bounding it here means we still reply
          // within that window, with a reason the client can actually show.
          const result = await Promise.race([
            page.evaluate(
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
            ),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Page was busy or navigating — try again")),
                8000,
              ),
            ),
          ]);
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
