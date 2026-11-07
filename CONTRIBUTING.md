# Contributing to tex8web

This file covers how tex8web works, how it is tested and how it is released. The project's rules are in [CLAUDE.md](CLAUDE.md): what belongs in tex8web, how code and comments are written, and when each check runs. Coding agents load that file on their own, and people should read it too.

1. [Setup](#setup)
2. [How it works](#how-it-works)
3. [Testing](#testing)
4. [Updating MathJax or TeX Live](#updating-mathjax-or-tex-live)
5. [Releasing](#releasing)
6. [Reporting a problem](#reporting-a-problem)
7. [Files](#files)

## Setup

You need TeX Live 2026, Node 22 or later and, for `npm run test:visual`, Chrome or Chromium.

```sh
git clone https://github.com/justin-w-li/tex8web.git
cd tex8web
npm ci
npm test
```

## How it works

A page goes through four stages.

### 1. tex4ht

`tex8web.cfg` and `tex/` configure tex4ht.

- tex4ht's `mathjax` option writes the text as HTML and leaves each formula's LaTeX in the page.
- Equations get TeX's own numbers, so they agree with `\eqref`.
- Alignments are split at `\intertext`. `js/tex8web.js` later gives the parts the same columns, so they line up as one alignment.
- TeX measures the document: its text width, heading sizes, theorem and list spacing, and link colors. The measurements reach the stylesheet as `--tex8web-*` custom properties. The stylesheet, `css/tex8web.css`, holds every static rule.
- With tocloft, `\web@tocfont` reads each level's `\cft<level>font` as a heading's font is read. `lua/tex8web/assets.lua` predicts the faces those fonts need, to copy and list for preloading.
- `tex/tex8web-hooks.sty` loads before the preamble. It keeps what tex4ht would discard, such as titlesec's formats and tcolorbox's options. Its `\web@needs` warns when tex4ht or a package no longer has a command tex8web patches. The tests treat that warning as a failure.

### 2. HTML passes

`tex8web.mk4` runs bibtex or biber and makeindex, then the passes in `lua/tex8web/`.

**The macro bridge** (`macros.lua`, `preamble.lua`). MathJax never sees the preamble, so it doesn't know the document's macros. The bridge reads their definitions from the document, the local packages it loads, and the files they `\input` or `\include`. It reads them in the order TeX does, each file where it is loaded, so the last definition wins, except that a `\providecommand` keeps one already made. It translates them for MathJax. The page gets only the macros its math uses, so templates and the rest of the source are never published.

The bridge also handles colors. MathJax knows only CSS's and dvips's color names. The bridge gives it, as `\definecolor` lines:
- the document's own colors, from `\definecolor` and `\colorlet`;
- colors from xcolor's `dvipsnames`, `svgnames` and `x11names` options;
- xcolor's names that CSS gives other values, such as `green` and `orange`;
- mixes and complements, such as `red!50!black` and `-ink`.

It looks for them in every word in braces in the math, so it also finds a color named in a macro's argument.

The colors come before the macros. A `\definecolor` makes MathJax load its color extension and run the whole text again, where a repeated `\DeclarePairedDelimiter` is an error. `tex8web.js` logs such an error as a line that starts with `tex8web:`, which fails the checks.

`tex8web-hooks.sty` records each color as xcolor defines it. TeX writes the values at the end of the document, in the color's model: gray, CMYK or RGB. `macros.lua` mixes them in the model xcolor would, converts as xcolor does, and rounds once. `tex8web.js` adds the color models MathJax lacks: `HTML`, `Gray`, `cmy` and `cmyk`.

**Indexes** (`index.lua`). makeindex gets each `\index`'s count in place of a page number. The counts start at 1000001, so that no number in an entry's text is taken for one. Each count becomes a link back to its `\index`, shown counted from 1. makeindex runs with `-r`, so consecutive counts stay separate. imakeidx runs nothing under tex4ht, so `tex8web-hooks.sty` records the command it would run in the `.aux`.

**The other passes** color the text a `\color` declaration sets, fix spacing, put what follows an `\hfill` at the right, add links to headings and theorems, drop tex4ht's source-line comments, and add meta tags and the page's controls. The text goes in `<main>`; make4ht's own `fixinlines` runs just before, as it only looks at the top of the body. They copy what the page needs next to it, and preload the faces its text uses: Latin Modern's, or TeX Live's for a document in Times, Charter and the like. Those are found by the families the build element names, and by the font classes in the page.

### 3. MathJax's sizes

MathJax's TeX input differs from TeX in a few sizes. `js/tex8web.js` sets them as TeX does:
- `\big` and its relatives;
- the 10pt delimiters and large operators of an 11pt or 12pt document;
- the rows of arrays and alignments;
- line breaks after relations;
- the columns of an alignment split at `\intertext`.

### 4. Prerendering

`js/prerender.mjs` runs MathJax in Node, configured as it is in the browser. The page keeps the result. Prerendering also makes the page lighter:

- **No assistive MathML.** MathJax adds a hidden MathML copy of each formula. On a long page it is a quarter of the markup, and most of a phone's layout time. `TEX8WEB_MATHML=1` keeps it; the tests set it and check the math through it.
- **Speech instead.** Each formula is `role="math"` with its speech as an `aria-label`. The speech comes from MathJax's semantic enrichment, which changes the math itself. So the page is typeset twice: the second typesetting gives the speech and is then dropped. That typesetting also adjusts the math for the speech rule engine, which would say "normal Gamma" for Γ and "raised to the down tack power" for `^\top`. The speech rule engine takes most of prerendering's time, so the speech of each formula is kept for the next build. It is keyed by what MathJax sends the engine, the enriched MathML and the speech options, by MathJax's version, and by the text of `prerender.mjs` and `prerender-rules.mjs`. It is in `TEX8WEB_SPEECH_CACHE`, or else in `<page>-speech.json` among tex4ht's files. `test/lib/build.mjs` sets it to `build/<document>.speech.json` in the document's directory. So the builds of a document outside tex8web, such as `regress`'s, share it across checkouts.
- **Fewer elements.** Wrappers that add nothing to their children's box are removed, such as one-character tokens and `mjx-mrow` in left-aligned math. A long document goes from 67,000 elements to 40,000. A phone restyles the page as it scrolls, in time that grows with that count. test:visual checks that the page still looks like MathJax's own output.
- **Preloaded fonts.** Without preloads, the browser fetches each font when it first needs it, then lays out the page again. `assets.lua` and `prerender.mjs` list the fonts in `data-fonts` on the inline script `js/tex8web-fonts.js`, which inserts the links. The links have `crossorigin`, as `@font-face` fetches in CORS mode and a font would be fetched twice without it.
- **Subset fonts.** MathJax's, Latin Modern's, TeX Gyre's and XCharter's fonts are cut to the document's characters with [subset-font](https://github.com/papandreou/subset-font). A long page's fonts go from about 380 KB to 140 KB.
- **No clipping.** MathJax clips each character to its box. In Safari that gives each character its own layer, which makes scrolling slow. The stylesheet removes the clip.

MathJax draws a macro it doesn't know as its name, in red. Prerendering names these macros in a warning that starts with `tex8web:`.

Without `node_modules/`, or with `TEX8WEB_NO_PRERENDER=1`, this stage is skipped. [DOCUMENTATION.md](DOCUMENTATION.md) says what the page does then ("Without Node").

`tex8web.js` relies on MathJax's internals, so MathJax's version is pinned in `package.json`.

A document has one page. A tex4ht split option (a number or `splitat=` in `\Preamble`) stops the build in `tex/tex8web-core.tex`. A config's `\CutAt` stops it in `page.build_data`, which finds the page without tex8web's build elements. `test-split.tex` and `test-cutat.tex` check both.

## Testing

Each script's header comment says what it checks. CLAUDE.md says when to run which.

- **`npm test`** runs `test/unit/` (Lua) and `test/run.mjs`. `run.mjs` builds every document in `test/fixtures/` and `examples/` into `build/test/<document>/`, and checks each page. `node test/run.mjs <name>` builds one. While it builds, it runs the tests of the test tools beside it: `test/unit/prerender.test.mjs`, `slots.test.mjs`, `builds.test.mjs`, `realbuild.test.mjs`, `regress.test.mjs` and `tools.test.mjs`, which node runs at once. They take their build slots from a pool of their own, so they never wait for another session's builds. `lib/stubs.mjs` sets that up, with two slots, and puts a stand-in for make4ht on the PATH of the tests of stamps, reuse and `regress.mjs`'s flow. `realbuild.test.mjs` runs the real make4ht, to check that a real build is reused, and `regress.test.mjs` runs a real Chrome for the screens.
  - `test-mathescape.tex` has the formulas where tex8web's escaping of a formula's source (`\alteqtoks`) could differ from tex4ht's. `run.mjs` builds it a second time with `test-mathescape-stock.cfg`, which restores tex4ht's, and the two pages must be the same.
- **`npm run test:visual`** needs Chrome and the network. It runs `test/visual.mjs`, then `test/page.mjs`. Beside them it runs `test/chrome.test.mjs` and `test/shots.test.mjs`, so their output is mixed in.
  - `visual.mjs` compares each page, prerendered and typeset by MathJax in the browser, screen by screen.
  - `page.mjs` drives the page's script, and the tint of a linked equation, on the fixtures that have each feature. `npm run test:page` runs it alone.
  - `chrome.test.mjs` tests `test/lib/chrome.mjs`.
  - `shots.test.mjs` tests `shots.mjs`'s comparison of two builds. Its tests run two at a time, with build slots from the tools' pool (`lib/stubs.mjs`). Most shoot short pages, in strips of 3 screens (`TEX8WEB_SHOTS_STRIP`), at only the widths and schemes they look at (`TEX8WEB_SHOTS_VIEWS`). The tests of a strip's screens against single shots, and of an old build replaced during a run, keep long pages and the tool's own strips.
- **`npm run examples`** builds each example's PDF and page into `examples/<name>/build/`, and the published site in `build/site/`.
- **`node test/shots.mjs`** takes the screenshots a visual change is checked with, compares two builds, shoots one element's band (`--clip`) and prints a measurement (`--eval`). It can run a script on the page first (`--then`), play a touch screen (`--touch`), and shoot in one window of another size (`--window`). It prints its progress on stderr, as a long page takes minutes. Set its screenshots beside the PDF's page, rendered with `pdftoppm -png -r 100 -f <n> -l <n> -singlefile <pdf> <out>/pdf`.
  - A comparison shoots a page in strips of screens, as Chrome's capture costs the same whatever its height, and decodes (`lib/png.mjs`) and compares only the strips that differ, so its screens are the ones a shot of each alone gives. It writes the first 8 differing screens for each width and scheme (`--keep <n | all>`) and lists them all.
  - `--expect look` stops each width and scheme at the first strip that differs.
  - `--cache <dir>` keeps the old build's strips, under a key made of its files, the tool's sources and Chrome's version. Checkouts can share the directory. Nothing prunes it: delete it when it grows.
- **`npm run regress -- <documents>`** (`test/regress.mjs`) builds documents, checks them and compares them with their accepted build, as DOCUMENTATION.md's "Checking your documents after an upgrade" describes. Its pieces are the ones above: `lib/build.mjs` builds in the slots, `check.mjs`'s checks, `diff.mjs`, and `shots.mjs` only if the HTML changed.
  - `--accept` compares no screens. A build is reused by its stamp, which includes the config.
  - npm runs the script in tex8web's directory, so relative paths are taken from `INIT_CWD`.
  - `--latexmk` builds each document's PDF first, in a slot, holding `build/pdf.lock` as a wrapper does. Without it a document's own tools must have built the PDF its config links.
  - A changed page's screens are compared as soon as it is built, each page in a Chrome of its own, in a slot, with `--shots-cache <dir>` passed on (`<out>/shots-cache` by default).
- **`node test/diff.mjs <old> <new>`** says what changed in the HTML between two builds.
- **`node test/check.mjs <html dir> [make4ht log] [TeX log]`** runs the generic page checks on any build.
- **`test/checklist.md`** is the checklist for comparing `test.tex`'s page with its PDF by eye.

Each build's log is kept in `build/test/<document>/make4ht.log`.

**Build slots.** Sessions and checkouts that run tests at once would otherwise swap, as each tool sizes its builds for a machine of its own. So every make4ht or latexmk build, and every Chrome the tests launch, holds one of a pool of lock files in `$TMPDIR/tex8web-slots` while it runs (`test/lib/slots.mjs`). The pool has one slot for each 4 GB of memory, or `TEX8WEB_SLOTS` of them, a whole number of 1 or more. A process that waits for a slot says so after 10 seconds and every minute after that. Without `lockf` (Linux) there are no slots. The idle and total limits of a command run in a slot start once it holds it, so only work is timed. A build passes make4ht `-a info`, which prints each step, so that the idle limit times a step rather than the whole build. A Node command run in a slot, as `regress.mjs` runs `shots.mjs`, gives that slot to its first Chrome. `TEX8WEB_SLOTS_HELD` tells it so. A build runs under a watchdog, so that it ends, and gives its slot back, when its tool is killed or it runs over its total limit. A test's Chrome has a watcher too, which ends it and removes its profile when the Node process that launched it is killed. A tool that holds a slot never waits for a build that needs one, so `visual.mjs` builds before it launches Chrome. `regress.mjs` and a wrapper script that builds PDFs take the same slots. Only the tests of the tools, which build almost nothing, take theirs from a pool of their own.

**Reused builds.** A build is kept with a stamp of what it was made from, in `build/test/<document>/html.stamp`. The stamp covers:
- the files in tex8web's `bin`, `css`, `fonts`, `js`, `lua` and `tex` directories, `tex8web.cfg`, `tex8web.mk4`, `package.json` and `package-lock.json`, by content;
- the files in the document's directory, and the config's, by content;
- the PDF the page links, if there is one: its size and modification time, as a page built before the PDF was there lacks the link;
- the command's arguments, and the `TEX8WEB_*`, `TEXINPUTS`, `TEXMF*`, `SOURCE_DATE_EPOCH` and `FORCE_SOURCE_DATE` environment variables, except `TEX8WEB_SPEECH_CACHE` and those that begin `TEX8WEB_SLOTS`;
- the versions of `node_modules/mathjax` and `node_modules/subset-font`, or that one is missing;
- the first line of `tex --version` and of `make4ht --version`, when `tex4ht.sty` was installed, and when tlmgr last changed TeX Live (`tlpkg/texlive.tlpdb`).

**Reused LaTeX runs.** A build also keeps what LaTeX left in its tex4ht directory, in `<aux>.latex`, and the part of the log from LaTeX's runs, in `<aux>.latex.log`. Their stamp, in `<aux>.latex.stamp`, is the build's with less of tex8web: only what LaTeX reads, and the Lua that runs between LaTeX's runs (`latexSources` in `lib/build.mjs`). It leaves out the versions of MathJax and subset-font. It adds the day, which `\today` gives, unless `FORCE_SOURCE_DATE` fixes the date. When a build's stamp has changed but that one hasn't, `tex8web.mk4` copies those files back in place of running LaTeX (`TEX8WEB_LATEX_REUSE`), if they have LaTeX's DVI. The build says so. `tex8web.mk4` copies LaTeX's files only to a `TEX8WEB_LATEX_SAVE` that isn't there yet, and the build removes the old copy first. So a change to `css`, `js`, `fonts` or the HTML passes runs only tex4ht, t4ht and the passes again. To run LaTeX again anyway, remove `<aux>.latex.stamp` (`<out>/tex4ht/<name>.latex.stamp` for `regress`) and the build's own stamp.

The date is not in the build's own stamp, so a reused build keeps the date it was built on. The test fixtures build with a fixed one, January 1, 2000, through `SOURCE_DATE_EPOCH` with `FORCE_SOURCE_DATE`, so their pages don't depend on the day.

`npm test`, `test:visual` and `test:page` build each document with the same environment into `build/test/<document>/html`, so the later ones reuse the earlier one's build, and say so. A change to any of those builds again, and a build that failed is never reused. `test:page` works on a copy in `build/page`, as a reused build is read, never written. To force a build, remove `build/test/<document>`, and `build/visual/<document>`, where `visual.mjs` keeps its browser-typeset `fallback` page, stamped the same way.

**A change that shouldn't show.** Build the pages before and after it, then run `diff.mjs` on the two builds. If the HTML changed, run `shots.mjs` on them too, and look at every screen it saves.

**A wrapper around `regress`.** A directory of many documents, each its own repository, can keep a script of its own: it builds the PDFs with latexmk, in the slots, then runs `npm --prefix path/to/tex8web run regress -- -c config --out build/<key> --baseline build/accepted <documents>`, with `<key>` naming the tex8web checkout, so that each checkout has its own builds. The merged checkout compares with the accepted pages, and passes `--accept` after a merge. A worktree can compare with the pages of tex8web at `git merge-base main HEAD` instead, built by that commit's own `regress` from a `git archive` of it, so that another branch merged since doesn't show in its comparison. The wrapper exits with `regress`'s code, or 1 if a PDF failed.

**Known gaps.** `test/expected.json` lists the problems a document is allowed, each with its reason. Make each entry as specific as the message it allows. An entry that no longer matches anything fails, until it's taken out. `rebuild.sh` has no allowances: a note whose make4ht log says it parsed a page as HTML fails there, and the fix belongs in tex8web.

**CI.** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm test` and `npm run test:visual` on every push to main and every pull request. It uses TeX Live's Docker image, pinned by digest. It also builds the examples' site, and on main publishes it to GitHub Pages.

**The README's screenshot** is `.github/screenshot.png`. To redo it:
1. Build the `custom` example and its PDF with `npm run examples`.
2. Render the PDF's first page with `pdftoppm`, and take the page's wide, light screenshot with `shots.mjs`.
3. Put the two side by side, and keep the file under 300 KB.

## Updating MathJax or TeX Live

**MathJax.** Move `mathjax` and every `@mathjax/*` package to the new version in one commit. Three checks guard the update:
- `npm test`'s `typeset` checks, which cover the internals `tex8web.js` relies on;
- `npm run test:visual`, which compares Node's MathJax with the browser's;
- a rebuild of your own documents, compared with the last one.

A build warns, and leaves the math to the browser, when `node_modules` holds another MathJax than `package.json` pins.

`js/prerender.mjs` also relies on:
- `MmlTree`'s `TEXCLASS`, `postFilters` (the speech's adjustment of the math) and `walkTree`;
- `outputData.speech` of each formula of the second typesetting, and its words for a table of one row ("1 lines Line 1: ");
- noundefined's drawing of a macro it doesn't know: an `mtext` with a `mathcolor`, holding the macro's name;
- `WorkerHandler.Speech` of `a11y/speech`, through which the speech is kept: its arguments, and that it leaves the label in `outputData.speech`;
- that typesetting finding the same formulas, in the same order, as the first: it throws when the counts differ, and pairs them by position;
- the CSS values `js/prerender-rules.mjs` reads: each removed tag's rule, `mjx-math`'s and `mjx-script`'s, and the sizes of `[size]`. When one differs, the pass is skipped and `npm test` fails with a line that starts with `MathJax:`.

**TeX Live.** CI pins TeX Live's image by digest. To update, take the new digest of `texlive/texlive:latest` and confirm both test jobs pass. A warning from `\web@needs` means tex4ht or a package changed something tex8web patches.

## Releasing

Versions are `0.x`: a minor version for features and new `\Web*` commands, a patch for fixes.

1. Main is green on CI.
2. Update `version` in `package.json` and commit.
3. Tag it: `git tag -a vX.Y.Z -m "tex8web X.Y.Z"`, then `git push origin vX.Y.Z`.
4. Run `gh release create vX.Y.Z` with a few lines on what changed for users.

## Reporting a problem

Open an issue with:
- your TeX Live year, and the output of `make4ht -v` and `node -v`;
- the smallest `.tex` file that shows the problem;
- make4ht's output, and what you expected to see.

## Files

| Path | Contents |
| --- | --- |
| `bin/tex8web` | the command that builds a page |
| `tex8web.cfg` | the config for documents without one of their own |
| `tex8web.mk4` | the build file: search paths, build steps, HTML passes, prerendering |
| `tex/tex8web-core.tex` | loads the four modules below |
| `tex/tex8web-math.tex` | MathJax's configuration, `\WebMathMacros`, the escaping of each formula's source, siunitx, equation numbers, `\intertext`, TikZ in display math |
| `tex/tex8web-text.tex` | links, cross-references, theorems, `\hfill`, the table of contents, lists, framed's and mdframed's boxes, algorithms (float's ruled style, algorithmicx, algorithm2e), figures, `\WebTerm` |
| `tex/tex8web-page.tex` | `<head>`, `\WebPDF`, `\WebUp`, `\WebColor`, `\color` as a declaration, the document's measurements and heading fonts |
| `tex/tex8web-boxes.tex` | tcolorbox's boxes |
| `tex/tex8web-hooks.sty` | loaded before the preamble: what tex4ht would discard, and `\web@needs` |
| `css/tex8web.css` | the page's styles |
| `lua/tex8web/macros.lua`, `preamble.lua` | the macro bridge |
| `lua/tex8web/source.lua`, `text.lua`, `page.lua` | HTML passes: formula sources, colors, spacing, theorems in boxes, footnotes, links, controls, the table of contents, meta tags, scripts |
| `lua/tex8web/assets.lua`, `bibliography.lua`, `index.lua`, `prerender.lua` | the files next to the page, bibtex and biber, makeindex, prerendering |
| `lua/tex8web/files.lua`, `dom.lua` | file and DOM helpers |
| `js/tex8web.js` | MathJax's sizes set as TeX's |
| `js/tex8web-fonts.js` | the fonts' preload links, written inline at the top of each page's head |
| `js/tex8web-head.js` | the reader's theme and table of contents setting, applied before the page is drawn, and the direction of the transition to the next page |
| `js/tex8web-page.js` | the page's controls (the up link going back in history), footnotes, table of contents, previews and picture viewer |
| `js/prerender.mjs`, `prerender-rules.mjs` | MathJax in Node, and the rules of its CSS that the pass removing elements relies on |
| `fonts/` | Latin Modern as WOFF2, and `LICENSE.txt`, which goes with every page |
| `examples/` | the examples, and `index.tex`, the published site's index |
| `test/` | `run.mjs`, `visual.mjs`, `page.mjs`, `examples.mjs`, `check.mjs`, `diff.mjs`, `shots.mjs`, `slots.test.mjs`, `builds.test.mjs`, `regress.test.mjs`, `tools.test.mjs`, `chrome.test.mjs`, `shots.test.mjs`, `unit/`, `fixtures/`, `expected.json`, `checklist.md`, `lib/` |
| `.github/workflows/ci.yml` | CI and the published examples |
