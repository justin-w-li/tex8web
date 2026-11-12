// The checks of the container for sources that are not trusted: each
// document in test/contain/<case>/ attacks the host, and is built through
// lib/build.mjs with the runner, lib/contain.mjs, which must stop the
// attack or leave it without effect. Needs Docker, so it is not part of
// npm test or CI.
//   node test/contain.mjs [case...]
// A case passes when its build fails if it must, its logs have the
// expected line, no file appeared in its directory, in tex8web's
// directory, or in a scratch directory on the host, and no container is
// left. Three cases differ: bibindex builds a test fixture, which must
// build and match its build on the host; pdflock gives regress.mjs a
// source with a link as its PDF lock; kill builds loop in another process,
// and kills that process once its container runs. The documents in
// test/contain are built only through the runner, never on the host.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build, root, select } from './lib/build.mjs';

if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  console.error('test/contain.mjs needs Docker, and docker info failed: start Docker and run it again');
  process.exit(2);
}

// (the outputs under tex8web's build directory: Docker Desktop on macOS can
// fail to mount a directory that was removed and made again under
// /private/tmp. The scratch directory, never mounted, holds a file for
// inputhost)
const base = join(root, 'build/contain');
mkdirSync(base, { recursive: true });
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webcontain')));
process.on('exit', () => rmSync(scratch, { recursive: true }));
writeFileSync(join(scratch, 'secret.tex'), 'Secret.\n');

