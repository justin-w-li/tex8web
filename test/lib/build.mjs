// Building the test documents and examples with make4ht, for the tests and
// for npm run examples.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, constants } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inSlots, lock, noLockf, released } from './slots.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// the problems a document is known to have (test/expected.json)
export const expected = JSON.parse(readFileSync(join(root, 'test/expected.json'), 'utf8'));

// where a test (npm test's, or test:visual's in build/visual) builds a
// document
export const testDir = (doc, base = 'test') => join(root, 'build', base, doc.name.replace(/[^A-Za-z0-9]/g, '_'));

// test/fixtures/*.tex and examples/*/main.tex, each with its config: the
// document's own <name>.cfg if it has one, otherwise tex8web.cfg. An
// example links its PDF, which it is published with, and the site's index
// above it
export function documents() {
  const docs = [];
  const fixtures = join(root, 'test/fixtures');
  for (const file of readdirSync(fixtures).filter(f => f.endsWith('.tex')).sort()) {
    const name = file.replace(/\.tex$/, ''), own = join(fixtures, `${name}.cfg`);
    docs.push({ name, dir: fixtures, tex: file, cfg: existsSync(own) ? own : join(root, 'tex8web.cfg') });
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

// the keys of tables of per-document checks that match no document: a table
// keyed by a document that isn't there checks nothing. A key may have
// a parenthesis after the name, as run.mjs's second build of a document
export function strayKeys(...tables) {
  const names = new Set(documents().map(doc => doc.name));
  return tables.flatMap(table => Object.keys(table)).filter(key => !names.has(key.replace(/ \(.*\)$/, '')));
}

// the documents largest first, so that the longest build doesn't hold up
// the end
export const largestFirst = docs => docs.map(doc => [doc, statSync(join(doc.dir, doc.tex)).size])
  .sort((a, b) => b[1] - a[1]).map(([doc]) => doc);

// builds at once from one tool: a build runs mostly on one core, and four
// leave the rest of the machine to other work (a laptop's performance cores
// are often four). The slots limit all the tools together
export const workers = Math.min(4, Math.max(2, availableParallelism() >> 1));

// commands running, each in a process group of its own (so that one that
// hangs is killed with what it started: LaTeX, Node, dvisvgm), which Ctrl-C
// doesn't reach: killed as this process ends, unless it is killed outright
const running = new Set();
const kill = pid => { try { process.kill(-pid, 'SIGKILL'); } catch {} };
process.on('exit', () => running.forEach(kill));
// (128 plus the signal, as a shell reports it)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(128 + constants.signals[signal]));

// what a slotted command prints when it holds its slot (see execute)
const held = 'tex8web-slot-held';

// runs a command, killing its process group if it prints nothing for idle
// seconds, or runs for total: it has hung. A loaded machine slows a build
// without silencing it for long, so the idle limit is the tight one. The
// total limit stops one that loops while printing. With slot, the command
// holds a build slot (slots.mjs) from when it starts, and waiting for the
// slot isn't timed. Resolves to { code, log }, the log being stdout and
// stderr in order
export const run = (command, args, { slot = false, ...options } = {}) => slot && !noLockf()
  ? inSlots(slotFile => execute(command, args, { ...options, slotFile })).finally(released)
  : execute(command, args, options);

// Runs the command under a watchdog that ends it, with its process group,
// when it has run for the total limit and two seconds more, or when this
// process is gone: a build with no one to time it is not left holding a slot
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

// With slotFile, runs the command as a child of the watchdog and lockf,
// which holds the lock on that file until the command has ended. The timers
// start when the command's first line, held, says it has the lock. Resolves
// to null if the lock is busy (75, EX_TEMPFAIL)
function execute(command, args, { idle = 180, total = 900, slotFile, ...options }) {
  return new Promise(done => {
    const child = slotFile
      ? spawn('perl', ['-e', watchdog, total + 2, 'lockf', '-k', '-t', '0', slotFile, 'sh', '-c', `echo ${held}; exec "$@"`,
        'sh', command, ...args], { ...options, detached: true })
      : spawn(command, args, { ...options, detached: true });
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

// a hash of the files under the paths (relative to base): their names and
// contents, leaving out dotfiles and build directories, which hold outputs
function hashFiles(base, paths) {
  const hash = createHash('sha256');
  const add = file => hash.update(`${relative(base, file)}\0${statSync(file).size}\0`).update(readFileSync(file));
  const walk = path => {
    if (!statSync(path).isDirectory()) return add(path);
    for (const name of readdirSync(path).sort()) if (name !== 'build' && !name.startsWith('.')) walk(join(path, name));
  };
  for (const path of paths) if (existsSync(join(base, path))) walk(join(base, path));
  return hash.digest('hex');
}

// what bin/tex8web reads of tex8web's own
const sources = ['bin', 'css', 'fonts', 'js', 'lua', 'tex', 'tex8web.cfg', 'tex8web.mk4', 'package.json', 'package-lock.json'];
export const sourceHash = base => hashFiles(base, sources);

// what a build is made from besides the document, as a hash: tex8web's
// sources, and the tools it uses, which change its output when they change:
// MathJax and subset-font, if they are there to prerender with
// (lua/tex8web/prerender.lua), TeX Live, and make4ht and tex4ht, which
// change within a TeX Live year (the version, and when tex4ht.sty was
// installed)
let toolchain;
function tools() {
  if (toolchain) return toolchain;
  const version = name => {
    try { return JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version; } catch { return null; }
  };
  const first = (command, ...args) => spawnSync(command, args, { encoding: 'utf8' }).stdout?.split('\n')[0] ?? null;
  const sty = first('kpsewhich', 'tex4ht.sty');
  const installed = sty && statSync(sty, { throwIfNoEntry: false })?.mtimeMs;
  return toolchain = JSON.stringify([sourceHash(root), version('mathjax'), version('subset-font'),
    first('tex', '--version'), first('make4ht', '--version'), installed ?? null]);
}

// the whole stamp of a build: those, the document's directory and config
// (which may be elsewhere), the command and the environment variables the
// build reads, and the PDF the page links: a page built before it was there
// lacks the link. The files themselves, not the commit, so that an edit not
// yet committed, or a file git doesn't know, is part of it
function stamp(doc, args, env, pdf) {
  // (the slots and regress.mjs's test hook change no page)
  const vars = Object.entries({ ...process.env, ...env }).filter(([name]) => /^(TEX8WEB_(?!SLOTS|TREE)|TEXINPUTS$|TEXMF)/.test(name)).sort();
  return createHash('sha256').update(JSON.stringify([tools(), hashFiles(doc.dir, ['']), readFileSync(doc.cfg, 'utf8'), args, vars, pdf])).digest('hex');
}

// runs bin/tex8web on a document, with the page in out and tex4ht's files
// in aux (both absolute). make4ht reads the -B directory as a Lua pattern
// when it copies to -d, so it is passed relative to the document, where
// characters like - in the path above don't matter.
// The build is kept with a stamp of what it was made from (out.stamp) and
// its log (out.log), and a later build from the same stamp is not run: it
// resolves to { code: 0, log, reused: true }. A build that failed leaves no
// stamp. One at a time for each out, so that tools running at once share it.
// A draft document (doc.draft) is built in make4ht's draft mode, which
// needs tex4ht's files from the build before in aux. A document with
// noLatexmk has its PDF built elsewhere: a missing one isn't built here
export async function build(doc, out, aux, env = {}) {
  mkdirSync(dirname(out), { recursive: true });
  const release = await lock(`${out}.lock`);
  try {
    return await buildHere(doc, out, aux, env);
  } finally {
    release();
  }
}

async function buildHere(doc, out, aux, env) {
  // the PDF the page links, if it isn't built yet: with -p, unless the
  // config links it with \WebPDF, which keeps that tested
  const own = readFileSync(doc.cfg, 'utf8').match(/^\\WebPDF\{([^}]+)\}/m)?.[1];
  const pdf = own ?? doc.pdf;
  const args = ['-c', relative(doc.dir, doc.cfg), '-B', relative(doc.dir, aux), '-d', relative(doc.dir, out),
    ...!own && doc.pdf ? ['-p', join(doc.dir, doc.pdf)] : [], ...doc.up ? ['-u', doc.up] : [], ...doc.draft ? ['-m', 'draft'] : [], doc.tex];
  const stampNow = () => {
    const made = pdf && statSync(join(doc.dir, pdf), { throwIfNoEntry: false });
    return stamp(doc, args, env, made ? [made.size, made.mtimeMs] : null);
  };
  let wanted = stampNow();
  const kept = { stamp: `${out}.stamp`, log: `${out}.log` };
  if (existsSync(kept.stamp) && readFileSync(kept.stamp, 'utf8') === wanted && existsSync(out) && existsSync(aux)) {
    console.log(`reusing ${doc.name}'s ${basename(out)} build: nothing it is made from has changed`);
    return { code: 0, log: readFileSync(kept.log, 'utf8'), reused: true };
  }
  rmSync(kept.stamp, { force: true });
  if (pdf && !doc.noLatexmk && !existsSync(join(doc.dir, pdf))) {
    const { code, log } = await latexmk(doc, dirname(pdf));
    if (code !== 0) return { code, log: `latexmk exited with ${code}\n${log}` };
    // (the PDF is there now, as the next build will find it)
    wanted = stampNow();
  }
  rmSync(out, { recursive: true, force: true });
  if (!doc.draft) rmSync(aux, { recursive: true, force: true });
  // (make4ht's own mkdir fails when two builds make the same parent at once)
  mkdirSync(aux, { recursive: true });
  const result = await run(join(root, 'bin/tex8web'), args,
    { cwd: doc.dir, env: { ...process.env, ...env }, slot: true });
  if (result.code === 0) {
    writeFileSync(kept.log, result.log);
    writeFileSync(kept.stamp, wanted);
  }
  return result;
}

// builds a document's PDF in outdir (relative to it) with latexmk: its exit
// code and log. Once for each PDF, as both of a document's test builds may want it
// at once
const pdfs = new Map();
export function latexmk(doc, outdir) {
  const key = join(doc.dir, outdir, doc.tex);
  if (!pdfs.has(key)) {
    pdfs.set(key, run('latexmk', ['-pdf', '-interaction=nonstopmode', `-outdir=${outdir}`, doc.tex],
      { cwd: doc.dir, slot: true }));
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
