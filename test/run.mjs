// npm test: the Lua unit tests, then every document in test/fixtures/ and
// examples/ built with make4ht and checked, while the tests of the test tools
// run beside them. Pages go to build/test/<document>/html.
//   node test/run.mjs [document names...]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, expected, largestFirst, pool, root, select, strayKeys, testDir, workers } from './lib/build.mjs';
import { checkLog, checkOutput, checkTexLog } from './lib/check.mjs';

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
};
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
const typeset = {
  'test-mhchem': [/<\/a>The <mjx-container/, /forms acid: <mjx-container/],
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
};

// What screen readers hear: ClearSpeak's words, | as "given", no "normal"
// before an upright letter, Δ as "Delta", and A^\top as "A transpose"; a
// numbered equation without its number, then its label; an alignment of
// several lines as one formula
const speech = {
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
    /, 1\.5\u202Fm, /,
    /aria-label='v equals 3 times m s to the negative 1 power'/,
    /aria-label='9\.81 times the fraction with numerator m and denominator s squared'/,
    /aria-label='E equals 1\.6 times 10 to the negative 19 power J Label 1'/],
};

// Pictures sized by \includegraphics's width, scale, or height: a share of
// the PDF's text width, which keeps their size relative to the text on a
// narrower screen
const share = (alt, fraction) => new RegExp(`<img alt='${alt}' [^>]*style='width:calc\\(var\\(--tex8web-textwidth\\) \\* ${fraction.replace('.', '\\.')}\\)'`);
const drawn = (n, width, more = '') => new RegExp(`<img alt='' src='test-tikzbox${n}x\\.svg' style='width:calc\\(var\\(--tex8web-textwidth\\) \\* ${width.replace('.', '\\.')}\\)${more.replace(/[().*]/g, '\\$&')}' />`);
const lower = share => `; vertical-align:calc(var(--tex8web-textwidth) * -${share})`;
const pictures = {
  // (in a 345pt text width, for a picture 64bp by 48bp: 100pt wide, 1.5
  // times its size, 96pt high so 128pt wide, and 100pt by 40pt without
  // keepaspectratio (never squashed) and with it; one without a size as
  // tex4ht writes it)
  'test-graphics': [share('width', '0.2899'), share('scale', '0.2793'), share('height', '0.371'),
    share('both', '0.2899'), share('fitted', '0.1546'), share('angle last', '0.2899'), /<img alt='bare' (?:(?!style=)[^>])*\/>/,
    // (a size after angle, and scale with a size: left to tex4ht)
    ...['rotated', 'scaled first', 'scaled last'].map(alt => new RegExp(`<img alt='${alt}' (?:(?!style=)[^>])*\\/>`))],
  // (the graphics package: a picture without a size or a .xbb, left to tex4ht)
  'test-graphics-only': [/<img (?:(?!style=)[^>])*\/>/],
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
    drawn(7, '0.0754', lower('0.0102')), /test-tikzbox7x\.svg'[^>]*\/> and/, drawn(8, '0.0506', lower('0.0191')), drawn(9, '0.0506'),
    drawn(10, '0.0742', lower('0.0097')), drawn(11, '0.0640', lower('0.0102')), drawn(12, '0.0518', lower('0.0134')),
    drawn(16, '0.1661', `${lower('0.0836')}; transform:scale(1, -1)`), drawn(13, '0.1662'), drawn(14, '0.1647'),
    share('halved', '0.1449'), /Text: Big/, /^(?![^]*tex8web-scale)/],
};

// The title of a page without \maketitle, for the tab and link previews:
// \title's text as \maketitle sets it, without the \thanks.
const titles = {
  'test-title': [/<title>Notes on Groups\s+and Rings<\/title>/,
    /<meta content='Notes on Groups\s+and Rings' property='og:title' \/>/],
  'test-nomaketitle': [/<title>Without a maketitle<\/title>/],
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
};

// The table of contents beside the text, under the document title (a link
// to the top), titled by its heading or by \contentsname in the document's
// language, with chapter numbers in their boxes. A list of figures before
// it stays in the text.
const titled = name => [new RegExp(`<button aria-label='${name}' class='tex8web-control tex8web-contents'[^>]* title='${name}'`),
  new RegExp(`<p class='tex8web-toc-title' id='tex8web-toc-title'>${name}</p>`)];
