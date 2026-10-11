# Colony Economy add-on — design

Opt-in add-on (`scenarios/colony-economy`, code in `src/sim/scenario/colonyEconomy/`). With it off — or with no
add-on — the game is the faithful port: the repin check stays at 0 and a flag-off game is byte-identical to the plain
game (digest, Rnd draw count, no state; `test/economyBreakdown.test.ts`).

**Why.** The private sector hoards money — 1.2–2.3 M credits per galaxy in the soaks — and has little to spend it on.
Colonies also have no identity: there is nothing that makes one world industrial and another a resort.

**Labels.** Every rule below is marked:
- **real (C# file:method)**: the original's own mechanic, checked against the decompiled source. Paths are relative to
  `DistantWorldsExpanded/DistantWorlds.Types/`, or to `BaconDistantWorlds/` for the Bacon (DWE) files.
- **new**: the add-on's own rule.
- **to verify**: assumed, not yet checked.

**Phases**
1. Designations, bonds, and the first 4 facilities of each designation (24 facilities). **Built.**
2. The 3 extra facilities of each designation (18) and the Bounty Office's hunter ships. **Built.**
   Militia Yard ships came with phase 4; the larger synergies are still to do.
3. The refinement chain (Option A). **Built.**
4. Refined goods as a real bottleneck by component tech level, refinery access (the extra slot, commissions, supply
   alerts, AI safeguards), designation balance, the facility tax, the Bounty Office AI, Militia Yard ships, Fleet
   Depot refuelling, and the UI (selection panel, Galactopedia, Colonies list). **Built** (2026-10-11; §5, §9).

---

## 0. Verification: what the C# actually does (corrections to the plan)

The plan's assumptions were checked against the C# on 2026-10-11. These corrections change the design.

1. **Taxes are taken out of private money.** Real (Empire.1.cs 3579-3610, intermediate block):
   - first `PrivateMoney += PrivateAnnualRevenue × dt`;
   - then `tax = max(0, AnnualTaxRevenue × dt)`; `StateMoney += tax`; `PrivateMoney -= tax`.

   So private money is the private sector's *after-tax* profit. Money moved by bonds comes back to it as instalments.
2. **The private sector already has one sink: Bacon infrastructure. It is ON in the shipped game.**
   - The shipped `BaconSettings.txt` sets `allowInfrastructureImprovements=true` and
     `infrastructureSpendingPerDevelopmentLevel=25000`. The TS default (`false`, 50000) is replaced by the file.
   - Real (BaconHabitat.cs 887 ChechAIShouldInvestInInfrastructure, 920 InvestInInfastructure):
     - It is skipped when `PrivateMoney < 5 × 25000` or the colony's tax revenue is below 30 000.
     - Otherwise it rolls `rand × 100 < PrivateMoney / 25000`, then invests 10–80 % of the private money into the
       colony's "infrastructure". That raises its development level (BaconHabitat.cs 879) and decays by 10 % a period.
   - Real (BaconEmpire.cs 1406 PrivateConstructionAddToInfrastructure): 70 % of every private ship's price goes into
     infrastructure at a random space-port colony, and 30 % goes to the state (`privateBuildCostToStateMoney=0.3`).
   - **Consequence:** the plan's phase 4 "private colony investment (surplus speeds development)" duplicates this.
     **Recommendation: drop it.** See §8, conflict C1.
3. **The scenic factor does not scale tourism income.**
   - Real (BuiltObject.2.cs 4825 ProcessTourists): income = `tourists / 8 × leader / skill / race factors`. At a
     habitat it is paid only if the scenic factor is above 0.
   - Real (Empire.5.cs 3138 DetermineTourismDestinations): destinations are ranked by `scenic × 1000`.
   - So a scenic bonus brings more passenger traffic, and with it more income. It does not raise the income per
     tourist. The Resort rules below are worded that way.
4. **Freight is free.** Real (Empire.4.cs 1135 InitiateContract: `PayForFreight` charges 0). The Free Port's "freighters
   prefer it" cannot be a cost discount. In phase 1 it is an income effect; routing is phase 2, to verify.
5. **Colonies have no sensor radius.**
   - Real (Empire.9.cs ~4730 CheckSystemVisible): any owned habitat makes its whole system visible.
   - Real (Empire.9.cs 3478): long-range sensing comes only from bases and ships.
   - The Survey Outpost therefore uses a new visibility rule (§3).
6. **No state debt in the core game, but Bacon has a hidden player-only loan.**
   - Real: StateMoney may go negative without limit. The only effects are:
     - the leader's CashNegative event (Empire.1.cs 3605);
     - AI purchases gated on money;
     - smuggling offers cancelled (Empire.2.cs 1397);
     - a revolution risk at war with stronger enemies (Empire.10.cs 150).
   - Real (BaconEmpire.cs 420-540, the player console only):
     - a credit line of 5 000 000;
     - a rate of `max(2, 6 ± cashflow and debt adjustments − Civility / 10) %`;
     - 120 monthly annuity payments.
   - Not ported: `story/eventActions.ts` 1720 is a TODO stub. See conflict C2.
7. **No militia exists in the C#.** Defensive bases are state-built (Empire.10.cs 1211). Militia Yard ships are new.
   Phase 1 gives the yard a construction and raid effect only.
8. **Facilities have no numeric cap per colony.**
   - Real (Habitat.cs 6416/6660): one facility of each type, one troop facility, and regional capitals limited by
     research.
   - The add-on's private facilities are a separate, new list: they are not `Habitat.Facilities`.
9. **`colonyWonderBonus` (an existing scenario hook) is inconsistent.** The base-yard and income paths take the max
   with a real wonder, but the colony-queue path multiplies on top of it. The add-on does not use it: it adds a
   multiplicative `colonyConstructionFactor` query instead.

---

## 1. Real mechanics the add-on drives

Each effect goes through the game's own formula. The table shows the channel and where it is read.

| Channel | Real (C#) | TS site | How the add-on adds to it |
|---|---|---|---|
| Colony income | Habitat.cs 830 AnnualRevenue: `× (1 + ResourceBonus(IncomeBoost)/100)` | forceStructure.ts 428 | `colonyResourceBonuses` query (existing; Rim Trade uses it) |
| Growth | Empire.4.cs 3105: `× (1 + ResourceBonus(PopulationGrowthRate)/100)` | colonyTick.ts 853 | same |
| Development | Habitat.cs 449: `+ ResourceBonus(Development)` | developmentLevel.ts 63 | same |
| Research | Empire.3.cs 2886 GetResearchResourceBonus: the empire-wide sum of `ResearchX` bonuses / 100, capped at 1 | researchTick.ts 352 | same |
| Troop strength | Habitat.cs ~7040: race TroopStrength `+ ResourceBonus(RecruitedTroopStrength)` | troops.ts 400 | same, scaled by the race's TroopStrength / 100 so "+20 %" is 20 % |
| Tax revenue | Habitat.cs 6083 RecalculateAnnualTaxRevenue | forceStructure.ts 459 | `colonyTaxRevenue` (existing) |
| Tourism | Habitat.cs 1116 CalculateScenicFactorIncludingRuinsWonders | civilianAI.ts 384 | `colonyScenicFactor` (existing) |
| Approval | Habitat.cs 534 EmpireApprovalRating | taxes.ts 356 → stability.ts | stability terms (cause "colonyEconomy", "bonds"); the internal-security ledger lists them |
| Construction speed | BaconConstructionQueue.cs 45 ReviewConstructionSpeed (yard: `Value1 × wonder × resource × race`; colony queue: `600 × min(1, √(pop/1e10)) × …`); Habitat.cs 2039 ConstructFacilities (facilities and wonders: `dt / clamp(100000 × 600 / StrategicValue, 90, 1800)` × leader / skill × build factor) | constructionQueue.ts 1276; construction/facilities.ts 373 | **new** query `colonyConstructionFactor` (kind 'yard' / 'colony' / 'facility'; the 'facility' kind applies to the owner's facilities only, never a pirate base) |
| Mining rate | BuiltObject.2.cs ~7930 IndustrialProcessing: `Extraction × (1+bonus) × MiningRate × leader × skill × dt`, capped at MaxResourceExtractionRate | industry.ts 476 | **new** query `extractionRateFactor` (before the stock cap) |
| Population cap | BaconHabitat.cs 233: `Diameter² × 250 000 × quality²`; Habitat.cs 5172 GrowPopulation caps growth | colonyTick.ts 226 | **new** query `colonyMaxPopulation` (the cap growth runs against; the stored maximum is unchanged) |
| Pirate control | BaconHabitat.cs 1388 ReviewPirateControl: `clamp(strength/20, 0.5, 3) × 0.5 / yr` | pirateAI.ts 250 | **new** query `pirateControlGrowthFactor` |
| Raids | the raid countdown recovery (BuiltObject.1.cs 2894, Habitat.cs 1608) | pirateAI.ts 288/298 | `raidCountdownRate` (existing) |
| Repairs | BaconBuiltObject.cs 4763 DoRepairs: the interval is divided by fleet and captain bonuses | repair.ts 85 | **new** query `repairRateFactor` |
| Ship and base prices | Design.cs 1143 CalculateCurrentPurchasePrice: `Σ component prices × 5` | design.ts 284 | **new** query `designPriceFactor` |
| Troop upkeep | Empire.cs 2025 AnnualTroopMaintenance | troops.ts 320 | **new** query `troopMaintenanceFactor` (phase 2) |
| Ship and base upkeep | BuiltObject.cs 782 AnnualSupportCost | builtObject.ts 400 | **new** query `shipMaintenanceFactor` (phase 2) |
| Private freighter targets | Empire.9.cs 4767 ProjectPrivateForceStructure | forceStructure.ts 846 | **new** query `privateFreighterFactor` (phase 2) |
| Corruption | Habitat.cs 763 Corruption | forceStructure.ts 355 | **new** query `colonyCorruptionFactor` (phase 2) |
| Ground defence | Habitat.cs 7216 ReviewPlanetaryFacilities: DefensiveFortressBonus | construction/facilities.ts 362 | **new** query `colonyFortressBonus` (phase 2) |
| Diet vote weight | (add-on) dietAi.ts voteWeight | | **new** query `dietVoteWeightFactor` (phase 2) |
| Frontier drift | (add-on) frontier.ts autonomyDrift | | **new** query `frontierDriftTerms` (phase 2) |
| Visibility | Empire.9.cs 3198 IsObjectVisibleToThisEmpire | independentTraders.ts 361 | `objectVisibleToAll` (existing) |
| Attitude | EmpireEvaluation bias | reputation/ledger.ts applyReputation | the reputation ledger when on, else the stock bias field |
| Deposits | HabitatResource.cs 24 Extract: `max(1, v × Abundance / 1000)` | habitat resources | Deep Survey Office raises an abundance |

Each new query is called as `if (galaxy.scenario !== null) { k = query(1); if (k !== 1) x *= k; }`. With no handler,
the stock arithmetic is untouched.

The add-on's resource bonuses carry resource id −1. The colony's bonus list (HabitatAttitudeSummary) labels them
"Colony Economy".

---

## 2. Designations

- **Set on the colony screen** with a journaled command (`econSetDesignation`). Values: Industrial, Trade Hub, Resort
  World, Mining Hub, Core World, Frontier / Garrison, or None. None is the original behaviour. (new)
- **Cooldown:** a changed designation is locked for `econCooldownYears` (default 3). A colony that changes hands may
  be re-designated at once. (new)
- **A change closes the facilities of another designation**, because off-designation facilities cannot stand. The
  private sector gets 25 % of their price back. The colony screen warns before the change. (new)
- **Suggestion:** a score per designation, built from these inputs (new):
  - resources: minerals and gas on the planet, uncolonised deposits in the system;
  - quality and scenic factor;
  - luxuries;
  - location: the distance to the capital, own colonies within 3 sectors, foreign or pirate colonies within 2
    sectors;
  - a shipyard or space port;
  - population;
  - being the capital.

  The colony screen shows the best one and its reasons.
- **AI** (new): every 180 days, each AI empire (not the human seats) does the following.
  - It designates colonies of at least 40 M population whose best score is 30 or more, at most 3 a review. The
    capital is always designated with its best fit, so a one-world empire still spends its private money.
  - A fair-share crowding penalty spreads the designations: past a sixth of the colonies, −15 for each further
    colony of the same kind.
  - It re-designates only for a fit 1.6× better, or 2.4× better when facilities stand.
  - Smarter AI can override this later.
- **Bonuses grow with facilities:** a designation's bonus grows by 10 % for each working facility at the colony
  (new). Drawbacks do not grow. Everything scales with `econStrengthPct`.
- **Map icon:** a small badge per designation, drawn procedurally (our own art, no original image). It sits beside the
  colony at system and sector zoom, behind the "Colony Designations" overlay toggle (§6).

| Designation | Bonus | Drawback |
|---|---|---|
| Industrial | +25 % construction speed: ships at its yards, its planetary facilities and wonders, and the bases its own queue builds. ×1.2 when one of the empire's Mining Hubs is within 2 sectors (supply chain). | −4 approval |
| Trade Hub | +10 % colony income (IncomeBoost) | pirate raids recover 25 % faster within 1.5 sectors (`raidCountdownRate`) |
| Resort World | +0.5 scenic factor (more tourist traffic); +3 approval at own colonies within 1.5 sectors | −10 % growth, −15 % construction speed |
| Mining Hub | +15 % mining rate at own mining stations within 1.5 sectors | −3 approval, −10 % tax revenue |
| Core World | +15 % growth, +10 % population cap | −10 % income while below 80 % of its population cap |
| Frontier / Garrison | +20 % recruited troop strength; pirate control grows 40 % slower | −10 % income |

All of these are new rules on the real channels of §1.

**Phase 4 balance (all new; the user's decision C).** The phase 3 soaks made too many Mining Hubs.
- Each further Mining Hub of the empire scores 25 % less (×0.75 per other hub, at most 8). A colony that already is a
  hub keeps its full score, so it is not re-designated because of hubs made after it.
- The AI adds 40 to the crowding penalty of a Mining Hub that would take the empire past 30 % hubs (one is always
  allowed).
- Fit boosts: Core World +15 near the capital (within 3 sectors, scaled by population up to 1 bn) and +12 with ruins
  in the system (research); Resort +12 on a scenic (≥1) and high-quality (≥0.6) world; Frontier +8 per neighbouring
  empire within 3 sectors (at most 2, a border) and +20 when pirates raided the colony in the last 5 years or control
  it (the Bounty Office, §3). There is no "Research" designation; ruins favour Core World, which holds the University.
  Anomalies are not counted (to verify: the TS has no anomaly list on habitats).

Phase 2, still to do:
- Trade Hubs as freighter destinations (to verify: the freight path picks the nearest port);
- Trade Hub smuggling (to verify: Empire.2.cs 1380 smuggling missions).

---

## 3. Private facilities

**Rules.** All of these are new.
- **Who builds:** the private sector, from its *surplus*. The surplus is private money above:
  - a reserve of `econReserveK` (30 k);
  - half a year of its own ship and base upkeep (real: Empire.cs 2116 AnnualPrivateMaintenance);
  - one year of its facilities' upkeep.

  A facility starts only while its upkeep fits in the private cashflow (real: Empire.6.cs 556
  GetPrivateAnnualCashflow, the gate the stock DirectPrivateConstruction uses; counted as 0 when negative, since the
  formula leaves out contract sales to other empires) plus a tenth of the surplus (the idle money may carry ten years
  of upkeep), minus the upkeep already owed. Each 30-day review starts a waiting
  request, or up to 3 of the private sector's own picks, within `econSpendSharePct` (80 %) of the surplus.
- **Cost, build time and upkeep:** the price is paid at the start. It is 30–60 k × a size factor of
  1 + population / 4 bn (at most ×4), so a facility on a big, rich world costs what its private sector can raise and
  the sink grows with the economy. The build takes 240–420 days. Upkeep of 8–15 % of the price a year is paid monthly
  from private money.
- **Unpaid upkeep:** when the private money goes below 0, the facilities stop working. A facility unpaid for a year
  closes.
- **Slots by colony size (population):**
  - small = 1 slot below 0.8 bn;
  - medium = 2 slots below 3 bn;
  - large = 3 slots from 3 bn.

  The thresholds come from the real maximum population, `Diameter² × 250 000 × quality²`: a D200/q0.4 world holds
  1.6 bn, D250/q0.6 holds 5.6 bn, D320/q0.9 holds 21 bn, and capitals reach 10–25 bn. Outside the capitals the
  average colony holds about 1 bn in the soaks (§9). A colony that shrinks keeps what stands, but builds nothing new.
- **Refinery slot (phase 4, new):** every Mining Hub and Core World has one extra slot that only a refinery may use, so
  a refinery never competes with the other facilities for it (`slotsUsed`). Further refineries use normal slots.
- **Commissions (phase 4, new):** the state can commission a refinery. The player uses the **Fund** button beside
  Request (the journaled `econRequestFacility` with `fund = true`); the AI does it by itself (§7). The private sector
  pays what its surplus allows, up to half the price; the treasury pays the rest (all of it when the private surplus
  is empty). The refinery is private-owned: its upkeep is private, and its sales go to the private sector. It is a
  subsidy, not a state facility.
- **Infrastructure (phase 4, decision H):** like a private ship's price (real: BaconBuiltObject.cs 5106
  PrivateSectorBuildOrRefitInvestInInfrastructure, `1 − privateBuildCostToStateMoney` = 70 % of it), 70 % of a
  facility's price goes into the Bacon infrastructure of the facility's own colony (the stock picks a random space-port
  colony; here no Rnd). Without it the facilities took the private money that Bacon's own infrastructure investment
  (BaconHabitat.cs 887, which scales with the hoard) would have turned into development (§9).
- **Facility tax (phase 4, new):** every working facility pays 4 % of its price a year from private money to the state
  (monthly, never driving private money below 0). It keeps the AI treasuries level with the add-on on (§9).
- **Off-designation building is impossible.** Only facilities of the colony's own designation can be requested or
  built.
- **Exclusive pairs** never stand together, and a request for one blocks the other. Phase 1: Free Port XOR Customs
  Bureau. Phase 2 adds Black Market / Customs, Casino / Nature Preserve and Strip-Mine Charter / Deep Survey Office.
- **Requests:** the player requests a facility with a journaled command (`econRequestFacility`). Requests wait until
  the private sector can afford them, and go before its own picks. A request counts against the slots. The player can
  also switch off the private sector's own picks (`econSetAutoFacilities`).
- **AI choice:** each facility has a value for its colony, for example:
  - a Private Shipyard is worth more with a shipyard;
  - a Mining Consortium HQ is worth more with stations nearby;
  - an Arcology is worth more near the population cap;
  - Universities and Cultural Centers are worth less past a few.

  The value is weighted by the colony's tax revenue. The best affordable pair of colony and facility starts. There is
  no Rnd.
- **Governor skills:** a colony governor with the facility's matching skill (real: CharacterSkillType) makes it
  stronger, ×(1 + skill / 50) and at most ×2. (new)
- **Nationalised economies:** these are governments with SpecialFunctionCode 1, Corporate Nationalism (real:
  Empire.4.cs 1757 GetPrivateFunds uses StateMoney). They have no private sector, so they get neither private
  facilities nor bonds. Designations still apply.
- **Conquest:** the buildings stand, and the new owner keeps the designation and the facilities. A colony leaving the
  normal empires (to independents, pirates or destruction) loses its record.
- **Storage:** the facilities live in the add-on's saved state, not in `Habitat.Facilities`. The stock facility code
  never sees them: no stock maintenance, scrapping or AI path.

**The 42 facilities.** Phase 1 built the first 4 of each designation (★), phase 2 the other 3 (◆). Numbers are at 100 % strength.

| Designation | Facility | Effect (channel) | Skill |
|---|---|---|---|
| Industrial | ★ Private Shipyard | +20 % ship construction speed at this colony's yards | CivilianShipConstructionSpeed |
| | ★ Heavy Foundry | +30 % construction of facilities, wonders and colony-built bases here; −3 approval | FacilityConstructionSpeed |
| | ★ Component Works | ships and bases cost 2 % less empire-wide per works, at most 8 % (`designPriceFactor`) | MilitaryShipConstructionSpeed |
| | ★ Orbital Drydock | own ships self-repair 50 % faster in this system | RepairBonus |
| | ◆ Robotics Plant | troop upkeep −4 % empire-wide per plant, at most −12 % (**new** query `troopMaintenanceFactor`, Empire.cs 2025 AnnualTroopMaintenance); +10 % recruited troop strength here | TroopRecruitment |
| | ◆ Fleet Depot | own state ships and bases within 2 sectors: −15 % upkeep (**new** query `shipMaintenanceFactor`, BuiltObject.cs 782 AnnualSupportCost). Phase 4 refuelling (new): every 30 days own state ships within 2 sectors are topped up with their fuel, the state paying the depot's private sector the fuel's base price (`depotRefuel`; the stock refuelling depots, Habitat.IsRefuellingDepot, are untouched) | MilitaryShipConstructionSpeed |
| | ◆ Salvage Yard | yearly: up to 4 wrecks within 2 sectors (Wreckage add-on `wrecksAt` / `takeWrecks`): 25 % of their resources into the colony cargo, 10 % of their value to private money; without Wreckage: +4 % colony income | RepairBonus |
| Trade Hub | ★ Trade Exchange | +8 % colony income; ×1.25 with an Industrial colony within 3 sectors | TradeIncome |
| | ★ Investment Bank | bond interest −1.5 points per bank (at most −4); +3 % colony income | ColonyIncome |
| | ★ Free Port | +12 % colony income; raids recover 30 % faster nearby | TradeIncome |
| | ★ Customs Bureau | +10 % tax revenue here; −3 % colony income | ColonyCorruption |
| | ◆ Commodities Market | +5 % colony income; own colonies within 2 sectors lose 30 % less approval to shortages (market price smoothing: to verify, market.ts ReviewResourcePrices) | TradeIncome |
| | ◆ Merchant Guild Hall | the private freighter targets and caps +10 % per hall, at most +30 % (**new** query `privateFreighterFactor`, Empire.9.cs 4767 ProjectPrivateForceStructure): more private ships bought from private money | TradeIncome |
| | ◆ Black Market | +15 % colony income (smuggling); raids recover 40 % faster nearby; pirate control grows 30 % faster here; XOR Customs Bureau | ColonyIncome |
| Resort World | ★ Resort Complex | +1.0 scenic factor (more tourist traffic); ×1.25 with a Trade Hub within 3 sectors | TourismIncome |
| | ★ Media Network | +2 approval at own colonies within 2 sectors, +4 here | ColonyHappiness |
| | ★ Pleasure Gardens | +8 approval and +10 % growth here | ColonyHappiness |
| | ★ Diplomatic Retreat | each met, non-hostile empire's attitude to the owner +1 a year, at most +10 per empire (bias term) | Diplomacy |
| | ◆ Spaceport Casino | +15 % colony income; ×1.2 corruption here (**new** query `colonyCorruptionFactor`, Habitat.cs 763); XOR Nature Preserve | TourismIncome |
| | ◆ Nature Preserve | +3 approval, +0.3 scenic factor; planet damage heals 0.03 a year faster (Habitat.Damage, the real quality factor) | ColonyHappiness |
| | ◆ Pilgrimage Shrine | +3 approval at every own colony whose dominant race is the shrine world's (one shrine per race counts) | ColonyHappiness |
| Mining Hub | ★ Mining Consortium HQ | +15 % mining rate at own stations within 2 sectors | MiningRate |
| | ★ Orbital Warehouse | +3 development; own colonies in the system lose 30 % less approval to resource shortages (the stock −15 × (1 − supply) term, Habitat.cs 534) | |
| | ★ Deep Survey Office | every 2 years the richest deposit in the system below 1000 abundance gains +60 | MiningRate |
| | ★ Ore Refinery | +5 % colony income, +5 % mining in the system; its refined output comes in phase 3 | MiningRate |
| | ◆ Gas Refinery | +20 % gas mining at own gas stations and gas mining ships within 2 sectors; +3 % colony income | MiningRate |
| | ◆ Automated Extractors | own mining stations within 2 sectors: −30 % upkeep (`shipMaintenanceFactor`) | MiningRate |
| | ◆ Strip-Mine Charter | +30 % mining in the system; the planet takes 0.02 damage a year (quality falls, and with it the population cap); XOR Deep Survey Office | MiningRate |
| Core World | ★ Medical Complex | +15 % growth, +1 approval (fewer plagues: phase 2, to verify against Habitat.cs 1838 InfectWithPlague) | PopulationGrowth |
| | ★ University | +3 % research in each field (empire-wide sum, real cap 100 %) (better characters: phase 2) | ResearchHighTech |
| | ★ Arcology | +15 % population cap here; 8 % upkeep | PopulationGrowth |
| | ★ Cultural Center | +1 approval at every own colony per center, at most +3 | ColonyHappiness |
| | ◆ Administrative Center | corruption ×0.5 here and ×0.7 at own colonies within 2 sectors (`colonyCorruptionFactor`). Longer governor tenure (Characters & Victory cvTenureYears): phase 4 | ColonyCorruption |
| | ◆ Genetics Institute | +10 % growth here; new own colonies within 3 sectors grow 25 % faster for 5 years | PopulationGrowth |
| | ◆ Senate Hall | +1 approval at every own colony (at most +2); Interstellar Diet vote weight +20 % per hall, at most +40 % (**new** query `dietVoteWeightFactor` in dietAi.ts voteWeight); 15 % upkeep | Diplomacy |
| Frontier / Garrison | ★ Private Security Firm | +25 % recruited troop strength; pirate control grows 40 % slower here | TroopRecruitment |
| | ★ Militia Yard | +40 % construction of facilities and colony-built bases here (which bases the colony queue builds: to verify); raids recover 30 % slower nearby. Phase 4 (new): 2 militia ships per yard (at most 6 an empire), below | MilitaryShipConstructionSpeed |
| | ★ Survey Outpost | every ship and base within 1 sector of the colony is visible to its owner (`objectVisibleToAll`) | |
| | ★ Colonist Office | new own colonies within 2 sectors grow 40 % faster for their first 5 years (cheaper colony ships: phase 2) | ColonyShipConstructionSpeed |
| | ◆ Fortress Bunker | +30 DefensiveFortressBonus here (**new** query `colonyFortressBonus`, Habitat.cs 7216 ReviewPlanetaryFacilities: the stock wonder × bunker bonus) | TroopRecruitment |
| | ◆ Bounty Office | bounty hunters, below | BountyHunter trait (+1 hunter) |
| | ◆ Frontier Charter | +4 approval here; −1.5 autonomy drift a year with Frontier Autonomy on (**new** query `frontierDriftTerms` in frontier.ts autonomyDrift); −10 % tax revenue here | ColonyHappiness |

**Synergies.** Phase 1 has these, all new:
- supply chain: Industrial + a Mining Hub within 2 sectors, Industrial construction bonus ×1.2;
- market: a Trade Exchange + an Industrial colony within 3 sectors, ×1.25;
- tourist trade: a Resort Complex + a Trade Hub within 3 sectors, ×1.25;
- a designation's bonus grows 10 % per working facility.

Phase 2: Media Network × Cultural Center, Fleet Depot × Orbital Drydock, and Free Port × Merchant Guild Hall.

**Bounty Office** (phase 2, built; the user's approved design; `colonyEconomy/bounty.ts`). The private sector keeps
its own small armed bounty-hunter ships:
- **Build:** private money only, through the stock private build steps (real: Empire.6.cs 741
  DirectPrivateConstruction: the shortest private yard queue, a private object, the yard's income record, component
  orders, PerformPrivateTransaction). Upkeep is private maintenance like any freighter's.
- **Design:** the Privateers add-on's (privateers.ts `generatePrivateerDesign`: the empire's escort / frigate /
  destroyer template, one tech tier down, at most 40 % of its largest ship), renamed "Bounty Hunter".
- **Count:** 3 + one per 500 k of private money, at most 6. A character with the BountyHunter trait (real:
  CharacterTraitType) adds one, still at most 6.
- **Missions:** every 30 days, and whenever the stock assignment asks (the `privateShipMission` event):
  - attack the nearest pirate ship within 2 sectors of an office;
  - else patrol the office's colony.
- **Bounty:** each pirate ship the empire destroys pays its private sector 25 % of the ship's price
  (`builtObjectKilledBy`).
- **With Privateers on:** each office adds 2 to the privateer count cap (`privateerHooks.extraCap`). A faster rebuild:
  to verify.
- **Retirement:** extras retire (a scrap mission) when the office closes or private money goes negative.

**Bounty Office AI (phase 4, new; decision E).** The facility review remembers when pirates raided a colony
(`Habitat.raidCountdown` > 0) or controlled it (`pirateColonyControl`), as `raidedAt`. Such a colony scores +20 for
Frontier (§2), and a Bounty Office there is worth 4 to the AI (the most of any Frontier facility), even beside another
office.

**Militia Yard ships (phase 4, new; decision F).** Each working Militia Yard has the private sector keep 2 local
defence ships, at most 6 an empire, on the same build path and design as the bounty hunters (named "Militia"; private
money pays the price and the upkeep). They attack pirate ships within 1 sector of a Militia Yard colony and otherwise
patrol the nearest one. They retire when the yard closes or private money goes below 0. Not done (the user's decision):
the Administrative Center's tenure, the Medical Complex's plague effect and lower-tier builds.

---

## 4. Bonds

New, except where noted.
- **Lender:** the state borrows from its OWN private sector: `PrivateMoney → StateMoney`. Each 30-day instalment
  (principal + interest, an annuity) goes back from StateMoney to PrivateMoney.
- **Rate:** `econBondRatePct` (8 %), with these adjustments:
  - −1.5 points per working Investment Bank, at most −4;
  - +2 when the debt is over half the cap;
  - +2 with arrears;
  - never below 2 %.

  Bacon's own loan (real, BaconEmpire.cs 420-540) uses `max(2, 6 ± … )`.
- **Term:** `econBondTermYears` (5).
- **Limits (anti-abuse):**
  - outstanding principal ≤ `econBondCapPct` (100 %) of the annual tax revenue;
  - all instalments ≤ 30 % of the tax revenue a year;
  - at most 4 bonds outstanding;
  - one issue every 180 days;
  - one bond takes at most `econBondPrivateSharePct` (50 %) of the private surplus (§3);
  - no bonds in a nationalised economy.
- **When:** the AI (and the player with "automatic bonds" on) borrows when the treasury is below 3 months of state
  expenses. It borrows up to 6 months' worth. Expenses are state maintenance, troops and facilities (real:
  BaconEmpire.cs 608, troops.ts, PlanetaryFacilityList.cs 228).
- **The player** sells a bond, repays one early in full, or switches automatic bonds on, all with journaled commands.
- **Missed instalments** become arrears and carry interest.
- **Default:** arrears worth more than 12 instalments are a default.
  - The bonds are written off: the private sector loses them.
  - Every colony takes −5 approval for 3 years (stability cause "bonds").
  - No new bond is sold for 5 years.
- **Treasury view:** the Empire Summary's "Bonds & private sector" link opens it. It shows:
  - the outstanding debt, the cap and the arrears;
  - each bond's principal, outstanding amount, rate, instalment, payments left and maturity;
  - the yearly debt service and the interest paid;
  - what a new bond could raise now, and why not;
  - the private surplus.

---

## 5. Refinement chain (Option A, phase 3; the bottleneck, phase 4: built)

The user chose Option A over B. Code: `colonyEconomy/refinement.ts`; switch `econRefinement` (new games only).

**The goods.** There are six new resource types, all new:

| Good | Refinery (designation) | Raw inputs (real resources.txt names) | Used by component categories (real: ComponentCategoryType) |
|---|---|---|---|
| Alloys | Smelter (Mining Hub) | Steel, Iridium, Lead, Carbon Fibre | Armor, Engine, Construction, AssaultPod, Extractor, Manufacturer |
| Electronics | Electronics Fab (Core World) | Silicon, Chromium, Aculon, Gold | the weapons, Shields, ShieldRecharge, Sensor, Computer, Labs, HyperDisrupt |
| Polymer Composites | Chemical Plant (Mining Hub) | Polymer, Helium, Argon, Krypton | Habitation, Storage, Fighter |
| Reactor Fuel Cells | Fuel Refinery (Mining Hub) | Caslon, Hydrogen, Tyderios | Reactor, HyperDrive, EnergyCollector |
| Exotics | Exotic Materials Lab (Core World) | Emeros Crystal, Nekros Stone, Osalia, Dilithium Crystal | WeaponSuperBeam / Area / Torpedo; also tech-7+ reactors, hyperdrives and weapons (below) |
| Precision Components (phase 4) | Precision Works (Core World) | Electronics, Exotics (refined goods: the third step) | every tech-7+ component (below) |

- **Naming:** "Polymers" is called **Polymer Composites**, because the game already has a raw resource "Polymer"
  (id 16).
- **Icons:** our own SVG art (`public/art/economy/good-*.svg`, picture refs 9000–9005; `ui/resourceIcons.ts`). No
  original image is used. A game started with the phase-3 five goods gets Precision Components appended (ids kept).

**How the goods exist only when the flag is on.** This is new, a mod-layer hook (`registerScenarioDataExtension`).
- **Why not an overlay file:** a `resources.txt` overlay, like Rim Trade's, would put the goods in the data of every
  game that loads the add-on, flags off included. That breaks the flag-off identity: tested, the start draws 262 795
  instead of 262 043, because galaxy generation and the stock AI iterate the whole resource list.
- **What is done instead:** the game data gets the goods only for a game whose resolved flags include
  `econRefinement`. This happens in:
  - createGame (the chosen flags);
  - deserializeGame (the save's start options);
  - the sim-worker replica (the snapshot's start options).
- **Generation:** the goods have no distributions, so they are never placed. They also stay out of generation's
  resource shuffle (galaxy.ts generateRandomOrderedResources; `scenario/scenarioGoods.ts`).
- **Limitation:** a save the add-on is *added* to has no goods. Refinement then stays inactive and the refineries
  cannot be requested.
- **Type:** the goods are Mineral, i.e. strategic. The stock start-up stockpiles at space ports therefore include
  some of them (seen: 375 Electronics and 375 Reactor Fuel Cells at a capital), a head start.

**Production** (every 30 days). A working refinery uses the colony's trading post: its space port, else the colony
(real: freight.ts generateValidTradingPosts, the sources orders are filled from).
- It takes up to 100 units (60 before 2026-10-11) of each raw input held there by the owner and makes half as many
  units of its good, into the same cargo.
- Short of inputs, it orders 200 units of each one not already on order (before 2026-10-11: only the scarcest, which
  starved the refineries) (real: Empire.4.cs CreateOrder, `empireCreateOrder`). The stock
  freight path then brings the input and pays the seller's private sector (real: Empire.4.cs 1135 InitiateContract).

**The bottleneck (phase 4, the user's decision A; all new rules on the real channels).**
- **A component's tech level** is the techLevel of the research project that unlocks it (real: Galaxy.3.cs
  SetResearchCosts sets `Component.TechLevel` from the node; `ComponentDefinition.techLevel`). The super weapons'
  100+ count as 7. The level of the improvement in use (ComponentImprovement.techLevel) is **not** used: an improvement
  would raise the need of every old design too, and the AI's one-tier-lower fallback could never escape it.
- **Need per component**, of the good of its category (the table above); a design needs the sum over its components,
  and bases (role Base) need half, rounded up:

  | Tech level | Units | Missing goods |
  |---|---|---|
  | 0–2 | none | – |
  | 3 | 1 | soft: the build runs at ×0.7 |
  | 4 | 1 | soft: ×0.6 |
  | 5–6 | 2, and weapons / shields / sensors +1 Electronics | **hard**: the build waits at the yard |
  | 7+ | 3 (4 for reactors, hyperdrives and weapons, which also need 1 Exotics), and 1 Precision Components | **hard** |

- **Partial supply:** a soft shortfall costs in proportion: the factor is `1 − Σ(unit penalty × missing share of its
  good) / soft units`, with the goods held at the yard after the hard needs are set aside.
- **Where:** the factor is a new per-build query `buildGoodsFactor` in constructionQueue.ts
  processSingleConstructionYard (ConstructionQueue.cs 286), on the progress of each build at a shipyard base or a
  colony's own queue. Constructor ships, retrofits and scrapping are exempt. So are pirates and independents
  (`isEconEmpire`). A waiting build keeps its yard slot, as the stock game does while components are missing.
- **Use:** a completed build consumes its need from the yard's (or colony's) cargo (the `builtObjectBuilt` event, now
  carrying the yard and the colony).
- **Early bonus:** while none of an empire's researched components needs a good (tech < 3), a yard holding the four
  common goods builds up to +15 % faster (in proportion to its stock at 60 each), and the empire's ships and bases cost
  5 % less while one of its yards holds a quarter of that stock (designPriceFactor; empire-wide, since the price is
  set before a yard is chosen). Nothing is consumed in that era, so the stock carries over. A refinery whose good
  nothing the empire has researched needs yet earns +5 % colony income (IncomeBoost; "sells ahead").
- **The era** (`goodsNow` / `goodsNext`, saved, every 30 days): per good, the highest tech level of the researched
  components that need it, and of the components the next research projects unlock.

**Hauling.** Every 30 days each own shipyard with work queued orders the goods it is short of: the needs of its queued
builds (at most 400 of a good), and at least 60 of each common good and 10 Exotics once the empire's era is past
tech 2 or while the early bonus lasts. Colony queues order their builds' needs. These are state orders: the state pays
for what its yards use, and the refinery's private sector earns. The stock freight path fills them from the
refineries' trading posts; private freighters carry the goods and show on the Freight Flows overlay.

**Refinery access (phase 4, decision B; all new).**
- The extra refinery slot at Mining Hubs and Core Worlds, and commissions from the treasury (§3).
- **AI commissions** (`supply.ts`, every 30 days): when the next research reaches a good's tier (3; Precision
  Components 7) and the empire has no refinery of it (built, building or requested), the AI commissions one at the
  most populous colony of the refinery's designation with a free slot. Once a researched component needs the good, it
  wants one more per 4 shipyards (at most 3). It designates an undesignated colony first when it has none (never the
  home world, never one below 40 M people).
  **Supply planning (2026-10-11).** Once a good is needed, or about to be, at a hard tier (5+), the AI wants one
  refinery of it per 2 shipyards (at most 6): the hard tiers need two to four units a component. Exotics and
  Precision Components want one per 5 yards (at most 3), and an empire whose researched components reach tech 5 plans
  one Exotic Materials Lab and one Precision Works ahead of tech 7 (the Works needs both refined inputs, so it takes
  longest to come into supply). Goods with no refinery at all at a hard tier go first; at most two commissions a
  review, while the treasury holds 1.2 times the state's share.
- **Supply alerts:** the player gets one warning per good when research is about to need a good no refinery of theirs
  makes. The treasury window (Empire Summary → "Bonds & private sector") lists every good's status and, per
  shipyard, the goods its queued builds lack and the builds waiting.
- **AI safeguards:**
  - `aiBuildDesign` (empireConstruction.ts directConstruction: the warship / auxiliary loop and the space ports): an AI
    that cannot supply a design's hard goods (no refinery of the good built, building or requested, and less than two
    builds' worth at its yards and its colonies' trading posts — only when supply is impossible) queues the newest older design of the sub-role it can supply, one tier lower. With none, it keeps the
    design (it waits).
  - **No deadlock:** an AI build that has waited 120 days (180 before 2026-10-11) for hard goods goes on at ×0.5 with what the yard holds
    (`reliefBuilds`). The player's builds keep waiting (the treasury window shows them). Found in the first phase 4
    soak: the Ancient Guardians start at tech 7, have no Precision Works, and built a fifth of their tech-5+ warships.
  - The AI's mining stations within 2 sectors of a working refinery want 50 % more escort (the
    `miningStationPatrolPriority` query, Empire.5.cs 1331): the refinery's input lanes. The refinery colonies themselves
    get no extra defence (to verify: a per-colony defence query does not exist yet).
- **AI private picks:** refineries are worth 4 while research needs or is about to need the good and the empire has
  none, 2.5 otherwise; Precision Works only once tech 6 is near.

**Fallback:** Option B, "production capability", stays the lighter alternative. It was not needed.

## 6. UI

Every action is a journaled player command (multiplayer-safe). Commands and their failure values are in
`player/playerOps.ts` and `simworker/commandFailure.ts`.
- **Colony screen:** a new **Economy** tab, shown only with the add-on on. It holds:
  - the designation picker, with the suggestion, its reasons and the cooldown;
  - the bonus line, and a warning about the facilities a change would close;
  - the facility slots: built (working or unpaid), under construction (progress), requested;
  - the facility menu of the designation, each with its effect, price, build time and upkeep, and a Request or
    Cancel button;
  - the private surplus, and the "private sector builds on its own" toggle.

  The colony's bonus list shows the add-on's bonuses as "Colony Economy".
- **Empire Summary:** a "Bonds & private sector →" link opens the treasury view (§4), with Sell bond, Repay and
  automatic bonds.
- **Colony selection panel (phase 4):** for the player's own colonies, a "Designation" row (the badge and the name)
  and the private facilities' icons after the stock facility icons on the Facilities strip (faded while building or
  not working; the hover names the facility and its effect; a click opens its Galactopedia entry).
  `ui/scenario/colonyEconomyInfo.ts`.
