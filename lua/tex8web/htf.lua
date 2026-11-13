-- tex4ht's font files (.htf) for the fonts whose TFMs put T1's
-- f-ligatures in other slots than T1's. tex4ht's files for these fonts
-- alias lm-ec.htf, or are missing, so "off" shows as "ofl" or as NUL
-- bytes. The files are written next to LaTeX's output and searched before
-- tex4ht's.
local files = require "tex8web.files"

local M = {}

-- Each entry gives a pattern of font names and the ligature in each slot
-- of its fonts, which lm-ec.htf has as 27 ff, 28 fi, 29 fl, 30 ffi, and
-- 31 ffl. XCharter's order is its base encoding's, xch_rydp4l.enc. Its
-- small capitals (-sc-) and theorem fonts (XCharterTH, XCharter1TH) have
-- no f-ligatures.
local orders = {
  {name = "xcharter", fonts = "^XCharter1?%-%a+%-t?[lo]s?f%-t1$",
    slots = {[27] = "FB04", [28] = "FB03", [29] = "FB00", [30] = "FB02", [31] = "FB01"}},
}

-- the names of the fonts the DVI file defines, from its postamble
local function dvi_fonts(path)
  local dvi = assert(files.read(path))
  local at = #dvi
  while dvi:byte(at) == 223 do at = at - 1 end
  -- post_post's pointer to post, whose 28 bytes of parameters come before
  -- the font definitions (fnt_def1 to fnt_def4, opcodes 243 to 246) and
  -- nops (138)
  at = string.unpack(">I4", dvi, at - 4) + 30
  local names = {}
  while true do
    local op = dvi:byte(at)
    if op == 138 then
      at = at + 1
    elseif op >= 243 and op <= 246 then
      local k = op - 242
      local area, length = dvi:byte(at + k + 13, at + k + 14)
      names[#names + 1] = dvi:sub(at + k + 15 + area, at + k + 14 + area + length)
      at = at + k + 15 + area + length
    else
      return names
    end
  end
end

-- the CSS of a font's face, from its name, as tex4ht's alias files give it
local function face(name)
  local css = {}
  if name:find("Bold") then css[#css + 1] = "font-weight: bold;" end
  if name:find("Italic") then css[#css + 1] = "font-style: italic;" end
  if name:find("Slanted") then css[#css + 1] = "font-style: oblique;" end
  return table.concat(css, " ")
end

local function write(path, s)
  local f = assert(io.open(path, "w"))
  f:write(s)
  f:close()
end

-- a make4ht command: writes the files for the DVI's fonts that an entry
-- names, and puts their folder first in tex4ht's search path
function M.write(par)
  local dir
  for _, name in ipairs(dvi_fonts((par.builddir ~= "" and par.builddir .. "/" or "") .. par.input .. "." .. par.dvi)) do
    for _, order in ipairs(orders) do
      if name:find(order.fonts) then
        local base = "tex8web-" .. order.name
        if not dir then
          -- (tex4ht drops a font file whose path has none of the folders
          -- that tex4ht.env's i records name, such as ht-fonts/alias/)
          dir = lfs.currentdir() .. "/" .. (par.builddir ~= "" and par.builddir .. "/" or "") .. "tex8web-htf"
          for _, folder in ipairs({"", "/ht-fonts", "/alias"}) do
            dir = dir .. folder
            lfs.mkdir(dir)
          end
          os.setenv("TEX4HTINPUTS", dir .. ":" .. (os.getenv("TEX4HTINPUTS") or ""))
        end
        if not lfs.attributes(dir .. "/" .. base .. ".htf") then
          local lm = assert(files.read(kpse.new("luatex", "tex4ht"):find_file("lm-ec.htf", "other text files")))
          local lines = {}
          for line in lm:gmatch("[^\n]+") do
            local slot = tonumber(line:match("^'.-' '.-'%s+(%d+)"))
            lines[#lines + 1] = order.slots[slot] and ("'&#x%s;' '' %d"):format(order.slots[slot], slot)
              or (line:gsub("^lm%-ec ", base .. " "))
          end
          write(dir .. "/" .. base .. ".htf", table.concat(lines, "\n") .. "\n")
        end
        local css = face(name)
        write(dir .. "/" .. name .. ".htf", "." .. base .. "\n" .. (css ~= "" and "htfcss: " .. name .. " " .. css .. "\n" or ""))
      end
    end
  end
  return 0
end

return M
