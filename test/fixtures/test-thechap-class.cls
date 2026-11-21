% A class built on book that numbers chapters in Roman numerals, for
% test-thechap-class.tex.
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{test-thechap-class}
\LoadClass{book}
\renewcommand\thechapter{\Roman{chapter}}
