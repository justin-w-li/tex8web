// npm test: the Lua unit tests, then every test document and example built
// with make4ht and checked. Pages go to build/test/<document>/html.
//   node test/run.mjs [document names...]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, documents, expected, largestFirst, pool, root, testDir, workers } from './lib/build.mjs';
import { checkLog, checkOutput, checkTexLog } from './lib/check.mjs';

const only = process.argv.slice(2);
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

// --- builds ----------------------------------------------------------------

// what tex8web measures in a document, where a test document sets it:
// titlesec's spacing in its *n form, a \titleformat's space after the
// label in a bold font's ems, a title's own size, and framed's space
// around its box (\topsep); report's table of contents, its sections
// indented from its chapters, and its chapter's title and label; the
// abstract's leading, \small's 12pt over the text's 13.6pt; tocloft's font
// for each level of the table of contents
const measured = {
  'test-generic': { '--tex8web-section-before': '1.19598em', '--tex8web-section-after': '0.4485em',
    '--tex8web-section-after-text': '0.64583em', '--tex8web-section-labelsep': '1.125em',
    '--tex8web-title-size': '1.44em', '--tex8web-framed-sep': '0.8em' },
  // (and test.cfg's \WebColor, from an xcolor expression and an RGB color)
  // (links unmarked: colored with colorlinks, hidden with hidelinks)
  'test': { '--highlight': 'light-dark(#FFFFCC, #4A4325)', '--tex8web-abstract-leading': '0.88235',
    '--tex8web-link-line': 'none' },
  'test-hidelinks': { '--tex8web-link-line': 'none' },
  'test-report': { '--tex8web-toc-chapter-number': '1.5em', '--tex8web-toc-chapter-skip': '1em',
    '--tex8web-toc-chapter-weight': 'bold', '--tex8web-toc-section-indent': '1.5em',
    '--tex8web-toc-section-number': '2.3em', '--tex8web-toc-subsection-indent': '3.8em',
    '--tex8web-toc-section-skip': '0em', '--tex8web-toc-section-weight': 'normal',
    '--tex8web-chapter-size': '2.488em', '--tex8web-chapter-label-size': '0.8336em' },
  // (\WebLikePDF in an 11pt document: its size, \baselineskip 13.6pt,
  // \parindent 17pt and \parskip 0pt)
  'test-likepdf': { '--tex8web-pdf-size': '10.95pt', '--tex8web-pdf-leading': '1.242',
    '--tex8web-parindent': '1.5525em', '--tex8web-parskip': '0em', '--tex8web-justify': 'justify',
    '--tex8web-hyphens': 'auto' },
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

// what tex8web.js makes of some of test.tex's math through MathJax's
// internals, which a new MathJax must keep: \bigl( to \Biggl\langle in
// TeX's four sizes, scaled to the 10pt extension font in an 11pt document;
// a big bar a little taller; a large operator scaled around it; an align's
// rows on TeX's struts, \jot apart; inline math broken after a relation
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
// to the top), titled by its heading, with
// chapters' numbers in their boxes; the list of figures before it left in
// the text; and one without a heading titled \contentsname, in its letters
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
};

