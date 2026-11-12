// Tests of regress.mjs and compare.mjs. Run by npm test, or alone:
//   node --test test/regress.test.mjs
// make4ht and docker are stand-ins (test/lib/stubs.mjs). Chrome is real,
// for the screens.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { root } from './lib/build.mjs';
import { lock } from './lib/slots.mjs';
import { dockerLog, stubbed } from './lib/stubs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const lockf = existsSync('/usr/bin/lockf');

// runs regress.mjs as npm does: in tex8web's directory, with INIT_CWD set to cwd
const regress = (cwd, ...args) => new Promise(done => {
  const child = spawn(process.execPath, [join(here, 'regress.mjs'), ...args], { cwd: root, timeout: 120000,
    env: { ...process.env, ...stubbed, npm_lifecycle_event: 'regress', INIT_CWD: cwd } });
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
  return dir;
}

// Chrome for the screens is slow, so these tests run concurrently
describe('regress.mjs', { concurrency: true }, () => {
  test('regress.mjs says what changed in each document since its accepted build', { skip: !lockf }, async () => {
    const dir = scratch({ 'one/main.tex': article('First'), 'two/note.tex': article('Second') });
    const out = join(dir, 'build/regress');
    try {
      let result = await regress(dir, 'one', 'two');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /^one: no baseline/m);
      assert.match(result.stdout, /^two: no baseline/m);

      result = await regress(dir, '--accept', 'one', 'two/note.tex');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.ok(existsSync(join(out, 'accepted/one/main.html')));

      result = await regress(dir, 'one', 'two');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /^one: unchanged/m);
      assert.match(result.stdout, /^two: unchanged/m);

      writeFileSync(join(dir, 'two/note.tex'), article('Second, and more words than before'));
      result = await regress(dir, 'one', 'two');
      assert.equal(result.status, 3, result.stderr + result.stdout);
      assert.match(result.stdout, /^one: unchanged/m);
      assert.match(result.stdout, /^two: looks different: .*-light/m);
      // shots.mjs's progress lines are not in the outcome
      assert.doesNotMatch(result.stdout, /^two: .*(loading|screen \d+ of)/m);
      assert.ok(readdirSync(join(out, 'compare/two')).some(file => file.endsWith('-new.png')));
      assert.ok(readdirSync(join(out, 'shots-cache')).length > 0, 'no cache');

      // another baseline, another output directory, and a config
      copyFileSync(join(root, 'tex8web.cfg'), join(dir, 'my.cfg'));
      result = await regress(dir, '--out', 'elsewhere', '--baseline', join(out, 'accepted'), '-c', 'my.cfg', 'one');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /^one: unchanged/m);
      assert.ok(existsSync(join(dir, 'elsewhere/html/one/main.html')));

      result = await regress(dir, '--draft', '--out', 'drafts', 'one');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.ok(existsSync(join(dir, 'drafts/html/one/main.html')));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('regress.mjs accepts only a run in which every document built', { skip: !lockf }, async () => {
    const dir = scratch({ 'two/note.tex': article('Second'), 'three/main.tex': article('Third'), 'bad/main.tex': article('\\undefinedcs') });
    const out = join(dir, 'build/regress');
    try {
      let result = await regress(dir, '--accept', 'two');
      assert.equal(result.status, 0, result.stderr + result.stdout);

      // a document that does not build fails the run, and no document is accepted
      result = await regress(dir, '--accept', 'three', 'bad');
      assert.equal(result.status, 1, result.stderr + result.stdout);
      assert.match(result.stdout, /^bad: failed to build/m);
      assert.equal(existsSync(join(out, 'accepted/three')), false);

      // a changed page is accepted without its screens being compared, and is then the baseline
      writeFileSync(join(dir, 'two/note.tex'), article('Second, and more words than before'));
      result = await regress(dir, '--accept', 'two');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /^two: changed: note\.html/m);
      assert.equal(existsSync(join(out, 'logs/two.shots.log')), false);
      assert.match(readFileSync(join(out, 'accepted/two/note.html'), 'utf8'), /more words/);
      result = await regress(dir, 'two');
      assert.match(result.stdout, /^two: unchanged/m);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('regress.mjs --latexmk builds each PDF before its page, and a failed PDF fails the document', async () => {
    const dir = scratch({ 'one/main.tex': article('First'), 'one/.latexmkrc': '$pdf_mode = 1;', 'bad/main.tex': article('\\undefinedcs') });
    try {
      const result = await regress(dir, '--latexmk', 'one', 'bad');
      assert.equal(result.status, 1, result.stderr + result.stdout);
      assert.ok(existsSync(join(dir, 'one/main.pdf')), 'no PDF');
      // without lockf, as on Linux, there are no locks
      if (lockf) assert.ok(existsSync(join(dir, 'one/build/pdf.lock')), 'no lock');
      assert.ok(existsSync(join(dir, 'build/regress/html/one/main.html')));
      assert.match(result.stdout, /^one: no baseline/m);
      assert.match(result.stdout, /^bad: failed to build its PDF, exit \d+ \(log: .*bad\.pdf\.log\)/m);
      assert.equal(existsSync(join(dir, 'build/regress/html/bad')), false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('regress.mjs --contain builds each PDF and page in the container, without the .latexmkrc', async () => {
    // (a .latexmkrc read would name the PDF rc.pdf)
    const dir = scratch({ 'one/main.tex': article('First'), 'one/.latexmkrc': "$jobname = 'rc';" });
    try {
      const result = await regress(dir, '--contain', '--latexmk', 'one');
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.ok(existsSync(join(dir, 'one/build/pdf/main.pdf')), 'no PDF');
      assert.ok(existsSync(join(dir, 'build/regress/html/one/main.html')));
      const runs = readFileSync(dockerLog, 'utf8').split('\n').filter(line => line.includes(`target=${join(dir, 'one')},readonly `));
      assert.ok(runs.some(line => line.includes(`target=${join(dir, 'one/build')} `)
        && line.endsWith(' latexmk -norc -pdf -outdir=build/pdf -interaction=nonstopmode -halt-on-error main.tex')), runs.join('\n'));
      assert.ok(runs.some(line => line.includes('/bin/tex8web -c ')), runs.join('\n'));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('regress.mjs refuses what it cannot do before it builds anything', async () => {
    const dir = scratch({ 'one/main.tex': article('First'), 'a/dup/main.tex': article('A'), 'b/dup/main.tex': article('B'),
      'empty/readme.txt': 'no TeX', 'two/a.tex': article('A'), 'two/b.tex': article('B') });
    try {
      const refused = async (pattern, ...args) => {
        const result = await regress(dir, ...args);
        assert.equal(result.status, 2, `${args.join(' ')}: ${result.stdout}${result.stderr}`);
        assert.match(result.stderr, pattern);
        assert.equal(existsSync(join(dir, 'build')), false, `${args.join(' ')} built something`);
      };
      await refused(/usage/);
      await refused(/usage/, '--no-such-option', 'one');
      await refused(/--draft/, '--draft', '--accept', 'one');
      await refused(/main\.tex/, 'empty');
      await refused(/main\.tex/, 'two');
      await refused(/same name.*dup/, 'a/dup', 'b/dup');
      await refused(/make4ht/, '--out', 'my-out', 'one');
      // (a source that is not trusted: a link where its PDF lock was is
      // removed, and the source refused; so is a source that holds a link,
      // or is named through one)
      mkdirSync(join(dir, 'one/build'));
      symlinkSync(join(dir, 'elsewhere.lock'), join(dir, 'one/build/pdf.lock'));
      await refused(/removed .*one\/build\/pdf\.lock[^]*refusing one: cleaning .*one\/build failed/, '--contain', '--latexmk', 'one');
      assert.equal(existsSync(join(dir, 'one/build/pdf.lock')) || existsSync(join(dir, 'elsewhere.lock')), false);
      symlinkSync('/dev/zero', join(dir, 'one/zero.tex'));
      await refused(/refusing one: .*one\/zero\.tex is not a file or a directory that can be read/, '--contain', 'one');
      symlinkSync(join(dir, 'one'), join(dir, 'linked'));
      await refused(/refusing linked: it is a symbolic link/, '--contain', 'linked');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// a copy of this checkout as a repository of its own, on the branch topic,
// which left main at main's one commit
const hasGit = spawnSync('git', ['--version']).status === 0;
function repository(files = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webcompare')));
  const tree = join(dir, 'tex8web');
  cpSync(root, tree, { recursive: true, filter: path => !['build', 'node_modules', '.git'].includes(basename(path)) });
  symlinkSync(realpathSync(join(root, 'node_modules')), join(tree, 'node_modules'));
  for (const [path, body] of Object.entries(files)) writeFileSync(join(tree, path), body);
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'base'], ['checkout', '-q', '-b', 'topic']]) {
    const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
      { cwd: tree, timeout: 60000, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  }
  return { dir, tree, commit: spawnSync('git', ['rev-parse', 'main'], { cwd: tree, encoding: 'utf8' }).stdout.slice(0, 12) };
}
const compare = (tree, ...args) => new Promise(done => {
  const child = spawn(process.execPath, [join(tree, 'test/compare.mjs'), ...args], { cwd: tree, timeout: 120000,
    env: { ...process.env, ...stubbed } });
  const result = { stdout: '', stderr: '' };
  child.stdout.on('data', data => { result.stdout += data; });
  child.stderr.on('data', data => { result.stderr += data; });
  child.on('close', status => done({ ...result, status }));
});
const outcomes = tree => JSON.parse(readFileSync(join(tree, 'build/compare/compare.json'), 'utf8'));
const none = { unchanged: [], changed: [], looksDifferent: [], new: [], removed: [], failed: [] };

describe('compare.mjs', { concurrency: true }, () => {
  test('compare.mjs reports the pages of a branch the same as at its merge base, and keeps one base for each merge base', { skip: !hasGit }, async () => {
    // (a fixture that fails to build at the merge base and on the branch, as
    // run.mjs's refused fixtures do)
    const { dir, tree, commit } = repository({ 'test/fixtures/test-refused.tex': article('\\undefinedcs') });
    const bases = join(dir, 'bases'), stale = join(bases, 'aaaaaaaaaaaa'), held = join(bases, 'bbbbbbbbbbbb');
    mkdirSync(stale, { recursive: true });
    mkdirSync(held);
    // (another run's base, which is not removed while that run holds its lock)
    const release = lockf ? await lock(`${held}.lock`) : null;
    const names = ['test-chapterstyle', 'test-graphics-only', 'test-refused'];
    try {
      let result = await compare(tree, '--bases', bases, ...names);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /^test-chapterstyle: unchanged$/m);
      assert.match(result.stdout, /^test-graphics-only: unchanged$/m);
      assert.match(result.stdout, /^test-refused: fails to build on both sides$/m);
      assert.deepEqual(outcomes(tree), { base: commit, ...none, unchanged: names });
      assert.equal(existsSync(stale), false, 'a stale base was kept');
      if (lockf) assert.ok(existsSync(held), 'a base in use was removed');

      // the base is extracted once, and both sides' builds are reused
      const marker = join(bases, commit, 'tex8web/marker');
      writeFileSync(marker, '');
      result = await compare(tree, '--bases', bases, ...names);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.doesNotMatch(result.stderr, /extracting/);
      assert.ok(existsSync(marker), 'the base was extracted again');
      assert.equal(result.stdout.match(/^reusing test-graphics-only's html build/gm)?.length, 2, result.stdout);

      // a document only on the branch is new, and has nothing to compare with
      writeFileSync(join(tree, 'test/fixtures/test-new.tex'), article('New'));
      result = await compare(tree, '--bases', bases, 'test-graphics-only', 'test-new');
      assert.equal(result.status, 3, result.stderr + result.stdout);
      assert.match(result.stdout, /^test-new: new/m);
      assert.deepEqual(outcomes(tree), { base: commit, ...none, unchanged: ['test-graphics-only'], new: ['test-new'] });

      result = await compare(tree, '--bases', bases, 'test-graphics-only', 'no-such-document');
      assert.equal(result.status, 2, result.stderr + result.stdout);
      assert.match(result.stderr, /no document named no-such-document/);
    } finally {
      release?.();
      rmSync(dir, { recursive: true });
    }
  });

  // (Chrome compares the screens. Like the screens of regress.mjs, this is
  // left out without lockf, as in CI's test job, which has no Chrome)
  test('compare.mjs reports the one fixture a branch changed', { skip: !hasGit || !lockf }, async () => {
    const { dir, tree, commit } = repository();
    try {
      writeFileSync(join(tree, 'test/fixtures/test-graphics-only.tex'), article('Changed'));
      const result = await compare(tree, '--bases', join(dir, 'bases'), 'test-chapterstyle', 'test-graphics-only');
      assert.equal(result.status, 3, result.stderr + result.stdout);
      assert.match(result.stdout, /^test-chapterstyle: unchanged$/m);
      assert.match(result.stdout, /^test-graphics-only: (changed|looks different): /m);
      const found = outcomes(tree);
      assert.deepEqual([...found.changed, ...found.looksDifferent], ['test-graphics-only']);
      assert.deepEqual({ ...found, changed: [], looksDifferent: [] }, { base: commit, ...none, unchanged: ['test-chapterstyle'] });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
