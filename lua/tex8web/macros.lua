-- MathJax reads the math's LaTeX source but not the document's preamble, so
-- it doesn't know the document's own macros. Give it the definitions of
-- those the math uses, read from the document and the local packages it
-- loads, and nothing else of the source.
local dom = require "tex8web.dom"

local log = logging.new("tex8web")

local M = {}

-- commands MathJax doesn't have; a definition that uses one can't be
-- given to MathJax as it is (it needs a \WebMathMacros version)
local unsupported = {
  "mathpalette", "makebox", "reflectbox", "scalebox", "resizebox", "rotatebox",
  "scalerel", "settowidth", "widthof", "TextOrMath", "ifmmode", "ifx",
  "expandafter", "csname",
}

-- macros of common packages that MathJax lacks, for math that uses them
-- (the document's own definitions take precedence)
local fallbacks = {
  ["\\bm"] = "\\newcommand{\\bm}[1]{\\boldsymbol{#1}}",
  ["\\qedhere"] = "\\newcommand{\\qedhere}{}",
}

local function strip_comments(s)
  return (s:gsub("\\%%", "\0"):gsub("%%[^\n]*", ""):gsub("%z", "\\%%"))
end

local function skip_space(s, i)
  return s:find("%S", i) or #s + 1
end

-- the text of the group that opens at i (without its braces), and the
-- index after it
local function group(s, i)
  local depth, j = 0, i
  while j <= #s do
    local c = s:sub(j, j)
    if c == "\\" then
      j = j + 1
    elseif c == "{" then
      depth = depth + 1
    elseif c == "}" then
      depth = depth - 1
      if depth == 0 then return s:sub(i + 1, j - 1), j + 1 end
    end
    j = j + 1
  end
end

-- an argument: a group, or a single control sequence or character
local function argument(s, i)
  i = skip_space(s, i)
  if s:sub(i, i) == "{" then return group(s, i) end
  local cs = s:match("^\\[%a@]+", i) or s:match("^\\.", i) or s:sub(i, i)
  return cs, i + #cs
end

-- an optional argument [..] at i, if there is one
local function optional(s, i)
  local j = skip_space(s, i)
  if s:sub(j, j) ~= "[" then return nil, i end
  local depth = 0
  for k = j, #s do
    local c = s:sub(k, k)
    if c == "{" then depth = depth + 1
    elseif c == "}" then depth = depth - 1
    elseif c == "]" and depth == 0 then return s:sub(j + 1, k - 1), k + 1 end
  end
end

local function trim(s)
  return s:match("^%s*(.-)%s*$")
end

-- the definition commands this understands. Each reads its arguments from
-- after the command (and its star) and returns the macro's name, the
-- definition for MathJax, and the text it expands to (to find the macros
-- it uses in turn)
local readers = {}

function readers.newcommand(s, i)
  local name, n, default, body
  name, i = argument(s, i)
  n, i = optional(s, i)
  default, i = optional(s, i)
  body, i = argument(s, i)
  local def = "\\newcommand{" .. trim(name) .. "}"
    .. (n and "[" .. n .. "]" or "") .. (default and "[" .. default .. "]" or "")
    .. "{" .. body .. "}"
  return trim(name), def, body, i
end
readers.renewcommand = readers.newcommand
readers.providecommand = readers.newcommand

-- xparse's commands, for argument specs \newcommand can express: mandatory
-- arguments, after at most one optional argument with a default (O{..}).
-- Others are kept with the reason MathJax can't have them, for define to
-- report if the math uses them
function readers.NewDocumentCommand(s, i)
  local name, spec, body
  name, i = argument(s, i)
  spec, i = argument(s, i)
  body, i = argument(s, i)
  name = trim(name)
  local rest = spec:gsub("%+", "")
  local default
  if rest:match("^%s*O") then
    default, rest = rest:match("^%s*O(%b{})(.*)$")
    default = default and default:sub(2, -2)
  end
  local n = 0
  for c in rest:gmatch("%S") do
    if c ~= "m" then
      return name, nil, body, i, "has the argument spec {" .. spec .. "}"
    end
    n = n + 1
  end
  if default then n = n + 1 end
  local def = "\\newcommand{" .. name .. "}" .. (n > 0 and "[" .. n .. "]" or "")
    .. (default and "[" .. default .. "]" or "") .. "{" .. body .. "}"
  return name, def, body, i
end
readers.RenewDocumentCommand = readers.NewDocumentCommand
readers.DeclareDocumentCommand = readers.NewDocumentCommand
readers.ProvideDocumentCommand = readers.NewDocumentCommand

-- (as \mathop rather than MathJax's \operatorname, which leaves out the
-- space between a number and the operator: 2\Var X. The starred form's
-- limits go under it in display math only)
function readers.DeclareMathOperator(s, i, star)
  local name, body
  name, i = argument(s, i)
  body, i = argument(s, i)
  local def = "\\newcommand{" .. trim(name) .. "}{\\mathop{\\mathrm{" .. body .. "}}"
    .. (star == "*" and "" or "\\nolimits") .. "}"
  return trim(name), def, body, i
end

function readers.DeclarePairedDelimiter(s, i)
  local name, left, right
  name, i = argument(s, i)
  left, i = argument(s, i)
  right, i = argument(s, i)
  local def = "\\DeclarePairedDelimiter{" .. trim(name) .. "}{" .. left .. "}{" .. right .. "}"
  return trim(name), def, left .. right, i
end

function readers.DeclarePairedDelimiterX(s, i)
  local name, n, left, right, body
  name, i = argument(s, i)
  n, i = optional(s, i)
  left, i = argument(s, i)
  right, i = argument(s, i)
  body, i = argument(s, i)
  local def = "\\DeclarePairedDelimiterX{" .. trim(name) .. "}" .. (n and "[" .. n .. "]" or "")
    .. "{" .. left .. "}{" .. right .. "}{" .. body .. "}"
  return trim(name), def, left .. right .. body, i
end

function readers.def(s, i)
  local name = s:match("^%s*(\\[%a@]+)", i)
  if not name then return end
  local params, j = s:match("^%s*\\[%a@]+([^{]*)()", i)
  local body
  body, i = group(s, j)
  if not body then return end
  return name, "\\def" .. name .. params .. "{" .. body .. "}", body, i
end

function readers.let(s, i)
  local name, target, j = s:match("^%s*(\\[%a@]+)%s*=?%s*(\\[%a@]+)()", i)
  if not name then return end
  return name, "\\let" .. name .. target, target, j
end

-- the definitions in a source file: name -> {def, body}; and the local
-- packages it loads
local function read_definitions(s, definitions)
  s = strip_comments(s)
  local i = 1
  while true do
    local start, stop, command, star = s:find("\\(%a+)(%*?)", i)
    if not start then break end
    i = stop + 1
    local reader = readers[command]
    if reader then
      local ok, name, def, body, after, why = pcall(reader, s, i, star)
      if ok and name and (def or why) then
        definitions[name] = {def = def, body = body, problem = why}
        i = after
      end
    end
  end
  local packages = {}
  for _, command in ipairs({"usepackage", "RequirePackage"}) do
    for list in s:gmatch("\\" .. command .. "%s*(%b{})") do packages[#packages + 1] = list end
    for list in s:gmatch("\\" .. command .. "%s*%b[]%s*(%b{})") do packages[#packages + 1] = list end
  end
  local files = {}
  for _, list in ipairs(packages) do
    for name in list:sub(2, -2):gmatch("[^,%s]+") do files[#files + 1] = name .. ".sty" end
  end
  return files
end

local function read_file(path)
  local f = io.open(path)
  if not f then return end
  local s = f:read("*a")
  f:close()
  return s
end

-- the definitions in the document and the local packages it loads
local function document_definitions(tex_file)
  local definitions, seen, queue = {}, {}, {tex_file}
  while #queue > 0 do
    local path = table.remove(queue, 1)
    local s = not seen[path] and read_file(path)
    seen[path] = true
    if s then
      for _, file in ipairs(read_definitions(s, definitions)) do
        queue[#queue + 1] = file
      end
    end
  end
  return definitions
end

local function uses(text)
  local names = {}
  for name in text:gmatch("\\%a+") do names[#names + 1] = name end
  -- and control symbols, which can be macros too (\newcommand{\1}{..})
  for name in text:gmatch("\\[^%a%s]") do names[#names + 1] = name end
  return names
end

-- why MathJax can't use a definition, if it can't
local function problem(body)
  if body:find("\\[%a]*@") then return "uses an internal (@) macro" end
  for _, name in ipairs(uses(body)) do
    for _, bad in ipairs(unsupported) do
      if name == "\\" .. bad then return "uses " .. name end
    end
  end
end

function M.define(document, parameters)
  local definitions = document_definitions(parameters.tex_file)
  for name, def in pairs(fallbacks) do
    definitions[name] = definitions[name] or {def = def, body = "", override = true}
  end
  -- the cfg's \WebMathMacros, which take precedence
  local overrides = {}
  for _, script in ipairs(document:query_selector("script[type='text/x-tex8web-macros']")) do
    read_definitions(script:get_text(), overrides)
    script:remove_node()
  end
  for name, definition in pairs(overrides) do
    definition.override = true
    definitions[name] = definition
  end

  -- the macros the math uses, and those they use in turn
  local used, queue = {}, {}
  for _, el in ipairs(document:query_selector(".mathjax-inline, .mathjax-block, .mathjax-env")) do
    for _, name in ipairs(uses(el:get_text())) do queue[#queue + 1] = name end
  end
  while #queue > 0 do
    local name = table.remove(queue)
    local definition = definitions[name]
    if definition and not used[name] then
      used[name] = definition
      for _, inner in ipairs(uses(definition.body)) do queue[#queue + 1] = inner end
    end
  end

  local names = {}
  for name in pairs(used) do names[#names + 1] = name end
  table.sort(names)
  local defs, skipped = {}, {}
  for _, name in ipairs(names) do
    local definition = used[name]
    local why = not definition.override and (definition.problem or problem(definition.body))
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
