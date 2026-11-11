// npm run test:visual: each test document and example, prerendered and
// typeset by MathJax in the browser, compared screen by screen with
// JavaScript off. Both pages are checked for alignments that line up across
// an \intertext, unclipped math characters, and footnotes in the text's
// color. The prerendered page is also checked for a hidden theme button,
// headings spaced as in LaTeX, tables in the text spaced as paragraphs,
// the rest of each \hfill at the right, algorithm2e's numbers and
// captions, list labels on their text's baseline, ties as wide as a
// space and with no line break after them, the fonts of the table of
// contents, printing, and a width that fits a phone.
// Needs Chrome and the network. Differing screens are saved in
// build/visual/<document>/visual/.
//   node test/visual.mjs [document names...]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, largestFirst, pool, root, select, strayKeys, testDir, workers } from './lib/build.mjs';
import { launch } from './lib/chrome.mjs';

const only = process.argv.slice(2);
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
// the system and the reader: light mode's colors and pictures, and no page
// controls. Then at the width of Letter paper inside Chrome's margins:
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
    // (and into an inline that starts with a block, as MathJax's display)
    while ((next = first(line)) && (block(next) || next.nodeType === Node.ELEMENT_NODE && block(first(next)))) line = next;
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
// column. In an alignment, a box alone in its cell is at the edge of the
// cell that the column's alignment gives, as in the PDF: the right edge in
// eqnarray's first column, the left edge in its third. A table with
// numbers stays centered while the content of its boxes beside the numbers
// ends an em before them, as in the PDF. Checked with JavaScript off and
// on a phone. laps has the number of boxes on each page checked. Failures:
// [the box's text, what is wrong]
const lapped = `(() => {
  // (\\llap's box moves its content left, in an mjx-rbox)
  const boxes = [...document.querySelectorAll('mjx-mpadded')].filter(box => !box.querySelector(':scope > mjx-block > mjx-rbox'));
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
      if (content.width < right - left + 0.5) problems.push(\`its cell \${(right - left).toFixed(2)}px wide holds its content \${content.width.toFixed(2)}px wide\`);
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
    return problems.map(what => [text, what]);
  });
  for (const table of document.querySelectorAll('mjx-mtable:has(> mjx-labels):has(mjx-mpadded)')) {
    const rect = table.getBoundingClientRect(), inner = table.querySelector(':scope > mjx-table > mjx-itable').getBoundingClientRect();
    const shift = (inner.left + inner.right - rect.left - rect.right) / 2;
    const near = numbers(table), em = parseFloat(getComputedStyle(table).fontSize);
    const reach = Math.max(inner.right, ...[...table.querySelectorAll('mjx-mpadded')]
      .map(box => box.firstElementChild.firstElementChild.getBoundingClientRect())
      .filter(content => near.some(([, n]) => beside(content, n))).map(content => content.right));
    if (inner.left - shift >= rect.left && near.every(([, n]) => reach - shift < n.left - em) && Math.abs(shift) > 0.5) {
      wrong.push([table.textContent.slice(0, 20), \`its table \${shift.toFixed(2)}px from the center\`]);
    }
  }
  return { checked: boxes.length, wrong };
})()`;
const laps = { 'test-lefteqn': 15 };

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
const docs = select(only).filter(doc => !['test-split', 'test-cutat'].includes(doc.name));
// Each document is built twice, prerendered (html) and for MathJax in the
// browser (fallback), a few builds at a time, the largest first. The
// prerendered build is npm test's, reused if npm test has made it.
const variants = [[testDir, 'html', 'aux', { TEX8WEB_MATHML: '1' }],
  [doc => testDir(doc, 'visual'), 'fallback', 'fallbackaux', { TEX8WEB_NO_PRERENDER: '1' }]];
const builds = largestFirst(docs).flatMap(doc => variants.map(([dir, out, aux, env]) =>
  ({ doc, dir: dir(doc), out, aux, env, ...Promise.withResolvers() })));
const building = pool(builds, workers, async ({ doc, dir, out, aux, env, resolve }) => {
  resolve((await build(doc, join(dir, out), join(dir, aux), env)).code);
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
        if (file !== typeset) {
          // the theme button needs tex8web-page.js, which is not running
          if (await page.evaluate(`document.querySelector('.tex8web-theme').checkVisibility()`)) {
            problems.push(`${html}: the theme button shown with JavaScript off`);
          }
          const under = await page.evaluate(spaced);
          ran.spaced += under.checked;
          for (const [id, gap, want] of under.wrong) problems.push(`${html}: #${id}: what follows it ${gap}px below, not ${want}px`);
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
    for (const check of [printed, fits]) {
      problems.push(...(await check(chrome, join(pre, html))).map(p => `${html}: ${p}`));
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
// only with every document: a subset may lack what a check looks for
const never = only.length ? [] : Object.entries(ran).filter(([, count]) => !count).map(([name]) => `no document for the ${name} check to check`);
const stray = strayKeys(tocFonts).map(name => `no document ${name} for its contents' fonts`);
stray.push(...strayKeys(laps).map(name => `no document ${name} for its \\lefteqn boxes`));
for (const problem of [...never, ...stray]) console.log(`not ok - ${problem}`);
failures += never.length + stray.length;
chrome.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
