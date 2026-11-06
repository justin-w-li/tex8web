// npm run examples: builds each example into examples/<name>/build: its
// page in html/ and its PDF in pdf/. Then builds the site CI publishes in
// build/site: the index (examples/index.tex), and each example's page in
// a folder of its own. Fails if a build does, or if the index links to a
// file the site lacks.
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { build, documents, latexmk, pool, root, workers } from './lib/build.mjs';

const examples = documents().filter(doc => doc.name.startsWith('examples/'));
let failed = false;
await pool(examples, workers, async doc => {
  // (the PDF first, as the page has a copy of it)
  const pdf = await latexmk(doc, 'build/pdf');
  const html = (await build(doc, join(doc.dir, 'build/html'), join(doc.dir, 'build/tex4ht'))).code;
  const missing = ['build/html/main.html', 'build/pdf/main.pdf'].filter(file => !existsSync(join(doc.dir, file)));
  const wrong = [...missing.map(file => `no ${file}`), ...pdf ? [`latexmk exited with ${pdf}`] : [],
    ...html ? [`make4ht exited with ${html}`] : []];
  failed ||= wrong.length > 0;
  console.log(`${doc.name}: ${wrong.join(', ') || 'built'} (${join(doc.dir, 'build')})`);
});

const site = join(root, 'build/site');
const index = { name: 'examples/index', dir: join(root, 'examples'), tex: 'index.tex', cfg: join(root, 'tex8web.cfg') };
const { code } = await build(index, site, join(root, 'build/siteaux'));
for (const doc of examples) cpSync(join(doc.dir, 'build/html'), join(site, basename(doc.dir)), { recursive: true });
const page = join(site, 'index.html');
const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
const wrong = [...!html ? ['no index.html'] : [], ...code ? [`make4ht exited with ${code}`] : [],
  ...[...html.matchAll(/ href='([^':#]+)'/g)].map(m => m[1]).filter(file => !existsSync(join(site, file)))
    .map(file => `no ${file}`)];
failed ||= wrong.length > 0;
console.log(`site: ${wrong.join(', ') || 'built'} (${site})`);
process.exitCode = failed ? 1 : 0;
