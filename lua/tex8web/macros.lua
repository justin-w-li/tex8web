-- MathJax reads the math's LaTeX source but not the document's preamble, so
-- it doesn't know the document's own macros. Give it the definitions of
-- those the math uses, read from the document and the local packages it
-- loads, and nothing else of the source. They go in a hidden element,
-- as text, which tex8web.js gives MathJax before it typesets anything.
local preamble = require "tex8web.preamble"

local log = logging.new("tex8web")

local M = {}

-- macros of common packages that MathJax lacks, for math that uses them
-- (the document's own definitions take precedence)
local fallbacks = {
  ["\\bm"] = "\\newcommand{\\bm}[1]{\\boldsymbol{#1}}",
  ["\\qedhere"] = "\\newcommand{\\qedhere}{}",
}

-- MathJax names colors as CSS and dvips do, and has no xcolor. The math's
-- colors it would get wrong are given as \definecolor lines: the document's
-- own and xcolor's, and mixes like red!50!black, from the values
-- tex8web-page.tex wrote, "name v,v,v" (colors MathJax has right are left
-- out). A color is in xcolor's model for it: gray (one value), rgb (three)
-- or cmyk (four)
local css = {red = "FF0000", blue = "0000FF", cyan = "00FFFF", magenta = "FF00FF",
  yellow = "FFFF00", black = "000000", white = "FFFFFF", gray = "808080"}

-- as xcolor converts, each value held to 0 to 1: rgb to cmyk with its
-- default undercolor removal and black generation (\adjustUCRBG)
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

-- the {r, g, b}, each from 0 to 1 and unrounded, of an xcolor expression
-- (name!p!name!p!name, mixed from the left, a last p alone with white; a
-- minus before a name takes its complement, before the first the
-- whole's), or nothing if it has a name not known. As xcolor does, a mix
-- is in the first color's model, or the second's if the first is gray, or
-- if its share is 0; a share of 100 keeps the first color. A share outside
-- 0 to 100 extrapolates, and a value is held to 0 to 1 only as it is
-- converted to another model
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

-- the colors the math may name: each word in braces, as a color command's
-- argument or a macro's that passes it to one
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
  -- the cfg's \WebMathMacros, which take precedence
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
  local defs, skipped = {}, {}
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
  -- (the colors go first: \definecolor makes MathJax load its color
  -- extension and run the whole text again, where a repeated
  -- \DeclarePairedDelimiter is an error that drops the colors after it)
  local colors = color_definitions(texts, context.colors or "")
  for _, def in ipairs(defs) do colors[#colors + 1] = def end
  defs = colors
  if #defs == 0 then return end
  local body = document:query_selector("body")[1]
  -- (mathjax_ignore: MathJax's class for text it doesn't look for math in)
  local div = body:create_element("div", {id = "tex8web-macros", class = "mathjax_ignore",
    hidden = "hidden", ["data-tex8web-browser"] = ""})
  div:add_child_node(div:create_text_node(table.concat(defs, "\n")))
  body:add_child_node(div)
end

return M
