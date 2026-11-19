% A numeric style written for these tests: each \bibitem has no
% author-year data, and the document names it as ./numeric.
ENTRY { author title publisher year } {} {}
FUNCTION {book}
{ newline$
  "\bibitem{" cite$ * "}" * write$ newline$
  author "." * write$ newline$
  "\newblock {\em " title * "}." * write$ newline$
  "\newblock " publisher * ", " * year * "." * write$ newline$
}
FUNCTION {default.type} { book }
READ
FUNCTION {begin.bib} { "\begin{thebibliography}{9}" write$ newline$ }
EXECUTE {begin.bib}
ITERATE {call.type$}
FUNCTION {end.bib} { newline$ "\end{thebibliography}" write$ newline$ }
EXECUTE {end.bib}
