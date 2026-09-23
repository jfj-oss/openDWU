# Task 02 — Main View: zoomable galaxy map (PixiJS)

Goal: the game's **Main View** — one continuous, seamless zoom from full-galaxy to 100% (individual planets) and back. The galaxy map and the system map are the *same* view: as you scroll in, galaxy-level layers (backdrop, map stars, sector grid) fade out while system-level layers (star sprite, orbits, planets, starfield) fade in — no screen switch, no pop. Rendering the galaxy from `generateGalaxy()` (task 01, `src/sim/galaxy.ts`) with the **original art**.

## Sources (port the behavior; names are obfuscated `method_NN` but logic is readable)
`$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds/`
- `Controls/MainView.cs`, `Controls/MainView.1.cs`, `Controls/MainView.2.cs` — the renderer. Notable: `PrepareGalaxyBackdrop()` (~MainView.1.cs:3926), `FadeGalaxyNebulae/FadeSectorBackground/FadeGalaxyBackground` (~4111–4152), star-field drawing (`method_102..106`, uses `StarFieldItem`), habitat drawing (`method_84/85/88`), zoom helpers (`method_90/91`).
- `Main.Part13.cs` `LoadMapStars` (~line 993): map-star images per star type from `images/environment/mapstars/<type>/`.
- `Main.Part12.cs` ~line 962: galaxy backdrops from `images/environment/galaxybackdrops/`.
- `Main.Part11.cs` ~line 460–510: zoom thresholds (`actualZoomFactor > 3.0`, `> 10.0` …).
- Manual (controls): mouse wheel zooms around the cursor from 100% to full galaxy; PageUp/PageDown step zoom; right-drag pans; moving the mouse to the screen edge scrolls; right-click on empty space centers the view there.

Find in the source the exact zoom range, the zoom factor at which each layer appears/disappears/fades, how map stars are sized per star type, and how planets/moons are sized and placed at system zoom. Use those numbers.

## Art (served from `/assets/dwu/images/...`)
- `environment/galaxybackdrops/galaxy_backdrop.jpg` (2000×2000, dim blue/teal nebula wash) — stretched over the galaxy bounds when zoomed out.
- `environment/mapstars/{mainsequence,redgiant,supergiant,whitedwarf,neutron,blackhole,flares}/*.png` — star icons at galaxy/sector zoom.
- `environment/stars/*.png` (+ `rays/`, `blackhole/`) — full star sprites at system zoom.
- `environment/planets/<type>/*.png` — planet sprites; pick via the habitat's `pictureRef` from task 01.
- `environment/nebulae/*.png`, `environment/asteroids/`, gas clouds as the source indicates.
List the folders with `ls` to find actual filenames.

## What it must look like (from real gameplay video frames + Steam in-game screenshots — match this)
- **Full galaxy zoom:** the galaxy is a square region filled by the galaxy backdrop (blue nebula with dark dust lanes and a soft bright core); **outside the galaxy bounds is plain black**. Stars are tiny white/yellow dots (a few px), barely larger for giants. No orbit rings, no planets. Region names (e.g. "Nispes Arm") in small grey text — leave a hook for these (GalaxyLocations come later).
- **Sector zoom:** backdrop still visible but dimming; stars now small glowing map-star sprites coloured by type (yellow/white main sequence, orange-red giants, blue-white dwarfs, dark black holes). Very faint sector grid lines. System names appear as small white text under stars once zoomed in enough to not overlap.
- **Mid zoom (a few systems on screen):** stars larger with glow; thin faint circular orbit rings around each star; planets tiny coloured dots on their rings.
- **System zoom:** a big detailed star sprite (hot white/yellow disc with a flare/corona) and planet sprites at their orbit positions, moons beside planets, asteroid fields as scattered rocks, over a dense black starfield of tiny white dots (parallax star field). Planet labels in small white text beside planets.
- Smooth continuous zoom and pan, 60 fps on a 1400-star galaxy (cull off-screen objects; use sprite sheets/containers, not per-frame Graphics redraws).

## Code layout
- `index.html` + `src/main.ts` — boot: fetch `/assets/dwu/systemNames.txt`, generate a galaxy (URL params `?seed=&shape=&stars=` with defaults seed=1, Spiral, 700), create the view.
- `src/render/camera.ts` — world↔screen transform, zoom-around-point, clamps (pure, unit-testable).
- `src/render/mainView.ts` — Pixi layers: backdrop, starfield, map stars, system detail (stars/planets/moons/asteroids/gas clouds), labels, sector grid; level-of-detail switching by zoom.
- `src/render/assets.ts` — texture loading/caching by path.
- `test/camera.test.ts` — zoom-around-cursor keeps the world point under the cursor fixed; clamps hold.
- Expose `window.__dwu = { camera, galaxy }` for debugging/screenshots, and support URL params `?zoom=<factor>&cx=&cy=` (initial camera) so screenshots at each zoom level can be taken.

## Verify
`npm run typecheck`, `npm test`. Start `npm run dev` in the background, then take screenshots with `node scripts/shot.mjs "<url with params>" shots/<name>.png` at galaxy zoom, sector zoom, and system zoom (centered on a star with planets — find one from `window.__dwu.galaxy` or compute in a node script). Check the console output printed by shot.mjs has no errors. List the screenshot paths in your Worker report.

## Worker report (orchestrator)
The worker sessions (qwen, text-only) crashed three times trying to Read their own screenshots (server: "Vision is disabled"). Code passes typecheck + 88 tests; committed as the base. Orchestrator screenshot review → follow-up task `02b-main-view-art-and-zoom.md`: art paths are guessed (all 404 → generated fallbacks), mid-zoom dead band (black), planets are dots.
