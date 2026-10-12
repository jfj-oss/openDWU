// 19b §5.A threat framework (src/sim/scenario/threats/framework.ts): the generic parts the 19f threats reuse.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import { createGalaxyScenario, parseScenarioManifest } from '../src/sim/scenario';
import { scenarioGameStart, type HomePlacementHelpers } from '../src/sim/scenario/hooks';
import {
    arcMessage,
    arcNews,
    availableThreatActions,
    createThreatFaction,
    flipToFaction,
    invadeFromInside,
    knowledgeLevel,
    makeRobotTroop,
    pastThreatMinYear,
    refitInPlace,
    registerThreatAction,
    registerThreatExistence,
    registerThreatKnownSites,
    revealTo,
    runThreatAction,
    teardownIfDead,
    threatExists,
    threatKnownSites,
    threatState,
    type ThreatSite,
} from '../src/sim/scenario/threats/framework';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { findNewestCanBuild } from '../src/sim/designGeneration';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { threatMarker, THREAT_CONFIRMED_COLOR, THREAT_SUSPECTED_COLOR } from '../src/render/overlayLayer';
import type { CreateGameOptions } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { scenarioEmit, scenarioQuery } from '../src/sim/scenario/hooks';
import { genShipsPeriodic, genShipsState, peekGenShipsState } from '../src/sim/scenario/threats/generationShips';
import { archiveCoresPeriodic, grantArchiveCore, peekArchiveCoresState } from '../src/sim/scenario/threats/archiveCores';
import { peekProbeSwarmState, probeSwarmIncome, probeSwarmPeriodic, probeSwarmState } from '../src/sim/scenario/threats/probeSwarm';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

function scenarioOn(g: Galaxy): void {
    g.scenario = createGalaxyScenario(parseScenarioManifest({ id: 'fw', flags: [{ name: 'fw', default: true }] }), {}, base.resources);
}

