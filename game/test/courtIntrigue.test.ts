// 19n court & dynasties, package 2 — court intrigue (tasks/19-mod-layer-scenarios.md §19n items 5 schemes, 6 secrets &
// hooks, 7 dynastic ties, 8 relationships, 10 claims): each scheme's effect through the ported mission lifecycle and
// its discovery through a 19m lead, a secret discovered → a hook forced and one exposed, a tie proposal accepted →
// attitude and a claim, relationships forming and their effects, claims listed with causes, flags-off byte identity and
// a save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Character } from '../src/sim/characters';
import { CharacterRole, CharacterTraitType, generateNewCharacter, getEmpireCharacters, stellarObjectCharacters } from '../src/sim/characters';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { scenarioEmit } from '../src/sim/scenario/hooks';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { listProposals, submitProposal } from '../src/sim/player/diplomacyProposals';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import {
    IntelligenceMissionOutcome,
    IntelligenceMissionType,
    calculateIntelligenceMissionSuccessChance,
    characterMission,
    newCounterIntelligenceMission,
    performIntelligenceMissions,
} from '../src/sim/espionage';
import { isPoliticalEmpire, politicsEntry, politicsYear } from '../src/sim/scenario/emergent/politics';
import { colonyLedger, detectionRolls } from '../src/sim/scenario/security/security';
import { findHiddenThing, peekSecurityState } from '../src/sim/scenario/security/registry';
import { appointToSeat, courtState, houseOf, leaderLegitimacy, plotScoreFactor, rulingHouse, seatOf } from '../src/sim/scenario/court/court';
import {
    aiSchemes,
    claimsFor,
    compatibility,
    friendFleetPoints,
    friendsTerm,
    grantHook,
    holdsCasusBelli,
    hooksOf,
    intriguePlotFactor,
    intrigueState,
    peekIntrigueState,
    proposeTie,
    registerSecrets,
    relationshipOf,
    reviewClaims,
    reviewRelationships,
    rivalLoyalty,
    schemeInclination,
    startScheme,
    tiesBetween,
    type Scheme,
} from '../src/sim/scenario/court/intrigue';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const SC = 'court-dynasties';
const ALL_OFF: Record<string, boolean> = {
    courtDynasties: false,
    courtIntrigue: false,
    internalSecurity: false,
    internalPolitics: false,
    livingCharacters: false,
    resourceCrises: false,
    espionageConsequences: false,
    refugees: false,
    rimFauna: false,
    cult: false,
    doppelgangers: false,
    hive: false,
    greyTide: false,
    threatCorporateCoup: false,
};
const ON = { ...ALL_OFF, courtDynasties: true, courtIntrigue: true, internalPolitics: true, internalSecurity: true };

function intrigueGame(params: Record<string, number> = {}): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: SC, flags: ON, params: { cultSeedYear: 200, ...params } });
}

function newChar(g: Galaxy, e: Empire, role: CharacterRole): Character {
    return generateNewCharacter(g, e, role, e.capital!).character;
}

function politicalEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e) => isPoliticalEmpire(g, e));
}

