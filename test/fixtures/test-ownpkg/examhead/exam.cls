% A class of the writer's for exams, named like the tree's exam.cls, that
% defines the exam page style that exam.4ht tests, and no \scorebox.
\ProvidesClass{exam}[2024/03/01 v1.0 course exams]
\LoadClass{article}
\def\ps@examheadings{\let\@mkboth\@gobbletwo
  \def\@oddhead{}\def\@evenhead{}\def\@oddfoot{\hfil\thepage\hfil}\let\@evenfoot\@oddfoot}
\pagestyle{examheadings}
\newcounter{question}
\newenvironment{questions}{\par}{\par}
\newcommand\question{\par\stepcounter{question}\textbf{Question \thequestion.}\ }
