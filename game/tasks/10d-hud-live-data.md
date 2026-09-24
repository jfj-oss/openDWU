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
