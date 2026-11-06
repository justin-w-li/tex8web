// Tests of the test tools that need no browser, run by npm test:
// node --test test/tools.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from './lib/build.mjs';

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
  await new Promise(done => setTimeout(done, 100));
  assert.throws(() => process.kill(child, 0), { code: 'ESRCH' });
});

test('a command that keeps printing is not stopped by the deadline', async () => {
  const { code } = await run('sh', ['-c', 'for i in 1 2 3 4 5 6; do echo $i; sleep 0.2; done'], { idle: 0.5 });
  assert.equal(code, 0);
});
