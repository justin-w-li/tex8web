// The checks npm test makes of its pages, for any build: prints what's
// wrong with the pages in a directory (and in make4ht's and TeX's logs),
// and fails if anything is.
//   node test/check.mjs <html directory> [make4ht log] [TeX log]
import { readFileSync } from 'node:fs';
import { checkLog, checkOutput, checkTexLog } from './lib/check.mjs';

const [out, log, texLog] = process.argv.slice(2);
const problems = [
  ...(texLog ? checkTexLog(texLog) : []),
  // (make4ht colors its messages, also in a file)
  ...(log ? checkLog(readFileSync(log, 'utf8').replace(/\x1b\[[0-9;]*m/g, '')) : []),
  ...checkOutput(out),
];
for (const problem of [...new Set(problems)]) console.log(problem);
process.exit(problems.length ? 1 : 0);
