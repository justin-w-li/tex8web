-- Reading files, and quoting their names for the shell.
local M = {}

-- the file's text, or nil if it cannot be read
function M.read(path)
  local f = io.open(path)
  if not f then return end
  local s = f:read("*a")
  f:close()
  return s
end

-- s quoted for a POSIX shell
function M.quote(s)
  return "'" .. s:gsub("'", "'\\''") .. "'"
end

return M
