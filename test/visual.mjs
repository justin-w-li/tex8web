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
// wheel and a double-click zoom around the pointer and the picture is
// dragged, kept centered or within the screen, and that it closes
async function viewing(chrome, file) {
  const page = await chrome.open(pathToFileURL(file).href);
  const problems = [];
  const sleep = ms => new Promise(done => setTimeout(done, ms));
  const click = async (x, y, count = 1) => {
    await page.mouse('pressed', x, y, { clickCount: count });
    await page.mouse('released', x, y, { clickCount: count });
    await sleep(100);
  };
  const state = () => page.evaluate(`(() => {
    const dialog = document.querySelector('.tex8web-viewer');
    const box = dialog.firstChild.getBoundingClientRect(), plate = dialog.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return { open: dialog.open, zoom: Number(dialog.style.getPropertyValue('--tex8web-zoom')),
      at: [box.left, box.top], size: [box.width, box.height], plate: [plate.left, plate.top, plate.width, plate.height],
      view: [innerWidth, innerHeight],
      room: [innerWidth, innerHeight].map(n => n - 2 * Math.max(rem, 0.04 * Math.min(innerWidth, innerHeight)) - rem) };
  })()`);
  // where the picture should be, the dialog around it at left, top (where
  // it would be): centered on a side the screen has room for, and on the
  // other, not short of the screen's edge
  const placed = (s, left, top) => [left, top].map((at, i) => {
    const size = s.plate[2 + i], view = s.view[i], padding = s.at[i] - s.plate[i];
    return padding + (size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, at)));
  });
  const off = (s, want) => Math.max(...s.at.map((at, i) => Math.abs(at - want[i])));
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
  if (at) {
    await click(...at);
    const fit = await state();
    const scale = Math.max(fit.size[0] / fit.room[0], fit.size[1] / fit.room[1]);
    if (!fit.open) problems.push('a picture clicked: no viewer');
    else if (Math.abs(scale - 1) > 0.01 || !(off(fit, placed(fit)) <= 0.5)) {
      problems.push(`the viewer's picture ${fit.size.join('x')} at ${fit.at.join(', ')}, for ${fit.room.join('x')}`);
    }
    const [x, y] = [Math.round(fit.at[0] + 0.3 * fit.size[0]), Math.round(fit.at[1] + 0.3 * fit.size[1])];
    // the picture zoomed to z around x, y, from s
    const zoomed = async (s, z, what) => {
      const now = await state();
      const want = placed(now, ...s.at.map((at, i) => [x, y][i] - ([x, y][i] - at) * z / s.zoom - (now.at[i] - now.plate[i])));
      if (Math.abs(now.zoom - z) > 0.001 || Math.abs(now.size[0] - fit.size[0] * z) > 0.5 || !(off(now, want) <= 0.5)) {
        problems.push(`${what}: zoom ${now.zoom} (not ${z.toFixed(3)}), ${now.size[0]}px wide (from ${fit.size[0]}px), at ${now.at.join(', ')} (not ${want.join(', ')})`);
      }
      return now;
    };
    // (a notch at a time, as each may be kept to the screen's edges)
    let wheeled = fit;
    for (let i = 0; i < 3; i++) {
      await page.mouse('wheel', x, y, { deltaY: -100 });
      await sleep(100);
      wheeled = await zoomed(wheeled, wheeled.zoom * Math.exp(0.2), 'the wheel turned');
    }
    await page.mouse('pressed', x, y);
    // (far enough to reach the screen's edge)
    for (let i = 1; i <= 8; i++) await page.mouse('moved', x + 50 * i, y + 50 * i);
    await page.mouse('released', x + 400, y + 400);
    await sleep(100);
    const dragged = await state();
    const want = placed(dragged, wheeled.plate[0] + 400, wheeled.plate[1] + 400);
    if (dragged.zoom !== wheeled.zoom || !(off(dragged, want) <= 0.5)) {
      problems.push(`dragged by 400px: zoom ${dragged.zoom}, at ${dragged.at.join(', ')} (not ${want.join(', ')})`);
    }
    for (let i = 0; i < 5; i++) await page.mouse('wheel', x, y, { deltaY: 100 });
    await sleep(100);
    const out = await state();
    if (out.zoom !== 1 || !(off(out, fit.at) <= 0.5)) problems.push(`the wheel turned back: zoom ${out.zoom}, at ${out.at.join(', ')}`);
    // (a double-click eases, css/tex8web.css: a little after it ends)
    await click(x, y);
    await click(x, y, 2);
    await sleep(500);
    await zoomed(out, 2.5, 'a double-click');
    await click(x, y);
    await click(x, y, 2);
    await sleep(500);
    const back = await state();
    if (back.zoom !== 1 || !(off(back, fit.at) <= 0.5)) problems.push(`a second double-click: zoom ${back.zoom}, at ${back.at.join(', ')}`);
    // (from the picture to beside it: a drag, not a click beside it)
    await page.mouse('pressed', x, y);
    for (let i = 1; i <= 4; i++) await page.mouse('moved', x - (x - 2) * i / 4, y - (y - 2) * i / 4);
    await page.mouse('released', 2, 2);
    await sleep(100);
    if (!(await state()).open) problems.push('a drag ending beside the picture closed the viewer');
    await click(2, 2);
    if ((await state()).open) problems.push('a click beside the picture: the viewer still open');
  }
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
const variants = [['html', 'aux', {}], ['fallback', 'fallbackaux', { TEX8WEB_NO_PRERENDER: '1' }]];
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
