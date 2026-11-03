// What's wrong with a built page: for npm test's documents, and for any
// other build (test/check.mjs).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';

// the files of a published page, by extension
const published = new Set(['.html', '.css', '.js', '.woff2', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.pdf']);

function files(dir) {
  return readdirSync(dir, { recursive: true }).map(f => join(dir, f)).filter(f => statSync(f).isFile());
}

// TeX's errors in its log (make4ht can exit 0 despite them)
export function checkTexLog(path) {
  const errors = existsSync(path) ? readFileSync(path, 'latin1').split('\n').filter(l => l.startsWith('!')) : ['no TeX log'];
  return errors.length ? [`TeX errors: ${errors.slice(0, 3).join(' | ')}`] : [];
}

// make4ht's warnings and errors in its log
export function checkLog(log) {
  // (make4ht falls back to parsing the page as HTML when tex4ht's isn't
  // well-formed XML, as with boxes and minipages; the browser does the same)
  const benign = /XML DOM parsing of .* failed|luaxml-mod-xml\.lua:\d+: Unbalanced Tag|HTML DOM parsing OK/;
  return log.split('\n').filter(l => /\[(WARNING|ERROR|FATAL)\]/.test(l) && !benign.test(l))
    .map(line => line.trim());
}

// the pages in out, and the files with them
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

function checkPage(page, name) {
  const problems = [];
  const html = readFileSync(page, 'utf8');
  // (only tex8web-page.js, and the line before it that applies the
  // reader's theme)
  const scripts = [...html.matchAll(/<script([^>]*)>/g)].map(m => m[1]);
  if (scripts.some(s => /src=/.test(s) && !/src=['"]tex8web-page\.js['"]/.test(s))
      || scripts.filter(s => !/src=/.test(s)).length > 1) {
    problems.push(`${name}: has a <script> besides tex8web's`);
  }
  const toc = html.match(/<nav[^>]*id=['"]tex8web-toc['"][^]*?<\/nav>/)?.[0] ?? '';
  if (/class=['"]tableofcontents/.test(html.replace(toc, ''))) {
    problems.push(`${name}: a table of contents in the text, not beside it`);
  }
  // (an entry's number in its box, which lines up the titles)
  for (const [, level] of toc.matchAll(/<span class=['"]((?:sub)*(?:section|paragraph))Toc['"]>(?!<span class=['"]tocnumber)/g)) {
    problems.push(`${name}: a ${level} entry in the table of contents without its number box`);
  }
  // (a heading's label may add to its number, as titlesec's \thesection.
  // does, but holds it)
  for (const [, number, id] of toc.matchAll(/<span class=['"]tocnumber['"]>([^<]+)<\/span><a href=['"]#([^'"]+)['"]/g)) {
    const at = html.search(new RegExp(` id=['"]${id}['"]`));
    const mark = html.slice(at, at + 500).match(/<span class=['"]titlemark['"]>(.*?)<\/span>/)?.[1].replace(/<[^>]+>/g, '');
    if (at >= 0 && !mark?.includes(number.trim())) problems.push(`${name}: heading #${id} numbered ${mark?.trim()}, not ${number}`);
  }
  const merrors = (html.match(/<mjx-merror/g) || []).length;
  if (merrors) problems.push(`${name}: ${merrors} MathJax error(s)`);
  // (MathJax draws a macro it doesn't know as its name, in red)
  const unknown = [...html.matchAll(/<mjx-mtext style=['"]color: red;['"]>(.*?)<\/mjx-mtext>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, ''));
  if (unknown.length) problems.push(`${name}: macros MathJax doesn't know: ${[...new Set(unknown)].join(', ')}`);
  // (in a formula's MathML, \hat and \tilde aren't stretchy; their
  // glyph is the one without a size, and TeX's wide ones are the next
  // three)
  for (const [formula] of html.matchAll(/<mjx-container[^]*?<\/mjx-container>/g)) {
    const wide = formula.match(/<mo(?![^>]*stretchy=['"]false)[^>]*>[\^~]<\/mo>/g) || [];
    const sized = formula.match(/mjx-c(?:2C6|2DC) TEX-(?:SO|LO|S3)\b/g) || [];
    if (sized.length < wide.length) {
      problems.push(`${name}: a \\widehat or \\widetilde narrower or wider than TeX's`);
      break;
    }
  }
  const math = (html.match(/<mjx-container/g) || []).length;
  const mathml = (html.match(/<mjx-assistive-mml/g) || []).length;
  if (math !== mathml) problems.push(`${name}: ${math} formulas, ${mathml} with MathML for screen readers`);
  const ids = new Set([...html.matchAll(/ (?:id|name)=['"]([^'"]+)['"]/g)].map(m => m[1]));
  for (const [, ref] of html.matchAll(/ (?:href|src)=['"]([^'"]+)['"]/g)) {
    if (/^[a-z]+:/i.test(ref)) continue;
    const [path, anchor] = ref.split('#');
    if (path && !existsSync(join(dirname(page), decodeURI(path)))) problems.push(`${name}: missing ${path}`);
    if (!path && anchor && !ids.has(anchor)) problems.push(`${name}: no target for #${anchor}`);
  }
  if (/<dl(?![^>]*style=)[^>]*class=['"]enumerate-enumitem/.test(html)) {
    problems.push(`${name}: an enumitem list without its lengths`);
  }
  // (a \thanks's mark in the title, and again before its note)
  const [title, notes = ''] = html.split(/class=['"]thanks['"]/);
  const marks = text => (text.match(/class=['"]thank-mark['"]/g) || []).length;
  if (marks(title) < marks(notes)) problems.push(`${name}: a \\thanks without its mark`);
  return problems;
}
