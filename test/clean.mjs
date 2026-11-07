// Removes what one build key leaves in files when its work is done:
//   node test/clean.mjs [--dry-run] [--in <dir>]... [--each <dir>] <key>
// - <dir>/build/<key> for each --in directory and <dir>/*/build/<key> for
//   --each: the pages, screens, logs and tex4ht files of the builds with that
//   key, as test/regress.mjs's --out <dir>/build/<key> makes them. Without
//   --in, the current directory is one. --each looks only in directories
//   that hold a .tex file. A build stays when its directory holds anything
//   regress doesn't make, as another tool's may; when <dir> is a tex8web
//   checkout, which has builds of its own; when <dir>/build is a link; and
//   when a lock file in it is held, which means it is in use (the locks are
//   held while it is removed). An accepted/ directory in a build stays, as
//   it is a baseline. A build that starts while it is removed can still
//   collide with the removal;
// - the Chrome profiles in $TMPDIR (tex8webchrome plus six characters) that
//   no process uses.
// It prints what it removes, or with --dry-run what it would. It never
// removes the builds of the key main, which is for the merged checkout,
// accepted/, or a document's build/pdf, and it leaves git, the build slots'
// lock files (a lock is its holder's, so none is left behind) and everything
// else alone. It follows no link, and removes a link in place of
// build/<key> as a link.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { tryLock } from './lib/slots.mjs';

// (npm runs a script in tex8web's directory, and says where it was run from)
const at = path => resolve(process.env.npm_lifecycle_event ? process.env.INIT_CWD ?? process.cwd() : process.cwd(), path);
const usage = 'usage: node test/clean.mjs [--dry-run] [--in <dir>]... [--each <dir>] <key>';
const refuse = message => {
  console.error(message);
  process.exit(2);
};
let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: {
    'dry-run': { type: 'boolean' }, in: { type: 'string', multiple: true }, each: { type: 'string' },
  } });
} catch (error) {
  refuse(`${error.message}\n${usage}`);
}
const { values: options, positionals: [key, ...more] } = parsed;
if (key === undefined || more.length) refuse(usage);
if (!/^[A-Za-z0-9_]+$/.test(key)) refuse(`${usage}\nThe key is letters, digits and _, as in a tex8web-<key> checkout`);
const kept = { main: "the merged checkout's builds", accepted: 'the baselines', pdf: "a document's PDF" };
if (kept[key]) refuse(`build/${key} is ${kept[key]}, so it isn't cleaned`);

let removed = 0;
const remove = path => {
  removed++;
  console.log(`${options['dry-run'] ? 'would remove' : 'removed'} ${path}`);
  if (!options['dry-run']) rmSync(path, { recursive: true, force: true });
};
const kind = path => lstatSync(path, { throwIfNoEntry: false });

// each build's directory, with the one that holds it
const builds = [];
for (const dir of options.in ?? ['.']) builds.push([at(dir), join(at(dir), 'build', key)]);
if (options.each) {
  const each = at(options.each);
  for (const name of readdirSync(each).sort()) {
    const dir = join(each, name);
    if (kind(dir)?.isDirectory() && readdirSync(dir).some(file => file.endsWith('.tex'))) builds.push([dir, join(dir, 'build', key)]);
  }
}

// what a build's directory holds when it is regress.mjs's (or a wrapper's:
// rebuild.lock)
const ours = ['html', 'compare', 'logs', 'tex4ht', 'accepted', 'shots-cache', 'regress.lock', 'rebuild.lock'];
// the lock files in a directory, by looking and not by following links
const locksIn = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? locksIn(join(dir, entry.name)) : entry.isFile() && entry.name.endsWith('.lock') ? [join(dir, entry.name)] : []);

for (const [dir, build] of builds) {
  const skip = why => console.log(`skipping ${build}: ${why}`);
  if (kind(join(dir, 'build'))?.isSymbolicLink()) { console.log(`skipping ${join(dir, 'build')}: a link, so it is not followed`); continue; }
  const found = kind(build);
  if (found?.isSymbolicLink()) { remove(build); continue; }
  if (!found?.isDirectory()) continue;
  if (existsSync(join(dir, 'tex8web.mk4'))) { skip(`${dir} is a tex8web checkout, which has builds of its own`); continue; }
  const strange = readdirSync(build).filter(name => !ours.includes(name));
  if (strange.length) { skip(`it holds ${strange.join(', ')}, which regress doesn't make`); continue; }
  // the locks, all held while the build goes, so that none is taken between
  // the look and the removal (lockf -k: a lock file is not deleted)
  const held = [];
  let busy;
  try {
    for (const file of locksIn(build)) {
      const release = await tryLock(file);
      if (!release) { busy = file; break; }
      held.push(release);
    }
    if (busy) skip(`${basename(busy)} is locked, so it is in use`);
    else if (!readdirSync(build).includes('accepted')) remove(build);
    else for (const name of readdirSync(build).filter(name => name !== 'accepted')) remove(join(build, name));
  } finally {
    held.forEach(release => release());
  }
}

// a profile whose Chrome is running names itself in the command line.
// One just made may not have started its Chrome yet
const running = spawnSync('ps', ['-axo', 'command='], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
const profiles = new Set(readdirSync(tmpdir()).filter(name => /^tex8webchrome[A-Za-z0-9]{6}(\.log)?$/.test(name)).map(name => name.replace(/\.log$/, '')));
for (const name of [...profiles].sort()) {
  const path = join(tmpdir(), name);
  const recent = [path, `${path}.log`].some(file => existsSync(file) && Date.now() - statSync(file).mtimeMs < 30000);
  const used = new RegExp(`--user-data-dir=${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'm').test(running);
  if (recent || used) continue;
  for (const file of [path, `${path}.log`].filter(existsSync)) remove(file);
}
if (!removed) console.log('nothing to remove');
