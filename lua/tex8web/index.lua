-- The indexes and glossaries, which make4ht does not build: after the first
-- LaTeX run, makeindex on each index, and makeglossaries, which runs again
-- after the last LaTeX run if the glossaries changed. Each number in an
-- index counts \index commands and links back to its \index (see "Indexes"
-- in CONTRIBUTING.md).
local files = require "tex8web.files"
local indexing = require "make4ht-indexing"

local log = logging.new("tex8web")

local M = {}

-- makeindex is given offset + n in place of each \index's page: a number
-- no entry's text holds, so M.link can replace each one wherever it is.
-- (make4ht-indexing.lua's fix_idx_pages, not used here, takes the numbers
-- after an entry's first ^, [, or comma as its pages, so it misreads a
-- number in $L^2$ or "Theorem, 2nd form".)
local offset = 1000000

-- the indexes the document prints, as {name =, options =}: imakeidx's, from
-- the commands tex8web-hooks.sty records in the .aux, or else makeidx's
-- .idx, if there is one. Only makeindex's options are kept, as makeindex
-- runs in place of xindy.
function M.indexes(aux, input, has_idx)
  local found = {}
  for program, options, name in aux:gmatch("%% tex8web index: (%S+) +(.-) *(%S+)%.idx\n") do
    found[#found + 1] = {name = name, options = program == "makeindex" and options or ""}
  end
  if #found == 0 and has_idx then found[1] = {name = input, options = ""} end
  return found
end

-- the .ind with each number from M.prepare made a link to its \index
-- (map: make4ht-indexing.lua's parse_idx map, keyed by those numbers)
function M.link(ind, map)
  return (ind:gsub("%d+", function(number)
    local entry = map[tonumber(number)]
    if not entry then return end
    return "\\Link[" .. entry.file .. "]{" .. entry.dest .. "}{}" .. entry.locator .. "\\EndLink{}"
  end))
end

-- the .idx for makeindex, with the numbers past offset, and the map for
-- M.link, from tex4ht's .idx (a \beforeentry before each \indexentry)
function M.prepare(idx)
  local parsed = indexing.parse_idx(idx)
  local map = {}
  for n, entry in pairs(parsed.map) do
    -- (entry.locator comes from \Configure{makeindex})
    entry.locator = entry.locator or tostring(n)
    map[offset + n] = entry
  end
  return (parsed.idx:gsub("(\\indexentry[^\n]*{)(%d+)}", function(head, n)
    return head .. offset + tonumber(n) .. "}"
  end)), map
end

-- runs makeindex on each index with imakeidx's options. A style file is
-- found in the document's directory, where make4ht runs. makeindex runs in
-- the build directory because it does not write the .ind to a directory
-- above it (openout_any = p). -r: the numbers are not pages, so three
-- \index in a row are not a range. A failed run is a warning, as for the
-- bibliography.
function M.run(par)
  local dir = (par.builddir ~= "" and par.builddir) or "."
  local aux = files.read(dir .. "/" .. par.input .. ".aux") or ""
  local styles = lfs.currentdir() .. ":" .. (os.getenv("INDEXSTYLE") or "")
  for _, index in ipairs(M.indexes(aux, par.input, lfs.attributes(dir .. "/" .. par.input .. ".idx"))) do
    local options = index.options:gsub("%S+", files.quote)
    local command = "cd " .. files.quote(dir) .. " && INDEXSTYLE=" .. files.quote(styles)
      .. " makeindex -q -r -i -t " .. files.quote(index.name .. ".ilg") .. " -o " .. files.quote(index.name .. ".ind")
      .. " " .. options
    log:info("index: " .. command)
    indexing.load_enc()
    local idx, map = M.prepare(files.read(dir .. "/" .. index.name .. ".idx") or "")
    local makeindex = io.popen(command, "w")
    makeindex:write(idx)
    local ind = dir .. "/" .. index.name .. ".ind"
    local text = makeindex:close() and files.read(ind)
    if text then
      local f = io.open(ind, "w")
      f:write(M.link(text, map))
      f:close()
    else
      log:warning("the index failed (" .. command .. ")")
    end
  end
  return 0
end

-- the glossaries' input files (.glo, .acn, ...) last given to
-- makeglossaries
local sorted

-- the style file's name, if the document has \makeglossaries (glossaries
-- writes it to the .aux then; \makenoidxglossaries sorts in LaTeX and
-- writes none), and the input files of the glossaries listed in the .aux
local function inputs(par)
  local dir = (par.builddir ~= "" and par.builddir) or "."
  local aux = files.read(dir .. "/" .. par.input .. ".aux") or ""
  local style = aux:match("\\@istfilename{([^}]*)}")
  if not style then return end
  local found = {}
  for ext in aux:gmatch("\\@newglossary{[^}]*}{[^}]*}{[^}]*}{([^}]*)}") do
    found[#found + 1] = files.read(dir .. "/" .. par.input .. "." .. ext) or ""
  end
  return style, table.concat(found, "\0")
end

-- runs makeglossaries if the document has \makeglossaries and the
-- glossaries' input files changed since the last run. Returns whether it
-- ran. A failed run is a warning, as for the index.
local function makeglossaries(par)
  local style, text = inputs(par)
  if not style or text == sorted then return false end
  sorted = text
  local dir = (par.builddir ~= "" and par.builddir) or "."
  -- (glossaries writes its style file to the build directory, the working
  -- directory of makeindex or xindy after -d; with \noist, the document's
  -- own is next to the document, where make4ht runs)
  local own = lfs.currentdir() .. "/" .. style
  local option = ""
  if not lfs.attributes(dir .. "/" .. style) and lfs.attributes(own) then option = " -s " .. files.quote(own) end
  local command = "makeglossaries -q" .. option .. " -d " .. files.quote(dir) .. " " .. files.quote(par.input)
  log:info("glossaries: " .. command)
  -- (texlua's os.execute returns the exit status, not Lua 5.3's true)
  if os.execute(command .. " > /dev/null") ~= 0 then log:warning("the glossaries failed (" .. command .. ")") end
  return true
end

-- makeglossaries, after the first LaTeX run
function M.glossaries(par)
  makeglossaries(par)
  return 0
end

-- the files whose change needs another LaTeX run: the cross-references
-- and the table of contents (autohtlatex's list)
local function checksum(par)
  local dir = (par.builddir ~= "" and par.builddir) or "."
  local sum = ""
  for _, ext in ipairs {"aux", "4tc", "xref"} do
    sum = md5.sumhexa(sum .. (files.read(dir .. "/" .. par.input .. "." .. ext) or ""))
  end
  return sum
end

-- the most LaTeX runs M.glossaries_again makes (autohtlatex's default)
local runs = 5

-- makeglossaries and LaTeX again, after LaTeX has settled, while the
-- glossaries' input files or LaTeX's cross-references change: an entry used
-- only in the description of another reaches the .glo only when the
-- glossary is printed (the glossaries manual asks for a second
-- makeglossaries run then), and a glossary that first has entries then
-- adds a heading to the table of contents. Returns LaTeX's status.
function M.glossaries_again(par)
  local before = checksum(par)
  for _ = 1, runs do
    if not makeglossaries(par) and checksum(par) == before then return 0 end
    before = checksum(par)
    -- (required here, as it needs make4ht's Make, which the unit tests lack)
    local status = require("make4ht-htlatex").htlatex(par)
    if status ~= 0 then return status end
  end
  local _, text = inputs(par)
  if text ~= sorted or checksum(par) ~= before then
    log:warning("the glossaries did not settle after " .. runs .. " more LaTeX runs")
  end
  return 0
end

return M
