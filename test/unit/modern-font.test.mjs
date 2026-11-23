// Unit test for the tables in js/tex8web.js that give mathjax-modern the
// PDF's \mathbb, \mathcal, \widehat, and \widetilde, run by npm test:
//   node --test test/unit/modern-font.test.mjs
// Each table is made again from MathJax's fonts in node_modules: New
// Computer Modern's double-struck capitals, and the TeX font's calligraphic
// and bold calligraphic capitals and wide accents. When MathJax's fonts
// change, the test fails and prints the table to paste into tex8web.js.
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
const entry = (code, [h, d, w, options]) => `0x${code.toString(16).toUpperCase()}: [${[h, d, w].map(number).join(', ')}`
  + (options ? `, {${Object.entries(options).map(([key, n]) => `${key}: ${number(n)}`).join(', ')}}` : '') + ']';
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
