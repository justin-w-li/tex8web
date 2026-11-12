// What a change to tex8web does to your documents. Each document is built
// and checked as npm test checks its pages, then compared with its baseline
// (the last accepted build): the HTML with test/diff.mjs, then, if the HTML
// changed, the screens with test/shots.mjs, while other documents build.
//   node test/regress.mjs [options] <dir or .tex file>...
// A directory means its main.tex, or its only .tex file. Documents build in
// parallel within the build slots (test/lib/slots.mjs). Each is named by its
// directory, so the names must differ. Exits 1 if a build or check failed,
// 3 if a page looks different from its baseline, 2 on a usage error, else 0.
//   -c <config>        build every document with this config
//   --out <dir>        default build/regress, holding html/<name>,
//                      compare/<name> (differing screens), logs/, tex4ht/,
//                      and by default accepted/<name>
//   --baseline <dir>   compare with <dir>/<name> instead, as another
//                      checkout's html directory
//   --accept           make this run's pages the baseline without comparing
//                      screens, as a change is looked at before it is
//                      accepted. Refused with --draft, and skipped if a
//                      document failed
//   --draft            make4ht's draft mode: quicker, not to be trusted
//   --shots-cache <dir>  passed to shots.mjs as --cache, so every run and
//                      checkout using dir shoots a baseline once. Default
//                      <out>/shots-cache
//   --latexmk          build each PDF first with latexmk in the document's
//                      directory, holding its build/pdf.lock so no two
//                      latexmk runs share a build/pdf. A document whose PDF
//                      fails is not built. Without --latexmk, build the
//                      PDFs first
//   --contain          build each page, and with --latexmk each PDF, in a
//                      container without network or shell escape
//                      (test/lib/contain.mjs), for a source not trusted.
//                      A source that holds anything but files and
//                      directories is refused, and the paths given are
//                      taken without their symbolic links. latexmk then
//                      writes the PDF to the document's build/pdf, and
//                      reads no .latexmkrc
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build, pool, root, run, runOn, special, workers } from './lib/build.mjs';
import { lock } from './lib/slots.mjs';
import { checkLog, checkOutput, checkTexLog } from './lib/check.mjs';

// npm runs a script in tex8web's directory and sets INIT_CWD to where npm
// was run. With --contain, a path is given without its symbolic links,
// which contain.mjs refuses to mount, as macOS's /tmp is one
const unlinked = path => existsSync(path) ? realpathSync(path) : join(unlinked(dirname(path)), basename(path));
const at = path => {
  const full = resolve(process.env.npm_lifecycle_event ? process.env.INIT_CWD ?? process.cwd() : process.cwd(), path);
  return options.contain ? unlinked(full) : full;
};
const usage = 'usage: node test/regress.mjs [-c <config>] [--baseline <dir>] [--out <dir>] [--draft | --accept] [--latexmk] [--contain] [--shots-cache <dir>] <dir or .tex file>...';
const refuse = message => {
  console.error(message);
  process.exit(2);
};

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: {
    c: { type: 'string', short: 'c' }, baseline: { type: 'string' }, out: { type: 'string' },
    accept: { type: 'boolean' }, draft: { type: 'boolean' }, latexmk: { type: 'boolean' }, contain: { type: 'boolean' },
    'shots-cache': { type: 'string' },
  } });
} catch (error) {
  refuse(`${error.message}\n${usage}`);
}
const { values: options, positionals } = parsed;
if (!positionals.length) refuse(usage);
if (options.draft && options.accept) refuse('--draft pages are not to be trusted, so --draft and --accept don\'t go together');

const out = at(options.out ?? 'build/regress');
const baseline = at(options.baseline ?? join(out, 'accepted'));
const logs = join(out, 'logs');
const shotsCache = at(options['shots-cache'] ?? join(out, 'shots-cache'));
const cfg = at(options.c ?? join(root, 'tex8web.cfg'));
if (!existsSync(cfg)) refuse(`no such config: ${options.c}`);