- **Galactopedia (phase 4):** an "Add-ons: Colony Economy" topic with an entry for every designation, private facility
  and refined good, and one on the tech-level rules (generated pages, `ui/scenario/colonyEconomyPedia.ts`).
- **Colonies list (phase 4):** a sortable Designation column (badge + name) and a designation filter above the grid.
- **Economy tab (phase 4):** the refinery slot row at Mining Hubs and Core Worlds, and a **Fund** button beside
  Request on each refinery (the treasury commissions it; its tooltip gives the state's share).
- **Treasury window (phase 4):** the refined goods' status (needed now / soon / not yet, working refineries) and, per
  shipyard, the goods its queued builds lack and the builds waiting for goods.
- **Icons:** our own SVGs, generated by `scripts/gen-econ-icons.mjs` (`public/art/economy/fac-<id>.svg`,
  `desig-<n>.svg`, `good-precision.svg`): the goods' dark tile with a ring in the designation's colour and a glyph.
- **Map:** the "Colony Designations" overlay toggle (View popup, a mod row; on by default). It draws a small badge
  for each of the viewer's own colonies that has a designation (foreign designations stay hidden: phase 2 could show
  them through intelligence). Hovering a badge names the designation and the facilities. Our own procedural art: a
  dark disc, a coloured ring and a glyph per designation (gear, two arrows, star, pick, crown, shield).

