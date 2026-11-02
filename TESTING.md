# Checking a LaTeX-to-HTML conversion with test.tex and test-generic.tex

`test.tex` is an ordinary LaTeX article that uses only standard packages (amsmath, amssymb, amsthm, mathtools, bm, hyperref, cleveref, booktabs, TikZ). It touches, in one short document, most of what a tex4ht + MathJax conversion tends to get wrong. Its PDF is the reference. A conversion works when the HTML looks like the PDF, apart from the deliberate differences listed below.

Build three renderings from this directory. Everything goes into `build/`, which git ignores:

| Command | Output | What it is |
| --- | --- | --- |
| `latexmk test.tex` | `build/pdf/test.pdf` | pdfLaTeX's rendering: the reference |
| `make4ht -c web.cfg -e web.mk4 -B build/html test.tex` | `build/html/test.html` | the same source through this tool |
| `make4ht -B build/vanilla test.tex "mathml,mathjax"` | `build/vanilla/test.html` | the same source through plain make4ht, for comparison |

## How to use it

1. Build the PDF and the HTML as above. To check a conversion of your own, build the HTML with your config instead (`-c your.cfg`).
2. Expect the plain build to stop with errors in its log; it still writes the page.
3. Check your build first. The log should have no `!` errors, and the build should end without a warning about macros left undefined for MathJax. The page should have no red macro names and no error boxes: that is MathJax rejecting a formula, or meeting a macro it doesn't know.
4. Open the PDF and the HTML side by side, at about the same text size, with the browser in light mode. Go through them section by section with the checklist below. The checklist's sections have the same numbers as the sections of the PDF. Each row says what to look at, what the PDF shows, and how a broken conversion usually shows it. The failures listed are what plain tex4ht does, so `build/vanilla/test.html` has an example of each.
5. Switch the browser to dark mode and skim the page once more (see the last section).

### Differences that are not failures

- The text is 12pt and the column is as wide as the PDF's in ems. Line breaks and page breaks differ.
- Paragraphs are not indented. They are separated by space instead.
- The table of contents has no page numbers or dot leaders.
- Strokes look slightly heavier. The browser draws the glyphs, not a PDF rasterizer.
- Display math that is too wide for the screen scrolls sideways instead of overflowing.
- In dark mode the colors are different (the PDF has no dark mode).

## Checklist

### Title, abstract and contents

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| Title, author, date | Title not bold, larger than the author and date | Bold title in the browser's default heading size |
| Abstract | Centered "Abstract", text smaller and indented | |
| Contents | Section entries bold; numbers in a column, so titles line up; `$L^2$` in entry 4 set as math | Titles ragged after "10"; "L2" as plain text |

### 1 Text

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| 1.1 Font | Latin Modern (Computer Modern) throughout, including the typewriter text | A browser serif such as Times |
| 1.1 Ligatures, dashes, quotes, accents | fi fl ff ffi ffl joined; en and em dashes; curly quotes; ï é Č | Missing ligature glyphs, straight quotes |
| 1.1 Styles | *emphasis* with upright nested emphasis, bold, bold italic, Small Caps, typewriter, sans | Small caps as full capitals |
| 1.1 Footnote, links | Footnote with math; link and URL in their link colors | |
| 1.2 Lists | Labels 1. 2. and (a) (b), a ★ custom label; space between items; description terms run into their text | Nested labels "a." "b."; ★ label lost; each term on a line of its own |

### 2 Inline math

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

### 3 Display math

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

### 4 Theorems

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| Headings | "Definition 4.1 (Inner product)." bold; remark heading italic | |
| Body | Theorem, lemma and corollary italic; definition, example and remark upright | |
| Spacing | Space between theorems like the space between paragraphs, smaller after a proof | Large (2em) gaps around every theorem |
| Proofs | "*Proof.*" in italic, a QED box at the end | |

### 5 Floats and citations

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| References | "Table 1" and "fig. 1" each linked as a whole (cleveref's `nameinlink`); citations [1] [2] in the citation color | Only the number linked |
| Table | Caption above, booktabs rules, math in cells | |
| Figure | TikZ drawing at its PDF size, caption below | |

### Dark mode

Background dark and text light. Links in lighter link colors. The TikZ figure inverted (white lines on dark). Math in the text color.

## test-generic.tex

A second, short document unlike the first: no xcolor, packages that MathJax has as extensions (physics, braket, cancel), macros defined with `\NewDocumentCommand`, and equations numbered by section. Build it like test.tex:

```sh
make4ht -c web.cfg -e web.mk4 -B build/generic test-generic.tex
```

| Look at | As in the PDF |
| --- | --- |
| Build | No `!` errors, although xcolor isn't loaded |
| Text | `\prob`, `\dist` (with and without its optional argument), `\dv`, `\abs`, `\qty`, `\braket` and `\cancel` drawn, none in red |
| Numbers | The displays numbered (2.1) to (2.4) and (∗); the line after `\nonumber` and the one with `\notag` unnumbered; the references in the last paragraph reading (2.1), (2.2) and (2.3) |

## Known limitations of this tool

These differ from the PDF even with `web.cfg`. They show in `build/html/test.html`.

- **`\intertext`** (3.7). The alignment is split at the text, so its columns no longer line up across it.
- **`\qedhere`.** The QED box follows the display instead of sitting at the right margin.
- **`\widehat` over a single letter** (2.5) is as narrow as `\hat`.
- **A TikZ picture in display math** (`\[ \begin{tikzcd} … \end{tikzcd} \]`) is drawn by TeX as a picture, together with any other math in the same display.
- **Macros MathJax can't read**, such as those built with `\mathpalette`, `\scalebox` or internal `@` macros, and `\NewDocumentCommand` macros with star or other optional arguments. The build names them in a warning at its end, and they show in red; give MathJax a version of each with `\WebMathMacros` (see README.md).
- **Small differences** in the sizes of radicals and of `\left … \right` delimiters, which MathJax picks from its own font.
