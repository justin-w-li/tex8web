// npm run examples: builds each example into examples/<name>/build: its
// page in html/ and its PDF in pdf/. Fails if a build does.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { build, documents, latexmk, pool, workers } from './lib/build.mjs';

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
process.exitCode = failed ? 1 : 0;