function document(arg) {
  const path = at(arg);
  if (!existsSync(path)) refuse(`no such file or directory: ${arg}`);
  let dir = path, tex = basename(path);
  if (statSync(path).isFile()) {
    if (!path.endsWith('.tex')) refuse(`not a .tex file: ${arg}`);
    dir = dirname(path);
  } else {
    const files = readdirSync(path).filter(file => file.endsWith('.tex'));
    tex = files.includes('main.tex') ? 'main.tex' : files.length === 1 ? files[0] : null;
    if (!tex) refuse(`${arg} has no main.tex and not exactly one .tex file; name the file`);
  }
  // (a source that is not trusted, before the host takes its lock or hashes
  // it: the lock or the hash would follow a link)
  const odd = options.contain && special(dir);
  if (odd) refuse(`refusing ${arg}: ${odd} is not a file or a directory that can be read`);
  // build() does not build the PDFs a config's \WebPDF links; latexmk()
  // builds them with --latexmk
  return { name: basename(dir), dir, tex, cfg, draft: options.draft, noLatexmk: true,
    ...options.contain && { runner: [join(root, 'test/lib/contain.mjs')] } };
}

const docs = positionals.map(document);
for (const doc of docs) {
  const same = docs.filter(other => other.name.replace(/[^A-Za-z0-9]/g, '_') === doc.name.replace(/[^A-Za-z0-9]/g, '_'));
  if (same.length > 1) refuse(`documents with the same name ${doc.name}, as each is named by its directory: ${same.map(d => d.dir).join(', ')}`);
}
// make4ht reads -B as a Lua pattern (see build.mjs), and tex4ht's files are
// named without punctuation for that
const auxFor = doc => join(out, 'tex4ht', doc.name.replace(/[^A-Za-z0-9]/g, '_'));
for (const doc of docs) {
  if (/[-^$()%[\]*+?]/.test(relative(doc.dir, auxFor(doc)))) {
    refuse(`make4ht can't read a Lua pattern character (one of - ^ $ ( ) % [ ] * + ?) in the path of tex4ht's files, ${relative(doc.dir, auxFor(doc))}; use an --out without one`);
  }
}

mkdirSync(logs, { recursive: true });
console.error(`building ${docs.length} document(s) into ${out}`);
const started = Date.now();
const here = dirname(new URL(import.meta.url).pathname);
const node = (script, ...args) => run(process.execPath, [join(here, script), ...args]);

// Builds a document's PDF, or resolves to why it failed. The lock is taken
// before the slot, so a run waiting for the lock holds no slot.
async function latexmk(doc) {
  mkdirSync(join(doc.dir, 'build'), { recursive: true });
  // (with --contain, the lock is kept where the source cannot reach it)
  const release = await lock(options.contain
    ? join(tmpdir(), `tex8web-pdf-${createHash('sha256').update(doc.dir).digest('hex').slice(0, 12)}.lock`) : join(doc.dir, 'build/pdf.lock'));
  try {
    // (in the container, the document's directory is read-only, and a
    // .latexmkrc, which is Perl, is not read)
    // (latexmk can print nothing for minutes on a long document)
    const result = await runOn(doc, [], [join(doc.dir, 'build')], 'latexmk',
      [...options.contain ? ['-norc', '-pdf', '-outdir=build/pdf'] : [], '-interaction=nonstopmode', '-halt-on-error', doc.tex],
      { cwd: doc.dir, slot: true, idle: 900 });
    writeFileSync(join(logs, `${doc.name}.pdf.log`), result.log);
    if (result.code !== 0) return `failed to build its PDF, exit ${result.code} (log: ${join(logs, `${doc.name}.pdf.log`)})`;
  } finally {
    release();
  }
}

