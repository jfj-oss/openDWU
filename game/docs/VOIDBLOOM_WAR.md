# The Voidbloom War — design and mechanics audit

Status: built 2026-10-12 (see **As built** at the end; the design below is kept as written). Add-on id `voidbloom`, group **Rim**, member of The Rim
expansion (`EXPANSIONS` in `src/sim/scenario/addons.ts`), requires `rimTrade`. Optional partners: `characters-victory`
(Interstellar Diet, VIP shuttles), `lively-galaxy` (War Goals and Terms), `internal-security`, `emergent`,
`frontier-autonomy`, `colony-economy`.

Labels used below: **[C#]** ported stock code; **[add-on]** existing openDWU add-on code; **[new]** to be written.
Verdicts: **works** (usable as is), **hook** (exists, needs a small extension point), **missing** (new system).


## User decisions (2026-10-12) — these override the proposals below where they differ

1. **Supply: a colony good on deadly rim worlds.** Voidbloom spawns only on special rim planets and can only be
   extracted by a colony there (no mining station). The planet is deadly: its population declines constantly, so it
   needs a steady **forced-labour** inflow and a strong **garrison** against revolts. New system: a direct way to ship
   labour to the planet (labour convoys built on the Refugees add-on's population convoys; workers from conquered or
   captured populations; player orders, AI automatic). Convoys and garrisons are raid and rebellion targets.
2. **"Late only" comes from the crackdown timing.** The Concord cracks down *before* it is weakened (pre-emptively,
   while still strong), which triggers a **crisis and a choice** (back down / pay / hand over smugglers, or war). Fighting
   it then is very hard, so success comes naturally late as Voidbloom keeps draining it. No hard year or tech floor.
3. **The Concord and its commissioner are AI-only.**
4. **A harsher treaty shifts the aftermath odds** (e.g. more likely revenge).
5. **Diet votes by self-interest:** members hurt by Voidbloom vote for the ban, members profiting from smuggling or
   wanting open Concord ports vote for free trade; with no strong interest, a slight lean to the ban.
6. **Voidbloom may spread into non-Concord colonies** through normal trade (short approval boost, then addiction:
   approval, output, corruption). Counters: an empire policy "Ban Voidbloom" (freighters don't buy it, colonies seize
   it), the Colony Economy Customs Bureau, Internal Security policing, a Diet ban, and later patrols.
7. **Crackdown on Voidbloom colonies, pirate-style:** the Concord **blockades** every known Voidbloom colony (stock
   Blockade mission) and **raids** it to seize any Voidbloom stockpiled on the planet (reuse the pirate raid path that
   takes resources and money from a colony). Further crackdown tools (proposed, user to confirm): burn the fields
   (bombardment that cuts the colony's yield for a while), intercept labour convoys and free the workers (who rebel or
   join the Concord), hunt freighters carrying Voidbloom, a bounty on smuggler ships, send agents against the colony's
   governor, and declare a Voidbloom world "outlaw" so pirates are welcome to raid it.
   **Confirmed by the user:** burn the fields; free the workers from intercepted labour convoys; hunt freighters
   carrying Voidbloom; send agents after the colony's governor (only when Characters & Victory is on, since governors
   come from it). **Plus occupation:** the Concord may invade and occupy a Voidbloom world (stock invasion) to shut it
   down or hold it. Not chosen (dropped for now): smuggler bounties, "outlaw" status, bribing the garrison.
9. **Crackdown status:** the target empire either **tolerates** the crackdown (blockades, raids and occupation run as
   a "police action", no war) or **declares war**. AI decides by strength, the profit at stake and personality.
10. **Tone: dark.** No toggle or softening; forced labour and addiction stay as designed.
11. **All gaps fixed:** a fallback starter (pirates or a rim faction smuggle if no empire does); neutral ships hit by
    the crackdown cost the Concord standing with their owners (feeds the Diet); per-colony addiction and Voidbloom
    levels on the colony screen plus a map overlay and spread warnings; profit tuned so labour, garrisons and risk are
    clearly worth it (soak-measured); Galactopedia articles, Rim expansion meter update, multiplayer determinism; not
    addable to saves.
12. **All history events in:** the commissioner's open letter; the public burning (galaxy news); the "merchants'
    detention" becomes a **raid of the Voidbloom colony that destroys its Voidbloom stock**; the gunboat moment (the
    Concord's frozen research); a small "barren rock" world ceded that grows into a trade hub; "me too" treaties
    (most-favoured nation); indemnity paid in instalments; the winner takes a cut of Concord tolls (foreign-run
    customs); a second war years later from a pretext incident, in which the Concord capital's wonder can be looted and
    burned; the civil-war branch led by a zealot character; the reform branch as "Self-Strengthening"; corrupt Concord
    officials who can be bribed to look away; spore dens in addicted Concord colonies; the "silver drain" statistic.
13. **The Concord in the Diet (user OK):** a full member that votes, lobbies and
    bribes delegates, but cannot host or hold the Regency; motions against it are real votes it fights.
14. **Trade model (user OK):** Voidbloom is its own **contraband** category, not a stock luxury or
    super-luxury slot. Every colony that tastes it gains a strong short boost (approval and development, like a super
    luxury) and an addiction level; demand and price rise with addiction; where it's banned, demand is met by the black
    market (smugglers ignore the ban); withdrawal hurts approval and output when supply stops. Concord colonies have the
    highest base demand (the "Canton market").
    **Flow:** the producer colony extracts it into colony stock; buyer colonies place buy orders at their port (the
    stock order path); legal where allowed (normal private freighters), black market where banned (only smugglers:
    pirate smugglers, independents, smuggler-flagged private freighters); on delivery the buyer pays the seller.
    **The drain (user OK):** the buyer's private sector pays most of it, plus a **small share from the buyer's state
    treasury** (the "silver drain"), so the Concord weakens visibly; the seller's private sector earns, smugglers take a
    cut.
    **Demand spreads like an epidemic, not everywhere at once:** a colony only starts wanting Voidbloom after
    *exposure* (smugglers sold there, or nearby colonies are addicted, along trade routes). Exposure and addiction are
    damped by: an empire ban plus a Customs Bureau, price and scarcity (deadly, labour-hungry producers limit supply),
    smuggler reach (distance from producers and smuggler bases), race susceptibility (some races resistant, a few
    immune), government type, and colony approval (unhappy colonies fall faster). So it creeps out from the rim, hits
    the Concord's "Canton market" hardest, and can be contained.
