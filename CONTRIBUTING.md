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
- With tocloft, `\web@tocfont` reads each level's `\cft<level>font` as a heading's font is read. `lua/tex8web/assets.lua` predicts the faces those fonts need, to copy and preload them.
- `tex/tex8web-hooks.sty` loads before the preamble. It keeps what tex4ht would discard, such as titlesec's formats and tcolorbox's options. Its `\web@needs` warns when tex4ht or a package no longer has a command tex8web patches. The tests treat that warning as a failure.

### 2. HTML passes

`tex8web.mk4` runs bibtex or biber and makeindex, then the passes in `lua/tex8web/`.

**The macro bridge** (`macros.lua`, `preamble.lua`). MathJax never sees the preamble, so it doesn't know the document's macros. The bridge reads their definitions from the document, the local packages it loads, and the files they `\input` or `\include`. It reads them in the order TeX does, each file where it is loaded, so the last definition wins, except that a `\providecommand` keeps one already made. It translates them for MathJax. The page gets only the macros its math uses, so templates and the rest of the source are never published.

The bridge also handles colors. MathJax knows only CSS's and dvips's color names. The bridge gives it, as `\definecolor` lines:
- the document's own colors, from `\definecolor` and `\colorlet`;
- colors from xcolor's `dvipsnames`, `svgnames` and `x11names` options;
- xcolor's names that CSS gives other values, such as `green` and `orange`;
- mixes and complements, such as `red!50!black` and `-ink`.

`tex8web-hooks.sty` records each color as xcolor defines it. TeX writes the values at the end of the document. `macros.lua` mixes them in RGB as xcolor does, and rounds once. `tex8web.js` adds the color models MathJax lacks: `HTML`, `Gray`, `cmy` and `cmyk`.

**Indexes** (`index.lua`). makeindex gets each `\index`'s count in place of a page number. The counts start at 1000001, so that no number in an entry's text is taken for one. Each count becomes a link back to its `\index`, shown counted from 1. makeindex runs with `-r`, so consecutive counts stay separate. imakeidx runs nothing under tex4ht, so `tex8web-hooks.sty` records the command it would run in the `.aux`.

**The other passes** color the text a `\color` declaration sets, fix spacing, put what follows an `\hfill` at the right, add links to headings and theorems, and add meta tags and the page's controls. They copy what the page needs next to it, and preload the faces its text uses: Latin Modern's, or TeX Live's for a document in Times, Charter and the like. Those are found by the families the build element names, and by the font classes in the page.

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
- **Speech instead.** Each formula is `role="math"` with its speech as an `aria-label`. The speech comes from MathJax's semantic enrichment, which changes the math itself. So the page is typeset twice: the second typesetting gives the speech and is then dropped. That typesetting also adjusts the math for the speech rule engine, which would say "normal Gamma" for Γ and "raised to the down tack power" for `^\top`.
- **Fewer elements.** Wrappers that add nothing to their children's box are removed, such as one-character tokens and `mjx-mrow` in left-aligned math. A long document goes from 67,000 elements to 40,000. A phone restyles the page as it scrolls, in time that grows with that count. test:visual checks that the page still looks like MathJax's own output.
- **Preloaded fonts.** Without preloads, the browser fetches each font when it first needs it, then lays out the page again.
- **Subset fonts.** MathJax's, Latin Modern's, TeX Gyre's and XCharter's fonts are cut to the document's characters with [subset-font](https://github.com/papandreou/subset-font). A long page's fonts go from about 380 KB to 140 KB.
- **No clipping.** MathJax clips each character to its box. In Safari that gives each character its own layer, which makes scrolling slow. The stylesheet removes the clip.

Without `node_modules/`, or with `TEX8WEB_NO_PRERENDER=1`, this stage is skipped. The page then loads MathJax from jsDelivr and typesets the math in the browser.

`tex8web.js` relies on MathJax's internals, so MathJax's version is pinned in `package.json`.

## Testing

