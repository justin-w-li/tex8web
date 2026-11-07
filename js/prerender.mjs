// Typesets the math of a page tex8web.mk4 made, in place, with MathJax in
// Node: the page then shows its math without JavaScript, also saved or
// offline. tex8web.mk4 runs it when node_modules is installed (npm ci).
//   node prerender.mjs page.html
// It configures MathJax from the page's tex8web-config, with tex8web.js, as
// the browser would. MathJax's styles go into page-mathjax.css and the fonts
// they use into fonts/mathjax/, next to the page; it prints their paths, for
// tex8web.mk4 to list with the output. Those fonts and Latin Modern's
// (assets.lua) are cut down to the characters the document has.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { runInThisContext } from 'node:vm';
import subsetFont from 'subset-font';
import { readRules, tokens, wrappers } from './prerender-rules.mjs';

const require = createRequire(import.meta.url);
const file = process.argv[2];
const html = readFileSync(file, 'utf8');

const data = JSON.parse(html.match(/<script[^>]*id=["']tex8web-config["'][^>]*>([^]*?)<\/script>/)[1]);
runInThisContext(readFileSync(new URL('tex8web.js', import.meta.url), 'utf8'));
const config = globalThis.tex8web(data.mathjax, data.tex);
// everything at once, but no menu (it needs the browser); and no MathML for
// screen readers unless TEX8WEB_MATHML is set (the tests check the math by
// it): a hidden copy of every formula, it is a quarter of a long page and
// most of the time a phone takes to lay the page out. Screen readers get
// MathJax's speech instead (below)
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
// the script's padding (MathJax's CSS) and margin. Each in the script's
// ems, which the character's size makes smaller: calc() keeps each length
// as it was, to round to the layout's units on its own as before (the
// character's left padding is free)
function script(node) {
  const [c, ...rest] = adaptor.childNodes(node);
  if (rest.length || !c || adaptor.kind(c) !== 'mjx-c' || !only(c, ['class', 'size'])
      || !only(node, ['style'])) return;
  const scale = has(c, 'size') ? rules.sizes[adaptor.getAttribute(c, 'size')] : 1;
  if (!scale) return;
  const em = n => scale === 1 ? `${n}em` : `calc(${n}em / ${scale})`;
  const style = { 'padding-left': em(rules.padding.left), 'margin-right': em(rules.padding.right) };
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
  // (a child whose own style, or class, a character's font aside, may set
  // its margins or font size)
  const own = child => /margin|font/.test(adaptor.getAttribute(child, 'style') || '')
    || (adaptor.kind(child) !== 'mjx-c' && has(child, 'class'));
  if (size && (children.length > 1 || has(first, 'size') || own(first))) return;
  const free = (child, name) => !has(child, name) && (size || !has(child, 'size')) && !own(child);
  if (has(node, 'space') && !free(first, 'space')) return;
  if (has(node, 'rspace') && !free(last, 'rspace')) return;
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
// (MathJax gives each child of a breakable inline formula its upright font,
// which would win over the font of a character now among them: its rule is
// narrowed below, and the math left as it is if MathJax has changed it)
const style = adaptor.tags(adaptor.head(document), 'style').find(s => adaptor.getAttribute(s, 'id') === 'MJX-CHTML-styles');
// (the font's classes start with its prefix: TEX-N, or GT-N in Termes)
const prefix = MathJax.startup.output.font.cssFontPrefix;
const breakable = `mjx-container[jax="CHTML"] > mjx-math.${prefix}-N[breakable] > * {`;
const mathjaxCss = adaptor.textContent(style);
const rules = readRules(mathjaxCss, [...tokens, ...wrappers, 'mjx-math', 'mjx-script'].filter(tag => adaptor.tags(root, tag).length));
if (!mathjaxCss.includes(breakable) && adaptor.tags(root, 'mjx-math').some(math => has(math, 'breakable'))) {
  rules.problems.push(`no "${breakable}"`);
}
// (then the math is left as MathJax typeset it; npm test fails on a line
// that starts with MathJax:)
const flat = !rules.problems.length;
for (const problem of rules.problems) console.error(`MathJax: ${problem} in its styles; prerender.mjs needs updating`);
for (const math of flat ? adaptor.tags(root, 'mjx-math') : []) {
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
const fonts = [];
const css = mathjaxCss.replace(breakable, breakable.replace('> * {', '> :not(mjx-c) {'))
  .replace(/url\("([^"]+\.woff2)"\)/g, (_, url) => {
  const name = basename(url);
  const path = join(dirname(file), 'fonts', 'mathjax', name);
  mkdirSync(dirname(path), { recursive: true });
  fonts.push([require.resolve(url), path]);
  files.push(path);
  return `url("fonts/mathjax/${name}")`;
});
const cssFile = file.replace(/\.html$/, '') + '-mathjax.css';
writeFileSync(cssFile, css);
files.push(cssFile);
const stylesheet = adaptor.node('link', { rel: 'stylesheet', href: basename(cssFile) });
adaptor.replace(stylesheet, style);

// each formula's speech, as MathJax's menu would give it, for screen readers:
// its container named by it (role math, which may be named), and what's
// inside hidden from them, which they would read too; a formula with nothing
// to say (\, or a \phantom) hidden whole. From a typesetting of its own,
// since the semantic enrichment speech needs changes the math (an invisible
// function application after Δ in Δ(S), say) and adds a tenth more
// elements; after MathJax's styles are read, as its output, which the two
// share, adds the enriched math's. It finds the same math in the same page,
// in the same order. (The TeX input keeps the macros the first typesetting
// defined, among them macros.lua's, which tex8web.js gives it only once: a
// \def in the math has its meaning in the speech of what comes before it)
MathJax.texReset();

// For the speech only, and so only while it is typeset, the math is
// adjusted for the speech rule engine. TeX's upright letters (Γ, a
// \mathrm{d}) lose MathJax's mathvariant="normal", which it speaks as
// "normal Gamma". And A^\top, which it speaks as "A raised to the down tack
// power", becomes A then the word "transpose" (but not on an operator,
// as in \int^\top)
const tex = MathJax.startup.document.inputJax.find(jax => jax.name === 'TeX');
const { OP } = MathJax._.core.MmlTree.MmlNode.TEXCLASS;
const tokenText = node => node.isToken ? node.getText() : node.childNodes.length === 1 ? tokenText(node.childNodes[0]) : '';
const forSpeech = ({ data }) => data.root.walkTree(node => {
  const factory = data.nodeFactory;
  if (node.isKind('mi') && node.attributes.getExplicit('mathvariant') === 'normal') {
    node.attributes.unset('mathvariant');
  } else if (node.isKind('msup') || node.isKind('msubsup')) {
    const [base, sub, sup] = [node.base, node.sub, node.sup].map(i => node.childNodes[i]);
    if (!sup || !['⊤', '⊺'].includes(tokenText(sup))) return;
    if (base.isEmbellished && base.coreMO().texClass === OP) return;
    const scripted = node.isKind('msup') ? base : factory.create('node', 'msub', [base, sub]);
    node.parent.replaceChild(factory.create('node', 'mrow',
      [scripted, factory.create('token', 'mtext', {}, 'transpose')]), node);
  }
});
tex.postFilters.add(forSpeech);

// The speech rule engine takes most of this script's time, and most
// formulas are the same from one build to the next: what it said of each is
// kept, in TEX8WEB_SPEECH_CACHE (test/lib/build.mjs's) or else beside the
// page among tex4ht's files. It is keyed by all MathJax sends its worker
// (internal: WorkerHandler.Speech), the enriched MathML and the options,
// and by MathJax's version: a \def, a \label or tex8web.js's columns change
// a formula's MathML, and so its key. Of what the worker returns, only the
// label reaches the page (outputData.speech, which Attach leaves unset when
// it is empty); the rest goes on this typesetting's elements. Only what
// this page said is kept.
const cacheFile = process.env.TEX8WEB_SPEECH_CACHE || file.replace(/\.html$/, '') + '-speech.json';
let cached = new Map();
try {
  cached = new Map(Object.entries(JSON.parse(readFileSync(cacheFile, 'utf8'))));
} catch {}
const said = new Map();
const kept = {};
const { WorkerHandler } = MathJax._.a11y.speech.WebWorker;
const speak = WorkerHandler.prototype.Speech;
WorkerHandler.prototype.Speech = async function (mml, options, item) {
  const key = createHash('sha256').update(JSON.stringify([MathJax.version, mml, options])).digest('base64');
  if (!said.has(key)) {
    said.set(key, cached.has(key) ? Promise.resolve(cached.get(key))
      : speak.call(this, mml, options, item).then(() => item.outputData.speech ?? null));
  }
  const label = kept[key] = await said.get(key);
  if (label) item.outputData.speech = label;
};
Object.assign(MathJax.config.options, { enableEnrichment: true, enableSpeech: true },
  mathml && { enableAssistiveMml: false });
const spoken = MathJax.startup.getDocument(html);
await spoken.renderPromise();
tex.postFilters.remove(forSpeech);
// (a file that can't be written means only that the next build speaks
// everything again; one written part way doesn't parse)
try {
  writeFileSync(cacheFile, JSON.stringify(kept));
} catch {}
const items = [...MathJax.startup.document.math];
const speeches = [...spoken.math];
if (speeches.length !== items.length) {
  throw new Error(`MathJax found ${speeches.length} formulas for the speech and ${items.length} in the page`);
}
speeches.forEach(({ outputData: { speech } }, i) => {
  const container = items[i].typesetRoot;
  if (!speech) return adaptor.setAttribute(container, 'aria-hidden', 'true');
  adaptor.setAttribute(container, 'role', 'math');
  adaptor.setAttribute(container, 'aria-label', speech);
  adaptor.setAttribute(adaptor.tags(container, 'mjx-math')[0], 'aria-hidden', 'true');
});

// the fonts the math uses, preloaded: fetched as the page starts loading,
// rather than as each is first laid out, which lays out the whole page
// again (on a phone, a quarter of a second for a long page, each time). A
// font is used if its name is a class in the math (MJX-TEX-C, TEX-C); ZERO
// comes with every one of them, and BRK draws where a line breaks (an
// mjx-break, or a line of a breakable display)
const classes = new Set();
const collect = node => {
  for (const name of (adaptor.getAttribute(node, 'class') || '').split(' ')) classes.add(name);
  for (const child of adaptor.childNodes(node)) if (isElement(child)) collect(child);
};
for (const math of adaptor.tags(root, 'mjx-math')) collect(math);
const breaks = adaptor.tags(root, 'mjx-break').length > 0
  || adaptor.tags(root, 'mjx-linestack').some(stack => has(stack, 'breakable'));
for (const [, family, url] of css.matchAll(/font-family: (MJX-[\w-]+);\s*src: url\("([^"]+)"\)/g)) {
  const name = family.slice('MJX-'.length);
  if (classes.has(name) || (name === `${prefix}-ZERO` && classes.size) || (name === 'BRK' && breaks)) {
    adaptor.insert(adaptor.node('link', { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '',
      href: url }), stylesheet);
  }
}

// (data-latex holds each node's source, for MathJax's menu)
const page = adaptor.doctype(document) + '\n' + adaptor.outerHTML(root)
  .replace(/ data-latex(-item)?="[^"]*"/g, '');
// the fonts, each with only the glyphs of the characters in the document's
// page and styles: a third as much to fetch. With the characters a browser
// may draw itself: a hyphen where it breaks a word, the filter's ellipsis,
// the capitals of small caps (Latin Modern has none of its own), an accent
// composed or not; and Latin-1, for what a reader types into the filter.
// Before the page is written, which tex8web.mk4 takes for typeset only if
// this finishes
const dir = dirname(file);
const read = pattern => readdirSync(dir).filter(name => pattern.test(name))
  .map(name => readFileSync(join(dir, name), 'utf8')).join('');
// (the characters of entities and of CSS's escapes)
const character = (hex, base = 16) => {
  const code = parseInt(hex, base);
  return code <= 0x10ffff ? String.fromCodePoint(code) : '';
};
let text = '\u2010\u2026';
for (let code = 0x20; code <= 0xff; code++) text += String.fromCharCode(code);
text += page.replace(/&#x([\da-f]+);/gi, (_, hex) => character(hex))
  .replace(/&#(\d+);/g, (_, n) => character(n, 10));
text += read(/\.css$/).replace(/\\([\da-f]{1,6}) ?/gi, (_, hex) => character(hex));
text += text.toUpperCase() + text.toLowerCase();
text += text.normalize('NFC') + text.normalize('NFD');
// (Latin Modern's, those assets.lua copied)
const latinModern = new URL('../fonts/', import.meta.url);
for (const name of readdirSync(latinModern).filter(name => name.endsWith('.woff2'))) {
  const path = join(dir, 'fonts', name);
  if (existsSync(path)) fonts.push([new URL(name, latinModern), path]);
}
// (and TeX Live's, those the page's stylesheet names with their OpenType
// files (assets.lua): TeX Gyre's, XCharter)
const opentype = /url\("fonts\/([\w-]+)\.woff2"\) format\("woff2"\), url\("fonts\/\1\.otf"\)/g;
for (const name of new Set([...read(/\.css$/).matchAll(opentype)].map(match => match[1]))) {
  const source = spawnSync('kpsewhich', [`${name}.otf`], { encoding: 'utf8' }).stdout?.trim();
  const path = join(dir, 'fonts', `${name}.woff2`);
  if (source) {
    fonts.push([source, path]);
    files.push(path);
  }
}
const chars = [...new Set(text)].join('');
// (MathJax's fonts state their license, the SIL Open Font License, in
// their names 13 and 14, which HarfBuzz drops unless asked)
await Promise.all(fonts.map(async ([source, path]) => writeFileSync(path,
  await subsetFont(readFileSync(source), chars, { targetFormat: 'woff2', preserveNameIds: [7, 13, 14] }))));
writeFileSync(file, page);
const errors = (page.match(/<mjx-merror/g) || []).length;
if (errors) console.error(`${errors} formula(s) with MathJax errors`);
console.log(files.join('\n'));
// (MathJax leaves workers running, which would keep Node alive)
process.exit(0);
