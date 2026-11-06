-- Helpers over LuaXML's DOM. LuaXML can't replace an element's children or
-- a text node's text, so those reach into its fields here, and nowhere else.
local M = {}

-- the nearest ancestor (or el itself) that satisfies predicate
function M.closest(el, predicate)
  while el and el:is_element() do
    if predicate(el) then return el end
    el = el:get_parent()
  end
end

-- whether one of el's classes is name, starts with prefix or matches a Lua
-- pattern (as a whole class)
local function any_class(el, matches)
  if not el:is_element() then return false end
  for class in (el:get_attribute("class") or ""):gmatch("%S+") do
    if matches(class) then return true end
  end
  return false
end

function M.has_class(el, name)
  return any_class(el, function(class) return class == name end)
end

function M.class_starts(el, prefix)
  return any_class(el, function(class) return class:sub(1, #prefix) == prefix end)
end

function M.class_matches(el, pattern)
  return any_class(el, function(class) return class:match("^" .. pattern .. "$") ~= nil end)
end

-- el's children that are elements
function M.elements(el)
  local elements = {}
  for _, node in ipairs(el:get_children()) do
    if node:is_element() then elements[#elements + 1] = node end
  end
  return elements
end

-- whether el has no elements in it and no text but space (comments don't
-- show)
function M.is_blank(el)
  return #M.elements(el) == 0 and not el:get_text():find("%S")
end

-- joins a declaration to el's style
function M.add_style(el, declaration)
  local style = (el:get_attribute("style") or ""):gsub("[;%s]+$", "")
  el:set_attribute("style", style == "" and declaration or style .. "; " .. declaration)
end

-- the element before el among its parent's children
function M.previous_element(el)
  local previous
  for _, node in ipairs(M.elements(el:get_parent())) do
    if node == el then return previous end
    previous = node
  end
end

function M.set_children(el, nodes)
  for _, node in ipairs(nodes) do node._parent = el end
  el._children = nodes
end

function M.set_node_text(text_node, text)
  text_node._text = text
end

return M
