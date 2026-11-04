// npm run test:visual: each test document and example, prerendered, against
// the same page typeset by MathJax in the browser, compared screen by
// screen with JavaScript off (needs Chrome, and the network for MathJax).
// The two should be identical; differing screens are saved, as
// <screen>-browser.png and <screen>-prerendered.png, in
// build/test/<document>/visual/. In both, the columns of an alignment
// should line up across its \intertext. And the prerendered page's closer
// view of pictures should work with the mouse and a finger, the page be no
// wider than a phone's screen, its bar there come and go as it scrolls,
// its theme button be there before tex8web-page.js runs, and no math
// character be clipped.
//   node test/visual.mjs [document names...]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, documents, expected, pool, testDir } from './lib/build.mjs';
import { launch } from './lib/chrome.mjs';

const only = process.argv.slice(2);
const screen = 900;

// the browser's typeset page as it stands, without its scripts and with
// MathJax's styles (which it adds through the CSSOM) written out; and
// without what tex8web-page.js changed, which isn't MathJax's
const typesetPage = `(async () => {
  // (MathJax's script, from the network, may not have run yet)
  while (!MathJax.startup.promise) await new Promise(resolve => setTimeout(resolve, 100));
  await MathJax.startup.promise;
  await MathJax.startup.document.lazyTypesetAll?.();
  const css = [...document.styleSheets].filter(s => s.ownerNode?.id?.startsWith('MJX'))
    .map(s => [...s.cssRules].map(r => r.cssText).join('\\n')).join('\\n');
  const html = document.documentElement.cloneNode(true);
  html.classList.remove('tex8web-js');
  if (!html.classList.length) html.removeAttribute('class');
  html.querySelector('.tex8web-toc-filter')?.setAttribute('hidden', 'hidden');
  html.querySelector('.tex8web-toc-results')?.remove();
  html.querySelector('.tex8web-where')?.replaceChildren();
  html.querySelector('.tex8web-where')?.setAttribute('hidden', 'hidden');
  html.querySelectorAll('[aria-current]').forEach(n => n.removeAttribute('aria-current'));
  html.querySelectorAll('.tex8web-open').forEach(n => n.classList.remove('tex8web-open'));
  html.querySelectorAll('script, style[id^=MJX]').forEach(n => n.remove());
  const style = document.createElement('style');
  style.textContent = css;
  html.querySelector('head').append(style);
  return '<!DOCTYPE html>' + html.outerHTML;
})()`;

// the alignments split at an \intertext whose columns don't line up across
// it: for each, the left edges of the columns before and after (the row
// with the most cells, in px)
const misaligned = `(() => {
  const edges = c => {
    const table = c.querySelector('mjx-mtable');
    const rows = [...table.querySelectorAll('mjx-mtr, mjx-mlabeledtr')]
      .filter(r => r.closest('mjx-mtable') === table && !r.closest('mjx-labels'));
    const row = rows.sort((a, b) => b.children.length - a.children.length)[0];
    return [...row.querySelectorAll(':scope > mjx-mtd')].map(td => Math.round(td.getBoundingClientRect().left * 2) / 2);
  };
  const all = [...document.querySelectorAll('mjx-container[display]')];
  return [...document.querySelectorAll('.tex8web-intertext')].map(text => {
    const before = all.filter(c => c.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
    const after = all.find(c => c.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_PRECEDING);
    return before && after && [text.textContent.trim().slice(0, 30), edges(before), edges(after)];
  }).filter(found => found && found[1].join() !== found[2].join());
})()`;

