# 19d2 — Resource crises: scarcity shocks and their propagation

Scenario package on the mod layer (`tasks/MODLAYER-DESIGN.md`). Accepted idea 19d-2 (`tasks/19-mod-layer-scenarios.md`):
scarcity shocks propagate through the private economy — luxury loss → unrest, fuel-out → grounded fleets, price spikes →
smuggling. Shared infrastructure (scenario folder, approval-term hook, player decisions, Rnd policy, common tests) is
**§S of `tasks/19d1-internal-politics.md`**; if it is not in your base yet, implement it exactly as written there.

## Read first
`CLAUDE.md`; `tasks/MODLAYER-DESIGN.md`; `tasks/19d1-internal-politics.md` §S; `tasks/M4-agent-brief.md` rules 1–3, 5, 8;
`tasks/UI-agent-brief.md` for the UI part. Then the ported economy this rides on:
- **What already propagates in the port (do not re-implement):**
  - luxuries → development → approval/growth: `colonyTick.ts evaluateColonyVariablesCore` counts the colony's luxury
    cargo types (`cargoResourceCounts`, CargoList.cs 619) and moves `developmentLevel` toward 5 × that count at up to
    `COLONY_DEVELOPMENT_LEVEL_MAXIMUM_ANNUAL_CHANGE` (25/yr); `taxes.ts empireApprovalRating` adds developmentLevel/5;
    growth scales with min(5, luxuries)/5 (Empire.4.cs 2943 EvaluateColonyVariables);
  - race critical resources → approval: `recalculateCriticalResourceSupplyBonuses` (Habitat.cs 5087) and
    `calculateStrategicResourceSupplyGrowthFactor` (Habitat.cs 7268) → approval term −15 × (1 − supplied fraction);
  - consumption: `logistics/colonySupply.ts consumeResources` (Habitat.cs 2758) eats luxury/critical cargo every tick;
    `consumeAndOrderStrategicResourceSupply` (7293) and `orderColonyLuxuryResources` place orders;
  - prices: `market.ts reviewResourcePrices` (Galaxy.1.cs 1204): price → BasePrice × demand/supply, but clamped to
    **[0.1667, 0.35] × BasePrice** for normal resources ([0.5, 3] for super-luxuries) — the reason the faithful game
    never shows a price spike; Bacon planet prices `colonyTick.ts updatePlanetResourcePrices` (BaconHabitat.cs 497);
  - fuel: `movement.ts checkFuelHandicap` (BaconBuiltObject.cs 4651) cuts speeds when fuel and energy are 0;
    `checkForStrandedShips` (Empire.4.cs 2516), `identifyWhetherSystemIsRefuellingPointForEmpire`,
    `checkFuelSuppliedAtLocation`, `logistics/refuel.ts checkForFuelOrdering / checkForRefuelling`;
  - smuggling: `pirates/missionsMarket.ts makeSmugglingOffersToPirates` (Empire.2.cs 1426) posts a Smuggle
    EmpireActivity for a colony whose orders are old and unfilled (`determineColonyDeficientInResources`, 1592), price per
    unit `calculatePirateSmugglePricePerUnit` = min(5, max(0.1, price × 0.5)) (Empire.2.cs 2288); pirates accept in
    `pirateCheckMissionsOnOffer`;
  - depletion: `empireEvents.ts empireEventColonyResourceDepletion` (Empire.1.cs 1888) removes a resource from a habitat
    and sends the ResourceDepletion event message; extraction never lowers `abundance` in the port
    (`industry.ts habitatResourceExtract`, HabitatResource.cs: units = volume / (1000 / abundance)).
- Extraction sites: `industry.ts industrialProcessing` (mining stations/ships, the `habitatResourceExtract` calls at
  ~474–561) and `extractResources` (Habitat.cs 2827, colonies, ~625–641).
- Blockades: `fleets/blockades.ts` (`colony.isBlockaded`, `builtObject.isBlockaded`, `getBlockadesAgainstEmpire`);
  freight skips blockaded ports (`logistics/freight.ts`, note its TODO(port) M4m on `habitatIsBlockaded`).
- Raids: `combat/invasion.ts doRaidBonuses` (Galaxy.5.cs 4953) loots cargo; `raidCountdown`; `taxes.ts
  raidEconomyDamageFactor`.
