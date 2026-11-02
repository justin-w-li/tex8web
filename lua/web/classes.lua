-- TeX's atom classes, by which MathJax spaces math. MathJax follows
-- data-mjx-texclass when it is set (its own TeX input sets it everywhere),
-- and its MathML operator dictionary, which disagrees with TeX in places,
-- when it isn't.
local dom = require "web.dom"
local mathml = require "web.mathml"

local M = {}

-- tex4ht takes classes from a table of glyphs, which gets these wrong. (the
-- cfg marks \parallel, which shares its glyph with \|; delimiters such as
-- \lvert keep their class)
local class_of = {
  ["|"] = "ORD", ["∥"] = "ORD", ["∕"] = "ORD", ["."] = "ORD",
  [":"] = "REL", ["!"] = "CLOSE",
}
-- \dots and friends, which tex4ht writes as letters or relations
local dots = {["…"] = "INNER", ["⋯"] = "INNER", ["⋱"] = "INNER", ["⋮"] = "ORD"}
local primes = {["′"] = true, ["″"] = true, ["‴"] = true}
-- cmsy draws \succeq and \preceq with a straight bar (⪰, ⪯), but tex4ht
-- writes the curly ≽ and ≼
local glyphs = {["≽"] = "⪰", ["≼"] = "⪯"}

-- (where tex4ht's attributes are wrong for a token, they are replaced
-- rather than added to)
local function fix_token(el)
  local name, text, class = el:get_element_name(), dom.text(el), el:get_attribute("class")
  if not text then
    return
  elseif name == "mo" and text == "∅" then
    -- \varnothing (\emptyset comes out as <mi>), as MathJax's TeX input
    -- writes it
    dom.rename(el, "mi")
    dom.set_attributes(el, {["data-mjx-alternate"] = "1"})
  elseif primes[text] then
    -- TeX's prime is a big glyph raised as a superscript; MathJax's TeX input
    -- asks for that glyph like this (the plain one is pre-raised)
    dom.rename(el, "mo")
    el:set_attribute("data-mjx-alternate", "1")
    el:set_attribute("stretchy", "false")
  elseif dots[text] then
    dom.rename(el, "mo")
    dom.set_attributes(el, {["data-mjx-texclass"] = dots[text], stretchy = "false"})
    mathml.remove_apply_after(el)
  elseif mathml.large_operators[text] then
    -- tex4ht sometimes writes these as <mi> or <mtext>
    dom.rename(el, "mo")
    dom.set_attributes(el, {stretchy = "false"})
    mathml.remove_apply_after(el)
  elseif class == "MathClass-op" then
    -- ⊤, ∇, ∃: ordinary symbols, which tex4ht makes operator names
    el:set_attribute("mathvariant", "normal")
    el:set_attribute("data-mjx-texclass", "ORD")
    mathml.remove_apply_after(el)
  elseif mathml.is_operator_name(el) then
    el:set_attribute("data-mjx-texclass", "OP")
  elseif name == "mo" and mathml.texclass[class] then
    if not el:get_attribute("data-mjx-texclass") then
      local fixed = class ~= "MathClass-open" and class ~= "MathClass-close" and class_of[text]
      el:set_attribute("data-mjx-texclass", fixed or mathml.texclass[class])
    end
    if glyphs[text] then dom.set_text(el, glyphs[text]) end
  elseif name == "mi" and not el:get_attribute("mathvariant")
      and utf8.len(text) == 1 and not mathml.is_letter(utf8.codepoint(text)) then
    el:set_attribute("mathvariant", "normal")
  end
end

