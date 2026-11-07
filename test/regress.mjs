// What a change to tex8web does to your own documents: builds each one,
// checks the page as npm test checks its own, and says what changed since the
// baseline (the last build you accepted): the HTML (test/diff.mjs), then, if
// that changed, how the page looks (test/shots.mjs), while the other
// documents are still building.
//   node test/regress.mjs [options] <dir or .tex file>...
// A directory means its main.tex, or its only .tex file. Documents build in
// parallel, within the build slots (test/lib/slots.mjs). Each is named by its
// directory, and the names must differ. Exits 1 if a build or check failed,
// 3 if a page looks different from its baseline, 2 on a usage error, else 0.
//   -c <config>        build every document with this config
//   --out <dir>        where the builds go, default build/regress:
//                      html/<name>, compare/<name> (the screens that differ),
//                      logs/, tex4ht/ and, by default, accepted/<name>
//   --baseline <dir>   compare with the pages in <dir>/<name> instead, such as
//                      another checkout's html directory
//   --accept           make this run's pages the baseline, with a STAMP file
//                      saying which tex8web commit and when. Refused when
//                      tex8web has uncommitted changes, with --draft, and
//                      when any document failed
//   --draft            make4ht's draft mode, quicker and not to be trusted
//   --expect look      the pages are meant to look different, so compare
//                      the screens only as far as the first strip of 20
//                      that differs, for each width and scheme, and say from
//                      which screen. By default every screen is compared
//   --shots-cache <dir>  where shots.mjs keeps what the baseline's screens
//                      came to, by what decides them, so that every run and
//                      checkout using the directory shoots a baseline once.
//                      Default <out>/shots-cache
//   --shots-at-once <n>  how many pages' screens are compared at once, each
//                      in a Chrome of its own, as the others are built.
//                      Default 1
//   --latexmk          build each document's PDF first, with latexmk in the
//                      document's directory, holding its build/pdf.lock so
//                      that no two runs of latexmk share a build/pdf. A
//                      document whose PDF fails isn't built. Without it
//                      the PDFs are the caller's to build
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build, pool, root, run, workers } from './lib/build.mjs';
import { lock, tryLock } from './lib/slots.mjs';
import { checkLog, checkOutput, checkTexLog } from './lib/check.mjs';

// (npm runs a script in tex8web's directory, and says where it was run from)
const at = path => resolve(process.env.npm_lifecycle_event ? process.env.INIT_CWD ?? process.cwd() : process.cwd(), path);
const usage = 'usage: node test/regress.mjs [-c <config>] [--baseline <dir>] [--out <dir>] [--draft | --accept] [--latexmk] [--expect look] [--shots-cache <dir>] [--shots-at-once <n>] <dir or .tex file>...';
const refuse = message => {
  console.error(message);
  process.exit(2);
};

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: {
    c: { type: 'string', short: 'c' }, baseline: { type: 'string' }, out: { type: 'string' },
    accept: { type: 'boolean' }, draft: { type: 'boolean' }, latexmk: { type: 'boolean' },
    expect: { type: 'string' }, 'shots-cache': { type: 'string' }, 'shots-at-once': { type: 'string' },
  } });
} catch (error) {
  refuse(`${error.message}\n${usage}`);
}
const { values: options, positionals } = parsed;
if (!positionals.length) refuse(usage);
if (options.expect !== undefined && options.expect !== 'look') refuse(`--expect takes look, not ${options.expect}\n${usage}`);
const shotsAtOnce = Number(options['shots-at-once'] ?? 1);
if (!Number.isInteger(shotsAtOnce) || shotsAtOnce < 1) refuse(`--shots-at-once takes a number, 1 or more\n${usage}`);
if (options.draft && options.accept) refuse('--draft pages are not to be trusted, so --draft and --accept don\'t go together');

// the abbreviated commit of the checkout whose pages are accepted. The tests
// set TEX8WEB_TREE to name another checkout
function commit() {
  const tree = process.env.TEX8WEB_TREE ?? root;
  const git = (...args) => spawnSync('git', ['-C', tree, ...args], { encoding: 'utf8' });
  const head = git('rev-parse', '--short', 'HEAD');
  if (head.status !== 0) refuse(`${tree} is not a git checkout, so --accept can't record which tex8web built the pages`);
  const changes = git('status', '--porcelain').stdout.trim();
  if (changes) refuse(`tex8web has uncommitted changes, so --accept can't record which tex8web built the pages:\n${changes}`);
  return head.stdout.trim();
}
const accepting = options.accept ? commit() : null;

