% Each entry as a \bibitem with its title, and nothing else.
ENTRY { title } {} {}
FUNCTION {misc} { "\bibitem{" cite$ * "}" * write$ newline$ title write$ newline$ }
FUNCTION {default.type} { misc }
READ
FUNCTION {begin} { "\begin{thebibliography}{1}" write$ newline$ }
FUNCTION {end} { "\end{thebibliography}" write$ newline$ }
EXECUTE {begin}
ITERATE {call.type$}
EXECUTE {end}
