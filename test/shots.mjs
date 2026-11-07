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
//     doesn't shoot them again. Checkouts may share it
//   --expect look, before either: the builds are expected to look different,
//     so stop each width and scheme at the first strip of screens that
//     differs and say from which screen. Without it every screen is compared
//   --keep <n | all>, before either: write the old and new screens for at
//     most n differing screens of each width and scheme, the first ones
//     (default 8). The output lists all that differ
//   --clip <selector>, before either: only the band of the page holding the
//     first element the selector matches, in one shot
//   --then <expression>, before either: evaluated on each page (a promise
//     awaited, then the animations it starts) before it's shot
//   --touch, before either: on a touch screen without a mouse
//   --window <width>x<height>, before either: in a window of that size
//     only, as views named by its width
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
const windowOption = option('--window');
const [out, ...builds] = expression === undefined ? args : [undefined, ...args];
if ((!out && expression === undefined) || !builds.length || builds.length > (expression === undefined ? 2 : 1)) {
  console.error('usage: node test/shots.mjs [--clip <selector>] [--then <expression>] [--touch] [--window <width>x<height>] <out> <page.html | html directory> [<new html directory>]\n'
    + '       node test/shots.mjs --eval <expression> <page.html | html directory>');
  process.exit(2);
}
if ((expect !== undefined && expect !== 'look') || (keepOption !== undefined && !/^(\d+|all)$/.test(keepOption))
  || (windowOption !== undefined && !/^\d+x\d+$/.test(windowOption))) {
  console.error('--expect takes look, --keep a number or all, and --window a width and height, as 1400x900');
  process.exit(2);
}
const keep = keepOption === undefined ? 8 : keepOption === 'all' ? Infinity : Number(keepOption);
const windows = windowOption ? [windowOption.split('x').map(Number)] : [[1400, 900], [390, 844]];
// (the tests' hook: only the views a test looks at, as 1400-light,390-dark)
const views = process.env.TEX8WEB_SHOTS_VIEWS?.split(',');
const known = windows.flatMap(([width]) => [`${width}-light`, `${width}-dark`]);
if (views?.some(view => !known.includes(view))) {
  console.error(`TEX8WEB_SHOTS_VIEWS lists some of ${known.join(',')}`);
  process.exit(2);
}
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
// costs Chrome up to a second more than its height does, and the screens
// of a strip are what they would be one by one. That cost is
// captureBeyondViewport's resize of the page to 1x1 and back
// (crbug.com/40727379). A wide page switches layouts each time. A strip
// that is the same in both builds settles its screens; only the screens of
// the others are cut out and compared. The tests make a strip a few screens
// (TEX8WEB_SHOTS_STRIP), so that their pages can be short.
const strip = Number(process.env.TEX8WEB_SHOTS_STRIP ?? 20);
if (!Number.isInteger(strip) || strip < 1) {
  console.error('TEX8WEB_SHOTS_STRIP is a number of screens, 1 or more');
  process.exit(2);
}
const hash = shot => createHash('sha256').update(shot).digest('hex');
const report = (label, differing, before, after, height, early) =>
  console.log(`${label}: ${differing.length ? `${early ? `differs from screen ${differing[0]} of ${after}, shots stopped there`
    : `screens ${differing.join(', ')} of ${after} differ`}${before === after ? '' : ` (${before} before)`}, ${height}px each` : 'identical'}`);

