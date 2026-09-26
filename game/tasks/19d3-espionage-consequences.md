# 19d3 — Espionage consequences: diplomatic crises, stolen-tech proliferation, false flags

Scenario package on the mod layer (`tasks/MODLAYER-DESIGN.md`). Accepted idea 19d-3 (`tasks/19-mod-layer-scenarios.md`):
exposed agents → diplomatic crises; stolen tech proliferates; false-flag missions start wars between rivals. Shared
infrastructure (scenario folder, approval-term hook, player decisions, Rnd policy, common tests) is **§S of
`tasks/19d1-internal-politics.md`**; if it is not in your base yet, implement it exactly as written there.

## Read first
`CLAUDE.md`; `tasks/MODLAYER-DESIGN.md`; `tasks/19d1-internal-politics.md` §S; `tasks/M4-agent-brief.md` rules 1–3, 5, 8;
`tasks/UI-agent-brief.md` for the UI part. Then the ported espionage and diplomacy:
- `src/sim/espionage.ts` — `IntelligenceMissionType` (SabotageConstruction, StealGalaxyMap, StealOperationsMap,
  StealTechData, SabotageColony, DeepCover, InciteRevolution, CounterIntelligence, StealTerritoryMap,
  AssassinateCharacter, DestroyBase), `IntelligenceMissionOutcome` (SucceedNotDetect, SucceedDetect, FailNotDetect,
  FailDetect, Capture); `performIntelligenceMissions` (Empire.5.cs 5597; the outcome switch ~1405–1500: `num17 =
  min(30, difficulty/8)` incident, `applyIncident` → `incidentEvaluation −= num17` on the target's evaluation of `self`
  or the pirate relation's `evaluationDetectedIntelligenceMissions`, `lowerCivility`, `markEmpireAsRecentSpy`, the
  "Enemy Agent …" messages to the target); `completeIntelligenceMission` (Empire.6.cs 117; StealTechData:
  `resolveMoreAdvancedProjectsIncludeSpecial` pick + progress/`doResearchBreakthrough`); `assignSpecialMissions`,
  `determineSabotageMission`, `assignAgentForSabotageMission`, `canAssignIntelligenceMissionAgainstEmpire`,
  `calculateIntelligenceMissionSuccessChance`, `determineIntelligenceMissionOutcome`, `newIntelligenceMission*`,
  `IntelligenceMission` (characters.ts, a registered save class), `resolveKnownCharacters`.
- `src/sim/espionagePrisoners.ts` — Bacon captured spies, prisons, ransom, `spyDefected`, `getCharacterValue`.
- `src/sim/diplomacy.ts` — `EmpireEvaluation` (`incidentEvaluation` / `incidentEvaluationRaw`, `overallAttitude`,
  `diplomacyFactor`), `obtainEmpireEvaluation`, `obtainDiplomaticRelation`, `DiplomaticRelationType`.
- `src/sim/diplomacyTick.ts` — `evaluatePoliticalSituation` (~1224: the AI already sends `StopMissionsAgainstUs` to
  `recentSpyingEmpires` when attitude < caution − aggression, 2-in-3), `reviewDiplomaticStrategies` (Empire.8.cs 66: war
  decisions from evaluations), `declareWar`, `startTradeSanctions` / `endTradeSanctions`, `changeDiplomaticRelation`,
  `getAmbassadorsForEmpire`, `setCivilityRating`, `cautionLevel` / `aggressionLevel`.
- `src/sim/empireRelationshipFactors.ts determineEmpireRelationshipFactors` (Empire.7.cs 4164) — what the diplomacy
  screen shows ("Our past dealings with you have been terrible" = `incidentEvaluationRaw`).
- `src/sim/empireEvents.ts randomEventUncoverPirateAttackFunding` (Empire.1.cs 1590) — the ported model of an exposed
  covert act (incident −15, civility −3, threat message); mirror its texts/effects for exposures.
- `src/sim/tradeItems.ts` — `giveTradeableItem` (Galaxy.4.cs 3857; the ResearchProject case),
  `resolveTradeableItemsResearchProjects` (4305), `valueResearchProjectForEmpire` (4551), `tradeItems` (Empire.7.cs 2576,
  AI trading), `evaluateTradeOffer`.
- `src/sim/researchTick.ts doResearchBreakthrough`; `researchSystem.ts` (tech tree, `techTreeGetEquivalent` in tradeItems).

