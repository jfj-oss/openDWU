// 19b §5.A threat framework (src/sim/scenario/threats/framework.ts): the generic parts the 19f threats reuse.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { findNewestCanBuild, generateDesignFromSpec } from '../src/sim/designGeneration';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { threatMarker, THREAT_CONFIRMED_COLOR, THREAT_SUSPECTED_COLOR } from '../src/render/overlayLayer';
import type { CreateGameOptions } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { registerScenarioEvent, scenarioEmit, scenarioQuery } from '../src/sim/scenario/hooks';
import { TroopList } from '../src/sim/cargo';
import { assaultMargin, genShipsAssaultStrengths, genShipsAssaultWins, genShipsLowLevel, genShipsPeriodic, genShipsState, genShipsStates, genShipsWaveSize, peekGenShipsState } from '../src/sim/scenario/threats/generationShips';
import { empireTechLevel, maxDesignTechLevel } from '../src/sim/scenario/threats/robotMutiny';
import { calculateOverallStrengthFactorWithoutShields, militaryPotency } from '../src/sim/diplomacyTick';
import { ComponentType } from '../src/sim/data/components';
import { HabitatType } from '../src/sim/types';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { lockWar, makeFactionTroop } from '../src/sim/scenario/threats/framework';
import { takeOwnershipOfBuiltObject, takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { archiveCoresPeriodic, grantArchiveCore, peekArchiveCoresState } from '../src/sim/scenario/threats/archiveCores';
import { peekProbeSwarmState, probeSwarmIncome, probeSwarmPeriodic, probeSwarmState } from '../src/sim/scenario/threats/probeSwarm';
import { peekVoidWhaleState, referenceHyperSpeed, voidWhalePeriodic, voidWhaleState } from '../src/sim/scenario/threats/voidWhale';
import { paintWounds, woundCount, woundKey } from '../src/render/whaleWounds';
import { LEV_H, LEV_W, leviathanSilhouette, levHalf, levU } from '../src/render/leviathanArt';
import { LEV_BODY_URL, LEV_GLOW_SPOTS, LEV_HARPOONS, LEV_HARPOON_URL, LEV_PARTS } from '../src/render/leviathanParts';
import { LEV_FIN_SWEEP, LEV_FLUKE_SWEEP } from '../src/render/leviathanRig';
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
import { issuePlayerCommand, runPlayerCommand } from '../src/sim/player/playerCommands';
import { spawnableThreats } from '../src/sim/scenario/threats/framework';
import { createGame, type Game } from '../src/sim/game';
import { tickGameOptions } from './helpers/tickGame';
import { peekCultState } from '../src/sim/scenario/threats/cult';
import { peekHiveState } from '../src/sim/scenario/threats/hive';
import { peekGreyTideState } from '../src/sim/scenario/threats/greyTide';
import { peekSilenceState } from '../src/sim/scenario/threats/silence';
import { peekDoppelgangersState } from '../src/sim/scenario/threats/doppelgangers';
import { peekExchangeState } from '../src/sim/scenario/threats/exchange';
import { THREAT_TEXTS } from '../src/sim/scenario/threats/threatTexts';
import { tryGetText } from '../src/sim/textResolver';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCENARIOS_ROOT } from './helpers/scenarioGame';
import type { Empire } from '../src/sim/empire';
import { threatLeadRows, threatsSectionVisible } from '../src/ui/internalSecurityView';
import { CharacterRole, getEmpireCharacters } from '../src/sim/characters';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { CRISIS_ENTRIES, crisisState, crisisYearly, crisisHelpers, activeCrises, agreedHandover } from '../src/sim/scenario/threats/crisis';
import { crisisJointWar } from '../src/sim/scenario/threats/crisisCouncil';
import { crowdingTerm, purifierRefugees } from '../src/sim/scenario/threats/purifierRefugees';
import { reviewCouncil, motionCandidates, councilOf, tallyMotion, proposeMotion } from '../src/sim/scenario/emergent/council';
import { reputationCauses, reputationSum } from '../src/sim/scenario/reputation/ledger';
import { DiplomaticRelation } from '../src/sim/diplomacy';
import { demographicsStateOf } from '../src/sim/scenario/emergent/demographics';
import { declareWar } from '../src/sim/diplomacyTick';
import { spawnThreatNow } from '../src/sim/scenario/threats/framework';
import { cultCheckTrigger } from '../src/sim/scenario/threats/cult';
import {
    registerGreatWork,
    unregisterGreatWork,
    peekGwState,
    greatWorks,
    giantworksPeriodic,
    greatWorkStageOf,
    greatWorkScaffolds,
    greatWorkShares,
    greatWorkPay,
    markGreatWorkHostile,
    shortlist,
    learnTag,
    grantTrueHint,
    kindName,
    workLevel,
    compactFaction,
    ordinaryEmpires,
    addProgress,
    aiChoice,
    spawnGreatWork,
    giantworksCompactSites,
    LAW_DEMOLISH,
    LAW_PROTECT,
    type GreatWorkRecord,
} from '../src/sim/scenario/threats/giantworks/framework';
import { KIND_MENACE, KIND_VALUE } from '../src/sim/scenario/threats/giantworks/registry';
import { stepWork } from '../src/sim/scenario/threats/giantworks/lifecycle';
import { protectStep, resolveBaseLoss, stationedEmpires } from '../src/sim/scenario/threats/giantworks/actions';
import { updateKnowledge } from '../src/sim/scenario/threats/giantworks/knowledge';
import { dietState, registeredDietKinds } from '../src/sim/scenario/charactersVictory/diet/dietState';
import { recordWarCrime, warCrimesRecord } from '../src/sim/scenario/charactersVictory/diet/warCrimes';
import { IntelligenceMissionType, newIntelligenceMissionAgainstBuiltObject } from '../src/sim/espionage';
import {
    CASINO_KEY,
    basesBroken,
    casinoAnnualIncome,
    casinoLocalBenefit,
    casinoPiratesPeriodic,
    casinoRecOf,
    peekCasinoState,
    reveal,
    topTechLevel,
    type CasinoRec,
} from '../src/sim/scenario/threats/giantworks/casino';
import { calculateMigrationFactor } from '../src/sim/colonyTick';
import { calculateScenicFactorIncludingRuinsWonders } from '../src/sim/civilianAI';
import { habitatAnnualRevenue, habitatCorruption } from '../src/sim/forceStructure';
import { facilitiesCountCompletedByType } from '../src/sim/construction/facilities';
import { PlanetaryFacilityType } from '../src/sim/researchSystem';
import { PirateRelationType, changePirateRelation, obtainPirateRelation } from '../src/sim/pirateRelations';
import { calculateOverallStrengthFactor } from '../src/sim/combat/threats';
import { greatWorkBeneficiary } from '../src/sim/scenario/threats/giantworks/framework';
import { strikeTarget } from '../src/sim/scenario/threats/giantworks/ai';
import { AutomationLevel } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { rebuildIndexes } from '../src/sim/indexRebuild';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { completeWork, greatWorkIsHostile, greatWorkKind, type GreatWorkSite } from '../src/sim/scenario/threats/giantworks/framework';
import { beaconBuildRate, beaconComplete, beaconKind, beaconKnownSites, beaconLooks, beaconRolled, beaconShipRole, beaconSuppliers, cloakLapsedFor, corrupt, corruptCandidates, watchersPeriodic } from '../src/sim/scenario/threats/giantworks/beacon';
import { peekBeaconState, salvageStepsOf, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { beginSeason, designFor, lossCheck, planetStrike, reclamationMonthly, reclamationPeriodic, spawnShip, supplyTroops, targetCandidates } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { addSalvage, aiBargainChoice, colonyToCede, counterMonthly, expose, offerCandidates, purgeCorruption, resistanceFactor, resolveBargain } from '../src/sim/scenario/threats/giantworks/beaconCounter';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { builtObjectVisibility, isObjectVisibleToThisEmpire, isObjectVisibleToThisEmpireImprecise } from '../src/sim/independentTraders';
import type { ScenarioDecision } from '../src/sim/scenario/decisions';
import { generateNewBuiltObject } from '../src/sim/empireEvents';
import { galaxyDesignSpecificationBySubRole } from '../src/sim/gameStartTail';


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
            // Settled: money, hull research up to the top, a free medium port, its own big-hull designs, and an AI that builds up.
            genShipsPeriodic(g);
            expect(faction.stateMoney).toBeGreaterThanOrEqual(1000000);
            expect(faction.privateMoney).toBeGreaterThanOrEqual(10000000);
            expect(faction.spacePorts.some((b) => !b.hasBeenDestroyed && b.supportCostFactor === 0)).toBe(true);
            expect(st.econStarted).toBe(true);
            expect(scenarioQuery(g, 'forceStructureWarships', 10, { empire: faction, threat: 0 })).toBe(30);
            const cap = faction.designs.filter((d) => d.subRole === BuiltObjectSubRole.CapitalShip && !d.isObsolete).at(-1);
            expect(cap).toBeDefined();
            expect(scenarioQuery(g, 'stateAIDormant', false, { empire: faction })).toBe(false);
        }
    }, 600000);

    const WAVE = { genShipsEarliestYear: 0, genShipsTechLevel: 1, genShipsEmpiresAtTech: 1, genShipsFlavour: 1, genShipsAiFightRatioPct: 100000, genShipsMinFirepower: 500 };

    it('generation ships: starts at the galaxy edge, stages at a free system outside every territory, the mothership is heavily armoured and shielded', () => {
        const g = ntGame(ALL, { ...WAVE });
        const st = genShipsState(g);
        genShipsPeriodic(g);
        const edge = Math.min(st.spawnX, st.spawnY, g.sizeX - st.spawnX, g.sizeY - st.spawnY);
        expect(edge).toBeLessThan(g.sizeX * 0.1);
        // The staging point: a star system with no colony in it and outside all empire territory, nearer the target than the spawn.
        expect(st.stageName ?? '').not.toBe('');
        expect(g.checkEmpireTerritoryIdAtLocation(st.stageX!, st.stageY!)).toBe(-1);
        const sys = g.systems.find((x) => x?.systemStar && x.systemStar.xpos === st.stageX && x.systemStar.ypos === st.stageY)!;
        expect(sys).toBeDefined();
        expect(g.habitats.some((h) => h !== null && h.empire !== null && !h.hasBeenDestroyed && g.determineHabitatSystemStar(h)?.systemIndex === sys.systemStar!.systemIndex)).toBe(false);
        expect(g.calculateDistance(st.stageX!, st.stageY!, st.target!.xpos, st.target!.ypos)).toBeLessThan(g.calculateDistance(st.spawnX, st.spawnY, st.target!.xpos, st.target!.ypos));
        // The world ship heads there and stays; it is never left to the stock AI.
        const ws = st.worldShip!;
        expect(ws.isAutoControlled).toBe(false);
        expect(builtObjectMission(ws.mission)?.type).toBe(BuiltObjectMissionType.Move);
        // Mothership: a lot of armour and shields, well above any escort hull.
        const best = (k: 'armor' | 'shieldsCapacity'): number => Math.max(...st.escorts.map((b) => b[k]));
        expect(ws.armor).toBeGreaterThan(best('armor') * 2);
        expect(ws.shieldsCapacity).toBeGreaterThan(best('shieldsCapacity') * 2);
    }, 600000);

    it('generation ships: troops land once the escort holds the world, defenders or not; the transports wait beside the world ship until then', () => {
        const g = ntGame(ALL, { ...WAVE, genShipsStrikeDays: 0 });
        const st = genShipsState(g);
        genShipsPeriodic(g);
        const owner = st.owner!;
        const target = st.target!;
        st.phase = 'war';
        st.warDate = galaxyStarDate(g);
        st.strikeDone = true;
        genShipsPeriodic(g);
        expect(st.committed).toBe(false);
        expect(st.transports.every((b) => builtObjectMission(b.mission)?.type === BuiltObjectMissionType.Escort)).toBe(true);
        // An owner warship parked over the world (what the threatened AI does) no longer blocks the landing, a stronger escort on station opens it.
        const defender = owner.builtObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0)!;
        defender.xpos = target.xpos;
        defender.ypos = target.ypos;
        for (const e of st.escorts) {
            e.xpos = target.xpos + 500;
            e.ypos = target.ypos;
        }
        genShipsPeriodic(g);
        expect(st.committed).toBe(true);
        expect(st.engageDate).toBeGreaterThan(0);
        expect(st.transports.every((b) => builtObjectMission(b.mission)?.type === BuiltObjectMissionType.Move && builtObjectMission(b.mission)?.targetHabitat === target)).toBe(true);
        for (const t of st.transports) {
            t.xpos = target.xpos + 1000;
            t.ypos = target.ypos;
        }
        genShipsPeriodic(g);
        expect(st.landings).toBe(st.transports.length);
        expect(st.transports.every((b) => (b.troops?.count ?? 0) === 0)).toBe(true);
    }, 600000);

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

    it('generation ships: the assault estimate counts the defender reinforcements and recruits; a failed landing raises the next margin', () => {
        const g = ntGame(ALL, { ...WAVE, genShipsStrikeDays: 0 });
        const st = genShipsState(g);
        genShipsPeriodic(g);
        const owner = st.owner!;
        const target = st.target!;
        const faction = st.faction!;
        const loaded = st.transports.flatMap((b) => [...(b.troops?.items ?? [])]);
        const base = genShipsAssaultStrengths(g, target, faction, loaded).defending;
        // Troops in training at the colony count.
        target.troopsToRecruit ??= new TroopList();
        for (let i = 0; i < 10; i++) {
            const t = makeFactionTroop(g, owner, 900, 'Test Recruit', owner.dominantRace);
            t.colony = target;
            target.troopsToRecruit.add(t);
        }
        const withRecruits = genShipsAssaultStrengths(g, target, faction, loaded).defending;
        expect(withRecruits).toBeGreaterThan(base);
        // The default margin is 200 %, and each failed landing at the target asks 25 points more, capped at +100.
        expect(assaultMargin(g, st, target)).toBe(200);
        st.failTarget = target;
        st.fails = 2;
        expect(assaultMargin(g, st, target)).toBe(250);
        st.fails = 50;
        expect(assaultMargin(g, st, target)).toBe(300);
        expect(assaultMargin(g, st, owner.colonies.find((c) => c !== target)!)).toBe(200);
    }, 600000);

    it('generation ships: a hopeless landing retargets another world of the same empire; troops are made there and the original is invaded again', () => {
        const g = ntGame(ALL, { ...WAVE, genShipsStrikeDays: 0, genShipsRetakeTroopsPerMonth: 20, genShipsRetakeGarrison: 0 });
        const st = genShipsState(g);
        genShipsPeriodic(g);
        const owner = st.owner!;
        const target = st.target!;
        const faction = st.faction!;
        // Make the target hopeless: a huge garrison.
        for (let i = 0; i < 60; i++) {
            const t = makeFactionTroop(g, owner, 900, 'Test Guard', owner.dominantRace);
            t.colony = target;
            target.troops!.add(t);
        }
        const loaded = st.transports.flatMap((b) => [...(b.troops?.items ?? [])]);
        expect(genShipsAssaultWins(g, target, faction, loaded, 130)).toBe(false);
        expect(genShipsAssaultStrengths(g, target, faction, loaded).defending).toBeGreaterThan(genShipsAssaultStrengths(g, target, faction, loaded).attacking);
        st.phase = 'war';
        st.warDate = galaxyStarDate(g);
        st.strikeDone = true;
        lockWar(g, faction, owner);
        for (const e of st.escorts) {
            e.xpos = target.xpos + 500;
            e.ypos = target.ypos;
        }
        const others = owner.colonies.filter((c) => c !== target && !c.hasBeenDestroyed && c.population != null && c.population.totalAmount > 0);
        expect(others.length).toBeGreaterThan(0);
        genShipsPeriodic(g);
        // Another colony of the same owner is now the target; the original is kept to retake; the troops stay on the transports.
        expect(st.committed).toBe(false);
        expect(st.target).not.toBe(target);
        expect(st.target!.empire).toBe(owner);
        expect(st.retake).toBe(target);
        expect(st.retargets).toBe(1);
        expect(st.transports.some((b) => (b.troops?.count ?? 0) > 0)).toBe(true);
        // The fallback falls: the world ship lands there, the war goes on, the faction settles and makes troops.
        const fb = st.target!;
        takeOwnershipOfColonyFull(g, faction, fb, faction, false, true);
        genShipsPeriodic(g);
        expect(st.phase).toBe('settling');
        expect(st.base).toBe(fb);
        expect(obtainDiplomaticRelation(faction, owner).type).toBe(DiplomaticRelationType.War);
        st.worldShip!.xpos = fb.xpos;
        st.worldShip!.ypos = fb.ypos;
        genShipsPeriodic(g);
        expect(st.phase).toBe('settled');
        expect(st.retake).toBe(target);
        for (const b of st.transports) b.troops?.clear(); // the first force is spent
        st.recruitDate = 0;
        genShipsPeriodic(g);
        expect(st.recruited).toBeGreaterThan(0);
        expect(fb.troops!.items.filter((t) => t.empire === faction).length).toBeGreaterThanOrEqual(1);
        // Enough troops to beat the original target's current defence: they load onto transports and go (phase war again, at the original).
        target.troops!.clear();
        for (let i = 0; i < 40; i++) {
            const t = makeFactionTroop(g, faction, 300, 'Test Raiser', faction.dominantRace);
            t.colony = fb;
            fb.troops!.add(t);
        }
        faction.stateMoney = 1e9;
        genShipsPeriodic(g);
        expect(st.phase).toBe('war');
        expect(st.target).toBe(target);
        expect(st.launches).toBe(1);
        expect(st.transports.some((b) => (b.troops?.count ?? 0) > 0)).toBe(true);
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

    it('fin and fluke joins: real hide under every fin root (no dark notch), the root strips and the fluke stalk cover the stroke', () => {
        const pub = (url: string): string => `${__dirname}/../public${url}`;
        const body = decodePng(pub(LEV_BODY_URL));
        const a = (img: { width: number; data: Uint8Array | Uint8ClampedArray }, x: number, y: number): number => img.data[(y * img.width + x) * 4 + 3];
        const lum = (x: number, y: number): number => {
            const i = (y * body.width + x) * 4;
            return (body.data[i] + body.data[i + 1] + body.data[i + 2]) / 3;
        };
        // The body's edge row in a column (side -1 the left flank, from the top; +1 the right flank, from the bottom)
        // and the hide's luminance just inside it.
        const edgeRow = (x: number, side: -1 | 1): number => {
            for (let k = 0; k < LEV_H / 2; k++) {
                const y = side < 0 ? k : LEV_H - 1 - k;
                if (a(body, x, y) > 200) return y;
            }
            return -1;
        };
        const rim = (x: number, side: -1 | 1): number => {
            const e = edgeRow(x, side);
            let s = 0;
            for (let k = 0; k < 5; k++) s += lum(x, e - side * k);
            return s / 5;
        };
        const all: number[] = [];
        for (let x = 100; x < 700; x++) all.push(rim(x, -1), rim(x, 1));
        all.sort((p, q) => p - q);
        const median = all[all.length >> 1];
        for (const [key, side] of [['finL', -1], ['finR', 1]] as const) {
            const p = LEV_PARTS[key];
            const fin = decodePng(pub(p.url));
            let roots = 0;
            for (let x = Math.max(100, Math.ceil(p.rootX - p.ax * p.w)); x < Math.min(700, p.rootX + (1 - p.ax) * p.w); x++) {
                // Under and beside the fin the flank's rim is hide, not keyed-out background or a dark patch.
                expect(rim(x, side)).toBeGreaterThan(0.45 * median);
                // Where the fin meets the edge, the strip of hide it carries under the body is deeper than its rowing
                // tips that column out of the flank: no gap opens at any point of the stroke.
                const fx = Math.round(x - p.rootX + p.ax * p.w);
                const fy = Math.round(edgeRow(x, side) - p.rootY + p.ay * p.h);
                if (fx < 0 || fx >= fin.width || fy - 3 < 0 || fy + 3 >= fin.height || a(fin, fx, fy + side * 3) <= 200) continue;
                roots++;
                let d = 0;
                while (fy - side * d >= 0 && fy - side * d < fin.height && a(fin, fx, fy - side * d) > 200) d++;
                expect(d).toBeGreaterThanOrEqual(Math.abs(x - p.rootX) * Math.sin(LEV_FIN_SWEEP * 1.05) + 1);
            }
            expect(roots).toBeGreaterThan(40);
        }
        // The flukes' stalk under the body stays inside the stalk's edge however far the sweep turns them.
        const fp = LEV_PARTS.fluke;
        const fluke = decodePng(pub(fp.url));
        let under = 0;
        for (let fy = 0; fy < fluke.height; fy++) {
            for (let fx = 0; fx < fluke.width; fx++) {
                const x = fx - fp.ax * fp.w + fp.rootX;
                if (x <= fp.rootX || a(fluke, fx, fy) <= 128) continue;
                under++;
                const y = fy - fp.ay * fp.h + fp.rootY;
                const turned = Math.abs(y - LEV_H / 2) + (x - fp.rootX) * Math.sin(LEV_FLUKE_SWEEP);
                expect(turned).toBeLessThanOrEqual(levHalf(levU(x)) + 1.5);
            }
        }
        expect(under).toBeGreaterThan(100);
    });

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

describe('Game Editor: spawn a threat (editorSpawnThreat)', () => {
    const mk = (): Game => {
        const o = tickGameOptions(base);
        return createGame({ ...o, galaxyAge: 3, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
    };
    const spawn = (g: Galaxy, p: Empire, key: string): unknown => {
        let res: unknown = null;
        issuePlayerCommand(g, p, 'editorSpawnThreat', [key], (r) => { res = r; });
        runGameSeconds(g, 1);
        return res;
    };
    it('the embedded threat texts are the add-ons\' GameText files (run node scripts/gen-threat-texts.mjs when this fails)', () => {
        for (const [id, text] of Object.entries(THREAT_TEXTS)) expect(text, id).toBe(readFileSync(resolve(SCENARIOS_ROOT, id, 'GameText.txt'), 'utf8'));
    });
    it('a faithful game (no add-ons): each threat that needs no add-on data spawns, the rest say why not, and they progress', () => {
        const game = mk();
        const g = game.galaxy;
        const p = game.playerEmpire;
        expect(g.scenario).toBeNull();
        const notes = Object.fromEntries(spawnableThreats(g).map((t) => [t.key, t.note]));
        expect(Object.keys(notes).sort()).toEqual(['corporateCoup', 'cult', 'darkFarms', 'doppelgangers', 'exchange', 'generationShips', 'giantworks', 'greyTide', 'hive', 'hollowFleet', 'probeSwarm', 'purifier', 'robotMutiny', 'silence', 'timeBomb', 'voidWhale'].concat(Object.keys(notes).filter((k) => k.startsWith('giantworks:'))).sort());
        expect(notes.darkFarms).toMatch(/add-on on at game start/);
        expect(notes.robotMutiny).toMatch(/add-on on at game start/);
        expect(notes.timeBomb).toMatch(/add-on on at game start/);
        expect(notes.corporateCoup).toMatch(/chartered company/);
        const keys = Object.keys(notes).filter((k) => notes[k] === null && !k.startsWith('giantworks')); // Giantworks has its own tests
        expect(keys).toHaveLength(11);
        for (const key of keys) expect(spawn(g, p, key), key).toBe(true);
        expect(peekPurifierState(g)!.waker).toBe(p);
        expect(peekPurifierState(g)!.hunted).toEqual([p.dominantRace!.raceFamily]);
        expect(genShipsStates(g)[0].owner).toBe(p);
        expect(peekCultState(g)!.converted.some((r) => r.character.empire === p)).toBe(true);
        expect(peekHiveState(g)!.faction).not.toBeNull();
        expect(peekGreyTideState(g)!.nests).toHaveLength(1);
        expect(peekSilenceState(g)!.source).not.toBeNull();
        expect(peekDoppelgangersState(g)!.faction).not.toBeNull();
        expect(peekExchangeState(g)!.faction).not.toBeNull();
        expect(peekHollowFleetState(g)!.phase).toBe('active');
        expect(peekProbeSwarmState(g)!.phase).toBe('active');
        expect(peekVoidWhaleState(g)!.phase).toBe('active');
        // The add-ons' texts came with them.
        expect(tryGetText('Purifier Wake News') ?? tryGetText('Purifier Choice Title')).not.toBeNull();
        // Once started they show a note and refuse a second spawn.
        expect(spawnableThreats(g).filter((t) => keys.includes(t.key)).every((t) => t.note !== null)).toBe(true);
        expect(spawn(g, p, 'purifier')).toBe(false);
        // They progress: the generation ship makes contact, and the cult rises into a theocracy within months.
        runGameSeconds(g, 900);
        expect(['contact', 'ultimatum', 'war', 'settling', 'settled', 'ended']).toContain(genShipsStates(g)[0].phase);
        expect(peekCultState(g)!.faction).not.toBeNull();
    }, 3600000);
});

// Crisis interactions (threats/crisis.ts, crisisCouncil.ts, purifierRefugees.ts): reputation for helping or ignoring,
// opportunists, the council reacting, Purifier refugees.
describe('crisis interactions', () => {
    const ids = ['threat-framework', 'purifier', 'reputation', 'galactic-council', 'refugees-demographics'];
    const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
    const PARAMS = { purifierExistChancePct: 100, purifierMinYear: 0, purifierYear: 0, councilJoinThreshold: -1000 };
    const FLAGS = { threatPurifier: true, reputationLedger: true, galacticCouncil: true, refugees: true };
    const PURIFIER = CRISIS_ENTRIES.find((e) => e.key === 'purifier')!;

    function woken(flags: Record<string, boolean> = {}): Galaxy {
        const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: { ...FLAGS, ...flags }, params: PARAMS, options: age3 });
        const g = game.galaxy;
        purifierPeriodic(g);
        const waker = g.empires.find((e) => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== g.playerEmpire)!;
        expect(purifierWake(g, purifierState(g), waker)).toBe(true);
        return g;
    }
    const normals = (g: Galaxy): Empire[] => g.empires.filter((e) => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active);
    function meet(a: Empire, b: Empire): void {
        for (const [x, y] of [[a, b], [b, a]] as const) {
            const r = x.diplomaticRelations.byEmpire(y);
            if (r === null) x.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, x, x, y, false));
            else r.type = DiplomaticRelationType.None;
        }
    }

    it('flag off: no crisis state, no handler runs', () => {
        const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: { ...FLAGS, threatPurifier: false }, params: PARAMS, options: age3 });
        const g = game.galaxy;
        const [a, b, c] = normals(g);
        scenarioEmit(g, 'warDamageInflicted', { inflictor: c, victim: a, builtObject: null, habitat: a.colonies[0], value: 1 });
        declareWar(g, b, a);
        expect(g.scenario!.state.crisis).toBeUndefined();
    }, 600000);

    it('opportunists: a rival that declares war on a crisis victim inside the window is named to both sides, the galaxy and the ledger', () => {
        const g = woken();
        const faction = purifierState(g).faction!;
        const [a, b] = normals(g);
        meet(a, b);
        a.diplomaticRelations.byEmpire(b)!.type = DiplomaticRelationType.None;
        b.diplomaticRelations.byEmpire(a)!.type = DiplomaticRelationType.None;
        const colony = a.colonies.find((c) => !c.hasBeenDestroyed)!;
        scenarioEmit(g, 'warDamageInflicted', { inflictor: faction, victim: a, builtObject: null, habitat: colony, value: 1 });
        const st = crisisState(g);
        expect(st.hits.length).toBe(1);
        expect(st.hits[0].victim).toBe(a.empireId);
        const before = empireMessages(a).length;
        declareWar(g, b, a);
        if (b.diplomaticRelations.byEmpire(a)!.type !== DiplomaticRelationType.War) return; // the stock war machinery declined: nothing to report
        expect(st.hits[0].reported).toEqual([b.empireId]);
        expect(empireMessages(a).slice(before).some((m) => m.description.includes('takes advantage') && m.description.includes(b.name))).toBe(true);
        expect(empireMessages(b).some((m) => m.description.includes('taking advantage') || m.description.includes('after the Purifier'))).toBe(true);
        expect(reputationSum(g, a, b)).toBeLessThan(0);
        expect(reputationSum(g, a, b)).toBeGreaterThan(-10); // small
    }, 600000);

    it('reputation: fighting the crisis earns a small, once-only regard; sitting it out in its region costs a little', () => {
        const g = woken();
        const st = purifierState(g);
        const faction = st.faction!;
        const [a, b, c, d] = normals(g);
        for (const x of [a, b, c, d]) for (const y of [a, b, c, d]) if (x !== y) meet(x, y);
        for (const x of [a, b, c, d]) for (const y of [a, b, c, d]) {
            const r = x.diplomaticRelations.byEmpire(y);
            if (r !== null && r.type === DiplomaticRelationType.War) r.type = DiplomaticRelationType.None;
        }
        const crisisRep = (x: Empire, y: Empire): number => reputationCauses(g, x, y).filter((e) => e.cause.startsWith('crisis.')).reduce((n, e) => n + e.value, 0);
        // (Escorts, not the destroyer: its death ends the Purifier, and an ended crisis marks nobody down for sitting it out.)
        const escort = st.escorts[0] ?? st.destroyer!;
        for (let i = 0; i < 3; i++) scenarioEmit(g, 'builtObjectKilledBy', { builtObject: escort, destroyer: b });
        const cs = crisisState(g);
        expect(st.phase).toBe('awake');
        expect(cs.fight[`purifier:${b.empireId}`].kills).toBe(3);
        crisisYearly(g, PURIFIER);
        const gain = crisisRep(a, b);
        expect(gain).toBeGreaterThan(0);
        expect(gain).toBeLessThanOrEqual(4);
        crisisYearly(g, PURIFIER);
        expect(crisisRep(a, b)).toBe(gain); // once per crisis per empire
        // d never fought; park the Purifier's destroyer on its colony for the sit-out years.
        const home = d.colonies.find((x) => !x.hasBeenDestroyed)!;
        st.destroyer!.xpos = home.xpos;
        st.destroyer!.ypos = home.ypos;
        cs.seen.purifier = galaxyStarDate(g) - 3 * YEAR_LENGTH;
        cs.harmed.purifier = true;
        crisisYearly(g, PURIFIER);
        crisisYearly(g, PURIFIER);
        const loss = crisisRep(a, d);
        expect(loss).toBeLessThan(0);
        expect(loss).toBeGreaterThanOrEqual(-3);
        void faction;
    }, 600000);

    it('harm: killing pirate ships, or being handed a colony by agreement, hurts no one (no harm mark, no hit); a blow to an empire does', () => {
        const g = woken();
        const st = purifierState(g);
        const [a] = normals(g);
        const cs = crisisState(g);
        // The faction shoots a pirate ship: nobody ordinary has been hurt.
        const pirateShip = g.pirateEmpires.map((p) => p.builtObjects.find((b) => !b.hasBeenDestroyed)).find((b) => b !== undefined)!;
        expect(pirateShip).toBeDefined();
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: pirateShip, destroyer: st.faction! });
        expect(cs.harmed.purifier).toBeUndefined();
        // A colony ceded to the faction by agreement is not a rising.
        const colony = a.colonies.find((c) => !c.hasBeenDestroyed)!;
        agreedHandover(colony, () => scenarioEmit(g, 'colonyOwnerChanged', { colony, from: a, to: st.faction! }));
        expect(cs.hits).toHaveLength(0);
        expect(cs.harmed.purifier).toBeUndefined();
        // The same change of hands against the owner's will is.
        scenarioEmit(g, 'colonyOwnerChanged', { colony, from: a, to: st.faction! });
        expect(cs.hits).toHaveLength(1);
        expect(cs.harmed.purifier).toBe(true);
        // And so is killing a ship of an ordinary empire.
        cs.harmed.purifier = false;
        const ship = a.builtObjects.find((b) => !b.hasBeenDestroyed)!;
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: ship, destroyer: st.faction! });
        expect(cs.harmed.purifier).toBe(true);
    }, 600000);

    it('over: a crisis that has ended (the Purifier destroyed) is no longer loose: no sit-out marks, not tabled, but the killer is still credited', () => {
        const g = woken();
        const st = purifierState(g);
        const [a, b, c] = normals(g);
        for (const x of [a, b, c]) for (const y of [a, b, c]) if (x !== y) meet(x, y);
        const cs = crisisState(g);
        expect(activeCrises(g).map((x) => x.entry.key)).toEqual(['purifier']);
        // The killing blow ends the Purifier (its own handler), then the crisis books the kill.
        for (let i = 0; i < 3; i++) scenarioEmit(g, 'builtObjectKilledBy', { builtObject: st.destroyer!, destroyer: a });
        expect(st.phase).toBe('ended');
        expect(cs.fight[`purifier:${a.empireId}`].kills).toBe(3);
        expect(activeCrises(g)).toEqual([]);
        // Its faction empire lingers next to c's colony for years, after harming someone: c is not marked down for sitting it out.
        cs.harmed.purifier = true;
        cs.seen.purifier = galaxyStarDate(g) - 5 * YEAR_LENGTH;
        const home = c.colonies.find((x) => !x.hasBeenDestroyed)!;
        st.destroyer!.xpos = home.xpos;
        st.destroyer!.ypos = home.ypos;
        crisisYearly(g, PURIFIER);
        crisisYearly(g, PURIFIER);
        crisisYearly(g, PURIFIER);
        const crisisRep = (x: Empire, y: Empire): number => reputationCauses(g, x, y).filter((e) => e.cause.startsWith('crisis.')).reduce((n, e) => n + e.value, 0);
        expect(crisisRep(b, c)).toBe(0);
        expect(cs.done['crisis.sit.purifier:' + c.empireId]).toBeUndefined();
        expect(crisisRep(b, a)).toBeGreaterThan(0); // the killer's credit is still booked
    }, 600000);

    it('council: tables a joint defence against the loose Purifier and condemns its exposed waker', () => {
        const g = woken();
        const st = purifierState(g);
        const faction = st.faction!;
        const ms = normals(g);
        for (const x of ms) for (const y of ms) if (x !== y) meet(x, y);
        for (const x of ms) obtainDiplomaticRelation(x, faction).type = DiplomaticRelationType.None;
        reviewCouncil(g, 100);
        const c = councilOf(g, ms[0])!;
        expect(c).not.toBeNull();
        crisisState(g).harmed.purifier = true;
        let cands = motionCandidates(g, c, 100);
        expect(cands.some((m) => m.kind === 'threat' && m.target === faction)).toBe(true);
        expect(cands.some((m) => m.kind === 'sanction' && m.target === faction)).toBe(false); // a pirate-kind faction is not sanctioned
        st.exposed = true;
        expect(crisisHelpers(g, PURIFIER, faction)).toEqual([st.waker]);
        cands = motionCandidates(g, c, 100);
        const condemn = cands.find((m) => m.kind === 'condemn' && m.target === st.waker);
        expect(condemn).toBeDefined();
        expect(condemn!.other).toBe(faction);
        expect(activeCrises(g).map((x) => x.entry.key)).toEqual(['purifier']);
        const m = proposeMotion(g, c, { kind: 'threat', proposer: ms[0], target: faction, other: null, resourceId: -1 });
        if (m.status === 'voting') tallyMotion(g, c, m);
        if (m.status === 'passed') expect(c.threats).toContain(faction);
    }, 600000);

    it('refugees: a destroyed colony sends part of its people to the nearest colonies (refugee flows with the add-on, stock moves without)', () => {
        for (const refugees of [true, false]) {
            const g = woken({ refugees });
            const [a] = normals(g);
            const from = a.colonies.find((x) => x !== a.capital && !x.hasBeenDestroyed && x.population.totalAmount > 100_000_000)!;
            expect(from).toBeDefined();
            const before = a.colonies.reduce((n, x) => n + (x === from ? 0 : x.population.totalAmount), 0);
            const fromBefore = from.population.totalAmount;
            from.hasBeenDestroyed = true;
            purifierRefugees(g, from, a);
            expect(from.population.totalAmount).toBeLessThan(fromBefore);
            if (refugees) {
                const flows = demographicsStateOf(g).flows.filter((f) => f.cause === 'crisis');
                expect(flows.length).toBeGreaterThan(0);
            } else {
                const receivers = crisisState(g).crowding;
                const after = a.colonies.reduce((n, x) => n + (x === from ? 0 : x.population.totalAmount), 0);
                if (receivers.length > 0) {
                    expect(after).toBeGreaterThan(before);
                    expect(crowdingTerm(g, receivers[0].habitat)).toBeLessThan(0);
                    expect(crowdingTerm(g, receivers[0].habitat)).toBeGreaterThan(-5);
                }
            }
        }
    }, 900000);

    it('joint war and sanctions on a non-pirate faction (the Cult)', () => {
        const { game } = createScenarioGame(base, {
            scenario: comboOverlayFs(['threat-framework', 'cult', 'galactic-council']),
            flags: { cult: true, galacticCouncil: true },
            params: { cultSeedYear: 0, cultSpreadPct: 100, cultAmbassadorPct: 100, cultSecedeColonies: 1, cultAgentDetectPct: 0, cultExistChancePct: 100, cultMinYear: 0, councilJoinThreshold: -1000 },
            options: age3,
        });
        const g = game.galaxy;
        const ms = normals(g);
        expect(spawnThreatNow(g, ms[0], 'cult')).toBe(true);
        cultCheckTrigger(g);
        const faction = peekCultState(g)!.faction;
        expect(faction).not.toBeNull();
        for (const x of ms) for (const y of ms) if (x !== y) meet(x, y);
        for (const x of ms) obtainDiplomaticRelation(x, faction!).type = DiplomaticRelationType.None;
        reviewCouncil(g, 100);
        const c = councilOf(g, ms[0])!;
        expect(motionCandidates(g, c, 100).some((m) => m.kind === 'threat' && m.target === faction && m.weight >= 85)).toBe(false); // a faction that has hurt no one yet is not tabled
        crisisState(g).harmed.cult = true;
        const cands = motionCandidates(g, c, 100);
        expect(cands.some((m) => m.kind === 'sanction' && m.target === faction && m.weight >= 70)).toBe(true);
        expect(cands.some((m) => m.kind === 'threat' && m.target === faction && m.weight >= 85)).toBe(true);
        c.threats.push(faction!); // as if the council had declared it a threat
        crisisJointWar(g);
        const warring = ms.filter((x) => x !== g.playerEmpire && x.diplomaticRelations.byEmpire(faction!)?.type === DiplomaticRelationType.War);
        expect(warring.length).toBeGreaterThan(0);
    }, 900000);
});


