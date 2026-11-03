# tex8web

tex8web turns a LaTeX document into a web page that looks like its PDF. It is a configuration for [make4ht](https://ctan.org/pkg/make4ht) (tex4ht). tex4ht writes the text; MathJax typesets the math from its LaTeX source, at build time. The page is plain HTML and CSS, with no JavaScript. It works offline and saved, gives screen readers the math as MathML, and follows the reader's light or dark mode.

## Install

You need TeX Live with make4ht (tested with TeX Live 2026). Node.js (tested with Node 26) is optional; with it, the math is typeset at build time.

```sh
git clone <this repository> tex8web
cd tex8web
npm ci
```

Without Node, the page loads MathJax in the browser instead.

## Use

```sh
make4ht -c path/to/tex8web/tex8web.cfg -e path/to/tex8web/tex8web.mk4 -B build -d out document.tex
```

`out/` gets `document.html` with its stylesheets, fonts and pictures, ready to publish. tex4ht's working files stay in `build/`.

## Examples

[`examples/`](examples) has four documents from the Overleaf gallery:

- a basic article;
- a blog-like essay;
- class notes with their own colors and boxes;
- a long, heavily customized document.

`npm run examples` builds them into `examples/<name>/build/html`.

## Documentation

[DOCUMENTATION.md](DOCUMENTATION.md) covers:

- how tex8web works;
- configuring your own macros, colors, styles and PDF link;
- what differs from the PDF;
- known limitations;
- testing.

## License

MIT (see [LICENSE](LICENSE)). The fonts in `fonts/` are under the GUST Font License, and each example under its own license, named at its top.
