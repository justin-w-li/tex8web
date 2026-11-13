# CLAUDE.md

tex8web turns LaTeX documents into static web pages that look like their PDF and are easy to read on any screen, with almost no extra work for a writer used to TeX. tex8web is not a textbook platform. A change belongs in tex8web if it brings the page closer to the PDF or makes the page easier to read. Do not make a change only because it is possible.

Docs:

- README.md: what tex8web does
- DOCUMENTATION.md: use, configs, page behavior, and limitations
- CONTRIBUTING.md: architecture, tests, files, and releases

Before a non-trivial change, read the parts that cover it: "How it works" and "Files" in CONTRIBUTING.md for internals, DOCUMENTATION.md for what a writer or reader sees.

## Product

- Everything on the page comes from the document or helps readers read it.
- Minimal page controls, with quiet line icons. No branding, banners, hero sections, or call-to-action buttons, except the icon that links to the tex8web repository.
- No decorative styling: no gradients, glass effects, colored shadows, pill badges, emoji, or attention-seeking animation. A page that looks like a SaaS landing page is wrong.
- Motion only to explain a change, such as a drawer opening or a fade, and off under `prefers-reduced-motion`.
- Every page is complete with JavaScript off. JavaScript only adds to it.
- Nothing is fetched at runtime, except MathJax when the page is not prerendered.
- Pages work offline and when saved to disk.
- Support current Chrome, Safari, and Firefox. Newer CSS (`light-dark()`, `popover`, `@starting-style`) is allowed if older browsers lose only polish, never content.
- Propose a feature before you build it: see [Proposing a feature](CONTRIBUTING.md#proposing-a-feature).

## Stack

- make4ht and tex4ht: Lua passes in `lua/` and `tex8web.mk4`, TeX configuration in `tex/` and `tex8web.cfg`
- one hand-written stylesheet, `css/tex8web.css`
- vanilla JavaScript in `js/`, with no build step or framework
- MathJax, pinned in `package.json` and prerendered in Node. Node is used only for prerendering and tests.

Rules for the stack:

- Use what exists before writing new code: tex4ht's `\Configure` hooks, browser built-ins, and existing helpers (`lua/tex8web/dom.lua`, `test/lib/chrome.mjs`). A small, well-known library that replaces much hand-written code is acceptable. Name it in the pull request or your report.
- Write only measurements from TeX, as `--tex8web-*` custom properties. Put static rules in the stylesheet.
- Name TeX commands `\Web*` if public and `\web@...` if internal.
- Put a fix in tex8web only if it helps any document. A fix that only one document needs goes in that document's config.

## Coding

### Before coding

- State your assumptions.
- If a request has several readings, present them. Do not pick one silently.
- If something is unclear, stop and ask.
- If a simpler approach exists, say so, and push back when warranted.

### Simplicity

- Write the minimum code that solves the problem.
- Nothing speculative: no unrequested features, configurability, or abstractions for single-use code. A case is real when some document reproduces it, even if the documents at hand do not use it. A short document in `examples/` with a check on it is enough.
- No error handling for impossible cases.
- If 200 lines could be 50, rewrite them. Would a senior engineer call the code overcomplicated?

### Scope of a change

- Every changed line traces to the task.
- Match the surrounding style.
- Do not refactor what is not broken, or "improve" adjacent code.
- Remove what your change made unused. Mention other dead code instead of deleting it.

### Comments

Comment only what is not clear from the code:

- why something is done
- a surprising tex4ht, MathJax, or browser behavior, with its source (for example `html4.4ht`)
- a non-obvious invariant

Never restate the code, narrate, or describe removed code or past versions, unless the comment records a real failure to avoid. Never refer to the request behind the change. Keep comments short and plain.

### Guards

When a guard skips work, a test must fail: through `\web@needs`, a thrown error, or a check that counts its subjects.

## Writing

For docs, comments, and commit messages:

- One idea per sentence. Aim for about 20 words, and split anything over 35.
- No contractions. Always the Oxford comma.
- At most one parenthetical per sentence, never nested. Two sentences over a semicolon. No em or en dashes used as dashes.
- Numbers: words up to nine, digits from 10, and digits with units or in code.
- The person building pages is "you". People visiting a page are "readers". Instructions are imperative.
- Things do not act or perceive. When the actor is a page, a browser, MathJax, a file, a script, or an option, use the passive or rephrase: "This choice is saved in the browser", not "The browser saves this choice". Use the active voice for you, a reader, or tex8web. In code comments, a program may act: "tex4ht drops the title".
- Plain, specific words. Never "just", "simply", or "easily". Use the noun when "it", "this", or "gets" would be unclear. No filler "own".
- One name per concept, everywhere: always "table of contents", always "config".
- No metaphors for technical parts: no "bridge", "chrome" (say "controls"), "wins", or "under the hood".
- No slogans, sentences that announce structure, puffery ("crucial", "robust", "ensures"), "not X but Y" contrasts, summary sentences, or transitions such as "Additionally".
- Headings in sentence case, as gerunds or nouns. Bold only for labels in reference lists.
- End full-sentence list items with a period, and fragments with nothing.
- In DOCUMENTATION.md, write only what a user acts on: what they see, what to do, and how to change it. Put mechanism in CONTRIBUTING.md, and thresholds, timings, and edge cases in tests.
- Say a thing once, where it belongs, and link to it elsewhere.
- Never name private documents in code, tests, docs, or commits. Say "a long document".
- Commits: a subject of at most 72 characters, without a final period, saying what the page or tool now does (`Review fixes: …` is fine). Then a blank line, and a body wrapped at 72 that says why, and which check covers the change.

## Process

- Work toward checks that can pass or fail. Fix a bug by writing a test that reproduces it and making it pass. Split multi-step work into milestones, each with its check, and commit each once verified.
- Before committing, and before opening a pull request, run the checks in [Which checks to run](CONTRIBUTING.md#which-checks-to-run).
- For screenshots, a comparison of two builds, or a measurement, use `node test/shots.mjs` ([Commands](CONTRIBUTING.md#commands)). Extend it instead of writing a separate script.
- At each milestone, or more often for risky changes, have a subagent with no context review the diff as a senior engineer, for correctness and cleanliness. Give it the diff and the files, not your conclusions. Fix what is warranted, and say what you did not fix and why in the pull request or your report.
- Match the process to the change. The full cycle above is for features and for changes to TeX, Lua, or MathJax internals. A small UI tweak, such as a CSS value, a timing, a comment, or a few lines of JavaScript, gets a lighter loop:
  - no reviewer
  - one targeted measurement or screenshot of the tweak (`shots.mjs --eval` or `--clip`). Rebuild only a small test document that shows the tweak, with `node test/run.mjs <name>`. When only `js/tex8web-page.js` changed, copy the file next to a built page.
  - `npm test`, then a commit. Batch several tweaks per commit.
  - `npm run test:visual`, and `npm run regress` on your documents, once at the end of a batch
- Change `test/` or the dev loop only for a failure that happened or a cost you measured. Report a risk you only foresee, and do not code for it.
  - A change to the test tools needs a reviewer only if it touches locks, build slots, or process lifetimes.
- Keep the docs true. Update DOCUMENTATION.md when behavior or limitations change, and CONTRIBUTING.md when internals, tests, or files change. Put known gaps in `test/expected.json`.
