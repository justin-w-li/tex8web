// npm test: the Lua unit tests, then every test document and example built
// with make4ht and checked, while the tools' tests run beside them. Pages go
// to build/test/<document>/html.
//   node test/run.mjs [document names...]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, expected, largestFirst, pool, root, select, strayKeys, testDir, workers } from './lib/build.mjs';
import { checkLog, checkOutput, checkTexLog } from './lib/check.mjs';

const only = process.argv.slice(2);
const docs = select(only);
let failures = 0;

// problems test/expected.json lists for a document (allow: substrings of
// them, why: the reason) are reported but don't fail it; one listed that
// no longer happens does, so that the list stays true
function report(name, problems) {
  const { allow = [], why } = expected[name] || {};
  const known = problems.filter(p => allow.some(a => p.includes(a)));
  const failed = problems.filter(p => !known.includes(p));
  for (const a of allow.filter(a => !problems.some(p => p.includes(a)))) failed.push(`allowed in test/expected.json, but fixed: ${a}`);
  console.log(`${failed.length ? 'not ok' : 'ok'} - ${name}${known.length ? ` # known: ${why}` : ''}`);
  for (const problem of [...new Set(failed)].slice(0, 12)) console.log(`    ${problem}`);
  failures += failed.length ? 1 : 0;
}

// --- unit tests ------------------------------------------------------------

if (!only.length) {
  const unit = spawnSync('texlua', [join(root, 'test/unit/run.lua')], { encoding: 'utf8' });
  process.stdout.write(unit.stdout + unit.stderr);
  failures += unit.status === 0 ? 0 : 1;
}

// the tools' tests, which take their build slots from a pool of their own and
// so don't wait for the builds below, or for anyone's. Their report comes at
// the end
const tools = only.length ? null : new Promise(done => {
  const files = ['unit/prerender', 'slots', 'builds', 'realbuild', 'regress', 'tools'].map(name => join(root, `test/${name}.test.mjs`));
  const child = spawn(process.execPath, ['--test', ...files], { timeout: 300000 });
  let report = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { report += data; });
  child.on('close', (code, signal) => done({ report: signal ? `${report}\nthe tools' tests were stopped by ${signal} after their 300 s limit\n` : report, code }));
});

// --- builds ----------------------------------------------------------------

// what tex8web measures in a document, as custom properties in its
// stylesheet. Each test document sets what it measures:
// - titlesec's spacing in its *n form, and a \titleformat's space after the
//   label, in the bold font's ems;
// - a title's own size, and framed's space around its box (\topsep);
// - report's contents, with sections indented from chapters, and a chapter's
//   title and label;
// - the abstract's leading, \small's 12pt over the text's 13.6pt;
// - tocloft's font for each level of the contents.
// <html>'s classes: \WebLikePDF's justified, hyphenated text, and links
// not underlined, colored with colorlinks or hidden with hidelinks.
// (Every other document has none: test-generic's boxed links underlined)
const switched = {
  'test': 'tex8web-plain-links', 'test-hidelinks': 'tex8web-plain-links',
  'test-declared': 'tex8web-plain-links', 'examples/basic': 'tex8web-plain-links',
  'examples/complex': 'tex8web-plain-links', 'test-likepdf': 'tex8web-like-pdf',
};
const measured = {
  'test-generic': { '--tex8web-section-before': '1.19598em', '--tex8web-section-after': '0.4485em',
    '--tex8web-section-after-text': '0.64583em', '--tex8web-section-labelsep': '1.125em',
    '--tex8web-title-size': '1.44em', '--tex8web-framed-sep': '0.8em' },
  // (and test.cfg's \WebColor, from an xcolor expression and an RGB color)
  // (the link colors, also with only the color package, in the example)
  'test': { '--highlight': 'light-dark(#FFFFCC, #4A4325)', '--tex8web-abstract-leading': '0.88235',
    '--tex8web-link': 'light-dark(#FF0000, var(--tex8web-link-dark))' },
  'examples/basic': { '--tex8web-url': 'light-dark(#0000FF, var(--tex8web-url-dark))' },
  'test-tocentry': { '--tex8web-toc-chapter-skip': '1em' },
  'test-report': { '--tex8web-toc-chapter-number': '1.5em', '--tex8web-toc-chapter-skip': '1em',
    '--tex8web-toc-chapter-weight': 'bold', '--tex8web-toc-section-indent': '1.5em',
    '--tex8web-toc-section-number': '2.3em', '--tex8web-toc-subsection-indent': '3.8em',
    '--tex8web-toc-section-skip': '0em', '--tex8web-toc-section-weight': 'normal',
    '--tex8web-chapter-size': '2.488em', '--tex8web-chapter-label-size': '0.8336em' },
  // (\WebLikePDF in an 11pt document: its size, \baselineskip 13.6pt,
  // \parindent 17pt and \parskip 0pt)
  'test-likepdf': { '--tex8web-pdf-size': '10.95pt', '--tex8web-pdf-leading': '1.242',
    '--tex8web-parindent': '1.5525em', '--tex8web-parskip': '0em' },
  // (an article without titlesec: its \@startsection's space around a
  // section, 3.5ex and 2.3ex of the text, and a subsection, 3.25ex and
  // 1.5ex, in the heading's ems; the abstract's quotation's margins; and
  // \footnotesize's leading, 9.5pt over 12pt)
  'test-article': { '--tex8web-section-before': '1.0465em', '--tex8web-section-after': '0.6877em',
    '--tex8web-subsection-before': '1.16609em', '--tex8web-subsection-after': '0.5382em',
    '--tex8web-abstract-left': '2.5em', '--tex8web-abstract-right': '2.5em',
    '--tex8web-footnote-leading': '0.79167', '--tex8web-biblabelsep': '0.5em',
    '--tex8web-leftmargin': '2.5em' },
  // (tocloft's \cft<level>font: \Large\scshape; \normalfont\itshape; \itshape;
  // \bfseries; \large\sffamily; \ttfamily; \slshape)
  'test-tocloft': { '--tex8web-toc-part-size': '1.44', '--tex8web-toc-part-variant': 'small-caps',
    '--tex8web-toc-chapter-style': 'italic', '--tex8web-toc-chapter-weight': 'normal',
    '--tex8web-toc-section-style': 'italic', '--tex8web-toc-section-weight': 'normal',
    '--tex8web-toc-subsection-weight': 'bold', '--tex8web-toc-subsubsection-size': '1.2',
    '--tex8web-toc-subsubsection-family': 'var(--tex8web-sans)',
    '--tex8web-toc-paragraph-family': 'var(--tex8web-mono)', '--tex8web-toc-subparagraph-style': 'italic' },
};

