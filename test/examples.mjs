// npm run examples: builds each example into examples/<name>/build: its
// page in html/ and its PDF in pdf/. Fails if a page or PDF is missing.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { build, documents, latexmk, pool, workers } from './lib/build.mjs';

const examples = documents().filter(doc => doc.name.startsWith('examples/'));
let failed = false;
await pool(examples, workers, async doc => {
  await Promise.all([build(doc, join(doc.dir, 'build/html'), join(doc.dir, 'build/tex4ht')), latexmk(doc, 'build/pdf')]);
  const missing = ['build/html/main.html', 'build/pdf/main.pdf'].filter(file => !existsSync(join(doc.dir, file)));
  failed ||= missing.length > 0;
  console.log(`${doc.name}: ${missing.length ? `no ${missing.join(' or ')}` : 'built'} (${join(doc.dir, 'build')})`);
});
process.exit(failed ? 1 : 0);
