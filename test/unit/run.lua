-- Runs the Lua unit tests: texlua test/unit/run.lua
-- Each *_test.lua file here returns a table of name -> function. A test
-- fails by raising an error (check and equal below).
kpse.set_program_name("luatex")
local here = arg[0]:match("^(.*)/") or "."
local root = here .. "/../.."
table.insert(package.searchers, 2, function(name)
  local path, message = package.searchpath(name, root .. "/lua/?.lua;" .. here .. "/?.lua")
  if not path then return message end
  return loadfile(path), path
end)

-- a stand-in for make4ht's logging that keeps each message in logged, for
-- the tests to read
logged = {}
logging = {new = function()
  local function keep(level)
    return function(_, ...) logged[#logged + 1] = level .. ": " .. table.concat({...}, " ") end
  end
  return {warning = keep("warning"), status = keep("status"), info = keep("info"), debug = keep("debug"), error = keep("error")}
end}

function check(value, message)
  if not value then error(message or "check failed", 2) end
end

local function show(value)
  if type(value) ~= "table" then return string.format("%q", tostring(value)) end
  local parts = {}
  for k, v in pairs(value) do parts[#parts + 1] = tostring(k) .. "=" .. show(v) end
  table.sort(parts)
  return "{" .. table.concat(parts, ", ") .. "}"
end

function equal(actual, expected)
  if show(actual) ~= show(expected) then
    error("expected " .. show(expected) .. ", got " .. show(actual), 2)
  end
end

local failed, passed = 0, 0
local files = {}
for file in lfs.dir(here) do
  files[#files + 1] = file:match("^(.+_test)%.lua$")
end
table.sort(files)
for _, file in ipairs(files) do
  local tests = require(file)
  local names = {}
  for name in pairs(tests) do names[#names + 1] = name end
  table.sort(names)
  for _, name in ipairs(names) do
    logged = {}
    local ok, err = pcall(tests[name])
    if ok then
      passed = passed + 1
    else
      failed = failed + 1
      print("not ok - " .. file .. ": " .. name .. "\n    " .. tostring(err))
    end
  end
end
print(string.format("%s - lua unit tests (%d passed, %d failed)",
  failed == 0 and "ok" or "not ok", passed, failed))
os.exit(failed == 0 and 0 or 1)
