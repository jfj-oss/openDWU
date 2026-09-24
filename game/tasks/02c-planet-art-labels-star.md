# Task 02c — Main View: planet art at system zoom, label gating, star tint + corona

thinking: off

Three small, exact fixes in `src/render/mainView.ts` (+ `src/render/assets.ts` for the corona). **Start editing within your first few tool calls.** Do not Read image files. `z` = pixels per world unit (zoom factor 30 ⇒ z ≈ 0.033).

1. **Planet sprites appear too late.** `const dotT = fadeIn(z, 0.25, 0.45);` (~line 281) only switches dots → planet art closer than zoom factor ~4, so at factor 30 (whole system on screen) planets are 2–12 px dots. Change the window to `fadeIn(z, 0.012, 0.03)` (factor ~83 → ~33) so the planet art (already min 14 px via `planetSpritePx`) shows when the whole system is on screen. Apply the same window to moons if they use their own.
2. **Planet labels show at sector zoom.** `planet.label.visible = sprPx >= 14;` is always true because `planetSpritePx` has a 14 px floor, so every system at sector zoom gets a pile of "Name 1/2/3" labels. Use `planet.label.visible = dotT > 0.5;` (only once the planet art is shown). Same for moon labels if any.
3. **System-zoom star is a plain grey disc.** The original draws `environment/stars/star_disc_<n>.png` **tinted by the star's colour** with an **additive corona** (`environment/stars/rays/Corona*-<nnnn>.png`) on top — see `$APP/DistantWorlds/Main.Part13.cs` `LoadStars` lines 1120–1219 (`$APP` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded`) for which corona set/frames and how the disc is coloured per star type. Implement: disc sprite `tint` = star colour by type (use the map-star colours you already have per type if the source's colour isn't obvious), plus a corona sprite (`blendMode = 'add'`, ~1.6× the disc size, same tint) behind/over the disc. Keep black holes as they are.

Unit tests: `fadeIn` window values at z = 0.012/0.03; label visibility false at sector zoom (z = 0.0005) and true at z = 0.05.

Verify: `npm run typecheck`, `npm test`; with `npm run dev` running save (don't open) `?zoom=1200`, `?zoom=30`, `?zoom=4` with `&cx=4570664.9&cy=3835180.6` → `shots/02c-*.png`. Append `## Worker report`.
