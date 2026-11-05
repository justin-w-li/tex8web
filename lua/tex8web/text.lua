-- The text around the math.
local dom = require "tex8web.dom"

local M = {}

-- theorem spacing, which the cfg leaves in a <span class="tex8web-thmskip"> in the
-- heading (TeX knows it only once the theorem has started)
function M.theorem_spacing(document)
  for _, mark in ipairs(document:query_selector("span.tex8web-thmskip")) do
    local div = dom.closest(mark, function(el)
      return el:get_element_name() == "div" and dom.has_class(el, "%f[%w-]newtheorem%f[^%w-]")
    end)
    if div then
      div:set_attribute("style", "margin-top: " .. mark:get_attribute("data-before")
        .. "; margin-bottom: " .. mark:get_attribute("data-after"))
    end
    mark:remove_node()
  end
end

-- a list just under a heading, without the empty paragraph html4.4ht opens
-- there before an enumerate or a description, through which the list's
-- margin would still collapse with the heading's (css/tex8web.css sets it
-- as LaTeX does, with no \topsep under a heading)
function M.heading_lists(document)
  for _, list in ipairs(document:query_selector("ol, ul, dl")) do
    local p = dom.previous_element(list)
    local heading = p and dom.previous_element(p)
    if heading and heading:get_element_name():match("^h[2-6]$") and p:get_element_name() == "p"
        and #dom.elements(p) == 0 and not p:get_text():find("%S") then
      p:remove_node()
    end
  end
end

