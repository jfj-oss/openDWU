# 19a — The rim trader (isolationist mega-exporter on the galaxy edge)

Status: spec, agent-ready. Builds on the mod layer (`tasks/MODLAYER-DESIGN.md`, code in `src/sim/scenario/`) — read it
first and re-read it before you start (its API is the contract: `scenarioFlag`, `scenarioParam`, `scenarioState`,
`registerScenarioYearly`, `createEmpireMidGame`, `scenarioFindHomeHabitat`, `scenarioResourceAllowed`, `radiusFraction`,
`scenarioMessage`/`scenarioNews`/`scenarioText`, `test/helpers/scenarioGame.ts`). Also read `CLAUDE.md`,
`tasks/M4-agent-brief.md` (porting + determinism rules, seed pins), `tasks/UI-agent-brief.md` (for §8),
`tasks/19-mod-layer-scenarios.md` (user idea) and `tasks/19e9-freight-overlay.md` §4.1–4.2 (the shared contract hook
this package listens to — add it exactly as written there if it is not in the tree yet).

`$C=/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded`

## 1. Goal and player experience

A Ming-China-like power sits on the rim: it barely expands, never attacks anyone, is rich (high tax, high research),
and alone holds three extremely valuable luxuries. It sells them **only to empires that bring it goods found in the
outer reaches**, so the player (and the AI) must push colonies and mining stations out to the edge to have something
to offer. What the player sees:

- Galaxy start: a large, old empire (the **Oranthi Concord**) near the edge; its home system holds Oranthi Porcelain,
  Moonsilk and Starleaf Tea, which exist nowhere else. Three "rim goods" — Voidstone (asteroids), Rimfrost Lichen (ice
  worlds), Umbral Gas (gas giants) — only occur in the outer ring of the galaxy.
- On first contact a message explains the terms: "The Concord trades its treasures only with those who bring
  Voidstone, Rimfrost Lichen or Umbral Gas."
- The Concord's freighters buy rim goods from anyone's rim mining stations / ports. Each sale earns the seller
  "standing". Enough standing → the Concord allows restricted-resource trading with that empire (the stock DW:U
  mechanic behind super-luxury trade), and that empire's colonies start ordering the rare goods (big development
  bonus). Standing is spent by those purchases and decays yearly; when it runs out, the Concord closes the door again.
- It only sells through one port (its capital space port) — a natural chokepoint to escort freighters to.
- It never declares war, refuses alliances/protectorates, accepts free-trade agreements, and stops colonizing at a
  small cap.

## 2. Data overlay: `game/scenarios/rimTrade/`

This scenario folder is shared with 19c (chartered companies add flags to the same manifest; one scenario per game).
Text only, patches only (MODLAYER-DESIGN §1: never copy stock files).

