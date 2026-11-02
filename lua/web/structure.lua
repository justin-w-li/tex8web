-- MathML that tex4ht writes but MathJax can't take.
local dom = require "web.dom"
local mathml = require "web.mathml"

local M = {}

-- a picture in display math (\[ \begin{tikzcd} .. \]) comes out as an <img>
-- in <semantics><annotation-xml>, which MathJax drops; when the picture is
-- the whole formula, use the bare <img>. (Beside other math it stays, and
-- MathJax leaves it out)
function M.unwrap_pictures(document)
  for _, annotation in ipairs(document:query_selector("annotation-xml")) do
    local img = annotation:query_selector("img")[1]
    local semantics = annotation:get_parent()
    local outer = semantics:get_parent()
    if dom.is_named(outer, "mrow") and #dom.children(outer) == 1 then outer = outer:get_parent() end
    if img and dom.is_named(outer, "math") and #dom.children(outer) == 1 then
      dom.replace(outer, img)
    end
  end
end

-- elements whose children must be elements, not bare text
local needs_tokens = {
  math = true, mrow = true, mstyle = true, mtd = true, mfrac = true,
  msqrt = true, mroot = true, msub = true, msup = true, msubsup = true,
  mover = true, munder = true, munderover = true,
}

-- a token for a run of bare text: <mn> for a number, <mi> if it has a
-- letter, <mo> otherwise
local function token_name(text)
  if text:match("^%d+$") then return "mn" end
  for _, c in utf8.codes(text) do
    if mathml.is_letter(c) then return "mi" end
  end
  return "mo"
end

local function tokenize(parent, text_node, name, attributes)
  local text = dom.trim(text_node:get_text())
  name = name or token_name(text)
  local token
  if name == "mo" then
    token = mathml.operator(parent, text)
  else
    token = parent:create_element(name, attributes)
    token:add_child_node(token:create_text_node(text))
  end
  dom.replace(text_node, token)
end

local function bare_text(el)
  local texts = {}
  for _, child in ipairs(el:get_children()) do
    if child:is_text() and child:get_text():match("%S") then texts[#texts + 1] = child end
  end
  return texts
end

function M.well_formed(document)
  document:traverse_elements(function(el)
    local name = el:get_element_name()
    -- operator names with spacing inside (arg\,max) come out as
    -- <mi>arg<mspace/>max</mi>, and an accented relation (\dot\sim) as
    -- <mo><mover>..</mover></mo>; a token can't hold elements, so make it a
    -- row of tokens, of the token's class
    if (name == "mi" or name == "mo") and #dom.children(el) > 0 then
      dom.rename(el, "mrow")
      local class = mathml.texclass[el:get_attribute("class")]
      if class then el:set_attribute("data-mjx-texclass", class) end
      for _, text in ipairs(bare_text(el)) do
        tokenize(el, text, name, name == "mi" and {mathvariant = "normal"} or nil)
      end
    end
    if needs_tokens[el:get_element_name()] then
      for _, text in ipairs(bare_text(el)) do tokenize(el, text) end
    end
  end)
end

return M
