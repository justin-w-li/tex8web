// Tests of regress.mjs, run by npm test:
// node --test test/regress.test.mjs
// make4ht is a stand-in (test/lib/stubs.mjs). Chrome is real, for the screens.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { root } from './lib/build.mjs';
import { until } from './lib/chrome.mjs';
import { stubbed } from './lib/stubs.mjs';

// every command has a deadline, as a hung one would hold up the other tests
const deadline = 60000;
const here = dirname(fileURLToPath(import.meta.url));
const lockf = existsSync('/usr/bin/lockf');

// regress.mjs, run from a temporary directory as npm does (in tex8web's, told where from), with a tex8web checkout of its own
// to record: a clean git repository, or one with a file git doesn't know
const git = (dir, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', dir, ...args], { encoding: 'utf8', timeout: deadline });
const regress = (cwd, tree, ...args) => new Promise(done => {
  const child = spawn(process.execPath, [join(here, 'regress.mjs'), ...args], { cwd: root, timeout: 120000,
    env: { ...process.env, ...stubbed, npm_lifecycle_event: 'regress', INIT_CWD: cwd, TEX8WEB_TREE: tree } });
  const result = { stdout: '', stderr: '' };
  child.stdout.on('data', data => { result.stdout += data; });
  child.stderr.on('data', data => { result.stderr += data; });
  child.on('close', status => done({ ...result, status }));
});
const article = body => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
function scratch(names) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webregress')));
  for (const [path, body] of Object.entries(names)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  const clean = join(dir, 'clean'), dirty = join(dir, 'dirty');
  for (const repo of [clean, dirty]) {
    mkdirSync(repo);
    git(repo, 'init');
    git(repo, 'commit', '--allow-empty', '-m', 'x');
  }
  writeFileSync(join(dirty, 'file'), 'not committed');
  return { dir, clean, dirty, head: git(clean, 'rev-parse', '--short', 'HEAD').stdout.trim() };
}

// (the screens' Chrome is the slow part, so these run at once)
describe('regress.mjs', { concurrency: true }, () => {
  test('regress.mjs says what changed in each document since its accepted build', { skip: !lockf }, async () => {
    const { dir, clean, head } = scratch({ 'one/main.tex': article('First'), 'two/note.tex': article('Second') });
    const out = join(dir, 'build/regress');
    try {
      let result = await regress(dir, clean, 'one', 'two');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /^one: no baseline/m);
      assert.match(result.stdout, /^two: no baseline/m);

      result = await regress(dir, clean, '--accept', 'one', 'two/note.tex');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.ok(existsSync(join(out, 'accepted/one/main.html')));
      assert.match(readFileSync(join(out, 'accepted/STAMP'), 'utf8'), new RegExp(`^${head} \\d{4}-\\d\\d-\\d\\d`));

      result = await regress(dir, clean, 'one', 'two');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /^one: unchanged/m);
      assert.match(result.stdout, /^two: unchanged/m);

      writeFileSync(join(dir, 'two/note.tex'), article('Second, and more words than before'));
      result = await regress(dir, clean, 'one', 'two');
      assert.equal(result.status, 3, result.stderr + result.stdout);
      assert.match(result.stdout, /^one: unchanged/m);
      assert.match(result.stdout, /^two: looks different: .*-light/m);
      // (shots.mjs's progress isn't part of the outcome)
      assert.doesNotMatch(result.stdout, /^two: .*(loading|screen \d+ of)/m);
      assert.ok(readdirSync(join(out, 'compare/two')).some(file => file.endsWith('-new.png')));

      // a change that is meant to show is compared as far as its first differing strip
      result = await regress(dir, clean, '--expect', 'look', '--shots-cache', join(dir, 'store'), 'two');
      assert.equal(result.status, 3, result.stderr + result.stdout);
      assert.match(result.stdout, /^two: looks different: note-1400-light \(from screen \d+\)/m);
      assert.ok(readdirSync(join(dir, 'store')).length > 0, 'no cache');

      // another baseline, another output directory, and a config
      copyFileSync(join(root, 'tex8web.cfg'), join(dir, 'my.cfg'));
      result = await regress(dir, clean, '--out', 'elsewhere', '--baseline', join(out, 'accepted'), '-c', 'my.cfg', 'one');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /^one: unchanged/m);
      assert.ok(existsSync(join(dir, 'elsewhere/html/one/main.html')));

      result = await regress(dir, clean, '--draft', '--out', 'drafts', 'one');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.ok(existsSync(join(dir, 'drafts/html/one/main.html')));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('regress.mjs accepts only a run in which every document built', { skip: !lockf }, async () => {
    const { dir, clean } = scratch({ 'two/note.tex': article('Second'), 'three/main.tex': article('Third'), 'bad/main.tex': article('\\undefinedcs') });
    const out = join(dir, 'build/regress');
    const stamp = () => readFileSync(join(out, 'accepted/STAMP'), 'utf8');
    try {
      let result = await regress(dir, clean, '--accept', 'two');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const before = stamp();

      // a document that doesn't build fails the run and keeps the rest from being accepted
      result = await regress(dir, clean, '--accept', 'three', 'bad');
      assert.equal(result.status, 1, result.stderr + result.stdout);
      assert.match(result.stdout, /^bad: failed to build/m);
      assert.equal(stamp(), before);
      assert.equal(existsSync(join(out, 'accepted/three')), false);

      // a looking-different page is accepted without failing, and is then the baseline
      writeFileSync(join(dir, 'two/note.tex'), article('Second, and more words than before'));
      result = await regress(dir, clean, '--accept', 'two');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(readFileSync(join(out, 'accepted/two/note.html'), 'utf8'), /more words/);
      result = await regress(dir, clean, 'two');
      assert.match(result.stdout, /^two: unchanged/m);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('regress.mjs --latexmk builds each PDF before its page, and a failed PDF fails the document', async () => {
    const { dir, clean } = scratch({ 'one/main.tex': article('First'), 'one/.latexmkrc': '$pdf_mode = 1;', 'bad/main.tex': article('\\undefinedcs') });
    try {
      const result = await regress(dir, clean, '--latexmk', 'one', 'bad');
      assert.equal(result.status, 1, result.stderr + result.stdout);
      assert.ok(existsSync(join(dir, 'one/main.pdf')), 'no PDF');
      assert.ok(existsSync(join(dir, 'one/build/pdf.lock')), 'no lock');
      assert.ok(existsSync(join(dir, 'build/regress/html/one/main.html')));
      assert.match(result.stdout, /^one: no baseline/m);
      assert.match(result.stdout, /^bad: failed to build its PDF, exit \d+ \(log: .*bad\.pdf\.log\)/m);
      assert.equal(existsSync(join(dir, 'build/regress/html/bad')), false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('regress.mjs builds a page whose PDF is missing, and builds no PDF', async () => {
    const { dir, clean } = scratch({ 'one/main.tex': article('First'),
      'my.cfg': '\\Preamble{xhtml,mathjax}\n\\begin{document}\n\\input{tex8web-core.tex}\n\\WebPDF{build/pdf/main.pdf}\n\\EndPreamble\n' });
    try {
      const result = await regress(dir, clean, '-c', 'my.cfg', 'one');
      assert.ok(existsSync(join(dir, 'build/regress/html/one/main.html')), result.stderr + result.stdout);
      assert.equal(existsSync(join(dir, 'one/build')), false, 'something built the PDF');
      assert.match(result.stdout, /^one: /m);

      // once the PDF is there, the page is built again
      mkdirSync(join(dir, 'one/build/pdf'), { recursive: true });
      writeFileSync(join(dir, 'one/build/pdf/main.pdf'), '%PDF-1.4\n');
      const again = await regress(dir, clean, '-c', 'my.cfg', 'one');
      assert.doesNotMatch(again.stdout, /reusing/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("regress.mjs holds its output directory's lock while it runs, and clean leaves it", { skip: !lockf }, async () => {
    const { dir, clean } = scratch({ 'one/main.tex': article('First') });
    const out = join(dir, 'build/regress');
    const busy = () => spawnSync('lockf', ['-k', '-s', '-t', '0', join(out, 'regress.lock'), 'true'], { timeout: deadline }).status === 75;
    // (the build waits until the lock has been looked at)
    const hold = join(dir, 'hold');
    writeFileSync(hold, '');
    const proc = spawn(process.execPath, [join(here, 'regress.mjs'), 'one'], { cwd: root, stdio: 'ignore', timeout: 120000,
      env: { ...process.env, ...stubbed, STUB_HOLD: hold, npm_lifecycle_event: 'regress', INIT_CWD: dir, TEX8WEB_TREE: clean } });
    const ended = new Promise(done => proc.on('close', done));
    try {
      assert.ok(await until(() => existsSync(join(out, 'regress.lock')) && busy(), Boolean, 20000), 'the lock was not taken');
      const result = spawnSync(process.execPath, [join(here, 'clean.mjs'), '--in', dir, 'regress'],
        { cwd: root, encoding: 'utf8', timeout: deadline, env: { ...process.env, TMPDIR: dir } });
      assert.match(result.stdout, /skipping .*build\/regress: .*in use/);
      assert.ok(existsSync(join(out, 'regress.lock')));
      rmSync(hold);
      assert.equal(await ended, 0);
      assert.equal(busy(), false, 'the lock is held after it ended');
    } finally {
      proc.kill();
      rmSync(dir, { recursive: true });
    }
  });

  test('regress.mjs refuses what it cannot do before it builds anything', async () => {
    const { dir, clean, dirty } = scratch({ 'one/main.tex': article('First'), 'a/dup/main.tex': article('A'), 'b/dup/main.tex': article('B'),
      'empty/readme.txt': 'no TeX', 'two/a.tex': article('A'), 'two/b.tex': article('B') });
    try {
      const refused = async (pattern, tree, ...args) => {
        const result = await regress(dir, tree, ...args);
        assert.equal(result.status, 2, `${args.join(' ')}: ${result.stdout}${result.stderr}`);
        assert.match(result.stderr, pattern);
        assert.equal(existsSync(join(dir, 'build')), false, `${args.join(' ')} built something`);
      };
      await refused(/usage/, clean);
      await refused(/usage/, clean, '--no-such-option', 'one');
      await refused(/usage/, clean, '--out');
      await refused(/--draft/, clean, '--draft', '--accept', 'one');
      await refused(/no such/, clean, 'missing');
      await refused(/main\.tex/, clean, 'empty');
      await refused(/main\.tex/, clean, 'two');
      await refused(/same name.*dup/, clean, 'a/dup', 'b/dup');
      await refused(/make4ht/, clean, '--out', 'my-out', 'one');
      await refused(/make4ht/, clean, '--out', 'my%out', 'one');
      await refused(/make4ht/, clean, '--out', 'my(out)', 'one');
      // (by default the pages go in the directory it is run from, which npm makes tex8web's)
      const inside = spawnSync(process.execPath, [join(here, 'regress.mjs'), join(dir, 'one')],
        { cwd: root, encoding: 'utf8', timeout: deadline, env: { ...process.env, npm_lifecycle_event: undefined, TEX8WEB_TREE: clean } });
      assert.equal(inside.status, 2);
      assert.match(inside.stderr, /inside tex8web.*--prefix/s);
      // (and a plain node takes paths from its own directory, not from INIT_CWD)
      const plain = spawnSync(process.execPath, [join(here, 'regress.mjs'), 'two'],
        { cwd: dir, encoding: 'utf8', timeout: deadline, env: { ...process.env, npm_lifecycle_event: undefined, INIT_CWD: root } });
      assert.equal(plain.status, 2);
      assert.match(plain.stderr, /main\.tex/);
      await refused(/uncommitted/, dirty, '--accept', 'one');
      await refused(/not a git/, dir, '--accept', 'one');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