### 2.1 `scenario.json`
```json
{ "id": "rimTrade", "name": "The Rim Trade",
  "description": "An isolationist rim empire holds the galaxy's rarest luxuries and trades them only for goods from the outer reaches.",
  "flags": [
    { "name": "rimTrader", "label": "Rim trader behaviour", "description": "The Oranthi Concord trades its rare goods only for rim goods, never declares war and barely expands.", "default": true },
    { "name": "rimTraderSinglePort", "label": "Single trading port", "description": "Foreign freighters may buy from the Concord only at its capital port.", "default": true }
  ],
  "params": [
    { "name": "rimTraderMaxColonies",   "label": "Concord colony cap",            "default": 4,    "min": 1,    "max": 12 },
    { "name": "rimTraderExchangeRate",  "label": "Rare goods per rim good (value)", "default": 1.0, "min": 0.25, "max": 4 },
    { "name": "rimTraderGrantThreshold","label": "Standing needed to open trade",  "default": 5000, "min": 0,    "max": 100000 },
    { "name": "rimTraderImportQuota",   "label": "Import quota per rim good (units)", "default": 400, "min": 50, "max": 5000 },
    { "name": "rimTraderConsumption",   "label": "Yearly consumption per rim good (units)", "default": 200, "min": 0, "max": 5000 },
    { "name": "rimTraderLedgerDecay",   "label": "Yearly standing decay factor",   "default": 0.5,  "min": 0,    "max": 1 },
    { "name": "rimTraderStartStock",    "label": "Starting rare-goods stock (units)", "default": 300, "min": 0,  "max": 5000 }
  ],
  "homePlacement": [ { "race": "Oranthi", "minRadius": 0.8, "maxRadius": 1.0 } ],
  "resourcePlacement": [
    { "resource": "Voidstone",       "minRadius": 0.72, "maxRadius": 1.5 },
    { "resource": "Rimfrost Lichen", "minRadius": 0.72, "maxRadius": 1.5 },
    { "resource": "Umbral Gas",      "minRadius": 0.72, "maxRadius": 1.5 }
  ] }
```
(`maxRadius` 1.5 because corner systems of non-circular shapes exceed 1.0 with `radiusFraction`'s sizeX/2 scale.)

### 2.2 `resources.txt` (appended records; stock `$DWU/resources.txt` column order: ID, Name, PictureRef, BasePrice,
Type 0/1/2, SuperLuxuryBonusAmount, IsFuel, IsImportantPreWarpResource, ColonyGrowthResourceLevel,
ColonyManufacturingLevel, then 5-value distributions Type, SubType, Prevalence, AbundanceMin, AbundanceMax)
```
'Scenario rimTrade: rim goods (placed only in the outer ring by scenario.json resourcePlacement) and the Concord's rare goods.
41, Voidstone, 15, 30.0, 0, 0, N, N, 0, 0,			1, 6, 0.30, 0.3, 0.9,	1, 9, 0.35, 0.3, 0.9,
42, Rimfrost Lichen, 31, 40.0, 2, 0, N, N, 0, 0,		0, 4, 0.45, 0.3, 0.9,
43, Umbral Gas, 6, 30.0, 1, 0, N, N, 0, 0,			0, 7, 0.20, 0.3, 0.9,	0, 8, 0.40, 0.3, 0.9,
'Rare goods: super luxuries (SuperLuxuryBonusAmount > 0 = restricted) with NO distributions, so Galaxy.4.cs:3074
'SetRestrictedResources places none; the scenario seeds them on the Concord home system (sim step 4).
44, Oranthi Porcelain, 36, 250.0, 2, 30, N, N, 0, 0,
45, Moonsilk, 29, 250.0, 2, 30, N, N, 0, 0,
46, Starleaf Tea, 21, 250.0, 2, 30, N, N, 0, 0,
```
PictureRefs reuse stock icons (Iridium 15, Terallion Down 31, Krypton 6, Ilosian Jade 36, Bifurian Silk 29, Falajian
Spice 21). Verify ids 41–46 are free (stock ends at 40; max 79) and that `data/resources.ts parseResources` accepts a
record with zero distributions (it does: `parts.length >= 10`). The rare goods must be of Type 2 (luxury) so colonies'
luxury logic (`logistics/colonySupply.ts showAvailableRestrictedResourcesForEmpire`) orders them.

### 2.3 `races/oranthi.txt` (a new race: complete file, same key names as a stock race file; keys not listed take the
parser defaults of `data/races.ts parseRace`)
```
Name		;Oranthi
PictureIndex		;7
RaceFamily		;0
ReproductionRate		;0.95
Intelligence		;125
Aggression		;35
Caution		;150
Friendliness		;95
Loyalty		;160
DesignsPictureFamilyIndex		;7
DesignNamesIndex		;3
ResearchBonus		;15
TradeBonus		;40
SatisfactionModifier		;10
OverallShipDesignFocus		;3
TechFocus1		;11
TechFocus2		;10
NativePlanetType		;0
SpecialComponent		;-1
SpecialGovernment		;-1
PreferredStartingGovernment		;2
CanChangeGovernment		;N
Expanding		;Y
CanBePirate		;N
CanBeNormalEmpire		;Y
Playable		;Y
ShipSizeFactorCivilian		;1.3
ShipSizeFactorMilitary		;0.9
ConstructionSpeedFactor		;1.0
HomeSystemName		;Oranth
TroopStrength		;80
TroopName		;Oranthi Jade Guard
TroopNameArmored		;Oranthi Lantern Armor
TroopNamePlanetaryDefense		;Oranthi Wall Guard
TroopNameSpecialForces		;Oranthi Silent Hand
Resource1Type		;44
Resource1Effect		;1
Resource1Amount		;10
Resource1AppliesOnlyToSource		;N
FreeTradeIncomeFactor		;1.5
TourismIncomeFactor		;1.3
DefaultPrimaryColor		;4
DefaultSecondaryColor		;11
DefaultFlagDesign		;17
```
`Expanding` must stay **Y**: `empire.ts:760` makes a non-expanding race's empire `reclusive`, and
`ReviewRestrictedResourceTrading` (Empire.4.cs:4311) returns early for reclusive empires — the whole trade mechanic
would switch off. The colony cap is a scenario rule instead (R2). Government 2 = Monarchy (governments.txt).
Choose PictureIndex / DesignsPictureFamilyIndex values not used by another stock race if possible (check
`$DWU/races/*.txt`); art is the stock art.

