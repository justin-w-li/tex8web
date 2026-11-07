-- The bibliography, which make4ht leaves alone: after the first LaTeX run,
-- bibtex (for \bibliography, or biblatex's bibtex backend) or biber (for
-- biblatex), and LaTeX again until the references settle.
local files = require "tex8web.files"

local log = logging.new("tex8web")

local M = {}

-- runs bibtex or biber on the document's auxiliary files in the build
-- directory, if it has a bibliography. (A failed run is a warning: the page
-- is still worth having, with its references unresolved)
function M.run(par)
  local dir = (par.builddir ~= "" and par.builddir) or "."
  local aux = files.read(dir .. "/" .. par.input .. ".aux") or ""
  local command
  if files.read(dir .. "/" .. par.input .. ".bcf") then
    command = "biber --input-directory " .. files.quote(dir) .. " --output-directory "
      .. files.quote(dir) .. " " .. files.quote(par.input)
  elseif aux:find("\\bibdata", 1, true) then
    -- (in the build directory, which bibtex may not write to from here,
    -- finding the .bib files in the document's)
    local here = lfs.currentdir()
    command = "cd " .. files.quote(dir) .. " && BIBINPUTS=" .. files.quote(here) .. ": bibtex "
      .. files.quote(par.input)
  else
    return 0
  end
  log:info("bibliography: " .. command)
  -- (texlua's os.execute returns the exit status, not Lua 5.3's true)
  if os.execute(command .. " > /dev/null") ~= 0 then log:warning("the bibliography failed (" .. command .. ")") end
  return 0
end

return M
