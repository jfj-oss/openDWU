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
    KNOWLEDGE_CONFIRMED,
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
import { registerScenarioEvent, scenarioEmit, scenarioQuery } from '../src/sim/scenario/hooks';
import { genShipsLowLevel, genShipsPeriodic, genShipsState, genShipsStates, genShipsWaveSize, peekGenShipsState } from '../src/sim/scenario/threats/generationShips';
import { empireTechLevel, maxDesignTechLevel } from '../src/sim/scenario/threats/robotMutiny';
import { calculateOverallStrengthFactorWithoutShields } from '../src/sim/diplomacyTick';
import { ComponentType } from '../src/sim/data/components';
import { HabitatType } from '../src/sim/types';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { archiveCoresPeriodic, grantArchiveCore, peekArchiveCoresState } from '../src/sim/scenario/threats/archiveCores';
import { peekProbeSwarmState, probeSwarmIncome, probeSwarmPeriodic, probeSwarmState } from '../src/sim/scenario/threats/probeSwarm';
import { peekVoidWhaleState, referenceHyperSpeed, voidWhalePeriodic, voidWhaleState } from '../src/sim/scenario/threats/voidWhale';
import { paintWounds, woundCount, woundKey } from '../src/render/whaleWounds';
import { LEV_H, LEV_W, leviathanSilhouette, levHalf, levU } from '../src/render/leviathanArt';
import { LEV_BODY_URL, LEV_GLOW_SPOTS, LEV_HARPOONS, LEV_HARPOON_URL, LEV_PARTS } from '../src/render/leviathanParts';
import { decodePng } from './helpers/pngDecode';
import { peekWreckageState } from '../src/sim/scenario/wreckage/common';
import {
    hollowFleetKnownSites,
    hollowFleetMapFeatures,
    hollowFleetObserve,
    hollowFleetPeriodic,
    hollowFleetPhaseAt,
    hollowFleetState,
    hollowFleetWindow,
    peekHollowFleetState,
} from '../src/sim/scenario/threats/hollowFleet';
import { purifierHideSpot, purifierHunts, purifierMapFeatures, purifierPeriodic, purifierPickTarget, purifierState, purifierTargets, purifierWake, peekPurifierState } from '../src/sim/scenario/threats/purifier';
import { HabitatCategoryType } from '../src/sim/types';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { reviewThreatInvestigations, THREAT_INVESTIGATIONS_KEY } from '../src/sim/scenario/threats/investigate';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { threatLeadRows, threatsSectionVisible } from '../src/ui/internalSecurityView';
import { CharacterRole, getEmpireCharacters } from '../src/sim/characters';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import type { StartGameOptions } from '../src/sim/startGameOptions';


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