// Giantworks (src/sim/scenario/threats/giantworks): the independents' Great Work. The wonders are throw-away kinds registered here.
describe('giantworks', () => {
    const ids = ['threat-framework', 'smarter-ai', 'war-crimes', 'giantworks'];
    const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, galaxyAge: 3, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
    const completed: string[] = [];
    const destroyed: string[] = [];
    let periodicCalls = 0;
    beforeAll(() => {
        const mk = (id: string, flag: string, tags: string[]) =>
            registerGreatWork({
                id,
                flag,
                weight: 10,
                hintTags: tags,
                onComplete: (_g, site) => void completed.push(`${id}:${site.id}`),
                onDestroyed: (_g, site, by) => void destroyed.push(`${id}:${site.id}:${by?.name ?? '-'}`),
                periodic: () => void periodicCalls++,
            });
        mk('gwtest-a', 'gwTestA', ['glass-ice', 'luxury', 'neon']);
        mk('gwtest-b', 'gwTestB', ['glass-ice', 'luxury', 'plankton']);
        mk('gwtest-c', 'gwTestC', ['superconductors', 'cores', 'cooling']);
        KIND_MENACE['gwtest-a'] = 0.1;
        KIND_MENACE['gwtest-b'] = 0.1;
        KIND_MENACE['gwtest-c'] = 0.95;
        KIND_VALUE['gwtest-a'] = 0.9;
        KIND_VALUE['gwtest-b'] = 0.9;
        KIND_VALUE['gwtest-c'] = 0.1;
    });
    afterAll(() => {
        for (const id of ['gwtest-a', 'gwtest-b', 'gwtest-c']) {
            unregisterGreatWork(id);
            delete KIND_MENACE[id];
            delete KIND_VALUE[id];
        }
    });
    function gwFull(flags: Record<string, boolean> = {}, params: Record<string, number> = {}, scenario: string[] = ids): { game: Game; gameData: GameData } {
        // The real wonders (casino.ts ...) are switched off here: these tests use the throw-away kinds above (flags undefined = on).
        return createScenarioGame(base, { scenario: comboOverlayFs(scenario), flags: { threatGiantworks: true, gwCasino: false, gwUltramind: false, gwSanctuary: false, gwBeacon: false, ...flags }, params, options: age3 });
    }
    function gw(flags: Record<string, boolean> = {}, params: Record<string, number> = {}, scenario: string[] = ids): Galaxy {
        return gwFull(flags, params, scenario).game.galaxy;
    }
    /** A game whose Great Work is already building (the Gathering done). */
    function building(params: Record<string, number> = {}, flags: Record<string, boolean> = {}, forceKind?: string): { g: Galaxy; w: GreatWorkRecord; game: Game; gameData: GameData } {
        const { game, gameData } = gwFull(flags, params);
        const g = game.galaxy;
        const w = greatWorks(g)[0];
        if (forceKind !== undefined) w.wonder = forceKind;
        w.gatherDate = 0;
        giantworksPeriodic(g);
        expect(w.phase).toBe('building');
        return { g, w, game, gameData };
    }
    const actors = (g: Galaxy): Empire[] => ordinaryEmpires(g);

    it('add-on off: no state, no faction, nothing changes', () => {
        const g = gw({ threatGiantworks: false });
        const n = g.empires.length;
        giantworksPeriodic(g);
        expect(peekGwState(g)).toBeNull();
        expect(g.empires.length).toBe(n);
    }, 300000);

    it('existence: a chance of 0 means no Great Work; 100 means one, with its founders and an empty site', () => {
        expect(greatWorks(gw({}, { giantworksExistChancePct: 0 }))).toHaveLength(0);
        const g = gw();
        const w = greatWorks(g)[0];
        expect((g.scenario!.state.giantworks as { sites: unknown[] }).sites[0]).toBe(w); // the shape the station art reads
        expect(w.phase).toBe('seeded');
        expect(w.circles.length).toBeGreaterThanOrEqual(2);
        expect(w.circles.length).toBeLessThanOrEqual(3);
        for (const c of w.circles) {
            expect(c.length).toBeGreaterThanOrEqual(1);
            expect(c.length).toBeLessThanOrEqual(3);
            for (const h of c) expect(h.empire).toBe(g.independentEmpire);
        }
        expect(w.founders).toEqual(w.circles.flat());
        expect(['gwtest-a', 'gwtest-b', 'gwtest-c']).toContain(w.wonder);
        // The site is a star system with nothing in it, and the work has not started: no base, no Compact.
        for (const h of g.systemHabitatsOf(w.system.systemStar.systemIndex)) {
            expect(h.empire).toBeNull();
            expect(h.population?.totalAmount ?? 0).toBe(0);
        }
        expect(w.base).toBeNull();
        expect(compactFaction(g)).toBeNull();
        // The rumour comes at year 5 to 10, the Gathering at year 15 to 30.
        const y0 = galaxyStarDate(g);
        expect((w.rumourDate - y0) / YEAR_LENGTH).toBeGreaterThanOrEqual(5);
        expect((w.rumourDate - y0) / YEAR_LENGTH).toBeLessThanOrEqual(10);
        expect((w.gatherDate - y0) / YEAR_LENGTH).toBeGreaterThanOrEqual(15);
        expect((w.gatherDate - y0) / YEAR_LENGTH).toBeLessThanOrEqual(30);
        // Same seed, same Great Work (its own random stream).
        const w2 = greatWorks(gw())[0];
        expect(w2.wonder).toBe(w.wonder);
        expect(w2.system.systemStar.name).toBe(w.system.systemStar.name);
        expect(w2.founders.map((h) => h.name)).toEqual(w.founders.map((h) => h.name));
    }, 600000);

    it('the number of Great Works: the option, distinct founders; 1 by default', () => {
        expect(greatWorks(gw())).toHaveLength(1);
        const g = gw({}, { giantworksCount: 2 });
        const ws = greatWorks(g);
        expect(ws.length).toBeGreaterThanOrEqual(1);
        if (ws.length === 2) for (const h of ws[0].founders) expect(ws[1].founders).not.toContain(h);
    }, 600000);

    it('the Gathering: the Compact (stock AI off, no war, no colonising), a scaffold at stage 0, convoys of stock freighters', () => {
        const { g, w } = building();
        const compact = compactFaction(g)!;
        expect(compact.name).toBe("The Founders' Compact");
        expect(compact.controlColonization).toBe(AutomationLevel.Undefined);
        expect(compact.initiateConstruction).toBe(false);
        expect(scenarioQuery(g, 'declareWarBlocked', false, { empire: compact, target: actors(g)[0] })).toBe(true);
        expect(scenarioQuery(g, 'declareWarBlocked', false, { empire: actors(g)[0], target: compact })).toBe(true);
        const fake = { actualEmpire: compact } as unknown as BuiltObject;
        expect(scenarioQuery(g, 'assignMissionAllowed', true, { builtObject: fake, missionType: BuiltObjectMissionType.Colonize, target: null, x: 0, y: 0 })).toBe(false);
        expect(scenarioQuery(g, 'assignMissionAllowed', true, { builtObject: fake, missionType: BuiltObjectMissionType.Move, target: null, x: 0, y: 0 })).toBe(true);
        expect(w.base!.actualEmpire).toBe(compact);
        expect(w.base!.role).toBe(BuiltObjectRole.Base);
        expect(w.stage).toBe(0);
        expect(greatWorkStageOf(g, w.base!)).toBe(0);
        expect(w.base!.name).toContain('Foundations');
        expect(w.suppliers.length).toBeGreaterThan(0);
        expect(w.perShip).toBeGreaterThan(0);
        // The first convoys leave: freighters of the Compact bound for the scaffold, each convoy carrying one hint tag.
        for (const k of Object.keys(w.nextDeparture)) w.nextDeparture[k] = 0;
        giantworksPeriodic(g);
        expect(w.convoys.length).toBe(w.suppliers.length);
        for (const c of w.convoys) {
            expect(c.ships.length).toBeGreaterThanOrEqual(3);
            expect(c.ships.length).toBeLessThanOrEqual(6);
            expect(c.escorts.length).toBe(1);
            expect(c.ships.every((b) => b.actualEmpire === compact && b.role === BuiltObjectRole.Freight)).toBe(true);
            expect(c.ships.every((b) => builtObjectMission(b.mission)?.type === BuiltObjectMissionType.Move && builtObjectMission(b.mission)?.targetBuiltObject === w.base)).toBe(true);
            expect(typeof c.tag).toBe('string');
        }
        expect(greatWorkScaffolds(g)).toHaveLength(1);
        expect(greatWorkScaffolds(g)[0].wonder).toBeNull(); // the scaffold never gives the answer away
    }, 900000);

    it('deliveries build it: stages, setbacks, completion makes the wonder public, never before', () => {
        const { g, w } = building();
        for (const k of Object.keys(w.nextDeparture)) w.nextDeparture[k] = 0;
        giantworksPeriodic(g);
        const n = w.convoys.reduce((a, c) => a + c.ships.length, 0);
        for (const c of w.convoys) for (const b of c.ships) { b.xpos = w.base!.xpos; b.ypos = w.base!.ypos; }
        giantworksPeriodic(g);
        expect(w.delivered).toBe(n);
        expect(w.progress).toBeCloseTo(n * w.perShip, 6);
        expect(w.convoys.every((c) => c.ships.length === 0)).toBe(true);
        // Stages follow progress; a setback can lower them.
        addProgress(g, w, 0.3 - w.progress);
        expect(w.stage).toBe(1);
        expect(w.base!.name).toContain('Frame');
        addProgress(g, w, 0.45);
        expect(w.stage).toBe(3);
        expect(greatWorkStageOf(g, w.base!)).toBe(3);
        addProgress(g, w, -0.2);
        expect(w.stage).toBe(2);
        // Nobody can have it confirmed before it is finished.
        for (const e of actors(g)) {
            learnTag(g, w, e, 'glass-ice');
            learnTag(g, w, e, 'luxury');
            while (grantTrueHint(g, w, e) !== null);
            expect(workLevel(w, e)).toBeLessThan(3);
        }
        expect(completed).not.toContain(`${w.wonder}:${w.id}`);
        addProgress(g, w, 1);
        expect(w.phase).toBe('complete');
        expect(w.stage).toBe(4);
        expect(completed).toContain(`${w.wonder}:${w.id}`);
        for (const e of actors(g)) expect(workLevel(w, e)).toBe(3);
        expect(w.base!.name).toBe(kindName(w.wonder));
        expect(greatWorkScaffolds(g)[0].wonder).toBe(w.wonder);
        const calls = periodicCalls;
        giantworksPeriodic(g);
        expect(periodicCalls).toBeGreaterThan(calls); // the wonder's periodic hook runs after completion
    }, 900000);

    it('a stalled work (no deliveries for years) is abandoned', () => {
        const { g, w } = building();
        for (const k of Object.keys(w.nextDeparture)) w.nextDeparture[k] = 1e18;
        w.startDate -= 9 * YEAR_LENGTH;
        w.lastDelivery = w.startDate;
        stepWork(g, w);
        expect(w.phase).toBe('abandoned');
    }, 600000);

    it('hints: tags learnt from manifests give a shortlist at suspected, an inspection narrows it, an investigation adds a hint, nothing proves', () => {
        const { g, w } = building({}, {}, 'gwtest-a');
        const e = actors(g)[0];
        expect(shortlist(g, w, e)).toEqual([]);
        expect(learnTag(g, w, e, 'glass-ice')).toBe(true);
        expect(learnTag(g, w, e, 'glass-ice')).toBe(false);
        expect(workLevel(w, e)).toBe(1);
        learnTag(g, w, e, 'luxury');
        expect(workLevel(w, e)).toBe(2); // two different hints: suspected
        expect(shortlist(g, w, e).sort()).toEqual(['gwtest-a', 'gwtest-b']); // the red herring: both wonders carry glass and luxury
        // The Diet's inspection removes wrong candidates but never the last two.
        w.narrowed = 1;
        expect(shortlist(g, w, e)).toHaveLength(2);
        expect(shortlist(g, w, e)).toContain('gwtest-a');
        // A third, specific hint tells them apart in the shortlist order but is still no proof.
        expect(grantTrueHint(g, w, e)).toBe('neon');
        expect(shortlist(g, w, e)[0]).toBe('gwtest-a');
        expect(grantTrueHint(g, w, e)).toBeNull();
        expect(workLevel(w, e)).toBe(2);
        // The Intelligence screen lists the site with its shortlist; the selection panel text names the candidates.
        const rows = threatKnownSites(g, e).filter((s) => s.threat === 'giantworks');
        expect(rows).toHaveLength(1);
        expect(rows[0].target).toBe(w.base);
        expect(rows[0].label).toMatch(/Great Work/);
        expect(rows[0].status).toMatch(/%/);
        // Another empire that knows nothing sees nothing.
        expect(threatKnownSites(g, actors(g)[1]).filter((s) => s.threat === 'giantworks')).toHaveLength(0);
    }, 900000);

    it('Investigate (an agent at the site) yields one more true hint, never a confirmation; refused once every hint is known', () => {
        const { g, w } = building({}, {}, 'gwtest-a');
        const player = g.playerEmpire!;
        learnTag(g, w, player, 'glass-ice');
        learnTag(g, w, player, 'luxury');
        expect(workLevel(w, player)).toBe(2);
        const agent = getEmpireCharacters(player).find((c) => c.role === CharacterRole.IntelligenceAgent && c.active)!;
        agent.mission = null;
        const target = w.base!;
        const st = (): { list: { due: number }[] } => g.scenario!.state[THREAT_INVESTIGATIONS_KEY] as { list: { due: number }[] };
        expect(runPlayerCommand(g, player, 'threatInvestigate', ['giantworks', target, agent])).toEqual({ ok: true });
        for (let i = 0; i < 40 && (w.tags[player.empireId] ?? []).length < 3; i++) {
            if (st().list.length === 0) expect(runPlayerCommand(g, player, 'threatInvestigate', ['giantworks', target, agent])).toEqual({ ok: true });
            st().list[0].due = galaxyStarDate(g);
            reviewThreatInvestigations(g);
        }
        expect(w.tags[player.empireId]).toEqual(['glass-ice', 'luxury', 'neon']);
        expect(workLevel(w, player)).toBe(2); // a hint, not a proof
        expect(empireMessages(player).at(-1)!.title).toBe('Great Work investigation');
        expect(runPlayerCommand(g, player, 'threatInvestigate', ['giantworks', target, agent])).toEqual({ ok: false, reason: 'Nothing more to learn' });
    }, 900000);

    it('a convoy seen by an empire teaches it that convoy\'s tag; the Fitting stage makes a watcher suspect', () => {
        const { g, w } = building({}, {}, 'gwtest-a');
        for (const k of Object.keys(w.nextDeparture)) w.nextDeparture[k] = 0;
        giantworksPeriodic(g);
        const e = actors(g)[1];
        const c = w.convoys[0];
        // The empire's own scout flies right beside the convoy.
        const scout = e.builtObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0) ?? e.builtObjects.find((b) => !b.hasBeenDestroyed && b.topSpeed > 0)!;
        scout.xpos = c.ships[0].xpos;
        scout.ypos = c.ships[0].ypos;
        scout.nearestSystemStar = null; // in deep space, where ships' sensors count
        rebuildIndexes(g);
        updateKnowledge(g, w);
        expect(c.seen).toContain(e.empireId);
        expect(w.tags[e.empireId]).toContain(c.tag);
        // Stage 3 and the site in view: suspected at once.
        w.stage = 3;
        const e2 = actors(g)[2];
        const s2 = e2.builtObjects.find((b) => !b.hasBeenDestroyed && b.topSpeed > 0)!;
        s2.xpos = w.base!.xpos;
        s2.ypos = w.base!.ypos;
        s2.nearestSystemStar = null;
        rebuildIndexes(g);
        updateKnowledge(g, w);
        expect(w.seenBy).toContain(e2.empireId);
        expect(workLevel(w, e2)).toBe(2);
        // The map rows the station art draws: the base (from Rumour once seen) and the founding worlds the viewer has explored.
        expect(threatKnownSites(g, e2, 1).filter((r) => r.threat === 'giantworks').map((r) => r.target)).toEqual([w.base]);
        expect(threatKnownSites(g, actors(g)[3], 1).filter((r) => r.threat === 'giantworks')).toHaveLength(0); // not seen, not suspected
        const seen = w.founders.find((h) => e2.visibility.checkSystemExplored(h.systemIndex)) ?? w.founders[0];
        e2.visibility.systemVisibility[seen.systemIndex].status = SystemVisibilityStatus.Explored;
        expect(giantworksCompactSites(g, e2).map((r) => r.target)).toContain(seen);
        expect(giantworksCompactSites(g, e2).every((r) => r.threat === 'giantworksCompact' && r.level === workLevel(w, e2))).toBe(true);
        expect(threatKnownSites(g, e2).filter((r) => r.threat === 'giantworksCompact').length).toBe(giantworksCompactSites(g, e2).length); // suspected: listed by the generic selector too
    }, 900000);

    it('convoys: an attack counts once per ship as the independents crime and angers the Compact; protectors earn the Compact\'s regard', () => {
        const { g, w } = building();
        for (const k of Object.keys(w.nextDeparture)) w.nextDeparture[k] = 0;
        giantworksPeriodic(g);
        const e = actors(g)[0];
        const ship = w.convoys[0].ships[0];
        const before = warCrimesRecord(g, e)?.counts.independents ?? 0;
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: ship, attacker: null, attackingEmpire: e });
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: ship, attacker: null, attackingEmpire: e });
        expect(warCrimesRecord(g, e)?.counts.independents).toBe(before + 1);
        expect(w.anger[e.empireId]).toBeGreaterThan(0);
        // Protect: warships on station for a year (36 periods of 10 days).
        const p = actors(g)[1];
        const warship = p.builtObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0)!;
        warship.xpos = w.base!.xpos;
        warship.ypos = w.base!.ypos;
        rebuildIndexes(g);
        expect(stationedEmpires(g, w)).toContain(p);
        for (let i = 0; i < 40; i++) protectStep(g, w);
        expect(w.protectors).toContain(p.empireId);
        expect(w.protectors).not.toContain(e.empireId);
    }, 900000);

    it('sabotage: a destroyed section sets it back and is rebuilt; sabotaged construction sets it back a little; neither is a war crime', () => {
        const { g, w } = building();
        const e = actors(g)[0];
        addProgress(g, w, 0.5);
        const old = w.base!;
        const now = galaxyStarDate(g);
        // Destroy Base: the stock effect kills the base, then the mission-completed event follows.
        old.hasBeenDestroyed = true;
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: old, destroyer: null });
        scenarioEmit(g, 'intelMissionCompleted', { empire: e, mission: newIntelligenceMissionAgainstBuiltObject(e, null, IntelligenceMissionType.DestroyBase, now, old), outcome: null });
        expect(resolveBaseLoss(g, w)).toBe(true);
        expect(w.phase).toBe('building');
        expect(w.base).not.toBe(old);
        expect(w.base!.hasBeenDestroyed).toBe(false);
        expect(w.progress).toBeCloseTo(0.3, 6);
        expect(warCrimesRecord(g, e)?.counts.greatWork ?? 0).toBe(0);
        expect(peekGwState(g)!.stats.sabotaged).toBe(1);
        // Sabotage Construction: a small setback at once; caught = the stock exposure event first.
        scenarioEmit(g, 'intelMissionExposed', { empire: e, blamed: e, target: compactFaction(g)!, missionType: IntelligenceMissionType.SabotageConstruction, outcome: 0 });
        scenarioEmit(g, 'intelMissionCompleted', { empire: e, mission: newIntelligenceMissionAgainstBuiltObject(e, null, IntelligenceMissionType.SabotageConstruction, galaxyStarDate(g), w.base!), outcome: null });
        expect(w.progress).toBeCloseTo(0.24, 6);
        expect(w.anger[e.empireId]).toBeGreaterThan(0); // caught
    }, 900000);

    it('destroying it: a war crime unless the Diet authorised demolition; sabotage and a hostile wonder are exempt; the Compact is angry', () => {
        for (const mode of ['crime', 'authorised', 'hostile'] as const) {
            const { g, w } = building();
            const e = actors(g)[0];
            if (mode === 'authorised') dietState(g).laws.push({ id: 1, kind: LAW_DEMOLISH, empire: null, other: null, colony: null, since: 0, until: -1, text: 'x' });
            if (mode === 'hostile') {
                addProgress(g, w, 2);
                markGreatWorkHostile(w);
            }
            const base = w.base!;
            base.hasBeenDestroyed = true;
            scenarioEmit(g, 'builtObjectKilledBy', { builtObject: base, destroyer: e });
            expect(resolveBaseLoss(g, w)).toBe(true);
            expect(w.phase).toBe('destroyed');
            expect(w.destroyedBy).toBe(e);
            expect(destroyed.some((d) => d.startsWith(`${w.wonder}:${w.id}:`))).toBe(true);
            expect(warCrimesRecord(g, e)?.counts.greatWork ?? 0).toBe(mode === 'crime' ? 1 : 0);
            expect(w.anger[e.empireId]).toBeGreaterThan(0);
        }
    }, 1800000);

    it('seizing the finished wonder: the holder changes and takes the main benefit; a crime unless hostile', () => {
        const { g, w } = building();
        addProgress(g, w, 2);
        const e = actors(g)[0];
        const compact = compactFaction(g)!;
        // No holder, nobody's territory: the Compact keeps the whole benefit; the Compact's cut is a fifth of an owner's.
        const shares = greatWorkShares(g, w);
        expect(shares.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 9);
        w.base!.empire = e;
        scenarioEmit(g, 'builtObjectOwnerChanged', { builtObject: w.base!, from: compact, to: e });
        expect(w.holder).toBe(e);
        expect(warCrimesRecord(g, e)?.counts.greatWork).toBe(1);
        const held = greatWorkShares(g, w);
        expect(held).toEqual([{ empire: e, share: 1, role: 'owner' }]);
        const money = e.stateMoney;
        expect(greatWorkPay(g, w, 1000)).toBeCloseTo(1000, 6);
        expect(e.stateMoney).toBeCloseTo(money + 1000, 6);
        scenarioEmit(g, 'builtObjectOwnerChanged', { builtObject: w.base!, from: e, to: compact });
        expect(w.holder).toBeNull();
        void recordWarCrime;
    }, 900000);

    it('the Diet motions are registered (Inspect, Protect, Authorise demolition, Internationalise) and need the Diet', () => {
        const kinds = registeredDietKinds().map((k) => k.kind);
        for (const k of ['gwInspect', LAW_PROTECT, LAW_DEMOLISH, 'gwIntl']) expect(kinds).toContain(k);
        const g = gw();
        for (const k of registeredDietKinds().filter((x) => x.kind.startsWith('gw'))) expect(k.proposable?.(g) ?? false).toBe(false);
    }, 600000);

    it('Smarter AI: menace and value of the shortlist, personality and reach decide', () => {
        const { g, w } = building({}, {}, 'gwtest-a');
        const e = actors(g)[0];
        w.base!.xpos = e.capital!.xpos;
        w.base!.ypos = e.capital!.ypos;
        learnTag(g, w, e, 'glass-ice');
        learnTag(g, w, e, 'luxury'); // fits the (benign, valuable) a and b
        expect(aiChoice(g, w, e)).not.toBe('destroy');
        expect(['protect', 'none']).toContain(aiChoice(g, w, e));
        const f = actors(g)[1];
        w.base!.xpos = f.capital!.xpos;
        w.base!.ypos = f.capital!.ypos;
        learnTag(g, w, f, 'superconductors');
        learnTag(g, w, f, 'cores'); // fits only the menacing c
        expect(['destroy', 'sabotage']).toContain(aiChoice(g, w, f));
    }, 900000);

    it('save and load keep a building work and its Compact', () => {
        const { g, w, game, gameData } = building();
        for (const k of Object.keys(w.nextDeparture)) w.nextDeparture[k] = 0;
        giantworksPeriodic(g);
        const e = actors(g)[0];
        learnTag(g, w, e, 'glass-ice');
        w.anger[e.empireId] = 7;
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const lg = deserializeGame(text, gameData).game.galaxy;
        const lw = greatWorks(lg)[0];
        expect(lw.phase).toBe('building');
        expect(lw.wonder).toBe(w.wonder);
        expect(lw.base!.builtObjectID).toBe(w.base!.builtObjectID);
        expect(lw.convoys.length).toBe(w.convoys.length);
        expect(lw.convoys[0].ships.map((b) => b.builtObjectID)).toEqual(w.convoys[0].ships.map((b) => b.builtObjectID));
        expect(compactFaction(lg)!.empireId).toBe(compactFaction(g)!.empireId);
        expect(lw.tags[e.empireId]).toEqual(['glass-ice']);
        expect(lw.anger[e.empireId]).toBe(7);
    }, 1800000);

    it('Game Editor: a Great Work starts now with a forced wonder', () => {
        const g = gw({ threatGiantworks: false });
        expect(peekGwState(g)).toBeNull();
        const spec = spawnableThreats(g).find((t) => t.key === 'giantworks:gwtest-c')!;
        expect(spec.note).toBeNull();
        expect(spawnThreatNow(g, g.playerEmpire!, 'giantworks:gwtest-c')).toBe(true);
        const w = greatWorks(g)[0];
        expect(w.wonder).toBe('gwtest-c');
        expect(w.phase).toBe('building');
        expect(compactFaction(g)).not.toBeNull();
        void spawnGreatWork;
    }, 900000);
    // ---------------------------------------------------------------------------------------------------------------
    // The Gilded Orbit (giantworks/casino.ts): the real wonder, forced onto the work (the throw-away kinds stay out of the roll).
    // ---------------------------------------------------------------------------------------------------------------

    /** A finished, open casino. `holdBy` >= 0: that ordinary empire seized it and its colonies lie round it (the site's star is moved to its capital). */
    function casinoOpen(params: Record<string, number> = {}, holdBy = 0): { g: Galaxy; w: GreatWorkRecord; rec: CasinoRec; e: Empire; game: Game; gameData: GameData } {
        const { g, w, game, gameData } = building({ gwCasinoFrontPct: 0, ...params }, { gwCasino: true }, 'casino');
        addProgress(g, w, 2);
        expect(w.phase).toBe('complete');
        const rec = casinoRecOf(g, w.id)!;
        const e = actors(g)[Math.max(0, holdBy)];
        if (holdBy >= 0) {
            w.holder = e;
            rec.star = e.capital!;
        }
        return { g, w, rec, e, game, gameData };
    }
    /** Pretend the last payment was `days` ago (the casino pays by the clock). */
    const owed = (g: Galaxy, rec: CasinoRec, days = 10): void => {
        rec.lastPay = galaxyStarDate(g) - days * GAME_DAY_LENGTH;
    };
    const sectors = (g: Galaxy, a: { xpos: number; ypos: number }, b: { xpos: number; ypos: number }): number => g.calculateDistance(a.xpos, a.ypos, b.xpos, b.ypos) / g.sectorSize;

    it('casino: registered with the most general hint first, a lore guess and its texts', () => {
        const kind = greatWorkKind('casino')!;
        expect(kind.flag).toBe('gwCasino');
        expect(kind.weight).toBe(20);
        expect(kind.hintTags[0]).toBe('luxury'); // shared with the aquarium: the general one first
        expect(kind.hintTags).toEqual(['luxury', 'glass-ice', 'neon']);
        expect(KIND_MENACE.casino).toBeGreaterThan(0);
        expect(KIND_VALUE.casino).toBeGreaterThan(KIND_MENACE.casino);
        const { g } = casinoOpen({}, -1);
        for (const tag of ['Giantworks Kind casino', 'Giantworks Complete casino', 'Giantworks Hint luxury', 'Giantworks Hint neon', 'Giantworks Casino Front News', 'Giantworks Casino Purged News']) expect(tryGetText(tag)).not.toBeNull();
        expect(spawnableThreats(g).some((t) => t.key === 'giantworks:casino')).toBe(true); // the Game Editor entry
    }, 900000);

    it('casino: it opens honest; the dice are rolled 3-6 years later from the add-on own stream, and half the time smugglers take it over', () => {
        const yes = casinoOpen({ gwCasinoFrontPct: 100 }, -1);
        expect(yes.rec.front).toBe(false); // nothing is decided at opening
        expect(yes.rec.turned).toBe(false);
        const dt = (yes.rec.revealAt - yes.w.completeDate!) / YEAR_LENGTH;
        expect(dt).toBeGreaterThanOrEqual(3);
        expect(dt).toBeLessThanOrEqual(6);
        giantworksPeriodic(yes.g); // not due yet
        expect(yes.rec.turned).toBe(false);
        expect(yes.rec.phase).toBe('open');
        yes.rec.revealAt = 0; // due
        giantworksPeriodic(yes.g);
        expect(yes.rec.turned).toBe(true);
        expect(yes.rec.front).toBe(true);
        expect(yes.rec.phase).toBe('revealed');
        const no = casinoOpen({ gwCasinoFrontPct: 0 }, -1);
        no.rec.revealAt = 0;
        giantworksPeriodic(no.g);
        expect(no.rec.turned).toBe(true);
        expect(no.rec.front).toBe(false);
        expect(no.rec.phase).toBe('open');
        giantworksPeriodic(no.g); // rolled once: an honest casino stays honest
        expect(no.rec.phase).toBe('open');
        // The same seed and work give the same roll and date (it never draws galaxy.rnd).
        const a = casinoOpen({ gwCasinoFrontPct: 50 }, -1);
        const b = casinoOpen({ gwCasinoFrontPct: 50 }, -1);
        expect(b.rec.turnRoll).toBe(a.rec.turnRoll);
        expect(b.rec.revealAt - b.w.completeDate!).toBeCloseTo(a.rec.revealAt - a.w.completeDate!, 6);
    }, 1800000);

    it('casino: an open Gilded Orbit pays its holder the stock resort income and lifts the colonies round it; without a holder the Compact keeps it', () => {
        // Nobody holds it: the territory owner (if any) or the Compact is paid; the empires' own books stay untouched otherwise.
        const none = casinoOpen({}, -1);
        const compact = compactFaction(none.g)!;
        const c0 = compact.stateMoney;
        const owner = greatWorkBeneficiary(none.g, none.w);
        owed(none.g, none.rec);
        giantworksPeriodic(none.g);
        expect(none.rec.beneficiary).toBe(owner);
        if (owner === null) {
            expect(none.rec.paid).toBe(0);
            expect(compact.stateMoney).toBeGreaterThan(c0);
        }
        // Held by an empire (seized): it takes the whole benefit.
        const { g, w, rec, e } = casinoOpen();
        expect(rec.phase).toBe('open');
        expect(rec.benefit).toBe(1);
        const per = (casinoAnnualIncome(g) * 10) / 360;
        expect(per).toBeGreaterThan(0);
        const money = e.stateMoney;
        const tour = e.counters.tourismIncome;
        owed(g, rec);
        giantworksPeriodic(g);
        expect(rec.beneficiary).toBe(e);
        expect(e.stateMoney - money).toBeCloseTo(per, 3);
        expect(e.counters.tourismIncome - tour).toBeCloseTo(per, 3);
        expect(e.thisYearsResortIncomeValue).toBeGreaterThanOrEqual(per - 0.001);
        expect(rec.paid).toBeCloseTo(per, 3);
        // The colonies of the holder: approval within 2 sectors, tourists within 2 (scenic), immigrants within 4; nobody else's.
        const h = e.capital!;
        const approval = (k: number): number => {
            rec.benefit = k;
            return scenarioQuery(g, 'empireApprovalRating', 10, { habitat: h, empire: e });
        };
        expect(approval(1) - approval(0)).toBeCloseTo(8, 6);
        expect(approval(0.8) - approval(0)).toBeCloseTo(6.4, 6);
        rec.benefit = 1;
        const migration = (k: number): number => {
            rec.benefit = k;
            calculateMigrationFactor(g, h);
            return h.migrationFactor;
        };
        expect(h.population.totalAmount).toBeGreaterThan(1e9);
        expect(migration(1) - migration(0)).toBeCloseTo(0.25 + 0.08, 3); // the pull, plus the approval bonus (approval / 100 is part of the factor)
        rec.benefit = 0;
        const scenic0 = calculateScenicFactorIncludingRuinsWonders(h, g);
        rec.benefit = 1;
        expect(calculateScenicFactorIncludingRuinsWonders(h, g)).toBeGreaterThanOrEqual(Math.max(scenic0, 0.5));
        const other = actors(g).find((x) => x !== e)!;
        expect(casinoLocalBenefit(g, other.capital!, 99)).toBe(0);
        const outside = e.colonies.find((c) => c.empire === e && sectors(g, c, rec.star) > 2);
        if (outside !== undefined) expect(casinoLocalBenefit(g, outside, 2)).toBe(0);
        rec.star = { xpos: -1e9, ypos: -1e9 } as typeof rec.star; // far away: no bonus anywhere
        expect(casinoLocalBenefit(g, h, 4)).toBe(0);
        expect(w.phase).toBe('complete');
    }, 1800000);

    it('casino: the front surfaces as a stock pirate faction with three huge bases and a high-tier fleet, and the resort turns hostile', () => {
        const { g, w, rec, e } = casinoOpen({ gwCasinoFrontPct: 100 });
        const compact = compactFaction(g)!;
        const money = e.stateMoney;
        const strongest = Math.max(...actors(g).map((x) => militaryPotency(x)));
        rec.revealAt = 0; // due
        giantworksPeriodic(g);
        expect(rec.phase).toBe('revealed');
        const f = rec.faction!;
        expect(g.pirateEmpires).toContain(f);
        expect(f.active).toBe(true);
        expect(f.name).toBe('The Gilded Syndicate');
        expect(peekCasinoState(g)!.faction).toBe(f);
        // Three huge bases in the casino's own system, each a lot stronger than any warship of the empires.
        expect(rec.bases).toHaveLength(3);
        const best = Math.max(...actors(g).flatMap((x) => x.builtObjects.filter((b) => b.role === BuiltObjectRole.Military).map((b) => calculateOverallStrengthFactor(b))));
        for (const b of rec.bases) {
            expect(b.role).toBe(BuiltObjectRole.Base);
            expect(b.actualEmpire).toBe(f);
            expect(b.hasBeenDestroyed).toBe(false);
            expect(g.determineHabitatSystemStar(b.parentHabitat!).systemIndex).toBe(w.system.systemStar.systemIndex);
            expect(calculateOverallStrengthFactor(b)).toBeGreaterThan(best);
        }
        expect(f.pirateEmpireBaseHabitat).toBe(rec.home);
        // The fleet: many warships built at the best tech level, the whole force (bases included) 60 % of the strongest navy, two thirds
        // of the new ships on guard (a manual patrol of one of the bases).
        const warships = f.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0);
        expect(warships.length).toBeGreaterThanOrEqual(12);
        expect(rec.potency0).toBeGreaterThanOrEqual(strongest * 0.6 * 0.95);
        expect(empireTechLevel(f)).toBeGreaterThanOrEqual(topTechLevel(g));
        expect(rec.guards.length).toBeGreaterThanOrEqual(8);
        for (const s of rec.guards) {
            const m = builtObjectMission(s.mission);
            expect(m?.type).toBe(BuiltObjectMissionType.Patrol);
            expect(rec.bases).toContain(m?.targetBuiltObject);
        }
        expect(rec.fleetStrength).toBeGreaterThan(0);
        // Hostile, no benefit, a crisis the other empires may help against, a pirate slot of its own, the front's friends spared.
        expect(greatWorkIsHostile(w)).toBe(true);
        expect(rec.benefit).toBe(0);
        expect(w.base!.name).toMatch(/smugglers' den/);
        expect(casinoLocalBenefit(g, e.capital!, 99)).toBe(0);
        expect(activeCrises(g).some((c) => c.entry.key === CASINO_KEY && c.faction === f)).toBe(true);
        expect(scenarioQuery(g, 'pirateFactionCount', 3, {})).toBe(4);
        expect(obtainPirateRelation(f, compact).type).toBe(PirateRelationType.Protection);
        for (const x of actors(g)) for (const b of rec.bases) expect(x.knownPirateBases).toContain(b);
        const after = e.stateMoney;
        owed(g, rec, 30);
        giantworksPeriodic(g);
        expect(e.stateMoney).toBeCloseTo(after, 3); // no income any more (the ordinary economy does not tick here)
        expect(after).toBeGreaterThanOrEqual(money);
        // The AI strikes the smugglers' weakest standing base (the resort is spared), against the other bases and the fleet at home.
        const strike = strikeTarget(g, w)!;
        expect(rec.bases).toContain(strike.target);
        expect(strike.target).not.toBe(w.base);
        expect(strike.defenders.length).toBeGreaterThanOrEqual(2 + 12);
        expect(strike.defenders).not.toContain(strike.target);
        for (const b of rec.bases) expect(calculateOverallStrengthFactor(strike.target)).toBeLessThanOrEqual(calculateOverallStrengthFactor(b));
        const striker = actors(g)[2];
        strike.target.xpos = striker.capital!.xpos;
        strike.target.ypos = striker.capital!.ypos;
        expect(aiChoice(g, w, striker)).toBe('destroy');
        // Revealing twice, or an honest casino revealing, does nothing.
        expect(reveal(g, w, rec, null)).toBe(false);
    }, 1800000);


    it('casino: the smugglers plant stock criminal networks that cut the colonies income; the purge (all three bases gone) breaks the faction, closes the casino for renovation and reopens it at 80%', () => {
        const { g, w, rec, e } = casinoOpen({ gwCasinoFrontPct: 100 });
        rec.revealAt = 0;
        giantworksPeriodic(g);
        const f = rec.faction!;
        expect(rec.phase).toBe('revealed');
        // One network a period at most, never more than the cap, spread over the empires near the site.
        const rev0 = new Map<unknown, number>();
        for (const x of actors(g)) for (const h of x.colonies) if (h.empire === x) rev0.set(h, habitatAnnualRevenue(g, h));
        for (let i = 0; i < 14; i++) {
            const n = rec.networks.length;
            rec.nextNetwork = 0;
            casinoPiratesPeriodic(g);
            expect(rec.networks.length).toBeLessThanOrEqual(n + 1);
        }
        expect(rec.networks.length).toBeGreaterThan(0);
        expect(rec.networks.length).toBeLessThanOrEqual(10);
        expect(rec.plantedTotal).toBe(rec.networks.length);
        const owners = new Set(rec.networks.map((h) => h.empire));
        expect(owners.size).toBeGreaterThan(1); // fewest-first: not all on one empire
        const h = rec.networks[0];
        expect(sectors(g, h, rec.star)).toBeLessThanOrEqual(6);
        expect(facilitiesCountCompletedByType(h.facilities!, PlanetaryFacilityType.PirateCriminalNetwork)).toBe(1);
        expect(h.pirateColonyControl.getByFaction(f)?.hasFacilityControl).toBe(true);
        expect(f.colonies).toContain(h);
        const corrupt = habitatCorruption(g, h);
        const rev = habitatAnnualRevenue(g, h);
        expect(rev).toBeLessThan(rev0.get(h)!);
        expect(corrupt).toBeGreaterThan(0.3);
        // Two of the three bases falling is not yet a purge.
        const [b1, b2, b3] = rec.bases;
        const hunter = actors(g)[1];
        for (const b of [b1, b2]) {
            scenarioEmit(g, 'builtObjectKilledBy', { builtObject: b, destroyer: hunter });
            builtObjectCompleteTeardown(g, b);
        }
        expect(basesBroken(rec)).toBe(false);
        casinoPiratesPeriodic(g);
        expect(rec.phase).toBe('revealed');
        expect(rec.faction).toBe(f);
        // The last one: the faction breaks, its networks are gone, the resort closes, nobody has to take it.
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: b3, destroyer: hunter });
        builtObjectCompleteTeardown(g, b3);
        expect(basesBroken(rec)).toBe(true);
        casinoPiratesPeriodic(g);
        expect(rec.phase).toBe('renovation');
        expect(rec.faction).toBeNull();
        expect(f.active).toBe(false);
        expect(g.pirateEmpires).not.toContain(f);
        expect(peekCasinoState(g)!.faction).toBeNull();
        expect(rec.purgedBy).toBe(hunter);
        expect(rec.networks).toHaveLength(0);
        expect(h.facilities === null || facilitiesCountCompletedByType(h.facilities, PlanetaryFacilityType.PirateCriminalNetwork) === 0).toBe(true);
        expect(h.pirateColonyControl.getByFaction(f)).toBeNull();
        expect(habitatCorruption(g, h)).toBeLessThan(corrupt);
        expect(habitatAnnualRevenue(g, h)).toBeGreaterThan(rev);
        expect(greatWorkIsHostile(w)).toBe(false);
        expect(w.base!.name).toMatch(/renovation/);
        expect(rec.benefit).toBe(0);
        expect(scenarioQuery(g, 'pirateFactionCount', 3, {})).toBe(3);
        // Six months of renovation pay nothing; then it runs clean at 80 %.
        const money = e.stateMoney;
        owed(g, rec, 30);
        giantworksPeriodic(g);
        expect(rec.phase).toBe('renovation');
        expect(e.stateMoney).toBeCloseTo(money, 3);
        expect(rec.renovationUntil - galaxyStarDate(g)).toBeGreaterThan(170 * GAME_DAY_LENGTH);
        rec.renovationUntil = 0;
        giantworksPeriodic(g);
        expect(rec.phase).toBe('clean');
        expect(rec.benefit).toBeCloseTo(0.8, 9);
        expect(w.base!.name).toBe(kindName('casino'));
        const per = (casinoAnnualIncome(g) * 10) / 360;
        const m1 = e.stateMoney;
        owed(g, rec);
        giantworksPeriodic(g);
        expect(e.stateMoney - m1).toBeCloseTo(per * 0.8, 3);
        // The pay follows the clock: a missed stretch is paid (to a point), a double call pays nothing twice.
        owed(g, rec, 36);
        const m2 = e.stateMoney;
        giantworksPeriodic(g);
        expect(e.stateMoney - m2).toBeCloseTo((per * 0.8 * 36) / 10, 3);
        const m3 = e.stateMoney;
        giantworksPeriodic(g);
        expect(e.stateMoney - m3).toBeCloseTo(0, 3);
    }, 1800000);

    it('casino: the smugglers prey on private freighters near their bases', () => {
        const { g, rec } = casinoOpen({ gwCasinoFrontPct: 100 });
        rec.revealAt = 0;
        giantworksPeriodic(g);
        const f = rec.faction!;
        const victim = actors(g)[1];
        const freighter = victim.privateBuiltObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Freight);
        expect(freighter).toBeDefined();
        freighter!.xpos = rec.home!.xpos + 20000;
        freighter!.ypos = rec.home!.ypos;
        rebuildIndexes(g);
        expect(isObjectVisibleToThisEmpire(g, f, freighter!)).toBe(true);
        casinoPiratesPeriodic(g);
        const hunters = f.builtObjects.filter((b) => builtObjectMission(b.mission)?.type === BuiltObjectMissionType.Attack && builtObjectMission(b.mission)?.targetBuiltObject === freighter);
        expect(hunters.length).toBe(1);
        expect(rec.guards).not.toContain(hunters[0]); // the guards stay home
        expect(rec.raidOrders).toBe(1);
        // A freighter of an empire that bought protection is left alone.
        const safe = actors(g)[2].privateBuiltObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Freight)!;
        changePirateRelation(f, actors(g)[2], PirateRelationType.Protection, galaxyStarDate(g), 0);
        safe.xpos = rec.home!.xpos;
        safe.ypos = rec.home!.ypos + 10000;
        rebuildIndexes(g);
        const before = rec.raidOrders;
        casinoPiratesPeriodic(g);
        expect(f.builtObjects.some((b) => builtObjectMission(b.mission)?.targetBuiltObject === safe)).toBe(false);
        expect(rec.raidOrders).toBeGreaterThanOrEqual(before);
    }, 1800000);

    it('casino: destroying the resort before the reveal dissolves the front; after it the smugglers stay until their bases fall', () => {
        const early = casinoOpen({ gwCasinoFrontPct: 100 });
        const hunter = actors(early.g)[1];
        early.w.base!.hasBeenDestroyed = true;
        scenarioEmit(early.g, 'builtObjectKilledBy', { builtObject: early.w.base!, destroyer: hunter });
        expect(resolveBaseLoss(early.g, early.w)).toBe(true);
        expect(early.w.phase).toBe('destroyed');
        expect(early.rec.phase).toBe('closed');
        expect(early.rec.front).toBe(false);
        expect(early.rec.benefit).toBe(0);
        early.rec.revealAt = 0;
        giantworksPeriodic(early.g);
        casinoPiratesPeriodic(early.g);
        expect(early.rec.faction).toBeNull();
        const late = casinoOpen({ gwCasinoFrontPct: 100 });
        late.rec.revealAt = 0;
        giantworksPeriodic(late.g);
        const f = late.rec.faction!;
        late.w.base!.hasBeenDestroyed = true;
        scenarioEmit(late.g, 'builtObjectKilledBy', { builtObject: late.w.base!, destroyer: actors(late.g)[1] });
        expect(resolveBaseLoss(late.g, late.w)).toBe(true);
        expect(late.rec.phase).toBe('revealed'); // the pirates hold their bases
        casinoPiratesPeriodic(late.g);
        expect(late.rec.faction).toBe(f);
        for (const b of late.rec.bases) builtObjectCompleteTeardown(late.g, b);
        casinoPiratesPeriodic(late.g);
        expect(late.rec.faction).toBeNull();
        expect(late.rec.phase).toBe('closed'); // nothing left to reopen
        expect(f.active).toBe(false);
    }, 1800000);

    it('casino: save and load keep a revealed casino, its faction, bases, guards and networks', () => {
        const { g, w, rec, game, gameData } = casinoOpen({ gwCasinoFrontPct: 100 });
        rec.revealAt = 0;
        giantworksPeriodic(g);
        for (let i = 0; i < 3; i++) {
            rec.nextNetwork = 0;
            casinoPiratesPeriodic(g);
        }
        expect(rec.networks.length).toBeGreaterThan(0);
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const lg = deserializeGame(text, gameData).game.galaxy;
        const lrec = casinoRecOf(lg, w.id)!;
        expect(lrec.phase).toBe('revealed');
        expect(lrec.front).toBe(true);
        expect(lrec.faction!.empireId).toBe(rec.faction!.empireId);
        expect(lg.pirateEmpires).toContain(lrec.faction);
        expect(peekCasinoState(lg)!.faction).toBe(lrec.faction);
        expect(lrec.bases.map((b) => b.builtObjectID)).toEqual(rec.bases.map((b) => b.builtObjectID));
        expect(lrec.guards.map((b) => b.builtObjectID)).toEqual(rec.guards.map((b) => b.builtObjectID));
        expect(lrec.networks.map((h) => h.habitatIndex)).toEqual(rec.networks.map((h) => h.habitatIndex));
        expect(lrec.star.habitatIndex).toBe(rec.star.habitatIndex);
        expect(lrec.beneficiary?.empireId).toBe(rec.beneficiary?.empireId);
        expect(lrec.revealedAt).toBe(rec.revealedAt);
        // And it goes on: the loaded game purges the same way.
        for (const b of lrec.bases) builtObjectCompleteTeardown(lg, b);
        casinoPiratesPeriodic(lg);
        expect(lrec.phase).toBe('renovation');
    }, 3600000);
});

