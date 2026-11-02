# web

A tex4ht configuration that turns a LaTeX document into HTML that looks like its PDF. Math becomes MathML, which MathJax draws in the browser. The page follows the reader's light or dark setting.

Plain tex4ht gets the structure right, but much of the detail wrong: math spacing, fonts, delimiter sizes, accents, alignments, theorem spacing. MathJax then draws what it's given. This configuration fixes that in two stages:

1. **TeX side** (`web.cfg`, `tex/`): tex4ht configuration. It marks constructs that tex4ht would otherwise lose, such as `\bm`, `\textstyle` and `\bigm|`, and passes lengths from the document, such as theorem spacing, the baselineskip and list spacing, into the HTML and CSS.
2. **HTML side** (`web.mk4`, `lua/web/`): a series of small passes over the HTML. They repair the MathML so that MathJax spaces and draws it as TeX would. Each pass is one function, named for what it fixes, and `web.mk4` lists them in order.

`test.tex` exercises it. See [TESTING.md](TESTING.md) for how to build it (as a PDF, through this tool, and through plain make4ht) and use it to check a conversion.

## Use

Requires a recent TeX Live with make4ht (tested with TeX Live 2026). MathJax 4 is loaded from jsDelivr.

```sh
make4ht -c path/to/web/web.cfg -e path/to/web/web.mk4 document.tex
```

The output is `document.html`, `document.css`, any pictures, and `fonts/` (Latin Modern, copied from the TeX installation). To keep tex4ht's auxiliary files apart and collect just the page, add `-B build -d out`: everything is built in `build/` and the page is copied to `out/`. Use both files every time: `web.mk4` puts `tex/` on TeX's search path for `web.cfg`.

## Your own config

For macros or styles of your own, copy `web.cfg` and add to it after `\input{web-core.tex}`:

```latex
\Preamble{xhtml,mathml,mathjax}
\begin{document}
\input{web-core.tex}
% macros with a subscript defined in the preamble (\newcommand\KL{D_\mathrm{KL}})
\WebRescan\KL
% \DeclarePairedDelimiter commands used with a size (\abs[\big]{x})
\WebPairedDelimiters{abs,norm}
% a color for your own CSS, in light and dark mode: var(--highlight)
\definecolor{highlight-dark}{RGB}{74, 67, 37}
\WebColor{highlight}{yellow!20}{highlight-dark}
\Css{.highlight { background-color: var(--highlight); }}
\EndPreamble
```

Pass it with `-c` instead of `web.cfg`. Later `\Css` rules override earlier ones, so you can also change the layout choices below.

## Deliberate differences from the PDF

The text is 12pt, larger than most PDFs. Everything else is sized in proportion. The column is as wide as the PDF's in ems. Paragraphs are separated by space instead of indented. Display math that doesn't fit scrolls sideways. Dark mode has its own palette, and pictures are inverted in it.

## Layout

| Path | Contents |
| --- | --- |
| `web.cfg` | entry point for documents without a config of their own |
| `tex/web-core.tex` | loads the three modules below |
| `tex/web-math.tex` | delimiters, spaces, alphabets, scripts, accents |
| `tex/web-text.tex` | links, cross-references, theorems, table of contents, lists, figures |
| `tex/web-page.tex` | `<head>` and MathJax's configuration, colors, fonts, layout |
| `web.mk4` | build file: search paths, fonts and images, the passes in order |
| `lua/web/dom.lua` | the few DOM operations LuaXML lacks |
| `lua/web/mathml.lua` | what the passes need to know about tex4ht's MathML |
| `lua/web/*.lua` | the passes: `structure`, `style`, `classes`, `scripts`, `delimiters`, `accents`, `tables`, `text` |
| `test.tex`, `TESTING.md` | the diagnostic document and how to use it |

Known limitations are listed at the end of TESTING.md.
