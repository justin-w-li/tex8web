// Screenshots of built pages, as a visual change is checked: each page at
// 1400 and 390px wide, light and dark, with JavaScript on, whole, a screen
// at a time.
//   node test/shots.mjs <out> <page.html | html directory>
//     writes <page>-<width>-<scheme>-<n>.png into out
//   node test/shots.mjs <out> <old html directory> <new html directory>
//     compares the same pages of two builds screen by screen, writes the
//     screens that differ as <page>-<width>-<scheme>-<n>-old.png and -new.png,
//     and fails if any do
// The PDF's page beside them: pdftoppm -png -r 100 -f <n> -l <n> -singlefile
// <pdf> <out>/pdf
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './lib/chrome.mjs';

const [out, ...builds] = process.argv.slice(2);
if (!out || !builds.length || builds.length > 2) {
  console.error('usage: node test/shots.mjs <out> <page.html | html directory> [<new html directory>]');
  process.exit(2);
}
const windows = [[1400, 900], [390, 844]];
const pages = path => statSync(path).isDirectory()
  ? readdirSync(path).filter(f => /^[^.]+\.html$/.test(f)).map(f => join(path, f)) : [resolve(path)];
const save = (name, shot) => writeFileSync(join(out, `${name}.png`), Buffer.from(shot, 'base64'));
mkdirSync(out, { recursive: true });

const chrome = await launch();
let differ = false;
try {
  for (const page of pages(builds[0])) {
    const name = basename(page, '.html');
    for (const [width, height] of windows) {
      for (const colorScheme of ['light', 'dark']) {
        const shots = [];
        for (const file of [page, ...builds.slice(1).map(dir => join(dir, basename(page)))]) {
          const tab = await chrome.open(pathToFileURL(file).href, { width, height, colorScheme });
          shots.push(await tab.screens());
          await tab.close();
        }
        const label = `${name}-${width}-${colorScheme}`;
        if (shots.length === 1) {
          shots[0].forEach((shot, i) => save(`${label}-${i}`, shot));
          continue;
        }
        const [a, b] = shots;
        const differing = [...Array(Math.max(a.length, b.length)).keys()].filter(i => a[i] !== b[i]);
        for (const i of differing) {
          if (a[i]) save(`${label}-${i}-old`, a[i]);
          if (b[i]) save(`${label}-${i}-new`, b[i]);
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
process.exit(differ ? 1 : 0);