### 2.4 `Policy/Oranthi.txt` (new policy = key lines over `defaultEmpirePolicy()`; parser clamps priorities to 0.5–4)
```
TradeWithOtherEmpires		;Y
TradePriority		;4
ControlRestrictedResourcesPriority		;4
ResearchPriority		;2
WarWillingness		;0.5
BreakTreatyWillingness		;0.5
SubjugationPriority		;0.5
AlliancePriority		;0.5
ExplorationPriority		;0.5
ColonizeContinentalPriority		;0.5
ColonizeMarshySwampPriority		;0.5
ColonizeOceanPriority		;0.5
ColonizeDesertPriority		;0.5
ColonizeIcePriority		;0.5
ColonizeVolcanicPriority		;0.5
ColonizeRuinsPriority		;0.5
HomeworldDefensePriority		;4
ColonyTaxRateLargeColony		;4
ColonyTaxRateMediumColony		;3
ColonyTaxRateSmallColony		;1
DiplomacySendGiftsUpToAmount		;0
WarAttacksHarassEnemies		;N
EngageInTourism		;Y
IntelligenceAllowMissionInciteRevolution		;N
IntelligenceAllowMissionSabotageColony		;N
IntelligenceAllowMissionDestroyBase		;N
IntelligenceAllowMissionAssassinateCharacter		;N
BuildPlanetDestroyers		;N
```
Check each key against `data/policies.ts` (unknown keys are ignored silently — add a test that the parsed policy has
the values above).

### 2.5 `raceBiases.txt` — one row for the new race (23 values: 22 stock races + Oranthi, own column 10):
```
22, Oranthi,	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10
```
(the merge pads every other row with 0; confirm the column order is the races list order after the overlay.)

### 2.6 `GameText.txt` additions
```
Scenario RimTrade Terms Title;The Oranthi Concord
Scenario RimTrade Terms;The {0} trade their {1} only with those who bring {2}. Sell them these goods to earn standing.
Scenario RimTrade Access Opened;The {0} have opened their port at {1} to our merchants: {2} may now be bought.
Scenario RimTrade Access Closed;Our standing with the {0} is spent. They will sell us nothing more until we bring {1}.
Scenario RimTrade No War;The {0} do not make war.
Scenario RimTrade Treaty Refused;The {0} bind themselves to no one. They will accept only free trade.
Scenario RimTrade Standing;Standing with the {0}: {1} (needed: {2})
```

## 3. Flags (manifest) and where they are read

| Flag | Read at | Effect when on |
|---|---|---|
| `rimTrader` | every rule R1–R7 below, the yearly handler, the contract listener | the Concord behaves as specified; off = the Oranthi are an ordinary AI empire (data still applies) |
| `rimTraderSinglePort` | R6 (`addForeignTradingPosts` branch) | foreign buyers see only the Concord port |

Params via `scenarioParam(galaxy, name, fallback)` with the manifest defaults as fallbacks.

## 4. Sim changes (numbered; files under `game/src/sim/`)

Package module: **`scenario/rimTrade/rimTrader.ts`** (+ `scenario/rimTrade/common.ts` for the shared lookups 19c
reuses). Import it from `scenario/packages.ts` (keep the list sorted). Every scenario branch in base files is a single
`if (scenarioFlag(galaxy, 'rimTrader') && …)` line calling into the package, with a comment
`// Mod layer 19a: <rule> (tasks/19a-rim-trader.md R<n>)`. No base behaviour changes when the flag is off.

1. **`scenario/rimTrade/common.ts`**: `RIM_RACE = 'Oranthi'`, `RIM_GOODS = ['Voidstone','Rimfrost Lichen','Umbral Gas']`,
   `RARE_GOODS = ['Oranthi Porcelain','Moonsilk','Starleaf Tea']`; `rimGoodIds(galaxy)` / `rareGoodIds(galaxy)` (resolve
   names → ids through `galaxy.resourceSystem`, cached per galaxy in a WeakMap); `rimTraderEmpire(galaxy): Empire | null`
   (the empire id stored in state, `active` checked); `isRimTraderAI(galaxy, e)` = `e === rimTraderEmpire(galaxy) &&
   e !== galaxy.playerEmpire` (a player who picks the Oranthi plays them normally; rules R1–R7 are AI rules).
