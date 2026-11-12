#!/usr/bin/env node
// Runs a command in the image of tex8web's Dockerfile, for a document whose
// source is not trusted:
//   test/lib/contain.mjs [-t seconds] [-m memory] [-r path]... [-w dir]... -- command args...
//   test/lib/contain.mjs --clean [-w dir]...
// The command runs in the current directory, with no network, no shell
// escape, and limits on time (default 900 s), memory (default 2g),
// processes, and file size. Mounted at the same paths inside, read-only:
// tex8web, its node_modules, the current directory, and each -r path. Each
// -w directory is mounted writable, and /tmp is empty. A mount whose path
// holds a symbolic link is refused. Only TEX8WEB_*, SOURCE_DATE_EPOCH, and
// FORCE_SOURCE_DATE are passed from the environment. The image is built
// when its tag, a hash of the Dockerfile, is missing. After the command,
// and alone with --clean, the -w directories are cleaned: any container
// that ran a command on them is removed, and then, in another container,
// the owner is given read and write on everything in them, and everything
// but files and directories is removed, and every path of 1000 bytes or
// more. Exits with the command's status, after a line on stderr if a limit
// stopped it, and nonzero if a process was killed for memory or the
// cleaning removed anything.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const usage = 'usage: test/lib/contain.mjs [-t seconds] [-m memory] [-r path]... [-w dir]... -- command args...\n'
  + '       test/lib/contain.mjs --clean [-w dir]...';
const refuse = message => {
  console.error(message);
  process.exit(2);
};

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: {
    t: { type: 'string', short: 't', default: '900' }, m: { type: 'string', short: 'm', default: '2g' },
    r: { type: 'string', short: 'r', multiple: true, default: [] }, w: { type: 'string', short: 'w', multiple: true, default: [] },
    clean: { type: 'boolean' },
  } });
} catch (error) {
  refuse(`${error.message}\n${usage}`);
}
const { values: { t: time, m: memory, r: read, w: write, clean: cleanOnly }, positionals: command } = parsed;
if (!command.length === !cleanOnly) refuse(usage);
for (const dir of write) if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) refuse(`contain: not a directory: ${dir}`);
// (Docker Desktop follows a symbolic link in a mount's source on the host,
// so a source that holds build -> /Users/<you> would have that mounted)
const real = path => { try { return realpathSync(path); } catch { return null; } };
for (const path of [process.cwd(), ...read, ...write]) {
  if (real(path) !== resolve(path)) {
    refuse(`contain: refusing to mount ${path}: it is missing, or a symbolic link is in its path`);
  }
}

// (one mount for each path, as docker refuses two at one place. A worktree's
// node_modules is a link to another checkout's, so the link's target is
// mounted)
const mounts = new Map();
for (const path of [root, realpathSync(join(root, 'node_modules')), process.cwd(), ...read]) mounts.set(resolve(path), ',readonly');
for (const path of write) mounts.set(resolve(path), '');

