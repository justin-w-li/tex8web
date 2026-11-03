// Typesets the math of a page tex8web.mk4 made, in place, with MathJax in Node:
// the page then shows its math without JavaScript, also saved or offline.
// tex8web.mk4 runs it when node_modules is installed (npm ci in this directory).
//   node prerender.mjs page.html
// It uses the page's own MathJax configuration and tex8web.js, as the browser
// would. MathJax's styles go into page-mathjax.css, and the fonts they use
// into fonts/mathjax/, next to the page; it prints their paths, for tex8web.mk4
// to list with the output.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const file = process.argv[2];
const html = readFileSync(file, 'utf8');

// the page's scripts that set window.MathJax (the configuration) and
// window.tex8web (lengths for tex8web.js), run on a window of their own (with a
// global window, MathJax would take Node for a browser)
const window = {};
const pageScript = /<script>((?:(?!<\/script>)[\s\S])*\bwindow\.(?:MathJax|tex8web) =(?:(?!<\/script>)[\s\S])*)<\/script>\s*/g;
for (const [, code] of html.matchAll(pageScript)) new Function('window', code)(window);
const config = window.MathJax;
// everything at once, and MathML for screen readers, but no menu (it needs
// the browser)
config.loader.load = config.loader.load.filter(name => name !== 'ui/lazy')
  .concat('adaptors/liteDOM', 'a11y/assistive-mml');
config.loader.paths = { mathjax: 'mathjax' };
config.loader.require = require;
config.options = { enableEnrichment: false, enableSpeech: false, enableBraille: false,
  enableAssistiveMml: true };
config.startup = { document: html.replace(pageScript, '') };
// (the components add options for the menu, which isn't loaded, and MathJax
// would warn about them)
config.loader.ready = () => {
  delete MathJax.config.options.menuOptions;
  MathJax.loader.defaultReady();
};
globalThis.MathJax = config;
new Function('window', readFileSync(new URL('tex8web.js', import.meta.url), 'utf8'))(window);
require('mathjax/tex-chtml.js');
await MathJax.startup.promise;

const adaptor = MathJax.startup.adaptor;
const document = MathJax.startup.document.document;
for (const script of adaptor.tags(adaptor.root(document), 'script')) {
  if (/(^|\/)(tex8web\.js|tex-chtml\.js)$/.test(adaptor.getAttribute(script, 'src') || '')) adaptor.remove(script);
}
// (macros.lua's definitions, which MathJax has read)
for (const div of adaptor.tags(adaptor.root(document), 'div')) {
  if (adaptor.hasClass(div, 'tex8web-macros')) adaptor.remove(div);
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
const page = adaptor.doctype(document) + '\n' + adaptor.outerHTML(adaptor.root(document))
  .replace(/ data-latex(-item)?="[^"]*"/g, '');
writeFileSync(file, page);
const errors = (page.match(/<mjx-merror/g) || []).length;
if (errors) console.error(`${errors} formula(s) with MathJax errors`);
console.log(files.join('\n'));
process.exit(0);