// the closer view of pictures (tex8web-page.js), with the mouse: which
// pictures open it, and on the first, that it fits the screen, that the
// wheel and a double-click zoom around the pointer (the latter in one
// motion), that the picture is dragged, but not off the middle of the
// screen, and laid out again when the zoom stops, and that it closes
async function viewing(chrome, file) {
  const page = await chrome.open(pathToFileURL(file).href);
  const problems = [];
  const sleep = ms => new Promise(done => setTimeout(done, ms));
  const click = async (x, y, count = 1) => {
    await page.mouse('pressed', x, y, { clickCount: count });
    await page.mouse('released', x, y, { clickCount: count });
  };
  const state = () => page.evaluate(`(() => {
    const cover = document.querySelector('.tex8web-viewer'), img = cover.querySelector('img');
    const box = img.getBoundingClientRect(), plate = img.parentElement.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return { open: cover.matches(':popover-open'), laid: Number(img.parentElement.style.getPropertyValue('--tex8web-zoom')), width: img.offsetWidth,
      at: [box.left, box.top], size: [box.width, box.height], plate: [plate.left, plate.top, plate.width, plate.height],
      view: [innerWidth, innerHeight], natural: img.naturalWidth, svg: /\.svg$/i.test(img.getAttribute('src')),
      room: [innerWidth, innerHeight].map(n => n - 2 * Math.max(rem, 0.04 * Math.min(innerWidth, innerHeight)) - rem) };
  })()`);
  // where the plate should be, from where it would be: anywhere the
  // picture still covers the middle of the screen
  const placed = (s, at) => at.map((a, i) => Math.min(s.view[i] / 2, Math.max(s.view[i] / 2 - s.plate[2 + i], a)));
  const off = (s, want) => Math.max(...want.slice(0, 2).map((w, i) => Math.abs(s.plate[i] - w)));
  // the state once it is as wanted (or null, after a second)
  const until = async wanted => {
    for (let t = 0; t < 1000; t += 50) {
      const s = await state();
      if (wanted(s)) return s;
      await sleep(50);
    }
    return null;
  };
  // (a picture in a figure or display math opens it; an icon in the text,
  // up to one and a half times as tall, doesn't)
  const wrong = await page.evaluate(`[...document.querySelectorAll('img:not(.tex8web-viewer img, a img)')]
    .filter(img => img.closest('figure, .mathjax-block') ? !img.classList.contains('tex8web-zoomable')
      : img.classList.contains('tex8web-zoomable') && img.offsetHeight <= 1.5 * parseFloat(getComputedStyle(img).fontSize))
    .map(img => img.getAttribute('src'))`);
  if (wrong.length) problems.push(`opening the viewer or not, wrongly: ${wrong.join(', ')}`);
  const at = await page.evaluate(`(() => {
    const img = document.querySelector('.tex8web-zoomable');
    if (!img) return null;
    img.scrollIntoView({ block: 'center' });
    const box = img.getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2];
  })()`);
  if (!at) {
    await page.close();
    return problems;
  }
  await click(...at);
  await sleep(100);
  // as large as the screen allows (zoom 1), or a picture of pixels at its
  // own size if smaller (home)
  const fit = await state();
  const fitted = Math.min(fit.room[0], fit.room[1] * fit.size[0] / fit.size[1]);
  const home = fit.svg ? 1 : Math.min(1, fit.natural / fitted);
  const zoom = s => s.size[0] / fitted;
  const centered = s => s.view.map((v, i) => (v - s.plate[2 + i]) / 2);
  if (!fit.open) problems.push('a picture clicked: no viewer');
  else if (Math.abs(zoom(fit) - home) > 0.001 || !(off(fit, centered(fit)) <= 0.5)) {
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
      await sleep(50);
      const now = await state();
      zoomed(now, s, Math.min(4, Math.max(home / 2, zoom(s) * Math.exp(-deltaY * 0.002))), what);
      s = now;
    }
    return s;
  };
  const wheeled = await wheel(fit, -100, 3, 'the wheel turned');
  // once the zoom has stopped, laid out again, where it was
  const settled = await until(s => Math.abs(s.laid - zoom(s)) < 0.001);
  if (!settled || Math.abs(settled.width - settled.size[0]) > 0.5
    || Math.abs(settled.size[0] - wheeled.size[0]) > 0.5
    || !(Math.max(...settled.at.map((at, i) => Math.abs(at - wheeled.at[i]))) <= 0.5)) {
    problems.push(`the wheel stopped: ${settled ? `${settled.width}px wide laid out, ${settled.size[0]}px shown at ${settled.at.join(', ')}` : 'not laid out again'}, from ${wheeled.size[0]}px at ${wheeled.at.join(', ')}`);
  }
  // (far enough to reach the middle of the screen)
  await page.mouse('pressed', ...p);
  for (let i = 1; i <= 8; i++) await page.mouse('moved', p[0] + 100 * i, p[1] + 100 * i);
  await page.mouse('released', p[0] + 800, p[1] + 800);
  await sleep(100);
  const dragged = await state();
  const want = placed(dragged, wheeled.plate.slice(0, 2).map(a => a + 800));
  if (Math.abs(zoom(dragged) - zoom(wheeled)) > 0.001 || !(off(dragged, want) <= 0.5)) {
    problems.push(`dragged by 800px: zoom ${zoom(dragged)}, at ${dragged.plate.slice(0, 2).join(', ')} (not ${want.join(', ')})`);
  }
  // (past where it started, to half that)
  const out = await wheel(dragged, 100, 8, 'the wheel turned back');
  // a double-click on the picture, where the drag left it: the point stays
  // under the pointer all the way (css/tex8web.css eases it), in one motion
  const q = out.at.map((a, i) => Math.round(a + out.size[i] / 2));
  await click(...q);
  await click(...q, 2);
  let between = false;
  for (let t = 0; t < 400; t += 40) {
    const now = await state();
    between ||= zoom(now) > 1.01 * home && zoom(now) < 2.49 * home;
    zoomed(now, out, zoom(now), 'during a double-click', q);
    await sleep(40);
  }
  if (!between) problems.push('a double-click: no zoom between where it started and 2.5 times that on the way');
  const zoomedIn = await until(s => Math.abs(s.laid - 2.5 * home) < 0.001);
  if (zoomedIn) zoomed(zoomedIn, out, 2.5 * home, 'a double-click', q);
  else problems.push(`a double-click: not at zoom ${2.5 * home}`);
  await click(...q);
  await click(...q, 2);
  const back = await until(s => Math.abs(s.laid - home) < 0.001);
  if (!back || !(off(back, centered(back)) <= 0.5)) {
    problems.push(`a second double-click: ${back ? `at ${back.plate.slice(0, 2).join(', ')}` : `not at zoom ${home}`}`);
  }
  // (from beside the picture to beside it, the picture moving along: a
  // drag, not a click beside it; then a click beside it)
  await page.mouse('pressed', 2, 2);
  for (let i = 1; i <= 4; i++) await page.mouse('moved', 2 + 10 * i, 2 + 10 * i);
  await page.mouse('released', 42, 42);
  await sleep(100);
  const beside = await state();
  if (beside.at[0] <= 42 && beside.at[1] <= 42) problems.push('a drag beside the picture: ended on it');
  else if (!beside.open) problems.push('a drag ending beside the picture closed the viewer');
  // (the keyboard stays off the page behind)
  const focused = await page.evaluate('document.activeElement.outerHTML.slice(0, 80)');
  await page.press('Tab', 9);
  await sleep(100);
  if (await page.evaluate('document.activeElement.outerHTML.slice(0, 80)') !== focused) problems.push('Tab: the focus behind the viewer moved');
  await page.press('Escape', 27);
  await sleep(300);
  if ((await state()).open) problems.push('Escape: the viewer still open');
  await click(...at);
  await sleep(100);
  if (!(await state()).open) problems.push('a picture clicked again: no viewer');
  // (fading out still open, in the top layer: Safari would draw it under
  // the page's bar, or, on iOS, not at all)
  await click(2, 2);
  await sleep(50);
  const fading = await page.evaluate(`(() => {
    const cover = document.querySelector('.tex8web-viewer');
    return cover.matches(':popover-open') && Number(getComputedStyle(cover).opacity);
  })()`);
  if (!(fading > 0 && fading < 1)) problems.push(`a click beside the picture: no fade out (${fading})`);
  await sleep(250);
  if ((await state()).open) problems.push('a click beside the picture: the viewer still open');
  await page.close();
  return problems;
}