// colors in dark mode, at another lightness (a light-dark() of the color),
// and black text in the page's text color: \textcolor's, \colorbox's and
// \fcolorbox's (in the stylesheet), listings', and in math (a \rule too);
// and the colors of math and table cells as xcolor has them: a document's
// own (ink), a \colorlet (ember), a mix, and green, which CSS has darker
const lightDark = (color, l) => `light-dark\\(${color}, oklch\\(from ${color} ${l} c h\\)\\)`;
const dark = hex => `light-dark(${hex}, oklch(from ${hex} max(l, 1 - l) c h))`;
const text = (hex, html) => `<span style='color:${dark(hex)};'>${html}</span>`;
// (a list's own lengths, before its color)
const list = '--tex8web-list-topsep: 0.8em; --tex8web-list-itemsep: 0.8em; --tex8web-list-indent: 2.5em; --tex8web-list-labelsep: 0.5em; ';
const colors = {
  'test-color': [
    new RegExp(`<span style='color:${lightDark('#000080', 'max\\(l, 1 - l\\)')};'>navy</span>`),
    /<span style='color:var\(--tex8web-text\);'>black<\/span>/,
    new RegExp(`#colorbox1\\{background-color:${lightDark('#FFFFB2', 'min\\(l, 1\\.24 - l\\)')};\\}`),
    new RegExp(`#colorbox2\\{border: solid 1px ${lightDark('#0000FF', 'max\\(l, 0\\.62\\)')};\\}`),
    new RegExp(`<mjx-mstyle style='color: ${lightDark('red', 'max\\(l, 1 - l\\)')};'>`),
    /<mjx-mstyle style='color: var\(--tex8web-text\);'>/,
    new RegExp(`<mjx-mpadded style='background-color: ${lightDark('yellow', 'min\\(l, 1\\.24 - l\\)')};'>`),
    new RegExp(`<mjx-mpadded [^>]*style='border: \\S+ solid ${lightDark('blue', 'max\\(l, 0\\.62\\)')};`),
    /<mjx-mspace style='background-color: var\(--tex8web-text\);/,
    // (ink, red!50!black, green, ember, red!50!yellow in a macro)
    ...['#c80064', '#800000', '#00ff00', '#640032', '#ff8000'].map(hex =>
      new RegExp(`<mjx-mstyle style='color: ${lightDark(hex, 'max\\(l, 1 - l\\)')};'>`)),
    // (gray!50, ink!50!yellow!50, -ink, -red!50!black; Apricot, Blue!50, Azure3; HTML, cmyk, Gray)
    ...['#bfbfbf', '#f1bf98', '#37ff9b', '#80ffff', '#ffad7a', '#8080ff', '#c1cdcd', '#3366cc', '#803399', '#888888'].map(hex =>
      new RegExp(`<mjx-mstyle style='color: ${lightDark(hex, 'max\\(l, 1 - l\\)')};'>`)),
    new RegExp(`#TBL-1-1- td\\{ background-color:${lightDark('#FFFFB2', 'min\\(l, 1\\.24 - l\\)')}\\}`),
    new RegExp(`#TBL-1-2-1\\{ background-color:${lightDark('#F1BFD8', 'min\\(l, 1\\.24 - l\\)')}\\}`),
    // (a complement, which tex4ht gives no rule)
    new RegExp(`#TBL-1-3- td\\{ background-color:${lightDark('#37FF9B', 'min\\(l, 1\\.24 - l\\)')}\\}`),
    new RegExp(`#TBL-1-3-2\\{ background-color:${lightDark('#37FF9B', 'min\\(l, 1\\.24 - l\\)')}\\}`),
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
    `<dl class='tex8web-list itemize' style='${list}color:${dark('#FF0000')};'>`,
    `<span class='cmr-8'>In the text’s color.</span></p></aside>`,
    `and <a href='https://example.com'>a link</a>, by <a href='#x1-1001r1'>${text('#008080', 'theorem')}`,
    `In the box’s colors, ${text('#FF0000', 'and red')}.</p>`,
    // (an inner color on a block wins; a color set at a box's start, whose
    // group tex4ht ends after the box; a theorem and minipages wholly in a
    // color; a float, which LaTeX sets in the text's color; a box copied
    // after its group ended, which colors nothing after it)
    `<p class='indent' style='color:${dark('#FF0000')};'>   Red. </p>\n     <dl class='tex8web-list itemize' style='${list}color:${dark('#0000FF')};'>`,
    `<div class='newtheorem' style='color:${dark('#FF0000')};margin-top:`,
    `<p class='noindent' style='color:${dark('#FF0000')};'>Red from the box’s start.</p>`,
    `<div class='tex8web-minipages'><div class='minipage tex8web-minipage-c' style='--tex8web-share: 0.4; color:${dark('#FF0000')};'>`,
    `<figure class='figure' id='x1-10051'>`,
    `<p class='indent'>   Black at the end.`,
  ].map(html => new RegExp(html.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).concat(/<head>\s*<title>Colors<\/title>/),
  // table colors as the PDF has them (the document loads colortbl before
  // xcolor's table option, which the build errors on without the fix):
  // \rowcolors' alternating rows, from the row it starts at, then
  // \columncolor, \rowcolor[HTML], \cellcolor, and a \rowcolor on a
  // \multicolumn's row
  // (xcolor without colortbl, whose extension would bring MathJax's color
  // extension with it: a document's color, one \colorlet names, a model)
  'test-color-math': ['#c80064', '#00ff00', '#3366cc'].map(hex =>
    new RegExp(`<mjx-mstyle style='color: ${lightDark(hex, 'max\\(l, 1 - l\\)')};'>`)),
  'test-colortbl': [
    // (\rowcolors' on the rows, under the cells' colors)
    ...[['1-1-', 'FFE5E5'], ['1-2-', 'E5E5FF'], ['1-3-', 'FFE5E5'], ['2-2-', 'E5FFE5'], ['2-4-', 'E5FFE5'],
      ['6-1-', 'FFE5E5'], ['6-2-', 'E5E5FF'], ['4-1- td', 'DDEEFF'], ['5-2- td', 'BFFFBF'], ['6-2- td', '00FF00'],
      ['3-1-1', 'CCFFCC'], ['3-2-1', 'CCFFCC'], ['4-2-1', 'F1BFD8'], ['5-1-1', 'F1BFD8'], ['6-1-2', 'FFFF00']]
      .map(([selector, hex]) =>
        new RegExp(`#TBL-${selector}\\{ background-color:${lightDark(`#${hex}`, 'min\\(l, 1\\.24 - l\\)')}\\}`)),
    // (\rowcolors{2}{}{...} leaves the first row and every odd one without)
    /^(?![^]*#TBL-2-(?:1|3|5)-\{)/,
  ],
};

// lists as LaTeX sets them, each label as TeX typesets it (article's
// bullet and dash, \item's own, enumerate's (a)) and each list with its
// own lengths; a citation in biblatex's form, a link within the page; and
// the bibliography's heading once in the contents, where the document
// adds it
const lists = {
  'test-article': [
    /<dl class='tex8web-list itemize' style='--tex8web-list-topsep: 0\.8em; --tex8web-list-itemsep: 0\.8em; --tex8web-list-indent: 2\.5em; --tex8web-list-labelsep: 0\.5em'><dt>\s*• <\/dt><dd>\s*<!--[^>]*--><p class='noindent'>One,/,
    /<dl class='tex8web-list itemize' style='[^']*--tex8web-list-indent: 2\.2em;[^']*'><dt>\s*<span class='[^']+'>–<\/span> <\/dt><dd>\s*<!--[^>]*--><p class='noindent'>inside\./,
    /<dt>\s*<mjx-container aria-label='star'[^]*?<\/dt><dd>\s*<!--[^>]*--><p class='noindent'>A label of its own\./,
    /<dl class='tex8web-list enumerate' [^>]*><dt>\s*1\. <\/dt><dd>\s*<!--[^>]*--><p class='noindent'>First,/,
    /<dt>\s*\(a\) <\/dt><dd>\s*<!--[^>]*--><p class='noindent'>inside\./,
  ],
  // (an item's paragraphs, each a paragraph of its own)
  'test': [/<p class='noindent'>Bullet with a second paragraph\.\s*<\/p><!--[^>]*--><p class='noindent'>The second paragraph\./],
  'examples/complex': [
    /see \[<a id='[^']*'><\/a><a id='[^']*'><\/a><a href='#X0-evanchen'>1<\/a>/,
    /^(?![^]*<a href='main\.html)/,
    /<nav (?:(?!<\/nav>)[^])*>References<(?:(?!<\/nav>|>References<)[^])*<\/nav>/,
    // (with Latin Modern in T1, a bullet that is \textbullet's •)
    /<dt>\s*• <\/dt><dd>\s*<!--[^>]*--><p class='noindent'><a href='https:\/\/castel\.dev\/'>/,
  ],
};

// a \tikz picture as wide as what it draws: a circle at its origin, which
// tex4ht's SVG (dvisvgm's, scaled 1.4) centers on it
const tikz = { 'test-article': 'test-article0x.svg' };

// a term (\WebTerm), with its id for the contents' filter
const terms = {
  'test': [/<span class='tex8web-term' id='term-inner-product'>/, /<span class='tex8web-term' id='term-ball'>/],
};

// links at the heads of numbered theorems and the titles of numbered or
// labelled boxes, to the anchor a \ref to one leads to; none at an
// unnumbered one's
const permalinks = {
  'test-tcolorbox': [
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<!--[^>]*--><p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>1:[^]*<a href='#\1'>1</,
    /<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink'[^>]*>#<\/a>\s*<!--[^>]*--><p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>2:/,
    /<div class='tcolorbox-title'>\s*<!--[^>]*--><p[^>]*>\s*Theorem:/,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<!--[^>]*--><p[^>]*>\s*Labelled box[^]*<a href='#\1'>/,
    /<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink'[^>]*>#<\/a>\s*<!--[^>]*--><p[^>]*>\s*Exercise/,
    /<div class='tcolorbox-title'>\s*<!--[^>]*--><p[^>]*>\s*In a raster/,
    /<div class='tcolorbox-title'>\s*<!--[^>]*--><p[^>]*>\s*Also in a raster/,
    // (a box inside another, each with its own anchor, \ref and number)
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<!--[^>]*--><p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>3:<span class='tex8web-nbsp'>.<\/span>Outer[^]*<a href='#\1'>3</,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<!--[^>]*--><p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>4:<span class='tex8web-nbsp'>.<\/span>Inner/,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<!--[^>]*--><p[^>]*>\s*Outer box[^]*<a href='#\1'>1<!--\s*tex4ht:ref: outerbox /,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<!--[^>]*--><p[^>]*>\s*Inner box[^]*<a href='#\1'>1<!--\s*tex4ht:ref: innerbox /,
    // (a \tcbox on line in its paragraph's line, with a title and in a
    // box; one with tcolorbox's space around it a block of its own)
    /A word <span class='tcolorbox tcbox' id='[^']+'>\s*<span class='tcolorbox-content'>boxed<\/span><\/span> in its line, <span class='tcolorbox tcbox' id='[^']+'>\s*<span class='tcolorbox-title'>T\s*<\/span><span class='tcolorbox-content'>titled<\/span><\/span> one too, and <\/p><div class='tcolorbox [^']*' id='[^']+'>\s*<div class='tcolorbox-content'>alone/,
    /<p[^>]*>And <span class='tcolorbox tcbox' id='[^']+'>\s*<span class='tcolorbox-content'>one<\/span><\/span> in a box\./,
    // (and a boxed title's)
    /<div class='tcolorbox tcolorbox tex8web-tcb-boxed-center' id='[^']+'><a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>/,
  ],
  'examples/custom': [
    /<div class='tcolorbox theorem' id='[^']+'><a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>/,
    /<div class='tcolorbox proof' id='[^']+'>\s*<div class='tcolorbox-title'>\s*<!--/,
  ],
  'examples/complex': [
    /<div class='tcolorbox definition' id='[^']+'><a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<!--[^>]*--><p[^>]*>\s*<span[^>]*>Definition<span class='tex8web-nbsp'>.<\/span>1\.2[^]*Note that <a href='#\1'><span style='color:[^']*;'>Definition/,
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
    ...['Bracket', 'Star', 'Align star', 'Gather star', 'Numbered', 'Numbered align'].map(tagged),
    new RegExp(`${inProof('Plain')}${box}`),
    new RegExp(`${inProof('Display, no qedhere')}<\\/mjx-container><\\/span>\\s*${box}`),
    new RegExp(`${inProof('Text')}${box}`),
    new RegExp(`${inProof('List')}<dd[^>]*>\\s*(?:<!--[^>]*--><p[^>]*>)?Two\\.\\s*${box}`),
    // (ten squares: six tags, four boxes)
    /^(?:(?!mjx-c25FB)[^])*(?:mjx-c25FB(?:(?!mjx-c25FB)[^])*){10}$/,
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
    ...['Label', 'Label align', 'No tag align', 'Aligned', 'Text'].map(tagged),
    // (a \tag of the row's own keeps the box on the proof, below the display)
    new RegExp(`${inProof('Tag')}<\\/mjx-container><\\/span>\\s*${box}`),
    // (the second \qedhere finds no box)
    new RegExp(`${inProof('Twice')}mjx-labels(?:(?!<\\/div>)[^])*mjx-c25FB(?:(?!<\\/div>)[^])*B\\.\\s*<span class='mathjax-block'>(?:(?!mjx-labels)(?!<\\/div>)[^])*<\\/p>`),
    // (outside a proof, \qedhere takes no number: the equation after the
    // alignment is the sixth, as it is in the PDF)
    /and \(<a href='#[^']+'>6<!--/,
    /<\/(?:ul|dl)>\s*<div class='tex8web-qed-line'><span class='tex8web-qed'><mjx-container/,
    // (eight squares: six tags, the box after the \tag and the one after the list)
    /^(?:(?!mjx-c25FB)[^])*(?:mjx-c25FB(?:(?!mjx-c25FB)[^])*){8}$/,
  ],
  // equation* through the walker: a \ref to its \label leads to the
  // section, and the three relations of the page's math, one in the split's
  // second column, are spaced
  'test-equationstar': [
    /See <a href='#s'>1</,
    /^(?:(?!mjx-c class='mjx-c3D' space)[^])*(?:mjx-c class='mjx-c3D' space='4'(?:(?!mjx-c class='mjx-c3D' space)[^])*){3}$/,
  ],
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
  // (in Times, Helvetica and Courier: TeX Gyre's faces, Latin Modern's for
  // the controls)
  'test-times': ['lmroman10-regular', 'texgyretermes-regular', 'texgyretermes-bold', 'texgyretermes-italic',
    'texgyreheros-regular', 'texgyrecursor-regular', 'mathjax/mjx-tex-zero', 'mathjax/mjx-tex-n'],
  // (the text in sans-serif)
  'test-sans': ['lmroman10-regular', 'lmsans10-regular', 'lmsans10-bold', 'lmsans10-oblique'],
};

