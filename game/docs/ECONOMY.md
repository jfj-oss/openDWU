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
2. The 3 extra facilities of each designation (18), the Bounty Office's hunter ships, Militia Yard ships, and the
   larger synergies.
3. The refinement chain (Option A).
4. Balancing and AI refinement (Smarter AI).

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
| Construction speed | BaconConstructionQueue.cs 45 ReviewConstructionSpeed (yard: `Value1 × wonder × resource × race`; colony: `600 × min(1, √(pop/1e10)) × …`) | constructionQueue.ts 1276 | **new** query `colonyConstructionFactor` (kind 'yard' / 'colony') |
| Mining rate | BuiltObject.2.cs ~7930 IndustrialProcessing: `Extraction × (1+bonus) × MiningRate × leader × skill × dt`, capped at MaxResourceExtractionRate | industry.ts 476 | **new** query `extractionRateFactor` (before the stock cap) |
| Population cap | BaconHabitat.cs 233: `Diameter² × 250 000 × quality²`; Habitat.cs 5172 GrowPopulation caps growth | colonyTick.ts 226 | **new** query `colonyMaxPopulation` (the cap growth runs against; the stored maximum is unchanged) |
| Pirate control | BaconHabitat.cs 1388 ReviewPirateControl: `clamp(strength/20, 0.5, 3) × 0.5 / yr` | pirateAI.ts 250 | **new** query `pirateControlGrowthFactor` |
| Raids | the raid countdown recovery (BuiltObject.1.cs 2894, Habitat.cs 1608) | pirateAI.ts 288/298 | `raidCountdownRate` (existing) |
| Repairs | BaconBuiltObject.cs 4763 DoRepairs: the interval is divided by fleet and captain bonuses | repair.ts 85 | **new** query `repairRateFactor` |
| Ship and base prices | Design.cs 1143 CalculateCurrentPurchasePrice: `Σ component prices × 5` | design.ts 284 | **new** query `designPriceFactor` |
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
  - It designates colonies of at least 150 M population (and the capital) whose best score is 35 or more, at most 3
    a review.
  - A fair-share crowding penalty spreads the designations: past a quarter of the colonies, −6 for each further
    colony of the same kind.
  - It re-designates only for a fit 1.6× better, or 2.4× better when facilities stand.
  - Smarter AI can override this later.
- **Bonuses grow with facilities:** a designation's bonus grows by 10 % for each working facility at the colony
  (new). Drawbacks do not grow. Everything scales with `econStrengthPct`.
- **Map icon:** a small badge per designation, drawn procedurally (our own art, no original image). It sits beside the
  colony at system and sector zoom, behind the "Colony Designations" overlay toggle (§6).

| Designation | Bonus | Drawback |
|---|---|---|
| Industrial | +25 % construction speed: ships at its yards, and its own facility / wonder / base queue. ×1.2 when one of the empire's Mining Hubs is within 2 sectors (supply chain). | −4 approval |
| Trade Hub | +10 % colony income (IncomeBoost) | pirate raids recover 25 % faster within 1.5 sectors (`raidCountdownRate`) |
| Resort World | +0.5 scenic factor (more tourist traffic); +3 approval at own colonies within 1.5 sectors | −10 % growth, −15 % construction speed |
| Mining Hub | +15 % mining rate at own mining stations within 1.5 sectors | −3 approval, −10 % tax revenue |
| Core World | +15 % growth, +10 % population cap | −10 % income while below 80 % of its population cap |
| Frontier / Garrison | +20 % recruited troop strength; pirate control grows 40 % slower | −10 % income |

All of these are new rules on the real channels of §1.

Phase 2, still to do:
- Trade Hubs as freighter destinations (to verify: the freight path picks the nearest port);
- Trade Hub smuggling (to verify: Empire.2.cs 1380 smuggling missions).

---

## 3. Private facilities

**Rules.** All of these are new.
- **Who builds:** the private sector, from its *surplus*. The surplus is private money above:
  - a reserve of `econReserveK` (30 k);
  - one year of its own ship and base upkeep (real: Empire.cs 2116 AnnualPrivateMaintenance);
  - one year of its facilities' upkeep.

  A facility starts only while the private cashflow covers its upkeep (real: Empire.6.cs 556
  GetPrivateAnnualCashflow, the gate the stock DirectPrivateConstruction uses). Each 30-day review starts at most one
  facility per empire and spends at most `econSpendSharePct` (60 %) of the surplus.
- **Cost, build time and upkeep:** the price (30–60 k) is paid at the start. The build takes 240–420 days. Upkeep of
  4–8 % of the price a year is paid monthly from private money.
