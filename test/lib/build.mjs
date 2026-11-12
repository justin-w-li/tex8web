// Builds of the test documents and examples with make4ht and latexmk, for
// the tests, npm run examples, and npm run regress. Reuse of builds is
// described in CONTRIBUTING.md, "Reused builds".
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, constants } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inSlots, lock, noLockf } from './slots.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// the problems a document is known to have (test/expected.json)
export const expected = JSON.parse(readFileSync(join(root, 'test/expected.json'), 'utf8'));

// a document's build directory, build/<base>/<name>: base test for npm
// test, visual for visual.mjs
export const testDir = (doc, base = 'test') => join(root, 'build', base, doc.name.replace(/[^A-Za-z0-9]/g, '_'));

// the date of \today and \year in the test fixtures, January 1, 2000
// (web2c's SOURCE_DATE_EPOCH, with FORCE_SOURCE_DATE), so that a build
// reused from another day matches a build made today. The examples keep the
// real date, as they are published beside their PDF
const fixedDate = { SOURCE_DATE_EPOCH: '946684800', FORCE_SOURCE_DATE: '1' };

// test/fixtures/*.tex and examples/*/main.tex, each with the <name>.cfg
// beside it, else tex8web.cfg. A fixture has the fixed date. An example
// links its PDF, and the index of the site as its up link
export function documents() {
  const docs = [];
  const fixtures = join(root, 'test/fixtures');
  for (const file of readdirSync(fixtures).filter(f => f.endsWith('.tex')).sort()) {
    const name = file.replace(/\.tex$/, ''), own = join(fixtures, `${name}.cfg`);
    docs.push({ name, dir: fixtures, tex: file, cfg: existsSync(own) ? own : join(root, 'tex8web.cfg'), env: fixedDate });
  }
  const examples = join(root, 'examples');
  for (const name of existsSync(examples) ? readdirSync(examples).sort() : []) {
    const dir = join(examples, name);
    if (!existsSync(join(dir, 'main.tex'))) continue;
    const own = join(dir, `${name}.cfg`);
    docs.push({ name: `examples/${name}`, dir, tex: 'main.tex',
      cfg: existsSync(own) ? own : join(root, 'tex8web.cfg'), pdf: 'build/pdf/main.pdf',
      up: '../index.html' });
  }
  return docs;
}

// the documents named on the command line, or all of them. A name that
// matches none is an error: it would otherwise pass having checked nothing
export function select(names) {
  const all = documents();
  const unknown = names.filter(name => !all.some(doc => doc.name === name));
  if (unknown.length) {
    console.error(`no document named ${unknown.join(', ')}; the documents are ${all.map(doc => doc.name).join(', ')}`);
    process.exit(2);
  }
  return names.length ? all.filter(doc => names.includes(doc.name)) : all;
}

// the keys of per-document check tables that match no document, and so
// check nothing. A key may end in a parenthesis, as for run.mjs's second
// build of a document
export function strayKeys(...tables) {
  const names = new Set(documents().map(doc => doc.name));
  return tables.flatMap(table => Object.keys(table)).filter(key => !names.has(key.replace(/ \(.*\)$/, '')));
}

// the documents largest first, so that the longest build does not start
// last
export const largestFirst = docs => docs.map(doc => [doc, statSync(join(doc.dir, doc.tex)).size])
  .sort((a, b) => b[1] - a[1]).map(([doc]) => doc);

// builds at once from one tool: a build runs mostly on one core, and at
// most four leave the rest of the machine to other work (a laptop often has
// four performance cores). The slots limit all tools together
export const workers = Math.min(4, Math.max(2, availableParallelism() >> 1));

// the running commands, each in a separate process group, so that a hung
// command is killed with what it started (LaTeX, Node, dvisvgm). Ctrl-C does
// not reach these groups, so they are killed when this process exits, unless
// this process is killed outright
const running = new Set();
const kill = pid => { try { process.kill(-pid, 'SIGKILL'); } catch {} };
process.on('exit', () => running.forEach(kill));
// (128 plus the signal, as a shell reports it)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(128 + constants.signals[signal]));

// what a slotted command prints when it holds its slot (see execute)
const held = 'tex8web-slot-held';

