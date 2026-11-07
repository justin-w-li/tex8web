// Tests of diff.mjs, clean.mjs and the name checks of the test scripts, run
// by npm test:
// node --test test/tools.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { root, strayKeys } from './lib/build.mjs';
import { decode, encode } from './lib/png.mjs';

// every command has a deadline, as a hung one would hold up the other tests
const deadline = 60000;
const here = dirname(fileURLToPath(import.meta.url));
const lockf = existsSync('/usr/bin/lockf');
const node = (...args) => spawnSync(process.execPath, args, { cwd: join(here, '..'), encoding: 'utf8', timeout: deadline });

test('diff.mjs compares the fonts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tex8webdiff'));
  try {
    for (const [name, bytes] of [['old', 'a'], ['new', 'b']]) {
      mkdirSync(join(dir, name, 'fonts'), { recursive: true });
      writeFileSync(join(dir, name, 'fonts/cut.woff2'), bytes);
    }
    const result = node('test/diff.mjs', join(dir, 'old'), join(dir, 'new'));
    assert.equal(result.status, 1);
    assert.match(result.stdout, /changed fonts\/cut\.woff2/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('png.mjs reads every filter a PNG row can have, and writes rows of a picture', () => {
  const [width, height, channels] = [7, 5, 3], stride = width * channels;
  const rows = Buffer.from(Array.from({ length: height * stride }, (_, i) => (i * 37 + (i >> 3) * 11) & 255));
  // each row filtered as its number says (0 to 4; the first row has no row above)
  const filtered = Buffer.concat(Array.from({ length: height }, (_, y) => {
    const out = Buffer.alloc(stride + 1);
    out[0] = y;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rows[y * stride + x - channels] : 0, up = y ? rows[(y - 1) * stride + x] : 0;
      const upLeft = y && x >= channels ? rows[(y - 1) * stride + x - channels] : 0;
      const p = left + up - upLeft, [a, b, c] = [left, up, upLeft].map(v => Math.abs(p - v));
      const predicted = [0, left, up, (left + up) >> 1, a <= b && a <= c ? left : b <= c ? up : upLeft][y];
      out[x + 1] = (rows[y * stride + x] - predicted) & 255;
    }
    return out;
  }));
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(filtered)), chunk('IEND', Buffer.alloc(0))]);
  const picture = decode(png);
  assert.deepEqual([picture.width, picture.height, picture.channels], [width, height, channels]);
  assert.ok(picture.rows.equals(rows));

  // rows 1 to 3 come back as a picture of their own
  const part = decode(encode(picture, 1, 4));
  assert.equal(part.height, 3);
  assert.ok(part.rows.equals(rows.subarray(stride, 4 * stride)));
  assert.throws(() => decode(Buffer.from('not a png at all')), /not a PNG/);
});

for (const script of ['run', 'visual', 'page']) {
  test(`${script}.mjs fails on a name that matches nothing`, () => {
    const result = node(`test/${script}.mjs`, 'no-such-name');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no (document|check) named no-such-name/);
    assert.doesNotMatch(result.stdout, /all passed/);
  });
}

test('a table keyed by a document that does not exist is found', () => {
  assert.deepEqual(strayKeys({ test: 1, 'test-generic (MathJax in the browser)': 1 }, { 'no-such-document': 1 }), ['no-such-document']);
});

// clean.mjs in a temporary directory, as npm runs it, with $TMPDIR in tmp
function cleaner() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webclean')));
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp);
  const file = path => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), 'x'); };
  const clean = (...args) => spawnSync(process.execPath, [join(here, 'clean.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: deadline,
    env: { ...process.env, npm_lifecycle_event: 'clean', INIT_CWD: dir, TMPDIR: tmp } });
  // (what is under dir except tmp, links listed and not followed)
  const walk = (base, rel) => readdirSync(base, { withFileTypes: true })
    .flatMap(entry => [join(rel, entry.name), ...entry.isDirectory() ? walk(join(base, entry.name), join(rel, entry.name)) : []]);
  const left = () => walk(dir, '').filter(path => !path.startsWith('tmp')).sort();
  return { dir, tmp, file, clean, left };
}

