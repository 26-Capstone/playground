const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

// ── 크롤러 단일 실행 ──────────────────────────────────────────────────────────
async function runCrawler(crawlerId) {
  const crawler = db.crawlers.get(crawlerId);
  if (!crawler) throw new Error(`크롤러 없음: ${crawlerId}`);
  if (!crawler.css_selector) throw new Error('CSS 셀렉터가 등록되지 않았습니다.');

  const fullUrl = /^https?:\/\//i.test(crawler.url) ? crawler.url : 'https://' + crawler.url;
  const start = Date.now();
  const browser = await chromium.launch({ headless: true });

  let html = '';
  let value = '';
  let extractError = null;

  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // CSS 셀렉터로 값 추출 (최대 5초 대기 후 시도)
    try {
      await page.waitForSelector(crawler.css_selector, { timeout: 5000 }).catch(() => {});
      value = await page.$eval(
        crawler.css_selector,
        el => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200)
      );
    } catch (e) {
      extractError = e.message;
    }

    // $eval 이후에 HTML 캡처 — JS 렌더링이 완료된 DOM 상태를 저장
    html = await page.content();

    // V1 스냅샷: 셀렉터가 성공할 때만 저장/갱신 (= 마지막으로 정상 동작한 HTML)
    if (value && !extractError) {
      const v1Path = path.join(SNAPSHOTS_DIR, `${crawlerId}_v1.html`);
      fs.writeFileSync(v1Path, html, 'utf-8');
    }
  } finally {
    await browser.close();
  }

  const durationMs = Date.now() - start;
  const succeeded = !!value && !extractError;

  // 결과 저장
  db.results.insert({
    crawler_id:  crawlerId,
    status:      succeeded ? 'healthy' : 'failed',
    value:       value || '',
    score:       succeeded ? 99.0 : 0,
    duration_ms: durationMs,
    note:        succeeded
      ? `정상 수집 — ${value}`
      : `셀렉터 매칭 실패: ${extractError || '값 없음'}`,
  });

  // score = 가장 최근 실행의 신뢰도 (성공=99, 실패=0, 힐링=실제 confidence%)
  const recent = db.results.list(crawlerId).slice(0, 20);
  const score = recent.length ? recent[0].score : 0;

  const now = new Date().toLocaleString('ko-KR');

  if (succeeded) {
    db.crawlers.update({
      id: crawlerId, status: 'healthy', score,
      last_value: value, last_run_at: now,
      healed_count: crawler.healed, css_selector: crawler.css_selector,
    });
    console.log(`[crawler] ${crawler.name} → 성공: "${value}" (${durationMs}ms)`);
    return { status: 'healthy', value, durationMs, score };
  }

  // 셀렉터 실패 → 자가치유 시도
  console.log(`[crawler] ${crawler.name} → 실패: ${extractError}`);
  db.crawlers.update({
    id: crawlerId, status: 'healing', score,
    last_value: '—', last_run_at: now,
    healed_count: crawler.healed, css_selector: crawler.css_selector,
  });

  const healResult = await tryHeal(crawlerId, crawler, html);
  return { status: 'failed', value: '', durationMs, score, heal: healResult };
}

// ── 자가치유 ──────────────────────────────────────────────────────────────────
async function tryHeal(crawlerId, crawler, v2Html) {
  const v1Path = path.join(SNAPSHOTS_DIR, `${crawlerId}_v1.html`);
  const now = new Date().toLocaleString('ko-KR');
  const current = db.crawlers.get(crawlerId);

  if (!fs.existsSync(v1Path)) {
    db.crawlers.update({
      id: crawlerId, status: 'failed', score: current.score,
      last_value: '—', last_run_at: now,
      healed_count: current.healed, css_selector: crawler.css_selector,
    });
    console.log(`[healer] V1 스냅샷 없음 — 자가치유 건너뜀`);
    return { status: 'skipped', reason: 'V1 스냅샷 없음' };
  }

  try {
    const v1Html = fs.readFileSync(v1Path, 'utf-8');
    console.log(`[healer] ${crawler.name} 자가치유 요청 중…`);

    const resp = await fetch(`${PYTHON_API_URL}/heal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        v1_html:      v1Html,
        v2_html:      v2Html,
        css_selector: crawler.css_selector,
        user_intent:  crawler.user_intent,
        target_name:  crawler.name,
      }),
    });
    const result = await resp.json();

    const confidence = result.confidence || 0;
    // threshold는 0~100 범위, confidence는 0~1 범위
    const thresholdRatio = (crawler.threshold || 85) / 100;

    if (result.status === 'healed' && confidence >= thresholdRatio) {
      // 신뢰도 충족 → 자동 복구
      const confidenceScore = Math.round(confidence * 1000) / 10;
      db.results.updateLastScore(crawlerId, confidenceScore);
      db.crawlers.update({
        id: crawlerId, status: 'healthy',
        score: confidenceScore,
        last_value: result.extracted_text || '—', last_run_at: now,
        healed_count: (current.healed || 0) + 1,
        css_selector: result.robust_selector || crawler.css_selector,
      });
      console.log(`[healer] 자동 복구 완료: ${result.robust_selector} (신뢰도 ${Math.round(confidence * 100)}%)`);
      return { status: 'healed', selector: result.robust_selector, confidence };

    } else if (result.status === 'healed' && confidence < thresholdRatio) {
      // 셀렉터는 찾았으나 신뢰도 미달 → 승인 큐에 저장
      const confidenceScore = Math.round(confidence * 1000) / 10;
      db.results.updateLastScore(crawlerId, confidenceScore);
      db.crawlers.update({
        id: crawlerId, status: 'pending',
        score: confidenceScore,
        last_value: '—', last_run_at: now,
        healed_count: current.healed, css_selector: crawler.css_selector,
      });
      db.proposals.insert({
        crawler_id:        crawlerId,
        crawler_name:      crawler.name,
        old_selector:      crawler.css_selector,
        proposed_selector: result.robust_selector || '',
        extracted_text:    result.extracted_text  || '',
        confidence:        confidence,
        reasoning:         result.reasoning       || '',
      });
      console.log(`[healer] 신뢰도 미달 (${Math.round(confidence * 100)}% < ${crawler.threshold}%) → 승인 큐 저장`);
      return { status: 'pending', confidence, reason: '신뢰도 미달 — 수동 승인 필요' };

    } else {
      // status가 'failed' 또는 'no_change_needed' — 치유 자체가 불가
      const reason = result.reason || `Python 응답: ${result.status}`;
      db.crawlers.update({
        id: crawlerId, status: 'failed',
        score: current.score, last_value: '—', last_run_at: now,
        healed_count: current.healed, css_selector: crawler.css_selector,
      });
      console.log(`[healer] 치유 불가 — ${reason}`);
      return { status: 'failed', reason };
    }
  } catch (e) {
    db.crawlers.update({
      id: crawlerId, status: 'failed', score: current.score,
      last_value: '—', last_run_at: now,
      healed_count: current.healed, css_selector: crawler.css_selector,
    });
    console.error(`[healer] 오류: ${e.message}`);
    return { status: 'error', reason: e.message };
  }
}

module.exports = { runCrawler };