---

## 7. AI

- **Designations:** §2, all AI empires.
- **Facilities:** §3. The AI's private sector picks by value. The player's private sector does too, unless switched
  off.
- **Bonds:** §4, borrowing when below 3 months of expenses. Repayment is automatic. The stock AI does not plan around
  the debt service, which is why the service cap (30 % of tax revenue) exists.
- **Refined goods (phase 4):** commissions ahead of research, the one-tier-lower design fallback, and escorts for the
  refineries' input stations (§5).
- **Smarter AI (later):** designation weights per race and strategy, wartime Frontier / Industrial shifts, and bond
  avoidance when cashflow is negative.

---

## 8. Integration with the other add-ons, and conflicts

| Add-on | Integration | Status |
|---|---|---|
| Privateers | Bounty Office boost (more privateers based there, faster rebuild, bounty bonus); Militia and hunter ships share its build path | phase 2 |
| Internal Security | Every approval term goes through stability.ts, so the ledger lists "Colony Economy" and "Defaulted on bonds" with the other causes | built |
| Frontier Autonomy | Frontier / Garrison colonies and their Private Security lower drift (phase 2: an autonomy term); Frontier Charter (phase 2) | phase 2 |
| Characters & Victory | Governor skill boosts are built. The Administrative Center's longer tenure (cvTenureYears) comes in phase 2. Designations could feed the governor-fit score (governorsCv fitAt), phase 2 | partly |
| Interstellar Diet | Senate Hall vote weight (dietAi voteWeight) in phase 2; the Diet's free trade law → Trade Hub income ×1.1 in phase 2 | phase 2 |
| Rim Trade | rare goods held at a Resort or Trade Hub → a bigger effect (phase 2). Both add resource bonuses through the same query, and they stack | phase 2 |
| Wreckage | Salvage Yard (phase 2) takes resources from nearby wreck fields (`takeWrecks`) | phase 2 |
| Chartered Companies | a company colony is a sub-empire with its own private sector, so it designates and builds like any AI empire. Nothing special is needed | works |
| Smarter AI | may later override `aiDesignationChoice`; its budget rules should know the debt service | later |
| Colony Defence | Frontier pirate-control slowing stacks with its gain block | works |

