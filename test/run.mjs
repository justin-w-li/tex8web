// npm test: the Lua unit tests, then every test document and example built
// with make4ht and checked. Pages go to build/test/<document>/html.
//   node test/run.mjs [document names...]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, documents, pool, root } from './lib/build.mjs';
import { checkLog, checkOutput, checkTexLog } from './lib/check.mjs';

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

// what tex8web measures in a document, where a test document sets it:
// titlesec's spacing in its *n form, a \titleformat's space after the
// label in a bold font's ems, and a title's own size
const measured = {
  'test-generic': { '--tex8web-section-before': '1.19598em', '--tex8web-section-after': '0.4485em',
    '--tex8web-section-labelsep': '1.125em', '--tex8web-title-size': '1.44em' },
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

// what's wrong with a built page: its log, the page and the files with it
function check(doc, result, out, aux) {
  const problems = [];
  if (result.code !== 0) problems.push(`make4ht exited with ${result.code}`);
  const css = join(out, doc.tex.replace(/\.tex$/, '.css'));
  const styles = existsSync(css) ? readFileSync(css, 'utf8') : '';
  for (const [property, value] of Object.entries(measured[doc.name] ?? {})) {
    if (!styles.includes(`${property}: ${value};`)) problems.push(`${property} isn't ${value}`);
  }
  const page = join(out, doc.tex.replace(/\.tex$/, '.html'));
  const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
  for (const pattern of typeset[doc.name] ?? []) {
    if (!pattern.test(html)) problems.push(`no ${pattern.source} in the typeset math`);
  }
  return [...problems, ...checkTexLog(join(aux, doc.tex.replace(/\.tex$/, '.log'))), ...checkLog(result.log),
    ...checkOutput(out)];
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
