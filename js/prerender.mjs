// Typesets the math of a page built by tex8web.mk4, in place, with MathJax
// in Node, so the math shows without JavaScript, also saved or offline. Run
// by prerender.lua; see CONTRIBUTING.md, "Prerendering".
//   node prerender.mjs page.html
// MathJax is configured from the page's tex8web-config with tex8web.js, as
// in the browser. MathJax's styles go into page-mathjax.css and their fonts
// into fonts/mathjax/, next to the page. The paths of the files written are
// printed, for prerender.lua to add to the output. MathJax's, Latin
// Modern, and TeX Live's fonts are cut down to the document's characters.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, renameSync, rmSync } from 'node:fs';
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
// all math at once (no ui/lazy) and no menu, which needs a browser. No
// assistive MathML unless TEX8WEB_MATHML is set, as in the tests, which
// check the math through it (CONTRIBUTING.md, "No assistive MathML").
// Screen readers get MathJax's speech instead (below).
const mathml = Boolean(process.env.TEX8WEB_MATHML);
config.loader.load = config.loader.load.filter(name => name !== 'ui/lazy')
  .concat('adaptors/liteDOM', mathml ? ['a11y/assistive-mml'] : []);
config.loader.paths = { mathjax: 'mathjax' };
config.loader.require = require;
// the components add options for the menu, which is not loaded, and MathJax
// would warn about them
config.loader.ready = () => {
  delete MathJax.config.options.menuOptions;
  MathJax.loader.defaultReady();
};
Object.assign(config.options, { enableEnrichment: false, enableSpeech: false, enableBraille: false });
// an option of a11y/assistive-mml, without which MathJax warns
if (mathml) config.options.enableAssistiveMml = true;
config.startup.document = html;
globalThis.MathJax = config;
require('mathjax/tex-chtml.js');
await MathJax.startup.promise;

// macros unknown to MathJax, which its noundefined extension draws as their
// names in red: an mtext with an explicit mathcolor that holds \name. npm
// test fails on a line that starts with "tex8web:".
const unknown = new Set();
for (const { root } of MathJax.startup.document.math) {
  root.walkTree(node => {
    if (node.isKind('mtext') && node.attributes.getExplicit('mathcolor')
        && /^\\([A-Za-z@]+|.)$/.test(node.getText())) unknown.add(node.getText());
  });
}
if (unknown.size) {
  console.error(`tex8web: ${unknown.size} macro(s) MathJax doesn't know, shown in red: `
    + `${[...unknown].sort().join(', ')}. Define them for MathJax with \\WebMathMacros in your config`);
}

const adaptor = MathJax.startup.adaptor;
const document = MathJax.startup.document.document;
const root = adaptor.root(document);
// what only MathJax in the browser needs (data-tex8web-browser): its
// configuration, its scripts, and macros.lua's definitions, all read by now
for (const node of [...adaptor.tags(root, 'script'), ...adaptor.tags(root, 'div')]) {
  if (adaptor.hasAttribute(node, 'data-tex8web-browser')) adaptor.remove(node);
}
// MathJax's output with fewer elements (CONTRIBUTING.md, "Fewer elements").
// Each element removed adds nothing to the boxes inside it that its one
// character cannot take on: MathJax gives these tags display: inline-block,
// and math has line-height 0 (checked in prerender-rules.mjs). test:visual
// compares the result with MathJax's output in the browser.
// attributes(): all but data-latex, which is removed below
const attributes = node => adaptor.allAttributes(node).filter(({ name }) => !name.startsWith('data-latex'));
const only = (node, names) => attributes(node).every(({ name }) => names.includes(name));
const has = (node, name) => adaptor.getAttribute(node, name) != null;
const isElement = node => !adaptor.kind(node).startsWith('#');

// a token of one character becomes its mjx-c, which takes the token's space
// and size
function token(node) {
  const [c, ...rest] = adaptor.childNodes(node);
  if (rest.length || !c || adaptor.kind(c) !== 'mjx-c' || !only(c, ['class'])
      || !only(node, ['space', 'size'])) return;
  for (const { name, value } of attributes(node)) adaptor.setAttribute(c, name, value);
  adaptor.replace(c, node);
}

// a script of one character becomes its mjx-c, raised or lowered by itself,
// with the script's padding (from MathJax's CSS) and margin. These lengths
// are in the script's em, which the character's size makes smaller: calc()
// keeps each length as it was, so each rounds to layout units as before.
// The character's left padding is otherwise unused.
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

// whether node's contents are left-aligned: by MathJax's CSS for these
// tags, and through the parent for mjx-script and mjx-mstyle, which set no
// alignment
const left = node => [...tokens, ...wrappers, 'mjx-math'].includes(adaptor.kind(node))
  || (['mjx-script', 'mjx-mstyle'].includes(adaptor.kind(node)) && left(adaptor.parent(node)));

