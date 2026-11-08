-- The math's LaTeX source, as tex4ht leaves it for MathJax.
local dom = require "tex8web.dom"

local M = {}

local function each_text(el, f)
  for _, child in ipairs(el:get_children()) do
    if child:is_text() then f(child)
    elseif child:is_element() then each_text(child, f) end
  end
end

-- tex4ht writes each formula through \detokenize, which puts a space after
-- every control word. TeX ignores the space, but MathJax does not before an
-- optional argument (\abs [\big ]{x}), so the space is dropped where no
-- letter follows.
function M.spaces(document)
  for _, el in ipairs(document:query_selector(".mathjax-inline, .mathjax-block, .mathjax-env")) do
    each_text(el, function(node)
      dom.set_node_text(node, (node:get_text():gsub("(\\%a+) ([^%a])", "%1%2")))
    end)
  end
end

return M
