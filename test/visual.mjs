// npm run test:visual: each test document and example, prerendered and
// typeset by MathJax in the browser, compared screen by screen with
// JavaScript off. Both pages are checked for alignments that line up across
// an \intertext, unclipped math characters, and footnotes in the text's
// color. The prerendered page is also checked for a hidden theme button,
// headings spaced as in LaTeX, also right after another heading, tables
// in the text spaced as paragraphs, the rest of each \hfill at the right,
// algorithm2e's numbers and captions, list labels on their text's
// baseline, ties as wide as a space and with no line break after them,
// the fonts of the table of contents and the space of its part entries,
// blocks wider than the column scrolling inside it, printing,
// a width that fits a phone, and TikZ pictures that hold a graphic,
// which dark mode leaves as they are.
// The page for MathJax in the browser is built from the prerendered
// build's LaTeX runs (CONTRIBUTING.md, "Reused builds").
// Needs Chrome and the network. Differing screens are saved in
// build/visual/<document>/visual/.
//   node test/visual.mjs [--shard k/n] [document names...]
//   node test/visual.mjs --sum <directory>
// With --shard, only every n-th document, the largest first, from the k-th,
// for CI's parallel jobs. The subjects each check found are then written to
// build/visual/ran-<k>.json, and --sum reads every shard's file from the
// directory and fails a check that found no subject in any shard.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, largestFirst, pool, root, select, strayKeys, testDir, workers } from './lib/build.mjs';
import { launch } from './lib/chrome.mjs';

const only = process.argv.slice(2);
const option = name => {
  const at = only.indexOf(name);
  return at < 0 ? undefined : only.splice(at, 2)[1] ?? '';
};
const sharding = option('--shard'), sum = option('--sum');
const [, shard, shards] = sharding?.match(/^(\d+)\/(\d+)$/)?.map(Number) ?? [];
if (sharding !== undefined && !(shard >= 1 && shard <= shards) || sum === '') {
  console.error('usage: node test/visual.mjs [--shard k/n] [document names...], or --sum <directory>');
  process.exit(2);
}
const unchecked = ran => Object.entries(ran).filter(([, count]) => !count).map(([name]) => `no document for the ${name} check to check`);
if (sum !== undefined) {
  const files = readdirSync(sum).filter(file => file.endsWith('.json')).map(file => JSON.parse(readFileSync(join(sum, file), 'utf8')));
  const of = files[0]?.of ?? 0;
  const problems = of ? [] : [`no shard's subjects in ${sum}`];
  for (let i = 1; i <= of; i++) {
    if (!files.some(file => file.shard === i)) problems.push(`no subjects from shard ${i} of ${of}`);
  }
  const total = {};
  for (const { ran } of files) for (const [name, count] of Object.entries(ran)) total[name] = (total[name] ?? 0) + count;
  problems.push(...unchecked(total));
  for (const problem of problems) console.log(`not ok - ${problem}`);
  console.log(problems.length ? `\n${problems.length} failed` : `\nall passed: every check found subjects in ${of} shards`);
  process.exit(problems.length ? 1 : 0);
}
const screen = 900;

// The page as typeset in the browser: no scripts, MathJax's styles (added
// through the CSSOM) written out, and no classes from tex8web-head.js on
// <html>. The page is a copy without tex8web-page.js, so only MathJax and
// tex8web-head.js have changed it.
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
  html.classList.remove('tex8web-js', 'tex8web-top');
  if (!html.classList.length) html.removeAttribute('class');
  html.querySelectorAll('script, style[id^=MJX]').forEach(n => n.remove());
  const style = document.createElement('style');
  style.textContent = css;
  html.querySelector('head').append(style);
  return '<!DOCTYPE html>' + html.outerHTML;
})()`;

// Makes MathJax in the browser measure as MathJax in Node, which cannot
// measure and estimates instead: text in math without MathJax glyphs (as
// \text in a \colorbox), the font size that converts pt lengths, and the
// width available to a formula. The two pages then compare exactly, and
// all of prerendering is checked except measuring. The script runs
// before the page's scripts and replaces the measures at pageReady, once
// the adaptor exists (internal: the lite adaptor's nodeSize, and its
// nodeBBox of zeros).
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

// the alignments split by an \intertext whose columns do not line up
// across it: for each, the left edges in px of the columns before and after,
// in the row with the most cells
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

// Printing (css/tex8web.css) from a wide screen, with dark mode set by both
// the system and the reader: light mode's colors and pictures, with no
// white behind a picture that holds a graphic, and no page controls. Then at the width of Letter paper inside Chrome's margins:
// footnotes after their paragraph, and nothing cut off on the right.
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
      const backed = [...document.querySelectorAll('img.tex8web-graphic')]
        .filter(img => getComputedStyle(img).backgroundColor !== 'rgba(0, 0, 0, 0)');
      if (backed.length) wrong.push(\`\${backed.length} pictures with a graphic on white\`);
      return wrong;
    })()`);
    await page.resize(740, 900);
    wrong.push(...await page.evaluate(`(() => {
      const wrong = [];
      const beside = [...document.querySelectorAll('.tex8web-sidenote')].filter(el => getComputedStyle(el).float !== 'none');
      if (beside.length) wrong.push(\`\${beside.length} footnotes beside the text\`);
      const cut = [...document.querySelectorAll('mjx-container[display], div.tabular, div.longtable, pre, div.alltt, div.verbatiminput, div.listing, div.listinginput, div.verbatimtabinput')]
        .filter(el => getComputedStyle(el).overflowX !== 'visible');
      if (cut.length) wrong.push(\`\${cut.length} displays, tabulars or verbatims that scroll\`);
      return wrong;
    })()`));
    return wrong.map(w => `printed: ${w}`);
  });
}

// the page no wider than a phone screen (a display that is too wide
// scrolls inside itself)
async function fits(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 390, height: 844 }, async page => {
    const [width, room] = await page.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]');
    return width > room ? [`${width - room}px wider than a screen ${room}px wide`] : [];
  });
}

// footnotes beside the text not in the text's color, also in a block
// colored by \color (test-declared.tex)
const offColor = `(notes => ({ checked: notes.length,
  wrong: notes.filter(el => getComputedStyle(el).color !== getComputedStyle(document.body).color).length }))(
  [...document.querySelectorAll('.tex8web-sidenote')])`;
// math characters with a clip-path (css/tex8web.css)
const clipped = `[...document.querySelectorAll('mjx-c')].filter(c => getComputedStyle(c).clipPath !== 'none').length`;

// Space below a heading (css/tex8web.css). A theorem or list right after
// a heading has only the heading's margin above it, as LaTeX adds no
// \topsep there. A framed box has the larger of that margin and titlesec's
// space below plus framed's separation, both in ems of the text.
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

// A heading right after another heading, spaced as in the PDF: the gap
// between their boxes is the first heading's space below, as LaTeX's
// \@startsection and titlesec add no space above a heading while
// \if@nobreak holds, or under titlesec's option largestsep the larger of
// the two spaces. A paragraph heading is measured from its paragraph's
// box. An empty element between the two is a failure too: margins
// collapse through it, so the gap alone does not show that the
// stylesheet's rule applies.
// headGaps has, by the second heading's id, the glue between the two
// headings in the PDF, in ems of the text. Failures: [id, what is wrong]
const headGap = gaps => `(() => {
  const em = parseFloat(getComputedStyle(document.body).fontSize);
  return Object.entries(${JSON.stringify(gaps)}).flatMap(([id, want]) => {
    const h = document.getElementById(id), box = h.matches('p > *') ? h.parentElement : h;
    let above = box.previousElementSibling, empty;
    while (!above.getBoundingClientRect().height) [empty, above] = [above, above.previousElementSibling];
    const gap = box.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
    return [...Math.abs(gap - want * em) > 0.5 ? [[id, \`\${(gap / em).toFixed(3)}em below the heading above it, not \${want}em\`]] : [],
      ...empty ? [[id, \`an empty <\${empty.localName}> between it and the heading above it\`]] : []];
  });
})()`;
const headGaps = {
  // (article: the part's \vskip 3ex, 12.91663pt; \section's 2.3ex,
  // 9.90276pt, and \subsection's 1.5ex, 6.45831pt, below; a run-in
  // \paragraph adds nothing above)
  'test-headspace': { 'after-the-part': 1.29166, 'after-the-section': 0.99028, 'after-the-label': 0.99028,
    'after-the-starred-label': 0.99028, 'after-the-subsection': 0.64583, 'a-paragraph': 0.64583,
    'after-the-unnumbered-part': 1.29166, 'after-the-index': 0.99028 },
  // (the same, with an entry added to the table of contents in between)
  'test-tocpart': { 'another-section': 1.29166, 'an-unnumbered-section': 0.99028 },
  // (report: \@makechapterhead's \vskip 40pt below a chapter)
  'test-headspace-report': { 'after-the-chapter': 4, 'after-the-label': 4 },
  // (titlesec: the part's 3ex, and 2.5ex and 1.5ex below a section and a
  // subsubsection)
  'test-headspace-titlesec': { 'after-the-part': 1.29166, 'after-the-section': 1.07639,
    'after-the-subsubsection': 0.64583 },
  // (largestsep: the section's 6ex, 25.83325pt, larger than the part's 3ex)
  'test-headspace-largestsep': { 'after-the-part': 2.58333 },
};

// A part's entry in the table of contents: half the PDF's space above it,
// as for the other levels (css/tex8web.css), in ems of the table of
// contents, and its line height, in ems of each entry, also on the
// entry's link. tocParts has the PDF's space above a part's
// entry, \cftbeforepartskip or the class's \l@part, in ems of the text,
// and the number of part entries. Failures: [title, what is wrong]
const partEntries = skip => `(() => {
  const toc = document.querySelector('nav .tableofcontents');
  const em = parseFloat(getComputedStyle(toc).fontSize);
  const leading = el => parseFloat(getComputedStyle(el).lineHeight) / parseFloat(getComputedStyle(el).fontSize);
  const want = leading(toc);
  const entries = [...toc.querySelectorAll(':scope > :is(.partToc, .likepartToc)')];
  return { checked: entries.length, wrong: entries.flatMap(entry => {
    const above = parseFloat(getComputedStyle(entry).marginTop) / em;
    return [...Math.abs(above - ${skip} / 2) > 0.01 ? [[entry.textContent.trim(), \`\${above.toFixed(3)}em above it, not \${${skip} / 2}em\`]] : [],
      ...[entry, entry.querySelector('a')].filter(el => Math.abs(leading(el) - want) > 0.01)
        .map(el => [entry.textContent.trim(), \`line height \${leading(el).toFixed(3)} on its \${el.localName}, not \${want}\`])];
  }) };
})()`;
const tocParts = { 'test-tocpart': [2.25, 2], 'test-tocpart-tocloft': [1.5, 1], 'test-tocpart-report': [2.25, 1],
  'test-report': [2.25, 1], 'test-tocloft': [2.25, 1] };

// Space above a tabular in the text, as above a paragraph in its place
// (css/tex8web.css): after a paragraph, a table, or a footnote beside the
// text. Failures: [table id, gap, gap above the paragraph]
const tablesSpaced = `(() => {
  const divs = [...document.querySelectorAll('div.tabular')].filter(d => !d.closest('td, figure'));
  const wrong = divs.flatMap(d => {
    const p = document.createElement('p');
    p.textContent = 'x';
    d.before(p);
    d.hidden = true;
    const want = getComputedStyle(p).marginTop;
    p.remove();
    d.hidden = false;
    const got = getComputedStyle(d).marginTop;
    return got === want ? [] : [[d.querySelector('table').id, got, want]];
  });
  return { checked: divs.length, wrong };
})()`;

// a center, flushleft, flushright, or verbatim, and a paragraph or
// tabular after one, spaced as a list: \topsep, plus \parskip with
// \WebLikePDF, as \trivlist adds it. Also after a paragraph's footnote.
// Failures: [text, got, want]
const blocksSpaced = `(() => {
  const block = ':is(div.center, div.flushleft, div.flushright, pre.verbatim)';
  const spaced = [...document.querySelectorAll(':is(p, ' + block + ', :where(p, .tex8web-sidenote) + .tex8web-sidenote) + ' + block
    + ', ' + block + ' + :is(p, div.tabular)')];
  const space = document.documentElement.classList.contains('tex8web-like-pdf')
    ? 'calc(var(--tex8web-list-sep) + var(--tex8web-parskip))' : 'var(--tex8web-list-sep)';
  const wrong = spaced.flatMap(d => {
    const got = getComputedStyle(d).marginTop;
    const probe = document.createElement('div');
    probe.style.marginTop = space;
    d.before(probe);
    const want = getComputedStyle(probe).marginTop;
    probe.remove();
    return got === want ? [] : [[d.textContent.trim().slice(0, 30), got, want]];
  });
  return { checked: spaced.length, wrong };
})()`;

// algorithm2e's geometry, as in its PDF: a line number at the right
// 1.2em + \skiptext - \algomargin from the algorithm's right edge
// (\algocf@printnl), and a one-line caption of plain, boxed, or plainruled
// centered over the algorithm less the 1.5em kept for numbers, and less
// \algomargin in boxed (\algocf@makecaption). Failures: [id, what is wrong]
const algorithms = `(() => {
  const wrong = [];
  let checked = 0;
  for (const figure of document.querySelectorAll('figure.tex8web-a2e')) {
    const style = getComputedStyle(figure), em = parseFloat(style.fontSize);
    const length = name => parseFloat(style.getPropertyValue('--tex8web-a2e-' + name)) * em;
    const box = figure.getBoundingClientRect();
    for (const number of figure.querySelectorAll('.tex8web-a2e-nl-right')) {
      checked++;
      const gap = box.right - number.getBoundingClientRect().right;
      const want = 1.2 * em + length('text') - length('margin');
      if (Math.abs(gap - want) > 0.5) wrong.push([figure.id, 'a number ' + gap.toFixed(1) + 'px from the right, not ' + want.toFixed(1)]);
    }
    const centered = figure.matches('.tex8web-a2e-plain, .tex8web-a2e-boxed, .tex8web-a2e-plainruled');
    if (centered) {
      checked++;
      const range = document.createRange();
      range.selectNodeContents(figure.querySelector(':scope > figcaption'));
      const text = range.getBoundingClientRect();
      const width = box.width - 1.5 * em - (figure.matches('.tex8web-a2e-boxed') ? length('margin') : 0);
      const shift = (text.left + text.right) / 2 - box.left - width / 2;
      if (Math.abs(shift) > 0.5) wrong.push([figure.id, 'the caption ' + shift.toFixed(1) + 'px off center']);
    }
  }
  return { checked, wrong };
})()`;

// The rest of each \hfill outside the table of contents (text.hfill), as
// in the PDF: at the right of its block, inside it, and starting at the
// left when it takes more than a line. The block is the line, paragraph,
// heading, caption, or algorithmicx line (a separate div). The line's
// first letter, picture, or formula must be at the left, past the
// first-line indent.
// Failures: [the rest's first words, what is wrong]
const filled = `(() => {
  const wrong = [];
  // a letter's box, and the text nodes an element shows outside its math
  const letter = (node, i) => {
    const range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    return range.getBoundingClientRect();
  };
  const shown = el => {
    const nodes = [];
    for (const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); walk.nextNode();) {
      const node = walk.currentNode;
      if (/\\S/.test(node.data) && !node.parentElement.closest('mjx-container, .tex8web-permalink')) nodes.push(node);
    }
    return nodes;
  };
  // (whether what a node is in is positioned out of the block's flow)
  const outOfFlow = (node, block) => {
    for (let el = node.parentElement; el && el !== block; el = el.parentElement) {
      if (getComputedStyle(el).position === 'absolute') return true;
    }
    return false;
  };
  const floats = [...document.querySelectorAll('.tex8web-hfill')].filter(rest => !rest.closest('.tableofcontents'));
  for (const rest of floats) {
    const block = rest.parentElement.closest('.tex8web-hfill-line, p, h1, h2, h3, h4, h5, h6, .caption, .algorithmic > * > :last-child');
    const name = rest.textContent.replace(/\\s+/g, ' ').trim().slice(0, 30);
    if (!block) {
      wrong.push([name, 'in no paragraph, heading, or caption']);
      continue;
    }
    const style = getComputedStyle(block), box = block.getBoundingClientRect(), at = rest.getBoundingClientRect();
    const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const right = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    if (Math.abs(at.right - right) > 0.5) wrong.push([name, 'not at the right']);
    if (at.bottom > box.bottom + 0.5) wrong.push([name, 'below its block']);
    // (more than a line: its first and last letters a line apart)
    const text = shown(rest), last = text.at(-1);
    if (text.length && letter(last, last.data.trimEnd().length - 1).top - letter(text[0], text[0].data.search(/\\S/)).top
        > parseFloat(style.fontSize) && Math.abs(at.left - left) > 0.5) {
      wrong.push([name, 'its lines not at the left']);
    }
    // (what the line shows first, in its flow: not a line number set in the
    // margin, as algorithm2e's are)
    const first = [...block.querySelectorAll('img, mjx-container'), ...shown(block)]
      .filter(node => !node.parentElement.closest('mjx-container') && !outOfFlow(node, block)
        && node.compareDocumentPosition(rest) & Node.DOCUMENT_POSITION_FOLLOWING)
      .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      .map(node => node.nodeType === Node.TEXT_NODE ? letter(node, node.data.search(/\\S/)) : node.getBoundingClientRect())[0];
    if (first && Math.abs(first.left - left - parseFloat(style.textIndent)) > 0.5) {
      wrong.push([name, 'its line starts ' + (first.left - left).toFixed(1) + 'px in']);
    }
  }
  return { checked: floats.length, wrong };
})()`;

