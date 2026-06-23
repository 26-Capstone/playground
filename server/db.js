const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'doma.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS crawlers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    css_selector TEXT NOT NULL DEFAULT '',
    user_intent TEXT NOT NULL DEFAULT '',
    threshold   INTEGER NOT NULL DEFAULT 85,
    schedule    TEXT NOT NULL DEFAULT 'daily-9',
    channels    TEXT NOT NULL DEFAULT '["REST API"]',
    domain      TEXT NOT NULL DEFAULT 'commerce',
    org         TEXT NOT NULL DEFAULT '',
    owner       TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',
    score       REAL NOT NULL DEFAULT 0,
    last_value  TEXT NOT NULL DEFAULT '—',
    last_run_at TEXT NOT NULL DEFAULT '',
    healed_count INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS crawl_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    crawler_id  TEXT NOT NULL,
    status      TEXT NOT NULL,
    value       TEXT NOT NULL DEFAULT '',
    score       REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    note        TEXT NOT NULL DEFAULT '',
    run_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (crawler_id) REFERENCES crawlers(id)
  );

  CREATE TABLE IF NOT EXISTS heal_proposals (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    crawler_id        TEXT NOT NULL,
    crawler_name      TEXT NOT NULL DEFAULT '',
    old_selector      TEXT NOT NULL,
    proposed_selector TEXT NOT NULL,
    extracted_text    TEXT NOT NULL DEFAULT '',
    confidence        REAL NOT NULL DEFAULT 0,
    reasoning         TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'pending',
    created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    reviewed_at       TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (crawler_id) REFERENCES crawlers(id)
  );
`);

// ── crawlers ──────────────────────────────────────────────────────────────────

const stmts = {
  list:   db.prepare('SELECT * FROM crawlers ORDER BY created_at DESC'),
  get:    db.prepare('SELECT * FROM crawlers WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO crawlers (id, name, url, css_selector, user_intent, threshold, schedule, channels, domain, org, owner, status)
    VALUES (@id, @name, @url, @css_selector, @user_intent, @threshold, @schedule, @channels, @domain, @org, @owner, @status)
  `),
  update: db.prepare(`
    UPDATE crawlers SET
      status = @status, score = @score, last_value = @last_value, last_run_at = @last_run_at,
      healed_count = @healed_count, css_selector = @css_selector
    WHERE id = @id
  `),
  updateSelector: db.prepare(`
    UPDATE crawlers SET css_selector = @css_selector, user_intent = @user_intent,
      status = 'pending', score = 0, last_value = '—'
    WHERE id = @id
  `),
  _deleteResults: db.prepare('DELETE FROM crawl_results WHERE crawler_id = ?'),
  _deleteCrawler:  db.prepare('DELETE FROM crawlers WHERE id = ?'),
};

const resultStmts = {
  insert: db.prepare(`
    INSERT INTO crawl_results (crawler_id, status, value, score, duration_ms, note)
    VALUES (@crawler_id, @status, @value, @score, @duration_ms, @note)
  `),
  list:        db.prepare('SELECT * FROM crawl_results WHERE crawler_id = ? ORDER BY run_at DESC LIMIT 50'),
  sparkScores: db.prepare('SELECT score FROM crawl_results WHERE crawler_id = ? ORDER BY run_at ASC'),
  updateLastScore: db.prepare(`
    UPDATE crawl_results SET score = @score
    WHERE id = (SELECT id FROM crawl_results WHERE crawler_id = @crawler_id ORDER BY run_at DESC LIMIT 1)
  `),
};

