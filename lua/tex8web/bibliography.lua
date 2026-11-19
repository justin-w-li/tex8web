-- The bibliography, which make4ht does not build: after the first LaTeX run,
-- bibtex (for \bibliography, or biblatex's bibtex backend) or biber (for
-- biblatex), and LaTeX again until the references settle.
local files = require "tex8web.files"

local log = logging.new("tex8web")

local M = {}

-- (after the paths already set, as tex8web.mk4 sets TEXINPUTS)
local function path(name) return name .. "=" .. files.quote(lfs.currentdir() .. ":" .. (os.getenv(name) or "")) end

-- the first of the .bib files named that kpsewhich does not find, looked
-- up from the directory from
function M.missing(names, from)
  for _, name in ipairs(names) do
    local p = io.popen("cd " .. files.quote(from) .. " && " .. path("BIBINPUTS")
      .. " kpsewhich -format=bib " .. files.quote(name))
    local found = p:read("a")
    p:close()
    if found == "" then return name end
  end
end

-- runs bibtex or biber on the auxiliary files in the build directory, if
-- the document has a bibliography. (A failed run is only a warning: the
-- page is still useful with unresolved references.)
function M.run(par)
  local dir = (par.builddir ~= "" and par.builddir) or "."
  local aux = files.read(dir .. "/" .. par.input .. ".aux") or ""
  local bcf = files.read(dir .. "/" .. par.input .. ".bcf")
  local here = lfs.currentdir()
  -- removes the .bbl in the build directory, an empty one from
  -- tex8web.mk4 or one from an earlier run, so that LaTeX reads the one
  -- beside the document. (The build directory may name the document's
  -- own directory, as ./ or by its absolute path, where the .bbl is the
  -- one beside.)
  local function use_beside()
    local a, b = lfs.attributes(dir), lfs.attributes(".")
    if not (a and a.ino == b.ino and a.dev == b.dev) then os.remove(dir .. "/" .. par.input .. ".bbl") end
  end
  -- the .bib files named, and the directory bibtex or biber looks them up from
  local command, names, from = nil, {}, dir
  -- the .aux that bibtex reads, when it differs from the one LaTeX wrote
  local bibtex_aux
  local function write_aux(text)
    local f = io.open(dir .. "/" .. par.input .. ".aux", "w")
    f:write(text)
    f:close()
  end
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
    -- and \bibstyle are made absolute for bibtex's run only: a changed
    -- .aux would take one more LaTeX run.
    local fixed = aux:gsub("(\\bib%a+){([^}]*)}", function(cs, list)
      if cs ~= "\\bibdata" and cs ~= "\\bibstyle" then return end
      return cs .. "{" .. list:gsub("[^,]+", function(name)
        if name:find("^%.%.?/") then return here .. "/" .. name end
      end) .. "}"
    end)
    if fixed ~= aux then bibtex_aux = fixed end
    for list in fixed:gmatch("\\bibdata{([^}]*)}") do
      for name in list:gmatch("[^,]+") do names[#names + 1] = name end
    end
    command = "cd " .. files.quote(dir) .. " && " .. path("BIBINPUTS") .. " " .. path("BSTINPUTS")
      .. " bibtex " .. files.quote(par.input)
  else
    -- (with no bibtex or biber run, a .bbl beside the document is read
    -- by the document itself, as with \input{\jobname.bbl})
    if lfs.isfile(par.input .. ".bbl") then use_beside() end
    return 0
  end
  -- When a .bib that the document names is missing, latexmk skips bibtex
  -- and biber, and LaTeX reads the .bbl beside the document for the PDF.
  -- The .bbl in the build directory would be read first.
  local name = lfs.isfile(par.input .. ".bbl") and M.missing(names, from)
  if name then
    -- (Shown at make4ht's default level, status. latexmk prints this
    -- as a message, not among its warnings.)
    log:status("bibliography: " .. name .. " is missing, so the .bbl beside the document is used")
    use_beside()
    return 0
  end
  log:info("bibliography: " .. command)
  -- (biber writes its .bbl only at the end of its run, and none when it
  -- is missing or stops early. The empty .bbl from tex8web.mk4 would then
  -- hide the one beside the document, which LaTeX reads when biber fails.)
  if lfs.attributes(dir .. "/" .. par.input .. ".bbl", "size") == 0 then use_beside() end
  if bibtex_aux then write_aux(bibtex_aux) end
  -- (texlua's os.execute returns the exit status, not Lua 5.3's true)
  if os.execute(command .. " > /dev/null") ~= 0 then log:warning("the bibliography failed (" .. command .. ")") end
  if bibtex_aux then write_aux(aux) end
  return 0
end

return M