test('clean.mjs removes one key\'s builds and dead Chrome profiles, and nothing else', async () => {
  const { dir, tmp, file, clean, left } = cleaner();
  for (const path of ['each/a/main.tex', 'each/a/build/k/html/a.html', 'each/a/build/pdf/main.pdf', 'each/a/build/main/html/a.html',
    'each/a/build/k/html/a.lock', 'each/b/b.tex', 'each/b/build/k/tex4ht/b.log', 'each/c/main.tex', 'each/plain/build/k/x',
    'each/cm/main.tex', 'each/cm/build/k/CMakeCache.txt', 'fake/tex8web.mk4', 'fake/build/k/html/a.html',
    'each/ln/main.tex', 'target2/k/html/x.html', 'outside/f.lock', 'outside/x',
    'each/tex8web-x/tex8web.mk4', 'each/tex8web-x/test.tex', 'each/tex8web-x/build/k/page.html',
    'each/link/main.tex', 'target/keep', 'here/build/k/accepted/a/a.html', 'here/build/k/html/a/a.html',
    'here/build/main/html/a.html', 'build/k/html/d.html',
    'tmp/tex8webchromeDead01/Default', 'tmp/tex8webchromeDead01.log', 'tmp/tex8webchromeLive01/Default',
    'tmp/tex8webchromeNew001/Default', 'tmp/tex8webchromepagesAbCdEf/file', 'tmp/other/file']) file(path);
  mkdirSync(join(dir, 'each/link/build'));
  symlinkSync(join(dir, 'target'), join(dir, 'each/link/build/k'));
  // (a link to where the build's files are, and a link in a build to where something else's are)
  symlinkSync(join(dir, 'target2'), join(dir, 'each/ln/build'));
  symlinkSync(join(dir, 'outside'), join(dir, 'each/b/build/k/tex4ht/out'));
  const old = new Date(Date.now() - 3600000);
  for (const name of ['tex8webchromeDead01', 'tex8webchromeDead01.log', 'tex8webchromeLive01', 'tex8webchromepagesAbCdEf']) utimesSync(join(tmp, name), old, old);
  const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', `--user-data-dir=${join(tmp, 'tex8webchromeLive01')}`], { stdio: 'ignore', timeout: deadline });
  try {
    const before = left();
    let result = clean('--dry-run', '--each', 'each', '--in', 'here', 'k');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would remove .*each\/a\/build\/k\n/);
    assert.match(result.stdout, /would remove .*tex8webchromeDead01\n/);
    assert.deepEqual(left(), before);

    // (--each alone keeps the current directory, and --in then drops it)
    result = clean('--each', 'each', 'k');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^removed .*each\/b\/build\/k$/m);
    assert.match(result.stdout, new RegExp(`^removed ${dir}/build/k$`, 'm'));
    // (a document's build directory that is a link is not followed; what a build holds that regress doesn't make
    // means it isn't one of its builds; a tex8web checkout has builds of its own)
    assert.match(result.stdout, /skipping .*each\/ln\/build: a link/);
    assert.match(result.stdout, /skipping .*each\/cm\/build\/k: .*CMakeCache\.txt/);
    result = clean('--in', 'here', '--in', 'fake', 'k');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skipping .*fake\/build\/k: .*tex8web checkout/);
    // (what stays: a build's accepted pages, the other keys' builds, the PDFs, what is not a document, a tex8web checkout,
    // a link's target and the live profiles and the other tests' directories)
    assert.deepEqual(left(), [
      'build', 'each', 'each/a', 'each/a/build', 'each/a/build/main', 'each/a/build/main/html', 'each/a/build/main/html/a.html',
      'each/a/build/pdf', 'each/a/build/pdf/main.pdf', 'each/a/main.tex', 'each/b', 'each/b/b.tex', 'each/b/build',
      'each/c', 'each/c/main.tex', 'each/link', 'each/link/build', 'each/link/main.tex',
      'each/plain', 'each/plain/build', 'each/plain/build/k', 'each/plain/build/k/x',
      'each/cm', 'each/cm/build', 'each/cm/build/k', 'each/cm/build/k/CMakeCache.txt', 'each/cm/main.tex',
      'each/ln', 'each/ln/build', 'each/ln/main.tex', 'fake', 'fake/build', 'fake/build/k', 'fake/build/k/html',
      'fake/build/k/html/a.html', 'fake/tex8web.mk4', 'outside', 'outside/f.lock', 'outside/x',
      'target2', 'target2/k', 'target2/k/html', 'target2/k/html/x.html',
      'each/tex8web-x', 'each/tex8web-x/build', 'each/tex8web-x/build/k', 'each/tex8web-x/build/k/page.html',
      'each/tex8web-x/test.tex', 'each/tex8web-x/tex8web.mk4',
      'here', 'here/build', 'here/build/k', 'here/build/k/accepted', 'here/build/k/accepted/a', 'here/build/k/accepted/a/a.html',
      'here/build/main', 'here/build/main/html', 'here/build/main/html/a.html', 'target', 'target/keep'].sort());
    assert.deepEqual(readdirSync(tmp).sort(), ['other', 'tex8webchromeLive01', 'tex8webchromeNew001', 'tex8webchromepagesAbCdEf']);

    for (const key of ['main', 'accepted', 'pdf', '../k', '', 'a/b']) {
      result = clean('--each', 'each', key);
      assert.equal(result.status, 2, `key "${key}"`);
    }
    assert.equal(clean().status, 2);
  } finally {
    live.kill();
    rmSync(dir, { recursive: true });
  }
});

test('clean.mjs leaves a build whose lock is held', { skip: !lockf, timeout: 30000 }, async () => {
  const { dir, file, clean, left } = cleaner();
  file('busy/build/k/html/a.lock');
  file('busy/build/k/html/a.html');
  file('free/build/k/html/a.html');
  const holder = spawn('lockf', ['-k', join(dir, 'busy/build/k/html/a.lock'), 'sh', '-c', 'echo held; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'ignore'], timeout: deadline });
  try {
    await new Promise(done => holder.stdout.once('data', done));
    const result = clean('--in', 'busy', '--in', 'free', 'k');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skipping .*busy\/build\/k: .*locked/);
    assert.deepEqual(left().filter(path => path.includes('busy') || path.includes('free')),
      ['busy', 'busy/build', 'busy/build/k', 'busy/build/k/html', 'busy/build/k/html/a.html', 'busy/build/k/html/a.lock', 'free', 'free/build']);
    holder.stdin.end();
    await new Promise(done => holder.on('close', done));
    assert.match(clean('--in', 'busy', 'k').stdout, /removed .*busy\/build\/k/);
  } finally {
    holder.kill();
    rmSync(dir, { recursive: true });
  }
});