2. **Game-start hook (mod-layer addition, owned by this task if absent)**: add to `scenario/hooks.ts`
   `registerScenarioGameStart({ id, order?, flag?, scenarioId?, run(galaxy, ctx) })` and `scenarioGameStart(galaxy,
   ctx)`, same gating as `registerScenarioYearly`; call it at the end of `game.ts createGame` after the last stock
   generation step and before the first tick (`if (galaxy.scenario !== null) scenarioGameStart(galaxy, { randomPointInRing,
   inNebula })` — the same helpers `scenarioFindHomeHabitat` takes). Update MODLAYER-DESIGN.md §4 table in your
   branch and tell the orchestrator (the modlayer owner may already have added an equivalent; then use theirs).
3. **Game-start handler `rimTrade.start`** (flag `rimTrader`), draws galaxy.rnd only here:
   a. Find the Oranthi empire (`galaxy.empires`, `dominantRace.name === RIM_RACE`). If none (the wizard's random AI
      races did not pick it): `scenarioFindHomeHabitat(galaxy, race, race.nativeHabitatType, ctx, galaxy.sectorSize * 0.7)`
      then `createEmpireMidGame(galaxy, { race: RIM_RACE, home, age: galaxy.startingAge, techLevel: <the AI empires'
      tech level: galaxy.empires[1]'s research level, or 0.5>, homeSystemFavourability: 'Excellent', setup: true })`.
      If no home is found, send nothing and leave `state.empireId = -1` (scenario inert; log a warning in dev).
   b. Store `state.empireId`, `state.capitalId` (capital habitat reference is fine: graph object).
   c. **Seed the rare goods** (this must run after `Galaxy.setupHomeSystem`, which clears and re-rolls the capital's
      resources — galaxy.ts `setupHomeSystem`, the tail of Galaxy.7.cs GenerateEmpire): add each rare good to
      `capital.resources` with abundance `rnd.next(700, 1000)` (skip if already present; keep the list ≤ 5 entries by
      replacing the lowest-abundance non-critical stock resource, deterministic order). Also clear any rare good that
      somehow sits on another habitat (defensive; there should be none).
   d. Put `rimTraderStartStock` units of each rare good into the port cargo (`rimTraderPort`, step 5) as Oranthi-owned
      `Cargo` (`cargo.ts`), so trade can begin before the first production cycle.
4. **Resource placement**: nothing to write — the manifest `resourcePlacement` rules drive the mod-layer hook in
   `Galaxy.selectResources`. Verify with the test in §9 that no rim good lies inside radius 0.72.
5. **`rimTraderPort(galaxy)`**: `determineSpacePortAtHabitat(capital)` (`logistics/colonySupply.ts`, Habitat.cs port
   lookup) if it `isSpacePort`, else the capital habitat. Recomputed each call (ports get built/destroyed); cached per
   tick is not needed.
6. **Contract listener `rimTrade.ledger`** (`registerContractListener`, 19e-9 §4.1; no Rnd) — gate `scenarioFlag(galaxy,
   'rimTrader')` inside `run`:
   - `ev.buyer === R && rimGoodIds.includes(ev.resourceId) && ev.seller !== R` → `ledger[ev.seller.empireId].credit +=
     ev.value` (independents included: harmless, they have no relation to gate).
   - `ev.seller === R && rareGoodIds.includes(ev.resourceId) && ev.buyer !== R` → `ledger[ev.buyer.empireId].debit +=
     ev.value`.
   Standing `S(p) = credit(p) * rimTraderExchangeRate - debit(p)`.
