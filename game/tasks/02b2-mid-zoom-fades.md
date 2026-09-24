# Task 02b2 — Main View: close the mid-zoom black gap

thinking: off

Small tuning task in `src/render/mainView.ts` only. **Start editing within your first few tool calls.** Do not Read image files.

At zoom factor ~150 (`?zoom=150&cx=5383389.5&cy=4079930.9`, default seed/shape) the screen is black: the backdrop has faded out (`bdA = fadeOut(z, m*2.5, m*14)`, ~line 490) but the starfield only fades in at `fadeIn(z, 0.1, 0.3)` (~line 505) and orbit rings at `fadeIn(z, 0.008, 0.03)` (~line 228). Make the fades overlap so something is always visible while zooming:
- starfield: start fading in where the backdrop starts fading out (use the same `m`-relative bound), full by the time the backdrop is gone;
- orbit rings: visible from the zoom where the system's outermost orbit spans ≥ ~40 px on screen.
Add a unit test on the pure fade functions: for every zoom between galaxy view and 100%, `backdropAlpha + starfieldAlpha >= 0.6`.

Verify: `npm run typecheck`, `npm test`; with `npm run dev` running, save screenshots (don't open them) at `?zoom=1200`, `?zoom=150`, `?zoom=30` with the cx/cy above to `shots/02b2-*.png`. Append `## Worker report` listing them.
