-- Accents: which glyph, and how wide.
local dom = require "web.dom"
local mathml = require "web.mathml"

local M = {}

-- tex4ht writes an accent over a letter as the precomposed letter when
-- Unicode has one (\bar y as ȳ), which MathJax's fonts lack. Each entry: the
-- accent as tex4ht writes it otherwise, the precomposed letters, and the
-- letters underneath
local accents = {
  {"¯", "āēḡīōūȳĀĒḠĪŌŪȲ", "aegiouyAEGIOUY"},
  {"^", "âĉêĝĥîĵôŝûŵŷẑÂĈÊĜĤÎĴÔŜÛŴŶẐ", "aceghijosuwyzACEGHIJOSUWYZ"},
  {"~", "ãẽĩñõũṽỹÃẼĨÑÕŨṼỸ", "aeinouvyAEINOUVY"},
  {"¨", "äëḧïöẗüẅẍÿÄËḦÏÖÜẄẌŸ", "aehiotuwxyAEHIOUWXY"},
  {"˙", "ȧḃċḋėḟġḣṁṅȯṗṙṡṫẇẋẏżȦḂĊḊĖḞĠḢİṀṄȮṖṘṠṪẆẊẎŻ", "abcdefghmnoprstwxyzABCDEFGHIMNOPRSTWXYZ"},
  {"´", "áćéǵíḱĺḿńóṕŕśúẃýźÁĆÉǴÍḰĹḾŃÓṔŔŚÚẂÝŹ", "acegiklmnoprsuwyzACEGIKLMNOPRSUWYZ"},
  {"`", "àèìǹòùẁỳÀÈÌǸÒÙẀỲ", "aeinouwyAEINOUWY"},
  {"ˇ", "ǎčďěǧȟǐǰǩľňǒřšťǔžǍČĎĚǦȞǏǨĽŇǑŘŠŤǓŽ", "acdeghijklnorstuzACDEGHIKLNORSTUZ"},
  {"˘", "ăĕğĭŏŭĂĔĞĬŎŬ", "aegiouAEGIOU"},
}
-- precomposed letter -> {letter, accent}
local decomposed = {}
-- accents that keep their own width
local narrow = {["ˆ"] = true, ["˜"] = true, ["⃗"] = true, ["˚"] = true}
for _, accent in ipairs(accents) do
  local letters = {}
  for _, c in utf8.codes(accent[3]) do letters[#letters + 1] = utf8.char(c) end
  local i = 0
  for _, c in utf8.codes(accent[2]) do
    i = i + 1
    decomposed[utf8.char(c)] = {letters[i], accent[1]}
  end
  narrow[accent[1]] = true
end

function M.decompose(document)
  for _, mi in ipairs(document:query_selector("mi")) do
    local parts = decomposed[dom.text(mi) or ""]
    if parts then
      local letter, accent = table.unpack(parts)
      dom.set_text(mi, letter)
      local mover = dom.wrap(mi, "mover", {accent = "true"})
      mover:add_child_node(mathml.operator(mover, accent, {accent = "true"}))
    end
  end
end

-- \underbrace and \overbrace come out unstretched (and sometimes as the
-- presentation forms ︸ ︷), and sit too far from their base unless marked as
-- accents. (Before scripts.limits_as_scripts, which would make them scripts)
local braces = {["⏟"] = "⏟", ["︸"] = "⏟", ["⏞"] = "⏞", ["︷"] = "⏞"}
function M.braces(document)
  for _, mo in ipairs(document:query_selector("mo")) do
    local brace = braces[dom.text(mo) or ""]
    if brace then
      dom.set_text(mo, brace)
      mo:set_attribute("stretchy", "true")
      mo:get_parent():set_attribute(brace == "⏟" and "accentunder" or "accent", "true")
    end
  end
end

-- \overline and \underline come out as a stretched macron (¯) or low line
-- (̲) set as a script, which MathJax draws thin, dashed or out of place;
-- MathJax's TeX input uses an accent rule (―). (before
-- scripts.limits_as_scripts, which would make an overline a superscript)
function M.rules(document)
  for _, class in ipairs{"mml-overline", "mml-underline"} do
    for _, el in ipairs(document:query_selector("." .. class)) do
      local line = dom.children(el)[2]
      if line and line:get_element_name() == "mo" then
        dom.set_text(line, "―")
        el:set_attribute(class == "mml-overline" and "accent" or "accentunder", "true")
      end
    end
  end
end

-- \vec's arrow is marked as an accent; \overrightarrow's isn't
local function is_vec(mo)
  return dom.text(mo) == "→" and mo:get_attribute("accent") == "true"
end

-- accents (\bar x, \hat{\bm\beta}, \vec{v}) keep their own width, as in
-- TeX, instead of stretching across their base; \widehat and \widetilde
-- (marked "wide" by the cfg), \overline and \overrightarrow stretch
function M.widths(document)
  for _, mover in ipairs(document:query_selector("mover")) do
    local children = dom.children(mover)
    local class = mover:get_attribute("class")
    local accent = children[2]
    if #children ~= 2 or accent:get_element_name() ~= "mo" then
      -- not an accent
    elseif class == "wide" then
      -- TeX's smallest \widehat (0.556em) is wider than \hat (0.5em), which
      -- MathJax would use over a narrow letter. (it takes a glyph within 10%
      -- of minsize, so ask for a little more)
      accent:set_attribute("minsize", "0.6em")
    elseif is_vec(accent) then
      -- (MathJax draws a full arrow over the base for an accent →; its TeX
      -- input leaves the accent to the operator dictionary)
      accent:set_attribute("stretchy", "false")
      dom.remove_attribute(accent, "accent")
    elseif mover:get_attribute("accent") == "true" and class ~= "mml-overline"
        and narrow[dom.text(accent) or ""] then
      accent:set_attribute("stretchy", "false")
    end
  end
end

return M
