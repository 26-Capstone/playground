const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');

// Spring이 { id, name, url, css_selector, user_intent, extra_selector } 를 담아 호출
// extra_selector는 옵션 — 같은 페이지에서 같이 추적하는 보조 필드(예: 곡명)용 셀렉터.
// 실패해도 primary 추출 결과에는 영향을 주지 않는다(non-fatal).
async function runScraper({ id, name, url, css_selector, user_intent, extra_selector }) {
  const fullUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const start = Date.now();
  const browser = await chromium.launch({ headless: true });

  let html = '';
  let value = '';
  let extractError = null;
  let extraValue = '';
  let extraError = null;

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

    if (extra_selector) {
      try {
        await page.waitForSelector(extra_selector, { timeout: 15000 }).catch(() => {});
        extraValue = await page.$eval(
          extra_selector,
          el => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200)
        );
      } catch (e) {
        extraError = e.message;
      }
    }

    html = await page.content();

    // 셀렉터 성공 시 V1 스냅샷 갱신 (Spring이 heal 호출 시 v1_html로 사용)
    if (value && !extractError) {
      fs.writeFileSync(path.join(SNAPSHOTS_DIR, `${id}_v1.html`), html, 'utf-8');
    }
  } finally {
    await browser.close();
  }

  const durationMs = Date.now() - start;
  const succeeded = !!value && !extractError;

  console.log(`[scraper] ${name} → ${succeeded ? `성공: "${value}"` : `실패: ${extractError}`} (${durationMs}ms)`);
  if (extra_selector) {
    console.log(`[scraper] ${name} (보조 필드) → ${extraValue && !extraError ? `성공: "${extraValue}"` : `실패: ${extraError}`}`);
  }

  return {
    status:     succeeded ? 'healthy' : 'failed',
    value:      value || '',
    html,           // 실패 시 Spring이 v2_html로 heal 요청에 사용
    durationMs,
    error:      extractError || null,
    extraValue: extraValue || '',
    extraError: extraError || null,
  };
}

module.exports = { runScraper };
