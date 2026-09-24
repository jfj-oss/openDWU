# Task 02b3 — Main View: planets visible at system zoom

thinking: off

Small task in `src/render/mainView.ts`. **Start editing within your first few tool calls.** Do not Read image files.

At `?zoom=30&cx=5383389.5&cy=4079930.9` (whole system on screen) planets render as sub-pixel dots. Give planet and moon sprites a minimum on-screen size: planets ≥ 14 px, moons ≥ 7 px, the star's system-zoom sprite ≥ 40 px (scale = max(real size × zoom, minimum px)), and show the planet name label under each planet once it's ≥ 14 px. Keep real scale when it's larger than the minimum. Unit-test the size function.

Verify: `npm run typecheck`, `npm test`; screenshots (don't open) at `?zoom=30` and `?zoom=4` with the cx/cy above → `shots/02b3-*.png`. Append `## Worker report`.

## Worker report

Files changed:
- `src/render/mainView.ts` — added exported size functions `planetSpritePx` (≥14 px, real scale = diameter×z×0.38), `moonDotPx` (≥7 px, diameter×z×0.3), `starSpritePx` (≥40 px, capped 1400); wired them into `SystemView.update` replacing the old clamped formulas; planet name label now shows when `sprPx >= 14` instead of `z > 0.15`.
- `test/main-view-fades.test.ts` — new `system-zoom minimum body sizes` suite covering min-floor, boundary, real-scale retention, and the star's 1400 px cap.

Done:
- Planets ≥ 14 px, moons ≥ 7 px, star system-zoom sprite ≥ 40 px, real scale kept when larger.
- Planet name labels under each planet once it reaches 14 px.
- `npm run typecheck` passes; `npm test` passes (110 tests).
- Screenshots saved (console clean): `shots/02b3-zoom30.png`, `shots/02b3-zoom4.png`.

Left undone: none.
