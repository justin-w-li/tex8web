// What changed in the HTML between two builds: the files added, removed,
// or changed; for a page, each section that differs, with its number of
// changed formulas and its first difference; for a stylesheet, the changed
// lines. Sections with the same first difference are listed together. PDFs
// are skipped, as their dates differ in every build. Fonts are compared as
// bytes, since each is subset the same way in every build. Exits 1 if
// anything changed, 2 if the comparison failed.
//   node test/diff.mjs <old html directory> <new html directory>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const [before, after] = process.argv.slice(2);
// (a failure is not a change)
process.on('uncaughtException', error => { console.error(error); process.exit(2); });

function files(dir) {
  return readdirSync(dir, { recursive: true })
    .filter(f => extname(f) !== '.pdf' && statSync(join(dir, f)).isFile()).sort();
}

// the sections of a page by heading text: one from each heading with an
// id, and one for the text before the first
function sections(html) {
  const seen = {};
  return new Map(html.split(/(?=<h[1-6][^>]*\sid=)/).map((section, i) => {
    let name = i ? section.slice(0, section.indexOf('</h'))
      .replace(/<a[^>]*tex8web-permalink[^>]*>.*?<\/a>/, '').replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ').trim() : '(before the first heading)';
    seen[name] = (seen[name] || 0) + 1;
    if (seen[name] > 1) name += ` (${seen[name]})`;
    return [name, section];
  }));
}

const formulas = html => html.match(/<mjx-container[^]*?<\/mjx-container>/g) || [];
const excerpt = (text, at) => JSON.stringify(text.slice(Math.max(0, at - 50), at + 50).replace(/\s+/g, ' '));

function diffPage(a, b) {
  const lines = [];
  const groups = new Map();
  const [old, now] = [sections(a), sections(b)];
  // (a renamed section: a name only in the old page and a name only in the
  // new, at the same index)
  const [oldNames, newNames] = [[...old.keys()], [...now.keys()]];
  const renamed = new Map(oldNames.map((name, i) => [name, newNames[i]])
    .filter(([name, other]) => other !== undefined && !now.has(name) && !old.has(other)));
  const was = new Map([...renamed].map(([name, other]) => [other, name]));
  for (const name of new Set([...oldNames, ...newNames])) {
    if (renamed.has(name)) continue;
    const [x, y] = [old.get(was.get(name) ?? name), now.get(name)];
    if (x === y) continue;
    if (x === undefined || y === undefined) {
      lines.push(`  ${x === undefined ? 'added' : 'removed'}: ${name}`);
      continue;
    }
    // (changed formulas counted as a multiset, so one inserted formula does
    // not count every later one)
    const left = formulas(x);
    let changed = 0;
    for (const f of formulas(y)) {
      const i = left.indexOf(f);
      if (i < 0) changed++; else left.splice(i, 1);
    }
    changed = Math.max(changed, left.length);
    let at = 0;
    while (x[at] === y[at]) at++;
    // (sections grouped by the text at their first difference)
    const key = x.slice(at, at + 50) + '\0' + y.slice(at, at + 50);
    if (!groups.has(key)) groups.set(key, { names: [], shown: [excerpt(x, at), excerpt(y, at)] });
    const label = was.has(name) ? `${was.get(name)} → ${name}` : name;
    groups.get(key).names.push(changed ? `${label} (${changed} formula(s))` : label);
  }
  for (const { names, shown: [x, y] } of groups.values()) lines.push(`  ${names.join('; ')}`, `    - ${x}`, `    + ${y}`);
  return cap(lines, 30);
}

// the lines only in a or only in b, in order (a longest common subsequence)
function diffLines(a, b) {
  let [x, y] = [a.split('\n'), b.split('\n')];
  // (the common start and end trimmed first: the table has x.length ×
  // y.length cells)
  let start = 0, end = 0;
  while (start < Math.min(x.length, y.length) && x[start] === y[start]) start++;
  while (end < Math.min(x.length, y.length) - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
  [x, y] = [x.slice(start, x.length - end), y.slice(start, y.length - end)];
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++; }
    else if (i < x.length && (j === y.length || lcs[i + 1][j] >= lcs[i][j + 1])) lines.push(`  - ${x[i++]}`);
    else lines.push(`  + ${y[j++]}`);
  }
  return cap(lines, 20);
}

function cap(lines, n) {
  return lines.length > n ? [...lines.slice(0, n), `  ... and ${lines.length - n} more lines`] : lines;
}

const out = [];
const [old, now] = [files(before), files(after)];
for (const file of new Set([...old, ...now])) {
  if (!old.includes(file) || !now.includes(file)) {
    out.push(`${old.includes(file) ? 'removed' : 'added'} ${file}`);
    continue;
  }
  const [a, b] = [readFileSync(join(before, file)), readFileSync(join(after, file))];
  if (a.equals(b)) continue;
  const ext = extname(file);
  out.push(`changed ${file}`);
  if (ext === '.html') out.push(...diffPage(a.toString(), b.toString()));
  else if (ext === '.css') out.push(...diffLines(a.toString(), b.toString()));
}
console.log(out.length ? out.join('\n') : 'unchanged');
process.exitCode = out.length ? 1 : 0;
