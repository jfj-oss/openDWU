# Task 13e — Galaxy Map filters use the real player Empire instead of GOD_MODE_PLAYER

thinking: off
scope: locked

Edit only these files:
- `src/ui/screens/galaxyMap.ts`
- a new `test/galaxyMap-player.test.ts`. The existing `test/galaxyMap.test.ts` must keep passing unchanged.

Do NOT edit anything under `src/sim/` (another lane owns it). Do NOT edit `src/main.ts`: `createGalaxyMap` picks up the player from `galaxy.playerEmpire` itself, so `createGalaxyMapFor` in main.ts needs no change. This task is file-disjoint from 13d and 13f. Start editing right away.

## Existing code you use (read-only; verified to exist)

- `galaxyMap.ts` already has `interface GalaxyMapPlayer { systemExplored(i); resourcesKnown(h); colonies(); colonizationTargets(); enemyColonies(); knownPirateBaseHabitats() }`, `GOD_MODE_PLAYER`, and `computeViewModeSelection(galaxy, mode, player, opts)`. That function already applies the C# visibility filters for each mode. `createGalaxyMap(opts)` (~line 376) starts with `const { galaxy } = opts; const player = opts.player ?? GOD_MODE_PLAYER;`.
- `galaxy.playerEmpire: Empire | null` and `galaxy.independentEmpire: Empire | null` (src/sim/galaxy.ts). Both new games and loaded saves set `playerEmpire`. It is null on the generateGalaxy-only boot.
- `Empire` (src/sim/empire.ts):
  - `visibility: EmpireVisibility`, which has `systemVisibility: SystemVisibility[]` and `checkSystemExplored(systemIndex: number): boolean`. The latter ports Empire.9.cs CheckSystemExplored: true when the status is Visible or Explored, including shared-visibility empires. It indexes `systemVisibility[systemIndex]` without a bounds check, so guard the index.
  - `resourceMap` (getter) → `GalaxyResourceMap`, which has `checkResourcesKnown(habitat: Habitat): boolean`.
  - `colonies: Habitat[]`.
  - `diplomaticRelations: DiplomaticRelationList`, iterable with `for…of`. Each `DiplomaticRelation` has `type: DiplomaticRelationType` and `otherEmpire: Empire | null`.
  - `knownPirateBases: BuiltObject[]`. It exists but is not filled by the sim yet (TODO(port) there), so it is empty today. `BuiltObject.parentHabitat: Habitat | null`.
- `DiplomaticRelationType { NotMet, None, FreeTradeAgreement, MutualDefensePact, SubjugatedDominion, Protectorate, TradeSanctions, War, Truce }` is exported from `src/sim/diplomacy.ts`.
- Test-only imports: `EmpireVisibility` and `SystemVisibilityStatus` from `src/sim/visibility.ts`. `new EmpireVisibility(galaxy)` makes one Unexplored entry per system. `vis.setSystemVisibility(systemStar, status)`, `vis.resourceMap.setResourcesKnown(h, true)`.

## C# source (verbatim, trimmed): Main.Part9.cs:3663 cmbGalaxyMapViewMode_SelectedValueChanged

