-- bibliography.lua: the run of bibtex or biber
local bibliography = require "tex8web.bibliography"
local files = require "tex8web.files"

local function write(path, text)
  local f = assert(io.open(path, "w"))
  f:write(text)
  f:close()
end

local function remove(path)
  if lfs.attributes(path, "mode") == "directory" then
    for file in lfs.dir(path) do
      if file ~= "." and file ~= ".." then remove(path .. "/" .. file) end
    end
    lfs.rmdir(path)
  else
    os.remove(path)
  end
end

-- runs bibliography.run on document x in a new directory doc, which holds
-- x.bbl with one entry and the files in beside (by paths from doc, which
-- may lead into a subdirectory or to doc's parent). The build directory
-- doc/b holds the files in built and, unless they include one, the empty
-- x.bbl of an earlier failed run. If builddir is given, it returns, from
-- doc's path, the name that bibliography.run gets for doc itself as its
-- build directory, which then holds the files in built. bibtex and biber
-- are not started. Returns the .bbl that LaTeX reads next (the build
-- directory's, or else the document's), and the command that started
-- bibtex or biber, if any.
local function run_beside(built, beside, builddir)
  local root = os.tmpname()
  os.remove(root)
  lfs.mkdir(root)
  local doc = root .. "/doc"
  lfs.mkdir(doc)
  local out = doc
  if not builddir then
    out = doc .. "/b"
    lfs.mkdir(out)
    built["x.bbl"] = built["x.bbl"] or ""
  end
  write(doc .. "/x.bbl", "\\begin{thebibliography}{1}\n\\bibitem{one} An entry.\n\\end{thebibliography}\n")
  for name, text in pairs(built) do write(out .. "/" .. name, text) end
  for name, text in pairs(beside or {}) do
    local sub = name:match("^(.*)/")
    if sub then lfs.mkdir(doc .. "/" .. sub) end
    write(doc .. "/" .. name, text)
  end
  local back, execute, command = lfs.currentdir(), os.execute, nil
  os.execute = function(c) command = c return 0 end
  lfs.chdir(doc)
  local ok, err = pcall(bibliography.run, {builddir = builddir and builddir(doc) or "b", input = "x"})
  lfs.chdir(back)
  os.execute = execute
  local read = files.read(out .. "/x.bbl") or files.read(doc .. "/x.bbl")
  remove(root)
  check(ok, err)
  return read, command
end

-- run_beside, with a check that bibtex and biber were skipped
local function skipped(built, beside, builddir)
  local read, command = run_beside(built, beside, builddir)
  check(not command, command)
  return read
end

-- a .bcf that names the given datasources, each a pair of attributes and name
local function bcf(...)
  local text = '<?xml version="1.0" encoding="UTF-8"?>\n'
    .. '<bcf:controlfile version="3.11" bltxversion="3.20" xmlns:bcf="https://sourceforge.net/projects/biblatex">\n'
    .. '  <bcf:bibdata section="0">\n'
  for _, source in ipairs({...}) do
    text = text .. '    <bcf:datasource type="file" ' .. source[1] .. '>' .. source[2] .. '</bcf:datasource>\n'
  end
  return text .. '  </bcf:bibdata>\n</bcf:controlfile>\n'
end

local entry = "@book{a, title = {A}}\n"

return {
  ["bibliography.run: a warning when bibtex fails"] = function()
    local dir = os.tmpname()
    os.remove(dir)
    lfs.mkdir(dir)
    write(dir .. "/x.aux", "\\bibstyle{plain}\n\\bibdata{tex8web-missing}\n")
    local before = #logged
    bibliography.run({builddir = dir, input = "x"})
    remove(dir)
    local last = logged[#logged]
    check(#logged > before and last:find("^warning: the bibliography failed"), last)
  end,
  -- (a .bbl beside the document, and a missing .bib: the document's
  -- .bbl, as latexmk keeps it, over a build directory that holds the empty
  -- .bbl of an earlier run)
  ["bibliography.run: the .bbl beside the document when the .bib is missing"] = function()
    local read = skipped({["x.aux"] = "\\bibstyle{plain}\n\\bibdata{tex8web-missing}\n"})
    check(read:find("\\bibitem{one}", 1, true), read)
  end,
  -- (the build directory's copy of the .bbl beside, from an earlier run,
  -- before the .bbl beside changed)
  ["bibliography.run: the changed .bbl beside the document when the .bib is missing"] = function()
    local read = skipped({["x.aux"] = "\\bibstyle{plain}\n\\bibdata{tex8web-missing}\n",
      ["x.bbl"] = "\\begin{thebibliography}{1}\n\\bibitem{old} An old entry.\n\\end{thebibliography}\n"})
    check(read:find("\\bibitem{one}", 1, true), read)
  end,
  -- (three forms of name in \bibdata: with its .bib extension, by a ../
  -- path, and by a path into a subdirectory. Each is the only missing
  -- name once, beside the other two there.)
  ["bibliography.run: the .bbl beside the document when only a .bib with its extension is missing"] = function()
    local read = skipped({["x.aux"] = "\\bibstyle{plain}\n\\bibdata{gone.bib,../p,sub/s}\n"},
      {["../p.bib"] = entry, ["sub/s.bib"] = entry})
    check(read:find("\\bibitem{one}", 1, true), read)
  end,
  ["bibliography.run: the .bbl beside the document when only a .bib by a ../ path is missing"] = function()
    local read = skipped({["x.aux"] = "\\bibstyle{plain}\n\\bibdata{a.bib,../gone,sub/s}\n"},
      {["a.bib"] = entry, ["sub/s.bib"] = entry})
    check(read:find("\\bibitem{one}", 1, true), read)
  end,
  ["bibliography.run: the .bbl beside the document when only a .bib in a subdirectory is missing"] = function()
    local read = skipped({["x.aux"] = "\\bibstyle{plain}\n\\bibdata{a.bib,../p,sub/gone}\n"},
      {["a.bib"] = entry, ["../p.bib"] = entry})
    check(read:find("\\bibitem{one}", 1, true), read)
  end,
  -- (the same three names, all there: bibtex runs over the .bbl beside)
  ["bibliography.run: bibtex when every .bib is there"] = function()
    local _, command = run_beside({["x.aux"] = "\\bibstyle{plain}\n\\bibdata{a.bib,../p,sub/s}\n"},
      {["a.bib"] = entry, ["../p.bib"] = entry, ["sub/s.bib"] = entry})
    check(command and command:find(" bibtex ", 1, true), command)
  end,
  ["bibliography.run: the .bbl beside the document when biber's .bib is missing"] = function()
    local read = skipped({["x.aux"] = "", ["x.bcf"] = bcf({'datatype="bibtex" glob="false"', "tex8web-missing.bib"})})
    check(read:find("\\bibitem{one}", 1, true), read)
  end,
  -- (biber's datasources that kpsewhich does not find although they are
  -- there: a file of another type, and a glob pattern. latexmk too skips
  -- biber only for a missing name that ends in .bib.)
  ["bibliography.run: biber with a datasource of another type"] = function()
    local _, command = run_beside({["x.aux"] = "", ["x.bcf"] = bcf({'datatype="biblatexml" glob="false"', "refs.bltxml"})},
      {["refs.bltxml"] = "<entries/>\n"})
    check(command and command:find("^biber "), command)
  end,
  ["bibliography.run: biber with a glob pattern"] = function()
    local _, command = run_beside({["x.aux"] = "", ["x.bcf"] = bcf({'datatype="bibtex" glob="true"', "bibs/*.bib"})},
      {["bibs/a.bib"] = entry})
    check(command and command:find("^biber "), command)
  end,
  -- (a .bib that filecontents wrote into the build directory, where
  -- kpsewhich from the document's directory does not find it)
  ["bibliography.run: biber with a .bib in the build directory"] = function()
    local _, command = run_beside({["x.aux"] = "", ["x.bcf"] = bcf({'datatype="bibtex" glob="false"', "x.bib"}),
      ["x.bib"] = entry})
    check(command and command:find("^biber "), command)
  end,
  -- (biblatex's location=remote: a URL in a datasource of type file)
  ["bibliography.run: biber with a remote .bib"] = function()
    local _, command = run_beside({["x.aux"] = "",
      ["x.bcf"] = bcf({'datatype="bibtex" glob="false"', "https://example.org/refs.bib"})})
    check(command and command:find("^biber "), command)
  end,
  -- (a build directory that names the document's own directory, by ./ and
  -- by its absolute path: the .bbl beside stays when a .bib is missing)
  ["bibliography.run: the .bbl beside the document when the build directory is its directory"] = function()
    for _, builddir in ipairs({function() return "./" end, function(doc) return doc end}) do
      local read = skipped({["x.aux"] = "\\bibstyle{plain}\n\\bibdata{tex8web-missing}\n"}, nil, builddir)
      check(read:find("\\bibitem{one}", 1, true), read)
    end
  end,
}
