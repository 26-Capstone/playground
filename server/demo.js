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
  { name: 'Oversized Cable-Knit Sweater', base: 59 },
  { name: 'Wide-Leg Cotton Denim Pants', base: 42 },
  { name: 'Wool-Blend Balmacaan Coat', base: 189 },
  { name: 'Lambswool Crewneck Cardigan', base: 78 },
  { name: 'Washed Corduroy Shirt', base: 36 },
];

// The ranking order is fixed; only prices move. It used to reorder every 20s so
// the #1 name changed too, but then a redesign could land between two readings
// with the previous #1 sitting at #2. The healer then has to choose between the
// old text (now #2) and the #1 position, and it chose differently on two takes
// of the same demo (cr_o2hi picked #1, cr_q3jv picked #2) — a real limitation
// on ranked lists, but not one a stage demo should depend on.

let layout = 'a';

function board(now = Date.now()) {
  const tick = Math.floor(now / 1000);
  const rows = ITEMS.map((item, i) => ({
    name: item.name,
    // A small wave per item, in cents, so every second's reading differs.
    price: Math.round(item.base * 100 * (1 + Math.sin((tick + i * 7) / 5) * 0.02)),
  }));
  return rows;
}

const usd = (cents) =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CSS = `
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body { margin:0; padding:40px 24px; background:#F7F8FA; color:#191F28;
         font:16px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif }
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

// Layout A — a table. Columns: Rank · Product · Price.
function renderA(rows) {
  const body = rows
    .map(
      (r, i) => `      <tr class="row">
        <td class="rank">${i + 1}</td>
        <td class="name">${r.name}</td>
        <td class="price">${usd(r.price)}</td>
      </tr>`,
    )
    .join('\n');
  return `    <table class="rank-table">
      <thead><tr><th>Rank</th><th>Product</th><th>Price</th></tr></thead>
      <tbody>
${body}
      </tbody>
    </table>`;
}

// Layout B — the same content after a "redesign": flex rows instead of a table,
// generated-looking class names, and Price moved ahead of Product so position-based
// selectors miss. The visible text and the column labels are unchanged, which is
// what the healer's anchors rely on.
function renderB(rows) {
  const body = rows
    .map(
      (r, i) => `        <div class="sc-item">
          <em class="sc-badge">${i + 1}</em>
          <span class="sc-amt">${usd(r.price)}</span>
          <p class="sc-ttl">${r.name}</p>
        </div>`,
    )
    .join('\n');
  return `    <div class="sc-7f3a1b">
      <div class="sc-head"><span>Rank</span><span>Price</span><span>Product</span></div>
      <div class="sc-list">
${body}
      </div>
    </div>`;
}

function renderPage(which) {
  const rows = board();
  const stamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DOMA Demo — Trending Now</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <!-- Controls live in <nav> on purpose: the healer excludes nav landmarks from
         its candidates, so these links never get mistaken for the data. -->
    <nav>
      <span>Layout</span>
      <a class="${which === 'a' ? 'on' : ''}" href="/demo/layout?set=a">A (original)</a>
      <a class="${which === 'b' ? 'on' : ''}" href="/demo/layout?set=b">B (redesigned)</a>
    </nav>
    <h2>Trending Now</h2>
    <p class="meta">Updated ${stamp} · Prices change every second</p>
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
