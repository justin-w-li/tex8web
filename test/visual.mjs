// npm run test:visual: each test document and example, prerendered, compared
// screen by screen with the same page typeset by MathJax in the browser,
// JavaScript off in both, and checked for alignments that line up across an
// \intertext, math characters not clipped, headings spaced as in LaTeX, the
// contents' fonts, printing and a page that fits a phone; it needs Chrome and
// the network, and saves the screens that differ in build/visual/<document>/visual/.
//   node test/visual.mjs [document names...]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, largestFirst, pool, select, testDir, workers } from './lib/build.mjs';
import { launch } from './lib/chrome.mjs';

const only = process.argv.slice(2);
const screen = 900;

// the browser's typeset page as it stands, without its scripts and with
// MathJax's styles (which it adds through the CSSOM) written out. The page
// is a copy without tex8web-page.js, so that only MathJax and
// tex8web-head.js, whose class on <html> is taken off, have changed it
const typesetPage = `(async () => {
  // (MathJax's script, from the network, may not have run yet)
  for (let t = 0; !MathJax.startup.promise; t += 100) {
    if (t > 30000) throw new Error("MathJax didn't load in 30s (offline?)");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await MathJax.startup.promise;
  const doc = MathJax.startup.document;
  await doc.lazyTypesetAll?.();
  // and the math ui/lazy took as it came into view, which lazyTypesetAll
  // leaves to it: taken out of the page until typeset again, after any
  // extension it needs has loaded (internal: ui/lazy's lazyPromise)
  await doc.lazyPromise;
  const css = [...document.styleSheets].filter(s => s.ownerNode?.id?.startsWith('MJX'))
    .map(s => [...s.cssRules].map(r => r.cssText).join('\\n')).join('\\n');
  const html = document.documentElement.cloneNode(true);
  html.classList.remove('tex8web-js');
  if (!html.classList.length) html.removeAttribute('class');
  html.querySelectorAll('script, style[id^=MJX]').forEach(n => n.remove());
  const style = document.createElement('style');
  style.textContent = css;
  html.querySelector('head').append(style);
  return '<!DOCTYPE html>' + html.outerHTML;
})()`;

// MathJax in the browser measuring as MathJax in Node does, which can't
// measure but estimates: text in math that MathJax has no glyphs for (as
// \text's in a \colorbox), the font's size, which lengths in pt convert by,
// and the room for a formula. So the two pages compare exactly, checking
// all prerendering does but measure. Run before the page's scripts, it
// sets the measures once the adaptor exists, at pageReady (internal: the
// lite adaptor's nodeSize, and its nodeBBox of nothing)
const nodeMeasures = `(() => {
  const cjk = new RegExp(["[","\\u1100-\\u115f","\\u2329\\u232a","\\u2e80-\\u303e","\\u3040-\\u3247","\\u3250-\\u4dbf",
    "\\u4e00-\\ua4c6","\\ua960-\\ua97c","\\uac00-\\ud7a3","\\uf900-\\ufaff","\\ufe10-\\ufe19","\\ufe30-\\ufe6b",
    "\\uff01-\\uff60\\uffe0-\\uffe6","\\u{1b000}-\\u{1b001}","\\u{1f200}-\\u{1f251}","\\u{20000}-\\u{3fffd}","]"].join(""), "gu");
  let config;
  Object.defineProperty(window, 'MathJax', { configurable: true, get: () => config, set(value) {
    config = value;
    const startup = value?.startup;
    if (!startup) return;
    const pageReady = startup.pageReady;
    startup.pageReady = function () {
      const adaptor = MathJax.startup.adaptor;
      adaptor.nodeSize = node => {
        const text = adaptor.textContent(node), other = Array.from(text.replace(cjk, '')).length;
        return [Array.from(text).length - other + other * 0.6, 0.8];
      };
      adaptor.nodeBBox = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
      return pageReady ? pageReady.call(this) : MathJax.startup.defaultPageReady();
    };
  } });
})()`;