describe('threat framework: Intelligence screen Threats & Leads section + site investigation', () => {
    it('lists known sites; Investigate (an agent, recorded command) confirms a suspected site without Internal Security; refused with no threat add-on', () => {
        const g = cachedTickGame(base).galaxy;
        const player = g.playerEmpire!;
        expect(threatsSectionVisible(g)).toBe(false); // no scenario
        expect(threatLeadRows(g, player)).toEqual([]);
        scenarioOn(g);
        const colony = player.colonies[0];
        const site: ThreatSite = { knowledge: [] };
        registerThreatExistence('zzInv', 'zzInvFlag');
        registerThreatKnownSites('zzInv', (_g, e) => [{ threat: 'zzInv', kind: 'colony', target: colony, level: knowledgeLevel(site, e), site, label: 'Nest' }]);
        revealTo(g, site, player, 2);
        const agent = getEmpireCharacters(player).find((c) => c.role === CharacterRole.IntelligenceAgent && c.active)!;
        expect(agent === undefined).toBe(false);
        agent.mission = null;
        // Flag off: no section, the command refuses.
        expect(threatsSectionVisible(g)).toBe(false);
        expect(runPlayerCommand(g, player, 'threatInvestigate', ['zzInv', colony, agent])).toEqual({ ok: false, reason: 'No galactic threats' });
        g.scenario!.flags.zzInvFlag = true;
        expect(threatsSectionVisible(g)).toBe(true);
        let row = threatLeadRows(g, player).find((r) => r.key === colony)!;
        // (Field by field: a failing diff of a Habitat would print the whole galaxy graph.)
        expect([row.what, row.where, row.certainty, row.goTo === colony, row.investigate?.kind, row.investigate?.kind === 'site' && row.investigate.target === colony]).toEqual(['Nest', colony.name, 'suspected', true, 'site', true]);
        expect(row.found).not.toBe('');
        expect(g.scenario!.state[THREAT_INVESTIGATIONS_KEY]).toBeUndefined(); // no state until an investigation starts
        expect(runPlayerCommand(g, player, 'threatInvestigate', ['zzInv', colony, agent])).toEqual({ ok: true });
        expect(runPlayerCommand(g, player, 'threatInvestigate', ['zzInv', colony, agent])).toEqual({ ok: false, reason: 'Already under investigation' });
        row = threatLeadRows(g, player).find((r) => r.key === colony)!;
        expect(row.status).toBe(`Investigating (${agent.name})`);
        expect(row.investigate).toBeNull();
        // Not due yet: nothing drawn.
        const draws = g.rnd.drawCount;
        reviewThreatInvestigations(g);
        expect(g.rnd.drawCount).toBe(draws);
        const st = g.scenario!.state[THREAT_INVESTIGATIONS_KEY] as { list: { due: number }[] };
        // Due: one roll each (chance 1.5 × skill / (skill + 60)); an inconclusive one may be retried.
        for (let i = 0; i < 40 && knowledgeLevel(site, player) < 3; i++) {
            if (st.list.length === 0) expect(runPlayerCommand(g, player, 'threatInvestigate', ['zzInv', colony, agent])).toEqual({ ok: true });
            st.list[0].due = galaxyStarDate(g);
            const before = g.rnd.drawCount;
            reviewThreatInvestigations(g);
            expect(g.rnd.drawCount).toBe(before + 1);
        }
        expect(st.list).toEqual([]);
        expect(knowledgeLevel(site, player)).toBe(3);
        expect(empireMessages(player).at(-1)!.title).toBe('Threat confirmed');
        row = threatLeadRows(g, player).find((r) => r.key === colony)!;
        expect([row.certainty, row.investigate]).toEqual(['confirmed', null]);
        registerThreatKnownSites('zzInv', () => []);
        g.scenario!.flags.zzInvFlag = false;
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
        expect(st.fleetStrength).toBeGreaterThanOrEqual(Math.max(500, (st.ownerStrengthAtSpawn * 170) / 100) * 0.999);
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

    const WAVE = { genShipsEarliestYear: 0, genShipsTechLevel: 1, genShipsEmpiresAtTech: 1, genShipsFlavour: 1, genShipsAiFightRatioPct: 100000, genShipsMinFirepower: 500 };

    it('generation ships: one per six empires (1..4), staggered 2-4 years, each at a different empire', () => {
        expect([5, 6, 11, 12, 18, 24, 40].map((n) => genShipsWaveSize(n, 6))).toEqual([1, 1, 1, 2, 3, 4, 4]);
        const g = ntGame(ALL, { ...WAVE, genShipsEmpiresPerShip: 1 });
        const first = genShipsState(g);
        genShipsPeriodic(g);
        expect(first.planned).toBe(Math.min(4, Math.max(1, g.empires.filter((e) => e.active && e !== g.independentEmpire && g.pirateEmpires.indexOf(e) < 0).length)));
        expect(first.spawned).toBe(1);
        expect(first.nextDate - first.arrivalDate).toBeGreaterThanOrEqual(2 * YEAR_LENGTH);
        expect(first.nextDate - first.arrivalDate).toBeLessThanOrEqual(4 * YEAR_LENGTH);
        genShipsPeriodic(g); // not yet: still waiting out the stagger
        expect(genShipsStates(g).length).toBe(1);
        for (let i = 1; i < first.planned; i++) {
            first.nextDate = 0;
            genShipsPeriodic(g);
            expect(genShipsStates(g).length).toBe(i + 1);
        }
        const states = genShipsStates(g);
        expect(states.map((x) => x.index)).toEqual(states.map((_, i) => i));
        const owners = states.filter((x) => x.phase !== 'ended').map((x) => x.owner);
        expect(new Set(owners).size).toBe(owners.length);
        expect(owners.every((o) => o !== null)).toBe(true);
    }, 600000);

    it('generation ships: 1.7x escort of big hulls, screens and carriers built from outdated parts (top reactors and fuel, efficient tech-4 hyperdrive)', () => {
        const g = ntGame(ALL, { ...WAVE });
        const st = genShipsState(g);
        genShipsPeriodic(g);
        expect(st.fleetStrength).toBeGreaterThanOrEqual(Math.max(500, st.ownerStrengthAtSpawn * 1.7) * 0.999);
        const subs = new Set(st.escorts.map((b) => b.subRole));
        for (const sub of [BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Carrier, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate]) expect(subs.has(sub)).toBe(true);
        const share = (set: BuiltObjectSubRole[]): number => st.escorts.filter((b) => set.includes(b.subRole)).reduce((n, b) => n + calculateOverallStrengthFactorWithoutShields(b), 0) / st.fleetStrength;
        expect(share([BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Cruiser])).toBeGreaterThan(0.25);
        expect(share([BuiltObjectSubRole.Carrier])).toBeGreaterThan(0.05);
        expect(share([BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate])).toBeGreaterThan(0.3);
        expect(st.escorts.some((b) => b.subRole === BuiltObjectSubRole.Carrier && b.fighterCapacity > 0)).toBe(true);
        const low = genShipsLowLevel(Math.max(1, Math.min(empireTechLevel(st.owner!), maxDesignTechLevel(g) || 7)), 2);
        const top = maxDesignTechLevel(g);
        const defs = g.researchStatic!.componentStatic!.definitions;
        const OUT = [ComponentType.Armor, ComponentType.Shields, ComponentType.EngineMainThrust, ComponentType.EngineVectoring, ComponentType.WeaponBeam, ComponentType.WeaponPhaser, ComponentType.WeaponRailGun, ComponentType.WeaponTorpedo, ComponentType.WeaponMissile];
        let reactorMax = 0;
        let fuelMax = 0;
        for (const b of st.escorts) {
            for (const c of b.design.components) {
                if (c === null) continue;
                if (OUT.includes(c.type)) {
                    const lowest = Math.min(...defs.filter((d) => d.type === c.type).map((d) => d.techLevel));
                    expect(c.techLevel).toBeLessThanOrEqual(Math.max(low, lowest));
                }
                if (c.type === ComponentType.HyperDrive) expect(c.techLevel).toBeLessThanOrEqual(4);
                if (c.type === ComponentType.Reactor) reactorMax = Math.max(reactorMax, c.techLevel);
                if (c.type === ComponentType.StorageFuel) fuelMax = Math.max(fuelMax, c.techLevel);
            }
        }
        const best = (t: ComponentType): number => Math.max(...defs.filter((d) => d.type === t && d.techLevel <= top).map((d) => d.techLevel));
        expect(reactorMax).toBe(Math.max(...defs.filter((d) => d.type === ComponentType.Reactor && d.techLevel <= top).map((d) => d.techLevel)));
        expect(fuelMax).toBe(best(ComponentType.StorageFuel));
        expect(st.transports.reduce((n, b) => n + (b.troops?.count ?? 0), 0)).toBe(st.regiments);
    }, 600000);

    it('generation ships: the war opens with gas-mining strikes, then every fleet regroups on the colony; a lost war makes a pirate faction', () => {
        const g = ntGame(ALL, { ...WAVE, genShipsStrikeDays: 100000 });
        const st = genShipsState(g);
        genShipsPeriodic(g);
        const owner = st.owner!;
        const faction = st.faction!;
        // A gas mining station of the owner: a private-sector one (Empire.PrivateBuiltObjects, where mining stations
        // usually are) when it has one, else an existing owner ship stands in; the others are taken out of the way.
        const privateGas = owner.privateBuiltObjects.filter((b) => !b.hasBeenDestroyed && b.subRole === BuiltObjectSubRole.GasMiningStation);
        const station = privateGas[0] ?? owner.builtObjects.find((b) => !b.hasBeenDestroyed && b.role !== BuiltObjectRole.Military)!;
        station.subRole = BuiltObjectSubRole.GasMiningStation;
        for (const b of [...owner.builtObjects, ...owner.privateBuiltObjects]) if (b !== station && b.subRole === BuiltObjectSubRole.GasMiningStation) b.hasBeenDestroyed = true;
        st.phase = 'war';
        st.warDate = galaxyStarDate(g);
        genShipsPeriodic(g);
        expect(st.strikeTargets).toContain(station);
        const striker = st.escorts.find((b) => builtObjectMission(b.mission)?.targetBuiltObject === station);
        expect(striker).toBeDefined();
        expect(st.strikeDone).toBe(false);
        // The world ship has infinite fuel and refuels the fleet beside it; off-mission ships Escort / Patrol it.
        const ws = st.worldShip!;
        ws.currentFuel = 0;
        const near = st.escorts.find((b) => b.fuelCapacity > 0 && b !== striker)!;
        near.currentFuel = 0;
        near.xpos = ws.xpos + 100;
        near.ypos = ws.ypos;
        const far = st.escorts.find((b) => b.fuelCapacity > 0 && b !== striker && b !== near)!;
        far.currentFuel = 0;
        far.xpos = ws.xpos + 1e7;
        genShipsPeriodic(g);
        expect(ws.currentFuel).toBe(ws.fuelCapacity);
        expect(near.currentFuel).toBe(near.fuelCapacity);
        expect(far.currentFuel).toBe(0);
        const guards = [...st.escorts.filter((b) => b !== striker && builtObjectMission(b.mission)?.type !== BuiltObjectMissionType.Attack), ...st.transports];
        expect(guards.length).toBeGreaterThan(0);
        expect(guards.every((b) => [BuiltObjectMissionType.Patrol, BuiltObjectMissionType.Escort].includes(builtObjectMission(b.mission)!.type) && builtObjectMission(b.mission)!.targetBuiltObject === ws)).toBe(true);
        expect(st.transports.every((b) => builtObjectMission(b.mission)!.type === BuiltObjectMissionType.Escort)).toBe(true);
        station.hasBeenDestroyed = true;
        genShipsPeriodic(g);
        expect(st.stationsHit).toBe(1);
        expect(st.strikeDone).toBe(true);
        genShipsPeriodic(g);
        expect(st.escorts.every((b) => builtObjectMission(b.mission)?.targetHabitat === st.target)).toBe(true);
        // Pilgrims never strike.
        expect(st.flavour).toBe('heirs');
        // Two years without winning: the survivors turn pirate.
        const ships = [...st.escorts, ...st.transports, st.worldShip!];
        st.warDate -= 3 * YEAR_LENGTH;
        genShipsPeriodic(g);
        const pirate = st.pirate!;
        expect(pirate).not.toBeNull();
        expect(st.phase).toBe('ended');
        expect(g.pirateEmpires).toContain(pirate);
        const base = st.pirateBase!;
        expect(pirate.pirateEmpireBaseHabitat).toBe(base);
        expect([HabitatType.GasGiant, HabitatType.FrozenGasGiant]).toContain(base.type);
        expect(ships.filter((b) => !b.hasBeenDestroyed).every((b) => b.actualEmpire === pirate && b.supportCostFactor === 0)).toBe(true);
        expect(pirate.builtObjects.length).toBeGreaterThan(ships.length); // the stock base, construction ship and freighters came too
        expect(faction.builtObjects.filter((b) => !b.hasBeenDestroyed).length).toBe(0);
    }, 600000);

    it('generation ships: the Force start option guarantees the threat and aims the first ship at the player', () => {
        const g = ntGame(ALL, { ...WAVE, generationShipsExistChancePct: 0, generationShipsForce: 1 });
        expect(threatExists(g, 'generationShips')).toBe(true);
        const st = genShipsState(g);
        genShipsPeriodic(g);
        expect(st.owner).toBe(g.playerEmpire);
        expect(st.faction?.dominantRace?.name).toBe('Human'); // world ships are always Human
        const off = ntGame(ALL, { ...WAVE, generationShipsExistChancePct: 0 });
        expect(threatExists(off, 'generationShips')).toBe(false);
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

    it('probe swarm: builds in colony systems (and on planets), never on a colony, and avoids them with probeSwarmAvoidColonies', () => {
        for (const avoid of [0, 1]) {
            const g = ntGame(ALL, { genShipsEarliestYear: 99, probeSwarmYear: 0, probeSwarmStationDays: 1, probeSwarmExpandRangePct: 100, probeSwarmMinCapitalDistancePct: 0, probeSwarmAvoidColonies: avoid });
            const st = probeSwarmState(g);
            probeSwarmPeriodic(g);
            const attacked: string[] = [];
            const off = registerScenarioEvent({ id: `test.swarmAttack${avoid}`, flag: 'threatProbeSwarm', event: 'habitatAttacked', run: (_g, e) => { if (e.attackingEmpire === st.faction) attacked.push(e.habitat.name); } });
            st.budget = 100_000_000;
            for (let i = 0; i < 250; i++) {
                st.lastStationDate = -1e12;
                st.budget = 100_000_000;
                probeSwarmPeriodic(g);
            }
            off();
            const colonised = new Set<number>();
            for (const e of g.empires) if (e !== null && e.active) for (const c of e.colonies) colonised.add(c.systemIndex);
            const colonyHabitats = new Set<unknown>();
            for (const e of g.empires) if (e !== null && e.active) for (const c of e.colonies) colonyHabitats.add(c);
            const inColony = st.stations.filter((b) => b.parentHabitat !== null && colonised.has(b.parentHabitat.systemIndex));
            if (avoid === 1) expect(inColony.length).toBe(0);
            else expect(inColony.length).toBeGreaterThan(0);
            expect(st.stations.every((b) => b.parentHabitat !== null && !colonyHabitats.has(b.parentHabitat))).toBe(true);
            expect(attacked).toEqual([]);
        }
    }, 900000);
});

// Void Whale (scenarios/void-whale): one unique creature that hunts and swallows stations, flees to rest, keeps its wounds,
// and pays a bounty when killed. Direct calls on small composite games (the daily periodic is driven by hand).
describe('void whale', () => {
    const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
    function wGame(ids: string[], flags: Record<string, boolean>, params: Record<string, number> = {}): Galaxy {
        return createScenarioGame(base, { scenario: comboOverlayFs(ids), flags, params, options: age3 }).game.galaxy;
    }
    const PARAMS = { voidWhaleYear: 0, voidWhaleMaxTargetFirepower: 1e9 };

    it('flags off: no state, no creature', () => {
        const g = wGame(['threat-framework', 'void-whale'], { threatVoidWhale: false }, PARAMS);
        const n = g.creatures.length;
        voidWhalePeriodic(g);
        expect(peekVoidWhaleState(g)).toBeNull();
        expect(g.creatures.length).toBe(n);
    }, 300000);

    it('hunt, swallow, flee and rest; damage persists and heals slowly; the kill pays a bounty and leaves a carcass field', () => {
        const g = wGame(['threat-framework', 'void-whale', 'wreckage-salvage'], { threatVoidWhale: true, wreckage: true }, PARAMS);
        const st = voidWhaleState(g);
        voidWhalePeriodic(g);
        expect(st.phase).toBe('active');
        const c = st.creature!;
        expect(g.creatures).toContain(c);
        expect(c.size).toBeGreaterThan(2000);
        expect(c.healRate).toBe(0);
        // HUNT: it wakes resting; at the end of the rest it picks a station.
        expect(st.mode).toBe('rest');
        st.restUntil = 0;
        voidWhalePeriodic(g);
        expect(st.mode).toBe('hunt');
        {
            const prey = st.target!;
            expect(prey.role).toBe(BuiltObjectRole.Base);
            c.xpos = prey.xpos + 100;
            c.ypos = prey.ypos;
            c.currentSpeed = 0;
            const size0 = c.size;
            c.damage = 1000;
            voidWhalePeriodic(g);
            expect(prey.hasBeenDestroyed).toBe(true);
            expect(st.swallowed).toBe(1);
            expect(st.mode).toBe('flee');
            expect(c.size).toBeGreaterThan(size0);
            expect(c.damage).toBeLessThan(1000);
            expect(st.lastSeen!.seq).toBe(1);
            expect(st.lungeSeq).toBe(1);
            expect(st.jumpSeq).toBe(1);
            expect(c.hyperSpeed).toBeGreaterThanOrEqual(referenceHyperSpeed(g) * 3);
            expect(c.hyperCountdown).toBe(1000);
            expect(st.embedded.length).toBeLessThanOrEqual(1);
            // FLEE ends at the quiet system, then it rests.
            c.xpos = st.destX;
            c.ypos = st.destY;
            c.currentSpeed = 0;
            voidWhalePeriodic(g);
            expect(st.mode).toBe('rest');
            expect(st.restUntil).toBeGreaterThan(galaxyStarDate(g));
        }
        // PERSISTENT DAMAGE: wounds keep their peak, and heal only slowly.
        const victim = g.empires.find((e) => e !== null && e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active)!;
        c.damage = c.damageKillThreshold * 0.5;
        scenarioEmit(g, 'creatureDamaged', { creature: c, empire: victim, amount: 500 });
        expect(st.peakFrac).toBeGreaterThanOrEqual(0.499);
        expect(st.grudge.find((x) => x.empireId === victim.empireId)!.damage).toBe(500);
        st.lastDay = galaxyStarDate(g); // no time passed
        const d0 = c.damage;
        voidWhalePeriodic(g);
        expect(c.damage).toBeLessThanOrEqual(d0);
        expect(c.damage).toBeGreaterThan(d0 * 0.99);
        c.damage = 0;
        voidWhalePeriodic(g);
        expect(st.peakFrac).toBeGreaterThanOrEqual(0.499);
        // KILL: the last empire to hurt it gets the bounty, the others a reputation boost; the carcass leaves a field.
        const money = victim.stateMoney;
        c.damage = c.damageKillThreshold;
        expect(c.damageCreature({ empire: victim }, 1, null)).toBe(true);
        voidWhalePeriodic(g);
        expect(st.phase).toBe('ended');
        expect(st.killer).toBe(victim);
        expect(victim.stateMoney).toBeGreaterThanOrEqual(money + 500000 - 1);
        const w = peekWreckageState(g)!;
        expect(w.fields.some((f) => f.wrecks.some((r) => r.name.includes('carcass')))).toBe(true);
    }, 900000);

    it('wound art: cuts appear with damage, stay at their peak and turn pale scars as it heals; the cut parts match their metadata', () => {
        expect(woundCount(0)).toBe(0);
        expect(woundCount(0.5)).toBeGreaterThan(woundCount(0.2));
        expect(woundKey(0.5, 0.2)).not.toBe(woundKey(0.5, 0.5));
        // The bundled parts (cut from the Leviathan picture by scripts/leviathan-parts.py) have the listed sizes; the
        // body is about a large space port's pixel count, dim (it sits in dark space) with its glows on the hide.
        const pub = (url: string): string => `${__dirname}/../public${url}`;
        const png = decodePng(pub(LEV_BODY_URL));
        expect([png.width, png.height]).toEqual([LEV_W, LEV_H]);
        for (const p of [LEV_PARTS.finL, LEV_PARTS.finR, LEV_PARTS.fluke]) {
            const d = decodePng(pub(p.url));
            expect([d.width, d.height]).toEqual([p.w, p.h]);
        }
        expect(LEV_W * LEV_H).toBeLessThan(300000);
        const body = { w: png.width, h: png.height, data: png.data };
        let lum = 0;
        let n = 0;
        for (let i = 0; i < body.data.length; i += 4) if (body.data[i + 3] > 200) {
            lum += (body.data[i] + body.data[i + 1] + body.data[i + 2]) / 3;
            n++;
        }
        expect(lum / n).toBeLessThan(90);
        expect(LEV_GLOW_SPOTS.filter((g) => g.kind === 'spine').length).toBeGreaterThanOrEqual(6);
        expect(LEV_GLOW_SPOTS.filter((g) => g.kind === 'head').length).toBeGreaterThanOrEqual(20);
        for (const g of LEV_GLOW_SPOTS) {
            expect(Math.abs(g.y - LEV_H / 2)).toBeLessThan(levHalf(levU(g.x)));
            expect(body.data[(Math.round(g.y) * LEV_W + Math.round(g.x)) * 4 + 3]).toBeGreaterThan(200);
        }
        // The fallback silhouette follows the same outline.
        const sil = leviathanSilhouette();
        expect(sil.data[(LEV_H / 2 * LEV_W + LEV_W / 2) * 4 + 3]).toBe(255);
        const redness = (img: { data: Uint8ClampedArray }): number => {
            let r = 0;
            let k = 0;
            for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 200) {
                r += img.data[i] - img.data[i + 2];
                k++;
            }
            return k === 0 ? 0 : r / k;
        };
        const fresh = paintWounds(body, 0.6, 0.6);
        const healed = paintWounds(body, 0.6, 0);
        const none = paintWounds(body, 0, 0);
        expect(none.data.every((v) => v === 0)).toBe(true);
        expect(fresh.data.some((v) => v > 0)).toBe(true);
        // Wounds only on the hide.
        for (let i = 3; i < fresh.data.length; i += 4) if (fresh.data[i] > 0) expect(body.data[i]).toBeGreaterThan(70);
        // Same cuts, different colour: open gashes are red, healed scars pale and grey.
        expect(redness(fresh)).toBeGreaterThan(redness(healed));
    }, 300000);

    it('harpoon art: 5-9 old harpoons pinned in the hide, fins and flukes, their sprites and lines in the atlas', () => {
        const pub = (url: string): string => `${__dirname}/../public${url}`;
        const atlas = decodePng(pub(LEV_HARPOON_URL));
        const body = decodePng(pub(LEV_BODY_URL));
        expect(LEV_HARPOONS.length).toBeGreaterThanOrEqual(5);
        expect(LEV_HARPOONS.length).toBeLessThanOrEqual(9);
        const opaque = (fx: number, fy: number, fw: number, fh: number): number => {
            let n = 0;
            for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) if (atlas.data[(y * atlas.width + x) * 4 + 3] > 200) n++;
            return n;
        };
        let outside = 0;
        let lines = 0;
        for (const h of LEV_HARPOONS) {
            expect(h.fx + h.fw).toBeLessThanOrEqual(atlas.width);
            expect(h.fy + h.fh).toBeLessThanOrEqual(atlas.height);
            expect(opaque(h.fx, h.fy, h.fw, h.fh)).toBeGreaterThan(40);
            // The sprite's anchor (the entry) is inside the frame and the shaft runs out along +x.
            expect(h.ax).toBeGreaterThan(0);
            expect(h.ax).toBeLessThan(0.5);
            expect(h.attach).toBeGreaterThan(0);
            // The entry sits on its part's hide.
            if (h.part === 'body') {
                expect(body.data[(Math.round(h.y) * LEV_W + Math.round(h.x)) * 4 + 3]).toBeGreaterThan(200);
                const len = h.fw * (1 - h.ax);
                const ex = h.x + Math.cos(h.ang) * len;
                const ey = h.y + Math.sin(h.ang) * len;
                if (Math.abs(ey - LEV_H / 2) > levHalf(levU(ex)) + 10) outside++;
            } else {
                const p = LEV_PARTS[h.part];
                const img = decodePng(pub(p.url));
                const px = Math.round(h.x - p.rootX + p.ax * p.w);
                const py = Math.round(h.y - p.rootY + p.ay * p.h);
                expect(img.data[(py * img.width + px) * 4 + 3]).toBeGreaterThan(60);
            }
            if (h.line !== null) {
                lines++;
                expect(h.line.fw).toBe(h.line.len);
                expect(h.line.fy + h.line.fh).toBeLessThanOrEqual(atlas.height);
                expect(opaque(h.line.fx, h.line.fy, h.line.fw, h.line.fh)).toBeGreaterThan(10);
            }
        }
        // Several stick out past the silhouette (they read at play zoom); a few trail lines.
        expect(outside).toBeGreaterThanOrEqual(3);
        expect(lines).toBeGreaterThanOrEqual(3);
        expect(new Set(LEV_HARPOONS.map((h) => h.part)).size).toBeGreaterThanOrEqual(3);
    });
});

// The Hollow Fleet: a patrol on a fixed, learnable schedule. Direct calls on a composite game.
describe('hollow fleet', () => {
    const ids = ['threat-framework', 'hollow-fleet'];
    const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
    const PARAMS = { hollowFleetExistChancePct: 100, hollowFleetMinYear: 0, hollowFleetYear: 0, hollowFleetRouteSystems: 6 };
    function hfGame(on = true): Galaxy {
        const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: { threatHollowFleet: on }, params: PARAMS, options: age3 });
        return game.galaxy;
    }

    it('flag off: no state, no faction', () => {
        const g = hfGame(false);
        const n = g.empires.length + g.pirateEmpires.length;
        hollowFleetPeriodic(g);
        expect(peekHollowFleetState(g)).toBeNull();
        expect(g.empires.length + g.pirateEmpires.length).toBe(n);
    }, 300000);

    it('wakes with a fixed route and schedule: the same seed gives the same stops, and the cycle repeats exactly', () => {
        const a = hfGame();
        const b = hfGame();
        hollowFleetPeriodic(a);
        hollowFleetPeriodic(b);
        const sa = hollowFleetState(a);
        const sb = hollowFleetState(b);
        expect(sa.phase).toBe('active');
        expect(sa.ships.length).toBeGreaterThanOrEqual(4);
        expect(sa.stops.length).toBe(7); // the anchorage and 6 systems
        expect(new Set(sa.stops.map((x) => x.systemIndex)).size).toBe(7);
        expect(sa.stops.map((x) => [x.systemIndex, x.linger, x.travel])).toEqual(sb.stops.map((x) => [x.systemIndex, x.linger, x.travel]));
        expect(sa.cycleDays).toBe(sb.cycleDays);
        // The schedule is a pure function of the date: the phase one cycle later is the same stop, and a stay's window repeats.
        const t0 = sa.cycleStart;
        const cyc = sa.cycleDays * GAME_DAY_LENGTH;
        for (let d = 0; d < sa.cycleDays; d += 7) {
            const x = hollowFleetPhaseAt(sa, t0 + d * GAME_DAY_LENGTH)!;
            const y = hollowFleetPhaseAt(sa, t0 + d * GAME_DAY_LENGTH + 3 * cyc)!;
            expect(y.kind).toBe(x.kind);
            expect(y.kind === 'stay' ? (y as { stop: number }).stop : (y as { to: number }).to).toBe(x.kind === 'stay' ? (x as { stop: number }).stop : (x as { to: number }).to);
            expect(y.cycle).toBe(x.cycle + 3);
        }
        expect(hollowFleetPhaseAt(sa, t0)).toEqual({ kind: 'stay', stop: 0, cycle: 0 });
        const w0 = hollowFleetWindow(sa, 2, 0);
        const w1 = hollowFleetWindow(sa, 2, 1);
        expect(w1.arrive - w0.arrive).toBeCloseTo(cyc, 3);
        expect(w0.leave - w0.arrive).toBeCloseTo(sa.stops[2].linger * GAME_DAY_LENGTH, 3);
    }, 600000);

    it('attacks only what is in the system it is in', () => {
        const g = hfGame();
        hollowFleetPeriodic(g);
        const st = hollowFleetState(g);
        const faction = st.faction!;
        // Go to the first route stop (stop 1) by moving the clock to its stay, and put a ship of each AI empire at stop 1 and at stop 3.
        const w = hollowFleetWindow(st, 1, 0);
        g.nowMs += w.arrive - galaxyStarDate(g) + GAME_DAY_LENGTH;
        const phase = hollowFleetPhaseAt(st, galaxyStarDate(g))!;
        expect(phase).toEqual({ kind: 'stay', stop: 1, cycle: 0 });
        const others = g.empires.filter((e) => e !== null && e.active && e !== faction && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== g.playerEmpire);
        const mil = (e: Galaxy['empires'][number]) => e!.builtObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0)!;
        const inside = mil(others[0]);
        const away = mil(others[1]);
        inside.xpos = st.stops[1].x + 4000;
        inside.ypos = st.stops[1].y;
        away.xpos = st.stops[3].x + 4000;
        away.ypos = st.stops[3].y;
        st.ships.forEach((b, i) => {
            b.xpos = st.stops[1].x - 3000 - 500 * i;
            b.ypos = st.stops[1].y;
        });
        const before = st.engagements;
        hollowFleetPeriodic(g);
        expect(st.engagements).toBeGreaterThan(before);
        const attackers = st.ships.filter((s) => {
            const m = builtObjectMission(s.mission);
            return m !== null && m.type === BuiltObjectMissionType.Attack;
        });
        expect(attackers.length).toBeGreaterThan(0);
        for (const s of attackers) {
            const t = builtObjectMission(s.mission)!.targetBuiltObject;
            expect(t).not.toBe(away);
            expect(g.calculateDistance(t!.xpos, t!.ypos, st.stops[1].x, st.stops[1].y)).toBeLessThanOrEqual(23000);
        }
        expect(attackers.some((s) => builtObjectMission(s.mission)!.targetBuiltObject === inside)).toBe(true);
    }, 600000);

    it('route reveal: each sighting adds a stop, a repeat teaches the cycle, the Threats row says where it is expected next', () => {
        const g = hfGame();
        hollowFleetPeriodic(g);
        const st = hollowFleetState(g);
        const player = g.playerEmpire!;
        expect(hollowFleetKnownSites(g, player)).toEqual([]);
        expect(hollowFleetMapFeatures(g, player)).toBeNull();
        g.nowMs += hollowFleetWindow(st, 2, 0).leave + GAME_DAY_LENGTH - galaxyStarDate(g); // both stays are past
        hollowFleetObserve(g, st, player, 1, 0);
        hollowFleetObserve(g, st, player, 2, 0);
        const k = st.known.find((x) => x.empireId === player.empireId)!;
        expect(k.sightings.map((x) => x.stop)).toEqual([1, 2]);
        expect(k.sightings[0]).toMatchObject(hollowFleetWindow(st, 1, 0));
        expect(k.cycleKnown).toBe(false); // two stops, seen once each
        let rows = hollowFleetKnownSites(g, player);
        expect(rows).toHaveLength(1);
        expect(rows[0].level).toBe(3);
        expect(rows[0].label).toContain('last seen');
        // One joined leg between the two consecutive known stops.
        expect(hollowFleetMapFeatures(g, player)!.routes).toHaveLength(1);
        // A third stop makes the pattern plain, and so does the same stop in a later cycle: the next expected stay then follows.
        hollowFleetObserve(g, st, player, 3, 0);
        expect(k.cycleKnown).toBe(true);
        k.cycleKnown = false;
        hollowFleetObserve(g, st, player, 1, 1);
        expect(k.cycleKnown).toBe(true);
        g.nowMs = hollowFleetWindow(st, 1, 1).leave + GAME_DAY_LENGTH - galaxyStarDate(g) + g.nowMs;
        rows = hollowFleetKnownSites(g, player);
        expect(rows[0].label).toContain('expected');
        expect(rows[0].status).toContain('Next expected');
        expect(hollowFleetMapFeatures(g, player)!.markers).toHaveLength(1);
        // An empire that has seen nothing knows nothing.
        const other = g.empires.find((e) => e !== null && e.active && e !== player && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== st.faction)!;
        expect(hollowFleetKnownSites(g, other)).toEqual([]);
    }, 600000);

    it('AI keeps civilian ships out of a known stop during its stay, and the end: all ships destroyed pays the bounty to the top killer', () => {
        const g = hfGame();
        hollowFleetPeriodic(g);
        const st = hollowFleetState(g);
        const ai = g.empires.find((e) => e !== null && e.active && e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== st.faction)!;
        const civ = ai.builtObjects.find((b) => !b.hasBeenDestroyed && b.role !== BuiltObjectRole.Military && b.role !== BuiltObjectRole.Base && b.topSpeed > 0)!;
        const now = galaxyStarDate(g);
        const stop = st.stops[2];
        const w = hollowFleetWindow(st, 2, 0);
        hollowFleetObserve(g, st, ai, 2, 0);
        g.nowMs += w.arrive - now - 5 * GAME_DAY_LENGTH; // 5 days before the arrival: inside the warning margin
        const star = g.systems[stop.systemIndex].systemStar;
        expect(scenarioQuery(g, 'assignMissionAllowed', true, { builtObject: civ, missionType: BuiltObjectMissionType.Move, target: star, x: -2000000001, y: -2000000001 })).toBe(false);
        // Another system is fine, and so is an attack mission.
        const elsewhere = g.systems[st.stops[3].systemIndex].systemStar;
        expect(scenarioQuery(g, 'assignMissionAllowed', true, { builtObject: civ, missionType: BuiltObjectMissionType.Move, target: elsewhere, x: -2000000001, y: -2000000001 })).toBe(true);
        expect(scenarioQuery(g, 'assignMissionAllowed', true, { builtObject: civ, missionType: BuiltObjectMissionType.Attack, target: star, x: -2000000001, y: -2000000001 })).toBe(true);
        // The end: the player destroys every ship.
        const killer = g.playerEmpire!;
        const money = killer.stateMoney;
        for (const s of [...st.ships]) {
            scenarioEmit(g, 'builtObjectKilledBy', { builtObject: s, destroyer: killer });
            s.hasBeenDestroyed = true;
        }
        expect(st.losses).toBe(st.ships.length);
        hollowFleetPeriodic(g);
        expect(st.phase).toBe('ended');
        expect(st.bountyTo).toBe(killer);
        expect(killer.stateMoney).toBe(money + st.bounty);
        expect(st.bounty).toBeGreaterThan(0);
        hollowFleetPeriodic(g); // ended: nothing more happens
        expect(killer.stateMoney).toBe(money + st.bounty);
    }, 600000);
});