**Conflicts, for the user:**
- **C1. Bacon infrastructure (real, ON in the shipped settings) already turns private money into development.** The
  plan's phase 4 "private colony investment" would duplicate it. Recommendation: drop phase 4's investment item, or
  fold it into facilities. Facilities are the add-on's private sink, and the soaks measure the hoard with
  infrastructure already running.
- **C2. Bacon has an unported player-only loan** (5 M credit line, 120 monthly payments). If it is ported later, it
  and the bonds are two debt systems. Recommendation: when the add-on is on, the Bacon loan console should route to
  bonds.
- **C3. The scenic factor drives tourist traffic, not income per tourist** (§0.3). Resorts gain by drawing passenger
  ships. On a galaxy with few passenger ships, the Resort Complex is weak.
- **C4. `colonyResourceBonuses` is shared with Rim Trade.** Bonuses stack additively, and research is capped at
  100 % empire-wide by the real code. No conflict, but stacking needs balancing.
- **C5. Reputation ledger:** the Diplomatic Retreat writes through `applyReputation` (bias term, no decay), so it
  shows in the ledger when that add-on is on and uses the stock bias field when it is off.
- **C6. Facilities are not stock PlanetaryFacilities.** They do not show in the stock Facilities tab (phase 4: they do
  show on the selection panel's Facilities strip and have their own Galactopedia entries), and stock "facility" counts (achievements, AI facility reviews) ignore them. Recommendation: keep them separate.
  Using stock facility slots would change the faithful AI's own facility logic.

- **C7. Refined goods and saves.** The goods exist only in games started with the refinement chain on (§5). Adding
  the add-on to a save leaves the chain inactive. Porting the chain to added saves would need the save loader to
  extend the data at the journalled add-on boundary.
---

## 9. Measurements and tuning

The soak configs `econ-on-s1` / `econ-off-s1` (seed 1, 1000 stars, 10 empires) and `colony-economy` run with the
scratch hook (`~/data/agent-tmp/economy-p1/econhook.mjs`). Results are filled in below.

### Phase 1 (2026-10-11)

Seed 1, 1000 stars, 10 empires, 10 years. "Galaxy-wide" means every normal empire, the unattended human seat
included. The off run is the faithful game (master switch off).

| | off | on (final tuning) |
|---|---|---|
| **Private money, galaxy-wide** | **9.48 M** | **7.57 M (−20 %)** |
| Private money, AI empires | 8.75 M | 6.90 M (−21 %) |
| Spent on facilities (purchase / upkeep) | – | 2.96 M / 0.86 M |
| Facilities built (+ building) | – | 25 (+6): Mining Hub 14, Core World 9, Industrial 2 |
| Designations (of 46 colonies) | – | Mining Hub 21, Core World 10, Industrial 1, Trade Hub 1, none 13 |
| Bonds outstanding / borrowed / repaid / interest | – | 19 / 0.69 M / 0.48 M / 0.11 M, no defaults |
| AI state money | 3.83 M | 2.88 M |
| Colonies / population | 48 / 172.9 bn | 46 / 187.1 bn |
| Annual tax revenue | 3.16 M | 2.96 M |
| Mean development / approval | 20.8 / 14.0 | 22.0 / 12.3 |
| State ships and bases | 768 | 696 |
| Save round trip and continuation | identical | identical |

**Step time on the big save.** `~/wt/eng-perf/scratch/late.save` (27 empires, 47.7 k built objects), with the add-on
added to the save. Each run is a 360 s warm-up (65 colonies designated, 119 facilities started and 13 bonds sold
during it), then 120 game seconds (7200 steps), two runs each:

| | wall ms / step | CPU ms / step |
|---|---|---|
| Off | 7.44, 6.58 | 7.98, 7.21 |
| On | 7.09, 6.88 | 8.10, 7.70 |

That is about +3 % CPU, within run-to-run noise. In the first on soak, the whole-soak wall time was nearly 2× the off
run's in years 6–10, but the save-based measurement above does not show it. That soak had a different history and
ran on a shared machine.

**Tuning applied in the soaks.**
1. **Prices.** With base prices only, the private sector spent 1.5 M in 10 years: private money −5 %. Prices now scale
   with the colony (×1 + population / 4 bn, at most ×4) and upkeep doubled (8–15 % a year).
2. **The binding limit.** It was the cashflow room for upkeep: the private sector's after-tax cashflow is small (taxes
   come out of private money, §0.1). Upkeep may now also be carried by a tenth of the surplus.
