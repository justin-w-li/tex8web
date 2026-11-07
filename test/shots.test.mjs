// Tests of shots.mjs's comparison, which need Chrome, run by npm run
// test:visual: node --test test/shots.test.mjs
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decode } from './lib/png.mjs';
import './lib/stubs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// (in the temporary directory lib/stubs.mjs makes, and removes)
const dir = mkdtempSync(join(tmpdir(), 'tex8webshots'));

// A page with a bar fixed to the top, a footer fixed to the bottom, a sticky
// header, a block as high as the window, and a line of text. Short, it is
// 9 screens high at 900px, 3 strips of 3, with the text at 4400px. Long,
// it is 45 screens high, more than a strip of the tool's own, with the text
// at 25000px. Each test writes its pages in a directory of its own (pages()),
// as the tests run at once
const pages = () => {
  const root = mkdtempSync(join(dir, 'pages'));
  return (name, { extra = '', more = 0, color = 'black', background = 'white', style = '', long = false } = {}) => {
    const [gap, end] = long ? [24100, 14976] : [3500, 2876];
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, 'main.html'), `<!DOCTYPE html><meta charset="utf-8"><style>
      body { margin: 0; font: 20px sans-serif; background: ${background}; } .bar { position: fixed; top: 0; left: 0; right: 0; background: #ccc; }
      .foot { position: fixed; bottom: 0; left: 0; right: 0; background: #cfc; } .head { position: sticky; top: 30px; height: 0; } .head span { background: #fc9; }
      .tall { height: 100vh; background: linear-gradient(#fff, #9cf); } .gap { height: ${gap + more}px; }
      .end { height: ${end}px; } ${style} p { height: 24px; margin: 0; color: ${color}; }</style>
      <div class="bar">bar</div><div class="foot">footer</div><div class="head"><span>header</span></div><div class="tall">window</div><div class="gap"></div><p>${extra}</p><div class="end"></div>`);
    return join(root, name);
  };
};
const run = (env, args) => new Promise(resolve => execFile(process.execPath, [join(here, 'shots.mjs'), ...args],
  { env: { ...process.env, ...env }, timeout: 300000, maxBuffer: 2 ** 26 },
  (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr })));
// shots.mjs at only the views given (as 1400-light,390-dark), with strips
// of 3 screens for the short pages
const shots = (views, ...args) => run({ TEX8WEB_SHOTS_VIEWS: views, TEX8WEB_SHOTS_STRIP: '3' }, args);
// with the tool's own strips, for the long pages
const realShots = (views, ...args) => run({ TEX8WEB_SHOTS_VIEWS: views }, args);
const all = '1400-light,1400-dark,390-light,390-dark';
const lines = result => result.stdout.trim().split('\n');

