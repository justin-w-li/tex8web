// tex8web's page in the browser: the theme button, footnotes lined up
// with their marks, and the table of contents following the section being
// read. page.lua and text.lua build what this works on (and page.lua marks
// <html> tex8web-js before the page is drawn), and the page reads fine
// without it (css/tex8web.css).
(() => {
  const root = document.documentElement;

  // the theme: light or dark as the reader last chose, on any tex8web page
  // (a script in <head> applies it before the page is drawn), or else as
  // the system is
  const button = document.querySelector('.tex8web-theme');
  if (button) {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const theme = () => root.dataset.theme || (system.matches ? 'dark' : 'light');
    const label = () => {
      const other = theme() === 'dark' ? 'light' : 'dark';
      button.title = `Switch to ${other} mode`;
      button.setAttribute('aria-label', button.title);
    };
    button.addEventListener('click', () => {
      root.dataset.theme = theme() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('tex8web-theme', root.dataset.theme); } catch {}
      label();
    });
    system.addEventListener('change', label);
    label();
    button.hidden = false;
  }

  // footnotes beside the text (css/tex8web.css floats them there on a wide
  // screen): each level with its mark, or below the one above it; again
  // whenever the page's layout changes (pictures, fonts, the width)
  const notes = [...document.querySelectorAll('.tex8web-sidenote')]
    .map(note => {
      const hash = note.querySelector('.footnote-mark a')?.hash.slice(1);
      return { note, mark: hash && document.getElementById(decodeURIComponent(hash)) };
    })
    .filter(({ mark }) => mark);
  const place = () => {
    for (const { note } of notes) note.style.top = '';
    const tops = notes.map(({ note, mark }) => getComputedStyle(note).float === 'none' ? null : {
      at: note.getBoundingClientRect().top, mark: mark.getBoundingClientRect().top,
      height: note.offsetHeight + parseFloat(getComputedStyle(note).marginBottom) });
    let below = -Infinity;
    tops.forEach((top, i) => {
      if (!top) return;
      const want = Math.max(top.mark, below);
      notes[i].note.style.top = `${want - top.at}px`;
      below = want + top.height;
    });
  };
  if (notes.length) new ResizeObserver(place).observe(document.body);

  // the table of contents: the entry of the section being read (the last
  // heading above the top quarter of the screen) is marked, and its
  // section's subsections shown; as a drawer, it closes on following a link
  const toc = document.getElementById('tex8web-toc');
  if (!toc) return;
  const entries = [...toc.querySelectorAll('a[href^="#"]')]
    .map(a => ({ a, heading: document.getElementById(decodeURIComponent(a.hash.slice(1))) }))
    .filter(entry => entry.heading);
  const isSection = el => el.matches('.sectionToc, .likesectionToc, .chapterToc, .likechapterToc');
  let current;
  const update = () => {
    const line = innerHeight / 4;
    let reading = entries[0];
    for (const entry of entries) {
      if (entry.heading.getBoundingClientRect().top > line) break;
      reading = entry;
    }
    if (reading === current) return;
    current?.a.removeAttribute('aria-current');
    toc.querySelectorAll('.tex8web-open').forEach(el => el.classList.remove('tex8web-open'));
    current = reading;
    current.a.setAttribute('aria-current', 'location');
    // (tex4ht's entries are siblings: a section's, then its subsections')
    let section = current.a.closest('.tableofcontents > span');
    while (section && !isSection(section)) section = section.previousElementSibling;
    for (let el = section; el; el = el.nextElementSibling) {
      if (el !== section && isSection(el)) break;
      el.classList.add('tex8web-open');
    }
    const a = current.a.getBoundingClientRect(), box = toc.getBoundingClientRect();
    if (a.top < box.top || a.bottom > box.bottom) toc.scrollTop += a.top - box.top - box.height / 3;
  };
  let pending = false;
  addEventListener('scroll', () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; update(); });
  }, { passive: true });
  update();
  toc.addEventListener('click', event => {
    if (event.target.closest('a') && toc.matches(':popover-open')) toc.hidePopover();
  });
})();
