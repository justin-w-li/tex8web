// npm run test:page: what the page's script does that no screenshot shows,
// driven in headless Chrome on the pages of the fixtures that have the
// feature: the picture viewer by mouse, by finger and by keyboard, the narrow
// screen's bar, the fade of a display that scrolls, the theme button, the
// contents (its filter, the subsections shown, its chevrons, and every
// entry where all fit), the page when one feature of the script fails, the
// fonts' preloads, and the transition from one page of a site to another.
// Each check fails if its fixture lacks what it drives, and waits for a
// state the page reaches rather than for a time. The checks run once the
// builds are done.
//   node test/page.mjs [check names...]
import { cpSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, pool, select, testDir, workers } from './lib/build.mjs';
import { launch, until } from './lib/chrome.mjs';

// every animation and transition on the page finished
const finished = page => page.evaluate(
  'Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))).then(() => true)');

// where, in the picture's closer view (tex8web-page.js), the picture is, and
// whether the view is open
const viewState = `(() => {
  const cover = document.querySelector('.tex8web-viewer'), img = cover.querySelector('img');
  const box = img.getBoundingClientRect(), plate = img.parentElement.getBoundingClientRect();
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return { open: cover.matches(':popover-open'), laid: Number(img.parentElement.style.getPropertyValue('--tex8web-zoom')), width: img.offsetWidth,
    at: [box.left, box.top], size: [box.width, box.height], plate: [plate.left, plate.top, plate.width, plate.height],
    view: [innerWidth, innerHeight], natural: img.naturalWidth, svg: /\\.svg$/i.test(img.getAttribute('src')),
    room: [innerWidth, innerHeight].map(n => n - 2 * Math.max(rem, 0.04 * Math.min(innerWidth, innerHeight)) - rem) };
})()`;

// the center of the first picture that opens the view, scrolled into view
const zoomableAt = `(() => {
  const img = document.querySelector('.tex8web-zoomable');
  if (!img) return null;
  img.scrollIntoView({ block: 'center' });
  const box = img.getBoundingClientRect();
  return [box.left + box.width / 2, box.top + box.height / 2];
})()`;

// the closer view with the mouse: which pictures open it, and on the first,
// that it fits the screen, that the wheel and a double-click zoom around the
// pointer (the latter in one motion, which is paused at three points to
// look at it), that the picture is dragged, but not off the middle of the
// screen, and laid out again when the zoom stops, and that it closes
async function viewing(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, {}, async page => {
    const problems = [];
    const click = async (x, y, count = 1) => {
      await page.mouse('pressed', x, y, { clickCount: count });
      await page.mouse('released', x, y, { clickCount: count });
    };
    const state = () => page.evaluate(viewState);
    // where the plate should be, from where it would be: anywhere the
    // picture still covers the middle of the screen
    const placed = (s, at) => at.map((a, i) => Math.min(s.view[i] / 2, Math.max(s.view[i] / 2 - s.plate[2 + i], a)));
    const off = (s, want) => Math.max(...want.slice(0, 2).map((w, i) => Math.abs(s.plate[i] - w)));
    // (a picture in a figure or display math opens it; an icon in the text,
    // up to one and a half times as tall, doesn't)
    const wrong = await page.evaluate(`[...document.querySelectorAll('img:not(.tex8web-viewer img, a img)')]
      .filter(img => img.closest('figure, .mathjax-block') ? !img.classList.contains('tex8web-zoomable')
        : img.classList.contains('tex8web-zoomable') && img.offsetHeight <= 1.5 * parseFloat(getComputedStyle(img).fontSize))
      .map(img => img.getAttribute('src'))`);
    if (wrong.length) problems.push(`opening the viewer or not, wrongly: ${wrong.join(', ')}`);
    const at = await page.evaluate(zoomableAt);
    if (!at) return [...problems, 'no picture that opens the viewer'];
    await click(...at);
    // as large as the screen allows (zoom 1), or a picture of pixels at its
    // own size if smaller (home)
    const fit = await until(state, s => s.open && s.natural > 0);
    if (!fit) return [...problems, 'a picture clicked: no viewer'];
    const fitted = Math.min(fit.room[0], fit.room[1] * fit.size[0] / fit.size[1]);
    const home = fit.svg ? 1 : Math.min(1, fit.natural / fitted);
    const zoom = s => s.size[0] / fitted;
    const centered = s => s.view.map((v, i) => (v - s.plate[2 + i]) / 2);
    if (Math.abs(zoom(fit) - home) > 0.001 || !(off(fit, centered(fit)) <= 0.5)) {
      problems.push(`the viewer's picture ${fit.size.join('x')} at ${fit.at.join(', ')}, for ${fit.room.join('x')} (${fit.natural}px wide)`);
    }
    const p = [Math.round(fit.at[0] + 0.3 * fit.size[0]), Math.round(fit.at[1] + 0.3 * fit.size[1])];
    // the plate zoomed to z around q, from s
    const zoomed = (now, s, z, what, q = p) => {
      const want = placed(now, s.plate.slice(0, 2).map((a, i) => q[i] - (q[i] - a) * z / zoom(s)));
      if (Math.abs(zoom(now) - z) > 0.001 || !(off(now, want) <= 0.5)) {
        problems.push(`${what}: zoom ${zoom(now).toFixed(3)} (not ${z.toFixed(3)}), at ${now.plate.slice(0, 2).join(', ')} (not ${want.join(', ')})`);
      }
    };
    // (a notch at a time, as each may be kept to the middle of the screen)
    const wheel = async (s, deltaY, notches, what) => {
      for (let i = 0; i < notches; i++) {
        await page.mouse('wheel', ...p, { deltaY });
        const now = await state();
        zoomed(now, s, Math.min(4, Math.max(home / 2, zoom(s) * Math.exp(-deltaY * 0.002))), what);
        s = now;
      }
      return s;
    };
    const wheeled = await wheel(fit, -100, 3, 'the wheel turned');
    // once the zoom has stopped, laid out again, where it was
    const settled = await until(state, s => Math.abs(s.laid - zoom(s)) < 0.001);
    if (!settled || Math.abs(settled.width - settled.size[0]) > 0.5
      || Math.abs(settled.size[0] - wheeled.size[0]) > 0.5
      || !(Math.max(...settled.at.map((at, i) => Math.abs(at - wheeled.at[i]))) <= 0.5)) {
      problems.push(`the wheel stopped: ${settled ? `${settled.width}px wide laid out, ${settled.size[0]}px shown at ${settled.at.join(', ')}` : 'not laid out again'}, from ${wheeled.size[0]}px at ${wheeled.at.join(', ')}`);
    }
    // (far enough to reach the middle of the screen)
    await page.mouse('pressed', ...p);
    for (let i = 1; i <= 8; i++) await page.mouse('moved', p[0] + 100 * i, p[1] + 100 * i);
    await page.mouse('released', p[0] + 800, p[1] + 800);
    const dragged = await state();
    const want = placed(dragged, wheeled.plate.slice(0, 2).map(a => a + 800));
    if (Math.abs(zoom(dragged) - zoom(wheeled)) > 0.001 || !(off(dragged, want) <= 0.5)) {
      problems.push(`dragged by 800px: zoom ${zoom(dragged)}, at ${dragged.plate.slice(0, 2).join(', ')} (not ${want.join(', ')})`);
    }
    // (past where it started, to half that)
    const out = await wheel(dragged, 100, 8, 'the wheel turned back');
    // a double-click on the picture, where the drag left it: the point stays
    // under the pointer all the way (css/tex8web.css eases it), in one
    // motion. That is a transition, which is paused at a quarter, a half and
    // three quarters of it as it starts, so that the picture isn't laid out
    // again between them
    const q = out.at.map((a, i) => Math.round(a + out.size[i] / 2));
    await page.evaluate(`(() => {
      const plate = document.querySelector('.tex8web-plate');
      window.eased = null;
      plate.addEventListener('transitionrun', event => {
        if (event.propertyName !== 'transform' || window.eased) return;
        const motion = plate.getAnimations().find(a => a.transitionProperty === 'transform');
        motion.pause();
        const duration = motion.effect.getComputedTiming().duration;
        window.eased = [0.25, 0.5, 0.75].map(part => { motion.currentTime = part * duration; return ${viewState}; });
      });
    })()`);
    await click(...q);
    await click(...q, 2);
    const eased = await until(() => page.evaluate('window.eased'));
    if (!eased) problems.push('a double-click: no motion to zoom in');
    else {
      for (const now of eased) zoomed(now, out, zoom(now), 'during a double-click', q);
      if (!eased.every(now => zoom(now) > home && zoom(now) < 2.5 * home)) {
        problems.push('a double-click: no zoom between where it started and 2.5 times that on the way');
      }
    }
    const zoomedIn = await until(state, s => Math.abs(s.laid - 2.5 * home) < 0.001);
    if (zoomedIn) zoomed(zoomedIn, out, 2.5 * home, 'a double-click', q);
    else problems.push(`a double-click: not at zoom ${2.5 * home}`);
    await click(...q);
    await click(...q, 2);
    const back = await until(state, s => Math.abs(s.laid - home) < 0.001);
    if (!back || !(off(back, centered(back)) <= 0.5)) {
      problems.push(`a second double-click: ${back ? `at ${back.plate.slice(0, 2).join(', ')}` : `not at zoom ${home}`}`);
    }
    // (from beside the picture to beside it, the picture moving along: a
    // drag, not a click beside it; then a click beside it)
    await page.mouse('pressed', 2, 2);
    for (let i = 1; i <= 4; i++) await page.mouse('moved', 2 + 10 * i, 2 + 10 * i);
    await page.mouse('released', 42, 42);
    const beside = await state();
    if (beside.at[0] <= 42 && beside.at[1] <= 42) problems.push('a drag beside the picture: ended on it');
    else if (!beside.open) problems.push('a drag ending beside the picture closed the viewer');
    // (the keyboard stays off the page behind)
    const focused = await page.evaluate('document.activeElement.outerHTML.slice(0, 80)');
    await page.press('Tab', 9);
    if (await page.evaluate('document.activeElement.outerHTML.slice(0, 80)') !== focused) problems.push('Tab: the focus behind the viewer moved');
    await page.press('Escape', 27);
    if (!await until(state, s => !s.open)) problems.push('Escape: the viewer still open');
    await page.evaluate(zoomableAt);
    await click(...at);
    if (!await until(state, s => s.open)) problems.push('a picture clicked again: no viewer');
    await finished(page);
    // (fading out still open, in the top layer: Safari would draw it under
    // the page's bar, or, on iOS, not at all)
    await click(2, 2);
    const fading = await page.evaluate(`(() => {
      const cover = document.querySelector('.tex8web-viewer');
      const fade = cover.getAnimations().find(a => a.transitionProperty === 'opacity');
      if (!fade || !cover.matches(':popover-open')) return null;
      fade.pause();
      fade.currentTime = fade.effect.getComputedTiming().duration / 2;
      return Number(getComputedStyle(cover).opacity);
    })()`);
    if (!(fading > 0 && fading < 1)) problems.push(`a click beside the picture: no fade out (${fading})`);
    if (!await until(state, s => !s.open)) problems.push('a click beside the picture: the viewer still open');
    return problems;
  });
}

