// Tests of lib/chrome.mjs. They need Chrome, so npm run test:visual runs
// them, not npm test. Alone:
//   node --test test/chrome.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, until } from './lib/chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'tex8webchromepages'));
const write = (name, html) => pathToFileURL((writeFileSync(join(dir, name), html), join(dir, name))).href;
let chrome;
before(async () => { chrome = await launch(); });
after(() => { chrome.close(); rmSync(dir, { recursive: true }); });

// a font that does not load makes open() fail
const broken = () => write('broken.html', `<style>@font-face { font-family: x; src: url(missing.woff2); }
  p { font-family: x; }</style><p>text</p>`);

// the tab is gone only a moment after closeTarget answers
const closed = async tabs => assert.equal(await until(() => chrome.tabs(), n => n === tabs), tabs);

test('a tab that fails to open is closed', async () => {
  const tabs = await chrome.tabs();
  await assert.rejects(chrome.open(broken()), /fonts not loaded/);
  await closed(tabs);
});

test('withPage closes its tab when the check throws', async () => {
  const tabs = await chrome.tabs();
  await assert.rejects(chrome.withPage(write('plain.html', '<p>text</p>'), {}, () => { throw new Error('check failed'); }), /check failed/);
  await closed(tabs);
});

test('a screen that keeps changing is an error, a still one is a picture', async () => {
  const still = await chrome.open(write('still.html', '<p>text</p>'));
  assert.ok((await still.screenshot(0, 100)).length > 0);
  await still.close();
  const moving = await chrome.open(write('moving.html', `<p>text</p><script>let n = 0;
    (function change() { document.body.style.background = \`rgb(\${n++ % 256}, 0, 0)\`; requestAnimationFrame(change); })();</script>`));
  await assert.rejects(moving.screenshot(0, 100), /keeps changing/);
  await moving.close();
});

test('a signal ends the process with 128 plus its number, and the profile is removed', () => {
  const temp = mkdtempSync(join(tmpdir(), 'tex8webchromesignal'));
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { launch } from './test/lib/chrome.mjs'; await launch(); process.kill(process.pid, 'SIGTERM'); await new Promise(() => {});`],
    { cwd: join(here, '..'), env: { ...process.env, TMPDIR: temp }, encoding: 'utf8' });
    assert.equal(result.status, 143);
    // filtered, as the build slots are in TMPDIR too
    assert.deepEqual(readdirSync(temp).filter(name => name.startsWith('tex8webchrome')), []);
  } finally {
    rmSync(temp, { recursive: true });
  }
});

test('Chrome and its profile go with the process that started it, however it ends', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'tex8webchromekill'));
  // the processes whose command line names the profile, by pid
  const left = () => spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout
    .split('\n').filter(line => line.includes(temp)).map(line => Number(line.trim().split(' ')[0]));
  // in a separate process group, killed with SIGKILL, as build.mjs's run()
  // kills a command that hangs
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { launch } from './test/lib/chrome.mjs'; await launch(); console.log('up'); await new Promise(() => {});`],
  { cwd: join(here, '..'), env: { ...process.env, TMPDIR: temp }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
  try {
    const up = await Promise.race([once(child.stdout, 'data').then(() => true), once(child, 'exit').then(() => false)]);
    assert.ok(up, 'the launcher exited before Chrome was up');
    assert.notDeepEqual(left(), []);
    process.kill(-child.pid, 'SIGKILL');
    // (under the watcher's 4 s minimum wait. The watcher names the profile
    // too, so a watcher that waits for unreaped zombies fails here)
    assert.deepEqual(await until(left, lines => !lines.length, 3000) ?? left(), []);
    const profiles = () => readdirSync(temp).filter(name => name.startsWith('tex8webchrome'));
    assert.deepEqual(await until(profiles, names => !names.length) ?? profiles(), []);
  } finally {
    for (const pid of [-child.pid, ...left()]) try { process.kill(pid, 'SIGKILL'); } catch {}
    rmSync(temp, { recursive: true, force: true, maxRetries: 10 });
  }
});
