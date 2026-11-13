// Screenshots of built pages, for checking a visual change: each page whole,
// a screen at a time, 1400 and 390px wide, light and dark, with JavaScript.
//   node test/shots.mjs <out> <page.html | html directory>
//     writes <page>-<width>-<scheme>-<n>.png into out
//   node test/shots.mjs <out> <old html directory> <new html directory>
//     compares two builds screen by screen and writes the differing screens
//     as <page>-<width>-<scheme>-<n>-old.png and -new.png. Exits 1 if a
//     screen differs or a page is in only one build, 2 on a failure
//   node test/shots.mjs --eval <expression> <page.html | html directory>
//     prints the expression's value as JSON for each page, width, and
//     scheme (a promise is awaited)
//   node test/shots.mjs --review <out> <page.html | html directory>
//     the screens of a first review, beside the PDF's pages, in the light
//     scheme: <page>-<width>-light-<place>.png, a window high, for the
//     places first (the top), contents (the table of contents, opened),
//     middle (the middle of the page), and bibliography (from its
//     heading). Prints a line a place, with the text the screen starts
//     with, for finding the PDF's page, or "none"
// Options:
//   --cache <dir>   keep hashes of the old build's strips, so a later run
//                   against the same old build does not shoot them again.
//                   Checkouts may share dir
//   --expect look   stop each width and scheme at the first differing strip,
//                   and say from which screen the builds differ
//                   (without it, every screen is compared)
//   --keep <n|all>  write at most the first n differing screens of each
//                   width and scheme (default 8); all are listed
//   --clip <sel>    one shot of the band holding the first match of sel
//   --pad <px>      with --clip, the band this much taller above and below,
//                   to show the space around the element
//   --then <expr>   evaluated on each page before the shot; a promise and
//                   the animations it starts are awaited
//   --touch         a touch screen without a mouse
//   --window <w>x<h>  only a window of this size
//   --font-size <px>  the browser's default font size (16 by default)
//   --offline       a page loads only files in its build, and nothing
//                   from the network, for pages built from sources that
//                   are not trusted
// Progress goes to stderr, a line a screen, so a stall shows where it was.
// The PDF page to compare with: pdftoppm -png -r 100 -f <n> -l <n>
// -singlefile <pdf> <out>/pdf
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
const padOption = option('--pad');
const pad = Number(padOption ?? 0);
const expression = option('--eval');
const then = option('--then');
const flag = name => args.includes(name) && Boolean(args.splice(args.indexOf(name), 1));
const touch = flag('--touch');
const offline = flag('--offline');
const review = flag('--review');
const cache = option('--cache');
const expect = option('--expect');
const keepOption = option('--keep');
const windowOption = option('--window');
const fontSizeOption = option('--font-size');
const [out, ...builds] = expression === undefined ? args : [undefined, ...args];
if ((!out && expression === undefined) || !builds.length || builds.length > (expression === undefined ? 2 : 1)
  || (review && (builds.length > 1 || clip !== undefined || expression !== undefined))) {
  console.error('usage: node test/shots.mjs [--clip <selector> [--pad <px>]] [--then <expression>] [--touch] [--window <width>x<height>] [--font-size <px>] [--offline] <out> <page.html | html directory> [<new html directory>]\n'
    + '       node test/shots.mjs --eval <expression> <page.html | html directory>\n'
    + '       node test/shots.mjs --review [--then <expression>] [--touch] [--window <width>x<height>] [--font-size <px>] [--offline] <out> <page.html | html directory>');
  process.exit(2);
}
if ((expect !== undefined && expect !== 'look') || (keepOption !== undefined && !/^(\d+|all)$/.test(keepOption))
  || (windowOption !== undefined && !/^\d+x\d+$/.test(windowOption))
  || (fontSizeOption !== undefined && !/^\d+$/.test(fontSizeOption))
  || (padOption !== undefined && !/^\d+$/.test(padOption))) {
  console.error('--expect takes look, --keep a number or all, --window a width and height, as 1400x900, --font-size a number of px, and --pad a number of px');
  process.exit(2);
}
const keep = keepOption === undefined ? 8 : keepOption === 'all' ? Infinity : Number(keepOption);
const fontSize = fontSizeOption && Number(fontSizeOption);
const windows = windowOption ? [windowOption.split('x').map(Number)] : [[1400, 900], [390, 844]];
// for the tests: only these views, as 1400-light,390-dark
const views = process.env.TEX8WEB_SHOTS_VIEWS?.split(',');
const known = windows.flatMap(([width]) => [`${width}-light`, `${width}-dark`]);
if (views?.some(view => !known.includes(view))) {
  console.error(`TEX8WEB_SHOTS_VIEWS lists some of ${known.join(',')}`);
  process.exit(2);
}
// exit 2, since exit 1 means a difference
process.on('uncaughtException', error => { console.error(error); process.exit(2); });
const pages = path => statSync(path).isDirectory()
  ? readdirSync(path).filter(f => /^[^.]+\.html$/.test(f)).map(f => join(path, f)) : [resolve(path)];
