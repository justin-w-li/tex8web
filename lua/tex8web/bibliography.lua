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

-- the .aux of each file read by \include that an .aux in the directory
-- dir names with \@input, as {path, text}, and the paths of those that do
-- not exist. LaTeX writes the \bibdata, \bibstyle, and \bibcite lines of
-- such a file there (latex.ltx, \@include), and bibtex reads that .aux in
-- place of the \@input line. (A file that \includeonly leaves out has no
-- .aux until a build includes it.)
function M.parts(dir, aux)
  local found, absent = {}, {}
  for name in aux:gmatch("\\@input{([^}]*)}") do
    local file = dir .. "/" .. name
    local text = files.read(file)
    if text then found[#found + 1] = {path = file, text = text} else absent[#absent + 1] = file end
  end
  return found, absent
end

-- the files whose change needs another LaTeX run: the cross-references,
-- the table of contents (make4ht's autohtlatex checks these three), and
-- the .aux of each file read by \include, where a bibliography there
-- writes its \bibcite lines
function M.checksum(par)
  local dir = (par.builddir ~= "" and par.builddir) or "."
  local sum = ""
  for _, ext in ipairs {"aux", "4tc", "xref"} do
    sum = md5.sumhexa(sum .. (files.read(dir .. "/" .. par.input .. "." .. ext) or ""))
  end
  for _, part in ipairs(M.parts(dir, files.read(dir .. "/" .. par.input .. ".aux") or "")) do
    sum = md5.sumhexa(sum .. part.text)
  end
  return sum
end

-- the most LaTeX runs M.settle makes after its first (make4ht's default)
M.runs = 5

-- LaTeX until the files of M.checksum stop changing, at most M.runs times
-- after the first run, in place of make4ht's autohtlatex. Returns LaTeX's
-- status.
function M.settle(par)
  -- (required here, as it needs make4ht's Make, which the unit tests lack)
  local htlatex = require("make4ht-htlatex").htlatex
  local before = M.checksum(par)
  local status = htlatex(par)
  for _ = 1, M.runs do
    if status ~= 0 then return status end
    local now = M.checksum(par)
    if now == before then return status end
    before = now
    status = htlatex(par)
  end
  return status
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
  -- the .aux files that bibtex reads: the document's, and those of the
  -- files read by \include
  local parts, missing = M.parts(dir, aux)
  local auxes = {{path = dir .. "/" .. par.input .. ".aux", text = aux}, table.unpack(parts)}
  local bibdata = false
  for _, file in ipairs(auxes) do
    if file.text:find("\\bibdata", 1, true) then bibdata = true end
  end
  -- those of them that differ for bibtex's run, as {path, text, fixed}
  local changed = {}
  -- the .aux files named with \@input that do not exist, for bibtex
  local absent = {}
  local function write(file, text)
    local f = io.open(file, "w")
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
  elseif bibdata then
    -- bibtex runs in the build directory, which it may not write to from
    -- here. BIBINPUTS and BSTINPUTS find the .bib and .bst files in the
    -- document's directory. kpathsea looks up a name that begins with ./
    -- or ../ only from the current directory, so such names in \bibdata
    -- and \bibstyle are made absolute for bibtex's run only: a changed
    -- .aux would take one more LaTeX run.
    -- (LaTeX writes a name in a file read by \include as given, so it
    -- too is relative to the document's directory.)
    for _, file in ipairs(auxes) do
      local fixed = file.text:gsub("(\\bib%a+){([^}]*)}", function(cs, list)
        if cs ~= "\\bibdata" and cs ~= "\\bibstyle" then return end
        return cs .. "{" .. list:gsub("[^,]+", function(name)
          if name:find("^%.%.?/") then return here .. "/" .. name end
        end) .. "}"
      end)
      if fixed ~= file.text then changed[#changed + 1] = {path = file.path, text = file.text, fixed = fixed} end
      for list in fixed:gmatch("\\bibdata{([^}]*)}") do
        for name in list:gmatch("[^,]+") do names[#names + 1] = name end
      end
    end
    -- A file that \includeonly leaves out has no .aux until a build
    -- includes it. bibtex skips its \@input line with an error, which
    -- latexmk ignores, so an empty .aux stands in for bibtex's run.
    absent = missing
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
  for _, file in ipairs(changed) do write(file.path, file.fixed) end
  -- (A folder that the document lacks is not made in the build
  -- directory, and bibtex then reports the error.)
  for _, file in ipairs(absent) do
    local f = io.open(file, "w")
    if f then f:close() end
  end
  -- (texlua's os.execute returns the exit status, not Lua 5.3's true)
  if os.execute(command .. " > /dev/null") ~= 0 then log:warning("the bibliography failed (" .. command .. ")") end
  for _, file in ipairs(changed) do write(file.path, file.text) end
  for _, file in ipairs(absent) do os.remove(file) end
  return 0
end

return M