7. **R3 access rule — extend `logistics/orders.ts determineWhetherTradeRestrictedResourcesWithEmpire`**
   (Empire.4.cs:4354): first line
   `if (scenarioFlag(galaxy, 'rimTrader') && isRimTraderAI(galaxy, empire)) return rimTraderAllowsRestrictedTrade(galaxy, empire, otherEmpire);`
   (the function has no `galaxy` parameter today — add it as the first parameter and update its one caller
   `reviewRestrictedResourceTrading`, Empire.4.cs:4311; no other behaviour change). `rimTraderAllowsRestrictedTrade`:
   false for null / NotMet / War / TradeSanctions relations and for pirates; otherwise if the relation currently has
   `supplyRestrictedResources` → `S(p) >= 0` (keep open until spent); else `S(p) >= rimTraderGrantThreshold`. The stock
   caller then flips `supplyRestrictedResources` and sends the stock Allowed/Blocked message; add a scenario message
   (`Scenario RimTrade Access Opened/Closed`) to the partner from the same place (package function called right after
   the flag flips — do it in the package by comparing before/after inside a wrapper, not by editing the message code).
8. **R2 colony cap — extend `tick/empireTick.ts`** at `empire.colonizationTargets = identifyColonizationTargets(galaxy,
   empire)` (Empire.1.cs long block): if `scenarioFlag(galaxy,'rimTrader') && isRimTraderAI(galaxy, empire) &&
   empire.colonies.length >= rimTraderMaxColonies` → assign `[]` instead (no colony ships get targets, the
   construction review in `construction/empireConstruction.ts` near line 1717 then builds none). The identify call is
   skipped too (it draws no Rnd — verify; if it does, call it and discard, to keep this branch draw-neutral relative
   to itself).
9. **R1 no war — extend `diplomacyTick.ts declareWar`** (Empire.7.cs:4883 DeclareWar): first line
   `if (scenarioWarBlocked(galaxy, self, target)) return;` where `scenarioWarBlocked` (in `scenario/rimTrade/common.ts`,
   19c extends it) returns true when `scenarioFlag(galaxy,'rimTrader') && isRimTraderAI(galaxy, self)`. Covers
   StartWar (Empire.8.cs:1515), ally-persuaded wars and mutual-defence honouring, which all go through DeclareWar.
   Others can still declare war on the Concord.
10. **R7 treaties**: (a) `diplomacyTick.ts offerMutualDefense` (Empire.8.cs:1824): return early when
    `isRimTraderAI(self)` under the flag. (b) `considerTreatyProposals` (Empire.3.cs:3606): when `self` is the
    Concord AI under the flag, a proposal of MutualDefensePact / Protectorate / SubjugatedDominion is refused (removed
    from the list without acceptance, same removal path as a stock refusal; send `Scenario RimTrade Treaty Refused`).
    FreeTradeAgreement and None follow the stock evaluation. (c) Player path `player/diplomacyProposals.ts
    evaluateProposal`: same refusal for those treaty types with the reply text above (`accepted: false`,
    `message` = the scenario text; no Rnd — return before any stock draw).
11. **R6 single port — extend `logistics/freight.ts addForeignTradingPosts`** (Empire.4.cs:461 GenerateValidTradingPosts,
    the foreign-port loops 540–625): when `scenarioFlag(galaxy,'rimTraderSinglePort') && scenarioFlag(galaxy,'rimTrader')
    && other === rimTraderEmpire(galaxy)`, add only `rimTraderPort(galaxy)` (if it is a BuiltObject passing the same
    explored/blockade/queue checks) and skip the Concord's other ports and mining stations. The function needs
    `galaxy` — pass it from `generateValidTradingPosts` (which already has it; both call sites are in freight.ts).
12. **Yearly handler `rimTrade.year`** (`registerScenarioYearly`, flag `rimTrader`, order 10; no Rnd):
    a. Decay: every ledger entry `credit *= decay; debit *= decay` (`rimTraderLedgerDecay`).
    b. Consumption (R5): remove `min(stock, rimTraderConsumption)` of each rim good from the port's Oranthi-owned cargo
       (`cargoGetCargo` / reduce amount / `cargoRemove` when 0; `logistics/orders.ts` helpers).
    c. Import orders (R4): for each rim good, `outstanding` = amountOutstandingToContract summed over
       `galaxy.orders.getOrdersForBuiltObject(port)` (or `getOrdersForHabitat`) for that resource; if
       `stock + outstanding < rimTraderImportQuota` → `empireCreateOrder(galaxy, R, port, resourceRef, quota - stock -
       outstanding, /*isState*/ true, OrderType.Standard)` (Galaxy.cs:1757 CreateOrder family, TS `logistics/orders.ts`).
       The Concord's own `checkMarketOrders` (Empire.4.cs:720) then contracts foreign sellers — stock path.
    d. Rare-goods stock move: if production lands in the capital colony cargo while buyers reach only the space port
       (verify where colony extraction puts cargo: colonyTick / Habitat resource extraction), move the Oranthi-owned
       rare-goods cargo from colony to port cargo each year (same owner, no money).
    e. Terms message (once per empire): for each empire whose relation with R changed from NotMet since last year,
       `scenarioMessage(galaxy, e, 'Scenario RimTrade Terms Title', scenarioText('Scenario RimTrade Terms', R.name,
       rareNames, rimNames), { subject: R.capital })`. Remember the ids in `state.informed`.
