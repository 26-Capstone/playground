const cron = require('node-cron');
const db = require('./db');
const { runCrawler } = require('./crawler');

// scheduleKey → cron 표현식 (없으면 scheduleKey 자체를 raw cron으로 사용)
const CRON_MAP = {
  'daily-9': '0 9 * * *',
  'hourly':  '0 * * * *',
  '15m':     '*/15 * * * *',
};

const jobs    = new Map(); // crawlerId → cron.ScheduledTask
const running = new Set(); // 현재 실행 중인 crawlerId

// ── 단일 크롤러 job 등록 ───────────────────────────────────────────────────────
function addJob(crawler) {
  const expr = CRON_MAP[crawler.scheduleKey] || crawler.scheduleKey;
  if (!cron.validate(expr)) {
    console.warn(`[scheduler] ${crawler.name}: 유효하지 않은 cron 표현식 — "${expr}" (건너뜀)`);
    return;
  }
  if (jobs.has(crawler.id)) removeJob(crawler.id);

  const task = cron.schedule(expr, async () => {
    if (running.has(crawler.id)) {
      console.log(`[scheduler] ${crawler.name} 이미 실행 중 — 건너뜀`);
      return;
    }
    running.add(crawler.id);
    console.log(`[scheduler] ${crawler.name} 스케줄 실행 시작 (${expr})`);
    try {
      await runCrawler(crawler.id);
    } catch (e) {
      console.error(`[scheduler] ${crawler.name} 실행 오류: ${e.message}`);
    } finally {
      running.delete(crawler.id);
    }
  });

  jobs.set(crawler.id, task);
  console.log(`[scheduler] 등록: ${crawler.name} → ${expr}`);
}

// ── 단일 크롤러 job 제거 ───────────────────────────────────────────────────────
function removeJob(crawlerId) {
  const task = jobs.get(crawlerId);
  if (task) {
    task.stop();
    jobs.delete(crawlerId);
    console.log(`[scheduler] 제거: ${crawlerId}`);
  }
}

// ── 서버 시작 시 DB의 모든 크롤러 로드해서 등록 ──────────────────────────────────
function initScheduler() {
  const crawlers = db.crawlers.list();
  for (const c of crawlers) addJob(c);
  console.log(`[scheduler] 초기화 완료 — ${crawlers.length}개 크롤러 등록됨`);
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