C# analogues ($C = `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded`): `DistantWorlds.Types/Empire.5.cs`
4147–6110 (PerformIntelligenceMissions 5597, AssignSpecialMissions), `Empire.6.cs` 16–343 (DetermineIntelligenceMissionOutcome,
CalculateIntelligenceMissionSuccessChance, CompleteIntelligenceMission 117), `Empire.10.cs` 16 MarkEmpireAsRecentSpy,
`Empire.1.cs` 1590 RandomEventUncoverPirateAttackFunding, `Empire.8.cs` 66 ReviewDiplomaticStrategies, `Empire.7.cs`
4164 DetermineEmpireRelationshipFactors and 2576 TradeItems, `Galaxy.4.cs` 3857 GiveTradeableItem;
`BaconDistantWorlds/BaconEmpire.cs` 43/88 (PerformIntelligenceMission, outcome override), `BaconHabitat.cs` 706 SpyDefected.

## 1. Flags and params (`scenarios/emergent/scenario.json`)
| name | kind | default | meaning |
|---|---|---|---|
| `espionageConsequences` | flag | true | crises, tech provenance, false flags |
| `crisisSeverityThreshold` | param 0–60 | 12 | incident size (num17) from which an exposure opens a crisis |
| `falseFlagAiChance` | param 0–1 | 0.3 | chance an AI frames a third empire on an eligible mission |
| `techLeakChance` | param 0–1 | 0.25 | yearly chance a stolen tech is resold by its thief |

## 2. Model and sim changes (`src/sim/scenario/emergent/espionage.ts` unless noted)

State `EspionageState { crises: SpyCrisis[]; frames: Map<IntelligenceMission, Empire>; stolen: StolenTech[];
pendingLeaks: { tech: StolenTech; holder: Empire; year: number }[]; nextId: number }`;
`SpyCrisis { id; offender: Empire; victim: Empire; severity: number; cause: string; agentName: string; opened: number
/*starDate*/; deadline: number; stage: 'demand' | 'sanctions' | 'war' | 'resolved'; demand: 'apology' | 'reparations' |
'recall'; amount: number }`; `StolenTech { projectId: number; thief: Empire; victim: Empire; year: number; holders:
Empire[] }`.

### A. Exposed agents → diplomatic crises
1. **Hook (no Rnd)** in `performIntelligenceMissions`, cases `Capture`, `FailDetect`, `SucceedDetect`, right after
   `applyIncident()`: `if (scenarioFlag(galaxy, 'espionageConsequences')) recordExposure(galaxy, blamed, targetEmpire,
   mission3, character3, num17, outcome)` (`blamed` = §C4; = `self` without a frame). Pirate targets/offenders are
   ignored (they already have `evaluationDetectedIntelligenceMissions`).
2. **Crisis opening** (yearly handler §2.9 — no crisis opens mid-tick): exposures of the last year per (offender, victim)
   pair summed; severity = Σ num17 × type weight (AssassinateCharacter 2, DestroyBase 2, InciteRevolution 2,
   SabotageColony 1.5, others 1; Capture ×1.5 — a captured agent is proof). A pair at war is skipped. severity ≥
   `crisisSeverityThreshold` and no open crisis for the pair ⇒ open one: demand = `recall` (severity < 25), `apology`
   (< 40), else `reparations` with amount = min(offender.stateMoney × 0.2, severity × 1000); deadline = 1 year.
   Texts reuse the tone of `Uncover Pirate Attack Funding Against Us Threaten`; the victim's ambassadors to the offender
   are recalled (characters from `getAmbassadorsForEmpire(getEmpireCharacters(victim), offender)` transferred home via
   `completeLocationTransfer(victim.capital, galaxy)`), `scenarioNews` when severity ≥ 40.
3. **Offender responses** (`espionageActions.ts`, no Rnd): `complyRecall(galaxy, offender, crisis)` — cancel every
   mission of offender against victim (`cancelIntelligenceMission`); `complyApology` — offender civility −2
   (`setCivilityRating`), victim incident +severity/2 (restores part of the damage); `complyReparations` — stateMoney
   transfer (fails without money); `refuse`. Complying resolves the crisis; any new exposure of the same pair while the
   crisis is open counts as refusing.
4. **Escalation** (yearly, at the deadline): refused/ignored → stage `sanctions`: `startTradeSanctions(galaxy, victim,
   offender)` when their relation allows it (the AI path the ported code uses), incident −severity/2 extra; another year
   of refusal/exposures → stage `war`: the victim `declareWar(galaxy, victim, offender)` **only if** its AI would also
   accept war now: `obtainEmpireEvaluation(victim → offender).overallAttitude < cautionLevel(victim) −
   aggressionLevel(victim) − 20` and the victim is not weaker (`determineRelativeStrength` ≥ 0.8); otherwise the crisis
   stays at `sanctions` and decays (resolved after 3 quiet years). No Rnd in escalation: the evaluations carry the story.
   The player as victim is never auto-escalated: they get the decision (§5).

### B. Stolen-tech proliferation
5. **Provenance (no Rnd)** — in `completeIntelligenceMission`, `case T.StealTechData`, after the project is resolved:
   `if (scenarioFlag(...)) recordStolenTech(galaxy, self, mission.targetEmpire, researchNode)`; holders = [thief].