// what tex8web.js makes of test.tex's math through MathJax's internals,
// which a new MathJax must keep:
// - \bigl( to \Biggl\langle in TeX's four sizes, scaled to the 10pt
//   extension font in an 11pt document;
// - a big bar a little taller, and a large operator scaled around it;
// - an align's rows on TeX's struts, \jot apart;
// - inline math broken after a relation.
const typeset = {
  'test': [
    /<mjx-mo style='font-size: 91.3%;'><mjx-c class='mjx-c28 TEX-SO'>\(/,
    /<mjx-mo style='font-size: 91.3%;'><mjx-c class='mjx-c5B TEX-LO'>\[/,
    /<mjx-mo style='font-size: 91.3%;'><mjx-c class='mjx-c7B TEX-S3'>\{/,
    /<mjx-mo style='font-size: 91.3%;'><mjx-c class='mjx-c27E8 TEX-S4'>⟨/,
    /<mo [^>]*maxsize='1.234em' minsize='1.234em'[^>]*>\|<\/mo>/,
    /<mstyle mathsize='91.3%'><mtext>∑<\/mtext><\/mstyle>/,
    /<mtable [^>]*data-tex8web-env='align'[^>]*rowspacing='0.274em'/,
    /<mspace depth='0.373em' height='0.869em' width='0em'>/,
    /<mo linebreakstyle='after'>=<\/mo>/,
  ],
};

// what screen readers hear: ClearSpeak's words, | as "given", no "normal"
// before an upright letter, Δ as "Delta", and A^\top as "A transpose"
const speech = {
  'test': [/aria-label='P of open paren A given B close paren'/, /aria-label='Gamma of z'/,
    /aria-label='d x'/, /aria-label='Delta of S'/, /aria-label='A transpose'/,
    /^(?![^]*down tack)/, /aria-label='x sub i transpose'/],
};

// pictures sized by \includegraphics's width, scale or height: a share of
// the PDF's text width, which holds as a narrower screen reflows the text
const share = (alt, fraction) => new RegExp(`<img alt='${alt}' [^>]*style='width:calc\\(var\\(--tex8web-textwidth\\) \\* ${fraction.replace('.', '\\.')}\\)'`);
const pictures = {
  // (in a 345pt text width, for a picture 64bp by 48bp: 100pt wide, 1.5
  // times its size, 96pt high so 128pt wide, 100pt by 40pt with
  // keepaspectratio and without, which never squashes it; and one
  // without a size, as tex4ht writes it)
  'test-graphics': [share('width', '0.2899'), share('scale', '0.2793'), share('height', '0.371'),
    share('both', '0.2899'), share('fitted', '0.1546'), share('angle last', '0.2899'), /<img alt='bare' (?:(?!style=)[^>])*\/>/,
    // (a size after angle, scale with a size: tex4ht's)
    ...['rotated', 'scaled first', 'scaled last'].map(alt => new RegExp(`<img alt='${alt}' (?:(?!style=)[^>])*\\/>`))],
  // (the graphics package: a bare picture without a .xbb, tex4ht's size)
  'test-graphics-only': [/<img (?:(?!style=)[^>])*\/>/],
  'examples/basic': [/<img [^>]*style='width:calc\(var\(--tex8web-textwidth\) \* 0\.25\)'/],
  // (in minipages, whose \textwidth is their own)
  'test': [/<img [^>]*style='width:calc\(var\(--tex8web-textwidth\) \* 0\.225\)'/,
    /<img [^>]*style='width:calc\(var\(--tex8web-textwidth\) \* 0\.45\)'/],
};

// the title of a page without \maketitle: \title's text, as \maketitle
// gives it (without the \thanks), for the tab and the link preview
const titles = {
  'test-title': [/<title>Notes on Groups\s+and Rings<\/title>/,
    /<meta content='Notes on Groups\s+and Rings' property='og:title' \/>/],
  'test-nomaketitle': [/<title>Without a maketitle<\/title>/],
};

// \today, as lib/build.mjs's fixed date
const dates = {
  'test-letter': [/January 1, 2000/],
  'test-declared': [/January 1, 2000/],
};

// minipages and subfigures, two in one row, each with its share of the
// PDF's text width and its position
const minipages = {
  'test': [
    /<div class='tex8web-minipages'><div class='minipage[^']* tex8web-minipage-c' style='--tex8web-share: 0\.45'>(?:(?!tex8web-minipages)[^])*<div class='minipage tex8web-minipage-c' style='--tex8web-share: 0\.45'>/,
    /<div class='tex8web-minipages'><div class='subfigure[^']* tex8web-minipage-[tcb]' style='--tex8web-share: 0\.48'>(?:(?!tex8web-minipages)[^])*<div class='subfigure tex8web-minipage-[tcb]' style='--tex8web-share: 0\.48'>/,
  ],
};

// the index's entries, a subentry, a range and a "see", each number a
// link back to where its \index is (numbered as tex4ht does, not by page)
const index = {
  'test-index': [
    /A group<a id='([^']+)'>[^]*<div class='index-item'>group, <a href='#\1'>1<\/a>, <a href='#[^']+'>5<\/a>/,
    /<a id='([^']+)'><\/a>An abelian group[^]*<div class='index-subitem'>abelian, <a href='#\1'>2<\/a>/,
    /<div class='index-item'>ring, <a href='#[^']+'>3<\/a>–<a href='#[^']+'>6<\/a>/,
    /<div class='index-item'>module, <span[^>]*>see <\/span>ring/,
    // (numbers in an entry's text, not links)
    /The space<a id='([^']+)'>[^]*<div class='index-item'>(?:(?!<a |<\/div>)[^])*<msup><mi>L<\/mi><mn>2<\/mn><\/msup>(?:(?!<a |<\/div>)[^])* space, <a href='#\1'>8<\/a> <\/div>/,
    /theorem<a id='([^']+)'><\/a><a id='([^']+)'>[^]*<div class='index-item'>Theorem, 2nd form, <a href='#\1'>9<\/a> <\/div>/,
    /theorem<a id='([^']+)'><\/a><a id='([^']+)'>[^]*<div class='index-subitem'>cyclic, of order 2, <a href='#\2'>10<\/a> <\/div>/,
    // (three in a row, three links: not a range, as makeindex -r)
    /<div class='index-item'>set, <a href='#[^']+'>11<\/a>, <a href='#[^']+'>12<\/a>, <a href='#[^']+'>13<\/a> <\/div>/,
  ],
  // imakeidx's: the main index, and one of names with its title and style
  // file (" : " before the numbers)
  'test-imakeidx': [
    /Groups<a id='([^']+)'>[^]*>Index<\/h3>\s*<div class='theindex'>(?:(?!<h3)[^])*<div class='index-item'>group, <a href='#\1'>1<\/a> <\/div>/,
    /Galois<a id='([^']+)'>[^]*>Index of names<\/h3>[^]*<div class='index-item'>Galois : <a href='#\1'>1<\/a> <\/div>/,
    /theorem<a id='([^']+)'>[^]*>Index of names<\/h3>[^]*<div class='index-item'>Euler : <a href='#\1'>2<\/a> <\/div>/,
  ],
};

// the table of contents beside the text, under the document's title (a link
// to the top). It is titled by its heading, or by \contentsname in the
// document's letters, and has chapters' numbers in their boxes. A list of
// figures before it stays in the text.
const titled = name => [new RegExp(`<button aria-label='${name}' class='tex8web-control tex8web-contents'[^>]* title='${name}'`),
  new RegExp(`<p class='tex8web-toc-title' id='tex8web-toc-title'>${name}</p>`)];
