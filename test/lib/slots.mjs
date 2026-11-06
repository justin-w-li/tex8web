// A pool of build slots shared by every checkout and session on the machine.
// Each make4ht or latexmk build, and each Chrome the tests launch, holds one
// slot while it runs, as every tool sizing its own parallelism as if it had
// the machine to itself leaves it swapping. A slot is a lock file in
// $TMPDIR/tex8web-slots, taken with lockf; rebuild.sh takes the same ones.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

// TEX8WEB_SLOTS, else one slot for each 4 GB of memory (a build and its
// Chrome or MathJax take about that), and at least one
export function slotCount() {
  const set = process.env.TEX8WEB_SLOTS;
  if (set === undefined) return Math.max(1, Math.floor(totalmem() / 2 ** 32));
  if (!/^[1-9][0-9]*$/.test(set)) throw new Error(`TEX8WEB_SLOTS is the number of build slots, 1 or more, not "${set}"`);
  return Number(set);
}
const dir = () => join(tmpdir(), 'tex8web-slots');
const sleep = ms => new Promise(done => setTimeout(done, ms));

// where lockf is missing (Linux), there are no locks: a note, once
let missing;
export function noLockf() {
  if (missing === undefined) {
    missing = spawnSync('lockf', { stdio: 'ignore' }).error?.code === 'ENOENT';
    if (missing) console.error('tex8web: no lockf, so no build slots and no shared build outputs; running without');
  }
  return missing;
}

// A process that frees a slot lets the others, which look once in a poll,
// have it before it takes another
const poll = 1000;
let freed = 0;
export const released = () => { freed = Date.now(); };

// Calls attempt(lock file) on each slot's file until one returns something
// but null, and resolves to that. Between rounds it waits half a poll to
// one and a half, so that waiters don't keep step, and says so, once, after
// 10 s
export async function inSlots(attempt) {
  mkdirSync(dir(), { recursive: true });
  const start = Date.now();
  let told = false;
  await sleep(freed + poll - Date.now());
  for (;;) {
    for (let i = 0; i < slotCount(); i++) {
      const result = await attempt(join(dir(), String(i)));
      if (result !== null) return result;
    }
    if (!told && Date.now() - start > 10000) {
      console.error(`tex8web: waiting for one of ${slotCount()} build slots, all busy (TEX8WEB_SLOTS sets how many)`);
      told = true;
    }
    await sleep(poll * (0.5 + Math.random()));
  }
}

// Holds an exclusive lock on file until the release function it resolves to
// is called, or this process ends, however it ends: lockf runs a shell that
// stops when its stdin closes. Resolves to null if wait is false and the
// lock is held by another
function hold(file, wait) {
  return new Promise((done, fail) => {
    const child = spawn('lockf', ['-k', ...wait ? [] : ['-t', '0'], file, 'sh', '-c', 'echo held; cat >/dev/null'],
      { stdio: ['pipe', 'pipe', 'ignore'] });
    let held = false;
    child.on('error', fail);
    child.stdin.on('error', () => {});
    child.stdout.once('data', () => {
      held = true;
      // (so that a holder never released doesn't keep this process running)
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

// waits for one of the slots; resolves to the function that gives it back.
// For what is not a command to run: a command takes its slot through run()
export async function takeSlot() {
  if (noLockf()) return () => {};
  const release = await inSlots(file => hold(file, false));
  return () => {
    release();
    released();
  };
}

// waits for the lock on file; resolves to the function that gives it back
export const lock = async file => noLockf() ? () => {} : hold(file, true);