describe('shots.mjs', { concurrency: true }, () => {
  test('a comparison says which screens differ, and writes them', async () => {
    const page = pages();
    const [old, same, changed] = [page('old'), page('same'), page('changed', { extra: 'new words', color: 'red' })];
    let result = await shots(all, join(dir, 'out-same'), old, same);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(lines(result).map(line => line.replace(/^main-/, '')), ['1400-light: identical', '1400-dark: identical', '390-light: identical', '390-dark: identical']);
    assert.deepEqual(readdirSync(join(dir, 'out-same')), []);

    result = await shots('1400-light,390-dark', join(dir, 'out-changed'), old, changed);
    assert.equal(result.status, 1, result.stderr);
    // (the text is at 4400px, in screen 4 of 9 at 900px, 5 of 9 at 844px)
    assert.match(lines(result)[0], /^main-1400-light: screens 4 of 9 differ, 900px each$/);
    assert.match(lines(result)[1], /^main-390-dark: screens 5 of 9 differ, 844px each$/);
    const written = readdirSync(join(dir, 'out-changed')).sort();
    assert.deepEqual(written.filter(file => file.startsWith('main-1400-light')), ['main-1400-light-004-new.png', 'main-1400-light-004-old.png']);

    // the screens written are the page's, as one-by-one shots (a single build) have them
    await shots('1400-light', join(dir, 'out-one'), join(changed, 'main.html'));
    const one = decode(readFileSync(join(dir, 'out-one/main-1400-light-004.png')));
    const compared = decode(readFileSync(join(dir, 'out-changed/main-1400-light-004-new.png')));
    assert.deepEqual([compared.width, compared.height], [one.width, one.height]);
    assert.ok(compared.rows.equals(one.rows), 'the screen is not the one shot alone');
  });

  test('a build with more screens says how many it had before', async () => {
    const page = pages();
    const result = await shots('1400-light', join(dir, 'out-taller'), page('old'), page('taller', { more: 2000 }));
    assert.equal(result.status, 1, result.stderr);
    assert.match(lines(result)[0], /^main-1400-light: screens 8, 9, 10 of 11 differ \(9 before\), 900px each$/);
  });

  test('the old build\'s screens are kept, for that build only', async () => {
    const page = pages();
    const [old, changed, cache] = [page('old'), page('changed', { extra: 'words' }), join(dir, 'cache')];
    const first = await shots('1400-light', '--cache', cache, join(dir, 'out-a'), old, changed);
    assert.match(first.stderr, /main-1400-light: old, strip 1 of 3/);
    const again = await shots('1400-light', '--cache', cache, join(dir, 'out-b'), old, changed);
    assert.doesNotMatch(again.stderr, /: old, strip/);
    assert.equal(again.stdout, first.stdout);
    assert.deepEqual(readdirSync(join(dir, 'out-b')).sort(), readdirSync(join(dir, 'out-a')).sort());

    // another old build is shot again
    const other = await shots('1400-light', '--cache', cache, join(dir, 'out-c'), changed, old);
    assert.match(other.stderr, /main-1400-light: old, strip 1 of 3/);
    assert.equal(other.status, 1);
  });

  test('only the first few differing screens are written, and the output lists them all', async () => {
    const page = pages();
    // (11 screens, so that more than 8 differ)
    const [old, other] = [page('old', { more: 2000 }), page('other', { more: 2000, background: '#eef' })];
    // (all but the first, which a block as high as the window covers)
    const everything = Array.from({ length: 10 }, (_, i) => i + 1).join(', ');
    let result = await shots('1400-light', join(dir, 'out-8'), old, other);
    assert.equal(result.status, 1, result.stderr);
    assert.match(lines(result)[0], new RegExp(`^main-1400-light: screens ${everything} of 11 differ, 900px each$`));
    const written = prefix => readdirSync(join(dir, 'out-8')).filter(file => file.startsWith(prefix));
    assert.deepEqual(written('main-1400-light-').map(file => file.slice(16, 19)).filter((n, i, all) => all.indexOf(n) === i),
      ['001', '002', '003', '004', '005', '006', '007', '008']);

    result = await shots('390-dark', '--keep', '2', join(dir, 'out-2'), old, other);
    assert.equal(readdirSync(join(dir, 'out-2')).filter(file => file.startsWith('main-390-dark-')).length, 4);
    assert.match(lines(result)[0], /^main-390-dark: screens 1, 2, 3, /);
    result = await shots('1400-light', '--keep', 'all', join(dir, 'out-all'), old, other);
    assert.equal(readdirSync(join(dir, 'out-all')).filter(file => file.startsWith('main-1400-light-')).length, 20);
  });

  test('--expect look stops each width and scheme at the first strip that differs', async () => {
    const page = pages();
    const [old, other, late] = [page('old'), page('other', { background: '#eef' }), page('late', { extra: 'words', color: 'red' })];
    let result = await shots('1400-light', '--expect', 'look', join(dir, 'out-look'), old, other);
    assert.equal(result.status, 1, result.stderr);
    assert.match(lines(result)[0], /^main-1400-light: differs from screen 1 of 9, shots stopped there, 900px each$/);
    assert.match(result.stderr, /main-1400-light: new, strip 1 of 3/);
    assert.doesNotMatch(result.stderr, /main-1400-light: new, strip 2 of 3/);
    // (screens 1 and 2 of the first strip, old and new)
    assert.equal(readdirSync(join(dir, 'out-look')).filter(file => file.startsWith('main-1400-light-')).length, 4);

    // (the text is in the second strip, screens 3 to 5)
    result = await shots('1400-light', '--expect', 'look', join(dir, 'out-late'), old, late);
    assert.match(lines(result)[0], /^main-1400-light: differs from screen 4 of 9, shots stopped there, 900px each$/);
    assert.match(result.stderr, /main-1400-light: new, strip 2 of 3/);
    assert.doesNotMatch(result.stderr, /main-1400-light: new, strip 3 of 3/);

    // builds that look alike are still shot whole
    result = await shots('1400-light', '--expect', 'look', join(dir, 'out-alike'), old, page('alike'));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /main-1400-light: new, strip 3 of 3/);

    assert.equal((await shots('1400-light', '--expect', 'nothing', join(dir, 'out-bad'), old, other)).status, 2);
  });

  test('a run leaves only whole entries, and a build\'s own files decide the key', async () => {
    const page = pages();
    const [old, other, cache] = [page('old'), page('other', { extra: 'words' }), join(dir, 'cache-whole')];
    await shots('1400-light', '--cache', cache, join(dir, 'out-x'), old, other);
    const [key] = readdirSync(cache);
    assert.deepEqual(readdirSync(join(cache, key)).filter(file => !file.endsWith('.json')), []);

    // a picture under a build directory is part of the page
    const withPicture = page('picture');
    mkdirSync(join(withPicture, 'build'));
    writeFileSync(join(withPicture, 'build', 'a.txt'), 'one');
    await shots('1400-light', '--cache', cache, join(dir, 'out-q'), withPicture, other);
    writeFileSync(join(withPicture, 'build', 'a.txt'), 'two');
    await shots('1400-light', '--cache', cache, join(dir, 'out-r'), withPicture, other);
    assert.equal(readdirSync(cache).length, 3);
  });

  test('cached strips that are wrong are shot again, so --expect look does not call a page identical', async () => {
    const page = pages();
    const [old, late, cache] = [page('old'), page('late', { extra: 'words', color: 'red' }), join(dir, 'cache-stale')];
    await shots('1400-light', '--cache', cache, join(dir, 'out-s'), old, page('same'));
    const [key] = readdirSync(cache);
    const entry = join(cache, key, 'main-1400-light.json');
    const right = readFileSync(entry, 'utf8');
    const wrong = JSON.parse(right);
    wrong.hashes[0] = 'not the strip';
    writeFileSync(entry, JSON.stringify(wrong));
    // (the first strip differs from the entry's, and from nothing else)
    const result = await shots('1400-light', '--cache', cache, '--expect', 'look', join(dir, 'out-t'), old, late);
    assert.equal(result.status, 1, result.stderr);
    assert.match(lines(result)[0], /^main-1400-light: differs from screen 4 of 9, shots stopped there/);
    assert.equal(readFileSync(entry, 'utf8'), right);
  });

  test('an old build replaced during the run is not kept under the key of what it was', async () => {
    // (long, so that the old build is changed while its first strips are shot)
    const page = pages();
    const [old, cache] = [page('old', { long: true }), join(dir, 'cache-race')];
    const child = spawn(process.execPath, [join(here, 'shots.mjs'), '--cache', cache, join(dir, 'out-race'), old, page('same', { long: true })],
      { env: { ...process.env, TEX8WEB_SHOTS_VIEWS: '1400-light' } });
    let told = false;
    child.stderr.on('data', chunk => {
      if (told || !String(chunk).includes('old, strip 1')) return;
      told = true;
      writeFileSync(join(old, 'main.html'), readFileSync(join(old, 'main.html'), 'utf8') + '<!-- accepted -->');
    });
    await new Promise(resolve => child.on('close', resolve));
    assert.ok(told);
    const kept = existsSync(cache) ? readdirSync(cache).flatMap(key => readdirSync(join(cache, key))) : [];
    assert.ok(!kept.includes('main-1400-light.json'), kept.join());
  });

  test('screens beyond the first are those of a page shot one screen at a time, with fixed and sticky elements', async () => {
    // (with the tool's own strips, as a capture that tall is what it makes)
    const page = pages();
    const [old, other] = [page('old', { long: true }), page('other', { long: true, background: '#eef' })];
    await Promise.all([realShots('1400-light,390-dark', '--keep', 'all', join(dir, 'out-fixed'), old, other),
      realShots('1400-light,390-dark', join(dir, 'out-single'), join(other, 'main.html'))]);
    // (the first and last screens of a strip, and the last of the page)
    for (const [label, screens] of [['main-1400-light', [1, 19, 20, 21, 39, 40, 44]], ['main-390-dark', [1, 19, 20, 21, 39, 40, 47]]]) {
      for (const i of screens) {
        const n = String(i).padStart(3, '0');
        const [single, compared] = [`out-single/${label}-${n}.png`, `out-fixed/${label}-${n}-new.png`].map(file => decode(readFileSync(join(dir, file))));
        assert.ok(single.rows.equals(compared.rows), `${label} screen ${i} is not the one shot alone`);
      }
    }
  });

  test('--then runs on each page before it is shot, and --touch makes it a touch screen', async () => {
    const page = pages();
    const [old, other] = [page('old'), page('other', { background: '#eef' })];
    // (inline style beats both pages' sheets, so the pages are the same once it has run)
    const result = await shots('1400-light', '--then', "document.body.style.background = '#ccc'", join(dir, 'out-then'), old, other);
    assert.equal(result.status, 0, result.stderr);

    const touchy = page('touchy', { style: '@media (hover: none) { body { background: #000; } }' });
    assert.equal((await shots('1400-light', join(dir, 'out-mouse'), old, touchy)).status, 0);
    const touched = await shots('1400-light', '--touch', '--expect', 'look', join(dir, 'out-touch'), old, touchy);
    assert.equal(touched.status, 1, touched.stderr);
    assert.match(lines(touched)[0], /^main-1400-light: differs from screen 1 of 9/);
  });
});
