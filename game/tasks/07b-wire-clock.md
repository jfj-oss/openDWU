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

## Worker report

Files changed:
- `src/sim/clock.ts` — replaced the `GameClock` interface / `createGameClock` / `GAME_SPEEDS` / `stepSpeed` with a re-export of `GalaxyTime` from `galaxyTime.ts` (kept the `GameClock` name as a type alias for compatibility).
- `src/ui/hud.ts` — top-left bar now takes a `GalaxyTime`: ▶/⏸ calls `togglePause()` (glyph reflects state), −/+ call `slower()`/`faster()`, and the date label shows `formatClockLabel(...)` = `resolveStarDateDescription(currentStarDate) + ' (' + speed + 'x)'` with 0.25/0.5 formatted as `¼x`/`½x`. Added exported pure helper `formatClockLabel(starDate, speed)`.
- `src/main.ts` — creates `new GalaxyTime(START_STAR_DATE)` (starts paused at 1x per the original); spacebar calls `togglePause()`; each Pixi ticker frame runs `time.advance(ticker.deltaMS)` → `galaxy.step(gameMs)` when > 0; star-date label + pause glyph refreshed every 250 ms.
- `test/clock.test.ts` — rewritten for `GalaxyTime`: starts paused at 1x on `START_STAR_DATE`; advance = realDt × speed (0 while paused); speed ×2/÷2 clamped to [0.25, 4].
- `test/hud.test.ts` — added `formatClockLabel` tests: `'2100.01.01 (1x)'`, `(4x)`, `(¼x)`, `(½x)`.

Done: all four task items. Verified `npm run typecheck` passes and `npm test` passes (15 files, 192 tests). Main View confirmed to read `habitat.orbitAngle`/`orbitDistance` fresh every frame in `SystemView.update` (planets/moons at mainView.ts:321-346; asteroid rocks are static positions set once at build time — they do not orbit, matching the original where asteroid fields are static scatter).

Screenshots saved (dev server, headless Chromium): `shots/07b-system.png` (system zoom), `shots/07b-galaxy.png` (galaxy zoom), `shots/07b-system-run.png` (4 s wait). Console output was clean apart from Vite's own `[debug] connecting/connected` lines — no page errors or warnings.

Left undone: none within scope. (Note: the HUD starts paused, so planets only move after the user presses ▶/space — this matches the original's start-paused behaviour.)
