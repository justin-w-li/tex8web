// Tests of the build slots (test/lib/slots.mjs) and of the commands run in
// them (run() in test/lib/build.mjs). Run by npm test, or alone:
//   node --test test/slots.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { root, run } from './lib/build.mjs';
import { until } from './lib/chrome.mjs';

// every command has a deadline, as a hung one would hold up the other tests
const deadline = 60000;

// each test has a separate pool or deadline, and most only wait, so the tests run concurrently
describe('slots and run()', { concurrency: true }, () => {
  test('a command that prints nothing for the deadline is killed with what it started', async () => {
    const { code, log } = await run('sh', ['-c', 'sleep 60 & echo $!; wait'], { idle: 0.5 });
    assert.notEqual(code, 0);
    assert.match(log, /\[FATAL\] sh printed nothing for 0\.5s/);
    const child = Number(log.split('\n')[0]);
    // kill(pid, 0) finds a killed process until it is reaped. A container
    // whose init does not reap, as in CI, never reaps it, so a zombie is gone.
    const zombie = () => existsSync('/proc') ? /^\d+ \(.*\) Z/.test(readFileSync(`/proc/${child}/stat`, 'utf8'))
      : spawnSync('ps', ['-o', 'stat=', '-p', String(child)], { encoding: 'utf8', timeout: deadline }).stdout.startsWith('Z');
    const gone = () => { try { process.kill(child, 0); return zombie(); } catch (e) { return e.code === 'ESRCH'; } };
    assert.ok(await until(gone, Boolean, 5000), `process ${child} still running`);
  });

  test('a command that keeps printing is not stopped by the idle deadline', async () => {
    const { code } = await run('sh', ['-c', 'for i in 1 2 3 4 5 6; do echo $i; sleep 0.5; done'], { idle: 2 });
    assert.equal(code, 0);
  });

  test('a command that prints forever is stopped by the total deadline', async () => {
    const { code, log } = await run('sh', ['-c', 'while :; do echo x; sleep 0.05; done'], { idle: 5, total: 0.5 });
    assert.notEqual(code, 0);
    assert.match(log, /\[FATAL\] sh ran over 0\.5s/);
  });

  // The slot tests run child processes, as a slot is held by a process. Each
  // test has a separate pool in a temporary directory.
  const lockf = existsSync('/usr/bin/lockf');
  function child(script, env) {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', script],
      { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'], timeout: deadline });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.done = new Promise(done => proc.on('close', () => done(out)));
    proc.printed = text => until(() => out.includes(text), Boolean, 10000);
    return proc;
  }
  const pool = (slots) => {
    const tmp = mkdtempSync(join(tmpdir(), 'tex8webslots'));
    return { tmp, env: { TMPDIR: tmp, TEX8WEB_SLOTS: String(slots), LOG: join(tmp, 'log') } };
  };

  test('no more builds hold slots than there are slots', { skip: !lockf }, async () => {
    const { tmp, env } = pool(2);
    try {
      const holder = `import { takeSlot } from './test/lib/slots.mjs';
        import { appendFileSync } from 'node:fs';
        const release = await takeSlot();
        appendFileSync(process.env.LOG, '+\\n');
        await new Promise(done => setTimeout(done, 400));
        appendFileSync(process.env.LOG, '-\\n');
        release();`;
      await Promise.all(Array.from({ length: 6 }, () => child(holder, env).done));
      let now = 0, most = 0;
      for (const sign of readFileSync(env.LOG, 'utf8').trim().split('\n')) most = Math.max(most, now += sign === '+' ? 1 : -1);
      // at least one: on a loaded machine, starts a second apart may not overlap
      assert.ok(most >= 1 && most <= 2, `${most} slots held at once`);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  test('a slot is free again once the process holding it is killed', { skip: !lockf, timeout: 30000 }, async () => {
    const { tmp, env } = pool(1);
    try {
      const first = child(`import { takeSlot } from './test/lib/slots.mjs';
        await takeSlot(); console.log('held'); await new Promise(done => setTimeout(done, 60000));`, env);
      assert.ok(await first.printed('held'));
      first.kill('SIGKILL');
      const second = child(`import { takeSlot } from './test/lib/slots.mjs';
        await takeSlot(); console.log('took'); process.exit();`, env);
      assert.match(await second.done, /took/);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  // A tool that runs a silent build in a slot, with a total limit of total
  // seconds. The build writes its pid to pid, and the slot's lock file is file.
  async function silentBuild(total) {
    const { tmp, env } = pool(1);
    const file = join(tmp, 'tex8web-slots/0');
    const pid = join(tmp, 'pid');
    const tool = child(`import { run } from './test/lib/build.mjs';
      run('sh', ['-c', 'echo $$ > ${pid}; exec sleep 1000'], { slot: true, total: ${total} });`, env);
    assert.ok(await until(() => existsSync(pid), Boolean, 10000), 'the build did not start');
    const busy = () => spawnSync('lockf', ['-k', '-t', '0', file, 'true'], { timeout: deadline }).status === 75;
    assert.ok(busy(), 'the slot is free while the build runs');
    const gone = () => { try { process.kill(Number(readFileSync(pid, 'utf8')), 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
    return { tmp, tool, free: ms => until(() => !busy() && gone(), Boolean, ms) };
  }

  test('a build ends and gives its slot back when the tool that started it is killed outright', { skip: !lockf, timeout: 30000 }, async () => {
    const { tmp, tool, free } = await silentBuild(600);
    try {
      tool.kill('SIGKILL');
      assert.ok(await free(5000), 'the build or its slot is left');
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  test('a build is ended by its own total limit when the tool is stopped', { skip: !lockf, timeout: 30000 }, async () => {
    const { tmp, tool, free } = await silentBuild(2);
    try {
      // the tool's timers stop with it; the watchdog's limit is 2 s more
      tool.kill('SIGSTOP');
      assert.ok(await free(10000), 'the build or its slot is left');
    } finally {
      tool.kill('SIGKILL');
      rmSync(tmp, { recursive: true });
    }
  });

  // lines alternating between stderr and stdout, faster than a reader of two
  // pipes could keep in order
  const interleaved = ['sh', ['-c', 'i=0; while [ $i -lt 200 ]; do echo e$i >&2; echo o$i; i=$((i + 1)); done']];
  const inTurn = Array.from({ length: 200 }, (_, i) => `e${i}\no${i}\n`).join('');

  test('a build\'s log has its stdout and stderr in the order it wrote them', { timeout: 30000 }, async () => {
    assert.equal((await run(...interleaved)).log, inTurn);
  });

  test('a slotted build\'s log has its stdout and stderr in the order it wrote them', { skip: !lockf, timeout: 30000 }, async () => {
    const { tmp, env } = pool(1);
    try {
      const out = await child(`import { run } from './test/lib/build.mjs';
        const { log } = await run(...${JSON.stringify(interleaved)}, { slot: true });
        console.log(JSON.stringify(log)); process.exit();`, env).done;
      assert.equal(JSON.parse(out), inTurn);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  test('a number of slots that is not a number of slots is refused', { skip: !lockf }, async () => {
    for (const slots of ['0', 'two', '1.5']) {
      const result = await child(`import { takeSlot } from './test/lib/slots.mjs';
        await takeSlot().catch(error => console.log(error.message)); process.exit();`, { TEX8WEB_SLOTS: slots }).done;
      assert.match(result, /TEX8WEB_SLOTS is the number of build slots/);
    }
  });

  test('a command waiting for a slot is not timed while it waits', { skip: !lockf, timeout: 30000 }, async () => {
    const { tmp, env } = pool(1);
    try {
      const first = child(`import { takeSlot } from './test/lib/slots.mjs';
        await takeSlot(); console.log('held'); await new Promise(done => setTimeout(done, 3500)); process.exit();`, env);
      assert.ok(await first.printed('held'));
      // the command waits about 3 s, over its idle limit of 2 s, then runs 1 s
      const second = child(`import { run } from './test/lib/build.mjs';
        const { code } = await run('sh', ['-c', 'sleep 1; echo ok'], { idle: 2, slot: true });
        console.log('exit', code); process.exit();`, env);
      assert.match(await second.done, /exit 0/);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  test("a command run in a slot has it for its Chrome, and not for a second at once or for its children's", { skip: !lockf, timeout: 30000 }, async () => {
    const { tmp, env } = pool(1);
    try {
      const first = child(`import { takeSlot } from './test/lib/slots.mjs';
        await takeSlot(); console.log('held'); await new Promise(done => setTimeout(done, 8000)); process.exit();`, env);
      assert.ok(await first.printed('held'));
      // The command waits for the slot, then has it for its first
      // takeSlot(), and again once that one is released. The total limit of
      // 5 s, less than the wait, ends the command if the wait is timed or if
      // the command waits for a second slot.
      const command = `import { takeSlot } from './test/lib/slots.mjs';
        const chrome = await takeSlot();
        let second = false;
        takeSlot().then(() => { second = true; });
        await new Promise(done => setTimeout(done, 1000));
        chrome();
        await takeSlot();
        console.log('second', second, 'children', process.env.TEX8WEB_SLOTS_HELD ?? 'none'); process.exit();`;
      const tool = child(`import { run } from './test/lib/build.mjs';
        const { code, log } = await run(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(command)}], { slot: true, total: 5 });
        console.log('exit', code, log); process.exit();`, env);
      assert.match(await tool.done, /exit 0 second false children none/);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});