3. **Mining Hub.** It took over (26 of 52 colonies) while scoring on uncolonised deposits alone. It now needs nearby
   mining stations to score fully, and the crowding penalty is −15 a colony past a sixth. It still leads, because most
   small colonies are mining outposts.
4. **Bonds.** AI empires borrowed in their first year and stayed at the cap. They now borrow only below 1.5 months of
   expenses, and not when the yearly deficit is more than 3 months' expenses.

**Open points, reported rather than tuned away.**
- **Bacon infrastructure.** Its investment chance is proportional to private money, so spending the hoard on
  facilities lowers it (C1). Development still ends higher with the add-on on (22.0 vs 20.8), thanks to the Orbital
  Warehouses.
- **Approval −1.7 and tax revenue −6 %.** These come from the Mining Hub drawbacks on many colonies. The AI's scores
  do not weigh drawbacks yet (Smarter AI, phase 4).
- **AI treasuries −25 %.** The causes are the debt service and the lower tax. The AI has fewer state ships (−9 %) but
  more population (+8 %).

### Phase 2 (2026-10-11)

These runs use the same setup as phase 1 (seed 1, 1000 stars, 10 empires, 10 years), with all 42 facilities available.

**The hoard is the Ancient Guardians'.** The Ancient Guardians are the story empire of one world. Their private
sector holds most of the galaxy's private money (6.5 M of 9.5 M at year 10 with the add-on off). Their world had no
capital set, so the "capital is always designated" rule missed it. They are reported apart below, and the fix
(designate the most populous colony when there is no capital) is in the phase 3 commit.

