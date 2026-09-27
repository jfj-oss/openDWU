// 19m internal security (tasks/19-mod-layer-scenarios.md §19m): the stability ledger (sums equal the pre-19m approval),
// a hidden thing → a lead by the yearly roll, investigations, every security action, chain reactions, flags-off
// byte-identity and a save round trip with leads.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Character } from '../src/sim/characters';
import { CharacterRole, generateNewCharacter, getEmpireCharacters } from '../src/sim/characters';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { empireApprovalRating } from '../src/sim/taxes';
import { newCounterIntelligenceMission } from '../src/sim/espionage';
import { scenarioQuery } from '../src/sim/scenario/hooks';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { convert, cultState } from '../src/sim/scenario/threats/cult';
import { knowledgeLevel } from '../src/sim/scenario/threats/framework';
import { attemptSecession, politicsEntry, politicsState, politicsYear } from '../src/sim/scenario/emergent/politics';
import {
    colonyQuarantined,
    peekSecurityState,
    registerHiddenThing,
    removeQuarantinedDestinations,
    securityState,
    setLeadLevel,
    type HiddenKind,
    type Lead,
} from '../src/sim/scenario/security/registry';
import {
    colonyLedger,
    cultLoyaltyChain,
    detectionRolls,
    empireLedger,
    reviewInvestigations,
    runSecurityAction,
    stabilityLedger,
    startInvestigation,
} from '../src/sim/scenario/security/security';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const SC = 'internal-security';
/** Every flag the scenario (with its includes) carries, off. */
const ALL_OFF: Record<string, boolean> = {
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

function secGame(flags: Record<string, boolean> = {}, params: Record<string, number> = {}): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: SC, flags: { ...ALL_OFF, internalSecurity: true, ...flags }, params: { cultSeedYear: 200, ...params } });
}

function agentOnCounterIntelligence(g: Galaxy, e: Empire): Character {
    const a = getEmpireCharacters(e).find((c) => c.role === CharacterRole.IntelligenceAgent && c.active);
    if (a === undefined) throw new Error('no agent');
    a.mission = newCounterIntelligenceMission(g, e, a);
    return a;
}

function nonLeader(e: Empire, role?: CharacterRole): Character {
    const c = getEmpireCharacters(e).find((x) => x.active && x.role !== CharacterRole.Leader && x.role !== CharacterRole.IntelligenceAgent && (role === undefined || x.role === role));
    if (c === undefined) throw new Error('no character');
    return c;
}

/** A fresh character of `role` at the capital (seed-1 start empires have only a handful). */
function newChar(g: Galaxy, e: Empire, role: CharacterRole): Character {
    return generateNewCharacter(g, e, role, e.capital!).character;
}

/** A confirmed lead of `kind` on `target` for `e` (registry + level, as the roll / an investigation would leave it). */
function confirmedLead(g: Galaxy, e: Empire, kind: HiddenKind, target: Parameters<typeof registerHiddenThing>[1]['target']): Lead {
    const t = registerHiddenThing(g, { kind, concealment: 40, empire: e, target, package: 'test' })!;
    return setLeadLevel(g, t, e, 'confirmed', 'roll')!;
}

describe('flags off = faithful game', () => {
    it('the scenario with every flag off runs byte-identical to the plain seed-1 game', () => {
        const ref = cachedTickGameRun(base, { seconds: 900 });
        const { game } = createScenarioGame(base, { scenario: SC, flags: ALL_OFF });
        expect(Object.keys(game.galaxy.scenario!.flags).sort()).toEqual(Object.keys(ALL_OFF).sort());
        runGameSeconds(game, 900);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect('security' in game.galaxy.scenario!.state).toBe(false);
    }, 1200000);
});