// Each list label on the baseline of its text's first line, as in LaTeX,
// or at the top beside a display that starts the text. Each baseline is
// found with a zero-size inline-block, put in the label and at the start
// of the text's first line, past blocks of no height. The blocks are
// removed again before the screens. Failures: [the text, what is wrong]
const labeled = `(() => {
  const wrong = [];
  let checked = 0;
  // (past a table's columns, which hold no lines)
  const first = node => [...node.childNodes].find(n => n.nodeType === Node.TEXT_NODE ? n.data.trim()
    : n.nodeType === Node.ELEMENT_NODE && n.getBoundingClientRect().height > 0
      && !getComputedStyle(n).display.startsWith('table-column'));
  const block = n => n?.nodeType === Node.ELEMENT_NODE && !getComputedStyle(n).display.startsWith('inline');
  for (const item of document.querySelectorAll('.tex8web-list > *')) {
    const label = item.firstElementChild, text = item.lastElementChild;
    if (!item.checkVisibility() || !label.getBoundingClientRect().height) continue;
    let line = text, next;
    // (and into an inline that starts with a block, as MathJax's display,
    // but not into an inline block, whose lines are not the text's)
    while ((next = first(line)) && (block(next) || next.nodeType === Node.ELEMENT_NODE
      && getComputedStyle(next).display === 'inline' && block(first(next)))) line = next;
    checked++;
    const name = text.textContent.trim().replace(/\\s+/g, ' ').slice(0, 30);
    if (line.closest('mjx-container[display]')) {
      const below = label.getBoundingClientRect().top - text.getBoundingClientRect().top;
      if (Math.abs(below) > 0.5) wrong.push([name, 'the label ' + below.toFixed(1) + 'px below the top of a display']);
      continue;
    }
    const probes = [label, line].map(parent => {
      // (an element of no other kind, which no rule's selector counts)
      const probe = document.createElement('tex8web-probe');
      probe.style.cssText = 'display: inline-block; width: 0; height: 0';
      parent === label ? parent.append(probe) : parent.prepend(probe);
      return probe;
    });
    const [a, b] = probes.map(probe => probe.getBoundingClientRect().bottom);
    probes.forEach(probe => probe.remove());
    if (Math.abs(a - b) > 0.5) wrong.push([name, 'the label ' + Math.abs(a - b).toFixed(1) + 'px ' + (a > b ? 'below' : 'above') + ' its baseline']);
  }
  return { checked, wrong };
})()`;

// Each shown tie (text.lua) as wide as a space in its font, as in TeX,
// within 0.005em for rounding, measured in inline-blocks beside it, which
// are not justified. A copy of the tie between two letters in a box of no
// width must keep the letters on one line.
// Failures: [the text around the tie, what is wrong]
const ties = `(() => {
  const broken = span => {
    const box = document.createElement('tex8web-probe');
    box.style.cssText = 'display: block; width: 0';
    box.append('x', span.cloneNode(true), 'x');
    document.body.append(box);
    const [a, b] = [box.firstChild, box.lastChild].map(node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().top;
    });
    box.remove();
    return a !== b;
  };
  const spans = [...document.querySelectorAll('.tex8web-nbsp')].filter(span => span.getClientRects().length);
  const wrong = spans.flatMap(span => {
    const tie = span.cloneNode(true), space = document.createElement('tex8web-probe');
    space.textContent = ' ';
    tie.style.display = 'inline-block';
    space.style.cssText = 'display: inline-block; white-space: pre';
    span.after(tie, space);
    const [a, b] = [tie, space].map(probe => probe.getBoundingClientRect().width);
    tie.remove();
    space.remove();
    const text = span.closest(':not(.tex8web-nbsp, .tex8web-nowrap)').textContent.replace(/\\s+/g, ' ').trim().slice(0, 30);
    const font = getComputedStyle(span).fontFamily.split(',')[0];
    return [
      ...Math.abs(a - b) > 0.005 * parseFloat(getComputedStyle(span).fontSize)
        ? [[text, \`\${a.toFixed(2)}px wide in \${font}, a space \${b.toFixed(2)}px\`]] : [],
      ...broken(span) ? [[text, 'a line breaks after it']] : [],
    ];
  });
  return { checked: spans.length, wrong };
})()`;

// The weight and style of each TS1 symbol's span, of a class such as
// ts1-lmbx10-, against the text's span of the same font, ec-lmbx-10. A
// magnified font's classes end in its magnification, as ts1-lmbx10-x-x-109
// and ec-lmbx-10x-x-109 in an 11pt document. In bold or italic text the
// PDF draws the symbol bold or italic too.
const symbolFaces = `(() => {
  const face = el => getComputedStyle(el).fontWeight + ' ' + getComputedStyle(el).fontStyle;
  const pairs = [...document.querySelectorAll('span[class^="ts1-"]')].flatMap(span => {
    const [, name, size, mag = ''] = span.className.match(/^ts1-(.*\\D)(\\d+)-(x-x-\\d+)?$/) ?? [];
    const text = name && document.querySelector(\`span.ec-\${name}-\${size}\${mag}\`);
    return text ? [[span, text]] : [];
  });
  return { checked: pairs.length, wrong: pairs.filter(([span, text]) => face(span) !== face(text))
    .map(([span, text]) => [span.className, face(span), face(text)]) };
})()`;

// Each \lefteqn (MathJax's \rlap: an mjx-mpadded around a block of no
// width) adds no width: its content is wider than its cell, or, outside an
// alignment, what follows it starts at the box. Its content starts at the
// box, ends before the equation numbers beside it, also those of a table
// around its own, and can be scrolled to in a display too wide for its
// column, which scrolls no more than an em past its last character. In an
// alignment, a box alone in its cell is at the edge of the
// cell that the column's alignment gives, as in the PDF: the right edge in
// eqnarray's first column, the left edge in its third. A table with
// numbers stays centered while the content of its boxes beside the numbers
// ends an em before them, as in the PDF. Checked with JavaScript off and
// on a phone. laps has the number of boxes on each page checked. Failures:
// [the box's text, what is wrong]
const lapped = `(() => {
  // (\\llap's box moves its content left, in an mjx-rbox, and a box of
  // \\vphantom or \\mathstrut holds an mjx-mphantom, which draws nothing)
  const boxes = [...document.querySelectorAll('mjx-mpadded')]
    .filter(box => !box.querySelector(':scope > mjx-block > :is(mjx-rbox, mjx-mphantom)'));
  const numbers = table => [...table.querySelectorAll(':scope > mjx-labels mjx-mtd')].map(label => {
    const number = document.createRange();
    number.selectNodeContents(label);
    return [label.textContent, number.getBoundingClientRect()];
  }).filter(([, n]) => n.width);
  const beside = (content, n) => n.top < content.bottom && content.top < n.bottom;
  const wrong = boxes.flatMap(box => {
    const text = box.textContent.slice(0, 20);
    const at = box.getBoundingClientRect(), content = box.firstElementChild.firstElementChild.getBoundingClientRect();
    const problems = [];
    if (Math.abs(content.left - at.left) > 0.5) problems.push(\`content at \${(content.left - at.left).toFixed(2)}px from the box\`);
    const cell = box.closest('mjx-mtd');
    if (cell?.textContent === box.textContent) {
      const rect = cell.getBoundingClientRect(), style = getComputedStyle(cell);
      const left = rect.left + parseFloat(style.paddingLeft), right = rect.right - parseFloat(style.paddingRight);
      const edge = /right|end/.test(style.textAlign) ? right : left;
      if (Math.abs(at.left - edge) > 0.5) problems.push(\`\${(at.left - edge).toFixed(2)}px from its cell's edge\`);
      // (the columns of a table as wide as the line, as in multline, are
      // not sized by their content)
      const full = box.closest('mjx-mtable').hasAttribute('data-width-includes-label');
      if (!full && content.width < right - left + 0.5) problems.push(\`its cell \${(right - left).toFixed(2)}px wide holds its content \${content.width.toFixed(2)}px wide\`);
    } else if (!cell) {
      // (past the group around the box, which only MathJax in a browser keeps)
      const group = box.parentElement.matches('mjx-texatom') && !box.nextElementSibling ? box.parentElement : box;
      const next = group.nextElementSibling?.getBoundingClientRect();
      if (!next || Math.abs(next.left - at.left) > 0.5) problems.push(next ? \`what follows at \${(next.left - at.left).toFixed(2)}px from the box\` : 'nothing after it');
    }
    for (let table = box.closest('mjx-mtable'); table; table = table.parentElement.closest('mjx-mtable')) {
      for (const [label, n] of numbers(table)) {
        if (beside(content, n) && content.right > n.left + 0.5) problems.push(\`runs \${(content.right - n.left).toFixed(2)}px under its number \${label}\`);
      }
    }
    const scroller = box.closest('mjx-container[display]');
    const end = scroller && content.right - scroller.getBoundingClientRect().left + scroller.scrollLeft;
    if (scroller && end > scroller.scrollWidth + 0.5) problems.push(\`ends \${(end - scroller.scrollWidth).toFixed(2)}px past where its display scrolls\`);
    if (scroller) {
      const left = scroller.getBoundingClientRect().left - scroller.scrollLeft;
      const last = Math.max(scroller.clientWidth, ...[...scroller.querySelectorAll('mjx-c')].map(c => c.getBoundingClientRect().right - left));
      const em = parseFloat(getComputedStyle(scroller).fontSize);
      if (scroller.scrollWidth > last + em) problems.push(\`its display scrolls \${(scroller.scrollWidth - last).toFixed(2)}px past its last character\`);
    }
    return problems.map(what => [text, what]);
  });
  for (const table of document.querySelectorAll('mjx-mtable:has(> mjx-labels):has(mjx-mpadded)')) {
    const rect = table.getBoundingClientRect(), inner = table.querySelector(':scope > mjx-table > mjx-itable').getBoundingClientRect();
    const shift = (inner.left + inner.right - rect.left - rect.right) / 2;
    const near = numbers(table), em = parseFloat(getComputedStyle(table).fontSize);
    const reach = Math.max(inner.right, ...boxes.filter(box => table.contains(box))
      .map(box => box.firstElementChild.firstElementChild.getBoundingClientRect())
      .filter(content => near.some(([, n]) => beside(content, n))).map(content => content.right));
    if (inner.left - shift >= rect.left && near.every(([, n]) => reach - shift < n.left - em) && Math.abs(shift) > 0.5) {
      wrong.push([table.textContent.slice(0, 20), \`its table \${shift.toFixed(2)}px from the center\`]);
    }
  }
  return { checked: boxes.length, wrong };
})()`;
const laps = { 'test-lefteqn': 18 };

