// npm run examples: builds each example into examples/<name>/build/html.
import { join } from 'node:path';
import { build, documents, pool } from './lib/build.mjs';

const examples = documents().filter(doc => doc.name.startsWith('examples/'));
await pool(examples, 2, async doc => {
  const result = await build(doc, join(doc.dir, 'build/html'), join(doc.dir, 'build/tex4ht'));
  console.log(`${doc.name}: ${result.code === 0 ? 'built' : 'failed'} (${join(doc.dir, 'build/html/main.html')})`);
});