// the alignments split at an \intertext whose columns don't line up across
// it: for each, the left edges of the columns before and after (the row
// with the most cells, in px)
const misaligned = `(() => {
  const edges = c => {
    const table = c.querySelector('mjx-mtable');
    const rows = [...table.querySelectorAll('mjx-mtr, mjx-mlabeledtr')]
      .filter(r => r.closest('mjx-mtable') === table && !r.closest('mjx-labels'));
    const row = rows.sort((a, b) => b.children.length - a.children.length)[0];
    return [...row.querySelectorAll(':scope > mjx-mtd')].map(td => Math.round(td.getBoundingClientRect().left * 2) / 2);
  };
  const all = [...document.querySelectorAll('mjx-container[display]')];
  const found = [...document.querySelectorAll('.tex8web-intertext')].map(text => {
    const before = all.filter(c => c.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
    const after = all.find(c => c.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_PRECEDING);
    return before && after && [text.textContent.trim().slice(0, 30), edges(before), edges(after)];
  }).filter(Boolean);
  return { checked: found.length, wrong: found.filter(f => f[1].join() !== f[2].join()) };
})()`;

// printed (css/tex8web.css), from a wide screen in dark mode (the system's
// and the reader's): light mode's colors and pictures, and none of the
// page's own controls; then on a sheet of paper (Letter inside Chrome's
// margins), footnotes after their paragraph and nothing cut off on the right
async function printed(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 1600, colorScheme: 'dark' }, async page => {
    await page.media('print');
    const wrong = await page.evaluate(`(() => {
      document.documentElement.dataset.theme = 'dark';
      const wrong = [], body = getComputedStyle(document.body);
      if (body.backgroundColor !== 'rgb(255, 255, 255)' || body.color !== 'rgb(0, 0, 0)') {
        wrong.push(\`text \${body.color} on \${body.backgroundColor}\`);
      }
      const shown = [...document.querySelectorAll('.tex8web-controls, .tex8web-toc, .tex8web-permalink')]
        .filter(el => el.checkVisibility());
      if (shown.length) wrong.push(\`\${shown.length} of the controls, contents and # links shown\`);
      const inverted = [...document.images].filter(img => getComputedStyle(img).filter !== 'none');
      if (inverted.length) wrong.push(\`\${inverted.length} pictures inverted\`);
      return wrong;
    })()`);
    await page.resize(740, 900);
    wrong.push(...await page.evaluate(`(() => {
      const wrong = [];
      const beside = [...document.querySelectorAll('.tex8web-sidenote')].filter(el => getComputedStyle(el).float !== 'none');
      if (beside.length) wrong.push(\`\${beside.length} footnotes beside the text\`);
      const cut = [...document.querySelectorAll('mjx-container[display], div.tabular, pre')]
        .filter(el => getComputedStyle(el).overflowX !== 'visible');
      if (cut.length) wrong.push(\`\${cut.length} displays, tabulars or verbatims that scroll\`);
      return wrong;
    })()`));
    return wrong.map(w => `printed: ${w}`);
  });
}

// the page no wider than a phone's screen (a display too wide scrolls on
// its own)
async function fits(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 390, height: 844 }, async page => {
    const [width, room] = await page.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]');
    return width > room ? [`${width - room}px wider than a screen ${room}px wide`] : [];
  });
}

// math characters with a clip (css/tex8web.css): there should be none
const clipped = `[...document.querySelectorAll('mjx-c')].filter(c => getComputedStyle(c).clipPath !== 'none').length`;

// just under a heading (css/tex8web.css): a theorem or list only the
// heading's space below it, as LaTeX adds no \topsep there; a framed box
// framed's space more, as far as titlesec's space below (in the text's
// ems) adds to it
const spaced = `(() => {
  const em = parseFloat(getComputedStyle(document.body).fontSize);
  const length = name => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0) * em;
  let checked = 0;
  const wrong = [...document.querySelectorAll('h3, h4, h5')].flatMap(h => {
    // (past an empty paragraph, which tex4ht may open before a list)
    let next = h.nextElementSibling;
    if (next?.matches('p') && !next.textContent.trim() && next.nextElementSibling) next = next.nextElementSibling;
    const below = parseFloat(getComputedStyle(h).marginBottom);
    const level = h.className.match(/((?:sub)*section)Head/i)?.[1].toLowerCase();
    let want;
    if (next?.matches('.newtheorem, ol, ul, dl')) want = below;
    else if (next?.matches('.framedenv')) {
      want = Math.max(below, length('--tex8web-' + level + '-after-text') + length('--tex8web-framed-sep'));
    } else return [];
    checked++;
    const gap = next.getBoundingClientRect().top - h.getBoundingClientRect().bottom;
    return Math.abs(gap - want) > 0.5 ? [[h.id, gap.toFixed(1), want.toFixed(1)]] : [];
  });
  return { checked, wrong };
})()`;

