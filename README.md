# web2

A tex4ht configuration that turns a LaTeX document into HTML that looks like its PDF. MathJax typesets the math in the browser from its LaTeX source, so it reads the formulas as written. The page follows the reader's light or dark setting.

The conversion has three parts:

1. **tex4ht** (`web2.cfg`, `tex/`). tex4ht's `mathjax` option writes the text as HTML and leaves each formula's LaTeX in the page. The configuration does three more things:
   - It numbers equations with TeX's own numbers, so they agree with `\eqref`.
   - It splits alignments at `\intertext`.
   - It passes the document's lengths and colors to the page: text width, theorem spacing, list spacing, link colors.
2. **The macro bridge** (`lua/web2/macros.lua`). MathJax doesn't see the preamble, so it doesn't know the document's macros. The bridge reads the definitions from the document and from the local packages it loads. It translates them for MathJax and puts into the page only those the math uses. Templates, layout code and the rest of the source are never published.
   - It reads `\newcommand` and its relatives, `\NewDocumentCommand` (for argument specs `\newcommand` can express), `\DeclareMathOperator`, `\DeclarePairedDelimiter(X)`, `\def` and `\let`.
   - A definition MathJax can't read (one using `@` macros, `\mathpalette`, `\scalebox`, …) is left out, and the build ends with a warning naming it.
3. **MathJax adjustments** (`js/web2.js`). MathJax's TeX input differs from TeX in a few sizes, and this file sets them as TeX does:
   - `\big` and its relatives;
   - the 10pt delimiters and large operators in an 11pt or 12pt document;
   - rows of arrays and alignments;
   - line breaks after relations.

`test.tex` and `test-generic.tex` exercise it. See [TESTING.md](TESTING.md).

## Use

Requires a recent TeX Live with make4ht (tested with TeX Live 2026). MathJax 4 is loaded from jsDelivr.

```sh
make4ht -c path/to/web2/web2.cfg -e path/to/web2/web2.mk4 document.tex
```

The output is:
- `document.html` and `document.css`;
- `web2.js`;
- any pictures;
- `fonts/` (Latin Modern, copied from the TeX installation).

To keep tex4ht's auxiliary files apart and collect just the page, add `-B build -d out`: everything is built in `build/` and the page is copied to `out/`. Pass both files every time: `web2.mk4` puts `tex/` on TeX's search path for `web2.cfg`.

MathJax loads the extensions for the packages the document uses that it has: physics, braket, cancel, mhchem and so on. Others load when a macro needs them.

## Your own config

For macros or styles of your own, copy `web2.cfg` and add to it after `\input{web2-core.tex}`:

```latex
\Preamble{xhtml,mathjax}
\begin{document}
\input{web2-core.tex}
% a macro MathJax can't read as defined (here, one using \mathpalette)
\WebMathMacros{
    \newcommand{\Sin}{\mathop{\phantom{\cos}\llap{\sin}}}
}
% a color for your own CSS, in light and dark mode: var(--highlight)
% (needs xcolor)
\definecolor{highlight-dark}{RGB}{74, 67, 37}
\WebColor{highlight}{yellow!20}{highlight-dark}
\Css{.highlight { background-color: var(--highlight); }}
\EndPreamble
```

Pass it with `-c` instead of `web2.cfg`. `\WebMathMacros` definitions take precedence over the document's own. Later `\Css` rules override earlier ones, so you can also change the layout choices below.

## Deliberate differences from the PDF

- The text is 12pt, larger than most PDFs, and everything else is sized in proportion.
- The column is as wide as the PDF's in ems.
- Paragraphs are separated by space instead of indented.
- Display math that doesn't fit scrolls sideways.
- Dark mode has its own palette, and pictures are inverted in it.

## Layout

| Path | Contents |
| --- | --- |
| `web2.cfg` | entry point for documents without a config of their own |
| `tex/web2-core.tex` | loads the three modules below |
| `tex/web2-math.tex` | MathJax's configuration, `\WebMathMacros`, equation numbers, `\intertext`, TikZ pictures in display math |
| `tex/web2-text.tex` | links, cross-references, theorems, table of contents, lists, figures |
| `tex/web2-page.tex` | `<head>`, colors, fonts, layout |
| `web2.mk4` | build file: search paths, fonts, `web2.js` and images, the HTML passes |
| `lua/web2/macros.lua` | the macro bridge |
| `lua/web2/source.lua`, `text.lua` | HTML passes: formula sources, theorem spacing, no-break spaces |
| `lua/web2/dom.lua` | the few DOM operations LuaXML lacks |
| `js/web2.js` | MathJax's sizes set as TeX's |
| `test.tex`, `test-generic.tex`, `TESTING.md` | the diagnostic documents and how to use them |

Known limitations are listed at the end of TESTING.md.
