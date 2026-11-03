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
    local _, packages = read("\\usepackage{amsmath,styles/notes}\\usepackage[x]{extras}\\RequirePackage{more}")
    table.sort(packages)
    equal(packages, {"amsmath.sty", "extras.sty", "more.sty", "styles/notes.sty"})
  end,

  ["the macros a source uses, control symbols too"] = function()
    local names = preamble.uses("\\frac{a}{b} + \\1 + \\alpha")
    table.sort(names)
    equal(names, {"\\1", "\\alpha", "\\frac"})
  end,

  ["what MathJax can't read"] = function()
    equal(preamble.problem("\\mathpalette\\x{y}"), "uses \\mathpalette")
    equal(preamble.problem("\\my@helper{x}"), "uses an internal (@) macro")
    equal(preamble.problem("\\frac{1}{2}"), nil)
  end,
}
