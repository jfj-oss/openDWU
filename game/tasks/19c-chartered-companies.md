# 19c — Chartered companies (VOC / Dutch East Indies)

Status: spec, agent-ready. **Depends on 19a** (same scenario folder `scenarios/rimTrade/`, its `common.ts` lookups,
the game-start hook) and on the shared contract hook of `tasks/19e9-freight-overlay.md` §4.1–4.2 (add it exactly as
written there if not yet in the tree). Read first: `CLAUDE.md`, `tasks/MODLAYER-DESIGN.md` (re-read it before you
start; its API is the contract), `tasks/19a-rim-trader.md`, `tasks/M4-agent-brief.md` (porting/determinism rules,
seed pins), `tasks/UI-agent-brief.md` (§8), `tasks/19-mod-layer-scenarios.md` §19c (user idea).

`$C=/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded`

## 1. Goal and player experience

An empire funds a private expedition to settle a far world under a **company**: a persistent sub-empire of the
founder's race with its own colony, a small fleet and its own AI. It is bound to the founder by treaty (a Subjugated
Dominion paying the stock tribute, or the softer Protectorate), trades freely, lets founder warships refuel, and pays
the founder a **tariff** on its sales of rim goods to the rim trader (19a). Over time it may grow strong and demand
autonomy (stock dominion behaviour), be nationalised, released, or have its charter renewed. AI empires charter
rival companies, so the rim becomes a race of competing companies.

Player flow: select an unowned, explored planet → "Charter a company…" → dialog (fee, relation kind, tariff %,
duration) → confirm → news "The Voidreach Company has been chartered by the Terran Federation to settle Kessa IV"; a
new empire appears at Kessa IV with a colony ship, escorts, freighters and a construction ship; its sales show up on
the freight overlay; the Charters screen shows tariff and tribute collected, years left, and Renew / Release /
Nationalise.

## 2. Data overlay (`scenarios/rimTrade/`, created by 19a)

### 2.1 `scenario.json` — add to 19a's manifest
```json
"flags": [ …19a flags…,
  { "name": "charteredCompanies", "label": "Chartered companies", "description": "Empires can charter trading companies to settle distant worlds; companies pay tariffs on rim trade.", "default": true },
  { "name": "aiCharters", "label": "AI empires charter companies", "description": "AI empires found rival companies.", "default": true },
  { "name": "companyHqExportOnly", "label": "Company HQ is the only export point", "description": "Foreign freighters may buy from a company only at its capital port.", "default": false }
],
"params": [ …19a params…,
  { "name": "charterFee",              "label": "Charter fee (credits)",          "default": 30000, "min": 5000, "max": 200000 },
  { "name": "charterTariffPct",        "label": "Default tariff on rim sales (%)", "default": 15,  "min": 0,  "max": 50 },
  { "name": "charterDurationYears",    "label": "Default charter length (years)", "default": 20,  "min": 1,  "max": 100 },
  { "name": "companyStartPopulation",  "label": "Settlers (millions)",           "default": 50,  "min": 5,  "max": 500 },
  { "name": "companyEscorts",          "label": "Escort ships",                   "default": 3,   "min": 0,  "max": 10 },
  { "name": "companyFreighters",       "label": "Freighters",                     "default": 2,   "min": 0,  "max": 8 },
  { "name": "maxCompaniesPerFounder",  "label": "Companies per empire",           "default": 2,   "min": 1,  "max": 6 },
  { "name": "aiCharterChancePct",      "label": "AI charter chance per year (%)", "default": 25,  "min": 0,  "max": 100 }
]
```
### 2.2 `GameText.txt` additions
```
Scenario Charter Company Name;{0} Company
Scenario Charter News;The {0} has been chartered by the {1} to settle {2}.
Scenario Charter Granted;Our charter for the {0} is granted. Its expedition sets out for {1}.
Scenario Charter Autonomy;The {0} has thrown off its charter and declared autonomy from the {1}.
Scenario Charter Expiring;The charter of the {0} expires this year. Renew, release or nationalise it.
Scenario Charter Renewed;The charter of the {0} has been renewed for {1} years.
Scenario Charter Released;The {0} has been released from its charter by the {1}.
Scenario Charter Nationalised;The {1} has nationalised the {0}; its colonies and ships are now state property.
Scenario Charter Tariff;Tariffs from the {0} this year: {1} credits.
Scenario Charter Ineligible;{0}
```
No new race or policy file: a company uses its founder's race (and so its stock policy file, adjusted in code, §4.2).

