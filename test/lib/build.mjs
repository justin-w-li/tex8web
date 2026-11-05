// Building the test documents and examples with make4ht, for the tests and
// for npm run examples.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// the problems a document is known to have (test/expected.json)
export const expected = JSON.parse(readFileSync(join(root, 'test/expected.json'), 'utf8'));

// where a test (npm test's, or test:visual's in build/visual) builds a
// document
export const testDir = (doc, base = 'test') => join(root, 'build', base, doc.name.replace(/[^A-Za-z0-9]/g, '_'));

// test/fixtures/*.tex and examples/*/main.tex, each with its config: the
// document's own <name>.cfg if it has one, otherwise tex8web.cfg
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
      cfg: existsSync(own) ? own : join(root, 'tex8web.cfg') });
  }
  return docs;
}

// the documents largest first, so that the longest build doesn't hold up
// the end
export const largestFirst = docs => docs.map(doc => [doc, statSync(join(doc.dir, doc.tex)).size])
  .sort((a, b) => b[1] - a[1]).map(([doc]) => doc);

// builds at once: a build runs mostly on one core, and four leave the rest
// of the machine to other work (a laptop's performance cores are often four)
export const workers = Math.min(4, Math.max(2, availableParallelism() >> 1));

// builds running, each in a process group of its own (so that one that
// hangs is killed with what it started: LaTeX, Node, dvisvgm), which Ctrl-C
// doesn't reach: killed as this process ends, unless it is killed outright
const running = new Set();
const kill = pid => { try { process.kill(-pid, 'SIGKILL'); } catch {} };
process.on('exit', () => running.forEach(kill));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(1));
// a build taking longer has hung (the longest test build takes under a
// minute)
const deadline = 300;

// runs bin/tex8web on a document, with the page in out and tex4ht's files
// in aux (both absolute). make4ht reads the -B directory as a Lua pattern
// when it copies to -d, so it is passed relative to the document, where
// characters like - in the path above don't matter
export async function build(doc, out, aux, env = {}) {
  // the PDF a config links with \WebPDF, if it isn't built yet
  const pdf = readFileSync(doc.cfg, 'utf8').match(/^\\WebPDF\{([^}]+)\}/m)?.[1];
  if (pdf && !existsSync(join(doc.dir, pdf))) {
    const code = await latexmk(doc, dirname(pdf));
    if (code !== 0) return { code, log: `latexmk exited with ${code}` };
  }
  rmSync(out, { recursive: true, force: true });
  rmSync(aux, { recursive: true, force: true });
  // (make4ht's own mkdir fails when two builds make the same parent at once)
  mkdirSync(aux, { recursive: true });
  const args = ['-c', relative(doc.dir, doc.cfg), '-B', relative(doc.dir, aux), '-d', relative(doc.dir, out), doc.tex];
  return new Promise(done => {
    const child = spawn(join(root, 'bin/tex8web'), args, { cwd: doc.dir, env: { ...process.env, ...env }, detached: true });
    running.add(child.pid);
    let log = '';
    const timer = setTimeout(() => {
      log += `\n[FATAL] make4ht timed out after ${deadline}s, at: ${log.trim().split('\n').pop()}\n`;
      kill(child.pid);
    }, deadline * 1000);
    child.stdout.on('data', d => log += d);
    child.stderr.on('data', d => log += d);
    child.on('close', code => {
      clearTimeout(timer);
      running.delete(child.pid);
      done({ code, log: log.replace(/\x1b\[[0-9;]*m/g, '') });
    });
  });
}

// builds a document's PDF in outdir (relative to it) with latexmk: its exit
// code. Once for each PDF, as both of a document's test builds may want it
// at once
const pdfs = new Map();
export function latexmk(doc, outdir) {
  const key = join(doc.dir, outdir, doc.tex);
  if (!pdfs.has(key)) {
    pdfs.set(key, new Promise(done => spawn('latexmk', ['-pdf', '-interaction=nonstopmode', `-outdir=${outdir}`, doc.tex],
      { cwd: doc.dir, stdio: 'ignore' }).on('close', done)));
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