// Runs a command, and kills its process group as hung if the command prints
// nothing for idle seconds or runs for total. A loaded machine slows
// a build without silencing it for long, so the idle limit is the tight
// one. The total limit stops a command that loops while printing. With
// slot, the command holds a build slot (slots.mjs) from its start, and the
// wait for the slot is not timed. TEX8WEB_SLOTS_HELD tells the command that
// it holds the slot, so its first takeSlot() does not wait for another.
// Resolves to { code, log }, the log being stdout and stderr in order
export const run = (command, args, { slot = false, ...options } = {}) => slot && !noLockf()
  ? inSlots(slotFile => execute(command, args, { ...options, env: { ...options.env ?? process.env, TEX8WEB_SLOTS_HELD: '1' }, slotFile }))
  : execute(command, args, options);

// a watchdog that runs the command and kills its process group after the
// total limit plus two seconds, or when this process is gone, so that a
// build with no one timing it does not keep holding a slot
const watchdog = `
  use POSIX ':sys_wait_h';
  my $end = time + shift;
  my $parent = getppid;
  my $pid = fork // die "fork: $!";
  if (!$pid) { exec @ARGV or die "exec: $!" }
  while (waitpid($pid, WNOHANG) == 0) {
    kill KILL => -getpgrp(0) if time >= $end || getppid != $parent;
    select undef, undef, undef, 0.1;
  }
  exit($? & 127 ? 128 + ($? & 127) : $? >> 8);`;

// With slotFile, runs the command under the watchdog and lockf, which holds
// the lock on slotFile until the command ends. The timers start at the
// first line, held, printed once the lock is taken. Resolves to null if the
// lock is busy (lockf exits with 75, EX_TEMPFAIL)
function execute(command, args, { idle = 180, total = 900, slotFile, ...options }) {
  return new Promise(done => {
    // (stderr into stdout, so that the log keeps the order in which the
    // command wrote them, which reading two pipes would lose)
    const child = slotFile
      ? spawn('perl', ['-e', watchdog, total + 2, 'lockf', '-k', '-t', '0', slotFile, 'sh', '-c', `echo ${held}; exec "$@" 2>&1`,
        'sh', command, ...args], { ...options, detached: true })
      : spawn('sh', ['-c', 'exec "$@" 2>&1', 'sh', command, ...args], { ...options, detached: true });
    running.add(child.pid);
    let log = '', timer, limit, started = !slotFile;
    const stop = why => {
      log += `\n[FATAL] ${command} ${why}, at: ${log.trim().split('\n').pop()}\n`;
      kill(child.pid);
    };
    const watch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => stop(`printed nothing for ${idle}s`), idle * 1000);
    };
    const start = () => {
      started = true;
      limit = setTimeout(() => stop(`ran over ${total}s`), total * 1000);
      watch();
    };
    if (started) start();
    // (what lockf prints before the command's first line is dropped)
    let before = '';
    child.stdout.on('data', d => {
      if (started) {
        log += d;
        return watch();
      }
      before += d;
      const at = before.indexOf(`${held}\n`);
      if (at < 0) return;
      log += before.slice(at + held.length + 1);
      start();
    });
    child.stderr.on('data', d => {
      log += d;
      if (started) watch();
    });
    child.on('close', code => {
      clearTimeout(timer);
      clearTimeout(limit);
      running.delete(child.pid);
      done(!started && code === 75 ? null : { code, log: log.replace(/\x1b\[[0-9;]*m/g, '') });
    });
  });
}

// a hash of the names, sizes, and contents of the files under paths
// (relative to base), without dotfiles, and without build directories,
// which hold outputs, unless outputs is set
export function hashFiles(base, paths, { outputs = false } = {}) {
  const hash = createHash('sha256');
  const add = file => hash.update(`${relative(base, file)}\0${statSync(file).size}\0`).update(readFileSync(file));
  const walk = path => {
    if (!statSync(path).isDirectory()) return add(path);
    for (const name of readdirSync(path).sort()) if ((outputs || name !== 'build') && !name.startsWith('.')) walk(join(path, name));
  };
  for (const path of paths) if (existsSync(join(base, path))) walk(join(base, path));
  return hash.digest('hex');
}