- **`npm test`** runs the Lua unit tests in `test/unit/`, then builds every document in `test/fixtures/` and `examples/` into `build/test/<document>/`. A fixture with its own `<name>.cfg` is built with it. Each page is checked for:
  - TeX errors, build warnings (also make4ht's note that tex4ht wrote HTML its XML parser rejected), and tex8web's warning that tex4ht or a package changed;
  - MathJax errors, macros MathJax doesn't know, the sizes `tex8web.js` sets, and no `NaN` in any style;
  - the table of contents beside the text, with its numbers and indents, and each level's font, with tocloft and without it (`test-tocloft.tex` and `test-report.tex`, whose computed fonts `test:visual` checks);
  - colors in dark mode, `\color` as a declaration (`test-declared.tex`), indexes, each list's lengths, alt text, each example's title and its link to the PDF beside it, the title of a page without `\maketitle`, and pictures' sizes (also with the graphics package, and after angle);
  - text that keeps its own font after font commands the PDF keeps in a group (`test-fonts.tex`), the text in TeX Gyre for Times, Helvetica and Courier (`test-times.tex`, `test-newtx.tex`), in XCharter for Charter and for a font chosen in the text (`test-charter.tex`), or in sans-serif (`test-sans.tex`); a title in the font a redefined `\maketitle` sets (`test-titlefont.tex`); the math in MathJax's Termes, Pagella or Schola for the PDF's in Times, Palatino or New Century Schoolbook (`test-times.tex`, `test-newtx.tex`, `test-pagella.tex` with bbm's, dsfont's and bboldx's fonts, `test-schola.tex`), and in its TeX font otherwise (`test-charter.tex`);
  - what follows an `\hfill` at the right of its line, and nothing where the `\hfill` is in a box, a label or leaders (`test-hfill.tex`); the spaces of verbatim text, alltt and `\verbatiminput` left alone, and only a `~` narrowed (`test-verbatim.tex`);
  - an article as LaTeX's standard classes set it (`test-article.tex`): lists with TeX's labels, the space around headings, the abstract's margins, a footnote's leading, the bibliography, a `\tikz` picture's crop and the fonts after it, and the LaTeX logo;
  - speech for every formula, links and files in place, unique ids, and only publishable files.

  It also builds `test-generic` for MathJax in the browser. Each build's log is kept in `build/test/<document>/make4ht.log`. A build still running after five minutes has hung, and is stopped. `node test/run.mjs <name>` builds and checks one document.
- **`npm run test:visual`** needs Chrome and the network, and takes under two minutes. It builds each document twice into `build/visual/<document>/`, prerendered and for MathJax in the browser. It compares the two in headless Chrome, screen by screen, and they must be identical. Differing screens are saved in `build/visual/<document>/visual/`. It also drives the page's controls: the picture viewer by mouse and touch, the narrow screen's bar, the fade of a display that scrolls, the theme, the contents filter and printing. And it goes from a page to an example and up again, over HTTP, checking each view transition's direction and that the up link went back in history. Run it after changing the math path or `js/tex8web-page.js`, and before merging.
- **`npm run examples`** builds each example's PDF and page into `examples/<name>/build/`. It then builds the published site in `build/site/`: the index, `examples/index.tex`, with each example beside it. The examples link up to the index, so open them from there. It fails if a page or PDF is missing, or if the index links to a file the site lacks.
- **`node test/shots.mjs <out> <page or html dir>`** takes the screenshots a visual change is checked with: each page whole, 1400 and 390 pixels wide, light and dark. Set them beside the PDF's page, rendered with `pdftoppm -png -r 100 -f <n> -l <n> -singlefile <pdf> <out>/pdf`.
- **`node test/shots.mjs <out> <old dir> <new dir>`** compares two builds that way, screen by screen. It saves the screens that differ and fails if any do.
- **`--clip <selector>`**, before either, shoots only the band of the page holding the first element the selector matches.
- **`node test/shots.mjs --eval <expression> <page or html dir>`** prints the expression's value on each page, at both widths and in both schemes, as JSON. It measures one thing, such as an element's box or computed style, without a script of your own.
- **`node test/diff.mjs <old> <new>`** says what changed in the HTML between two builds: the sections, formulas and stylesheet lines. It prints `unchanged`, or fails.
- **`node test/check.mjs <html dir> [make4ht log] [TeX log]`** runs the generic page checks on any build.
- **`test/checklist.md`** is the checklist for comparing `test.tex`'s page with its PDF by eye.

**A change that shouldn't show.** Build the pages before and after it, then run `diff.mjs` on the two builds. If the HTML changed, run `shots.mjs` on them too, and look at every screen it saves.

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
| `tex/tex8web-math.tex` | MathJax's configuration, `\WebMathMacros`, equation numbers, `\intertext`, TikZ in display math |
| `tex/tex8web-text.tex` | links, cross-references, theorems, `\hfill`, the table of contents, lists, framed's boxes, figures, `\WebTerm` |
| `tex/tex8web-page.tex` | `<head>`, `\WebPDF`, `\WebUp`, `\WebColor`, `\color` as a declaration, the document's measurements and heading fonts |
| `tex/tex8web-boxes.tex` | tcolorbox's boxes |
| `tex/tex8web-hooks.sty` | loaded before the preamble: what tex4ht would discard, and `\web@needs` |
| `css/tex8web.css` | the page's styles |
| `lua/tex8web/macros.lua`, `preamble.lua` | the macro bridge |
| `lua/tex8web/source.lua`, `text.lua`, `page.lua` | HTML passes: formula sources, colors, spacing, footnotes, links, controls, the table of contents, meta tags, scripts |
| `lua/tex8web/assets.lua`, `bibliography.lua`, `index.lua`, `prerender.lua` | the files next to the page, bibtex and biber, makeindex, prerendering |
| `lua/tex8web/files.lua`, `dom.lua` | file and DOM helpers |
| `js/tex8web.js` | MathJax's sizes set as TeX's |
| `js/tex8web-head.js` | the reader's theme and table of contents setting, applied before the page is drawn, and the direction of the transition to the next page |
| `js/tex8web-page.js` | the page's controls (the up link going back in history), footnotes, table of contents, previews and picture viewer |
| `js/prerender.mjs` | MathJax in Node |
| `fonts/` | Latin Modern as WOFF2, and `LICENSE.txt`, which goes with every page |
| `examples/` | the examples, and `index.tex`, the published site's index |
| `test/` | `run.mjs`, `visual.mjs`, `examples.mjs`, `check.mjs`, `diff.mjs`, `shots.mjs`, `unit/`, `fixtures/`, `expected.json`, `checklist.md`, `lib/` |
| `.github/workflows/ci.yml` | CI and the published examples |
