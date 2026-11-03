-- MathJax reads the math's LaTeX source but not the document's preamble, so
-- it doesn't know the document's own macros. Give it the definitions of
-- those the math uses, read from the document and the local packages it
-- loads, and nothing else of the source.
local preamble = require "tex8web.preamble"
local dom = require "tex8web.dom"

local log = logging.new("tex8web")

local M = {}

-- macros of common packages that MathJax lacks, for math that uses them
-- (the document's own definitions take precedence)
local fallbacks = {
  ["\\bm"] = "\\newcommand{\\bm}[1]{\\boldsymbol{#1}}",
  ["\\qedhere"] = "\\newcommand{\\qedhere}{}",
}

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
  local used, queue = {}, {}
  for _, el in ipairs(document:query_selector(".mathjax-inline, .mathjax-block, .mathjax-env")) do
    for _, name in ipairs(preamble.uses(el:get_text())) do queue[#queue + 1] = name end
  end
  while #queue > 0 do
    local name = table.remove(queue)
    local definition = definitions[name]
    if definition and not used[name] then
      used[name] = definition
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
  if #defs == 0 then return end
  local body = document:query_selector("body")[1]
  local div = body:create_element("div", {class = "tex8web-macros", hidden = "hidden"})
  div:add_child_node(div:create_text_node("\\(" .. table.concat(defs, "\n") .. "\\)"))
  dom.set_children(body, {div, table.unpack(body:get_children())})
end

return M
