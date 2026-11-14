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
  local bcf = files.read(dir .. "/" .. par.input .. ".bcf")
  local here = lfs.currentdir()
  -- (after the paths already set, as tex8web.mk4 sets TEXINPUTS)
  local function path(name) return name .. "=" .. files.quote(here .. ":" .. (os.getenv(name) or "")) end
  -- the .bib files named, and the directory bibtex or biber looks them up from
  local command, names, from = nil, {}, dir
  if bcf then
    command = "biber --input-directory " .. files.quote(dir) .. " --output-directory "
      .. files.quote(dir) .. " " .. files.quote(par.input)
    for name in bcf:gmatch('<bcf:datasource type="file"[^>]*>([^<]*)</bcf:datasource>') do
      -- (biber also looks in its input directory)
      if not lfs.isfile(dir .. "/" .. name) then names[#names + 1] = name end
    end
    from = here
  elseif aux:find("\\bibdata", 1, true) then
    -- bibtex runs in the build directory, which it may not write to from
    -- here. BIBINPUTS and BSTINPUTS find the .bib and .bst files in the
    -- document's directory. kpathsea looks up a name that begins with ./
    -- or ../ only from the current directory, so such names in \bibdata
    -- and \bibstyle are made absolute. LaTeX writes the .aux again on its
    -- next run, and ignores both commands.
    local fixed = aux:gsub("(\\bib%a+){([^}]*)}", function(cs, list)
      if cs ~= "\\bibdata" and cs ~= "\\bibstyle" then return end
      return cs .. "{" .. list:gsub("[^,]+", function(name)
        if name:find("^%.%.?/") then return here .. "/" .. name end
      end) .. "}"
    end)
    if fixed ~= aux then
      local f = io.open(dir .. "/" .. par.input .. ".aux", "w")
      f:write(fixed)
      f:close()
    end
    for list in fixed:gmatch("\\bibdata{([^}]*)}") do
      for name in list:gmatch("[^,]+") do names[#names + 1] = name end
    end
    command = "cd " .. files.quote(dir) .. " && " .. path("BIBINPUTS") .. " " .. path("BSTINPUTS")
      .. " bibtex " .. files.quote(par.input)
  else
    return 0
  end
  -- A .bbl beside the document, with a .bib that it names missing, is what
  -- LaTeX reads for the PDF, and latexmk then skips bibtex and biber. Their
  -- empty .bbl, or one from an earlier run, in the build directory would
  -- be read first.
  if lfs.isfile(par.input .. ".bbl") then
    for _, name in ipairs(names) do
      local p = io.popen("cd " .. files.quote(from) .. " && " .. path("BIBINPUTS")
        .. " kpsewhich -format=bib " .. files.quote(name))
      local found = p:read("a")
      p:close()
      if found == "" then
        log:info("bibliography: " .. name .. " is missing, so the .bbl beside the document is used")
        if dir ~= "." then os.remove(dir .. "/" .. par.input .. ".bbl") end
        return 0
      end
    end
  end
  log:info("bibliography: " .. command)
  -- (texlua's os.execute returns the exit status, not Lua 5.3's true)
  if os.execute(command .. " > /dev/null") ~= 0 then log:warning("the bibliography failed (" .. command .. ")") end
  return 0
end

return M