- Supply bookkeeping: `logistics/orders.ts countResourceSupplyLocations`, `isLuxuryResource`, `empireCreateOrder`;
  `industry.ts identifyDeficientEmpireResources` (Empire.3.cs 21); `resourceTargets.ts identifyResourceCentres`.

C# analogues ($C = `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded`): `DistantWorlds.Types/Galaxy.1.cs`
1204 ReviewResourcePrices; `Habitat.cs` 2758 ConsumeResources, 2827 ExtractResources, 7268
CalculateStrategicResourceSupplyGrowthFactor; `Empire.4.cs` 2943 EvaluateColonyVariables, 2516 CheckForStrandedShips;
`Empire.1.cs` 1867/1888 EmpireEventColonyResourceDepletion, 1988 EmpireEventEconomicCrisis (the ported "crisis" event:
state money loss); `Empire.2.cs` 1426 MakeSmugglingOffersToPirates, 1518 IdentifyResourceDeficientColony, 2288
CalculatePirateSmugglePricePerUnit; `BuiltObject.2.cs` 6978 / `BaconBuiltObject.cs` 4651 CheckFuelHandicap;
`Galaxy.5.cs` 4953 DoRaidBonuses.

## 1. Flags and params (`scenarios/emergent/scenario.json`)
| name | kind | default | meaning |
|---|---|---|---|
| `resourceCrises` | flag | true | reserves, shocks, crisis prices, shortage unrest, fuel crisis reporting, smuggling pull |
| `reserveUnitsPerAbundance` | param 0–100000 | 2000 | units a source holds per abundance point (0 = infinite, no depletion) — calibrate (§7) |
| `crisisPriceCeiling` | param 0.35–5 | 1.5 | upper price clamp (× BasePrice) for a normal resource in shortage |
| `shortageShockChance` | param 0–1 | 0.15 | yearly chance of one galaxy supply shock |
| `shortageUnrest` | param 0–20 | 6 | approval penalty per luxury type lost in the last year (decays) |

## 2. Model and sim changes (`src/sim/scenario/emergent/crises.ts` unless noted)

State `CrisesState { extracted: Map<Habitat, Map<number /*resourceId*/, number>>; baseAbundance: Map<Habitat,
Map<number, number>>; crises: Crisis[]; lostLuxuries: Map<Habitat, { year: number; count: number }[]>; lastLuxuryCount:
Map<Habitat, number>; fuelReport: Map<Empire, { year: number; grounded: number }>; nextCrisisId: number }`,
`Crisis { id; kind: 'depletion' | 'blockade' | 'raid' | 'shock' | 'fuel'; resourceId: number; habitat: Habitat | null;
empire: Empire | null; startYear: number; severity: number /*0–1*/; resolvedYear: number /*-1 open*/ }`.

### Triggers
1. **Reserves (mined-out sources).** Hook, no Rnd: after each `habitatResourceExtract(...)` result in
   `industry.ts industrialProcessing` and `extractResources`, `if (scenarioFlag(galaxy, 'resourceCrises'))
   recordExtraction(galaxy, habitat, resourceId, units)`. Reserve = `baseAbundance × reserveUnitsPerAbundance`
   (`baseAbundance` = abundance at first record). Yearly (handler §2.8): at 50% and 80% extracted set `abundance =
   trunc(base × 0.75)` / `trunc(base × 0.5)` (the ported extraction formula then yields less) and send "Emergent Reserves
   Low"; at 100% call the ported `empireEventColonyResourceDepletion(galaxy, habitat, resourceId, owner)` (removes the
   resource, sends the stock ResourceDepletion event) and open a `depletion` Crisis. Mining stations at a depleted
   source become idle through the existing targeting (`identifyResourceCentres` no longer lists it).
2. **Blockades.** Yearly: every colony with `isBlockaded` whose owner lacks ≥ 1 luxury or critical resource it had a
   year ago opens a `blockade` Crisis (resourceId = the most valuable lost one by current price); closes when the
   blockade ends and the stock is back. No change to the blockade code.
3. **Raids.** Hook, no Rnd: at the end of `doRaidBonuses` when cargo was looted from a space port or colony,
   `if (scenarioFlag(...)) recordRaidLoss(galaxy, target, lootedResourceIds)`; the yearly handler opens a `raid` Crisis
   when looted luxury/fuel stock left the target without that resource.
