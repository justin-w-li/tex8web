// Tests of shots.mjs's comparison, which need Chrome, run by npm run
// test:visual: node --test test/shots.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decode } from './lib/png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'tex8webshots'));
after(() => rmSync(dir, { recursive: true }));

// a page 45 screens high at 900px (more than a strip), with a bar fixed to
// the top, a footer fixed to the bottom, a sticky header, a block as high as
// the window, and a line of text at 25000px
const page = (name, { extra = '', more = 0, color = 'black', background = 'white', style = '' } = {}) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, 'main.html'), `<!DOCTYPE html><meta charset="utf-8"><style>
    body { margin: 0; font: 20px sans-serif; background: ${background}; } .bar { position: fixed; top: 0; left: 0; right: 0; background: #ccc; }
    .foot { position: fixed; bottom: 0; left: 0; right: 0; background: #cfc; } .head { position: sticky; top: 30px; height: 0; } .head span { background: #fc9; }
    .tall { height: 100vh; background: linear-gradient(#fff, #9cf); } .gap { height: ${24100 + more}px; }
    .end { height: 14976px; } ${style} p { height: 24px; margin: 0; color: ${color}; }</style>
    <div class="bar">bar</div><div class="foot">footer</div><div class="head"><span>header</span></div><div class="tall">window</div><div class="gap"></div><p>${extra}</p><div class="end"></div>`);
  return join(dir, name);
};
const shots = (...args) => spawnSync(process.execPath, [join(here, 'shots.mjs'), ...args], { encoding: 'utf8', timeout: 300000 });
const lines = result => result.stdout.trim().split('\n');

test('a comparison says which screens differ, and writes them', () => {
  const [old, same, changed] = [page('old'), page('same'), page('changed', { extra: 'new words', color: 'red' })];
  let result = shots(join(dir, 'out-same'), old, same);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(lines(result).map(line => line.replace(/^main-/, '')), ['1400-light: identical', '1400-dark: identical', '390-light: identical', '390-dark: identical']);
  assert.deepEqual(readdirSync(join(dir, 'out-same')), []);

  result = shots(join(dir, 'out-changed'), old, changed);
  assert.equal(result.status, 1, result.stderr);
  // (the text is at 25000px, in screen 27 of 45 at 900px, 29 of 48 at 844px)
  assert.match(lines(result)[0], /^main-1400-light: screens 27 of 45 differ, 900px each$/);
  assert.match(lines(result)[3], /^main-390-dark: screens 29 of 48 differ, 844px each$/);
  const written = readdirSync(join(dir, 'out-changed')).sort();
  assert.deepEqual(written.filter(file => file.startsWith('main-1400-light')), ['main-1400-light-027-new.png', 'main-1400-light-027-old.png']);

  // the screens written are the page's, as one-by-one shots (a single build) have them
  shots(join(dir, 'out-one'), join(changed, 'main.html'));
  const one = decode(readFileSync(join(dir, 'out-one/main-1400-light-027.png')));
  const compared = decode(readFileSync(join(dir, 'out-changed/main-1400-light-027-new.png')));
  assert.deepEqual([compared.width, compared.height], [one.width, one.height]);
  assert.ok(compared.rows.equals(one.rows), 'the screen is not the one shot alone');
});

test('a build with more screens says how many it had before', () => {
  const result = shots(join(dir, 'out-taller'), page('old'), page('taller', { more: 2000 }));
  assert.equal(result.status, 1, result.stderr);
  assert.match(lines(result)[0], /^main-1400-light: screens 44, 45, 46 of 47 differ \(45 before\), 900px each$/);
});