describe('threat framework', () => {
    it('threatState keeps plain state in galaxy.scenario.state; revealTo only raises knowledge', () => {
        const g = cachedTickGame(base).galaxy;
        scenarioOn(g);
        const st = threatState(g, 'fwTest', () => ({ sites: [] as ThreatSite[] }));
        expect(g.scenario!.state.fwTest).toBe(st);
        const site: ThreatSite = { knowledge: [] };
        const e = g.empires[1];
        expect(knowledgeLevel(site, e)).toBe(0);
        expect(revealTo(g, site, e, 2)).toBe(true);
        expect(revealTo(g, site, e, 1)).toBe(false);
        expect(revealTo(g, site, e, 2)).toBe(false);
        expect(knowledgeLevel(site, e)).toBe(2);
        expect(revealTo(g, site, e, 3)).toBe(true);
        expect(site.knowledge).toHaveLength(1);
        expect(knowledgeLevel(site, g.empires[0])).toBe(0);
    }, 600000);

    it('createThreatFaction: an adopt-only faction at locked war with its enemies, with designs; teardownIfDead', () => {
        const g = cachedTickGame(base).galaxy;
        scenarioOn(g);
        const enemies = g.empires.filter((e) => e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
        const n = g.empires.length;
        const f = createThreatFaction(g, { race: 'Mechanoid', name: 'Test Collective', enemies })!;
        expect(g.empires.length).toBe(n + 1);
        expect(f.name).toBe('Test Collective');
        expect(f.capital).toBeNull();
        expect(f.colonies).toHaveLength(0);
        expect(f.designs.length).toBeGreaterThan(0);
        for (const e of enemies) {
            expect(obtainDiplomaticRelation(f, e).type).toBe(DiplomaticRelationType.War);
            expect(obtainDiplomaticRelation(f, e).locked).toBe(true);
            expect(obtainDiplomaticRelation(e, f).locked).toBe(true);
        }
        expect(teardownIfDead(g, f)).toBe(true);
        expect(f.active).toBe(false);
    }, 600000);

    it('invadeFromInside, makeRobotTroop, flipToFaction, refitInPlace', () => {
        const g = cachedTickGame(base).galaxy;
        scenarioOn(g);
        const host = g.empires[1];
        const f = createThreatFaction(g, { race: 'Mechanoid', name: 'Robots', enemies: [host] })!;
        const colony = host.colonies[0];
        const t = makeRobotTroop(g, f, 70, 'Drone Group');
        expect(t.attackStrength).toBe(70);
        expect(t.readiness).toBe(100);
        expect(t.maintenanceMultiplier).toBe(0);
        invadeFromInside(g, colony, f, [t]);
        expect(colony.invadingTroops!.items).toContain(t);
        expect(t.colony).toBe(colony);
        expect(t.empire).toBe(f);

        const freighter = host.privateBuiltObjects.find((b) => b.subRole === BuiltObjectSubRole.SmallFreighter || b.subRole === BuiltObjectSubRole.MediumFreighter)!;
        expect(freighter).toBeDefined();
        flipToFaction(g, freighter, f);
        expect(freighter.actualEmpire).toBe(f);
        expect(freighter.owner).toBe(f);
        expect(f.builtObjects).toContain(freighter);
        expect(f.privateBuiltObjects).not.toContain(freighter);
        expect(host.privateBuiltObjects).not.toContain(freighter);

        const escort = findNewestCanBuild(f.designs, BuiltObjectSubRole.Escort, f)!;
        refitInPlace(g, freighter, escort);
        expect(freighter.design).toBe(escort);
        expect(freighter.subRole).toBe(BuiltObjectSubRole.Escort);
        expect(freighter.role).toBe(BuiltObjectRole.Military);
        expect(freighter.components.items.length).toBe(escort.components.length);
        expect(freighter.weapons.length).toBeGreaterThan(0);
        expect(freighter.currentFuel).toBe(freighter.fuelCapacity);
    }, 600000);

    it('arcMessage reaches each recipient once per stage; arcNews once', () => {
        const g = cachedTickGame(base).galaxy;
        scenarioOn(g);
        const sent = {};
        const e = g.empires[0];
        const before = empireMessages(e).length;
        const spec = { prefix: 'FwTest', stage: 'Hint', args: ['X'], type: EmpireMessageType.GeneralWarning, subject: e.capital };
        expect(arcMessage(g, sent, [e, e], spec)).toEqual([e]);
        expect(arcMessage(g, sent, [e], spec)).toEqual([]);
        expect(empireMessages(e).length).toBe(before + 1);
        const m = empireMessages(e).at(-1)!;
        expect(m.messageType).toBe(EmpireMessageType.GeneralWarning);
        expect(m.subject).toBe(e.capital);
        expect(arcNews(g, sent, { prefix: 'FwTest', stage: 'News' })).toBe(true);
        expect(arcNews(g, sent, { prefix: 'FwTest', stage: 'News' })).toBe(false);
    }, 600000);

    it('known-site providers feed the UI selector; threat actions are offered and run', () => {
        const g = cachedTickGame(base).galaxy;
        const player = g.playerEmpire!;
        expect(threatKnownSites(g, player)).toEqual([]); // no scenario: nothing
        scenarioOn(g);
        const colony = player.colonies[0];
        registerThreatKnownSites('zzTest', (_g, e) => (e === player ? [{ threat: 'zzTest', kind: 'colony', target: colony, level: 3, label: 'Nest (confirmed)' }, { threat: 'zzTest', kind: 'colony', target: colony, level: 1, label: 'rumour' }] : []));
        const sites = threatKnownSites(g, player).filter((s) => s.threat === 'zzTest');
        expect(sites.map((s) => s.label)).toEqual(['Nest (confirmed)']);
        const ring = threatMarker(sites[0], 1);
        expect(ring.kind).toBe('ring');
        expect(ring.color).toBe(THREAT_CONFIRMED_COLOR);
        expect(threatMarker({ ...sites[0], level: 2 }, 1).color).toBe(THREAT_SUSPECTED_COLOR);
        registerThreatKnownSites('zzTest', () => []);

        let ran = 0;
        registerThreatAction('zzTest.act', { label: () => 'Do it', available: (_g, e, t) => e === player && t === colony, run: () => ++ran > 0 });
        expect(availableThreatActions(g, player, colony)).toContainEqual({ kind: 'zzTest.act', label: 'Do it' });
        expect(availableThreatActions(g, player, g.habitats[0] === colony ? g.habitats[1] : g.habitats[0]).some((a) => a.kind === 'zzTest.act')).toBe(false);
        expect(runThreatAction(g, player, 'zzTest.act', colony)).toBe(true);
        expect(runThreatAction(g, g.empires[1], 'zzTest.act', colony)).toBe(false);
        expect(ran).toBe(1);
        registerThreatAction('zzTest.act', { label: () => '', available: () => false, run: () => false });
    }, 600000);
});

describe('threat framework: rarity and timing (§0)', () => {
    it('existence lottery: rare by default, 0%/100% absolute, reproducible for the same seed, hidden, and off with no threat enabled', () => {
        registerThreatExistence('zzLotteryA', 'zzLotteryA');
        registerThreatExistence('zzLotteryB', 'zzLotteryB');
        const ctx: HomePlacementHelpers = { randomPointInRing: () => ({ x: 0, y: 0 }), inNebula: () => false };
        const manifest = (extra: Record<string, number>) =>
            parseScenarioManifest({
                id: 'fwLottery',
                include: ['threat-framework'],
                flags: [
                    { name: 'zzLotteryA', default: true },
                    { name: 'zzLotteryB', default: true },
                ],
                params: Object.entries(extra).map(([name, v]) => ({ name, default: v })),
            });

        // 0%: nothing exists.
        const g0 = cachedTickGame(base).galaxy;
        const msgCountsBefore = g0.empires.map((e) => (e === null ? 0 : empireMessages(e).length));
        g0.scenario = createGalaxyScenario(manifest({ threatExistChancePct: 0 }), {}, base.resources);
        scenarioGameStart(g0, ctx);
        expect(threatExists(g0, 'zzLotteryA')).toBe(false);
        expect(threatExists(g0, 'zzLotteryB')).toBe(false);
        // Hidden: the roll never sends a message to anyone.
        expect(g0.empires.map((e) => (e === null ? 0 : empireMessages(e).length))).toEqual(msgCountsBefore);

        // 100%: everything exists.
        const g100 = cachedTickGame(base).galaxy;
        g100.scenario = createGalaxyScenario(manifest({ threatExistChancePct: 100 }), {}, base.resources);
        scenarioGameStart(g100, ctx);
        expect(threatExists(g100, 'zzLotteryA')).toBe(true);
        expect(threatExists(g100, 'zzLotteryB')).toBe(true);

        // Reproducible: the same seed, flags and params give the same result every time (the framework's own Random,
        // never galaxy.rnd — so this never depends on unrelated draws elsewhere in the game).
        const gA = cachedTickGame(base).galaxy;
        gA.scenario = createGalaxyScenario(manifest({}), {}, base.resources);
        scenarioGameStart(gA, ctx);
        const gB = cachedTickGame(base).galaxy;
        gB.scenario = createGalaxyScenario(manifest({}), {}, base.resources);
        scenarioGameStart(gB, ctx);
        expect(threatExists(gB, 'zzLotteryA')).toBe(threatExists(gA, 'zzLotteryA'));
        expect(threatExists(gB, 'zzLotteryB')).toBe(threatExists(gA, 'zzLotteryB'));

        // No threat enabled: no state at all (flags-off stays byte-identical to before this lottery existed).
        const gOff = cachedTickGame(base).galaxy;
        gOff.scenario = createGalaxyScenario(
            parseScenarioManifest({ id: 'fwLotteryOff', include: ['threat-framework'], flags: [{ name: 'zzLotteryA', default: false }] }),
            {},
            base.resources,
        );
        scenarioGameStart(gOff, ctx);
        expect(gOff.scenario.state.threats).toBeUndefined();
        expect(threatExists(gOff, 'zzLotteryA')).toBe(false);
    }, 600000);
});


// Generation Ships, Archive Cores and the Dead Probe Swarm (docs/NEW_THREATS.md): flag off, a forced arrival through
// contact, the ultimatum (AI answer) and settling; an Archive Core's AI choice and payoff; the swarm's wake, its
// passive pirate shell, expansion and the mothercore salvage. Direct calls on one composite game.
describe('new threats: generation ships, archive cores, probe swarm', () => {
    const ids = ['threat-framework', 'generation-ships', 'archive-cores', 'probe-swarm'];
    const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
    function ntGame(flags: Record<string, boolean>, params: Record<string, number> = {}): Galaxy {
        const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags, params, options: age3 });
        return game.galaxy;
    }
    const ALL = { threatGenerationShips: true, threatArchiveCores: true, threatProbeSwarm: true };

    it('flags off: no state, no faction', () => {
        const g = ntGame({ threatGenerationShips: false, threatArchiveCores: false, threatProbeSwarm: false }, { genShipsEarliestYear: 0, genShipsLatestYear: 0, probeSwarmYear: 0 });
        const n = g.empires.length;
        genShipsPeriodic(g);
        probeSwarmPeriodic(g);
        expect(peekGenShipsState(g)).toBeNull();
        expect(peekProbeSwarmState(g)).toBeNull();
        expect(peekArchiveCoresState(g)).toBeNull();
        expect(g.empires.length).toBe(n);
    }, 300000);

    it('generation ships: arrival scaled to the target, contact, an AI that cedes, the world ship lands', () => {
        const g = ntGame(ALL, { genShipsEarliestYear: 0, genShipsTechLevel: 1, genShipsEmpiresAtTech: 1, genShipsFlavour: 1, genShipsAiFightRatioPct: 100000, genShipsMinFirepower: 500 });
        const st = genShipsState(g);
        genShipsPeriodic(g); // one empire at tech level 1 fires it
        expect(st.phase).toBe('arrived');
        expect(st.flavour).toBe('heirs');
        const faction = st.faction!;
        expect(st.target!.empire).toBe(st.owner);
        expect(st.escorts.length).toBeGreaterThan(0);
        expect(st.fleetStrength).toBeGreaterThanOrEqual(Math.max(500, (st.ownerStrengthAtSpawn * 130) / 100) * 0.999);
        expect(st.transports.reduce((n, b) => n + (b.troops?.count ?? 0), 0)).toBe(st.regiments);
        expect(st.worldShip).not.toBeNull();
        // The threatened AI plans a bigger navy only once contact is made.
        expect(scenarioQuery(g, 'forceStructureWarships', 10, { empire: st.owner!, threat: 1 })).toBe(10);
        st.contactDate = 0;
        genShipsPeriodic(g);
        expect(st.phase).toBe('contact');
        expect(scenarioQuery(g, 'forceStructureWarships', 10, { empire: st.owner!, threat: 1 })).toBe(22);
        expect(scenarioQuery(g, 'stateAIDormant', false, { empire: faction })).toBe(true);
        st.ultimatumDate = 0;
        if (g.playerEmpire === st.owner) st.owner = null; // the AI answers at once (a human gets the popup)
        genShipsPeriodic(g);
        if (st.owner !== null) {
            expect(st.answer).toBe('cede');
            expect(st.answeredBy).toBe('ai');
            expect(st.target!.empire).toBe(faction);
            expect(st.phase).toBe('settling');
            const ws = st.worldShip!;
            ws.xpos = st.settleAt!.xpos;
            ws.ypos = st.settleAt!.ypos;
            const pop = st.settleAt!.population.totalAmount;
            genShipsPeriodic(g);
            expect(st.phase).toBe('settled');
            expect(st.worldShipFate).toBe('landed');
            expect(st.settleAt!.population.totalAmount).toBeGreaterThan(pop);
            expect(scenarioQuery(g, 'stateAIDormant', false, { empire: faction })).toBe(false);
        }
    }, 600000);

    it('archive cores: an AI at peace seals its core and gets the larger payoff later', () => {
        const g = ntGame(ALL, { genShipsEarliestYear: 99, probeSwarmYear: 99 });
        const ai = g.empires.find((e) => e !== null && e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active)!;
        for (let i = 0; i < ai.diplomaticRelations.count; i++) ai.diplomaticRelations.at(i).type = DiplomaticRelationType.None;
        const core = grantArchiveCore(g, ai, 'ruins', 'Test Ruins')!;
        expect(core.choice).toBe('seal');
        archiveCoresPeriodic(g);
        expect(core.granted).toBe(0);
        core.nextDate = 0;
        archiveCoresPeriodic(g);
        expect(core.done).toBe(true);
        expect(core.granted).toBeGreaterThan(0);
        expect(grantArchiveCore(g, g.independentEmpire, 'ruins', 'x')).toBeNull();
    }, 300000);

    it('probe swarm: a passive pirate shell that expands, and a mothercore that pays out when destroyed', () => {
        const g = ntGame(ALL, { genShipsEarliestYear: 99, probeSwarmYear: 0, probeSwarmStationDays: 1 });
        const st = probeSwarmState(g);
        probeSwarmPeriodic(g);
        expect(st.phase).toBe('active');
        const f = st.faction!;
        expect(f.pirateEmpireBaseHabitat).not.toBeNull();
        expect(scenarioQuery(g, 'pirateFactionPassive', false, { empire: f })).toBe(true);
        expect(st.mothercore).not.toBeNull();
        st.budget = 10_000_000;
        const before = st.stations.length;
        for (let i = 0; i < 5; i++) {
            st.lastStationDate = -1e12;
            probeSwarmPeriodic(g);
        }
        expect(st.stations.length).toBeGreaterThan(before);
        expect(probeSwarmIncome(g, st)).toBeLessThanOrEqual(250000);
        const killer = g.empires.find((e) => e !== null && e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active)!;
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: st.mothercore!, destroyer: killer });
        expect(st.mothercoreDestroyed).toBe(true);
        expect(st.mothercoreKiller).toBe(killer);
        expect(peekArchiveCoresState(g)!.cores.some((c) => c.empire === killer && c.source === 'mothercore')).toBe(true);
    }, 600000);
});