// the first entry under dir, its build directory included, that is not a
// file or directory, such as a link or a FIFO, or null
export function special(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name), stat = lstatSync(path);
    const found = stat.isDirectory() ? special(path) : !stat.isFile() && path;
    if (found) return found;
  }
  return null;
}

// the tex8web files a build reads
const sources = ['bin', 'css', 'fonts', 'js', 'lua', 'tex', 'tex8web.cfg', 'tex8web.mk4', 'package.json', 'package-lock.json'];
export const sourceHash = base => hashFiles(base, sources);
// the tex8web files the LaTeX runs read, with the Lua run between them,
// which makes the bibliography and index for LaTeX (tex8web.mk4)
export const latexSources = ['bin', 'tex', 'tex8web.cfg', 'tex8web.mk4', 'lua/tex8web/bibliography.lua',
  'lua/tex8web/files.lua', 'lua/tex8web/index.lua'];
export const latexSourceHash = base => hashFiles(base, latexSources);

// the inputs of a build other than the document: tex8web's sources, the
// versions of MathJax and subset-font if installed for prerendering
// (lua/tex8web/prerender.lua), and TeX Live. make4ht and tex4ht change
// within a TeX Live year, so the TeX and make4ht versions, the date of
// tex4ht.sty, and the date of texlive.tlpdb, which tlmgr changes on every
// update, are included: tlmgr keeps each installed file's original date.
// The stamp of the LaTeX runs (latex) is narrower: only latexSources and
// the TeX tools
let toolchain;
function tools() {
  if (toolchain) return toolchain;
  const version = name => {
    try { return JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version; } catch { return null; }
  };
  const first = (command, ...args) => spawnSync(command, args, { encoding: 'utf8' }).stdout?.split('\n')[0] ?? null;
  const sty = first('kpsewhich', 'tex4ht.sty');
  const installed = sty && statSync(sty, { throwIfNoEntry: false })?.mtimeMs;
  const texmfroot = first('kpsewhich', '-var-value', 'TEXMFROOT');
  const tlpdb = texmfroot ? statSync(join(texmfroot, 'tlpkg/texlive.tlpdb'), { throwIfNoEntry: false }) : null;
  const tex = [first('tex', '--version'), first('make4ht', '--version'), installed ?? null, tlpdb?.mtimeMs ?? null];
  return toolchain = { page: JSON.stringify([sourceHash(root), version('mathjax'), version('subset-font'), ...tex]),
    latex: JSON.stringify([latexSourceHash(root), ...tex]) };
}

// the stamps of a build. page: the tools above, the files in the document's
// directory, the config (which may be elsewhere), the arguments, the
// environment variables the build reads, and the size and time of the
// linked PDF, as a page built before the PDF existed lacks the link, and
// the day, for \today, unless the date is fixed. The files are hashed, so
// uncommitted edits and files unknown to git count. latex: the LaTeX
// tools, the same document inputs, and the day
function stamps(doc, args, env, pdf) {
  const all = { ...process.env, ...env };
  // (TEX8WEB_SLOTS* and TEX8WEB_SPEECH_CACHE change no page)
  const vars = Object.entries(all)
    .filter(([name]) => /^(TEX8WEB_(?!SLOTS|SPEECH_CACHE)|TEXINPUTS$|TEXMF|SOURCE_DATE_EPOCH$|FORCE_SOURCE_DATE$)/.test(name)).sort();
  const day = all.FORCE_SOURCE_DATE === '1' && all.SOURCE_DATE_EPOCH ? null : new Date().toDateString();
  // (a build through a runner, whose tools are the image's, is never reused
  // as a host build, nor the reverse)
  const rest = [hashFiles(doc.dir, ['']), readFileSync(doc.cfg, 'utf8'), args, vars, pdf,
    ...doc.runner ? [[doc.runner, ...[doc.runner[0], join(root, 'Dockerfile')].map(file => readFileSync(file, 'utf8'))]] : []];
  const hash = (...head) => createHash('sha256').update(JSON.stringify([...head, ...rest])).digest('hex');
  return { page: hash(tools().page, day), latex: hash(tools().latex, day) };
}