- **Unpaid upkeep:** when the private money goes below 0, the facilities stop working. A facility unpaid for a year
  closes.
- **Slots by colony size (population):**
  - small = 1 slot below 1.5 bn;
  - medium = 2 slots below 5 bn;
  - large = 3 slots from 5 bn.

  The thresholds come from the real maximum population, `Diameter² × 250 000 × quality²`: a D200/q0.4 world holds
  1.6 bn, D250/q0.6 holds 5.6 bn, D320/q0.9 holds 21 bn, and capitals reach 10–25 bn. A colony that shrinks keeps
  what stands, but builds nothing new.
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

**The 42 facilities.** Phase 1 builds the first 4 of each designation (★). Numbers are at 100 % strength.

| Designation | Facility | Effect (channel) | Skill |
|---|---|---|---|
| Industrial | ★ Private Shipyard | +20 % ship construction speed at this colony's yards | CivilianShipConstructionSpeed |
| | ★ Heavy Foundry | +30 % facility / wonder / base construction here; −3 approval | FacilityConstructionSpeed |
| | ★ Component Works | ships and bases cost 2 % less empire-wide per works, at most 8 % (`designPriceFactor`) | MilitaryShipConstructionSpeed |
| | ★ Orbital Drydock | own ships self-repair 50 % faster in this system | RepairBonus |
| | Robotic Plant (phase 2) | cheaper robotic troops (troops.ts maintenance 0.25) | |
| | Fleet Depot (phase 2) | resupply and fuel in range, cheaper maintenance | |
| | Salvage Yard (phase 2) | resources from wrecks (Wreckage add-on) | |
| Trade Hub | ★ Trade Exchange | +8 % colony income; ×1.25 with an Industrial colony within 3 sectors | TradeIncome |
| | ★ Investment Bank | bond interest −1.5 points per bank (at most −4); +3 % colony income | ColonyIncome |
| | ★ Free Port | +12 % colony income; raids recover 30 % faster nearby | TradeIncome |
| | ★ Customs Bureau | +10 % tax revenue here; −3 % colony income | ColonyCorruption |
| | Commodities Market (phase 2) | price stability, fewer shortage spikes (market.ts) | |
| | Merchant Guild Hall (phase 2) | more private freighters (ProjectPrivateForceStructure targets) | |
| | Black Market (phase 2) | smuggling income, more pirates; XOR Customs | |
| Resort World | ★ Resort Complex | +1.0 scenic factor (more tourist traffic); ×1.25 with a Trade Hub within 3 sectors | TourismIncome |
| | ★ Media Network | +2 approval at own colonies within 2 sectors, +4 here | ColonyHappiness |
| | ★ Pleasure Gardens | +8 approval and +10 % growth here | ColonyHappiness |
| | ★ Diplomatic Retreat | each met, non-hostile empire's attitude to the owner +1 a year, at most +10 per empire (bias term) | Diplomacy |
| | Spaceport Casino (phase 2) | income, more corruption; XOR Preserve | |
| | Nature Preserve (phase 2) | keeps quality and scenic factor | |
| | Pilgrimage Shrine (phase 2) | approval among a chosen race | |
| Mining Hub | ★ Mining Consortium HQ | +15 % mining rate at own stations within 2 sectors | MiningRate |
| | ★ Orbital Warehouse | +3 development; own colonies in the system lose 30 % less approval to resource shortages (the stock −15 × (1 − supply) term, Habitat.cs 534) | |
| | ★ Deep Survey Office | every 2 years the richest deposit in the system below 1000 abundance gains +60 | MiningRate |
| | ★ Ore Refinery | +5 % colony income, +5 % mining in the system; its refined output comes in phase 3 | MiningRate |
| | Gas Refinery (phase 2) | gas yield, fuel | |
| | Automated Extractors (phase 2) | fewer freighters, lower upkeep at nearby stations | |
| | Strip-Mine Charter (phase 2) | fast mining, lowers quality; XOR Survey | |
| Core World | ★ Medical Complex | +15 % growth, +1 approval (fewer plagues: phase 2, to verify against Habitat.cs 1838 InfectWithPlague) | PopulationGrowth |
| | ★ University | +3 % research in each field (empire-wide sum, real cap 100 %) (better characters: phase 2) | ResearchHighTech |
| | ★ Arcology | +15 % population cap here; 8 % upkeep | PopulationGrowth |
| | ★ Cultural Center | +1 approval at every own colony per center, at most +3 | ColonyHappiness |
| | Administrative Center (phase 2) | less corruption in range; longer governor tenure (Characters & Victory) | |
| | Genetics Institute (phase 2) | growth, habitability for new colonies | |
| | Senate Hall (phase 2) | Diet vote weight; upkeep | |
| Frontier / Garrison | ★ Private Security Firm | +25 % recruited troop strength; pirate control grows 40 % slower here | TroopRecruitment |
| | ★ Militia Yard | +40 % construction speed here (defensive bases, facilities); raids recover 30 % slower nearby. Militia ships: phase 2 | MilitaryShipConstructionSpeed |
| | ★ Survey Outpost | every ship and base within 1 sector of the colony is visible to its owner (`objectVisibleToAll`) | |
| | ★ Colonist Office | new own colonies within 2 sectors grow 40 % faster for their first 5 years | ColonyShipConstructionSpeed |
| | Fortress Bunker (phase 2) | big ground defence (DefensiveFortressBonus, Habitat.cs 7216) | |
| | Bounty Office (phase 2) | see below | BountyHunter trait |
| | Frontier Charter (phase 2) | less breakaway pressure (Frontier Autonomy), costs taxes | |

