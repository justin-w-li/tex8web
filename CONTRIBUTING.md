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

Before you build a feature, propose it to a maintainer, for example in an issue, with a sentence on how it improves reading. Build it once a maintainer agrees. New `\Web*` commands and page controls are features too. Fixes that bring the page closer to the PDF need no proposal.

## How it works

### 1. tex4ht

tex4ht is configured by `tex8web.cfg` and the files in `tex/`.

- With the `mathjax` option of tex4ht, the text is written as HTML, and the formula source stays in the page as LaTeX.
- Equations are numbered as in TeX, so the numbers agree with `\eqref`.
- Alignments are split at `\intertext`. The parts are later given the same columns in `js/tex8web.js`, so they line up as one alignment.
- The document is measured in TeX: the text width, heading sizes, theorem and list spacing, and link colors. The measurements are passed to the stylesheet as `--tex8web-*` custom properties. The text width is given in ems, so the column scales with the text size. Every static rule is in `css/tex8web.css`.
- List labels are typeset by TeX, so they match the PDF.
- The title is passed from one LaTeX run to the next by tex4ht. So the first build in draft mode, with one LaTeX run, has no title.
- With tocloft, the font of each table of contents level is read from `\cft<level>font` by `\web@tocfont`, in the same way as heading fonts. The font faces these fonts need are predicted in `lua/tex8web/assets.lua`, so the faces can be copied next to the page and listed for preloading.
- `tex/tex8web-hooks.sty` is loaded before the preamble. There, tex8web records settings lost under tex4ht, for example the formats of titlesec and the options of tcolorbox.
- A warning from `\web@needs` is given when a command that tex8web patches is no longer defined in tex4ht or in a package. In the tests, this warning is a failure.

### 2. HTML passes

tex8web then runs bibtex or biber, makeindex, and the passes in `lua/tex8web/`. The steps are listed in `tex8web.mk4`. The TeX search paths for the files loaded by `tex8web.cfg` are also set in `tex8web.mk4`, so a build without `-e tex8web.mk4` fails.

#### Macros in math (`macros.lua`, `preamble.lua`)

MathJax is not given the preamble, so tex8web translates the macros defined there for MathJax. Definitions are collected from the document, from the local packages it loads, and from the files that the document and these packages `\input` or `\include`. Files are read in the same order as in TeX. Later definitions replace earlier ones, except that `\providecommand` keeps an existing definition. Only macros used in the math are added to the page, so the rest of the source is not published.

Only the color names of CSS and dvips are defined in MathJax. tex8web adds these colors as `\definecolor` lines:

- colors defined in the document with `\definecolor` and `\colorlet`
- colors from the `dvipsnames`, `svgnames`, and `x11names` options of xcolor
- xcolor names that have other values in CSS, for example `green` and `orange`
- mixes and complements, for example `red!50!black` and `-ink`

Color names are looked for in every word in braces in the math, so a color named in a macro argument is found too.

The color lines are placed before the macros. The MathJax run is restarted by a `\definecolor`, and in the restarted run a repeated `\DeclarePairedDelimiter` is an error. Such errors are logged in `tex8web.js` as lines that start with `tex8web:`, and the checks fail on these lines.

Each color is recorded in `tex8web-hooks.sty` as defined by xcolor. The values are written at the end of the document, in the model of the color: gray, CMYK, or RGB. In `macros.lua`, mixes are computed in the model used by xcolor, converted as in xcolor, and rounded once. The color models missing from MathJax are added in `tex8web.js`: `HTML`, `Gray`, `cmy`, and `cmyk`.

#### Indexes (`index.lua`)

In place of page numbers, makeindex is given a count of the `\index` commands. The counts start at 1000001, so that no number in the text of an entry is mistaken for a count. Each count becomes a link back to its `\index` command, and is shown counted from 1. makeindex is run with `-r`, so consecutive counts are not joined into ranges. Under tex4ht, no command is run by imakeidx, so the makeindex command of imakeidx is recorded in the `.aux` by `tex8web-hooks.sty`.

#### Other passes

The other passes in `lua/tex8web/` are for:

