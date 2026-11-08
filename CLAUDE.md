# CLAUDE.md

tex8web turns LaTeX documents into static web pages that look like their PDF and are easy to read on any screen. A writer used to TeX needs almost no extra work. tex8web is not a textbook platform. A change belongs in tex8web if it brings the page closer to the PDF or makes the page easier to read. Do not make a change only because it is possible.

What tex8web does is in README.md. How to use it is in DOCUMENTATION.md: configs, page behavior, and limitations. How it works is in CONTRIBUTING.md: architecture, tests, files, and releases. Before a non-trivial change, read the parts that cover it: "How it works" and "Files" in CONTRIBUTING.md for internals, and DOCUMENTATION.md for what a writer or reader sees.

## Product

- Everything on the page comes from the document or helps readers read it.
- Page controls are minimal, with quiet line icons. No branding, banners, hero sections, or call-to-action buttons. The one exception is the icon that links to the tex8web repository.
- No decorative styling: no gradients, glass effects, colored shadows, pill badges, emoji, or attention-seeking animation. A page that looks like a SaaS landing page is wrong.
- Motion is used only to explain a change, for example a drawer opening or a fade. Motion is off under `prefers-reduced-motion`.
- Every page is complete with JavaScript off. JavaScript is used only to add to the page.
- Nothing is fetched at runtime, except MathJax when the page is not prerendered.
- Pages work offline and when saved to disk.
- The supported browsers are current Chrome, Safari, and Firefox. Newer CSS (`light-dark()`, `popover`, `@starting-style`) is allowed if the page is still readable in older browsers. In older browsers, polish may be lost, never content.
- Propose a feature to a maintainer before you build it, as described in [Proposing a feature](CONTRIBUTING.md#proposing-a-feature).

## Stack

- make4ht and tex4ht: Lua passes in `lua/` and `tex8web.mk4`, TeX configuration in `tex/` and `tex8web.cfg`
- one hand-written stylesheet, `css/tex8web.css`
- vanilla JavaScript in `js/`, with no build step or framework
- MathJax, pinned in `package.json` and prerendered in Node. Node is used only for prerendering and tests.

Rules for the stack:

- Use what exists before writing new code: the `\Configure` hooks of tex4ht, browser built-ins, and existing helpers (`lua/tex8web/dom.lua`, `test/lib/chrome.mjs`). A small, well-known library is acceptable when it replaces a lot of hand-written code. Name it in the pull request or your report.
- Only measurements are written from TeX, as `--tex8web-*` custom properties. Static rules go in the stylesheet.
- TeX names are `\Web*` for public commands and `\web@...` for internal ones.
- A fix goes in tex8web only if it helps any document. A fix that only one document needs goes in that document's config.

## Coding

### Before coding

- State your assumptions.
- If a request has several readings, present them. Do not pick one silently.
- If something is unclear, stop and ask.
- If a simpler approach exists, say so, and push back when warranted.

### Simplicity

- Write the minimum code that solves the problem.
- Nothing speculative: no unrequested features, configurability, or abstractions for single-use code. A case is real when it is reproduced in some document, even if the documents at hand do not use it. A short document in `examples/`, with a check that runs on it, is enough to make a case real.
- No error handling for impossible cases.
- If 200 lines could be 50, rewrite them. Ask whether a senior engineer would call the code overcomplicated.

### Scope of a change

- Every changed line traces to the task.
- Match the surrounding style.
- Do not refactor what is not broken, or "improve" adjacent code.
- Remove what your change made unused. Mention other dead code instead of deleting it.

### Comments

Comments are only for what is not clear from the code:

- why something is done
- a surprising tex4ht, MathJax, or browser behavior, with its source (for example `html4.4ht`)
- a non-obvious invariant

Never restate the code, narrate, or describe removed code or past versions, unless the comment records a real failure to avoid. Never refer to the request behind the change. Keep comments short and plain.

### Guards

When a guard skips work, a test must fail: through `\web@needs`, a thrown error, or a check that counts its subjects.

## Writing

Docs, comments, and commit messages are read by strangers. These rules apply to all of them.

- Short sentences, one idea each. Aim for about 20 words, and split anything over 35.
- No contractions. Always use the Oxford comma.
- At most one parenthetical per sentence, never nested. Prefer two sentences over a semicolon. No em or en dashes used as dashes.
- Numbers in words up to nine and in digits from 10. Always digits with units or in code.
- The person building pages is "you". People visiting a page are "readers". Instructions are imperative.
- Things do not act or perceive. When the actor is a page, a browser, MathJax, a file, a script, or an option, use the passive or rephrase: "This choice is saved in the browser", not "The browser saves this choice". Use the active voice when the actor is you, a reader, or tex8web.
- In code comments, a program may be the actor: "tex4ht drops the title" and "MathJax clips each character" are fine. The other rules apply to comments too.
- Plain, specific words. Never "just", "simply", or "easily". Use the noun in place of "it", "this", or "gets" when the referent is unclear. Avoid "own" as filler.
- One name per concept, everywhere: always "table of contents", always "config".
- No metaphors for technical parts: no "bridge", "chrome" (say "controls"), "wins", or "under the hood".
- No aphorisms or slogans, sentences that announce structure, puffery ("crucial", "robust", "ensures"), "not X but Y" contrasts, summary sentences, or transitions such as "Additionally".
- Headings in sentence case, as gerunds or nouns. No bold for emphasis. Bold labels only in reference lists.
- List items that are fragments have no end punctuation. Items that are full sentences end with a period.
- DOCUMENTATION.md says only what a user acts on: what they see, what to do, and how to change it. Mechanism goes in CONTRIBUTING.md. Thresholds, timings, and edge cases belong in tests.
- Say a thing once, where it belongs, and link to it elsewhere.
- Never name private documents, courses, or notes in code, tests, docs, or commits. Say "a long document".
- Commits: a subject of at most 72 characters, without a final period, saying what the page or tool now does (`Review fixes: …` is fine). Then a blank line, and a body wrapped at 72 that says why, and which check covers the change.

## Process

- Work toward checks that can pass or fail. To fix a bug, write a test that reproduces it and make the test pass. Split multi-step work into milestones, each with its check, and commit each milestone once it is verified.
- Before committing:
  - `npm test` passes.
  - `npm run test:visual` passes when the change touches a file listed in CONTRIBUTING.md's [Which checks to run](CONTRIBUTING.md#which-checks-to-run). Otherwise, run it at the end of a batch and before opening a pull request.
  - A bug fix has a test where practical: a Lua unit test in `test/unit/`, or a fixture check in `test/run.mjs`.
  - Visual changes are checked in headless Chrome screenshots, wide and narrow, light and dark, next to the PDF, with `node test/shots.mjs`. With the same tool, you can also compare two builds, shoot the band of one element (`--clip`), and print a measurement (`--eval`). Extend `shots.mjs` instead of writing a separate script.
- Review at milestones. At each milestone, or more often for risky changes, have a fresh subagent with no context review the diff for correctness and cleanliness, as a senior engineer. Give it the diff and the files, not your conclusions. Fix what is warranted. In the pull request or your report, say what you did not fix and why.
- Match the process to the change. The full cycle above, with milestones, review, and every check, is for features and for changes to TeX, Lua, or MathJax internals. A small UI tweak, for example a CSS value, a timing, a comment, or a few lines of JavaScript, takes a lighter loop:
  - no reviewer
  - one targeted measurement or screenshot of the tweak (`shots.mjs --eval` or `--clip`). Rebuild only the page that shows the tweak: a small test document, with `node test/run.mjs <name>`. When only `js/tex8web-page.js` changed, copy the file next to a built page.
  - `npm test`, then a commit. Batch several tweaks per commit.
  - `npm run test:visual` once, at the end of a batch. Compare your documents with `npm run regress` then too.
- Change `test/` or the dev loop only for a failure that happened or a cost you measured. Put a risk you only foresee in the pull request or your report, not in code.
  - A change to the test tools needs a reviewer only if it touches locks, build slots, or process lifetimes.
  - The checks for a change to the test tools are `npm test`, plus `npm run test:visual` if the change touches `chrome.mjs`, `shots.mjs`, or `visual.mjs`.
- Keep the docs true.
  - Update DOCUMENTATION.md when behavior or limitations change, and CONTRIBUTING.md when internals, tests, or files change.
  - Known gaps go in `test/expected.json`.