15. **After legalisation (ideas, pending):** a galaxy-wide dependency (empires reliant on rim producers, giving them
    leverage); withdrawal crises when supply is cut; temperance movements in colonies demanding bans; a research cure
    ("neural detox") that lowers addiction; a later Diet "Galactic Prohibition" motion; pirate syndicates growing rich on
    the trade; leaders who pick up an addiction trait.
8. **AI empires want Voidbloom worlds badly:** a very high colonisation and conquest value for Voidbloom planets in
   the AI's target scoring (via a scenario hook on colonisation and invasion targets), so AI empires race for them,
   defend them and fight over them. This also guarantees the AI takes part in the arc.

## 1. Summary

The Oranthi Concord already runs a closed, Canton-style trade. Rare goods are sold only through its own port and the
treasure fleet, at its own prices, against a standing ledger fed by rim goods. The Voidbloom War adds a fictional
contraband spore, **Voidbloom**, which outsiders smuggle into Concord space. That reverses the money flow and damages
Concord colonies. In response a Concord **commissioner** (a real character) cracks down: seizures, a ban and a closed
port. The crackdown is the incident that gives the smuggler a war reason. A forced-open war can only be won once the
Concord has fallen behind: its research is frozen and the drain has starved its navy. The war ends in an **unequal
treaty**: treaty ports, toll and inspection exemption, an indemnity, a ceded colony and legal Voidbloom. A random
**aftermath** follows, and the Interstellar Diet can intervene on either side. About 60% of what this needs exists
already. The rest is three missing systems: black-market demand, customs inspections, and custom treaty terms. There is
one serious risk: the AI has to actually play the arc (§2.10).

## 2. The arc, phase by phase

### 2.1 Phase 1: the closed trade (the Canton system)

**Player sees:** the Concord sells Porcelain, Moonsilk and Starleaf Tea only at its port and at treasure-fleet stops,
and only up to the buyer's standing. It buys rim goods. Every empire runs a credit deficit toward it. A new "Concord
balance" line in the Rim Trade panel shows the yearly net flow, in credits, per empire.

