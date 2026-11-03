-- The bibliography, which make4ht leaves alone: after the first LaTeX run,
-- bibtex (for \bibliography, or biblatex's bibtex backend) or biber (for
-- biblatex), and LaTeX again until the references settle.
local log = logging.new("tex8web")

local M = {}

local function quote(s)
  return "'" .. s:gsub("'", "'\\''") .. "'"
end

local function read(path)
  local f = io.open(path)
  if not f then return nil end
  local s = f:read("*a")
  f:close()
  return s
end

-- runs bibtex or biber on the document's auxiliary files in the build
-- directory, if it has a bibliography. (A failed run is a warning: the page
-- is still worth having, with its references unresolved)
function M.run(par)
  local dir = (par.builddir ~= "" and par.builddir) or "."
  local aux = read(dir .. "/" .. par.input .. ".aux") or ""
  local command
  if read(dir .. "/" .. par.input .. ".bcf") then
    command = "biber --input-directory " .. quote(dir) .. " --output-directory " .. quote(dir)
      .. " " .. quote(par.input)
  elseif aux:find("\\bibdata", 1, true) then
    -- (in the build directory, which bibtex may not write to from here,
    -- finding the .bib files in the document's)
    local here = lfs.currentdir()
    command = "cd " .. quote(dir) .. " && BIBINPUTS=" .. quote(here) .. ": bibtex " .. quote(par.input)
  else
    return 0
  end
  log:info("bibliography: " .. command)
  local ok = os.execute(command .. " > /dev/null")
  if not ok then log:warning("the bibliography failed (" .. command .. ")") end
  return 0
end

return M
