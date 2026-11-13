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
const centers = { 'test-display-picture': [37, 14], 'test-display-picture-hyperref': [5, 2] };

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

// Long boxed literals must stay inside their frame on a wide screen and
// in print. On a phone, the literal scrolls inside the frame.
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
          if (${media === 'screen' && width === 390}) {
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
          if (doc.name in hangs) problems.push(...await hanging(page, doc, html));
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
    if (doc.name in hangs) {
      problems.push(...await chrome.withPage(pathToFileURL(join(pre, html)).href, { javascript: false, width: 390, height: 844 },
        page => hanging(page, doc, `${html}: at 390px`)));
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
// only with every document: a subset may lack what a check looks for
const never = only.length ? [] : Object.entries(ran).filter(([, count]) => !count).map(([name]) => `no document for the ${name} check to check`);
const stray = strayKeys(tocFonts).map(name => `no document ${name} for its contents' fonts`);
stray.push(...strayKeys(laps).map(name => `no document ${name} for its \\lefteqn boxes`));
stray.push(...strayKeys(hangs).map(name => `no document ${name} for its lowered pictures`));
for (const problem of [...never, ...stray]) console.log(`not ok - ${problem}`);
failures += never.length + stray.length;
const strayLiterals = strayKeys(verbatimFamilies);
for (const name of strayLiterals) console.log(`not ok - no document ${name} for its literal fonts`);
failures += strayLiterals.length;
chrome.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
