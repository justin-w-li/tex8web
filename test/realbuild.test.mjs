// Tests of what lib/build.mjs does with a real latexmk and make4ht, run by
// npm test:
// node --test test/realbuild.test.mjs
// A file of their own gives them a pool of slots of their own, which the
// tests with a stand-in for make4ht then needn't wait for.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { build } from './lib/build.mjs';
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