## 3. Flags

| Flag | Read at |
|---|---|
| `charteredCompanies` | `grantCharter` guard, tariff listener, yearly charter handler, war block, UI actions |
| `aiCharters` | AI founder part of the yearly handler (needs `charteredCompanies` too) |
| `companyHqExportOnly` | the single-port branch in `addForeignTradingPosts` (generalised from 19a R6) |

## 4. Sim changes (numbered; files under `game/src/sim/`)

Package module **`scenario/rimTrade/charters.ts`**, imported from `scenario/packages.ts`. Every base-file branch is
one `if (scenarioFlag(galaxy, 'charteredCompanies') && …)` line with `// Mod layer 19c: … (tasks/19c-chartered-companies.md §4.<n>)`.

C# analogues this mirrors (cite in comments): `$C/BaconDistantWorlds/BaconHabitat.cs:1126` LeaveEmpire (a colony
becomes a new empire under `SubjugatedDominion` to its old owner: `ChangeDiplomaticRelation`, `DetermineEmpire
RelationshipFactors`, evaluation FirstContactPenalty 0 / IncidentEvaluation +60) — the closest stock "sub-empire"
creation; `$C/DistantWorlds.Types/Galaxy.8.cs:1348` GenerateShakturi and `:1546` GenerateCivilianConvoy (mid-game
empire + ships spawned for it: GenerateNewBuiltObject, TakeOwnershipOfBuiltObject, AssignMission Move);
`Empire.1.cs:996` ProcessSubjugationTribute (tribute, `BaconEmpire.cs:25` SubjugationTributePercentage 0.1);
`Empire.8.cs:755` ApplyDiplomaticStrategyToRelation (a dominion asks for release by relative strength) and
`Empire.3.cs:3606` ConsiderTreatyProposals + DetermineWhetherWantToEmancipate (the overlord's answer); `Empire.8.cs:1641`
EndSubjugation; `Empire.8.cs:1853` OfferMilitaryRefueling; `Empire.4.cs:1135` InitiateContract (sale proceeds);
`Empire.cs:4874` CompleteTeardown(conqueror) and TakeOwnershipOfColony (nationalisation).

1. **Mod-layer extension of `scenario/empireMidGame.ts`** (owned by this task if absent; coordinate with the modlayer
   owner): `MidGameEmpireSpec.preserveHome?: boolean` and `homeSystemFactor?: number`.
   - Why: `generateEmpire` (Galaxy.7.cs GenerateEmpire) rewrites a capital as a *homeworld*: the favourability table
     sets diameter / baseQuality, and `Galaxy.setupHomeSystem` (the GenerateEmpire tail) clears `capital.resources`,
     re-rolls them and, for a known favourability, rewrites the whole system's colonizable habitats and resource
     levels. A company must settle the planet as it is.
   - `preserveHome`: pass favourability `''` (not in the table → no diameter/quality/system rewrite; `setupHomeSystem`
     only resets and re-rolls the capital's resources), snapshot `{ resources (deep copy), diameter, baseQuality }`
     before and restore them after `generateEmpire` returns (the re-roll's draws still happen; they are inside the
     scenario hook, so allowed).
   - `homeSystemFactor` override: the population is `trunc(factor * 2.2e9 + factor * rnd * 5e8)` for age 0
     (empireGeneration.ts), so `factor = companyStartPopulation * 1e6 / 2.2e9` yields the settler count.
2. **`charterEligibility(galaxy, founder, target) → { ok: boolean; reason: string }`** (pure, no Rnd): flag on;
   founder active, not pirate, not a company, not the independent empire; `founder.stateMoney >= charterFee`;
   founder's active companies `< maxCompaniesPerFounder`; `galaxy.nextEmpireId < galaxy.maximumEmpireCount`; target is a
   planet or moon (not asteroid/star/gas cloud), `target.empire === null` and no population; system explored by the
   founder (`founder.visibility.checkSystemExplored`); no colony of any empire in the target's system;
   `canEmpireColonizeHabitat(galaxy, founder, target, …)` (exploration.ts:182, habitat-type/quality rules of the
   founder's race; pass the founder's newest colony-ship design like the colonization code does) ;
   not inside another empire's dominant system (`checkShouldAttemptColonization`'s dominant-empire test,
   construction/empireConstruction.ts:691). Reasons are short English strings for the dialog.
3. **`charterTargets(galaxy, founder) → Habitat[]`** (pure): eligible habitats sorted by
   `determineColonizationValue(galaxy, founder, h)` (tradeItems.ts:666) × (2 if the system holds any rim good, 19a
   `rimGoodIds`) descending, ties by habitat index (`netSort`). Capped at 20 for the AI.
4. **`grantCharter(galaxy, founder, target, terms) → { ok; reason; company: Empire | null }`**, terms =
   `{ kind: 'dominion' | 'protectorate', tariffPct, durationYears }`. Draws galaxy.rnd (createEmpireMidGame, parking
   points); called only from the player's input (like `submitProposal`) or the flagged yearly handler.
   a. `charterEligibility` must be ok. `founder.stateMoney -= charterFee`.
   b. `createEmpireMidGame(galaxy, { race: founder.dominantRace, name: scenarioText('Scenario Charter Company Name',
      <target system star name>), home: target, age: 0, techLevel: 0.5, governmentId: 12 /* Corporate Nationalism,
      if not in the race's DisallowedGovernments, else founder.governmentId */, preserveHome: true,
      homeSystemFactor: companyStartPopulation*1e6/2.2e9, setup: false, configurePolicy: companyPolicy })`.
   c. Money: `company.stateMoney = charterFee * 0.6; company.privateMoney = charterFee * 0.4` (overrides generateEmpire's
      start money).
   d. Tech: give the company every research project the founder has and it lacks via the stock trade path —
      `resolveTradeableItemsResearchProjects(galaxy, founder, company, false, false)` then `giveTradeableItem(galaxy,
      founder, company, item, null)` for each (tradeItems.ts:354 / :1325; check both for Rnd; if they draw, fine —
      still inside this call). Then maps: `giveTradeableItem` of the founder's GalaxyMap item (tradeItems.ts
      `resolveTradeableItemsMaps`), so the company knows the founder's explored space.
   e. Relation (mirror BaconHabitat.cs:1126 LeaveEmpire, `grantingIndependance: false`): `rel =
      obtainDiplomaticRelation(founder, company)`; `changeDiplomaticRelation(galaxy, founder, rel, kind ===
      'dominion' ? SubjugatedDominion : Protectorate)` (diplomacyTick.ts:2515; the founder is the initiator — check both
      sides' `initiator === founder`, which is what `processSubjugationTribute` keys on);
      `determineEmpireRelationshipFactors(company, founder)`; company's evaluation of founder: `firstContactPenalty = 0`,
      `incidentEvaluation += 60`. Then `offerMilitaryRefueling(founder, company)` and `offerMilitaryRefueling(company,
      founder)` (Empire.8.cs:1853; both directions).
   f. Expedition ships (GenerateCivilianConvoy pattern, story/storyEvents.ts generateCivilianConvoy): spawn point = the
      founder's space port nearest the target (`fastFindNearestSpacePort`, stationPlacement.ts) else the founder
      capital; for subRoles `[ColonyShip, ConstructionShip, Escort × companyEscorts, SmallFreighter ×
      companyFreighters]` in that order: `design = designsFindNewestCanBuild(company.designs, subRole)` (fallbacks:
      Escort→Frigate, SmallFreighter→MediumFreighter; skip if none), `p = galaxy.selectRelativeParkingPoint()`,
      `bo = generateNewBuiltObject(galaxy, company, design, null, x + p.x, y + p.y)` (empireEvents.ts:358),
      `takeOwnershipOfBuiltObject(galaxy, company, bo, company, false)` (combat/ownership.ts:632), `bo.isAutoControlled
      = true`, `assignMission(galaxy, bo, Move, target, null, Normal)`. The colony ship's `nativeRace` = founder race.
   g. Record the charter (§6), `scenarioNews(galaxy, founder, 'Scenario Charter News' …)`, `scenarioMessage` to the
      founder ('Scenario Charter Granted').
5. **`companyPolicy(policy)`** (configurePolicy): TradePriority 4, TradeWithOtherEmpires Y, ExplorationPriority 2,
   the founder race's native `Colonize<Type>Priority` 2, WarWillingness 0.5, BreakTreatyWillingness 0.5,
   SubjugationPriority 0.5, DiplomacySendGiftsUpToAmount 0, BuildPlanetDestroyers N. (Field names as in
   `data/policies.ts`.) Everything else the company does is the stock empire AI: it colonizes, builds ports and
   mining stations and grows its fleet from its own income — the user's "company shipyard grows with profits" is
   stock behaviour, not new code.
6. **Tariff — contract listener `rimTrade.tariff`** (19e-9 §4.1; no Rnd), gated by `charteredCompanies`: find the
   active charter whose company is `ev.seller`; if `ev.buyer !== founder` and the resource is a rim good (19a
   `rimGoodIds`) and (19a flag `rimTrader` on ? `ev.buyer === rimTraderEmpire(galaxy)` : true): `t = ev.value *
   tariffPct / 100`; `company.privateMoney -= t; founder.stateMoney += t`; `charter.tariffThisYear += t;
   charter.tariffTotal += t`. (InitiateContract credits the seller's private money with the sale value and its state
   money with the port tax bonus; the tariff is taken from the private side.)
7. **Single export point** — generalise 19a's `addForeignTradingPosts` branch (logistics/freight.ts, Empire.4.cs:461)
   into `scenarioSinglePort(galaxy, other): StellarObject | null | undefined` in `scenario/rimTrade/common.ts`
   (undefined = no rule): the Concord (19a flags) or, with `companyHqExportOnly`, a company → its capital's space port
   (`determineSpacePortAtHabitat`) else capital.
8. **War rules — extend 19a's `scenarioWarBlocked(galaxy, self, target)`** (called first in `declareWar`,
   Empire.7.cs:4883): under `charteredCompanies`, true when `self` is an AI company and `target` is its founder or the
   Concord, or when `self` is an AI founder and `target` is one of its active companies (an AI founder nationalises
   instead, §4.10). A player founder may still declare war on its company (that is a choice; charter status →
   'revoked').
