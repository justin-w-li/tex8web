// Set-up for the tests of the test tools, applied on import: a separate
// pool of build slots in a temporary $TMPDIR, so that the tests never wait
// for other sessions' builds, and a stand-in for make4ht.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';

const pooled = realpathSync(mkdtempSync(join(tmpdir(), 'tex8webtools')));
process.env.TMPDIR = pooled;
// (two, as the shared pool still limits the document builds beside them)
process.env.TEX8WEB_SLOTS = '2';
after(() => rmSync(pooled, { recursive: true, force: true }));

// The stand-in is first on the PATH of the builds and regress.mjs runs that
// pass `stubbed`, for the tests of what happens around a build. bin/tex8web
// runs it as make4ht. Its page is the document's text, and a document with
// \undefinedcs fails. It saves and reuses the LaTeX run as tex8web.mk4 does,
// printing 'LaTeX ran' in LaTeX's part of the log when not reusing it.
const stubs = join(pooled, 'stubs');
mkdirSync(stubs);
writeFileSync(join(stubs, 'make4ht'), `#!/bin/sh
[ "$1" = --version ] && { echo 'make4ht stub'; exit 0; }
while [ $# -gt 1 ]; do
  case $1 in -B) aux=$2; shift ;; -d) out=$2; shift ;; esac
  shift
done
grep -q undefinedcs "$1" && { echo '[ERROR] Undefined control sequence'; exit 1; }
mkdir -p "$out" "$aux"
echo tex8web-latex-begin
if [ -z "$TEX8WEB_LATEX_REUSE" ]; then
  echo 'LaTeX ran'
  [ -z "$TEX8WEB_LATEX_SAVE" ] || mkdir -p "$TEX8WEB_LATEX_SAVE"
fi
echo tex8web-latex-end
{ echo "<head><script id='tex8web-fonts'>/*<![CDATA[*/ /*]]>*/</script></head>"; cat "$1"; } > "$out/\${1%.tex}.html"
: > "$aux/\${1%.tex}.log"
`, { mode: 0o755 });
export const stubbed = { PATH: `${stubs}:${process.env.PATH}` };