// the closer view with a finger, on a phone's screen: a double tap zooms
// in (Safari on iOS sends no dblclick), and turning the phone keeps the
// point at the middle of the screen where it was in the picture
async function touching(chrome, file) {
  const page = await chrome.open(pathToFileURL(file).href, { width: 400, height: 800 });
  const problems = [];
  const sleep = ms => new Promise(done => setTimeout(done, ms));
  const state = () => page.evaluate(`(() => {
    const cover = document.querySelector('.tex8web-viewer'), img = cover.querySelector('img'), box = img.getBoundingClientRect();
    return { open: cover.matches(':popover-open'), laid: Number(img.parentElement.style.getPropertyValue('--tex8web-zoom')),
      middle: [(innerWidth / 2 - box.left) / box.width, (innerHeight / 2 - box.top) / box.height] };
  })()`);
  const at = await page.evaluate(`(() => {
    const img = document.querySelector('.tex8web-zoomable');
    if (!img) return null;
    img.scrollIntoView({ block: 'center' });
    const box = img.getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2];
  })()`);
  if (at) {
    await page.tap(...at);
    await sleep(300);
    const opened = await state();
    if (!opened.open) problems.push('a picture tapped: no viewer');
    await page.tap(200, 400);
    await sleep(80);
    await page.tap(200, 400);
    await sleep(800);
    const zoomed = await state();
    if (!(zoomed.laid > 2 * opened.laid)) problems.push(`a double tap: zoom ${zoomed.laid}, from ${opened.laid}`);
    await page.resize(800, 400);
    await sleep(300);
    const turned = await state();
    if (turned.middle.some((m, i) => !(Math.abs(m - zoomed.middle[i]) < 0.002))) {
      problems.push(`turned: the picture at ${turned.middle.join(', ')} of it in the middle, not ${zoomed.middle.join(', ')}`);
    }
  }
  await page.close();
  return problems;
}