const save = (name, shot) => writeFileSync(join(out, `${name}.png`), Buffer.from(shot, 'base64'));
if (out) mkdirSync(out, { recursive: true });

// the animations a change started, but not endless ones, and a frame
async function settle(tab) {
  await tab.evaluate(`Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity)
    .map(a => a.finished.catch(() => {})))`);
  await tab.frame();
}

async function prepare(tab) {
  if (then === undefined) return;
  await tab.evaluate(then);
  await settle(tab);
}

// A comparison shoots a page in strips of this many screens. Each capture
// has a fixed cost of up to a second, from captureBeyondViewport's resize
// of the page to 1x1 and back (crbug.com/40727379); a wide page switches
// layouts each time. The screens cut from a strip match separate shots.
// Only strips whose hashes differ are decoded and compared screen by
// screen. The tests set a few screens (TEX8WEB_SHOTS_STRIP), so that their
// pages can be short.
const strip = Number(process.env.TEX8WEB_SHOTS_STRIP ?? 20);
if (!Number.isInteger(strip) || strip < 1) {
  console.error('TEX8WEB_SHOTS_STRIP is a number of screens, 1 or more');
  process.exit(2);
}
const hash = shot => createHash('sha256').update(shot).digest('hex');
const report = (label, differing, before, after, height, early) =>
  console.log(`${label}: ${differing.length ? `${early ? `differs from screen ${differing[0]} of ${after}, shots stopped there`
    : `screens ${differing.join(', ')} of ${after} differ`}${before === after ? '' : ` (${before} before)`}, ${height}px each` : 'identical'}`);

// Base64 PNGs of a page's strips by number: those from `from` on, or those
// in `which`, until stop(number, PNG) is true. `total` is the page height.
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

// Cache key of the old build's strip hashes: all of the build's files (as
// pictures may be anywhere in it), the shooting options, this tool, and
// Chrome's version.
const tool = [import.meta.url, new URL('./lib/chrome.mjs', import.meta.url), new URL('./lib/png.mjs', import.meta.url)]
  .map(url => readFileSync(fileURLToPath(url), 'utf8'));
const cacheKey = () => createHash('sha256').update(JSON.stringify([hashFiles(builds[0], [''], { outputs: true }),
  strip, windows, then, touch, fontSize, offline, ...tool, chrome.version])).digest('hex').slice(0, 16);

const cached = file => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;

// Written beside the file, then linked, so a reader never sees a partial
// entry. If another run linked first, its entry is the same and is kept.
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

// One page at one width and scheme: the differing screens, and the screen
// count of each build. With --expect look, only the first differing strip.
// A cached strip hash that differs while the screens do not means a wrong
// cache entry: the entry is deleted and the old build is shot again.
async function compare(page, label, view) {
  const { height } = view;
  const [oldPage, newPage] = builds.map(build => join(build, basename(page)));
  const screens = total => Math.ceil(total / height);
  const differing = [];
  // Decodes one strip at a time: a strip of a wide page is 100 MB.
  const compareStrip = (k, oldShot, newShot) => {
    const [a, b] = [oldShot, newShot].map(shot => shot && decode(Buffer.from(shot, 'base64')));
    let found = 0;
    for (let i = k * strip; i < Math.min((k + 1) * strip, Math.max(screens(old.total), screens(current.total))); i++) {
      // the screen's rows in the strip, if the build has the screen
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
      // not if the build changed during the shots: the key would be wrong
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
      rmSync(file, { force: true });
      old = null;
      differing.length = 0;
      from = 0;
    } else if (current.stopped) from = last + 1;
    else break;
  }
  return [differing, screens(old.total), screens(current.total)];
}