// the closer view with a finger, on a phone's screen: a double tap zooms
// in (Safari on iOS sends no dblclick) but a single one, however soon after
// the page loads, doesn't, and turning the phone keeps the point at the
// middle of the screen where it was in the picture
async function touching(chrome, file) {
  // (every event stamped 100 ms, so that a first tap is "soon after the
  // page loaded" whenever it comes, and two taps are always one apart)
  const before = `Object.defineProperty(Event.prototype, 'timeStamp', { get: () => 100 })`;
  return chrome.withPage(pathToFileURL(file).href, { width: 400, height: 800, before }, async page => {
    const problems = [];
    const state = () => page.evaluate(`(() => {
      const cover = document.querySelector('.tex8web-viewer'), img = cover.querySelector('img'), box = img.getBoundingClientRect();
      return { open: cover.matches(':popover-open'), laid: Number(img.parentElement.style.getPropertyValue('--tex8web-zoom')),
        view: [innerWidth, innerHeight], middle: [(innerWidth / 2 - box.left) / box.width, (innerHeight / 2 - box.top) / box.height] };
    })()`);
    const at = await page.evaluate(zoomableAt);
    if (!at) return ['no picture that opens the viewer'];
    await page.tap(...at);
    const opened = await until(state, s => s.open);
    if (!opened) return ['a picture tapped: no viewer'];
    await page.evaluate(`window.clicks = 0; document.querySelector('.tex8web-viewer').addEventListener('click', () => clicks++)`);
    const plate = `document.querySelector('.tex8web-plate').style.transform`;
    const start = await page.evaluate(plate);
    for (const n of [1, 2]) {
      await page.tap(200, 400);
      if (!await until(() => page.evaluate('clicks'), c => c === n)) return [`a double tap: no click from tap ${n}`];
      if (n === 1 && await page.evaluate(plate) !== start) return ['a first tap zoomed in, as a double tap'];
    }
    const zoomed = await until(state, s => s.laid > 2 * opened.laid);
    if (!zoomed) return [`a double tap: not zoomed in from ${opened.laid}`];
    await page.resize(800, 400);
    await page.frame();
    const turned = await until(state, s => s.view[0] === 800);
    if (!turned) return ['turned: the window never became 800px wide'];
    if (turned.middle.some((m, i) => !(Math.abs(m - zoomed.middle[i]) < 0.002))) {
      problems.push(`turned: the picture at ${turned.middle.join(', ')} of it in the middle, not ${zoomed.middle.join(', ')}`);
    }
    return problems;
  });
}

