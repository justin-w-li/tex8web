-- The text around the math.
local dom = require "tex8web.dom"
local files = require "tex8web.files"

local log = logging.new("tex8web")

local M = {}

-- whether a node shows something: text, or a picture, table, or formula
local pictures = {img = true, svg = true, table = true, ["mjx-container"] = true}
local function shows(node)
  if (node:get_text() or ""):find("%S") then return true end
  return node:is_element() and (pictures[node:get_element_name()]
    or #node:query_selector("img, svg, table, mjx-container") > 0)
end

-- whether a caption comes before anything else in its float, minipage, or
-- subfigure, as caption's position=auto decides in TeX
local function first_in_float(caption)
  local node = caption
  while true do
    local parent = node:get_parent()
    if not (parent and parent:is_element()) then return false end
    for _, sibling in ipairs(parent:get_children()) do
      if sibling == node then break end
      if shows(sibling) then return false end
    end
    if parent:get_element_name() == "figure" or dom.has_class(parent, "minipage")
        or dom.has_class(parent, "subfigure") then
      return true
    end
    node = parent
  end
end

-- the space around theorems and captions, which tex8web-text.tex writes
-- in a mark inside each, as TeX knows it only there: a
-- <span class="tex8web-thmskip"> in a theorem's heading, as margins of the
-- theorem, and a <span class="tex8web-capskip"> in a caption, as custom
-- properties of the caption, which the stylesheet's rules for ruled and
-- algorithm2e captions can then override. With the caption package, a
-- caption at the top has the skips the other way round. With position=auto,
-- TeX fixes the position once for each float, and this pass decides it for
-- each caption.
function M.block_spacing(document)
  for _, mark in ipairs(document:query_selector("span.tex8web-thmskip")) do
    local theorem = dom.closest(mark, function(el)
      return el:get_element_name() == "div" and dom.has_class(el, "newtheorem")
    end)
    if theorem then
      dom.add_style(theorem, ("margin-top: %s; margin-bottom: %s"):format(mark:get_attribute("data-before"),
        mark:get_attribute("data-after")))
    end
    mark:remove_node()
  end
  for _, mark in ipairs(document:query_selector("span.tex8web-capskip")) do
    local caption = dom.closest(mark, function(el)
      local name = el:get_element_name()
      return (name == "figcaption" or name == "div") and dom.has_class(el, "caption")
    end)
    if caption then
      local before, after = mark:get_attribute("data-above"), mark:get_attribute("data-below")
      local position = mark:get_attribute("data-position")
      if position == "top" or position == "auto" and first_in_float(caption) then
        before, after = after, before
      end
      dom.add_style(caption, ("--tex8web-caption-before: %s; --tex8web-caption-after: %s"):format(before, after))
    else
      log:warning("a caption's space is lost: no <figcaption> or <div> of class caption holds its mark")
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

-- tex4ht writes the space after a formula outside both the formula and the
-- span of the text's size, so in \small text or a footnote the space would
-- be at the body size. After a formula given its size (tex8web-math.tex),
-- the space goes in the formula's span. (Without prerendering, make4ht's
-- joincharacters filter would move it there; after prerendering, it does
-- not, as the span holds MathJax's elements.)
function M.sized_math_spaces(document)
  for _, el in ipairs(document:query_selector(".mathjax-inline")) do
    local space = el:get_next_node()
    if el:get_attribute("style") and space and space:is_text() and space:get_text():match("^%s+$") then
      el:add_child_node(el:create_text_node(space:get_text()))
      dom.set_node_text(space, "")
    end
  end
end

local narrow = "\u{202F}"

-- where the next no-break space (~) or narrow no-break space (\, in text)
-- in text is, from start
local function next_space(text, start)
  local i, j = text:find("\u{A0}", start, true)
  local k, l = text:find(narrow, start, true)
  if k and (not i or k < i) then return k, l end
  return i, j
end

-- the children of el, with each no-break space as a space in a
-- <span class="tex8web-nbsp">, and each narrow no-break space in a text
-- node of its own
local function mark_nbsp(el)
  local children = {}
  for _, child in ipairs(el:get_children()) do
    local text = child:is_text() and child:get_text() or ""
    if next_space(text, 1) then
      local start = 1
      repeat
        local i, j = next_space(text, start)
        local run = text:sub(start, (i or 0) - 1)
        if run ~= "" then children[#children + 1] = el:create_text_node(run) end
        if i and text:sub(i, j) == narrow then
          children[#children + 1] = el:create_text_node(narrow)
        elseif i then
          local nbsp = el:create_element("span", {class = "tex8web-nbsp"})
          nbsp:add_child_node(nbsp:create_text_node(" "))
          children[#children + 1] = nbsp
        end
        start = (j or 0) + 1
      until not i
    else
      children[#children + 1] = child
    end
  end
  return children
end

-- (tex4ht writes each space of verbatim text as a no-break space)
local function is_verbatim(el)
  local name = el:get_element_name()
  return name == "pre" or name == "code" or dom.has_class(el, "lstlisting")
    or dom.has_class(el, "verbatiminput") or dom.has_class(el, "alltt")
    or dom.has_class(el, "listing") or dom.has_class(el, "listinginput")
    or dom.has_class(el, "verbatimtabinput")
end

local function is_nbsp(node)
  return node:is_element() and node:get_attribute("class") == "tex8web-nbsp"
end

local function is_narrow(node)
  return node:is_text() and node:get_text() == narrow
end

-- the text of a span of tex4ht's fonts (<span class="cmti-10">) that holds
-- only text, or nil. Other spans, as an \fbox or a term, are left out, as
-- splitting one would give two boxes or two terms.
local function span_text(node)
  local classes = node:is_element() and node:get_element_name() == "span" and node:get_attribute("class")
  if not (classes and classes:find("%S")) then return end
  for class in classes:gmatch("%S+") do
    if not dom.is_font_class(class) then return end
  end
  local children = node:get_children()
  return #children == 1 and children[1]:is_text() and children[1]:get_text() or nil
end

-- (also a ~ alone in a span of its font, as in \small text)
local function is_tie(node)
  if not node then return false end
  local text = span_text(node)
  return is_nbsp(node) or is_narrow(node) or text == "\u{A0}" or text == narrow
end

local function is_inline_math(node)
  return node and dom.has_class(node, "mathjax-inline")
end

local function has_nbsp_or_math(el)
  for _, child in ipairs(el:get_children()) do
    if is_inline_math(child) or child:is_text() and next_space(child:get_text(), 1) then return true end
  end
  return false
end

-- the index of the first text or element child after i (the math may
-- follow after a comment)
local function next_child(children, i)
  repeat i = i + 1 until not children[i] or children[i]:is_element() or children[i]:is_text()
  return i
end

local blocks = {p = true, div = true, ul = true, ol = true, li = true, dl = true, dt = true,
  dd = true, h1 = true, h2 = true, h3 = true, h4 = true, h5 = true, h6 = true, table = true,
  caption = true, colgroup = true, col = true, thead = true, tbody = true, tr = true, td = true,
  th = true, figure = true, figcaption = true, aside = true, blockquote = true, pre = true,
  section = true, hr = true}

-- (a <br>, a block, or display math)
local function ends_line(node)
  return node:is_element() and (node:get_element_name() == "br" or blocks[node:get_element_name()]
    or is_math(node) and not dom.has_class(node, "mathjax-inline"))
end

-- the text of node, if it is text or a span of text in tex4ht's fonts
local function text_of(node)
  return node and (node:is_text() and node:get_text() or span_text(node))
end

-- a node like node, text or a span of text in tex4ht's fonts, with text
local function with_text(el, node, text)
  if node:is_text() then return el:create_text_node(text) end
  local copy = node:copy_node()
  dom.set_children(copy, {copy:create_text_node(text)})
  return copy
end

-- the index of the last child that shows something or is a ~, from i
-- on, before the first whitespace. A text child, or a span of text, is
-- split at the whitespace. Inline math with a space at its end
-- (sized_math_spaces) ends the run with it. These end the run before them:
-- - empty text, where text.hfill took the whitespace out
-- - an element with whitespace in it, other than a ~, or where a line ends
-- - an \hfill's gap, or a qed box, which the stylesheet needs as a child of
--   its paragraph
-- (The whitespace in a formula's source is not text.)
local function word_end(el, children, i)
  local last = i - 1
  while children[i] do
    local child, text = children[i], text_of(children[i])
    local head, rest = (text or ""):match("^(%S*)(%s.*)$")
    if head == "" or text == "" then break end
    if head then
      children[i] = with_text(el, child, head)
      table.insert(children, i + 1, with_text(el, child, rest))
      return i
    elseif is_inline_math(child) then
      if child:get_text():find("%s$") then return i end
    elseif child:is_element() and (child:get_text():find("%s") and not is_nbsp(child) or ends_line(child)
        or dom.has_class(child, "tex8web-hfill-gap") or dom.has_class(child, "tex8web-qed")) then
      break
    end
    if shows(child) or is_nbsp(child) then last = i end
    i = i + 1
  end
  return last
end

-- the characters other than whitespace at the end of the last node in
-- wrapped, if it is text or a span of text, taken out of wrapped
local function word_start(el, wrapped)
  local node = wrapped[#wrapped]
  local head, tail = (text_of(node) or ""):match("^(.-)(%S+)$")
  if not tail then return end
  if head == "" then
    wrapped[#wrapped] = nil
    return node
  end
  wrapped[#wrapped] = with_text(el, node, head)
  return with_text(el, node, tail)
end

-- tex4ht writes ~ as a no-break space, which is drawn at the font's
-- width for U+00A0 in Chrome and Firefox and as a space in Safari. So each
-- is written as a space in a span, which css/tex8web.css keeps from
-- collapsing or breaking, as wide as a space in its font. A browser
-- may break a line before and after an atomic inline, as MathJax's
-- inline-block mjx-math is, even next to a no-break space or a letter
-- (CSS Text 3, section 5.1). So a no-break space or a narrow one before
-- inline math (Lemma~$1$, p.\,$5$) is wrapped with the math, and so are
-- the characters right before it and what follows it, up to whitespace
-- ($i$th, ($x$), $n$-dimensional, $n$\textsuperscript{th}). Safari (26.5
-- and 27.0) also breaks between inline math and a no-break space after it
-- ($x$~and), even when the two are wrapped, unless the wrapper reaches the
-- next whitespace.
-- Verbatim text, alltt, and listings are left as they are.
function M.no_break_spaces(document)
  document:traverse_elements(function(el)
    local class = el:get_attribute("class")
    if class == "tex8web-nbsp" or class == "tex8web-nowrap" or not has_nbsp_or_math(el)
        or dom.closest(el, function(up) return is_math(up) or is_verbatim(up) end) then
      return
    end
    local children, wrapped, i = mark_nbsp(el), {}, 1
    while i <= #children do
      local j = next_child(children, i)
      local inline = is_tie(children[i]) and is_inline_math(children[j]) and j
        or is_inline_math(children[i]) and i
      local last, before
      if inline then
        last = word_end(el, children, inline)
        if inline == i then before = word_start(el, wrapped) end
      end
      if last and (last ~= i or before) then
        local nowrap = el:create_element("span", {class = "tex8web-nowrap"})
        if before then nowrap:add_child_node(before) end
        for n = i, last do nowrap:add_child_node(children[n]) end
        wrapped[#wrapped + 1] = nowrap
        i = last + 1
      else
        wrapped[#wrapped + 1] = children[i]
        i = i + 1
      end
    end
    dom.set_children(el, wrapped)
  end)
end

-- HTML parsing drops the first newline of a pre, but not of moreverb's
-- divs. Drop the same newline so these blocks start at the same height.
-- The CSS keeps every space in these divs, so also drop tex4ht's padding
-- spaces on the first line and after the last. Source spaces are no-break
-- spaces, which stay. (The padding may span several text nodes: each edit
-- reads the run of text nodes at that end of the block as one text.)
function M.literal_blocks(document)
  local function edit(nodes, change)
    if #nodes == 0 then return end
    local parts = {}
    for i, node in ipairs(nodes) do parts[i] = node:get_text() end
    for i, node in ipairs(nodes) do dom.set_node_text(node, i == 1 and change(table.concat(parts)) or "") end
  end
  for _, block in ipairs(document:query_selector("div.listing, div.verbatimtabinput")) do
    local children = block:get_children()
    local first, last = {}, {}
    for _, child in ipairs(children) do
      if not child:is_text() then break end
      first[#first + 1] = child
    end
    for i = #children, 1, -1 do
      if not children[i]:is_text() then break end
      table.insert(last, 1, children[i])
    end
    edit(first, function(text) return (text:gsub("^\n", "", 1):gsub("^ +\n", "\n", 1)) end)
    edit(last, function(text) return (text:gsub(" +$", "", 1)) end)
  end
  -- A label that the document defines (tex8web-text.tex) ends in the
  -- spaces of moreverb's \listingoffset, which are in the listing's font,
  -- as after moreverb's numbers. They go after the label's span, in a span
  -- of their own: make4ht's joincharacters (common_domfilters) moves the
  -- space between two spans into the first if it holds only text.
  local paddings, parents, seen = {}, {}, {}
  for _, label in ipairs(document:query_selector("span.tex8web-listing-label")) do
    -- (the last text, which may be in a font span)
    local last = label
    while last and last:is_element() do
      local children = last:get_children()
      last = children[#children]
    end
    local text, spaces = (last and last:is_text() and last:get_text() or ""):match("^(.-)( +)$")
    if spaces then
      dom.set_node_text(last, text)
      local parent = label:get_parent()
      paddings[label] = parent:create_element("span", {class = "tex8web-listing-padding"})
      paddings[label]:add_child_node(paddings[label]:create_text_node(spaces))
      if not seen[parent] then seen[parent], parents[#parents + 1] = true, parent end
    end
  end
  for _, parent in ipairs(parents) do
    local siblings = {}
    for _, child in ipairs(parent:get_children()) do
      siblings[#siblings + 1] = child
      if paddings[child] then siblings[#siblings + 1] = paddings[child] end
    end
    dom.set_children(parent, siblings)
  end
end

-- A literal block whose font spans share one size, as after \small or
-- with \verbatim@font set to it, holds its text in a box of that size,
-- from tex4ht's rules for the spans' classes (the page's stylesheet, or
-- css in a test; a class without a size is at the text's). The spans
-- inherit the box's size (css/tex8web.css), so its lines are as far apart
-- as lines of that size: a block's own size sets the least height of each
-- of its lines. The block keeps the text's size, which its margins use.
function M.literal_sizes(document, context, css)
  css = css or files.read(context.dir .. "/" .. context.input .. ".css") or ""
  local sizes = {}
  for class, rule in css:gmatch("%.([%w-]+)%s*(%b{})") do
    local size = rule:match("font%-size%s*:%s*([%d.]+)%%")
    if size then sizes[class] = tonumber(size) end
  end
  local function size_of(span)
    for class in (span:get_attribute("class") or ""):gmatch("%S+") do
      if dom.is_font_class(class) then return sizes[class] or 100 end
    end
  end
  local function is_label(el)
    return dom.has_class(el, "tex8web-listing-number") or dom.has_class(el, "tex8web-listing-label")
  end
  local function in_label(span, block)
    local el = span:get_parent()
    while el ~= block do
      if is_label(el) then return true end
      el = el:get_parent()
    end
    return false
  end
  for _, block in ipairs(document:query_selector("pre.verbatim, pre.boxedverbatim, div.verbatiminput, "
      .. "div.listing, div.listinginput, div.verbatimtabinput")) do
    -- (moreverb's line numbers are \small at any size of the listing, and
    -- a document's labels have sizes of their own: a label is at the
    -- text's size, and each font span in it at its class's size)
    local size, same, labels, inside = nil, true, {}, {}
    for _, span in ipairs(block:query_selector("span")) do
      if is_label(span) then
        labels[#labels + 1] = span
      elseif in_label(span, block) then
        inside[#inside + 1] = span
      else
        local own = size_of(span)
        if own and size and size ~= own then same = false end
        size = own or size
      end
    end
    if same and size and size ~= 100 then
      for _, label in ipairs(labels) do
        dom.add_style(label, ("font-size: %g%%"):format(100 / size * 100))
      end
      for _, span in ipairs(inside) do
        local own = size_of(span)
        if own then dom.add_style(span, ("font-size: %g%%"):format(own)) end
      end
      local box = block:create_element("span", {class = "tex8web-sized-literal", style = "font-size: " .. size .. "%"})
      local children = block:get_children()
      -- (the newline a browser drops right after <pre>, and would keep in
      -- the box)
      if block:get_element_name() == "pre" and children[1] and children[1]:is_text() then
        dom.set_node_text(children[1], (children[1]:get_text():gsub("^\n", "", 1)))
      end
      dom.set_children(block, {box})
      for _, child in ipairs(children) do box:add_child_node(child) end
    end
  end
end

-- Short inline literals keep opening punctuation on their line. Only
-- longer literals need a constrained box on a narrow screen. A literal of
-- 20 characters is at most about 11em wide (a typewriter character is
-- about 0.525em), half of a phone's column of about 22em, so it fits on a
-- line with its punctuation.
function M.long_literals(document)
  for _, code in ipairs(document:query_selector("code.verb, code.lstinline")) do
    if utf8.len(code:get_text()) > 20 then
      local parent = code:get_parent()
      local box = parent:create_element("span", {class = "tex8web-long-literal"})
      local children = parent:get_children()
      for i, child in ipairs(children) do
        if child == code then children[i] = box end
      end
      dom.set_children(parent, children)
      box:add_child_node(code)
    end
  end
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

local function is_empty_paragraph(node)
  return node:is_element() and node:get_element_name() == "p" and dom.is_blank(node)
end

-- (an <a id> with nothing in it)
local function is_anchor(node)
  return node:is_element() and node:get_element_name() == "a" and not node:get_attribute("href")
    and #node:get_children() == 0
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
        -- add a paragraph's space at the top of a box. The anchors a
        -- \refstepcounter left before the row go to the top of its first
        -- minipage: fixinlines would put them in a paragraph, which would
        -- add the same space, for example between two [H] algorithms of
        -- algorithm2e.)
        local k, anchors = #out, {}
        while k > 0 and (is_space(out[k]) or is_anchor(out[k]) or is_empty_paragraph(out[k])) do
          if is_anchor(out[k]) then
            table.insert(anchors, 1, table.remove(out, k))
          elseif is_empty_paragraph(out[k]) then
            table.remove(out, k)
          end
          k = k - 1
        end
        if #anchors > 0 then
          local first = dom.elements(row)[1]
          local inside = first:get_children()
          for n = #anchors, 1, -1 do table.insert(inside, 1, anchors[n]) end
          dom.set_children(first, inside)
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

-- The vertical-align that lowers a picture by ratio times its width, a
-- CSS length. img's max-width (css/tex8web.css) can shrink the picture to
-- the column, which then gives the width.
local function lowered(width, ratio)
  return string.format("vertical-align:calc(min(%s, var(--tex8web-column)) * %.4f)", width, ratio)
end

-- pictures that dvisvgm draws for tex4ht (TikZ, as <document>0x.svg and so
-- on), as wide as in the PDF, as a share of the PDF's text width, which the
-- stylesheet's text width also is. dvisvgm writes the size of what is
-- drawn (--exact), which can differ from TeX's box, in bp and scaled by
-- tex4ht.env's -c (1.4), which it records as the page's matrix. A picture
-- between the marks of \scalebox or \resizebox (span.tex8web-scale, with
-- the factors, and span.tex8web-scale-end) is drawn at its natural size,
-- so its width is multiplied by the factors of the boxes around it, as is
-- the width that tex8web-text.tex gives an \includegraphics. A picture
-- that pgf lowers or raises has its baseline's y in the SVG
-- (g.tex8web-baseline), from which its vertical-align is set. A negative
-- factor mirrors or turns over any picture, drawn or not, with a transform.
-- tex4ht rotates a box in a span.rotatebox, so a box's mirror goes on the
-- outermost such span inside the box, before its rotation, as in the PDF.
function M.pictures(document, context)
  local scales, marks, depths, flipped = {{1, 1}}, {}, {}, {}
  local sign = function(v) return v < 0 and -1 or 1 end
  document:traverse_elements(function(el)
    if dom.has_class(el, "rotatebox") then depths[el] = #scales end
    if dom.has_class(el, "tex8web-scale") then
      local x, y = scales[#scales][1], scales[#scales][2]
      scales[#scales + 1] = {x * tonumber(el:get_attribute("data-x")), y * tonumber(el:get_attribute("data-y")),
        w = tonumber(el:get_attribute("data-w")), h = tonumber(el:get_attribute("data-h")), imgs = {}}
      marks[#marks + 1] = el
    elseif dom.has_class(el, "tex8web-scale-end") then
      -- (a \resizebox that holds one converted picture whose bounding box
      -- TeX could not read: the size asked for, in place of the factor,
      -- which comes from a 72bp square)
      local box = scales[#scales]
      local img = #box.imgs == 1 and box.imgs[1]
      if (box.w or box.h) and img and img:get_attribute("data-tex8web-size") then
        local share = string.format("%.4f", (box.w or box.h) / context.textwidth)
        img:set_attribute("data-tex8web-size", string.format("%s,%s,1,%.4f",
          box.w and share or "-", box.w and "-" or share, math.abs(scales[#scales - 1][1])))
      end
      scales[#scales] = nil
      marks[#marks + 1] = el
    end
    if el:get_element_name() ~= "img" then return end
    for level = 2, #scales do table.insert(scales[level].imgs, el) end
    local x, y = math.abs(scales[#scales][1]), math.abs(scales[#scales][2])
    local src = el:get_attribute("src") or ""
    if src:sub(1, #context.input) == context.input and src:sub(#context.input + 1):match("^%d+x%.svg$") then
      local svg = files.read(context.dir .. "/" .. src)
      if not svg then error(src .. " is missing: dvisvgm did not write it") end
      local _, top, width, height = (svg:match("<svg[^>]- viewBox='([^']+)'") or ""):match("^(%S+) (%S+) (%S+) (%S+)$")
      if not width then error("no viewBox in " .. src) end
      local scale = tonumber(svg:match("<g id='page1' transform='matrix%(([%d.]+) 0 0 ")) or 1
      local share = 72.27 / 72 / scale / context.textwidth -- of a unit of the SVG
      local wide = share * x * width
      dom.add_style(el, string.format("width:calc(var(--tex8web-textwidth) * %.4f)", wide))
      local baseline = svg:match("<g class='tex8web%-baseline' data%-y='([-%d.]+)'")
      local below = baseline and top + height - scale * baseline or 0
      -- (turned over, as graphics.sty swaps the box's height and depth)
      if scales[#scales][2] < 0 then below = height - below end
      -- (in display math, the picture is a block: css/tex8web.css)
      if below ~= 0 and not dom.closest(el, function(block) return dom.has_class(block, "mathjax-block") end) then
        dom.add_style(el, lowered(string.format("var(--tex8web-textwidth) * %.4f", wide), -share * y * below / wide))
      end
      if y ~= x then
        if not svg:find("preserveAspectRatio") then
          local f = io.open(context.dir .. "/" .. src, "w")
          f:write((svg:gsub("<svg ", "<svg preserveAspectRatio='none' ", 1)))
          f:close()
        end
        dom.add_style(el, string.format("aspect-ratio:%.4f", x * width / (y * height)))
      end
    else
      local style = el:get_attribute("style")
      local wide = style and tonumber(style:match("width:calc%(var%(%-%-tex8web%-textwidth%) %* ([%d.]+)%)"))
      if x ~= 1 and wide then
        wide = x * wide
        el:set_attribute("style", (style:gsub("(width:calc%(var%(%-%-tex8web%-textwidth%) %* )[%d.]+%)",
          function(start) return string.format("%s%.4f)", start, wide) end)))
      end
      -- (a converted picture whose bounding box TeX could not read gets its
      -- width later, in assets.convert, which multiplies it by this factor)
      local size = el:get_attribute("data-tex8web-size")
      if x ~= 1 and size then el:set_attribute("data-tex8web-size", string.format("%s,%.4f", size, x)) end
      -- (an \includegraphics: the height that tex8web-text.tex writes beside
      -- a width, as a share of the text width. Only the width is scaled, so
      -- the picture is shown x times that high, whatever y is. tex4ht's
      -- size stays unscaled, so a picture at its natural size is lowered by
      -- its whole height.)
      local height = tonumber(el:get_attribute("data-tex8web-height"))
      el:set_attribute("data-tex8web-height", nil)
      -- (turned over, as graphics.sty swaps the box's height and depth)
      if scales[#scales][2] < 0 and height then
        dom.add_style(el, lowered(string.format("var(--tex8web-textwidth) * %.4f", wide), -x * height / wide))
      elseif scales[#scales][2] < 0 and el:get_attribute("height") then
        dom.add_style(el, lowered(el:get_attribute("width") .. "px", -el:get_attribute("height") / el:get_attribute("width")))
      end
    end
    -- (each box's signs, on the outermost span.rotatebox inside the box,
    -- or else on the picture. Every span.rotatebox has a transform, from
    -- html4.4ht, which the signs go before.)
    local rotations, up = {}, el:get_parent()
    while up and up:is_element() do
      if depths[up] then table.insert(rotations, 1, up) end
      up = up:get_parent()
    end
    local flips = {}
    for level = 2, #scales do
      local target = el
      for _, span in ipairs(rotations) do
        if depths[span] >= level then target = span break end
      end
      local f = flips[target] or {1, 1}
      flips[target] = {f[1] * sign(scales[level][1]) * sign(scales[level - 1][1]),
        f[2] * sign(scales[level][2]) * sign(scales[level - 1][2])}
    end
    for target, f in pairs(flips) do
      if (f[1] < 0 or f[2] < 0) and not flipped[target] then
        local scale = string.format("scale(%d, %d)", f[1], f[2])
        if target ~= el then
          target:set_attribute("style", (target:get_attribute("style"):gsub("transform:%s*", "transform: " .. scale .. " ", 1)))
          flipped[target] = true
        else
          dom.add_style(target, "transform:" .. scale)
        end
      end
    end
  end)
  for _, mark in ipairs(marks) do mark:remove_node() end
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
-- can be aligned alone. A break mark (span.tex8web-break, from \break or
-- \linebreak) after text on its line becomes a <br>. One with nothing
-- before it is dropped, as tex4ht's \hfill\break in list labels
-- (latex.4ht) and in the index (html4.4ht) starts a line.
-- (Not in a heading: make4ht's sectionid makes the heading's anchor its id
-- only while the anchor is the heading's child.)
-- (an empty anchor, as before a theorem's head, shows nothing)
local function shows(node)
  return node:is_text() and node:get_text():find("%S")
    or node:is_element() and (node:get_element_name() == "img" or not dom.is_blank(node))
end

function M.hfill(document)
  local parents, seen = {}, {}
  for _, class in ipairs({"tex8web-hfill-mark", "tex8web-break"}) do
    for _, mark in ipairs(document:query_selector("span." .. class)) do
      local parent = mark:get_parent()
      if not seen[parent] then seen[parent], parents[#parents + 1] = true, parent end
    end
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
        -- cannot break between the text and the gap. The space can be at
        -- the end of an element, as in \textbf{a \hfill b})
        local before = out[from - 1]
        while before and before:is_element() and not ends_line(before) do
          local children = before:get_children()
          before = children[#children]
        end
        if before and before:is_text() then
          dom.set_node_text(before, (before:get_text():gsub("%s+$", "")))
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
      elseif dom.has_class(node, "tex8web-break") then
        local shown = false
        for k = line, #out do shown = shown or shows(out[k]) end
        if shown then close(parent:create_element("br", {class = "newline"})) end
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

-- a paragraph cell's alignment (tex8web-text.tex), moved from the mark
-- at the cell's end onto its <td>, in place of tex4ht's text-align:left.
-- A \multicolumn's text is in a div with a text-align of its own
-- (\HColAlign, html4.4ht), which takes the alignment instead. tex4ht
-- closes that div before the cell's end, and so before the mark.
function M.cell_align(document)
  local marks = {}
  document:traverse(function(node)
    local align = (dom.comment_text(node) or ""):match("^tex8web%-cell%-align (%a+)$")
    if align then marks[#marks + 1] = {node, align} end
  end)
  for _, entry in ipairs(marks) do
    local mark, align = entry[1], entry[2]
    local cell = mark:get_parent()
    while cell:get_element_name() ~= "td" do
      cell = assert(cell:get_parent(), "tex8web: a cell's alignment mark outside its cell")
    end
    for _, child in ipairs(cell:get_children()) do
      if dom.has_class(child, "multicolumn") then cell = child break end
    end
    cell:set_attribute("style", (cell:get_attribute("style"):gsub("text%-align:%a+", "text-align:" .. align)))
    mark:remove_node()
  end
end

-- url.sty sets the characters of \UrlBreaks as binary operators, those of
-- \UrlBigBreaks as relations, and those of \UrlNoBreaks as opening atoms
local function url_atom(c)
  if c == ":" then return "rel" end
  if c:match("[%.@\\/!_|;>%]%),%?&'+=#%%]") then return "bin" end
  if c:match("[%(%[{<]") then return "open" end
  return "ord"
end

-- the positions in url after which TeX may end a line: after a binary
-- operator, and after a relation not followed by another. A binary operator
-- that comes first, or after another operator, a relation, or an opening
-- atom, is an ordinary one, and so is one before a relation (The TeXbook,
-- appendix G, rules 5, 6, and 20).
local function url_break_points(url)
  local atoms, points = {}, {}
  for i = 1, #url do
    local atom = url_atom(url:sub(i, i))
    local before = atoms[i - 1]
    if atom == "bin" and (i == 1 or before == "bin" or before == "rel" or before == "open") then atom = "ord" end
    if atom == "rel" and before == "bin" then atoms[i - 1] = "ord" end
    atoms[i] = atom
  end
  for i = 1, #url - 1 do
    points[i] = atoms[i] == "bin" or atoms[i] == "rel" and atoms[i + 1] ~= "rel"
  end
  return points
end

local function text_nodes(el, nodes)
  for _, child in ipairs(el:get_children()) do
    if child:is_text() then nodes[#nodes + 1] = child
    elseif child:is_element() then text_nodes(child, nodes) end
  end
  return nodes
end

-- A <wbr> where url.sty lets a line end, in a \url, a \path, and a
-- \nolinkurl (tex8web-text.tex). Without one, a URL is a single word to a
-- browser: it moves to the next line whole, or breaks at any character
-- (html4.4ht's overflow-wrap). No <wbr> goes in a scheme or right after its
-- //, where "https://" would end a line alone, or after the last character,
-- where the punctuation after a URL would wrap alone.
function M.url_breaks(document)
  for _, el in ipairs(document:query_selector("a.url, span.path, span.tex8web-nolinkurl")) do
    local nodes = text_nodes(el, {})
    local url = {}
    for i, node in ipairs(nodes) do url[i] = node:get_text() end
    url = table.concat(url)
    local points = url_break_points(url)
    local from = url:match("^%a[%w+.-]*://()") or 1
    local offset = 0
    for _, node in ipairs(nodes) do
      local text, parent = node:get_text(), node:get_parent()
      local pieces, start = {}, 1
      for i = 1, #text do
        local at = offset + i
        if at >= from and points[at] then
          pieces[#pieces + 1] = parent:create_text_node(text:sub(start, i))
          pieces[#pieces + 1] = parent:create_element("wbr")
          start = i + 1
        end
      end
      offset = offset + #text
      if #pieces > 0 then
        if start <= #text then pieces[#pieces + 1] = parent:create_text_node(text:sub(start)) end
        local children = {}
        for _, child in ipairs(parent:get_children()) do
          if child == node then
            for _, piece in ipairs(pieces) do children[#children + 1] = piece end
          else
            children[#children + 1] = child
          end
        end
        dom.set_children(parent, children)
      end
    end
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