const out = at(options.out ?? 'build/regress');
// (a baseline there would be lost with a fresh clone)
if (!options.out && !relative(root, out).startsWith('..')) {
  refuse(`The pages would go to ${out}, inside tex8web. Run it from your documents' directory instead:\n  npm --prefix ${root} run regress -- <documents>`);
}
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
  // (the PDFs, which a config's \WebPDF links, are the caller's to build,
  // unless it says --latexmk)
  return { name: basename(dir), dir, tex, cfg, draft: options.draft, noLatexmk: true };
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

// one run at a time in an out directory, which clean.mjs leaves alone meanwhile
const lockFile = join(out, 'regress.lock');
// (held until this process ends)
let outLock = await tryLock(lockFile);
if (!outLock) {
  console.error(`waiting for another regress run in ${out}`);
  outLock = await lock(lockFile);
}
mkdirSync(logs, { recursive: true });
console.error(`building ${docs.length} document(s) into ${out}`);
const started = Date.now();
const here = dirname(new URL(import.meta.url).pathname);
const node = (script, ...args) => run(process.execPath, [join(here, script), ...args]);

// builds a document's PDF as a wrapper script does, or says why it couldn't:
// the lock first, then a slot, so that a run waiting for the lock holds none
async function latexmk(doc) {
  mkdirSync(join(doc.dir, 'build'), { recursive: true });
  const release = await lock(join(doc.dir, 'build/pdf.lock'));
  try {
    // (latexmk is silent for a while on a long document)
    const result = await run('latexmk', ['-interaction=nonstopmode', '-halt-on-error', doc.tex], { cwd: doc.dir, slot: true, idle: 900 });
    writeFileSync(join(logs, `${doc.name}.pdf.log`), result.log);
    if (result.code !== 0) return `failed to build its PDF, exit ${result.code} (log: ${join(logs, `${doc.name}.pdf.log`)})`;
  } finally {
    release();
  }
}

// builds and checks one document, and finds out what changed since its baseline
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

// (each page's screens in a Chrome of its own, which takes a slot like a build)
let shooting = 0;
const waiting = [];
const turn = () => new Promise(go => shooting < shotsAtOnce ? (shooting++, go()) : waiting.push(go));
const next = () => (waiting.shift() ?? (() => shooting--))();

// the screens of a changed page, as soon as it is built
async function screens(result) {
  const compare = join(out, 'compare', result.doc.name);
  await turn();
  try {
    console.error(`${result.doc.name}: comparing the screens`);
    // (a long page takes shots.mjs minutes for each width and scheme, when
    // the machine is busy, and more than run()'s 15 minutes in all)
    const shots = await run(process.execPath, [join(here, 'shots.mjs'), '--cache', shotsCache, ...options.expect ? ['--expect', options.expect] : [],
      compare, result.kept, result.html], { total: 3600 });
    writeFileSync(join(logs, `${result.doc.name}.shots.log`), shots.log);
    if (shots.code === 1) {
      result.kind = 'looks';
      result.outcome = `looks different: ${shots.log.trim().split('\n').filter(line => /: (screens .* differ|differs from screen|only in )/.test(line))
        .map(line => line.replace(/: screens (.*?) of \d+ differ.*$/, ' (screens $1)').replace(/: differs from screen (\d+) of .*$/, ' (from screen $1)')).join('; ')}`;
    } else if (shots.code !== 0) {
      result.failed = true;
      result.outcome += `; couldn't compare the screens: ${shots.log.trim().split('\n').pop()}`;
    }
  } finally {
    next();
  }
}

const results = await pool(docs, workers, async doc => {
  const result = await regress(doc);
  // (not awaited: the pool goes on to build the next document)
  if (result.kind === 'changed') result.shots = screens(result);
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

if (accepting && failed) console.log('not accepting: a document failed');
else if (accepting) {
  mkdirSync(baseline, { recursive: true });
  // (no STAMP while some pages are the old ones and some the new)
  rmSync(join(baseline, 'STAMP'), { force: true });
  // (whole, as another run may be comparing with it)
  for (const { doc, html } of results) {
    const target = join(baseline, doc.name), staged = join(baseline, `.${doc.name}`);
    rmSync(staged, { recursive: true, force: true });
    cpSync(html, staged, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    renameSync(staged, target);
  }
  writeFileSync(join(baseline, 'STAMP'), `${accepting} ${new Date().toISOString()}\n`);
  console.log(`accepted in ${baseline}, from tex8web ${accepting}`);
}
console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
process.exit(failed ? 1 : count('looks') && !accepting ? 3 : 0);
