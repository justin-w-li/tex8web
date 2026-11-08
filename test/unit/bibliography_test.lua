-- bibliography.lua: the run of bibtex or biber
local bibliography = require "tex8web.bibliography"

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
}