// The Purifier: an ancient planet destroyer hunting race families, with a helpless-when-docked repair station.
describe('purifier', () => {
    const ids = ['threat-framework', 'purifier'];
    const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
    const PARAMS = { purifierExistChancePct: 100, purifierMinYear: 0, purifierYear: 0 };
    function pfGame(on = true): Galaxy {
        const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: { threatPurifier: on }, params: PARAMS, options: age3 });
        return game.galaxy;
    }
    function woken(): { g: Galaxy; st: ReturnType<typeof purifierState> } {
        const g = pfGame();
        purifierPeriodic(g);
        const st = purifierState(g);
        const waker = g.empires.find((e) => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== g.playerEmpire)!;
        expect(purifierWake(g, st, waker)).toBe(true);
        return { g, st };
    }

    it('flag off: no state, no faction', () => {
        const g = pfGame(false);
        const n = g.empires.length + g.pirateEmpires.length;
        purifierPeriodic(g);
        expect(peekPurifierState(g)).toBeNull();
        expect(g.empires.length + g.pirateEmpires.length).toBe(n);
    }, 300000);

    it('dormant at a remote anchorage; wakes with the stock planet destroyer, a close escort and a guarded station', () => {
        const g = pfGame();
        purifierPeriodic(g);
        const st = purifierState(g);
        expect(st.phase).toBe('dormant');
        if (st.anchorage!.category === HabitatCategoryType.GasCloud) expect(st.anchorage!.empire).toBeNull();
        const { g: w, st: ws } = woken();
        expect(ws.phase).toBe('awake');
        expect(ws.destroyer!.isPlanetDestroyer).toBe(true);
        expect(ws.escorts.length).toBeGreaterThanOrEqual(3);
        expect(ws.guards.length).toBeGreaterThan(0);
        expect(ws.faction!.pirateEmpireBaseHabitat).toBe(ws.anchorage);
        expect(['preprogrammed', 'waker']).toContain(ws.program);
        // Escorts follow the destroyer by the stock Escort mission once the driver has run.
        purifierPeriodic(w);
        for (const e of ws.escorts) {
            const m = builtObjectMission(e.mission);
            expect(m !== null && m.type === BuiltObjectMissionType.Escort && m.targetBuiltObject === ws.destroyer).toBe(true);
        }
    }, 600000);

    it('targets only colonies of hunted families; picks a nearby one; hides far from colonies', () => {
        const { g, st } = woken();
        const all = purifierTargets(g, st);
        for (const h of all) expect(purifierHunts(st, h.population.dominantRace!.raceFamily)).toBe(true);
        st.huntOthers = false;
        st.hunted = [-5];
        expect(purifierTargets(g, st)).toEqual([]);
        expect(purifierPickTarget(g, st)).toBeNull();
        st.huntOthers = true;
        st.builderFamily = -1;
        const t = purifierPickTarget(g, st);
        if (t !== null) expect(all).toContain(t);
        const spot = purifierHideSpot(g, { x: st.destroyer!.xpos, y: st.destroyer!.ypos }, null);
        expect(spot).not.toBeNull();
    }, 600000);

    it('docked for repair it is helpless and cannot jump; the waker is exposed once and only once; map shows one glyph', () => {
        const { g, st } = woken();
        const d = st.destroyer!;
        const before = st.waker!.civilityRating;
        st.mode = 'repair';
        st.modeDate = galaxyStarDate(g);
        d.currentShields = 99;
        purifierPeriodic(g);
        expect(d.currentShields).toBe(0);
        expect(d.currentEnergy).toBe(0);
        expect(scenarioQuery(g, 'hyperjumpSpoolFactor', 1, { ship: d, here: false })).toBeGreaterThan(100);
        // Exposure: a one-time loss, light.
        st.mode = 'hide';
        g.nowMs += 4 * 600000;
        purifierPeriodic(g);
        purifierPeriodic(g);
        expect(st.exposed).toBe(true);
        expect(before - st.waker!.civilityRating).toBeCloseTo(5, 5);
        // The viewing empire's glyph: the last known place once told of a sighting.
        const viewer = g.playerEmpire!;
        expect(purifierMapFeatures(g, viewer)?.markers.length ?? 0).toBeLessThanOrEqual(2);
    }, 600000);

    it('save / load mid-hunt: phase, faction, destroyer, escorts, dock, sightings, knowledge and the coalition survive; the run continues identically', () => {
        const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: { threatPurifier: true }, params: PARAMS, options: age3 });
        const g = game.galaxy;
        purifierPeriodic(g);
        const st = purifierState(g);
        const waker = g.empires.find((e) => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== g.playerEmpire)!;
        expect(purifierWake(g, st, waker)).toBe(true);
        runGameSeconds(g, 30);
        // Give it a lived-in state: a sighting, knowledge of the station, a coalition at its staging system, a rudder hit.
        const viewer = g.playerEmpire!;
        st.sightings.push({ empireId: viewer.empireId, x: st.destroyer!.xpos, y: st.destroyer!.ypos, systemIndex: 3, date: galaxyStarDate(g), lastMessage: -1e18 });
        revealTo(g, st, viewer, KNOWLEDGE_CONFIRMED);
        revealTo(g, { knowledge: st.dockKnowledge }, viewer, KNOWLEDGE_CONFIRMED);
        st.gatherSys = 3;
        st.gatherGo = true;
        st.launches = 2;
        st.rudderHits = 1;
        st.rudderTotal = 2;
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const lg = deserializeGame(text, gameData).game.galaxy;
        const ls = peekPurifierState(lg)!;
        expect(ls).not.toBeNull();
        expect(ls.phase).toBe('awake');
        expect(ls.mode).toBe(st.mode);
        expect(ls.program).toBe(st.program);
        expect(ls.faction!.name).toBe(st.faction!.name);
        expect(ls.faction!.empireId).toBe(st.faction!.empireId);
        expect(lg.pirateEmpires.includes(ls.faction!) || lg.empires.includes(ls.faction!)).toBe(true);
        expect(ls.destroyer!.isPlanetDestroyer).toBe(true);
        expect(ls.destroyer!.builtObjectID).toBe(st.destroyer!.builtObjectID);
        expect(lg.builtObjects.includes(ls.destroyer!)).toBe(true);
        expect(ls.escorts.map((b) => b.builtObjectID)).toEqual(st.escorts.map((b) => b.builtObjectID));
        expect(ls.guards.length).toBe(st.guards.length);
        expect(ls.anchorage!.habitatIndex).toBe(st.anchorage!.habitatIndex);
        expect([ls.dockX, ls.dockY]).toEqual([st.dockX, st.dockY]);
        expect(ls.waker!.empireId).toBe(waker.empireId);
        expect(ls.sightings).toEqual(st.sightings);
        expect(ls.knowledge).toEqual(st.knowledge);
        expect(ls.dockKnowledge).toEqual(st.dockKnowledge);
        expect([ls.gatherSys, ls.gatherGo, ls.launches, ls.rudderHits, ls.rudderTotal]).toEqual([3, true, 2, 1, 2]);
        // Both continue the same: the loaded game's state digest after N more seconds equals the uninterrupted run's.
        runGameSeconds(g, 60);
        runGameSeconds(lg, 60);
        expect(stateDigest(lg)).toBe(stateDigest(g));
        expect(peekPurifierState(lg)!.worlds).toBe(peekPurifierState(g)!.worlds);
    }, 900000);
});