- the color of text after a `\color` declaration
- spacing
- text after `\hfill`, which is set at the right
- [links to headings](DOCUMENTATION.md#links-to-headings) and theorems
- the removal of the source-line comments of tex4ht
- meta tags and the page controls
- the `<main>` element around the text. tex8web runs the `fixinlines` filter of make4ht immediately before this pass, because the filter is applied only to the top level of the body.
- the files the page needs, copied next to the page
- the font faces the text uses, listed for preloading by the inline script. These are the faces of Latin Modern, or of TeX Live for a document in Times, Charter, or similar fonts. The faces are found from the font families named in the build element and from the font classes in the page.

### 3. MathJax sizes

A few sizes differ between TeX and the TeX input of MathJax. These sizes are set as in TeX in `js/tex8web.js`:

- `\big` and its relatives
- the 10pt delimiters and large operators of an 11pt or 12pt document
- the rows of arrays and alignments
- line breaks after relations
- the columns of an alignment split at `\intertext`

### 4. Prerendering

tex8web runs MathJax in Node with `js/prerender.mjs`, configured as in the browser. The typeset math is saved in the page. The prerendered page is also lighter.

Prerendering is skipped without `node_modules/`, when `node_modules/` holds a MathJax other than the version pinned in `package.json`, or with `TEX8WEB_NO_PRERENDER` set to any value. The result is [a page built without Node](DOCUMENTATION.md#without-node).

The code in `tex8web.js` depends on internals of MathJax, so the MathJax version is pinned in `package.json`.

#### No assistive MathML

By default, a hidden MathML copy of each formula is added by MathJax. The MathML copies are a quarter of the markup of a long page, and most of its layout time on a phone. The MathML copies are removed in prerendering, or kept with `TEX8WEB_MATHML=1`. This variable is set in the tests, and the math is checked through the MathML.

#### Speech

Each formula has `role="math"` and its speech as an `aria-label`. The speech is made by the semantic enrichment of MathJax, and the math itself is changed by this enrichment. So the page is typeset twice, and the second typesetting is used only for the speech. The math is also adjusted for the speech rule engine in the second typesetting. Without this adjustment, Γ would be spoken as "normal Gamma" and `^\top` as "raised to the down tack power".

Most of the prerendering time is spent in the speech rule engine, so the speech of each formula is saved in a speech cache for the next build. The cache key is made of:

- the input to the speech rule engine: the enriched MathML and the speech options
- the MathJax version
- the text of `prerender.mjs` and `prerender-rules.mjs`

The speech cache is the file named in `TEX8WEB_SPEECH_CACHE`, or else `<page>-speech.json` among the files of tex4ht. For builds by the test tools, `TEX8WEB_SPEECH_CACHE` is set to `build/<document>.speech.json` in the directory of the document, in `test/lib/build.mjs`. So all builds of a document outside tex8web, for example builds by `npm run regress` in several checkouts, share one speech cache.

#### Fewer elements

Wrappers that add nothing to the box of their children are removed, for example one-character tokens and `mjx-mrow` in left-aligned math. A long document goes from 67,000 elements to 40,000. On a phone, the page is restyled during scrolling, in time that grows with the number of elements. The math is checked by `npm run test:visual` against the math typeset by MathJax in the browser.

#### Preloaded fonts

Without preloads, each font is fetched when first used, and the page is laid out again after each font arrives. The fonts are listed by `assets.lua` and `prerender.mjs` in `data-fonts` on the inline script `js/tex8web-fonts.js`, and the preload links are inserted by this script. No links are inserted when the page is opened from disk: a preload from disk is refused in Safari, and then none of the fonts of the page are loaded. The links have `crossorigin`, because `@font-face` fonts are fetched in CORS mode, and without `crossorigin` each font would be fetched twice.

#### Subset fonts

The fonts of MathJax, Latin Modern, TeX Gyre, and XCharter are cut down to the characters of the document with [subset-font](https://github.com/papandreou/subset-font). The fonts of a long page go from about 380 KB to 140 KB.

#### No clipping

Each character is clipped to its box by MathJax. In Safari, each clipped character is put in a separate layer, which slows scrolling. The clip is removed in the stylesheet.

#### Unknown macros

An unknown macro is drawn by MathJax as its name, in red. During prerendering, these macros are listed in a warning that starts with `tex8web:`.

### One page for each document

tex8web makes one page for each document. A build with a tex4ht split option, a number or `splitat=` in `\Preamble`, is stopped in `tex/tex8web-core.tex`. A build with `\CutAt` in the config is stopped in `page.build_data`, where the page is found without the build elements of tex8web. Both cases are checked with `test-split.tex` and `test-cutat.tex`.

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
- Run `npm run test:visual` also before a commit that touches `js/tex8web-page.js` or the styles of an [opened picture](DOCUMENTATION.md#opening-a-picture). The mouse and touch checks of an opened picture run only in `test/page.mjs`, with the checks of the bar, fade, theme, filter, and transitions.
- For other changes, run `npm run test:visual` at the end of a batch and before opening a pull request.
- Give a bug fix a test where practical: a Lua unit test in `test/unit/`, or a fixture check in `test/run.mjs`.
- Check a visual change with screenshots from `node test/shots.mjs`, wide and narrow, light and dark, next to the PDF.
- Compare your documents before and after your change with `npm run regress`.

### Commands

- **`npm test`**: the Lua unit tests in `test/unit/`, then `test/run.mjs`. Every document in `test/fixtures/` and `examples/` is built by `run.mjs` into `build/test/<document>/`, and each page is checked. To build one document, run `node test/run.mjs <name>`. The build log is kept in `build/test/<document>/make4ht.log`.
  - The tests of the test tools run beside the builds: `test/unit/prerender.test.mjs`, `slots.test.mjs`, `builds.test.mjs`, `realbuild.test.mjs`, `regress.test.mjs`, and `tools.test.mjs`. Most of them run with a stand-in for make4ht, set up in `test/lib/stubs.mjs`. The real make4ht is run in `realbuild.test.mjs`, and a real Chrome in `regress.test.mjs`.
  - `test-mathescape.tex` holds the formulas where the escaping of formula source in tex8web (`\alteqtoks`) could differ from the escaping in tex4ht. This document is built a second time by `run.mjs` with `test-mathescape-stock.cfg`, in which the escaping of tex4ht is restored. The two pages must be the same.
- **`npm run test:visual`**: `test/visual.mjs`, then `test/page.mjs`. Chrome and the network are needed. `test/chrome.test.mjs` and `test/shots.test.mjs` run beside them, so their output is mixed in.
  - `visual.mjs`: each page, prerendered and typeset by MathJax in the browser, compared screen by screen
  - `page.mjs`: the page script, and the tint of a linked equation, tested on the fixtures that have each feature. To run `page.mjs` alone, run `npm run test:page`.
  - `chrome.test.mjs`: tests of `test/lib/chrome.mjs`
  - `shots.test.mjs`: tests of the comparison of two builds in `shots.mjs`
- **`npm run examples`**: the PDF and page of each example, built into `examples/<name>/build/`, and the published site, built into `build/site/`.
- **`node test/shots.mjs`**: screenshots of a page, a comparison of two builds, the band of one element (`--clip`), or a measurement (`--eval`). With other options, a script is run on the page first (`--then`), a touch screen is emulated (`--touch`), or the page is shot in one window of another size (`--window`). Progress is printed on stderr, as a long page takes minutes. Compare the screenshots with the PDF page, rendered with `pdftoppm -png -r 100 -f <n> -l <n> -singlefile <pdf> <out>/pdf`.
  - In a comparison, a page is shot in strips of several screens, because a Chrome capture costs the same at any height. Only the strips that differ are decoded (`test/lib/png.mjs`) and compared screen by screen, so each screen is the same as a separate shot of that screen. The first eight differing screens for each width and color scheme are written (`--keep <n | all>`), and all of them are listed.
  - With `--expect look`, the comparison of each width and color scheme ends at the first strip that differs.
  - With `--cache <dir>`, the comparison results for the strips of the old build are saved as JSON. The key is a hash of the files of the old build, the `shots.mjs` options and sources, and the Chrome version. Several checkouts can share the directory. The directory is never pruned: delete it when it grows.
- **`npm run regress -- <documents>`**: builds of your documents, checked and compared with their baselines, as described in [DOCUMENTATION.md](DOCUMENTATION.md). `regress` is made of the tools above: builds with `test/lib/build.mjs`, the checks of `check.mjs`, `diff.mjs`, and `shots.mjs` only if the HTML changed.
  - With `--accept`, no screens are compared.
  - The script is run by npm in the tex8web directory, so relative paths are taken from `INIT_CWD`.
  - With `--latexmk`, the PDF of each document is built first. During the PDF build, `build/pdf.lock` in the directory of the document is held, so that two runs of latexmk never write to the same `build/pdf` at once. Without `--latexmk`, build the PDFs linked in the config before you run `regress`.
  - The screens of a changed page are compared as soon as the page is built, with `--shots-cache <dir>` passed to `shots.mjs` (`<out>/shots-cache` by default).
- **`node test/diff.mjs <old> <new>`**: what changed in the HTML between two builds
- **`node test/check.mjs <html dir> [make4ht log] [TeX log]`**: the generic page checks, on any build
- **`test/checklist.md`**: the checklist for comparing the page of `test.tex` with its PDF by eye

### Build slots

A build slot is held for every make4ht or latexmk build, and for every Chrome launched by the tests, while the build or Chrome runs. A build slot is a lock file in `$TMPDIR/tex8web-slots`, taken with `lockf` (`test/lib/slots.mjs`). The build slots are shared by all test runs on the machine, in every checkout, so that the machine does not swap when tests run in several checkouts at once.

- There is one build slot for each 4 GB of memory. To change the number, set `TEX8WEB_SLOTS` to a whole number of 1 or more.
- A message is printed after 10 seconds of waiting for a build slot, and every minute after that.
- Without `lockf`, as on Linux, there are no build slots.
- The tests of the test tools use a separate pool of two build slots, set up in `test/lib/stubs.mjs`.

### Reused builds

Each build is saved with a stamp of what the build was made from, in `build/test/<document>/html.stamp`. A later build with the same stamp is not run again. The stamp covers:

- the files in the `bin`, `css`, `fonts`, `js`, `lua`, and `tex` directories of tex8web, `tex8web.cfg`, `tex8web.mk4`, `package.json`, and `package-lock.json`
- the files in the directory of the document, and the config
- the size and modification time of the PDF linked from the page
- the command arguments, and the `TEX8WEB_*`, `TEXINPUTS`, `TEXMF*`, `SOURCE_DATE_EPOCH`, and `FORCE_SOURCE_DATE` environment variables, except `TEX8WEB_SPEECH_CACHE` and the variables that begin with `TEX8WEB_SLOTS`
- the versions of MathJax and subset-font
- the versions of TeX and make4ht, and the last change to TeX Live

Each document is built with the same environment into `build/test/<document>/html` by `npm test`, `npm run test:visual`, and `npm run test:page`. So a build made by one of these commands is reused by the others, with a message in the output. A failed build is never reused.

The LaTeX runs of a build are saved with a separate stamp. This stamp covers only the parts of tex8web that LaTeX reads, and adds the day, for `\today`. After a change to files that are not inputs of LaTeX, for example in `css/`, `js/`, `fonts/`, or the HTML passes, only tex4ht, t4ht, and the HTML passes run again. When the LaTeX runs are reused, the build log has a message about the reuse.

The stamp of the build has no date, so a reused build keeps the `\today` of the day it was built. With `FORCE_SOURCE_DATE`, the date is fixed by `SOURCE_DATE_EPOCH`. The test fixtures are built with a fixed date, January 1, 2000, so their pages do not depend on the day.

To force a build in the tests, remove `build/test/<document>`. For `visual.mjs`, remove `build/visual/<document>` too, where the page typeset by MathJax in the browser is kept. To force a build in `npm run regress`, remove `<out>/html/<name>.stamp`, and to run LaTeX again, remove `<out>/tex4ht/<name>.latex.stamp` too.

### A change that should not show

Build the pages before and after the change, then run `diff.mjs` on the two builds. If the HTML changed, run `shots.mjs` on the two builds too, and look at every screen saved by `shots.mjs`.

### Known gaps

The problems a document is allowed to have are listed in `test/expected.json`, each with its reason. Make each entry as specific as the message it matches. An entry that no longer matches anything is a failure until it is removed.

### Small known differences

The differences from the PDF below are too small to list with the [known limitations](DOCUMENTATION.md#known-limitations) in DOCUMENTATION.md.

- **Math in a page built with Node is laid out from estimates** in place of browser measurements, for example text in math for which MathJax has no glyphs. A box can be a pixel or so off.
- **Delimiters and radicals** can differ slightly in size from the PDF, because they are taken from the MathJax font.
- **The space before inline math after a word in another font**, for example a keyword of algorithm2e before its argument. In a page built without Node, this space can be in the font of the word. The space is in the font of the text in a page built with Node. The two pages can be a pixel apart, and neither always matches the PDF.

### CI

On every push to main and every pull request, `npm test` and `npm run test:visual` run in CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). CI runs in the TeX Live Docker image, pinned by digest. The published site is also built in CI, and published to GitHub Pages from main.

### The README screenshot

The README screenshot is `.github/screenshot.png`. To make a new one:

1. Build the `custom` example and its PDF with `npm run examples`.
2. Render the first page of the PDF with `pdftoppm`, and take a wide, light screenshot of the page with `shots.mjs`.
3. Put the two images side by side, and keep the file under 300 KB.

## Updating MathJax or TeX Live

### MathJax

Move `mathjax` and every `@mathjax/*` package to the new version in one commit. Run these checks on the update:

- the `typeset` checks of `npm test`, for the internals that `tex8web.js` depends on
- `npm run test:visual`, for the comparison of MathJax in Node with MathJax in the browser
- `npm run regress` on your documents, compared with their baselines

When `node_modules/` holds a MathJax other than the version pinned in `package.json`, a warning is printed during the build, and the math is typeset in the browser.

`js/prerender.mjs` also depends on these parts of MathJax:

- `TEXCLASS`, `postFilters`, and `walkTree` of `MmlTree`. The `postFilters` are the adjustment of the math for speech.
- `outputData.speech` of each formula in the second typesetting, and its words for a table of one row ("1 lines Line 1: ")
- the rendering of an unknown macro by the noundefined extension: an `mtext` with a `mathcolor`, holding the macro name
- `WorkerHandler.Speech` of `a11y/speech`, through which the speech is saved: its arguments, and that the label is left in `outputData.speech`
- the same formulas found in the second typesetting as in the first, in the same order. The formulas are paired by position, and an error is thrown when the counts differ.
- the CSS values read in `js/prerender-rules.mjs`: the rule of each removed tag, the rules of `mjx-math` and `mjx-script`, and the sizes of `[size]`. When one of these values differs, the pass that removes elements is skipped, and `npm test` fails with a line that starts with `MathJax:`.

### TeX Live

The TeX Live image of CI is pinned by digest. To update TeX Live, take the new digest of `texlive/texlive:latest`, and confirm that both test jobs pass. A warning from `\web@needs` means that a command that tex8web patches was changed in tex4ht or in a package.

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
| `tex/tex8web-math.tex` | the MathJax configuration, `\WebMathMacros`, the escaping of formula source, siunitx, equation numbers, `\intertext`, and TikZ in display math |
| `tex/tex8web-text.tex` | links, cross-references, theorems, `\hfill`, the table of contents, lists, boxes of framed and mdframed, algorithms (the ruled style of float, algorithmicx, algorithm2e), figures, and `\WebTerm` |
| `tex/tex8web-page.tex` | `<head>`, `\WebPDF`, `\WebUp`, `\WebColor`, `\color` as a declaration, and the measurements and heading fonts of the document |
| `tex/tex8web-boxes.tex` | tcolorbox boxes |
| `tex/tex8web-hooks.sty` | loaded before the preamble: settings lost under tex4ht, and `\web@needs` |
| `css/tex8web.css` | the page styles |
| `lua/tex8web/macros.lua`, `preamble.lua` | macros in math, and their colors |
| `lua/tex8web/source.lua`, `text.lua`, `page.lua` | HTML passes: formula source, colors, spacing, theorems in boxes, footnotes, links, page controls, the table of contents, meta tags, and scripts |
| `lua/tex8web/assets.lua`, `bibliography.lua`, `index.lua`, `prerender.lua` | the files next to the page, bibtex and biber, makeindex, and prerendering |
| `lua/tex8web/files.lua`, `dom.lua` | file and DOM helpers |
| `js/tex8web.js` | MathJax sizes set as in TeX |
| `js/tex8web-fonts.js` | the font preload links, written inline in the head of each page, before the stylesheet link |
| `js/tex8web-head.js` | the theme and table of contents setting of the reader, applied before the page is drawn, and the direction of the transition to the next page. The settings are saved in `localStorage` under the keys `tex8web-theme` and `tex8web-contents`. |
| `js/tex8web-page.js` | the page controls (the up button is a step back in history), footnotes, table of contents, [search field](DOCUMENTATION.md#search-field), [preview cards](DOCUMENTATION.md#preview-cards), and [opened pictures](DOCUMENTATION.md#opening-a-picture) |
| `js/prerender.mjs`, `prerender-rules.mjs` | MathJax in Node, and the MathJax CSS rules that the removal of elements depends on |
| `fonts/` | Latin Modern as WOFF2, and `LICENSE.txt`, which is copied with every page |
| `examples/` | the examples, and `index.tex`, the index of the published site |
| `test/` | `run.mjs`, `visual.mjs`, `page.mjs`, `examples.mjs`, `check.mjs`, `diff.mjs`, `shots.mjs`, `regress.mjs`, the `*.test.mjs` tests of the test tools, `unit/`, `fixtures/`, `expected.json`, `checklist.md`, and `lib/` |
| `.github/workflows/ci.yml` | CI and the published examples |
