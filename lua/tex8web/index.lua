-- The index, which make4ht leaves alone: after the first LaTeX run,
-- makeindex, through make4ht's indexing library (make4ht-indexing.lua),
-- which links each number in the index back to its \index, numbering them
-- as tex4ht does rather than by page.
local files = require "tex8web.files"
local indexing = require "make4ht-indexing"

local M = {}

-- runs makeindex on the document's .idx in the build directory, if it has
-- one (makeidx's or imakeidx's \makeindex). (Make:makeindex runs it from
-- the document's directory, leaving its log there, and makeindex won't write
-- the .ind to a build directory above it: openout_any = p)
function M.run(par)
  local dir = (par.builddir ~= "" and par.builddir) or "."
  if not lfs.attributes(dir .. "/" .. par.input .. ".idx") then return 0 end
  indexing.run_indexing_command("cd " .. files.quote(dir) .. " && makeindex -q -t "
    .. files.quote(par.input .. ".ilg") .. " -o " .. files.quote(par.input .. ".ind") .. " ${newidxfile}", par)
  return 0
end

return M
