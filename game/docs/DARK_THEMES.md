# Dark themes: slavery, scorched earth, war crimes

Three features about the uglier side of interstellar rule. Slavery is part of the **base game** (an empire policy);
scorched earth and war crimes are **add-ons**. None of them exists in DW:U 1.9.5.

| Feature | Kind | Code | Switch |
|---|---|---|---|
| Slavery and penal colonies | base game | `src/sim/slavery.ts` (rules), `src/sim/slaveryReview.ts` (review, AI, convoys) | Policy screen "Allow slavery" (`EmpirePolicy.allowSlavery`) |
| Scorched earth | add-on `scorched-earth` (Living Galaxy) | `src/sim/scenario/scorchedEarth/scorchedEarth.ts` | flag `scorchedEarth` |
| War crimes remembered | add-on `war-crimes` (Politics & Characters) | `src/sim/scenario/charactersVictory/diet/warCrimes.ts` | flag `warCrimes` |

Determinism: none of them draws `galaxy.rnd`; every choice is a deterministic score with ties to the lower index.
Player choices are journaled player ops (`setPolicy`, `setPenalColony`) or scenario decisions (the message popup).
State: slavery lives in `declare`d optional fields (`Empire.slavery`, `Habitat.slavery`, `BuiltObject.slavery`,
`EmpirePolicy.allowSlavery`) that are absent until used, so a game where nobody uses slavery saves exactly as before;
the add-ons keep their state in `scenario.state.scorchedEarth` / `scenario.state.warCrimes`.

## 1. Slavery and penal colonies (base game)

DW:U's own **Enslave** population policy and its "Use Penal Colonies to implement 'Enslave' policy" option are a
separate, older mechanic and are unchanged. "Allow slavery" is new.

**Policy.** The player ticks "Allow slavery" in the Policy screen (the stock `setPolicy` command). An AI empire decides
from its species and government (`aiSlaveryScore`):

- species: `(Aggression − 100)/25 + (100 − Friendliness)/25 + (100 − Loyalty)/50` (races.txt, 100 = average);
- government weight (`SLAVERY_GOVERNMENT_WEIGHT`, governments.txt ids): Despotism +1.5, Feudalism +1, Monarchy +0.5,
  Republic −1.5, **Democracy never**, Military Dictatorship +1.5, Way of the Ancients −1, Way of Darkness +2,
  Technocracy 0, Mercantile Guild +1, **Utopian Paradise never**, Hive Mind +1, Corporate Nationalism +0.5;
- it adopts at a score of `AI_ADOPT_SCORE` (2) or more, and only once one of its colonies would pay as a penal colony
  (below). It drops the policy if its score falls (a change of government), releasing every penal colony.

**Penal colonies.** With the policy on, any colony but a capital can be made a penal colony (Colonies window,
"Make / Release penal colony", the `setPenalColony` command; its tooltip shows the estimate below). Its **workers** are
its people of species other than the empire's dominant one. **Staffing** = workers ÷ target, where the target is
`PENAL_TARGET_SHARE` (25%) of the planet's maximum population, clamped to 50 M – 600 M.

| Effect | Value (`SLAVERY_PARAMS`) | Where |
|---|---|---|
| Luxury and restricted ("rare", `SuperLuxuryBonusAmount > 0`) extraction | × (1 + 5 × staffing), up to ×6 | `industry.ts extractResources` |
| Tax | × (1 + 1 × staffing), up to ×2 (scaled like extraction: an unstaffed penal colony earns little) | `forceStructure.ts recalculateAnnualTaxRevenue` |
| Approval at the colony | −10 | `taxes.ts empireApprovalRatingStock` |
| Approval at the empire's other colonies of an enslaved race | −4 | same |
| Unrest in the revolt check | 12 + 4 per year as a penal colony (max 40), × (1 − garrison held / needed) | `colonyTick.ts checkSatisfaction` |
| Garrison needed (troop defend strength) | (400 + 3000 per billion workers) × (1 + 0.1 per year, max ×2) | `troops.ts troopLevelRequired` raises the garrison target to it |
| Worker deaths | 5% of the workers a year (Voidbloom worlds lose far more) | `slaveryReview.ts` |
| Reputation | every empire that does not allow slavery: −6 attitude a year per penal colony | `reputation/ledger.ts applyReputation` |

An under-garrisoned penal colony goes into the **stock revolt**: militia rise, the colony is "rebelling" and extracts
and builds nothing; with its troops gone it leaves the empire as an **independent colony** (stock `leaveEmpire`,
counted as a breakaway).

**Labour convoys** (the Voidbloom / Refugees convoy pattern: a pre-loaded passenger ship on a Transport mission,
`missions/cmdDocking.ts` skips the pickup and settles the people at the destination): while a penal colony is short of
its target, every 20 days the empire ships up to 20 M people of one non-dominant species from the colony that has the
most to spare (it keeps 30% of each people) for 4,000 credits. The source colony loses them; a convoy that sinks or
docks elsewhere loses them. The player's penal colonies are staffed the same way, automatically.

**The AI** makes a colony a penal colony (at most 3) only when:
- it holds at least 30 summed abundance of luxury / restricted resources;
- the workers there plus the empire's enslavable people elsewhere not yet promised to another penal colony reach 60%
  of the target (`AI_MIN_STAFF_SHARE`);
