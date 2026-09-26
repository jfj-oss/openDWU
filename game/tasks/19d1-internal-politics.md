# 19d1 — Internal politics: ambition, loyalty, defections, secessions, coups (+ 19e-5 living characters)

Scenario package on the mod layer (`tasks/MODLAYER-DESIGN.md`). Accepted idea 19d-1 (`tasks/19-mod-layer-scenarios.md`):
ambitious characters defect, secede or seize power when approval is low. 19e-5 (living characters) is specified at the
end as a second flag on the same state; build it only after the core lands (the orders of work put 19e-5 later).

This brief also holds **§S, the shared infrastructure of all four 19d briefs** (scenario folder, approval-term hook,
player decisions). 19d2/19d3/19d4 reference it. Whoever lands first creates §S exactly as written; the others reuse it.

## Read first
`CLAUDE.md`; `tasks/MODLAYER-DESIGN.md` (API: `scenarioFlag`, `scenarioParam`, `scenarioState`, `registerScenarioYearly`,
`createEmpireMidGame`, `scenarioMessage`, `scenarioNews`, `scenarioText`; test helper `test/helpers/scenarioGame.ts`);
`tasks/M4-agent-brief.md` rules 1–3, 5, 8 (numeric semantics, Rnd discipline, cites, free functions, tests/pins);
`tasks/UI-agent-brief.md` for the UI part. The sim code this touches, all already ported:
- `src/sim/characters.ts` — `Character` (role, `traits`, `skills`, `eventHistory`, `location`, `empire`, `kill`,
  `addTrait`, `getSkillLevelTotal`, `completeLocationTransfer`), `CharacterRole`, `CharacterTraitType` (Patriot, Lawful,
  Corrupt, DoubleAgent, ForeignSpy, Famous, EloquentSpeaker, Tolerant, Xenophobic, Paranoid, Demoralizing,
  InspiringPresence, …), `CharacterEventType`, `getCharactersByRole`, `getEmpireCharacters`, `empireLeader`,
  `stellarObjectCharacters`, `ensureStellarObjectCharacters`.
- `src/sim/characterRuntime.ts` — `countEventsByType`, `getDateOfMostRecentEventByType`, `averageHappiness`,
  `reviewCharacterLeaderChange`, `performChangeLeader`, `changeLeader(galaxy, empire, pool, changeType)` (changeType −1 =
  coup texts "Leader Change Coup From Existing"), `processLeaderChangeInfluence`, `habitatStartRebelling`,
  `characterSendDeathMessage`, `CharacterDeathType`.
- `src/sim/empireEvents.ts` — `reviewEmpireEvents` (the C# split trigger: size/strength > 2.5, > 5 colonies, approval +
  civility + 5·(stability−1) < −3 ⇒ 1-in-5), `initiateEmpireSplit(galaxy, self, portion, declareWar)`, private
  `splinterEmpire`, `fastFindNearestColonyBelowApproval`, `empireEventRogueFleetDefectsTo`, `defectFleet`,
  `colonyApprovalAverage`.
- `src/sim/treasury.ts` — `selectSuitableGovernment`, `changeGovernment`, `haveRevolution(galaxy, empire, race, govId,
  damageFactor)`, `reviewGovernmentEffects`. Governments (`$DWU/governments.txt`): 0 Despotism … 3 Republic, 4 Democracy,
  5 Military Dictatorship, 8 Technocracy, 12 Corporate Nationalism; `leaderReplacementCharacterPool`, `…TypicalManner`,
  `stability` in `data/governments.ts`.
- `src/sim/taxes.ts` — `empireApprovalRating` (Habitat.cs 534), `habitatRacialHappiness`, `empireWarWeariness`.
- `src/sim/colonyTick.ts` — `checkSatisfaction` (rebellion thresholds `num5` / `num7`), `leaveEmpire` (events.ts).
- `src/sim/espionagePrisoners.ts` — `spyDefected` (BaconHabitat.cs 706): the one ported example of moving a character
  to another empire; `getCharacterValue` (BaconCharacter) for a money value of a character.
- `src/sim/espionage.ts` — `resolveMoreAdvancedProjectsIncludeSpecial`, `markEmpireAsRecentSpy`,
  `cancelIntelligenceMission`, `characterMission`; `researchTick.ts doResearchBreakthrough`; `tradeItems.ts
  giveTerritoryMap`; `visibility.ts mergeGalaxyMap`.
