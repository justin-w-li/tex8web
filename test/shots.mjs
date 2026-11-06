// Screenshots of built pages, as a visual change is checked: each page at
// 1400 and 390px wide, light and dark, with JavaScript on, whole, a screen
// at a time.
//   node test/shots.mjs <out> <page.html | html directory>
//     writes <page>-<width>-<scheme>-<n>.png into out
//   node test/shots.mjs <out> <old html directory> <new html directory>
//     compares the pages of two builds screen by screen, writes the screens
//     that differ as <page>-<width>-<scheme>-<n>-old.png and -new.png, and
//     exits 1 if any do or a page is in only one build (2 if it couldn't
//     compare)
//   --clip <selector>, before either: only the band of the page holding the
//     first element the selector matches, in one shot
//   node test/shots.mjs --eval <expression> <page.html | html directory>
//     prints, for each page, width and scheme, the expression's value on the
//     page, as JSON (a promise is awaited)
// The PDF's page beside them: pdftoppm -png -r 100 -f <n> -l <n> -singlefile
// <pdf> <out>/pdf
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './lib/chrome.mjs';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args.splice(args.indexOf(name), 2)[1] : undefined;
const clip = option('--clip');
const expression = option('--eval');
const [out, ...builds] = expression === undefined ? args : [undefined, ...args];
if ((!out && expression === undefined) || !builds.length || builds.length > (expression === undefined ? 2 : 1)) {
  console.error('usage: node test/shots.mjs [--clip <selector>] <out> <page.html | html directory> [<new html directory>]\n'
    + '       node test/shots.mjs --eval <expression> <page.html | html directory>');
  process.exit(2);
}
const windows = [[1400, 900], [390, 844]];
// (a failure isn't a difference)
process.on('uncaughtException', error => { console.error(error); process.exit(2); });
const pages = path => statSync(path).isDirectory()
  ? readdirSync(path).filter(f => /^[^.]+\.html$/.test(f)).map(f => join(path, f)) : [resolve(path)];
const save = (name, shot) => writeFileSync(join(out, `${name}.png`), Buffer.from(shot, 'base64'));
if (out) mkdirSync(out, { recursive: true });

// the band of the page holding the selector's element, as one screen
async function band(tab, url) {
  const box = await tab.evaluate(`(() => {
    const box = document.querySelector(${JSON.stringify(clip)})?.getBoundingClientRect();
    return box && { y: Math.floor(box.top + scrollY), h: Math.ceil(box.height) };
  })()`);
  if (!box) throw new Error(`${url}: nothing matches ${clip}`);
  // (twice, as in screens())
  await tab.screenshot(box.y, box.h);
  return [await tab.screenshot(box.y, box.h)];
}

// the pages of the one build, or those of either of two
const names = new Set(builds.flatMap(build => pages(build).map(page => basename(page))));
const chrome = await launch();
let differ = false;
try {
  for (const page of builds.length === 1 ? pages(builds[0]) : [...names].map(name => join(builds[0], name))) {
    const name = basename(page, '.html');
    const only = builds.filter(build => !existsSync(join(build, basename(page))));
    if (builds.length === 2 && only.length) {
      console.log(`${name}: only in ${builds.find(build => !only.includes(build))}`);
      differ = true;
      continue;
    }
    for (const [width, height] of windows) {
      for (const colorScheme of ['light', 'dark']) {
        const label = `${name}-${width}-${colorScheme}`;
        const shots = [];
        for (const file of [page, ...builds.slice(1).map(dir => join(dir, basename(page)))]) {
          const url = pathToFileURL(file).href;
          const tab = await chrome.open(url, { width, height, colorScheme });
          if (expression !== undefined) console.log(`${label}: ${JSON.stringify(await tab.evaluate(expression))}`);
          else shots.push(clip ? await band(tab, url) : await tab.screens());
          await tab.close();
        }
        if (expression !== undefined) continue;
        const n = i => String(i).padStart(3, '0');
        if (shots.length === 1) {
          shots[0].forEach((shot, i) => save(`${label}-${n(i)}`, shot));
          continue;
        }
        const [a, b] = shots;
        const differing = [...Array(Math.max(a.length, b.length)).keys()].filter(i => a[i] !== b[i]);
        for (const i of differing) {
          if (a[i]) save(`${label}-${n(i)}-old`, a[i]);
          if (b[i]) save(`${label}-${n(i)}-new`, b[i]);
        }
        differ ||= differing.length > 0;
        console.log(`${label}: ${differing.length ? `screens ${differing.join(', ')} of ${b.length} differ`
          + `${a.length === b.length ? '' : ` (${a.length} before)`}, ${height}px each` : 'identical'}`);
      }
    }
  }
} finally {
  chrome.close();
}
process.exitCode = differ ? 1 : 0;
