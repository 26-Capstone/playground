// Chromium 인스턴스 동시 실행 개수를 제한한다.
// 스케줄 실행이 겹치면서 여러 개가 동시에 떠 EC2(RAM 2GB) 인스턴스에서
// OOM killer가 chrome-headless를 강제 종료한 사고가 있어 추가한 안전장치.
// runScraper(스케줄/수동 실행), /internal/fetch-html, 실시간 셀렉터 피커(WS)가
// 전부 이 세마포어를 공유해서 프로세스 전체 기준으로 동시 실행 수를 제한한다.
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
