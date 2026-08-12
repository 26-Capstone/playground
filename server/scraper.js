const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { browserSemaphore } = require('./browserLimiter');
const { extractDisplayText } = require('./extractText');
const { VIEWPORT } = require('./viewport');

const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');

// Spring calls this with { id, name, url, css_selector, user_intent, extra_fields }.
// extra_fields is optional — an array of [{label, selector}, ...] for auxiliary
// fields tracked alongside the primary one on the same page (e.g. track name,
// stock status). A failure in one field is non-fatal and doesn't affect
// extraction of the others. extraValues is returned in the same order as
// extra_fields — Spring merges by index using this ordering, so preserving
// order is an invariant.
// We force a return with margin to spare before Spring's RestTemplate
// readTimeout (90s, spring-server AppConfig.java). Previously, goto(45s) +
// primary selector (15s) + 15s sequentially for each extra_field could stack
// up past 90s once 2+ fields were broken. Spring would silently discard the
// result on timeout, while node had no idea and kept running to completion,
// holding onto a browser semaphore slot the whole time. Waiting only as long
// as the remaining budget allows guarantees we always return within this
// window.
const SCRAPE_BUDGET_MS = 75000;

// waitForSelector only checks "does this tag exist in the DOM" — for pages
// like Toss Securities that render an empty skeleton first and only fill in
// text/attributes after live data arrives, the wait would pass the instant
// the element exists and extract an empty value (no extractError in the
// failure log, just an empty value — since no exception was thrown, we
// couldn't distinguish "found but empty" from a real match). This is changed
// to wait not just for "does the element exist" but for "is there actually
// text to extract."
const WAIT_FOR_CONTENT_FN_SRC = `
(function(sel) {
  ${extractDisplayText.toString()}
  const el = document.querySelector(sel);
  if (!el) return false;
  return !!extractDisplayText(el);
})
`;

async function waitForContent(page, selector, timeoutMs) {
  await page
    .waitForFunction(new Function('sel', `return (${WAIT_FOR_CONTENT_FN_SRC})(sel)`), selector, {
      timeout: timeoutMs,
    })
    .catch(() => {});
}

async function runScraper({ id, name, url, css_selector, user_intent, extra_fields }) {
  const fullUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const start = Date.now();
  await browserSemaphore.acquire(); // Limit concurrent Chromium instances (avoid OOM)
  let browser;

  const deadline = start + SCRAPE_BUDGET_MS;
  // timeout: 0 means "wait forever" in Playwright, so always leave at least 1s.
  const boundedTimeout = (max) => Math.max(1000, Math.min(max, deadline - Date.now()));

  let html = '';
  let value = '';
  let extractError = null;
  const extraValues = [];

  try {
    // If launch were outside the try block, a failure would skip finally and
    // leak the semaphore permit permanently (with MAX_CONCURRENT_BROWSERS=2,
    // just 2 failures would make every subsequent run wait forever).
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      viewport: VIEWPORT, // Same viewport as the selector picker — a mismatch yields a different DOM on responsive pages
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: boundedTimeout(45000) });

    try {
      // The primary field waits using as much of the remaining budget as
      // possible — heavy pages like Toss Securities, where rows only render
      // after live data loads, sometimes needed more than 15s (in practice,
      // one run waited the full 15s out of 22945ms and still failed —
      // giving up with 52 of the 75s budget still unused). extra_fields are
      // supplementary, so they keep the original short 15s wait.
      if (deadline - Date.now() > 1000) {
        await waitForContent(page, css_selector, boundedTimeout(40000));
      }
      value = (await page.$eval(css_selector, extractDisplayText)).slice(0, 200);
    } catch (e) {
      extractError = e.message;
    }

    for (const field of extra_fields || []) {
      let fieldValue = '';
      let fieldError = null;
      try {
        if (deadline - Date.now() > 1000) {
          await waitForContent(page, field.selector, boundedTimeout(15000));
        }
        fieldValue = (await page.$eval(field.selector, extractDisplayText)).slice(0, 200);
      } catch (e) {
        fieldError = e.message;
      }
      extraValues.push({ label: field.label, value: fieldValue || '', error: fieldError });
    }

    html = await page.content();

    // Refresh the V1 snapshot on selector success (Spring uses this as v1_html on heal calls)
    if (value && !extractError) {
      fs.writeFileSync(path.join(SNAPSHOTS_DIR, `${id}_v1.html`), html, 'utf-8');
    }
  } finally {
    await browser?.close().catch(() => {});
    browserSemaphore.release();
  }

  const durationMs = Date.now() - start;
  const succeeded = !!value && !extractError;

  console.log(`[scraper] ${name} → ${succeeded ? `success: "${value}"` : `failed: ${extractError}`} (${durationMs}ms)`);
  for (const ev of extraValues) {
    console.log(`[scraper] ${name} (${ev.label}) → ${ev.value && !ev.error ? `success: "${ev.value}"` : `failed: ${ev.error}`}`);
  }

  return {
    status:      succeeded ? 'healthy' : 'failed',
    value:       value || '',
    html,           // Used by Spring as v2_html in heal requests on failure
    durationMs,
    error:       extractError || null,
    extraValues, // [{label, value, error}] — same order as extra_fields
  };
}

module.exports = { runScraper };