// the text's fonts: TeX Gyre's for Times, Helvetica and Courier, each in
// its role, and tex4ht's classes for them; sans-serif for the text, when
// \familydefault is
const families = {
  'test-times': ['@font-face { font-family: "TeX Gyre Termes"; src: url("fonts/texgyretermes-regular.woff2") format("woff2"); }',
    ':root { --tex8web-roman: "TeX Gyre Termes", "Latin Modern Roman", serif; }',
    ':root { --tex8web-sans: "TeX Gyre Heros", "Latin Modern Sans", sans-serif; }',
    ':root { --tex8web-mono: "TeX Gyre Cursor", "Latin Modern Mono", monospace; }',
    '[class^="phv"], [class*="-phv"] { font-family: var(--tex8web-sans); }'],
  'test-sans': ['html body { font-family: var(--tex8web-sans); }'],
};

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
  // (hyperref's boxed links, which the page underlines)
  if (doc.name === 'test-generic' && styles.includes('--tex8web-link-line:')) {
    problems.push("hyperref's boxed links aren't underlined");
  }
  const page = join(out, doc.tex.replace(/\.tex$/, '.html'));
  const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
  // (the examples are published: a browser's tab and link previews show it)
  if (doc.name.startsWith('examples/') && !/<title>\s*\S/.test(html)) problems.push('no <title>');
  // (with -p, or custom.cfg's \WebPDF)
  if (doc.pdf && !(html.includes("href='main.pdf'") && existsSync(join(out, 'main.pdf')))) problems.push('no link to the PDF beside it');
  if (doc.up && !html.includes(`class='tex8web-control tex8web-up' href='${doc.up}'`)) problems.push('no link up to the index');
  for (const pattern of typeset[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} in the typeset math`);
  }
  for (const pattern of speech[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} in the speech`);
  }
  for (const pattern of pictures[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} among the pictures`);
  }
  for (const pattern of titles[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} as the page's title`);
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
  // (prerender.mjs makes TeX Gyre's, cut down)
  for (const [, font] of styles.matchAll(/url\("fonts\/(texgyre[\w-]+\.woff2)"\)/g)) {
    const size = statSync(join(out, 'fonts', font), { throwIfNoEntry: false })?.size;
    if (!(size < 60000)) problems.push(`fonts/${font} ${size ? 'not cut down' : 'missing'}`);
  }
  for (const pattern of minipages[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} among the minipages`);
  }
  for (const pattern of index[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} in the index`);
  }
  for (const pattern of contents[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} in the page`);
  }
  for (const pattern of fonts[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} in the text's own font`);
  }
  for (const pattern of colors[doc.name] ?? []) {
    if (!pattern.test(html + styles)) problems.push(`no ${pattern.source} among the colors`);
  }
  for (const pattern of qed[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} around the QED boxes`);
  }
  for (const pattern of lists[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} among the lists`);
  }
  if (tikz[doc.name]) {
    const svg = existsSync(join(out, tikz[doc.name])) ? readFileSync(join(out, tikz[doc.name]), 'utf8') : '';
    const [x, , width] = (svg.match(/viewBox='([^']*)'/)?.[1] ?? '').split(' ').map(Number);
    const at = 1.4 * Number(svg.match(/translate\(([^,]+),/)?.[1]);
    if (!(Math.abs(x + width / 2 - at) < 0.1)) problems.push(`${tikz[doc.name]} isn't centered on its circle`);
  }
  for (const pattern of terms[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} among the terms`);
  }
  for (const pattern of permalinks[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} among the links`);
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

const docs = documents().filter(doc => !only.length || only.includes(doc.name));
// each document built and checked, a few at a time
const jobs = largestFirst(docs).map(doc => async () => {
  const out = join(testDir(doc), 'html'), aux = join(testDir(doc), 'aux');
  const result = await build(doc, out, aux, { TEX8WEB_MATHML: '1' });
  mkdirSync(testDir(doc), { recursive: true });
  writeFileSync(join(testDir(doc), 'make4ht.log'), result.log);
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
  report(`${doc.name} (MathJax in the browser)`, problems);
});

await pool(jobs, workers, job => job());

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
