// What a branch changes in the pages of the test documents. Every document
// in test/fixtures/ and examples/ is built on this checkout and at the
// commit where the branch left main (git merge-base main HEAD), and each
// pair is compared as regress.mjs compares a page with its baseline: the
// HTML with test/diff.mjs, then, if the HTML changed, the screens with
// test/shots.mjs, while other documents build.
//   node test/compare.mjs [--bases <dir>] [--out <dir>] [document names...]
// Names restrict the run to those documents. A document on one side only is
// new or removed, and is not built. The merge base is extracted with git
// archive into <bases>/<commit>/tex8web, with this checkout's node_modules,
// and built with its own test/lib/build.mjs, so with its own documents,
// configs, and tex8web. A run holds <bases>/<commit>/lock, and
// first removes each other base that no worktree's branch left main at,
// unless another run holds its lock. Exits 1 if a build or comparison
// failed, 3 if a page changed, looks different, is new, or was removed, 2
// on a usage error, without a merge base, or if the merge base has another
// package-lock.json, as it is built with this checkout's node_modules, else
// 0.
//   --bases <dir>   default build/base, holding <commit>/tex8web and
//                   shots-cache, which shots.mjs keeps as --cache
//   --out <dir>     default build/compare, holding compare/<name>
//                   (differing screens), logs/, and compare.json, which
//                   lists the names by outcome: { base, unchanged, changed,
//                   looksDifferent, new, removed, failed }
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as branch from './lib/build.mjs';
import { lock, noLockf } from './lib/slots.mjs';

const { largestFirst, pool, root, run, workers } = branch;
// npm runs a script in tex8web's directory and sets INIT_CWD to where npm
// was run
const at = path => resolve(process.env.npm_lifecycle_event ? process.env.INIT_CWD ?? process.cwd() : process.cwd(), path);
const usage = 'usage: node test/compare.mjs [--bases <dir>] [--out <dir>] [document names...]';
const refuse = message => {
  console.error(message);
  process.exit(2);
};

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { bases: { type: 'string' }, out: { type: 'string' } } });
} catch (error) {
  refuse(`${error.message}\n${usage}`);
}
const { values: options, positionals } = parsed;
const bases = at(options.bases ?? join(root, 'build/base'));
const out = at(options.out ?? join(root, 'build/compare'));
const logs = join(out, 'logs');
const here = dirname(fileURLToPath(import.meta.url));

const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
if (git('rev-parse', '--verify', '--quiet', 'refs/heads/main').status !== 0) refuse('no branch main to compare with');
const full = git('merge-base', 'main', 'HEAD').stdout.trim();
if (!full) refuse('no merge base of main and HEAD to compare with');
const commit = full.slice(0, 12);
const lockfile = spawnSync('git', ['-C', root, 'show', `${full}:package-lock.json`]).stdout;
if (!lockfile.equals(readFileSync(join(root, 'package-lock.json')))) {
  refuse(`tex8web ${commit}, where this branch left main, has another package-lock.json, so it cannot be built with this checkout's node_modules`);
}

// the bases that no worktree's branch, nor this run, left main at, each
// unless another run holds its lock. Only directories named as commits, as
// shots-cache is there too
const keep = new Set([commit, ...(git('worktree', 'list', '--porcelain').stdout.match(/^HEAD \w+$/gm) ?? [])
  .map(line => git('merge-base', 'main', line.slice(5)).stdout.slice(0, 12))]);
for (const name of existsSync(bases) ? readdirSync(bases) : []) {
  const dir = join(bases, name);
  if (!/^[0-9a-f]{12}$/.test(name) || keep.has(name) || !statSync(dir).isDirectory()) continue;
  if (noLockf()) rmSync(dir, { recursive: true, force: true });
  else spawnSync('lockf', ['-k', '-t', '0', join(dir, 'lock'), 'rm', '-rf', dir]);
}

// (held for the whole run, so that no other run extracts or prunes the base
// while it is built and compared with. 75 is lockf's exit when busy)
const dir = join(bases, commit), tree = join(dir, 'tex8web');
mkdirSync(dir, { recursive: true });
if (!noLockf() && spawnSync('lockf', ['-k', '-t', '0', join(dir, 'lock'), 'true']).status === 75) {
  console.error(`waiting for another run with the base ${commit}`);
}
await lock(join(dir, 'lock'));
if (!existsSync(tree)) {
  console.error(`extracting tex8web ${commit} into ${tree}`);
  const staged = `${tree}.new`;
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(staged);
  const archive = spawnSync('git', ['-C', root, 'archive', full], { maxBuffer: 2 ** 30, stdio: ['ignore', 'pipe', 'inherit'] });
  if (archive.status !== 0 || spawnSync('tar', ['-x', '-C', staged], { input: archive.stdout, stdio: ['pipe', 'inherit', 'inherit'] }).status !== 0) {
    console.error(`could not extract tex8web ${commit} into ${staged}`);
    process.exit(1);
  }
  symlinkSync(realpathSync(join(root, 'node_modules')), join(staged, 'node_modules'));
  renameSync(staged, tree);
}
const base = await import(pathToFileURL(join(tree, 'test/lib/build.mjs')).href);