// Latin Modern Math as in the PDF (js/tex8web.js, matchModernFont): the
// font of the first character of each formula given, and none of
// mathjax-modern's own calligraphic letters; the center of each accent but
// those built from pieces, from its base's left edge, in ems, as placed by
// MathJax with New Computer Modern's skews; the paragraph of a √ in text,
// one line, in px, as tall as a line of text, the gap below a text √ over a
// fraction bar, at most as given, and the drop of a text √'s subscript;
// each inline formula given as wide as in the PDF (TeX's \wd of its box, in
// ems); ⋮ and ⋱, each one dot drawn with two text shadows, in a box as high
// as in the PDF; the ( of the two inline formulas before the last four, as
// high as in the PDF; the delimiters of the inline formula before those,
// each built from pieces, with their heights in ems; each glyph of a
// delimiter or large operator from the TeX font's sizes, with its height
// and width in ems; and the bars of the last four inline formulas, those
// taller than a glyph built from pieces, with their heights and widths in
// ems.
// Failures: [what, got, want]
const modernFont = want => `(() => {
  const want = ${JSON.stringify(want)}, wrong = [], em = el => parseFloat(getComputedStyle(el).fontSize);
  const off = (got, value) => Math.abs(got - value) > 0.01;
  const formulas = [...document.querySelectorAll('mjx-container:not([display])')];
  want.fonts.forEach((font, i) => {
    const c = formulas[i]?.querySelector('mjx-c');
    if (!c?.classList.contains(font)) wrong.push([\`formula \${i + 1}\`, c?.className, font]);
  });
  const own = document.querySelectorAll('mjx-c.MM-C, mjx-c.MM-CB').length;
  if (own) wrong.push(["mathjax-modern's calligraphic letters", own, 0]);
  const accents = [...document.querySelectorAll('mjx-mover')].filter(m => !m.querySelector('mjx-over mjx-stretchy-h')).map(m => {
    const base = m.querySelector('mjx-base').getBoundingClientRect(), accent = m.querySelector('mjx-over mjx-c').getBoundingClientRect();
    return [m.textContent, ((accent.left + accent.right) / 2 - base.left) / em(m)];
  });
  if (accents.length !== want.accents.length) wrong.push(['accents', accents.length, want.accents.length]);
  accents.forEach(([text, got], i) => { if (off(got, want.accents[i])) wrong.push([text, got.toFixed(3), want.accents[i]]); });
  for (const [i, value] of want.widths) {
    const got = formulas[i] && formulas[i].getBoundingClientRect().width / em(formulas[i]);
    if (!formulas[i] || off(got, value)) wrong.push([\`formula \${i + 1}\`, got?.toFixed(3), value]);
  }
  const dots = [...document.querySelectorAll('mjx-c.mjx-c22EE, mjx-c.mjx-c22F1')];
  if (dots.length !== 3) wrong.push(['⋮ and ⋱', dots.length, 3]);
  for (const c of dots) {
    const shadows = getComputedStyle(c).textShadow.split(/,(?![^(]*\\))/).length;
    if (shadows !== 2) wrong.push([c.className + ' shadows', shadows, 2]);
    const height = c.getBoundingClientRect().height / em(c);
    if (off(height, want.dots)) wrong.push([c.className + ' height', height.toFixed(3), want.dots]);
  }
  // (a bar is an mjx-mo, or its mjx-c where prerendering left no mjx-mo)
  const bars = formulas.slice(-4).flatMap(m => [...m.querySelectorAll('mjx-mo, mjx-c')]
    .filter(el => /^[|‖∣∥]+$/.test(el.textContent.replace(/\\s/g, '')) && !el.parentElement.closest('mjx-mo'))
    .map(el => {
      const box = el.querySelector('mjx-stretchy-v') ?? (el.matches('mjx-mo') ? el.querySelector('mjx-c') : el);
      return [box.matches('mjx-stretchy-v'), el.getBoundingClientRect().height / em(m), box.getBoundingClientRect().width / em(m)];
    }));
  if (bars.length !== want.bars.length) wrong.push(['bars', bars.length, want.bars.length]);
  bars.forEach(([built, height, width], i) => {
    const [tall, wide] = want.bars[i];
    if (built !== tall > 1.01) wrong.push([\`bar \${i + 1}\`, built ? 'built' : 'a glyph', built ? 'a glyph' : 'built']);
    if (off(height, tall)) wrong.push([\`bar \${i + 1}'s height\`, height.toFixed(3), tall]);
    if (off(width, wide)) wrong.push([\`bar \${i + 1}'s width\`, width.toFixed(3), wide]);
  });
  const surd = document.querySelector('mjx-mtext mjx-c.mjx-c221A')?.closest('p'), line = surd?.cloneNode();
  if (line) {
    line.textContent = 'Text';
    surd.after(line);
  }
  if (!surd || Math.abs(surd.offsetHeight - line.offsetHeight) > 0.5) wrong.push(["the text √'s line", surd?.offsetHeight, line?.offsetHeight]);
  line?.remove();
  const surds = [...document.querySelectorAll('mjx-mtext mjx-c.mjx-c221A')];
  const over = surds.find(c => c.closest('mjx-mfrac')), base = surds.find(c => c.closest('mjx-mtext').nextElementSibling);
  if (over) {
    const gap = (over.closest('mjx-mfrac').querySelector('mjx-line').getBoundingClientRect().top - over.getBoundingClientRect().bottom) / em(over);
    if (gap < 0 || gap > want.surd[0]) wrong.push(['the gap below a text √ over a fraction bar', gap.toFixed(3), \`0 to \${want.surd[0]}\`]);
  } else wrong.push(['a text √ over a fraction bar', 'none', 'one']);
  if (base) {
    const math = base.closest('mjx-math'), script = base.closest('mjx-mtext').nextElementSibling, mark = document.createElement('span');
    mark.style.cssText = 'display: inline-block; width: 0; height: 0';
    math.append(mark);
    const drop = ((script.matches('mjx-c') ? script : script.querySelector('mjx-c')).getBoundingClientRect().bottom
      - mark.getBoundingClientRect().bottom) / em(math);
    mark.remove();
    if (off(drop, want.surd[1])) wrong.push(["a text √'s subscript, below the baseline", drop.toFixed(3), want.surd[1]]);
  } else wrong.push(['a text √ with a subscript', 'none', 'one']);
  const parens = formulas.slice(-6, -4).map(m => m.querySelector('mjx-c.mjx-c28'));
  parens.forEach((c, i) => {
    const got = c && c.getBoundingClientRect().height / em(c);
    if (!c || off(got, want.parens[i])) wrong.push([\`( \${i + 1}\`, got?.toFixed(3), want.parens[i]]);
  });
  const sized = [...document.querySelectorAll('mjx-c.TEX-SO, mjx-c.TEX-LO, mjx-c.TEX-S3, mjx-c.TEX-S4')]
    .filter(c => !c.closest('mjx-stretchy-h, mjx-stretchy-v') && !/[ˆ˜]/.test(c.textContent))
    .map(c => [c.textContent, c.getBoundingClientRect().height / em(c), c.getBoundingClientRect().width / em(c)]);
  if (sized.length !== want.cmex.length) wrong.push(["the TeX font's sizes", sized.length, want.cmex.length]);
  sized.forEach(([text, tall, wide], i) => {
    const [height, width] = want.cmex[i] ?? [];
    if (off(tall, height)) wrong.push([\`\${text} \${i + 1}'s height\`, tall.toFixed(3), height]);
    if (off(wide, width)) wrong.push([\`\${text} \${i + 1}'s width\`, wide.toFixed(3), width]);
  });
  const built = formulas.at(-7)?.querySelectorAll('mjx-mo') ?? [];
  if (built.length !== want.built.length) wrong.push(['delimiters built from pieces', built.length, want.built.length]);
  [...built].forEach((mo, i) => {
    const got = mo.getBoundingClientRect().height / em(mo);
    if (!mo.querySelector('mjx-stretchy-v')) wrong.push([\`delimiter \${i + 1}\`, 'a glyph', 'built']);
    if (off(got, want.built[i])) wrong.push([\`delimiter \${i + 1}'s height\`, got.toFixed(3), want.built[i]]);
  });
  return wrong;
})()`;
const modernFonts = {
  'test-mathfont': {
    // (of the first three inline formulas: \mathbb{R}, \mathcal{A}, and
    // its bold)
    fonts: ['NCM-DS', 'TEX-C', 'TEX-CB'],
    // (as MathJax places \hat a, \hat x, \vec a, \hat A, \hat over
    // \mathsf A, \mathtt E, \mathfrak A, \mathbb A, and a bold sans-serif
    // Σ, \widehat{ab}, \widetilde{xyz}, and \bar y, measured on the
    // page: TeX's rule differs)
    accents: [0.286, 0.328, 0.286, 0.55, 0.334, 0.263, 0.443, 0.347, 0.396, 0.479, 0.764, 0.304],
    // (the four inline formulas of dots, and \overrightarrow{AB} and
    // \overleftarrow{AB}, each by its index)
    widths: [[16, 4.267], [17, 4.569], [18, 3.322], [19, 4.569], [26, 1.509], [27, 1.509]],
    // (below a text √: the most gap to a fraction bar, where TeX's is
    // 0.034 and the page's 0.06 to 0.084 by where the line falls on the
    // pixels, and the drop of its subscript, measured on the page, where
    // TeX's is 0.26)
    surd: [0.1, 0.234],
    // (the height of \vdots's and \ddots's boxes, which have no depth)
    dots: 1.506,
    // (each bar's height and width: of \bigm|, \| around a fraction,
    // \Bigl\| and \Bigr\|, and \lVert and \rVert. The heights are
    // measured on the page, where TeX's are 1.2, 1.2, 1.8, and 1em; the
    // widths are TeX's, cmex's built bars and cmsy's ‖)
    bars: [[1.229, .333], [1.205, .556], [1.205, .556], [1.829, .556], [1.829, .556], [1, .5], [1, .5]],
    // (of \left( around an inline fraction and of a two-row pmatrix: TeX's
    // \ht plus \dp)
    parens: [1.2, 2.4],
    // (of \big\uparrow, \Big\Downarrow, and \Big\lgroup, measured on
    // the page, where TeX's are 1.2, 1.8, and 1.8)
    built: [1.189, 1.789, 1.789],
    // (each glyph of a delimiter or large operator from the TeX font's
    // sizes, in the page's order: \Bigg[, \Bigl( and \Bigr), \Bigg], the
    // display ∫, the cases' {, and ( and ) around an inline fraction and a
    // two-row pmatrix; cmex's heights and widths, the ∫'s with its italic
    // correction, which TeX's box has without a subscript)
    cmex: [[2.999, .583], [1.799, .597], [1.799, .597], [2.999, .583], [2.222, .944], [2.999, .806],
      [1.199, .458], [1.199, .458], [2.399, .736], [2.399, .736]],
  },
};

// dcolumn's D columns: in each column of a table, the numbers line up on
// their separators as in the PDF, and an integer ends where the
// separators start. A cell is a number if its text is digits with at most
// a minus, parentheses, one separator, and stars after it. The separator
// is the first one after dcolumn's part before it (tex8web-dc-int), and no
// character of that part ends to the right of the separator. Characters set
// by MathJax are measured by their mjx-c boxes, without the hidden MathML
// copy. Each digit is upright, in the body's serif face, and at the size
// of the row's first cell, as math digits are in the PDF. Columns count
// the cells that a \multicolumn spans. Checked with JavaScript off.
// decimals has the number of columns with two or more numbers. Failures:
// [the first row's text, what is wrong]
const separated = `(() => {
  const chars = cell => {
    const found = [], walk = document.createTreeWalker(cell, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode;
      if ((node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement).closest('mjx-assistive-mml')) continue;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const code = node.nodeName === 'MJX-C' && [...node.classList].find(c => /^mjx-c[0-9A-F]+$/.test(c));
        if (code) found.push([String.fromCodePoint(parseInt(code.slice(5), 16)), () => node.getBoundingClientRect(), node]);
      } else if (!node.parentElement.closest('mjx-container')) {
        for (let i = 0; i < node.length; i++) if (/\\S/.test(node.data[i])) {
          const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
          found.push([node.data[i], () => range.getBoundingClientRect(), node.parentElement]);
        }
      }
    }
    return found;
  };
  const body = getComputedStyle(document.body).fontFamily;
  let checked = 0;
  const wrong = [...document.querySelectorAll('table')].flatMap(table => {
    const name = table.rows[0].textContent.trim().slice(0, 20), columns = new Map(), faults = [];
    for (const row of table.rows) {
      let column = 0;
      const size = getComputedStyle(chars(row.cells[0])[0]?.[2] || row.cells[0]).fontSize;
      for (const cell of row.cells) {
        const at = column;
        column += cell.colSpan;
        const found = chars(cell), text = found.map(([c]) => c).join('');
        if (!/^\\(?[−-]?\\d*(?:[.,⋅·]\\d*)?\\)?[∗*]*$/.test(text) || !/\\d/.test(text)) continue;
        const sep = found.find(([c, , el]) => /[.,⋅·]/.test(c) && !el.closest('.tex8web-dc-int')),
          digits = found.filter(([c]) => /\\d/.test(c));
        const over = sep && found.find(([, box, el]) => el.closest('.tex8web-dc-int') && box().right > sep[1]().left + 0.5);
        if (over) faults.push([name, \`\${text}'s \${over[0]} ends \${(over[1]().right - sep[1]().left).toFixed(1)}px right of its separator\`]);
        columns.set(at, [...columns.get(at) || [], [text, sep ? sep[1]().left : digits[digits.length - 1][1]().right]]);
        for (const [c, , el] of digits) {
          const style = getComputedStyle(el);
          if (style.fontSize !== size || style.fontStyle !== 'normal' || style.fontFamily !== body) {
            faults.push([name, \`\${text}'s \${c} is \${style.fontStyle} \${style.fontSize} \${style.fontFamily}, not normal \${size} \${body}\`]);
            break;
          }
        }
      }
    }
    return [...faults, ...[...columns.values()].filter(cells => cells.length > 1).flatMap(cells => {
      checked++;
      const [first, x] = cells[0];
      return cells.filter(([, y]) => Math.abs(y - x) > 0.5)
        .map(([text, y]) => [name, \`\${text}'s separator \${(y - x).toFixed(1)}px from \${first}'s\`]);
    })];
  });
  return { checked, wrong };
})()`;
const decimals = { 'test-dcolumn': 19, 'test-dcolumn-hyperref': 1 };

// Each picture lowered below the baseline (text.lua) with the share of its
// height below the baseline that it has in the PDF, also where the picture
// is shrunk to the column. The baseline is found with a zero-size
// inline-block right after the picture, on the picture's line. Checked
// with JavaScript off, on a wide screen and on a phone. hangs has the
// shares in the page's order. Failures: [the picture, what is wrong]
const hung = `(shares => {
  const pictures = [...document.querySelectorAll('img[style*="vertical-align"]')];
  const wrong = pictures.flatMap((img, i) => {
    const probe = document.createElement('tex8web-probe');
    probe.style.cssText = 'display: inline-block; width: 0; height: 0';
    img.after(probe);
    const box = img.getBoundingClientRect(), below = box.bottom - probe.getBoundingClientRect().bottom;
    probe.remove();
    const want = shares[i] * box.height;
    return Math.abs(below - want) > 0.5
      ? [[img.alt || img.getAttribute('src'), \`\${below.toFixed(1)}px of \${box.height.toFixed(1)}px below the baseline, not \${want.toFixed(1)}px\`]] : [];
  });
  return { checked: pictures.length, wrong };
})`;
const hangs = { 'test-turned-over': [1, 1, 0.25, 0.75, 1, 1, 1, 1] };
// In dark mode, the pictures drawn as SVG that hold an \includegraphics
// are shown as they are, on white, and the other such pictures are
// inverted: how many of each (test-boxgfx.tex). In light mode, the first
// have no background, as a box behind them may have a color.
const darkPictures = { 'test-boxgfx': [16, 2] };
// The graphics that are not clipped in the pictures that hold them, each
// inside its picture, after any rotation or scale, with each SVG put in a
// blank page: how many (test-boxgfx.tex)
const graphicsInside = { 'test-boxgfx': 14 };
const graphicOutside = svg => `(() => {
  document.body.innerHTML = ${JSON.stringify(svg)};
  const root = document.body.firstElementChild.getBoundingClientRect();
  return [...document.querySelectorAll("svg[overflow='visible'] > image")].map(image => {
    const box = image.getBoundingClientRect();
    return box.left < root.left - 0.5 || box.top < root.top - 0.5 || box.right > root.right + 0.5 || box.bottom > root.bottom + 0.5;
  });
})()`;
const darkSeen = `[...document.images].filter(img => /\\d+x\\.svg$/.test(img.getAttribute('src'))).map(img => {
  const style = getComputedStyle(img);
  return [img.classList.contains('tex8web-graphic'), style.filter, style.backgroundColor];
})`;
async function hanging(page, doc, where) {
  const shares = hangs[doc.name];
  const { checked, wrong } = await page.evaluate(`${hung}(${JSON.stringify(shares)})`);
  return [...checked === shares.length ? [] : [`${where}: ${checked} lowered pictures, not ${shares.length}`],
    ...wrong.map(([name, what]) => `${where}: the picture ${name}: ${what}`)];
}