// the contents' filter: a named theorem found by its head (or a numbered
// box by its title), first among what matches, and Enter going to it;
// then, among the many with an e, down twice and up once choosing the
// second, which Enter goes to; and test.tex's ε-ball found by \epsilon,
// its ε typeset
async function filtering(chrome, file, doc) {
  return chrome.withPage(pathToFileURL(file).href, { width: 1600 }, async page => {
    const problems = [];
    const head = await page.evaluate(`(() => {
      const input = document.querySelector('.tex8web-toc-filter');
      const head = [...document.querySelectorAll('.newtheorem .head, .tcolorbox-title')]
        .find(h => h.querySelector(':scope > .tex8web-permalink')
          && (h.matches('.tcolorbox-title') || /\\(.+\\)/.test(h.textContent)));
      if (!input) return 'none';
      if (!head) return null;
      input.focus();
      input.value = head.textContent.replace('#', '').replace(/\\.\\s*$/, '');
      input.dispatchEvent(new Event('input'));
      return head.querySelector('.tex8web-permalink').hash;
    })()`);
    if (head === 'none') return ['filter: none beside the table of contents'];
    if (!head) return ['filter: no named theorem or titled box to find'];
    const first = await page.evaluate(`document.querySelector('.tex8web-toc-results a')?.hash`);
    if (first !== head) problems.push(`filter: ${first} first, not the theorem ${head}`);
    // (naming what the page has)
    const placeholder = await page.evaluate(`document.querySelector('.tex8web-toc-filter').placeholder`);
    if (doc.name === 'test' && placeholder !== 'Find a section, theorem, or term') problems.push(`filter: placeholder "${placeholder}"`);
    const label = await page.evaluate(`document.querySelector('.tex8web-toc-filter').getAttribute('aria-label')`);
    if (label !== placeholder) problems.push(`filter: named "${label}", not "${placeholder}"`);
    const hash = () => page.evaluate('location.hash');
    await page.press('Enter', 13);
    if (!await until(hash, h => h === head)) problems.push(`filter: Enter went to ${await hash()}, not ${head}`);
    const second = await page.evaluate(`(() => {
      const input = document.querySelector('.tex8web-toc-filter');
      input.focus();
      input.value = 'e';
      input.dispatchEvent(new Event('input'));
      return document.querySelectorAll('.tex8web-toc-results a')[1]?.hash;
    })()`);
    if (!second) problems.push('filter: fewer than two entries with an e');
    else {
      for (const [key, code] of [['ArrowDown', 40], ['ArrowDown', 40], ['ArrowUp', 38], ['Enter', 13]]) await page.press(key, code);
      if (!await until(hash, h => h === second)) problems.push(`filter: arrows and Enter went to ${await hash()}, not ${second}`);
    }
    const ball = await page.evaluate(`(() => {
      if (!document.getElementById('term-ball')) return null;
      const input = document.querySelector('.tex8web-toc-filter');
      input.value = '\\\\epsilon ball';
      input.dispatchEvent(new Event('input'));
      const a = document.querySelector('.tex8web-toc-results a');
      return [a?.hash, !!a?.querySelector('mjx-container')];
    })()`);
    if (!ball) {
      if (doc.name === 'test') problems.push('filter: no term to find by its TeX');
    } else if (ball[0] !== '#term-ball' || !ball[1]) {
      problems.push(`filter: \\epsilon ball found ${ball[0]}, ${ball[1] ? '' : 'not '}typeset`);
    }
    return problems;
  });
}

// on a phone's screen, the bar naming the section being read: nothing
// before the first heading, then a section halfway down scrolled just above
// the top quarter, where the page starts naming it (higher, a short section
// would bring the next heading above that line too); and tapped, opening
// the table of contents
async function naming(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 390, height: 844 }, async page => {
    const problems = [];
    const shown = `(() => {
      const where = document.querySelector('.tex8web-where');
      return where.hidden ? '' : where.textContent.replace(/\\s+/g, ' ').trim();
    })()`;
    const [before, want] = await page.evaluate(`(() => {
      const links = [...document.querySelectorAll('#tex8web-toc .tableofcontents a')];
      const a = links[links.length >> 1];
      if (!a) return [];
      const first = document.getElementById(decodeURIComponent(links[0].hash.slice(1)));
      const before = first.getBoundingClientRect().top > innerHeight / 4 ? ${shown} : '';
      const el = document.getElementById(decodeURIComponent(a.hash.slice(1)));
      scrollTo(0, scrollY + el.getBoundingClientRect().top - (innerHeight / 4 - 10));
      if (el.getBoundingClientRect().top > innerHeight / 4) return [];
      const copy = a.cloneNode(true);
      copy.querySelectorAll('mjx-assistive-mml').forEach(n => n.remove());
      return [before, copy.textContent.replace(/\\s+/g, ' ').trim()];
    })()`);
    if (want === undefined) return ['bar: no section halfway down that scrolls to the top quarter'];
    if (before) problems.push(`bar: "${before}" before the first heading`);
    const got = await until(() => page.evaluate(shown), name => name.endsWith(want));
    if (got === null) problems.push(`bar: "${await page.evaluate(shown)}", not the section "${want}"`);
    // (as MathJax typesetting the entry would change it)
    await page.evaluate(`document.querySelector('#tex8web-toc [aria-current] ').append(' (changed)')`);
    if (!await until(() => page.evaluate(shown), name => name.endsWith('(changed)'))) {
      problems.push('bar: not following a change in its entry');
    }
    const opened = await page.evaluate(`(() => {
      document.querySelector('.tex8web-where').click();
      return document.getElementById('tex8web-toc').matches(':popover-open');
    })()`);
    if (!opened) problems.push('bar: tapped, no table of contents');
    return problems;
  });
}

// on a phone's screen, the controls' bar (tex8web-page.js) away scrolling
// down, back scrolling up, but not for a pixel or two the other way
async function hiding(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 390, height: 844 }, async page => {
    const away = await page.evaluate(`(async () => {
      const away = [];
      if (document.documentElement.scrollHeight < 1600) return null;
      for (const y of [300, 600, 597, 560, 563]) {
        scrollTo(0, y);
        await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
        away.push(document.querySelector('.tex8web-controls').classList.contains('tex8web-away'));
      }
      return away;
    })()`);
    if (!away) return ['the bar: a page too short to scroll'];
    const problems = away.join() === 'true,true,true,false,false'
      ? [] : [`the bar away ${away.join(', ')} scrolling to 300, 600, 597, 560 and 563px`];
    // its line and background: clear at the top, drawn once the page has scrolled (and faded in)
    const clear = 'rgba(0, 0, 0, 0)';
    const look = async y => {
      await page.evaluate(`scrollTo(0, ${y})`);
      await page.frame();
      return page.evaluate(`new Promise(done => setTimeout(() => {
        const style = getComputedStyle(document.querySelector('.tex8web-controls'));
        done([style.borderBottomColor, style.backgroundColor]);
      }, 400))`);
    };
    const [top, down] = [await look(0), await look(20)];
    if (top[0] !== clear) problems.push(`the bar's line ${top[0]} at the top`);
    if (top[1] !== clear) problems.push(`the bar's background ${top[1]} at the top`);
    if (down[0] === clear) problems.push("the bar's line clear 20px down");
    if (down[1] === clear) problems.push("the bar's background clear 20px down");
    // from a wide window, scrolled down, to a narrow one: away at once
    await page.resize(1600, 900);
    await page.frame();
    await page.evaluate('scrollTo(0, 600)');
    await page.resize(390, 844);
    await page.frame();
    const narrowed = await page.evaluate(`[document.querySelector('.tex8web-controls').classList.contains('tex8web-away'),
      document.getAnimations().map(a => a.transitionProperty).join()]`);
    if (!narrowed[0]) problems.push('the bar not away after a wide window narrowed, scrolled down');
    if (narrowed[1]) problems.push(`moving (${narrowed[1]}) as a wide window narrowed`);
    await page.resize(1600, 900);
    await page.frame();
    const widened = await page.evaluate(`document.getAnimations().map(a => a.transitionProperty).join()`);
    if (widened) problems.push(`moving (${widened}) as a narrow window widened`);
    return problems;
  });
}

