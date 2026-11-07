-- Typesetting the math at build time: js/prerender.mjs, with MathJax from
-- node_modules (npm ci). Without it, or with TEX8WEB_NO_PRERENDER set,
-- MathJax typesets the math in the reader's browser.
local files = require "tex8web.files"

local log = logging.new("tex8web")

local M = {}

-- the MathJax version tex8web works with: package.json's, which both
-- prerendering and the page's script use (tex8web.js relies on MathJax's
-- internals)
function M.mathjax_version(root)
  return assert(files.read(root .. "/package.json")):match('"mathjax":%s*"([^"]+)"')
end

-- the MathJax in node_modules, which a worktree may share with a checkout
-- that pins another
local function installed_version(context)
  local json = files.read(context.root .. "/node_modules/mathjax/package.json")
  return json and json:match('"version":%s*"([^"]+)"')
end

local function installed(context)
  return lfs.attributes(context.root .. "/node_modules/mathjax") ~= nil
    and lfs.attributes(context.root .. "/node_modules/subset-font") ~= nil
end

-- whether node_modules has the MathJax package.json pins
local function pinned(context)
  return installed_version(context) == context.mathjax
end

-- whether M.run will try
function M.available(context)
  return not os.getenv("TEX8WEB_NO_PRERENDER") and installed(context) and pinned(context)
end

-- typesets the page's math; false if it couldn't, and the page needs
-- MathJax in the browser
function M.run(context, filename)
  if os.getenv("TEX8WEB_NO_PRERENDER") then return false end
  if not installed(context) then
    log:warning("math left for MathJax in the browser, from jsDelivr; run npm ci in "
      .. context.root .. " to typeset it here")
    return false
  end
  if not pinned(context) then
    log:warning("MathJax " .. tostring(installed_version(context)) .. " is installed, not the " .. context.mathjax
      .. " package.json pins; math left for MathJax in the browser. Run npm ci in " .. context.root)
    return false
  end
  local node = io.popen("node " .. files.quote(context.root .. "/js/prerender.mjs") .. " "
    .. files.quote(filename))
  -- (it prints the files it made: MathJax's styles and fonts, and TeX
  -- Gyre's)
  local made = {}
  for path in node:lines() do made[#made + 1] = path end
  if not node:close() then
    log:warning("prerender.mjs failed; math left for MathJax in the browser")
    return false
  end
  for _, path in ipairs(made) do Make:add_file(path) end
  return true
end

return M