const contents = {
  // (and test.cfg's \WebUp, the first of the controls, with its # and &)
  'test': [/<div class='tex8web-controls'><a aria-label='Up' class='tex8web-control tex8web-up' href='https:\/\/example\.com\/notes\/\?a=1&amp;b=2#top'/],
  'test-russian': titled('Содержание'),
  'test-greek': titled('Περιεχόμενα'),
  'test-report': [
    /<nav [^>]*id='tex8web-toc'[^>]*><a class='tex8web-toc-doctitle' href='#'>[^<]+<\/a><p [^>]*>Contents<\/p><input [^>]*><div class='tableofcontents'>(?:(?!<\/nav>)[^])*<span class='chapterToc'><span class='tocnumber'>1<\/span>/,
    /<\/nav>(?:(?!<\/nav>)[^])*<div class='tableofcontents'>\s*<span class='lofToc'>/,
  ],
};

// the text in its own font, after font commands the PDF keeps in a group:
// a \contentsname in small capitals, and an \intertext in italics
const fonts = {
  // (and after a \tikz picture, a footnote's emphasis; the LaTeX logo's
  // letters, each where the stylesheet moves it)
  'test-article': [/<span class='cmti-8'>emphasized<\/span>/,
    /<span class='tex8web-latex'>L<span class='tex8web-a'>A<\/span><span class='tex8web-tex'>T<span class='tex8web-e'>E<\/span>X<\/span><\/span>/],
  'test-fonts': [/<p class='noindent'>The text, in its own font\./,
    /<span class='tex8web-intertext'>Another note\.\s*<\/span>/],
  // (a title in the font a redefined \maketitle sets, in a heading at the
  // text's size)
  'test-titlefont': [/<h1 class='titleHead'><span\s+class='bchb7t-x-x-240'>A title in its own font<\/span><\/h1>/],
};

// colors in dark mode: at another lightness, as a light-dark() of the
// color, and black text in the page's text color. That holds for
// \textcolor, \colorbox, \fcolorbox, listings and math, a \rule too.
// Math and table cells have the colors xcolor gives them: a document's own
// (ink), a \colorlet (ember), a mix, and green, which CSS has darker.
const lightDark = (color, property) =>
  `light-dark\\(${color}, oklch\\(from ${color} var\\(--tex8web-dark-${property}\\) c h\\)\\)`;
