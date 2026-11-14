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
    -- (Only names that end in .bib, as latexmk checks: kpsewhich does
    -- not find a file of another type, a glob pattern, or a URL, which
    -- biblatex's location=remote leaves in a datasource of type file.
    -- biber also looks in its input directory, where filecontents writes.)
    for attributes, name in bcf:gmatch('<bcf:datasource type="file"([^>]*)>([^<]*)</bcf:datasource>') do
      if name:find("%.bib$") and not attributes:find('glob="true"', 1, true)
        and not name:find("^%a[%w+.-]*://") and not lfs.isfile(dir .. "/" .. name) then
        names[#names + 1] = name
      end
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
  -- When a .bib that the document names is missing, latexmk skips bibtex
  -- and biber, and LaTeX reads the .bbl beside the document for the PDF.
  -- The empty .bbl of bibtex or biber, or one from an earlier run, in the
  -- build directory would be read first.
  if lfs.isfile(par.input .. ".bbl") then
    for _, name in ipairs(names) do
      local p = io.popen("cd " .. files.quote(from) .. " && " .. path("BIBINPUTS")
        .. " kpsewhich -format=bib " .. files.quote(name))
      local found = p:read("a")
      p:close()
      if found == "" then
        -- (Shown at make4ht's default level, status. latexmk prints this
        -- as a message, not among its warnings.)
        log:status("bibliography: " .. name .. " is missing, so the .bbl beside the document is used")
        -- (The build directory may name the document's own directory,
        -- as ./ or by its absolute path, where the .bbl is the one beside.)
        local a, b = lfs.attributes(dir), lfs.attributes(".")
        if not (a and a.ino == b.ino and a.dev == b.dev) then os.remove(dir .. "/" .. par.input .. ".bbl") end
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
