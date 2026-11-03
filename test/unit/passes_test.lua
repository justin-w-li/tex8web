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

  ["text.no_break_spaces: a ~ kept with the math after it"] = function()
    local d = parse("<p>Lemma\u{A0}<span class=\"mathjax-inline\">\\(1\\)</span> and a\u{A0}b</p>")
    text.no_break_spaces(d)
    equal(body(d), "<p>Lemma<span class='tex8web-nowrap'><span class='tex8web-nbsp'>\u{A0}</span>"
      .. "<span class='mathjax-inline'>\\(1\\)</span></span> and a<span class='tex8web-nbsp'>\u{A0}</span>b</p>")
  end,

  ["page.build_data: the PDF and the macros, and the element removed"] = function()
    local d = parse("", [[<script type="text/x-tex8web-build" data-pdf="build/doc.pdf">\newcommand{\x}{x}</script>]])
    local context = {}
    page.build_data(d, context)
    equal(context, {pdf = "build/doc.pdf", macros = "\\newcommand{\\x}{x}"})
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
    page.controls(d, {})
    local nav = d:query_selector("nav#tex8web-toc")[1]
    equal(d:query_selector("#tex8web-toc-title")[1]:get_text(), "Contents")
    equal(#nav:query_selector("div.tableofcontents"), 1)
    equal(#d:query_selector("h3"), 1)
    equal(#d:query_selector("button.tex8web-contents"), 1)
    equal(#d:query_selector("a.tex8web-control"), 0)
  end,

  ["page.controls: a box that only holds the table of contents goes too"] = function()
    local d = parse([[<div class="tcolorbox" id="tcolobox-1"><div class="tcolorbox-title"><p>Outline</p></div>]]
      .. [[<div class="tcolorbox-content"><div class="tableofcontents"></div></div></div><p>Text</p>]])
    page.controls(d, {})
    equal(#d:query_selector("div.tcolorbox"), 0)
    equal(d:query_selector("#tex8web-toc-title")[1]:get_text(), "Outline")
    equal(#d:query_selector("nav#tex8web-toc div.tableofcontents"), 1)
    equal(#d:query_selector("p"), 2)
  end,

  ["page.controls: a numbered heading before the table of contents stays"] = function()
    local d = parse([[<h3 class="sectionHead" id="intro">1 Intro</h3><div class="tableofcontents"></div>]])
    page.controls(d, {})
    equal(#d:query_selector("h3"), 1)
    equal(d:query_selector("#tex8web-toc-title")[1]:get_text(), "Contents")
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
    local definitions = d:query_selector("div.tex8web-macros")[1]:get_text()
    check(definitions:find("\\newcommand{\\R}{\\mathbb{R}}", 1, true), definitions)
    check(definitions:find("\\newcommand{\\twice}{\\R\\R}", 1, true), definitions)
    check(not definitions:find("unused", 1, true), definitions)
    check(not definitions:find("\\bad", 1, true), definitions)
    check(logged[1]:find("\\bad (uses \\mathpalette)", 1, true), logged[1])
  end,
}
