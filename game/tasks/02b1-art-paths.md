# Task 02b1 — Main View: real art file paths

thinking: off

Small, mechanical task. **Start editing within your first few tool calls.** Do not Read image files.

Real art filenames differ from what `src/render/assets.ts` builds (so every request 404s and generated fallbacks show). Real names, e.g.:
- planets: `images/environment/planets/ocean/Ocean-0001.png` … (`ls` each folder under `images/environment/planets/`)
- map stars: `images/environment/mapstars/mainsequence/StarDisk_138.png` …
- system-zoom stars: `images/environment/stars/star_disc_0.png` … and coronas `images/environment/stars/rays/CoronaA-0001.png` …

A previous run already started `scripts/gen-asset-manifest.mjs` (+ a package.json hook): finish it so it writes `public/asset-manifest.json` = `{ "<folder>": [sorted file names] }` for every folder under `images/environment/` (sort case-insensitively, like Windows `Directory.GetFiles`), run it from `predev`/`prebuild`, gitignore the JSON.

Then change `assets.ts` so each URL function picks a real file:
- planet/moon: the planet's type folder, file index = `pictureRef` taken modulo the folder's file count (if the port in `src/sim/galaxy.ts` `selectHabitatPictures` already yields per-folder indices, use those directly — read that function first).
- map star: type folder, index = `pictureRef` modulo count.
- system-zoom star: `star_disc_<n>.png` with `n = pictureRef % 3`, plus corona `rays/CoronaA-<nnnn>.png` with `nnnn = (pictureRef % count) + 1`.
Log `console.warn` once per URL that is still missing.

Verify: `npm run typecheck`, `npm test`; start `npm run dev` in the background and check `curl -s -o /dev/null -w '%{http_code}'` returns 200 for a few URLs your functions produce (add a tiny unit test for the index math). Append `## Worker report`.

## Worker report

**Files changed**
- `scripts/gen-asset-manifest.mjs` — now recursively enumerates **every** folder under `images/environment/` (43 folders, 1478 .png files) instead of a hardcoded list; keys are paths relative to `images/environment/`, sorted case-insensitively (Windows `Directory.GetFiles` order). Re-ran it: `public/asset-manifest.json` regenerated (gitignored; `predev`/`prebuild` hooks already in place from the previous run).
- `src/render/assets.ts` — rewrote the URL builders on top of the manifest:
  - new `MANIFEST` state + `loadManifest()` (fetches `/asset-manifest.json`) and `pickFromFolder(folder, pictureRef)` = file at index `pictureRef % fileCount` (negative-safe);
  - `mapStarUrls`: `mapstars/<type>` folder, index = `pictureRef % count` (type map kept, incl. `flares` for supernovae);
  - `starSpriteUrls`: `stars/star_disc_<pictureRef % 3>.png` + corona `stars/rays/CoronaA-<nnnn>.png` with `nnnn = (pictureRef % rayCount) + 1`; black holes use `stars/blackhole/BlkHole-<nnnn>.png` (index `pictureRef % 100`) + fixed `stars/star_blackhole_0.png`;
  - `planetUrls`: real install folder names (`sandydesert`, `marshyswamp`, `barrenrock`, `iceglacial`, `gasgiant`, `frozengasgiant`, …), index = `pictureRef % count` (confirmed `selectHabitatPictures` does NOT yield per-folder indices — its ranges like ocean 900+ don't match the original offset scheme, so modulo is required);
  - `cloudUrls`: flat `nebulae/` folder shared by all gas types (install has no per-type subfolders), index = `pictureRef % 51`;
  - `asteroidUrls`: per-composition folders `rocky`/`ice`/`metal`, index = `pictureRef % count`;
  - `BACKDROP_URLS` unchanged (already a real file);
  - `console.warn` once per missing URL (dedup Set) in both `AssetStore.loadFirst` and `preload`.
- `src/main.ts` — `await loadManifest()` after the DW:U presence probe (only when present).
- `test/assets.test.ts` (new) — unit tests for the index math: modulo wrap, empty/unknown folders, negative refs, and each builder's URL shape (pixi.js stubbed via `vi.mock`).

**Verification**
- `npm run typecheck` — clean; `npm test` — 103/103 pass (6 files).
- Dev server: every URL class the builders produce returned **200** (checked via fetch): manifest JSON, `planets/ocean/Ocean-0001.png`, `mapstars/mainsequence/StarDisk_143.png`, `stars/star_disc_1.png`, `stars/rays/CoronaA-0002.png`, `stars/blackhole/BlkHole-0096.png`, `stars/star_blackhole_0.png`, `nebulae/NebulaArray16_03.png`, `asteroids/metal/AstCryst-0002.png`, `galaxybackdrops/galaxy_backdrop.jpg`.
- Cross-checked the builder math against the manifest for every pictureRef range the sim actually emits (stars 83–95/0, planets 100+–2200+, clouds 71–82): all resolve to existing files.
- Headless screenshots (no console errors printed): `shots/02b1-galaxy.png` (whole-galaxy view), `shots/02b1-system.png` (system zoom, seed=1 cx/cy=2000000) — for orchestrator visual review.

**Left undone / notes**
- Corona frames are static (one frame picked from `pictureRef`); the original animates all 100 `Corona*` frames over time (`Main.Part13.cs` method_116) — out of scope here.
- The original picks star discs by star *type* (bitmap_204[1] default, [2] dwarfs/neutron stars, [0] small) rather than `pictureRef % 3`; followed the task's prescribed formula instead.
- Map-star icons: the original indexes by a separate `MapPictureRef` (not modeled in the port yet); `pictureRef % count` is used as the task prescribes.
- Supernova art (`supernovae/`, indexed by `NovaImageIndexMajor`) not wired up — `SuperNova` stars fall back to generated glow textures (TODO(port) territory).
