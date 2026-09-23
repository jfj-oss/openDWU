# Task 02b — Main View: load the real art + close the mid-zoom gap

Follow-up to task 02 (read `src/render/assets.ts` and `src/render/mainView.ts` first). **Do not Read image files** (see CLAUDE.md); verify art paths with `ls` and with `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/assets/dwu/images/...` against the dev server.

`$APP` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded`
`$IMG` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/images`

## 1. Art paths are wrong (every request 404s → generated fallbacks)
`assets.ts` builds guessed paths like `environment/planets/ocean/<pictureRef>.png`. Real files are e.g. `planets/ocean/Ocean-0001.png`, `mapstars/mainsequence/StarDisk_138.png`, `stars/star_disc_0.png`, `stars/rays/CoronaA-0001.png`. Port the real mapping:
- **Planets/moons/asteroids/gas clouds:** `$APP/DistantWorlds.Types/HabitatImageCache.cs` (planet paths at ~line 292–298) — how `pictureRef` maps to folder + filename. Port it as a pure function + unit test (e.g. an ocean planet's pictureRef → `planets/ocean/Ocean-000N.png`; check `ls $IMG/environment/planets/ocean`).
- **Stars at system zoom:** `$APP/DistantWorlds/Main.Part13.cs` `LoadStars` (line 1120–1219): `star_disc_<n>.png` discs + `rays/CoronaC-<nnnn>.png` (and other Corona sets) coronas; port how a star picks its disc/corona and how they're composed (disc + additive corona, tinted by star type if the source does).
- **Map stars:** `Main.Part13.cs` `LoadMapStars` (line 993): files are enumerated per folder (`Directory.GetFiles(... "*.png")`) and indexed by order — the browser can't list directories, so add `scripts/gen-asset-manifest.mjs` that writes `public/asset-manifest.json` (sorted file lists for the folders the renderer needs) at dev/build time, and index into it exactly like the source (sorted order as `Directory.GetFiles` returns on Windows = ordinal/case-insensitive name order). Add it to `npm run dev`/`build` (predev/prebuild scripts). Do not commit the generated JSON (gitignore it).
- Keep the generated fallbacks only for genuinely missing files, and `console.warn` once per missing path.

## 2. Mid-zoom gap (the view goes black)
At zoom factor ~150 around a system (e.g. `?zoom=150&cx=5383389.5&cy=4079930.9`, seed 1 spiral 700) the screen is black: the backdrop has faded out but the starfield, orbit rings and planets haven't faded in. The zoom must be seamless — some layer always visible. Use the source's zoom thresholds (`$APP/DistantWorlds/Controls/MainView*.cs`, `Main.Part11.cs` ~460–510) and overlap the cross-fades so there's no dead band: starfield visible from sector zoom inward; orbit rings + planet sprites visible whenever the system fills a meaningful part of the screen.

## 3. Planets must be visible sprites at system zoom
At `?zoom=30` (whole system on screen) planets are sub-pixel dots. Size them like the original (source: habitat draw code `method_84/85/88` in `MainView.1.cs` ~2307–2430 — it enforces a minimum on-screen size); planets should read as small planet images with names, moons beside them.

## Verify
`npm run typecheck`, `npm test`. With `npm run dev` running, save screenshots (don't open them) at `?zoom=1200`, `?zoom=150`, `?zoom=30`, `?zoom=4` with `&cx=5383389.5&cy=4079930.9`, into `shots/02b-*.png`; make sure shot.mjs prints no 404/console errors (add a check that logs failed requests in shot.mjs: `page.on('requestfailed')` and `response.status()>=400`). List the shots in the Worker report.
