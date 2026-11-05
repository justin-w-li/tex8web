// Headless Chrome over the DevTools protocol, for test:visual and shots.mjs. The
// profile directory is removed however the process ends.
//   const chrome = await launch();
//   const page = await chrome.open('file:///…/page.html', { javascript: false });
//   await page.evaluate('document.title'); await page.screenshot(y, height);
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const candidates = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = ms => new Promise(done => setTimeout(done, ms));

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

export async function launch() {
  const binary = candidates.find(existsSync);
  if (!binary) throw new Error('no Chrome found; set CHROME to its executable');
  const profile = mkdtempSync(join(tmpdir(), 'tex8webchrome'));
  // (Chrome won't run as root, as in a container, with its sandbox)
  const proc = spawn(binary, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    ...process.getuid?.() === 0 ? ['--no-sandbox'] : [],
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => {
    try { proc.kill('SIGKILL'); } catch {}
    // (Chrome's helpers may still be writing into the profile as they die)
    rmSync(profile, { recursive: true, force: true, maxRetries: 10 });
  };
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));

  let port;
  for (let i = 0; i < 100 && !port; i++) {
    const file = join(profile, 'DevToolsActivePort');
    if (existsSync(file)) port = readFileSync(file, 'utf8').split('\n')[0];
    else await sleep(100);
  }
  if (!port) throw new Error('Chrome did not start');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);

  return {
    async open(url, { javascript = true, width = 1000, height = 900, colorScheme = 'light', before } = {}) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const page = await connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
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
      // (what scripts lay out once the page is in, as the sidenotes'
      // ResizeObserver, a frame later)
      if (javascript) await evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
      // a PNG (base64) of the page from y down, h high
      const screenshot = async (y, h) => (await page.send('Page.captureScreenshot', { format: 'png',
        captureBeyondViewport: true, clip: { x: 0, y, width, height: h, scale: 1 } })).data;
      let touch = false;
      return {
        evaluate,
        screenshot,
        // the whole page, a window's height at a time
        async screens() {
          const total = await evaluate('document.documentElement.scrollHeight');
          const shots = [];
          for (let y = 0; y < total; y += height) shots.push(await screenshot(y, Math.min(height, total - y)));
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
        // ('Escape', 27)
        async press(key, keyCode) {
          for (const type of ['keyDown', 'keyUp']) {
            await page.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: keyCode });
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
    },
    close() {
      browser.close();
      cleanup();
    },
  };
}