// the contents' filter: a named theorem found by its head, first among
// what matches, and Enter going to it; then, among the many with an e,
// down twice and up once choosing the second, which Enter goes to
async function filtering(chrome, file) {
  const page = await chrome.open(pathToFileURL(file).href, { width: 1600 });
  const problems = [];
  const sleep = ms => new Promise(done => setTimeout(done, ms));
  const head = await page.evaluate(`(() => {
    const input = document.querySelector('.tex8web-toc-filter');
    const head = [...document.querySelectorAll('.newtheorem .head')]
      .find(h => h.querySelector('.tex8web-permalink') && /\\(.+\\)/.test(h.textContent));
    if (!input) return document.getElementById('tex8web-toc') && 'none';
    if (!head) return null;
    input.focus();
    input.value = head.textContent.replace('#', '').replace(/\\.\\s*$/, '');
    input.dispatchEvent(new Event('input'));
    return head.querySelector('.tex8web-permalink').hash;
  })()`);
  if (head === 'none') problems.push('filter: none beside the table of contents');
  else if (head) {
    const first = await page.evaluate(`document.querySelector('.tex8web-toc-results a')?.hash`);
    if (first !== head) problems.push(`filter: ${first} first, not the theorem ${head}`);
    await page.press('Enter', 13);
    await sleep(100);
    if (await page.evaluate('location.hash') !== head) problems.push(`filter: Enter went to ${await page.evaluate('location.hash')}, not ${head}`);
    const second = await page.evaluate(`(() => {
      const input = document.querySelector('.tex8web-toc-filter');
      input.focus();
      input.value = 'e';
      input.dispatchEvent(new Event('input'));
      return document.querySelectorAll('.tex8web-toc-results a')[1]?.hash;
    })()`);
    if (second) {
      for (const [key, code] of [['ArrowDown', 40], ['ArrowDown', 40], ['ArrowUp', 38], ['Enter', 13]]) await page.press(key, code);
      await sleep(100);
      if (await page.evaluate('location.hash') !== second) problems.push(`filter: arrows and Enter went to ${await page.evaluate('location.hash')}, not ${second}`);
    }
  }
  await page.close();
  return problems;
}

