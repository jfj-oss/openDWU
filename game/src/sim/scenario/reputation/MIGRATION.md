# 19o reputation ledger — migrating the attitude sources on the other branches

The ledger (`ledger.ts`) is the one channel for scenario attitude modifiers. The ported attitude reads it in two places
(`channel.ts` slots, filled by `ledger.ts` at import):

- `EmpireEvaluation` (diplomacy.ts) `incidentTotal()` = clamp(`_IncidentEvaluation` + incident entries, −150, 80) and
  `biasTotal()` = `_Bias` + bias entries. These feed OverallAttitude (EmpireEvaluation.cs 96 / 147),
  OverallAttitudeWithoutSystemCompetition (157) and the IncidentEvaluation / Bias getters (199 / 302).
- `PirateRelation.evaluation` (pirateRelations.ts; PirateRelation.cs 271): the pair's entries join the float sum before
  DiplomacyFactor, so they stand in for the fields that Empire.8.cs 2512 ChangePirateEvaluation would have changed.

When the flag `reputationLedger` is off, every helper below repeats the former write exactly, so pins and seeds stay
unchanged. When it is on, the source records an entry with a cause, and the attitude still adds up to the same total
(test/reputationLedger.test.ts).

## Helpers (import from `../reputation/ledger`)

| helper | flag off | flag on |
|---|---|---|
| `applyReputation(galaxy, a, b, value, { cause, source, decayPerYear?, term?, legacy? })` | `ev.incidentEvaluation = ev.incidentEvaluationRaw + value` (`legacy: 'factored'`: `ev.incidentEvaluation + value`, the same as `+=`); with `term: 'bias'` it writes `ev.bias` instead | obtains the evaluation (same side effect) and records an entry; a throwaway evaluation (pirate or independent pair) records nothing |
| `applyPirateReputation(galaxy, empire, pirate, value, evaluationType, { cause, source, decayPerYear? })` | `changePirateEvaluation(empire, pirate, value, evaluationType)` | obtains the relation and records an entry (read by `PirateRelation.evaluation`) |
| `recordReputationOr(galaxy, a, b, spec, () => oldWrite)` | runs `oldWrite` | records the entry (for a package's own standing ledger) |

- `decayPerYear` defaults to 3. That is the stock neutralization rate: Galaxy.3.cs 5009 IncidentEvaluationAnnualNeutralizationAmount, applied by Empire.8.cs 2050.
- Entries merge by (cause, term). Cause ids should be `<package>.<what>`. Add a label line
  `Reputation Cause <cause>;<text in the holder's voice>` to `scenarios/reputation/GameText.txt`.
- Actors are `Empire` objects or `ActorRef { empireId, sub? }` values. Only plain empire-to-empire pairs reach the
  ported attitude. A `sub` actor, such as `{ empireId: independent.empireId, sub: 'league:<id>' }` or `sub: 'herders'`,
  keeps a package's standing inside that package. Its readers use `reputationSum(galaxy, subActor, empire)`.
- Read-modify-write sites that must not fold the ledger into the stock field read `ev.incidentEvaluationStock` or
  `ev.biasStock`. Every `ev.incidentEvaluation = ev.incidentEvaluation ± x` / `+=` on the branches below becomes an
  `applyReputation(..., legacy: 'factored')`, so none is left.

## Already migrated on wip/s19o

| file | cause | old → new |
|---|---|---|
| emergent/espionage.ts `addIncident` (19d3; falseFlag, sanctions ×2, stolenTech, stolenTechHeld) | `espionage.*` | `ev.incidentEvaluation = ev.incidentEvaluationRaw + delta` → `applyReputation(galaxy, a, b, delta, { cause, source: '19d3' })` |
| emergent/espionageActions.ts `complyApology` | `espionage.apology` | → `applyReputation(galaxy, c.victim, offender, c.severity / 2, { cause: 'espionage.apology', source: '19d3' })` |
| emergent/politics.ts defecting agent (19d1) | `politics.defectedAgent` | → `applyReputation(galaxy, target, empire, -10.0, { cause: 'politics.defectedAgent', source: '19d1' })` |
| emergent/demographics.ts diaspora diplomacy (19d4) | `demographics.diaspora` | `evaluation.incidentEvaluation += applied` → `applyReputation(..., { decayPerYear: 0, legacy: 'factored' })` |
| charteredCompanies/charters.ts nationalisation (19c) | `charters.nationalised` | `.incidentEvaluation -= 20.0` → `applyReputation(galaxy, e, founder, -20.0, { ..., legacy: 'factored' })` |
| threats/exchange.ts collapse (19f) | `exchange.exposed` | `.bias += 20` → `applyReputation(galaxy, e, exposer, 20, { term: 'bias', decayPerYear: 0, legacy: 'factored' })` |

The 19m purges (security/security.ts) change approval only (a stability term), not attitude, so nothing needed
migrating there. charters.ts 361 (the port of BaconHabitat.cs 1126 LeaveEmpire, `+= 60`) stays a stock write that now
reads `incidentEvaluationStock`.

## To switch on the other branches (file:line on the branch named; old → new)

Each branch that merges onto wip/s19o needs the listed lines changed, plus the `applyReputation` import and a
GameText label.

### wip/s19l — 19l border incidents (lively/livelyGalaxy.ts; the same lines on wip/s19g3 and wip/s19l2)
- `livelyGalaxy.ts:320-321`
  `const ev = obtainEmpireEvaluation(galaxy, victim, aggressor); ev.incidentEvaluation = ev.incidentEvaluation - drop;`
  → `applyReputation(galaxy, victim, aggressor, -drop, { cause: 'lively.borderIncident', source: '19l', legacy: 'factored' });`
- `livelyGalaxy.ts:322-323`
  `const ev2 = obtainEmpireEvaluation(galaxy, aggressor, victim); ev2.incidentEvaluation = ev2.incidentEvaluation - drop / 2;`
  → `applyReputation(galaxy, aggressor, victim, -drop / 2, { cause: 'lively.borderIncidentCaused', source: '19l', legacy: 'factored' });`
- Ambition itself (`ambitionPressure`, the query `warReviewAttitudeRelax`) and `incidentMemory` (line 308
  `incidentCount`) are war-review inputs, not attitude writes. Nothing to switch there, but `incidentCount` could
  become `grievances(galaxy, victim, aggressor).filter((e) => e.cause === 'lively.borderIncident').length`.

### wip/s19g3 — 19g-3 humiliation / casus belli (lively/)
- `peaceTerms.ts:344,346` (humiliation)
  `const ev = obtainEmpireEvaluation(galaxy, loser, victor); … ev.incidentEvaluation = ev.incidentEvaluationRaw - drop;`
  → keep `drop` and replace the two lines with
  `applyReputation(galaxy, loser, victor, -drop, { cause: 'warGoals.humiliation', source: '19g3' });`
  (`st.humiliations` stays the pricing memory).
- `warGoals.ts:546-547` (demilitarisation breach, casus belli)
  `const ev = obtainEmpireEvaluation(galaxy, t.beneficiary, t.empire); ev.incidentEvaluation = ev.incidentEvaluationRaw - scenarioParam(galaxy, 'breachRelationDrop', 25);`
  → `applyReputation(galaxy, t.beneficiary, t.empire, -scenarioParam(galaxy, 'breachRelationDrop', 25), { cause: 'warGoals.demilBreach', source: '19g3' });`
- Peace-terms pricing (`peaceTerms.ts:96 termsValueFor`) and the war ledger can read
  `grievances(galaxy, a, b, minValue)`, for example to add the summed grievance to the price the wronged side asks.

### wip/s19d8 — 19d8 council sanctions / condemnations (emergent/council.ts)
- `council.ts:217-220` `addIncident` body: add a `cause: string` parameter, then change
  `const ev = obtainEmpireEvaluation(galaxy, a, b); ev.incidentEvaluation = ev.incidentEvaluationRaw + delta;`
  → `applyReputation(galaxy, a, b, delta, { cause, source: '19d8' });` and pass the causes at the call sites:
  `:399` `'council.leftCouncil'`, `:713` `'council.embargo'`, `:719` `'council.condemned'`, `:731`/`:732`
  `'council.recognised'`, `:747` `'council.jointDefence'`, `:814` `'council.bloc'` (a bloc's yearly bonus should use
  `decayPerYear: 0` or it will grow with each record, because it merges by cause).
- Council grievance search, `council.ts:471-506 motionCandidates`: alongside `attitudeOf(a, b) <= grievanceAttitude`,
  read `grievances(galaxy, a, b, minValue)` so that each motion carries its causes (weight + Σ|value|/2, and the text
  names the worst cause).
- The branch's copies of espionage.ts, politics.ts and demographics.ts pick up the wip/s19o migration on merge.

### wip/s19j — 19j herder standing (rimHerders/rimHerders.ts; same lines on wip/s19k2)
- `rimHerders.ts:604-605` (herders warn an intruder)
  `const ev = obtainEmpireEvaluation(galaxy, herderEmpire, e); ev.incidentEvaluation = ev.incidentEvaluationRaw - herderParam(galaxy, 'rimHerdersWarnPenalty');`
  → `applyReputation(galaxy, herderEmpire, e, -herderParam(galaxy, 'rimHerdersWarnPenalty'), { cause: 'herders.warned', source: '19j' });`
- `rimHerders.ts:93` `addStanding` body, the herder standing (not an attitude term):
  `st.standing[empireId] = (st.standing[empireId] ?? 0) + delta;`
  → `recordReputationOr(galaxy, HERDERS, { empireId }, { cause: 'herders.standing', value: delta, source: '19j', decayPerYear: 0 }, () => { st.standing[empireId] = (st.standing[empireId] ?? 0) + delta; });`
  where `HERDERS = { empireId: galaxy.independentEmpire!.empireId, sub: 'herders' }`. The standing readers then use
  `reputationOn(galaxy) ? reputationSum(galaxy, HERDERS, { empireId }) : st.standing[empireId] ?? 0`. Per-cause
  entries (kill / attack / conquest / warn / peace) are optional: give each call site its own `cause` through an extra
  parameter.

### wip/s19k2 — 19k leagues (independents/independents.ts)
- `independents.ts:891-892` (protectorate pull)
  `const ev = obtainEmpireEvaluation(galaxy, protectorate, e); ev.incidentEvaluation = ev.incidentEvaluationRaw + PULL_BONUS;`
  → `applyReputation(galaxy, protectorate, e, PULL_BONUS, { cause: 'league.protectorate', source: '19k' });`
- League standing `league.standing[id] = … ± …` at `:492`, `:499`, `:548`, `:711`, `:849`, `:855` becomes
  `recordReputationOr(galaxy, { empireId: independent.empireId, sub: \`league:${league.id}\` }, { empireId: id }, { cause: 'league.raid' | 'league.neighbour' | 'league.refused', value: ±…, source: '19k', decayPerYear: 0 }, () => { league.standing[id] = … })`,
  with the `:845` reader switched the way the herder standing reader is.

### wip/s19a2 — 19a Concord standing (rimTrade/)
- The Concord standing is a trade credit/debit ledger (common.ts `standing = credit × rate − debit`). It is not an
  attitude, so keep it there. To list its causes, mirror the convoy raid at `treasureFleet.ts:529`
  `row.debit += penalty;`
  → `recordReputationOr(galaxy, { empireId: r.empireId, sub: 'trade' }, ev.destroyer, { cause: 'concord.treasureRaid', value: -penalty, source: '19a', decayPerYear: 0 }, () => { row.debit += penalty; })`.
  If you do, the standing reader has to add the sub-actor sum while the flag is on. The simpler option is to leave
  `row.debit` as the source of truth and call `recordReputation` next to it for display only, with the `sub: 'trade'`
  actor so the ported attitude never sees it.

### wip/s19l2 — 19l-4 pirate ambition + living calendar (lively/)
- `pirateAmbition.ts:155`
  `changePirateEvaluation(empire, pirateEmpire, -penalty, PirateRelationEvaluationType.RaidsAgainstOurColonies);`
  → `applyPirateReputation(galaxy, empire, pirateEmpire, -penalty, PirateRelationEvaluationType.RaidsAgainstOurColonies, { cause: 'pirates.ambition', source: '19l4' });`
  With the flag on, the stock neutralization (PirateRelation.cs 154 NeutralizeEvaluation) no longer decays this
  value; the entry's own `decayPerYear` does that instead.
- `livingCalendar.ts:135-136` / `:137-138` (anniversary bias)
  `const ev1 = obtainEmpireEvaluation(galaxy, empire, other); ev1.bias = ev1.bias + bias;`
  → `applyReputation(galaxy, empire, other, bias, { cause: 'calendar.anniversary', source: '19l4', term: 'bias', decayPerYear: 0, legacy: 'factored' });`
  (the same for ev2 with `other, empire`).

## Readers for later packages

- `reputationSum(galaxy, a, b, term = 'all')`: a's ledger total about b.
- `reputationCauses(galaxy, a, b)`: the entries (copies), largest |value| first. The diplomacy screen's "Why they feel
  this way" block uses it through `view.ts reputationRows`.
- `grievances(galaxy, a, b, minValue = 0)`: a's negative entries about b with |value| ≥ minValue, worst first. This is
  the input for the council grievance search (19d8 `motionCandidates`), the war review (19l `warReviewAttitudeRelax`
  query handler: e.g. `+ Σ|grievance| × factor` instead of `incidentCount`) and peace-terms pricing (19g-3
  `termsValueFor`).

## Behaviour notes (flag on)

- The clamp to [−150, 80] applies to stock + ledger at read time, not after each write, so the on/off sums match
  whenever the running total stays inside the caps.
- The stock neutralization (Empire.8.cs 2050) decays only the stock field. Each entry decays once per game year by its
  own rate. A single entry at the default rate fades at the stock rate, but in yearly steps.
- `resetAttitudeLevelsAtEndOfWar` (Empire.3.cs 3316) floors only the stock field. Ledger grievances outlast the war,
  which is the point of 19o.