const sides = { base: new Map(base.documents().map(doc => [doc.name, doc])), branch: new Map(branch.documents().map(doc => [doc.name, doc])) };
const names = positionals.length ? [...new Set(positionals)] : [...new Set([...sides.branch.keys(), ...sides.base.keys()])].sort();
const unknown = names.filter(name => !sides.base.has(name) && !sides.branch.has(name));
if (unknown.length) refuse(`no document named ${unknown.join(', ')} on this checkout or at ${commit}`);

mkdirSync(logs, { recursive: true });
console.error(`building ${names.length} document(s) on this checkout and at ${commit}`);
const started = Date.now();
const safe = name => name.replace(/[^A-Za-z0-9]/g, '_');
const where = { base: `at ${commit}`, branch: 'on this checkout' };

// Builds a document with the arguments of run.mjs's main build, so that a
// build by npm test is reused. Resolves to its page and why it failed
async function side(lib, key, name) {
  const doc = sides[key].get(name), html = join(lib.testDir(doc), 'html');
  const result = await lib.build(doc, html, join(lib.testDir(doc), 'aux'), { TEX8WEB_MATHML: '1' });
  const log = join(logs, `${safe(name)}.${key}.log`);
  writeFileSync(log, result.log);
  return { html, failed: result.code !== 0 && `failed to build ${where[key]}, exit ${result.code} (log: ${log})` };
}

async function compare(name) {
  if (!sides.base.has(name)) return { name, kind: 'new', outcome: `new: no page at ${commit}` };
  if (!sides.branch.has(name)) return { name, kind: 'removed', outcome: 'removed: no page on this checkout' };
  rmSync(join(out, 'compare', safe(name)), { recursive: true, force: true });
  const old = await side(base, 'base', name), now = await side(branch, 'branch', name);
  if (old.failed || now.failed) return { name, kind: 'failed', outcome: [old.failed, now.failed].filter(Boolean).join('; ') };
  const diff = await run(process.execPath, [join(here, 'diff.mjs'), old.html, now.html]);
  const log = join(logs, `${safe(name)}.diff`);
  writeFileSync(log, diff.log);
  if (diff.code === 0) return { name, kind: 'unchanged', outcome: 'unchanged' };
  if (diff.code !== 1) return { name, kind: 'failed', outcome: `could not compare the HTML: ${diff.log.trim().split('\n').pop()} (log: ${log})` };
  const files = [...diff.log.matchAll(/^(changed|added|removed) (.+)$/gm)].map(([, verb, file]) => verb === 'changed' ? file : `${file} (${verb})`);
  return { name, kind: 'changed', old: old.html, now: now.html,
    outcome: `changed: ${files.slice(0, 6).join(', ')}${files.length > 6 ? ` and ${files.length - 6} more` : ''}` };
}

// Compares the screens of a changed page as soon as the pair is built, as
// regress.mjs does. shots.mjs launches a separate Chrome, which holds a
// build slot like a build
async function screens(result) {
  console.error(`${result.name}: comparing the screens`);
  const shots = await run(process.execPath, [join(here, 'shots.mjs'), '--cache', join(bases, 'shots-cache'),
    join(out, 'compare', safe(result.name)), result.old, result.now], { slot: true, total: 3600 });
  const log = join(logs, `${safe(result.name)}.shots.log`);
  writeFileSync(log, shots.log);
  if (shots.code === 1) {
    result.kind = 'looks';
    result.outcome = `looks different: ${shots.log.trim().split('\n').filter(line => /: (screens .* differ|differs from screen|only in )/.test(line))
      .map(line => line.replace(/: screens (.*?) of \d+ differ.*$/, ' (screens $1)').replace(/: differs from screen (\d+) of .*$/, ' (from screen $1)')).join('; ')}`;
  } else if (shots.code !== 0) {
    result.kind = 'failed';
    result.outcome += `; could not compare the screens: ${shots.log.trim().split('\n').pop()} (log: ${log})`;
  }
}

const order = largestFirst(names.map(name => sides.branch.get(name) ?? sides.base.get(name))).map(doc => doc.name);
const results = await pool(order, workers, async name => {
  const result = await compare(name);
  // not awaited, so the next pair builds meanwhile
  if (result.kind === 'changed') result.shots = screens(result);
  return result;
});
await Promise.all(results.map(result => result.shots));

const byName = new Map(results.map(result => [result.name, result]));
for (const name of names) console.log(`${name}: ${byName.get(name).outcome}`);
const kinds = { unchanged: 'unchanged', changed: 'changed', looksDifferent: 'looks', new: 'new', removed: 'removed', failed: 'failed' };
const listed = Object.fromEntries(Object.entries(kinds).map(([key, kind]) => [key, results.filter(r => r.kind === kind).map(r => r.name).sort()]));
writeFileSync(join(out, 'compare.json'), `${JSON.stringify({ base: commit, ...listed }, null, 2)}\n`);
console.log(`${results.length} document(s): ${listed.unchanged.length} unchanged, ${listed.changed.length} changed, `
  + `${listed.looksDifferent.length} look different, ${listed.new.length} new, ${listed.removed.length} removed, ${listed.failed.length} failed`);
console.log(`pages at ${commit} in ${join(tree, 'build/test')}, on this checkout in ${join(root, 'build/test')}`);
console.log(`differing screens in ${join(out, 'compare')}, logs in ${logs}, outcomes in ${join(out, 'compare.json')}`);
console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
process.exit(listed.failed.length ? 1 : results.some(r => r.kind !== 'unchanged') ? 3 : 0);