test('the old build\'s screens are kept, for that build only', () => {
  const [old, changed, cache] = [page('old'), page('changed', { extra: 'words' }), join(dir, 'cache')];
  const first = shots('--cache', cache, join(dir, 'out-a'), old, changed);
  assert.match(first.stderr, /main-1400-light: old, strip 1 of 3/);
  const again = shots('--cache', cache, join(dir, 'out-b'), old, changed);
  assert.doesNotMatch(again.stderr, /: old, strip/);
  assert.equal(again.stdout, first.stdout);
  assert.deepEqual(readdirSync(join(dir, 'out-b')).sort(), readdirSync(join(dir, 'out-a')).sort());

  // another old build is shot again
  const other = shots('--cache', cache, join(dir, 'out-c'), changed, old);
  assert.match(other.stderr, /main-1400-light: old, strip 1 of 3/);
  assert.equal(other.status, 1);
});

test('only the first few differing screens are written, and the output lists them all', () => {
  const [old, other] = [page('old'), page('other', { background: '#eef' })];
  // (all but the first, which a block as high as the window covers)
  const everything = Array.from({ length: 44 }, (_, i) => i + 1).join(', ');
  let result = shots(join(dir, 'out-8'), old, other);
  assert.equal(result.status, 1, result.stderr);
  assert.match(lines(result)[0], new RegExp(`^main-1400-light: screens ${everything} of 45 differ, 900px each$`));
  const written = prefix => readdirSync(join(dir, 'out-8')).filter(file => file.startsWith(prefix));
  assert.deepEqual(written('main-1400-light-').map(file => file.slice(16, 19)).filter((n, i, all) => all.indexOf(n) === i),
    ['001', '002', '003', '004', '005', '006', '007', '008']);

  result = shots('--keep', '2', join(dir, 'out-2'), old, other);
  assert.equal(readdirSync(join(dir, 'out-2')).filter(file => file.startsWith('main-390-dark-')).length, 4);
  assert.match(lines(result)[3], /^main-390-dark: screens 1, 2, 3, /);
  result = shots('--keep', 'all', join(dir, 'out-all'), old, other);
  assert.equal(readdirSync(join(dir, 'out-all')).filter(file => file.startsWith('main-1400-light-')).length, 88);
});