// the reader's place: a theorem halfway down at the top of the screen as
// they leave, there again as they next open the page, and the time after
// (having left it there); but a link's target there instead when the
// address has one
async function resuming(chrome, file) {
  const url = pathToFileURL(file).href;
  let page = await chrome.open(url);
  const problems = [];
  const at = await page.evaluate(`(() => {
    const heads = [...document.querySelectorAll('.newtheorem .head > .tex8web-permalink')];
    const a = heads[heads.length >> 1];
    if (!a) return null;
    const el = document.getElementById(a.hash.slice(1));
    scrollTo(0, scrollY + el.getBoundingClientRect().top + 2);
    // (not on a page too short to scroll it there)
    if (Math.round(el.getBoundingClientRect().top) !== -2) return null;
    dispatchEvent(new Event('pagehide'));
    return el.id;
  })()`);
  await page.close();
  if (at) {
    const top = id => `Math.round(document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().top)`;
    page = await chrome.open(url);
    const rem = await page.evaluate('parseFloat(getComputedStyle(document.documentElement).fontSize)');
    for (const time of ['again', 'a third time']) {
      const back = await page.evaluate(top(at));
      if (Math.abs(back - rem) > 2) problems.push(`place: #${at} ${back}px from the top on opening the page ${time}`);
      await page.close();
      // (for the closed page's pagehide to have kept the place)
      await new Promise(done => setTimeout(done, 200));
      page = await chrome.open(url);
    }
    const other = await page.evaluate("document.querySelector('.tex8web-permalink').hash.slice(1)");
    await page.close();
    page = await chrome.open(`${url}#${other}`);
    if (await page.evaluate(top(at)) < 50) problems.push(`place: #${at} at the top, not the address's #${other}`);
    await page.evaluate('localStorage.clear()');
    await page.close();
  }
  return problems;
}

// on a phone's screen, the bar naming the section being read: nothing
// before the first heading, then a section halfway down scrolled to near
// the top; and tapped, opening the table of contents
async function naming(chrome, file) {
  const page = await chrome.open(pathToFileURL(file).href, { width: 390, height: 844 });
  const problems = [];
  const [before, want, got, opened] = await page.evaluate(`new Promise(done => {
    const where = document.querySelector('.tex8web-where');
    const links = [...document.querySelectorAll('#tex8web-toc .tableofcontents a')];
    const a = links[links.length >> 1];
    if (!a) return done([]);
    const shown = () => where.hidden ? '' : where.textContent;
    const first = document.getElementById(decodeURIComponent(links[0].hash.slice(1)));
    const before = first.getBoundingClientRect().top > innerHeight / 4 ? shown() : '';
    const el = document.getElementById(decodeURIComponent(a.hash.slice(1)));
    scrollTo(0, scrollY + el.getBoundingClientRect().top - 100);
    const copy = a.cloneNode(true);
    copy.querySelectorAll('mjx-assistive-mml').forEach(n => n.remove());
    setTimeout(() => {
      const got = shown();
      where.click();
      done([before, copy.textContent.replace(/\\s+/g, ' ').trim(), got,
        document.getElementById('tex8web-toc').matches(':popover-open')]);
    }, 300);
  })`);
  await page.close();
  if (want === undefined) return problems;
  if (before) problems.push(`bar: "${before}" before the first heading`);
  if (!got.endsWith(want)) problems.push(`bar: "${got}", not the section "${want}"`);
  if (!opened) problems.push('bar: tapped, no table of contents');
  return problems;
}

