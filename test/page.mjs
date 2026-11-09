// npm run test:page: what the page script does that no screenshot shows,
// driven in headless Chrome on the fixtures that have each feature (see
// `checks` at the end). Each check fails if its fixture lacks the feature,
// and waits for a state the page reaches, not for a time. The checks start
// once the builds are done.
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

// the picture's place in the viewer (tex8web-page.js), and whether the
// viewer is open
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

// The viewer by mouse: which pictures open it, and, on the first, that the
// picture fits the screen, that the wheel and a double-click zoom around the
// pointer (the double-click in one motion, paused at three points to measure
// it), that the picture is laid out again when the zoom stops, is dragged
// but not off the middle of the screen, and that the viewer closes
async function viewing(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, {}, async page => {
    const problems = [];
    const click = async (x, y, count = 1) => {
      await page.mouse('pressed', x, y, { clickCount: count });
      await page.mouse('released', x, y, { clickCount: count });
    };
    const state = () => page.evaluate(viewState);
    // where the plate should be, given where it would go: clamped so that
    // the picture still covers the middle of the screen
    const placed = (s, at) => at.map((a, i) => Math.min(s.view[i] / 2, Math.max(s.view[i] / 2 - s.plate[2 + i], a)));
    const off = (s, want) => Math.max(...want.slice(0, 2).map((w, i) => Math.abs(s.plate[i] - w)));
    // (a picture in a figure or display math opens the viewer; an icon in
    // the text, up to 1.5 times the font size tall, does not)
    const wrong = await page.evaluate(`[...document.querySelectorAll('img:not(.tex8web-viewer img, a img)')]
      .filter(img => img.closest('figure, .mathjax-block') ? !img.classList.contains('tex8web-zoomable')
        : img.classList.contains('tex8web-zoomable') && img.offsetHeight <= 1.5 * parseFloat(getComputedStyle(img).fontSize))
      .map(img => img.getAttribute('src'))`);
    if (wrong.length) problems.push(`opening the viewer or not, wrongly: ${wrong.join(', ')}`);
    const at = await page.evaluate(zoomableAt);
    if (!at) return [...problems, 'no picture that opens the viewer'];
    await click(...at);
    // as large as the screen allows (zoom 1), or a raster picture at its
    // natural size if that is smaller (home)
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
    // (a notch at a time, as each may be clamped to the middle of the screen)
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
    // once the zoom stops: laid out again, at the same size and place
    const settled = await until(state, s => Math.abs(s.laid - zoom(s)) < 0.001);
    if (!settled || Math.abs(settled.width - settled.size[0]) > 0.5
      || Math.abs(settled.size[0] - wheeled.size[0]) > 0.5
      || !(Math.max(...settled.at.map((at, i) => Math.abs(at - wheeled.at[i]))) <= 0.5)) {
      problems.push(`the wheel stopped: ${settled ? `${settled.width}px wide laid out, ${settled.size[0]}px shown at ${settled.at.join(', ')}` : 'not laid out again'}, from ${wheeled.size[0]}px at ${wheeled.at.join(', ')}`);
    }
    // (far enough to be clamped at the middle of the screen)
    await page.mouse('pressed', ...p);
    for (let i = 1; i <= 8; i++) await page.mouse('moved', p[0] + 100 * i, p[1] + 100 * i);
    await page.mouse('released', p[0] + 800, p[1] + 800);
    const dragged = await state();
    const want = placed(dragged, wheeled.plate.slice(0, 2).map(a => a + 800));
    if (Math.abs(zoom(dragged) - zoom(wheeled)) > 0.001 || !(off(dragged, want) <= 0.5)) {
      problems.push(`dragged by 800px: zoom ${zoom(dragged)}, at ${dragged.plate.slice(0, 2).join(', ')} (not ${want.join(', ')})`);
    }
    // (zoomed out past the start, down to half of home)
    const out = await wheel(dragged, 100, 8, 'the wheel turned back');
    // a double-click on the picture where the drag left it: the point stays
    // under the pointer all the way, in one motion (css/tex8web.css eases
    // it). The transition is paused as it starts and set to a quarter, a
    // half, and three quarters, so that the picture is not laid out again
    // between them.
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
    // (a drag from beside the picture to beside it, moving the picture
    // along, is not a click beside it, so the viewer stays open)
    await page.mouse('pressed', 2, 2);
    for (let i = 1; i <= 4; i++) await page.mouse('moved', 2 + 10 * i, 2 + 10 * i);
    await page.mouse('released', 42, 42);
    const beside = await state();
    if (beside.at[0] <= 42 && beside.at[1] <= 42) problems.push('a drag beside the picture: ended on it');
    else if (!beside.open) problems.push('a drag ending beside the picture closed the viewer');
    // (Tab does not move the focus on the page behind the viewer)
    const focused = await page.evaluate('document.activeElement.outerHTML.slice(0, 80)');
    await page.press('Tab', 9);
    if (await page.evaluate('document.activeElement.outerHTML.slice(0, 80)') !== focused) problems.push('Tab: the focus behind the viewer moved');
    await page.press('Escape', 27);
    if (!await until(state, s => !s.open)) problems.push('Escape: the viewer still open');
    await page.evaluate(zoomableAt);
    await click(...at);
    if (!await until(state, s => s.open)) problems.push('a picture clicked again: no viewer');
    await finished(page);
    // (the viewer fades out while still open, in the top layer: otherwise
    // Safari would draw it under the page's bar, or, on iOS, not at all)
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

// The viewer by touch on a phone screen: a double tap zooms in (Safari on
// iOS sends no dblclick), a single tap does not, however soon after the page
// loads, and turning the phone keeps the same point of the picture at the
// middle of the screen
async function touching(chrome, file) {
  // (every event stamped 100 ms: a first tap always counts as soon after the
  // page loads, and any two taps as a double tap)
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

// The table of contents filter: a named theorem found by its head (or a
// numbered box by its title), first among the results, and Enter going to
// it; then, with "e" typed, which many entries match, ArrowDown twice and
// ArrowUp once choosing the second, which Enter goes to; and test.tex's
// ε-ball found by \epsilon, with its ε typeset
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
    // (the placeholder names the kinds of entries the page has)
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

// On a phone screen, the bar naming the section being read: empty before
// the first heading; a section halfway down named once it is scrolled a
// little above the top quarter (with a higher line, the next heading after a
// short section would cross the line too); and the bar, tapped, opening the
// table of contents
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
    // (a change to the entry, as MathJax typesetting it would make)
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

// On a phone screen, the bar of controls (tex8web-page.js): away on
// scrolling down, back on scrolling up, but not on a reversal of a few pixels
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
    // the bar's line and background: transparent at the top, drawn (after a fade) once the page scrolls
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
    // a wide window, scrolled down, narrowed: the bar away at once, and no
    // transition then or on widening
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

// On a phone screen, a page opened partway down, by a link's # or a reload,
// keeps its bar shown with its line, and nothing moves: the browser's
// scrolling is not the reader's
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

// The fade of a display that scrolls on a phone screen, measured by its two
// masks' positions. At its start, only the right edge fades; 20px in, the
// left fades halfway; in the middle, both; 20px from its end, the right
// halfway; at its end, only the left. Not masked: a display that fits, one
// scrolled to its end that then fits a wider screen or is printed, and one
// with keyboard focus, whose focus ring the mask would hide. A display
// copied into a preview card fades as it scrolls there.
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

// The theme button shown before tex8web-page.js runs, with the other
// controls: a long page is drawn well before its deferred scripts run. With
// JavaScript off, the button is hidden (checked by visual.mjs on every page).
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

// A link to an equation tints the equation, as a link to a heading tints
// the heading, whether tex4ht's anchor is right before it, first among the
// anchors of an alignment's lines, or, for a gather, last in the paragraph
// before. No other equation is tinted, and a link to another anchor, for
// example an \index's (dx...) before an equation, tints nothing.
async function targeting(chrome, file, doc) {
  const displays = `document.querySelectorAll('.mathjax-env, .mathjax-block')`;
  const tinted = `[...${displays}].map(el => getComputedStyle(el.querySelector('mjx-container')).backgroundColor !== 'rgba(0, 0, 0, 0)')`;
  // (for each display, the anchors with only space and comments between them
  // and the display, or else those ending the paragraph before it; and all
  // other anchors)
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
    // (the index's anchors right before the equation, and after some text before it)
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

// The viewer from the keyboard: a picture takes the focus, Enter or Space
// opens the viewer with the focus inside it, and Escape closes it and gives
// the focus back to the picture. The popover gives the focus back too, so
// this check cannot tell the page's focus() from the popover's. Space, which
// pages down, does not open the viewer again after the picture was clicked,
// and Shift-Enter does not open it.
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
    // (opened by a click, then closed by a click beside the picture, with the
    // focus back on the picture)
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

// The page typeset by MathJax in the browser (built with
// TEX8WEB_NO_PRERENDER) after the page script has run, as on a slow
// network: the bar's copy of a heading with math is typeset while the table
// of contents is closed, and a display that scrolls fades at its edge. The
// check loads MathJax once the page script has run, and makes its build, as
// no other check uses that build.
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
      // (ui/lazy leaves the math in the closed table of contents as a
      // placeholder, mjx-lazy, which the bar copies)
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

// The table of contents of a page whose first headings are subsections,
// before its first section, in a window too short for all entries: while
// one of those subsections is read, they and the first section are shown,
// and later only the subsections of the section being read
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

// The table of contents follows the section being read: scrolled to its
// top, the column on a wide screen and the open drawer on a narrow one
// scroll to the entry of the last heading the page reaches. With the drawer
// closed, from the page's load and as the page scrolls past each heading,
// the entry is marked, but no entry of the drawer is measured, as the
// measurement would lay out the whole page. Opened by the contents button,
// the drawer is drawn from its first frame with the marked entry a third of
// the way down. A section the reader opens there stays open as the drawer
// closes and opens again, and the drawer is not scrolled as it closes.
// The column hidden with the contents button is not measured either, and
// is scrolled to the marked entry when it is shown, as when the window
// widens with the drawer closed.
async function following(chrome, file) {
  const problems = [];
  const links = `[...document.querySelectorAll('#tex8web-toc .tableofcontents a')]`;
  // entry i's hash, with its heading scrolled to the top, or null if the
  // page ends first
  const to = i => `(() => {
    const a = ${links}[${i}], heading = document.getElementById(decodeURIComponent(a.hash.slice(1)));
    scrollTo(0, scrollY + heading.getBoundingClientRect().top);
    return Math.abs(heading.getBoundingClientRect().top) < 1 ? a.hash : null;
  })()`;
  const marked = (page, hash) => until(() => page.evaluate(`document.querySelector('#tex8web-toc [aria-current]')?.hash`), h => h === hash);
  // (within a pixel: Chrome on Linux rounds the box's scroll extent to a
  // whole pixel, which can leave a fraction of the last entry below it)
  const seen = i => `(() => {
    const box = document.getElementById('tex8web-toc').getBoundingClientRect(), a = ${links}[${i}].getBoundingClientRect();
    return a.height > 0 && a.top > box.top - 1 && a.bottom < box.bottom + 1;
  })()`;
  // the last entry whose heading can be scrolled to the top
  const reachable = async page => {
    let last = await page.evaluate(`${links}.length`) - 1;
    while (last > 0 && !await page.evaluate(to(last))) last--;
    return last;
  };
  const follows = async page => {
    const last = await reachable(page);
    if (!await marked(page, await page.evaluate(to(0)))) return 'the first entry not marked';
    await page.evaluate(`document.getElementById('tex8web-toc').scrollTop = 0`);
    if (await page.evaluate(seen(last))) return 'the last entry reached shown at the top';
    if (!await marked(page, await page.evaluate(to(last)))) return 'the last entry reached not marked';
    if (!await until(() => page.evaluate(seen(last)))) return 'the last entry reached not scrolled into view';
  };
  const before = `window.tex8webReads = 0;
    for (const name of ['getBoundingClientRect', 'getClientRects']) {
      const method = Element.prototype[name];
      Element.prototype[name] = function () {
        if (this.closest('#tex8web-toc')) tex8webReads++;
        return method.call(this);
      };
    }`;
  await chrome.withPage(pathToFileURL(file).href, { width: 1600, height: 150, before }, async page => {
    const problem = await follows(page);
    if (problem) problems.push(`the column: ${problem}`);
    // hidden with the contents button at the first entry, not measured as
    // the page scrolls, and scrolled to the last entry reached when shown
    const button = `document.querySelector('.tex8web-contents').click()`;
    const last = await reachable(page);
    if (!await marked(page, await page.evaluate(to(0)))) problems.push('the hidden column: the first entry not marked');
    await page.evaluate(button);
    await finished(page);
    await page.evaluate('tex8webReads = 0');
    if (!await marked(page, await page.evaluate(to(last)))) problems.push('the hidden column: the last entry reached not marked');
    const reads = await page.evaluate('tex8webReads');
    if (reads) problems.push(`the hidden column: entries measured ${reads} times`);
    await page.evaluate(button);
    if (!await until(() => page.evaluate(seen(last)))) problems.push('the column shown again: the last entry reached not scrolled into view');
  });
  await chrome.withPage(pathToFileURL(file).href, { width: 400, height: 150, before }, async page => {
    const count = await page.evaluate(`${links}.length`);
    let reached = 0;
    for (let i = 0; i < count; i++) {
      const hash = await page.evaluate(to(i));
      if (!hash) continue;
      reached++;
      if (!await marked(page, hash)) problems.push(`the closed drawer: entry ${i + 1} not marked`);
    }
    if (reached < 2) problems.push(`the closed drawer: ${reached} headings reached`);
    const reads = await page.evaluate('tex8webReads');
    if (reads) problems.push(`the closed drawer: entries measured ${reads} times`);
    // a heading halfway, whose entry is neither in the closed drawer's first
    // screen nor in its last. Scrolling up to it shows the bar, which is
    // hidden as the page scrolls down.
    const middle = await page.evaluate(to(Math.floor(count / 2)));
    if (!middle || !await marked(page, middle)) problems.push('the closed drawer: the middle entry not marked');
    if (!await until(() => page.evaluate(`!document.querySelector('.tex8web-controls.tex8web-away')`))) {
      return [...problems, 'the bar not shown after a scroll up'];
    }
    await finished(page);
    // the drawer opened by a click on the contents button, and in each frame
    // from its opening the drawer's scroll and the marked entry's top and
    // bottom in it. The frames are recorded after the page script's frame
    // callback, whose beforetoggle listener comes first.
    const opened = async () => {
      await page.evaluate(`(() => {
        const toc = document.getElementById('tex8web-toc');
        window.tex8webFrames = [];
        const frame = () => {
          const a = toc.querySelector('[aria-current]');
          const shown = a.getClientRects().length ? a : toc.querySelector('.tex8web-reading a');
          const box = toc.getBoundingClientRect(), at = shown.getBoundingClientRect();
          tex8webFrames.push({ scroll: toc.scrollTop, top: at.top - box.top, bottom: at.bottom - box.top,
            height: box.height, end: toc.scrollHeight - toc.clientHeight });
          if (tex8webFrames.length < 10) requestAnimationFrame(frame);
        };
        toc.addEventListener('beforetoggle', event => {
          if (event.newState === 'open') requestAnimationFrame(frame);
        }, { once: true });
      })()`);
      const [x, y] = await page.evaluate(`(() => {
        const box = document.querySelector('.tex8web-contents').getBoundingClientRect();
        return [box.left + box.width / 2, box.top + box.height / 2];
      })()`);
      await page.mouse('pressed', x, y);
      await page.mouse('released', x, y);
      const frames = await until(() => page.evaluate('tex8webFrames'), f => f.length >= 10);
      if (!frames) return [['not opened by the contents button']];
      const last = frames.at(-1), wrong = [];
      const moved = frames.find(f => f.scroll !== last.scroll || Math.abs(f.top - last.top) > 0.5);
      if (moved) wrong.push(`drawn scrolled to ${moved.scroll}px, the marked entry ${moved.top}px down, then to ${last.scroll}px and ${last.top}px`);
      if (!(last.top > -1 && last.bottom < last.height + 1)) wrong.push(`the marked entry from ${last.top}px to ${last.bottom}px in a box ${last.height}px tall`);
      else if (last.scroll > 0 && last.scroll < last.end && Math.abs(last.top - last.height / 3) > 1) {
        wrong.push(`the marked entry ${last.top}px down a box ${last.height}px tall, not a third`);
      }
      await finished(page);
      return [wrong, last.scroll];
    };
    let [wrong, scroll] = await opened();
    problems.push(...wrong.map(p => `the drawer opened: ${p}`));
    if (scroll === 0) problems.push('the drawer opened: not scrolled to the marked entry');
    const chevrons = `[...document.querySelectorAll('#tex8web-toc .tex8web-toc-more')].map(b => b.getAttribute('aria-expanded')).join()`;
    const states = await page.evaluate(`(() => {
      const toc = document.getElementById('tex8web-toc');
      toc.querySelector('.tableofcontents > span:not(.tex8web-reading) > .tex8web-toc-more[aria-expanded="false"]').click();
      toc.scrollTop = 0;
      return ${chevrons};
    })()`);
    await finished(page);
    // (scrolled to 0 above, so that a scroll on closing, which a
    // beforetoggle listener that ignores newState would make, shows)
    const closing = await page.evaluate(`new Promise(done => {
      const toc = document.getElementById('tex8web-toc');
      toc.hidePopover();
      requestAnimationFrame(() => requestAnimationFrame(() => done(toc.scrollTop)));
    })`);
    if (closing) problems.push(`the drawer closing: scrolled to ${closing}px`);
    await finished(page);
    [wrong] = await opened();
    problems.push(...wrong.map(p => `the drawer opened again: ${p}`));
    const now = await page.evaluate(chevrons);
    if (now !== states) problems.push(`the drawer opened again: sections open ${now}, not ${states}`);
    const problem = await follows(page);
    if (problem) problems.push(`the open drawer: ${problem}`);
    // closed at the first entry, then the page scrolled to the last entry
    // reached, and the window widened: the column is scrolled to it
    const last = await reachable(page);
    await page.evaluate(`document.getElementById('tex8web-toc').scrollTop = 0`);
    if (!await marked(page, await page.evaluate(to(0)))) problems.push('the drawer closed: the first entry not marked');
    await page.evaluate(`document.getElementById('tex8web-toc').hidePopover()`);
    await finished(page);
    if (!await marked(page, await page.evaluate(to(last)))) problems.push('the drawer closed: the last entry reached not marked');
    await page.resize(1600, 150);
    if (!await until(() => page.evaluate(seen(last)))) problems.push('the window widened: the last entry reached not scrolled into view');
  });
  return problems;
}

// On a wide touch screen, with a closed section's chevron, whose tap area
// is larger than its line, last in a column that scrolls: the column
// scrolls no further than the entry. On a narrow screen, the open drawer,
// which scrolls, ends at the window's bottom, and its last entry can be
// scrolled into view
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
    const problems = over > 1 ? [`scrolled to the end, ${over}px below the last entry`] : [];
    await page.resize(400, 150);
    await page.evaluate(`document.getElementById('tex8web-toc').showPopover()`);
    await finished(page);
    const drawer = await page.evaluate(`(() => {
      const toc = document.getElementById('tex8web-toc');
      const last = [...toc.querySelectorAll('.tableofcontents > span')].filter(entry => entry.checkVisibility()).at(-1);
      const scrolls = toc.scrollHeight > toc.clientHeight;
      toc.scrollTop = toc.scrollHeight;
      return { scrolls, window: innerHeight, bottom: toc.getBoundingClientRect().bottom, last: last.getBoundingClientRect().bottom };
    })()`);
    if (!drawer.scrolls) return [...problems, 'the narrow drawer does not scroll'];
    if (Math.abs(drawer.bottom - drawer.window) > 0.5) problems.push(`the drawer's bottom at ${drawer.bottom}px, in a window ${drawer.window}px tall`);
    if (drawer.last > drawer.window) problems.push(`the drawer scrolled to its end, its last entry ${drawer.last - drawer.window}px below the window`);
    return problems;
  });
}

// The table of contents chevrons, by mouse. Each section with subsections
// has one, at the column's inner edge. A section the reader opens slides
// open, and stays open as the page scrolls to a third section. The third
// opens without a slide, and the first, as the reader leaves it, closes.
// The section being read, once closed, stays closed while it is read, with
// its entry marked. The opened section stays open when a link in the table
// of contents leads back. The window is too short for all entries, which
// would otherwise all be shown.
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

// The table of contents of a short page. Where all entries fit, in the
// column and in the open drawer on a narrow screen, every entry is shown,
// and no chevron. Where they do not, a section neither read nor opened shows
// no subsections, and its chevron opens it. That section stays open as the
// window grows to fit all entries and shrinks again, also while the
// filter's results replace the entries.
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
    // (whether all fit is measured with the entries, not with the filter's
    // results, which fit in a window this tall)
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

// One feature of the page script failing (here the fade at an edge, whose
// ResizeObserver throws) leaves the others working: the table of contents
// shows the subsections being read, and the filter is set up. The
// ResizeObserver of the table of contents throws too, but last, once the
// rest is set up.
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

// Moving between pages of a site, served over HTTP, as pages opened from
// files share no origin: from another page, as the site's index at /, to an
// example (which links up to ../index.html, the same page), then up again.
// The first move runs css/tex8web.css's view transition forward and the
// second back (tex8web-head.js), and the up link goes back in history
// instead of adding an entry (tex8web-page.js). Then by history: forward
// is forward, and back is back, whichever page it leads to.
// seenTypes records each page's transition types after a timeout, once
// tex8web-head.js, whose listener is added later, has set them.
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
      // at the page at path, with its transition (the nth) recorded and over;
      // evaluate fails while the next page loads, hence the catch
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
      // then forward to the example by history; a new entry up to the
      // index, a back transition as it is the page above; and back to the
      // example by history, a back transition although it is not the page
      // above
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

// The fonts the inline script lists are preloaded over HTTP, and not on a
// page opened from a file (CONTRIBUTING.md, "Preloaded fonts", says why).
// Chrome does not refuse preloads from a file, so this check tests the
// mechanism, not Safari.
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

// For a reader whose default font size is 20px: the text at \WebLikePDF's
// size, 10.95pt over 12pt of that default, and the controls and the table
// of contents at the default. The wide layout starts where the text and,
// on each side, a column and its gaps fit.
async function sizing(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 1600, fontSize: 20 }, async page => {
    const problems = [];
    const sizes = await page.evaluate(`(() => {
      const size = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      const box = document.createElement('div');
      box.style.width = 'calc(var(--tex8web-textwidth) + 2 * (var(--tex8web-margin) + 2 * var(--tex8web-gap)))';
      document.body.append(box);
      const wide = box.getBoundingClientRect().width;
      box.remove();
      return { text: size('body'), controls: size('.tex8web-controls'), toc: size('#tex8web-toc .tableofcontents'), wide };
    })()`);
    const wanted = { text: 0.9125 * 20, controls: 20, toc: 0.875 * 20 };
    for (const [what, px] of Object.entries(wanted)) {
      if (Math.abs(sizes[what] - px) > 0.01) problems.push(`${what} at ${sizes[what]}px, not ${px}px`);
    }
    for (const [width, layout] of [[Math.ceil(sizes.wide) + 1, 'wide'], [Math.floor(sizes.wide) - 1, 'narrow']]) {
      await page.resize(width, 900);
      await page.frame();
      const found = await page.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--tex8web-layout').trim()`);
      if (found !== layout) problems.push(`${width}px wide: the ${found} layout, not the ${layout} one (room from ${sizes.wide}px)`);
    }
    return problems;
  });
}

