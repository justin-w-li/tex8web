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
