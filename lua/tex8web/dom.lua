-- Helpers for LuaXML's DOM. LuaXML cannot replace an element's children or
-- a text node's text, so set_children and set_node_text write its fields,
-- and no other file does.
local M = {}

-- the nearest ancestor (or el itself) that satisfies predicate
function M.closest(el, predicate)
  while el and el:is_element() do
    if predicate(el) then return el end
    el = el:get_parent()
  end
end

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

-- whether one of el's classes, as a whole, matches a Lua pattern
function M.class_matches(el, pattern)
  return any_class(el, function(class) return class:match("^" .. pattern .. "$") ~= nil end)
end

-- whether a class is one of tex4ht's font classes (cmti-10, ptmr7t-,
-- ec-qtmr-10)
function M.is_font_class(class)
  return class:find("%-$") ~= nil or class:find("%-%d") ~= nil
end

function M.elements(el)
  local elements = {}
  for _, node in ipairs(el:get_children()) do
    if node:is_element() then elements[#elements + 1] = node end
  end
  return elements
end

-- whether el holds no elements and no text but space (comments are
-- ignored)
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

-- a comment's text (LuaXML's get_text gives none), or nil for another node
function M.comment_text(node)
  if node._type == "COMMENT" then return node._text end
end

function M.set_children(el, nodes)
  for _, node in ipairs(nodes) do node._parent = el end
  el._children = nodes
end

function M.set_node_text(text_node, text)
  text_node._text = text
end

return M
