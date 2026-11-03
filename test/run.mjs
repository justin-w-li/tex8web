// npm test: the Lua unit tests, then every test document and example built
// with make4ht and checked. Pages go to build/test/<document>/html.
//   node test/run.mjs [document names...]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { build, documents, pool, root } from './lib/build.mjs';

const expected = JSON.parse(readFileSync(join(root, 'test/expected.json'), 'utf8'));
const only = process.argv.slice(2);
let failures = 0;

// problems test/expected.json lists for a document (allow: substrings of
// them, why: the reason) are reported but don't fail it
function report(name, problems) {
  const { allow = [], why } = expected[name] || {};
  const known = problems.filter(p => allow.some(a => p.includes(a)));
  const failed = problems.filter(p => !known.includes(p));
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

// the files of a published page, by extension
const published = new Set(['.html', '.css', '.woff2', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.pdf']);

function files(dir) {
  return readdirSync(dir, { recursive: true }).map(f => join(dir, f)).filter(f => statSync(f).isFile());
}

// what's wrong with a built page: its log, the page and the files with it
function check(doc, result, out, aux) {
  const problems = [];
  if (result.code !== 0) problems.push(`make4ht exited with ${result.code}`);
  const texLog = join(aux, doc.tex.replace(/\.tex$/, '.log'));
  const errors = existsSync(texLog) ? readFileSync(texLog, 'latin1').split('\n').filter(l => l.startsWith('!')) : ['no TeX log'];
  if (errors.length) problems.push(`TeX errors: ${errors.slice(0, 3).join(' | ')}`);
  // (make4ht falls back to parsing the page as HTML when tex4ht's isn't
  // well-formed XML, as with boxes and minipages; the browser does the same)
  const benign = /XML DOM parsing of .* failed|luaxml-mod-xml\.lua:\d+: Unbalanced Tag|HTML DOM parsing OK/;
  for (const line of result.log.split('\n').filter(l => /\[(WARNING|ERROR|FATAL)\]/.test(l) && !benign.test(l))) {
    problems.push(line.trim());
  }
  if (!existsSync(out)) return [...problems, 'no output directory'];
  const all = files(out);
  for (const f of all.filter(f => !published.has(extname(f)))) problems.push(`unexpected file ${relative(out, f)}`);
  for (const page of all.filter(f => f.endsWith('.html'))) {
    const html = readFileSync(page, 'utf8');
    const name = relative(out, page);
    if (/<script/.test(html)) problems.push(`${name}: has a <script>`);
    const merrors = (html.match(/<mjx-merror/g) || []).length;
    if (merrors) problems.push(`${name}: ${merrors} MathJax error(s)`);
    // (MathJax draws a macro it doesn't know as its name, in red)
    const unknown = [...html.matchAll(/<mjx-mtext style=['"]color: red;['"]>(.*?)<\/mjx-mtext>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, ''));
    if (unknown.length) problems.push(`${name}: macros MathJax doesn't know: ${[...new Set(unknown)].join(', ')}`);
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
  }
  return problems;
}

const docs = documents().filter(doc => !only.length || only.includes(doc.name));
const dirOf = doc => join(root, 'build/test', doc.name.replace(/[^A-Za-z0-9]/g, '_'));
await pool(docs, 2, async doc => {
  const out = join(dirOf(doc), 'html'), aux = join(dirOf(doc), 'aux');
  const result = await build(doc, out, aux);
  report(doc.name, check(doc, result, out, aux));
});

// the page MathJax typesets in the browser, without node_modules
if (!only.length) {
  const doc = docs.find(d => d.name === 'test-generic');
  const out = join(dirOf(doc), 'fallback'), aux = join(dirOf(doc), 'fallbackaux');
  const result = await build(doc, out, aux, { TEX8WEB_NO_PRERENDER: '1' });
  const html = existsSync(join(out, `${doc.name}.html`)) ? readFileSync(join(out, `${doc.name}.html`), 'utf8') : '';
  const problems = [];
  if (result.code !== 0) problems.push(`make4ht exited with ${result.code}`);
  for (const needed of ['id=\'tex8web-config\'', 'src=\'tex8web.js\'', '/tex-chtml.js']) {
    if (!html.includes(needed)) problems.push(`page lacks ${needed}`);
  }
  if (!existsSync(join(out, 'tex8web.js'))) problems.push('no tex8web.js next to the page');
  if (html.includes('<mjx-container')) problems.push('math typeset at build time');
  report(`${doc.name} (MathJax in the browser)`, problems);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
