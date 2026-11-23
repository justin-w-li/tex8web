// Unit test for the tables in js/tex8web.js that give mathjax-modern the
// PDF's \mathbb, \mathcal, \widehat, \widetilde, delimiters, braces, and
// accents over the letters of its dynamic files, run by npm test:
//   node --test test/unit/modern-font.test.mjs
// Each table is made again from MathJax's fonts in node_modules: New
// Computer Modern's double-struck capitals, the TeX font's calligraphic and
// bold calligraphic capitals, wide accents, and pieces of bars and braces,
// the delimiter sizes of both fonts, and the skews of the letters New
// Computer Modern has only in its dynamic files. When MathJax's fonts change, the test fails and prints the
// table to paste into tex8web.js.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const read = path => readFileSync(require.resolve(path), 'utf8');
const source = readFileSync(new URL('../../js/tex8web.js', import.meta.url), 'utf8');

// the object literal that follows a mark in a font's data file, which holds
// only numbers
function literal(text, mark) {
  const from = text.indexOf('{', text.indexOf(mark));
  let depth = 0, to = from;
  do depth += { '{': 1, '}': -1 }[text[to++]] ?? 0; while (depth);
  return Function(`return (${text.slice(from, to)})`)();
}

const number = n => String(n).replace(/^(-?)0\./, '$1.');
// (a string, as the characters a glyph is drawn with, in \u escapes)
const value = n => typeof n === 'string'
  ? `'${[...n].map(c => `\\u${c.codePointAt(0).toString(16).toUpperCase()}`).join('')}'` : number(n);
const entry = (code, [h, d, w, options]) => `0x${code.toString(16).toUpperCase()}: [${[h, d, w].map(number).join(', ')}`
  + (options ? `, {${Object.entries(options).map(([key, n]) => `${key}: ${value(n)}`).join(', ')}}` : '') + ']';
// a table as tex8web.js declares it, two characters a line, or on one line
// with the name when it has two
function table(name, codes, chars) {
  const entries = codes.map(code => entry(code, chars[code]));
  if (entries.length === 2) return `    const ${name} = {${entries.join(', ')}};\n`;
  const lines = [];
  for (let i = 0; i < entries.length; i += 2) lines.push(`      ${entries.slice(i, i + 2).join(', ')},`);
  return `    const ${name} = {\n${lines.join('\n')}\n    };\n`;
}
const capitals = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const check = text => assert.ok(source.includes(text), `js/tex8web.js does not hold this table:\n${text}`);

test("\\mathbb's capitals are New Computer Modern's", () => {
  const data = literal(read('@mathjax/mathjax-newcm-font/cjs/chtml/dynamic/double-struck.js'), "'normal':");
  // (the capitals that Unicode has in Letterlike Symbols)
  const letterlike = { C: 0x2102, H: 0x210D, N: 0x2115, P: 0x2119, Q: 0x211A, R: 0x211D, Z: 0x2124 };
  check(table('doubleStruck', capitals.map((letter, i) => letterlike[letter] ?? 0x1D538 + i), data));
});

test("\\mathcal's capitals are the TeX font's", () => {
  const codes = capitals.map(letter => letter.charCodeAt(0));
  check(table('calligraphic', codes, literal(read('@mathjax/mathjax-tex-font/cjs/chtml/tex-calligraphic.js'), 'exports.texCalligraphic =')));
  check(table('boldCalligraphic', codes, literal(read('@mathjax/mathjax-tex-font/cjs/chtml/tex-calligraphic-bold.js'), 'exports.texCalligraphicBold =')));
});

// a font's delimiters, whose data names a direction
function delimiters(font) {
  const text = read(`@mathjax/mathjax-${font}-font/cjs/chtml/delimiters.js`);
  return Function('Direction_js_1', `return (${text.slice(text.indexOf('{', text.indexOf('exports.delimiters =')),
    text.lastIndexOf('}') + 1)})`)({ V: 'V', H: 'H' });
}
// a call as tex8web.js writes it, wrapped at 112 characters
function call(start, items, end) {
  const lines = [];
  let line = start;
  items.forEach((item, i) => {
    const text = item + (i < items.length - 1 ? ',' : end);
    if (line.trim().length > start.trim().length && line.length + text.length + 1 > 112) {
      lines.push(line.trimEnd());
      line = '      ';
    }
    line += (line.endsWith('(') || line.endsWith('[') || line === '      ' ? '' : ' ') + text;
  });
  return [...lines, line].join('\n') + '\n';
}

