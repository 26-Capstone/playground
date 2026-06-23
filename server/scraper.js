const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

// ── 스크래퍼 단일 실행 ──────────────────────────────────────────────────────────
async function runScraper(scraperId) {
  const scraper = db.scrapers.get(scraperId);
  if (!scraper) throw new Error(`스크래퍼 없음: ${scraperId}`);
  if (!scraper.css_selector) throw new Error('CSS 셀렉터가 등록되지 않았습니다.');

  const fullUrl = /^https?:\/\//i.test(scraper.url) ? scraper.url : 'https://' + scraper.url;
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
      await page.waitForSelector(scraper.css_selector, { timeout: 5000 }).catch(() => {});
      value = await page.$eval(
        scraper.css_selector,
        el => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200)
      );
    } catch (e) {
      extractError = e.message;
    }

    // $eval 이후에 HTML 캡처 — JS 렌더링이 완료된 DOM 상태를 저장
    html = await page.content();

    // V1 스냅샷: 셀렉터가 성공할 때만 저장/갱신 (= 마지막으로 정상 동작한 HTML)
    if (value && !extractError) {
      const v1Path = path.join(SNAPSHOTS_DIR, `${scraperId}_v1.html`);
      fs.writeFileSync(v1Path, html, 'utf-8');
    }
  } finally {
    await browser.close();
  }

  const durationMs = Date.now() - start;
  const succeeded = !!value && !extractError;

  // 결과 저장
  db.results.insert({
    scraper_id:  scraperId,
    status:      succeeded ? 'healthy' : 'failed',
    value:       value || '',
    score:       succeeded ? 99.0 : 0,
    duration_ms: durationMs,
    note:        succeeded
      ? `정상 수집 — ${value}`
      : `셀렉터 매칭 실패: ${extractError || '값 없음'}`,
  });

  // score = 가장 최근 실행의 신뢰도 (성공=99, 실패=0, 힐링=실제 confidence%)
  const recent = db.results.list(scraperId).slice(0, 20);
  const score = recent.length ? recent[0].score : 0;

  const now = new Date().toLocaleString('ko-KR');

  if (succeeded) {
    db.scrapers.update({
      id: scraperId, status: 'healthy', score,
      last_value: value, last_run_at: now,
      healed_count: scraper.healed, css_selector: scraper.css_selector,
    });
    console.log(`[scraper] ${scraper.name} → 성공: "${value}" (${durationMs}ms)`);
    return { status: 'healthy', value, durationMs, score };
  }

  // 셀렉터 실패 → 자가치유 시도
  console.log(`[scraper] ${scraper.name} → 실패: ${extractError}`);
  db.scrapers.update({
    id: scraperId, status: 'healing', score,
    last_value: '—', last_run_at: now,
    healed_count: scraper.healed, css_selector: scraper.css_selector,
  });

  const healResult = await tryHeal(scraperId, scraper, html);
  return { status: 'failed', value: '', durationMs, score, heal: healResult };
}

// ── 자가치유 ──────────────────────────────────────────────────────────────────
async function tryHeal(scraperId, scraper, v2Html) {
  const v1Path = path.join(SNAPSHOTS_DIR, `${scraperId}_v1.html`);
  const now = new Date().toLocaleString('ko-KR');
  const current = db.scrapers.get(scraperId);

  if (!fs.existsSync(v1Path)) {
    db.scrapers.update({
      id: scraperId, status: 'failed', score: current.score,
      last_value: '—', last_run_at: now,
      healed_count: current.healed, css_selector: scraper.css_selector,
    });
    console.log(`[healer] V1 스냅샷 없음 — 자가치유 건너뜀`);
    return { status: 'skipped', reason: 'V1 스냅샷 없음' };
  }

  try {
    const v1Html = fs.readFileSync(v1Path, 'utf-8');
    console.log(`[healer] ${scraper.name} 자가치유 요청 중…`);

    const resp = await fetch(`${PYTHON_API_URL}/heal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        v1_html:      v1Html,
        v2_html:      v2Html,
        css_selector: scraper.css_selector,
        user_intent:  scraper.user_intent,
        target_name:  scraper.name,
      }),
    });
    const result = await resp.json();

    const confidence = result.confidence || 0;
    // threshold는 0~100 범위, confidence는 0~1 범위
    const thresholdRatio = (scraper.threshold || 85) / 100;

    if (result.status === 'healed' && confidence >= thresholdRatio) {
      // 신뢰도 충족 → 자동 복구
      const confidenceScore = Math.round(confidence * 1000) / 10;
      db.results.updateLastScore(scraperId, confidenceScore);
      db.scrapers.update({
        id: scraperId, status: 'healthy',
        score: confidenceScore,
        last_value: result.extracted_text || '—', last_run_at: now,
        healed_count: (current.healed || 0) + 1,
        css_selector: result.robust_selector || scraper.css_selector,
      });
      console.log(`[healer] 자동 복구 완료: ${result.robust_selector} (신뢰도 ${Math.round(confidence * 100)}%)`);
      return { status: 'healed', selector: result.robust_selector, confidence };

    } else if (result.status === 'healed' && confidence < thresholdRatio) {
      // 셀렉터는 찾았으나 신뢰도 미달 → 승인 큐에 저장
      const confidenceScore = Math.round(confidence * 1000) / 10;
      db.results.updateLastScore(scraperId, confidenceScore);
      db.scrapers.update({
        id: scraperId, status: 'pending',
        score: confidenceScore,
        last_value: '—', last_run_at: now,
        healed_count: current.healed, css_selector: scraper.css_selector,
      });
      db.proposals.insert({
        scraper_id:        scraperId,
        scraper_name:      scraper.name,
        old_selector:      scraper.css_selector,
        proposed_selector: result.robust_selector || '',
        extracted_text:    result.extracted_text  || '',
        confidence:        confidence,
        reasoning:         result.reasoning       || '',
      });
      console.log(`[healer] 신뢰도 미달 (${Math.round(confidence * 100)}% < ${scraper.threshold}%) → 승인 큐 저장`);
      return { status: 'pending', confidence, reason: '신뢰도 미달 — 수동 승인 필요' };

    } else {
      // status가 'failed' 또는 'no_change_needed' — 치유 자체가 불가
      const reason = result.reason || `Python 응답: ${result.status}`;
      db.scrapers.update({
        id: scraperId, status: 'failed',
        score: current.score, last_value: '—', last_run_at: now,
        healed_count: current.healed, css_selector: scraper.css_selector,
      });
      console.log(`[healer] 치유 불가 — ${reason}`);
      return { status: 'failed', reason };
    }
  } catch (e) {
    db.scrapers.update({
      id: scraperId, status: 'failed', score: current.score,
      last_value: '—', last_run_at: now,
      healed_count: current.healed, css_selector: scraper.css_selector,
    });
    console.error(`[healer] 오류: ${e.message}`);
    return { status: 'error', reason: e.message };
  }
}

module.exports = { runScraper };
