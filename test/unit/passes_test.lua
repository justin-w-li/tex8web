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

  ["text.sized_math_spaces: the space after a sized formula in its span"] = function()
    local d = parse([[<p><span class="cmr-9">a </span><span class="mathjax-inline" style="--tex8web-math-size: 0.9">\(x\)</span> <span class="cmr-9">b</span> <span class="mathjax-inline">\(y\)</span> c</p>]])
    text.sized_math_spaces(d)
    equal(body(d), [[<p><span class='cmr-9'>a </span><span class='mathjax-inline' style='--tex8web-math-size: 0.9'>\(x\) </span><span class='cmr-9'>b</span> <span class='mathjax-inline'>\(y\)</span> c</p>]])
  end,

  ["text.block_spacing: the heading's spacing onto the theorem"] = function()
    local d = parse([[<div class="newtheorem"><p><span class="head">Theorem 1.<span class="tex8web-thmskip" data-before="1em" data-after="2em"></span></span> Text</p></div>]])
    text.block_spacing(d)
    equal(body(d), [[<div class='newtheorem' style='margin-top: 1em; margin-bottom: 2em'><p><span class='head'>Theorem 1.</span> Text</p></div>]])
  end,

  ["text.block_spacing: a caption's skips onto the caption, swapped at the top"] = function()
    local mark = [[<span class="tex8web-capskip" data-above="0.8em" data-below="0em" data-position="%s"></span>]]
    local d = parse(([[<figure class="figure"><span id="a"></span><p><img src="a.png" /></p>]]
      .. [[<figcaption class="caption"><span class="content">]] .. mark .. [[A</span></figcaption></figure>]]
      .. [[<div class="table"><p><a id="b"></a></p><figure class="float"> <figcaption class="caption">]] .. mark
      .. [[B</figcaption><div class="tabular"><table></table></div></figure></div>]]
      .. [[<figure class="figure"><div class="subfigure"><p><img src="c.png" /></p><div class="caption">]] .. mark
      .. [[C</div></div><figcaption class="caption">]] .. mark .. [[D</figcaption></figure>]])
      :format("bottom", "auto", "auto", "top"))
    text.block_spacing(d)
    local styles = {}
    for _, caption in ipairs(d:query_selector(".caption")) do styles[#styles + 1] = caption:get_attribute("style") end
    equal(styles, {"--tex8web-caption-before: 0.8em; --tex8web-caption-after: 0em",
      "--tex8web-caption-before: 0em; --tex8web-caption-after: 0.8em",
      "--tex8web-caption-before: 0.8em; --tex8web-caption-after: 0em",
      "--tex8web-caption-before: 0em; --tex8web-caption-after: 0.8em"})
    equal(#d:query_selector("span.tex8web-capskip"), 0)
  end,

  ["text.block_spacing: a caption's mark outside a caption, a warning"] = function()
    local d = parse([[<p><span class="tex8web-capskip" data-above="0.8em" data-below="0em" data-position="bottom"></span>A</p>]])
    logged = {}
    text.block_spacing(d)
    equal(body(d), [[<p>A</p>]])
    check(logged[1] and logged[1]:find("^warning: a caption's space is lost"), logged[1] or "nothing logged")
  end,

  ["text.box_theorems: no empty paragraph after a theorem ending a box, only there"] = function()
    local d = parse([[<div class="mdframed"><div class="newtheorem"><p>T</p></div><p class="noindent">]]
      .. "\n" .. [[</p></div><div class="mdframed"><div class="newtheorem"><p>T</p></div><p>Text</p></div>]]
      .. [[<div class="newtheorem"><p>T</p></div><p> </p>]])
    text.box_theorems(d)
    equal(body(d), [[<div class='mdframed'><div class='newtheorem'><p>T</p></div></div>]]
      .. [[<div class='mdframed'><div class='newtheorem'><p>T</p></div><p>Text</p></div>]]
      .. [[<div class='newtheorem'><p>T</p></div><p> </p>]])
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
    equal(body(d), "<p>Lemma<span class='tex8web-nowrap'><span class='tex8web-nbsp'> </span>"
      .. "<span class='mathjax-inline'>\\(1\\)</span></span> and a<span class='tex8web-nbsp'> </span>b</p>")
  end,

  ["text.no_break_spaces: a ~ alone in a span of its font, kept with the math and the word after it"] = function()
    local d = parse("<p>see<span class=\"cmr-9\">\u{A0}</span><span class=\"mathjax-inline\">\\(1\\)</span>\u{A0}then x</p>")
    text.no_break_spaces(d)
    equal(body(d), "<p>see<span class='tex8web-nowrap'><span class='cmr-9'><span class='tex8web-nbsp'> </span></span>"
      .. "<span class='mathjax-inline'>\\(1\\)</span><span class='tex8web-nbsp'> </span>then</span> x</p>")
  end,

  ["text.no_break_spaces: a narrow no-break space kept with the math after it, and not narrowed"] = function()
    local d = parse("<p>p.\u{202F}<span class=\"mathjax-inline\">\\(5\\)</span> and 10\u{202F}000</p>")
    text.no_break_spaces(d)
    equal(body(d), "<p>p.<span class='tex8web-nowrap'>\u{202F}<span class='mathjax-inline'>\\(5\\)</span></span>"
      .. " and 10\u{202F}000</p>")
  end,

  ["text.no_break_spaces: math kept with a no-break space after it, up to the next whitespace"] = function()
    local d = parse("<p>of <span class=\"mathjax-inline\">\\(x\\)</span>\u{A0}and, <span class=\"mathjax-inline\">\\(5\\)</span>\u{202F}<span class=\"it\">cm</span>2 and "
      .. "of\u{A0}<span class=\"mathjax-inline\">\\(n\\)</span>\u{A0}<span class=\"mathjax-inline\">\\(y\\)</span>\u{A0}<!--l. 3-->elements, "
      .. "<span class=\"mathjax-inline\">\\(x\\)</span>\u{A0}(<a href=\"#e\">1</a>) and <span class=\"mathjax-inline\">\\(z\\)</span>\u{A0}<em>a phrase</em></p>")
    text.no_break_spaces(d)
    equal(body(d), "<p>of <span class='tex8web-nowrap'><span class='mathjax-inline'>\\(x\\)</span><span class='tex8web-nbsp'> </span>and,</span> <span class='tex8web-nowrap'><span class='mathjax-inline'>\\(5\\)</span>\u{202F}<span class='it'>cm</span>2</span> and "
      .. "of<span class='tex8web-nowrap'><span class='tex8web-nbsp'> </span><span class='mathjax-inline'>\\(n\\)</span><span class='tex8web-nbsp'> </span><span class='mathjax-inline'>\\(y\\)</span><span class='tex8web-nbsp'> </span><!-- l. 3 -->elements,</span> "
      .. "<span class='tex8web-nowrap'><span class='mathjax-inline'>\\(x\\)</span><span class='tex8web-nbsp'> </span>(<a href='#e'>1</a>)</span> and <span class='tex8web-nowrap'><span class='mathjax-inline'>\\(z\\)</span><span class='tex8web-nbsp'> </span></span><em>a phrase</em></p>")
  end,

  ["text.no_break_spaces: the characters right before and after the math, up to whitespace, kept with it, also in a span of their font"] = function()
    local d = parse("<p>the <span class=\"mathjax-inline\">\\(i\\)</span>th row, an (<span class=\"mathjax-inline\">\\(n\\)</span>-cell) and "
      .. "<span class=\"cmti-10\">the (</span><span class=\"mathjax-inline\">\\(n\\)</span><span class=\"cmti-10\">th row</span></p>")
    text.no_break_spaces(d)
    equal(body(d), "<p>the <span class='tex8web-nowrap'><span class='mathjax-inline'>\\(i\\)</span>th</span> row, an "
      .. "<span class='tex8web-nowrap'>(<span class='mathjax-inline'>\\(n\\)</span>-cell)</span> and "
      .. "<span class='cmti-10'>the </span><span class='tex8web-nowrap'><span class='cmti-10'>(</span><span class='mathjax-inline'>\\(n\\)</span><span class='cmti-10'>th</span></span><span class='cmti-10'> row</span></p>")
  end,

  ["text.no_break_spaces: the run after the math goes through elements and formulas, up to whitespace, a line end, an \\hfill, a qed box, or a space at a formula's end, and not past the last node that shows"] = function()
    local m = function(tex, style) return "<span class=\"mathjax-inline\"" .. (style or "") .. ">\\(" .. tex .. "\\)" .. (style and " " or "") .. "</span>" end
    local d = parse("<p>the " .. m("n") .. "<sup class=\"textsuperscript\">th</sup> term, " .. m("a") .. "(" .. m("b + c") .. ") x, "
      .. m("x") .. ".<br/>next " .. m("y", " style=\"s\"") .. "and "
      .. m("z") .. ".<span class=\"tex8web-hfill-gap\"></span><span class=\"tex8web-hfill\">q</span> "
      .. m("w") .. ".<span class=\"tex8web-qed\">Q</span> " .. m("v") .. "<a id=\"e\"></a></p>")
    text.no_break_spaces(d)
    equal(body(d), "<p>the <span class='tex8web-nowrap'><span class='mathjax-inline'>\\(n\\)</span><sup class='textsuperscript'>th</sup></span> term, "
      .. "<span class='tex8web-nowrap'><span class='mathjax-inline'>\\(a\\)</span>(<span class='mathjax-inline'>\\(b + c\\)</span>)</span> x, "
      .. "<span class='tex8web-nowrap'><span class='mathjax-inline'>\\(x\\)</span>.</span><br />next <span class='mathjax-inline' style='s'>\\(y\\) </span>and "
      .. "<span class='tex8web-nowrap'><span class='mathjax-inline'>\\(z\\)</span>.</span><span class='tex8web-hfill-gap'></span><span class='tex8web-hfill'>q</span> "
      .. "<span class='tex8web-nowrap'><span class='mathjax-inline'>\\(w\\)</span>.</span><span class='tex8web-qed'>Q</span> "
      .. "<span class='mathjax-inline'>\\(v\\)</span><a id='e'></a></p>")
  end,

  ["text.no_break_spaces: a ~ in a span of its font, before or after the math, kept with it"] = function()
    local d = parse("<p><span class=\"cmti-10\">For all</span><span class=\"cmti-10\">\u{A0}</span><span class=\"mathjax-inline\">\\(x\\)</span>"
      .. "<span class=\"cmti-10\">\u{A0}and so on</span></p>")
    text.no_break_spaces(d)
    local nbsp = "<span class='tex8web-nbsp'> </span>"
    equal(body(d), "<p><span class='cmti-10'>For all</span><span class='tex8web-nowrap'><span class='cmti-10'>" .. nbsp .. "</span>"
      .. "<span class='mathjax-inline'>\\(x\\)</span><span class='cmti-10'>" .. nbsp .. "and</span></span><span class='cmti-10'> so on</span></p>")
  end,

  ["text.no_break_spaces: a box or a term after the math not split"] = function()
    local d = parse("<p>the <span class=\"mathjax-inline\">\\(i\\)</span><span class=\"fbox\">th row</span> and "
      .. "<span class=\"mathjax-inline\">\\(m\\)</span><span class=\"tex8web-term\">th power</span></p>")
    local before = body(d)
    text.no_break_spaces(d)
    equal(body(d), before)
  end,

  ["text.hfill: the rest of each line after its last \\hfill in a span, up to a <br>, a block or a display; in a paragraph, its line too"] = function()
    local mark = [[<span class="tex8web-hfill-mark"></span>]]
    local fill = "<span class='tex8web-hfill-gap'> </span><span class='tex8web-hfill'>"
    local d = parse("<p>Name " .. mark .. " Date</p>"
      .. "<p>a " .. mark .. "b " .. mark .. " <b>c</b><br />d " .. mark .. " e<br />f</p>"
      .. "<p>g<br />h " .. mark .. " i<span class=\"mathjax-block\">\\[x\\]</span>j <a>k " .. mark .. " l</a></p>"
      .. "<dd>m " .. mark .. " <br />n " .. mark .. " <div>o</div>p " .. mark .. " q<br />r</dd>")
    text.hfill(d)
    equal(body(d), "<p><span class='tex8web-hfill-line'>Name" .. fill .. " Date</span></span></p>"
      .. "<p><span class='tex8web-hfill-line'>a b" .. fill .. " <b>c</b></span><br /></span>"
      .. "<span class='tex8web-hfill-line'>d" .. fill .. " e</span><br /></span>f</p>"
      .. "<p>g<br /><span class='tex8web-hfill-line'>h" .. fill .. " i</span></span>"
      .. "<span class='mathjax-block'>\\[x\\]</span>j <a>k" .. fill .. " l</span></a></p>"
      .. "<dd>m  <br />n  <div>o</div>p" .. fill .. " q</span><br />r</dd>")
  end,

  ["text.hfill: a break mark after text on its line becomes a <br>, and one with nothing before it is dropped"] = function()
    local mark = [[<span class="tex8web-hfill-mark"></span>]]
    local brk = [[<span class="tex8web-break"></span>]]
    local fill = "<span class='tex8web-hfill-gap'> </span><span class='tex8web-hfill'>"
    local d = parse("<p>s " .. mark .. " u" .. brk .. "v</p><p>w " .. brk .. "x</p><dt><a id=\"a\"></a>" .. brk .. "y</dt><div><div>z</div>" .. brk .. "</div>")
    text.hfill(d)
    equal(body(d), "<p><span class='tex8web-hfill-line'>s" .. fill .. " u</span><br class='newline' /></span>v</p>"
      .. "<p>w <br class='newline' />x</p><dt><a id='a'></a>y</dt><div><div>z</div></div>")
  end,

  ["text.cell_align: the mark at a cell's end aligns its <td>, or its \\multicolumn's div"] = function()
    -- (dom.parse, as make4ht's DOM filters use it: html_parse doubles the
    -- letter after a - in a comment)
    local d = dom.parse("<html><body>" .. [[<td style="white-space:normal; text-align:left;"><p>a<!--tex8web-cell-align center--></p></td>]]
      .. [[<td style="white-space:normal; text-align:left;"><p>b</p><!--tex8web-cell-align right--></td>]]
      .. [[<td style="white-space:normal; text-align:left;"><div><p>c<!--tex8web-cell-align center--></p></div></td>]]
      .. [[<td style="text-align:left;"><div class="multicolumn" style="text-align:left;">d</div><!--tex8web-cell-align right--></td>]]
      .. "</body></html>")
    text.cell_align(d)
    equal(body(d), "<td style='white-space:normal; text-align:center;'><p>a</p></td>"
      .. "<td style='white-space:normal; text-align:right;'><p>b</p></td>"
      .. "<td style='white-space:normal; text-align:center;'><div><p>c</p></div></td>"
      .. "<td style='text-align:left;'><div class='multicolumn' style='text-align:right;'>d</div></td>")
  end,

  ["text.hfill: the space before a rest is trimmed at the end of an element too"] = function()
    local mark = [[<span class="tex8web-hfill-mark"></span>]]
    local fill = "<span class='tex8web-hfill-gap'> </span><span class='tex8web-hfill'>"
    local d = parse("<p>s <b>t </b>" .. mark .. " u</p>")
    text.hfill(d)
    equal(body(d), "<p><span class='tex8web-hfill-line'>s <b>t</b>" .. fill .. " u</span></span></p>")
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

  ["text.minipages: the anchors before a row at the top of its first minipage"] = function()
    local d = parse([[<div class="minipage tex8web-minipage-c">A</div> <a id="x1r4"></a> <!-- l. 1 --><p class="noindent"></p>]]
      .. [[<div class="minipage tex8web-minipage-c"><figure>B</figure></div>]]
      .. [[<a href="#x1r4"></a><div class="minipage tex8web-minipage-c">C</div>]])
    text.minipages(d)
    equal(body(d), [[<div class='tex8web-minipages'><div class='minipage tex8web-minipage-c'>A</div></div>  <!--  l. 1  -->]]
      .. [[<div class='tex8web-minipages'><div class='minipage tex8web-minipage-c'><a id='x1r4'></a><figure>B</figure></div></div>]]
      .. [[<a href='#x1r4'></a><div class='tex8web-minipages'><div class='minipage tex8web-minipage-c'>C</div></div>]])
  end,

  ["text.minipages: not a div that tex8web didn't write"] = function()
    local d = parse([[<div class="subfigure">A</div><div class="subfigure">B</div><div class="minipage">C</div>]])
    text.minipages(d)
    equal(#d:query_selector("div.tex8web-minipages"), 0)
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

  ["page.controls: the text in <main>, the controls and the contents outside it"] = function()
    local d = parse([[<h3 class="likesectionHead">Contents</h3><div class="tableofcontents"><span class="sectionToc">]]
      .. [[<a href="#intro">Intro</a></span></div><h3 class="sectionHead" id="intro">Intro</h3><p>Text</p>]])
    page.controls(d, {contents = "Contents"})
    local main = d:query_selector("main")[1]
    equal(#d:query_selector("main"), 1)
    equal({#main:query_selector("h3"), #main:query_selector("p"), #main:query_selector("nav"),
      #main:query_selector(".tex8web-controls")}, {1, 1, 0, 0})
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

  ["prerender.run: node_modules with another MathJax than package.json pins, a warning"] = function()
    local root, skip = os.tmpname(), os.getenv("TEX8WEB_NO_PRERENDER")
    os.remove(root)
    for _, dir in ipairs({"", "/node_modules", "/node_modules/mathjax", "/node_modules/subset-font"}) do
      lfs.mkdir(root .. dir)
    end
    local json = root .. "/node_modules/mathjax/package.json"
    local f = assert(io.open(json, "w"))
    f:write('{"name": "mathjax", "version": "4.0.0"}')
    f:close()
    os.setenv("TEX8WEB_NO_PRERENDER", nil)
    local context = {root = root, mathjax = "4.1.3"}
    local available, result = prerender.available(context), prerender.run(context, "x.html")
    os.setenv("TEX8WEB_NO_PRERENDER", skip)
    for _, path in ipairs({json, root .. "/node_modules/mathjax", root .. "/node_modules/subset-font",
        root .. "/node_modules", root}) do
      os.remove(path)
    end
    equal({available, result}, {false, false})
    check(logged[#logged]:find("MathJax 4.0.0 is installed, not the 4.1.3 package.json pins", 1, true),
      logged[#logged])
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
        -- (as xcolor gives them: mixed unrounded, - complementing the whole mix, a share over 100 clamped at the end)
        "\\definecolor{gray!50}{RGB}{191,191,191}", "\\definecolor{ink!50!yellow!50}{RGB}{241,191,152}",
        "\\definecolor{-ink}{RGB}{55,255,155}", "\\definecolor{-red!50!black}{RGB}{128,255,255}",
        "\\definecolor{red!50!-blue}{RGB}{255,128,0}", "\\definecolor{--ink}{RGB}{200,0,100}",
        "\\definecolor{red!150!black}{RGB}{255,0,0}", "\\definecolor{red!150}{RGB}{255,0,0}"}) do
      check(definitions:find(line, 1, true), line .. " in " .. definitions)
    end
    check(not definitions:find("{red}", 1, true) and not definitions:find("{black}", 1, true), definitions)
    check(not definitions:find("nope", 1, true), definitions)
  end,

  ["macros.define: the colors come before the macros (MathJax reruns them after a \\definecolor)"] = function()
    local tex = tmpfile([[\DeclarePairedDelimiter{\abs}{\lvert}{\rvert}]])
    local d = parse([[<span class="mathjax-inline">\(\abs{\textcolor{ink}{a}}\)</span>]])
    macros.define(d, {tex_file = tex, colors = "ink 0.78432,0,0.39216 "})
    os.remove(tex)
    local definitions = d:query_selector("body > div#tex8web-macros")[1]:get_text()
    local color, macro = definitions:find("\\definecolor", 1, true), definitions:find("\\DeclarePairedDelimiter", 1, true)
    check(color and macro and color < macro, definitions)
  end,

  ["macros.define: mixes in the first color's model, as xcolor does"] = function()
    local d = parse([[<span class="mathjax-inline">\(\textcolor{olive!50}{a}\textcolor{BrickRed!30}{b}]]
      .. [[\textcolor{Mahogany!40!Goldenrod}{c}\textcolor{-BrickRed!40}{d}\textcolor{gray!50!BrickRed}{e}]]
      .. [[\textcolor{red!50!olive}{f}\textcolor{olive!50!-red}{g}\textcolor{gray!0!BrickRed!50}{h}]]
      .. [[\textcolor{black!-50!white!50!red}{i}\textcolor{gray!100!red!50!BrickRed}{j}]]
      .. [[\textcolor{olive!-50!white!50!red}{k}\textcolor{BrickRed!150!-blue}{l}\textcolor{BrickRed!50!red!-60!blue}{m}\)</span>]])
    local tex = tmpfile("")
    macros.define(d, {tex_file = tex, colors = "olive 0,0,1,0.5 BrickRed 0,0.89,0.94,0.28 "
      .. "Mahogany 0,0.85,0.87,0.35 Goldenrod 0,0.10,0.84,0 gray 0.5 red 1,0,0 black 0 white 1 blue 0,0,1 "})
    os.remove(tex)
    local definitions = d:query_selector("body > div#tex8web-macros")[1]:get_text()
    -- (each as xcolor gives it: \convertcolorspec to HTML, converted values
    -- clamped to 0 to 1, and a share of 100 keeping the first color's model)
    for _, line in ipairs({"\\definecolor{olive!50}{RGB}{191,191,64}", "\\definecolor{BrickRed!30}{RGB}{234,165,162}",
        "\\definecolor{Mahogany!40!Goldenrod}{RGB}{219,117,2}", "\\definecolor{-BrickRed!40}{RGB}{29,119,124}",
        "\\definecolor{gray!50!BrickRed}{RGB}{156,42,36}", "\\definecolor{red!50!olive}{RGB}{191,64,0}",
        "\\definecolor{olive!50!-red}{RGB}{64,191,64}", "\\definecolor{gray!0!BrickRed!50}{RGB}{219,106,99}",
        "\\definecolor{black!-50!white!50!red}{RGB}{255,128,128}", "\\definecolor{gray!100!red!50!BrickRed}{RGB}{156,42,36}",
        "\\definecolor{olive!-50!white!50!red}{RGB}{255,159,223}", "\\definecolor{BrickRed!150!-blue}{RGB}{148,0,0}",
        "\\definecolor{BrickRed!50!red!-60!blue}{RGB}{0,13,255}"}) do
      check(definitions:find(line, 1, true), line .. " in " .. definitions)
    end
  end,

  ["macros.define: a color a macro of the math names, given as its argument"] = function()
    local tex = tmpfile([[\newcommand\hl[2]{\textcolor{#1}{#2}}]])
    local d = parse([[<span class="mathjax-inline">\(\hl{ink}{x} + \hl{ink!50}{y}\)</span>]])
    macros.define(d, {tex_file = tex, colors = "ink 0.78432,0,0.39216 "})
    os.remove(tex)
    local definitions = d:query_selector("body > div#tex8web-macros")[1]:get_text()
    check(definitions:find("\\definecolor{ink}{RGB}{200,0,100}", 1, true), definitions)
    check(definitions:find("\\definecolor{ink!50}{RGB}{228,128,177}", 1, true), definitions)
  end,

  ["page.meta_tags: an abstract without spaces cut at 197 characters"] = function()
    local d = parse([[<div class="abstract"><p>]] .. string.rep("字", 250) .. [[</p></div>]])
    page.meta_tags(d)
    local description = d:query_selector("meta[name='description']")[1]:get_attribute("content")
    equal(description, string.rep("字", 197) .. "…")
  end,

  ["text.block_spacing: a theorem with another class too"] = function()
    local d = parse([[<div class="newtheorem lemma"><p><span class="head">Lemma 1.<span class="tex8web-thmskip" data-before="1em" data-after="2em"></span></span></p></div>]])
    text.block_spacing(d)
    equal(d:query_selector("div")[1]:get_attribute("style"), "margin-top: 1em; margin-bottom: 2em")
  end,

  ["text.no_break_spaces: none in verbatim, code or listings"] = function()
    local d = parse("<pre>a\u{A0}b <span>c\u{A0}d</span></pre><code>e\u{A0}f</code>"
      .. "<div class=\"lstlisting\"><span>g\u{A0}h</span></div><p>i\u{A0}j</p>")
    text.no_break_spaces(d)
    equal(#d:query_selector("span.tex8web-nbsp"), 1)
    equal(d:query_selector("p span.tex8web-nbsp")[1] ~= nil, true)
  end,

  ["text.literal_blocks: drop the parser newline and padding, keeping source blank lines"] = function()
    local d = parse("<div class='listing'>\n  \n<span>\nfirst</span></div>"
      .. "<div class='verbatimtabinput'>\n  \n<span>second</span></div>")
    text.literal_blocks(d)
    equal(d:query_selector("div.listing")[1]:get_text(), "\n\nfirst")
    equal(d:query_selector("div.verbatimtabinput")[1]:get_text(), "\nsecond")
  end,

  ["text.literal_blocks: bare literal text keeps its source spaces, not the padding"] = function()
    local d = parse("<div class='listing'>\n   \n<span>1</span>   a\u{A0}\u{A0}b\n"
      .. "<span>2</span>   \u{A0}\u{A0}c\n   </div>")
    text.literal_blocks(d)
    equal(d:query_selector("div.listing")[1]:get_text(), "\n1   a\u{A0}\u{A0}b\n2   \u{A0}\u{A0}c\n")
    -- (padding split over text nodes)
    d = parse("<div class='verbatimtabinput'></div>")
    local block = d:query_selector("div")[1]
    for _, part in ipairs({"\n   ", "\nx\u{A0}y\n", "   "}) do block:add_child_node(block:create_text_node(part)) end
    text.literal_blocks(d)
    equal(block:get_text(), "\nx\u{A0}y\n")
  end,

  ["text.long_literals: phone-width verb and listings get constrained boxes"] = function()
    local literal = "abcdefghijklmnopqrstuvwxyz123456789"
    for _, class in ipairs({"verb", "lstinline"}) do
      local d = parse("<p><code class='" .. class .. "'>" .. literal .. "</code></p>")
      text.long_literals(d)
      equal(#d:query_selector("span.tex8web-long-literal > code." .. class), 1)
    end
  end,

  ["text.long_literals: only long literals get a narrow-screen box"] = function()
    local short, long = string.rep("é", 20), string.rep("é", 21)
    local d = parse("<p><code class='verb'>" .. short .. "</code>"
      .. "<code class='verb'><span class='cmtt-10'>" .. long .. "</span></code></p>")
    text.long_literals(d)
    equal(#d:query_selector("span.tex8web-long-literal > code.verb"), 1)
    equal(d:query_selector("span.tex8web-long-literal")[1]:get_text(), long)
    equal(#d:query_selector("p > code.verb"), 1)
  end,

  ["text.no_break_spaces: moreverb preserves literal spaces inside font spans"] = function()
    for _, class in ipairs({"listing", "listinginput", "verbatimtabinput"}) do
      local literal = "<div class='" .. class .. "'><span class='cmtt-10'>a\u{A0}\u{A0}b</span></div>"
      local d = parse(literal .. "<p>c\u{A0}d</p>")
      text.no_break_spaces(d)
      equal(body(d), literal .. "<p>c<span class='tex8web-nbsp'> </span>d</p>")
    end
  end,

  ["text.url_breaks: a <wbr> after url.sty's break characters, none in a scheme, right after its //, or at the end"] = function()
    local d = parse([[<a class="url" href="h"><span class="cmtt-10">https://a.org/b?c=1&amp;d#e/</span></a>]]
      .. [[ <span class="path"><span>/usr/</span><span>local/x</span></span>]]
      .. [[ <a href="h"><span class="tex8web-nolinkurl"><span>10.1/x</span></span></a>]]
      .. [[ <a href="h">a.b/c</a> mailto:a.b]])
    text.url_breaks(d)
    equal(body(d), "<a class='url' href='h'><span class='cmtt-10'>https://a.<wbr />org/<wbr />b?<wbr />c=<wbr />1&amp;<wbr />d#<wbr />e/</span></a>"
      .. " <span class='path'><span>/usr/<wbr /></span><span>local/<wbr />x</span></span>"
      .. " <a href='h'><span class='tex8web-nolinkurl'><span>10.<wbr />1/<wbr />x</span></span></a>"
      .. " <a href='h'>a.b/c</a> mailto:a.b")
  end,

  ["text.url_breaks: no <wbr> after a first character, between two break characters, or before a relation, as in TeX"] = function()
    local d = parse([[<span class="path">/usr</span> <span class="path">../src</span> <span class="path">a//b</span>]]
      .. [[ <span class="path">a.:b::c(.d</span>]])
    text.url_breaks(d)
    equal(body(d), "<span class='path'>/usr</span> <span class='path'>..<wbr />/src</span> <span class='path'>a/<wbr />/b</span>"
      .. " <span class='path'>a.:<wbr />b::<wbr />c(.d</span>")
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

  ["text.block_spacing: after a color's style, joined with a semicolon"] = function()
    local d = parse([[<div class="newtheorem" style="color:#FF0000;"><p><span class="head">Lemma 1.<span class="tex8web-thmskip" data-before="1em" data-after="2em"></span></span></p></div>]]
      .. [[<div class="newtheorem" style="color:#00FF00"><p><span class="head">Lemma 2.<span class="tex8web-thmskip" data-before="1em" data-after="2em"></span></span></p></div>]])
    text.block_spacing(d)
    equal(d:query_selector("div")[1]:get_attribute("style"), "color:#FF0000; margin-top: 1em; margin-bottom: 2em")
    equal(d:query_selector("div")[2]:get_attribute("style"), "color:#00FF00; margin-top: 1em; margin-bottom: 2em")
  end,

  ["page.equation_anchors: the anchors only space separates from a display, and not \\index's"] = function()
    local d = parse([[<p>a<a id="i1"></a> b <a id="e1"></a><!-- c -->
<a id="e2"></a><span class="mathjax-env">x</span> <a id="i2"></a> text <a id="e3"></a>
<span class="mathjax-block">y</span></p>]]
      .. [[<p>c <a id="i3"></a>d.<a id="e4"></a>
</p><div class="mathjax-env">z</div><p>e<a id="e5"></a></p><p>f</p><div class="mathjax-env">w</div>]]
      .. [[<p>g<a id="dx1"></a>
<a id="e6"></a><a id="dx2"></a><span class="mathjax-env">v</span></p><p>h<a id="dx3"></a></p><div class="mathjax-env">u</div>]])
    page.equation_anchors(d)
    local marked = {}
    for _, a in ipairs(d:query_selector("a[class]")) do
      marked[#marked + 1] = a:get_attribute("id") .. " " .. a:get_attribute("class")
    end
    equal(marked, {"e1 tex8web-eq-anchor", "e2 tex8web-eq-anchor", "e3 tex8web-eq-anchor",
      "e4 tex8web-eq-anchor-end", "e6 tex8web-eq-anchor"})
  end,

  ["page.equation_anchors: a display with only anchors and space before it in its paragraph"] = function()
    local d = parse([[<p> <a id="e1"></a><!-- c --><span class="mathjax-env">x</span></p>]]
      .. [[<p>a <span class="mathjax-block">y</span></p><p><img src="p.png"/><span class="mathjax-block">z</span></p>]]
      .. [[<p><a id="dx1"></a><span class="mathjax-block">w</span></p>]])
    page.equation_anchors(d)
    local classes = {}
    for _, display in ipairs(d:query_selector(".mathjax-env, .mathjax-block")) do
      classes[#classes + 1] = display:get_attribute("class")
    end
    equal(classes, {"mathjax-env tex8web-display-start", "mathjax-block", "mathjax-block",
      "mathjax-block tex8web-display-start"})
  end,

  ["text.line_comments: tex4ht's source line comments go, other comments stay"] = function()
    local d = parse("<!--  l. 52  --><p>a</p>\n<!--l. 7--><p>b</p><!-- keep --><p>c<!--  l. 9  -->d</p>")
    text.line_comments(d)
    equal(body(d), "<p>a</p>\n<p>b</p><!--  keep  --><p>cd</p>")
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
