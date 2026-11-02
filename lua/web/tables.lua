-- Arrays and amsmath's alignments, spaced as TeX spaces them.
local dom = require "web.dom"

local M = {}

local function is_empty_row(mtr)
  for _, mtd in ipairs(dom.children(mtr)) do
    if #dom.children(mtd) > 0 or mtd:get_text():match("%S") then return false end
  end
  return true
end

local function is_space_row(mtr)
  for _, mtd in ipairs(dom.children(mtr)) do
    for _, child in ipairs(dom.children(mtd)) do
      if child:get_element_name() ~= "mspace" then return false end
    end
    if mtd:get_text():match("%S") then return false end
  end
  return true
end

local function is_hline(row)
  return row and row:get_attribute("class") == "array-hline"
end

-- TeX sets each row on a strut, 0.7 and 0.3 of the baselineskip (times
-- \arraystretch) above and below the baseline
local function strut_rows(mtable, baselineskip, stretch)
  for _, mtr in ipairs(dom.children(mtable)) do
    local mtd = dom.children(mtr)[1]
    if mtd and mtd:get_element_name() == "mtd" and not is_hline(mtr) then
      mtd:add_child_node(mtd:create_element("mspace", {width = "0em",
        height = string.format("%.3fem", 0.7 * baselineskip * stretch),
        depth = string.format("%.3fem", 0.3 * baselineskip * stretch)}), 1)
    end
  end
end

-- whether mtable is cases' table (and not a table in one of its cells)
local function inside_cases(mtable)
  local found = dom.closest(mtable:get_parent(), function(el)
    local name = el:get_element_name()
    return name == "math" or name == "mtd" or el:get_attribute("class") == "cases"
  end)
  return found ~= nil and found:get_attribute("class") == "cases"
end

