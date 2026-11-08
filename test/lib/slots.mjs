// Build slots, shared by every checkout and session on the machine
// (CONTRIBUTING.md, "Build slots"). Each make4ht or latexmk build, and each
// Chrome the tests launch, holds one slot while it runs: tools that each
// size their parallelism for the whole machine make it swap. A slot is a
// lock file in $TMPDIR/tex8web-slots, taken with lockf, so scripts outside
// tex8web can take the same slots.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

// TEX8WEB_SLOTS, else one slot for each 4 GB of memory (about what a build
// and its Chrome or MathJax take), and at least one
export function slotCount() {
  const set = process.env.TEX8WEB_SLOTS;
  if (set === undefined) return Math.max(1, Math.floor(totalmem() / 2 ** 32));
  if (!/^[1-9][0-9]*$/.test(set)) throw new Error(`TEX8WEB_SLOTS is the number of build slots, 1 or more, not "${set}"`);
  return Number(set);
}
const dir = () => join(tmpdir(), 'tex8web-slots');
const sleep = ms => new Promise(done => setTimeout(done, ms));

// without lockf (Linux), no locks are taken, with a note printed once
let missing;
export function noLockf() {
  if (missing === undefined) {
    missing = spawnSync('lockf', { stdio: 'ignore' }).error?.code === 'ENOENT';
    if (missing) console.error('tex8web: no lockf, so no build slots and no shared build outputs; running without');
  }
  return missing;
}

// Calls attempt(slot file) on each slot until a call returns non-null, and
// resolves to that result. Waits a random 0.5 to 1.5 s between rounds, so
// that waiters do not retry in step. Prints a note after 10 s of waiting,
// then every 60 s
export async function inSlots(attempt) {
  mkdirSync(dir(), { recursive: true });
  const start = Date.now();
  let told = 0;
  for (;;) {
    for (let i = 0; i < slotCount(); i++) {
      const result = await attempt(join(dir(), String(i)));
      if (result !== null) return result;
    }
    if (Date.now() - start > 10000 && Date.now() - told > 60000) {
      console.error(`tex8web: waiting for one of ${slotCount()} build slots, all busy (TEX8WEB_SLOTS sets how many)`);
      told = Date.now();
    }
    await sleep(500 + 1000 * Math.random());
  }
}

// Holds an exclusive lock on file until the release function it resolves to
// is called, or this process ends, however it ends: lockf runs a shell that
// exits when its stdin closes. Resolves to null if wait is false and
// another process holds the lock
function hold(file, wait) {
  return new Promise((done, fail) => {
    const child = spawn('lockf', ['-k', ...wait ? [] : ['-t', '0'], file, 'sh', '-c', 'echo held; cat >/dev/null'],
      { stdio: ['pipe', 'pipe', 'ignore'] });
    let held = false;
    child.on('error', fail);
    child.stdin.on('error', () => {});
    child.stdout.once('data', () => {
      held = true;
      // (so that a lock never released does not keep this process running)
      child.unref();
      child.stdin.unref();
      child.stdout.unref();
      done(() => child.stdin.end());
    });
    child.on('close', code => {
      // (75, EX_TEMPFAIL: the lock is busy)
      if (!held) code === 75 ? done(null) : fail(new Error(`lockf ${file} exited with ${code}`));
    });
  });
}

// set when run() in build.mjs started this process with slot: true. The
// first takeSlot() returns that slot without waiting. The variable is
// deleted so that a Node process started by this one does not also claim
// the slot
let inherited = process.env.TEX8WEB_SLOTS_HELD === '1';
delete process.env.TEX8WEB_SLOTS_HELD;

// waits for a slot; resolves to its release function. For work that is not
// a command: a command takes its slot through run()
export async function takeSlot() {
  if (inherited) {
    inherited = false;
    return () => { inherited = true; };
  }
  if (noLockf()) return () => {};
  return inSlots(file => hold(file, false));
}

// waits for the lock on file; resolves to its release function
export const lock = async file => noLockf() ? () => {} : hold(file, true);
