-- Sizes of big delimiters and large operators.
local dom = require "web.dom"
local mathml = require "web.mathml"

local M = {}

-- \bigm| and co. (marked by the cfg): a delimiter of the given size, spaced
-- as a relation. tex4ht leaves the delimiter bare text, so this runs after
-- structure.well_formed has made it an <mo>
function M.middle(document)
  for _, mrow in ipairs(document:query_selector("mrow.bigm")) do
    local mo = mrow:query_selector("mo")[1]
    local size = mrow:get_attribute("data-size")
    dom.remove_attribute(mrow, "data-size")
    if mo then
      for name, value in pairs{fence = "false", stretchy = "true", symmetric = "true",
                               minsize = size, maxsize = size} do
        mo:set_attribute(name, value)
      end
    end
  end
end

-- TeX draws big delimiters and large operators (\bigl(, \sum) from the math
-- extension font at its design size, 10pt, also in an 11pt document; the
-- cfg passes the ratio to the body font, in percent
function M.extension_scale(document, tex)
  if not tex.exscale then return end
  local exscale = tex.exscale .. "%"
  for _, mo in ipairs(document:query_selector("mo")) do
    if mo:get_attribute("minsize") then
      mo:set_attribute("mathsize", exscale)
    elseif mathml.large_operators[dom.text(mo) or ""] then
      -- MathJax misplaces the limits of \int (they belong tucked into its
      -- slant) when the <mo> itself is scaled, so scale around it
      dom.wrap(mo, "mstyle", {mathsize = exscale})
    end
  end
end

return M