6. **Third-party spread (no Rnd at the call site)** — in `giveTradeableItem`, `case TradeableItemType.ResearchProject`:
   `if (scenarioFlag(...)) recordTechTransfer(galaxy, giver, receiver, node)`: when the project is a recorded stolen
   tech held by `giver`, add receiver to holders and queue a pending leak (the victim may notice).
7. **Black-market resale** (yearly handler): for each stolen tech younger than 10 years, thief AI only, `rnd.nextDouble()
   < techLeakChance` (`// RND(19d3): leak roll`) ⇒ sell to the buyer = the known normal empire lacking the project with
   the highest `valueResearchProjectForEmpire`, not at war with the thief, not the victim, ties lower empireId; payment
   = 0.5 × that value, applied with `giveTradeableItem` for both items (ResearchProject and Money) so the ported
   bookkeeping runs (and hook 6 records it). Pirate factions can be buyers when they know the thief (they pay from
   stateMoney; research projects are tradeable to them in the port? — check `resolveTradeableItemsResearchProjects`; if
   not, skip pirates).
8. **Discovery** (yearly handler): per pending leak, the victim notices with chance = 0.3 + its best counter-intelligence
   agent's `counterEspionageFactored`/200 (`// RND(19d3): leak discovery`) ⇒ incident −10 on victim → holder and −15 on
   victim → thief, message "Emergent Stolen Tech Spread" to victim (and to the player if thief/holder), counts as an
   exposure of the thief for §A (severity 10).

### C. False-flag missions
9. **Framing.** `setMissionFrame(galaxy, mission, framed: Empire)` stores `frames.set(mission, framed)` for missions of
   types SabotageColony, SabotageConstruction, DestroyBase, AssassinateCharacter, InciteRevolution against a normal
   empire; framed ≠ originator, ≠ target, framed known to the target. Cleared when the mission ends (hook in
   `cancelIntelligenceMission` and at outcome time).
10. **AI framing (Rnd only in the flagged branch)** — in `assignAgentForSabotageMission`, after the mission is created
   and assigned: `if (scenarioFlag(...)) maybeFrame(galaxy, self, targetEmpire, mission)`: candidates F = normal empires
   known to both with `obtainEmpireEvaluation(target → F).overallAttitude < 0` and `obtainEmpireEvaluation(self →
   F).overallAttitude < 0`, F not allied with self (no MutualDefense/FreeTrade relation); best = lowest target → F
   attitude; frame when `rnd.nextDouble() < falseFlagAiChance` (`// RND(19d3): frame roll`, drawn only when a candidate
   exists).
11. **Attribution at outcome** — in `performIntelligenceMissions` before `empireEvaluation2` is obtained:
    `const blamed = scenarioFlag(galaxy, 'espionageConsequences') ? falseFlagAttribution(galaxy, self, targetEmpire,
    mission3, character3, outcome) : self;` and use `blamed` for `obtainEmpireEvaluation(galaxy, targetEmpire, blamed)`,
    `markEmpireAsRecentSpy(galaxy, blamed, targetEmpire)` and the empire name in the three "Enemy Agent …" target-side
    messages; `lowerCivility` stays on the true empire only when the frame is seen through. With the flag off `blamed ===
    self` and the code path is statement-identical (pins unchanged). `falseFlagAttribution`: no frame ⇒ self (no draw);
    with a frame: seen-through chance = clamp(0.05, 0.95, 0.2 + target best counter-intelligence
    `counterEspionageFactored`/150 − agent `concealmentFactored`/200 + (outcome Capture ? 0.4 : 0)) (`// RND(19d3):
    frame detection`). Not seen ⇒ return framed: the victim's incident lands on the framed empire (×1.5 — it is an
    outrage from a "known" rival); the framed empire gets "Emergent Framed Rumour" if it has any counter-intelligence
    agent. Seen through ⇒ return self with double incident (apply `applyIncident` twice) + incident −20 on framed →
    self (the framed empire learns it was used) + `scenarioNews` "Emergent False Flag Exposed".
12. **Wars between rivals** emerge through the ported AI: incidents move `overallAttitude`, and
    `reviewDiplomaticStrategies` / §A4 escalation turn them into sanctions and war. No direct war trigger.

13. **`reviewEspionage(galaxy, year)`** — yearly handler (`registerScenarioYearly({ id: 'emergent.espionage', flag:
    'espionageConsequences', order: 30, run })`): open crises (2), escalate/decay (4), AI responses (§4), leaks (7, 8),
    expire frames of dead missions, `expireScenarioDecisions`. Order: crises by id, stolen techs by list order.
14. **Public accessors** (pure): `empireSpyCrises(galaxy, e)`, `stolenTechsOf(galaxy, e)`, `missionFrame(galaxy, m)`.

