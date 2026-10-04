# DWU — Distant Worlds: Universe recreation

A faithful recreation of *Distant Worlds: Universe* (v1.9.5) in TypeScript + PixiJS 8 (Vite for dev).

**Targets: native desktop apps for macOS arm64, Linux x86_64 and Windows x64**, via an Electron shell (`desktop/`; release builds: `../RELEASING.md`). The game code must stay platform-neutral: no Node APIs in `src/`, load all assets/data through URLs under `/assets/dwu/` (the desktop shell maps that prefix to the user's DW:U install folder), no platform-specific paths.

**Main View is one seamless map:** the player scrolls continuously from the whole galaxy down to a single planet and back — the galaxy map and the system map are the same view at different zoom levels, with layers cross-fading (never a hard screen switch).

## Sources of truth (in priority order)
1. **Decompiled original engine source** (exact formulas, constants, enums, generation order):
   `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/`
   - `DistantWorlds.Types/` — the game model (Galaxy*.cs, Empire*.cs, BuiltObject*.cs, Habitat.cs, ...)
   - `DistantWorlds/` — the app: Main.Part*.cs (rendering + UI), Start*.cs (new-game setup)
   where `$DWU=/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe`.
   Port logic faithfully: same order of operations, same constants, same random-call sequence.
2. **Original data files** in `$DWU/*.txt` (races.txt, resources.txt, components.txt, ...) and `$DWU/Policy/`, `$DWU/designTemplates/`.
   At runtime they are served from `/assets/dwu/<file>` (public/assets/dwu is a symlink to `$DWU`, created by `npm run import-assets`).
3. **Spec**: `../Distant_Worlds_Universe_Recreation_Prompt.md` (full rules + implementation plan, Part 15).
4. **Manuals / help**: `$DWU/Manuals/*.pdf`, `$DWU/Help/*.mht`.

## Game files outside this machine (cloud sessions)
The original game files (data, art, sounds, manuals, decompiled source) are in the private repo **`jfj-oss/dwu-assets`**. On a machine without the Steam install:
```bash
git clone https://github.com/jfj-oss/dwu-assets.git ../../dwu-assets     # next to the openDWU repo
DWU_DIR="$(realpath ../../dwu-assets)" npm run import-assets              # links it as public/assets/dwu
```
Then read every `$DWU` path in this file and in task files as that clone (e.g. `$DWU/Customization/DistantWorldsExpanded-main/...`).

## Art
Use the original art directly from `/assets/dwu/images/...` (e.g. `/assets/dwu/images/environment/planets/ocean/...`).
Never commit or copy the ORIGINAL game's art into the repo. Art we create ourselves (procedural code, runtime composites of the original frames, or our own generated sprite sheets) is fine to commit under `public/art/` — see tasks/19-mod-layer-scenarios.md §19g-7b.

## Layout
- `src/sim/` — headless game model. **No DOM or Pixi imports.** Deterministic given a seed.
- `src/sim/random.ts` — port of .NET `System.Random` (legacy seeded algorithm); all sim randomness goes through it.
- `src/render/` — PixiJS rendering.
- `src/ui/` — HUD / panels / screens (DOM overlay or Pixi).
- `test/` — vitest tests (`npm test`).

## Conventions
- TypeScript strict. Run `npm run typecheck` and `npm test` before finishing; both must pass.
- Tests: `npm run test:fast` while iterating (every file except the soaks tagged `// @slow` in their header), `npm run test:slow` for only the soaks, and the full suite (`npm test`, or `npx vitest run --testTimeout=300000 --hookTimeout=2400000 --maxWorkers=2` on a shared machine) before finishing. Tests that need the standard seed-1 harness game take it from `cachedTickGame(gameData, { age?, seconds? })` / `cachedTickGameRun` (`test/helpers/gameCache.ts`) instead of `createTickGame` (+ `runGameSeconds`): the game is built once per key, saved under `test/.cache/` (gitignored, keyed by a hash of `src/sim`, the helpers and the data files, so any sim edit rebuilds it) and every call gets a fresh deserialized copy, state-identical to building it in place. Tests with bespoke options or hooks keep their own `createGame`. `DWU_TEST_CACHE=off` builds every game in place (to rule the cache out).
- Keep C# names recognizable (e.g. `Habitat`, `HabitatType`, `SystemInfo`, `setupSolarSystem`) and cite the source file + method in a short comment above each ported function, e.g. `// Port of Galaxy.5.cs SetupSolarSystem`.
- Do not invent mechanics when the source has them. If something is out of scope for the current task, leave a `// TODO(port): <what> — <source file:method>` note.
- Visual check: with `npm run dev` running, `node scripts/shot.mjs http://localhost:5173/ shots/x.png` saves a headless screenshot (and prints console errors). **Do not open/Read image files** (screenshots or art): workers may run on a text-only model and image input crashes the session. Just save the screenshots, check the printed console output for errors, and list the screenshot paths in your Worker report — the orchestrator reviews them visually.
