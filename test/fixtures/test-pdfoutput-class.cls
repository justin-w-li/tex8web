% The class of test-pdfoutput-sty.tex, as a template written for pdflatex:
% it sets \pdfoutput=1, then loads article and graphicx without a driver
% option.
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{test-pdfoutput-class}[2026/11/16 tex8web test class]
\pdfoutput=1
\LoadClass{article}
\RequirePackage{graphicx}