## 3. Save state
`scenarioState(galaxy, 'espionage')` (IntelligenceMission / Empire graph objects, numbers, strings). Frames keyed by
IntelligenceMission — missions are on characters and saved in the graph; a frame whose mission is gone is dropped at
the next yearly tick.

## 4. AI rules (testable)
1. An AI offender complies with a crisis when `overallAttitude(offender → victim) > 0` or the victim is ≥ 1.5× stronger
   (`determineRelativeStrength`), choosing the cheapest demand it can afford; otherwise it refuses.
2. An AI victim never escalates to war against an empire it has a MutualDefensePact with; it escalates to sanctions only
   when the relation type is not already TradeSanctions/War.
3. An AI thief never resells a stolen tech to the victim or to the victim's MutualDefense allies.
4. An AI never frames an empire it has a treaty stronger than None with (rule of §C10), and never frames the player's
   empire more than once per 5 years (avoids feeling targeted; symmetric cap for all framed empires: once per 5 years).
5. AI mission assignment otherwise unchanged (the frame is added after the ported assignment).

## 5. Player-facing
- **Player as offender**: decision `espionage.demand` (options per demand: Recall agents / Apologise / Pay N credits
  (disabled without money) / Refuse; default Refuse at the deadline). Texts name the crisis cause ("agent NAME captured
  while sabotaging …").
- **Player as victim**: decision `espionage.response` when a crisis would open: Demand recall / Demand apology / Demand
  reparations / Impose sanctions now / Ignore; at the deadline, if refused, a second decision: Sanctions / Declare war /
  Let it go.
- **False flags**: the Intelligence screen's mission form (`src/ui/screens/intelligence.ts`, pnlCharacterMission
  logic) gets an optional "Blame" select for eligible mission types (known empires, pure option builder tested);
  `setMissionFrame` on confirm. Player-framed missions follow the same detection rule.
- Messages: exposures already produce the ported "Enemy Agent …" messages; add crisis opened/escalated/resolved
  (GeneralWarning / GeneralBadEvent / GeneralGoodEvent, subject = offender or victim empire), stolen-tech spread, framed
  rumour, false flag exposed (news).

## 6. UI
- Stub list/popups via §S4 and the existing feed.
- Diplomacy screen (`diplomacyScreen.ts`): per empire an "Incidents" block — open crisis (stage, demand, deadline),
  recent exposures both ways (last 3 years), stolen techs involving the pair. Pure row builders, tested.
- Intelligence screen: Blame select (above); a mission row shows "(false flag: EMPIRE)" for the player's framed missions.
- Research screen: a "stolen" marker on projects the player acquired by theft (tooltip: from whom, holders).

## 7. Tests (`test/emergentEspionage.test.ts`, soak `test/emergentEspionageSoak.test.ts // @slow`)
Unit: severity weights; demand choice; escalation gates (war only with the attitude + strength conditions); AI comply
rule; frame candidate selection; `falseFlagAttribution` bounds (with a stub Random). Harness: force three captured
SabotageColony missions of empire A against B on seed 1 (set up the missions via the ported constructors and force the
outcome through `determineIntelligenceMissionOutcome`'s inputs, or call the outcome block helper) ⇒ a crisis opens next
year; A refuses (AI rule) ⇒ sanctions the year after. False flag: A frames C against B, detection forced off ⇒ B's
evaluation of C drops and not of A; forced on ⇒ double incident on A. Proliferation: a StealTechData completion records
provenance; a later `giveTradeableItem` of that project to C records the holder. Plus §S6 (1)–(3), and a pin test that
the refactored outcome block (`blamed`) is statement-identical with the flag off (Rnd draw log unchanged over 2 years).

## 8. Acceptance criteria
- §S6 checks; typecheck and full suite green; `npm run repin -- --check` clean.
- 30-year soak with the flag on: at least one crisis and one stolen-tech transfer on seed 1; crises never open between
  empires at war; no exceptions.
- Statistical check (soak, 3 seeds): with `falseFlagAiChance = 1`, framed pairs reach sanctions or war more often than
  unframed pairs of similar attitude (log the counts; assert "more than zero framed-caused sanctions").

## 9. Risks
- The outcome block in `performIntelligenceMissions` is long and ported line-for-line; the `blamed` edit must be minimal
  (one variable, three uses) — review it against Empire.5.cs 5890–5990.
- Bacon prisons (espionagePrisoners.ts) keep captured agents alive and ransom them between AIs: a ransomed agent does
  not remove the exposure (count it once at capture).
- Research projects may not be tradeable to pirates; check before offering them as buyers.
- Too many crises make diplomacy noisy: the threshold param and the one-crisis-per-pair rule are the knobs.

## 10. Size
~3 days (crises 1, proliferation 0.5, false flags 0.75, UI 0.5, tests 0.5).
