// The generic checks of a built page, for the documents of npm test and for
// any other build (test/check.mjs).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';

// the files of a published page, by extension
const published = new Set(['.html', '.css', '.js', '.woff2', '.otf', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.pdf', '.txt']);

function files(dir) {
  return readdirSync(dir, { recursive: true }).map(f => join(dir, f)).filter(f => statSync(f).isFile());
}

// TeX's errors in its log (make4ht can exit 0 despite them), and
// tex8web's warnings that tex4ht or a package changed what it patches
export function checkTexLog(path) {
  if (!existsSync(path)) return ['TeX errors: no TeX log'];
  const lines = readFileSync(path, 'latin1').split('\n');
  const errors = lines.filter(l => l.startsWith('!'));
  const outdated = lines.filter(l => l.startsWith('Package tex8web Warning'));
  return [...(errors.length ? [`TeX errors: ${errors.slice(0, 3).join(' | ')}`] : []), ...outdated];
}

// make4ht's warnings and errors in its log
export function checkLog(log) {
  // (the warnings of MathJax in prerendering start with "MathJax:", and those
  // of tex8web.js, such as a macro MathJax cannot define, with "tex8web:")
  return log.split('\n').filter(l => /\[(WARNING|ERROR|FATAL)\]|^(MathJax|tex8web):/.test(l))
    .map(line => line.trim());
}

// the pages in out, and the files beside them
export function checkOutput(out) {
  if (!existsSync(out)) return ['no output directory'];
  const problems = [];
  const all = files(out);
  for (const f of all.filter(f => !published.has(extname(f)))) problems.push(`unexpected file ${relative(out, f)}`);
  for (const css of all.filter(f => f.endsWith('.css'))) {
    if (/border[\w-]*\s*:[^;{}]*\bblack\b/.test(readFileSync(css, 'utf8'))) {
      problems.push(`${relative(out, css)}: a black rule, which dark mode hides`);
    }
  }
  for (const page of all.filter(f => f.endsWith('.html'))) problems.push(...checkPage(page, relative(out, page)));
  return problems;
}

// the checks of each page: (html, page path) -> problems
const toc = html => html.match(/<nav[^>]*id=['"]tex8web-toc['"][^]*?<\/nav>/)?.[0] ?? '';
const count = (html, pattern) => (html.match(pattern) || []).length;
const pageChecks = [
  // (only tex8web's: the inline font script, tex8web-head.js, and
  // tex8web-page.js)
  function scripts(html) {
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map(m => m[1]);
    return scripts.some(s => !/src=['"]tex8web-(head|page)\.js['"]|id=['"]tex8web-fonts['"]/.test(s)) ? ["has a <script> besides tex8web's"] : [];
  },
  // (the inline script's text, unescaped and all in its CDATA section: the
  // serializer escapes <, >, and & in a script's text)
  function fontsScript(html) {
    const body = html.match(/<script [^>]*id=['"]tex8web-fonts['"][^>]*>([^]*?)<\/script>/)?.[1];
    return body !== undefined && /^\/\*<!\[CDATA\[\*\/[^]*\/\*\]\]>\*\/$/.test(body) && !/&(amp|lt|gt);/.test(body)
      ? [] : ['no inline script, whole in its CDATA section'];
  },
  // (a list of figures or tables is a div.tableofcontents too, and stays)
  function tocBeside(html) {
    return [...html.replace(toc(html), '').matchAll(/class=['"]tableofcontents['"]>([^]*?)<\/div>/g)]
      .some(([, list]) => /class=['"]\w*(?:part|chapter|section|paragraph)Toc['"]/.test(list))
      ? ['a table of contents in the text, not beside it'] : [];
  },
  // (MathJax's arithmetic gone wrong, which a browser ignores)
  function nanStyles(html) {
    const n = count(html, /style=['"][^'"]*NaN/g);
    return n ? [`${n} styles with NaN in them`] : [];
  },
  function tocFilter(html) {
    return toc(html) && !/<input[^>]*class=['"]tex8web-toc-filter['"]/.test(toc(html))
      ? ['a table of contents without its filter'] : [];
  },
  // (an entry's number in its box, which lines up the titles)
  function tocNumbers(html) {
    return [...toc(html).matchAll(/<span class=['"](chapter|appendix|(?:sub)*(?:section|paragraph))Toc['"]>(?!<span class=['"]tocnumber)/g)]
      .map(([, level]) => `a ${level} entry in the table of contents without its number box`);
  },
  // (an entry links to a heading, to an element in one, or to a run-in
  // heading such as \paragraph's span.paragraphHead, so that the heading is
  // in view and the entry is highlighted)
  function tocTargets(html) {
    const headings = [...html.matchAll(/<h[1-6][\s>][^]*?<\/h[1-6]>/g)].map(m => [m.index, m.index + m[0].length]);
    const problems = [];
    for (const [, id] of toc(html).matchAll(/<a href=['"]#([^'"]+)['"]/g)) {
      const target = html.match(new RegExp(`<(\\w+)[^>]* id=['"]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"][^>]*>`));
      if (target && !/ class=['"]\w*Head['"]/.test(target[0]) && !headings.some(([start, end]) => start <= target.index && target.index < end)) {
        problems.push(`the table of contents links #${id}, a <${target[1]}>, not a heading`);
      }
    }
    return problems;
  },
  // (a heading's mark holds its number from the table of contents, and may
  // add to it, as titlesec's \thesection. does)
  function headingNumbers(html) {
    const problems = [];
    for (const [, number, id] of toc(html).matchAll(/<span class=['"]tocnumber['"]>([^<]+)<\/span><a href=['"]#([^'"]+)['"]/g)) {
      const at = html.search(new RegExp(` id=['"]${id}['"]`));
      const mark = html.slice(at, at + 500).match(/<span class=['"]titlemark['"]>((?:<span[^>]*>[^<]*<\/span>|[^<])*)<\/span>/)?.[1].replace(/<[^>]+>/g, '');
      if (at >= 0 && !mark?.includes(number.trim())) problems.push(`heading #${id} numbered ${mark?.trim()}, not ${number}`);
    }
    return problems;
  },
  // (one space between a heading's number and its title, which
  // css/tex8web.css sizes)
  function labelSpace(html) {
    return [...html.matchAll(/class=['"]titlemark['"]>(?:<span[^>]*>)*([^<]*)(?:<\/span>)+(?:<span class=['"]tex8web-labelsep['"]> <\/span>)?(\s|\u00a0|<span class=['"]tex8web-nbsp)?/g)]
      .filter(([, number, extra]) => /[\s\u00a0]$/.test(number) || extra)
      .map(([, number]) => `more space after heading number ${number.trim()}`);
  },
  function mathErrors(html) {
    const merrors = count(html, /<mjx-merror/g);
    return merrors ? [`${merrors} MathJax error(s)`] : [];
  },
  // (MathJax draws an unknown macro as its name, in red, which tex8web.js
  // makes light-dark(red, ...))
  function unknownMacros(html) {
    const unknown = [...html.matchAll(/<mjx-mtext style=['"]color: (?:red|light-dark\(red,[^'"]*);['"]>(.*?)<\/mjx-mtext>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, ''));
    return unknown.length ? [`macros MathJax doesn't know: ${[...new Set(unknown)].join(', ')}`] : [];
  },
  // (in a formula's MathML, \hat and \tilde are not stretchy, and their
  // glyph is the unsized one. TeX's wide accents are the next three sizes.
  // The TeX Gyre math fonts, whose accent is the combining one, have more
  // sizes, any of which the minsize and maxsize of tex8web.js allow)
  function wideAccents(html) {
    for (const [formula] of html.matchAll(/<mjx-container[^]*?<\/mjx-container>/g)) {
      const wide = formula.match(/<mo(?![^>]*stretchy=['"]false)[^>]*>[\^~]<\/mo>/g) || [];
      const sized = formula.match(/mjx-c(?:(?:2C6|2DC) TEX-(?:SO|LO|S3)|(?:302|303) G[TPS]-(?:SO|LO|S\d))\b/g) || [];
      if (sized.length < wide.length) return ["a \\widehat or \\widetilde narrower or wider than TeX's"];
    }
    return [];
  },
  // (with TEX8WEB_MATHML, which the tests set)
  function mathML(html) {
    const math = count(html, /<mjx-container/g), mathml = count(html, /<mjx-assistive-mml/g);
    return mathml && math !== mathml ? [`${math} formulas, ${mathml} with MathML for screen readers`] : [];
  },
  // (prerendering's speech on each formula's container, or the formula
  // hidden if its only characters are in a \phantom. None of the semantic
  // enrichment the speech comes from, which would add elements)
  function speech(html) {
    const formulas = [...html.matchAll(/<mjx-container([^>]*)>(<mjx-math[^>]*>)?([^]*?)<\/mjx-container>/g)];
    const named = (container, math) => / role=['"]math['"]/.test(container)
      && / aria-label=['"][^'"]/.test(container) && / aria-hidden=['"]true['"]/.test(math ?? '');
    const silent = (container, inside) => / aria-hidden=['"]true['"]/.test(container)
      && !/<mjx-c\b/.test(inside.replace(/<mjx-mphantom[^]*?<\/mjx-mphantom>/g, ''));
    const unnamed = formulas.filter(([, container, math, inside]) => !named(container, math)
      && !silent(container, inside)).length;
    return [...(unnamed ? [`${unnamed} of ${formulas.length} formulas without speech for screen readers`] : []),
      ...(/ data-(semantic|speech)-/.test(html) ? ["MathJax's semantic enrichment in the page"] : [])];
  },
  function links(html, page) {
    const problems = [];
    const ids = new Set([...html.matchAll(/ (?:id|name)=['"]([^'"]+)['"]/g)].map(m => m[1]));
    // (except the up link, to the site around the page)
    const own = html.replace(/<a [^>]*class=['"]tex8web-control tex8web-up['"][^>]*>/, '');
    for (const [, ref] of own.matchAll(/ (?:href|src)=['"]([^'"]+)['"]/g)) {
      if (/^[a-z]+:/i.test(ref)) continue;
      const [path, anchor] = ref.split('#');
      if (path && !existsSync(join(dirname(page), decodeURI(path)))) problems.push(`missing ${path}`);
      if (!path && anchor && !ids.has(anchor)) problems.push(`no target for #${anchor}`);
    }
    return problems;
  },
  // (a link to a repeated id goes to the first)
  function uniqueIds(html) {
    const seen = new Set(), repeated = new Set();
    for (const [, id] of html.matchAll(/ id=['"]([^'"]+)['"]/g)) (seen.has(id) ? repeated : seen).add(id);
    return repeated.size ? [`repeated ids: ${[...repeated].slice(0, 5).join(', ')}`] : [];
  },
  function listLengths(html) {
    return /<dl(?![^>]*style=)[^>]*class=['"]tex8web-list/.test(html) ? ['a list without its lengths'] : [];
  },
  // (tex4ht's made-up alt text, which a screen reader would read)
  function altText(html) {
    const alts = count(html, /<img(?![^>]* alt=['"](?!PIC['"]|\[Picture\]['"]))[^>]*>/g);
    return alts ? [`${alts} image(s) without alt text or with tex4ht's`] : [];
  },
  // (a \thanks's mark in the title, and again before its note)
  function thanksMarks(html) {
    const [title, notes = ''] = html.split(/class=['"]thanks['"]/);
    const marks = text => count(text, /class=['"]thank-mark['"]/g);
    return marks(title) < marks(notes) ? ['a \\thanks without its mark'] : [];
  },
];

function checkPage(page, name) {
  const html = readFileSync(page, 'utf8');
  return pageChecks.flatMap(check => check(html, page)).map(problem => `${name}: ${problem}`);
}
