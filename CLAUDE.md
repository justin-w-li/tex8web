# CLAUDE.md

tex8web turns LaTeX notes into static web pages that look like their PDF and read well on any screen, with almost no extra work from someone used to writing TeX. It is not a textbook platform. A change belongs here if it brings the page closer to the PDF or makes it easier to read; "we could" is not a reason. README.md says what tex8web does and DOCUMENTATION.md how (architecture, files, tests, limitations). Read them before any non-trivial change.

## Product

- **The PDF is the reference.** Everything on the page comes from the document or helps in reading it. The page chrome stays minimal (quiet line icons): no branding, banners, hero sections or call-to-action buttons.
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

## Process

- **Work toward checks that can pass or fail.** "Fix the bug" means writing a test that reproduces it and making it pass. Split multi-step work into milestones, each with its check, and commit each milestone once it's verified.
- **Before committing:**
  - `npm test` and `npm run test:visual` pass.
  - A bug fix gets a test where practical: a Lua unit test in `test/unit/`, or a fixture check in `test/run.mjs`.
  - Visual changes are checked in headless Chrome screenshots, wide and narrow, light and dark, next to the PDF. Use `test/lib/chrome.mjs`, which deletes its profile.
- **Review at milestones.** At each milestone, or more often for risky changes, a fresh senior-engineer subagent with no context reviews the diff for correctness and cleanliness. Give it the diff and the files, not your conclusions. Fix what's warranted, and report what you didn't fix and why.
- **Keep the docs true.**
  - `DOCUMENTATION.md` changes when behavior, files or limitations do.
  - Known gaps go in `test/expected.json`.