const dark = hex => `light-dark(${hex}, oklch(from ${hex} var(--tex8web-dark-color) c h))`;
const text = (hex, html) => `<span style='color:${dark(hex)};'>${html}</span>`;
// (a list's own lengths, before its color)
const list = '--tex8web-list-topsep: 0.8em; --tex8web-list-itemsep: 0.8em; --tex8web-list-indent: 2.5em; --tex8web-list-labelsep: 0.5em; ';
const colors = {
  'test-color': [
    new RegExp(`<span style='color:${lightDark('#000080', 'color')};'>navy</span>`),
    /<span style='color:var\(--tex8web-text\);'>black<\/span>/,
    new RegExp(`#colorbox1\\{background-color:${lightDark('#FFFFB2', 'background')};\\}`),
    new RegExp(`#colorbox2\\{border: solid 1px ${lightDark('#0000FF', 'border')};\\}`),
    new RegExp(`<mjx-mstyle style='color: ${lightDark('red', 'color')};'>`),
    /<mjx-mstyle style='color: var\(--tex8web-text\);'>/,
    new RegExp(`<mjx-mpadded style='background-color: ${lightDark('yellow', 'background')};'>`),
    new RegExp(`<mjx-mpadded [^>]*style='border: \\S+ solid ${lightDark('blue', 'border')};`),
    /<mjx-mspace style='background-color: var\(--tex8web-text\);/,
    // (ink, red!50!black, green, ember, red!50!yellow in a macro)
    ...['#c80064', '#800000', '#00ff00', '#640032', '#ff8000'].map(hex =>
      new RegExp(`<mjx-mstyle style='color: ${lightDark(hex, 'color')};'>`)),
    // (gray!50, ink!50!yellow!50, -ink, -red!50!black; Apricot, Blue!50, Azure3; HTML, cmyk, Gray;
    // in CMYK as xcolor has them, olive!50, BrickRed!30, Mahogany!40!Goldenrod (svgnames' rgb one),
    // -BrickRed!40;
    // BrickRed, given to a macro)
    ...['#bfbfbf', '#f1bf98', '#37ff9b', '#80ffff', '#ffad7a', '#8080ff', '#c1cdcd', '#3366cc', '#803399', '#888888',
      '#bfbf40', '#eaa5a2', '#c54f00', '#1d777c', '#b80000'].map(hex =>
      new RegExp(`<mjx-mstyle style='color: ${lightDark(hex, 'color')};'>`)),
    new RegExp(`#TBL-1-1- td\\{ background-color:${lightDark('#FFFFB2', 'background')}\\}`),
    new RegExp(`#TBL-1-2-1\\{ background-color:${lightDark('#F1BFD8', 'background')}\\}`),
    // (a complement, which tex4ht gives no rule)
    new RegExp(`#TBL-1-3- td\\{ background-color:${lightDark('#37FF9B', 'background')}\\}`),
    new RegExp(`#TBL-1-3-2\\{ background-color:${lightDark('#37FF9B', 'background')}\\}`),
    /<pre class='lstlisting'[^>]*>(?:(?!<\/pre>)[^])*<span style='color:var\(--tex8web-text\)'>/,
  ],
  // \color as a declaration: in spans that end with its group, a block
  // wholly in it colored itself, nothing left open past an element tex4ht
  // closes. The theorem's head isn't colored, as in the PDF; a footnote, a
  // link (urlcolor) and a box keep their own colors. (The author, with \and,
  // \\ and \thanks, is in article's tabular)
  'test-declared': [
    `<h1 class='titleHead'>${text('#0000FF', 'Colors')}<span class='thank-mark'>`,
    `<div class='author'>${text('#FF0000', "<span class='cmr-12'>Someone</span>")} <br class='and' />`,
    `Heading ${text('#0000FF', 'in blue')}</h3>`,
    `A ${text('#FF0000', 'red')} word, ${text('#000080', 'a mix')}, ${text('#008000', 'a model')} and `
      + `${text('#0A7828', `leaf ${text('#FF0000', 'red')} leaf`)}. `
      + `${text('#FF0000', "Red, <span style='color:var(--tex8web-text);'>black,</span> red")}, `
      + `<span class='colorbox' id='colorbox1'>boxed</span>, `
      + `<span class='colorbox' id='colorbox2'>${text('#FF0000', 'red boxed')}</span>,\n`
      + `<a href='#here'>${text('#FF0000', 'linked')}</a> after.`,
    `<p class='indent' style='color:${dark('#0A7828')};'>   A first paragraph in leaf.\n</p>`,
    `<p class='indent'>${text('#0A7828', '   A second paragraph in leaf.')}\n</p>`,
    `Black ${text('#FF0000', 'until the end.\n')}</p>`,
    `<span class='cmbx-10'>Theorem 1.</span>  </span>${text('#FF0000', "<span class='cmti-10'>A red theorem.</span>\n")}</p>`,
    `<p class='noindent' style='color:${dark('#0000FF')};'>Centered in blue.</p>`,
    `<p class='noindent'>${text('#0000FF', 'In a minipage.\n')}`,
    `<ul class='tex8web-list itemize' role='list' style='${list}color:${dark('#FF0000')};'>`,
    // (an item's label in a color set in the item before it)
    `</div></li><li style='color:${dark('#FF0000')};'><span aria-hidden='true' class='tex8web-label'>`,
    `<span class='cmr-8'>In the text’s color.</span></p></aside>`,
    `and <a href='https://example.com'>a link</a>, by <a href='#x1-1001r1'>${text('#008080', 'theorem')}`,
    `In the box’s colors, ${text('#FF0000', 'and red')}.</p>`,
    // (an inner color on a block wins; a color set at a box's start, whose
    // group tex4ht ends after the box; a theorem and minipages wholly in a
    // color; a float, which LaTeX sets in the text's color; a box copied
    // after its group ended, which colors nothing after it; a color never
    // closed, which leaves the footnotes in the text's color, as LaTeX's
    // \@makecol does, also one test:visual finds in the abstract it colors)
    `<p class='indent' style='color:${dark('#FF0000')};'>   Red. </p>\n     <ul class='tex8web-list itemize' role='list' style='${list}color:${dark('#0000FF')};'>`,
    `<div class='newtheorem' style='color:${dark('#FF0000')}; margin-top:`,
    `<p class='noindent' style='color:${dark('#FF0000')};'>Red from the box’s start.</p>`,
    `<div class='tex8web-minipages'><div class='minipage tex8web-minipage-c' style='--tex8web-share: 0.4; color:${dark('#FF0000')};'>`,
    `<figure class='figure' id='x1-10051'>`,
    `<p class='indent'>   Black at the end, and a note in a table:`,
    `<p class='indent' style='color:${dark('#FF00FF')};'>   Magenta to the end.\n</p>\n   <section class='abstract' role='doc-abstract' style='color:${dark('#FF00FF')};'>`,
    `</section>\n   <div class='footnotes'>`,
  ].map(html => new RegExp(html.replace(/\s+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).concat(/<head>\s*<title>Colors<\/title>/),
  // table colors as the PDF has them (the document loads colortbl before
  // xcolor's table option, which the build errors on without the fix):
  // \rowcolors' alternating rows, from the row it starts at, then
  // \columncolor, \rowcolor[HTML], \cellcolor, and a \rowcolor on a
  // \multicolumn's row
  // (xcolor without colortbl, whose extension would bring MathJax's color
  // extension with it: a document's color, one \colorlet names, a model)
  'test-color-math': ['#c80064', '#00ff00', '#3366cc'].map(hex =>
    new RegExp(`<mjx-mstyle style='color: ${lightDark(hex, 'color')};'>`)),
  'test-colortbl': [
    // (\rowcolors' on the rows, under the cells' colors)
    ...[['1-1-', 'FFE5E5'], ['1-2-', 'E5E5FF'], ['1-3-', 'FFE5E5'], ['2-2-', 'E5FFE5'], ['2-4-', 'E5FFE5'],
      ['6-1-', 'FFE5E5'], ['6-2-', 'E5E5FF'], ['4-1- td', 'DDEEFF'], ['5-2- td', 'BFFFBF'], ['6-2- td', '00FF00'],
      ['3-1-1', 'CCFFCC'], ['3-2-1', 'CCFFCC'], ['4-2-1', 'F1BFD8'], ['5-1-1', 'F1BFD8'], ['6-1-2', 'FFFF00']]
      .map(([selector, hex]) =>
        new RegExp(`#TBL-${selector}\\{ background-color:${lightDark(`#${hex}`, 'background')}\\}`)),
    // (\rowcolors{2}{}{...} leaves the first row and every odd one without)
    /^(?![^]*#TBL-2-(?:1|3|5)-\{)/,
  ],
};

// lists as LaTeX sets them: each label as TeX typesets it (article's bullet
// and dash, an \item's own, enumerate's (a)), and each list with its own
// lengths. Screen readers skip itemize's own bullets, which say nothing,
// and read every other label; role='list' keeps VoiceOver reading a list
// whose items show no marker. Also a citation in biblatex's form, a link
// within the page, and the bibliography's heading once in the contents,
// where the document adds it.
const item = (label, hidden) => `<li><span ${hidden ? "aria-hidden='true' " : ''}class='tex8web-label'>\\s*${label}\\s*<\\/span><div>\\s*<p class='noindent'>`;
const lists = {
  'test-article': [
    new RegExp(`<ul class='tex8web-list itemize' role='list' style='--tex8web-list-topsep: 0\\.8em; --tex8web-list-itemsep: 0\\.8em; --tex8web-list-indent: 2\\.5em; --tex8web-list-labelsep: 0\\.5em'>${item('•', true)}One,`),
    new RegExp(`<ul class='tex8web-list itemize' role='list' style='[^']*--tex8web-list-indent: 2\\.2em;[^']*'>${item("<span class='[^']+'>–<\\/span>", true)}inside\\.`),
    new RegExp(`${item("<mjx-container aria-label='star'[^]*?")}A label of its own\\.`),
    new RegExp(`<ol class='tex8web-list enumerate' role='list' [^>]*>${item('1\\.')}First,`),
    new RegExp(`${item('\\(a\\)')}inside\\.`),
    // (an \item's own label, read though a list follows at once)
    new RegExp(`${item('Case 1')}\\s*<\\/p>\\s*<ul`),
  ],
  // (an item's paragraphs, each a paragraph of its own; enumitem's
  // description kind as a description list, whose terms are read)
  'test': [/<p class='noindent'>Bullet with a second paragraph\.\s*<\/p><p class='noindent'>The second paragraph\./],
  'test-generic': [new RegExp(`<ol class='tex8web-list enumitem-steps' [^>]*>${item('Step 1\\.')}First\\.`),
    new RegExp(`${item('Note:')}A label of the list’s own\\.`), new RegExp(`${item('•', true)}The class’s bullet\\.`),
    /<dl class='tex8web-list enumitem-terms' [^>]*><div><dt>\s*<span class='cmbx-10'>Term<\/span>\s*<\/dt><dd>\s*<p class='noindent'>A list of/],
  'examples/complex': [
    /see \[<a id='[^']*'><\/a><a id='[^']*'><\/a><a href='#X0-evanchen'>1<\/a>/,
    /^(?![^]*<a href='main\.html)/,
    /<nav (?:(?!<\/nav>)[^])*>References<(?:(?!<\/nav>|>References<)[^])*<\/nav>/,
    // (with Latin Modern in T1, a bullet that is \textbullet's •)
    new RegExp(`${item('•', true)}<a href='https:\\/\\/castel\\.dev\\/'>`),
  ],
};

// a \tikz picture as wide as what it draws: a circle at its origin, which
// tex4ht's SVG (dvisvgm's, scaled 1.4) centers on it
const tikz = { 'test-article': 'test-article0x.svg' };

// a term (\WebTerm), with its id for the contents' filter; in a heading,
// only its text in the heading's id and contents entry
const terms = {
  'test': [/<span class='tex8web-term' id='term-inner-product'>/, /<span class='tex8web-term' id='term-ball'>/],
  'test-term': [/<h3 class='sectionHead' id='the-group-law'>/, /<a href='#the-group-law' id='[^']*'>The <span class='cmbx-10'>group\s*<\/span>\s*law<\/a>/,
    /<h3 class='sectionHead' id='the-ring-law'>/, /<a href='#the-ring-law' id='[^']*'>The <span class='cmbx-10'>ring\s*<\/span>\s*law<\/a>/],
};

// links at the heads of numbered theorems and the titles of numbered or
// labelled boxes, to the anchor a \ref to one leads to; none at an
// unnumbered one's
const permalinks = {
  'test-tcolorbox': [
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>1:[^]*<a href='#\1'>1</,
    /<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink'[^>]*>#<\/a>\s*<p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>2:/,
    /<div class='tcolorbox-title'>\s*<p[^>]*>\s*Theorem:/,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Labelled box[^]*<a href='#\1'>/,
    /<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink'[^>]*>#<\/a>\s*<p[^>]*>\s*Exercise/,
    /<div class='tcolorbox-title'>\s*<p[^>]*>\s*In a raster/,
    /<div class='tcolorbox-title'>\s*<p[^>]*>\s*Also in a raster/,
    // (a box inside another, each with its own anchor, \ref and number)
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>3:<span class='tex8web-nbsp'>.<\/span>Outer[^]*<a href='#\1'>3</,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>4:<span class='tex8web-nbsp'>.<\/span>Inner/,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Outer box[^]*<a href='#\1'>1<!--\s*tex4ht:ref: outerbox /,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Inner box[^]*<a href='#\1'>1<!--\s*tex4ht:ref: innerbox /,
    // (a \tcbox on line in its paragraph's line, with a title and in a
    // box; one with tcolorbox's space around it a block of its own)
    /A word <span class='tcolorbox tcbox' id='[^']+'>\s*<span class='tcolorbox-content'>boxed<\/span><\/span> in its line, <span class='tcolorbox tcbox' id='[^']+'>\s*<span class='tcolorbox-title'>T\s*<\/span><span class='tcolorbox-content'>titled<\/span><\/span> one too, and <\/p><div class='tcolorbox [^']*' id='[^']+'>\s*<div class='tcolorbox-content'>alone/,
    /<p[^>]*>And <span class='tcolorbox tcbox' id='[^']+'>\s*<span class='tcolorbox-content'>one<\/span><\/span> in a box\./,
    // (and a boxed title's)
    /<div class='tcolorbox tcolorbox tex8web-tcb-boxed-center' id='[^']+'><a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>/,
  ],
  'examples/custom': [
    /<div class='tcolorbox theorem' id='[^']+'><a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>/,
    /<div class='tcolorbox proof' id='[^']+'>\s*<div class='tcolorbox-title'>\s*<p/,
  ],
  'examples/complex': [
    /<div class='tcolorbox definition' id='[^']+'><a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*<span[^>]*>Definition<span class='tex8web-nbsp'>.<\/span>1\.2[^]*Note that <a href='#\1'><span style='color:[^']*;'>Definition/,
  ],
  'test-ntheorem': [
    /<span class='head'><a [^>]*class='tex8web-permalink' href='#([^']+)'>#<\/a><a id='\1'><\/a>\s*<span class='cmbx-10'>Theorem<span class='tex8web-nbsp'>.<\/span>1\.1<\/span>[^]*<a href='#\1'>1\.1</,
    /<span class='head'><a [^>]*class='tex8web-permalink'[^>]*>#<\/a><a id='[^']+'><\/a>\s*<span class='cmbx-10'>Theorem<span class='tex8web-nbsp'>.<\/span>1\.2/,
    /<span class='head'>\s*<span class='cmbx-10'>Remark</,
  ],
  // (LaTeX's own: one with a note, one sharing its counter, one numbered
  // within sections; and with hyperref, which adds an anchor of its own)
  'test-newtheorem': [
    /<span class='head'><a [^>]*class='tex8web-permalink' href='#([^']+)'>#<\/a><a id='\1'><\/a>\s*<span class='cmbx-10'>Theorem<span class='tex8web-nbsp'>.<\/span>1<\/span>[^]*<a href='#\1'>1</,
    /<span class='head'><a [^>]*class='tex8web-permalink' href='#([^']+)'>#<\/a><a id='\1'><\/a>\s*<span class='cmbx-10'>Theorem<span class='tex8web-nbsp'>.<\/span>2<span class='tex8web-nbsp'>.<\/span>\(A note\)<\/span>[^]*<a href='#\1'>2</,
    /<span class='head'><a [^>]*class='tex8web-permalink' href='#([^']+)'>#<\/a><a id='\1'><\/a>\s*<span class='cmbx-10'>Lemma<span class='tex8web-nbsp'>.<\/span>3<\/span>[^]*<a href='#\1'>3</,
    /<span class='head'><a [^>]*class='tex8web-permalink' href='#([^']+)'>#<\/a><a id='\1'><\/a>\s*<span class='cmbx-10'>Remark<span class='tex8web-nbsp'>.<\/span>1\.1<\/span>[^]*<a href='#\1'>1\.1</,
  ],
  'test-newtheorem-hyperref': [
    /<span class='head'><a [^>]*class='tex8web-permalink' href='#([^']+)'>#<\/a><a id='\1'><\/a>\s*<a id='theorem\.1'><\/a>\s*<span class='cmbx-10'>Theorem<span class='tex8web-nbsp'>.<\/span>1<\/span>[^]*<a href='#\1'>1</,
  ],
};

