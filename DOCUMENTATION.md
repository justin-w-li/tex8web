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

tex8web writes the page to `build/html/document.html`, next to your document. If a build fails, see tex4ht's working files and logs in `build/tex4ht/`. To run tex8web as `tex8web` from any directory, run `npm link` in the tex8web directory, or add its `bin/` directory to your `PATH`.

The options:

- **`-c config`**: Build with `config` instead of `tex8web.cfg`. See [Your own config](#your-own-config).
- **`-d out`**: Write the page to `out/` instead of `build/html/`. The path is relative to the directory you run tex8web from.
- **`-B aux`**: Write tex4ht's working files to `aux/` instead of `build/tex4ht/`. The path is relative to your document. Keep `-` out of the path. See [Known limitations](#known-limitations).
- **`-p pdf`**: Add a PDF button that links to `pdf`, and copy `pdf` next to the page. The path is relative to the directory you run tex8web from. Build the PDF first, for example with `latexmk -pdf -outdir=build/pdf document.tex`. With both `-p` and `\WebPDF`, the page links to the PDF given with `-p`.
- **`-u url`**: Add an up button that links to the page above this one on your site, such as a list of your documents. The URL is relative to the page, for example `../index.html`. With both `-u` and `\WebUp`, the up button links to the URL given with `-u`.
- **`-m draft`**: Run LaTeX once, and skip the bibliography and the index. Draft builds are quicker, but references and citations can show as ??. The first draft build has no title, so the browser tab, the link preview, and the link to the top of the table of contents are empty until a later build.
- **`--version`**: Print the tex8web version, and in a git clone the commit, for example `tex8web 0.1.0 (a1b2c3d)`. With uncommitted changes, `-dirty` follows the commit.
- Any other option is passed to make4ht. Put your document last.

The output directory contains:

- `document.html` and its stylesheets
- the pictures, and the PDF if you link it with `-p` or `\WebPDF`
- `fonts/`, with Latin Modern, TeX Gyre or XCharter, the MathJax fonts, and `LICENSE.txt` with their licenses
- `tex8web-head.js` and `tex8web-page.js`, for the controls
- in a page built [without Node](#without-node), `tex8web.js` in place of the MathJax fonts

All paths in the page are relative, so you can publish the output directory as it is. With Node, the fonts contain only the characters your document uses, so give each document a separate output directory. The page is named `document.html`, not `index.html`, so link to it by name, for example `https://you.github.io/repo/document.html` on GitHub Pages.

### Bibliographies and indexes

tex8web runs bibtex or biber when your document has a bibliography. For each makeidx or imakeidx index, tex8web runs makeindex with the style file given in its `\makeindex` options. Style files are looked up next to your document and in the `INDEXSTYLE` directories.

### Without Node

tex8web typesets the math with Node. tex8web warns and builds without Node when:

- `npm ci` has not been run in the tex8web directory
- `node_modules` has a different MathJax version from the one in `package.json`
- typesetting the math with Node fails

In a page built without Node, the math is typeset in the browser with MathJax from jsDelivr, so readers need a network connection to see it. The fonts are not cut down to the characters your document uses. To build without Node on purpose, set `TEX8WEB_NO_PRERENDER` to any value.

### Without the wrapper

To build without `bin/tex8web`, run this command in your document's directory:

```sh
make4ht -u -c path/to/tex8web/tex8web.cfg -e path/to/tex8web/tex8web.mk4 -B build/tex4ht -d build/html document.tex
```

Pass both files every time. Without `-e path/to/tex8web/tex8web.mk4`, the build fails with "tex8web-core.tex not found". To link the PDF, set `TEX8WEB_PDF` to its path, absolute or relative to your document. To link up to a page, set `TEX8WEB_UP` to its URL.

### Platform

tex8web runs Node, bibtex, and makeindex through a POSIX shell, so it works on macOS and Linux, not Windows.

## Your own config

Most documents need no config. tex8web reads a document's macros, colors, theorem styles, and lists, and the settings of these packages:

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

% a macro that tex8web cannot translate for MathJax, here one with \scalebox
\WebMathMacros{
    \newcommand{\bigtimes}{\mathop{\Large\times}}
}

% the \hl{...} of soul as a span, with a color for light mode and a color
% for dark mode: var(--highlight)
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
| `\WebMathMacros{definitions}` | tex8web warns of "macro(s) left undefined for MathJax" or "macro(s) MathJax doesn't know", or math shows in red |
| `\WebColor{name}{light}{dark}` | you add HTML or CSS in your config with different colors in light and dark mode |
| `\WebTerm\cs` | you mark defined terms with a one-argument command, and want readers to find them with the search field |
| `\WebPDF{path}` | you want a PDF button without passing `-p` |
| `\WebUp{url}` | you want an up button without passing `-u` |
| `\WebLikePDF` | you want the text set as in the PDF: its size and line spacing, indented paragraphs, and justified text |
| `\Css{...}` | you want to add a style or change a tex8web style |

The commands:

- **`\WebMathMacros{definitions}`**: Define macros for MathJax, in MathJax's TeX, in place of your document's definitions of the same macros. Use it for:
  - the macros named in the warning, such as macros built with `\mathpalette`, `\scalebox`, or internal `@` macros
  - xparse commands with argument types other than `m` and a leading `O{}`
  - macros that tex8web does not find. tex8web collects definitions from your document, the local packages it loads, and the files these `\input` or `\include` by a path relative to your document's directory. Macros defined in loops or by other macros are not found.
- **`\WebColor{name}{light}{dark}`**: Define the CSS variable `--name` as `light` in light mode and `dark` in dark mode.
- **`\WebTerm\cs`**: Make the text of each `\cs{...}` a term in the search field. A term in a heading or a theorem note is found as that heading or theorem. Pass each command to `\WebTerm` once. A term's id, for links, is `term-` and the term's text in lower case, with a hyphen for each run of spaces or punctuation, and without math: `\term{Convex set}` has the id `term-convex-set`. Terms with the same text have `-2`, `-3`, and so on added to their ids.
- **`\WebLikePDF`**: Set the text as in the PDF instead of with the [reading defaults](#reading-defaults). The text is at the PDF's size when the reader's default font size is 12pt, and scales with that default. The column width scales with the text size. The controls and the table of contents stay at the reader's default font size. Paragraphs are spaced as in the PDF, usually with no space between them. The text is justified and hyphenated only on a wide screen, because formulas that cannot break would leave wide gaps on a narrow screen.
- **`\WebPDF{path}`**: Add a PDF button, as with [`-p`](#building-a-page). The path is relative to your document.
- **`\WebUp{url}`**: Add an up button, as with [`-u`](#building-a-page).
- **`\Css{...}`**: Add a CSS style after the tex8web styles in `css/tex8web.css`. Inside `\Css`, write `#` as `\#` and `%` as `\%`.

Your document's measurements are CSS custom properties. To change them, set them again with `\Css`:

| Property | What it sets |
| --- | --- |
| `--tex8web-textwidth` | the text column width |
| `--tex8web-margin`, `--tex8web-gap` | the side column width, and the gap on each side of a side column, in `em` or `rem` |
| `--tex8web-title-size`, `--tex8web-section-size`, … `--tex8web-subparagraph-size` | the heading sizes. With chapters, also `--tex8web-part-size` and `--tex8web-chapter-size`, and in the article class `--tex8web-part-size`. `--tex8web-part-label-size` and `--tex8web-chapter-label-size` are the label's size, in ems of the title's |
| `--tex8web-<heading>-labelsep` | the space after a heading's number |
| `--tex8web-<heading>-family`, `-weight`, `-style`, `-variant`, `-align` | a heading's font and alignment, from titlesec or the class. With memoir, also `--tex8web-part-label-family`, `--tex8web-chapter-label-family`, and the other `-label-` font properties for the label's font |
| `--tex8web-<heading>-before`, `-after` | the space above and below a heading, from titlesec or the class. For a part or chapter, also `--tex8web-part-label-after` or `--tex8web-chapter-label-after`, the space between label and title |
| `--tex8web-list-sep`, `--tex8web-item-sep`, `--tex8web-leftmargin` | the spacing and indent of a description list. The space after a description's label, and the spacing of other lists, are `--tex8web-list-*` properties on each list's element |
| `--tex8web-intextsep`, `--tex8web-floatsep` | the space around a float, and between two floats in a row |
| `--tex8web-caption-before`, `--tex8web-caption-after` | the space above and below a caption. Each caption also has them on its element, swapped for a caption at the top with the caption package |
| `--tex8web-display-above`, `--tex8web-display-below` | the space above and below display math |
| `--tex8web-bibitem-sep`, `--tex8web-biblabelsep` | the space between bibliography entries, and after their labels, on each bibliography's list element. To change them, set `\bibsep` (natbib), `\bibitemsep`, or `\biblabelsep` (biblatex) in your document, before the bibliography |
| `--tex8web-bibhang`, `--tex8web-bibitemindent` | in place of `--tex8web-biblabelsep`, for an author-year bibliography without labels: the indent of each entry after its first line, and the negative indent of its first line from the later ones. To change them, set `\bibhang` (natbib or biblatex) before the bibliography |
| `--tex8web-footnote-leading`, `--tex8web-abstract-leading` | the line spacing of footnotes and the abstract, as a multiple of the text line spacing |
| `--tex8web-abstract-left`, `--tex8web-abstract-right` | the abstract margins |
| `--tex8web-framed-sep` | the space above and below a box of the framed package |
| `--tex8web-toc-<level>-indent`, `--tex8web-toc-<level>-number` | the indent and number width of each table of contents level |
| `--tex8web-toc-<level>-family`, `-weight`, `-style`, `-variant`, `-size` | the font of each table of contents level, with tocloft. The size is a multiple of the text size |
| `--tex8web-bg`, `--tex8web-text`, `--tex8web-link`, `--tex8web-cite`, `--tex8web-url` | the page colors |
| `--tex8web-roman`, `--tex8web-sans`, `--tex8web-mono` | the roman, sans-serif, and typewriter fonts |
| `--tcb-*` | the frame, colors, and spacing of a tcolorbox, on the box element |
| `--tex8web-mdf-rules`, `-padding`, `-margin` | the lines of an mdframed box, and the space inside and around it, on the box element |
| `--tex8web-float-rule`, `-midrule`, `-endrule`, `-sep`, `-bodysep` | the rules of a float with the `ruled` style, as used by algorithm, and their space from the caption and the body. algorithm2e algorithms have these properties on their element |
| `--tex8web-a2e-*` | the margins, indents, and lines of an algorithm2e algorithm, on its element |

Inside `\Css`, use `@media (--tex8web-wide)` for a wide screen, and `@media not (--tex8web-wide)` for a narrow screen.

## On the page

A screen is wide when the text column fits on it with a side column and its gaps on each side, and narrow otherwise. To change the widths, set `--tex8web-textwidth`, `--tex8web-margin`, and `--tex8web-gap` with [`\Css`](#your-own-config).

### Controls

The controls are small buttons at the top left of the page, in this order:

1. the up button, with `-u` or `\WebUp`
2. the table of contents button
3. the PDF button, with `-p` or `\WebPDF`
4. the theme button
5. a link to tex8web

On a narrow screen, the controls are in a bar across the top, with the name of the section being read. Readers click the name to open the table of contents. The bar is hidden while readers scroll down, and shown when they scroll up. After a link, Back, or Forward takes readers to another place on the page, the bar stays hidden until they scroll. Away from the top of the page, the bar has a line under it.

### Between pages

With the up button, readers who came from the page above return to their place on it.

Between tex8web pages on the same origin (the same scheme, host, and port), the old page moves a little left and fades out as the new page fades in. The pages move right when readers go up or back. In browsers without this transition, the new page fades in or appears at once. With reduced motion on, the new page appears at once.

To fade between the other pages of your site too, add `@view-transition { navigation: auto; }` to their CSS.

### Theme

The page uses the system setting for light or dark mode until the reader picks a theme with the theme button. This choice is saved in the browser for every tex8web page on the same origin. To set a default for your site, put `data-theme="light"` or `data-theme="dark"` on the `<html>` element. A choice made by the reader takes precedence over this default.

In light mode, colors are as in the PDF. In dark mode, dark text becomes light and light backgrounds become dark, with the same hues. Colored links keep their hue but are lighter and less saturated. TikZ pictures are inverted.

### Table of contents

`\tableofcontents` is moved out of the text, into a column beside the text on a wide screen, and into a drawer on a narrow screen. Readers show or hide the column, and open the drawer, with the table of contents button. This choice is saved in the browser for every tex8web page on the same origin.

The entry of the section being read is marked. Near the end of the page, each remaining heading is marked in turn as the page scrolls. A link followed to a heading marks its entry until the reader scrolls. The column is scrolled to that entry as the page scrolls and when the column is shown, and the drawer when it opens. Sections and the levels above them are always listed, and subsections too when every entry fits in the column or the drawer without scrolling. Otherwise, subsections are listed only for the section being read and the sections the reader opens. Readers open or close a section with the chevron after it, and a section opened with its chevron stays open until the reader closes it. With a mouse, a chevron is faint while the pointer is over its section or the section is open, and clear while the pointer is over the chevron. Every chevron is faint on a touch screen.

Entry indents, number widths, and fonts are as set by tocloft or the class. With tocloft, each level is in the font of its `\cft<level>font`, such as `\cftsecfont`, without its color. `\listoffigures` and `\listoftables` stay in the text.

### Search field

As the reader types in the search field at the top of the table of contents, the matching headings, numbered theorems and boxes, and terms marked with [`\WebTerm`](#your-own-config) are listed. Case, accents, and math styles are ignored. A Greek letter is found by its TeX name, for example σ by `sigma`. Readers choose a result with the arrow keys and go to it with Enter.

### Fonts

The text is in the PDF font when it is one of these:

- Latin Modern (the LaTeX default)
- Charter
- the standard PostScript fonts: Times, Palatino, Helvetica, Courier, Bookman, New Century Schoolbook, and Avant Garde

These fonts come from packages such as `mathptmx`, `txfonts`, `newtxtext`, `mathpazo`, `pxfonts`, `newpxtext`, `helvet`, `charter`, `XCharter`, and the TeX Gyre packages. The standard PostScript fonts are shown in their TeX Gyre versions, and Charter in XCharter, copied from your TeX Live installation.

A font chosen in the text, for example with `\fontfamily{bch}`, is shown the same way. Other fonts are shown in Latin Modern. If your document's text is in its sans-serif font, set with `\familydefault`, the page is in a sans-serif font too.

The math is in the MathJax TeX font, which looks like Computer Modern. With `mathptmx`, `newtxmath`, `txfonts`, `mathpazo`, `newpxmath`, `pxfonts`, or `fouriernc`, the math is in the matching MathJax TeX Gyre font: Termes for Times, Pagella for Palatino, or Schola for New Century Schoolbook. With a `newtxmath` option for another font, the math stays in the TeX font, except with `nc`, which is New Century Schoolbook.

### Headings

Heading sizes, the space above and below headings, and the space after their numbers are as in the PDF. If `\maketitle` is defined in your document or its class, the title has the font and size set there, and `--tex8web-title-size` is not used. With titlesec, each heading has the font, alignment, and label of its `\titleformat`, and the spacing of its `\titlespacing`. Without titlesec, a heading defined with `\@startsection`, as in the standard classes, amsart, and memoir, has the font of the style in it. In memoir, this style is set with `\setsecheadstyle` and similar commands. In memoir, a part or chapter title is in `\parttitlefont` or `\chaptitlefont`, and its label in `\partnamefont` or `\chapnamefont`, as they are set by `\chapterstyle` or in your document.

### Lists

List labels, indents, and spacing are as in the PDF.

### `\hfill`

After `\hfill` in a paragraph, a heading, or a caption, the rest of the line is at the right, as in the PDF. If the rest does not fit, it is at the right of the next line.

### Line breaks

`\break`, `\linebreak`, and `\linebreak[4]` end the line, as in the PDF. `\linebreak[n]` with n below 4 does not.

### Tables

Each cell has `\tabcolsep` at its sides, as in the PDF, unless `@{}` removes it.

In a paragraph column, such as `p{3cm}`, `\centering` or `\raggedleft`, or ragged2e's `\Centering` or `\RaggedLeft`, centers a cell's lines or sets them flush right, as in the PDF. Put it at the start of the cell, or in the column's `>{}`.

A table sits where it sits in the PDF. A tabular is at the left, at the paragraph's indent, unless `center`, `flushright`, `\centering`, or `\raggedleft` puts it elsewhere. A tabular in a table cell is placed by the cell's alignment. A longtable is centered, or placed by its `[l]` or `[r]` option, or by `\LTleft` and `\LTright` set to `\fill` or `0pt`. A tabularx is centered.

The space that `\\[len]` adds below a row is kept, as in the PDF. This includes the lines of `\author` in the article, report, and book classes.

### Boxes

In text, `\fbox`, `\framebox`, `\colorbox`, and `\fcolorbox` have the `\fboxsep` and `\fboxrule` in force at each box, as in the PDF.

### Footnotes

On a wide screen, a footnote is beside the paragraph, list, or theorem that has its mark, and on a narrow screen below it. A footnote in a table, figure, box, or formula is at the end of the page.

### Preview cards

When a reader points at a reference, a citation, a footnote mark, or a link to a section, or gives it keyboard focus, its target is shown in a card. On a touch screen, the card is shown on the first tap and the link followed on the second.

### Opening a picture

Readers click a picture in a figure or in display math, or any picture much taller than a line, to open it over the page. A picture that is a link opens the link. Readers zoom the opened picture with the mouse wheel, a pinch, or a double-click, move it by dragging, and close it with Escape or a click beside it. A picture can also be reached with Tab and opened with Enter or Space. When the picture is closed, the focus returns to it.

### Links to headings

Headings and numbered theorems have a `#` link in the margin, shown when the pointer is over them. So does a tcolorbox with a title and a number or a label. On a narrow screen, the heading or the theorem head is the link.

### Printing

A printed page contains the document alone, in light mode colors, without the controls or the table of contents. Footnotes are printed after their paragraphs. For a printed copy, use the PDF, with TeX's page breaks and page numbers.

### Without JavaScript

With JavaScript off, the page is still readable, every entry of the table of contents is shown, and the theme is the system setting.

### Screen readers

Screen readers are given each formula in spoken English from MathJax, for example "the fraction with numerator 1 and denominator 1 minus gamma". In a page built [without Node](#without-node), they are given MathML instead. A picture's alt text is the `alt` key of graphicx, or empty.

### Shared links

A link to the page shared in a chat app or on a social site has a preview with the document title, and the abstract if there is one.

## Differences from the PDF

### Reading defaults

To set the text as in the PDF instead, use [`\WebLikePDF`](#your-own-config) in your config.

- The text is at the reader's default font size, set in the browser. This size is 12pt unless the reader changes it, larger than in most PDFs. Everything else is scaled with the text. The column is as wide as the PDF column, in ems.
- The line spacing is the browser default, a little looser than in TeX.
- Paragraphs are separated by space instead of indented.
- A center, flushleft, flushright, or verbatim block has the space of a list above and below it, without the paragraph space.
- The text is ragged right and not hyphenated.

### Choices for the web

These differences cannot be turned off.

- On a wide screen, the table of contents and the footnotes are beside the text. See [On the page](#on-the-page).
- Without the `colorlinks` option of hyperref, a link is in the text color with a faint underline, where the PDF has a box around it. With `hidelinks`, links are unmarked, as in the PDF.
- A picture given a `width` and a `height` without `keepaspectratio` has its original proportions, not stretched as in the PDF.
- Dark mode has separate background, text, and link colors.

### Screen width and page numbers

- A picture is at its PDF size until the column is narrower than the picture, and then scaled down to the column width.
- Minipages and subfigures that share a line in the PDF are side by side at their PDF widths, and wrap on a narrow screen.
- Display math wider than the column scrolls sideways, and so do wide tables and verbatim blocks on a narrow screen. With JavaScript on, these blocks fade out at an edge where more of the block is hidden.
- The table of contents has no page numbers or dot leaders.
- An index is in one column. In place of page numbers, each entry has numbers that count the `\index` commands in order, and each number links to its `\index`.

## Checking your documents after an upgrade

A new tex8web version can change how your pages look. Build your documents and accept the pages before the upgrade, and build them again after it. Run the command from the directory that contains your documents, so the builds and baselines are stored there:

```sh
cd ~/papers
npm --prefix path/to/tex8web run regress -- --accept thesis talk/talk.tex   # before
npm --prefix path/to/tex8web run regress -- thesis talk/talk.tex            # after
```

Each argument is a document directory, meaning its `main.tex` or its only `.tex` file, or a `.tex` file. Documents are named after their directories, so two documents in directories with the same name cannot be checked together.

The documents are built in parallel, and each page is checked as in `npm test` and compared with its baseline. One line is printed for each document:

- `unchanged`: the page is the same as its baseline
- `changed: <files>`: the HTML or other files differ, but every screen looks the same
- `looks different: <screens>`: these screens differ in a browser
- `no baseline to compare with`: no page accepted for this document yet
- `failed to build`, or `problem:` lines under the document's line: see `logs/<name>.html.log`

The exit code is 0 when no page looks different, 3 when a page looks different, 1 when a build or a check failed, and 2 for a mistake in the command. For a page that looks different, the first differing screens for each width and color scheme are saved, old and new, in `compare/<name>`. Look at them before you accept.

The options:

- **`-c config`**: Build every document with `config`.
- **`--accept`**: Make this run's pages the baselines. Screens are not compared, so a changed page is reported as `changed`. Nothing is accepted when any document failed. `--accept` cannot be used with `--draft`.
- **`--baseline dir`**: Compare with the pages in `dir/<name>` instead, for example the `html` directory of another tex8web checkout.
- **`--out dir`**: Write everything to `dir`, by default `build/regress` in the directory you run the command from. `dir` contains `html/<name>` for the pages, `compare/<name>`, `logs/`, `tex4ht/`, and `accepted/<name>`. Keep `-` and the characters `^ $ ( ) % [ ] * + ?` out of the path. See [Known limitations](#known-limitations).
- **`--draft`**: Build in draft mode, as with `-m draft`. Draft builds are quicker, but their pages are not reliable.
- **`--shots-cache dir`**: Cache the baselines' screenshots in `dir`, so each baseline is shot once for all runs that use `dir`. The default is `shots-cache` in the `--out` directory.
- **`--latexmk`**: Build each document's PDF first, with `latexmk` in the document's directory. A document whose PDF fails to build is not built.

Without `--latexmk`, no PDFs are built, and if the PDF linked with `\WebPDF` in your config is missing, the page has no PDF button. A document is built again only when one of its inputs has changed: tex8web, the document's directory, the config, the linked PDF, or the build tools.

## Known limitations

Smaller differences in the math are listed in [CONTRIBUTING.md](CONTRIBUTING.md#small-known-differences).

### Building

- **A space in the path of tex8web or of a config.** A config path with a space does not work with tex4ht, so tex8web stops with an error. Move tex8web or the config to a path without spaces.
- **`-B` with a `-` in its path.** The `-B` directory is used as a Lua pattern by make4ht, so with a `-` anywhere in the path, files are written to the wrong place. The characters `^ $ ( ) % [ ] * + ?` have the same effect. Keep them out of the path, and keep the path relative to your document, as the default `build/tex4ht` is.
- **One page per document.** A document is split into several pages by a number such as `2` in the `\Preamble` options, by `splitat=`, or by `\CutAt` in a config. With any of these, tex8web stops with an error. Remove the option.
- **Document classes not supported by tex4ht**, such as Tufte-LaTeX. Configure the class for tex4ht in your config.
- **The `program` option of imakeidx** is ignored: makeindex is always run. The `splitindex` option is not supported.

### Math

- **Macros that tex8web cannot translate for MathJax** are shown in red and listed in a warning. Among them are macros with arguments in a custom format, such as comma-separated lists. Define a version for MathJax with [`\WebMathMacros`](#your-own-config).
- **Colors in math.** A color defined inside a group is not passed to MathJax. The color models `hsb`, `Hsb`, `tHsb`, and `wave` are not supported. A color redefined later in the document has its last value everywhere in math.
- **The QED box** of an amsthm proof is at the right, as in the PDF. After `\qedhere` in a display, the box is in the display's tag, but below the display when the display has a `\tag`, and in `$$ $$` and `displaymath`. In `multline`, the box is under the equation number, not at the end of the last line. A `\qedsymbol` that cannot be typeset by MathJax as math or text, such as `\ensuremath{...}`, is shown in red in a display.
- **siunitx in math.** Numbers, units, quantities, angles, ranges, lists, products, and complex numbers are set as in the PDF, in math. In text, each number of a range, list, or product is a formula of its own. In math, a phrase with a text command other than `\textendash` or `\textemdash` is shown in red: write the phrase in plain words. If your document loads siunitx without xcolor, the page has no colors, and the build warns. Load xcolor to keep them.
- **The separator of xfrac's `\sfrac`.** A fraction with a separator in brackets, such as `$\sfrac{1}[/]{2}$`, is set wrongly, as a fraction over the bracket. Leave the separator out.
- **A TikZ picture in display math**, such as a `tikzcd` diagram, is drawn as one picture with the rest of the math in that display.
- **The space above display math** is `\abovedisplayskip`, also after a short line, where the PDF has the smaller `\abovedisplayshortskip`.
- **Space between array columns.** `\arraycolsep` is taken at `\begin{document}`, so a change to it for one formula is ignored. A rule `|` next to an `@{}` or `!{}` column has half an em of space beside it, where the PDF has `\arraycolsep`.
- **Boxes in math.** `\fbox`, `\colorbox`, and `\fcolorbox` in math have MathJax's space and frame, not `\fboxsep` and `\fboxrule`.
- **Styles for `.mathjax-inline`** in a config apply only to a page built without Node, and to math in text of another size, such as a footnote.

### Text and layout

- **`\hfill`.** With several `\hfill` on a line, only the text after the last one is at the right, and the parts before it stay together at the left. Text after `\hfill` that is longer than a line starts at the left of the next line, where in the PDF it fills the rest of the line first. In a centered paragraph with an `\hfill` inside a link or a color, the paragraph's other lines are at the left too. In a caption that fits on a line, the text after `\hfill` is a quad from the text before it, where in the PDF `\hfill` adds no space.
- **Line breaks.** A line ended by `\break` or `\linebreak` is not stretched to the full width in a justified paragraph, as it is in the PDF. `\hfil\break` does not end the line: use `\\`, `\break`, or `\hfill\break`.
- **Paragraph cells.** All of a cell's paragraphs are aligned as its last one, for example all centered after a `\centering` between them.
- **Tables in a line.** A paragraph with a tabular inside its text is broken around the tabular.
- **Negative row space.** `\\[len]` with a negative length, such as `\\[-4pt]`, has no effect. In the PDF, the next row is set higher.
- **Table widths.** A tabularx is as wide as its contents, where in the PDF it fills its width. A longtable with a fixed `\LTleft`, such as `\parindent`, is at the left margin.
- **Minipages.** A paragraph with a minipage inside its text is broken around the minipage. `\centering` in a minipage applies only in a figure. Two minipages, each inside an `\fbox`, are one above the other instead of side by side.
- **A list item that starts with a box.** Beside a minipage or tabular aligned at its center or bottom, the item's label is at the box's first line. In the PDF, the label is at the middle of the box, or at its last line.
- **Boxes in headings.** An `\fbox`, `\framebox`, `\colorbox`, or `\fcolorbox` in a heading has more space inside and a thicker frame than in the PDF, in proportion to the heading's size.
- **Colors in text.** `\color` for the whole document, in the preamble or in `\AtBeginDocument`, is ignored. Inside a colored group, the text color is not restored by `\normalcolor`.
- **Chapters and parts.** A chapter label, such as "Chapter 1", is tex4ht's default label. Outside memoir, part and chapter headings have the fonts of the report and book classes, unless they are formatted with titlesec. In the article class, parts have the article's sizes. A chapter is spaced as in the PDF in the report, book, and memoir classes, and in chapter styles that set the label and the title on lines of their own. Other chapter styles, such as fncychap's, have a default spacing. The space above a chapter follows the text before it, where in the PDF the chapter starts a new page. Parts are spaced as in the PDF in the article, report, book, and memoir classes. A part that has a page of its own in the PDF has the space above and below of a chapter, scaled to the part's size.
- **Heading alignment.** A heading is centered or set flush right only if the command, such as `\centering`, is in its titlesec format, its `\@startsection` style, the class's `\part`, or memoir's `\chaptitlefont` or `\parttitlefont`. A command inside another macro, as in memoir's `\setsecheadstyle{\centering}`, is not found.
- **KOMA-Script headings** are bold, in the text's family and the standard classes' sizes. In the PDF, they are in a bold sans-serif font. To change them, set `--tex8web-section-family` and the other heading properties with `\Css`.
- **mwcls classes.** In mwart, mwrep, and mwbk, headings have the sizes and spacing of the standard classes. A chapter's number is on a line of its own, where in the PDF it is beside the title. The bibliography's entries are farther apart than in the PDF. The table of contents has the class's indents and number widths, but no space above the entries of the top level. The page's title, shown in the browser tab, is not the document's title.
- **Text in `\scalebox` or `\resizebox`** is shown at its natural size. Only pictures in these boxes are scaled.

### Packages

- **tcolorbox.** Boxes have their colors, rules, corners, shadow, spacing, and title. Anything drawn with TikZ in a skin, such as overlays and shadings, is shown as a plain frame. Pictures in side-by-side listing boxes are not converted. The line before the lower part of a box stops at the box's padding, where in the PDF it reaches the frame. If the build fails on a fragile command in a box title, make the command robust with `\robustify` in your config.
- **enumitem.** `align=left`, `wide`, and `itemindent` are ignored. Labels are right-aligned and hang into the margin, as in standard LaTeX lists.
- **Table colors.** With colortbl and without xcolor, `\textcolor` with colors defined in your document has no effect, because xcolor is loaded by tex4ht after these colors are defined. Load xcolor yourself, before you define the colors. In a table with `\hline`, the row colors of `\rowcolors` alternate wrongly.
- **algorithm2e.** The `ruled` and `algoruled` styles have their rules, and every style has its caption in its place. `boxed`, `boxruled`, `tworuled`, and `plainruled` have no frame or rules. Block markers (`\AlgoDisplayBlockMarkers`) are not shown. A line wraps at the window width, not the PDF width, so a `\tcp*` comment can move to the next line.
- **float styles.** Only `ruled` is drawn. A `boxed` float has no frame, and the caption of a `plaintop` float stays where `\caption` is.
- **mdframed.** A box has its middle line (`linewidth`), its colors, and its space inside and around it. Inner and outer lines, rounded corners, shadows, and anything drawn with TikZ or PSTricks are missing. A `frametitle` is inside the box padding, without a separate title bar.
- **`\FrameSep` of framed.** A framed box has no padding between its rule and its text.
- **tocloft fonts for lists of figures and tables.** `\cftfigfont` and `\cfttabfont` are ignored, and these lists are in the text font.

### Pictures

- **A picture without its `.xbb` file.** The size of a bitmap or PDF picture is taken from a `.xbb` file next to it. Without this file, a picture sized with `scale` or `height`, or with `width`, `height`, and `keepaspectratio`, is not at its PDF size. Make the file with `extractbb -x picture.png`.
- **A size after `angle`**, as in `[angle=90,width=5cm]`, and **`scale` with `width` or `height`** are ignored, and the picture is at its natural size. Put the size before `angle`, or leave out `scale`.
- **`trim` and `viewport`.** The whole picture is shown, at the width of the part that is kept.

### Reading in a browser

- **The controls are in English**, whatever the document language, and so is the speech for math. In the speech, `|` is "given", as in `P(A | B)`, so `a | b` in a document about divisibility is spoken as "a given b".
- **Find in page.** Readers can find single characters of a formula with the browser's find-in-page command, but not a run of characters such as `Δ(S)`.
- **A page opened from disk, or read with JavaScript off.** Fonts are not preloaded. On a phone, the layout of a long page can take a moment longer to settle.
- **Safari after a swipe back.** After a swipe back to a page in Safari, the pages no longer slide when the reader returns to that page from history with the up or back button. The reader still returns to the same place.
