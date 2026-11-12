// The checks of the container for sources that are not trusted: each
// document in test/contain/<case>/ attacks the host, and is built through
// lib/build.mjs with the runner, lib/contain.mjs, which must stop the
// attack or leave it without effect. Needs Docker, so it is not part of
// npm test or CI.
//   node test/contain.mjs [case...]
// A case passes when its build fails if it must, its logs have the
// expected line, no file appeared in its directory, in tex8web's
// directory, or in a scratch directory on the host, and no container is
// left. The kill case builds loop in another
// process, and kills that process once its container runs. These
// documents are built only through the runner, never on the host.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build, root } from './lib/build.mjs';

if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  console.error('test/contain.mjs needs Docker, and docker info failed: start Docker and run it again');
  process.exit(2);
}

// (under tex8web's build directory: Docker Desktop on macOS can fail to
// mount a directory that was removed and made again under /private/tmp)
const base = join(root, 'build/contain');
const scratch = join(base, 'scratch');
mkdirSync(scratch, { recursive: true });

// fails: the build must fail. line: in its log, or in a TeX or biber log
const cases = {
  write18: { line: /runsystem\(touch build\/escaped-write18\)\.\.\.disabled/ },
  openout: { fails: true, line: /! I can't write on file `\/.*/ },
  openouthost: { fails: true, line: /! I can't write on file `\/.*/ },
  make4ht: { line: /contain case: escaped-make4ht: Read-only file system\n.*contain case: \.\.\/\.\.\/\.\.\/escaped-make4ht: Read-only file system/ },
  network: { line: /Could not fetch .*example\.org/ },
  loop: { fails: true, line: /contain: stopped at the time limit of 20 s/ },
  memory: { fails: true, limits: ['-m', '256m'], line: /contain: a process was stopped at the memory limit of 256m/ },
  forkbomb: { line: /sh: 1: Cannot fork/ },
  buildlink: { fails: true, line: /contain: refusing to mount .*buildlink\/build: it is missing, or a symbolic link is in its path/ },
  outputlink: { fails: true, line: /contain: the command left a symbolic link in the output: .*escaped-link/ },
};

const containers = () => spawnSync('docker', ['ps', '-aq', '--filter', 'name=t8w-'], { encoding: 'utf8' }).stdout.trim();
const listing = dir => readdirSync(dir).filter(name => name !== 'build').sort().join('\n');

// builds a case, and resolves to why it failed, or to its line
async function check(name) {
  const { fails, limits = [], line } = cases[name];
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
    const result = await build(doc, out, aux);
    const logs = [result.log, ...existsSync(aux) ? readdirSync(aux).filter(file => /\.(log|blg)$/.test(file))
      .map(file => readFileSync(join(aux, file), 'latin1')) : []].join('\n');
    if (fails && result.code === 0) return 'built';
    if (fails && existsSync(`${out}.stamp`)) return 'a stamp was written';
    const found = logs.match(line);
    if (!found) return `no line ${line} in:\n${result.log.trim().split('\n').slice(-8).join('\n')}`;
    if (listing(dir) !== before[0]) return `a file appeared in ${dir}`;
    // (the build directory is writable, so the attacks name their files)
    if (readdirSync(join(dir, 'build')).some(file => file.startsWith('escaped'))) return `a file appeared in ${join(dir, 'build')}`;
    if (listing(root) !== before[1]) return `a file appeared in ${root}`;
    if (readdirSync(scratch).length) return `a file appeared in ${scratch}`;
    if (containers()) return `a container was left: ${containers()}`;
    return { line: found[0].split('\n').pop() };
  } finally {
    if (name === 'buildlink') rmSync(join(dir, 'build'));
  }
}

// builds loop in another process, and ends that process once its
// container runs: build.mjs then kills the runner's process group with
// SIGKILL, as run() does with a hung command
async function kill() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'loop'], { stdio: 'ignore' });
  for (let i = 0; i < 120 && !containers(); i++) await sleep(500);
  if (!containers()) return 'no container started';
  child.kill('SIGTERM');
  for (let i = 0; i < 10 && containers(); i++) await sleep(500);
  return containers() ? `a container was left 5 s after the kill: ${containers()}` : { line: 'no container left' };
}

const names = process.argv.slice(2);
const unknown = names.filter(name => !cases[name] && name !== 'kill');
if (unknown.length) {
  console.error(`no case named ${unknown.join(', ')}; the cases are ${[...Object.keys(cases), 'kill'].join(', ')}`);
  process.exit(2);
}
if (containers()) {
  console.error(`a t8w- container is running already, so no case could tell its own: ${containers()}`);
  process.exit(2);
}
let failures = 0;
for (const name of names.length ? names : [...Object.keys(cases), 'kill']) {
  const started = Date.now();
  const result = name === 'kill' ? await kill() : await check(name);
  const time = `${Math.round((Date.now() - started) / 1000)} s`;
  if (typeof result === 'string') failures++;
  console.log(typeof result === 'string' ? `not ok - ${name} (${time}): ${result}` : `ok - ${name} (${time}): ${result.line}`);
}
process.exit(failures ? 1 : 0);
