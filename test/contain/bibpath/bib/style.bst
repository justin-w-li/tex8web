% The least a style needs: each entry as \bibitem and its title.
ENTRY { title } {} {}
FUNCTION {misc} { "\bibitem{" cite$ * "}" * write$ newline$ title write$ newline$ }
FUNCTION {default.type} { misc }
READ
FUNCTION {begin} { "\begin{thebibliography}{9}" write$ newline$ }
FUNCTION {end} { "\end{thebibliography}" write$ newline$ }
EXECUTE {begin}
ITERATE {call.type$}
EXECUTE {end}
