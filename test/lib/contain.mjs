#!/usr/bin/env node
// Runs a command in the image of tex8web's Dockerfile, for a document whose
// source is not trusted:
//   test/lib/contain.mjs [-t seconds] [-m memory] [-r path]... [-w dir]... -- command args...
// The command runs in the current directory, with no network, no shell
// escape, and limits on time (default 900 s), memory (default 2g),
// processes, and file size. Mounted at the same paths inside, read-only:
// tex8web, its node_modules, the current directory, and each -r path. Each
// -w directory is mounted writable, and /tmp is empty. A mount whose path
// holds a symbolic link is refused. Only TEX8WEB_*, SOURCE_DATE_EPOCH, and
// FORCE_SOURCE_DATE are passed from the environment. The image is built
// when its tag, a hash of the Dockerfile, is missing. Exits with the
// command's status, after a line on stderr if a limit stopped it, and
// nonzero if a process was killed for memory or the command left in a -w
// directory something other than files and directories, which is removed.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
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

// build.mjs's run() kills its process group with SIGKILL, which ends the
// docker client but not the container. So a watcher in a session of its
// own removes the container once this process is gone
const name = `t8w-${process.pid}-${randomBytes(4).toString('hex')}`;
const watcher = spawn('perl', ['-e', 'my $parent = shift; select undef, undef, undef, 0.5 while getppid == $parent; exec qw(docker rm -f), @ARGV',
  process.pid, name], { detached: true, stdio: 'ignore' });

// (fsize, in bytes, caps each file, not their number, and a bind mount has
// no size limit. /tmp allows exec, as biber unpacks itself there and runs
// from there, and the writable mounts allow it anyway. Not --rm, so that
// the container's state can be read after it ends)
const started = Date.now();
const child = spawn('docker', ['run', '--init', '--name', name, '--network', 'none', '--read-only',
  '--tmpfs', '/tmp:rw,exec,nosuid,size=512m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--pids-limit', '256', '--cpus', '2', '--memory', memory, '--memory-swap', memory, '--ulimit', 'fsize=1073741824',
  '--user', `${process.getuid()}:${process.getgid()}`, '-e', 'HOME=/tmp', '-e', 'TEXMFVAR=/tmp/texmf-var',
  '-e', 'shell_escape=f', '-e', 'openout_any=p', '-e', 'LANG=C.UTF-8',
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
  // (the tools on the host would follow a link left in the output, block
  // on a FIFO, or fail on what the command made unreadable. So each mode
  // is given back to its owner, and all but files and directories are
  // removed)
  let removed = 0;
  const walk = dir => {
    chmodSync(dir, lstatSync(dir).mode | 0o700);
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) chmodSync(path, stat.mode | 0o600);
      else {
        rmSync(path);
        removed++;
        console.error(`contain: removed what the command left in the output, not a file or directory: ${path}`);
      }
    }
  };
  write.forEach(walk);
  const status = code ?? 128 + constants.signals[signal];
  process.exit(status || (oom || removed ? 1 : 0));
});
