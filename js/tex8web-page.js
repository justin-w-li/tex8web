// tex8web's page script: the up link, the theme button, the table of
// contents (its button, the bar on a narrow screen, the current entry, and
// the search field), smooth scrolling to links, footnotes beside their
// marks, preview cards, opened pictures, the fade at the edges of what
// scrolls sideways, the reader's place on a reload, and, in Safari, the
// reader's place as the width changes. page.lua and text.lua build the
// elements used here, and tex8web-head.js adds tex8web-js to <html> before
// the page is drawn. The page is readable without this script
// (css/tex8web.css).
(() => {
  const root = document.documentElement;
  const target = a => document.getElementById(decodeURIComponent(a.hash.slice(1)));
  const layout = () => getComputedStyle(root).getPropertyValue('--tex8web-layout').trim();
  // twice css/tex8web.css's --tex8web-fade (in seconds), in ms: after the
  // fades end
  const faded = () => 2000 * parseFloat(getComputedStyle(root).getPropertyValue('--tex8web-fade'));
  // an element's text, without the assistive MathML MathJax may add, which
  // repeats the formula
  const text = el => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('.tex8web-permalink, mjx-assistive-mml').forEach(node => node.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };
  // an element as one line of text with copies of its typeset math, without
  // the styles of the text around it, and without a final period (a
  // theorem's head has one)
  const shown = el => {
    const line = document.createDocumentFragment();
    const add = el => {
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) line.append(node.textContent.replace(/\s+/g, ' '));
        // skips tex4ht's comments, <!-- tex4ht:ref: x -->
        else if (node.nodeType !== Node.ELEMENT_NODE) continue;
        else if (node.matches('mjx-container')) line.append(node.cloneNode(true));
        else if (!node.matches('.tex8web-permalink, mjx-assistive-mml')) add(node);
      }
    };
    add(el);
    line.querySelectorAll('mjx-assistive-mml').forEach(node => node.remove());
    line.normalize();
    const last = line.lastChild;
    if (last?.nodeType === Node.TEXT_NODE) last.textContent = last.textContent.replace(/\.?\s*$/, '');
    return line;
  };
  // a link in the table of contents as its entry reads: number and title
  const entryText = a => [a.parentElement.querySelector('.tocnumber')?.textContent.trim(), text(a)]
    .filter(Boolean).join(' ');
  const entryShown = a => {
    const line = shown(a);
    const number = a.parentElement.querySelector('.tocnumber')?.textContent.trim();
    if (number) line.prepend(`${number} `);
    return line;
  };

  // a page's address without its fragment, with a folder's index.html as
  // the folder, as a server gives it (same as in tex8web-head.js)
  const page = url => url.split('#')[0].replace(/\/index\.html$/, '/');

  // the reader's own scrolling, told apart from a followed link's smooth
  // scroll, which fires only scroll events. A tap, as on the bar, and
  // scrolling the table of contents leave the page where the link led.
  const keys = [' ', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  const scrolled = handler => {
    for (const type of ['wheel', 'touchmove', 'keydown']) {
      addEventListener(type, event => {
        if (type === 'keydown' ? !keys.includes(event.key) || event.target.closest?.('input, textarea')
          : event.target.closest?.('#tex8web-toc')) return;
        handler();
      }, { passive: true });
    }
  };

  // the scroll position set by restore() or anchor(), which is not the
  // reader's scrolling. bar() reads it at the next scroll event only.
  let kept;

  // The up link goes back in history when the last other page before this
  // one is the page above, so the reader's place there is kept. Without the
  // Navigation API, the link loads the page.
  function up() {
    const a = document.querySelector('.tex8web-up');
    if (!a || !window.navigation) return;
    a.addEventListener('click', event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const here = page(location.href);
      const before = navigation.entries().slice(0, navigation.currentEntry.index).reverse()
        .find(entry => page(entry.url ?? '') !== here);
      if (before?.url && page(before.url) === page(a.href)) {
        event.preventDefault();
        navigation.traverseTo(before.key);
      }
    });
  }

  // the theme: as the reader last chose on any tex8web page (applied by
  // tex8web-head.js before the page is drawn), or else the system's. The
  // switch fades unless the reader prefers reduced motion.
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

  // On a wide screen, the table of contents button hides or shows the column
  // (css/tex8web.css), as the reader last chose on any tex8web page (applied
  // by tex8web-head.js). On a narrow screen, the button opens the drawer
  // through its popovertarget.
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
      // cancelling the click cancels the popovertarget's opening
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
  // (css/tex8web.css): hidden while the reader scrolls down, shown as soon as
  // they scroll up. A link's jump is not the reader's scrolling: after a
  // followed link, Back or Forward, or a load with a hash, the bar is hidden
  // until the reader scrolls, as the target lands where the bar would be,
  // unless the page is at its very top. When the window goes from wide to
  // narrow, the bar is hidden unless the page is at its top.
  function bar() {
    const controls = document.querySelector('.tex8web-controls');
    if (!controls) return;
    const top = () => scrollY <= controls.offsetHeight;
    let was = layout(), width = innerWidth, last = scrollY;
    const atTop = () => root.classList.toggle('tex8web-top', scrollY <= 0);
    let jumped = false;
    const away = () => controls.classList.toggle('tex8web-away', was === 'narrow' && scrollY > 0);
    const jump = () => {
      jumped = true;
      away();
    };
    // (target() throws on a hash that does not decode, as a reader may type)
    try {
      jumped = performance.getEntriesByType('navigation')[0]?.type === 'navigate' && Boolean(target(location));
    } catch {}
    document.addEventListener('click', event => {
      const a = event.target.closest?.('a[href*="#"]');
      if (a && !event.defaultPrevented && here(a)) jump();
    });
    addEventListener('hashchange', jump);
    addEventListener('popstate', jump);
    scrolled(() => { jumped = false; });
    // The browser restores the reader's place, or scrolls to a link's #,
    // right before the load event, and fires the scroll event a frame later.
    // That scroll is not the reader's, so the bar keeps its state, without
    // transitions, until two frames after the load.
    let settled = false;
    controls.style.transition = 'none';
    atTop();
    // (a load with a hash: the bar hidden a frame before transitions return)
    const settle = () => requestAnimationFrame(() => {
      if (jumped) away();
      requestAnimationFrame(() => {
        settled = true;
        last = scrollY;
        controls.style.transition = '';
      });
    });
    if (document.readyState === 'complete') settle();
    else addEventListener('load', settle);
    // Hidden only on a narrow screen: the browser may restyle the page for a
    // narrow screen before the resize event, and a bar already hidden would
    // then vanish instead of fading. Ignored: the scrolling that keeps the
    // reader's place as the width changes, and the return to that place on
    // a reload (restore()). Safari on iOS bounces past the page's ends and
    // jitters a pixel or two back as its own bars grow or shrink, so a
    // change of direction counts only after 10px.
    addEventListener('scroll', () => {
      atTop();
      const end = document.documentElement.scrollHeight - innerHeight;
      const ours = scrollY === kept;
      kept = undefined;
      if (innerWidth !== width || !settled || ours) {
        width = innerWidth;
        last = scrollY;
      } else if (jumped) {
        away();
        last = scrollY;
      } else if (scrollY >= 0 && scrollY <= end && (Math.abs(scrollY - last) >= 10 || top())) {
        controls.classList.toggle('tex8web-away', was === 'narrow' && scrollY > last && !top());
        last = scrollY;
      }
    }, { passive: true });
    // The layouts switch at once when the window crosses the breakpoint.
    // With transitions, the table of contents column would slide away as a
    // drawer, and the bar would slide in.
    const toc = document.getElementById('tex8web-toc');
    addEventListener('resize', () => {
      const now = layout();
      if (now !== was) {
        for (const el of [toc, controls]) {
          if (!el) continue;
          el.style.transition = 'none';
          requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ''; }));
        }
      }
      if (now === 'wide') controls.classList.remove('tex8web-away');
      else if (was === 'wide') controls.classList.toggle('tex8web-away', !top());
      was = now;
    });
  }

  // The reader's place on a reload. Chrome returns to it before the web
  // fonts arrive (no fonts are preloaded from disk: tex8web-fonts.js), and
  // its scroll anchoring then moves the page as they swap in, further on
  // each reload. So the place is saved as the page is left, and returned
  // to once the fonts are loaded. The return is skipped once the reader
  // scrolls, clicks, or follows a link, and when the width or the page's
  // height differs, which would put other text there. Back and Forward are
  // left to the browser: the place is saved by path, which other entries
  // in the history may share.
  function restore() {
    const key = `tex8web-place ${location.pathname}`;
    addEventListener('pagehide', () => {
      try { sessionStorage.setItem(key, JSON.stringify([scrollY, innerWidth, root.scrollHeight])); } catch {}
    });
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(key)); } catch {}
    if (!saved || performance.getEntriesByType('navigation')[0]?.type !== 'reload') return;
    let moved = false;
    const move = () => { moved = true; };
    scrolled(move);
    addEventListener('hashchange', move);
    addEventListener('pointerdown', move);
    // (fonts.ready after the load: the fonts may not be requested yet)
    new Promise(done => document.readyState === 'complete' ? done() : addEventListener('load', done, { once: true }))
      .then(() => document.fonts.ready)
      .then(() => requestAnimationFrame(() => {
        const [y, width, height] = saved;
        if (moved || innerWidth !== width || root.scrollHeight !== height || scrollY === y) return;
        scrollTo({ top: y, behavior: 'instant' });
        kept = scrollY;
      }));
  }

  // In Chrome and Firefox, scroll anchoring keeps the reader's place as the
  // width changes. Safari has none, so there the line a quarter down the
  // window, read once the scrolling stops, is put back where it was.
  function anchor() {
    if (CSS.supports('overflow-anchor', 'auto')) return;
    let line, width = innerWidth, timer;
    // A caret in math has an empty box: the element there instead. Between
    // blocks, the caret is put in the nearest text, in Safari as in Chrome.
    const read = () => {
      const box = document.body.getBoundingClientRect(), x = (box.left + box.right) / 2, y = innerHeight / 4;
      const range = document.caretRangeFromPoint(x, y);
      const at = range?.getBoundingClientRect().height ? range : document.elementFromPoint(x, y);
      if (at) line = { at, top: at.getBoundingClientRect().top };
    };
    addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(read, 150);
    }, { passive: true });
    // not when only the height changes, as on iOS when Safari's bars grow
    // or shrink during scrolling
    addEventListener('resize', () => {
      if (innerWidth === width) return;
      width = innerWidth;
      if (!line) return;
      scrollBy({ top: line.at.getBoundingClientRect().top - line.top, behavior: 'instant' });
      kept = scrollY;
    });
  }

  // Scrolling to a link's target is smooth once the reader has followed a
  // link (css/tex8web.css), so the return to the reader's place on a reload
  // is not.
  function smooth() {
    document.addEventListener('click', event => {
      if (event.target.closest?.('a[href*="#"]')) root.classList.add('tex8web-smooth');
    });
  }

  // footnotes beside the text (floated there by css/tex8web.css on a wide
  // screen): each level with its mark, or below the footnote above it.
  // Placed again whenever the layout changes (pictures, fonts, the width).
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

  // What scrolls sideways fades out at each edge with more hidden past it
  // (css/tex8web.css). Each such element is marked with how much is hidden
  // on each side. The marks are updated when the layout changes, and by a
  // scroll listener on each element, so scrolling the page runs none of
  // these listeners.
  const scrolling = 'mjx-container[display], div.tabular, pre';
  const listening = new WeakSet();
  function fade(elements) {
    // All measured, then all marked: a mark between two measures would make
    // the second restyle the page, a third of a second on a phone for a long
    // page's displays. On a wide screen, a tabular or verbatim does not
    // scroll. It runs into the margin, and a mask would cut it off.
    const hidden = elements.map(element => {
      const width = element.scrollWidth - element.clientWidth;
      return width > 0 && getComputedStyle(element).overflowX !== 'visible' ? [width, element.scrollLeft] : null;
    });
    elements.forEach((element, i) => {
      element.classList.toggle('tex8web-scrolls', Boolean(hidden[i]));
      if (!hidden[i]) return;
      const [width, left] = hidden[i];
      element.style.setProperty('--tex8web-hidden-left', `${left}px`);
      element.style.setProperty('--tex8web-hidden-right', `${width - left}px`);
      if (listening.has(element)) return;
      listening.add(element);
      element.addEventListener('scroll', () => fade([element]), { passive: true });
    });
  }

  function edges() {
    // queried each time: MathJax in the browser makes the math's containers
    // later, as ui/lazy brings the math into view
    const all = () => fade([...document.querySelectorAll(scrolling)]);
    new ResizeObserver(all).observe(document.body);
    // late fonts change the math's width, but not always the page's size
    document.fonts.addEventListener('loadingdone', all);
  }

  // the table of contents: the entry of the section being read (the last
  // heading above a line, or the heading a link led to) is marked, and its
  // section's subsections shown. On a narrow screen, that entry is copied
  // into the bar (css/tex8web.css) once the first heading is reached. The
  // drawer closes when a link is followed. A chevron after each section with
  // subsections shows or hides them with a slide. Sections the reader opens
  // stay open. The section being read opens on reaching it and closes on
  // leaving it.
  function contents() {
    const toc = document.getElementById('tex8web-toc');
    if (!toc) return;
    const entries = [...toc.querySelectorAll('a[href^="#"]')]
      .map(a => ({ a, heading: target(a) }))
      .filter(entry => entry.heading);
    if (!entries.length) return;
    const where = document.querySelector('.tex8web-where');
    const isSection = el => el.matches('.sectionToc, .likesectionToc, .chapterToc, .likechapterToc, .appendixToc, .partToc, .likepartToc');
    const motion = matchMedia('(prefers-reduced-motion: no-preference)');
    // tex4ht's entries are siblings, between <br />s: a section's, then its
    // subsections'
    const under = section => {
      const rows = [];
      for (let el = section.nextElementSibling; el && !isSection(el); el = el.nextElementSibling) {
        if (el.matches('span')) rows.push(el);
      }
      return rows;
    };
    const show = (section, open, slide) => {
      const rows = under(section);
      section.querySelector('.tex8web-toc-more')?.setAttribute('aria-expanded', open);
      // the first entries, subsections before any section, are shown by the
      // class on each entry
      if (!isSection(section)) section.classList.toggle('tex8web-open', open);
      for (const row of rows) {
        row.getAnimations().forEach(animation => animation.cancel());
        if (open) row.classList.add('tex8web-open');
      }
      if (!slide || !motion.matches) {
        if (!open) rows.forEach(row => row.classList.remove('tex8web-open'));
        return;
      }
      // each row clipped to its box as it grows, with clip-path, which
      // animates
      for (const row of rows) {
        const top = getComputedStyle(row).paddingTop;
        const shut = { height: '0px', paddingTop: '0px', clipPath: 'inset(0)' };
        const full = { height: `${row.getBoundingClientRect().height - parseFloat(top)}px`, paddingTop: top, clipPath: 'inset(0)' };
        const animation = row.animate(open ? [shut, full] : [full, shut], { duration: faded() / 2, easing: 'ease', fill: 'forwards' });
        animation.onfinish = () => {
          if (!open) row.classList.remove('tex8web-open');
          animation.cancel();
        };
      }
    };
    for (const section of toc.querySelectorAll('.tableofcontents > span')) {
      if (!isSection(section) || !under(section).length) continue;
      const link = section.querySelector('a');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tex8web-toc-more';
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', `Subsections of ${link ? entryText(link) : section.textContent.trim()}`);
      section.append(button);
    }
    // sections the reader opened
    const kept = new Set();
    // followed: the entry a link led to, kept until the reader scrolls or
    // its heading, once seen, leaves the screen
    let current, opened, followed, seen;
    // the layout, read once and on each resize: layout() in update(), after
    // its changes, would restyle the whole page
    let wide = layout() === 'wide';
    addEventListener('resize', () => { wide = layout() === 'wide'; });
    // the entry being read, or its section's while its subsections are
    // hidden, scrolled a third of the way down the box if it is outside it.
    // No scrolling while search results replace the entries (a.height is 0)
    const reveal = () => {
      const shown = current.a.getClientRects().length ? current.a : opened.querySelector('a');
      const a = shown.getBoundingClientRect(), box = toc.getBoundingClientRect();
      if (a.height && (a.top < box.top || a.bottom > box.bottom)) toc.scrollTop += a.top - box.top - box.height / 3;
    };
    const update = () => {
      // The line is a quarter down the screen, and moves to the bottom over
      // the last screen of scrolling, or over all of it if shorter, so that
      // each heading crosses it, the last at the end.
      const max = root.scrollHeight - innerHeight, ramp = Math.min(max, innerHeight);
      const line = innerHeight / 4 + (ramp > 0 ? 0.75 * innerHeight * Math.max(0, scrollY - max + ramp) / ramp : 0);
      if (followed) {
        const box = followed.heading.getBoundingClientRect();
        if (box.bottom > 0 && box.top < innerHeight) seen = true;
        else if (seen) followed = null;
      }
      let reading = entries[0];
      for (const entry of entries) {
        if (entry.heading.getBoundingClientRect().top > line) break;
        reading = entry;
      }
      if (where) where.hidden = !followed && reading.heading.getBoundingClientRect().top > line;
      reading = followed || reading;
      if (reading === current) return;
      current?.a.removeAttribute('aria-current');
      current = reading;
      current.a.setAttribute('aria-current', 'location');
      if (where) where.replaceChildren(entryShown(current.a));
      // for subsections before the first section, the first entry
      let section = current.a.closest('.tableofcontents > span');
      while (section?.previousElementSibling && !isSection(section)) section = section.previousElementSibling;
      if (section !== opened) {
        opened?.classList.remove('tex8web-reading');
        if (opened && !kept.has(opened)) show(opened, false);
        if (!kept.has(section)) show(section, true);
        section.classList.add('tex8web-reading');
        opened = section;
      }
      // Nothing to scroll in the hidden column or the closed drawer, which
      // are not drawn. Their entries' boxes, read after the changes above,
      // would lay out the whole page.
      if (wide ? root.classList.contains('tex8web-toc-hidden') : !toc.matches(':popover-open')) return;
      reveal();
    };
    let pending = false;
    addEventListener('scroll', () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; update(); });
    }, { passive: true });
    const follow = heading => {
      followed = entries.find(entry => entry.heading === heading);
      seen = false;
      update();
    };
    // the heading in the address, where a hash typed by the reader may not
    // decode
    const hashed = () => {
      try { return target(location); } catch { return null; }
    };
    update();
    // A page loaded with a hash: its heading, if it is on screen once the
    // page is scrolled to it, or back to the reader's place on a reload
    // (bar())
    const loaded = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      const box = hashed()?.getBoundingClientRect();
      if (box && box.bottom > 0 && box.top < innerHeight) follow(hashed());
    }));
    if (document.readyState === 'complete') loaded();
    else addEventListener('load', loaded);
    addEventListener('hashchange', () => follow(hashed()));
    // also a link to the heading already in the address, which changes no
    // hash; not one a preview card's first tap kept from being followed
    document.addEventListener('click', event => {
      const a = event.target.closest?.('a[href*="#"]');
      if (a && !event.defaultPrevented && here(a)) follow(here(a));
    });
    scrolled(() => {
      if (!followed) return;
      followed = null;
      update();
    });
    // MathJax in the browser typesets an entry's math after the bar's copy
    // is made, and an entry in the closed drawer only when the drawer opens
    if (where) {
      new MutationObserver(() => where.replaceChildren(entryShown(current.a)))
        .observe(toc.querySelector('.tableofcontents'), { childList: true, subtree: true });
    }
    toc.addEventListener('click', event => {
      const button = event.target.closest('.tex8web-toc-more');
      if (button) {
        const open = button.getAttribute('aria-expanded') !== 'true';
        kept[open ? 'add' : 'delete'](button.parentElement);
        show(button.parentElement, open, true);
      }
      if (event.target.closest('a') && toc.matches(':popover-open')) toc.hidePopover();
    });
    // Every entry is shown, without chevrons, when all entries fit in the
    // column or drawer without scrolling (css/tex8web.css). Measured with all
    // entries shown and the search results hidden, so the result does not
    // depend on what is open. The box is measured at its height with a
    // phone's URL bar shown: the box grows as the URL bar hides during
    // scrolling, which must not change what is shown. Measured again when
    // fonts arrive and when MathJax in the browser typesets the entries,
    // which changes their heights but not the box's.
    const list = toc.querySelector('.tableofcontents');
    const fit = () => {
      const results = toc.querySelector('.tex8web-toc-results');
      const filtering = list.hidden, top = toc.scrollTop;
      if (filtering) [list.hidden, results.hidden] = [false, true];
      toc.classList.add('tex8web-toc-all');
      toc.style.marginBottom = 'calc(100dvh - 100svh)';
      const fits = toc.scrollHeight <= toc.clientHeight;
      toc.style.marginBottom = '';
      if (filtering) [list.hidden, results.hidden] = [true, false];
      toc.classList.toggle('tex8web-toc-all', fits);
      toc.scrollTop = top;
    };
    document.fonts.addEventListener('loadingdone', fit);
    // The hidden column is not scrolled either, so its entry is scrolled to
    // when the column is shown, or when the window is widened while the
    // drawer is closed: the box's height then grows from 0.
    let height = 0;
    new ResizeObserver(([entry]) => {
      fit();
      if (!height && entry.contentRect.height) reveal();
      height = entry.contentRect.height;
    }).observe(toc);
    new MutationObserver(fit).observe(list, { childList: true, subtree: true });
    // The closed drawer is not scrolled (update()), so its entry is scrolled
    // to as it opens, in the frame before it is first drawn. A microtask
    // after beforetoggle runs while the drawer is still closed when the
    // button opens it, and Chrome dispatches toggle a frame late. Whether
    // all entries fit is measured first: the closed drawer's empty box fits
    // them all, and the ResizeObserver measures the open drawer only after
    // the frame's callbacks.
    toc.addEventListener('beforetoggle', event => {
      if (event.newState === 'open') requestAnimationFrame(() => { fit(); reveal(); });
    });
  }

  // the search field: in place of the entries, the headings, theorems and
  // boxes with # links, and terms (\WebTerm) whose text has every word typed,
  // ignoring case, accents, and MathJax's letter styles (𝜎 is σ). The arrow
  // keys choose a result, from the first, with the focus kept in the field
  // (a combobox), and Enter follows the result chosen.
  function filter() {
    const toc = document.getElementById('tex8web-toc');
    const input = toc?.querySelector('.tex8web-toc-filter');
    if (!input) return;
    const list = toc.querySelector('.tableofcontents');
    const results = document.createElement('ol');
    results.className = 'tex8web-toc-results';
    results.id = 'tex8web-toc-results';
    results.setAttribute('role', 'listbox');
    results.hidden = true;
    list.after(results);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-controls', results.id);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    const fold = s => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    // a Greek letter or symbol also by its TeX name, which the typeset page
    // no longer has: σ by sigma, and ε by varepsilon, which epsilon also
    // matches
    const names = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'varepsilon', ζ: 'zeta', η: 'eta',
      θ: 'vartheta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'varpi', ρ: 'varrho',
      σ: 'varsigma', τ: 'tau', υ: 'upsilon', φ: 'varphi', χ: 'chi', ψ: 'psi', ω: 'omega',
      '∞': 'infty', '∂': 'partial', '∇': 'nabla', '∅': 'emptyset' };
    const key = label => {
      const folded = fold(label);
      return `${folded}\n${[...folded].map(c => names[c] ?? c).join('')}`;
    };
    // numbered theorems and boxes, found by their # links (page.lua)
    const theorems = '.newtheorem, .tcolorbox';
    const theoremLinks = '.newtheorem .head > .tex8web-permalink, .tcolorbox > .tcolorbox-title > .tex8web-permalink';
    // collected on first use: by then, MathJax in the browser has typeset
    // the math
    let items;
    function collect() {
      const all = [];
      for (const a of list.querySelectorAll('a[href^="#"]')) {
        const el = target(a);
        if (el) all.push({ el, href: a.hash, kind: 'heading', label: entryText(a), show: () => entryShown(a) });
      }
      for (const link of document.querySelectorAll(theoremLinks)) {
        all.push({ el: link.parentElement, href: link.hash, kind: 'theorem',
          label: text(link.parentElement).replace(/\.$/, ''), show: () => shown(link.parentElement) });
      }
      // not a term in a heading or a theorem's head, which is found as that
      // heading or theorem
      for (const term of document.querySelectorAll('.tex8web-term[id]')) {
        if (!term.closest('h2, h3, h4, h5, h6, .head, .tcolorbox-title')) {
          all.push({ el: term, href: `#${term.id}`, kind: 'term', label: text(term), show: () => shown(term) });
        }
      }
      all.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      // a term is shown with the theorem it is in, or else its section, and
      // listed once for each
      let heading, theorem;
      const seen = new Set();
      return all.filter(item => {
        item.key = key(item.label);
        if (item.kind === 'heading') heading = item;
        else if (item.kind === 'theorem') theorem = item;
        else if (theorem?.el.closest(theorems).contains(item.el)) item.where = theorem;
        else item.where = heading;
        if (item.kind !== 'term') return true;
        const once = `${item.key}\n${item.where?.label}`;
        return !seen.has(once) && seen.add(once);
      });
    }
    const row = (item, i) => {
      const li = document.createElement('li');
      li.id = `tex8web-result-${i}`;
      li.setAttribute('role', 'option');
      const a = document.createElement('a');
      a.href = item.href;
      a.append(item.show());
      if (item.where) {
        const where = document.createElement('span');
        where.className = 'tex8web-toc-where';
        where.append(item.where.show());
        a.append(' ', where);
      }
      li.append(a);
      return li;
    };
    let chosen;
    const choose = i => {
      const rows = results.querySelectorAll('[role="option"]');
      chosen = rows[Math.max(0, Math.min(i, rows.length - 1))];
      rows.forEach(row => row.setAttribute('aria-selected', String(row === chosen)));
      if (!chosen) return input.removeAttribute('aria-activedescendant');
      input.setAttribute('aria-activedescendant', chosen.id);
      chosen.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => {
      // \sigma as sigma
      const words = fold(input.value).replaceAll('\\', '').split(/\s+/).filter(Boolean);
      list.hidden = words.length > 0;
      results.hidden = !words.length;
      input.setAttribute('aria-expanded', String(words.length > 0));
      if (!words.length) return;
      items ??= collect();
      const found = items.filter(item => words.every(word => item.key.includes(word)));
      const none = document.createElement('li');
      none.className = 'tex8web-toc-none';
      none.textContent = 'No matches';
      results.replaceChildren(...(found.length ? found.map(row) : [none]));
      choose(0);
    });
    input.addEventListener('keydown', event => {
      if (results.hidden || event.isComposing) return;
      if (event.key === 'Enter') chosen?.querySelector('a').click();
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const rows = [...results.querySelectorAll('[role="option"]')];
        choose(rows.indexOf(chosen) + (event.key === 'ArrowDown' ? 1 : -1));
      }
    });
    // the placeholder names only what the page has
    const kinds = ['section'];
    if (document.querySelector(theoremLinks)) kinds.push('theorem');
    if (document.querySelector('.tex8web-term[id]')) kinds.push('term');
    input.placeholder = `Find a ${new Intl.ListFormat('en', { type: 'disjunction' }).format(kinds)}`;
    input.setAttribute('aria-label', input.placeholder);
  }

  // preview cards: pointing at a link to something on the page (a \ref,
  // \eqref, \cite, footnote mark, or section), or focusing the link with the
  // keyboard, shows a copy of the target in a card. On a touch screen, the
  // first tap shows the card, and the second follows the link.
  const here = a => a.pathname === location.pathname && a.hash && target(a);
  const previewable = 'a[href*="#"]:not(.tex8web-permalink, #tex8web-toc a, .footnotetext .footnote-mark a, .tex8web-preview a)';
  const blank = el => !el.textContent.trim() && !el.querySelector('img, svg, mjx-container');

  // a link's target: a theorem, box, or table, an equation (tex4ht's anchor
  // is right before it), a reference (its label and entry), a figure, a
  // footnote, or a heading and the element after it
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

  // a copy of el for the card, without ids, which the page already has,
  // except a box's, which its colors and frame are styled by. The card is
  // last on the page, so getElementById still finds the original box. A
  // footnote is copied as in the text, not beside it.
  function copyOf(el) {
    const copy = el.cloneNode(true);
    if (!copy.matches('.tcolorbox')) copy.removeAttribute('id');
    copy.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
    copy.querySelectorAll('.tex8web-permalink').forEach(child => child.remove());
    copy.classList.remove('tex8web-sidenote');
    copy.style.top = '';
    // a picture's tabindex and role, for opening it: the copy has no
    // listeners
    copy.querySelectorAll('[tabindex][role="button"]').forEach(child => {
      child.removeAttribute('tabindex');
      child.removeAttribute('role');
    });
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
      // a copy has its original's fade marks, but the card may be wider
      fade([...card.querySelectorAll(scrolling)]);
      const link = a.getBoundingClientRect(), width = card.offsetWidth, height = card.offsetHeight;
      const below = link.bottom + 6 + height <= innerHeight || link.top - 6 - height < 0;
      // from the link, but over the text: at most 16px past the body's right
      // edge
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
    // A touch beside the card closes it at once, since Safari on iOS sends
    // no click for a tap on plain text. That tap's click, caught in the
    // capture phase, does nothing else. A later click from the keyboard is
    // not blocked: its detail, the click count, is 0.
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
    // but not on the scroll that brings a focused link into view
    addEventListener('scroll', () => { if (shown !== document.activeElement) hide(); }, { passive: true });
  }

  // opened pictures: a picture in a figure or display math, or over twice as
  // tall as the text (not an icon in a line), and not a link, opens on a
  // click over the page, as large as the screen allows (css/tex8web.css).
  // There the wheel or a pinch zooms around the pointer, from half to 4
  // times (half leaves room to overshoot when zooming out). A double-click
  // zooms in or back to the start, and dragging moves the picture. A click
  // beside it, or Escape, closes it.
  function viewer() {
    if (!HTMLElement.prototype.showPopover) return;
    // a popover covering the page, instead of a modal <dialog>: a modal
    // makes the rest of the page inert, which restyles all of it on opening
    // and closing (20ms on a long page in Chrome on a laptop). The cover,
    // the darkened page around the picture, takes the pointer.
    const cover = document.createElement('div');
    cover.className = 'tex8web-viewer';
    cover.popover = 'auto';
    cover.setAttribute('role', 'dialog');
    cover.setAttribute('aria-modal', 'true');
    cover.tabIndex = -1;
    const plate = document.createElement('div');
    plate.className = 'tex8web-plate';
    const picture = document.createElement('img');
    picture.draggable = false;
    plate.append(picture);
    cover.append(plate);
    // The plate (the picture's background, fitted to the screen at zoom 1)
    // is at x, y, zoom times as large. It is laid out at `laid` times, with
    // the rest a transform, drawn smoothly by the GPU, until the zoom stops
    // for a moment and the plate is laid out again (an SVG drawn sharp
    // again). It opens at zoom `home`: 1, or a bitmap's natural size if the
    // screen has room for it, instead of larger and blurred.
    let zoom = 1, laid = 1, home = 1, x = 0, y = 0, fitted, natural, seen, timer;
    const show = () => { plate.style.transform = `translate(${x}px, ${y}px) scale(${zoom / laid})`; };
    const lay = () => {
      plate.classList.remove('tex8web-easing');
      laid = zoom;
      plate.style.setProperty('--tex8web-zoom', laid);
      show();
    };
    // stops a double-click's eased zoom where it has got to, so the next
    // move starts from there
    const settle = () => {
      if (!plate.classList.contains('tex8web-easing')) return;
      const now = new DOMMatrix(getComputedStyle(plate).transform);
      plate.classList.remove('tex8web-easing');
      [x, y, zoom] = [now.e, now.f, now.a * laid];
      show();
    };
    // fitted: the plate's size at zoom 1
    const measure = () => {
      const box = plate.getBoundingClientRect();
      fitted = [box.width / laid, box.height / laid];
      home = natural ? Math.min(1, natural / (picture.getBoundingClientRect().width / laid)) : 1;
    };
    // anywhere, as long as the picture covers the middle of the screen, so
    // zooming in on a point of the picture never moves it from there
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
    // around the point px, py, which stays in place
    const zoomTo = (to, px, py, ease) => {
      settle();
      to = Math.min(4, Math.max(home / 2, to));
      go(to, px - (px - x) * to / zoom, py - (py - y) * to / zoom, ease);
    };
    const center = ease => go(home, (innerWidth - fitted[0] * home) / 2, (innerHeight - fitted[1] * home) / 2, ease);
    // Closing gives the focus back to the picture, as a popover does. After
    // a click, the picture would then show a focus ring, and Space, which
    // pages down, would open it again. So the focus stays only when the
    // keyboard opened the viewer.
    let clicked;
    const open = (img, byKey) => {
      const box = img.getBoundingClientRect();
      clicked = byKey ? null : img;
      // the same src, which tex8web-page.tex's rule for TikZ pictures in
      // dark mode selects
      picture.setAttribute('src', img.getAttribute('src'));
      picture.alt = img.alt;
      // (a mirrored or stretched TikZ picture: text.pictures in text.lua)
      picture.style.transform = img.style.transform;
      picture.style.aspectRatio = img.style.aspectRatio;
      plate.style.setProperty('--tex8web-ratio', box.width / box.height);
      natural = /\.svg$/i.test(img.getAttribute('src')) ? 0 : img.naturalWidth;
      zoom = 1;
      lay();
      cover.showPopover();
      cover.focus();
      measure();
      center();
      lay();
    };
    // marked once each picture has its size, with a listener on each: Safari
    // on iOS may not pass a tap on an img, which is not clickable, up to the
    // document
    const mark = img => {
      if (img.closest('a') || !(img.closest('figure, .mathjax-block')
        || img.offsetHeight > 2 * parseFloat(getComputedStyle(img).fontSize))) return;
      img.classList.add('tex8web-zoomable');
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.addEventListener('click', () => open(img));
      img.addEventListener('keydown', event => {
        // not Space after a click, which pages down, nor with a modifier
        if ((event.key !== 'Enter' && event.key !== ' ') || event.shiftKey || event.ctrlKey
          || event.altKey || event.metaKey || !img.matches(':focus-visible')) return;
        event.preventDefault();
        open(img, true);
      });
    };
    for (const img of document.images) {
      if (img.complete) mark(img);
      else img.addEventListener('load', () => mark(img), { once: true });
    }
    document.body.append(cover);
    // The page behind is not inert, as it is behind a modal dialog, so Tab
    // is blocked to keep the keyboard off it. Escape fades the viewer out
    // instead of the popover's closing, which is the keydown's default
    // action.
    document.addEventListener('keydown', event => {
      if (!cover.matches(':popover-open') || !['Tab', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') close();
    });
    // on a resize, turning a phone for example: the same zoom relative to
    // home, with the same point at the middle of the screen
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
      // A trackpad pinch comes as a wheel event with ctrl, in smaller steps.
      // A mouse wheel with ctrl is held to 100px a notch.
      const pixels = event.deltaY * [1, 16, innerHeight][event.deltaMode];
      const step = Math.max(-100, Math.min(100, pixels)) * (event.ctrlKey ? 0.01 : 0.002);
      zoomTo(zoom * Math.exp(-step), event.clientX, event.clientY);
    }, { passive: false });
    // Safari's pinch on a trackpad, which is not a wheel event. Its pinch on
    // a touch screen is handled by the pointer events below.
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
    // Dragging moves the picture. Two fingers also zoom as they spread or
    // close. The click at the end of a drag is ignored.
    let dragged = false, touch = false, tapped = -Infinity, from, last;
    const both = () => {
      const [a, b = a] = pointers.values();
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, apart: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    cover.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      // A first finger starts afresh: a pointer Safari on iOS lost track of,
      // or a press held for its menu, is not still down.
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
    // on pointerup, pointercancel, or the viewer closing mid-drag
    cover.addEventListener('lostpointercapture', event => {
      pointers.delete(event.pointerId);
      if (pointers.size) last = both();
      else cover.classList.remove('tex8web-dragging');
    });
    // by position, not target: the cover holds the pointer capture, so the
    // click goes to the cover
    const on = event => {
      const box = picture.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom;
    };
    // waits as long as the fade out takes, which is 0 if the reader prefers
    // reduced motion
    const close = () => {
      if (cover.classList.contains('tex8web-closing')) return;
      cover.classList.add('tex8web-closing');
      setTimeout(() => {
        cover.hidePopover();
        cover.classList.remove('tex8web-closing');
        clicked?.blur();
      }, 1000 * parseFloat(getComputedStyle(cover).transitionDuration));
    };
    const twice = event => {
      if (!on(event)) return;
      if (zoom > home) center(true);
      else zoomTo(2.5 * home, event.clientX, event.clientY, true);
    };
    // a double tap found from its two clicks: Safari on iOS sends no
    // dblclick where touch-action is none
    cover.addEventListener('click', event => {
      if (dragged) return;
      if (!on(event)) close();
      else if (touch && event.timeStamp - tapped < 300) {
        tapped = -Infinity;
        twice(event);
      } else tapped = event.timeStamp;
    });
    cover.addEventListener('dblclick', event => { if (!touch) twice(event); });
  }

  // each feature separately: tex8web-head.js has already marked the page as
  // scripted, so one failed feature would leave the other features'
  // controls dead and the table of contents collapsed
  for (const feature of [up, theme, column, bar, restore, anchor, smooth, sidenotes, edges, contents, filter, previews, viewer]) {
    try {
      feature();
    } catch (error) {
      console.error(`tex8web: ${feature.name} failed`, error);
    }
  }
})();
