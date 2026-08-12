// If the selector picker (server.js) and the actual scraper (scraper.js) open
// the page with different viewports, a responsive site (e.g. Toss Securities)
// can render a completely different DOM structure — this was the cause of
// selectors chosen in the picker failing with "element not found" when the
// actual scraper ran. This value is managed in one place so both sides
// always use the same viewport.
const VIEWPORT = { width: 960, height: 600 };

module.exports = { VIEWPORT };
