-- The HTML passes, on small pages
local dom = require "luaxml-domobject"
local macros = require "tex8web.macros"
local page = require "tex8web.page"
local prerender = require "tex8web.prerender"
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

  ["text.heading_lists: no empty paragraph between a heading and a list, only there"] = function()
    local d = parse([[<h3>A</h3><p class="noindent">]] .. "\n " .. [[</p><ol><li>a</li></ol>]]
      .. [[<h3>B</h3><p>Text</p><ol><li>b</li></ol><p> </p><dl><dt>c</dt></dl>]])
    text.heading_lists(d)
    equal(body(d), [[<h3>A</h3><ol><li>a</li></ol>]]
      .. [[<h3>B</h3><p>Text</p><ol><li>b</li></ol><p> </p><dl><dt>c</dt></dl>]])
  end,

  ["text.same_page_links: links to the page by its name within it"] = function()
    local d = parse([[<a href="main.html#X0-key">1</a><a href="main.html" id="X0-"></a>]]
      .. [[<a href="other.html#x">2</a><a href="#y">3</a>]])
    text.same_page_links(d, {input = "main"})
    equal(body(d), [[<a href='#X0-key'>1</a><a id='X0-'></a><a href='other.html#x'>2</a><a href='#y'>3</a>]])
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

  ["text.hfill: the rest of each line after its last \\hfill in a span, up to a <br>, a block or a display"] = function()
    local mark = [[<span class="tex8web-hfill-mark"></span>]]
    local d = parse("<p>Name " .. mark .. " Date</p>"
      .. "<p>a " .. mark .. "b " .. mark .. " <b>c</b><br />d " .. mark .. " e<br />f</p>"
      .. "<dd>g " .. mark .. " <br />h " .. mark .. " <div>i</div>j " .. mark
      .. [[<span class="mathjax-block">\[x\]</span></dd>]])
    text.hfill(d)
    equal(body(d), "<p>Name <span class='tex8web-hfill'> Date</span></p>"
      .. "<p>a b <span class='tex8web-hfill'> <b>c</b></span><br />d <span class='tex8web-hfill'> e</span><br />f</p>"
      .. "<dd>g  <br />h  <div>i</div>j <span class='mathjax-block'>\\[x\\]</span></dd>")
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

  ["text.colors: a declaration's color in spans, nested"] = function()
    local d = parse([[<p>A <span class="tex8web-color" data-id="1" data-color="#FF0000"></span>red<span class="tex8web-color-end" data-id="1"></span> word, ]]
      .. [[<span class="tex8web-color" data-id="2" data-color="#FF0000"></span>Red, <span class="cmti-10"><span class="tex8web-color" data-id="3" data-color="#000000"></span>black,<span class="tex8web-color-end" data-id="3"></span></span> red<span class="tex8web-color-end" data-id="2"></span>, after</p>]])
    text.colors(d)
    equal(body(d), [[<p>A <span style='color:#FF0000;'>red</span> word, ]]
      .. [[<span style='color:#FF0000;'>Red, <span class='cmti-10'><span style='color:#000000;'>black,</span></span> red</span>, after</p>]])
  end,

  ["text.colors: across paragraphs, a block on itself, not into a tcolorbox or a float"] = function()
    local d = parse([[<span class="tex8web-color" data-id="1" data-color="#0A7828"></span>]] .. "\n"
      .. [[<p style="margin: 0">First.</p>]] .. "\n" .. [[<ul><li>One.</li></ul><div class="tcolorbox"><p>Box.</p></div>]]
      .. [[<figure class="figure"><p>Float.</p></figure><p>Second.<span class="tex8web-color-end" data-id="1"></span></p><p>After.</p>]])
    text.colors(d)
    equal(body(d), "\n" .. [[<p style='margin: 0; color:#0A7828;'>First.</p>]] .. "\n"
      .. [[<ul style='color:#0A7828;'><li>One.</li></ul><div class='tcolorbox'><p>Box.</p></div>]]
      .. [[<figure class='figure'><p>Float.</p></figure><p><span style='color:#0A7828;'>Second.</span></p><p>After.</p>]])
  end,

  ["text.colors: an inner color wins on a block, also inside a color left open"] = function()
    local d = parse([[<p><span class="tex8web-color" data-id="1" data-color="#FF0000"></span>Red.</p>]]
      .. [[<span class="tex8web-color" data-id="2" data-color="#0000FF"></span><ul><li>b</li></ul><span class="tex8web-color-end" data-id="2"></span>]]
      .. [[<p>more<span class="tex8web-color-end" data-id="1"></span></p>]]
      .. [[<span class="tex8web-color" data-id="3" data-color="#00FF00"></span><span class="tex8web-color" data-id="4" data-color="#0000FF"></span>]]
      .. [[<ul><li>c</li></ul><span class="tex8web-color-end" data-id="4"></span><p>green</p>]])
    text.colors(d)
    equal(body(d), [[<p><span style='color:#FF0000;'>Red.</span></p><ul style='color:#0000FF;'><li>b</li></ul>]]
      .. [[<p><span style='color:#FF0000;'>more</span></p><ul style='color:#0000FF;'><li>c</li></ul><p style='color:#00FF00;'>green</p>]])
  end,

  ["text.colors: a color set in a tcolorbox, whose end tex4ht puts after the box"] = function()
    local d = parse([[<div class="tcolorbox"><div class="tcolorbox-content"><p><span class="tex8web-color" data-id="1" data-color="#FF0000"></span>text</p></div></div>]]
      .. [[<span class="tex8web-color-end" data-id="1"></span><p>After.</p>]])
    text.colors(d)
    equal(body(d), [[<div class='tcolorbox'><div class='tcolorbox-content'><p><span style='color:#FF0000;'>text</span></p></div></div><p>After.</p>]])
  end,

  ["text.colors: no span for a ~ alone between minipages"] = function()
    local d = parse([[<span class="tex8web-color" data-id="1" data-color="#FF0000"></span><div class="minipage">a</div>]]
      .. "\u{A0}" .. [[<div class="minipage">b</div><span class="tex8web-color-end" data-id="1"></span>]])
    text.colors(d)
    equal(body(d), [[<div class='minipage' style='color:#FF0000;'>a</div>]] .. "\u{A0}"
      .. [[<div class='minipage' style='color:#FF0000;'>b</div>]])
  end,

  ["text.colors: a color set in a link ends with it; one left open, with the page"] = function()
    local d = parse([[<p><a href="#h"><span class="tex8web-color" data-id="1" data-color="#FF0000"></span>linked</a> after.<span class="tex8web-color-end" data-id="1"></span></p>]]
      .. [[<p>Black <span class="tex8web-color" data-id="2" data-color="#0000FF"></span>blue</p><p>Blue.</p>]])
    text.colors(d)
    equal(body(d), [[<p><a href='#h'><span style='color:#FF0000;'>linked</span></a> after.</p>]]
      .. [[<p>Black <span style='color:#0000FF;'>blue</span></p><p style='color:#0000FF;'>Blue.</p>]])
  end,

  ["text.colors: an end before its start ends nothing, and colors nothing"] = function()
    local d = parse([[<p>a<span class="tex8web-color-end" data-id="1"></span> <span class="tex8web-color" data-id="1" data-color="#FF0000"></span>raw</p><p>After.</p>]])
    text.colors(d)
    equal(body(d), [[<p>a raw</p><p>After.</p>]])
  end,

  ["text.colors: a box used twice, both colored; a table float in the text's color"] = function()
    local d = parse([[<p><span class="tex8web-color" data-id="1" data-color="#00FF00"></span>saved<span class="tex8web-color-end" data-id="1"></span> and ]]
      .. [[<span class="tex8web-color" data-id="1" data-color="#00FF00"></span>saved<span class="tex8web-color-end" data-id="1"></span></p>]]
      .. [[<span class="tex8web-color" data-id="2" data-color="#FF0000"></span><div class="table"><figure class="float">T</figure></div><p>Red.<span class="tex8web-color-end" data-id="2"></span></p>]])
    text.colors(d)
    equal(body(d), [[<p><span style='color:#00FF00;'>saved</span> and <span style='color:#00FF00;'>saved</span></p>]]
      .. [[<div class='table'><figure class='float'>T</figure></div><p><span style='color:#FF0000;'>Red.</span></p>]])
  end,

  ["text.colors: none in the page's title or in listings, and no paragraph left for a mark"] = function()
    local d = parse([[<p><span class="tex8web-color" data-id="2" data-color="#FF0000"></span></p><p class="indent">Red.<span class="tex8web-color-end" data-id="2"></span></p>]]
      .. [[<pre class="lstlisting"><span class="tex8web-color" data-id="3" data-color="#0000FF"></span><span style="color:#0000FF">if</span><span class="tex8web-color-end" data-id="3"></span> x</pre>]],
      [[<span class="tex8web-color" data-id="1" data-color="#FF0000"></span>]])
    text.colors(d)
    equal(#d:query_selector("head span"), 0)
    equal(body(d), [[<p class='indent'><span style='color:#FF0000;'>Red.</span></p>]]
      .. [[<pre class='lstlisting'><span style='color:#0000FF'>if</span> x</pre>]])
  end,

  ["page.build_data: the PDF, the fonts, \\contentsname and the macros, and the elements removed"] = function()
    local d = parse("", [[<script type="text/x-tex8web-build" data-pdf="build/doc.pdf" data-fonts="phv ptm phv pcr">\newcommand{\x}{x}</script>]]
      .. [[<script type="text/x-tex8web-contents">
Table des
matières </script>]] .. [[<script type="text/x-tex8web-colors">ink 0.78432,0,0.39216 </script>]])
    local context = {}
    page.build_data(d, context)
    equal(context, {pdf = "build/doc.pdf", contents = "Table des matières", macros = "\\newcommand{\\x}{x}",
      colors = "ink 0.78432,0,0.39216 ", families = {body = "phv", roman = "ptm", sans = "phv", mono = "pcr"}})
    equal(#d:query_selector("script"), 0)
    local e = parse("", [[<script type="text/x-tex8web-build" data-pdf=""></script>]]
      .. [[<script type="text/x-tex8web-contents">Contents</script>]]
      .. [[<script type="text/x-tex8web-colors"></script>]])
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

  ["page.terms: an id from each term's text, without its math, once each"] = function()
    local d = parse([[<span class="tex8web-term">Inner product</span>]]
      .. [[<span class="tex8web-term"><span class="mathjax-inline">\(\sigma\)</span>-algebra</span>]]
      .. [[<span class="tex8web-term">inner  product</span>]]
      .. [[<span class="tex8web-term"><span class="mathjax-inline">\(L^2\)</span></span>]]
      .. [[<span class="tex8web-term">Hölder's inequality</span>]])
    page.terms(d)
    local ids = {}
    for _, term in ipairs(d:query_selector("span.tex8web-term")) do ids[#ids + 1] = term:get_attribute("id") end
    equal(ids, {"term-inner-product", "term-algebra", "term-inner-product-2", "term", "term-hölder-s-inequality"})
  end,

  ["page.permalinks: a # in the title of a box with an anchor of its own, its last"] = function()
    local d = parse([[<div class="tcolorbox" id="tcolobox-1"><a id="x1-2x"></a><a id="x1-2xdoc"></a>]]
      .. [[<div class="tcolorbox-title"><p>Theorem 1</p></div><div class="tcolorbox-content"></div></div>]]
      .. [[<div class="tcolorbox" id="tcolobox-2"><div class="tcolorbox-title"><p>Box</p></div>]]
      .. [[<div class="tcolorbox-content"><div class="tcolorbox" id="tcolobox-3"><a id="x1-3x1"></a>]]
      .. [[<div class="tcolorbox-content"><p>Untitled</p></div></div></div></div>]])
    page.permalinks(d)
    local links = d:query_selector("a.tex8web-permalink")
    equal(#links, 1)
    equal(links[1]:get_attribute("href"), "#x1-2xdoc")
    equal(links[1]:get_parent():get_attribute("class"), "tcolorbox-title")
  end,

  ["page.controls: the table of contents beside the text, its heading as its title"] = function()
    local d = parse([[<h3 class="likesectionHead" id="contents"><a id="x1-1"></a>Contents</h3>]]
      .. [[<div class="tableofcontents"><span class="sectionToc"><a href="#intro">Intro</a></span></div>]]
      .. [[<h3 class="sectionHead" id="intro">Intro</h3>]])
    page.controls(d, {contents = "Table of Contents"})
    local nav = d:query_selector("nav#tex8web-toc")[1]
    equal(d:query_selector("#tex8web-toc-title")[1]:get_text(), "Contents")
    equal(#nav:query_selector("div.tableofcontents"), 1)
    equal(#nav:query_selector("input.tex8web-toc-filter"), 1)
    equal(#d:query_selector("h3"), 1)
    equal(d:query_selector("button.tex8web-contents")[1]:get_attribute("aria-label"), "Contents")
    equal(#d:query_selector("button.tex8web-where[hidden]"), 1)
    equal(#d:query_selector("a.tex8web-control"), 1)
    equal(d:query_selector("a.tex8web-control")[1]:get_attribute("href"), "https://github.com/justin-w-li/tex8web")
  end,

  ["page.controls: a title on several lines, as TeX broke it, on one"] = function()
    local d = parse([[<h3 class="likesectionHead">Table of]] .. "\n" .. [[Contents</h3>]]
      .. [[<div class="tableofcontents"><span class="sectionToc"><a href="#intro">Intro</a></span></div>]])
    page.controls(d, {contents = "Contents"})
    equal(d:query_selector("button.tex8web-contents")[1]:get_attribute("aria-label"), "Table of Contents")
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
    equal(#d:query_selector("a.tex8web-control"), 1)
    check(logged[1]:find("no/such.pdf", 1, true), logged[1])
  end,

  ["page.controls: no table of contents, no contents button"] = function()
    local d = parse("<p>Text</p>")
    page.controls(d, {})
    equal(#d:query_selector("nav"), 0)
    equal(#d:query_selector("p"), 1)
    equal(#d:query_selector("button.tex8web-contents"), 0)
    equal(#d:query_selector("button.tex8web-where"), 0)
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

  ["page.meta_tags: no og:title for an empty title"] = function()
    local d = dom.html_parse("<html><head><title> </title></head><body><p>a</p></body></html>")
    page.meta_tags(d)
    equal(#d:query_selector("meta[property='og:title']"), 0)
  end,

  ["prerender.run: without node_modules, a warning that the browser typesets the math"] = function()
    local root, skip = os.tmpname(), os.getenv("TEX8WEB_NO_PRERENDER")
    os.remove(root)
    lfs.mkdir(root)
    os.setenv("TEX8WEB_NO_PRERENDER", nil)
    local result = prerender.run({root = root}, "x.html")
    os.setenv("TEX8WEB_NO_PRERENDER", skip)
    lfs.rmdir(root)
    equal(result, false)
    check(logged[1] and logged[1]:find("^warning: math left for MathJax in the browser"),
      logged[1] or "nothing logged")
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

  ["macros.define: colors MathJax lacks (a document's, xcolor's, a mix), not those it has"] = function()
    local tex = tmpfile([[\newcommand{\warm}[1]{\textcolor{ink!50!yellow}{#1}}]])
    local d = parse([[<span class="mathjax-inline">\(\textcolor{ink}{a}\textcolor{red}{b}\textcolor{green}{c}]]
      .. [[\textcolor{red!50}{d}\fcolorbox{black}{teal}{e}\warm{f}\textcolor{nope!50}{g}\)</span>]]
      .. [[<span class="mathjax-inline">\(\textcolor{gray!50}{h}\textcolor{ink!50!yellow!50}{i}\textcolor{-ink}{j}]]
      .. [[\textcolor{-red!50!black}{k}\textcolor{red!50!-blue}{l}\textcolor{--ink}{m}\textcolor{red!150!black}{n}\textcolor{red!150}{o}\)</span>]])
    macros.define(d, {tex_file = tex, colors = "ink 0.78432,0,0.39216 red 1,0,0 black 0,0,0 green 0,1,0 "
      .. "teal 0,0.5,0.5 yellow 1,1,0 gray 0.5,0.5,0.5 blue 0,0,1 "})
    os.remove(tex)
    local definitions = d:query_selector("body > div#tex8web-macros")[1]:get_text()
    for _, line in ipairs({"\\definecolor{ink}{RGB}{200,0,100}", "\\definecolor{green}{RGB}{0,255,0}",
        "\\definecolor{teal}{RGB}{0,128,128}", "\\definecolor{red!50}{RGB}{255,128,128}",
        "\\definecolor{ink!50!yellow}{RGB}{228,128,50}",
        -- (as xcolor has them: mixed unrounded, a complement of the whole, a share past 100 held at the end)
        "\\definecolor{gray!50}{RGB}{191,191,191}", "\\definecolor{ink!50!yellow!50}{RGB}{241,191,152}",
        "\\definecolor{-ink}{RGB}{55,255,155}", "\\definecolor{-red!50!black}{RGB}{128,255,255}",
        "\\definecolor{red!50!-blue}{RGB}{255,128,0}", "\\definecolor{--ink}{RGB}{200,0,100}",
        "\\definecolor{red!150!black}{RGB}{255,0,0}", "\\definecolor{red!150}{RGB}{255,0,0}"}) do
      check(definitions:find(line, 1, true), line .. " in " .. definitions)
    end
    check(not definitions:find("{red}", 1, true) and not definitions:find("{black}", 1, true), definitions)
    check(not definitions:find("nope", 1, true), definitions)
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

  ["text.no_break_spaces: none in verbatim, code or listings"] = function()
    local d = parse("<pre>a\u{A0}b <span>c\u{A0}d</span></pre><code>e\u{A0}f</code>"
      .. "<div class=\"lstlisting\"><span>g\u{A0}h</span></div><p>i\u{A0}j</p>")
    text.no_break_spaces(d)
    equal(#d:query_selector("span.tex8web-nbsp"), 1)
    equal(d:query_selector("p span.tex8web-nbsp")[1] ~= nil, true)
  end,

  ["text.minipages: tex4ht's whitespace around \\noindent's empty paragraph, and a raw ~ between minipages"] = function()
    local d = parse("<!--  l. 9  --><p class='noindent'>\n</p>\n"
      .. [[<div class="minipage tex8web-minipage-c">A</div>]] .. "\u{A0}" .. [[<div class="minipage tex8web-minipage-c">B</div>]])
    text.minipages(d)
    equal(body(d), "<!--   l. 9   -->\n<div class='tex8web-minipages'><div class='minipage tex8web-minipage-c'>A</div>"
      .. "<div class='minipage tex8web-minipage-c'>B</div></div>")
  end,

  ["text.heading_lists: the empty paragraph with a comment in it, and a cached parent's later lists"] = function()
    local d = parse("<h3>A</h3><p class=\"noindent\">\n<!--  l. 3  --></p>\n<ol><li>a</li></ol>"
      .. "<h3>B</h3><p></p><ul><li>b</li></ul><p>x</p><ul><li>c</li></ul>")
    text.heading_lists(d)
    equal(body(d), "<h3>A</h3>\n<ol><li>a</li></ol><h3>B</h3><ul><li>b</li></ul><p>x</p><ul><li>c</li></ul>")
  end,

  ["text.sidenotes: many footnotes in time"] = function()
    local marks, notes = {}, {}
    for n = 1, 300 do
      marks[#marks + 1] = ([[<p>]] .. string.rep("<span>filler</span>", 30) .. [[Text<span class="footnote-mark"><a href="#fnNx0" id="fnNx0-bk">N</a></span></p>]]):gsub("N", n)
      notes[#notes + 1] = ([[<aside class="footnotetext"><p><span class="footnote-mark"><a href="#fnNx0-bk" id="fnNx0">N</a></span>Note</p></aside>]]):gsub("N", n)
    end
    local d = parse(table.concat(marks) .. [[<div class="footnotes">]] .. table.concat(notes) .. "</div>")
    local start = os.clock()
    text.sidenotes(d)
    equal(#d:query_selector("aside.tex8web-sidenote"), 300)
    check(os.clock() - start < 3, "took " .. (os.clock() - start) .. " s")
  end,

  ["page.permalinks: every heading level, in one pass"] = function()
    local d = parse([[<h2><a id="a2"></a>T</h2><h4><a id="a4"></a>T</h4><h6><a id="a6"></a>T</h6><h1><a id="a1"></a>T</h1>]])
    page.permalinks(d)
    equal(#d:query_selector("a.tex8web-permalink"), 3)
  end,

  ["text.theorem_spacing: after a color's style, joined with a semicolon"] = function()
    local d = parse([[<div class="newtheorem" style="color:#FF0000;"><p><span class="head">Lemma 1.<span class="tex8web-thmskip" data-before="1em" data-after="2em"></span></span></p></div>]]
      .. [[<div class="newtheorem" style="color:#00FF00"><p><span class="head">Lemma 2.<span class="tex8web-thmskip" data-before="1em" data-after="2em"></span></span></p></div>]])
    text.theorem_spacing(d)
    equal(d:query_selector("div")[1]:get_attribute("style"), "color:#FF0000; margin-top: 1em; margin-bottom: 2em")
    equal(d:query_selector("div")[2]:get_attribute("style"), "color:#00FF00; margin-top: 1em; margin-bottom: 2em")
  end,

  ["dom.has_class: whole class names; class_starts: a prefix of one"] = function()
    local dom = require "tex8web.dom"
    local d = parse([[<div class="newtheorem lemma"></div><div class="newtheoremx"></div>]]
      .. [[<div class="a-newtheorem"></div><div class="tcolorbox-title x"></div>text<div></div>]])
    local divs = d:query_selector("div")
    equal({dom.has_class(divs[1], "newtheorem"), dom.has_class(divs[1], "lemma"), dom.has_class(divs[1], "newtheo")},
      {true, true, false})
    equal({dom.has_class(divs[2], "newtheorem"), dom.has_class(divs[3], "newtheorem")}, {false, false})
    equal({dom.class_starts(divs[4], "tcolorbox"), dom.class_starts(divs[4], "x"), dom.class_starts(divs[4], "title")},
      {true, true, false})
    equal(dom.has_class(divs[5], "x"), false)
    equal(dom.has_class(d:query_selector("body")[1]:get_children()[5], "x"), false)
  end,

  ["dom.is_blank: no element and no text but space"] = function()
    local dom = require "tex8web.dom"
    local d = parse([[<p> </p><p>
<!-- c --></p><p>a</p><p><b></b></p>]])
    local ps = d:query_selector("p")
    equal({dom.is_blank(ps[1]), dom.is_blank(ps[2]), dom.is_blank(ps[3]), dom.is_blank(ps[4])},
      {true, true, false, false})
  end,
}
