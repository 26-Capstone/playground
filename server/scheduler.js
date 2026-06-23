const cron = require('node-cron');
const db = require('./db');
const { runScraper } = require('./scraper');

// scheduleKey → cron 표현식 (없으면 scheduleKey 자체를 raw cron으로 사용)
const CRON_MAP = {
  'daily-9': '0 9 * * *',
  'hourly':  '0 * * * *',
  '15m':     '*/15 * * * *',
};

const jobs    = new Map(); // scraperId → cron.ScheduledTask
const running = new Set(); // 현재 실행 중인 scraperId

// ── 단일 스크래퍼 job 등록 ───────────────────────────────────────────────────────
function addJob(scraper) {
  if (!scraper.css_selector) return;
  const expr = CRON_MAP[scraper.scheduleKey] || scraper.scheduleKey;
  if (!cron.validate(expr)) {
    console.warn(`[scheduler] ${scraper.name}: 유효하지 않은 cron 표현식 — "${expr}" (건너뜀)`);
    return;
  }
  if (jobs.has(scraper.id)) removeJob(scraper.id);

  const task = cron.schedule(expr, async () => {
    if (running.has(scraper.id)) {
      console.log(`[scheduler] ${scraper.name} 이미 실행 중 — 건너뜀`);
      return;
    }
    running.add(scraper.id);
    console.log(`[scheduler] ${scraper.name} 스케줄 실행 시작 (${expr})`);
    try {
      await runScraper(scraper.id);
    } catch (e) {
      console.error(`[scheduler] ${scraper.name} 실행 오류: ${e.message}`);
    } finally {
      running.delete(scraper.id);
    }
  });

  jobs.set(scraper.id, task);
  console.log(`[scheduler] 등록: ${scraper.name} → ${expr}`);
}

// ── 단일 스크래퍼 job 제거 ───────────────────────────────────────────────────────
function removeJob(scraperId) {
  const task = jobs.get(scraperId);
  if (task) {
    task.stop();
    jobs.delete(scraperId);
    console.log(`[scheduler] 제거: ${scraperId}`);
  }
}

// ── 서버 시작 시 DB의 모든 스크래퍼 로드해서 등록 ──────────────────────────────────
function initScheduler() {
  const scrapers = db.scrapers.list().filter(c => c.status !== 'paused');
  for (const c of scrapers) addJob(c);
  console.log(`[scheduler] 초기화 완료 — ${scrapers.length}개 스크래퍼 등록됨`);
}

// ── 현재 스케줄 상태 조회 (API용) ─────────────────────────────────────────────
function getStatus() {
  return {
    total:   jobs.size,
    running: Array.from(running),
    jobs:    Array.from(jobs.keys()),
  };
}

module.exports = { addJob, removeJob, initScheduler, getStatus };