// on a phone's screen, how much wider than it the page is: nothing should
// be (a display too wide scrolls on its own)
async function overflow(chrome, file) {
  const page = await chrome.open(pathToFileURL(file).href, { width: 390, height: 844 });
  const [width, room] = await page.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]');
  await page.close();
  return width > room ? [`${width - room}px wider than a screen ${room}px wide`] : [];
}

// on a phone's screen, the controls' bar (tex8web-page.js): away scrolling
// down, back scrolling up, but not for a pixel or two the other way
async function bar(chrome, file) {
  const page = await chrome.open(pathToFileURL(file).href, { width: 390, height: 844 });
  const away = await page.evaluate(`(async () => {
    const away = [];
    if (document.documentElement.scrollHeight < 1600) return away;
    for (const y of [300, 600, 597, 560, 563]) {
      scrollTo(0, y);
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      away.push(document.querySelector('.tex8web-controls').classList.contains('tex8web-away'));
    }
    return away;
  })()`);
  await page.close();
  return away.length && away.join() !== 'true,true,true,false,false'
    ? [`the bar away ${away.join(', ')} scrolling to 300, 600, 597, 560 and 563px`] : [];
}

// the theme button: hidden with JavaScript off, as it needs
// tex8web-page.js, but there before that runs, with the other controls (a
// long page is drawn well before its deferred scripts run)
async function themed(chrome, file) {
  const early = file.replace(/\.html$/, '.early.html');
  writeFileSync(early, readFileSync(file, 'utf8').replace(/<script [^>]*src='tex8web-page\.js'[^>]*><\/script>/, ''));
  const problems = [];
  for (const [url, javascript] of [[file, false], [early, true]]) {
    const page = await chrome.open(pathToFileURL(url).href, { javascript });
    const shown = await page.evaluate(`document.querySelector('.tex8web-theme').checkVisibility()`);
    await page.close();
    if (shown !== javascript) problems.push(`the theme button ${shown ? 'shown' : 'hidden'} with JavaScript ${javascript ? 'on, before tex8web-page.js runs' : 'off'}`);
  }
  rmSync(early);
  return problems;
}

// math characters with a clip (css/tex8web.css): there should be none
async function clipped(chrome, file) {
  const page = await chrome.open(pathToFileURL(file).href, { javascript: false });
  const n = await page.evaluate(`[...document.querySelectorAll('mjx-c')]
    .filter(c => getComputedStyle(c).clipPath !== 'none').length`);
  await page.close();
  return n ? [`${n} math characters clipped`] : [];
}

async function screens(chrome, file) {
  const page = await chrome.open(pathToFileURL(file).href, { javascript: false, height: screen });
  const height = await page.evaluate('document.documentElement.scrollHeight');
  const shots = [];
  for (let y = 0; y < height; y += screen) shots.push(await page.screenshot(y, Math.min(screen, height - y)));
  await page.close();
  return shots;
}

const docs = documents().filter(d => !only.length || only.includes(d.name));
// each document built twice, prerendered (html) and for the browser
// (fallback), a few builds at a time (a build runs mostly on one core)
const variants = [['html', 'aux', { TEX8WEB_MATHML: '1' }], ['fallback', 'fallbackaux', { TEX8WEB_NO_PRERENDER: '1' }]];
const codes = await pool(docs.flatMap(doc => variants.map(variant => [doc, ...variant])),
  Math.max(2, availableParallelism() >> 1),
  async ([doc, out, aux, env]) => (await build(doc, join(testDir(doc), out), join(testDir(doc), aux), env)).code);

