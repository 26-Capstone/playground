const express = require('express');
const { WebSocketServer } = require('ws');
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, '../client')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const VIEWPORT = { width: 1280, height: 800 };

// 요소의 CSS 셀렉터를 생성하는 로직 (페이지 내에서 실행됨)
const GET_SELECTOR_FN = `
(function({ x, y }) {
  const el = document.elementFromPoint(x, y);
  if (!el || el.id === '__mender_hl__') return null;

  function buildSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.tagName && cur !== document.documentElement) {
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      let s = cur.tagName.toLowerCase();
      const cls = Array.from(cur.classList)
        .filter(c => c !== '__mender_hl__')
        .slice(0, 3)
        .map(c => '.' + CSS.escape(c))
        .join('');
      s += cls;
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

// 마우스 오버 하이라이트 오버레이를 주입하는 스크립트
const OVERLAY_SCRIPT = `
(function() {
  if (document.getElementById('__mender_hl__')) return;
  const ov = document.createElement('div');
  ov.id = '__mender_hl__';
  ov.style.cssText = [
    'position:fixed', 'pointer-events:none', 'z-index:2147483647',
    'outline:2px solid #3182F6', 'background:rgba(49,130,246,0.10)',
    'box-shadow:0 0 0 4px rgba(49,130,246,0.15)', 'border-radius:3px',
    'transition:left 60ms,top 60ms,width 60ms,height 60ms', 'display:none'
  ].join(';');
  document.body.appendChild(ov);

  document.addEventListener('mousemove', function(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.id === '__mender_hl__') { ov.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    ov.style.display = 'block';
    ov.style.left   = r.left   + 'px';
    ov.style.top    = r.top    + 'px';
    ov.style.width  = r.width  + 'px';
    ov.style.height = r.height + 'px';
  });
})();
`;

wss.on('connection', (ws) => {
  let browser = null;
  let page = null;
  let cdp = null;
  let ready = false;
  let lastMoveAt = 0;

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  (async () => {
    try {
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        viewport: VIEWPORT,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      page = await ctx.newPage();
      cdp  = await ctx.newCDPSession(page);

      await cdp.send('Page.startScreencast', {
        format: 'jpeg', quality: 80,
        maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height,
      });

      cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
        send({ type: 'frame', data });
        await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });

      send({ type: 'status', status: 'connected' });
    } catch (err) {
      send({ type: 'error', message: err.message });
    }
  })();

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (!page) return;

      if (msg.type === 'navigate') {
        ready = false;
        send({ type: 'status', status: 'navigating' });
        await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.evaluate(OVERLAY_SCRIPT).catch(() => {});
        const nodeCount = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => 0);
        ready = true;
        send({ type: 'status', status: 'ready', nodeCount });
      }

      if (msg.type === 'mousemove' && ready) {
        const now = Date.now();
        if (now - lastMoveAt < 32) return; // ~30fps
        lastMoveAt = now;
        await page.mouse.move(msg.x, msg.y);
      }

      if (msg.type === 'click' && ready) {
        const result = await page.evaluate(
          new Function('args', `return (${GET_SELECTOR_FN})(args)`),
          { x: msg.x, y: msg.y }
        );
        if (result) send({ type: 'selector', ...result });
      }

      if (msg.type === 'scroll' && ready) {
        await page.mouse.wheel(0, msg.dy);
      }

    } catch (err) {
      send({ type: 'error', message: err.message });
    }
  });

  ws.on('close', async () => {
    await browser?.close().catch(() => {});
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Mender → http://localhost:${PORT}/Mender.html`);
});
