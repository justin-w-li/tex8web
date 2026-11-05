# The visual checklist

`test/fixtures/test.tex` is an ordinary article that touches what a tex4ht and MathJax conversion tends to get wrong. Its PDF is the reference. Build both:

```sh
cd test/fixtures
latexmk test.tex          # build/pdf/test.pdf
node ../run.mjs test      # ../../build/test/test/html/test.html
```

Open the two side by side, in light mode, and go through the tables below. Their sections have the numbers of the PDF's sections. The "typical failure" column is what plain tex4ht does.

## Title, abstract and contents

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| Title, author, date | Title not bold, larger than the author and date | Bold title in the browser's default heading size |
| Abstract | Centered "Abstract", text smaller and indented, lines closer together than the text's | Lines as far apart as the text's |
| Contents | Section entries bold; numbers in a column, so titles line up; `$L^2$` in entry 4 set as math | Titles ragged after "10"; "L2" as plain text |

## 1 Text

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| 1.1 Font | Latin Modern (Computer Modern) throughout, including the typewriter and sans-serif text | A browser serif such as Times |
| 1.1 Ligatures, dashes, quotes, accents | fi fl ff ffi ffl joined; en and em dashes; curly quotes; ï é Č | Missing ligature glyphs, straight quotes |
| 1.1 Styles | *emphasis* with upright nested emphasis, bold, bold italic, Small Caps, typewriter, sans | Small caps as full capitals |
| 1.1 Footnote, links | Footnote with math; link and URL in their link colors | |
| 1.2 Lists | Labels 1. 2. and (a) (b), a ★ custom label; space between items; description terms run into their text | Nested labels "a." "b."; ★ label lost; each term on a line of its own |

## 2 Inline math

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

## 3 Display math

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

## 4 Theorems

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| Headings | "Definition 4.1 (Inner product)." bold; remark heading italic | |
| Body | Theorem, lemma and corollary italic; definition, example and remark upright | |
| Spacing | Space between theorems like the space between paragraphs, smaller after a proof | Large (2em) gaps around every theorem |
| Proofs | "*Proof.*" in italic, a QED box at the end | |

## 5 Floats and citations

| Look at | As in the PDF | Typical failure |
| --- | --- | --- |
| References | "Table 1" and "fig. 1" each linked as a whole (cleveref's `nameinlink`); citations [1] [2] in the citation color | Only the number linked |
| Table | Caption above, booktabs rules, math in cells | |
| Figure | TikZ drawing at its PDF size, caption below | |
| Pictures | Side by side, each as wide as in the PDF, the second twice the first | One above the other, as wide as the text |
| Subfigures | Side by side, each picture half as wide as its subfigure, captions (a) and (b) below them | One above the other, or the pictures as wide as the subfigures |

## Dark mode

Background dark and text light. Links in lighter link colors. The TikZ figure inverted (white lines on dark). Math in the text color.

## test-generic.tex

A second, short document unlike the first:
- no xcolor;
- packages that MathJax has as extensions (physics, braket, cancel, bbm);
- small capitals of an accented letter (`\textsc{Erdős}`), whose capital a prerendered page's font must have;
- macros defined with `\NewDocumentCommand`;
- equations numbered by section;
- titlesec's headings, spaced in its `*n` form, and a `\Large` title;
- framed boxes, one under a heading;
- a theorem and lists under headings.

| Look at | As in the PDF |
| --- | --- |
| Build | No `!` errors, although xcolor isn't loaded |
| Text | `\prob`, `\dist` (with and without its optional argument), `\dv`, `\abs`, `\qty`, `\braket`, `\cancel` and `\mathbbm` drawn, none in red; 𝟙 and 𝒜 in their own fonts beside a + |
| Numbers | The displays numbered (2.1) to (2.4) and (∗); the line after `\nonumber` and the one with `\notag` unnumbered; the references in the last paragraph reading (2.1), (2.2) and (2.3) |
| Framed | The boxes as far from the text above and below as in the PDF, the first further below its heading, Framed, than the list is below A list |
| Under headings | The theorem under section 1, and the lists under A list and A description, as close to their headings as text would be |

## test-report.tex

A report: a list of figures before the table of contents, a part, two chapters with sections and a subsection, a figure, and an appendix.

| Look at | As in the PDF |
| --- | --- |
| Contents | Beside the text, titled "Contents", not the list of figures, which stays in the text; chapter entries (the appendix's too) bold with their numbers in a column, section entries indented under them |
| Headings | "Part I" and "Chapter 1" above their titles, the titles in `\Huge`, the labels a little smaller |
