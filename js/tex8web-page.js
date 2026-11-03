// tex8web's page in the browser: the theme button, the controls' bar on a
// narrow screen, footnotes lined up with their marks, the table of contents
// following the section being read, and previews of what a link on the
// page leads to. page.lua and text.lua build what this works on (and
// page.lua marks <html> tex8web-js before the page is drawn), and the page
// reads fine without it (css/tex8web.css).
(() => {
  const root = document.documentElement;
  const target = a => document.getElementById(decodeURIComponent(a.hash.slice(1)));

  // the theme: light or dark as the reader last chose, on any tex8web page
  // (a script in <head> applies it before the page is drawn), or else as
  // the system is; the page fades from one to the other, unless the reader
  // would rather not
  function theme() {
    const button = document.querySelector('.tex8web-theme');
    if (!button) return;
    const system = matchMedia('(prefers-color-scheme: dark)');
    const current = () => root.dataset.theme || (system.matches ? 'dark' : 'light');
    const label = () => {
      const other = current() === 'dark' ? 'light' : 'dark';
      button.title = `Switch to ${other} mode`;
      button.setAttribute('aria-label', button.title);
    };
    const motion = matchMedia('(prefers-reduced-motion: no-preference)');
    const flip = () => {
      root.dataset.theme = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('tex8web-theme', root.dataset.theme); } catch {}
      label();
    };
    button.addEventListener('click', () => {
      if (document.startViewTransition && motion.matches) document.startViewTransition(flip);
      else flip();
    });
    system.addEventListener('change', label);
    label();
    button.hidden = false;
  }

  // the controls, in a bar across the top on a narrow screen
  // (css/tex8web.css): out of the way while the reader scrolls down, back as
  // soon as they scroll up
  function bar() {
    const controls = document.querySelector('.tex8web-controls');
    if (!controls) return;
    let last = scrollY;
    addEventListener('scroll', () => {
      controls.classList.toggle('tex8web-away', scrollY > last && scrollY > controls.offsetHeight);
      last = scrollY;
    }, { passive: true });
  }

  // footnotes beside the text (css/tex8web.css floats them there on a wide
  // screen): each level with its mark, or below the one above it; again
  // whenever the page's layout changes (pictures, fonts, the width)
  function sidenotes() {
    const notes = [...document.querySelectorAll('.tex8web-sidenote')]
      .map(note => {
        const back = note.querySelector('.footnote-mark a');
        return { note, mark: back && target(back) };
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
  }

  // the table of contents: the entry of the section being read (the last
  // heading above the top quarter of the screen) is marked, and its
  // section's subsections shown; as a drawer, it closes on following a link
  function contents() {
    const toc = document.getElementById('tex8web-toc');
    if (!toc) return;
    const entries = [...toc.querySelectorAll('a[href^="#"]')]
      .map(a => ({ a, heading: target(a) }))
      .filter(entry => entry.heading);
    if (!entries.length) return;
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
  }

  // previews: pointing at (or focusing, with the keyboard) a link to
  // something on the page, a \ref, \eqref, \cite, footnote mark or section,
  // shows a copy of it in a card; on a touch screen the first tap shows it
  // and the second follows the link
  const here = a => a.pathname === location.pathname && a.hash && target(a);
  const previewable = 'a[href*="#"]:not(.tex8web-permalink, #tex8web-toc a, .footnotetext .footnote-mark a, .tex8web-preview a)';
  const blank = el => !el.textContent.trim() && !el.querySelector('img, svg, mjx-container');

  // what a link leads to: a theorem, box or table, an equation (tex4ht's
  // anchor is just before it), a reference (its label and entry), a figure,
  // a footnote, or a heading and what follows it
  function previewOf(a) {
    let el = target(a);
    const next = el.nextElementSibling;
    if (el.matches('a:empty') && next?.matches('.mathjax-env, .mathjax-block')) return [next];
    const heading = el.closest('h1, h2, h3, h4, h5, h6');
    if (heading) {
      let after = heading.nextElementSibling;
      while (after && blank(after)) after = after.nextElementSibling;
      return [heading, after].filter(Boolean);
    }
    el = el.closest('.newtheorem, .tcolorbox, .table, figure, aside, dt, dd, li') || el;
    if (el.matches('dt') && el.nextElementSibling?.matches('dd')) return [el, el.nextElementSibling];
    if (el.matches('dd') && el.previousElementSibling?.matches('dt')) return [el.previousElementSibling, el];
    return [el];
  }

  // a copy of el for the card: without ids, which the page has already,
  // but a box's, which its colors and frame hang on (the card comes last on
  // the page, so the id still finds the box); and as a footnote in the
  // text, not beside it
  function copyOf(el) {
    const copy = el.cloneNode(true);
    if (!copy.matches('.tcolorbox')) copy.removeAttribute('id');
    copy.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
    copy.querySelectorAll('.tex8web-permalink').forEach(child => child.remove());
    copy.classList.remove('tex8web-sidenote');
    copy.style.top = '';
    return copy;
  }

  function previews() {
    const card = document.createElement('div');
    card.className = 'tex8web-preview';
    card.id = 'tex8web-preview';
    card.popover = 'manual';
    card.setAttribute('role', 'tooltip');
    document.body.append(card);
    let shown, timer;
    const hide = () => {
      clearTimeout(timer);
      if (!shown) return;
      shown.removeAttribute('aria-describedby');
      card.hidePopover();
      shown = null;
    };
    const show = a => {
      hide();
      card.replaceChildren(...previewOf(a).map(copyOf));
      card.style.left = card.style.top = '0';
      card.showPopover();
      const link = a.getBoundingClientRect(), width = card.offsetWidth, height = card.offsetHeight;
      const below = link.bottom + 6 + height <= innerHeight || link.top - 6 - height < 0;
      // (from the link, but over the text: past the body's right edge by 16px
      // at most)
      const text = document.body.getBoundingClientRect();
      const left = Math.max(text.left, Math.min(link.left, text.right + 16 - width));
      card.style.left = `${Math.max(8, Math.min(left, root.clientWidth - width - 8))}px`;
      card.style.top = `${below ? link.bottom + 6 : link.top - 6 - height}px`;
      a.setAttribute('aria-describedby', card.id);
      shown = a;
    };
    const link = el => {
      const a = el.closest?.(previewable);
      return a && here(a) ? a : null;
    };
    document.addEventListener('pointerover', event => {
      const a = link(event.target);
      if (event.pointerType === 'touch' || !(a || card.contains(event.target))) return;
      clearTimeout(timer);
      if (a && a !== shown) timer = setTimeout(() => show(a), 300);
    });
    document.addEventListener('pointerout', event => {
      const to = event.relatedTarget;
      if (!link(event.target) && !card.contains(event.target)) return;
      if (to && (card.contains(to) || link(to) === shown)) return;
      clearTimeout(timer);
      timer = setTimeout(hide, 200);
    });
    document.addEventListener('focusin', event => {
      const a = link(event.target);
      if (a && a.matches(':focus-visible')) show(a);
      else if (!card.contains(event.target)) hide();
    });
    let touch = false;
    document.addEventListener('pointerdown', event => { touch = event.pointerType === 'touch'; });
    document.addEventListener('click', event => {
      const a = link(event.target);
      if (a && touch && a !== shown) {
        event.preventDefault();
        show(a);
      } else if (!card.contains(event.target)) {
        hide();
      }
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    // (but not for the scroll that brings a focused link into view)
    addEventListener('scroll', () => { if (shown !== document.activeElement) hide(); }, { passive: true });
  }

  theme();
  bar();
  sidenotes();
  contents();
  previews();
})();