// on a phone's screen, a page that lands partway down, by a link's # or by
// the browser's reload, keeps its bar shown with its line, and nothing
// moves: the browser's own scrolling is not the reader's
async function landing(chrome, file) {
  const url = pathToFileURL(file).href;
  const size = { width: 390, height: 844 };
  const runs = `window.__runs = [];
    addEventListener('transitionrun', e => e.target.matches?.('.tex8web-controls') && __runs.push(e.propertyName), true)`;
  const id = await chrome.withPage(url, size, page => page.evaluate(`[...document.querySelectorAll('h2[id], h3[id]')]
    .find(h => h.getBoundingClientRect().top + scrollY > 1000 && h.getBoundingClientRect().top + scrollY < document.documentElement.scrollHeight - innerHeight)?.id`));
  if (!id) return ['landing: no heading far enough down to link to'];
  const state = `new Promise(done => setTimeout(() => {
    const controls = document.querySelector('.tex8web-controls');
    done([scrollY, controls.classList.contains('tex8web-away'), getComputedStyle(controls).borderBottomColor, __runs.join()]);
  }, 500))`;
  const problems = [];
  const judge = (how, [y, away, line, moved]) => {
    if (y < 500) problems.push(`landing by ${how}: at ${y}px, not partway down`);
    if (away) problems.push(`landing by ${how}: the bar away`);
    if (line === 'rgba(0, 0, 0, 0)') problems.push(`landing by ${how}: no line under the bar`);
    if (moved) problems.push(`landing by ${how}: moving (${moved})`);
  };
  await chrome.withPage(`${url}#${id}`, { ...size, before: runs }, async page => judge('a link', await page.evaluate(state)));
  await chrome.withPage(url, { ...size, before: runs }, async page => {
    await page.evaluate('scrollTo(0, 1500)');
    await page.frame();
    await page.evaluate('window.__old = true; location.reload()');
    if (!await until(() => page.evaluate(`!window.__old && document.readyState === 'complete'`))) {
      problems.push('landing by reload: not loaded again');
      return;
    }
    judge('reload', await page.evaluate(state));
  });
  return problems;
}

// the fade of a display that scrolls on a phone's screen, by its two masks'
// positions. At its start, only the right edge fades; 20px in, the left
// fades halfway; in the middle, both; 20px from its end, the right
// halfway; at its end, only the left. Nothing that doesn't scroll is
// masked: one that fits, one that stops scrolling at its end on a wider
// screen or in print, and one the keyboard has focused. A display copied
// into a preview card fades as it scrolls there
async function fading(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 390, height: 844 }, async page => {
    // (a display's copy in a preview card, which may be wider than the text)
    const [cards, shown] = await page.evaluate(`(() => {
      const links = document.querySelectorAll('a[href*="#"]:not(.tex8web-permalink, #tex8web-toc a, .tex8web-preview a)');
      let wrong = 0, shown = 0;
      for (const a of links) {
        a.focus({ focusVisible: true });
        for (const d of document.querySelectorAll('.tex8web-preview mjx-container[display]')) {
          const hidden = d.scrollWidth - d.clientWidth, style = getComputedStyle(d);
          const edge = 2.5 * parseFloat(style.fontSize);
          const want = hidden > 0 ? \`-\${edge}px 0px, -\${Math.min(hidden, edge)}px 0px\` : 'none';
          if ((style.maskImage === 'none' ? 'none' : style.maskPosition) !== want) wrong++;
          shown++;
        }
        a.blur();
      }
      return [wrong, shown];
    })()`);
    const problems = cards ? [`${cards} displays in preview cards with a fade that doesn't match their scroll`] : [];
    if (!shown) problems.push('no display in a preview card, for its fade');
    const index = await page.evaluate(`[...document.querySelectorAll('mjx-container[display]')]
      .findIndex(d => d.scrollWidth - d.clientWidth > 200)`);
    if (index < 0) return [...problems, 'no display that scrolls on a phone, for its fade'];
    const display = `document.querySelectorAll('mjx-container[display]')[${index}]`;
    const mask = async scroll => {
      if (scroll !== undefined) await page.evaluate(`${display}.scrollLeft = ${scroll}`);
      await page.frame();
      return page.evaluate(`(s => s.maskImage === 'none' ? 'none' : s.maskPosition)(getComputedStyle(${display}))`);
    };
    const [range, size] = await page.evaluate(`[${display}.scrollWidth - ${display}.clientWidth,
      parseFloat(getComputedStyle(${display}).fontSize)]`);
    const edge = 2.5 * size, half = edge / 2;
    const want = [[0, -edge, -edge], [half, -half, -edge], [100, 0, -edge], [range - half, 0, -half], [range, 0, 0]];
    for (const [scroll, left, right] of want) {
      const positions = `${left}px 0px, ${right}px 0px`.replace(/-0px/g, '0px');
      const got = await mask(scroll);
      if (got !== positions) problems.push(`a display that scrolls, scrolled ${scroll}px: mask ${got}, not ${positions}`);
    }
    const masked = `[...document.querySelectorAll('mjx-container[display], div.tabular, pre')]
      .filter(d => (d.scrollWidth <= d.clientWidth || getComputedStyle(d).overflowX === 'visible')
        && getComputedStyle(d).maskImage !== 'none').length`;
    const fits = await page.evaluate(masked);
    if (fits) problems.push(`${fits} displays, tabulars or verbatims that don't scroll, masked`);
    await page.evaluate(`${display}.focus({ focusVisible: true })`);
    if (await mask() !== 'none') problems.push('a display that scrolls, focused: masked, hiding the focus ring');
    await page.evaluate(`${display}.blur()`);
    const ends = `for (const d of document.querySelectorAll('mjx-container[display], div.tabular, pre')) d.scrollLeft = d.scrollWidth`;
    await page.evaluate(ends);
    await page.frame();
    await page.resize(1600, 900);
    await page.frame();
    const wide = await page.evaluate(masked);
    if (wide) problems.push(`${wide} displays, tabulars or verbatims scrolled to their end, then fitting a wider screen, masked`);
    await page.resize(390, 844);
    await page.evaluate(ends);
    await page.frame();
    await page.media('print');
    await page.frame();
    const printed = await page.evaluate(masked);
    if (printed) problems.push(`${printed} displays, tabulars or verbatims scrolled to their end, then printed, masked`);
    return problems;
  });
}

