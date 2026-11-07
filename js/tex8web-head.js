// tex8web: inline at the top of <head> (page.lua), so that the reader's
// theme and hidden table of contents (which tex8web-page.js keeps) apply
// before the page is drawn, pagereveal, which fires before then, is heard,
// and the fonts' preloads start with the first bytes of the page.
// (tex8web-top: the page starts at its top, which tex8web-page.js keeps true)
document.documentElement.classList.add('tex8web-js', 'tex8web-top');
try {
  const theme = localStorage.getItem('tex8web-theme');
  if (theme) document.documentElement.dataset.theme = theme;
  if (localStorage.getItem('tex8web-contents') === 'hidden') {
    document.documentElement.classList.add('tex8web-toc-hidden');
  }
} catch {}

// the page's fonts, which assets.lua and prerender.mjs list in this script's
// data-fonts, preloaded: fetched as the page starts loading, not as each is
// first laid out. Not from a file: Safari refuses the preloads there (no
// CORS headers to pass), and its @font-face loads reuse the refusals, so
// every face stays unloaded
if (location.protocol !== 'file:') {
  for (const href of document.currentScript.dataset.fonts?.match(/\S+/g) ?? []) {
    const link = document.createElement('link');
    Object.assign(link, { rel: 'preload', as: 'font', type: 'font/woff2', crossOrigin: '', href });
    document.head.append(link);
  }
}

// the change from one of a site's tex8web pages to another (css/tex8web.css's
// @view-transition): back when it's to the page above (\WebUp) or the
// browser goes back in history, or else forward. The page left knows
// which, and tells the page it leads to
{
  // (as tex8web-page.js's)
  const page = url => url.split('#')[0].replace(/\/index\.html$/, '/');
  addEventListener('pageswap', event => {
    const { entry, from, navigationType } = event.activation ?? {};
    if (!event.viewTransition || !entry) return;
    const up = document.querySelector('.tex8web-up');
    const back = up && page(entry.url) === page(up.href)
      || navigationType === 'traverse' && entry.index < from?.index;
    const to = page(entry.url), type = back ? 'back' : 'forward';
    try { sessionStorage.setItem('tex8web-transition', JSON.stringify({ to, type })); } catch {}
  });
  addEventListener('pagereveal', event => {
    try {
      const { to, type } = JSON.parse(sessionStorage.getItem('tex8web-transition')) ?? {};
      sessionStorage.removeItem('tex8web-transition');
      if (event.viewTransition && to === page(location.href)) event.viewTransition.types.add(`tex8web-${type}`);
    } catch {}
  });
}
