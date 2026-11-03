-- The stylesheet's rewriting
local assets = require "tex8web.assets"

return {
  ["assets.rules_in_text_color: black borders only"] = function()
    equal(assets.rules_in_text_color(
      ".hline {border-top: 1px solid black;}\n#TBL-2-1{border-right:1px solid black;}\n"
      .. ".fbox {border:solid black 0.4pt; color: black}\n.x {border-color: blackish}\n"
      .. ".border:hover{color:black}"),
      ".hline {border-top: 1px solid currentColor;}\n#TBL-2-1{border-right:1px solid currentColor;}\n"
      .. ".fbox {border:solid currentColor 0.4pt; color: black}\n.x {border-color: blackish}\n"
      .. ".border:hover{color:black}")
  end,

  ["assets.wide_screens: the text's width and 17em each side"] = function()
    equal(assets.wide_screens(":root { --tex8web-textwidth: 42.9em; }\n@media not (--tex8web-wide) { x }"),
      ":root { --tex8web-textwidth: 42.9em; }\n@media not (min-width: 76.90em) { x }")
  end,
}