test("the sizes of the wide accents, delimiters, and large operators are the TeX font's", () => {
  const tex = delimiters('tex'), modern = delimiters('modern');
  // (the braces, which tex8web.js builds from the TeX font's pieces, and
  // √, whose bar is drawn from the font of its sign)
  const skipped = [0x23DE, 0x23DF, 0xFE37, 0xFE38, 0x221A];
  const wide = [0x5E, 0x7E, 0x2C6, 0x2DC, 0x302, 0x303];
  const sized = [], first = [];
  for (const [code, delimiter] of Object.entries(modern)) {
    const other = tex[code];
    if (!delimiter.sizes || !other?.sizes || skipped.includes(Number(code)) || wide.includes(Number(code))) continue;
    if (other.sizes.length > 1) {
      // the five sizes of cmex, in the size variants both fonts name alike
      assert.equal(other.sizes.length, 5);
      assert.equal(other.variants, undefined);
      // (and a glyph for the sizes, the last of schar's)
      assert.ok(!delimiter.schar || delimiter.schar.length === 2);
      sized.push(Number(code));
    } else if (delimiter.sizes.length > 1) first.push(Number(code));
  }
  const hex = code => `0x${code.toString(16).toUpperCase()}`;
  check(call('    take([', sized.map(hex), ']);'));
  check(call('    keep([', first.map(hex), ']);'));
  // the large operators: the TeX font's large characters that are not its
  // delimiters, but ⁄, which TeX does not make larger
  const glyphs = sized.map(code => modern[code].schar?.at(-1) ?? modern[code].c ?? code);
  const texChars = file => literal(read(`@mathjax/mathjax-tex-font/cjs/chtml/${file}.js`), `exports.${file} =`);
  const delimiterCodes = new Set(Object.entries(tex).flatMap(([code, delimiter]) => [Number(code), delimiter.c]));
  const operators = Object.keys(texChars('largeop')).map(Number).filter(code => !delimiterCodes.has(code) && code !== 0x2044);
  const modernLarge = literal(read('@mathjax/mathjax-modern-font/cjs/chtml/largeop.js'), 'exports.largeop =');
  for (const code of operators) assert.ok(modernLarge[code], `mathjax-modern has no large ${hex(code)}`);
  for (const [name, file, codes] of [['cmexSO', 'smallop', [0x2C6, 0x2DC, ...glyphs, ...operators]],
    ['cmexLO', 'largeop', [0x2C6, 0x2DC, ...glyphs, ...operators]], ['cmexS3', 'size3', [0x2C6, 0x2DC, ...glyphs]],
    ['cmexS4', 'size4', [0x2C6, 0x2DC, ...glyphs]]]) {
    check(table(name, [...new Set(codes)].sort((x, y) => x - y), texChars(file)));
  }
  // the wide accents' sizes; the narrowest, mathjax-modern's own ˆ and ˜
  const sizes = code => tex[code].sizes.map(number).join(', ');
  assert.equal(sizes(0x7E), sizes(0x5E));
  check(`    const sizes = [${sizes(0x5E)}];\n`);
  const normal = literal(read('@mathjax/mathjax-modern-font/cjs/chtml/normal.js'), 'exports.normal =');
  assert.deepEqual([normal[0x2C6][2], normal[0x2DC][2]], [0.5, 0.5]);
  assert.equal(tex[0x5E].sizes[0], 0.5);
  check('delimiters: {...wide(0x2C6, [0x5E, 0x2C6, 0x302]), ...wide(0x2DC, [0x7E, 0x2DC, 0x303])}');
  check('delimiters[0xFE37] = delimiters[0x23DE];\n    delimiters[0xFE38] = delimiters[0x23DF];');
});

test("the bars are built from the TeX font's pieces, and ‖ is drawn as ∥", () => {
  check(table('barPieces', [0x2223, 0x2225], literal(read('@mathjax/mathjax-tex-font/cjs/chtml/smallop.js'), 'exports.smallop =')));
  const [h, d, w] = literal(read('@mathjax/mathjax-modern-font/cjs/chtml/normal.js'), 'exports.normal =')[0x2225];
  check(`0x2016: [${[h, d, w].map(number).join(', ')}, {c: '\\u2225'}]`);
});

