-- MathJax is not given the preamble, so the definitions of the macros the
-- math uses go in a hidden element as text, which tex8web.js gives MathJax
-- before it typesets. Nothing else of the source is published. See "Macros
-- in math" in CONTRIBUTING.md.
local preamble = require "tex8web.preamble"

local log = logging.new("tex8web")

local M = {}

-- macros of common packages that MathJax lacks (the document's definitions
-- take precedence)
local fallbacks = {
  ["\\bm"] = "\\newcommand{\\bm}[1]{\\boldsymbol{#1}}",
  ["\\qedhere"] = "\\newcommand{\\qedhere}{}",
  -- (LaTeX's, in the units siunitx prints. siunitx's \degree reaches
  -- MathJax as \TextOrMath{°}{{}^{\circ}} under pdfTeX, and in math the PDF
  -- has the second. MathJax sets ° as a small ring accent.)
  ["\\TextOrMath"] = "\\newcommand{\\TextOrMath}[2]{#2}",
  ["\\ensuremath"] = "\\newcommand{\\ensuremath}[1]{#1}",
  -- (xfrac's, as \nicefrac from MathJax's units extension, which
  -- tex8web-math.tex loads with xfrac)
  ["\\sfrac"] = "\\newcommand{\\sfrac}[3][]{\\nicefrac{#2}{#3}}",
}

-- The math's colors that MathJax would get wrong (see "Macros in math" in
-- CONTRIBUTING.md) are given as \definecolor lines, from the values
-- tex8web-page.tex writes as "name v,v,v", in the color's xcolor model:
-- gray (one value), rgb (three), or cmyk (four). css holds MathJax's
-- values; a name whose xcolor value is the same is left out.
local css = {red = "FF0000", blue = "0000FF", cyan = "00FFFF", magenta = "FF00FF",
  yellow = "FFFF00", black = "000000", white = "FFFFFF", gray = "808080"}

-- conversions as in xcolor: each value held to 0 to 1, and rgb to cmyk
-- with xcolor's default undercolor removal and black generation
-- (\adjustUCRBG)
local function clamp(x)
  return math.max(0, math.min(1, x))
end

local function rgb(color)
  if #color == 1 then return {clamp(color[1]), clamp(color[1]), clamp(color[1])} end
  if #color == 3 then return color end
  local k = color[4]
  return {1 - clamp(color[1] + k), 1 - clamp(color[2] + k), 1 - clamp(color[3] + k)}
end

local function convert(color, n)
  if #color == n then return color end
  if n == 3 then return rgb(color) end
  if #color == 1 then return {0, 0, 0, clamp(1 - color[1])} end
  local c, m, y = clamp(1 - color[1]), clamp(1 - color[2]), clamp(1 - color[3])
  local k = math.min(c, m, y)
  return {c - k, m - k, y - k, k}
end

