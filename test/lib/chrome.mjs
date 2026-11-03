// Headless Chrome over the DevTools protocol, for test/visual.mjs. The
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

// a DevTools connection: send(method, params) -> result
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
    if (message.error) handler.fail(new Error(message.error.message));
    else handler.done(message.result);
  };
  return {
    send: (method, params = {}) => new Promise((done, fail) => {
      pending.set(++id, { done, fail });
      ws.send(JSON.stringify({ id, method, params }));
    }),
    close: () => ws.close(),
  };
}

export async function launch() {
  const binary = candidates.find(existsSync);
  if (!binary) throw new Error('no Chrome found; set CHROME to its executable');
  const profile = mkdtempSync(join(tmpdir(), 'tex8webchrome'));
  const proc = spawn(binary, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => {
    try { proc.kill('SIGKILL'); } catch {}
    rmSync(profile, { recursive: true, force: true });
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
    async open(url, { javascript = true, width = 1000, height = 900, colorScheme = 'light' } = {}) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const page = await connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
      if (!javascript) await page.send('Emulation.setScriptExecutionDisabled', { value: true });
      await page.send('Page.enable');
      await page.send('Page.navigate', { url });
      for (let i = 0; i < 300; i++) {
        const { result } = await page.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
        if (result.value === 'complete') break;
        await sleep(100);
      }
      await sleep(500);  // (fonts)
      return {
        async evaluate(expression) {
          const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
          return r.result.value;
        },
        // a PNG (base64) of the page from y down, height high
        async screenshot(y, h) {
          const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
            clip: { x: 0, y, width, height: h, scale: 1 } });
          return data;
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
