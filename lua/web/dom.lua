-- Helpers over LuaXML's DOM. LuaXML can't rename an element, replace its
-- attributes or children, or insert a node next to another, so those reach
-- into its fields here, and nowhere else.
local M = {}

-- the element children of an element
function M.children(el)
  local children = {}
  for _, child in ipairs(el:get_children()) do
    if child:is_element() then children[#children + 1] = child end
  end
  return children
end

function M.trim(text)
  return text:match("^%s*(.-)%s*$")
end

-- the text of a token element, trimmed; nil if it holds elements
function M.text(el)
  for _, child in ipairs(el:get_children()) do
    if child:is_element() then return nil end
  end
  return M.trim(el:get_text())
end

-- the next sibling element, skipping whitespace; nil at the end, or if text
-- comes first
function M.next_element(el)
  local siblings = el:get_siblings()
  for i = el:find_element_pos() + 1, #siblings do
    if siblings[i]:is_element() then return siblings[i] end
    if siblings[i]:is_text() and siblings[i]:get_text():match("%S") then return nil end
  end
end

-- the nearest ancestor (or el itself) with the given name, or that satisfies
-- the given predicate
function M.closest(el, test)
  local predicate = test
  if type(test) == "string" then
    predicate = function(ancestor) return ancestor:get_element_name() == test end
  end
  while el and el:is_element() do
    if predicate(el) then return el end
    el = el:get_parent()
  end
end

function M.is_named(el, name)
  return el:is_element() and el:get_element_name() == name
end

-- a copy of el's attributes
function M.attributes(el)
  local copy = {}
  for name, value in pairs(el._attr or {}) do copy[name] = value end
  return copy
end

function M.rename(el, name)
  el._name = name
end

function M.set_attributes(el, attributes)
  el._attr = attributes
end

function M.remove_attribute(el, name)
  el._attr[name] = nil
end

-- make el hold just text
function M.set_text(el, text)
  el._children = {el:create_text_node(text)}
end

function M.set_node_text(text_node, text)
  text_node._text = text
end

function M.set_children(el, nodes)
  for _, node in ipairs(nodes) do node._parent = el end
  el._children = nodes
end

-- put new where old is
function M.replace(old, new)
  old:replace_node(new)
  new._parent = old:get_parent()
end

-- put nodes where el is
function M.replace_with(el, nodes)
  local parent, siblings = el:get_parent(), {}
  for _, sibling in ipairs(parent:get_children()) do
    if sibling == el then
      for _, node in ipairs(nodes) do siblings[#siblings + 1] = node end
    else
      siblings[#siblings + 1] = sibling
    end
  end
  M.set_children(parent, siblings)
end

-- put nodes just before el
function M.insert_before(el, nodes)
  local all = {}
  for _, node in ipairs(nodes) do all[#all + 1] = node end
  all[#all + 1] = el
  M.replace_with(el, all)
end

-- put el inside a new element, in its place
function M.wrap(el, name, attributes)
  local wrapper = el:create_element(name, attributes, el:get_parent())
  el:replace_node(wrapper)
  wrapper:add_child_node(el)
  return wrapper
end

return M