// a document's two pages compared: its report's lines, and whether it failed
async function compare(chrome, doc, built) {
  const dir = testDir(doc);
  const [pre, browser] = [join(dir, 'html'), join(dir, 'fallback')];
  const visual = join(dir, 'visual');
  rmSync(visual, { recursive: true, force: true });
  // (the build's own problems are npm test's; this needs only the pages)
  if (!built && !existsSync(join(pre, `${doc.tex.replace(/\.tex$/, '')}.html`))) {
    return { lines: [`not ok - ${doc.name}`, '    build failed'], failed: true };
  }
  const problems = [], layout = [];
  for (const html of readdirSync(pre).filter(f => f.endsWith('.html'))) {
    const page = await chrome.open(pathToFileURL(join(browser, html)).href);
    const typeset = join(browser, html.replace(/\.html$/, '.typeset.html'));
    writeFileSync(typeset, await page.evaluate(typesetPage));
    await page.close();
    for (const file of [typeset, join(pre, html)]) {
      const page = await chrome.open(pathToFileURL(file).href, { javascript: false });
      for (const [text, a, b] of await page.evaluate(misaligned)) {
        layout.push(`${relative(dir, file)}: columns at ${a.join(', ')} before "${text}", ${b.join(', ')} after`);
      }
      await page.close();
    }
    const [a, b] = [await screens(chrome, typeset), await screens(chrome, join(pre, html))];
    if (a.length !== b.length) problems.push(`${html}: ${a.length} screens in the browser, ${b.length} prerendered`);
    const differing = [];
    a.forEach((shot, i) => {
      if (shot === b[i]) return;
      differing.push(i);
      mkdirSync(visual, { recursive: true });
      const name = `${html.replace(/\.html$/, '')}-${String(i).padStart(3, '0')}`;
      writeFileSync(join(visual, `${name}-browser.png`), Buffer.from(shot, 'base64'));
      if (b[i]) writeFileSync(join(visual, `${name}-prerendered.png`), Buffer.from(b[i], 'base64'));
    });
    if (differing.length) problems.push(`${html}: screens ${differing.join(', ')} of ${a.length} differ`);
    layout.push(...(await viewing(chrome, join(pre, html))).map(p => `${html}: ${p}`));
    layout.push(...(await overflow(chrome, join(pre, html))).map(p => `${html}: ${p}`));
    layout.push(...(await bar(chrome, join(pre, html))).map(p => `${html}: ${p}`));
    layout.push(...(await themed(chrome, join(pre, html))).map(p => `${html}: ${p}`));
    for (const file of [typeset, join(pre, html)]) {
      layout.push(...(await clipped(chrome, file)).map(p => `${relative(dir, file)}: ${p}`));
    }
    layout.push(...(await filtering(chrome, join(pre, html))).map(p => `${html}: ${p}`));
    layout.push(...(await resuming(chrome, join(pre, html))).map(p => `${html}: ${p}`));
    layout.push(...(await naming(chrome, join(pre, html))).map(p => `${html}: ${p}`));
    layout.push(...(await touching(chrome, join(pre, html))).map(p => `${html}: ${p}`));
  }
  const known = expected[doc.name]?.visual;
  if (problems.length && known && !layout.length) {
    return { lines: [`ok - ${doc.name} # known: ${known}`, ...problems.map(p => `    ${p}`)], failed: false };
  }
  problems.unshift(...layout);
  return { lines: [`${problems.length ? 'not ok' : 'ok'} - ${doc.name}`, ...problems.map(p => `    ${p}`)],
    failed: problems.length > 0 };
}

// then the documents in Chrome, one at a time: with several tabs at once,
// headless Chrome sometimes draws a screen garbled
const chrome = await launch();
let failures = 0;
for (const [i, doc] of docs.entries()) {
  const { lines, failed } = await compare(chrome, doc, codes[2 * i] === 0 && codes[2 * i + 1] === 0);
  console.log(lines.join('\n'));
  failures += failed ? 1 : 0;
}
chrome.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
