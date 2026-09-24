# Task 12f — Tutorials list: show real step titles instead of invented descriptions

thinking: off
scope: locked

Edit only `src/sim/data/tutorials.ts`, `src/ui/screens/tutorials.ts` and `test/tutorials.test.ts`. Start editing right away.

The `description` strings in `TUTORIALS` (tutorials.ts ~line 172) were made up; they are not in the game. Replace them with real content taken from each tutorial file.

1. `tutorials.ts` (sim/data):
   - Remove the `description` field from `TutorialEntry` and from every entry. Fix the doc comment: it currently says descriptions summarize each topic.
   - Add `export function tutorialSummary(items: TutorialItem[], maxLength = 140): string`. It builds the distinct step `title`s in order, skipping empty titles and exact repeats, joined with " · ". Cut it at the last whole title that fits in maxLength, and append " · …" when titles were dropped.
2. `tutorials.ts` (ui/screens, ~line 71): render `desc` empty at first. Then load the file: `void loadTutorialFile(entry.file).then((items) => { desc.textContent = tutorialSummary(items); }).catch(() => { desc.textContent = ''; })`.
3. Tests in test/tutorials.test.ts, using `parseTutorialItems` on this inline sample (the real format: title line, title line again, body lines, `~` separator):
```
Welcome
Welcome
Body one.
~
Introduction
Introduction
Body two.
~
Introduction
Introduction
Body three.
```
   - The summary of this sample is "Welcome · Introduction".
   - Truncation: with maxLength 10 the result is "Welcome · …".

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `src/sim/data/tutorials.ts` — removed `description` from `TutorialEntry` and all 11 entries; fixed the doc comment (descriptions now come from the file's step titles at runtime); added `tutorialSummary(items, maxLength = 140)` which joins distinct step titles in order (empty titles and exact repeats skipped) with " · ", cuts at the last whole title that fits, and appends " · …" when titles were dropped.
- `src/ui/screens/tutorials.ts` — each list row's `desc` starts empty and is filled via `void loadTutorialFile(entry.file).then((items) => { desc.textContent = tutorialSummary(items); }).catch(() => { desc.textContent = ''; })`.
- `test/tutorials.test.ts` — TUTORIALS test now checks only `displayName`; new `tutorialSummary` tests using the inline sample (title line repeated per step): full summary is `"Welcome · Introduction"` and with maxLength 10 it is `"Welcome · …"`.

Done: everything in the task. `npm run typecheck` passes; `npm test` passes (598 tests, 51 files).

Left undone: nothing. (No visual check performed — the screen needs a browser/dev server; the change is DOM-text-only.)