// The space in test-boxseps's tables, boxes, arrays, and description lists,
// in pt of its 10.95pt text: \tabcolsep, \fboxsep, \fboxrule, \arraycolsep,
// tcolorbox's boxsep plus middle, and \labelsep, each set away from its
// default, and smaller in a group for the second table, an \fbox, and a
// \colorbox. Only the space beside a column that the source sets with
// @{} stays 0. mathtools' starred matrices are spaced as amsmath's. A
// label starts at the margin, also when made with \MakeUppercase. A
// \framebox in \small is as wide as in the body. A box's text starts
// after its padding in an indented paragraph, as \WebLikePDF indents it.
// Within half a px, or a px for each frame, which Chrome draws in whole
// px.
const spaces = `(() => {
  const pt = parseFloat(getComputedStyle(document.body).fontSize) / 10.95;
  const all = selector => [...document.querySelectorAll(selector)];
  const px = (el, property) => el ? parseFloat(getComputedStyle(el)[property]) : NaN;
  const box = el => el ? el.getBoundingClientRect() : {};
  // (the left of an element's first character that is not a space)
  const first = el => {
    const walk = el && document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walk?.nextNode()) {
      const at = walk.currentNode.textContent.search(/\\S/);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(walk.currentNode, at), range.setEnd(walk.currentNode, at + 1);
      return range.getBoundingClientRect().left;
    }
    return NaN;
  };
  const found = [];
  const add = (what, value, wanted, frames = 0) => found.push([what, value / pt, wanted, (frames || 0.5) / pt]);
  const sides = (what, el, wanted, sides = ['left', 'right']) => {
    for (const side of sides) add(what + ' ' + side, px(el, 'padding-' + side), wanted[side] ?? wanted);
  };
  const [wide, narrow] = all('table.tabular');
  sides('a cell', wide?.querySelector('td.td11'), 12);
  sides('a cell before @{}', narrow?.querySelector('td.td10'), { left: 2, right: 0 });
  sides('a cell after @{}', narrow?.querySelector('td.td01'), { left: 0, right: 2 });
  const [framed, tight, small] = all('span.fbox');
  for (const [what, el, sep] of [['an \\\\fbox', framed, 6], ['an \\\\fbox in a group', tight, 0],
      ['an \\\\fbox in \\\\small', small, 6], ['an \\\\fbox alone', document.querySelector('div.fbox'), 6],
      ['a \\\\colorbox', document.getElementById('colorbox1'), 6], ['an \\\\fcolorbox', document.getElementById('colorbox2'), 6],
      ['a \\\\colorbox in a group', document.getElementById('colorbox3'), 0]]) {
    sides(what, el, sep, ['top', 'right', 'bottom', 'left']);
  }
  for (const [what, el] of [['an \\\\fbox', framed], ['an \\\\fcolorbox', document.getElementById('colorbox2')]]) {
    add(what + "'s frame", px(el, 'border-top-width'), 2, 1);
  }
  // (3cm, with \\fboxsep and \\fboxrule inside)
  const [framebox, smallFramebox] = all('.framebox-l');
  add('a \\\\framebox[3cm]', box(framebox).width, 72.27 * 3 / 2.54);
  add('a \\\\framebox[3cm] in \\\\small', box(smallFramebox).width, 72.27 * 3 / 2.54);
  const colorbox = document.getElementById('colorbox1');
  if (colorbox) colorbox.closest('p').style.textIndent = '2em';
  add('a \\\\colorbox in an indented paragraph', first(colorbox) - box(colorbox).left, 6);
  const lower = document.querySelector('.tcolorbox .lowerbox');
  add('a tcolorbox above its middle line', box(lower).top - box(lower?.previousElementSibling).bottom, 72.27 / 25.4 + 6);
  add('a tcolorbox below its middle line', px(lower, 'padding-top'), 72.27 / 25.4 + 6);
  all('dl.description').forEach((dl, i) => {
    const label = dl.querySelector('dt > span'), text = dl.querySelector('dd p');
    const range = document.createRange();
    const start = text?.firstChild?.textContent.search(/\\S/);
    if (start >= 0) range.setStart(text.firstChild, start), range.setEnd(text.firstChild, start + 1);
    add(\`description \${i + 1}'s label after the margin\`, first(dl.querySelector('dt')) - box(dl).left, 0);
    add(\`description \${i + 1}'s text after the label\`, (start >= 0 ? range.getBoundingClientRect().left : NaN) - box(label).right, 10.95 * (i + 1));
  });
  // (the fixture's tables in order: array, pmatrix, the @{} array, the
  // array in \left(, and the six starred matrices)
  const tables = all('mjx-mtable');
  const [array, matrix, given] = tables.map(table => [...table.querySelectorAll('mjx-mtd')]);
  sides('an array', array?.[0], 10);
  sides('a pmatrix', matrix?.[0], { left: 0, right: 10 });
  sides('an array with @{\\\\hspace{2em}}', given?.[0], { left: 10, right: 0 });
  sides('an @{\\\\hspace{2em}} column', given?.[1], 0);
  ['matrix*', 'pmatrix*', 'bmatrix*', 'Bmatrix*', 'vmatrix*', 'Vmatrix*'].forEach((name, i) =>
    sides('a ' + name, tables[4 + i]?.querySelector('mjx-mtd'), { left: 0, right: 10 }));
  // pmatrix*[r]'s rows as far apart as pmatrix's, and its first column's
  // entries, -1 and 3, ending at the same place
  const rowGap = table => {
    const [one, two] = table ? table.querySelectorAll('mjx-mtr') : [];
    return box(two).top - box(one).top;
  };
  add("a pmatrix*'s rows apart, less a pmatrix's", rowGap(tables[5]) - rowGap(tables[1]), 0);
  const end = cell => box([...(cell?.querySelectorAll('mjx-c') ?? [])].pop()).right;
  const starred = [...(tables[5]?.querySelectorAll('mjx-mtd') ?? [])];
  add("a pmatrix*[r]'s first column, its right ends apart", end(starred[0]) - end(starred[2]), 0);
  return found;
})()`;
async function spacing(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, {}, async page =>
    (await page.evaluate(spaces)).filter(([, value, wanted, slack]) => !(Math.abs(value - wanted) <= slack))
      .map(([what, value, wanted]) => `${what}: ${value.toFixed(2)}pt, not ${wanted.toFixed(2)}pt`));
}