// builds and checks one document, and compares its HTML with its baseline
async function regress(doc) {
  const html = join(out, 'html', doc.name), aux = auxFor(doc), kept = join(baseline, doc.name);
  rmSync(join(out, 'compare', doc.name), { recursive: true, force: true });
  const pdfFailed = options.latexmk && await latexmk(doc);
  if (pdfFailed) return { doc, html, kept, failed: true, kind: 'failed', outcome: pdfFailed, problems: [] };
  const result = await build(doc, html, aux);
  writeFileSync(join(logs, `${doc.name}.html.log`), result.log);
  if (result.code !== 0) {
    return { doc, html, kept, failed: true, kind: 'failed', outcome: `failed to build, exit ${result.code} (log: ${join(logs, `${doc.name}.html.log`)})`,
      problems: checkLog(result.log).slice(0, 3) };
  }
  const found = {
    doc, html, kept, files: [], failed: false,
    problems: [...new Set([...checkTexLog(join(aux, doc.tex.replace(/\.tex$/, '.log'))), ...checkLog(result.log), ...checkOutput(html)])],
  };
  if (!existsSync(kept)) return { ...found, kind: 'new', outcome: 'no baseline to compare with' };
  const diff = await node('diff.mjs', kept, html);
  writeFileSync(join(logs, `${doc.name}.diff`), diff.log);
  if (diff.code === 0) return { ...found, kind: 'unchanged', outcome: 'unchanged' };
  if (diff.code !== 1) return { ...found, failed: true, outcome: `couldn't compare: ${diff.log.trim().split('\n').pop()}` };
  const files = [...diff.log.matchAll(/^(changed|added|removed) (.+)$/gm)].map(([, verb, file]) => verb === 'changed' ? file : `${file} (${verb})`);
  return { ...found, kind: 'changed', files, outcome: `changed: ${files.slice(0, 6).join(', ')}${files.length > 6 ? ` and ${files.length - 6} more` : ''}` };
}

// Compares the screens of a changed page as soon as the page is built.
// shots.mjs launches a separate Chrome, which holds a build slot like a build.
async function screens(result) {
  const compare = join(out, 'compare', result.doc.name);
  console.error(`${result.doc.name}: comparing the screens`);
  // on a busy machine, a long page takes minutes for each width and scheme,
  // more than run()'s default limit of 15 minutes in all
  const shots = await run(process.execPath, [join(here, 'shots.mjs'), '--cache', shotsCache, compare, result.kept, result.html],
    { slot: true, total: 3600 });
  writeFileSync(join(logs, `${result.doc.name}.shots.log`), shots.log);
  if (shots.code === 1) {
    result.kind = 'looks';
    result.outcome = `looks different: ${shots.log.trim().split('\n').filter(line => /: (screens .* differ|differs from screen|only in )/.test(line))
      .map(line => line.replace(/: screens (.*?) of \d+ differ.*$/, ' (screens $1)').replace(/: differs from screen (\d+) of .*$/, ' (from screen $1)')).join('; ')}`;
  } else if (shots.code !== 0) {
    result.failed = true;
    result.outcome += `; couldn't compare the screens: ${shots.log.trim().split('\n').pop()}`;
  }
}

// (the image is built once, before the builds, rather than by each at once
// inside run()'s limits)
if (options.contain && spawnSync(join(root, 'test/lib/contain.mjs'), ['--', 'true'], { stdio: ['ignore', 2, 2] }).status !== 0) {
  console.error('the container did not run: is Docker running?');
  process.exit(1);
}
const results = await pool(docs, workers, async doc => {
  const result = await regress(doc);
  // not awaited, so the next document builds meanwhile
  if (result.kind === 'changed' && !options.accept) result.shots = screens(result);
  return result;
});
await Promise.all(results.map(result => result.shots));

for (const { doc, outcome, problems } of results) {
  console.log(`${doc.name}: ${outcome}`);
  for (const problem of problems) console.log(`  problem: ${problem}`);
}
const count = kind => results.filter(result => result.kind === kind).length;
const failed = results.filter(result => result.failed || result.problems.length).length;
console.log(`${results.length} document(s): ${count('unchanged')} unchanged, ${count('changed')} changed, ${count('looks')} look different, `
  + `${count('new')} without a baseline, ${failed} failed`);
console.log(`pages in ${join(out, 'html')}, logs in ${logs}`);

if (options.accept && failed) console.log('not accepting: a document failed');
else if (options.accept) {
  mkdirSync(baseline, { recursive: true });
  // copied beside the baseline, then renamed, as another run may be
  // comparing with the baseline
  for (const { doc, html } of results) {
    const target = join(baseline, doc.name), staged = join(baseline, `.${doc.name}`);
    rmSync(staged, { recursive: true, force: true });
    cpSync(html, staged, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    renameSync(staged, target);
  }
  console.log(`accepted in ${baseline}`);
}
console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
process.exit(failed ? 1 : count('looks') ? 3 : 0);
