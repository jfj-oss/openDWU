# Task 07b — Wire galaxy time into the HUD and the map

thinking: off
scope: locked

Everything you need is here. Edit `src/main.ts`, `src/sim/clock.ts`, `src/ui/hud.ts`, tests. Read those files and `src/sim/galaxyTime.ts` first. Start editing right away.

`src/sim/galaxyTime.ts` (task 07a) provides `GalaxyTime` (`advance(realDtMs): number` → game ms advanced, 0 when paused; `currentStarDate`; `faster()`/`slower()` ×2/÷2 clamped to 0.25–4; `togglePause()`; `paused`; `speed`), `resolveStarDateDescription(starDate)`, `START_STAR_DATE`. `Galaxy.step(gameMs)` advances planet/moon orbits.

1. Replace the HUD's `GameClock` (`src/sim/clock.ts`, speeds up to 8×) with a `GalaxyTime` instance (`new GalaxyTime(START_STAR_DATE)`, starts paused, speed 1). Delete `GAME_SPEEDS`/`stepSpeed` or make `clock.ts` re-export `GalaxyTime`; update its tests (max speed is now 4, min 0.25).
2. Top-left bar: ▶/⏸ calls `togglePause()`, − / + call `slower()` / `faster()`, spacebar toggles pause. The label shows `resolveStarDateDescription(time.currentStarDate) + ' (' + speed + 'x)'`, e.g. `2100.01.01 (1x)` (format speed 0.25/0.5 as `¼x`/`½x`), refreshed every frame or every 250 ms.
3. Each render frame (Pixi `app.ticker`): `const gameMs = time.advance(ticker.deltaMS); if (gameMs > 0) galaxy.step(gameMs);`. The Main View already draws planets from `habitat.orbitAngle`/`orbitDistance` relative to their star — confirm it reads them every frame (not cached at build time); if cached, update the positions in its per-frame update.
4. Test (pure): a helper `formatClockLabel(starDate, speed)` → `'2100.01.01 (1x)'`, `'2100.01.01 (¼x)'`.

Verify: `npm run typecheck`, `npm test`. Append `## Worker report`.