// Each picture alone in display math, centered in the column as in the
// PDF, within 0.5px, and not lowered or raised, or left of center beside
// a wide mark. An equation number or QED box after the picture is at the
// column's right, on the picture's bottom line, and a QED box under a
// number is in the display, at the right. centers has the numbers of such
// pictures and of the marks after them. Failures: [the picture, what is
// wrong]
const centered = `(() => {
  const column = document.querySelector('main') ?? document.body, style = getComputedStyle(column);
  const box = column.getBoundingClientRect();
  const middle = (box.left + parseFloat(style.paddingLeft) + box.right - parseFloat(style.paddingRight)) / 2;
  const pictures = [...document.querySelectorAll(':is(.mathjax-block, .mathjax-env) img')];
  let marks = 0;
  const wrong = pictures.flatMap(img => {
    // (a period or comma after the picture is centered with it, on its bottom line)
    const punct = img.nextElementSibling?.matches('.tex8web-picture-punct') && img.nextElementSibling;
    const at = img.getBoundingClientRect(), until = punct ? punct.getBoundingClientRect() : at;
    const off = (at.left + until.right) / 2 - middle;
    const name = img.alt || img.getAttribute('src');
    const next = punct ? punct.nextElementSibling : img.nextElementSibling;
    const mark = next?.matches('.tex8web-picture-tag, .tex8web-qed') && next.getBoundingClientRect();
    if (mark) marks++;
    // (a picture beside a wide mark may be left of center, up to 1em from the mark)
    const em = parseFloat(getComputedStyle(img.parentElement).fontSize);
    const moved = mark && off < 0 && mark.left - at.right < em + 0.5;
    // every mark after the picture, in the display's box
    const block = img.parentElement.getBoundingClientRect();
    const after = [...img.parentElement.querySelectorAll(':scope > img ~ :is(.tex8web-picture-tag, .tex8web-qed)')];
    return [...Math.abs(off) > 0.5 && !moved ? [[name, \`its center \${off.toFixed(1)}px from the column's\`]] : [],
      ...after.filter(e => e.getBoundingClientRect().bottom > block.bottom + 0.5 || e.getBoundingClientRect().right > box.right - parseFloat(style.paddingRight) + 0.5)
        .map(e => [name, \`its \${e.className} is outside the display\`]),
      ...after.filter(e => Math.abs(e.getBoundingClientRect().right - (box.right - parseFloat(style.paddingRight))) > 0.5)
        .map(e => [name, \`its \${e.className} is not at the right\`]),
      ...img.style.verticalAlign ? [[name, \`vertical-align \${img.style.verticalAlign}\`]] : [],
      ...punct && (until.bottom < at.bottom - 0.5 || until.bottom - at.bottom > until.height / 2 || until.left < at.right - 0.5 || until.left > at.right + 1) ? [[name, 'the punctuation after it is not at its bottom right']] : [],
      ...mark && Math.abs(mark.bottom - at.bottom) > 0.5 ? [[name, \`the mark after it ends \${(mark.bottom - at.bottom).toFixed(1)}px below its bottom\`]] : [],
      ...mark && Math.abs(mark.right - (box.right - parseFloat(style.paddingRight))) > 0.5 ? [[name, 'the mark after it is not at the right']] : [],
      ...mark && mark.left < until.right - 0.5 ? [[name, \`the mark after it covers it by \${(until.right - mark.left).toFixed(1)}px\`]] : []];
  });
  return { checked: [pictures.length, marks], wrong };
})()`;
const centers = { 'test-display-picture': [41, 15], 'test-display-picture-hyperref': [5, 2] };
// Each display, table, and verbatim block (css/tex8web.css) in the
// column: as wide as the block around it, so not narrowed by a footnote
// floated beside it, and nothing shown past the column's right edge or
// over a footnote. One wider than the column scrolls sideways, with its
// left end shown before it is scrolled, and none scrolls up and down. One
// in a center that is wider than the column starts at the column's left
// edge. A centered tabular that fits stays centered. Checked with
// JavaScript off, on a wide screen and on a phone. wideBlocks has, at each
// width, the number of blocks wider than the column and the number of
// claps in a display that keep their zero width (js/tex8web.js widens a
// clap around a whole display). Failures: [the block's number, its text,
// what is wrong]
const scrollers = `(() => {
  const style = getComputedStyle(document.body), body = document.body.getBoundingClientRect();
  const left = body.left + parseFloat(style.paddingLeft), right = body.right - parseFloat(style.paddingRight);
  const notes = [...document.querySelectorAll('.tex8web-sidenote')].map(note => note.getBoundingClientRect());
  const blocks = [...document.querySelectorAll(
    'mjx-container[display], div.tabular, div.longtable, pre, div.alltt, div.verbatiminput, div.listing, div.listinginput, '
    + 'div.verbatimtabinput')];
  let wide = 0, claps = 0;
  const wrong = blocks.flatMap((block, i) => {
    const name = block.textContent.trim().slice(0, 20), problems = [];
    claps += [...block.querySelectorAll('mjx-mpadded')]
      .filter(clap => clap.getBoundingClientRect().width < 0.5 && clap.querySelector('mjx-c')).length;
    const box = block.getBoundingClientRect(), outer = block.parentElement.getBoundingClientRect();
    const around = getComputedStyle(block.parentElement);
    if (Math.abs(box.left - outer.left - parseFloat(around.paddingLeft)) > 0.5
        || Math.abs(outer.right - parseFloat(around.paddingRight) - box.right) > 0.5) {
      problems.push(\`at \${box.left.toFixed(1)} to \${box.right.toFixed(1)}px in a block at \${outer.left.toFixed(1)} to \${outer.right.toFixed(1)}px\`);
    }
    // the content's boxes: its elements and its text
    const rects = [...block.querySelectorAll('*')].map(el => el.getBoundingClientRect());
    const text = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (text.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(text.currentNode);
      rects.push(...range.getClientRects());
    }
    const content = rects.filter(r => r.width);
    const shown = getComputedStyle(block).overflowX === 'visible'
      ? Math.max(box.right, ...content.map(r => r.right)) : box.right;
    if (shown > right + 0.5) problems.push(\`shown \${(shown - right).toFixed(1)}px past the column\`);
    if (notes.some(note => note.left < shown - 0.5 && box.left < note.right && note.top < box.bottom && box.top < note.bottom)) {
      problems.push('over a footnote');
    }
    if (block.scrollWidth > block.clientWidth) {
      wide++;
      const start = Math.min(...content.map(r => r.left));
      if (start < box.left - 0.5) problems.push(\`its left end \${(box.left - start).toFixed(1)}px left of it, out of reach\`);
      if (block.closest('div.center') && Math.abs(box.left - left) > 0.5) {
        problems.push(\`in a center, \${(box.left - left).toFixed(1)}px from the column's left edge\`);
      }
    }
    block.scrollTop = block.scrollHeight;
    if (block.scrollTop) problems.push(\`scrolls \${block.scrollTop}px down\`);
    block.scrollTop = 0;
    const table = block.querySelector(':scope > table.tex8web-center');
    if (table && table.offsetWidth < block.clientWidth) {
      const at = table.getBoundingClientRect(), off = (at.left + at.right - box.left - box.right) / 2;
      if (Math.abs(off) > 0.5) problems.push(\`its table \${off.toFixed(1)}px from the center\`);
    }
    return problems.map(what => [i + 1, name, what]);
  });
  return { checked: [blocks.length, wide, claps], wrong };
})()`;
const wideBlocks = { 'test-wideblocks': { 1400: [7, 1], 390: [10, 1] } };
// Each part and chapter-level heading below the text above it. In the
// PDF such a heading starts a page, so a negative space above it from
// \titlespacing moves it up only from the page's top margin. The heading's
// box starts below the last box above it with a height that is not
// floated, as a footnote beside the text is, by a chapter's default space
// (0.83em of its font) or for a part half the text's em, so that the break
// shows. With no such box, it starts
// at or below the top of its column, and below the body's top margin,
// which clears the controls. Checked with JavaScript off, on a wide
// screen, at 1000px, where the page has no side column for its notes, on
// a phone, and in print. chapterHeads has the number of such headings.
// Failures: [the heading's id, what is wrong]
const chapterHeadSelector = ':is(h1, h2):is(.partHead, .likepartHead, .chapterHead, .likechapterHead, .appendixHead)';
const chapterGaps = `(() => {
  const heads = [...document.querySelectorAll('${chapterHeadSelector}')];
  const wrong = heads.flatMap(h => {
    let above = h.previousElementSibling;
    while (above && (!above.getBoundingClientRect().height || getComputedStyle(above).float !== 'none')) {
      above = above.previousElementSibling;
    }
    const column = h.parentElement.getBoundingClientRect();
    const limit = above ? above.getBoundingClientRect().bottom
      : Math.max(column.top + parseFloat(getComputedStyle(h.parentElement).paddingTop),
        parseFloat(getComputedStyle(document.body).marginTop) - scrollY);
    const top = h.getBoundingClientRect().top;
    if (top < limit - 0.5) {
      return [[h.id, \`starts \${(limit - top).toFixed(1)}px above the bottom of \${above ? 'the ' + above.localName + ' above it' : 'its column'}\`]];
    }
    if (!above) return [];
    // (a chapter's space above is at least the stylesheet's, 0.83em of its
    // font, as for a chapter style whose space is less; a part's at least half
    // the text's em)
    const chapter = !h.matches('.partHead, .likepartHead');
    const least = chapter ? 0.83 * parseFloat(getComputedStyle(h).fontSize) - 0.5
      : parseFloat(getComputedStyle(document.body).fontSize) / 2;
    return top - limit < least
      ? [[h.id, \`starts \${(top - limit).toFixed(1)}px below the \${above.localName} above it, less than \${least.toFixed(1)}px\`]] : [];
  });
  return { checked: heads.length, wrong };
})()`;
// A link to each such heading, on a wide screen with the page script:
// the heading, as the link's target, is in view from its top when
// scrolled to the top of the window, as its space above
// (scroll-margin-top) is not negative. Failures: [the heading's id, what
// is wrong]
const chapterLanding = `(() => {
  // (room below the last heading, so that each one can reach the window's top)
  const room = document.createElement('div');
  room.style.height = 2 * innerHeight + 'px';
  document.body.append(room);
  const wrong = [...document.querySelectorAll('${chapterHeadSelector}')].flatMap(h => {
    location.hash = h.id;
    h.scrollIntoView();
    const top = h.getBoundingClientRect().top;
    return top < -0.5 ? [[h.id, \`starts \${(-top).toFixed(1)}px above the window after a link to it\`]] : [];
  });
  return wrong;
})()`;
const chapterHeads = { 'test-chapneg': 11, 'test-chapneg-hyperref': 11, 'test-chapneg-zero': 11 };
// Description lists after footnotes beside the text, on a wide screen
// with the page script, which stacks the footnotes. Each list's box, each
// label's box, and its text's first line are the same within 0.5px with
// the footnotes hidden, as CSS places a float, such as a label, no higher
// than an earlier float, and so are the text after an \hfill and a
// proof's QED box. Each footnote is level with its mark or below the
// footnote above it, all start at the same left, and the page ends below
// the last one and its space. A list inside a footnote is not measured.
// descLabels has the number of labels, of footnotes beside the text, and
// of the other floats. Failures: [the label, float, or footnote, what is
// wrong].
const descLabeled = `(async () => {
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  const lists = [...document.querySelectorAll('dl.description')].filter(dl => !dl.closest('.tex8web-sidenote'));
  const floats = [...document.querySelectorAll('.tex8web-hfill, .tex8web-qed')];
  // (a footnote hidden by display: none keeps its computed float)
  const aside = el => el?.matches('.tex8web-sidenote') && getComputedStyle(el).float !== 'none';
  const probe = parent => {
    const p = document.createElement('tex8web-probe');
    p.style.cssText = 'display: inline-block; width: 0; height: 0';
    parent.prepend(p);
    const box = p.getBoundingClientRect();
    p.remove();
    return box;
  };
  const name = el => el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 30);
  // the block of an item's first line: past empty paragraphs, and into a
  // list, a theorem, or a quote that starts the item
  const start = dd => {
    let el = dd.querySelector(':scope > p') ?? dd;
    while (el.matches('p') && !el.textContent.trim() && el.nextElementSibling) el = el.nextElementSibling;
    while (!el.matches('p, li, dd')) {
      const first = [...el.children].find(c => c.textContent.trim());
      if (!first) break;
      el = first;
    }
    return el;
  };
  const measures = () => lists.flatMap(dl => {
    const box = dl.getBoundingClientRect();
    let next = dl.nextElementSibling;
    while (aside(next)) next = next.nextElementSibling;
    return [[name(dl.querySelector('dt')) + ' (its list)', 'the list', [box.top, box.left, box.width, box.height, next ? next.getBoundingClientRect().top : 0]],
      ...[...dl.querySelectorAll(':scope > dt')].map(dt => {
        const label = dt.getBoundingClientRect(), line = probe(start(dt.nextElementSibling));
        return [name(dt), 'the label and its line', [label.top, label.left, line.left, line.bottom]];
      })];
  }).concat(floats.map(el => {
    const box = el.getBoundingClientRect();
    return [name(el), 'the float', [box.top, box.left]];
  }));
  const wrong = [];
  const notes = [...document.querySelectorAll('.tex8web-sidenote')].filter(aside);
  let below = -Infinity, before;
  const left = notes[0]?.getBoundingClientRect().left;
  for (const note of notes) {
    const box = note.getBoundingClientRect(), back = note.querySelector('.footnote-mark a');
    const mark = document.getElementById(decodeURIComponent(back.hash.slice(1))).getBoundingClientRect().top;
    const want = Math.max(mark, below);
    if (Math.abs(box.top - want) > 0.5) wrong.push([name(note), \`the footnote at \${box.top.toFixed(1)}px, not \${want.toFixed(1)}px (\${want === mark ? 'its mark' : 'below ' + name(before)})\`]);
    if (Math.abs(box.left - left) > 0.5) wrong.push([name(note), \`the footnote \${(box.left - left).toFixed(1)}px right of the first\`]);
    // (without the room the page script gives the last footnote below it)
    const room = parseFloat(note.style.getPropertyValue('--tex8web-sidenote-room')) || 0;
    below = box.bottom + parseFloat(getComputedStyle(note).marginBottom) - room;
    before = note;
  }
  if (before && document.documentElement.scrollHeight < below + scrollY - 0.5) {
    wrong.push([name(before), \`the page ends \${(below + scrollY - document.documentElement.scrollHeight).toFixed(1)}px above the last footnote's space\`]);
  }
  const shown = measures();
  const hide = document.createElement('style');
  hide.textContent = '.tex8web-sidenote { display: none !important; }';
  document.head.append(hide);
  const hidden = measures();
  hide.remove();
  // (the footnotes take no room in the text, so hiding them moves nothing
  // above the list)
  shown.forEach(([who, what, got], i) => {
    const want = hidden[i][2];
    if (got.some((x, j) => Math.abs(x - want[j]) > 0.5)) {
      wrong.push([who, \`\${what} at \${got.map(x => x.toFixed(1)).join(', ')} beside footnotes, \${want.map(x => x.toFixed(1)).join(', ')} without them\`]);
    }
  });
  return { checked: [lists.reduce((n, dl) => n + dl.querySelectorAll(':scope > dt').length, 0), notes.length, floats.length], wrong };
})()`;
const descLabels = { 'test-desclabel': [66, 35, 2], 'test-desclabel-report': [63, 33, 1], 'test-desclabel-amsart': [66, 35, 2] };
// The pages of a PDF included with pdfpages, each a page of its own in the
// PDF: each picture centered in the column within 0.5px, inside it, and
// below the picture before it in its block, with a space between them.
// pdfPageCounts has the number of such pictures. Failures: [the picture,
// what is wrong]
const pdfPagesStacked = `(() => {
  const column = document.querySelector('main') ?? document.body, style = getComputedStyle(column);
  const box = column.getBoundingClientRect();
  const left = box.left + parseFloat(style.paddingLeft), right = box.right - parseFloat(style.paddingRight);
  const pictures = [...document.querySelectorAll('.tex8web-pdfpages > img')];
  const wrong = pictures.flatMap((img, i) => {
    const at = img.getBoundingClientRect(), name = img.getAttribute('src') + ' (' + (i + 1) + ')';
    const before = img.previousElementSibling?.matches('img') && img.previousElementSibling.getBoundingClientRect();
    const off = (at.left + at.right) / 2 - (left + right) / 2;
    return [...Math.abs(off) > 0.5 ? [[name, \`its center \${off.toFixed(1)}px from the column's\`]] : [],
      ...at.left < left - 0.5 || at.right > right + 0.5 ? [[name, 'outside the column']] : [],
      ...before && !(at.top > before.bottom + 1) ? [[name, \`its top \${(at.top - before.bottom).toFixed(1)}px below the picture before it\`]] : []];
  });
  return { checked: pictures.length, wrong };
})()`;
const pdfPageCounts = { 'test-pdfpages': 76, 'test-pdfpages-plain': 9, 'test-pdfpages-hint': 21 };
// Each page of pdfpages that loads only near the screen has its height
// before it loads: a copy of the picture with no src, put beside it, is as
// tall as the loaded picture within 1px. (Without JavaScript, Chrome loads
// lazy pictures at once, so the picture itself has loaded.) Failures: [the
// picture, its height without src, its height]
const pdfPagesReserved = `(() => {
  const pictures = [...document.querySelectorAll('.tex8web-pdfpages > img[loading=lazy]')];
  const wrong = pictures.flatMap(img => {
    const copy = img.cloneNode();
    copy.removeAttribute('src');
    img.after(copy);
    const before = copy.getBoundingClientRect().height, after = img.getBoundingClientRect().height;
    copy.remove();
    return Math.abs(before - after) > 1 ? [[img.getAttribute('src'), before.toFixed(1), after.toFixed(1)]] : [];
  });
  return { checked: pictures.length, wrong };
})()`;

// Measure literal text against its intended font, including visible spaces.
// Counts guard the cases; style, weight, and size guard their TeX context.
const verbatimCases = ['heading', 'inline', 'star', 'italic', 'italic-star', 'bold',
  'sans', 'typewriter', 'footnote', 'footnote-verb', 'block', 'block-star',
  'block-italic', 'block-sans', 'block-typewriter', 'theorem', 'block-theorem',
  'texttt', 'alltt', 'fancy-inline', 'fancy-block', 'file', 'small', 'block-small', 'fancy-small',
  'wrap-kernel', 'wrap-kernel-star', 'wrap-fancy', 'wrap-fancy-star',
  'fancy-star', 'fancy-block-star', 'fancy-showspaces'];
