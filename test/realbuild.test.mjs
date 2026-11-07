// Tests of what lib/build.mjs does with a real latexmk and make4ht, run by
// npm test:
// node --test test/realbuild.test.mjs
// A file of their own gives them a pool of slots of their own, which the
// tests with a stand-in for make4ht then needn't wait for.
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { build, hashFiles, root, run } from './lib/build.mjs';
import { stubbed } from './lib/stubs.mjs';

// (the real builds are the slow part, so these run at once)
describe('real builds', { concurrency: true }, () => {
  // a document in a directory of its own, with a config that links its PDF
  function pdfDoc(extra) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webpdf')));
    mkdirSync(join(dir, 'doc'));
    writeFileSync(join(dir, 'doc/doc.tex'), '\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n');
    writeFileSync(join(dir, 'doc.cfg'), '\\Preamble{xhtml,mathjax}\n\\begin{document}\n\\input{tex8web-core.tex}\n\\WebPDF{build/pdf/doc.pdf}\n\\EndPreamble\n');
    const doc = { name: 'pdf', dir: join(dir, 'doc'), tex: 'doc.tex', cfg: join(dir, 'doc.cfg'), ...extra };
    return { dir, doc, make: env => build(doc, join(dir, 'html'), join(dir, 'aux'), env) };
  }

  test('a build that makes its own PDF is reused by the next', { timeout: 60000 }, async () => {
    const { dir, doc, make } = pdfDoc();
    try {
      assert.equal((await make(stubbed)).reused, undefined);
      assert.ok(existsSync(join(doc.dir, 'build/pdf/doc.pdf')));
      assert.equal((await make(stubbed)).reused, true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  // the one test with a real make4ht: a file it leaves in the document's
  // directory would change the stamp and the build would never be reused
  test('a page built without its PDF links it once it is there, and a real build is reused', { timeout: 180000 }, async () => {
    const { dir, doc, make } = pdfDoc({ noLatexmk: true });
    try {
      const page = () => readFileSync(join(dir, 'html/doc.html'), 'utf8');
      const first = await make();
      assert.equal(first.code, 0, first.log);
      assert.equal(first.reused, undefined);
      // (which keep run()'s idle limit from timing the whole build)
      assert.match(first.log, /^\[INFO\] +htlatex: LaTeX call/m, "make4ht's steps are not in the log");
      assert.equal(existsSync(join(doc.dir, 'build/pdf')), false, 'something built the PDF');
      assert.doesNotMatch(page(), /doc\.pdf/);

      mkdirSync(join(doc.dir, 'build/pdf'), { recursive: true });
      writeFileSync(join(doc.dir, 'build/pdf/doc.pdf'), '%PDF-1.4\n');
      assert.equal((await make()).reused, undefined);
      assert.match(page(), /doc\.pdf/);
      assert.equal((await make()).reused, true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('a real build starts from the last one\'s LaTeX run while nothing LaTeX reads has changed', { timeout: 180000 }, async () => {
    const { dir, doc, make } = pdfDoc({ noLatexmk: true });
    try {
      const page = () => hashFiles(join(dir, 'html'), ['']);
      // (on a fixed date, so that midnight between builds doesn't run LaTeX)
      const fixed = { SOURCE_DATE_EPOCH: '946684800', FORCE_SOURCE_DATE: '1' };
      const first = await make(fixed);
      assert.equal(first.code, 0, first.log);
      assert.equal(first.latexReused, undefined);
      const full = page();
      // (as a change to css/ would: in the page's stamp, not in LaTeX's)
      rmSync(join(dir, 'html.stamp'));
      // (which LaTeX, had it run, would write again)
      appendFileSync(join(dir, 'aux.latex/doc.aux'), '% kept\n');
      const second = await make(fixed);
      assert.equal(second.code, 0, second.log);
      assert.equal(second.latexReused, true);
      assert.match(readFileSync(join(dir, 'aux/doc.aux'), 'utf8'), /% kept/);
      assert.equal(page(), full);
      // (LaTeX's part of the log is the kept run's, its calls included.
      // make4ht's other steps differ without LaTeX)
      const calls = log => log.match(/htlatex: LaTeX call/g)?.length;
      const output = log => log.replace(/^\[INFO\].*\n/gm, '');
      assert.equal(calls(second.log), calls(first.log));
      assert.equal(output(second.log), output(first.log));

      writeFileSync(join(doc.dir, 'doc.tex'), '\\documentclass{article}\n\\begin{document}\nchanged\n\\end{document}\n');
      const third = await make(fixed);
      assert.equal(third.code, 0, third.log);
      assert.equal(third.latexReused, undefined);
      assert.match(readFileSync(join(dir, 'html/doc.html'), 'utf8'), /changed/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('a real build that fails is not reused', { timeout: 180000 }, async () => {
    const { dir, doc, make } = pdfDoc({ noLatexmk: true });
    try {
      writeFileSync(join(doc.dir, 'doc.tex'), '\\documentclass{article}\n\\begin{document}\n\\undefinedcs\n\\end{document}\n');
      assert.notEqual((await make()).code, 0);
      const again = await make();
      assert.notEqual(again.code, 0);
      assert.equal(again.reused, undefined);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  // bin/tex8web run directly on a document of its own, with the tests'
  // variables as one might leave them in a shell
  async function direct(env) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webdirect')));
    writeFileSync(join(dir, 'doc.tex'), '\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n');
    const result = await run(join(root, 'bin/tex8web'), ['doc.tex'], { cwd: dir, slot: true,
      env: { ...process.env, TEX8WEB_NO_PRERENDER: '1', ...env(dir) } });
    return { dir, ...result };
  }

  test('a direct build with TEX8WEB_LATEX_REUSE and no LaTeX run kept runs LaTeX', { timeout: 180000 }, async () => {
    const { dir, code, log } = await direct(() => ({ TEX8WEB_LATEX_REUSE: '1' }));
    try {
      assert.equal(code, 0, log);
      assert.ok(existsSync(join(dir, 'build/html/doc.html')));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('TEX8WEB_LATEX_SAVE leaves what is already there', { timeout: 180000 }, async () => {
    const { dir, code, log } = await direct(dir => {
      mkdirSync(join(dir, 'kept'));
      writeFileSync(join(dir, 'kept/mine'), '');
      return { TEX8WEB_LATEX_SAVE: join(dir, 'kept') };
    });
    try {
      assert.equal(code, 0, log);
      assert.deepEqual(readdirSync(join(dir, 'kept')), ['mine']);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  // (regress.mjs --draft: make4ht's draft mode, from the tex4ht files of the build before)
  test('a real draft build follows a full one', { timeout: 180000 }, async () => {
    const { dir, doc, make } = pdfDoc({ noLatexmk: true });
    try {
      assert.equal((await make()).code, 0);
      doc.draft = true;
      const draft = await make();
      assert.equal(draft.code, 0, draft.log);
      assert.equal(draft.reused, undefined);
      assert.ok(existsSync(join(dir, 'html/doc.html')));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
