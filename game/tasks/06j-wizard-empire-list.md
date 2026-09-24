# Task 06j — Wizard "Other Empires": manual per-empire list

thinking: off
scope: locked

Edit `src/ui/screens/newGameWizard.ts` (+css), `src/sim/startGameOptions.ts`, and `toCreateGameOptions` (06i) mapping, tests. Do not edit other `src/sim/` files. Start editing right away.

Resolve `TODO(port): manual per-empire editing` (~line 732): below the auto-generate controls add an editable list of AI empires — rows with Race (dropdown of playable races), Government (dropdown), Name (text, default "<Race> <Government-style suffix>" or "<Race> Empire"), and a remove ✕; an "Add empire" button (max = the auto-generate empire count limit on the page). When the list is non-empty it overrides auto-generation for those slots (store as `StartGameOptions.otherEmpires.manual: {race, governmentId, name}[]`); pass them through `toCreateGameOptions` if `CreateGameOptions` has a field for explicit AI empire starts (read `src/sim/game.ts` `EmpireStartOptions`); otherwise store + `// TODO(createGame)`.
Tests: add/remove/round-trip; mapping to CreateGameOptions when supported.
`npm run typecheck` && `npm test`. Append `## Worker report`.
