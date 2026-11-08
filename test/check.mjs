// The page checks of npm test, on any build: prints each problem in the
// pages of a directory and in the make4ht and TeX logs, and exits 1 if
// there is one.
//   node test/check.mjs <html directory> [make4ht log] [TeX log]
import { readFileSync } from 'node:fs';
import { checkLog, checkOutput, checkTexLog } from './lib/check.mjs';

const [out, log, texLog] = process.argv.slice(2);
const problems = [
  ...(texLog ? checkTexLog(texLog) : []),
  // (make4ht writes color codes to its log file too)
  ...(log ? checkLog(readFileSync(log, 'utf8').replace(/\x1b\[[0-9;]*m/g, '')) : []),
  ...checkOutput(out),
];
for (const problem of [...new Set(problems)]) console.log(problem);
process.exit(problems.length ? 1 : 0);
