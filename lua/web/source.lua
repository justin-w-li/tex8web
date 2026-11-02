-- The math's LaTeX source, as tex4ht leaves it for MathJax.
local dom = require "web.dom"

local M = {}

local function each_text(el, f)
  for _, child in ipairs(el:get_children()) do
    if child:is_text() then f(child)
    elseif child:is_element() then each_text(child, f) end
  end
end

-- tex4ht writes each formula through \detokenize, which puts a space after
-- every control word. TeX skips it, but MathJax doesn't before an optional
-- argument (\abs [\big ]{x}); drop it where no letter follows
function M.spaces(document)
  for _, el in ipairs(document:query_selector(".mathjax-inline, .mathjax-block, .mathjax-env")) do
    each_text(el, function(node)
      dom.set_node_text(node, (node:get_text():gsub("(\\%a+) ([^%a])", "%1%2")))
    end)
  end
end

return M
