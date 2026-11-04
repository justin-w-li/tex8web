// tex8web's page in the browser: the theme button, the contents button on
// a wide screen, the controls' bar on a narrow screen, smooth scrolling to
// links, footnotes lined up with their marks, the table of contents
// following the section being read, previews of what a link on the page
// leads to, and a closer view of pictures. page.lua and text.lua build
// what this works on (and tex8web-head.js marks <html> tex8web-js before
// the page is drawn), and the page reads fine without it
// (css/tex8web.css).
(() => {
  const root = document.documentElement;
  const target = a => document.getElementById(decodeURIComponent(a.hash.slice(1)));
  const layout = () => getComputedStyle(root).getPropertyValue('--tex8web-layout').trim();
  // twice css/tex8web.css's --tex8web-fade (in seconds), in ms: a little
  // after the fades end
  const faded = () => 2000 * parseFloat(getComputedStyle(root).getPropertyValue('--tex8web-fade'));
  // an element's text, without the MathML MathJax may add for screen
  // readers, which repeats the formula
  const text = el => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('.tex8web-permalink, mjx-assistive-mml').forEach(node => node.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };
  // a link in the table of contents as its entry reads: number and title
  const entryText = a => [a.parentElement.querySelector('.tocnumber')?.textContent.trim(), text(a)]
    .filter(Boolean).join(' ');

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
  }

  // on a wide screen, the contents button hides or shows the column of
  // contents (css/tex8web.css), as the reader last chose on any tex8web
  // page (a script in <head> applies it before the page is drawn); on a
  // narrow one it opens the drawer, as its popovertarget does
  function column() {
    const button = document.querySelector('.tex8web-contents');
    if (!button) return;
    let timer;
    const label = () => {
      if (layout() !== 'wide') {
        button.title = 'Contents';
        button.removeAttribute('aria-expanded');
      } else {
        const hidden = root.classList.contains('tex8web-toc-hidden');
        button.title = hidden ? 'Show contents' : 'Hide contents';
        button.setAttribute('aria-expanded', String(!hidden));
      }
      button.setAttribute('aria-label', button.title);
    };
    button.addEventListener('click', event => {
      if (layout() !== 'wide') return;
      // (cancelling the click cancels the popovertarget's opening)
      event.preventDefault();
      clearTimeout(timer);
      root.classList.add('tex8web-toggling');
      timer = setTimeout(() => root.classList.remove('tex8web-toggling'), faded());
      const hidden = root.classList.toggle('tex8web-toc-hidden');
      try {
        if (hidden) localStorage.setItem('tex8web-contents', 'hidden');
        else localStorage.removeItem('tex8web-contents');
      } catch {}
      label();
    });
    addEventListener('resize', label);
    label();
  }

  // the controls, in a bar across the top on a narrow screen
  // (css/tex8web.css): out of the way while the reader scrolls down, back as
  // soon as they scroll up; and as the window goes from wide to narrow,
  // away (fading, as does the column of contents, css/tex8web.css), then
  // back only at the page's top
  function bar() {
    const controls = document.querySelector('.tex8web-controls');
    if (!controls) return;
    const motion = matchMedia('(prefers-reduced-motion: no-preference)');
    const top = () => scrollY <= controls.offsetHeight;
    let was = layout(), width = innerWidth, last = scrollY, timer;
    // (only on a narrow screen: the browser may restyle the page for a
    // narrow one before the resize event, and a bar already away would
    // then vanish there rather than fade; and not for the scrolling that
    // keeps the reader's place as the width changes. Safari on iOS bounces
    // past the page's ends and jitters a pixel or two back as its own bars
    // grow or shrink, so a turn counts only once it has gone 10px)
    addEventListener('scroll', () => {
      const end = document.documentElement.scrollHeight - innerHeight;
      if (innerWidth !== width) {
        width = innerWidth;
        last = scrollY;
      } else if (scrollY >= 0 && scrollY <= end && (Math.abs(scrollY - last) >= 10 || top())) {
        controls.classList.toggle('tex8web-away', was === 'narrow' && scrollY > last && !top());
        last = scrollY;
      }
    }, { passive: true });
    addEventListener('resize', () => {
      const now = layout();
      if (now === 'wide') {
        clearTimeout(timer);
        root.classList.remove('tex8web-narrowing');
        controls.classList.remove('tex8web-away');
      } else if (was === 'wide' && !motion.matches) {
        controls.classList.toggle('tex8web-away', !top());
      } else if (was === 'wide') {
        root.classList.add('tex8web-narrowing');
        controls.classList.add('tex8web-away');
        clearTimeout(timer);
        // (until the fades end, the drawer's and the bar's own styles would
        // show them)
        timer = setTimeout(() => {
          root.classList.remove('tex8web-narrowing');
          controls.classList.toggle('tex8web-away', !top());
        }, faded());
      }
      was = now;
    });
  }

  // following a link scrolls smoothly once the reader has followed one
  // (css/tex8web.css): not the browser going back to their place as the
  // page reloads
  function smooth() {
    document.addEventListener('click', event => {
      if (event.target.closest?.('a[href*="#"]')) root.classList.add('tex8web-smooth');
    });
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
  // section's subsections shown, and on a narrow screen it's in the bar
  // (css/tex8web.css), once the first heading is read; as a drawer, it
  // closes on following a link
  function contents() {
    const toc = document.getElementById('tex8web-toc');
    if (!toc) return;
    const entries = [...toc.querySelectorAll('a[href^="#"]')]
      .map(a => ({ a, heading: target(a) }))
      .filter(entry => entry.heading);
    if (!entries.length) return;
    const where = document.querySelector('.tex8web-where');
    const isSection = el => el.matches('.sectionToc, .likesectionToc, .chapterToc, .likechapterToc');
    let current;
    const update = () => {
      const line = innerHeight / 4;
      let reading = entries[0];
      for (const entry of entries) {
        if (entry.heading.getBoundingClientRect().top > line) break;
        reading = entry;
      }
      if (where) where.hidden = reading.heading.getBoundingClientRect().top > line;
      if (reading === current) return;
      current?.a.removeAttribute('aria-current');
      toc.querySelectorAll('.tex8web-open').forEach(el => el.classList.remove('tex8web-open'));
      current = reading;
      current.a.setAttribute('aria-current', 'location');
      if (where) where.textContent = entryText(current.a);
      // (tex4ht's entries are siblings: a section's, then its subsections')
      let section = current.a.closest('.tableofcontents > span');
      while (section && !isSection(section)) section = section.previousElementSibling;
      for (let el = section; el; el = el.nextElementSibling) {
        if (el !== section && isSection(el)) break;
        el.classList.add('tex8web-open');
      }
      // (not while the filter's results stand in for the entries)
      const a = current.a.getBoundingClientRect(), box = toc.getBoundingClientRect();
      if (a.height && (a.top < box.top || a.bottom > box.bottom)) toc.scrollTop += a.top - box.top - box.height / 3;
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

  // the contents' filter: in place of the entries, the headings, theorems
  // and terms (\WebTerm) whose text has every word typed, ignoring case,
  // accents and the style of MathJax's letters (𝜎 is σ); Enter follows
  // the first
  function filter() {
    const toc = document.getElementById('tex8web-toc');
    const input = toc?.querySelector('.tex8web-toc-filter');
    if (!input) return;
    const list = toc.querySelector('.tableofcontents');
    const results = document.createElement('ol');
    results.className = 'tex8web-toc-results';
    results.hidden = true;
    list.after(results);
    const fold = s => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    // (on first use, as the math is typeset by then if MathJax runs in the
    // browser)
    let items;
    function collect() {
      const all = [];
      for (const a of list.querySelectorAll('a[href^="#"]')) {
        const el = target(a);
        if (el) all.push({ el, href: a.hash, kind: 'heading', label: entryText(a) });
      }
      for (const link of document.querySelectorAll('.newtheorem .head > .tex8web-permalink')) {
        all.push({ el: link.parentElement, href: link.hash, kind: 'theorem',
          label: text(link.parentElement).replace(/\.$/, '') });
      }
      // (not one in a heading or a theorem's head, which is found as that)
      for (const term of document.querySelectorAll('.tex8web-term[id]')) {
        if (!term.closest('h2, h3, h4, h5, h6, .head')) all.push({ el: term, href: `#${term.id}`, kind: 'term', label: text(term) });
      }
      all.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      // (a term is shown with the theorem it's in, or else its section, and
      // once there)
      let heading, theorem;
      const seen = new Set();
      return all.filter(item => {
        item.key = fold(item.label);
        if (item.kind === 'heading') heading = item;
        else if (item.kind === 'theorem') theorem = item;
        else if (theorem && item.el.closest('.newtheorem') === theorem.el.closest('.newtheorem')) item.where = theorem.label;
        else item.where = heading?.label;
        if (item.kind !== 'term') return true;
        const once = `${item.key}\n${item.where}`;
        return !seen.has(once) && seen.add(once);
      });
    }
    const row = item => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      if (item.where) {
        const where = document.createElement('span');
        where.className = 'tex8web-toc-where';
        where.textContent = item.where;
        a.append(' ', where);
      }
      li.append(a);
      return li;
    };
    input.addEventListener('input', () => {
      const words = fold(input.value).split(/\s+/).filter(Boolean);
      list.hidden = words.length > 0;
      results.hidden = !words.length;
      if (!words.length) return;
      items ??= collect();
      const found = items.filter(item => words.every(word => item.key.includes(word)));
      const none = document.createElement('li');
      none.className = 'tex8web-toc-none';
      none.textContent = 'No matches';
      results.replaceChildren(...(found.length ? found.map(row) : [none]));
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing && !results.hidden) results.querySelector('a')?.click();
    });
    input.hidden = false;
  }

  // the reader's place: the last heading or theorem above the top of the
  // screen as they leave the page, gone back to when they next open it,
  // but not as it reloads or they go back to it, when the browser keeps
  // their place, nor when a link leads somewhere on it
  function place() {
    const key = `tex8web-place:${location.pathname}`;
    // (where it's put back, a little below the top, still counts as above
    // it, so that opening the page and leaving keeps the place)
    const below = () => parseFloat(getComputedStyle(root).fontSize);
    const save = () => {
      let last;
      for (const a of document.querySelectorAll('.tex8web-permalink')) {
        const el = target(a);
        if (el.getBoundingClientRect().top > below() + 1) break;
        last = el;
      }
      try {
        if (last) localStorage.setItem(key, last.id);
        else localStorage.removeItem(key);
      } catch {}
    };
    addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
    if (location.hash || performance.getEntriesByType('navigation')[0]?.type !== 'navigate') return;
    let el;
    try { el = document.getElementById(localStorage.getItem(key)); } catch {}
    if (!el) return;
    const go = () => scrollTo(0, scrollY + el.getBoundingClientRect().top - below());
    go();
    // (and again once the fonts and pictures are in, which may have moved
    // it, unless the reader has moved by then: not by scrollY, which the
    // browser's scroll anchoring changes too)
    let moved = false;
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
      addEventListener(type, () => { moved = true; }, { once: true, passive: true });
    }
    const loaded = new Promise(done => addEventListener('load', done));
    Promise.all([loaded, document.fonts.ready]).then(() => { if (!moved) go(); });
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
      if (a && a !== shown) timer = setTimeout(() => show(a), 50);
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
    // a touch beside the card closes it at once, as Safari on iOS sends no
    // click for a tap on plain text; and that tap's click (caught on its way
    // down to what was tapped, and not a later one from the keyboard, whose
    // detail, the count of clicks, is 0) does nothing else
    let touch = false, closing = null;
    document.addEventListener('pointerdown', event => {
      touch = event.pointerType === 'touch';
      closing = touch && shown && !card.contains(event.target) && !link(event.target)
        ? event.target : null;
      if (closing) hide();
    });
    document.addEventListener('click', event => {
      const a = link(event.target);
      if (event.target === closing && event.detail) {
        event.preventDefault();
        event.stopPropagation();
      } else if (a && touch && a !== shown) {
        event.preventDefault();
        show(a);
      } else if (!card.contains(event.target)) {
        hide();
      }
    }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    // (but not for the scroll that brings a focused link into view)
    addEventListener('scroll', () => { if (shown !== document.activeElement) hide(); }, { passive: true });
  }

  // pictures, in a figure, in display math, or over twice as tall as the
  // text (not an icon in a line), and not a link: clicking one shows it as
  // large as the screen allows (css/tex8web.css), over the page. There the
  // wheel or a pinch zooms in or out around the pointer, from half to 4
  // times (room to overshoot, zooming out), a double-click in or back to
  // where it started, and dragging moves it; clicking beside it, or
  // Escape, closes it
  function viewer() {
    if (!HTMLElement.prototype.showPopover) return;
    // a popover covering the page, rather than a modal <dialog>, which
    // makes the rest of the page inert and so restyles all of it as it
    // opens and closes (20ms on a long page in Chrome on a laptop); it
    // takes the pointer, as the darkened page around the picture
    const cover = document.createElement('div');
    cover.className = 'tex8web-viewer';
    cover.popover = 'auto';
    cover.setAttribute('role', 'dialog');
    cover.setAttribute('aria-modal', 'true');
    const plate = document.createElement('div');
    plate.className = 'tex8web-plate';
    const picture = document.createElement('img');
    picture.draggable = false;
    plate.append(picture);
    cover.append(plate);
    // the plate (the picture's background, fitted to the screen at zoom 1) at
    // x, y, zoom times as large: laid out at `laid` times, and the rest a
    // transform, which the GPU draws smoothly, until the zoom has stopped
    // for a moment and the layout catches up (an SVG drawn sharp again).
    // It opens at zoom `home`: 1, but a picture of pixels at its own size,
    // if the screen has room for it, rather than blurred, larger
    let zoom = 1, laid = 1, home = 1, x = 0, y = 0, fitted, natural, seen, timer;
    const show = () => { plate.style.transform = `translate(${x}px, ${y}px) scale(${zoom / laid})`; };
    const lay = () => {
      plate.classList.remove('tex8web-easing');
      laid = zoom;
      plate.style.setProperty('--tex8web-zoom', laid);
      show();
    };
    // (a double-click's zoom stopped where it has got to, for what moves
    // it next to start from there)
    const settle = () => {
      if (!plate.classList.contains('tex8web-easing')) return;
      const now = new DOMMatrix(getComputedStyle(plate).transform);
      plate.classList.remove('tex8web-easing');
      [x, y, zoom] = [now.e, now.f, now.a * laid];
      show();
    };
    // (at a scale of 1, the picture laid out as shown)
    const measure = () => {
      const box = plate.getBoundingClientRect();
      fitted = [box.width / laid, box.height / laid];
      home = natural ? Math.min(1, natural / (picture.getBoundingClientRect().width / laid)) : 1;
    };
    // (anywhere, as long as the picture covers the middle of the screen:
    // zooming in on a point of the picture never moves it from there)
    const place = (left, top) => {
      x = Math.min(innerWidth / 2, Math.max(innerWidth / 2 - fitted[0] * zoom, left));
      y = Math.min(innerHeight / 2, Math.max(innerHeight / 2 - fitted[1] * zoom, top));
      seen = [innerWidth, innerHeight];
      show();
    };
    // to zoom `to` at left, top, easing there (css/tex8web.css) or not
    const go = (to, left, top, ease = false) => {
      if (ease) plate.classList.add('tex8web-easing');
      zoom = to;
      place(left, top);
      clearTimeout(timer);
      timer = setTimeout(lay, ease ? faded() : 150);
    };
    // around the point px, py, which stays where it is
    const zoomTo = (to, px, py, ease) => {
      settle();
      to = Math.min(4, Math.max(home / 2, to));
      go(to, px - (px - x) * to / zoom, py - (py - y) * to / zoom, ease);
    };
    const center = ease => go(home, (innerWidth - fitted[0] * home) / 2, (innerHeight - fitted[1] * home) / 2, ease);
    const open = event => {
      const img = event.currentTarget, box = img.getBoundingClientRect();
      // (the same src, which tex8web-page.tex's rule for TikZ pictures in
      // dark mode picks out)
      picture.setAttribute('src', img.getAttribute('src'));
      picture.alt = img.alt;
      plate.style.setProperty('--tex8web-ratio', box.width / box.height);
      natural = /\.svg$/i.test(img.getAttribute('src')) ? 0 : img.naturalWidth;
      zoom = 1;
      lay();
      cover.showPopover();
      measure();
      center();
      lay();
    };
    // (once each picture has its size; and a listener on each, as Safari on
    // iOS may not pass a tap on an img, which isn't clickable, up to the
    // document)
    const mark = img => {
      if (img.closest('a') || !(img.closest('figure, .mathjax-block')
        || img.offsetHeight > 2 * parseFloat(getComputedStyle(img).fontSize))) return;
      img.classList.add('tex8web-zoomable');
      img.addEventListener('click', open);
    };
    for (const img of document.images) {
      if (img.complete) mark(img);
      else img.addEventListener('load', () => mark(img), { once: true });
    }
    document.body.append(cover);
    // (the page behind isn't inert, as a modal dialog's is: the keyboard
    // stays off it; and Escape fades it out too, rather than the popover's
    // own closing, which the keydown's default action is)
    document.addEventListener('keydown', event => {
      if (!cover.matches(':popover-open') || !['Tab', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') close();
    });
    // (turning a phone, say: as far into the zoom from where it started,
    // with the point at the middle of the screen still there)
    addEventListener('resize', () => {
      if (!cover.matches(':popover-open')) return;
      settle();
      const fx = (seen[0] / 2 - x) / (fitted[0] * zoom), fy = (seen[1] / 2 - y) / (fitted[1] * zoom);
      const further = zoom / home;
      lay();
      measure();
      zoom = Math.min(4, further * home);
      lay();
      place(innerWidth / 2 - fx * fitted[0] * zoom, innerHeight / 2 - fy * fitted[1] * zoom);
    });
    cover.addEventListener('wheel', event => {
      event.preventDefault();
      // (a pinch on a trackpad comes as a wheel with ctrl, in smaller steps;
      // but a mouse's wheel with ctrl, no more than 100px a notch)
      const pixels = event.deltaY * [1, 16, innerHeight][event.deltaMode];
      const step = Math.max(-100, Math.min(100, pixels)) * (event.ctrlKey ? 0.01 : 0.002);
      zoomTo(zoom * Math.exp(-step), event.clientX, event.clientY);
    }, { passive: false });
    // Safari's pinch on a trackpad, which isn't a wheel (but not its pinch
    // on a touch screen, which the pointers below follow)
    const pointers = new Map();
    let pinched;
    cover.addEventListener('gesturestart', event => {
      event.preventDefault();
      pinched = zoom;
    });
    cover.addEventListener('gesturechange', event => {
      event.preventDefault();
      if (!pointers.size) zoomTo(pinched * event.scale, event.clientX, event.clientY);
    });
    // dragging moves the picture; two fingers also zoom, as they spread
    // or close. A click ending a drag isn't one
    let dragged = false, touch = false, tapped = 0, from, last;
    const both = () => {
      const [a, b = a] = pointers.values();
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, apart: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    cover.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      // (a first finger starts afresh: one Safari on iOS lost track of, a
      // press held for its menu, isn't still down)
      if (event.isPrimary) {
        pointers.clear();
        dragged = false;
        touch = event.pointerType === 'touch';
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      cover.setPointerCapture(event.pointerId);
      from = last = both();
    });
    cover.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const now = both();
      if (!dragged && pointers.size === 1 && Math.hypot(now.x - from.x, now.y - from.y) <= 4) return;
      dragged = true;
      cover.classList.add('tex8web-dragging');
      settle();
      if (pointers.size > 1 && last.apart) zoomTo(zoom * now.apart / last.apart, last.x, last.y);
      place(x + now.x - last.x, y + now.y - last.y);
      last = now;
    });
    // (on pointerup or pointercancel, or the viewer closing mid-drag)
    cover.addEventListener('lostpointercapture', event => {
      pointers.delete(event.pointerId);
      if (pointers.size) last = both();
      else cover.classList.remove('tex8web-dragging');
    });
    // (by where it is, not its target: the cover, holding the pointer,
    // gets the click)
    const on = event => {
      const box = picture.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom;
    };
    // (as long as the fade out takes, which is none if the reader would
    // rather not see one)
    const close = () => {
      if (cover.classList.contains('tex8web-closing')) return;
      cover.classList.add('tex8web-closing');
      setTimeout(() => {
        cover.hidePopover();
        cover.classList.remove('tex8web-closing');
      }, 1000 * parseFloat(getComputedStyle(cover).transitionDuration));
    };
    const twice = event => {
      if (!on(event)) return;
      if (zoom > home) center(true);
      else zoomTo(2.5 * home, event.clientX, event.clientY, true);
    };
    // (a double tap by its two clicks: Safari on iOS sends no dblclick
    // where touch-action is none)
    cover.addEventListener('click', event => {
      if (dragged) return;
      if (!on(event)) close();
      else if (touch && event.timeStamp - tapped < 300) {
        tapped = 0;
        twice(event);
      } else tapped = event.timeStamp;
    });
    cover.addEventListener('dblclick', event => { if (!touch) twice(event); });
  }

  theme();
  column();
  bar();
  smooth();
  sidenotes();
  contents();
  filter();
  place();
  previews();
  viewer();
})();