const statsStmts = {
  activeFeeds:  db.prepare("SELECT COUNT(*) as n FROM crawlers WHERE status != 'paused'"),
  results7d:    db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status='healthy' THEN 1 ELSE 0 END) as success,
           AVG(duration_ms) as avgMs
    FROM crawl_results
    WHERE run_at >= datetime('now', '-7 days', 'localtime')
  `),
  totalHealed:  db.prepare("SELECT COALESCE(SUM(healed_count), 0) as n FROM crawlers"),
  pendingCount: db.prepare("SELECT COUNT(*) as n FROM heal_proposals WHERE status='pending'"),
  durations7d:  db.prepare(
    "SELECT duration_ms FROM crawl_results WHERE run_at >= datetime('now', '-7 days', 'localtime') ORDER BY duration_ms"
  ),
};

const proposalStmts = {
  insert: db.prepare(`
    INSERT INTO heal_proposals (crawler_id, crawler_name, old_selector, proposed_selector, extracted_text, confidence, reasoning)
    VALUES (@crawler_id, @crawler_name, @old_selector, @proposed_selector, @extracted_text, @confidence, @reasoning)
  `),
  listPending: db.prepare(`SELECT * FROM heal_proposals WHERE status = 'pending' ORDER BY created_at DESC`),
  get:         db.prepare(`SELECT * FROM heal_proposals WHERE id = ?`),
  updateStatus: db.prepare(`UPDATE heal_proposals SET status = @status, reviewed_at = @reviewed_at WHERE id = @id`),
  _deleteByCrawford: db.prepare(`DELETE FROM heal_proposals WHERE crawler_id = ?`),
};

function dbRowToCrawler(row) {
  if (!row) return null;
  return {
    id:           row.id,
    name:         row.name,
    url:          row.url,
    css_selector: row.css_selector,
    user_intent:  row.user_intent,
    threshold:    row.threshold,
    schedule:     scheduleLabel(row.schedule),
    scheduleKey:  row.schedule,
    channels:     JSON.parse(row.channels || '[]'),
    domain:       row.domain,
    org:          row.org,
    owner:        row.owner,
    status:       row.status,
    score:        row.score,
    lastValue:    row.last_value,
    lastRun:      row.last_run_at || '—',
    healed:       row.healed_count,
    runs7d:       0,
    spark:        [],
    type:         row.domain,
    altCategory:  domainToAlt(row.domain),
    delivery:     JSON.parse(row.channels || '[]'),
    createdAt:    row.created_at,
  };
}

function domainToAlt(d) {
  return { commerce:'소비 수요', labor:'노동 시장', realestate:'부동산',
           regulatory:'규제·공시', media:'미디어', finance:'금융' }[d] || d;
}

function scheduleLabel(s) {
  return { 'daily-9':'매일 09:00', 'hourly':'매시간', '15m':'15분마다' }[s] || `Cron: ${s}`;
}

module.exports = {
  crawlers: {
    list:   ()     => stmts.list.all().map(dbRowToCrawler),
    get:    (id)   => dbRowToCrawler(stmts.get.get(id)),
    insert: (data) => { stmts.insert.run(data); return module.exports.crawlers.get(data.id); },
    update: (data) => { stmts.update.run(data); return module.exports.crawlers.get(data.id); },
    updateSelector: (id, css_selector, user_intent) => {
      stmts.updateSelector.run({ id, css_selector, user_intent });
      return module.exports.crawlers.get(id);
    },
    delete: db.transaction((id) => {
      proposalStmts._deleteByCrawford.run(id);
      stmts._deleteResults.run(id);
      stmts._deleteCrawler.run(id);
    }),
  },
  results: {
    insert:          (data) => resultStmts.insert.run(data),
    list:            (cid)  => resultStmts.list.all(cid),
    sparkScores:     (cid)  => resultStmts.sparkScores.all(cid).map(r => r.score).slice(-20),
    updateLastScore: (crawler_id, score) => resultStmts.updateLastScore.run({ crawler_id, score }),
  },
  stats: {
    summary: () => {
      const activeFeedsCount = statsStmts.activeFeeds.get().n;
      const r7d              = statsStmts.results7d.get();
      const totalHealed      = statsStmts.totalHealed.get().n;
      const pendingCount     = statsStmts.pendingCount.get().n;
      const durations        = statsStmts.durations7d.all().map(r => r.duration_ms);

      const successRate = r7d.total > 0
        ? Math.round((r7d.success / r7d.total) * 10000) / 100
        : null;

      const p95 = durations.length > 0
        ? durations[Math.min(Math.floor(durations.length * 0.95), durations.length - 1)]
        : null;

      return {
        activeFeedsCount,
        successRate7d:  successRate,
        totalHealed,
        pendingCount,
        avgDurationMs:  r7d.avgMs ? Math.round(r7d.avgMs) : null,
        p95DurationMs:  p95,
        resultCount7d:  r7d.total,
      };
    },
  },
  proposals: {
    insert:      (data) => { proposalStmts.insert.run(data); },
    listPending: ()     => proposalStmts.listPending.all(),
    get:         (id)   => proposalStmts.get.get(id),
    updateStatus: (id, status) => proposalStmts.updateStatus.run({
      id, status, reviewed_at: new Date().toLocaleString('ko-KR'),
    }),
  },
};
