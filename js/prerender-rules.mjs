// The MathJax CSS rules that the removal of elements in prerender.mjs relies
// on, read from MathJax's CSS, with a list of the rules that differ. An
// element may be removed only while its rule is as expected.

// the tags prerender.mjs removes: each is a left-aligned inline block
export const tokens = ['mjx-mi', 'mjx-mo', 'mjx-mn'];
export const wrappers = ['mjx-TeXAtom', 'mjx-msub', 'mjx-msup', 'mjx-msubsup', 'mjx-mrow'];

const sizeNames = ['s', 'ss', 'Tn', 'sm', 'lg', 'Lg', 'LG', 'hg', 'HG'];

// the declarations of the rule for exactly this selector, or undefined
function rule(css, selector) {
  const body = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1];
  return body && Object.fromEntries(body.split(';').map(part => part.split(/:(.*)/s).map(s => s.trim()))
    .filter(([name]) => name));
}

// { sizes, padding: { left, right }, problems }: the font-size of each [size]
// as a multiple, a script's padding in em, and the rules that differ from
// those expected. Only tags in used are checked: MathJax writes rules only for
// the tags on the page.
export function readRules(css, used) {
  const problems = [];
  const expect = (selector, wanted, exact) => {
    const found = rule(css, selector) ?? {};
    const names = exact ? new Set([...Object.keys(found), ...Object.keys(wanted)]) : Object.keys(wanted);
    if ([...names].some(name => found[name] !== wanted[name])) {
      problems.push(`${selector} isn't { ${Object.entries(wanted).map(([n, v]) => `${n}: ${v}`).join('; ')} }`
        + (exact ? '' : ' and more'));
    }
    return found;
  };
  for (const tag of used.filter(tag => [...tokens, ...wrappers].includes(tag))) {
    expect(tag, { display: 'inline-block', 'text-align': 'left' }, true);
  }
  if (used.includes('mjx-math')) expect('mjx-math', { 'line-height': '0', 'text-align': 'left' });
  const script = used.includes('mjx-script') ? expect('mjx-script', { display: 'inline-block' }) : {};
  // mjx-script elements are removed, so any other property would be lost
  const extra = Object.keys(script).filter(name => !['display', 'padding-left', 'padding-right'].includes(name));
  if (extra.length) problems.push(`mjx-script has ${extra.join(', ')}, besides display and padding`);
  const padding = {};
  for (const side of used.includes('mjx-script') ? ['left', 'right'] : []) {
    const value = script[`padding-${side}`]?.match(/^(\d*\.?\d+)em$/);
    if (value) padding[side] = +value[1];
    else problems.push(`mjx-script's padding-${side} isn't in ems`);
  }
  const sizes = {};
  for (const name of used.includes('mjx-script') ? sizeNames : []) {
    const percent = rule(css, `mjx-container [size="${name}"]`)?.['font-size']?.match(/^(\d*\.?\d+)%$/);
    if (percent) sizes[name] = +`${percent[1]}e-2`; // (not /100: 70.7 / 100 is 0.7070000000000001)
    else problems.push(`no font-size in percent for [size="${name}"]`);
  }
  return { sizes, padding, problems };
}