// the theme button there before tex8web-page.js runs, with the other controls
// (a long page is drawn well before its deferred scripts run). With
// JavaScript off it is hidden, which visual.mjs checks on every page
async function themed(chrome, file) {
  const early = file.replace(/\.html$/, '.early.html');
  const html = readFileSync(file, 'utf8');
  const without = html.replace(/<script [^>]*src='tex8web-page\.js'[^>]*><\/script>/, '');
  if (without === html) return ['no script for tex8web-page.js to leave out'];
  writeFileSync(early, without);
  try {
    const shown = await chrome.withPage(pathToFileURL(early).href, {},
      page => page.evaluate(`document.querySelector('.tex8web-theme').checkVisibility()`));
    return shown ? [] : ['the theme button hidden with JavaScript on, before tex8web-page.js runs'];
  } finally {
    rmSync(early);
  }
}

// a link to an equation tints it, as it does a heading, once whether tex4ht's
// anchor is just before it, first among the anchors of an alignment's lines
// or, for a gather, last in the paragraph before; and not the others around,
// nor a link to another anchor, such as an \index's (dx...) before an equation
async function targeting(chrome, file, doc) {
  const displays = `document.querySelectorAll('.mathjax-env, .mathjax-block')`;
  const tinted = `[...${displays}].map(el => getComputedStyle(el.querySelector('mjx-container')).backgroundColor !== 'rgba(0, 0, 0, 0)')`;
  // (the anchors with only space and comments between them and the display,
  // or, failing those, ending the paragraph before it; and every other)
  const anchors = `(() => {
    const skip = n => n && (n.nodeType === 8 || (n.nodeType === 3 && !n.textContent.trim()));
    const before = n => { n = n.previousSibling; while (skip(n)) n = n.previousSibling; return n; };
    const last = el => { let n = el.lastChild; while (skip(n)) n = n.previousSibling; return n; };
    const run = n => {
      const ids = [];
      for (; n?.nodeType === 1 && n.matches('a[id]:empty'); n = before(n)) if (!n.id.startsWith('dx')) ids.unshift(n.id);
      return [ids, n];
    };
    const belong = [...${displays}].map(display => {
      const [ids, stop] = run(before(display));
      return ids.length || !stop?.matches?.('p') ? ids : run(last(stop))[0];
    });
    const others = [...document.querySelectorAll('main a[id]:empty')].map(a => a.id).filter(id => !belong.flat().includes(id));
    return { belong, others };
  })()`;
  return chrome.withPage(pathToFileURL(file).href, {}, async page => {
    const { belong, others } = await page.evaluate(anchors);
    if (!belong.some(ids => ids.length)) return ['no equation with an anchor'];
    // (the index's anchors just before the equation, and after some text before it)
    if (doc.name === 'test-index' && !(belong[0].length === 1 && others.filter(id => id.startsWith('dx')).length > 5)) {
      return [`test-index: the equation's anchors ${belong[0]}, and the others ${others.length}`];
    }
    if (doc.name === 'test-generic' && !belong.some(ids => ids.length > 1)) return ['no alignment with an anchor on each of two lines'];
    const problems = [];
    const show = async (id, only) => {
      await page.evaluate(`location.hash = '#${id}'`);
      const now = await page.evaluate(tinted);
      if (now.some((on, i) => on !== (i === only))) problems.push(`#${id}: tinted ${now.map(on => +on).join('')}, not ${only === undefined ? 'none' : `only the display ${only}`}`);
    };
    for (const [i, ids] of belong.entries()) for (const id of ids) await show(id, i);
    for (const id of others) await show(id);
    return problems;
  });
}

// the closer view from the keyboard: a picture takes the focus, Enter or
// Space opens the view with the focus inside it, and closing it, by Escape,
// gives the focus back to the picture (which the popover does itself, so
// this can't tell the page's own focus() from that). Space, which pages
// down, doesn't open it again after the picture was clicked, or with Shift
async function keying(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, {}, async page => {
    const problems = [];
    const state = () => page.evaluate(`(() => {
      const cover = document.querySelector('.tex8web-viewer');
      return { open: cover.matches(':popover-open'), inside: cover.contains(document.activeElement) };
    })()`);
    if (!await page.evaluate(zoomableAt)) return ['no picture that opens the viewer'];
    const focus = () => page.evaluate(`(() => {
      const img = document.querySelector('.tex8web-zoomable');
      img.focus();
      return document.activeElement === img;
    })()`);
    for (const [name, key, code] of [['Enter', 'Enter', 13], ['Space', ' ', 32]]) {
      if (!await focus()) return [...problems, 'a picture that opens the viewer takes no focus'];
      await page.press(key, code);
      const open = await until(state, s => s.open);
      if (!open) return [...problems, `${name} on a picture: no viewer`];
      if (!open.inside) problems.push(`${name} on a picture: the focus not in the viewer`);
      await page.press('Escape', 27);
      const back = await until(() => page.evaluate(`!document.querySelector('.tex8web-viewer').matches(':popover-open')
        && document.activeElement === document.querySelector('.tex8web-zoomable')`));
      if (!back) problems.push(`Escape after ${name}: the focus not back on the picture`);
    }
    // (clicked open, clicked closed beside the picture, the focus back on it)
    const [x, y] = await page.evaluate(zoomableAt);
    for (const type of ['pressed', 'released']) await page.mouse(type, x, y);
    if (!await until(state, s => s.open)) return [...problems, 'a picture clicked: no viewer'];
    for (const type of ['pressed', 'released']) await page.mouse(type, 2, 2);
    if (!await until(state, s => !s.open)) return [...problems, 'a click beside the picture: the viewer still open'];
    await page.press(' ', 32);
    await page.frame();
    if ((await state()).open) problems.push('Space after a click on the picture opened the viewer again');
    await focus();
    await page.press('Enter', 13, 8);
    await page.frame();
    if ((await state()).open) problems.push('Shift-Enter on a picture opened the viewer');
    await page.press('Enter', 13);
    if (!await until(state, s => s.open)) problems.push('Enter on a picture after a click: no viewer');
    return problems;
  });
}

