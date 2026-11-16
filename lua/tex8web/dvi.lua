-- The DVI file, changed after LaTeX and before tex4ht reads it.
local files = require "tex8web.files"

local M = {}

-- the bytes of parameters after each opcode that has a fixed number of
-- them (dvitype.web): set, put, right, w, x, y, z, down, and fnt, each in
-- forms 1 to 4, and set_rule, put_rule, and bop. The other opcodes have
-- none, except xxx, fnt_def, pre, and post.
local params = {[132] = 8, [137] = 8, [139] = 44}
for _, first in ipairs({128, 133, 143, 148, 153, 157, 162, 167, 235}) do
  for k = 1, 4 do params[first + k - 1] = k end
end

-- the DVI's specials, as {position of the text, its length}, from the
-- preamble to the postamble (opcode 248)
local function specials(dvi)
  local list = {}
  -- (after pre, whose comment's length is its 15th byte)
  local at = 16 + dvi:byte(15)
  while true do
    local op = dvi:byte(at)
    if op == 248 then return list end
    if op >= 239 and op <= 242 then
      local k = op - 238
      local length = string.unpack(">I" .. k, dvi, at + 1)
      list[#list + 1] = {at + 1 + k, length}
      at = at + 1 + k + length
    elseif op >= 243 and op <= 246 then
      local k = op - 242
      local area, length = dvi:byte(at + k + 13, at + k + 14)
      at = at + k + 15 + area + length
    else
      at = at + 1 + (params[op] or 0)
    end
  end
end

-- what follows a tex4ht special's prefix, which tex4ht takes in either
-- case (tex4ht-c.tex), or nil for another special
local function tex4ht(text)
  if text:sub(1, 4):lower() == "t4ht" then return text:sub(5) end
end

-- a make4ht command: a picture that holds another picture made one
-- picture, as tex4ht does not nest pictures ("How it works" in
-- CONTRIBUTING.md). In any picture, a lock of the bounding box made
-- while one is on is overwritten, and so is its unlock: dvisvgm does not
-- nest locks, and an inner unlock would let what follows widen the outer
-- picture. Such a lock is an inner picture's, or a \rotatebox's in a
-- TikZ picture (tex8web-text.tex). The inner pictures' baseline marks are
-- overwritten too, as text.pictures reads the first mark in the SVG.
function M.nested_pictures(par)
  local path = (par.builddir ~= "" and par.builddir .. "/" or "") .. par.input .. "." .. par.dvi
  local dvi = assert(files.read(path))
  local list, texts, depths = specials(dvi), {}, {}
  local blank, depth, start, nested = {}, 0, nil, false
  for i, special in ipairs(list) do
    texts[i] = dvi:sub(special[1], special[1] + special[2] - 1)
    local rest = tex4ht(texts[i])
    if rest and rest:find("^%+%+") then
      depth = depth + 1
      if depth == 1 then start, nested = i, false else nested = true end
    elseif rest == "+" then
      depth = depth - 1
      if depth == 0 then
        -- (for each lock not yet unlocked, whether it is kept)
        local locked, kept = false, {}
        for j = start + 1, i - 1 do
          local text, drop = texts[j]
          if text == "dvisvgm:bbox lock" then
            drop = locked
            kept[#kept + 1] = not locked
            locked = true
          elseif text == "dvisvgm:bbox unlock" then
            drop = not table.remove(kept)
            if not drop then locked = false end
          else
            drop = nested and (tex4ht(text) or depths[j] > 1 and text:find("^dvisvgm:raw <g class='tex8web%-baseline'"))
          end
          if drop then blank[#blank + 1] = list[j] end
        end
      end
    end
    depths[i] = depth
  end
  if #blank == 0 then return 0 end
  local f = assert(io.open(path, "r+b"))
  for _, special in ipairs(blank) do
    f:seek("set", special[1] - 1)
    f:write((" "):rep(special[2]))
  end
  f:close()
  return 0
end

return M