const verbatimFamilies = {
  'test-verbatim-font': 'Latin Modern Mono',
  'test-verbatim-font-hyperref': 'Latin Modern Mono',
  'test-verbatim-font-t1': 'Latin Modern Mono',
  'test-verbatim-font-lmodern': 'Latin Modern Mono',
  'test-verbatim-font-courier': 'TeX Gyre Cursor',
  'test-verbatim-font-courier-only': 'TeX Gyre Cursor',
  'test-verbatim-font-times': 'TeX Gyre Cursor',
  'test-verbatim-font-kernel': 'Latin Modern Mono',
  'test-verbatim-font-memoir': 'Latin Modern Mono',
  'test-verbatim-font-moreverb': 'Latin Modern Mono',
  'test-verbatim-font-moreverb-courier': 'TeX Gyre Cursor',
  'test-verbatim-font-smallfont': 'Latin Modern Mono',
  'test-verbatim-font-other': 'monospace',
  'test-verbatim-font-sourcecodepro': 'Latin Modern Mono',
  'test-verbatim-font-visible': 'TeX Gyre Cursor',
};
const verbatimMetrics = {
  default: { fileCount: 3, size: 1, sizes: {
    'vf-block-small': 0.8, 'vf-footnote': 0.8, 'vf-footnote-verb': 0.8,
    'vf-small': 0.9, 'vf-fancy-small': 0.9,
    'vf-kernel-small': 0.9, 'vf-kernel-block-small': 0.8,
  } },
  'test-verbatim-font-moreverb': { fileCount: 2, size: 1 },
  'test-verbatim-font-smallfont': { fileCount: 1, size: 0.9 },
  'test-verbatim-font-sourcecodepro': { fileCount: 1, size: 1 },
};
const verbatimExtraCases = {
  'test-verbatim-font-kernel': ['kernel', 'kernel-star', 'kernel-block', 'kernel-block-star',
    'kernel-small', 'kernel-block-small'],
  'test-verbatim-font-memoir': ['memoir'],
  'test-verbatim-font-moreverb': ['boxed', 'tabbed', 'file', 'listing', 'listingcont'],
  'test-verbatim-font-moreverb-courier': ['listing-star', 'listingcont-star'],
  'test-verbatim-font-smallfont': ['template-inline', 'template-block', 'file'],
  'test-verbatim-font-other': ['other', 'other-tt', 'other-block'],
  'test-verbatim-font-sourcecodepro': ['fallback-inline', 'fallback-block', 'file'],
  'test-verbatim-font-visible': ['custom-inline', 'custom-block', 'custom-fancy', 'custom-fancy-block'],
};
const verbatimFonts = (family, name) => `(async () => {
  const cases = ${JSON.stringify(verbatimExtraCases[name] ?? verbatimCases)};
  const family = ${JSON.stringify(family)};
  const metrics = ${JSON.stringify(verbatimMetrics[name] ?? verbatimMetrics.default)};
  const found = Object.fromEntries(cases.map(name => ['vf-' + name, []]));
  const nodes = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
  while (nodes.nextNode()) {
    const node = nodes.currentNode;
    for (const marker of node.textContent.match(/vf-[a-z-]+/g) ?? []) {
      if (found[marker]) found[marker].push(node);
    }
  }
  const wrong = [];
  if (family !== 'monospace') {
    const faces = await document.fonts.load('16px "' + family + '"');
    if (!faces.length || faces.some(face => face.status !== 'loaded')) {
      wrong.push(['font', family + ' did not load']);
    }
  }
  const base = parseFloat(getComputedStyle(document.body).fontSize);
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
  document.body.append(probe);
  for (const [marker, texts] of Object.entries(found)) {
    const count = marker === 'vf-file' ? metrics.fileCount : 1;
    if (texts.length !== count) wrong.push([marker, texts.length + ' text nodes, expected ' + count]);
    for (const node of texts) {
      const style = getComputedStyle(node.parentElement);
      const declared = style.fontFamily.split(',')[0].replaceAll('"', '').trim();
      if (declared !== family) wrong.push([marker, declared + ', expected ' + family]);
      const size = parseFloat(style.fontSize);
      const ratio = metrics.sizes?.[marker] ?? metrics.size;
      if (marker !== 'vf-heading' && Math.abs(size / base - ratio) > 0.011) {
        wrong.push([marker, 'font size ' + size / base + ', expected ' + ratio]);
      }
      if (marker !== 'vf-heading' && (style.fontStyle !== 'normal' || style.fontWeight !== '400')) {
        wrong.push([marker, style.fontStyle + ' ' + style.fontWeight + ', expected normal 400']);
      }
      const text = node.textContent.trim();
      const start = node.textContent.indexOf(text);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      if (node.parentElement.closest('code.verb') && range.getClientRects().length !== 1) {
        wrong.push([marker, 'inline literal breaks across lines']);
      }
      const actual = range.getBoundingClientRect().width;
      probe.style.font = style.fontWeight + ' ' + size + 'px ' + (family === 'monospace' ? family : '"' + family + '"');
      probe.textContent = text;
      const expected = probe.getBoundingClientRect().width;
      if (Math.abs(actual - expected) > 0.1) {
        wrong.push([marker, actual.toFixed(2) + 'px wide, expected ' + expected.toFixed(2) + 'px in ' + family]);
      }
      if (text.includes('␣')) {
        probe.textContent = '␣';
        const space = probe.getBoundingClientRect().width;
        probe.textContent = 'x';
        if (Math.abs(space - probe.getBoundingClientRect().width) > 0.1) {
          wrong.push([marker, 'visible space is not one typewriter character wide']);
        }
      }
    }
  }
  probe.remove();
  return wrong;
})()`;

// A small verbatim block of three lines has the line pitch of its size,
// as \small's \baselineskip in the PDF, and not the text's.
const smallPitch = `(async () => {
  await document.fonts.load('16px "Latin Modern Mono"');
  const tops = [], sizes = [];
  for (const marker of ['vf-pitch-first', 'vf-pitch-second', 'vf-pitch-third']) {
    const nodes = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
    while (nodes.nextNode()) {
      const node = nodes.currentNode, start = node.textContent.indexOf(marker);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + marker.length);
      tops.push(range.getBoundingClientRect().top);
      sizes.push(getComputedStyle(node.parentElement).fontSize);
      break;
    }
  }
  if (tops.length !== 3) return ['small verbatim block lines missing'];
  const lines = document.createElement('div');
  lines.style.cssText = 'font-family: "Latin Modern Mono"; font-size: ' + sizes[0];
  lines.innerHTML = 'x<br>x<br>x';
  document.querySelector('main').append(lines);
  const want = lines.getBoundingClientRect().height / 3;
  lines.remove();
  const wrong = [];
  for (const i of [1, 2]) {
    const pitch = tops[i] - tops[i - 1];
    if (Math.abs(pitch - want) > 0.5) wrong.push('small verbatim line pitch ' + pitch.toFixed(2) + 'px, expected ' + want.toFixed(2) + 'px');
  }
  return wrong;
})()`;

// moreverb's line numbers are in the text's roman, also with a roman font
// tex8web does not have.
const moreverbNumbers = `(() => {
  const listing = document.querySelector('div.listing');
  if (!listing) return ['no listing'];
  const nodes = document.createTreeWalker(listing, NodeFilter.SHOW_TEXT);
  while (nodes.nextNode()) {
    if (nodes.currentNode.textContent.trim() !== '1') continue;
    const got = getComputedStyle(nodes.currentNode.parentElement).fontFamily;
    const want = getComputedStyle(document.body).fontFamily;
    return got === want ? [] : ['listing number in ' + got + ', expected ' + want];
  }
  return ['no listing number'];
})()`;

// A verbatim block in a typewriter font tex8web does not have keeps the
// line pitch of the document's typewriter font, as every other verbatim
// block does, and not the shorter one of the browser's monospace.
const fallbackPitch = `(async () => {
  await document.fonts.load('16px "Latin Modern Mono"');
  const pre = document.querySelector('pre.verbatim');
  if (!pre) return ['no verbatim block'];
  const tops = ['vf-other-block', 'vf-other-second'].map(marker => {
    const nodes = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    while (nodes.nextNode()) {
      const node = nodes.currentNode, start = node.textContent.indexOf(marker);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + marker.length);
      return range.getBoundingClientRect().top;
    }
  });
  if (tops.includes(undefined)) return ['verbatim block lines missing'];
  const line = document.createElement('div');
  line.style.cssText = 'line-height: normal; font-family: "Latin Modern Mono"; font-size: ' + getComputedStyle(pre).fontSize;
  line.textContent = 'x';
  document.body.append(line);
  const want = line.getBoundingClientRect().height;
  line.remove();
  const pitch = tops[1] - tops[0];
  return Math.abs(pitch - want) > 0.5
    ? ['verbatim lines ' + pitch.toFixed(2) + 'px apart, expected ' + want.toFixed(2) + 'px as in Latin Modern Mono'] : [];
})()`;

// Each source line of a listing, a tabbed file, or a tabbed block stays on
// its own line.
const listingLines = starred => `(() => {
  const cases = ${JSON.stringify(starred
    ? [['div.listing', 'vf-listing-star', 'star-second'],
      ['div.listing', 'vf-listingcont-star', 'cont-star-second']]
    : [['div.listing', 'vf-listing', 'listing-second'],
      ['div.listing', 'vf-listingcont', 'cont-second'],
      ['div.verbatimtabinput', 'vf-file', 'file-second'],
      ['pre.verbatim', 'vf-tabbed', 'tabbed-two']])};
  const wrong = [];
  for (const [selector, first, second] of cases) {
    const block = [...document.querySelectorAll(selector)].find(el => el.textContent.includes(first));
    if (!block) { wrong.push(first + ': missing block'); continue; }
    const tops = [];
    for (const marker of [first, second]) {
      const nodes = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let found = false;
      while (nodes.nextNode()) {
        const node = nodes.currentNode, start = node.textContent.indexOf(marker);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + marker.length);
        tops.push(range.getBoundingClientRect().top);
        found = true;
        break;
      }
      if (!found) wrong.push(marker + ': missing text');
    }
    if (tops.length === 2 && tops[1] <= tops[0] + 1) wrong.push(first + ': source lines collapsed');
  }
  return wrong;
})()`;

// A tab in a tabbed block (moreverb's verbatimtab) reaches the next tab
// stop, eight columns, as in the PDF: the text after it starts sixteen
// characters from the line's start.
const tabColumns = `(() => {
  const block = [...document.querySelectorAll('pre.verbatim')].find(el => el.textContent.includes('tabbed-two'));
  if (!block) return ['tabbed-two: missing block'];
  const nodes = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  while (nodes.nextNode()) {
    const node = nodes.currentNode, start = node.textContent.indexOf('tabbed-two');
    if (start < 0) continue;
    const end = node.textContent.indexOf('end', start);
    if (end < 0) return ['tabbed-two: missing text after the tab'];
    const left = offset => {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      return range.getBoundingClientRect().left;
    };
    const char = (left(start + 9) - left(start)) / 9, columns = (left(end) - left(start)) / char;
    return Math.abs(columns - 16) > 0.1 ? ['tabbed-two: text after the tab at column ' + columns.toFixed(2) + ', expected 16'] : [];
  }
  return ['tabbed-two: missing text'];
})()`;

// A long inline literal wraps on a phone, and stays whole on wide screens
// and in print, where TeX does not break literals at hyphens or slashes.
async function inlineLiteralLines(chrome, file, count) {
  const wrong = [];
  for (const [width, media] of [[1600, 'screen'], [740, 'print'], [390, 'screen']]) {
    const problems = await chrome.withPage(pathToFileURL(file).href,
      { width, javascript: false }, async page => {
        await page.media(media);
        return page.evaluate(`(() => {
          const codes = [...document.querySelectorAll('code.verb')];
          const paths = codes.filter(el => el.textContent.startsWith('/usr/local/texlive/'));
          const wrong = [];
          if (paths.length !== ${count}) wrong.push('expected ${count} long inline literals, found ' + paths.length);
          for (const code of codes) {
            const range = document.createRange();
            range.selectNodeContents(code);
            const lines = new Set([...range.getClientRects()].map(rect => rect.top));
            const wrap = ${media === 'screen' && width === 390} && paths.includes(code);
            if (wrap ? lines.size <= 1 : lines.size !== 1) {
              wrong.push(code.textContent + ': ' + (wrap ? 'long inline literal does not wrap' : 'inline literal breaks across lines'));
            }
          }
          return wrong;
        })()`);
      });
    wrong.push(...problems.map(problem => width + 'px ' + media + ': ' + problem));
  }
  return wrong;
}

// Match listings' font choices to ordinary text in the same TeX font.
// Measure both the code box and its glyphs, including unbreakable identifiers.
// family: the document's typewriter family, where tex8web maps its italic
// (null for Computer Modern's cmitt, which it does not map yet).
async function reviewLiterals(chrome, file, family) {
  const wrong = [];
  // (1064px: the narrowest wide screen for these pages, 66.5em)
  for (const [width, media] of [[320, 'screen'], [360, 'screen'], [390, 'screen'],
      [1064, 'screen'], [1600, 'screen'], [740, 'print'], [1600, 'print']]) {
    const problems = await chrome.withPage(pathToFileURL(file).href,
      { width, javascript: false }, async page => {
        await page.media(media);
        return page.evaluate(`(async () => {
          await document.fonts.ready;
          const codes = [...document.querySelectorAll('code.verb, code.lstinline')];
          if (codes.length !== 11) return ['expected eleven review literals'];
          const wrong = [];
          const reference = marker => {
            const nodes = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
            while (nodes.nextNode()) {
              if (nodes.currentNode.textContent.includes(marker)) return getComputedStyle(nodes.currentNode.parentElement);
            }
          };
          for (const [marker, ref] of [['vf-review-default', 'vf-review-roman-reference'],
              ['vf-review-default-italic', 'vf-review-italic-reference'],
              ['vf-review-italic-tt', 'vf-review-tt-reference']]) {
            const code = codes.find(el => el.textContent.replace(/\u2212/g, '-') === marker), want = reference(ref);
            if (!code || !want) { wrong.push('missing font comparison for ' + marker); continue; }
            const nodes = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
            while (nodes.nextNode()) {
              // (tex4ht gives a TS1 italic minus no italic style; a minus looks the same in both)
              if (!nodes.currentNode.textContent.replace(/\u2212/g, '').trim()) continue;
              const got = getComputedStyle(nodes.currentNode.parentElement);
              for (const property of ['fontFamily', 'fontStyle', 'fontWeight', 'fontSize']) {
                if (got[property] !== want[property]) wrong.push(marker + ': ' + property + ' is ' + got[property] + ', expected ' + want[property]);
              }
              const family = ${JSON.stringify(family)};
              if (marker === 'vf-review-italic-tt' && family &&
                  got.fontFamily.split(',')[0].replaceAll('"', '').trim() !== family) {
                wrong.push(marker + ': font family is ' + got.fontFamily + ', expected ' + family);
              }
            }
          }
          for (const code of codes) {
            const range = document.createRange();
            range.selectNodeContents(code);
            const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
            // (a wide printed page floats margin notes as a wide screen does)
            const note = code.closest('.tex8web-sidenote');
            const sidenote = note && getComputedStyle(note).float !== 'none' && note;
            if (sidenote) {
              // (a margin note is narrower than a long literal: it wraps there)
              const bounds = sidenote.getBoundingClientRect();
              for (const rect of [code.getBoundingClientRect(), ...rects]) {
                if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) {
                  wrong.push(code.textContent + ': literal extends past its margin note'); break;
                }
              }
            } else if (${media === 'screen' && width <= 390}) {
              const paragraph = code.closest('p'), bounds = paragraph?.getBoundingClientRect();
              if (!bounds) { wrong.push('literal has no paragraph'); continue; }
              const style = getComputedStyle(paragraph);
              const left = bounds.left + parseFloat(style.paddingLeft), right = bounds.right - parseFloat(style.paddingRight);
              for (const rect of [code.getBoundingClientRect(), ...rects]) {
                if (rect.left < left - 1 || rect.right > right + 1) {
                  wrong.push(code.textContent + ': literal extends past its column'); break;
                }
              }
            } else if (rects.some(rect => rect.top > rects[0].top + rects[0].height / 2)) {
              // (text in different fonts on one line has different tops)
              wrong.push(code.textContent + ': literal breaks on a wide screen or in print');
            }
          }
          if (${media === 'screen'} && document.documentElement.scrollWidth > innerWidth + 1) {
            wrong.push('literals widened the page');
          }
          return wrong;
        })()`);
      });
    wrong.push(...problems.map(p => width + 'px ' + media + ': ' + p));
  }
  return wrong;
}

// Reuse the list-spacing measurement for all moreverb block forms.
const moreverbSpaced = blocksSpaced.replace('pre.verbatim', 'div.listing, div.listinginput, div.verbatimtabinput');

// Opening punctuation shares a line with a short literal at phone widths.
async function literalOpeners(chrome, file) {
  const wrong = [];
  for (const width of [320, 390, 480]) {
    const problems = await chrome.withPage(pathToFileURL(file).href,
      { width, javascript: false }, page => page.evaluate(`(() => {
        const codes = [...document.querySelectorAll('code.verb')].filter(el => el.textContent === 'xxxx');
        const wrong = [];
        if (codes.length !== 2) return ['expected two literals with opening punctuation'];
        for (const code of codes) {
          const wrapper = code.closest('.obeylines-h') ?? code;
          const before = wrapper.previousSibling;
          if (!before || before.nodeType !== Node.TEXT_NODE || !/[(“]$/.test(before.textContent.trimEnd())) {
            wrong.push('missing opening bracket or quote'); continue;
          }
          const opener = document.createRange(), literal = document.createRange();
          const end = before.textContent.trimEnd().length;
          opener.setStart(before, end - 1); opener.setEnd(before, end);
          literal.selectNodeContents(code);
          const paragraph = code.closest('p');
          for (const chars of [14, 15, 16, 17, 18]) {
            paragraph.style.width = chars + 'ch';
            const a = opener.getBoundingClientRect(), b = literal.getBoundingClientRect();
            if (Math.abs(a.top - b.top) > parseFloat(getComputedStyle(paragraph).lineHeight) / 2) {
              wrong.push(chars + 'ch: opener stranded before ' + code.textContent);
            }
          }
          paragraph.style.removeProperty('width');
        }
        return wrong;
      })()`));
    wrong.push(...problems.map(p => width + 'px: ' + p));
  }
  return wrong;
}

