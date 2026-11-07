// Tests of the build slots (test/lib/slots.mjs) and of the commands that run
// in them (run() in test/lib/build.mjs), run by npm test:
// node --test test/slots.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { root, run } from './lib/build.mjs';
import { until } from './lib/chrome.mjs';

// every command has a deadline, as a hung one would hold up the other tests
const deadline = 60000;

// (each has a pool or a deadline of its own, and most only wait, so these run at once)
describe('slots and run()', { concurrency: true }, () => {
  test('a command that prints nothing for the deadline is killed with what it started', async () => {
    const { code, log } = await run('sh', ['-c', 'sleep 60 & echo $!; wait'], { idle: 0.5 });
    assert.notEqual(code, 0);
    assert.match(log, /\[FATAL\] sh printed nothing for 0\.5s/);
    const child = Number(log.split('\n')[0]);
    // (a killed process may be a zombie for a moment, which kill(pid, 0) finds)
    const gone = () => { try { process.kill(child, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
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

  // the slots, each test with a pool of its own in a temporary directory, as
  // processes: a slot is held by a process
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
    return { tmp, env: { TMPDIR: tmp, TEX8WEB_SLOTS: String(slots), TEX8WEB_SLOTS_POLL: '1000', LOG: join(tmp, 'log') } };
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
      // (at least one: starts a second apart on a loaded machine may not overlap)
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

  // a tool that runs a silent build of its own in a slot, with a total limit of
  // total seconds; the build writes its pid to pid, and the slot is file
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
      // (its timers stopped with it; the limit is 2 s more than the tool's)
      tool.kill('SIGSTOP');
      assert.ok(await free(10000), 'the build or its slot is left');
    } finally {
      tool.kill('SIGKILL');
      rmSync(tmp, { recursive: true });
    }
  });

  test('the stdout and stderr of a slotted build are both in its log', { skip: !lockf, timeout: 30000 }, async () => {
    const { tmp, env } = pool(1);
    try {
      const out = await child(`import { run } from './test/lib/build.mjs';
        const { log } = await run('sh', ['-c', 'echo to-stderr >&2; echo to-stdout'], { slot: true });
        console.log(JSON.stringify(log)); process.exit();`, env).done;
      // (the pipes' order isn't fixed)
      assert.deepEqual(JSON.parse(out).split('\n').sort(), ['', 'to-stderr', 'to-stdout']);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  test('a process that has given a slot back does not take one at once', { skip: !lockf, timeout: 30000 }, async () => {
    const { tmp, env } = pool(1);
    try {
      const again = child(`import { takeSlot } from './test/lib/slots.mjs';
        (await takeSlot())();
        const start = Date.now();
        (await takeSlot())();
        console.log('waited', Date.now() - start); process.exit();`, env);
      const waited = Number((await again.done).match(/waited (\d+)/)[1]);
      assert.ok(waited >= 900, `took another after ${waited} ms`);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  test('a lock taken on a file that is then deleted is taken again on a live one', { skip: !lockf, timeout: 30000 }, async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8weblock')));
    const file = join(dir, 'out/regress.lock');
    mkdirSync(join(dir, 'out'));
    writeFileSync(file, '');
    const holder = spawn('lockf', ['-k', file, 'sh', '-c', 'echo held; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'ignore'], timeout: deadline });
    const probe = () => spawnSync('lockf', ['-k', '-s', '-t', '0', file, 'true'], { timeout: deadline }).status;
    let waiter;
    try {
      await new Promise(done => holder.stdout.once('data', done));
      waiter = child(`import { lock } from './test/lib/slots.mjs';
        await lock(process.env.FILE); console.log('locked'); setInterval(() => {}, 1000);`, { FILE: file });
      // (it waits for the holder; the directory is removed under it, as clean does, and the holder lets go)
      await new Promise(done => setTimeout(done, 1000));
      rmSync(join(dir, 'out'), { recursive: true });
      holder.stdin.end();
      assert.ok(await waiter.printed('locked'), 'the waiter did not lock');
      assert.equal(probe(), 75, 'the waiter does not hold the file at the path');
    } finally {
      waiter?.kill('SIGKILL');
      holder.kill();
      rmSync(dir, { recursive: true });
    }
  });

  test('a number of slots that is not a number of slots is refused', async () => {
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
      // (it waits about 3 s, over its idle limit of 2 s, and runs for 1 s)
      const second = child(`import { run } from './test/lib/build.mjs';
        const { code } = await run('sh', ['-c', 'sleep 1; echo ok'], { idle: 2, slot: true });
        console.log('exit', code); process.exit();`, env);
      assert.match(await second.done, /exit 0/);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});