async function band(tab, url) {
  const box = await tab.evaluate(`(() => {
    const box = document.querySelector(${JSON.stringify(clip)})?.getBoundingClientRect();
    return box && { y: Math.floor(box.top + scrollY), h: Math.ceil(box.height) };
  })()`);
  if (box) { box.y = Math.max(0, box.y - pad); box.h += 2 * pad; }
  if (!box) throw new Error(`${url}: nothing matches ${clip}`);
  return [await tab.screenshot(box.y, box.h)];
}

// --review: the places of one page at one width, a screen and a line each
// (text in one line, short enough to search the PDF's text for)
const line = text => text?.replace(/\s+/g, ' ').trim().slice(0, 80);
async function places(tab, label, height) {
  const total = await tab.evaluate('document.documentElement.scrollHeight');
  const shoot = async (place, y, words) => {
    save(`${label}-${place}`, await tab.screenshot(y, Math.min(height, total - y)));
    console.log(`${label}-${place}: ${y}px, ${JSON.stringify(words ?? '')}`);
  };
  // the text from the first text node at y or below to the end of its block
  const textFrom = y => tab.evaluate(`(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node; (node = walk.nextNode());) {
      if (!node.data.trim() || node.parentElement.closest('.tex8web-controls, #tex8web-toc, script, style')) continue;
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (box.height && box.top + scrollY >= ${y}) {
        const block = node.parentElement.closest('p, li, dt, dd, h1, h2, h3, h4, h5, h6, div') ?? node.parentElement;
        range.setEnd(block, block.childNodes.length);
        return range.toString();
      }
    }
  })()`).then(line);
  await shoot('first', 0, await textFrom(0));
  // (opened where it is a closed drawer, as on a phone)
  const contents = await tab.evaluate(`(() => {
    const toc = document.getElementById('tex8web-toc');
    if (toc && !toc.checkVisibility()) toc.showPopover();
    return toc?.querySelector('.tableofcontents')?.textContent;
  })()`);
  if (contents === undefined) console.log(`${label}-contents: none`);
  else {
    await settle(tab);
    await shoot('contents', 0, line(contents));
    await tab.evaluate(`(toc => toc.matches(':popover-open') && toc.hidePopover())(document.getElementById('tex8web-toc'))`);
    await settle(tab);
  }
  const middle = Math.max(0, Math.round((total - height) / 2));
  await shoot('middle', middle, await textFrom(middle));
  // (from the heading before it, if there is one)
  const bibliography = await tab.evaluate(`(() => {
    const list = document.querySelector('.thebibliography');
    const heading = list?.previousElementSibling?.matches('h1, h2, h3, h4, h5, h6') ? list.previousElementSibling : list;
    return list && { y: Math.floor(heading.getBoundingClientRect().top + scrollY), words: list.textContent };
  })()`);
  if (!bibliography) console.log(`${label}-bibliography: none`);
  else await shoot('bibliography', bibliography.y, line(bibliography.words));
}

const names = new Set(builds.flatMap(build => pages(build).map(page => basename(page))));
// (offline, the files of the builds, a page's directory for a page)
const chrome = await launch({ fontSize, offline: offline && builds.map(build => statSync(build).isDirectory() ? build : dirname(build)) });
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
        if (review) {
          if (colorScheme === 'dark') continue;
          await chrome.withPage(pathToFileURL(page).href, { width, height, colorScheme, touch }, async tab => {
            await prepare(tab);
            await places(tab, label, height);
          });
          continue;
        }
        const shots = [];
        for (const file of [page, ...builds.slice(1).map(dir => join(dir, basename(page)))]) {
          const url = pathToFileURL(file).href;
          // progress lines: a long page takes minutes, and run() in
          // lib/build.mjs kills a command that prints nothing for too long
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
