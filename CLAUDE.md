# CLAUDE.md

tex8web turns LaTeX documents into static web pages that look like their PDF and read well on any screen, with almost no extra work from someone used to writing TeX. It is not a textbook platform. A change belongs here if it brings the page closer to the PDF or makes it easier to read; "we could" is not a reason. README.md says what tex8web does, DOCUMENTATION.md how to use it (configs, behavior, limitations), and CONTRIBUTING.md how it works (architecture, tests, files, releases). Before a non-trivial change, read the parts that cover it: CONTRIBUTING's "How it works" and "Files" for internals, DOCUMENTATION for what a writer or reader sees.

## Product

- **The PDF is the reference.** Everything on the page comes from the document or helps in reading it. The page chrome stays minimal (quiet line icons): no branding, banners, hero sections or call-to-action buttons. The one exception is the icon linking to tex8web's repository.
- **No decorative styling:** no gradients, glass, colored shadows, pill badges, emoji, or attention-seeking animation. If it looks like a SaaS landing page, it's wrong. Motion only explains a change (a drawer opening, a fade), and is off under `prefers-reduced-motion`.
- **Static and fast.**
  - Every page reads fully with JavaScript off; JS only enhances it.
  - Nothing is fetched at runtime except MathJax, when the page isn't prerendered.
  - Pages work offline and saved.
- **Browsers:** current Chrome, Safari and Firefox. Newer CSS (`light-dark()`, `popover`, `@starting-style`) is fine if older browsers still get a readable page: they lose polish, never content.
- **Features need approval.** Propose one with a sentence on how it improves reading, and build it only once the user agrees. This includes new options (`\Web*` macros, page controls). Fixes that bring the page closer to the PDF don't need approval.

## Stack

- **The stack:**
  - make4ht/tex4ht: Lua passes in `lua/` and `tex8web.mk4`, TeX config in `tex/` and `tex8web.cfg`;
  - one hand-written stylesheet, `css/tex8web.css`;
  - vanilla JS with no build step or framework, in `js/`;
  - MathJax pinned in `package.json` and prerendered in Node. Node is only for prerendering and tests.
- **Don't reinvent the wheel.** Reach first for tex4ht's `\Configure` hooks, the browser's built-ins, and existing helpers (`lua/tex8web/dom.lua`, `test/lib/chrome.mjs`). A small, well-known library is acceptable when it replaces a lot of hand-written code; name it in the milestone report.
- **TeX measures, CSS styles.** TeX emits only measurements, as `--tex8web-*` custom properties; static rules live in the stylesheet. TeX names are `\Web*` (public) or `\web@` (internal).
- **Only generic fixes.** Nothing specific to one document belongs in tex8web; that goes in the document's own `.cfg`.

## Coding

**Think first.**
- State your assumptions.
- If a request has several readings, present them; don't pick one silently.
- If something is unclear, stop and ask.
- If a simpler approach exists, say so, and push back when it's warranted.

**Simplicity.**
- Write the minimum code that solves the problem.
- Nothing speculative: no unrequested features, configurability, or abstractions for single-use code.
- No error handling for impossible cases.
- If 200 lines could be 50, rewrite them. Ask: would a senior engineer call this overcomplicated?

**Surgical changes.** Every changed line should trace to the task.
- Match the surrounding style.
- Don't refactor what isn't broken, or "improve" adjacent code.
- Remove what your change made unused. Mention other dead code rather than deleting it.

**Comments** say only what the code can't:
- why something is done;
- a surprising tex4ht, MathJax or browser behavior, naming its source (e.g. `html4.4ht`);
- a non-obvious invariant.

Never restate the code, narrate, describe removed code or past versions (unless it records a real failure to avoid), or refer to the request that prompted the change. Keep comments short and plain: write like a senior engineer, not an LLM.

## Writing

Docs, comments and commit messages are read by strangers.
- One idea per sentence. Aim for 20 words; split anything over 35.
- At most one parenthetical per sentence, never one inside another. Don't stack clauses with commas and possessives.
- User docs say what a reader or writer sees or does. Thresholds, timings and edge cases belong in tests.
- Say a thing once, where it belongs, and link to it from elsewhere.
- Never name private documents, courses or notes in code, tests, docs or commits. Say "a long document".
- **Commits:** a subject of at most 72 characters, without a final period, saying what the page or tool now does (`Review fixes: …` is fine). Then a blank line and a body wrapped at 72 that says why, and which check covers it.

## Process

- **Work toward checks that can pass or fail.** "Fix the bug" means writing a test that reproduces it and making it pass. Split multi-step work into milestones, each with its check, and commit each milestone once it's verified.
- **Before committing:**
  - `npm test` passes.
  - `npm run test:visual` passes when the change touches the math path, where MathJax in Node and in the browser can diverge: `js/tex8web.js`, `js/prerender.mjs`, `tex/tex8web-math.tex`, the MathJax configuration in `tex/tex8web-page.tex`, `lua/tex8web/macros.lua`, `preamble.lua` and `source.lua`, the scripts in `page.lua`, and MathJax's version in `package.json`. Also when it touches `js/tex8web-page.js` or the stylesheet's picture viewer, whose mouse, touch and phone-width checks run only there. Otherwise, at the end of a batch and before merging.
  - A bug fix gets a test where practical: a Lua unit test in `test/unit/`, or a fixture check in `test/run.mjs`.
  - Visual changes are checked in headless Chrome screenshots, wide and narrow, light and dark, next to the PDF: `node test/shots.mjs`, which also compares two builds, shoots just one element's band (`--clip`), and prints a measurement (`--eval`). Extend it rather than writing a script of your own.
- **Review at milestones.** At each milestone, or more often for risky changes, a fresh senior-engineer subagent with no context reviews the diff for correctness and cleanliness. Give it the diff and the files, not your conclusions. Fix what's warranted, and report what you didn't fix and why.
- **Match the process to the change.** The full cycle above (milestones, review, every check) is for features and for changes to TeX, Lua or MathJax internals. A small UI tweak (a CSS value, a timing, a comment, a few lines of JS) gets a light loop instead:
  - no reviewer, and no rebuild of every document per iteration;
  - verify the tweak itself: one targeted measurement or screenshot (`shots.mjs --eval` or `--clip`), rebuilding only the page that shows it (a small test document, `node test/run.mjs <name>`; a change to `js/tex8web-page.js` alone can be copied next to a built page);
  - `npm test`, then commit; batch several tweaks per commit;
  - run `npm run test:visual` and the full rebuild once, at the end of a batch.
- **Keep the docs true.**
  - `DOCUMENTATION.md` changes when behavior or limitations do, and `CONTRIBUTING.md` when internals, tests or files do.
  - Known gaps go in `test/expected.json`.
