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
- List labels are typeset by TeX, so they match the PDF.
- `\,` and `\thinspace` in text are written as U+202F, the narrow no-break space, and kept with the math after them. TeX does not break a line at their kern, which tex4ht writes as a space where a line can break, or as nothing in italic.
- The title is passed from one LaTeX run to the next by tex4ht, so the first draft build, with one LaTeX run, has no title.
- With tocloft, the font of each table of contents level is read from `\cft<level>font` by `\web@tocfont`, as heading fonts are. The faces these fonts need are predicted in `lua/tex8web/assets.lua`, to be copied next to the page and listed for preloading.
- Settings lost under tex4ht, for example titlesec formats and tcolorbox options, are recorded in `tex/tex8web-hooks.sty`, which is loaded before the preamble.
- A warning from `\web@needs` is given when a command that tex8web patches is no longer defined in tex4ht or in a package. In the tests, this warning is a failure.

### 2. HTML passes

tex8web runs bibtex or biber, makeindex, and the passes in `lua/tex8web/`. The steps, and the TeX search paths for the files loaded by `tex8web.cfg`, are set in `tex8web.mk4`, so a build without `-e tex8web.mk4` fails.

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
- the width of each picture drawn by dvisvgm, such as a TikZ picture, as a share of the text width, read from the SVG file and multiplied by the factors of each `\scalebox` or `\resizebox` around the picture (from marks that `tex8web-text.tex` writes around the scaled box, since dvisvgm draws the picture at its natural size), and its `vertical-align`, from the position of its TikZ `baseline`, written into the SVG
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
- Run `npm run test:visual` before a commit that touches `js/tex8web-page.js` or the styles of an [opened picture](DOCUMENTATION.md#opening-a-picture). The mouse and touch checks of an opened picture, and the checks of the bar, fade, theme, search field, transitions, and sizes at another default font size, run only in `test/page.mjs`. So does `spaces`, the check of the space in tables, boxes, arrays, and description lists.
- For other changes, run `npm run test:visual` at the end of a batch and before opening a pull request.
- Give a bug fix a test where practical: a Lua unit test in `test/unit/`, or a fixture check in `test/run.mjs`.
- Check a visual change with screenshots from `node test/shots.mjs`, wide and narrow, light and dark, next to the PDF.
- Compare your documents before and after your change with `npm run regress`.

### Commands

- **`npm test`**: the Lua unit tests in `test/unit/`, then `test/run.mjs`. Every document in `test/fixtures/` and `examples/` is built by `run.mjs` into `build/test/<document>/` and checked. Build one document with `node test/run.mjs <name>`. The build log is in `build/test/<document>/make4ht.log`.
  - The tests of the test tools run beside the builds: `test/unit/prerender.test.mjs`, `slots.test.mjs`, `builds.test.mjs`, `realbuild.test.mjs`, `regress.test.mjs`, and `tools.test.mjs`. Most use a stand-in for make4ht, set up in `test/lib/stubs.mjs`. The real make4ht is run in `realbuild.test.mjs`, and a real Chrome in `regress.test.mjs`.
  - `test-mathescape.tex` holds the formulas where tex8web's escaping of formula source (`\alteqtoks`) could differ from tex4ht's. It is built a second time by `run.mjs` with `test-mathescape-stock.cfg`, in which tex4ht's escaping is restored, and the two pages must be the same.
- **`npm run test:visual`**: `test/visual.mjs`, then `test/page.mjs`, with Chrome and the network. `test/chrome.test.mjs` and `test/shots.test.mjs` run beside them, so their output is mixed in.
  - `visual.mjs`: each page, prerendered and typeset by MathJax in the browser, compared screen by screen
  - `page.mjs`: the page script, the tint of a linked equation, the text and controls at another default font size, and the space in tables, boxes, arrays, and description lists, tested on the fixtures that have each feature. Run it alone with `npm run test:page`.
  - `chrome.test.mjs`: tests of `test/lib/chrome.mjs`
  - `shots.test.mjs`: tests of the comparison of two builds in `shots.mjs`
- **`npm run examples`**: the PDF and page of each example, built into `examples/<name>/build/`, and the published site, built into `build/site/`.
- **`node test/shots.mjs`**: screenshots of a page, a comparison of two builds, the band of one element (`--clip`, with `--pad` px of what is around it), or a measurement (`--eval`). Other options: a script run on the page first (`--then`), an emulated touch screen (`--touch`), one window of another size (`--window`), and another default font size in px (`--font-size`). Progress is printed on stderr, as a long page takes minutes. Compare the screenshots with the PDF page, rendered with `pdftoppm -png -r 100 -f <n> -l <n> -singlefile <pdf> <out>/pdf`.
  - In a comparison, a page is shot in strips of several screens, because a Chrome capture costs the same at any height. Only differing strips are decoded (`test/lib/png.mjs`) and compared screen by screen, so each screen matches a separate shot of it. The first eight differing screens for each width and color scheme are written (`--keep <n | all>`), and all are listed.
  - With `--expect look`, the comparison of each width and color scheme ends at the first strip that differs.
  - With `--cache <dir>`, the comparison results for the old build's strips are saved as JSON, keyed by a hash of the old build's files, the `shots.mjs` options and sources, and the Chrome version. Checkouts can share the directory, which is never pruned: delete it when it grows.
- **`npm run regress -- <documents>`**: builds of your documents, checked and compared with their baselines, as described in [DOCUMENTATION.md](DOCUMENTATION.md). `regress` is made of the tools above: builds with `test/lib/build.mjs`, the checks of `check.mjs`, `diff.mjs`, and `shots.mjs` only if the HTML changed.
  - The script is run by npm in the tex8web directory, so relative paths are taken from `INIT_CWD`.
  - With `--latexmk`, `build/pdf.lock` in the document's directory is held during the PDF build, so two latexmk runs never write to the same `build/pdf` at once. Without `--latexmk`, build the PDFs linked in the config before you run `regress`.
  - The screens of a changed page are compared as soon as the page is built, with `--shots-cache <dir>` passed to `shots.mjs` (`<out>/shots-cache` by default).
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

Each document is built with the same environment into `build/test/<document>/html` by `npm test`, `npm run test:visual`, and `npm run test:page`, so a build by one is reused by the others, with a message in the output. A failed build is never reused.

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
| `tex/tex8web-text.tex` | links, cross-references, theorems, `\hfill` and line breaks, the space in table cells and the alignment of paragraph cells, the table of contents, lists, `\fbox` and `\colorbox`, boxes of framed and mdframed, algorithms (the ruled style of float, algorithmicx, algorithm2e), figures, and `\WebTerm` |
| `tex/tex8web-page.tex` | `<head>`, `\WebPDF`, `\WebUp`, `\WebColor`, `\color` as a declaration, and the measurements and heading fonts of the document |
| `tex/tex8web-boxes.tex` | tcolorbox boxes |
| `tex/tex8web-hooks.sty` | loaded before the preamble: settings lost under tex4ht, dcolumn's old names for `dcolumn.4ht`, and `\web@needs` |
| `css/tex8web.css` | the page styles |
| `lua/tex8web/macros.lua`, `preamble.lua` | macros in math, and their colors |
| `lua/tex8web/source.lua`, `text.lua`, `page.lua` | HTML passes: formula source, colors, spacing, theorems in boxes, footnotes, links, page controls, the table of contents, meta tags, and scripts |
| `lua/tex8web/assets.lua`, `bibliography.lua`, `index.lua`, `prerender.lua` | the files next to the page, bibtex and biber, makeindex, and prerendering |
| `lua/tex8web/files.lua`, `dom.lua` | file and DOM helpers |
| `js/tex8web.js` | MathJax sizes set as in TeX |
| `js/tex8web-fonts.js` | the font preload links, written inline in the head of each page, before the stylesheet link |
| `js/tex8web-head.js` | the reader's theme and table of contents settings, applied before the page is drawn, and the direction of the transition to the next page. The settings are saved in `localStorage` as `tex8web-theme` and `tex8web-contents`. |
| `js/tex8web-page.js` | the page controls (the up button is a step back in history), footnotes, table of contents, [search field](DOCUMENTATION.md#search-field), [preview cards](DOCUMENTATION.md#preview-cards), and [opened pictures](DOCUMENTATION.md#opening-a-picture) |
| `js/prerender.mjs`, `prerender-rules.mjs` | MathJax in Node, and the MathJax CSS rules that the removal of elements depends on |
| `fonts/` | Latin Modern as WOFF2, and `LICENSE.txt`, which is copied with every page |
| `examples/` | the examples, and `index.tex`, the index of the published site |
| `test/` | `run.mjs`, `visual.mjs`, `page.mjs`, `examples.mjs`, `check.mjs`, `diff.mjs`, `shots.mjs`, `regress.mjs`, the `*.test.mjs` tests of the test tools, `unit/`, `fixtures/`, `expected.json`, `checklist.md`, and `lib/` |
| `.github/workflows/ci.yml` | CI and the published examples |
