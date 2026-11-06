// What prerender.mjs's pass over MathJax's output assumes of its CSS, read
// from the CSS, with a list of what differs. Dropping an element is right
// only while its rule says what the pass has in mind.

// the tags the pass removes: each lines up what's in it on the left, as an
// inline block
export const tokens = ['mjx-mi', 'mjx-mo', 'mjx-mn'];
export const wrappers = ['mjx-TeXAtom', 'mjx-msub', 'mjx-msup', 'mjx-msubsup', 'mjx-mrow'];

const sizeNames = ['s', 'ss', 'Tn', 'sm', 'lg', 'Lg', 'LG', 'hg', 'HG'];

// the declarations of the rule for exactly this selector, or undefined
function rule(css, selector) {
  const body = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&')} \\{([^}]*)\\}`))?.[1];
  return body && Object.fromEntries(body.split(';').map(part => part.split(/:(.*)/s).map(s => s.trim()))
    .filter(([name]) => name));
}

// { sizes, padding: { left, right }, problems }: sizes (font-size of each
// [size] as a multiple), a script's padding in ems, and in problems what's
// not as expected for the tags among used (MathJax writes the rules of the
// tags a page has)
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
