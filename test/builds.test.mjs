// Tests of what lib/build.mjs keeps a build by, its stamp, and when it reuses
// one, run by npm test:
// node --test test/builds.test.mjs
// make4ht is a stand-in (test/lib/stubs.mjs).
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mock, test } from 'node:test';
import { build, latexSourceHash, latexSources, root, sourceHash } from './lib/build.mjs';
import { stubbed } from './lib/stubs.mjs';

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
  // (tex8web.mk4 runs these two between LaTeX's runs)
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
  // (the real path: make4ht gets the config's path relative to it)
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
    // (the slots' settings change no page)
    assert.equal((await make({ TEX8WEB_NO_PRERENDER: '1', TEX8WEB_SLOTS: '9', TEX8WEB_SLOTS_POLL: '5' })).reused, true);
    // (the date TeX is given does, from the command or the document)
    assert.equal((await make({ TEX8WEB_NO_PRERENDER: '1', SOURCE_DATE_EPOCH: '946684800' })).reused, undefined);
    doc.env = { SOURCE_DATE_EPOCH: '946684800' };
    assert.equal((await make({ TEX8WEB_NO_PRERENDER: '1' })).reused, true);
    delete doc.env;

    // LaTeX's run is reused while nothing LaTeX reads has changed (the page's
    // stamp gone, as a change to css/ would make it), with its part of the log
    assert.equal((await make()).latexReused, undefined);
    rmSync(join(dir, 'build/html.stamp'));
    const latex = await make();
    assert.equal(latex.latexReused, true);
    assert.equal(latex.log.match(/LaTeX ran/g)?.length, 1);
    assert.doesNotMatch(latex.log, /tex8web-latex/);
    assert.equal((await make()).reused, true);
    // (but not on another day, which \today would show, unless the date is fixed)
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
    write('third');
    assert.equal((await make()).latexReused, undefined);
    assert.match(html(), /third/);

    // a build that failed isn't reused
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
