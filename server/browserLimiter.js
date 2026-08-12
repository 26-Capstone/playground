// Limits the number of concurrent Chromium instances.
// This is a safeguard added after an incident where overlapping scheduled runs
// spun up multiple instances at once and the OOM killer force-killed
// chrome-headless on an EC2 instance (2GB RAM).
// runScraper (scheduled/manual runs), /internal/fetch-html, and the live
// selector picker (WS) all share this semaphore, so concurrency is capped
// process-wide.
class Semaphore {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }

  acquire() {
    return new Promise((resolve) => {
      const attempt = () => {
        if (this.active < this.max) {
          this.active++;
          resolve();
        } else {
          this.queue.push(attempt);
        }
      };
      attempt();
    });
  }

  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const MAX_CONCURRENT_BROWSERS = parseInt(
  process.env.MAX_CONCURRENT_BROWSERS || '2',
  10,
);
const browserSemaphore = new Semaphore(MAX_CONCURRENT_BROWSERS);

module.exports = { browserSemaphore, MAX_CONCURRENT_BROWSERS };