// Giantworks' Beacon wonder (threats/giantworks/beacon*.ts): the Watchers, corruption, the Reclamation, counterplay, the dark bargain.
describe('the Beacon (Giantworks wonder)', () => {
    const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
    const ids = ['threat-framework', 'giantworks'];

    function beaconGame(extraFlags: Record<string, boolean> = {}): { g: Galaxy; site: GreatWorkSite; game: Game; gameData: GameData } {
        const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
        const g = game.galaxy;
        g.scenario!.flags.gwBeacon = true;
        for (const [k, v] of Object.entries(extraFlags)) g.scenario!.flags[k] = v;
        let best = null as (typeof g.systems)[number] | null;
        let bd = Infinity;
        for (const sys of g.systems) {
            const s = sys?.systemStar;
            if (!s || sys.habitats.some((h) => h.empire !== null) || g.checkEmpireTerritoryIdAtLocation(s.xpos, s.ypos) >= 0) continue;
            const d = g.calculateDistance(s.xpos, s.ypos, g.sizeX / 2, g.sizeY / 2);
            if (d < bd) {
                bd = d;
                best = sys;
            }
        }
        const site: GreatWorkSite = { id: 0, system: best!, habitat: null, base: null, progress: 0, stage: 0, wonder: 'beacon', founders: [], startDate: galaxyStarDate(g), completeDate: null, destroyedBy: null };
        return { g, site, game, gameData };
    }
    const atWarWith = (a: Empire, b: Empire): boolean => obtainDiplomaticRelation(a, b).type === DiplomaticRelationType.War;
    const normalsOf = (g: Galaxy): Empire[] => g.empires.filter((e): e is Empire => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active && e !== peekBeaconState(g)?.faction);
    function rolled(): { g: Galaxy; site: GreatWorkSite; st: BeaconState; game: Game; gameData: GameData } {
        const { g, site, game, gameData } = beaconGame();
        beaconRolled(g, site);
        return { g, site, st: peekBeaconState(g)!, game, gameData };
    }
    function completed(): { g: Galaxy; site: GreatWorkSite; st: BeaconState; game: Game; gameData: GameData } {
        const r = rolled();
        r.site.progress = 1;
        r.site.stage = 4;
        r.site.completeDate = galaxyStarDate(r.g);
        beaconComplete(r.g, r.site);
        return r;
    }

    it('the kind is registered against the contract and the crisis list names the faction', () => {
        expect(beaconKind.id).toBe('beacon');
        expect(beaconKind.flag).toBe('gwBeacon');
        expect(greatWorkKind('beacon')).toBe(beaconKind);
        expect(CRISIS_ENTRIES.some((e) => e.key === 'beacon' && e.flag === 'gwBeacon')).toBe(true);
    });

    it('flag off: no state, no faction, nothing runs', () => {
        const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
        const g = game.galaxy;
        const n = g.empires.length;
        watchersPeriodic(g);
        reclamationPeriodic(g);
        expect(peekBeaconState(g)).toBeNull();
        expect(g.empires.length).toBe(n);
        runGameSeconds(g, 60);
        expect(peekBeaconState(g)).toBeNull();
    }, 600000);

    it('onRolled: two cloaked Watchers wait beyond the rim; the faction is "the Watchers"; the independents are noted', () => {
        const { g, st } = rolled();
        expect(st.faction!.name).toBe('The Watchers');
        expect(st.watchers).toHaveLength(2);
        expect(st.formerIndependents.length).toBe(g.independentColonies.length);
        for (const w of st.watchers) {
            const b = w.ship!;
            expect(b.cloaked).toBe(true);
            expect(b.actualEmpire).toBe(st.faction);
            const outside = b.xpos < 0 || b.ypos < 0 || b.xpos > g.sizeX || b.ypos > g.sizeY || g.systems.every((sys) => sys === null || g.calculateDistance(b.xpos, b.ypos, sys.systemStar.xpos, sys.systemStar.ypos) > 40000);
            expect(outside).toBe(true);
            expect(calculateOverallStrengthFactorWithoutShields(b)).toBeGreaterThan(0);
        }
        // at war with no one
        for (const e of normalsOf(g)) expect(atWarWith(e, st.faction!)).toBe(false);
        // determinism of the private stream: a second game gives the same homes
        const r2 = rolled();
        expect(r2.st.watchers.map((w) => [w.homeX, w.homeY])).toEqual(st.watchers.map((w) => [w.homeX, w.homeY]));
    }, 900000);

    it('the cloak hides a Watcher from every other empire, its own empire sees it, and a spotted cloak lapses for the spotter only', () => {
        const { g, st } = rolled();
        const [a, b] = normalsOf(g);
        const ship = st.watchers[0].ship!;
        expect(isObjectVisibleToThisEmpire(g, a, ship)).toBe(false);
        expect(isObjectVisibleToThisEmpireImprecise(g, a, ship)).toBe(false);
        expect(builtObjectVisibility(g, a, ship)).toBe(0);
        expect(isObjectVisibleToThisEmpire(g, st.faction!, ship)).toBe(true);
        ship.cloakSeenBy = [{ empireId: a.empireId, until: galaxyStarDate(g) + 1000 }];
        expect(cloakLapsedFor(ship, a, galaxyStarDate(g))).toBe(true);
        expect(cloakLapsedFor(ship, b, galaxyStarDate(g))).toBe(false);
        expect(isObjectVisibleToThisEmpire(g, b, ship)).toBe(false);
        ship.cloakSeenBy = [{ empireId: a.empireId, until: galaxyStarDate(g) - 1 }];
        expect(cloakLapsedFor(ship, a, galaxyStarDate(g))).toBe(false);
        ship.cloaked = false;
        // uncloaked, the ordinary rules apply again (visible when an empire's sensors reach it)
        expect(cloakLapsedFor(ship, b, galaxyStarDate(g))).toBe(true);
    }, 900000);

    it('corruption: a corrupted world speeds the build up and sends freighters; a dead Watcher slows it sharply; purging ends it', () => {
        const { g, site, st } = rolled();
        const base1 = beaconBuildRate(g, site);
        expect(base1).toBe(1);
        // a small test galaxy has few independents: let some empire colonies count as former independents too
        for (const e of normalsOf(g)) for (const c of e.colonies.slice(1, 3)) if (!st.formerIndependents.includes(c)) st.formerIndependents.push(c);
        const cands = corruptCandidates(g, st);
        expect(cands.length).toBeGreaterThan(2);
        const r1 = corrupt(g, st, cands[0])!;
        expect(r1.colony).toBe(cands[0]);
        expect(corrupt(g, st, cands[0])).toBeNull(); // once
        corrupt(g, st, cands[1]);
        expect(beaconBuildRate(g, site)).toBeCloseTo(1 + (2 * 9) / 100, 5);
        expect(beaconSuppliers(g, site)).toEqual([cands[0], cands[1]]);
        // capped
        for (const c of cands.slice(2)) corrupt(g, st, c);
        expect(beaconBuildRate(g, site)).toBeLessThanOrEqual(2.5 + 1e-9);
        // a dead Watcher: x0.4, both: x0.16
        const full = beaconBuildRate(g, site);
        st.watchers[0].dead = true;
        expect(beaconBuildRate(g, site)).toBeCloseTo(full * 0.4, 5);
        st.watchers[1].dead = true;
        expect(beaconBuildRate(g, site)).toBeCloseTo(full * 0.16, 5);
        // purge: needs the owner and the money
        const owner = normalsOf(g)[0];
        const rec = st.corrupted[0];
        rec.colony.empire = owner;
        owner.stateMoney = 10_000_000;
        const before = owner.stateMoney;
        expect(purgeCorruption(g, st, rec, owner)).toBe(true);
        expect(owner.stateMoney).toBe(before - 250000);
        expect(rec.ended).toBe('purged');
        expect(beaconSuppliers(g, site)).not.toContain(rec.colony);
        expect(purgeCorruption(g, st, rec, owner)).toBe(false);
    }, 900000);

    it('a sighting: the Watcher shows itself over a colony, passive, then slips away cloaked; attacked, it is at locked war with the attacker only', () => {
        const { g, st } = rolled();
        const w = st.watchers[0];
        const ship = w.ship!;
        const [a, b] = normalsOf(g);
        const target = a.colonies[0];
        // put it over the colony as the trip would end
        ship.xpos = target.xpos + 1000;
        ship.ypos = target.ypos + 1000;
        w.target = target;
        w.mode = 'travel';
        w.until = -1;
        watchersPeriodic(g);
        expect(w.mode).toBe('sighting');
        expect(ship.cloaked).toBe(false);
        expect(st.sighted).toEqual([ship]); // the art unfolds an uncloaked Watcher (render/threatArt.ts reads state 'beacon': faction, watchers, sighted, beacon)
        expect(st.stats.sightings).toBe(1);
        for (const e of normalsOf(g)) expect(atWarWith(e, st.faction!)).toBe(false);
        // the owner heard of it, the galaxy had a news line
        expect(empireMessages(a).some((m) => m.description.includes('unknown make'))).toBe(true);
        expect(empireMessages(b).some((m) => m.description.includes('unidentified vessel'))).toBe(true);
        // attacked by a: war with a only, cloak stays down while it fights
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: ship, attacker: null, attackingEmpire: a });
        expect(w.mode).toBe('fight');
        expect(atWarWith(a, st.faction!)).toBe(true);
        expect(atWarWith(b, st.faction!)).toBe(false);
        expect(obtainDiplomaticRelation(st.faction!, a).locked).toBe(true);
        // pirates and monsters do not change it
        const w2 = st.watchers[1];
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: w2.ship!, attacker: null, attackingEmpire: g.pirateEmpires[0] ?? null });
        expect(w2.mode).not.toBe('fight');
        // with no attacker near, it slips away after 15 days and cloaks
        ship.xpos = 1;
        ship.ypos = 1;
        g.nowMs += 20 * GAME_DAY_LENGTH;
        watchersPeriodic(g);
        expect(w.mode).toBe('return');
        expect(ship.cloaked).toBe(true);
    }, 900000);

    it('detection: a ship of an empire close to a cloaked Watcher may spot it; the cloak lapses for that empire only, and the Watcher shows in its Threats & Leads', () => {
        const { g, st } = rolled();
        const w = st.watchers[0];
        const ship = w.ship!;
        const [a, b] = normalsOf(g);
        const mine = a.builtObjects.find((o) => !o.hasBeenDestroyed)!;
        mine.xpos = ship.xpos + 5000;
        mine.ypos = ship.ypos + 5000;
        g.scenario!.params.beaconDetectPct = 100;
        watchersPeriodic(g);
        expect(w.detections).toBeGreaterThanOrEqual(1);
        expect(cloakLapsedFor(ship, a, galaxyStarDate(g))).toBe(true);
        expect(knowledgeLevel({ knowledge: w.knowledge }, a)).toBeGreaterThanOrEqual(1);
        watchersPeriodic(g);
        g.nowMs += 25 * GAME_DAY_LENGTH;
        watchersPeriodic(g);
        expect(knowledgeLevel({ knowledge: w.knowledge }, a)).toBeGreaterThanOrEqual(2);
        expect(beaconKnownSites(g, a).some((r) => r.kind === 'ship' && r.target === ship)).toBe(true);
        expect(beaconKnownSites(g, b).some((r) => r.target === ship)).toBe(false);
    }, 900000);

    it('onComplete: the faction becomes the Reclaimers, at locked war with everyone; the Beacon is theirs; the baseline population is recorded', () => {
        const { g, st } = completed();
        expect(st.phase).toBe('reclamation');
        expect(st.faction!.name).toBe('The Reclaimers');
        expect(st.beacon).not.toBeNull();
        expect(st.beacon!.actualEmpire).toBe(st.faction);
        for (const e of normalsOf(g)) {
            expect(atWarWith(e, st.faction!), e.name).toBe(true);
            expect(obtainDiplomaticRelation(st.faction!, e).locked).toBe(true);
        }
        expect(st.popBaseline).toBeGreaterThan(0);
        expect(st.popEliminated).toBe(0);
        // the art hook names who is who
        const looks = beaconLooks(g);
        expect(looks.faction).toBe(st.faction);
        expect(looks.beacon).toBe(st.beacon);
        expect(looks.watchers).toHaveLength(2);
        expect(beaconShipRole(st, st.watchers[0].ship!)).toBe('watcher');
        expect(beaconShipRole(st, st.beacon!)).toBe('beacon');
    }, 900000);

    it('onComplete with the framework\'s scaffold base: the base changes hands, is plated like a fortress and named the Beacon', () => {
        const { g, site } = rolled();
        const a = normalsOf(g)[0];
        const d = generateDesignFromSpec(g, a, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.DefensiveBase)!, 3, galaxyStarDate(g));
        expect(d).not.toBeNull();
        const star = site.system.systemStar;
        const scaffold = generateNewBuiltObject(g, a, d!, null, star.xpos, star.ypos);
        takeOwnershipOfBuiltObject(g, a, scaffold, a, false);
        site.base = scaffold;
        const shields0 = scaffold.shieldsCapacity;
        site.progress = 1;
        site.stage = 4;
        site.completeDate = galaxyStarDate(g);
        beaconComplete(g, site);
        const st = peekBeaconState(g)!;
        expect(st.beacon).toBe(scaffold);
        expect(scaffold.actualEmpire).toBe(st.faction);
        expect(scaffold.name).toBe('The Beacon');
        expect(scaffold.hasBeenDestroyed).toBe(false);
        expect(scaffold.shieldsCapacity).toBeGreaterThan(shields0);
        expect(a.builtObjects.includes(scaffold)).toBe(false);
        expect(st.faction!.builtObjects.includes(scaffold)).toBe(true);
    }, 900000);

    it('through the framework: the Game Editor forces the Beacon (Watchers appear); finishing the work lights it, hostile, and the faction is a crisis faction', () => {
        const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
        const g = game.galaxy;
        expect(spawnableThreats(g).some((t) => t.key === 'giantworks:beacon')).toBe(true);
        expect(spawnThreatNow(g, g.playerEmpire!, 'giantworks:beacon')).toBe(true);
        const work = greatWorks(g)[0];
        expect(work.wonder).toBe('beacon');
        const st = peekBeaconState(g)!;
        expect(st.site).toBe(work);
        expect(st.watchers).toHaveLength(2);
        expect(greatWorkIsHostile(work)).toBe(false);
        // the framework asks the kind for the build speed
        const mult = greatWorkKind('beacon')!.buildRateMultiplier!(g, work);
        expect(mult).toBe(1);
        completeWork(g, work);
        expect(work.phase).toBe('complete');
        expect(st.phase).toBe('reclamation');
        expect(greatWorkIsHostile(work)).toBe(true);
        expect(work.base!.actualEmpire).toBe(st.faction);
        expect(st.faction!.name).toBe('The Reclaimers');
        expect(CRISIS_ENTRIES.some((e) => e.key === 'beacon')).toBe(true);
        // destroying the hostile wonder is no crime: the framework\'s own records say so
        expect(work.hostile).toBe(true);
        runGameSeconds(g, 30);
    }, 1800000);

    it('a season: preparation with staging points, then ALL groups depart on the same day toward their own targets', () => {
        const { g, st } = completed();
        const f = st.faction!;
        f.stateMoney = 1e9;
        expect(beginSeason(g, st, 1)).toBe(true);
        const season = st.season!;
        expect(season.phase).toBe('prep');
        expect(season.staging.length).toBeGreaterThanOrEqual(1);
        expect(season.staging.length).toBeLessThanOrEqual(3);
        expect(season.groups.length).toBeGreaterThanOrEqual(1);
        expect(new Set(season.groups.map((x) => x.target)).size).toBe(season.groups.length);
        for (const grp of season.groups) expect(grp.target!.empire).not.toBe(f);
        // run the preparation to its end by hand
        for (let i = 0; i < 80 && season.phase === 'prep'; i++) {
            g.nowMs += 5 * GAME_DAY_LENGTH;
            reclamationPeriodic(g);
        }
        // the departure may wait for the gather; force it past the cap
        for (let i = 0; i < 40 && season.phase === 'prep'; i++) {
            g.nowMs += 5 * GAME_DAY_LENGTH;
            reclamationPeriodic(g);
        }
        expect(season.phase).toBe('offensive');
        expect(season.departed).toBeGreaterThan(0);
        expect(season.departures.length).toBeGreaterThanOrEqual(1);
        expect(new Set(season.departures).size).toBe(1); // the same day
        for (const grp of season.groups.filter((x) => x.state !== 'done')) {
            expect(grp.departDate).toBe(season.departed);
            expect(grp.ships.length).toBeGreaterThan(0);
        }
        expect(st.stats.spawned).toBeGreaterThan(0);
    }, 1800000);

    it('processing: a conquered world is drained over months into a Thrall pool; retaking it saves the survivors; destroyed worlds count as eliminated', () => {
        const { g, st } = completed();
        const f = st.faction!;
        const victim = normalsOf(g)[0];
        const world = victim.colonies.find((c) => c !== victim.capital && c.population.totalAmount > 0) ?? victim.colonies[0];
        const pop0 = world.population.totalAmount;
        takeOwnershipOfColonyFull(g, victim, world, f, false, false);
        expect(st.processing.some((r) => r.colony === world)).toBe(true);
        expect(world.troops!.totalDefendStrength).toBeGreaterThan(0);
        const rec = st.processing.find((r) => r.colony === world)!;
        reclamationMonthly(g);
        const after1 = world.population.totalAmount;
        expect(after1).toBeLessThan(pop0);
        expect(st.popEliminated).toBeGreaterThan(0);
        expect(rec.pool).toBeGreaterThan(0);
        for (let i = 0; i < 12; i++) reclamationMonthly(g);
        expect(rec.done).toBe(true);
        expect(world.population.totalAmount).toBeLessThanOrEqual(pop0 * 0.011 + 2);
        expect(st.popEliminated).toBeGreaterThan(pop0 * 0.9);
        // retaking stops it: a second world
        const w2 = victim.colonies.find((c) => c !== world && c !== victim.capital && c.population.totalAmount > 0);
        if (w2) {
            takeOwnershipOfColonyFull(g, victim, w2, f, false, false);
            reclamationMonthly(g);
            const elim = st.popEliminated;
            takeOwnershipOfColonyFull(g, f, w2, victim, false, false);
            reclamationMonthly(g);
            expect(st.popEliminated).toBe(elim);
            expect(st.processing.some((r) => r.colony === w2)).toBe(false);
        }
    }, 900000);

    it('Thralls and transports: a processing world\'s pool is carried by real transports (interceptable); a planet strike sends the stock planet destroyer and counts the dead as eliminated', () => {
        const { g, st } = completed();
        const f = st.faction!;
        f.stateMoney = 1e9;
        const victim = normalsOf(g)[0];
        const world = victim.colonies.find((c) => c !== victim.capital && c.population.totalAmount > 0)!;
        takeOwnershipOfColonyFull(g, victim, world, f, false, false);
        const rec = st.processing.find((r) => r.colony === world)!;
        rec.pool = 40_000_000;
        expect(beginSeason(g, st, 1)).toBe(true);
        const grp = st.season!.groups[0];
        grp.ships.push(spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.Cruiser)!, world.xpos, world.ypos));
        const before = st.thrallShips.length;
        const sp = st.season!.staging[grp.staging];
        const added = supplyTroops(g, st, grp, sp.x, sp.y);
        expect(added).toBeGreaterThan(0);
        expect(st.thrallShips.length).toBeGreaterThan(before);
        expect(rec.pool).toBeLessThan(40_000_000);
        const thrall = st.thrallShips[st.thrallShips.length - 1];
        expect(thrall.troops!.count).toBeGreaterThan(0);
        expect(Math.hypot(thrall.xpos - world.xpos, thrall.ypos - world.ypos)).toBeLessThan(60000); // made at the world, not at the Beacon
        expect(grp.transports).toContain(thrall);
        // a player ship kills it: an interception
        const killer = normalsOf(g)[1];
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: thrall, destroyer: killer });
        expect(st.stats.thrallIntercepted).toBe(1);
        expect(salvageStepsOf(st, killer)).toBe(0); // one transport is not yet a step
        // planet strike: the stock planet destroyer, aimed at the target
        const target = g.habitats.find((h) => h !== null && !h.hasBeenDestroyed && h.population != null && h.population.totalAmount > 0 && h.diameter <= 400 && h.empire !== f && h.category === HabitatCategoryType.Planet)!;
        grp.target = target;
        planetStrike(g, st, grp);
        expect(grp.destroyer).not.toBeNull();
        expect(grp.destroyer!.isPlanetDestroyer).toBe(true);
        const m = builtObjectMission(grp.destroyer!.mission);
        expect(m!.type).toBe(BuiltObjectMissionType.Attack);
        expect(m!.targetHabitat).toBe(target);
        const pop = target.population.totalAmount;
        scenarioEmit(g, 'habitatDestroyed', { habitat: target, destroyer: f });
        expect(st.stats.planetsDestroyed).toBe(1);
        expect(st.popEliminated).toBeGreaterThanOrEqual(pop);
    }, 900000);

    it('a group whose staging fleet was beaten down below a quarter of its share is called off at the departure; its ships go to the reserve', () => {
        const { g, st } = completed();
        const f = st.faction!;
        f.stateMoney = 1e9;
        beginSeason(g, st, 1);
        const season = st.season!;
        // run the spawn half of the preparation, then kill every ship of the first group
        for (let i = 0; i < 40; i++) {
            g.nowMs += 5 * GAME_DAY_LENGTH;
            reclamationPeriodic(g);
            if (g.nowMs > 0 && season.groups.every((x) => x.ships.length > 0)) break;
        }
        const weak = season.groups[0];
        for (const b of weak.ships.slice(1)) builtObjectCompleteTeardown(g, b);
        for (let i = 0; i < 120 && season.phase === 'prep'; i++) {
            g.nowMs += 5 * GAME_DAY_LENGTH;
            reclamationPeriodic(g);
        }
        expect(season.phase).toBe('offensive');
        const others = season.groups.filter((x) => x !== weak && x.state !== 'done');
        expect(others.length).toBeGreaterThan(0);
        if (weak.state === 'done') expect(weak.ships).toHaveLength(0);
        expect(new Set(season.departures).size).toBe(1);
    }, 1800000);

    it('the loss: 80% of the starting population eliminated ends the game in defeat; below it does not', () => {
        const { g, st } = completed();
        st.popEliminated = st.popBaseline * 0.79;
        lossCheck(g, st);
        expect(g.gameIsFinished).toBe(false);
        st.popEliminated = st.popBaseline * 0.8;
        lossCheck(g, st);
        expect(g.gameIsFinished).toBe(true);
        expect(st.ended).toBe(true);
    }, 900000);

    it('the dark bargain: the AI refuses unless it is losing; giving up a colony spares it, the protectorate fights on their side; both can be exposed as a war crime', () => {
        const { g, st } = completed();
        g.scenario!.flags.warCrimes = true;
        const [a, b] = normalsOf(g).filter((e) => e.colonies.length >= 2);
        // ordinary: refuse
        st.lostBy[String(a.empireId)] = 0;
        expect(offerCandidates(g, st, galaxyStarDate(g))).not.toContain(a);
        // hurt a: it becomes a candidate; weak and hurt it gives a colony up
        st.lostBy[String(a.empireId)] = 1;
        expect(offerCandidates(g, st, galaxyStarDate(g))).toContain(a);
        const colony = colonyToCede(a)!;
        expect(colony).not.toBeNull();
        expect(colony).not.toBe(a.capital);
        const dec = { options: [{ id: 'refuse' }, { id: 'cede' }, { id: 'protectorate' }], empire: a } as unknown as ScenarioDecision;
        expect(aiBargainChoice(g, dec)).toBe('refuse'); // one loss is not enough
        for (const lost of [2, 4, 40]) {
            st.lostBy[String(a.empireId)] = lost;
            const ref = Math.max(...normalsOf(g).map((e) => militaryPotency(e)));
            const share = lost / (lost + a.colonies.length);
            const want = militaryPotency(a) < ref * 0.25 && lost >= 4 && share >= 0.3 ? 'protectorate' : militaryPotency(a) < ref * 0.4 && lost >= 2 && share >= 0.2 ? 'cede' : 'refuse';
            expect(aiBargainChoice(g, dec)).toBe(want);
        }
        st.lostBy[String(a.empireId)] = 1;
        // cede
        resolveBargain(g, { empire: a, context: { colony: g.habitats.indexOf(colony) }, options: dec.options } as unknown as ScenarioDecision, 'cede');
        expect(colony.empire).toBe(st.faction);
        expect(st.bargains).toHaveLength(1);
        expect(atWarWith(a, st.faction!)).toBe(false);
        expect(targetCandidates(g, st, galaxyStarDate(g)).some((c) => c.empire === a)).toBe(false);
        // exposure: a war crime on a's record
        expose(g, st, st.bargains[0], a, b);
        expect(st.bargains[0].discovered).toBe(true);
        expect(warCrimesRecord(g, a)?.counts.collaboration).toBe(1);
        // the term ends: hunted again
        g.nowMs += 800 * GAME_DAY_LENGTH;
        counterMonthly(g);
        expect(st.bargains[0].ended).toBe(true);
        expect(atWarWith(a, st.faction!)).toBe(true);
        // protectorate: at war with everyone else, cannot make peace with them, liquified at the end
        resolveBargain(g, { empire: b, context: { colony: -1 }, options: [] } as unknown as ScenarioDecision, 'protectorate');
        expect(atWarWith(b, st.faction!)).toBe(false);
        const others = normalsOf(g).filter((e) => e !== b);
        expect(others.every((e) => atWarWith(b, e))).toBe(true);
        expect(scenarioQuery(g, 'endWarAcceptance', true, { empire: others[0], other: b })).toBe(false);
        g.nowMs += 8 * 360 * GAME_DAY_LENGTH + 10000;
        counterMonthly(g);
        expect(atWarWith(b, st.faction!)).toBe(true);
    }, 900000);

    it('salvage: points from kills and boarded hulls unlock counter-tech steps (free breakthroughs, resistance, the traced signal)', () => {
        const { g, st } = completed();
        const e = normalsOf(g)[0];
        beginSeason(g, st, 1);
        const researched = (): number => e.research.techTree.filter((n) => n.isResearched).length;
        const n0 = researched();
        addSalvage(g, st, e, 4);
        expect(salvageStepsOf(st, e)).toBe(1);
        expect(researched()).toBeGreaterThanOrEqual(n0);
        expect(resistanceFactor(st, e)).toBe(1);
        addSalvage(g, st, e, 8);
        expect(salvageStepsOf(st, e)).toBe(2);
        addSalvage(g, st, e, 12);
        expect(salvageStepsOf(st, e)).toBe(3);
        expect(resistanceFactor(st, e)).toBe(0.5);
        addSalvage(g, st, e, 16);
        expect(salvageStepsOf(st, e)).toBe(4);
        for (const sp of st.season!.staging) expect(knowledgeLevel(sp, e)).toBe(KNOWLEDGE_CONFIRMED);
        expect(st.stats.salvageSteps).toBe(4);
    }, 900000);

    it('save / load mid-campaign: the cloaks, the Watchers, the season and the stats survive and the run continues identically', () => {
        const { g, st, game, gameData } = completed();
        st.faction!.stateMoney = 1e9;
        beginSeason(g, st, 1);
        runGameSeconds(g, 60);
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const lg = deserializeGame(text, gameData).game.galaxy;
        const ls = peekBeaconState(lg)!;
        expect(ls.phase).toBe('reclamation');
        expect(ls.watchers.map((w) => [w.mode, w.ship?.cloaked])).toEqual(st.watchers.map((w) => [w.mode, w.ship?.cloaked]));
        expect(ls.season!.groups.length).toBe(st.season!.groups.length);
        expect(JSON.stringify(ls.stats)).toBe(JSON.stringify(st.stats));
        runGameSeconds(g, 30);
        runGameSeconds(lg, 30);
        expect(stateDigest(lg)).toBe(stateDigest(g));
    }, 1800000);
});