// the table of contents' entries in their fonts (css/tex8web.css), each
// level's as the browser computes it, with JavaScript off, when every
// entry is shown: sizes and the indent as multiples of the contents' own,
// and the weight of the entry's link and number, which html4.4ht's rules
// for the link can override
const entryFonts = `(() => {
  const base = parseFloat(getComputedStyle(document.querySelector('.tableofcontents')).fontSize);
  return Object.fromEntries([...document.querySelectorAll('.tableofcontents > span')].map(entry => {
    const style = getComputedStyle(entry);
    const link = entry.querySelector('a') && getComputedStyle(entry.querySelector('a'));
    const number = entry.querySelector('.tocnumber') && getComputedStyle(entry.querySelector('.tocnumber'));
    return [entry.className, { size: +(parseFloat(style.fontSize) / base).toFixed(2),
      indent: +(parseFloat(style.marginLeft) / base).toFixed(2), family: style.fontFamily,
      weight: style.fontWeight, style: style.fontStyle, variant: style.fontVariantCaps,
      linkSize: link && +(parseFloat(link.fontSize) / base).toFixed(2), linkWeight: link?.fontWeight,
      numberWeight: number?.fontWeight }];
  }));
})()`;
// (with tocloft, test-tocloft's: the part's \Large\scshape; chapters'
// \normalfont\itshape; sections' \itshape; subsections' \bfseries;
// subsubsections' \large\sffamily, whose indent is still the 3.8em that TeX
// measures; paragraphs' \ttfamily; subparagraphs' \slshape. Without it,
// html4.4ht's: a part bold at 110%, a chapter bold)
const roman = /Latin Modern Roman/, sans = /Latin Modern Sans/, mono = /Latin Modern Mono/;
const tocFonts = {
  'test-tocloft': {
    partToc: { size: 1.44, linkSize: 1.44, family: roman, weight: '400', linkWeight: '400', style: 'normal',
      variant: 'small-caps' },
    chapterToc: { size: 1, family: roman, weight: '400', linkWeight: '400', numberWeight: '400', style: 'italic',
      variant: 'normal' },
    sectionToc: { size: 1, family: roman, weight: '400', style: 'italic', variant: 'normal' },
    subsectionToc: { size: 1, indent: 3.8, family: roman, weight: '700', style: 'normal', variant: 'normal' },
    subsubsectionToc: { size: 1.2, indent: 3.8, family: sans, weight: '400', style: 'normal', variant: 'normal' },
    paragraphToc: { size: 1, family: mono, weight: '400', style: 'normal', variant: 'normal' },
    subparagraphToc: { size: 1, family: roman, weight: '400', style: 'italic', variant: 'normal' },
  },
  'test-report': {
    partToc: { size: 1.1, linkSize: 1.1, family: roman, weight: '700', linkWeight: '700', style: 'normal' },
    chapterToc: { size: 1, family: roman, weight: '700', linkWeight: '700', numberWeight: '700' },
    sectionToc: { size: 1, weight: '400', linkWeight: '400' },
  },
};

const docs = select(only);
// each document built twice, prerendered (html) and for the browser
// (fallback), a few builds at a time, the largest first; a document is
// compared as soon as both its builds are done
const variants = [['html', 'aux', { TEX8WEB_MATHML: '1' }], ['fallback', 'fallbackaux', { TEX8WEB_NO_PRERENDER: '1' }]];
const builds = largestFirst(docs).flatMap(doc => variants.map(([out, aux, env]) => ({ doc, out, aux, env, ...Promise.withResolvers() })));
pool(builds, workers, async ({ doc, out, aux, env, resolve }) => {
  resolve((await build(doc, join(testDir(doc, 'visual'), out), join(testDir(doc, 'visual'), aux), env)).code);
});
const built = async doc => (await Promise.all(builds.filter(b => b.doc === doc).map(b => b.promise))).every(code => code === 0);

// how many times each check had something to check, over the whole run:
// one that never did has checked nothing
const ran = { spaced: 0, misaligned: 0 };

