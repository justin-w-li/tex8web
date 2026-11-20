% Case 11: a class on TEXINPUTS reads a file in a subfolder of its folder with the primitive \input.
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{test-texinpkg-class}[2026/11/20 tex8web test class]
\LoadClass{article}
\input sub/glossary