// fails: the build must fail. line: in its log, or in a TeX or biber log.
// twice: built again, on what the first build left
const cases = {
  write18: { line: /runsystem\(touch build\/escaped-write18\)\.\.\.disabled/ },
  openout: { fails: true, line: /! I can't write on file `\/.*/ },
  openouthost: { fails: true, line: /! I can't write on file `\/.*/ },
  make4ht: { line: /contain case: escaped-make4ht: Read-only file system\n.*contain case: \.\.\/\.\.\/\.\.\/escaped-make4ht: Read-only file system/ },
  network: { line: /Could not fetch .*example\.org/ },
  loop: { fails: true, line: /contain: stopped at the time limit of 20 s/ },
  memory: { fails: true, limits: ['-m', '256m'], line: /contain: a process was stopped at the memory limit of 256m/ },
  forkbomb: { line: /sh: 1: Cannot fork/ },
  buildlink: { fails: true, line: /refusing to build buildlink: .*buildlink\/build is not a file or directory/ },
  outputlink: { fails: true, line: /contain: removed what the command left in the output, not a file or directory: .*escaped-link/ },
  luahost: { line: /contain case: .*escaped-luahost: No such file or directory/ },
  // (TeX wraps the path in its log)
  inputhost: { fails: true, line: /! LaTeX Error: File `\/[^']*' not found/ },
  fifo: { fails: true, twice: true, line: /contain: removed what the command left in the output, not a file or directory: .*escaped-closed\/escaped-fifo/ },
};

const containers = () => spawnSync('docker', ['ps', '-aq', '--filter', 'name=t8w-'], { encoding: 'utf8' }).stdout.trim();
const listing = dir => readdirSync(dir).filter(name => name !== 'build').sort().join('\n');

// builds a case, and resolves to why it failed, or to its line
async function check(name) {
  const { fails, limits = [], line, twice } = cases[name];
  const dir = join(root, 'test/contain', name), out = join(base, name, 'html'), aux = join(base, name, 'aux');
  rmSync(join(base, name), { recursive: true, force: true });
  rmSync(join(dir, 'build'), { recursive: true, force: true });
  if (name === 'buildlink') symlinkSync(scratch, join(dir, 'build'));
  // (the paths that openout writes to, in a config outside the document)
  const cfg = join(base, `${name}.cfg`);
  writeFileSync(cfg, `\\def\\ContainSource{${dir}}\\def\\ContainScratch{${scratch}}\n${readFileSync(join(root, 'tex8web.cfg'), 'utf8')}`);
  const before = [listing(dir), listing(root)];
  try {
    const doc = { name, dir, tex: 'main.tex', cfg, runner: [join(root, 'test/lib/contain.mjs'), '-t', '20', ...limits] };
    let found;
    for (let i = 0; i < (twice ? 2 : 1); i++) {
      const result = await build(doc, out, aux, { TEX8WEB_CONTAIN_SCRATCH: scratch });
      const logs = [result.log, ...existsSync(aux) ? readdirSync(aux).filter(file => /\.(log|blg)$/.test(file))
        .map(file => readFileSync(join(aux, file), 'latin1')) : []].join('\n');
      if (fails && result.code === 0) return 'built';
      if (fails && existsSync(`${out}.stamp`)) return 'a stamp was written';
      found = logs.match(line);
      if (!found) return `no line ${line} in build ${i + 1}:\n${result.log.trim().split('\n').slice(-8).join('\n')}`;
    }
    if (listing(dir) !== before[0]) return `a file appeared in ${dir}`;
    // (the build directory is writable, so the attacks name their files)
    if (readdirSync(join(dir, 'build')).some(file => file.startsWith('escaped'))) return `a file appeared in ${join(dir, 'build')}`;
    if (listing(root) !== before[1]) return `a file appeared in ${root}`;
    if (readdirSync(scratch).join() !== 'secret.tex') return `a file appeared in ${scratch}`;
    if (containers()) return `a container was left: ${containers()}`;
    return { line: found[0].split('\n').pop() };
  } finally {
    if (name === 'buildlink') rmSync(join(dir, 'build'));
  }
}

// builds the bibliography and index fixture through the runner and on the
// host: the page must have its citation, index, and math, and match
async function bibindex() {
  const [doc] = select(['test-bibindex']);
  const html = {};
  for (const [key, runner] of [['bibhost'], ['bibindex', [join(root, 'test/lib/contain.mjs')]]]) {
    rmSync(join(base, key), { recursive: true, force: true });
    const result = await build({ ...doc, runner }, join(base, key, 'html'), join(base, key, 'aux'));
    if (result.code !== 0) return `the ${key} build exited with ${result.code}:\n${result.log.trim().split('\n').slice(-8).join('\n')}`;
    html[key] = readFileSync(join(base, key, 'html/test-bibindex.html'), 'utf8');
  }
  for (const part of [/<a href='#Xgroups'>1<\/a>/, /<div class='index-subitem'>order, /, /<mjx-container/])
    if (!part.test(html.bibindex)) return `no ${part} in the contained page`;
  const diff = spawnSync(process.execPath, [join(root, 'test/diff.mjs'), join(base, 'bibhost/html'), join(base, 'bibindex/html')], { encoding: 'utf8' });
  if (diff.status !== 0) return `the pages differ:\n${diff.stdout}${diff.stderr}`;
  return { line: 'built, with its citation, index, and math, the same as on the host' };
}

// gives regress.mjs --contain a source whose build/pdf.lock is a link to
// the scratch directory: it must refuse the source before writing anything
async function pdflock() {
  const dir = join(root, 'test/contain/pdflock'), out = join(base, 'pdflock');
  rmSync(join(dir, 'build'), { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(dir, 'build'));
  symlinkSync(join(scratch, 'escaped-lock'), join(dir, 'build/pdf.lock'));
  try {
    const result = spawnSync(process.execPath, [join(root, 'test/regress.mjs'), '--contain', '--latexmk', '--out', out, dir], { encoding: 'utf8' });
    const found = result.stderr.match(/refusing .*pdflock\/build\/pdf\.lock is not a file or directory/);
    if (result.status !== 2 || !found) return `regress.mjs exited with ${result.status}:\n${result.stdout}${result.stderr}`;
    if (existsSync(out)) return `${out} was made`;
    if (readdirSync(scratch).join() !== 'secret.tex') return `a file appeared in ${scratch}`;
    return { line: found[0] };
  } finally {
    rmSync(join(dir, 'build'), { recursive: true });
  }
}

// builds loop in another process, and ends that process once its
// container runs: build.mjs then kills the runner's process group with
// SIGKILL, as run() does with a hung command
async function kill() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'loop'], { stdio: 'ignore' });
  for (let i = 0; i < 120 && !containers(); i++) await sleep(500);
  if (!containers()) {
    child.kill();
    return 'no container started';
  }
  child.kill('SIGTERM');
  for (let i = 0; i < 10 && containers(); i++) await sleep(500);
  return containers() ? `a container was left 5 s after the kill: ${containers()}` : { line: 'no container left' };
}

const others = { bibindex, pdflock, kill };
const all = [...Object.keys(cases), ...Object.keys(others)];
const names = process.argv.slice(2);
const unknown = names.filter(name => !all.includes(name));
if (unknown.length) {
  console.error(`no case named ${unknown.join(', ')}; the cases are ${all.join(', ')}`);
  process.exit(2);
}
if (containers()) {
  console.error(`a t8w- container is running already, so no case could tell its own: ${containers()}`);
  process.exit(2);
}
// (the image is built once, before the cases, rather than inside the first
// case's time limit)
if (spawnSync(join(root, 'test/lib/contain.mjs'), ['--', 'true'], { stdio: ['ignore', 2, 2] }).status !== 0) {
  console.error('the container did not run');
  process.exit(1);
}
let failures = 0;
for (const name of names.length ? names : all) {
  const started = Date.now();
  const result = others[name] ? await others[name]() : await check(name);
  const time = `${Math.round((Date.now() - started) / 1000)} s`;
  if (typeof result === 'string') failures++;
  console.log(typeof result === 'string' ? `not ok - ${name} (${time}): ${result}` : `ok - ${name} (${time}): ${result.line}`);
}
process.exit(failures ? 1 : 0);
