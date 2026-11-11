-- The files a page needs next to it: fonts, the document's pictures and
-- PDF, and tex8web.js; and the stylesheet, with css/tex8web.css, the font
-- rules, and tex4ht's colors adjusted for dark mode. Each file is listed
-- with tex4ht's output files, so make4ht -d copies it too.
local dom = require "tex8web.dom"
local files = require "tex8web.files"
local prerender = require "tex8web.prerender"

local log = logging.new("tex8web")

local M = {}

local fonts = {
  "lmroman10-regular.woff2",
  "lmroman10-bold.woff2",
  "lmroman10-italic.woff2",
  "lmroman10-bolditalic.woff2",
  "lmmono10-regular.woff2",
}

-- Latin Modern Sans, copied only for a page with sans-serif text
local sans_fonts = {
  "lmsans10-regular.woff2",
  "lmsans10-bold.woff2",
  "lmsans10-oblique.woff2",
  "lmsans10-boldoblique.woff2",
}

local shapes = {"regular", "bold", "italic", "bolditalic"}

local function gyre(name, families, classes)
  local files = {}
  for _, shape in ipairs(shapes) do files[shape] = "texgyre" .. name .. "-" .. shape end
  return {name = "TeX Gyre " .. name:gsub("^%l", string.upper), families = families,
    classes = classes or families, files = files}
end

-- the TeX Live fonts a page shows for the fonts a document may set its
-- text in: TeX Gyre's equivalents of Times (times, mathptmx, txfonts,
-- newtx), Palatino (palatino, mathpazo, pxfonts, newpx), Helvetica
-- (helvet), Courier, and the other standard PostScript fonts (also
-- fouriernc's fnc), with TeX Gyre's packages; and XCharter for Charter
-- (charter, XCharter). Each has its name, the font families it is shown
-- for, how tex4ht's classes for it start or continue (ptmri7t-, ec-qtmr-10,
-- ntx-Italic-tlf-t1-), from the fonts' file names, and its files.
local known = {
  gyre("termes", {"ptm", "qtm", "txr", "ntxtlf", "ntxlf", "ntxosf", "ntxtosf"},
    {"ptm", "qtm", "txr", "txb", "txi", "ntx-"}),
  gyre("pagella", {"ppl", "pplx", "pplj", "qpl", "pxr", "zpltlf", "zpllf", "zplosf", "zpltosf"},
    {"ppl", "qpl", "pxr", "pxb", "pxi", "zpl-"}),
  gyre("heros", {"phv", "qhv"}),
  gyre("cursor", {"pcr", "qcr"}),
  gyre("bonum", {"pbk", "qbk"}),
  gyre("schola", {"pnc", "qcs", "fnc"}, {"pnc", "qcs"}),
  gyre("adventor", {"pag", "qag"}),
  {name = "XCharter", families = {"bch", "XCharter-TLF", "XCharter-LF", "XCharter-OsF", "XCharter-TOsF"},
    classes = {"bch", "XCharter"}, files = {regular = "XCharter-Roman", bold = "XCharter-Bold",
    italic = "XCharter-Italic", bolditalic = "XCharter-BoldItalic"}},
}
local by_family = {}
for _, font in ipairs(known) do
  for _, family in ipairs(font.families) do by_family[family] = font end
end
-- (the classes of Latin Modern's and Computer Modern's roman, for \textrm
-- and \textbf in a document whose text is in another role)
local roman_classes = {"-lmr", "-lmb", "-lmcsc", "cmr", "cmbx", "cmti", "cmsl", "cmcsc", "ecrm", "ecbx",
  "ecti", "ecsl", "eccc"}

local function installed(font)
  local file = font.files.regular .. ".otf"
  if kpse.find_file(file, "opentype fonts") then return true end
  log:warning(file .. " not found in TeX Live: the page shows Latin Modern for " .. font.name)
end

-- whether class starts with one of starts or has it after a hyphen, as in
-- selector
local function matches(class, starts)
  for _, start in ipairs(starts) do
    start = start:gsub("^%-", ""):gsub("%-", "%%-")
    if class:find("^" .. start) or class:find("%-" .. start) then return true end
  end
