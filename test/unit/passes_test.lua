-- The HTML passes, on small pages
local dom = require "luaxml-domobject"
local macros = require "tex8web.macros"
local page = require "tex8web.page"
local source = require "tex8web.source"
local text = require "tex8web.text"

local function parse(body, head)
  return dom.html_parse("<html><head><title>T</title>" .. (head or "") .. "</head><body>"
    .. body .. "</body></html>")
end

local function body(document)
  return document:query_selector("body")[1]:serialize()
    :gsub("^<body>", ""):gsub("</body>$", "")
end

local function tmpfile(content)
  local path = os.tmpname()
  local f = assert(io.open(path, "w"))
  f:write(content)
  f:close()
  return path
end

return {
  ["source.spaces: no space after a control word before a non-letter"] = function()
    local d = parse([[<span class="mathjax-inline">\(\abs [\big ]{x} \alpha b\)</span>]])
    source.spaces(d)
    equal(body(d), [[<span class='mathjax-inline'>\(\abs[\big]{x} \alpha b\)</span>]])
  end,

  ["text.theorem_spacing: the heading's spacing onto the theorem"] = function()
    local d = parse([[<div class="newtheorem"><p><span class="head">Theorem 1.<span class="tex8web-thmskip" data-before="1em" data-after="2em"></span></span> Text</p></div>]])
    text.theorem_spacing(d)
    equal(body(d), [[<div class='newtheorem' style='margin-top: 1em; margin-bottom: 2em'><p><span class='head'>Theorem 1.</span> Text</p></div>]])
  end,

  ["text.label_space: one space between a heading's number and its title"] = function()
    local d = parse([[<h3 class="sectionHead"><span class="titlemark">1    </span> <a id="x1-1"></a>Title</h3>]]
      .. [[<p><span class="paragraphHead"><span class="titlemark"><span class="b">a    </span></span> <a id="x1-2"></a>Head</span> Text</p>]]
      .. "<h4 class=\"subsectionHead\"><span class=\"titlemark\">1.1</span>\u{A0}\u{A0}<a id=\"x1-3\"></a>Sub</h4>"
      .. [[<h3 class="sectionHead"><span class="titlemark"></span><a id="x1-4"></a>Bare</h3>]])
    text.label_space(d)
    equal(body(d), [[<h3 class='sectionHead'><span class='titlemark'>1</span><span class='tex8web-labelsep'> </span><a id='x1-1'></a>Title</h3>]]
      .. [[<p><span class='paragraphHead'><span class='titlemark'><span class='b'>a</span></span><span class='tex8web-labelsep'> </span><a id='x1-2'></a>Head</span> Text</p>]]
      .. [[<h4 class='subsectionHead'><span class='titlemark'>1.1</span><span class='tex8web-labelsep'> </span><a id='x1-3'></a>Sub</h4>]]
      .. [[<h3 class='sectionHead'><span class='titlemark'></span><a id='x1-4'></a>Bare</h3>]])
  end,

  ["text.no_break_spaces: a ~ kept with the math after it"] = function()
    local d = parse("<p>Lemma\u{A0}<span class=\"mathjax-inline\">\\(1\\)</span> and a\u{A0}b</p>")
    text.no_break_spaces(d)
    equal(body(d), "<p>Lemma<span class='tex8web-nowrap'><span class='tex8web-nbsp'>\u{A0}</span>"
      .. "<span class='mathjax-inline'>\\(1\\)</span></span> and a<span class='tex8web-nbsp'>\u{A0}</span>b</p>")
  end,

  ["text.minipages: each line of minipages and subfigures in a row, nested ones too, without \\noindent's empty paragraph"] = function()
    local d = parse([[<div class="minipage tex8web-par tex8web-minipage-t">A</div> <span class="tex8web-nbsp">]]
      .. "\u{A0}" .. [[</span><div class="subfigure tex8web-minipage-b">]]
      .. [[<div class="minipage tex8web-par tex8web-minipage-c">B</div></div>]]
      .. [[<div class="minipage tex8web-par tex8web-minipage-c">C</div><p class="noindent"></p>]]
      .. [[<div class="minipage tex8web-minipage-c">D</div><div class="minipage-like">E</div>]])
    text.minipages(d)
    equal(body(d), [[<div class='tex8web-minipages'><div class='minipage tex8web-par tex8web-minipage-t'>A</div>]]
      .. [[<div class='subfigure tex8web-minipage-b'><div class='tex8web-minipages'>]]
      .. [[<div class='minipage tex8web-par tex8web-minipage-c'>B</div></div></div></div>]]
      .. [[<div class='tex8web-minipages'><div class='minipage tex8web-par tex8web-minipage-c'>C</div></div>]]
      .. [[<div class='tex8web-minipages'><div class='minipage tex8web-minipage-c'>D</div></div><div class='minipage-like'>E</div>]])
  end,

  ["text.sidenotes: each footnote after its block, in order, unless in a box"] = function()
    local function mark(n) return ([[<span class="footnote-mark"><a href="#fnNx0" id="fnNx0-bk">N</a></span>]]):gsub("N", n) end
    local function note(n, text)
      return ([[<aside class="footnotetext"><p><span class="footnote-mark"><a href="#fnNx0-bk" id="fnNx0">N</a></span>]]):gsub("N", n)
        .. text .. "</p></aside>"
    end
    local d = parse([[<div class="maketitle"><h1>T</h1></div>]]
      .. "<p>One" .. mark(1) .. " and" .. mark(2) .. "</p>"
      .. [[<div class="newtheorem"><p>Two]] .. mark(3) .. "</p></div>"
      .. [[<div class="tcolorbox"><p>Box]] .. mark(4) .. "</p></div>"
      .. [[<div class="footnotes"><p><a id="tk-1"></a>Thanks.</p>]]
      .. note(1, "First") .. note(2, "Second") .. note(3, "Third") .. note(4, "Fourth") .. "</div>")
    text.sidenotes(d)
    local order = {}
    for _, el in ipairs(require("tex8web.dom").elements(d:query_selector("body")[1])) do
      order[#order + 1] = el:get_text():gsub("%d", "")
    end
    equal(table.concat(order, "|"), "TThanks.|One and|First|Second|Two|Third|Box|Fourth")
    equal(#d:query_selector("div.maketitle div.thanks"), 1)
  end,

  ["text.sidenotes: the emptied footnotes go"] = function()
    local d = parse([[<p>One<span class="footnote-mark"><a href="#fn1x0" id="fn1x0-bk">1</a></span></p>]]
      .. [[<div class="footnotes"><aside class="footnotetext"><p><span class="footnote-mark">]]
      .. [[<a href="#fn1x0-bk" id="fn1x0">1</a></span>First</p></aside></div>]])
    text.sidenotes(d)
    equal(#d:query_selector("div.footnotes"), 0)
    equal(d:query_selector("aside")[1]:get_attribute("class"), "footnotetext tex8web-sidenote")
  end,

  ["page.build_data: the PDF, \\contentsname and the macros, and the element removed"] = function()
    local d = parse("", [[<script type="text/x-tex8web-build" data-pdf="build/doc.pdf" data-contents="Table des matières">\newcommand{\x}{x}</script>]])
    local context = {}
    page.build_data(d, context)
    equal(context, {pdf = "build/doc.pdf", contents = "Table des matières", macros = "\\newcommand{\\x}{x}"})
    equal(#d:query_selector("script"), 0)
    local e = parse("", [[<script type="text/x-tex8web-build" data-pdf=""></script>]])
    local none = {}
    page.build_data(e, none)
    equal(none.pdf, nil)
  end,

  ["page.permalinks: a # before headings and numbered theorems"] = function()
    local d = parse([[<h3 class="sectionHead" id="intro"><a id="x1-1"></a>Intro</h3>]]
      .. [[<div class="newtheorem"><p><span class="head"><a id="x1-2"></a>Lemma 1.</span></p></div>]]
      .. [[<div class="newtheorem"><p><span class="head">Remark.</span></p></div>]])
    page.permalinks(d)
    local links = d:query_selector("a.tex8web-permalink")
    equal(#links, 2)
    equal(links[1]:get_attribute("href"), "#x1-1")
    equal(links[2]:get_attribute("href"), "#x1-2")
  end,

  ["page.controls: the table of contents beside the text, its heading as its title"] = function()
    local d = parse([[<h3 class="likesectionHead" id="contents"><a id="x1-1"></a>Contents</h3>]]
      .. [[<div class="tableofcontents"><span class="sectionToc"><a href="#intro">Intro</a></span></div>]]
      .. [[<h3 class="sectionHead" id="intro">Intro</h3>]])
    page.controls(d, {contents = "Table of Contents"})
    local nav = d:query_selector("nav#tex8web-toc")[1]
    equal(d:query_selector("#tex8web-toc-title")[1]:get_text(), "Contents")
    equal(#nav:query_selector("div.tableofcontents"), 1)
    equal(#d:query_selector("h3"), 1)
    equal(d:query_selector("button.tex8web-contents")[1]:get_attribute("aria-label"), "Contents")
    equal(#d:query_selector("a.tex8web-control"), 0)
  end,

  ["page.controls: the table of contents, not a list of figures before it"] = function()
    local d = parse([[<h3 class="likesectionHead">List of Figures</h3>]]
      .. [[<div class="tableofcontents"><span class="lofToc">1 <a href="#f">F</a></span></div>]]
      .. [[<h3 class="likesectionHead">Contents</h3>]]
      .. [[<div class="tableofcontents"><span class="subsectionToc"><a href="#s">S</a></span></div>]])
    page.controls(d, {contents = "Contents"})
    equal(#d:query_selector("nav#tex8web-toc span.subsectionToc"), 1)
    equal(d:query_selector("#tex8web-toc-title")[1]:get_text(), "Contents")
    equal(#d:query_selector("body > div.tableofcontents span.lofToc"), 1)
    equal(d:query_selector("h3")[1]:get_text(), "List of Figures")
  end,

  ["page.controls: a box that only holds the table of contents goes too"] = function()
    local d = parse([[<div class="tcolorbox" id="tcolobox-1"><div class="tcolorbox-title"><p>Outline</p></div>]]
      .. [[<div class="tcolorbox-content"><div class="tableofcontents"><span class="sectionToc"></span></div></div></div><p>Text</p>]])
    page.controls(d, {contents = "Contents"})
    equal(#d:query_selector("div.tcolorbox"), 0)
    equal(d:query_selector("#tex8web-toc-title")[1]:get_text(), "Outline")
    equal(#d:query_selector("nav#tex8web-toc div.tableofcontents"), 1)
    equal(#d:query_selector("p"), 2)
  end,

  ["page.controls: a numbered heading before the table of contents stays, and \\contentsname titles it"] = function()
    local d = parse([[<h3 class="sectionHead" id="intro">1 Intro</h3>]]
      .. [[<div class="tableofcontents"><span class="chapterToc"></span></div>]])
    page.controls(d, {contents = "Table des matières"})
    equal(#d:query_selector("h3"), 1)
    equal(d:query_selector("#tex8web-toc-title")[1]:get_text(), "Table des matières")
    equal(d:query_selector("button.tex8web-contents")[1]:get_attribute("title"), "Table des matières")
  end,

  ["page.controls: a warning, and no PDF control, without the PDF"] = function()
    local d = parse("<p>Text</p>")
    page.controls(d, {pdf = "no/such.pdf"})
    equal(#d:query_selector("a.tex8web-control"), 0)
    check(logged[1]:find("no/such.pdf", 1, true), logged[1])
  end,

  ["page.controls: no table of contents, no contents button"] = function()
    local d = parse("<p>Text</p>")
    page.controls(d, {})
    equal(#d:query_selector("nav"), 0)
    equal(#d:query_selector("p"), 1)
    equal(#d:query_selector("button.tex8web-contents"), 0)
    equal(#d:query_selector("button.tex8web-theme"), 1)
  end,

  ["page.meta_tags: title, and the abstract cut at a word"] = function()
    local long = string.rep("word ", 60)
    local d = parse([[<div class="abstract"><h3>Abstract</h3><p>About \(x\) and ]] .. long .. [[</p></div>]])
    page.meta_tags(d)
    local function meta(attribute, name)
      return d:query_selector("meta[" .. attribute .. "='" .. name .. "']")[1]:get_attribute("content")
    end
    equal(meta("property", "og:title"), "T")
    local description = meta("name", "description")
    check(description:match("^About x and word"), description)
    check(description:match(" word…$"), description)
    check(utf8.len(description) <= 200, "too long: " .. utf8.len(description))
  end,

  ["macros.define: the definitions the math uses, and a warning for the rest"] = function()
    local tex = tmpfile([[\newcommand{\R}{\mathbb{R}}
\newcommand{\unused}{u}
\newcommand{\bad}{\mathpalette\x{}}
\newcommand{\twice}{\R\R}]])
    local d = parse([[<span class="mathjax-inline">\(\twice \bad\)</span>]])
    macros.define(d, {tex_file = tex, macros = [[\newcommand{\override}{o}]]})
    os.remove(tex)
    local div = d:query_selector("body > div#tex8web-macros")[1]
    local definitions = div:get_text()
    check(not definitions:find("\\(", 1, true), definitions)
    check(definitions:find("\\newcommand{\\R}{\\mathbb{R}}", 1, true), definitions)
    check(definitions:find("\\newcommand{\\twice}{\\R\\R}", 1, true), definitions)
    check(not definitions:find("unused", 1, true), definitions)
    check(not definitions:find("\\bad", 1, true), definitions)
    check(logged[1]:find("\\bad (uses \\mathpalette)", 1, true), logged[1])
  end,

  ["page.meta_tags: an abstract without spaces cut at 197 characters"] = function()
    local d = parse([[<div class="abstract"><p>]] .. string.rep("字", 250) .. [[</p></div>]])
    page.meta_tags(d)
    local description = d:query_selector("meta[name='description']")[1]:get_attribute("content")
    equal(description, string.rep("字", 197) .. "…")
  end,

  ["text.theorem_spacing: a theorem with another class too"] = function()
    local d = parse([[<div class="newtheorem lemma"><p><span class="head">Lemma 1.<span class="tex8web-thmskip" data-before="1em" data-after="2em"></span></span></p></div>]])
    text.theorem_spacing(d)
    equal(d:query_selector("div")[1]:get_attribute("style"), "margin-top: 1em; margin-bottom: 2em")
  end,
}
