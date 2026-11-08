-- Typesetting the math at build time: js/prerender.mjs, with MathJax from
-- node_modules (npm ci). Without MathJax and subset-font in node_modules,
-- with a MathJax other than the version package.json pins, or with
-- TEX8WEB_NO_PRERENDER set, MathJax typesets the math in the browser.
local files = require "tex8web.files"

local log = logging.new("tex8web")

local M = {}

-- the MathJax version package.json pins, used in prerendering and by the
-- page's script (tex8web.js depends on MathJax internals)
function M.mathjax_version(root)
  return assert(files.read(root .. "/package.json")):match('"mathjax":%s*"([^"]+)"')
end

-- the version of the MathJax in node_modules, which may differ from the
-- pinned one: node_modules may be installed for an older package.json, or
-- shared with another checkout
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

-- typesets the page's math; false if it could not, and the page needs
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
  -- (prerender.mjs prints the files it made: MathJax's styles and fonts,
  -- and the TeX Live fonts, TeX Gyre and XCharter)
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