// Match the first source line's offset to a pre, including its parser newline.
const literalBlockStarts = `(() => {
  const firstTop = (block, marker) => {
    const nodes = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (nodes.nextNode()) {
      const node = nodes.currentNode, start = node.textContent.indexOf(marker);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + marker.length);
      return range.getBoundingClientRect().top - block.getBoundingClientRect().top;
    }
    return null;
  };
  const reference = [...document.querySelectorAll('pre.verbatim')].find(el => el.textContent.includes('vf-first-reference'));
  if (!reference) return ['missing reference pre'];
  const expected = firstTop(reference, 'vf-first-reference'), wrong = [];
  const blocks = [...document.querySelectorAll('div.listing, div.verbatimtabinput')];
  if (blocks.length < 2) return ['missing literal blocks'];
  for (const block of blocks) {
    const marker = block.textContent.match(/vf-[a-z-]+/)?.[0];
    const actual = marker && firstTop(block, marker);
    if (actual == null || Math.abs(actual - expected) > 1) {
      wrong.push(marker + ': first line is ' + actual + 'px below block top, expected ' + expected);
    }
    if (block.previousElementSibling?.matches('div.listing')) {
      const gap = parseFloat(getComputedStyle(block).marginTop);
      const listGap = parseFloat(getComputedStyle(reference).marginTop);
      if (Math.abs(gap - listGap) > 0.5) wrong.push(marker + ': missing list spacing');
    }
  }
  return wrong;
})()`;

async function listingFades(chrome, file) {
  return chrome.withPage(pathToFileURL(file).href, { width: 390 }, page =>
    page.evaluate(`(async () => {
      await document.fonts.ready;
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      const blocks = [...document.querySelectorAll('div.listing, div.verbatimtabinput')]
        .filter(el => el.scrollWidth > el.clientWidth);
      if (blocks.length !== 2) return ['expected two scrolling literal blocks, found ' + blocks.length];
      const wrong = [];
      const files = [...document.querySelectorAll('div.listinginput')];
      if (files.length !== 1) wrong.push('expected one numbered file listing, found ' + files.length);
      for (const file of files) {
        if (file.scrollWidth <= file.clientWidth || getComputedStyle(file).overflowX !== 'auto') {
          wrong.push('long numbered file listing does not scroll inside its box');
        }
      }
      blocks.push(...files);
      for (const block of blocks) {
        const hidden = () => parseFloat(block.style.getPropertyValue('--tex8web-hidden-right'));
        if (!block.classList.contains('tex8web-scrolls') || !(hidden() > 0)) {
          wrong.push(block.className + ': missing right edge fade');
        }
        block.scrollLeft = block.scrollWidth;
        await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
        if (hidden() > 1 || !(parseFloat(block.style.getPropertyValue('--tex8web-hidden-left')) > 0)) {
          wrong.push(block.className + ': edge fade did not follow scrolling');
        }
      }
      return wrong;
    })()`));
}

// Source blank lines and indentation survive collapsing tex4ht's padding.
const listingWhitespace = `(() => {
  const block = [...document.querySelectorAll('div.listing')].find(el => el.textContent.includes('cont-indented'));
  if (!block) return ['missing indented listing line'];
  const positions = [];
  for (const marker of ['vf-listingcont', 'cont-second', 'cont-indented']) {
    const nodes = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (nodes.nextNode()) {
      const node = nodes.currentNode, start = node.textContent.indexOf(marker);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + 1);
      positions.push(range.getBoundingClientRect());
      break;
    }
  }
  if (positions.length !== 3) return ['missing listing whitespace markers'];
  const [first, second, indented] = positions, wrong = [];
  if (Math.abs(indented.top - second.top - 2 * (second.top - first.top)) > 1) {
    wrong.push('source blank line in listing was lost');
  }
  if (Math.abs(indented.left - second.left - 4 * indented.width) > 1) {
    wrong.push('source indentation in listing was lost');
  }
  return wrong;
})()`;

// A listing label that the document defines keeps its fonts and sizes: its
// text in the listing's typewriter font, its number in roman, and its colon
// in the base font, roman at the text's size.
const listingLabelFonts = `(() => {
  const label = document.querySelector('div.listing .tex8web-listing-label');
  if (!label) return ["missing the document's listing label"];
  const style = el => getComputedStyle(el);
  const [text, number] = label.querySelectorAll('span');
  const wrong = [];
  if (!style(text).fontFamily.startsWith('"Latin Modern Mono"')) wrong.push('label text in ' + style(text).fontFamily);
  if (!style(number).fontFamily.startsWith('"Latin Modern Roman"')) wrong.push('label number in ' + style(number).fontFamily);
  if (![...label.childNodes].some(node => node.nodeType === 3 && node.textContent.includes(':'))) {
    return [...wrong, 'the label colon is not text of the label'];
  }
  if (!style(label).fontFamily.startsWith('"Latin Modern Roman"')) wrong.push('label colon in ' + style(label).fontFamily);
  const text_size = style(label.closest('div.listing')).fontSize;
  if (style(label).fontSize !== text_size) wrong.push('label colon at ' + style(label).fontSize + ', not ' + text_size);
  return wrong;
})()`;

// moreverb's line numbers are \small at any size of the listing.
const listingNumberSize = `(() => {
  const number = document.querySelector('div.listing .tex8web-listing-number > span');
  if (!number) return ['missing listing line number'];
  const got = parseFloat(getComputedStyle(number).fontSize);
  const want = 0.9 * parseFloat(getComputedStyle(number.closest('div.listing')).fontSize);
  return Math.abs(got - want) > 0.05 ? ['line number ' + got + 'px, expected ' + want.toFixed(2) + 'px'] : [];
})()`;

// moreverb's line numbers are in the roman font (\small\rmfamily), as in
// the PDF, in listings and file listings.
const listingNumbers = `(() => {
  const numbers = [...document.querySelectorAll('div.listing span, div.listinginput span')]
    .filter(span => /^cmr-/.test(span.className));
  if (!numbers.length) return ['missing listing line numbers'];
  return numbers.filter(span => !getComputedStyle(span).fontFamily.startsWith('"Latin Modern Roman"'))
    .map(span => \`line number "\${span.textContent.trim()}" in \${getComputedStyle(span).fontFamily}\`);
})()`;

// In a typewriter document, moreverb's literal text is bare text in the
// block. Its padding after the line number, its indentation, and its blank
// line show as in the PDF, and the block neither scrolls nor ends in a
// padding line.
const typewriterListing = `(() => {
  const block = [...document.querySelectorAll('div.listing')].find(el => el.textContent.includes('vf-tt-listing'));
  const file = [...document.querySelectorAll('div.verbatimtabinput')].find(el => el.textContent.includes('file-second'));
  if (!block || !file) return ['missing typewriter listing or tabbed input'];
  const box = (root, marker, length = 1) => {
    const nodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (nodes.nextNode()) {
      const node = nodes.currentNode, start = node.textContent.indexOf(marker);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + length);
      return range.getBoundingClientRect();
    }
    return null;
  };
  const number = block.querySelector('span');
  const one = number && box(number, '1'), first = box(block, 'vf-tt-listing');
  const second = box(block, 'tt-second'), indented = box(block, 'tt-indented');
  if (!one || !first || !second || !indented) return ['missing typewriter listing markers'];
  const wrong = [], char = first.width;
  if (Math.abs(first.left - one.right - 3 * char) > 1) {
    wrong.push('padding after the line number is ' + (first.left - one.right) + 'px, not three spaces');
  }
  if (Math.abs(indented.left - second.left - 4 * char) > 1) wrong.push('source indentation in listing was lost');
  if (Math.abs(indented.top - second.top - 2 * (second.top - first.top)) > 1) {
    wrong.push('source blank line in listing was lost');
  }
  for (const el of [block, file]) {
    if (el.scrollWidth > el.clientWidth + 1) wrong.push(el.className + ': short block scrolls');
  }
  const last = box(file, 'file-second'), pitch = last && last.bottom - box(file, 'vf-file').bottom;
  if (!last || file.getBoundingClientRect().bottom - last.bottom > pitch / 2) {
    wrong.push('tabbed input ends in a padding line');
  }
  return wrong;
})()`;

// Inline listings retain the document's typewriter family and TeX size.
async function listingFonts(chrome, file, family) {
  return chrome.withPage(pathToFileURL(file).href, { width: 390, javascript: false }, page =>
    page.evaluate(`(async () => {
      const family = ${JSON.stringify(family)};
      const faces = await document.fonts.load('16px "' + family + '"');
      const wrong = [];
      if (!faces.length || faces.some(face => face.status !== 'loaded')) wrong.push('listing font did not load');
      const codes = [...document.querySelectorAll('code.lstinline')];
      if (codes.length !== 10) return ['expected ten inline listings'];
      const base = parseFloat(getComputedStyle(document.body).fontSize);
      for (const code of codes) {
        const marker = code.textContent.match(/vf-lst-[a-z-]+/)?.[0];
        if (!marker) { wrong.push('missing listing marker'); continue; }
        const ratio = marker.endsWith('footnote') ? 0.8 : marker.endsWith('small') ? 0.9 : 1;
        const nodes = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        while (nodes.nextNode()) {
          const node = nodes.currentNode;
          if (!node.textContent.trim()) continue;
          const style = getComputedStyle(node.parentElement);
          if (style.fontFamily.split(',')[0].replaceAll('"', '').trim() !== family ||
              Math.abs(parseFloat(style.fontSize) / base - ratio) > 0.011 ||
              style.fontStyle !== 'normal' || style.fontWeight !== '400') {
            wrong.push(marker + ': wrong typewriter font or size');
          }
        }
      }
      return wrong;
    })()`));
}

// Displayed listings in boxes, as the browser parses the page: each frame
// (\fbox, \fcolorbox) holds a listing, and the listings set in a box in a
// paragraph are in that paragraph, counted by their text. An HTML parser
// closes a <p> at a <pre> start tag.
const boxedListings = `(() => {
  const listings = [...document.querySelectorAll(':is(pre, code):is(.lstlisting, .lstinputlisting, .listings)')];
  const empty = [...document.querySelectorAll('span.fbox, span.colorbox')].filter(box => !listings.some(listing => box.contains(listing)));
  const inParagraph = listings.filter(listing => listing.closest('p'))
    .map(listing => [...listing.childNodes].filter(node => node.nodeType !== 8 && !node.classList?.contains('caption'))
      .map(node => node.textContent).join('').trim());
  // (a boxed listing's caption, at the top or the bottom, in its paragraph's font)
  const captions = [...document.querySelectorAll('.tex8web-boxed-listing .caption')];
  const offFont = captions.filter(caption => getComputedStyle(caption).fontFamily !== getComputedStyle(caption.closest('p')).fontFamily)
    .map(caption => caption.textContent.trim());
  return { empty: empty.length, inParagraph, captions: captions.length, offFont };
})()`;
const paragraphListings = {
  'test-listing-hmode': ['lrbox', 'fbox', 'mbox_esc', 'fcbox', 'makebox', 'note', 'raise', 'sbox', 'savebox', 'hbox',
    'italic', 'sans', 'inbox', 'item', 'twoA', 'twoB', 'resize', 'saved', 'hboxed', 'hboxnew', 'delims'].map(name => `${name}();`),
  'test-listing-hmode-hyperref': ['lrbox', 'fbox', 'mbox_esc', 'fcbox', 'makebox', 'note', 'raise', 'sbox', 'savebox', 'hbox',
    'italic', 'sans', 'inbox', 'item', 'twoA', 'twoB', 'resize', 'saved', 'hboxed', 'hboxnew', 'delims', 'link', 'utf']
    .map(name => `${name}();`),
  'test-listing-hmode-caption': ['boxenv();', 'fbox();'],
};

