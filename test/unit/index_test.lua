-- The indexes: which ones, and their links
local index = require "tex8web.index"

return {
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