9. **Yearly handler `rimTrade.charters`** (`registerScenarioYearly`, flag `charteredCompanies`, order 20):
   a. For each charter (list order): company inactive → status 'dissolved'. Relation type no longer the chartered kind
      while both alive → status 'autonomous', `scenarioNews` ('Scenario Charter Autonomy'). (The stock dominion AI asks
      for release by relative strength — Empire.8.cs:755 branch in `applyDiplomaticStrategyToRelation`, which draws
      its own Rnd there — and the overlord may accept via DetermineWhetherWantToEmancipate; that is the "drift", no new
      rule.) Message the founder the tariff total of the year, then `tariffLastYear = tariffThisYear; tariffThisYear = 0`.
   b. Expiry (status 'active' and `year >= startYear + durationYears`): AI founder, deterministic —
      `tariffTotal >= charterFee` → renew (`startYear = year`); else `militaryPotency(founder) >= 3 *
      militaryPotency(company)` (diplomacyTick.ts militaryPotency) → `nationaliseCompany`; else `releaseCompany`.
      Player founder: message 'Scenario Charter Expiring' the first year; if the player has not acted by the next
      yearly tick → auto-renew for `durationYears`.
   c. AI founders (flag `aiCharters`): for each empire in `galaxy.empires` order that is active, not the player, not a
      pirate / independent / company / the Concord, with `stateMoney >= 2 * charterFee`, fewer than
      `maxCompaniesPerFounder` active companies, and (if 19a `rimTrader` is on) a met relation with the Concord:
      `targets = charterTargets(...)`; if non-empty, draw `galaxy.rnd.next(0, 100) < aiCharterChancePct` (the only draw
      here; only for empires passing the checks) → `grantCharter(galaxy, e, targets[0], { kind: friendlinessLevel(e) >=
      120 ? 'protectorate' : 'dominion', tariffPct: charterTariffPct, durationYears: charterDurationYears })`.
