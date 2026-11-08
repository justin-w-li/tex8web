// Tests of tex8web --version, diff.mjs, png.mjs, and the name checks of
// the test scripts. Run by npm test, or alone:
//   node --test test/tools.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { strayKeys } from './lib/build.mjs';
import { decode, encode } from './lib/png.mjs';

// every command has a deadline, as a hung one would hold up the other tests
const deadline = 60000;
const here = dirname(fileURLToPath(import.meta.url));
const node = (...args) => spawnSync(process.execPath, args, { cwd: join(here, '..'), encoding: 'utf8', timeout: deadline });

test('tex8web --version prints the version, and the commit in a git checkout only', () => {
  const root = join(here, '..');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const run = dir => spawnSync(join(dir, 'bin/tex8web'), ['--version'], { encoding: 'utf8', timeout: deadline });
  const result = run(root);
  assert.equal(result.status, 0);
  if (existsSync(join(root, '.git'))) {
    const commit = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const dirty = spawnSync('git', ['-C', root, 'diff', '--quiet', 'HEAD']).status ? '-dirty' : '';
    assert.equal(result.stdout, `tex8web ${version} (${commit}${dirty})\n`);
  }
  assert.match(result.stdout, /^tex8web \d+\.\d+\.\d+( \([0-9a-f]{7,}(-dirty)?\))?\n$/);
  // a copy of tex8web inside another repository, whose commit is not tex8web's
  const repo = mkdtempSync(join(tmpdir(), 'tex8webrepo')), copy = join(repo, 'tex8web');
  try {
    const git = (...args) => assert.equal(spawnSync('git', ['-C', repo, ...args], { timeout: deadline }).status, 0);
    git('init', '-q');
    git('-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'test');
    mkdirSync(join(copy, 'bin'), { recursive: true });
    copyFileSync(join(root, 'bin/tex8web'), join(copy, 'bin/tex8web'));
    copyFileSync(join(root, 'package.json'), join(copy, 'package.json'));
    assert.equal(run(copy).stdout, `tex8web ${version}\n`);
  } finally {
    rmSync(repo, { recursive: true });
  }
});

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

  // rows 1 to 3 come back as a separate picture
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
