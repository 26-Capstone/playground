const express = require('express');
const { WebSocketServer } = require('ws');
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { runCrawler } = require('./crawler');
const scheduler = require('./scheduler');

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../client')));

// ─── Crawlers CRUD ────────────────────────────────────────────────────────────

app.get('/api/crawlers', (req, res) => {
  const crawlers = db.crawlers.list();
  const withSpark = crawlers.map(c => ({
    ...c,
    spark: db.results.sparkScores(c.id),
  }));
  res.json(withSpark);
});

app.get('/api/stats', (req, res) => {
  res.json(db.stats.summary());
});

app.post('/api/crawlers', (req, res) => {
  const b = req.body;
  if (!b.url || !b.name) return res.status(400).json({ error: 'name, url 필드가 필요합니다.' });
  const data = {
    id:           b.id           || 'cr_' + Math.random().toString(36).slice(2, 6),
    name:         b.name,
    url:          b.url,
    css_selector: b.css_selector || '',
    user_intent:  b.user_intent  || '',
    threshold:    b.threshold    ?? 85,
    schedule:     b.schedule     || 'daily-9',
    channels:     JSON.stringify(Array.isArray(b.channels) ? b.channels : ['REST API']),
    domain:       b.domain       || 'commerce',
    org:          b.org          || '',
    owner:        b.owner        || '',
    status:       'pending',
  };
  const created = db.crawlers.insert(data);
  scheduler.addJob(created);
  res.status(201).json(created);
});

app.get('/api/crawlers/:id', (req, res) => {
  const c = db.crawlers.get(req.params.id);
  if (!c) return res.status(404).json({ error: '크롤러를 찾을 수 없습니다.' });
  res.json(c);
});

app.delete('/api/crawlers/:id', (req, res) => {
  scheduler.removeJob(req.params.id);
  db.crawlers.delete(req.params.id);
  res.json({ ok: true });
});

app.patch('/api/crawlers/:id/selector', (req, res) => {
  const { css_selector, user_intent } = req.body;
  const crawler = db.crawlers.get(req.params.id);
  if (!crawler) return res.status(404).json({ error: '크롤러를 찾을 수 없습니다.' });
  db.crawlers.updateSelector(req.params.id, css_selector, user_intent ?? crawler.user_intent);
  // 셀렉터가 바뀌면 기존 V1 스냅샷 삭제 (새 셀렉터 기준으로 다시 쌓아야 함)
  const snapshotPath = path.join(__dirname, 'snapshots', `${req.params.id}_v1.html`);
  if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
  const updated = db.crawlers.get(req.params.id);
  scheduler.addJob(updated);
  res.json(updated);
});

app.get('/api/scheduler/status', (req, res) => {
  res.json(scheduler.getStatus());
});

app.get('/api/crawlers/:id/snapshot', (req, res) => {
  const snapshotPath = path.join(__dirname, 'snapshots', `${req.params.id}_v1.html`);
  if (!fs.existsSync(snapshotPath)) {
    return res.status(404).json({ error: 'V1 스냅샷 없음 — 크롤러를 한 번 이상 실행해야 생성됩니다.' });
  }
  res.json({ html: fs.readFileSync(snapshotPath, 'utf-8') });
});

app.get('/api/crawlers/:id/results', (req, res) => {
  res.json(db.results.list(req.params.id));
});

app.get('/api/crawlers/:id/results/csv', (req, res) => {
  const crawler = db.crawlers.get(req.params.id);
  if (!crawler) return res.status(404).json({ error: '크롤러를 찾을 수 없습니다.' });
  const rows = db.results.list(req.params.id);
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const header = ['수집시각', '상태', '추출값', '신뢰도', '응답시간(ms)', '비고'].join(',');
  const lines = rows.map(r => [r.run_at, r.status, esc(r.value), r.score, r.duration_ms, esc(r.note)].join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}_results.csv"`);
  res.send('﻿' + [header, ...lines].join('\r\n'));
});

