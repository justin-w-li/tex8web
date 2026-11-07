// Headless Chrome over the DevTools protocol, for test:visual and
// shots.mjs. The profile directory is removed however the process ends.
//   const chrome = await launch();
//   const page = await chrome.open('file:///…/page.html', { javascript: false });
//   await page.evaluate('document.title'); await page.screenshot(y, height);
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { takeSlot } from './slots.mjs';

const candidates = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = ms => new Promise(done => setTimeout(done, ms));

// read() until wanted(its value) holds: that value, or null after ms. For
// a state the page reaches, rather than a wait for a time
export async function until(read, wanted = Boolean, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (wanted(value)) return value;
    if (Date.now() >= end) return null;
    await sleep(50);
  }
}

// a DevTools connection: send(method, params) -> result, failing if Chrome
// doesn't answer in two minutes (it has crashed)
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    clearTimeout(handler.timer);
    if (message.error) handler.fail(new Error(message.error.message));
    else handler.done(message.result);
  };
  return {
    send: (method, params = {}) => new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`${method}: no answer from Chrome in 120s`)), 120000);
      pending.set(++id, { done, fail, timer });
      ws.send(JSON.stringify({ id, method, params }));
    }),
    close: () => ws.close(),
  };
}

// Waits while Chrome, a group's leader, runs. If the Node process that
// launched it is gone first, kills Chrome's group and removes the profile,
// once the group is gone: a helper may still be writing into it
const watch = `
  my ($parent, $chrome, $profile) = @ARGV;
  while (kill 0 => $chrome) {
    if (getppid != $parent) {
      kill KILL => -$chrome;
      my $end = time + 5;
      select undef, undef, undef, 0.1 while kill(0 => -$chrome) && time < $end;
      rmtree($profile);
      unlink "$profile.log";
      exit;
    }
    select undef, undef, undef, 0.1;
  }`;

