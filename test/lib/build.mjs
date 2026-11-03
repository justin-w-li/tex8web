// Building the test documents and examples with make4ht, for the tests and
// for npm run examples.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// test/fixtures/*.tex and examples/*/main.tex, each with its config: the
// example's own <name>.cfg if it has one, otherwise tex8web.cfg
export function documents() {
  const docs = [];
  for (const file of readdirSync(join(root, 'test/fixtures')).filter(f => f.endsWith('.tex')).sort()) {
    docs.push({ name: file.replace(/\.tex$/, ''), dir: join(root, 'test/fixtures'), tex: file,
      cfg: join(root, 'tex8web.cfg') });
  }
  const examples = join(root, 'examples');
  for (const name of existsSync(examples) ? readdirSync(examples).sort() : []) {
    const dir = join(examples, name);
    if (!existsSync(join(dir, 'main.tex'))) continue;
    const own = join(dir, `${name}.cfg`);
    docs.push({ name: `examples/${name}`, dir, tex: 'main.tex',
      cfg: existsSync(own) ? own : join(root, 'tex8web.cfg') });
  }
  return docs;
}

// runs make4ht on a document, with the page in out and tex4ht's files in
// aux (both absolute). make4ht reads the -B directory as a Lua pattern when
// it copies to -d, so both are passed relative to the document, where
// characters like - in the path above don't matter
export function build(doc, out, aux, env = {}) {
  // the PDF a config links with \WebPDF, if it isn't built yet
  const pdf = readFileSync(doc.cfg, 'utf8').match(/^\\WebPDF\{([^}]+)\}/m)?.[1];
  if (pdf && !existsSync(join(doc.dir, pdf))) {
    spawnSync('latexmk', ['-pdf', '-interaction=nonstopmode', `-outdir=${dirname(pdf)}`, doc.tex],
      { cwd: doc.dir, stdio: 'ignore' });
  }
  rmSync(out, { recursive: true, force: true });
  rmSync(aux, { recursive: true, force: true });
  // (make4ht's own mkdir fails when two builds make the same parent at once)
  mkdirSync(aux, { recursive: true });
  const args = ['-u', '-c', relative(doc.dir, doc.cfg), '-e', relative(doc.dir, join(root, 'tex8web.mk4')),
    '-B', relative(doc.dir, aux), '-d', relative(doc.dir, out), doc.tex];
  return new Promise(done => {
    const child = spawn('make4ht', args, { cwd: doc.dir, env: { ...process.env, ...env } });
    let log = '';
    child.stdout.on('data', d => log += d);
    child.stderr.on('data', d => log += d);
    child.on('close', code => done({ code, log: log.replace(/\x1b\[[0-9;]*m/g, '') }));
  });
}

// runs f on each item, at most n at a time
export async function pool(items, n, f) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await f(items[i]);
    }
  }));
  return results;
}
