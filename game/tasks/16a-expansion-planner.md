# Task 16a — Expansion Planner (F3 / top-bar Expansion Planner button)

thinking: off
scope: locked

Edit only these files:
- a new `src/ui/screens/expansionPlanner.ts` and a new `src/ui/screens/expansionPlanner.css`
- `src/ui/hud.ts`: only the four `[16a]` blocks below (one import line, one module-level hook, one registration in `buildSelectionPanel`, one block in `buildTopBarButton`'s click listener)
- `src/ui/keyboard.ts`: only the three `[16a]` hook blocks below (one import line, one `dispatchKey` case, one `IMPLEMENTED_KEY_ACTIONS` line)
- `src/main.ts`: only the two `[16a]` lines below (one import, one close call)
- a new `test/expansionPlanner.test.ts`

Do NOT edit anything under `src/sim/`. Only import from it (read-only). Three other agents (16b, 16c, 16d) edit `keyboard.ts`, `hud.ts` and `main.ts` at the same time. Put each hook exactly at the anchor given, wrapped in its `[16a]` / `[/16a]` marker comments. Do not reformat, reorder or "tidy" any neighbouring line, or the four branches will not merge. Start editing right away.

After this task, F3 and the top-bar `btnExpansionPlanner` button (`expansionPlannerButton.png`) open a streamlined Expansion Planner:
- a mode select with the original's four modes. Three work: **Potential Colonies**, **Resource Targets by Your Empire Priority**, **Resource Targets by Galaxy Priority**. The fourth, **Your Empire Resource Locations**, is shown disabled (see the TODO in step 1);
- a "Show low-quality colonies" checkbox (colonies mode) or a "Show asteroids" checkbox (resource modes), and a **Refresh** button;
- one row per target, with the original's grid columns: Name, Type, Size, Quality, Distance, Race, Pop, Resources, Ruins, Assigned ship, Rarity. Each row is coloured and has a tooltip with the original's status reason ("Too far from existing colonies", "Pirate base in this system", …);
- a row click closes the planner, selects the planet and zooms the Main View to it (the original's "Go to Potential Colony").

House style: copy the structure of `src/ui/screens/coloniesList.ts` / `shipsAndBasesList.ts`:
- module-level `open` state;
- `toggle…` / `close…` exports;
- a document `keydown` Escape handler that calls `stopImmediatePropagation`;
- pure helpers, so tests need no DOM (vitest has no jsdom).

This is a streamlined panel, not the original 1:1 pnlExpansionPlanner: no galaxy mini-map, no deficient-resources grid, no available-ships list, no "Build Colony Ship" button, no resource filter / percent filter.

## Existing code you use (read-only; verified at HEAD fe566ad)

- `src/sim/civilianAI.ts`:
  - `export interface ColonizationTarget { habitat: Habitat; priority: number; assignedShip?: BuiltObject | null }`
  - `identifyColonizationTargetsFull(galaxy, empire, filterOutDangerousTargets, thresholdValue, maximumListSize, includeLowQualityTargets, includeDistantTargets): ColonizationTarget[]` (Empire.4.cs 4662). With `filterOutDangerousTargets = false` it never writes `empire.dangerousHabitats`, so it is a pure read. No Rnd.
  - `checkEmpireTechCanSurviveStorms(empire): boolean` (Empire.4.cs CheckEmpireTechCanSurviveStorms).
  - Note: `Empire.colonizationTargets` is the AI's cached list. The C# planner does **not** read it; it recomputes, and so do you.
- `src/sim/resourceTargets.ts`:
  - `class HabitatPrioritization { habitat: Habitat | null; priority: number; assignedShip: unknown }`
  - `identifyResourceCentres(galaxy, empire, filterOutAssignedHabitats = true, filterOutDangerousTargets = true, includeAsteroids = true): HabitatPrioritization[]` (Empire.4.cs 1958). No Rnd, no writes.
  - `checkInStorm(galaxy, x, y): boolean`
  - `checkNearPirateBase(galaxy, owner, stellarObject, scanRange, x, y, empireToExclude): boolean`
  - `checkEmpireTerritoryCanBuildAtHabitat(galaxy, empire, habitat): boolean`
  - `checkConstructionShipAndMiningStationCanSurviveStorms(empire): boolean`
  - `checkWhetherHabitatIsDangerous(galaxy, empire, habitat): boolean`
- `src/sim/industry.ts`: `prioritizeEmpireResourceNeeds(galaxy, empire, includeLuxuryResources = false, topResourceCount = 5, minimumValue = 1.0, filterOutHabitatsWithMiningStationsUnderConstruction = true, includeAsteroids = true): HabitatPrioritization[]` (Empire.2.cs 4023-4038). No Rnd, no writes.
- `src/sim/exploration.ts`: `canEmpireColonizeHabitatRange(galaxy, empire, habitat): boolean` and `habitatResourcesHaveSuperLuxury(galaxy, habitat): boolean`.
- `src/sim/tradeItems.ts`: `checkColonizationLikeliness(galaxy, potentialColony, colonizingRace): number`.
- `src/sim/stationPlacement.ts`: `fastFindNearestSpacePort(galaxy, x, y, empire): BuiltObject | null`.
- `Galaxy` (src/sim/galaxy.ts):
  - `systems: SystemInfo[]` (`dominantEmpire?.empire`, `systemStar`, `habitats`)
  - `calculateDistance(x1, y1, x2, y2): number`
  - `checkEmpireTerritoryCanColonizeHabitat(empire, habitat): boolean`. The C# 3-arg overload's `out canColonizeBecauseAtWar` is **not** returned by the port, so treat it as `false` (see the TODO in step 1).
  - `resourceSystem.resources[resourceId]` → `Resource` (src/sim/data/resources.ts) with `name`, `type` (2 = Luxury) and `superLuxuryBonusAmount` (> 0 = restricted / "super luxury").
- `Empire` (src/sim/empire.ts): `galaxy`, `dominantRace`, `resourceMap.checkResourcesKnown(habitat)`, `spacePorts`.
- `Habitat` (src/sim/types.ts):
  - `name`, `type: HabitatType`, `category: HabitatCategoryType`, `diameter`, `quality` (getter, 0..1), `xpos`, `ypos`, `systemIndex`
  - `population` (a `PopulationList`, never null: `totalAmount`, getter `dominantRace: Race | null`)
  - `resources: { resourceId; abundance }[]`
  - `ruin: Ruin | null`. `Ruin` (src/sim/ruins.ts) has `name`, `developmentBonus`, `playerEmpireEncountered`, `bonusDefensive`, `bonusDiplomacy`, `bonusHappiness`, `bonusResearchEnergy`, `bonusResearchHighTech`, `bonusResearchWeapons`, `bonusWealth`.
- `src/ui/hud.ts`: `habitatTypeLabel(type)` ('MarshySwamp' → 'Marshy Swamp'), `rgbCss(rgb)`, `nearestSystem(...)`, `SYSTEM_LEVEL_ZOOM`, `getEmpireSummarySource` (imported there from empireSummary).
- `src/ui/screens/coloniesList.ts`: `formatThousandsK(v)` (C# `"0,K"` → `'25K'`).
- `src/ui/screens/empireSummary.ts`: `getEmpireSummarySource(): { empire } | null` (already imported by hud.ts and keyboard.ts).
- `src/ui/hud.ts` `buildSelectionPanel(...)`: inside it, `wiring.galaxy`, `wiring.camera`, `wiring.onSelectionChange?.(sel)`. The colony cycler already selects a habitat like this:
  ```ts
          const system =
              galaxy.systems.find((s) => s.habitats.includes(next)) ?? galaxy.systems[next.systemIndex];
          wiring.onSelectionChange?.({ habitat: next, system });
          if (moveView) {
              cam.centerOn(next.xpos, next.ypos);
              cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
          }
  ```

## C# source (verbatim, trimmed)

DistantWorlds/Main.Part4.cs:2721 `method_538`, the mode select, and Main.Part3.cs:1029 its labels ("Potential Colonies", "Resource Targets by Your Empire Priority", "Resource Targets by Galaxy Priority", "Your Empire Resource Locations"):
```cs
switch (cmbExpansionPlannerMode.SelectedIndex) {
    case 0: result = "colonies"; break;
    case 1: result = "resourcesyou"; break;
    case 2: result = "resourcesgalaxy"; break;
    case 3: result = "resourcessupply"; break;
}
```
Main.Part4.cs:2364 `method_532`, the lists. `LrufvZylIl` is "Show low-quality colonies" and `chkExpansionPlannerToggleAsteroids` is "Show asteroids" (Main.Part11.cs:2426/2430, both unchecked by default):
```cs
case "resourcessupply":  habitatPrioritizationList = _Game.PlayerEmpire.ResolveResourceSupplyLocations(); break;
case "resourcesgalaxy":  habitatPrioritizationList = _Game.PlayerEmpire.IdentifyResourceCentres(_Game.Galaxy, filterOutAssignedHabitats: false, filterOutDangerousTargets: false, chkExpansionPlannerToggleAsteroids.Checked); break;
case "resourcesyou":     habitatPrioritizationList = _Game.PlayerEmpire.PrioritizeEmpireResourceNeeds(includeLuxuryResources: true, 49, 0.001, filterOutHabitatsWithMiningStationsUnderConstruction: false, chkExpansionPlannerToggleAsteroids.Checked); break;
case "colonies":         habitatPrioritizationList = _Game.PlayerEmpire.IdentifyColonizationTargets(_Game.Galaxy, filterOutDangerousTargets: false, 0, 5000, LrufvZylIl.Checked, includeDistantTargets: true); break;
…
bool bindingForColonization = text == "colonies";
ctlExpansionPlannerTargets.BindData(_Game.Galaxy, habitatPrioritizationList, bindingForColonization);
```
Main.Part4.cs:3027 `btnExpansionPlannerGotoTarget_Click`: `method_157(habitat); method_4(1.0); method_162();` (move view, zoom, close). Main.Part4.cs:3038 `btnExpansionPlannerSelectTarget_Click`: `method_208(habitat)` (select).

DistantWorlds.Controls/Controls/HabitatPrioritizationListView.cs:375 `BindData`, the columns. Column formats (lines 60-113): Size `"0,K"`, Quality `"0%"`, Distance `"0,K"`, Pop `"0,,M"`. Headers: Name, Type, Size, Quality, Distance ("Distance from your nearest Space Port"), Race, Pop (GameText "Population Abbreviation"), Resources, then three header-less columns (Ruins, ShipAssigned, ResourceRarity).
```cs
row.Cells[1].Value = habitat.Name;
row.Cells[2].Value = this.ResolveHabitatTypeDescription(habitat);
row.Cells[3].Value = (int)habitat.Diameter * 100;
row.Cells[4].Value = habitat.Quality;
BuiltObject nearestSpacePort = galaxy.FastFindNearestSpacePort(habitat.Xpos, habitat.Ypos, galaxy.PlayerEmpire);
row.Cells[5].Value = nearestSpacePort != null ? galaxy.CalculateDistance(nearestSpacePort.Xpos, nearestSpacePort.Ypos, habitat.Xpos, habitat.Ypos) : 99999999;
if (habitat.Population != null && habitat.Population.DominantRace != null) row.Cells[6].Value = dominantRace.Name;
row.Cells[7].Value = habitat.Population != null ? habitat.Population.TotalAmount : 0;
row.Cells[8].Value = this.BuildResourcesDescription(habitat);
if (habitat.Ruin != null) row.Cells[9].Value = habitat.Ruin.Name + " (" + ((int)(habitat.Ruin.DevelopmentBonus * 100.0)).ToString("+##0;-##0;0") + "%)";
if (hp.AssignedShip != null) { row.Cells[10].Value = hp.AssignedShip.Name;
    tooltip = SubRole == ColonyShip ? Format("COLONYSHIP colonizing here", name) : SubRole == ConstructionShip ? Format("CONSTRUCTIONSHIP building mining station here", name) : ""; }
row.Cells[11].Value = GetResourceCellRarity(habitat.Resources);
```
GameText: `COLONYSHIP colonizing here` = "'{0}' colonizing here", `CONSTRUCTIONSHIP building mining station here` = "'{0}' building mining station here".

HabitatPrioritizationListView.cs:279 / 344 / 605, the helpers:
```cs
private string ResolveHabitatTypeDescription(Habitat habitat) {
    string str1 = Galaxy.ResolveDescription(habitat.Type); string str2 = Galaxy.ResolveDescription(habitat.Category);
    return habitat.Category != HabitatCategoryType.Asteroid || habitat.Type != HabitatType.BarrenRock ? str1 + " " + str2 : str2;
}
private string BuildResourcesDescription(Habitat habitat) {
    if (PlayerEmpire.ResourceMap != null && PlayerEmpire.ResourceMap.CheckResourcesKnown(habitat)) {
        if (habitat.Resources != null && habitat.Resources.Count > 0) {
            foreach (resource) { str1 += resource.Name; str1 = str1 + " (" + ((double)resource.Abundance / 10.0).ToString("0") + "%)"; str1 += ", "; }
            str2 = str1.Substring(0, str1.Length - 2);
        } else str2 = "(" + GetText("No resources") + ")";
    } else str2 = "(" + GetText("Unknown resources") + ")";
    return str2;
}
private string GetResourceCellRarity(HabitatResourceList resource) {
    if (resource.HasSuperLuxuryResources()) return "VR"; else if (resource.HasLuxuryResources()) return "R"; else return "C";
}
```
Galaxy.2.cs:2514 `ResolveDescription(HabitatCategoryType)`: Asteroid → "Asteroid", GasCloud → "Gas Cloud", Moon → "Moon", Planet → "Planet", Star → "Star".

HabitatPrioritizationListView.cs:457-560, the row colour and tooltip. `color1` is the fore colour; `(170,170,170)` means "leave default". The ladder is `if … else if …`, so the first match wins:
```cs
Color color1 = Color.FromArgb(170, 170, 170);
bool canColonizeBecauseAtWar = false; bool flag3 = true; bool flag4;
bool flag1 = PlayerEmpire.CheckEmpireTechCanSurviveStorms();
bool flag2 = PlayerEmpire.CheckConstructionShipAndMiningStationCanSurviveStorms();
if (bindingForColonization) {
    flag4 = _Galaxy.CheckEmpireTerritoryCanColonizeHabitat(PlayerEmpire, habitat, out canColonizeBecauseAtWar);
    flag3 = PlayerEmpire.CanEmpireColonizeHabitatRange(PlayerEmpire, habitat);
} else flag4 = _Galaxy.CheckEmpireTerritoryCanBuildAtHabitat(PlayerEmpire, habitat);
Empire empire = system.DominantEmpire?.Empire;     // system = _Galaxy.Systems[habitat.SystemIndex]
if (!flag3) { color1 = (192,48,48); str3 = "Too far from existing colonies"; }
else if (habitat.Ruin != null && habitat.Ruin.PlayerEmpireEncountered && (Ruin.BonusDefensive > 0.0 || BonusDiplomacy > 0.0 || BonusHappiness > 0.0 || BonusResearchEnergy > 0.0 || BonusResearchHighTech > 0.0 || BonusResearchWeapons > 0.0 || BonusWealth > 0.0))
    { color1 = (96,96,255); str3 = Format("Special ruins at this X", ResolveDescription(habitat.Category).ToLower()); }
else if (habitat.Resources != null && habitat.Resources.HasSuperLuxuryResources() && PlayerEmpire.ResourceMap.CheckResourcesKnown(habitat))
    { color1 = (96,96,255); str3 = Format("Special luxury resources at this X", ResolveDescription(habitat.Category).ToLower()); }
else if (bindingForColonization && empire == PlayerEmpire && habitat.Quality >= 0.5)
    { color1 = (0,192,0); str3 = Format("X is in one of our systems", ResolveDescription(habitat.Category)); }
else if (!bindingForColonization && empire == PlayerEmpire)
    { color1 = (0,192,0); str3 = Format("X is in one of our systems", ResolveDescription(habitat.Category)); }
else if (PlayerEmpire.CheckNearPirateBase(habitat, habitat.Xpos, habitat.Ypos))
    { color1 = (192,192,0); str3 = "Pirate base in this system"; }
else if (bindingForColonization && flag4 && canColonizeBecauseAtWar)
    { color1 = (192,48,48); str3 = "Colonization target in another empire's system"; }
else if (!bindingForColonization && !flag4)
    { color1 = (192,48,48); str3 = "Mining location in another empire's system"; }
else if (bindingForColonization && _Galaxy.CheckColonizationLikeliness(habitat, PlayerEmpire.DominantRace) <= -5)
    { color1 = (192,192,0); str3 = "Colonization unlikely due to hostile population"; }
else if (bindingForColonization && !flag1 && _Galaxy.CheckInStorm(habitat.Xpos, habitat.Ypos))
    { color1 = (224,128,0); str3 = "Galactic storm makes colonization hazardous"; }
else if (!bindingForColonization && !flag2 && _Galaxy.CheckInStorm(habitat.Xpos, habitat.Ypos))
    { color1 = (224,128,0); str3 = "Galactic storm makes construction hazardous"; }
else if (bindingForColonization && habitat.Quality < 0.5)
    { color1 = (224,128,0); str3 = "Low quality makes colonization undesirable"; }
else if (PlayerEmpire.CheckWhetherHabitatIsDangerous(habitat))
    { color1 = (192,192,0); str3 = "Our last scan of this location showed nearby pirates or space monsters"; }
```
GameText values: `Special ruins at this X` = "Special ruins at this {0}!", `Special luxury resources at this X` = "Special luxury resources at this {0}!", `X is in one of our systems` = "{0} is in one of our systems". The others are the key text itself. `CheckNearPirateBase(Habitat, x, y)` is the overload with `scanRange = (int)(MaxSolarSystemSize * 2.1)` = `Math.trunc(23000 * 2.1)` and `empireToExclude = null` (resourceTargets.ts comment above `checkNearPirateBase`).

## Steps

1. `src/ui/screens/expansionPlanner.ts`
   - Header comment: task 16a, streamlined Expansion Planner (F3). Cite Main.Part4.cs method_532 / method_538 / btnExpansionPlannerGotoTarget_Click and HabitatPrioritizationListView.cs BindData. Add:
     - `// TODO(port): "Your Empire Resource Locations" mode — Empire.ResolveResourceSupplyLocations is not ported (Main.Part4.cs:2382)`
     - `// TODO(port): canColonizeBecauseAtWar — galaxy.checkEmpireTerritoryCanColonizeHabitat does not return the C# out parameter (Galaxy.cs 3613), so the "Colonization target in another empire's system" status never shows`
     - `// TODO(port): galaxy mini-map, deficient-resources grid (Main.Part11.cs:2393 IdentifyDeficientEmpireResources), available ships + Build Colony Ship (Main.Part4.cs method_533), resource/percent filters (Main.Part4.cs FilterOutHabitatPrioritizationList) — not in 16a`
   - Imports: `import './expansionPlanner.css';`, `import type` for `Empire`, `Galaxy`, `Habitat`, `BuiltObject`, `Ruin` (`../../sim/ruins`); value imports of the sim functions listed above; `HabitatCategoryType`, `HabitatType` from `../../sim/types`; `BuiltObjectSubRole` from `../../sim/builtObjectTypes`; `habitatTypeLabel`, `rgbCss` from `../hud`; `formatThousandsK` from `./coloniesList`.
   - `export type ExpansionMode = 'colonies' | 'resourcesyou' | 'resourcesgalaxy' | 'resourcessupply';`
   - `export const EXPANSION_MODES: readonly ExpansionMode[] = ['colonies', 'resourcesyou', 'resourcesgalaxy', 'resourcessupply'];`
   - `export function expansionModeLabel(mode): string`: the four labels above, in that order.
   - `export function habitatCategoryDescription(category: HabitatCategoryType): string`: Galaxy.2.cs:2514 table.
   - `export function habitatTypeDescription(type: HabitatType, category: HabitatCategoryType): string`: ResolveHabitatTypeDescription. `str1` is `habitatTypeLabel(type)` (no category argument).
   - `export function resourcesDescription(resources: readonly { resourceId: number; abundance: number }[], known: boolean, resourceName: (id: number) => string): string`: BuildResourcesDescription. `(abundance / 10).toFixed(0)` is fine for the C# `"0"` here (abundance is never negative).
   - `export function resourceRarity(resources, isSuperLuxury: (id: number) => boolean, isLuxury: (id: number) => boolean): 'VR' | 'R' | 'C'`: GetResourceCellRarity. Luxury is `resourceSystem.resources[id].type === 2`; super luxury is `superLuxuryBonusAmount > 0`.
   - `export function ruinText(ruin: Ruin | null): string`: `''` for null, else `${name} (${sign}${n}%)` with `n = Math.trunc(developmentBonus * 100)` and C# `"+##0;-##0;0"` (`'+12'`, `'-3'`, `'0'`).
   - `export function formatMillionsM(n: number): string`: C# `"0,,M"`, i.e. `${Math.round(n / 1e6)}M` (`0` → `'0M'`, `2_600_000_000` → `'2600M'`).
   - `export function qualityPercent(q: number): string`: C# `"0%"`, i.e. `${Math.round(q * 100)}%`.
   - `export function ruinHasSpecialBonus(ruin: Ruin | null): boolean`: the seven-bonus test above, with `playerEmpireEncountered` required.
   - `export interface PlannerStatusInput { forColonization: boolean; inRange: boolean; specialRuins: boolean; superLuxuryKnown: boolean; inOurSystem: boolean; quality: number; nearPirateBase: boolean; territoryOk: boolean; canColonizeBecauseAtWar: boolean; colonizationLikeliness: number; techSurvivesStorms: boolean; shipsSurviveStorms: boolean; inStorm: boolean; dangerous: boolean; category: HabitatCategoryType }`
   - `export interface PlannerStatus { color: number | null; reason: string }`. `color` is a packed RGB (`0xc03030` for (192,48,48)) or `null` for the default `(170,170,170)`.
   - `export function plannerStatus(s: PlannerStatusInput): PlannerStatus`: the ladder above, same order, same colours. `inRange` is `flag3` (always `true` when `!forColonization`), `territoryOk` is `flag4`. With no match, return `{ color: null, reason: '' }`. The `.ToLower()` applies to the category word in the two "Special …" texts only.
   - `export function plannerStatusInput(galaxy: Galaxy, player: Empire, habitat: Habitat, forColonization: boolean): PlannerStatusInput`: the sim calls that feed the ladder:
     - `inRange = forColonization ? canEmpireColonizeHabitatRange(galaxy, player, habitat) : true`;
     - `territoryOk = forColonization ? galaxy.checkEmpireTerritoryCanColonizeHabitat(player, habitat) : checkEmpireTerritoryCanBuildAtHabitat(galaxy, player, habitat)`;
     - `canColonizeBecauseAtWar = false` (TODO above);
     - `specialRuins = ruinHasSpecialBonus(habitat.ruin)`;
     - `superLuxuryKnown = habitatResourcesHaveSuperLuxury(galaxy, habitat) && player.resourceMap.checkResourcesKnown(habitat)`;
     - `inOurSystem = galaxy.systems[habitat.systemIndex]?.dominantEmpire?.empire === player`;
     - `nearPirateBase = checkNearPirateBase(galaxy, player, habitat, Math.trunc(23000 * 2.1), habitat.xpos, habitat.ypos, null)`;
     - `colonizationLikeliness = player.dominantRace ? checkColonizationLikeliness(galaxy, habitat, player.dominantRace) : 0` (only read when `forColonization`);
     - `techSurvivesStorms = checkEmpireTechCanSurviveStorms(player)`, `shipsSurviveStorms = checkConstructionShipAndMiningStationCanSurviveStorms(player)`;
     - `inStorm = checkInStorm(galaxy, habitat.xpos, habitat.ypos)`, `dangerous = checkWhetherHabitatIsDangerous(galaxy, player, habitat)`.
   - `export interface ExpansionTarget { habitat: Habitat; priority: number; assignedShip: BuiltObject | null }`
   - `export function expansionTargets(mode, galaxy, player, opts: { includeLowQuality: boolean; includeAsteroids: boolean }): ExpansionTarget[]`: method_532's switch.
     - `'colonies'` → `identifyColonizationTargetsFull(galaxy, player, false, 0, 5000, opts.includeLowQuality, true)`;
     - `'resourcesyou'` → `prioritizeEmpireResourceNeeds(galaxy, player, true, 49, 0.001, false, opts.includeAsteroids)`;
     - `'resourcesgalaxy'` → `identifyResourceCentres(galaxy, player, false, false, opts.includeAsteroids)`;
     - `'resourcessupply'` → `[]`.
     - Drop entries whose `habitat` is null. `assignedShip` is `(x.assignedShip ?? null) as BuiltObject | null`.
   - `export interface ExpansionRow { habitat: Habitat; name: string; type: string; size: string; quality: string; distance: string; race: string; population: string; resources: string; ruins: string; assigned: string; assignedTip: string; rarity: string; color: number | null; reason: string }`
   - `export function expansionRow(galaxy: Galaxy, player: Empire, t: ExpansionTarget, forColonization: boolean): ExpansionRow`: BindData, one row.
     - `size = formatThousandsK(Math.trunc(habitat.diameter) * 100)`;
     - `distance`: the nearest space port from `fastFindNearestSpacePort(galaxy, x, y, player)`, then `formatThousandsK(galaxy.calculateDistance(...))`, else `formatThousandsK(99999999)`;
     - `race = habitat.population.dominantRace?.name ?? ''`, `population = formatMillionsM(habitat.population.totalAmount)`;
     - `resources = resourcesDescription(habitat.resources, player.resourceMap.checkResourcesKnown(habitat), (id) => galaxy.resourceSystem.resources[id]?.name ?? '')`;
     - `assigned = t.assignedShip?.name ?? ''`. `assignedTip` is `'${name}' colonizing here` for a `BuiltObjectSubRole.ColonyShip`, `'${name}' building mining station here` for a `ConstructionShip`, else `''`;
     - `{ color, reason } = plannerStatus(plannerStatusInput(galaxy, player, habitat, forColonization))`.
   - DOM, like coloniesList:
     - `export interface ExpansionPlannerOptions { empire: Empire; onSelect: (h: Habitat) => void }`, `toggleExpansionPlanner(opts)`, `closeExpansionPlanner()`.
     - The window is titled `Expansion Planner (N)`, `N` being the row count.
     - A toolbar with:
       - a `<select>` of the four modes. `'resourcessupply'` is `disabled`, with `title="not yet available"`;
       - one checkbox, relabelled per mode: `Show low-quality colonies` in colonies mode, `Show asteroids` in the two resource modes. Keep two separate booleans, both `false` initially;
       - a `Refresh` button.
     - A table: header cells Name | Type | Size | Quality | Distance | Race | Pop | Resources | (blank: Ruins) | (blank: Assigned) | (blank: Rarity).
       - Numbers are right-aligned.
       - A row with `color !== null` gets `style.color = rgbCss(color)`.
       - Every cell's `title` is `reason`, except the Assigned cell, whose title is `assignedTip` when that is non-empty (the C# fills a cell tooltip only when it is empty).
     - Rows are recomputed **only** on open, on a mode or checkbox change, and on Refresh: the colonisation search walks every explored system. There is no 1-second timer.
     - A row click runs `close(); opts.onSelect(row.habitat);`.
     - The empty state is `<div class="expansion-planner-empty">No targets</div>`.
     - Keep the last selected mode in a module-level variable, so reopening shows the same mode (BaconMain.method_532_SetExpansionPlanner does the same).
2. `src/ui/screens/expansionPlanner.css`: copy `coloniesList.css`, with the prefix `expansion-planner-` in place of `colonies-list-`.
   - `.expansion-planner-window` is `width: 960px`, with the body scrolling (`max-height: 70vh; overflow-y: auto`).
   - The table uses `font-size: 12px`. The Resources column may wrap; the other columns do not.
   - Add `.expansion-planner-toolbar { display: flex; gap: 10px; align-items: center; }` and `.expansion-planner-number { text-align: right; }`.
3. `src/ui/hud.ts`: four blocks, all inside `[16a]` / `[/16a]` comments.
   - a. Import, right after `import { toggleEmpiresList } from './screens/empiresList';`:
     ```ts
     import { toggleExpansionPlanner } from './screens/expansionPlanner'; // [16a]
     ```
   - b. Module-level hook, right after the `// [/15c]` line that closes the `selectShipGroup` block (just above `/** Build the HUD overlay and append it to document.body. */`):
     ```ts
     // [16a] Habitat selection hook: buildSelectionPanel registers it; the Expansion
     // Planner calls selectHabitat (Main.Part4.cs:3027/3038 GotoTarget / SelectTarget).
     let habitatSelectHandler: ((h: Habitat, moveView: boolean) => void) | null = null;
     export function selectHabitat(h: Habitat, moveView = true): void {
         habitatSelectHandler?.(h, moveView);
     }
     // [/16a]
     ```
   - c. In `buildSelectionPanel`, right after the `    // [/15c]` line that closes the `shipGroupSelectHandler = (sg, moveView) => { … };` block (just above `    // Refresh the header/body from the current selection.`):
     ```ts
         // [16a] Select a habitat (the same calls as the colony cycler) and optionally move the view.
         habitatSelectHandler = (h, moveView) => {
             const galaxy = wiring.galaxy;
             if (!galaxy) return;
             const system = galaxy.systems.find((s) => s.habitats.includes(h)) ?? galaxy.systems[h.systemIndex];
             if (!system) return;
             wiring.onSelectionChange?.({ habitat: h, system });
             const cam = wiring.camera;
             if (moveView && cam) {
                 cam.centerOn(h.xpos, h.ypos);
                 cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
             }
         };
         // [/16a]
     ```
   - d. Top bar. In `buildTopBarButton`'s click listener, right after the `        // [/15b]` line and before `        const screen = topBarScreen(name);`:
     ```ts
             // [16a] btnExpansionPlanner → Expansion Planner (Main.Part4.cs:2974 btnExpansionPlanner_Click).
             if (name === 'btnExpansionPlanner') {
                 const src = getEmpireSummarySource();
                 if (src) toggleExpansionPlanner({ empire: src.empire, onSelect: (h) => selectHabitat(h, true) });
                 return;
             }
             // [/16a]
     ```
     Do not touch `TopBarScreen` / `topBarScreen`.
4. `src/ui/keyboard.ts`: three blocks, nothing else.
   - Import, right after `import { Camera } from '../render/camera';`:
     ```ts
     import { toggleExpansionPlanner } from './screens/expansionPlanner'; import { selectHabitat } from './hud'; // [16a]
     ```
     Keep it on one line. keyboard.ts already imports from `./hud`; a second import statement is legal.
   - `dispatchKey` switch: insert immediately **before** `case 'galaxyMap':`, i.e. after the `scrollRight` case's `break;`:
     ```ts
         // [16a] F3: Expansion Planner (task 16a); a row selects + zooms to the planet.
         case 'expansionPlannerScreen': {
             const src = getEmpireSummarySource();
             if (src) toggleExpansionPlanner({ empire: src.empire, onSelect: (h) => selectHabitat(h, true) });
             break;
         }
         // [/16a]
     ```
   - `IMPLEMENTED_KEY_ACTIONS`: a new line right after `'diplomacyScreen', // [15a]`:
     ```ts
         'expansionPlannerScreen', // [16a]
     ```
5. `src/main.ts`: two lines.
   - After `import { closeDiplomacyScreen } from './ui/screens/diplomacyScreen'; // [15a]`, add `import { closeExpansionPlanner } from './ui/screens/expansionPlanner'; // [16a]`.
   - In `activeGameViewCleanup`, right after `closeDiplomacyScreen(); // [15a]`, add `closeExpansionPlanner(); // [16a]`.

## Tests (`test/expansionPlanner.test.ts`, no jsdom)

Importing the module pulls in its `.css` and `../hud`; vitest handles both (see fleetsList.test.ts). Build every input as a plain object, and cast fakes with `as unknown as …`.

- `expansionModeLabel`: `'colonies'` → 'Potential Colonies'; `'resourcessupply'` → 'Your Empire Resource Locations'.
- `habitatTypeDescription`:
  - (Continental, Planet) → 'Continental Planet';
  - (MarshySwamp, Moon) → 'Marshy Swamp Moon';
  - (BarrenRock, Asteroid) → 'Asteroid';
  - (Ice, Asteroid) → 'Ice Asteroid'.
- `habitatCategoryDescription(GasCloud)` → 'Gas Cloud'.
- `resourcesDescription`:
  - `known = false` → '(Unknown resources)';
  - `[]` known → '(No resources)';
  - `[{resourceId: 1, abundance: 125}, {resourceId: 2, abundance: 30}]` with names Iron/Gold → 'Iron (13%), Gold (3%)'.
- `resourceRarity`: `[]` → 'C'; with a luxury id → 'R'; with both a luxury and a super-luxury id → 'VR'.
- `ruinText`: null → ''; `{ name: 'Ancient Temple', developmentBonus: 0.12 }` → 'Ancient Temple (+12%)'; `developmentBonus: -0.034` → 'Ancient Temple (-3%)'; `0` → 'Ancient Temple (0%)'.
- `formatMillionsM(2_600_000_000)` → '2600M'; `qualityPercent(0.5)` → '50%'.
- `ruinHasSpecialBonus`: null → false; `bonusWealth = 1` but `playerEmpireEncountered = false` → false; both set → true.
- `plannerStatus`. Base input: `forColonization: true`, `inRange: true`, `quality: 0.6`, `territoryOk: true`, `colonizationLikeliness: 0`, `techSurvivesStorms: true`, `shipsSurviveStorms: true`, `category: Planet`, every other flag `false`. Then:
  - base → `{ color: null, reason: '' }`;
  - `inRange: false` → `0xc03030`, 'Too far from existing colonies'. This wins even with `specialRuins: true` (first match);
  - `specialRuins: true` → `0x6060ff`, 'Special ruins at this planet!';
  - `superLuxuryKnown: true` → 'Special luxury resources at this planet!';
  - `inOurSystem: true` → `0x00c000`, 'Planet is in one of our systems'. With `quality: 0.4` it falls through to `0xe08000` 'Low quality makes colonization undesirable';
  - `forColonization: false, inOurSystem: true` → 'Planet is in one of our systems';
  - `nearPirateBase: true` → `0xc0c000`, 'Pirate base in this system';
  - `forColonization: false, territoryOk: false` → 'Mining location in another empire's system';
  - `colonizationLikeliness: -5` → 'Colonization unlikely due to hostile population'; `-4` → no match;
  - `inStorm: true, techSurvivesStorms: false` → 'Galactic storm makes colonization hazardous'. With `techSurvivesStorms: true` → no match;
  - `forColonization: false, inStorm: true, shipsSurviveStorms: false` → 'Galactic storm makes construction hazardous';
  - `dangerous: true` → 'Our last scan of this location showed nearby pirates or space monsters'.
- `isKeyActionAvailable('expansionPlannerScreen')` → true.

`expansionTargets`, `plannerStatusInput` and `expansionRow` need a real galaxy; exercise them by hand in the running game.

Run `npm run typecheck && npm test`. keyboard.test.ts, hud.test.ts and hudTopBar.test.ts must pass unchanged. With `npm run dev` on a private port (other agents share 5173), save `node scripts/shot.mjs 'http://localhost:<port>/?autostart=1' shots/16a-expansion-planner.png` after pressing F3 (drive it the way the 15x workers did). Do not open the image. Then append `## Worker report` with: the files changed, the shot.mjs console output, and anything left undone.
