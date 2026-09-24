# Task 02b2 — Main View: close the mid-zoom black gap

thinking: off

Small tuning task in `src/render/mainView.ts` only. **Start editing within your first few tool calls.** Do not Read image files.

At zoom factor ~150 (`?zoom=150&cx=5383389.5&cy=4079930.9`, default seed/shape) the screen is black: the backdrop has faded out (`bdA = fadeOut(z, m*2.5, m*14)`, ~line 490) but the starfield only fades in at `fadeIn(z, 0.1, 0.3)` (~line 505) and orbit rings at `fadeIn(z, 0.008, 0.03)` (~line 228). Make the fades overlap so something is always visible while zooming:
- starfield: start fading in where the backdrop starts fading out (use the same `m`-relative bound), full by the time the backdrop is gone;
- orbit rings: visible from the zoom where the system's outermost orbit spans ≥ ~40 px on screen.
Add a unit test on the pure fade functions: for every zoom between galaxy view and 100%, `backdropAlpha + starfieldAlpha >= 0.6`.

Verify: `npm run typecheck`, `npm test`; with `npm run dev` running, save screenshots (don't open them) at `?zoom=1200`, `?zoom=150`, `?zoom=30` with the cx/cy above to `shots/02b2-*.png`. Append `## Worker report` listing them.

## Worker report

Files changed:
- `src/render/mainView.ts`
  - Extracted the crossfade windows into exported pure functions: `backdropAlpha(z, m)` = `fadeOut(z, m*2.5, m*14)` (unchanged), `starfieldAlpha(z, m)` = `fadeIn(z, m*2.5, m*14)` (was `fadeIn(z, 0.1, 0.3)` — now starts where the backdrop starts fading out and is full by the time it's gone), and `orbitRingAlpha(z, maxOrbitDistance)` = `0.5 * fadeIn(z, zMin, zMin*2)` with `zMin = 40 / maxOrbitDistance` (rings visible once the outermost orbit spans ≥ ~40 px on screen; replaces the fixed `fadeIn(z, 0.008, 0.03)`).
  - `MainView.update()` uses `backdropAlpha`/`starfieldAlpha`; `SystemView.update()` uses `orbitRingAlpha(z, this.maxExtent)` for the ring alpha.
- `test/main-view-fades.test.ts` (new): asserts `backdropAlpha + starfieldAlpha >= 0.6` for 2001 log-spaced zooms between galaxy view (m) and 100% (z=1); checks the overlap endpoints (starfield fully opaque exactly when backdrop reaches zero); checks orbit rings appear at the 40-px threshold.

Done:
- `npm run typecheck` passes; `npm test` passes (7 files, 107 tests).
- Screenshots saved (no console errors printed):
  - `shots/02b2-zoom1200.png` (`?zoom=1200&cx=5383389.5&cy=4079930.9`)
  - `shots/02b2-zoom150.png` (`?zoom=150&...`) — previously black mid-zoom gap
  - `shots/02b2-zoom30.png` (`?zoom=30&...`)

Left undone: nothing. Note: the starfield is now visible from sector zoom down (by design, per the task's overlap requirement); its parallax layers are dimmed (far layer at 0.5× alpha) so the galaxy backdrop still dominates at full-galaxy zoom.