const contents = {
  // (also test.cfg's \WebUp: the first control, with a # and an & in its URL)
  'test': [/<div class='tex8web-controls'><a aria-label='Up' class='tex8web-control tex8web-up' href='https:\/\/example\.com\/notes\/\?a=1&amp;b=2#top'/],
  'test-russian': titled('Содержание'),
  'test-greek': titled('Περιεχόμενα'),
  'test-report': [
    /<nav [^>]*id='tex8web-toc'[^>]*><a class='tex8web-toc-doctitle' href='#'>[^<]+<\/a><p [^>]*>Contents<\/p><input [^>]*><div class='tableofcontents'>(?:(?!<\/nav>)[^])*<span class='chapterToc'><span class='tocnumber'>1<\/span>/,
    /<\/nav>(?:(?!<\/nav>)[^])*<div class='tableofcontents'>\s*<span class='lofToc'>/,
  ],
  // (an entry that \addcontentsline adds beside an unnumbered heading links
  // to that heading, under the id named from its title)
  'test-tocstar': ['Before', 'After', 'Blank', 'Overview'].map(title =>
    new RegExp(`<a href='#${title.toLowerCase()}'>${title}</a>[^]*<h[34] class='like\\w*Head' id='${title.toLowerCase()}'>`)),
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
const colors = {
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

// \, and \thinspace in text as a narrow no-break space, where TeX does not
// break: also in italic, in a quantity siunitx sets as text, and kept with
// the math after it. In a picture, the kern, so a node is as wide as in the
// PDF.
const thin = {
  'test-units': [/like 1\.5\u202Fm\. Thin\s+spaces in text: i\.\u202Fe\., <span class='cmti-10'>e\.<\/span>\u202F<span class='cmti-10'>g\.<\/span>, 10\u202F000, 10\u202F000, and p\.<span class='tex8web-nowrap'>\u202F<mjx-container /],
  'test-article': [/<img alt='' src='test-article1x\.svg' style='width:calc\(var\(--tex8web-textwidth\) \* 0\.0966\)' \/>/],
};

// ~ and \, in text next to inline math: the space and the math in one
// span, and after the math, the text up to the next whitespace too
const math = "<mjx-container(?:(?!</mjx-container>)[^])*</mjx-container>";
const tie = "<span class='tex8web-nbsp'>.</span>";
const ties = {
  'test-nowrap': [new RegExp(`value of<span class='tex8web-nowrap'>${tie}${math}</span>, keeps`),
    new RegExp(`p\\.<span class='tex8web-nowrap'>\u202F${math}</span>\\. A`),
    new RegExp(`as in <span class='tex8web-nowrap'>${math}${tie}and,</span> <span class='tex8web-nowrap'>${math}\u202Fcm,</span> and\\s+<span class='tex8web-nowrap'>${math}${tie}${math}\\.</span>`),
    new RegExp(`the set of<span class='tex8web-nowrap'>${tie}${math}${tie}elements</span> is <span class='tex8web-nowrap'>${math}${tie}times</span> the`),
    new RegExp(`and <span class='tex8web-nowrap'>${math}\u202Fm<sup class='textsuperscript'><span class='cmr-9'>2</span></sup></span> is`)],
};

// A \tikz picture as wide as what it draws: a circle at the origin, on which
// tex4ht's SVG (from dvisvgm, scaled 1.4) is centered. On the page it is as
// wide as in the PDF, 1cm of a 345pt text width
const tikz = { 'test-article': ['test-article0x.svg', 0.0825] };

// Terms (\WebTerm), with ids for the table of contents filter; in a heading,
// only the term's text in the heading's id and table of contents entry
const terms = {
  'test': [/<span class='tex8web-term' id='term-inner-product'>/, /<span class='tex8web-term' id='term-ball'>/],
  'test-term': [/<h3 class='sectionHead' id='the-group-law'>/, /<a href='#the-group-law' id='[^']*'>The <span class='cmbx-10'>group\s*<\/span>\s*law<\/a>/,
    /<h3 class='sectionHead' id='the-ring-law'>/, /<a href='#the-ring-law' id='[^']*'>The <span class='cmbx-10'>ring\s*<\/span>\s*law<\/a>/],
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
  // equation*: a \ref to its \label leads to the section, and the three
  // relations of the page's math, one in the split's second column, are
  // spaced
  'test-equationstar': [
    /See <a href='#s'>1</,
    /^(?:(?!mjx-c class='mjx-c3D' space)[^])*(?:mjx-c class='mjx-c3D' space='4'(?:(?!mjx-c class='mjx-c3D' space)[^])*){3}$/,
  ],
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
};

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

// Spaces in verbatim, alltt, and \verbatiminput keep the font's width. Only
// the ~ in the text is narrowed.
const verbatim = {
  'test-verbatim': [/^(?:(?!tex8web-nbsp)[^])*Plain<span class='tex8web-nbsp'>(?:(?!tex8web-nbsp)[^])*$/,
    /<div class='alltt'>/, /<div class='verbatiminput'>/, /<pre class='verbatim'/],
};

// the fonts listed in data-fonts on the inline script
const fontsListed = html => (html.match(/<script [^>]*data-fonts=["']([^"']*)["']/)?.[1] ?? '').split(/\s+/).filter(Boolean);

// The fonts preloaded, and no others: the text's faces (bold headings,
// italic, \texttt, but not \verb, which is in the browser's monospace) and
// the MathJax fonts that the math uses
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
    new RegExp(`Large text with </span>${sized('1.09589')}`),
    new RegExp(`A note with </span>${sized('0.82191')}`),
    new RegExp(`Small text with </span>${sized('0.91324')}`),
    new RegExp(`A small theorem with </span>${sized('0.91324')}`),
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
];

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
  return [...problems, ...checkTexLog(join(aux, doc.tex.replace(/\.tex$/, '.log'))), ...checkLog(result.log),
    ...checkOutput(out)];
}

if (!only.length) {
  const stray = strayKeys(measured, preloads, families, tikz, expected, ...patterns.map(([table]) => table));
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

await pool(jobs, workers, job => job());

if (tools) {
  const { report, code } = await tools;
  process.stdout.write(report);
  failures += code === 0 ? 0 : 1;
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
