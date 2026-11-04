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
// MathJax's output with fewer elements: a phone's browser restyles a long
// page as it scrolls, in time that grows with its elements, most of them
// MathJax's. Each element left out adds nothing to the boxes inside it but
// what its one character can take on itself (MathJax gives these tags
// display: inline-block, and math has line-height 0), so the page looks the
// same, as test:visual checks against MathJax's own output in the browser
const tokens = ['mjx-mi', 'mjx-mo', 'mjx-mn'];
const wrappers = ['mjx-TeXAtom', 'mjx-msub', 'mjx-msup', 'mjx-msubsup', 'mjx-mrow'];
// (MathJax's font sizes, which an em in the element itself scales by)
const sizes = { s: 0.707, ss: 0.5, Tn: 0.6, sm: 0.85, lg: 1.2, Lg: 1.44, LG: 1.73, hg: 2.07, HG: 2.49 };
// (an element's attributes, but data-latex, which the page loses below)
const attributes = node => adaptor.allAttributes(node).filter(({ name }) => !name.startsWith('data-latex'));
const only = (node, names) => attributes(node).every(({ name }) => names.includes(name));
const has = (node, name) => adaptor.getAttribute(node, name) != null;
const isElement = node => !adaptor.kind(node).startsWith('#');

// a token of one character: the character (mjx-c), which takes its
// spacing and size
function token(node) {
  const [c, ...rest] = adaptor.childNodes(node);
  if (rest.length || !c || adaptor.kind(c) !== 'mjx-c' || !only(c, ['class'])
      || !only(node, ['space', 'size'])) return;
  for (const { name, value } of attributes(node)) adaptor.setAttribute(c, name, value);
  adaptor.replace(c, node);
}

// a script of one character: the character, raised or lowered itself, with
// the script's padding (MathJax's CSS: .033em left, .05em right) and
// margin. Each in the script's ems, which the character's size makes
// smaller: calc() keeps each length as it was, to round to the layout's
// units on its own as before (the character's left padding is free)
function script(node) {
  const [c, ...rest] = adaptor.childNodes(node);
  if (rest.length || !c || adaptor.kind(c) !== 'mjx-c' || !only(c, ['class', 'size'])
      || !only(node, ['style'])) return;
  const scale = has(c, 'size') ? sizes[adaptor.getAttribute(c, 'size')] : 1;
  if (!scale) return;
  const em = n => scale === 1 ? `${n}em` : `calc(${n}em / ${scale})`;
  const style = { 'padding-left': em(0.033), 'margin-right': em(0.05) };
  for (const part of (adaptor.getAttribute(node, 'style') || '').split(';').filter(p => p.trim())) {
    const [, name, value] = part.match(/^\s*([\w-]+):\s*(-?[\d.]+)(?:em)?\s*$/) || [];
    if (!['vertical-align', 'margin-left'].includes(name)) return;
    if (+value) style[name] = em(+value);
  }
  adaptor.setAttribute(c, 'style', Object.entries(style).map(([name, value]) => `${name}: ${value};`).join(' '));
  adaptor.replace(c, node);
}

// whether what's in node lines up on the left, as MathJax's CSS has it
// for these tags, and so for a script's two lines, which don't say
const left = node => [...tokens, ...wrappers, 'mjx-math'].includes(adaptor.kind(node))
  || (['mjx-script', 'mjx-mstyle'].includes(adaptor.kind(node)) && left(adaptor.parent(node)));

// a wrapper: its children, in its place, in a parent that also lines them
// up on the left. Its space and rspace (margins, in the em of the element
// they're on) go to its first and last child, which must then be of its
// size; its size only to an only child
function unwrap(node) {
  const children = adaptor.childNodes(node);
  if (!children.length || !children.every(isElement) || !left(adaptor.parent(node))
      || !only(node, ['texclass', 'space', 'rspace', 'size'])) return;
  const [first, last] = [children[0], children.at(-1)];
  const size = adaptor.getAttribute(node, 'size');
  const style = child => adaptor.getAttribute(child, 'style') || '';
  const sized = child => has(child, 'size') || style(child).includes('font-size');
  if (size && (children.length > 1 || sized(first))) return;
  const free = (child, name, margin) => !has(child, name) && (size || !sized(child))
    && !style(child).includes(margin);
  if (has(node, 'space') && !free(first, 'space', 'margin-left')) return;
  if (has(node, 'rspace') && !free(last, 'rspace', 'margin-right')) return;
  if (size) adaptor.setAttribute(first, 'size', size);
  if (has(node, 'space')) adaptor.setAttribute(first, 'space', adaptor.getAttribute(node, 'space'));
  if (has(node, 'rspace')) adaptor.setAttribute(last, 'rspace', adaptor.getAttribute(node, 'rspace'));
  for (const child of children) adaptor.insert(child, node);
  adaptor.remove(node);
}

// (from the inside out: a script's character is a token first)
function flatten(node) {
  for (const child of adaptor.childNodes(node)) if (isElement(child)) flatten(child);
  const kind = adaptor.kind(node);
  if (tokens.includes(kind)) token(node);
  else if (kind === 'mjx-script') script(node);
  else if (wrappers.includes(kind)) unwrap(node);
}
for (const math of adaptor.tags(root, 'mjx-math')) {
  for (const child of adaptor.childNodes(math)) if (isElement(child)) flatten(child);
}
// (tex4ht's span around inline math, which the passes before this one look
// for, and nothing after; but not at the top of the body, where make4ht's
// fixinlines, after this, gathers text and inline elements such as a span,
// but not an mjx-container, into a paragraph)
for (const span of adaptor.tags(root, 'span')) {
  const [container, ...rest] = adaptor.childNodes(span);
  if (!rest.length && container && adaptor.kind(container) === 'mjx-container'
      && adaptor.kind(adaptor.parent(span)) !== 'body'
      && only(span, ['class']) && adaptor.getAttribute(span, 'class') === 'mathjax-inline') {
    adaptor.replace(container, span);
  }
}

// MathJax's styles, in a file of their own (make4ht's later passes over
// the page would escape the > in them), with its fonts, from node_modules
const files = [];
const style = adaptor.tags(adaptor.head(document), 'style').find(s => adaptor.getAttribute(s, 'id') === 'MJX-CHTML-styles');
// (MathJax gives each child of a breakable inline formula its upright font,
// which would win over the font of a character now among them)
const breakable = 'mjx-container[jax="CHTML"] > mjx-math.TEX-N[breakable] > * {';
const mathjaxCss = adaptor.textContent(style);
if (adaptor.tags(root, 'mjx-math').some(math => has(math, 'breakable')) && !mathjaxCss.includes(breakable)) {
  console.error(`MathJax: no "${breakable}" in its styles to narrow; prerender.mjs needs updating`);
}
const css = mathjaxCss.replace(breakable, breakable.replace('> * {', '> :not([class*="TEX-"]) {'))
  .replace(/url\("([^"]+\.woff2)"\)/g, (_, url) => {
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
