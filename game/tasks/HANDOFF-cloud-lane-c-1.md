# Handoff — cloud lane C, task C1: visibility / fog of war (sim only)

Branch `claude/cloud-lane-c1` (based on working branch `8bc6f08`). Adds only `src/sim/visibility.ts`, `test/visibility.test.ts` and this note. No edits to empire.ts, galaxy.ts, main.ts, src/ui or src/render. Typecheck clean; full suite passes.

## What's ported (all C# refs in DistantWorlds.Types/)
- `SystemVisibilityStatus` (enum), `SystemVisibility` (serialized fields), `countExploredSystems` (SystemVisibilityList).
- `GalaxyResourceMap`: the per-empire "resources known" bit map (one bit per habitat index); set/check/merge/setSystemResourcesKnown.
- `EmpireVisibility`: the visibility state an Empire holds (SystemVisibility list, ResourceMap, SystemsVisible, EmpiresSharedVisibility, KnownGalaxyLocations) plus the Empire.9.cs checks: CheckSystemVisible / CheckSystemVisibilityStatus / CheckSystemExplored (all shared-visibility aware), SetSystemVisibility, both ResolveSystemVisibility overloads, the 4-arg CheckSystemVisible, IsObjectVisibleToThisEmpire(Creature), Set/ClearEmpireSharedVisibility, MergeGalaxyMapsForSharedVisibilityEmpires, and KnownGalaxyLocations discovery (BuiltObject.1.cs 1968-1986).
- Free functions: `mergeGalaxyMap` (Galaxy.4.cs 3700), `setEmpireExplorationAmount` (Galaxy.7.cs 4922; game-start exploration around the capital), `findNearestUnexploredHabitat` (Galaxy.6.cs 4501), `setSystemHabitatsExploration` (Galaxy.9.cs 3331), `determineGalaxyLocationsInRangeAtPoint` (Galaxy.4.cs 2012).
- **No Rnd:** none of these C# methods use Rnd, and a test checks the galaxy stream is untouched.

## Hooks for later wiring
| Where | Call | C# origin |
|---|---|---|
| Empire ctor (M2a) | `this.visibility = new EmpireVisibility(galaxy, ownerHooks)` | Empire.cs 3760, 3831-3840 |
| Empire | implement `VisibilityOwner`: `isIndependent`, `active`, `controlsHabitat(h)` (Owner == this, or pirate control), `hasUnitInSystem(star, exclude)` (BuiltObjects + PrivateBuiltObjects), `longRangeScanners()`, `hasShipOutsideSystemWithScanRange(x, y)` | Empire.9.cs 4729, 3037 |
| GenerateEmpire (M2c) | `empire.visibility.resolveSystemVisibilityAt(capital.xpos, capital.ypos)` then `setEmpireExplorationAmount(galaxy, empire.visibility, capital, val2)` | Galaxy.7.cs 5278, 5325-5338 |
| MakeHabitatIntoColony (M2b) | `empire.visibility.resolveSystemVisibilityAt(habitat.xpos, habitat.ypos)` | Galaxy.8.cs 696 |
| Colony lost/gained (Empire.1.cs 370, 894) | `resolveSystemVisibilityAt(x, y, null, lostHabitat)` | Habitat.cs 4176, 7601 |
| Ship moves between systems | `resolveSystemVisibilityForUnit(ship, excludeSelf)` + `discoverGalaxyLocations(ship)` | BuiltObject.cs 3874, BuiltObject.2.cs 3087/3194/5549 |
| Galaxy.addHabitat (08e1) | `setSystemHabitatsExploration([...empires, ...pirates, independent].map(e => e.visibility), [habitat], star)` | Galaxy.9.cs 3241 |
| Empire tick | `mergeGalaxyMapsForSharedVisibilityEmpires(onContact)` | Empire.1.cs 1060 |
| Diplomacy | pass a `ContactFromGalaxyMapHook` to mergeGalaxyMap / set/clearEmpireSharedVisibility | Galaxy.4.cs 3718-3760 |
| Render (fog) | `checkSystemExplored(i)` / `checkSystemVisible(i)` / `isCreatureVisible(c)` for the player's empire | — |

## Deviation found (fix in galaxy.ts, suggest C2)
In C#, **every generated habitat group becomes a SystemInfo, gas clouds included** (Galaxy.4.cs 2335-2347, after `list.Sort()`). The TS `generateGalaxy` builds systems only for stars, so gas clouds have `systemIndex = 0` (the default) and no SystemVisibility entry. `visibility.ts` guards gas clouds explicitly (`setEmpireExplorationAmount` treats them as a no-op, as in C#, but without writing to system 0). Once galaxy.ts adds gas-cloud systems, remove that guard. The C# `list.Sort()` order is also not ported, which only affects nearest-habitat tie-breaks.

## TODO(port) left
Threat/link lists on SystemVisibility (AI), the diplomatic-contact body of MergeGalaxyMap (hook), empire messages for discovered locations, the `_Reindexing` guard.
