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
-- own and xcolor's, and mixes like red!50!black, from the "name hex" pairs
-- tex8web-page.tex wrote (colors MathJax has right are left out)
local css = {red = "FF0000", blue = "0000FF", cyan = "00FFFF", magenta = "FF00FF",
  yellow = "FFFF00", black = "000000", white = "FFFFFF", gray = "808080"}

-- the {r, g, b} of an xcolor expression (name!p!name!p!name, mixed from the
-- left, a last p alone with white), or nothing if it has a name not known
local function evaluate(expression, known)
  local parts = {}
  for part in (expression .. "!"):gmatch("(.-)!") do parts[#parts + 1] = part end
  local color = known[parts[1]]
  for i = 2, #parts, 2 do
    local share = tonumber(parts[i])
    local other = parts[i + 1] and known[parts[i + 1]] or not parts[i + 1] and {255, 255, 255}
    if not (color and share and other) then return end
    local mixed = {}
    for c = 1, 3 do mixed[c] = (share * color[c] + (100 - share) * other[c]) / 100 end
    color = mixed
  end
  return color
end

-- the colors a piece of math source names, with \color, \textcolor,
-- \pagecolor, \colorbox and \fcolorbox
local function colors_named(text, names)
  for _, command in ipairs({"color", "textcolor", "pagecolor", "colorbox"}) do
    for name in text:gmatch("\\" .. command .. "%s*{([^{}]*)}") do names[name] = true end
  end
  for name in text:gmatch("\\fcolorbox%s*{[^{}]*}%s*{([^{}]*)}") do names[name] = true end
  for name in text:gmatch("\\fcolorbox%s*{([^{}]*)}") do names[name] = true end
end

local function color_definitions(texts, pairs_text)
  local known = {}
  for name, hex in pairs_text:gmatch("(%S+) (%x%x%x%x%x%x)") do
    known[name] = {tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16)}
  end
  local names = {}
  for _, text in ipairs(texts) do colors_named(text, names) end
  local defs = {}
  for name in pairs(names) do
    local color = evaluate(name, known)
    if color then
      local r, g, b = math.floor(color[1] + 0.5), math.floor(color[2] + 0.5), math.floor(color[3] + 0.5)
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
  for _, def in ipairs(color_definitions(texts, context.colors or "")) do defs[#defs + 1] = def end
  if #defs == 0 then return end
  local body = document:query_selector("body")[1]
  -- (mathjax_ignore: MathJax's class for text it doesn't look for math in)
  local div = body:create_element("div", {id = "tex8web-macros", class = "mathjax_ignore",
    hidden = "hidden", ["data-tex8web-browser"] = ""})
  div:add_child_node(div:create_text_node(table.concat(defs, "\n")))
  body:add_child_node(div)
end

return M
