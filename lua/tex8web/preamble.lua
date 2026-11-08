-- Reading macro definitions from LaTeX source: the document's and those of
-- the local packages it loads. String work only, without the page, so that
-- test/unit/ can test it alone.
local files = require "tex8web.files"

local log = logging and logging.new("tex8web")

local M = {}

-- commands MathJax does not have; a definition that uses one cannot be
-- given to MathJax as it is (it needs a \WebMathMacros version)
local unsupported = {}
for _, name in ipairs({
  "mathpalette", "makebox", "reflectbox", "scalebox", "resizebox", "rotatebox",
  "scalerel", "settowidth", "widthof", "TextOrMath", "ifmmode", "ifx",
  "expandafter", "csname",
}) do unsupported["\\" .. name] = true end

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

-- readers by definition command. Each reads the arguments after the
-- command and its star, and returns the macro's name, the definition for
-- MathJax, the text it expands to (to find the macros it uses), the index
-- after it, and, for a definition MathJax cannot have, why
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
-- Others are kept with the reason MathJax cannot have them, for
-- macros.define to report if the math uses them
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

-- the files a \usepackage, \RequirePackage, \input, \include or
-- \InputIfFileExists at i loads, and the index after it
local function loads(command, s, i)
  local names = {}
  if command == "usepackage" or command == "RequirePackage" then
    local _, j = optional(s, i)
    local list, after = argument(s, j or i)
    -- (a brace that never closes: the rest of the source is its text)
    i = after or #s + 1
    for name in (list or ""):gmatch("[^,%s]+") do names[#names + 1] = name .. ".sty" end
  elseif command == "input" or command == "include" or command == "InputIfFileExists" then
    local j = skip_space(s, i)
    local name, after
    if s:sub(j, j) == "{" then
      name, after = group(s, j)
    elseif command == "input" and j > i then
      name, after = s:match("^([^%s{}\\]+)()", j)
    end
    if name then
      i = after
      name = trim(name)
      -- TeX adds .tex to a name without an extension
      names[1] = name:match("[^/]*%.[^/]*$") and name or name .. ".tex"
    end
  end
  return names, i
end

-- reads the definitions in a source file into definitions, as name ->
-- {def, body, problem}, in order: later definitions replace earlier ones,
-- except that \providecommand keeps an existing one. Returns the files the
-- source loads, which may hold more: local packages, and what it \inputs
-- or \includes. load, if given, is called with each file and the command
-- that loads it, where it is loaded, before the definitions after it.
function M.read(s, definitions, load)
  s = strip_comments(s)
  local i, loaded = 1, {}
  while true do
    local start, stop, command, star = s:find("\\(%a+)(%*?)", i)
    if not start then break end
    i = stop + 1
    local reader = readers[command]
    if reader then
      local ok, name, def, body, after, why = pcall(reader, s, i, star)
      if ok and name and (def or why) then
        local provide = command == "providecommand" or command == "ProvideDocumentCommand"
        if not (provide and definitions[name]) then
          definitions[name] = {def = def, body = body, problem = why}
        end
        i = after
      elseif not ok and log then
        log:debug("couldn't read \\" .. command .. ": " .. tostring(name))
      end
    else
      local names, after = loads(command, s, i)
      i = after
      for _, name in ipairs(names) do
        loaded[#loaded + 1] = name
        if load then load(name, command) end
      end
    end
  end
  return loaded
end

-- the definitions in the document, the local packages it loads, and the
-- files it inputs, in the order TeX reads them: each file where it is
-- loaded, a package once, and an \input file each time, but never inside
-- itself
function M.document(tex_file)
  local definitions, packages, reading = {}, {}, {}
  local function visit(path, command)
    if command == "usepackage" or command == "RequirePackage" then
      if packages[path] then return end
      packages[path] = true
    end
    local s = not reading[path] and files.read(path)
    if not s then return end
    reading[path] = true
    M.read(s, definitions, visit)
    reading[path] = nil
  end
  visit(tex_file)
  return definitions
end

-- the macros a piece of source uses
function M.uses(text)
  local names = {}
  for name in text:gmatch("\\%a+") do names[#names + 1] = name end
  -- and control symbols, which can be macros too (\newcommand{\1}{..})
  for name in text:gmatch("\\[^%a%s]") do names[#names + 1] = name end
  return names
end

-- why MathJax cannot use a definition, or nil
function M.problem(body)
  if body:find("\\[%a]*@") then return "uses an internal (@) macro" end
  for _, name in ipairs(M.uses(body)) do
    if unsupported[name] then return "uses " .. name end
  end
end

return M
