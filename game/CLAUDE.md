# DWU — Distant Worlds: Universe recreation

A faithful recreation of *Distant Worlds: Universe* (v1.9.5) in TypeScript + PixiJS 8, run in the browser via Vite.

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

## Art
Use the original art directly from `/assets/dwu/images/...` (e.g. `/assets/dwu/images/environment/planets/ocean/...`).
Never commit art; never copy it into the repo.

## Layout
- `src/sim/` — headless game model. **No DOM or Pixi imports.** Deterministic given a seed.
- `src/sim/random.ts` — port of .NET `System.Random` (legacy seeded algorithm); all sim randomness goes through it.
- `src/render/` — PixiJS rendering.
- `src/ui/` — HUD / panels / screens (DOM overlay or Pixi).
- `test/` — vitest tests (`npm test`).

## Conventions
- TypeScript strict. Run `npm run typecheck` and `npm test` before finishing; both must pass.
- Keep C# names recognizable (e.g. `Habitat`, `HabitatType`, `SystemInfo`, `setupSolarSystem`) and cite the source file + method in a short comment above each ported function, e.g. `// Port of Galaxy.5.cs SetupSolarSystem`.
- Do not invent mechanics when the source has them. If something is out of scope for the current task, leave a `// TODO(port): <what> — <source file:method>` note.
- Visual check: with `npm run dev` running, `node scripts/shot.mjs http://localhost:5173/ shots/x.png` saves a headless screenshot (and prints console errors).