- `src/sim/tick/empireTick.ts` 283-288 (character reviews), 376 (`reviewEmpireEvents`).

C# analogues to mirror ($C = `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded`):
`DistantWorlds.Types/Empire.1.cs` 1092/1102 InitiateEmpireSplit, 2883 SplinterEmpire, 1637/1666 EmpireEventRogueFleetDefects,
1702 DefectFleet, 2811 ReviewEmpireEvents; `Empire.6.cs` 4873 PerformChangeLeader, 4933 ChangeLeader, 5084
ProcessLeaderChangeInfluence, 3990 CheckForCharacterAppearance; `Empire.7.cs` 16 ReviewCharacterTraits; `Empire.10.cs`
4377 ChangeGovernment, 4404 SelectSuitableGovernment, 4452 HaveRevolution; `Habitat.cs` 534 EmpireApprovalRating,
5992 CheckSatisfaction, 5948 LeaveEmpire; `BaconDistantWorlds/BaconHabitat.cs` 706 SpyDefected.

---------------------------------------------------------------------------------------------------------------------

## §S Shared infrastructure for 19d1–19d4 (canonical; first package to land creates it)

**S1. Scenario folder `scenarios/emergent/`** (id `emergent`, name "Emergent Galaxy", description "Internal politics,
resource crises, espionage consequences and refugees on top of the faithful game."). `scenario.json` `flags`: each
package appends its own entries (19d1: `internalPolitics`, `livingCharacters`; 19d2: `resourceCrises`; 19d3:
`espionageConsequences`; 19d4: `refugees`), all `default: true` in this scenario; `params` likewise per package.
`GameText.txt`: each package appends one block fenced by `' [19dN] begin` / `' [19dN] end` comment lines; every tag starts
with `Emergent ` (e.g. `Emergent Plot Rumour Title`). Handlers register with `flag` only (no `scenarioId`) so any other
scenario that declares the same flag name (e.g. a rim-trader scenario with `resourceCrises`) gets the behaviour.

**S2. Code layout.** `src/sim/scenario/emergent/<pkg>.ts` (sim, headless) + `<pkg>Actions.ts` (player/AI actions);
each package module registers its handlers at import and is imported from `src/sim/scenario/packages.ts` (keep the list
sorted). No new methods on Empire / Galaxy / BuiltObject / Habitat / Character; no new fields on them either — all new
state lives in `scenarioState(galaxy, '<pkg>', init)`.

**S3. Approval-term hook** (not in MODLAYER-DESIGN yet; add to `src/sim/scenario/hooks.ts`, export from `index.ts`):
```ts
export interface ScenarioApprovalTerm { id: string; flag: string; label: string; term: (galaxy: Galaxy, h: Habitat) => number }
export function registerScenarioApprovalTerm(t: ScenarioApprovalTerm): () => void;           // sorted by id
export function scenarioApprovalTerms(galaxy: Galaxy, h: Habitat): number;                     // Σ terms whose flag is on
export function scenarioApprovalBreakdown(galaxy: Galaxy, h: Habitat): { label: string; value: number }[]; // UI
```
Call site: `taxes.ts empireApprovalRating`, right after `if (h.raceEventType === RaceEventType.NepthysWineVintage) num22
+= 5.0;` and before the character multiplier `num23`: `if (galaxy.scenario !== null) num22 +=
scenarioApprovalTerms(galaxy, h);` (so ColonyHappiness skills and wonders scale scenario terms like every other term).
In `calculateUnmodifiedApproval` subtract the same sum where it subtracts the other additives (read it first; mirror the
Nepthys/resource-bonus handling). **Terms are pure**: no Rnd, no mutation, only saved state — `empireApprovalRating` is
also called by the UI, AI evaluations, migration and tax code at unpredictable times.

**S4. Player decisions** (choices the player answers; AI empires never get them — each package resolves the AI side
immediately with its AI rules). `src/sim/scenario/decisions.ts`:
```ts
export interface ScenarioDecision { id: number; kind: string; empire: Empire; title: string; text: string;
  subject: unknown; payload: Record<string, unknown>; created: number; expires: number; defaultOption: string }
export interface ScenarioDecisionKind { options(galaxy, d): { id: string; label: string; enabled: boolean; hint?: string }[];
  resolve(galaxy, d, optionId): void }                // registered by kind at module load (closures are NOT saved)
export function registerScenarioDecisionKind(kind: string, k: ScenarioDecisionKind): void;
export function postScenarioDecision(galaxy, d: Omit<ScenarioDecision, 'id' | 'created'>): ScenarioDecision; // + scenarioMessage
export function scenarioPendingDecisions(galaxy, empire): readonly ScenarioDecision[];
export function resolveScenarioDecision(galaxy, empire, id, optionId): boolean;   // false: stale/unknown/disabled
export function expireScenarioDecisions(galaxy): void;   // default option at `expires`; run from the yearly tick AND
                                                          // from resolve/pending reads (no Rnd in either)
```
Saved in `scenarioState(galaxy, 'decisions', …)` (payload values: plain data or graph objects). UI:
`src/ui/scenarioDecisions.ts` polls `scenarioPendingDecisions(galaxy, player)`, pushes one stub per decision into the
stub list (`messageStubList.ts pushMessageStub` with the posted EmpireMessage as key) and opens a card with one button per
option (reuse the 16d card styling in `messagePopups.css`); hooks wrapped in `// [emergent] begin/end` markers in
`main.ts` (install/remove). Resolution calls the sim function directly.
Replay note: player decisions and actions are external commands; until 19e-1 defines player-command journaling, add
each resolution to a `scenarioState(galaxy, 'decisionLog', …)` array `{starDate, empireId, kind, decisionId, optionId}`
so a replay can re-apply them.

**S5. Rnd policy (all 19d packages).** `galaxy.rnd` is drawn only (a) in the package's yearly handler and what it
calls, (b) inside `if (scenarioFlag(galaxy, '<flag>'))` branches placed in ported functions — every such draw commented
`// RND(19dN): <what>`. Hooks inside ported code that only need to *record* something must not draw; the roll happens in
the yearly handler. Never draw in approval terms, UI queries, decision option lists or message builders. With no
scenario, or with the package's flag off: zero draws, zero state changes ⇒ `npm run repin -- --check` clean and the
standard tests untouched. Refactors of ported functions (e.g. §2.4 below) must not move any pin either.

**S6. Tests (all packages).** `test/emergent<Pkg>.test.ts` (+ `// @slow` soaks in their own file) using
`createScenarioGame(gameData, { scenario: 'emergent', flags: { <only this package's flags on> } })`; unit tests on
hand-built states where a full game is not needed. Every package adds: (1) flags-off equivalence — the `emergent`
scenario with all flags false runs 2 game years with the same tick digest (`tick/digest.ts`) as the plain seed-1 game;
(2) determinism — same seed + flags twice ⇒ same digest and same package state; (3) save round trip mid-crisis
(serialize/deserialize, run 1 more year, digest equals the unsaved run).

---------------------------------------------------------------------------------------------------------------------

## 1. Flags and params (`scenarios/emergent/scenario.json`)
| name | kind | default | meaning |
|---|---|---|---|
| `internalPolitics` | flag | true | loyalty/ambition model, plots, defections, secessions, coups |
| `livingCharacters` | flag | false | 19e-5 extension (§10); requires `internalPolitics` |
| `politicsIntensity` | param 0–3 | 1 | multiplies every plot chance (0 = model + UI only, no events) |
| `coupApprovalThreshold` | param −50–50 | −5 | empire approval average below which coups are possible |
| `secessionMinColonies` | param 2–20 | 6 | an empire needs more colonies than this to lose any to secession |

## 2. Model and sim changes (`src/sim/scenario/emergent/politics.ts` unless noted)

State: `PoliticsState { chars: Map<Character, CharacterPolitics>; lastPlotYear: Map<Empire, number>; exposed:
Set<Character>; purgeYear: Map<Empire, number> }`, `CharacterPolitics { ambition: number /*0–100, fixed*/; loyalty: number
/*0–100*/; loyaltyTrend: number /*last yearly delta*/; honoredYear: number; grievances: { year: number; cause: string;
amount: number }[] /*last 5 years, for UI and 19e-5*/ }`. Characters of pirate factions and of the independent empire are
not modelled. A dead/inactive character's entry is dropped at the next yearly tick.

1. **`characterAmbition(c: Character): number`** — pure, computed once on first sight and stored. 30 +
   `getSkillLevelTotal()/10` (cap +20) + trait table (Expansionist +10, Famous +10, EloquentSpeaker +10, Corrupt +15,
   NaturalSpaceLeader / NaturalGroundLeader +10, GoodStrategist +5, Courageous +5, Uninhibited +5, RecklessAttacker +5;
   Lawful −15, Patriot −25, Pacifist −5, Lazy −10, Measured −5, Weak −10) clamped 0–100. Leaders get ambition 0 (they
   already rule). No C# analogue (new); the trait list is `CharacterTraitType` (`Character.cs` traits).
2. **`initialLoyalty(galaxy, c): number`** — pure. 60 + (race.loyalty − 100)/2 (`data/races.ts` Loyalty, "normal = 100")
   + Patriot +25, Lawful +10, Corrupt −10, DoubleAgent −30, ForeignSpy −40; +5 when `c.race === empire.dominantRace`,
   else + `resolveStandardRaceBias(c.race, empire.dominantRace)`/10 (`raceBias.ts`, Galaxy.cs 2086). Clamp 0–100.
3. **`yearlyLoyaltyDelta(galaxy, c): { delta: number; causes: {cause, amount}[] }`** — pure; the causes feed the UI and
   grievances. Terms (each named for the UI):
   - approval: governors use `empireApprovalRating(galaxy, colony)` of their location colony, everyone else
     `colonyApprovalAverage(galaxy, empire)` (empireEvents.ts, Empire.cs 1799); delta += approval/5, clamp ±8;
   - war weariness: − `empireWarWeariness(empire)`/10 (cap −6); defeats: − 2 × `countEventsByType` of
     `SpaceBattle`/`GroundInvasion` events in the last year where the character's side lost is **not** recorded by the
     port — use `ColonyDevelopmentDecrease` (−1 each, cap −4) and `CashNegative` (−3 each, cap −6) instead;
   - leader: + leader InspiringPresence 4, − leader Demoralizing 4, − leader Paranoid 2 (`empireLeader(empire)` traits);
   - honours (§5 action) +15 once, decaying 5/yr; purges in the last 2 years −5 for every non-Patriot character;
   - drift toward `initialLoyalty` by 10% of the gap (so loyalty is not a ratchet);
   - 19d4 hook: when `refugees` is on, governors get − tension/2 of their colony (19d4 exports `colonyTension`); 19d2
     hook: when `resourceCrises` is on, governors of colonies in an active shortage get −3 (19d2 exports
     `colonyInCrisis`). Import lazily behind the flag checks so the packages stay independent.
4. **Refactor for targeted secession (ported code, zero pin movement)** in `empireEvents.ts`: split `splinterEmpire`
   after the `habitat` search into `splinterEmpireAt(galaxy, self, sourceEmpire, splinterPortion, habitat, coloniesLost)`
   (the body from `if (habitat !== null)` on, statement for statement), and `initiateEmpireSplit` into
   `initiateEmpireSplitAt(galaxy, self, splinterPortion, declareWar, seedColony: Habitat | null)` where `null` keeps the
   random-coordinate search. The faithful callers pass `null` / use the old path, so the Rnd order is unchanged. Keep the
   C# cites (Empire.1.cs 2883 / 1102) and add "split for 19d1 targeted secession; no behaviour change".
5. **`reviewPolitics(galaxy, year)`** — the yearly handler (`registerScenarioYearly({ id: 'emergent.politics', flag:
   'internalPolitics', order: 10, run })`). For every active normal empire (not pirates, not independent; the player's
   empire included), in `galaxy.empires` order, characters in `getEmpireCharacters(empire)` order:
   a) create missing entries (1, 2), apply 3, record grievances (causes < −2);
   b) instability `I = clamp(0, 2, (coupApprovalThreshold − colonyApprovalAverage)/20 + warWeariness/40 +
      (1 − gov.stability) + max(0, −leaderChangeInfluence))`; skip plots when `I = 0`, when the empire had a plot event
      in the last 2 years (`lastPlotYear`), or `politicsIntensity = 0`;
   c) plot score `P(c) = ambition/100 × (100 − loyalty)/100 × I × politicsIntensity`; the character with the highest
      P whose role allows a plot (below) rolls once: `rnd.nextDouble() < P × 0.35` → `// RND(19d1): plot roll`. Only
      one plot per empire per year. Which plot, by role and conditions (first match):
      - **coup** — FleetAdmiral/TroopGeneral (or IntelligenceAgent with Assassination ≥ 20), loyalty < 30, ambition > 60,
        approval average < `coupApprovalThreshold`, and the character is at the capital or aboard a fleet within
        2 × `galaxy.sectorSize` of it → §2.6;
      - **secession** — ColonyGovernor, loyalty < 35, empire colonies > `secessionMinColonies`, governor's colony not a
        capital, its approval < 0 or `rebelling` → §2.7;
      - **defection** — Ambassador, Scientist, IntelligenceAgent, FleetAdmiral, ColonyGovernor with loyalty < 25 and a
        valid target empire (§2.8) → §2.8;
      - otherwise **plot rumour** only: when the character is not yet `exposed`, the empire's counter-intelligence finds
        it with chance = max counter-intelligence agent `counterEspionageFactored`/200 (`// RND(19d1): exposure`) →
        `exposed.add(c)`, player gets decision `politics.plot` (§5), AI applies its rule (§4).
   Exposed characters' coups/secessions get −50% success (the government knows).
