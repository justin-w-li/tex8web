# tex8web documentation

This is the guide to building pages and configuring them. For how tex8web works inside, and how it is tested, see [CONTRIBUTING.md](CONTRIBUTING.md).

1. [Building a page](#building-a-page)
2. [Your own config](#your-own-config)
3. [On the page](#on-the-page)
4. [Differences from the PDF](#differences-from-the-pdf)
5. [Known limitations](#known-limitations)

## Building a page

```sh
path/to/tex8web/bin/tex8web document.tex
```

This builds `build/html/document.html` next to the document. tex4ht's working files and logs stay in `build/tex4ht/`; look there when a build fails. To run it as `tex8web` from anywhere, run `npm link` in tex8web's directory, or put `bin/` on your `PATH`.

The options:

- **`-c config`** builds with your own config instead of `tex8web.cfg`. See [Your own config](#your-own-config).
- **`-d out`** puts the page in `out/` instead, a path relative to where you run the command.
- **`-B aux`** puts tex4ht's working files in `aux/`, a path relative to the document. Keep `-` out of it; see [Known limitations](#known-limitations).
- **`-p pdf`** adds an icon that links to the document's PDF, and copies the PDF next to the page. The path is relative to where you run the command. Build the PDF first, for example with `latexmk -pdf -outdir=build/pdf document.tex`. With a config's [`\WebPDF`](#your-own-config) too, `-p` wins.
- **`-u url`** adds an icon that links up to the page above this one on your site, such as a list of your documents. The URL is relative to the page, for example `../index.html`. With a config's `\WebUp` too, `-u` wins.
- **`-m draft`** runs LaTeX once and skips the bibliography and index. It is quicker while you work, but references and citations may show as ??.
- Any other option is passed to make4ht. The document comes last.

The output folder holds the page and everything it uses:
- `document.html` and its stylesheets;
- the pictures, and the PDF if you link it with `-p` or `\WebPDF`;
- `fonts/`: Latin Modern or TeX Gyre, MathJax's fonts, and `LICENSE.txt`, which covers them;
- `tex8web-head.js` and `tex8web-page.js`, the page's controls;
- without Node, `tex8web.js` instead of MathJax's fonts.

The paths are relative, so you can publish the folder as it is. With Node, its fonts contain only the characters the document uses, so each document needs its own folder. The page is `document.html`, not `index.html`, so link to it by name. On GitHub Pages, for example, that is `https://you.github.io/repo/document.html`.

**Bibliographies and indexes.** tex8web runs bibtex or biber when the document has a bibliography. It runs makeindex for each index the document prints, from makeidx or imakeidx. Each index uses its own style file. Style files are found next to the document and on `INDEXSTYLE`.

**Without Node.** Node typesets the math when you build. If `npm ci` hasn't been run, the build warns, and the page loads MathJax from jsDelivr instead. It then needs the network to show its math, and its fonts are whole rather than cut down. Set `TEX8WEB_NO_PRERENDER` to any value to choose this on purpose.

**Without the wrapper.** `bin/tex8web` runs this command in the document's directory:

```sh
make4ht -u -c path/to/tex8web/tex8web.cfg -e path/to/tex8web/tex8web.mk4 -B build/tex4ht -d build/html document.tex
```

Pass both files every time: `tex8web.mk4` tells TeX where to find what `tex8web.cfg` loads. If TeX stops with "tex8web-core.tex not found", the `-e` option is missing. To link the PDF, set `TEX8WEB_PDF` to its path, absolute or relative to the document. To link up to a page, set `TEX8WEB_UP` to its URL.

**Platform.** The build runs Node, bibtex and makeindex through a POSIX shell, so it works on macOS and Linux, not Windows.

## Your own config

Most documents need no config of their own. tex8web reads what it needs from the document: its macros, colors, theorem styles and lists. It also reads titlesec's headings, tocloft's table of contents and tcolorbox's boxes.

Write a config when:
- the build ends with a warning about macros MathJax can't read;
- your document needs a style of its own on the web;
- you always want a link to the PDF or the page above, without passing `-p` or `-u`;
- your document marks its terms with a command of its own, for the contents filter to find;
- you want the text set as in the PDF.

A config is a copy of `tex8web.cfg` with your additions after `\input{tex8web-core.tex}`. Pass it with `-c`. For worked examples, see `examples/custom/custom.cfg` and `examples/complex/complex.cfg`.

```latex
\Preamble{xhtml,mathjax}
\begin{document}
\input{tex8web-core.tex}

% a macro MathJax can't read as defined (here, one using \scalebox)
\WebMathMacros{
    \newcommand{\bigtimes}{\mathop{\Large\times}}
}

% soul's highlighter, \hl{...}, as a span of your own, with a color for
% light and dark mode: var(--highlight)
\renewcommand{\hl}[1]{\HCode{<span class="highlight">}#1\HCode{</span>}}
\definecolor{highlight-dark}{RGB}{90, 80, 30}
\WebColor{highlight}{yellow!20}{highlight-dark}
\Css{.highlight { background-color: var(--highlight); }}

% the terms a command of the document's own sets (here \term{...}), which
% the table of contents' filter finds
\WebTerm\term

% an icon linking to the PDF (build it first)
\WebPDF{build/pdf/document.pdf}

\EndPreamble
```

| Command | Use it when |
| --- | --- |
| `\WebMathMacros{definitions}` | the build warns of "macro(s) left undefined for MathJax", or math shows in red |
| `\WebColor{name}{light}{dark}` | your config writes HTML or CSS of its own and needs a color that follows dark mode |
| `\WebTerm\cs` | your document marks the terms it defines with a one-argument command, and you want the contents filter to find them |
| `\WebPDF{path}` | you always want the icon linking to the PDF, without passing `-p` |
| `\WebUp{url}` | you always want the icon linking up to the page above, without passing `-u` |
| `\WebLikePDF` | you want the text set as in the PDF: its size and line spacing, indented paragraphs, and justified text |
| `\Css{...}` | you want a style of your own, or to change one of tex8web's |

**`\WebMathMacros`** gives MathJax its own definitions, which take precedence over the document's. Write them in MathJax's TeX. You need it for:
- the macros the build's warning names, such as those built with `\mathpalette`, `\scalebox` or internal `@` macros;
- xparse commands with arguments other than `m` and a leading `O{}`;
- macros the build can't see, because they are defined in loops or by your own commands. The build reads the document and the local packages it loads, and follows their `\input` and `\include` to files named relative to the document's directory.

**`\WebColor`** makes the CSS variable `--name` from two colors: the first in light mode, the second in dark mode.

**`\WebTerm\cs`** makes what `\cs` sets in the text a term that the filter finds. Its id is `term-` followed by its text in lower case, with a hyphen for each run of spaces or punctuation, and without its math: `\term{Convex set}` gets `term-convex-set`. Inside a heading or a theorem's note, the term is found as that heading or theorem. Give each command to `\WebTerm` once.

**`\WebLikePDF`** replaces the page's [reading defaults](#reading-defaults) with the PDF's. The text takes the PDF's size, and the column, which is measured in ems, follows it. Lines are spaced as TeX spaces them. Paragraphs are indented as in the PDF, with its space between them, usually none. On a wide screen the text is justified and hyphenated. A narrow screen stays ragged right, where a formula that can't break would leave wide gaps.

**`\WebPDF`** does what [`-p`](#building-a-page) does, from the config. Its path is relative to the document.

**`\WebUp`** does what [`-u`](#building-a-page) does, from the config.

**`\Css`** adds a style after tex8web's own. Write `#` as `\#` and `%` as `\%` inside it. tex8web's styles are in `css/tex8web.css`. The document's measurements are custom properties that you can set again:

| Property | What it sets |
| --- | --- |
| `--tex8web-textwidth` | the text column's width |
| `--tex8web-margin`, `--tex8web-gap` | the side columns' width and the gap around them, in `em` or `rem`. A screen is "wide" when the text and both columns fit. |
| `--tex8web-title-size`, `--tex8web-section-size`, … `--tex8web-subparagraph-size` | heading sizes; with chapters, also `--tex8web-part-size` and `--tex8web-chapter-size` |
| `--tex8web-<heading>-labelsep` | the space after a heading's number |
| `--tex8web-<heading>-family`, `-weight`, `-style`, `-variant`, `-align` | a heading's font, with titlesec |
| `--tex8web-<heading>-before`, `-after` | the space above and below a heading, from titlesec or the class |
| `--tex8web-list-sep`, `--tex8web-item-sep`, `--tex8web-leftmargin` | a description's spacing and indent; other lists have their own `--tex8web-list-*` on their element |
| `--tex8web-bibitem-sep`, `--tex8web-biblabelsep` | the bibliography's space between entries, and after their labels |
| `--tex8web-footnote-leading`, `--tex8web-abstract-leading` | the line spacing of footnotes and the abstract, as a multiple of the text's |
| `--tex8web-abstract-left`, `--tex8web-abstract-right` | the abstract's margins |
| `--tex8web-framed-sep` | the space above and below framed's boxes |
| `--tex8web-toc-<level>-indent`, `--tex8web-toc-<level>-number` | the table of contents' indents and number widths |
| `--tex8web-toc-<level>-family`, `-weight`, `-style`, `-variant`, `-size` | an entry's font, with tocloft; the size is a multiple of the text's |
| `--tex8web-bg`, `--tex8web-text`, `--tex8web-link`, `--tex8web-cite`, `--tex8web-url` | the page's colors |
| `--tex8web-roman`, `--tex8web-sans`, `--tex8web-mono` | the roman, sans-serif and typewriter fonts |
| `--tcb-*` | a tcolorbox's frame, colors and spacing, on the box's element |

In a config's `\Css`, `@media (--tex8web-wide)` matches a wide screen, and `not (--tex8web-wide)` a narrow one.

## On the page

**Controls.** Small icons sit at the top left: the page above (with `-u` or `\WebUp`), the table of contents, the PDF (with `-p` or `\WebPDF`), light or dark, and a link to tex8web. On a narrow screen they form a bar across the top. The bar names the section being read, and hides while the reader scrolls down.

**Between pages.** The up icon goes back to the page above, where the reader was on it, if they came from there. Following a link from one tex8web page to another of the same origin, the page moves a little to the left as the next one fades in. Going up, it moves to the right. A site's own pages can take part by adding `@view-transition { navigation: auto; }` to their CSS; they fade. Readers who ask for reduced motion get the next page at once. Other browsers fade to it, or show it at once.

**Theme.** The page follows the reader's light or dark setting until they choose one with the button. Their choice is kept in the browser, under `localStorage` key `tex8web-theme`, for every tex8web page on the site. A site can set a default with `data-theme="light"` or `"dark"` on the root element; the reader's choice still wins. Light mode uses the PDF's colors. In dark mode, the document's colors keep their hue: dark text becomes light, and light backgrounds become dark. TikZ pictures are inverted.

**Table of contents.** `\tableofcontents` moves out of the text. On a wide screen it sits beside the text; on a narrow one it opens as a drawer. It marks the section being read. It always lists the sections and the levels above them, but only the subsections of the section being read. Its indents, number widths and fonts come from tocloft or the class: with tocloft, each level is in the font of its `\cft<level>font`, such as `\cftsecfont`. A color in that font isn't followed. A `\listoffigures` or `\listoftables` stays in the text.

**Finding.** A field at the top of the table of contents finds headings, numbered theorems and boxes, and terms (`\WebTerm`) as the reader types. Case, accents and math styles don't matter, and a Greek letter is found by its TeX name (`sigma` finds σ). The arrow keys and Enter choose a result.

**Fonts.** The text is in the PDF's font when it is Latin Modern, LaTeX's own, Charter, or one of the standard PostScript fonts: Times, Palatino, Helvetica, Courier, Bookman, New Century Schoolbook or Avant Garde. These come from packages such as `mathptmx`, `txfonts`, `newtxtext`, `mathpazo`, `pxfonts`, `newpxtext`, `helvet`, `charter`, `XCharter` and TeX Gyre's own. The standard fonts are set in TeX Gyre's versions of them, and Charter in XCharter, which the build takes from TeX Live. This holds also for a font chosen in the text, such as `\fontfamily{bch}`. Other fonts are shown in Latin Modern. A document whose text is in its sans-serif font, with `\familydefault`, has a sans-serif page. The math is in MathJax's TeX font.

**Headings** keep the PDF's sizes, the space above and below them, and the space after their numbers. With titlesec, each heading has its `\titleformat`'s font, alignment and label, and its `\titlespacing`.

**Lists** keep the PDF's labels, as TeX sets them, and each list's indent and spacing.

**`\hfill`** in a paragraph puts the rest of its line at the right, as in the PDF. When the line has no room for it, it goes to the right of the line below.

**Footnotes.** On a wide screen, a footnote sits beside the paragraph, list or theorem with its mark. On a narrow screen, it sits below that paragraph, list or theorem. A footnote in a table, figure, box or formula stays at the end of the page.

**Previews.** Pointing at a reference, citation, footnote mark or section link shows what it points to in a card. The keyboard shows it too. On a touch screen, the first tap shows it and the second follows the link.

**Pictures.** Clicking a picture in a figure or a display, or any picture much taller than a line, opens it over the page. There the reader can zoom with the wheel, a pinch or a double-click, and drag it. Escape or a click beside it closes it.

**Links.** Headings and numbered theorems have a `#` link in the margin, shown on hover. So does a titled tcolorbox with a number or label. On a narrow screen, the heading or theorem's head is the link.

**Printing** gives the document alone, in light mode's colors, without the controls or the table of contents. Footnotes follow their paragraphs. The PDF is still the better copy to print: its page breaks and numbers are TeX's.

**Without JavaScript** the page still reads. The table of contents shows every entry, and the theme follows the system.

**Screen readers** hear each formula as MathJax's spoken English, such as "the fraction with numerator 1 and denominator 1 minus gamma". When MathJax typesets in the browser, they get MathML instead. An image's alt text is graphicx's `alt` key, or empty.

**Link previews** in chat apps and social sites show the document's title, and its abstract if it has one.

## Differences from the PDF

These are deliberate. They fall into three groups.

### Reading defaults

The page sets its text for a screen. A config's [`\WebLikePDF`](#your-own-config) sets it as the PDF does instead.

- The text is 12pt, larger than most PDFs, and everything else is in proportion. The column is as wide as the PDF's in ems.
- Line spacing is the browser's, a little looser than TeX's.
- Paragraphs are separated by space instead of indented.
- The text is ragged right, not justified and hyphenated.

### Choices for the web

These have no switch: each helps reading without changing what the document says.

- The table of contents and the footnotes sit beside the text, not where the PDF puts them. See [On the page](#on-the-page).
- Without hyperref's `colorlinks`, a link is in the text's color with a faint underline, where the PDF draws a box around it. With `hidelinks`, links are unmarked, as in the PDF.
- A picture given a `width` and a `height` without `keepaspectratio` keeps its proportions instead of being squashed.
- Dark mode has its own palette.

### What a page can't do as a PDF does

A page has no pages and no fixed width.

- A picture keeps its size as a narrower screen reflows the text. It shrinks only once the column is narrower than the picture.
- Minipages and subfigures that share a line in the PDF stay side by side at their PDF widths. On a narrow screen they wrap.
- Display math that doesn't fit scrolls sideways. On a narrow screen, so does a wide table or verbatim block. With JavaScript on, each fades out at an edge where more of it is hidden.
- The table of contents has no page numbers or dot leaders.
- An index is in one column. Its numbers count the `\index` commands in order, in place of page numbers.

## Known limitations

Each item says what goes wrong and, where there is one, what to do.

- **`-B` with a `-` in its path.** make4ht reads the `-B` directory as a Lua pattern, so a `-` anywhere in its path sends files to the wrong place. Keep `-` out of it, and keep it relative to the document, as `bin/tex8web`'s default `build/tex4ht` is.
- **A space in tex8web's path or in a config's path.** tex4ht can't read such a config, so `bin/tex8web` stops. Move tex8web or the config to a path without spaces.
- **Macros MathJax can't read** show in red. These include macros that parse their own arguments, such as comma-separated lists. Give MathJax a version with `\WebMathMacros`.
- **`\color` for the whole document**, in the preamble or in `\AtBeginDocument`, isn't followed. A `\normalcolor` inside a colored group doesn't bring back the text's color.
- **tocloft's fonts for lists of figures and tables**, `\cftfigfont` and `\cfttabfont`, aren't followed. Those lists stay in the text's font.
- **The QED box** of an amsthm proof sits at the right, in a display's tag after `\qedhere` as in the PDF. Not followed: with a `\tag` of the display's own the proof ends with its box below the display, as it does after `$$ $$` and `displaymath`; in `multline` the box goes under the number, not at the end of the last line. A `\qedsymbol` that isn't math or text MathJax can read, such as `\ensuremath{...}`, shows in red in a display.
- **Several `\hfill`s on a line.** Only what follows the last one goes to the right; the parts before it stay together at the left. In a centered paragraph, an `\hfill` sends its other lines to the left too.
- **enumitem.** `align=left`, `wide` and `itemindent` aren't followed: labels are right-aligned and hang into the margin, as LaTeX's own are.
- **A TikZ picture in display math**, such as a `tikzcd`, is drawn as a picture together with the rest of that display's math.
- **Safari after a swipe back.** Once a reader swipes back to a page, Safari no longer slides when they return to it from history, by the up icon or the back button. The page still comes back where they were.
- **Delimiters and radicals** can differ slightly in size, since MathJax picks them from its own font.
- **Prerendered math is laid out by estimates** where a browser would measure, such as text in math that MathJax has no glyphs for. A box can come out a pixel or so off.
- **tcolorbox.** Boxes get their colors, rules, corners, shadow, spacing and title. What a skin draws with TikZ, such as overlays and shadings, comes out as a plain frame. Pictures in side-by-side listing boxes aren't converted. If a fragile command in a box's title breaks the build, `\robustify` it in your config.
- **Colors in math.** A color named only in a macro's argument, as in `\hl{ink}{x}` where `\hl` calls `\colorbox`, isn't given to MathJax. Neither is a color defined inside a group. The models `hsb`, `Hsb`, `tHsb` and `wave` aren't supported. A color redefined later in the document has its last value everywhere in math.
- **Table colors.** With colortbl but not xcolor, `\textcolor` of the document's own colors is lost, as tex4ht loads xcolor after the document defines them. Load xcolor yourself, before the colors are defined. In a table with `\hline`, `\rowcolors` alternates wrongly.
- **Minipages.** A minipage inside a paragraph's text breaks the paragraph around it. `\centering` in a minipage is followed only in a figure. Two minipages, each in its own `\fbox`, sit one above the other instead of side by side.
- **A picture's size without its `.xbb` file.** tex4ht reads a bitmap's or PDF's size from a `.xbb` file beside it. Without one, a picture sized by `scale` or `height`, or by `width` and `height` with `keepaspectratio`, isn't at the PDF's size. Make the file with `extractbb -x picture.png`.
- **A size after `angle`,** as in `[angle=90,width=5cm]`, and **`scale` with `width` or `height`**, aren't followed. The picture is at its natural size. Put the size before `angle`, or leave `scale` out.
- **`trim` and `viewport`.** The page shows the whole picture at the width of the part that is kept.
- **framed's `\FrameSep`.** A framed box has no padding between its rule and its text.
- **Chapters and parts.** A chapter's label, "Chapter 1", is tex4ht's. Part and chapter headings use report's and book's sizes, whatever the class.
- **Document classes tex4ht doesn't know**, such as Tufte-LaTeX, need a config of their own.
- **imakeidx's `program`** isn't followed: makeindex always runs. Its `splitindex` option isn't supported.
- **The page's controls are in English**, whatever the document's language. So is the speech for math. It reads `|` as "given", as in `P(A | B)`, so a document about divisibility hears `a | b` as "a given b".
- **The browser's find-in-page** finds a formula's characters one at a time, but not a run of them such as `Δ(S)`.
- **A page opened from disk in Chrome** loads its fonts without preloading, and the console reports each preload as blocked.
- **Styles for `.mathjax-inline`** in a config apply only when MathJax typesets in the browser.