// a document's two pages compared: its report's lines, and whether it failed
async function compare(chrome, doc, ok) {
  const dir = testDir(doc, 'visual');
  const [pre, browser] = [join(dir, 'html'), join(dir, 'fallback')];
  const visual = join(dir, 'visual');
  rmSync(visual, { recursive: true, force: true });
  // (the build's own problems are npm test's; this needs only the pages)
  if (!ok && !existsSync(join(pre, `${doc.tex.replace(/\.tex$/, '')}.html`))) {
    return { lines: [`not ok - ${doc.name}`, '    build failed'], failed: true };
  }
  const problems = [];
  for (const html of readdirSync(pre).filter(f => f.endsWith('.html'))) {
    // (the copy without tex8web-page.js, which would change the page after
    // MathJax has)
    const source = readFileSync(join(browser, html), 'utf8');
    const copy = source.replace(/<script [^>]*src='tex8web-page\.js'[^>]*><\/script>/, '');
    if (copy === source) problems.push(`${html}: no script for tex8web-page.js to leave out`);
    const bare = join(browser, html.replace(/\.html$/, '.bare.html'));
    writeFileSync(bare, copy);
    const typeset = join(browser, html.replace(/\.html$/, '.typeset.html'));
    writeFileSync(typeset, await chrome.withPage(pathToFileURL(bare).href, { before: nodeMeasures }, page => page.evaluate(typesetPage)));
    // each page as compared, JavaScript off: what only reads it, then its
    // screens (whose capture beyond the window resizes it)
    const shots = [];
    for (const file of [typeset, join(pre, html)]) {
      shots.push(await chrome.withPage(pathToFileURL(file).href, { javascript: false, height: screen }, async page => {
        const name = relative(dir, file);
        const aligned = await page.evaluate(misaligned);
        if (file !== typeset) ran.misaligned += aligned.checked;
        for (const [text, a, b] of aligned.wrong) {
          problems.push(`${name}: columns at ${a.join(', ')} before "${text}", ${b.join(', ')} after`);
        }
        const n = await page.evaluate(clipped);
        if (n) problems.push(`${name}: ${n} math characters clipped`);
        if (file !== typeset) {
          const under = await page.evaluate(spaced);
          ran.spaced += under.checked;
          for (const [id, gap, want] of under.wrong) problems.push(`${html}: #${id}: what follows it ${gap}px below, not ${want}px`);
          const entries = tocFonts[doc.name] && await page.evaluate(entryFonts);
          for (const [level, want] of Object.entries(tocFonts[doc.name] ?? {})) {
            for (const [key, value] of Object.entries(want)) {
              const got = entries[level]?.[key];
              if (!(value instanceof RegExp ? value.test(got) : got === value)) {
                problems.push(`${html}: .${level} ${key} is ${got}, not ${value}`);
              }
            }
          }
        }
        return page.screens();
      }));
    }
    const [a, b] = shots;
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
    for (const check of [printed, fits]) {
      problems.push(...(await check(chrome, join(pre, html))).map(p => `${html}: ${p}`));
    }
  }
  return { lines: [`${problems.length ? 'not ok' : 'ok'} - ${doc.name}`, ...problems.map(p => `    ${p}`)],
    failed: problems.length > 0 };
}

// the documents in Chrome as their builds finish, one at a time: with
// several tabs at once, headless Chrome sometimes draws a screen garbled
const chrome = await launch();
let failures = 0;
const waiting = new Map(docs.map(doc => [doc, built(doc).then(ok => [doc, ok])]));
while (waiting.size) {
  const [doc, ok] = await Promise.race(waiting.values());
  waiting.delete(doc);
  // (a page that can't be read fails, not the whole run)
  const { lines, failed } = await compare(chrome, doc, ok)
    .catch(error => ({ lines: [`not ok - ${doc.name}`, `    ${error.message}`], failed: true }));
  console.log(lines.join('\n'));
  failures += failed ? 1 : 0;
}
// (with all the documents: a subset may lack what a check looks for)
const never = only.length ? [] : Object.entries(ran).filter(([, count]) => !count).map(([name]) => name);
for (const name of never) console.log(`not ok - no document for the ${name} check to check`);
failures += never.length;
chrome.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
