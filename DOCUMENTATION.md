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
   - It splits alignments at `\intertext`.
   - It measures the document (text width, heading sizes, theorem and list spacing, link colors) for the stylesheet `css/tex8web.css`.
2. **HTML passes** (`lua/tex8web/`, run by `tex8web.mk4`).
   - **The macro bridge** (`macros.lua`, `preamble.lua`). MathJax doesn't see the preamble, so it doesn't know the document's macros. The bridge reads their definitions from the document and from the local packages it loads, and translates them for MathJax. The page gets only the macros its math uses; templates and the rest of the source are never published.
   - The other passes fix spacing, add links to headings and theorems, add meta tags and the PDF link, and copy what the page needs next to it.
3. **MathJax's sizes** (`js/tex8web.js`). MathJax's TeX input differs from TeX in a few sizes, and this file sets them as TeX does:
   - `\big` and its relatives;
   - the 10pt delimiters and large operators of an 11pt or 12pt document;
   - the rows of arrays and alignments;
   - line breaks after relations.
4. **Prerendering** (`js/prerender.mjs`). MathJax typesets the page in Node, configured as it would be in the browser, and the page keeps the result.
   - Without `node_modules/` (or with `TEX8WEB_NO_PRERENDER=1`), this step is skipped. The page then loads MathJax from jsDelivr, typesets the math as it scrolls into view, and gives screen readers MathML.
   - tex8web.js relies on MathJax's internals. That is why MathJax's version is pinned in `package.json`, which both the prerendering and the page's script use.

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
  - `tex8web-page.js` (the theme button and the table of contents' tracking);
  - `tex8web.js` (when not prerendered).

  The paths are relative, so `out/` can be published as it is. The fonts are the same for every document, so a site with several can serve one copy of them.
- **Bibliographies:** `tex8web.mk4` runs bibtex or biber when the document has a bibliography (make4ht itself doesn't).
- **Platform:** the build calls the shell to run Node and bibtex, so it needs a POSIX system (macOS, Linux); Windows isn't supported yet.

## Your own config

For macros or styles of your own, copy `tex8web.cfg` and add to it after `\input{tex8web-core.tex}`. Then pass your copy with `-c`.

```latex
\Preamble{xhtml,mathjax}
\begin{document}
\input{tex8web-core.tex}

% a macro MathJax can't read as defined (here, one using \mathpalette)
\WebMathMacros{
    \newcommand{\Sin}{\mathop{\phantom{\cos}\llap{\sin}}}
}

% a color for your own CSS, in light and dark mode: var(--highlight)
\definecolor{highlight-dark}{RGB}{74, 67, 37}
\WebColor{highlight}{yellow!20}{highlight-dark}
\Css{.highlight { background-color: var(--highlight); }}

% a link to the PDF after the title (build it first)
\WebPDF{build/pdf/document.pdf}

\EndPreamble
```

- **`\WebMathMacros{definitions}`** gives MathJax its own definitions, in MathJax's TeX, which take precedence over the document's.
  - Use it for any macro the build names in its warning at the end ("macro(s) left undefined for MathJax"): those built with `\mathpalette`, `\scalebox` or internal `@` macros, and xparse commands with arguments other than `m` and a leading `O{}`.
  - Use it also for macros the bridge can't see: those defined in loops, or by commands of the document's own.
- **`\WebColor{name}{light}{dark}`** makes the CSS variable `--name` from two xcolor (or color package) colors.
- **`\WebPDF{path}`** copies the PDF next to the page and links it from an icon at the top left. The path is relative to the document's directory.
- **`\Css{...}`** after `\input{tex8web-core.tex}` overrides tex8web's styles. tex8web's styles are in `css/tex8web.css`, and the document's measurements are custom properties you can override:
  - `--tex8web-textwidth`;
  - `--tex8web-title-size`, `--tex8web-section-size`, `--tex8web-subsection-size`, `--tex8web-subsubsection-size`, and with titlesec each heading's `-family`, `-weight` and `-style`;
  - `--tex8web-list-sep`, `--tex8web-item-sep`;
  - `--tex8web-toc-number`, `--tex8web-toc-indent`, `--tex8web-toc-subnumber`, `--tex8web-toc-section-skip`, `--tex8web-toc-subsection-skip`;
  - colors: `--tex8web-bg`, `--tex8web-text`, `--tex8web-link`, `--tex8web-cite`, `--tex8web-url`;
  - each tcolorbox's frame, colors and spacing, as `--tcb-*` on the box's element (listed in `css/tex8web.css`).

  In a config's `\Css`, `@media (--tex8web-wide)` (and `not (--tex8web-wide)`) is a screen with room for the table of contents and footnotes beside the text.

`examples/custom/custom.cfg` and `examples/complex/complex.cfg` are worked examples: a layout for a document's header box, and macros for MathJax.

## On the page

- **Controls:** quiet icons at the top left: the table of contents (on a narrow screen), the PDF (with `\WebPDF`, in a new tab), and light or dark. On a narrow screen they're in a bar across the top, which slides away while the reader scrolls down and comes back as they scroll up.
- **Theme:** the page follows the reader's light or dark setting until they choose with the button. The choice is kept in the browser (`localStorage`, key `tex8web-theme`), for every tex8web page of the site, and applied before the page is drawn. Switching fades the page from one theme to the other (a view transition), unless the reader's system asks for reduced motion. `data-theme="light"` or `"dark"` on the root element sets it. Light mode uses the PDF's colors; TikZ pictures are inverted in dark mode.
- **Table of contents:** `\tableofcontents` (or a box holding only the table of contents) moves out of the text, beside it on a wide screen and into a drawer behind the contents button on a narrow one (sliding in, unless the reader's system asks for reduced motion), as wide in both. It marks the section being read and shows that section's subsections. The space before each entry is half the document's (tocloft's `\cftbeforesecskip` and `\cftbeforesubsecskip`, or LaTeX's), since the column or drawer is narrow.
- **Footnotes** follow the paragraph, list or theorem that holds their mark: beside it on a wide screen, lined up with the mark, and below it on a narrow one. A footnote in a table, figure, box or formula stays at the end of the page. (`tex8web.mk4` gives tex4ht the `fn-in` option, which keeps footnotes on the page; `\thanks` stays under the title.)
- **Previews:** pointing at a link to something on the page (`\ref`, `\eqref`, `\cite`, a footnote mark, a section) shows a copy of it in a card, over the text column: the theorem, box or table, the equation, the reference, the figure, the footnote, or the heading and what follows it. Reaching the link with the keyboard shows it too; on a touch screen, the first tap shows it and the second follows the link.
- **Without JavaScript** the page still reads: the table of contents shows every entry (and as a drawer, stays open until dismissed), and the theme follows the system.
- **Links:** each heading and numbered theorem has a `#` link to it in the margin, shown on hover.
- **Link previews** get the title, and the abstract as the description, if the document has one.
- **Screen readers** get each formula as MathML. Speech and braille are MathJax's to add when it runs in the browser (in its menu).

## Differences from the PDF

These are deliberate:

- The text is 12pt, larger than most PDFs, and everything else is in proportion. The column is as wide as the PDF's in ems.
- Paragraphs are separated by space instead of indented.
- Display math that doesn't fit scrolls sideways.
- The table of contents has no page numbers or dot leaders.
- Dark mode has its own palette.

## Known limitations

- **`\intertext`:** the alignment is split at the text, so its columns no longer line up across it.
- **`\qedhere`:** the QED box follows the display instead of sitting at the right margin.
- **`\widehat` over a single letter** is as narrow as `\hat`.
- **A TikZ picture in display math** (`\[ \begin{tikzcd} … \end{tikzcd} \]`) is drawn by TeX as a picture, together with any other math in the same display.
- **Macros MathJax can't read** (see `\WebMathMacros` above), and macros that parse their arguments themselves, such as comma-separated lists. MathJax shows these in red.
- **Small differences** in the sizes of radicals and of `\left … \right` delimiters, which MathJax picks from its own font.
- **tcolorbox:** a box gets its colors (with darker ones in dark mode), rules, corners, borderlines, shadow, spacing and title font; a boxed title is a tab at the top of the box, and `attach title to upper` starts the text. What a skin draws freehand with TikZ (`interior code`, `frame code`, overlays, shadings) comes out as a plain frame and background. Pictures inside listing boxes (`tcblisting` side by side) aren't converted. A fragile command in a box's title can break the build; `\robustify` it in your config.
- **Document classes tex4ht doesn't know**, such as Tufte-LaTeX (sidenotes, margin figures, letterspacing), need a config of their own.

## Examples

`npm run examples` builds each into `examples/<name>/build/html`. The examples, with their sources:

| Example | Source | Shows |
| --- | --- | --- |
| `basic` | Overleaf's "Example Project", by Overleaf, CC BY 4.0 | a figure, a table, lists, math, a bibliography, hyperref's colors |
| `blog` | "Should Self-Driving Cars be bound by Isaac Asimov's Three Laws of Robotics?", by Pradhyumnaa Ganapathi Subramanian, CC BY 4.0 | an essay: prose, lists, a table |
| `custom` | "Class Notes Template", by Siladittya Manna, CC BY 4.0, with its placeholder text replaced by a short lecture | colored tcolorbox environments; a header laid out for the web by `custom.cfg`; a PDF link |
| `complex` | "Fun Template 2", by Senan Sekhon, CC BY 4.0, with its bibliography rebuilt and its QED picture redrawn | a long document with many packages; `complex.cfg` gives MathJax the macros it can't read. Its known gaps are in `test/expected.json` |

Each `main.tex` names its source, license and changes at the top.

## Testing

- **`npm test`** runs the Lua unit tests (`test/unit/`), then builds every test document (`test/fixtures/`) and example into `build/test/`, and checks each:
  - no TeX errors, and no build warnings;
  - no scripts in a prerendered page but tex8web's (tex8web-page.js, and a line that applies the reader's theme), no MathJax errors, no macros MathJax doesn't know;
  - the table of contents beside the text, not in it;
  - MathML for every formula;
  - every link and file in place;
  - nothing but published files in the output.

  It also builds one document for MathJax in the browser. `test/expected.json` lists the known problems a document is allowed, with the reason. `node test/run.mjs <name>` checks one document.
- **`npm run test:visual`** (needs Chrome and the network) builds each document twice, prerendered and for the browser. It compares the two in headless Chrome, screen by screen, with JavaScript off; differing screens are saved in `build/test/<document>/visual/`.
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
| 3.7 Alignments | `=` aligned with no extra space around them; numbers (3), (∗), (4) beside their lines; the note "by Cauchy–Schwarz, and so" as an ordinary line of text; *a* = *b* and *c* = *d* in two column pairs; lines starting with ≤ or = spaced as relations; gather centered; multline's first line left, last line right; alignat's two column pairs | Extra space around `=` and inside ‖ ‖; the note pushing the table wider than the page |
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

#### Dark mode

Background dark and text light. Links in lighter link colors. The TikZ figure inverted (white lines on dark). Math in the text color.

#### test-generic.tex

A second, short document unlike the first:
- no xcolor;
- packages that MathJax has as extensions (physics, braket, cancel);
- macros defined with `\NewDocumentCommand`;
- equations numbered by section.

| Look at | As in the PDF |
| --- | --- |
| Build | No `!` errors, although xcolor isn't loaded |
| Text | `\prob`, `\dist` (with and without its optional argument), `\dv`, `\abs`, `\qty`, `\braket` and `\cancel` drawn, none in red |
| Numbers | The displays numbered (2.1) to (2.4) and (∗); the line after `\nonumber` and the one with `\notag` unnumbered; the references in the last paragraph reading (2.1), (2.2) and (2.3) |

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
| `tex/tex8web-hooks.sty` | loaded before the preamble: what tex4ht would discard from it (titlesec's formats) |
| `css/tex8web.css` | the page's styles |
| `lua/tex8web/macros.lua`, `preamble.lua` | the macro bridge |
| `lua/tex8web/source.lua`, `text.lua`, `page.lua` | HTML passes: formula sources, theorem spacing, no-break spaces, footnotes, links, controls and the table of contents, meta tags, scripts |
| `lua/tex8web/assets.lua`, `bibliography.lua`, `prerender.lua` | the files next to the page, bibtex and biber, prerendering |
| `lua/tex8web/dom.lua` | the few DOM operations LuaXML lacks |
| `js/tex8web.js` | MathJax's sizes set as TeX's |
| `js/tex8web-page.js` | the theme button, the narrow screen's bar, footnotes lined up with their marks, the table of contents' tracking, previews |
| `js/prerender.mjs` | MathJax in Node |
| `fonts/` | Latin Modern (roman, sans and mono), as WOFF2 |
| `examples/` | the examples |
| `test/` | the tests: `run.mjs`, `visual.mjs`, `unit/`, `fixtures/`, `expected.json` |
