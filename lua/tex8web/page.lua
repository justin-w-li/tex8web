-- The page around the text: the build data from tex8web-page.tex, links to
-- headings, theorems, and boxes, the controls, the table of contents beside
-- the text, meta tags for link previews, and the scripts.
local assets = require "tex8web.assets"
local dom = require "tex8web.dom"
local files = require "tex8web.files"

local log = logging.new("tex8web")

local M = {}

local function trim(s)
  return s:match("^%s*(.-)%s*$")
end

-- an element's text on one line, as TeX may have broken it over several
local function text_of(element)
  return trim((element:get_text():gsub("%s+", " ")))
end

-- moves tex8web-page.tex's build elements into context, for the later
-- passes: the PDF (context.pdf: TEX8WEB_PDF, set by -p, or else \WebPDF's),
-- the page above (context.up: TEX8WEB_UP, from -u, or else \WebUp's), the
-- font families (context.families), the \WebMathMacros definitions
-- (context.macros), the colors for math (context.colors), and \contentsname
-- as tex4ht writes it (context.contents). Also gives <html> its classes, as
-- html5.4ht's tag has no hook for them.
function M.build_data(document, context)
  local element = document:query_selector("script[type='text/x-tex8web-build']")[1]
  local name = document:query_selector("script[type='text/x-tex8web-contents']")[1]
  local colors = document:query_selector("script[type='text/x-tex8web-colors']")[1]
  -- (tex8web-page.tex writes all three in one page; a page without them
  -- was split off by tex4ht, as with a config's \CutAt)
  if not (element and name and colors) then
    error("tex8web makes one page per document; remove \\CutAt or the split option")
  end
  local pdf = os.getenv("TEX8WEB_PDF") or ""
  if pdf == "" then pdf = element:get_attribute("data-pdf") end
  context.pdf = pdf ~= "" and pdf or nil
  local up = os.getenv("TEX8WEB_UP") or ""
  if up == "" then up = element:get_attribute("data-up") end
  context.up = up ~= "" and up or nil
  local body, roman, sans, mono = (element:get_attribute("data-fonts") or ""):match("(%S+) (%S+) (%S+) (%S+)")
  context.families = {body = body, roman = roman, sans = sans, mono = mono}
  local classes = element:get_attribute("data-classes") or ""
  if classes ~= "" then document:query_selector("html")[1]:set_attribute("class", classes) end
  context.macros = element:get_text()
  element:remove_node()
  context.contents = text_of(name)
  name:remove_node()
  context.colors = colors:get_text()
  colors:remove_node()
end

local function permalink(el, id)
  local a = el:create_element("a", {class = "tex8web-permalink", href = "#" .. id,
    ["aria-label"] = "Link here"})
  a:add_child_node(a:create_text_node("#"))
  dom.set_children(el, {a, table.unpack(el:get_children())})
end

-- the id of tex4ht's anchor in el (<a id="x1-20001"></a>)
local function anchor(el)
  for _, child in ipairs(el:get_children()) do
    if child:is_element() and child:get_element_name() == "a" and child:get_attribute("id") then
      return child:get_attribute("id")
    end
  end
end

-- a # link before each heading, theorem head, and box title, to its anchor
-- (make4ht later gives headings ids from their titles, and rewrites links
-- to their anchors to use those ids)
function M.permalinks(document)
  for _, head in ipairs(document:query_selector(".newtheorem span.head, h2, h3, h4, h5, h6")) do
    local id = anchor(head)
    if id then permalink(head, id) end
  end
  -- (a box's anchors are in the box, before its title; with a label,
  -- tcolorbox.4ht can make two, and \ref leads to the last)
  for _, title in ipairs(document:query_selector("div.tcolorbox > div.tcolorbox-title")) do
    local id
    for _, child in ipairs(dom.elements(title:get_parent())) do
      if child == title then break end
      id = child:get_attribute("id")
    end
    if id then permalink(title, id) end
  end
end

-- an id for each \WebTerm, for the table of contents filter to link to:
-- term-<text>, without the math, which would show its source. Letters
-- beyond ASCII are kept, as in make4ht's ids for headings.
function M.terms(document)
  local used = {}
  for _, term in ipairs(document:query_selector("span.tex8web-term")) do
    local slug = term:get_text():gsub("\\%(.-\\%)", ""):lower():gsub("[^%w\128-\255]+", "-"):gsub("^%-", ""):gsub("%-$", "")
    local base = slug ~= "" and "term-" .. slug or "term"
    local id, n = base, 1
    while used[id] do
      n = n + 1
      id = base .. "-" .. n
    end
    used[id] = true
    term:set_attribute("id", id)
  end
end

-- line icons for the controls (24 by 24, drawn with css/tex8web.css's
-- stroke)
local icons = {
  up = '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  contents = '<path d="M4 6h16M4 12h16M4 18h10"/>',
  pdf = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>'
    .. '<path d="M14 3v5h5M9 13h6M9 17h4"/>',
  theme = '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  -- (Feather's, MIT License; at 80%, as it fills the box, with stroke-width
  -- raised to match the others)
  github = '<g transform="translate(2.4 2.4) scale(0.8)" stroke-width="1.875"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7'
    .. 'A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0'
    .. 'C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7'
    .. 'A3.37 3.37 0 0 0 9 18.13V22"/></g>',
}

local function control(parent, name, attributes)
  local el = parent:create_element(attributes.href and "a" or "button", attributes)
  dom.set_children(el, el:create_template('<svg viewBox="0 0 24 24" aria-hidden="true">'
    .. icons[name] .. '</svg>'):get_children())
  parent:add_child_node(el)
end

-- whether a tex4ht list is the table of contents: \listoffigures and
-- \listoftables make a div.tableofcontents too, of lofToc and lotToc
-- entries
local function holds_contents(list)
  for _, entry in ipairs(dom.elements(list)) do
    for _, level in ipairs({"part", "chapter", "section", "paragraph"}) do
      if dom.class_matches(entry, "%a*" .. level .. "Toc") then return true end
    end
  end
end

-- moves tex4ht's table of contents out of the text into a sidebar, which
-- on a narrow screen is a drawer: a popover opened by the contents button.
-- The title is that of the unnumbered heading above the list, or of the
-- box around it if the list is all the box holds, or else \contentsname;
-- the heading or box is removed. Returns the sidebar and its title.
local function contents(document, body, title)
  local list
  for _, candidate in ipairs(document:query_selector("div.tableofcontents")) do
    if holds_contents(candidate) then list = candidate break end
  end
  if not list then return end
  local heading = dom.previous_element(list)
  if heading and dom.class_matches(heading, "like%a*Head") then
    title = text_of(heading)
    heading:remove_node()
  end
  local content = list:get_parent()
  local box = dom.has_class(content, "tcolorbox-content") and content:get_parent()
  if box and #dom.elements(content) == 1 then
    local box_title = box:query_selector(".tcolorbox-title")[1]
    if box_title then title = text_of(box_title) end
    box:remove_node()
  else
    list:remove_node()
  end
  local nav = body:create_element("nav", {id = "tex8web-toc", class = "tex8web-toc",
    popover = "auto", ["aria-labelledby"] = "tex8web-toc-title"})
  -- (the document's title, above the table of contents title, links to the
  -- top)
  local document_title = document:query_selector("title")[1]
  if document_title and trim(document_title:get_text()) ~= "" then
    local a = nav:create_element("a", {class = "tex8web-toc-doctitle", href = "#"})
    a:add_child_node(a:create_text_node(trim(document_title:get_text())))
    nav:add_child_node(a)
  end
  local p = nav:create_element("p", {id = "tex8web-toc-title", class = "tex8web-toc-title"})
  p:add_child_node(p:create_text_node(title))
  nav:add_child_node(p)
  -- (the filter: tex8web-page.js runs it and sets its placeholder to what
  -- it can find)
  nav:add_child_node(nav:create_element("input", {type = "search", class = "tex8web-toc-filter"}))
  nav:add_child_node(list)
  return nav, title
end

-- the controls at the top left: the page above (-u, \WebUp), the table of
-- contents (a drawer on a narrow screen; hidden or shown on a wide one),
-- the PDF (-p, \WebPDF, copied next to the page), the theme (needs
-- tex8web-page.js), tex8web's repository, and, on a narrow screen, the
-- section being read, which tex8web-page.js fills in and which also opens
-- the table of contents. Then the table of contents, and the text in a
-- <main>, which screen readers can jump to.
function M.controls(document, context)
  local body = document:query_selector("body")[1]
  local controls = body:create_element("div", {class = "tex8web-controls"})
  local toc, title = contents(document, body, context.contents)
  if context.up then
    control(controls, "up", {class = "tex8web-control tex8web-up", href = context.up,
      title = "Up", ["aria-label"] = "Up"})
  end
  if toc then
    control(controls, "contents", {class = "tex8web-control tex8web-contents", type = "button",
      popovertarget = "tex8web-toc", title = title, ["aria-label"] = title})
  end
  if context.pdf then
    if lfs.attributes(context.pdf) == nil then
      log:warning("no PDF at " .. context.pdf .. "; build it first")
    else
      assets.add(context.pdf, context.dir .. "/" .. context.input .. ".pdf")
      control(controls, "pdf", {class = "tex8web-control", href = context.input .. ".pdf",
        target = "_blank", title = "View as PDF", ["aria-label"] = "View as PDF"})
    end
  end
  control(controls, "theme", {class = "tex8web-control tex8web-theme", type = "button",
    title = "Theme", ["aria-label"] = "Theme"})
  control(controls, "github", {class = "tex8web-control", href = "https://github.com/justin-w-li/tex8web",
    target = "_blank", title = "Made with tex8web", ["aria-label"] = "Made with tex8web"})
  if toc then
    local where = controls:create_element("button", {class = "tex8web-control tex8web-where",
      type = "button", popovertarget = "tex8web-toc", hidden = "hidden",
      ["aria-describedby"] = "tex8web-toc-title"})
    -- (without a child, LuaXML writes <button/>, which HTML parses as an
    -- open tag)
    where:add_child_node(where:create_text_node(""))
    controls:add_child_node(where)
  end
  local main = body:create_element("main")
  dom.set_children(main, body:get_children())
  dom.set_children(body, toc and {controls, toc, main} or {controls, main})
end

-- tex4ht puts the anchor of an equation's number right before the display,
-- with the anchors of an alignment's other lines, or, for a block display
-- such as gather, at the end of the paragraph before. The stylesheet tints
-- a display when one of its anchors is the :target. The anchors of \index
-- (dx..., latex.4ht's indexhaddr) also come before text and displays, so
-- they are skipped, and only the others that space alone separates from a
-- display are marked. Anchors that end a paragraph get another class, as a
-- paragraph may hold the anchors of several displays.
local function is_anchor(node)
  return node:is_element() and node:get_element_name() == "a" and node:get_attribute("id") ~= nil
    and dom.is_blank(node)
end

local function is_index_anchor(node)
  return is_anchor(node) and node:get_attribute("id"):find("^dx") ~= nil
end

-- marks the anchors that end nodes[1..last], ignoring space and comments;
-- returns how many, and the index of the node before them (0 if none)
local function mark_anchors(nodes, last, name)
  local count = 0
  for i = last, 1, -1 do
    local node = nodes[i]
    if is_index_anchor(node) then
      -- (skipped, not marked)
    elseif is_anchor(node) then
      local class = node:get_attribute("class")
      node:set_attribute("class", (class and class .. " " or "") .. name)
      count = count + 1
    elseif node:is_element() or node:is_text() and node:get_text():find("%S") then
      return count, i
    end
  end
  return count, 0
end

function M.equation_anchors(document)
  for _, display in ipairs(document:query_selector(".mathjax-env, .mathjax-block")) do
    local nodes = display:get_parent():get_children()
    local at
    for i, node in ipairs(nodes) do
      if node == display then at = i break end
    end
    local count, before = mark_anchors(nodes, at - 1, "tex8web-eq-anchor")
    if count == 0 and before > 0 and nodes[before]:is_element() and nodes[before]:get_element_name() == "p" then
      local inside = nodes[before]:get_children()
      mark_anchors(inside, #inside, "tex8web-eq-anchor-end")
    end
  end
end

-- the abstract's text, with the math's source, in at most about 200
-- characters, cut at a word if it has spaces
local function abstract_text(document)
  local abstract = document:query_selector(".abstract")[1]
  if not abstract then return end
  local parts = {}
  for _, p in ipairs(abstract:query_selector("p")) do parts[#parts + 1] = p:get_text() end
  local text = trim(table.concat(parts, " "):gsub("\\[()]", ""):gsub("%s+", " "))
  if utf8.len(text) > 200 then
    local cut = text:sub(1, utf8.offset(text, 198) - 1)
    text = (cut:match("^(.*)%s") or cut) .. "…"
  end
  return text
end

-- og:title (if the title is not empty), og:type, and, from the abstract,
-- if there is one, the description
function M.meta_tags(document)
  local head = document:query_selector("head")[1]
  local title = document:query_selector("title")[1]
  local function add(attribute, name, content)
    head:add_child_node(head:create_element("meta", {[attribute] = name, content = content}))
  end
  local title_text = title and trim(title:get_text()) or ""
  if title_text ~= "" then add("property", "og:title", title_text) end
  add("property", "og:type", "article")
  local description = abstract_text(document)
  if description and description ~= "" then
    add("name", "description", description)
    add("property", "og:description", description)
  end
end

-- the scripts:
-- - tex8web-fonts.js, inline before the stylesheet link: inserts the font
--   preloads, so the fonts are requested as soon as the parser reaches it.
--   It must stay small: a large script there delays the stylesheet request.
-- - tex8web-head.js (the reader's theme before the page is drawn, and the
--   transition from the previous page), a file after the link. Inline
--   before the link, it delayed the stylesheet. A script after the link
--   waits for the stylesheet, so the preloads are not in this file.
-- - tex8web-page.js: the controls, the table of contents and its filter,
--   previews, the picture viewer, and the fade at an edge
-- - for MathJax in the browser: MathJax, and tex8web.js, which configures
--   it from tex8web-config and data-contents (both marked
--   data-tex8web-browser, for prerender.mjs to remove)
function M.scripts(document, context)
  local head = document:query_selector("head")[1]
  local function script(attributes)
    local el = head:create_element("script", attributes)
    el:add_child_node(el:create_text_node(""))
    head:add_child_node(el)
  end
  for _, name in ipairs({"tex8web-head.js", "tex8web-page.js"}) do
    assets.add(context.root .. "/js/" .. name, context.dir .. "/" .. name)
  end
  local inline = head:create_element("script", {id = "tex8web-fonts"})
  -- (in a CDATA section behind comment marks: the serializer would escape
  -- the <, >, and & of the code, and make4ht's later XML parse needs them
  -- whole)
  local code = inline:create_text_node("*/\n" .. assert(files.read(context.root .. "/js/tex8web-fonts.js")) .. "\n/*")
  code._type = "CDATA"
  inline:add_child_node(inline:create_text_node("/*"))
  inline:add_child_node(code)
  inline:add_child_node(inline:create_text_node("*/"))
  head:add_child_node(inline, head:query_selector("link[rel='stylesheet']")[1]:find_element_pos())
  script({src = "tex8web-head.js"})
  script({src = "tex8web-page.js", defer = "defer"})
  script({src = "tex8web.js", ["data-tex8web-browser"] = "", ["data-mathjax"] = context.mathjax,
    ["data-contents"] = document:query_selector("#tex8web-toc")[1] and "" or nil})
  script({async = "async", id = "MathJax-script", ["data-tex8web-browser"] = "",
    src = "https://cdn.jsdelivr.net/npm/mathjax@" .. context.mathjax .. "/tex-chtml.js"})
end

return M