4. **Galaxy supply shock.** Yearly: `rnd.nextDouble() < shortageShockChance` (`// RND(19d2): shock roll`); pick the
   luxury or fuel resource with the fewest supply locations (`countResourceSupplyLocations(galaxy, e, id, true)` summed
   over empires; ties: lower resourceId) that has ≥ 1 source; pick one source habitat with `rnd.next(0, n)`
   (`// RND(19d2): shock source`) and deplete it (as trigger 1, 100%); `scenarioNews` "Emergent Supply Shock". A source
   that is some empire's only supply of a race critical resource is excluded (no single-roll death spiral).
5. **Fuel crisis detection.** Hook, no Rnd: end of `movement.ts checkForStrandedShips(galaxy, empire)`:
   `if (scenarioFlag(...)) reviewFuelCrisis(galaxy, empire)` — counts the empire's military ships with
   `_fuelHandicapped` and fleets whose `shipGroupCheckShipsRequiringRefuelling` finds no reachable refuelling point;
   when ≥ 25% of military ships are grounded opens a `fuel` Crisis (resourceId = the fuel type of most grounded ships,
   `determineFuelRequired`), once per empire per year, and posts "Emergent Fleets Grounded" (subject = largest
   grounded fleet). Grounding itself stays the ported `checkFuelHandicap`.

### Propagation (what the scenario amplifies)
6. **Crisis prices.** In `market.ts reviewResourcePrices`, after `num7 = csMathMin(val2, num7)` and before the NaN check:
   `if (scenarioFlag(galaxy, 'resourceCrises')) num7 = crisisPrice(galaxy, resourceDefinition, array[num3], array2[num3],
   num7, prices[num3])` — pure: when supply < demand × 0.25 the ceiling becomes `BasePrice × crisisPriceCeiling` and the
   price moves toward BasePrice × demand/supply with the same half/quarter step rule as the C#; when supply recovers the
   ported clamp pulls it back (it runs first next review). Super-luxuries keep their ported band. No Rnd.
7. **Shortage unrest** (approval term, §S3, id `crises.shortage`, label "Shortages"): pure term = −`shortageUnrest` ×
   Σ over `lostLuxuries[h]` entries of the last 2 years (count × (1 − age/2)). `lostLuxuries` is written by the yearly
   handler: `lastLuxuryCount` vs the current `cargoResourceCounts`-equivalent count (re-implement the count as a pure
   helper in crises.ts; do not export the private one from colonyTick). This is the "shock" on top of the slow ported
   development decline.
8. **`reviewCrises(galaxy, year)`** — yearly handler (`registerScenarioYearly({ id: 'emergent.crises', flag:
   'resourceCrises', order: 20, run })`): reserves (1), blockade/raid crisis bookkeeping (2, 3), shock (4), luxury
   counts (7), crisis resolution (a crisis resolves when its colony/empire has the resource again for a full year, or
   the colony is gone), AI rules (§4), messages. Order within: empires in `galaxy.empires` order, colonies in
   `empire.colonies` order.
9. **Smuggling pull.** In `pirates/missionsMarket.ts calculatePirateSmugglePricePerUnit`: `if (scenarioFlag(galaxy,
   'resourceCrises')) return Math.min(crisisSmuggleCap(galaxy), Math.max(0.1, price × 0.5))` with the cap =
   5 × max(1, crisisPriceCeiling / 0.35) — so smuggle offers for crisis goods are worth more, and pirates (whose
   acceptance weighs mission value) take them first. `makeSmugglingOffersToPirates` gets one flagged change: an empire
   whose policy `offerSmugglingPirateMissions` is 1 (only at war) also offers when one of its colonies has an open
   Crisis (no Rnd). Record completed smuggling into crisis colonies (hook at `completePirateMission` Smuggle case, no Rnd)
   for the UI's "black market" line.
10. **Public accessors** for the other packages and the UI (pure): `colonyInCrisis(galaxy, h): Crisis | null`,
    `empireCrises(galaxy, e): Crisis[]`, `crisisPriceIndex(galaxy): { resourceId; price; base; inCrisis }[]`.

## 3. Save state
`scenarioState(galaxy, 'crises')` as above (Maps keyed by Habitat/Empire graph objects; numbers). `abundance` changes
live in the ported `habitat.resources` entries (already saved). Nothing else.

