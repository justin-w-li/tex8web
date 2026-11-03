// tex8web: loaded in <head> without defer (page.lua), so that the reader's
// theme and hidden table of contents (which tex8web-page.js keeps) apply
// before the page is drawn.
document.documentElement.classList.add('tex8web-js');
try {
  const theme = localStorage.getItem('tex8web-theme');
  if (theme) document.documentElement.dataset.theme = theme;
  if (localStorage.getItem('tex8web-contents') === 'hidden') {
    document.documentElement.classList.add('tex8web-toc-hidden');
  }
} catch {}
