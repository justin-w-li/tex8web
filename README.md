# tex8web

tex8web turns a LaTeX document into a web page that looks like its PDF. tex8web uses [make4ht](https://ctan.org/pkg/make4ht) and tex4ht, which come with TeX Live. Most documents need no config. The math is typeset with MathJax when you build, so the page is plain HTML and CSS. The page can be read offline and without JavaScript.

Four example pages are [online](https://justin-w-li.github.io/tex8web/), each next to its PDF.

![A class-notes PDF on the left, and the same notes as a tex8web page on the right](.github/screenshot.png)

## On the page

- Fonts, headings, theorems, lists, and boxes are as in the PDF.
- The text is set for a screen: larger, ragged right, and with space between paragraphs. With [`\WebLikePDF`](DOCUMENTATION.md#your-own-config) in a config, the text is set as in the PDF.
- The table of contents is beside the text, with the current section marked and a search field.
- Footnotes are beside their paragraphs.
- Readers can point at a reference to see a preview of its target.
- The page has light and dark themes, and a layout for phones.
- Printed pages have no controls and no table of contents.
- Screen readers are given each formula in spoken English.

## Compared with other tools

With plain make4ht, the page has the default style of tex4ht. Its fonts and layout differ from the PDF.

With pandoc, LaTeX can be converted to many formats, such as HTML, EPUB, and Word. The LaTeX is parsed by pandoc, not by TeX. Commands and packages without support in pandoc are lost.

LaTeXML is a reimplementation of TeX in Perl. Each package needs a binding written for LaTeXML, and many common packages have one. The output is HTML with MathML. arXiv uses LaTeXML for the HTML versions of its papers.

lwarp is a LaTeX package, so the HTML is written by real LaTeX. You load lwarp in the preamble of your document. Many packages are replaced with HTML versions in lwarp, and some packages are not supported. The math is shown as SVG pictures, or with MathJax in the browser.

tex8web also runs real TeX, through tex4ht, so your document needs no changes. Package support is the same as in tex4ht. The page is then styled from TeX's measurements of the document.

## Install

You need TeX Live with make4ht, and Node 22 or later. tex8web is tested with TeX Live 2026 on macOS and Linux.

```sh
git clone https://github.com/justin-w-li/tex8web.git
cd tex8web
npm ci
```

To check the version you have, run `bin/tex8web --version`.

Node is used only when you build: to typeset the math, and to cut the fonts down to the characters your document uses. Without Node, MathJax is loaded from the network when the page is opened. See [Without Node](DOCUMENTATION.md#without-node).

## Use

```sh
path/to/tex8web/bin/tex8web document.tex
```

The page and its files are written to `build/html/` next to your document. Publish the directory as it is.

To link the page to your PDF, build the PDF first, and pass its path with [`-p`](DOCUMENTATION.md#building-a-page). If the build ends with a warning about macros left undefined for MathJax, write a short config. With a config, you can also change the style of the page. See [Your own config](DOCUMENTATION.md#your-own-config).

## Examples

The four documents in [`examples/`](examples) are from the Overleaf gallery. Each is under CC BY 4.0, and its source is named at the top of the file.

- `basic`: a short article with a figure, a table, and a bibliography
- `footnotes`: a law review article with many footnotes
- `custom`: class notes with custom colors and boxes, and a config
- `complex`: a long, heavily customized document, with examples of the known limitations of tex8web

Run `npm run examples` to build each example and its PDF into `examples/<name>/build/`. The site with links to them is built into `build/site/`.

## Documentation

- [DOCUMENTATION.md](DOCUMENTATION.md): building a page, writing a config, what is on the page, and known limitations
- [CONTRIBUTING.md](CONTRIBUTING.md): how tex8web works, and how it is tested and released

## License

tex8web is under the MIT License: see [LICENSE](LICENSE). The fonts in `fonts/` are under the GUST Font License: see `fonts/LICENSE.txt`. A copy of `fonts/LICENSE.txt` is in the output directory of every page.
