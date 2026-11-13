# Contributing to tex8web

1. [Setup](#setup)
2. [Proposing a feature](#proposing-a-feature)
3. [How it works](#how-it-works)
4. [Testing](#testing)
5. [Updating MathJax or TeX Live](#updating-mathjax-or-tex-live)
6. [Releasing](#releasing)
7. [Reporting a problem](#reporting-a-problem)
8. [Files](#files)

## Setup

You need TeX Live 2026, Node 22 or later, and, for `npm run test:visual`, Chrome or Chromium.

```sh
git clone https://github.com/justin-w-li/tex8web.git
cd tex8web
npm ci
npm test
```

If you work with a coding agent, [CLAUDE.md](CLAUDE.md) is its instruction file.

## Proposing a feature

Before you build a feature, including a new `\Web*` command or page control, propose it to a maintainer, for example in an issue, with a sentence on how it improves reading. Build it once a maintainer agrees. Fixes that bring the page closer to the PDF need no proposal.

## How it works

### 1. tex4ht

tex4ht is configured by `tex8web.cfg` and the files in `tex/`.

- With tex4ht's `mathjax` option, the text is written as HTML, and the formula source stays in the page as LaTeX.
- Equations are numbered as in TeX, so the numbers agree with `\eqref`.
- Alignments are split at `\intertext`, and the parts are given the same columns in `js/tex8web.js`, so they line up as one alignment.
- The document is measured in TeX: the text width, heading sizes, link colors, and the space around theorems, lists, floats, captions, and display math. The measurements are passed to the stylesheet as `--tex8web-*` custom properties, with the text width in ems, so the column scales with the text size. Every static rule is in `css/tex8web.css`.
- A length that a document can change for one element is written on that element: `\tabcolsep` on each table, `\fboxsep` and `\fboxrule` on each `\fbox`, `\framebox`, `\colorbox`, and `\fcolorbox`, and `\labelsep` on each list.
- A size change within the text, such as `\small` or a footnote, is written by tex4ht as spans around the words, and the blocks around them stay at the body size. So the spacing of a list, theorem, algorithm, or box is given in ems of the body size, and each formula in that text is given its size as `--tex8web-math-size`, a multiple of the body size.
- Font spans are kept inside inline and block verbatim text, so the selected typewriter family and size are preserved. A verbatim block whose spans share one size, such as one after `\small`, holds its text in a box of that size, so its lines are as far apart as in the PDF, and the block keeps the text's size for its margins. Inline literals stay on one line on wide screens and in print, as in TeX, except in a margin note. On narrow screens and in margin notes, longer literals are boxes at their text width, limited to the column or note width, and can wrap between any characters. Short literals stay inline with their opening punctuation.
- List labels are typeset by TeX, so they match the PDF.
- A `\rule` in text is written as a box of its width, as a share of the text width, and its height, in ems of the body size. tex4ht writes a rule as underscores, which are left out by putting the rule between the specials `t4ht@[` and `t4ht@]`.
- `\,` and `\thinspace` in text are written as U+202F, the narrow no-break space. TeX does not break a line at their kern, which tex4ht writes as a space where a line can break, or as nothing in italic.
- A `~` is written as a space in a `tex8web-nbsp` span with `white-space: pre`, so it is as wide as a space in its font, as in TeX. tex4ht writes it as U+00A0, which is drawn at the font's U+00A0 width in Chrome and Firefox. `pre` keeps the space from collapsing. As `pre` is set on the box that holds the space, a line does not break after the space (CSS Text 3, section 5.1).
- A `~` or `\,` next to inline math is wrapped with the math in a `tex8web-nowrap` span by `text.no_break_spaces`. So are the characters right before inline math and the text and inline elements right after it, where a line may break in a browser but not in TeX: `($x$)`, `$i$th`, and `$n$\textsuperscript{th}`. The span reaches whitespace, a line end, an `\hfill`, or a qed box. Text, or a span of tex4ht's font, that holds the whitespace is split there. Safari breaks a line between inline math and a no-break space after it, even inside a `white-space: nowrap` span, unless the span reaches the next place where the line may break.
- The title is passed from one LaTeX run to the next by tex4ht, so the first draft build, with one LaTeX run, has no title.
- A heading's font is read in `\web@headsize` from its titlesec `\titleformat`, the style in its class's `\@startsection`, or memoir's part and chapter fonts. The font is tried in a box that is thrown away, and its size, family, weight, style, variant, and alignment are written as custom properties. A `\paragraph` or `\subparagraph` head is then configured without html4.4ht's `\bf`.
- With tocloft, the font of each table of contents level is read from `\cft<level>font` by `\web@tocfont`, as heading fonts are. The faces these fonts need are predicted in `lua/tex8web/assets.lua`, to be copied next to the page and listed for preloading.
- Settings lost under tex4ht, for example titlesec formats and tcolorbox options, are recorded in `tex/tex8web-hooks.sty`, which is loaded before the preamble.
- Without titlesec, a chapter's spacing is read from the class's `\@makechapterhead`, which is kept in `tex8web-hooks.sty` before tex4ht empties it at `\begin{document}`. The command is run in a box that is thrown away, and its `\vskip`s are counted, with each `\vspace` taken as one. Three are taken as the space above, between label and title, and below, as in report, book, and memoir. Any other count, or a negative space, leaves the stylesheet's spacing, as does a class without `\@makechapterhead`, such as mwrep.
- A part's spacing is read the same way from the class's `\part`, with the class's `\@part`, which the .4ht files replace. The part's page breaks, counter, and table of contents line are turned off, and each `\vfil` is counted as a fill. Two skips are taken as the space above and below, as in article. A fill above or below is not written, and the stylesheet gives the part a chapter's space there.
- hyperref loads nameref, and these commands are wrapped by nameref: the class's `\@sect`, `\@ssect`, `\@part`, `\@spart`, `\@chapter`, and `\@schapter`, and `\@opargbegintheorem`, `\@begintheorem`, `\descriptionlabel`, and longtable's `\LT@c@ption`. Of these, tex8web reads only `\@part`. The class's `\@part` is taken from `\NR@part`, where nameref keeps it. ntheorem's `\@begintheorem` is read too, but each ntheorem style defines it again, which removes the wrapper. Under tex4ht, `hyperref.sty` is read only up to `\MaybeStopEarly`, so hyperref's own patches after that line do not apply, and only nameref's wrappers remain. Load hyperref in a fixture for code that reads a command that nameref wraps, as `test-part` does.
- A warning from `\web@needs` is given when a command that tex8web patches is no longer defined in tex4ht or in a package. In the tests, this warning is a failure.

### 2. HTML passes

tex8web runs bibtex or biber, makeindex, makeglossaries, and the passes in `lua/tex8web/`. The steps, and the TeX search paths for the files loaded by `tex8web.cfg`, are set in `tex8web.mk4`, so a build without `-e tex8web.mk4` fails.

#### Macros in math (`macros.lua`, `preamble.lua`)

MathJax is not given the preamble, so tex8web translates the macros defined there for it. Definitions are collected from the document, from the local packages it loads, and from the files that the document and these packages `\input` or `\include`. Files are read in the same order as in TeX. Later definitions replace earlier ones, except that `\providecommand` keeps an existing definition. Only macros used in the math are added to the page, so the rest of the source is not published.

Only the CSS and dvips color names are defined in MathJax. tex8web adds these colors as `\definecolor` lines:

- colors defined in the document with `\definecolor` and `\colorlet`
- colors from the `dvipsnames`, `svgnames`, and `x11names` options of xcolor
- xcolor names that have other values in CSS, for example `green` and `orange`
- mixes and complements, for example `red!50!black` and `-ink`

Color names are looked for in every word in braces in the math, so a color named in a macro argument is found too.

The color lines are placed before the macros, because the MathJax run is restarted by a `\definecolor`, and in the restarted run a repeated `\DeclarePairedDelimiter` is an error. Such errors are logged in `tex8web.js` as lines that start with `tex8web:`, and the checks fail on these lines.

Each color is recorded in `tex8web-hooks.sty` as defined by xcolor. The values are written at the end of the document, in the color's model: gray, CMYK, or RGB. In `macros.lua`, mixes are computed in xcolor's model, converted as in xcolor, and rounded once. The color models missing from MathJax are added in `tex8web.js`: `HTML`, `Gray`, `cmy`, and `cmyk`.

#### Indexes (`index.lua`)

In place of page numbers, makeindex is given a count of the `\index` commands. The counts start at 1000001, so that no number in an entry's text is mistaken for a count. Each count becomes a link back to its `\index` command, shown counted from 1. makeindex is run with `-r`, so consecutive counts are not joined into ranges. Under tex4ht, no command is run by imakeidx, so the makeindex command of imakeidx is recorded in the `.aux` by `tex8web-hooks.sty`.

#### Other passes

The other passes are for:

- the color of text after a `\color` declaration
- spacing
- the space around theorems and captions, which TeX knows only inside them, moved from a mark onto the block. With the caption package's `position=auto`, a caption's place at the top or bottom of its float is told from the page: caption reads it from `\prevdepth`, which is changed by the anchor that tex4ht puts at the start of a float.
- text after `\hfill`, which is set at the right, and line ends at `\break` and `\linebreak`
- the alignment of a paragraph cell from its `\centering` or `\raggedleft`
- a `<wbr>` where url.sty may break a URL, in a `\url`, a `\path`, and a `\nolinkurl`. The text of a `\nolinkurl` is put in a span by `tex8web-text.tex`.
- the width of each picture drawn by dvisvgm, such as a TikZ picture, as a share of the text width, read from the SVG file and multiplied by the factors of each `\scalebox` or `\resizebox` around the picture (from marks that `tex8web-text.tex` writes around the scaled box, since dvisvgm draws the picture at its natural size), and its `vertical-align`, from the position of its TikZ `baseline`, written into the SVG. An `\includegraphics` with a size in these boxes is scaled too, and a negative factor mirrors or turns over either kind of picture with a `transform`. A mirror around a `\rotatebox` goes on its `span.rotatebox`, before the rotation. A picture turned over is lowered by the height it is shown at, as graphics.sty swaps the box's height and depth. Each lowering is a share of the picture's width, with the width capped at the column's width (`--tex8web-column`), so a picture that `max-width` shrinks to the column keeps its share below the baseline. A picture shrunk to a narrower box, such as a list item, is lowered by too much. An opened picture keeps these mirrors, without the rotations.
- [links to headings](DOCUMENTATION.md#links-to-headings) and theorems
- the removal of tex4ht's source-line comments
- meta tags and the page controls
- the `<main>` element around the text. tex8web runs make4ht's `fixinlines` filter immediately before this pass, because the filter is applied only to the top level of the body.
- the files the page needs, copied next to the page
- the font faces used in the text, listed for preloading by the inline script: those of Latin Modern, or of TeX Live for a document in Times, Charter, or similar fonts. The faces are found from the font families named in the build element and from the font classes in the page.

### 3. MathJax sizes

These sizes differ between TeX and MathJax's TeX input, and are set as in TeX in `js/tex8web.js`:

- `\big` and its relatives
- the 10pt delimiters and large operators of an 11pt or 12pt document
- the rows of arrays and alignments
- the space between the columns of arrays and matrices, and at the edges of an array, from `\arraycolsep` at the start of the document
- line breaks in inline math, after relations and never at a space
- the columns of an alignment split at `\intertext`

### 4. Prerendering

tex8web runs MathJax in Node with `js/prerender.mjs`, configured as in the browser, and saves the typeset math in the page. The prerendered page is also lighter.

Prerendering is skipped without `node_modules/`, when `node_modules/` holds a MathJax other than the version pinned in `package.json`, or with `TEX8WEB_NO_PRERENDER` set to any value. The result is [a page built without Node](DOCUMENTATION.md#without-node).

The code in `tex8web.js` depends on MathJax internals, so the MathJax version is pinned in `package.json`.

#### No assistive MathML

By default, hidden MathML copies of the formulas are added by MathJax: a quarter of a long page's markup, and most of its layout time on a phone. The copies are removed in prerendering, or kept with `TEX8WEB_MATHML=1`. This variable is set in the tests, and the math is checked through the MathML.

#### Speech

Each formula has `role="math"` and its speech as an `aria-label`. The speech is made by MathJax's semantic enrichment, and the math is changed by it. So the page is typeset a second time only for the speech, with the math adjusted for the speech rule engine. Without this adjustment, Γ would be spoken as "normal Gamma", `^\top` as "raised to the down tack power", and the degree sign `{}^\circ` as "composed with".

Most of the prerendering time is spent in the speech rule engine, so each formula's speech is saved in a speech cache for the next build. The cache key is made of:

- the input to the speech rule engine: the enriched MathML and the speech options
- the MathJax version
- the text of `prerender.mjs` and `prerender-rules.mjs`

The speech cache is the file named in `TEX8WEB_SPEECH_CACHE`, or else `<page>-speech.json` among tex4ht's files. For builds by the test tools, the variable is set in `test/lib/build.mjs` to `build/<document>.speech.json` in the document's directory, so all builds of a document outside tex8web share one speech cache, for example `npm run regress` builds in several checkouts.

#### Fewer elements

Wrappers that add nothing to their children's box are removed, for example one-character tokens and `mjx-mrow` in left-aligned math. A long document goes from 67,000 elements to 40,000. On a phone, the page is restyled during scrolling, in time that grows with the number of elements. The math is checked by `npm run test:visual` against the math typeset by MathJax in the browser.

#### Preloaded fonts

Without preloads, each font is fetched when first used, and the page is laid out again after it arrives. The fonts are listed by `assets.lua` and `prerender.mjs` in `data-fonts` on the inline script `js/tex8web-fonts.js`, and the preload links are inserted by this script. No links are inserted when the page is opened from disk: a preload from disk is refused in Safari, and then none of the page's fonts are loaded. The links have `crossorigin`, because `@font-face` fonts are fetched in CORS mode: without it, each font is fetched twice.

#### Subset fonts

The fonts of MathJax, Latin Modern, TeX Gyre, and XCharter are cut down to the document's characters with [subset-font](https://github.com/papandreou/subset-font). A long page's fonts go from about 380 KB to 140 KB.

#### No clipping

Each character is clipped to its box by MathJax. In Safari, each clipped character is put in a separate layer, which slows scrolling, so the clip is removed in the stylesheet.

#### Unknown macros

An unknown macro is drawn by MathJax as its name, in red. During prerendering, these macros are listed in a warning that starts with `tex8web:`.

### One page for each document

A build with a tex4ht split option, a number or `splitat=` in `\Preamble`, is stopped in `tex/tex8web-core.tex`. A build with `\CutAt` in the config is stopped in `page.build_data`, where the page is found without tex8web's build elements. Both cases are checked with `test-split.tex` and `test-cutat.tex`.

## Testing

The checks of each test script are listed in its header comment.

### Which checks to run

- Run `npm test` before every commit.
- Run `npm run test:visual` before a commit that touches the math path, where MathJax in Node and in the browser can differ:
  - `js/tex8web.js`, `js/prerender.mjs`, and `tex/tex8web-math.tex`
  - the MathJax configuration in `tex/tex8web-page.tex`
  - `lua/tex8web/macros.lua`, `preamble.lua`, and `source.lua`
  - the scripts in `page.lua`
  - the MathJax version in `package.json`
- Run `npm run test:visual` before a commit that touches `js/tex8web-page.js` or the styles of an [opened picture](DOCUMENTATION.md#opening-a-picture). The mouse and touch checks of an opened picture, and the checks of the bar, fade, theme, search field, transitions, and sizes at another default font size, run only in `test/page.mjs`. So do `spaces`, the check of the space in tables, boxes, arrays, and description lists, `cases`, the check of the rows and columns of cases environments, `hang`, the check of the indents of an author-year bibliography, and `mirror`, the check of a mirrored picture opened.
- For other changes, run `npm run test:visual` at the end of a batch and before opening a pull request.
- Give a bug fix a test where practical: a Lua unit test in `test/unit/`, or a fixture check in `test/run.mjs`.
- Check a visual change with screenshots from `node test/shots.mjs`, wide and narrow, light and dark, next to the PDF.
- Compare your documents before and after your change with `npm run regress`.
- Check that your branch changed only the test pages it meant to with `npm run test:compare`.

### Commands

- **`npm test`**: the Lua unit tests in `test/unit/`, then `test/run.mjs`. Every document in `test/fixtures/` and `examples/` is built by `run.mjs` into `build/test/<document>/` and checked. Build one document with `node test/run.mjs <name>`. The build log is in `build/test/<document>/make4ht.log`.
  - The tests of the test tools run beside the builds: `test/unit/prerender.test.mjs`, `slots.test.mjs`, `builds.test.mjs`, `realbuild.test.mjs`, `regress.test.mjs`, and `tools.test.mjs`. Most use stand-ins for make4ht and docker, set up in `test/lib/stubs.mjs`. The real make4ht is run in `realbuild.test.mjs`, and a real Chrome in `regress.test.mjs`.
  - `test-mathescape.tex` holds the formulas where tex8web's escaping of formula source (`\alteqtoks`) could differ from tex4ht's. It is built a second time by `run.mjs` with `test-mathescape-stock.cfg`, in which tex4ht's escaping is restored, and the two pages must be the same.
- **`npm run test:visual`**: `test/visual.mjs`, then `test/page.mjs`, with Chrome and the network. `test/chrome.test.mjs` and `test/shots.test.mjs` run beside them, so their output is mixed in.
  - `visual.mjs`: each page, prerendered and typeset by MathJax in the browser, compared screen by screen
  - `page.mjs`: the page script, the reader's place kept as a window crosses the width of a wide screen, with and without scroll anchoring, and on a reload, the tint of a linked equation, the text and controls at another default font size, the space in tables, boxes, arrays, and description lists, the rows and columns of cases environments, the indents of an author-year bibliography, and the mirror of an opened picture, tested on the fixtures that have each feature. Run it alone with `npm run test:page`.
  - `chrome.test.mjs`: tests of `test/lib/chrome.mjs`, among them its offline mode: a page tries to reach a local server over TCP and UDP, to make a DNS lookup, to read a file outside its directory, and to download a file, and none of these must happen. The same page is also loaded without the mode, so that each way out but the download is shown to work when nothing blocks it.
  - `shots.test.mjs`: tests of the comparison of two builds in `shots.mjs`, and of `--review`
- **`npm run examples`**: the PDF and page of each example, built into `examples/<name>/build/`, and the published site, built into `build/site/`.
- **`node test/shots.mjs`**: screenshots of a page, a comparison of two builds, the band of one element (`--clip`, with `--pad` px of what is around it), a measurement (`--eval`), or the screens of a first review (`--review`): the top, the table of contents, the middle, and the bibliography, wide and narrow, with the text each starts with, to find the PDF's page. Other options: a script run on the page first (`--then`), an emulated touch screen (`--touch`), one window of another size (`--window`), another default font size in px (`--font-size`), and a page kept from the network (`--offline`). Use `--offline` for a page built from a source you do not trust, as its script may send what it reads. Offline, every host name and IP address fails to resolve, WebRTC sends no UDP, and downloads are refused. A request of the page or its frames is also aborted unless it is for a `data:` URL or a file of the builds given to `shots.mjs`. Requests of workers and sandboxed frames are not checked so, and only the host rules stop them. Progress is printed on stderr, as a long page takes minutes. Compare the screenshots with the PDF page, rendered with `pdftoppm -png -r 100 -f <n> -l <n> -singlefile <pdf> <out>/pdf`.
  - In a comparison, a page is shot in strips of several screens, because a Chrome capture costs the same at any height. Only differing strips are decoded (`test/lib/png.mjs`) and compared screen by screen, so each screen matches a separate shot of it. The first eight differing screens for each width and color scheme are written (`--keep <n | all>`), and all are listed.
  - With `--expect look`, the comparison of each width and color scheme ends at the first strip that differs.
  - With `--cache <dir>`, the comparison results for the old build's strips are saved as JSON, keyed by a hash of the old build's files, the `shots.mjs` options and sources, and the Chrome version. Checkouts can share the directory, which is never pruned: delete it when it grows.
- **`npm run regress -- <documents>`**: builds of your documents, checked and compared with their baselines, as described in [DOCUMENTATION.md](DOCUMENTATION.md). `regress` is made of the tools above: builds with `test/lib/build.mjs`, the checks of `check.mjs`, `diff.mjs`, and `shots.mjs` only if the HTML changed.
  - The script is run by npm in the tex8web directory, so relative paths are taken from `INIT_CWD`.
  - With `--latexmk`, `build/pdf.lock` in the document's directory is held during the PDF build, so two latexmk runs never write to the same `build/pdf` at once. Without `--latexmk`, build the PDFs linked in the config before you run `regress`. With `--contain`, latexmk runs with `-outdir=build/pdf`. Before it runs, each directory of the document is made in `build/pdf`, as LaTeX writes the `.aux` of `\include{dir/file}` to `build/pdf/dir` and cannot make that directory. latexmk makes one such directory per run, up to its limit of five runs. `-bibfudge-` runs bibtex in the document's directory, so a `.bib` or `.bst` named by a path that begins with `../` is found.
  - With `--contain`, make4ht and latexmk run through `test/lib/contain.mjs`, in the image of the `Dockerfile`, with the limits listed in its header comment. tex8web, its `node_modules`, the document's directory, the config, and the `--root` directory, if given, are mounted read-only, at the same paths. The page, tex4ht's directory, the directory that LaTeX's run is saved in, and the document's `build` are mounted writable, and the stamps and logs are not. A source that holds anything but files and directories, such as a symbolic link or a FIFO, is refused before the host reads it, and so is a mount whose path holds a symbolic link. With `--root`, the source is the whole `--root` directory, and the stamp covers its files in place of the document's directory. `regress.mjs` checks the whole root once, after it cleans each document's `build`. Each build checks the root again without its `build` directories, which other builds may be writing, and which the stamp leaves out. `regress.mjs` refuses an `--out`, `--baseline`, or `--shots-cache` in the root, as the stamps or the check of the root would read what a container writes there. After each command, even one that `run()` killed, `build.mjs` runs `contain.mjs --clean` on the directories the command wrote. Each command's container is labeled with each of its writable directories, and `--clean` removes every container labeled with any of the directories it is given. Then it starts another container, with the same limits and with a name and a watcher like a command's. That container gives the owner back read and write on everything in the directories, and removes all but files and directories, and every path of 1000 bytes or more. Anything removed fails the build. A killed build may have left such entries, so a contained build runs `--clean` before it reads the source. That run covers the document's `build` and the build's page, tex4ht, and LaTeX directories. `regress.mjs --contain` runs `--clean` on the document's `build` before it reads the source. A build empties the directories it mounts rather than removing them, as Docker Desktop on macOS can fail to remove or mount a directory again right after a container used it. With `--contain`, `regress.mjs` resolves the symbolic links in the paths it is given, and refuses a document argument that is itself a link. The PDF's lock is kept in `$TMPDIR`, out of the source's reach. The stamp of a contained build also covers the runner and the `Dockerfile`, so a host build is never reused as a contained build, or the reverse.
  - The screens of a changed page are compared as soon as the page is built, with `--shots-cache <dir>` passed to `shots.mjs` (`<out>/shots-cache` by default).
- **`npm run test:compare -- [names]`**: every document in `test/fixtures/` and `examples/`, or the named ones, built on your checkout and at the commit where your branch left main (`git merge-base main HEAD`), and each pair compared as `regress` compares a page with its baseline. It lists each document as unchanged, changed, looking different, new, removed, or failed, in the output and in `build/compare/compare.json`. Differing screens are in `build/compare/compare/<name>`. It exits 3 if a page changed, looks different, is new, or was removed, 1 if a build or comparison failed, and 2 on a usage error, without a merge base, or when the merge base has another `package-lock.json`. A document that fails to build on both sides is unchanged, as some fixtures are refused by design.
  - Your side is built as `npm test` builds it, into `build/test/<document>/html`, so the builds of an earlier `npm test` are reused.
  - The merge base is extracted with `git archive` into `<bases>/<commit>/tex8web`, which uses your `node_modules`, and is built with its own `test/lib/build.mjs`, documents, and configs. A merge base with another `package-lock.json` is refused. `<bases>` is `build/base` by default, or `--bases <dir>`. Several checkouts can share one directory, so that each merge base is built once.
  - A run holds `<bases>/<commit>.lock` from start to end, so no other run extracts or removes that base meanwhile, and two runs with one merge base run one after the other. Each run removes the bases that no worktree's branch left main at, unless another run holds their lock. Without `lockf`, as on Linux, no lock is taken, so share no `<bases>` there.
  - The examples keep the real date, so their pages at the merge base are built again on another day, and a run across midnight shows them as changed.
- **`npm run test:contain -- [cases]`**: the documents in `test/contain/`, each an attack on the host, built through `test/lib/contain.mjs`. Each build must fail or leave the attack without effect, with the expected line in its log, and leave no file outside its writable mounts and no container. The case `bibindex` builds a test fixture through the runner instead, which must match its build on the host. The case `root` builds a document that inputs a file two directories above it, which must fail without the source's root mounted and build with it. The cases `bibpath` and `includes` build a PDF with `regress.mjs --contain --latexmk`, which must build it: `bibpath` names its `.bib` and `.bst` by a path above its directory, and `includes` uses `\include` from six directories. It needs Docker, so `npm test` and CI do not run it.
- **`node test/diff.mjs <old> <new>`**: what changed in the HTML between two builds
- **`node test/check.mjs <html dir> [make4ht log] [TeX log]`**: the generic page checks, on any build
- **`test/checklist.md`**: the checklist for comparing the page of `test.tex` with its PDF by eye

### Build slots

A build slot is a lock file in `$TMPDIR/tex8web-slots`, taken with `lockf` (`test/lib/slots.mjs`). One is held during every make4ht or latexmk build, and while every Chrome launched by the tests runs. The slots are shared by all test runs on the machine, in every checkout, so the machine does not swap when tests run in several checkouts at once.

- One build slot for each 4 GB of memory, or as many as `TEX8WEB_SLOTS`, a whole number of 1 or more
- A message after 10 seconds of waiting for a build slot, and every minute after that
- No build slots without `lockf`, as on Linux
- A separate pool of two build slots for the tests of the test tools, set up in `test/lib/stubs.mjs`

### Reused builds

A build is not run again when its inputs match its stamp, in `build/test/<document>/html.stamp`. The stamp covers:

- the files in the `bin`, `css`, `fonts`, `js`, `lua`, and `tex` directories of tex8web, `tex8web.cfg`, `tex8web.mk4`, `package.json`, and `package-lock.json`
- the files in the document's directory, and the config
- the size and modification time of the PDF linked from the page
- the command arguments, and the `TEX8WEB_*`, `TEXINPUTS`, `TEXMF*`, `SOURCE_DATE_EPOCH`, and `FORCE_SOURCE_DATE` environment variables, except `TEX8WEB_SPEECH_CACHE` and `TEX8WEB_SLOTS*`
- the versions of MathJax and subset-font
- the versions of TeX and make4ht, and the last change to TeX Live

Each document is built with the same environment into `build/test/<document>/html` by `npm test`, `npm run test:visual`, `npm run test:page`, and `npm run test:compare`, so a build by one is reused by the others, with a message in the output. A failed build is never reused.

The LaTeX runs have a separate stamp: only the tex8web files that LaTeX reads, plus the day, for `\today`. After a change to other files, for example in `css/`, `js/`, `fonts/`, or the HTML passes, only tex4ht, t4ht, and the HTML passes run again. Reused LaTeX runs are noted in the build log.

The build stamp has the day too, so a build from another day is not reused, as its `\today` would differ. With `FORCE_SOURCE_DATE`, the date is fixed by `SOURCE_DATE_EPOCH`, and the day is left out of both stamps. The test fixtures are built with the fixed date January 1, 2000, so their pages do not depend on the day.

To force a build in the tests, remove `build/test/<document>`, and for `visual.mjs` also `build/visual/<document>`, which holds the page typeset by MathJax in the browser. In `npm run regress`, remove `<out>/html/<name>.stamp`, and to run LaTeX again, `<out>/tex4ht/<name>.latex.stamp` too.

### A change that should not show

Build the pages before and after the change, then run `diff.mjs` on the two builds. If the HTML changed, run `shots.mjs` on them too, and look at every saved screen.

### Known gaps

The problems a document is allowed to have are listed in `test/expected.json`, each with its reason. Make each entry as specific as the message it matches. An entry that no longer matches anything is a failure until it is removed.

### Small known differences

Differences from the PDF too small for the [known limitations](DOCUMENTATION.md#known-limitations):

- **Math in a page built with Node is laid out from estimates**, not browser measurements, for example text in math without MathJax glyphs. A box can be a pixel or so off.
- **Delimiters and radicals** can differ slightly in size from the PDF, as they come from the MathJax font.
- **The space before inline math after a word in another font**, for example an algorithm2e keyword before its argument. It can be in the word's font without Node, and is in the text font with Node. The two pages can be a pixel apart, and neither always matches the PDF.
- **An `\fbox` or `\colorbox` in a line** is a few points taller than in the PDF. Its text is as tall as a line of the font, where TeX's box is as tall as its letters.
- **Two [H] algorithms of algorithm2e in a row** are 2em apart, the margins of both. In the PDF, they are about 1em apart.
- **A long caption of algorithm2e's plain, boxed, or plainruled style** ends short of the right edge where the PDF's caption reaches it.
- **A row taller than its strut** in an alignment or in mathtools' cases environments is `\lineskip`, usually 1pt, closer to the next row than in the PDF. In the PDF, `\openup\jot` raises `\lineskip` as well as `\baselineskip`, so such rows are `\lineskip` plus `\jot` apart.
- **A space at the end of the text in a starred cases environment**, as in `otherwise \end{rcases*}`, is dropped. In the PDF, the space is kept, so the column is an interword space wider.
- **Text in another size**, such as a footnote, is set by tex4ht at a whole percent of the body size, rounded down: 81% for 9pt text in an 11pt document, where the PDF has 82.2%. Its math is at the PDF's size, so the math can be up to 2% larger than the words around it.

### CI

On every push to main and every pull request, `npm test` and `npm run test:visual` run in CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). CI runs in the TeX Live Docker image, pinned by digest. The published site is also built in CI and published to GitHub Pages from main.

### The README screenshot

To make a new `.github/screenshot.png`:

1. Build the `custom` example and its PDF with `npm run examples`.
2. Render the first page of the PDF with `pdftoppm`, and take a wide, light screenshot of the page with `shots.mjs`.
3. Put the two images side by side, and keep the file under 300 KB.

## Updating MathJax or TeX Live

### MathJax

Move `mathjax` and every `@mathjax/*` package to the new version in one commit, and run:

- the `typeset` checks of `npm test`, for the internals that `tex8web.js` depends on
- `npm run test:visual`, for the comparison of MathJax in Node with MathJax in the browser
- `npm run regress` on your documents, compared with their baselines

`js/prerender.mjs` also depends on these parts of MathJax:

- `TEXCLASS`, `postFilters`, and `walkTree` of `MmlTree`. The `postFilters` are the adjustment of the math for speech.
- `outputData.speech` of each formula in the second typesetting, and its words for a table of one row ("1 lines Line 1: ")
- the rendering of an unknown macro by the noundefined extension: an `mtext` with a `mathcolor`, holding the macro name
- `WorkerHandler.Speech` of `a11y/speech`, through which the speech is saved: its arguments, and that the label is left in `outputData.speech`
- the same formulas found in the second typesetting as in the first, in the same order. The formulas are paired by position, and an error is thrown when the counts differ.
- the CSS values read in `js/prerender-rules.mjs`: the rule of each removed tag, the rules of `mjx-math` and `mjx-script`, and the sizes of `[size]`. When one of these values differs, the pass that removes elements is skipped, and `npm test` fails with a line that starts with `MathJax:`.

### TeX Live

Take the new digest of `texlive/texlive:latest` for the CI image, and confirm that both test jobs pass. A warning from `\web@needs` means that a command that tex8web patches was changed in tex4ht or in a package.

## Releasing

Versions are `0.x`: a minor version for features and new `\Web*` commands, and a patch version for fixes.

1. Check that main is green on CI.
2. Update `version` in `package.json` and commit.
3. Tag the commit with `git tag -a vX.Y.Z -m "tex8web X.Y.Z"`, then run `git push origin vX.Y.Z`.
4. Run `gh release create vX.Y.Z`, with a few lines on what changed for users.

## Reporting a problem

Open an issue with the bug report template in [`.github/ISSUE_TEMPLATE`](.github/ISSUE_TEMPLATE). Include:

- the output of `tex8web --version`
- your TeX Live year, and the output of `make4ht -v` and `node -v`
- the smallest `.tex` file with the problem
- the make4ht output, and what you expected to see

## Files

| Path | Contents |
| --- | --- |
| `bin/tex8web` | the command to build a page |
| `tex8web.cfg` | the config for documents without a config |
| `tex8web.mk4` | the build file: search paths, build steps, HTML passes, and prerendering |
| `tex/tex8web-core.tex` | the entry point, with the four modules below |
| `tex/tex8web-math.tex` | the MathJax configuration, `\WebMathMacros`, the escaping of formula source, siunitx, equation numbers, `\intertext`, TikZ in display math, and the space around display math |
| `tex/tex8web-text.tex` | links, cross-references, theorems, `\hfill` and line breaks, `\rule` in text, the space in table cells and the alignment of paragraph cells, the table of contents, lists, `\fbox` and `\colorbox`, bibliographies, boxes of framed and mdframed, algorithms (the ruled style of float, algorithmicx, algorithm2e), figures, `\WebTerm`, and TS1 symbols |
| `tex/tex8web-page.tex` | `<head>`, `\WebPDF`, `\WebUp`, `\WebColor`, `\color` as a declaration, and the measurements and heading fonts of the document |
| `tex/tex8web-boxes.tex` | tcolorbox boxes |
| `tex/tex8web-hooks.sty` | loaded before the preamble: settings lost under tex4ht, dcolumn's old names for `dcolumn.4ht`, and `\web@needs` |
| `css/tex8web.css` | the page styles |
| `lua/tex8web/macros.lua`, `preamble.lua` | macros in math, and their colors |
| `lua/tex8web/source.lua`, `text.lua`, `page.lua` | HTML passes: formula source, colors, spacing, theorems in boxes, footnotes, links, page controls, the table of contents, meta tags, and scripts |
| `lua/tex8web/assets.lua`, `bibliography.lua`, `index.lua`, `prerender.lua` | the files next to the page and font rules, bibtex and biber, makeindex and makeglossaries, and prerendering |
| `lua/tex8web/files.lua`, `dom.lua` | file and DOM helpers |
| `js/tex8web.js` | MathJax sizes set as in TeX |
| `js/tex8web-fonts.js` | the font preload links, written inline in the head of each page, before the stylesheet link |
| `js/tex8web-head.js` | the reader's theme and table of contents settings, applied before the page is drawn, and the direction of the transition to the next page. The settings are saved in `localStorage` as `tex8web-theme` and `tex8web-contents`. |
| `js/tex8web-page.js` | the page controls (the up button is a step back in history), footnotes, table of contents, [search field](DOCUMENTATION.md#search-field), [preview cards](DOCUMENTATION.md#preview-cards), and [opened pictures](DOCUMENTATION.md#opening-a-picture) |
| `js/prerender.mjs`, `prerender-rules.mjs` | MathJax in Node, and the MathJax CSS rules that the removal of elements depends on |
| `fonts/` | Latin Modern as WOFF2, and `LICENSE.txt`, which is copied with every page |
| `examples/` | the examples, and `index.tex`, the index of the published site |
| `test/` | `run.mjs`, `visual.mjs`, `page.mjs`, `examples.mjs`, `check.mjs`, `diff.mjs`, `shots.mjs`, `regress.mjs`, `compare.mjs`, `contain.mjs`, the `*.test.mjs` tests of the test tools, `unit/`, `fixtures/`, `contain/`, `expected.json`, `checklist.md`, and `lib/` |
| `Dockerfile` | the image of CI's TeX Live with Node and Poppler, in which `test/lib/contain.mjs` runs a build whose source is not trusted |
| `.github/workflows/ci.yml` | CI and the published examples |
