// Tests of the test tools that need no browser, run by npm test:
// node --test test/tools.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run, strayKeys } from './lib/build.mjs';
import { until } from './lib/chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const node = (...args) => spawnSync(process.execPath, args, { cwd: join(here, '..'), encoding: 'utf8' });

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

for (const script of ['run', 'visual', 'page']) {
  test(`${script}.mjs fails on a name that matches nothing`, () => {
    const result = node(`test/${script}.mjs`, 'no-such-name');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no (document|check) named no-such-name/);
    assert.doesNotMatch(result.stdout, /all passed/);
  });
}

test('a command that prints nothing for the deadline is killed with what it started', async () => {
  const { code, log } = await run('sh', ['-c', 'sleep 60 & echo $!; wait'], { idle: 0.5 });
  assert.notEqual(code, 0);
  assert.match(log, /\[FATAL\] sh printed nothing for 0\.5s/);
  const child = Number(log.split('\n')[0]);
  // (a killed process may be a zombie for a moment, which kill(pid, 0) finds)
  const gone = () => { try { process.kill(child, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
  assert.ok(await until(gone, Boolean, 5000), `process ${child} still running`);
});

test('a command that keeps printing is not stopped by the idle deadline', async () => {
  const { code } = await run('sh', ['-c', 'for i in 1 2 3 4 5 6; do echo $i; sleep 0.5; done'], { idle: 2 });
  assert.equal(code, 0);
});

test('a command that prints forever is stopped by the total deadline', async () => {
  const { code, log } = await run('sh', ['-c', 'while :; do echo x; sleep 0.05; done'], { idle: 5, total: 0.5 });
  assert.notEqual(code, 0);
  assert.match(log, /\[FATAL\] sh ran over 0\.5s/);
});

test('a table keyed by a document that does not exist is found', () => {
  assert.deepEqual(strayKeys({ test: 1, 'test-generic (MathJax in the browser)': 1 }, { 'no-such-document': 1 }), ['no-such-document']);
});