6. **`attemptCoup(galaxy, empire, c)`** — success chance `S = clamp(0.1, 0.9, 0.5 + (plotterForce − loyalForce)/(plotterForce
   + loyalForce + 1) × 0.5 − leader.getSkillLevelTotal()/400)` where plotterForce = the character's fleet
   `shipGroupTotalOverallStrengthFactor(galaxy, fleet)` (fleets/shipGroup.ts; admiral) or, for a general / agent,
   capital `troops.totalDefendStrength × (0.3 + c.getSkillLevelTotal()/200)` (the share of the garrison that follows
   them), loyalForce = the rest of the capital garrison + `shipGroupTotalOverallStrengthFactor` of the empire's other
   fleets within 2 × `galaxy.sectorSize` of the capital. One draw (`// RND(19d1): coup`).
   - Success: `changeLeader(galaxy, empire, [c], -1)` (existing coup texts; the ported function draws its own picks).
     Government: admiral/general → Military Dictatorship (id 5) if `empire.allowableGovernmentTypes` allows it, agent →
     current government kept, else `selectSuitableGovernment(galaxy, race, current, allowable)`; apply with
     `haveRevolution(galaxy, empire, empire.dominantRace, govId, 0.5)` (damage + colonies leaving as the C# does,
     Empire.10.cs 4452). News via `scenarioNews`. Every other character with loyalty > 70 gets loyalty −20 (they served
     the old regime); `lastPlotYear` set.
   - Failure: `c.kill(galaxy)` after `characterSendDeathMessage(galaxy, c, CharacterDeathType.Dismissed)`; the leader
     gains `Paranoid` (`addTrait(Paranoid, false, galaxy)`); `empire.leaderChangeInfluence = min(current, −0.3)` so the
     ported `processLeaderChangeInfluence` produces unrest; message "Coup attempt crushed".