| | off | on |
|---|---|---|
| Private money, galaxy-wide | 9.48 M | 7.27 M (−23 %) |
| **Private money, AI empires without the Ancient Guardians** | **2.24 M** | **1.34 M (−40 %)** |
| Ancient Guardians' private money | 6.51 M | 5.40 M |
| Player seat (unattended) | 0.73 M | 0.53 M |
| Spent on facilities (purchase / upkeep) | – | 2.39 M / 0.85 M |
| Facilities built (+ building) | – | 24 (+4): Mining Consortium 6, Medical Complex 4, Cultural Center 4, Automated Extractors 3, Orbital Warehouse 3, Private Security, Orbital Drydock, Strip-Mine Charter, University |
| Facilities by designation | – | Mining Hub 13, Core World 9, Industrial 1, Frontier 1 |
| Designations (of 47 colonies) | – | Mining Hub 20, Core World 10, Industrial 2, Trade Hub 1, Frontier 1, none 13 |
| Bonds outstanding / borrowed / repaid / interest | – | 17 / 0.57 M / 0.43 M / 0.10 M, no defaults |
| AI state money | 3.83 M | 3.04 M |
| Colonies / population | 48 / 172.9 bn | 47 / 185.2 bn |
| Annual tax revenue | 3.16 M | 3.19 M |
| Mean development / approval | 20.8 / 14.0 | 21.2 / 13.8 |
| State ships and bases | 768 | 739 |
| Bounty hunters | – | 0 (no Bounty Office was built) |
| Save round trip and continuation | identical | identical |

