-- MathJax is not given the preamble, so the definitions of the macros the
-- math uses go in a hidden element as text, which tex8web.js gives MathJax
-- before it typesets. Nothing else of the source is published. See "Macros
-- in math" in CONTRIBUTING.md.
local dom = require "tex8web.dom"
local preamble = require "tex8web.preamble"
local source = require "tex8web.source"

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
  -- (LaTeX's \rlap{$\displaystyle #1$}, in latex.ltx. MathJax's \rlap
  -- takes math in math, so the dollar signs would be drawn.)
  ["\\lefteqn"] = "\\newcommand{\\lefteqn}[1]{\\rlap{\\displaystyle #1}}",
  -- LaTeX's text commands, which it also sets in math. MathJax expands these
  -- in \text too (textmacros), so each body is valid in text and in math. A
  -- script is math in \(...\), which textmacros reads in text, and which
  -- are empty in math. The script goes on an empty base in a group, as
  -- after V_{0} a bare _ is a double subscript.
  ["\\enskip"] = "\\newcommand{\\enskip}{\\enspace}",
  ["\\textsubscript"] = "\\def\\({}\\def\\){}\\newcommand{\\textsubscript}[1]{{\\({}_{\\text{#1}}\\)}}",
  ["\\textsuperscript"] = "\\def\\({}\\def\\){}\\newcommand{\\textsuperscript}[1]{{\\({}^{\\text{#1}}\\)}}",
  ["\\emph"] = "\\newcommand{\\emph}[1]{\\textit{#1}}",
  ["\\textsl"] = "\\newcommand{\\textsl}[1]{\\textit{#1}}",
  ["\\textsc"] = "\\newcommand{\\textsc}[1]{\\textup{#1}}",
  ["\\textmd"] = "\\newcommand{\\textmd}[1]{\\textup{#1}}",
  -- (counters mean nothing to MathJax)
  ["\\setcounter"] = "\\newcommand{\\setcounter}[2]{}",
  ["\\addtocounter"] = "\\newcommand{\\addtocounter}[2]{}",
  ["\\stepcounter"] = "\\newcommand{\\stepcounter}[1]{}",
  ["\\refstepcounter"] = "\\newcommand{\\refstepcounter}[1]{}",
}

-- The math's colors that MathJax would get wrong (see "Macros in math" in
-- CONTRIBUTING.md) are given as \definecolor lines, from the values
-- tex8web-page.tex writes as "name v,v,v;", in the color's xcolor model:
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
  for name, values in values_text:gmatch("([^;]-)%s+([^;%s]+);") do
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