// the page typeset by MathJax in the browser (built with
// TEX8WEB_NO_PRERENDER), which comes after the page's script has run, as it
// does on a slow network: the bar's copy of a heading with math is typeset
// while the contents are closed, and a display that scrolls fades at its edge.
// MathJax is loaded by the check, once the page's script has run. The build
// is made here, as only this check wants it
async function lazily(chrome, [doc]) {
  const dir = testDir(doc, 'pagelazy');
  const out = join(dir, 'html');
  const { code } = await build(doc, out, join(dir, 'aux'), { TEX8WEB_NO_PRERENDER: '1' });
  if (code !== 0) return ['build failed'];
  const file = join(out, doc.tex.replace(/\.tex$/, '.html')), late = file.replace(/\.html$/, '.late.html');
  const html = readFileSync(file, 'utf8');
  const loader = html.match(/<script [^>]*id='MathJax-script'[^>]*><\/script>/)?.[0];
  if (!loader) return ['no script for MathJax to leave out'];
  writeFileSync(late, html.replace(loader, ''));
  try {
    return await chrome.withPage(pathToFileURL(late).href, { width: 390, height: 844 }, async page => {
      const problems = [];
      await page.evaluate(`(() => {
        const script = document.createElement('script');
        script.src = ${JSON.stringify(loader.match(/src='([^']+)'/)[1])};
        script.async = true;
        document.head.append(script);
      })()`);
      const typeset = await until(() => page.evaluate(`!!window.MathJax?.startup?.promise`), Boolean, 30000);
      if (!typeset) return ["MathJax didn't load in 30s (offline?)"];
      // (ui/lazy leaves the closed drawer's math a placeholder, mjx-lazy,
      // which the bar copies)
      await page.evaluate(`MathJax.startup.promise.then(() => {
        const heading = document.querySelector('.subsectionHead');
        scrollTo(0, scrollY + heading.getBoundingClientRect().top - (innerHeight / 4 - 10));
      })`);
      const barMath = await until(() => page.evaluate(`(() => {
        const where = document.querySelector('.tex8web-where');
        return !where.hidden && !!where.querySelector('mjx-container mjx-math')
          && !document.getElementById('tex8web-toc').matches(':popover-open');
      })()`), Boolean, 5000);
      if (!barMath) problems.push("the bar's copy of a heading with math: not typeset before the contents open");
      await page.evaluate(`MathJax.startup.promise.then(() => MathJax.startup.document.lazyTypesetAll?.())
        .then(() => MathJax.startup.document.lazyPromise)`);
      const wide = `[...document.querySelectorAll('mjx-container[display]')]
        .filter(d => d.scrollWidth > d.clientWidth && getComputedStyle(d).overflowX !== 'visible')`;
      const scrolls = await page.evaluate(`${wide}.length`);
      if (!scrolls) return [...problems, 'no display that scrolls on a phone, for its fade'];
      const marked = await until(() => page.evaluate(`${wide}.every(d => d.classList.contains('tex8web-scrolls'))`));
      if (!marked) problems.push('a display typeset in the browser that scrolls: no fade at its edge');
      return problems;
    });
  } finally {
    rmSync(late);
  }
}

// the contents of a page whose first headings are subsections, before its
// first section, in a window too short for all of them: while one is read,
// those and the section's are shown, and then only the subsections of the
// section being read
async function opening(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 1600, height: 200 }, async page => {
    const shown = () => page.evaluate(`[...document.querySelectorAll('#tex8web-toc .tableofcontents > span')]
      .filter(entry => entry.checkVisibility()).map(entry => entry.textContent.replace(/\\s+/g, ' ').trim()).join('|')`);
    const problems = [];
    const leads = await shown();
    if (!/First.*lead.*Second lead.*Third lead.*First section$/.test(leads)) problems.push(`contents at the top show "${leads}"`);
    await page.evaluate(`scrollTo(0, scrollY + document.getElementById([...document.querySelectorAll(
      '#tex8web-toc .tableofcontents a')].at(-1).hash.slice(1)).getBoundingClientRect().top)`);
    const last = await until(shown, s => !s.includes('lead'));
    if (!last || !/First section\|.*Under the first$/.test(last)) problems.push(`contents at the last subsection show "${last ?? await shown()}"`);
    return problems;
  });
}

// on a wide touch screen, a closed section's chevron (its tap area larger
// than its line) last in a column that scrolls: the column scrolls no
// further than the entry
async function reaching(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 1600, height: 200, touch: true }, async page => {
    const [over, chevron] = await page.evaluate(`(() => {
      const toc = document.getElementById('tex8web-toc');
      const last = [...toc.querySelectorAll('.tableofcontents > span')].filter(entry => entry.checkVisibility()).at(-1);
      toc.scrollTop = toc.scrollHeight;
      return [toc.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom,
        last.querySelector('.tex8web-toc-more')?.getAttribute('aria-expanded')];
    })()`);
    if (chevron !== 'false') return ['the last entry shown not a closed section'];
    return over > 1 ? [`scrolled to the end, ${over}px below the last entry`] : [];
  });
}

// the contents' chevrons, by mouse. There's one on each section with
// subsections, at the column's inner edge. A section the reader opens
// slides open, and stays open as the page scrolls to a third section. That
// one opens without a slide, and the first, being left, closes. The section
// being read, once closed, stays closed while it's read, its entry marked.
// The opened section still stays open as a contents link leads back. (In
// a window too short for all the entries, which would show them all)
async function browsing(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 1600, height: 700 }, async page => {
    const problems = [];
    const state = `[...document.querySelectorAll('#tex8web-toc .tex8web-toc-more')].map(button => {
      let shown = 0;
      for (let el = button.parentElement.nextElementSibling; el && !el.querySelector('.tex8web-toc-more')
        && !el.matches('.sectionToc, .likesectionToc'); el = el.nextElementSibling) {
        if (el.checkVisibility()) shown++;
      }
      return button.getAttribute('aria-expanded') === 'true' ? shown : -shown;
    })`;
    const sections = await page.evaluate(`[...document.querySelectorAll('#tex8web-toc .tableofcontents > span')]
      .filter((el, i, all) => el.matches('.sectionToc') && all[i + 1]?.matches('.subsectionToc')).length`);
    let now = await page.evaluate(state);
    if (sections < 3 || now.length !== sections) return [`${now.length} chevrons for ${sections} sections with subsections (3 at least wanted)`];
    if (!(now[0] > 0 && now.slice(1).every(n => n === 0))) problems.push(`at the top, the sections show ${now} subsections`);
    const off = await page.evaluate(`(() => {
      const toc = document.getElementById('tex8web-toc');
      const edge = toc.getBoundingClientRect().right - parseFloat(getComputedStyle(toc).paddingRight);
      return Math.max(...[...toc.querySelectorAll('.tex8web-toc-more')].map(b => Math.abs(b.getBoundingClientRect().right - edge)));
    })()`);
    if (off > 0.5) problems.push(`a chevron ${off}px off the edge of the contents' text`);
    const click = async i => {
      const [x, y] = await page.evaluate(`(() => {
        const box = document.querySelectorAll('#tex8web-toc .tex8web-toc-more')[${i}].getBoundingClientRect();
        return [box.left + box.width / 2, box.top + box.height / 2];
      })()`);
      await page.mouse('pressed', x, y);
      await page.mouse('released', x, y);
    };
    await click(1);
    if (!await page.evaluate("document.getElementById('tex8web-toc').getAnimations({ subtree: true }).length")) problems.push('a section opened without a slide');
    await finished(page);
    now = await page.evaluate(state);
    if (!(now[1] > 0)) problems.push(`the second section opened shows ${now[1]} subsections`);
    await page.evaluate(`(() => {
      const a = document.querySelectorAll('#tex8web-toc .tex8web-toc-more')[2].parentElement.querySelector('a');
      scrollTo(0, scrollY + document.getElementById(decodeURIComponent(a.hash.slice(1))).getBoundingClientRect().top);
    })()`);
    now = await until(() => page.evaluate(state), n => n[2] > 0);
    if (!now) problems.push('scrolled to the third section, its subsections not shown');
    if (await page.evaluate("document.getElementById('tex8web-toc').getAnimations({ subtree: true }).length")) problems.push('the page scrolled, a slide in the contents');
    now = await page.evaluate(state);
    if (!(now[0] === 0 && now[1] > 0)) problems.push(`scrolled to the third section, the first two show ${now.slice(0, 2)} subsections`);
    await click(2);
    await finished(page);
    const read = await page.evaluate(`(() => {
      let el = document.querySelectorAll('#tex8web-toc .tex8web-toc-more')[2].parentElement;
      while (!el.matches('span')) el = el.nextElementSibling;
      do el = el.nextElementSibling; while (!el.matches('span'));
      const a = el.querySelector('a');
      scrollTo(0, scrollY + document.getElementById(decodeURIComponent(a.hash.slice(1))).getBoundingClientRect().top);
      return a.hash;
    })()`);
    if (!await until(() => page.evaluate(`document.querySelector('#tex8web-toc [aria-current]')?.hash`), hash => hash === read)) {
      problems.push('scrolled to the third section\'s first subsection, its entry not marked');
    }
    now = await page.evaluate(state);
    if (now[2] !== 0) problems.push(`closed, the third section shows ${now[2]} subsections`);
    const [section, reading] = await page.evaluate(`[document.querySelectorAll('#tex8web-toc .tex8web-toc-more')[2]
      .parentElement.querySelector('a'), document.querySelector('#tex8web-toc [aria-current]')]
      .map(a => getComputedStyle(a).backgroundColor)`);
    if (section !== reading) problems.push(`closed, the third section's entry in ${section}, not ${reading} as the one read`);
    const [x, y] = await page.evaluate(`(() => {
      const box = document.querySelector('#tex8web-toc .tex8web-toc-more').parentElement.querySelector('a').getBoundingClientRect();
      return [box.left + box.width / 2, box.top + box.height / 2];
    })()`);
    await page.mouse('pressed', x, y);
    await page.mouse('released', x, y);
    now = await until(() => page.evaluate(state), n => n[0] > 0);
    if (!now) problems.push('the first section\'s link followed, its subsections not shown');
    now = await page.evaluate(state);
    if (!(now[1] > 0 && now[2] === 0)) problems.push(`the first section's link followed, the next two show ${now.slice(1, 3)} subsections`);
    return problems;
  });
}

