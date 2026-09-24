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