**Reading the numbers.**
- Most of the AI empires' private surplus is now spent: their surplus is 0–250 k at year 10, against 0–350 k off.
- Phase 2 facilities are still rare. The AI's values favour the phase 1 ones where both fit, and the slots fill
  early.
- No Bounty Office was built in this seed: Frontier designations are rare (1). The AI's Frontier score needs distant
  colonies.
- Tax revenue and approval are now back at the off run's level: the Mining Hub crowding fix of phase 1 holds.

**Wall time.** The whole-soak wall times (on runs 1.5–2× the off ones in years 6–10) were measured on cores shared
with three other agents' soaks: four or more node processes per core set at nice 19. The step time on the big save
(phase 1 table; phase 3 below for the full add-on) is the controlled measurement.

### Phase 3 (2026-10-11): the whole add-on with the refinement chain

There are two seeds: seed 1 runs 10 years and seed 2 runs 8 years (1000 stars, 10 empires each). "AI ex. AG" means
the AI empires without the Ancient Guardians.

| | seed 1 off | seed 1 on | seed 2 off | seed 2 on |
|---|---|---|---|---|
| **Private money, AI ex. AG** | **2.24 M** | **1.25 M (−44 %)** | **2.31 M** | **1.18 M (−49 %)** |
| Ancient Guardians' private money | 6.51 M | 4.53 M | 4.46 M | 3.35 M |
| Private money, galaxy-wide | 9.48 M | 5.89 M (−38 %) | 7.27 M | 4.87 M (−33 %) |
| Facilities built (+ building) | – | 18 (+4) | – | 12 (+6) |
| Refineries | – | Chemical Plant 3, Electronics Fab 2, Smelter 1, Fuel Refinery 1 | – | Chemical Plant 1, Electronics Fab 1 |
| Goods made: Alloys / Electronics / Polymer Composites / Fuel Cells | – | 2.0 k / 11.4 k / 2.0 k / 0.5 k | – | 0 / 5.9 k / 0.5 k / 0 |
| Goods used by completed builds | – | 3.9 k / 4.2 k / 4.3 k / 1.8 k | – | 2.7 k / 3.3 k / 2.1 k / 1.4 k |
| Builds completed / short of some good | – | 2079 / 1936 | – | 1595 / 1538 |
| Bonds outstanding / borrowed / repaid / interest | – | 11 / 0.47 M / 0.36 M / 0.08 M | – | 17 / 0.39 M / 0.23 M / 0.05 M |
| AI state money | 3.83 M | 3.64 M | 2.11 M | 2.32 M |
| Colonies / population | 48 / 172.9 bn | 49 / 182.3 bn | 32 / 156.5 bn | 35 / 158.6 bn |
| Annual tax revenue | 3.16 M | 2.90 M | 2.27 M | 2.31 M |
| Mean development / approval | 20.8 / 14.0 | 16.6 / 14.0 | 21.8 / 15.2 | 21.4 / 14.4 |
| State ships and bases | 768 | 673 (−12 %) | 570 | 521 (−9 %) |
| Save round trip and continuation | identical | identical | identical | identical |

