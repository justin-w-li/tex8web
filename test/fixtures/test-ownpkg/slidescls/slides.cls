% A class of the writer's for lecture slides, named like the tree's
% slides.cls, with a slide environment with a title.
\ProvidesClass{slides}[2024/01/15 v1.0 lecture slides]
\LoadClass{article}
\newenvironment{slide}[1]{\par\textbf{Slide: #1}\par}{\par\textit{End of the slide.}\par}
