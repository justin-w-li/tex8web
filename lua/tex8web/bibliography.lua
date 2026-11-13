-- The bibliography, which make4ht does not build: after the first LaTeX run,
-- bibtex (for \bibliography, or biblatex's bibtex backend) or biber (for
-- biblatex), and LaTeX again until the references settle.
local files = require "tex8web.files"

local log = logging.new("tex8web")

local M = {}

-- runs bibtex or biber on the auxiliary files in the build directory, if
-- the document has a bibliography. (A failed run is only a warning: the
-- page is still useful with unresolved references.)
function M.run(par)
  local dir = (par.builddir ~= "" and par.builddir) or "."
  local aux = files.read(dir .. "/" .. par.input .. ".aux") or ""
  local command
  if files.read(dir .. "/" .. par.input .. ".bcf") then
    command = "biber --input-directory " .. files.quote(dir) .. " --output-directory "
      .. files.quote(dir) .. " " .. files.quote(par.input)
  elseif aux:find("\\bibdata", 1, true) then
    -- (run in the build directory, which bibtex may not write to from
    -- here; BIBINPUTS finds the .bib files in the document's directory.
    -- kpathsea looks up a name that begins with ./ or ../ only from the
    -- current directory, so such names in \bibdata and \bibstyle are made
    -- absolute. LaTeX writes the .aux again on its next run, and ignores
    -- both commands)
    local here = lfs.currentdir()
    local fixed = aux:gsub("(\\bib%a+){([^}]*)}", function(command, names)
      if command ~= "\\bibdata" and command ~= "\\bibstyle" then return end
      return command .. "{" .. names:gsub("[^,]+", function(name)
        if name:find("^%.%.?/") then return here .. "/" .. name end
      end) .. "}"
    end)
    if fixed ~= aux then
      local f = io.open(dir .. "/" .. par.input .. ".aux", "w")
      f:write(fixed)
      f:close()
    end
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