7. **`attemptSecession(galaxy, empire, governor)`** — `initiateEmpireSplitAt(galaxy, empire, portion, declareWar,
   governorColony)` with portion = 0.1 + ambition/500 (≤ 0.3), declareWar = ambition > 70 or `raceAggressionLevel` of the
   colony's dominant race > 110 (no draw). After the split: move the governor to the new empire (as `spyDefected` does:
   remove from old `getEmpireCharacters` and location lists, push to the new, `c.empire = newEmpire`), make them its leader
   (`c.role = Leader`, `newEmpire.leader = c`; kill a leader the new empire may already have, as `changeLeader` does),
   loyalty 90. Other governors of the lost colonies move with their colony. When `refugees` is on, 19d4 is told
   (`recordRefugeeCause(galaxy, colony, 'secession')`) for colonies whose dominant race is not the new empire's.
   Uses the ported split messages (EventMessageType.EmpireSplits) plus one `scenarioNews`.
8. **`attemptDefection(galaxy, empire, c)`** — target = the known normal empire (`obtainDiplomaticRelation(empire,
   t).type !== NotMet`, t ≠ empire, t active) with the highest score = `resolveStandardRaceBias(c.race,
   t.dominantRace)` + (t at war with `empire` ? 20 : 0) + `colonyApprovalAverage(galaxy, t)`/2 (ties: lower empireId);
   the score must be > 0, else no defection this year (no draw). Move the
   character like `spyDefected` (location = target capital; `mission = null`), loyalty 70, `CharacterTransferLocation`
   event. Role effects:
   - Scientist: target gets one project from `resolveMoreAdvancedProjectsIncludeSpecial(target, empire, false)`
     (`// RND(19d1): pick`) completed with `doResearchBreakthrough(galaxy, target, node, false)` — the same pattern as
     the StealTechData completion in `espionage.ts completeIntelligenceMission`;
   - IntelligenceAgent: cancel every mission of `empire` targeting `target` (`cancelIntelligenceMission`), incident −10
     on target's evaluation of empire, `markEmpireAsRecentSpy(galaxy, empire, target)`;
   - Ambassador: `giveTerritoryMap(galaxy, empire, target)`;
   - FleetAdmiral aboard a fleet: the fleet goes too — `defectFleet(galaxy, empire, fleet, target)` (Empire.1.cs 1702);
   - ColonyGovernor: character only.
   Messages to both empires; `scenarioNews` when the character is Famous.
   Why not `createEmpireMidGame`: the ported split already builds the splinter empire faithfully (government, research
   clone, map merge, relations, ships/fleets changing sides); the mod-layer helper is for empires without a parent.