export async function launch() {
  const binary = candidates.find(existsSync);
  if (!binary) throw new Error('no Chrome found; set CHROME to its executable');
  // (a Chrome holds a build slot like a build does, until it is closed)
  const release = await takeSlot();
  const profile = mkdtempSync(join(tmpdir(), 'tex8webchrome'));
  // (Chrome won't run as root, as in a container, with its sandbox)
  const proc = spawn(binary, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    ...process.getuid?.() === 0 ? ['--no-sandbox'] : [],
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', openSync(`${profile}.log`, 'w')], detached: true });
  // Chrome has a group of its own, so it outlives this process when that
  // is killed outright and no handler runs. build.mjs's run() kills a
  // command that hangs so. The watcher, in a third group, ends Chrome then
  const watcher = spawn('perl', ['-MFile::Path=rmtree', '-e', watch, process.pid, proc.pid, profile],
    { stdio: 'ignore', detached: true });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { watcher.kill('SIGKILL'); } catch {}
    // (the whole group: on Linux, Chrome's helpers outlive it otherwise and
    // keep writing into the profile)
    try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
    try {
      rmSync(`${profile}.log`, { force: true });
      rmSync(profile, { recursive: true, force: true, maxRetries: 10 });
    } catch (e) {
      console.error(`tex8web: Chrome's profile ${profile} is left behind (${e.code})`);
    }
    release();
  };
  process.on('exit', cleanup);
  // (128 plus the signal, as a shell reports it: shots.mjs's callers read 1
  // as "screens differ")
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(128 + constants.signals[signal]));

  // (up to 30s: a first start, beside builds using every core, is slow)
  let port;
  for (let i = 0; i < 300 && !port && proc.exitCode === null; i++) {
    const file = join(profile, 'DevToolsActivePort');
    if (existsSync(file)) port = readFileSync(file, 'utf8').split('\n')[0];
    else await sleep(100);
  }
  if (!port) {
    const log = readFileSync(`${profile}.log`, 'utf8').trim().split('\n').slice(-10).join('\n');
    throw new Error(`Chrome did not start (${binary}, exit ${proc.exitCode}):\n${log}`);
  }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);

  async function attach(targetId, url, { javascript = true, width = 1000, height = 900, colorScheme = 'light', before, touch = false }) {
    const page = await connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    // (a touch screen, without a mouse: hover: none, pointer: coarse)
    if (touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
    if (!javascript) await page.send('Emulation.setScriptExecutionDisabled', { value: true });
    await page.send('Page.enable');
    // (a script to run before the page's own)
    if (before) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: before });
    await page.send('Page.navigate', { url });
    const evaluate = async expression => {
      const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    // loaded, and its fonts: one is fetched only once layout needs it
    // (hence the offsetHeight), which may be after the load event
    let loaded = false;
    for (let i = 0; i < 300 && !loaded; i++) {
      loaded = await evaluate(`document.readyState === 'complete'
        && document.documentElement.offsetHeight >= 0 && document.fonts.status === 'loaded'`);
      if (!loaded) await sleep(100);
    }
    if (!loaded) throw new Error(`${url}: not loaded in 30s`);
    const failed = await evaluate(`[...document.fonts].filter(f => f.status === 'error').map(f => f.family)`);
    if (failed.length) throw new Error(`${url}: fonts not loaded: ${failed.join(', ')}`);
    // two frames, for what scripts do once the page is in (as the sidenotes'
    // ResizeObserver, a frame later) or after a resize
    const frame = () => evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
    if (javascript) await frame();
    // (not optimizeForSpeed: with it, a repeated capture can antialias a
    // rounded corner one level differently, as in Chrome 156)
    const capture = async (y, h) => (await page.send('Page.captureScreenshot', { format: 'png',
      captureBeyondViewport: true, clip: { x: 0, y, width, height: h, scale: 1 } })).data;
    // a PNG (base64) of the page from y down, h high, once two captures in
    // a row agree: the first of a part beyond the window can miss what
    // Chrome hasn't painted there yet, such as a display
    const screenshot = async (y, h) => {
      let last;
      for (let i = 0; i < 4; i++) {
        const shot = await capture(y, h);
        if (shot === last) return shot;
        last = shot;
      }
      throw new Error(`${url}: the screen at ${y}px keeps changing`);
    };
    return {
      evaluate,
      frame,
      screenshot,
      // the whole page, a window's height at a time, calling shot(i, n)
      // after each of the n
      async screens(shot = () => {}) {
        const total = await evaluate('document.documentElement.scrollHeight');
        const shots = [];
        for (let y = 0; y < total; y += height) {
          shots.push(await screenshot(y, Math.min(height, total - y)));
          shot(shots.length, Math.ceil(total / height));
        }
        return shots;
      },
      // the mouse at x, y in the window: type is pressed, moved (with the
      // left button held), released or wheel; extra is more of DevTools'
      // Input.dispatchMouseEvent (clickCount, deltaY)
      async mouse(type, x, y, extra = {}) {
        await page.send('Input.dispatchMouseEvent', { type: `mouse${type[0].toUpperCase()}${type.slice(1)}`,
          x, y, button: type === 'wheel' ? 'none' : 'left', buttons: ['pressed', 'moved'].includes(type) ? 1 : 0,
          clickCount: 1, deltaX: 0, deltaY: 0, ...extra });
      },
      // a key pressed and let go: key and keyCode as in a KeyboardEvent
      // ('Escape', 27), with DevTools' modifiers (8 for Shift)
      async press(key, keyCode, modifiers = 0) {
        for (const type of ['keyDown', 'keyUp']) {
          await page.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: keyCode, modifiers });
        }
      },
      // a finger's tap at x, y (a touch screen from the first on)
      async tap(x, y) {
        if (!touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
        touch = true;
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
      // the window's size changed, as turning a phone changes it
      async resize(w, h) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      },
      // the page as on another medium ('print')
      async media(type) {
        await page.send('Emulation.setEmulatedMedia', { media: type,
          features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
      },
      async close() {
        page.close();
        await browser.send('Target.closeTarget', { targetId });
      },
    };
  }

  const open = async (url, options = {}) => {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    // (a tab left open garbles the screenshots of the next)
    try {
      return await attach(targetId, url, options);
    } catch (error) {
      await browser.send('Target.closeTarget', { targetId }).catch(() => {});
      throw error;
    }
  };
  // f(tab), with the tab closed after it, however it ends
  const withPage = async (url, options, f) => {
    const tab = await open(url, options);
    try {
      return await f(tab);
    } finally {
      await tab.close();
    }
  };

  return {
    version: version.Browser,
    open,
    withPage,
    async tabs() {
      return (await browser.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page').length;
    },
    close() {
      browser.close();
      cleanup();
    },
  };
}