// A boxed listing with a line wider than a phone's column scrolls inside
// its frames, which stay in the column, also a frame around a frame, and
// the page is no wider than the screen. A boxed bottom caption is as far
// from its listing as in the PDF (test-boxed-listings).
const boxedListingScroll = `(() => {
  const problems = [];
  const codes = [...document.querySelectorAll('.tex8web-boxed-listing > code')].filter(el => /^wide\\w*\\(\\);/.test(el.textContent.trim()));
  if (codes.length !== 5) return [\`expected five boxed listings wide...();, found \${codes.length}\`];
  for (const code of codes) {
    const name = code.textContent.trim().split(' ')[0], column = code.closest('p').getBoundingClientRect();
    if (!(code.scrollWidth > code.clientWidth && getComputedStyle(code).overflowX === 'auto')) problems.push(\`the listing \${name} does not scroll\`);
    for (let frame = code.parentElement; frame && frame.tagName !== 'P'; frame = frame.parentElement) {
      if (frame.getBoundingClientRect().right > column.right + 0.5) problems.push(\`a box of \${name} (\${frame.className}) is wider than its column\`);
    }
  }
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
    problems.push(\`the page is \${document.documentElement.scrollWidth - document.documentElement.clientWidth}px wider than the screen\`);
  }
  const bottom = [...document.querySelectorAll('.tex8web-boxed-listing > code')].find(el => el.textContent.includes('bottomenv();'));
  const caption = bottom?.parentElement.querySelector('.caption');
  const gap = caption && caption.getBoundingClientRect().top - bottom.getBoundingClientRect().bottom;
  const em = caption && parseFloat(getComputedStyle(caption).fontSize);
  if (!(Math.abs(gap - 0.3 * em) < 1)) problems.push(\`the caption below bottomenv(); is \${gap}px from it, not 0.3em\`);
  // (the spaces of a boxed listing as wide as its letters, also a space
  // outside the spans of fonts, so that columns line up)
  const aligned = [...document.querySelectorAll('.tex8web-boxed-listing > code')].find(el => el.textContent.includes('abcde y;'));
  const widths = [];
  const walker = aligned && document.createTreeWalker(aligned, NodeFilter.SHOW_TEXT);
  for (let node; walker && (node = walker.nextNode());) {
    for (let i = 0; i < node.data.length; i++) {
      if (node.data[i] === '\\n') continue;
      const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
      widths.push([node.data[i], range.getBoundingClientRect().width]);
    }
  }
  const letter = widths.find(([c]) => c === 'a')?.[1], space = widths.find(([c]) => c === ' ' )?.[1];
  const narrow = widths.filter(([, w]) => !(Math.abs(w - letter) < 0.2));
  if (!letter || !space || narrow.length) problems.push(\`characters of the aligned listing not as wide as its letters: \${JSON.stringify(narrow)}\`);
  // (centered on the line, at its top with boxpos=t, and with its last
  // line on the baseline with boxpos=b: the word before the box is in the
  // middle, at the top, or at the bottom of the listing)
  for (const name of ['center', 'top', 'bottom', 'lab', 'mid', 'named']) {
    const code = [...document.querySelectorAll('.tex8web-boxed-listing > code')].find(el => el.textContent.includes(name + 'A();'));
    const word = code?.closest('p').firstChild;
    if (!code || word?.nodeType !== 3) { problems.push(\`no listing \${name}A();, or no word before it\`); continue; }
    const range = document.createRange(); range.selectNodeContents(word);
    const w = range.getBoundingClientRect(), box = code.getBoundingClientRect(), size = parseFloat(getComputedStyle(code).fontSize);
    const where = Math.abs((box.top + box.bottom) / 2 - (w.top + w.bottom) / 2) < 0.5 * size ? 'middle'
      : Math.abs(box.top - w.top) < size ? 'top' : Math.abs(box.bottom - w.bottom) < size ? 'bottom' : 'nowhere';
    if (where !== { center: 'middle', top: 'top', bottom: 'bottom', lab: 'top', mid: 'middle', named: 'middle' }[name]) problems.push(\`the word before \${name}A(); is at the \${where} of it\`);
  }
  // (in a list as outside one, also in a later paragraph of an item and
  // with boxpos=t; the item's label on the line of the text, also when
  // the item starts with the box)
  const listed = name => [...document.querySelectorAll('.tex8web-boxed-listing > code')].find(el => el.textContent.includes(name + 'A();'));
  for (const [name, want] of [['itemfirst', 'middle'], ['itemlater', 'middle'], ['itemtop', 'top']]) {
    const code = listed(name), word = code?.closest('p').firstChild;
    if (!code || word?.nodeType !== 3) { problems.push(\`no listing \${name}A();, or no word before it\`); continue; }
    const range = document.createRange(); range.selectNodeContents(word);
    const w = range.getBoundingClientRect(), box = code.getBoundingClientRect(), size = parseFloat(getComputedStyle(code).fontSize);
    const where = Math.abs((box.top + box.bottom) / 2 - (w.top + w.bottom) / 2) < 0.5 * size ? 'middle'
      : Math.abs(box.top - w.top) < size ? 'top' : Math.abs(box.bottom - w.bottom) < size ? 'bottom' : 'nowhere';
    if (where !== want) problems.push(\`the word before \${name}A(); is at the \${where} of it\`);
  }
  for (const name of ['itemfirst', 'itemstart']) {
    const code = listed(name), label = code?.closest('li')?.querySelector('.tex8web-label');
    const text = code && [...code.closest('p').childNodes].find(node => node.nodeType === 3 && /\\w/.test(node.data));
    if (!label || !text) { problems.push(\`no label or no text in the item of \${name}A();\`); continue; }
    const range = document.createRange(); range.selectNodeContents(text);
    const gap = label.getBoundingClientRect().bottom - range.getBoundingClientRect().bottom;
    if (!(Math.abs(gap) < 1)) problems.push(\`the label of the item of \${name}A(); is \${gap}px below its text\`);
  }
  // (frame=shadowbox in an \\fbox: the shadow inside the frame's rules)
  const shadowed = [...document.querySelectorAll('.tex8web-boxed-listing > code')].find(el => el.textContent.includes('shadowed();'));
  const frame = shadowed?.closest('span.fbox');
  if (!frame) problems.push('no listing shadowed(); in a frame');
  else {
    const [x, y] = getComputedStyle(shadowed).boxShadow.replace(/^\\S*\\([^)]*\\)\\s*|^\\w+\\s*/, '').split(/\\s+/).map(parseFloat);
    const c = shadowed.getBoundingClientRect(), f = frame.getBoundingClientRect(), style = getComputedStyle(frame);
    const right = f.right - parseFloat(style.borderRightWidth), bottom = f.bottom - parseFloat(style.borderBottomWidth);
    if (!(x > 0 && y > 0)) problems.push(\`the listing shadowed(); has no shadow: \${getComputedStyle(shadowed).boxShadow}\`);
    else if (c.right + x > right + 0.1 || c.bottom + y > bottom + 0.1) problems.push(\`the shadow of shadowed(); reaches \${c.right + x - right}px right and \${c.bottom + y - bottom}px below the inside of its frame\`);
  }
  // (a framed listing that scrolls, alone and in a frame: its rules and
  // its shadow are not faded out with the text that scrolls)
  for (const name of ['framedwide', 'boxedwide']) {
    const listing = [...document.querySelectorAll('pre, .tex8web-boxed-listing > code')].find(el => el.textContent.trim().startsWith(name + '();'));
    const style = listing && getComputedStyle(listing);
    if (!listing) problems.push(\`no listing \${name}();\`);
    else if (!(listing.scrollWidth > listing.clientWidth && parseFloat(style.borderRightWidth) > 0 && style.boxShadow !== 'none')) problems.push(\`the listing \${name}(); does not scroll in a frame with a shadow\`);
    else if (style.maskImage !== 'none') problems.push(\`the frame and shadow of \${name}(); are under the fade of its scrolling: \${style.maskImage}\`);
  }
  // (boxpos=t with a caption: the word at the caption's top, as the
  // caption is the first line of listings' vtop)
  const captioned = [...document.querySelectorAll('.tex8web-boxed-listing')].find(el => el.textContent.includes('capA();'));
  const capWord = captioned?.closest('p').firstChild;
  if (!captioned || capWord?.nodeType !== 3) problems.push('no listing capA();, or no word before it');
  else {
    const range = document.createRange(); range.selectNodeContents(capWord);
    const w = range.getBoundingClientRect(), caption = captioned.querySelector('.caption')?.getBoundingClientRect();
    if (!caption || Math.abs(caption.top - w.top) >= parseFloat(getComputedStyle(captioned).fontSize)) problems.push('the word before capA(); is not at the top of its caption');
  }
  return problems;
})()`;
// In print, a boxed listing runs into the margin as a <pre> does, and the
// listing's box and its frames grow to fit its longest line, also a line
// wider than the column (test-boxed-listings).
const boxedListingPrint = `(() => {
  const problems = [];
  const codes = [...document.querySelectorAll('.tex8web-boxed-listing > code')];
  const text = code => { const range = document.createRange(); range.selectNodeContents(code); return range.getBoundingClientRect(); };
  const wide = codes.find(code => code.textContent.includes('printwide();'));
  if (!wide || !(text(wide).width > wide.closest('p').clientWidth)) problems.push('the listing printwide(); is not wider than its column');
  for (const code of codes) {
    const right = text(code).right, name = code.textContent.trim().split(' ')[0];
    for (let frame = code.parentElement; frame && frame.tagName !== 'P'; frame = frame.parentElement) {
      if (frame.getBoundingClientRect().right < right - 0.5) problems.push(\`the line of \${name} runs \${right - frame.getBoundingClientRect().right}px past a box (\${frame.className})\`);
    }
  }
  return problems;
})()`;

// Long boxed literals must stay inside their frame in print. On a screen,
// the literal scrolls inside the frame.
async function boxedLiterals(chrome, file) {
  const wrong = [];
  for (const [width, media] of [[1600, 'screen'], [1600, 'print'], [740, 'print'], [390, 'screen']]) {
    const problems = await chrome.withPage(pathToFileURL(file).href,
      { width, javascript: false }, async page => {
        await page.media(media);
        return page.evaluate(`(() => {
          const boxes = [...document.querySelectorAll('table.boxedverbatim pre')];
          if (boxes.length !== 1) return ['expected one boxed literal, found ' + boxes.length];
          const pre = boxes[0];
          const range = document.createRange();
          range.selectNodeContents(pre);
          const text = range.getBoundingClientRect(), frame = pre.getBoundingClientRect();
          if (${media === 'screen'}) {
            return pre.scrollWidth > pre.clientWidth && getComputedStyle(pre).overflowX === 'auto'
              ? [] : ['long literal does not scroll inside its frame'];
          }
          return text.right > frame.right + 0.5 || text.left < frame.left - 0.5
            ? ['long literal extends beyond its frame'] : [];
        })()`);
      });
    wrong.push(...problems.map(problem => width + 'px ' + media + ': ' + problem));
  }
  return wrong;
}

// The computed fonts of the table of contents entries (css/tex8web.css),
// with JavaScript off and every entry shown. Sizes and indents are
// multiples of the font size of the table of contents. The weights of each
// entry's link and number are included, as html4.4ht's rules for the link
// can override them.
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
// test-tocloft sets the fonts with tocloft: the part \Large\scshape,
// chapters \normalfont\itshape, sections \itshape, subsections \bfseries,
// subsubsections \large\sffamily (whose indent is still the 3.8em that TeX
// measures), paragraphs \ttfamily, and subparagraphs \slshape. test-report
// has html4.4ht's fonts: a part bold at 110%, and a chapter bold.
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

// test-split and test-cutat are refused by tex8web; npm test checks that
const selected = select(only).filter(doc => !['test-split', 'test-cutat'].includes(doc.name));
// (every n-th of the largest first, so that the shards take about as long)
const docs = shards ? largestFirst(selected).filter((doc, i) => i % shards === shard - 1) : selected;
// Each document is built twice, prerendered (html) and for MathJax in the
// browser (fallback), a few builds at a time, the largest first. The
// prerendered build is npm test's, reused if npm test has made it.
const variants = [[testDir, 'html', 'aux', { TEX8WEB_MATHML: '1' }],
  [doc => testDir(doc, 'visual'), 'fallback', 'fallbackaux', { TEX8WEB_NO_PRERENDER: '1' }]];
// (the prerendered builds come first, as each build for the browser waits
// for the document's prerendered build, to start from its LaTeX run, and
// a build that waits keeps a worker idle)
const builds = variants.flatMap(([dir, out, aux, env]) => largestFirst(docs).map(doc =>
  ({ doc, dir: dir(doc), out, aux, env, ...Promise.withResolvers() })));
const building = pool(builds, workers, async ({ doc, dir, out, aux, env, resolve }) => {
  const from = out === 'fallback' ? { out: join(testDir(doc), 'html'), aux: join(testDir(doc), 'aux') } : undefined;
  if (from) await builds.find(b => b.doc === doc && b.out === 'html').promise;
  resolve((await build(doc, join(dir, out), join(dir, aux), env, from)).code);
});
const built = async doc => (await Promise.all(builds.filter(b => b.doc === doc).map(b => b.promise))).every(code => code === 0);

// the subjects each check found over the run: a check with none has
// tested nothing
const ran = { spaced: 0, tablesSpaced: 0, blocksSpaced: 0, misaligned: 0, sidenotes: 0, filled: 0, algorithms: 0, labeled: 0, ties: 0,
  symbolFaces: 0 };