9. **Empire removal / game over.** If a coup/secession leaves the player's empire without a capital or colonies, the
   ported defeat path handles it (do not special-case). A secession needs `galaxy.nextEmpireId <
   galaxy.maximumEmpireCount` (the split checks it); otherwise downgrade to "the colony leaves the empire"
   (`leaveEmpire(galaxy, colony)`, events.ts) with the governor.

## 3. Save state
`scenarioState(galaxy, 'politics')` as above (Map keyed by Character / Empire graph objects — the graph codec handles
Maps and both classes are registered). Decisions in `'decisions'` (§S4). No change to the save format beyond
`galaxy.scenario.state`. Loading a save from before this package: state initialised lazily.

## 4. AI rules (testable)
1. An AI empire honours (§5 `honorCharacter`) its lowest-loyalty character with ambition > 60 and loyalty < 35 when
   `stateMoney ≥ 5 × cost`; at most once per character per 3 years.
2. An AI empire always arrests an exposed plotter (§5) unless the character is Famous and its approval average < −10
   (then it honours instead).
3. An AI empire never leaves an admiral with loyalty < 30 as the only fleet at its capital when it has another fleet:
   in the yearly handler it sets another fleet's `gatherPoint` to the capital (as `defectFleet` sets
   `fleet.gatherPoint = selectFleetBase(...)`, empireEvents.ts 833; the military AI then parks it there).