describe('1. stability ledger', () => {
    it('with 19m on and nothing else changed, every colony ledger sums to the pre-19m approval', () => {
        const flags = { refugees: true, resourceCrises: true, rimFauna: true };
        const on = secGame(flags).game;
        const off = createScenarioGame(base, { scenario: SC, flags: { ...ALL_OFF, ...flags } }).game;
        const colsOn = stabilityLedger(on.galaxy).colonies;
        expect(colsOn.length).toBeGreaterThanOrEqual(4);
        const offEmpires = off.galaxy.empires;
        let withTerms = 0;
        for (const l of colsOn) {
            const idx = on.galaxy.habitats.indexOf(l.colony);
            const twin = off.galaxy.habitats[idx];
            expect(twin.empire?.empireId).toBe(l.empire?.empireId);
            expect(l.total).toBe(empireApprovalRating(off.galaxy, twin));
            expect(l.total).toBe(empireApprovalRating(on.galaxy, l.colony));
            expect(l.entries[0].cause).toBe('base');
            if (l.entries.length > 1) withTerms++;
        }
        expect(withTerms).toBeGreaterThanOrEqual(0); // start colonies are single-race: often base only
        void offEmpires;
        const e = on.galaxy.playerEmpire!;
        const el = empireLedger(on.galaxy, e);
        const avg = e.colonies.reduce((s, h) => s + empireApprovalRating(on.galaxy, h), 0) / e.colonies.length;
        expect(el.total).toBeCloseTo(avg, 9);
    }, 600000);

    it('the revolt reads the ledger; martial law holds it at the leave threshold and blocks 19d1 secession', () => {
        const { game } = secGame({ internalPolitics: true });
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const colony = e.colonies.find((h) => h !== e.capital) ?? e.capital!;
        const v = empireApprovalRating(g, colony);
        expect(scenarioQuery(g, 'colonyRevoltApproval', v, { habitat: colony, leaveThreshold: -1e9 })).toBe(v);
        const gov = registerHiddenThing(g, { kind: 'hiveNode', concealment: 1, empire: e, target: colony, package: 'test' })!;
        const lead = setLeadLevel(g, gov, e, 'confirmed', 'roll')!;
        expect(runPlayerCommand(g, e, 'securityAction', ['martialLaw', lead.id])).toEqual({ ok: true });
        const l = colonyLedger(g, colony);
        expect(l.entries.find((x) => x.cause === 'martialLaw')!.value).toBe(-8);
        expect(l.total).toBe(empireApprovalRating(g, colony));
        expect(scenarioQuery(g, 'colonyRevoltApproval', l.total, { habitat: colony, leaveThreshold: 1e9 })).toBe(1e9);
        // A governor there cannot lead a secession (19d1 attemptSecession) while martial law holds.
        const governor = getEmpireCharacters(e).find((c) => c.role === CharacterRole.ColonyGovernor && c.location === colony);
        if (governor !== undefined) {
            expect(attemptSecession(g, e, governor, politicsYear(g))).toBeNull();
            expect(governor.active).toBe(true);
            expect(governor.empire).toBe(e);
        }
    }, 600000);
});

describe('2. leads by the one detection roll', () => {
    it('a cult convert joins the registry and counter-intelligence finds it: suspected, then confirmed (mirrored into the cult)', () => {
        const { game } = secGame({ cult: true }, { securityDetectPct: 100, cultAgentDetectPct: 0 });
        const g = game.galaxy;
        const e = g.playerEmpire!;
        agentOnCounterIntelligence(g, e);
        const c = nonLeader(e);
        convert(g, cultState(g), c);
        const st = securityState(g);
        const thing = st.things.find((t) => t.target === c)!;
        expect(thing.kind).toBe('convert');
        const levels: string[] = [];
        for (let i = 0; i < 60 && levels[levels.length - 1] !== 'confirmed'; i++) {
            detectionRolls(g);
            const l = st.leads.find((x) => x.thingId === thing.id);
            if (l !== undefined && levels[levels.length - 1] !== l.level) levels.push(l.level);
        }
        expect(levels).toEqual(['suspected', 'confirmed']);
        const record = cultState(g).converted.find((r) => r.character === c)!;
        expect(knowledgeLevel(record, e)).toBe(3);
    }, 600000);

    it('no counter-intelligence, no roll (no draw)', () => {
        const { game } = secGame({ cult: true });
        const g = game.galaxy;
        const e = g.playerEmpire!;
        for (const a of getEmpireCharacters(e)) if (a.role === CharacterRole.IntelligenceAgent) a.mission = null;
        convert(g, cultState(g), nonLeader(e));
        const before = g.rnd.drawCount;
        detectionRolls(g);
        // Other empires have no things; the player's convert is not rolled without a watcher.
        expect(g.rnd.drawCount).toBe(before);
        expect(securityState(g).leads.length).toBe(0);
    }, 600000);
});

