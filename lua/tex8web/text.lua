-- The text around the math.
local dom = require "tex8web.dom"

local M = {}

-- theorem spacing, which tex8web-text.tex writes in a
-- <span class="tex8web-thmskip"> in the heading, as TeX knows it only once
-- the theorem has started
function M.theorem_spacing(document)
  for _, mark in ipairs(document:query_selector("span.tex8web-thmskip")) do
    local div = dom.closest(mark, function(el)
      return el:get_element_name() == "div" and dom.has_class(el, "newtheorem")
    end)
    if div then
      dom.add_style(div, "margin-top: " .. mark:get_attribute("data-before")
        .. "; margin-bottom: " .. mark:get_attribute("data-after"))
    end
    mark:remove_node()
  end
end

-- removes, from an mdframed box that ends with its theorem
-- (\newmdtheoremenv), the empty paragraph tex8web-text.tex starts after a
-- theorem for the text that follows (\indent). Its margin would add to the
-- box's padding.
function M.box_theorems(document)
  for _, box in ipairs(document:query_selector("div.mdframed")) do
    local elements = dom.elements(box)
    local p, theorem = elements[#elements], elements[#elements - 1]
    if theorem and p:get_element_name() == "p" and dom.is_blank(p)
        and dom.has_class(theorem, "newtheorem") then
      p:remove_node()
    end
  end
end

-- removes the empty paragraph html4.4ht opens between a heading and an
-- enumerate or a description. Through that paragraph, the list's margin
-- would still collapse with the heading's (css/tex8web.css sets that
-- margin as LaTeX does, with no \topsep under a heading).
function M.heading_lists(document)
  -- (each parent's elements are listed once; the list goes stale, but a
  -- removed paragraph was before only the list it was found for)
  local siblings = {}
  local function before(el)
    local parent = el:get_parent()
    if not siblings[parent] then
      local elements, at = dom.elements(parent), {}
      for i, element in ipairs(elements) do at[element] = i end
      siblings[parent] = {elements = elements, at = at}
    end
    local group = siblings[parent]
    return group.elements[group.at[el] - 1]
  end
  for _, list in ipairs(document:query_selector("ol, ul, dl")) do
    local p = before(list)
    local heading = p and before(p)
    if heading and heading:get_element_name():match("^h[2-6]$") and p:get_element_name() == "p"
        and dom.is_blank(p) then
      p:remove_node()
    end
  end
end

