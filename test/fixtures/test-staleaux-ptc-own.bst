ENTRY { author title } {} {}
FUNCTION {book}
{ "\bibitem{" cite$ * "}" * write$ newline$
  author ". From the style of the document: " * title * "." * write$ newline$ }
FUNCTION {default.type} { book }
READ
FUNCTION {begin.bib} { "\begin{thebibliography}{1}" write$ newline$ }
EXECUTE {begin.bib}
ITERATE {call.type$}
FUNCTION {end.bib} { newline$ "\end{thebibliography}" write$ newline$ }
EXECUTE {end.bib}
