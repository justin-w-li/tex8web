#!/usr/bin/env node
// Runs a command in the image of tex8web's Dockerfile, for a document whose
// source is not trusted:
//   test/lib/contain.mjs [-t seconds] [-m memory] [-r path]... [-w dir]... -- command args...
// The command runs in the current directory, with no network, no shell
// escape, and limits on time (default 900 s), memory (default 2g),
// processes, and file size. Mounted at the same paths inside, read-only:
// tex8web, its node_modules, the current directory, and each -r path. Each
// -w directory is mounted writable, and /tmp is empty. Only TEX8WEB_*,
// SOURCE_DATE_EPOCH, and FORCE_SOURCE_DATE are passed from the environment.
// The image is built when its tag, a hash of the Dockerfile, is missing.
// Exits with the command's status, after a line on stderr if a limit
// stopped it.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const usage = 'usage: test/lib/contain.mjs [-t seconds] [-m memory] [-r path]... [-w dir]... -- command args...';
const refuse = message => {
  console.error(message);
  process.exit(2);
};

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: {
    t: { type: 'string', short: 't', default: '900' }, m: { type: 'string', short: 'm', default: '2g' },
    r: { type: 'string', short: 'r', multiple: true, default: [] }, w: { type: 'string', short: 'w', multiple: true, default: [] },
  } });
} catch (error) {
  refuse(`${error.message}\n${usage}`);
}
const { values: { t: time, m: memory, r: read, w: write }, positionals: command } = parsed;
if (!command.length) refuse(usage);
for (const dir of write) if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) refuse(`contain: not a directory: ${dir}`);

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

// build.mjs's run() kills its process group with SIGKILL, which ends the
// docker client but not the container. So a watcher in a session of its
// own removes the container once this process is gone
const name = `t8w-${process.pid}-${randomBytes(4).toString('hex')}`;
const watcher = spawn('perl', ['-e', 'my $parent = getppid; select undef, undef, undef, 0.5 while getppid == $parent; exec qw(docker rm -f), @ARGV',
  name], { detached: true, stdio: 'ignore' });

// (fsize is in bytes. A bind mount has no size limit, so this caps each
// file, and the time limit a flood of small files)
const child = spawn('docker', ['run', '--rm', '--init', '--name', name, '--network', 'none', '--read-only',
  '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--pids-limit', '256', '--cpus', '2', '--memory', memory, '--memory-swap', memory, '--ulimit', 'fsize=1073741824',
  '--user', `${process.getuid()}:${process.getgid()}`, '-e', 'HOME=/tmp', '-e', 'TEXMFVAR=/tmp/texmf-var',
  '-e', 'shell_escape=f', '-e', 'openout_any=p', '-e', 'LANG=C.UTF-8',
  ...Object.keys(process.env).filter(name => /^(TEX8WEB_|SOURCE_DATE_EPOCH$|FORCE_SOURCE_DATE$)/.test(name)).flatMap(name => ['-e', name]),
  ...[...mounts].flatMap(([path, mode]) => ['--mount', `type=bind,source=${path},target=${path}${mode}`]),
  '-w', process.cwd(), image, 'timeout', '-k', '5', time, ...command], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  watcher.kill();
  // (timeout exits with 124 at the time limit. A process killed for memory
  // ends with SIGKILL, 128 plus 9)
  if (code === 124) console.error(`contain: stopped at the time limit of ${time} s`);
  if (code === 137) console.error(`contain: stopped at the memory limit of ${memory}`);
  process.exit(code ?? 128 + constants.signals[signal]);
});
