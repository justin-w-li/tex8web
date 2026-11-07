// Tests of what lib/build.mjs keeps a build by, its stamp, and when it reuses
// one, run by npm test:
// node --test test/builds.test.mjs
// make4ht is a stand-in (test/lib/stubs.mjs).
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build, root, sourceHash } from './lib/build.mjs';
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