-- (xcolor takes a cmyk color's complement through cmy)
local function complement(color)
  if #color == 4 then return convert(complement(rgb(color)), 4) end
  local flipped = {}
  for i, x in ipairs(color) do flipped[i] = clamp(1 - x) end
  return flipped
end

-- the unrounded {r, g, b} of an xcolor expression, or nil for an unknown
-- name. name!p!name!p!name mixes from the left, and a last p alone mixes
-- with white. A minus before a name takes its complement; before the first
-- name, the complement of the result. As in xcolor, a mix is in the first
-- color's model, or in the second's if the first is gray or its share is
-- 0, and a share of 100 keeps the first color. A share outside 0 to 100
-- extrapolates: values are held to 0 to 1 only on conversion.
local function evaluate(expression, known)
  local parts = {}
  for part in (expression .. "!"):gmatch("(.-)!") do parts[#parts + 1] = part end
  local minuses, name = parts[1]:match("^(-*)(.*)")
  local color, flip = known[name], #minuses % 2 == 1
  for i = 2, #parts, 2 do
    local share = tonumber(parts[i])
    local other = {1}
    if parts[i + 1] then
      minuses, name = parts[i + 1]:match("^(-*)(.*)")
      other = known[name]
      if other and #minuses % 2 == 1 then other = complement(other) end
    end
    if not (color and share and other) then return end
    if share == 0 then
      color = other
    elseif share ~= 100 then
      if #color == 1 then color = convert(color, #other) else other = convert(other, #color) end
      local mixed = {}
      for c = 1, #color do mixed[c] = (share * color[c] + (100 - share) * other[c]) / 100 end
      color = mixed
    end
  end
  if color and flip then color = complement(color) end
  return color and rgb(color)
end

-- as xcolor rounds a fraction to a byte, in TeX's units of 1/65536
local function byte(fraction)
  local scaled = math.floor(fraction * 65536 + 0.5)
  return math.max(0, math.min(255, math.floor(scaled * 255 / 65536 + 0.5)))
end

-- \definecolor lines for the colors the math may name. Every word in braces
-- is tried, so a color passed through a macro's argument is found too.
local function color_definitions(texts, values_text)
  local known = {}
  for name, values in values_text:gmatch("(%S+) (%S+)") do
    local color = {}
    for value in values:gmatch("[^,]+") do color[#color + 1] = tonumber(value) end
    known[name] = color
  end
  local names = {}
  for _, text in ipairs(texts) do
    for name in text:gmatch("{([^{}]*)}") do names[name] = true end
  end
  local defs = {}
  for name in pairs(names) do
    local color = evaluate(name, known)
    if color then
      local r, g, b = byte(color[1]), byte(color[2]), byte(color[3])
      if css[name] ~= string.format("%02X%02X%02X", r, g, b) then
        defs[#defs + 1] = string.format("\\definecolor{%s}{RGB}{%d,%d,%d}", name, r, g, b)
      end
    end
  end
  table.sort(defs)
  return defs
end

function M.define(document, context)
  local definitions = preamble.document(context.tex_file)
  for name, def in pairs(fallbacks) do
    definitions[name] = definitions[name] or {def = def, body = "", override = true}
  end
  -- the config's \WebMathMacros, which take precedence
  local overrides = {}
  preamble.read(context.macros or "", overrides)
  for name, definition in pairs(overrides) do
    definition.override = true
    definitions[name] = definition
  end

  -- the macros the math uses, and those they use in turn
  local used, queue, texts = {}, {}, {}
  for _, el in ipairs(document:query_selector(".mathjax-inline, .mathjax-block, .mathjax-env")) do
    texts[#texts + 1] = el:get_text()
    for _, name in ipairs(preamble.uses(texts[#texts])) do queue[#queue + 1] = name end
  end
  while #queue > 0 do
    local name = table.remove(queue)
    local definition = definitions[name]
    if definition and not used[name] then
      used[name] = definition
      texts[#texts + 1] = definition.body
      for _, inner in ipairs(preamble.uses(definition.body)) do queue[#queue + 1] = inner end
    end
  end

  local names = {}
  for name in pairs(used) do names[#names + 1] = name end
  table.sort(names)
  -- (colors first: a \definecolor restarts MathJax's run, and in the
  -- restarted run a repeated \DeclarePairedDelimiter is an error)
  local defs, skipped = color_definitions(texts, context.colors or ""), {}
  for _, name in ipairs(names) do
    local definition = used[name]
    local why = not definition.override and (definition.problem or preamble.problem(definition.body))
    if why then
      skipped[#skipped + 1] = name .. " (" .. why .. ")"
    else
      defs[#defs + 1] = definition.def
    end
  end
  if #skipped > 0 then
    log:warning(#skipped .. " macro(s) left undefined for MathJax, which can't read their definitions: "
      .. table.concat(skipped, ", ") .. ". Define them for MathJax with \\WebMathMacros in your config")
  end
  if #defs == 0 then return end
  local body = document:query_selector("body")[1]
  -- (mathjax_ignore: MathJax's class for text not searched for math)
  local div = body:create_element("div", {id = "tex8web-macros", class = "mathjax_ignore",
    hidden = "hidden", ["data-tex8web-browser"] = ""})
  div:add_child_node(div:create_text_node(table.concat(defs, "\n")))
  body:add_child_node(div)
end

return M