end

-- the page's fonts (from known) for roman, sans-serif, and typewriter text,
-- where the document's family (from tex8web-page.tex's build element) has
-- one; the role the text itself is in (\familydefault); and the other known
-- fonts whose classes the page has, from a family chosen in the text
-- (\fontfamily)
local function roles_of(context, document)
  local families = context.families or {}
  local roles = {body = "roman", others = {}}
  local chosen = {}
  for _, role in ipairs({"mono", "sans", "roman"}) do
    if families[role] and families[role] == families.body then roles.body = role end
    local font = by_family[families[role] or ""]
    if font and installed(font) then roles[role] = font end
    if font then chosen[font] = true end
  end
  local classes = {}
  document:traverse_elements(function(el)
    for class in (el:get_attribute("class") or ""):gmatch("%S+") do
      if dom.is_font_class(class) then classes[#classes + 1] = class end
    end
  end)
  for _, font in ipairs(known) do
    if not chosen[font] then
      for _, class in ipairs(classes) do
        if matches(class, font.classes) then
          if installed(font) then roles.others[#roles.others + 1] = font end
          break
        end
      end
    end
  end
  return roles
end

-- the fonts in roles: roman, sans, and mono, then the others
local function fonts_of(roles)
  local list = {}
  for _, role in ipairs({"roman", "sans", "mono"}) do list[#list + 1] = roles[role] end
  for _, font in ipairs(roles.others) do list[#list + 1] = font end
  return list
end

-- a CSS selector of the classes that start with one of starts or have it
-- after a hyphen
local function selector(starts)
  local each = {}
  for _, start in ipairs(starts) do
    each[#each + 1] = ('[class^="%s"], [class*="-%s"]'):format(start:gsub("^%-", ""), start:gsub("^%-", ""))
  end
  return table.concat(each, ", ")
end

-- the stylesheet rules for those fonts: each font's faces (as WOFF2 cut
-- down by prerender.mjs, or else whole, M.originals), the roles' custom
-- properties (css/tex8web.css), the text's role, and tex4ht's classes for
-- each font, in its role (its htf files call Times monospace) or in its
-- own family. With the text in sans-serif, Latin Modern's roman classes are
-- set in roman.
local function font_css(roles)
  local css = {}
  local stacks = {roman = '"Latin Modern Roman", serif', sans = '"Latin Modern Sans", sans-serif',
    mono = '"Latin Modern Mono", monospace'}
  local function faces(font)
    for _, shape in ipairs(shapes) do
      local file = font.files[shape]
      css[#css + 1] = ('@font-face { font-family: "%s";%s%s src: url("fonts/%s.woff2") format("woff2"),'
        .. ' url("fonts/%s.otf") format("opentype"); }'):format(font.name, shape:find("bold") and
          " font-weight: bold;" or "", shape:find("italic") and " font-style: italic;" or "", file, file)
    end
  end
  for _, role in ipairs({"roman", "sans", "mono"}) do
    local font = roles[role]
    if font then
      faces(font)
      css[#css + 1] = (':root { --tex8web-%s: "%s", %s; }'):format(role, font.name, stacks[role])
      css[#css + 1] = ("%s { font-family: var(--tex8web-%s); }"):format(selector(font.classes), role)
    end
  end
  for _, font in ipairs(roles.others) do
    faces(font)
    css[#css + 1] = ('%s { font-family: "%s"; }'):format(selector(font.classes), font.name)
  end
  if roles.body ~= "roman" then
    css[#css + 1] = ("html body { font-family: var(--tex8web-%s); }"):format(roles.body)
    css[#css + 1] = ("%s { font-family: var(--tex8web-roman); }"):format(selector(roman_classes))
  end
  return table.concat(css, "\n")
end

local function exists(path)
  return lfs.attributes(path) ~= nil
end

-- copies source to path and lists path among the page's files
function M.add(source, path)
  copy(source, path)
  Make:add_file(path)
end

-- the last value the stylesheet gives --tex8web-<name>, or nil
local function custom(css, name)
  local value
  local declarations = css:gsub("/%*.-%*/", "")
  local pattern = "%-%-tex8web%-" .. name:gsub("%-", "%%-") .. "%s*:%s*([^;}]-)%s*[;}]"
  for v in declarations:gmatch(pattern) do value = v end
  return value
end

-- the set of font files the page's text uses, with the text's regular
-- face, which the page's controls use. Faces of Latin Modern are found
-- from the rules that set the font: tex4ht's for its font classes
-- (.ec-lmbx-10 bold, .ec-lmro-10 oblique, which is the italic),
-- css/tex8web.css's for their families, headings, and table of contents
-- entries (in the fonts tex8web-page.tex gives them in css), and the
-- browser's for other elements. A role or class of another font (roles_of)
-- gives that font's face.
function M.faces(document, css, roles)
  roles = roles or {body = "roman", others = {}}
  -- (each rule a face: what it sets of bold, italic, and family, where the
  -- family is mono or sans in Latin Modern, or system for the browser's
  -- monospace)
  local rules = {
    h1 = {bold = true}, h2 = {bold = true}, h3 = {bold = true}, h4 = {bold = true},
    h5 = {bold = true}, h6 = {bold = true}, b = {bold = true}, strong = {bold = true},
    em = {italic = true}, i = {italic = true}, cite = {italic = true},
    pre = {family = "system"}, code = {family = "system"}, tt = {family = "system"},
    kbd = {family = "system"}, samp = {family = "system"},
  }
  local classes = {titleHead = {bold = false}, id = {bold = true}, ["tex8web-toc-title"] = {bold = true}}
  -- (the face the stylesheet sets from --tex8web-<prefix>-weight, -style,
  -- and -family)
  local function font_of(prefix, default_weight)
    local family = custom(css, prefix .. "-family") or ""
    return {bold = (custom(css, prefix .. "-weight") or default_weight) == "bold",
      italic = (custom(css, prefix .. "-style") or "normal") == "italic",
      family = family:find("sans") and "sans" or family:find("mono") and "mono" or nil}
  end
  for _, level in ipairs({"part", "chapter", "section", "subsection", "subsubsection", "paragraph",
      "subparagraph"}) do
    local font = font_of(level, "bold")
    classes[level .. "Head"], classes["like" .. level .. "Head"] = font, font
  end
  classes.appendixHead = classes.chapterHead
  -- (a part's or chapter's label in its own font, with memoir, inside the
  -- heading's titlemark)
  local labels = {}
  for _, level in ipairs({"part", "chapter"}) do
    if custom(css, level .. "-label-weight") then labels[level .. "Head"] = font_of(level .. "-label", "bold") end
  end
  labels.appendixHead = labels.chapterHead
  -- (entries are bold without tocloft only for parts and chapters, as in
  -- css/tex8web.css)
  for _, level in ipairs({"part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"}) do
    local font = font_of("toc-" .. level, (level == "part" or level == "chapter") and "bold" or "normal")
    classes[level .. "Toc"], classes["like" .. level .. "Toc"] = font, font
  end
  classes.appendixToc = classes.chapterToc
  -- (a class at its own size, ec-lmr-10 or ptmr7t-x-x-120, or at the
  -- text's, ptmri7t- or ntx-Italic-tlf-t1-)
  local function read(class, rule)
    local face = classes[class] or {}
    for property, value in rule:gmatch("([%w-]+)%s*:%s*([^;}]+)") do
      if property == "font-weight" then face.bold = value:find("bold") ~= nil end
      if property == "font-style" then face.italic = (value:find("italic") or value:find("oblique")) ~= nil end
      if property == "font-family" and value:find("monospace") then face.family = "system" end
    end
    classes[class] = face
  end
  for class, rule in css:gmatch("%.([%w-]+%-%d[%w-]*)%s*(%b{})") do read(class, rule) end
  for class, rule in css:gmatch("%.([%w-]+%-)%s*(%b{})") do read(class, rule) end
  -- (css/tex8web.css's family rules, which come after tex4ht's)
  for class, face in pairs(classes) do
    if class:find("%-lmtt") or class:find("^cmtt%-") or class:find("^ectt%-") then face.family = "mono"
    elseif class:find("%-lmss") or class:find("^cmss") or class:find("^ecss") then face.family = "sans"
    elseif class:find("^ptmr7t%-") then face.family = nil end
  end
  -- (the role of a class: a role's font, or another font set in roman, as
  -- in font_css)
  local function role_of(class)
    for _, role in ipairs({"roman", "sans", "mono"}) do
      if roles[role] and matches(class, roles[role].classes) then return role end
    end
    for _, font in ipairs(roles.others) do
      if matches(class, font.classes) then return "roman", font end
    end
    if roles.body ~= "roman" and matches(class, roman_classes) then return "roman" end
  end
  local function file(face)
    if face.family == "system" then return end
    local shape = face.bold and (face.italic and "bolditalic" or "bold") or face.italic and "italic" or "regular"
    local font = not face.family and face.font or roles[face.family or "roman"]
    if font then return font.files[shape] .. ".woff2" end
    if face.family == "mono" then return "lmmono10-regular.woff2" end
    if face.family == "sans" then return "lmsans10-" .. shape:gsub("italic", "oblique") .. ".woff2" end
    return "lmroman10-" .. shape .. ".woff2"
  end
  local body = {family = roles.body ~= "roman" and roles.body or nil}
  local used = {[file(body)] = true}
  -- (the text of each element except scripts, styles, and the math, which
  -- MathJax sets in its fonts)
  local function walk(el, inherited)
    local face = {}
    for key, value in pairs(inherited) do face[key] = value end
    local function apply(rule)
      for key, value in pairs(rule or {}) do face[key] = value end
    end
    apply(rules[el:get_element_name()])
    for class in (el:get_attribute("class") or ""):gmatch("%S+") do
      if class:find("^mathjax%-") then return end
      apply(classes[class])
      if class == "titlemark" and face.label then
        face.family, face.font = nil, nil
        apply(face.label)
      end
      face.label = labels[class] or face.label
      local role, font = role_of(class)
      if role then face.family, face.font = role ~= "roman" and role or nil, font end
    end
    for _, child in ipairs(el:get_children()) do
      if child:is_element() and not ({script = true, style = true})[child:get_element_name()] then
        walk(child, face)
      elseif child:is_text() and child:get_text():find("%S") and file(face) then
        used[file(face)] = true
      end
    end
  end
  walk(document:query_selector("body")[1], body)
  return used
end

-- copies the fonts, and the pictures the page references relative to the
-- document (\includegraphics), unless tex4ht made them. The faces the text
-- uses (M.faces) are listed for tex8web-fonts.js to preload (see "Preloaded
-- fonts" in CONTRIBUTING.md).
function M.copy(document, context)
  local function add_font(font)
    M.add(context.root .. "/fonts/" .. font, context.dir .. "/fonts/" .. font)
  end
  for _, font in ipairs(fonts) do add_font(font) end
  -- (the fonts' copyright, licenses, and changes, which the licenses
  -- require with each copy)
  add_font("LICENSE.txt")
  local roles = roles_of(context, document)
  context.roles = roles
  local faces = M.faces(document, assert(files.read(context.dir .. "/" .. context.input .. ".css")), roles)
  local sans = false
  for font in pairs(faces) do sans = sans or font:find("^lmsans10%-") ~= nil end
  if sans then
    for _, font in ipairs(sans_fonts) do add_font(font) end
  end
  local preloaded = {}
  local function preload(font)
    if faces[font] then preloaded[#preloaded + 1] = "fonts/" .. font end
  end
  for _, font in ipairs(fonts) do preload(font) end
  if sans then
    for _, font in ipairs(sans_fonts) do preload(font) end
  end
  for _, font in ipairs(prerender.available(context) and fonts_of(roles) or {}) do
    for _, shape in ipairs(shapes) do preload(font.files[shape] .. ".woff2") end
  end
  if #preloaded > 0 then
    document:query_selector("script#tex8web-fonts")[1]
      :set_attribute("data-fonts", table.concat(preloaded, " "))
  end
  for _, img in ipairs(document:query_selector("img")) do
    local src = img:get_attribute("src") or ""
    if src ~= "" and not src:match("^%a+:") and not exists(context.dir .. "/" .. src)
        and exists(src) then
      M.add(src, context.dir .. "/" .. src)
    end
  end
end

-- copies the fonts of context.roles (set in M.copy) whole from TeX Live,
-- for a page whose fonts prerender.mjs did not cut down
function M.originals(context)
  for _, font in ipairs(fonts_of(context.roles)) do
    for _, shape in ipairs(shapes) do
      local file = font.files[shape] .. ".otf"
      M.add(kpse.find_file(file, "opentype fonts"), context.dir .. "/fonts/" .. file)
    end
  end
end

-- removes the cut-down TeX Live faces, which M.copy lists for preloading
-- and prerender.mjs writes, from the list; without prerendering, the page
-- uses the whole fonts
function M.drop_preloads(filename, roles)
  local gone = {}
  for _, font in ipairs(fonts_of(roles)) do
    for _, shape in ipairs(shapes) do gone["fonts/" .. font.files[shape] .. ".woff2"] = true end
  end
  local html = assert(files.read(filename))
  html = html:gsub("<script data%-fonts='([^']*)'", function(list)
    local kept = {}
    for href in list:gmatch("%S+") do
      if not gone[href] then kept[#kept + 1] = href end
    end
    return "<script data-fonts='" .. table.concat(kept, " ") .. "'"
  end)
  local f = assert(io.open(filename, "w"))
  f:write(html)
  f:close()
end

-- tex4ht draws rules (\hline, \fbox, a table's | columns) in black. They
-- are set in the text's color instead, so they show in dark mode.
function M.rules_in_text_color(css)
  return (css:gsub("border[%w-]*%s*:[^;{}]*", function(declaration)
    return (declaration:gsub("%f[%w]black%f[%W]", "currentColor"))
  end))
end

-- tex4ht's colors, in its stylesheet (\colorbox, \fcolorbox, soul's
-- highlights) and in style attributes (\textcolor, listings), at another
-- lightness in dark mode (css/tex8web.css's --tex8web-dark-*); black text
-- and rules in the text's color. (Without xcolor, tex4ht writes rgb(r,g,b):
-- html4.4ht's \Configure{HColor:rgb} and its gray and cmyk ones.)
local kinds = {color = true, background = true, border = true}
local black = {color = "var(--tex8web-text)", border = "currentColor"}
function M.colors_in_dark_mode(css)
  return (css:gsub("%f[%w-]([%a-]+)(%s*:%s*)([^;{}]*)", function(property, colon, value)
    local kind = property:match("^%a+")
    if not kinds[kind] or value:find("light-dark", 1, true) then return end
    value = value:gsub("rgb%((%d+),(%d+),(%d+)%)", function(r, g, b)
      return ("#%02X%02X%02X"):format(r, g, b)
    end)
    return property .. colon .. value:gsub("#%x%x%x%x%x%x%f[^%w]", function(hex)
      if hex == "#000000" and black[kind] then return black[kind] end
      return ("light-dark(%s, oklch(from %s var(--tex8web-dark-%s) c h))"):format(hex, hex, kind)
    end)
  end))
end

function M.inline_colors(document)
  for _, el in ipairs(document:query_selector("[style]")) do
    el:set_attribute("style", M.colors_in_dark_mode(el:get_attribute("style")))
  end
end

-- the last value the stylesheet gives --tex8web-<name>, in ems or rems,
-- and its unit, or nil with a warning
local function ems(css, name)
  local value = custom(css, name)
  local n, unit = (value or ""):match("^([%d.]+)(r?em)%f[^%w]")
  if not n then
    log:warning("--tex8web-" .. name .. " is " .. (value or "not set") .. ", not a length in em "
      .. "or rem: every screen gets the narrow layout")
  end
  return tonumber(n), unit
end

-- css/tex8web.css's @media (--tex8web-wide): a screen with room for the
-- text (--tex8web-textwidth, which tex8web-page.tex sets and a config may
-- set again) and, on each side, a column (--tex8web-margin) with a gap
-- (--tex8web-gap) on either side of it. Media queries cannot read custom
-- properties, so the query is written here. A media query's em is the
-- browser's default font size, which equals a rem and an em of the text.
-- With \WebLikePDF, an em of the text is that times --tex8web-pdf-scale.
-- Without the lengths, no screen is wide (the query is 10000em), and the
-- narrow layout is used at any width.
function M.wide_screens(css)
  local width, unit = ems(css, "textwidth")
  local margin, gap = ems(css, "margin"), ems(css, "gap")
  local scale = tonumber((custom(css, "pdf-scale") or ""):match("^([%d.]+)%f[^%w.]"))
  if width and unit == "em" and scale then width = width * scale end
  local query = string.format("(min-width: %.2fem)",
    width and margin and gap and width + 2 * (margin + 2 * gap) or 10000)
  return (css:gsub("%(%-%-tex8web%-wide%)", query))
end

-- html4.4ht's rules for paragraphs and blocks in an <li>, which space and
-- indent them unlike LaTeX, limited to lists other than tex8web's
-- (tex8web-text.tex), such as paralist's
function M.other_lists(css)
  return (css:gsub("[^\n]+", function(line)
    local selectors, rule = line:match("^(li [^{]-)%s*({.*)$")
    if not selectors then return end
    return selectors:gsub("[^,]+", function(selector)
      return (selector:gsub("%s+$", "")) .. ":not(.tex8web-list *)"
    end) .. " " .. rule
  end))
end

-- adds tex4ht's rules for the fonts whose class keeps the size in the
-- name, such as ts1-lmbx10- for the bold Latin Modern TS1 font. Their
-- file, ts1-.htf, gives the face for the name without the size,
-- ts1-lmbx, and t4ht matches that only to a class it splits into name and
-- size, such as ec-lmbx-10. Without the rule, a TS1 symbol in bold or
-- italic text is regular and upright. The rules go before the mark of
-- css/tex8web.css, with tex4ht's.
function M.unsized_fonts(context)
  local log = assert(files.read(context.dir .. "/" .. context.input .. ".lg"))
  local faces, rules, seen = {}, {}, {}
  for name, rule in log:gmatch("htfcss:%s*(%S+)%s+([^\n]-)%s*\n") do faces[name] = rule end
  for name in log:gmatch('Font%("([^"]-%d)",""') do
    local rule = not faces[name] and faces[(name:gsub("%d+$", ""))]
    if rule and not seen[name] then
      seen[name] = true
      rules[#rules + 1] = (".%s-{%s}\n"):format(name, rule)
    end
  end
  if #rules == 0 then return end
  local path = context.dir .. "/" .. context.input .. ".css"
  local css = assert(files.read(path))
  local i = assert(css:find("/* tex8web.css */", 1, true))
  local f = assert(io.open(path, "w"))
  f:write(css:sub(1, i - 1), table.concat(rules), css:sub(i))
  f:close()
end

-- inserts css/tex8web.css and the font rules where tex8web-core.tex marks
-- their place in the document's stylesheet, then adjusts the colors and the
-- wide-screen query
function M.stylesheet(context)
  local path = context.dir .. "/" .. context.input .. ".css"
  local css = assert(files.read(path))
  local i, j = assert(css:find("/* tex8web.css */", 1, true))
  css = M.other_lists(css:sub(1, i - 1)) .. assert(files.read(context.root .. "/css/tex8web.css"))
    .. font_css(context.roles) .. css:sub(j + 1)
  local f = assert(io.open(path, "w"))
  f:write(M.wide_screens(M.colors_in_dark_mode(M.rules_in_text_color(css))))
  f:close()
end

return M