// the contents of a short page. Where all of them fit, in the column and
// in the narrow screen's open drawer, every entry is shown, and no chevron.
// Where they don't, a section neither read nor opened shows no subsections,
// and its chevron opens it. That section stays open as the window grows
// to fit them all and shrinks again, also while the filter's results stand
// in for the entries
async function fitting(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 1600 }, async page => {
    const problems = [];
    const state = () => page.evaluate(`(() => {
      const entries = [...document.querySelectorAll('#tex8web-toc .tableofcontents > span')];
      const chevrons = [...document.querySelectorAll('#tex8web-toc .tex8web-toc-more')];
      return { sections: entries.filter(el => el.matches('.sectionToc, .likesectionToc')).length,
        entries: entries.length, shown: entries.filter(el => el.checkVisibility()).length,
        chevrons: chevrons.length, seen: chevrons.filter(el => el.checkVisibility()).length,
        open: chevrons.map(el => el.getAttribute('aria-expanded')).join() };
    })()`);
    const drawer = open => page.evaluate(`document.getElementById('tex8web-toc').${open ? 'show' : 'hide'}Popover()`);
    const all = s => s.shown === s.entries && s.seen === 0;
    const collapsed = s => s.shown === s.sections && s.seen === s.chevrons;
    const first = await state();
    if (!first.chevrons || first.entries === first.sections) return [`${first.chevrons} chevrons, ${first.entries - first.sections} subsections`];
    const at = async (what, wanted) => {
      if (!await until(state, wanted)) problems.push(`${what}: ${JSON.stringify(await state())}`);
    };
    await at('wide, room for all', all);
    await page.resize(400, 800);
    await drawer(true);
    await at('narrow, room for all', all);
    await drawer(false);
    await page.resize(400, 150);
    await drawer(true);
    await at('narrow, too short', collapsed);
    await drawer(false);
    await page.resize(1600, 150);
    await at('wide, too short', collapsed);
    await page.evaluate(`document.querySelector('#tex8web-toc .tex8web-toc-more').click()`);
    await finished(page);
    await at('too short, a section opened', s => s.shown === s.entries && s.seen === s.chevrons);
    await page.resize(1600, 900);
    await at('a section opened, room for all', all);
    await page.resize(1600, 150);
    await at('a section opened, too short again', s => s.shown === s.entries && s.seen === s.chevrons && s.open === 'true');
    // (measured with the entries, not the filter's results, which fit in
    // a window as tall as this)
    const typed = text => page.evaluate(`(() => {
      const input = document.querySelector('.tex8web-toc-filter');
      input.value = '${text}';
      input.dispatchEvent(new Event('input'));
    })()`);
    await page.resize(1600, 900);
    await at('room for all again', all);
    await typed('nothing such');
    await page.resize(1600, 300);
    if (!await until(() => page.evaluate(`!document.getElementById('tex8web-toc').classList.contains('tex8web-toc-all')`))) {
      problems.push('too short as the filter is used: still set to show every entry');
    }
    if (!await page.evaluate(`document.querySelector('.tex8web-toc-results').checkVisibility()`)) {
      problems.push('resized as the filter is used: its results not shown');
    }
    await typed('');
    await at('too short as the filter was used', s => s.shown === s.entries && s.seen === s.chevrons);
    return problems;
  });
}

// one feature of the page's script failing (here, the fade at an edge,
// whose ResizeObserver throws) leaves the others working: the contents
// showing the subsections being read, and the filter set up. (The contents'
// own ResizeObserver throws too, but last, once the rest is set up)
async function isolating(chrome, file) {
  const before = `window.ResizeObserver = class { constructor() { throw new Error('a feature fails'); } }`;
  return chrome.withPage(pathToFileURL(file).href, { width: 1600, before }, async page => {
    const problems = [];
    const [open, filter] = await page.evaluate(`[document.querySelectorAll('.tex8web-open').length,
      document.querySelector('.tex8web-toc-filter').getAttribute('role')]`);
    if (!open) problems.push('a feature failing: the contents show no subsection being read');
    if (filter !== 'combobox') problems.push('a feature failing: the filter not set up');
    return problems;
  });
}