**Reading the numbers.**
- **The private surplus:** about half of it is spent. The AI empires' private money ends at 0.5–0.6 of the off
  run's.
- **The goods are used before they are made.** The start-up stockpiles (§5) and early refining are consumed by the
  first builds. Afterwards most builds complete short of some good, because there are only 1–7 refineries a galaxy.
- **The speed penalty costs the AI 9–12 % of its ships.** Builds are ×0.95 without goods and up to ×1.25 with them,
  and the state pays for the goods its yards order. That is the price of the chain, not a block.
- **More refineries would close the gap.** That is phase 4 balancing: Smarter AI could value refineries by the
  shortfall.
- **Development on seed 1 (16.6 vs 20.8)** is not repeated on seed 2 (21.4 vs 21.8). Tax revenue on seed 2 is level
  (+2 %). The seed 1 drop is that game's history.
- **Tuning applied.** In the first phase 3 soak, three refineries needed an Industrial colony, which the AI seldom
  makes, and only Fuel Cells were refined. The refineries moved to the Mining Hubs and Core Worlds. Yard orders
  became state orders, the penalty went from ×0.90 to ×0.95, and refining from 40 to 60 units an input a month.

**Step time on the big save** (`~/wt/eng-perf/scratch/late.save`, the add-on added to the save: designations,
facilities and bonds. The refinement chain stays off in an added save, C7). The same 360 s warm-up and 120 s
measurement as phase 1; by then 65 colonies are designated, 133 facilities started and 14 bonds sold:

| | wall ms / step | CPU ms / step |
|---|---|---|
| Off | 6.40, 6.59, 6.69, 6.58 | 7.29, 7.28, 7.38, 7.06 |
| On | 7.06, 7.04, 6.93, 7.13 | 7.79, 7.78, 7.70, 7.91 |

That is about +6 % CPU. A CPU profile of an on run puts the add-on's own functions at under 0.5 % of the sim time,
and the whole scenario hook machinery (every add-on) at about 1.2 %. The rest of the difference is the game itself
playing out differently with the add-on: more facilities, freighters and orders. The fast exits added for the hot
queries (per-ship upkeep, ship prices, visibility) did not move it.

### Phase 4 (2026-10-11): the bottleneck, refinery access, balance

Seeds 3 and 4, 700 stars (`starCountIndex` 3), 11 empires, 10 years, add-on off vs on, run one at a time with the
scratch hook `~/data/agent-tmp/econ-p4/econhook4.mjs`. "AG" is the Ancient Guardians (the one empire at tech 7 from
the start); "AI" is the other AI empires. Year 10:

| | seed 3 off | seed 3 on | seed 4 off | seed 4 on |
|---|---|---|---|---|
| **AI private money** | **9.83 M** | **6.14 M (−37 %)** | **9.75 M** | **5.51 M (−43 %)** |
| **AI state money** | **3.55 M** | **4.42 M (+24 %)** | **4.54 M** | **5.41 M (+19 %)** |
| Facility tax paid (total) | – | 0.31 M | – | 0.33 M |
| Annual tax revenue | 2.78 M | 2.93 M | 3.07 M | 2.92 M |
| Warships, AI (ex. AG) | 389 | 370 (−5 %) | 298 | 269 (−10 %) |
| Warships, AG | 159 | 141 | 176 | 99 |
| Ships and bases, all | 784 | 756 | 696 | 603 |
| Colonies | 44 | 56 | 37 | 46 |
| Mining Hubs | – | 14 (25 %) | – | 11 (24 %) |
| Facilities built / refineries / commissions | – | 28 / 10 / 7 | – | 28 / 13 / 10 |
| Builds completed / short of a soft good / waited for a hard good | – | 2190 / 230 / 95 (4.3 %) | – | 1977 / 378 / 99 (5.0 %) |
| AI builds on the 180-day relief | – | 90 | – | 100 |
| Bounty Offices / militia ships | – | 2 / 4 | – | 1 / 0 |
| Highest AI tech level (ex. AG) | 3 | 4 | 3 | 3 |
| Mean development, all colonies | 22.0 | 16.8 | 24.2 | 17.8 |
| … the 11 colonies of year 0 | 50.0 | 50.0 | 50.0 | 45.9 |
| … founded in years 1-3 | 19.1 (11) | 14.4 (12) | 14.7 (7) | 14.2 (11) |
| … founded in years 4-6 | 11.5 (13) | 10.2 (16) | 13.8 (9) | 8.5 (12) |
| … founded in years 7-10 | 6.3 (9) | 2.7 (16) | 11.9 (10) | 4.8 (12) |

**Reading the numbers.**
- **The hoard:** the AI private sectors keep 57–63 % of the off run's money (phase 3: 51–56 %).
- **The state:** with the facility tax the AI treasuries end 19–24 % above the off run's (phase 3: −5 % / +10 %).
- **Warships:** the other AI empires end with 5–10 % fewer warships (phase 3: 9–12 % fewer ships). They never pass
  tech 4 in 10 years, so only the soft tiers touch them: 10–19 % of their builds finish short of a good, at ×0.6–0.7.
  The AI design fallback never triggered (no AI below tech 5 needs a hard good).
- **Past tech 5:** only the Ancient Guardians, who start at tech 7 with no Precision Works. They keep building
  (tech-5+ warships rise every year: 0 → 60 and 0 → 41) but slower: in the first phase 4 soak, before the 180-day
  relief, they made a fifth of the off run's. With it they reach 89 % and 56 %. The 4–5 % of builds that waited for a
  hard good are almost all theirs.
- **Mining Hubs:** 24–25 % of the colonies (phase 3: up to half; the target was ≤ 30 %).
- **Development (decision H):** the on runs found 9–12 more colonies, so the mean falls partly by dilution: more,
  younger and smaller colonies. Colony by colony:
  - the 11 colonies of year 0 end level on seed 3 (50.0 / 50.0) and 8 % lower on seed 4;
  - colonies founded later are lower in each cohort, most for the youngest (each on cohort also holds more colonies).

  Part of it was real, and is fixed: the facilities spent private money that Bacon's infrastructure investment
  (BaconHabitat.cs 887, which scales with the hoard) would have turned into development. With 70 % of each facility's
  price routed into its colony's infrastructure (§3), seed 3's mean rose from 13.5 to 16.8 and the year-0 colonies
  from 47.9 to 50.0. The rest of the young colonies' gap is still open (to verify: their approval under the Mining Hub /
  Industrial drawbacks, and the Bacon investment's 30 000 tax-revenue gate).
- **Not seen in the soaks:** no AI built a Fleet Depot (Industrial colonies are rare), so refuelling ran only in the
  tests.
- **Save round trip:** every run's save check passed.