function meet(a: Empire, b: Empire): void {
    for (const [x, y] of [
        [a, b],
        [b, a],
    ] as const) {
        const r = obtainDiplomaticRelation(x, y);
        if (r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
    }
}

/** Runs `fn` with galaxy.rnd.nextDouble answering `x`. */
function withRoll<T>(g: Galaxy, x: number, fn: () => T): T {
    const rnd = g.rnd as unknown as { nextDouble: () => number };
    const orig = rnd.nextDouble;
    rnd.nextDouble = () => x;
    try {
        return fn();
    } finally {
        rnd.nextDouble = orig;
    }
}

/** A counter-intelligence agent for `e` (so its 19m detection rolls can hit). */
function watcher(g: Galaxy, e: Empire): Character {
    const a = newChar(g, e, CharacterRole.IntelligenceAgent);
    a.mission = newCounterIntelligenceMission(g, e, a);
    return a;
}

/** Makes the scheme due and runs the ported mission step for its empire with an outcome roll `roll`. */
function resolveNow(g: Galaxy, s: Scheme, roll: number): void {
    for (const a of getEmpireCharacters(s.empire)) if (a !== s.agent && a.role === CharacterRole.IntelligenceAgent) a.mission = null;
    s.mission.startDate -= s.mission.timeLength + 1;
    withRoll(g, roll, () => performIntelligenceMissions(g, s.empire));
}

/** The outcome roll for a detected / undetected success or failure (Empire.6.cs 16 bands). */
function rollFor(g: Galaxy, s: Scheme, outcome: IntelligenceMissionOutcome): number {
    const c = calculateIntelligenceMissionSuccessChance(s.empire, s.mission, s.agent);
    switch (outcome) {
        case IntelligenceMissionOutcome.SucceedNotDetect:
            return c * 0.5;
        case IntelligenceMissionOutcome.FailNotDetect:
            return c + (1 - c) * 0.1;
        case IntelligenceMissionOutcome.SucceedDetect:
            return c + (1 - c) * 0.4;
        default:
            return c + (1 - c) * 0.75; // FailDetect
    }
}

describe('flags off = faithful game', () => {
    it('the scenario with every flag off runs byte-identical to the plain seed-1 game', () => {
        const ref = cachedTickGameRun(base, { seconds: 900 });
        const { game } = createScenarioGame(base, { scenario: SC, flags: ALL_OFF });
        expect(Object.keys(game.galaxy.scenario!.flags).sort()).toEqual(Object.keys(ALL_OFF).sort());
        runGameSeconds(game, 900);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect('courtIntrigue' in game.galaxy.scenario!.state).toBe(false);
    }, 1200000);
});

describe('5. schemes', () => {
    let g: Galaxy;
    let e: Empire;
    let o: Empire;
    beforeAll(() => {
        g = intrigueGame().game.galaxy;
        e = g.playerEmpire!;
        o = politicalEmpires(g).find((x) => x !== e)!;
        meet(e, o);
        watcher(g, o);
    }, 600000);

    it('sway: our courtier gains loyalty; a foreign one warms to us and loses loyalty (a new intel mission kind)', () => {
        const agent = newChar(g, e, CharacterRole.IntelligenceAgent);
        const own = newChar(g, e, CharacterRole.Scientist);
        politicsEntry(g, own).loyalty = 30;
        const r = runPlayerCommand(g, e, 'courtScheme', [agent, 'sway', own]) as { ok: boolean; scheme: Scheme };
        expect(r.ok).toBe(true);
        expect(characterMission(agent)!.type).toBe(IntelligenceMissionType.CourtSway);
        expect(r.scheme.thingId).toBeNull(); // own target: no foreign security to evade
        resolveNow(g, r.scheme, rollFor(g, r.scheme, IntelligenceMissionOutcome.SucceedNotDetect));
        expect(r.scheme.state).toBe('succeeded');
        expect(politicsEntry(g, own).loyalty).toBe(45);
        // The agent is back on counter-intelligence (BaconEmpire.cs ResetSpyMission).
        expect(characterMission(agent)!.type).toBe(IntelligenceMissionType.CounterIntelligence);

        const foreign = newChar(g, o, CharacterRole.Scientist);
        politicsEntry(g, foreign).loyalty = 60;
        const s2 = startScheme(g, e, agent, 'sway', foreign).scheme!;
        resolveNow(g, s2, rollFor(g, s2, IntelligenceMissionOutcome.SucceedNotDetect));
        expect(politicsEntry(g, foreign).loyalty).toBe(52.5);
        expect(intrigueState(g).opinions.find((x) => x.character === foreign && x.empire === e)?.value).toBe(15);
    }, 600000);

    it('sabotage-loyalty: the target loses loyalty; the hidden scheme is found by the victim through 19m leads', () => {
        const agent = newChar(g, e, CharacterRole.IntelligenceAgent);
        const gov = newChar(g, o, CharacterRole.ColonyGovernor);
        politicsEntry(g, gov).loyalty = 50;
        const s = startScheme(g, e, agent, 'sabotageLoyalty', gov).scheme!;
        const thing = peekSecurityState(g)!.things.find((t) => t.id === s.thingId)!;
        expect(thing.kind).toBe('scheme');
        expect(thing.empire).toBe(o);
        resolveNow(g, s, rollFor(g, s, IntelligenceMissionOutcome.SucceedNotDetect));
        expect(politicsEntry(g, gov).loyalty).toBe(30);
        expect(s.discovered).toBe(false);
        for (const t of peekSecurityState(g)!.things) if (t !== thing) t.retired = true; // only this scheme is rolled for
        // Within the trace window the victim's counter-intelligence can still find it: suspected, then confirmed.
        const ev = obtainEmpireEvaluation(g, o, e);
        ev.incidentEvaluation = 0;
        withRoll(g, 0, () => detectionRolls(g));
        withRoll(g, 0, () => detectionRolls(g));
        const lead = peekSecurityState(g)!.leads.find((l) => l.thingId === thing.id && l.empire === o)!;
        expect(lead.level).toBe('confirmed');
        expect(s.discovered).toBe(true);
        expect(ev.incidentEvaluationRaw).toBe(-10);
        expect(hooksOf(g, o).some((h) => h.character === agent && h.secret === 'scheme')).toBe(true);
    }, 600000);

    it('assassinate: the target dies through the stock death path; a detected outcome gives the victim a casus belli claim', () => {
        const agent = newChar(g, e, CharacterRole.IntelligenceAgent);
        const target = newChar(g, o, CharacterRole.FleetAdmiral);
        expect(startScheme(g, e, agent, 'assassinate', newChar(g, e, CharacterRole.Scientist)).ok).toBe(false); // not our own
        const s = startScheme(g, e, agent, 'assassinate', target).scheme!;
        resolveNow(g, s, rollFor(g, s, IntelligenceMissionOutcome.SucceedDetect));
        expect(s.state).toBe('succeeded');
        expect(target.active).toBe(false);
        expect(s.discovered).toBe(true);
        const lead = peekSecurityState(g)!.leads.find((l) => l.thingId === s.thingId && l.empire === o)!;
        expect(lead.level).toBe('confirmed');
        expect(holdsCasusBelli(g, o, e)).toBe(true);
        const cb = claimsFor(g, o).find((c) => c.cause === 'casusBelli')!;
        expect(cb.colony).toBe(e.capital);
        expect(cb.strength).toBe(60);
    }, 600000);

    it('blackmail needs a hook; it forces a foreign councillor off its seat and spends the hook', () => {
        const agent = newChar(g, e, CharacterRole.IntelligenceAgent);
        const steward = newChar(g, o, CharacterRole.Scientist);
        appointToSeat(g, o, 'steward', steward);
        expect(startScheme(g, e, agent, 'blackmail', steward).reason).toBe('Needs a hook (a secret)');
        const hook = grantHook(g, e, steward, 'corruption')!;
        const s = startScheme(g, e, agent, 'blackmail', steward).scheme!;
        resolveNow(g, s, rollFor(g, s, IntelligenceMissionOutcome.SucceedNotDetect));
        expect(seatOf(g, steward)).toBeNull();
        expect(hook.used).toBe(true);
        // A failed, detected blackmail tells the victim (19m lead confirmed by the ported outcome).
        const agent2 = newChar(g, e, CharacterRole.IntelligenceAgent);
        grantHook(g, e, steward, 'defection');
        const s2 = startScheme(g, e, agent2, 'blackmail', steward).scheme!;
        resolveNow(g, s2, rollFor(g, s2, IntelligenceMissionOutcome.FailDetect));
        expect(s2.state).toBe('failed');
        expect(s2.discovered).toBe(true);
    }, 600000);

    it('AIs run schemes by traits: a scheming ruler sways its disloyal courtier', () => {
        const ai = o;
        ai.leader!.traits = [CharacterTraitType.Paranoid];
        expect(schemeInclination(ai.leader)).toBe(1.5);
        ai.leader!.traits = [CharacterTraitType.Lawful, CharacterTraitType.Pacifist, CharacterTraitType.Trusting];
        expect(schemeInclination(ai.leader)).toBeCloseTo(0, 10);
        ai.leader!.traits = [CharacterTraitType.Paranoid];
        for (const c of getEmpireCharacters(ai)) if (c.active && c.role !== CharacterRole.Leader) politicsEntry(g, c).loyalty = 90;
        for (const h of hooksOf(g, ai)) h.used = true;
        const rebel = newChar(g, ai, CharacterRole.Scientist);
        courtState(g).members.set(rebel, -1);
        const pe = politicsEntry(g, rebel);
        pe.loyalty = 10;
        pe.ambition = 90;
        newChar(g, ai, CharacterRole.IntelligenceAgent);
        const s = withRoll(g, 0, () => aiSchemes(g, ai))!;
        expect(s.kind).toBe('sway');
        expect(s.target).toBe(rebel);
    }, 600000);
});

describe('6. secrets & hooks', () => {
    it('a secret discovered by counter-intelligence → a hook; compliance forced once; a secret exposed publicly', () => {
        const g = intrigueGame().game.galaxy;
        const e = g.playerEmpire!;
        watcher(g, e);
        const c = newChar(g, e, CharacterRole.Scientist);
        c.traits.push(CharacterTraitType.Corrupt);
        registerSecrets(g);
        const thing = findHiddenThing(g, 'secret', c)!;
        expect(thing.package).toBe('19n.secret.corruption');
        withRoll(g, 0, () => detectionRolls(g));
        withRoll(g, 0, () => detectionRolls(g));
        const hook = hooksOf(g, e).find((h) => h.character === c)!;
        expect(hook.secret).toBe('corruption');
        // Force compliance: the would-be plotter abandons the plot.
        const pe = politicsEntry(g, c);
        pe.ambition = 80;
        pe.loyalty = 10;
        expect(runPlayerCommand(g, e, 'courtHook', [hook.id, 'comply', 'abandonPlot'])).toEqual({ ok: true });
        expect(pe.ambition).toBe(0);
        expect(pe.loyalty).toBe(50);
        expect(hook.used).toBe(true);
        expect(runPlayerCommand(g, e, 'courtHook', [hook.id, 'comply', 'abandonPlot'])).toEqual({ ok: false, reason: 'No such hook' });

        // Expose a foreign ruler's secret: legitimacy and the ruling house's prestige fall.
        const o = politicalEmpires(g).find((x) => x !== e)!;
        const leader = o.leader!;
        const h2 = grantHook(g, e, leader, 'corruption')!;
        const legit0 = leaderLegitimacy(g, o);
        const prestige0 = rulingHouse(g, o)!.prestige;
        expect(runPlayerCommand(g, e, 'courtHook', [h2.id, 'comply', 'abandonPlot']).ok).toBe(false); // foreign: blackmail only
        expect(runPlayerCommand(g, e, 'courtHook', [h2.id, 'expose'])).toEqual({ ok: true });
        expect(leaderLegitimacy(g, o)).toBe(legit0 - 10);
        expect(rulingHouse(g, o)!.prestige).toBe(prestige0 - 10);
        expect(houseOf(g, leader)).toBe(rulingHouse(g, o));
    }, 900000);
});

describe('7. dynastic ties', () => {
    it('a marriage accepted → attitude both ways, the spouse moves to the partner court, a claim on its succession', () => {
        const g = intrigueGame({ courtTieSpouseAccept: -1000, courtTieEnvoyAccept: -1000 }).game.galaxy;
        const [a, b] = politicalEmpires(g).filter((x) => x !== g.playerEmpire);
        meet(a, b);
        const spouse = newChar(g, a, CharacterRole.Ambassador);
        courtState(g).members.set(spouse, rulingHouse(g, a)!.id);
        const evBA = obtainEmpireEvaluation(g, b, a);
        const evAB = obtainEmpireEvaluation(g, a, b);
        evBA.incidentEvaluation = 0;
        evAB.incidentEvaluation = 0;
        const r = proposeTie(g, a, b, 'spouse');
        expect(r.accepted).toBe(true);
        expect(r.tie!.character.empire).toBe(b);
        expect(houseOf(g, r.tie!.character)).toBe(rulingHouse(g, b));
        expect(evBA.incidentEvaluationRaw).toBe(12);
        expect(evAB.incidentEvaluationRaw).toBe(12);
        const claim = claimsFor(g, a).find((c) => c.cause === 'marriage')!;
        expect(claim.colony).toBe(b.capital);
        expect(claim.house).toBe(rulingHouse(g, a));
        expect(claim.strength).toBe(30 + rulingHouse(g, a)!.prestige / 2);
        expect(tiesBetween(g, b, a).length).toBe(1);

        // The player's proposal on the ported Diplomacy conversation (a new TREATY_PROPOSAL option).
        const p = g.playerEmpire!;
        meet(p, b);
        const opts = listProposals(g, p, b).filter((x) => x.id.startsWith('SCENARIO_COURT_TIE:'));
        expect(opts.map((x) => x.id)).toEqual(['SCENARIO_COURT_TIE:envoy', 'SCENARIO_COURT_TIE:ward', 'SCENARIO_COURT_TIE:spouse']);
        const res = submitProposal(g, p, b, 'SCENARIO_COURT_TIE:envoy');
        expect(res.ok).toBe(true);
        expect(res.accepted).toBe(true);
        expect(tiesBetween(g, p, b).map((t) => t.kind)).toEqual(['envoy']);
    }, 900000);
});

describe('8. relationships & 10. claims', () => {
    it('friends / rivals form between co-located characters and have their effects; claims are listed with causes', () => {
        const g = intrigueGame({ courtRelationshipYears: 0, courtRelationshipPct: 100 }).game.galaxy;
        const e = g.playerEmpire!;
        const y = politicsYear(g);
        const gov = (stellarObjectCharacters(e.capital!) ?? []).find((c) => c.active && c.role === CharacterRole.ColonyGovernor) ?? newChar(g, e, CharacterRole.ColonyGovernor);
        const friend = newChar(g, e, CharacterRole.Scientist);
        const adm = newChar(g, e, CharacterRole.FleetAdmiral);
        gov.traits = [CharacterTraitType.Diplomat, CharacterTraitType.Generous];
        friend.traits = [CharacterTraitType.Diplomat, CharacterTraitType.Generous];
        adm.traits = [CharacterTraitType.Diplomat, CharacterTraitType.Generous];
        expect(compatibility(g, gov, friend)).toBeGreaterThan(0);
        withRoll(g, 0, () => reviewRelationships(g, y));
        expect(relationshipOf(g, gov, friend)?.kind).toBe('friend');
        // Friends at the colony: a ledger term; the admiral's friends: fleet captain bonus points.
        const term = colonyLedger(g, e.capital!).entries.find((x) => x.cause === 'friends');
        expect(term?.value).toBeGreaterThan(0);
        expect(friendsTerm(g, e.capital!)).toBe(term!.value);
        expect(friendFleetPoints(g, adm)).toBe(10);

        // Rivals: opposed and abrasive traits, a high roll.
        const r1 = newChar(g, e, CharacterRole.Scientist);
        const r2 = newChar(g, e, CharacterRole.Ambassador);
        r1.traits = [CharacterTraitType.Paranoid, CharacterTraitType.Obnoxious];
        r2.traits = [CharacterTraitType.Trusting, CharacterTraitType.Xenophobic];
        expect(compatibility(g, r1, r2)).toBeLessThan(0);
        withRoll(g, 0.9999, () => reviewRelationships(g, y + 1));
        expect(relationshipOf(g, r1, r2)?.kind).toBe('rival');
        const ist = intrigueState(g);
        ist.rels = ist.rels.filter((r) => !((r.a === r1 || r.b === r1 || r.a === r2 || r.b === r2) && !(r.a === r1 && r.b === r2) && !(r.a === r2 && r.b === r1)));
        const l0 = politicsEntry(g, r1).loyalty;
        rivalLoyalty(g);
        expect(politicsEntry(g, r1).loyalty).toBe(l0 - 3);
        // A rival in power: the other plots harder.
        expect(intriguePlotFactor(g, e, r1)).toBe(1);
        appointToSeat(g, e, 'chancellor', r2);
        expect(intriguePlotFactor(g, e, r1)).toBe(1.5);

        // Claims: a lost colony (former ownership), recognized by a chancellor; a claimed colony's governor plots harder.
        const o = politicalEmpires(g).find((x) => x !== e)!;
        const colony = o.colonies.find((h) => h !== o.capital) ?? o.capital!;
        scenarioEmit(g, 'colonyOwnerChanged', { colony, from: e, to: o });
        let claims = claimsFor(g, e);
        expect(claims.map((c) => [c.colony, c.strength, c.cause])).toEqual([[colony, 50, 'former']]);
        reviewClaims(g);
        claims = claimsFor(g, e);
        expect(claims[0].recognized).toBe(true);
        expect(claims[0].strength).toBe(50 - 5 + 10);
        const ogov = generateNewCharacter(g, o, CharacterRole.ColonyGovernor, colony).character;
        expect(intriguePlotFactor(g, o, ogov)).toBeCloseTo(1.55, 10);
        const f1 = plotScoreFactor(g, o, ogov);
        const saved = ist.claims;
        ist.claims = [];
        expect(f1 / plotScoreFactor(g, o, ogov)).toBeCloseTo(1.55, 10);
        ist.claims = saved;
    }, 900000);
});

describe('save round trip', () => {
    function saveText(game: Game): string {
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(game.galaxy.nowMs);
        return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: SC, flags: ON, params: {} } });
    }

    it('schemes (with their missions), hooks, ties and claims survive save / load and the runs match', () => {
        const a = intrigueGame({ courtTieEnvoyAccept: -1000 });
        const g = a.game.galaxy;
        const e = g.playerEmpire!;
        const o = politicalEmpires(g).find((x) => x !== e)!;
        meet(e, o);
        const agent = newChar(g, e, CharacterRole.IntelligenceAgent);
        const target = newChar(g, o, CharacterRole.Scientist);
        startScheme(g, e, agent, 'sabotageLoyalty', target);
        grantHook(g, e, target, 'corruption');
        proposeTie(g, e, o, 'envoy');
        scenarioEmit(g, 'colonyOwnerChanged', { colony: o.capital!, from: e, to: o });
        const text = saveText(a.game);
        const loaded = deserializeGame(text, a.gameData);
        const g2 = loaded.game.galaxy;
        const s1 = intrigueState(g);
        const s2 = peekIntrigueState(g2)!;
        expect(s2.schemes.length).toBe(s1.schemes.length);
        expect(s2.schemes[0].mission).toBe(characterMission(s2.schemes[0].agent));
        expect(s2.hooks.map((h) => `${h.character.name}:${h.secret}`)).toEqual(s1.hooks.map((h) => `${h.character.name}:${h.secret}`));
        expect(s2.ties.map((t) => `${t.kind}:${t.character.name}`)).toEqual(s1.ties.map((t) => `${t.kind}:${t.character.name}`));
        expect(claimsFor(g2, g2.playerEmpire!).length).toBe(claimsFor(g, e).length);
        runGameSeconds(a.game, 700);
        runGameSeconds(loaded.game, 700);
        expect(stateDigest(loaded.game.galaxy)).toBe(stateDigest(a.game.galaxy));
        expect(saveText(loaded.game)).toBe(saveText(a.game));
    }, 1200000);
});
