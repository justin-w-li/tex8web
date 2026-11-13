// Tests of lib/chrome.mjs. They need Chrome, so npm run test:visual runs
// them, not npm test. Alone:
//   node --test test/chrome.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
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

// A page whose script tries every way out, to a server on 127.0.0.1 (by
// address and as localhost), to a name that needs a DNS lookup, to a file
// outside the page's directory, and to the downloads folder. Returns what
// reached the server (connect, paths, tls, or udp), the hosts Chrome
// looked up, as its net log shows them, whether the outside file was
// read, and the page's address and screenshot. Offline, the page may load
// the files of its directory
async function tryWaysOut(offline) {
  const reached = [];
  const server = createServer(socket => {
    reached.push('connect');
    socket.on('error', () => {});
    socket.once('data', data => {
      reached.push(data[0] === 0x16 ? 'tls' : String(data).split(' ')[1]);
      socket.destroy();
    });
  });
  const udp = createSocket('udp4').on('message', () => reached.push('udp'));
  await Promise.all([new Promise(done => server.listen(0, '127.0.0.1', done)), new Promise(done => udp.bind(0, '127.0.0.1', done))]);
  const port = server.address().port, at = `127.0.0.1:${port}`;
  const netLog = join(dir, `${offline ? 'offline' : 'default'}.json`);
  const outside = mkdtempSync(join(tmpdir(), 'tex8webchromeoutside'));
  writeFileSync(join(outside, 'secret.html'), `<script>parent.postMessage('read', '*');</script>`);
  let own;
  try {
    own = await launch({ offline: offline && [dir], netLog });
    const tab = await own.open(write('ways-out.html', `<link rel="dns-prefetch" href="//example.invalid">
      <link rel="preconnect" href="http://localhost:${port}"><link rel="prefetch" href="http://${at}/prefetch">
      <img src="http://${at}/img"><img src="http://example.invalid/img"><p>text</p>
      <iframe src="${pathToFileURL(join(outside, 'secret.html')).href}"></iframe>
      <script>
        addEventListener('message', event => { window.secret = event.data; new WebSocket('ws://${at}/' + event.data); });
        // (by default, into the user's downloads folder, so not tried)
        if (${offline}) Object.assign(document.createElement('a'), { download: '${download}', href: 'data:text/plain,x' }).click();
        fetch('http://${at}/fetch').catch(() => {});
        fetch('http://localhost:${port}/localhost').catch(() => {});
        fetch('https://${at}/').catch(() => {});
        const xhr = new XMLHttpRequest(); xhr.open('GET', 'http://${at}/xhr'); xhr.send();
        new WebSocket('ws://${at}/ws');
        const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${udp.address().port}' }] });
        peer.createDataChannel('x');
        peer.createOffer().then(offer => peer.setLocalDescription(offer));
        // (last, as a marker that the tries before it were made, followed by
        // more, as the net log is written in batches)
        setTimeout(() => {
          new WebSocket('ws://${at}/last');
          setInterval(() => new WebSocket('ws://${at}/after'), 50);
          location.href = 'http://${at}/navigate';
        }, 500);
      </script>`));
    // (the net log is written as Chrome goes, in order)
    const log = () => readFileSync(netLog, 'utf8');
    assert.ok(await until(() => log().includes(`${at}/last`) && (offline || reached.includes('/navigate')), Boolean, 10000),
      'no marker in the net log');
    // (a moment for what is still on its way)
    await until(() => false, Boolean, 500);
    // (a line of constants, then an event a line)
    const text = log(), events = text.indexOf(',\n"events"');
    const names = Object.fromEntries(Object.entries(JSON.parse(`${text.slice(0, events)}}`).constants.logEventTypes)
      .map(([name, type]) => [type, name]));
    const lookups = [...text.slice(events).matchAll(/^\{.*\},?$/gm)].map(line => JSON.parse(line[0].replace(/,$/, '')))
      .filter(event => names[event.type] === 'HOST_RESOLVER_MANAGER_JOB' && event.params?.host).map(event => event.params.host);
    return { reached, lookups, url: await tab.evaluate('location.href'), shot: await tab.screenshot(0, 100),
      read: await tab.evaluate('window.secret === "read"') };
  } finally {
    own?.close();
    server.close();
    udp.close();
    rmSync(outside, { recursive: true });
  }
}
// (a name of its own, as the download, if the test fails, lands in the
// user's downloads folder)
const download = `tex8web-offline-${process.pid}.txt`;

test('offline, no request of a page leaves Chrome, and the page is still shot', async () => {
  const { reached, lookups, url, shot, read } = await tryWaysOut(true);
  const downloaded = join(homedir(), 'Downloads', download);
  try {
    assert.deepEqual(reached, []);
    assert.deepEqual(lookups, []);
    assert.equal(read, false);
    assert.ok(!existsSync(downloaded), 'the page downloaded a file');
    assert.match(url, /^file:.*ways-out\.html$/);
    assert.ok(shot.length > 0);
  } finally {
    rmSync(downloaded, { force: true });
  }
});

// (so that the test above can fail)
test('by default, the same page reaches the server and the DNS', async () => {
  const { reached, lookups } = await tryWaysOut(false);
  // (the outside file sends /read)
  for (const way of ['connect', '/prefetch', '/img', '/fetch', '/localhost', 'tls', '/xhr', '/ws', 'udp', '/read', '/navigate']) {
    assert.ok(reached.includes(way), `${way} did not reach the server: ${reached}`);
  }
  assert.ok(lookups.some(host => host.includes('example.invalid')), `no lookup of example.invalid: ${lookups}`);
});