const dockerfile = readFileSync(join(root, 'Dockerfile'));
const image = `tex8web-tools:${createHash('sha256').update(dockerfile).digest('hex').slice(0, 12)}`;
if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) {
  console.error(`contain: building the image ${image}`);
  // (without a build context, as the Dockerfile copies nothing)
  const built = spawnSync('docker', ['build', '-t', image, '-'], { input: dockerfile, stdio: ['pipe', 2, 2] });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

// (what both containers are limited to. fsize, in bytes, caps each file,
// not their number, and a bind mount has no size limit. /tmp allows exec,
// as biber unpacks itself there and runs from there, and the writable
// mounts allow it anyway)
const limited = ['--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,exec,nosuid,size=512m', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--cpus', '2', '--memory', memory, '--memory-swap', memory,
  '--ulimit', 'fsize=1073741824', '--user', `${process.getuid()}:${process.getgid()}`, '-e', 'LANG=C.UTF-8'];
const writable = write.flatMap(dir => ['--mount', `type=bind,source=${resolve(dir)},target=${resolve(dir)}`]);
// (the command's container is labeled by its -w directories, so that
// --clean finds it after this process was killed)
const label = `t8w.out=${createHash('sha256').update(write.map(dir => resolve(dir)).sort().join('\n')).digest('hex').slice(0, 12)}`;

// removes the containers of commands on the -w directories, and then, in a
// container with only those directories mounted, cleans them, with GNU
// tools, which follow no link and go to any depth. The tools on the host
// would follow a link, block on a FIFO, fail on what the command made
// unreadable, and fail on a path longer than macOS's limit of 1024 bytes.
// Returns whether anything was removed, or the cleaning failed
function clean() {
  if (!write.length) return false;
  const left = spawnSync('docker', ['ps', '-aq', '--filter', `label=${label}`], { encoding: 'utf8' }).stdout.trim();
  if (left) spawnSync('docker', ['rm', '-f', ...left.split('\n')], { stdio: 'ignore' });
  const script = 'long=$(printf "%1000s" "" | tr " " "?"); for dir; do chmod -R u+rwX "$dir"; '
    + 'find "$dir" \\( -path "$long*" -prune -o ! -type f ! -type d \\) -print -exec rm -rf {} +; done';
  // (timeout fails, silently, as the container's first process)
  const result = spawnSync('docker', ['run', '--rm', '--init', ...limited, ...writable, image, 'timeout', '-k', '5', time, 'sh', '-c', script, 'sh',
    ...write.map(dir => resolve(dir))], { encoding: 'utf8', stdio: ['ignore', 'pipe', 2] });
  for (const path of result.stdout.split('\n').filter(Boolean)) {
    console.error(`contain: removed what the command left in the output, not a file or directory, or too deep: ${path}`);
  }
  return result.status !== 0 || result.stdout !== '';
}
if (cleanOnly) process.exit(clean() ? 1 : 0);

// build.mjs's run() kills its process group with SIGKILL, which ends the
// docker client but not the container. So a watcher in a session of its
// own removes the container once this process is gone
const name = `t8w-${process.pid}-${randomBytes(4).toString('hex')}`;
const watcher = spawn('perl', ['-e', 'my $parent = shift; select undef, undef, undef, 0.5 while getppid == $parent; exec qw(docker rm -f), @ARGV',
  process.pid, name], { detached: true, stdio: 'ignore' });

// (not --rm, so that the container's state can be read after it ends)
const started = Date.now();
const child = spawn('docker', ['run', '--init', '--name', name, '--label', label, ...limited,
  '-e', 'HOME=/tmp', '-e', 'TEXMFVAR=/tmp/texmf-var', '-e', 'shell_escape=f', '-e', 'openout_any=p',
  ...Object.keys(process.env).filter(name => /^(TEX8WEB_|SOURCE_DATE_EPOCH$|FORCE_SOURCE_DATE$)/.test(name)).flatMap(name => ['-e', name]),
  ...[...mounts].flatMap(([path, mode]) => ['--mount', `type=bind,source=${path},target=${path}${mode}`]),
  '-w', process.cwd(), image, 'timeout', '-k', '5', time, ...command], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  // (OOMKilled is set when any process in the container was killed for
  // memory, even one whose parent went on)
  const oom = spawnSync('docker', ['inspect', '-f', '{{.State.OOMKilled}}', name], { encoding: 'utf8' }).stdout.trim() === 'true';
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  watcher.kill();
  // (timeout exits with 124 at the time limit, or 137 when it had to kill a
  // command that ignored SIGTERM)
  if (oom) console.error(`contain: a process was stopped at the memory limit of ${memory}`);
  else if (code === 124 || code === 137 && Date.now() - started >= time * 1000) console.error(`contain: stopped at the time limit of ${time} s`);
  const removed = clean();
  const status = code ?? 128 + constants.signals[signal];
  process.exit(status || (oom || removed ? 1 : 0));
});