test('--expect look stops each width and scheme at the first strip that differs', () => {
  const [old, other, late] = [page('old'), page('other', { background: '#eef' }), page('late', { extra: 'words', color: 'red' })];
  let result = shots('--expect', 'look', join(dir, 'out-look'), old, other);
  assert.equal(result.status, 1, result.stderr);
  assert.match(lines(result)[0], /^main-1400-light: differs from screen 1 of 45, shots stopped there, 900px each$/);
  assert.match(result.stderr, /main-1400-light: new, strip 1 of 3/);
  assert.doesNotMatch(result.stderr, /main-1400-light: new, strip 2 of 3/);
  assert.equal(readdirSync(join(dir, 'out-look')).filter(file => file.startsWith('main-1400-light-')).length, 16);

  // (the text is in the second strip, screens 20 to 39)
  result = shots('--expect', 'look', join(dir, 'out-late'), old, late);
  assert.match(lines(result)[0], /^main-1400-light: differs from screen 27 of 45, shots stopped there, 900px each$/);
  assert.match(result.stderr, /main-1400-light: new, strip 2 of 3/);
  assert.doesNotMatch(result.stderr, /main-1400-light: new, strip 3 of 3/);

  // builds that look alike are still shot whole
  result = shots('--expect', 'look', join(dir, 'out-alike'), old, page('alike'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /main-1400-light: new, strip 3 of 3/);

  assert.equal(shots('--expect', 'nothing', join(dir, 'out-bad'), old, other).status, 2);
});

test('a run leaves only whole entries, and a build\'s own files decide the key', () => {
  const [old, other, cache] = [page('old'), page('other', { extra: 'words' }), join(dir, 'cache-whole')];
  shots('--cache', cache, join(dir, 'out-x'), old, other);
  const [key] = readdirSync(cache);
  assert.deepEqual(readdirSync(join(cache, key)).filter(file => !file.endsWith('.json')), []);

  // a picture under a build directory is part of the page
  const withPicture = page('picture');
  mkdirSync(join(withPicture, 'build'));
  writeFileSync(join(withPicture, 'build', 'a.txt'), 'one');
  shots('--cache', cache, join(dir, 'out-q'), withPicture, other);
  writeFileSync(join(withPicture, 'build', 'a.txt'), 'two');
  shots('--cache', cache, join(dir, 'out-r'), withPicture, other);
  assert.equal(readdirSync(cache).length, 3);
});

test('cached strips that are wrong are shot again, so --expect look does not call a page identical', () => {
  const [old, late, cache] = [page('old'), page('late', { extra: 'words', color: 'red' }), join(dir, 'cache-stale')];
  shots('--cache', cache, join(dir, 'out-s'), old, page('same'));
  const [key] = readdirSync(cache);
  const entry = join(cache, key, 'main-1400-light.json');
  const right = readFileSync(entry, 'utf8');
  const wrong = JSON.parse(right);
  wrong.hashes[0] = 'not the strip';
  writeFileSync(entry, JSON.stringify(wrong));
  // (the first strip differs from the entry's, and from nothing else)
  const result = shots('--cache', cache, '--expect', 'look', join(dir, 'out-t'), old, late);
  assert.equal(result.status, 1, result.stderr);
  assert.match(lines(result)[0], /^main-1400-light: differs from screen 27 of 45, shots stopped there/);
  assert.equal(readFileSync(entry, 'utf8'), right);
});

test('an old build replaced during the run is not kept under the key of what it was', async () => {
  const [old, cache] = [page('old'), join(dir, 'cache-race')];
  const child = spawn(process.execPath, [join(here, 'shots.mjs'), '--cache', cache, join(dir, 'out-race'), old, page('same')]);
  let told = false;
  child.stderr.on('data', chunk => {
    if (told || !String(chunk).includes('old, strip 1')) return;
    told = true;
    writeFileSync(join(old, 'main.html'), readFileSync(join(old, 'main.html'), 'utf8') + '<!-- accepted -->');
  });
  await new Promise(resolve => child.on('close', resolve));
  assert.ok(told);
  // (the later widths and schemes were shot after the change, and are kept under its key)
  const kept = existsSync(cache) ? readdirSync(cache).flatMap(key => readdirSync(join(cache, key))) : [];
  assert.ok(!kept.includes('main-1400-light.json'), kept.join());
});

test('screens beyond the first are those of a page shot one screen at a time, with fixed and sticky elements', () => {
  const [old, other] = [page('old'), page('other', { background: '#eef' })];
  shots('--keep', 'all', join(dir, 'out-fixed'), old, other);
  shots(join(dir, 'out-single'), join(other, 'main.html'));
  // (the first and last screens of a strip, and the last of the page)
  for (const [label, screens] of [['main-1400-light', [1, 19, 20, 21, 39, 40, 44]], ['main-390-dark', [1, 19, 20, 21, 39, 40, 47]]]) {
    for (const i of screens) {
      const n = String(i).padStart(3, '0');
      const [single, compared] = [`out-single/${label}-${n}.png`, `out-fixed/${label}-${n}-new.png`].map(file => decode(readFileSync(join(dir, file))));
      assert.ok(single.rows.equals(compared.rows), `${label} screen ${i} is not the one shot alone`);
    }
  }
});

test('--then runs on each page before it is shot, and --touch makes it a touch screen', () => {
  const [old, other] = [page('old'), page('other', { background: '#eef' })];
  // (inline style beats both pages' sheets, so the pages are the same once it has run)
  const result = shots('--then', "document.body.style.background = '#ccc'", join(dir, 'out-then'), old, other);
  assert.equal(result.status, 0, result.stderr);

  const touchy = page('touchy', { style: '@media (hover: none) { body { background: #000; } }' });
  assert.equal(shots(join(dir, 'out-mouse'), old, touchy).status, 0);
  const touched = shots('--touch', '--expect', 'look', join(dir, 'out-touch'), old, touchy);
  assert.equal(touched.status, 1, touched.stderr);
  assert.match(lines(touched)[0], /^main-1400-light: differs from screen 1 of 45/);
});
