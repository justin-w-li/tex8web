% A class of the writer's for exams, named like the tree's exam.cls.
\ProvidesClass{exam}[2024/03/01 v1.0 course exams]
\LoadClass{article}
\newcounter{question}
\newenvironment{questions}{\par}{\par}
\newcommand\question{\par\stepcounter{question}\textbf{Question \thequestion.}\ }
