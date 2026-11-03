# web

A tex4ht configuration that turns a LaTeX document into HTML that looks like its PDF. MathJax typesets the math from its LaTeX source, so it reads the formulas as written. It does so at build time when Node.js is set up, and otherwise in the reader's browser. The page follows the reader's light or dark setting.

The conversion has four parts:

1. **tex4ht** (`tex8web.cfg`, `tex/`). tex4ht's `mathjax` option writes the text as HTML and leaves each formula's LaTeX in the page. The configuration does three more things:
   - It numbers equations with TeX's own numbers, so they agree with `\eqref`.
   - It splits alignments at `\intertext`.
   - It passes the document's lengths and colors to the page: text width, theorem spacing, list spacing, link colors.
2. **The macro bridge** (`lua/web/macros.lua`). MathJax doesn't see the preamble, so it doesn't know the document's macros. The bridge reads the definitions from the document and from the local packages it loads. It translates them for MathJax and puts into the page only those the math uses. Templates, layout code and the rest of the source are never published.
   - It reads `\newcommand` and its relatives, `\NewDocumentCommand` (for argument specs `\newcommand` can express), `\DeclareMathOperator`, `\DeclarePairedDelimiter(X)`, `\def` and `\let`.
   - A definition MathJax can't read (one using `@` macros, `\mathpalette`, `\scalebox`, …) is left out, and the build ends with a warning naming it.
3. **MathJax adjustments** (`js/web.js`). MathJax's TeX input differs from TeX in a few sizes, and this file sets them as TeX does:
   - `\big` and its relatives;
   - the 10pt delimiters and large operators in an 11pt or 12pt document;
   - rows of arrays and alignments;
   - line breaks after relations.
4. **Prerendering** (`prerender.mjs`, optional). MathJax typesets the page in Node, with the page's own configuration and `web.js`, and the page keeps the result. Such a page has no JavaScript: it shows its math at once, also with JavaScript off, saved, or offline. Screen readers get each formula as MathML.

`test.tex` and `test-generic.tex` exercise it. See [TESTING.md](TESTING.md).

## Use

Requires a recent TeX Live with make4ht (tested with TeX Live 2026). For prerendering, also Node.js (tested with Node 26); once, in this directory, run

```sh
npm ci
```

which installs MathJax 4.1.3 and its fonts into `node_modules/`. Then:

```sh
make4ht -c path/to/tex8web/tex8web.cfg -e path/to/tex8web/tex8web.mk4 -B build -d out document.tex
```

Everything is built in `build/`, and `out/` gets the page and the files it uses:
- `document.html` and `document.css`;
- any pictures;
- with prerendering, `document-mathjax.css`, MathJax's styles;
- `fonts/`: Latin Modern (in `fonts/` here), and with prerendering MathJax's fonts in `fonts/mathjax/`;
- without prerendering, `web.js`;
- with `\WebPDF` (below), `document.pdf`.

Pass both files every time: `tex8web.mk4` puts `tex/` on TeX's search path for `tex8web.cfg`. Keep `-` out of the `-B` directory's name: make4ht reads it as a Lua pattern when it copies to `-d`, and a `-` there sends the files to the wrong place. The pages use relative paths, so `out/` can be published as it is. The fonts are the same for every document, so a site with several can also serve one copy of them.

Without `node_modules/`, the build says so and the page loads MathJax 4.1.3 from jsDelivr. MathJax then typesets the math as it scrolls into view, so a long document is ready in under a second. Its speech and braille output are off (they took most of the time); screen readers get MathML, and a reader can turn speech on in MathJax's menu. Such a page needs JavaScript and the network, and a saved copy loses the math that wasn't typeset yet.

MathJax loads the extensions for the packages the document uses that it has: physics, braket, cancel, mhchem and so on. Others load when a macro needs them.

## On the page

- Each heading and each theorem has a `#` link to it in the margin, shown on hover.
- `\WebPDF{path}` in your config links the document's PDF after the title. `path` is relative to the document's directory, as in `\WebPDF{build/pdf/document.pdf}`; build the PDF first.
- Link previews get the title, and the abstract as the description, if the document has one.

## Your own config

For macros or styles of your own, copy `tex8web.cfg` and add to it after `\input{tex8web-core.tex}`:

```latex
\Preamble{xhtml,mathjax}
\begin{document}
\input{tex8web-core.tex}
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

Pass it with `-c` instead of `tex8web.cfg`. `\WebMathMacros` definitions take precedence over the document's own. Later `\Css` rules override earlier ones, so you can also change the layout choices below.

## Deliberate differences from the PDF

- The text is 12pt, larger than most PDFs, and everything else is sized in proportion.
- The column is as wide as the PDF's in ems.
- Paragraphs are separated by space instead of indented.
- Display math that doesn't fit scrolls sideways.
- Dark mode has its own palette, and pictures are inverted in it.

## Layout

| Path | Contents |
| --- | --- |
| `tex8web.cfg` | entry point for documents without a config of their own |
| `tex/tex8web-core.tex` | loads the three modules below |
| `tex/tex8web-math.tex` | MathJax's configuration, `\WebMathMacros`, equation numbers, `\intertext`, TikZ pictures in display math |
| `tex/tex8web-text.tex` | links, cross-references, theorems, table of contents, lists, figures |
| `tex/tex8web-page.tex` | `<head>`, colors, fonts, layout |
| `tex8web.mk4` | build file: search paths, fonts, images and the PDF, the HTML passes, prerendering |
| `lua/web/macros.lua` | the macro bridge |
| `lua/web/source.lua`, `text.lua` | HTML passes: formula sources, theorem spacing, no-break spaces |
| `lua/web/page.lua` | HTML pass: links to headings and theorems, the PDF link, meta tags |
| `lua/web/dom.lua` | the few DOM operations LuaXML lacks |
| `js/web.js` | MathJax's sizes set as TeX's |
| `prerender.mjs`, `package.json` | MathJax in Node, at the version the browser loads |
| `fonts/` | Latin Modern, as WOFF2 |
| `test.tex`, `test-generic.tex`, `TESTING.md` | the diagnostic documents and how to use them |

Known limitations are listed at the end of TESTING.md.