| Mechanic | Source | Verdict |
|---|---|---|
| Standing ledger (credit × exchange rate − debit) | [add-on] `rimTrade/common.ts:rimTraderStanding` | works |
| Restricted trade granted by standing / treaty | [add-on] `common.ts:rimTraderAllowsRestrictedTrade` (replaces the stock strategy test) | works |
| Rare goods only from the Concord, price ×1.5, capped by standing | [add-on] `rareGoods.ts:rareContractAvailable`, `rareGoodsFirst` (`availableRestrictedResources`), `rareOrderCandidates` (`restrictedOrderCandidates`) | works |
| Single licensed port | [add-on] `common.ts:rimTraderOnlyTradingPost` (flag `rimTraderSinglePort`) | works |
| Treasure-fleet stops on request | [add-on] `treasureFleet.ts:requestTreasureStop`, `treasureTradeAt` | works |
| Concord imports only rim goods from normal empires | [add-on] `common.ts:rimTraderImportBlocked` | works |
| Money actually changes hands | [C#] `logistics/orders.ts:performPrivateTransaction` (private sector), freight via `logistics/freight.ts:checkMarketOrders` | works |
| Yearly net-flow figure ("trade deficit") | [new] a counter on `rimTradeState` filled from `rimTraderOnContract` and the treasure trades | missing (small) |

**AI:** fully stock. AI freighters already fill Concord orders. Phase 1 is the existing Rim Trade game. The add-on only
adds the balance figure, which the later phases use as the AI's reason to smuggle.

### 2.2 Phase 2: contraband

**Player sees:** Voidbloom appears in the rim. Concord colonies develop **black-market demand** for it, and the Concord
bans it. A smuggler's delivery pays far above market and is paid out of the Concord's private sector. Hit colonies show
"Voidbloom dens": lower approval, lower output and more corruption. Addiction grows with the units delivered and decays
slowly.

| Mechanic | Source | Verdict |
|---|---|---|
| A new good in the resource table | [add-on] pattern: `scenarios/rimTrade/resources.txt` overlay (ids 41–46), `scenario.json resourcePlacement`; or a runtime good as `scenarioGoods.ts:registerScenarioGoods` (Colony Economy's refined goods) | hook (id allocation across overlays, see §6) |
| Stock smuggling carriers | [C#] pirate freighters (`bo.pirateEmpireId > 0`): delivery and 25% skim in `missions/cmdDocking.ts` (≈700–737), `smugglingIncomeFactor`, skill `CharacterSkillType.SmugglingIncome` | works, but for the stock purpose only |
| Stock "smuggle" missions | [C#] `EmpireActivityType.Smuggle`, policy `offerSmugglingPirateMissions` / `acceptPirateSmugglingMissions` (`data/policy.ts`). **The colony's owner pays** (`performPrivateTransaction(soEmpire, −price)`) | mismatch: the Concord government will never *request* Voidbloom |
| Black-market demand that ignores the owner's ban | — | **missing** |
| Black-market accounting precedent | [add-on] `emergent/crisesCore.ts:recordSmuggleDelivery` ("Black market deliveries") | works (as a model) |
| Approval term | [add-on] `scenario/stability.ts:registerStabilityTerm` (as `rimTrade.porcelain`) | works |
| Output malus | [add-on] query `colonyResourceBonuses` (as `rareGoods.ts:rareGoodResourceBonuses`, negative `IncomeBoost` / `Development`) | works |
| Corruption | hook `colonyCorruptionFactor` (`hooks.ts:810`, read by `forceStructure.ts` habitat corruption before the 0.8 cap); the empire-level `forceStructure.ts:colonyCorruptionFactor` is a difficulty factor, not a hook | works (colony-level query) |
| Shown in the internal-security ledger | [add-on] `security/security.ts:colonyLedger` reads the stability terms | works |

**Design:** the add-on adds a **black-market order** to each Concord colony with addiction above zero. The order is
scenario state, not a stock `Order`, so the stock order flow never sees it. Any freighter carrying Voidbloom that docks
at that colony can fill it: a pirate smuggler, a smuggler empire's private freighter, or a herder. The hook point is the
cargo-unload path in `cmdDocking.ts`, next to the `recordSmuggleDelivery` call. Payment: the Concord's private sector
pays (`performPrivateTransaction(concord, −value)`) and the carrier's private sector receives it. The **Concord
state** also loses money through a lower tax base (the output malus). That drain is what later starves
`wealth.ts:concordNavyYear`, whose purchases stop at `rimTraderNavyReserve`. This silver drain is real coupling, not
flavour text.

**AI:** smuggling needs a new AI decision point, and it must fire (§2.10). The cheapest reliable carriers are **pirate
factions**, whose freighters are already stock smugglers, plus AI empires whose private freighters simply pick the order
up. The second group needs only a per-empire "trade Voidbloom" policy flag, so the AI does not have to plan anything.

### 2.3 Phase 3: the crackdown

**Player sees:** a commissioner is appointed to the worst-hit colony and travels there by VIP shuttle, which can be
intercepted. On arrival they start inspections. Seized cargo is burned, an event with a news line. If seizures pile up
against one empire, the Concord bans it: trade sanctions and its port closed to that empire. Burning a big stockpile of
an empire's goods is an **incident**: a reputation hit and a war reason for the victim.

| Mechanic | Source | Verdict |
|---|---|---|
| Commissioner as a real character | [add-on] `scenario/governors.ts:spawnGovernorFor` (role `CharacterRole.ColonyGovernor`); skills `ColonyCorruption`, `CounterEspionage`; the stock `SmugglingEvasion` is the smuggler's counter-skill | works (new trait name "Incorruptible" optional) |
| Travels by VIP shuttle; can be intercepted | [add-on] `charactersVictory/vip.ts:startVipTrip`, `routeDanger`, `assignEscorts` | works (needs characters-victory; otherwise appear at the colony) |
| Detection | [C#] the stock pirate-smuggler detection (`cmdDocking.ts` ≈263–290: 20% minus √evasion; exposes the owner and makes the ship flee, **no seizure**); [add-on] `security/security.ts:detectionChance(strength, concealment)` | hook (a detection formula exists; no inspection exists) |
| **Patrols and inspections** (stop, search, seize) | — | **missing** |
| A hidden smuggling ring at a colony, found by investigation | [add-on] `security/registry.ts:registerHiddenThing` (needs a new `HiddenKind` `'voidbloomRing'`), `startInvestigation`, leads | hook (add the kind) |
| Ban | [C#] `DiplomaticRelationType.TradeSanctions` (already shuts restricted trade in `rimTraderAllowsRestrictedTrade`) | works |
| Concord anger / tit-for-tat strikes | [add-on] `rimTrade/passive.ts:recordRimAggression` (new kind `'smuggling'`), `rimStrikeReview` | hook (add the kind) |
| Incident: attitude hit | [add-on] `reputation/ledger.ts:applyReputation(galaxy, victim, concord, −v, {cause:'voidbloom.seizure', decayPerYear})` | works |
| Incident: war reason | [add-on] `lively/warGoals.ts` `casusBelli` map, read by `holdsCasusBelli`, the war-goal candidates and the war-review relax. **There is no exported grant function.** The only writer is `breakDemilitarisation` | hook (export `grantCasusBelli`) |

**Inspection design [new]:** a periodic sweep, fixed order and seeded `galaxy.rnd`, over freighters docked at or
within range of a Concord colony that hosts a commissioner, and over Concord warships on defence missions in Concord
space (`passive.ts:inConcordSpace`). The chance is `detectionChance(commissioner skill + security strength, carrier
concealment + SmugglingEvasion)`. On a hit the Voidbloom cargo is removed, the carrier's empire gets the incident, and
pirate carriers are attacked (the stock Escape mission already exists). A stockpile seizure is a dramatic one-off. It
needs a target: a smuggler's Voidbloom stock inside a Concord-range base or colony, which the commissioner "burns" when
the Concord holds that system (blockade or ownership).

**AI:** the Concord is always AI (`isRimTraderAI`), so the crackdown is scripted on thresholds: appoint at addiction
X, ban at Y seizures. That makes it reliable.

### 2.4 Phase 4: the war ("late only")

**Player sees:** with a crackdown casus belli, an empire can declare war without the usual penalty. The Concord fights
defensively and never strays far from home. Its fleets hit back with strike fleets. Early in the game this is
suicidal. Late in the game, against a drained, tech-frozen Concord, it can be won.

| Mechanic | Source | Verdict |
|---|---|---|
| The Concord never declares war (unless provoked, passive posture) | [add-on] `common.ts:scenarioWarBlocked`, hooked in `diplomacyTick.ts:declareWar` | works |
| Concord warships stay home; tit-for-tat strikes | [add-on] `passive.ts:concordMissionAllowed`, `rimPassiveLeash`, `rimStrikeReview` | works |
| Navy: 40 at start, target 80, cap 2× the strongest normal empire's firepower | [add-on] `wealth.ts:concordWealthStart`, `concordNavyYear`, `concordNavyCapped` | works, **but** see the gating below |
| Tech: level 4 at creation, research frozen at level 5 per industry; huge long-range hulls | [add-on] `treasureFleet.ts:applyConcordTech`, `concordResearchFrozen` (query `researchFrozen`); `concordDesigns.ts` | works (this is the late-game weakness) |
| Treasure-fleet escorts drawn from the navy | [add-on] `treasureFleet.ts:treasureComposition` | works |
| Penalty-free declaration with a casus belli | query `declareWarPenaltyWaived` (used by the Diet, `diet.ts:1338`); Living Galaxy's `casusBelli` goal | hook |
| AI war decision | [C#] `diplomacyTick.ts` war review, with query `warReviewAttitudeRelax` (`diplomacyTick.ts:1593`, used by Rim Trade and War Goals) | works |

**Gating verdict.** As written, the navy cap is *relative*: the Concord keeps buying until it holds twice the
**strongest single** normal empire's firepower, and its money (5 M at start + 500 k a year) lasts a long time. So no
single empire ever out-fights it unless the money fails. The research freeze makes its ships obsolete late, but the
cap compares raw firepower and the Concord makes up for weaker tech with numbers. **"Late only" therefore needs an
explicit decline model [new]:**

1. Voidbloom drain lowers the Concord's state money, and the navy reserve floor stops new purchases (already coupled).
2. The add-on lowers `rimTraderNavyCapFactor` with the Concord's **addiction index**: from 2.0 down to 1.0.
3. A **hard floor**: until game year `voidbloomWarMinYear` (default 60% of the expected game length, or the smuggler
   being ≥ 2 tech levels above the cap in two industries), the Concord's `endWarAcceptance` never yields an unequal
   treaty, and its strike fleets hit at full strength.

All three are params, so the balance can be tuned in soaks.

**AI:** AI smugglers holding the casus belli go through the stock war review with an extra relax. They declare only
when `weightedMilitaryPotency` against the Concord's *home-guard* strength clears a margin, which matches the
passive-posture reality.

### 2.5 Phase 5: the unequal treaty

**Player sees:** a peace screen with new terms: **treaty port(s)**, **toll exemption**, **inspection exemption**,
**indemnity**, **ceded colony** and **legalised Voidbloom**.

| Term | Representation | Source | Verdict |
|---|---|---|---|
| Ceded colony | `CedeTerm`, applied through [C#] `giveTradeableItem(Colony)` | [add-on] `lively/peaceTerms.ts:applyTerms` | works |
| Indemnity | `ReparationTerm` (lump + per-year plan) | [add-on] `peaceTerms.ts:payReparations`, `warGoals.reparations` | works |
| Demilitarised approaches | `DemilTerm` | [add-on] `peaceTerms.ts:applyTerms` | works (bonus term) |
| Treaty port | a Concord colony where the victor trades regardless of standing, docks freely, and the treasure fleet must stop | [new] scenario term; reads into `rimTraderAllowsRestrictedTrade`, `rimTraderOnlyTradingPost`, `nextTreasureStop` | missing (small, hooks exist) |
| Toll exemption | victor skips the rare-price multiplier and the standing cap | [new] guard in `rareGoods.ts:rareContractAvailable` + price | missing (small) |
| Inspection exemption | inspection sweep skips the victor's ships | [new] in the §2.3 sweep | missing (trivial once inspections exist) |
| Legalised Voidbloom | the Concord's ban lifted for the victor: black-market orders become ordinary imports for its carriers | [new] | missing (small) |
| Peace accepted by the AI | query `endWarAcceptance` (`peaceTerms.ts:409`), `acceptsTerms` / `requiredValue` | [add-on] | hook |
| Custom terms in general | `PeaceTerms` is a closed struct `{cede, reparations, demilitarise, release}` | [add-on] `warGoals.ts:PeaceTerms` | **missing**: add `extra: ScenarioTerm[]` + a term registry (value, describe, apply, sanitise) |
| Humiliation memory | `warGoals.humiliations` + attitude drop | [add-on] `peaceTerms.ts:applyTerms`. **Still a direct `incidentEvaluation` write** (`reputation/MIGRATION.md` lists it) | hook (migrate) |

Stock `DiplomaticRelationType` has no custom-term treaty. The Diet's enforced truce (`diet.ts:applyDietMotion` case
`'truce'`, law `truce`) gives a ceasefire but no terms. War Goals and Terms is the right base. Without lively-galaxy the
add-on falls back to a minimal built-in treaty: cede + indemnity + its own terms, applied by the same functions.

**AI:** the earlier soak saw **0 peace terms in 5 years** for the AI. The AI must build these terms itself: a
`buildTerms` contribution for wars where the add-on's casus belli is the goal. The Concord's acceptance must follow the
§2.4 decline gate, not the stock `endsWar` alone.

### 2.6 Phase 6: aftermath

This is a weighted random draw (seeded `galaxy.rnd`, a single draw in a yearly handler after signing). See §4.

### 2.7 Diet involvement

This can come at any phase from 2 onward. See §5.

### 2.8 Multiplayer, determinism, save and load

- **Player actions** have to be new ops in `player/playerOps.ts`, with matching `simworker/commandFailure.ts` entries
  (the pattern of `dietPropose`). The new ops are: set the Voidbloom policy (trade / don't trade / ban at home), hire
  smugglers, propose or accept treaty terms, call a Diet motion, and (for the Concord's rivals) bribe the commissioner.
  UI-only reads stay out of the journal.
- **Randomness:** draws only in scenario handlers (yearly, periodic, docking), in fixed iteration orders (by empireId,
  then colony order), on `galaxy.rnd`. That is the rule already stated in `empireMidGame.ts` and `darkFarms.ts` §6. No
  `Math.random`.
- **State:** plain data under `scenarioState(galaxy, 'voidbloom')`. Empire, colony and character refs serialise as War
  Goals' do.
- **Add to a save:** **no.** A new resource changes galaxy generation (placement) and resource ids, so the add-on is
  `addableToSave: false`. The Colony Economy runtime-good path could allow it, but its goods also "exist only in a game
  started with the flag on".

### 2.9 Who can be the Concord

Only the AI. `isRimTraderAI` gates every Concord rule. A human cannot play the commissioner's side in v1 (§8 Q3).

### 2.10 AI participation: the critical audit point

The earlier audit found plots, crises, charters and peace terms at **0** in a 5-year AI soak. Every step of this arc
needs a **forcing path** that does not depend on rare stock decisions:

| Step | AI decision point (reuse) | Forcing |
|---|---|---|
| Grow / carry | stock mining (if Voidbloom is a placed resource) + stock freight; pirate smuggler freighters | automatic: no decision needed |
| Smuggle | [new] yearly per-empire policy, using `dietAi.ts:personality` + the Concord deficit + Voidbloom stock | thresholds, not a coin flip; logged |
| Crackdown | Concord script | thresholds |
| War | stock war review + `warReviewAttitudeRelax` + casus belli | relax scaled by deficit and incidents |
| Treaty | `endWarAcceptance` + `buildTerms` extra terms | the gate opens late; the AI proposes add-on terms |
| Diet | `CouncilExtension.candidates` / `voteBias` (§5) | candidate weights ≥ the stock motions' |
| Aftermath | scripted | always fires |

The soak acceptance target: in a 200-year AI-only soak with Rim Trade on, at least 1 crackdown in 3 of 5 seeds,
≥ 1 war in 2 of 5, and ≥ 1 treaty in 1 of 5.

## 3. Contraband supply: options

| # | Option | Pros | Cons |
|---|---|---|---|
| A | **Rim-placed resource** (resources.txt luxury, `resourcePlacement` in the rim ring, as Rimfrost Lichen) | stock mining, freight and AI handle it for free; geographic: rim empires and herders hold it; no new production code | changes galaxy generation (not addable to save); anyone in the rim mines it |
| B | **Colony Economy facility** ("Spore Vat" turns Rimfrost Lichen into Voidbloom, the Option A refinement pattern, `colonyEconomy/refinement.ts`) | a deliberate choice; private-sector AI auto-builds it; nice irony (the Concord's own import feeds it) | needs colony-economy and its refinement flag at game start; less reach |
| C | **Pirate / herder supply** (pirate bases and rim herders hold stock; `rimHerders`, pirate factions) | no player choice needed; pirates already smuggle; good for the AI-only galaxy | the player can't "be" the smuggler empire without buying from pirates; weak for the narrative |
| D | **Research project** (a rim-biology tech unlocks Voidbloom farming at rim colonies) | a gate for timing; a moral choice | research.txt edits; the AI research priority must pick it, which is unreliable |
| E | **Special planet type** (a "bloom world" variant) | flavour, map targets | new habitat type plus art; heavy |
| F | **Hidden farms** (the darkFarms pattern: a hidden site at a colony, found by security) | ties to internal-security; deniable | mostly scenario-state production; less economic weight |

**Recommendation: A + C, with B as an optional upgrade.** Make Voidbloom a rim-ring luxury (A). That gives the AI and
the freight system participation at zero cost, and that participation is the dominant risk (§2.10). Pirate factions
and rim herders also hold Voidbloom and act as the default carriers (C), so the arc fires even when no empire chooses to
smuggle. When colony-economy is on, a Spore Vat (B) multiplies output at a colony holding Rimfrost Lichen. That gives
the player a deliberate, investable "grow" choice. Do not do D, E or F in v1.

## 4. Aftermath branches

At signing, one weighted draw. The base weights move with the treaty's harshness `H` (colonies ceded + indemnity /
Concord yearly income), the addiction index `A` (0–1), and the Concord's money and colonies left.

| Branch | Base | Modifiers | Plays out |
|---|---|---|---|
| **(a) Self-strengthening + revanche** | 30 | +15 if H high & A < 0.5; −15 if Concord colonies ≤ 3 | Research cap lifted in steps (`rimTraderResearchCap` +1 every 5 years to 9, via the `researchFrozen` query; `applyConcordTech`-style catch-up). A **grudge** ledger entry against the victor with `decayPerYear: 0` (`applyReputation`, `cause: 'voidbloom.treaty'`). After 15–30 years (seeded), `scenarioWarBlocked` lifts toward the victor and the Concord gets a casus belli to **retake the treaty ports** (war goal `border` on the ceded colony and treaty ports). If it wins, it restores the closed trade. |
| **(b) Unrest → rebellion or civil war** | 25 | +25 × A; +10 if H high | Addiction persists and the approval terms remain. Rebellion runs on [add-on] `emergent/politics.ts:attemptSecession` (governor-led) or `frontier/frontier.ts:breakAway` (sector). A full civil war uses [C#] `empireEvents.ts:initiateEmpireSplitAt` with `declareWar: true` (a Taiping analogue: a "Bloom Heavenly Kingdom" splinter). The rebel is a normal AI empire, so Rim Trade rules don't apply to it. |
| **(c) Client state** | 15 | +15 if the victor's firepower > 3× the Concord's | The Concord accepts a **Protectorate** under the victor. Needs a hook: `common.ts:rimTraderRefusesTreatyType` refuses Protectorate and Subjugation unconditionally. Add an exception query keyed on the add-on state. The victor gets permanent treaty-port rights. The Concord's foreign policy follows the stock protectorate rules. |
| **(d) Opening and renaissance** (the Meiji path) | 10 | +10 if A < 0.3 & Concord money high | The single-port rule and import blocks end. `rimTraderMaxColonies` rises to the stock level, so the Concord colonises. The treasure fleet becomes an ordinary trade fleet. The research cap is removed at once. The passive posture ends: `scenarioWarBlocked` false. The Concord joins the Diet and turns into a strong normal empire. This is the "you woke the giant" ending. |
| **(e) Collapse into successor states** | 10 | +20 if Concord colonies ≤ 4 or money < reserve | Two or three splits in quick succession (`initiateEmpireSplitAt`, seed colonies the farthest from the capital). The rump keeps the Concord flag and the treasure fleet stops. The successors are normal AI empires. Rival empires can pick them off. |

The draw is announced as galactic news. The player sees which branch fired, with a one-line history: "The Concord turns
inward and studies the foreigners' guns…".

## 5. Diet involvement

**Framework audit.** A `CouncilExtension` (`emergent/council.ts:registerCouncilExtension`) can add **candidates**
and **voteBias**. The Diet's `dietAi.ts:dietCandidates` takes the council's `motionCandidates`, which include the
extension candidates (`council.ts:576`). So *stock-kind* motions (sanction, embargo, condemn, lift) work with no edits to
the Diet. But `DietMotionKind` / `DietLawKind` (`diet/dietState.ts:73,151`) are closed unions, and `diet.ts:applyDietMotion`
is a closed switch. **New laws need a small `registerDietMotionKind` hook**: apply, text, `lawScore`, and violation.
Enforcers (`dietEnforcers.ts:spawnEnforcers`) spawn on a sanction. Against the Concord's home navy they will lose. The
design accepts that: the enforcers stand off and blockade, they do not assault. The Concord is not excluded from
council membership (`isCouncilEmpire`), so it can sit and vote. Name clash: the stock council name list includes
"Galactic Concord". The add-on should drop that name when Rim Trade is on.

| Motion | Kind | Effect | AI vote logic (`dietVoteScore` + `voteBias`) |
|---|---|---|---|
| **Ban Voidbloom** | new law `banContraband` | Voidbloom deliveries by members are a Diet crime (`diet.ts:violation` → automatic sanctions on repeat). Member black-market orders stop. | + if the voter has addicted colonies or Concord ties; − if it earns Voidbloom income (from the add-on ledger); personality "lawful" + |
| **Sanction the smuggler** | stock `sanction` via candidates | stock sanction + enforcers | weight 50 + seizures × 5; + victims of Voidbloom; − smuggler's allies (stock) |
| **Open the Concord's ports** (Diet-backed treaty) | new law `openConcord` | Every member gets treaty-port and toll-exempt rights at one Concord port. A multilateral Open Door: unlike a war treaty, there is no cession and no legalisation. | + by Concord deficit (per-voter ledger debit); + free-trade personalities; − if the voter has standing ≥ grant threshold (it profits from the closed system) |
| **Sanction the Concord** (for the crackdown) | stock `sanction` / `condemn` on the Concord | stock sanction, plus the Concord gets an "isolated" anger line | + if the voter's ships were seized or burned; + deficit; − if a voter's colonies are addicted |
| **Mediate** | existing `truce` + new law `dietTreaty` | ends a Voidbloom war with *Diet-chosen* terms: indemnity capped, no cession, inspection kept, Voidbloom stays banned | + war-weary / defensive personalities; − belligerents |
| **Recognise the treaty ports** | stock `recognise` / `claim` (`'claim'` law with `colony`) | the Diet recognises a ceded colony. Retaking it is then a Diet crime (affects branch a). | + victor's friends |

**Siding against the Concord.** This becomes likely when ≥ half the members run a Concord deficit and the Concord has
seized or burned a member's cargo. Then "Open the ports" and "Sanction the Concord" are top-weighted candidates. The
smuggler's lobbying is the stock bloc mechanic (`blocVoteWeight`). **Siding with the Concord** becomes likely when
addiction spreads to members' own colonies. The add-on lets Voidbloom leak into any colony bordering a smuggling route,
at a low rate, so the drug comes home and creates support for the ban.

## 6. Gaps needing new systems (largest first)

1. **Black-market demand and contraband flow** (L): an order the owner didn't place, filled by any carrier, paid by
   the colony's private sector, plus an addiction model per colony. The core of the add-on.
2. **Patrols and inspections** (L): a customs sweep at and around Concord colonies, seizure, incidents, and pirate
   responses. Nothing like it exists. The stock detection only exposes pirate smugglers. Reusable later (Diet ban,
   any empire's own ban).
3. **Custom treaty terms** (M): `PeaceTerms.extra` plus a term registry (value for AI acceptance, describe, sanitise,
   apply), and UI rows in the peace screen. Unlocks treaty ports, exemptions and legalisation, and is reusable by
   other add-ons.
4. **AI smuggling and war decision layer** (M): yearly policy per empire, war relax, term building, soak counters.
5. **Concord decline gate** (S–M): cap factor by addiction, a min-year or tech-gap floor on `endWarAcceptance`.
6. **Diet motion-kind registry** (S–M): `registerDietMotionKind` (apply, text, lawScore, violation), with the
   `DietMotionKind` union widened to `string` for registered kinds.
7. **Aftermath engine** (M): the draw, plus five scripted branches over existing split, secession and research
   hooks.
8. **Small hooks** (S each): export `grantCasusBelli`; a `voidbloomRing` HiddenKind; a `smuggling` RimAggression; a
   Concord treaty-type exception query; migrate the humiliation write to `applyReputation`; resource-id allocation
   for overlay goods (Rim Trade uses 41–46; check collisions with other overlays and with `registerScenarioGoods`).

## 7. Build plan

| Phase | Content | Size (≈ lines incl. tests) |
|---|---|---|
| V0 | Groundwork hooks (§6.8, §6.6, `PeaceTerms.extra`); no behaviour change with the add-on off (byte-identical runs) | 500 |
| V1 | Voidbloom good (overlay + placement), pirate/herder stock, addiction model, stability / bonus / corruption terms, Concord balance figure | 700 |
| V2 | Black-market orders + delivery path in `cmdDocking.ts` + payments; AI smuggle policy; player op "trade Voidbloom" | 900 |
| V3 | Commissioner (governor + VIP trip), inspection sweep, seizures and burnings, ban, incidents (`applyReputation`, casus belli, rim anger) | 900 |
| V4 | Decline gate, war relax, treaty terms (port, exemptions, legalisation), AI term building, fallback treaty without lively-galaxy | 900 |
| V5 | Aftermath draw + five branches | 900 |
| V6 | Diet: candidates, voteBias, three new laws | 600 |
| V7 | UI: Voidbloom panel (balance, addiction map tint, seizures), peace-screen rows, colony approval lines, Expansion article; soak + parity tests | 800 |

Total ≈ 6,000 lines, in eight agent-sized slices. V0–V2 are playable alone, as "Voidbloom smuggling" without the war.

**Risks**
- **The AI doesn't play it** (top risk). Mitigate with the forcing paths in §2.10 and the soak targets as CI-style checks.
- **The Concord is unbeatable or trivially beatable.** The decline gate is param-driven; tune it over 3+ seeds per
  galaxy size.
- **Determinism:** the docking path is hot and already draws Rnd (the stock detection). New draws must sit in the
  sweep, not in docking, or come in a fixed order with their own guard. Verify with the multiplayer bit-identity
  harness (Win/Mac/Linux).
- **Performance:** the sweep over freighters near Concord colonies. Bucket it by system and run it every 10 days.
- **Save compatibility:** the add-on is not addable to a save. Old saves stay unaffected.
- **Tone:** a fictional narcotic. Keep the presentation sober (policy and economics, no glamour), in line with
  the game's existing tone.

## 8. Open questions for the user

1. **Supply:** OK with the recommendation (a rim-placed resource, pirates and herders as default carriers, and a Spore
   Vat only with colony-economy)?
2. **Late-only gate:** a hard floor (min game year or tech gap before the Concord can be forced to sign), or purely
   economic decline (drain + cap factor), which can in rare cases happen early?
3. **The Concord side:** should a human ever be able to play the Concord or its commissioner (multiplayer), or does it
   stay AI-only, as in Rim Trade today?
4. **Aftermath weights:** pure random from the table in §4, or let the player's treaty harshness shift them as much as
   proposed (a harsh treaty makes revanche or collapse much likelier)?
5. **Diet default:** when both sides have support, should the Diet lean toward the free-trade side ("Open the ports")
   or the ban side, by default?
6. **Spread home:** may Voidbloom leak into the smuggler's own and other empires' colonies (which drives Diet support
   for a ban), or should addiction stay confined to Concord space?


## As built (2026-10-12)

Code: `src/sim/scenario/voidbloom/` (`common.ts` state and lookups, `supply.ts` worlds / harvest / labour / garrisons,
`trade.ts` orders / legality / drain / spread / effects / AI policy, `crackdown.ts` commissioner / inspections / crisis /
police action / bribes, `treaty.ts` decline / peace gate / terms / aftermath, `diet.ts` the Diet, `legal.ts` the legal era,
`view.ts` read-outs and player commands), `scenarios/voidbloom/` (manifest, `resources.txt`, `GameText.txt`), UI in
`src/ui/scenario/voidbloomUi.ts`, `src/render/voidbloomMarkers.ts`, the peace dialog (`warTermsPanel.ts`), the colony
panel (`selectionInfo.ts`) and the colonies list. Tests: `test/rimTrader.test.ts` ("The Voidbloom War"),
`test/modlayer.test.ts` (catalog), `test/rimHerders.test.ts` (resource ids).

**Groundwork (V0), all inert with the add-on off:** `rimTrade/common.ts concordHooks()` (opening, war lift, protectorate
exception, colony-cap exemption, navy-cap factor, research cap, task-force exemption from the passive posture, treaty-port
trade, toll exemption, ports open), `lively/peaceTerms.ts` `PeaceTerms.extra` with `registerPeaceTermKind` (value,
describe, sanitise, apply), `registerPeaceTermsBuilder` and `registerPeaceAppliedListener`; `lively/warGoals.ts
grantCasusBelli`; the humiliation write now goes through `applyReputation` (flag off: the same write);
`diet/dietState.ts registerDietMotionKind` (text, apply via `addLaw`, vote score, candidates, label / effect for the
screen) and `registerDietSeatExclusion`; `diet.ts dietLawViolation`.

### Decisions taken during the build (details the design left open)

1. **Voidbloom is a resource-table entry** (overlay id 49, renumbered by name when rim-herders is absent; our own icon,
   picture ref 9100) registered as a scenario good, so galaxy generation draws exactly as without the add-on. It is on
   no planet's resource list: the add-on grows it into the colony's stock, so no mining station can take it.
2. **Worlds:** picked at game start among unowned, unpopulated rim planets (radius ≥ 0.7) of habitable types, swamps and
   volcanic worlds first, at least 5 sectors apart; one per 140 stars, at least 3; base quality raised to 0.55 so the
   stock colonisation filter considers them. **The climate:** nobody is born there (`colonyMaxPopulation` capped at the
   current population), 35 % die each year, and a crowd above 1.5 × the labour target (migrants) loses half the excess a
   month; never below 1 million.
3. **Harvest:** `voidbloomYield × workers(M)^0.6` units every 30 days (12 × 40^0.6 ≈ 110), a quarter while the fields are
   burned, nothing while the Concord holds the world; stockpile capped at 4,000.
4. **Labour convoys** reuse the Refugees add-on's convoy pattern (an independent passenger ship, pre-loaded, Transport
   mission, settled by the stock unload). Conquered peoples are taken first. AI (and the player's automation, on by
   default) sends one every 90 days while the world is under 40 million; 15,000 credits each.
5. **Garrisons** count troops: 2 + 1 per 10 million workers. A levy raises one troop for 8,000 credits (AI and the
   player's automation one a month). A short garrison risks a revolt (12 % a month × the shortfall share): the workers
   take the world as an independent colony, which keeps its stock and becomes a black-market seller.
6. **Who sells where:** the stock order path (the `extraLuxuryOrders` slot) and `contractAvailable` on the seller: into a
   banned market (the Concord always, unless legalised) only smugglers sell — pirates, independents and empires whose
   policy is `smuggle`; an empire with policy `ban` sells none. **A grower keeps it off its own markets** (its colonies
   order it only once hooked some other way; exposure × 0.2) — added after the first soak, where the grower's own
   colonies ate the whole harvest.
7. **Price and drain:** black-market premium = value × 1.5 × (0.5 + the buyer colony's addiction); a legal sale carries
   a 0.5 × addiction markup. On every purchase the buyer's state treasury pays 15 % of the total (the silver drain), its
   private sector the rest; smugglers keep 20 % of the premium (the carrier, else the richest pirate faction).
   **Addicted colonies use it:** 60 units per billion people a month at full addiction (the stock luxury consumption is
   only 2e-8 per person a year, far too small to drain anyone).
8. **Spread (epidemic):** every 30 days, exposure from growing worlds (0.1, 0.18 when the owner smuggles) and addicted
   colonies (0.1 × addiction) within 14 sectors, linear fall-off; the Concord's colonies get +0.04 a month once anyone
   grows it and × 3 overall (the Canton market). Dampers: race susceptibility from a fixed hash of the race name (about
   10 % immune, 20 % resistant at 0.4, 20 % susceptible at 1.3), a ban × 0.5, a Customs Bureau × 0.5, Internal Security
   × 0.8, the government's stability, unhappiness (approval under 30 speeds it). A colony that tastes it (exposure 1 or a
   delivery) orders it; supplied (stock, or a purchase in the last 60 days) it gains 0.03 addiction a month (× 1.2 in
   the Concord), unsupplied it loses 0.012 (× 4 after neural detox).
9. **Crackdown timing:** at a Concord addiction index of 0.12 or 400,000 credits drained (whichever first). The
   commissioner is a governor character (`governors.ts spawnGovernorFor`, so Characters & Victory's travel applies when
   on) named "Commissioner …" at the worst-hit colony. Inspections every 10 days: 30 % per ship near the commissioner,
   15 % near any other Concord colony; seized cargo is destroyed; galactic news of a public burning at most once a year.
10. **Crisis:** every smuggling empire (sold into the Concord, policy smuggle, holds a world) gets a crisis decision:
    back down (legal for 10 years), pay 250,000 (5 quiet years), tolerate, or war (declared at once; casus belli and a
    penalty-free declaration). The AI scores war = 3 (strength ratio vs the home guard − 0.8) + aggression − caution / 2 +
    3 × decline − 1.5 against tolerate = 1 + profit share − the police action's bite (raids, burns, occupations); a
    tolerated AI target is asked again every 3 years, so wars come late. Independent growers (the cartel, risen workers)
    get the police action without a crisis.
11. **Police action** is scripted, not the stock war AI: a task force of 8 warships (out of AI control, exempt from the
    passive posture; the home guard share stays home) blockades the nearest world; on station it raids every 30 days
    (the stock on the planet is destroyed), burns the fields after 30 days, kills the governor 25 % a month, frees
    labour convoys it meets (the workers join the nearest Concord colony), stops and searches the target's freighters
    within a sector (and attacks them in war), and **occupies** a world after 90 days when its garrison is smaller than
    the ships present (a scripted hand-over, so it works without war). Occupied worlds lie fallow and do not count
    against the Concord's colony cap. During a tolerated action the Concord may attack the target's ships without war.
12. **Decline index** (0..1) = 0.35 × addiction + 0.25 × drained / starting treasury + 0.2 × (1 − treasury / starting
    treasury) + 0.2 × (tech gap / 3, the best normal empire's weapon / energy / high-tech level over the Concord's). The
    navy cap factor falls with addiction (× (1 − addiction / 2)). **Peace gate:** below 0.45 the Concord rejects any offer
    in which it cedes, pays or grants rights.
13. **Treaty terms** (PeaceTerms.extra kinds; points): legal Voidbloom 150, treaty port 150 (its most populous non-capital
    colony), toll exemption 120, inspection exemption 80, a 10 % customs cut 100; the barren rock is its least valuable
    colony (it grows into a trade hub: +2 development and +3 % income a year, up to +30 / +40 %). The AI asks legalisation
    always and the rest within its budget. Without War Goals: a built-in treaty when the Concord's gate is open and the
    smuggler inflicted 1.2 × the damage it took (the rock, 30 % of 40 % of the Concord's treasury now, the rest in five
    yearly instalments, every right).
14. **Aftermath:** drawn at the first yearly tick after signing. Harshness = the treaty's value to the victor in term
    points, harsh from 600. Weights as §4 (plus +5 collapse when harsh). Self-Strengthening raises the research cap a
    level every 5 years to 9 and plans a revanche 15–30 years on (the war block lifts toward the victor only); unrest
    splits 35 % of the Concord at its most addicted colony (the "Bloom Heavenly Kingdom", its leader "the Bloom Prophet",
    Spiritual); client = a protectorate under the victor (the Concord's refusal lifted for that one treaty); opening ends
    every closed-trade rule (the Concord becomes a normal AI empire) and legalises Voidbloom for all; collapse splits 2–3
    far colonies off. Ten years after any treaty but client / opening the pretext incident gives the victor a casus belli
    (an AI victor with 60 % of the Concord's strength declares); war damage at the Concord's capital in that war loots
    10 % of its treasury and burns its wonder (−10 approval there).
15. **"Me too":** a normal empire in contact with the Concord and at least half its strength gets legal Voidbloom, toll
    and inspection exemption once a treaty exists.
16. **Diet:** Ban Voidbloom (members ban it; a member smuggling into another member breaks the law, once a year),
    Open the Concord's Ports (toll exemption and open ports for members), a Diet treaty for a Voidbloom war a year old
    (truce, an indemnity of at most 200,000 or 5 % of the Concord's treasury, no cession, the smuggler backs down), and
    after 8 years of legal trade Galactic Prohibition (every member bans it and every legalisation is suspended). Sanction
    cases on smugglers come from hooked members and the Concord, on the Concord from members whose cargo was seized.
    Vote bias follows decision 5; the Concord never hosts the Diet nor stands for or becomes Regent.
17. **Legal era (item 15):** dependency (a member with addiction ≥ 0.25 warms to its growers yearly and hesitates to war on
    them), withdrawal crises (120 days unsupplied at addiction ≥ 0.35), temperance movements (a hooked colony under 40
    approval asks for a ban; AI cautious or hooked governments ban; ignoring costs −5 approval there for 3 years), neural
    detox (300,000, 4 years; the AI funds it at addiction ≥ 0.2), leaders who pick up the Addict trait, and syndicate news.
    Temperance and dependency run whenever addiction is high, not only after legalisation.
18. **Bribery:** the player (and a rich AI under a police action) can bribe the Concord's officials: no inspections of its
    ships for 2 years for 80,000 + 2 % of the Concord's treasury.
19. **Player commands** (journaled): `vbSetPolicy`, `vbSetAutomation`, `vbLabourConvoy`, `vbLevyGarrison`, `vbStartDetox`,
    `vbBribeOfficials`; the crisis and temperance answers use `answerDecision`; treaty rights go through
    `proposePeaceTerms`; Diet motions through `dietPropose`.
20. **UI:** a Voidbloom block under the Concord's trade terms on the diplomacy screen (policy, the drain, addiction and
    decline, our worlds with convoy / garrison buttons and automation, detox, bribery, history); treaty-rights check
    boxes in the peace dialog; Voidbloom lines on the colony panel and in the colonies list's approval breakdown; a quiet
    map mark (a spore glyph on explored worlds, a faint violet ring around addicted colonies). No new top-bar icon; only a
    revolt and a world gained pop up (the crisis and temperance are decisions).

**Not done / simplified:** the treasure fleet is not forced to call at treaty ports; recognising treaty ports in the Diet
(stock `claim`) is not proposed by the AI; in the opening branch the treasure fleet stays but no longer sails as a Concord
rule; occupation does not use the stock invasion; per-pair dependency is approximated by "every grower that sells".