test("the braces are the TeX font's", () => {
  check(table('bracePieces', [0xE150, 0xE151, 0xE152, 0xE153, 0xE154, 0xE155, 0xE156],
    literal(read('@mathjax/mathjax-tex-font/cjs/chtml/size4.js'), 'exports.size4 =')));
  const delimiters = read('@mathjax/mathjax-tex-font/cjs/chtml/delimiters.js');
  for (const code of ['0x23DE', '0x23DF']) {
    const data = delimiters.slice(delimiters.indexOf(`${code}: {`)).match(/^[^}]*\}/)[0];
    const list = key => data.match(new RegExp(`${key}: \\[([^\\]]*)\\]`))[1].split(', ').map(number).join(', ');
    check(`delimiters[${code}] = {dir: Font.defaultDelimiters[${code}].dir, stretch: [${list('stretch')}],\n`
      + `      stretchv: [2, 2, 2, 2], HDW: [${list('HDW')}], hd: [${list('hd')}]};`);
  }
});

// the characters of a font's dynamic files, by variant, but those of the
// files skipped: each file calls the font's dynamicSetup with them
function dynamicChars(font, skip = []) {
  const dir = dirname(require.resolve(`@mathjax/mathjax-${font}-font/cjs/chtml/dynamic/double-struck.js`));
  const chars = {}, add = variants => {
    for (const [variant, some] of Object.entries(variants)) Object.assign(chars[variant] ??= {}, some);
  };
  const DynamicFonts = { AddFontIds: fonts => Object.values(fonts).reduce((all, variants) => add(variants) ?? all, chars) };
  const module = new Proxy({}, { get: () => ({ dynamicSetup: () => {} }) });
  for (const file of readdirSync(dir).filter(file => file.endsWith('.js') && !skip.includes(file)).sort()) {
    Function('require', 'exports', readFileSync(join(dir, file), 'utf8'))(path => path.includes('DynamicFonts') ? DynamicFonts : module, {});
  }
  return chars;
}

// the characters of a font's data that comes with the font, by variant
function staticChars(font) {
  const text = read(`@mathjax/mathjax-${font}-font/cjs/chtml.js`);
  const files = Object.fromEntries([...text.matchAll(/var (\w+) = require\("\.\/chtml\/([\w-]+)\.js"\)/g)].map(m => m.slice(1)));
  const list = text.slice(text.indexOf('defaultChars = {'), text.indexOf('};', text.indexOf('defaultChars = {')));
  return Object.fromEntries([...list.matchAll(/'([\w-]+)': (\w+)\.(\w+)/g)].map(([, variant, module, name]) =>
    [variant, literal(read(`@mathjax/mathjax-${font}-font/cjs/chtml/${files[module]}.js`), `exports.${name} =`)]));
}

test("the letters New Computer Modern has only in its dynamic files have its skews", () => {
  // mathjax-modern's letters, but the calligraphic ones, which tex8web.js
  // replaces; those New Computer Modern's data that comes with tex-chtml.js
  // has are set from it in the browser
  const modern = staticChars('modern');
  delete modern['-tex-calligraphic'];
  delete modern['-tex-bold-calligraphic'];
  for (const [variant, chars] of Object.entries(dynamicChars('modern', ['calligraphic.js']))) {
    Object.assign(modern[variant] ??= {}, chars);
  }
  const loaded = staticChars('newcm'), newcm = dynamicChars('newcm');
  const lines = [];
  for (const [variant, chars] of Object.entries(modern)) {
    const entries = [];
    for (const [n, char] of Object.entries(chars)) {
      const other = !loaded[variant]?.[n] && newcm[variant]?.[n];
      if (!Array.isArray(char) || !Array.isArray(other) || char[2] !== other[2]) continue;
      const { sk = 0, dx = 0 } = other[3] ?? {};
      if ((char[3]?.sk ?? 0) === sk && (char[3]?.dx ?? 0) === dx) continue;
      entries.push(`0x${Number(n).toString(16).toUpperCase()}: ${dx ? `[${number(sk)}, ${number(dx)}]` : number(sk)}`);
    }
    if (!entries.length) continue;
    lines.push(`      ${/^[a-z]+$/.test(variant) ? variant : `'${variant}'`}: {`);
    let line = '';
    for (const text of entries) {
      if (line && line.length + text.length > 108) {
        lines.push(`        ${line},`);
        line = '';
      }
      line += (line ? ', ' : '') + text;
    }
    lines.push(`        ${line},`, '      },');
  }
  check(`    const dynamicSkews = {\n${lines.join('\n')}\n    };\n`);
});