-- rewrites links to the page by file name, as biblatex.4ht writes
-- citations (page.html#X0-key), as links within it (#X0-key), which the
-- stylesheet's citation color and tex8web-page.js's previews look for; and
-- removes the href of an empty link to page.html
function M.same_page_links(document, context)
  local page = context.input .. ".html"
  for _, a in ipairs(document:query_selector("a[href]")) do
    local href = a:get_attribute("href")
    if href == page and #a:get_children() == 0 then
      a:set_attribute("href", nil)
    elseif href:sub(1, #page + 1) == page .. "#" then
      a:set_attribute("href", href:sub(#page + 1))
    end
  end
end

-- the space between a heading's number and its title, as one space in a
-- <span class="tex8web-labelsep">, which css/tex8web.css makes as wide as
-- in the PDF. tex4ht writes it as spaces (KOMA's as no-break spaces) in the
-- number and after it, which the browser would collapse into one.
local function last_text(el)
  local children = el:get_children()
  local last = children[#children]
  if last and last:is_element() then return last_text(last) end
  return last and last:is_text() and last or nil
end

local function trim(text, space, nbsp)
  repeat
    local before = text
    text = text:gsub(space, ""):gsub(nbsp, "")
  until text == before
  return text
end

function M.label_space(document)
  for _, mark in ipairs(document:query_selector(".titlemark")) do
    local spaced = false
    local function strip(node, space, nbsp)
      local text = trim(node:get_text(), space, nbsp)
      spaced = spaced or text ~= node:get_text()
      dom.set_node_text(node, text)
    end
    local last = last_text(mark)
    if last then strip(last, "%s+$", "\u{A0}$") end
    local parent = mark:get_parent()
    local siblings = parent:get_children()
    for i, node in ipairs(siblings) do
      if node == mark then
        local after = siblings[i + 1]
        if after and after:is_text() then strip(after, "^%s+", "^\u{A0}") end
        if spaced then
          local space = mark:create_element("span", {class = "tex8web-labelsep"})
          space:add_child_node(space:create_text_node(" "))
          table.insert(siblings, i + 1, space)
          dom.set_children(parent, siblings)
        end
        break
      end
    end
  end
end

-- tex4ht's mathjax option puts each formula's source in a <span> or <div>
-- of class mathjax-inline, mathjax-block or mathjax-env
local function is_math(el)
  return dom.class_starts(el, "mathjax-")
end

-- the children of el, with each no-break space in a <span class="tex8web-nbsp">
local function mark_nbsp(el)
  local children = {}
  for _, child in ipairs(el:get_children()) do
    local text = child:is_text() and child:get_text() or ""
    if text:find("\u{A0}", 1, true) then
      local start = 1
      repeat
        local i, j = text:find("\u{A0}", start, true)
        local run = text:sub(start, (i or 0) - 1)
        if run ~= "" then children[#children + 1] = el:create_text_node(run) end
        if i then
          local nbsp = el:create_element("span", {class = "tex8web-nbsp"})
          nbsp:add_child_node(nbsp:create_text_node("\u{A0}"))
          children[#children + 1] = nbsp
          start = j + 1
        end
      until not i
    else
      children[#children + 1] = child
    end
  end
  return children
end

local function has_nbsp(el)
  for _, child in ipairs(el:get_children()) do
    if child:is_text() and child:get_text():find("\u{A0}", 1, true) then return true end
  end
  return false
end

-- (a narrowed space would misalign the columns of code)
local function is_verbatim(el)
  local name = el:get_element_name()
  return name == "pre" or name == "code" or dom.has_class(el, "lstlisting")
    or dom.has_class(el, "verbatiminput") or dom.has_class(el, "alltt")
end

local function is_nbsp(node)
  return node:is_element() and node:get_attribute("class") == "tex8web-nbsp"
end

-- tex4ht writes ~ as a no-break space, which Latin Modern draws half again
-- as wide as a space, so each is marked for the CSS to narrow. A browser
-- still breaks the line between one and the math after it (Lemma~$1$), so
-- the two are wrapped together. Verbatim text, alltt, and listings are left
-- as they are.
function M.no_break_spaces(document)
  document:traverse_elements(function(el)
    local class = el:get_attribute("class")
    if class == "tex8web-nbsp" or class == "tex8web-nowrap" or not has_nbsp(el)
        or dom.closest(el, function(up) return is_math(up) or is_verbatim(up) end) then
      return
    end
    local children, wrapped, i = mark_nbsp(el), {}, 1
    while i <= #children do
      local j = i + 1
      -- (the math may follow after a comment)
      while children[j] and not children[j]:is_element() and not children[j]:is_text() do
        j = j + 1
      end
      if is_nbsp(children[i]) and children[j] and dom.has_class(children[j], "mathjax-inline") then
        local nowrap = el:create_element("span", {class = "tex8web-nowrap"})
        for k = i, j do nowrap:add_child_node(children[k]) end
        wrapped[#wrapped + 1] = nowrap
        i = j + 1
      else
        wrapped[#wrapped + 1] = children[i]
        i = i + 1
      end
    end
    dom.set_children(el, wrapped)
  end)
end

-- minipages and subfigures side by side (tex8web-text.tex): each run of
-- them with only space between, on one line in the PDF, goes in one row.
-- One that begins a paragraph (tex8web-par) starts a new row.
local function is_minipage(node)
  return node:is_element() and node:get_element_name() == "div"
    and dom.class_starts(node, "tex8web-minipage-")
end

-- (~ between two is a space too)
local function is_space(node)
  if node:is_text() then return not node:get_text():gsub("\u{A0}", " "):find("%S") end
  return not node:is_element() or is_nbsp(node)
end

function M.minipages(document)
  local parents, seen = {}, {}
  for _, el in ipairs(document:query_selector("div.minipage, div.subfigure")) do
    local parent = el:get_parent()
    if not seen[parent] then seen[parent], parents[#parents + 1] = true, parent end
  end
  for _, parent in ipairs(parents) do
    local children, out, i = parent:get_children(), {}, 1
    while i <= #children do
      if is_minipage(children[i]) then
        local row = parent:create_element("div", {class = "tex8web-minipages"})
        row:add_child_node(children[i])
        local j = i + 1
        while true do
          local k = j
          while children[k] and is_space(children[k]) do k = k + 1 end
          if not (children[k] and is_minipage(children[k]))
              or dom.has_class(children[k], "tex8web-par") then
            break
          end
          row:add_child_node(children[k])
          j = k + 1
        end
        -- (removes \noindent's empty paragraph before the row, which would
        -- add a paragraph's space at the top of a box)
        local k = #out
        while k > 0 and is_space(out[k]) do k = k - 1 end
        if k > 0 and out[k]:is_element() and out[k]:get_element_name() == "p" and dom.is_blank(out[k]) then
          table.remove(out, k)
        end
        out[#out + 1] = row
        i = j
      else
        out[#out + 1] = children[i]
        i = i + 1
      end
    end
    dom.set_children(parent, out)
  end
end

-- footnotes, which fn-in (tex8web.mk4) puts at the end of the page, each
-- moved after the paragraph, list, or theorem that holds its mark, in
-- order; css/tex8web.css sets them beside the text on a wide screen. A
-- footnote in a table, a figure, a box, or math stays. \thanks, which fn-in
-- also puts there, goes back under the title.
local function stays(el)
  local name = el:get_element_name()
  return name == "table" or name == "figure" or dom.class_starts(el, "tcolorbox") or is_math(el)
end

local function is_top(el)
  local name = el:is_element() and el:get_element_name()
  return not name or name == "body" or name == "section"
end

function M.sidenotes(document)
  local list = document:query_selector("div.footnotes")[1]
  if not list then return end
  local last = {} -- the last note put after each block
  -- (a selector for each id would search the whole page once for each note)
  local by_id = {}
  document:traverse_elements(function(el)
    local id = el:get_attribute("id")
    if id and not by_id[id] then by_id[id] = el end
  end)
  for _, note in ipairs(list:query_selector("aside.footnotetext")) do
    local back = note:query_selector("span.footnote-mark a")[1]
    local id = (back and back:get_attribute("href") or ""):match("^#(.+)")
    local mark = id and by_id[id]
    if mark and not dom.closest(mark, stays) then
      local block = mark
      while not is_top(block:get_parent()) do block = block:get_parent() end
      local before = last[block] or block
      note:remove_node()
      note:set_attribute("class", note:get_attribute("class") .. " tex8web-sidenote")
      before:get_parent():add_child_node(note, before:find_element_pos() + 1)
      last[block] = note
    end
  end
  local title = document:query_selector("div.maketitle")[1]
  for _, el in ipairs(dom.elements(list)) do
    if title and el:get_element_name() ~= "aside" then
      el:remove_node()
      local thanks = title:create_element("div", {class = "thanks"})
      dom.set_children(thanks, el:get_children())
      title:add_child_node(thanks)
    end
  end
  if #dom.elements(list) == 0 then list:remove_node() end
end

-- \color as a declaration ({\color{red} text}): tex8web-page.tex marks
-- where it is set (span.tex8web-color, with the color) and where its group
-- ends (span.tex8web-color-end), each pair with an id. What lies between
-- takes the color: a block wholly between them in its style, and each run
-- of inline content in a span. Inner colors are applied first, and a block
-- keeps a color it has. tcolorbox's boxes keep their colors; floats and
-- footnotes keep the text's (LaTeX's \@xfloat and \@makecol set
-- \normalcolor; tex4ht's table float is a div.table); listings' tokens keep
-- html4.4ht's. tex4ht's link text is not a group, as hyperref's is in the
-- PDF, so a color set in a link ends with the link.
local blocks = {p = true, div = true, ul = true, ol = true, li = true, dl = true, dt = true,
  dd = true, h1 = true, h2 = true, h3 = true, h4 = true, h5 = true, h6 = true, table = true,
  caption = true, colgroup = true, col = true, thead = true, tbody = true, tr = true, td = true,
  th = true, figure = true, figcaption = true, aside = true, blockquote = true, pre = true,
  section = true, hr = true}

local function is_mark(node)
  return dom.has_class(node, "tex8web-color") or dom.has_class(node, "tex8web-color-end")
end

local function own_color(el)
  return dom.class_starts(el, "tcolorbox") or el:get_element_name() == "figure"
    or dom.has_class(el, "table") or dom.has_class(el, "footnotes")
end

local function index(node)
  for i, child in ipairs(node:get_parent():get_children()) do
    if child == node then return i end
  end
end

-- colors parent's children i to j, which are all between the marks
local function paint(parent, i, j, value)
  local children, out, run = parent:get_children(), {}, nil
  for k, node in ipairs(children) do
    local block = node:is_element() and blocks[node:get_element_name()]
    if k < i or k > j or block then
      run = nil
      out[#out + 1] = node
      local style = node:is_element() and node:get_attribute("style") or ""
      if k >= i and k <= j and not own_color(node) and not style:find("%f[%w-]color:") then
        node:set_attribute("style", (style:gsub(";?%s*$", "; ", 1):gsub("^; $", ""))
          .. "color:" .. value .. ";")
      end
    -- (a run starts at visible content: not at a mark, a space, or a ~)
    elseif run or node:is_element() and not is_mark(node)
        or node:is_text() and node:get_text():gsub("\u{A0}", " "):find("%S") then
      if not run then
        run = parent:create_element("span", {style = "color:" .. value .. ";"})
        out[#out + 1] = run
      end
      run:add_child_node(node)
    else
      out[#out + 1] = node
    end
  end
  dom.set_children(parent, out)
end

-- colors from the mark from to the mark to, or without to, to the end of
-- limit: at each level below the common ancestor, the siblings after from's
-- side and before to's side, and the ancestor's children between the sides
local function color(from, to, limit, value)
  local holds, up = {}, to
  while up do
    holds[up] = true
    up = up:get_parent()
  end
  local node = from
  while node:get_parent() ~= limit and not holds[node:get_parent()] do
    local parent = node:get_parent()
    paint(parent, index(node) + 1, #parent:get_children(), value)
    node = parent
  end
  local parent = node:get_parent()
  if not to then return paint(parent, index(node) + 1, #parent:get_children(), value) end
  local last, n = to, to
  while last:get_parent() ~= parent do last = last:get_parent() end
  while n ~= last do
    local up = n:get_parent()
    paint(up, 1, index(n) - 1, value)
    n = up
  end
  paint(parent, index(node) + 1, index(last) - 1, value)
end

function M.colors(document)
  local body = document:query_selector("body")[1]
  local marks, starts, open = {}, {}, {}
  local function walk(el)
    for _, node in ipairs(dom.elements(el)) do
      if is_mark(node) then marks[#marks + 1] = node else walk(node) end
    end
  end
  -- (from <html>: the <title> holds marks too, which are removed but color
  -- nothing)
  walk(document:query_selector("html")[1])
  local function start(from, to)
    if not dom.closest(from, function(el) return el == body end)
        or dom.closest(from, function(el) return dom.class_starts(el, "lst") end) then
      return
    end
    local link = dom.closest(from, function(el) return el:get_element_name() == "a" end)
    if link and to and not dom.closest(to, function(el) return el == link end) then to = nil end
    color(from, to, to and body or link or body, from:get_attribute("data-color"))
  end
  -- (a box used twice has its marks twice; a copy made after its group
  -- ended has its end mark first, and colors nothing)
  for _, mark in ipairs(marks) do
    local id = mark:get_attribute("data-id")
    if dom.has_class(mark, "tex8web-color") then
      if starts[id] == nil or starts[id] == "closed" then
        starts[id] = mark
        open[#open + 1] = mark
      end
    elseif starts[id] == nil then
      starts[id] = false
    elseif starts[id] then
      start(starts[id], mark)
      starts[id] = "closed"
    end
  end
  for k = #open, 1, -1 do
    local from = open[k]
    if starts[from:get_attribute("data-id")] == from then start(from) end
  end
  -- (a mark set between paragraphs can be alone in a paragraph)
  for _, mark in ipairs(marks) do
    local parent = mark:get_parent()
    mark:remove_node()
    if parent:get_element_name() == "p" and not parent:get_attribute("class")
        and not parent:get_attribute("id") and dom.is_blank(parent) then
      parent:remove_node()
    end
  end
end

-- what follows an \hfill, set at the right of its line as in the PDF.
-- tex8web-text.tex marks each \hfill in a paragraph (span.tex8web-hfill-mark).
-- What follows the last mark on a line, up to a \\ (<br>), a block, or a
-- display, goes in a span that css/tex8web.css floats right, after a gap
-- span that holds the space before the floated part and keeps that part a
-- quad from the text. In a paragraph, the whole line and its <br> also go
-- in a span, which the stylesheet makes a block that holds the float and
-- can be aligned alone.
-- (Not in a heading: make4ht's sectionid makes the heading's anchor its id
-- only while the anchor is the heading's child.)
local function ends_line(node)
  return node:is_element() and (node:get_element_name() == "br" or blocks[node:get_element_name()]
    or is_math(node) and not dom.has_class(node, "mathjax-inline"))
end

local function shows(node)
  return node:is_element() or node:is_text() and node:get_text():find("%S")
end

function M.hfill(document)
  local parents, seen = {}, {}
  for _, mark in ipairs(document:query_selector("span.tex8web-hfill-mark")) do
    local parent = mark:get_parent()
    if not seen[parent] then seen[parent], parents[#parents + 1] = true, parent end
  end
  for _, parent in ipairs(parents) do
    local in_p = parent:get_element_name() == "p"
    -- (line: where out's current line starts; from: where its part after
    -- the line's last mark starts)
    local out, line, from = {}, 1, nil
    local function wrap(first, class)
      local span = parent:create_element("span", {class = class})
      dom.set_children(span, {table.unpack(out, first)})
      for k = #out, first, -1 do out[k] = nil end
      out[#out + 1] = span
    end
    -- (stop: the node that ends the line, if any)
    local function close(stop)
      local shown = false
      for k = from or #out + 1, #out do shown = shown or shows(out[k]) end
      if shown then
        -- (the space before the rest goes in the gap, so that a line
        -- cannot break between the text and the gap)
        if out[from - 1] and out[from - 1]:is_text() then
          dom.set_node_text(out[from - 1], (out[from - 1]:get_text():gsub("%s+$", "")))
        end
        wrap(from, "tex8web-hfill")
        local gap = parent:create_element("span", {class = "tex8web-hfill-gap"})
        gap:add_child_node(gap:create_text_node(" "))
        table.insert(out, #out, gap)
        if in_p then
          if stop and stop:get_element_name() == "br" then out[#out + 1], stop = stop, nil end
          wrap(line, "tex8web-hfill-line")
        end
      end
      if stop then out[#out + 1] = stop end
      line, from = #out + 1, nil
    end
    for _, node in ipairs(parent:get_children()) do
      if dom.has_class(node, "tex8web-hfill-mark") then
        from = #out + 1
      elseif ends_line(node) then
        close(node)
      else
        out[#out + 1] = node
      end
    end
    close()
    dom.set_children(parent, out)
  end
end

-- tex4ht's <!--l. 65--> before each paragraph gives its line in the .tex,
-- which readers do not need and which makes the page larger
function M.line_comments(document)
  document:traverse(function(node)
    if (dom.comment_text(node) or ""):match("^%s*l%.%s*%d+%s*$") then
      document:remove_node(node)
    end
  end)
end

return M