```cs
case 1: /* Our Systems */ habitatList_2 = _Game.PlayerEmpire.Colonies; ...
case 2: /* Potential Colonies */ _Game.PlayerEmpire.IdentifyColonizationTargets(_Game.Galaxy, filterOutDangerousTargets: false, 0, 500)
case 3: /* Known Resources */ if (... !_Game.PlayerEmpire.ResourceMap.CheckResourcesKnown(habitat5)) continue;
case 4: /* Explored */ SystemVisibilityStatus s = _Game.PlayerEmpire.CheckSystemVisibilityStatus(h.SystemIndex);
        if (s == Visible || s == Explored) { ... if (ResourceMap.CheckResourcesKnown(h)) habitatList_2.Add(h); }
case 5: /* Independent Populations */
        if (habitat14.Population.TotalAmount <= 0L || (habitat14.Empire != _Game.Galaxy.IndependentEmpire && habitat14.Empire != null)) continue;
        // then the Visible/Explored check
case 6: /* Enemy Systems */
        for (int num2 = 0; num2 < _Game.PlayerEmpire.DiplomaticRelations.Count; num2++) {
            DiplomaticRelation diplomaticRelation = _Game.PlayerEmpire.DiplomaticRelations[num2];
            if (diplomaticRelation.Type != DiplomaticRelationType.War) continue;
            Empire otherEmpire = diplomaticRelation.OtherEmpire;
            if (otherEmpire == null || otherEmpire == _Game.PlayerEmpire) continue;
            foreach (Habitat colony in otherEmpire.Colonies) { /* Explored/Visible system check */ ... habitatList_2.Add(colony); } }
case 7: /* Pirate Bases */
        for (int num = 0; num < _Game.PlayerEmpire.KnownPirateBases.Count; num++) {
            BuiltObject builtObject = _Game.PlayerEmpire.KnownPirateBases[num];
            if (builtObject.ParentHabitat != null) { ... habitatList_2.Add(builtObject.ParentHabitat); } }
```
`CheckSystemVisibilityStatus(i)` being Visible or Explored is exactly `checkSystemExplored(i)`. `IdentifyColonizationTargets` is not ported in the sim. `Empire.colonizationTargets` is the AI's stored list, which is a different thing, so do not use it.

## Steps (all in src/ui/screens/galaxyMap.ts)

1. Add `import type { Empire } from '../../sim/empire';` and `import { DiplomaticRelationType } from '../../sim/diplomacy';`.
2. Add, right after `GOD_MODE_PLAYER`:
   ```ts
   // Task 13e: the Galaxy Map's view of the real player empire (Main.Part9.cs
   // cmbGalaxyMapViewMode_SelectedValueChanged reads these off PlayerEmpire).
   export function empireGalaxyMapPlayer(empire: Empire): GalaxyMapPlayer
   ```
   It returns an object whose methods read the empire live each call, with no caching:
   - `systemExplored(i)`: `i >= 0 && i < empire.visibility.systemVisibility.length && empire.visibility.checkSystemExplored(i)`.
   - `resourcesKnown(h)`: `empire.resourceMap.checkResourcesKnown(h)`.
   - `colonies()`: `empire.colonies`.
   - `colonizationTargets()`: `[]`, with `// TODO(port): Empire.IdentifyColonizationTargets(galaxy, false, 0, 500) — not in sim`.
   - `enemyColonies()`: loop `for (const rel of empire.diplomaticRelations)`, skipping `rel.type !== DiplomaticRelationType.War`, `rel.otherEmpire === null`, and `rel.otherEmpire === empire`. Push every habitat of `rel.otherEmpire.colonies`, in order, and return the array. The Explored check stays in `computeViewModeSelection`.
   - `knownPirateBaseHabitats()`: for each `b` of `empire.knownPirateBases`, push `b.parentHabitat` when non-null. Add a comment that the sim does not fill `knownPirateBases` yet, so this is empty for now.
3. `computeViewModeSelection`, the `IndependentPopulations` case: replace the `TODO(port): owner check` comment and the population check with the C# condition:
   ```ts
   if (h.population.totalAmount <= 0 || (h.empire !== galaxy.independentEmpire && h.empire !== null)) continue;
   ```
   Keep the rest (the `explored(h)` check and the pushes) unchanged.
4. `createGalaxyMap`: change the player line to
   ```ts
   // Task 13e: the real player empire when there is one; god mode only on the
   // generateGalaxy-only boot (no empires).
   const player = opts.player ?? (galaxy.playerEmpire !== null ? empireGalaxyMapPlayer(galaxy.playerEmpire) : GOD_MODE_PLAYER);
   ```
5. Update the comment above `GalaxyMapPlayer` ("Until empires exist (M2)…"). It should now say that `empireGalaxyMapPlayer` is used in games and `GOD_MODE_PLAYER` only without a player empire.

## Tests (`test/galaxyMap-player.test.ts`, no jsdom)

