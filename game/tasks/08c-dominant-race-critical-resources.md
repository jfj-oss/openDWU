# Task 08c — SelectResources: dominant-race critical resources

thinking: off
scope: locked

Everything you need is here. Edit `src/sim/data/races.ts`, `src/sim/galaxy.ts` and tests. Start editing right away.

## Gap
`galaxy.ts selectResources` has a `TODO(port)` stub where the C# adds the dominant race's critical resources, and `Race` has no `CriticalResources` (the `Resource1Type…Resource3AppliesOnlyToSource` fields end up in `extra`).

**Source quirk (keep it):** the 4-arg C# overload drops the race (`SelectResources(habitat, min, null, minCrit, null)`), and the only caller that passes a race (Galaxy.7.cs:5375, capital setup) uses that overload. So in the original game this branch only runs when the 5-arg overload is called directly. The TS collapses the overloads into default parameters, so port the branch as-is and note the quirk in a comment. Any future 4-arg call site must pass `null` for the race.

## Source (verbatim C#)
```csharp
// Galaxy.4.cs 3280
public Habitat SelectResources(Habitat habitat, int minimumResourceCount, Race dominantRace, int minimumCriticalResourceCount)
{ return SelectResources(habitat, minimumResourceCount, null, minimumCriticalResourceCount, null); }

// Galaxy.4.cs 3285 (5-arg), after minimumCriticalResourceCount = Math.Min(minimumCriticalResourceCount, num2);
ResourceList resourceList = new ResourceList();
if (dominantRace != null && minimumResourceCount > 0)
{
    ResourceList resourceList2 = dominantRace.CriticalResources.ResolveResources();
    for (int i = 0; i < resourceList2.Count && i < minimumCriticalResourceCount; i++)
        resourceList.Add(resourceList2[i]);
    ResourceList resourceList3 = ResourceSystem.Resources.ResolveValidResourcesForHabitatExcludeManufactured(habitat);
    for (int j = 0; j < resourceList.Count; j++)
        if (resourceList3.Contains(resourceList[j]))   // compares ResourceID
            habitat.Resources.Add(new HabitatResource(resourceList[j].ResourceID, Rnd.Next(200, 800)));  // Add rejects duplicate IDs
}

// ResourceBonusList.cs ResolveResources: one Resource(resourceBonus.ResourceId) per non-null bonus, in order.

// ResourceDefinitionList.cs 111 ResolveValidResourcesForHabitatExcludeManufactured(habitat):
// for each def with ColonyManufacturingLevel <= 0 && Prevalence.Count > 0:
//   for each prevalence with prevalence.HabitatType == habitat.Type:
//     Planet/Moon: !IsAsteroid && !IsGasCloud; Asteroid: IsAsteroid && !IsGasCloud; GasCloud: IsGasCloud && !IsAsteroid
//     if ok: add Resource(def.ResourceID); break;
// (= CheckPrevalenceValidForHabitat per prevalence; no SuperLuxury filter.)

// Race.cs LoadFromFile: locals resourceIdN = byte.MaxValue, effectN = Undefined(0), valueN = 0.0, appliesN = false
case "Resource1Type": b = ParseByteValue(v); resourceId = b;          // byte.TryParse, failure -> 0
case "Resource1Effect": byte e = (byte)ParseIntValue(v); if (Enum.IsDefined(typeof(ColonyResourceEffect), e)) effect = e;  // 0..11
case "Resource1Amount": value2 = ParseDoubleValue(v);
case "Resource1AppliesOnlyToSource": applies = ParseBoolValue(v);     // "y" -> true
// (same for 2, 3), then after the loop, in order 1,2,3:
if (colonyResourceEffect != 0) race.CriticalResources.Add(new ResourceBonus(resourceId, effect, value2, applies));
```

## Implement
1. `races.ts`: export `interface ResourceBonus { resourceId; effect; value; appliesOnlyToSources }`; add `criticalResources: ResourceBonus[]` to `Race`, parsed as above (remove those 12 keys from `extra`).
2. `galaxy.ts`: type `dominantRace` as `Race | null`; replace the TODO with the branch above (Rnd = `this.rnd`, before `randomOrderedResources`), plus a private `resolveValidResourcesForHabitatExcludeManufactured(habitat): number[]`.
3. Tests: every parsed race has 0–3 critical resources with effect 1..11; a direct `selectResources` call with a race whose critical resource is valid for the habitat adds it first with abundance in [200,800); no race / `minimumResourceCount = 0` leaves the Rnd sequence unchanged (compare with a fresh galaxy); existing galaxy pins unchanged.

`npm run typecheck` && `npm test`. Append `## Worker report`.

## Worker report (cloud)
- `races.ts`: `ResourceBonus` + `Race.criticalResources` (Race.cs LoadFromFile Resource1..3*), keys removed from `extra`.
- `galaxy.ts`: dominant-race branch of `selectResources` + `resolveValidResourcesForHabitatExcludeManufactured`; 4-arg-overload quirk documented.
- `test/selectResources.test.ts`: 4 tests. Typecheck clean; 213/213 pass; existing pins unchanged.