// a wrapper is replaced by its children, if its parent also left-aligns
// them. Its space and rspace (margins, in the em of the element they are
// on) move to its first and last child, which must then have its size. Its
// size moves only to an only child.
function unwrap(node) {
  const children = adaptor.childNodes(node);
  if (!children.length || !children.every(isElement) || !left(adaptor.parent(node))
      || !only(node, ['texclass', 'space', 'rspace', 'size'])) return;
  const [first, last] = [children[0], children.at(-1)];
  const size = adaptor.getAttribute(node, 'size');
  // a child whose style, or a class other than an mjx-c's font class, may
  // set its margins or font size
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

// inside out, so a script's character is unwrapped from its token first
function flatten(node) {
  for (const child of adaptor.childNodes(node)) if (isElement(child)) flatten(child);
  const kind = adaptor.kind(node);
  if (tokens.includes(kind)) token(node);
  else if (kind === 'mjx-script') script(node);
  else if (wrappers.includes(kind)) unwrap(node);
}
// MathJax's CSS gives each child of a breakable inline formula the upright
// font, which would override the font of a character moved up among them.
// The rule is narrowed to skip mjx-c below. If MathJax's rule has changed,
// the math is left unchanged.
const style = adaptor.tags(adaptor.head(document), 'style').find(s => adaptor.getAttribute(s, 'id') === 'MJX-CHTML-styles');
// the font's class prefix: TEX in TEX-N, or GT in GT-N with Termes
const prefix = MathJax.startup.output.font.cssFontPrefix;
const breakable = `mjx-container[jax="CHTML"] > mjx-math.${prefix}-N[breakable] > * {`;
const mathjaxCss = adaptor.textContent(style);
const rules = readRules(mathjaxCss, [...tokens, ...wrappers, 'mjx-math', 'mjx-script'].filter(tag => adaptor.tags(root, tag).length));
if (!mathjaxCss.includes(breakable) && adaptor.tags(root, 'mjx-math').some(math => has(math, 'breakable'))) {
  rules.problems.push(`no "${breakable}"`);
}
// on any problem, the math is left as MathJax typeset it. npm test fails on
// a line that starts with "MathJax:".
const flat = !rules.problems.length;
for (const problem of rules.problems) console.error(`MathJax: ${problem} in its styles; prerender.mjs needs updating`);
for (const math of flat ? adaptor.tags(root, 'mjx-math') : []) {
  for (const child of adaptor.childNodes(math)) if (isElement(child)) flatten(child);
}
// tex4ht's span around inline math: used by the earlier passes, and after
// this one only when it gives the math a size (tex8web-math.tex)
for (const span of adaptor.tags(root, 'span')) {
  const [container, ...rest] = adaptor.childNodes(span);
  if (!rest.length && container && adaptor.kind(container) === 'mjx-container'
      && only(span, ['class']) && adaptor.getAttribute(span, 'class') === 'mathjax-inline') {
    adaptor.replace(container, span);
  }
}

// MathJax's styles go in a separate file, because make4ht's later passes
// over the page would escape the > in them. Their fonts come from
// node_modules.
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

// Each formula's speech, as MathJax's menu would give it (CONTRIBUTING.md,
// "Speech"): the container (role math, which may be named) is named by it,
// and its contents are hidden from screen readers, which would read them
// too. A formula with nothing to say (\, or a \phantom) is hidden whole.
// The speech comes from a second typesetting, because the enrichment
// changes the math (an invisible function application after Δ in Δ(S)) and
// adds a tenth more elements. It runs after MathJax's styles are read,
// because the output jax, shared by both, adds the enriched math's styles.
// It finds the same math in the same order. The TeX input keeps the macros
// of the first typesetting, among them macros.lua's, which tex8web.js gives
// it only once, so a \def in the math also applies in the speech of the
// formulas before it.
MathJax.texReset();

// While the speech is typeset, the math is adjusted for the speech rule
// engine. TeX's upright letters (Γ, a \mathrm{d}) lose MathJax's
// mathvariant="normal", spoken as "normal Gamma". A^\top, spoken as "A
// raised to the down tack power", becomes A then the word "transpose",
// except on an operator, as in \int^\top.
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

// the speech cache (CONTRIBUTING.md, "Speech"), keyed by all MathJax sends
// its worker (internal: WorkerHandler.Speech), the enriched MathML and the
// options, by MathJax's version, and by the text of this script and
// prerender-rules.mjs, which shape the speech in ways the options do not
// show. A \def, a \label, or tex8web.js's columns change a formula's
// MathML, and so its key. Of what the worker returns, only the label
// reaches the page (outputData.speech, which Attach leaves unset when it is
// empty). The rest goes on the second typesetting's elements. Only this
// page's speech is written back.
const cacheFile = process.env.TEX8WEB_SPEECH_CACHE || file.replace(/\.html$/, '') + '-speech.json';
const scripts = ['prerender.mjs', 'prerender-rules.mjs'].map(name => readFileSync(new URL(name, import.meta.url), 'utf8'));
let cached = new Map();
try {
  cached = new Map(Object.entries(JSON.parse(readFileSync(cacheFile, 'utf8'))));
} catch {}
const said = new Map();
const kept = {};
const { WorkerHandler } = MathJax._.a11y.speech.WebWorker;
const speak = WorkerHandler.prototype.Speech;
WorkerHandler.prototype.Speech = async function (mml, options, item) {
  const key = createHash('sha256').update(JSON.stringify([MathJax.version, scripts, mml, options])).digest('base64');
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
// A cache that cannot be written only means that the next build makes all
// speech again, as does a partly written file, which does not parse. The
// file is renamed into place because builds of the same document from other
// checkouts may share it, and one would otherwise lose the other's.
const written = `${cacheFile}.${process.pid}`;
try {
  writeFileSync(written, JSON.stringify(kept));
  renameSync(written, cacheFile);
} catch {
  rmSync(written, { force: true });
}
const items = [...MathJax.startup.document.math];
const speeches = [...spoken.math];
if (speeches.length !== items.length) {
  throw new Error(`MathJax found ${speeches.length} formulas for the speech and ${items.length} in the page`);
}
// MathJax typesets a numbered equation as a table of one row, and its
// speech says so: "1 lines Line 1: a equals b Label 1". The speech rule
// engine's options for tables apply to every table, so the prefix is cut.
speeches.forEach(({ outputData: { speech } }, i) => {
  const container = items[i].typesetRoot;
  if (!speech) return adaptor.setAttribute(container, 'aria-hidden', 'true');
  adaptor.setAttribute(container, 'role', 'math');
  adaptor.setAttribute(container, 'aria-label', speech.replace(/^1 lines Line 1: /, ''));
  adaptor.setAttribute(adaptor.tags(container, 'mjx-math')[0], 'aria-hidden', 'true');
});

// the fonts the math uses, for tex8web-fonts.js to preload
// (CONTRIBUTING.md, "Preloaded fonts"). A font fetched when first laid out
// makes the whole page lay out again: on a phone, a quarter of a second for
// a long page, each time. A font is used if its name is a class in the math
// (MJX-TEX-C, TEX-C). ZERO comes with every font, and BRK draws where a
// line breaks (an mjx-break, or a line of a breakable display).
const classes = new Set();
const collect = node => {
  for (const name of (adaptor.getAttribute(node, 'class') || '').split(' ')) classes.add(name);
  for (const child of adaptor.childNodes(node)) if (isElement(child)) collect(child);
};
for (const math of adaptor.tags(root, 'mjx-math')) collect(math);
const breaks = adaptor.tags(root, 'mjx-break').length > 0
  || adaptor.tags(root, 'mjx-linestack').some(stack => has(stack, 'breakable'));
const preloaded = [];
for (const [, family, url] of css.matchAll(/font-family: (MJX-[\w-]+);\s*src: url\("([^"]+)"\)/g)) {
  const name = family.slice('MJX-'.length);
  if (classes.has(name) || (name === `${prefix}-ZERO` && classes.size) || (name === 'BRK' && breaks)) {
    preloaded.push(url);
  }
}
const headScript = adaptor.tags(root, 'script').find(s => adaptor.getAttribute(s, 'id') === 'tex8web-fonts');
if (preloaded.length) {
  const listed = adaptor.getAttribute(headScript, 'data-fonts');
  adaptor.setAttribute(headScript, 'data-fonts', [...(listed ? [listed] : []), ...preloaded].join(' '));
}

// data-latex holds each node's source, for MathJax's menu
const page = adaptor.doctype(document) + '\n' + adaptor.outerHTML(root)
  .replace(/ data-latex(-item)?="[^"]*"/g, '');
// the fonts, each cut down to the characters in the page and its styles: a
// third as much to fetch. Also the characters a browser may draw itself: a
// hyphen where it breaks a word, the ellipsis of the bar's entry
// (text-overflow), the capitals of small caps (Latin Modern has none of its
// own), and accents composed or not. And Latin-1, for what a reader types
// into the search field. Done before the page is written, so a failure here
// leaves the page as it was, for MathJax in the browser (prerender.lua).
const dir = dirname(file);
const read = pattern => readdirSync(dir).filter(name => pattern.test(name))
  .map(name => readFileSync(join(dir, name), 'utf8')).join('');
// the character of an entity or a CSS escape
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
// the Latin Modern fonts that assets.lua copied
const latinModern = new URL('../fonts/', import.meta.url);
for (const name of readdirSync(latinModern).filter(name => name.endsWith('.woff2'))) {
  const path = join(dir, 'fonts', name);
  if (existsSync(path)) fonts.push([new URL(name, latinModern), path]);
}
// TeX Live's fonts that the page's stylesheet names with their OpenType
// files (assets.lua): TeX Gyre and XCharter
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
// MathJax's fonts state their license, the SIL Open Font License, in their
// names 13 and 14, which HarfBuzz drops unless asked
await Promise.all(fonts.map(async ([source, path]) => writeFileSync(path,
  await subsetFont(readFileSync(source), chars, { targetFormat: 'woff2', preserveNameIds: [7, 13, 14] }))));
writeFileSync(file, page);
const errors = (page.match(/<mjx-merror/g) || []).length;
if (errors) console.error(`${errors} formula(s) with MathJax errors`);
console.log(files.join('\n'));
// MathJax leaves workers running, which would keep Node alive
process.exit(0);