// amsthm's QED box. After text, in a display's last line or on a list item,
// it is a right-floated span of MathJax's \square (c25FB), as big as the
// PDF's. With \qedhere in a display it is the display's tag at the right
// and no box follows; a proof without \qedhere keeps its own box
const inProof = title => `>${title}\\.<\\/span>(?:(?!<\\/div>)[^])*`;
const box = "<span class='tex8web-qed'><mjx-container[^>]*><mjx-math[^>]*><mjx-c class='mjx-c25FB";
const tagged = title => new RegExp(`${inProof(title)}<mjx-labels(?:(?!<\\/div>)[^])*mjx-c25FB(?:(?!<\\/div>)[^])*<\\/mjx-container><\\/span>\\s*<\\/p>\\s*<\\/div>`);
const qed = {
  'test-qedhere': [
    ...['Bracket', 'Star', 'Align star', 'Gather star', 'Multline star', 'Numbered', 'Numbered align'].map(tagged),
    new RegExp(`${inProof('Plain')}${box}`),
    new RegExp(`${inProof('Display, no qedhere')}<\\/mjx-container><\\/span>\\s*${box}`),
    new RegExp(`${inProof('Text')}${box}`),
    new RegExp(`${inProof('List')}<\\/div><\\/li><li>[^]*?<div>\\s*(?:<p[^>]*>)?Two\\.\\s*${box}`),
    // (eleven squares: seven tags, four boxes)
    /^(?:(?!mjx-c25FB)[^])*(?:mjx-c25FB(?:(?!mjx-c25FB)[^])*){11}$/,
  ],
  // a document's own \qedsymbol, set as it is, after text and in a tag
  'test-qedsymbol': [
    new RegExp(`${inProof('After text')}<span class='tex8web-qed'><mjx-container[^>]*><mjx-math[^>]*><mjx-c class='mjx-c25FC`),
    new RegExp(`${inProof('In a display')}<mjx-labels(?:(?!<\\/div>)[^])*mjx-c25FC(?:(?!<\\/div>)[^])*<\\/mjx-container><\\/span>\\s*<\\/p>\\s*<\\/div>`),
    /^(?:(?!mjx-c25FC)[^])*(?:mjx-c25FC(?:(?!mjx-c25FC)[^])*){2}$/,
    /^(?![^]*mjx-c25FB)/,
  ],
  // the \qedsymbol in force where the box is set: amsthm's (a square),
  // thmtools' qed= (a diamond), an environment's (a triangle), one set in
  // the text (a black square), each after text and in a display's tag
  'test-qedlate': [
    ...[['Plain', '25FB'], ['Remark', '22C4'], ['Example', '25B3'], ['Changed', '25FC']].flatMap(([word, code]) => [
      new RegExp(`${word} text\\.(?:(?!<\\/div>)[^])*<span class='tex8web-qed'><mjx-container[^>]*><mjx-math[^>]*><mjx-c class='mjx-c${code}`),
      new RegExp(`${word} display\\.(?:(?!<\\/div>)[^])*<mjx-labels(?:(?!<\\/div>)[^])*mjx-c${code}(?:(?!<\\/div>)[^])*<\\/mjx-container><\\/span>\\s*<\\/(?:p|div)>`),
    ]),
  ],
  // \qedhere in a row with a \label, a \tag, a nested environment or text
  // in a display, twice, or outside a proof; and a proof ending in a list
  'test-qedrow': [
    ...['Label', 'Label align', 'No tag align', 'Aligned', 'Text', 'Bracket label'].map(tagged),
    // (a \tag of the row's own keeps the box on the proof, below the display)
    new RegExp(`${inProof('Tag')}<\\/mjx-container><\\/span>\\s*${box}`),
    // (the second \qedhere finds no box)
    new RegExp(`${inProof('Twice')}mjx-labels(?:(?!<\\/div>)[^])*mjx-c25FB(?:(?!<\\/div>)[^])*B\\.\\s*<span class='mathjax-block'>(?:(?!mjx-labels)(?!<\\/div>)[^])*<\\/p>`),
    // (outside a proof, \qedhere takes no number: the equation after the
    // alignment is the sixth, as it is in the PDF)
    /and \(<a href='#[^']+'>6<!--/,
    // (a \ref to a \label in \[ \] leads to the display; its number is
    // empty, as in the PDF)
    /<a id='([^']+)'><\/a><mjx-container(?=[^]*And <a href='#\1'>)/,
    /<\/ul>\s*<div class='tex8web-qed-line'><span class='tex8web-qed'><mjx-container/,
    // (nine squares: seven tags, the box after the \tag and the one after the list)
    /^(?:(?!mjx-c25FB)[^])*(?:mjx-c25FB(?:(?!mjx-c25FB)[^])*){9}$/,
  ],
  // equation* through the walker: a \ref to its \label leads to the
  // section, and the three relations of the page's math, one in the split's
  // second column, are spaced
  'test-equationstar': [
    /See <a href='#s'>1</,
    /^(?:(?!mjx-c class='mjx-c3D' space)[^])*(?:mjx-c class='mjx-c3D' space='4'(?:(?!mjx-c class='mjx-c3D' space)[^])*){3}$/,
  ],
};

