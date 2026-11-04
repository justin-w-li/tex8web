-- The stylesheet's rewriting
local dom = require "luaxml-domobject"
local assets = require "tex8web.assets"

-- the font files M.faces finds, in order
local function faces(body, css)
  local found = {}
  for font in pairs(assets.faces(dom.html_parse("<html><head></head><body>" .. body .. "</body></html>"), css)) do
    found[#found + 1] = font
  end
  table.sort(found)
  return table.concat(found, " ")
end

return {
  ["assets.faces: tex4ht's rules for its font classes, and css/tex8web.css's families"] = function()
    local css = ".ec-lmro-10{ font-style: oblique;}\n.ec-lmbxo-10{ font-weight: bold;}\n"
      .. ".ec-lmbxo-10{ font-style: oblique;}\n.ec-lmtt-10{ font-family: monospace,monospace;}\n"
      .. ".ecit-1000{ font-family: monospace,monospace; font-style: italic;}\n.ecsl-1000{}\n"
      .. ".t5-lmri-10{ font-style:italic;}\n.ec-lmss-10{}\n"
    equal(faces('<p><span class="ec-lmbxo-10">a</span> <span class="ecit-1000">b</span> '
      .. '<span class="ecsl-1000">c</span> <span class="ec-lmtt-10">d</span></p>', css),
      "lmmono10-regular.woff2 lmroman10-bolditalic.woff2 lmroman10-regular.woff2")
    equal(faces('<p><span class="ec-lmro-10">a</span></p>', css), "lmroman10-italic.woff2 lmroman10-regular.woff2")
    equal(faces('<p><span class="t5-lmri-10">a</span></p>', css), "lmroman10-italic.woff2 lmroman10-regular.woff2")
    equal(faces('<p><span class="ec-lmss-10"><span class="ec-lmro-10">a</span></span></p>', css),
      "lmroman10-regular.woff2 lmsans10-oblique.woff2")
  end,

  ["assets.faces: headings in the fonts the stylesheet gives them, verbatim in the browser's"] = function()
    equal(faces('<h3 class="sectionHead">A</h3><pre class="verbatim">b</pre><code class="verb">c</code>', ""),
      "lmroman10-bold.woff2 lmroman10-regular.woff2")
    equal(faces('<h3 class="sectionHead">A</h3><h1 class="titleHead">T</h1>',
      ":root { --tex8web-section-family: var(--tex8web-sans);\n --tex8web-section-weight: normal; "
      .. "--tex8web-section-style: normal; }"), "lmroman10-regular.woff2 lmsans10-regular.woff2")
  end,

  ["assets.faces: not the math, which MathJax sets"] = function()
    equal(faces('<h3 class="sectionHead"><span class="mathjax-inline">\\(x\\)</span></h3>', ""),
      "lmroman10-regular.woff2")
  end,
  ["assets.rules_in_text_color: black borders only"] = function()
    equal(assets.rules_in_text_color(
      ".hline {border-top: 1px solid black;}\n#TBL-2-1{border-right:1px solid black;}\n"
      .. ".fbox {border:solid black 0.4pt; color: black}\n.x {border-color: blackish}\n"
      .. ".border:hover{color:black}"),
      ".hline {border-top: 1px solid currentColor;}\n#TBL-2-1{border-right:1px solid currentColor;}\n"
      .. ".fbox {border:solid currentColor 0.4pt; color: black}\n.x {border-color: blackish}\n"
      .. ".border:hover{color:black}")
  end,

  ["assets.wide_screens: the text's width, and a column and two gaps each side"] = function()
    local css = ":root { --tex8web-margin: 14rem; --tex8web-gap: 1.5rem; }\n"
      .. ":root { --tex8web-textwidth: 40em; }\n:root { --tex8web-textwidth: 42.9em; }\n"
      .. "@media not (--tex8web-wide) { x { width: var(--tex8web-textwidth); } }"
    equal(assets.wide_screens(css), (css:gsub("%(%-%-tex8web%-wide%)", "(min-width: 76.90em)")))
  end,

  ["assets.wide_screens: comments skipped, and !important read"] = function()
    local css = "/* --tex8web-textwidth: see below; */ :root { --tex8web-margin: 14rem; --tex8web-gap: 1.5rem; }\n"
      .. ":root { --tex8web-textwidth: 45em !important; }\n@media (--tex8web-wide) { x }"
    equal(assets.wide_screens(css), (css:gsub("%(%-%-tex8web%-wide%)", "(min-width: 79.00em)")))
  end,

  ["assets.wide_screens: a width not in ems, a warning and no wide screens"] = function()
    local css = ":root { --tex8web-margin: 14rem; --tex8web-gap: 1.5rem; --tex8web-textwidth: 700px }\n"
      .. "@media (--tex8web-wide) { x }"
    equal(assets.wide_screens(css), (css:gsub("%(%-%-tex8web%-wide%)", "(min-width: 10000.00em)")))
    check(logged[1]:find("--tex8web-textwidth is 700px, not", 1, true), logged[1])
  end,
}
