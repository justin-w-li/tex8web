// tex8web: loaded in <head> without defer (page.lua), so that the reader's
// theme and hidden table of contents (which tex8web-page.js keeps) apply
// before the page is drawn, and so that pagereveal, which fires before
// then, is heard.
document.documentElement.classList.add('tex8web-js');
try {
  const theme = localStorage.getItem('tex8web-theme');
  if (theme) document.documentElement.dataset.theme = theme;
  if (localStorage.getItem('tex8web-contents') === 'hidden') {
    document.documentElement.classList.add('tex8web-toc-hidden');
  }
} catch {}

// the change from one of a site's tex8web pages to another (css/tex8web.css's
// @view-transition): back when it's to the page above (\WebUp), or else
// forward. The page left knows which, and tells the page it leads to
{
  // (as tex8web-page.js's)
  const page = url => url.split('#')[0].replace(/\/index\.html$/, '/');
  addEventListener('pageswap', event => {
    const to = event.activation?.entry.url;
    if (!event.viewTransition || !to) return;
    const up = document.querySelector('.tex8web-up');
    const type = up && page(to) === page(up.href) ? 'back' : 'forward';
    try { sessionStorage.setItem('tex8web-transition', JSON.stringify({ to: page(to), type })); } catch {}
  });
  addEventListener('pagereveal', event => {
    try {
      const { to, type } = JSON.parse(sessionStorage.getItem('tex8web-transition')) ?? {};
      sessionStorage.removeItem('tex8web-transition');
      if (event.viewTransition && to === page(location.href)) event.viewTransition.types.add(`tex8web-${type}`);
    } catch {}
  });
}
