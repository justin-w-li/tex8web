-- The files a page needs next to it: fonts, the document's pictures and
-- PDF, tex8web.js, and the static styles in the stylesheet, where tex4ht's
-- rules are also drawn in the text's color. Each file is listed with
-- tex4ht's output files, so make4ht -d copies it too.
local M = {}

local fonts = {
  "lmroman10-regular.woff2",
  "lmroman10-bold.woff2",
  "lmroman10-italic.woff2",
  "lmroman10-bolditalic.woff2",
  "lmmono10-regular.woff2",
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

-- the fonts, and the pictures, which the page references relative to the
-- document (\includegraphics), unless tex4ht made them
function M.copy(document, context)
  for _, font in ipairs(fonts) do
    M.add(context.root .. "/fonts/" .. font, context.dir .. "/fonts/" .. font)
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
  f:write(M.rules_in_text_color(css))
  f:close()
end

return M