10. **`nationaliseCompany(galaxy, founder, company)`**: for each company colony (copy of the list),
    `takeOwnershipOfColonyFull(galaxy, company, colony, founder, false, false)` (combat/ownership.ts:441); then
    `empireCompleteTeardown(galaxy, company, founder)` (events.ts, Empire.cs:4874 CompleteTeardown(conqueror): ships and
    cargo go to the conqueror, relations removed, news "empire defeated" — acceptable; add the scenario news line
    after). Status 'nationalised'. Other companies of the same founder: evaluation of founder `incidentEvaluation -= 20`.
    Draws: whatever those ported functions draw — allowed (player input / flagged handler).
11. **`releaseCompany(galaxy, founder, company)`**: `changeDiplomaticRelation(galaxy, founder, rel, None)` + message,
    as EndSubjugation (Empire.8.cs:1641) does without its automation prompt; status 'released'. **`renewCharter`**:
    `startYear = currentYear`, optional new terms (tariff/duration) — v1 renews with the same kind.
12. **Queries for the UI** (pure): `chartersOf(galaxy, founder)`, `charterOfCompany(galaxy, company)`,
    `isCompany(galaxy, e)`, `estimatedTribute(galaxy, company)` = the stock `processSubjugationTribute` formula per year
    (`(annualTaxRevenue + thisYearsForeignTradeBonuses + thisYearsSpacePortIncome) * baconSettings.subjugationTributePercentage`,
    treasury.ts) for dominions, 0 for protectorates.
