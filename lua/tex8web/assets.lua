-- The files a page needs next to it: fonts, the document's pictures and
-- PDF, tex8web.js, and the static styles in the stylesheet, where tex4ht's
-- rules are also drawn in the text's color. Each file is listed with
-- tex4ht's output files, so make4ht -d copies it too.
local files = require "tex8web.files"

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

local function exists(path)
  return lfs.attributes(path) ~= nil
end

-- copies source to path, a file of the page
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

-- text in tex4ht's classes for sans-serif fonts (css/tex8web.css), or
-- headings in sans-serif (tex8web-page.tex, in the document's stylesheet)
local function uses_sans(document, context)
  local css = assert(files.read(context.dir .. "/" .. context.input .. ".css"))
  local found = css:find("%-%-tex8web%-%a+%-family: var%(%-%-tex8web%-sans%)") ~= nil
  document:traverse_elements(function(el)
    local class = el:get_attribute("class") or ""
    found = found or class:find("%-lmss") or class:find("^cmss") or class:find("^ecss")
  end)
  return found
end

-- the faces of Latin Modern the page's text is set in, by the rules that
-- set its font: tex4ht's for its font classes (.ec-lmbx-10 bold,
-- .ec-lmro-10 oblique, which is the italic), css/tex8web.css's for their
-- families and for headings (in the fonts tex8web-page.tex gives them in
-- the stylesheet, css), and the browser's for other elements. A set of
-- font files, with Roman's regular face, which the page's controls use
function M.faces(document, css)
  -- (each rule a face, of what it sets: bold, italic and the family, mono
  -- and sans in Latin Modern, or system for the browser's monospace)
  local rules = {
    h1 = {bold = true}, h2 = {bold = true}, h3 = {bold = true}, h4 = {bold = true},
    h5 = {bold = true}, h6 = {bold = true}, b = {bold = true}, strong = {bold = true},
    em = {italic = true}, i = {italic = true}, cite = {italic = true},
    pre = {family = "system"}, code = {family = "system"}, tt = {family = "system"},
    kbd = {family = "system"}, samp = {family = "system"},
  }
  local classes = {titleHead = {bold = false}, id = {bold = true}, ["tex8web-toc-title"] = {bold = true}}
  for _, level in ipairs({"section", "subsection", "subsubsection", "paragraph", "subparagraph"}) do
    local family = custom(css, level .. "-family") or ""
    local face = {bold = (custom(css, level .. "-weight") or "bold") == "bold",
      italic = (custom(css, level .. "-style") or "normal") == "italic",
      family = family:find("sans") and "sans" or family:find("mono") and "mono" or nil}
    classes[level .. "Head"], classes["like" .. level .. "Head"] = face, face
  end
  local toc = {bold = (custom(css, "toc-section-weight") or "normal") == "bold"}
  classes.sectionToc, classes.likesectionToc = toc, toc
  for class, rule in css:gmatch("%.([%w-]+%-%d[%w-]*)%s*(%b{})") do
    local face = classes[class] or {}
    for property, value in rule:gmatch("([%w-]+)%s*:%s*([^;}]+)") do
      if property == "font-weight" then face.bold = value:find("bold") ~= nil end
      if property == "font-style" then face.italic = (value:find("italic") or value:find("oblique")) ~= nil end
      if property == "font-family" and value:find("monospace") then face.family = "system" end
    end
    classes[class] = face
  end
  -- (css/tex8web.css's, after tex4ht's)
  for class, face in pairs(classes) do
    if class:find("%-lmtt") or class:find("^cmtt%-") or class:find("^ectt%-") then face.family = "mono"
    elseif class:find("%-lmss") or class:find("^cmss") or class:find("^ecss") then face.family = "sans"
    elseif class:find("^ptmr7t%-") then face.family = nil end
  end
  local function file(face)
    if face.family == "mono" then return "lmmono10-regular.woff2" end
    if face.family == "system" then return end
    local shape = face.bold and (face.italic and "bolditalic" or "bold") or face.italic and "italic" or "regular"
    if face.family == "sans" then return "lmsans10-" .. shape:gsub("italic", "oblique") .. ".woff2" end
    return "lmroman10-" .. shape .. ".woff2"
  end
  local used = {["lmroman10-regular.woff2"] = true}
  -- (the text of each element, but scripts' and the math's, which MathJax
  -- sets in its own fonts)
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
    end
    for _, child in ipairs(el:get_children()) do
      if child:is_element() and not ({script = true, style = true})[child:get_element_name()] then
        walk(child, face)
      elseif child:is_text() and child:get_text():find("%S") and file(face) then
        used[file(face)] = true
      end
    end
  end
  walk(document:query_selector("body")[1], {})
  return used
end

-- the fonts, and the pictures, which the page references relative to the
-- document (\includegraphics), unless tex4ht made them. The faces the text
-- uses are preloaded (M.faces; prerender.mjs says why)
function M.copy(document, context)
  local function add_font(font)
    M.add(context.root .. "/fonts/" .. font, context.dir .. "/fonts/" .. font)
  end
  for _, font in ipairs(fonts) do add_font(font) end
  -- (their copyright, licenses and changes, which the licenses ask a copy
  -- to come with)
  add_font("LICENSE.txt")
  local sans = uses_sans(document, context)
  if sans then
    for _, font in ipairs(sans_fonts) do add_font(font) end
  end
  local head = document:query_selector("head")[1]
  local faces = M.faces(document, assert(files.read(context.dir .. "/" .. context.input .. ".css")))
  local function preload(font)
    if faces[font] then
      head:add_child_node(head:create_element("link", {rel = "preload", as = "font",
        type = "font/woff2", crossorigin = "", href = "fonts/" .. font}))
    end
  end
  for _, font in ipairs(fonts) do preload(font) end
  if sans then
    for _, font in ipairs(sans_fonts) do preload(font) end
  end
  for _, img in ipairs(document:query_selector("img")) do
    local src = img:get_attribute("src") or ""
    if src ~= "" and not src:match("^%a+:") and not exists(context.dir .. "/" .. src)
        and exists(src) then
      M.add(src, context.dir .. "/" .. src)
    end
  end
end

-- tex4ht draws rules (\hline, \fbox, a table's | columns) in black; in the
-- text's color instead, so they show in dark mode
function M.rules_in_text_color(css)
  return (css:gsub("border[%w-]*%s*:[^;{}]*", function(declaration)
    return (declaration:gsub("%f[%w]black%f[%W]", "currentColor"))
  end))
end

-- the last value the stylesheet gives --tex8web-<name>, in ems or rems
-- (the same here; see wide_screens), or nil with a warning
local function ems(css, name)
  local value = custom(css, name)
  local n = tonumber((value or ""):match("^([%d.]+)r?em%f[^%w]"))
  if not n then
    log:warning("--tex8web-" .. name .. " is " .. (value or "not set") .. ", not a length in em "
      .. "or rem: every screen gets the narrow layout")
  end
  return n
end

-- css/tex8web.css's @media (--tex8web-wide): a screen with room for the
-- text (--tex8web-textwidth, which tex8web-page.tex sets and a config may
-- set again) and on each side a column (--tex8web-margin) with a gap on
-- either side of it (--tex8web-gap). (Media queries can't read custom
-- properties; the em of one is the browser's default font size, 16px, as
-- large as the page's 12pt and as a rem.) Without the lengths, no screen is
-- wide (none is 10000em): the narrow layout reads at any width
function M.wide_screens(css)
  local width, margin, gap = ems(css, "textwidth"), ems(css, "margin"), ems(css, "gap")
  local query = string.format("(min-width: %.2fem)",
    width and margin and gap and width + 2 * (margin + 2 * gap) or 10000)
  return (css:gsub("%(%-%-tex8web%-wide%)", query))
end

-- css/tex8web.css, where tex8web-core.tex marks its place in the document's
-- stylesheet (a page that tex4ht splits off shares the stylesheet, which
-- then has it already)
function M.stylesheet(context)
  local path = context.dir .. "/" .. context.input .. ".css"
  local css = assert(files.read(path))
  local i, j = css:find("/* tex8web.css */", 1, true)
  if not i then return end
  css = css:sub(1, i - 1) .. assert(files.read(context.root .. "/css/tex8web.css")) .. css:sub(j + 1)
  local f = assert(io.open(path, "w"))
  f:write(M.wide_screens(M.rules_in_text_color(css)))
  f:close()
end

return M
