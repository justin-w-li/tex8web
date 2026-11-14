# tex8web

tex8web turns a LaTeX document into a web page that looks like its PDF, with [make4ht](https://ctan.org/pkg/make4ht) and tex4ht from TeX Live. tex8web typesets the math with MathJax when you build, so the page is plain HTML and CSS, readable offline and without JavaScript.

Four example pages are [online](https://justin-w-li.github.io/tex8web/), each next to its PDF.

![A class-notes PDF on the left, and the same notes as a tex8web page on the right](.github/screenshot.png)

## On the page

- Fonts, headings, theorems, lists, and boxes as in the PDF
- Text set for a screen: larger, ragged right, and with space between paragraphs, or as in the PDF with [`\WebLikePDF`](DOCUMENTATION.md#your-own-config)
- The table of contents beside the text, with the current section marked and a search field
- Footnotes beside their paragraphs
- A preview of a reference's target when readers point at it
- Light and dark themes, and a layout for phones
- Printed pages without controls or the table of contents
- Each formula in spoken English for screen readers

## Compared with other tools

With plain make4ht, the page has the default tex4ht style, with fonts and a layout unlike the PDF.

With pandoc, LaTeX can be converted to HTML, EPUB, Word, and other formats. The LaTeX is parsed by pandoc, not TeX, so unsupported commands and packages are lost.

LaTeXML is a Perl reimplementation of TeX, used for arXiv's HTML papers. Each package needs a binding, and many common packages have one. The output is HTML with MathML.

lwarp is a LaTeX package, so the HTML is written by real LaTeX. Many packages are supported, but not all. The math is shown as SVG pictures or with MathJax in the browser.

tex8web runs real TeX through tex4ht, so your document needs no changes. The page is styled from TeX's measurements of the document.

## Tested documents

tex8web is tested on about 100 short test documents, the four [examples](#examples), and several long sets of class notes. Other documents and packages have not been checked against their PDF yet.

Two of the examples build without a config. The other two use one: `complex` for macros that MathJax cannot read, and `custom` for its title and header box. The class notes use one for their colors, macros, and styles.

Some differences from the PDF found in the tested documents:

- A document split into several pages is refused: tex8web makes one page per document.
- Text in `\scalebox`, `\resizebox`, or `\reflectbox` is shown at its natural size.
- The parts of a tcolorbox or mdframed box drawn with TikZ are shown as a plain frame.
- Macros that MathJax cannot read are shown in red until you define them with `\WebMathMacros`.

All known differences are listed in [Known limitations](DOCUMENTATION.md#known-limitations).

## Install

You need TeX Live with make4ht, and Node 22 or later. tex8web is tested with TeX Live 2026 on macOS and Linux. PDF and EPS pictures also need Ghostscript (`gs`), which converts them to PNG. MacTeX includes it; TeX Live's own installer does not, except on Windows.

```sh
git clone https://github.com/justin-w-li/tex8web.git
cd tex8web
npm ci
```

To print your version, run `bin/tex8web --version`.

Node is used only when you build, to typeset the math and cut the fonts down to the characters used. Without Node, MathJax is loaded from the network when the page is opened. See [Without Node](DOCUMENTATION.md#without-node).

## Use

```sh
path/to/tex8web/bin/tex8web document.tex
```

tex8web writes the page and its files to `build/html/`, next to your document. Publish this directory as it is.

To link the page to your PDF, build the PDF first and pass its path with [`-p`](DOCUMENTATION.md#building-a-page). Write a short config if tex8web warns of macros left undefined for MathJax, or to change the page style. See [Your own config](DOCUMENTATION.md#your-own-config).

## Examples

The four documents in [`examples/`](examples) are from the Overleaf gallery. Each is under CC BY 4.0, with its source named at the top.

- `basic`: a short article with a figure, a table, and a bibliography
- `footnotes`: a law review article with many footnotes
- `custom`: class notes with custom colors and boxes, and a config
- `complex`: a long, heavily customized document, with examples of tex8web's known limitations

Run `npm run examples` to build each example and its PDF into `examples/<name>/build/`, and the site that links to them into `build/site/`.

## Documentation

- [DOCUMENTATION.md](DOCUMENTATION.md): building a page, writing a config, what is on the page, and known limitations
- [CONTRIBUTING.md](CONTRIBUTING.md): how tex8web works, and how it is tested and released

## License

tex8web is under the [MIT License](LICENSE). The fonts in `fonts/` are under the GUST Font License, in `fonts/LICENSE.txt`, which is copied to the output directory of every page.
