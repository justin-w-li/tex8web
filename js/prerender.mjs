// Typesets the math of a page tex8web.mk4 made, in place, with MathJax in
// Node: the page then shows its math without JavaScript, also saved or
// offline. tex8web.mk4 runs it when node_modules is installed (npm ci).
//   node prerender.mjs page.html
// It configures MathJax from the page's tex8web-config, with tex8web.js, as
// the browser would. MathJax's styles go into page-mathjax.css and the fonts
// they use into fonts/mathjax/, next to the page; it prints their paths, for
// tex8web.mk4 to list with the output.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { runInThisContext } from 'node:vm';

const require = createRequire(import.meta.url);
const file = process.argv[2];
const html = readFileSync(file, 'utf8');

const data = JSON.parse(html.match(/<script[^>]*id=["']tex8web-config["'][^>]*>([^]*?)<\/script>/)[1]);
runInThisContext(readFileSync(new URL('tex8web.js', import.meta.url), 'utf8'));
const config = globalThis.tex8web(data.mathjax, data.tex);
// everything at once, but no menu (it needs the browser); and no MathML for
// screen readers unless TEX8WEB_MATHML is set (the tests check the math by
// it): a hidden copy of every formula, it is a quarter of a long page and
// most of the time a phone takes to lay the page out
const mathml = Boolean(process.env.TEX8WEB_MATHML);
config.loader.load = config.loader.load.filter(name => name !== 'ui/lazy')
  .concat('adaptors/liteDOM', mathml ? ['a11y/assistive-mml'] : []);
config.loader.paths = { mathjax: 'mathjax' };
config.loader.require = require;
// (the components add options for the menu, which isn't loaded, and MathJax
// would warn about them)
config.loader.ready = () => {
  delete MathJax.config.options.menuOptions;
  MathJax.loader.defaultReady();
};
Object.assign(config.options, { enableEnrichment: false, enableSpeech: false, enableBraille: false });
// (an option of a11y/assistive-mml's, which MathJax warns of without it)
if (mathml) config.options.enableAssistiveMml = true;
config.startup.document = html;
globalThis.MathJax = config;
require('mathjax/tex-chtml.js');
await MathJax.startup.promise;

const adaptor = MathJax.startup.adaptor;
const document = MathJax.startup.document.document;
const root = adaptor.root(document);
// what was there for MathJax in the browser (data-tex8web-browser): its
// configuration and scripts, and macros.lua's definitions, which it has read
for (const node of [...adaptor.tags(root, 'script'), ...adaptor.tags(root, 'div')]) {
  if (adaptor.hasAttribute(node, 'data-tex8web-browser')) adaptor.remove(node);
}
// MathJax's styles, in a file of their own (make4ht's later passes over
// the page would escape the > in them), with its fonts, from node_modules
const files = [];
const style = adaptor.tags(adaptor.head(document), 'style').find(s => adaptor.getAttribute(s, 'id') === 'MJX-CHTML-styles');
const css = adaptor.textContent(style).replace(/url\("([^"]+\.woff2)"\)/g, (_, url) => {
  const name = basename(url);
  const path = join(dirname(file), 'fonts', 'mathjax', name);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(require.resolve(url), path);
  files.push(path);
  return `url("fonts/mathjax/${name}")`;
});
const cssFile = file.replace(/\.html$/, '') + '-mathjax.css';
writeFileSync(cssFile, css);
files.push(cssFile);
adaptor.replace(adaptor.node('link', { rel: 'stylesheet', href: basename(cssFile) }), style);

// (data-latex holds each node's source, for MathJax's menu)
const page = adaptor.doctype(document) + '\n' + adaptor.outerHTML(root)
  .replace(/ data-latex(-item)?="[^"]*"/g, '');
writeFileSync(file, page);
const errors = (page.match(/<mjx-merror/g) || []).length;
if (errors) console.error(`${errors} formula(s) with MathJax errors`);
console.log(files.join('\n'));
// (MathJax leaves workers running, which would keep Node alive)
process.exit(0);
