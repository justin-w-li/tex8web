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

This builds `build/html/document.html` next to the document, and keeps tex4ht's working files in `build/tex4ht/`. To run it as `tex8web` from anywhere, run `npm link` in tex8web's directory, or put `bin/` on your `PATH`.

The options:

- **`-c config`** builds with your own config instead of `tex8web.cfg`. See [Your own config](#your-own-config).
- **`-d out`** puts the page in `out/` instead.
- **`-B aux`** puts tex4ht's working files in `aux/`, a path relative to the document. Keep `-` out of it; see [Known limitations](#known-limitations).
- **`-m draft`** runs LaTeX once and skips the bibliography and index. It is quicker while you work on a document.
- Any other option is passed to make4ht.

The output folder holds the page and everything it uses:
- `document.html` and its stylesheets;
- the pictures, and the PDF if you link it with `\WebPDF`;
- `fonts/`: Latin Modern, MathJax's fonts, and `LICENSE.txt`, which covers them;
- `tex8web-head.js` and `tex8web-page.js`, the page's controls.

The paths are relative, so you can publish the folder as it is. Its fonts contain only the characters the document uses, so each document needs its own folder.

**Bibliographies and indexes.** tex8web runs bibtex or biber when the document has a bibliography. It runs makeindex for each index the document prints, makeidx's or each of imakeidx's, with its style file. Style files are found next to the document and on `INDEXSTYLE`.

**Without Node.** Node typesets the math when you build. If `npm ci` hasn't been run, the build warns, and the page loads MathJax from jsDelivr instead. It then needs the network to show its math. Set `TEX8WEB_NO_PRERENDER=1` to choose this on purpose.

**Without the wrapper.** `bin/tex8web` runs this command in the document's directory:

```sh
make4ht -u -c path/to/tex8web/tex8web.cfg -e path/to/tex8web/tex8web.mk4 -B build/tex4ht -d build/html document.tex
```

Pass both files every time: `tex8web.mk4` tells TeX where to find what `tex8web.cfg` loads. If TeX stops with "tex8web-core.tex not found", the `-e` option is missing.

**Platform.** The build runs Node, bibtex and makeindex through a POSIX shell, so it works on macOS and Linux, not Windows.

## Your own config

Most documents need no config of their own. tex8web reads what it needs from the document: its macros, colors, theorem styles, lists, headings (titlesec), table of contents (tocloft) and boxes (tcolorbox).

Write a config when:
- the build ends with a warning about macros MathJax can't read;
- your document needs a style of its own on the web;
- you want a link to the PDF.

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
| `\WebPDF{path}` | you publish the PDF beside the page and want an icon that links to it |
| `\Css{...}` | you want a style of your own, or to change one of tex8web's |

**`\WebMathMacros`** gives MathJax its own definitions, which take precedence over the document's. Write them in MathJax's TeX. You need it for:
- the macros the build's warning names, such as those built with `\mathpalette`, `\scalebox` or internal `@` macros;
- xparse commands with arguments other than `m` and a leading `O{}`;
- macros the build can't see: those defined in loops, by your own commands, or in files the document `\input`s. The build reads only the document and the local packages it loads.

**`\WebColor`** makes the CSS variable `--name` from two colors: the first in light mode, the second in dark mode.

**`\WebTerm\cs`** makes what `\cs` sets in the text a term that the filter finds. Its id is `term-` followed by its text. Inside a heading or a theorem's note, the term is found as that heading or theorem. Give each command to `\WebTerm` once.

**`\WebPDF`** copies the PDF next to the page. Its path is relative to the document.

**`\Css`** adds a style after tex8web's own. tex8web's styles are in `css/tex8web.css`. The document's measurements are custom properties that you can set again:

| Property | What it sets |
| --- | --- |
| `--tex8web-textwidth` | the text column's width |
| `--tex8web-margin`, `--tex8web-gap` | the side columns' width and the gap around them, in `em` or `rem`. A screen is "wide" when the text and both columns fit. |
| `--tex8web-title-size`, `--tex8web-section-size`, … `--tex8web-subparagraph-size` | heading sizes; with chapters, also `--tex8web-part-size` and `--tex8web-chapter-size` |
| `--tex8web-<heading>-labelsep` | the space after a heading's number |
| `--tex8web-<heading>-family`, `-weight`, `-style`, `-variant`, `-align`, `-before`, `-after` | a heading's font and spacing, with titlesec |
| `--tex8web-list-sep`, `--tex8web-item-sep` | list spacing; enumitem's lists have their own `--tex8web-enumitem-*` |
| `--tex8web-framed-sep` | the space above and below framed's boxes |
| `--tex8web-toc-<level>-indent`, `--tex8web-toc-<level>-number` | the table of contents' indents and number widths |
| `--tex8web-bg`, `--tex8web-text`, `--tex8web-link`, `--tex8web-cite`, `--tex8web-url` | the page's colors |
| `--tex8web-sans`, `--tex8web-mono` | the sans-serif and typewriter fonts |
| `--tcb-*` | a tcolorbox's frame, colors and spacing, on the box's element |

In a config's `\Css`, `@media (--tex8web-wide)` matches a wide screen, and `not (--tex8web-wide)` a narrow one.

## On the page

**Controls.** Small icons sit at the top left: the table of contents, the PDF (with `\WebPDF`), light or dark, and a link to tex8web. On a narrow screen they form a bar across the top. The bar names the section being read, and hides while the reader scrolls down.

**Theme.** The page follows the reader's light or dark setting until they choose one with the button. Their choice is kept in the browser, under `localStorage` key `tex8web-theme`, for every tex8web page on the site. A site can also set `data-theme="light"` or `"dark"` on the root element. Light mode uses the PDF's colors. In dark mode, the document's colors keep their hue: dark text becomes light, and light backgrounds become dark. TikZ pictures are inverted.

**Table of contents.** `\tableofcontents` moves out of the text. On a wide screen it sits beside the text; on a narrow one it opens as a drawer. It marks the section being read and shows the entries under it. Its indents and number widths come from tocloft or the class. A `\listoffigures` or `\listoftables` stays in the text.

**Finding.** A field at the top of the table of contents finds headings, numbered theorems and boxes, and terms (`\WebTerm`) as the reader types. Case, accents and math styles don't matter, and a Greek letter is found by its TeX name (`sigma` finds σ). The arrow keys and Enter choose a result.

**Headings** keep the PDF's sizes and the space after their numbers. With titlesec, each heading has its `\titleformat`'s font, alignment and label, and its `\titlespacing`.

**Footnotes** sit beside the paragraph, list or theorem that holds their mark on a wide screen, and below it on a narrow one. A footnote in a table, figure, box or formula stays at the end of the page.

**Previews.** Pointing at a reference, citation, footnote mark or section link shows what it points to in a card. The keyboard shows it too. On a touch screen, the first tap shows it and the second follows the link.

**Pictures.** Clicking a picture in a figure or a display, or any picture much taller than a line, opens it over the page. There the reader can zoom with the wheel, a pinch or a double-click, and drag it. Escape or a click beside it closes it.

**Links.** Each heading, numbered theorem, and tcolorbox with a title and a number or label has a `#` link to it in the margin, shown on hover. On a narrow screen, the heading or theorem's head is the link.

**Printing** gives the document alone, in light mode's colors, without the controls or the table of contents. Footnotes follow their paragraphs. The PDF is still the better copy to print: its page breaks and numbers are TeX's.

**Without JavaScript** the page still reads. The table of contents shows every entry, and the theme follows the system.

**Screen readers** hear each formula as MathJax's spoken English, such as "the fraction with numerator 1 and denominator 1 minus gamma". When MathJax typesets in the browser, they get MathML instead. An image's alt text is graphicx's `alt` key, or empty.

**Link previews** in chat apps and social sites show the document's title, and its abstract if it has one.

## Differences from the PDF

These are deliberate:

- The text is 12pt, larger than most PDFs, and everything else is in proportion. The column is as wide as the PDF's in ems.
- Paragraphs are separated by space instead of indented.
- A picture keeps its size as a narrower screen reflows the text. It shrinks only once the column is narrower than the picture.
- Minipages and subfigures that share a line in the PDF stay side by side at their PDF widths. On a narrow screen they wrap.
- Display math that doesn't fit scrolls sideways. On a narrow screen, so does a wide table or verbatim block.
- The table of contents has no page numbers or dot leaders.
- An index is in one column. Its numbers count the `\index` commands in order, since the page has no page numbers.
- Line spacing is the browser's, a little looser than TeX's.
- Dark mode has its own palette.

## Known limitations

Each item says what goes wrong and, where there is one, what to do.

- **`-B` with a `-` in its path.** make4ht reads the `-B` directory as a Lua pattern, so a `-` sends files to the wrong place. Keep `-B` relative to the document; `bin/tex8web` does.
- **Macros MathJax can't read** show in red. These include macros that parse their own arguments, such as comma-separated lists. Give MathJax a version with `\WebMathMacros`.
- **`\color` as a declaration**, as in `{\color{blue} text}`, is lost. `\textcolor{blue}{text}` works.
- **`\qedhere`.** The QED box follows the display instead of sitting at the right margin.
- **enumitem.** Labels are right-aligned and hang into the margin. `align=left`, `wide` and `itemindent` aren't followed.
- **A TikZ picture in display math**, such as a `tikzcd`, is drawn as a picture together with the rest of that display's math.
- **Delimiters and radicals** can differ slightly in size, since MathJax picks them from its own font.
- **tcolorbox.** Boxes get their colors, rules, corners, shadow, spacing and title. What a skin draws with TikZ, such as overlays and shadings, comes out as a plain frame. Pictures in side-by-side listing boxes aren't converted. If a fragile command in a box's title breaks the build, `\robustify` it in your config.
- **Colors in math.** A color whose name is passed to a macro as an argument isn't converted, nor is one defined inside a group. The models `hsb`, `Hsb`, `tHsb` and `wave` aren't supported. A color redefined later in the document has its last value everywhere in math.
- **Table colors.** With colortbl but not xcolor, `\textcolor` of the document's own colors is lost: load xcolor first. In a table with `\hline`, `\rowcolors` alternates wrongly.
- **Minipages.** A minipage inside a paragraph's text breaks the paragraph around it. `\centering` in a minipage is followed only in a figure. Two minipages, each in its own `\fbox`, stack.
- **Pictures' heights.** Only `\includegraphics`'s `width` is followed. With `height`, the picture keeps its proportions at a size that isn't the PDF's.
- **framed's `\FrameSep`.** A framed box has no padding between its rule and its text.
- **Chapters and parts.** A chapter's label, "Chapter 1", is tex4ht's. Part and chapter headings use report's and book's sizes, whatever the class.
- **Document classes tex4ht doesn't know**, such as Tufte-LaTeX, need a config of their own.
- **imakeidx's `program`** isn't followed: makeindex always runs. Its `splitindex` option isn't supported.
- **The page's controls are in English**, whatever the document's language. So is the speech for math, which reads some notation oddly: Δ as "normal triangle", `\mid` as "divides".
- **The browser's find-in-page** finds a formula's characters one at a time, but not a run of them such as `Δ(S)`.
- **A page opened from disk in Chrome** loads its fonts without preloading, and the console reports each preload as blocked.
- **Styles for `.mathjax-inline`** in a config apply only when MathJax typesets in the browser.
