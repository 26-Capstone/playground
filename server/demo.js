// A demo target page, served by this service, for showing self-healing live.
//
// Real site redesigns happen every few months, so there is no way to show the
// thing this project is actually about on a stage. This page stands in for a
// ranking site: its values move every second, and /demo/layout switches its
// markup to a completely different structure — different tags, different class
// names, a different column order — while the visible text stays the same. That
// is the shape of a real redesign, and it is what the healer has to survive.
//
// Deliberately server-rendered with no scripts or external assets: it loads in
// about a second, so a demo scraper can run on a seconds-level schedule, which
// no real site tolerates.
//
// The layout is in-memory, so a container restart puts it back to A.

const ITEMS = [
  { name: '아크니트 오버사이즈 니트', base: 59000 },
  { name: '코튼 와이드 데님 팬츠', base: 42000 },
  { name: '울 블렌드 발마칸 코트', base: 189000 },
  { name: '램스울 라운드넥 가디건', base: 78000 },
  { name: '워싱 코듀로이 셔츠', base: 36000 },
];

// How often the ranking reorders, so a text target (the #1 product name) visibly
// changes too and not only the numbers.
const ROTATE_MS = 20000;

let layout = 'a';

function board(now = Date.now()) {
  const tick = Math.floor(now / 1000);
  const rows = ITEMS.map((item, i) => ({
    name: item.name,
    // A small wave per item, so every second's reading differs.
    price: Math.round(item.base * (1 + Math.sin((tick + i * 7) / 5) * 0.02)),
  }));
  const shift = Math.floor(now / ROTATE_MS) % rows.length;
  return rows.slice(shift).concat(rows.slice(0, shift));
}

const won = (n) => n.toLocaleString('ko-KR') + '원';

const CSS = `
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body { margin:0; padding:40px 24px; background:#F7F8FA; color:#191F28;
         font:16px/1.6 -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif }
  .wrap { max-width:760px; margin:0 auto; display:flex; flex-direction:column; gap:20px }
  nav { display:flex; gap:8px; align-items:center; font-size:13px; color:#4E5968 }
  nav a { padding:6px 12px; border-radius:999px; background:#E5E8EB; color:#191F28; text-decoration:none }
  nav a.on { background:#3182F6; color:#fff }
  h2 { margin:0; font-size:24px; letter-spacing:-0.02em }
  .meta { font-size:13px; color:#8B95A1; font-variant-numeric:tabular-nums }
  table { width:100%; border-collapse:collapse; background:#fff; border-radius:14px; overflow:hidden;
          box-shadow:0 1px 2px rgba(25,31,40,.06) }
  th, td { padding:14px 18px; text-align:left; border-top:1px solid rgba(25,31,40,.07) }
  thead th { border-top:0; font-size:12px; letter-spacing:.04em; color:#8B95A1; background:#fff }
  .rank { width:56px; font-weight:700; color:#3182F6; font-variant-numeric:tabular-nums }
  .price { font-variant-numeric:tabular-nums; font-weight:600 }
  .sc-list { display:flex; flex-direction:column; gap:10px }
  .sc-item { display:flex; align-items:center; gap:16px; background:#fff; padding:16px 18px;
             border-radius:14px; box-shadow:0 1px 2px rgba(25,31,40,.06) }
  .sc-badge { width:28px; height:28px; border-radius:50%; background:#3182F6; color:#fff;
              display:grid; place-items:center; font-size:13px; font-weight:700; font-style:normal }
  .sc-amt { width:120px; font-weight:600; font-variant-numeric:tabular-nums }
  .sc-head { display:flex; gap:16px; padding:0 18px; font-size:12px; letter-spacing:.04em; color:#8B95A1 }
`;

// Layout A — a table. Columns: 순위 · 상품명 · 가격.
function renderA(rows) {
  const body = rows
    .map(
      (r, i) => `      <tr class="row">
        <td class="rank">${i + 1}</td>
        <td class="name">${r.name}</td>
        <td class="price">${won(r.price)}</td>
      </tr>`,
    )
    .join('\n');
  return `    <table class="rank-table">
      <thead><tr><th>순위</th><th>상품명</th><th>가격</th></tr></thead>
      <tbody>
${body}
      </tbody>
    </table>`;
}

// Layout B — the same content after a "redesign": flex rows instead of a table,
// generated-looking class names, and 가격 moved ahead of 상품명 so position-based
// selectors miss. The visible text and the column labels are unchanged, which is
// what the healer's anchors rely on.
function renderB(rows) {
  const body = rows
    .map(
      (r, i) => `        <div class="sc-item">
          <em class="sc-badge">${i + 1}</em>
          <span class="sc-amt">${won(r.price)}</span>
          <p class="sc-ttl">${r.name}</p>
        </div>`,
    )
    .join('\n');
  return `    <div class="sc-7f3a1b">
      <div class="sc-head"><span>순위</span><span>가격</span><span>상품명</span></div>
      <div class="sc-list">
${body}
      </div>
    </div>`;
}

function renderPage(which) {
  const rows = board();
  const stamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DOMA 데모 — 실시간 인기 상품</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <!-- Controls live in <nav> on purpose: the healer excludes nav landmarks from
         its candidates, so these links never get mistaken for the data. -->
    <nav>
      <span>레이아웃</span>
      <a class="${which === 'a' ? 'on' : ''}" href="/demo/layout?set=a">A (원래 구조)</a>
      <a class="${which === 'b' ? 'on' : ''}" href="/demo/layout?set=b">B (개편 후)</a>
    </nav>
    <h2>실시간 인기 상품</h2>
    <p class="meta">갱신 ${stamp} · 매초 가격이 바뀌고 ${ROTATE_MS / 1000}초마다 순위가 교체됩니다</p>
${which === 'b' ? renderB(rows) : renderA(rows)}
  </div>
</body>
</html>`;
}

function registerDemoRoutes(app) {
  app.get('/demo/board', (req, res) => {
    const forced = req.query.layout === 'a' || req.query.layout === 'b' ? req.query.layout : null;
    res.type('html').send(renderPage(forced || layout));
  });

  // A GET so it can be a link on the page itself — this is a demo switch, not an API.
  app.get('/demo/layout', (req, res) => {
    const set = req.query.set;
    if (set === 'a' || set === 'b') {
      layout = set;
      console.log(`[demo] layout → ${set}`);
    }
    res.redirect('/demo/board');
  });

  app.get('/demo/state', (req, res) => res.json({ layout }));
}

module.exports = { registerDemoRoutes };
