// 브라우저 컨텍스트(page.$eval/page.evaluate)에서 직접 실행되는 함수라 Node 쪽
// 클로저를 참조하면 안 된다 — el 인자와 브라우저 전역(document)만 사용해야 한다.
// server.js는 이 함수의 소스(.toString())를 페이지에 주입되는 스크립트 문자열에
// 그대로 끼워넣어 쓰고, scraper.js는 함수 자체를 page.$eval에 직접 넘겨 쓴다.
// 두 군데가 항상 같은 로직을 쓰도록 소스를 한 곳에서만 관리한다.
//
// 토스증권처럼 "카드 전체를 덮는 투명 <a>가 클릭 타겟이고, 진짜 보이는 텍스트는
// 없이 data-content-value/aria-label에만 값이 들어있는" 케이스가 있다 — 이럴 땐
// textContent가 비어있어도 접근성 속성/로깅용 data 속성에서 값을 찾아본다.
function extractDisplayText(el) {
  const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');

  const text = clean(el.textContent);
  if (text) return text;

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return clean(ariaLabel);

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const joined = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((n) => clean(n.textContent))
      .filter(Boolean)
      .join(' ');
    if (joined) return joined;
  }

  for (const attr of ['data-content-value', 'data-value', 'data-text', 'data-label']) {
    const v = el.getAttribute(attr);
    if (v) return clean(v);
  }

  const title = el.getAttribute('title');
  if (title) return clean(title);

  return '';
}

module.exports = { extractDisplayText };