-- the space between a heading's number and its title, as one space in a
-- <span class="tex8web-labelsep">, which css/tex8web.css makes as wide as
-- in the PDF: tex4ht writes it as spaces (and KOMA's as no-break spaces),
-- in the number and after it, which the browser would collapse into one
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
  return dom.has_class(el, "^mathjax%-")
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

local function is_nbsp(node)
  return node:is_element() and node:get_attribute("class") == "tex8web-nbsp"
end

-- tex4ht writes ~ as a no-break space, which Latin Modern draws half again
-- as wide as a space; mark each so the CSS can narrow it. A browser still
-- breaks the line between one and the math after it (Lemma~$1$), so wrap the
-- two together
function M.no_break_spaces(document)
  document:traverse_elements(function(el)
    local class = el:get_attribute("class")
    if class == "tex8web-nbsp" or class == "tex8web-nowrap" or not has_nbsp(el)
        or dom.closest(el, is_math) then
      return
    end
    local children, wrapped, i = mark_nbsp(el), {}, 1
    while i <= #children do
      local j = i + 1
      -- (the math may follow after a comment)
      while children[j] and not children[j]:is_element() and not children[j]:is_text() do
        j = j + 1
      end
      if is_nbsp(children[i]) and children[j] and dom.has_class(children[j], "^mathjax%-inline") then
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
-- them on one line of the PDF, with nothing but space between, in one row.
-- One that begins a paragraph (tex8web-par) starts a new line
local function is_minipage(node)
  return node:is_element() and node:get_element_name() == "div"
    and (dom.has_class(node, "^minipage ") or dom.has_class(node, "^subfigure "))
end

-- (~ between two is a space too)
local function is_space(node)
  if node:is_text() then return not node:get_text():find("%S") end
  return not node:is_element() or node:get_attribute("class") == "tex8web-nbsp"
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
              or dom.has_class(children[k], "tex8web%-par") then
            break
          end
          row:add_child_node(children[k])
          j = k + 1
        end
        -- (\noindent's empty paragraph before it, which would only add
        -- the space between paragraphs at the top of a box)
        local before = out[#out]
        if before and before:is_element() and before:get_element_name() == "p"
            and #before:get_children() == 0 then
          out[#out] = nil
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

-- footnotes (tex4ht's, at the end of the page with fn-in, which
-- tex8web.mk4 sets) each after the paragraph, list or theorem that holds
-- its mark, in order; css/tex8web.css puts them beside it on a wide
-- screen. A footnote in a table, a figure, a box or math stays where it
-- was. \thanks, which fn-in also puts there, goes back under the title
local function stays(el)
  local name = el:get_element_name()
  return name == "table" or name == "figure" or dom.has_class(el, "^tcolorbox") or is_math(el)
end

local function is_top(el)
  local name = el:is_element() and el:get_element_name()
  return not name or name == "body" or name == "section" or name == "main"
end

function M.sidenotes(document)
  local list = document:query_selector("div.footnotes")[1]
  if not list then return end
  local last = {} -- the last note put after each block
  for _, note in ipairs(list:query_selector("aside.footnotetext")) do
    local back = note:query_selector("span.footnote-mark a")[1]
    local id = (back and back:get_attribute("href") or ""):match("^#(.+)")
    local mark = id and document:query_selector("[id='" .. id .. "']")[1]
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

-- \color as a declaration ({\color{red} text}): tex8web-page.tex marks where
-- it is set (span.tex8web-color, the color in data-color) and where its group
-- ends (span.tex8web-color-end). What lies between takes the color: a block
-- wholly between them on itself, the rest in a span around each run of
-- inline content. tcolorbox's boxes keep their own colors, as in the PDF.
-- tex4ht's link text isn't a group, as hyperref's is in the PDF, so a color
-- set in a link ends with it
local blocks = {p = true, div = true, ul = true, ol = true, li = true, dl = true, dt = true,
  dd = true, h1 = true, h2 = true, h3 = true, h4 = true, h5 = true, h6 = true, table = true,
  tr = true, td = true, th = true, figure = true, figcaption = true, aside = true,
  blockquote = true, pre = true, center = true}

local function is_mark(node)
  return dom.has_class(node, "^tex8web%-color")
end

-- each node under root, numbered where it opens and where it closes
local function number(root)
  local open, close, n = {}, {}, 0
  local function walk(node)
    n = n + 1
    open[node] = n
    if node:is_element() then
      for _, child in ipairs(node:get_children()) do walk(child) end
    end
    n = n + 1
    close[node] = n
  end
  walk(root)
  return open, close
end

local function color(root, from, to, value)
  local open, close = number(root)
  local s, e = open[from], to and open[to] or close[root]
  local function visit(el)
    local out, run = {}, nil
    for _, node in ipairs(el:get_children()) do
      local inside = open[node] > s and close[node] < e
      local block = node:is_element() and blocks[node:get_element_name()]
      if inside and not block and (run or node:is_element() and not is_mark(node)
          or node:is_text() and node:get_text():find("%S")) then
        if not run then
          run = el:create_element("span", {style = "color:" .. value .. ";"})
          out[#out + 1] = run
        end
        run:add_child_node(node)
      else
        run = nil
        out[#out + 1] = node
        if node:is_element() and not dom.has_class(node, "^tcolorbox") then
          if inside then
            local style = node:get_attribute("style")
            node:set_attribute("style", (style and style:gsub(";?%s*$", "; ") or "")
              .. "color:" .. value .. ";")
          elseif close[node] > s and open[node] < e then
            visit(node)
          end
        end
      end
    end
    dom.set_children(el, out)
  end
  visit(root)
end

local function within(node, el)
  return dom.closest(node, function(x) return x == el end) ~= nil
end

local function color_from(from, to, body)
  local value = from:get_attribute("data-color")
  if not within(from, body) then return end
  local link = dom.closest(from, function(el) return el:get_element_name() == "a" end)
  if link and not (to and within(to, link)) then return color(link, from, nil, value) end
  local root = to and from:get_parent() or body
  while to and not within(to, root) do root = root:get_parent() end
  color(root, from, to, value)
end

function M.colors(document)
  local body = document:query_selector("body")[1]
  local marks, starts = {}, {}
  local function walk(el)
    for _, node in ipairs(dom.elements(el)) do
      if is_mark(node) then marks[#marks + 1] = node else walk(node) end
    end
  end
  -- (and in the page's <title>, which takes no color)
  walk(document:query_selector("html")[1])
  for _, mark in ipairs(marks) do
    if dom.has_class(mark, "^tex8web%-color$") then
      starts[#starts + 1] = mark
    elseif #starts > 0 then
      color_from(table.remove(starts), mark, body)
    end
  end
  for _, from in ipairs(starts) do color_from(from, nil, body) end
  -- (a mark set between paragraphs is alone in a paragraph of its own)
  for _, mark in ipairs(marks) do
    local parent = mark:get_parent()
    mark:remove_node()
    if parent:get_element_name() == "p" and not parent:get_attribute("class")
        and #dom.elements(parent) == 0 and not parent:get_text():find("%S") then
      parent:remove_node()
    end
  end
end

return M
