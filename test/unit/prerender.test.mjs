// Unit test for js/prerender-rules.mjs, run by npm test:
// node --test test/unit/prerender.test.mjs
// The rules prerender.mjs reads from MathJax's CSS, and what it says when
// MathJax changes one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRules, tokens, wrappers } from '../../js/prerender-rules.mjs';

const used = [...tokens, ...wrappers, 'mjx-math', 'mjx-script'];
const tag = name => `${name} {\n  display: inline-block;\n  text-align: left;\n}\n`;
const sizes = { s: 70.7, ss: 50, Tn: 60, sm: 85, lg: 120, Lg: 144, LG: 173, hg: 207, HG: 249 };
const css = [...tokens, ...wrappers].map(tag).join('\n')
  + 'mjx-math {\n  display: inline-block;\n  text-align: left;\n  line-height: 0;\n}\n'
  + 'mjx-script {\n  display: inline-block;\n  padding-right: .05em;\n  padding-left: .033em;\n}\n'
  + Object.entries(sizes).map(([name, percent]) => `mjx-container [size="${name}"] {\n  font-size: ${percent}%;\n}\n`).join('');
const problems = css => readRules(css, used).problems;

test('the values are read from the rules', () => {
  const { sizes: read, padding, problems } = readRules(css.replace('70.7%', '71%').replace('.033em', '.04em'), used);
  assert.deepEqual(problems, []);
  assert.equal(read.s, 0.71);
  assert.equal(read.HG, 2.49);
  assert.equal(readRules(css, used).sizes.s, 0.707);
  assert.deepEqual(padding, { left: 0.04, right: 0.05 });
});
test('a tag with another declaration', () => {
  assert.match(problems(css.replace('mjx-mi {\n', 'mjx-mi {\n  padding: 0;\n'))[0], /^mjx-mi isn't/);
});
test('a tag whose alignment changed', () => {
  assert.match(problems(css.replace('mjx-mo {\n  display: inline-block;\n  text-align: left;', 'mjx-mo {\n  display: inline-block;\n  text-align: center;'))[0], /^mjx-mo isn't/);
});
test('a tag without a rule of its own', () => {
  assert.match(problems(css.replace('mjx-mrow {', 'mjx-mrow, mjx-mfrac {'))[0], /^mjx-mrow isn't/);
});
test('a tag the formulas leave unused may differ', () => {
  assert.deepEqual(readRules(css.replace('mjx-msup {', 'mjx-msup, mjx-mfrac {'), used.filter(name => name !== 'mjx-msup')).problems, []);
});
test('a page without scripts or math needs no rules', () => {
  assert.deepEqual(readRules('', []).problems, []);
});
test('a script with another property', () => {
  assert.match(problems(css.replace('mjx-script {\n', 'mjx-script {\n  margin-left: 1px;\n'))[0], /^mjx-script has margin-left/);
});
test('a script whose padding is not in ems', () => {
  assert.match(problems(css.replace('.05em', '1px'))[0], /padding-right/);
});
test('a missing size', () => {
  assert.match(problems(css.replace('mjx-container [size="Tn"]', 'mjx-container [data-size="Tn"]'))[0], /\[size="Tn"\]/);
});
test('a math that does not line up on the left', () => {
  assert.match(problems(css.replace('line-height: 0', 'line-height: 1'))[0], /^mjx-math isn't/);
});