// Each entry of an author-year bibliography from the margin, in pt of the
// 10pt text: its first line at 0, and its second at \bibhang, which is
// natbib's 1em or biblatex's \parindent of 15pt. Each entry is long enough
// to wrap. Within half a px.
const hangs = { 'test-natbib-authoryear': 10, 'test-biblatex-authoryear': 15 };
const hanging = `(() => {
  const pt = parseFloat(getComputedStyle(document.body).fontSize) / 10;
  const dl = document.querySelector('dl.tex8web-bibhang');
  const margin = dl?.getBoundingClientRect().left;
  return [...(dl?.querySelectorAll(':scope > dd') ?? [])].map(dd => {
    const rects = [];
    const walk = document.createTreeWalker(dd, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(walk.currentNode);
      rects.push(...[...range.getClientRects()].filter(r => r.width > 0 && /\\S/.test(walk.currentNode.textContent)));
    }
    const tops = [...new Set(rects.map(r => Math.round(r.top)))].sort((a, b) => a - b);
    const line = top => (Math.min(...rects.filter(r => Math.round(r.top) === top).map(r => r.left)) - margin) / pt;
    return [line(tops[0]), tops.length > 1 ? line(tops[1]) : NaN, 0.5 / pt];
  });
})()`;
async function hang(chrome, file, doc) {
  return chrome.withPage(pathToFileURL(file).href, {}, async page => {
    const entries = await page.evaluate(hanging);
    if (!entries.length) return ['no author-year bibliography'];
    return entries.flatMap(([first, second, slack], i) => [['first', first, 0], ['second', second, hangs[doc.name]]]
      .filter(([, value, wanted]) => !(Math.abs(value - wanted) <= slack))
      .map(([which, value, wanted]) => `entry ${i + 1}'s ${which} line: ${value.toFixed(2)}pt from the margin, not ${wanted}pt`));
  });
}

