// This function runs directly inside the browser context (page.$eval/page.evaluate),
// so it must not reference any Node-side closures — it can only use the el
// argument and browser globals (document). server.js embeds this function's
// source (.toString()) verbatim into the script string injected into the page,
// while scraper.js passes the function itself directly to page.$eval. The
// source is kept in this single place so both call sites always use the same
// logic.
//
// Some sites, like Toss Securities, have cases where a transparent <a> covers
// the entire card as the click target, with no real visible text — the value
// only lives in data-content-value/aria-label. In these cases, even when
// textContent is empty, we fall back to accessibility attributes and logging
// data attributes to find the value.
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
