-- What the passes need to know about tex4ht's MathML.
local dom = require "web.dom"

local M = {}

-- tex4ht's classes for TeX's atom types, and MathJax's names for them
-- (data-mjx-texclass, which MathJax's own TeX input sets, and by which it
-- spaces math as TeX does)
M.texclass = {
  ["MathClass-ord"] = "ORD", ["MathClass-op"] = "OP", ["MathClass-bin"] = "BIN",
  ["MathClass-rel"] = "REL", ["MathClass-open"] = "OPEN",
  ["MathClass-close"] = "CLOSE", ["MathClass-punc"] = "PUNCT",
}

-- elements with scripts, and those of them set beside the base
M.scripted = {msub = true, msup = true, msubsup = true,
              munder = true, mover = true, munderover = true}
M.subsup = {msub = true, msup = true, msubsup = true}

-- elements that hold a row of any number of children
M.rows = {math = true, mrow = true, mstyle = true, mtd = true, mpadded = true,
          msqrt = true, menclose = true}

M.large_operators = {}
for _, op in ipairs{"∑", "∏", "∐", "⋃", "⋂", "⋁", "⋀", "⨁", "⨂", "⨀", "⨄",
                    "∫", "∬", "∭", "∮"} do
  M.large_operators[op] = true
end

-- letters are italic in an <mi>; other symbols (∞, ∅, ⊤) are upright in TeX
function M.is_letter(codepoint)
  local c = codepoint
  return (c >= 0x41 and c <= 0x5A) or (c >= 0x61 and c <= 0x7A)
    or (c >= 0x391 and c <= 0x3F6) or (c >= 0x1D400 and c <= 0x1D7FF)
    or c == 0x2113 or c == 0x2202 or c == 0x210F or c == 0x131 or c == 0x237
end

-- operator names: \log, \DeclareMathOperator's, \operatorname's
function M.is_operator_name(el)
  local class = el:get_attribute("class")
  return class == "qopname" or class == "loglike"
end

-- the function application (U+2061) tex4ht puts after an operator name
function M.is_apply(el)
  return el and el:get_element_name() == "mo" and dom.text(el) == "\u{2061}"
end

function M.remove_apply_after(el)
  local after = dom.next_element(el)
  if M.is_apply(after) then after:remove_node() end
end

-- whether el, looking through rows and styles of one child, is an operator
function M.is_operator(el)
  while el:get_element_name() == "mrow" or el:get_element_name() == "mstyle" do
    local children = dom.children(el)
    if M.is_operator_name(el) or #children ~= 1 then break end
    el = children[1]
  end
  return el:get_element_name() == "mo" or M.is_operator_name(el)
    or el:get_attribute("data-mjx-texclass") == "OP"
end

-- an <mo> that make4ht leaves alone: it turns a lone <mo> into <mtext>
-- unless it has a stretchy attribute
function M.operator(parent, text, attributes)
  attributes = attributes or {}
  attributes.stretchy = attributes.stretchy or "false"
  local mo = parent:create_element("mo", attributes)
  mo:add_child_node(mo:create_text_node(text))
  return mo
end

return M
