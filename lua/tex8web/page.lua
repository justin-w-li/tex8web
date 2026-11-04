-- The page around the text: what tex8web-page.tex hands on, links to
-- headings, theorems and boxes, the controls (contents, PDF, theme) and the table
-- of contents beside the text, meta tags for link previews, and the
-- scripts.
local assets = require "tex8web.assets"
local dom = require "tex8web.dom"

local log = logging.new("tex8web")

local M = {}

local function trim(s)
  return s:match("^%s*(.-)%s*$")
end

-- tex8web-page.tex's build element, for the later passes: the PDF
-- (context.pdf), \contentsname (context.contents) and the \WebMathMacros
-- definitions (context.macros)
function M.build_data(document, context)
  local element = document:query_selector("script[type='text/x-tex8web-build']")[1]
  if not element then return end
  local pdf = element:get_attribute("data-pdf")
  context.pdf = pdf ~= "" and pdf or nil
  context.contents = element:get_attribute("data-contents")
  context.macros = element:get_text()
  element:remove_node()
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

-- a # before each heading, each theorem's head and each box's title, which
-- links to it (make4ht later gives headings ids from their titles, and
-- rewrites links to their anchors to those)
function M.permalinks(document)
  local heads = document:query_selector(".newtheorem span.head")
  for level = 2, 6 do
    for _, heading in ipairs(document:query_selector("h" .. level)) do heads[#heads + 1] = heading end
  end
  for _, head in ipairs(heads) do
    local id = anchor(head)
    if id then permalink(head, id) end
  end
  -- (a box's anchors are before its title, in the box; with a label
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

-- an id for each term (\WebTerm's), for the contents' filter to link to:
-- term-<its text>, without its math, which would show its source (and
-- with letters beyond ASCII, as make4ht's ids for headings have them)
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
  contents = '<path d="M4 6h16M4 12h16M4 18h10"/>',
  pdf = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>'
    .. '<path d="M14 3v5h5M9 13h6M9 17h4"/>',
  theme = '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  -- (Feather's, MIT License; at 80%, with the others' stroke, as it fills
  -- the box)
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

-- whether a list of tex4ht's is the table of contents: \listoffigures and
-- \listoftables make a div.tableofcontents too, of lofToc and lotToc
-- entries
local function holds_contents(list)
  for _, entry in ipairs(dom.elements(list)) do
    for _, level in ipairs({"part", "chapter", "section", "paragraph"}) do
      if dom.has_class(entry, "^%a*" .. level .. "Toc$") then return true end
    end
  end
end

-- the table of contents (tex4ht's, from \tableofcontents) out of the text,
-- into a sidebar, which on a narrow screen is a drawer (a popover, which
-- the contents button opens); with the unnumbered heading above it, or the
-- box around it if it's all the box holds, or titled \contentsname.
-- Returns the sidebar and its title
local function contents(document, body, title)
  local list
  for _, candidate in ipairs(document:query_selector("div.tableofcontents")) do
    if holds_contents(candidate) then list = candidate break end
  end
  if not list then return end
  local heading = dom.previous_element(list)
  if heading and dom.has_class(heading, "^like%a*Head$") then
    title = trim(heading:get_text())
    heading:remove_node()
  end
  local content = list:get_parent()
  local box = dom.has_class(content, "^tcolorbox%-content$") and content:get_parent()
  if box and #dom.elements(content) == 1 then
    local box_title = box:query_selector(".tcolorbox-title")[1]
    if box_title then title = trim(box_title:get_text()) end
    box:remove_node()
  else
    list:remove_node()
  end
  local nav = body:create_element("nav", {id = "tex8web-toc", class = "tex8web-toc",
    popover = "auto", ["aria-labelledby"] = "tex8web-toc-title"})
  local p = nav:create_element("p", {id = "tex8web-toc-title", class = "tex8web-toc-title"})
  p:add_child_node(p:create_text_node(title))
  nav:add_child_node(p)
  -- (it needs tex8web-page.js, which says what it finds)
  nav:add_child_node(nav:create_element("input", {type = "search", class = "tex8web-toc-filter"}))
  nav:add_child_node(list)
  return nav, title
end

-- the controls at the top left: the table of contents (as a drawer, on a
-- narrow screen; hidden or shown, on a wide one), the PDF (\WebPDF),
-- copied next to the page, the theme, which needs tex8web-page.js, and
-- tex8web's repository, and on a narrow screen the section being read,
-- which tex8web-page.js fills in and which opens the table of contents
-- too; then the table of contents
function M.controls(document, context)
  local body = document:query_selector("body")[1]
  local controls = body:create_element("div", {class = "tex8web-controls"})
  local toc, title = contents(document, body, context.contents)
  if toc then
    control(controls, "contents", {class = "tex8web-control tex8web-contents", type = "button",
      popovertarget = "tex8web-toc", title = title, ["aria-label"] = title})
  end
  if context.pdf then
    if lfs.attributes(context.pdf) == nil then
      log:warning("\\WebPDF: no " .. context.pdf .. "; build the PDF first")
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
    -- (or LuaXML writes <button/>, which HTML reads as an open tag)
    where:add_child_node(where:create_text_node(""))
    controls:add_child_node(where)
  end
  local children = {controls, toc}
  for _, child in ipairs(body:get_children()) do children[#children + 1] = child end
  dom.set_children(body, children)
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

-- og:title and og:type, and from the abstract, if there is one, the
-- description
function M.meta_tags(document)
  local head = document:query_selector("head")[1]
  local title = document:query_selector("title")[1]
  local function add(attribute, name, content)
    head:add_child_node(head:create_element("meta", {[attribute] = name, content = content}))
  end
  if title then add("property", "og:title", trim(title:get_text())) end
  add("property", "og:type", "article")
  local description = abstract_text(document)
  if description and description ~= "" then
    add("name", "description", description)
    add("property", "og:description", description)
  end
end

-- tex8web-head.js (the reader's theme, before the page is drawn) and
-- tex8web-page.js (the theme button, the table of contents' tracking);
-- and for MathJax in the browser, MathJax and tex8web.js, which configures
-- it from tex8web-config (marked for prerender.mjs, which removes them)
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
  script({src = "tex8web-head.js"})
  script({src = "tex8web-page.js", defer = "defer"})
  script({src = "tex8web.js", ["data-tex8web-browser"] = ""})
  script({async = "async", id = "MathJax-script", ["data-tex8web-browser"] = "",
    src = "https://cdn.jsdelivr.net/npm/mathjax@" .. context.mathjax .. "/tex-chtml.js"})
end

return M
