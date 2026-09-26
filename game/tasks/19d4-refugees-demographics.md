# 19d4 — Refugees & demographics: refugee fleets, colony race mix, tension, migration links

Scenario package on the mod layer (`tasks/MODLAYER-DESIGN.md`). Accepted idea 19d-4 (`tasks/19-mod-layer-scenarios.md`):
refugee fleets (events) settle and shift colony race mix; multi-race populations and race attitudes turn that into
happiness and loyalty effects; settlements leave migration links. Shared infrastructure (scenario folder, approval-term
hook, player decisions, Rnd policy, common tests) is **§S of `tasks/19d1-internal-politics.md`**; if it is not in your
base yet, implement it exactly as written there.

## Read first
`CLAUDE.md`; `tasks/MODLAYER-DESIGN.md`; `tasks/19d1-internal-politics.md` §S; `tasks/M4-agent-brief.md` rules 1–3, 5, 8;
`tasks/UI-agent-brief.md` for the UI part. Then the ported pieces this builds on:
- Populations: `src/sim/population.ts` — `Population { race, amount, unassimilatedAmount (unused by the port so far),
  growthRate }`, `PopulationList.add` (merges same race), `dominantRace` (max amount × intelligence),
  `recalculateTotalAmount`; `colony.ts` / `missions/cmdTroops.ts makeHabitatIntoColonyRuntime` (new colony with a race).
- Race attitudes: `src/sim/raceBias.ts` — `raceBiasesGetBias`, `resolveStandardRaceBias` (Galaxy.cs 2086; raceBiases.txt,
  race-family fallback); `data/races.ts` (friendliness, loyalty, intelligence, raceFamily, nativeHabitatType,
  `expanding`); character traits Tolerant / Xenophobic (`characters.ts`).
- Approval: `src/sim/taxes.ts` — `empireApprovalRating` (Habitat.cs 534), `habitatRacialHappiness` (Habitat.cs 496:
  only the colony's **dominant** race vs the empire's race: min(bias/2, (racialOffense + slaveryOffense)/2), policy
  Enslave/Exterminate caps), `calculatePopulationPolicyConcern`, `calculateExterminationConcern`.
- Rebellion / culture: `colonyTick.ts checkSatisfaction` (Habitat.cs 5992; militia of the dominant race),
  `calculateMigrationFactor` (Habitat.cs 1162), `reviewColonyPopulationPolicy`, `growPopulation`;
  `exploration.ts` ExertCulturalInfluence (Empire.cs 4734: rebelling colonies switch to an empire whose race loyalty and
  their approval invite it).
