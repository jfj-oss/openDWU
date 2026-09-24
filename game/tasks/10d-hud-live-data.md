# Task 10d — HUD shows live empire data

thinking: off
scope: locked

Edit `src/ui/hud.ts` and `src/main.ts` (startGameView passes the game to the HUD), tests. Do not edit `src/sim/`. Start editing right away.

After a game starts (`startGameView(game)`):
- Top-right money panel: **Money** = the player empire's state money field, **Cashflow** and **Bonus Income** = the matching empire fields if they exist on `Empire` (`src/sim/empire.ts` — read it; if a field doesn't exist yet show `—` and a `TODO(sim)` comment). Format with thousands separators like the original (`641,607`, cashflow in parentheses with sign: `(+213,959)`). Refresh every 250 ms.
- Top-middle message list: push a first message `"<Empire name> founded at <capital name> (<system name> system)"` on game start; export `pushHudMessage(text)` for later systems; keep the last 5, newest at the bottom, like the original ticker.
- The empire flag button in the top row (`tbtnEmpires`/flag art) shows the player's flag shape (`/assets/dwu/images/ui/flagshapes/flagNN.png` from the wizard's StartGameOptions if present) tinted with the empire colour.
Pure tests: money formatting (`641607 → '641,607'`, `213959 → '(+213,959)'`, `-5000 → '(-5,000)'`), message ring buffer.
`npm run typecheck` && `npm test`; save (don't open) `shots/10d-hud.png` with `?autostart=1`. Append `## Worker report`.

## Worker report

**Files changed:**
- `src/ui/hud.ts` — money panel now refreshes live from the player empire; message ticker ring buffer + `pushHudMessage`; empires button shows the tinted flag shape; new pure helpers.
- `src/main.ts` — `startGameView` passes the game into `createHud` and pushes the founding message; `bootGameFromWizard` applies the wizard's chosen `flagShapeIndex` to the player empire (createGame doesn't forward it yet).
- `test/hud.test.ts` — pure tests for `formatMoney`/`formatCashflow` and the message ring buffer.

**Done:**
- Money panel: **Money** = `playerEmpire.stateMoney`, refreshed every 250 ms inside the HUD (self-contained interval, like the existing clock/system-name refreshers); formatted with thousands separators (`641,607`). **Cashflow** and **Bonus Income** show `—` with `TODO(sim)` comments — `Empire` has no such fields yet (only `stateMoney`/`privateMoney`).
- Message list: first message `<Empire name> founded at <capital name> (<system name> system)` pushed on game start (shared boot path, so wizard/autostart/save-load all get it); exported `pushHudMessage(text)` keeps the last 5, newest at the bottom, rendered into the five `.hud-message-line` slots bound in `createHud`.
- Empires button (`tbtnEmpires`): when a game is wired, the player's flag shape art (`flagNN.png` via `flagShapeUrl`) is overlaid on the chrome diplomacy button, tinted with the empire's main colour via a CSS `sepia/saturate/hue-rotate` filter (pure helper `colorHueRotate`). Wizard path uses the user's `flagShapeIndex`; autostart/fallback use the empire's dominant-race default `flagShape`; generateGalaxy-only boot (no game object) falls back to the plain chrome button.
- Verification: `npm run typecheck` clean; `npm test` 460/460 pass (40 files). Screenshot saved to `shots/10d-hud.png` (`?autostart=1`, headless via `scripts/shot.mjs` — no console errors printed).

**Left undone / notes:**
- Cashflow and Bonus Income remain `—` until the sim economy port adds those `Empire` fields (`TODO(sim)` markers in `buildMoneyPanel`).
- The wizard's flag *colours* (`primaryColor`/`secondaryColor`) are not applied to the empire yet (existing `TODO(createGame)` in `startGameOptions.ts`); the tint uses the empire's generated `mainColor` instead. Only `flagShapeIndex` is forwarded (set on `game.playerEmpire.flagShape` in `bootGameFromWizard`).
- Flag tinting approximates the original's two-colour flag rendering with a single hue-rotate of the monochrome shape art; a true primary/secondary composite would need the colours on the empire.