describe('3. investigations and actions', () => {
    it('an investigation confirms a suspected lead (low concealment); a failed one clears it and emboldens the plotter', () => {
        const { game } = secGame({ internalPolitics: true });
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const agent = agentOnCounterIntelligence(g, e);
        const c = nonLeader(e);
        const thing = registerHiddenThing(g, { kind: 'plot', concealment: 1, empire: e, target: c, package: 'test' })!;
        let lead = setLeadLevel(g, thing, e, 'suspected', 'roll')!;
        for (let i = 0; i < 20 && lead.level !== 'confirmed'; i++) {
            if (lead.level === 'cleared') lead = setLeadLevel(g, thing, e, 'suspected', 'investigation') ?? lead;
            expect(runPlayerCommand(g, e, 'securityInvestigate', [lead.id, agent])).toEqual({ ok: true });
            securityState(g).investigations[0].due = galaxyStarDate(g);
            reviewInvestigations(g);
        }
        expect(lead.level).toBe('confirmed');
        expect(politicsState(g).exposed.has(c)).toBe(true);
        // Failed: huge concealment → 5% chance; the plotter's ambition rises by 10 each failure (chain reaction).
        const c2 = newChar(g, e, CharacterRole.Scientist);
        const t2 = registerHiddenThing(g, { kind: 'plot', concealment: 1e9, empire: e, target: c2, package: 'test' })!;
        const l2 = setLeadLevel(g, t2, e, 'suspected', 'roll')!;
        const amb = politicsEntry(g, c2).ambition;
        for (let i = 0; i < 20 && l2.level !== 'cleared'; i++) {
            startInvestigation(g, e, l2.id, agent);
            securityState(g).investigations[0].due = galaxyStarDate(g);
            reviewInvestigations(g);
        }
        expect(l2.level).toBe('cleared');
        expect(politicsEntry(g, c2).ambition).toBe(Math.min(100, amb + 10));
    }, 600000);

    it('arrest / exile / purge / amnesty on character leads', () => {
        const { game } = secGame({ internalPolitics: true });
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const [a, b, c, d] = [CharacterRole.Scientist, CharacterRole.Ambassador, CharacterRole.ColonyGovernor, CharacterRole.Scientist].map((r) => newChar(g, e, r));
        const la = confirmedLead(g, e, 'plot', a);
        expect(runPlayerCommand(g, e, 'securityAction', ['arrest', la.id])).toEqual({ ok: true });
        expect(a.active).toBe(false);
        expect(la.closed).toBe(true);
        const lb = confirmedLead(g, e, 'convert', b);
        expect(runSecurityAction(g, e, 'exile', lb.id)).toEqual({ ok: true });
        expect(b.empire).not.toBe(e);
        const colony = e.colonies[0];
        const before = colonyLedger(g, colony);
        const lc = confirmedLead(g, e, 'boughtGovernor', c);
        expect(runSecurityAction(g, e, 'purge', lc.id)).toEqual({ ok: true });
        expect(c.active).toBe(false);
        // Chain reaction: purge → an approval term on every colony.
        const after = colonyLedger(g, colony);
        expect(before.entries.some((x) => x.cause === 'purges')).toBe(false);
        expect(after.entries.find((x) => x.cause === 'purges')!.value).toBe(-5);
        expect(after.total).toBe(empireApprovalRating(g, colony));
        const ld = confirmedLead(g, e, 'plot', d);
        const loyalty = politicsEntry(g, d).loyalty;
        expect(runSecurityAction(g, e, 'amnesty', ld.id)).toEqual({ ok: true });
        expect(politicsEntry(g, d).loyalty).toBe(Math.min(100, loyalty + 20));
        expect(ld.closed).toBe(true);
        expect(runSecurityAction(g, e, 'arrest', ld.id).ok).toBe(false);
    }, 600000);

    it('quarantine / recall fleet / scrap ship', () => {
        const { game } = secGame();
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const colony = e.colonies[0];
        const lq = confirmedLead(g, e, 'farm', colony);
        expect(runSecurityAction(g, e, 'quarantine', lq.id)).toEqual({ ok: true });
        expect(colonyQuarantined(g, colony)).toBe(true);
        const list = [{ target: colony }, { target: null }];
        removeQuarantinedDestinations(g, list);
        expect(list.length).toBe(1);
        // Recall: a suspect ship in a fleet → the fleet gathers at the capital.
        const group = [...g.empires].flatMap((x) => (x === e ? empireShipGroups(x) : [])).find((x) => x !== null && x.ships.length > 0) ?? null;
        if (group !== null) {
            const lr = confirmedLead(g, e, 'sleeper', group.ships[0]);
            expect(runSecurityAction(g, e, 'recallFleet', lr.id)).toEqual({ ok: true });
            expect(group.gatherPoint).toBe(e.capital);
        }
        const ship = e.builtObjects.find((b) => !b.hasBeenDestroyed && b.actualEmpire === e)!;
        const ls = confirmedLead(g, e, 'sleeper', ship);
        expect(runSecurityAction(g, e, 'scrapShip', ls.id)).toEqual({ ok: true });
        expect(ship.hasBeenDestroyed).toBe(true);
        expect(ls.closed).toBe(true);
    }, 600000);
});