// what follows an \hfill, in a span the stylesheet floats right. It runs to
// the end of the paragraph or of the line (\\), after the last \hfill of
// a line. It is found in a list item, a centered paragraph, a figure, a
// paragraph cell, and a proof before its QED box. Nothing is moved in a
// box, a label, a cell of one line, \dotfill, \hrulefill, or before
// \break, and no mark is left.
const hfill = {
  'test-hfill': [
    /<p class='noindent'>Name\s+<span class='tex8web-hfill'>Date/,
    /<p class='indent'>\s*<span class='tex8web-hfill'>— A\./,
    /First line\s+<span class='tex8web-hfill'>right of the\s+first<\/span><br class='newline' \/>Second line\s+<span class='tex8web-hfill'>right of the\s+second<\/span><br class='newline' \/>Third line/,
    /<span class='cmbx-10'>Bold name\s*<\/span><span class='tex8web-hfill'><span class='cmbx-10'>bold\s+date/,
    /that line\.\s+<span class='tex8web-hfill'>\(a\s+note\)/,
    /a\s+b\s+<span class='tex8web-hfill'>c\s/,
    /<\/mjx-container>\s+<span class='tex8web-hfill'>\(not differentiable at/,
    /Its description\s+<span class='tex8web-hfill'>at the\s+right/,
    /Centered left\s+<span class='tex8web-hfill'>centered right/,
    /<figure class='figure'>(?:(?!<\/figure>)[^])*<img [^>]*\/>\s*<span class='tex8web-hfill'><img /,
    /in a paragraph cell\s+<span class='tex8web-hfill'>p/,
    /Ends in text\s+<span class='tex8web-hfill'>\(by a\s+lemma\)<span class='tex8web-qed'>/,
    /^(?:(?!tex8web-hfill')[^])*(?:tex8web-hfill'(?:(?!tex8web-hfill')[^])*){13}$/,
    /^(?![^]*tex8web-hfill-mark)/,
  ],
  'examples/complex': [/^(?:(?!\(not differentiable)[^])*(?:<span class='tex8web-hfill'>\(not differentiable(?:(?!\(not differentiable)[^])*){2}$/],
  // (tcolorbox's after upper, tex8web-boxes.tex)
  'examples/custom': [/<span class='tex8web-hfill'><mjx-container/],
};

// the spaces of verbatim text, alltt and \verbatiminput, which keep the
// font's width: only the ~ in the text is narrowed
const verbatim = {
  'test-verbatim': [/^(?:(?!tex8web-nbsp)[^])*Plain<span class='tex8web-nbsp'>(?:(?!tex8web-nbsp)[^])*$/,
    /<div class='alltt'>/, /<div class='verbatiminput'>/, /<pre class='verbatim'/],
};

// the fonts preloaded, and no others: the faces of the text (bold
// headings, italic, \texttt; but not \verb, in the browser's monospace)
// and MathJax's that the math uses
const preloads = {
  'test': ['lmroman10-regular', 'lmroman10-bold', 'lmroman10-italic', 'lmroman10-bolditalic',
    'lmmono10-regular', 'lmsans10-regular', ...['zero', 'n', 'i', 'b', 'c', 'mi', 'v', 'lo', 'so', 's3', 's4', 'brk']
      .map(font => `mathjax/mjx-tex-${font}`)],
  // (the table of contents' sans-serif, bold and italic entries)
  'test-tocloft': ['lmroman10-regular', 'lmroman10-bold', 'lmroman10-italic', 'lmmono10-regular',
    'lmsans10-regular'],
  // (a chapter's \titleformat, in sans-serif's regular face)
  'test-titlechapter': ['lmroman10-regular', 'lmroman10-bold', 'lmsans10-regular'],
  // (in Times, Helvetica and Courier: TeX Gyre's faces, for the controls
  // too, as for the text in sans-serif; and MathJax's Termes, as the math
  // is in Times)
  'test-times': ['texgyretermes-regular', 'texgyretermes-bold', 'texgyretermes-italic',
    'texgyreheros-regular', 'texgyrecursor-regular', 'mathjax/mjx-gt-zero', 'mathjax/mjx-gt-n'],
  'test-sans': ['lmroman10-regular', 'lmsans10-regular', 'lmsans10-bold', 'lmsans10-oblique'],
  'test-newtx': ['texgyretermes-regular', 'texgyretermes-bold', 'texgyretermes-italic', 'texgyreheros-regular',
    'mathjax/mjx-gt-zero', 'mathjax/mjx-gt-n'],
  // (XCharter's, and TeX Gyre's Termes for a passage in Times; MathJax's
  // TeX font, as the math is in Computer Modern)
  'test-charter': ['XCharter-Roman', 'XCharter-Bold', 'XCharter-Italic', 'texgyretermes-regular',
    'mathjax/mjx-tex-zero', 'mathjax/mjx-tex-n'],
  // (MathJax's Pagella and Schola, and the fonts of bbm, dsfont and
  // bboldx in Pagella)
  'test-pagella': ['texgyrepagella-regular', ...['gp-zero', 'gp-brk', 'gp-n', 'gp-so', 'gp-s3', 'gp-s5', 'mb-bn', 'mb-bb', 'md-dr']
    .map(font => `mathjax/mjx-${font}`)],
  'test-schola': ['texgyreschola-regular', ...['zero', 'brk', 'n', 'so'].map(font => `mathjax/mjx-gs-${font}`)],
};

// the text's fonts, each in its role, with tex4ht's classes for them: TeX
// Gyre's for Times, Helvetica and Courier, and XCharter for Charter. A font
// chosen in the text keeps its own, and the text is in sans-serif when
// \familydefault is.
const families = {
  'test-times': ['@font-face { font-family: "TeX Gyre Termes"; src: url("fonts/texgyretermes-regular.woff2") format("woff2"), url("fonts/texgyretermes-regular.otf") format("opentype"); }',
    ':root { --tex8web-roman: "TeX Gyre Termes", "Latin Modern Roman", serif; }',
    ':root { --tex8web-sans: "TeX Gyre Heros", "Latin Modern Sans", sans-serif; }',
    ':root { --tex8web-mono: "TeX Gyre Cursor", "Latin Modern Mono", monospace; }',
    '[class^="phv"], [class*="-phv"], [class^="qhv"], [class*="-qhv"] { font-family: var(--tex8web-sans); }'],
  'test-sans': ['html body { font-family: var(--tex8web-sans); }',
    '[class^="cmr"], [class*="-cmr"]'],
  'test-newtx': ['[class^="ntx-"], [class*="-ntx-"] { font-family: var(--tex8web-roman); }',
    '[class^="qhv"], [class*="-qhv"] { font-family: var(--tex8web-sans); }'],
  'test-charter': [':root { --tex8web-roman: "XCharter", "Latin Modern Roman", serif; }',
    '[class^="bch"], [class*="-bch"], [class^="XCharter"], [class*="-XCharter"] { font-family: var(--tex8web-roman); }',
    '[class*="-ntx-"] { font-family: "TeX Gyre Termes"; }'],
  // (its title's \fontfamily{bch})
  'examples/complex': ['[class*="-XCharter"] { font-family: "XCharter"; }'],
  'test-titlefont': ['[class^="bch"], [class*="-bch"]', ':root { --tex8web-title-size: 1em; }'],
};

// the patterns each table holds, matched against the page (and its
// stylesheet, for the colors), each with how a failure reads
const patterns = [
  [typeset, 'in the typeset math'], [speech, 'in the speech'], [pictures, 'among the pictures'],
  [titles, "as the page's title"], [dates, 'as the date'], [minipages, 'among the minipages'], [index, 'in the index'],
  [contents, 'in the page'], [fonts, "in the text's own font"], [colors, 'among the colors', true], [qed, 'around the QED boxes'],
  [lists, 'among the lists'], [hfill, 'after an \\hfill'], [verbatim, 'in the verbatim text'], [terms, 'among the terms'],
  [permalinks, 'among the links'],
];

// what's wrong with a built page: its log, the page and the files with it
function check(doc, result, out, aux) {
  const problems = [];
  // (unless an error in its log, which checkLog reports, says why)
  if (result.code !== 0 && !/\[(ERROR|FATAL)\]/.test(result.log)) problems.push(`make4ht exited with ${result.code}`);
  const css = join(out, doc.tex.replace(/\.tex$/, '.css'));
  const styles = existsSync(css) ? readFileSync(css, 'utf8') : '';
  for (const [property, value] of Object.entries(measured[doc.name] ?? {})) {
    if (!styles.includes(`${property}: ${value};`)) problems.push(`${property} isn't ${value}`);
  }
  // (each abstract's, which are the same)
  if (styles.split('--tex8web-abstract-leading:').length > 2) problems.push("the abstract's leading set twice");
  // (html4.4ht's rules for the paragraphs in an <li>, which other packages'
  // lists, such as paralist's, need)
  if (styles && !/^li p:last-child/m.test(styles)) problems.push("no html4.4ht's rules for <li>");
  const page = join(out, doc.tex.replace(/\.tex$/, '.html'));
  const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
  const classes = html.match(/<html[^>]*\sclass='([^']*)'/)?.[1] ?? '';
  if (classes !== (switched[doc.name] ?? '')) problems.push(`<html> has classes '${classes}'`);
  // (the examples are published: a browser's tab and link previews show it)
  if (doc.name.startsWith('examples/') && !/<title>\s*\S/.test(html)) problems.push('no <title>');
  // (the text, for a screen reader to jump to)
  if ((html.match(/<main[\s>]/g) || []).length !== 1) problems.push('not one <main>');
  // (tex4ht's <!--l. 65-->, which text.line_comments removes)
  if (/<!--\s*l\.\s*\d+\s*-->/.test(html)) problems.push("tex4ht's source line comments");
  // (with -p, or custom.cfg's \WebPDF)
  if (doc.pdf && !(html.includes("href='main.pdf'") && existsSync(join(out, 'main.pdf')))) problems.push('no link to the PDF beside it');
  if (doc.up && !html.includes(`class='tex8web-control tex8web-up' href='${doc.up}'`)) problems.push('no link up to the index');
  // (the page's whitespace is tex4ht's indentation, which the patterns don't pin)
  const flat = html.replace(/\s+/g, ' ');
  for (const [table, what, withStyles] of patterns) {
    for (const pattern of table[doc.name] ?? []) {
      if (!pattern.test(withStyles ? flat + styles : flat)) problems.push(`no ${pattern.source} ${what}`);
    }
  }
  if (preloads[doc.name]) {
    const found = [...html.matchAll(/<link [^>]*rel='preload'[^>]*>/g)]
      .map(([link]) => link.match(/href='fonts\/([^']+)\.woff2'/)?.[1]).sort().join(' ');
    const wanted = [...preloads[doc.name]].sort().join(' ');
    if (found !== wanted) problems.push(`fonts preloaded: ${found}, not ${wanted}`);
  }
  for (const rule of families[doc.name] ?? []) {
    if (!styles.includes(rule)) problems.push(`no ${rule} among the font rules`);
  }
  // (prerender.mjs makes TeX Live's, cut down)
  for (const [, font] of styles.matchAll(/url\("fonts\/([\w-]+\.woff2)"\) format\("woff2"\), url/g)) {
    const size = statSync(join(out, 'fonts', font), { throwIfNoEntry: false })?.size;
    if (!(size < 60000)) problems.push(`fonts/${font} ${size ? 'not cut down' : 'missing'}`);
  }
  if (tikz[doc.name]) {
    const svg = existsSync(join(out, tikz[doc.name])) ? readFileSync(join(out, tikz[doc.name]), 'utf8') : '';
    const [x, , width] = (svg.match(/viewBox='([^']*)'/)?.[1] ?? '').split(' ').map(Number);
    const at = 1.4 * Number(svg.match(/translate\(([^,]+),/)?.[1]);
    if (!(Math.abs(x + width / 2 - at) < 0.1)) problems.push(`${tikz[doc.name]} isn't centered on its circle`);
  }
  // (prerender.mjs leaves out a token of one character)
  if (/<mjx-m[ion](?: (?:space|size)='[^']*')*><mjx-c class='[^']*'>[^<]*<\/mjx-c><\/mjx-m[ion]>/.test(html)) {
    problems.push('a token of one character left in the typeset math');
  }
  // (prerender.mjs cuts Latin Modern down to the document's characters;
  // test:visual checks that the page looks the same)
  const font = join(out, 'fonts/lmroman10-regular.woff2');
  const size = statSync(font, { throwIfNoEntry: false })?.size;
  if (html.includes('<mjx-container') && !(size < statSync(join(root, 'fonts/lmroman10-regular.woff2')).size)) {
    problems.push(`Latin Modern Roman ${size ? 'not cut down to the page\'s characters' : 'missing'}`);
  }
  if (!existsSync(join(out, 'fonts/LICENSE.txt'))) problems.push('no fonts/LICENSE.txt with the fonts');
  // (checkOutput checks that every formula has it, once one does)
  if (html.includes('<mjx-container') && !html.includes('<mjx-assistive-mml')) {
    problems.push('no MathML for screen readers, with TEX8WEB_MATHML');
  }
  return [...problems, ...checkTexLog(join(aux, doc.tex.replace(/\.tex$/, '.log'))), ...checkLog(result.log),
    ...checkOutput(out)];
}

if (!only.length) {
  const stray = strayKeys(measured, preloads, families, tikz, expected, ...patterns.map(([table]) => table));
  report('the documents the tables name', stray.map(name => `no document ${name}`));
}

// each document built and checked, a few at a time
const refused = new Set(['test-split', 'test-cutat']);
const jobs = largestFirst(docs).map(doc => async () => {
  const out = join(testDir(doc), 'html'), aux = join(testDir(doc), 'aux');
  const result = await build(doc, out, aux, { TEX8WEB_MATHML: '1' });
  mkdirSync(testDir(doc), { recursive: true });
  writeFileSync(join(testDir(doc), 'make4ht.log'), result.log);
  // (tex8web refuses a document that tex4ht splits into pages)
  if (refused.has(doc.name)) {
    return report(doc.name, result.code !== 0 && /one page per document/.test(result.log) ? [] : ['the split option was not refused']);
  }
  report(doc.name, check(doc, result, out, aux));
});

// and the page MathJax typesets in the browser, without node_modules
if (!only.length) jobs.push(async () => {
  const doc = docs.find(d => d.name === 'test-generic');
  const out = join(testDir(doc), 'fallback'), aux = join(testDir(doc), 'fallbackaux');
  const result = await build(doc, out, aux, { TEX8WEB_NO_PRERENDER: '1' });
  const html = existsSync(join(out, `${doc.name}.html`)) ? readFileSync(join(out, `${doc.name}.html`), 'utf8') : '';
  const problems = [];
  if (result.code !== 0) problems.push(`make4ht exited with ${result.code}`);
  // (data-mathjax: the version tex8web.js pins MathJax's font extensions to)
  for (const needed of ['id=\'tex8web-config\'', 'src=\'tex8web.js\'', 'data-mathjax=\'', '/tex-chtml.js']) {
    if (!html.includes(needed)) problems.push(`page lacks ${needed}`);
  }
  if (!existsSync(join(out, 'tex8web.js'))) problems.push('no tex8web.js next to the page');
  if (html.includes('<mjx-container')) problems.push('math typeset at build time');
  problems.push(...checkLog(result.log));
  report(`${doc.name} (MathJax in the browser)`, problems);
});

// and the same page with tex4ht's own escaping of each formula's source,
// which tex8web-math.tex replaces with a faster one: both, left as source
// for MathJax, must be the same page
const escaping = docs.find(d => d.name === 'test-mathescape');
if (escaping) jobs.push(async () => {
  const pages = [];
  const problems = [];
  for (const [kind, cfg] of [['', escaping.cfg], ['stock', join(escaping.dir, 'test-mathescape-stock.cfg')]]) {
    const out = join(testDir(escaping), `source${kind}`), aux = join(testDir(escaping), `source${kind}aux`);
    const result = await build({ ...escaping, cfg }, out, aux, { TEX8WEB_NO_PRERENDER: '1' });
    if (result.code !== 0) problems.push(`make4ht exited with ${result.code}${kind && " with tex4ht's escaping"}`);
    const page = join(out, 'test-mathescape.html');
    pages.push(existsSync(page) ? readFileSync(page, 'utf8') : '');
  }
  // (a \par as two newlines, also where no space follows it, and at the end)
  for (const wanted of ['&amp;', '&lt;', '&gt;', 'mbox{a\n\n b}', ' \\\n\n, ', '2 \\\n\n\\end{smallmatrix}']) {
    if (!pages[0].includes(wanted)) problems.push(`no ${JSON.stringify(wanted)} in the page`);
  }
  if (pages[0] !== pages[1]) problems.push("the page differs from the one with tex4ht's escaping of math");
  report(`${escaping.name} (escaping as tex4ht's)`, problems);
});

await pool(jobs, workers, job => job());

if (tools) {
  const { report, code } = await tools;
  process.stdout.write(report);
  failures += code === 0 ? 0 : 1;
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
