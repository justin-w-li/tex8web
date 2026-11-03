-- The text around the math.
local dom = require "tex8web.dom"

local M = {}

-- theorem spacing, which the cfg leaves in a <span class="tex8web-thmskip"> in the
-- heading (TeX knows it only once the theorem has started)
function M.theorem_spacing(document)
  for _, mark in ipairs(document:query_selector("span.tex8web-thmskip")) do
    local div = dom.closest(mark, function(el)
      return el:get_element_name() == "div" and el:get_attribute("class") == "newtheorem"
    end)
    if div then
      div:set_attribute("style", "margin-top: " .. mark:get_attribute("data-before")
        .. "; margin-bottom: " .. mark:get_attribute("data-after"))
    end
    mark:remove_node()
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

return M