13. **Freight overlay categories** (only if 19e-9 is in the tree): `registerFlowCategory` mapping rim goods → "Rim
    goods" `#7fe0a8`, rare goods → "Oranthi rare goods" `#ffb347` when the flag is on.

C# analogues to mirror (for review; the rules are scenario rules, the calls they make are the ported ones):
Empire.4.cs:4311/4354 (restricted trade review/decision), Empire.4.cs:720/461/1135 (market orders, trading posts,
contract), Galaxy.4.cs:3074 (restricted placement), Galaxy.7.cs GenerateEmpire tail (setupHomeSystem), Empire.7.cs:4883
DeclareWar, Empire.8.cs:1515 StartWar, Empire.8.cs:1824 OfferMutualDefense, Empire.3.cs:3606 ConsiderTreatyProposals,
Empire.1.cs long block (colonization targets), Galaxy.8.cs:1348 GenerateShakturi (mid-game empire pattern used by
createEmpireMidGame).

## 5. Rnd policy

- Draws only in the game-start handler (step 3: `createEmpireMidGame` when needed, `scenarioFindHomeHabitat`, the
  abundance draws) — all inside a scenario hook.
- The contract listener, the yearly handler and rules R1–R7 draw nothing. R2 and R10 return before stock code that
  might draw; with the flag off they are single false checks.
- No scenario ⇒ nothing registered runs; `npm run repin -- --check` must be clean (0 moved pins).

## 6. Save state

`scenarioState(galaxy, 'rimTrade', init)` → plain object:
`{ empireId: number, capital: Habitat | null, ledger: Record<number, { credit: number; debit: number }>, informed:
number[], metIds: number[] }`. Plain data and graph references only → nothing to add to `save/galaxySave.ts CLASSES`
(if you introduce a class, register it there). Test the round trip (§9.8).

## 7. AI behaviour rules (testable)

For the Oranthi empire R when `rimTrader` is on and R is not the player:
- **R1** R never enters war on its own: `declareWar(galaxy, R, X)` leaves the relation unchanged. Wars declared on R
  proceed normally (R defends; peace requests are stock).
- **R2** When `R.colonies.length >= rimTraderMaxColonies`, R's colonization targets are empty (no new colony ships
  assigned, none queued for colonization).
- **R3** R allows restricted-resource trading with p iff relation ∉ {NotMet, War, TradeSanctions}, p is not a
  pirate, and S(p) ≥ threshold (opening) / S(p) ≥ 0 (staying open). Evaluated at the stock cadence
  (ReviewRestrictedResourceTrading in the empire long block).
- **R4** Each year, for every rim good, R has state orders outstanding at its port for `quota − stock` units.
- **R5** Each year R consumes `min(stock, consumption)` units of every rim good at its port.
- **R6** Foreign empires' trading-post lists contain at most one R object: its port.
- **R7** R refuses MDP / Protectorate / Subjugation (AI and player proposals), never offers MDP, accepts free trade by
  the stock rules.

## 8. UI changes (follow `tasks/UI-agent-brief.md`; hook markers `// [rimTrader] begin/end`)

1. `src/ui/screens/diplomacyScreen.ts`: when the selected empire is the Concord and the flag is on, a "Trade terms"
   block: wanted goods (rim goods with icons), offered goods (rare goods), the player's standing (credit×rate − debit),
   threshold, access state (open/closed), and "Where to find rim goods: outer ring beyond 72 % radius". Pure
   `rimTraderTermsRows(galaxy, player)` in the package or a `ui/scenario/rimTraderRows.ts`, unit-tested.
2. Messages: the scenario messages use the existing message path (ticker, message history, popups) — no new popup
   type. Access-opened uses `EmpireMessageType.GeneralGoodEvent`, closed `GeneralBadEvent`.
3. Empires list (`empiresList.ts`): a small "Rim trader" tag on the Concord row (flag on).
4. Selection details for a habitat: resources rows already list resources; mark rim goods with "(rim good)".
5. Freight overlay: categories from step 13 appear in its legend automatically.
Keep all texts from GameText via `scenarioText`.

