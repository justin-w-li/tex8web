% The class of test-pdfprim-hyperref.tex: article, with a map file loaded
% as the class loads, and a title that holds \pdfliteral (tex4ht replaces
% \maketitle, so the class sets the title).
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{test-pdfprim}[2026/11/17 tex8web test class]
\pdfmapfile{+cls.map}
\LoadClass{article}
\title{Title: before\pdfliteral{0 g} after.}
\author{}
\date{}
