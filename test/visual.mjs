// npm run test:visual: each test document and example, prerendered, against
// the same page typeset by MathJax in the browser, compared screen by
// screen with JavaScript off (needs Chrome, and the network for MathJax).
// The two should be identical; differing screens are saved, as
// <screen>-browser.png and <screen>-prerendered.png, in
// build/test/<document>/visual/.
//   node test/visual.mjs [document names...]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, documents, root } from './lib/build.mjs';
import { launch } from './lib/chrome.mjs';

const expected = JSON.parse(readFileSync(join(root, 'test/expected.json'), 'utf8'));
const only = process.argv.slice(2);
const screen = 900;

// the browser's typeset page as it stands, without its scripts and with
// MathJax's styles (which it adds through the CSSOM) written out; and
// without what tex8web-page.js changed, which isn't MathJax's
const typesetPage = `(async () => {
  await MathJax.startup.promise;
  await MathJax.startup.document.lazyTypesetAll?.();
  const css = [...document.styleSheets].filter(s => s.ownerNode?.id?.startsWith('MJX'))
    .map(s => [...s.cssRules].map(r => r.cssText).join('\\n')).join('\\n');
  const html = document.documentElement.cloneNode(true);
  html.classList.remove('tex8web-js');
  if (!html.classList.length) html.removeAttribute('class');
  html.querySelector('.tex8web-theme')?.setAttribute('hidden', 'hidden');
  html.querySelectorAll('[aria-current]').forEach(n => n.removeAttribute('aria-current'));
  html.querySelectorAll('.tex8web-open').forEach(n => n.classList.remove('tex8web-open'));
  html.querySelectorAll('script, style[id^=MJX]').forEach(n => n.remove());
  const style = document.createElement('style');
  style.textContent = css;
  html.querySelector('head').append(style);
  return '<!DOCTYPE html>' + html.outerHTML;
})()`;

async function screens(chrome, file) {
  const page = await chrome.open(pathToFileURL(file).href, { javascript: false, height: screen });
  const height = await page.evaluate('document.documentElement.scrollHeight');
  const shots = [];
  for (let y = 0; y < height; y += screen) shots.push(await page.screenshot(y, Math.min(screen, height - y)));
  await page.close();
  return shots;
}

const chrome = await launch();
let failures = 0;
for (const doc of documents().filter(d => !only.length || only.includes(d.name))) {
  const dir = join(root, 'build/test', doc.name.replace(/[^A-Za-z0-9]/g, '_'));
  const [pre, browser] = [join(dir, 'html'), join(dir, 'fallback')];
  const visual = join(dir, 'visual');
  rmSync(visual, { recursive: true, force: true });
  const results = [await build(doc, pre, join(dir, 'aux')),
    await build(doc, browser, join(dir, 'fallbackaux'), { TEX8WEB_NO_PRERENDER: '1' })];
  // (the build's own problems are npm test's; this needs only the pages)
  if (results.some(r => r.code !== 0) && !existsSync(join(pre, `${doc.tex.replace(/\.tex$/, '')}.html`))) {
    console.log(`not ok - ${doc.name}\n    build failed`);
    failures++;
    continue;
  }
  const problems = [];
  for (const html of readdirSync(pre).filter(f => f.endsWith('.html'))) {
    const page = await chrome.open(pathToFileURL(join(browser, html)).href);
    const typeset = join(browser, html.replace(/\.html$/, '.typeset.html'));
    writeFileSync(typeset, await page.evaluate(typesetPage));
    await page.close();
    const [a, b] = [await screens(chrome, typeset), await screens(chrome, join(pre, html))];
    if (a.length !== b.length) problems.push(`${html}: ${a.length} screens in the browser, ${b.length} prerendered`);
    const differing = [];
    a.forEach((shot, i) => {
      if (shot === b[i]) return;
      differing.push(i);
      mkdirSync(visual, { recursive: true });
      const name = `${html.replace(/\.html$/, '')}-${String(i).padStart(3, '0')}`;
      writeFileSync(join(visual, `${name}-browser.png`), Buffer.from(shot, 'base64'));
      if (b[i]) writeFileSync(join(visual, `${name}-prerendered.png`), Buffer.from(b[i], 'base64'));
    });
    if (differing.length) problems.push(`${html}: screens ${differing.join(', ')} of ${a.length} differ`);
  }
  const known = expected[doc.name]?.visual;
  if (problems.length && known) {
    console.log(`ok - ${doc.name} # known: ${known}`);
    for (const problem of problems) console.log(`    ${problem}`);
  } else {
    console.log(`${problems.length ? 'not ok' : 'ok'} - ${doc.name}`);
    for (const problem of problems) console.log(`    ${problem}`);
    failures += problems.length ? 1 : 0;
  }
}
chrome.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