## 9. Tests — `test/rimTrader.test.ts` (+ `@slow` soak `test/rimTraderSoak.test.ts`)

Harness: `createScenarioGame(base, { scenario: 'rimTrade', flags: {...}, options: (o) => ({ ...o, aiEmpires: [{ ...o.aiEmpires[0], race: 'Oranthi' }, ...o.aiEmpires.slice(1)] }) })`
from `test/helpers/scenarioGame.ts`; `runGameSeconds` from `tick/harness.ts`; base data from `loadGameDataFs`.
1. Overlay data: race Oranthi present; policy values of §2.4; resources 41–46 present, 44–46 in
   `resourceSystem.superLuxuryResources`; `overlay.warnings` empty (incl. raceBiases row count).
2. Placement: Oranthi capital `radiusFraction ≥ 0.8`; every habitat holding a rim good has `radiusFraction ≥ 0.72`;
   the rare goods occur only on the Oranthi capital; port holds the start stock.
3. Game-start fallback: with the default random AI races (no forced Oranthi), the start handler creates the Concord
   (an empire with race Oranthi exists) — or leaves the scenario inert when no ring home exists (use a tiny galaxy).
4. R3 ledger/access: feed synthetic `ContractEvent`s through the listener → standing math; call
   `reviewRestrictedResourceTrading(galaxy, R)` and assert `supplyRestrictedResources` flips at the threshold and back
   at < 0, with the scenario message sent once per flip.
5. R1/R7: `declareWar(galaxy, R, human)` no-op; `declareWar(galaxy, human, R)` works; MDP proposal to R refused by
   `considerTreatyProposals` and by `submitProposal` (player path).
6. R2: set R's colonies over the cap (or cap param 1) → after one long block its `colonizationTargets` is `[]`.
7. R4/R5/R6: one game year → state orders exist at the port for each rim good; consumption removed stock; a foreign
   empire's `generateValidTradingPosts` result contains exactly one R object (export a test hook or test via
   `checkMarketOrders` outcome).
8. Determinism + save: two fresh scenario games run 1 year → equal `stateDigest`; serialize at 6 months, deserialize
   (with the scenario data), run 6 more → digest equals the uninterrupted run; `scenarioState` survives.
9. Faithful path: stock `cachedTickGame` digest unchanged (the existing pins); a `rimTrade` game with `rimTrader:false`
   runs 1 year without calling any package function that mutates (spy on the listener / handler bodies).
10. Soak (`// @slow`, 10 game years): R never at war by its own declaration; R.colonies ≤ cap (+ colonies it held at
    start); ≥ 1 empire earned access at some point; rim goods were bought by R (ledger credit > 0).

## 10. Acceptance criteria

- `npm run typecheck` 0 errors; full suite green; `npm run repin -- --check` clean (no pin moved by this task).
- A new game with the scenario shows the Concord on the rim, rim goods only in the outer ring, rare goods only at
  Oranth; within ~10 years at least one AI empire trades for them in the soak.
- With the scenario but `rimTrader` off, the Oranthi play as a normal AI (data only).
- Screenshots (per UI brief) of the diplomacy terms block and the ticker message.

## 11. Risks

- **Demand side is stock behaviour**: other empires only order a restricted resource if it is "available"
  (`showAvailableRestrictedResourcesForEmpire` stops at 3 resources) — with Loros Fruit / Korabbian Spice /
  Zentabia Fluid also available, the Concord's goods may be crowded out. Watch in the soak; if needed, the rare goods'
  BasePrice / bonus is the data knob, not code.
- Rim goods may be too scarce/abundant in small galaxies: prevalence is data; the test prints counts.
- Range: rim goods are not restricted, so the Concord buys only within its freighters' range
  (`FindFreighterForContract` allowable range) — intended (it buys from its rim neighbourhood).
- Cargo location (colony vs space port) — step 12d; verify before relying on it.
- The game-start hook is a mod-layer addition; coordinate with the modlayer owner so there is one hook, not two.
- AI player-proposal refusal must not skip a stock Rnd draw on paths that do not concern the Concord.

## 12. Size

~2.5–3 days: data + manifest 0.5 d; hooks/rules/listener/yearly 1–1.25 d; UI 0.5 d; tests + soak tuning 0.5–0.75 d.