Build the galaxy like galaxyMap.test.ts does: `generateGalaxy({ seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`) })`.

- Real visibility:
  - Set up the fake empire:
    ```ts
    const vis = new EmpireVisibility(galaxy);
    const emp = { visibility: vis, resourceMap: vis.resourceMap, colonies: [], diplomaticRelations: [], knownPirateBases: [] } as unknown as Empire;
    ```
  - `vis.setSystemVisibility(galaxy.systems[3].systemStar, SystemVisibilityStatus.Explored)`.
  - Then `p = empireGalaxyMapPlayer(emp)`. Expect:
    - `p.systemExplored(3)` true, `p.systemExplored(4)` false;
    - `p.systemExplored(-1)` false, `p.systemExplored(galaxy.systems.length + 5)` false;
    - `computeViewModeSelection(galaxy, GalaxyMapViewMode.ExploredSystems, p).systems` contains `galaxy.systems[3].systemStar` and does not contain `galaxy.systems[4].systemStar`.
  - `h = galaxy.systems[3].systemStar`: `p.resourcesKnown(h)` is false, then after `vis.resourceMap.setResourcesKnown(h, true)` it is true.
- Enemy colonies:
  - Fakes: `enemy = { colonies: [e1, e2] }`, `friend = { colonies: [f1] }`, where e1/e2/f1 are distinct `{}` objects cast to Habitat.
  - Relations: `[{ type: War, otherEmpire: enemy }, { type: None, otherEmpire: friend }, { type: War, otherEmpire: null }, { type: War, otherEmpire: emp }]`. A plain array works, since the builder only uses `for…of`.
  - Expect `enemyColonies()` → `[e1, e2]`.
- Pirate bases: `knownPirateBases: [{ parentHabitat: ph }, { parentHabitat: null }]` → `[ph]`.
- `colonies()` returns the empire's own array; `colonizationTargets()` → `[]`.
- IndependentPopulations owner check, with a fake galaxy:
  ```ts
  { habitats: [a, b, c], independentEmpire: ind, determineHabitatSystemStar: () => star } as unknown as Galaxy
  ```
  - Each of a/b/c is `{ population: { totalAmount: 5 }, category: HabitatCategoryType.Planet, systemIndex: 0, empire }`, with empires `null`, `ind`, and some other object.
  - With `GOD_MODE_PLAYER`, expect `habitats` → `[a, b]` and `systems` → `[star]`.

Run `npm run typecheck && npm test`. With `npm run dev` running, save `node scripts/shot.mjs 'http://localhost:5173/?autostart=1' shots/13e-galaxy-map.png`. Do not open it. Then append `## Worker report`: files changed, the shot.mjs console output, and anything left undone.

## Worker report

Files changed:
- `src/ui/screens/galaxyMap.ts` — added `Empire` / `DiplomaticRelationType` imports; new `empireGalaxyMapPlayer(empire)` after `GOD_MODE_PLAYER` (live reads, no caching; index-guarded `systemExplored`; `colonizationTargets()` returns `[]` with a TODO(port) for `IdentifyColonizationTargets`); `IndependentPopulations` now applies the C# owner check (`population.totalAmount <= 0 || (h.empire !== galaxy.independentEmpire && h.empire !== null)`); `createGalaxyMap` uses `galaxy.playerEmpire` when set, else `GOD_MODE_PLAYER`; updated the `GalaxyMapPlayer` comment.
- `test/galaxyMap-player.test.ts` (new) — visibility/resource guards, Explored Systems selection, enemy-colony relation filtering, pirate-base parent habitats, colonies/colonizationTargets, and the IndependentPopulations owner check on a fake galaxy.

Verification:
- `npm run typecheck` passes; `npm test` → 87 files / 868 tests pass (existing `test/galaxyMap.test.ts` unchanged and green).
- `node scripts/shot.mjs 'http://localhost:5173/?autostart=1' shots/13e-galaxy-map.png` → `[debug] [vite] connecting...`, `[debug] [vite] connected.`, `saved shots/13e-galaxy-map.png` — no console errors. Screenshot at `shots/13e-galaxy-map.png` (not opened here).

Notes / deviations:
- The task's suggested negative case `galaxy.systems[4].systemStar` is a gas cloud in this seed, and gas clouds count as always explored, so the Explored Systems test asserts against `systems[9]` (a star) instead. Positive case (`systems[3]`) is unchanged.
- Left undone (by design): `colonizationTargets()` stays `[]` until `Empire.IdentifyColonizationTargets` is ported to the sim; `knownPirateBaseHabitats()` is empty until the sim fills `Empire.knownPirateBases` (both marked with TODO(port) comments).
