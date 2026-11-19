% A style written for these tests: the item of able has author-year data
% for natbib, and every other item has none.
ENTRY { author title publisher year } {} {}
FUNCTION {book}
{ newline$
  cite$ "able" =
    { "\bibitem[Able(1999)]{" }
    { "\bibitem{" }
  if$
  cite$ * "}" * write$ newline$
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
