-- Typesetting the math at build time: js/prerender.mjs, with MathJax from
-- node_modules (npm ci). Without it, or with TEX8WEB_NO_PRERENDER set,
-- MathJax typesets the math in the reader's browser.
local log = logging.new("tex8web")

local M = {}

local function quote(s)
  return "'" .. s:gsub("'", "'\\''") .. "'"
end

-- the MathJax version tex8web works with: package.json's, which both
-- prerendering and the page's script use (tex8web.js relies on MathJax's
-- internals)
function M.mathjax_version(root)
  local f = assert(io.open(root .. "/package.json"))
  local version = f:read("*a"):match('"mathjax":%s*"([^"]+)"')
  f:close()
  return version
end

-- typesets the page's math; false if it couldn't, and the page needs
-- MathJax in the browser
function M.run(context, filename)
  if os.getenv("TEX8WEB_NO_PRERENDER") then return false end
  if lfs.attributes(context.root .. "/node_modules/mathjax") == nil then
    log:info("math left for MathJax in the browser; run npm ci in " .. context.root
      .. " to typeset it here")
    return false
  end
  local node = io.popen("node " .. quote(context.root .. "/js/prerender.mjs") .. " " .. quote(filename))
  -- (it prints the files it made: MathJax's styles and fonts)
  local files = {}
  for path in node:lines() do files[#files + 1] = path end
  if not node:close() then
    log:warning("prerender.mjs failed; math left for MathJax in the browser")
    return false
  end
  for _, path in ipairs(files) do Make:add_file(path) end
  return true
end

return M
