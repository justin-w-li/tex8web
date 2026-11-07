// Screenshots of built pages, as a visual change is checked: each page at
// 1400 and 390px wide, light and dark, with JavaScript on, whole, a screen
// at a time.
//   node test/shots.mjs <out> <page.html | html directory>
//     writes <page>-<width>-<scheme>-<n>.png into out
//   node test/shots.mjs <out> <old html directory> <new html directory>
//     compares the pages of two builds screen by screen, writes the screens
//     that differ as <page>-<width>-<scheme>-<n>-old.png and -new.png (the
//     first few, see --keep), and exits 1 if any do or a page is in only one
//     build (2 if it couldn't compare)
//   --cache <dir>, before either: where the old build's screens are kept, as
//     what they came to, so that a later run against the same old build
//     doesn't shoot them again. Checkouts may share it. A cache made with
//     another Chrome is refused
//   --expect look, before either: the builds are expected to look different,
//     so stop each width and scheme at the first strip of 20 screens that
//     differs and say from which screen. Without it every screen is compared
//   --keep <n | all>, before either: write the old and new screens for at
//     most n differing screens of each width and scheme, the first ones
//     (default 8). The output lists all that differ
//   --clip <selector>, before either: only the band of the page holding the
//     first element the selector matches, in one shot
//   --then <expression>, before either: evaluated on each page (a promise
//     awaited, then the animations it starts) before it's shot
//   --touch, before either: on a touch screen without a mouse
//   node test/shots.mjs --eval <expression> <page.html | html directory>
//     prints, for each page, width and scheme, the expression's value on the
//     page, as JSON (a promise is awaited)
// It prints its progress on stderr, a line a screen, so that a stall says
// where it was.
// The PDF's page beside them: pdftoppm -png -r 100 -f <n> -l <n> -singlefile
// <pdf> <out>/pdf
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashFiles } from './lib/build.mjs';
import { launch } from './lib/chrome.mjs';
import { decode, encode } from './lib/png.mjs';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args.splice(args.indexOf(name), 2)[1] : undefined;
const clip = option('--clip');
const expression = option('--eval');
const then = option('--then');
const touch = args.includes('--touch');
if (touch) args.splice(args.indexOf('--touch'), 1);
const cache = option('--cache');
const expect = option('--expect');
const keepOption = option('--keep');
const [out, ...builds] = expression === undefined ? args : [undefined, ...args];
if ((!out && expression === undefined) || !builds.length || builds.length > (expression === undefined ? 2 : 1)) {
  console.error('usage: node test/shots.mjs [--clip <selector>] [--then <expression>] [--touch] <out> <page.html | html directory> [<new html directory>]\n'
    + '       node test/shots.mjs --eval <expression> <page.html | html directory>');
  process.exit(2);
}
if ((expect !== undefined && expect !== 'look') || (keepOption !== undefined && !/^(\d+|all)$/.test(keepOption))) {
  console.error('--expect takes look, and --keep a number or all');
  process.exit(2);
}
const keep = keepOption === undefined ? 8 : keepOption === 'all' ? Infinity : Number(keepOption);
const windows = [[1400, 900], [390, 844]];
// (a failure isn't a difference)
process.on('uncaughtException', error => { console.error(error); process.exit(2); });
const pages = path => statSync(path).isDirectory()
  ? readdirSync(path).filter(f => /^[^.]+\.html$/.test(f)).map(f => join(path, f)) : [resolve(path)];
const save = (name, shot) => writeFileSync(join(out, `${name}.png`), Buffer.from(shot, 'base64'));
if (out) mkdirSync(out, { recursive: true });

// what --then has the page do before it is shot
async function prepare(tab) {
  if (then === undefined) return;
  await tab.evaluate(then);
  await tab.evaluate('Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))');
  await tab.frame();
}

// A comparison shoots a page in strips of this many screens, as a capture
// costs Chrome half a second whatever its height (captureBeyondViewport),
// and the screens of a strip are what they would be one by one. A strip
// that is the same in both builds settles its screens; only the screens of
// the others are cut out and compared.
const strip = 20;
const hash = shot => createHash('sha256').update(shot).digest('hex');
const report = (label, differing, before, after, height, early) =>
  console.log(`${label}: ${differing.length ? `${early ? `differs from screen ${differing[0]} of ${after}, shots stopped there`
    : `screens ${differing.join(', ')} of ${after} differ`}${before === after ? '' : ` (${before} before)`}, ${height}px each` : 'identical'}`);

// The strips of one page, as PNGs (base64) by number: all of them, or those
// in `which`, or up to the first that stop(number, PNG) says to stop at.
// Resolves to { total, shots, stopped }, total being the page's height
async function shootStrips(file, at, { width, height, colorScheme }, { which, stop } = {}) {
  return chrome.withPage(pathToFileURL(file).href, { width, height, colorScheme, touch }, async tab => {
    await prepare(tab);
    const total = await tab.evaluate('document.documentElement.scrollHeight');
    const count = Math.ceil(total / (strip * height));
    const shots = new Map();
    let stopped = false;
    for (const k of which ?? [...Array(count).keys()]) {
      const y = k * strip * height;
      console.error(`${at}strip ${k + 1} of ${count}`);
      shots.set(k, await tab.screenshot(y, Math.min(strip * height, total - y)));
      if (stop?.(k, shots.get(k))) {
        stopped = true;
        break;
      }
    }
    return { total, shots, stopped };
  });
}