**Synergies.** Phase 1 has these, all new:
- supply chain: Industrial + a Mining Hub within 2 sectors, Industrial construction bonus ×1.2;
- market: a Trade Exchange + an Industrial colony within 3 sectors, ×1.25;
- tourist trade: a Resort Complex + a Trade Hub within 3 sectors, ×1.25;
- a designation's bonus grows 10 % per working facility.

Phase 2: Media Network × Cultural Center, Fleet Depot × Orbital Drydock, and Free Port × Merchant Guild Hall.

**Bounty Office** (phase 2, the user's approved design). The private sector keeps its own small armed bounty-hunter
ships:
- built from the current escort / frigate designs, through the privateers' build path, privateers.ts
  generatePrivateerDesign;
- 3 to 6 of them, capped by private wealth;
- they patrol a few sectors against pirates.

With the Privateers add-on on, it also boosts privateers: more of them based there, a faster rebuild and a bounty
bonus. The BountyHunter character trait boosts it. Militia Yard ships use the same path.

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

## 5. Refinement chain (Option A, phase 3)

The user chose Option A over B. Not built in phase 1.

**Refineries:** raw resources are refined at colony facilities into new intermediate goods:
- the Smelter: Steel, Iridium, Lead, Carbon Fibre… → **Alloys** (armour, hulls, engines);
- the Electronics Fab: Silicon, Chromium, Aculon… → **Electronics** (sensors, computers, shields, weapons);
- the Chemical Plant: gases and organics → **Polymers** (habitation, cargo, life support);
- the Fuel Refinery: Caslon, Hydrogen → **Reactor Fuel Cells** (reactors, hyperdrives);
- the Exotic Materials Lab: rare and luxury resources → **Exotics** (top-tier weapons, shields, super-weapons).

The Ore Refinery (phase 1) is the chain's first step. In phase 1 it gives only its value effect.

**Moving the goods:** freighters haul the new goods like resources, through the real contract and freight path
(Empire.4.cs 1135 InitiateContract), so the private sector earns from them. The goods need new resource ids, with our
own icons.

**Risks:**
- A broken chain must slow builds or lower their tier, not block them.
- The AI must run the chains (Smarter AI).
- It needs heavy balancing.

**Fallback:** Option B, "production capability", stays the lighter alternative.

---

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
- **Map:** the "Colony Designations" overlay toggle (View popup, a mod row; on by default). It draws a small badge
  for each of the viewer's colonies that has a designation, plus foreign ones the viewer can see. Our own procedural
  art: a dark disc, a coloured ring and a glyph per designation (gear, coin, star, pick, crown, shield).

---

## 7. AI

- **Designations:** §2, all AI empires.
- **Facilities:** §3. The AI's private sector picks by value. The player's private sector does too, unless switched
  off.
- **Bonds:** §4, borrowing when below 3 months of expenses. Repayment is automatic. The stock AI does not plan around
  the debt service, which is why the service cap (30 % of tax revenue) exists.
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
- **C6. Facilities are not stock PlanetaryFacilities.** They do not show in the stock Facilities tab or the Galactopedia,
  and stock "facility" counts (achievements, AI facility reviews) ignore them. Recommendation: keep them separate.
  Using stock facility slots would change the faithful AI's own facility logic.

---

## 9. Measurements and tuning

The soak configs `econ-on-s1` / `econ-off-s1` (seed 1, 1000 stars, 10 empires) and `colony-economy` run with the
scratch hook (`~/data/agent-tmp/economy-p1/econhook.mjs`). Results are filled in below.

(See the "Measurements" section appended after the soaks.)
