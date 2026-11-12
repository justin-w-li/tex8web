// Tests of the build stamps of lib/build.mjs, and of when a build is
// reused. Run by npm test, or alone:
//   node --test test/builds.test.mjs
// make4ht and docker are stand-ins (test/lib/stubs.mjs).
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { mock, test } from 'node:test';
import { build, latexSourceHash, latexSources, root, sourceHash } from './lib/build.mjs';
import { dockerLog, stubbed } from './lib/stubs.mjs';

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

test('what LaTeX reads of tex8web, and only that, is in the stamp of its LaTeX run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tex8weblatexstamp'));
  try {
    const read = ['bin/tex8web', 'tex/a.tex', 'tex8web.cfg', 'tex8web.mk4', 'lua/tex8web/bibliography.lua',
      'lua/tex8web/files.lua', 'lua/tex8web/index.lua'];
    const unread = ['css/tex8web.css', 'js/a.js', 'fonts/a.woff2', 'lua/tex8web/text.lua', 'package.json', 'package-lock.json'];
    for (const file of [...read, ...unread]) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), 'a');
    }
    for (const file of unread) {
      const before = latexSourceHash(dir);
      writeFileSync(join(dir, file), 'b');
      assert.equal(latexSourceHash(dir), before, file);
    }
    for (const file of read) {
      const before = latexSourceHash(dir);
      writeFileSync(join(dir, file), 'b');
      assert.notEqual(latexSourceHash(dir), before, file);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the Lua that runs between LaTeX runs, and what it requires, is in the stamp of LaTeX\'s run', () => {
  // tex8web.mk4 runs these two between LaTeX runs
  const files = new Set();
  const add = file => {
    if (files.has(file)) return;
    files.add(file);
    for (const [, name] of readFileSync(join(root, file), 'utf8').matchAll(/require\s*\(?\s*"tex8web\.(\w+)"/g)) add(`lua/tex8web/${name}.lua`);
  };
  add('lua/tex8web/bibliography.lua');
  add('lua/tex8web/index.lua');
  assert.ok(files.has('lua/tex8web/files.lua'));
  for (const file of files) assert.ok(latexSources.includes(file), file);
});

test('a build is reused only while nothing it was built from has changed', { timeout: 30000 }, async () => {
  // realpath, as make4ht is given the config's path relative to dir
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webreuse')));
  try {
    const tex = join(dir, 'doc.tex');
    const write = body => writeFileSync(tex, `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`);
    const doc = { name: 'reuse', dir, tex: 'doc.tex', cfg: join(root, 'tex8web.cfg') };
    const make = env => build(doc, join(dir, 'build/html'), join(dir, 'build/aux'), { ...stubbed, ...env });
    const html = () => readFileSync(join(dir, 'build/html/doc.html'), 'utf8');

    write('first');
    assert.equal((await make()).reused, undefined);
    assert.equal((await make()).reused, true);
    assert.match(html(), /first/);
    // a new modification time alone is not a change
    const now = new Date();
    utimesSync(tex, now, now);
    assert.equal((await make()).reused, true);

    write('second');
    assert.equal((await make()).reused, undefined);
    assert.match(html(), /second/);

    // the config's content counts too, when it is outside the document's directory
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
    // TEX8WEB_SLOTS changes no page
    assert.equal((await make({ TEX8WEB_NO_PRERENDER: '1', TEX8WEB_SLOTS: '9' })).reused, true);
    // SOURCE_DATE_EPOCH does, from the environment or from doc.env
    assert.equal((await make({ TEX8WEB_NO_PRERENDER: '1', SOURCE_DATE_EPOCH: '946684800' })).reused, undefined);
    doc.env = { SOURCE_DATE_EPOCH: '946684800' };
    assert.equal((await make({ TEX8WEB_NO_PRERENDER: '1' })).reused, true);
    delete doc.env;

    // With the page's stamp removed, as by a change to css/, the LaTeX run is
    // reused while nothing LaTeX reads has changed, and its part of the log too
    assert.equal((await make()).latexReused, undefined);
    rmSync(join(dir, 'build/html.stamp'));
    const latex = await make();
    assert.equal(latex.latexReused, true);
    assert.equal(latex.log.match(/LaTeX ran/g)?.length, 1);
    assert.doesNotMatch(latex.log, /tex8web-latex/);
    assert.equal((await make()).reused, true);
    // nor the page on another day, as \today would differ
    const dayBefore = mock.method(Date.prototype, 'toDateString', () => 'the day before');
    try {
      assert.equal((await make()).reused, undefined);
    } finally {
      dayBefore.mock.restore();
    }
    // not on another day, as \today would differ, unless the date is fixed
    const nextDay = async env => {
      rmSync(join(dir, 'build/html.stamp'));
      const day = mock.method(Date.prototype, 'toDateString', () => 'another day');
      try {
        return (await make(env)).latexReused;
      } finally {
        day.mock.restore();
      }
    };
    assert.equal(await nextDay(), undefined);
    const fixed = { SOURCE_DATE_EPOCH: '946684800', FORCE_SOURCE_DATE: '1' };
    assert.equal((await make(fixed)).latexReused, undefined);
    assert.equal(await nextDay(fixed), true);
    // nor when part of the LaTeX run's output is gone
    rmSync(join(dir, 'build/html.stamp'));
    rmSync(join(dir, 'build/aux.latex.log'));
    const partial = await make(fixed);
    assert.equal(partial.code, 0, partial.log);
    assert.equal(partial.latexReused, undefined);
    write('third');
    assert.equal((await make()).latexReused, undefined);
    assert.match(html(), /third/);

    // a build that failed is not reused
    write('\\undefinedcs');
    assert.notEqual((await make()).code, 0);
    const again = await make();
    assert.notEqual(again.code, 0);
    assert.equal(again.reused, undefined);
    // nor is its LaTeX run, nor the one before it
    write('third');
    assert.equal((await make()).latexReused, undefined);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a document with a runner builds its PDF and page through it, and is never reused as a host build', { timeout: 30000 }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webrunner')));
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webelsewhere')));
  // (latexmk runs with this process's environment)
  const path = process.env.PATH;
  process.env.PATH = stubbed.PATH;
  try {
    writeFileSync(join(dir, 'doc.tex'), '\\documentclass{article}\n\\begin{document}\nText\n\\end{document}\n');
    const cfg = join(elsewhere, 'other.cfg');
    copyFileSync(join(root, 'tex8web.cfg'), cfg);
    const pdf = join(elsewhere, 'pdf/doc.pdf');
    const doc = { name: 'runner', dir, tex: 'doc.tex', cfg, pdf: relative(dir, pdf), runner: [join(root, 'test/lib/contain.mjs')] };
    const out = join(dir, 'build/html'), aux = join(dir, 'build/aux');
    const make = () => build(doc, out, aux, stubbed);
    writeFileSync(dockerLog, '');
    const first = await make();
    assert.equal(first.code, 0, first.log);
    assert.ok(existsSync(pdf), 'no PDF');
    assert.match(readFileSync(join(out, 'doc.html'), 'utf8'), /Text/);
    // each command with the files it reads outside the document's directory
    // read-only, and the directories it writes writable
    const mount = (path, mode = ',readonly') => `type=bind,source=${path},target=${path}${mode} `;
    const runs = readFileSync(dockerLog, 'utf8').split('\n').filter(line => line.startsWith('run '));
    // (first the cleaning of the document's build directory, and each
    // command followed by the cleaning of the directories it writes, each
    // mounting only those)
    assert.equal(runs.length, 5, runs.join('\n'));
    assert.ok(runs[1].includes(mount(dirname(pdf), '')) && runs[1].endsWith(` latexmk -norc -pdf -interaction=nonstopmode -outdir=${relative(dir, dirname(pdf))} doc.tex`), runs[1]);
    const writable = [mount(out, ''), mount(aux, ''), mount(`${aux}.latex`, ''), mount(join(dir, 'build'), '')];
    for (const part of [mount(dir), mount(cfg), mount(pdf), ...writable]) assert.ok(runs[3].includes(part), `${part} in ${runs[3]}`);
    assert.match(runs[3], / timeout -k 5 900 \S+\/bin\/tex8web -c /);
    for (const [clean, parts] of [[runs[0], [mount(join(dir, 'build'), '')]], [runs[2], [mount(dirname(pdf), '')]], [runs[4], writable]]) {
      assert.equal(clean.match(/--mount /g).length, parts.length, clean);
      for (const part of parts) assert.ok(clean.includes(part), `${part} in ${clean}`);
      assert.match(clean, / sh -c /);
    }
    assert.equal((await make()).reused, true);

    // a host build, of the same document and PDF, is not that build, and its
    // LaTeX run is not that build's either
    delete doc.runner;
    let host = await make();
    assert.equal(host.reused, undefined);
    assert.equal(host.latexReused, undefined);
    doc.runner = [join(root, 'test/lib/contain.mjs')];
    host = await make();
    assert.equal(host.reused, undefined);
    assert.equal(host.latexReused, undefined);

    // a source with a link is refused before the host reads it, after its
    // build directory and the outputs are cleaned
    symlinkSync('/dev/zero', join(dir, 'zero.tex'));
    writeFileSync(dockerLog, '');
    const refused = await make();
    assert.equal(refused.code, 2);
    assert.match(refused.log, /^refusing to build runner: .*\/zero\.tex is not a file or a directory that can be read$/m);
    const cleans = readFileSync(dockerLog, 'utf8').split('\n').filter(line => line.startsWith('run '));
    assert.equal(cleans.length, 1, cleans.join('\n'));
    for (const part of [mount(join(dir, 'build'), ''), mount(out, ''), mount(aux, ''), mount(`${aux}.latex`, '')]) assert.ok(cleans[0].includes(part), part);
    assert.match(cleans[0], / sh -c /);
  } finally {
    process.env.PATH = path;
    rmSync(dir, { recursive: true });
    rmSync(elsewhere, { recursive: true });
  }
});
