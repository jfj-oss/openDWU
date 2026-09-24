# Task 06i — Wizard Start → createGame

thinking: off
scope: locked

Edit `src/ui/screens/newGameWizard.ts`, `src/sim/startGameOptions.ts`, `src/main.ts` (boot path only), tests. Do not edit other `src/sim/` files. Start editing right away.

`src/sim/game.ts` exports `createGame(options)` (read its options type first). Map `StartGameOptions` (all wizard pages) onto those options — galaxy shape/stars/dimensions/seed, player race/empire name/government/colours, number of AI empires from "Other Empires", aggression/difficulty/pirates/creatures/colony/alien-life converters (06f), victory settings — and call `createGame` from **Start Game**; fields `createGame` doesn't accept yet stay on the options object with a `// TODO(createGame)` note. Then boot the Main View + HUD with the returned galaxy/empires. Known limitation from C2: tech level must not be 0.5 ("Normal") yet — clamp the default to a supported value and note it. Store the created game in `window.__dwu.game`.
Tests: the mapping function `toCreateGameOptions(startOptions)` for defaults; seed passes through.
`npm run typecheck` && `npm test`. Append `## Worker report`.