// Each check, with the fixtures it runs on, which must have its feature:
// - viewer: an SVG and a raster picture
// - bar, fade, browsing, and one filter: test.tex's long page, with its
//   display that scrolls, its previews, its term, and its sections'
//   subsections
// - the other filter: a titled box
// - transitions: an example and the page that links to it
// - contents, isolated, and lazy: a page with subsections before its first
//   section
// - fit: a short example whose one section with subsections is not the first
// - sizes: \WebLikePDF at a size other than 12pt, and a table of contents
// - spaces: a document with each length that spaces tables, boxes, arrays,
//   and description lists set away from its default
// - hang: author-year bibliographies, with entries that wrap
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
  browsing: [['test'], each(async (...args) => [...await browsing(...args), ...await following(...args)])],
  isolated: [['test-tocsub'], each(isolating)],
  fit: [['examples/footnotes'], each(fitting)],
  preloads: [['test'], each(preloading)],
  transitions: [['examples/basic', 'test-generic'], navigating],
  sizes: [['test-likepdf'], each(sizing)],
  spaces: [['test-boxseps'], each(spacing)],
  hang: [Object.keys(hangs), each(hang)],
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

// The fixtures are built and prerendered before any check runs, as a build
// slows the machine and a check that waits for a state would take longer.
// The builds are npm test's, reused if their stamp is unchanged, and
// copied, as a check writes files beside the page it drives.
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