13. Freight overlay (if 19e-9 is in the tree): `registerFlowCategory` is 19a's; add a hub marker for company capitals
    and a "tariff" line in the panel's empire-pair table (founder ← company, `tariffLastYear`).

Deferred to a follow-up (list them as `// TODO(19c-2)` in the package header, not in base files): charter terms as a
tradeable treaty renegotiated in the trade panel (new TradeableItem type), exclusive luxury rights, requisitioning the
company fleet in war for a fee, corruption/scandal story events (19d / 19f-10 "Corporate coup" build on this), rival
companies' explicit competition AI beyond independent AI charters.

## 5. Rnd policy

Draws happen only (a) in `grantCharter` and what it calls — reached from player input or from the yearly handler, and
(b) in the yearly handler's `rnd.next(0, 100)` per qualifying AI founder, and in `nationaliseCompany`'s ported callees.
The tariff listener, war block, eligibility and queries never draw. With the scenario absent or `charteredCompanies`
off, none of this code runs (`repin --check` clean). Player-input draws follow the same rule as diplomacy proposals
(`player/diplomacyProposals.ts` header); journal the command in `player/commandLog.ts` if a player-command journal
exists when you implement this (add `source: 'player'` and a `charter` command kind), else leave
`// TODO(replay): journal grantCharter/nationalise/release/renew for 19e-1`.

## 6. Save state

`scenarioState(galaxy, 'rimTrade.charters', () => ({ charters: [] as Charter[] }))`, with plain objects:
`{ companyId: number; founderId: number; targetIndex: number; kind: 'dominion'|'protectorate'; tariffPct: number;
durationYears: number; startYear: number; feePaid: number; tariffThisYear: number; tariffLastYear: number;
tariffTotal: number; status: 'active'|'autonomous'|'released'|'nationalised'|'dissolved'|'revoked';
expiryNotifiedYear: number }` — ids, not object references, so a torn-down empire leaves no dangling graph edge.
No CLASSES entry needed (plain data). The company empire itself is an ordinary Empire (already saved).

## 7. AI behaviour rules (testable)

- **C1** An AI founder charters at most once per year, only with `stateMoney >= 2 × fee`, fewer than the max companies,
  and an eligible target; the target is `charterTargets[0]`.
- **C2** A company is an AI empire of the founder's race whose capital is the charter target, created with the
  target's resources/diameter/quality unchanged, population ≈ `companyStartPopulation` million, and the relation
  `SubjugatedDominion` (or `Protectorate`) initiated by the founder on both sides, with military refuelling both ways.
- **C3** Every contracted sale of a rim good by a company to the Concord (or to anyone but its founder when 19a is off)
  moves `tariffPct %` of its value from the company's private money to the founder's state money.
- **C4** An AI company never declares war on its founder or the Concord; an AI founder never declares war on its
  active company.
- **C5** At expiry an AI founder renews if total tariffs ≥ fee, else nationalises if ≥ 3× stronger, else releases.
- **C6** When the relation leaves the chartered kind (stock release/emancipation, war), the charter becomes
  'autonomous' and a news item is sent once.