// What the old build's strips came to, kept in the cache directory under a
// key made of what decides them: the old build's files, this tool, Chrome
let key;
const cacheKey = () => key ??= createHash('sha256').update(JSON.stringify([hashFiles(builds[0], ['']), strip, windows, then, touch,
  ...[import.meta.url, new URL('./lib/chrome.mjs', import.meta.url), new URL('./lib/png.mjs', import.meta.url)]
    .map(url => readFileSync(fileURLToPath(url), 'utf8')), chrome.version])).digest('hex').slice(0, 16);

// the cached strips of a page at one width and scheme, if there are any.
// A cache of another Chrome's is an error: its key has the version in it,
// so that is a file put there by hand or by another tool
function cached(file) {
  if (!existsSync(file)) return null;
  const entry = JSON.parse(readFileSync(file, 'utf8'));
  if (entry.chrome !== chrome.version) throw new Error(`${file} was made with ${entry.chrome}, and this is ${chrome.version}`);
  return entry;
}

// Keeps an entry for the next run, whole: written beside the file, then
// linked to it. A run that was first has its entry kept, and this one's,
// which is the same, is dropped
function keepEntry(file, entry) {
  mkdirSync(dirname(file), { recursive: true });
  const staged = `${file}.${process.pid}`;
  writeFileSync(staged, JSON.stringify(entry));
  try {
    linkSync(staged, file);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    rmSync(staged);
  }
}

// Compares one page of the old and new builds at one width and scheme:
// the numbers of the screens that differ, and how many screens each build has.
// With --expect look it stops at the first strip that differs, and the
// numbers are those of that strip
async function compare(page, label, view) {
  const { height } = view;
  const [oldPage, newPage] = builds.map(build => join(build, basename(page)));
  const file = cache && join(cache, cacheKey(), `${label}.json`);
  let old = file && cached(file);
  let oldShots;
  if (!old) {
    const shot = await shootStrips(oldPage, `${label}: old, `, view);
    oldShots = shot.shots;
    old = { chrome: chrome.version, total: shot.total, hashes: [...oldShots.values()].map(hash) };
    if (file) keepEntry(file, old);
  }
  const current = await shootStrips(newPage, `${label}: new, `, view,
    { stop: expect && ((k, shot) => hash(shot) !== old.hashes[k]) });
  const last = current.stopped ? Math.max(...current.shots.keys()) : Math.max(old.hashes.length, current.shots.size) - 1;
  const unlike = [...Array(last + 1).keys()].filter(k => old.hashes[k] !== (current.shots.has(k) ? hash(current.shots.get(k)) : undefined));
  oldShots ??= unlike.length ? (await shootStrips(oldPage, `${label}: old again, `, view, { which: unlike.filter(k => k < old.hashes.length) })).shots : new Map();
  const screens = total => Math.ceil(total / height);
  const differing = [];
  for (const k of unlike) {
    // (one strip's pictures at a time: a strip of a wide page is 100 MB)
    const [a, b] = [oldShots.get(k), current.shots.get(k)].map(shot => shot && decode(Buffer.from(shot, 'base64')));
    for (let i = k * strip; i < Math.min((k + 1) * strip, Math.max(screens(old.total), screens(current.total))); i++) {
      // (a screen's rows in its strip's picture, if the build has the screen)
      const rows = picture => picture && i * height - k * strip * height < picture.height
        && [i * height - k * strip * height, Math.min((i + 1) * height - k * strip * height, picture.height)];
      const [from, to] = [a, b].map(rows);
      const stride = a?.width * a?.channels;
      const same = from && to && from[1] - from[0] === to[1] - to[0] && a.channels === b.channels
        && a.rows.subarray(from[0] * stride, from[1] * stride).equals(b.rows.subarray(to[0] * stride, to[1] * stride));
      if (same) continue;
      differing.push(i);
      if (differing.length > keep) continue;
      const n = String(i).padStart(3, '0');
      if (from) writeFileSync(join(out, `${label}-${n}-old.png`), encode(a, ...from));
      if (to) writeFileSync(join(out, `${label}-${n}-new.png`), encode(b, ...to));
    }
  }
  return [differing, screens(old.total), screens(current.total)];
}

// the band of the page holding the selector's element, as one screen
async function band(tab, url) {
  const box = await tab.evaluate(`(() => {
    const box = document.querySelector(${JSON.stringify(clip)})?.getBoundingClientRect();
    return box && { y: Math.floor(box.top + scrollY), h: Math.ceil(box.height) };
  })()`);
  if (!box) throw new Error(`${url}: nothing matches ${clip}`);
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
        if (builds.length === 2 && !clip && expression === undefined) {
          const [differing, before, after] = await compare(page, label, { width, height, colorScheme });
          differ ||= differing.length > 0;
          report(label, differing, before, after, height, expect === 'look');
          continue;
        }
        const shots = [];
        for (const file of [page, ...builds.slice(1).map(dir => join(dir, basename(page)))]) {
          const url = pathToFileURL(file).href;
          // (a long page takes minutes, and run() kills a command that is
          // silent for long)
          const at = `${label}: ${builds.length === 1 ? '' : file === page ? 'old, ' : 'new, '}`;
          console.error(`${at}loading`);
          await chrome.withPage(url, { width, height, colorScheme, touch }, async tab => {
            await prepare(tab);
            if (expression !== undefined) console.log(`${label}: ${JSON.stringify(await tab.evaluate(expression))}`);
            else shots.push(clip ? await band(tab, url) : await tab.screens((i, n) => console.error(`${at}screen ${i} of ${n}`)));
          });
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
        report(label, differing, a.length, b.length, height);
      }
    }
  }
} finally {
  chrome.close();
}
process.exitCode = differ ? 1 : 0;