async function compare(chrome, doc, ok) {
  const dir = testDir(doc, 'visual');
  const [pre, browser] = [join(testDir(doc), 'html'), join(dir, 'fallback')];
  const visual = join(dir, 'visual');
  rmSync(visual, { recursive: true, force: true });
  // build failures are reported by npm test; this test needs only the pages
  if (!ok && !existsSync(join(pre, `${doc.tex.replace(/\.tex$/, '')}.html`))) {
    return { lines: [`not ok - ${doc.name}`, '    build failed'], failed: true };
  }
  const problems = [];
  for (const html of readdirSync(pre).filter(f => f.endsWith('.html'))) {
    // without tex8web-page.js, which would change the page after MathJax
    const source = readFileSync(join(browser, html), 'utf8');
    const copy = source.replace(/<script [^>]*src='tex8web-page\.js'[^>]*><\/script>/, '');
    if (copy === source) problems.push(`${html}: no script for tex8web-page.js to leave out`);
    const bare = join(browser, html.replace(/\.html$/, '.bare.html'));
    writeFileSync(bare, copy);
    const typeset = join(browser, html.replace(/\.html$/, '.typeset.html'));
    writeFileSync(typeset, await chrome.withPage(pathToFileURL(bare).href, { before: nodeMeasures }, page => page.evaluate(typesetPage))
      .finally(() => rmSync(bare)));
    // JavaScript off. The read-only checks run before the screens, as a
    // capture beyond the window resizes the page.
    const shots = [];
    for (const file of [typeset, join(pre, html)]) {
      shots.push(await chrome.withPage(pathToFileURL(file).href, { javascript: false, height: screen }, async page => {
        const name = relative(join(root, 'build'), file);
        const aligned = await page.evaluate(misaligned);
        if (file !== typeset) ran.misaligned += aligned.checked;
        for (const [text, a, b] of aligned.wrong) {
          problems.push(`${name}: columns at ${a.join(', ')} before "${text}", ${b.join(', ')} after`);
        }
        const n = await page.evaluate(clipped);
        if (n) problems.push(`${name}: ${n} math characters clipped`);
        const notes = await page.evaluate(offColor);
        if (file !== typeset) ran.sidenotes += notes.checked;
        if (notes.wrong) problems.push(`${name}: ${notes.wrong} footnotes not in the text's color`);
        if (doc.name in modernFonts) {
          for (const [what, got, want] of await page.evaluate(modernFont(modernFonts[doc.name]))) {
            problems.push(`${name}: ${what}: ${got}, not ${want}`);
          }
        }
        if (file !== typeset) {
          // the theme button needs tex8web-page.js, which is not running
          if (await page.evaluate(`document.querySelector('.tex8web-theme').checkVisibility()`)) {
            problems.push(`${html}: the theme button shown with JavaScript off`);
          }
          const under = await page.evaluate(spaced);
          ran.spaced += under.checked;
          for (const [id, gap, want] of under.wrong) problems.push(`${html}: #${id}: what follows it ${gap}px below, not ${want}px`);
          if (doc.name in headGaps) {
            for (const [id, what] of await page.evaluate(headGap(headGaps[doc.name]))) problems.push(`${html}: #${id}: ${what}`);
          }
          if (doc.name in tocParts) {
            const [skip, count] = tocParts[doc.name];
            const parts = await page.evaluate(partEntries(skip));
            if (parts.checked !== count) problems.push(`${html}: ${parts.checked} part entries in the table of contents, not ${count}`);
            for (const [title, what] of parts.wrong) problems.push(`${html}: the entry "${title}": ${what}`);
          }
          const tables = await page.evaluate(tablesSpaced);
          ran.tablesSpaced += tables.checked;
          for (const [id, gap, want] of tables.wrong) problems.push(`${html}: #${id}: ${gap} above it, not ${want} as above a paragraph`);
          const blocks = await page.evaluate(blocksSpaced);
          ran.blocksSpaced += blocks.checked;
          for (const [text, got, want] of blocks.wrong) problems.push(`${html}: "${text}": ${got} above it, not ${want} as above a list`);
          const rests = await page.evaluate(filled);
          ran.filled += rests.checked;
          for (const [name, what] of rests.wrong) problems.push(`${html}: the \\hfill before "${name}": ${what}`);
          const algorithm = await page.evaluate(algorithms);
          ran.algorithms += algorithm.checked;
          for (const [id, what] of algorithm.wrong) problems.push(`${html}: algorithm #${id}: ${what}`);
          const labels = await page.evaluate(labeled);
          ran.labeled += labels.checked;
          for (const [text, what] of labels.wrong) problems.push(`${html}: the item "${text}": ${what}`);
          const tied = await page.evaluate(ties);
          ran.ties += tied.checked;
          for (const [text, what] of tied.wrong) problems.push(`${html}: the tie in "${text}": ${what}`);
          const symbols = await page.evaluate(symbolFaces);
          ran.symbolFaces += symbols.checked;
          for (const [font, got, want] of symbols.wrong) problems.push(`${html}: the TS1 symbol of .${font}: ${got}, not ${want}`);
          if (doc.name in laps) {
            const boxes = await page.evaluate(lapped);
            if (boxes.checked !== laps[doc.name]) problems.push(`${html}: ${boxes.checked} boxes of \\lefteqn, not ${laps[doc.name]}`);
            for (const [text, what] of boxes.wrong) problems.push(`${html}: the \\lefteqn "${text}": ${what}`);
          }
          if (doc.name in hangs) problems.push(...await hanging(page, doc, html));
          if (doc.name in decimals) {
            const columns = await page.evaluate(separated);
            if (columns.checked !== decimals[doc.name]) problems.push(`${html}: ${columns.checked} columns of numbers, not ${decimals[doc.name]}`);
            for (const [name, what] of columns.wrong) problems.push(`${html}: the table "${name}": ${what}`);
          }
          if (doc.name in pdfPageCounts) {
            const pages = await page.evaluate(pdfPagesStacked);
            if (pages.checked !== pdfPageCounts[doc.name]) problems.push(`${html}: ${pages.checked} pages included with pdfpages, not ${pdfPageCounts[doc.name]}`);
            for (const [name, what] of pages.wrong) problems.push(`${html}: the included page ${name}: ${what}`);
            const phone = await chrome.withPage(pathToFileURL(file).href, { javascript: false, width: 390 }, at => at.evaluate(pdfPagesStacked));
            for (const [name, what] of phone.wrong) problems.push(`${html} at 390px: the included page ${name}: ${what}`);
            for (const width of [undefined, 390]) {
              const reserved = await chrome.withPage(pathToFileURL(file).href, { javascript: false, ...width && { width } }, at => at.evaluate(pdfPagesReserved));
              if (!reserved.checked) problems.push(`${html}: no page of pdfpages loads lazily`);
              for (const [name, before, after] of reserved.wrong) problems.push(`${html}${width ? ` at ${width}px` : ''}: the included page ${name}: ${before}px tall before it loads, not ${after}px`);
            }
          }
          if (doc.name in centers) {
            const pictures = await page.evaluate(centered);
            if (`${pictures.checked}` !== `${centers[doc.name]}`) problems.push(`${html}: ${pictures.checked} pictures in display math and marks after them, not ${centers[doc.name]}`);
            for (const [name, what] of pictures.wrong) problems.push(`${html}: the display picture ${name}: ${what}`);
            // and at a phone's width, where a picture may fill the column
            const phone = await chrome.withPage(pathToFileURL(file).href, { javascript: false, width: 390 }, at => at.evaluate(centered));
            for (const [name, what] of phone.wrong) problems.push(`${html} at 390px: the display picture ${name}: ${what}`);
            // a link to a numbered picture goes to the anchor before its
            // display: the picture is below the top of the window, and
            // highlighted as a target, also in dark mode, where a TikZ
            // picture is inverted with its background
            // (or at the end of the paragraph before, after a blank line)
            const anchors = await page.evaluate(`[...document.querySelectorAll('.mathjax-block:has(> img)')]
              .map(block => block.previousElementSibling)
              .flatMap(a => a?.matches('p') ? [...a.querySelectorAll(':scope > a.tex8web-eq-anchor-end[id]')] : [a])
              .filter(a => a?.matches('a.tex8web-eq-anchor[id], a.tex8web-eq-anchor-end[id]')).map(a => a.id)`);
            if (!anchors.length) problems.push(`${html}: no anchor before a numbered picture`);
            for (const id of anchors) {
              const seen = await chrome.withPage(`${pathToFileURL(file).href}#${id}`, { javascript: false, colorScheme: 'dark' }, at => at.evaluate(`(() => {
                const anchor = document.getElementById(${JSON.stringify(id)});
                const block = (anchor.matches('.tex8web-eq-anchor-end') ? anchor.parentElement : anchor).nextElementSibling;
                const img = block.querySelector(':scope > img');
                return [...img.getBoundingClientRect().top < 0 ? ['above the window'] : [],
                  ...getComputedStyle(block).backgroundColor === 'rgba(0, 0, 0, 0)' ? ['not highlighted'] : [],
                  ...getComputedStyle(img).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(img).filter !== 'none' ? ['highlighted under its filter'] : []];
              })()`));
              for (const what of seen) problems.push(`${html}: the picture linked as #${id}: ${what}`);
            }
          }
          if (verbatimFamilies[doc.name]) {
            const literals = await page.evaluate(verbatimFonts(verbatimFamilies[doc.name], doc.name));
            for (const [marker, what] of literals) problems.push(`${html}: literal ${marker}: ${what}`);
          }
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
    if (doc.name in laps) {
      for (const file of [typeset, join(pre, html)]) {
        const boxes = await chrome.withPage(pathToFileURL(file).href, { width: 390, height: 844 }, page => page.evaluate(lapped));
        if (boxes.checked !== laps[doc.name]) problems.push(`${relative(join(root, 'build'), file)}: at 390px, ${boxes.checked} boxes of \\lefteqn, not ${laps[doc.name]}`);
        for (const [text, what] of boxes.wrong) problems.push(`${relative(join(root, 'build'), file)}: at 390px, the \\lefteqn "${text}": ${what}`);
      }
    }
    if (doc.name in decimals) {
      const columns = await chrome.withPage(pathToFileURL(join(pre, html)).href, { javascript: false, width: 390, height: 844 },
        page => page.evaluate(separated));
      if (columns.checked !== decimals[doc.name]) problems.push(`${html}: at 390px, ${columns.checked} columns of numbers, not ${decimals[doc.name]}`);
      for (const [name, what] of columns.wrong) problems.push(`${html}: at 390px, the table "${name}": ${what}`);
    }
    if (doc.name in hangs) {
      problems.push(...await chrome.withPage(pathToFileURL(join(pre, html)).href, { javascript: false, width: 390, height: 844 },
        page => hanging(page, doc, `${html}: at 390px`)));
    }
    if (doc.name in darkPictures) {
      const seen = await chrome.withPage(pathToFileURL(join(pre, html)).href, { javascript: false, colorScheme: 'dark' },
        page => page.evaluate(darkSeen));
      const shown = seen.filter(([graphic, filter, background]) => graphic && filter === 'none' && background === 'rgb(255, 255, 255)');
      const inverted = seen.filter(([graphic, filter]) => !graphic && filter === 'invert(1)');
      const [graphics, others] = darkPictures[doc.name];
      if (shown.length !== graphics || inverted.length !== others) {
        problems.push(`${html}: in dark mode, ${shown.length} pictures with a graphic shown on white and ${inverted.length} others inverted, not ${graphics} and ${others}`);
      }
      const light = await chrome.withPage(pathToFileURL(join(pre, html)).href, { javascript: false, colorScheme: 'light' },
        page => page.evaluate(darkSeen));
      const plain = light.filter(([graphic, filter, background]) => graphic && filter === 'none' && background === 'rgba(0, 0, 0, 0)');
      if (plain.length !== graphics) problems.push(`${html}: in light mode, ${plain.length} pictures with a graphic shown without a background, not ${graphics}`);
    }
    if (doc.name in graphicsInside) {
      const srcs = await chrome.withPage(pathToFileURL(join(pre, html)).href, { javascript: false },
        page => page.evaluate(`[...new Set([...document.querySelectorAll('img.tex8web-graphic')].map(img => img.getAttribute('src')))]`));
      let checked = 0;
      await chrome.withPage('about:blank', { javascript: false }, async page => {
        for (const src of srcs) {
          const svg = readFileSync(join(pre, src), 'utf8').replace(/^<\?xml[^>]*>/, '');
          const outside = await page.evaluate(graphicOutside(svg));
          checked += outside.length;
          if (outside.some(Boolean)) problems.push(`${src}: a graphic outside its picture`);
        }
      });
      if (checked !== graphicsInside[doc.name]) problems.push(`${html}: ${checked} graphics not clipped in the pictures, not ${graphicsInside[doc.name]}`);
    }
    for (const [width, [wide, claps]] of Object.entries(wideBlocks[doc.name] ?? {})) {
      const blocks = await chrome.withPage(pathToFileURL(join(pre, html)).href, { javascript: false, width: Number(width) },
        page => page.evaluate(scrollers));
      const [count, shownWide, shownClaps] = blocks.checked;
      if (shownWide !== wide) problems.push(`${html}: at ${width}px, ${shownWide} of ${count} blocks wider than the column, not ${wide}`);
      if (shownClaps !== claps) problems.push(`${html}: at ${width}px, ${shownClaps} claps of zero width in a display, not ${claps}`);
      for (const [n, name, what] of blocks.wrong) problems.push(`${html}: at ${width}px, block ${n} ("${name}"): ${what}`);
    }
    if (doc.name in chapterHeads) {
      for (const [width, media] of [[1400], [1000], [390], [740, 'print']]) {
        const heads = await chrome.withPage(pathToFileURL(join(pre, html)).href, { javascript: false, width },
          async page => { if (media) await page.media(media); return page.evaluate(chapterGaps); });
        const where = `${width}px${media ? ' ' + media : ''}`;
        if (heads.checked !== chapterHeads[doc.name]) problems.push(`${html}: at ${where}, ${heads.checked} part and chapter headings, not ${chapterHeads[doc.name]}`);
        for (const [id, what] of heads.wrong) problems.push(`${html}: at ${where}, the heading #${id}: ${what}`);
      }
      const landed = await chrome.withPage(pathToFileURL(join(pre, html)).href, { width: 1400 },
        page => page.evaluate(chapterLanding));
      for (const [id, what] of landed) problems.push(`${html}: at 1400px, the heading #${id}: ${what}`);
    }
    if (doc.name in descLabels) {
      const labels = await chrome.withPage(pathToFileURL(join(pre, html)).href, { width: 1400 },
        page => page.evaluate(descLabeled));
      const [count, notes, floats] = labels.checked, [wantCount, wantNotes, wantFloats] = descLabels[doc.name];
      if (count !== wantCount) problems.push(`${html}: ${count} description labels, not ${wantCount}`);
      if (notes !== wantNotes) problems.push(`${html}: ${notes} footnotes beside the text, not ${wantNotes}`);
      if (floats !== wantFloats) problems.push(`${html}: ${floats} floats after an \\hfill or of a QED box, not ${wantFloats}`);
      for (const [name, what] of labels.wrong) problems.push(`${html}: at 1400px, "${name}": ${what}`);
    }
    for (const check of [printed, fits]) {
      problems.push(...(await check(chrome, join(pre, html))).map(p => `${html}: ${p}`));
    }
    if (/^test-verbatim-font-review(?:-courier|-lmodern)?$/.test(doc.name)) {
      const family = { 'test-verbatim-font-review-courier': 'TeX Gyre Cursor',
        'test-verbatim-font-review-lmodern': 'Latin Modern Mono' }[doc.name] ?? null;
      problems.push(...(await reviewLiterals(chrome, join(pre, html), family)).map(p => `${html}: ${p}`));
    }
    if (doc.name === 'test-verbatim-font-other') {
      const pitch = await chrome.withPage(pathToFileURL(join(pre, html)).href,
        { width: 1600, javascript: false }, page => page.evaluate(fallbackPitch));
      problems.push(...pitch.map(p => `${html}: ${p}`));
      const numbers = await chrome.withPage(pathToFileURL(join(pre, html)).href,
        { width: 1600, javascript: false }, page => page.evaluate(moreverbNumbers));
      problems.push(...numbers.map(p => `${html}: ${p}`));
    }
    if (doc.name === 'test-verbatim-font-smallfont') {
      const pitch = await chrome.withPage(pathToFileURL(join(pre, html)).href,
        { width: 1600, javascript: false }, page => page.evaluate(smallPitch));
      problems.push(...pitch.map(p => `${html}: ${p}`));
    }
    if (doc.name === 'test-verbatim-font-moreverb-sizes') {
      const sized = await chrome.withPage(pathToFileURL(join(pre, html)).href,
        { width: 1600, javascript: false }, async page => [
          ...await page.evaluate(smallPitch), ...await page.evaluate(listingNumberSize)]);
      problems.push(...sized.map(p => `${html}: ${p}`));
    }
    if (doc.name === 'test-verbatim-font-moreverb-label-sans') {
      const family = await chrome.withPage(pathToFileURL(join(pre, html)).href, { width: 1600, javascript: false },
        page => page.evaluate(`getComputedStyle(document.querySelector('div.listing .tex8web-listing-label')).fontFamily`));
      if (!family.startsWith('"Latin Modern Sans"')) problems.push(`${html}: the listing label in ${family}, not the text's sans`);
    }
    if (doc.name === 'test-verbatim-font-moreverb-label') {
      const label = await chrome.withPage(pathToFileURL(join(pre, html)).href,
        { width: 1600, javascript: false }, async page => [
          ...await page.evaluate(smallPitch), ...await page.evaluate(listingLabelFonts)]);
      problems.push(...label.map(p => `${html}: ${p}`));
    }
    if (doc.name === 'test-verbatim-font-review-spacing') {
      const spacing = await chrome.withPage(pathToFileURL(join(pre, html)).href,
        { width: 390, javascript: false }, page => page.evaluate(moreverbSpaced));
      if (spacing.checked !== 11) problems.push(`${html}: expected eleven moreverb spacing boundaries, found ${spacing.checked}`);
      for (const [text, got, want] of spacing.wrong) {
        problems.push(`${html}: "${text}": ${got} above it, not ${want} as above a list`);
      }
    }
    if (doc.name.startsWith('test-verbatim-font-listings')) {
      const family = doc.name.endsWith('-courier') ? 'TeX Gyre Cursor' : 'Latin Modern Mono';
      problems.push(...(await listingFonts(chrome, join(pre, html), family)).map(p => `${html}: ${p}`));
    }
    if (doc.name.startsWith('test-listing-hmode')) {
      const boxed = await chrome.withPage(pathToFileURL(join(pre, html)).href, { width: 1600, javascript: false },
        page => page.evaluate(boxedListings));
      const want = paragraphListings[doc.name.replace(/-caption-hyperref$/, '-caption')];
      if (boxed.empty) problems.push(`${html}: ${boxed.empty} frames without their listing`);
      if (boxed.inParagraph.join('|') !== want.join('|')) problems.push(`${html}: the listings in paragraphs read '${boxed.inParagraph.join('|')}'`);
      if (doc.name.includes('-caption') && boxed.captions !== 2) problems.push(`${html}: ${boxed.captions} captions of boxed listings, not 2`);
      for (const caption of boxed.offFont) problems.push(`${html}: the caption '${caption}' is not in its paragraph's font`);
    }
    if (doc.name === 'test-boxed-listings') {
      problems.push(...(await chrome.withPage(pathToFileURL(join(pre, html)).href, { width: 390, height: 844 },
        page => page.evaluate(boxedListingScroll))).map(p => `${html}: ${p}`));
      problems.push(...(await chrome.withPage(pathToFileURL(join(pre, html)).href, { width: 740, javascript: false },
        async page => { await page.media('print'); return page.evaluate(boxedListingPrint); })).map(p => `${html}: 740px print: ${p}`));
    }
    if (verbatimFamilies[doc.name] && !verbatimExtraCases[doc.name]) {
      problems.push(...(await literalOpeners(chrome, join(pre, html))).map(p => `${html}: ${p}`));
    }
    if (/^test-verbatim-font-moreverb(?:-courier|-tt)?$/.test(doc.name)) {
      const url = pathToFileURL(join(pre, html)).href, plain = doc.name === 'test-verbatim-font-moreverb';
      problems.push(...(await chrome.withPage(url, { width: 390, javascript: false }, async page => [
        ...await page.evaluate(literalBlockStarts),
        ...(plain ? await page.evaluate(listingWhitespace) : []),
        ...(plain ? await page.evaluate(tabColumns) : []),
        ...(doc.name.endsWith('-tt') ? await page.evaluate(typewriterListing) : []),
        ...(doc.name.endsWith('-tt') ? [] : await page.evaluate(listingNumbers)),
      ])).map(p => `${html}: ${p}`));
      if (!doc.name.endsWith('-tt')) {
        const lines = await chrome.withPage(url, { width: 1600, javascript: false }, page =>
          page.evaluate(listingLines(doc.name === 'test-verbatim-font-moreverb-courier')));
        problems.push(...lines.map(p => `${html}: ${p}`));
      }
      if (plain) {
        problems.push(...(await listingFades(chrome, join(pre, html))).map(p => `${html}: ${p}`));
        problems.push(...(await boxedLiterals(chrome, join(pre, html))).map(p => `${html}: ${p}`));
      }
    }
    if (doc.name === 'test-verbatim-font-kernel' ||
        (verbatimFamilies[doc.name] && !verbatimExtraCases[doc.name])) {
      const count = doc.name === 'test-verbatim-font-kernel' ? 1 : 2;
      problems.push(...(await inlineLiteralLines(chrome, join(pre, html), count)).map(p => `${html}: ${p}`));
    }
  }
  return { lines: [`${problems.length ? 'not ok' : 'ok'} - ${doc.name}`, ...problems.map(p => `    ${p}`)],
    failed: problems.length > 0 };
}

// One document at a time in Chrome: with several tabs at once, headless
// Chrome sometimes draws a garbled screen. Chrome starts after the builds,
// as Chrome holds a build slot, and a process that holds a slot while it
// waits for a build to take another can wait forever.
await building;
const chrome = await launch();
let failures = 0;
const waiting = new Map(docs.map(doc => [doc, built(doc).then(ok => [doc, ok])]));
while (waiting.size) {
  const [doc, ok] = await Promise.race(waiting.values());
  waiting.delete(doc);
  // an error fails the document, not the whole run
  const { lines, failed } = await compare(chrome, doc, ok)
    .catch(error => ({ lines: [`not ok - ${doc.name}`, `    ${error.message}`], failed: true }));
  console.log(lines.join('\n'));
  failures += failed ? 1 : 0;
}
// only with every document: a subset may lack what a check looks for, and
// a shard's counts are summed by --sum
if (shards) {
  mkdirSync(join(root, 'build/visual'), { recursive: true });
  writeFileSync(join(root, `build/visual/ran-${shard}.json`), JSON.stringify({ shard, of: shards, ran }));
}
const never = only.length || shards ? [] : unchecked(ran);
const stray = strayKeys(tocFonts).map(name => `no document ${name} for its contents' fonts`);
stray.push(...strayKeys(laps).map(name => `no document ${name} for its \\lefteqn boxes`));
stray.push(...strayKeys(modernFonts).map(name => `no document ${name} for its math font`));
stray.push(...strayKeys(hangs).map(name => `no document ${name} for its lowered pictures`));
stray.push(...strayKeys(darkPictures).map(name => `no document ${name} for its pictures in dark mode`));
stray.push(...strayKeys(graphicsInside).map(name => `no document ${name} for its graphics in pictures`));
stray.push(...strayKeys(wideBlocks).map(name => `no document ${name} for its wide blocks`));
stray.push(...strayKeys(descLabels).map(name => `no document ${name} for its description labels`));
stray.push(...strayKeys(chapterHeads).map(name => `no document ${name} for its part and chapter headings`));
for (const problem of [...never, ...stray]) console.log(`not ok - ${problem}`);
failures += never.length + stray.length;
const strayLiterals = strayKeys(verbatimFamilies);
for (const name of strayLiterals) console.log(`not ok - no document ${name} for its literal fonts`);
failures += strayLiterals.length;
chrome.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
