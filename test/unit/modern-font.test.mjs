// Unit test for the tables in js/tex8web.js that give mathjax-modern the
// PDF's \mathbb, \mathcal, \widehat, \widetilde, delimiters, and braces,
// run by npm test:
//   node --test test/unit/modern-font.test.mjs
// Each table is made again from MathJax's fonts in node_modules: New
// Computer Modern's double-struck capitals, the TeX font's calligraphic and
// bold calligraphic capitals, wide accents, and pieces of bars and braces,
// and the delimiter sizes of both fonts. When MathJax's fonts change, the test fails and prints the
// table to paste into tex8web.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

test("\\widehat's and \\widetilde's sizes are the TeX font's", () => {
  for (const [name, file, mark] of [['wideSO', 'smallop', 'smallop'], ['wideLO', 'largeop', 'largeop'],
    ['wideS3', 'size3', 'size3'], ['wideS4', 'size4', 'size4']]) {
    check(table(name, [0x2C6, 0x2DC], literal(read(`@mathjax/mathjax-tex-font/cjs/chtml/${file}.js`), `exports.${mark} =`)));
  }
  // (the delimiters' data names a direction, so is read as text)
  const delimiters = read('@mathjax/mathjax-tex-font/cjs/chtml/delimiters.js');
  const sizes = code => delimiters.match(new RegExp(`${code}: \\{[^}]*sizes: \\[([^\\]]*)\\]`))[1];
  assert.equal(sizes('0x7E'), sizes('0x5E'));
  check(`    const sizes = [${sizes('0x5E')}];\n`);
  // the narrowest, mathjax-modern's own ˆ and ˜
  const normal = literal(read('@mathjax/mathjax-modern-font/cjs/chtml/normal.js'), 'exports.normal =');
  assert.deepEqual([normal[0x2C6][2], normal[0x2DC][2]], [0.5, 0.5]);
  assert.match(sizes('0x5E'), /^\.5,/);
});

test("the delimiters' sizes are those nearest the TeX font's", () => {
  // (as in the wide accents' test, the data is read as text)
  const sizes = (font, code) => read(`@mathjax/mathjax-${font}-font/cjs/chtml/delimiters.js`)
    .match(new RegExp(`0x${code.toString(16).toUpperCase()}: \\{[^}]*sizes: \\[([^\\]]*)\\]`))[1].split(', ').map(Number);
  // each mathjax-modern size nearest one of the TeX font's, for the
  // delimiters with codes in the order of tex8web.js
  const groups = new Map();
  for (const code of [0x28, 0x29, 0x5B, 0x5D, 0x7B, 0x7D, 0x27E8, 0x27E9, 0x230A, 0x230B, 0x2308, 0x2309, 0x2F, 0x5C,
    0x7C, 0x2016, 0x2223, 0x2225, 0x2758]) {
    const modern = sizes('modern', code);
    const variants = sizes('tex', code).map(size => modern.reduce((best, h, i) =>
      Math.abs(h - size) < Math.abs(modern[best] - size) ? i : best, 0)).join(', ');
    groups.set(variants, [...groups.get(variants) ?? [], `0x${code.toString(16).toUpperCase()}`]);
  }
  for (const [variants, codes] of groups) check(`    keep([${codes.join(', ')}], [${variants}]);\n`);
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
