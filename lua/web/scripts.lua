-- Sub- and superscripts, and limits.
local dom = require "web.dom"
local mathml = require "web.mathml"

local M = {}

-- an operator name with scripts comes out as
-- <msub><mrow>[name]&#x2061;</mrow>..</msub>; the &#x2061; belongs after the
-- scripts, or the whole isn't an operator for spacing. \lim and co. also need
-- movablelimits to put their limits beside them in inline math, as TeX does
function M.operator_limits(document)
  document:traverse_elements(function(el)
    local name = el:get_element_name()
    local base = mathml.scripted[name] and dom.children(el)[1]
    if not (base and base:get_element_name() == "mrow") then return end
    local children = dom.children(base)
    local op, apply = children[1], children[2]
    if #children == 2 and mathml.is_operator_name(op) and mathml.is_apply(apply) then
      apply:remove_node()
      local parent = el:get_parent()
      if mathml.rows[parent:get_element_name()] then
        parent:add_child_node(apply, el:find_element_pos() + 1)
      end
      dom.replace(base, op)
      op:set_attribute("data-mjx-texclass", "OP")
      if (name == "munder" or name == "munderover") and op:get_element_name() == "mi" then
        dom.rename(op, "mo")
        op:set_attribute("movablelimits", "true")
      end
    end
  end)
end

-- after an operator with limits, tex4ht writes the scripts of the symbols
-- that follow (\det\Sigma_t, \min(X_j^2)) as limits too, under and over them
local as_scripts = {munder = "msub", mover = "msup", munderover = "msubsup"}
function M.limits_as_scripts(document)
  document:traverse_elements(function(el)
    local name = as_scripts[el:get_element_name()]
    if not name then return end
    local base = dom.children(el)[1]
    if el:get_attribute("accent") == "false" and el:get_attribute("accentunder") ~= "true"
        and base and not mathml.is_operator(base) then
      dom.rename(el, name)
      dom.set_attributes(el, {})
    end
  end)
end

-- tex4ht makes a parenthesized group the base of the script after it
-- ((1-x)^2, \bigl(..\bigr)^2); in TeX the script belongs to the closing
-- delimiter alone, which sets it lower. (\left..\right is a group in TeX too,
-- and comes out as fences)
local function is_delimiter(el, class)
  return el:get_element_name() == "mo" and el:get_attribute("class") == class
    and el:get_attribute("fence") ~= "true"
end
function M.script_on_delimiter(document)
  document:traverse_elements(function(el)
    if not mathml.subsup[el:get_element_name()] then return end
    local base = dom.children(el)[1]
    if not (base and base:get_element_name() == "mrow") then return end
    local inner = dom.children(base)
    local first, last = inner[1], inner[#inner]
    if #inner >= 2 and is_delimiter(first, "MathClass-open")
        and is_delimiter(last, "MathClass-close") then
      table.remove(inner)
      dom.insert_before(el, inner)
      dom.replace(base, last)
    end
  end)
end

-- \xrightarrow and co. come out as a fixed arrow with limits; stretch it
-- under and over them, as MathJax's TeX input does, padded as it pads them
local arrows = {}
for _, arrow in ipairs{"→", "←", "↔", "⇒", "⇐", "⇔", "↦", "↩", "↪"} do arrows[arrow] = true end
function M.extensible_arrows(document)
  for _, el in ipairs(document:query_selector("munderover")) do
    local children = dom.children(el)
    local arrow = children[1]
    if #children == 3 and arrow:get_element_name() == "mo" and arrows[dom.text(arrow)] then
      arrow:set_attribute("stretchy", "true")
      el:set_attribute("data-mjx-texclass", "REL")
      for i = 2, 3 do
        dom.wrap(children[i], "mpadded", {width = "+0.833em", lspace = "0.278em"})
      end
    end
  end
end

return M