// Runs bin/tex8web on a document, with the page in out and tex4ht's files
// in aux (both absolute). make4ht reads the -B directory as a Lua pattern
// when it copies to -d, so -B is passed relative to the document, where a
// character such as - in the path above cannot break the pattern.
// A successful build is saved with its stamp (out.stamp) and log (out.log).
// A later build with the same stamp is not run, and resolves to
// { code: 0, log, reused: true }. One build at a time for each out, so that
// tools running at once share it. LaTeX's output is saved in aux.latex,
// with its stamp and its part of the log. A build with the same LaTeX stamp
// starts from it instead of running LaTeX (tex8web.mk4), and resolves with
// latexReused: true.
// Variables in env replace those in doc.env. A draft document (doc.draft)
// is built in make4ht's draft mode, which needs tex4ht's files from the
// previous build in aux. For a document with noLatexmk, the PDF is built
// elsewhere, and a missing PDF is not built here. With doc.runner, the argv
// of a runner such as test/lib/contain.mjs, make4ht and latexmk run
// through that runner
export async function build(doc, out, aux, env = {}) {
  // (a source through a runner is not trusted, and the host reads it before
  // the runner does: hashFiles would follow a link)
  const odd = doc.runner && special(doc.dir);
  if (odd) return { code: 2, log: `refusing to build ${doc.name}: ${odd} is not a file or directory\n` };
  mkdirSync(dirname(out), { recursive: true });
  const release = await lock(`${out}.lock`);
  try {
    return await buildHere(doc, out, aux, env);
  } finally {
    release();
  }
}

async function buildHere(doc, out, aux, env) {
  env = { ...doc.env, ...env };
  // the PDF the page links, which may not be built yet: passed with -p,
  // unless the config links it with \WebPDF, so that \WebPDF stays tested
  const own = readFileSync(doc.cfg, 'utf8').match(/^\\WebPDF\{([^}]+)\}/m)?.[1];
  const pdf = own ?? doc.pdf;
  // (-a info makes make4ht print each step. By default make4ht is silent
  // between its first and last lines, so run()'s idle limit would time the
  // whole build, and a stalled build would not show where)
  const args = ['-c', relative(doc.dir, doc.cfg), '-B', relative(doc.dir, aux), '-d', relative(doc.dir, out),
    ...!own && doc.pdf ? ['-p', join(doc.dir, doc.pdf)] : [], ...doc.up ? ['-u', doc.up] : [], ...doc.draft ? ['-m', 'draft'] : [],
    '-a', 'info', doc.tex];
  const stampNow = () => {
    const made = pdf && statSync(join(doc.dir, pdf), { throwIfNoEntry: false });
    return stamps(doc, args, env, made ? [made.size, made.mtimeMs] : null);
  };
  let wanted = stampNow();
  const kept = { stamp: `${out}.stamp`, log: `${out}.log` };
  if (existsSync(kept.stamp) && readFileSync(kept.stamp, 'utf8') === wanted.page && existsSync(out) && existsSync(aux)) {
    console.log(`reusing ${doc.name}'s ${basename(out)} build: nothing it is made from has changed`);
    return { code: 0, log: readFileSync(kept.log, 'utf8'), reused: true };
  }
  rmSync(kept.stamp, { force: true });
  if (pdf && !doc.noLatexmk && !existsSync(join(doc.dir, pdf))) {
    const { code, log } = await latexmk(doc, dirname(pdf));
    if (code !== 0) return { code, log: `latexmk exited with ${code}\n${log}` };
    // (the stamp again, with the new PDF, as the next build will see it)
    wanted = stampNow();
  }
  // (never in draft mode, which runs LaTeX once on the previous build's
  // files)
  const stage = { dir: `${aux}.latex`, stamp: `${aux}.latex.stamp`, log: `${aux}.latex.log` };
  const reuse = !doc.draft && existsSync(stage.stamp) && readFileSync(stage.stamp, 'utf8') === wanted.latex
    && existsSync(stage.dir) && existsSync(stage.log);
  rmSync(out, { recursive: true, force: true });
  if (!doc.draft) rmSync(aux, { recursive: true, force: true });
  if (reuse) {
    console.log(`reusing ${doc.name}'s LaTeX run in ${basename(out)}: nothing LaTeX reads has changed`);
  } else if (!doc.draft) {
    rmSync(stage.stamp, { force: true });
    rmSync(stage.dir, { recursive: true, force: true });
    // (tex8web.mk4 copies LaTeX's run only into an empty directory, so that
    // a runner can mount exactly that directory)
    mkdirSync(stage.dir, { recursive: true });
  }
  // (make4ht's own mkdir fails when two builds make the same parent at once)
  mkdirSync(aux, { recursive: true });
  // (the speech cache is kept beside the document, so that every checkout
  // shares it for a document outside tex8web. The cache is keyed by formula,
  // and most formulas stay the same in another version of tex8web)
  mkdirSync(join(doc.dir, 'build'), { recursive: true });
  const speech = join(doc.dir, 'build', doc.tex.replace(/\.tex$/, '.speech.json'));
  // (a runner's writable directories must exist. The stamps and logs stay
  // outside them)
  mkdirSync(out, { recursive: true });
  const linked = pdf && join(doc.dir, pdf);
  const [command, prefixed, limits] = through(doc, [doc.cfg, ...linked && existsSync(linked) ? [linked] : [], ...reuse ? [stage.dir] : []],
    [out, aux, ...doc.draft || reuse ? [] : [stage.dir], join(doc.dir, 'build')], join(root, 'bin/tex8web'), args);
  const result = await run(command, prefixed, { cwd: doc.dir, slot: true, ...limits, env: { ...process.env, ...env,
    TEX8WEB_SPEECH_CACHE: speech, TEX8WEB_LATEX_REUSE: reuse ? stage.dir : undefined,
    TEX8WEB_LATEX_SAVE: doc.draft || reuse ? undefined : stage.dir } });
  // (the marks around LaTeX's part of the log, which a reused run takes from
  // the saved run. A run that stopped in LaTeX has only the first mark. A
  // run that ran LaTeX because the saved run had no DVI has neither)
  const parts = result.log.split(/^tex8web-latex-(?:begin|end)\n/m);
  const latexLog = parts.length === 3 ? parts[1] : undefined;
  if (reuse && latexLog !== undefined) parts[1] = readFileSync(stage.log, 'utf8');
  result.log = parts.join('');
  if (result.code === 0) {
    writeFileSync(kept.log, result.log);
    writeFileSync(kept.stamp, wanted.page);
    if (!reuse && latexLog !== undefined) {
      writeFileSync(stage.log, latexLog);
      writeFileSync(stage.stamp, wanted.latex);
    }
  }
  return reuse && latexLog !== undefined ? { ...result, latexReused: true } : result;
}

