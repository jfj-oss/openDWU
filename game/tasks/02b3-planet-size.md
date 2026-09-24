# Task 02b3 — Main View: planets visible at system zoom

thinking: off

Small task in `src/render/mainView.ts`. **Start editing within your first few tool calls.** Do not Read image files.

At `?zoom=30&cx=5383389.5&cy=4079930.9` (whole system on screen) planets render as sub-pixel dots. Give planet and moon sprites a minimum on-screen size: planets ≥ 14 px, moons ≥ 7 px, the star's system-zoom sprite ≥ 40 px (scale = max(real size × zoom, minimum px)), and show the planet name label under each planet once it's ≥ 14 px. Keep real scale when it's larger than the minimum. Unit-test the size function.

Verify: `npm run typecheck`, `npm test`; screenshots (don't open) at `?zoom=30` and `?zoom=4` with the cx/cy above → `shots/02b3-*.png`. Append `## Worker report`.
