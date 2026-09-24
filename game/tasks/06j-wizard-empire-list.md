# Task 06j — Wizard "Other Empires": manual per-empire list

thinking: off
scope: locked

Edit `src/ui/screens/newGameWizard.ts` (+css), `src/sim/startGameOptions.ts`, and `toCreateGameOptions` (06i) mapping, tests. Do not edit other `src/sim/` files. Start editing right away.

Resolve `TODO(port): manual per-empire editing` (~line 732): below the auto-generate controls add an editable list of AI empires — rows with Race (dropdown of playable races), Government (dropdown), Name (text, default "<Race> <Government-style suffix>" or "<Race> Empire"), and a remove ✕; an "Add empire" button (max = the auto-generate empire count limit on the page). When the list is non-empty it overrides auto-generation for those slots (store as `StartGameOptions.otherEmpires.manual: {race, governmentId, name}[]`); pass them through `toCreateGameOptions` if `CreateGameOptions` has a field for explicit AI empire starts (read `src/sim/game.ts` `EmpireStartOptions`); otherwise store + `// TODO(createGame)`.
Tests: add/remove/round-trip; mapping to CreateGameOptions when supported.
`npm run typecheck` && `npm test`. Append `## Worker report`.

## Worker report

**Files changed**
- `src/sim/startGameOptions.ts` — added `ManualEmpireStart {race, governmentId, name}` and `OtherEmpiresOptions.manual: ManualEmpireStart[]`; `defaultOtherEmpiresOptions()` starts with `manual: []`; `clampOtherEmpires` deep-copies rows; `toCreateGameOptions` maps a non-empty manual list to explicit `aiEmpires` entries (name '' → undefined, race '' → '(Random)', governmentId -1 or unknown → '(Random)' via `gameData.governments[id].name`) which overrides auto-generation sizing; empty list keeps the old count-based random generation. No `TODO(createGame)` needed — `CreateGameOptions.aiEmpires` (`EmpireStartOptions`) already supports explicit AI starts.
- `src/ui/screens/newGameWizard.ts` — `buildOtherEmpiresPage`: replaced the TODO(port) with an editable list below the "OR specify the starting empires below" label: one row per empire with Race `<select>` (playable races from `loadWizardRaceData()`, sorted by name), Government `<select>` ("(Random)" + `filterStartGovernments(loadWizardGovernments())`), Name text input (placeholder/default "<Race> Empire", re-derived on race change while still empty), and a remove ✕ button; an "Add empire" button capped at `OTHER_EMPIRES_COUNT_MAX` (100); preview line updated for both modes; Start-page summary now shows the manual list contents (or "N random" when autogenerate is off and no manual rows).
- `src/ui/screens/newGameWizard.css` — styles for `.wizard-empires-manual-wrap` (scrollable list panel), `.wizard-empires-row` (4-column grid), race/gov selects, name input, remove ✕ button, and add button.
- `test/startGameOptions.test.ts` — updated `defaultOtherEmpiresOptions` expectation (`manual: []`) and the `{autogenerate, empireCount}` literal; new tests: clamp deep-copy of manual rows, add/remove round-trip through `otherEmpires.manual`, deep-copy without aliasing, and `toCreateGameOptions` manual→aiEmpires mapping (resolved government names, '' race/name → '(Random)'/undefined, manual list overriding `empireCount`, empty list keeping count-based sizing).

**Verification**
- `npm run typecheck` — clean.
- `npm test` — 475/475 passed (40 files).
- Headless screenshot of the Other Empires page saved to `shots/06j-empires-manual.png` (no console errors printed).

**Left undone / notes**
- The original's per-empire home-system picker is not ported (out of scope per task: race/government/name only); manual empires use `homeSystemFavourability: 'Normal'` + `proximityDistance: 'Random'`, same as auto-generated ones.
- A row whose stored race is not in the current install's playable list gets a fallback `<option>` so it still renders.
