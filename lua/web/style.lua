-- Math styles and alphabets that tex4ht loses or gets wrong.
local dom = require "web.dom"
local mathml = require "web.mathml"

local M = {}

-- tex4ht drops \textstyle (\textstyle\sum_i in a display); the cfg marks
-- where it was, and it applies to the rest of its row
function M.textstyle(document)
  for _, mark in ipairs(document:query_selector("mi.textstyle")) do
    local row = mark:get_parent()
    local before, after, seen = {}, {}, false
    for _, child in ipairs(row:get_children()) do
      if child == mark then
        seen = true
      elseif seen then
        after[#after + 1] = child
      else
        before[#before + 1] = child
      end
    end
    local mstyle = row:create_element("mstyle", {displaystyle = "false"})
    dom.set_children(mstyle, after)
    before[#before + 1] = mstyle
    dom.set_children(row, before)
  end
end

-- \bm comes out bold upright, like \mathbf (make4ht later turns <mi>Q</mi>
-- under mathvariant="bold" into 𝐐); write its letters as bold italic
-- characters instead. Latin letters are plain ASCII here, and lowercase Greek
-- either plain (β) or math italic (𝜃)
local greek_variants = {
  [0x3F5] = 0x1D750, [0x3D1] = 0x1D751, [0x3F0] = 0x1D752, -- ϵ ϑ ϰ
  [0x3D5] = 0x1D753, [0x3F1] = 0x1D754, [0x3D6] = 0x1D755, -- ϕ ϱ ϖ
}
local function bold_italic(text)
  return (text:gsub(utf8.charpattern, function(ch)
    local c = utf8.codepoint(ch)
    if c >= 0x41 and c <= 0x5A then return utf8.char(c - 0x41 + 0x1D468) end
    if c >= 0x61 and c <= 0x7A then return utf8.char(c - 0x61 + 0x1D482) end
    if c >= 0x3B1 and c <= 0x3C9 then return utf8.char(c - 0x3B1 + 0x1D736) end
    if greek_variants[c] then return utf8.char(greek_variants[c]) end
    if c >= 0x1D6E2 and c <= 0x1D71B then return utf8.char(c + 0x3A) end
    return ch
  end))
end

-- (the cfg marks \bm with <mstyle class="bm">); upright bold Greek capitals
-- keep their mathvariant, and operator names (\bm\det) stay upright
function M.bold_symbols(document)
  for _, bm in ipairs(document:query_selector("mstyle.bm")) do
    bm:traverse_elements(function(el)
      if el:get_element_name() ~= "mi" then return end
      if mathml.is_operator_name(el) then
        el:set_attribute("mathvariant", "bold")
      elseif not el:get_attribute("mathvariant") then
        for _, child in ipairs(el:get_children()) do
          if child:is_text() then dom.set_node_text(child, bold_italic(child:get_text())) end
        end
      end
    end)
  end
end

-- single-letter operator names (\DeclareMathOperator{\E}{E}) come out italic
function M.upright_operator_names(document)
  for _, mi in ipairs(document:query_selector("mi.qopname")) do
    mi:set_attribute("mathvariant", "normal")
  end
end

return M
