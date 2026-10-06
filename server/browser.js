// Every Chromium launch goes through here: scheduled/manual scrapes
// (scraper.js), the picker's page fetch, and the live picker session.
//
// Why a failed launch ends the process: on 2026-09-29 Chromium stopped
// launching on the server (2GB box, swap already in use) and this process
// stayed up, answering every request with
// "browserType.launch: Target page, context or browser has been closed".
// Nothing crashed, so `restart: unless-stopped` never fired, Spring recorded
// nothing, and collection was dead for seven days while the dashboard stayed
// green. Exiting hands the problem to Docker's restart policy, which brings a
// working browser back in seconds — a loud restart loop beats silent death.
const { chromium } = require('playwright');

// One retry first: a launch can lose a race with a transient memory spike, and
// restarting the whole process over that would drop the other requests in
// flight along with it.
const RETRY_DELAY_MS = 3000;

// Enough delay for the log line above to flush before the process goes away.
const EXIT_DELAY_MS = 100;

const state = { lastOkAt: null, lastError: null, consecutiveFailures: 0 };

function recordOk() {
  state.lastOkAt = new Date().toISOString();
  state.lastError = null;
  state.consecutiveFailures = 0;
}

async function launchBrowser(options = {}) {
  const opts = { headless: true, ...options };
  try {
    const browser = await chromium.launch(opts);
    recordOk();
    return browser;
  } catch (first) {
    state.consecutiveFailures += 1;
    state.lastError = first.message;
    console.error(
      `[browser] launch failed, retrying in ${RETRY_DELAY_MS}ms: ${first.message}`,
    );
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      const browser = await chromium.launch(opts);
      console.log('[browser] launch recovered on retry');
      recordOk();
      return browser;
    } catch (second) {
      state.consecutiveFailures += 1;
      state.lastError = second.message;
      console.error(
        `[browser] launch failed twice — exiting so the container restarts: ${second.message}`,
      );
      setTimeout(() => process.exit(1), EXIT_DELAY_MS).unref();
      // Thrown rather than swallowed so the caller's finally still releases its
      // browser semaphore permit and answers its request before we go down.
      throw second;
    }
  }
}

/** Launch state for /internal/health — "has a browser started here recently." */
function browserHealth() {
  return { ...state };
}

module.exports = { launchBrowser, browserHealth };
