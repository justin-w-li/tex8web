// Unit tests for js/prerender-rules.mjs and prerender.mjs, run by npm test:
// node --test test/unit/prerender.test.mjs
// The rules prerender.mjs reads from MathJax's CSS, and what it says when
// MathJax changes one; and the speech it keeps.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// prerender.mjs's speech kept from one build to the next: a page built
// with it is the page built without, and a formula whose MathML changed,
// by a \def or a label elsewhere, is spoken anew
const page = body => `<!DOCTYPE html>
<html><head><title>speech</title>
<script data-tex8web-browser='' id='tex8web-config' type='application/json'>{"mathjax": {"loader": {"load": []}, "options": {}, "tex": {"tags": "ams"}, "output": {"font": "mathjax-tex"}}, "tex": {"exscale": 1, "baselineskip": 1.2, "jot": 0.3, "pt": 0.1}}</script>
<script id='tex8web-fonts'></script>
</head><body>${body}</body></html>`;
const before = page(String.raw`<p>\(\def\f{x}\f + 1\) \(\f\) \(\,\) \(y\)</p>\begin{equation}\label{a}z\end{equation}<p>\(\eqref{a}\)</p>`);
// (\f and \eqref{a} the same TeX, but not the same math)
const after = page(String.raw`<p>\(\def\f{w}\f + 1\) \(\f\) \(\,\) \(y\)</p>\begin{equation}v\end{equation}\begin{equation}\label{a}z\end{equation}<p>\(\eqref{a}\)</p>`);

test('the speech kept from a build gives the same page, and only what changed is spoken anew', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tex8webspeech'));
  const prerender = (html, cache, mathml = false) => {
    const file = join(dir, 'page.html');
    writeFileSync(file, html);
    const env = { ...process.env, TEX8WEB_SPEECH_CACHE: join(dir, cache) };
    delete env.TEX8WEB_MATHML;
    if (mathml) env.TEX8WEB_MATHML = '1';
    const result = spawnSync(process.execPath, [new URL('../../js/prerender.mjs', import.meta.url).pathname, file], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(file, 'utf8');
  };
  // (each formula's speech, or hidden for none)
  const speech = html => [...html.matchAll(/<mjx-container [^>]*>/g)]
    .map(([tag]) => tag.match(/aria-label="([^"]*)"/)?.[1] ?? (tag.includes('aria-hidden="true"') ? 'hidden' : 'none'));
  const keys = cache => Object.keys(JSON.parse(readFileSync(join(dir, cache), 'utf8'))).sort();
  try {
    const cold = prerender(before, 'speech.json');
    assert.deepEqual(speech(cold).slice(0, 4), ['x plus 1', 'x', 'hidden', 'y']);
    assert.match(cold, /<script [^>]*data-fonts="fonts\/mathjax\/mjx-tex-zero\.woff2 [^"]*"/);
    // (with assistive MathML, the same speech, kept by the same keys)
    const kept = readFileSync(join(dir, 'speech.json'), 'utf8');
    const mathml = prerender(before, 'speech.json', true);
    assert.match(mathml, /<mjx-assistive-mml/);
    assert.deepEqual(speech(mathml), speech(cold));
    assert.deepEqual(keys('speech.json'), Object.keys(JSON.parse(kept)).sort());
    // (one written part way is as none)
    writeFileSync(join(dir, 'fresh.json'), '{"');
    const changed = prerender(after, 'fresh.json');
    writeFileSync(join(dir, 'partial.json'), kept);
    assert.equal(prerender(after, 'partial.json'), changed);
    // (the kept speech marked, to tell it from the speech rule engine's)
    writeFileSync(join(dir, 'speech.json'), JSON.stringify(Object.fromEntries(Object.keys(JSON.parse(kept)).map(key => [key, 'kept']))));
    const warm = speech(prerender(after, 'speech.json'));
    const fresh = speech(changed);
    assert.deepEqual(warm, ['w plus 1', 'w', 'kept', 'kept', fresh[4], fresh[5], fresh[6]]);
    assert.deepEqual(fresh.slice(0, 4), ['w plus 1', 'w', 'hidden', 'y']);
    assert.notDeepEqual(speech(cold).at(-1), fresh.at(-1));
    // (only this build's)
    assert.deepEqual(keys('speech.json'), keys('fresh.json'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
