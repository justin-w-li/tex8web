-- bibliography.lua: the run of bibtex or biber
local bibliography = require "tex8web.bibliography"
local files = require "tex8web.files"

-- runs bibliography.run in a new document directory that holds x.bbl
-- with one entry, and whose build directory b holds the given files and,
-- unless they include one, the empty x.bbl of an earlier failed run.
-- Checks that neither bibtex nor biber ran, and returns the .bbl that
-- LaTeX reads next: the build directory's, or else the document's.
local function rerun(built)
  local doc = os.tmpname()
  os.remove(doc)
  lfs.mkdir(doc)
  lfs.mkdir(doc .. "/b")
  built["x.bbl"] = built["x.bbl"] or ""
  local f = assert(io.open(doc .. "/x.bbl", "w"))
  f:write("\\begin{thebibliography}{1}\n\\bibitem{one} An entry.\n\\end{thebibliography}\n")
  f:close()
  for name, text in pairs(built) do
    local f = assert(io.open(doc .. "/b/" .. name, "w"))
    f:write(text)
    f:close()
  end
  local back = lfs.currentdir()
  lfs.chdir(doc)
  local ok, err = pcall(bibliography.run, {builddir = "b", input = "x"})
  lfs.chdir(back)
  local read = files.read(doc .. "/b/x.bbl") or files.read(doc .. "/x.bbl")
  for _, dir in ipairs({doc .. "/b", doc}) do
    for file in lfs.dir(dir) do
      if file ~= "." and file ~= ".." then os.remove(dir .. "/" .. file) end
    end
    lfs.rmdir(dir)
  end
  check(ok, err)
  for _, line in ipairs(logged) do check(not line:find("bibtex ") and not line:find("biber "), line) end
  return read
end

return {
  ["bibliography.run: a warning when bibtex fails"] = function()
    local dir = os.tmpname()
    os.remove(dir)
    lfs.mkdir(dir)
    local f = assert(io.open(dir .. "/x.aux", "w"))
    f:write("\\bibstyle{plain}\n\\bibdata{tex8web-missing}\n")
    f:close()
    local before = #logged
    bibliography.run({builddir = dir, input = "x"})
    for file in lfs.dir(dir) do
      if file ~= "." and file ~= ".." then os.remove(dir .. "/" .. file) end
    end
    lfs.rmdir(dir)
    local last = logged[#logged]
    check(#logged > before and last:find("^warning: the bibliography failed"), last)
  end,
  -- (a .bbl beside the document, and a missing .bib: the document's
  -- .bbl, as latexmk keeps it, over a build directory that holds the empty
  -- .bbl of an earlier run)
  ["bibliography.run: the .bbl beside the document when the .bib is missing"] = function()
    local read = rerun({["x.aux"] = "\\bibstyle{plain}\n\\bibdata{tex8web-missing}\n"})
    check(read:find("\\bibitem{one}", 1, true), read)
  end,
  -- (the build directory's copy of the .bbl beside, from an earlier run,
  -- before the .bbl beside changed)
  ["bibliography.run: the changed .bbl beside the document when the .bib is missing"] = function()
    local read = rerun({["x.aux"] = "\\bibstyle{plain}\n\\bibdata{tex8web-missing}\n",
      ["x.bbl"] = "\\begin{thebibliography}{1}\n\\bibitem{old} An old entry.\n\\end{thebibliography}\n"})
    check(read:find("\\bibitem{one}", 1, true), read)
  end,
  ["bibliography.run: the .bbl beside the document when biber's .bib is missing"] = function()
    local read = rerun({["x.aux"] = "", ["x.bcf"] = '<?xml version="1.0" encoding="UTF-8"?>\n'
      .. '<bcf:controlfile version="3.11" bltxversion="3.20" xmlns:bcf="https://sourceforge.net/projects/biblatex">\n'
      .. '  <bcf:bibdata section="0">\n'
      .. '    <bcf:datasource type="file" datatype="bibtex" glob="false">tex8web-missing.bib</bcf:datasource>\n'
      .. '  </bcf:bibdata>\n</bcf:controlfile>\n'})
    check(read:find("\\bibitem{one}", 1, true), read)
  end,
}
