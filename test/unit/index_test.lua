-- index.lua: which indexes, and their links
local bibliography = require "tex8web.bibliography"
local index = require "tex8web.index"

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

-- index.run, bibliography.settle with index.again, and
-- index.glossaries_again, in tex8web.mk4's order, with a stand-in for LaTeX
-- that counts its runs and writes the .idx that idx(run) gives; the number
-- of LaTeX runs, the warnings logged, and the status
local function settle(name, idx)
  local dir = os.tmpname()
  os.remove(dir)
  lfs.mkdir(dir)
  write(dir .. "/" .. name .. ".aux", "\\relax\n")
  write(dir .. "/" .. name .. ".idx", idx(0))
  local runs = 0
  package.loaded["make4ht-htlatex"] = {htlatex = function()
    runs = runs + 1
    write(dir .. "/" .. name .. ".idx", idx(runs))
    return 0
  end}
  local par = {builddir = dir, input = name}
  index.run(par)
  local status = bibliography.settle(par, index.again)
  if status == 0 then status = index.glossaries_again(par) end
  package.loaded["make4ht-htlatex"] = nil
  remove(dir)
  local warnings = {}
  for _, line in ipairs(logged) do
    if line:find("^warning: ") then warnings[#warnings + 1] = line end
  end
  return runs, warnings, status
end

return {
  -- (an entry whose text changes on every LaTeX run: the index never
  -- settles, and its links may name ids that the page does not have)
  ["index.glossaries_again: a warning that names an index that does not settle"] = function()
    local runs, warnings, status = settle("unsettled", function(run)
      return "\\beforeentry{}{x-" .. run .. "}{}\n\\indexentry{run " .. run .. "}{1}\n"
    end)
    equal(status, 0)
    equal(runs, 1 + 2 * bibliography.runs)
    equal(#warnings, 1)
    check(warnings[1]:find("^warning: the index unsettled did not settle"), warnings[1])
  end,

  -- (the page's file name in \beforeentry, which tex4ht writes only from
  -- the second LaTeX run, is no change)
  ["index.glossaries_again: no extra LaTeX run and no warning for an index that settled"] = function()
    local runs, warnings = settle("settled", function(run)
      return "\\beforeentry{" .. (run > 0 and "settled.html" or "") .. "}{x-1}{}\n\\indexentry{apple}{1}\n"
    end)
    equal(runs, 1)
    equal(warnings, {})
  end,

  ["index.indexes: imakeidx's, by the commands noted in the .aux, with makeindex's options"] = function()
    equal(index.indexes("\\relax\n% tex8web index: makeindex doc.idx\n"
      .. "% tex8web index: makeindex -s names.ist -l names.idx\n"
      .. "% tex8web index: texindy -L english terms.idx\n", "doc", true),
      {{name = "doc", options = ""}, {name = "names", options = "-s names.ist -l"}, {name = "terms", options = ""}})
  end,

  ["index.indexes: makeidx's, the document's .idx, if it has one"] = function()
    equal(index.indexes("\\relax\n", "doc", true), {{name = "doc", options = ""}})
    equal(index.indexes("\\relax\n", "doc", nil), {})
  end,

  ["index.link: the numbers makeindex was given, not numbers in an entry's text"] = function()
    local idx, map = index.prepare("\\beforeentry{}{a}{}\n\\indexentry{$L^2$ space}{1}\n"
      .. "\\beforeentry{}{b}{}\n\\indexentry{Theorem, 2nd form|textbf}{1}")
    equal(idx, "\\indexentry{$L^2$ space}{1000001}\n\\indexentry{Theorem, 2nd form|textbf}{1000002}")
    equal(index.link("  \\item $L^2$ space, 1000001\n  \\item Theorem, 2nd form : \\textbf{1000002}", map),
      "  \\item $L^2$ space, \\Link[]{a}{}1\\EndLink{}\n"
      .. "  \\item Theorem, 2nd form : \\textbf{\\Link[]{b}{}2\\EndLink{}}")
  end,
}
