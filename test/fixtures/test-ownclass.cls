% A class for test-ownclass.tex: one tex4ht has no .4ht for, and that loads
% no standard class, with sections of its own from \@startsection.
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{test-ownclass}[2026/11/06 tex8web test class]
\renewcommand\normalsize{\fontsize{10}{12}\selectfont}
\newcommand\small{\fontsize{9}{11}\selectfont}
\newcommand\footnotesize{\fontsize{8}{9.5}\selectfont}
\newcommand\large{\fontsize{12}{14}\selectfont}
\newcommand\Large{\fontsize{14.4}{18}\selectfont}
\newcommand\LARGE{\fontsize{17.28}{22}\selectfont}
\newcommand\huge{\fontsize{20.74}{25}\selectfont}
\newcommand\Huge{\fontsize{24.88}{30}\selectfont}
\normalsize
\setlength\textwidth{345pt}
\setlength\textheight{550pt}
\setlength\parindent{15pt}
\setlength\leftmargini{25pt}
\def\@listi{\leftmargin\leftmargini \parsep 4pt \topsep 8pt \itemsep 4pt}
\let\@listI\@listi
\newcounter{section}
\newcounter{subsection}[section]
\renewcommand\thesection{\arabic{section}}
\renewcommand\thesubsection{\thesection.\arabic{subsection}}
\newcommand\section{\@startsection{section}{1}{\z@}{-3.5ex}{2.3ex}{\normalfont\Large\bfseries}}
\newcommand\subsection{\@startsection{subsection}{2}{\z@}{-3.25ex}{1.5ex}{\normalfont\large\bfseries}}
\setcounter{secnumdepth}{2}
\pagenumbering{arabic}
