// tex8web: loaded in <head> without defer (page.lua), so that the reader's
// theme and hidden table of contents, saved by tex8web-page.js, apply before
// the page is drawn, and the pagereveal listener exists before pagereveal
// fires. tex8web-top marks the page as scrolled to its top; tex8web-page.js
// updates the class on scroll.
document.documentElement.classList.add('tex8web-js', 'tex8web-top');
try {
  const theme = localStorage.getItem('tex8web-theme');
  if (theme) document.documentElement.dataset.theme = theme;
  if (localStorage.getItem('tex8web-contents') === 'hidden') {
    document.documentElement.classList.add('tex8web-toc-hidden');
  }
} catch {}

// direction of the view transition between two tex8web pages of a site
// (@view-transition in css/tex8web.css): back to the page above (\WebUp) or
// back in history, else forward. The direction is known only on the old
// page, so the pageswap handler stores it in sessionStorage for the new one.
{
  // as in tex8web-page.js
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