4. A new secessionist empire is AI-controlled; if it declared war it starts with `atWar` diplomacy as the split sets it.
5. AI empires never target the player specially: all rules are symmetric.

## 5. Player counterplay (`politicsActions.ts`; each returns `{ ok: boolean; reason?: string }`, no Rnd)
- `honorCharacter(galaxy, empire, c)` — cost `getCharacterValue(c)/2` from stateMoney (BaconCharacter value), +15
  loyalty, cooldown 3 years (`honoredYear`).
- `reassignCharacter` — existing transfer (`reviewCharacterLocation` / the intelligence screen's transfer path); a
  governor moved away loses −5 loyalty but can no longer secede with that colony.
- `arrestCharacter(galaxy, empire, c)` — only for `exposed` characters: kill with `Dismissed`, no penalty.
- `purgeCharacter(galaxy, empire, c)` — any character: kill with `Dismissed`; `purgeYear` set (−5 loyalty to all
  non-Patriots for 2 years), `leaderChangeInfluence = min(current, −0.15)` (unrest via the ported path).
- `grantAutonomy(galaxy, empire, colony)` — tax rate of the colony set to 0.05 for 5 years (store the expiry; restore via
  the ported `setColonyTaxRate` at expiry) and governor +10 loyalty.
- Decision `politics.plot` (player only): options Arrest (arrestCharacter), Honour (honorCharacter, disabled without
  money), Ignore (default at expiry = 1 year).
Warnings: a character whose loyalty drops below 35 with ambition > 60 sends one "Emergent Loyalty Warning" message per
3 years (no roll; the player sees the risk without the exact P).

## 6. UI
- Messages (`scenarioMessage`, types: GeneralWarning for warnings/rumours, GeneralBadEvent for coups/secessions against
  the player, GeneralGoodEvent for crushed coups): loyalty warning, plot rumour (decision), coup success/failure,
  defection (both sides), secession (plus the ported EmpireSplits event message). Galactic news for coups, secessions
  and Famous defections. Subject = the Character (or colony) so the card's "go to" works.
- Stub list: decisions via §S4; plain messages appear through the existing feed. `messageStubs.ts messageIconUrl`:
  inside a `// [emergent] begin/end` block, a Character subject shows the character portrait
  (`/assets/dwu/images/…/characters/<pictureFilename>`, check how intelligence.ts resolves portraits).
- Intelligence (characters) screen `src/ui/screens/intelligence.ts`: two columns Loyalty / Ambition (only when the
  flag is on; pure row builder tested), a "Politics" block in the character summary (loyalty trend and the last causes
  from `yearlyLoyaltyDelta`), buttons Honour / Arrest (exposed only) / Purge, disabled with reasons.
- Empire summary (`empireSummary.ts`): a "Stability" row = instability I (0–2) as Stable / Tense / Unstable / Crisis.
- Colonies list: governor loyalty in the governor tooltip.

## 7. Tests (`test/emergentPolitics.test.ts`, soak in `test/emergentPoliticsSoak.test.ts // @slow`)
Unit: ambition/loyalty tables (hand-built characters); loyalty delta causes and clamps; plot-role selection; coup
success formula bounds; `splinterEmpireAt` refactor — the faithful random split on seed 1 draws the same Rnd sequence
(record draw log before/after via the Random trace hook) and the pins do not move. Scenario harness: force a crisis
(set all colonies' approval low via `taxRate = 0.5`, war weariness high) on the seed-1 game with `politicsIntensity = 3`
and assert within 10 game years at least one plot outcome (coup, secession or defection) happens, a secession creates a
new empire whose leader is the former governor, a successful admiral coup sets government 5 when allowed. Player
decisions: posting, options, resolution, expiry default. Plus §S6 (1)–(3).

## 8. Acceptance criteria
- All §S6 checks pass; `npm run typecheck`, full suite green; `npm run repin -- --check` clean.
- With the flag on (standard seed-1, intensity 1, 30 game years): no exceptions, 0–3 plot outcomes per empire (log
  the counts in the soak), no empire loses its capital to a secession.
- A player can see why a character is disloyal (UI causes) and every event has a message with a working subject.

## 9. Risks
- Character list mutation during `reviewCharacterLocations` / missions: move characters only from the yearly handler.
- `changeLeader` strips the new leader's skills/traits and re-rolls them (ported behaviour) — accept; mention in the
  message text that the new ruler "consolidates power".
- The refactor in §2.4 must stay statement-identical; if the reviewer prefers, the alternative is a private copy of the
  body in politics.ts with a `// Copy of empireEvents.ts splinterEmpire` note — decide in review, not silently.
- Balance: plots every few years feel random; the intensity param and the 2-year cooldown are the knobs.

## 10. Extension: 19e-5 living characters (flag `livingCharacters`, separate task after the core)
Same state, plus `relations: Map<Character, Map<Character, number>>` (−100 rival … +100 friend, sparse), yearly:
- opinion seeds (pure): conflicting trait pairs (Pacifist×PeaceThroughStrength, Lawful×Corrupt, Tolerant×Xenophobic,
  Logical×Spiritual) −30; shared positive events in the same location (both at a colony with ColonyDevelopmentIncrease,
  both in a won battle) +10/yr; a character who replaced another (leader change, reassignment) −40 grudge;
- effects: rivals at the same location/fleet cut both skills' contribution by 10% (apply through a pure multiplier read
  where the location bonus is applied — `applyCharacterLocationBonusToOtherCharacters` path, flagged); a friend of a
  seceding governor who governs a neighbouring colony joins the secession (colonies added to `coloniesLost` via
  `splinterEmpireAt`'s count); a coup plotter's friends +20% success, rivals −20%;
- opinions as messages: each year up to 2 "voices" per player empire — a governor complaining about shortages (19d2
  on) or minorities (19d4 on), an admiral urging war against the empire its race dislikes most, an ambassador reporting
  the host's mood (`determineEmpireRelationshipFactors`, empireRelationshipFactors.ts, top factor text). Chosen by the
  largest |cause|; texts are GameText templates (the 18c local model may later rephrase them; not in scope).
UI: a "Relations" list in the character summary (friends/rivals with the reason). Tests: seeds, effects on skills,
friend joining a secession. Size: +2–3 days.

## 11. Size
Core 19d1: ~3–4 days (model + actions 1.5, split refactor + coup/defection 1, UI 1, tests/soak 0.5–1). §S shared
infrastructure: +0.5 day for whichever package lands first.
