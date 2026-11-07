// Tests of the test tools that need no browser, run by npm test:
// node --test test/tools.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, root, run, sourceHash, strayKeys } from './lib/build.mjs';
import { until } from './lib/chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const node = (...args) => spawnSync(process.execPath, args, { cwd: join(here, '..'), encoding: 'utf8' });

test('diff.mjs compares the fonts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tex8webdiff'));
  try {
    for (const [name, bytes] of [['old', 'a'], ['new', 'b']]) {
      mkdirSync(join(dir, name, 'fonts'), { recursive: true });
      writeFileSync(join(dir, name, 'fonts/cut.woff2'), bytes);
    }
    const result = node('test/diff.mjs', join(dir, 'old'), join(dir, 'new'));
    assert.equal(result.status, 1);
    assert.match(result.stdout, /changed fonts\/cut\.woff2/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

for (const script of ['run', 'visual', 'page']) {
  test(`${script}.mjs fails on a name that matches nothing`, () => {
    const result = node(`test/${script}.mjs`, 'no-such-name');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no (document|check) named no-such-name/);
    assert.doesNotMatch(result.stdout, /all passed/);
  });
}

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

test('a table keyed by a document that does not exist is found', () => {
  assert.deepEqual(strayKeys({ test: 1, 'test-generic (MathJax in the browser)': 1 }, { 'no-such-document': 1 }), ['no-such-document']);
});

// the slots, each test with a pool of its own in a temporary directory, as
// processes: a slot is held by a process
const lockf = existsSync('/usr/bin/lockf');
function child(script, env) {
  const proc = spawn(process.execPath, ['--input-type=module', '-e', script],
    { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
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
  const busy = () => spawnSync('lockf', ['-k', '-t', '0', file, 'true']).status === 75;
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
  const holder = spawn('lockf', ['-k', file, 'sh', '-c', 'echo held; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const probe = () => spawnSync('lockf', ['-k', '-s', '-t', '0', file, 'true']).status;
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

test('what a build reads, in tex8web and in the document, is in its stamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tex8webstamp'));
  try {
    mkdirSync(join(dir, 'lua'));
    writeFileSync(join(dir, 'lua/a.lua'), 'a');
    mkdirSync(join(dir, 'test'));
    const before = sourceHash(dir);
    writeFileSync(join(dir, 'test/run.mjs'), 'not a source');
    writeFileSync(join(dir, 'lua/.swap'), 'not a source');
    assert.equal(sourceHash(dir), before);
    writeFileSync(join(dir, 'lua/a.lua'), 'b');
    const changed = sourceHash(dir);
    assert.notEqual(changed, before);
    writeFileSync(join(dir, 'lua/new.lua'), 'a file added later');
    assert.notEqual(sourceHash(dir), changed);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a build that makes its own PDF is reused by the next', { timeout: 120000 }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webpdf')));
  try {
    writeFileSync(join(dir, 'doc.tex'), '\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n');
    mkdirSync(join(dir, 'cfg'));
    writeFileSync(join(dir, 'cfg/doc.cfg'), '\\Preamble{xhtml,mathjax}\n\\begin{document}\n\\input{tex8web-core.tex}\n\\WebPDF{build/pdf/doc.pdf}\n\\EndPreamble\n');
    const doc = { name: 'pdf', dir: join(dir, 'doc'), tex: 'doc.tex', cfg: join(dir, 'cfg/doc.cfg') };
    mkdirSync(doc.dir);
    renameSync(join(dir, 'doc.tex'), join(doc.dir, 'doc.tex'));
    const make = () => build(doc, join(dir, 'html'), join(dir, 'aux'));
    assert.equal((await make()).reused, undefined);
    assert.ok(existsSync(join(doc.dir, 'build/pdf/doc.pdf')));
    assert.equal((await make()).reused, true);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a build is reused only while nothing it was built from has changed', { timeout: 120000 }, async () => {
  // (the real path: make4ht gets the config's path relative to it)
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webreuse')));
  try {
    const tex = join(dir, 'doc.tex');
    const write = body => writeFileSync(tex, `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`);
    const doc = { name: 'reuse', dir, tex: 'doc.tex', cfg: join(root, 'tex8web.cfg') };
    const make = env => build(doc, join(dir, 'build/html'), join(dir, 'build/aux'), env);
    const html = () => readFileSync(join(dir, 'build/html/doc.html'), 'utf8');

    write('first');
    assert.equal((await make()).reused, undefined);
    assert.equal((await make()).reused, true);
    assert.match(html(), /first/);
    // (a touch, and nothing else, leaves the document as it was)
    const now = new Date();
    utimesSync(tex, now, now);
    assert.equal((await make()).reused, true);

    write('second');
    assert.equal((await make()).reused, undefined);
    assert.match(html(), /second/);

    // the config's content counts too, where it is not in the document's directory
    const cfgDir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webcfg')));
    try {
      doc.cfg = join(cfgDir, 'other.cfg');
      copyFileSync(join(root, 'tex8web.cfg'), doc.cfg);
      assert.equal((await make()).reused, undefined);
      assert.equal((await make()).reused, true);
      appendFileSync(doc.cfg, '\n% changed\n');
      assert.equal((await make()).reused, undefined);
    } finally {
      doc.cfg = join(root, 'tex8web.cfg');
      rmSync(cfgDir, { recursive: true });
    }

    assert.equal((await make({ TEX8WEB_NO_PRERENDER: '1' })).reused, undefined);
    assert.equal((await make({ TEX8WEB_NO_PRERENDER: '1' })).reused, true);

    // a build that failed isn't reused
    write('\\undefinedcs');
    assert.notEqual((await make()).code, 0);
    const again = await make();
    assert.notEqual(again.code, 0);
    assert.equal(again.reused, undefined);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// regress.mjs, run from a temporary directory as npm does (in tex8web's, told where from), with a tex8web checkout of its own
// to record: a clean git repository, or one with a file git doesn't know
const git = (dir, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', dir, ...args], { encoding: 'utf8' });
const regress = (cwd, tree, ...args) => spawnSync(process.execPath, [join(here, 'regress.mjs'), ...args],
  { cwd: root, encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: 'regress', INIT_CWD: cwd, TEX8WEB_TREE: tree }, timeout: 300000 });
const article = body => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
function scratch(names) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webregress')));
  for (const [path, body] of Object.entries(names)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  const clean = join(dir, 'clean'), dirty = join(dir, 'dirty');
  for (const repo of [clean, dirty]) {
    mkdirSync(repo);
    git(repo, 'init');
    git(repo, 'commit', '--allow-empty', '-m', 'x');
  }
  writeFileSync(join(dirty, 'file'), 'not committed');
  return { dir, clean, dirty, head: git(clean, 'rev-parse', '--short', 'HEAD').stdout.trim() };
}

test('regress.mjs says what changed in each document since its accepted build', { skip: !lockf, timeout: 600000 }, () => {
  const { dir, clean, head } = scratch({ 'one/main.tex': article('First'), 'two/note.tex': article('Second') });
  const out = join(dir, 'build/regress');
  const stamp = () => readFileSync(join(out, 'accepted/STAMP'), 'utf8');
  try {
    let result = regress(dir, clean, 'one', 'two');
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /^one: no baseline/m);
    assert.match(result.stdout, /^two: no baseline/m);

    result = regress(dir, clean, '--accept', 'one', 'two/note.tex');
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok(existsSync(join(out, 'accepted/one/main.html')));
    assert.match(stamp(), new RegExp(`^${head} \\d{4}-\\d\\d-\\d\\d`));

    result = regress(dir, clean, 'one', 'two');
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /^one: unchanged/m);
    assert.match(result.stdout, /^two: unchanged/m);

    writeFileSync(join(dir, 'two/note.tex'), article('Second, and more words than before'));
    result = regress(dir, clean, 'one', 'two');
    assert.equal(result.status, 3, result.stderr + result.stdout);
    assert.match(result.stdout, /^one: unchanged/m);
    assert.match(result.stdout, /^two: looks different: .*-light/m);
    // (shots.mjs's progress isn't part of the outcome)
    assert.doesNotMatch(result.stdout, /^two: .*(loading|screen \d+ of)/m);
    assert.ok(readdirSync(join(out, 'compare/two')).some(file => file.endsWith('-new.png')));

    // a document that doesn't build fails the run and keeps the rest from being accepted
    mkdirSync(join(dir, 'bad'));
    writeFileSync(join(dir, 'bad/main.tex'), article('\\undefinedcs'));
    const before = stamp();
    result = regress(dir, clean, '--accept', 'two', 'bad');
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stdout, /^bad: failed to build/m);
    assert.equal(stamp(), before);
    assert.doesNotMatch(readFileSync(join(out, 'accepted/two/note.html'), 'utf8'), /more words/);

    // a looking-different page is accepted without failing, and is then the baseline
    result = regress(dir, clean, '--accept', 'two');
    assert.equal(result.status, 0, result.stderr + result.stdout);
    result = regress(dir, clean, 'two');
    assert.match(result.stdout, /^two: unchanged/m);

    // another baseline, another output directory, and a config
    copyFileSync(join(root, 'tex8web.cfg'), join(dir, 'my.cfg'));
    result = regress(dir, clean, '--out', 'elsewhere', '--baseline', join(out, 'accepted'), '-c', 'my.cfg', 'one');
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /^one: unchanged/m);
    assert.ok(existsSync(join(dir, 'elsewhere/html/one/main.html')));

    result = regress(dir, clean, '--draft', '--out', 'drafts', 'one');
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok(existsSync(join(dir, 'drafts/html/one/main.html')));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('regress.mjs builds a page whose PDF is missing, and builds no PDF', { timeout: 300000 }, () => {
  const { dir, clean } = scratch({ 'one/main.tex': article('First'),
    'my.cfg': '\\Preamble{xhtml,mathjax}\n\\begin{document}\n\\input{tex8web-core.tex}\n\\WebPDF{build/pdf/main.pdf}\n\\EndPreamble\n' });
  try {
    const result = regress(dir, clean, '-c', 'my.cfg', 'one');
    assert.ok(existsSync(join(dir, 'build/regress/html/one/main.html')), result.stderr + result.stdout);
    assert.equal(existsSync(join(dir, 'one/build')), false, 'something built the PDF');
    assert.match(result.stdout, /^one: /m);
    assert.doesNotMatch(readFileSync(join(dir, 'build/regress/html/one/main.html'), 'utf8'), /main\.pdf/);

    // once the PDF is there, the page is built again and links it
    mkdirSync(join(dir, 'one/build/pdf'), { recursive: true });
    writeFileSync(join(dir, 'one/build/pdf/main.pdf'), '%PDF-1.4\n');
    const again = regress(dir, clean, '-c', 'my.cfg', 'one');
    assert.doesNotMatch(again.stdout, /reusing/);
    assert.match(readFileSync(join(dir, 'build/regress/html/one/main.html'), 'utf8'), /main\.pdf/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("regress.mjs holds its output directory's lock while it runs, and clean leaves it", { skip: !lockf, timeout: 120000 }, async () => {
  const { dir, clean } = scratch({ 'one/main.tex': article('First') });
  const out = join(dir, 'build/regress');
  const busy = () => spawnSync('lockf', ['-k', '-s', '-t', '0', join(out, 'regress.lock'), 'true']).status === 75;
  const proc = spawn(process.execPath, [join(here, 'regress.mjs'), 'one'], { cwd: root, stdio: 'ignore',
    env: { ...process.env, npm_lifecycle_event: 'regress', INIT_CWD: dir, TEX8WEB_TREE: clean } });
  const ended = new Promise(done => proc.on('close', done));
  try {
    assert.ok(await until(() => existsSync(join(out, 'regress.lock')) && busy(), Boolean, 20000), 'the lock was not taken');
    const result = spawnSync(process.execPath, [join(here, 'clean.mjs'), '--in', dir, 'regress'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, TMPDIR: dir } });
    assert.match(result.stdout, /skipping .*build\/regress: .*in use/);
    assert.ok(existsSync(join(out, 'regress.lock')));
    assert.equal(await ended, 0);
    assert.equal(busy(), false, 'the lock is held after it ended');
  } finally {
    proc.kill();
    rmSync(dir, { recursive: true });
  }
});

test('regress.mjs refuses what it cannot do before it builds anything', () => {
  const { dir, clean, dirty } = scratch({ 'one/main.tex': article('First'), 'a/dup/main.tex': article('A'), 'b/dup/main.tex': article('B'),
    'empty/readme.txt': 'no TeX', 'two/a.tex': article('A'), 'two/b.tex': article('B') });
  try {
    const refused = (pattern, tree, ...args) => {
      const result = regress(dir, tree, ...args);
      assert.equal(result.status, 2, `${args.join(' ')}: ${result.stdout}${result.stderr}`);
      assert.match(result.stderr, pattern);
      assert.equal(existsSync(join(dir, 'build')), false, `${args.join(' ')} built something`);
    };
    refused(/usage/, clean);
    refused(/usage/, clean, '--no-such-option', 'one');
    refused(/usage/, clean, '--out');
    refused(/--draft/, clean, '--draft', '--accept', 'one');
    refused(/no such/, clean, 'missing');
    refused(/main\.tex/, clean, 'empty');
    refused(/main\.tex/, clean, 'two');
    refused(/same name.*dup/, clean, 'a/dup', 'b/dup');
    refused(/make4ht/, clean, '--out', 'my-out', 'one');
    refused(/make4ht/, clean, '--out', 'my%out', 'one');
    refused(/make4ht/, clean, '--out', 'my(out)', 'one');
    // (by default the pages go in the directory it is run from, which npm makes tex8web's)
    const inside = spawnSync(process.execPath, [join(here, 'regress.mjs'), join(dir, 'one')],
      { cwd: root, encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: undefined, TEX8WEB_TREE: clean } });
    assert.equal(inside.status, 2);
    assert.match(inside.stderr, /inside tex8web.*--prefix/s);
    // (and a plain node takes paths from its own directory, not from INIT_CWD)
    const plain = spawnSync(process.execPath, [join(here, 'regress.mjs'), 'two'],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: undefined, INIT_CWD: root } });
    assert.equal(plain.status, 2);
    assert.match(plain.stderr, /main\.tex/);
    refused(/uncommitted/, dirty, '--accept', 'one');
    refused(/not a git/, dir, '--accept', 'one');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// clean.mjs in a temporary directory, as npm runs it, with $TMPDIR in tmp
function cleaner() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webclean')));
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp);
  const file = path => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), 'x'); };
  const clean = (...args) => spawnSync(process.execPath, [join(here, 'clean.mjs'), ...args], { cwd: root, encoding: 'utf8',
    env: { ...process.env, npm_lifecycle_event: 'clean', INIT_CWD: dir, TMPDIR: tmp } });
  // (what is under dir except tmp, links listed and not followed)
  const walk = (base, rel) => readdirSync(base, { withFileTypes: true })
    .flatMap(entry => [join(rel, entry.name), ...entry.isDirectory() ? walk(join(base, entry.name), join(rel, entry.name)) : []]);
  const left = () => walk(dir, '').filter(path => !path.startsWith('tmp')).sort();
  return { dir, tmp, file, clean, left };
}

test('clean.mjs removes one key\'s builds and dead Chrome profiles, and nothing else', async () => {
  const { dir, tmp, file, clean, left } = cleaner();
  for (const path of ['each/a/main.tex', 'each/a/build/k/html/a.html', 'each/a/build/pdf/main.pdf', 'each/a/build/main/html/a.html',
    'each/a/build/k/html/a.lock', 'each/b/b.tex', 'each/b/build/k/tex4ht/b.log', 'each/c/main.tex', 'each/plain/build/k/x',
    'each/cm/main.tex', 'each/cm/build/k/CMakeCache.txt', 'fake/tex8web.mk4', 'fake/build/k/html/a.html',
    'each/ln/main.tex', 'target2/k/html/x.html', 'outside/f.lock', 'outside/x',
    'each/tex8web-x/tex8web.mk4', 'each/tex8web-x/test.tex', 'each/tex8web-x/build/k/page.html',
    'each/link/main.tex', 'target/keep', 'here/build/k/accepted/a/a.html', 'here/build/k/html/a/a.html',
    'here/build/main/html/a.html', 'build/k/html/d.html',
    'tmp/tex8webchromeDead01/Default', 'tmp/tex8webchromeDead01.log', 'tmp/tex8webchromeLive01/Default',
    'tmp/tex8webchromeNew001/Default', 'tmp/tex8webchromepagesAbCdEf/file', 'tmp/other/file']) file(path);
  mkdirSync(join(dir, 'each/link/build'));
  symlinkSync(join(dir, 'target'), join(dir, 'each/link/build/k'));
  // (a link to where the build's files are, and a link in a build to where something else's are)
  symlinkSync(join(dir, 'target2'), join(dir, 'each/ln/build'));
  symlinkSync(join(dir, 'outside'), join(dir, 'each/b/build/k/tex4ht/out'));
  const old = new Date(Date.now() - 3600000);
  for (const name of ['tex8webchromeDead01', 'tex8webchromeDead01.log', 'tex8webchromeLive01', 'tex8webchromepagesAbCdEf']) utimesSync(join(tmp, name), old, old);
  const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', `--user-data-dir=${join(tmp, 'tex8webchromeLive01')}`], { stdio: 'ignore' });
  try {
    const before = left();
    let result = clean('--dry-run', '--each', 'each', '--in', 'here', 'k');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would remove .*each\/a\/build\/k\n/);
    assert.match(result.stdout, /would remove .*tex8webchromeDead01\n/);
    assert.deepEqual(left(), before);

    // (--each alone keeps the current directory, and --in then drops it)
    result = clean('--each', 'each', 'k');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^removed .*each\/b\/build\/k$/m);
    assert.match(result.stdout, new RegExp(`^removed ${dir}/build/k$`, 'm'));
    // (a document's build directory that is a link is not followed; what a build holds that regress doesn't make
    // means it isn't one of its builds; a tex8web checkout has builds of its own)
    assert.match(result.stdout, /skipping .*each\/ln\/build: a link/);
    assert.match(result.stdout, /skipping .*each\/cm\/build\/k: .*CMakeCache\.txt/);
    result = clean('--in', 'here', '--in', 'fake', 'k');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skipping .*fake\/build\/k: .*tex8web checkout/);
    // (what stays: a build's accepted pages, the other keys' builds, the PDFs, what is not a document, a tex8web checkout,
    // a link's target and the live profiles and the other tests' directories)
    assert.deepEqual(left(), [
      'build', 'each', 'each/a', 'each/a/build', 'each/a/build/main', 'each/a/build/main/html', 'each/a/build/main/html/a.html',
      'each/a/build/pdf', 'each/a/build/pdf/main.pdf', 'each/a/main.tex', 'each/b', 'each/b/b.tex', 'each/b/build',
      'each/c', 'each/c/main.tex', 'each/link', 'each/link/build', 'each/link/main.tex',
      'each/plain', 'each/plain/build', 'each/plain/build/k', 'each/plain/build/k/x',
      'each/cm', 'each/cm/build', 'each/cm/build/k', 'each/cm/build/k/CMakeCache.txt', 'each/cm/main.tex',
      'each/ln', 'each/ln/build', 'each/ln/main.tex', 'fake', 'fake/build', 'fake/build/k', 'fake/build/k/html',
      'fake/build/k/html/a.html', 'fake/tex8web.mk4', 'outside', 'outside/f.lock', 'outside/x',
      'target2', 'target2/k', 'target2/k/html', 'target2/k/html/x.html',
      'each/tex8web-x', 'each/tex8web-x/build', 'each/tex8web-x/build/k', 'each/tex8web-x/build/k/page.html',
      'each/tex8web-x/test.tex', 'each/tex8web-x/tex8web.mk4',
      'here', 'here/build', 'here/build/k', 'here/build/k/accepted', 'here/build/k/accepted/a', 'here/build/k/accepted/a/a.html',
      'here/build/main', 'here/build/main/html', 'here/build/main/html/a.html', 'target', 'target/keep'].sort());
    assert.deepEqual(readdirSync(tmp).sort(), ['other', 'tex8webchromeLive01', 'tex8webchromeNew001', 'tex8webchromepagesAbCdEf']);

    for (const key of ['main', 'accepted', 'pdf', '../k', '', 'a/b']) {
      result = clean('--each', 'each', key);
      assert.equal(result.status, 2, `key "${key}"`);
    }
    assert.equal(clean().status, 2);
  } finally {
    live.kill();
    rmSync(dir, { recursive: true });
  }
});

test('clean.mjs leaves a build whose lock is held', { skip: !lockf, timeout: 30000 }, async () => {
  const { dir, file, clean, left } = cleaner();
  file('busy/build/k/html/a.lock');
  file('busy/build/k/html/a.html');
  file('free/build/k/html/a.html');
  const holder = spawn('lockf', ['-k', join(dir, 'busy/build/k/html/a.lock'), 'sh', '-c', 'echo held; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'ignore'] });
  try {
    await new Promise(done => holder.stdout.once('data', done));
    const result = clean('--in', 'busy', '--in', 'free', 'k');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skipping .*busy\/build\/k: .*locked/);
    assert.deepEqual(left().filter(path => path.includes('busy') || path.includes('free')),
      ['busy', 'busy/build', 'busy/build/k', 'busy/build/k/html', 'busy/build/k/html/a.html', 'busy/build/k/html/a.lock', 'free', 'free/build']);
    holder.stdin.end();
    await new Promise(done => holder.on('close', done));
    assert.match(clean('--in', 'busy', 'k').stdout, /removed .*busy\/build\/k/);
  } finally {
    holder.kill();
    rmSync(dir, { recursive: true });
  }
});