-- array, matrices, cases
local function array(mtable, baselineskip)
  local class = mtable:get_attribute("class")
  -- \hline comes out as a row of its own, with an empty row on each side
  local rows = dom.children(mtable)
  for i, row in ipairs(rows) do
    if row:get_attribute("class") == "array-row" and is_empty_row(row)
        and (is_hline(rows[i - 1]) or is_hline(rows[i + 1])) then
      row:remove_node()
    end
  end
  -- cases' cells already hold the \quad between its columns
  local cases = class == "dcases" or inside_cases(mtable)
  mtable:set_attribute("columnspacing", cases and "0em" or "1em")
  -- rows on struts as tall as a line (\arraystretch is 1.2 in cases), with
  -- nothing in between
  if baselineskip then strut_rows(mtable, baselineskip, cases and 1.2 or 1) end
  mtable:set_attribute("rowspacing", "0em")
  -- array cells are in text style, dcases' in display style (tex4ht writes
  -- both the other way round)
  mtable:set_attribute("displaystyle", class == "dcases" and "true" or "false")
  -- tex4ht lists a rule under the first row only (rowlines="solid"), which
  -- MathML repeats for every row after it
  local rowlines, n = {}, #dom.children(mtable)
  for line in (mtable:get_attribute("rowlines") or ""):gmatch("%S+") do rowlines[#rowlines + 1] = line end
  if #rowlines > 0 and #rowlines < n - 1 then
    for i = #rowlines + 1, n - 1 do rowlines[i] = "none" end
    mtable:set_attribute("rowlines", table.concat(rowlines, " "))
  end
end

-- \intertext comes out as a row spanning the table, whose text MathJax
-- doesn't wrap: the table gets as wide as the text, and the equations end up
-- scrolled out of view. split the table there, with the text as a paragraph
-- between the parts (which lose their common alignment)
local function split_at_intertext(mtable)
  local math = mtable:get_parent()
  if not (dom.is_named(math, "math") and #mtable:query_selector("mtd.intertext") > 0) then
    return
  end
  local parts, rows, after_text = {}, {}, false
  local function add_table()
    if #rows == 0 then return end
    local part = math:create_element("math", dom.attributes(math))
    local part_table = part:create_element("mtable", dom.attributes(mtable), part)
    part:add_child_node(part_table)
    for _, row in ipairs(rows) do part_table:add_child_node(row) end
    parts[#parts + 1], rows = part, {}
  end
  for _, mtr in ipairs(dom.children(mtable)) do
    local intertext = mtr:query_selector("mstyle.intertext")[1]
    if intertext then
      add_table()
      local text = math:create_element("span", {class = "intertext"})
      for _, child in ipairs(dom.children(intertext)) do
        if child:get_element_name() == "mtext" then
          -- (with ordinary spaces: tex4ht writes no-break ones in <mtext>)
          text:add_child_node(text:create_text_node((child:get_text():gsub("\u{A0}", " "))))
        else
          local inline = text:create_element("math", {display = "inline"})
          for _, token in ipairs(child:get_children()) do inline:add_child_node(token) end
          text:add_child_node(inline)
        end
      end
      parts[#parts + 1] = text
      after_text = true
    elseif not (after_text and is_space_row(mtr)) then
      -- (skipping the row of space tex4ht puts after the text)
      rows[#rows + 1] = mtr
      after_text = false
    end
  end
  add_table()
  dom.replace_with(math, parts)
end

-- the cell holding a row's equation number, if any
local function is_label(mtd)
  return #mtd:query_selector("mstyle.maketag") > 0
end

-- put the equation number at the right edge, as in the PDF (tex4ht puts it
-- in a column of its own, right after the equations)
local function label_row(mtr, label)
  dom.rename(mtr, "mlabeledtr")
  mtr:add_child_node(label, 1)
end

-- amsmath starts each right-hand column (&= b) with {}, so a relation or
-- binary operator there (after any \quad) gets its space on the left
local function open_column(mtd)
  local children = dom.children(mtd)
  local k = 1
  while children[k] and children[k]:get_element_name() == "mspace" do k = k + 1 end
  local class = children[k] and children[k]:get_attribute("data-mjx-texclass")
  if class == "REL" or class == "BIN" then
    mtd:add_child_node(mtd:create_element("mi"), children[1]:find_element_pos())
  end
end

-- align, alignat, flalign, gather and their starred forms; aligned,
-- alignedat, gathered and split: rows a line apart (on struts) plus \jot;
-- each pair of columns snug, and pairs 2em apart (a &= b && c &= d), or as
-- the author spaces them in alignat
local function alignment(mtable, baselineskip)
  local class = mtable:get_attribute("class")
  if baselineskip then strut_rows(mtable, baselineskip, 1) end
  mtable:set_attribute("rowspacing", "3pt")
  local columns = 0
  for _, mtr in ipairs(dom.children(mtable)) do
    local label
    for i, mtd in ipairs(dom.children(mtr)) do
      local cell = mtd:get_attribute("class")
      if cell == "align-label" or is_label(mtd) then
        -- (align* leaves the number's cell empty, where it still pushes the
        -- equations off center)
        mtd:remove_node()
        if not label and is_label(mtd) then label = mtd end
      elseif cell == "align-even" then
        -- the gap tex4ht leaves before the number column
        local children = dom.children(mtd)
        local last = children[#children]
        if last and last:get_element_name() == "mspace" then last:remove_node() end
        open_column(mtd)
      elseif i % 2 == 0 and cell ~= "align-odd" and class ~= "gather"
          and class ~= "gather-star" and class ~= "gathered" then
        -- (aligned's and split's cells have no class)
        open_column(mtd)
      end
    end
    columns = math.max(columns, #dom.children(mtr))
    if label then label_row(mtr, label) end
  end
  local spacing = {}
  for i = 1, columns - 1 do
    spacing[i] = (i % 2 == 1 or class:match("^alignat")) and "0em" or "2em"
  end
  mtable:set_attribute("columnspacing", #spacing > 0 and table.concat(spacing, " ") or "0em")
  split_at_intertext(mtable)
end

-- multline: the first line flush left, the last flush right, the others
-- centered. (In the PDF the first and last lines reach the margins; here
-- they reach the edges of the widest line, which keeps the equation number
-- in view and the display scrollable)
local function multline(mtable, baselineskip)
  if baselineskip then strut_rows(mtable, baselineskip, 1) end
  mtable:set_attribute("rowspacing", "3pt")
  local rows = dom.children(mtable)
  for i, mtr in ipairs(rows) do
    local label
    for _, mtd in ipairs(dom.children(mtr)) do
      if mtd:get_attribute("class") == "multline" and #dom.children(mtd) == 0 then
        -- (an empty cell before each line of a numbered multline)
        mtd:remove_node()
      elseif is_label(mtd) then
        mtd:remove_node()
        label = mtd
      else
        mtd:set_attribute("columnalign", i == 1 and "left" or i == #rows and "right" or "center")
      end
    end
    if label then label_row(mtr, label) end
  end
end

-- smallmatrix: in script style, as tightly spaced as MathJax's TeX input
-- sets it
local function smallmatrix(mtable)
  dom.wrap(mtable, "mstyle", {scriptlevel = "1"})
  mtable:set_attribute("columnspacing", "0.333em")
  mtable:set_attribute("rowspacing", "0.2em")
end

local alignments = {}
for _, class in ipairs{"align", "align-star", "alignat", "alignat-star", "flalign",
                       "flalign-star", "gather", "gather-star", "aligned", "alignedat",
                       "gathered", "split"} do
  alignments[class] = true
end

function M.tables(document, tex)
  local baselineskip = tonumber(tex.baselineskip)
  for _, mtable in ipairs(document:query_selector("mtable")) do
    local class = mtable:get_attribute("class")
    local first_row = dom.children(mtable)[1]
    if class == "array" or class == "dcases" then
      array(mtable, baselineskip)
    elseif alignments[class] then
      alignment(mtable, baselineskip)
    elseif class == "multline" or class == "multline-star" then
      multline(mtable, baselineskip)
    elseif first_row and first_row:get_attribute("class") == "smallmatrix" then
      smallmatrix(mtable)
    end
  end
end

return M
