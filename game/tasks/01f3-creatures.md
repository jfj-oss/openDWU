# Task 01f3 — SelectCreatures (space creatures at generation)

thinking: off

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

**Mechanical port — start editing within your first few tool calls.** Read each listed range once (Read with offset/limit) and translate it line by line into `src/sim/galaxy.ts` (or a new `src/sim/` module), keeping **every `Rnd` call in the same order** and the same constants. Cite the source above each function (`// Port of Galaxy.6.cs <Name>`). Do not survey other files; do not Read image files.

Depends on 01f2. Port:
- `$SRC/Galaxy.6.cs` 654–712 `SelectCreatures(habitat)` and 713–717 `GenerateCreatureAtHabitat` (+ the overload it calls — Grep `-n` for `GenerateCreatureAtHabitat(` and Read just that).
- `$SRC/Creature.cs` (constructor + fields set at generation only — no movement/AI), `$SRC/CreatureType.cs` enum (member order exact).

Wire at both call sites: the `TODO(port)` for SelectCreatures in the setupSolarSystem port, and the gas-cloud loop in the constructor port (`$SRC/Galaxy.4.cs` ~2297–2305: `SelectCreatures(habitat)` right after `GenerateGasCloud()`). Expose `galaxy.creatures`.

Tests: creatures exist, reference valid habitats, types in enum range; deterministic. `npm run typecheck` && `npm test`. Append `## Worker report`.