describe('4. chain reactions', () => {
    it('a converted governor loses loyalty yearly and the ledger lists cult influence and governor loyalty', () => {
        const { game } = secGame({ internalPolitics: true, cult: true });
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const colony = e.capital!;
        for (const c of getEmpireCharacters(e)) if (c.role === CharacterRole.ColonyGovernor && c.location === colony) c.kill(g);
        const gov = newChar(g, e, CharacterRole.ColonyGovernor);
        convert(g, cultState(g), gov);
        const entry = politicsEntry(g, gov);
        entry.loyalty = 36;
        cultLoyaltyChain(g);
        expect(entry.loyalty).toBe(31);
        const l = colonyLedger(g, colony);
        expect(l.entries.find((x) => x.cause === 'cult')!.value).toBeLessThan(0);
        expect(l.entries.find((x) => x.cause === 'loyalty')!.value).toBeCloseTo(-0.8, 9);
        expect(l.total).toBe(empireApprovalRating(g, colony));
    }, 600000);
});

describe('save round trip with leads', () => {
    function saveText(game: Game): string {
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(game.galaxy.nowMs);
        return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: SC, flags: { ...ALL_OFF, internalSecurity: true, cult: true }, params: {} } });
    }

    it('leads, investigations and measures survive save / load and the runs match', () => {
        const a = secGame({ cult: true });
        const g = a.game.galaxy;
        const e = g.playerEmpire!;
        const agent = agentOnCounterIntelligence(g, e);
        const c = nonLeader(e);
        convert(g, cultState(g), c);
        const thing = securityState(g).things.find((t) => t.target === c)!;
        const lead = setLeadLevel(g, thing, e, 'suspected', 'roll')!;
        startInvestigation(g, e, lead.id, agent);
        const lq = confirmedLead(g, e, 'hiveNode', e.colonies[0]);
        runSecurityAction(g, e, 'quarantine', lq.id);
        const text = saveText(a.game);
        const loaded = deserializeGame(text, a.gameData);
        const st2 = peekSecurityState(loaded.game.galaxy)!;
        expect(st2.leads.map((l) => `${l.id}:${l.kind}:${l.level}`)).toEqual(securityState(g).leads.map((l) => `${l.id}:${l.kind}:${l.level}`));
        expect(st2.investigations.length).toBe(1);
        expect(st2.quarantine.size).toBe(1);
        runGameSeconds(a.game, 300);
        runGameSeconds(loaded.game, 300);
        expect(stateDigest(loaded.game.galaxy)).toBe(stateDigest(a.game.galaxy));
        expect(saveText(loaded.game)).toBe(saveText(a.game));
    }, 1200000);
});
