-- preamble.lua: reading macro definitions from LaTeX source
local preamble = require "tex8web.preamble"

local function read(source)
  local definitions = {}
  local packages = preamble.read(source, definitions)
  return definitions, packages
end

local function def(source, name)
  return (read(source))[name]
end

return {
  ["newcommand, with arguments and a default"] = function()
    equal(def("\\newcommand{\\R}{\\mathbb{R}}", "\\R").def, "\\newcommand{\\R}{\\mathbb{R}}")
    equal(def("\\newcommand\\norm[1]{\\|#1\\|}", "\\norm").def, "\\newcommand{\\norm}[1]{\\|#1\\|}")
    equal(def("\\renewcommand{\\x}[2][a]{#1+#2}", "\\x").def, "\\newcommand{\\x}[2][a]{#1+#2}")
    equal(def("\\providecommand*{\\y}{y}", "\\y").def, "\\newcommand{\\y}{y}")
  end,

  ["NewDocumentCommand with mandatory arguments and O{}"] = function()
    equal(def("\\NewDocumentCommand{\\prob}{m}{P(#1)}", "\\prob").def, "\\newcommand{\\prob}[1]{P(#1)}")
    equal(def("\\NewDocumentCommand\\dist{O{2} m m}{d_{#1}(#2,#3)}", "\\dist").def,
      "\\newcommand{\\dist}[3][2]{d_{#1}(#2,#3)}")
    equal(def("\\DeclareDocumentCommand{\\c}{}{c}", "\\c").def, "\\newcommand{\\c}{c}")
  end,

  ["NewDocumentCommand with other argument types is kept with the reason"] = function()
    local d = def("\\NewDocumentCommand{\\s}{s m}{#2}", "\\s")
    equal(d.def, nil)
    equal(d.problem, "has the argument spec {s m}")
  end,

  ["DeclareMathOperator: \\mathop, limits only for the starred form"] = function()
    equal(def("\\DeclareMathOperator{\\Var}{Var}", "\\Var").def,
      "\\newcommand{\\Var}{\\mathop{\\mathrm{Var}}\\nolimits}")
    equal(def("\\DeclareMathOperator*{\\argmax}{arg\\,max}", "\\argmax").def,
      "\\newcommand{\\argmax}{\\mathop{\\mathrm{arg\\,max}}}")
  end,

  ["DeclarePairedDelimiter and DeclarePairedDelimiterX"] = function()
    equal(def("\\DeclarePairedDelimiter{\\abs}{\\lvert}{\\rvert}", "\\abs").def,
      "\\DeclarePairedDelimiter{\\abs}{\\lvert}{\\rvert}")
    equal(def("\\DeclarePairedDelimiterX{\\inner}[2]{\\langle}{\\rangle}{#1,#2}", "\\inner").def,
      "\\DeclarePairedDelimiterX{\\inner}[2]{\\langle}{\\rangle}{#1,#2}")
  end,

  ["def and let"] = function()
    equal(def("\\def\\eps{\\varepsilon}", "\\eps").def, "\\def\\eps{\\varepsilon}")
    equal(def("\\def\\pair#1#2{(#1,#2)}", "\\pair").def, "\\def\\pair#1#2{(#1,#2)}")
    equal(def("\\let\\phi\\varphi", "\\phi").def, "\\let\\phi\\varphi")
    equal(def("\\let\\phi=\\varphi", "\\phi").def, "\\let\\phi\\varphi")
  end,

  ["comments are skipped, an escaped % is kept"] = function()
    local definitions = read("% \\newcommand{\\a}{a}\n\\newcommand{\\b}{50\\%} % \\newcommand{\\c}{c}")
    equal(definitions["\\a"], nil)
    equal(definitions["\\c"], nil)
    equal(definitions["\\b"].def, "\\newcommand{\\b}{50\\%}")
  end,

  ["the local packages a source loads"] = function()
    local _, packages = read("\\usepackage{amsmath,styles/macros}\\usepackage[x]{shapes}\\RequirePackage{more}")
    table.sort(packages)
    equal(packages, {"amsmath.sty", "more.sty", "shapes.sty", "styles/macros.sty"})
  end,

  ["the files a source inputs, with .tex added to a bare name"] = function()
    local _, files = read("\\input{a}\\input b\\include{dir/c}\\input{d.txt}\\InputIfFileExists{e}{}{}"
      .. "\\inputminted{x}{y} % \\input{commented}")
    table.sort(files)
    equal(files, {"a.tex", "b.tex", "d.txt", "dir/c.tex", "e.tex"})
  end,

  ["document: a later definition in the main file beats one in a package it loaded earlier"] = function()
    local dir = os.tmpname()
    os.remove(dir)
    lfs.mkdir(dir)
    local function write(name, text)
      local f = assert(io.open(dir .. "/" .. name, "w"))
      f:write(text)
      f:close()
    end
    write("mysty.sty", "\\newcommand{\\R}{\\mathbb{R}}\\newcommand{\\S}{s}")
    write("defs.tex", "\\newcommand{\\S}{\\mathbf{S}}")
    write("main.tex", "\\usepackage{" .. dir .. "/mysty}\\input{" .. dir .. "/defs}\n"
      .. "\\renewcommand{\\R}{\\mathbf{R}}")
    local definitions = preamble.document(dir .. "/main.tex")
    for _, name in ipairs({"mysty.sty", "defs.tex", "main.tex"}) do os.remove(dir .. "/" .. name) end
    lfs.rmdir(dir)
    equal(definitions["\\R"].def, "\\newcommand{\\R}{\\mathbf{R}}")
    equal(definitions["\\S"].def, "\\newcommand{\\S}{\\mathbf{S}}")
  end,

  ["document: \\providecommand keeps a package's definition, a later \\renewcommand in an input beats the preamble's"] = function()
    local dir = os.tmpname()
    os.remove(dir)
    lfs.mkdir(dir)
    local function write(name, text)
      local f = assert(io.open(dir .. "/" .. name, "w"))
      f:write(text)
      f:close()
    end
    write("mysty.sty", "\\newcommand{\\E}{\\mathbb{E}}")
    write("chapter.tex", "\\renewcommand{\\P}{\\mathrm{P}}")
    write("main.tex", "\\usepackage{" .. dir .. "/mysty}\\providecommand{\\E}{E}\\providecommand{\\Q}{Q}\n"
      .. "\\newcommand{\\P}{\\mathbb{P}}\n\\input{" .. dir .. "/chapter}")
    local definitions = preamble.document(dir .. "/main.tex")
    for _, name in ipairs({"mysty.sty", "chapter.tex", "main.tex"}) do os.remove(dir .. "/" .. name) end
    lfs.rmdir(dir)
    equal(definitions["\\E"].def, "\\newcommand{\\E}{\\mathbb{E}}")
    equal(definitions["\\Q"].def, "\\newcommand{\\Q}{Q}")
    equal(definitions["\\P"].def, "\\newcommand{\\P}{\\mathrm{P}}")
  end,

  ["read: a \\usepackage whose brace never closes ends"] = function()
    local definitions, packages = read("\\newcommand{\\a}{a}\\verb|\\usepackage{| text")
    equal(packages, {})
    equal(definitions["\\a"].def, "\\newcommand{\\a}{a}")
    read("\\usepackage{x")
    read("\\input{x")
    read("\\usepackage[x")
  end,

  ["document: a file input twice is read twice, a package once, and a cycle ends"] = function()
    local dir = os.tmpname()
    os.remove(dir)
    lfs.mkdir(dir)
    local function write(name, text)
      local f = assert(io.open(dir .. "/" .. name, "w"))
      f:write(text)
      f:close()
    end
    write("defs.tex", "\\newcommand{\\x}{1}\\input{" .. dir .. "/defs}")
    write("pkg.sty", "\\newcommand{\\y}{1}")
    write("main.tex", "\\input{" .. dir .. "/defs}\\renewcommand{\\x}{2}\\input{" .. dir .. "/defs}\n"
      .. "\\usepackage{" .. dir .. "/pkg}\\renewcommand{\\y}{2}\\usepackage{" .. dir .. "/pkg}")
    local definitions = preamble.document(dir .. "/main.tex")
    for _, name in ipairs({"defs.tex", "pkg.sty", "main.tex"}) do os.remove(dir .. "/" .. name) end
    lfs.rmdir(dir)
    equal(definitions["\\x"].def, "\\newcommand{\\x}{1}")
    equal(definitions["\\y"].def, "\\newcommand{\\y}{2}")
  end,

  ["document follows \\input and \\include, and skips a missing file"] = function()
    local dir = os.tmpname()
    os.remove(dir)
    lfs.mkdir(dir)
    local function write(name, text)
      local f = assert(io.open(dir .. "/" .. name, "w"))
      f:write(text)
      f:close()
    end
    write("braced.tex", "\\newcommand{\\a}{a}")
    write("bare.tex", "\\newcommand{\\b}{b}")
    write("chapter.tex", "\\newcommand{\\c}{c}")
    write("commented.tex", "\\newcommand{\\d}{d}")
    write("main.tex", "\\input{" .. dir .. "/braced}\\input " .. dir .. "/bare.tex\n"
      .. "\\include{" .. dir .. "/chapter}\\input{" .. dir .. "/missing}\n"
      .. "% \\input{" .. dir .. "/commented}\n")
    local definitions = preamble.document(dir .. "/main.tex")
    for _, name in ipairs({"braced", "bare", "chapter", "commented", "main"}) do
      os.remove(dir .. "/" .. name .. ".tex")
    end
    lfs.rmdir(dir)
    equal(definitions["\\a"].def, "\\newcommand{\\a}{a}")
    equal(definitions["\\b"].def, "\\newcommand{\\b}{b}")
    equal(definitions["\\c"].def, "\\newcommand{\\c}{c}")
    equal(definitions["\\d"], nil)
  end,

  ["the macros a source uses, control symbols too"] = function()
    local names = preamble.uses("\\frac{a}{b} + \\1 + \\alpha")
    table.sort(names)
    equal(names, {"\\1", "\\alpha", "\\frac"})
  end,

  ["what MathJax can't read"] = function()
    equal(preamble.problem("\\mathpalette\\x{y}"), "uses \\mathpalette")
    equal(preamble.problem("\\x@helper{x}"), "uses an internal (@) macro")
    equal(preamble.problem("\\frac{1}{2}"), nil)
  end,
}
