-- web: the page around the text: links to headings and theorems, the PDF,
-- and meta tags for link previews.
local dom = require "web.dom"

local M = {}

local function permalink(el, id)
  local a = el:create_element("a", {class = "web-permalink", href = "#" .. id,
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

-- a # before each heading and each theorem's head, which links to it
-- (make4ht later gives headings ids from their titles, and rewrites links
-- to their anchors to those)
function M.permalinks(document)
  local heads = document:query_selector(".newtheorem span.head")
  for level = 2, 6 do
    for _, heading in ipairs(document:query_selector("h" .. level)) do heads[#heads + 1] = heading end
  end
  for _, head in ipairs(heads) do
    local id = anchor(head)
    if id then permalink(head, id) end
  end
end

-- \WebPDF (web-page.tex): a link to the PDF, which web.mk4 copies next to
-- the page, after the title
function M.pdf_link(document, parameters)
  local meta = document:query_selector("meta[name='web-pdf']")[1]
  if not meta then return end
  meta:remove_node()
  local body = document:query_selector("body")[1]
  local p = body:create_element("p", {class = "web-pdf"})
  local a = p:create_element("a", {href = parameters.input .. ".pdf"})
  a:add_child_node(a:create_text_node("View as PDF"))
  p:add_child_node(a)
  local title = document:query_selector("div.maketitle")[1]
  if title then
    title:add_child_node(p)
  else
    dom.set_children(body, {p, table.unpack(body:get_children())})
  end
end

-- the abstract's text, with the math's source, in at most about 200
-- characters
local function abstract_text(document)
  local abstract = document:query_selector(".abstract")[1]
  if not abstract then return end
  local parts = {}
  for _, p in ipairs(abstract:query_selector("p")) do parts[#parts + 1] = p:get_text() end
  local text = table.concat(parts, " "):gsub("\\[()]", ""):gsub("%s+", " "):match("^%s*(.-)%s*$")
  if utf8.len(text) > 200 then
    text = text:sub(1, utf8.offset(text, 198) - 1):match("^(.*)%s") .. "…"
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
  if title then add("property", "og:title", title:get_text():match("^%s*(.-)%s*$")) end
  add("property", "og:type", "article")
  local description = abstract_text(document)
  if description and description ~= "" then
    add("name", "description", description)
    add("property", "og:description", description)
  end
end

return M
