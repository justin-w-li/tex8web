// Tests of regress.mjs. Run by npm test, or alone:
//   node --test test/regress.test.mjs
// make4ht is a stand-in (test/lib/stubs.mjs). Chrome is real, for the screens.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { root } from './lib/build.mjs';
import { stubbed } from './lib/stubs.mjs';

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
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
