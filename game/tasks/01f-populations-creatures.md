# Task 01f — Independent alien populations + space creatures at generation

Depends on 01e. `$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

- `$SRC/Galaxy.6.cs` 1055 `SetupAlienRacePopulations(empireStarts, aggressiveRacesRequired)` — called in the constructor **before** the star loop (Galaxy.4.cs ~2205–2220); its Rnd calls precede star generation, so port it with an empty `empireStarts` default and the aggression option.
- `$SRC/Galaxy.6.cs` 1218 `SelectPopulation(habitat, sun)` and the population-driven setup around the galaxy.ts TODOs at ~1238–1239.
- `$SRC/Galaxy.6.cs` 654 `SelectCreatures(habitat)` + `$SRC/Creature.cs`, `CreatureType.cs` (creature placement only; no AI/movement yet). Also the gas-cloud `SelectCreatures` call in the constructor gas-cloud loop.
- Pass races from GameData (04a) into `generateGalaxy`.

Tests: some colonizable planets carry native populations of real race ids; creatures exist and reference valid habitats; deterministic; changing aggression changes the result.

Done when `npm run typecheck` && `npm test` pass. Append `## Worker report`.
