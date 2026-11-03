-- The files a page needs next to it: fonts, the document's pictures and
-- PDF, tex8web.js, and the static styles in the stylesheet, where tex4ht's
-- rules are also drawn in the text's color. Each file is listed with
-- tex4ht's output files, so make4ht -d copies it too.
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

local function read(path)
  local f = assert(io.open(path))
  local s = f:read("*a")
  f:close()
  return s
end

-- copies source to path, a file of the page
function M.add(source, path)
  copy(source, path)
  Make:add_file(path)
end

-- text in tex4ht's classes for sans-serif fonts (css/tex8web.css), or
-- headings in sans-serif (tex8web-page.tex, in the document's stylesheet)
local function uses_sans(document, context)
  local css = read(context.dir .. "/" .. context.input .. ".css")
  local found = css:find("%-%-tex8web%-%a+%-family: var%(%-%-tex8web%-sans%)") ~= nil
  document:traverse_elements(function(el)
    local class = el:get_attribute("class") or ""
    found = found or class:find("%-lmss") or class:find("^cmss") or class:find("^ecss")
  end)
  return found
end

-- the fonts, and the pictures, which the page references relative to the
-- document (\includegraphics), unless tex4ht made them
function M.copy(document, context)
  local function add_font(font)
    M.add(context.root .. "/fonts/" .. font, context.dir .. "/fonts/" .. font)
  end
  for _, font in ipairs(fonts) do add_font(font) end
  if uses_sans(document, context) then
    for _, font in ipairs(sans_fonts) do add_font(font) end
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
  local value
  local declarations = css:gsub("/%*.-%*/", "")
  for v in declarations:gmatch("%-%-tex8web%-" .. name .. "%s*:%s*([^;}]-)%s*[;}]") do value = v end
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
  local css = read(path)
  local i, j = css:find("/* tex8web.css */", 1, true)
  if not i then return end
  css = css:sub(1, i - 1) .. read(context.root .. "/css/tex8web.css") .. css:sub(j + 1)
  local f = assert(io.open(path, "w"))
  f:write(M.wide_screens(M.rules_in_text_color(css)))
  f:close()
end

return M