// The strips of one page, as PNGs (base64) by number: those from `from` on,
// or those in `which`, up to the first that stop(number, PNG) says to stop
// at. Resolves to { total, shots, stopped }, total being the page's height
async function shootStrips(file, at, { width, height, colorScheme }, { from = 0, which, stop } = {}) {
  return chrome.withPage(pathToFileURL(file).href, { width, height, colorScheme, touch }, async tab => {
    await prepare(tab);
    const total = await tab.evaluate('document.documentElement.scrollHeight');
    const count = Math.ceil(total / (strip * height));
    const shots = new Map();
    let stopped = false;
    for (const k of which ?? Array.from({ length: Math.max(count - from, 0) }, (_, i) => from + i)) {
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
// key made of what decides them: the old build's files (all of them, as
// pictures may be anywhere in it), this tool, Chrome
const tool = [import.meta.url, new URL('./lib/chrome.mjs', import.meta.url), new URL('./lib/png.mjs', import.meta.url)]
  .map(url => readFileSync(fileURLToPath(url), 'utf8'));
const cacheKey = () => createHash('sha256').update(JSON.stringify([hashFiles(builds[0], [''], { outputs: true }),
  strip, windows, then, touch, ...tool, chrome.version])).digest('hex').slice(0, 16);

// the cached strips of a page at one width and scheme, if there are any
const cached = file => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;

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
// With --expect look it stops at the first strip whose screens differ
// (when the cached strips of the old build say it differs, but the screens
// don't, they are wrong and are shot again), and the numbers are those of
// that strip
async function compare(page, label, view) {
  const { height } = view;
  const [oldPage, newPage] = builds.map(build => join(build, basename(page)));
  const screens = total => Math.ceil(total / height);
  const differing = [];
  // the screens of strip k that differ, from its two PNGs. One strip's pictures
  // at a time: a strip of a wide page is 100 MB
  const compareStrip = (k, oldShot, newShot) => {
    const [a, b] = [oldShot, newShot].map(shot => shot && decode(Buffer.from(shot, 'base64')));
    let found = 0;
    for (let i = k * strip; i < Math.min((k + 1) * strip, Math.max(screens(old.total), screens(current.total))); i++) {
      // (a screen's rows in its strip's picture, if the build has the screen)
      const rows = picture => picture && i * height - k * strip * height < picture.height
        && [i * height - k * strip * height, Math.min((i + 1) * height - k * strip * height, picture.height)];
      const [from, to] = [a, b].map(rows);
      const stride = a?.width * a?.channels;
      const same = from && to && from[1] - from[0] === to[1] - to[0] && a.channels === b.channels
        && a.rows.subarray(from[0] * stride, from[1] * stride).equals(b.rows.subarray(to[0] * stride, to[1] * stride));
      if (same) continue;
      found++;
      differing.push(i);
      if (differing.length > keep) continue;
      const n = String(i).padStart(3, '0');
      if (from) writeFileSync(join(out, `${label}-${n}-old.png`), encode(a, ...from));
      if (to) writeFileSync(join(out, `${label}-${n}-new.png`), encode(b, ...to));
    }
    return found;
  };

  let file = cache && join(cache, cacheKey(), `${label}.json`);
  let old = file && cached(file), current, oldShots;
  for (let from = 0;;) {
    if (!old) {
      const key = cache && cacheKey();
      file = cache && join(cache, key, `${label}.json`);
      const shot = await shootStrips(oldPage, `${label}: old, `, view);
      oldShots = shot.shots;
      old = { total: shot.total, hashes: [...oldShots.values()].map(hash) };
      // (not if the build was replaced meanwhile: these are not what the key says)
      if (cache && cacheKey() === key) keepEntry(file, old);
    }
    current = await shootStrips(newPage, `${label}: new, `, view,
      { from, stop: expect && ((k, shot) => hash(shot) !== old.hashes[k]) });
    const last = current.stopped ? Math.max(...current.shots.keys())
      : Math.max(old.hashes.length, Math.ceil(current.total / (strip * height))) - 1;
    const unlike = [...Array(last + 1).keys()].filter(k => k >= from
      && old.hashes[k] !== (current.shots.has(k) ? hash(current.shots.get(k)) : undefined));
    const again = oldShots ?? (unlike.length
      ? (await shootStrips(oldPage, `${label}: old again, `, view, { which: unlike.filter(k => k < old.hashes.length) })).shots : new Map());
    const alike = unlike.filter(k => !compareStrip(k, again.get(k), current.shots.get(k)));
    if (!alike.length) break;
    if (!oldShots) {
      // the cached strips said these differ, and they don't: the entry is wrong
      rmSync(file, { force: true });
      old = null;
      differing.length = 0;
      from = 0;
    } else if (current.stopped) from = last + 1;
    else break;
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
        if (views && !views.includes(`${width}-${colorScheme}`)) continue;
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