- Migration: `civilianAI.ts` — `reviewMigrationTourism` (per-empire, `tick/empireTick.ts` 337), `determineMigrationSources`
  (includes other empires' colonies not at war/sanctions, independents, protected pirates), `determineMigrationDestinations`,
  `determineResettleDestination` (Empire.5.cs 3326 → BaconEmpire.cs 1269), `acceptsPopulation` (Habitat.cs 5624: policy
  Assimilate / own race / race family), `hasPopulationToResettle`, `assignMigrationMissionToBuiltObject` (passenger ship
  Transport missions carrying a `PopulationList`); unloading: `missions/cmdDocking.ts` population branch.
- Refugee ships in the port: `story/eventActions.ts` GenerateRefugeeFleet (Galaxy.9.cs 2085) and `exploration.ts` ruins
  Refugees (Galaxy.5.cs 4496): abandoned colony ship + frigate + cruiser named "Refugee …" with `nativeRace`, found by
  explorers (`combat/ownership.ts` abandoned-ship encounter, "Abandoned Ship Acquire Colony Ship"); a colony ship with
  `nativeRace` colonises with that race (`construction/constructionQueue.ts` ~1459, `cmdTroops.ts` ~135).
- Independent ships with missions: `independentTraders.ts generateIndependentTraders` (Galaxy.7.cs 4354) /
  `assignIndependentTraderMissions` (4548) — the pattern for ships owned by `galaxy.independentEmpire`;
  `empireEvents.ts generateNewBuiltObject`, `designGeneration.ts generateDesignFromSpec`, the local `obtainDesignSpec`
  helpers (story/eventActions.ts 414, exploration.ts 254 — export one or copy it with a cite).
- Refugee causes: `combat/ownership.ts takeOwnershipOfColonyFull` (every conquest/secession/defection path calls it),
  `combat/damage.ts inflictBombardDamage`, `empireEvents.ts empireEventPlague` / `empireEventColonyNaturalDisaster`,
  population policy Exterminate/Resettle (`colonyTick.ts`), 19d1 secession, 19d2 crises (optional couplings).

C# analogues ($C = `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded`): `DistantWorlds.Types/Habitat.cs`
496 RacialHappiness, 534 EmpireApprovalRating, 1162 CalculateMigrationFactor, 5624 AcceptsPopulation, 5658
HasPopulationToResettle, 5992 CheckSatisfaction; `Empire.5.cs` 2670–2695 passenger-ship missions, 2974/3326
DetermineResettleDestination, 3352 DetermineMigrationDestinations; `Galaxy.9.cs` 2085 GenerateRefugeeFleet; `Galaxy.5.cs`
4496 ruins refugees; `Galaxy.7.cs` 4354 GenerateIndependentTraders; `Empire.cs` 4734 ExertCulturalInfluence;
`PopulationList.cs` DominantRace; `BaconDistantWorlds/BaconEmpire.cs` 1269/1317 (resettle/migration overrides).

## 1. Flags and params (`scenarios/emergent/scenario.json`)
| name | kind | default | meaning |
|---|---|---|---|
| `refugees` | flag | true | refugee flows, asylum, tension, assimilation, migration links |
| `refugeeShare` | param 0–0.5 | 0.15 | share of a fleeing race's population that leaves per cause |
| `tensionWeight` | param 0–3 | 1 | scales the demographic tension approval term |
| `assimilationRate` | param 0–1 | 0.1 | yearly share of unassimilated population that assimilates |

## 2. Model and sim changes (`src/sim/scenario/emergent/demographics.ts` unless noted)

State `DemographicsState { causes: RefugeeCause[]; flows: RefugeeFlow[]; convoys: Map<BuiltObject, RefugeeFlow>;
links: MigrationLink[]; asylum: Map<Empire, 'open' | 'kin' | 'closed'>; hosted: Map<Empire, Map<Race, number>> }`;
`RefugeeCause { habitat: Habitat; cause: 'conquest' | 'bombardment' | 'plague' | 'disaster' | 'policy' | 'secession' |
'crisis'; oldOwner: Empire | null; year: number }`; `RefugeeFlow { id; race: Race; amount: number; origin: Habitat;
originEmpire: Empire | null; cause: string; destination: Habitat | null; host: Empire | null; stage: 'pending' |
'asking' | 'travelling' | 'settled' | 'stranded' | 'lost'; created: number }`; `MigrationLink { from: Habitat; to:
Habitat; race: Race; strength: number /*0–1*/; lastYear: number }`.

### Causes (record only, no Rnd)
1. Hooks `if (scenarioFlag(galaxy, 'refugees')) recordRefugeeCause(galaxy, habitat, cause, oldOwner)` at: entry of
   `takeOwnershipOfColonyFull` when `colony.empire !== newEmpire` and both are normal empires or the new owner is a
   pirate (`conquest`); end of `inflictBombardDamage` when population was lost (`bombardment`); `empireEventPlague` and
   `empireEventColonyNaturalDisaster` when they hit a colony (`plague` / `disaster`); `reviewColonyPopulationPolicy` when
   a race's policy becomes Exterminate or Enslave at a colony (`policy`). 19d1 calls it on secession, 19d2 may call it for
   colonies with a crisis lasting ≥ 2 years (`crisis`) — both through the exported `recordRefugeeCause`.

### Flows
2. **`spawnRefugeeFlows(galaxy, empire)`** — Rnd allowed (flagged): called at the end of `reviewMigrationTourism(galaxy,
   empire)` for the owner of each cause habitat (so flows start within the empire's migration cadence, not a year
   later): `if (scenarioFlag(galaxy, 'refugees')) spawnRefugeeFlows(galaxy, empire)`. For each unhandled cause at that
   empire's colonies: the fleeing races are the colony's races whose `resolveStandardRaceBias(race, owner.dominantRace)`
   < 0, or all non-dominant races for `policy`, or every race for `bombardment`/`plague`/`disaster`; amount = trunc(race
   amount × `refugeeShare` × (0.75 + rnd.nextDouble() × 0.5)) (`// RND(19d4): flow size`), minimum 10 000 000, never
   leaving the race below 10 000 000 at the origin (the port's population floor). Remove the amount from the origin
   (`population.items[i].amount −=`, `recalculateTotalAmount`, `recalculateEmpirePopulation`).
3. **Destination (no Rnd)** — `chooseAsylum(galaxy, flow)`: candidates = colonies of normal empires (and independents)
   where `acceptsPopulation(galaxy, h, hostEmpire, race)` holds, host not at war with the origin's current owner, host
   asylum policy allows it (`open`: any; `kin`: race === host dominant race or same raceFamily; `closed`: none),
   `h.population.totalAmount < h.maxPopulation`, within 3 × `galaxy.sectorSize` × (1 + 0.5 × links from origin) of the
   origin; score = −distance/sectorSize + 10 × `resolveStandardRaceBias(race, host.dominantRace)`/100 + 5 × (same race as
   a population already there) + 5 × link strength; best score, ties lower habitat id. None ⇒ nearest uncolonised habitat
   whose type is `race.nativeHabitatType` within the same range (becomes an independent colony, §2.6); none ⇒ `stranded`
   (the population is lost; message; counts for §2.8).
4. **Asylum decision** — host = player ⇒ decision `refugees.asylum` (§5) with a 3-month deadline, default by the
   player's standing asylum policy; host = AI ⇒ §4 rule 1 immediately. Refusal re-runs `chooseAsylum` excluding that host.
5. **Convoy (physical)** — accepted flows spawn a refugee convoy: independent-owned passenger ships
   (`generateDesignFromSpec` for the origin owner's PassengerShip spec at `galaxyStarDate`, `generateNewBuiltObject(galaxy,
   galaxy.independentEmpire, design, origin)`, named `scenarioText('Emergent Refugee Convoy RACE', race.name)`), as many as
   `ceil(amount / populationCapacity)` (cap 5; the rest is lost in transit — say so in the message), each with a Transport
   mission `assignMission(galaxy, ship, BuiltObjectMissionType.Transport, origin, destination, Normal, { population })`
   as `assignMigrationMissionToBuiltObject` builds it. Register in `convoys`. Flagged guard in
   `assignIndependentTraderMissions` (and any other independent-ship mission review) so convoys keep their mission.
   Convoys can be attacked like any independent ship; a destroyed convoy's share is `lost` (news when > 100M).
6. **Arrival** — the ported unload in `cmdDocking.ts` adds the population to the destination. Hook (no Rnd) after the
   add: `if (scenarioFlag(...) && convoy) settleRefugees(galaxy, ship, habitat, population)`: move the arrived amount into
   `unassimilatedAmount` of that race's Population at the destination, update `hosted`, create/strengthen a
   `MigrationLink(origin → destination, race)` (+0.3, cap 1), mark `settled`, then remove the ship (convoys are one-way;
   use the ported scrap/remove path). Uncolonised destination: `makeHabitatIntoColonyRuntime(galaxy,
   independentEmpire, habitat, independentEmpire, race, amount)` (as cmdTroops.ts 149 does for independent colonies).
6b. **Government in exile** (no Rnd beyond the callee's) — when a flow's cause is `conquest` and the origin's old owner
   has been eliminated (`!oldOwner.active` or no colonies left) and the flow is ≥ 500M of that owner's dominant race and
   is headed for an uncolonised habitat (§2.3 fallback): instead of an independent colony, found an empire with
   `createEmpireMidGame(galaxy, { race, home: habitat, name: scenarioText('Emergent Exile Empire NAME', oldOwner.name),
   age: 0, techLevel: <oldOwner's tech level if known, else 0.5>, governmentId: oldOwner.governmentId, setup: false,
   relationBias: 0, atWarWith: [<the conqueror, when still at war>] })` (MODLAYER-DESIGN §4; draws inside it are allowed —
   it is called from this flagged path), set its population to the flow amount, message + `scenarioNews`. At most one
   exile empire per eliminated empire; skip when `galaxy.nextEmpireId >= galaxy.maximumEmpireCount`.
7. **Demographic tension** (approval term, §S3, id `demographics.tension`, label "Ethnic tension"; pure) —
   `colonyTension(galaxy, h)`: shares s_i of each race (amount/total); T = Σ_{i<j} s_i s_j × max(0, −(bias(i→j) +
   bias(j→i))/2) / 10, where unassimilated amounts count double in their race's share weight; governor Xenophobic ×1.5,
   Tolerant ×0.5 (governor = `ColonyGovernor` at the colony via `findCharactersAtLocationNotTransferring`); empire leader
   Xenophobic ×1.25 / Tolerant ×0.75. Term = −`tensionWeight` × T; a positive pair average gives up to +3
   ("cosmopolitan") when every pair's bias is > 0. Exported for 19d1 (governor loyalty) and the UI.
8. **Assimilation and yearly bookkeeping** — `reviewDemographics(galaxy, year)`, yearly handler
   (`registerScenarioYearly({ id: 'emergent.demographics', flag: 'refugees', order: 40, run })`): unassimilated →
   assimilated by `assimilationRate` × (Tolerant governor 1.5, Xenophobic 0.5, same raceFamily as dominant 1.5) (no Rnd);
   links decay −0.1/yr and drop at 0; flows older than 2 years that never left are dropped; `hosted` recomputed from
   populations whose race ≠ host dominant race; diplomacy (§2.10); AI asylum policies (§4); decisions expiry.
9. **Migration links → chain migration** (flagged, no Rnd) — in `determineMigrationDestinations(empire)` add each link
   destination owned by the empire with priority `trunc(link.strength × 1000)` (so passenger ships move more of that race
   along the link); in `determineMigrationSources` include a foreign link origin even when its `migrationFactor ≥ 0`
   while `strength > 0.5` and the relation allows migration (the ported relation test). Chain migration therefore uses
   the ported passenger-ship logic; only the target lists change.
10. **Diaspora diplomacy** (yearly, no Rnd) — for each host empire H and each normal empire E whose dominant race R is
    hosted by H (≥ 100M): E's evaluation of H `incidentEvaluation += 1` per year (cap +10 total from this source; keep
    the running total in state) when H's colonies holding R use policy Assimilate, and −3 per year when any uses Enslave
    or Exterminate (the ported racialOffense / slaveryOffense already react to extermination/enslavement; this adds the
    refugee-era signal and is shown in the UI as "Emergent Diaspora").
11. **Race mix consequences stay ported**: when arrivals flip `dominantRace`, `habitatRacialHappiness`, the militia
    race in `checkSatisfaction`, cultural influence and 19d1's ethnic secession (the ported split re-picks race and
    government when the lost colonies' dominant race differs) all follow automatically.

## 3. Save state
`scenarioState(galaxy, 'demographics')` (Habitat/Empire/BuiltObject/Race graph objects — check Race is saved as a
reference to the galaxy's races, as `nativeRace` is; numbers, strings). `unassimilatedAmount` lives on the ported
`Population` (already saved). Convoy ships are ordinary independent BuiltObjects.

## 4. AI rules (testable)
1. An AI host accepts a flow when `resolveStandardRaceBias(host.dominantRace, race) ≥ 0` and the flow is < 25% of the
   destination's population; refuses otherwise. It never accepts when at war with the flow's origin owner.
2. AI asylum policy: `closed` when its average colony tension > 10 or it is at war with ≥ 2 empires; `kin` when its race
   friendliness < 90 (`raceFriendlinessLevel`); else `open`. Reviewed yearly.
3. An AI empire with a colony at tension > 15 sets that colony's policy for the most disliked minority race to
   Assimilate if it was not already Assimilate/Enslave (the ported policy field; no new policy values).
4. AI empires never target convoys specially (combat AI unchanged); pirates may raid them through the ported logic.

## 5. Player-facing
- Standing policy (sim action `setAsylumPolicy(galaxy, empire, 'open' | 'kin' | 'closed')`, default `kin` for the
  player) in the Empire Policy screen's scenario section (`empirePolicy.ts`, `// [emergent]` block) or, if that screen
  has no room, in Empire Summary.
- Decision `refugees.asylum`: "N million RACE refugees from ORIGIN (cause) ask for asylum at DEST" — Accept (default
  when the policy allows) / Redirect to another of your colonies (enabled when a second candidate exists; re-runs
  `chooseAsylum` restricted to the player) / Refuse.
- Messages: convoy departed (to origin owner and host), arrived/settled, lost/stranded (news when large), tension high
  at colony (GeneralWarning once per 5 years per colony), dominant race changed at colony (GeneralNeutralEvent).
- 19d1 coupling (when `internalPolitics` is on): governors of high-tension colonies lose loyalty (19d1 §2.3); ethnic
  secession is simply the ported split picking the colony race.

## 6. UI
- Colony detail / selection panel: a population-by-race list (race, amount, unassimilated share, bias icon vs the
  dominant race) with the tension value — pure builder, tested.
- Colonies list: "Races" column (count, dominant race icon) and a tension marker; approval tooltip shows
  `scenarioApprovalBreakdown` lines.
- Map: convoys are ordinary ships (their name carries the race); a stub/popup subject opens them.
- Empire Summary: hosted populations by race and the asylum policy.

## 7. Tests (`test/emergentDemographics.test.ts`, soak `test/emergentDemographicsSoak.test.ts // @slow`)
Unit: `colonyTension` on hand-built populations (bias table from the loaded raceBiases: pick two races with a known
negative bias), trait multipliers, assimilation math, `chooseAsylum` scoring/ties, flow size bounds (stub Random).
Harness: conquer a multi-race colony on seed 1 (use the ported `takeOwnershipOfColonyFull`) ⇒ a cause is recorded, a
flow spawns at the next migration review, a convoy with a Transport mission exists; run until arrival (or force the
unload path) ⇒ destination has the race, `unassimilatedAmount > 0`, a link exists, tension term appears in the
breakdown; enough arrivals to flip the dominant race ⇒ `habitatRacialHappiness` now evaluates the new race (ported).
Chain migration: a link adds its destination to `determineMigrationDestinations`. Plus §S6 (1)–(3).

## 8. Acceptance criteria
- §S6 checks; typecheck and full suite green; `npm run repin -- --check` clean.
- 30-year soak (seed 1, flag on): refugees occur after wars; ≥ 1 colony changes dominant race by refugees on at least
  one of 3 seeds (log); no colony population below the port floor from flows; no orphan convoys (every convoy ship is
  settled, lost or still travelling with a valid mission).

## 9. Risks
- Independent-owned passenger ships with Transport missions are new ground: verify the mission/docking code accepts an
  independent ship docking at another empire's colony (docking permission checks) — if not, make the convoy owned by
  the **host** empire from the moment of acceptance (its private fleet; remove after unloading). Decide early, record it.
- `unassimilatedAmount` is unused by the port; make sure nothing ported resets it (grep before relying on it) and that
  `PopulationList.add` merging keeps it (it does not: add the unassimilated share after the merge).
- Tension on many small minorities could swamp approval; the weight param and the /10 scale are the knobs — soak logs
  the tension distribution.
- `acceptsPopulation` depends on colony policies; empires with Exterminate policies are never hosts (intended).

## 10. Size
~3–4 days (causes + flows + convoys 1.5, tension/assimilation/links 1, UI 0.5–1, tests 0.5).