## 4. AI rules (testable)
1. An AI empire with an open `fuel` Crisis creates, that year, a state order for the crisis fuel at its capital space port
   (`empireCreateOrder`, amount = 2 × `calculateResourceLevelSpaceport` for that fuel) unless one ≥ that amount is open.
2. An AI empire that loses a luxury at ≥ 25% of its colonies raises that resource's priority in its mining targets: the
   next `identifyResourceCentres` result is filtered to put sources of that resource first (flagged, pure reorder in
   `resourceTargets.ts`).
3. An AI empire never offers smuggling missions for a resource it itself exports to a trade partner with an open crisis
   (keeps the flagged smuggling change from contradicting its trade).
4. Pirates' acceptance code is unchanged: the higher mission value alone makes crisis smuggling preferred (test that a
   crisis-priced smuggle offer is accepted before an equal-sized normal one on the seed-1 harness).

## 5. Player-facing
Messages (`scenarioMessage`): Reserves low (GeneralWarning, subject = habitat), source exhausted (stock event),
shortage at colony (GeneralBadEvent, subject = colony, once per crisis), fleets grounded (GeneralWarning, subject =
fleet), crisis resolved (GeneralGoodEvent). News: galaxy supply shocks, crisis prices ("Emergent Price Spike RESOURCE
PRICE") at most one per resource per year. Decision (§S4) `crises.fuel` when the player's fleets are grounded: options
"Emergency purchase" (buy fuel at crisis price: stateMoney → cargo at the capital port, amount as AI rule 1; disabled
without money), "Offer smuggling contracts" (posts a Smuggle mission via the ported constructor for the capital),
"Wait" (default). No other new player actions: the counterplay is the existing game (mining stations, trade, escorts,
breaking blockades, policy).

## 6. UI
- Stub list / popups via the existing feed + §S4 decisions.
- Empire summary (`empireSummary.ts`): "Crises" block (open crises: kind, resource icon, colony, years) and the grounded
  ship count.
- Colonies list (`coloniesList.ts`): a "Shortage" marker column (pure row builder, tested) with the lost luxuries in
  the tooltip; approval tooltip lists `scenarioApprovalBreakdown` lines.
- Resource prices wherever the UI shows `galaxyResourceCurrentPrices` (trade/market panels): a crisis badge when
  `crisisPriceIndex` says inCrisis. The freight-flow overlay (19e-9) will visualise flows later — not here.

## 7. Tests (`test/emergentCrises.test.ts`, soak `test/emergentCrisesSoak.test.ts // @slow`)
Unit: `crisisPrice` (below/above the shortage ratio, same step rule, never below the ported floor); shortage term decay;
reserve thresholds on a hand-built habitat; smuggle cap with the flag. Harness (`createScenarioGame`, flag on):
**calibration** — measure units extracted per source per year on seed 1 over 5 years and assert the median source's
projected life at default `reserveUnitsPerAbundance` is 40–80 game years (write the measured numbers in a comment; adjust
the default, not the formula); forced depletion of a colony's only luxury raises a shortage term and drops approval
within one year; draining every fuel stock of an empire (clear the fuel cargo at its ports and the ships' fuel) produces a
`fuel` Crisis and the AI order of rule 1; a crisis-priced resource's smuggling offer is posted for a war-only-policy
empire. Plus §S6 (1)–(3).

## 8. Acceptance criteria
- §S6 checks; typecheck and full suite green; `npm run repin -- --check` clean.
- 30-year soak with the flag on: at least one depletion and one crisis price on seed 1, no empire's approval pinned at
  the floor for > 10 years by crises alone, no NaN prices, no exceptions.
- Every crisis has a message with a working subject and an entry in Empire Summary until resolved.

## 9. Risks
- Balance of reserves: too small empties the galaxy; the calibration test and the param are the guard.
- `habitatIsBlockaded` in freight.ts is a TODO(port) M4m; blockades are set on `colony.isBlockaded` by blockades.ts —
  confirm freight honours it before relying on trigger 2 (else note it and keep trigger 2 as reporting only).
- Price feedback: the ported demand/supply loop can oscillate once the ceiling lifts; the quarter-step rise and the
  pull-back by the ported clamp should damp it — the soak must check no resource flips crisis ↔ normal every review.
- Hooks inside hot loops (`industrialProcessing`) must stay a flag check + Map update (no allocation per call).

## 10. Size
~2–3 days (triggers + propagation 1.5, UI 0.5, calibration/tests 0.5–1).
