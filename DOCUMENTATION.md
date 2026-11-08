# tex8web documentation

For how tex8web works and how it is tested, see [CONTRIBUTING.md](CONTRIBUTING.md).

1. [Building a page](#building-a-page)
2. [Your own config](#your-own-config)
3. [On the page](#on-the-page)
4. [Differences from the PDF](#differences-from-the-pdf)
5. [Checking your documents after an upgrade](#checking-your-documents-after-an-upgrade)
6. [Known limitations](#known-limitations)

## Building a page

```sh
path/to/tex8web/bin/tex8web document.tex
```

tex8web writes the page to `build/html/document.html`, next to your document. The working files and logs of tex4ht are in `build/tex4ht/`. Look there when a build fails. To run tex8web as `tex8web` from any directory, run `npm link` in the tex8web directory, or add its `bin/` directory to your `PATH`.

The options:

- **`-c config`**: Build the page with `config` instead of `tex8web.cfg`. See [Your own config](#your-own-config).
- **`-d out`**: Write the page to `out/` instead of `build/html/`. The path is relative to the directory you run tex8web from.
- **`-B aux`**: Write the working files of tex4ht to `aux/` instead of `build/tex4ht/`. The path is relative to your document. Keep `-` out of the path. See [Known limitations](#known-limitations).
- **`-p pdf`**: Add a PDF button that links to the PDF of your document, and copy the PDF next to the page. The path is relative to the directory you run tex8web from. Build the PDF first, for example with `latexmk -pdf -outdir=build/pdf document.tex`. With both `-p` and `\WebPDF`, the page links to the PDF given with `-p`.
- **`-u url`**: Add an up button that links to the page above this one on your site, such as a list of your documents. The URL is relative to the page, for example `../index.html`. With both `-u` and `\WebUp`, the up button links to the URL given with `-u`.
- **`-m draft`**: Run LaTeX once, and skip the bibliography and the index. A draft build is quicker, but references and citations can show as ??. The first draft build of a document has no title, so the browser tab, the link preview, and the link to the top of the table of contents are empty. Later builds have the title.
- **`--version`**: Print the version of tex8web. In a git clone, the commit is printed too, for example `tex8web 0.1.0 (a1b2c3d)`, with `-dirty` after the commit when there are uncommitted changes.
- Any other option is passed to make4ht. Put your document last.

The output directory contains the page and every file loaded by the page:

- `document.html` and its stylesheets
- the pictures, and the PDF if you link it with `-p` or `\WebPDF`
- `fonts/`, with Latin Modern, TeX Gyre or XCharter, the MathJax fonts, and `LICENSE.txt` with their licenses
- `tex8web-head.js` and `tex8web-page.js`, for the controls
- in a page built [without Node](#without-node), `tex8web.js` in place of the MathJax fonts

All paths in the page are relative, so you can publish the output directory as it is. With Node, the fonts contain only the characters your document uses, so give each document a separate output directory. The page is named `document.html`, not `index.html`, so link to it by name. On GitHub Pages, for example, the address is `https://you.github.io/repo/document.html`.

### Bibliographies and indexes

tex8web runs bibtex or biber when your document has a bibliography. tex8web runs makeindex for each index of makeidx or imakeidx in the document. For each index, makeindex is run with the style file given in the options of its `\makeindex`. Style files are looked up next to your document and in the directories on `INDEXSTYLE`.

### Without Node

tex8web typesets the math with Node when you build the page. In three cases, tex8web warns and builds the page without Node:

- `npm ci` has not been run in the tex8web directory
- `node_modules` has a different MathJax version from the one in `package.json`
- typesetting the math with Node fails

In a page built without Node, MathJax is loaded from jsDelivr, and the math is typeset in the browser. Readers then need a network connection to see the math. The fonts of the page are not cut down to the characters your document uses. To build without Node on purpose, set `TEX8WEB_NO_PRERENDER` to any value.

### Without the wrapper

To build without `bin/tex8web`, run this command in the directory of your document:

```sh
make4ht -u -c path/to/tex8web/tex8web.cfg -e path/to/tex8web/tex8web.mk4 -B build/tex4ht -d build/html document.tex
```

Pass both files every time. Without `-e path/to/tex8web/tex8web.mk4`, the files loaded by `tex8web.cfg` are not found, and the build fails with the error "tex8web-core.tex not found". To link the PDF, set `TEX8WEB_PDF` to its path, absolute or relative to your document. To link up to a page, set `TEX8WEB_UP` to its URL.

### Platform

tex8web runs Node, bibtex, and makeindex through a POSIX shell. tex8web works on macOS and Linux, and not on Windows.

## Your own config

Most documents need no config. tex8web reads the macros, colors, theorem styles, and lists of a document. tex8web also reads the settings of these packages:

- titlesec, for headings
- tocloft, for the table of contents
- tcolorbox and mdframed, for boxes
- float, for its `ruled` style, as used by algorithm
- algorithm2e, for algorithms

A config is a copy of `tex8web.cfg` with your additions after `\input{tex8web-core.tex}`. Pass it with `-c`. For worked examples, see `examples/custom/custom.cfg` and `examples/complex/complex.cfg`.

```latex
\Preamble{xhtml,mathjax}
\begin{document}
\input{tex8web-core.tex}

% a macro that tex8web cannot translate for MathJax (here, one that uses
% \scalebox)
\WebMathMacros{
    \newcommand{\bigtimes}{\mathop{\Large\times}}
}

% the highlighter of soul, \hl{...}, as a span with a color for light mode
% and a color for dark mode: var(--highlight)
\renewcommand{\hl}[1]{\HCode{<span class="highlight">}#1\HCode{</span>}}
\definecolor{highlight-dark}{RGB}{90, 80, 30}
\WebColor{highlight}{yellow!20}{highlight-dark}
\Css{.highlight { background-color: var(--highlight); }}

% the terms marked with \term{...}, for the search field
\WebTerm\term

% a PDF button (build the PDF first)
\WebPDF{build/pdf/document.pdf}

\EndPreamble
```

| Command | Use it when |
| --- | --- |
| `\WebMathMacros{definitions}` | tex8web warns of "macro(s) left undefined for MathJax" or "macro(s) MathJax doesn't know", or math is shown in red |
| `\WebColor{name}{light}{dark}` | you add HTML or CSS in your config, and the HTML or CSS needs one color in light mode and another in dark mode |
| `\WebTerm\cs` | you mark the terms defined in your document with a one-argument command, and you want readers to find these terms with the search field |
| `\WebPDF{path}` | you want a PDF button without passing `-p` |
| `\WebUp{url}` | you want an up button without passing `-u` |
| `\WebLikePDF` | you want the text set as in the PDF: its size and line spacing, indented paragraphs, and justified text |
| `\Css{...}` | you want to add a style, or change a style of tex8web |

The commands:

- **`\WebMathMacros{definitions}`**: Define macros for MathJax. Write the definitions in the TeX of MathJax. These definitions replace the definitions of the same macros in your document. Use `\WebMathMacros` for these macros:
  - the macros named in the warning, such as macros built with `\mathpalette`, `\scalebox`, or internal `@` macros
  - xparse commands with argument types other than `m` and a leading `O{}`
  - macros that tex8web does not find. tex8web collects definitions from your document, from the local packages loaded in it, and from the files loaded in these with `\input` or `\include`. A file loaded with `\input` or `\include` is read only when its path is relative to the directory of your document. Macros defined in loops or by other macros are not found.
- **`\WebColor{name}{light}{dark}`**: Define the CSS variable `--name`, with the color `light` in light mode and the color `dark` in dark mode.
- **`\WebTerm\cs`**: Make the text of each `\cs{...}` a term that readers can find with the search field. A term inside a heading or inside the note of a theorem is found as that heading or theorem. Pass each command to `\WebTerm` once. To link to a term, use its id: `term-`, then the text of the term in lower case, with a hyphen for each run of spaces or punctuation, and without its math. For example, the id of `\term{Convex set}` is `term-convex-set`. Terms with the same text have `-2`, `-3`, and so on added to their ids.
- **`\WebLikePDF`**: Set the text as in the PDF instead of with the [reading defaults](#reading-defaults). The text has the size of the PDF text, and the width of the column scales with the text size. Lines are spaced as in TeX. Paragraphs are indented as in the PDF, with the same space between them, usually none. On a wide screen, the text is justified and hyphenated. The text stays ragged right on a narrow screen, because justified text would have wide gaps next to formulas that cannot break.
- **`\WebPDF{path}`**: Add a PDF button, as with [`-p`](#building-a-page). The path is relative to your document.
- **`\WebUp{url}`**: Add an up button, as with [`-u`](#building-a-page).
- **`\Css{...}`**: Add a CSS style after the styles of tex8web. Inside `\Css`, write `#` as `\#` and `%` as `\%`. The styles of tex8web are in `css/tex8web.css`.

The measurements of your document are CSS custom properties. Set them again with `\Css` to change them:

| Property | What it sets |
| --- | --- |
| `--tex8web-textwidth` | the width of the text column |
| `--tex8web-margin`, `--tex8web-gap` | the width of the side columns, and the gap on each side of them, in `em` or `rem` |
| `--tex8web-title-size`, `--tex8web-section-size`, … `--tex8web-subparagraph-size` | the heading sizes. With chapters, also `--tex8web-part-size` and `--tex8web-chapter-size` |
| `--tex8web-<heading>-labelsep` | the space after the number of a heading |
| `--tex8web-<heading>-family`, `-weight`, `-style`, `-variant`, `-align` | the font and alignment of a heading, with titlesec |
| `--tex8web-<heading>-before`, `-after` | the space above and below a heading, from titlesec or the class |
| `--tex8web-list-sep`, `--tex8web-item-sep`, `--tex8web-leftmargin` | the spacing and indent of a description list. Other lists have `--tex8web-list-*` properties on their element |
| `--tex8web-bibitem-sep`, `--tex8web-biblabelsep` | the space between bibliography entries, and after their labels |
| `--tex8web-footnote-leading`, `--tex8web-abstract-leading` | the line spacing of footnotes and of the abstract, as a multiple of the line spacing of the text |
| `--tex8web-abstract-left`, `--tex8web-abstract-right` | the margins of the abstract |
| `--tex8web-framed-sep` | the space above and below a box of the framed package |
| `--tex8web-toc-<level>-indent`, `--tex8web-toc-<level>-number` | the indent and the number width of each level in the table of contents |
| `--tex8web-toc-<level>-family`, `-weight`, `-style`, `-variant`, `-size` | the font of each level in the table of contents, with tocloft. The size is a multiple of the text size |
| `--tex8web-bg`, `--tex8web-text`, `--tex8web-link`, `--tex8web-cite`, `--tex8web-url` | the colors of the page |
| `--tex8web-roman`, `--tex8web-sans`, `--tex8web-mono` | the roman, sans-serif, and typewriter fonts |
| `--tcb-*` | the frame, colors, and spacing of a tcolorbox, on the element of the box |
| `--tex8web-mdf-rules`, `-padding`, `-margin` | the lines of an mdframed box, and the space inside and around the box, on the element of the box |
| `--tex8web-float-rule`, `-midrule`, `-endrule`, `-sep`, `-bodysep` | the rules of a ruled float (float with the `ruled` style, as used by algorithm), and their space from the caption and from the body. An algorithm2e algorithm has these properties on its element |
| `--tex8web-a2e-*` | the margins, indents, and lines of an algorithm2e algorithm, on its element |

Inside `\Css`, use `@media (--tex8web-wide)` for a wide screen, and `@media not (--tex8web-wide)` for a narrow screen.

## On the page

A screen is wide when the text column fits on it with a side column and its gaps on each side. Otherwise the screen is narrow. To change the widths, set `--tex8web-textwidth`, `--tex8web-margin`, and `--tex8web-gap` with [`\Css`](#your-own-config).

### Controls

The controls are small buttons at the top left of the page, in this order:

1. the up button, with `-u` or `\WebUp`
2. the table of contents button
3. the PDF button, with `-p` or `\WebPDF`
4. the theme button
5. a link to tex8web

On a narrow screen, the controls are in a bar across the top of the page. The name of the section being read is shown in the bar. Clicking the name opens the table of contents. The bar is hidden while the reader scrolls down and shown again when the reader scrolls up. Once the page is scrolled away from its top, a line is drawn under the bar.

### Between pages

When readers come to a page from the page above, clicking the up button returns them to their place on the page above.

When a reader follows a link from one tex8web page to another on the same origin (the same scheme, host, and port), the old page moves a little to the left and fades out as the new page fades in. The pages move to the right when the reader goes up or back. In browsers without support for this transition, the new page fades in or appears at once. The new page also appears at once for readers who turn on reduced motion.

To fade between the other pages of your site too, add `@view-transition { navigation: auto; }` to their CSS.

### Theme

The page uses the system setting for light or dark mode until the reader picks a theme with the theme button. This choice is saved in the browser for every tex8web page on the same origin. To set a default for your site, put `data-theme="light"` or `data-theme="dark"` on the `<html>` element.

In light mode, colors are as in the PDF. In dark mode, dark text becomes light and light backgrounds become dark, with the same hues. Colored links keep their hue but are lighter and less saturated. TikZ pictures are inverted.

### Table of contents

`\tableofcontents` is moved out of the text. On a wide screen, the table of contents is in a column beside the text. Readers can hide or show this column with the table of contents button. This choice is saved in the browser for every tex8web page on the same origin. On a narrow screen, the table of contents is in a drawer, opened with the table of contents button.

The entry of the section being read is marked. The sections, and the levels above them, are always listed. When all entries fit in the column or the drawer without scrolling, every entry is listed. Otherwise, subsections are listed only for the section being read and for the sections the reader opens. Readers then show or hide the subsections of a section with the chevron after it. Subsections opened with a chevron stay open until the reader closes them. With a mouse, a chevron is shown faintly while the pointer is over its section or while the section is open, and clearly while the pointer is over the chevron. Every chevron is shown faintly on a touch screen.

The indents, number widths, and fonts of the entries are as set by tocloft or by the class. With tocloft, each level is in the font of its `\cft<level>font` command, such as `\cftsecfont`. A color in `\cft<level>font` is not applied. A `\listoffigures` or a `\listoftables` stays in the text.

### Search field

As the reader types in the search field at the top of the table of contents, the matching headings, numbered theorems and boxes, and terms marked with [`\WebTerm`](#your-own-config) are listed. Case, accents, and math styles are ignored. A Greek letter is found by its TeX name, for example σ by `sigma`. Readers choose a result with the arrow keys and go to it with Enter.

### Fonts

The text is in the font of the PDF when the font is one of these:

- Latin Modern (the LaTeX default)
- Charter
- the standard PostScript fonts: Times, Palatino, Helvetica, Courier, Bookman, New Century Schoolbook, and Avant Garde

These fonts come from packages such as `mathptmx`, `txfonts`, `newtxtext`, `mathpazo`, `pxfonts`, `newpxtext`, `helvet`, `charter`, `XCharter`, and the TeX Gyre packages. The standard PostScript fonts are shown in their TeX Gyre versions, and Charter in XCharter. tex8web copies the TeX Gyre and XCharter fonts from your TeX Live installation.

A font chosen in the text, for example with `\fontfamily{bch}`, is shown in the same way. Other fonts are shown in Latin Modern. If the text of your document is in its sans-serif font, set with `\familydefault`, the page is in a sans-serif font too.

The math is in the MathJax TeX font, which looks like Computer Modern. If the math in the PDF is in Times, Palatino, or New Century Schoolbook, the math on the page is in the matching MathJax TeX Gyre font: Termes, Pagella, or Schola. The matching font is used with `mathptmx`, `newtxmath`, `txfonts`, `mathpazo`, `newpxmath`, `pxfonts`, or `fouriernc`. With an option of `newtxmath` for another font, the math stays in the TeX font. The exception is `nc`, which is New Century Schoolbook.

### Headings

Headings have the same sizes, the same space above and below, and the same space after their numbers as in the PDF. If `\maketitle` is defined in your document or its class, the title has the font and size set there, and `--tex8web-title-size` is not used. With titlesec, each heading has the font, alignment, and label of its `\titleformat`, and the spacing of its `\titlespacing`.

### Lists

List labels are as in the PDF, and so are the indent and spacing of each list.

### `\hfill`

After `\hfill` in a paragraph or a heading, the rest of the line is at the right, as in the PDF. If the rest does not fit on the line, it is at the right of the next line.

### Footnotes

On a wide screen, a footnote is beside the paragraph, list, or theorem that has its mark. The footnote is below that paragraph, list, or theorem on a narrow screen. A footnote in a table, figure, box, or formula is at the end of the page.

### Preview cards

When a reader points at a reference, a citation, a footnote mark, or a link to a section, its target is shown in a card. The card is also shown when the link has keyboard focus. On a touch screen, the card is shown on the first tap, and the link is followed on the second tap.

### Opening a picture

Readers can click a picture in a figure or in display math, or any picture much taller than a line, to open it over the page. Clicking a picture that is a link follows the link instead. In the opened picture, readers zoom with the mouse wheel, a pinch, or a double-click, and move the picture by dragging. Readers close the picture with Escape or a click beside it. Readers can also reach a picture with Tab and open it with Enter or Space. When the picture is closed, the focus returns to the picture.

### Links to headings

Headings and numbered theorems have a `#` link in the margin, shown when the pointer is over them. A tcolorbox with a title and a number or a label has one too. On a narrow screen, the heading or the head of the theorem is the link.

### Printing

A printed page contains the document alone, in the colors of light mode, without the controls or the table of contents. Footnotes are printed after their paragraphs. For a printed copy, the PDF is better, because its page breaks and page numbers are those of TeX.

### Without JavaScript

With JavaScript off, the page is still readable. Every entry of the table of contents is shown, and the theme is the system setting.

### Screen readers

Each formula has a spoken English text from MathJax for screen readers, for example "the fraction with numerator 1 and denominator 1 minus gamma". In a page built [without Node](#without-node), screen readers are given MathML instead. The alt text of a picture is the `alt` key of graphicx, or empty.

### Shared links

When a link to the page is shared in a chat app or on a social site, the link preview has the title of the document, and its abstract if there is one.

## Differences from the PDF

### Reading defaults

By default, the text is set for reading on a screen. To set the text as in the PDF instead, use [`\WebLikePDF`](#your-own-config) in your config.

- The text is 12pt, larger than in most PDFs, and everything else is scaled with it. The column has the width of the PDF column, in ems.
- The line spacing is the browser default, a little looser than in TeX.
- Paragraphs are separated by space instead of indented.
- The text is ragged right and not hyphenated.

### Choices for the web

These differences cannot be turned off.

- The table of contents and the footnotes are beside the text on a wide screen. See [On the page](#on-the-page).
- Without the `colorlinks` option of hyperref, a link is in the text color with a faint underline. The PDF has a box around each link. Links are unmarked with `hidelinks`, as in the PDF.
- A picture given a `width` and a `height` without `keepaspectratio` is shown with its original proportions. In the PDF, the picture is stretched.
- Dark mode has separate background, text, and link colors.

### Screen width and page numbers

- A picture is at its PDF size on a narrower screen, until the column is narrower than the picture. Then the picture is scaled down to the width of the column.
- Minipages and subfigures that share a line in the PDF are side by side at their PDF widths. On a narrow screen, they wrap.
- Display math wider than the column scrolls sideways. On a narrow screen, wide tables and verbatim blocks scroll sideways too. Each of these blocks fades out at an edge where more of the block is hidden, when JavaScript is on.
- The table of contents has no page numbers or dot leaders.
- An index is in one column. Each entry has numbers in place of page numbers. The numbers are a count of the `\index` commands, in order, and each number links to its `\index`.

## Checking your documents after an upgrade

A new version of tex8web can change how your pages look. To check, build your documents and accept the pages before the upgrade, then build them again after the upgrade. Run the command from the directory that contains your documents, so that the builds and the baselines are stored there and not in the tex8web directory:

```sh
cd ~/papers
npm --prefix path/to/tex8web run regress -- --accept thesis talk/talk.tex   # before
npm --prefix path/to/tex8web run regress -- thesis talk/talk.tex            # after
```

Each argument is a document directory or a `.tex` file. A directory means its `main.tex`, or its only `.tex` file. Documents are named after their directories, so two documents in directories with the same name cannot be checked together.

The documents are built in parallel. Each page is checked for the same problems as in `npm test`, and compared with its baseline. One line is printed for each document:

- `unchanged`: the page is the same as its baseline.
- `changed: <files>`: the HTML or other files differ, but every screen looks the same.
- `looks different: <screens>`: the screens listed differ in a browser.
- `no baseline to compare with`: no page has been accepted for this document yet.
- `failed to build`, or `problem:` lines under the line of the document: see the log in `logs/<name>.html.log`.

The exit code is 0 when no page looks different, 3 when a page looks different, 1 when a build or a check failed, and 2 for a mistake in the command. For a page that looks different, the first differing screens for each width and color scheme are saved, old and new, in `compare/<name>`. Look at them before you accept.

The options:

- **`-c config`**: Build every document with `config`.
- **`--accept`**: Make the pages of this run the baselines. Screens are not compared, because you look at them before you accept. A page with changes is reported as `changed`. Nothing is accepted when any document failed. `--accept` cannot be used with `--draft`.
- **`--baseline dir`**: Compare with the pages in `dir/<name>` instead, for example the `html` directory of another tex8web checkout.
- **`--out dir`**: Write everything to `dir`. The default is `build/regress` in the directory you run the command from. `dir` contains `html/<name>` for the pages, `compare/<name>`, `logs/`, `tex4ht/`, and `accepted/<name>`. Keep `-` and the characters `^ $ ( ) % [ ] * + ?` out of the path. See [Known limitations](#known-limitations).
- **`--draft`**: Build in draft mode, as with `-m draft`. Draft builds are quicker, but their pages are not reliable.
- **`--shots-cache dir`**: Cache the screenshots of the baselines in `dir`, so that the screenshots of each baseline are taken once for all runs that use `dir`. The default is `shots-cache` in the `--out` directory.
- **`--latexmk`**: Build the PDF of each document first, with `latexmk` in the directory of the document. A document whose PDF fails to build is not built.

Without `--latexmk`, no PDFs are built. If a PDF is linked with `\WebPDF` in your config and the PDF is missing, the page is built without a PDF button. A document is built again only when one of its inputs has changed: tex8web, the directory of the document, the config, the linked PDF, or the build tools.

## Known limitations

Smaller differences in the math are listed in [CONTRIBUTING.md](CONTRIBUTING.md#small-known-differences).

### Building

- **A space in the path of tex8web or of a config.** A config path with a space does not work with tex4ht, so tex8web stops with an error. Move tex8web or the config to a path without spaces.
- **`-B` with a `-` in its path.** The `-B` directory is used as a Lua pattern by make4ht, so with a `-` anywhere in the path, files are written to the wrong place. The characters `^ $ ( ) % [ ] * + ?` have the same effect. Keep them out of the path, and keep the path relative to your document, as the default `build/tex4ht` is.
- **One page per document.** A document is split into several pages by a number such as `2` in the options of `\Preamble`, by `splitat=`, or by `\CutAt` in a config. With any of these, tex8web stops with an error. Remove the option.
- **Document classes not supported by tex4ht**, such as Tufte-LaTeX. Configure the class for tex4ht in your config.
- **The `program` option of imakeidx** is ignored: makeindex is always run. The `splitindex` option is not supported.

### Math

- **Macros that tex8web cannot translate for MathJax** are shown in red, and tex8web lists them in a warning. Among them are macros with arguments in a custom format, such as comma-separated lists. Define a version for MathJax with [`\WebMathMacros`](#your-own-config).
- **Colors in math.** A color defined inside a group is not passed to MathJax. The color models `hsb`, `Hsb`, `tHsb`, and `wave` are not supported. A color redefined later in the document has its last value everywhere in math.
- **The QED box** of an amsthm proof is at the right, as in the PDF. After `\qedhere` in a display, the box is in the tag of the display. The box is below the display instead when the display has a `\tag`, and in `$$ $$` and `displaymath`. In `multline`, the box is under the equation number, not at the end of the last line. A `\qedsymbol` that cannot be typeset by MathJax as math or text, such as `\ensuremath{...}`, is shown in red in a display.
- **siunitx in math.** Numbers, units, quantities, and angles of siunitx are set as in the PDF, in text and in math. The other siunitx commands are shown in red in math, for example `$\numrange{1}{5}$`, `\qtyproduct`, and `\complexnum`. In text, these commands have the default output of tex4ht.
- **A TikZ picture in display math**, such as a `tikzcd` diagram, is drawn as a picture together with the rest of the math in that display.
- **Styles for `.mathjax-inline`** in a config apply only to a page built without Node.

### Text and layout

- **`\hfill`.** With several `\hfill` on a line, only the text after the last one is at the right. The parts before it stay together at the left. When the text after `\hfill` is longer than a line, it starts at the left of the next line. The text fills the rest of the line first in the PDF. In a centered paragraph with an `\hfill` inside a link or a color, the other lines of the paragraph are at the left too.
- **Minipages.** A paragraph with a minipage inside its text is broken around the minipage. `\centering` in a minipage applies only in a figure. Two minipages, each inside an `\fbox`, are one above the other instead of side by side.
- **Colors in text.** `\color` for the whole document, in the preamble or in `\AtBeginDocument`, is ignored. Inside a colored group, the text color is not restored by `\normalcolor`.
- **Chapters and parts.** The label of a chapter, such as "Chapter 1", is the default label of tex4ht. Part and chapter headings have the sizes of the report and book classes, whatever the class, unless they are formatted with titlesec.

### Packages

- **tcolorbox.** Boxes have their colors, rules, corners, shadow, spacing, and title. Anything drawn with TikZ in a skin, such as overlays and shadings, is shown as a plain frame. Pictures in side-by-side listing boxes are not converted. If the build fails on a fragile command in the title of a box, make the command robust with `\robustify` in your config.
- **enumitem.** `align=left`, `wide`, and `itemindent` are ignored. Labels are right-aligned and hang into the margin, as in the standard lists of LaTeX.
- **Table colors.** With colortbl and without xcolor, `\textcolor` with colors defined in your document has no effect, because xcolor is loaded by tex4ht after these colors are defined. Load xcolor yourself, before you define the colors. In a table with `\hline`, the row colors of `\rowcolors` alternate wrongly.
- **algorithm2e.** The `ruled` and `algoruled` styles have their rules, and every style has its caption in its place. `boxed`, `boxruled`, `tworuled`, and `plainruled` have no frame or rules. Block markers (`\AlgoDisplayBlockMarkers`) are not shown. A line wraps at the width of the window, not the width in the PDF, so a `\tcp*` comment can move to the next line.
- **float styles.** Only `ruled` is drawn. A `boxed` float has no frame, and the caption of a `plaintop` float stays where `\caption` is.
- **mdframed.** A box has its middle line (`linewidth`), its colors, and its space inside and around it. Inner and outer lines, rounded corners, shadows, and anything drawn with TikZ or PSTricks are missing. A `frametitle` is inside the padding of the box, without a separate title bar.
- **`\FrameSep` of framed.** A framed box has no padding between its rule and its text.
- **tocloft fonts for lists of figures and tables.** `\cftfigfont` and `\cfttabfont` are ignored. These lists are in the text font.

### Pictures

- **A picture without its `.xbb` file.** The size of a bitmap or PDF picture is taken from a `.xbb` file next to it. Without this file, a picture sized with `scale` or `height`, or with `width`, `height`, and `keepaspectratio`, is not at its PDF size. Make the file with `extractbb -x picture.png`.
- **A size after `angle`**, as in `[angle=90,width=5cm]`, and **`scale` with `width` or `height`** are ignored. The picture is at its natural size. Put the size before `angle`, or leave out `scale`.
- **`trim` and `viewport`.** The whole picture is shown, at the width of the part that is kept.

### Reading in a browser

- **The controls are in English**, whatever the language of the document. So is the speech for math. In the speech, `|` is "given", as in `P(A | B)`, so `a | b` in a document about divisibility is spoken as "a given b".
- **Find in page.** Readers can find single characters of a formula with the find-in-page command of the browser, but not a run of characters such as `Δ(S)`.
- **A page opened from disk, or read with JavaScript off.** Fonts are not preloaded. On a phone, the layout of a long page can take a moment longer to settle.
- **Safari after a swipe back.** After a reader swipes back to a page in Safari, the pages no longer slide when the reader returns to that page from history, with the up button or the back button. The reader still returns to the same place on the page.
