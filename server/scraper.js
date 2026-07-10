const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { browserSemaphore } = require('./browserLimiter');

const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');

// Spring이 { id, name, url, css_selector, user_intent, extra_fields } 를 담아 호출
// extra_fields는 옵션 — [{label, selector}, ...] 배열. 같은 페이지에서 같이 추적하는
// 보조 필드(예: 곡명, 재고 상태)용. 개별 필드가 실패해도 다른 필드 추출에는 영향을
// 주지 않는다(non-fatal). extraValues는 extra_fields와 같은 순서로 반환된다 —
// Spring이 이 순서를 이용해 인덱스 기준으로 병합하므로 순서 보장이 불변식이다.
async function runScraper({ id, name, url, css_selector, user_intent, extra_fields }) {
  const fullUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const start = Date.now();
  await browserSemaphore.acquire(); // 동시 Chromium 실행 수 제한 (OOM 방지)
  const browser = await chromium.launch({ headless: true });

  let html = '';
  let value = '';
  let extractError = null;
  const extraValues = [];

  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    try {
      await page.waitForSelector(css_selector, { timeout: 15000 }).catch(() => {});
      value = await page.$eval(
        css_selector,
        el => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200)
      );
    } catch (e) {
      extractError = e.message;
    }

    for (const field of extra_fields || []) {
      let fieldValue = '';
      let fieldError = null;
      try {
        await page.waitForSelector(field.selector, { timeout: 15000 }).catch(() => {});
        fieldValue = await page.$eval(
          field.selector,
          el => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200)
        );
      } catch (e) {
        fieldError = e.message;
      }
      extraValues.push({ label: field.label, value: fieldValue || '', error: fieldError });
    }

    html = await page.content();

    // 셀렉터 성공 시 V1 스냅샷 갱신 (Spring이 heal 호출 시 v1_html로 사용)
    if (value && !extractError) {
      fs.writeFileSync(path.join(SNAPSHOTS_DIR, `${id}_v1.html`), html, 'utf-8');
    }
  } finally {
    await browser.close();
    browserSemaphore.release();
  }

  const durationMs = Date.now() - start;
  const succeeded = !!value && !extractError;

  console.log(`[scraper] ${name} → ${succeeded ? `성공: "${value}"` : `실패: ${extractError}`} (${durationMs}ms)`);
  for (const ev of extraValues) {
    console.log(`[scraper] ${name} (${ev.label}) → ${ev.value && !ev.error ? `성공: "${ev.value}"` : `실패: ${ev.error}`}`);
  }

  return {
    status:      succeeded ? 'healthy' : 'failed',
    value:       value || '',
    html,           // 실패 시 Spring이 v2_html로 heal 요청에 사용
    durationMs,
    error:       extractError || null,
    extraValues, // [{label, value, error}] — extra_fields와 같은 순서
  };
}

module.exports = { runScraper };
