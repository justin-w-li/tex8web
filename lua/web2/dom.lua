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

function M.has_class(el, pattern)
  return el:is_element() and (el:get_attribute("class") or ""):match(pattern) ~= nil
end

function M.set_children(el, nodes)
  for _, node in ipairs(nodes) do node._parent = el end
  el._children = nodes
end

function M.set_node_text(text_node, text)
  text_node._text = text
end

return M