app.post('/api/crawlers/:id/run', async (req, res) => {
  try {
    const result = await runCrawler(req.params.id);
    const updated = db.crawlers.get(req.params.id);
    res.json({ result, crawler: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Approvals (heal_proposals) ──────────────────────────────────────────────

app.get('/api/approvals', (req, res) => {
  res.json(db.proposals.listPending());
});

app.post('/api/approvals/:id/approve', (req, res) => {
  const proposal = db.proposals.get(req.params.id);
  if (!proposal) return res.status(404).json({ error: '승인 요청을 찾을 수 없습니다.' });

  const crawler = db.crawlers.get(proposal.crawler_id);
  if (!crawler) return res.status(404).json({ error: '크롤러를 찾을 수 없습니다.' });

  db.crawlers.update({
    id:           proposal.crawler_id,
    status:       'healthy',
    score:        Math.round(proposal.confidence * 1000) / 10,
    last_value:   proposal.extracted_text || '—',
    last_run_at:  new Date().toLocaleString('ko-KR'),
    healed_count: (crawler.healed || 0) + 1,
    css_selector: proposal.proposed_selector,
  });
  db.proposals.updateStatus(proposal.id, 'approved');

  res.json({ ok: true, crawler: db.crawlers.get(proposal.crawler_id) });
});

app.post('/api/approvals/:id/reject', (req, res) => {
  const proposal = db.proposals.get(req.params.id);
  if (!proposal) return res.status(404).json({ error: '승인 요청을 찾을 수 없습니다.' });

  const crawler = db.crawlers.get(proposal.crawler_id);
  if (crawler) {
    db.crawlers.update({
      id:           proposal.crawler_id,
      status:       'failed',
      score:        crawler.score,
      last_value:   '—',
      last_run_at:  new Date().toLocaleString('ko-KR'),
      healed_count: crawler.healed,
      css_selector: crawler.css_selector,
    });
  }
  db.proposals.updateStatus(proposal.id, 'rejected');

  res.json({ ok: true });
});

// ─── /heal: Python FastAPI 프록시 ──────────────────────────────────────────
app.post('/heal', async (req, res) => {
  try {
    const upstream = await fetch(`${PYTHON_API_URL}/heal`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `Python API 연결 실패: ${e.message}` });
  }
});

// ─── /fetch-html: Playwright로 현재 페이지 HTML 수집 ──────────────────────
app.post('/fetch-html', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url 필드가 필요합니다.' });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const html = await page.content();
    res.json({ html });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await browser.close();
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const VIEWPORT = { width: 1280, height: 800 };

// 요소의 CSS 셀렉터를 생성하는 로직 (페이지 내에서 실행됨)
const GET_SELECTOR_FN = `
(function({ x, y }) {
  const el = document.elementFromPoint(x, y);
  if (!el || el.id === '__doma_hl__') return null;

  // CSS-in-JS 해시 클래스 감지: 하이픈 없고 모음 비율 < 25%
  function isHashClass(c) {
    if (!c || c.includes('-')) return false;
    const letters = c.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 3) return false;
    const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
    return vowels / letters.length < 0.25;
  }

  // 안정적인 속성 (data-testid, aria-label 등) 우선 사용
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
        // 해시 클래스 걸러내고 의미있는 클래스만 사용
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

// 마우스 오버 하이라이트 오버레이를 주입하는 스크립트
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

  document.addEventListener('mousemove', function(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.id === '__doma_hl__') { ov.style.display = 'none'; return; }
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

      if (msg.type === 'test_selector' && ready) {
        try {
          const result = await page.evaluate((sel) => {
            try {
              const el = document.querySelector(sel);
              if (!el) return { found: false };
              return { found: true, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) };
            } catch (e) {
              return { found: false, error: e.message };
            }
          }, msg.selector);
          send({ type: 'test_result', ...result });
        } catch (e) {
          send({ type: 'test_result', found: false, error: e.message });
        }
      }

      if (msg.type === 'scroll' && ready) {
        await page.mouse.wheel(0, msg.dy);
      }

      if (msg.type === 'keypress' && ready) {
        await page.keyboard.press(msg.key);
      }

      if (msg.type === 'remove_overlays' && ready) {
        const removed = await page.evaluate(() => {
          const isOverlay = (el) => {
            const s = getComputedStyle(el);
            const pos = s.position;
            if (pos !== 'fixed' && pos !== 'sticky' && pos !== 'absolute') return false;
            const z = parseInt(s.zIndex, 10);
            if (isNaN(z) || z < 10) return false;
            const r = el.getBoundingClientRect();
            // Must cover a meaningful area of the viewport
            return r.width > 80 && r.height > 80;
          };
          let count = 0;
          // dialog / role patterns first
          document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]').forEach(el => {
            el.remove(); count++;
          });
          // high-z overlays
          [...document.querySelectorAll('*')].filter(isOverlay).forEach(el => {
            el.remove(); count++;
          });
          // common overlay class names
          document.querySelectorAll([
            '.modal,.modal-backdrop,.overlay,.popup,.popup-overlay',
            '.dialog,.cookie-banner,.cookie-notice,.gdpr-banner',
            '[class*="modal"],[class*="popup"],[class*="overlay"],[class*="cookie"]',
          ].join(',')).forEach(el => { el.remove(); count++; });
          // restore body scroll lock
          document.body.style.overflow = '';
          document.documentElement.style.overflow = '';
          return count;
        });
        send({ type: 'overlays_removed', count: removed });
      }

      if (msg.type === 'remove_element' && ready) {
        await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          if (el && el !== document.body && el !== document.documentElement) el.remove();
        }, { x: msg.x, y: msg.y });
      }

    } catch (err) {
      send({ type: 'error', message: err.message });
    }
  });

  ws.on('close', async () => {
    await browser?.close().catch(() => {});
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`DOMA → http://localhost:${PORT}/DOMA.html`);
  scheduler.initScheduler();
});