function M.tokens(document)
  local tokens = {}
  document:traverse_elements(function(el)
    local name = el:get_element_name()
    if name == "mi" or name == "mo" or name == "mtext" then tokens[#tokens + 1] = el end
  end)
  for _, el in ipairs(tokens) do fix_token(el) end
end

-- the function application after an operator name takes no part in spacing
-- (MathJax's TeX input marks it so too); otherwise MathJax spaces it as an
-- ordinary symbol, which puts a gap in \log(x). MathJax still puts a thin
-- space after it unless a matching pair of delimiters follows, as in
-- \Var(X)^2, where TeX puts none before an opening delimiter, or at the end
-- of a formula; drop it there
function M.function_application(document)
  for _, mo in ipairs(document:query_selector("mo")) do
    if mathml.is_apply(mo) then
      local after = dom.next_element(mo)
      if not after or after:get_attribute("data-mjx-texclass") == "OPEN" then
        mo:remove_node()
      else
        mo:set_attribute("data-mjx-texclass", "NONE")
      end
    end
  end
end

-- \text is a box, an ordinary symbol to TeX, whatever math it holds
function M.text_boxes(document)
  for _, mstyle in ipairs(document:query_selector("mstyle.text")) do
    mstyle:set_attribute("data-mjx-texclass", "ORD")
  end
end

-- an operator name with spacing inside (arg\,max) comes out as a row, each
-- part of which MathJax would take for an operator name of its own, with
-- space between
function M.operator_names(document)
  for _, mrow in ipairs(document:query_selector("mrow.qopname")) do
    mrow:set_attribute("data-mjx-texclass", "OP")
    local children = dom.children(mrow)
    for _, child in ipairs(children) do
      child:set_attribute("data-mjx-auto-op", "false")
    end
    -- (\limsup comes out as lim\,sup\,, with a space before its limits)
    local last = children[#children]
    if #children > 1 and last:get_element_name() == "mspace" then last:remove_node() end
    -- MathJax sets the s. of \operatorname{s.\!t.} wider than TeX does, so
    -- the \! pulls the t. over its period
    for i = 2, #children do
      local width = children[i]:get_attribute("width") or ""
      if children[i]:get_element_name() == "mspace" and width:match("^%-")
          and (dom.text(children[i - 1]) or ""):match("%.$") then
        children[i]:remove_node()
      end
    end
  end
end

-- tex4ht writes \mathrm{diff} with an ff ligature, which MathJax's fonts
-- lack
local ligatures = {["ﬀ"] = "ff", ["ﬁ"] = "fi", ["ﬂ"] = "fl", ["ﬃ"] = "ffi", ["ﬄ"] = "ffl"}
function M.ligatures(document)
  for _, mi in ipairs(document:query_selector("mi")) do
    for _, child in ipairs(mi:get_children()) do
      if child:is_text() then
        dom.set_node_text(child, (child:get_text():gsub("\xEF\xAC[\x80-\x84]", ligatures)))
      end
    end
  end
end

-- other multi-letter identifiers (\mathrm{SSE}) aren't function names to
-- space like \log, as MathJax would take them. make4ht later joins upright
-- letters in a row into one <mi>, so mark single upright letters too
function M.identifiers(document)
  for _, mi in ipairs(document:query_selector("mi")) do
    local text = dom.text(mi)
    local styled = dom.closest(mi, function(el) return el:get_attribute("mathvariant") end)
    local variant = styled and styled:get_attribute("mathvariant")
    if text and not mathml.is_operator_name(mi)
        and (utf8.len(text) > 1 or variant == "normal" or variant == "bold") then
      mi:set_attribute("data-mjx-auto-op", "false")
    end
  end
end

-- an operator name with scripts (\E_x) is still an operator
function M.operator_scripts(document)
  -- (in this order, so that a script on a scripted operator name finds it
  -- marked)
  for _, name in ipairs{"msub", "msup", "msubsup"} do
    for _, el in ipairs(document:query_selector(name)) do
      local base = dom.children(el)[1]
      if base and base:get_element_name() == "mrow" and #dom.children(base) == 1 then
        base = dom.children(base)[1]
      end
      if base and base:get_attribute("data-mjx-texclass") == "OP" then
        el:set_attribute("data-mjx-texclass", "OP")
      end
    end
  end
end

return M