// the command, arguments, and run() limits that run command on a document:
// through doc.runner if set, with -r for each path in read outside the
// document's directory, and -w for each directory in write. The total limit
// is then longer than the runner's default of 900 s, so that the runner,
// started later, stops the command first, with its own line
export const through = (doc, read, write, command, args) => doc.runner
  ? [doc.runner[0], [...doc.runner.slice(1), ...read.filter(file => /^\.\.(\/|$)/.test(relative(doc.dir, file))).flatMap(file => ['-r', file]),
    ...write.flatMap(dir => ['-w', dir]), '--', command, ...args], { total: 930 }]
  : [command, args, {}];

// builds a document's PDF with latexmk in outdir (relative to the
// document); resolves to { code, log }. Once for each PDF, as both test
// builds of a document may need it at once. Through a runner, a
// .latexmkrc is not read, as it is Perl
const pdfs = new Map();
export function latexmk(doc, outdir) {
  const key = join(doc.dir, outdir, doc.tex);
  if (!pdfs.has(key)) {
    mkdirSync(join(doc.dir, outdir), { recursive: true });
    const [command, args, limits] = through(doc, [], [join(doc.dir, outdir)], 'latexmk',
      [...doc.runner ? ['-norc'] : [], '-pdf', '-interaction=nonstopmode', `-outdir=${outdir}`, doc.tex]);
    pdfs.set(key, run(command, args, { cwd: doc.dir, slot: true, ...limits }));
  }
  return pdfs.get(key);
}

// runs f on each item, at most n at a time
export async function pool(items, n, f) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await f(items[i]);
    }
  }));
  return results;
}