-- pdfTeX's primitives that tex8web-hooks.sty makes do nothing in DVI mode,
-- each with its keywords and end as there, where \web@pdf@skip explains
-- them. A keyword's action: "-" none, "." or "s" the end, "n" a number,
-- "N" a number that ends, "d" a dimen, "g" a general text, "G" a general
-- text that ends, "k" the keywords in `after` instead. A target, after
-- which only the keywords of the fourth entry come: "t" a general text,
-- "m" a number, "q" a number and a general text. After "e" (newwindow) and
-- "u" (user, a general text) come those of the fifth. "r" (a goto's struct)
-- takes num and a number, name and a general text, or a general text. The
-- end: "g" a general text, "n" a number, "d" a dimen, "s" a glue. A number before the
-- keywords (\pdfcolorstack) or a font is given as "n" or "f" third. A
-- keyword matches in either case, as in pdfTeX. Removed with their
-- arguments from the definitions and the math MathJax gets, which would show
-- them in red.
local rule = "width=d height=d depth=d "
local action = "attr=g user=u goto=- thread=- file=g struct=r page=q num=m name=t "
local window = "newwindow=e nonewwindow=e "
local after = {xyz = "zoom=N", fitr = rule}
local primitives = {
  pdfliteral = {"shipout=- direct=- page=-", "g"}, pdfmapfile = {"", "g"}, pdfmapline = {"", "g"},
  pdfsetmatrix = {"", "g"}, pdfnames = {"", "g"}, pdfspacefont = {"", "g"},
  pdffontattr = {"", "g", "f"}, pdfincludechars = {"", "g", "f"}, pdfnobuiltintounicode = {"", "", "f"},
  pdfximage = {rule .. "attr=g page=n named=g colorspace=n mediabox=- cropbox=- bleedbox=- trimbox=- artbox=-", "g"},
  pdfobj = {"reserveobjnum=s useobjnum=n stream=- attr=g file=-", "g"},
  pdfannot = {rule .. "reserveobjnum=s useobjnum=n", "g"},
  pdfxform = {"attr=g resources=g", "n"},
  pdfrefximage = {"", "n"}, pdfrefobj = {"", "n"}, pdfrefxform = {"", "n"},
  pdfcolorstack = {"push=G set=G pop=. current=.", "", "n"},
  pdfstartlink = {rule .. action, "", nil, window}, pdfoutline = {action, "g", nil, window .. "count=n", "count=n"},
  pdfdest = {rule .. "struct=n num=m name=t", "", nil, "xyz=k fit=s fith=s fitv=s fitb=s fitbh=s fitbv=s fitr=k"},
  pdfthread = {rule .. "attr=g num=N name=G", ""}, pdfstartthread = {rule .. "attr=g num=N name=G", ""},
  pdfsnapy = {"", "s"}, pdfsnapycomp = {"", "n"},
}
for _, name in ipairs {"save", "restore", "endlink", "endthread", "snaprefpoint", "runninglinkon",
    "runninglinkoff", "interwordspaceon", "interwordspaceoff", "fakespace"} do
  primitives["pdf" .. name] = {"", ""}
end
-- the protected macros that tex/tex8web-hooks.sty's \pdfprimitive expands
-- to, which a write such as a heading's line in the .toc keeps
local aliases = {}
for name, shape in pairs(primitives) do aliases["web@prim@" .. name] = shape end
for name, shape in pairs(aliases) do primitives[name] = shape end
-- \pdfprimitive and pdftexcmds' copy, which run the primitive of the name
-- after them, are removed and leave that name
primitives.pdfprimitive, primitives["pdf@primitive"] = {"", ""}, {"", ""}

-- the end of a number (or a dimen: a factor and a unit or a register) or a
-- control sequence that starts at i, or of a general text
local function value(text, i, unit)
  local _, e = text:find("^%s*[-+]?%d*[.,]?%d+ ?", i)
  if e and unit then
    local _, u = text:find("^%s*%a%a ?", e + 1)
    if not u then _, u = text:find("^%s*\\%a+ ?", e + 1) end
    e = u
  end
  if not e then _, e = text:find("^%s*\\%a+ ?", i) end
  return e and e + 1 or i
end
-- the end of a glue: a dimen, then plus and minus, each with a dimen or fil
local function glue(text, i)
  i = value(text, i, true)
  for _, key in ipairs {"[pP][lL][uU][sS]", "[mM][iI][nN][uU][sS]"} do
    local _, e = text:find("^%s*" .. key, i)
    if e then
      local _, f = text:find("^%s*[-+]?%d*[.,]?%d+%s*[fF][iI][lL][lL]?[lL]? ?", e + 1)
      i = f and f + 1 or value(text, e + 1, true)
    end
  end
  return i
end
local function group(text, i)
  local _, e = text:find("^%s*%b{}", i)
  return e and e + 1 or i
end

-- a family's font, such as \textfont1, as pdfTeX's font scan reads it
local families = {textfont = true, scriptfont = true, scriptscriptfont = true}

local function skip(text, i, shape)
  local keys, last, first, post, rest = shape[1], shape[2], shape[3], shape[4] or "", shape[5] or ""
  if first then
    local _, _, font = text:find("^%s*\\(%a+)", i)
    i = value(text, i, false)
    if first == "f" and families[font] then i = value(text, i) end
  end
  while true do
    local _, e, word = text:find("^%s*(%a+)", i)
    word = word and word:lower()
    local act = word and keys:match("%f[%a]" .. word .. "=(%S)")
    if not act then break end
    i = e + 1
    if act == "." or act == "s" then return i end
    if act == "k" then keys = after[word] end
    if act == "e" or act == "u" then post = rest end
    if act:match("[nNmq]") then i = value(text, i) end
    if act == "d" then i = value(text, i, true) end
    if act == "r" then
      local _, w, id = text:find("^%s*(%a+)", i)
      id = id and id:lower()
      if id == "num" then i = value(text, w + 1)
      elseif id == "name" then i = group(text, w + 1)
      else i = group(text, i) end
    end
    if act:match("[gGqtu]") then i = group(text, i) end
    if act == "G" or act == "N" then return i end
    if act:match("[tmqeu]") then
      if post == "" then break end
      keys = post
    end
  end
  if last == "g" then return group(text, i) end
  if last == "s" then return glue(text, i) end
  if last ~= "" then return value(text, i, last == "d") end
  return i
end

-- (prims: the primitives, and the document's names \let to one)
local function strip(text, prims)
  local out, i = {}, 1
  while true do
    local s, e, name = text:find("\\([%a@]+)", i)
    if not s then break end
    out[#out + 1] = text:sub(i, s - 1)
    if prims[name] then
      i = skip(text, e + 1, prims[name])
    else
      out[#out + 1] = text:sub(s, e)
      i = e + 1
    end
  end
  out[#out + 1] = text:sub(i)
  return table.concat(out)
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

  -- a name \let to a primitive, or to such a name, is removed as the
  -- primitive is, and its definition with it
  local prims = setmetatable({}, {__index = primitives})
  repeat
    local found = false
    for name, definition in pairs(definitions) do
      local target = definition.def and definition.def:match("^\\let\\[%a@]+\\([%a@]+)$")
      if target and prims[target] then
        prims[name:sub(2)], definitions[name], found = prims[target], nil, true
      end
    end
  until not found

  -- the macros the math uses, and those they use in turn
  local used, queue, texts = {}, {}, {}
  for _, el in ipairs(document:query_selector(".mathjax-inline, .mathjax-block, .mathjax-env")) do
    source.each_text(el, function(node) dom.set_node_text(node, strip(node:get_text(), prims)) end)
    texts[#texts + 1] = el:get_text()
    for _, name in ipairs(preamble.uses(texts[#texts])) do queue[#queue + 1] = name end
  end
  while #queue > 0 do
    local name = table.remove(queue)
    local definition = definitions[name]
    if definition and not used[name] then
      definition.def, definition.body = strip(definition.def, prims), strip(definition.body, prims)
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