// a folder served over HTTP
const served = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
async function serve(site) {
  const server = createServer((request, response) => {
    const file = join(site, decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      .replace(/\/$/, '/index.html'));
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': served[extname(file)] ?? 'application/octet-stream' })
      .end(readFileSync(file));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return server;
}

// from one page of a site to another, served over HTTP as a file has no
// origin to share: from another page, as the site's index at /, to an
// example (which links up to ../index.html, the same page), then up again.
// The first change runs css/tex8web.css's view transition forward and the
// second back (tex8web-head.js), and the up link goes back in history
// rather than to a new entry (tex8web-page.js). Then the browser's buttons:
// forward is forward, back is back whichever page it is to
// (each page's transition, once tex8web-head.js, which listens after this,
// has named it)
const seenTypes = `addEventListener('pagereveal', event => setTimeout(() => {
  const types = event.viewTransition ? [...event.viewTransition.types].join() || 'untyped' : 'none';
  const seen = JSON.parse(sessionStorage.getItem('seen') ?? '[]');
  sessionStorage.setItem('seen', JSON.stringify([...seen, types]));
}));`;
async function navigating(chrome, [example, index]) {
  const site = join(testDir(example, 'page'), 'site');
  rmSync(site, { recursive: true, force: true });
  cpSync(join(testDir(index, 'page'), 'html'), site, { recursive: true });
  renameSync(join(site, `${index.name}.html`), join(site, 'index.html'));
  cpSync(join(testDir(example, 'page'), 'html'), join(site, 'example'), { recursive: true });
  const server = await serve(site);
  try {
    return await chrome.withPage(`http://127.0.0.1:${server.address().port}/`, { before: seenTypes }, async page => {
      // at a page, its transition (the nth) seen and over; the page's
      // evaluate fails while the next page loads
      const arrive = async (path, n) => {
        const there = await until(() => page.evaluate(`location.pathname === '${path}' && document.readyState === 'complete'
          && JSON.parse(sessionStorage.getItem('seen') ?? '[]').length === ${n}
          && !document.documentElement.matches(':active-view-transition')`).catch(() => false), Boolean, 10000);
        if (!there) throw new Error(`not at ${path} in 10s`);
      };
      await arrive('/', 1);
      await page.evaluate(`location.href = 'example/main.html'`);
      await arrive('/example/main.html', 2);
      await page.evaluate(`document.querySelector('.tex8web-up').click()`);
      await arrive('/', 3);
      const entry = await page.evaluate('navigation.currentEntry.index');
      // then by the browser's buttons: forward to the example, a new entry
      // up to the index (back, as it is the page above), and back to the
      // example, which is back though it is not the page above
      await page.evaluate('history.forward()');
      await arrive('/example/main.html', 4);
      await page.evaluate(`location.href = '/'`);
      await arrive('/', 5);
      await page.evaluate('history.back()');
      await arrive('/example/main.html', 6);
      const seen = await page.evaluate(`JSON.parse(sessionStorage.getItem('seen'))`);
      const problems = [];
      if (seen.join(' ') !== 'none tex8web-forward tex8web-back tex8web-forward tex8web-back tex8web-back') {
        problems.push(`view transitions ${seen.join(', ')}`);
      }
      if (entry !== 0) problems.push(`the up link went to history's entry ${entry}, not back to 0`);
      return problems;
    });
  } finally {
    server.close();
  }
}

// the fonts the inline script lists, preloaded over HTTP and not from a file
// (it says why). Chrome doesn't refuse them there, so this guards the
// mechanism and not Safari
const preloaded = `[...document.querySelectorAll('link[rel=preload]')]
  .map(link => [link.getAttribute('href'), link.as, link.type, link.crossOrigin].join(' '))`;
async function preloading(chrome, file) {
  const listed = readFileSync(file, 'utf8').match(/<script [^>]*data-fonts=["']([^"']*)["']/)?.[1].split(' ') ?? [];
  if (!listed.length) return ['no fonts listed on the inline script'];
  const problems = [];
  const opened = await chrome.withPage(pathToFileURL(file).href, {}, page => page.evaluate(preloaded));
  if (opened.length) problems.push(`opened from a file, ${opened.length} fonts preloaded`);
  const server = await serve(dirname(file));
  try {
    const over = await chrome.withPage(`http://127.0.0.1:${server.address().port}/${basename(file)}`, {},
      page => page.evaluate(preloaded));
    const wanted = listed.map(href => `${href} font font/woff2 anonymous`);
    if (over.join('\n') !== wanted.join('\n')) problems.push(`over HTTP, ${over.join(', ')} preloaded, not ${wanted.join(', ')}`);
  } finally {
    server.close();
  }
  return problems;
}

// each check, with the fixtures it runs on, which must have its feature
// (the viewer: an SVG and a raster picture; the bar, fade, chevrons and
// one filter: test.tex's long page, with its display that scrolls, its
// previews, its term and its sections' subsections; the filter's other: a
// titled box; transitions: an example and the page that links it; the
// contents, the failing feature and the fade of the browser's math: a page
// with subsections before its first section; the contents that fit: a short
// example whose one section with subsections isn't the first)
const each = check => async (chrome, docs) => {
  const problems = [];
  for (const doc of docs) problems.push(...(await check(chrome, pageFile(doc), doc)).map(p => `${doc.name}: ${p}`));
  return problems;
};
const checks = {
  viewer: [['test-article', 'examples/basic'], each(viewing)],
  touch: [['examples/basic'], each(touching)],
  bar: [['test'], each(async (...args) => [...await naming(...args), ...await hiding(...args), ...await landing(...args)])],
  fade: [['test'], each(fading)],
  theme: [['test-generic'], each(themed)],
  target: [['test-generic', 'test-index'], each(targeting)],
  filter: [['test', 'test-tcolorbox'], each(filtering)],
  keyboard: [['examples/basic'], each(keying)],
  lazy: [['test-tocsub'], lazily],
  contents: [['test-tocsub'], each(opening)],
  reach: [['test-tocsub'], each(reaching)],
  browsing: [['test'], each(browsing)],
  isolated: [['test-tocsub'], each(isolating)],
  fit: [['examples/footnotes'], each(fitting)],
  preloads: [['test'], each(preloading)],
  transitions: [['examples/basic', 'test-generic'], navigating],
};

const unknown = process.argv.slice(2).filter(name => !(name in checks));
if (unknown.length) {
  console.error(`no check named ${unknown.join(', ')}; the checks are ${Object.keys(checks).join(', ')}`);
  process.exit(2);
}
const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(checks);
const wanted = [...new Set(names.flatMap(name => checks[name][0]))];
const docs = new Map(select(wanted).map(doc => [doc.name, doc]));
const pageFile = doc => join(testDir(doc, 'page'), 'html', doc.tex.replace(/\.tex$/, '.html'));

// the fixtures built, prerendered, before any check runs: a build slows the
// machine, and a check that waits for a state would take longer. They are
// npm test's builds, reused if it has just made them, and copied: a check
// writes beside the page it drives
const built = new Map(await pool([...docs.values()], workers, async doc => {
  const code = (await build(doc, join(testDir(doc), 'html'), join(testDir(doc), 'aux'), { TEX8WEB_MATHML: '1' })).code;
  const copy = join(testDir(doc, 'page'), 'html');
  rmSync(copy, { recursive: true, force: true });
  if (code === 0) cpSync(join(testDir(doc), 'html'), copy, { recursive: true });
  return [doc.name, code === 0];
}));

const chrome = await launch();
let failures = 0;
for (const name of names) {
  const [fixtures, run] = checks[name];
  const missing = fixtures.filter(fixture => !built.get(fixture));
  const problems = missing.length ? missing.map(fixture => `${fixture}: build failed`)
    : await run(chrome, fixtures.map(fixture => docs.get(fixture))).catch(error => [error.message]);
  console.log([`${problems.length ? 'not ok' : 'ok'} - ${name} (${fixtures.join(', ')})`, ...problems.map(p => `    ${p}`)].join('\n'));
  failures += problems.length ? 1 : 0;
}
chrome.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