- the garrison's upkeep is at most 60% of the extra tax plus the extra luxury output at market prices;
- the estimated net gain (`penalLedger`: extra tax + extra luxury value − garrison upkeep) is positive; it picks the best.
It releases a colony that rebels with less than 40% of its garrison, or one it has not staffed to 20% after a year
with nobody left to ship.

**Voidbloom tie-in.** With The Voidbloom War on, its forced-labour convoys draw from penal colonies first
(`voidbloom/supply.ts labourSource`).

**War crimes tie-in.** Making a penal colony emits `colonyEnslaved`; the War Crimes add-on records it, and every year a
penal colony holds workers.

## 2. Scorched earth (add-on `scorched-earth`, Living Galaxy)

**Trigger.** The stock attack notice (`attackAI.ts notifyOfAttackHabitat` → `habitatAttacked`) on a populated colony of a
major empire, by another major empire's ship that carries troops or sails in a fleet that does (or with enemy troops on
the ground). The capital is never scorched. One siege per colony at a time.

**Choice.** The player gets the event dialog "Scorched earth?" (Defend / Scorch; Defend if unanswered in
`scorchDecisionDays`, 10). The AI scorches when `aiScorchScore` ≥ `scorchAiScore` (2.5):
species `(Aggression − 100)/25 + (100 − Friendliness)/50` + government weight (`SCORCH_GOVERNMENT_WEIGHT`: Military
Dictatorship +1.5, Way of Darkness +2, Despotism / Hive Mind +1, Feudalism +0.5, Republic / Corporate / Ancients −0.5,
Democracy / Mercantile Guild −1, Utopian Paradise −1.5) + `(0.5 − odds) × 6` (odds of holding = our troops + orbital
strength over both sides', `calculateSpaceControlStrengths`) + `log10(population / 100 M)` (the world's value).

**Burning.** Every 5 days the colony's population and the planet's base quality are set to (1 − t / `scorchRuinYears`)
of their starting values (1.5 years by default). A burned-out world is cleared (no owner). Capture stops it at once;
the captor gets what is left and the stock Terraforming Facility raises base quality again.

**Calling it off.** When the attackers have not struck for `scorchSiegeClearDays` (45) and no enemy troops stand on the
ground, the siege is beaten off: the AI stops the burning; the player is asked (Stop the burning / Keep burning).

**Reputation.** Starting to scorch costs `scorchReputation` (6) attitude with every other major empire and emits
`colonyScorched` (a war crime).

## 3. War crimes remembered (add-on `war-crimes`, Politics & Characters)

| Crime | Record points | Source | Throttle |
|---|---|---|---|
| Bombarding a populated colony | 3 | `habitatBombarded` | per colony, 30 days |
| Destroying a planet | 30 | `habitatDestroyed` (damage.ts destroyHabitat) | once |
| Scorched earth | 12 | `colonyScorched` | per colony, a year |
| Attacking a refugee convoy | 5 | `builtObjectAttacked` (Refugees & Demographics convoys) | per ship |
| Attacking a Diet delegate's shuttle | 10 | `builtObjectAttacked` (Characters & Victory trips) | per ship |
| Enslaving conquered peoples | 8, then up to 4 a year per penal colony holding workers | `colonyEnslaved`, yearly | per colony, a year |
| Attacking an independent colony | 2 | `habitatAttacked` | per colony, a year |

**Memory.** A record fades by `warCrimesDecayPerYear` (3%) a year: it halves in about 23 years.

**Reputation.** Each crime costs `warCrimesReputation` (0.5) × points of attitude with every other major empire, twice
that with the victim. This works without the Diet.

**Tribunal.** With the Interstellar Diet running, members may move a **War Crimes Tribunal** against the worst
offender once its record reaches `warCrimesTribunalMin` (40). An AI proposes it when its own vote score is positive.
Vote score: record / 5 − 5 + harm done to the voter / 2 − the voter's own record / 4, +20 at war with the offender,
−25 allied (mutual defence / protectorate), −10 under free trade; the offender −100. Passed: the council's stock
sanctions, reparations (`warCrimesReparationsPct`, 10% of the offender's treasury, split among its victims by harm) and,
for a record of `warCrimesTrialMin` (100) or more, the trial and removal of its leader. The record then halves, and
no tribunal may target the same empire for 5 years (2 after an acquittal).

**UI.** The Diet window's session page shows the worst record; Galactopedia articles under Politics & Characters
(Slavery and Penal Colonies, War Crimes) and Living Galaxy (Scorched Earth).

## Soaks

`node scripts/soak.mjs --set dark-themes --hook scripts/dark-themes-hook.mjs` (700 stars, 7 empires, 20 years, seed 1):
`dt-slavery-s1` (base game), `dt-base-s1-noslave` (the hook switches AI slavery off: the baseline), `dt-scorch-s1`
(scorched earth), `dt-warcrimes-s1` (Characters & Victory + war crimes + scorched earth). The hook writes
`report.darkThemes` (per empire species, government, adoption year, penal colonies with workers / target /
multiplier, tax and luxury output against the same colony free, garrison held / needed; scorch log; war-crime records
and tribunals).
