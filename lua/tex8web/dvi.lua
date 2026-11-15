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

-- a make4ht command: a picture that holds another picture, such as a box
-- made of a TikZ picture and used in a TikZ node, made one picture. tex4ht
-- does not nest pictures: it ends the outer picture at the inner one's
-- end, and dvisvgm draws an outer picture whose groups are not closed. So
-- every tex4ht special inside such a picture is overwritten with spaces of
-- its length, which keeps every offset of the DVI. dvisvgm then draws the
-- inner picture as part of the outer one, as in the PDF. A picture runs
-- from tex4ht's special t4ht++<file> to its matching t4ht+ (tex4ht.sty).
-- The inner pictures' locks and unlocks of the bounding box are
-- overwritten too: pgf locks a picture's bounding box, and an inner unlock
-- would let what follows widen the outer picture. The inner pictures'
-- sizes stay, for an outer picture with none, such as a LaTeX picture.
local locks = {["dvisvgm:bbox lock"] = true, ["dvisvgm:bbox unlock"] = true}

function M.nested_pictures(par)
  local path = (par.builddir ~= "" and par.builddir .. "/" or "") .. par.input .. "." .. par.dvi
  local dvi = assert(files.read(path))
  local list, texts, depths = specials(dvi), {}, {}
  local blank, depth, start, nested = {}, 0, nil, false
  for i, special in ipairs(list) do
    texts[i] = dvi:sub(special[1], special[1] + special[2] - 1)
    if texts[i]:find("^t4ht%+%+") then
      depth = depth + 1
      if depth == 1 then start, nested = i, false else nested = true end
    elseif texts[i] == "t4ht+" then
      depth = depth - 1
      if depth == 0 and nested then
        for j = start + 1, i - 1 do
          if texts[j]:find("^t4ht") or depths[j] > 1 and locks[texts[j]] then
            blank[#blank + 1] = list[j]
          end
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
