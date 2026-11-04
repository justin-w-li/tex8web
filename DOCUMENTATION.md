# tex8web documentation

1. [How it works](#how-it-works)
2. [Building a page](#building-a-page)
3. [Your own config](#your-own-config)
4. [On the page](#on-the-page)
5. [Differences from the PDF](#differences-from-the-pdf)
6. [Known limitations](#known-limitations)
7. [Examples](#examples)
8. [Testing](#testing)
9. [Files](#files)

## How it works

A page goes through four stages:

1. **tex4ht** (`tex8web.cfg`, `tex/`).
   - tex4ht's `mathjax` option writes the text as HTML and leaves each formula's LaTeX in the page.
   - The configuration numbers equations with TeX's own numbers, so they agree with `\eqref`.
   - It splits alignments at `\intertext`, and tex8web.js gives the parts the same columns, so they line up as one alignment.
   - It measures the document (text width, heading sizes, theorem and list spacing, link colors) for the stylesheet `css/tex8web.css`.
2. **HTML passes** (`lua/tex8web/`, run by `tex8web.mk4`).
   - **The macro bridge** (`macros.lua`, `preamble.lua`). MathJax doesn't see the preamble, so it doesn't know the document's macros. The bridge reads their definitions from the document and from the local packages it loads, and translates them for MathJax. The page gets only the macros its math uses, which tex8web.js gives MathJax before it typesets anything; templates and the rest of the source are never published.
   - The other passes fix spacing, add links to headings and theorems, add meta tags and the PDF link, and copy what the page needs next to it.
3. **MathJax's sizes** (`js/tex8web.js`). MathJax's TeX input differs from TeX in a few sizes, and this file sets them as TeX does:
   - `\big` and its relatives;
   - the 10pt delimiters and large operators of an 11pt or 12pt document;
   - the rows of arrays and alignments;
   - line breaks after relations;
   - the columns of an alignment split at `\intertext`, each as wide as in the widest part. These parts aren't left for MathJax to typeset as they scroll into view.
4. **Prerendering** (`js/prerender.mjs`). MathJax typesets the page in Node, configured as it would be in the browser, and the page keeps the result.
   - It leaves out the MathML MathJax adds for screen readers, a hidden copy of each formula that is a quarter of a long page and most of what a phone takes to lay it out. `TEX8WEB_MATHML=1` keeps it, as the tests do: they check the math by it.
   - MathJax clips each character to its box, which in Safari gives every character a layer of its own and makes painting a long page as it scrolls several times slower. The stylesheet removes the clip, prerendered or not. The page looks the same; only a selection's highlight is taller, as tall as the line box of MathJax's ZERO font.
   - Without `node_modules/` (or with `TEX8WEB_NO_PRERENDER=1`), this step is skipped. The page then loads MathJax from jsDelivr, typesets the math as it scrolls into view, and gives screen readers MathML.
   - tex8web.js relies on MathJax's internals. That is why MathJax's version is pinned in `package.json`, which both the prerendering and the page's script use. `npm test` checks what it makes of `test.tex`'s math (`typeset` in `test/run.mjs`): run it when updating MathJax.

## Building a page

```sh
make4ht -c path/to/tex8web/tex8web.cfg -e path/to/tex8web/tex8web.mk4 -B build -d out document.tex
```

Pass both files every time: `tex8web.mk4` puts `tex/` on TeX's search path for `tex8web.cfg`.

- **`-B build`** keeps tex4ht's working files in `build/`. Keep `-` out of this directory's name: make4ht reads it as a Lua pattern when it copies to `-d`, and a `-` there sends files to the wrong place.
- **`-d out`** collects the page and everything it uses:
  - `document.html`, `document.css`;
  - `document-mathjax.css` and `fonts/mathjax/` (MathJax's styles and fonts, when prerendered);
  - `fonts/` (Latin Modern; the sans-serif only if the page uses it);
  - the pictures;
  - the PDF (with `\WebPDF`);
  - `tex8web-head.js` (the reader's theme, applied before the page is drawn) and `tex8web-page.js` (the theme and contents buttons and the table of contents' tracking);
  - `tex8web.js` (when not prerendered).

  The paths are relative, so `out/` can be published as it is. The fonts are the same for every document, so a site with several can serve one copy of them.
- **Bibliographies:** `tex8web.mk4` runs bibtex or biber when the document has a bibliography (make4ht itself doesn't).
- **Indexes:** `tex8web.mk4` runs makeindex when the document has an index (makeidx's or imakeidx's `\makeindex`), through make4ht's indexing library, which links each number in the index back to its `\index`.
- **Platform:** the build calls the shell to run Node, bibtex and makeindex, so it needs a POSIX system (macOS, Linux); Windows isn't supported yet.

## Your own config

Most documents need no config of their own: build them with `tex8web.cfg` as it is. tex8web reads what it needs from the document itself: its macros (for MathJax), colors, theorem styles, lists, headings (titlesec), table of contents (tocloft) and boxes (tcolorbox). Write a config when the build asks for one, with its warning about macros MathJax can't read, or for something the PDF doesn't have, such as a link to it. `examples/custom/custom.cfg` and `examples/complex/complex.cfg` are worked examples: a layout for a document's header box and a PDF link, and macros for MathJax.

A config is a copy of `tex8web.cfg` with your additions after `\input{tex8web-core.tex}`, passed with `-c` in place of `tex8web.cfg`:

```latex
\Preamble{xhtml,mathjax}
\begin{document}
\input{tex8web-core.tex}

% a macro MathJax can't read as defined (here, one using \scalebox)
\WebMathMacros{
    \newcommand{\bigtimes}{\mathop{\Large\times}}
}

% soul's highlighter, \hl{...}, as a span of your own, with a color for
% light and dark mode: var(--highlight)
\renewcommand{\hl}[1]{\HCode{<span class="highlight">}#1\HCode{</span>}}
\definecolor{highlight-dark}{RGB}{74, 67, 37}
\WebColor{highlight}{yellow!20}{highlight-dark}
\Css{.highlight { background-color: var(--highlight); }}

% a link to the PDF after the title (build it first)
\WebPDF{build/pdf/document.pdf}

\EndPreamble
```

| Macro | Use it when |
| --- | --- |
| `\WebMathMacros{definitions}` | the build ends with "macro(s) left undefined for MathJax", or math shows in red: give MathJax a version of the macro it can read |
| `\WebColor{name}{light}{dark}` | your config writes HTML or CSS of its own (a macro redefined with `\HCode`, say) and needs a color that follows dark mode |
| `\WebPDF{path}` | you publish the PDF beside the page and want an icon that links to it |
| `\Css{...}` | you want a style of your own, or to change one of tex8web's |

- **`\WebMathMacros{definitions}`** gives MathJax its own definitions, in MathJax's TeX, which take precedence over the document's.
  - Use it for any macro the build names in its warning at the end ("macro(s) left undefined for MathJax"): those built with `\mathpalette`, `\scalebox` or internal `@` macros, and xparse commands with arguments other than `m` and a leading `O{}`.
  - Use it also for macros the bridge can't see: those defined in loops, by commands of the document's own, or in files it `\input`s (the bridge reads only the document and the local packages it loads).
- **`\WebColor{name}{light}{dark}`** makes the CSS variable `--name` from two xcolor (or color package) colors: the first in light mode, the second in dark mode.
- **`\WebPDF{path}`** copies the PDF next to the page and links it from an icon at the top left. The path is relative to the document's directory.
- **`\Css{...}`** after `\input{tex8web-core.tex}` overrides tex8web's styles. tex8web's styles are in `css/tex8web.css`, and the document's measurements are custom properties you can override:
  - `--tex8web-textwidth`;
  - `--tex8web-title-size`, `--tex8web-section-size` and so on down to `--tex8web-subparagraph-size` (and in a class with chapters, `--tex8web-part-size` and `--tex8web-chapter-size`, with `--tex8web-part-label-size` and `--tex8web-chapter-label-size` for their labels); each numbered heading's `-labelsep` (the space after its number), and with titlesec each heading's `-family`, `-weight`, `-style`, `-variant`, `-align`, `-before` and `-after` (and `-display` for `\paragraph` and `\subparagraph`);
  - `--tex8web-list-sep`, `--tex8web-item-sep` (enumitem's lists carry their own, as `--tex8web-enumitem-*`);
  - `--tex8web-toc-section-number`, then `--tex8web-toc-<level>-indent` and `--tex8web-toc-<level>-number` for each level from `subsection` to `subparagraph`, and `--tex8web-toc-section-skip`, `--tex8web-toc-subsection-skip`, `--tex8web-toc-section-weight`; in a class with chapters, also `--tex8web-toc-chapter-number`, `--tex8web-toc-section-indent`, `--tex8web-toc-chapter-skip` and `--tex8web-toc-chapter-weight`;
  - colors: `--tex8web-bg`, `--tex8web-text`, `--tex8web-link`, `--tex8web-cite`, `--tex8web-url`;
  - each tcolorbox's frame, colors and spacing, as `--tcb-*` on the box's element (listed in `css/tex8web.css`).

  In a config's `\Css`, `@media (--tex8web-wide)` (and `not (--tex8web-wide)`) is a screen with room for the table of contents and footnotes beside the text.

## On the page

- **Controls:** quiet icons at the top left: the table of contents (a drawer on a narrow screen; on a wide one, the button hides or shows the column, fading, and the page remembers the choice as it does the theme), the PDF (with `\WebPDF`, in a new tab), and light or dark. On a narrow screen they're in a bar across the top, which slides away while the reader scrolls down and comes back as they scroll up (a turn of a few pixels, or a bounce past the page's end, doesn't count). From a wide screen to a narrow one, the icons and the table of contents fade out (unless the reader's system asks for reduced motion), and the bar comes back as the reader scrolls up, or at once at the top of the page.
- **Theme:** the page follows the reader's light or dark setting until they choose with the button. The choice is kept in the browser (`localStorage`, key `tex8web-theme`), for every tex8web page of the site, and applied before the page is drawn. Switching fades the page from one theme to the other (a view transition), unless the reader's system asks for reduced motion. `data-theme="light"` or `"dark"` on the root element sets it. Light mode uses the PDF's colors; TikZ pictures are inverted in dark mode.
- **Table of contents:** `\tableofcontents` (or a box holding only the table of contents) moves out of the text, beside it on a wide screen and into a drawer behind the contents button on a narrow one (sliding in, unless the reader's system asks for reduced motion), as wide in both; a `\listoffigures` or `\listoftables` stays in the text. Its title, which also labels the contents button, is the heading above it, or the box's title, or else `\contentsname`. It marks the section being read and shows the entries under that section. Entries are indented, and their numbers boxed, as in the PDF (tocloft's indents and widths, or the class's, which tex8web reads from its `\l@section` and the like, or else article's), from the top level's indent (chapters', or sections'). The space before each entry is half the document's (tocloft's `\cftbeforesecskip` and `\cftbeforesubsecskip`, or the class's), since the column or drawer is narrow; entries are bold where the class's are (without tocloft).
- **Headings** are as much larger than the text as in the PDF, with as much space between number and title: LaTeX's `\quad`, amsart's `\enspace`, KOMA's `\enskip`, or titlesec's. In a class with chapters, a part's and a chapter's title are in report's and book's `\Huge`, and their label ("Chapter 1") above it in `\huge`. The title is in the size its text starts with (`\title{\Large ...}`), when `\title` is in the preamble. With titlesec, each from `\section` to `\subparagraph` has its `\titleformat`'s font, alignment, label (`\thesection.`, say) and space after the label, and its `\titlespacing` above and below it (or the class's); a `\paragraph` or `\subparagraph` is on a line of its own unless its shape is `runin`. titlesec's other shapes, its `\titlelabel`, and titling's `\pretitle` aren't followed.
- **Footnotes** follow the paragraph, list or theorem that holds their mark: beside it on a wide screen, lined up with the mark, and below it on a narrow one. A footnote in a table, figure, box or formula stays at the end of the page. (`tex8web.mk4` gives tex4ht the `fn-in` option, which keeps footnotes on the page; `\thanks` stays under the title.)
- **Previews:** pointing at a link to something on the page (`\ref`, `\eqref`, `\cite`, a footnote mark, a section) shows a copy of it in a card, over the text column: the theorem, box or table, the equation, the reference, the figure, the footnote, or the heading and what follows it. Reaching the link with the keyboard shows it too; on a touch screen, the first tap shows it and the second follows the link, and a tap anywhere else only closes it.
- **Pictures:** clicking a picture in a figure or in display math, or any over twice as tall as the text (not an icon in a line), shows it over the darkened, slightly blurred page, as large as the screen allows (but a picture of pixels no larger than its own size, rather than blurred), on the page's background. There the wheel (or a pinch, on a trackpad or a touch screen) zooms in and out around the pointer, from half that (room to overshoot, zooming out) to four times as large as the screen allows; a double-click (or a double tap) zooms in around the pointer, or, zoomed in, back to where it started, in one easing motion unless the reader's system asks for reduced motion; and dragging moves the picture anywhere it still covers the middle of the screen. Resizing the window, or turning a phone, keeps the zoom and the part of the picture in the middle of the screen. While the zoom changes the picture is scaled, and it is drawn again at its size (an SVG sharp) once the zoom stops. Clicking beside it, or Escape, closes it, fading out (in Safari on iOS too, where a popover doesn't fade out as it closes) unless the reader's system asks for reduced motion. A picture that is a link doesn't open it; the keyboard doesn't reach pictures.
- **Scrolling:** following a link on the page scrolls there smoothly (with JavaScript), unless the reader's system asks for reduced motion; reloading the page doesn't.
- **Without JavaScript** the page still reads: the table of contents shows every entry (and as a drawer, stays open until dismissed), the theme follows the system, and on a wide screen the table of contents can't be hidden.
- **Links:** each heading and numbered theorem has a `#` link to it in the margin, shown on hover. A narrow screen has no room for it, so there the heading or theorem's head is the link (links inside it still work; a theorem's head that wraps is a link only as far across as its last line).
- **Link previews** get the title, and the abstract as the description, if the document has one.
- **Screen readers** get each formula as MathML only when MathJax typesets it in the browser, which also adds speech and braille in its menu, or when the page is built with `TEX8WEB_MATHML=1`. An image's alt text is graphicx's `alt` key, or empty, which they skip.

## Differences from the PDF

These are deliberate:

- The text is 12pt, larger than most PDFs, and everything else is in proportion. The column is as wide as the PDF's in ems.
- A picture keeps its size beside the text as a narrower screen reflows the text, and shrinks only once the column is narrower than it.
- Minipages and subcaption's subfigures on one line of the PDF are side by side, each as wide as in the PDF, spread along the line as by `\hfill` whatever the space between them (`\quad`, say); in a figure, which is centered as a whole, they are spaced evenly. On a column narrower than the text, as on a phone, they wrap, and one alone on its line is as wide as the column.
- Paragraphs are separated by space instead of indented.
- Display math that doesn't fit scrolls sideways; on a narrow screen, so does a table or verbatim block that doesn't, rather than widening the page.
- The table of contents has no page numbers or dot leaders.
- An index is in one column, and its entries' numbers count the `\index` commands in order, as tex4ht's do, rather than giving pages.
- Dark mode has its own palette.

## Known limitations

- **`\qedhere`:** the QED box follows the display instead of sitting at the right margin.
- **enumitem's label alignment:** a label is right-aligned before its item, hanging into the margin; `align=left`, `wide` and `itemindent` aren't followed.
- **A TikZ picture in display math** (`\[ \begin{tikzcd} … \end{tikzcd} \]`) is drawn by TeX as a picture, together with any other math in the same display.
- **Macros MathJax can't read** (see `\WebMathMacros` above), and macros that parse their arguments themselves, such as comma-separated lists. MathJax shows these in red.
- **Small differences** in the sizes of radicals and of `\left … \right` delimiters, which MathJax picks from its own font.
- **tcolorbox:** a box gets its colors (with darker ones in dark mode), rules, corners, borderlines, shadow, spacing and title font; a boxed title is a tab at the top of the box, and `attach title to upper` starts the text. What a skin draws freehand with TikZ (`interior code`, `frame code`, overlays, shadings) comes out as a plain frame and background. Pictures inside listing boxes (`tcblisting` side by side) aren't converted. A fragile command in a box's title can break the build; `\robustify` it in your config.
- **A minipage in a paragraph's text** (`text \begin{minipage}..\end{minipage} text`) breaks the paragraph around it, and `\centering` in a minipage is followed only in a figure, which is centered as a whole.
- **Minipages, more:** two minipages each in its own `\fbox` stay one above the other. On a screen that always shows a scroll bar, a band of window widths as wide as the bar treats the column as wide while it is narrower than the text: a minipage wrapped alone onto a line keeps its PDF width there rather than the column's. A `\ref` to a figure inside a minipage leads to the whole figure, where tex4ht puts the caption's anchor.
- **A picture's height:** only `\includegraphics`'s `width` is followed. With `height` (alone, or with `width`), the picture keeps its own proportions, at a size that isn't the PDF's.
- **Indexes:** only the document's main index is made, not imakeidx's others (`\makeindex[name=...]`), and imakeidx's `program` and `options` aren't followed: makeindex always runs, with no style file. A number in an entry's text after `^`, `[` or a comma (`\index{$L^2$ space}`) is taken for a page and made a link, which breaks the formula (make4ht's `make4ht-indexing.lua`).
- **Chapters and parts:** a chapter's label, "Chapter 1", is tex4ht's. Headings of parts and chapters are in report's and book's sizes, whatever the class's own; an article's parts keep the browser's size, and in the table of contents parts keep tex4ht's look. The AMS classes, whose table of contents sets each number in the line, and classes whose entries set no number width (titletoc's `\titlecontents`) get article's indents and widths.
- **`\contentsname` in another alphabet** (Russian, Greek): a table of contents without a heading, which is titled `\contentsname`, shows LaTeX's commands for its letters (`\CYRS`) as its title and the contents button's label.
- **Document classes tex4ht doesn't know**, such as Tufte-LaTeX (sidenotes, margin figures, letterspacing), need a config of their own.
- **The theme button, while a long page loads,** shows with the other controls but does nothing until `tex8web-page.js` runs, which as a deferred script waits for the whole page to be read in.

## Examples

`npm run examples` builds each into `examples/<name>/build/html`. The examples, with their sources:

| Example | Source | Shows |
| --- | --- | --- |
| `basic` | Overleaf's "Example Project", by Overleaf, CC BY 4.0 | a figure, a table, lists, math, a bibliography, hyperref's colors |
| `footnotes` | "Generic Law Review Article Template", by Kenneth A. Grady, CC BY 4.0, with its filler text replaced by a short article | footnotes in paragraphs, a quotation and a list, one holding a quotation, and `\ref`s to footnotes; `\thanks`; tocloft and titlesec headings five levels deep; Times (`mathptmx`) |
| `custom` | "Class Notes Template", by Siladittya Manna, CC BY 4.0, with its placeholder text replaced by a short lecture | colored tcolorbox environments; a header laid out for the web by `custom.cfg`; a PDF link |
| `complex` | "Fun Template 2", by Senan Sekhon, CC BY 4.0, with its bibliography rebuilt and its QED picture redrawn | a long document with many packages; `complex.cfg` gives MathJax the macros it can't read. Its known gaps are in `test/expected.json` |

Each `main.tex` names its source, license and changes at the top.

## Testing

- **`npm test`** runs the Lua unit tests (`test/unit/`), then builds every test document (`test/fixtures/`, each with its own `<name>.cfg` if it has one, as `test.cfg` gives `test.tex` a `\WebColor`) and example into `build/test/`, and checks each:
  - no TeX errors, no build warnings, and no warning from tex8web that tex4ht or a package no longer has a command tex8web patches or calls;
  - no scripts in a prerendered page but tex8web's (tex8web-head.js and tex8web-page.js), no MathJax errors, no macros MathJax doesn't know, no `\widehat` or `\widetilde` as narrow as `\hat` or `\tilde`;
  - the table of contents beside the text, not in it (a list of figures stays), each entry's number in its box, and each heading's label holding its entry's number, with one space after it, which the stylesheet sizes; test-generic's measured spacing, label space and title size; and test-report's table of contents (with its title, beside the text, the list of figures before it still in the text) and its measured indents, number widths and chapter sizes;
  - each enumitem list with its own lengths;
  - in `test.tex`, what tex8web.js makes of the math through MathJax's internals (delimiter sizes, an align's rows);
  - in `test-index.tex`, the index: its entries, a subentry, a page range and a "see", each number linking back to its `\index`;
  - MathML for every formula (the tests build with `TEX8WEB_MATHML=1`);
  - every link and file in place;
  - no image with tex4ht's made-up alt text (PIC, [Picture]);
  - nothing but published files in the output.

  It also builds one document for MathJax in the browser. `test/expected.json` lists the known problems a document is allowed, with the reason. `node test/run.mjs <name>` checks one document.
- **`node test/check.mjs <html directory> [make4ht log]`** makes the same checks of any build's pages (and of make4ht's log), and fails if one fails.
- **`node test/diff.mjs <old> <new>`** says what changed between two builds of a page: the sections that differ, with how many of their formulas and their first difference (sections with the same one together, and a section whose heading changed as one), the stylesheets' changed lines, and the files added or removed. A rebuild of a document's page that shouldn't change it should print `unchanged`.
- **`npm run test:visual`** (needs Chrome and the network) builds each document twice, prerendered and for the browser. It compares the two in headless Chrome, screen by screen, with JavaScript off; differing screens are saved in `build/test/<document>/visual/`. In both, an alignment's columns must line up across its `\intertext`. On the prerendered page, the closer view of pictures is driven with the mouse: which pictures open it, fitting the screen, the wheel and a double-click zooming around the pointer (the double-click's point checked midway too), dragging within the bounds, the picture drawn again at its size, and closing; then, on a phone's screen, a tap opening it, a double tap zooming in and turning the phone. Every page must also be no wider than a phone's screen (390px), its bar there going away and coming back as it scrolls but not for a turn of a few pixels, its theme button hidden with JavaScript off but shown before `tex8web-page.js` runs, with no math character clipped, in both pages. A change to the math path (MathJax's configuration, tex8web.js, prerendering, the macro bridge) needs it; others change both pages alike.
- **The visual checklist:** `test/fixtures/test.tex` is an ordinary article that touches what a tex4ht + MathJax conversion tends to get wrong. Its PDF is the reference:

  ```sh
  cd test/fixtures
  latexmk test.tex          # build/pdf/test.pdf
  node ../run.mjs test      # ../../build/test/test/html/test.html
  ```

  Open the two side by side, in light mode, and go through them with the checklist. Its sections have the numbers of the PDF's sections. The "typical failures" are what plain tex4ht does.

#### Title, abstract and contents

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| Title, author, date | Title not bold, larger than the author and date | Bold title in the browser's default heading size |
| Abstract | Centered "Abstract", text smaller and indented | |
| Contents | Section entries bold; numbers in a column, so titles line up; `$L^2$` in entry 4 set as math | Titles ragged after "10"; "L2" as plain text |

#### 1 Text

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| 1.1 Font | Latin Modern (Computer Modern) throughout, including the typewriter and sans-serif text | A browser serif such as Times |
| 1.1 Ligatures, dashes, quotes, accents | fi fl ff ffi ffl joined; en and em dashes; curly quotes; ï é Č | Missing ligature glyphs, straight quotes |
| 1.1 Styles | *emphasis* with upright nested emphasis, bold, bold italic, Small Caps, typewriter, sans | Small caps as full capitals |
| 1.1 Footnote, links | Footnote with math; link and URL in their link colors | |
| 1.2 Lists | Labels 1. 2. and (a) (b), a ★ custom label; space between items; description terms run into their text | Nested labels "a." "b."; ★ label lost; each term on a line of its own |

#### 2 Inline math

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| 2.1 Alphabets | `\mathbf` bold upright, but `\bm` bold *italic* (𝒙, 𝜷); `\mathcal` (round 𝓛) clearly different from `\mathscr` (script); `\mathbb`, `\mathfrak`, `\mathsf`, `\mathtt` | `\bm` upright; `\mathcal` drawn in the script face; "Math input error" on `\text{... ff/fi}` |
| 2.2 Operators | sin, log, Var, tr upright; no gap in sin(x), log(n), Var(X); inline limits beside the operator (max with *i* as a subscript, lim with *n*→∞ as a subscript); lim sup as one operator; (mod *n*) upright | Limits under max and lim in running text; a gap before the parenthesis; "mod" italic; an error for `\argmax` |
| 2.3 Relations and spacing | *f*: *A*→*B* (the colon close to *f*); spacing of `\,` `\:` `\;` `\!` `\quad` `\qquad`; unary minus in −1 snug, binary minus spaced; slanted ⩽ in `\leqslant`; curly ≽ for `\succcurlyeq`; `\|v\|` with no space inside the bars, ∥ spaced as a relation | *f* : *A* (colon spaced as a relation); ≤ for ⩽; "Math input error" on `\{x : x > 0\}` |
| 2.4 Scripts and primes | Primes raised and large (*f*′); *x*<sub>op</sub> for `x_\mathrm{op}` and `x_\mr{op}`; *D*<sub>KL</sub> | Small primes at the baseline; "x op" or "x_op" as text; "DKL" with no subscript |
| 2.5 Accents | `\hat` and `\tilde` the width of a letter, `\widehat` and `\widetilde` across *xyz*; a short `\vec` arrow; `\overline` across *x*+*y*; `\underline` just under *x* | A wide hat over 𝜷; a long arrow over *v*; the underline far below |
| 2.6 Fractions and roots | `\tfrac` small, `\dfrac` large; binomials; `smallmatrix` in small type | A full-size smallmatrix |
| 2.7 Delimiters | `\big` to `\Bigg` in four increasing sizes; `\abs*` growing to fit ½; `\abs[\big]` slightly large; the bar in *P*(*A* ∣ *B*) a little larger | All sizes alike, or each too large; `\abs[\big]` plain size |
| 2.8 Math styles | `\textstyle\sum` with its limits beside it | |

#### 3 Display math

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| 3.1 Large operators | Limits under and over ∑ ∏, beside ∫; `\substack` stacked; `\textstyle\sum` with its limits beside; `\int\limits` limits over and under | A "Math input error" where the second display should be |
| 3.2 Braces and arrows | Both braces as wide as their contents, labels close; the `\xrightarrow` arrow as long as its labels | An unstretched overbrace or a short fixed arrow |
| 3.3 Big delimiters | `\left( … \right)` as tall as the fraction inside; `\biggl(` inside `\Biggl[` | Delimiters much taller than in the PDF |
| 3.4 Fractions and text | Text inside the display upright with normal word spaces; `\phantom` leaves a gap | |
| 3.5 Numbered equations | Each equation centered on the line, its number at the right margin; the split's `=` signs aligned; the references (1), eq. (2) and 2 link to them | Equation pushed left of center by its number |
| 3.6 Cases | Brace with two aligned columns; `dcases` fraction full size | The displays missing entirely |
| 3.7 Alignments | `=` aligned with no extra space around them; numbers (3), (∗), (4) beside their lines; the notes ("by Cauchy–Schwarz, and so" and the four after) as ordinary lines of text, with the columns lined up across each; *a* = *b* and *c* = *d* in two column pairs; lines starting with ≤ or = spaced as relations; gather centered; multline's first line left, last line right; alignat's two column pairs | Extra space around `=` and inside ‖ ‖; the note pushing the table wider than the page |
| 3.8 Matrices and arrays | Delimiters just taller than the rows; `pmatrix*[r]` right-aligned; the vertical rule and `\hline` in the array | Very large delimiters; rules missing |
| 3.9 Wide displays | Scrolls sideways within the column, the page doesn't | Text running off the page |

#### 4 Theorems

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| Headings | "Definition 4.1 (Inner product)." bold; remark heading italic | |
| Body | Theorem, lemma and corollary italic; definition, example and remark upright | |
| Spacing | Space between theorems like the space between paragraphs, smaller after a proof | Large (2em) gaps around every theorem |
| Proofs | "*Proof.*" in italic, a QED box at the end | |

#### 5 Floats and citations

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| References | "Table 1" and "fig. 1" each linked as a whole (cleveref's `nameinlink`); citations [1] [2] in the citation color | Only the number linked |
| Table | Caption above, booktabs rules, math in cells | |
| Figure | TikZ drawing at its PDF size, caption below | |
| Pictures | Side by side, each as wide as in the PDF, the second twice the first | One above the other, as wide as the text |
| Subfigures | Side by side, each picture half as wide as its subfigure, captions (a) and (b) below them | One above the other, or the pictures as wide as the subfigures |

#### Dark mode

Background dark and text light. Links in lighter link colors. The TikZ figure inverted (white lines on dark). Math in the text color.

#### test-generic.tex

A second, short document unlike the first:
- no xcolor;
- packages that MathJax has as extensions (physics, braket, cancel);
- macros defined with `\NewDocumentCommand`;
- equations numbered by section;
- titlesec's headings, spaced in its `*n` form, and a `\Large` title.

| Look at | As in the PDF |
| --- | --- |
| Build | No `!` errors, although xcolor isn't loaded |
| Text | `\prob`, `\dist` (with and without its optional argument), `\dv`, `\abs`, `\qty`, `\braket` and `\cancel` drawn, none in red |
| Numbers | The displays numbered (2.1) to (2.4) and (∗); the line after `\nonumber` and the one with `\notag` unnumbered; the references in the last paragraph reading (2.1), (2.2) and (2.3) |

#### test-report.tex

A report: a list of figures before the table of contents, a part, two chapters with sections and a subsection, a figure, and an appendix.

| Look at | As in the PDF |
| --- | --- |
| Contents | Beside the text, titled "Contents", not the list of figures, which stays in the text; chapter entries (the appendix's too) bold with their numbers in a column, section entries indented under them |
| Headings | "Part I" and "Chapter 1" above their titles, the titles in `\Huge`, the labels a little smaller |

## Files

| Path | Contents |
| --- | --- |
| `tex8web.cfg` | the config for documents without one of their own |
| `tex8web.mk4` | the build file: search paths, the build steps, the HTML passes, prerendering |
| `tex/tex8web-core.tex` | loads the four modules below |
| `tex/tex8web-math.tex` | MathJax's configuration, `\WebMathMacros`, equation numbers, `\intertext`, TikZ pictures in display math |
| `tex/tex8web-text.tex` | links, cross-references, theorems, the table of contents, lists, figures |
| `tex/tex8web-page.tex` | `<head>`, `\WebPDF`, colors (`\WebColor`), the document's measurements and heading fonts |
| `tex/tex8web-boxes.tex` | tcolorbox's boxes |
| `tex/tex8web-hooks.sty` | loaded before the preamble: what tex4ht would discard from it (titlesec's formats, tcolorbox's options), and `\web@needs`, which warns when tex4ht or a package no longer has what tex8web patches |
| `css/tex8web.css` | the page's styles |
| `lua/tex8web/macros.lua`, `preamble.lua` | the macro bridge |
| `lua/tex8web/source.lua`, `text.lua`, `page.lua` | HTML passes: formula sources, theorem spacing, heading numbers, no-break spaces, rows of minipages, footnotes, links, controls and the table of contents, meta tags, scripts |
| `lua/tex8web/assets.lua`, `bibliography.lua`, `index.lua`, `prerender.lua` | the files next to the page, bibtex and biber, makeindex, prerendering |
| `lua/tex8web/files.lua` | reading files, and quoting their names for the shell |
| `lua/tex8web/dom.lua` | the few DOM operations LuaXML lacks |
| `js/tex8web.js` | MathJax's sizes set as TeX's, and the columns of an alignment split at `\intertext` |
| `js/tex8web-head.js` | the reader's theme, and whether they hid the table of contents, applied before the page is drawn |
| `js/tex8web-page.js` | the theme button, the narrow screen's bar, footnotes lined up with their marks, the table of contents' tracking, previews, the closer view of pictures |
| `js/prerender.mjs` | MathJax in Node |
| `fonts/` | Latin Modern (roman, sans and mono), as WOFF2 |
| `examples/` | the examples |
| `test/` | the tests: `run.mjs`, `visual.mjs`, `unit/`, `fixtures/`, `expected.json`; `check.mjs` and `diff.mjs`, for other builds; `lib/` |
