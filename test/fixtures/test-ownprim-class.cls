% The class of test-ownprim-class.tex, beside the document. After the
% standard class, it reads a file of the document in a subfolder with the
% primitive \input, and an option file of its own beside it, which reads
% another such file with the primitive \input.
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{test-ownprim-class}[2026/11/18 tex8web test class]
\LoadClass{article}
\input test-ownprim/glossary
\input{test-ownprim-class10.clo}