## 8. UI changes (follow `tasks/UI-agent-brief.md`; hook markers `// [charters] begin/end`)

1. **Charter action**: in the selection details panel for a habitat (the block task 10b built in `src/ui/hud.ts`) and
   in the order menu for a selected planet (`src/ui/orderMenu.ts` / `player/orderMenu.ts` entry list — add one
   scenario entry "Charter a company…"), shown only when `charteredCompanies` is on; disabled with the
   `charterEligibility` reason otherwise.
2. **New `src/ui/screens/charterDialog.ts` + .css**: target summary (type, quality, resources incl. rim goods), fee vs
   treasury, kind (Dominion: tribute + tariff / Protectorate: tariff only, defence obligation), tariff % slider
   (0–50, default param), duration (10/20/30/custom), expedition preview (ship list from the founder race's designs),
   Confirm → `grantCharter`; result toast (`src/ui/toast.ts`).
3. **New `src/ui/screens/charters.ts` + .css** ("Charters"): the player's companies — name, capital, colonies, kind,
   status, years left, tariff this/last year, estimated tribute, military strength vs yours; actions Renew / Release /
   Nationalise (confirm dialogs). Opened from the Empires list (button in its header when the flag is on) and from the
   diplomacy screen of a company. Pure row builders unit-tested.
4. `empiresList.ts`: "Company of <founder>" tag; `diplomacyScreen.ts`: header line for companies ("Chartered by …,
   expires in N years, tariff X %") and, for the founder viewing its company, a "Manage charter" link to the Charters
   screen.
5. Messages / news through the stock message path (ticker, history, popups).

## 9. Tests — `test/charters.test.ts` (+ `@slow` `test/chartersSoak.test.ts`)

Harness: `createScenarioGame(base, { scenario: 'rimTrade', flags: { rimTrader: true, charteredCompanies: true,
aiCharters: false }, options: <Oranthi as AI 0, as in 19a tests> })`; `runGameSeconds`; founder = an AI empire
(`galaxy.empires[1]`) or the player.
1. Eligibility: owned / populated / asteroid / unexplored / no money / max companies / empire-slot-full cases each
   give their reason; a good target passes.
2. `grantCharter` (C2): new empire exists, race = founder race, capital = target, `target.resources` deep-equal the
   snapshot, diameter and baseQuality unchanged, population within ±15 % of the param, fee debited, company money as
   specified, relation types and initiators on both sides, refuelling both ways, ships spawned: 1 colony ship, 1
   construction ship, escorts and freighters per params (fewer only if a design is missing), all owned by the company
   and moving to the target.
3. Tribute: one call of `processSubjugationTribute(galaxy, company, YEAR_SECONDS)` moves money company → founder
   (stock function; proves the relation is wired the stock way). Protectorate: no tribute.
4. Tariff (C3): synthetic `ContractEvent` through the listener → exact money moves and ledger fields; non-rim goods and
   sales to the founder: no tariff; with `rimTrader` off: sales to anyone else are taxed.
5. War rules (C4): `declareWar(company → founder)` and `(founder AI → company)` are no-ops; player founder can.
6. Yearly handler: autonomy detection (force relation to None → status 'autonomous', one news item); expiry with
   `charterDurationYears: 1` → renew / nationalise / release under the three C5 conditions (set money/potency by
   hand); nationalise transfers every colony to the founder and deactivates the company.
7. AI charters (C1): `aiCharters: true, aiCharterChancePct: 100`, founder money raised → a company exists after the
   next year tick; chance 0 → none; never more than `maxCompaniesPerFounder`.
8. Determinism + save: two fresh games with the same flags, 2 years → equal digests; save after a charter, load, run
   1 year → digest equals the uninterrupted run; charter state intact.
9. Faithful path: stock pins unchanged (`repin --check`); a `rimTrade` game with `charteredCompanies: false` never
   creates a company in 5 years.
10. Soak (`// @slow`, 15 years, `aiCharters` on): ≥ 1 company founded; no company–founder war declared by an AI side;
    total tariffs ≥ 0 and > 0 if the Concord bought any rim goods from a company; `galaxy.empires.length` ≤ the max.

## 10. Acceptance criteria

- typecheck 0 errors; full suite green; `npm run repin -- --check` clean.
- Player can charter from a selected planet, see the company appear with its expedition, see tariffs arrive, and
  renew / release / nationalise from the Charters screen (screenshots of dialog, screen, map).
- AI empires found companies in the soak; companies behave as ordinary AI empires otherwise.

## 11. Risks

- **Empire slots**: `galaxy.maximumEmpireCount` (pirates share the id space) — eligibility checks it; the soak logs
  how many slots remain. Teardown frees none (ids are not reused) — companies are a finite resource per game.
- **Homeworld rewrite** by `generateEmpire` (§4.1): without `preserveHome` the target's resources would be re-rolled —
  the test in §9.2 guards it. `setupHomeSystem`'s re-roll still consumes draws (fine, inside the hook).
- **Stock dominion AI**: a Subjugated Dominion's relation strategy is `Undefined` (diplomacyTick.ts:1676) and it asks
  for release when stronger — companies may go autonomous quickly if the founder is weak; that is the intended drift,
  but watch the soak (tune fee / escorts, not code).
- A company created mid-game runs `runGameStartEmpireTick` inside `generateEmpire` (full empire tick) — same as the
  Shakturi path; expect its first-year AI to be busy (design generation, force projection).
- Player input draws Rnd: replay needs the command journal (§5).
- `takeOwnershipOfColonyFull` / `empireCompleteTeardown` were written for conquest; nationalisation reuses them, so the
  "empire defeated" news fires — add the scenario line after it rather than suppressing stock messages.

## 12. Size

~5–6 days on top of 19a: empireMidGame extension 0.5 d; grant/eligibility/ships/relations 1.5 d; tariff, war rules,
yearly handler, nationalise/release 1 d; UI (dialog, Charters screen, hooks) 1.5 d; tests + soak tuning 1 d.

## 13. Implementation status (branch wip/s19c)

Built without 19a / 19e-9 (neither is in the tree), as a standalone scenario:
- Scenario folder `scenarios/chartered-companies/` (flags §2.1 + param `rimRadiusPct`, GameText §2.2); package
  `src/sim/scenario/charteredCompanies/charters.ts` (imported from `scenario/packages.ts`); handlers are gated by flag
  only, so a later `rimTrade` scenario that declares the same flags gets them.
- "Rim goods" = every resource (the §4.6 rule with 19a off: sales of any resource to anyone but the founder are taxed);
  "rim worlds" = habitats at radius fraction ≥ `rimRadiusPct` / 100, which double a target's value in `charterTargets`.
- `charterEligibility` calls `canEmpireColonizeHabitat` with `checkRange = false` (a company settles beyond the
  founder's colonisation range).
- New query hooks (`scenario/hooks.ts`): `declareWarBlocked` (first line of `declareWar`) and `foreignTradingPosts`
  (top of `addForeignTradingPosts`; a company's capital space port only — no capital-habitat fallback).
- Expiry (§4.9b) is a scenario decision (`charters.expiry`, options Renew / Release / Nationalise, default Renew after
  360 days): the player answers from the message popup; an AI founder answers at once through the C5 rule.
- Player actions are player commands (`player/playerOps.ts` `charterCompany`, `charterRenew`, `charterRelease`,
  `charterNationalise`, and the generic `answerScenarioDecision`, which the popup now issues instead of calling the sim):
  journaled in the command log, so seed + log replays them (tested).
- UI: `src/ui/screens/charters.ts` (+ .css) holds both the Charters screen and the charter dialog; the "Charter a
  company…" button sits in the selection panel (hud.ts `[charters]`); Empires list tag + Charters button; diplomacy
  screen charter line + "Manage charter". Dev: `?autostart=1&scenario=<id>` starts the autostart game with a scenario.

TODO (later):
- TODO(19c): "Charter a company…" entry in the right-click order menu (`player/orderMenu.ts`), beside the selection
  panel button.
- TODO(19c + 19a): restrict the tariff to rim goods sold to the Concord and add the Concord war / single-port rules when
  19a lands (`rimGoodIds`, `rimTraderEmpire`).
- TODO(19c + 19e-9): freight overlay hub marker for company capitals and the tariff row (§4.13).
- TODO(19c-2): the deferred items listed at the end of §4 (tradeable charter terms, exclusive luxury rights, fleet
  requisition, scandal events, rival-company competition AI).
