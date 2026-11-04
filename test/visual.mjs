// npm run test:visual: each test document and example, prerendered, against
// the same page typeset by MathJax in the browser, compared screen by
// screen with JavaScript off (needs Chrome, and the network for MathJax).
// The two should be identical; differing screens are saved, as
// <screen>-browser.png and <screen>-prerendered.png, in
// build/test/<document>/visual/. In both, the columns of an alignment
// should line up across its \intertext. And the prerendered page's closer
// view of pictures should work with the mouse.
//   node test/visual.mjs [document names...]
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  html.querySelector('.tex8web-theme')?.setAttribute('hidden', 'hidden');
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
    const dialog = document.querySelector('.tex8web-viewer'), img = dialog.firstChild;
    const box = img.getBoundingClientRect(), plate = dialog.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return { open: dialog.open, laid: Number(dialog.style.getPropertyValue('--tex8web-zoom')), width: img.offsetWidth,
      at: [box.left, box.top], size: [box.width, box.height], plate: [plate.left, plate.top, plate.width, plate.height],
      view: [innerWidth, innerHeight], natural: img.naturalWidth, svg: /\.svg$/i.test(img.getAttribute('src')),
      room: [innerWidth, innerHeight].map(n => n - 2 * Math.max(rem, 0.04 * Math.min(innerWidth, innerHeight)) - rem) };
  })()`);
  // where the dialog should be, from where it would be: anywhere the
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
  // the dialog zoomed to z around q, from s
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
  await click(2, 2);
  await sleep(100);
  if ((await state()).open) problems.push('a click beside the picture: the viewer still open');
  await page.close();
  return problems;
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
