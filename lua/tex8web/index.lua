-- The indexes, which make4ht leaves alone: after the first LaTeX run,
-- makeindex on each, with each number in the index a link back to its
-- \index, numbering them as tex4ht does rather than by page.
local files = require "tex8web.files"
local indexing = require "make4ht-indexing"

local log = logging.new("tex8web")

local M = {}

-- makeindex gets each \index's number past this in place of its page:
-- numbers an entry's text won't hold, so M.link can link each wherever it
-- is. (make4ht-indexing.lua's fix_idx_pages looks for the pages after the
-- entry's first ^, [ or comma, which takes a number in $L^2$ or "Theorem,
-- 2nd form" for one)
local offset = 1000000

-- the indexes the document prints, as {name =, options =}: imakeidx's, from
-- the commands tex8web-hooks.sty notes in the .aux (makeindex's options
-- only: makeindex runs in place of xindy); otherwise makeidx's, the
-- document's .idx, if it has one
function M.indexes(aux, input, has_idx)
  local found = {}
  for program, options, name in aux:gmatch("%% tex8web index: (%S+) +(.-) *(%S+)%.idx\n") do
    found[#found + 1] = {name = name, options = program == "makeindex" and options or ""}
  end
  if #found == 0 and has_idx then found[1] = {name = input, options = ""} end
  return found
end

-- the .ind with each of the numbers M.prepare gave makeindex a link to its
-- \index (map: make4ht-indexing.lua's parse_idx's, by those numbers)
function M.link(ind, map)
  return (ind:gsub("%d+", function(number)
    local entry = map[tonumber(number)]
    if not entry then return end
    return "\\Link[" .. entry.file .. "]{" .. entry.dest .. "}{}" .. entry.locator .. "\\EndLink{}"
  end))
end

-- the .idx for makeindex, with the numbers past offset, and the map
-- M.link takes, from tex4ht's .idx (a \beforeentry before each \indexentry)
function M.prepare(idx)
  local parsed = indexing.parse_idx(idx)
  local map = {}
  for n, entry in pairs(parsed.map) do
    -- (a locator is \Configure{makeindex}'s)
    entry.locator = entry.locator or tostring(n)
    map[offset + n] = entry
  end
  return (parsed.idx:gsub("(\\indexentry[^\n]*{)(%d+)}", function(head, n)
    return head .. offset + tonumber(n) .. "}"
  end)), map
end

-- runs makeindex on each index the document prints, in the build directory,
-- with the options imakeidx was given (a style file found in the directory
-- make4ht runs in, the document's). (makeindex won't write the .ind to a
-- build directory above it: openout_any = p. -r: three \index in a row
-- aren't a range, as their numbers aren't pages. A failed run is a warning,
-- as for the bibliography)
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

return M
