// npm test: the Lua unit tests, then every document in test/fixtures/ and
// examples/ built with make4ht and checked, while the tests of the test tools
// run beside them. Pages go to build/test/<document>/html.
//   node test/run.mjs [document names...]
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { build, expected, largestFirst, pool, root, run, select, strayKeys, testDir, workers } from './lib/build.mjs';
import { checkLog, checkOutput, checkTexLog } from './lib/check.mjs';
import { decode } from './lib/png.mjs';

const only = process.argv.slice(2);
const docs = select(only);
let failures = 0;

// Problems that test/expected.json allows for a document (allow: substrings
// of them, why: the reason) are reported without failing it. An allowed
// problem that no longer occurs fails, so that the list stays current.
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

// The tests of the test tools take build slots from a separate pool
// (test/lib/stubs.mjs), so they wait neither for the builds below nor for
// other sessions. Their report is printed at the end.
const tools = only.length ? null : new Promise(done => {
  const files = ['unit/prerender', 'slots', 'builds', 'realbuild', 'regress', 'tools'].map(name => join(root, `test/${name}.test.mjs`));
  const child = spawn(process.execPath, ['--test', ...files], { timeout: 300000 });
  let report = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { report += data; });
  child.on('close', (code, signal) => done({ report: signal ? `${report}\nthe tools' tests were stopped by ${signal} after their 300 s limit\n` : report, code }));
});

// --- builds ----------------------------------------------------------------

// Custom properties that tex8web measures in a document and writes into its
// stylesheet:
// - titlesec's spacing in its *n form, and a \titleformat's space after the
//   label, in ems of the bold font
// - a title's size, and framed's space around its box (\topsep)
// - report's table of contents, with sections indented from chapters, and a
//   chapter's title and label
// - the abstract's leading: \small's 12pt over the text's 13.6pt
// - tocloft's font for each level of the table of contents
// Classes on <html>: \WebLikePDF's justified, hyphenated text, and links not
// underlined, colored with colorlinks or hidden with hidelinks. Every other
// document has none: test-generic's links are boxed, so underlined.
const switched = {
  'test': 'tex8web-plain-links', 'test-hidelinks': 'tex8web-plain-links',
  'test-declared': 'tex8web-plain-links', 'examples/basic': 'tex8web-plain-links',
  'examples/complex': 'tex8web-plain-links', 'test-likepdf': 'tex8web-like-pdf',
  'test-pdftex': 'tex8web-plain-links', 'test-pdftex-class': 'tex8web-plain-links',
  'test-pdftex-sty': 'tex8web-plain-links',
  'test-pdfoutput': 'tex8web-plain-links', 'test-pdfoutput-sty': 'tex8web-plain-links',
  'test-pdfprim-hyperref': 'tex8web-plain-links',
};
const sectpartSizes = { '--tex8web-part-size': '2.488em', '--tex8web-part-label-size': '0.8336em', '--tex8web-part-label-after': '0.96432em' };
const measured = {
  'test-generic': { '--tex8web-section-before': '1.19598em', '--tex8web-section-after': '0.4485em',
    '--tex8web-section-after-text': '0.64583em', '--tex8web-section-labelsep': '1.125em',
    '--tex8web-title-size': '1.44em', '--tex8web-framed-sep': '0.8em' },
  // (also test.cfg's \WebColor, from an xcolor expression and an RGB color,
  // and the link colors, which examples/basic has with only the color
  // package; \intextsep and \floatsep of 12pt, display skips of 11pt, and
  // \topsep 9pt, in an 11pt document)
  'test': { '--highlight': 'light-dark(#FFFFCC, #4A4325)', '--tex8web-abstract-leading': '0.88235',
    '--tex8web-link': 'light-dark(#FF0000, oklch(from #FF0000 var(--tex8web-dark-link) var(--tex8web-dark-link-chroma) h))',
    '--tex8web-intextsep': '1.09589em', '--tex8web-floatsep': '1.09589em',
    '--tex8web-display-above': '1.00456em', '--tex8web-display-below': '1.00456em',
    '--tex8web-list-sep': '0.82191em' },
  // (12pt: \intextsep 14pt, \floatsep 12pt, display skips of 12pt, and
  // \topsep 10pt)
  'test-blockspace': { '--tex8web-intextsep': '1.16667em', '--tex8web-floatsep': '1em',
    '--tex8web-display-above': '1em', '--tex8web-display-below': '1em', '--tex8web-list-sep': '0.83333em' },
  'examples/basic': { '--tex8web-url': 'light-dark(#0000FF, oklch(from #0000FF var(--tex8web-dark-link) var(--tex8web-dark-link-chroma) h))' },
  // (linkcolor=.: no property, so a link is in the color of the text around it)
  'examples/complex': { '--tex8web-link': null },
  'test-tocentry': { '--tex8web-toc-chapter-skip': '1em' },
  // (hyperref's linkcolor after a braced comma in its options, and urlcolor
  // from \hypersetup; with the class's option, colorlinks' magenta URLs;
  // with \PassOptionsToPackage, its linkcolor)
  'test-pdftex': { '--tex8web-link': 'light-dark(#00FFFF, oklch(from #00FFFF var(--tex8web-dark-link) var(--tex8web-dark-link-chroma) h))',
    '--tex8web-url': 'light-dark(#0000FF, oklch(from #0000FF var(--tex8web-dark-link) var(--tex8web-dark-link-chroma) h))' },
  'test-pdftex-class': { '--tex8web-link': 'light-dark(#FF0000, oklch(from #FF0000 var(--tex8web-dark-link) var(--tex8web-dark-link-chroma) h))',
    '--tex8web-url': 'light-dark(#FF00FF, oklch(from #FF00FF var(--tex8web-dark-link) var(--tex8web-dark-link-chroma) h))' },
  'test-pdftex-sty': { '--tex8web-link': 'light-dark(#00FFFF, oklch(from #00FFFF var(--tex8web-dark-link) var(--tex8web-dark-link-chroma) h))' },
  // (float.sty's ruled style: rules of 0.8pt and 0.4pt, 2pt from the text)
  'test-algorithmic': { '--tex8web-float-rule': '0.08em', '--tex8web-float-midrule': '0.04em',
    '--tex8web-float-endrule': '0.04em', '--tex8web-float-sep': '0.2em', '--tex8web-float-bodysep': '0.2em' },
  // (report's chapter: 50pt above and 40pt below, in ems of \Huge's 24.88pt,
  // and 20pt from label to title, in ems of \huge's 20.74pt. No space below
  // in ems of the text, which a framed box below would add. A part's label
  // 20pt from its title too, and no space above or below, the fill of a
  // page of its own)
  'test-report': { '--tex8web-toc-chapter-number': '1.5em', '--tex8web-toc-chapter-skip': '1em',
    '--tex8web-toc-chapter-weight': 'bold', '--tex8web-toc-section-indent': '1.5em',
    '--tex8web-toc-section-number': '2.3em', '--tex8web-toc-subsection-indent': '3.8em',
    '--tex8web-toc-section-skip': '0em', '--tex8web-toc-section-weight': 'normal',
    '--tex8web-chapter-size': '2.488em', '--tex8web-chapter-label-size': '0.8336em',
    '--tex8web-chapter-before': '2.00964em', '--tex8web-chapter-after': '1.60771em',
    '--tex8web-chapter-after-text': null, '--tex8web-chapter-label-after': '0.96432em',
    '--tex8web-part-label-after': '0.96432em', '--tex8web-part-before': null, '--tex8web-part-after': null },
  // (article's part: the title in \huge, 20.74pt, the label in \Large,
  // 14.4pt, flush left, and 4ex and 3ex of cmr10, 4.30554pt, above and
  // below, in ems of the title. No space between label and title)
  'test-part': { '--tex8web-part-size': '2.074em', '--tex8web-part-label-size': '0.6943em',
    '--tex8web-part-align': 'left', '--tex8web-part-before': '0.83038em',
    '--tex8web-part-after': '0.62279em', '--tex8web-part-label-after': '0em' },
  // (a book or report with sectsty, whose \parttitlefont takes an
  // argument: the part's title in book's \Huge, 24.88pt, and its
  // label in \huge, 20.74pt, 20pt above the title, both bold and centered,
  // as sectsty's \@part sets them. In test-sectpart the title is centered,
  // as \parttitlefont{\centering} sets it, and the label's \raggedleft is
  // not followed. sectsty's own part fonts are not read: the part of
  // test-sectpart-hyperref is bold where the PDF's is medium italic, and the
  // part of test-sectpart-hyperfirst centered and roman where the PDF's is
  // flush left and sans-serif, so neither is checked)
  'test-sectpart': { ...sectpartSizes, '--tex8web-part-weight': null, '--tex8web-part-align': null },
  'test-sectpart-hyperref': sectpartSizes,
  'test-sectpart-hyperfirst': sectpartSizes,
  'test-sectpart-ulem': { ...sectpartSizes, '--tex8web-part-weight': null, '--tex8web-part-align': null },
  'test-sectpart-nopart': { ...sectpartSizes, '--tex8web-part-weight': null, '--tex8web-part-align': null },
  // (an article with sectsty: its part flush left, as sectsty's article
  // \@part sets it)
  'test-sectpart-article': { '--tex8web-part-align': 'left' },
  // (\WebLikePDF in an 11pt document: the font size, 10.95pt over 12pt,
  // \baselineskip 13.6pt, \parindent 17pt, the fixture's \parskip of 3pt,
  // and \topsep 9pt)
  'test-likepdf': { '--tex8web-pdf-scale': '0.9125', '--tex8web-pdf-leading': '1.242',
    '--tex8web-parindent': '1.5525em', '--tex8web-parskip': '0.27397em', '--tex8web-list-sep': '0.82191em' },
  // (an article without titlesec: \@startsection's space around a section,
  // 3.5ex and 2.3ex of the text, and a subsection, 3.25ex and 1.5ex, in ems
  // of the heading; the margins of the abstract's quotation;
  // \footnotesize's leading, 9.5pt over 12pt; \intextsep and \floatsep of
  // 12pt, display skips of 10pt, and \topsep 8pt)
  'test-article': { '--tex8web-section-before': '1.0465em', '--tex8web-section-after': '0.6877em',
    '--tex8web-subsection-before': '1.16609em', '--tex8web-subsection-after': '0.5382em',
    '--tex8web-abstract-left': '2.5em', '--tex8web-abstract-right': '2.5em',
    '--tex8web-footnote-leading': '0.79167',
    '--tex8web-leftmargin': '2.5em', '--tex8web-intextsep': '1.2em', '--tex8web-floatsep': '1.2em',
    '--tex8web-display-above': '1em', '--tex8web-display-below': '1em', '--tex8web-list-sep': '0.8em' },
  // memoir: the space around headings set after a \sechook, in ems of the
  // heading: 5ex above a section, from the fixture, and memoir's 2.3ex
  // below it and 3.25ex above a subsection. A redefined
  // \paragraph with \par first, and a \subsubsection with \@startsection
  // only inside \@ifstar's groups, which is skipped. A chapter spaced by
  // memoir's lengths: 50pt above and 40pt below, in ems of memoir's \Huge,
  // 20.74pt, and the fixture's \midchapskip of 10pt, in ems of memoir's
  // \huge, 17.28pt. A part's label 20pt from its title, by the default
  // chapter style's \midpartskip, in ems of memoir's \huge, and no space
  // above or below, from \beforepartskip's and \afterpartskip's \vfil,
  // centered by memoir's \@part.
  'test-memoir': { '--tex8web-section-before': '1.79398em',
    '--tex8web-section-after': '0.82523em', '--tex8web-subsection-before': '1.27791em',
    '--tex8web-paragraph-before': '0.86111em', '--tex8web-paragraph-after': '0.43056em',
    '--tex8web-subsubsection-before': null, '--tex8web-chapter-before': '2.4108em',
    '--tex8web-chapter-after': '1.92863em', '--tex8web-chapter-label-after': '0.5787em',
    '--tex8web-part-label-after': '1.15741em', '--tex8web-part-before': null,
    '--tex8web-part-after': null, '--tex8web-part-align': 'center' },
  // (the mw classes' table of contents: number widths and indents from
  // their \SetTOCIndents, in place of article's 1.5em and 2.3em. mwrep has
  // no \@makechapterhead, so its chapters keep the stylesheet's spacing)
  'test-mwart': { '--tex8web-toc-section-number': '1.36082em', '--tex8web-toc-subsection-indent': '1.36082em',
    '--tex8web-toc-subsection-number': '2.36388em', '--tex8web-toc-section-weight': 'bold' },
  'test-mwrep': { '--tex8web-toc-chapter-number': '1.36082em', '--tex8web-toc-section-indent': '1.36082em',
    '--tex8web-toc-section-number': '2.36388em', '--tex8web-toc-chapter-weight': 'bold',
    '--tex8web-toc-section-weight': 'normal', '--tex8web-chapter-before': null,
    '--tex8web-chapter-label-after': null },
  // (revtex's table of contents: its \l@section reads widths that the
  // class sets only in \tableofcontents, so each level keeps article's)
  'test-revtoc': { '--tex8web-toc-section-number': '1.5em', '--tex8web-toc-section-skip': '1em',
    '--tex8web-toc-subsection-indent': '1.5em', '--tex8web-toc-subsection-number': '2.3em',
    '--tex8web-toc-subsubsection-indent': '3.8em', '--tex8web-toc-subsubsection-number': '3.2em',
    '--tex8web-toc-paragraph-indent': '7.00002em', '--tex8web-toc-paragraph-number': '4.1em',
    '--tex8web-toc-subparagraph-indent': '10.00002em', '--tex8web-toc-section-weight': 'bold' },
  // (revtex4-2's section entries in its default aps style: the space
  // above, and no bold)
  'test-revtoc-weight': { '--tex8web-toc-section-skip': '1em', '--tex8web-toc-section-weight': 'normal' },
  // (chapter styles left with the stylesheet's spacing: memoir's chappell,
  // with four skips, one of them zero, and fncychap's Glenn, with a
  // negative space between label and title)
  'test-chapterstyle': { '--tex8web-chapter-before': null, '--tex8web-chapter-label-after': null },
  'test-fncychap': { '--tex8web-chapter-before': null, '--tex8web-chapter-label-after': null },
  // (the fonts of headings in their \@startsection: a section in \large
  // sans-serif italic, a subsection in article's bold, and a run-in
  // paragraph in italic)
  'test-secfont': { '--tex8web-section-size': '1.2em', '--tex8web-section-family': 'var(--tex8web-sans)',
    '--tex8web-section-weight': 'normal', '--tex8web-section-style': 'italic',
    '--tex8web-section-align': 'left', '--tex8web-subsection-weight': 'bold',
    '--tex8web-paragraph-weight': 'normal', '--tex8web-paragraph-style': 'italic' },
  // (amsart's section in centered small capitals at the text size, its
  // run-in paragraph in the text's font, and its parts flush left, where
  // html4.4ht centers parts)
  'test-amsart': { '--tex8web-section-size': '1em', '--tex8web-section-weight': 'normal',
    '--tex8web-section-variant': 'small-caps', '--tex8web-section-align': 'center',
    '--tex8web-paragraph-weight': 'normal', '--tex8web-part-align': 'left' },
  // (memoir's fonts in a 10pt document: a part title in \huge small
  // capitals and a chapter title in \Large italic, both under a label in
  // \huge bold, a section in \normalsize italic, and a run-in paragraph in
  // italic. The part's title and the chapter's label are read past the
  // \MakeUppercase their fonts end in. memoir's chapter spacing, 50pt,
  // 20pt, and 40pt, in ems of the title's \Large, 12pt, and the label's
  // \huge, 17.28pt)
  'test-memoirfonts': { '--tex8web-chapter-before': '4.16667em',
    '--tex8web-chapter-label-after': '1.15741em', '--tex8web-chapter-after': '3.33333em',
    '--tex8web-part-size': '1.728em', '--tex8web-part-weight': 'normal',
    '--tex8web-part-variant': 'small-caps', '--tex8web-part-label-size': '1em',
    '--tex8web-part-label-weight': 'bold', '--tex8web-part-label-variant': 'normal',
    '--tex8web-chapter-size': '1.2em', '--tex8web-chapter-weight': 'normal',
    '--tex8web-chapter-style': 'italic', '--tex8web-chapter-label-size': '1.44em',
    '--tex8web-chapter-label-weight': 'bold', '--tex8web-chapter-label-style': 'normal',
    '--tex8web-chapter-label-family': 'var(--tex8web-roman)',
    '--tex8web-section-size': '1em', '--tex8web-section-weight': 'normal',
    '--tex8web-section-style': 'italic', '--tex8web-paragraph-weight': 'normal',
    '--tex8web-paragraph-style': 'italic' },
  // (tocloft's \cft<level>font: \Large\scshape; \normalfont\itshape; \itshape;
  // \bfseries; \large\sffamily; \ttfamily; \slshape)
  'test-tocloft': { '--tex8web-toc-part-size': '1.44', '--tex8web-toc-part-variant': 'small-caps',
    '--tex8web-toc-chapter-style': 'italic', '--tex8web-toc-chapter-weight': 'normal',
    '--tex8web-toc-section-style': 'italic', '--tex8web-toc-section-weight': 'normal',
    '--tex8web-toc-subsection-weight': 'bold', '--tex8web-toc-subsubsection-size': '1.2',
    '--tex8web-toc-subsubsection-family': 'var(--tex8web-sans)',
    '--tex8web-toc-paragraph-family': 'var(--tex8web-mono)', '--tex8web-toc-subparagraph-style': 'italic' },
  // (titlesec formats with a rule first: \titlerule before an article's
  // part in \huge bold centered by \filcenter, \titlerule before
  // \Large\bfseries, \titlerule* before \sffamily\itshape\large,
  // \titleline* before \ttfamily, \titlerule[2pt] before a run-in
  // paragraph's \sffamily\bfseries, and \titleline before a run-in
  // subparagraph's \itshape)
  'test-titlerule': { '--tex8web-part-size': '2.074em', '--tex8web-part-weight': 'bold',
    '--tex8web-part-align': 'center', '--tex8web-section-size': '1.44em', '--tex8web-section-family': 'inherit',
    '--tex8web-section-weight': 'bold', '--tex8web-section-style': 'normal',
    '--tex8web-subsection-size': '1.2em', '--tex8web-subsection-family': 'var(--tex8web-sans)',
    '--tex8web-subsection-weight': 'normal', '--tex8web-subsection-style': 'italic',
    '--tex8web-subsubsection-size': '1em', '--tex8web-subsubsection-family': 'var(--tex8web-mono)',
    '--tex8web-paragraph-family': 'var(--tex8web-sans)', '--tex8web-paragraph-weight': 'bold',
    '--tex8web-subparagraph-family': 'inherit', '--tex8web-subparagraph-style': 'italic' },
  // (report's part in \Huge small capitals and chapter in \huge sans-serif
  // bold, both centered by \filcenter after a \titlerule; a block section
  // with \titlerule after \Large\bfseries; \titleformat*'s \itshape\large)
  'test-titlerule-report': { '--tex8web-part-size': '2.488em', '--tex8web-part-variant': 'small-caps',
    '--tex8web-part-align': 'center', '--tex8web-chapter-size': '2.074em',
    '--tex8web-chapter-family': 'var(--tex8web-sans)', '--tex8web-chapter-weight': 'bold',
    '--tex8web-chapter-align': 'center', '--tex8web-section-size': '1.44em',
    '--tex8web-section-weight': 'bold', '--tex8web-subsection-size': '1.2em',
    '--tex8web-subsection-style': 'italic', '--tex8web-subsection-weight': 'normal' },
  // (titletoc's run-in entries: the levels around them measured as without
  // them. report's chapter, 1.5em wide, 1em below the entry before, and
  // bold, and its non-starred section entry without bold; a run-in
  // section, top of an article, and a run-in chapter in a book, each bold
  // from its format and with no space above, as \titlecontents* adds none.
  // In scrreprt, the subsubsection below a run-in subsection at the
  // class's 7em and 4.1em)
  'test-runintoc': { '--tex8web-toc-chapter-number': '1.5em', '--tex8web-toc-chapter-skip': '1em',
    '--tex8web-toc-chapter-weight': 'bold', '--tex8web-toc-section-weight': 'normal' },
  'test-runintoc-article': { '--tex8web-toc-section-weight': 'bold', '--tex8web-toc-section-skip': '0em' },
  'test-runintoc-book': { '--tex8web-toc-chapter-weight': 'bold', '--tex8web-toc-chapter-skip': '0em' },
  'test-runintoc-skip': { '--tex8web-toc-section-weight': 'normal', '--tex8web-toc-section-skip': '1.2em' },
  'test-runintoc-koma': { '--tex8web-toc-chapter-skip': '1em', '--tex8web-toc-chapter-weight': 'bold',
    '--tex8web-toc-subsubsection-indent': '7.00002em', '--tex8web-toc-subsubsection-number': '4.10002em' },
};

// test.tex's math as tex8web.js typesets it through MathJax's internals,
// which a new MathJax version must keep working:
// - \bigl( to \Biggl\langle in TeX's four sizes, scaled to the 10pt
//   extension font in an 11pt document
// - a big bar a little taller, and a large operator scaled around it
// - an align's rows on TeX's struts, \jot apart
// - inline math broken after a relation, and at \allowbreak
// mhchem's \ce, in text and in a heading, is an inline formula without
// tex4ht's \texttt, whose span tex4ht splits at a line break of the HTML.
// MathJax's space for \hspace between two parts of a formula's MathML, and
// a letter with a number as its subscript
const spaced = (before, width, after) => new RegExp(`${before}<mspace (?:linebreak='nobreak' )?width='${width.replace('.', '\\.')}'><\\/mspace>${after}`);
const sub = (letter, n) => `<msub><mi>${letter}<\\/mi><mrow[^>]*><mn>${n}<\\/mn><\\/mrow><\\/msub>`;
// a right-hand column of an alignment, which starts with {} before its =
const rhs = "<mtd><mstyle indentshift='2em'><mi><\\/mi><mrow data-mjx-texclass='ORD'><\\/mrow><mo linebreakstyle='after'>=<\\/mo>";
const typeset = {
  // (in align*, each right-hand column after a macro pair's matrix starts
  // with {}, and none is put in a matrix's cells; a \label on a row with
  // a matrix of rows names that row's number)
  'test-envmacro': [
    new RegExp(`<mi>A<\\/mi><\\/mtd>${rhs}<mrow data-mjx-texclass='INNER'><mo data-mjx-texclass='OPEN'>\\[<\\/mo><mtable [^>]*data-tex8web-env='bmatrix'(?:(?!<\\/mtable>)[^])*<\\/mtable><mo data-mjx-texclass='CLOSE'>\\]<\\/mo><\\/mrow><\\/mstyle><\\/mtd><mtd><mi>C<\\/mi><\\/mtd>${rhs}<mrow data-mjx-texclass='INNER'><mo data-mjx-texclass='OPEN'>\\{`),
    new RegExp(`<mi>P<\\/mi><\\/mtd>${rhs}<mrow data-mjx-texclass='INNER'><mo data-mjx-texclass='OPEN'>\\{<\\/mo><mtable [^>]*data-tex8web-env='Bmatrix'(?:(?!<\\/mtable>)[^])*<\\/mtable><mo data-mjx-texclass='CLOSE'>\\}<\\/mo><\\/mrow><\\/mstyle><\\/mtd><mtd><mi>Q<\\/mi><\\/mtd>${rhs}<mi>R<\\/mi>`),
    new RegExp(`<mi>S<\\/mi><\\/mtd>${rhs}<mrow data-mjx-texclass='INNER'><mo data-mjx-texclass='OPEN'>\\[<\\/mo><mtable [^>]*data-tex8web-env='bmatrix'[^>]*><mtr><mtd><mspace[^>]*><\\/mspace><mi>a<\\/mi><\\/mtd><mtd><mi>b<\\/mi><\\/mtd><mtd><mi>c<\\/mi><\\/mtd><\\/mtr><\\/mtable><mo data-mjx-texclass='CLOSE'>\\]<\\/mo><\\/mrow><\\/mstyle><\\/mtd><mtd><mi>T<\\/mi><\\/mtd>${rhs}<mi>U<\\/mi>`),
    /id='mjx-eqn_eq_g'[^>]*><mjx-mtext><mjx-c class='mjx-c28'>\(<\/mjx-c><\/mjx-mtext><mjx-mtext><mjx-c class='mjx-c33'>3</,
  ],
  'test-mhchem': [/<\/a>The <mjx-container/, /forms acid: <span class='tex8web-nowrap'><mjx-container/],
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
    /<mi>a<\/mi><mspace><\/mspace><mi>b<\/mi>/,
  ],
  // (a range without an empty \text before it, which would add an mrow and
  // a break, and -- and \textendash in a phrase as an en dash; no break
  // at a space in inline math, as between a number and its unit; the
  // degree sign raised as in the PDF's math, not MathJax's small ring)
  'test-units': [
    /<math xmlns='[^']*'><mrow><mn>1<\/mn><mtext> to <\/mtext><mn>5<\/mn><\/mrow><\/math>/,
    /<math xmlns='[^']*'><mrow><mn>1<\/mn><mtext>–<\/mtext><mn>2<\/mn><\/mrow><\/math>/,
    /<math xmlns='[^']*'><mrow><mn>3<\/mn><mtext>–<\/mtext><mn>4<\/mn><\/mrow><\/math>/,
    /<mn>1<\/mn><mspace linebreak='nobreak' width='0\.167em'><\/mspace><mrow data-mjx-texclass='ORD'><mi mathvariant='normal'>K<\/mi><\/mrow><mtext> to /,
    /<mi mathvariant='normal'>m<\/mi><\/mrow><mspace linebreak='nobreak' width='0\.167em'><\/mspace><msup>/,
    /^(?![^]*<math xmlns='[^']*'>(?:(?!<\/math>)[^])*<mspace (?![^>]*linebreak)[^>]*width=)/,
    /<mn>30<\/mn><mrow data-mjx-texclass='ORD'><msup><mrow data-mjx-texclass='ORD'><\/mrow><mrow data-mjx-texclass='ORD'><mtext[^>]*>∘<\/mtext>/,
    /^(?![^]*°)/,
  ],
  // (\displaybreak, \allowdisplaybreaks, and \hidewidth as nothing, with
  // no command name in red and no error, also for \hidewidth in a group;
  // a cell that starts with \hidewidth set at the right of its column, one
  // that ends with it at the left, and one with it on both sides centered,
  // as in the PDF, also after a style command or a column template's
  // \displaystyle; mathtools's \coloneqq and \mathclap, whose extension
  // stays configured)
  'test-displaybreak': [/^(?![^]*mathcolor='light-dark\(red)/, /^(?![^]*<merror)/,
    /<mtd columnalign='right'>(?:<mspace[^>]*><\/mspace>)?<mi>a<\/mi><\/mtd>/,
    /<mtd columnalign='left'>(?:<mspace[^>]*><\/mspace>)?<mi mathvariant='italic'>𝑐𝑐𝑐<\/mi><\/mtd>/,
    /<mtd columnalign='right'>(?:<mspace[^>]*><\/mspace>)?<mi>e<\/mi><\/mtd>/,
    /<mtd columnalign='right'>(?:<mspace[^>]*><\/mspace>)?<mi>x<\/mi><\/mtd><mtd>(?:<mspace[^>]*><\/mspace>)?<mi>x<\/mi><mo[^>]*>≥/,
    /<mtd columnalign='right'><mi>o<\/mi><\/mtd>/, /<mtd columnalign='left'><mi mathvariant='italic'>𝑞𝑞𝑞<\/mi><\/mtd>/,
    /<mtd(?: columnalign='center')?>(?:<mspace[^>]*><\/mspace>)?<mi>l<\/mi><\/mtd>/,
    /<mtd columnalign='right'>(?:<mspace[^>]*><\/mspace>)?<mstyle scriptlevel='1'><mi>α<\/mi><\/mstyle><\/mtd>/,
    /<mtd columnalign='left'>(?:<mspace[^>]*><\/mspace>)?<mstyle scriptlevel='1'><mi>β<\/mi><\/mstyle><\/mtd>/,
    /<mtd columnalign='right'>(?:<mspace[^>]*><\/mspace>)?(?:<mstyle[^>]*>)+<mi>δ<\/mi>/,
    /<mtd columnalign='left'>(?:<mspace[^>]*><\/mspace>)?<mstyle[^>]*><mi>η<\/mi><mstyle scriptlevel='1'><mi>ζ<\/mi>/,
    /<mtd(?: columnalign='center')?>(?:<mspace[^>]*><\/mspace>)?<mstyle scriptlevel='1'><mi>ϵ<\/mi>/,
    /<mtd columnalign='right'>(?:<mspace[^>]*><\/mspace>)?<mstyle displaystyle='true'><mi>γ<\/mi><\/mstyle><\/mtd>/,
    /<mi>a<\/mi><mrow data-mjx-texclass='REL'><mpadded[^>]*><mtext[^>]*>:<\/mtext><\/mpadded><mo[^>]*>=<\/mo><\/mrow><mi>b<\/mi>/,
    /<mpadded lspace='-\.5width' width='0'><mi>x<\/mi><\/mpadded>/],
  // eqnarray's rows \jot apart, as an align's
  'test-eqnarray': [
    /<mtable [^>]*data-tex8web-env='eqnarray'[^>]*rowspacing='0.274em'/,
    /<mtable [^>]*data-tex8web-env='eqnarray\*'[^>]*rowspacing='0.274em'/,
  ],
  // \lefteqn as in LaTeX: its argument in display style, in a box of no
  // width. In eqnarray, eqnarray* with \left( and \right. across rows,
  // align*, a numbered row, eqnarray's third column, and inline math, where
  // a sum's limits go above and below; a macro of the document inside
  'test-lefteqn': [
    /<mpadded width='0'><mstyle><mi>a<\/mi><mo[^>]*>\+<\/mo><mi>b<\/mi>(?:(?!<\/mpadded>)[^])*<mi>g<\/mi><\/mstyle><\/mpadded>/,
    /<mpadded width='0'><mrow data-mjx-texclass='INNER'><mo data-mjx-texclass='OPEN'>\(<\/mo><munderover>/,
    /<mpadded width='0'><mstyle><mi>p<\/mi>/,
    /<mpadded width='0'><mstyle><mfrac>[^]*?<\/mfrac><mo[^>]*>\+<\/mo><mo[^>]*>⟨<\/mo><mi>u<\/mi>/,
    /<mpadded width='0'><mstyle><mi>m<\/mi>/,
    /<mpadded width='0'><mstyle displaystyle='true'><munderover><mstyle mathsize='100.0%'><mtext>∑<\/mtext><\/mstyle><mrow data-mjx-texclass='ORD'><mi>j<\/mi>/,
    // on a middle row, in an array's cell (text style), too wide for a
    // phone, and with a relation at its end
    /<mpadded width='0'><mstyle><mi>a<\/mi><mo[^>]*>\+<\/mo><mi>b<\/mi><mo[^>]*>\+<\/mo><mi>c<\/mi><mo[^>]*>\+<\/mo><mi>e<\/mi><\/mstyle><\/mpadded>/,
    /<mpadded width='0'><mstyle displaystyle='true'><munderover><mstyle mathsize='100.0%'><mtext>∑<\/mtext><\/mstyle><mrow data-mjx-texclass='ORD'><mi>i<\/mi>/,
    /<mpadded width='0'><mstyle><msub><mi>a<\/mi><mn>1<\/mn><\/msub>(?:(?!<\/mpadded>)[^])*<mn>13<\/mn><\/mrow><\/msub><\/mstyle><\/mpadded>/,
    /<mpadded width='0'><mstyle><mi>w<\/mi>(?:(?!<\/mpadded>)[^])*<mi>z<\/mi><mo[^>]*>=<\/mo><\/mstyle><\/mpadded>/,
    // with long following rows, in a display wider than a phone
    /<mpadded width='0'><mstyle><munderover>(?:(?!<\/mpadded>)[^])*<mi>k<\/mi>(?:(?!<\/mpadded>)[^])*<mo[^>]*>=<\/mo><\/mstyle><\/mpadded>(?:(?!<mtr)[^])*<mtr>(?:(?!<\/mtr>)[^])*<msub><mi>b<\/mi><mn>1<\/mn>/,
  ],
  // text-mode commands in math, as LaTeX sets them: \enskip as half an em
  // of space, in a display, inline, between \left( and \right), in a
  // footnote, inside \text, and through a macro; \textsubscript and
  // \textsuperscript as upright text on an empty base, so after a
  // subscripted or superscripted base there is no double script, and a
  // superscript after one goes on the group, also inside \text; the counter
  // commands as nothing, with no trace of their arguments; \emph and \textsl
  // as italic text, \textsc and \textmd as upright text, also inside \text,
  // and \textup and \textnormal as before; and no command name in red
  'test-textmath': [
    /<mi>f<\/mi><mspace (?:[^>]* )?width='0\.5em'[^>]*><\/mspace><mi>g<\/mi>/,
    /<mi>a<\/mi><mspace (?:[^>]* )?width='0\.5em'[^>]*><\/mspace><mi>b<\/mi>/,
    /<mi>p<\/mi><mspace (?:[^>]* )?width='0\.5em'[^>]*><\/mspace><mi>q<\/mi>/,
    /<\/msub><mspace (?:[^>]* )?width='0\.5em'[^>]*><\/mspace><msub><mi>k<\/mi>/,
    /<mtext>c<\/mtext><mspace (?:[^>]* )?width='0\.5em'[^>]*><\/mspace><mtext>d<\/mtext>/,
    /<mi>μ<\/mi><mspace (?:[^>]* )?width='0\.5em'[^>]*><\/mspace><mi>ν<\/mi>/,
    /<mtext>H<\/mtext>(?:<mrow[^>]*>)?<msub>(?:<mrow[^>]*><\/mrow>|<mi><\/mi>)<mrow[^>]*><mtext>2<\/mtext><\/mrow><\/msub>(?:<\/mrow>)?<mtext>O<\/mtext>/,
    /<mtext>the 2<\/mtext>(?:<mrow[^>]*>)?<msup>(?:<mrow[^>]*><\/mrow>|<mi><\/mi>)<mrow[^>]*><mtext>nd<\/mtext><\/mrow><\/msup>(?:<\/mrow>)?<mtext> term<\/mtext>/,
    ...[['<mi>V<\\/mi>', 'P'], ['<mi>W<\\/mi>', 'S'], ['<mi>Z<\\/mi>', 'B'], ['<mn>0<\\/mn><\\/mrow><\\/msub>', 'Q']].map(([base, sub]) =>
      new RegExp(`${base}(?:<mrow[^>]*>)?<msub>(?:<mrow[^>]*><\\/mrow>|<mi><\\/mi>)<mrow[^>]*><mtext>${sub}<\\/mtext><\\/mrow><\\/msub>`)),
    /<mi>T<\/mi><msup><mrow[^>]*><msub>(?:<mrow[^>]*><\/mrow>|<mi><\/mi>)<mrow[^>]*><mtext>R<\/mtext><\/mrow><\/msub><\/mrow><mrow[^>]*><mn>2<\/mn><\/mrow><\/msup>/,
    ...[['<mi>x<\\/mi>', 'th'], ['<mn>2<\\/mn><\\/mrow><\\/msup>', 'nd']].map(([base, sup]) =>
      new RegExp(`${base}(?:<mrow[^>]*>)?<msup>(?:<mrow[^>]*><\\/mrow>|<mi><\\/mi>)<mrow[^>]*><mtext>${sup}<\\/mtext><\\/mrow><\\/msup>`)),
    /<math display='block'[^>]*>(?:<mrow[^>]*>)?<mtable [^>]*data-tex8web-env='matrix'/,
    /<msub><mi>n<\/mi><mn>1<\/mn><\/msub><\/mtd>/,
    /^(?![^]*(?:𝑀𝑎𝑥𝑀𝑎𝑡𝑟𝑖𝑥𝐶𝑜𝑙𝑠|𝑒𝑞𝑢𝑎𝑡𝑖𝑜𝑛|<mi>M<\/mi><mi>a<\/mi>|>MaxMatrixCols<|<mi>e<\/mi><mi>q<\/mi>))/,
    /^(?![^]*<mtext mathcolor='light-dark\(red)/,
    /<mi>x<\/mi><mo>\.<\/mo>(?:<mrow[^>]*>)?<mtext[^>]* mathvariant='italic'[^>]*>(?:of|𝑜𝑓)<\/mtext><mspace (?:[^>]* )?width='0pt'[^>]*><\/mspace><mtext[^>]* mathvariant='italic'[^>]*>(?:f|𝑓)<\/mtext>/,
    /<math xmlns='[^']*'>(?:<mrow[^>]*>)?<mtext[^>]* mathvariant='italic'[^>]*>(?:ab|𝑎𝑏)<\/mtext>/,
    /<mtext>see <\/mtext><mtext[^>]* mathvariant='italic'[^>]*>(?:cd|𝑐𝑑)<\/mtext>/,
    /<math xmlns='[^']*'>(?:<mrow[^>]*>)?<mtext(?![^>]*(?:mathcolor|italic))[^>]*>gh<\/mtext>/,
    /<math xmlns='[^']*'>(?:<mrow[^>]*>)?<mtext[^>]* mathvariant='italic'[^>]*>(?:ij|𝑖𝑗)<\/mtext>/,
    /<math xmlns='[^']*'><mrow><mtext>kl<\/mtext><mtext> and <\/mtext><mtext[^>]* mathvariant='italic'[^>]*>(?:mn|𝑚𝑛)<\/mtext><\/mrow><\/math>/,
    /<math xmlns='[^']*'><mtext>st<\/mtext><\/math>/,
    /<math xmlns='[^']*'><mtext>op<\/mtext><\/math>/,
    /<math xmlns='[^']*'><mtext>qr<\/mtext><\/math>/,
  ],
  // \hspace* in math as the space of \hspace, as in the PDF: in a heading,
  // in alignat at a row's start and middle with the equation's number, in
  // align before cases, with a space before the brace, in equation,
  // gather, multline, split, and align*, inline, inside \text, through a
  // macro, in an array's column spec, in a footnote, in a theorem, in the
  // table of contents, and in italic, sans-serif, and typewriter text;
  // unstarred \hspace, and \hspace* in text and in verbatim, as before
  'test-hspacemath': [
    spaced(sub('a', 1), '1em', sub('b', 1)),
    new RegExp(`<h3 [^>]*>(?:(?!<\\/h3>)[^])*${spaced(sub('a', 1), '1em', sub('b', 1)).source}`),
    new RegExp(`<div class='tableofcontents'>(?:(?!<\\/div>)[^])*${spaced(sub('a', 1), '1em', sub('b', 1)).source}`),
    spaced('<mo[^>]*>=<\\/mo>', '1em', sub('y', 2)),
    /Text <span class='tex8web-nbsp'> <\/span> here, and/,
    /<code class='verb'><span class='cmtt-10'>\$a\\hspace\*\{1em\}b\$<\/span><\/code>/,
    /<mtext>\(<\/mtext><mtext>1<\/mtext><mtext>\)<\/mtext><\/mtd><mtd>(?:<mspace [^>]*><\/mspace>)?<mspace width='-2mm'><\/mspace><mi>a<\/mi><mo[^>]*>=<\/mo><mspace width='-0\.5mm'><\/mspace><mi>b<\/mi>/,
    /<mtext>\(<\/mtext><mtext>2<\/mtext><mtext>\)<\/mtext><\/mtd><mtd>(?:<mspace [^>]*><\/mspace>)?<mspace width='-2mm'><\/mspace><mi>f<\/mi>(?:(?!<\/math>)[^])*data-tex8web-env='cases'(?:(?!<\/math>)[^])*<mtext>otherwise<\/mtext>/,
    spaced('<mi>c<\\/mi><mo[^>]*>=<\\/mo>', '1em', '<mi>d<\\/mi>'),
    spaced(sub('e', 1), '3mm', sub('e', 2)),
    spaced(sub('g', 1), '4mm', sub('g', 2)),
    spaced(sub('m', 1), '5mm', sub('m', 2)),
    spaced('<mo[^>]*>=<\\/mo>', '6mm', sub('s', 2)),
    spaced('<mi>i<\\/mi>', '1em', '<mi>j<\\/mi>'),
    spaced('<mtext>k<\\/mtext>', '1em', '<mtext>l<\\/mtext>'),
    spaced('<mi>g<\\/mi>', '2mm', '<mi>h<\\/mi>'),
    /<mi>p<\/mi><\/mtd><mtd><mspace width='2em'><\/mspace><\/mtd><mtd><mi>q<\/mi>/,
    spaced(sub('n', 1), '1em', sub('n', 2)),
    ...['t', 'u', 'v', 'w', 'x'].map(letter => spaced(sub(letter, 1), '2mm', sub(letter, 2))),
  ],
  // \text nested in \text in math as its inner text, as in the PDF: in a
  // heading, in a superscript, three deep in a display, with text beside
  // the inner \text, in a numbered equation, in a footnote, and in a
  // theorem; in \textbf, in \mbox, and through a macro in \text; \mbox
  // and \hbox in \text, \mbox in \mbox, and \mbox through a macro in
  // \text; \textit in \text, and \text in math in \text, as before
  'test-textnest': [
    /<math xmlns='[^']*'><mtext mathvariant='bold'>𝐉<\/mtext><\/math>/,
    /<math xmlns='[^']*'>(?:<mstyle[^>]*>)?<mtext>K<\/mtext>(?:<\/mstyle>)?<\/math>/,
    /<math xmlns='[^']*'><mtext>if L<\/mtext><\/math>/,
    /<math xmlns='[^']*'>(?:<mrow[^>]*>)?<mtext>H<\/mtext>(?:<\/mrow>)?<\/math>/,
    /<mi>z<\/mi>(?:(?!<\/math>)[^])*<mtext>E<\/mtext>(?:(?!<\/math>)[^])*<mi>t<\/mi>/,
    /<math display='block'[^>]*>(?:<mrow[^>]*>)?<mtext>F<\/mtext>(?:<\/mrow>)?<\/math>/,
    /<math xmlns='[^']*'>(?:<\/?(?:mrow|mtext)[^>]*>)*a[  ](?:<\/?(?:mrow|mtext)[^>]*>)*b(?:<\/?(?:mrow|mtext)[^>]*>)*[  ]c(?:<\/?(?:mrow|mtext)[^>]*>)*<\/math>/,
    /<mi>y<\/mi><mo[^>]*>=<\/mo><mtext>G<\/mtext>/,
    /<math xmlns='[^']*'>(?:<mrow[^>]*>)?<mtext>N<\/mtext>(?:<\/mrow>)?<\/math>/,
    /<math xmlns='[^']*'>(?:<mrow[^>]*>)?<mtext>T<\/mtext>(?:<\/mrow>)?<\/math>/,
    /<math xmlns='[^']*'><mtext[^>]* mathvariant='italic'>𝑞<\/mtext><\/math>/,
    /<mtext>for <\/mtext><mrow[^>]*>(?:<mrow>)?<mi>x<\/mi><mo[^>]*>∈<\/mo><mtext>A<\/mtext>/,
    /<math xmlns='[^']*'><mtext>m M<\/mtext><\/math>/,
    /<math xmlns='[^']*'><mtext>h W<\/mtext><\/math>/,
    /<math xmlns='[^']*'>(?:<mstyle[^>]*>)?<mtext>V<\/mtext>(?:<\/mstyle>)?<\/math>/,
    /<math xmlns='[^']*'>(?:<mrow>)?<mtext>min s\.t\. <\/mtext><mtext>x<\/mtext>(?:<\/mrow>)?<\/math>/,
  ],
  // \hspace*, \text, \mathrm, and \textbf in math in \thanks, on the title
  // and on an author, as in the PDF, with no \protect; the same in a
  // footnote as before
  'test-thanksmath': [
    spaced('<mi>a<\\/mi>', '1em', '<mi>b<\\/mi>'),
    /<math xmlns='[^']*'><mrow><mo[^>]*>\{<\/mo><mtext>a, b<\/mtext><mo[^>]*>\}<\/mo><\/mrow><\/math>/,
    /<math xmlns='[^']*'>(?:<mrow[^>]*>)?<mi mathvariant='normal'>r<\/mi>(?:<\/mrow>)?<\/math>/,
    /<math xmlns='[^']*'>(?:<mrow[^>]*>)?<mi mathvariant='bold'>𝐳<\/mi>(?:<\/mrow>)?<\/math>/,
    /<math xmlns='[^']*'>(?:<mrow[^>]*>)?<mi mathvariant='normal'>x<\/mi>(?:<\/mrow>)?<\/math>/,
    /<math xmlns='[^']*'><mtext mathvariant='bold'>𝐲<\/mtext><\/math>/,
    /<math xmlns='[^']*'><mrow><mo[^>]*>\{<\/mo><mtext>c, d<\/mtext><mo[^>]*>\}<\/mo><\/mrow><\/math>/,
    /<math xmlns='[^']*'>(?:<mrow[^>]*>)?<mi mathvariant='normal'>w<\/mi>(?:<\/mrow>)?<\/math>/,
    /<math xmlns='[^']*'><mtext mathvariant='bold'>𝐯<\/mtext><\/math>/,
  ],
};

// an equation number as MathJax reads it, with or without its parentheses
const eqLabel = n => `Label (?:open paren )?${n}(?: close paren)?`;

// What screen readers hear: ClearSpeak's words, | as "given" with
// \WebSpeechGiven (test.cfg) and as "divides" without it, no "normal"
// before an upright letter, Δ as "Delta", and A^\top as "A transpose"; a
// numbered equation without its number, then its label; an alignment of
// several lines as one formula
const speech = {
  'test-speech': [/aria-label='a divides b'/, /aria-label='3 divides 12'/],
  'test': [/aria-label='P of open paren A given B close paren'/, /aria-label='Gamma of z'/,
    /aria-label='d x'/, /aria-label='Delta of S'/, /aria-label='A transpose'/,
    /^(?![^]*down tack)/, /aria-label='x sub i transpose'/],
  'test-generic': [/aria-label='double struck P of [^']* over t Label open paren 2\.1 close paren'/,
    /aria-label='2 lines Line 1: x equals y Label open paren 2\.4 close paren Line 2: z equals w'/],
  // (fractions of nicefrac and xfrac, and quantities of the units extension
  // and siunitx: each one formula in text, in math, and in a display, but
  // text with mode=text; % read as "percent", and an angle in degrees,
  // also without siunitx, but not the interior A^\circ;
  // a number's digit groups as one number; ranges, lists, products, and
  // complex numbers in math with their words; micro and ohm)
  'test-units': [/aria-label='one half'/, /aria-label='one fourth'/,
    /aria-label='12 345\.678'/, /aria-label='1 234 567\.891 23'/,
    /aria-label='1 to 5'/, /aria-label='1 K to 5 K'/, /aria-label='1 comma 2 and 3'/, /aria-label='1 m and 2 m'/,
    /aria-label='2 K to 6 K'/, /aria-label='3 m and 4 m'/, /aria-label='3 through 7'/, /aria-label='4 by 5'/,
    /aria-label='2 times 3'/, /aria-label='2 m times 3 m'/, /aria-label='1 plus 2 i'/,
    /aria-label='open paren 1 plus 2 i close paren times Omega'/, /aria-label='2 mu m'/, /aria-label='5 Omega'/,
    /aria-label='3 times m s to the negative 1 power'/, /aria-label='2 percent'/, /aria-label='3 percent'/, /aria-label='1 K'/,
    /aria-label='30 degrees'/, /aria-label='4 degrees C'/, /aria-label='90 degrees'/,
    /aria-label='20 degrees C'/, /aria-label='25 degrees C'/, /aria-label='A raised to the composed with power'/,
    / 1\.5\u202Fm, /,
    /aria-label='v equals 3 times m s to the negative 1 power'/,
    /aria-label='9\.81 times the fraction with numerator m and denominator s squared'/,
    /aria-label='E equals 1\.6 times 10 to the negative 19 power J Label 1'/],
  // (\displaybreak with and without its optional argument, which leaves no
  // [n], on each kind of display, with the PDF's numbers; \allowdisplaybreaks
  // inside a display; and the cells that \hidewidth starts or ends with
  // their text alone)
  'test-displaybreak': [
    new RegExp(`aria-label='2 lines Line 1: a equals b ${eqLabel(1)} Line 2: c equals d ${eqLabel(2)}'`),
    new RegExp(`aria-label='6 lines Line 1: e equals f ${eqLabel(3)} Line 2: g equals h ${eqLabel(4)} Line 3: i equals j ${eqLabel(5)} ` +
      `Line 4: k equals l ${eqLabel(6)} Line 5: m equals n ${eqLabel(7)} Line 6: o equals p ${eqLabel(8)}'`),
    /aria-label='2 lines Line 1: x plus y Line 2: z'/,
    new RegExp(`aria-label='2 lines Line 1: q plus r plus s Line 2: equals t ${eqLabel(9)}'`),
    new RegExp(`aria-label='2 lines Line 1: u equals v empty w equals y ${eqLabel(10)} Line 2: A equals B C equals D ${eqLabel(11)}'`),
    /aria-label='2 lines Line 1: E equals F Line 2: G equals H'/,
    new RegExp(`aria-label='2 lines Line 1: I equals J ${eqLabel(12)} Line 2: K equals L ${eqLabel(13)}'`),
    new RegExp(`aria-label='2 lines Line 1: M equals N ${eqLabel(14)} Line 2: O equals P ${eqLabel(15)}'`),
    /aria-label='2 lines Line 1: Q equals R Line 2: S equals T'/,
    new RegExp(`aria-label='2 lines Line 1: U equals V ${eqLabel(16)} Line 2: W equals X ${eqLabel(17)}'`),
    /aria-label='2 lines Line 1: Y equals Z Line 2: alpha equals beta'/,
    /aria-label='2 lines Line 1: a Line 2: b b b empty 2 lines Line 1: c c c Line 2: d empty /,
    /Row 1: (?:Column 1, )?e (?:Column 2, )?f Row 2: /, /Row 1: Column 1, k k k Column 2, l Row 2: Column 1, m /,
    /Case 1: x x is greater than or equal to 0 Case 2: /,
    /aria-label='2 lines Line 1: o Line 2: p p p'/, /aria-label='2 lines Line 1: q q q Line 2: r'/,
    new RegExp(`aria-label='7 lines Line 1: a equals b Line 2: c equals d ${eqLabel(18)} Line 3: e equals f ${eqLabel('cap A')} ` +
      `Line 4: g equals h ${eqLabel(19)} Line 5: i equals j ${eqLabel(20)} Line 6: k equals l ${eqLabel(21)} Line 7: o equals p ${eqLabel(22)}'`),
    new RegExp(`aria-label='2 lines Line 1: x ${eqLabel(23)} Line 2: y ${eqLabel(24)}'`),
    new RegExp(`aria-label='2 lines Line 1: x equals y ${eqLabel(25)} Line 2: z equals w ${eqLabel(26)}'`),
    /aria-label='2 lines Line 1: x equals y y y Line 2: z equals w empty 2 lines Line 1: x Line 2: y y y'/,
    /^(?![^]*aria-label='[^']*backslash)/,
  ],
  // (\enskip as "empty", as MathJax reads \quad; the counter commands as
  // nothing; the scripts and fonts as their text)
  'test-textmath': [/aria-label='f empty g'/, /aria-label='a empty b'/, /aria-label='p empty q'/,
    /aria-label='c empty d'/, /aria-label='mu empty nu'/,
    /aria-label='open paren h sub l m empty k sub l m close paren Label 1'/,
    /aria-label='r equals s'/, /aria-label='t equals u Label \d+'/,
    /aria-label='v equals w'/, /aria-label='alpha equals beta Label \d+'/, /aria-label='e equals o'/,
    /aria-label='W sub cap S'/, /aria-label='V sub cap P'/, /aria-label='U sub 0 sub cap Q'/,
    /aria-label='T sub cap R and super 2'/, /aria-label='Z sub cap B'/, /aria-label='cap H sub 2 cap O'/,
    /aria-label='x raised to the th power'/, /aria-label='y squared super nd'/,
    /aria-label='the 2 super nd term'/, /aria-label='x period italic of italic f sine x Label \d+'/,
    /aria-label='italic ab'/, /aria-label='gh'/, /aria-label='italic ij'/, /aria-label='st'/],
  // (amsmath's macro pairs read as the matrices of \begin and \end, with
  // the PDF's numbers on the rows of a numbered align, gather, eqnarray,
  // and alignat, which the rows inside a matrix do not end; in a heading
  // and its entry in the table of contents, a footnote, and a theorem)
  'test-envmacro': [
    /<h3 class='sectionHead' id='rotations-by-c-s-'>(?:(?!<\/h3>)[^])*Rotations by <mjx-container aria-label='the 1 by 2 row matrix c s'/,
    /<a href='#rotations-by-c-s-' id='[^']*'>Rotations by <mjx-container aria-label='the 1 by 2 row matrix c s'/,
    /aria-label='v equals the 1 by 2 row matrix 1 0 Label 1'/,
    /aria-label='p equals the 2 by 2 matrix Row 1: a b Row 2: c d times the determinant of the 2 by 2 matrix Row 1: e f Row 2: g h times the determinant of the 2 by 2 matrix Row 1: i j Row 2: k l times 2 lines Line 1: m n Line 2: o q Label 2'/,
    /aria-label='B equals the 2 by 2 matrix Row 1: 1 2 Row 2: 3 4 times the 2 by 1 column matrix 5 6 times the 1 by 1 column matrix 7 times the 1 by 1 column matrix 8 times 1 lines Line 1: 9 0'/,
    /aria-label='w equals the 2 by 1 column matrix 1 0 to the T power'/,
    /aria-label='the 2 by 1 column matrix r s'/,
    /aria-label='the determinant of the 2 by 2 matrix Row 1: t u Row 2: x y'/,
    /aria-label='the 2 by 1 column matrix z alpha'/,
    /aria-label='the 2 by 2 matrix Row 1: beta gamma Row 2: delta epsilon'/,
    /aria-label='5 lines Line 1: A equals the 2 by 2 matrix Row 1: a b Row 2: c d C equals the 2 by 1 column matrix e f Line 2: D equals the determinant of the 2 by 2 matrix Row 1: g h Row 2: i j E equals the determinant of the 2 by 2 matrix Row 1: k l Row 2: m n Line 3: F equals 2 lines Line 1: o p Line 2: q r Line 4: P equals the 2 by 1 column matrix e f Q equals R Line 5: S equals the 1 by 3 row matrix a b c T equals U'/,
    /aria-label='5 lines Line 1: G equals the 2 by 1 column matrix 1 2 Label 3 Line 2: H equals the 2 by 1 column matrix 3 4 Label 4 Line 3: I equals the determinant of the 2 by 2 matrix Row 1: a b Row 2: c d Label 5 Line 4: J equals the determinant of the 2 by 2 matrix Row 1: e f Row 2: g h Label 6 Line 5: K equals 2 lines Line 1: 5 Line 2: 6 Label 7'/,
    /aria-label='3 lines Line 1: L equals the 2 by 1 column matrix a b Label 8 Line 2: M equals the 2 by 1 column matrix c d times the 2 by 1 column matrix e f Label 9 Line 3: N equals the 2 by 1 column matrix 7 8 times 2 lines Line 1: 9 Line 2: 0 Label open paren 10 close paren'/,
    /aria-label='2 lines Line 1: W equals the 2 by 2 matrix Row 1: Column 1, 2 lines Line 1: 1 Line 2: 2 Column 2, 0 Row 2: Column 1, 0 Column 2, 1 Label open paren 11 close paren Line 2: X equals 1 Label open paren 12 close paren'/,
    /aria-label='2 lines Line 1: Y equals the 2 by 1 column matrix 1 2 Label open paren 13 close paren Line 2: Z equals 3 Label open paren 14 close paren'/,
    /aria-label='2 lines Line 1: a equals the 2 by 1 column matrix 1 2 empty b equals 4 Label open paren 15 close paren Line 2: c equals 5 empty d equals 6 Label open paren 16 close paren'/,
    /aria-label='u equals the 2 by 1 column matrix x y'/,
    /aria-label='O equals the 2 by 2 matrix Row 1: Column 1, the 1 by 1 column matrix a Column 2, 2 lines Line 1: 1 2 Line 2: 3 4 Row 2: Column 1, the 1 by 1 column matrix b Column 2, the 1 by 1 matrix with entry c'/,
    /aria-label='the 2 by 1 column matrix 0 1'/, /aria-label='the 1 by 2 row matrix 2 3'/],
  // (plain TeX's \pmatrix, \matrix, and \cases with braces, without amsmath)
  'test-envmacro-plain': [/aria-label='P equals the 2 by 2 matrix Row 1: a b Row 2: c d'/,
    /aria-label='Q equals 2 lines Line 1: 1 2 Line 2: 3 4'/,
    /aria-label='s equals 2 cases Case 1: 1 positive Case 2: 0 otherwise'/,
    /aria-label='R equals the 2 by 1 column matrix x y Label 1'/,
    // (a \bmatrix of the document's, with braces)
    /aria-label='M equals the 2 by 2 matrix Row 1: a b Row 2: c d'/,
    /aria-label='2 lines Line 1: x equals the 2 by 1 column matrix 1 2 Label 2 Line 2: y equals 3 Label 3'/],
  // (amsmath, with a \bmatrix of the document's that takes an argument:
  // its rows in a numbered align keep their numbers)
  'test-envmacro-own': [/aria-label='2 lines Line 1: x equals the 2 by 1 column matrix 1 2 Label 1 Line 2: y equals 3 Label 2'/,
    /aria-label='M equals the 2 by 2 matrix Row 1: a b Row 2: c d'/],
  // (\m@th before content in \mbox and \ensuremath, after content, after a
  // style command, in display math, in a formula inside a formula, and in
  // a math macro's body, also in a heading and the table of contents, as
  // the content alone; no formula in red; the logos' epsilon and chi, whose
  // \m@th is outside their formula)
  'test-hologo': [/aria-label='q plus r'/, /aria-label='alpha beta'/, /aria-label='the metric of w'/,
    /aria-label='k plus l'/, /aria-label='m minus n'/, /aria-label='a plus b'/, /aria-label='c plus d'/,
    /aria-label='e plus f Label 1'/, /aria-label='the metric of v'/,
    /tocnumber'>2<\/span><a [^>]*>Norm <mjx-container aria-label='the metric of z'/,
    /<a id='[^']*'><\/a>Norm <mjx-container aria-label='the metric of z'/,
    /^(?![^]*mathcolor='light-dark\(red)/,
    /<span class='HoLogo-2'>2<\/span><span class='HoLogo-e'><mjx-container aria-label='epsilon'/,
    /<span class='tex8web-nowrap'><mjx-container aria-label='epsilon'[^]*?<\/mjx-container>-<span class='HoLogo-TeX'>/,
    /<span class='HoLogo-X'><mjx-container aria-label='chi'/],
};

// Pictures sized by \includegraphics's width, scale, or height: a share of
// the PDF's text width, which keeps their size relative to the text on a
// narrower screen
const share = (alt, fraction) => new RegExp(`<img alt='${alt}' [^>]*style='width:calc\\(var\\(--tex8web-textwidth\\) \\* ${fraction.replace('.', '\\.')}\\)'`);
const drawn = (n, width, more = '') => new RegExp(`<img alt='' src='test-tikzbox${n}x\\.svg' style='width:calc\\(var\\(--tex8web-textwidth\\) \\* ${width.replace('.', '\\.')}\\)${more.replace(/[().*]/g, '\\$&')}' />`);
// lowered by a share of its width, which is at most the column's width
const lowered = (width, ratio) => `calc(min(${width}, var(--tex8web-column)) * -${ratio})`;
const lower = (width, ratio) => `; vertical-align:${lowered(`var(--tex8web-textwidth) * ${width}`, ratio)}`;
// an \includegraphics picture with the alt text, mirrored or turned over
// by the factors' signs (none for 1, 1), and lowered by its height when
// turned over (a lookahead, so the order of the properties is free)
const flipped = (alt, sx, sy, below) => new RegExp(`<img alt='${alt}' ` +
  (sx === 1 && sy === 1 ? '(?![^>]*transform)' : `(?=[^>]*style='[^']*transform:scale\\(${sx}, ${sy}\\))`) +
  (below ? `(?=[^>]*style='[^']*vertical-align:${below.replace(/[().*]/g, '\\$&')})` : '(?![^>]*vertical-align)') + '[^>]*\\/>');
// an \includegraphics picture's width as a share of the text width, with
// more of the style after it
const wide = (alt, fraction) =>
  new RegExp(`<img alt='${alt}' [^>]*style='width:calc\\(var\\(--tex8web-textwidth\\) \\* ${fraction.replace('.', '\\.')}\\);`);
// a picture's image in the document's numbered images, then the paragraph
// after it, with no other image or such paragraph between them
const overpic = (doc, ext, after) =>
  new RegExp(`<img [^>]*src='${doc}\\d+x\\.${ext}'[^>]*\\/>(?:(?!<img|After )[^])*After ${after}\\.`);
// a PNG without its .xbb file, outside any picture: tex4ht's image of the
// PNG itself, 80pt wide
const plainPng = /<img [^>]*src='test-overpic-hidpi\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.2319\)' \/> After plain\./;
// the same PNG with scale or height, after an overpic of it: tex4ht's
// size, since the natural size read for the overpic is not kept
const plainSized = ['scaled', 'height'].map(after =>
  new RegExp(`<img (?:(?!style=)[^>])*src='test-overpic-hidpi\\.png'(?:(?!style=)[^>])*\\/> After plain ${after}\\.`));
// Pictures converted to PNG (PDF and EPS) or named by a path that leaves
// the document's folder: by alt, the file each <img> must show, a source
// picture (from test/) whose copy it is, or, for a conversion, the width
// over the height of its PDF page or EPS bounding box, which the PNG must
// have. Every <img> of the page must name a file inside the page's folder.
const copied = {
  'test-pdfpic': {
    ...Object.fromEntries(['bare', 'extension', 'starred', 'options', 'italic', 'footnote', 'link', 'minipage', 'display',
      'subfigure', 'parentheses', 'half one', 'half two'].map(alt => [`pdf ${alt}`, 64 / 48])),
    'pdf page one': 64 / 48, 'pdf page two': 120 / 30, 'pdf graphicspath': 120 / 30, 'pdf figure': 120 / 30,
    'pdf natural': 64 / 48, 'pdf height': 64 / 48, 'pdf scale': 64 / 48, 'pdf page natural': 120 / 30,
    'pdf kpathsea natural': 4 / 3,
    'pdf space natural': 64 / 48, 'pdf space height': 64 / 48, 'pdf space scale': 64 / 48, 'pdf space fitted': 64 / 48,
    'pdf space width to height': 64 / 48,
    'pdf space': 1, 'pdf beside': 100 / 20, 'pdf kpathsea': 4 / 3, 'pdf same name': 30 / 60, 'pdf dots': 50 / 25,
    'eps': 57 / 28, 'eps bare': 57 / 28, 'eps parentheses': 57 / 28, 'above pdf': 90 / 30, 'above eps': 30 / 45,
    // (a PDF and an EPS picture with one name, a PDF beside a PNG named as
    // its conversion was, and an EPS beside a PNG of its name, which tex4ht
    // shows in its place)
    'twin pdf': 80 / 20, 'twin eps': 20 / 40, 'own pdf': 96 / 32, 'own png': 'fixtures/test-pdfpic/own-1.png',
    'own eps': 'fixtures/test-pdfpic/owneps.png',
    // (a PDF with a 400bp square MediaBox and a CropBox 160bp by 80bp)
    'pdf cropbox': 160 / 80,
    // (the same name in two parent folders, two copies; the same picture
    // named three ways, one)
    'above graphicspath': 'pdfpic-above/pic.png', 'above again': 'pdfpic-above/pic.png', 'above figure': 'pdfpic-above/pic.png',
    'above starred': 'pdfpic-above/pic.png', 'above link': 'pdfpic-above/pic.png', 'chapter': 'pdfpic-above/pic.png',
    'above other': 'pdfpic-above/other/pic.png', 'above epsfig': 'pdfpic-above/other/pic.png',
    'above deep': 'pdfpic-above/deep/pic.jpg', 'above space': 'pdfpic-above/two words.png',
    'imported': 'pdfpic-above/shared/shared.png', 'inside': 'fixtures/test-pdfpic/inside.png',
  },
};
// converted pictures by alt: the width and height in pixels the PNG must
// have at 300 dpi, within two pixels
const pixelSizes = {
  'test-pdfpic': { 'pdf cropbox': [667, 333] },
};
// converted pictures with no space before them in the source, by alt: the
// page must have none before their <img> either
const unspaced = {
  'test-pdfpic': ['pdf link', 'pdf parentheses', 'pdf half one', 'pdf half two', 'eps parentheses'],
};
// Pages of a PDF included with pdfpages, by the paragraph "Run name." before
// them: the pages the PDF shows there, in order, each a picture inside the
// page's folder before the next run. The PDFs in test/fixtures/test-pdfpages/
// have pages 30bp high and of widths that name them: page k of four.pdf is
// 30(k + 1)bp wide, of two.pdf 30(k + 5)bp, of three.pdf 30(k + 7)bp, and of
// eight.pdf 30(k + 10)bp. mwe's pages all have one size, so a page of
// example-image-letter-numbered is named by its PNG's name, which ends in -k.png.
// No picture comes before the first run or after the run "end".
const pdfPages = {
  'test-pdfpages': {
    dash: 'four 1, four 2, four 3, four 4', closed: 'four 1, four 2, four 3', 'open end': 'four 3, four 4',
    'open start': 'four 1, four 2', last: 'four 4', reversed: 'four 4, four 3, four 2',
    'last to first': 'four 4, four 3, four 2, four 1', blank: 'four 1, four 4', repeats: 'four 2, four 4, four 1, four 2',
    list: 'four 3, four 1', one: 'four 2', default: 'four 1', extension: 'four 1, four 2, four 3, four 4',
    graphicspath: 'three 1, three 2, three 3', merge: 'four 2, four 3, two 1, two 2',
    doublepages: 'four 1, four 1, four 2, four 2', duplicatepages: 'four 2, four 2, four 2, four 3, four 3, four 3',
    lastpage: 'four 1, four 2, four 3, four 4', openright: 'two 1, two 2', set: 'two 1, two 2',
    'last end': 'four 2, four 3, four 4', spaces: 'four 3, four 1, four 2', 'merge default': 'two 1, four 3',
    'merge pages': 'two 1, two 2, four 3', kpathsea: 'example-image-letter-numbered 2, example-image-letter-numbered 3',
    eight: 'eight 6, eight 7, eight 8', 'eight open': 'eight 7, eight 8',
  },
  'test-pdfpages-plain': { dash: 'four 1, four 2, four 3, four 4', closed: 'four 2, four 3', merge: 'two 1, two 2, four 4' },
  'test-pdfpages-hint': { dash: 'four 1, four 2, four 3, four 4', last: 'four 2, four 3, four 4', nohint: 'four 1, four 2, four 3, four 4', closed: 'four 1, four 2, four 3, four 4', space: 'four 1, four 2, four 3, four 4, spaced 1, spaced 2' },
  'test-pdfpages-dvips': { space: 'spaced 1', dash: 'four 1, four 2, four 3, four 4' },
};
// the runs of test-pdfpages-hint built without shell escape: the lastpage
// hint of 3 gives the number of pages, short of four.pdf's 4, so only a
// build that used the hint shows these; without the hint, the number is 1,
// and a closed range needs no number
const pdfPagesNoShell = { dash: 'four 1, four 2, four 3', last: 'four 2, four 3', nohint: 'four 1', closed: 'four 1, four 2, four 3, four 4', space: 'four 1, four 2, spaced 1, spaced 2' };
// pdfpages' warning, in the TeX log, when it has no number of pages and no
// lastpage hint (ppnull.def)
const pdfpagesHintWarning = "You can use the option `lastpage' to give me a hint";
// ppdvips.def's warning, in the TeX log, when it has no number of pages,
// as it replaces its macro that sets the number with one that sets 1
const pdfpagesDvipsWarning = 'Page selections not supported by driver dvips';
const pdfPageOffset = { four: 1, two: 5, spaced: 5, three: 7, eight: 10 };
// the file a src names in the page's folder, or null if the src leaves it
const inPage = (out, src) => !src || /^\/|(^|\/)\.\.(\/|$)/.test(src) ? null : join(out, decodeURIComponent(src));
// a PNG's width over its height (its IHDR chunk), or NaN if it is no PNG
const pngAspect = data => data.readUInt32BE(0) === 0x89504e47 ? data.readUInt32BE(16) / data.readUInt32BE(20) : NaN;
// the problems with runs, such as pdfPages[name], on a page, flat, with its
// whitespace runs made single spaces, in the folder out
const checkPdfPages = (runs, flat, out) => {
  const problems = [];
  for (const [run, pages] of Object.entries(runs)) {
    const part = flat.match(new RegExp(`Run ${run}\\.([^]*?)Run `))?.[1];
    if (part === undefined) { problems.push(`no run ${run}`); continue; }
    const want = pages.split(', ').map(page => { const [file, k] = page.split(' '); return file in pdfPageOffset ? String(Number(k) + pdfPageOffset[file]) : `-${k}.png`; });
    const got = [...part.matchAll(/<img [^>]*>/g)].map(([tag], i) => {
      const file = inPage(out, tag.match(/ src='([^']*)'/)?.[1]);
      const aspect = file && existsSync(file) ? pngAspect(readFileSync(file)) : NaN;
      if (isNaN(aspect)) return 'NaN';
      return want[i]?.endsWith('.png') ? basename(file) : String(Math.round(aspect * 10) / 10);
    });
    if (got.length !== want.length || got.some((g, i) => want[i].endsWith('.png') ? !g.endsWith(want[i]) : g !== want[i])) {
      problems.push(`run ${run}: pictures ${got.join(', ')}, not ${want.join(', ')} (${pages}; a number is a picture's width over its height)`);
    }
    // (each page of its own in the PDF: the pictures in one block, outside
    // any paragraph, with nothing else in it)
    const block = part.match(/<div class=['"]tex8web-pdfpages['"]>([^]*?)<\/div>/)?.[1];
    if (block === undefined || block.replace(/<img [^>]*>/g, '').trim() || part.split(/<div class=['"]tex8web-pdfpages['"]>/).length !== 2) {
      problems.push(`run ${run}: the pictures are not alone in one div.tex8web-pdfpages`);
    }
  }
  // (each page is a picture at 300 dpi, so every one after the first on the
  // page loads only when it nears the screen, also in a run of one page
  // after another, such as the runs one and default of test-pdfpages)
  const lazy = [...flat.matchAll(/<div class=['"]tex8web-pdfpages['"]>([^]*?)<\/div>/g)]
    .flatMap(([, block]) => [...block.matchAll(/<img [^>]*>/g)].map(([tag]) => / loading=['"]lazy['"]/.test(tag)));
  if (lazy.some((l, i) => l !== (i > 0))) problems.push(`loading='lazy' on the pictures of pdfpages ${lazy.map(Number).join(', ')}, not on every one after the first`);
  if (/<img /.test(flat.split(`Run ${Object.keys(runs)[0]}.`)[0]) || /<img /.test(flat.split('Run end.')[1] ?? '')) problems.push('a picture before the first run or after the run end');
  return problems;
};
// the files and folders in the folders of test-pdfpic's source pictures and
// of test-pdfpages' PDFs, and those beside the fixture named test-pdfpic*,
// such as test-pdfpic-box.pdf, that a build wrote or changed there: those
// not there when this script started, and those whose time of change is
// later, such as a tracked picture written over. Finder's .DS_Store is left
// out. Each page's check takes those in its own folders.
const pdfpicFolders = ['test/pdfpic-above', 'test/fixtures/test-pdfpic', 'test/fixtures/test-pdfpages'];
const pdfpicStatus = () => [...pdfpicFolders.flatMap(dir => readdirSync(join(root, dir), { recursive: true }).map(f => join(dir, f))),
  ...readdirSync(join(root, 'test/fixtures')).filter(f => f.startsWith('test-pdfpic')).map(f => join('test/fixtures', f))]
  .filter(f => !f.endsWith('.DS_Store'));
const pdfpicTime = f => { try { const st = statSync(join(root, f)); return st.isFile() ? st.mtimeMs : 0; } catch { return -1; } };
const pdfpicBefore = new Map(pdfpicStatus().map(f => [f, pdfpicTime(f)]));
const pdfpicWritten = () => pdfpicStatus().filter(f => !pdfpicBefore.has(f) || pdfpicTime(f) !== pdfpicBefore.get(f)).sort();
const pdfpagesFolder = 'test/fixtures/test-pdfpages/';
const pdfpicOnly = () => pdfpicWritten().filter(f => !f.startsWith(pdfpagesFolder));
const pdfpagesOnly = () => pdfpicWritten().filter(f => f.startsWith(pdfpagesFolder));
const pictures = {
  // (in a 345pt text width, for a picture 64bp by 48bp: 100pt wide, 1.5
  // times its size, 96pt high so 128pt wide, and 100pt by 40pt without
  // keepaspectratio (never squashed) and with it; one without a size as
  // tex4ht writes it)
  'test-graphics': [share('width', '0.2899'), share('scale', '0.2793'), share('height', '0.371'),
    share('both', '0.2899'), share('fitted', '0.1546'), share('angle last', '0.2899'), /<img alt='bare' (?:(?!style=)[^>])*\/>/,
    // (a size after angle, and scale with a size: left to tex4ht)
    ...['rotated', 'scaled first', 'scaled last'].map(alt => new RegExp(`<img alt='${alt}' (?:(?!style=)[^>])*\\/>`))],
  // (graphicx loaded by mathtools at \begin{document}, and graphicx and
  // ccicons by doclicense at the end of the preamble: a PNG 2cm wide, and
  // doclicense's text, picture, and icon, an SVG picture that follows the theme)
  'test-graphics-late-mathtools': [share('late', '0.1649')],
  'test-graphics-late-doclicense': [/Attribution-ShareAlike 4\.0 International/,
    /<img alt='' src='tex8web-pictures\/[0-9a-f]+\/doclicense-CC-by-sa-88x31\.eps-1\.png'/,
    /Icon: <img alt='' src='test-graphics-late-doclicense0x\.svg' /],
  // (PDF pictures without a .xbb file, sized from the PDF's bounding box in
  // a 345pt text width, for a picture 64bp by 48bp: no size, 3cm high, and
  // half its size; page 2 of a PDF, 120bp wide, with no size; and a quarter
  // of TeX Live's example-image-a.pdf, 320bp wide; a PDF with a CropBox
  // 160bp wide in a MediaBox 400bp wide. The same picture with a
  // space in its name, whose box TeX cannot read, sized from its PNG of 267
  // by 200 pixels at 300 dpi: no size, 3cm high, half its size, and
  // fitted in 5cm by 1cm; in a \scalebox{2}, 1cm high and with no size;
  // in a \resizebox to 3cm wide, to 1cm high, to half the text width, and
  // to 3cm by 1cm inside a \scalebox{.5}; 2cm wide in a \resizebox to 1cm
  // high, to 3cm wide, and to 3cm by 1cm; 1cm wide in a \scalebox{2})
  'test-pdfpic': [share('pdf natural', '0.1862'), share('pdf height', '0.3299'), share('pdf scale', '0.0931'),
    share('pdf page natural', '0.3491'), share('pdf kpathsea natural', '0.2328'),
    share('pdf cropbox', '0.4655'),
    share('pdf space natural', '0.1864'), share('pdf space height', '0.3303'), share('pdf space scale', '0.0932'),
    share('pdf space fitted', '0.1101'), share('pdf space scalebox', '0.2203'),
    share('pdf space scalebox natural', '0.3729'), share('pdf space resizebox', '0.2474'),
    share('pdf space resizebox height', '0.1101'), share('pdf space resizebox half', '0.5000'),
    share('pdf space resizebox scaled', '0.1237'),
    share('pdf space width to height', '0.1101'), share('pdf space width to width', '0.2474'),
    share('pdf space width to both', '0.2474'), share('pdf space scalebox width', '0.1650')],
  // (the graphics package: a picture without a size or a .xbb, left to tex4ht)
  'test-graphics-only': [/<img (?:(?!style=)[^>])*\/>/],
  // (pictures over a PDF or PNG without its .xbb file, and one with it:
  // each picture's image, then the text after it, with no other picture or
  // text between them)
  'test-overpic': [...['share', 'natural', 'trimmed', 'grid', 'path', 'permil', 'set', 'boxed', 'picture', 'figure',
    'bare name', 'italic', 'minipage', 'cell', 'photo', 'moved', 'cropped', 'second page', 'dense', 'folder',
    'natural picture', 'subfigure', 'found'].map(after => overpic('test-overpic', 'png', after)), plainPng, ...plainSized],
  'test-overpic-drawn': [...['overpic', 'picture', 'node', 'found'].map(after => overpic('test-overpic-drawn', 'svg', after)),
    plainPng],
  'examples/basic': [/<img [^>]*style='width:calc\(var\(--tex8web-textwidth\) \* 0\.25\)'/],
  // (in minipages, where \textwidth is the minipage's width)
  'test': [/<img [^>]*style='width:calc\(var\(--tex8web-textwidth\) \* 0\.225\)'/,
    /<img [^>]*style='width:calc\(var\(--tex8web-textwidth\) \* 0\.45\)'/],
  // (TikZ pictures as wide as in the PDF in boxes that resize them: half,
  // the text width (a \tikz and an environment), 1cm high, a quarter,
  // mirrored, twice as wide only, and an \includegraphics halved; as low
  // as in the PDF with a baseline, also when scaled, and turned over; with
  // no baseline, around a picture with one, or in display math, and with
  // no alt text; a space after a \tikz; text in a scaled box, also in a
  // picture, left without marks)
  'test-tikzbox': [drawn(0, '0.1655'), drawn(2, '1.0000'), drawn(15, '1.0000'), drawn(3, '0.1644'), drawn(4, '0.0828'),
    drawn(5, '0.3310', '; transform:scale(-1, 1)'), drawn(6, '0.6621', '; aspect-ratio:3.9860'),
    drawn(7, '0.0754', lower('0.0754', '0.1358')), /test-tikzbox7x\.svg'[^>]*\/> and/, drawn(8, '0.0506', lower('0.0506', '0.3768')), drawn(9, '0.0506'),
    drawn(10, '0.0742', lower('0.0742', '0.1303')), drawn(11, '0.0640', lower('0.0640', '0.1601')), drawn(12, '0.0518', lower('0.0518', '0.2591')),
    drawn(16, '0.1661', `${lower('0.1661', '0.5035')}; transform:scale(1, -1)`), drawn(13, '0.1662'), drawn(14, '0.1647'),
    share('halved', '0.1449'), /Text: Big/, /^(?![^]*tex8web-scale)/],
  // (\includegraphics pictures mirrored as in the PDF, at any size and in
  // any context, halved too; turned over, 75pt high, 37.5pt when halved,
  // or 48bp without a size, so hanging below the baseline; two
  // \reflectbox mirror nothing, and a picture that dvisvgm draws is
  // mirrored in its SVG, not again by its <img>; a picture at its
  // natural size is not scaled; a mirror around a rotation is before it,
  // on its span, and one inside a rotation on the picture; a picture
  // with a height that does not keep its aspect is shown, and lowered,
  // 75pt high, as is one halved only in height; a picture without its
  // .xbb file turned over but not lowered, its height unknown)
  'test-reflectbox': [
    ...['bare', 'width', 'half', 'half bare', 'nested', 'left', 'right', 'link', 'footnote', 'cell', 'minipage',
      'theorem', 'italic', 'figure'].map(alt => flipped(alt, -1, 1)),
    wide('half', '0.1449'), wide('nested', '0.1449'), wide('half over', '0.1449'),
    flipped('half over', -1, -1, lowered('var(--tex8web-textwidth) * 0.1449', '0.7499')),
    /<img alt='' class='tex8web-graphic' src='test-reflectbox0x\.svg' (?![^>]*transform)[^>]*\/>/,
    flipped('over', 1, -1, lowered('var(--tex8web-textwidth) * 0.2899', '0.7499')),
    flipped('round', -1, -1, lowered('var(--tex8web-textwidth) * 0.2899', '0.7499')),
    flipped('over bare', 1, -1, lowered('64px', '0.7500')),
    ...['rotated', 'angle'].map(alt => new RegExp(
      `<span class='rotatebox' style='transform: scale\\(-1, 1\\) rotate\\(-90deg\\);'> <img alt='${alt}' (?![^>]*transform)`)),
    /<span class='rotatebox' style='transform: rotate\(-90deg\);'> <img alt='rotated inside' /,
    flipped('rotated inside', -1, 1),
    flipped('squashed', 1, -1, lowered('var(--tex8web-textwidth) * 0.2899', '0.7499')),
    flipped('flattened', 1, -1, lowered('var(--tex8web-textwidth) * 0.2899', '0.7499')),
    flipped('twice', 1, 1), flipped('over no box', 1, -1), flipped('squashed no box', 1, -1)],
  // (2cm in a 345pt text width, in each display)
  'test-display-picture': ['bracket graphics', 'dollars graphics', 'displaymath graphics', 'equation star graphics']
    .map(alt => share(alt, '0.1649')),
  'test-display-picture-hyperref': [share('hyperref graphics', '0.1649')],
};

// Display math whose body is only a picture, as the PDF shows it: the
// picture in the display, with no MathJax there and no MathJax error.
// Each case is the page from its paragraph's name to the next name, with
// the extra text that must be in it: a number, or the QED box of a
// \qedhere. A display of math stays MathJax's.
const pictureCases = ['Dollars tikzpicture', 'Bracket tikzpicture', 'Bracket tikz command', 'Dollars tikz command',
  'Dollars tikzcd', 'Bracket matrix', 'Dollars matrix', 'Bracket graphics', 'Dollars graphics',
  'Displaymath tikzpicture', 'Displaymath graphics', ['Equation tikzpicture', '(1)'], 'Equation star graphics',
  'Equation star tikzcd', 'Bracket picture environment', 'Theorem tikzpicture', ['Proof tikzpicture', 'tex8web-qed']];
// more cases, each with the number or tag its display shows ('' for none),
// by document
const pictureNumbers = { 'test-display-picture': { 'Equation label first': '(2)', 'Equation tag graphics': '(A)', 'Equation star tag': 'B',
  'Equation notag': '', 'Bracket tikz node': '', 'Equation star resizebox': '', 'Equation wide graphics': '(3)',
  'Equation after a blank line': '', 'Proof equation tikzpicture': '(4)', 'Equation long tag': 'the long tag',
  'Theorem equation graphics': '(5)', 'Bracket tag graphics': '(C)', 'Equation tikzcd period': '(6)',
  'Dollars graphics comma': '', 'Bracket tikzpicture period': '', 'Numbered after a blank line': '(7)',
  'Bracket after a blank line': '', 'Bracket tikzcd': '', 'Bracket tikzcd tag': '(D)', 'Proof tikzpicture period': '',
  'Equation empty star tag': '', 'Equation tikzcd thin space': '(8)', 'Dollars graphics semicolon space': '',
  'Bracket tikzpicture quad': '' },
  // (quantikz circuits)
  'test-quantikz': { 'Bracket quantikz': '', 'Dollars quantikz': '', 'Displaymath quantikz': '',
    'Equation quantikz period': '(1)', 'Equation star quantikz': '', 'Align star quantikz': '', 'Gather star quantikz': '',
    'Bracket resizebox quantikz': '', 'Bracket scalebox quantikz comma': '', 'Bracket wire types quantikz': '',
    'Bracket bundle quantikz': '', 'Bracket tag quantikz': '(Q)', 'Equation label first quantikz': '(2)',
    'Theorem quantikz': '(3)', 'Proof quantikz period': '', 'Align quantikz': '(4)', 'Equation resizebox quantikz': '(5)',
    'Figure display quantikz': '', 'Item quantikz': '' },
  'test-quantikz-hyperref': { 'Bracket quantikz': '', 'Equation tag quantikz': '(P)', 'Theorem quantikz': '(1)' },
  'test-quantikz-old': { 'Old library display': '', 'Old library equation period': '(1)' } };
// the punctuation after the picture, in its own element after it, by document
const picturePuncts = {
  'test-display-picture': { 'Equation tikzcd period': '.', 'Dollars graphics comma': ',', 'Bracket tikzpicture period': '.',
    'Proof tikzpicture period': '.', 'Equation tikzcd thin space': '.', 'Dollars graphics semicolon space': ',',
    'Bracket tikzpicture quad': '.' },
  'test-quantikz': { 'Equation quantikz period': '.', 'Bracket scalebox quantikz comma': ',', 'Proof quantikz period': '.' },
  'test-quantikz-old': { 'Old library equation period': '.' } };
pictureCases.push(...Object.keys(pictureNumbers['test-display-picture']));
// the first element whose opening tag matches the pattern, whose first
// group is the tag's name, up to its closing tag ('' if there is none)
const element = (html, opening) => {
  const found = html.match(opening);
  if (!found) return '';
  const tags = new RegExp(`<(/?)${found[1]}[ >]`, 'g');
  tags.lastIndex = found.index + found[0].length;
  for (let depth = 1, tag; (tag = tags.exec(html));) {
    if (!(depth += tag[1] ? -1 : 1)) return html.slice(found.index, html.indexOf('>', tag.index) + 1);
  }
  return '';
};
// the text of the paragraph that refers to the numbered circuits, whose
// links each go to the anchor right before the display with that number
const quantikzRefs = { 'test-quantikz': 'Reference to the circuit: 1, 2, 3, 4, and 5.',
  'test-quantikz-hyperref': 'Reference to the circuit: (1).', 'test-quantikz-old': 'Reference to the old circuit: 1.' };
// circuits outside display math, each a picture between these two texts
const quantikzPictures = {
  'test-quantikz': [['Figure quantikz.', 'A circuit in a figure'], ['Center quantikz.', 'Ordinary display.']],
  'test-quantikz-old': [['Old library center.', 'Old library figure.'], ['Old library figure.', 'An old circuit in a figure']],
};
const displayPictures = {
  'test-display-picture': { pictures: pictureCases, math: ['Ordinary display', 'Ordinary dollars'] },
  'test-display-picture-two': { pictures: [], math: ['Two diagrams', 'Two rows'] },
  'test-display-picture-hyperref': {
    pictures: ['Dollars tikzpicture', 'Bracket graphics', ['Equation tikzpicture', '(1)'], 'Equation tag tikzpicture',
      'Theorem tikzpicture'],
    math: ['Equation after the tag', 'Ordinary display'] },
  'test-quantikz': { pictures: Object.keys(pictureNumbers['test-quantikz']), math: ['Ordinary display'] },
  'test-quantikz-hyperref': { pictures: Object.keys(pictureNumbers['test-quantikz-hyperref']), math: ['Ordinary display'] },
  'test-quantikz-old': { pictures: Object.keys(pictureNumbers['test-quantikz-old']), math: [] },
  'test-quantikz-red': { pictures: [], math: ['Two circuits'] },
};

// \maketitle's heading, holding these parts in order
const titleHead = (...parts) => new RegExp(`<h1 class='titleHead'>${parts.map(part =>
  `(?:(?!</h1>)[^])*${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('')}(?:(?!</h1>)[^])*</h1>`);

// The title of a page without \maketitle, for the tab and link previews:
// \title's text as \maketitle sets it, without the \thanks.
const titles = {
  'test-title': [/<title>Notes on Groups\s+and Rings<\/title>/,
    /<meta content='Notes on Groups\s+and Rings' property='og:title' \/>/],
  'test-nomaketitle': [/<title>Without a maketitle<\/title>/],
  // (a \par in \title, which tex4ht writes to the .xref: a space for each
  // \par in <title> and og:title, and the heading as \maketitle sets it)
  'test-titlepar': [
    /<title>\s*First\s+Second\s+Third\s+Fourth\s+Fifth\s+Sixth\s+on\s+x2\s*\+\s*1\s+Seventh\s+Eighth\s+Ninth\s*<\/title>/,
    /<meta content='First\s+Second\s+Third\s+Fourth\s+Fifth\s+Sixth\s+on\s+x2\s*\+\s*1\s+Seventh\s+Eighth\s+Ninth' property='og:title' \/>/,
    titleHead('First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'on <mjx-container', 'Seventh', 'Eighth',
      "<span class='thank-mark'>∗</span><br />", 'Ninth'),
  ],
  'test-titlepar-hyperref': [/<title>\s*Heading text\s*<\/title>/, /<meta content='Heading text' property='og:title' \/>/,
    titleHead("<div class='flushright'>", 'Heading text</div>')],
  'test-titlepar-koma': [/<title>\s*Main\s+Title\s*<\/title>/, /<meta content='Main\s+Title' property='og:title' \/>/,
    titleHead('Main', 'Title'), /<\/h1>\s*<div class='subtitle'><span[^>]*>Sub<\/span><\/div>/],
  'test-titlepar-memoir': [/<title>\s*First\s+Second\s+Third\s*<\/title>/,
    /<meta content='First\s+Second\s+Third' property='og:title' \/>/, titleHead('First', 'Second', 'Third')],
  // (without \maketitle, and in the sidebar's link to the top)
  'test-titlepar-toc': [/<title>Main Title<\/title>/, /<meta content='Main Title' property='og:title' \/>/,
    /<a class='tex8web-toc-doctitle' href='#'>Main Title<\/a>/],
  // (scrreprt writes the title twice, from its title page and from
  // \maketitle, so only the start is checked)
  'test-titlepar-scrreprt': [/<title>Main\s+Title\s+Robust[,<]/, /<meta content='Main\s+Title\s+Robust[,']/,
    titleHead('Main', 'Title', 'Robust')],
};

// \today, at the fixed date set in lib/build.mjs
const dates = {
  'test-letter': [/January 1, 2000/],
  'test-declared': [/January 1, 2000/],
};

// Minipages and subfigures, two in a row, each with its share of the PDF's
// text width and its vertical position (t, c, or b)
const minipages = {
  'test': [
    /<div class='tex8web-minipages'><div class='minipage[^']* tex8web-minipage-c' style='--tex8web-share: 0\.45'>(?:(?!tex8web-minipages)[^])*<div class='minipage tex8web-minipage-c' style='--tex8web-share: 0\.45'>/,
    /<div class='tex8web-minipages'><div class='subfigure[^']* tex8web-minipage-[tcb]' style='--tex8web-share: 0\.48'>(?:(?!tex8web-minipages)[^])*<div class='subfigure tex8web-minipage-[tcb]' style='--tex8web-share: 0\.48'>/,
  ],
};

// Index entries, a subentry, a range, and a "see". Each number links back to
// its \index, and is numbered as tex4ht numbers them, not by page.
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
    // (three consecutive numbers as three links, as with makeindex -r)
    /<div class='index-item'>set, <a href='#[^']+'>11<\/a>, <a href='#[^']+'>12<\/a>, <a href='#[^']+'>13<\/a> <\/div>/,
  ],
  // imakeidx: the main index, and an index of names with its title and a
  // style file that puts " : " before the numbers
  'test-imakeidx': [
    /Groups<a id='([^']+)'>[^]*>Index<\/h3>\s*<div class='theindex'>(?:(?!<h3)[^])*<div class='index-item'>group, <a href='#\1'>1<\/a> <\/div>/,
    /Galois<a id='([^']+)'>[^]*>Index of names<\/h3>[^]*<div class='index-item'>Galois : <a href='#\1'>1<\/a> <\/div>/,
    /theorem<a id='([^']+)'>[^]*>Index of names<\/h3>[^]*<div class='index-item'>Euler : <a href='#\1'>2<\/a> <\/div>/,
  ],
  // (the document's index, as sorted in the build folder, with no entry of
  // the stale .ind beside the document)
  'test-staleaux-ind': [/<div class='index-item'>Apple, <a href='#[^']+'>1<\/a> <\/div>/,
    /<div class='index-item'>Pear, <a href='#[^']+'>2<\/a> <\/div>/, /^(?![^]*Old entry)/],
  'test-staleaux-ind-named': [/>Index<\/h3>(?:(?!<h3)[^])*<div class='index-item'>Apple, <a href='#[^']+'>1<\/a> <\/div>/,
    /Index of authors<\/h3>(?:(?!<h3)[^])*<div class='index-item'>Knuth, <a href='#[^']+'>1<\/a> <\/div>/,
    /Index of people<\/h3>(?:(?!<h3)[^])*<div class='index-item'>Euler, <a href='#[^']+'>1<\/a> <\/div>/, /^(?![^]*Old (?:entry|author|person))/, /^(?![^]*Old editor)/],
  'test-staleaux-ind-input': [/<div class='index-item'>Apple, <a href='#[^']+'>1<\/a> <\/div>/, /^(?![^]*Old entry)/],
  // (indexes printed from an \include file, and from a file it reads with
  // \input, sorted in the build folder with the options of their
  // \makeindex: -l puts Iceberg before Ice cream. The index of places is
  // printed in the main file. Each number counts the \index commands of
  // its index, and links to its \index, where the stale .ind's \hyperpage
  // links to #page.1.)
  'test-staleaux-ind-incl': [
    /Index of people<\/h3>(?:(?!<h3)[^])*People named in the text\.(?:(?!<h3)[^])*<div class='index-item'>Euler, <a href='#(?!page\.)[^']+'>1<\/a> <\/div>/,
    />Index<\/h3>(?:(?!<h3)[^])*<div class='index-item'>Apple, <a href='#(?!page\.)[^']+'>1<\/a> <\/div>/,
    /Index of terms<\/h3>(?:(?!<h3)[^])*<div class='index-item'>Fruit, <a href='#(?!page\.)[^']+'>1<\/a> <\/div>/,
    /Index of words<\/h3>(?:(?!<h3)[^])*<div class='index-item'>Iceberg, <a href='#(?!page\.)[^']+'>2<\/a> <\/div>(?:(?!<h3)[^])*<div class='index-item'>Ice cream, <a href='#(?!page\.)[^']+'>1<\/a> <\/div>/,
    /Index of places<\/h3>(?:(?!<h3)[^])*<div class='index-item'>Basel, <a href='#(?!page\.)[^']+'>1<\/a> <\/div>/,
    /^(?![^]*Old (?:entry|person|term|word|place))/],
  // (without hyperref: the stale .ind's \hyperpage is not read, and the
  // file that \includeonly skips adds no entry)
  'test-staleaux-ind-incl-plain': [
    /Index of people<\/h3>(?:(?!<h3)[^])*People named in the text\.(?:(?!<h3)[^])*<div class='index-item'>Euler, <a href='#[^']+'>1<\/a> <\/div>/,
    /Index of people<\/h3>(?:(?!<h3)[^])*<div class='index-item'>Iceberg, <a href='#[^']+'>3<\/a> <\/div>(?:(?!<h3)[^])*<div class='index-item'>Ice cream, <a href='#[^']+'>2<\/a> <\/div>/,
    />Index<\/h3>(?:(?!<h3)[^])*<div class='index-item'>Apple, <a href='#[^']+'>1<\/a> <\/div>/,
    /<div class='index-item'>Basel, <a href='#[^']+'>1<\/a> <\/div>/,
    /^(?![^]*Old (?:entry|person))/, /^(?![^]*Skipped)/],
  // (no .ind beside the document: indexes printed from two \include files)
  'test-staleaux-ind-incl-fresh': [
    /Index of people<\/h3>(?:(?!<h3)[^])*<div class='index-item'>Euler, <a href='#[^']+'>1<\/a> <\/div>/,
    />Index<\/h3>(?:(?!<h3)[^])*<div class='index-item'>Apple, <a href='#[^']+'>1<\/a> <\/div>/],
  'test-staleaux-ind-current': [/<div class='index-item'>Apple, <a href='#[^']+'>1<\/a> <\/div>/],
  'test-staleaux-ind-cls': [/>Apple,<\/span>\s*<a href='#[^']+'><span class='cmr-8'>1<\/span><\/a>/, /^(?![^]*Old entry)/],
  // (the .ind beside the document, read as there is no \makeindex)
  'test-staleaux-ind-shipped': [/<div class='index-item'>Shipped apple, 1 <\/div>/],
  // An \index after a minted listing in the same section links to the place
  // of its \index, right after the listing, as the ids of the last LaTeX
  // run name it. (delta and epsilon follow listings' and fancyvrb's
  // listings, and kappa a listing in an earlier section's heading)
  ...Object.fromEntries(Object.entries({
    'test-idxminted': [['Before the numbered listing', 'omega'], ['After the numbered listing', 'alpha'], ['After the plain listing', 'beta'],
      ['After both listings', 'gamma'], ['After the lstlisting', 'delta'], ['After the Verbatim', 'epsilon'],
      ['After it in italic', 'zeta'], ['in sans-serif', 'eta'], ['in typewriter', 'theta'],
      ['After it in a theorem', 'iota'], ['After it in a heading', 'kappa']],
    'test-idxminted-forms': [['After the input listing', 'one'], ['and after both', 'two'],
      ['After the pythoncode listing', 'three'], ['After the pyfile listing', 'four'], ['In the footnote', 'five'],
      ['After the box', 'six'], ['After the input box', 'seven'], ['After the float', 'eight'],
      ['Inside the box text', 'ten'], ['After the box with text', 'eleven'],
      // (an \index escaped inside a listing, which minted typesets only
      // from the second LaTeX run; a range; an encapsulator; and an entry
      // with two numbers)
      /^(?=[^]*<div class='index-item'>nine, <a href='#([^']+)'>\d+<\/a> <\/div>)(?=[^]*<a id='\1'>)/,
      /^(?=[^]*Start\s+of\s+the\s+range<a id='([^']+)'>)(?=[^]*End\s+of\s+the\s+range<a id='([^']+)'>)(?=[^]*<div class='index-item'>range, <a href='#\1'>\d+<\/a>–<a href='#\2'>\d+<\/a> <\/div>)/,
      /^(?=[^]*a\s+bold\s+one<a id='([^']+)'>)(?=[^]*<div class='index-item'>bold, <a href='#\1'><span class='cmbx-10'>\d+<\/span><\/a> <\/div>)/,
      /^(?=[^]*then\s+twice<a id='([^']+)'>)(?=[^]*Then\s+twice\s+again<a id='([^']+)'>)(?=[^]*<div class='index-item'>twice, <a href='#\1'>\d+<\/a>, <a href='#\2'>\d+<\/a> <\/div>)/],
    'test-idxminted-named': [['After the listing, Knuth', 'Knuth', 'Index of names'], ['wrote of the code', 'listing', 'Index', 'subitem'],
      ['A term', 'term', 'Index of terms']],
    'test-idxminted-nocache': [['Before the listing', 'rho'], ['After the listing', 'pi']],
  // (a named index may be printed before its entries)
  }).map(([name, entries]) => [name, entries.map(e => e instanceof RegExp ? e : (([text, entry, title, level = 'item']) => new RegExp(
    `^(?=[^]*${text.replace(/ /g, '\\s+')}(?:<\\/span>)?<a id='([^']+)'>)(?=[^]*${title ? `>${title}<\\/h3>(?:(?!<h3)[^])*` : ''}<div class='index-${level}'>${entry}, <a href='#\\1'>\\d+<\\/a> <\\/div>)`))(e))])),
};

// The table of contents beside the text, under the document title (a link
// to the top), titled by its heading or by \contentsname in the document's
// language, with chapter numbers in their boxes. A list of figures before
// it stays in the text.
const titled = name => [new RegExp(`<button aria-label='${name}' class='tex8web-control tex8web-contents'[^>]* title='${name}'`),
  new RegExp(`<p class='tex8web-toc-title' id='tex8web-toc-title'>${name}</p>`)];
// The table of contents beside the text: the entries that before matches,
// then titletoc's run-in entries in order, each with its number and a link
// to its heading. The list ends after the last run-in entry.
const runinToc = (entries, before = '') => new RegExp(`<nav [^>]*id='tex8web-toc'[^>]*>(?:(?!</nav>|<div class='tableofcontents'>)[^])*<div class='tableofcontents'>\\s*${before}${entries.map(([level, number, id, title]) =>
  `<span class='${level}Toc'><span class='tocnumber'>${number.replace(/\./g, '\\.')}</span><a href='#${id}'[^>]*>${title}(?:(?!</span>(?:<br />|\\s)*<span class='\\w+Toc'>)[^])*</a></span>`).join('(?:<br />|\\s)*')}(?:<br />|\\s)*</div></nav>`);
// A heading with its number and title, then the text after it.
const runinHead = (h, level, id, number, title, text) => new RegExp(`<${h} class='${level}Head' id='${id}'>(?:(?!</${h}>)[^])*` +
  `<span class='titlemark'>${number.replace(/\./g, '\\.')}</span>(?:(?!</${h}>)[^])*${title}(?:(?!</${h}>)[^])*</${h}>\\s*<p class='noindent'>${text}`);
// A footnote's mark, then its words with whitespace between them, each
// word in any number of tags, up to the end of the footnote.
const noteWords = (mark, words) => new RegExp(`<span class='footnote-mark'><a [^>]*><sup class='textsuperscript'>${mark}</sup></a></span>(?:<[^>]*>)*` +
  words.split(' ').map(word => word.replace(/[.*+?()[\]\\]/g, '\\$&')).join('(?:<[^>]*>)*\\s+(?:<[^>]*>)*') + '(?:<[^>]*>)*</p></aside>');
// The headings and text of test-sectpart-cases.ltx and test-sectpart-koma.ltx,
// in a page that builds: each heading with its title, the italic in the
// section's title and in the text, and the footnote.
const sectpartText = [/<h2 class='chapterHead'[^>]*>(?:(?!<\/h2>)[^])*A chapter<\/h2>/,
  /<h3 class='sectionHead'[^>]*>(?:(?!<\/h3>)[^])*A section with <span class='[^']*'>italic<\/span><\/h3>/,
  /Text in <span class='[^']*'>italic\s*<\/span>\s*with a footnote\./, /The footnote text\./];
const sectpartNumbered = /<h1 class='partHead'[^>]*>(?:(?!<\/h1>)[^])*Part(?:(?!<\/h1>)[^])*[ >]I<(?:(?!<\/h1>)[^])*First part<\/h1>/;
const sectpartStarred = /<h1 class='likepartHead'[^>]*>(?:(?!<\/h1>)[^])*An unnumbered part<\/h1>/;
const sectpartParts = [...sectpartText, sectpartNumbered, sectpartStarred,
  /<h2 class='chapterHead'[^>]*>(?:(?!<\/h2>)[^])*Another chapter<\/h2>\s*(?:<[^>]*>\s*)*Text after the unnumbered part\./];
// The references and citation of test-staleaux and test-staleaux-current,
// with the \pageref's opening tags, and their table of contents: each
// [id, title] in order, and none of the stale files' titles
const staleRefs = pageref => [
  new RegExp(`Section<span class='tex8web-nbsp'> </span><a href='#two'>2<!--[^>]*--></a> is on page<span class='tex8web-nbsp'> </span>${pageref}`),
  /the chapter is section<span class='tex8web-nbsp'> <\/span><a href='#chapter'>3<!--/,
  /Cited<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xbook'>1<\/a>\]<\/span>\./,
  /Text in section<span class='tex8web-nbsp'> <\/span><a href='#one'>1<!--/,
  /Text of the chapter, after section<span class='tex8web-nbsp'> <\/span><a href='#two'>2<!--/,
  /<dt>\s*\[1\]<\/dt><dd><a id='Xbook'><\/a>A\.(?: |<span class='tex8web-nbsp'> <\/span>)Author[,.] <span class='cmti-10'>A Book<\/span>/];
const staleToc = (...entries) => [
  new RegExp(`<div class='tableofcontents'>${entries.map(([id, title], i) =>
    `<span class='sectionToc'><span class='tocnumber'>${i + 1}</span><a href='#${id}' [^>]*>${title}</a></span><br />`).join('\\s*')}\\s*</div>`),
  /^(?![^]*(?:Eins|Zwei|Kapitel))/];
// test-abspath's cases: each case's name, and the text of its file in the
// page, which ends with whether the file was read by an absolute path.
// The cases plain, keep, body, and subfile are guards that the file is
// still read: a file that gives no name, a kept name, and a \ProvidesFile
// in the body, never mark glossary.tex as the document's, so these four
// are built together
const absoluteCases = [
  ['input', 'Input: Text from the file read with input.'],
  ['ext', 'Extension: Text from the file read with its extension.'],
  ['import', 'Import: Text from the file read with import.'],
  ['subimport', 'Subimport: Text from the file read with subimport.'],
  ['ifexists', 'If exists: Text from the file read with InputIfFileExists.'],
  ['path', 'Path: Text from the file found through the input path.'],
  ['dots', 'Dots: Text from the file read by a path with two dots.'],
  ['option', 'Option: Text from the file that gives a date and a version.'],
  ['defs', 'Other name: Text from the file that gives the name of another file.'],
  ['plain', 'Unnamed: Text from the file that gives no name.'],
  ['space', 'Space: Text from the file in a folder with a space.'],
  ['above', 'Above: Text from the file outside the folder of the document.'],
  // (the picture that epsf.4ht makes of \epsfbox)
  ['keep', 'Kept: Text from the file that gives a kept name.', /<img alt='' src='test-abspath0x\.png' \/>/],
  ['body', 'Body: Text from the file read in the body.'],
  ['subfile', 'Subfile: Text from the file read with subfile.'],
];
// An empty \ref after the words given, linked to the id of the section
// heading with the title given, or to an anchor in that heading.
const revfourRef = (words, title) => new RegExp(`^(?=[^]*${words}<span class='tex8web-nbsp'> <\\/span>\\[<a href='#([^']+)'>(?:<!--(?:(?!-->)[^])*-->)?<\\/a>\\])[^]*<h3 class='sectionHead' (?=[^>]*id='\\1'|(?:(?!<\\/h3>)[^])*<a id='\\1'><\\/a>)(?:(?!<\\/h3>)[^])*${title}`);
// Text of tcolorbox titles and references as in the PDF: ~ is a no-break
// space, $ a formula, $> a formula with a double arrow, and [text] a link
// with that text to a \label
const boxText = text => text.replace(/[.()?+*]/g, '\\$&')
  .replace(/\[([^\]]*)\]/g, (_, link) => `<a href='#[^']+'>${link}<!--[^>]*--></a>`)
  .replace(/~/g, () => "<span class='tex8web-nbsp'> </span>")
  .replace(/\$>/g, () => '<mjx-container(?:(?!</mjx-container>)[^])*mjx-c21D2(?:(?!</mjx-container>)[^])*</mjx-container>')
  .replace(/\$/g, () => '<mjx-container(?:(?!</mjx-container>)[^])*</mjx-container>');
const boxTitle = text => new RegExp(`<div class='tcolorbox-title'>(?:<a [^>]*class='tex8web-permalink'[^>]*>#</a>)? <p[^>]*>\\s*${boxText(text)}</p></div>`);
const boxParagraph = text => new RegExp(boxText(text));
// A labelled box's title, then links with these texts to its anchor, in
// that order
const boxRefs = (title, ...links) => new RegExp(`<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#([^']+)'>#</a>\\s*<p[^>]*>\\s*${
  boxText(title)}</p></div>${links.map(link => `[^]*<a href='#\\1'>${boxText(link)}<!--`).join('')}`);
// A revtex page with no title, as in the PDF: an empty <title>, no title
// heading, no "No title" (revtex's default \@title, a warning), and
// nothing after the page's end
const untitled = [
  /<title><\/title>/,
  /^(?![^]*titleHead)/,
  /^(?![^]*No title)/,
  /<\/main><\/body> ?<\/html> ?$/,
];
// test-builddirspace's page, for a document of that name: the table of
// contents, the config's term, a \ref each way with the included part, the
// citation and its entry from bibtex, and the TikZ picture. Without the
// included part, the parts that do not refer to it
const builddirspacePage = (name, included = true) => [
  /<span class='tex8web-term' id='term-space-word'>/,
  /citation<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xspacebook'>1<\/a>\]/,
  /<dd><a id='Xspacebook'><\/a>A\.<span class='tex8web-nbsp'> <\/span>Able\. <span class='cmti-10'>A Book Built in a Folder with a Space<\/span>/,
  new RegExp(`<img alt='' src='${name}0x\\.svg'`),
  ...included ? [
    /<div class='tableofcontents'>(?:(?!<\/div>)[^])*<a href='#spaces'[^>]*>Spaces<\/a>(?:(?!<\/div>)[^])*<a href='#included-part'[^>]*>Included part<\/a>/,
    /included part in section<span class='tex8web-nbsp'> <\/span><a href='#included-part'>2<!--/,
    /<h3 class='sectionHead' id='included-part'>[^]*Text of the included part, after section<span class='tex8web-nbsp'> <\/span><a href='#spaces'>1<!--/,
  ] : [],
];
// hologo's BibTeX logo after the text before: its B, and its IB with no
// formula between them
const hologoBibtex = before => new RegExp(`${before}<span class='HoLogo-BibTeX-sf'><span class='tex8web-nowrap'>(?:<span class='[\\w-]+'>)?B(?:(?!<mjx-container|HoLogo-i|<\\/p>)[^])*<span class='HoLogo-i'>`);

// Text as a reader sees it: the tags that match `between` may come between
// its characters, and each <, >, &, ", or ' may be written as a reference. A
// > must not close a tag. The patterns `before` and `after` place the text
// in its element. A failure names the text.
const references = {
  '<': '&(?:lt|#x0*3[cC]|#0*60);', '>': '(?:(?<!<[^<>]*)>|&(?:gt|#x0*3[eE]|#0*62);)', '&': '&(?:amp|#x0*26|#0*38);',
  '"': '(?:"|&(?:quot|#x0*22|#0*34);)', "'": "(?:'|&(?:apos|#x0*27|#0*39);)",
};
const shown = (text, before = '', after = '', between = '(?:<[^>]*>)*') => {
  const pattern = new RegExp(before + [...text].map(c => references[c] ?? c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join(between) + after);
  return { source: before || after ? `${text} in ${before}...${after}` : text, test: html => pattern.test(html) };
};
const contents = {
  // (\eqref of a row whose matrix has rows reads the row's number)
  'test-envmacro': [/first row is \(<a href='#[^']*'>3<!-- +tex4ht:ref: eq:g /],
  // (the \label on the row of a \bmatrix of the document's names its number)
  'test-envmacro-own': [/Rows \(<a href='#[^']*'>1<!-- +tex4ht:ref: own-a +--><\/a>\) and \(<a href='#[^']*'>2<!-- +tex4ht:ref: own-b /],
  // (\eqref and \ref of rows with \displaybreak read their numbers and
  // link to their rows' anchors; a text tabular's cell with \hidewidth on
  // both sides holds its word)
  'test-displaybreak': [/id='(x1-\d+r3)'[^]*See \(<a href='#\1'>3<!-- +tex4ht:ref: eq:two +--><\/a>\) and <a href='#\1'>3<!-- +tex4ht:ref: eq:two /,
    /id='(x1-\d+r12)'[^]*id='(x1-\d+r14)'[^]*Rows \(<a href='#\1'>12<!-- +tex4ht:ref: eq:arr +--><\/a>\) and \(<a href='#\2'>14<!-- +tex4ht:ref: eq:thm /,
    /id='(x1-\d+r18)'[^]*Row \(<a href='#\1'>18<!-- +tex4ht:ref: eq:n /,
    /<td [^>]*>wide\s*<\/td><\/tr><tr [^>]*><td [^>]*>\s*s<\/td>/],
  'test-builddirspace': builddirspacePage('test-builddirspace'),
  'test-sectpart': sectpartParts, 'test-sectpart-hyperref': sectpartParts, 'test-sectpart-ulem': sectpartParts,
  'test-sectpart-hyperfirst': sectpartParts,
  'test-pathspace': [
    /A <span class='tex8web-term' id='term-config-word'><span class='cmti-10'>config word<\/span><\/span> and a <span class='tex8web-term' id='term-sibling-word'><span class='cmbx-10'>sibling word<\/span><\/span>\./,
  ],
  'test-sectpart-scrbook': sectpartText, 'test-sectpart-scrreprt': sectpartText,
  'test-sectpart-nopart': [/<p[^>]*>\s*Text of a book without headings\./],
  // (the article guard has no chapters: a part, a section, and a starred part)
  'test-sectpart-article': [...sectpartText.slice(1), sectpartNumbered, sectpartStarred],
  // (also test.cfg's \WebUp: the first control, with a # and an & in its URL)
  'test': [/<div class='tex8web-controls'><a aria-label='Up' class='tex8web-control tex8web-up' href='https:\/\/example\.com\/notes\/\?a=1&amp;b=2#top'/],
  'test-russian': titled('Содержание'),
  'test-greek': titled('Περιεχόμενα'),
  // (revtex's headings, numbered in its style, with the text after each)
  'test-revtoc': [
    /<h3 class='sectionHead' id='first-section'>(?:(?!<\/h3>)[^])*<span class='titlemark'>I\.<\/span>(?:(?!<\/h3>)[^])*First section<\/h3>\s*<p class='noindent'>Text of the first section\./,
    /<h4 class='subsectionHead' id='a-subsection'>(?:(?!<\/h4>)[^])*<span class='titlemark'>A\.<\/span>(?:(?!<\/h4>)[^])*A subsection<\/h4>\s*<p class='noindent'>Text of the subsection\./,
    /<h5 class='subsubsectionHead' id='a-subsubsection'>(?:(?!<\/h5>)[^])*<span class='titlemark'>1\.<\/span>(?:(?!<\/h5>)[^])*A subsubsection<\/h5>\s*<p class='noindent'>Text of the subsubsection\./,
    /<span class='paragraphHead' id='a-paragraph'><span class='titlemark'>a\.<\/span>(?:(?!<\/span>)[^])*<\/span>(?:(?!<\/span>)[^])*A paragraph\.<\/span>\s*Text of the paragraph\./,
    /<h3 class='sectionHead' id='second-section'>(?:(?!<\/h3>)[^])*<span class='titlemark'>II\.<\/span>(?:(?!<\/h3>)[^])*Second section<\/h3>\s*<p class='noindent'>Text of the second section\./,
  ],
  // (revtex4-2's and revtex4-1's title, abstract, and headings, as
  // revtex4's: each heading an element with its number, then its text.
  // The class sets some titles in capitals, so their case is not checked.
  // A \ref links to its heading, and the heading's text is not repeated.)
  'test-revhead': [
    /<title>Revhead title(?:\/\/)?<\/title>/,
    /<div class='maketitle'[^>]*>\s*<h1 class='titleHead'[^>]*>(?:(?!<\/h1>)[^])*Revhead title(?:(?!<\/h1>)[^])*<\/h1>(?:(?!<h3)[^])*Text of the abstract\./,
    /<h3 class='sectionHead' id='([^']+)'>(?:(?!<\/h3>)[^])*<span class='titlemark'>I\.<\/span>(?:(?!<\/h3>)[^])*First section<\/h3>\s*<p class='noindent'>Text of the first section, before section<span class='tex8web-nbsp'> <\/span><a href='#([^']+)'>II<[^]*back to section<span class='tex8web-nbsp'> <\/span><a href='#\1'>I</i,
    /<h4 class='subsectionHead' id='([^']+)'>(?:(?!<\/h4>)[^])*<span class='titlemark'>A\.<\/span>(?:(?!<\/h4>)[^])*A subsection<\/h4>\s*<p class='noindent'>Text of the subsection\.[^]*subsection<span class='tex8web-nbsp'> <\/span><a href='#\1'>I ?A</,
    /<h5 class='subsubsectionHead' id='[^']+'>(?:(?!<\/h5>)[^])*<span class='titlemark'>1\.<\/span>(?:(?!<\/h5>)[^])*A subsubsection<\/h5>\s*<p class='noindent'>Text of the subsubsection\./,
    /<span class='paragraphHead' id='[^']+'><span class='titlemark'>a\.<\/span>(?:(?!<\/span>)[^])*<\/span>(?:(?!<\/span>)[^])*A paragraph\.<\/span>\s*Text of the paragraph\./,
    /<main>(?!(?:(?!<\/main>)[^])*A paragraph\.(?:(?!<\/main>)[^])*A paragraph\.)/,
    /section<span class='tex8web-nbsp'> <\/span><a href='#([^']+)'>II<[^]*<h3 class='sectionHead' id='\1'>(?:(?!<\/h3>)[^])*<span class='titlemark'>II\.<\/span>(?:(?!<\/h3>)[^])*Mass (?:(?!<\/h3>)[^])*<mjx-container(?:(?!<\/h3>)[^])*energy(?:(?!<\/h3>)[^])*<\/h3>\s*<p class='noindent'>Text after math/i,
    /<h3 class='likesectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark)[^])*Starred section<\/h3>\s*<p class='noindent'>Text of the starred section\./i,
    /<h4 class='likesubsectionHead' id='[^']+'>(?:(?!<\/h4>|titlemark)[^])*Starred subsection<\/h4>\s*<p class='noindent'>Text of the starred subsection\./,
    /<h5 class='likesubsubsectionHead' id='[^']+'>(?:(?!<\/h5>|titlemark)[^])*Starred subsubsection<\/h5>\s*<p class='noindent'>Text of the starred subsubsection\./,
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>)[^])*<span class='titlemark'>III\.<\/span>(?:(?!<\/h3>)[^])*Long title of a section<\/h3>\s*<p class='noindent'>Text of the long section\./i,
    /<h3 class='likesectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark)[^])*Acknowledgments<\/h3>\s*<p class='noindent'>Text of the acknowledgments\./i,
    // (the appendix's label is not checked)
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>)[^])*Numerical details<\/h3>\s*<p class='noindent'>Text of the appendix\./i,
    /<h3 class='likesectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark)[^])*Unnumbered appendix<\/h3>\s*<p class='noindent'>Text of the unnumbered appendix\./i,
    /<\/main><\/body> ?<\/html> ?$/,
  ],
  'test-revhead-41': [
    /<div class='maketitle'[^>]*>\s*<h1 class='titleHead'[^>]*>(?:(?!<\/h1>)[^])*Revhead old title(?:(?!<\/h1>)[^])*<\/h1>(?:(?!<h3)[^])*Text of the old abstract\./,
    // (the author's notes without hyperref: a \footnote, and \email with
    // \thanks in one note, as in the PDF)
    /Someone(?:<[^>]*>)*<a href='#([^']+)'><sup[^>]*>(?:<[^>]*>)*a<(?:(?!<\/div>)[^])*<\/div>[^]*<aside class='footnotetext'(?:(?!<\/aside>)[^])*<a id='\1'><\/a>(?:<[^>]*>)*A\s+note\s+on\s+the\s+old\s+author\./,
    /Someone(?:(?!<\/div>)[^])*<a href='#([^']+)'><sup[^>]*>(?:<[^>]*>)*†<(?:(?!<\/div>)[^])*<\/div>[^]*<aside class='footnotetext'(?:(?!<\/aside>)[^])*<a id='\1'><\/a><sup[^>]*>(?:<[^>]*>)*†<(?:(?!<\/aside>)[^])*old@example\.com;\s+A\s+thanks\s+of\s+the\s+old\s+author\./,
    /<h3 class='sectionHead' id='([^']+)'>(?:(?!<\/h3>)[^])*<span class='titlemark'>I\.<\/span>(?:(?!<\/h3>)[^])*First section<\/h3>\s*<p class='noindent'>Text of the first section\.[^]*after section<span class='tex8web-nbsp'> <\/span><a href='#\1'>I</i,
    /<h4 class='subsectionHead' id='[^']+'>(?:(?!<\/h4>)[^])*<span class='titlemark'>A\.<\/span>(?:(?!<\/h4>)[^])*A subsection<\/h4>\s*<p class='noindent'>Text of the subsection\./,
    /<h5 class='subsubsectionHead' id='[^']+'>(?:(?!<\/h5>)[^])*<span class='titlemark'>1\.<\/span>(?:(?!<\/h5>)[^])*A subsubsection<\/h5>\s*<p class='noindent'>Text of the subsubsection\./,
    /<span class='paragraphHead' id='[^']+'><span class='titlemark'>a\.<\/span>(?:(?!<\/span>)[^])*<\/span>(?:(?!<\/span>)[^])*A paragraph\.<\/span>\s*Text of the paragraph\./,
    /<main>(?!(?:(?!<\/main>)[^])*A paragraph\.(?:(?!<\/main>)[^])*A paragraph\.)/,
    /<h3 class='likesectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark)[^])*Starred section<\/h3>\s*<p class='noindent'>Text of the starred section/i,
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>)[^])*<span class='titlemark'>II\.<\/span>(?:(?!<\/h3>)[^])*Long title of a section<\/h3>\s*<p class='noindent'>Text of the long section\./i,
    /<h3 class='likesectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark)[^])*Acknowledgments<\/h3>\s*<p class='noindent'>Text of the acknowledgments\./i,
    /<\/main><\/body> ?<\/html> ?$/,
    // (aps4-1's symbols end after the eighth: the ninth and each after it)
    ...['Nine', 'Ten', 'Eleven'].map(author => new RegExp(`Author\\s+${author}</span>,?(?:<span class='cite'>)?<a href='#([^']+)'><sup[^>]*>(?:<[^>]*>)*§§<(?:(?!</div>)[^])*</div>[^]*<aside class='footnotetext'(?:(?!</aside>)[^])*<a id='\\1'></a><sup[^>]*>(?:<[^>]*>)*§§<(?:(?!</aside>)[^])*${author.toLowerCase()}@example\\.com`)),
  ],
  // (prl numbers no section, and its acknowledgments have no heading, as
  // in the PDF. Nothing after the page's end.)
  'test-revhead-reprint': [
    /<div class='maketitle'[^>]*>\s*<h1 class='titleHead'[^>]*>(?:(?!<\/h1>)[^])*Revhead letter(?:(?!<\/h1>)[^])*<\/h1>(?:(?!<h3)[^])*Text of the letter.s abstract\./,
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark)[^])*First section<\/h3>\s*<p class='noindent'>Text of the first section\./i,
    /<h4 class='subsectionHead' id='[^']+'>(?:(?!<\/h4>|titlemark)[^])*A subsection<\/h4>\s*<p class='noindent'>Text of the subsection\./i,
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark)[^])*Second section<\/h3>\s*<p class='noindent'>Text of the second section\./i,
    // (prl's single appendix from \appendix* has no label, as in the PDF)
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark|Appendix:)[^])*Only appendix<\/h3>\s*<p class='noindent'>Text of the only appendix\./,
    // (guards: the text is kept, and nothing follows the page's end)
    /Text of the acknowledgments\./,
    /<\/main><\/body> ?<\/html> ?$/,
    // (prl lists the title's notes in the references)
    /Someone<\/span>(?:<\/span><span class='cite'>)?<a href='#([^']+)'><sup[^>]*>(?:<[^>]*>)*\*<[^]*<div class='thebibliography'>(?:(?!<\/div>)[^])*<sup[^>]*><a id='\1'><\/a>(?:<[^>]*>)*\*<(?:(?!<\/p>)[^])*someone@example\.com/,
  ],
  // (revtex4-2's floats and wide text, which revtex4.4ht also
  // configures, with a \ref to a table and a figure)
  'test-revhead-floats': [
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>)[^])*Floats<\/h3>/i,
    /class='caption'(?:(?!<\/(?:figcaption|div)>)[^])*TABLE(?:<[^>]*>|\s)*I:(?:(?!<\/(?:figcaption|div)>)[^])*A small table\./,
    /<table[^>]*>(?:(?!<\/table>)[^])*>\s*a\s*<(?:(?!<\/table>)[^])*>\s*b\s*<(?:(?!<\/table>)[^])*>\s*c\s*<(?:(?!<\/table>)[^])*>\s*d\s*<(?:(?!<\/table>)[^])*<\/table>/,
    /class='caption'(?:(?!<\/(?:figcaption|div)>)[^])*TABLE(?:<[^>]*>|\s)*II:(?:(?!<\/(?:figcaption|div)>)[^])*A wide table\./,
    /class='caption'(?:(?!<\/(?:figcaption|div)>)[^])*FIG\.(?:<[^>]*>|\s)*1:(?:(?!<\/(?:figcaption|div)>)[^])*A figure\./,
    /id='([^']+)'>(?:(?!<\/p>)[^])*<\/p><hr class='float' \/><div class='float'>\s*<div class='caption'(?:(?!<\/div>)[^])*A small table\.[^]*Text of the wide part, and table<span class='tex8web-nbsp'> <\/span><a href='#\1'>I</,
    /<div class='figure' id='([^']+)'>(?:(?!<\/div>)[^])*A figure\.[^]*Text after figure<span class='tex8web-nbsp'> <\/span><a href='#\1'>1</,
    /class='caption'(?:(?!<\/(?:figcaption|div)>)[^])*FIG\.(?:<[^>]*>|\s)*2:(?:(?!<\/(?:figcaption|div)>)[^])*A wide figure\./,
    /<\/main><\/body> ?<\/html> ?$/,
  ],
  // (revtex4-2 without hyperref: a \label in a heading's title, headings
  // with no text between them, two \paragraph headings, and an appendix.
  // The appendix's label is not checked.)
  'test-revhead-plain': [
    /<h3 class='sectionHead' id='([^']+)'>(?:(?!<\/h3>)[^])*<span class='titlemark'>I\.<\/span>(?:(?!<\/h3>)[^])*Introduction<\/h3>\s*<p class='noindent'>Text of the introduction[^]*after section<span class='tex8web-nbsp'> <\/span><a href='#\1'>I</i,
    /before section<span class='tex8web-nbsp'> <\/span><a href='#([^']+)'>II<[^]*<h3 class='sectionHead' id='\1'>(?:(?!<\/h3>)[^])*<span class='titlemark'>II\.<\/span>(?:(?!<\/h3>)[^])*Nested<\/h3>\s*<h4 class='subsectionHead' id='[^']+'>(?:(?!<\/h4>)[^])*<span class='titlemark'>A\.<\/span>(?:(?!<\/h4>)[^])*Nested subsection<\/h4>\s*<h5 class='subsubsectionHead' id='[^']+'>(?:(?!<\/h5>)[^])*<span class='titlemark'>1\.<\/span>(?:(?!<\/h5>)[^])*Nested subsubsection<\/h5>\s*<p class='noindent'>Text after the nested headings\./i,
    /<span class='paragraphHead' id='[^']+'><span class='titlemark'>a\.<\/span>(?:(?!<\/span>)[^])*<\/span>(?:(?!<\/span>)[^])*One\.<\/span>\s*Text of the first paragraph\.\s*<\/p>\s*<p class='noindent'><span class='paragraphHead' id='[^']+'><span class='titlemark'>b\.<\/span>(?:(?!<\/span>)[^])*<\/span>(?:(?!<\/span>)[^])*Two\.<\/span>\s*Text of the second paragraph,/,
    /<main>(?!(?:(?!<\/main>)[^])*(?:One\.|Text of the first paragraph)(?:(?!<\/main>)[^])*Two\.(?:(?!<\/main>)[^])*(?:One\.|Text of the first paragraph))/,
    /appendix<span class='tex8web-nbsp'> <\/span><a href='#([^']+)'>A<[^]*<h3 class='sectionHead' id='\1'>(?:(?!<\/h3>)[^])*Details<\/h3>\s*<p class='noindent'>Text of the appendix\.\s*<\/p>\s*<h4 class='subsectionHead' id='[^']+'>(?:(?!<\/h4>)[^])*Part<\/h4>\s*<p class='noindent'>Text of the appendix.s part\./i,
    /<\/main><\/body> ?<\/html> ?$/,
  ],
  // (a revtex4-2 preprint for an aip journal, and sections after
  // \appendix*)
  'test-revhead-preprint': [
    /<div class='maketitle'[^>]*>\s*<h1 class='titleHead'[^>]*>(?:(?!<\/h1>)[^])*Revhead preprint(?:(?!<\/h1>)[^])*<\/h1>/,
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>)[^])*<span class='titlemark'>I\.<\/span>(?:(?!<\/h3>)[^])*First section<\/h3>\s*<p class='noindent'>Text of the first section\./i,
    /<h4 class='subsectionHead' id='[^']+'>(?:(?!<\/h4>)[^])*<span class='titlemark'>A\.<\/span>(?:(?!<\/h4>)[^])*A subsection<\/h4>\s*<p class='noindent'>Text of the subsection\./,
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark)[^])*<span class='titlemark'>Appendix:<\/span>(?:(?!<\/h3>|titlemark)[^])*Only appendix<\/h3>\s*<p class='noindent'>Text of the only appendix\./i,
    // (a section with no title after \appendix*: "Appendix" with no colon,
    // as in the PDF)
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark)[^])*<span class='titlemark'>Appendix<\/span>(?:\s|<[^>]*>)*<\/h3>\s*<p class='noindent'>Text of the bare appendix\./i,
    // (no other "Appendix" before either heading: aip writes one with
    // \@sectioncntformat)
    ...['Text of the subsection\\.', 'Text of the only appendix\\.'].map(text =>
      new RegExp(`${text}(?:(?!Appendix|<h3)[^])*<h3 class='sectionHead'`)),
    // (aip's keywords above its PACS numbers, as in the PDF)
    /<div class='keywords'>(?:(?!<\/div>)[^])*first keyword(?:(?!<\/div>)[^])*<\/div>(?:(?!<h3)[^])*<div class='pacs'>(?:(?!<\/div>)[^])*01\.01/,
    /<\/main><\/body> ?<\/html> ?$/,
  ],
  // (revtex4-2's notes in the title block: an author's \footnote, \email,
  // and \thanks, each marked where it stands and linked to its text, as in
  // the PDF, which leaves out a \thanks in the title. The marks are text,
  // not math. The body's footnotes are numbered from 1.)
  'test-revhead-front': [
    /<main>\s*<div class='maketitle'[^>]*>\s*<h1 class='titleHead'[^>]*>(?:(?!<\/h1>)[^])*Revhead front(?:(?!<\/h1>|<sup|thank)[^])*<\/h1>/,
    /^(?![^]*(?:thank-mark|ifcase|A note on the title))/,
    /First Author<a href='#([^']+)'><sup[^>]*>(?:<[^>]*>)*a<(?:(?!<\/div>)[^])*<\/div>[^]*<aside class='footnotetext'(?:(?!<\/aside>)[^])*<a id='\1'><\/a>(?:<[^>]*>)*A\s+note\s+on\s+the\s+author\./,
    /First Author(?:(?!<\/div>)[^])*<a href='#([^']+)'><sup[^>]*>(?:<[^>]*>)*†<(?:(?!<\/div>)[^])*<\/div>[^]*<aside class='footnotetext'(?:(?!<\/aside>)[^])*<a id='\1'><\/a><sup[^>]*>(?:<[^>]*>)*†<(?:(?!<\/aside>)[^])*first@example\.com/,
    /Second\s+Author<\/span><a href='#([^']+)'><sup[^>]*>(?:<[^>]*>)*‡<(?:(?!<\/div>)[^])*<\/div>[^]*<aside class='footnotetext'(?:(?!<\/aside>)[^])*<a id='\1'><\/a><sup[^>]*>(?:<[^>]*>)*‡<(?:(?!<\/aside>)[^])*A\s+thanks\s+of\s+the\s+second\s+author\./,
    /Text of the first section\.\[<a href='#[^']+'>1<\/a>\] More text\.\[<a href='#[^']+'>2<\/a>\]/,
    /<\/main><\/body> ?<\/html> ?$/,
    ...[['Nine', 'nine', '§§'], ['Ten', 'ten', '¶¶'], ['Eleven', 'eleven', '\\*\\*\\*']].map(([author, user, mark]) =>
      new RegExp(`Author\\s+${author}</span>,?<a href='#([^']+)'><sup[^>]*>(?:<[^>]*>)*${mark}<(?:(?!</div>)[^])*</div>[^]*<aside class='footnotetext'(?:(?!</aside>)[^])*<a id='\\1'></a><sup[^>]*>(?:<[^>]*>)*${mark}<(?:(?!</aside>)[^])*${user}@example\\.com`)),
    // (aps's rule in place of the references' heading, as a rule of
    // its width, centered, and not as a line of underscores)
    /<div class='center'>\s*<p[^>]*>(?:<a id='[^']*'><\/a>)*<span class='tex8web-rule' style='--tex8web-rule-width: 0\.\d+;[^]*<div class='thebibliography'>/,
    /^(?![^]*_{8})/,
  ],
  // (revtex4-2's aapm option marks the title's notes a) and b), as in
  // the PDF, and lists them in the references)
  'test-revhead-aapm': [
    ...[['First', 'first', 'a'], ['Second', 'second', 'b']].map(([author, user, mark]) =>
      new RegExp(`${author}\\s+Author</span></span><span class='cite'><a href='#([^']+)'><sup[^>]*>(?:<[^>]*>)*${mark}\\)<[^]*<div class='thebibliography'>(?:(?!</div>)[^])*<sup[^>]*><a id='\\1'></a>(?:<[^>]*>)*${mark}\\)<(?:(?!</p>)[^])*Electronic mail: ${user}@example\\.com`)),
    /^(?![^]*<sup class='textsuperscript'>(?:<[^>]*>)*[*†‡])/,
    /<\/main><\/body> ?<\/html> ?$/,
  ],
  // (revtex4-2's keywords and PACS numbers under the abstract, each shown
  // only when the paper gives it, as in the PDF)
  'test-revhead-keys': [
    /Text of the abstract\.(?:(?!<h3|Text of the body)[^])*<div class='keywords'>(?:(?!<\/div>)[^])*Keywords:(?:(?!<\/div>)[^])*first keyword, second keyword/,
    /^(?![^]*(?:PACS|class='pacs'))/,
  ],
  'test-revhead-nokeys': [
    /Text of the abstract\.[^]*Text of the body\./,
    /^(?![^]*(?:PACS|Keywords|class='pacs'|class='keywords'))/,
  ],
  // (sections after revtex's \appendix*, as in the PDF: each heading
  // starts with "Appendix:" and has no number, or is "Appendix" alone
  // with no title, and no other "Appendix" comes before it. A \ref to
  // such a section is empty and links to its heading, its equations are
  // numbered A.1, and a starred section after it has no label.)
  'test-revfourapp': [
    /<h3 class='sectionHead' id='[^']+'>(?:<[^>]*>|#)*<span class='titlemark'>Appendix:<\/span>(?:<[^>]*>|\s)*Mass (?:(?!<\/h3>)[^])*<mjx-container(?:(?!<\/h3>)[^])*energy(?:(?!<\/h3>)[^])*<\/h3>/,
    // (no empty paragraph between the heading and its text: the \label's
    // anchor is in neither)
    /<\/h3>\s*<p class='noindent'>Text of the appendix with math\./,
    // (a subsection's \ref is its number alone, as in the PDF)
    /<h4 class='subsectionHead' id='([^']+)'>(?:<[^>]*>|#)*<span class='titlemark'>1\.<\/span>(?:<[^>]*>|\s)*A subsection<\/h4>\s*<p class='noindent'>Text of the appendix.s subsection, see subsection<span class='tex8web-nbsp'> <\/span>\[<a href='#\1'>1(?:<!--(?:(?!-->)[^])*-->)?<\/a>\]/,
    /<h3 class='sectionHead' id='[^']+'>(?:<[^>]*>|#)*<span class='titlemark'>Appendix:<\/span>(?:<[^>]*>|\s)*Long title of an appendix<\/h3>\s*<p class='noindent'>Text of the long appendix\./,
    /<h3 class='sectionHead' id='[^']+'>(?:<[^>]*>|#)*<span class='titlemark'>Appendix<\/span>(?:\s|<[^>]*>)*<\/h3>\s*<p class='noindent'>Text of the bare appendix\./,
    /<h3 class='sectionHead' id='[^']+'>(?:<[^>]*>|#)*<span class='titlemark'>Appendix:<\/span>(?:<[^>]*>|\s)*Details(?:<a id='[^']+'><\/a>)?<\/h3>\s*<p class='noindent'>Text of the details,/,
    /<h3 class='likesectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark|Appendix)[^])*Starred tail<\/h3>\s*<p class='noindent'>Text of the starred tail\./,
    ...['Text of the first section,', 'see subsection', 'Text of the long appendix\\.', 'Text of the bare appendix\\.'].map(text =>
      new RegExp(`${text}(?:(?!Appendix|<h3)[^])*<h3 class='sectionHead'`)),
    // (an empty \ref, before and after the heading, and to a \label in
    // the title, each linked to the heading or to an anchor in it)
    revfourRef('before appendix', 'Mass '), revfourRef('back to appendix', 'Mass '), revfourRef('see details', 'Details'),
    /<a class='tex8web-eq-anchor' id='([^']+)'><\/a><span class='mathjax-env mathjax-equation'><mjx-container aria-label='E equals m c squared Label open paren cap A \.1 close paren'[^]*Text after Eq\.<span class='tex8web-nbsp'> <\/span>\(<a href='#\1'>A\.1</,
    /and Eq\.<span class='tex8web-nbsp'> <\/span>\(<a href='#([^']+)'>A\.1<[^]*<a class='tex8web-eq-anchor' id='\1'><\/a><span class='mathjax-env mathjax-equation'><mjx-container aria-label='E equals m c squared Label open paren cap A \.1 close paren'/,
    /^(?![^]*unskip)/,
    /<\/main><\/body> ?<\/html> ?$/,
  ],
  'test-revfourapp-hyperref': [
    /<h3 class='sectionHead' id='[^']+'>(?:<[^>]*>|#)*<span class='titlemark'>Appendix:<\/span>(?:<[^>]*>|\s)*Linked appendix<\/h3>/,
    /Linked appendix<\/h3>\s*<p class='noindent'>Text of the linked appendix\./,
    /<h3 class='sectionHead' id='[^']+'>(?:<[^>]*>|#)*<span class='titlemark'>Appendix<\/span>(?:\s|<[^>]*>)*<\/h3>\s*<p class='noindent'>Text of the bare appendix\./,
    ...['Text of the first section,', 'Text after Eq\\.'].map(text =>
      new RegExp(`${text}(?:(?!Appendix|<h3)[^])*<h3 class='sectionHead'`)),
    revfourRef('before appendix', 'Linked appendix'),
    /<a class='tex8web-eq-anchor' id='([^']+)'><\/a><span class='mathjax-env mathjax-equation'><mjx-container aria-label='a equals b Label open paren cap A \.1 close paren'[^]*Text after Eq\.<span class='tex8web-nbsp'> <\/span>\(<a href='#\1'>A\.1</,
    /^(?![^]*unskip)/,
    /<\/main><\/body> ?<\/html> ?$/,
  ],
  // (prl numbers no section: the appendix's heading has no label)
  'test-revfourapp-prl': [
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark)[^])*First section<\/h3>\s*<p class='noindent'>Text of the first section\.\s*<\/p>\s*<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>|titlemark|Appendix)[^])*Methods<\/h3>\s*<p class='noindent'>Text of the methods\./,
    /^(?![^]*Appendix)/,
    /^(?![^]*unskip)/,
    /<\/main><\/body> ?<\/html> ?$/,
  ],
  // (rmp's \appendix* acts as \appendix, as in the PDF: the build
  // finishes)
  'test-revfourapp-rmp': [
    /<h3 class='sectionHead' id='[^']+'>(?:<[^>]*>|#)*<span class='titlemark'>A\.<\/span>(?:<[^>]*>|\s)*Details<\/h3>\s*<p class='noindent'>Text of the details\./,
    /<h3 class='likesectionHead' id='[^']+'>(?:(?!<\/h3>)[^])*Starred tail<\/h3>\s*<p class='noindent'>Text of the starred tail\./,
    /^(?![^]*unskip)/,
    /<\/main><\/body> ?<\/html> ?$/,
  ],
  'test-revfourapp-42': [
    /<h3 class='sectionHead' id='[^']+'>(?:<[^>]*>|#)*<span class='titlemark'>Appendix:<\/span>(?:<[^>]*>|\s)*New appendix<\/h3>/,
    /New appendix<\/h3>\s*<p class='noindent'>Text of the new appendix\./,
    /Text of the first section,(?:(?!Appendix|<h3)[^])*<h3 class='sectionHead'/,
    revfourRef('before appendix', 'New appendix'),
    /<a class='tex8web-eq-anchor' id='([^']+)'><\/a><span class='mathjax-env mathjax-equation'><mjx-container aria-label='x equals y Label open paren cap A \.1 close paren'[^]*Text after Eq\.<span class='tex8web-nbsp'> <\/span>\(<a href='#\1'>A\.1</,
    /^(?![^]*unskip)/,
    /<\/main><\/body> ?<\/html> ?$/,
  ],
  // (revtex documents with no title: with no \maketitle, with \maketitle
  // and no \title, with \title in the preamble, which revtex clears at
  // \begin{document}, and with an empty \title)
  'test-revnotitle': [...untitled,
    /<main>\s*<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>)[^])*First section<\/h3>\s*<p class='noindent'>Text of the untitled article, with <span[^>]*>emphasis<\/span>\./i,
  ],
  'test-revnotitle-41': [...untitled,
    /<div class='maketitle'[^>]*>(?:\s*<a [^>]*><\/a>)*\s*<div class='author'>(?:(?!<\/div>)[^])*Someone\s+Untitled(?:(?!<\/div>)[^])*<\/div>\s*<div class='affil'>(?:(?!<\/div>)[^])*An\s+Old\s+Institute[^]*Text of the untitled abstract\.[^]*First section<\/h3>\s*<p class='noindent'>Text of the untitled article for aps\./i,
  ],
  'test-revnotitle-42': [...untitled,
    /<h3 class='sectionHead' id='([^']+)'>(?:(?!<\/h3>)[^])*Linked section<\/h3>\s*<p class='noindent'>Text of the untitled reprint, before section<span class='tex8web-nbsp'> <\/span><a href='#\1'>I</i,
  ],
  'test-revnotitle-preamble': [...untitled,
    /<main>\s*<p class='noindent'>Text of the letter with a title in the preamble\./,
    /^(?![^]*Preamble title)/,
  ],
  'test-revnotitle-maketitle': [...untitled,
    /<div class='maketitle'[^>]*>(?:\s*<a [^>]*><\/a>)*\s*<div class='author'>(?:(?!<\/div>)[^])*Someone\s+Nameless(?:(?!<\/div>)[^])*<\/div>\s*<div class='affil'>(?:(?!<\/div>)[^])*A\s+New\s+Institute/,
    /Someone\s+Nameless<\/span>(?:<span class='cite'>)?<a href='#([^']+)'><sup[^>]*>(?:<[^>]*>)*\*<[^]*<a id='\1'><\/a><sup[^>]*>(?:<[^>]*>)*\*<(?:(?!<\/aside>)[^])*nameless@example\.com/,
    /First section<\/h3>\s*<p class='noindent'>Text of the article with a title block and no title\./i,
  ],
  'test-revnotitle-old': [...untitled,
    /<div class='maketitle'[^>]*>(?:\s*<a [^>]*><\/a>)*\s*<div class='author'>(?:(?!<\/div>)[^])*Someone\s+Older(?:(?!<\/div>)[^])*<\/div>\s*<div class='affil'>(?:(?!<\/div>)[^])*An\s+Older\s+Institute/,
    /Text of the older article with no title\./,
  ],
  'test-revnotitle-hyperref': [...untitled,
    /<div class='maketitle'[^>]*>(?:\s*<a [^>]*><\/a>)*\s*<div class='author'>(?:(?!<\/div>)[^])*Someone\s+Linked(?:(?!<\/div>)[^])*<\/div>\s*<div class='affil'>(?:(?!<\/div>)[^])*A\s+Linked\s+Institute/,
    /Text of the linked article with no title\./,
  ],
  'test-revnotitle-pdfusetitle': [...untitled,
    /<div class='maketitle'[^>]*>(?:\s*<a [^>]*><\/a>)*\s*<div class='author'>(?:(?!<\/div>)[^])*Someone\s+Described(?:(?!<\/div>)[^])*<\/div>\s*<div class='affil'>(?:(?!<\/div>)[^])*A\s+Described\s+Institute/,
    /Text of the described article with no title\./,
  ],
  'test-revnotitle-41end': [...untitled,
    /<main>\s*<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>)[^])*Only section<\/h3>\s*<p class='noindent'>Text of the untitled revtex4-1 article\./i,
  ],
  'test-revnotitle-empty': [...untitled,
    /<div class='maketitle'[^>]*>(?:\s*<a [^>]*><\/a>)*\s*<div class='author'>(?:(?!<\/div>)[^])*Someone\s+Empty(?:(?!<\/div>)[^])*<\/div>\s*<div class='affil'>(?:(?!<\/div>)[^])*An\s+Empty\s+Institute/,
    /Text of the article with an empty title\./,
  ],
  'test-report': [
    /<nav [^>]*id='tex8web-toc'[^>]*><a class='tex8web-toc-doctitle' href='#'>[^<]+<\/a><p [^>]*>Contents<\/p><input [^>]*><div class='tableofcontents'>(?:(?!<\/nav>)[^])*<span class='chapterToc'><span class='tocnumber'>1<\/span>/,
    /<\/nav>(?:(?!<\/nav>)[^])*<div class='tableofcontents'>\s*<span class='lofToc'>/,
  ],
  // (an entry that \addcontentsline adds beside an unnumbered heading links
  // to that heading, under the id named from its title)
  'test-tocstar': ['Before', 'After', 'Blank', 'Overview'].map(title =>
    new RegExp(`<a href='#${title.toLowerCase()}'>${title}</a>[^]*<h[34] class='like\\w*Head' id='${title.toLowerCase()}'>`)),
  // (headings with titlesec's rules in their formats, each with its number
  // and title, and the text after \titlerule, \titlerule*, and \titleline
  // as paragraphs; in report, a subsubsection whose label is in \titleline,
  // with its number and title in one heading and no paragraph inside. The
  // rules themselves are not checked.)
  'test-titlerule': [/<h1 class='partHead' id='start'>.*Part.*I.*Start<\/h1>/,
    /<h3 class='sectionHead' id='alpha'>.*<span class='titlemark'>1<\/span>.*Alpha<\/h3>/,
    /<h4 class='subsectionHead' id='beta'>.*<span class='titlemark'>1\.1<\/span>.*Beta<\/h4>/,
    /<h5 class='subsubsectionHead' id='gamma'>.*<span class='titlemark'>1\.1\.1<\/span>.*Gamma<\/h5>/,
    /<span class='paragraphHead' id='delta'><a id='[^']+'><\/a>Delta<\/span>/,
    /<span class='subparagraphHead' id='epsilon'><a id='[^']+'><\/a>Epsilon<\/span> Text after the subparagraph\./,
    /Text before the rules\.[^]*Middle[^]*Text after the rules\./],
  'test-titlerule-report': [/<h1 class='partHead' id='beginnings'>.*Part.*I.*Beginnings<\/h1>/,
    /<h2 class='chapterHead' id='alpha'>.*Chapter.*1.*Alpha<\/h2>/,
    /<h3 class='sectionHead' id='beta'>.*<span class='titlemark'>1\.1<\/span>.*Beta<\/h3>/,
    /<h4 class='subsectionHead' id='gamma'>.*<span class='titlemark'>1\.1\.1<\/span>.*Gamma<\/h4>/,
    /<h5 class='subsubsectionHead' id='delta'>(?:[^<]|<(?!\/h5>|p[ >]))*1\.1\.1\.1(?:[^<]|<(?!\/h5>|p[ >]))*Delta<\/h5>/],
  // (titletoc's run-in entries, \titlecontents*: every entry in the table of
  // contents and every heading with its text. In report, a run-in
  // subsection with \emph and math in its title, and no subsubsection,
  // below report's tocdepth; in an article, run-in sections and
  // subsections around a \dottedcontents subsubsection; in a book, run-in
  // chapters and sections, and a chapter with titletoc's partial table of
  // contents, which is not checked; in scrreprt, run-in subsections, and a
  // run-in list of figures in the text, with a link to each figure)
  'test-runintoc': [runinToc([['chapter', '1', 'opening-chapter', 'Opening chapter'],
    ['section', '1.1', 'first-section', 'First section'], ['subsection', '1.1.1', 'first-runin', 'First run-in'],
    ['subsection', '1.1.2', 'second-runin-with-italic-and-x2', "Second run-in with\\s<span class='cmti-10'>italic </span>and <mjx-container aria-label='x squared'"],
    ['section', '1.2', 'second-section', 'Second section'], ['chapter', '2', 'closing-chapter', 'Closing chapter'],
    ['section', '2.1', 'last-section', 'Last section']]),
    runinHead('h4', 'subsection', 'first-runin', '1.1.1', 'First run-in', 'Text of the first run-in\\.'),
    /<h5 class='subsubsectionHead' id='deep-one'>(?:(?!<\/h5>|titlemark)[^])*Deep one<\/h5>\s*<p class='noindent'>Text of deep one\./,
    runinHead('h4', 'subsection', 'second-runin-with-italic-and-x2', '1.1.2', 'Second run-in', 'Text of the second run-in\\.'),
    runinHead('h3', 'section', 'last-section', '2.1', 'Last section', 'Text of the last section\\.')],
  'test-runintoc-article': [runinToc([['section', '1', 'alpha', 'Alpha'], ['subsection', '1.1', 'alpha-one', 'Alpha one'],
    ['subsubsection', '1.1.1', 'alpha-deep', 'Alpha deep'], ['subsection', '1.2', 'alpha-two', 'Alpha two'],
    ['section', '2', 'beta-with-italic-and-y1', "Beta with <span class='cmti-10'>italic </span>and <mjx-container aria-label='y sub 1'"]]),
    runinHead('h3', 'section', 'alpha', '1', 'Alpha', 'Text of alpha\\.'),
    runinHead('h5', 'subsubsection', 'alpha-deep', '1.1.1', 'Alpha deep', 'Text of alpha deep\\.'),
    runinHead('h4', 'subsection', 'alpha-two', '1.2', 'Alpha two', 'Text of alpha two\\.'),
    runinHead('h3', 'section', 'beta-with-italic-and-y1', '2', 'Beta with', 'Text of beta\\.')],
  'test-runintoc-book': [runinToc([['chapter', '1', 'first-chapter', 'First chapter'], ['section', '1.1', 'gamma', 'Gamma'],
    ['subsection', '1.1.1', 'gamma-one', 'Gamma one'], ['section', '1.2', 'delta', 'Delta'],
    ['chapter', '2', 'second-chapter', 'Second chapter'], ['section', '2.1', 'epsilon', 'Epsilon']]),
    runinHead('h2', 'chapter', 'first-chapter', 'Chapter<span class=\'tex8web-nbsp\'> </span>1', 'First chapter', 'Text of the first chapter\\.'),
    runinHead('h4', 'subsection', 'gamma-one', '1.1.1', 'Gamma one', 'Text of gamma one\\.'),
    runinHead('h3', 'section', 'epsilon', '2.1', 'Epsilon', 'Text of epsilon\\.')],
  'test-runintoc-skip': [runinToc([['section', '1', 'iota', 'Iota'], ['subsection', '1.1', 'iota-one', 'Iota one'],
    ['section', '2', 'kappa', 'Kappa']]),
    runinHead('h3', 'section', 'iota', '1', 'Iota', 'Text of iota\\.'),
    runinHead('h3', 'section', 'kappa', '2', 'Kappa', 'Text of kappa\\.')],
  // (scrreprt's table of contents and list of figures become chapters
  // numbered 0, with entries numbered 0, with or without titletoc)
  'test-runintoc-koma': [runinToc([['chapter', '1', 'koma-chapter', 'Koma\\schapter'], ['section', '1.1', 'zeta', 'Zeta'],
    ['subsection', '1.1.1', 'zeta-one', 'Zeta one'], ['subsection', '1.1.2', 'zeta-two', 'Zeta two']],
    "(?:<span class='chapterToc'><span class='tocnumber'>0</span><a [^>]*>[^<]*</a></span>(?:<br />|\\s)*)*"),
    /<span class='lofToc'>1\.1<span class='tex8web-nbsp'> <\/span><a href='#first-box'>First box<\/a><\/span>(?:<br \/>|\s)*<span class='lofToc'>1\.2<span class='tex8web-nbsp'> <\/span><a href='#second-box'>Second box<\/a>/,
    /id='first-box'[^]*id='second-box'/,
    runinHead('h4', 'subsection', 'zeta-two', '1.1.2', 'Zeta two', 'Text of zeta two\\.')],
  // (titlesec's rules in a heading's label: \titlerule* and \titlerule
  // before the number in a display label, and \titlerule after it in a
  // block label. Each heading's label is its number alone, without the
  // rule's characters, and the heading holds no paragraph.)
  'test-titlerule-label': [['h3', 'sectionHead', 'alpha', '1', 'Alpha'],
    ['h4', 'subsectionHead', 'beta', '1\\.1', 'Beta'],
    ['h5', 'subsubsectionHead', 'gamma', '1\\.1\\.1', 'Gamma']].map(([h, cls, id, num, title]) =>
    new RegExp(`<${h} class='${cls}' id='${id}'>(?:[^<]|<(?!\\/${h}>|p[ >]))*<span class='titlemark'>${num}</span>(?:[^<]|<(?!\\/${h}>|p[ >]))*${title}</${h}>`)),
  // (a citation and its entry from bibtex, and an index from makeindex, in
  // one document)
  'test-bibindex': [/<span class='cite'>\[<a href='#Xgroups'>1<\/a>\]<\/span>/, /Groups and Their Orders/,
    /<div class='index-subitem'>order, <a href='#dx1-3'>2<\/a>/],
  // (a file \included from a folder, with a \ref each way)
  'test-include': [/The included part is section<span class='tex8web-nbsp'>[^<]*<\/span><a href='#included'>2</,
    /Text from the included file, which follows section<span class='tex8web-nbsp'>[^<]*<\/span><a href='#opening'>1</],
  // (files of an earlier build beside the document: the .aux of a build
  // with other packages and the stale .aux of an \included chapter,
  // tex4ht's .xref and .4tc of a run without a build folder, and, as
  // guards, a current .aux from the PDF with a .bbl, and a .toc and a
  // .tmp that no build reads. Each reference, citation, and table of
  // contents entry is this build's, and no old title or number is left)
  'test-staleaux': [...staleRefs("<span class='pageref'><a href='#two'>"), ...staleToc(['one', 'One'], ['two', 'Two'], ['chapter', 'Chapter'])],
  'test-staleaux-tex4ht': [/Section<span class='tex8web-nbsp'> <\/span><a href='#two'>2<!--[^>]*--><\/a> follows\./,
    /Text after section<span class='tex8web-nbsp'> <\/span><a href='#one'>1<!--/, ...staleToc(['one', 'One'], ['two', 'Two'])],
  'test-staleaux-current': [...staleRefs("<a href='#two'>1<!--"), ...staleToc(['one', 'One'], ['two', 'Two'], ['chapter', 'Chapter']),
    /the supplement(?:’|&#x2019;|')s section<span class='tex8web-nbsp'> <\/span>4\./, /Apple, 1/],
  'test-staleaux-lineno': [/Section<span class='tex8web-nbsp'> <\/span><a href='#two'>2<!--[^>]*--><\/a> follows\./],
  // (the stale list files of an earlier build beside a document with lists
  // of its own, which \@starttoc reads under their own extension: each
  // list's heading and this build's text, and the entries of the lists that
  // tex4ht sends through the .4ct. The entries of the other lists are not
  // checked: on the merge base these lists show none, stale file or not.
  // No old entry's title is in the page: a guard against a fix that copies
  // a stale list into the build folder, as the page comes from a later
  // LaTeX run than the first, which alone reads the file beside)
  'test-staleaux-toc': [...['Examples', 'Remarks'].map(title => new RegExp(`<span class='cmbx-12x-x-207'>${title}</span>`)),
    ...['list-of-theorems', 'boxes', 'todo-list'].map(id => new RegExp(`<h3 class='likesectionHead' id='${id}'>`)),
    /List of Algorithms<\/span>/, /Text of the first section\./, /Example<span class='tex8web-nbsp'> <\/span>1: A new example with/,
    /Text of the package of the document\./,
    /Remark<span class='tex8web-nbsp'> <\/span>2\.1: Another new remark/, /<span class='content'>New algorithm<\/span>/,
    /<a href='#new-figure'>New figure<\/a>/, /<a href='#new-table'>New table<\/a>/, /New listing<\/a>/, /Text of the second section\./,
    /^(?![^]*(?:Old (?:example|remark|box|algorithm|section|figure|table|listing|program)|Alte[rn]? ))/],
  'test-staleaux-toc-koma': [/List of Examples<\/h2>/, /Text of the first chapter\./, /<span class='content'>New example<\/span>/,
    /^(?![^]*Old example)/],
  'test-staletoc-draft': [/List of Examples<\/h2>/, /Text of the first chapter\./, /<span class='content'>New example<\/span>/],
  'test-staleaux-toc-memoir': [/<span class='cmbx-12x-x-172'>List of Examples<\/span>/, /Text of the first chapter\./,
    /Example<span class='tex8web-nbsp'> <\/span>1: A new example/, /\(New theorem\)/, /^(?![^]*Old (?:example|theorem))/],
  'test-staleaux-toc-color': [/<span class='cmbx-12x-x-207'>Examples<\/span>/, /Text of the first section\./,
    /Example<span class='tex8web-nbsp'> <\/span>1: A new example/, /^(?![^]*Old example)/],
  'test-staleaux-toc-amsart': [/Text of the first section\./, /New figure/, /New table/, /^(?![^]*Old (?:figure|table))/],
  'test-staleaux-toc-report': [/Examples<\/span>/, /Text of the first chapter\./,
    /Example<span class='tex8web-nbsp'> <\/span>1: A new example/, /^(?![^]*Old example)/],
  // (stale lists of an earlier build with no entry line, only
  // \addtocontents writes of a macro this document does not define: each
  // list's heading, this build's text and entries, and no old note. The
  // document's own class, package, definitions, text file, and
  // bibliography beside a stale .ptc are read: their text is in the page.
  // tex4ht's page shows no entries in titletoc's partial lists, amsart's
  // lists, tocloft's and newfloat's lists, and KOMA-Script's lists, with
  // or without stale files, so those checks find this build's captions in
  // the body. The full build's page comes from the last LaTeX run, which
  // reads the list that the first run wrote: its log shows the gap, and the
  // draft job's page does)
  'test-staleaux-ptc': [/List of Algorithms<\/h3>\s*<div class='tableofcontents'>\s*1 <a href='#new-algorithm'>New algorithm<\/a>/,
    /Text of the first section\./, /Text of the subsection\./, /<span class='content'>New figure<\/span>/,
    /<span class='content'>New table<\/span>/, /^(?![^]*Old (?:note|subsection|words))/],
  'test-staleaux-ptc-amsart': [/List of Figures/, /List of Tables/, /Text of the first section\./, /<span class='content'>New figure<\/span>/,
    /<span class='content'>New table<\/span>/, /^(?![^]*Old note)/],
  'test-staleaux-ptc-lists': [/List of Figures<\/h3>\s*<div class='tableofcontents'><span class='lofToc'>1<span class='tex8web-nbsp'> <\/span><a href='#new-figure'>New figure<\/a>/,
    /<span class='cmbx-12x-x-207'>Examples<\/span>/, /Example<span class='tex8web-nbsp'> <\/span>1: A new example/,
    /List of Programs<\/h3>\s*<div class='tableofcontents'>\s*1 <a href='#new-program'>New program<\/a>/, /List of Schemes<\/h3>/,
    /Listings<\/h3>\s*<div class='tableofcontents'><a href='#x1new-listing'>1\s+New listing<\/a>/,
    /List of Algorithms<\/h3>\s*<div class='tableofcontents'>\s*1 <a href='#new-algorithm'>New algorithm<\/a>/,
    /Text of the first section\./, /<span class='content'>New scheme<\/span>/, /^(?![^]*Old note)/],
  ...Object.fromEntries(['test-staleaux-ptc-koma', 'test-staleaux-ptc-noaux-koma'].map(name =>
    [name, [/List of Remarks<\/h3>/, /Text of the first section\./, /<span class='content'>New remark<\/span>/, /^(?![^]*Old note)/]])),
  'test-staleaux-ptc-noaux-lists': [/<span class='cmbx-12x-x-207'>Examples<\/span>/, /Example<span class='tex8web-nbsp'> <\/span>1: A new example/,
    /List of Programs<\/h3>\s*<div class='tableofcontents'>\s*1 <a href='#new-program'>New program<\/a>/, /List of Schemes<\/h3>/,
    /Text of the first section\./, /<span class='content'>New scheme<\/span>/, /^(?![^]*Old note)/],
  'test-staleaux-ptc-own': [/Text\s+of\s+the\s+first\s+section\.\s+Text\s+of\s+the\s+class\s+of\s+the\s+document\./, /Text\s+of\s+the\s+class\s+option\s+file\s+of\s+the\s+document\./,
    /Text\s+of\s+the\s+configuration\s+file\s+of\s+the\s+document\./, /Text\s+of\s+the\s+package\s+of\s+the\s+document\./,
    /Text\s+of\s+the\s+definitions\s+of\s+the\s+document\./,
    ...['ltx', 'fd', 'bbx', 'cbx'].map(e => new RegExp(`Text\\s+of\\s+the\\s+${e}\\s+file\\s+of\\s+the\\s+document\\.`)),
    /Text\s+of\s+the\s+text\s+file\s+of\s+the\s+document\./,
    /Text\s+of\s+the\s+Fortran\s+file\s+of\s+the\s+document\./,
    /<span class='cite'>\[<a href='#Xable'>1<\/a>\]<\/span>/, /Ann\s+Able\.\s+From\s+the\s+style\s+of\s+the\s+document:\s+A\s+Book\s+of\s+the\s+Document\./, /^(?![^]*Old note)/],
  'test-staleaux-ptc-include': [/Text of the first section\./, /Text of the subsection\./, /Example<span class='tex8web-nbsp'> <\/span>1: A new example/,
    /^(?![^]*Old (?:note|words))/],
  'test-staleaux-ptc-backref': [/Text of the first section\./, /Back References\. pages<span class='tex8web-nbsp'> <\/span><a href='#[^']+'>1<\/a>/, /^(?![^]*Old (?:note|words))/],
  'test-staleaux-ptc-draft': [/See section<span class='tex8web-nbsp'> <\/span><a href='#first'>1(?:<!--[^>]*-->)?<\/a>/, /<span class='cite'>\[<a href='#Xable'>1<\/a>\]<\/span>/,
    /A Book Read from the Current File/, /Apple, <a href='#[^']+'>1<\/a>/, /the seed-bearing part of a plant/, /^(?![^]*Old note)/],
  // (minitoc's numbered files of an earlier build beside the document, in
  // minitoc's own format, each entry with \textcolor, which this build
  // defines only with hyperref: this build's text, and no old entry. The
  // HTML build writes no numbered file of its own, so every LaTeX run
  // reads the file beside the document)
  ...Object.fromEntries(['-shortext', '-hyperref'].map(suffix => [`test-staleaux-mtc${suffix}`,
    [/Text of the first chapter\./, /Text of the section\./, /^(?![^]*Old (?:section|figure|table|note))/]])),
  'test-staleaux-mtc': [/Text of the first chapter\./, /Text of the second chapter\./, /Text of the other section\./,
    /Text of the third chapter\./, /^(?![^]*Old (?:section|figure|table|note|coffee))/],
  ...Object.fromEntries(['', '-shortext'].map(suffix => [`test-staleaux-mtc-article${suffix}`,
    [/Text of the first section\./, /Text of the second section\./, /Text of the other subsection\./,
      /^(?![^]*Old (?:other |third )?(?:subsection|figure|table))/]])),
  // (files of the document named like tex4ht's .4ht files, read in the
  // preamble: each file's text in the page, with nothing from the .4ht
  // file of its name, such as background.4ht's empty div, and article's
  // abstract and appendix, as guards: the files' errors show only in the
  // log; makeidx's index with its title, where index.4ht gave it "0"; and
  // one page, where glossary.4ht's errors closed the page twice)
  'test-inputname': [
    ...['glossary', 'abstract', 'appendix', 'index', 'background', 'reading', 'proof', 'errata'].map(name =>
      new RegExp(`<p class='[a-z]+'>\\s*${name[0].toUpperCase() + name.slice(1)}: Text from the ${name} file\\.\\s*</p>`)),
    /<p class='[a-z]+'>\s*Subfolder: Text from the subfolder glossary file\.\s*<\/p>/,
    /^(?![^]*class='backgroundmaterial')/,
    /<section class='abstract' role='doc-abstract'>\s*<h3 class='abstracttitle'>\s*<span class='cmbx-9'>Abstract<\/span>\s*<\/h3>\s*<p class='noindent'><span class='cmr-9'>The abstract of the document\.<\/span>/,
    /<h3 class='sectionHead' id='tables'>.*<span class='titlemark'>A<\/span>.*Tables<\/h3>/,
    /<h3 class='likesectionHead' id='index'>.*Index<\/h3>\s*<div class='theindex'><div class='theindex-letter'>\s*<div class='index-item'>ring, <a href='#[^']+'>1<\/a>/,
    /^(?![^]*<\/html>[^]*<\/html>)/,
  ],
  // (files of the document named like report.4ht, dvipsnam.4ht, and
  // latin1.4ht, read after the report class and before xcolor and inputenc
  // read dvipsnam.def and latin1.def: each file's text, the chapter as
  // report.4ht sets it, the named color's value, and the degree sign as
  // latin1.4ht sets it, outside the TS1 font's span)
  'test-inputname-class': [
    /Report: Text from the report file\./,
    /Dvipsnam: Text from the dvipsnam file\./,
    /<h2 class='chapterHead' id='files'>.*<span class='titlemark'>Chapter<span class='tex8web-nbsp'>[^<]*<\/span>1<\/span><br \/><a id='[^']+'><\/a>Files<\/h2>/,
    /<span style='color:light-dark\(#B80000, [^']*\);'>Brick red text\.<\/span>/,
    /Latin1: Text from the latin1 file\./,
    /An angle of 30°\./,
  ],
  // (the same files, read after xcolor and inputenc read dvipsnam.def and
  // latin1.def from TeX's tree: each file's text, the named color's value,
  // and the degree sign as latin1.4ht sets it)
  'test-inputname-after': [
    /Dvipsnam: Text from the dvipsnam file\./,
    /<span style='color:light-dark\(#B80000, [^']*\);'>Brick red text\.<\/span>/,
    /Latin1: Text from the latin1 file\./,
    /An angle of 30°\./,
  ],
  // (a file of the document named like reading.4ht, read after or before
  // biblatex's reading style, which biblatex reads outside the file
  // hooks: the file's text, the entry, and the sentence that shows
  // reading.4ht read for the style)
  ...Object.fromEntries(['test-inputname-biblatex', 'test-inputname-biblatex-first'].map(name => [name, [
    /Text from the reading file\./,
    /<dd class='thebibliography' id='bib-1'>[^]*A Book with a Title/,
    /Read for the web\./,
  ]])),
  // (a file of the document named like glossary.4ht, with no extension: its
  // text, and one page)
  'test-inputname-bare': [/Glossary: Text from the glossary file\./, /^(?![^]*<\/html>[^]*<\/html>)/],
  // (files of the document named like the appendix and abstract packages,
  // read with them: each file's text, and the abstract and the appendices
  // as appendix.4ht and abstract.4ht set them)
  'test-inputname-packages': [
    /Abstract: Text from the abstract file\./,
    /Appendix: Text from the appendix file\./,
    /<h3 class='abstracttitle'><span class='cmbx-9'>Abstract<\/span><\/h3>\s*<p class='noindent'>\s*<span class='cmr-9'>The abstract of the document\.<\/span>/,
    /<div class='appendices'>\s*<h3 class='likesectionHead' id='appendices'>.*Appendices<\/h3>/,
  ],
  // (built as it is, with no package or class of the writer's beside it;
  // run.mjs builds it again from each folder of test-ownpkg/)
  'test-ownpkg': [/No package or class of the writer.s\./],
  // (files
  // file's text and extra checks, nothing that glossary.4ht writes, such as
  // "refextract", and one page, where glossary.4ht's errors closed it twice)
  ...Object.fromEntries([
    ['test-provname', /Glossary: Text from the subfolder glossary file\./],
    ['test-provname-index', /Glossary: Text from the glossary file without an extension\./, [
      /Index: Text from the subfolder index file\./,
      /<h3 class='likesectionHead' id='[^']+'>.*Index<\/h3>\s*<div class='theindex'><div class='theindex-letter'>\s*<div class='index-item'>ring, <a href='#[^']+'>1<\/a>/,
    ]],
    ['test-provname-path', /Path: Text from the file found through the input path\./],
    ['test-provname-colors', /Glossary: Text from the subfolder glossary file\./,
      [/<span style='color:light-dark\(#B80000, [^']*\);'>Brick red text\.<\/span>/]],
    ['test-provname-primitive', /Glossary: Text from the glossary file\./],
    ['test-provname-import', /Glossary: Text from the subfolder glossary file\./],
    ['test-provname-ifexists', /Glossary: Text from the subfolder glossary file\./],
    ['test-provname-include', /Included: Text from the included glossary file\./],
    ['test-provname-defs', /Definitions: Text from the definitions file\./],
    ['test-provname-both', /Glossary: Text from the glossary file\./,
      [/Subfolder: Text from the subfolder glossary file\./]],
    ['test-provname-early', /Glossary: Text from the subfolder glossary file\./],
    ['test-provname-sty', /Glossary: Text from the glossary file\./],
    ['test-provname-vendored', /<span style='color:light-dark\(#B80000, [^']*\);'>Brick red text\.<\/span>/],
    ['test-provname-bbx', /Read for the web\./,
      [/<dd class='thebibliography' id='bib-1'>[^]*A Book with a Title/]],
    // (built as it is, every file by a relative path)
    ['test-abspath', /Input: Text from the file read with input\. By a relative path\./],
    // (files of the document that give a .4ht's name in \ProvidesFile,
    // read with the primitive \input, which sets no \CurrentFileUsed)
    ['test-priminput', /Glossary: Text from the subfolder glossary file\./],
    ['test-priminput-forms', /Extension: Text from the subfolder glossary file\./, [
      /Relax: Text from the subfolder glossary file\./,
      /Comment: Text from the subfolder glossary file\./,
      /Alias: Text from the subfolder glossary file\./,
      /Quoted: Text from the file with a space in its name\./,
      /Above: Text from the file read by a path with dots\./,
      /Definitions: Text from the definitions file\./,
      /Root: Text from the definitions file\./,
    ]],
    ['test-priminput-early', /Early: Text from the subfolder glossary file\./],
    ['test-priminput-chain', /Outer: Text from the outer file\./, [/Inner: Text from the inner file\./]],
    // (built as it is, by a relative path)
    ['test-priminput-abs', /Absolute: Text from the subfolder glossary file\. By a relative path\./],
    ['test-priminput-guards', /Nested: Text from the nested glossary file\./, [
      /Chapter: Text from the chapter file\./,
      /Body: Text from the glossary file read in the body\./,
    ]],
    ['test-priminput-tree', /<span style='color:light-dark\(#B80000, [^']*\);'>Brick red text\.<\/span>/],
    ['test-priminput-vendored', /<span style='color:light-dark\(#B80000, [^']*\);'>Brick red text\.<\/span>/],
    ['test-priminput-cnt', /Text after the contour driver file\./],
    // (files of the document that give a .4ht's name in \ProvidesFile,
    // read with the primitive \input from a package, class, option file,
    // or .def file of the document: each file's text, and no sentence that
    // shows a .4ht of that name was read, except framed.4ht for the framed
    // package)
    ['test-ownprim', /Glossary: Text from the subfolder glossary file\./, [
      /Index: Text from the subfolder index file\./, /^(?![^]*Index read for the web\.)/,
    ]],
    ['test-ownprim-class', /Glossary: Text from the subfolder glossary file\./, [
      /Index: Text from the subfolder index file\./, /^(?![^]*Index read for the web\.)/,
    ]],
    ['test-ownprim-def', /Index: Text from the subfolder index file\./, [
      /^(?![^]*Index read for the web\.)/,
      /Framed: Text from the subfolder framed file\./, /Framed read for the web\./,
    ]],
    ['test-ownprim-beside', /Nomencl: Text from the nomencl file beside the document\./, [
      /^(?![^]*Nomencl read for the web\.)/,
    ]],
    ['test-ownprim-after', /Framed: Text from the subfolder framed file\./, [
      /Framed read for the web\./,
      /<span style='color:light-dark\(#B80000, [^']*\);'>Brick red text\.<\/span>/,
    ]],
    // (built as it is, with no folder on TEXINPUTS)
    ['test-texinpkg', /No package or class on TEXINPUTS\./],
    // (built as it is, with no package or class in a TeX tree)
    ['test-texmfpkg', /No package or class in a TeX tree\./, [/^(?![^]*read for the web\.)/]],
    ['test-ownprim-guards', /Braced: Text from the subfolder glossary file\./, [
      /Subfolder: Text from the subfolder index file\./,
      /Path: Text from the subfolder framed file\./,
      /^(?![^]*read for the web\.)/,
    ]],
  ].map(([name, text, extra = []]) => [name, [
    text, /^(?![^]*refextract)/, /^(?![^]*<\/html>[^]*<\/html>)/, ...extra,
  ]])),
  // (a citation and its entry from a .bst and a .bib named by a path that
  // begins with ../)
  'test-bibpath': [/<span class='cite'>\[<a href='#Xlattices'>1<\/a>\]<\/span>/, /<dd><a id='Xlattices'><\/a>Notes on Distributive Lattices</],
  // (the same from a .bst beside the document, named without a path)
  'test-bibstyle': [/<span class='cite'>\[<a href='#Xlattices'>1<\/a>\]<\/span>/, /<dd><a id='Xlattices'><\/a>Notes on Distributive Lattices</],
  // (a bibliography whose \bibliographystyle and \bibliography are in a
  // file read by \include: the citations in a heading, the text, italic, a
  // footnote, and a theorem, and the entries, as in the PDF)
  'test-bibinclude': [
    /Parts after<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xbaker'>2<\/a>\]<\/span><\/h3>/,
    /A citation<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xable'>1<\/a>\]<\/span>, and one in italic: <span class='cmti-10'>as<span class='tex8web-nbsp'> <\/span><\/span><span class='cite'><span class='cmti-10'>\[<\/span><a href='#Xbaker'><span class='cmti-10'>2<\/span><\/a>/,
    /A footnote citing<span class='tex8web-nbsp'> <\/span><\/span><span class='cite'><span class='cmr-8'>\[<\/span><a href='#Xable'><span class='cmr-8'>1<\/span><\/a>/,
    /\(<\/span><span class='cite'><span class='cmbx-10'>\[<\/span><a href='#Xbaker'><span class='cmbx-10'>2<\/span><\/a>/,
    /A theorem citing<span class='tex8web-nbsp'> <\/span><\/span><span class='cite'><span class='cmti-10'>\[<\/span><a href='#Xable'><span class='cmti-10'>1<\/span><\/a>/,
    /<dt> \[1\]<\/dt><dd><a id='Xable'><\/a>Ann Able\. <span class='cmti-10'>A Book on Included Bibliographies<\/span>\. A Publisher, 2001\. <\/dd>/,
    /<dt> \[2\]<\/dt><dd><a id='Xbaker'><\/a>Bo<span class='tex8web-nbsp'> <\/span>Baker\. <span class='cmti-10'>A Second Book Cited from a Part<\/span>\. A Publisher, 2002\. <\/dd>/,
  ],
  // (the same with \bibliographystyle in the document and \bibliography in
  // the included file, with hyperref)
  'test-bibinclude-main': [
    /A citation<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xable'>1<\/a>\]<\/span>, and one in italic: <span class='cmti-10'>as<span class='tex8web-nbsp'> <\/span><\/span><span class='cite'><span class='cmti-10'>\[<\/span><a href='#Xbaker'><span class='cmti-10'>2<\/span><\/a>/,
    /<dt> \[1\]<\/dt><dd><a id='Xable'><\/a>Ann Able\. <span class='cmti-10'>A Book on Included Bibliographies<\/span>/,
    /<dt> \[2\]<\/dt><dd><a id='Xbaker'><\/a>Bo<span class='tex8web-nbsp'> <\/span>Baker\. <span class='cmti-10'>A Second Book Cited from a Part<\/span>/,
  ],
  // (a .bst and a .bib named by a path that begins with ../, in the
  // included file: test-bibpath.bst writes only the title)
  'test-bibinclude-parent': [/A citation<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xable'>1<\/a>\]<\/span>\./,
    /<dt> \[1\]<\/dt><dd><a id='Xable'><\/a>A Book on Included Bibliographies<\/dd>/],
  // (natbib with plainnat in the included file: \citet and \citep)
  'test-bibinclude-natbib': [
    /As <a href='#Xable'>Able<\/a><span class='tex8web-nbsp'> <\/span>\[<a href='#Xable'>2001<\/a>\] shows, and see also \[<a href='#Xbaker'>Baker<\/a>,<span class='tex8web-nbsp'> <\/span><a href='#Xbaker'>2002<\/a>\]\./,
    /<dd><a id='Xable'><\/a>Ann Able\. <span class='cmti-10'>A Book on Included Bibliographies<\/span>\. A Publisher, 2001\. <\/dd>/,
    /<dd><a id='Xbaker'><\/a>Bo<span class='tex8web-nbsp'> <\/span>Baker\. <span class='cmti-10'>A Second Book Cited from a Part<\/span>\. A Publisher, 2002\. <\/dd>/,
  ],
  // (a report with parts in subfolders: the citation of an included
  // chapter, and the entry that its \nocite adds, from a .bib in a
  // subfolder. A chapter that \includeonly leaves out, whose .aux the
  // main .aux names, is checked in logs: bibtex runs without an error.)
  'test-bibinclude-report': [
    /A citation<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xable'>1<\/a>\]<\/span> in an included chapter\./,
    /<dt> \[1\]<\/dt><dd><a id='Xable'><\/a>Ann Able\. <span class='cmti-10'>A Book from a Subfolder<\/span>\. A Publisher, 2001\. <\/dd>/,
    /<dt> \[2\]<\/dt><dd><a id='Xcole'><\/a>Cy<span class='tex8web-nbsp'> <\/span>Cole\. <span class='cmti-10'>A Book Named Only by Nocite<\/span>\. A Publisher, 2003\. <\/dd>/,
  ],
  // (a .bbl beside the document, and a missing .bib named in a file read
  // by \include: the entry of that .bbl, as in the PDF)
  'test-bibinclude-missing': [
    /A citation<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xable'>1<\/a>\]<\/span>\./,
    /<dt> \[1\]<\/dt><dd><a id='Xable'><\/a>Ann Able\. <span class='cmti-10'>A Book Shipped beside the Document<\/span>\. A Publisher, 2001\. <\/dd>/,
  ],
  // (parts read by \input, \subfile, and \subimport: the citation and its
  // entry)
  'test-bibinclude-input': [
    /A citation<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xable'>1<\/a>\]<\/span> in a part read by/,
    /<dt> \[1\]<\/dt><dd><a id='Xable'><\/a>Ann Able\. <span class='cmti-10'>A Book from a Subfolder<\/span>\. A Publisher, 2001\. <\/dd>/,
  ],
  // (a .bbl beside the document, and a .bib that \bibliography or
  // \addbibresource names missing: the citations and entries from that
  // .bbl, as in the PDF. natbib's author-year and numbers with hyperref,
  // a missing name in a subdirectory beside two there, one .bib of two,
  // biber with one .bib of two, biblatex's bibtex backend, and bibentry)
  'test-bblnobib': [
    /As <a href='#Xone'>One<\/a><span class='tex8web-nbsp'> <\/span>\[<a href='#Xone'>2001<\/a>\] says, and as \[<a href='#Xtwo'>Two<\/a>,<span class='tex8web-nbsp'> <\/span><a href='#Xtwo'>2002<\/a>\] shows/,
    /See also <\/span><a href='#Xtwo'><span class='cmr-8'>Two<\/span><\/a>/,
    /<dd><a id='Xone'><\/a>Ann One\. <span class='cmti-10'>The First Shipped Entry<\/span>/,
    /<dd><a id='Xtwo'><\/a>Bo<span class='tex8web-nbsp'> <\/span>Two\. <span class='cmti-10'>The Second Shipped Entry<\/span>/],
  'test-bblnobib-names': [
    /Citations<span class='tex8web-nbsp'> <\/span>\[<a href='#Xone'>1<\/a>,<span class='tex8web-nbsp'> <\/span><a href='#Xtwo'>2<\/a>\]\./,
    /<dd><a id='Xone'><\/a>Ann One\. <span class='cmti-10'>The First Shipped Entry<\/span>/,
    /<dd><a id='Xtwo'><\/a>Bo<span class='tex8web-nbsp'> <\/span>Two\. <span class='cmti-10'>The Second Shipped Entry<\/span>/],
  'test-bblnobib-partial': [
    /<span class='cite'>\[<a href='#Xgroups'>1<\/a>,<span class='tex8web-nbsp'> <\/span><a href='#Xone'>2<\/a>\]<\/span>/,
    /<dd><a id='Xgroups'><\/a>Anne Author\. <span class='cmti-10'>Groups and Their Orders<\/span>/,
    /<dd><a id='Xone'><\/a>Ann One\. <span class='cmti-10'>The First Shipped Entry<\/span>/],
  'test-bblnobib-biber': [
    /A citation<span class='tex8web-nbsp'> <\/span>\[(?:<a id='[^']*'><\/a>)*<a href='#X0-one'>1<\/a>\]/,
    /<dt class='thebibliography' id='X0-one'>/, /Ann One\. <span class='cmti-10'>The First Shipped Entry<\/span>\. A Publisher, 2001\./],
  'test-bblnobib-blx': [
    /A citation<span class='tex8web-nbsp'> <\/span>\[(?:<a id='[^']*'><\/a>)*<a href='#X0-one'>1<\/a>\]/,
    /Ann One\. <span class='cmti-10'>The First Shipped Entry<\/span>\. A Publisher, 2001\./],
  'test-bblnobib-bibentry': [/The entry: <a id='one'><\/a>Ann One\. <span class='cmti-10'>The First Shipped Entry<\/span>\. A Publisher, 2001\./],
  // (every .bib there, one of them found only by kpathsea in the TeX
  // distribution, and a stale .bbl beside: the entries from the .bib
  // files, through bibtex, biber, or biblatex's bibtex backend)
  'test-bblnobib-guard': [
    /<span class='cite'>\[<a href='#Xgroups'>3<\/a>,<span class='tex8web-nbsp'> <\/span><a href='#Xlattices'>1<\/a>,<span class='tex8web-nbsp'> <\/span><a href='#Xsub'>4<\/a>,<span class='tex8web-nbsp'> <\/span><a href='#Xarticle-full'>2<\/a>\]<\/span>/,
    /<dd><a id='Xlattices'><\/a>Notes on distributive lattices\./,
    /<dd><a id='Xgroups'><\/a>Anne Author\. <span class='cmti-10'>Groups and Their Orders<\/span>/,
    /<dd><a id='Xsub'><\/a>Sue Sub\. <span class='cmti-10'>An Entry from a Subdirectory<\/span>/,
    /<dd><a id='Xarticle-full'><\/a>L\[eslie\]<span class='tex8web-nbsp'> <\/span>A\. Aamport\./, /^(?![^]*Stale)/],
  'test-bblnobib-biberguard': [/<a href='#X0-book'>1<\/a>\]/, /A Book with a Title Long Enough to Wrap/, /^(?![^]*Stale)/],
  'test-bblnobib-blxguard': [/<a href='#X0-book'>1<\/a>\]/, /A Book with a Title Long Enough to Wrap/, /^(?![^]*Stale)/],
  // (a .bib, and beside the document the .bbl of an earlier build with
  // another backend or style: the citation and the entry from the .bib,
  // through bibtex, biber, or biblatex's bibtex backend)
  ...Object.fromEntries(['test-staleaux-bbl', 'test-staleaux-bbl-hyperref', 'test-staleaux-bbl-harvard'].map(name => [name, [
    /Cited<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xfresh'>1<\/a>\]<\/span>\./,
    /<dd><a id='Xfresh'><\/a>Fay Fresh\. <span class='cmti-10'>The Fresh Entry<\/span>\. A New Publisher, 2020\./, /^(?![^]*Stale)/]])),
  ...Object.fromEntries(['test-staleaux-bbl-biber', 'test-staleaux-bbl-blx'].map(name => [name, [
    /Cited<span class='tex8web-nbsp'> <\/span>\[(?:<a id='[^']*'><\/a>)*<a href='#X0-fresh'>1<\/a>\]\./,
    /Fay Fresh\. <span class='cmti-10'>The Fresh Entry<\/span>\. A New Publisher, 2020\./, /^(?![^]*Stale)/]])),
  'test-staleaux-bbl-natbib': [
    /As <a href='#Xfresh'>Fresh<\/a><span class='tex8web-nbsp'> <\/span>\[<a href='#Xfresh'>2020<\/a>\] says\./,
    /Fay Fresh\. <span class='cmti-10'>The Fresh Entry<\/span>\. A New Publisher, 2020\./, /^(?![^]*Stale)/],
  // (a .bbl beside the document that the document reads itself, with
  // \input or \InputIfFileExists, with no .bib: its citation and entry)
  ...Object.fromEntries(['test-staleaux-bbl-input', 'test-staleaux-bbl-ifexists', 'test-staleaux-bbl-jobname'].map(name => [name, [
    /Cited<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xshipped'>1<\/a>\]<\/span>\./,
    /<dd><a id='Xshipped'><\/a>Sue Shipper\. <span class='cmti-10'>The Shipped Entry<\/span>\. A Publisher, 2003\./]])),
  'test-stalebcf': [/See <span class='cite'>\[<a href='#Xable'>1<\/a>\]<\/span>\./,
    /Ann Able\. <span class='cmti-10'>A Book Kept in the Build Folder<\/span>\. A Publisher, 1999\./],
  'test-staleaux-bbl-current': [
    /Cited<span class='tex8web-nbsp'> <\/span><span class='cite'>\[<a href='#Xfresh'>1<\/a>\]<\/span>\./,
    /<dd><a id='Xfresh'><\/a>Fay Fresh\. <span class='cmti-10'>The Fresh Entry<\/span>\. A New Publisher, 2020\./],
  // (! active in the preamble: babel's shorthands, in a heading and the
  // table of contents, the text, a footnote, a theorem, three fonts, and
  // math, with no space after a bare ! as in the PDF, and literal in
  // verbatim; also with the document's own config, by hand, and as
  // shortvrb's delimiter. French and Turkish make ! active later, with
  // French's space and Turkish's thin space before it.)
  'test-bang': [
    /<h3 class='sectionHead' id='the-bang-heading-again'>(?:(?!<\/h3>)[^])*<\/a>The <span class='cmti-10'>bang <\/span>heading!Again<\/h3>/,
    /<p class='noindent'>A <span class='cmti-10'>word <\/span>and a mark!Then a <span class='cmbx-10'>strong<\/span> one\./,
    /<span class='cmr-8'>A <\/span><span class='cmti-8'>note <\/span><span class='cmr-8'>term and a <\/span><span class='cmbx-8'>note <\/span><span class='cmr-8'>too!Yes\.<\/span>/,
    /<span class='cmbx-10'>Theorem 1\.<\/span> <\/span><span class='cmti-10'>Every group has a <\/span><span class='cmbxti-10'>unit<\/span><span class='cmti-10'>!<\/span>/,
    /In <span class='cmti-10'>an emph term<\/span>, <span class='cmss-10'>a <\/span><span class='cmssi-10'>sans <\/span><span class='cmss-10'>term<\/span>, and <span class='cmtt-10'>a <\/span><span class='cmitt-10'>mono <\/span><span class='cmtt-10'>term<\/span>\./,
    /The factorial <mjx-container aria-label='n factorial'/,
    /aria-label='open paren n plus 1 close paren factorial equals open paren n plus 1 close paren times n factorial'/,
    /<span class='sectionToc'><span class='tocnumber'>1<\/span><a href='#the-bang-heading-again'[^>]*>The <span class='cmti-10'>bang <\/span>heading!Again<\/a>/,
    /<span class='cmr-8'>as many as <\/span><span class='mathjax-inline'[^>]*><mjx-container aria-label='n factorial'/,
    /<span class='tex8web-labelsep'> <\/span><a id='[^']*'><\/a>Counting <mjx-container aria-label='n factorial'/,
    /<a href='#counting-n-orders'[^>]*>Counting <mjx-container aria-label='n factorial'/,
    /Verbatim <span class='obeylines-h'><code class='verb'><span class='cmtt-10'>a!!b<\/span><\/code><\/span> and/,
    /<pre class='verbatim' id='verbatim-1'>\s*<span class='cmtt-10'>x!!y<\/span>\s*<\/pre>/,
  ],
  'test-bang-owncfg': [/<p class='noindent'>A <span class='tex8web-term' id='term-word'><span class='cmti-10'>word<\/span><\/span> and a mark! <\/p>/],
  'test-bang-shortvrb': [/Type <span class='obeylines-h'><code class='verb'><span class='cmtt-10'>a_b\{c\}<\/span><\/code><\/span> here\./],
  'test-bang-french': [/<p class='noindent'>Un mot ! Et une question \? Oui : non ; fin\./],
  'test-bang-turkish': [/<p class='noindent'>Evet\u202f! Hayır\u202f: belki\./],
  'test-fnspace-koma': [
    noteWords(1, 'I thank a referee for this.'), noteWords(2, 'A measure is finite here.'), noteWords(3, 'We thank the editor too.'),
    noteWords(4, 'I am grateful to her.'), noteWords(20, 'I owe this point to him.'), noteWords(5, 'I stress this word.'),
    noteWords(6, 'I, too, agree with it.'), noteWords(7, 'Ian thanks a colleague.'), noteWords(8, 'a fortiori it holds.'),
    noteWords(9, 'I say this in sans.'), noteWords(10, 'I type this in mono.'), noteWords(11, 'I.e. the same again.'),
    noteWords('a', 'I note this in a box.'), noteWords(1000, 'I am a fan of it.'), noteWords(12, 'I thank a reader here.'),
    noteWords(13, 'We are so in it.'),
    /<span class='thank-mark'>(?:<[^>]*>)*\*(?:<[^>]*>)*<\/span>I\s+thank\s+a\s+funder\s+of\s+this\s+work\./,
  ],
  'test-fnspace-scrreprt': [
    noteWords(1, 'I thank a reader for this.'), noteWords(2, 'A measure is finite there.'), noteWords(3, 'We thank the printer too.'),
    noteWords(9, 'I owe this remark to her.'), noteWords(4, 'a priori it fails.'), noteWords(20, 'I owe this here.'),
    noteWords(1000, 'I am a fan of it.'),
  ],
  'test-fnspace-scrbook': [
    noteWords(1, 'I thank a critic for this.'), noteWords(2, 'A measure is finite again.'), noteWords(3, 'We thank the binder too.'),
    noteWords(4, 'I am in debt to them.'), noteWords('a', 'I add this in a box.'), noteWords(5, 'It is so.'),
    noteWords(6, 'If so, then.'), noteWords(7, 'Me too, then.'),
  ],
  // (fragile commands in the titles: the number and text of each title,
  // the \ref to it, and the \nameref that gives its title or short title;
  // titles that set no name, and a footnote in a title)
  'test-tcbtitle': [
    ...['Theorem~1.2:~Unlabelled $> plain', 'Theorem~1.8:~Styled <span class=\'cmti-10\'>starred </span>and <span class=\'cmss-10\'>s</span>',
      'Remark~1:~Declared starred', 'Claim~1:~Renewed r', 'Theorem:~Unnumbered starred $>', 'Plain $> starred', 'Also plain $ z',
      'Box 1: Named $> plain', 'Theorem~3.1:~After starred', 'Theorem~3.2:~Body starred', 'Theorem~3.3:~Holds e'].map(boxTitle),
    ...[['Theorem~1.1:~Differentiable <span class=\'tex8web-nowrap\'>$>~continuous</span>', '1.1',
      'Differentiable <span class=\'tex8web-nowrap\'>$>~continuous</span>'],
    ['Theorem~1.3:~Starred $ starred', '1.3', 'Starred $ starred'], ['Theorem~1.4:~Option plain', '1.4', 'Option plain'],
    ['Theorem~1.5:~Long title', '1.5', 'Short $> plain'], ['Theorem~1.6:~Keyed title', '1.6', 'Key y'],
    ['Theorem~1.7:~Pick y or x', '1.7', 'Pick y or x'], ['Exercise~1:~Keyed plain', '1', 'Theorems'],
    ['Box 2: Labelled n', '2', 'Labelled n'], ['Box 3: Outer plain', '3', 'Outer plain'], ['Theorem~3.4:~Inner i', '3.4', 'Inner i'],
    ['Theorem~3.5:~Protected starred', '3.5', 'Protected starred'], ['Theorem~3.6:~Robust starred', '3.6', 'Robust starred'],
    ['Theorem~3.7:~Converse of Theorem~[1.1]', '3.7']].map(([title, ...links]) => boxRefs(title, ...links)),
    /<div class='tcolorbox-title'> <p[^>]*>Noted<span class='footnote-mark'>/,
    /<span class='cmr-8'>A plain<span class='tex8web-nbsp'> <\/span>note\.<\/span>/,
    boxParagraph('See Theorem~[1.1], [1.3], [1.4], [1.5], [1.6], [1.7], Exercise~[1], and Box~[2].'),
    boxParagraph('Named: [Differentiable <span class=\'tex8web-nowrap\'>$>~continuous</span>]; [Starred $ starred]; [Option plain]; '
      + '[Short $> plain]; [Key y]; [Pick y or x]; [Labelled n].'),
    boxParagraph('Refs: [3.4], [3], [3.5], [3.6], [3.7].'),
    boxParagraph('Names: [Theorems]; [Labels elsewhere]; [Inner i]; [Outer plain]; [Protected starred];'),
    boxParagraph('[Robust starred].'),
  ],
  'test-tcbtitle-nameref': [
    boxTitle('Theorem~2:~Unlabelled u'),
    ...[['Theorem~1:~Labelled starred', '1', 'Labelled starred'], ['Theorem~3:~Long title', '3', 'Short x'],
      ['Box 1: Named plain', '1', 'Named plain']].map(([title, ...links]) => boxRefs(title, ...links)),
    boxParagraph('See Theorem~[1], [3], and Box~[1]. Named: [Labelled starred]; [Short x]; [Named plain].'),
    boxTitle('Theorem~4:~Two plain'), boxParagraph('Second label: [Two plain].'),
  ],
  // (the boxes build, with their titles and names, though tex4ht writes no
  // entry of a box for \tcblistof or \listoffigures; \thesection in a
  // title, and a box without a counter in the list of figures)
  'test-tcbtitle-list': [
    ...['Theorem~3.4:~Plain title', 'Theorem:~Unnumbered plain', 'Named plain', 'Listed 1: Default d',
      'Figure~1:~Data of section 3'].map(boxTitle),
    boxParagraph('No counter.'),
    ...[['Theorem~3.1:~Long starred', 'Long starred'], ['Theorem~3.2:~Titled', 'Short y'],
      ['Theorem~3.3:~Keyed', 'Key x']].map(([title, ...links]) => boxRefs(title, ...links)),
  ],
  // hologo's BibTeX logo after each label: its B, and then IB with no
  // formula of \m@th between them, which MathJax draws in red
  'test-hologo': [
    ...["class='tocnumber'>1<\\/span><a [^>]*>Using ", "<a id='[^']*'><\\/a>Using ", 'Text: ', 'Italic: ',
      "Notes: <\\/span>", "Theorem: <\\/span>", 'Sans: ', 'Typewriter: ', 'Bold: ', 'Capital: ', 'Eight: ',
      'Variant sf: ', "titleHead'>Using ", "lofToc'>1<span class='tex8web-nbsp'> <\\/span><a [^>]*>The ",
      "<span class='content'>The "].map(hologoBibtex),
    // (a copy of the same construct in a macro of the document)
    /Copy: <span class='tex8web-nowrap'>L(?:(?!<mjx-container|<\/p>)[^])*<span class='cmr-7'>A<\/span><span class='tex8web-tex'>T/,
    // (the sc variant, which has no math, as a variant and by setup)
    /Guards: <span class='HoLogo-BibTeX-sc'>B<span class='HoLogo-i'>i<\/span><span class='HoLogo-b'>b<\/span>/,
    /Setup: <span class='HoLogo-BibTeX-sc'>B<span class='HoLogo-i'>i<\/span><span class='HoLogo-b'>b<\/span>/,
    // (\m@th before content in a box of text, and between letters in
    // \text: no space added)
    /Tight: <span class='tex8web-nowrap'><mjx-container aria-label='a x b'[^>]*><mjx-math[^>]*><mjx-c class='mjx-c1D44E'>\u{1D44E}<\/mjx-c><mjx-mstyle><mjx-c class='mjx-c1D465'>/u,
    /Glued: <span class='tex8web-nowrap'><mjx-container aria-label='gh'/,
    // (an empty formula in \small text: removed after text, with its space
    // in the formula's size; kept after a space, as are the formulas empty
    // in the source between spaces; removed between letters)
    /Small:<span class='tex8web-math-space' style='--tex8web-math-size: 0\.9'> <\/span><\/span><span class='cmr-9'>word/,
    /Spaced: <span class='mathjax-inline' style='--tex8web-math-size: 0\.9'><mjx-container [^>]*><mjx-math [^>]*><\/mjx-math>/,
    /Empty: <mjx-container [^>]*><mjx-math [^>]*><\/mjx-math>(?:(?!<\/p>)[^])*?<\/mjx-container> and <mjx-container [^>]*><mjx-math [^>]*><\/mjx-math>/,
    /Bare:\s*<span class='tex8web-nowrap'>xy\.<\/span>/,
    // (a macro \let to \m@th, which takes nothing from the definition
    // after it)
    /Let: <mjx-container aria-label='x'[^]*? and <span class='tex8web-nowrap'><mjx-container aria-label='bold v'/,
  ],
  'test-hologo-plain': ["class='tocnumber'>1<\\/span><a [^>]*>Using ", "<a id='[^']*'><\\/a>Using ", 'Text: '].map(hologoBibtex),
  // (a page read as HTML, after a stray end tag: the text of each listing,
  // verbatim, inline code, font change, heading, table of contents entry,
  // table cell, caption, and description label, as in the PDF, each in its
  // element; a link after a reference; the formulas, prerendered; and the
  // links' addresses)
  'test-htmlread': [
    /<title>&(?:amp|#x0*26);\s*Title’s text<\/title>/, /<h1 class='titleHead'>&(?:amp|#x0*26);\s*Title’s text<\/h1>/,
    /<meta content='&(?:amp|#x0*26);\s*Title’s text' property='og:title'/,
    shown('& heading', "<h3 class='sectionHead'[^>]*>(?:(?!</h3>)[^])*?", '</h3>'),
    shown('& heading', "<span class='sectionToc'><span class='tocnumber'>1</span><a [^>]*>", '</a>'),
    shown("'Hello'", "Strings: <code class='lstinline'>(?:<[^>]*>)*", '(?:<[^>]*>)*</code>\\.', '(?:<(?!/code)[^>]*>)*'),
    ...['>>> f(3)', '>>> print("hi")', '#include <stdio.h>', 'if (a && b < c) puts("s");',
      'Inline C: a<b && c>d then', 'Verb: <a> & "b".', 'Link: &here and quote.', 'Plain: a & b and a&b.',
      '>>> "v" && <w>', '>>> "x" && <y>', '>>> "z" <', 'print("Bell Circuit:")', 'if a < b > c: pass',
      'Mintinline: "q" < 1.'].map(text => shown(text)),
    shown('&', "Emph: <span class='ecti-1000'>", '</span>'), shown('<x', "Italic: <span class='ecti-1000'>", '</span>'),
    shown('<b> ', "Typewriter: <span class='ectt-1000'>", '</span>'), shown('"y"', "and <span class='ectt-1000'>", '</span>'),
    shown('&s', "Sans: <span class='ecss-1000'>", '</span>'),
    shown('& ', "<span class='ecbi-1000'>", "</span><span class='ecti-1000'>in a theorem\\.</span>"),
    shown('& in a footnote.', "<span class='ecrm-0800'>", '</span>'),
    shown('&here', "<a href='https://example\\.com/\\?a=1&amp;b=2'>", '</a>'),
    shown('& x', "<td[^>]*>\\s*", '\\s*</td>'), shown('<y>', "<td[^>]*>\\s*<span class='ectt-1000'>", '</span></td>'),
    shown('& cap', "<span class='content'>", '</span></figcaption>'),
    shown('&', "<dt class='description'>(?:<a [^>]*></a>)?\\s*<span class='ecbx-1000'>", '</span>'),
    /a&(?:amp|#x0*26);<a href='https:\/\/example\.com'>y<\/a>/,
    /<mjx-container aria-label='a is less than b'/, /<mjx-container aria-label='a ampersand b is greater than c'/,
    /<\/code>(?:<\/span>)* then (?:<span[^>]*>)*<mjx-container/,
    /<a href='https:\/\/example\.com\/\?a=1&amp;b=2'>/, /<a href='https:\/\/example\.com\/it&(?:#39|#x0*27|apos);s\?c=3&amp;d=4'>/,
    /^(?![^]*(?:\/span&gt;|(?<!&)#x0*[0-9A-F]{2,};))/,
  ],
};

// Text back in its font after a font command that the PDF keeps in a
// group: a \contentsname in small capitals, and an \intertext in italics
const fonts = {
  // (also a footnote's emphasis after a \tikz picture, and the letters of
  // the LaTeX logo, each in a span the stylesheet positions)
  'test-article': [/<span class='cmti-8'>emphasized<\/span>/,
    /<span class='tex8web-latex'>L<span class='tex8web-a'>A<\/span><span class='tex8web-tex'>T<span class='tex8web-e'>E<\/span>X<\/span><\/span>/],
  'test-fonts': [/<p class='noindent'>The text, in its own font\./,
    /<span class='tex8web-intertext'>Another note\.\s*<\/span>/],
  // (a title in the font that a redefined \maketitle sets, in a heading at
  // the text size)
  'test-titlefont': [/<h1 class='titleHead'><span\s+class='bchb7t-x-x-240'>A title in its own font<\/span><\/h1>/],
  // (a run-in paragraph heading in its \@startsection font, without
  // html4.4ht's bold)
  'test-secfont': [/<span class='paragraphHead' id='a-paragraph'><a id='[^']+'><\/a>A paragraph<\/span>/],
  // (amsart's run-in head, which html4.4ht ends with a period)
  'test-amsart': [/<span class='paragraphHead' id='a-paragraph'> <a id='[^']+'><\/a>A paragraph\.<\/span>/],
};

// \textsurd as √ after the given text, in the fonts whose tex4ht files give
// a middle dot and in those that give √. Latin Modern, pxfonts, every TeX
// Gyre family but Termes, and txfonts give a middle dot. Palladio takes
// the sign from Computer Modern's TS1 font. \textperiodcentered stays a
// middle dot, and no other middle dot is left in the page.
const surd = before => new RegExp(`${before}\\s*(?:<\\/?span[^>]*>\\s*)*√`);
const dot = before => new RegExp(`${before}\\s*(?:<\\/?span[^>]*>\\s*)*·`);
const inFont = before => new RegExp(`${before}\\s*(?:<\\/span>\\s*)?<span\\s+class='ts1-[^']+'>√`);
// The TS1 symbols of test-ts1-symbols, each with its label and the code
// point of the Unicode character of its glyph. \textcopyleft is ɔ, as
// macOS has no font with the copyleft sign.
const ts1Symbols = [['Threequartersemdash', '2014'], ['Blank', '2422'], ['Dblhyphen', '2E40'], ['Lbrackdbl', '27E6'],
  ['Rbrackdbl', '27E7'], ['Dblhyphenchar', '2E40'], ['Acutedbl', '02DD'], ['Gravedbl', '02F5'], ['Bardbl', '2016'],
  ['Bullet', '2022'], ['Guarani', '20B2'], ['Lira', '20A4'], ['Discount', '2052'], ['Openbullet', '25E6'],
  ['Lquill', '2045'], ['Rquill', '2046'], ['CircledP', '2117'], ['Mu', '00B5'], ['Ordmasculine', '00BA'],
  ['Surd', '221A'], ['Quotesingle', '0027'], ['Copyleft', '0254']];
const ts1 = (label, code) => new RegExp(`${label}\\s*(?:<\\/?span[^>]*>\\s*)*\\u{${code}}`, 'u');
const onlyDots = /^(?![^]*(?<!dot\s*(?:<\/?span[^>]*>\s*)*)·)/i;
const surds = {
  // (also in a heading and its contents entry, an itemize's and a
  // description's label, a table's cell and caption, beside \textbullet's •,
  // and in \text in math, which MathJax typesets)
  'test-surd': [onlyDots, dot('Dot'), ...['Plain', 'Italic', 'Bold', 'Bolditalic', 'Slanted', 'Smallcaps', 'Typewriter',
    'Sans', 'Sansbold', 'Large', 'Footnote', 'Theorem', 'Caption', 'Bullet • and surd'].map(surd),
    new RegExp(`<h3 class='sectionHead'(?:(?!<\\/h3>)[^])*${surd('Roots').source}`),
    new RegExp(`<span class='sectionToc'>(?:(?!<\\/a>)[^])*${surd('Roots').source}`),
    new RegExp(`<span class='tex8web-label'>${surd('').source}`), new RegExp(`<td [^>]*>${surd('').source}`),
    new RegExp(`<dt [^>]*>(?:<a [^>]*><\\/a>)?${surd('').source}`),
    /<mtext>Mathtext √<\/mtext>/,
    // (at the start of a paragraph and of a p{} cell)
    new RegExp(`<p [^>]*>${surd('').source}\\s*(?:<\\/span>\\s*)?Paragraph start`),
    new RegExp(`<td [^>]*>\\s*<p [^>]*>${surd('').source}\\s*(?:<\\/span>\\s*)?Parcell`),
    // (the text after a picture, which keeps the font's glyph, stays as it is)
    /test-surd0x\.svg'[^>]*\/> here\./, /test-surd1x\.svg'[^>]*\/> after\./,
    // The sign is in the span of its TS1 font, which has the size and family
    // of the text around it. Its weight and shape are checked by visual.mjs.
    ...['Typewriter', 'Sans', 'Large', 'Footnote'].map(inFont)],
  'test-surd-fonts': [onlyDots, dot('Pxdot'), dot('Txdot'), ...['Palatino', 'Palitalic', 'Pxsans', 'Pxmono', 'Times',
    'Palladio', 'Heros', 'Pagella', 'Termes', 'Cursor', 'Computer'].map(surd)],
  // (in an 11pt document, whose fonts tex4ht magnifies; their weight and
  // shape are checked by visual.mjs)
  'test-surd-11pt': [onlyDots, ...['Plain', 'Italic', 'Bold', 'Bolditalic', 'Smallbold'].map(surd)],
  'test-ts1-symbols': ['Lm', 'Tx', 'Hv'].flatMap(font => ts1Symbols.map(([name, code]) => ts1(font + name, code))),
};
// \textsurd in a TikZ picture and a LaTeX picture, drawn with the font's
// glyph (TS1 slot 187)
const glyphs = {
  'test-surd': [['test-surd0x.svg', /xlink:href='#g\d+-187'/], ['test-surd1x.svg', /xlink:href='#g\d+-187'/]],
  // (a TikZ fill in a color the document defines, after xcolor's reload)
  'test-lateopt-tikz': [['test-lateopt-tikz0x.svg', /fill='#c80064'/]],
  // (a TikZ circle in a document that sets \pdfoutput=1)
  'test-pdfoutput': [['test-pdfoutput0x.svg', /<path d='M14\.22636 0C14\.22636 7\.8571 /]],
  // (the labels over pictures without their .xbb file: P, Q, and y in an
  // overpic, R in a LaTeX picture, S in a TikZ node, and T over a picture
  // with its .xbb file)
  'test-overpic-drawn': [['test-overpic-drawn0x.svg', /xlink:href='#g\d+-80'/], ['test-overpic-drawn0x.svg', /xlink:href='#g\d+-81'/],
    ['test-overpic-drawn0x.svg', /xlink:href='#g\d+-121'/], ['test-overpic-drawn1x.svg', /xlink:href='#g\d+-82'/],
    ['test-overpic-drawn2x.svg', /xlink:href='#g\d+-83'/], ['test-overpic-drawn3x.svg', /xlink:href='#g\d+-84'/]],
};

// Colors in dark mode: a light-dark() of the color at another lightness,
// and black text in the page's text color. This holds for \textcolor,
// \colorbox, \fcolorbox, listings, math, and \rule. Math and table cells
// have the colors xcolor gives them: a color the document defines (ink), a
// \colorlet (ember), a mix, and green, which is darker in CSS.
const lightDark = (color, property) =>
  `light-dark\\(${color}, oklch\\(from ${color} var\\(--tex8web-dark-${property}\\) c h\\)\\)`;
const dark = hex => `light-dark(${hex}, oklch(from ${hex} var(--tex8web-dark-color) c h))`;
const text = (hex, html) => `<span style='color:${dark(hex)};'>${html}</span>`;
// (\fboxsep and \fboxrule, in a box's style attribute)
const fbox = "style='--tex8web-fboxsep: 0.3em; --tex8web-fboxrule: 0.04em'";
// (the lengths in a list's style attribute, before its color)
const list = '--tex8web-list-topsep: 0.8em; --tex8web-list-itemsep: 0.8em; --tex8web-list-indent: 2.5em; --tex8web-list-labelsep: 0.5em; ';
// (test-lateopt-body.ltx: \rowcolor, \cellcolor, \rowcolors, and
// \textcolor, then graphicx's picture and enumitem's labels, which load
// after xcolor's reload, and the class of a list made with \newlist, which
// only enumitem-hooks.4ht gives)
const lateopt = [
  ...[['1-1- td', 'F4CCE0'], ['1-2-1', 'BFFFBF'], ['2-1-', 'FFE5E5'], ['2-2-', 'E5E5FF']].map(([selector, hex]) =>
    new RegExp(`#TBL-${selector}\\{ background-color:${lightDark(`#${hex}`, 'background')}\\}`)),
  new RegExp(`<span style='color:${lightDark('#C80064', 'color')};'>d</span>`),
  /<img alt='picture' src='test-picture\.png' /,
  /<span class='tex8web-label'>\s*\(a\)\s*<\/span>[^]*<span class='tex8web-label'>\s*\(b\)\s*<\/span>/,
  /<ol class='tex8web-list enumitem-steps' [^>]*><li><span class='tex8web-label'>\s*1\.\s*<\/span><div>\s*<p class='noindent'>Step\./,
];
// (fancyvrb's inline saved text: the block before it keeps no color, and
// the block that sets frame=none no border or padding. With fvextra, the
// text is on yellow, and each red inline text has one red span)
const noBlockColor = /^(?![^]*pre#fancyvrb\d+\s*\{\s*(?:color|background-color|border-color):)/;
const colors = {
  'test-useverb-frame': [noBlockColor, /^(?![^]*pre#fancyvrb\d+\s*\{\s*border)/,
    /^(?![^]*pre#fancyvrb\d+\s*\{\s*padding:)/,
    /Inner <code class='verb'><span style='color:light-dark\(#FF0000[^']*'>(?:<[^>]*>)*uvf-cmd</],
  'test-useverb-fvextra-color': [noBlockColor, /span#colorbox1\s*\{\s*background-color:light-dark\(#FFFF00/,
    /^(?=(?:(?:(?!color:light-dark\(#FF0000)[^])*color:light-dark\(#FF0000){4}(?![^]*color:light-dark\(#FF0000))/],
  'test-color': [
    new RegExp(`<span style='color:${lightDark('#000080', 'color')};'>navy</span>`),
    /<span style='color:var\(--tex8web-text\);'>black<\/span>/,
    new RegExp(`#colorbox1\\{background-color:${lightDark('#FFFFB2', 'background')};\\}`),
    new RegExp(`#colorbox2\\{border: solid var\\(--tex8web-fboxrule\\) ${lightDark('#0000FF', 'border')};\\}`),
    new RegExp(`<mjx-mstyle style='color: ${lightDark('red', 'color')};'>`),
    /<mjx-mstyle style='color: var\(--tex8web-text\);'>/,
    new RegExp(`<mjx-mpadded style='background-color: ${lightDark('yellow', 'background')};'>`),
    new RegExp(`<mjx-mpadded [^>]*style='border: \\S+ solid ${lightDark('blue', 'border')};`),
    /<mjx-mspace style='background-color: var\(--tex8web-text\);/,
    // (ink, red!50!black, green, ember, red!50!yellow in a macro)
    ...['#c80064', '#800000', '#00ff00', '#640032', '#ff8000'].map(hex =>
      new RegExp(`<mjx-mstyle style='color: ${lightDark(hex, 'color')};'>`)),
    // (gray!50, ink!50!yellow!50, -ink, -red!50!black; Apricot, Blue!50, Azure3; HTML, cmyk, Gray;
    // in CMYK as xcolor has them: olive!50, BrickRed!30, Mahogany!40!Goldenrod (svgnames' rgb one),
    // -BrickRed!40; BrickRed given to a macro)
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
  // \color as a declaration: spans end with its group, a block wholly in the
  // color is colored itself, and no span stays open past an element tex4ht
  // closes. The theorem's head is not colored, as in the PDF. A footnote, a
  // link (urlcolor), and a box keep their colors. The author, with \and, \\,
  // and \thanks, is in article's tabular.
  'test-declared': [
    `<h1 class='titleHead'>${text('#0000FF', 'Colors')}<span class='thank-mark'>`,
    `<div class='author'>${text('#FF0000', "<span class='cmr-12'>Someone</span>")} <br class='and' />`,
    `Heading ${text('#0000FF', 'in blue')}</h3>`,
    `A ${text('#FF0000', 'red')} word, ${text('#000080', 'a mix')}, ${text('#008000', 'a model')} and `
      + `${text('#0A7828', `leaf ${text('#FF0000', 'red')} leaf`)}. `
      + `${text('#FF0000', "Red, <span style='color:var(--tex8web-text);'>black,</span> red")}, `
      + `<span class='colorbox' id='colorbox1' ${fbox}>boxed</span>, `
      + `<span class='colorbox' id='colorbox2' ${fbox}>${text('#FF0000', 'red boxed')}</span>,\n`
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
    // (a block's inner color over its outer one; a color set at a box's
    // start, whose group tex4ht ends after the box; a theorem and minipages
    // wholly in a color; a float, which LaTeX sets in the text color; a box
    // copied after its group ended, which colors nothing after it; a color
    // never closed, which leaves the footnotes in the text color, as LaTeX's
    // \@makecol does, and colors the abstract, which test:visual also checks)
    `<p class='indent' style='color:${dark('#FF0000')};'>   Red. </p>\n     <ul class='tex8web-list itemize' role='list' style='${list}color:${dark('#0000FF')};'>`,
    `<div class='newtheorem' style='color:${dark('#FF0000')}; margin-top:`,
    `<p class='noindent' style='color:${dark('#FF0000')};'>Red from the box’s start.</p>`,
    `<div class='tex8web-minipages'><div class='minipage tex8web-minipage-c' style='--tex8web-share: 0.4; color:${dark('#FF0000')};'>`,
    `<figure class='figure' id='x1-10051'>`,
    `<p class='indent'>   Black at the end, and a note in a table:`,
    `<p class='indent' style='color:${dark('#FF00FF')};'>   Magenta to the end.\n</p>\n   <section class='abstract' role='doc-abstract' style='color:${dark('#FF00FF')};'>`,
    `</section>\n   <div class='footnotes'>`,
  ].map(html => new RegExp(html.replace(/\s+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).concat(/<head>\s*<title>Colors<\/title>/),
  // (xcolor without colortbl, whose extension would load MathJax's color
  // extension with it: a color the document defines, a \colorlet, a model)
  'test-color-math': ['#c80064', '#00ff00', '#3366cc'].map(hex =>
    new RegExp(`<mjx-mstyle style='color: ${lightDark(hex, 'color')};'>`)),
  // (a color whose name has a space, and a color defined after it)
  'test-color-space': ['#cc3300', '#336699'].map(hex =>
    new RegExp(`<mjx-mstyle style='color: ${lightDark(hex, 'color')};'>`)),
  // Table colors as in the PDF: \rowcolors' alternating rows, from the row
  // it starts at, then \columncolor, \rowcolor[HTML], \cellcolor, and a
  // \rowcolor on a \multicolumn's row. The document loads colortbl before
  // xcolor's table option, which fails the build without the fix.
  'test-colortbl': [
    // (\rowcolors' colors on the rows, under the cells' colors)
    ...[['1-1-', 'FFE5E5'], ['1-2-', 'E5E5FF'], ['1-3-', 'FFE5E5'], ['2-2-', 'E5FFE5'], ['2-4-', 'E5FFE5'],
      ['6-1-', 'FFE5E5'], ['6-2-', 'E5E5FF'], ['4-1- td', 'DDEEFF'], ['5-2- td', 'BFFFBF'], ['6-2- td', '00FF00'],
      ['3-1-1', 'CCFFCC'], ['3-2-1', 'CCFFCC'], ['4-2-1', 'F1BFD8'], ['5-1-1', 'F1BFD8'], ['6-1-2', 'FFFF00']]
      .map(([selector, hex]) =>
        new RegExp(`#TBL-${selector}\\{ background-color:${lightDark(`#${hex}`, 'background')}\\}`)),
    // (\rowcolors{2}{}{...} leaves the first row and every odd one without)
    /^(?![^]*#TBL-2-(?:1|3|5)-\{)/,
  ],
  // xcolor's table option asked for on a reload, which loads colortbl
  // inside the reload: after xcolor, after TikZ, with color names on both
  // loads and hyperref between, after colortbl and xcolor, twice, after a
  // class that loads xcolor, and from a package, and after xcolor loaded
  // before \documentclass. A package with key options asked for again with
  // a key that requires graphicx, by its name and by a path.
  // test-lateopt-once passes the option before one load.
  ...Object.fromEntries(['xcolor', 'tikz', 'colortbl', 'twice', 'class', 'early', 'keys', 'path', 'once']
    .map(name => [`test-lateopt-${name}`, lateopt])),
  // (the package's own key, processed after xcolor's reload and graphicx)
  'test-lateopt-sty': [...lateopt, /<p class='noindent'>wide option\./],
  // (xcolor asked for again with dvipsnames, which loads no package)
  'test-lateopt-dvips': [...lateopt, new RegExp(`<span style='color:${lightDark('#0FE3FF', 'color')};'>sky</span>`)],
  // (Cerulean from dvipsnames, Crimson from svgnames, and ForestGreen,
  // which both define, from svgnames, read last)
  'test-lateopt-names': [...lateopt, ...[['#0FE3FF', 'sky'], ['#DC143C', 'crimson'], ['#228B22', 'forest']]
    .map(([hex, word]) => new RegExp(`<span style='color:${lightDark(hex, 'color')};'>${word}</span>`)),
    /<a href='https:\/\/example\.com\/'>link<\/a>/],
};

// Lists as LaTeX sets them: each label as TeX typesets it (article's bullet
// and dash, an \item's optional label, enumerate's (a)), and each list with
// its lengths. Screen readers skip itemize's bullets, which say nothing, and
// read every other label. role='list' keeps VoiceOver reading a list whose
// items show no marker. Also a citation in biblatex's form, a link within
// the page without the file name, and the bibliography's heading once in the
// table of contents, where the document adds it.
const item = (label, hidden) => `<li><span ${hidden ? "aria-hidden='true' " : ''}class='tex8web-label'>\\s*${label}\\s*<\\/span><div>\\s*<p class='noindent'>`;
const lists = {
  'test-article': [
    new RegExp(`<ul class='tex8web-list itemize' role='list' style='--tex8web-list-topsep: 0\\.8em; --tex8web-list-itemsep: 0\\.8em; --tex8web-list-indent: 2\\.5em; --tex8web-list-labelsep: 0\\.5em'>${item('•', true)}One,`),
    new RegExp(`<ul class='tex8web-list itemize' role='list' style='[^']*--tex8web-list-indent: 2\\.2em;[^']*'>${item("<span class='[^']+'>–<\\/span>", true)}inside\\.`),
    new RegExp(`${item("<mjx-container aria-label='star'[^]*?")}A label of its own\\.`),
    new RegExp(`<ol class='tex8web-list enumerate' role='list' [^>]*>${item('1\\.')}First,`),
    new RegExp(`${item('\\(a\\)')}inside\\.`),
    // (an \item's optional label, read although a list follows at once)
    new RegExp(`${item('Case 1')}\\s*<\\/p>\\s*<ul`),
  ],
  // (an item's paragraphs, kept separate; a list of enumitem's description
  // type as a <dl>, whose terms are read)
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

// Each bibliography spaced as its list sets it where the list opens: \itemsep
// plus \parsep between entries, and \labelsep after the label, read before
// the class's \@openbib@code, to which tex4ht adds \labelsep\z@
// (article.4ht), or biblatex's \biblabelsep. The list is html5.4ht's or
// biblatex.4ht's.
const bibliography = (sep, labelsep, attributes = '') =>
  new RegExp(`<dl${attributes} style='--tex8web-bibitem-sep: ${sep.replace('.', '\\.')}; --tex8web-biblabelsep: ${labelsep.replace('.', '\\.')}'>`);
const hanging = (sep, hang, attributes, indent = `-${hang}`) => new RegExp(`<dl${attributes} style='--tex8web-bibitem-sep: ${sep.replace('.', '\\.')}; `
  + `--tex8web-bibhang: ${hang.replace('.', '\\.')}; --tex8web-bibitemindent: ${indent.replace('.', '\\.')}'>`);
const bibliographies = {
  // (article's \itemsep of 4pt and \parsep of 4pt)
  'test-article': [bibliography('0.8em', '0.5em')],
  // (an 11pt document's list: 4.5pt and 4.5pt, over 10.95pt)
  'test': [bibliography('0.82191em', '0.5em')],
  // (natbib's \bibsep of 0pt, and no \parsep, in place of the list's, set
  // in the preamble or in a group around the bibliography)
  'test-natbib': [bibliography('0em', '0.5em')],
  'test-natbib-group': [bibliography('0em', '0.5em')],
  // (memoir's \bibitemsep of 6pt, plus the list's \parsep, a third of a
  // 12pt line)
  'test-memoir': [bibliography('0.99995em', '0.5em')],
  // (memoir's openbib: the \bibitemsep of 6pt, set in the body, and no
  // \parsep)
  'test-openbib': [bibliography('0.6em', '0.5em')],
  // (biblatex's \bibitemsep, the list's \itemsep of 4pt, its \bibparsep of
  // 0pt, and its \biblabelsep, twice \labelsep)
  'examples/complex': [bibliography('0.4em', '1em', " class='thebibliography'")],
  // (author-year lists, whose \itemindent is -\leftmargin, with \leftmargin
  // and \itemindent in place of the label space: natbib's \bibsep, the
  // list's \itemsep plus \parsep at load, and its \bibhang of 1em, and
  // biblatex's \bibhang, article's \parindent of 15pt. A \bibhang of 0pt
  // leaves no room for a label too)
  'test-natbib-authoryear': [hanging('0.8em', '1em', " class='tex8web-bibhang'"),
    hanging('0.8em', '0em', " class='tex8web-bibhang'", '0em')],
  'test-biblatex-authoryear': [hanging('0em', '1.5em', " class='thebibliography tex8web-bibhang'")],
};

// pdfTeX's primitives that are an error in DVI mode: the text around each
// as the PDF shows it, with any tags at its spaces and at each |, and no
// argument or name of a primitive anywhere in the page, in the math, or in
// its macros.
const pdfprimText = text => new RegExp(text.replace(/[.*+?^${}()[\]\\]/g, '\\$&')
  .replace(/ /g, '(?:<[^>]*>)* (?:<[^>]*>)*').replace(/\|/g, '(?:<[^>]*>)*'));
const pdfprimHead = (tag, text) => new RegExp(`<${tag} class='sectionHead'[^>]*>(?:(?!</${tag}>)[^])*${pdfprimText(text).source}(?:<[^>]*>|\\s)*</${tag}>`);
const pdfprimToc = text => new RegExp(`<span class='sectionToc'>(?:(?!</a>)[^])*${pdfprimText(text).source}(?:<[^>]*>)*</a>`);
const pdfprimLeaks = /^(?![^]*(?:\d rg\b|foo\.map|bar\.pfb|pkg\.map|before-class\.pfb|\/Subtype|\/Border|\/Foo 1|\/[XY] [12]\b|&lt;&lt;|\bq Q\b|Outline title|first\.map|cls\.map|0 1 -1 0|1 0 0 1|\b0 g\b|cmr10|\/Foo \[1 2\]|\/Preamble 1|\/Title|\/PageMode|\/Info|\/Rotate|pdf(?:literal|mapfile|mapline|setmatrix|save|restore|ximage|refximage|obj|refobj|xform|refxform|startlink|endlink|annot|dest|outline|thread|startthread|endthread|names|fontattr|snap|interwordspace|fakespace|spacefont|colorstack|runninglink|includechars|nobuiltintounicode|last(?:obj|ximage|xform))(?![a-z])))/;
// (the same through \pdfprimitive and its copies: no argument, no name of
// a primitive or of a copy, and no macro of tex8web's, in the page's text,
// its math, or its macros. A heading's anchor, in an attribute, is left out)
const pdfprimitiveLeaks = /^(?![^]*(?<!='[^'<>]*)(?:\b0 g\b|0 0 1 rg|foo\.map|bar\.map|first\.map|picture\.png|\/A 1|&lt;&lt;|myprim|(?<!test-)pdf(?:primitive|literal|mapline|mapfile|save|restore|xform|refxform|lastxform|xformname|startlink|endlink|obj|ximage|refximage|lastximage|ximagebbox|colorstack|dest)(?![a-z])|@primitive|tex_primitive|web@))/;

// Packages given pdfTeX's driver option, which tex4ht's DVI mode cannot
// use: each package's output as without the option. test-pdftex gives it to
// each package, test-pdftex-class to the class, and test-pdftex-sty through
// a local package.
const pdftexText = (hex, text) => new RegExp(`<span style='color:${lightDark(hex, 'color')};'>${text}</span>`);
const pdftexLinks = id => [new RegExp(`A link to section<span class='tex8web-nbsp'> </span><a href='#${id}'>1<!--`),
  /and to <a href='https:\/\/example\.com\/'>a site<\/a>/];
const drivers = {
  'test-pdftex': [
    // (xcolor's dvipsnames, with pdftex from \PassOptionsToPackage, in a heading)
    new RegExp(`Colors in <span style='color:${lightDark('#00E000', 'color')};'>green</span></h3>`),
    pdftexText('#FF0000', 'red'),
    ...pdftexLinks('colors-in-forestgreengreen'),
    // (a reference in a footnote)
    /A note with a link to section<span class='tex8web-nbsp'> <\/span><\/span><a href='#colors-in-forestgreengreen'><span class='cmr-8'>1<\/span>/,
    // (graphicx and epsfig, as wide as in the PDF with geometry's text width)
    /<img alt='wide picture' src='test-picture\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.1323\)' \/>\. After the picture\./,
    /<img alt='' src='test-picture\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.0662\)' \/>\. After epsfig\./,
    /Rotated: <span class='rotatebox' style='transform: rotate\(-90deg\);'> up <\/span>\. After the rotation\./,
    // (colortbl's \rowcolor)
    new RegExp(`#TBL-1-1- td\\{ background-color:${lightDark('#FFFF00', 'background')}\\}`),
    // (pict2e's drawing)
    /<img alt='PICT' src='test-pdftex0x\.png' \/> After the drawing\./,
  ],
  'test-pdftex-class': [
    // (ForestGreen from the class's dvipsnames)
    pdftexText('#FF0000', 'red'), pdftexText('#00E000', 'forest'),
    ...pdftexLinks('colors'),
    /<img alt='wide picture' src='test-picture\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.1649\)' \/>\. After the picture\./,
    /<img alt='PICT' src='test-pdftex-class0x\.png' \/> After the drawing\./,
  ],
  // (lscape loading graphics first, xcolor's option beside name options,
  // and graphicx loaded again with the option)
  'test-pdftex-sty': [
    pdftexText('#FF0000', 'red'), pdftexText('#00E000', 'forest'),
    ...pdftexLinks('colors'),
    /<img alt='wide picture' src='test-picture\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.1649\)' \/>\. After the picture\./,
    /Rotated: <span class='rotatebox' style='transform: rotate\(-90deg\);'> up <\/span>\. After the rotation\./,
  ],
  // changebar and trimclip given the option: each one's text as with its
  // default driver, where changebar shows no bars. test-pdftex-changebar
  // gives it to changebar, test-pdftex-changebar-class to the class and
  // with \PassOptionsToPackage, test-pdftex-changebar-caps as PDFTeX,
  // test-pdftex-changebar-color beside changebar's other options and as
  // PDFTeX to the class, test-pdftex-adjustbox to adjustbox, which passes
  // it to graphicx and trimclip, test-pdftex-trimclip to trimclip after
  // graphicx, and test-pdftex-trimclip-first to trimclip before graphicx.
  // changebar's error leaves its text as with its default driver, so the
  // error itself is caught in the TeX log, and these rows check that the
  // text stays. trimclip's dvips driver leaves a space where a clip trims
  // the box's right side, as without the option, and texWarnings checks
  // that no other clipping driver was read. test-pdftex-passon is a guard.
  'test-pdftex-changebar': [
    /Before the bar\. Inside the bar, with <span class='cmti-10'>italic<\/span>, <span class='cmss-10'>sans<\/span>, and <span class='cmtt-10'>typewriter <\/span>text\. After the bar\./,
    // (the environment, with a link)
    /In the environment, with a link to section<span class='tex8web-nbsp'> <\/span><a href='#changes'>1<!--[^>]*--><\/a>\. After the environment\./,
    /Deleted here\. After the deletion\./,
    /<span class='cmr-8'>Note in a bar\. After the note’s bar\.<\/span><\/p><\/aside>/,
    /<span class='cmti-10'>A theorem in a bar\. After the theorem’s bar\.<\/span>/,
    /<p class='noindent'>First item in a bar\.\s*<\/p><\/div><\/li>/,
    /Second item\.<\/p><\/div><\/li><\/ul>\s*<p class='noindent'>After the list\./,
  ],
  'test-pdftex-changebar-class': [/<p class='noindent'>Before the bar\. Inside the class’s bar\. After the bar\./],
  'test-pdftex-changebar-caps': [/<p class='noindent'>Before the bar\. Inside the capitals’ bar\. After the bar\./],
  // (without the color option, \cbcolor writes a warning and ignores its
  // argument, so the text is the same; texWarnings checks that the
  // warning is absent)
  'test-pdftex-changebar-color': [/<p class='noindent'>Before the bar\. Red bar\. After the red bar\./],
  'test-pdftex-adjustbox': [
    /<p class='noindent'>Clip: clipped text \. After the clip\./,
    /Adjust: adjusted text\. After the adjustment\./,
    /Trim: trimmed text\. After the trim\./,
    /<span class='cmr-8'>Note: noted clip\. After the note’s clip\.<\/span>/,
    /<span class='cmti-10'>Theorem: theorem trim\. See section<span class='tex8web-nbsp'> <\/span><\/span><a href='#boxes'>/,
    // (pictures trimmed and clipped by \includegraphics and by \adjustbox)
    /Picture: <img alt='' src='test-picture\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.0825\)' \/>\. After the picture\./,
    /Boxed picture: <img alt='' src='test-picture\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.0825\)' \/>\. After the boxed picture\./,
  ],
  'test-pdftex-trimclip-first': [
    /<p class='noindent'>Clip: clipped text \. After the clip\./,
    /Picture: <img alt='' src='test-picture\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.0825\)' \/>\. After the picture\./,
  ],
  'test-pdftex-trimclip': [
    /<p class='noindent'>Clip: clipped text\. After the clip\./,
    /Trim: trimmed text\. After the trim\./,
  ],
  'test-pdftex-passon': [
    /Rotated: <span class='rotatebox' style='transform: rotate\(-90deg\);'> up <\/span>\. After the rotation\./,
    /<img alt='' src='test-picture\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.\d+\)' \/>\. After epsfig\./,
    pdftexText('#FF0000', 'red'),
    new RegExp(`#TBL-1-1- td\\{ background-color:${lightDark('#FFFF00', 'background')}\\}`),
  ],
  // \pdfoutput=1, which makes tex4ht's latex write a PDF and no DVI: each
  // package's output as without it. test-pdfoutput sets it before the
  // class, test-pdfoutput-late after it and in the body, and
  // test-pdfoutput-sty in the class and in the last package. \ifpdf takes
  // the DVI branch.
  'test-pdfoutput': [
    new RegExp(`Colors in <span style='color:${lightDark('#0000FF', 'color')};'>blue</span></h3>`),
    pdftexText('#FF0000', 'red'),
    // (in italic, sans-serif, and typewriter text)
    ...[['cmti-10', 'italic'], ['cmss-10', 'sans'], ['cmtt-10', 'typewriter']].map(([font, text]) => new RegExp(`<span style='color:${lightDark('#FF0000', 'color')};'><span class='${font}'>${text}`)),
    ...pdftexLinks('colors-in-blueblue'),
    /A note with a link to section<span class='tex8web-nbsp'> <\/span><\/span><a href='#colors-in-blueblue'><span class='cmr-8'>1<\/span>/,
    /<img alt='wide picture' src='test-picture\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.1649\)' \/>\. After the picture\./,
    // (a PDF named without its extension, and a TikZ picture, whose path
    // is checked below)
    /<img alt='pdf bare' src='test-pdfpic\/box\.pdf-1\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.1649\)' \/>\. After the bare name\./,
    /TikZ: <img alt='' src='test-pdfoutput0x\.svg' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.0836\)' \/> After the TikZ picture\./,
    /Math: <span class='tex8web-nowrap'><mjx-container/,
    // (in a theorem)
    new RegExp(`Theorem 1\\.</span> </span><span class='cmti-10'>A theorem in </span><span style='color:${lightDark('#FF0000', 'color')};'>`),
    /with a link to section<span class='tex8web-nbsp'> <\/span><\/span><a href='#colors-in-blueblue'><span class='cmti-10'>1<\/span>/,
    /Preamble: DVI branch\. Body: DVI branch\./,
    // (\ifnum\pdfoutput>0, in the preamble and in the body)
    /Raw: DVI, DVI\./,
  ],
  'test-pdfoutput-late': [
    pdftexText('#FF0000', 'red'),
    ...pdftexLinks('colors'),
    /<img alt='wide picture' src='test-picture\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.1649\)' \/>\. After the picture\./,
    /Rotated: <span class='rotatebox' style='transform: rotate\(-90deg\);'> up <\/span>\. After the rotation\./,
    // (pict2e's drawing, which stops the build with pict2e's pdftex driver)
    /<img alt='PICT' src='test-pdfoutput-late0x\.png' \/> After the drawing\./,
    /Branch: DVI branch\./,
  ],
  'test-pdfoutput-sty': [
    pdftexText('#FF0000', 'red'), pdftexText('#00E000', 'forest'),
    ...pdftexLinks('colors'),
    /<img alt='wide picture' src='test-picture\.png' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.1649\)' \/>\. After the picture\./,
    // (the kernel's backend, which \begin{document} loads)
    /Backend: dvips\./,
  ],
  // (the image, the form, the rotation, and the colors are left out, where
  // the PDF shows them. A keyword that ends a primitive takes the space
  // after it, as \pdfdest's fit and \pdfsnapycomp's number do in the PDF)
  'test-pdfprim': [
    pdfprimHead('h3', 'Head x y z w'), pdfprimToc('Head x y z w'),
    ...['Literal: before blue after.', 'Let: before after.', 'Macro: before one after.',
      'Italic: before two after|.', 'Sans: before three after|.', 'Typewriter: before four after|.',
      'Package: before five after.', 'Footnote: before|1 after.', '1|Note six end.',
      'Theorem 1. Theorem seven end.', 'Box: boxed after.',
      'Image: before after.', 'Image keywords: before after.',
      'Objects: before after. Number: set.', 'Stream: before after.',
      'Stack: beforepushed and set after.', 'Link: beforelinked after.', 'Goto: beforeto here after.',
      'Destination: beforeafter.', 'Number destination: beforeafter.',
      'Annotation: before after.', 'Outline: before after.', 'Thread: before after.',
      'Snap: beforeafter.', 'Spaces: before after.', 'Stack macro: beforered after.',
      'Keywords: beforexyz after.',
      'Outline user: before after.', 'Goto page: see page 3.', 'Goto space: xlinked after.', 'User link: x linked after.',
      'Goto file: beforelinked after.', 'Destination relax: beforedepth after.',
      'Expanded: beforeafter.', 'Image macro: before after.',
      'Uppercase: before after.', 'Struct: xlinked after.', 'Font: before after.',
      'Reserve: xafter and xlinked after.', 'Reserve macro: xafter.', 'Protected: xafter.',
      'Primitive after: beforeafter.',
      // (the primitives that only warn in DVI mode)
      `Guards: ${['info', 'catalog', 'trailer', 'trailerid', 'pageattr', 'pagesattr', 'pageresources',
        'compresslevel', 'minorversion', 'gentounicode', 'glyphtounicode', 'colorstackinit']
        .map(name => `pdf${name} primitive`).join(', ')}.`].map(pdfprimText),
    /Form: before(?:<[^>]*>)*(?:form)?(?:<[^>]*>)* after\./,
    /Matrix: before(?:<[^>]*>|\s)*turned(?:<[^>]*>)* after\./,
    /Math: before <mjx-container aria-label='a b c'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Package math: before <mjx-container aria-label='a b c'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Direct math: before <mjx-container aria-label='a b c'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Factor math: before <mjx-container aria-label='a b c'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Upper math: before <mjx-container aria-label='a b c'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Let math: before <mjx-container aria-label='a b'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Snap math: before <mjx-container aria-label='a b'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /^(?![^]*(?:plus 2pt|minus 1fil))/,
    /^(?![^]*(?:test-picture|linewidth|User title|example\.com|newwindow))/,
    /<p[^>]*>\s*Started thread\./,
    /First\.(?:\s|<\/p>|<!--(?:(?!-->)[^])*-->)*<p[^>]*>(?:\s|<!--(?:(?!-->)[^])*-->)*Second\./,
    pdfprimLeaks,
  ],
  // (in a heading that goes to hyperref's bookmarks, and in a caption that
  // goes to the list of figures)
  'test-pdfprim-hyperref': [
    pdfprimHead('h3', 'Head x y z'), pdfprimToc('Head x y z'),
    new RegExp(`<span class='lofToc'>(?:(?!</a>)[^])*${pdfprimText('Caption seven end').source}`),
    new RegExp(`class='caption'(?:(?!</(?:figcaption|div)>)[^])*${pdfprimText('Caption seven end').source}`),
    ...['Literal: before blue after, a link to section', 'Image: before after.',
      'Objects: before after. Number: set.', 'Link: beforeto the head after.',
      'Stack: beforepushed after.', 'Footnote: before|1 after.', '1|Note six end', 'Title: before after.'].map(pdfprimText),
    pdfprimLeaks,
  ],
  // (a form's name, read after \pdfxform, is the form's number, as in the
  // PDF, and an image's bounding box is zero. A digit after the number
  // stays, as in the PDF)
  'test-pdfxformname': [
    pdfprimHead('h3', 'Form name [1] end'), pdfprimToc('Form name [1] end'),
    ...['Details: [1] end.', 'Edef: [1] end.', 'Text: [1] end.', 'Italic: |a[1]b end|.', 'Sans: |c[1]d end|.',
      'Typewriter: |e[1]f end|.', 'Footnote: before|1 after.', '1|Note [1] end.', 'Theorem 1. Theorem [1] end.',
      'Count: [2] end.', 'Explicit: [1] end.', 'Macro: [1] end.', 'Digit: [25] end.', 'Space digit: [15] end.',
      'Relax: [2] end.', 'Special: before after.', 'Bbox: [0.0pt] end.', 'Strip: [0] end.', 'Bbox dimen: [0.0pt] end.', 'Bbox count: [0.0pt] end.',
      'Meaning: |macro:-&gt;1| end.', 'Csname: [named] end.', 'Relax meaning: |macro:-&gt;[2\\relax ]| end.',
      'Bbox width: [0.0pt] end.'].map(pdfprimText),
    /^(?![^]*(?:(?<!test-)pdfxformname|pdfximagebbox|lastximage|\/Foo 1|\/Bar 2|test-picture))/,
    pdfprimLeaks,
  ],
  'test-pdfxformname-guard': [
    pdfprimText('Literal: before after.'),
    /^(?![^]*(?<!test-)pdfxformname)/,
    pdfprimLeaks,
  ],
  // (the primitives reached through \pdfprimitive, \pdf@primitive, and
  // \tex_primitive:D, as above. A form shown by \pdfrefxform is lost, as
  // above. The primitives that DVI mode allows stay primitives)
  'test-pdfprimitive': [
    pdfprimHead('h3', 'Head x end'), pdfprimToc('Head x end'),
    pdfprimHead('h3', 'Form [3] end'), pdfprimToc('Form [3] end'),
    ...['Details: beforeafter.', 'Literal: before after.', 'Italic: before after|.', 'Sans: before after|.',
      'Typewriter: before after|.', 'Footnote: before|1 after.', '1|Note six end.',
      'Theorem 1. Theorem seven end.', 'Macro: before one after.', 'Name: [2] end.', 'Csname: before after.',
      'Mine: [mine x] and before after.', 'Pdftexcmds: before after.', 'Expl: before after.',
      'Immediate: beforeafter.', 'Image: before after.',
      'Stack: beforepushed after.', 'Destination: beforeafter.', 'Bbox: [0.0pt].', 'Direct: before after.',
      'Edef literal: beforeafter.'].map(pdfprimText),
    /Chain: before(?:<[^>]*>)*y?(?:<[^>]*>)* after\./,
    /Math: before <mjx-container aria-label='a b'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Macro math: before <mjx-container aria-label='a b'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Blue math: before <mjx-container aria-label='a b c'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Hbox math: before <mjx-container aria-label='a b c'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Page math: before <mjx-container aria-label='a b'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Copy math: before <mjx-container aria-label='a b'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /Let math: before <mjx-container aria-label='a b'(?:(?!<\/p>)[^])*<\/mjx-container>(?:<[^>]*>)* after\./,
    /<span class='sectionToc'>(?:(?!<\/a>)[^])*>Math <mjx-container aria-label='a b'/,
    /<span class='lofToc'>(?:(?!<\/a>)[^])*>Figure <mjx-container aria-label='c d'/,
    // (each index entry, which makeindex reads from the .idx: an entry with
    // an @ that is not makeindex's own is lost)
    /<div class='index-item'>eta, <a href='#[^']+'>2<\/a> <\/div>(?:(?!<div class='index-item')[^])*<div class='index-item'>zeta, <a href='#[^']+'>1<\/a> <\/div>/,
    pdfprimitiveLeaks,
  ],
  'test-pdfprimitive-hyperref': [
    pdfprimHead('h3', 'Head x end'), pdfprimToc('Head x end'),
    ...['Literal: before after, a link to section', 'Footnote: before|1 after.', '1|Note six end',
      'Pdftexcmds: before after.', 'Expl: before after.', 'Link: beforeto the head after.'].map(pdfprimText),
    pdfprimitiveLeaks,
  ],
  'test-pdfprimitive-guard': [
    ...['Strcmp: [same].', 'Edef: [-1].', 'Hbox: [y].', 'Copy: [same].', 'Copy edef: [1].', 'Copy hbox: [z].',
      'Command: [-1] [41].', 'Expl: [same].', 'Expl edef: [-1].'].map(pdfprimText),
    pdfprimitiveLeaks,
  ],
  // (expl3's copies, \tex_pdf<name>:D, as the primitives above. The copies
  // of the primitives that only warn in DVI mode stay primitives)
  'test-explprim': [
    pdfprimHead('h3', 'Head x end'), pdfprimToc('Head x end'),
    pdfprimHead('h3', 'Name [2] end'), pdfprimToc('Name [2] end'),
    ...['Details: before after.', 'Name: [2] end.', 'Meaning: |macro:-&gt;2| end.', 'Bbox: [0.0pt] end.',
      'Literal: before one after.', 'Italic: before two after|.', 'Sans: before three after|.',
      'Typewriter: before four after|.', 'Copy: before five after.', 'Footnote: before|1 after.',
      '1|Note six end.', 'Theorem 1. Theorem seven end.', 'Box: boxed after.',
      'Stack: beforepushed after.', 'Link: beforelinked after.', 'Image: before after.',
      'Objects: before after.', 'Use: before after.', 'Annotation: before after.', 'Destination: before after.',
      'Outline: before after.', 'Thread: before after.', 'Spaces: before after.',
      `Guards: ${['info', 'catalog', 'trailer', 'compresslevel', 'minorversion',
        'lastximage', 'lastobj', 'colorstackinit', 'trailerid', 'pageattr', 'pagesattr', 'pageresources',
        'gentounicode', 'glyphtounicode'].map(name => `${name} primitive`).join(', ')}.`].map(pdfprimText),
    /Form: before(?:<[^>]*>)*(?:form)?(?:<[^>]*>)* after\./,
    /Matrix: before(?:<[^>]*>|\s)*turned(?:<[^>]*>)* after\./,
    /<p[^>]*>\s*Started thread\./,
    /^(?![^]*(?:tex_|:D\b|test-picture|\/Text|\breserveobjnum|\buseobjnum|\bcount 0))/,
    /First\.(?:\s|<\/p>|<!--(?:(?!-->)[^])*-->)*<p[^>]*>(?:\s|<!--(?:(?!-->)[^])*-->)*Second\./,
    pdfprimLeaks,
  ],
  'test-explprim-hyperref': [
    pdfprimHead('h3', 'Head x end'), pdfprimToc('Head x end'),
    pdfprimHead('h3', 'Name [1] end'), pdfprimToc('Name [1] end'),
    ...['Literal: before one after, a link to section', 'Link: beforeto the head after.',
      'Stack: beforepushed after.', 'Footnote: before|1 after.', '1|Note six end'].map(pdfprimText),
    /^(?![^]*(?:tex_|:D\b))/,
    pdfprimLeaks,
  ],
  // (a form's name used as a number is the form's number, as in the PDF.
  // The fixture uses it assigned to a count register, in a \numexpr, after
  // \number, \ifnum, \ifcase, and \romannumeral, and in the text, for the
  // first, second, and third form and one made in a group. \pdflastxform
  // is a number, so a digit after it is typeset. It is the form's number
  // at Object, where the PDF has the object number, 7)
  'test-xformnum': [
    pdfprimHead('h3', 'Head 1 and 2 end'), pdfprimToc('Head 1 and 2 end'),
    ...['Count: [1] end.', 'Advance: [16] end.', 'Setcounter: [1] end.', 'Numexpr: [13] end.', 'Number: [1] end.',
      'Ifnum: [pos] end.', 'Ifcase: [one] end.', 'Roman: [i] end.', 'Edef: [1] end.', 'Xdef: [1] end.',
      'Csname: [one] end.', 'Text: [1] end.', 'Italic: |a[1]b end|.', 'Sans: |c[first]d end|.',
      'Typewriter: |e[1]f end|.', '1|Note [2] end.',
      'Second: [2] end.', 'Second ifnum: [second] end.', 'Saved count: [1] end.', 'Explicit: [2] end.',
      'Macro: [2] end.', 'Digit: [25] end.', 'Relax: [2] end.', 'After image: [3] end.',
      'Last digit: [51] end.', 'Saved the: [1] end.', 'Object: [3] end.', 'Group: [4] end.'].map(pdfprimText),
    new RegExp(`Theorem 1\\.(?:<[^>]*>|\\s)*${pdfprimText('Theorem [one] end.').source}`),
    /^(?![^]*(?:(?<!test-)pdfxformname|\/Foo 1|\/Bar 2|test-picture))/,
    pdfprimLeaks,
  ],
  // (with hyperref loaded too, after a form made in the preamble)
  'test-xformnum-hyperref': [
    pdfprimHead('h3', 'Head 2 end'), pdfprimToc('Head 2 end'),
    ...['Count: [2] end.', 'Ifnum: [pos] end.', 'Text: [2] end.', 'Preamble: [1] end.'].map(pdfprimText),
    /^(?![^]*(?<!test-)pdfxformname)/,
    pdfprimLeaks,
  ],
};

// Warnings a document's TeX log must not hold. test-pdftex-class's class
// leaves pdfTeX's driver option unused, and xcolor uses the fixture's other
// class option, dvipsnames, so LaTeX warns of no unused global option.
// test-boxmath sets a labelled equation twice, and writes its label once,
// and sets a \qedhere twice, where amsthm can.
const texWarnings = {
  'test-pdftex-class': [/Unused global option/],
  // (PDFTeX, given to the class, is changebar's in pdflatex, and changebar
  // warns that \cbcolor is ignored when its color option is lost. trimclip
  // reads its dvips driver, tc-dvips.def, as without the option)
  'test-pdftex-changebar-color': [/Unused global option/, /You didn't specify the option/],
  'test-pdftex-adjustbox': [/File: tc-(?!dvips)/],
  'test-pdftex-trimclip': [/File: tc-(?!dvips)/],
  'test-pdftex-trimclip-first': [/File: tc-(?!dvips)/],
  'test-boxmath': [/multiply defined/, /qedhere command may not work/],
};

// Lines a document's TeX log must hold, read with its wrapped lines
// joined. xcolor gives a named color its value itself, so a page with
// xcolor is the same whether tex4ht reads dvipsnam.4ht or not.
// dvips.4ht only defines commands that read a color's value.
const texLines = {
  'test-priminput-tree': [/\/dvipsnam\.4ht/],
  'test-priminput-vendored': [/\/dvipsnam\.4ht/],
  'test-priminput-cnt': [/\/dvips\.4ht/],
  'test-ownprim-after': [/\/dvipsnam\.4ht/],
};

// A \url not hyphenated (html4.4ht hyphenates every link. A \url is not
// hyphenated in the PDF, and html4.4ht's overflow-wrap still breaks one too
// long for a line): the stylesheet's rule, and the URLs as links of that class.
// A line may end after url.sty's break characters in a \url, a \nolinkurl,
// and a \path, but not in a scheme or right after its //, after a URL's last
// character, or in a link whose text is prose.
const urls = {
  'test-biburl': [/a\.url[^{]*\{[^}]*hyphens: manual/,
    /<a class='url' href='https:\/\/example\.org\/internationalization\/[^']*'><span class='cmtt-10'>/],
  'test-urlbreaks': [/a\.url, \.path, \.tex8web-nolinkurl \{[^}]*hyphens: manual/,
    /<span class='cmtt-10'>https:\/\/example\.<wbr \/>org\/<wbr \/>reports\/<wbr \/>understandingrepresentationsofcharacterization\/<wbr \/>introduction<\/span><\/a>\./,
    /search\?<wbr \/>query=<wbr \/>representations&amp;<wbr \/>page=<wbr \/>2&amp;<wbr \/>sort=<wbr \/>relevance#<wbr \/>results<\/span>/,
    /<span class='tex8web-nolinkurl'><span class='cmtt-10'>10\.<wbr \/>1000\/<wbr \/>representations\.<wbr \/>characterizations\.<wbr \/>2000\.<wbr \/>123456<\/span><\/span><\/a>/,
    /<span class='path'><span class='cmtt-10'>\/usr\/<wbr \/>local\/<wbr \/>share\/<wbr \/>internationalization\/<wbr \/>documentation\/<wbr \/>representations\/<\/span><\/span>/,
    /<a href='https:\/\/example\.org\/internationalization\/documentation'>the documentation of the representations and their characterizations<\/a>/,
    /<p class='indent'>\s*<span class='tex8web-nolinkurl'><span class='cmtt-10'>10\.<wbr \/>1000/,
    /<span class='path'><span class='cmtt-10'>\.\.<wbr \/>\/src\/<wbr \/>/],
};

// \, and \thinspace in text as a narrow no-break space, where TeX does not
// break: also in italic, in a quantity siunitx sets as text, and kept with
// the math after it. In a picture, the kern, so a node is as wide as in the
// PDF.
const thin = {
  'test-units': [/like 1\.5\u202Fm\. Thin\s+spaces in text: i\.\u202Fe\., <span class='cmti-10'>e\.<\/span>\u202F<span class='cmti-10'>g\.<\/span>, 10\u202F000, 10\u202F000, and p\.<span class='tex8web-nowrap'>\u202F<mjx-container /],
  'test-article': [/<img alt='' src='test-article1x\.svg' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.0966\)' \/>/],
};

// ~ and \, in text next to inline math: the space and the math in one
// span, and after the math, the text up to the next whitespace too. A ~
// is written as a space (tex8web-nbsp).
const math = "<mjx-container(?:(?!</mjx-container>)[^])*</mjx-container>";
const tie = "<span class='tex8web-nbsp'> </span>";
const ties = {
  'test-nowrap': [new RegExp(`value of<span class='tex8web-nowrap'>${tie}${math},</span> keeps`),
    new RegExp(`p\\.<span class='tex8web-nowrap'>\u202F${math}\\.</span> A`),
    new RegExp(`as in <span class='tex8web-nowrap'>${math}${tie}and,</span> <span class='tex8web-nowrap'>${math}\u202Fcm,</span> and\\s+<span class='tex8web-nowrap'>${math}${tie}${math}\\.</span>`),
    new RegExp(`the set of<span class='tex8web-nowrap'>${tie}${math}${tie}elements</span> is <span class='tex8web-nowrap'>${math}${tie}times</span> the`),
    new RegExp(`and <span class='tex8web-nowrap'>${math}\u202Fm<sup class='textsuperscript'><span class='cmr-9'>2</span></sup></span> is`)],
  // letters right after inline math, with no space between ($i$th), kept
  // with the math up to the next whitespace
  'test-mathsuffix': [new RegExp(`the\\s+<span class='tex8web-nowrap'>${math}th</span> row`),
    new RegExp(`the <span class='tex8web-nowrap'>${math}th</span>\\s+and <span class='tex8web-nowrap'>${math}st</span> terms`),
    new RegExp(`of <span class='tex8web-nowrap'>${math}pt\\.</span> So`),
    new RegExp(`the<span class='tex8web-nowrap'>${tie}${math}th</span>\\s+entry`),
    // and in italic or a smaller size, where the letters are in a span of
    // their font after the math
    new RegExp(`<span class='cmti-10'>The </span><span class='tex8web-nowrap'>${math}<span class='cmti-10'>th</span></span><span class='cmti-10'> row is zero\\.</span>`),
    new RegExp(`<span class='cmti-10'>the </span><span class='tex8web-nowrap'>${math}<span class='cmti-10'>th</span></span><span class='cmti-10'> term </span>of`),
    new RegExp(`<span class='cmr-8'>See the </span><span class='tex8web-nowrap'><span class='mathjax-inline'[^>]*>${math}</span><span class='cmr-8'>th</span></span><span class='cmr-8'> entry\\.</span>`),
    // the characters right before and after the math, up to whitespace
    new RegExp(`an <span class='tex8web-nowrap'>${math}-dimensional</span> space, the <span class='tex8web-nowrap'>${math}\u00E8me</span> terme, the vector <span class='tex8web-nowrap'>\\(${math},</span> <span class='tex8web-nowrap'>${math}\\),</span> <span class='tex8web-nowrap'>${math}\u2019s</span> value, the <span class='tex8web-nowrap'>${math}<sup class='textsuperscript'><span class='cmr-9'>th</span></sup></span> power, and <span class='tex8web-nowrap'>${math}\\(${math}\\)</span>\\s+itself\\.`),
    // a ~ in a span of its font, in a theorem or a footnote
    new RegExp(`<span class='cmti-10'>For all</span><span class='tex8web-nowrap'><span class='cmti-10'>${tie}</span>${math}<span class='cmti-10'>${tie}and</span></span><span class='cmti-10'> so on\\.</span>`),
    new RegExp(`<span class='cmr-8'>See Lemma</span><span class='tex8web-nowrap'><span class='cmr-8'>${tie}</span><span class='mathjax-inline'[^>]*>${math} </span></span>`),
    // a qed box left a child of its paragraph, for the stylesheet
    new RegExp(`after <span class='tex8web-nowrap'>${math}\\.</span><span class='tex8web-qed'>`),
    // but a box or a term after the math is not split, which would give
    // two boxes, or a term with two ids
    new RegExp(`the ${math}<span class='fbox'[^>]*>th row</span>, the ${math}<span class='framebox-l'[^>]*>two words</span>, and\\s+the ${math}<span class='tex8web-term' id='term-th-power'>th power</span> of it\\.`)],
  // a ~ in a span of its font, in \small text, kept with the math
  'test-localsize': [new RegExp(`<span class='cmbx-10'>if</span><span class='tex8web-nowrap'><span class='cmr-10'>${tie}</span><span class='mathjax-inline'[^>]*>${math}</span><span class='cmr-10'>${tie}</span><span class='cmbx-10'>then</span></span>`)],
  // a ~ in a heading and its table of contents entry too
  'test-tiepalatino': [new RegExp(`Proof of Lemma${tie}1</a>`), new RegExp(`Proof of Lemma${tie}1</h3>`),
    new RegExp(`See Lemma${tie}1 and`)],
};

// The fixtures beside stale lists with no \contentsline line, built in
// full and in draft mode: for each, the suffixes of its stale lists, and
// of the other files beside it, which a draft build reads: the
// document's own files and the files of a PDF build
const staleListFiles = {
  'test-staleaux-ptc': { lists: ['.ptc', '.plf', '.plt', '.loa'], read: ['.aux'] },
  'test-staleaux-ptc-amsart': { lists: ['.lof', '.lot'] },
  'test-staleaux-ptc-lists': { lists: ['.lof', '.lop', '.lpr', '.lsc', '.lol', '.loa'], read: ['.aux'] },
  'test-staleaux-ptc-koma': { lists: ['.lrm'], read: ['.aux'] },
  'test-staleaux-ptc-noaux-lists': { lists: ['.lop', '.lpr', '.lsc'] },
  'test-staleaux-ptc-noaux-koma': { lists: ['.lrm'] },
  'test-staleaux-ptc-own': { lists: ['.ptc', '.S1'],
    read: ['aux', 'cls', 'clo', '4ht', 'sty', 'def', 'ltx', 'fd', 'bbx', 'cbx', 'txt', 'bib', 'bst', 'F90'].map(e => `.${e}`) },
  'test-staleaux-ptc-draft': { lists: ['.ptc'], read: ['.aux', '.bbl', '.ind', '.gls', '.bib'] },
  'test-staleaux-ptc-include': { lists: ['.ptc', '.lop'], read: ['.aux', '/chapter.aux'] },
  'test-staleaux-ptc-backref': { lists: ['.ptc'], read: ['.aux', '.brf'] },
  'test-staleaux-mtc': { lists: ['.mtc1', '.mtc2', '.mtc3', '.mlf1', '.mlt1', '.ptc1', '.plf1', '.plt1'] },
  'test-staleaux-mtc-shortext': { lists: ['.M1', '.F1', '.T1', '.P1', '.G1', '.U1'] },
  'test-staleaux-mtc-hyperref': { lists: ['.mtc1', '.mlf1', '.mlt1'] },
  'test-staleaux-mtc-article': { lists: ['.stc1', '.stc2', '.stc3', '.slf1', '.slf2', '.slf3', '.slt1', '.slt2', '.slt3', '.ptc1'] },
  'test-staleaux-mtc-article-shortext': { lists: ['.S1', '.S2', '.S3', '.H1', '.H2', '.H3', '.V1', '.V2', '.P1'] },
};
const staleListCases = Object.keys(staleListFiles);

// The lines that make4ht's log must hold, with their level: the tests
// build at -a info, and make4ht shows status and above by default.
// (a missing .bib beside a shipped .bbl, with bibtex and with biber)
const logs = {
  'test-bblnobib': [/^\[STATUS\] +tex8web: bibliography: test-bblnobib-gone is missing/m],
  'test-bblnobib-biber': [/^\[STATUS\] +tex8web: bibliography: test-bblnobib-gone\.bib is missing/m],
  // (no LaTeX error from a file of an earlier build beside the document)
  ...Object.fromEntries(['test-staleaux', 'test-staleaux-tex4ht', 'test-staleaux-current', 'test-staleaux-lineno'].map(name =>
    [name, [/^(?![^]*Undefined control sequence)/, /^(?![^]*Missing \\begin\{document\})/, /^(?![^]*File ended while scanning)/]])),
  // (no LaTeX error from the .bbl of an earlier build beside the document)
  // (make4ht prints only the first 79 columns of an error)
  ...Object.fromEntries(['test-staleaux-bbl', 'test-staleaux-bbl-hyperref', 'test-staleaux-bbl-biber', 'test-staleaux-bbl-blx',
    'test-staleaux-bbl-natbib', 'test-staleaux-bbl-harvard', 'test-staleaux-bbl-input', 'test-staleaux-bbl-ifexists',
    'test-staleaux-bbl-jobname'].map(name =>
    [name, [/^(?![^]*Missing 'biblatex' package)/, /^(?![^]*Package biblatex Error)/,
      /^(?![^]*Package natbib Error)/, /^(?![^]*Undefined control sequence)/]])),
  // (a chapter that \includeonly leaves out has no .aux, which bibtex
  // reads in place of the \@input line that names it: bibtex runs
  // without an error)
  'test-bibinclude-report': [/^(?![^]*the bibliography failed)/],
  // (a current .bbl beside the document is read by the first LaTeX run,
  // which writes its \bibcite lines, so the second run changes no .aux)
  'test-staleaux-bbl-current': [/LaTeX call/, /^(?![^]*LaTeX call[^]*LaTeX call[^]*LaTeX call)/, /^(?![^]*runs again without)/],
  // (no LaTeX error from the stale list files of an earlier build beside
  // the document: an undefined macro, and a three-argument \contentsline
  // read past the end of the file; in test-staleaux-toc also biblatex's
  // \boolfalse and \defcounter lines, babel's \foreignlanguage, and no
  // error in the file of each list)
  ...Object.fromEntries(['toc', 'toc-koma', 'toc-memoir', 'toc-color', 'toc-amsart', 'toc-report'].map(name =>
    [`test-staleaux-${name}`, [/LaTeX call/, /^(?![^]*Undefined control sequence)/, /^(?![^]*File ended while scanning)/,
      /^(?![^]*\[ERROR\])/, ...name === 'toc' ? [/^(?![^]*Package etoolbox Error)/, /^(?![^]*No counter 'refsection')/,
        /^(?![^]*No multilingual package)/, /^(?![^]*test-staleaux-toc\.(?:exp|rmk|loe|box|tdo|loa)\b)/] : []]])),
  // (no LaTeX error from stale lists with no entry line, only
  // \addtocontents writes of a macro this document does not define)
  ...Object.fromEntries(staleListCases.map(name =>
    [name, [/LaTeX call/, /^(?![^]*Undefined control sequence)/, /^(?![^]*No counter 'refsection')/, /^(?![^]*\[ERROR\])/]])),
  // (no LaTeX error from the sorted index and glossary files of an earlier
  // build beside the document, which the first LaTeX run would read: their
  // \hyperpage, which the document no longer defines)
  ...Object.fromEntries(['ind', 'ind-named', 'ind-input', 'ind-gls', 'ind-abr', 'ind-cls', 'ind-incl', 'ind-incl-plain'].map(name =>
    [`test-staleaux-${name}`, [/LaTeX call/, /^(?![^]*Undefined control sequence)/, /^(?![^]*\[ERROR\])/]])),
  // (current index and glossary files beside the document are read by the
  // first LaTeX run with no error, and the build takes no extra LaTeX run)
  ...Object.fromEntries(['test-staleaux-ind-current', 'test-staleaux-ind-shipped'].map(name =>
    [name, [/LaTeX call/, /^(?![^]*LaTeX call[^]*LaTeX call[^]*LaTeX call)/, /^(?![^]*\[ERROR\])/]])),
  // (an index whose .idx the second LaTeX run leaves as the first wrote
  // it takes no LaTeX run past make4ht's three)
  ...Object.fromEntries(['test-index', 'test-imakeidx'].map(name =>
    [name, [/LaTeX call/, /^(?![^]*LaTeX call[^]*LaTeX call[^]*LaTeX call[^]*LaTeX call)/]])),
  // (an index after minted's listings is sorted again, with one more LaTeX
  // run at most, and with minted's cache off, not at all)
  ...Object.fromEntries(['test-idxminted', 'test-idxminted-forms', 'test-idxminted-named'].map(name =>
    [name, [/LaTeX call/, /^(?![^]*LaTeX call[^]*LaTeX call[^]*LaTeX call[^]*LaTeX call[^]*LaTeX call)/]])),
  'test-idxminted-nocache': [/LaTeX call/, /^(?![^]*LaTeX call[^]*LaTeX call[^]*LaTeX call[^]*LaTeX call)/],
};
// (a status line says that minitoc's mini tables are empty, and names the
// numbered files of an earlier build beside the document that the build
// does not read; a .F90 source of the document is read, and no such line
// names it)
logs['test-staleaux-mtc'].push(/^\[STATUS\] +tex8web: minitoc's mini tables are empty: .*test-staleaux-mtc\.mlf1, .*test-staleaux-mtc\.mtc1, .*test-staleaux-mtc\.ptc1$/m);
// (the status line also names a file under a name of minitoc's that holds
// only \addtocontents writes)
logs['test-staleaux-mtc'].push(/^\[STATUS\] +tex8web: minitoc's mini tables are empty: .*test-staleaux-mtc\.mtc1, [^,]*test-staleaux-mtc\.mtc2, /m);
logs['test-staleaux-ptc-own'].push(/^(?![^]*mini tables are empty)/);
// Files of an earlier build beside a document: the build reads none of
// them, and leaves each as it was when this script started, with the same
// text and time of change, and writes no file beside them
const untouched = {
  'test-staleaux': ['test-staleaux.aux', 'test-staleaux.toc', 'test-staleaux/chap.aux'],
  'test-staleaux-tex4ht': ['test-staleaux-tex4ht.aux', 'test-staleaux-tex4ht.xref', 'test-staleaux-tex4ht.4tc', 'test-staleaux-tex4ht.tmp'],
  'test-staleaux-current': ['test-staleaux-current.aux', 'test-staleaux-current/chap.aux', 'test-staleaux-current.bbl',
    'test-staleaux-current.ind', 'test-staleaux-current-supp.aux'],
  'test-staleaux-lineno': ['test-staleaux-lineno.aux'],
  'test-staleaux-bbl': ['test-staleaux-bbl.aux', 'test-staleaux-bbl.bbl'],
  'test-staleaux-bbl-hyperref': ['test-staleaux-bbl-hyperref.bbl'],
  'test-staleaux-bbl-biber': ['test-staleaux-bbl-biber.aux', 'test-staleaux-bbl-biber.bbl'],
  'test-staleaux-bbl-blx': ['test-staleaux-bbl-blx.aux', 'test-staleaux-bbl-blx.bbl'],
  'test-staleaux-bbl-natbib': ['test-staleaux-bbl-natbib.bbl'],
  'test-staleaux-bbl-input': ['test-staleaux-bbl-input.bbl'],
  'test-staleaux-bbl-ifexists': ['test-staleaux-bbl-ifexists.bbl'],
  'test-staleaux-bbl-harvard': ['test-staleaux-bbl-harvard.bbl'],
  'test-staleaux-bbl-jobname': ['test-staleaux-bbl-jobname.bbl'],
  'test-staleaux-bbl-current': ['test-staleaux-bbl-current.aux', 'test-staleaux-bbl-current.bbl'],
  'test-staleaux-toc': ['exp', 'rmk', 'loe', 'box', 'tdo', 'loa', 'toc', 'lof', 'lot', 'lol', 'lop'].map(e => `test-staleaux-toc.${e}`),
  'test-staleaux-toc-koma': ['test-staleaux-toc-koma.lox'],
  'test-staleaux-toc-memoir': ['test-staleaux-toc-memoir.exa', 'test-staleaux-toc-memoir.thm'],
  'test-staleaux-toc-color': ['test-staleaux-toc-color.exp'],
  'test-staleaux-toc-amsart': ['test-staleaux-toc-amsart.lof', 'test-staleaux-toc-amsart.lot'],
  'test-staleaux-toc-report': ['test-staleaux-toc-report.exp'],
  ...Object.fromEntries(Object.entries(staleListFiles).map(([name, { lists, read = [] }]) =>
    [name, [...read, ...lists].map(suffix => name + suffix)])),
  'test-staleaux-ind': ['test-staleaux-ind.ind'],
  'test-staleaux-ind-named': ['test-staleaux-ind-named.ind', 'test-staleaux-ind-named-authors.ind', 'test-staleaux-people.ind', 'test-staleaux-editors.ind'],
  'test-staleaux-ind-input': ['test-staleaux-ind-input.ind', 'test-staleaux-ind-input.gls', 'test-staleaux-ind-input/pre.tex'],
  'test-staleaux-ind-incl': ['incl', 'incl-people', 'incl-terms', 'incl-words', 'incl-places'].map(n => `test-staleaux-ind-${n}.ind`),
  'test-staleaux-ind-incl-plain': ['test-staleaux-ind-incl-plain.ind', 'test-staleaux-ind-incl-plain-people.ind'],
  'test-staleaux-ind-incl-fresh': [],
  'test-staleaux-ind-gls': ['gls', 'acr', 'sls', 'nls', 'notation-gls', 'tls'].map(e => `test-staleaux-ind-gls.${e}`),
  'test-staleaux-ind-abr': ['test-staleaux-ind-abr.gls', 'test-staleaux-ind-abr.gls-abr'],
  'test-staleaux-ind-current': ['test-staleaux-ind-current.ind'],
  'test-staleaux-ind-cls': ['test-staleaux-ind-cls.ind'],
  'test-staleaux-ind-shipped': ['test-staleaux-ind-shipped.ind', 'test-staleaux-ind-shipped.gls'],
};
// (only the fixtures' own entries are walked: other builds write in
// test/fixtures/build while this script runs, and a folder removed there
// during a walk would throw)
const staleFiles = () => readdirSync(join(root, 'test/fixtures'), { withFileTypes: true }).filter(e => e.name.startsWith('test-staleaux'))
  .flatMap(e => [e.name, ...(e.isDirectory() ? readdirSync(join(root, 'test/fixtures', e.name), { recursive: true }).map(f => join(e.name, f)) : [])]).sort();
const staleState = f => { try { return `${statSync(join(root, 'test/fixtures', f)).ctimeMs} ${readFileSync(join(root, 'test/fixtures', f), 'utf8')}`; } catch { return null; } };
const staleBefore = new Map(staleFiles().map(f => [f, staleState(f)]));
// A box that holds a TikZ picture, placed in another picture, and the
// pictures beside such boxes (test-nestpic-cases.ltx): between each case's
// "Before" and "After" is a picture that dvisvgm wrote, and not empty. The
// text that an outer box holds is in its picture, not the page's text, and
// no tail of an <img> tag is left as the page's text. Each outer box of
// the environments, which is 0.8 of the text width with its frame, is as
// wide on the page, within 0.001: an inner picture's bounding box does not
// widen it.
const nestpicCases = ['lrbox', 'setbox', 'sbox', 'savebox', 'pgf', 'two boxes', 'three level', 'box and nest',
  'nest and box', 'env mixed', 'env three', 'env deep', 'env', 'two inner', 'env list', 'env note', 'thm env', 'theorem',
  'note', 'stray', 'picture env', 'href', 'picture after link', 'key', 'picture baseline', 'own baseline',
  'picture overlay', 'text copy', 'fbox copy', 'later', 'direct', 'minipage', 'tcolorbox', 'mdframed'];
const nestpicTexts = ['Inner mixed B.', 'Outer mixed G.', 'Mid three D.', 'Outer three E.', 'Mid deep D.', 'Outer deep E.',
  'Outer text after.', 'Outer two E.', 'Outer list C.', 'Outer note C.', 'Outer thm after.'];
const nestpicOuter = ['env mixed', 'env three', 'env deep', 'env', 'two inner', 'env list', 'env note', 'thm env', 'key'];
// the paths that the outer picture draws, with those of its inner
// pictures: frames, rectangles, and circles
const nestpicPaths = { lrbox: 2, sbox: 2, pgf: 2, 'two boxes': 2, 'three level': 2, 'picture env': 1, 'env three': 3, key: 2 };
// whether the outer picture is lowered: only by its own TikZ baseline,
// not by that of an inner picture. A LaTeX picture with an overlay node
// inside is as wide as one without.
const nestpicLowered = { key: false, 'picture baseline': false, 'picture overlay': false, 'own baseline': true };
const nested = { 'test-nestpic': nestpicCases, 'test-nestpic-hyperref': nestpicCases };
// Math in a box saved with \sbox, \savebox, or lrbox (test-boxmath.tex).
// Placed in a TikZ node, the first picture between each case's "Before"
// and "After" draws glyphs of two fonts or more: the text's and the
// math's, as the box's text is in one font. A box with a display draws
// more fonts than its text and inline math have, given below. The
// quantity's digits and unit are in the text's font, so its picture
// draws the box's glyphs, counted below, as does the tikzcd's, drawn once.
// The $$ display is as tall as the \[ \] display of the same formula. The
// text after an equation and an align* starts where the box's first line
// starts, with no space before it. Placed outside any picture, each
// copy's math is the page's formulas, as many as the box holds, its
// pictures are as many as the box holds, and the copy's text is only the
// box's text, with no glyphs of the math. The proof's QED is the tag of
// its display, once, and the reference to the copy's equation is to its
// number, given once in the aux file (texWarnings). Drawn in a node, the
// proof's QED, which amsthm draws with rules, ends at the right margin of
// the box, which starts at its first glyph and is 0.5\textwidth wide, in
// the SVG's bp: within 1bp, as the box has a side bearing.
const boxmathPictures = ['sbox', 'savebox', 'lrbox inline', 'lrbox display', 'lrbox dollars', 'lrbox equation',
  'lrbox align', 'lrbox flalign', 'lrbox ampersand', 'lrbox list', 'lrbox tikzcd', 'sbox quantity', 'lrbox qed',
  'direct'];
const boxmathFonts = { 'lrbox display': 5, 'lrbox dollars': 5, 'lrbox ampersand': 3, 'sbox quantity': 1 };
const boxmathGlyphs = { 'lrbox tikzcd': 9, 'sbox quantity': 11 };
const boxmathCopies = {
  'text copy': [1, 'Kept Box end here.'], 'fbox copy': [1, 'Framed Saved here here.'],
  'minipage copy': [4, 'Placed Copied and then and here.'], 'tikzcd copy': [0, 'Placed arrows: here.', 1],
  'qed copy': [1, 'Placed Proof. Then here.'], eqref: [0, 'See (3).'],
};
const boxmathQed = 'qed copy';
const boxmathQedRight = ['lrbox qed', 345 / 2 * 72 / 72.27];
const boxmathSame = ['lrbox dollars', 'lrbox display'];
const boxmathAfter = ['lrbox equation', 'lrbox align'];
const boxmath = { 'test-boxmath': boxmathPictures };
// Graphics in saved boxes placed in a TikZ node, and graphics typed in a
// picture (test-boxgfx.tex). The picture between each case's "Before" and
// "After" holds one <image> with its data embedded, as the SVG is shown
// through an <img>, in an <svg> as large as the graphic in the PDF before
// any rotation or scale, in pt, within 0.05bp. The picture is at least as
// large as that <svg>, so the frame around it is as large too. A turned or
// scaled graphic is given with a pattern of the SVG and its size after
// the turn or scale, which the picture is at least as large as. A
// trimmed graphic shows the part kept, clipped. A picture in a \resizebox
// that changes its aspect is stretched. The box drawn in "node copy",
// placed outside any picture, holds the graphic's <img>, no picture, and
// only the box's text. A picture without a graphic is as wide as in the
// PDF, in pt, within 0.05bp.
const boxgfxSizes = {
  'lrbox png': [138, 103.5], 'lrbox pdf': [138, 103.5], 'sbox jpg': [40, 30], 'savebox eps': [72, 36],
  'node copy': [138, 103.5], 'node png': [80, 60], 'picture pdf': [80, 60], 'overpic png': [80, 60],
  'resized node': [28.4528, 21.3396], 'trimmed png': [56.9055, 85.3583], 'turned png': [64.24, 48.18],
  'scaled png': [28.4528, 21.3396], 'turned in picture': [60, 45], twice: [28.4528, 21.3396],
};
const boxgfxTransforms = {
  'turned png': [/rotate\(90\)/, 56.9055, 75.873], 'scaled png': [/scale\(2,2\)/, 56.9055, 42.679],
  'turned in picture': [/rotate\(90\)/, 45, 60],
};
const boxgfxTrimmed = ['trimmed png', "viewBox='0 0 32 48'", "overflow='hidden'"];
const boxgfxStretched = 'resized node';
const boxgfxCopy = ['text copy', 'test-bare.png', 'Kept text.'];
const boxgfxWidths = { 'turned label': 13.49927 };
const boxgfx = { 'test-boxgfx': boxgfxSizes };
// A center, \centering, or ragged2e's \Centering in a minipage saved with
// lrbox, \sbox, or \savebox and placed in a TikZ node, and frames in such
// a box (test-boxcenter-cases.ltx). Each case: the glyph measured from;
// other glyphs at their offset in the PDF, in bp, x within 1 and y within
// 3 (null: not checked); the node's frame's height in the PDF (the box's
// \ht and \dp and the inner sep), in pt, within 3 (null: not checked); the
// width in bp of the frame around each glyph in an \fbox, within 1 (null:
// not checked), with no other rules drawn; and the graphic's x offset, within
// 1. A theorem adds space of its own, and an itemize's label starts a line
// of its own, so these are measured less. "ragged centering" is a guard.
// test-boxcenter-renewed renews center in its preamble.
// In the running text, a saved box's center holds its text and \fbox with
// no empty <p> above them (a change the user accepted), and a center
// outside any saved box keeps the empty <p> that html4.4ht writes.
const boxcenterRepro = ['A', { B: [72.866, 19.925], C: [86.627, 19.925], D: [0, 39.85] }, 46.83331 + 6.6666, { C: 13.970 }];
const boxcenterCases = {
  nested: ['Y', { X: [81.303, 20.84] }, 27.74997 + 6.6666],
  repro: boxcenterRepro,
  'lrbox png': ['E', {}, 58.51338 + 6.6666, {}, 56.6929],
  'sbox centering': ['Z', { F: [68.571, 11.955] }, 20.77776 + 6.6666],
  'savebox math': ['G', { H: [68.784, 19.925], I: [83.241, 31.88] }, 38.83332 + 6.6666],
  'centering env': ['Z', { J: [82.479, 11.955] }, 18.83331 + 6.6666],
  'ragged centering': ['Z', { K: [81.165, 11.955] }, 18.83331 + 6.6666],
  'parbox centering': ['Z', { L: [81.926, 11.955] }, 18.83331 + 6.6666],
  frames: ['M', { N: [37.068, 0], O: [72.468, 0], P: [86.922, 0] }, 13.6333 + 6.6666, { N: 56.693, P: 13.555 }],
  italic: ['Q', { R: [81.406, 19.925] }, 26.83331 + 6.6666],
  sans: ['S', { T: [81.649, 19.925] }, 26.94444 + 6.6666],
  theorem: ['T', { V: [81.336, null] }, null],
  footnote: ['W', { X: [81.868, 17.434] }, 22.96666 + 5.3333],
  'node copy': ['K', { C: [44.057, 21.209], F: [89.817, 21.209] }, 31.52219 + 6.6666, { F: null }],
  'center first': ['D', { B: [72.866, -21.918], C: [86.627, -21.918] }, 32.2333 + 6.6666, { C: 13.970 }],
  'savebox fbox': ['G', { H: [74.457, 19.925], I: [88.634, 19.925] }, 30.2333 + 6.6666, { I: null }],
  'minipage in center': ['Y', { X: [81.303, 20.84] }, 27.74997 + 6.6666],
  'two centers': ['A', { B: [81.511, 19.925], C: [81.442, 41.843] }, 48.83331 + 6.6666],
  'center after list': ['B', { C: [56.534, 21.918] }, null],
  'direct minipage': boxcenterRepro,
  figure: boxcenterRepro,
  'own center': ['A', { B: [80.964, 19.925] }, 26.83331 + 6.6666],
  'let center': ['A', { B: [81.511, 19.925] }, 26.83331 + 6.6666],
  parskip: ['A', { B: [81.511, 27.895], D: [0, 55.79] }, 62.83331 + 6.6666],
  'fbox comma': ['A', { y: [14.177, 0], ',': [22.826, 0], z: [28.911, 0] }, 13.04998 + 6.6666, { y: 12.034 }],
  'late center': ['A', { L: [76.737, 19.925], B: [86.297, 19.925] }, 26.83331 + 6.6666],
};
const boxcenterKept = { 'text copy': ['Centered', 'Framed', ''], 'sbox text copy': ['Centered', 'Framed', ''], 'plain center': ['Plain', 'Boxed', "<p class='noindent'>\\s*</p>"] };
// A saved box's \fbox and \framebox in the running text, with no space
// after a frame, and the \framebox 2cm wide.
const boxcenterText = {
  'text fbox comma': "A <span class='fbox'[^>]*>y</span>, z",
  'text frames': "M <span class='framebox-c' style='width: 5\\.69\\d*em;[^>]*>N</span> O <span class='fbox'[^>]*>P</span>\\s*</p>",
};
const boxcenter = { 'test-boxcenter': boxcenterCases, 'test-boxcenter-hyperref': boxcenterCases, 'test-boxcenter-renewed': boxcenterCases };
// A \tikz picture as wide as what it draws: a circle at the origin, on which
// tex4ht's SVG (from dvisvgm, scaled 1.4) is centered. On the page it is as
// wide as in the PDF, 1cm of a 345pt text width
const tikz = { 'test-article': ['test-article0x.svg', 0.0825] };
// pictures over pictures without their .xbb file, in pt, as in the PDF:
// the width and height of the image before each "After <case>.", at the
// scale of the image whose picture has its .xbb file ('found'). The edges
// or frame drawn in each picture make its image as large as the picture.
// (the grid's numbers lie outside its picture, and the Overpic
// environment's graphic is not in its picture)
const pictureSizes = {
  'test-overpic': ['png', {
    found: [80, 60], share: [172.5, 129.39], natural: [64.24, 48.18], trimmed: [100, 71.43], path: [53.33, 40],
    permil: [80, 60], set: [64.24, 48.18], picture: [80.8, 60.8], figure: [60, 80], 'bare name': [80, 60],
    italic: [80, 60], minipage: [138, 103.5], cell: [80, 60], photo: [80, 60], moved: [120.45, 30.11],
    cropped: [120.45, 30.11], 'second page': [80, 20], dense: [64.24, 48.18], folder: [80, 60],
    'natural picture': [65.04, 48.98], subfigure: [155.25, 116.44], eps: [72, 25.36],
  }],
  'test-overpic-drawn': ['svg', { found: [80, 60], overpic: [172.5, 129.39], picture: [80.8, 60.8], node: [80, 60] }],
};
// pictures that dvipng draws with their graphic, which covers more than
// half of the image, where the edges and label alone leave it transparent
const coveredPictures = { 'test-overpic': ['eps'] };

// Tables in LaTeX pictures (test-pictab-cases.ltx), drawn in the picture's
// image as in the PDF. For each case, the one image from "Before <case>."
// to "After <case>.", and its width in pixels at dvipng's resolution
// (within 10%, as dvipng crops the image to its ink). Without the array
// package, tex4ht sets tabular* at its natural width, so its width is not
// checked on those pages. The images of the Inkscape labels and the overpic label
// leave out the graphic under the labels, so their widths are the labels'.
// A TikZ picture is an SVG image, whose width is not checked.
const tableWidths = {
  plain: 88, grid: 158, 'column types': 266, star: 254, tabularx: 279, nested: 148, array: 41, span: 89,
  'in cell': 53, booktabs: 136, colortbl: 129, rowcolor: 129, figure: 75, theorem: 94, italic: 64, sans: 39,
  typewriter: 40, small: 43, label: 169, import: 169, overpic: 91, rowcolors: 88,
};
const inEveryTablePage = ['plain', 'grid', 'star', 'nested', 'array', 'span', 'in cell', 'figure', 'theorem',
  'italic', 'sans', 'typewriter', 'small'];
// the cases whose tables have yellow cells or rows, which cover at least a
// fifth of the image (in the PDF, about a third or a half)
const yellowTables = ['colortbl', 'rowcolor', 'rowcolors'];
// the cases whose tables have three rules across the table, as in the PDF:
// \rowcolors' [\hline] runs above each of the two rows and below the last
const ruledTables = ['rowcolors'];
// the colors, as 0xRRGGBB, of a PNG with a palette, as dvipng writes,
// pixel by pixel, or null for a PNG of another type (decode reads only RGB
// and RGBA)
const paletteColors = png => {
  let header, palette;
  const data = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at), type = png.toString('latin1', at + 4, at + 8), body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = body;
    else if (type === 'PLTE') palette = body;
    else if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  if (!header || header[9] !== 3 || header[12] !== 0 || !palette) return null;
  const [width, height, depth] = [header.readUInt32BE(0), header.readUInt32BE(4), header[8]];
  const stride = Math.ceil(width * depth / 8), raw = inflateSync(Buffer.concat(data)), rows = Buffer.alloc(height * stride);
  const colors = [];
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, left = x ? rows[at - 1] : 0, up = y ? rows[at - stride] : 0, upLeft = x && y ? rows[at - stride - 1] : 0;
      const p = left + up - upLeft, [a, b, c] = [left, up, upLeft].map(v => Math.abs(p - v));
      const predicted = [0, left, up, (left + up) >> 1, a <= b && a <= c ? left : b <= c ? up : upLeft][filter];
      if (predicted === undefined) throw new Error(`bad PNG filter ${filter}`);
      rows[at] = raw[y * (stride + 1) + 1 + x] + predicted;
    }
    for (let x = 0; x < width; x++) {
      const bit = x * depth, index = (rows[y * stride + (bit >> 3)] >> (8 - depth - bit % 8)) & ((1 << depth) - 1);
      colors.push(palette.readUIntBE(3 * index, 3));
    }
  }
  return colors;
};
const tablePictures = {
  'test-pictab': Object.keys(tableWidths).filter(name => !yellowTables.includes(name)),
  'test-pictab-hyperref': [...inEveryTablePage, 'column types', 'label'],
  'test-pictab-colortbl': [...inEveryTablePage, 'column types', 'booktabs', 'colortbl', 'rowcolor', 'rowcolors'],
  'test-pictab-booktabs': [...inEveryTablePage, 'booktabs'],
  'test-pictab-rollback': [...inEveryTablePage, 'column types', 'booktabs', 'colortbl', 'rowcolor', 'rowcolors'],
  'test-pictab-book': ['label'],
  'test-pictab-plain': inEveryTablePage,
  'test-pictab-tikz': ['tikz', 'label'],
};
// words of the tables in the pictures, which are not the page's text
const tablePictureWords = new RegExp(String.raw`\b(?:` + ['AlphaOne', 'Gamma', 'DeltaBold', 'Left', 'Right', 'Xone', 'InnerA', 'SpanTop',
  'InCell', 'Head', 'Hue', 'Tint', 'InFigure', 'InTheorem', 'Slanted', 'Sans', 'Mono', 'Small', 'InkLabel', 'InkOne',
  'InkRight', 'InkRot', 'OverLabel', 'Striped', 'TikzCell'].join('|') + String.raw`)\b`);

// Terms (\WebTerm), with ids for the table of contents filter; in a heading,
// only the term's text in the heading's id and table of contents entry
const terms = {
  'test': [/<span class='tex8web-term' id='term-inner-product'>/, /<span class='tex8web-term' id='term-ball'>/],
  'test-term': [/<h3 class='sectionHead' id='the-group-law'>/, /<a href='#the-group-law' id='[^']*'>The <span class='cmbx-10'>group\s*<\/span>\s*law<\/a>/,
    /<h3 class='sectionHead' id='the-ring-law'>/, /<a href='#the-ring-law' id='[^']*'>The <span class='cmbx-10'>ring\s*<\/span>\s*law<\/a>/,
    /<span class='tex8web-term' id='term-normal-subgroup'>/],
};

// Links at the heads of numbered theorems and the titles of numbered or
// labelled boxes, to the anchor that a \ref to them leads to. Unnumbered
// theorems and boxes have none.
const permalinks = {
  'test-tcolorbox': [
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>1:[^]*<a href='#\1'>1</,
    /<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink'[^>]*>#<\/a>\s*<p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>2:/,
    /<div class='tcolorbox-title'>\s*<p[^>]*>\s*Theorem:/,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Labelled box[^]*<a href='#\1'>/,
    /<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink'[^>]*>#<\/a>\s*<p[^>]*>\s*Exercise/,
    /<div class='tcolorbox-title'>\s*<p[^>]*>\s*In a raster/,
    /<div class='tcolorbox-title'>\s*<p[^>]*>\s*Also in a raster/,
    // (a box inside another, each with its anchor, \ref, and number)
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>3:<span class='tex8web-nbsp'>.<\/span>Outer[^]*<a href='#\1'>3</,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Theorem<span class='tex8web-nbsp'>.<\/span>4:<span class='tex8web-nbsp'>.<\/span>Inner/,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Outer box[^]*<a href='#\1'>1<!--\s*tex4ht:ref: outerbox /,
    /<a id='([^']+)'><\/a>\s*<div class='tcolorbox-title'><a [^>]*class='tex8web-permalink' href='#\1'>#<\/a>\s*<p[^>]*>\s*Inner box[^]*<a href='#\1'>1<!--\s*tex4ht:ref: innerbox /,
    // (a \tcbox on line inside its paragraph's line, also with a title and
    // inside a box; one with tcolorbox's space around it is a separate block)
    /A word <span class='tcolorbox tcbox' id='[^']+'>\s*<span class='tcolorbox-content'>boxed<\/span><\/span> in its line, <span class='tcolorbox tcbox' id='[^']+'>\s*<span class='tcolorbox-title'>T\s*<\/span><span class='tcolorbox-content'>titled<\/span><\/span> one too, and <\/p><div class='tcolorbox [^']*' id='[^']+'>\s*<div class='tcolorbox-content'>alone/,
    /<p[^>]*>And <span class='tcolorbox tcbox' id='[^']+'>\s*<span class='tcolorbox-content'>one<\/span><\/span> in a box\./,
    // (and on a boxed title)
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
  // (LaTeX's \newtheorem: one with a note, one sharing a counter, one
  // numbered within sections; and with hyperref, which adds a second anchor)
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

// amsthm's QED box. After text, in a display's last line, or on a list
// item, the box is a right-floated span of MathJax's \square (c25FB), as big
// as the PDF's. With \qedhere in a display, the box is the display's tag at
// the right and no box follows. A proof without \qedhere keeps its box.
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
  // a \qedsymbol the document defines, after text and in a tag
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
  // amsart's \qedsymbol (\textsquare, msam's square), after text and in a
  // tag, then one the document sets
  'test-amsart': [
    new RegExp(`${inProof('Plain')}${box}`),
    ...['Bracket', 'Align star'].map(tagged),
    new RegExp(`${inProof('Changed')}<span class='tex8web-qed'><mjx-container[^>]*><mjx-math[^>]*><mjx-c class='mjx-c25FC`),
    new RegExp(`${inProof('Changed display')}<mjx-labels(?:(?!<\\/div>)[^])*mjx-c25FC(?:(?!<\\/div>)[^])*<\\/mjx-container><\\/span>\\s*<\\/p>\\s*<\\/div>`),
    /^(?:(?!mjx-c25FB)[^])*(?:mjx-c25FB(?:(?!mjx-c25FB)[^])*){3}$/,
    /^(?:(?!mjx-c25FC)[^])*(?:mjx-c25FC(?:(?!mjx-c25FC)[^])*){2}$/,
  ],
  // \qedhere in a row with a \label, a \tag, a nested environment or text
  // in a display, twice, or outside a proof; and a proof ending in a list
  'test-qedrow': [
    ...['Label', 'Label align', 'No tag align', 'Aligned', 'Text', 'Bracket label'].map(tagged),
    // (a \tag on the row keeps the box on the proof, below the display)
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
  // a \qedhere in an eqnarray: the box is set below the display
  'test-eqnarray': [/<\/mjx-container><\/span><\/div>\s*<div class='tex8web-qed-line'>/],
  // equation*: a \ref to its \label leads to the section, and the three
  // relations of the page's math, one in the split's second column, are
  // spaced
  'test-equationstar': [
    /See <a href='#s'>1</,
    /^(?:(?!mjx-c class='mjx-c3D' space)[^])*(?:mjx-c class='mjx-c3D' space='4'(?:(?!mjx-c class='mjx-c3D' space)[^])*){3}$/,
  ],
};

// A display whose \label repeats an earlier one's (test-duplabel-cases.ltx):
// each display of a case drawn with its number, or its \tag, and no
// MathJax error between "Before <case>." and "After <case>.", with no
// other row numbered in parentheses. A reference gives the last display's
// number and leads to its anchor (\N, the Nth of the case's last anchors).
// The references lead there with the error too, so their patterns, and the
// cases section, nonumber, and control, are guards. In reserved, web-qed-2
// is also the name tex8web gives the second \qedhere display's QED tag,
// which gives the same error.
const dupFree = name => `(?:(?!After ${name}\\.)(?!<mjx-merror)(?!<mlabeledtr><mtd>(?:<mrow>)?<mtext>\\()[^])*`;
const dupDrawn = (name, ...tags) => new RegExp(`Before ${name}\\.${tags.map(tag => `${dupFree(name)}<mlabeledtr><mtd>(?:<mrow>)?<mtext>\\((?:<\\/mtext><mtext>)?${tag}(?:<\\/mtext><mtext>)?\\)`).join('')}${dupFree(name)}After ${name}\\.`);
const dupAnchors = (name, count) => `Before ${name}\\.(?:(?!After ${name}\\.)[^])*${`<a class='tex8web-eq-anchor(?:-end)?' id='([^']+)'><\\/a>(?:(?!After ${name}\\.)(?!tex8web-eq-anchor)[^])*`.repeat(count)}After ${name}\\.`;
const dupSpace = "<span class='tex8web-nbsp'>[^<]*<\\/span>";
const dupLink = (anchor, number) => `<a href='#\\${anchor}'>${number}(?:<!--[^>]*-->)?<\\/a>`;
const dupRefs = (name, count, refs) => new RegExp(`${dupAnchors(name, count)}(?:(?!Before )[^])*Refs ${name}: ${refs}\\.`);
// (a display with no number: its \label's anchor, the last of the case)
const dupPlainRefs = name => new RegExp(`Before ${name}\\.(?:(?!After ${name}\\.)[^])*<a id='([^']+)'><\\/a>(?:(?!After ${name}\\.)(?!<a id=)[^])*After ${name}\\.(?:(?!Before )[^])*Refs ${name}: ${dupLink(1, 1)}\\.`);
const duplabelNumbers = [
  dupDrawn('two', 1, 2), dupRefs('two', 1, `\\(${dupLink(1, 2)}\\) and ${dupLink(1, 2)}`),
  dupDrawn('alignat', 3, 4, 5), dupRefs('alignat', 1, `\\(${dupLink(1, 5)}\\)`),
  dupDrawn('rows', 6, 7), dupRefs('rows', 1, `\\(${dupLink(1, 7)}\\)`),
  dupDrawn('three', 8, 9, 10), dupRefs('three', 1, `\\(${dupLink(1, 10)}\\)`),
  dupDrawn('qed', 11, 12), dupRefs('qed', 1, `\\(${dupLink(1, 12)}\\)`),
  dupDrawn('own tag', 'A', 13), dupRefs('own tag', 1, `\\(${dupLink(1, 13)}\\)`),
  dupDrawn('eqnarray', 14, 15), dupRefs('eqnarray', 1, dupLink(1, 15)),
  dupDrawn('tag rows', 'T1', 'T2', 'T3'),
  dupDrawn('suffix', 16, 17, 18, 19),
  dupRefs('suffix', 3, `\\(${dupLink(1, 17)}\\), \\(${dupLink(2, 18)}\\), and \\(${dupLink(3, 19)}\\)`),
  dupDrawn('again', 20, 21, 22, 23), dupRefs('again', 2, `\\(${dupLink(2, 23)}\\) and \\(${dupLink(1, 22)}\\)`),
  dupDrawn('multline', 24, 25), dupRefs('multline', 1, `\\(${dupLink(1, 25)}\\)`),
  dupDrawn('starred', 'S1', 'S2', 'S3', 'S4'),
  dupDrawn('theorem', 26, 27), dupRefs('theorem', 1, `\\(${dupLink(1, 27)}\\)`),
  dupDrawn('reserved', 28, 29, 30), dupRefs('reserved', 2, `\\(${dupLink(2, 30)}\\) and \\(${dupLink(1, 29)}\\)`),
  dupDrawn('section', 31), dupRefs('section', 1, dupLink(1, 31)),
  dupDrawn('nonumber', 32), dupRefs('nonumber', 1, `\\(${dupLink(1, 32)}\\)`),
  dupDrawn('control', 'C'),
  dupDrawn('qed repeat', 33, 34), dupRefs('qed repeat', 1, `\\(${dupLink(1, 34)}\\)`),
  dupDrawn('qed align', 35, 36),
  dupDrawn('tag after', 37, 'B'),
  // (a \label in a display with no number gives the section's number)
  dupDrawn('displaymath', 38), dupRefs('displaymath', 1, `\\(${dupLink(1, 38)}\\)`),
  dupDrawn('dollars'), dupPlainRefs('dollars'),
  dupDrawn('bare'), dupPlainRefs('bare'),
  // (a \qedhere with a \label in $$ $$ and displaymath: two boxes below
  // the displays, none in a tag)
  /Before qed below\.(?:(?!After qed below\.)(?!mjx-labels)[^])*(?:<\/span><span class='tex8web-qed'>(?:(?!After qed below\.)(?!mjx-labels)[^])*){2}After qed below\./,
  dupDrawn('by section', '2\\.1', '2\\.2', '2\\.3'),
  dupRefs('by section', 2, `\\(${dupLink(1, '2\\.2')}\\) and \\(${dupLink(2, '2\\.3')}\\)`),
];

// Equation numbers, as in the PDF
const numbers = {
  // eqnarray: a \ref to a row's \label gives its number and leads to it.
  // The equation after an eqnarray whose row has a \qedhere is the fourth:
  // the row keeps its number. A \label on a \nonumber row gets the next
  // row's number and leads to an anchor of its own, also when the next row
  // has a \label, and a \label in an eqnarray* gets the next number
  'test-eqnarray': [
    /Star <a href='#[^']+'>3<!--[^>]*--><\/a> and <a href='#[^']+'>3<!--/,
    /<a class='tex8web-eq-anchor' id='([^']+)'><\/a><a class='tex8web-eq-anchor' id='([^']+)'><\/a>[^]*See <a href='#\1'>1<!--[^>]*--><\/a>, <a href='#\2'>2<!--[^>]*--><\/a>, and <a href='#[^']+'>4<!--/,
    /<a class='tex8web-eq-anchor' id='([^']+)'><\/a><a class='tex8web-eq-anchor' id='([^']+)'><\/a>[^]*Then <a href='#\1'>5<!--[^>]*--><\/a> and <a href='#\2'>5<!--/,
    // (five numbered rows: none for the \nonumber rows or in eqnarray*)
    /^(?:(?!<mjx-mlabeledtr)[^])*(?:<mjx-mlabeledtr(?:(?!<mjx-mlabeledtr)[^])*){5}$/,
  ],
  // a \label on an eqnarray row that starts with \lefteqn, under hyperref
  // (the anchor before the display whose \lefteqn holds the fraction)
  'test-lefteqn': [
    /<a class='tex8web-eq-anchor' id='([^']+)'><\/a>(?:(?!<\/div>)[^])*<mpadded width='0'><mstyle><mfrac>(?:(?!<\/div>)[^])*<\/div>\s*<p class='noindent'>See \(<a href='#\1'>2<!--[^>]*--><\/a>\) and <a href='#\1'>2<!--/,
    /^(?:(?!<mjx-mlabeledtr)[^])*(?:<mjx-mlabeledtr(?:(?!<mjx-mlabeledtr)[^])*){22}$/,
  ],
  'test-duplabel': duplabelNumbers,
  // (cleveref's \cref, to the same anchors as the \eqref of each case)
  'test-duplabel-hyperref': [
    ...duplabelNumbers,
    new RegExp(`${dupAnchors('two', 1)}[^]*${dupAnchors('three', 1).replace("id='(", "id='(?<three>")}[^]*${dupAnchors('multline', 1).replace("id='(", "id='(?<multline>")}[^]*Refs cref: eq\\.${dupSpace}\\(${dupLink(1, 2)}\\), eq\\.${dupSpace}\\(<a href='#\\k<three>'>10(?:<!--[^>]*-->)?<\\/a>\\), and eq\\.${dupSpace}\\(<a href='#\\k<multline>'>25(?:<!--[^>]*-->)?<\\/a>\\)\\.`),
    /Refs autoref: <a href='#[^']+'>Equation<span class='tex8web-nbsp'>[^<]*<\/span>1(?:<!--[^>]*-->)?<\/a>\./,
  ],
};

// References to labels of another document, with xr and xr-hyper, from an
// .aux that LaTeX wrote: the number, page, or name as in the PDF, with no
// link. A sentence of the fixture, where a space is any white space or tags
// inside one paragraph, and each @ a reference's text, with or without tags
// other than a link around it.
const tag = "<(?!\\/?(?:a|p|div)\\b)[^>]*>";
const said = (sentence, ...texts) => new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, `(?:\\s|${tag})+`)
  .split('@').map((part, i) => (i ? `(?:${tag})*${texts[i - 1]}(?:${tag})*` : '') + part).join(''));
const nbsp = "<span class='tex8web-nbsp'>[^<]*<\\/span>";
const bold = "<span class='cmbx-10'>A<\\/span>", italic = "<span class='cmti-10'>Intro<\\/span>";
const latexAux = [
  said('Starred @.', '1'), said('Section @.', '1\\.1'), said('Page @.', 'iv'), said('Item @.', '\\(a\\)'),
  said('Bold @.', bold), said('Empty [@].', ''), said('Named @.', 'Main\\s+theorem'), said('Named in italics @.', italic),
  said('Spaced @.', 'Step 2'), said('Included @.', '3'),
  // (\autoref with its name, a cleveref field kept as written, and
  // \hyperref's text, once: a reference in it, or after it, prints its number)
  said('Auto @.', `Theorem${nbsp}2`), said('Cleveref’s @.', "\\[section\\]\\[\\]\\[\\]<span class='cmti-10'>A<\\/span>"),
  said('Auto section @. Auto starred @.', `subsection${nbsp}1\\.1`, `Theorem${nbsp}2`),
  said('Hyperref @.', 'text'), said('Hyperref around see @.', '1'),
  said('Hyperref empty [@].', ''),
  /Local around <a href='#here'>see 1\.1<\/a>\./, said('After @.', '1\\.1'),
];
// (\autoref of a label that tex4ht wrote under hyperref: only the link to
// that document's page)
const autoTex4ht = page => new RegExp(`Auto written by tex4ht <a href='test-xr\\/\\.\\.\\/${page}\\.html#x1-90001\\.1'>1\\.1<\\/a>\\.`);
// (a reference to a label of an .aux that LaTeX wrote under hyperref, whose
// \externaldocument gives a URL: its number, page, name, and \autoref as in
// the PDF, with no link)
const latexUrl = name => said(`${name} @, page @, named @, auto @.`, '1\\.1', 'iv', 'Main\\s+theorem', `Theorem${nbsp}2`);
// (a link to a label of an .aux that tex4ht wrote, on that document's page)
const tex4htLink = (page, anchor) => `<a href='test-xrurl\\/\\.\\.\\/${page}\\.html#${anchor}'>1\\.1<\\/a>`;
// (a reference to a file that does not exist yet, as LaTeX prints it)
const missing = name => said(`${name} @.`, '\\?\\?');
// (the URL is dropped: no text or link of it anywhere on the page)
const noUrl = /^(?![^]*example\.org)/;
// (a label of this document: a link to its heading)
const local = number => new RegExp(`Local <a href='#here'>${number}(?:<!--[^>]*-->)?<\\/a>\\.`);
const external = {
  // (under hyperref, in italics, a footnote, sans-serif, typewriter, a
  // theorem, and a heading, each in its font; a label of an .aux that
  // tex4ht wrote under hyperref, with its .xref beside it: links to that
  // document's page)
  'test-xr': [...latexAux, said('Equation @.', '\\(3\\)'),
    // (\cref with its name and no link, and \getrefnumber as a number)
    said('Cleveref @.', `section${nbsp}1\\.1`), said('Getrefnumber @.', '1'),
    // (cleveref's page references and ranges, whose links read the label's
    // anchor and URL fields: no link to this page)
    said('Cleveref page @. Cleveref range @. Cleveref page range @.', `page${nbsp}2`,
      `sections${nbsp}1\\s+to${nbsp}1\\.1`, `pages${nbsp}3\\s+to${nbsp}2`),
    // (\getrefnumber expanded in \ifthenelse's test, and in a label of this
    // document, which the .aux keeps for the next run)
    said('Equal @.', 'yes'), /Prime <a href='#[^']+'>2['’](?:<!--[^>]*-->)?<\/a>\./,
    ...[['cmti-10', 'In italics'], ['cmr-8', 'In a footnote'], ['cmss-10', 'In sans-serif'], ['cmtt-10', 'In typewriter'], ['cmti-10', 'In a theorem']]
      .map(([font, context]) => new RegExp(`<span class='${font}'>${context}, 1\\.1\\.\\s*<\\/span>`)),
    /<h4 class='subsectionHead'[^>]*>(?:(?!<\/h4>)[^])*>Heading 1\.1<\/h4>/,
    /Written by tex4ht under hyperref: <a href='test-xr\/\.\.\/test-xr\.html#x1-90001\.1'>1\.1<\/a>, <a href='test-xr\/\.\.\/test-xr\.html#x1-90001\.1'>Two<\/a>\./,
    autoTex4ht('test-xr'), local(2)],
  // (without hyperref, from an .aux written without hyperref and from one
  // written under it; a label of an .aux that tex4ht wrote, with its .xref)
  'test-xr-plain': [said('Section @, subsection @, page @, item @, bold @, empty [@].', '1', '1\\.1', 'iv', '\\(a\\)', bold, ''),
    said('Getrefnumber @.', '1'), said('Equal @.', 'yes'),
    said('Under hyperref: subsection @, page @, bold @, spaced @, included @.', '1\\.1', 'iv', bold, 'Step 2', '3'),
    /Written by tex4ht: <a href='test-xr\/\.\.\/test-xr-plain\.html#x1-20001\.1'>1\.1<\/a>\./, local(1)],
  // (also from an .aux written without hyperref)
  'test-xr-hyper': [...latexAux, said('Without hyperref: subsection @, page @.', '1\\.1', 'iv'), autoTex4ht('test-xr-hyper'), local(1)],
  // (with xr's and xr-hyper's URL of the other document's PDF: each as
  // without the URL, in each context; the nocite option,
  // \externalcitedocument, no prefix, and the URL on the next line, after a
  // space, empty, and holding ~ and _)
  'test-xrurl': [latexUrl('CaseA'), said('CaseD @, page @.', '1\\.1', 'iv'),
    new RegExp(`CaseB ${tex4htLink('test-xrurl', 'x1-90001\\.1')}, auto ${tex4htLink('test-xrurl', 'x1-90001\\.1')}\\.`),
    new RegExp(`CaseC ${tex4htLink('test-xrurl', 'x1-20001\\.1')}\\.`),
    ...[['cmti-10', 'In italics'], ['cmr-8', 'In a footnote'], ['cmss-10', 'In sans-serif'], ['cmtt-10', 'In typewriter'], ['cmti-10', 'In a theorem']]
      .map(([font, context]) => new RegExp(`<span class='${font}'>${context}, 1\\.1\\.\\s*<\\/span>`)),
    /<h3 class='sectionHead'[^>]*>(?:(?!<\/h3>)[^])*>See 1\.1<\/h3>/, local(2), missing('CaseE'), noUrl],
  'test-xrurl-first': [latexUrl('CaseI'), local(1), noUrl],
  // (xr-hyper without hyperref)
  'test-xrurl-nohyperref': [said('CaseO @, page @.', '1\\.1', 'iv'), local(1), noUrl],
  'test-xrurl-xr': [said('CaseG @, page @.', '1\\.1', 'iv'),
    new RegExp(`CaseH ${tex4htLink('test-xrurl-xr', 'x1-20001\\.1')}\\.`),
    said('CaseJ @, page @, cited @.', '1\\.1', 'iv', '1'), local(1), missing('CaseN'), noUrl],
  'test-xrurl-xr-first': [latexUrl('CaseK'), local(1), noUrl],
  'test-xrurl-xr-hyperref': [latexUrl('CaseL'),
    new RegExp(`CaseM ${tex4htLink('test-xrurl-xr-hyperref', 'x1-90001\\.1')}\\.`), local(1), noUrl],
  'test-xrurl-zref': [said('CaseZ @, page @.', '1\\.1', 'iv'), local(1)],
  // (xr's old release: an \@input of the other .aux read as written, beside
  // this document, in each context)
  'test-xrold': [said('CaseA @, included @.', '5', '6'), said('CaseB @, page @, included @.', '1\\.1', 'iv', '\\?\\?'),
    /CaseC <a href='test-xrold\/\.\.\/test-xrold\.html#x1-20001\.1'>1\.1<\/a>\./,
    said('CaseD @, included @.', '7', '8'), missing('CaseE'), said('CaseF cited @, page @.', '1', 'iv'),
    ...[['cmti-10', 'In italics'], ['cmr-8', 'In a footnote'], ['cmss-10', 'In sans-serif'], ['cmtt-10', 'In typewriter'], ['cmti-10', 'In a theorem']]
      .map(([font, context]) => new RegExp(`<span class='${font}'>${context}, 1\\.1\\.\\s*<\\/span>`)),
    /<h3 class='sectionHead'[^>]*>(?:(?!<\/h3>)[^])*>See 1\.1<\/h3>/, local(2)],
  // (xr's old release, loaded with a date, under hyperref)
  'test-xrold-hyperref': [latexUrl('CaseL'),
    /Written by tex4ht under hyperref: <a href='test-xrold\/\.\.\/test-xrold-hyperref\.html#x1-90001\.1'>1\.1<\/a>, <a href='test-xrold\/\.\.\/test-xrold-hyperref\.html#x1-90001\.1'>Two<\/a>\./,
    /Auto written by tex4ht <a href='test-xrold\/\.\.\/test-xrold-hyperref\.html#x1-90001\.1'>1\.1<\/a>\./, local(1), missing('Included')],
  // (xr's old release loaded before hyperref)
  'test-xrold-first': [latexUrl('CaseL'), missing('Included'), local(1)],
  // (both xr and xr-hyper, in each load order: each reference as with one
  // of them alone)
  'test-xrboth': [latexUrl('CaseA'),
    /CaseB <a href='test-xrboth\/\.\.\/test-xrboth\.html#x1-90001\.1'>1\.1<\/a>, auto <a href='test-xrboth\/\.\.\/test-xrboth\.html#x1-90001\.1'>1\.1<\/a>\./,
    /CaseC <a href='test-xrboth\/\.\.\/test-xrboth\.html#x1-20001\.1'>1\.1<\/a>\./,
    /CaseEarly <a href='test-xrboth\/\.\.\/test-xrboth\.html#x1-90001\.1'>1\.1<\/a>\./,
    said('CaseD @, page @.', '1\\.1', 'iv'), missing('CaseE'), said('Included @.', '3'),
    ...[['cmti-10', 'In italics'], ['cmr-8', 'In a footnote'], ['cmss-10', 'In sans-serif'], ['cmtt-10', 'In typewriter'], ['cmti-10', 'In a theorem']]
      .map(([font, context]) => new RegExp(`<span class='${font}'>${context}, 1\\.1\\.\\s*<\\/span>`)),
    /<h3 class='sectionHead'[^>]*>(?:(?!<\/h3>)[^])*>See 1\.1<\/h3>/, local(2), noUrl],
  'test-xrboth-hyper-first': [said('CaseF @, page @.', '1\\.1', 'iv'),
    /CaseG <a href='test-xrboth\/\.\.\/test-xrboth-hyper-first\.html#x1-20001\.1'>1\.1<\/a>\./, local(1), noUrl],
  'test-xrboth-old': [latexUrl('CaseH'),
    /CaseI <a href='test-xrboth\/\.\.\/test-xrboth-old\.html#x1-90001\.1'>1\.1<\/a>\./, local(1), noUrl],
  'test-xrboth-old-last': [latexUrl('CaseJ'),
    /CaseK <a href='test-xrboth\/\.\.\/test-xrboth-old-last\.html#x1-90001\.1'>1\.1<\/a>\./, missing('Included'), local(1)],
  'test-xrboth-hyper-xr': [latexUrl('CaseX'),
    /CaseY <a href='test-xrboth\/\.\.\/test-xrboth-hyper-xr\.html#x1-90001\.1'>1\.1<\/a>, auto <a href='test-xrboth\/\.\.\/test-xrboth-hyper-xr\.html#x1-90001\.1'>1\.1<\/a>\./,
    local(1), noUrl],
  'test-xrboth-old-early': [latexUrl('CaseM'),
    /CaseN <a href='test-xrboth\/\.\.\/test-xrboth-old-early\.html#x1-90001\.1'>1\.1<\/a>\./, missing('Included'), local(1)],
};

// Text after the last \hfill of a line, up to the end of the paragraph or of
// the line (\\), goes in a span that the stylesheet floats right. In a
// paragraph, the line is wrapped in a span, and in a centered paragraph,
// only that line. Covered: a list item, a centered paragraph, a figure, a
// paragraph cell, a proof before its QED box, a heading and its table of
// contents entry, a caption, and a link. Nothing is moved in a box, a
// label, a cell of one line, \dotfill, or \hrulefill, and no mark is left.
// \break, \linebreak, or a \penalty that ends the line after an \hfill
// ends the line on the page too.
const hfill = {
  'test-hfill': [
    /<p class='noindent'><span class='tex8web-hfill-line'>Name\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>Date\s*<\/span><\/span><\/p>/,
    /<p class='indent'><span class='tex8web-hfill-line'>\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>— A\./,
    /<p class='indent'><span class='tex8web-hfill-line'>\s*First line\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>right of the\s+first<\/span><br class='newline' \/><\/span><span class='tex8web-hfill-line'>Second line\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>right of the\s+second<\/span><br class='newline' \/><\/span>Third line/,
    /<span class='cmbx-10'>Bold name<\/span><span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'><span class='cmbx-10'>bold\s+date/,
    /that line\.\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>\(a\s+note\)/,
    /a\s+b\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>c\s/,
    /<\/mjx-container>\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>\(not differentiable at/,
    /Its description\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>at the\s+right/,
    /Centered left\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>centered right/,
    /<figure class='figure'>(?:(?!<\/figure>)[^])*<img [^>]*\/>\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'><img /,
    /<figcaption [^>]*>(?:(?!<\/figcaption>)[^])*A caption<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>with a note/,
    /<div class='caption'[^>]*>(?:(?!<\/div>)[^])*A subcaption<\/span><span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'><span class='cmr-9'>with a note/,
    /Before a break\s*<br class='newline' \/>\s*after the break/,
    /<p class='indent'>\s*Before a hint\s+after the hint\./,
    /in a paragraph cell\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>p/,
    /Ends in text\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>\(by a\s+lemma\)<span class='tex8web-qed'>/,
    /<span class='cmbx-10'>Centered above<\/span><br \/><span class='tex8web-hfill-line'>\s*Name\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>Date<\/span><\/span><\/p>/,
    /<p class='indent'>\s*Before\s+a\s+linebreak\s*<br class='newline' \/>\s*after the linebreak/,
    /<p class='indent'>\s*Before a penalty\s*<br class='newline' \/>\s*after the penalty/,
    /<p class='indent'>\s*Before another penalty\s*<br class='newline' \/>\s*after it/,
    /<p class='noindent'><a href='https:\/\/example\.com'>Linked left<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>linked right/,
    /<h3 class='sectionHead' id='heading-at-its-right-or-below-it'><a [^>]*class='tex8web-permalink'[^]*?<\/a>Heading\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>at its right/,
    /<a href='#heading-at-its-right-or-below-it'[^>]*>Heading\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>at its right/,
    /<a href='https:\/\/example\.com'>in a link\s*<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>linked<\/span><\/a>/,
    /^(?:(?!tex8web-hfill')[^])*(?:tex8web-hfill'(?:(?!tex8web-hfill')[^])*){22}$/,
    /^(?![^]*tex8web-(?:hfill-mark|break))/,
  ],
  'examples/complex': [/^(?:(?!\(not differentiable)[^])*(?:<span class='tex8web-hfill-gap'> <\/span><span class='tex8web-hfill'>\(not differentiable(?:(?!\(not differentiable)[^])*){2}$/],
  // (tcolorbox's after upper, from tex/tex8web-boxes.tex)
  'examples/custom': [/<span class='tex8web-hfill-gap'><\/span><span class='tex8web-hfill'><mjx-container/],
};

// A \rule in text as a box: its width a share of the text width, its height
// and raise in ems of the body size, after text in \small as well, and in a
// table cell and the title. Nine boxes and no underscores, also in <title>:
// the struts and the rule in the picture write none, and the picture's SVG
// draws its rule. With tabularray, the lines of a tblr after a \rule have
// no underscores either.
const rules = {
  'test-rule': [
    /<title>A title <\/title>/, /<h1 class='titleHead'>A title<br \/> <span class='tex8web-rule' style='--tex8web-rule-width: 1;/,
    /<p[^>]*><span class='tex8web-rule' style='--tex8web-rule-width: 1\.46635; --tex8web-rule-height: 0\.28em; --tex8web-rule-raise: 0em'><span><\/span><\/span> <\/p>/,
    /raised <span class='tex8web-rule' style='--tex8web-rule-width: 0\.02899; --tex8web-rule-height: 0\.5em; --tex8web-rule-raise: 0\.2em'><span><\/span><\/span>, a lowered one <span class='tex8web-rule' style='[^']*--tex8web-rule-raise: -0\.2em'>/,
    /A small rule <\/span><span class='tex8web-rule' style='--tex8web-rule-width: 0\.5; --tex8web-rule-height: 0\.1em; [^']*'><span><\/span><\/span> <span class='cmr-9'>in small text/,
    /<li>(?:(?!<\/li>)[^])*<span class='tex8web-rule' style='--tex8web-rule-width: 0\.92754;/,
    /<td [^>]*>(?:(?!<\/td>)[^])*and a rule <span class='tex8web-rule' style='--tex8web-rule-width: 0\.02899;/,
    /^(?:(?!tex8web-rule')[^])*(?:tex8web-rule'(?:(?!tex8web-rule')[^])*){9}$/,
    /^(?![^]*__)/,
  ],
  'test-rule-tabularray': [/<span class='tex8web-rule' style='--tex8web-rule-width: 1;/, /^(?![^]*__)/],
};

// \break, \linebreak, and \linebreak[4] end the line, in a paragraph, a
// list item, a centered paragraph, and a paragraph cell. Nothing ends the
// line at a \linebreak[2], in a box, between paragraphs, or at \hfil\break,
// and \\ ends it once. A paragraph cell is aligned by the \centering or
// \raggedleft in force at its end, or by ragged2e's \Centering or
// \RaggedLeft: from its start or its column, in a p, an m, a longtable
// column, and a \multicolumn, but not after a \raggedright or a
// \justifying, from a group
// closed before the end, from a centered environment around the table, or
// in a table inside the cell. A row that array starts before an \hline is
// still removed.
const breaks = {
  'test-breaks': [
    /Before\s+a\s+break\s*<br class='newline' \/>\s*after the break\./,
    /Before\s+a\s+linebreak\s*<br class='newline' \/>\s*after the linebreak\./,
    /Before\s+a\s+spaced\s+linebreak\s*<br class='newline' \/>\s*after it\./,
    /Before\s+a\s+demand\s*<br class='newline' \/>\s*after the demand\./,
    /Before a hint after the hint/,
    /In\s+an\s+item\s*<br class='newline' \/>\s*after the break\./,
    /Centered before\s*<br class='newline' \/>\s*centered after/,
    /in an mbox and on/,
    /long\s+enough\s+to\s+wrap\s*<br class='newline' \/>\s*after a break/,
    /^(?:(?!<br)[^])*(?:<br(?:(?!<br)[^])*){8}$/,
    /<td [^>]*style='white-space:normal; text-align:center;'>\s*<p class='noindent'>A centered cell/,
    /<td [^>]*style='white-space:normal; text-align:right;'>\s*<p class='noindent'>A\s+flush\s+right cell/,
    /<td [^>]*style='white-space:normal; text-align:left;'>\s*<p class='noindent'>A\s+plain\s+cell/,
    /<td [^>]*style='white-space:normal; text-align:center;'>\s*<p class='noindent'>Centered by the/,
    /<td [^>]*style='white-space:normal; text-align:right;'>\s*<p class='noindent'>Flush\s+right by/,
    /<td [^>]*style='white-space:normal; text-align:center; vertical-align:middle;'>\s*<p class='noindent'>Centered in an m/,
    /Before an hfil\s+after it, on the same line/,
    /<td [^>]*style='white-space:normal; text-align:left;'>\s*<p class='noindent'>Flush left in a centered/,
    /<td [^>]*style='white-space:normal; text-align:left;'>\s*<p class='noindent'>Grouped,/,
    /<td [^>]*style='white-space:normal; text-align:left;'>\s*inner/,
    /<td [^>]*style='white-space:normal; text-align:left;'>\s*<p class='noindent'>Justified in a centered/,
    /<td [^>]*style='white-space:normal; text-align:center;'>\s*<p class='noindent'>Centered in a longtable/,
    /<td [^>]*style='white-space:normal; text-align:center;'>\s*<p class='noindent'>Centered by ragged2e/,
    /<td [^>]*style='white-space:normal; text-align:right;'>\s*<p class='noindent'>Flush\s+right by ragged2e/,
    /<td [^>]*style='white-space:normal; text-align:left;'>\s*<p class='noindent'>Justified in a centered/,
    /<td [^>]*style='white-space:normal; text-align:left;'>\s*<div class='multicolumn' style='white-space:normal; text-align:center;'>A centered/,
    /<td [^>]*style='white-space:normal; text-align:left;'>\s*<div class='multicolumn' style='white-space:normal; text-align:right;'>A\s+flush\s+right/,
    /^(?![^]*<tr id=[^>]*><td [^>]*>\s*(?:<p class='noindent'><\/p>\s*)?<\/td><\/tr>)/,
    /^(?![^]*tex8web-(?:break|cell-align))/,
  ],
};

// A table's row, from the text of its cells (tags left out of it)
const cellGap = '(?:\\s|<(?!/?t[dr]\\b)[^>]*>)*', cellTag = '(?:<(?!/?t[dr]\\b)[^>]*>)*';
const cellText = text => text === null ? '(?:(?!</td>)[^])*'
  : cellGap + [...text].map(c => ({ ' ': '\\s+', '_': '(?:\u202f|&#x202F;)', '-': '\u2212', '*': '[\u22c5\u00b7]', '.': '\\.', '(': '\\(', ')': '\\)' })[c] || c).join(cellTag) + cellGap;
const dcolumn = (...cells) => new RegExp(cells.map(text => `<td[^>]*>${cellText(text)}</td>`).join('\\s*'));

// Where each table sits, from its class: at the indent of a paragraph it
// starts, at the left after text, a \noindent, or a heading, in a cell's
// line (a makecell's too), centered by center, \centering, and a float's
// \centering, flush right by flushright, a longtable by \LTleft and
// \LTright, and tabularx centered, whatever the tables in its cells.
const placed = (cls, text) => new RegExp(`<table class='${cls}' id='[^']+'[^>]*>(?:(?!<table)[^])*${text}`);
const tables = {
  'test-tabular': [
    placed('tabular tex8web-indent', 'A table that starts a paragraph'),
    placed('tabular', 'in the line'),
    placed('tabular', 'After a noindent'),
    placed('tabular tex8web-indent', '<div class=.tabular.>'),
    placed('tabular tex8web-inline', 'in a p cell'),
    placed('tabular tex8web-inline', 'in a c cell'),
    placed('tabular tex8web-inline', 'in an r cell'),
    placed('tabular tex8web-inline', 'a makecell'),
    placed('tabular tex8web-center', 'In center'),
    placed('tabular tex8web-right', 'In flushright'),
    placed('tabular tex8web-center', 'After centering'),
    placed('tabular tex8web-center', 'In a centered float'),
    placed('longtable tex8web-center', 'A longtable '),
    placed('longtable', 'A longtable at the left'),
    placed('longtable tex8web-right', 'A longtable at the right'),
    placed('tabular tex8web-center', '<p class=.noindent.>A tabularx'),
    placed('tabular tex8web-inline', 'in an X cell'),
    placed('tabular', 'After a heading'),
    // (\\[len] with array.sty's \@argarraycr)
    /In center\s*<\/td>\s*<\/tr><tr class='vspace tex8web-rowskip' style='--tex8web-rowskip: 0\.6em'>/,
  ],
  // the space that \\[len] adds below a row, in ems of the text: a row of
  // that height, before an \hline's, in a tabular and a longtable, and in
  // a tabular in the author's lines, and a line's space after the author's
  // name, whose rows tex4ht writes as lines
  'test-rowskip': [
    /0\.5em below\s*<\/td><\/tr><tr class='vspace tex8web-rowskip' style='--tex8web-rowskip: 0\.5em'><td>[^]*6pt below\s*<\/td><\/tr><tr class='vspace tex8web-rowskip' style='--tex8web-rowskip: 0\.6em'>/,
    /<table class='longtable[^]*0\.5em below\s*<\/td>\s*<\/tr><tr class='vspace tex8web-rowskip' style='--tex8web-rowskip: 0\.5em'>[^]*6pt below\s*<\/td>\s*<\/tr><tr class='vspace tex8web-rowskip' style='--tex8web-rowskip: 0\.6em'>/,
    /A\. Writer<\/span>\s*<br \/>\s*<span class='tex8web-rowskip' style='--tex8web-rowskip: 0\.5875em'><\/span>/,
    /Department of Tables\s*<\/span><\/td><\/tr><tr class='vspace tex8web-rowskip' style='--tex8web-rowskip: 0\.3em'><td>/,
    /6pt below, then a rule\s*<\/td>\s*<\/tr><tr class='vspace tex8web-rowskip' style='--tex8web-rowskip: 0\.6em'>(?:(?!<\/tr>)[^])*<\/tr><tr class='hline'>/,
    /^(?![^]*font-size:\d)/,
  ],
  // dcolumn's D columns: a row's label, then each cell's text as in the
  // PDF, with a math minus. In a pattern, '-' is that minus, '*' the dot
  // of \cdot, '_' a narrow no-break space (a thin space in TeX), and ' '
  // any space. null is any cell, '' an empty one.
  'test-dcolumn': [
    dcolumn('Plain one', '1.25'), dcolumn('Plain two', '10.5'), dcolumn('Plain minus', '-12.75'),
    dcolumn('Plain empty', ''), dcolumn('Plain integer', '3'), dcolumn('Plain point', '.5'),
    dcolumn('Label', 'Value', 'Other'),
    dcolumn('Sided one', '123.45', '0.125'), dcolumn('Sided two', '1.5', '42'),
    dcolumn('Sided minus', '-0.25', '-7.5'), dcolumn('Sided dash', null, '9.75'),
    dcolumn('Comma one', '3*14', '1,5'), dcolumn('Comma two', '2*718', '200,25'),
    dcolumn('Euro one', '3,14'), dcolumn('Euro two', '12,5'),
    dcolumn('Stars', 'A', 'B'), dcolumn('Stars one', '0.123\u2217\u2217\u2217', '-0.5\u2217'),
    dcolumn('Stars error', '(0.045)', '(0.25)'), dcolumn('Stars sym', '1.25\u2217\u2217', '10.5'),
    dcolumn('Stars wide', '0.75'),
    /123<sup>(?:<[^>]*>)*\u2217\u2217\u2217</, /25<sup>(?:<[^>]*>)*\u2217\u2217</,
    dcolumn('Dot one', '1.5', '2.25'), dcolumn('Dot two', '10.25', '3'), dcolumn('Dot last', '2.5', '30.5'),
    dcolumn('Multi one', '12.5'), dcolumn('Multi two', '1.5'), dcolumn('Multi last', '2.5'),
    dcolumn('Long one', '1.25'), dcolumn('Long two', '100.5'),
    dcolumn('Star one', '2.25'), dcolumn('Star two', '30.5'),
    dcolumn('X one', '4.25'), dcolumn('X two', '40.5'),
    dcolumn('Note one', '5.5'), dcolumn('Note two', '50.25'),
    dcolumn('Theorem one', '6.25'), dcolumn('Theorem two', '60.5'),
    dcolumn('Sans one', '7.25'), dcolumn('Sans two', '70.5'),
    dcolumn('Over one', '12.5'), dcolumn('Over minus', '-12.25'),
    dcolumn('Gap thin', '1_234.5'), dcolumn('Gap comma', '12,_345'), dcolumn('Gap text', 'not sig'),
    /Math after the tables: (?:<[^>]*>)*<mjx-container/,
  ],
  'test-dcolumn-hyperref': [
    dcolumn('Label', 'Value'), dcolumn('Linked one', '1.25'), dcolumn('Linked minus', '-12.75'),
    dcolumn('Linked integer', '3'), dcolumn('Linked thin', '1_234.5'), dcolumn('Linked comma', '12,_345'),
    // amsmath's \; and \: as a word space, or as html4-math.4ht's span of
    // their width, never as nothing
    /Linked thick(?:(?!<\/tr>)[^])*>1(?:<[^>]*>)*(?: |<span[^>]*class=.tmspace.><\/span>)(?:<[^>]*>)*234/,
    /Linked medium(?:(?!<\/tr>)[^])*>1(?:<[^>]*>)*(?: |<span[^>]*class=.tmspace.><\/span>)(?:<[^>]*>)*234/,
    /See table<span class='tex8web-nbsp'> <\/span><a href='#([^']+)'>1(?:<!--[^]*?-->)?<\/a>[^]*?<div class='table'>\s*<p[^>]*\bid='\1'/,
    /Math after the table: (?:<[^>]*>)*<mjx-container/,
  ],
};

// algorithm2e's lines as patterns: a numbered line with its words, the
// line that opens a block, starting with its keyword, and a block's div,
// with its classes after tex8web-a2e-block, holding its lines
const a2eNumber = n => String.raw`<p class='noindent'><a id='[^']+'><\/a><span class='tex8web-a2e-nl'><span class='cmbx-7'>${n}<\/span><\/span>`;
const a2eLine = (n, words) => String.raw`${a2eNumber(n)}${words.split(' ').join('\\s+')}\s*<\/p>\s*`;
const a2eHead = (n, keyword) => String.raw`${a2eNumber(n)}<span class='cmbx-10'>${keyword}<(?:(?!<\/p>)[^])*<\/p>\s*`;
const a2eOpen = classes => String.raw`<div class='tex8web-a2e-block${classes}'>\s*`;
const a2eBlock = (classes, ...lines) => String.raw`${a2eOpen(classes)}${lines.join('')}<\/div>\s*`;
const a2eBare = content => String.raw`<p class='noindent'>${content}<\/p>\s*`;
const a2e = (...parts) => new RegExp(parts.join(''));
const vline = ' tex8web-a2e-vline', hook = ' tex8web-a2e-vline tex8web-a2e-hook';

const algorithms = {
  // algorithm's ruled floats, with a space after the caption's label instead
  // of a colon. algorithmicx's lines, each with its number in its font
  // and indented by its block's depth. \Statex has neither, a line without
  // text is marked to be left out, and a \ref to a line leads to the line.
  'test-algorithmic': [
    /^(?:(?!<figure class='float tex8web-float-ruled'>)[^])*(?:<figure class='float tex8web-float-ruled'>(?:(?!<figure)[^])*){2}$/,
    /<span class='id'>Algorithm 1 <\/span><span class='content'>Binary search/,
    /<span class='tex8web-label'>\s*<span class='cmr-8'>6:<\/span>\s*<\/span><div style='--tex8web-alg-indent: 4.5em'>/,
    /<span class='tex8web-label'>\s*<\/span><div style='--tex8web-alg-indent: 0em'><a id='[^']+'><\/a>an unnumbered line/,
    /<div class='tex8web-alg-notext'>/,
    /line<span class='tex8web-nbsp'>.<\/span><a href='#([^']+)'>11[^]*<a id='\1'><\/a>\s*<span class='cmbx-10'>return/,
  ],
  // (a copy of the algorithmic package in the document's folder: each line
  // after a line break, with its number, as algorithmic.4ht sets it)
  'test-inputname-vendored': [
    /<span class='ALCitem'>1:<\/span>(?:(?!<br)[^])*first line(?:(?!<br)[^])*<br \/><span class='ALCitem'>2:<\/span>(?:(?!<br)[^])*second line(?:(?!<br)[^])*<br \/><span class='ALCitem'>3:<\/span>(?:(?!<br)[^])*a test(?:(?!<br)[^])*<br \/><span class='ALCitem'>4:<\/span>(?:(?!<br)[^])*third line/,
  ],
  // (a copy of TeX Live's cp1252.def in the document's folder, read by
  // inputenc: the degree sign as cp1252.4ht sets it, outside the TS1 font's
  // span)
  'test-inputname-vendored-def': [/An angle of 30°\./],
  // (a copy of the plain TeX macro file epsf.tex in the document's folder,
  // read with \input: the picture of \epsfbox, as epsf.4ht sets it)
  'test-inputname-vendored-epsf': [/A picture: <img alt='' src='test-inputname-vendored-epsf0x\.png' \/>/],
  // (a stand-in for a copy of the plain TeX macro file diagrams.tex, which
  // TeX Live does not ship, read with \input: the diagram a picture, as
  // diagrams.4ht sets it)
  'test-inputname-vendored-diagrams': [/A diagram: <img\b[^>]*src='test-inputname-vendored-diagrams0x\.png'/],
  // algorithm2e's, [H] and in \small text too: their style, caption
  // position, and lengths (at the body size), the caption's label and
  // separator, each line a paragraph numbered as in the PDF (the one after
  // the caption too), a block as a div with its vertical line and closing
  // rule, and a \ref to a line or to the [H] algorithm leading to it. Each
  // \RestyleAlgo style's caption in its place, and \noalgocaption's caption
  // still a link's target. With \SetAlgoNoLine, a block has no line, and
  // its end is a numbered line.
  'test-algorithm2e': [
    /^(?:(?!<figure class='tex8web-a2e )[^])*(?:<figure class='tex8web-a2e tex8web-a2e-ruled tex8web-a2e-caption-top'[^>]* style='--tex8web-a2e-margin: 1.5em; --tex8web-a2e-nlsep: 0.5em; --tex8web-a2e-hang: 0.5em; --tex8web-a2e-rule: 0.5em; --tex8web-a2e-text: 1em; --tex8web-a2e-vrule: 0.04em; --tex8web-a2e-hook: 0.34445em; --tex8web-a2e-caption: 0.75em; --tex8web-float-rule: 0.08em; --tex8web-float-midrule: 0.08em; --tex8web-float-endrule: 0.08em; --tex8web-float-sep: 0.2em; --tex8web-float-bodysep: 0.2em'>(?:(?!<figure class='tex8web-a2e )[^])*){3}(?:<figure class='tex8web-a2e (?:(?!<figure class='tex8web-a2e )[^])*){6}$/,
    /<figure class='tex8web-a2e tex8web-a2e-plain tex8web-a2e-caption-bottom'[^]*<figure class='tex8web-a2e tex8web-a2e-boxed tex8web-a2e-caption-under'[^]*<figure class='tex8web-a2e tex8web-a2e-boxruled tex8web-a2e-caption-above'[^]*<figure class='tex8web-a2e tex8web-a2e-plainruled tex8web-a2e-caption-under'[^]*<figure class='tex8web-a2e tex8web-a2e-tworuled tex8web-a2e-caption-top'[^]*<figure class='tex8web-a2e tex8web-a2e-ruled tex8web-a2e-caption-none'/,
    /<figure class='tex8web-a2e tex8web-a2e-ruled tex8web-a2e-caption-none'[^>]*>(?:(?!<\/figure>)[^])*<figcaption class='caption'[^>]*><span class='id'><a id='([^']+)'>[^]*See Algorithm<span class='tex8web-nbsp'>.<\/span><a href='#\1'>9</,
    /<figure class='tex8web-a2e tex8web-a2e-tworuled [^>]*>(?:(?!<\/figure>)[^])*<div class='tex8web-a2e-block'> <p class='noindent'><a id='[^']+'><\/a><span class='tex8web-a2e-nl'><span class='cmbx-7'>2<\/span><\/span><span class='cmbx-10'>if<(?:(?!<\/figure>)[^])*<span class='cmbx-7'>6<\/span><\/span><span class='cmbx-10'>end<\/span> <\/p> <\/div> <p class='noindent'><a id='[^']+'><\/a><span class='tex8web-a2e-nl'><span class='cmbx-7'>7<\/span><\/span><span class='cmbx-10'>end</,
    /<span class='id'><span class='cmbx-10'>Algorithm<span class='tex8web-nbsp'> <\/span>1:<\/span><span class='tex8web-nbsp'> <\/span><\/span><span class='content'>Binary search/,
    /<\/figcaption>(?:\s*<!--[^>]*-->)*\s*<p class='noindent'><span class='cmbx-10'>Input:/,
    /<div class='tex8web-a2e-block tex8web-a2e-vline tex8web-a2e-hook'>(?:\s*<!--[^>]*-->)*\s*<p class='noindent'><a id='[^']+'><\/a><span class='tex8web-a2e-nl'><span class='cmbx-7'>3<\/span><\/span>/,
    /<span class='cmbx-10'>else<\/span>\s*<\/p>\s*<div class='tex8web-a2e-block tex8web-a2e-vline tex8web-a2e-hook'>/,
    /line<span class='tex8web-nbsp'>.<\/span><a href='#([^']+)'>8<!--[^>]*--><\/a>[^]*<a id='\1'><\/a><span class='tex8web-a2e-nl'><span class='cmbx-7'>8<\/span><\/span><span class='cmbx-10'>return/,
    /<a id='([^']+)'><\/a><span class='tex8web-a2e-nl'><span class='cmbx-7'>9<\/span><\/span>remove[^]*line<span class='tex8web-nbsp'>.<\/span><a href='#\1'>9</,
    /^(?:(?!<figure class='tex8web-a2e )[^])*<figure class='tex8web-a2e [^>]*>(?:(?!<figure class='tex8web-a2e )[^])*<figure class='tex8web-a2e [^>]*>(?:(?!<\/figure>)[^])*<a id='([^']+)'>[^]*See Algorithm<span class='tex8web-nbsp'>.<\/span><a href='#\1'>2</,
    // (an [H] algorithm after another: no empty paragraph between them,
    // and the anchor that paragraph held at the top of the second)
    /^(?:(?!<p><a id='[^']+'><\/a> <\/p><div class='tex8web-minipages'>)[^])*$/,
    /<div class='tex8web-minipages'><div class='minipage [^>]*> ?<a id='[^']+r5'><\/a> ?<figure class='tex8web-a2e tex8web-a2e-boxed /,
  ],
  // the line numbers at the right
  'test-algorithm2e-rightnl': [
    /^(?:(?!<span class='tex8web-a2e-nl)[^])*(?:<span class='tex8web-a2e-nl tex8web-a2e-nl-right'><span class='cmbx-7'>\d+<\/span><\/span>(?:(?!<span class='tex8web-a2e-nl)[^])*){11}$/,
  ],
  // a blank line in a block of each style and keyword family: the block's
  // lines are paragraphs of its div, numbered as in the PDF, with no empty
  // paragraph, also when the blank line is first or last in the block,
  // follows a line without \;, or comes twice. A \ref to a line after a
  // blank line leads to it. Outside the blocks, a blank line between two
  // lines leaves them numbered 1 and 2.
  'test-algorithm2e-blank': [
    /^(?![^]*<figure class='tex8web-a2e (?:(?!<\/figure>)[^])*<p[^>]*>(?:\s|<a id='[^']+'><\/a>)*<\/p>)/,
    // (vlined: \If, then nested \For and \If)
    a2e(a2eHead(1, 'if'), a2eBlock(hook, a2eLine(2, 'line aone;'), a2eLine(3, 'line atwo;')),
      a2eHead(4, 'for'), a2eOpen(hook), a2eLine(5, 'line bone;'), a2eHead(6, 'if'),
      a2eBlock(hook, a2eLine(7, 'line btwo without a semicolon'), a2eLine(8, 'line bthree;')), '<\\/div>'),
    /Line<span class='tex8web-nbsp'>.<\/span><a href='#([^']+)'>8<!--[^>]*--><\/a>[^]*<a id='\1'><\/a><span class='tex8web-a2e-nl'><span class='cmbx-7'>8<\/span><\/span>line\s+bthree;/,
    // (\eIf, then \uIf, \ElseIf, and \Else, then \While with two blank
    // lines, a \par, and a comment)
    a2e(a2eHead(9, 'if'), a2eBlock(vline, a2eLine(10, 'line cone;'), a2eLine(11, 'line ctwo;')),
      a2eHead(12, 'else'), a2eBlock(hook, a2eLine(13, 'line cthree;'), a2eLine(14, 'line cfour;'))),
    a2e(a2eHead(15, 'if'), a2eBlock(vline, a2eLine(16, 'line uone;'), a2eLine(17, 'line utwo;')),
      a2eHead(18, 'else\\s+if'), a2eBlock(hook, a2eLine(19, 'line uthree;'), a2eLine(20, 'line ufour;')),
      a2eHead(21, 'else'), a2eBlock(hook, a2eLine(22, 'line ufive;'), a2eLine(23, 'line usix;'))),
    a2e(a2eHead(24, 'while'), a2eBlock(hook, a2eLine(25, 'line wone;'), a2eLine(26, 'line wtwo;'),
      String.raw`<p class='noindent'><span class='cmtt-10'>\/\/\s+a\s+comment(?:(?!<\/p>)[^])*<\/p>\s*`,
      a2eLine(27, 'line wthree;')), '<\\/figure>'),
    // (\SetAlgoLined: \While, then \For with \SetAlgoLongEnd)
    a2e(a2eHead(1, 'while'), a2eBlock(vline, a2eLine(2, 'line lone;'), a2eLine(3, 'line ltwo;')), a2eHead(4, 'end'),
      a2eHead(5, 'for'), a2eBlock(vline, a2eLine(6, 'line gone;'), a2eLine(7, 'line gtwo;')),
      a2eHead(8, 'end\\s+for'), '<\\/figure>'),
    // (\SetAlgoNoLine: \SetKwProg's block holding \Repeat)
    a2e(a2eHead(1, 'Function'), a2eBlock('', a2eLine(2, 'line done;'), a2eHead(3, 'repeat'),
      a2eBlock('', a2eLine(4, 'line dtwo;'), a2eLine(5, 'line dthree;')), a2eHead(6, 'until')),
      a2eHead(7, 'end'), '<\\/figure>'),
    // (outside the blocks)
    a2e(String.raw`<\/figcaption>(?:\s*<!--[^>]*-->)*\s*`, a2eLine(1, 'line eone;'), a2eLine(2, 'line etwo;'), '<\\/figure>'),
    // (without line numbers: two lines run together or apart show only
    // here, and a line numbered with \nl after a blank line is line 1)
    a2e(a2eBare(String.raw`<span class='cmbx-10'>if<(?:(?!<\/p>)[^])*`), a2eOpen(hook),
      a2eBare('line\\s+none;\\s*'), a2eBare('line\\s+ntwo;\\s*'), '<\\/div>\\s*',
      a2eBare(String.raw`<span class='cmbx-10'>if<(?:(?!<\/p>)[^])*`), a2eOpen(hook),
      a2eBare(String.raw`line\s+mone;\s*(?:<a id='[^']+'><\/a>\s*)?`),
      String.raw`<p class='noindent'>(?:<a id='[^']+'><\/a>)?<span class='tex8web-a2e-nl'><span class='cmbx-7'>1<\/span><\/span>line\s+mtwo;\s*<\/p>\s*`,
      '<\\/div>\\s*<\\/figure>(?:(?!<\\/p>)[^])*', String.raw`Line<span class='tex8web-nbsp'>.<\/span><a href='#[^']+'>1<!--[^>]*--><\/a> is numbered by hand`),
    // (blank lines between blocks and before the algorithm's end)
    a2e(a2eHead(1, 'if'), a2eBlock(hook, a2eLine(2, 'line tone;')), a2eHead(3, 'for'),
      a2eBlock(hook, a2eLine(4, 'line ttwo;')), '<\\/figure>'),
    // (procedure with \SetAlgoNoEnd: \Switch, \Case, \uIf, \Else, and \Other)
    a2e(a2eHead(1, 'switch'), a2eOpen(vline), a2eHead(2, 'case'),
      a2eBlock(vline, a2eLine(3, 'line fone;'), a2eLine(4, 'line ftwo;')),
      a2eHead(5, 'if'), a2eBlock(vline, a2eLine(6, 'line fthree;'), a2eLine(7, 'line ffour;')),
      a2eHead(8, 'else'), a2eBlock(vline, a2eLine(9, 'line ffive;'), a2eLine(10, 'line fsix;')),
      a2eHead(11, 'otherwise\\s+do'), a2eBlock(vline, a2eLine(12, 'line fseven;'), a2eLine(13, 'line feight;')),
      '<\\/div>\\s*<\\/figure>'),
    // (function with \SetNothing: \SetKwBlock's block)
    a2e(a2eHead(1, 'begin'), a2eBlock('', a2eLine(2, 'line hone;'), a2eLine(3, 'line htwo;')), '<\\/figure>'),
    // (algorithm* with \SetAlgoShortEnd and \SetAlgoLined: \ForEach, with
    // an \lIf between blank lines)
    a2e(a2eHead(1, 'foreach'), a2eBlock(vline, a2eLine(2, 'line kone;'),
      a2eNumber(3), String.raw`<span class='cmbx-10'>if<(?:(?!<\/p>)[^])*line\s+ktwo;\s*<\/p>\s*`,
      a2eLine(4, 'line kthree;')), a2eHead(5, 'end'), '<\\/figure>'),
  ],
  // the same with hyperref, and the algo2e option's environment, ruled
  'test-algorithm2e-blank-hyperref': [
    a2e(a2eHead(1, 'if'), a2eBlock(hook, a2eLine(2, 'line rone;'), a2eLine(3, 'line rtwo;')), '<\\/figure>'),
    /See line<span class='tex8web-nbsp'>.<\/span><a href='#([^']+)'>3<!--[^>]*--><\/a>[^]*<a id='\1'><\/a><span class='tex8web-a2e-nl'><span class='cmbx-7'>3<\/span><\/span>line\s+rtwo;/,
  ],
};

// mdframed's boxes: each box's rules (the second's 2pt, the third's still
// 0.4pt, the last's only at the sides), its space inside and around, and
// its colors; a box that ends at its theorem's end ends there
const mdframed = {
  'test-mdframed': [
    /#mdframed-1\{--tex8web-mdf-rules: 0.04em 0.04em 0.04em 0.04em; --tex8web-mdf-padding: 0.48em 1em 0.48em 1em; --tex8web-mdf-margin: 0.8em 0em 0.8em 0em; border-color: currentColor;/,
    new RegExp(`#mdframed-2\\{--tex8web-mdf-rules: 0.2em 0.2em 0.2em 0.2em; --tex8web-mdf-padding: 1.2em 1em 0.48em 2em; [^}]*border-color: ${lightDark('#0000FF', 'border')}; background-color: ${lightDark('#FFFFCC', 'background')};`),
    /#mdframed-3\{--tex8web-mdf-rules: 0.04em 0.04em 0.04em 0.04em;/,
    /#mdframed-4\{--tex8web-mdf-rules: 0em 0.04em 0em 0.04em; --tex8web-mdf-padding: 0.48em 1em 0.48em 1em; --tex8web-mdf-margin: 0.8em 2em 0.8em 2em;/,
    /<div class='mdframed' id='mdframed-3'> <div class='newtheorem'[^>]*>(?:(?!<\/div>)[^])*<\/div> (?:<!--[^>]*--> )?<\/div>/,
  ],
};

// fancyvrb's saved text inline: the words around it, and the text in a
// <code> in the given font, between tags that end or start other fonts
const usedVerb = (before, text, after, font) => new RegExp(`${before}\\s*(?:<\\/?span[^>]*>\\s*)*` +
  `<code class='verb'><span class='${font}'>${text}<\\/span><\\/code>\\s*(?:<\\/?span[^>]*>\\s*)*${after}`);

// Spaces in verbatim, alltt, and \verbatiminput keep the font's width. Only
// the ~ in the text is written as a space in a span.
const verbatim = {
  'test-verbatim': [/^(?:(?!tex8web-nbsp)[^])*Plain<span class='tex8web-nbsp'>(?:(?!tex8web-nbsp)[^])*$/,
    /<div class='alltt'>/, /<div class='verbatiminput'>/, /<pre class='verbatim'/],
  ...Object.fromEntries(['test-verbatim-font', 'test-verbatim-font-hyperref', 'test-verbatim-font-t1',
    'test-verbatim-font-lmodern', 'test-verbatim-font-courier',
    'test-verbatim-font-times', 'test-verbatim-font-courier-only'].map(name => [name, [
    /<code class='verb'>(?:<span[^>]*>)?vf-inline a_b#c%(?:<\/span>)?<\/code>/,
    /<code class='verb'>(?:<span[^>]*>)?vf-star␣two␣␣spaces(?:<\/span>)?<\/code>/,
    /<pre class='verbatim'[^>]*>(?:(?!<\/pre>)[^])*vf-block a_b#c%/,
    /<pre class='verbatim'[^>]*>(?:(?!<\/pre>)[^])*vf-block-star␣two␣␣spaces/,
    /<div class='verbatiminput'>(?:<span[^>]*>)?vf-file a_b #c%/,
    /<div class='verbatiminput'>(?:<span[^>]*>)?vf-file␣␣a_b␣␣#c%/,
    /<code class='verb'><span[^>]*>vf-footnote-verb<\/span><\/code>/,
    /<code class='verb'><span[^>]*>vf-small<\/span><\/code>/,
    /vf-fancy-star␣two␣␣spaces/,
    /vf-fancy-block-star␣two␣␣spaces/,
    /vf-fancy-showspaces␣two␣␣spaces/,
    /<code class='verb'>(?:<span[^>]*>)?vf-wrap-kernel a b(?:<\/span>)?<\/code>/,
    /<code class='verb'>(?:<span[^>]*>)?vf-wrap-kernel-star␣a␣␣b(?:<\/span>)?<\/code>/,
    /<code class='verb'>(?:<span[^>]*>)?vf-wrap-fancy a b(?:<\/span>)?<\/code>/,
    /<code class='verb'>(?:<span[^>]*>)?vf-wrap-fancy-star␣a␣␣b(?:<\/span>)?<\/code>/,
  ]])),
  'test-verbatim-font-kernel': [
    /<code class='verb'>[^]*\/usr\/local\/texlive\/2026\/texmf-dist\/tex\/generic\/tex4ht\/html4\.4ht/,
    /vf-kernel-star␣two␣␣spaces/, /vf-kernel-block-star␣two␣␣spaces/,
    /<span[^>]*>vf-kernel-small<\/span>/, /<span[^>]*>vf-kernel-block-small<\/span>/,
  ],
  'test-verbatim-font-moreverb': [
    /<pre class='boxedverbatim'/, /<div class='listinginput'>/, /<div class='verbatimtabinput'>/,
    /^(?:(?!tex8web-nbsp)[^])*$/,
    /<\/pre>\s*<\/td><\/tr><\/table>/,
    /<div class='listing'>[^]*vf-listing a b/,
    /<div class='listing'>[^]*vf-listingcont c d/,
    /listing-second/, /cont-second/, /file-second/,
    /<pre class='verbatim'[^>]*>(?:(?!<\/pre>)[^])*vf-tabbed tabbed-two end/,
  ],
  'test-verbatim-font-moreverb-courier': [
    /<div class='listing'>(?:(?!<\/div>)[^])*vf-listing-star␣a␣␣b/,
    /<div class='listing'>(?:(?!<\/div>)[^])*vf-listingcont-star␣c␣␣d/,
    /star-second/, /cont-star-second/,
    /<pre class='verbatim'[^>]*>(?:(?!<\/pre>)[^])*vf-reference-spaces a b/,
  ],
  // (a label that the document defines, in the preamble or the body,
  // replaces moreverb's, and each listing keeps its size)
  'test-verbatim-font-moreverb-label': [/vf-label-<\/span><span[^>]*>1<\/span>/,
    /^(?:(?!tex8web-listing-number)[^])*$/,
    /<span class='tex8web-listing-label'[^>]*>(?:<span[^>]*>)?vf-body-/,
    /:<\/span><span class='tex8web-listing-padding'> +<\/span><span class='cmtt-8'>vf-pitch-first/,
    /tex8web-sized-literal[^]*tex8web-sized-literal/],
  'test-verbatim-font-moreverb-label-sans': [/<span class='tex8web-listing-label'>1<\/span><span class='tex8web-listing-padding'> +<\/span><span[^>]*>vf-sans-listing/],
  'test-verbatim-font-smallfont': [/<span[^>]*>vf-template-inline<\/span>/,
    /<span[^>]*>vf-template-block<\/span>/],
  'test-verbatim-font-other': [/<code class='verb'>(?:<span[^>]*>)?vf-other/],
  'test-verbatim-font-sourcecodepro': [/<code class='verb'>[^]*vf-fallback-inline a b/,
    /<pre class='verbatim'[^>]*>[^]*vf-fallback-block a b/],
  'test-verbatim-font-visible': [/vf-custom-inlineXaXb/, /vf-custom-blockXaXb/,
    /vf-custom-fancyXaXb/, /vf-custom-fancy-blockXaXb/],
  // (fancyvrb's \UseVerb and \UseMVerb in each context, in the font of
  // the text around it, and the saved block after them still a display)
  'test-useverb': [usedVerb('Text', 'uv-text_a#b%', 'more\\.', 'cmtt-10'),
    new RegExp(`<h3 class='sectionHead'[^>]*>(?:(?!<\\/h3>)[^])*${usedVerb('Head', 'uv-head_h', 'end<\\/h3>', 'cmtt-10').source}`),
    new RegExp(`<span class='sectionToc'>(?:(?!<\\/a>)[^])*${usedVerb('>Head', 'uv-head_h', 'end<\\/a>', 'cmtt-10').source}`),
    usedVerb('<p[^>]*>Moving', 'uv-moving_m', 'text\\.', 'cmtt-10'),
    new RegExp(`<h4 class='subsectionHead'[^>]*>(?:(?!<\\/h4>)[^])*${usedVerb('Moving', 'uv-moving_m', 'head<\\/h4>', 'cmtt-10').source}`),
    new RegExp(`<span class='subsectionToc'>(?:(?!<\\/a>)[^])*${usedVerb('>Moving', 'uv-moving_m', 'head<\\/a>', 'cmtt-10').source}`),
    usedVerb('Note', 'uv-text_a#b%', 'end\\.', 'cmtt-8'),
    usedVerb('Theorem', 'uv-text_a#b%', 'end\\.', 'cmitt-10'),
    usedVerb('Italic', 'uv-text_a#b%', 'end\\.', 'cmitt-10'),
    usedVerb('<td[^>]*>\\s*Cell', 'uv-text_a#b%', 'end', 'cmtt-10'),
    usedVerb('Caption', 'uv-text_a#b%', 'end', 'cmtt-10'),
    usedVerb('Box', 'uv-text_a#b%', 'end', 'cmtt-10'),
    usedVerb('Star', 'uv-star␣a␣␣b', 'end\\.', 'cmtt-10'),
    usedVerb('Shape', 'uv-text_a#b%', 'end\\.', 'cmitt-10'),
    usedVerb('Small', 'uv-text_a#b%', 'end\\.', 'cmtt-9'),
    usedVerb('Command', '\\\\foo\\{x\\}&lt;&amp;&gt;', 'more\\.', 'cmtt-10'),
    usedVerb('<p[^>]*>', 'uv-text_a#b%', 'starts this paragraph\\.', 'cmtt-10'),
    new RegExp(`<dt class='description'>(?:<a id='[^']*'><\\/a>)?${usedVerb('', 'uv-text_a#b%', '<\\/dt>\\s*<dd class=\'description\'>\\s*<p[^>]*>Label text\\.', 'cmtt-10').source}`),
    /After the inline text\. <\/p>\s*<pre class='fancyvrb'[^>]*>(?:(?!<\/pre>)[^])*uv-block a_b(?:(?!<\/pre>)[^])*<\/pre>\s*<p>\s*Last line\./,
    /^(?![^]*<pre class='fancyvrb'[^]*<pre class='fancyvrb')/],
  'test-useverb-hyperref': [usedVerb('Text', 'uvh-text_a#b', 'more\\.', 'cmtt-10'),
    new RegExp(`<h3 class='sectionHead'[^>]*>(?:(?!<\\/h3>)[^])*${usedVerb('Head', 'uvh-text_a#b', 'end<\\/h3>', 'cmtt-10').source}`),
    new RegExp(`<span class='sectionToc'>(?:(?!<\\/a>)[^])*${usedVerb('>Head', 'uvh-text_a#b', 'end<\\/a>', 'cmtt-10').source}`),
    /<p[^>]*>\s*Body text\./, /^(?![^]*<pre)/],
  // (fvextra's own inline path for \SaveVerb, \UseVerb, \UseVerb*, and
  // \EscVerb; \UseVerb with extra=false, and \Verb. fvextra's \UseVerb* shows
  // no visible spaces in the PDF)
  'test-useverb-fvextra': [usedVerb('Text', 'uvx-text_a#b', 'more\\.', 'cmtt-10'),
    new RegExp(`<h3 class='sectionHead'[^>]*>(?:(?!<\\/h3>)[^])*${usedVerb('Head', 'uvx-head_h', 'end<\\/h3>', 'cmtt-10').source}`),
    new RegExp(`<span class='sectionToc'>(?:(?!<\\/a>)[^])*${usedVerb('>Head', 'uvx-head_h', 'end<\\/a>', 'cmtt-10').source}`),
    usedVerb('Plain', 'uvx-text_a#b', 'end\\.', 'cmtt-10'),
    usedVerb('Star', 'uvx-star a b', 'end\\.', 'cmtt-10'),
    usedVerb('Escaped', 'uvx-esc_e', 'end\\.', 'cmtt-10'),
    usedVerb('Verb', 'uvx-verb_v', 'end\\.', 'cmtt-10'),
    usedVerb('Breaks', 'uvx-text_a#b', 'end\\.', 'cmtt-10'),
    /^(?![^]*<pre)/],
  // (under a frame set for every block: the block without one, and the
  // saved text after it inline)
  'test-useverb-frame': [/Before the block\. <\/p> <pre class='fancyvrb' id='fancyvrb1'>(?:(?!<\/pre>)[^])*uvf-block(?:(?!<\/pre>)[^])*<\/pre> <p[^>]*>Text /,
    usedVerb('Text', 'uvf-text_a', 'more\\.', 'cmtt-10'), usedVerb('Red', 'uvf-text_a', 'end\\.', 'cmtt-10'),
    usedVerb('Filled', 'uvf-text_a', 'end\\.', 'cmtt-10'), usedVerb('Spaced', 'uvf-text_a', 'end\\.', 'cmtt-10'),
    /Red <span style='color:light-dark\(#FF0000[^']*'>\s*(?:<\/?span[^>]*>\s*)*<code class='verb'><span class='cmtt-10'>uvf-text_a<\/span><\/code>\s*(?:<\/span>\s*)*end\./],
  // (with fvextra's background color and a text color: the saved text
  // inline after a block)
  'test-useverb-fvextra-color': [/Before the block\. <\/p> <pre class='fancyvrb' id='fancyvrb1'>(?:(?!<\/pre>)[^])*uvc-block(?:(?!<\/pre>)[^])*<\/pre> <p[^>]*>Yellow /,
    usedVerb('Yellow', 'uvc-text_a', 'end\\.', 'cmtt-10'), usedVerb('Red', 'uvc-text_a', 'end\\.', 'cmtt-10'),
    /Yellow <span class='colorbox' id='colorbox1'[^>]*>\s*<code class='verb'><span class='cmtt-10'>uvc-text_a<\/span><\/code><\/span> end\./,
    /Red <span style='color:light-dark\(#FF0000[^']*'>\s*(?:<\/?span[^>]*>\s*)*<code class='verb'><span class='cmtt-10'>uvc-text_a<\/span><\/code>\s*(?:<\/span>\s*)*end\./,
    /Unextra <span style='color:light-dark\(#FF0000[^']*'>\s*(?:<\/?span[^>]*>\s*)*<code class='verb'><span class='cmtt-10'>uvc-text_a<\/span><\/code>\s*(?:<\/span>\s*)*end\./,
    /Escaped <span style='color:light-dark\(#FF0000[^']*'>\s*(?:<\/?span[^>]*>\s*)*<code class='verb'><span class='cmtt-10'>uvc-esc_e<\/span><\/code>\s*(?:<\/span>\s*)*end\./,
    /Verb <span style='color:light-dark\(#FF0000[^']*'>\s*(?:<\/?span[^>]*>\s*)*<code class='verb'><span class='cmtt-10'>uvc-verb_v<\/span><\/code>\s*(?:<\/span>\s*)*end\./],
  // (a guard: saved blocks shown as displays, each between its paragraphs,
  // and \Verb inline)
  'test-useverb-display': [
    /Before the block\. <\/p> <pre class='fancyvrb' id='fancyvrb1'>(?:(?!<\/pre>)[^])*uv-block a_b\{c\}%(?:(?!<\/pre>)[^])*uv-block-indent #1<\/span><\/span><\/pre><p> Between,/,
    usedVerb('Between,', 'uv-plain a_b', 'inline\\.', 'cmtt-10'),
    /<div class='BVerbatimInput'>(?:(?!<\/div>)[^])*uv-block-indent(?:(?!<\/div>)[^])*<\/div><p> Then a numbered one\./,
    /Then a numbered one\. <\/p><pre class='fancyvrb' id='fancyvrb2'>(?:(?!<\/pre>)[^])*uv-block a_b\{c\}%(?:(?!<\/pre>)[^])*uv-block-indent #1<\/span><\/span><\/pre><p> After the blocks\./],
};

// fancyvrb beside listings or siunitx, whose configurations load color
// after the preamble, and beside color or xcolor in the preamble: each
// environment and command of test-fvcolor-cases.ltx with its text, its
// font, its line numbers, and its frame's rules in the stylesheet. A
// listing's lines are its whole content, so stray text in it fails.
const fvLine = text => `<span class='fancyvrblineno'><a id='[^']*'></a></span><span class='fancyvrbline'>${text}</span>`;
const fvPre = lines => `<pre class='fancyvrb' id='(fancyvrb\\d+)'>${lines}</pre>`;
const fvFramed = (text, sides) => new RegExp(fvPre(fvLine(text)) + '[^]*' +
  sides.map(side => `pre#\\1\\{ border-${side}: solid 0\\.4pt; \\}`).join('\\s*'));
const fvCases = [
  /<code class='verb'><span class='cmtt-10'>fv-inline a_b#c%<\/span><\/code>/,
  /<code class='verb'><span class='cmtt-10'>fv-inline-star␣a␣␣b<\/span><\/code>/,
  /<code class='verb'><span class='cmitt-10'>fv-italic<\/span><\/code>/,
  /<span class='cmss-10'>sans <\/span><code class='verb'><span class='cmtt-10'>fv-sans<\/span><\/code>/,
  /<aside class='footnotetext[^']*'[^>]*>(?:(?!<\/aside>)[^])*<code class='verb'><span class='cmtt-8'>fv-footnote<\/span><\/code>/,
  ...[`<span class='cmtt-10'>fv-plain a_b#c%</span>`,
    `<span class='cmtt-10'>fv-commandchars </span><span class='cmitt-10'>fv-command-italic</span>`,
    `<span class='cmtt-10'>fv-star␣a␣␣b</span>`,
    `<span class='cmtt-10'>fv-saved</span>`].map(text => new RegExp(fvPre(fvLine(text)))),
  /<div class='BVerbatimInput'>\s*<span class='cmtt-10'>fv-boxed<\/span><\/div>/,
  new RegExp(fvPre(`<span class='fancyvrblineno'><a id='[^']*'></a><span class='cmr-5'>1</span></span><span class='fancyvrbline'><span class='cmtt-10'>fv-numbered-one</span></span> ` +
    `<span class='fancyvrblineno'><a id='[^']*'></a><span class='cmr-5'>2</span></span><span class='fancyvrbline'><span class='cmtt-10'>fv-numbered-two</span></span>`)),
  fvFramed(`<span class='cmtt-10'>fv-framed</span>`, ['top', 'left', 'bottom', 'right']),
  fvFramed(`<span class='cmtt-10'>fv-defined</span>`, ['top', 'bottom']),
  new RegExp(fvPre(fvLine(`<span class='cmtt-10'>vf-file a_b #c%</span>`) + ' ' + fvLine(`<span class='cmtt-10'>file-second</span>`))),
  new RegExp(`<div class='newtheorem'[^>]*>(?:(?!</div>)[^])*` + fvPre(fvLine(`<span class='cmitt-10'>fv-theorem</span>`))),
];
const fvListing = /A listing: <code class='lstinline'>(?:(?!<\/code>)[^])*fv<span class='tcrm-1000'>−<\/span>lstinline<\/span><\/code>/;
const fancyvrb = {
  'test-fvcolor-listings': [...fvCases, fvListing],
  'test-fvcolor-siunitx': [...fvCases, /A quantity: <span class='tex8web-nowrap'><mjx-container aria-label='3 m'/],
  // (the global font size, \small, and a listing's own, \footnotesize)
  'test-fvcolor-fvextra': [new RegExp(fvPre(fvLine(`<span class='cmtt-9'>fv-extra</span>`))),
    new RegExp(fvPre(fvLine(`<span class='cmtt-8'>fv-footnotesize</span>`))),
    /Inline <code class='verb'><span class='cmtt-9'>fv-extra-inline<\/span><\/code>/, fvListing],
  'test-fvcolor-color': [...fvCases, fvListing],
  // (formatcom's color on its listing, its fill and rule colors, and
  // \textcolor in the text)
  'test-fvcolor-xcolor': [...fvCases, fvListing,
    new RegExp(fvPre(fvLine(`<span class='cmtt-10'>fv-red</span>`)) + '[^]*pre#\\1\\{ color: red; \\}'),
    new RegExp(fvPre(fvLine(`<span class='cmtt-10'>fv-ruled</span>`)) +
      `[^]*pre#\\1\\{ background-color: ${lightDark('#FFFF00', 'background')};\\}` +
      `\\s*pre#\\1\\{ border-color: ${lightDark('#0000FF', 'border')};\\}`),
    new RegExp(`Inline <span style='color:${lightDark('#0000FF', 'color')};'>fv-blue-text</span>`)],
};

// The f-ligatures of fonts whose TFMs put them in other slots than their
// encoding's: each line's words, in the text with tags removed and each
// ligature character as its letters, as many times as listed. The title is
// in <title> and on the page. The sans serif line, in ecss, has T1's order
// and guards against a remap of every T1 font.
const ligature = 'off first buffer efficient fly baffle.';
const ligatures = {
  'test-xcharter': ['Efficient office staff', 'Efficient office staff', 'Baffled officers fly', ...['Upright', 'Italic', 'Bold', 'Bolditalic', 'Slanted', 'Boldslanted',
    'Smallcaps', 'Note', 'Theorem', 'Lining', 'Oldstyle', 'Tabularoldstyle', 'Tabularlining', 'Sans', 'Mono']
    .map(line => `${line}: ${ligature}`)],
  'test-xcharter-osf': ['Upright', 'Italic', 'Bold', 'Bolditalic', 'Slanted', 'Boldslanted', 'Smallcaps', 'Theorem']
    .map(line => `${line}: ${ligature}`),
  'test-xcharter-osfi': ['Upright', 'Italic', 'Bold', 'Bolditalic', 'Slanted', 'Boldslanted', 'Oldstyle',
    'Oldstyleitalic', 'Oldstyleslanted'].map(line => `${line}: ${ligature}`),
};

// the lines of ligatures[name] found fewer times than listed in a page's
// HTML, with runs of white space as one space
function ligatureProblems(name, flat) {
  const words = flat.replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).normalize('NFKC');
  const lines = ligatures[name] ?? [];
  const problems = [];
  for (const line of new Set(lines)) {
    const wanted = lines.filter(other => other === line).length, found = words.split(line).length - 1;
    if (found < wanted) problems.push(`'${line}' ${found} times in the text, not ${wanted}`);
  }
  return problems;
}

// Text after a \marginnote in the font and color around the note, and the
// note in its own: for each text, the class of the innermost font span
// around it (null for the body font), the color of the innermost element
// around it with one (null for none), and the class of an element around it.
const marginnoteBody = ['example', 'sides', 'offset', 'both', 'size', 'fontsize', 'color', 'bold', 'italic', 'family',
  'nested', 'ending', 'line', 'marginpar'].flatMap(name => [`First ${name}.`, `Second ${name}.`, `Item ${name}.`]);
const marginnotePlain = [...marginnoteBody, 'Heading example', 'After math.', 'After mid.', 'Second mid.', 'After item.',
  'Second item.', 'After cell.', 'Next row.', 'After the table.', 'Second upshape.', 'After the theorem.',
  'After the footnote mark.', 'Second sans.', 'Second typewriter.'];
const blueNote = ['cmr-5', '#0000FF', 'marginnote'];
const marginnoteCases = {
  ...Object.fromEntries(marginnotePlain.map(text => [text, [null, null]])),
  'After upshape.': ['cmti-10', null], 'After theorem.': ['cmti-10', null], 'Second theorem.': ['cmti-10', null],
  'After footnote.': ['cmr-8', null], 'After sans.': ['cmss-10', null], 'After typewriter.': ['cmtt-10', null],
  'Note sides.': ['cmr-12', '#FF0000', 'marginnote'],
  'Note offset.': ['cmr-8', '#008080', 'marginnote'], 'Note size.': ['cmr-7', null, 'marginnote'],
  'Note bold.': ['cmbx-10', null, 'marginnote'], 'Note italic.': ['cmti-10', null, 'marginnote'],
  'Note marginpar.': ['cmr-5', '#00FF00', 'marginpar'], 'Note fontsize.': ['cmr-6', '#0000FF', 'marginnote'],
  'Note color.': [null, '#00FF00', 'marginnote'], 'Note family.': ['cmss-10', null, 'marginnote'],
  'Note math.': [null, '#0000FF', 'marginnote'], 'Note sans.': ['cmss-8x-x-62', '#0000FF', 'marginnote'],
  'Note typewriter.': ['cmtt-8x-x-62', '#0000FF', 'marginnote'],
  ...Object.fromEntries(['Note example.', 'group.', 'Note line.', 'Note mid.', 'Note item.', 'Note cell.', 'Note upshape.',
    'Note theorem.', 'Note footnote.'].map(text => [text, blueNote])),
};
const marginnotes = {
  'test-marginnote': marginnoteCases,
  'test-marginnote-hyperref': { ...marginnoteCases, ...Object.fromEntries(['sidenote', 'sideoffset']
    .flatMap(name => [`First ${name}.`, `Second ${name}.`, `Item ${name}.`]).map(text => [text, [null, null]])),
    'Note sidenote.': ['cmr-5', '#0000FF', 'marginpar'], 'Note sideoffset.': ['cmr-5', '#0000FF', 'marginnote'] },
};
// (the color of the innermost element with one, of the elements open)
const colorAt = open => open.map(el => el.tag.match(/style='(?:[^']*[;\s])?color:\s*light-dark\((#[0-9A-Fa-f]{6})/)?.[1]).filter(Boolean).at(-1) ?? null;
// (the elements open at a place in the page's <main>, outermost first)
const openAt = (html, at) => {
  const open = [];
  for (const [tag, close, name] of html.slice(html.indexOf('<main'), at).matchAll(/<(\/?)([A-Za-z][\w-]*)[^>]*>/g)) {
    const last = close ? open.findLastIndex(el => el.name === name) : -1;
    if (last >= 0) open.length = last;
    else if (!close && !tag.endsWith('/>') && !/^(?:br|img|hr|meta|link|input|col|wbr)$/.test(name)) open.push({ name, tag });
  }
  return open;
};
function marginnoteProblems(name, flat) {
  const problems = [];
  if (!marginnotes[name]) return problems;
  for (const [text, [font, color, within]] of Object.entries(marginnotes[name])) {
    const at = flat.indexOf(text);
    if (at < 0) { problems.push(`no '${text}'`); continue; }
    const open = openAt(flat, at);
    const classOf = el => el.tag.match(/class='([^']*)'/)?.[1] ?? '';
    const shown = open.filter(el => el.name === 'span' && /-\d+(?:x-x-\d+)?$/.test(classOf(el))).map(classOf).at(-1) ?? null;
    if (shown !== font) problems.push(`'${text}' in the font ${shown}, not ${font}`);
    if (colorAt(open) !== color) problems.push(`'${text}' in the color ${colorAt(open)}, not ${color}`);
    if (within && !open.some(el => classOf(el).split(' ').includes(within))) problems.push(`'${text}' not in a ${within}`);
  }
  // (the inline and the display formula after a colored note)
  const from = flat.indexOf('Note math.');
  const math = [...flat.slice(from, flat.indexOf('After math.')).matchAll(/<mjx-container/g)];
  if (math.length !== 2) problems.push(`${math.length} formulas after 'Note math.', not 2`);
  for (const { index } of math) {
    const color = colorAt(openAt(flat, from + index));
    if (color) problems.push(`a formula after 'Note math.' in the color ${color}`);
  }
  return problems;
}

// the fonts listed in data-fonts on the inline script
const fontsListed = html => (html.match(/<script [^>]*data-fonts=["']([^"']*)["']/)?.[1] ?? '').split(/\s+/).filter(Boolean);

// The fonts preloaded, and no others: the text's faces (bold headings,
// italic, \texttt, and \verb) and the MathJax fonts that the math uses.
const preloads = {
  'test': ['lmroman10-regular', 'lmroman10-bold', 'lmroman10-italic', 'lmroman10-bolditalic',
    'lmmono10-regular', 'lmsans10-regular', ...['zero', 'n', 'i', 'b', 'c', 'mi', 'v', 'lo', 'so', 's3', 's4', 'brk']
      .map(font => `mathjax/mjx-tex-${font}`)],
  // (the table of contents' sans-serif, bold and italic entries)
  'test-tocloft': ['lmroman10-regular', 'lmroman10-bold', 'lmroman10-italic', 'lmmono10-regular',
    'lmsans10-regular'],
  // (headings in their \@startsection fonts: a section in sans-serif
  // italic, and a paragraph in italic; and memoir's, with a part's and a
  // chapter's bold labels above their regular and italic titles)
  'test-secfont': ['lmroman10-regular', 'lmroman10-bold', 'lmroman10-italic', 'lmsans10-oblique'],
  'test-memoirfonts': ['lmroman10-regular', 'lmroman10-bold', 'lmroman10-italic'],
  // (a chapter's \titleformat, in sans-serif's regular face)
  'test-titlechapter': ['lmroman10-regular', 'lmroman10-bold', 'lmsans10-regular'],
  // (Times, Helvetica, and Courier: TeX Gyre's faces, for the controls too,
  // as for sans-serif text; MathJax's Termes, as the math is in Times)
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

// The text fonts, each in its role, with rules for tex4ht's classes of
// them: TeX Gyre for Times, Helvetica, and Courier, and XCharter for
// Charter. A font chosen in the text keeps its family, and the text is in
// sans-serif when \familydefault is.
const families = {
  'test-times': ['@font-face { font-family: "TeX Gyre Termes"; src: url("fonts/texgyretermes-regular.woff2") format("woff2"), url("fonts/texgyretermes-regular.otf") format("opentype"); }',
    ':root { --tex8web-roman: "TeX Gyre Termes", "Latin Modern Roman", serif; }',
    ':root { --tex8web-sans: "TeX Gyre Heros", "Latin Modern Sans", sans-serif; }',
    ':root { --tex8web-mono: "TeX Gyre Cursor", "Latin Modern Mono", monospace; }',
    '[class^="phv"], [class*="-phv"], [class^="qhv"], [class*="-qhv"] { font-family: var(--tex8web-sans); }'],
  'test-sans': ['html body { font-family: var(--tex8web-sans); }',
    '[class^="cmr"], [class*="-cmr"]'],
  'test-verbatim-font-moreverb-label-sans': ['.tex8web-listing-label { font-family: var(--tex8web-sans); }'],
  'test-newtx': ['[class^="ntx-"], [class*="-ntx-"] { font-family: var(--tex8web-roman); }',
    '[class^="qhv"], [class*="-qhv"] { font-family: var(--tex8web-sans); }'],
  'test-charter': [':root { --tex8web-roman: "XCharter", "Latin Modern Roman", serif; }',
    '[class^="bch"], [class*="-bch"], [class^="XCharter"], [class*="-XCharter"] { font-family: var(--tex8web-roman); }',
    '[class*="-ntx-"] { font-family: "TeX Gyre Termes"; }'],
  // (the title's \fontfamily{bch})
  'examples/complex': ['[class*="-XCharter"] { font-family: "XCharter"; }'],
  'test-titlefont': ['[class^="bch"], [class*="-bch"]', ':root { --tex8web-title-size: 1em; }'],
};

// Text between blocks at the top of the page, which make4ht's fixinlines
// puts in a paragraph. fixinlines runs before the text is moved into
// <main>, as fixinlines looks only at the top level of the body.
const loose = {
  'test-generic': [/<\/div><p> See \(<a href=/],
  'test-tcolorbox': [/<\/div><p> See Theorem<span class='tex8web-nbsp'> <\/span>/],
};

// Text in other sizes in an 11pt document: each formula at the size of the
// text around it, \small's 10pt, \large's 12pt, and \footnotesize's 9pt over
// the body's 10.95pt, and none in the title or a heading, whose words are
// at the heading's size. Lists, theorems, and algorithms in that text are
// spaced in ems of the body, the size of the blocks they are in: a list's
// \topsep of 4pt in a note and 6pt in \small, a theorem's 9pt, which
// \small leaves, algorithmicx's 2pt and 15pt indent at \small, and the
// padding of tcolorbox (3mm by 5mm) and mdframed (5.44pt by 10pt).
const sized = size => `<span class='mathjax-inline' style='--tex8web-math-size: ${size.replace('.', '\\.')}'><mjx-container aria-label`;
const sizes = {
  'test-localsize': [
    /<h1 class='titleHead'>Groups of order <mjx-container/, /<\/a>Sizes of <mjx-container/,
    new RegExp(`An abstract with </span>${sized('0.91324')}`),
    /and a display <\/span><span class='mathjax-block' style='--tex8web-math-size: 0\.91324'><mjx-container/,
    new RegExp(`Large text with </span><span class='tex8web-nowrap'>${sized('1.09589')}`),
    new RegExp(`A note with </span>${sized('0.82191')}`),
    new RegExp(`Small text with </span><span class='tex8web-nowrap'>${sized('0.91324')}`),
    new RegExp(`A small theorem with </span><span class='tex8web-nowrap'>${sized('0.91324')}`),
    /<div class='mathjax-env mathjax-align' style='--tex8web-math-size: 0\.91324'><mjx-container/,
    /--tex8web-list-topsep: 0\.3653em; --tex8web-list-itemsep: 0\.3653em; --tex8web-list-indent: 2\.5em; --tex8web-list-labelsep: 0\.5em'>[^]*?first/,
    /--tex8web-list-topsep: 0\.54794em; --tex8web-list-itemsep: 0\.54794em; --tex8web-list-indent: 2\.5em; --tex8web-list-labelsep: 0\.5em'>[^]*?one/,
    /<div class='newtheorem' style='margin-top: 0\.82191em; margin-bottom: 0\.82191em'>[^]*?A small theorem/,
    /<div class='algorithmic tex8web-list' style='--tex8web-list-topsep: 0\.18265em; [^']*--tex8web-list-labelsep: 0\.45662em'>/,
    /<div style='--tex8web-alg-indent: 1\.36986em'>/,
    /--tcb-padding: 0\.77953em 1\.29921em 0\.77953em 1\.29921em;/,
    /--tex8web-mdf-padding: 0\.4968em 0\.91324em 0\.4968em 0\.91324em;/,
  ],
};

// The space around captions, from \abovecaptionskip (10pt) and
// \belowcaptionskip (0pt): the kernel's above a caption, whether it is
// below a figure or above a table; with the caption package, the other way
// round for the caption at the top of a table, and subcaption's skip of
// 6pt above a subcaption
const caption = (before, after, text) => new RegExp(`class='caption' style='--tex8web-caption-before: ${before}; --tex8web-caption-after: ${after}'>(?:(?!</(?:figcaption|div)>)[^])*${text}`);
const captions = {
  'test-blockspace': [caption('0\\.83333em', '0em', 'A picture, with'), caption('0\\.83333em', '0em', 'A table, with')],
  'test': [caption('0em', '0\\.91324em', 'A table with math'), caption('0\\.54794em', '0em', 'One\\.')],
};

// Glossaries, which makeglossaries sorts: each entry with its description,
// in order, and each \gls linked to its entry with hyperref. Acronyms on
// first and later use, in the text and in a footnote; a footnote-style
// acronym's long form in the footnote. (The location numbers are not
// links.)
const entry = (id, name, description) =>
  `<a id='glo_${id}'><\\/a><span class='cmbx-10'>${name}<\\/span>\\s*<\\/dt><dd class='description'>\\s*<p class='noindent'>${description}`;
const glossary = (title, ...entries) => new RegExp(`>${title}<\\/h3>\\s*<dl class='description'[^>]*>(?:(?!<\\/dl>)[^])*`
  + entries.join('(?:(?!<\\/dl>)[^])*'));
const gls = (id, text) => `<a class='glossary' href='#glo_${id}'>${text}<\\/a>`;
// (glossaries-extra prints "This document is incomplete" in place of a
// glossary whose file is missing; glossaries prints nothing)
const complete = /^(?![^]*This document is incomplete)/;
const glossaries = {
  'test-glossaries': [
    complete,
    new RegExp(`A ${gls('group', 'group')} has inverses\\. ${gls('group', 'Group')} theory studies ${gls('group', 'groups')}\\.`),
    new RegExp(`Every ${gls('field', "<span class='cmti-10'>field</span>")} is a ${gls('ring', "<span class='cmss-10'>ring</span>")}, and ${gls('ring', 'Rings')} are ${gls('ring', "<span class='cmtt-10'>rings</span>")} too\\.`),
    new RegExp(`<aside class='footnotetext[^]*${gls('gcd', "<span class='cmr-8'>greatest common divisor \\(GCD\\)</span>")}[^]*</aside>`),
    new RegExp(`Computing the ${gls('lcm', 'least common multiple \\(LCM\\)')}\\s*<\\/h3>`),
    new RegExp(`The ${gls('gcd', 'GCD')} of two numbers divides their ${gls('lcm', 'LCM')}; a ${gls('gcd', 'GCD')} again\\.`),
    new RegExp(`Theorem 1\\.[^]*${gls('etale', "<span class='cmti-10'>étale</span>")}[^]*${gls('field', "<span class='cmti-10'>fields</span>")}[^]*${gls('marks', "<span class='cmti-10'>bang!at@bar—quote”</span>")}`),
    new RegExp(`The number <a class='glossary' href='#glo_pi'><mjx-container[^]*is not in ${gls('hom', 'Hom')}\\.`),
    // (the name with makeindex's special characters sorts by its own text,
    // and étale by its sort key, after it)
    glossary('Glossary', entry('marks', 'bang!at@bar—quote”', 'a name with makeindex’s special characters\\.'),
      entry('etale', 'étale', 'flat and unramified\\.'), entry('field', 'field', 'a ring whose nonzero'),
      entry('group', 'group', 'a set with an associative operation, an identity, and inverses\\.'),
      entry('ring', 'ring', 'an abelian group with a second, distributive operation\\.')),
    /^(?![^]*glo_unused)/,
    // (the long style's table, after hyperref's anchor)
    /<h3[^>]*>(?:(?!<\/h3>)[^])*>Acronyms<\/h3>(?:(?!<table|<h3)[^])*<div class='longtable'>\s*<table(?:(?!<\/table>)[^])*<a id='glo_gcd'><\/a>GCD(?:(?!<\/table>)[^])*<\/td><td [^>]*>\s*<p class='noindent'>greatest common divisor\.(?:(?!<\/table>)[^])*<a id='glo_lcm'><\/a>LCM(?:(?!<\/table>)[^])*<\/td><td [^>]*>\s*<p class='noindent'>least common multiple\./,
    // (the super style's table, and the index style's paragraphs)
    /<h3[^>]*>(?:(?!<\/h3>)[^])*>Symbols<\/h3>\s*<div class='supertabular'>\s*<table class='tabular'(?:(?!<\/table>)[^])*<a id='glo_pi'><\/a><mjx-container(?:(?!<\/table>)[^])*<\/td><td [^>]*>\s*the ratio of a circle’s circumference to its diameter\./,
    /<h3[^>]*>(?:(?!<\/h3>)[^])*>Notation<\/h3>\s*<p class='noindent'><a id='glo_hom'><\/a><span class='cmbx-10'>Hom\s*<\/span>the set of homomorphisms\./,
    // (G-set's description uses monoid, and monoid's semigroup, which
    // makeglossaries sees only on its second and third runs)
    glossary('Glossary', entry('gset', 'G-set', `a set on which a ${gls('monoid', 'monoid')} acts\\.`),
      entry('monoid', 'monoid', `a ${gls('semigroup', 'semigroup')} with an identity\\.`),
      entry('semigroup', 'semigroup', 'a set with an associative operation\\.')),
  ],
  // (tex4ht's table of contents holds the heading's text, without the
  // \gls link, so the sidebar has no link in a link)
  'test-glossaries-toc': [
    /<div class='tableofcontents'><span class='sectionToc'><span class='tocnumber'>1<\/span><a href='#every-group'[^>]*>Every group<\/a><\/span>/,
    new RegExp(`Every ${gls('group', 'group')}<\\/h3>`),
    // (the toc option's lines, the symbols glossary's only after it first
    // has an entry, which another entry's description uses)
    /<a href='#glossary'>Glossary<\/a><\/span><br \/><span class='sectionToc'><span class='tocnumber'><\/span><a href='#symbols'>Symbols<\/a>/,
    /<h3 class='likesectionHead' id='glossary'>/, /<h3 class='likesectionHead' id='symbols'>/,
    glossary('Symbols', entry('unit', 'u', 'the identity of a group\\.')),
  ],
  // (a makeindex or xindy style file next to the document, which prints a
  // line)
  'test-glossaries-ist': [
    new RegExp(`>Glossary<\\/h3>\\s*<p [^>]*>Sorted with our own style\\.[^]*${entry('group', 'group', 'a set with an associative operation\\.')}`),
  ],
  'test-glossaries-xdy': [
    new RegExp(`>Glossary<\\/h3>\\s*<p [^>]*>Sorted with our own style\\.[^]*${entry('group', 'group', 'a set with an associative operation\\.')}`),
  ],
  // (sorted by xindy, étale by its UTF-8 name; without hyperref, no links)
  'test-glossaries-xindy': [
    complete,
    glossary('Glossary', entry('abelian', 'abelian', 'with a commutative operation\\.'), entry('etale', 'étale', 'flat and unramified\\.'),
      entry('group', 'group', 'a set with an associative operation\\.')),
    glossary('Acronyms', entry('gcd', 'GCD', 'greatest common divisor\\.')),
    /The GCD<span class='footnote-mark'>[^]*divides, and the GCD again\.[^]*<span class='cmr-8'>greatest common divisor<\/span><\/p><\/aside>/,
    /^(?![^]*class='glossary')/,
  ],
  // (glossaries-extra's abbreviations, with no period after a description)
  'test-glossaries-extra': [
    complete,
    new RegExp(`The ${gls('gcd', 'greatest common divisor \\(GCD\\)')}, then the ${gls('gcd', 'GCD')}\\.`),
    new RegExp(`The LCM<span class='footnote-mark'>[^]*then the ${gls('lcm', 'LCM')}\\. In short ${gls('gcd', 'GCD')}, in full ${gls('lcm', 'least common multiple')}\\.`),
    /<span class='cmr-8'>least common multiple<\/span><\/p><\/aside>/,
    glossary('Glossary', entry('group', 'group', 'a set with an associative operation 1')),
    glossary('Abbreviations', entry('gcd', 'GCD', 'greatest common divisor 1'), entry('lcm', 'LCM', 'least common multiple 1')),
  ],
  // (sorted by LaTeX, which needs no makeglossaries step)
  'test-glossaries-noidx': [
    complete,
    new RegExp(`A ${gls('ring', 'ring')} is a ${gls('group', 'group')}\\. The ${gls('gcd', 'greatest common divisor \\(GCD\\)')}, then the ${gls('gcd', 'GCD')}\\.`),
    glossary('Glossary', entry('group', 'group', 'a set with an associative operation\\.'), entry('ring', 'ring', 'a set with two operations\\.')),
    glossary('Acronyms', entry('gcd', 'GCD', 'greatest common divisor\\.')),
  ],
  // (each glossary as sorted in the build folder, with a stale sorted file
  // beside the document)
  'test-staleaux-ind-input': [glossary('Glossary', entry('fruit', 'fruit', 'the seed-bearing part of a plant\\. 1'))],
  // (the .gls shipped with a document without \makeglossaries)
  'test-staleaux-ind-shipped': [glossary('Glossary', entry('fruit', 'fruit', 'the seed-bearing part of a plant\\. 1'))],
  'test-staleaux-ind-gls': [
    glossary('Glossary', entry('fruit', 'fruit', 'the seed-bearing part of a plant\\. 1')),
    glossary('Acronyms', entry('tla', 'TLA', 'three-letter acronym\\. 1')),
    glossary('Symbols', entry('pi', 'pi', 'a circle’s circumference over its diameter\\. 1')),
    glossary('Numbers', entry('seven', 'seven', 'the number of days in a week\\. 1')),
    glossary('Notation', entry('hom', 'Hom', 'the set of homomorphisms\\. 1')),
    glossary('Terms', entry('ring', 'ring', 'a set with two operations\\. 1'))],
  // (without hyperref, glossaries-extra puts an empty paragraph with an
  // anchor before each list)
  'test-staleaux-ind-abr': [complete,
    new RegExp(`>Glossary<\\/h3>(?:(?!<h3)[^])*${entry('fruit', 'fruit', 'the seed-bearing part of a plant 1')}`),
    new RegExp(`>Abbreviations<\\/h3>(?:(?!<h3)[^])*${entry('tla', 'TLA', 'three-letter abbreviation 1')}`)],
  // (files of the document named like the glossaries package, and like
  // glossary.4ht, read before or after the package: each file's text, and
  // the package's glossary with its entry, linked to with hyperref)
  ...Object.fromEntries(['test-inputname-glossaries', 'test-inputname-glossaries-first'].map(name => [name, [
    /A ring\. Text from the glossaries file\./,
    glossary('Glossary', entry('ring', 'ring', 'a set with two operations\\.')),
  ]])),
  'test-inputname-glossaries-hyperref': [
    new RegExp(`A ${gls('ring', 'ring')}\\. Text from the glossaries file\\. Text from the glossary file\\.`),
    /^(?![^]*<\/html>[^]*<\/html>)/,
    glossary('Glossary', entry('ring', 'ring', 'a set with two operations\\.')),
  ],
  'test-inputname-glossaries-first-hyperref': [
    new RegExp(`A ${gls('ring', 'ring')}\\. Text from the glossaries file\\.`),
    glossary('Glossary', entry('ring', 'ring', 'a set with two operations\\.')),
  ],
};

// Each table, with how a failure reads, and whether its patterns are also
// matched against the stylesheet
const patterns = [
  [typeset, 'in the typeset math'], [speech, 'in the speech'], [pictures, 'among the pictures'],
  [titles, "as the page's title"], [dates, 'as the date'], [minipages, 'among the minipages'], [index, 'in the index'],
  [contents, 'in the page'], [fonts, "in the text's own font"], [colors, 'among the colors', true], [qed, 'around the QED boxes'],
  [lists, 'among the lists'], [hfill, 'after an \\hfill'], [rules, 'among the rules'], [breaks, 'at the line breaks'], [thin, 'at the thin spaces'], [ties, 'at the no-break spaces'], [verbatim, 'in the verbatim text'], [terms, 'among the terms'],
  [permalinks, 'among the links'], [loose, 'in a paragraph'], [algorithms, 'in the algorithms'], [tables, 'among the tables'],
  [mdframed, "in mdframed's boxes", true], [sizes, 'in the resized text', true], [captions, 'around the captions'],
  [bibliographies, 'in the bibliography'],
  [urls, 'among the URLs', true], [numbers, 'in the equation numbers'],
  [external, 'among the references to another document'],
  [glossaries, 'in the glossaries'],
  [surds, 'at the square root signs'],
  [drivers, 'with the driver option', true],
  [fancyvrb, "in fancyvrb's verbatim text", true],
];

// Floats under hypcap, which moves a float's link target to its top: each
// caption's and subcaption's text, other text the page must hold, and each
// paragraph's text as in the PDF, with the caption of the float that each
// link's target is in (null for a target outside a float). A paragraph with
// no list of targets is checked for its text only. test-hypcap-none is
// test-hypcap without hypcap.
const hypcapPairs = [
  ['Cref: fig. 1; fig. 1a; Figure 1b; fig. 2; table 1; fig. 3; fig. 3a; program 1; section 1.',
    ['First figure', 'First figure', 'First figure', 'Second figure', 'First table', 'Wide figure', 'Wide figure', 'A program', null]],
  ['Range: figs. 1 to 3.'],
  ['Ref: 1; 1a; 2; 1; 3; 1.', ['First figure', 'First figure', 'Second figure', 'First table', 'Wide figure', 'A program']],
  ['Autoref: Figure 1; Table 1.', ['First figure', 'First table']],
  ['In italics, fig. 2.', ['Second figure']], ['In a footnote, table 1.', ['First table']],
  ['In a theorem, fig. 3.', ['Wide figure']],
  ['Subref: (a); (b); (a).'],
];
const hypcapMain = {
  captions: ['Figure 1: First figure', 'Fig. 2: Second figure', 'Table 1: First table', 'Figure 3: Wide figure', 'Program 1: A program'],
  texts: ['(a) Left half', '(b) Right half', '(a) Upper part', '(b) Lower part', '(a) Wide half'],
  refs: hypcapPairs,
};
const hypcap = {
  'test-hypcap': hypcapMain, 'test-hypcap-none': hypcapMain,
  'test-hypcap-hyperref': {
    captions: ['Figure 1: First figure', 'Figure 2: Wide figure', 'Table 1: First table', 'Table 2: Wide table',
      'Figure 3: Left', 'Figure 4: Right', 'Figure 5: Inner label'],
    refs: [['Ref: 1; 2; 1; 2.', ['First figure', 'Wide figure', 'First table', 'Wide table']],
      ['Autoref: Figure 1; Figure 2; Table 1; Table 2.', ['First figure', 'Wide figure', 'First table', 'Wide table']],
      ['More: 3; Figure 5.', ['Left', 'Inner label']], ['Second caption: 4.']],
  },
  'test-hypcap-capstart': {
    captions: ['Figure 1: First figure', 'Figure 2: Second figure', 'Table 1: First table'],
    refs: [['Ref: 1; 2; 1.', ['First figure', 'Second figure', 'First table']],
      ['Autoref: Figure 1; Figure 2; Table 1.', ['First figure', 'Second figure', 'First table']]],
  },
  'test-hypcap-subcaption': {
    captions: ['(a) Left half', '(b) Right half', 'Figure 1: First figure', 'Fig. 2: Second figure', 'Table 1: First table',
      'Figure 3: Outside'],
    refs: [['Cref: fig. 1; fig. 1a; Figure 1b; fig. 2; table 1.', ['First figure', 'First figure', 'First figure', 'Second figure', 'First table']],
      ['Range: figs. 1 and 2.'], ['Ref: 1; 1a; 1b; 1.', ['First figure', 'First figure', 'First figure', 'First table']],
      ['More: fig. 3; a; b.', ['Outside', 'First figure', 'First figure']]],
  },
  'test-hypcap-topcapt': {
    captions: ['Table 1: Top table', 'Figure 1: Split figure', 'Table 2: Second table'],
    texts: ['(a) Left half', '(b) Right half'],
    refs: [['Ref: 1; 1; 2.', ['Top table', 'Split figure', 'Second table']],
      ['Autoref: Table 1; Figure 1; Table 2.', ['Top table', 'Split figure', 'Second table']],
      ['Sub: 1(a); 1(b).', ['Split figure', 'Split figure']], ['Section: 1.', [null]]],
  },
  'test-hypcap-report': {
    captions: ['Figure 1.1: Long title', 'Figure 2.1: Second figure'],
    texts: ['1.1 Short', '2.1 Second figure'],
    refs: [['Cref: fig. 1.1; Figure 2.1.', ['Long title', 'Second figure']], ['Ref: 1.1; 2.1.', ['Long title', 'Second figure']]],
  },
};
const plain = text => text.replace(/<!--[^]*?-->/g, '').replace(/<[^>]*>/g, '').replace(/[\s ]+/g, ' ').trim();
function hypcapProblems(html, { captions, texts = [], refs }) {
  const problems = [];
  // (each caption's position, to find the first float caption, the first
  // with a colon, after a link's target. A figure's caption after
  // subcaption's subfigures is a <div>, as are subcaptions)
  const at = [...html.matchAll(/<(figcaption|div class='caption')[^>]*>([^]*?)<\/(?:figcaption|div)>/g)]
    .map(match => [match.index, plain(match[2])]);
  const found = at.map(([, text]) => text);
  if (found.join('|') !== captions.join('|')) problems.push(`the captions read '${found.join("|")}'`);
  const all = plain(html);
  for (const text of texts) if (!all.includes(text)) problems.push(`the page does not read '${text}'`);
  const opens = [...html.matchAll(/<figure[ >]/g)].map(match => match.index);
  const closes = [...html.matchAll(/<\/figure>/g)].map(match => match.index);
  const named = ([, text]) => text.includes(': ');
  // the caption of the float that holds the target at index: the first
  // caption after it in its <figure>, or in the next <figure> when only tags
  // come between them. tex4ht puts some floats' anchors right before their
  // <figure>. A target before a caption outside floats (\captionof) lands
  // on that caption.
  function landing(index) {
    const open = opens.findLast(position => position < index);
    if (open !== undefined && closes.find(position => position > open) > index) {
      const close = closes.find(position => position > index);
      return at.find(caption => named(caption) && caption[0] > index && caption[0] < close)?.[1] ?? 'no caption after';
    }
    const next = at.find(caption => named(caption) && caption[0] > index);
    const nextOpen = opens.find(position => position > index);
    if (nextOpen !== undefined && (!next || nextOpen < next[0])) {
      if (plain(html.slice(html.indexOf('>', index) + 1, nextOpen))) return 'outside';
      const close = closes.find(position => position > nextOpen);
      return at.find(caption => named(caption) && caption[0] > nextOpen && caption[0] < close)?.[1] ?? 'no caption after';
    }
    return next?.[1] ?? 'outside';
  }
  const paragraphs = [...html.matchAll(/<p [^>]*>([^]*?)<\/p>/g)].map(([, inner]) => inner);
  for (const [sentence, targets] of refs) {
    const inner = paragraphs.find(p => plain(p).includes(sentence));
    if (inner === undefined) { problems.push(`no paragraph reads '${sentence}'`); continue; }
    if (!targets) continue;
    const links = [...inner.matchAll(/<a ([^>]*)>/g)].map(([, attrs]) => attrs)
      .filter(attrs => !/tex8web-permalink|href='#fn/.test(attrs) && /href='#[^']/.test(attrs))
      .map(attrs => attrs.match(/href='#([^']+)'/)[1]);
    const landed = links.map(id => {
      const index = html.search(new RegExp(` id='${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
      if (index < 0) return 'no target';
      return landing(index).replace(/^[^:]*: /, '');
    });
    const wanted = targets.map(target => target ?? 'outside');
    if (landed.join('|') !== wanted.join('|')) problems.push(`the links of '${sentence}' land in '${landed.join("|")}'`);
  }
  return problems;
}

// References to appendix chapters, and to sections and equations in them:
// a paragraph's text as in the PDF, with the id of the heading that each
// of its links goes to (null for a link not checked). A pattern is matched
// against the page.
const toc = (number, id, title) => `<span class='appendixToc'><span class='tocnumber'>${number}</span><a href='#${id}'[^>]*>${title}</a>`;
const appendixRefs = {
  'test-appref': [
    ['Before: A; B; C; A.1; (A.1); 1.', ['extra', 'second-extra', 'short', 'more', null, 'main']],
    ['In italics, A; in sans-serif, B; in typewriter, C.', ['extra', 'second-extra', 'short']],
    ['In a footnote, B.', ['second-extra']], ['In a theorem, C.', ['short']],
    ['Here A. Main is 1.', ['extra', 'main']], ['In B: B; A.1.', ['second-extra', 'more']],
    // (a label after \chapter* takes the last number outside a group, as in
    // the PDF)
    ['After: A; B; C; (C.1); starred C.', ['extra', 'second-extra', 'short', null, null]],
    // (tex4ht may write a \ref in a heading without its link)
    /<h3 class='sectionHead' id='[^']+'>(?:(?!<\/h3>)[^])*About appendix (?:<a href='#extra'>)?A(?:<!--(?:(?!-->)[^])*-->)?(?:<\/a>)?<\/h3>/,
    // (the contents entries of appendix chapters, with a short title)
    new RegExp(`${toc('A', 'extra', 'Extra')}[^]*${toc('B', 'second-extra', 'Second extra')}[^]*${toc('C', 'short', 'Short')}`),
  ],
  'test-appref-hyperref': [
    ['Ref: A; B; A.1; (A.1); 1.', ['extra', 'second-extra', 'more', null, 'main']],
    ['Autoref: Appendix A; Appendix B; Appendix A.1; Equation A.1; chapter 1.', ['extra', 'second-extra', 'more', null, 'main']],
    ['Cref: chapter A; chapter B; section A.1; eq. (A.1); chapter 1.', ['extra', 'second-extra', 'more', null, 'main']],
    ['Capital Cref: Chapter A; Chapter B; Section A.1; Equation (A.1).', ['extra', 'second-extra', 'more', null]],
    ['Nameref: Extra; Second extra.', ['extra', 'second-extra']],
    ['Here A.', ['extra']], ['In B: Appendix B.', ['second-extra']],
  ],
  ...Object.fromEntries(['book', 'memoir', 'scrbook'].map(name => [`test-appref-${name}`, [
    ['Ref: A; B; A.1; (A.1); 1.', ['extra', 'second-extra', 'more', null, 'main']],
    ['Autoref: Appendix A; Appendix B; Appendix A.1.', ['extra', 'second-extra', 'more']],
    ['Here A.', ['extra']], ['In B: B.', ['second-extra']],
  ]])),
  'test-appref-scrreprt': [
    ['Ref: A; B; A.1; (A.1); 1.', ['extra', 'second-extra', 'more', null, 'main']],
    ['Cref: chapter A; Chapter B.', ['extra', 'second-extra']],
    // (a label after \chapter* takes the last number, as in the PDF)
    ['Starred: B.1.', [null]],
    ['Here A.', ['extra']], ['In B: B.', ['second-extra']],
  ],
  'test-appref-roman': [
    ['Ref: I; II; I.1; 1.', ['extra', 'second-extra', 'more', 'main']],
    ['Here I.', ['extra']], ['In B: II.', ['second-extra']],
  ],
  // (the document's own \theappendix stays for its own counter)
  'test-appref-own': [
    ['Note N-1. Text of the first note.'], ['Note N-2. Text of the second note.'],
    ['Ref: N-1; N-2; A; A.1; 1.', [null, null, 'extra', 'more', 'main']],
  ],
  'test-appref-article': [
    ['Ref: A; B; A.1; 1.', ['extra', 'second-extra', 'more', 'main']],
    ['Cref: section A; Section A.1.', ['extra', 'more']],
  ],
  'test-appref-article-cref': [
    ['Ref: A; B; A.1; 1.', ['extra', 'second-extra', 'more', 'main']],
    ['Cref: section A; Section B; section A.1; section 1.', ['extra', 'second-extra', 'more', 'main']],
    ['Here section A.', ['extra']], ['In B: B.', ['second-extra']],
  ],
  'test-appref-appendices': [['Ref: A; B; A.1; 1.', ['extra', 'second-extra', 'more', 'main']]],
  'test-appref-amsbook': [
    // (amsbook numbers sections without the chapter)
    ['Ref: A; B; 1; 1.', ['extra', 'second-extra', 'more', 'main']],
    ['Here A.', ['extra']], ['In B: B.', ['second-extra']],
  ],
  // (labels inside chapter titles, and chapters with nothing numbered
  // between them)
  'test-appref-inside': [
    ['Ref: A; B; C; D; 1.', ['extra', 'second-extra', 'third', 'fourth', 'main']],
    ['Here C.', ['third']],
  ],
  'test-appref-handmade': [['Ref: A; B; A.1; 1.', ['extra', 'second-extra', 'more', 'main']]],
  'test-appref-subappendices': [['Ref: 1.A; 2.A; 1.', [null, null, 'main']]],
};

// A \thechapter set in the preamble or the class: chapter and section
// headings with their numbers (a heading's label, or none), the table of
// contents, and paragraphs as in the appendixRefs table above.
const chapterHead = (id, label, title) => label === null
  ? new RegExp(`<h2 class='chapterHead' id='${id}'>(?:(?!</h2>|titlemark)[^])*${title}</h2>`)
  : new RegExp(`<h2 class='(?:chapter|appendix)Head' id='${id}'>(?:(?!</h2>)[^])*<span class='titlemark'>${label}</span>(?:(?!</h2>)[^])*${title}</h2>`);
const sectionHead = (id, label) => new RegExp(`<h3 class='sectionHead' id='${id}'>(?:(?!</h3>)[^])*<span class='titlemark'>${label}</span>`);
const tocEntry = (level, number, id) => new RegExp(`<span class='${level}Toc'><span class='tocnumber'>${number}</span><a href='#${id}'`);
const word = (name, label) => `${name}<span class='tex8web-nbsp'>[^<]*</span>${label}`;
// an equation's tag in MathJax's MathML
const eqTag = tag => new RegExp(`<mlabeledtr><mtd><mtext>\\(</mtext><mtext>${tag.replace('.', '\\.')}</mtext><mtext>\\)</mtext>`);
const lettered = (label = name => word('Chapter', name)) => [
  chapterHead('start', label('A'), 'Start'), sectionHead('basics', 'A\\.1'), chapterHead('second', label('B'), 'Second'),
  ['Ref: A; A.1; B.', ['start', 'basics', 'second']], ['Here B.', ['second']],
];
const letteredContents = [tocEntry('chapter', 'A', 'start'), tocEntry('section', 'A\\.1', 'basics'), tocEntry('chapter', 'B', 'second')];
const thechapter = {
  'test-thechap-book': [
    chapterHead('preface', null, 'Preface'), chapterHead('afterword', null, 'Afterword'),
    chapterHead('start', word('Chapter', 'A'), 'Start'), chapterHead('second', word('Chapter', 'B'), 'Second'),
    sectionHead('basics', 'A\\.1'), sectionHead('more', 'B\\.1'),
    // (a \ref in a heading, which tex4ht may write without its link)
    /<h3 class='sectionHead' id='about-ref-start'>(?:(?!<\/h3>)[^])*<span class='titlemark'>A\.2<\/span>(?:(?!<\/h3>)[^])*About (?:<a href='#start'>)?A(?:<!--(?:(?!-->)[^])*-->)?(?:<\/a>)?<\/h3>/,
    tocEntry('chapter', '', 'preface'), tocEntry('chapter', 'A', 'start'), tocEntry('section', 'A\\.1', 'basics'),
    tocEntry('section', 'A\\.2', 'about-ref-start'), tocEntry('chapter', 'B', 'second'), tocEntry('section', 'B\\.1', 'more'),
    tocEntry('chapter', '', 'afterword'),
    eqTag('A.1'), eqTag('A.3'),
    // (captions: tex4ht may put the label and its colon in their own spans)
    /Figure(?:<[^>]*>|\s|&#x00A0;)*A\.1(?:<[^>]*>|\s|:)*A figure/, /Table(?:<[^>]*>|\s|&#x00A0;)*A\.1(?:<[^>]*>|\s|:)*A table/,
    ['Proposition A.1 A first claim.'],
    ['Proposition A.2 A claim, see A.1.', ['basics']],
    ['Ref: A; A.1; A.2; (A.3); B.', ['start', 'basics', null, null, 'second']],
    ['In italics, A.1; in sans-serif, B; in typewriter, A.', ['basics', 'second', 'start']],
    ['In the note, A.1.', ['basics']],
    ['Proposition A.3 In a theorem, B.', ['second']],
    ['Floats: A.1; A.1.', [null, null]],
    ['Cref: chapter A; section A.1; proposition A.2; eq. (A.3).', ['start', 'basics', null, null]],
    ['Autoref: chapter A; section A.1; Equation A.3.', ['start', 'basics', null]],
    ['Here B; B.1.', ['second', 'more']],
  ],
  'test-thechap-memoir': [
    chapterHead('start', word('Chapter', 'I'), 'Start'), sectionHead('basics', 'I\\.1'), chapterHead('second', word('Chapter', 'II'), 'Second'),
    chapterHead('extra', word('Appendix', 'A'), 'Extra'), sectionHead('more', 'A\\.1'),
    tocEntry('chapter', 'I', 'start'), tocEntry('section', 'I\\.1', 'basics'), tocEntry('chapter', 'II', 'second'),
    tocEntry('appendix', 'A', 'extra'), tocEntry('section', 'A\\.1', 'more'),
    eqTag('I.1'), eqTag('I.3'),
    ['Proposition I.1 A first claim.'], ['Proposition I.2 A claim.'],
    ['Ref: I; I.1; I.2; (I.3); II; A; A.1.', ['start', 'basics', null, null, 'second', 'extra', 'more']],
    ['Here II.', ['second']], ['In the appendix, A; A.1.', ['extra', 'more']],
  ],
  'test-thechap-scrbook': [
    chapterHead('start', 'A', 'Start'), sectionHead('basics', 'A\\.1'), chapterHead('second', 'B', 'Second'),
    tocEntry('chapter', '', 'preface'), tocEntry('chapter', 'A', 'start'), tocEntry('section', 'A\\.1', 'basics'),
    tocEntry('chapter', 'B', 'second'), tocEntry('chapter', '', 'afterword'),
    eqTag('A.1'),
    ['Ref: A; A.1; (A.1); B.', ['start', 'basics', null, 'second']], ['Here B.', ['second']],
  ],
  'test-thechap-front': [
    chapterHead('preface', null, 'Preface'), chapterHead('afterword', null, 'Afterword'),
    chapterHead('start', word('Chapter', '1'), 'Start'), sectionHead('basics', '1\\.1'),
    tocEntry('chapter', '', 'preface'), tocEntry('chapter', '1', 'start'), tocEntry('section', '1\\.1', 'basics'),
    tocEntry('chapter', '', 'afterword'),
    ['Ref: 1; 1.1.', ['start', 'basics']],
    // (the PDF prints the last label before each chapter: none, then 1.1)
    ['Ref: ; 1.1.', [null, null]],
  ],
  'test-thechap-appendix': [
    chapterHead('start', word('Chapter', 'I'), 'Start'), sectionHead('basics', 'I\\.1'), chapterHead('second', word('Chapter', 'II'), 'Second'),
    chapterHead('extra', word('Appendix', 'A'), 'Extra'), sectionHead('more', 'A\\.1'),
    tocEntry('chapter', 'I', 'start'), tocEntry('section', 'I\\.1', 'basics'), tocEntry('chapter', 'II', 'second'),
    tocEntry('appendix', 'A', 'extra'), tocEntry('section', 'A\\.1', 'more'),
    ['Ref: I; I.1; II; A; A.1.', ['start', 'basics', 'second', 'extra', 'more']],
  ],
  // (culver's headings have no chapter name in the PDF; tex4ht writes one)
  'test-thechap-culver': [
    chapterHead('start', `(?:${word('Chapter', '')})?I`, 'Start'), sectionHead('basics', 'I\\.1'),
    chapterHead('second', `(?:${word('Chapter', '')})?II`, 'Second'),
    tocEntry('chapter', '', 'preface'), tocEntry('chapter', 'I', 'start'), tocEntry('section', 'I\\.1', 'basics'),
    tocEntry('chapter', 'II', 'second'), tocEntry('chapter', '', 'afterword'),
    ['Ref: I; I.1; II.', ['start', 'basics', 'second']], ['Here II.', ['second']],
  ],
  'test-thechap-class': [
    chapterHead('preface', null, 'Preface'), chapterHead('afterword', null, 'Afterword'),
    chapterHead('start', word('Chapter', 'I'), 'Start'), sectionHead('basics', 'I\\.1'), chapterHead('second', word('Chapter', 'II'), 'Second'),
    tocEntry('chapter', '', 'preface'), tocEntry('chapter', 'I', 'start'), tocEntry('section', 'I\\.1', 'basics'),
    tocEntry('chapter', 'II', 'second'), tocEntry('chapter', '', 'afterword'),
    ['Ref: I; I.1; II.', ['start', 'basics', 'second']], ['Here II.', ['second']],
  ],
  'test-thechap-report': [...lettered(), ...letteredContents],
  'test-thechap-scrreprt': [...lettered(name => name), ...letteredContents],
  'test-thechap-atbegin': [...lettered(), ...letteredContents],
  'test-thechap-hook': [...lettered(), ...letteredContents],
  'test-thechap-hookbook': [...lettered(), ...letteredContents],
  // (amsbook numbers sections without the chapter)
  'test-thechap-amsbook': [
    chapterHead('start', word('Chapter', 'A'), 'Start'), sectionHead('basics', '1\\.'), chapterHead('second', word('Chapter', 'B'), 'Second'),
    ['Ref: A; 1; B.', ['start', 'basics', 'second']], ['Here B.', ['second']],
  ],
};
function appendixRefProblems(html, checks) {
  const problems = [];
  const paragraphs = [...html.matchAll(/<p[ >][^]*?<\/p>/g)].map(([inner]) => inner);
  for (const check of checks) {
    if (check instanceof RegExp) {
      if (!check.test(html)) problems.push(`not in the page: ${check.source.slice(0, 80)}`);
      continue;
    }
    const [sentence, targets] = check;
    const inner = paragraphs.find(p => plain(p).includes(sentence));
    if (inner === undefined) {
      const near = paragraphs.map(plain).find(p => p.includes(sentence.match(/^[^:,]*/)[0]));
      problems.push(`no paragraph reads '${sentence}'${near ? `: '${near}'` : ''}`);
      continue;
    }
    if (!targets) continue;
    const links = [...inner.matchAll(/<a ((?:(?!class='tex8web-permalink')[^>])*)href='#([^']+)'/g)]
      .map(([, , id]) => id).filter(id => !id.startsWith('fn'));
    const got = targets.map((id, i) => id === null ? null : links[i]);
    if (got.join('|') !== targets.join('|')) problems.push(`the links of '${sentence}' go to '${links.join('|')}'`);
  }
  return problems;
}

// the problems in a built page's logs, the page, and the files beside it
function check(doc, result, out, aux) {
  const problems = [];
  // (unless an [ERROR] or [FATAL] in the log, which checkLog reports, says why)
  if (result.code !== 0 && !/\[(ERROR|FATAL)\]/.test(result.log)) problems.push(`make4ht exited with ${result.code}`);
  const css = join(out, doc.tex.replace(/\.tex$/, '.css'));
  const styles = existsSync(css) ? readFileSync(css, 'utf8') : '';
  for (const [property, value] of Object.entries(measured[doc.name] ?? {})) {
    if (value === null ? styles.includes(`${property}:`) : !styles.includes(`${property}: ${value};`)) {
      problems.push(value === null ? `${property} is set` : `${property} isn't ${value}`);
    }
  }
  // (once, not once for each abstract)
  if (styles.split('--tex8web-abstract-leading:').length > 2) problems.push("the abstract's leading set twice");
  // (html4.4ht's rules for paragraphs in an <li>, which the lists of other
  // packages need, for example paralist)
  if (styles && !/^li p:last-child/m.test(styles)) problems.push("no html4.4ht's rules for <li>");
  const page = join(out, doc.tex.replace(/\.tex$/, '.html'));
  const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
  if (hypcap[doc.name]) problems.push(...hypcapProblems(html, hypcap[doc.name]));
  if (appendixRefs[doc.name]) problems.push(...appendixRefProblems(html, appendixRefs[doc.name]));
  if (thechapter[doc.name]) problems.push(...appendixRefProblems(html, thechapter[doc.name]));
  // memoir emulates moreverb without its tex4ht configuration hooks.
  if (/<head>(?:(?!<\/head>)[^])*<div class='listinginput'>/.test(html)) problems.push('listinginput in the head');
  if (doc.name.startsWith('test-verbatim-font-listings')) {
    const literals = [...html.matchAll(/<code class='lstinline'>([^]*?)<\/code>/g)];
    if (literals.length !== 10) problems.push('expected ten inline listings');
    for (const [, literal] of literals) {
      if (!/<span class='[^']*(?:tt|pcr|qcr)[^']*'/.test(literal)) {
        problems.push('lstinline typewriter font span missing: ' + literal);
      }
    }
  }
  // (each inline listing's text, with its spaces as a reader sees them, and
  // each formula after one, typeset, with the space before it; a listing
  // in \mbox without its edge spaces, as in the PDF, where \mbox reads its
  // argument before \lstinline does, which drops them and collapses runs;
  // the hyperref fixture's config sets its own \Configure{lstinline})
  if (doc.name.startsWith('test-lstinline-box')) {
    const hyperref = doc.name.endsWith('-hyperref');
    const codes = [...html.matchAll(/<code class='lstinline'>([^]*?)<\/code>/g)].map(([, code]) => code);
    const raw = codes.map(code => code.replace(/<[^>]*>/g, ''));
    const texts = raw.map(text => text.replace(/\s+/g, ' ').trim());
    const where = test => texts.flatMap((text, i) => test(text) ? [i] : []);
    // (the box's runs of spaces: a real edge space of a listing is one)
    const runs = raw.filter(text => /^\s{2}|\s{2}$/.test(text));
    if (runs.length) problems.push(`inline listings with runs of spaces: '${runs.join("', '")}'`);
    // (the "Spaces" line, in a paragraph and then in \mbox, and the same
    // listing in a tabular cell: the paragraph form gives one no-break
    // space before x, the \mbox form none, and the cell the paragraph's)
    const spaced = where(text => text === 'x y');
    const [para, boxed, cell] = spaced.map(i => raw[i]);
    if (spaced.length !== 3 || para?.replace(/^\s|\s$/g, '') !== 'x y' || boxed !== 'x y' || cell !== para) problems.push(`the spaces of a boxed inline listing: '${para}', '${boxed}', and '${cell}'`);
    // (the literate listing, in a tabular cell and then in a paragraph)
    const literate = where(text => /^e.*1$/.test(text));
    if (literate.length !== 2 || !/^e\S+1$/.test(texts[literate[0]]) || texts[literate[0]] !== texts[literate[1]]) problems.push(`the literate listings read '${literate.map(i => texts[i]).join("' and '")}'`);
    const shown = texts.map((text, i) => spaced.includes(i) ? 'SPACES' : literate.includes(i) ? 'LITERATE' : text);
    const expected = ['para', 'SPACES', 'SPACES', 'SPACES', 'cellL', 'cellC', 'cellR', 'mbox', 'fbox', 'makebox', 'label',
      'short', 'LITERATE', 'italic', 'sans', 'thm', 'under', 'parbox', 'pcol', 'cbox', 'fcbox', 'hbox', 'sbox',
      'savebox', 'raise', 'frame', 'multi', 'long', 'cap', 'delims', 'LITERATE', ...(hyperref ? ['link'] : []), 'note'];
    if (shown.join('|') !== expected.join('|')) problems.push(`the inline listings read '${shown.join('|')}'`);
    const [italic, sans] = ['italic', 'sans'].map(text => codes[texts.indexOf(text)] ?? '');
    if (!(hyperref ? /class='ec-lmtti-10'/ : /class='cmti-10'/).test(italic)) problems.push(`the italic listing is not italic: ${italic}`);
    if (!(hyperref ? /class='ec-lmtt-10'/ : /class='cmss-10'/).test(sans)) problems.push(`the sans listing is not in the font of its basicstyle: ${sans}`);
    if (codes.some((code, i) => !literate.includes(i) && /mathjax|\\\(|<mjx/.test(code))) problems.push('math in an inline listing');
    const flat = html.replace(/\s+/g, ' ');
    // (a word, maybe in a font span, then a space, before each formula)
    const formulas = [...flat.matchAll(/(\S*) (?:<\/span>)?(?:<span class='tex8web-nowrap'>)?(?:<span class='mathjax-inline'[^>]*>)?<mjx-container aria-label='([^']*)'/g)]
      .map(([, before, label]) => `${before.replace(/^.*>/, '')} ${label}`);
    const letters = 'ABCDEFGHIJKLMNQRSTUVWXYZ';
    const wanted = ['then x plus 1', ...[...letters].map(letter => `then script ${letter}`), 'then y plus 1',
      ...(hyperref ? ['then script O'] : []), 'then script P'];
    if (formulas.join('|') !== wanted.join('|')) problems.push(`the formulas after the inline listings read '${formulas.join('|')}'`);
    if (!/then <span class='mathjax-block'><mjx-container aria-label='z plus 1'/.test(flat)) problems.push('no display z+1 after the inline listings');
    const count = (flat.match(/<mjx-container/g) ?? []).length;
    if (count !== wanted.length + 1) problems.push(`${count} formulas, not ${wanted.length + 1}`);
    if (html.includes('tex8web-long-literal')) problems.push('a short inline listing in a long-literal box');
  }
  // (each displayed listing in a box: its text in a <pre>, in its table
  // cell where it has one, and each formula after one typeset, with
  // "then" before it)
  if (doc.name.startsWith('test-listing-hmode')) {
    const flat = html.replace(/\s+/g, ' ');
    const pres = [...flat.matchAll(/<(pre|code) class='(?:lst(?:input)?listing|listings)'[^>]*>((?:(?!<\/\1>)[^])*)<\/\1>/g)];
    const texts = pres.map(([, , body]) => body.replace(/<(figcaption|span) class='caption'(?:(?!<!-- tex4ht:label)[^])*<!-- tex4ht:label[^>]*>/g, '').replace(/<span class='label'>(?:(?!<\/span>)[^])*<\/span>/g, '')
      .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
    const lines = name => `${name}();`;
    const caption = doc.name.includes('-caption');
    const hyperref = doc.name.endsWith('-hyperref');
    const expected = caption ? ['topenv', 'cellenv', 'cellL', 'minienv', 'boxenv', 'fbox'].map(lines)
      : [...['topenv', 'topfile', 'mbox_esc'].map(lines), ...['cellL', 'cellC', 'cellR', 'lrbox', 'fbox', 'mbox_esc'].map(lines),
        ...['cbox', 'fcbox', 'framecell'].map(lines), 'esc = α;', ...['makebox', 'minicell', 'pcol', 'parbox', 'multi', 'long',
        'label', 'thm', 'note', 'raise', 'sbox', 'savebox', 'boxpos', 'hbox', 'italic', 'sans', 'inbox', 'cellmid', 'item',
        'twoA', 'twoB', 'cellfbox', 'resize', 'newenv', 'saved', 'hboxed', 'hboxnew', 'shape', 'shapelow', 'rule', 'topframe', 'shadowbox', 'delims', ...(hyperref ? ['link', 'utf'] : [])].map(lines),
        ...(hyperref ? ['int x;'] : [])];
    if (texts.join('|') !== expected.join('|')) problems.push(`the displayed listings read '${texts.join('|')}'`);
    const celled = caption ? ['cellenv();', 'cellL();', 'minienv();']
      : [...['cellL', 'cellC', 'cellR', 'cbox', 'framecell', 'minicell', 'pcol', 'multi', 'long', 'thm', 'boxpos', 'cellmid',
        'cellfbox', 'newenv', 'shape', 'shapelow', 'rule', 'shadowbox'].map(lines), 'esc = α;', ...(hyperref ? ['int x;'] : [])];
    for (const text of celled) {
      const pre = pres[texts.indexOf(text)];
      const before = pre ? flat.slice(0, pre.index) : '';
      const close = pre ? flat.indexOf('</td>', pre.index) : -1;
      if (!pre || before.lastIndexOf('<td') < 0 || before.lastIndexOf('<td') < before.lastIndexOf('</td>')
        || close < pre.index + pre[0].length) problems.push(`the listing '${text}' is not in its table cell`);
    }
    // (the line numbers of numbers=left)
    for (const text of caption ? [] : ['cellR();', 'framecell();']) {
      const label = pres[texts.indexOf(text)]?.[2].match(/<span class='label'>((?:(?!<\/span>)[^])*)<\/span>/)?.[1];
      if (label?.replace(/<[^>]*>/g, '').trim() !== '1') problems.push(`the listing '${text}' has no line number 1`);
    }
    if (pres.some(([body]) => /<mjx-container|mathjax/.test(body))) problems.push('math in a displayed listing');
    // (each listing's frame=, as its <pre>'s border in the page's CSS:
    // styles, widths, and padding in ems of the 10pt body, from top to
    // left; no border for frameshape=; and the paragraph around a box
    // saved in that paragraph)
    const single = 'solid solid solid solid|0.04em 0.04em 0.04em 0.04em|0.3em 0.3em 0.3em 0.3em';
    const frames = { 'fbox();': single, 'framecell();': single, 'hboxnew();': single,
      'saved();': 'none none none solid|0em 0em 0em 0.04em|0em 0em 0em 0.3em',
      'rule();': 'solid none double none|0.2em 0em 0.6em 0em|0.5em 0em 0.5em 0em', 'cellL();': undefined, 'shape();': undefined,
      'topframe();': single, 'shadowbox();': single,
      'shapelow();': undefined };
    for (const [text, sides] of caption ? [] : Object.entries(frames)) {
      const id = pres[texts.indexOf(text)]?.[0].match(/^<(?:pre|code)[^>]* id='([\w-]+)'/)?.[1];
      const rule = id && styles.match(new RegExp(`#${id}\\s*\\{\\s*border-style:\\s*([^;]*);\\s*border-width:\\s*([^;]*);\\s*padding:\\s*([^;}]*)`));
      const found = rule ? rule.slice(1).map(value => value.trim().replace(/\s+/g, ' ')).join('|') : undefined;
      if (!id || found !== sides) problems.push(`the listing '${text}' has the frame '${found}', not '${sides}'`);
    }
    // (no frame for the inline listing 'inframed', whose <code> has no id)
    for (const [, id] of caption ? [] : styles.matchAll(/#([\w-]+)\s*\{\s*border-style:/g)) {
      if (!flat.includes(` id='${id}'`)) problems.push(`a frame for '#${id}', which no listing has`);
    }
    const red = pres[texts.indexOf('rule();')]?.[0].match(/^<(?:pre|code)[^>]* id='([\w-]+)'/)?.[1];
    if (!caption && !(red && new RegExp(`#${red}\\s*\\{\\s*border:[^;}]*#FF0000`, 'i').test(styles))) problems.push('the listing \'rule();\' has no red frame');
    // (frame=shadowbox: a shadow in rulesepcolor, rulesep (framesep) and
    // framerule wide, to the right and down; no shadow without it)
    const shadows = Object.fromEntries(['shadowbox();', 'rule();', 'fbox();'].map(text => {
      const id = pres[texts.indexOf(text)]?.[0].match(/^<(?:pre|code)[^>]* id='([\w-]+)'/)?.[1];
      return [text, id && styles.match(new RegExp(`#${id}\\s*\\{\\s*box-shadow:\\s*([^;}]*)`))?.[1].trim().replace(/\s+/g, ' ')];
    }));
    // (in dark mode at a border's lightness, as the frame's rulecolor)
    const blue = '0.34EM 0.34EM 0 0 LIGHT-DARK(#0000FF, OKLCH(FROM #0000FF VAR(--TEX8WEB-DARK-BORDER) C H))';
    if (!caption && (shadows['shadowbox();']?.toUpperCase() !== blue || shadows['rule();'] || shadows['fbox();'])) {
      problems.push(`the listings' shadows are '${Object.values(shadows).join('|')}'`);
    }
    for (const [words, text] of caption ? [] : [['Consider the code', 'saved();'], ['Consider the box', 'hboxed();'], ['Consider the newenv', 'hboxnew();']]) {
      const pre = pres[texts.indexOf(text)];
      const start = flat.indexOf(words), end = pre ? flat.indexOf('then', pre.index) : -1;
      if (start < 0 || end < 0 || /<\/?p\b/.test(flat.slice(start, end))) problems.push(`the paragraph around the listing '${text}' is broken`);
    }
    // (math in a caption, typeset; the other formulas outside captions)
    // (a caption is a <figcaption>, or a <span> in a box in a paragraph)
    const captionTags = /<(figcaption|span) class='caption'([^>]*)>((?:(?!<!-- tex4ht:label)[^])*)<\/\1><!-- tex4ht:label/g;
    const captionMath = [...flat.matchAll(captionTags)]
      .map(([, , , body]) => (body.match(/<mjx-container/g) ?? []).length).join('|');
    if (caption && captionMath !== '0|1|1|0|0|0') problems.push(`the captions hold '${captionMath}' formulas, not '0|1|1|0|0|0'`);
    const outside = flat.replace(captionTags, '');
    const formulas = [...outside.matchAll(/(\S*) (?:<\/span>)?(?:<span class='[^']*'>)?(?:<span class='tex8web-nowrap'>)?(?:<span class='mathjax-inline'[^>]*>)?<mjx-container aria-label='([^']*)'/g)]
      .map(([, before, label]) => `${before.replace(/^.*>/, '')} ${label}`);
    const wanted = caption ? [...'ABCDEF'].map(letter => `then script ${letter}`)
      : ['then x plus 1', ...[...'ABCDEFGHIJKLMNOPQRSTUVWXY'].map(letter => `then script ${letter}`),
        ...[...'abcdefghijklmnop'].map(letter => `then ${letter}`), 'then y plus 1', 'then z plus 1',
        'then script Z', ...(hyperref ? ['then 1 plus 2', 'then 2 plus 3', 'then 3 plus 4'] : [])];
    if (formulas.join('|') !== wanted.join('|')) problems.push(`the formulas after the displayed listings read '${formulas.join('|')}'`);
    if (!caption && !/then <span class='mathjax-block'[^>]*><mjx-container aria-label='z plus 1'/.test(flat)) problems.push('no display z+1 after the displayed listings');
    const count = (outside.match(/<mjx-container/g) ?? []).length;
    if (count !== wanted.length) problems.push(`${count} formulas, not ${wanted.length}`);
    // (each \ref reads its listing's number and links to an anchor after
    // the listing before it, and before the listing's own <pre>)
    if (caption) {
      const refs = [...flat.matchAll(/<a href='#([^']+)'>(\d+)<!-- tex4ht:ref: lst:(\w+) -->/g)];
      if (refs.map(([, , number, name]) => `${name} ${number}`).join('|') !== 'topenv 1|cellenv 2|minienv 4|boxenv 5') {
        problems.push(`the references read '${refs.map(([, , number, name]) => `${name} ${number}`).join('|')}'`);
      }
      refs.forEach(([, id, number]) => {
        const target = flat.indexOf(` id='${id}'`), i = number - 1;
        const after = pres[i - 1] && pres[i - 1].index + pres[i - 1][0].length, before = pres[i]?.index;
        if (target < 0 || before === undefined || target > before || (after !== undefined && target < after)) problems.push(`the reference to listing ${number} does not land at the listing`);
      });
      const captions = [...flat.matchAll(captionTags)]
        .map(([, , , body]) => body.replace(/<mjx-container(?:(?!<\/mjx-container>)[^])*<\/mjx-container>/g, '$')
          .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
      if (captions.join('|') !== 'Listing 1: Top env|Listing 2: Cell env $|Listing 3: Cell file $|Listing 4: Mini env|Listing 5: Boxed env|Listing 6: Boxed file') problems.push(`the captions read '${captions.join('|')}'`);
      // (the mark of each caption's skips, from listings' \lst@makecaption)
      const skips = [...flat.matchAll(captionTags)].filter(([, , attributes]) => attributes.includes('--tex8web-caption-before')).length;
      if (skips !== 6) problems.push(`${skips} listing captions have their skips, not 6`);
      // (a boxed listing and its caption in a box in their paragraph)
      if (!/Consider the box <span class='fbox'[^>]*> (?:<a id='[^']*'><\/a> )?<span class='tex8web-boxed-listing'[^>]*><span class='caption'/.test(flat)) problems.push('the boxed listing \'boxenv();\' is not in its box');
    }
  }
  // (displayed listings in boxes in a paragraph: each listing in its own
  // box with its caption, a bottom caption after the listing and a top
  // caption before it, never the next listing's; a black shadow in the
  // text's color; the formulas typeset)
  if (doc.name === 'test-boxed-listings') {
    const flat = html.replace(/\s+/g, ' ').replace(/<!--(?:(?!-->)[^])*-->/g, '');
    const boxes = flat.split(/<span class='tex8web-boxed-listing(?: [\w-]+)*'/).slice(1).map(segment => {
      const box = segment.split(/ then <span class='tex8web-nowrap'>|<\/p>/)[0];
      const code = box.match(/<code class='lstlisting'[^>]*>((?:(?!<\/code>)[^])*)<\/code>/);
      const text = value => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (!code) return `no listing: ${text(box)}`;
      const words = text(box.match(/<span class='content'>((?:(?!<\/span><\/span>)[^])*)<\/span><\/span>/)?.[1] ?? '');
      return `${text(code[1])}${words ? ` ${box.indexOf('caption') > code.index ? 'below' : 'above'} ${words}` : ''}`;
    });
    const want = ['wide(); /* a line wider than the column of a phone screen */', 'bottomenv(); below Below env',
      'twoA();', 'twoB(); above Above second', 'pairA(); below Below first', 'pairB(); above Above next',
      'titleA();', 'titleB(); above Titled next',
      ...['A', 'B', 'C', 'D'].map(name => `wide${name}(); /* a line wider than the column of a phone screen */`),
      'a b c x; abcde y;', ...['center', 'top', 'bottom'].map(name => `${name}A(); ${name}B(); ${name}C();`),
      'capA(); capB(); capC(); above Captioned top', ...['lab', 'mid', 'named'].map(name => `${name}A(); ${name}B(); ${name}C();`),
      'shadowed();', 'boxedwide(); /* a line wider than the column of a phone screen, in a frame */',
      'printwide(); /* a line of about a hundred characters, wider than the column of a printed page */',
      ...['itemfirst', 'itemlater', 'itemtop', 'itemstart'].map(name => `${name}A(); ${name}B(); ${name}C();`)];
    if (boxes.join('|') !== want.join('|')) problems.push(`the boxed listings read '${boxes.join('|')}'`);
    // (boxpos=center leaves no letters in the page, and a \ref to a boxed
    // listing's label reads its number)
    if (/\benter\b/.test(flat.replace(/<[^>]*>/g, ' '))) problems.push('the letters of boxpos=center are in the page');
    if (!/done, after <a href='#[\w-]+'>5<\/a>\./.test(flat)) problems.push('the \\ref to lst:captop does not read 5');
    const black = flat.match(/<pre class='lstlisting' id='([\w-]+)'>(?:(?!<\/pre>)[^])*blackshadow/)?.[1];
    if (!(black && new RegExp(`#${black}\\s*\\{\\s*box-shadow:[^;}]*\\scurrentColor\\s*[;}]`).test(styles))) problems.push('the listing \'blackshadow();\' has no shadow in the text\'s color');
    const formulas = [...flat.matchAll(/then (?:<span class='tex8web-nowrap'>)?<mjx-container aria-label='([^']*)'/g)].map(([, label]) => label);
    // (tex8web-text.tex's marks for text.boxed_listings, also of a caption in a cell)
    if (html.includes('tex8web:')) problems.push('a mark of tex8web-text.tex is left in the page');
    // (a listing in a minipage in a frame in a paragraph: a <pre>, in
    // vertical mode)
    const pres = [...flat.matchAll(/<pre class='lstlisting'[^>]*>((?:(?!<\/pre>)[^])*)<\/pre>/g)].map(([, body]) => body.replace(/<[^>]*>/g, '').trim());
    if (!pres.includes('minipage();')) problems.push('the listing \'minipage();\' is not a <pre>');
    if (formulas.join('|') !== 'a|b|c|d|e|f|g|h|i|j|k|l|m|n|s|t|u|o|p|q|r') problems.push(`the formulas after the listings read '${formulas.join('|')}'`);
  }
  if (/^test-verbatim-font-review(?:-courier|-lmodern)?$/.test(doc.name)) {
    const codes = [...html.matchAll(/<code class='(verb|lstinline)'>([^]*?)<\/code>/g)];
    if (codes.length !== 11) problems.push('expected eleven review literals');
    for (const [markup, , literal] of codes) {
      const plain = literal.replace(/<[^>]*>/g, '');
      if (plain.length > 20 && !html.includes("<span class='tex8web-long-literal'>" + markup)) {
        problems.push('review literal lacks a constrained box: ' + plain);
      }
    }
    // (listings sets a hyphen as a math minus in a font other than typewriter)
    const defaultCode = codes.find(([, , literal]) => literal.replace(/<[^>]*>/g, '').replace(/\u2212/g, '-') === 'vf-review-default')?.[2];
    if (!defaultCode || /class='[^']*(?:tt|pcr|qcr)/.test(defaultCode)) {
      problems.push('default listings font was replaced with typewriter');
    }
    const italicCode = codes.find(([, , literal]) => literal.replace(/<[^>]*>/g, '').replace(/\u2212/g, '-') === 'vf-review-italic-tt')?.[2];
    if (!italicCode || !/class='[^']*(?:cmitt|ecit-|lmtti|lmtto|pcrro|qcrri)/.test(italicCode)) {
      problems.push('listings basicstyle lost italic typewriter');
    }
  }
  const classes = html.match(/<html[^>]*\sclass='([^']*)'/)?.[1] ?? '';
  if (classes !== (switched[doc.name] ?? '')) problems.push(`<html> has classes '${classes}'`);
  // (the examples are published: the title is shown in tabs and link previews)
  if (doc.name.startsWith('examples/') && !/<title>\s*\S/.test(html)) problems.push('no <title>');
  // (one <main>, for screen readers to jump to the text)
  if ((html.match(/<main[\s>]/g) || []).length !== 1) problems.push('not one <main>');
  // (tex4ht's <!--l. 65-->, which text.line_comments removes)
  if (/<!--\s*l\.\s*\d+\s*-->/.test(html)) problems.push("tex4ht's source line comments");
  // (with -p, or custom.cfg's \WebPDF)
  if (doc.pdf && !(html.includes("href='main.pdf'") && existsSync(join(out, 'main.pdf')))) problems.push('no link to the PDF beside it');
  if (doc.up && !html.includes(`class='tex8web-control tex8web-up' href='${doc.up}'`)) problems.push('no link up to the index');
  // (each caption with its skips: text.block_spacing puts them from the
  // mark of \@makecaption, which a caption's own macros might skip)
  for (const file of existsSync(out) ? readdirSync(out).filter(f => f.endsWith('.html')) : []) {
    const bare = readFileSync(join(out, file), 'utf8').match(/class='caption'(?! style='--tex8web-caption-before: )/g)?.length;
    if (bare) problems.push(`${file}: ${bare} captions without their skips`);
  }
  // (tex4ht's indentation, which the patterns do not pin; U+202F is kept)
  const flat = html.replace(/[^\S\u202F]+/g, ' ');
  for (const [table, what, withStyles] of patterns) {
    for (const pattern of table[doc.name] ?? []) {
      if (!pattern.test(withStyles ? flat + styles : flat)) problems.push(`no ${pattern.source} ${what}`);
    }
  }
  problems.push(...ligatureProblems(doc.name, flat));
  problems.push(...marginnoteProblems(doc.name, flat));
  // (fancyvrb's saved text keeps both spaces, which flat joins)
  if (doc.name === 'test-useverb-fvextra' && !html.includes('uvx-star\u00A0a\u00A0\u00A0b')) problems.push('no uvx-star with two spaces');
  if (displayPictures[doc.name]) {
    const { pictures: shown, math } = displayPictures[doc.name];
    const names = [...shown.map(name => [name].flat()[0]), ...math];
    const starts = names.map(name => flat.indexOf(`${name}.`));
    const part = i => starts[i] < 0 ? '' : flat.slice(starts[i], Math.min(...starts.filter(at => at > starts[i]), flat.indexOf('</main>')));
    // (whether the element with this id ends the text before the display,
    // with only tags and spaces after it)
    const anchoredBefore = (text, display, id) => new RegExp(`id='${id}'[^>]*>(?:\\s|<[^>]+>)*$`).test(text.slice(0, text.indexOf(display)));
    shown.forEach((entry, i) => {
      const [name, extra] = [entry].flat(), text = part(i);
      const outside = text.replace(/<span class='tex8web-qed'>(?:(?!<\/mjx-container>)[^])*<\/mjx-container><\/span>/g, '');
      // the display element, from its opening tag to its closing one
      const display = element(text, /<(div|span) class='[^']*\bmathjax-(?:block|env)\b[^']*'>/);
      // (an empty anchor of a \label may come before the picture)
      if (!/^<[^>]+>(?:(?!<\/)[^])*<img /.test(display.replace(/<a id='[^']*'><\/a>/g, ''))) problems.push(`${name}: no picture in the display`);
      if (outside.includes('<mjx-container')) problems.push(`${name}: MathJax in the display`);
      if (extra === 'tex8web-qed' && !display.includes(`class='${extra}'`)) problems.push(`${name}: no ${extra} in the display`);
      if (extra?.startsWith('(')) {
        if (!display.replace(/<[^>]+>/g, '').includes(extra)) problems.push(`${name}: no ${extra} in the display`);
        if (/<a id=/.test(display)) problems.push(`${name}: the number's anchor is in the display`);
        // each \ref or \eqref of the equation: its number, linking to an id in the display
        const refs = [...flat.matchAll(/Reference to the triangle: (?:(?!<\/p>)[^])*?<a href='#([^']+)'[^>]*>((?:(?!<\/a>)[^])*)<\/a>/g)];
        if (!refs.length) problems.push(`${name}: no reference`);
        for (const [, id, label] of refs) {
          if (!['1', '(1)'].includes(label.replace(/<[^>]+>/g, ''))) problems.push(`${name}: reference reads ${label}`);
          if (!display.includes(`id='${id}'`) && !anchoredBefore(text, display, id)) problems.push(`${name}: reference to #${id} outside the display`);
        }
      }
    });
    shown.forEach((entry, i) => {
      const name = [entry].flat()[0], text = part(i);
      const numbers = pictureNumbers[doc.name] ?? {}, puncts = picturePuncts[doc.name] ?? {};
      if (!(name in numbers)) return;
      const display = element(text, /<(div|span) class='[^']*\bmathjax-(?:block|env)\b[^']*'>/);
      const tag = display.match(/<span class='tex8web-picture-tag'>((?:(?!<\/span>)[^])*)<\/span>/)?.[1].replace(/<[^>]+>/g, '').trim() ?? '';
      if (tag !== numbers[name]) problems.push(`${name}: the display's number is "${tag}", not "${numbers[name]}"`);
      // (the number's anchor before the display, marked, as before MathJax's
      // displays, or at the end of the paragraph before, with no empty
      // display left beside it)
      if (tag && /<a id=/.test(display)) problems.push(`${name}: the number's anchor is in the display`);
      if (tag && !/<a [^>]*\btex8web-eq-anchor(?:-end\b[^>]*><\/a>\s*<\/p>|\b[^>]*><\/a>)\s*$/.test(text.slice(0, text.indexOf(display)))) problems.push(`${name}: no marked anchor right before the display`);
      if (/<(div|span) class='[^']*\bmathjax-block\b[^']*'>\s*<\/\1>/.test(text)) problems.push(`${name}: an empty display`);
      // (upright, as amsmath sets a number, also in a theorem's italic)
      if (/<span class='tex8web-picture-tag'>(?:(?!<\/span>)[^])*class='[^']*ti-/.test(display)) problems.push(`${name}: the display's number is in italic`);
      const punct = display.match(/<img [^>]*>\s*<span class='tex8web-picture-punct'>((?:(?!<\/span>)[^])*)<\/span>/)?.[1].replace(/<[^>]+>/g, '').trim() ?? '';
      if (punct !== (puncts[name] ?? '')) problems.push(`${name}: the punctuation after the picture is "${punct}", not "${puncts[name] ?? ''}"`);
      if (name === 'Proof equation tikzpicture' && !/tex8web-picture-tag(?:(?!<img )[^])*tex8web-qed/.test(display)) problems.push(`${name}: no QED box after the number`);
      if (['Proof tikzpicture period', 'Proof quantikz period'].includes(name) && !/tex8web-picture-punct(?:(?!<img )[^])*tex8web-qed/.test(display)) problems.push(`${name}: no QED box after the period`);
      if (name === 'Equation after a blank line' && !/<p\b[^>]*>\s*where the text goes on/.test(text)) problems.push(`${name}: the text after the display is in no paragraph`);
      if (name === 'Numbered after a blank line' && !/<p\b[^>]*>\s*where the numbered text goes on/.test(text)) problems.push(`${name}: the text after the display is in no paragraph`);
      if (name === 'Bracket after a blank line' && !/<p\b[^>]*>\s*where the bracket text goes on/.test(text)) problems.push(`${name}: the text after the display is in no paragraph`);
      if (name === 'Equation tag graphics' && !/Reference to the tag: <a [^>]*>A(?:<!--(?:(?!-->)[^])*-->)?<\/a>/.test(text)) problems.push(`${name}: the reference does not read A`);
    });
    // (each link of the paragraph that refers to numbered circuits goes to
    // the anchor right before the display with that number)
    if (quantikzRefs[doc.name]) {
      const paragraph = flat.match(/Reference to the (?:old )?circuit: (?:(?!<\/p>)[^])*/)?.[0] ?? '';
      const read = paragraph.replace(/<!--(?:(?!-->)[^])*-->|<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (read !== quantikzRefs[doc.name]) problems.push(`the references read "${read}", not "${quantikzRefs[doc.name]}"`);
      for (const [, id, label] of paragraph.matchAll(/<a href='#([^']+)'[^>]*>((?:(?!<\/a>)[^])*)<\/a>/g)) {
        const number = `(${label.replace(/<!--(?:(?!-->)[^])*-->|<[^>]+>/g, '').replace(/^\((.*)\)$/, '$1')})`;
        const i = shown.findIndex(name => pictureNumbers[doc.name][name] === number), text = i < 0 ? '' : part(i);
        const display = element(text, /<(div|span) class='[^']*\bmathjax-(?:block|env)\b[^']*'>/);
        if (!display || !anchoredBefore(text, display, id)) problems.push(`reference ${number} links to #${id}, not to the anchor right before its display`);
      }
    }
    math.forEach((name, j) => {
      const text = part(shown.length + j);
      if (!text.includes('<mjx-container') || text.includes('<img ')) problems.push(`${name}: not MathJax's display`);
    });
  }
  for (const [from, to] of quantikzPictures[doc.name] ?? []) {
    const start = flat.indexOf(from), end = flat.indexOf(to, start);
    if (start < 0 || end < 0 || !/<img /.test(flat.slice(start, end))) problems.push(`no picture between "${from}" and "${to}"`);
  }
  if (preloads[doc.name]) {
    const found = fontsListed(html).map(href => href.match(/^fonts\/(.+)\.woff2$/)?.[1]).sort().join(' ');
    const wanted = [...preloads[doc.name]].sort().join(' ');
    if (found !== wanted) problems.push(`fonts preloaded: ${found}, not ${wanted}`);
  }
  for (const rule of families[doc.name] ?? []) {
    if (!styles.includes(rule)) problems.push(`no ${rule} among the font rules`);
  }
  // (TeX Live's fonts, cut down by prerender.mjs)
  for (const [, font] of styles.matchAll(/url\("fonts\/([\w-]+\.woff2)"\) format\("woff2"\), url/g)) {
    const size = statSync(join(out, 'fonts', font), { throwIfNoEntry: false })?.size;
    if (!(size < 60000)) problems.push(`fonts/${font} ${size ? 'not cut down' : 'missing'}`);
  }
  if (tikz[doc.name]) {
    const [file, share] = tikz[doc.name];
    const svg = existsSync(join(out, file)) ? readFileSync(join(out, file), 'utf8') : '';
    const [x, , width] = (svg.match(/viewBox='([^']*)'/)?.[1] ?? '').split(' ').map(Number);
    const at = 1.4 * Number(svg.match(/translate\(([^,]+),/)?.[1]);
    if (!(Math.abs(x + width / 2 - at) < 0.1)) problems.push(`${file} isn't centered on its circle`);
    if (!html.includes(`src='${file}' style='width:calc(var(--tex8web-textwidth) * ${share})'`)) {
      problems.push(`${file} isn't ${share} of the text width`);
    }
  }
  if (nested[doc.name]) {
    // (each case's first <img> of an SVG that dvisvgm wrote, as its style
    // and its file's text)
    const pictures = {};
    for (const name of nested[doc.name]) {
      const part = flat.match(new RegExp(`Before ${name}\\.([^]*?)After ${name}\\.`))?.[1];
      if (part === undefined) { problems.push(`no "Before ${name}." and "After ${name}."`); continue; }
      for (const [, src, style] of part.matchAll(/<img [^>]*src='([^']+\.svg)' style='([^']*)'/g)) {
        const svg = existsSync(join(out, src)) ? readFileSync(join(out, src), 'utf8') : '';
        if (Number(svg.match(/viewBox='\S+ \S+ (\S+)/)?.[1]) > 0) { pictures[name] = { style, svg }; break; }
      }
      if (!pictures[name]) problems.push(`no picture that dvisvgm wrote, or only an empty one, between "Before ${name}." and "After ${name}."`);
    }
    const share = name => Number(pictures[name]?.style.match(/width:calc\(var\(--tex8web-textwidth\) \* ([\d.]+)\)/)?.[1]);
    for (const name of nestpicOuter) {
      if (!(Math.abs(share(name) - 0.8205) < 0.001)) problems.push(`the picture between "Before ${name}." and "After ${name}." is ${share(name)} of the text width, not 0.8205`);
    }
    for (const [name, count] of Object.entries(nestpicPaths)) {
      const paths = (pictures[name]?.svg.match(/<path d=/g) ?? []).length;
      if (paths !== count) problems.push(`the picture between "Before ${name}." and "After ${name}." draws ${paths} paths, not ${count}`);
    }
    for (const [name, lowered] of Object.entries(nestpicLowered)) {
      if (pictures[name] && pictures[name].style.includes('vertical-align') !== lowered) problems.push(`the picture between "Before ${name}." and "After ${name}." is ${lowered ? 'not ' : ''}lowered`);
    }
    if (share('picture overlay') !== share('picture env')) problems.push(`the LaTeX picture with an overlay node is ${share('picture overlay')} of the text width, not ${share('picture env')}`);
    const shown = flat.replace(/<[^>]*>/g, '');
    for (const text of nestpicTexts) if (shown.includes(text)) problems.push(`"${text}" in the page's text, not in its picture`);
    if (/\/(?:&gt;|>)/.test(shown)) problems.push("the tail of an <img> tag in the page's text");
  }
  if (boxmath[doc.name]) {
    const words = name => name.replace(/ /g, '\\s+');
    const part = name => flat.match(new RegExp(`Before ${words(name)}\\.([^]*?)After ${words(name)}\\.`))?.[1];
    const svgs = {};
    for (const name of boxmath[doc.name]) {
      const src = part(name)?.match(/<img [^>]*src='([^']+\.svg)'/)?.[1];
      const svg = svgs[name] = src && existsSync(join(out, src)) ? readFileSync(join(out, src), 'utf8') : '';
      const fonts = new Set([...svg.matchAll(/<use [^>]*href='#g(\d+)-/g)].map(([, font]) => font)).size;
      const least = boxmathFonts[name] ?? 2;
      if (fonts < least) problems.push(`the picture between "Before ${name}." and "After ${name}." draws glyphs of ${fonts} fonts, not ${least}`);
      const glyphs = svg.match(/<use /g)?.length ?? 0;
      if (boxmathGlyphs[name] !== undefined && glyphs !== boxmathGlyphs[name]) problems.push(`the picture between "Before ${name}." and "After ${name}." draws ${glyphs} glyphs, not ${boxmathGlyphs[name]}`);
    }
    const height = name => Number(svgs[name].match(/viewBox='\S+ \S+ \S+ ([\d.]+)'/)?.[1]);
    const [dollars, brackets] = boxmathSame;
    if (!(Math.abs(height(dollars) - height(brackets)) < 0.01)) problems.push(`the picture of "${dollars}" is ${height(dollars)}pt high, not ${height(brackets)}pt as "${brackets}"`);
    const [qedName, qedWidth] = boxmathQedRight;
    const qedLeft = Number(svgs[qedName].match(/<use x='([\d.-]+)'/)?.[1]);
    const qedRight = Math.max(...[...svgs[qedName].matchAll(/<rect x='([\d.-]+)' [^>]*width='([\d.]+)'/g)].map(([, x, w]) => Number(x) + Number(w)));
    if (!(Math.abs(qedRight - qedLeft - qedWidth) < 1)) problems.push(`the QED in "${qedName}" ends ${(qedRight - qedLeft).toFixed(2)}bp from the box's left edge, not ${qedWidth.toFixed(2)}bp`);
    for (const name of boxmathAfter) {
      // (each glyph's origin, by line: the first line and the last)
      const glyphs = [...svgs[name].matchAll(/<use x='([\d.-]+)' y='([\d.-]+)'/g)].map(([, x, y]) => [Number(x), Number(y)]);
      const ys = glyphs.map(([, y]) => y);
      const start = line => Math.min(...glyphs.filter(([, y]) => y === line).map(([x]) => x));
      const [first, last] = [start(Math.min(...ys)), start(Math.max(...ys))];
      if (!(Math.abs(first - last) < 0.01)) problems.push(`the text after the display in "${name}" starts at ${last}, not ${first} as the first line`);
    }
    for (const [name, [count, text, images = 0]] of Object.entries(boxmathCopies)) {
      const copy = part(name) ?? '';
      const formulas = copy.match(/<mjx-container /g)?.length ?? 0;
      const pictures = copy.match(/<img /g)?.length ?? 0;
      if (pictures !== images) problems.push(`${pictures} pictures between "Before ${name}." and "After ${name}.", not ${images}`);
      const shown = copy.replace(/<mjx-container [^]*?<\/mjx-container>/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (formulas !== count) problems.push(`${formulas} formulas between "Before ${name}." and "After ${name}.", not ${count}`);
      if (shown !== text) problems.push(`"${shown}" between "Before ${name}." and "After ${name}.", not "${text}"`);
    }
    const qeds = part(boxmathQed)?.match(/<mjx-mtd id='mjx-eqn_web-qed-/g)?.length ?? 0;
    if (qeds !== 1) problems.push(`${qeds} QED tags in the display of "${boxmathQed}", not 1`);
  }
  if (boxgfx[doc.name]) {
    const words = name => name.replace(/ /g, '\\s+');
    const part = name => flat.match(new RegExp(`Before ${words(name)}\\.([^]*?)After ${words(name)}\\.`))?.[1] ?? '';
    const svgs = {};
    // (a picture's width and height in bp: its viewBox is in the units of
    // the page's group, scaled 1.4)
    const viewSize = svg => {
      const scale = Number(svg.match(/<g id='page1' transform='matrix\(([\d.]+) 0 0 /)?.[1] ?? 1);
      return svg.match(/viewBox='([^']+)'/)?.[1].split(' ').slice(2).map(v => Number(v) / scale) ?? [];
    };
    for (const [name, [width, height]] of Object.entries(boxgfx[doc.name])) {
      const src = part(name).match(/<img [^>]*src='([^']+\.svg)'/)?.[1];
      const svg = svgs[name] = src && existsSync(join(out, src)) ? readFileSync(join(out, src), 'utf8') : '';
      const images = [...svg.matchAll(/<svg ([^>]*)>\s*<image ([^>]*)\/>/g)];
      const attribute = (tag, key) => tag.match(new RegExp(`(?:^| )${key}='([^']*)'`))?.[1];
      if (images.length !== 1 || !/^data:image\/(?:png|jpeg);base64,./.test(attribute(images[0][2], 'xlink:href'))) {
        problems.push(`the picture between "Before ${name}." and "After ${name}." holds ${images.length} images, not one with its data`);
        continue;
      }
      const [w, h] = ['width', 'height'].map(key => Number(attribute(images[0][1], key)));
      const bp = pt => pt * 72 / 72.27;
      if (!(Math.abs(w - bp(width)) < 0.05 && Math.abs(h - bp(height)) < 0.05)) problems.push(`the image in "${name}" is ${w} by ${h}bp, not ${bp(width)} by ${bp(height)}bp`);
      const [pattern, ...turned] = boxgfxTransforms[name] ?? [];
      if (pattern && !pattern.test(svg)) problems.push(`no ${pattern.source} in the picture of "${name}"`);
      const [least, lowest] = pattern ? turned.map(bp) : [w, h];
      const [wide, high] = viewSize(svg);
      if (!(wide > least - 0.01 && high > lowest - 0.01)) problems.push(`the picture of "${name}" is ${wide} by ${high}bp, smaller than its graphic, ${least} by ${lowest}bp`);
    }
    for (const [name, width] of Object.entries(boxgfxWidths)) {
      const src = part(name).match(/<img [^>]*src='([^']+\.svg)'/)?.[1];
      const [wide] = src && existsSync(join(out, src)) ? viewSize(readFileSync(join(out, src), 'utf8')) : [];
      if (!(Math.abs(wide - width * 72 / 72.27) < 0.05)) problems.push(`the picture of "${name}" is ${wide}bp wide, not ${width * 72 / 72.27}bp as in the PDF`);
    }
    const [trimmed, ...kept] = boxgfxTrimmed;
    const inner = svgs[trimmed].match(/<svg ([^>]*)>\s*<image /)?.[1] ?? '';
    for (const attribute of kept) if (!inner.includes(attribute)) problems.push(`no ${attribute} on the graphic's <svg> in "${trimmed}"`);
    if (!/<svg [^>]*>/.exec(svgs[boxgfxStretched])?.[0].includes("preserveAspectRatio='none'")) problems.push(`the picture of "${boxgfxStretched}" keeps its aspect`);
    const [name, file, text] = boxgfxCopy;
    const copy = part(name);
    const imgs = [...copy.matchAll(/<img [^>]*src='([^']*)'/g)].map(([, src]) => src);
    const shown = copy.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (imgs.join() !== file) problems.push(`the pictures between "Before ${name}." and "After ${name}." are "${imgs.join()}", not "${file}"`);
    if (shown !== text) problems.push(`"${shown}" between "Before ${name}." and "After ${name}.", not "${text}"`);
  }
  if (boxcenter[doc.name]) {
    const words = name => name.replace(/ /g, '\\s+');
    const part = name => flat.match(new RegExp(`Before ${words(name)}\\.([^]*?)After ${words(name)}\\.`))?.[1] ?? '';
    for (const [name, [anchor, glyphs, height, frames = {}, image]] of Object.entries(boxcenter[doc.name])) {
      const src = part(name).match(/<img [^>]*src='([^']+\.svg)'/)?.[1];
      const svg = src && existsSync(join(out, src)) ? readFileSync(join(out, src), 'utf8') : '';
      if (!svg) {
        problems.push(`no picture between "Before ${name}." and "After ${name}."`);
        continue;
      }
      // (a glyph's origin, by its character's code, which is its ASCII
      // code in the fonts used)
      const at = char => [...svg.matchAll(new RegExp(`<use x='([\\d.-]+)' y='([\\d.-]+)' xlink:href='#g\\d+-${char.charCodeAt(0)}'`, 'g'))]
        .map(([, x, y]) => [Number(x), Number(y)]);
      const [origin] = at(anchor);
      if (!origin) {
        problems.push(`no ${anchor} in the picture of "${name}"`);
        continue;
      }
      for (const [char, [dx, dy]] of Object.entries(glyphs)) {
        const [x, y] = (at(char)[0] ?? [NaN, NaN]).map((v, i) => v - origin[i]);
        if (!(Math.abs(x - dx) < 1 && (dy === null || Math.abs(y - dy) < 3))) problems.push(`${char} in the picture of "${name}" is at (${x.toFixed(2)}, ${y.toFixed(2)})bp from ${anchor}, not (${dx}, ${dy}) as in the PDF`);
      }
      const frame = svg.match(/<path d='M[\d.-]+-([\d.]+)H[\d.-]+V([\d.]+)H/);
      const high = frame ? Number(frame[1]) + Number(frame[2]) : NaN;
      if (height !== null && !(Math.abs(high - height) < 3)) problems.push(`the frame of "${name}" is ${high}pt high, not ${height.toFixed(2)}pt as in the PDF`);
      // (a frame: two rules across the glyph, and one at each end of them)
      const rects = [...svg.matchAll(/<rect x='([\d.-]+)' y='([\d.-]+)' height='([\d.]+)' width='([\d.]+)'\/>/g)]
        .map(match => match.slice(1).map(Number));
      const across = ([x, , h, w], gx) => h < 1 && x < gx && gx < x + w;
      for (const [char, width] of Object.entries(frames)) {
        const [gx] = at(char)[0] ?? [NaN];
        const tops = rects.filter(rect => across(rect, gx));
        const [x, , , w] = tops[0] ?? [NaN, 0, 0, NaN];
        const sides = rects.filter(([sx, , h, sw]) => sw < 1 && h > 1 && (Math.abs(sx - x) < 0.1 || Math.abs(sx + sw - x - w) < 0.1));
        if (tops.length !== 2 || sides.length !== 2 || (width !== null && !(Math.abs(w - width) < 1))) problems.push(`${char} in the picture of "${name}" has ${tops.length} rules across it and ${sides.length} at their ends, ${w.toFixed(2)}bp wide, not a frame ${width ?? 'as wide as'}${width === null ? ' in the PDF' : 'bp wide'}`);
      }
      if (rects.length !== 4 * Object.keys(frames).length) problems.push(`the picture of "${name}" draws ${rects.length} rules, not the ${4 * Object.keys(frames).length} of its frames`);
      if (image !== undefined) {
        const x = Number(svg.match(/<svg [^>]*x='([\d.-]+)'[^>]*>\s*<image /)?.[1]) - origin[0];
        if (!(Math.abs(x - image) < 1)) problems.push(`the graphic in "${name}" starts ${x.toFixed(2)}bp from ${anchor}, not ${image}bp as in the PDF`);
      }
    }
    for (const [name, [centered, framed, empty]] of Object.entries(boxcenterKept)) {
      const copy = part(name);
      if (!new RegExp(`<div class='center'>\\s*${empty}<p class='noindent'>${centered} <span class='fbox'[^>]*>${framed}</span></p>\\s*</div>`).test(copy)) problems.push(`no center that holds ${empty ? 'an empty paragraph, then ' : ''}"${centered}" and an \\fbox of "${framed}" between "Before ${name}." and "After ${name}."`);
    }
    for (const [name, text] of Object.entries(boxcenterText)) {
      if (!new RegExp(text).test(part(name))) problems.push(`no "${text}" between "Before ${name}." and "After ${name}."`);
    }
  }
  if (copied[doc.name]) {
    const shown = {};
    for (const [tag] of flat.matchAll(/<img [^>]*>/g)) {
      const src = tag.match(/ src='([^']*)'/)?.[1] ?? '';
      const alt = tag.match(/ alt='([^']*)'/)?.[1];
      if (alt in copied[doc.name]) shown[alt] = src;
      else if (!src.startsWith('data:') && !existsSync(inPage(out, src) ?? '')) problems.push(`${src}: not a file inside the page's folder`);
    }
    for (const [alt, source] of Object.entries(copied[doc.name])) {
      const file = inPage(out, shown[alt]);
      const data = file && existsSync(file) ? readFileSync(file) : null;
      if (!data) problems.push(`${alt}: no picture inside the page's folder (src ${shown[alt]})`);
      else if (typeof source === 'number' ? !(Math.abs(pngAspect(data) / source - 1) < 0.03) : !data.equals(readFileSync(join(root, 'test', source)))) {
        problems.push(`${alt}: ${shown[alt]} is not ${typeof source === 'number' ? `a PNG ${source.toFixed(3)} times as wide as high` : `a copy of ${source}`}`);
      }
      const pixels = pixelSizes[doc.name]?.[alt];
      if (data && pixels) {
        const got = [data.readUInt32BE(16), data.readUInt32BE(20)];
        if (!pixels.every((px, i) => Math.abs(got[i] - px) <= 2)) problems.push(`${alt}: ${shown[alt]} is ${got.join(' by ')} pixels, not ${pixels.join(' by ')}`);
      }
      // (color types 4 and 6 have an alpha channel: a converted picture has
      // the white background of the PDF's page, so its lines show in dark mode)
      if (data && typeof source === 'number' && [4, 6].includes(data[25])) problems.push(`${alt}: ${shown[alt]} has a transparent background`);
    }
    const written = pdfpicOnly();
    if (written.length) problems.push(`files written beside the source's pictures: ${written.join(', ')}`);
  }
  for (const alt of unspaced[doc.name] ?? []) {
    if (flat.includes(` <img alt='${alt}'`)) problems.push(`${alt}: a space before the picture`);
  }
  if (pdfPages[doc.name]) {
    problems.push(...checkPdfPages(pdfPages[doc.name], flat, out));
    const texLog = join(aux, doc.tex.replace(/\.tex$/, '.log'));
    if (doc.name === 'test-pdfpages-dvips' && !(existsSync(texLog) && readFileSync(texLog, 'latin1').includes(pdfpagesDvipsWarning))) {
      problems.push("no ppdvips.def warning that it has no number of pages in the TeX log");
    }
    const written = pdfpagesOnly();
    if (written.length) problems.push(`files written beside the included PDFs: ${written.join(', ')}`);
  }
  if (pictureSizes[doc.name]) {
    const [ext, sizes] = pictureSizes[doc.name];
    const measure = after => {
      const file = flat.match(new RegExp(`src='(${doc.name}\\d+x\\.${ext})'[^>]*\\/>(?:(?!<img|After )[^])*After ${after}\\.`))?.[1];
      if (!file || !existsSync(join(out, file))) return [];
      const data = readFileSync(join(out, file));
      return ext === 'png' ? [data.readUInt32BE(16), data.readUInt32BE(20)]
        : (data.toString().match(/viewBox='([^']*)'/)?.[1] ?? '').split(' ').slice(2).map(Number);
    };
    const scale = measure('found')[0] / sizes.found[0];
    for (const [after, size] of Object.entries(sizes)) {
      const got = measure(after);
      // (within the antialiased pixels at the image's edges)
      if (!size.every((pt, i) => Math.abs(got[i] - pt * scale) <= 2 + 0.01 * pt * scale)) {
        problems.push(`the picture before "After ${after}." is ${got.join(' by ')}, not ${size.join(' by ')}pt at ${scale} a pt`);
      }
    }
    for (const after of coveredPictures[doc.name] ?? []) {
      const file = flat.match(new RegExp(`src='(${doc.name}\\d+x\\.png)'[^>]*\\/>(?:(?!<img|After )[^])*After ${after}\\.`))?.[1];
      if (!file || !existsSync(join(out, file))) {
        problems.push(`no picture before "After ${after}."`);
        continue;
      }
      const { width, height, channels, rows } = decode(readFileSync(join(out, file)));
      let opaque = 0;
      for (let at = channels - 1; at < rows.length; at += channels) if (rows[at] > 128) opaque++;
      if (!(opaque > width * height / 2)) problems.push(`the picture before "After ${after}." covers ${opaque} of ${width * height} pixels, not its graphic`);
    }
    // (extractbb writes no .xbb file beside a picture)
    const tracked = ['test-picture.xbb', 'test-wide.xbb', 'test-pdfpic/inside.xbb', 'test-pdfpic/own-1.xbb'];
    for (const file of readdirSync(join(root, 'test/fixtures'), { recursive: true })) {
      if (file.endsWith('.xbb') && !tracked.includes(file)) problems.push(`test/fixtures/${file} written beside the fixtures`);
    }
  }
  for (const name of tablePictures[doc.name] ?? []) {
    const between = flat.match(new RegExp(`Before ${name}\\.([^]*?)After ${name}\\.`))?.[1] ?? '';
    const files = [...between.matchAll(/<img [^>]*src='([^']*\.(?:png|svg))'/g)].map(m => join(out, m[1]));
    if (files.length !== 1 || !existsSync(files[0])) {
      problems.push(`not one picture from "Before ${name}." to "After ${name}.", but ${files.filter(existsSync).length} of ${files.length}`);
      continue;
    }
    if (files[0].endsWith('.svg')) continue;
    const width = readFileSync(files[0]).readUInt32BE(16), want = tableWidths[name];
    const natural = name === 'star' && ['test-pictab-plain', 'test-pictab-booktabs'].includes(doc.name);
    if (!natural && !(Math.abs(width - want) <= 0.1 * want)) {
      problems.push(`the picture of "${name}" is ${width} pixels wide, not ${want}`);
    }
    if (!yellowTables.includes(name) && !ruledTables.includes(name)) continue;
    const colors = paletteColors(readFileSync(files[0]));
    if (!colors) {
      problems.push(`the picture of "${name}" is not a PNG with a palette`);
      continue;
    }
    if (yellowTables.includes(name)) {
      const yellow = colors.filter(color => color === 0xffff00).length;
      if (!(yellow >= colors.length / 5)) problems.push(`the picture of "${name}" is ${yellow} of ${colors.length} pixels yellow, not a fifth`);
    }
    if (ruledTables.includes(name)) {
      // (a rule is a line of pixels, nine tenths of them dark, in a run of
      // such lines)
      const dark = color => [16, 8, 0].every(shift => (color >> shift & 0xff) < 0x80);
      let rules = 0, before = false;
      for (let y = 0; y * width < colors.length; y++) {
        const line = colors.slice(y * width, (y + 1) * width), ruled = line.filter(dark).length >= 0.9 * width;
        if (ruled && !before) rules++;
        before = ruled;
      }
      if (rules !== 3) problems.push(`the picture of "${name}" has ${rules} rules across it, not 3`);
    }
  }
  if (tablePictures[doc.name]) {
    // (the ordinary tabulars before and after the pictures)
    if (!/<td [^>]*> First <\/td> ?<td [^>]*> Guard <\/td>/.test(flat)) problems.push('no table with the cells First and Guard');
    if (!/<td [^>]*> Guard <\/td> ?<td [^>]*> Table <\/td>/.test(flat)) problems.push('no table with the cells Guard and Table');
    const main = flat.split('<main>')[1] ?? '';
    if (tablePictureWords.test(main)) problems.push(`the page's text has ${main.match(tablePictureWords)[0]}, which a picture holds`);
  }
  for (const pattern of logs[doc.name] ?? []) {
    if (!pattern.test(result.log)) problems.push(`no ${pattern.source} in make4ht's log`);
  }
  for (const file of untouched[doc.name] ?? []) {
    if (!staleBefore.get(file) || staleState(file) !== staleBefore.get(file)) problems.push(`${file} beside the document changed`);
  }
  if (untouched[doc.name]) {
    for (const file of staleFiles().filter(f => !staleBefore.has(f))) problems.push(`test/fixtures/${file} written beside the document`);
  }
  for (const [file, pattern] of glyphs[doc.name] ?? []) {
    const svg = existsSync(join(out, file)) ? readFileSync(join(out, file), 'utf8') : '';
    if (!pattern.test(svg)) problems.push(`no ${pattern.source} in ${file}`);
  }
  // (prerender.mjs drops the element around a one-character token's mjx-c)
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
  // (once one formula has it, checkOutput checks that every formula does)
  if (html.includes('<mjx-container') && !html.includes('<mjx-assistive-mml')) {
    problems.push('no MathML for screen readers, with TEX8WEB_MATHML');
  }
  const texLog = join(aux, doc.tex.replace(/\.tex$/, '.log'));
  const texLogText = existsSync(texLog) ? readFileSync(texLog, 'latin1') : '';
  for (const pattern of texWarnings[doc.name] ?? []) {
    if (pattern.test(texLogText)) problems.push(`${pattern.source} in the TeX log`);
  }
  for (const pattern of texLines[doc.name] ?? []) {
    if (!pattern.test(texLogText.replace(/\n/g, ''))) problems.push(`no ${pattern.source} in the TeX log`);
  }
  return [...problems, ...checkTexLog(texLog), ...checkLog(result.log), ...checkOutput(out)];
}

if (!only.length) {
  const stray = strayKeys(measured, preloads, families, tikz, nested, boxmath, boxgfx, boxcenter, coveredPictures, tablePictures, glyphs, logs, untouched, ligatures, texWarnings, texLines, copied, pixelSizes, unspaced, pdfPages, expected, hypcap, ...patterns.map(([table]) => table));
  report('the documents the tables name', stray.map(name => `no document ${name}`));
}

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

// test-generic built without prerendering, as without node_modules: MathJax
// typesets the page in the browser
if (!only.length) jobs.push(async () => {
  const doc = docs.find(d => d.name === 'test-generic');
  const out = join(testDir(doc), 'fallback'), aux = join(testDir(doc), 'fallbackaux');
  const result = await build(doc, out, aux, { TEX8WEB_NO_PRERENDER: '1' });
  const html = existsSync(join(out, `${doc.name}.html`)) ? readFileSync(join(out, `${doc.name}.html`), 'utf8') : '';
  const problems = [];
  if (result.code !== 0) problems.push(`make4ht exited with ${result.code}`);
  // (data-mathjax: the MathJax version that tex8web.js pins the font
  // extensions to)
  for (const needed of ['id=\'tex8web-config\'', 'src=\'tex8web.js\'', 'data-mathjax=\'', '/tex-chtml.js']) {
    if (!html.includes(needed)) problems.push(`page lacks ${needed}`);
  }
  if (!existsSync(join(out, 'tex8web.js'))) problems.push('no tex8web.js next to the page');
  if (html.includes('<mjx-container')) problems.push('math typeset at build time');
  problems.push(...checkLog(result.log));
  report(`${doc.name} (MathJax in the browser)`, problems);
});

// test-pagella with prerendering failing (node cannot start): the math is
// left for the browser, and every font listed for preloading was written
const failing = docs.find(d => d.name === 'test-pagella');
if (failing) jobs.push(async () => {
  const out = join(testDir(failing), 'failing'), aux = join(testDir(failing), 'failingaux');
  const result = await build(failing, out, aux, { NODE_OPTIONS: '--no-such-option' });
  const page = join(out, 'test-pagella.html');
  const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
  const problems = [];
  if (result.code !== 0) problems.push(`make4ht exited with ${result.code}`);
  if (!result.log.includes('prerender.mjs failed')) problems.push('no warning that prerendering failed');
  for (const href of fontsListed(html).filter(href => !existsSync(join(out, href)))) problems.push(`${href} preloaded, not written`);
  // (the whole TeX Live font, for the page to show)
  if (!existsSync(join(out, 'fonts/texgyrepagella-regular.otf'))) problems.push('no whole TeX Gyre Pagella beside the page');
  report(`${failing.name} (prerendering fails)`, problems);
});

// test-sortfail/test-sortfail.tex, in a folder of its own as makeindex and
// makeglossaries fail on it by design and it has a LaTeX error, which the
// generic checks count as problems, copied and built twice into one build
// folder: each build's page shows the current .ind and .gls beside the
// document, as the PDF does, and the second build is not left with empty
// files of the first
const sortFails = docs.find(d => d.name === 'test-staleaux-ind');
if (sortFails) jobs.push(async () => {
  const source = join(sortFails.dir, 'test-sortfail'), dir = join(testDir(sortFails), 'sortfail');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of ['tex', 'ind', 'gls']) writeFileSync(join(dir, `test-sortfail.${name}`), readFileSync(join(source, `test-sortfail.${name}`)));
  const shipped = ['ind', 'gls'].map(name => readFileSync(join(source, `test-sortfail.${name}`), 'utf8'));
  const problems = [];
  for (const which of ['first', 'second']) {
    const result = await run(join(root, 'bin/tex8web'), ['-c', sortFails.cfg, '-a', 'info', 'test-sortfail.tex'],
      { cwd: dir, slot: true, env: { ...process.env, ...sortFails.env } });
    const log = result.log ?? '';
    const page = join(dir, 'build/html/test-sortfail.html');
    const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
    if (!html) problems.push(`no page from the ${which} build`);
    for (const warning of ['the index failed', 'the glossaries failed']) {
      if (!log.includes(warning)) problems.push(`no warning that ${warning.slice(4)} in the ${which} build`);
    }
    if (!/<div class='index-item'>Shipped apple, 1 <\/div>/.test(html)) problems.push(`no shipped index entry on the ${which} build's page`);
    if (!glossary('Glossary', entry('fruit', 'fruit', 'the seed-bearing part of a plant\\. 1')).test(html)) problems.push(`no shipped glossary entry on the ${which} build's page`);
  }
  ['ind', 'gls'].forEach((name, i) => {
    if (readFileSync(join(dir, `test-sortfail.${name}`), 'utf8') !== shipped[i]) problems.push(`test-sortfail.${name} beside the document changed`);
  });
  report(`${sortFails.name} (makeindex and makeglossaries fail, built twice)`, problems);
});

// test-shippederr/test-shippederr.tex, in a folder of its own as it has a
// LaTeX error by design, copied and built twice into one build folder,
// which starts with a .idx of an earlier build that had \makeindex: the
// document sorts neither its index nor its glossary, so each build's page
// shows the .ind and .gls shipped beside it, and the second build is not
// left with empty files of the first
const shippedErr = docs.find(d => d.name === 'test-staleaux-ind-shipped');
if (shippedErr) jobs.push(async () => {
  const source = join(shippedErr.dir, 'test-shippederr'), dir = join(testDir(shippedErr), 'shippederr');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'build/tex4ht'), { recursive: true });
  for (const name of ['tex', 'ind', 'gls']) writeFileSync(join(dir, `test-shippederr.${name}`), readFileSync(join(source, `test-shippederr.${name}`)));
  writeFileSync(join(dir, 'build/tex4ht/test-shippederr.idx'), '\\indexentry{Old entry}{1}\n');
  const problems = [];
  for (const which of ['first', 'second']) {
    const result = await run(join(root, 'bin/tex8web'), ['-c', shippedErr.cfg, '-a', 'info', 'test-shippederr.tex'],
      { cwd: dir, slot: true, env: { ...process.env, ...shippedErr.env } });
    const page = join(dir, 'build/html/test-shippederr.html');
    const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
    if (!html) problems.push(`no page from the ${which} build`);
    if (!(result.log ?? '').includes('Undefined control sequence')) problems.push(`no error for \\undefinedcs in the ${which} build's log`);
    if (!/<div class='index-item'>Shipped apple, 1 <\/div>/.test(html)) problems.push(`no shipped index entry on the ${which} build's page`);
    if (!glossary('Glossary', entry('fruit', 'fruit', 'the seed-bearing part of a plant\\. 1')).test(html)) problems.push(`no shipped glossary entry on the ${which} build's page`);
    if (html.includes('Old entry')) problems.push(`Old entry on the ${which} build's page`);
  }
  report(`${shippedErr.name} (with a LaTeX error, built twice)`, problems);
});

// test-staleaux-mtc with its numbered files of an earlier build, copied
// and built twice into one build folder: the log of each build has the
// status line that names minitoc's files beside the document, also when
// the build folder has the empty files of the first build
const staleMtc = docs.find(d => d.name === 'test-staleaux-mtc');
if (staleMtc) jobs.push(async () => {
  const dir = join(testDir(staleMtc), 'twice');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(staleMtc.dir).filter(f => f.startsWith('test-staleaux-mtc.'))) {
    writeFileSync(join(dir, file), readFileSync(join(staleMtc.dir, file)));
  }
  const problems = [];
  for (const which of ['first', 'second']) {
    const result = await run(join(root, 'bin/tex8web'), ['-c', staleMtc.cfg, '-a', 'info', 'test-staleaux-mtc.tex'],
      { cwd: dir, slot: true, env: { ...process.env, ...staleMtc.env } });
    if (result.code !== 0) problems.push(`the ${which} build exited with ${result.code}`);
    if (!/^\[STATUS\] +tex8web: minitoc's mini tables are empty: .*test-staleaux-mtc\.mlf1, .*test-staleaux-mtc\.mtc1, .*test-staleaux-mtc\.ptc1$/m.test(result.log ?? '')) {
      problems.push(`the ${which} build's log has no status line that names minitoc's files`);
    }
  }
  report(`${staleMtc.name} (built twice)`, problems);
});

// test-mathescape built twice, without prerendering: with tex8web-math.tex's
// escaping of each formula's source, and with tex4ht's slower escaping. The
// two pages must be the same.
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

// test-pdfpic built again with \PdfpicAbsolute and \PdfpicAbsolutePdf set
// to the absolute paths of a PNG and a PDF picture, in a folder of its own:
// the PNG is copied and the PDF converted inside the page's folder, under
// names without the path, and no file is written beside the
// page's folder or two levels above it, where its ../ and ../../ pictures
// would go.
const pdfpic = docs.find(d => d.name === 'test-pdfpic');
if (pdfpic) jobs.push(async () => {
  const top = join(testDir(pdfpic), 'absolute'), out = join(top, 'html'), aux = join(top, 'aux');
  for (const dir of [top, join(testDir(pdfpic), 'test')]) rmSync(dir, { recursive: true, force: true });
  mkdirSync(top, { recursive: true });
  const picture = join(root, 'test/pdfpic-above/other/pic.png'), cfg = join(top, 'absolute.cfg');
  writeFileSync(cfg, `\\def\\PdfpicAbsolute{${picture}}\\def\\PdfpicAbsolutePdf{${join(root, 'test/pdfpic-above/up.pdf')}}\n`
    + readFileSync(pdfpic.cfg, 'utf8'));
  const result = await build({ ...pdfpic, cfg }, out, aux);
  const problems = [];
  if (result.code !== 0) {
    problems.push(`make4ht exited with ${result.code}`, ...(result.log ?? '').split('\n').filter(line => /\[(ERROR|FATAL)\]/.test(line)));
  }
  const page = join(out, 'test-pdfpic.html');
  const src = (existsSync(page) ? readFileSync(page, 'utf8') : '').match(/<img alt='absolute' [^>]*src='([^']*)'/)?.[1];
  if (!src) problems.push('no absolute picture');
  else if (src.startsWith('/') || src.includes(root) || /(^|\/)\.\.(\/|$)/.test(src) || !existsSync(join(out, src))) problems.push(`the absolute picture is ${src}`);
  else if (!readFileSync(join(out, src)).equals(readFileSync(picture))) problems.push(`${src} is not a copy of the absolute picture`);
  const pdf = (existsSync(page) ? readFileSync(page, 'utf8') : '').match(/<img alt='absolute pdf' [^>]*src='([^']*)'/)?.[1];
  const converted = !pdf || pdf.includes(root) ? null : inPage(out, pdf);
  if (!converted || !existsSync(converted) || !(Math.abs(pngAspect(readFileSync(converted)) / 3 - 1) < 0.03)) {
    problems.push(`the absolute PDF picture is ${pdf}, not a PNG of it inside the page's folder`);
  }
  const written = pdfpicOnly();
  if (written.length) problems.push(`files written beside the source's pictures: ${written.join(', ')}`);
  const beside = readdirSync(top).filter(name => !/^(html|aux)(\.|$)|^(absolute\.cfg|make4ht\.log)$/.test(name));
  if (beside.length) problems.push(`written beside the page's folder: ${beside.join(', ')}`);
  if (existsSync(join(testDir(pdfpic), 'test'))) problems.push('written two levels above the page\'s folder');
  report(`${pdfpic.name} (an absolute path)`, problems);
});

// test-abspath built again with a test-abspath-case.tex in TEXINPUTS
// that sets \AbsDir to the absolute path of test/fixtures/, \AbsAbove to
// that of test/abspath-above/, and \AbsCase to the cases to read: once for
// each case that marks glossary.tex, and once for the guards. Then a
// document that reads a file beside it by an absolute path, written in a
// folder of its own, so that the bare name glossary that test-abspath's
// other cases look up does not find this file. Then test-priminput-abs
// with a test-priminput-abs-case.tex in TEXINPUTS that sets \AbsDir, so
// that the primitive \input reads its file by an absolute path. Each
// case's file is read by an absolute path, and its text is in the page,
// with nothing that glossary.4ht writes, and one page
const abspath = docs.find(d => d.name === 'test-abspath');
const primabs = docs.find(d => d.name === 'test-priminput-abs');
const absBuilds = [];
if (abspath) {
  const guards = ['plain', 'keep', 'body', 'subfile'];
  const groups = [...absoluteCases.filter(([name]) => !guards.includes(name)).map(c => [c[0], [c]]),
    ['guards', absoluteCases.filter(([name]) => guards.includes(name))]];
  absBuilds.push(...groups.map(([key, cases]) => ({
    doc: abspath, key, label: `case${cases.length > 1 ? 's' : ''} ${cases.map(([name]) => name).join(', ')}, by an absolute path`,
    wanted: cases.map(([, text, extra]) => [`${text} By an absolute path.`, extra]),
    setup(top) {
      const file = join(top, 'test-abspath-case.tex');
      const cfg = `\\def\\AbsDir{${join(root, 'test/fixtures')}/}\\def\\AbsAbove{${join(root, 'test/abspath-above')}/}`
        + `\\def\\AbsCase{${cases.map(([name]) => name).join(',')}}\n`;
      // (never reused when the cases change, or for the case above: the
      // build's stamp leaves out this file and test/abspath-above)
      if (key === 'above' || (existsSync(file) && readFileSync(file, 'utf8') !== cfg)) rmSync(top, { recursive: true, force: true });
      mkdirSync(top, { recursive: true });
      writeFileSync(file, cfg);
      return { doc: abspath, env: { TEXINPUTS: `${top}:` }, page: 'test-abspath.html' };
    },
  })));
  absBuilds.push({
    doc: abspath, key: 'beside', label: 'a file beside the document, by an absolute path',
    wanted: [['Beside: Text from the file beside the document.']],
    setup(top) {
      const dir = join(top, 'doc');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'glossary.tex'), '\\ProvidesFile{glossary.tex}\n\\def\\besidetext{Text from the file beside the document.}\n');
      writeFileSync(join(dir, 'beside.tex'), `\\documentclass{article}\n\\input{${dir}/glossary}\n`
        + '\\begin{document}\nBeside: \\besidetext\n\\end{document}\n');
      return { doc: { ...abspath, name: 'test-abspath beside', dir, tex: 'beside.tex' }, page: 'beside.html' };
    },
  });
}
if (primabs) absBuilds.push({
  doc: primabs, key: '', label: 'by an absolute path',
  wanted: [['Absolute: Text from the subfolder glossary file. By an absolute path.']],
  setup(top) {
    const file = join(top, 'test-priminput-abs-case.tex');
    const cfg = `\\def\\AbsDir{${join(root, 'test/fixtures')}/}\n`;
    // (never reused when the path changes: the build's stamp leaves out
    // this file)
    if (existsSync(file) && readFileSync(file, 'utf8') !== cfg) rmSync(top, { recursive: true, force: true });
    mkdirSync(top, { recursive: true });
    writeFileSync(file, cfg);
    return { doc: primabs, env: { TEXINPUTS: `${top}:` }, page: 'test-priminput-abs.html' };
  },
});
// test-provname-bbx built again in a folder of its own, with a copy of
// the tree's biblatex.sty beside it, as a document that ships biblatex:
// the copy reads debug.bbx with the primitive \input, and tex4ht still
// reads debug.4ht for the copied style
const provbbx = docs.find(d => d.name === 'test-provname-bbx');
if (provbbx) absBuilds.push({
  doc: provbbx, key: 'vendored', label: 'with a copy of biblatex.sty beside it',
  wanted: [['Read for the web.', /<dd class='thebibliography' id='bib-1'>[^]*A Book with a Title/]],
  setup(top) {
    const dir = join(top, 'doc');
    mkdirSync(dir, { recursive: true });
    const sty = spawnSync('kpsewhich', ['biblatex.sty'], { encoding: 'utf8' }).stdout.trim();
    for (const file of [sty, ...['test-provname-bbx.tex', 'debug.bbx', 'test-biblatex-authoryear.bib'].map(name => join(root, 'test/fixtures', name))]) {
      writeFileSync(join(dir, basename(file)), readFileSync(file));
    }
    return { doc: { ...provbbx, name: 'test-provname-bbx vendored', dir }, page: 'test-provname-bbx.html' };
  },
});
for (const { doc: fixture, key, label, wanted, setup } of absBuilds) jobs.push(async () => {
  const top = join(testDir(fixture), `absolute${key}`), out = join(top, 'html'), aux = join(top, 'aux');
  const { doc, env, page } = setup(top);
  const result = await build(doc, out, aux, env);
  const problems = [];
  if (result.code !== 0) {
    problems.push(`make4ht exited with ${result.code}`, ...(result.log ?? '').split('\n').filter(line => /\[(ERROR|FATAL)\]|^! /.test(line)));
  }
  const file = join(out, page);
  const flat = existsSync(file) ? readFileSync(file, 'utf8').replace(/[^\S\u202F]+/g, ' ') : '';
  if (!flat) problems.push('no page');
  else {
    for (const [text, extra] of wanted) {
      if (!flat.includes(text)) problems.push(`no ${JSON.stringify(text)} in the page`);
      if (extra && !extra.test(flat)) problems.push(`no ${extra} in the page`);
    }
    if (flat.includes('refextract')) problems.push('refextract in the page');
    if (/<\/html>[^]*<\/html>/.test(flat)) problems.push('two pages in one');
  }
  report(`${fixture.name} (${label})`, problems);
});

// test-texinpkg built again with a folder of test-texinpkg/ on TEXINPUTS,
// as a .latexmkrc's ensure_path or the environment adds one: a package or
// class of the document there reads files that give the names of tex4ht
// configuration files, and the document reads one there too. Each folder
// is named by its absolute path, except where its entry is relative and
// recursive, as ensure_path entries often are, and a recursive entry
// finds a package two folders below. One case has two folders. Some
// folders are copied to a folder whose name has a space, %, #, or ', and
// one, with the document, to a folder of its own. Each case's text is in
// the page, with no sentence that shows that index.4ht or framed.4ht was
// read, and the TeX log reads no .4ht of the names the files give. The
// guards keep tex4ht's configuration of the tree's files that a package on
// TEXINPUTS loads, also after such a package reads a file of the same
// name. Then test-provname-bbx with debug.bbx in a folder on TEXINPUTS,
// with and without a copy of the tree's biblatex.sty, as a document that
// ships biblatex or its style in a folder of packages: tex4ht still reads
// debug.4ht for the style
const texinpkg = docs.find(d => d.name === 'test-texinpkg');
const texinpkgDir = join(root, 'test/fixtures/test-texinpkg');
const texinpkgBuilds = [];
if (texinpkg) {
  // [key, label, folder of test-texinpkg/, copied to this name or null,
  // TEXINPUTS entry (from the folder's path), texts, .4ht files the TeX
  // log must not read, .4ht files it must read]
  const cases = [
    ['1', 'a primitive \\input of a file in a subfolder beside the document', 'case1', null, d => d,
      ['Case 1: Text of the subfolder glossary beside the document.'], ['glossary.4ht'], []],
    ['2', 'a primitive \\input of a file in a subfolder of the package\'s folder', 'case2', null, d => d,
      ['Case 2: Text of the glossary in a subfolder of the package folder.'], ['glossary.4ht'], []],
    ['3', 'a primitive \\input of a file found only on TEXINPUTS', 'case3', null, d => d,
      ['Case 3: Text of the nomencl file beside the package.'], ['nomencl.4ht'], []],
    ['4', 'LaTeX\'s braced \\input', 'case4', null, d => d,
      ['Case 4: Text of the file read with the braced input.'], ['glossary.4ht'], []],
    ['silent', 'LaTeX\'s braced \\input of a file that gives the name of index.4ht', 'silent', null, d => d,
      ['Silent: Text of the file that gives the name index.tex.'], ['index.4ht'], []],
    ['5', '\\@@input', 'case5', null, d => d,
      ['Case 5: Text of the file read with the primitive input under its LaTeX name.'], ['glossary.4ht'], []],
    ['6', 'the document\'s own \\input of a file found on TEXINPUTS', 'case6', null, d => d,
      ['Case 6: Text of glossary.tex in the package folder, read by the document.'], ['glossary.4ht'], []],
    ['7', 'a recursive entry, with the package two folders below it', 'case7', null, d => `${d}//`,
      ['Case 7: Text of the file two folders below a recursive entry.'], ['glossary.4ht'], []],
    ['8', 'a folder with a space in its name', 'case8', 'lib with space', d => d,
      ['Case 8: Text of the glossary in a folder with a space.'], ['glossary.4ht'], []],
    ['9', 'a relative, recursive entry', 'case9', null, d => `./${relative(texinpkg.dir, d)}//`,
      ['Case 9: Text of the file below a relative recursive entry.'], ['glossary.4ht'], []],
    ['11', 'a class on TEXINPUTS', 'case11', null, d => d,
      ['Case 11: Text of the glossary read by the class.'], ['glossary.4ht'], []],
    ['12', 'a primitive \\input of a file beside the document', 'case12', 'doc', d => join(d, 'lib'),
      ['Case 12: Text of the glossary beside the document.'], ['glossary.4ht'], []],
    ['13', 'a package loaded by a path below the folder', 'case13', null, d => d,
      ['Case 13: Text of the glossary read by a package loaded by its path.'], ['glossary.4ht'], []],
    ['14', 'two folders, with the package that reads the file in the second', 'case14', null, d => `${d}/a:${d}/b`,
      ['Case 14: Text of the glossary in the second folder.'], ['glossary.4ht'], []],
    ['percent', 'a folder with % in its name', 'special', 'lib%percent', d => d,
      ['Special: Text of the glossary in a folder with a special character.'], ['glossary.4ht'], []],
    ['hash', 'a folder with # in its name', 'special', 'lib#hash', d => d,
      ['Special: Text of the glossary in a folder with a special character.'], ['glossary.4ht'], []],
    ['quote', 'a folder with \' in its name', 'special', 'lib\'quote', d => d,
      ['Special: Text of the glossary in a folder with a special character.'], ['glossary.4ht'], []],
    ['tree', 'a guard: files of the tree loaded by a package on TEXINPUTS', 'tree', null, d => d,
      ['Tree: The package loads files of the tree.', 'Framed read for the web.',
        /<span style='color:light-dark\(#B80000, [^']*\);'>Brick red text\.<\/span>/], [], ['framed.4ht', 'dvipsnam.4ht', 'epsf.4ht']],
    ['15', 'a guard: a file named like the tree\'s nomencl package, then the package', 'case15', null, d => d,
      ['Case 15: Text of the nomencl file before the nomencl package.'], [], ['nomencl.4ht']],
  ];
  for (const [key, label, folder, copy, entry, shows, unread, read] of cases) texinpkgBuilds.push({
    doc: texinpkg, key, label, shows, unread, read, page: 'test-texinpkg.html', log: 'test-texinpkg.log',
    hides: ['Index read for the web.', ...key === 'tree' ? [] : ['Framed read for the web.']],
    setup(top) {
      let dir = join(texinpkgDir, folder);
      if (copy) {
        // (the copy's content comes from test-texinpkg/, which the build's
        // stamp covers)
        mkdirSync(top, { recursive: true });
        cpSync(dir, join(top, copy), { recursive: true });
        dir = join(top, copy);
      }
      // (copied to doc, the folder holds the document too, which is then
      // built from there)
      if (copy !== 'doc') return { TEXINPUTS: `${entry(dir)}:` };
      writeFileSync(join(dir, 'test-texinpkg.tex'), readFileSync(join(texinpkg.dir, 'test-texinpkg.tex')));
      return { TEXINPUTS: `${entry(dir)}:`, doc: { ...texinpkg, name: `test-texinpkg ${key}`, dir } };
    },
  });
}
const provbbxTexinputs = docs.find(d => d.name === 'test-provname-bbx');
// (with the copy of biblatex.sty, or with debug.bbx alone and the tree's
// biblatex)
if (provbbxTexinputs) for (const [key, label, sty] of [['bbx', 'copies of biblatex.sty and debug.bbx', true], ['bbxonly', 'debug.bbx', false]]) texinpkgBuilds.push({
  doc: provbbxTexinputs, key, label: `a guard: ${label} on TEXINPUTS`,
  shows: ['Read for the web.', /<dd class='thebibliography' id='bib-1'>[^]*A Book with a Title/], hides: [], unread: [], read: ['debug.4ht'],
  page: 'test-provname-bbx.html', log: 'test-provname-bbx.log',
  setup(top) {
    // (the document in a folder of its own, without the debug.bbx beside
    // it in test/fixtures, and the folder on TEXINPUTS inside it, which
    // the build's stamp covers)
    const dir = join(top, 'doc'), lib = join(dir, 'lib');
    mkdirSync(lib, { recursive: true });
    const copies = [join(root, 'test/fixtures/debug.bbx')];
    if (sty) copies.push(spawnSync('kpsewhich', ['biblatex.sty'], { encoding: 'utf8' }).stdout.trim());
    for (const file of copies) writeFileSync(join(lib, basename(file)), readFileSync(file));
    for (const name of ['test-provname-bbx.tex', 'test-biblatex-authoryear.bib']) writeFileSync(join(dir, name), readFileSync(join(root, 'test/fixtures', name)));
    return { TEXINPUTS: `${lib}:`, doc: { ...provbbxTexinputs, name: `test-provname-bbx ${key}`, dir } };
  },
});
// test-texmfpkg built again from each folder of test-texmfpkg/, as a
// writer keeps a package or class of their own in TEXMFHOME: the document
// is copied to the folder's doc/, with the files beside it, and the
// folder's texmf/ is TEXMFHOME. The package or class reads, with the
// primitive \input or \@@input, a file that gives the name of a tex4ht
// configuration file: beside the document, with no extension, in a
// subfolder of it, or beside the package in the tree. Each case's text is
// in the page, with no sentence that shows that glossary.4ht or
// framed.4ht was read, and the TeX log reads no .4ht of the names the
// files give. The guards: LaTeX's braced \input, the tree's files that
// such a package loads, which keep their .4ht, also a file of the tree
// that gives its own name, read with the primitive \input, and the tree's
// nomencl package after a file beside the document of that name.
const texmfpkg = docs.find(d => d.name === 'test-texmfpkg');
const texmfpkgDir = join(root, 'test/fixtures/test-texmfpkg');
const texmfpkgBuilds = [];
if (texmfpkg) {
  // [key, label, folder of test-texmfpkg/, texts, .4ht files the TeX log
  // must not read, .4ht files it must read]
  const cases = [
    ['details', 'a package in TEXMFHOME, a primitive \\input of a file beside the document', 'details',
      ['Details: Text of the glossary beside the document.'], ['glossary.4ht'], []],
    ['path', 'a package loaded by a path below the tree\'s folders', 'path',
      ['Path: Text of the glossary read by a package loaded by its path.'], ['glossary.4ht'], []],
    ['noext', 'a primitive \\input of a file with no extension beside the document', 'noext',
      ['No extension: Text of the glossary with no extension.'], ['glossary.4ht'], []],
    ['sub', 'a primitive \\input of a file in a subfolder beside the document', 'sub',
      ['Subfolder: Text of the glossary in a subfolder beside the document.'], ['glossary.4ht'], []],
    ['class', 'a class in TEXMFHOME', 'class',
      ['Class: Text of the glossary read by the class.'], ['glossary.4ht'], []],
    ['data', 'a primitive \\input of the package\'s data file beside it in the tree', 'data',
      ['Data: Text of the data file beside the package in the tree.'], ['glossary.4ht'], []],
    ['atat', '\\@@input', 'atat',
      ['Atat: Text of the glossary read with the primitive input under its LaTeX name.'], ['glossary.4ht'], []],
    ['braced', 'a guard: LaTeX\'s braced \\input', 'braced',
      ['Braced: Text of the glossary read with the braced input.'], ['glossary.4ht'], []],
    ['tree', 'a guard: files of the tree loaded by a package in TEXMFHOME', 'tree',
      ['Tree: The package loads files of the tree.', 'Framed read for the web.',
        /<span style='color:light-dark\(#B80000, [^']*\);'>Brick red text\.<\/span>/], [], ['framed.4ht', 'dvipsnam.4ht', 'epsf.4ht', 'english.4ht']],
    ['nomencl', 'a guard: a file beside the document named like the tree\'s nomencl package, then the package', 'nomencl',
      ['Nomencl: Text of the nomencl file before the nomencl package.'], [], ['nomencl.4ht']],
  ];
  for (const [key, label, folder, shows, unread, read] of cases) texmfpkgBuilds.push({
    doc: texmfpkg, key, label, shows, unread, read, page: 'test-texmfpkg.html', log: 'test-texmfpkg.log',
    hides: ['Glossary read for the web.', ...key === 'tree' ? [] : ['Framed read for the web.']],
    setup(top) {
      // (a fresh copy, with the document in doc/ and the tree in texmf/,
      // both below the copy, which the build's stamp then covers)
      const dir = join(top, 'case');
      rmSync(dir, { recursive: true, force: true });
      cpSync(join(texmfpkgDir, folder), dir, { recursive: true });
      mkdirSync(join(dir, 'doc'), { recursive: true });
      writeFileSync(join(dir, 'doc/test-texmfpkg.tex'), readFileSync(join(texmfpkg.dir, 'test-texmfpkg.tex')));
      return { TEXMFHOME: join(dir, 'texmf'), doc: { ...texmfpkg, name: `test-texmfpkg ${key}`, dir: join(dir, 'doc'), sourceRoot: dir } };
    },
  });
}
for (const { doc: fixture, key, label, shows, hides, unread, read, page, log, setup } of texinpkgBuilds) jobs.push(async () => {
  const top = join(testDir(fixture), `texinputs${key}`), out = join(top, 'html'), aux = join(top, 'aux');
  const { doc = fixture, ...env } = setup(top);
  const result = await build(doc, out, aux, env);
  const problems = [];
  if (result.code !== 0) {
    problems.push(`make4ht exited with ${result.code}`, ...(result.log ?? '').split('\n').filter(line => /\[(ERROR|FATAL)\]|^! /.test(line)).slice(0, 3));
  }
  const file = join(out, page);
  const flat = existsSync(file) ? readFileSync(file, 'utf8').replace(/[^\S ]+/g, ' ') : '';
  if (!flat) problems.push('no page');
  else {
    for (const text of shows) if (typeof text === 'string' ? !flat.includes(text) : !text.test(flat)) problems.push(`no ${text} in the page`);
    for (const text of hides) if (flat.includes(text)) problems.push(`${JSON.stringify(text)} in the page`);
    if (flat.includes('refextract')) problems.push('refextract in the page');
    if (/<\/html>[^]*<\/html>/.test(flat)) problems.push('two pages in one');
  }
  const texLog = join(aux, log), logText = existsSync(texLog) ? readFileSync(texLog, 'latin1').replace(/\n/g, '') : '';
  if (!logText) problems.push('no TeX log');
  for (const name of unread) if (logText.includes(`/${name}`)) problems.push(`the TeX log reads ${name}`);
  for (const name of read) if (!logText.includes(`/${name}`)) problems.push(`the TeX log does not read ${name}`);
  report(`${fixture.name} (on TEXINPUTS: ${label})`, problems);
});
// The same checks for each build of test-texmfpkg, in a folder of its own.
for (const { doc: fixture, key, label, shows, hides, unread, read, page, log, setup } of texmfpkgBuilds) jobs.push(async () => {
  const top = join(testDir(fixture), `texmf${key}`), out = join(top, 'html'), aux = join(top, 'aux');
  const { doc = fixture, ...env } = setup(top);
  const result = await build(doc, out, aux, env);
  const problems = [];
  if (result.code !== 0) {
    problems.push(`make4ht exited with ${result.code}`, ...(result.log ?? '').split('\n').filter(line => /\[(ERROR|FATAL)\]|^! /.test(line)).slice(0, 3));
  }
  const file = join(out, page);
  const flat = existsSync(file) ? readFileSync(file, 'utf8').replace(/[^\S ]+/g, ' ') : '';
  if (!flat) problems.push('no page');
  else {
    for (const text of shows) if (typeof text === 'string' ? !flat.includes(text) : !text.test(flat)) problems.push(`no ${text} in the page`);
    for (const text of hides) if (flat.includes(text)) problems.push(`${JSON.stringify(text)} in the page`);
    if (flat.includes('refextract')) problems.push('refextract in the page');
    if (/<\/html>[^]*<\/html>/.test(flat)) problems.push('two pages in one');
  }
  const texLog = join(aux, log), logText = existsSync(texLog) ? readFileSync(texLog, 'latin1').replace(/\n/g, '') : '';
  if (!logText) problems.push('no TeX log');
  for (const name of unread) if (logText.includes(`/${name}`)) problems.push(`the TeX log reads ${name}`);
  for (const name of read) if (!logText.includes(`/${name}`)) problems.push(`the TeX log does not read ${name}`);
  report(`${fixture.name} (in a TeX tree: ${label})`, problems);
});

// test-ownpkg built again from each folder of test-ownpkg/, copied beside
// the document: a package or class of the writer's named like a tex4ht
// configuration file. Each case's text is in the page, set as in the PDF,
// and the TeX log reads no .4ht for the writer's file. The guards: an
// older copy of the tree's url.sty, made here from the tree's file, which
// keeps url.4ht, and a writer's exam.cls.
const ownpkg = docs.find(d => d.name === 'test-ownpkg');
const ownpkgDir = join(root, 'test/fixtures/test-ownpkg');
const ownpkgBuilds = [];
if (ownpkg) {
  const slidesText = [/<span class='cmbx-10'>Idea 1: First<\/span>/, /<span class='cmti-10'>Takeaway: Text of the writer.s slides package\.<\/span>/,
    /<span class='cmbx-10'>Key point:<\/span>(?:<span class='tex8web-nbsp'> <\/span>|\s)*Text of the key point\./];
  const urlText = [/Site: <span class='cmtt-10'>example\.org\/notes<\/span>\./, /Mail: <span class='cmtt-10'>writer@example\.org<\/span>\./];
  // (as article sets the title, which slides.4ht configures as a slide's)
  const titleText = [/<h1 class='titleHead'>Lecture One<\/h1>/, /<div class='author'\s*><span class='cmr-12'>A\. Writer<\/span><\/div>/,
    /<div class='date'\s*><span class='cmr-12'>Week One<\/span><\/div>/];
  const slideText = [/<span class='cmbx-10'>Slide: Opening<\/span>/, /Text of the slide\./, /<span class='cmti-10'>End of the slide\.<\/span>/];
  // [key, label, folder of test-ownpkg/, texts, .4ht files the TeX log
  // must not read, .4ht files it must read]
  const cases = [
    ['slides', 'a slides.sty with no \\ProvidesPackage line', 'slides', slidesText, ['slides.4ht'], []],
    ['provides', 'a slides.sty with \\ProvidesPackage{slides}', 'provides', slidesText, ['slides.4ht'], []],
    ['hyperref', 'a slides.sty with no \\ProvidesPackage line, and hyperref', 'hyperref', slidesText, ['slides.4ht'], []],
    ['slideenv', 'a slides.sty that defines a slide environment', 'slideenv', slideText, ['slides.4ht'], []],
    ['slidetitle', 'a slides.sty that defines a slide environment and a title slide', 'slidetitle',
      [/<span class='cmbx-10'>Title slide: Lecture One<\/span>/, /<span class='cmti-10'>A\. Writer, Week One<\/span>/, ...slideText], ['slides.4ht'], []],
    ['require', 'a slides.sty loaded by \\RequirePackage from a package of the writer\'s', 'require', slidesText, ['slides.4ht'], []],
    ['url', 'a url.sty with \\ProvidesPackage{url}', 'url', urlText, ['url.4ht'], []],
    ['urlbare', 'a url.sty with no \\ProvidesPackage line', 'urlbare', urlText, ['url.4ht'], []],
    ['urlold', 'a guard: an older copy of the tree\'s url.sty', 'urlold',
      [/Site: <a class='url' href='https:\/\/example\.org\/a_b'><span class='cmtt-10'>https:\/\/example\.<wbr \/>org\/<wbr \/>a_<wbr \/>b<\/span><\/a>\./,
      /Path: <span class='path'><span class='cmtt-10'>dir\/<wbr \/>file<\/span><\/span>\./], [], ['url.4ht']],
    ['maketitle', 'a slides.sty with no \\ProvidesPackage line, and \\maketitle', 'maketitle', [...titleText, slidesText[0]], ['slides.4ht'], []],
    ['list', 'a slides.sty loaded in a list of packages', 'list', slidesText, ['slides.4ht'], []],
    ['slidescls', 'a slides.cls with a slide environment', 'slidescls', slideText, ['slides.4ht'], []],
    ['resume', 'a resume.cls', 'resume', [/<span class='cmbx-10'>A\. Writer<\/span>/, /Lives in <span class='cmti-10'>Springfield<\/span>\./], ['resume.4ht'], []],
    ['examhead', 'an exam.cls with the exam page style', 'examhead',
      [/<span class='cmbx-10'>Question 1\.<\/span>(?:<span class='tex8web-nbsp'> <\/span>|\s)*Text of the first question\./], ['exam.4ht'], []],
    ['urldated', 'a url.sty dated before the tree\'s', 'urldated', urlText, ['url.4ht'], []],
    ['treecls', 'a guard: the tree\'s slides class', 'treecls', [/Text of the slide\./], [], ['slides.4ht']],
    ['exam', 'a guard: an exam.cls of the writer\'s', 'exam',
      [/<span class='cmbx-10'>Question 1\.<\/span>(?:<span class='tex8web-nbsp'> <\/span>|\s)*Text of the first question\./, /<span class='cmbx-10'>Question 2\.<\/span>(?:<span class='tex8web-nbsp'> <\/span>|\s)*Text of the second question\./], [], []],
  ];
  for (const [key, label, folder, shows, unread, read] of cases) ownpkgBuilds.push({
    key, label, shows, unread, read,
    setup(top) {
      // (a fresh copy beside the document, which the build's stamp then
      // covers)
      const dir = join(top, 'doc');
      rmSync(dir, { recursive: true, force: true });
      cpSync(join(ownpkgDir, folder), dir, { recursive: true });
      writeFileSync(join(dir, 'test-ownpkg.tex'), readFileSync(join(ownpkg.dir, 'test-ownpkg.tex')));
      if (key === 'urlold') {
        const sty = readFileSync(spawnSync('kpsewhich', ['url.sty'], { encoding: 'utf8' }).stdout.trim(), 'latin1');
        const old = sty.replace(/(\\ProvidesPackage\s*\{url\}\[)\d{4}\/\d\d\/\d\d \\space ver [\d.]+/, '$12005/06/27 \\space ver 3.2');
        if (old === sty) throw new Error('no \\ProvidesPackage line with a date and version in the tree\'s url.sty');
        writeFileSync(join(dir, 'url.sty'), old, 'latin1');
      }
      return { ...ownpkg, name: `test-ownpkg ${key}`, dir };
    },
  });
}
for (const { key, label, shows, unread, read, setup } of ownpkgBuilds) jobs.push(async () => {
  const top = join(testDir(ownpkg), `own${key}`), out = join(top, 'html'), aux = join(top, 'aux');
  const result = await build(setup(top), out, aux);
  const problems = [];
  if (result.code !== 0) {
    problems.push(`make4ht exited with ${result.code}`, ...(result.log ?? '').split('\n').filter(line => /\[(ERROR|FATAL)\]|^! /.test(line)).slice(0, 3));
  }
  const file = join(out, 'test-ownpkg.html');
  const flat = existsSync(file) ? readFileSync(file, 'utf8').replace(/[^\S ]+/g, ' ') : '';
  if (!flat) problems.push('no page');
  else {
    for (const text of shows) if (!text.test(flat)) problems.push(`no ${text} in the page`);
    if (/<\/html>[^]*<\/html>/.test(flat)) problems.push('two pages in one');
  }
  const texLog = join(aux, 'test-ownpkg.log'), logText = existsSync(texLog) ? readFileSync(texLog, 'latin1').replace(/\n/g, '') : '';
  if (!logText) problems.push('no TeX log');
  for (const name of unread) if (logText.includes(`/${name}`)) problems.push(`the TeX log reads ${name}`);
  for (const name of read) if (!logText.includes(`/${name}`)) problems.push(`the TeX log does not read ${name}`);
  report(`${ownpkg.name} (beside the document: ${label})`, problems);
});

// test-pdfpages-hint built again without shell escape
// (kpathsea reads shell_escape from the environment before texmf.cnf):
// pdfpages' lastpage hint gives the number of pages, one short of the
// PDF's, so the page shows the pictures of pdfPagesNoShell. The run
// without the hint gives pdfpages' warning in the TeX log, and the closed
// range no LaTeX error that a page does not exist.
const hint = docs.find(d => d.name === 'test-pdfpages-hint');
if (hint) jobs.push(async () => {
  const top = join(testDir(hint), 'noshell'), out = join(top, 'html'), aux = join(top, 'aux');
  rmSync(top, { recursive: true, force: true });
  const result = await build(hint, out, aux, { shell_escape: 'f' });
  const problems = [];
  if (result.code !== 0) {
    problems.push(`make4ht exited with ${result.code}`, ...(result.log ?? '').split('\n').filter(line => /\[(ERROR|FATAL)\]/.test(line)));
  }
  const page = join(out, 'test-pdfpages-hint.html'), texLog = join(aux, 'test-pdfpages-hint.log');
  if (!existsSync(page)) problems.push('no page');
  else problems.push(...checkPdfPages(pdfPagesNoShell, readFileSync(page, 'utf8').replace(/[^\S ]+/g, ' '), out));
  if (!existsSync(texLog) || !readFileSync(texLog, 'latin1').includes(pdfpagesHintWarning)) problems.push('no pdfpages warning that names the lastpage hint in the TeX log');
  if (existsSync(texLog) && readFileSync(texLog, 'latin1').includes('does not exist')) problems.push('a LaTeX error in the TeX log that a page does not exist');
  const written = pdfpagesOnly();
  if (written.length) problems.push(`files written beside the included PDFs: ${written.join(', ')}`);
  report(`${hint.name} (without shell escape)`, problems);
});

// test-pdfpages-hint built again with \PdfpagesMissing defined: its run
// "missing" includes a PDF that does not exist, so pdfpages' error is in
// the TeX log, and the run has no picture, as no page is read. With shell
// escape, the number of pages is read, so the TeX log has no warning
// about the lastpage hint.
if (hint) jobs.push(async () => {
  const top = join(testDir(hint), 'missing'), out = join(top, 'html'), aux = join(top, 'aux');
  rmSync(top, { recursive: true, force: true });
  mkdirSync(top, { recursive: true });
  const cfg = join(top, 'missing.cfg');
  writeFileSync(cfg, '\\def\\PdfpagesMissing{}\n' + readFileSync(hint.cfg, 'utf8'));
  await build({ ...hint, cfg }, out, aux);
  const problems = [];
  const page = join(out, 'test-pdfpages-hint.html'), texLog = join(aux, 'test-pdfpages-hint.log');
  const texText = existsSync(texLog) ? readFileSync(texLog, 'latin1') : '';
  if (!texText.includes('Cannot find file')) problems.push('no pdfpages error in the TeX log');
  if (texText.includes(pdfpagesHintWarning)) problems.push('a pdfpages warning about the lastpage hint in the TeX log, with shell escape');
  if (!existsSync(page)) problems.push('no page');
  else {
    const flat = readFileSync(page, 'utf8').replace(/[^\S ]+/g, ' ');
    const part = flat.match(/Run missing\.([^]*?)Run /)?.[1];
    if (part === undefined) problems.push('no run missing');
    else if (/<img /.test(part)) problems.push(`run missing: ${part.match(/<img /g).length} pictures, not none`);
    problems.push(...checkPdfPages(pdfPages[hint.name], flat, out));
  }
  const written = pdfpagesOnly();
  if (written.length) problems.push(`files written beside the included PDFs: ${written.join(', ')}`);
  report(`${hint.name} (a missing PDF)`, problems);
});

// test-glossaries-ist built over a build directory that holds another
// test-glossaries-ist.ist, as an earlier build without \noist leaves there:
// the glossary is still sorted with the style file next to the document.
// (bin/tex8web is run directly, as build() empties the build directory)
const noist = docs.find(d => d.name === 'test-glossaries-ist');
if (noist) jobs.push(async () => {
  const out = join(testDir(noist), 'stale'), aux = join(testDir(noist), 'staleaux');
  rmSync(out, { recursive: true, force: true });
  rmSync(aux, { recursive: true, force: true });
  mkdirSync(aux, { recursive: true });
  const style = readFileSync(join(noist.dir, 'test-glossaries-ist.ist'), 'utf8');
  const older = join(aux, 'test-glossaries-ist.ist');
  writeFileSync(older, style.replace('Sorted with our own style.', 'Sorted with a stale style.'));
  // (dated a minute back, as the earlier build wrote it)
  const minuteAgo = new Date(Date.now() - 60000);
  utimesSync(older, minuteAgo, minuteAgo);
  const result = await run(join(root, 'bin/tex8web'), ['-c', relative(noist.dir, noist.cfg), '-B', relative(noist.dir, aux),
    '-d', relative(noist.dir, out), '-a', 'info', noist.tex], { cwd: noist.dir, slot: true, env: { ...process.env, ...noist.env } });
  const page = join(out, 'test-glossaries-ist.html');
  const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
  const problems = [];
  if (result.code !== 0) problems.push(`make4ht exited with ${result.code}`);
  if (!html.includes('Sorted with our own style.')) problems.push('the glossary is not sorted with the style file next to the document');
  if (html.includes('stale style')) problems.push("the glossary is sorted with the build directory's older style file");
  report(`${noist.name} (an older style file in the build directory)`, problems);
});

// test-xcharter-osfi built over a build directory that holds the font file
// tex8web writes for XCharter, with lm-ec.htf's slots, as an earlier build
// may leave there: the page still shows the ligatures as the PDF does.
// (bin/tex8web is run directly, as build() empties the build directory)
const oldhtf = docs.find(d => d.name === 'test-xcharter-osfi');
if (oldhtf) jobs.push(async () => {
  const out = join(testDir(oldhtf), 'stale'), aux = join(testDir(oldhtf), 'staleaux');
  rmSync(out, { recursive: true, force: true });
  rmSync(aux, { recursive: true, force: true });
  const alias = join(aux, 'tex8web-htf/ht-fonts/alias');
  mkdirSync(alias, { recursive: true });
  const lm = spawnSync('kpsewhich', ['-progname=tex4ht', '-format=othertext', 'lm-ec.htf'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(alias, 'tex8web-xcharter.htf'), readFileSync(lm, 'utf8').replace(/^lm-ec /gm, 'tex8web-xcharter '));
  const result = await run(join(root, 'bin/tex8web'), ['-c', relative(oldhtf.dir, oldhtf.cfg), '-B', relative(oldhtf.dir, aux),
    '-d', relative(oldhtf.dir, out), '-a', 'info', oldhtf.tex], { cwd: oldhtf.dir, slot: true, env: { ...process.env, ...oldhtf.env } });
  const page = join(out, 'test-xcharter-osfi.html');
  const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
  const problems = [];
  if (result.code !== 0) problems.push(`make4ht exited with ${result.code}`);
  problems.push(...ligatureProblems(oldhtf.name, html.replace(/[^\S\u202F]+/g, ' ')));
  report(`${oldhtf.name} (an older font file in the build directory)`, problems);
});

// The documents of test/fixtures/test-stalebcf/ built twice as doc.tex into
// one build folder, the default build/tex4ht or the document's directory,
// with a bibliography backend that changed between the builds. The second
// build exits with 0, and its page has the citation and the entry of a
// fresh build of that document, with no LaTeX error from the first build's
// .bbl, .bcf, or .aux. biber runs only for a document that loads biblatex
// with biber. A build folder that the same backend left current takes no
// more LaTeX runs than staleBcfRuns. Each case takes a different path in
// htlatex_first or bibliography.lua, or loads biblatex in a different way.
// The cases with natbib keep bibtex and change the style: a .bbl without
// author-year data, then natbib with an author-year style.
const staleBcf = docs.find(d => d.name === 'test-stalebcf');
const staleBcfEntry = /Ann Able\. <span class='cmti-10'>A Book Kept in the Build Folder<\/span>\. A Publisher, 1999\./;
const staleBcfBiblatex = [/See \[(?:<a id='[^']*'><\/a>)*<a href='#X0-able'>1<\/a>\]\./, staleBcfEntry];
const staleBcfBibtex = [/See <span class='cite'>\[<a href='#Xable'>1<\/a>\]<\/span>\./, staleBcfEntry];
// (biblatex with a bibtex backend cites a second entry, which a biber run
// on the first build's .bcf leaves out)
const staleBcfTwo = [/See \[(?:<a id='[^']*'><\/a>)*<a href='#X0-able'>1<\/a>\] and \[(?:<a id='[^']*'><\/a>)*<a href='#X0-baker'>2<\/a>\]\./,
  staleBcfEntry, /Bo Baker\. <span class='cmti-10'>A Second Book<\/span>\. A Publisher, 2001\./];
const staleBcfPages = {
  biber: staleBcfBiblatex, 'biber-hyperref': staleBcfBiblatex, 'biber-input': staleBcfBiblatex,
  'biber-sty': staleBcfBiblatex, 'biber-class': staleBcfBiblatex, 'blx-bibtex': staleBcfTwo,
  bibtex: staleBcfBibtex, 'bibtex-hyperref': staleBcfBibtex,
  'bibtex-commented': staleBcfBibtex, thebibliography: staleBcfBibtex,
  'biber-include': staleBcfBiblatex, 'bibtex-include': staleBcfBibtex,
  natbib: [/As <span class='cite'><a href='#Xable'>Able<\/a><\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>1999<\/a><\/span>\] says\./, staleBcfEntry],
  nobib: [/No citation here\./],
  'natbib-hyperref': [/As <a href='#Xable'>Able<\/a><span class='tex8web-nbsp'> <\/span>\[<a href='#Xable'>1999<\/a>\] says\./, staleBcfEntry],
  'natbib-abbrvnat': [/As <span class='cite'><a href='#Xable'>Able<\/a><\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>1999<\/a><\/span>\] says, and \[<span class='cite'><a href='#Xbaker'>Baker<\/a><\/span>,<span class='tex8web-nbsp'> <\/span><span class='cite'><a href='#Xbaker'>2001<\/a><\/span>\]\./,
    /A\.<span class='tex8web-nbsp'> <\/span>Able\. <span class='cmti-10'>A Book Kept in the Build Folder<\/span>\. A Publisher, 1999\./,
    /B\.<span class='tex8web-nbsp'> <\/span>Baker\. <span class='cmti-10'>A Second Book<\/span>\. A Publisher, 2001\./],
  'natbib-include': [/See <span class='cite'><a href='#Xable'>Able<\/a><\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>1999<\/a><\/span>\]\./, staleBcfEntry],
  // (natbib with the style in a file read by \include, or in the document
  // and \bibliography in that file)
  'natbib-inclstyle': [/As <span class='cite'><a href='#Xable'>Able<\/a><\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>1999<\/a><\/span>\] says\./, staleBcfEntry],
  'natbib-inclbib': [/As <span class='cite'><a href='#Xable'>Able<\/a><\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>1999<\/a><\/span>\] says\./, staleBcfEntry],
  // (the style alone in a file read by \include, and \bibliography in
  // another such file or in the document)
  'natbib-styleonly': [/As <span class='cite'><a href='#Xable'>Able<\/a><\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>1999<\/a><\/span>\] says\./, staleBcfEntry],
  'natbib-styleonly-doc': [/As <span class='cite'><a href='#Xable'>Able<\/a><\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>1999<\/a><\/span>\] says\./, staleBcfEntry],
  elsarticle: [/As <span class='cite'><a href='#Xable'>Able<\/a><\/span><span class='tex8web-nbsp'> <\/span>\(<span class='cite'><a href='#Xable'>1999<\/a><\/span>\) says\./,
    /Able, A\., 1999\. A Book Kept in the Build Folder\. A Publisher\./],
  // (natbib with a numeric style: \citet forces numbers, as in the PDF)
  'natbib-plain': [/As <span class='cmbx-10'>\(author\?\)<\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>1<\/a><\/span>\] says\./, staleBcfEntry],
  'natbib-ieeetr': [/As <span class='cmbx-10'>\(author\?\)<\/span><span class='tex8web-nbsp'> <\/span>\(<span class='cite'><a href='#Xable'>1<\/a><\/span>\) says\./],
  // (natbib with [numbers] and ./numeric.bst, a numeric style beside the document)
  'natbib-dotstyle': [/As <span class='cmbx-10'>\(author\?\)<\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>1<\/a><\/span>\] says\./, staleBcfEntry],
  // (natbib with [numbers] and a .bib that is missing: with -B ., the .bbl
  // that the first build left beside the document is read, as for the PDF)
  'natbib-missing': [/As <span class='cmbx-10'>\(author\?\)<\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>1<\/a><\/span>\] says\./, staleBcfEntry],
  // (the same with the missing .bib named in a file read by \include)
  'natbib-inclmissing': [/As <span class='cmbx-10'>\(author\?\)<\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>1<\/a><\/span>\] says\./, staleBcfEntry],
};
// (natbib with a numeric style that natbib does not know: from the third
// LaTeX run, the PDF build stops at natbib's error, and so does the page's)
const staleBcfErrors = new Set(['natbib-ieeetr']);
const staleBcfBiber = new Set(['biber', 'biber-hyperref', 'biber-input', 'biber-sty', 'biber-class', 'biber-include']);
// (the LaTeX runs of a second build of an unchanged document)
const staleBcfRuns = 2;
const staleBcfCases = [
  // [first document, second document, build folder]
  ['biber', 'bibtex'], ['biber-hyperref', 'bibtex-hyperref'], ['biber', 'bibtex', '.'],
  ['biber-include', 'bibtex-include'], ['biber', 'bibtex-commented'], ['biber', 'natbib'],
  ['biber', 'thebibliography'], ['biber', 'nobib'], ['biber-input', 'bibtex'], ['biber-class', 'bibtex'],
  ['biber', 'blx-bibtex'], ['blx-bibtex', 'bibtex'], ['blx-bibtex', 'biber'], ['bibtex', 'biber'],
  ['natbib', 'biber'], ['bibtex', 'biber-sty'], ['bibtex', 'blx-bibtex'],
  // (a .bbl without author-year data, then natbib with an author-year style)
  ['bibtex', 'natbib'], ['bibtex-hyperref', 'natbib-hyperref'], ['bibtex-alpha', 'natbib'],
  ['bibtex', 'natbib-abbrvnat', '.'], ['natbib-numbers', 'natbib'], ['natbib-plain', 'natbib'],
  ['bibtex-include', 'natbib-include'], ['bibtex', 'elsarticle'],
  // (the bibliography in a file read by \include, which LaTeX writes to
  // that file's .aux, with the style there or in the document)
  ['bibtex-inclstyle', 'natbib-inclstyle'], ['bibtex-inclbib', 'natbib-inclbib'],
  ['bibtex-inclstyle', 'natbib-inclstyle', '.'], ['bibtex-styleonly', 'natbib-styleonly'],
  ['bibtex-styleonly-doc', 'natbib-styleonly-doc'],
  ['bibtex', 'natbib-missing', '.'], ['bibtex-inclstyle', 'natbib-inclmissing', '.'],
  // (a .bbl whose items have author-year data only in part)
  ['natbib-mixed', 'natbib'],
  // (a draft build of the second document between the two builds)
  ['bibtex', 'natbib', 'build/tex4ht', 'draft'], ['bibtex-inclstyle', 'natbib-inclstyle', 'build/tex4ht', 'draft'],
  // (a build folder left current)
  ['biber', 'biber'], ['bibtex', 'bibtex'], ['blx-bibtex', 'blx-bibtex'],
  ['natbib', 'natbib'], ['natbib-plain', 'natbib-plain'], ['natbib-ieeetr', 'natbib-ieeetr'],
  ['natbib-dotstyle', 'natbib-dotstyle'],
  ['natbib-inclstyle', 'natbib-inclstyle'],
];
if (staleBcf) for (const [first, second, folder = 'build/tex4ht', draft] of staleBcfCases) jobs.push(async () => {
  const label = `${first}, then ${second}${folder === 'build/tex4ht' ? '' : `, with -B ${folder}`}${draft ? ', with a draft build between' : ''}`;
  const where = folder === '.' ? 'dot' : 'default';
  const dir = join(testDir(staleBcf), 'twice', `${first}-${second}-${where}${draft ? '-draft' : ''}`);
  const source = join(staleBcf.dir, 'test-stalebcf');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(source)) writeFileSync(join(dir, name), readFileSync(join(source, name)));
  const once = (name, ...options) => {
    writeFileSync(join(dir, 'doc.tex'), readFileSync(join(source, `${name}.tex`)));
    return run(join(root, 'bin/tex8web'), ['-c', staleBcf.cfg, '-B', folder, ...options, '-a', 'info', 'doc.tex'],
      { cwd: dir, slot: true, env: { ...process.env, ...staleBcf.env } });
  };
  const problems = [];
  const before = await once(first);
  if (before.code !== 0 && !staleBcfErrors.has(first)) problems.push(`the first build exited with ${before.code}`);
  if (draft) {
    const middle = await once(second, '-m', 'draft');
    if (middle.code !== 0) problems.push(`the draft build exited with ${middle.code}`);
  }
  const result = await once(second);
  const log = result.log ?? '';
  writeFileSync(join(dir, 'second.log'), log);
  const failing = staleBcfErrors.has(second);
  if (failing && (result.code === 0 || !log.includes('Package natbib Error'))) problems.push("the second build does not stop at natbib's error, as the PDF build does");
  if (result.code !== 0 && !failing) {
    problems.push(`make4ht exited with ${result.code}`, ...log.split('\n').filter(line => /\[(ERROR|FATAL)\]/.test(line)).slice(0, 4));
  }
  for (const error of ["Missing 'biblatex' package", 'not created by biblatex', 'Undefined control sequence',
    'Package biblatex Error', 'Package natbib Error', 'Missing \\begin{document}']) {
    if (log.includes(error) && !(failing && error === 'Package natbib Error')) problems.push(`the second build's log has ${JSON.stringify(error)}`);
  }
  if (!staleBcfBiber.has(second) && /bibliography: biber/.test(log)) problems.push('biber ran for a document without biblatex and biber');
  if (first === second) {
    const runs = log.match(/LaTeX call/g)?.length ?? 0;
    if (runs > staleBcfRuns) problems.push(`${runs} LaTeX runs in the second build, not ${staleBcfRuns}`);
    if (/runs again without/.test(log)) problems.push('the first LaTeX run was made again');
  }
  const page = join(dir, 'build/html/doc.html');
  const flat = existsSync(page) ? readFileSync(page, 'utf8').replace(/[^\S\u202F]+/g, ' ') : '';
  if (!flat) problems.push('no page');
  else for (const pattern of staleBcfPages[second]) if (!pattern.test(flat)) problems.push(`the page does not match ${pattern}`);
  report(`${staleBcf.name} (${label})`, problems);
});

// The documents of test/fixtures/test-stalebcf/ with the bibliography in
// a file read by \include, built twice into one build folder, with the
// year of an entry changed in the .bib between the builds. LaTeX writes
// the \bibcite lines to that file's .aux, so the build runs LaTeX again
// until that .aux settles: the citation and the entry show the new year.
if (staleBcf) for (const name of ['natbib-inclstyle', 'natbib-inclbib']) jobs.push(async () => {
  const dir = join(testDir(staleBcf), 'edited', name);
  const source = join(staleBcf.dir, 'test-stalebcf');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(source)) writeFileSync(join(dir, file), readFileSync(join(source, file)));
  writeFileSync(join(dir, 'doc.tex'), readFileSync(join(source, `${name}.tex`)));
  const once = () => run(join(root, 'bin/tex8web'), ['-c', staleBcf.cfg, '-a', 'info', 'doc.tex'],
    { cwd: dir, slot: true, env: { ...process.env, ...staleBcf.env } });
  const problems = [];
  const before = await once();
  if (before.code !== 0) problems.push(`the first build exited with ${before.code}`);
  const bib = readFileSync(join(source, 'refs.bib'), 'utf8');
  if (!bib.includes('year = {1999}')) problems.push('refs.bib has no year 1999 to change');
  writeFileSync(join(dir, 'refs.bib'), bib.replace('year = {1999}', 'year = {2005}'));
  const result = await once();
  writeFileSync(join(dir, 'second.log'), result.log ?? '');
  if (result.code !== 0) problems.push(`the second build exited with ${result.code}`);
  const page = join(dir, 'build/html/doc.html');
  const flat = existsSync(page) ? readFileSync(page, 'utf8').replace(/[^\S\u202F]+/g, ' ') : '';
  if (!flat) problems.push('no page');
  for (const pattern of [/As <span class='cite'><a href='#Xable'>Able<\/a><\/span><span class='tex8web-nbsp'> <\/span>\[<span class='cite'><a href='#Xable'>2005<\/a><\/span>\] says\./,
    /Ann Able\. <span class='cmti-10'>A Book Kept in the Build Folder<\/span>\. A Publisher, 2005\./]) {
    if (flat && !pattern.test(flat)) problems.push(`the page does not match ${pattern}`);
  }
  report(`${staleBcf.name} (${name}, with the .bib changed between two builds)`, problems);
});

// Draft builds of the test-staleaux-toc fixtures beside their stale lists,
// and of the documents of test/fixtures/test-staletoc-draft/ beside theirs
// (a document missing there is test-staletoc-draft.tex), each compared
// with the page built without the lists.
const staleTocDraft = docs.find(d => d.name === 'test-staletoc-draft');
const staleTocDraftOwn = { hyperref: ['hyperref.exp', 'hyperref.toc'], koma: ['koma.lox'] };
const staleTocDraftCases = [...['toc', 'toc-koma', 'toc-memoir', 'toc-color', 'toc-amsart', 'toc-report'].map(n => `test-staleaux-${n}`),
  ...Object.keys(staleTocDraftOwn)];
// The fixtures of staleListCases too, each compared with the page built
// without its stale lists, the lists of staleListFiles. The page also has
// each fixture's text from the other files, in staleListDraft.
const staleListDraft = {
  'test-staleaux-ptc-own': contents['test-staleaux-ptc-own'].filter(pattern => /^Text/.test(pattern.source)),
  // (the draft build's reference and index entry are not links: the
  // .aux and .ind of the PDF build have no anchors of tex4ht's)
  'test-staleaux-ptc-draft': [/See section<span class='tex8web-nbsp'> <\/span>1\./, /<span class='cite'>\[<a href='#Xable'>1<\/a>\]<\/span>/,
    /A Book Read from the Current File/, /Apple, 1 /, /the seed-bearing part of a plant/],
  // (the back reference from the current .brf, in the one LaTeX run)
  'test-staleaux-ptc-backref': [/Back References\. pages<span class='tex8web-nbsp'> <\/span>1/],
};
const staleDraftCases = [...(staleTocDraft ? staleTocDraftCases.map(name => ({ doc: staleTocDraft, name })) : []),
  ...docs.filter(d => staleListCases.includes(d.name)).map(d => ({ doc: d, name: d.name }))];
for (const { doc, name } of staleDraftCases) jobs.push(async () => {
  const own = name in staleTocDraftOwn;
  const source = own ? join(doc.dir, 'test-staletoc-draft') : doc.dir;
  const lists = own ? staleTocDraftOwn[name] : doc === staleTocDraft ? untouched[name] : staleListFiles[name].lists.map(suffix => name + suffix);
  // (with a folder of the document's name, which holds an \include'd file)
  const files = readdirSync(source).filter(f => f.startsWith(`${name}.`) || f === name);
  const problems = [];
  const build = async variant => {
    const dir = join(testDir(doc), doc === staleTocDraft ? name : 'draft', variant);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const f of files) if (variant === 'beside' || !lists.includes(f)) cpSync(join(source, f), join(dir, f), { recursive: true });
    if (!existsSync(join(dir, `${name}.tex`))) writeFileSync(join(dir, `${name}.tex`), readFileSync(join(staleTocDraft.dir, 'test-staletoc-draft.tex')));
    const state = () => readdirSync(dir, { recursive: true }).filter(f => f !== 'build' && !f.startsWith(`build/`)
      && statSync(join(dir, f)).isFile()).sort()
      .map(f => `${f} ${statSync(join(dir, f)).ctimeMs} ${readFileSync(join(dir, f), 'utf8')}`).join('\n');
    const before = state();
    const result = await run(join(root, 'bin/tex8web'), ['-c', join(root, 'tex8web.cfg'), '-m', 'draft', '-a', 'info', `${name}.tex`],
      { cwd: dir, slot: true, env: { ...process.env, ...doc.env } });
    if (state() !== before) problems.push(`a file beside the document ${variant === 'beside' ? 'with its lists' : 'without its lists'} was changed or added`);
    const log = result.log ?? '';
    writeFileSync(join(dir, 'build.log'), log);
    const what = variant === 'beside' ? 'beside its lists' : 'without its lists';
    if (result.code !== 0) problems.push(`the build ${what} exited with ${result.code}`, ...log.split('\n').filter(line => /\[(ERROR|FATAL)\]/.test(line)).slice(0, 4));
    for (const error of ['Undefined control sequence', 'File ended while scanning', 'Package etoolbox Error', "No counter 'refsection'",
      'No multilingual package']) if (log.includes(error)) problems.push(`the log of the build ${what} has ${JSON.stringify(error)}`);
    const page = join(dir, 'build/html', `${name}.html`);
    if (!existsSync(page)) problems.push(`no page from the build ${what}`);
    return { dir, html: existsSync(page) ? readFileSync(page, 'utf8') : '' };
  };
  const [beside, alone] = await Promise.all([build('beside'), build('alone')]);
  if (!/Text of the first (?:section|chapter)\./.test(beside.html)) problems.push("the page does not have the first section's text");
  if (/Old (?:other |third )?(?:example|remark|box|algorithm|section|subsection|figure|table|listing|program|theorem|note|words|coffee)|Alte[rn]? /.test(beside.html)) problems.push('the page has an old entry');
  for (const pattern of staleListDraft[name] ?? []) if (!pattern.test(beside.html)) problems.push(`the page does not match ${pattern}`);
  if (name === 'hyperref' && !/See Example<span class='tex8web-nbsp'> <\/span>(?:<a [^>]*>)?1(?:<\/a>)?\./.test(beside.html)) {
    problems.push("the reference does not show the number from the .aux beside the document");
  }
  if (beside.html && alone.html && beside.html !== alone.html) {
    const a = beside.html.split('\n'), b = alone.html.split('\n');
    const line = a.findIndex((l, i) => l !== b[i]);
    problems.push(`the page differs from the page without the lists at line ${line + 1}: ${JSON.stringify(a[line]?.slice(0, 160))}`);
  }
  report(doc === staleTocDraft ? `${doc.name} (${name}, draft)` : `${name} (draft)`, problems);
});
// test-staletoc-draft built in full, then in draft mode, in the same folder
// beside the stale list of test-staleaux-toc-koma, whose three-argument
// lines stop a LaTeX run that reads them. The draft build reads the list
// that the full build wrote in the build folder instead.
if (staleTocDraft) jobs.push(async () => {
  const dir = join(testDir(staleTocDraft), 'full-then-draft');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'doc.tex'), readFileSync(join(staleTocDraft.dir, 'test-staletoc-draft.tex')));
  writeFileSync(join(dir, 'doc.lox'), readFileSync(join(staleTocDraft.dir, 'test-staleaux-toc-koma.lox')));
  const problems = [], pages = [];
  for (const options of [[], ['-m', 'draft']]) {
    const what = options.length ? 'draft build' : 'full build';
    const result = await run(join(root, 'bin/tex8web'), ['-c', join(root, 'tex8web.cfg'), ...options, '-a', 'info', 'doc.tex'],
      { cwd: dir, slot: true, env: { ...process.env, ...staleTocDraft.env } });
    writeFileSync(join(dir, `${options.length ? 'draft' : 'full'}.log`), result.log ?? '');
    if (result.code !== 0) problems.push(`the ${what} exited with ${result.code}`);
    const page = join(dir, 'build/html/doc.html');
    const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
    if (!/List of Examples<\/h2>[^]*Text of the first chapter\./.test(html)) problems.push(`the page of the ${what} does not have the list and the chapter`);
    if (/Old example/.test(html)) problems.push(`the page of the ${what} has an old entry`);
    pages.push(html);
  }
  if (pages[0] !== pages[1]) {
    const a = pages[1].split('\n'), b = pages[0].split('\n');
    const line = a.findIndex((l, i) => l !== b[i]);
    problems.push(`the page of the draft build differs from the full build's at line ${line + 1}: ${JSON.stringify(a[line]?.slice(0, 160))}`);
  }
  if (readFileSync(join(dir, 'doc.lox'), 'utf8') !== readFileSync(join(staleTocDraft.dir, 'test-staleaux-toc-koma.lox'), 'utf8')) problems.push('doc.lox changed');
  report(`${staleTocDraft.name} (full, then draft)`, problems);
});

// test-pathspace built with its config, or tex8web itself, in a folder
// whose path has a character that tex4ht's option list, TeX, or make4ht's
// quoting reads. The characters are a space, as in a synced folder named
// My Drive, a comma, %, #, ', a brace, ~, \, ^, and a letter outside
// ASCII. Each build has a copy of the fixture in a folder of its own, so
// that the file its config inputs is found only beside the config.
// Each build makes a page with the config's terms (none with tex8web.cfg),
// the section and equation references, the prerendered formula with the
// document's macro, and the fonts and scripts it loads, and writes nothing
// beside the config. A build of the copy must use the copy's build file.
const pathspace = docs.find(d => d.name === 'test-pathspace');
if (pathspace) {
  // (the fixture's config, with \keyword's line in a file beside it)
  const config = readFileSync(pathspace.cfg, 'utf8').replace('\\WebTerm\\keyword', '\\input{pathspace-beside}');
  const place = (dir, name, text) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), text);
    return join(dir, name);
  };
  const fixture = readFileSync(join(pathspace.dir, pathspace.tex), 'utf8');
  const withConfig = (dir, name) => {
    place(dir, 'pathspace-beside.tex', '\\WebTerm\\keyword\n');
    return place(dir, name, config);
  };
  const install = top => {
    const copy = join(top, 'My Drive/tex8web');
    for (const name of ['bin', 'css', 'fonts', 'js', 'lua', 'tex', 'tex8web.cfg', 'tex8web.mk4', 'package.json', 'package-lock.json']) {
      cpSync(join(root, name), join(copy, name), { recursive: true });
    }
    symlinkSync(join(root, 'node_modules'), join(copy, 'node_modules'));
    return copy;
  };
  const tex8web = join(root, 'bin/tex8web');
  // a config by an absolute path, and the document in doc/
  const absolute = (top, folder) => {
    const cfg = withConfig(join(top, folder), 'test-pathspace.cfg');
    place(join(top, 'doc'), 'test-pathspace.tex', fixture);
    return { cwd: join(top, 'doc'), command: tex8web, args: ['-c', cfg, '-d', join(top, 'html'), 'test-pathspace.tex'],
      page: join(top, 'html/test-pathspace.html'), cfgDir: dirname(cfg) };
  };
  // (kpathsea splits a TEXINPUTS entry at a comma and expands braces, so a
  // config in such a folder inputs no file beside it)
  const alone = (top, folder) => {
    const build = absolute(top, folder);
    place(build.cfgDir, 'test-pathspace.cfg', readFileSync(pathspace.cfg, 'utf8'));
    return build;
  };
  // a config by a relative path, ../cfg/name, from doc/
  const named = name => top => {
    const cfg = withConfig(join(top, 'cfg'), name);
    place(join(top, 'doc'), 'test-pathspace.tex', fixture);
    return { cwd: join(top, 'doc'), command: tex8web, args: ['-c', `../cfg/${name}`, '-d', '../html', 'test-pathspace.tex'],
      page: join(top, 'html/test-pathspace.html'), cfgDir: dirname(cfg) };
  };
  // a copy of tex8web in folder, run without -c from doc/
  const installedIn = folder => top => {
    renameSync(dirname(install(top)), join(top, folder));
    const copy = join(top, folder, 'tex8web');
    place(join(top, 'doc'), 'test-pathspace.tex', fixture);
    return { cwd: join(top, 'doc'), command: join(copy, 'bin/tex8web'), args: ['-d', '../html', 'test-pathspace.tex'],
      page: join(top, 'html/test-pathspace.html'), cfgDir: copy, copy, noTerms: true };
  };
  // the document as name.tex, with the config in folder
  const namedDocument = (name, folder) => top => {
    const build = absolute(top, folder);
    place(build.cwd, `${name}.tex`, fixture);
    return { ...build, args: [...build.args.slice(0, -1), `${name}.tex`], page: join(top, `html/${name}.html`) };
  };
  const cases = [
    ['folder', 'a config folder with a space', top => {
      const build = absolute(top, 'My Drive/cfg');
      place(join(top, 'doc'), 'test-pathspace.tex', fixture.replace('\\end{document}', '\\input{pathspace-shared}\n\\end{document}'));
      place(join(top, 'doc'), 'pathspace-shared.tex', 'Shared text of the document.\n');
      place(build.cfgDir, 'pathspace-shared.tex', 'Shared text of the config.\n');
      return { ...build, shared: true };
    }],
    ['name', 'a config name with a space', top => {
      const cfg = withConfig(join(top, 'cfg'), 'my config.cfg');
      place(join(top, 'doc'), 'test-pathspace.tex', fixture);
      return { cwd: join(top, 'doc'), command: tex8web, args: ['-c', '../cfg/my config.cfg', '-d', '../html', 'test-pathspace.tex'],
        page: join(top, 'html/test-pathspace.html'), cfgDir: dirname(cfg) };
    }],
    ['plain', 'a config folder without a space', top => {
      const cfg = withConfig(join(top, 'cfg'), 'test-pathspace.cfg');
      place(join(top, 'doc'), 'test-pathspace.tex', fixture);
      return { cwd: join(top, 'doc'), command: tex8web, args: ['-c', '../cfg/test-pathspace.cfg', '-d', '../html', 'test-pathspace.tex'],
        page: join(top, 'html/test-pathspace.html'), cfgDir: dirname(cfg) };
    }],
    ['icloud', "iCloud Drive's folder", top => absolute(top, 'Mobile Documents/com~apple~CloudDocs/cfg')],
    ['dropbox', "Dropbox's folder", top => absolute(top, 'Dropbox (Personal)')],
    ['twospaces', 'a config folder with two spaces in a row', top => absolute(top, 'My  Drive/cfg')],
    ['together', 'the document and its config in a folder with a space', top => {
      const dir = join(top, 'My Drive/notes');
      withConfig(dir, 'test-pathspace.cfg');
      place(dir, 'test-pathspace.tex', fixture);
      return { cwd: top, command: tex8web,
        args: ['-c', 'My Drive/notes/test-pathspace.cfg', '-d', 'html', 'My Drive/notes/test-pathspace.tex'],
        page: join(top, 'html/test-pathspace.html') };
    }],
    ['installed', 'tex8web in a folder with a space', top => {
      const copy = install(top);
      place(join(top, 'doc'), 'test-pathspace.tex', fixture);
      return { cwd: join(top, 'doc'), command: join(copy, 'bin/tex8web'), args: ['-d', '../html', 'test-pathspace.tex'],
        page: join(top, 'html/test-pathspace.html'), cfgDir: copy, copy, noTerms: true };
    }],
    ['linked', 'tex8web in a folder with a space, through a link, with a config in one', top => {
      const copy = install(top);
      mkdirSync(join(top, 'bin'));
      symlinkSync(join(copy, 'bin/tex8web'), join(top, 'bin/tex8web'));
      return { ...absolute(top, 'My Drive/cfg'), command: join(top, 'bin/tex8web'), copy };
    }],
    ['guard', 'a document folder, document name, and -d folder with a space', top => {
      place(join(top, 'My Notes'), 'my notes.tex', fixture);
      return { cwd: top, command: tex8web, args: ['-c', pathspace.cfg, '-d', 'My Out/html', 'My Notes/my notes.tex'],
        page: join(top, 'My Out/html/my_notes.html') };
    }],
    // (from here on, a character other than a space in the config's path)
    ['commafolder', 'a config folder with a comma', top => alone(top, 'Notes,2025')],
    ['commaname', 'a config name with a comma', named('my,web.cfg')],
    ['commacwd', 'a config by a relative path from a working folder with a comma', top => {
      const cfg = place(join(top, 'Notes,2025/cfg'), 'test-pathspace.cfg', readFileSync(pathspace.cfg, 'utf8'));
      place(join(top, 'Notes,2025/doc'), 'test-pathspace.tex', fixture);
      return { cwd: join(top, 'Notes,2025/doc'), command: tex8web,
        args: ['-c', '../cfg/test-pathspace.cfg', '-d', join(top, 'html'), 'test-pathspace.tex'],
        page: join(top, 'html/test-pathspace.html'), cfgDir: dirname(cfg) };
    }],
    ['percentfolder', 'a config folder named 50%', top => absolute(top, '50%')],
    ['percentname', 'a config name with a percent sign', named('web%2.cfg')],
    ['hashfolder', 'a config folder with a #', top => absolute(top, 'Notes#2')],
    ['hashname', 'a config name with a #', named('web#2.cfg')],
    ['apostrophefolder', 'a config folder with an apostrophe and no space', top => absolute(top, "Justin's")],
    ['apostrophename', 'a config name with an apostrophe', named("Justin's.cfg")],
    ['bracefolder', 'a config folder with braces', top => alone(top, 'a{b}')],
    ['bracename', 'a config name with braces', named('web{2}.cfg')],
    ['tildefolder', 'a config folder with a tilde and no space', top => absolute(top, 'Notes~old')],
    ['backslashfolder', 'a config folder with a backslash', top => absolute(top, 'a\\b')],
    ['caretfolder', 'a config folder with a doubled caret', top => absolute(top, 'x^^y')],
    ['accentfolder', 'a config folder with a letter outside ASCII', top => absolute(top, 'Études')],
    ['cjkfolder', 'a config folder with CJK characters', top => absolute(top, 'ノート')],
    ['installedapostrophe', 'tex8web in a folder with an apostrophe and no space', installedIn("Justin's")],
    ['installedpercent', 'tex8web in a folder named 50%', installedIn('50%')],
    ['doccomma', 'a document name with a comma, with a config that is copied', namedDocument('hw,1', 'My Drive/cfg')],
    ['docaccent', 'a document name outside ASCII, with a config that is copied', namedDocument('Étude', 'Études')],
    ['commaspace', 'a config folder with a comma and a space (guard)', top => alone(top, 'My Notes, 2025')],
    ['apostrophespace', 'a config folder with an apostrophe and a space (guard)', top => absolute(top, "Justin's Drive")],
    ['specials', 'config folders with &, _, and $, read from a copy (guard)', top => absolute(top, 'R&D/my_notes/a$b')],
    ['doccommaplain', 'a document name with a comma, with a plain config (guard)', namedDocument('hw,1', 'cfg')],
    // (the copy goes in build/ beside the document, whatever -B is, so a
    // -B with a character outside the safe list builds as it does with a
    // plain config)
    ['auxat', 'a config folder with @, and -B with @', top => {
      const build = absolute(top, 'notes@work');
      return { ...build, args: ['-B', 'aux@web', ...build.args], aux: join(build.cwd, 'aux@web') };
    }],
  ];
  for (const [key, label, setup] of cases) jobs.push(async () => {
    const top = join(testDir(pathspace), `space${key}`);
    rmSync(top, { recursive: true, force: true });
    const { cwd, command, args, page, cfgDir, copy, noTerms, shared, aux } = setup(top);
    const before = cfgDir && readdirSync(cfgDir).sort().join(', ');
    const result = await run(command, [...args.slice(0, -1), '-a', 'info', args.at(-1)],
      { cwd, slot: true, env: { ...process.env, ...pathspace.env } });
    writeFileSync(join(top, 'make4ht.log'), result.log);
    const problems = [];
    if (result.code !== 0) {
      problems.push(`tex8web exited with ${result.code}`, ...result.log.split('\n').filter(line => /\[(ERROR|FATAL)\]|^! |^tex8web: /.test(line)).slice(0, 4));
    }
    if (copy && !result.log.includes(`Using build file\t${join(copy, 'tex8web.mk4')}`)) problems.push("the copy's build file is not used");
    const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
    const flat = html.replace(/[^\S ]+/g, ' ');
    if (!html) problems.push('no page');
    else {
      const wanted = [
        /<h3 class='sectionHead' id='spaces'>/,
        /See section<span class='tex8web-nbsp'> <\/span><a href='#spaces'>1<!--/,
        /<a class='tex8web-eq-anchor' id='([^']+)'><\/a>[^]* and \(<a href='#\1'>1<!--/,
        /<mjx-container[^>]*>(?:(?!<\/mjx-container>)[^])*<mjx-c class='mjx-c2016'>‖<\/mjx-c><mjx-c class='mjx-c1D465'>𝑥<\/mjx-c><mjx-c class='mjx-c2016'>‖<\/mjx-c>/,
        ...noTerms ? [/^(?![^]*tex8web-term)/]
          : [/A <span class='tex8web-term' id='term-config-word'>[^]* and a <span class='tex8web-term' id='term-sibling-word'>/],
        ...shared ? [/Shared text of the document\./, /^(?![^]*Shared text of the config)/] : [],
      ];
      for (const pattern of wanted) if (!pattern.test(flat)) problems.push(`the page does not match ${pattern}`);
      for (const href of fontsListed(html).filter(href => !existsSync(join(dirname(page), href)))) problems.push(`${href} preloaded, not written`);
      if (!fontsListed(html).length) problems.push('no fonts preloaded');
      const scripts = [...html.matchAll(/<script [^>]*src='([^':]+)'/g)].map(([, src]) => src);
      if (!scripts.length) problems.push('no script of tex8web');
      for (const src of scripts.filter(src => !existsSync(join(dirname(page), src)))) problems.push(`${src} loaded, not written`);
    }
    const after = cfgDir && readdirSync(cfgDir).sort().join(', ');
    // (a config that is copied is read from build/ beside the document)
    const given = /tex4ht\.sty: ([^,]*\/tex8web-[^,/]*\.cfg),/.exec(result.log)?.[1];
    if (given && !/^build\/tex8web-[A-Za-z0-9._-]*-\d+\.cfg$/.test(given)) problems.push(`make4ht was given the copy ${given}, not one in build/`);
    if (aux) {
      if (!given) problems.push('make4ht was not given a copy of the config');
      if (!existsSync(join(aux, 'test-pathspace.aux'))) problems.push(`tex4ht's files are not in ${aux}`);
    }
    if (after !== before) problems.push(`the config's folder holds ${after}, not ${before}`);
    // (a plain config is read where it is, and make4ht puts its path first
    // in tex4ht's options. The path is absolute, so a checkout in a folder
    // with a character outside bin/tex8web's safe list has it copied.)
    if (key === 'plain') {
      if (/[^A-Za-z0-9/._+-]/.test(cwd)) {
        if (!/tex4ht\.sty: .*\/tex8web-test-pathspace-\d+\.cfg,/.test(result.log)) problems.push('make4ht was not given the copy of the config');
      } else if (!result.log.includes(`tex4ht.sty: ${cwd}/../cfg/test-pathspace.cfg,`)) problems.push('make4ht was not given the config as ../cfg/test-pathspace.cfg');
    }
    report(`${pathspace.name} (${label})`, problems);
  });
  // two documents in one folder with a space, each with a config of its
  // own there, built at once: each page has its own config's term only
  jobs.push(async () => {
    const top = join(testDir(pathspace), 'spacepair'), dir = join(top, 'My Drive/notes');
    rmSync(top, { recursive: true, force: true });
    const pair = [['a', '\\WebTerm\\keyword', 'term-config-word', 'term-sibling-word'],
      ['b', '\\WebTerm\\term', 'term-sibling-word', 'term-config-word']];
    for (const [name, left] of pair) {
      place(dir, `${name}.cfg`, readFileSync(pathspace.cfg, 'utf8').replace(`${left}\n`, ''));
      place(dir, `${name}.tex`, fixture);
    }
    const results = await Promise.all(pair.map(([name]) => run(tex8web, ['-c', `${name}.cfg`, '-d', join(top, 'html'), '-a', 'info', `${name}.tex`],
      { cwd: dir, slot: true, env: { ...process.env, ...pathspace.env } })));
    const problems = [];
    pair.forEach(([name, , term, other], i) => {
      writeFileSync(join(top, `${name}.log`), results[i].log);
      if (results[i].code !== 0) problems.push(`${name}.tex: tex8web exited with ${results[i].code}`);
      const page = join(top, `html/${name}.html`), html = existsSync(page) ? readFileSync(page, 'utf8') : '';
      if (!html.includes(`id='${term}'`) || html.includes(`id='${other}'`)) problems.push(`${name}.html does not have ${term} alone as a term`);
    });
    report(`${pathspace.name} (two documents in a folder with a space, each with its config)`, problems);
  });
  // two documents in one folder with a comma, named hw,1 and hw+1, which
  // differ only in a character that the copy's name replaces, each with a
  // config of its own there, built at once: each page has its own config's
  // term only
  jobs.push(async () => {
    const top = join(testDir(pathspace), 'spacecommapair'), dir = join(top, 'Notes,2025');
    rmSync(top, { recursive: true, force: true });
    const pair = [['hw,1', '\\WebTerm\\keyword', 'term-config-word', 'term-sibling-word'],
      ['hw+1', '\\WebTerm\\term', 'term-sibling-word', 'term-config-word']];
    pair.forEach(([name, left], i) => {
      place(dir, `web${i}.cfg`, readFileSync(pathspace.cfg, 'utf8').replace(`${left}\n`, ''));
      place(dir, `${name}.tex`, fixture);
    });
    const results = await Promise.all(pair.map(([name], i) => run(tex8web, ['-c', `web${i}.cfg`, '-d', join(top, 'html'), '-a', 'info', `${name}.tex`],
      { cwd: dir, slot: true, env: { ...process.env, ...pathspace.env } })));
    const problems = [];
    pair.forEach(([name, , term, other], i) => {
      writeFileSync(join(top, `${i}.log`), results[i].log);
      if (results[i].code !== 0) problems.push(`${name}.tex: tex8web exited with ${results[i].code}`);
      const page = join(top, `html/${name}.html`), html = existsSync(page) ? readFileSync(page, 'utf8') : '';
      if (!html.includes(`id='${term}'`) || html.includes(`id='${other}'`)) problems.push(`${name}.html does not have ${term} alone as a term`);
    });
    // (each build holds a slot, cp included, so with one slot free the
    // second build starts after the first ends, and each page reads its
    // own config even if both share one copy: so each log must name a
    // copy of its own config, apart from the other's, and both copies
    // must stay in build/)
    const copies = results.map(({ log }) => /tex4ht\.sty: ([^,]*\/tex8web-hw_1-\d+\.cfg),/.exec(log)?.[1]);
    pair.forEach(([name], i) => {
      if (!copies[i]) problems.push(`make4ht was not given a copy named tex8web-hw_1-<checksum>.cfg for ${name}.tex`);
      else if (!existsSync(join(dir, copies[i])) || readFileSync(join(dir, copies[i]), 'utf8') !== readFileSync(join(dir, `web${i}.cfg`), 'utf8')) problems.push(`${copies[i]} does not hold web${i}.cfg`);
    });
    if (copies[0] && copies[0] === copies[1]) problems.push(`both documents were given the copy ${copies[0]}`);
    const build = join(dir, 'build'), held = existsSync(build) ? readdirSync(build).filter(file => /^tex8web-hw_1-\d+\.cfg$/.test(file)) : [];
    if (held.length !== 2) problems.push(`build/ holds ${held.length} copies named tex8web-hw_1-<checksum>.cfg, not 2`);
    report(`${pathspace.name} (two documents in a folder with a comma, named apart by a comma and a +)`, problems);
  });
  // one document in a folder with a space, built at once with two configs
  // there and two -B folders: each build is given a copy of its own, and
  // each page has its own config's term only
  jobs.push(async () => {
    const top = join(testDir(pathspace), 'spaceauxpair'), dir = join(top, 'My Drive');
    rmSync(top, { recursive: true, force: true });
    const pair = [['a', '\\WebTerm\\keyword', 'term-config-word', 'term-sibling-word'],
      ['b', '\\WebTerm\\term', 'term-sibling-word', 'term-config-word']];
    for (const [name, left] of pair) place(dir, `${name}.cfg`, readFileSync(pathspace.cfg, 'utf8').replace(`${left}\n`, ''));
    place(dir, 'doc.tex', fixture);
    const results = await Promise.all(pair.map(([name]) => run(tex8web, ['-c', `${name}.cfg`, '-B', `build/${name}`, '-d', join(top, `html/${name}`), '-a', 'info', 'doc.tex'],
      { cwd: dir, slot: true, env: { ...process.env, ...pathspace.env } })));
    const problems = [];
    pair.forEach(([name, , term, other], i) => {
      writeFileSync(join(top, `${name}.log`), results[i].log);
      if (results[i].code !== 0) problems.push(`-B build/${name}: tex8web exited with ${results[i].code}`);
      const page = join(top, `html/${name}/doc.html`), html = existsSync(page) ? readFileSync(page, 'utf8') : '';
      if (!html.includes(`id='${term}'`) || html.includes(`id='${other}'`)) problems.push(`html/${name}/doc.html does not have ${term} alone as a term`);
    });
    const copies = results.map(({ log }) => /tex4ht\.sty: ([^,]*\/tex8web-doc-\d+\.cfg),/.exec(log)?.[1]);
    pair.forEach(([name], i) => {
      if (!copies[i]) problems.push(`make4ht was not given a copy named tex8web-doc-<checksum>.cfg with -B build/${name}`);
      else if (!existsSync(join(dir, copies[i])) || readFileSync(join(dir, copies[i]), 'utf8') !== readFileSync(join(dir, `${name}.cfg`), 'utf8')) problems.push(`${copies[i]} does not hold ${name}.cfg`);
    });
    if (copies[0] && copies[0] === copies[1]) problems.push(`both builds were given the copy ${copies[0]}`);
    report(`${pathspace.name} (one document in a folder with a space, two configs and two -B folders)`, problems);
  });
}

// test-builddirspace built into a build folder (-B) whose path has a
// space, each case from a copy of the fixture in a folder of its own:
// - relative: build/my aux, with no -d
// - slash: build/my aux/, with a -d folder with a space
// - parent: my build/aux, a space in the folder above
// - root: my aux beside the document, outside build/, from a document
//   folder with a space, with a config in a folder with a space (which
//   tex8web copies) that inputs a file beside it, built three times into
//   the same folder
// - absolute: the build folder by an absolute path
// - twospaces: build/my  aux, two spaces in a row
// - paren: build/aux (1), a space and parentheses
// - saved: a build that saves LaTeX's run (TEX8WEB_LATEX_SAVE), then one
//   that reuses it (TEX8WEB_LATEX_REUSE)
// - at once: three documents in one folder built at once into one build
//   folder, each without the included part, which they would share
// - guard: build/plainaux, a build folder without a space, with a -d
//   folder with a space
// - failed guard: a document that stops LaTeX
// (the space sends the absolute and paren cases through tex8web's link,
// so they check the space; a -B with parentheses or an absolute path and
// no space still has the Known limitation of DOCUMENTATION.md)
// Each build makes the page, with the SVG it shows. The build folder keeps
// the document's .aux, .log, .dvi, and .bbl, and the included part's .aux
// (each document's, for the three at once), and holds no folder of its own
// name. No symbolic link is left in the case's folder, also after the
// failed build. With the build folder outside build/ and a -d outside the
// document's folder (parent, root), no build/ is left beside the document,
// except one that holds only copies of the config.
const builddirspace = docs.find(d => d.name === 'test-builddirspace');
if (builddirspace) {
  const doc = builddirspace, name = 'test-builddirspace';
  const fixture = readFileSync(join(doc.dir, doc.tex), 'utf8');
  const place = (dir, file, text) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  // a copy of the fixture as <tex>.tex in dir, with its .bib and part
  const copy = (dir, tex = name, text = fixture) => {
    place(dir, `${tex}.tex`, text);
    place(dir, `${name}.bib`, readFileSync(join(doc.dir, `${name}.bib`)));
    place(dir, `${name}/part.tex`, readFileSync(join(doc.dir, name, 'part.tex')));
  };
  const links = dir => readdirSync(dir, { recursive: true }).filter(path => lstatSync(join(dir, path)).isSymbolicLink());
  // (a config whose path has a character outside the safe list, as the
  // checkout's has in a folder with a space, is read from a copy in build/,
  // which stays)
  const copied = file => /^tex8web-[A-Za-z0-9._-]*-\d+\.cfg$/.test(file);
  // build/ beside the document, if it holds anything but config copies
  const leftBuild = dir => {
    const held = existsSync(join(dir, 'build')) ? readdirSync(join(dir, 'build')) : null;
    return held && !(held.length && held.every(copied)) ? `a build/ folder is left beside the document, holding ${held.join(', ') || 'nothing'}` : null;
  };
  const nested = aux => existsSync(aux)
    ? readdirSync(aux, { recursive: true }).filter(path => basename(path) === basename(aux) && statSync(join(aux, path)).isDirectory()) : [];
  const cases = [
    ['relative', 'build/my aux', top => {
      copy(join(top, 'doc'));
      return { cwd: join(top, 'doc'), builds: [['-B', 'build/my aux']], page: join(top, 'doc/build/html', `${name}.html`) };
    }],
    ['slash', 'build/my aux/, with -d build/my out', top => {
      copy(join(top, 'doc'));
      return { cwd: join(top, 'doc'), builds: [['-B', 'build/my aux/', '-d', 'build/my out']], aux: 'build/my aux',
        page: join(top, 'doc/build/my out', `${name}.html`) };
    }],
    ['parent', 'my build/aux', top => {
      copy(join(top, 'doc'));
      return { cwd: join(top, 'doc'), builds: [['-B', 'my build/aux', '-d', '../html']], page: join(top, 'html', `${name}.html`), noBuild: true };
    }],
    ['root', 'my aux beside the document, with a config in a folder with a space, three times', top => {
      const cfgDir = join(top, 'My Drive/cfg');
      place(cfgDir, 'my config.cfg', readFileSync(doc.cfg, 'utf8').replace('\\WebTerm\\term', '\\input{builddirspace-beside}'));
      place(cfgDir, 'builddirspace-beside.tex', '\\WebTerm\\term\n');
      copy(join(top, 'My Notes'));
      const build = ['-c', '../My Drive/cfg/my config.cfg', '-B', 'my aux', '-d', '../html'];
      return { cwd: join(top, 'My Notes'), builds: [build, build, build], page: join(top, 'html', `${name}.html`), cfgDir, noBuild: true };
    }],
    ['absolute', 'an absolute path', top => {
      // (with a space, so through the link; see the comment above)
      copy(join(top, 'doc'));
      return { cwd: join(top, 'doc'), builds: [['-B', join(top, 'doc/build/my aux'), '-d', join(top, 'html')]],
        page: join(top, 'html', `${name}.html`) };
    }],
    ['saved', 'saved, then reused', top => {
      copy(join(top, 'doc'));
      mkdirSync(join(top, 'saved'));
      const build = ['-B', 'build/my aux', '-d', '../html'];
      return { cwd: join(top, 'doc'), builds: [build, build], page: join(top, 'html', `${name}.html`),
        env: [{ TEX8WEB_LATEX_SAVE: join(top, 'saved') }, { TEX8WEB_LATEX_REUSE: join(top, 'saved') }],
        between: () => { rmSync(join(top, 'doc/build'), { recursive: true, force: true }); rmSync(join(top, 'html'), { recursive: true, force: true }); },
        saved: join(top, 'saved') };
    }],
    ['twospaces', 'build/my  aux, two spaces', top => {
      copy(join(top, 'doc'));
      return { cwd: join(top, 'doc'), builds: [['-B', 'build/my  aux']], page: join(top, 'doc/build/html', `${name}.html`) };
    }],
    ['paren', 'build/aux (1)', top => {
      // (with a space, so through the link; see the comment above)
      copy(join(top, 'doc'));
      return { cwd: join(top, 'doc'), builds: [['-B', 'build/aux (1)']], page: join(top, 'doc/build/html', `${name}.html`) };
    }],
  ];
  // (a -c in args comes after the fixture's config, and so replaces it)
  const run8 = (cwd, args, tex, env = {}, slot = true) => run(join(root, 'bin/tex8web'), ['-c', doc.cfg, ...args, '-a', 'info', tex],
    { cwd, slot, env: { ...process.env, ...doc.env, ...env } });
  // the problems of a build folder after a document's build
  const kept = (aux, tex, included = true) => [`${tex}.aux`, `${tex}.log`, `${tex}.dvi`, `${tex}.bbl`, ...included ? [`${name}/part.aux`] : []]
    .filter(file => !existsSync(join(aux, file))).map(file => `the build folder has no ${file}`);
  const pageProblems = (page, tex, included) => {
    const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
    if (!html) return ['no page'];
    const flat = html.replace(/\s+/g, ' ');
    return [...builddirspacePage(tex, included).filter(pattern => !pattern.test(flat)).map(pattern => `the page does not match ${pattern}`),
      ...existsSync(join(dirname(page), `${tex}0x.svg`)) ? [] : [`${tex}0x.svg not written`]];
  };
  for (const [key, label, setup] of cases) jobs.push(async () => {
    const top = join(testDir(doc), `space${key}`);
    rmSync(top, { recursive: true, force: true });
    const { cwd, builds, page, cfgDir, env = [], between, saved, noBuild, ...rest } = setup(top);
    const aux = resolve(cwd, rest.aux ?? builds[0][builds[0].indexOf('-B') + 1]);
    const before = cfgDir && readdirSync(cfgDir).sort().join(', ');
    const problems = [];
    for (const [i, args] of builds.entries()) {
      if (i && between) between();
      const result = await run8(cwd, args, `${name}.tex`, env[i]);
      writeFileSync(join(top, `build${i + 1}.log`), result.log);
      if (result.code !== 0) {
        problems.push(`build ${i + 1}: tex8web exited with ${result.code}`,
          ...result.log.split('\n').filter(line => /\[(ERROR|FATAL)\]|^! |^tex8web: |cannot open/.test(line)).slice(0, 3));
      }
      if (saved && !i && !existsSync(join(saved, `${name}.dvi`))) problems.push("LaTeX's run is not saved");
      if (saved && i && (!/tex8web-latex-begin\ntex8web-latex-end/.test(result.log) || result.log.includes('LaTeX call:'))) {
        problems.push('build 2 ran LaTeX instead of reusing the saved run');
      }
    }
    problems.push(...pageProblems(page, name, true), ...kept(aux, name));
    for (const path of nested(aux)) problems.push(`the build folder holds ${path}`);
    for (const path of links(top)) problems.push(`a link is left: ${path}`);
    if (noBuild && leftBuild(cwd)) problems.push(leftBuild(cwd));
    const copies = existsSync(join(cwd, 'build')) ? readdirSync(join(cwd, 'build')).filter(copied) : [];
    if (cfgDir && copies.length !== 1) problems.push(`build/ holds ${copies.length} copies of the config, not one`);
    const after = cfgDir && readdirSync(cfgDir).sort().join(', ');
    if (after !== before) problems.push(`the config's folder holds ${after}, not ${before}`);
    report(`${doc.name} (-B ${label})`, problems);
  });
  // three documents built at once into one build folder with a space
  jobs.push(async () => {
    const top = join(testDir(doc), 'spaceatonce'), dir = join(top, 'doc'), aux = join(dir, 'build/my aux');
    rmSync(top, { recursive: true, force: true });
    const names = ['first', 'second', 'third'];
    const text = fixture.replace(/^\\include\{[^}]*\}\n/m, '');
    for (const tex of names) copy(dir, tex, text);
    // (without a build slot, so that the three builds run at the same time)
    const results = await Promise.all(names.map(tex => run8(dir, ['-B', 'build/my aux'], `${tex}.tex`, {}, false)));
    const problems = [];
    names.forEach((tex, i) => {
      writeFileSync(join(top, `${tex}.log`), results[i].log);
      if (results[i].code !== 0) problems.push(`${tex}.tex: tex8web exited with ${results[i].code}`);
      problems.push(...pageProblems(join(dir, 'build/html', `${tex}.html`), tex, false).map(p => `${tex}.tex: ${p}`),
        ...kept(aux, tex, false));
    });
    for (const path of links(top)) problems.push(`a link is left: ${path}`);
    report(`${doc.name} (three documents built at once into build/my aux)`, problems);
  });
  // guards: a build folder without a space and a -d folder with one, which
  // already work, and a failed build, which leaves no link
  jobs.push(async () => {
    const top = join(testDir(doc), 'spaceguard'), dir = join(top, 'doc');
    rmSync(top, { recursive: true, force: true });
    copy(dir);
    const result = await run8(dir, ['-B', 'build/plainaux', '-d', 'build/my out'], `${name}.tex`);
    writeFileSync(join(top, 'build.log'), result.log);
    const problems = result.code !== 0 ? [`tex8web exited with ${result.code}`] : [];
    problems.push(...pageProblems(join(dir, 'build/my out', `${name}.html`), name, true), ...kept(join(dir, 'build/plainaux'), name));
    const made = readdirSync(join(dir, 'build')).filter(file => !copied(file)).sort().join(', ');
    if (made !== 'my out, plainaux') problems.push(`build/ holds ${made}, not my out, plainaux`);
    for (const path of links(top)) problems.push(`a link is left: ${path}`);
    report(`${doc.name} (guard: -B build/plainaux, -d build/my out)`, problems);
  });
  jobs.push(async () => {
    const top = join(testDir(doc), 'spacefailed'), dir = join(top, 'doc');
    rmSync(top, { recursive: true, force: true });
    copy(dir, name, fixture.replace('\\end{document}', '\\begin{tabular}{l}\n\\end{document}'));
    const result = await run8(dir, ['-B', 'build/my aux'], `${name}.tex`);
    writeFileSync(join(top, 'build.log'), result.log);
    const problems = result.code === 0 ? ['tex8web exited with 0 for a document that stops LaTeX'] : [];
    // (stopped by the tabular, not by a log that LaTeX cannot open)
    const texLog = join(dir, 'build/my aux', `${name}.log`);
    if (!existsSync(texLog) || !readFileSync(texLog, 'utf8').includes('\\begin{tabular} on input line')) problems.push("LaTeX's log does not name the unclosed tabular");
    if (result.log.includes('cannot open log file')) problems.push('LaTeX could not open its log file');
    for (const path of links(top)) problems.push(`a link is left: ${path}`);
    report(`${doc.name} (guard: a failed build into build/my aux)`, problems);
  });
  // links in build/ that other builds left: one of another host, as a
  // build in a container that shares build/ makes, which a build here
  // keeps, as that host's process IDs are not this host's; one of a host
  // whose name is this host's, an underscore, and more, which the build
  // keeps too; and one of this host whose process is gone, which the
  // build removes
  jobs.push(async () => {
    const top = join(testDir(doc), 'spaceotherhost'), dir = join(top, 'doc');
    rmSync(top, { recursive: true, force: true });
    copy(dir);
    mkdirSync(join(dir, 'build/their aux'), { recursive: true });
    const host = hostname().replace(/[^A-Za-z0-9]/g, '_');
    const theirs = 'tex8web_aux_otherhost_1', longer = `tex8web_aux_${host}_2_99999999`, dead = `tex8web_aux_${host}_99999999`;
    for (const file of [theirs, longer, dead]) symlinkSync(join(dir, 'build/their aux'), join(dir, 'build', file));
    const result = await run8(dir, ['-B', 'build/my aux'], `${name}.tex`);
    writeFileSync(join(top, 'build.log'), result.log);
    const problems = result.code !== 0 ? [`tex8web exited with ${result.code}`] : [];
    problems.push(...pageProblems(join(dir, 'build/html', `${name}.html`), name, true), ...kept(join(dir, 'build/my aux'), name));
    const left = links(top).sort().join(', '), want = [theirs, longer].map(file => `doc/build/${file}`).sort().join(', ');
    if (left !== want) problems.push(`the links left are ${left || 'none'}, not ${want}`);
    report(`${doc.name} (-B build/my aux, beside links of another host and of a process that is gone)`, problems);
  });
  // more documents built into build/my aux: biblatex with biber, an index
  // and a glossary, XCharter (whose font files tex8web writes in the build
  // folder and adds to tex4ht's search path by their full path), and a
  // document whose name has a space, in a folder with a space. Each page
  // has the term and the text each adds, and the build folder the files
  // each needs
  const visible = page => existsSync(page) ? readFileSync(page, 'utf8').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ') : '';
  const preamble = (text, lines) => text.replace('\\usepackage{hyperref}\n', `\\usepackage{hyperref}\n${lines}\n`);
  const more = [
    ['biber', 'biblatex with biber', () => ({
      text: preamble(fixture, '\\usepackage[backend=biber]{biblatex}\\addbibresource{test-builddirspace.bib}')
        .replace('\\bibliographystyle{plain}\n\\bibliography{test-builddirspace}', '\\printbibliography'),
      shows: ['A Book Built in a Folder with a Space'], hides: ['spacebook'], files: [`${name}.bcf`, `${name}.bbl`],
    })],
    ['index', 'an index and a glossary', () => ({
      text: preamble(fixture, '\\usepackage{makeidx}\\makeindex\\usepackage{glossaries}\\makeglossaries\n' +
        '\\newglossaryentry{w}{name=wordy,description=a glossary description}')
        .replace('citation~\\cite{spacebook}.', 'citation~\\cite{spacebook}, an indexed\\index{spaceindex} word, and \\gls{w}.')
        .replace('\\end{document}', '\\printindex\n\\printglossaries\n\\end{document}'),
      shows: ['spaceindex', 'a glossary description'], hides: [], files: [`${name}.ind`, `${name}.gls`],
    })],
    ['xcharter', 'XCharter', () => ({
      text: fixture.replace('\\documentclass{article}\n', '\\documentclass{article}\n\\usepackage[T1]{fontenc}\\usepackage{XCharter}\n')
        .replace('A \\term{space word}', 'A first office \\term{space word}'),
      shows: ['A first office space word'], hides: [], files: ['tex8web-htf/ht-fonts/alias/tex8web-xcharter.htf'],
    })],
    ['docname', 'a document named my notes.tex in My Notes', () => ({
      text: fixture, folder: 'My Notes', tex: 'my notes', page: 'my_notes.html',
      shows: ['A Book Built in a Folder with a Space', 'Text of the included part'], hides: [], files: [`${name}/part.aux`],
    })],
  ];
  for (const [key, label, setup] of more) jobs.push(async () => {
    const top = join(testDir(doc), `space${key}`);
    rmSync(top, { recursive: true, force: true });
    const { text, folder = 'doc', tex = name, page = `${name}.html`, shows, hides, files } = setup();
    const dir = join(top, folder), aux = join(dir, 'build/my aux');
    copy(dir, tex, text);
    const result = await run8(dir, ['-B', 'build/my aux'], `${tex}.tex`);
    writeFileSync(join(top, 'build.log'), result.log);
    const problems = result.code !== 0 ? [`tex8web exited with ${result.code}`,
      ...result.log.split('\n').filter(line => /\[(ERROR|FATAL)\]|^! |^tex8web: |cannot open/.test(line)).slice(0, 3)] : [];
    const seen = visible(join(dir, 'build/html', page));
    if (!seen) problems.push('no page');
    for (const words of ['space word', ...shows]) if (seen && !seen.includes(words)) problems.push(`the page does not show ${words}`);
    for (const words of hides) if (seen.includes(words)) problems.push(`the page shows ${words}`);
    for (const file of files) if (!existsSync(join(aux, file))) problems.push(`the build folder has no ${file}`);
    for (const path of nested(aux)) problems.push(`the build folder holds ${path}`);
    for (const path of links(top)) problems.push(`a link is left: ${path}`);
    report(`${doc.name} (-B build/my aux, ${label})`, problems);
  });
  // a build into build/my aux that hangs, stopped once LaTeX has started:
  // - term: SIGTERM to its process group, as a terminal or timeout sends it
  // - termpid: SIGTERM to tex8web alone, as an editor's stop button or
  //   Node's child.kill() sends it; tex8web ends within 20 s
  // - int: SIGINT to its process group, as Ctrl-C sends it; LaTeX ends
  //   too, within 20 s
  // - kill: SIGKILL to its process group, as the tests' watchdog sends it
  // Then the document, fixed, is built again. While the build hangs, its
  // link is in build/, not in the document's folder. No link is left after
  // the build ends, except after the SIGKILL, and none after the build that
  // follows
  // (these builds hold no build slot, so they are not in build.mjs's
  // running commands: their process groups are killed when the tests end)
  const hung = new Set();
  process.on('exit', () => hung.forEach(pid => { try { process.kill(-pid, 'SIGKILL'); } catch {} }));
  const within = (promise, ms) => Promise.race([promise, new Promise(done => setTimeout(() => done('late'), ms).unref())]);
  const pause = ms => new Promise(done => setTimeout(done, ms));
  // whether a process of the group runs, not counting zombies, which a
  // container without an init does not reap
  const groupRuns = pgid => spawnSync('ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' }).stdout.split('\n')
    .some(line => { const [group, stat = ''] = line.trim().split(/\s+/); return Number(group) === pgid && !stat.startsWith('Z'); });
  const stops = [
    ['term', 'SIGTERM to its process group', 'SIGTERM', true],
    ['termpid', 'SIGTERM to tex8web alone', 'SIGTERM', false],
    ['int', 'SIGINT to its process group', 'SIGINT', true],
    ['kill', 'SIGKILL to its process group', 'SIGKILL', true],
  ];
  for (const [key, label, signal, group] of stops) jobs.push(async () => {
    const top = join(testDir(doc), `spacehang${key}`), dir = join(top, 'doc');
    rmSync(top, { recursive: true, force: true });
    copy(dir, name, fixture.replace('\\begin{document}\n', '\\begin{document}\n\\def\\x{\\x}\\x\n'));
    const problems = [];
    const child = spawn(join(root, 'bin/tex8web'), ['-c', doc.cfg, '-B', 'build/my aux', `${name}.tex`],
      { cwd: dir, detached: true, stdio: 'ignore', env: { ...process.env, ...doc.env } });
    hung.add(child.pid);
    const ended = new Promise(done => child.on('exit', done));
    const texLog = join(dir, 'build/my aux', `${name}.log`);
    for (let waited = 0; !existsSync(texLog) && waited < 120000; waited += 100) await pause(100);
    if (!existsSync(texLog)) problems.push('LaTeX did not start in 120 s');
    // (and has reached \x's loop: a SIGINT that comes earlier stops LaTeX
    // whether or not tex8web passes it on)
    await pause(3000);
    for (const file of readdirSync(dir)) if (lstatSync(join(dir, file)).isSymbolicLink()) problems.push(`a link is made beside the document: ${file}`);
    try { process.kill(group ? -child.pid : child.pid, signal); } catch {}
    if (await within(ended, 20000) === 'late') problems.push(`tex8web runs 20 s after the ${signal}`);
    if (signal === 'SIGINT') {
      for (let waited = 0; groupRuns(child.pid) && waited < 20000; waited += 200) await pause(200);
      if (groupRuns(child.pid)) problems.push('LaTeX runs 20 s after the SIGINT');
    }
    if (signal !== 'SIGKILL') for (const path of links(top)) problems.push(`a link is left after the ${signal}: ${path}`);
    // (LaTeX, which a SIGTERM to tex8web alone leaves running, as it does
    // for a build folder without a space)
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    await within(ended, 20000);
    for (let waited = 0; groupRuns(child.pid) && waited < 20000; waited += 200) await pause(200);
    hung.delete(child.pid);
    copy(dir);
    const result = await run8(dir, ['-B', 'build/my aux'], `${name}.tex`);
    writeFileSync(join(top, 'build.log'), result.log);
    if (result.code !== 0) problems.push(`the build after the ${signal}: tex8web exited with ${result.code}`);
    problems.push(...pageProblems(join(dir, 'build/html', `${name}.html`), name, true), ...kept(join(dir, 'build/my aux'), name));
    for (const path of links(top)) problems.push(`a link is left: ${path}`);
    report(`${doc.name} (a hung build into build/my aux, stopped by ${label}, then built again)`, problems);
  });
  // two builds that overlap, into my aux beside the document, outside
  // build/, with -d ../html: the first, of first.tex, makes build/ for its
  // link; the second, of second.tex, which hangs, starts while that link
  // is in build/ and is stopped by a SIGTERM after the first has ended.
  // The first's page is made, and no build/ or link is left beside the
  // documents
  jobs.push(async () => {
    const top = join(testDir(doc), 'spaceoverlap'), dir = join(top, 'doc');
    rmSync(top, { recursive: true, force: true });
    copy(dir, 'first');
    copy(dir, 'second', fixture.replace('\\begin{document}\n', '\\begin{document}\n\\def\\x{\\x}\\x\n'));
    const args = ['-B', 'my aux', '-d', '../html'];
    const problems = [];
    // (without a build slot, so that the 120 s below count from the
    // build's start, not from the end of a wait for a slot)
    const first = run8(dir, args, 'first.tex', {}, false);
    const inBuild = () => existsSync(join(dir, 'build')) && readdirSync(join(dir, 'build')).some(file => file.startsWith('tex8web_aux_'));
    for (let waited = 0; !inBuild() && waited < 120000; waited += 100) await pause(100);
    if (!inBuild()) problems.push("the first build's link is not in build/ after 120 s");
    const child = spawn(join(root, 'bin/tex8web'), ['-c', doc.cfg, ...args, 'second.tex'],
      { cwd: dir, detached: true, stdio: 'ignore', env: { ...process.env, ...doc.env } });
    hung.add(child.pid);
    const ended = new Promise(done => child.on('exit', done));
    const result = await first;
    writeFileSync(join(top, 'first.log'), result.log);
    if (result.code !== 0) problems.push(`first.tex: tex8web exited with ${result.code}`);
    if (await within(ended, 0) !== 'late') problems.push('the second build ended before the first');
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    if (await within(ended, 20000) === 'late') problems.push('tex8web runs 20 s after the SIGTERM');
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    for (let waited = 0; groupRuns(child.pid) && waited < 20000; waited += 200) await pause(200);
    hung.delete(child.pid);
    problems.push(...pageProblems(join(top, 'html', 'first.html'), 'first', true), ...kept(join(dir, 'my aux'), 'first'));
    if (leftBuild(dir)) problems.push(leftBuild(dir));
    for (const path of links(top)) problems.push(`a link is left: ${path}`);
    report(`${doc.name} (two overlapping builds into my aux beside the documents, with -d ../html)`, problems);
  });
}

await pool(jobs, workers, job => job());

if (tools) {
  const { report, code } = await tools;
  process.stdout.write(report);
  failures += code === 0 ? 0 : 1;
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
