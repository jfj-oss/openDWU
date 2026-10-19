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
    KNOWLEDGE_SUSPECTED,
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
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { findNewestCanBuild, generateDesignFromSpec } from '../src/sim/designGeneration';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { threatMarker, THREAT_CONFIRMED_COLOR, THREAT_SUSPECTED_COLOR } from '../src/render/overlayLayer';
import type { CreateGameOptions } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { registerScenarioEvent, registerScenarioQuery, scenarioEmit, scenarioQuery } from '../src/sim/scenario/hooks';
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
import { BuiltObjectMissionPriority, BuiltObjectMissionType, CommandAction, builtObjectMission } from '../src/sim/missions/mission';
import { assignMission } from '../src/sim/missions/assign';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { reviewThreatInvestigations, THREAT_INVESTIGATIONS_KEY } from '../src/sim/scenario/threats/investigate';
import { issuePlayerCommand, runPlayerCommand } from '../src/sim/player/playerCommands';
import { spawnableThreats } from '../src/sim/scenario/threats/framework';
import { createGame, type Game } from '../src/sim/game';
import { tickGameOptions } from './helpers/tickGame';
import { peekCultState } from '../src/sim/scenario/threats/cult';
import { peekHiveState } from '../src/sim/scenario/threats/hive';
import { peekGreyTideState } from '../src/sim/scenario/threats/greyTide';
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
import { shouldAttack } from '../src/sim/combat/attackAI';
import { inflictDamage } from '../src/sim/combat/damage';
import { sparedObjects } from '../src/sim/combat/spared';
import { clearHostility, forgetGuardians, guardiansOf, normalEmpires, threatEmpires } from '../src/sim/scenario/threats/framework';
import { buildActionMenu } from '../src/sim/player/orderMenu';
import { createShipAction, ShipActionType } from '../src/sim/player/shipAction';
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
import { pendingScenarioDecisions, answerScenarioDecision, expireScenarioDecisions } from '../src/sim/scenario/decisions';
import { isCrisisFaction } from '../src/sim/scenario/threats/crisis';
import { scenarioFlag } from '../src/sim/scenario/state';
import { thisYearsResortIncome } from '../src/sim/treasury';
import { WonderType } from '../src/sim/researchSystem';
import { newIntelligenceMissionStealTechData } from '../src/sim/espionage';
import { FaunaVariant, faunaVariantOfCreature } from '../src/sim/scenario/newFauna/common';
import { peekRimFaunaState } from '../src/sim/scenario/rimFauna/common';
import type { Habitat } from '../src/sim/types';
import {
    aiAnswer,
    aiDirectiveScores,
    aiWouldWithdraw,
    awaken,
    bombCost,
    catchSpy,
    deployLogicBomb,
    detectThreats,
    directiveEffect,
    directiveView,
    dirNow,
    driftPerYear,
    fleetCandidates,
    freeIntelOn,
    hackOdds,
    mindOfSite,
    moonCandidate,
    MOTION_SANCTION,
    peekUltramindState,
    philosopherCandidate,
    pickPartners,
    raiseRequest,
    researchDirectiveShare,
    researchPctOf,
    researchPerYear,
    sanctionTarget,
    setDirective,
    ultramindPeriodic,
    ultramindState,
    type UltraMind,
} from '../src/sim/scenario/threats/giantworks/ultramind';
import { dietMotionKindDef, type DietMotion, type DietState } from '../src/sim/scenario/charactersVictory/diet/dietState';
import type { CaptainBonuses } from '../src/sim/characters';
import { HIVE_KEY } from '../src/sim/scenario/threats/hive';
import { newIntelligenceMissionAgainstEmpire } from '../src/sim/espionage';
import { addStress, breachChancePerYear, breachSanctuary, growthBonusAt, rageStep, rageTarget, sanctuaryPeriodic, sanctumOfSite, unleashedScale } from '../src/sim/scenario/threats/giantworks/sanctuary';
import { rebuildIndexes } from '../src/sim/indexRebuild';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { completeWork, greatWorkIsHostile, greatWorkKind, type GreatWorkSite } from '../src/sim/scenario/threats/giantworks/framework';
import { defaultMessageOptions, routeEmpireMessage } from '../src/sim/messageRouting';
import { watcherVariant, beaconBuildRate, beaconComplete, beaconEndCheck, beaconKind, beaconKnownSites, beaconLooks, beaconRolled, beaconShipRole, beaconSuppliers, cloakLapsedFor, corrupt, corruptCandidates, watchersPeriodic } from '../src/sim/scenario/threats/giantworks/beacon';
import { peekBeaconState, salvageStepsOf, siphonGateOpen, siphonOf, type BeaconState, type CattleRec } from '../src/sim/scenario/threats/giantworks/beaconState';
import { beginSeason, driveWatcherFleets, watcherTargetValue, designFor, groupCarryRegiments, scriptedBudget, seasonBudget, landingPlan, lossCheck, noticedGathering, planetStrike, reclamationMonthly, reclamationPeriodic, spawnShip, supplyTroops, targetCandidates } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { coalitionMembers, coalitionPass } from '../src/sim/scenario/threats/giantworks/beaconAi';
import { podWorld, assignEscorts, escortPlan, interceptsAt, noteIntercept, beaconArtInfo, cattleDesign, cattleOf, coreCountFor, coreTarget, coresOf, freeShare, fuelOf, cattleDamage, cattleRepairFactor, cattleStep, feedersOf, harvestMonthly, harvestPeriodic, liveCores, pickCore, poolOf, poolTarget, rescueCattle } from '../src/sim/scenario/threats/giantworks/beaconHarvest';
import { kindTaken } from '../src/sim/scenario/threats/giantworks/founders';
import { isHumanEmpire } from '../src/sim/humanEmpires';
import { aiMayPurge, dwellDaysFor, garrisonStrength, purgePass, purgeRebelStrength, rebelsOn, siphonDonor, siphonPass, siphonRateOf, startPurge, tech5Count } from '../src/sim/scenario/threats/giantworks/beaconSiphon';
import { makeTroopsSplit } from '../src/sim/scenario/threats/factionNavy';
import { resolveInvasionBattles } from '../src/sim/combat/invasion';
import { LAW_MORATORIUM, MOTION_MORATORIUM, knowsBeacon, moratoriumFactor, moratoriumMonthly } from '../src/sim/scenario/threats/giantworks/beaconDiet';
import { dietOn, lawInForce } from '../src/sim/scenario/charactersVictory/diet/dietState';
import { councilState, type Council } from '../src/sim/scenario/emergent/council';
import { addSalvage, aiBargainChoice, colonyToCede, counterMonthly, expose, offerCandidates, purgeCorruption, resistanceFactor, resolveBargain } from '../src/sim/scenario/threats/giantworks/beaconCounter';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { builtObjectVisibility, isObjectVisibleToThisEmpire, isObjectVisibleToThisEmpireImprecise } from '../src/sim/independentTraders';
import type { ScenarioDecision } from '../src/sim/scenario/decisions';
import { generateNewBuiltObject } from '../src/sim/empireEvents';
import { galaxyDesignSpecificationBySubRole } from '../src/sim/gameStartTail';
import { ARK_KEY, arkAiChoice, arkParam, arkFightsAgainst, arkLooks, arkPeriodic, arkPopulation, arkRecOf, escapeSystem, peekArkState, siphonable, type ArkRec, type ArkTarget } from '../src/sim/scenario/threats/giantworks/ark';
import { breakShields, shieldBreakOf, shieldScheduleFraction, stepShields } from '../src/sim/scenario/threats/giantworks/shields';
import { warpSpeedWithBonuses } from '../src/sim/movement';
import { Population } from '../src/sim/population';
import { CAPTURE_KEY, INVADE_ACTION, keepsFiring, aiQuietChoice, capturableWork, captureForces, captureParam, capturePeriodic, captureRecOf, garrisonSize, mayInvade, peekCaptureState, stepCapture, type CaptureRec } from '../src/sim/scenario/threats/giantworks/capture';
import { buildGreatWorkGroundReport } from '../src/ui/screens/groundReportModel';
import { generateNewTroop } from '../src/sim/builtObjectPlacement';
import { loadTroopsOnto } from '../src/sim/scenario/threats/framework';
import { TroopType } from '../src/sim/cargo';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { aiReview } from '../src/sim/scenario/threats/giantworks/ai';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { FleetPosture } from '../src/sim/diplomacyTick';
import { threatGameEndPolicy, threatGameEnd } from '../src/sim/scenario/threats/framework';
import { GameEndOutcome, GameEndEventArgs, setGameEndHandler } from '../src/sim/victory';
// These tests cover each ending's own mechanics; the user's rule that only the Beacon's endings end the game (threatGameEndPolicy)
// is tested in scenarioThreatFramework.test.ts ("threat game-end policy").
threatGameEndPolicy.restrict = false;


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

    it('generation ships: the world ship has a 7+ sublight speed and turns slowly (kept through a reDefine), stages a sector or more out, and its escort patrols instead of sitting on it', () => {
        const g = ntGame(ALL, { ...WAVE });
        const st = genShipsState(g);
        genShipsPeriodic(g);
        const ws = st.worldShip!;
        // Speed: the design's 1-4 is lifted to genShipsWorldShipSpeed (7); the warp speed is untouched.
        expect(ws.topSpeed).toBeGreaterThanOrEqual(7);
        expect(ws.cruiseSpeed).toBeGreaterThanOrEqual(7);
        expect(st.wsLimited).toBe(true);
        const warp = ws.warpSpeed;
        const turn = ws.turnRate;
        // Turn rate: a fifth of the design's, and a reDefine (which recomputes it) lands on the same value, not a squared one.
        ws.reDefine();
        expect(ws.turnRate).toBeCloseTo(turn, 6);
        expect(ws.topSpeed).toBeGreaterThanOrEqual(7);
        expect(ws.warpSpeed).toBe(warp);
        const heavy = st.escorts.map((e) => e.turnRate).sort((a, b) => a - b)[Math.floor(st.escorts.length / 2)];
        expect(turn).toBeLessThan(heavy * 0.5);
        // A speed knocked back (a slowed zone) is restored by the next period; a save from before the limit is limited once.
        ws.topSpeed = 1;
        st.wsLimited = false;
        genShipsPeriodic(g);
        expect(ws.topSpeed).toBeGreaterThanOrEqual(7);
        expect(ws.turnRate).toBeLessThan(turn);
        // Staging: at least genShipsStagingMinSectors (1) from every colony of the target empire when such a system exists.
        const nearest = Math.min(...st.owner!.colonies.filter((c) => !c.hasBeenDestroyed).map((c) => g.calculateDistance(st.stageX!, st.stageY!, c.xpos, c.ypos)));
        expect(nearest).toBeGreaterThanOrEqual(g.sectorSize * 0.99);
        // Patrol: the world ship is at the staging point; the warships all Patrol, the transports Escort, the
        // screens split between rings round the ship and the staging system's planets, and no ring is the stock 400.
        ws.xpos = st.stageX!;
        ws.ypos = st.stageY!;
        for (const b of [...st.escorts, ...st.transports]) b.currentFuel = b.fuelCapacity;
        genShipsPeriodic(g);
        let ring = 0;
        let system = 0;
        for (const b of st.escorts) {
            const m = builtObjectMission(b.mission)!;
            expect(m.type).toBe(BuiltObjectMissionType.Patrol);
            if (m.targetBuiltObject === ws) {
                ring++;
                const legs = m.showAllCommands().filter((c) => c.action === CommandAction.MoveTo && c.targetBuiltObject === ws);
                expect(legs.length).toBeGreaterThan(0);
                for (const c of legs) expect(Math.hypot(c.targetRelativeXpos, c.targetRelativeYpos)).toBeGreaterThan(2000);
            } else {
                system++;
                expect(m.targetHabitat).not.toBeNull();
                expect(g.determineHabitatSystemStar(m.targetHabitat!)!.xpos).toBe(st.stageX);
            }
        }
        expect(ring).toBeGreaterThan(0);
        expect(system + ring).toBe(st.escorts.length);
        for (const b of st.transports) expect(builtObjectMission(b.mission)!.type).toBe(BuiltObjectMissionType.Escort);
    }, 600000);

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

    it('generation ships: a state saved by an older build (no pirate / pirateShips / index ...) is filled with defaults, not thrown on', () => {
        const g = ntGame(ALL, { ...WAVE });
        const st = genShipsState(g);
        genShipsPeriodic(g);
        st.phase = 'ended';
        st.outcome = 'repelled';
        const old = st as unknown as Record<string, unknown>;
        for (const k of ['pirate', 'pirateShips', 'pirateBase', 'index', 'planned', 'spawned', 'nextDate', 'navy', 'retake', 'base', 'committed']) delete old[k];
        expect(() => genShipsPeriodic(g)).not.toThrow();
        expect(peekGenShipsState(g)!.pirate).toBeNull();
        expect(genShipsStates(g)[0].pirateShips).toEqual([]);
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
    it('the Ancient Guardians and the Purifier never interact: no target, no shot, no damage, no war, no capture, in either direction', () => {
        const { g, st } = woken();
        const faction = st.faction!;
        const normals = g.empires.filter((e) => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== g.playerEmpire && e !== st.waker) as Empire[];
        const guardians = normals[0];
        const other = g.playerEmpire!;
        guardians.dominantRace = g.races.find((r) => r.name.toLowerCase() === 'mechanoid')!; // the story empire, as identifyMechanoidEmpire finds it
        forgetGuardians(g);
        expect(guardiansOf(g)).toBe(guardians);
        // Every threat's victim lists (threatEmpires) leave the Guardians out; the Beacon's (normalEmpires) keep them.
        expect(threatEmpires(g).includes(guardians)).toBe(false);
        expect(normalEmpires(g).includes(guardians)).toBe(true);
        // The shared query is symmetric, covers the Guardians only, and is quiet for everyone else.
        expect(scenarioQuery(g, 'empiresSpared', false, { a: faction, b: guardians })).toBe(true);
        expect(scenarioQuery(g, 'empiresSpared', false, { a: guardians, b: faction })).toBe(true);
        expect(scenarioQuery(g, 'empiresSpared', false, { a: faction, b: other })).toBe(false);
        expect(scenarioQuery(g, 'declareWarBlocked', false, { empire: faction, target: guardians })).toBe(true);
        // Ships: the Purifier's escort never picks a Guardian ship, nor a Guardian ship the escort; it still picks everyone else's.
        const escort = st.escorts[0];
        const gShip = guardians.builtObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military)!;
        const oShip = other.builtObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military)!;
        for (const v of [gShip, oShip]) {
            v.xpos = escort.xpos + 10;
            v.ypos = escort.ypos;
            v.nearestSystemStar = escort.nearestSystemStar;
        }
        const time = galaxyStarDate(g);
        expect(shouldAttack(g, escort, gShip, time)).toBe(false);
        expect(shouldAttack(g, gShip, escort, time)).toBe(false);
        expect(shouldAttack(g, escort, oShip, time)).toBe(true);
        // No damage either way, and the Purifier's targets never include a Guardian colony.
        expect(inflictDamage(g, escort, gShip, null, 50, time, 10, 0)).toBe(false);
        expect(sparedObjects(g, gShip, escort)).toBe(true);
        expect(purifierTargets(g, st).some((h) => h.empire === guardians)).toBe(false);
        // A save where they were already at war: the next clearing pass drops the targets.
        escort.currentTarget = gShip;
        gShip.currentTarget = escort;
        clearHostility(g, faction, guardians);
        expect(escort.currentTarget).toBeNull();
        expect(gShip.currentTarget).toBeNull();
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
        expect(Object.keys(notes).sort()).toEqual(['corporateCoup', 'cult', 'darkFarms', 'doppelgangers', 'exchange', 'generationShips', 'giantworks', 'greyTide', 'hive', 'hollowFleet', 'probeSwarm', 'purifier', 'robotMutiny', 'timeBomb', 'voidWhale'].concat(Object.keys(notes).filter((k) => k.startsWith('giantworks:'))).sort());
        expect(notes.darkFarms).toMatch(/add-on on at game start/);
        expect(notes.robotMutiny).toMatch(/add-on on at game start/);
        expect(notes.timeBomb).toMatch(/add-on on at game start/);
        expect(notes.corporateCoup).toMatch(/chartered company/);
        const keys = Object.keys(notes).filter((k) => notes[k] === null && !k.startsWith('giantworks')); // Giantworks has its own tests
        expect(keys).toHaveLength(10);
        expect(keys).not.toContain('silence'); // The Silence is temporarily disabled
        for (const key of keys) expect(spawn(g, p, key), key).toBe(true);
        expect(peekPurifierState(g)!.waker).toBe(p);
        expect(peekPurifierState(g)!.hunted).toEqual([p.dominantRace!.raceFamily]);
        expect(genShipsStates(g)[0].owner).toBe(p);
        expect(peekCultState(g)!.converted.some((r) => r.character.empire === p)).toBe(true);
        expect(peekHiveState(g)!.faction).not.toBeNull();
        expect(peekGreyTideState(g)!.nests).toHaveLength(1);
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
        return createScenarioGame(base, { scenario: comboOverlayFs(scenario), flags: { threatGiantworks: true, gwCasino: false, gwUltramind: false, gwSanctuary: false, gwBeacon: false, gwArk: false, ...flags }, params, options: age3 });
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
        // Protect: warships on station for a year (credited by elapsed time: 40 steps 10 days apart).
        const p = actors(g)[1];
        const warship = p.builtObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0)!;
        warship.xpos = w.base!.xpos;
        warship.ypos = w.base!.ypos;
        rebuildIndexes(g);
        expect(stationedEmpires(g, w)).toContain(p);
        for (let i = 0; i < 40; i++) {
            w.protectAt = galaxyStarDate(g) - 10 * GAME_DAY_LENGTH;
            protectStep(g, w);
        }
        expect(w.protectors).toContain(p.empireId);
        // Credit is the time since the last step: 36 steps 10 days apart = 360 days, the need.
        expect(w.protectDays[p.empireId]).toBeGreaterThanOrEqual(360);
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

    it('Guarantee the Beacon: on, the first Great Work is the Beacon even below the empire minimum; off, it is rolled as usual', () => {
        const on = gw({ gwBeacon: true, gwBeaconGuaranteed: true, gwTestA: false, gwTestB: false, gwTestC: false }, { giantworksBeaconMinEmpires: 100 });
        expect(greatWorks(on)[0].wonder).toBe('beacon');
        const off = gw({ gwBeacon: true, gwTestA: false, gwTestB: false, gwTestC: false }, { giantworksBeaconMinEmpires: 100 });
        expect(greatWorks(off)[0].wonder).not.toBe('beacon');
    }, 900000);

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

    // ---------------------------------------------------------------------------------------------------------------
    // The Ultramind and the Leviathan Sanctuary (giantworks/ultramind.ts, sanctuary.ts): the real wonders, forced and finished at once.
    // ---------------------------------------------------------------------------------------------------------------
    /** A finished Ultramind / Sanctuary. `holder`: the empire that takes the benefit (an AI, the human player, or nobody's territory). */
    function wonder(kind: 'ultramind' | 'sanctuary', params: Record<string, number> = {}, holder: 'ai' | 'player' | null = null, scenario: string[] = ids, flags: Record<string, boolean> = {}) {
        const { game, gameData } = gwFull(flags, params, scenario);
        const g = game.galaxy;
        const w = greatWorks(g)[0];
        w.wonder = kind;
        w.gatherDate = 0;
        giantworksPeriodic(g);
        expect(w.phase).toBe('building');
        const e: Empire | null = holder === null ? null : holder === 'player' ? g.playerEmpire! : actors(g).find((x) => x !== g.playerEmpire)!;
        if (e !== null) w.holder = e;
        completeWork(g, w);
        return { g, w, e, game, gameData };
    }
    const siteOf = (w: GreatWorkRecord) => w.system.systemStar;
    const warships = (e: Empire): BuiltObject[] => e.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0);

    it('the Ultramind and the Sanctuary are registered with their flags, weights and hints (general first); the Game Editor starts them', () => {
        const g = gw({ threatGiantworks: false });
        const u = greatWorkKind('ultramind')!;
        expect([u.flag, u.weight, u.hintTags]).toEqual(['gwUltramind', 15, ['superconductors', 'cooling', 'cores']]);
        const v = greatWorkKind('sanctuary')!;
        expect([v.flag, v.weight, v.hintTags]).toEqual(['gwSanctuary', 15, ['glass-ice', 'plankton', 'containment']]);
        expect(kindName('ultramind')).toBe('The Ultramind');
        expect(kindName('sanctuary')).toBe('The Leviathan Sanctuary');
        expect(KIND_MENACE.ultramind).toBeGreaterThan(KIND_MENACE.sanctuary);
        const keys = spawnableThreats(g).map((t) => t.key);
        expect(keys).toContain('giantworks:ultramind');
        expect(keys).toContain('giantworks:sanctuary');
        expect(spawnThreatNow(g, g.playerEmpire!, 'giantworks:ultramind')).toBe(true);
        expect(greatWorks(g)[0].wonder).toBe('ultramind');
    }, 900000);

    // --- helpers for the Ultramind tests ---
    const sidOf = (e: Empire): string => String(e.empireId);
    /** No requests and no AI directive review during the step under test. */
    const quiet = (m: UltraMind): void => {
        for (const e of m.partners) m.nextRequest[sidOf(e)] = Number.MAX_VALUE;
        m.nextDirectiveReview = Number.MAX_VALUE;
    };
    const yearOn = (g: Galaxy, w: GreatWorkRecord, m: UltraMind): void => {
        m.lastTick -= YEAR_LENGTH;
        ultramindPeriodic(g, w);
    };
    /** The partners' warships beside the site (the machine hacks those near it). */
    const gather = (m: UltraMind, star: Habitat, who: Empire[]): void => {
        for (const p of who) warships(p).slice(0, 3).forEach((b, i) => { b.xpos = star.xpos + 800 * i; b.ypos = star.ypos + 400; });
    };
    const captain = (): CaptainBonuses => ({ targeting: 100, countermeasures: 100, shipManeuvering: 100, fighters: 100, shipEnergyUsage: 100, weaponsDamage: 100, weaponsRange: 100, shieldRechargeRate: 100, damageControl: 100, repair: 100, hyperjumpSpeed: 100 });

    it('the Ultramind: contracts (the territory owner first, at most three), +100% for the holder and +50% for the partners, a standing for each, the mood and the directive in its name', () => {
        const { g, w, e } = wonder('ultramind', {}, 'ai');
        const m = mindOfSite(g, w)!;
        expect(m.partners[0]).toBe(e);
        expect(m.holder).toBe(e);
        expect(m.partners.length).toBeGreaterThanOrEqual(1);
        expect(m.partners.length).toBeLessThanOrEqual(3);
        expect(new Set(m.partners).size).toBe(m.partners.length);
        for (const p of m.partners) expect(m.standing[sidOf(p)]).toBe(60);
        expect(m.contentment).toBe(60);
        expect(m.directive).toBe('research');
        expect(w.base!.name).toBe('The Ultramind (content, Research)');
        expect(w.awakened).toBe(false);
        // A year on: the holder gets a whole year's output in research points, the others half of one; the others' fees go to the owner.
        const expected = m.partners.reduce((a, x) => a + (x === e ? 1 : 0.5) * researchPerYear(g, x), 0);
        expect(expected).toBeGreaterThan(0);
        const money = e!.stateMoney;
        quiet(m);
        yearOn(g, w, m);
        expect(m.stats.researchGranted).toBeGreaterThan(0.3 * expected);
        expect(m.stats.researchGranted).toBeLessThanOrEqual(expected * 1.001 + 1);
        // The drift is per partner: the holder's is 1.5 times as fast.
        expect(m.standing[sidOf(e!)]).toBeCloseTo(60 - 6, 0);
        for (const p of m.partners) if (p !== e) expect(m.standing[sidOf(p)]).toBeCloseTo(56, 0);
        expect(m.contentment).toBeCloseTo(54, 0); // the lowest standing: the holder's
        if (m.partners.length > 1) {
            expect(m.stats.feesPaid).toBeGreaterThan(0);
            expect(e!.stateMoney - money).toBeCloseTo(m.stats.feesPaid, 3); // the holder takes the whole of it
        }
        // Under another directive the research bonus is a third.
        m.directive = 'economy';
        expect(researchDirectiveShare(g, m, galaxyStarDate(g))).toBeCloseTo(0.33, 9);
        // A partner's stolen technology is worth a little more; a stranger's is not.
        const stranger = actors(g).find((x) => !m.partners.includes(x));
        const before = m.stats.researchGranted;
        const steal = (who: Empire) => scenarioEmit(g, 'intelMissionCompleted', { empire: who, mission: newIntelligenceMissionStealTechData(who, null, galaxyStarDate(g), m.partners[0], null), outcome: null });
        if (stranger !== undefined) {
            steal(stranger);
            expect(m.stats.researchGranted).toBe(before);
        }
        steal(m.partners[0]);
        expect(m.stats.theftBoosts).toBe(1);
        expect(m.stats.researchGranted).toBeGreaterThan(before);
    }, 900000);

    it('the Ultramind: every abuse costs only the empire that did it (attacks once in 20 days each, sabotage, a war costs the aggressor, not the victim); the mood is the lowest standing', () => {
        const { g, w, e } = wonder('ultramind', {}, 'ai');
        const m = mindOfSite(g, w)!;
        quiet(m);
        const others = m.partners.filter((p) => p !== e);
        const hit = (who: Empire) => scenarioEmit(g, 'builtObjectAttacked', { builtObject: w.base!, attacker: null, attackingEmpire: who });
        hit(e!);
        expect(m.standing[sidOf(e!)]).toBeCloseTo(58.5, 5);
        hit(e!); // the same spell
        expect(m.standing[sidOf(e!)]).toBeCloseTo(58.5, 5);
        for (const p of others) expect(m.standing[sidOf(p)]).toBe(60); // nobody else is held to account
        if (others.length > 0) {
            hit(others[0]);
            expect(m.standing[sidOf(others[0])]).toBeCloseTo(58.5, 5);
            expect(m.standing[sidOf(e!)]).toBeCloseTo(58.5, 5);
        }
        const sab = newIntelligenceMissionAgainstBuiltObject(e!, null, IntelligenceMissionType.SabotageConstruction, galaxyStarDate(g), w.base!);
        scenarioEmit(g, 'intelMissionCompleted', { empire: e!, mission: sab, outcome: null });
        expect(m.standing[sidOf(e!)]).toBeCloseTo(50.5, 5);
        expect(w.base!.name).toBe('The Ultramind (content, Research)');
        scenarioEmit(g, 'intelMissionCompleted', { empire: e!, mission: sab, outcome: null });
        expect(m.standing[sidOf(e!)]).toBeCloseTo(42.5, 5);
        expect(m.contentment).toBeCloseTo(42.5, 5);
        expect(w.base!.name).toBe('The Ultramind (restless, Research)');
        expect(m.lost[sidOf(e!)].sabotage).toBeCloseTo(16, 5);
        // A war between two partners: the one that declared it pays, the victim nothing; the answer of the victim's ally is no offence.
        if (others.length >= 2) {
            const [a, b] = others;
            const sa = m.standing[sidOf(a)];
            const sb = m.standing[sidOf(b)];
            declareWar(g, a, b, null, false);
            expect(m.standing[sidOf(a)]).toBeCloseTo(sa - 10, 5);
            expect(m.standing[sidOf(b)]).toBe(sb);
            expect(m.wars).toHaveLength(1);
            expect(m.wars[0].aggressor).toBe(a);
            m.lastTick -= YEAR_LENGTH;
            ultramindPeriodic(g, w);
            expect(sa - 10 - m.standing[sidOf(a)]).toBeCloseTo(4 + 3, 0); // drift and the war it began
            expect(sb - m.standing[sidOf(b)]).toBeCloseTo(4, 0); // only the drift
            // b's ally c (the holder) declaring on a later is the answer to the aggressor: nothing.
            const eBefore = m.standing[sidOf(e!)];
            scenarioEmit(g, 'warDeclared', { empire: e!, target: a });
            expect(m.standing[sidOf(e!)]).toBe(eBefore);
        }
    }, 900000);

    it('the Ultramind: a request is a scenario decision to each partner (grant raises its standing, refuse lowers it more and the holder then drifts faster, silence refuses); each kind costs what it says', () => {
        const { g, w } = wonder('ultramind', {}, 'player');
        const p = g.playerEmpire!;
        const m = mindOfSite(g, w)!;
        const now = galaxyStarDate(g);
        expect(m.holder).toBe(p);
        // Power: a share of the yearly income, paid out.
        raiseRequest(g, m, now, 'power');
        let d = pendingScenarioDecisions(g, p)[0];
        expect(d.kind).toBe('gwUltramind.request');
        expect(d.options.map((o) => o.id)).toEqual(['grant', 'refuse']);
        expect(d.defaultOption).toBe('refuse');
        expect(m.requests[sidOf(p)]?.kind).toBe('power');
        const money = p.stateMoney;
        const cost = m.requests[sidOf(p)].cost;
        expect(cost).toBeGreaterThanOrEqual(100000);
        const c0 = m.standing[sidOf(p)];
        expect(answerScenarioDecision(g, d.id, 'grant')).toBe(true);
        expect(p.stateMoney).toBeCloseTo(money - cost, 3);
        expect(m.standing[sidOf(p)]).toBe(c0 + 14);
        expect(m.requests[sidOf(p)]).toBeUndefined();
        expect(m.nextRequest[sidOf(p)] - now).toBeGreaterThanOrEqual(YEAR_LENGTH * 0.999);
        expect(m.nextRequest[sidOf(p)] - now).toBeLessThanOrEqual(YEAR_LENGTH * 2.001);
        // Refusing costs more than granting gave, and the holder that refuses drifts away faster.
        raiseRequest(g, m, now, 'network');
        d = pendingScenarioDecisions(g, p)[0];
        const c1 = m.standing[sidOf(p)];
        answerScenarioDecision(g, d.id, 'refuse');
        expect(m.standing[sidOf(p)]).toBe(c1 - 16);
        expect(m.ignored[sidOf(p)]).toBe(1);
        expect(m.stats).toMatchObject({ asked: 2, granted: 1, refused: 1 });
        expect(driftPerYear(g, m, p)).toBeCloseTo(4 * 1.5 + 2, 9);
        // The other partners are asked too (less often): their own standing is what moves.
        const other = m.partners.find((x) => x !== p);
        if (other !== undefined && other !== p) {
            const s0 = m.standing[sidOf(other)];
            raiseRequest(g, m, now, 'power', other); // an AI answers at once
            expect(m.standing[sidOf(other)]).not.toBe(s0);
            expect(m.standing[sidOf(p)]).toBe(c1 - 16); // the holder's is untouched
            expect(driftPerYear(g, m, other)).toBe(4);
        }
        // Network access: counter-intelligence weakens for two years.
        m.directive = 'economy';
        expect(scenarioQuery(g, 'counterIntelligenceProportion', 1, { empire: p })).toBe(1);
        raiseRequest(g, m, now, 'network');
        answerScenarioDecision(g, pendingScenarioDecisions(g, p)[0].id, 'grant');
        expect(scenarioQuery(g, 'counterIntelligenceProportion', 1, { empire: p })).toBeCloseTo(0.35, 9);
        expect(m.exposedUntil[String(p.empireId)] - now).toBeCloseTo(2 * YEAR_LENGTH, -3);
        // A moon to grow onto: a colony in range goes to the independents.
        g.scenario!.params.ultramindMoonSectors = 500;
        const moon = moonCandidate(g, m, p);
        expect(moon).not.toBeNull();
        raiseRequest(g, m, now, 'moon');
        answerScenarioDecision(g, pendingScenarioDecisions(g, p)[0].id, 'grant');
        expect(moon!.empire).toBe(g.independentEmpire);
        expect(p.colonies).not.toContain(moon);
        // A philosopher: the best scientist leaves.
        const phil = philosopherCandidate(p);
        if (phil !== null) {
            raiseRequest(g, m, now, 'philosopher');
            answerScenarioDecision(g, pendingScenarioDecisions(g, p)[0].id, 'grant');
            expect(phil.active).toBe(false);
        }
        // A warfleet to study: the smallest warships are taken apart.
        const fleet = fleetCandidates(g, p);
        if (fleet.length > 0) {
            raiseRequest(g, m, now, 'fleet');
            answerScenarioDecision(g, pendingScenarioDecisions(g, p)[0].id, 'grant');
            expect(fleet.every((b) => b.hasBeenDestroyed)).toBe(true);
            expect(m.stats.fleetsStudied).toBe(3);
        }
        // An unanswered request expires into a refusal.
        const refused = m.stats.refused;
        raiseRequest(g, m, now, 'power');
        d = pendingScenarioDecisions(g, p)[0];
        d.expiresStarDate = 1;
        expireScenarioDecisions(g);
        expect(m.stats.refused).toBe(refused + 1);
        expect(d.answeredBy).toBe('expired');
        // The request that matches the directive is the likelier one.
        m.directive = 'intelligence';
        const asked = new Set<string>();
        for (let i = 0; i < 40; i++) {
            m.askedKinds = [];
            m.standing[sidOf(p)] = 100;
            raiseRequest(g, m, now);
            asked.add(m.requests[sidOf(p)].kind);
            for (const dec of pendingScenarioDecisions(g, p)) answerScenarioDecision(g, dec.id, 'refuse');
        }
        expect(asked.has('network')).toBe(true);
    }, 900000);

    it('the Ultramind: an AI answers at once, by personality, its own standing and means', () => {
        const { g, w, e } = wonder('ultramind', {}, 'ai');
        const m = mindOfSite(g, w)!;
        const now = galaxyStarDate(g);
        for (const kind of ['power', 'network'] as const) {
            const seq = m.requestSeq + 1;
            const want = aiAnswer(g, m, e!, kind, seq);
            const before = { ...m.stats };
            raiseRequest(g, m, now, kind);
            expect(pendingScenarioDecisions(g, e!)).toHaveLength(0);
            expect(m.requests[sidOf(e!)]).toBeUndefined();
            expect(m.stats.granted - before.granted).toBe(want === 'grant' ? 1 : 0);
            expect(m.stats.refused - before.refused).toBe(want === 'refuse' ? 1 : 0);
        }
        // The unhappier it is, the likelier any empire is to give in; the same empire and request.
        for (const kind of ['power', 'network', 'moon', 'philosopher', 'fleet'] as const) {
            m.standing[sidOf(e!)] = 100;
            const calm = aiAnswer(g, m, e!, kind, 7);
            m.standing[sidOf(e!)] = 5;
            const desperate = aiAnswer(g, m, e!, kind, 7);
            if (calm === 'grant') expect(desperate).toBe('grant');
        }
    }, 900000);

    it('the Ultramind awakens when a partner reaches nothing: war ONLY on the partners whose standing collapsed, the rest stay neutral and get a deal; hacks and dark ports only for those at war with it', () => {
        const { g, w, e } = wonder('ultramind', { ultramindHackPct: 100 }, 'ai');
        const m = mindOfSite(g, w)!;
        const star = siteOf(w);
        quiet(m);
        gather(m, star, m.partners);
        const offender = e!;
        const rest = m.partners.filter((p) => p !== offender);
        // A lonely holder is not enough for this test.
        if (rest.length === 0) return;
        const nearCount = warships(offender).slice(0, 3).length;
        expect(nearCount).toBeGreaterThan(0);
        m.standing[sidOf(offender)] = 1;
        m.lastTick -= YEAR_LENGTH;
        ultramindPeriodic(g, w);
        expect(m.awakened).toBe(true);
        expect(w.awakened).toBe(true);
        expect(greatWorkIsHostile(w)).toBe(true);
        const f = ultramindState(g).faction!;
        expect(f.active).toBe(true);
        expect(f.name).toBe('The Awakened Ultramind');
        expect(f.dominantRace?.name).toBe('Harvester');
        expect(isCrisisFaction(g, f)).toBe(true);
        expect(w.base!.actualEmpire).toBe(f);
        expect(w.base!.name).toBe('The Ultramind (AWAKE)');
        expect(warCrimesRecord(g, f)?.counts.greatWork ?? 0).toBe(0);
        expect(m.offenders).toEqual([offender]);
        expect(f.diplomaticRelations.byEmpire(offender)?.type).toBe(DiplomaticRelationType.War);
        for (const p of rest) expect(f.diplomaticRelations.byEmpire(p)?.type).not.toBe(DiplomaticRelationType.War);
        // The deal: every spared partner either keeps its contract (and sanctions the offender) or left it.
        for (const p of rest) {
            const k = sidOf(p);
            if (m.partners.includes(p)) expect(m.deals[k]).toBe('accepted');
            else expect(m.withdrawn[k].why).toBe('declined');
        }
        expect(m.stats.dealsAccepted + m.stats.dealsDeclined).toBe(rest.length);
        // Hacked: the offender's ships next to the site (certain with the odds at 100), nothing from the others.
        expect(m.hacked.length).toBeGreaterThanOrEqual(Math.min(nearCount, 8));
        expect(m.hacked.length).toBeLessThanOrEqual(8);
        for (const h of m.hacked) {
            expect(h.ship.actualEmpire).toBe(f);
            expect(h.from).toBe(offender);
        }
        const drones = warships(f).filter((b) => !m.hacked.some((h) => h.ship === b));
        expect(drones.length).toBeGreaterThan(0);
        expect(drones.length).toBeLessThanOrEqual(12);
        // The ports within five sectors are dark for 30 to 90 days, for the empires at war with it only.
        const now = galaxyStarDate(g);
        expect(m.portsUntil - now).toBeGreaterThanOrEqual(30 * GAME_DAY_LENGTH - 1);
        expect(m.portsUntil - now).toBeLessThanOrEqual(90 * GAME_DAY_LENGTH + 1);
        const colony = (empire: Empire, dx: number) => ({ xpos: star.xpos + dx, ypos: star.ypos, empire }) as unknown as Habitat;
        expect(scenarioQuery(g, 'constructionQueuePaused', false, { habitat: colony(offender, 100), builtObject: null })).toBe(true);
        expect(scenarioQuery(g, 'constructionQueuePaused', false, { habitat: colony(offender, 6 * g.sectorSize), builtObject: null })).toBe(false);
        for (const p of rest) expect(scenarioQuery(g, 'constructionQueuePaused', false, { habitat: colony(p, 100), builtObject: null })).toBe(false);
        const port = (empire: Empire) => ({ xpos: star.xpos + 100, ypos: star.ypos, actualEmpire: empire, empire }) as unknown as BuiltObject;
        expect(scenarioQuery(g, 'portTradeIncomeFactor', 1, { port: port(offender), amount: 1000 })).toBe(0);
        for (const p of rest) expect(scenarioQuery(g, 'portTradeIncomeFactor', 1, { port: port(p), amount: 1000 })).toBe(1);
        m.portsUntil = now - 1;
        expect(scenarioQuery(g, 'constructionQueuePaused', false, { habitat: colony(offender, 100), builtObject: null })).toBe(false); // lit again
        // Private freight of the offender within five sectors stops; the others', warships and distant freighters are not touched.
        const freighter = (owner: Empire, dx: number, role = BuiltObjectRole.Freight, sub = BuiltObjectSubRole.SmallFreighter) => ({ role, subRole: sub, xpos: star.xpos + dx, ypos: star.ypos, actualEmpire: owner }) as unknown as BuiltObject;
        const ask = (b: BuiltObject) => scenarioQuery(g, 'assignMissionAllowed', true, { builtObject: b, missionType: BuiltObjectMissionType.Move, target: null, x: 0, y: 0 });
        expect(ask(freighter(offender, 500))).toBe(false);
        expect(ask(freighter(offender, 6 * g.sectorSize))).toBe(true);
        expect(ask(freighter(offender, 500, BuiltObjectRole.Military, BuiltObjectSubRole.Cruiser))).toBe(true);
        for (const p of rest) expect(ask(freighter(p, 500))).toBe(true);
        // Whoever strikes the base is at war with it; a spared partner that does loses its deal.
        const stranger = actors(g).find((x) => !m.partners.includes(x) && x !== offender);
        if (stranger !== undefined) {
            expect(f.diplomaticRelations.byEmpire(stranger)?.type).not.toBe(DiplomaticRelationType.War);
            scenarioEmit(g, 'builtObjectAttacked', { builtObject: w.base!, attacker: null, attackingEmpire: stranger });
            expect(f.diplomaticRelations.byEmpire(stranger)?.type).toBe(DiplomaticRelationType.War);
        }
        const dealer = m.partners.find((p) => m.deals[sidOf(p)] === 'accepted');
        if (dealer !== undefined) {
            scenarioEmit(g, 'builtObjectAttacked', { builtObject: w.base!, attacker: null, attackingEmpire: dealer });
            expect(f.diplomaticRelations.byEmpire(dealer)?.type).toBe(DiplomaticRelationType.War);
            expect(m.partners).not.toContain(dealer);
            expect(m.deals[sidOf(dealer)]).toBeUndefined();
        }
        // Destroying it is no crime and sets the hacked ships free; the drones go silent.
        const alive = m.hacked.filter((h) => !h.ship.hasBeenDestroyed);
        const attacker = stranger ?? offender;
        w.base!.hasBeenDestroyed = true;
        w.attackedBy = { empire: attacker, date: galaxyStarDate(g) };
        expect(resolveBaseLoss(g, w)).toBe(true);
        expect(w.phase).toBe('destroyed');
        expect(warCrimesRecord(g, attacker)?.counts.greatWork ?? 0).toBe(0);
        expect(w.awakened).toBe(false);
        for (const h of alive) expect(h.ship.actualEmpire).toBe(h.from);
        expect(warships(f)).toHaveLength(0);
        expect(m.hacked).toHaveLength(0);
        expect(m.stats.hacksReleased).toBe(alive.length);
    }, 1800000);

    it('the Ultramind: a spared partner that took the deal keeps half the bonus; the deal is a pop-up for a player (declined by default), an AI answers by personality', () => {
        const { g, w } = wonder('ultramind', {}, 'player');
        const m = mindOfSite(g, w)!;
        const p = g.playerEmpire!;
        quiet(m);
        if (!m.partners.includes(p) || m.partners.length < 2) return;
        const offender = m.partners.find((x) => x !== p)!;
        m.standing[sidOf(offender)] = 0;
        awaken(g, m, galaxyStarDate(g));
        expect(m.offenders).toContain(offender);
        expect(m.deals[sidOf(p)]).toBe('pending');
        const d = pendingScenarioDecisions(g, p).find((x) => x.kind === 'gwUltramind.deal')!;
        expect(d.options.map((o) => o.id)).toEqual(['contain', 'decline']);
        expect(d.defaultOption).toBe('decline');
        // Accepting: the bonus continues at half (a holder +50%, a partner +25%), sanctions on the offender.
        expect(answerScenarioDecision(g, d.id, 'contain')).toBe(true);
        expect(m.deals[sidOf(p)]).toBe('accepted');
        expect(m.partners).toContain(p);
        // A partner with a deal is not struck at by its own Smarter AI (the offenders' and the others' are).
        expect(greatWorkKind('ultramind')!.aiAbstains!(g, w, p)).toBe(true);
        expect(greatWorkKind('ultramind')!.aiAbstains!(g, w, offender)).toBe(false);
        const cap = m.partners.reduce((t, x) => t + (m.deals[sidOf(x)] === 'accepted' ? researchPctOf(g, m, x) * 0.5 * researchPerYear(g, x) / 100 : 0), 0);
        const granted = m.stats.researchGranted;
        m.lastTick -= YEAR_LENGTH;
        ultramindPeriodic(g, w);
        expect(m.stats.researchGranted - granted).toBeLessThanOrEqual(cap * 1.001 + 1);
        expect(m.stats.researchGranted).toBeGreaterThan(granted);
        // Declining, or letting it lapse, ends the contract; the player is then not at war with it.
        const { g: g2, w: w2 } = wonder('ultramind', {}, 'player');
        const m2 = mindOfSite(g2, w2)!;
        const p2 = g2.playerEmpire!;
        quiet(m2);
        if (!m2.partners.includes(p2) || m2.partners.length < 2) return;
        m2.standing[sidOf(m2.partners.find((x) => x !== p2)!)] = 0;
        awaken(g2, m2, galaxyStarDate(g2));
        const d2 = pendingScenarioDecisions(g2, p2).find((x) => x.kind === 'gwUltramind.deal')!;
        d2.expiresStarDate = 1;
        expireScenarioDecisions(g2);
        expect(m2.partners).not.toContain(p2);
        expect(m2.withdrawn[sidOf(p2)].why).toBe('declined');
        expect(ultramindState(g2).faction!.diplomaticRelations.byEmpire(p2)?.type).not.toBe(DiplomaticRelationType.War);
    }, 1800000);

    it('the Ultramind: withdrawing (a threat action) ends the bonus and the standing; a withdrawn empire is not at war with it on awakening unless it attacks, and is not drawn again', () => {
        const { g, w } = wonder('ultramind', {}, 'player');
        const m = mindOfSite(g, w)!;
        const p = g.playerEmpire!;
        quiet(m);
        const kinds = (e: Empire) => availableThreatActions(g, e, w.base).map((a) => a.kind);
        expect(kinds(p)).toContain('giantworks.ultramindWithdraw');
        const stranger = actors(g).find((x) => !m.partners.includes(x));
        if (stranger !== undefined) expect(kinds(stranger)).not.toContain('giantworks.ultramindWithdraw');
        expect(runThreatAction(g, p, 'giantworks.ultramindWithdraw', w.base)).toBe(true);
        expect(m.partners).not.toContain(p);
        expect(m.standing[sidOf(p)]).toBeUndefined();
        expect(m.withdrawn[sidOf(p)].why).toBe('withdrew');
        expect(m.stats.withdrawals).toBe(1);
        expect(kinds(p)).not.toContain('giantworks.ultramindWithdraw');
        expect(pickPartners(g, m)).not.toContain(p);
        const granted = m.stats.researchGranted;
        m.lastTick -= YEAR_LENGTH;
        ultramindPeriodic(g, w);
        expect(m.partners).not.toContain(p);
        expect(m.standing[sidOf(p)]).toBeUndefined();
        void granted;
        // It wakes on someone else's account: the withdrawn empire is not a target.
        const victim = m.partners[0];
        if (victim === undefined) return;
        m.standing[sidOf(victim)] = 0;
        awaken(g, m, galaxyStarDate(g));
        const f = ultramindState(g).faction!;
        expect(f.diplomaticRelations.byEmpire(victim)?.type).toBe(DiplomaticRelationType.War);
        expect(f.diplomaticRelations.byEmpire(p)?.type).not.toBe(DiplomaticRelationType.War);
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: w.base!, attacker: null, attackingEmpire: p });
        expect(f.diplomaticRelations.byEmpire(p)?.type).toBe(DiplomaticRelationType.War);
    }, 1800000);

    it('the Ultramind: an AI partner in danger deploys a Logic Bomb (standing 30 or less) and may withdraw (15 or less), by personality; the Logic Bomb cuts the hacking odds', () => {
        const { g, w, e } = wonder('ultramind', {}, 'ai');
        const m = mindOfSite(g, w)!;
        const p = g.playerEmpire!;
        const open = hackOdds(g, m, p, 0);
        expect(open).toBeCloseTo(0.85, 9);
        expect(hackOdds(g, m, p, 6 * g.sectorSize)).toBeLessThan(open);
        expect(hackOdds(g, m, p, 13 * g.sectorSize)).toBe(0);
        expect(availableThreatActions(g, p, w.base).map((a) => a.kind)).not.toContain('giantworks.logicBomb'); // no money, no bomb
        p.stateMoney = 10_000_000;
        expect(availableThreatActions(g, p, w.base).map((a) => a.kind)).toContain('giantworks.logicBomb');
        const cost = bombCost(g, p);
        expect(cost).toBeGreaterThanOrEqual(150000);
        expect(runThreatAction(g, p, 'giantworks.logicBomb', w.base)).toBe(true);
        expect(p.stateMoney).toBeCloseTo(10_000_000 - cost, 3);
        expect(hackOdds(g, m, p, 0)).toBeCloseTo(open * 0.4, 9);
        expect(availableThreatActions(g, p, w.base).map((a) => a.kind)).not.toContain('giantworks.logicBomb'); // once
        expect(deployLogicBomb(g, p, m)).toBe(false);
        expect(hackOdds(g, m, e!, 0)).toBeCloseTo(open, 9); // the others are as exposed as before
        // A restless Ultramind (towards one partner): that AI partner, with the money, prepares by itself; the others do not.
        e!.stateMoney = 10_000_000;
        m.standing[sidOf(e!)] = 20;
        quiet(m);
        m.lastTick -= 100 * GAME_DAY_LENGTH;
        ultramindPeriodic(g, w);
        expect(m.bombs[String(e!.empireId)]).toBeDefined();
        for (const x of m.partners) if (x !== e && x !== g.playerEmpire && m.standing[sidOf(x)] > 30) expect(m.bombs[sidOf(x)]).toBeUndefined();
        // Nearly gone: it withdraws if its character says so (the holder is loath to).
        const s = aiWouldWithdraw(g, m, e!);
        m.standing[sidOf(e!)] = 10;
        m.lastTick -= 10 * GAME_DAY_LENGTH;
        ultramindPeriodic(g, w);
        expect(m.partners.includes(e!)).toBe(!s);
        if (s) expect(m.withdrawn[sidOf(e!)].why).toBe('withdrew');
    }, 900000);

    it('the Ultramind: the Diet motion to sanction the empire upsetting it (target the lowest partner at or below 35); a passed motion ends its contract for good', () => {
        const { g, w, e } = wonder('ultramind', {}, 'ai');
        const m = mindOfSite(g, w)!;
        quiet(m);
        const def = dietMotionKindDef(MOTION_SANCTION)!;
        expect(def.needs).toBe('empire');
        expect(def.proposable!(g)).toBe(false); // the Diet is not running in this test game, and nobody is upset
        expect(sanctionTarget(g)).toBeNull();
        m.standing[sidOf(e!)] = 10;
        expect(sanctionTarget(g)?.empire).toBe(e);
        m.standing[sidOf(e!)] = 40;
        for (const x of m.partners) m.standing[sidOf(x)] = Math.max(40, m.standing[sidOf(x)]);
        expect(sanctionTarget(g)).toBeNull();
        m.standing[sidOf(e!)] = 10;
        const motion = { id: 1, kind: MOTION_SANCTION, proposer: m.partners[1] ?? e!, target: e!, other: null, colony: null, resourceId: -1, text: '', votes: [], status: 'voting', yes: 0, no: 0 } as DietMotion;
        expect(def.voteScore(g, {} as DietState, e!, motion)).toBe(-100);
        const voters = m.partners.filter((x) => x !== e);
        for (const v of voters) if (v !== motion.proposer) expect(def.voteScore(g, {} as DietState, v, motion)).toBeGreaterThan(0);
        const innocent = { ...motion, target: voters[0] ?? null } as DietMotion;
        if (voters.length > 0) expect(def.voteScore(g, {} as DietState, e!, { ...innocent, proposer: e! })).toBe(100);
        // Passed: the contract is over, and it cannot be taken up again.
        def.apply(g, {} as DietState, motion, (() => ({})) as never);
        expect(m.partners).not.toContain(e);
        expect(m.withdrawn[sidOf(e!)].why).toBe('sanctioned');
        expect(m.stats.sanctions).toBe(1);
        expect(pickPartners(g, m)).not.toContain(e);
        // Without the offender the others are safe: the lowest standing is now someone else's.
        expect(m.contentment).toBeGreaterThan(40);
    }, 900000);

    it('the Ultramind: directives (the holder sets one; switching takes 60 days with none working; partners get half; its name shows it; threat actions mark the current one)', () => {
        const { g, w, e } = wonder('ultramind', {}, 'ai');
        const m = mindOfSite(g, w)!;
        quiet(m);
        const now = galaxyStarDate(g);
        expect(dirNow(m, now)).toBe('research');
        const view = directiveView(g, w.base, e!)!;
        expect(view.canChange).toBe(true);
        expect(view.options.map((o) => o.state)).toEqual(['current', 'choice', 'choice', 'choice']);
        expect(directiveView(g, w.base, null)!.canChange).toBe(false);
        const other = m.partners.find((x) => x !== e);
        if (other !== undefined) {
            expect(directiveView(g, w.base, other)!.canChange).toBe(false);
            expect(setDirective(g, m, other, 'war')).toBe(false); // only the holder
        }
        expect(setDirective(g, m, e!, 'research')).toBe(false); // it is the current one
        expect(setDirective(g, m, e!, 'war')).toBe(true);
        expect(m.switchTo).toBe('war');
        expect(setDirective(g, m, e!, 'war')).toBe(false);
        expect(dirNow(m, now + 30 * GAME_DAY_LENGTH)).toBeNull();
        expect(directiveEffect(g, e!)).toBeNull(); // nothing works while it is being switched
        expect(w.base!.name).toBe('The Ultramind (content, switching to War)');
        expect(directiveView(g, w.base, e!)!.daysLeft).toBe(60);
        expect(directiveView(g, w.base, e!)!.options.map((o) => o.state)).toEqual(['choice', 'switching', 'choice', 'choice']);
        expect(dirNow(m, now + 61 * GAME_DAY_LENGTH)).toBe('war');
        m.switchUntil = now - 1;
        m.lastTick -= 10 * GAME_DAY_LENGTH;
        ultramindPeriodic(g, w);
        expect(m.directive).toBe('war');
        expect(m.switchTo).toBeNull();
        expect(w.base!.name).toBe('The Ultramind (content, War)');
        expect(directiveEffect(g, e!)).toMatchObject({ dir: 'war', k: 1 });
        if (other !== undefined) expect(directiveEffect(g, other)).toMatchObject({ dir: 'war', k: 0.5 });
        const stranger = actors(g).find((x) => !m.partners.includes(x));
        if (stranger !== undefined) expect(directiveEffect(g, stranger)).toBeNull();
        // The order menu: one action per directive, the current one marked, for the holder only.
        const labels = (who: Empire) => availableThreatActions(g, who, w.base).filter((a) => a.kind.startsWith('giantworks.umDirective')).map((a) => a.label);
        expect(labels(e!)).toEqual(['Directive: Research', 'Directive: War (current)', 'Directive: Economy', 'Directive: Intelligence']);
        if (other !== undefined) expect(labels(other)).toEqual([]);
        expect(runThreatAction(g, e!, 'giantworks.umDirective.2.economy.set', w.base)).toBe(true);
        expect(runThreatAction(g, e!, 'giantworks.umDirective.1.war.current', w.base)).toBe(false);
        expect(labels(e!)).toEqual(['Directive: Research', 'Directive: War', 'Directive: Economy (switching)', 'Directive: Intelligence']);
        // The selection panel's buttons go through the 'threatAction' player command (multiplayer- and replay-safe): the holder's works, others' is refused.
        m.switchTo = null;
        m.directive = 'research';
        runPlayerCommand(g, e!, 'threatAction', ['giantworks.umDirective.3.intelligence.set', w.base!]);
        expect(m.switchTo).toBe('intelligence');
        if (other !== undefined) {
            runPlayerCommand(g, other, 'threatAction', ['giantworks.umDirective.1.war.set', w.base!]);
            expect(m.switchTo).toBe('intelligence');
        }
        m.switchTo = null;
        // The right-click order menu lists them for the holder (a ShipAction on the base) and the same action runs through the 'shipAction' command.
        const menu = buildActionMenu({ galaxy: g, empire: e!, selected: w.base!, cursorX: 0, cursorY: 0, zoomFactor: 1, pickAt: () => null }).map((i) => i.label);
        expect(menu.some((t) => t.startsWith('Directive: Economy'))).toBe(true);
        const act = createShipAction(ShipActionType.ScenarioThreatAction, w.base!);
        act.extraData = 'giantworks.umDirective.2.economy.set';
        runPlayerCommand(g, e!, 'shipAction', [w.base!, act, false, undefined]);
        expect(m.switchTo).toBe('economy');
        m.switchTo = null;
        // The AI holder reviews by situation: a war raises War and lowers Research.
        const s0 = aiDirectiveScores(g, m, e!);
        const foe = actors(g).find((x) => x !== e)!;
        declareWar(g, e!, foe, null, false);
        const s1 = aiDirectiveScores(g, m, e!);
        expect(s1.war - s0.war).toBeCloseTo(0.9, 9);
        expect(s1.research - s0.research).toBeCloseTo(-0.3, 9);
    }, 900000);

    it('the Ultramind: the Research directive completes a project outright now and then; War gives battle bonuses and early warning; Economy gives income, building, price and upkeep; Intelligence tells of hidden threats, catches spies and reads rivals for free', () => {
        const { g, w, e } = wonder('ultramind', {}, 'ai');
        const m = mindOfSite(g, w)!;
        quiet(m);
        const star = siteOf(w);
        const other = m.partners.find((x) => x !== e);
        const now0 = galaxyStarDate(g);
        // Research: a breakthrough when the clock says so.
        m.nextBreak[sidOf(e!)] = now0 - 1;
        m.lastTick -= 10 * GAME_DAY_LENGTH;
        ultramindPeriodic(g, w);
        expect(m.stats.breakthroughs).toBeGreaterThanOrEqual(1);
        expect(m.stats.breakthroughPoints).toBeGreaterThan(0);
        expect(m.nextBreak[sidOf(e!)]).toBeGreaterThan(now0);
        // War.
        m.directive = 'war';
        const mine = warships(e!)[0];
        mine.xpos = star.xpos + 500;
        mine.ypos = star.ypos;
        expect(scenarioQuery(g, 'captainBonuses', captain(), { builtObject: mine, empire: e! })).toMatchObject({ targeting: 125, countermeasures: 125, repair: 100 });
        mine.xpos = star.xpos + 20 * g.sectorSize;
        expect(scenarioQuery(g, 'captainBonuses', captain(), { builtObject: mine, empire: e! }).targeting).toBe(100); // out of range
        if (other !== undefined) {
            const theirs = warships(other)[0];
            theirs.xpos = star.xpos;
            theirs.ypos = star.ypos + 300;
            expect(scenarioQuery(g, 'captainBonuses', captain(), { builtObject: theirs, empire: other }).targeting).toBeCloseTo(112.5, 9);
        }
        const foe = actors(g).find((x) => x !== e && x !== other) ?? actors(g).find((x) => x !== e)!;
        declareWar(g, e!, foe, null, false);
        const raider = warships(foe)[0];
        raider.xpos = star.xpos + 3 * g.sectorSize;
        raider.ypos = star.ypos;
        expect(scenarioQuery(g, 'objectVisibleToAll', false, { empire: e!, object: raider })).toBe(true);
        raider.xpos = star.xpos + 60 * g.sectorSize;
        expect(scenarioQuery(g, 'objectVisibleToAll', false, { empire: e!, object: raider })).toBe(false);
        raider.xpos = star.xpos + 3 * g.sectorSize;
        m.directive = 'research';
        expect(scenarioQuery(g, 'objectVisibleToAll', false, { empire: e!, object: raider })).toBe(false);
        // Economy.
        m.directive = 'economy';
        const hab = e!.capital as Habitat;
        expect(scenarioQuery(g, 'designPriceFactor', 1, { empire: e! })).toBeCloseTo(0.92, 9);
        expect(scenarioQuery(g, 'colonyTaxRevenue', 100, { habitat: hab, empire: e! })).toBeCloseTo(108, 9);
        expect(scenarioQuery(g, 'colonyConstructionFactor', 1, { habitat: hab, kind: 'yard' })).toBeCloseTo(1.15, 9);
        expect(scenarioQuery(g, 'shipMaintenanceFactor', 1, { builtObject: mine })).toBeCloseTo(0.92, 9);
        const port = { xpos: star.xpos, ypos: star.ypos, actualEmpire: e, empire: e } as unknown as BuiltObject;
        expect(scenarioQuery(g, 'portTradeIncomeFactor', 1, { port, amount: 100 })).toBeCloseTo(1.1, 9);
        if (other !== undefined) expect(scenarioQuery(g, 'designPriceFactor', 1, { empire: other })).toBeCloseTo(0.96, 9);
        const outsider = actors(g).find((x) => !m.partners.includes(x));
        if (outsider !== undefined) expect(scenarioQuery(g, 'designPriceFactor', 1, { empire: outsider })).toBe(1);
        m.directive = 'research';
        expect(scenarioQuery(g, 'designPriceFactor', 1, { empire: e! })).toBe(1);
        // Intelligence: a stronger counter-intelligence share, hidden threats named, a free map, a spy caught.
        m.directive = 'intelligence';
        expect(scenarioQuery(g, 'counterIntelligenceProportion', 0.5, { empire: e! })).toBeCloseTo(0.8, 9);
        if (other !== undefined) expect(scenarioQuery(g, 'counterIntelligenceProportion', 0.5, { empire: other })).toBeCloseTo(0.65, 9);
        const node = { habitat: e!.capital as Habitat, knowledge: [] as { empireId: number; level: number; date: number }[] };
        threatState(g, HIVE_KEY, () => ({ nodes: [node], absorbed: [], faction: null }));
        expect(detectThreats(g, m, e!, 0)).toBe(1);
        expect(node.knowledge).toEqual([expect.objectContaining({ empireId: e!.empireId, level: KNOWLEDGE_CONFIRMED })]);
        expect(detectThreats(g, m, e!, 0)).toBe(0); // already told
        expect(freeIntelOn(g, m, e!)).not.toBeNull();
        expect(m.stats.freeIntel).toBe(1);
        const spyOwner = actors(g).find((x) => x !== e)!;
        const agent = getEmpireCharacters(spyOwner).find((c) => c.active && c.role === CharacterRole.IntelligenceAgent);
        if (agent !== undefined) {
            agent.mission = newIntelligenceMissionAgainstEmpire(spyOwner, agent, IntelligenceMissionType.StealTerritoryMap, galaxyStarDate(g), e!);
            expect(catchSpy(g, m, e!)).toBe(spyOwner);
            expect(agent.active).toBe(false);
            expect(m.stats.spiesCaught).toBe(1);
        } else expect(catchSpy(g, m, e!)).toBeNull();
        // The periodic round does all three on its clock.
        m.nextIntel[sidOf(e!)] = galaxyStarDate(g) - 1;
        const before = { ...m.stats };
        m.lastTick -= 10 * GAME_DAY_LENGTH;
        ultramindPeriodic(g, w);
        expect(m.nextIntel[sidOf(e!)]).toBeGreaterThan(galaxyStarDate(g));
        void before;
    }, 900000);

    it('the Ultramind: boarded while awake it falls back to a sullen calm under its captor (everyone starts afresh), the hacked ships free; boarded while content only the boarder pays', () => {
        const { g, w, e } = wonder('ultramind', { ultramindHackPct: 100 }, 'ai');
        const m = mindOfSite(g, w)!;
        const star = siteOf(w);
        gather(m, star, m.partners);
        m.standing[sidOf(e!)] = 0;
        awaken(g, m, galaxyStarDate(g));
        const f = ultramindState(g).faction!;
        expect(m.awakened).toBe(true);
        expect(m.hacked.length).toBeGreaterThan(0);
        const hacked = m.hacked.map((h) => h);
        const captor = actors(g).find((x) => x !== f && x !== e)!;
        takeOwnershipOfBuiltObject(g, f, w.base!, captor, false, true);
        expect(w.holder).toBe(captor);
        expect(m.awakened).toBe(false);
        expect(w.awakened).toBe(false);
        expect(greatWorkIsHostile(w)).toBe(false);
        expect(m.contentment).toBe(30);
        expect(m.offenders).toHaveLength(0);
        expect(Object.keys(m.withdrawn)).toHaveLength(0);
        expect(warCrimesRecord(g, captor)?.counts.greatWork ?? 0).toBe(0);
        for (const h of hacked) if (!h.ship.hasBeenDestroyed) expect(h.ship.actualEmpire).toBe(h.from);
        expect(w.base!.name).toBe('The Ultramind (restless, Research)');
        // The new contracts start at 30 for everyone.
        m.lastTick -= 10 * GAME_DAY_LENGTH;
        quiet(m);
        ultramindPeriodic(g, w);
        for (const p of m.partners) expect(m.standing[sidOf(p)]).toBeCloseTo(30, 0);
        // Content, then seized: the boarder pays when it joins the contracts, the others nothing.
        const { g: g2, w: w2, e: e2 } = wonder('ultramind', {}, 'ai');
        const m2 = mindOfSite(g2, w2)!;
        const boarder = actors(g2).find((x) => x !== e2)!;
        takeOwnershipOfBuiltObject(g2, compactFaction(g2)!, w2.base!, boarder, false, true);
        expect(m2.awakened).toBe(false);
        m2.lastTick -= 10 * GAME_DAY_LENGTH;
        quiet(m2);
        ultramindPeriodic(g2, w2);
        expect(m2.holder).toBe(boarder);
        expect(m2.standing[sidOf(boarder)]).toBeCloseTo(45, 0);
        for (const p of m2.partners) if (p !== boarder) expect(m2.standing[sidOf(p)]).toBeGreaterThan(55);
    }, 1800000);

    it('the Ultramind: save and load keep the contracts, the standings, the directive, the withdrawn, the deals, the awakened faction and the hacked ships', () => {
        const { g, w, game, gameData } = wonder('ultramind', { ultramindHackPct: 100 }, 'ai');
        const m = mindOfSite(g, w)!;
        const star = siteOf(w);
        for (const x of m.partners) warships(x).slice(0, 2).forEach((b) => { b.xpos = star.xpos; b.ypos = star.ypos + 300; });
        m.bombs[String(m.partners[0].empireId)] = 5;
        m.exposedUntil[String(m.partners[0].empireId)] = galaxyStarDate(g) + YEAR_LENGTH;
        m.directive = 'intelligence';
        m.switchTo = 'war';
        m.switchUntil = galaxyStarDate(g) + 30 * GAME_DAY_LENGTH;
        m.standing[sidOf(m.partners[0])] = 0;
        awaken(g, m, galaxyStarDate(g));
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const lg = deserializeGame(text, gameData).game.galaxy;
        const lm = peekUltramindState(lg)!.minds[0];
        expect(lm.site).toBe(greatWorks(lg)[0]);
        expect(lm.awakened).toBe(true);
        expect(lm.partners.map((x) => x.empireId)).toEqual(m.partners.map((x) => x.empireId));
        expect(lm.offenders.map((x) => x.empireId)).toEqual(m.offenders.map((x) => x.empireId));
        expect(lm.holder?.empireId).toBe(m.holder?.empireId);
        expect(lm.standing).toEqual(m.standing);
        expect(lm.deals).toEqual(m.deals);
        expect(lm.withdrawn).toEqual(m.withdrawn);
        expect(lm.directive).toBe('intelligence');
        expect(lm.switchTo).toBe('war');
        expect(lm.switchUntil).toBe(m.switchUntil);
        expect(lm.lost).toEqual(m.lost);
        expect(lm.hacked.map((h) => h.ship.builtObjectID)).toEqual(m.hacked.map((h) => h.ship.builtObjectID));
        expect(lm.hacked.every((h) => h.ship.actualEmpire === peekUltramindState(lg)!.faction)).toBe(true);
        expect(peekUltramindState(lg)!.faction!.empireId).toBe(ultramindState(g).faction!.empireId);
        expect(lm.bombs).toEqual(m.bombs);
        expect(lm.exposedUntil).toEqual(m.exposedUntil);
        expect(lm.portsUntil).toBe(m.portsUntil);
        expect(greatWorks(lg)[0].awakened).toBe(true);
    }, 1800000);

    it('the Sanctuary: resort income through the shares, a growth bonus for the beneficiary within three sectors, a research trickle, whales that breed', () => {
        const { g, w, e } = wonder('sanctuary', { sanctuaryBreachPctPerYear: 0 }, 'ai');
        const s = sanctumOfSite(g, w)!;
        expect(w.whales).toBe(4);
        expect(w.base!.name).toBe('The Leviathan Sanctuary (4 whales)');
        expect(greatWorkIsHostile(w)).toBe(false);
        const money = e!.stateMoney;
        const resort = thisYearsResortIncome(g, e!);
        s.lastTick -= YEAR_LENGTH;
        sanctuaryPeriodic(g, w);
        expect(e!.stateMoney - money).toBeCloseTo(1_000_000, 0); // the holder takes it all
        expect(thisYearsResortIncome(g, e!) - resort).toBeCloseTo(1_000_000, 0);
        expect(s.stats.income).toBeCloseTo(1_000_000, 0);
        expect(s.stats.research).toBeGreaterThan(0);
        expect(w.whales).toBe(4); // half a whale born
        s.lastTick -= 2 * YEAR_LENGTH;
        sanctuaryPeriodic(g, w);
        expect(w.whales).toBe(5);
        expect(w.base!.name).toBe('The Leviathan Sanctuary (5 whales)');
        s.lastTick -= 20 * YEAR_LENGTH;
        sanctuaryPeriodic(g, w);
        expect(w.whales).toBe(7); // no more than seven
        // Whale-song therapy: the beneficiary's colonies within three sectors only.
        const star = siteOf(w);
        const other = actors(g).find((x) => x !== e)!;
        expect(growthBonusAt(g, star.xpos + 2 * g.sectorSize, star.ypos, e)).toBe(25);
        expect(growthBonusAt(g, star.xpos + 4 * g.sectorSize, star.ypos, e)).toBe(0);
        expect(growthBonusAt(g, star.xpos, star.ypos, other)).toBe(0);
        const colony = { xpos: star.xpos + g.sectorSize, ypos: star.ypos, empire: e } as unknown as Habitat;
        expect(scenarioQuery(g, 'colonyWonderBonus', 0, { habitat: colony, wonderType: WonderType.ColonyPopulationGrowth })).toBe(25);
        expect(scenarioQuery(g, 'colonyWonderBonus', 0, { habitat: colony, wonderType: WonderType.ColonyIncome })).toBe(0);
        // Nobody's territory and no holder: the Compact keeps the lot, and nobody is helped.
        const { g: g2, w: w2 } = wonder('sanctuary', { sanctuaryBreachPctPerYear: 0 }, null);
        const c = compactFaction(g2)!;
        const cm = c.stateMoney;
        const s2 = sanctumOfSite(g2, w2)!;
        s2.lastTick -= YEAR_LENGTH;
        sanctuaryPeriodic(g2, w2);
        expect(c.stateMoney - cm).toBeCloseTo(1_000_000, 0);
        expect(growthBonusAt(g2, siteOf(w2).xpos, siteOf(w2).ypos, actors(g2)[0])).toBe(0);
    }, 1800000);

    it('the Sanctuary: stress from shots, nearby fighting and sabotage raises the chance of a breach, and fades', () => {
        const { g, w, e } = wonder('sanctuary', {}, 'ai');
        const s = sanctumOfSite(g, w)!;
        const star = siteOf(w);
        expect(breachChancePerYear(g, s)).toBeCloseTo(0.02, 9);
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: w.base!, attacker: null, attackingEmpire: e });
        expect(s.stress).toBe(5);
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: w.base!, attacker: null, attackingEmpire: e });
        expect(s.stress).toBe(5); // at most once a day for the small knocks
        const bystander = { xpos: star.xpos + 60000, ypos: star.ypos, builtObjectID: -5 } as unknown as BuiltObject;
        const far = { xpos: star.xpos + 300000, ypos: star.ypos, builtObjectID: -6 } as unknown as BuiltObject;
        s.lastStressHit = -1;
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: far, attacker: null, attackingEmpire: e });
        expect(s.stress).toBe(5);
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: bystander, attacker: null, attackingEmpire: e });
        expect(s.stress).toBeCloseTo(6.5, 9);
        const sab = newIntelligenceMissionAgainstBuiltObject(e!, null, IntelligenceMissionType.SabotageConstruction, galaxyStarDate(g), w.base!);
        scenarioEmit(g, 'intelMissionCompleted', { empire: e!, mission: sab, outcome: null });
        expect(s.stress).toBeCloseTo(36.5, 9);
        expect(breachChancePerYear(g, s)).toBeGreaterThan(0.3);
        s.lastTick -= 60 * GAME_DAY_LENGTH;
        const before = s.stress;
        addStress(g, s, 0, true);
        s.stats.stressPeak = before;
        // Sixty days later (the periodic step decays it): about half.
        const p0 = g.scenario!.params.sanctuaryBreachPctPerYear;
        g.scenario!.params.sanctuaryBreachPctPerYear = 0;
        g.scenario!.params.sanctuaryStressPctPerYear = 0;
        sanctuaryPeriodic(g, w);
        g.scenario!.params.sanctuaryBreachPctPerYear = p0;
        expect(s.stress).toBeCloseTo(before / 2, 0);
    }, 900000);

    it('the Sanctuary: a breach lets out the Leviathan once and 3 to 6 enraged whales, stops every bonus for a year at the owner\'s cost, then is repaired', () => {
        const { g, w, e } = wonder('sanctuary', { sanctuaryBreachPctPerYear: 0, sanctuaryStressPctPerYear: 0 }, 'ai');
        const s = sanctumOfSite(g, w)!;
        s.whales = 6.2;
        w.whales = 6;
        const now = galaxyStarDate(g);
        expect(scenarioFlag(g, 'threatVoidWhale')).toBe(false);
        const creatures = g.creatures.length;
        breachSanctuary(g, s, now);
        expect(s.breached).toBe(true);
        expect(s.breaches).toBe(1);
        expect(w.base!.name).toBe('The Leviathan Sanctuary (breached)');
        expect(w.breached).toBe(true); // the art cracks the glass
        // Scaled to the navies of the day: at least a plain whale, at most six times it.
        const scale = unleashedScale(g);
        expect(scale).toBeGreaterThanOrEqual(1);
        expect(scale).toBeLessThanOrEqual(6);
        for (const a of s.angry) {
            expect(a.scale).toBe(scale);
            expect(a.creature.attackStrength).toBeGreaterThanOrEqual(Math.trunc((a.creature.size / 12) * scale));
        }
        expect(s.angry.length).toBeGreaterThanOrEqual(3);
        expect(s.angry.length).toBeLessThanOrEqual(6);
        const target = rageTarget(g, s);
        for (const a of s.angry) expect(a.dest !== null).toBe(target !== null);
        if (target !== null) for (const a of s.angry) expect(a.creature.hyperSpeed).toBeGreaterThan(0);
        expect(g.creatures.length).toBe(creatures + s.angry.length + 1); // the whales and the Leviathan
        for (const a of s.angry) {
            expect(g.creatures).toContain(a.creature);
            expect(a.creature.attackStrength).toBeGreaterThan(0);
            expect(a.creature.attackRange).toBe(6000);
        }
        expect(s.whales).toBeCloseTo(Math.max(1, 6.2 - s.angry.length), 9);
        expect(w.whales).toBe(Math.floor(s.whales));
        // The Leviathan: the Void Whale threat is switched on and the beast wakes at the sphere.
        expect(scenarioFlag(g, 'threatVoidWhale')).toBe(true);
        expect(s.leviathanReleased).toBe(true);
        const lev = voidWhaleState(g);
        expect(lev.phase).toBe('active');
        expect(lev.creature!.name).toBe('The Leviathan');
        expect(lev.strengthMul).toBe(scale);
        expect(lev.creature!.attackStrength).toBe(Math.trunc((lev.creature!.size / 14) * scale));
        expect(g.calculateDistance(lev.creature!.xpos, lev.creature!.ypos, siteOf(w).xpos, siteOf(w).ypos)).toBeLessThan(30000);
        // The raging whales hunt ships, but leave the sphere and the Compact alone.
        const raging = s.angry[0].creature;
        const ship = { xpos: raging.xpos, ypos: raging.ypos, actualEmpire: e } as unknown as BuiltObject;
        expect(scenarioQuery(g, 'creatureIgnoresTarget', true, { creature: raging, target: ship })).toBe(false);
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: raging, target: w.base })).toBe(true);
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: raging, target: { actualEmpire: compactFaction(g) } })).toBe(true);
        // No income, no growth bonus, and the owner pays for the repairs by the month.
        const star = siteOf(w);
        expect(growthBonusAt(g, star.xpos, star.ypos, e)).toBe(0);
        const money = e!.stateMoney;
        s.lastTick -= 0.5 * YEAR_LENGTH;
        sanctuaryPeriodic(g, w);
        expect(e!.stateMoney - money).toBeCloseTo(-500_000, 0);
        expect(s.stats.income).toBe(0);
        expect(s.breached).toBe(true);
        // The rage ends: plain creatures turn harmless.
        for (const a of s.angry) a.until = 0;
        const raged = s.angry.map((a) => a.creature);
        rageStep(g);
        expect(s.angry).toHaveLength(0);
        for (const c of raged) expect(c.attackStrength).toBe(0);
        // A year on the sphere is whole again, with its few whales, and pays again.
        s.repairUntil = galaxyStarDate(g) - 1;
        s.lastTick -= YEAR_LENGTH;
        sanctuaryPeriodic(g, w);
        expect(s.breached).toBe(false);
        expect(w.breached).toBe(false);
        expect(w.base!.name).toMatch(/^The Leviathan Sanctuary \(\d whales\)$/);
        expect(growthBonusAt(g, star.xpos, star.ypos, e)).toBe(25);
        s.lastTick -= YEAR_LENGTH;
        const before = e!.stateMoney;
        sanctuaryPeriodic(g, w);
        expect(e!.stateMoney - before).toBeCloseTo(1_000_000, 0);
        // A second breach lets out whales again but not a second Leviathan.
        breachSanctuary(g, s, galaxyStarDate(g));
        expect(s.breaches).toBe(2);
        expect(s.angry.length).toBeGreaterThanOrEqual(3);
        expect(voidWhaleState(g).creature).toBe(lev.creature);
    }, 1800000);

    it('the Sanctuary: unleashed whales grow with the navies of the galaxy (square root of the top three over the reference, 1 to 6)', () => {
        const { g, e } = wonder('sanctuary', { sanctuaryBreachPctPerYear: 0 }, 'ai');
        expect(e).not.toBeNull();
        const top = actors(g).map((x) => militaryPotency(x)).sort((a, b) => b - a).slice(0, 3);
        const mean = top.reduce((a, b) => a + b, 0) / top.length;
        expect(unleashedScale(g)).toBeCloseTo(Math.min(6, Math.max(1, Math.sqrt(mean / 600))), 9);
        g.scenario!.params.sanctuaryRageRefPotency = 1;
        expect(unleashedScale(g)).toBe(6); // a mature galaxy: capped
        g.scenario!.params.sanctuaryRageRefPotency = 1e12;
        expect(unleashedScale(g)).toBe(1); // a young one: a plain whale
    }, 900000);

    it('the Sanctuary: destroying it is the crime it always was, and the glass it held lets the whales and the Leviathan out', () => {
        const { g, w, e } = wonder('sanctuary', { sanctuaryBreachPctPerYear: 0 }, 'ai');
        const s = sanctumOfSite(g, w)!;
        const attacker = actors(g).find((x) => x !== e)!;
        w.base!.hasBeenDestroyed = true;
        w.attackedBy = { empire: attacker, date: galaxyStarDate(g) };
        expect(resolveBaseLoss(g, w)).toBe(true);
        expect(w.phase).toBe('destroyed');
        expect(warCrimesRecord(g, attacker)?.counts.greatWork).toBe(1); // peaceful: not exempt
        expect(s.angry.length).toBeGreaterThanOrEqual(3);
        expect(s.leviathanReleased).toBe(true);
        expect(voidWhaleState(g).phase).toBe('active');
        expect(s.whales).toBe(0);
        expect(w.whales).toBe(0);
        expect(s.breached).toBe(false); // nothing left to repair
    }, 900000);

    it('the Sanctuary: with New Fauna on, the escaped whales are its void whales (a herd, enraged for a while); save and load keep a breached sanctuary', () => {
        const { g, w, game, gameData } = wonder('sanctuary', { sanctuaryBreachPctPerYear: 0, sanctuaryStressPctPerYear: 0 }, 'ai', [...ids, 'new-fauna'], { newFauna: true });
        const s = sanctumOfSite(g, w)!;
        expect(scenarioFlag(g, 'newFauna')).toBe(true);
        const herds = peekRimFaunaState(g)!.herds.length;
        breachSanctuary(g, s, galaxyStarDate(g));
        expect(peekRimFaunaState(g)!.herds.length).toBe(herds + 1);
        expect(s.angry.length).toBeGreaterThanOrEqual(3);
        for (const a of s.angry) expect(faunaVariantOfCreature(g, a.creature)?.variant).toBe(FaunaVariant.VoidWhale);
        // They head for the nearest colony of the owner's (else anyone's), by the herd migration.
        const target = rageTarget(g, s);
        const herd = peekRimFaunaState(g)!.herds[herds];
        if (target !== null) {
            expect(target.systemIndex).not.toBe(siteOf(w).systemIndex);
            expect(herd.migration?.toSystemIndex).toBe(target.systemIndex);
            expect(s.angry.every((a) => a.creature.hyperSpeed > 0)).toBe(true);
        }
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const lg = deserializeGame(text, gameData).game.galaxy;
        const ls = sanctumOfSite(lg, greatWorks(lg)[0])!;
        expect(ls.breached).toBe(true);
        expect(ls.angry.map((a) => a.creature.creatureId)).toEqual(s.angry.map((a) => a.creature.creatureId));
        expect(ls.leviathanReleased).toBe(s.leviathanReleased);
        expect(ls.repairUntil).toBe(s.repairUntil);
        expect(greatWorks(lg)[0].whales).toBe(w.whales);
    }, 1800000);

    // ---------------------------------------------------------------------------------------------------------------
    // The Ark Engine (giantworks/ark.ts)
    // ---------------------------------------------------------------------------------------------------------------

    /** A finished Ark at the site (the Great Work forced to be the Ark). */
    function arkOpen(params: Record<string, number> = {}): { g: Galaxy; w: GreatWorkRecord; rec: ArkRec; ark: BuiltObject; old: BuiltObject; game: Game; gameData: GameData } {
        const { g, w, game, gameData } = building(params, { gwArk: true }, 'ark');
        const old = w.base!;
        addProgress(g, w, 2);
        expect(w.phase).toBe('complete');
        const rec = arkRecOf(g, w.id)!;
        return { g, w, rec, ark: rec.ship!, old, game, gameData };
    }
    /** Gives the first colony of each of `only` (default: every ordinary empire) 400 million people of a foreign race and makes those the only former independents on record. */
    function arkSeed(g: Galaxy, only: Empire[] = actors(g)): void {
        const st = peekArkState(g)!;
        st.origins = [];
        for (const e of only) {
            const h = e.colonies.find((c) => c.empire === e && !c.hasBeenDestroyed)!;
            const race = g.races.find((r) => r !== null && r.name !== e.dominantRace?.name)!;
            h.population.add(new Population(race, 400_000_000, g));
            h.population.recalculateTotalAmount();
            st.origins.push({ habitat: h, races: [race.name] });
        }
    }
    /** The Ark sets out and arrives at the colony it picked (the owner's answer given); returns the target. */
    function arkAtColony(a: { g: Galaxy; rec: ArkRec; ark: BuiltObject }, answer = 'accommodate'): ArkTarget {
        const { g, rec, ark } = a;
        rec.waitUntil = 0;
        arkPeriodic(g);
        expect(rec.phase).toBe('roaming');
        const t = rec.target!;
        ark.xpos = t.parkX;
        ark.ypos = t.parkY;
        arkPeriodic(g);
        expect(rec.phase).toBe('siphoning');
        if (t.decision === 'pending') expect(answerScenarioDecision(g, t.decisionId, answer)).toBe(true);
        expect(t.startedAt).toBeGreaterThanOrEqual(0);
        return t;
    }
    const attack = (g: Galaxy, a: { ark: BuiltObject }, e: Empire): void => scenarioEmit(g, 'builtObjectAttacked', { builtObject: a.ark, attacker: e.builtObjects[0] ?? a.ark, attackingEmpire: e });
    const arkEval = (g: Galaxy, a: Empire, b: Empire): number => obtainEmpireEvaluation(g, a, b).incidentEvaluation;

    it('ark: registered with the general hint first, a lore guess, its texts and parameters, and a Game Editor entry', () => {
        const kind = greatWorkKind('ark')!;
        expect(kind.flag).toBe('gwArk');
        expect(kind.hintTags).toEqual(['slag', 'stasis', 'engines']);
        expect(KIND_MENACE.ark).toBeGreaterThan(0);
        expect(KIND_VALUE.ark).toBeGreaterThan(0);
        const g = gw({ gwArk: true });
        for (const tag of ['Giantworks Kind ark', 'Giantworks Complete ark', 'Giantworks Hint slag', 'Giantworks Ark Decision', 'Giantworks Ark Fight News', 'Giantworks Ark Broken News', 'Giantworks Ark Destroyed News', 'Reputation Cause giantworks.arkTransport']) expect(tryGetText(tag)).not.toBeNull();
        expect(spawnableThreats(g).some((t) => t.key === 'giantworks:ark')).toBe(true);
        expect(arkParam(g, 'gwArkShields')).toBe(30000);
        expect(arkParam(g, 'gwArkEscapeSectors')).toBe(2);
    }, 900000);

    it('ark: the record of former independents (and their species) is taken at game start, only with the flag on; add-on off leaves no Ark state', () => {
        const on = gw({ gwArk: true });
        const st = peekArkState(on)!;
        expect(st.tracked).toBe(true);
        expect(st.origins.length).toBeGreaterThan(0);
        for (const o of st.origins) expect(o.races.length).toBeGreaterThan(0);
        for (const h of on.independentColonies) if (!h.hasBeenDestroyed && h.population.totalAmount > 0) expect(st.origins.some((o) => o.habitat === h)).toBe(true);
        expect(peekArkState(gw({ gwArk: false }))).toBeNull();
        expect(peekArkState(gw({ threatGiantworks: false }))).toBeNull();
        // A Game Editor spawn in a game without the record guesses (the independents now, colonies holding a people no empire has).
        const late = gw({ gwArk: false }, { giantworksExistChancePct: 0 });
        expect(spawnGreatWork(late, 'ark')).toBe(true);
        expect(peekArkState(late)!.tracked).toBe(false);
        for (const o of peekArkState(late)!.origins) expect(o.races.length).toBeGreaterThan(0);
    }, 1800000);

    it('ark: the finished scaffold becomes a slow, heavily shielded Compact ship that is the Great Work\'s base', () => {
        const { g, w, rec, ark, old } = arkOpen();
        expect(w.base).toBe(ark);
        expect(old.hasBeenDestroyed).toBe(true);
        expect(ark.actualEmpire).toBe(compactFaction(g));
        expect(w.guards).toHaveLength(0);
        expect(ark.shieldsCapacity).toBeGreaterThan(27000);
        expect(ark.shieldsCapacity).toBeLessThan(36000);
        expect(ark.currentShields).toBe(ark.shieldsCapacity);
        expect(ark.armor).toBeGreaterThan(20000); // a short: it must not wrap negative
        expect(ark.firepowerRaw).toBeGreaterThan(0);
        expect(warpSpeedWithBonuses(ark)).toBeLessThanOrEqual(Math.trunc(ark.warpSpeed * 0.51)); // slow
        expect(warpSpeedWithBonuses(ark)).toBeGreaterThan(0);
        expect(rec.phase).toBe('idle');
        expect(rec.waitUntil).toBeGreaterThan(galaxyStarDate(g));
        expect(arkLooks(g).ships).toEqual([ark]);
        expect(arkLooks(g).key).toBe('ark');
        // The framework treats it as the work's base: destroyed, the work is destroyed (a crime unless authorised).
        ark.hasBeenDestroyed = true;
        resolveBaseLoss(g, w);
        expect(w.phase).toBe('destroyed');
    }, 1800000);

    it('ark: it picks one colony of one empire at a time, never the same empire twice running, and takes only the original species', () => {
        const a = arkOpen();
        const { g, rec } = a;
        arkSeed(g);
        const e1Targets: Empire[] = [];
        for (let i = 0; i < 3; i++) {
            const t = arkAtColony(a);
            const colony = t.colony;
            expect(t.empire).toBe(colony.empire);
            expect(t.species.length).toBeGreaterThan(0);
            for (const sp of t.species) expect(peekArkState(g)!.origins.find((o) => o.habitat === colony)!.races).toContain(sp.race);
            expect(siphonable(g, colony).map((x) => x.race).sort()).toEqual(t.species.map((x) => x.race).sort());
            expect(g.calculateDistance(t.parkX, t.parkY, colony.xpos, colony.ypos) / g.sectorSize).toBeCloseTo(arkParam(g, 'gwArkParkSectors'), 1);
            e1Targets.push(t.empire);
            // The visit is over: the next colony is another empire's.
            t.finishing = true;
            t.finishedAt = galaxyStarDate(g);
            rec.transports = [];
            arkPeriodic(g);
            expect(rec.lastEmpire).toBe(t.empire);
            expect(rec.visits).toHaveLength(i + 1);
            expect(siphonable(g, colony)).toHaveLength(0); // struck off: it does not come back for that species
        }
        expect(e1Targets[1]).not.toBe(e1Targets[0]);
        expect(e1Targets[2]).not.toBe(e1Targets[1]);
    }, 3600000);

    it('ark: a free passenger ship launches with a slice, the people leave the colony then and join the Ark on arrival; a ship shot down loses them and costs its killer standing', () => {
        const a = arkOpen();
        const { g, rec, ark } = a;
        arkSeed(g);
        const t = arkAtColony(a);
        const compact = compactFaction(g)!;
        const left0 = siphonable(g, t.colony).reduce((n, x) => n + x.amount, 0);
        t.nextLaunch = 0;
        arkPeriodic(g);
        expect(rec.transports).toHaveLength(1);
        const x = rec.transports[0];
        expect(x.ship.actualEmpire).toBe(compact);
        expect(x.ship.supportCostFactor).toBe(0); // free
        expect(x.amount).toBeGreaterThanOrEqual(10_000_000);
        expect(x.amount).toBeLessThanOrEqual(60_000_000);
        expect(siphonable(g, t.colony).reduce((n, y) => n + y.amount, 0)).toBe(left0 - x.amount); // gone from the colony at the launch ...
        expect(arkPopulation(rec)).toBe(0); // ... not yet aboard
        x.ship.xpos = ark.xpos;
        x.ship.ypos = ark.ypos;
        arkPeriodic(g);
        expect(arkPopulation(rec)).toBe(Math.trunc(x.amount)); // ... until it arrives
        expect(rec.stats.landed).toBe(1);
        expect(x.ship.hasBeenDestroyed).toBe(true);
        expect(rec.transports).toHaveLength(0);
        // Another is shot down on the way: its passengers are lost, the killer is marked.
        t.nextLaunch = 0;
        arkPeriodic(g);
        const y = rec.transports[0];
        const killer = actors(g).find((e) => e !== t.empire)!;
        const witness = actors(g).find((e) => e !== killer)!;
        const before = arkEval(g, witness, killer);
        const aboard = arkPopulation(rec);
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: y.ship, destroyer: killer });
        y.ship.hasBeenDestroyed = true;
        arkPeriodic(g);
        expect(rec.stats.lost).toBe(1);
        expect(arkPopulation(rec)).toBe(aboard);
        expect(arkEval(g, witness, killer)).toBeLessThan(before);
    }, 3600000);

    it('ark: the colony owner is asked (a decision pop-up for a human, an answer at once for the AI); accommodating earns the Compact\'s favour and a free-trade treaty, refusing does not stop it', () => {
        const a = arkOpen();
        const { g, rec } = a;
        const player = g.playerEmpire!;
        const compact = compactFaction(g)!;
        arkSeed(g, [player]);
        rec.waitUntil = 0;
        arkPeriodic(g);
        const t = rec.target!;
        expect(t.empire).toBe(player);
        a.ark.xpos = t.parkX;
        a.ark.ypos = t.parkY;
        arkPeriodic(g);
        expect(t.decision).toBe('pending');
        expect(pendingScenarioDecisions(g, player).filter((d) => d.kind === 'giantworks.ark')).toHaveLength(1);
        expect(t.startedAt).toBe(-1); // waits for the answer
        t.nextLaunch = 0;
        arkPeriodic(g);
        expect(rec.transports).toHaveLength(0);
        const favour0 = arkEval(g, compact, player);
        expect(answerScenarioDecision(g, t.decisionId, 'accommodate')).toBe(true);
        expect(t.decision).toBe('accommodate');
        expect(arkEval(g, compact, player)).toBeGreaterThan(favour0);
        expect(obtainDiplomaticRelation(compact, player).type).toBe(DiplomaticRelationType.FreeTradeAgreement);
        t.nextLaunch = 0;
        arkPeriodic(g);
        expect(rec.transports).toHaveLength(1);
        // Refusing: no favour, but it siphons all the same.
        const b = arkOpen();
        arkSeed(b.g, [b.g.playerEmpire!]);
        const t2 = arkAtColony(b, 'refuse');
        expect(t2.decision).toBe('refuse');
        expect(arkEval(b.g, compactFaction(b.g)!, b.g.playerEmpire!)).toBe(0);
        t2.nextLaunch = 0;
        arkPeriodic(b.g);
        expect(b.rec.transports).toHaveLength(1);
        // An undecided human is treated as accommodating when the time is up (the stock decision expiry).
        const c = arkOpen();
        arkSeed(c.g, [c.g.playerEmpire!]);
        c.rec.waitUntil = 0;
        arkPeriodic(c.g);
        const t3 = c.rec.target!;
        c.ark.xpos = t3.parkX;
        c.ark.ypos = t3.parkY;
        arkPeriodic(c.g);
        expect(pendingScenarioDecisions(c.g, c.g.playerEmpire!).find((d) => d.kind === 'giantworks.ark')!.defaultOption).toBe('accommodate');
    }, 3600000);

    it('ark: an AI owner answers by personality and strength, and only a strong, aggressive one plans to attack', () => {
        const a = arkOpen();
        const { g, rec } = a;
        const ai = actors(g).find((e) => !isHumanEmpire(g, e))!;
        arkSeed(g, [ai]);
        const t = arkAtColony(a);
        expect(t.empire).toBe(ai);
        expect(['accommodate', 'refuse']).toContain(t.decision);
        expect(t.plan).not.toBeNull();
        expect(t.decision).toBe(t.plan === 'accommodate' ? 'accommodate' : 'refuse');
        expect(['accommodate', 'ignore', 'attack']).toContain(arkAiChoice(g, rec, ai));
        // A navy that cannot reach the Ark never attacks it.
        const weak = ai.builtObjects.filter((b) => b.role === BuiltObjectRole.Military);
        for (const b of weak) builtObjectCompleteTeardown(g, b);
        expect(arkAiChoice(g, rec, ai)).not.toBe('attack');
    }, 3600000);

    it('ark: an attack stops the siphoning and puts it in fight mode (it fires back at the attackers only), and it resumes when the attack ends', () => {
        const a = arkOpen();
        const { g, rec } = a;
        arkSeed(g);
        const t = arkAtColony(a);
        const attacker = actors(g).find((e) => e !== t.empire)!;
        const bystander = actors(g).find((e) => e !== t.empire && e !== attacker)!;
        const compact = compactFaction(g)!;
        expect(arkFightsAgainst(g, compact, attacker)).toBe(false);
        attack(g, a, attacker);
        expect(rec.fight).toBe(true);
        expect(rec.fights).toBe(1);
        expect(arkFightsAgainst(g, compact, attacker)).toBe(true); // the stock attackWithoutWar query
        expect(arkFightsAgainst(g, compact, bystander)).toBe(false);
        expect(arkFightsAgainst(g, attacker, compact)).toBe(false);
        t.nextLaunch = 0;
        arkPeriodic(g);
        expect(rec.transports).toHaveLength(0); // no launches in a fight
        expect(rec.phase).toBe('siphoning');
        rec.lastAttack = galaxyStarDate(g) - 11 * GAME_DAY_LENGTH;
        arkPeriodic(g); // the fight is over, and the waiting launch goes at once
        expect(rec.fight).toBe(false);
        expect(arkFightsAgainst(g, compact, attacker)).toBe(false);
        expect(rec.transports).toHaveLength(1);
    }, 3600000);

    it('ark: broken shields send it to an empty system about two sectors away, where the shields refill over a year (the stock recharge cannot beat the schedule), then it roams on', () => {
        const a = arkOpen();
        const { g, rec, ark } = a;
        arkSeed(g);
        const t = arkAtColony(a);
        const attacker = actors(g).find((e) => e !== t.empire)!;
        attack(g, a, attacker);
        const from = { x: ark.xpos, y: ark.ypos };
        ark.currentShields = 0;
        arkPeriodic(g);
        expect(rec.phase).toBe('escaping');
        expect(rec.breached).toBe(true);
        expect(rec.escapes).toBe(1);
        expect(rec.visits[rec.visits.length - 1].why).toBe('shields broken');
        expect(rec.target).toBeNull();
        const star = rec.escapeStar!;
        expect(g.systemHabitatsOf(star.systemIndex).every((h) => h.empire === null && !(h.population !== null && h.population !== undefined && h.population.totalAmount > 0))).toBe(true); // empty
        const sectors = g.calculateDistance(star.xpos, star.ypos, from.x, from.y) / g.sectorSize;
        expect(sectors).toBeGreaterThan(0.8);
        expect(sectors).toBeLessThan(4);
        expect(escapeSystem(g, from.x, from.y)).toBe(star);
        const rb = shieldBreakOf(g, ark)!;
        expect(rb.days).toBe(360);
        ark.xpos = star.xpos;
        ark.ypos = star.ypos;
        arkPeriodic(g);
        expect(rec.phase).toBe('repairing');
        arkPeriodic(g);
        expect(rec.phase).toBe('repairing'); // stays while the shields are down
        // Half a year on, the stock recharge has refilled it, but the schedule holds it to half.
        rb.brokenAt = galaxyStarDate(g) - 180 * GAME_DAY_LENGTH;
        ark.currentShields = ark.shieldsCapacity;
        stepShields(g);
        expect(ark.currentShields / ark.shieldsCapacity).toBeCloseTo(0.5, 1);
        expect(shieldScheduleFraction(g, ark)!).toBeCloseTo(0.5, 1);
        expect(rec.breached).toBe(true);
        // A year on, it is whole and goes roaming again (to another empire).
        rb.brokenAt = galaxyStarDate(g) - 361 * GAME_DAY_LENGTH;
        rec.lastAttack = galaxyStarDate(g) - 30 * GAME_DAY_LENGTH; // the fight is long over
        stepShields(g);
        expect(shieldBreakOf(g, ark)).toBeNull();
        expect(ark.currentShields).toBe(ark.shieldsCapacity);
        arkPeriodic(g);
        expect(rec.breached).toBe(false);
        expect(rec.phase).toBe('roaming');
        expect(rec.target?.empire).not.toBe(t.empire);
    }, 3600000);

    it('shields: a broken object holds to its schedule, an unbroken one is untouched', () => {
        const { g, ark } = arkOpen();
        const rb = breakShields(g, ark, 100);
        expect(ark.currentShields).toBe(0);
        expect(breakShields(g, ark, 5)).toBe(rb); // a second break while one runs changes nothing
        ark.currentShields = ark.shieldsCapacity;
        rb.brokenAt = galaxyStarDate(g) - 25 * GAME_DAY_LENGTH;
        stepShields(g);
        expect(ark.currentShields / ark.shieldsCapacity).toBeCloseTo(0.25, 1);
        rb.brokenAt = galaxyStarDate(g) - 101 * GAME_DAY_LENGTH;
        stepShields(g);
        expect(shieldBreakOf(g, ark)).toBeNull();
        ark.currentShields = 5;
        stepShields(g);
        expect(ark.currentShields).toBe(5); // no schedule, no clamp
    }, 1800000);

    it('ark: the people aboard keep growing at their race\'s rate, with no cap', () => {
        const { g, rec } = arkOpen();
        const race = g.races.find((r) => r !== null && r.playable)!;
        rec.aboard = { [race.name]: 1_000_000_000 };
        rec.grownAt = galaxyStarDate(g) - YEAR_LENGTH;
        const before = arkPopulation(rec);
        arkPeriodic(g);
        const after = arkPopulation(rec);
        expect(after).toBeGreaterThan(before);
        expect(after).toBeLessThan(before * 1.2);
        expect(rec.stats.grown).toBeGreaterThan(0);
        rec.aboard[race.name] = 5e12; // far beyond any colony's room
        rec.grownAt = galaxyStarDate(g) - YEAR_LENGTH;
        arkPeriodic(g);
        expect(rec.aboard[race.name]).toBeGreaterThan(5e12);
    }, 1800000);

    it('ark: destroyed, its people die and the killer loses standing with every empire; a seized Ark stops roaming', () => {
        const a = arkOpen();
        const { g, rec, ark } = a;
        const race = g.races.find((r) => r !== null && r.playable)!;
        rec.aboard = { [race.name]: 700_000_000 };
        const killer = actors(g)[0];
        const witness = actors(g)[1];
        const before = arkEval(g, witness, killer);
        ark.hasBeenDestroyed = true;
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: ark, destroyer: killer });
        expect(rec.phase).toBe('lost');
        expect(rec.died).toBe(700_000_000);
        expect(arkPopulation(rec)).toBe(0);
        expect(rec.destroyedBy).toBe(killer);
        expect(arkEval(g, witness, killer)).toBeLessThan(before - 10);
        // Seized by boarding: the record keeps the people and the state for the capture feature, and the Ark stops.
        const b = arkOpen();
        b.rec.aboard = { [race.name]: 300_000_000 };
        const captor = actors(b.g)[0];
        b.ark.empire = captor;
        arkPeriodic(b.g);
        expect(b.rec.phase).toBe('seized');
        expect(b.rec.seizedBy).toBe(captor);
        expect(arkPopulation(b.rec)).toBe(300_000_000);
    }, 3600000);

    it('ark: save and load keep the Ark, its target, transports, people, shield schedule and speed', () => {
        const a = arkOpen();
        const { g, w, rec, ark, game, gameData } = a;
        arkSeed(g);
        const t = arkAtColony(a);
        t.nextLaunch = 0;
        arkPeriodic(g);
        const race = g.races.find((r) => r !== null && r.playable)!;
        rec.aboard = { [race.name]: 123_456_789 };
        attack(g, a, actors(g).find((e) => e !== t.empire)!);
        ark.currentShields = 0;
        arkPeriodic(g);
        expect(rec.phase).toBe('escaping');
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const lg = deserializeGame(text, gameData).game.galaxy;
        const lrec = arkRecOf(lg, w.id)!;
        expect(lrec.phase).toBe('escaping');
        expect(lrec.breached).toBe(true);
        expect(lrec.fight).toBe(rec.fight);
        expect(lrec.ship!.builtObjectID).toBe(ark.builtObjectID);
        expect(lg.scenario!.state[ARK_KEY]).toBeDefined();
        expect(lrec.escapeStar!.habitatIndex).toBe(rec.escapeStar!.habitatIndex);
        expect(lrec.aboard).toEqual(rec.aboard);
        expect(lrec.attackers).toEqual(rec.attackers);
        expect(lrec.visits.map((v) => v.colony)).toEqual(rec.visits.map((v) => v.colony));
        expect(lrec.transports.map((x) => x.ship.builtObjectID)).toEqual(rec.transports.map((x) => x.ship.builtObjectID));
        expect(shieldBreakOf(lg, lrec.ship!)?.days).toBe(360);
        expect(peekArkState(lg)!.origins.length).toBe(peekArkState(g)!.origins.length);
        expect(warpSpeedWithBonuses(lrec.ship!)).toBeLessThanOrEqual(Math.trunc(lrec.ship!.warpSpeed * 0.51));
        expect(w.base).toBe(ark);
        expect(greatWorks(lg)[0].base).toBe(lrec.ship);
    }, 3600000);

    // ---------------------------------------------------------------------------------------------------------------
    // Taking a Great Work by ground war (giantworks/capture.ts)
    // ---------------------------------------------------------------------------------------------------------------

    /** A finished work (a throw-away kind unless `kind`), its capture record made by the first step. */
    function captureOpen(params: Record<string, number> = {}, flags: Record<string, boolean> = {}, kind = 'gwtest-a'): { g: Galaxy; w: GreatWorkRecord; rec: CaptureRec; base: BuiltObject; game: Game; gameData: GameData } {
        const { g, w, game, gameData } = building(params, flags, kind);
        addProgress(g, w, 2);
        expect(w.phase).toBe('complete');
        capturePeriodic(g);
        const rec = captureRecOf(g, w.id)!;
        expect(rec).not.toBeNull();
        return { g, w, rec, base: w.base!, game, gameData };
    }
    /** A troop transport of `e` at (x, y) with `n` infantry troops of `strength` aboard (the index rebuilt so range scans see it). */
    function troopShip(g: Galaxy, e: Empire, x: number, y: number, n: number, strength = 100): BuiltObject {
        const d = generateDesignFromSpec(g, e, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.TroopTransport)!, 0, galaxyStarDate(g))!;
        const bo = generateNewBuiltObject(g, e, d, null, x, y);
        takeOwnershipOfBuiltObject(g, e, bo, e, false);
        bo.xpos = x;
        bo.ypos = y;
        loadTroopsOnto(bo, e, Array.from({ length: n }, (_, i) => generateNewTroop(`Test troop ${i}`, TroopType.Infantry, strength, e, e.dominantRace, true)));
        rebuildIndexes(g);
        return bo;
    }
    /** A warship of `e` at (x, y). */
    function warship(g: Galaxy, e: Empire, x: number, y: number): BuiltObject {
        const d = generateDesignFromSpec(g, e, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Destroyer)!, 0, galaxyStarDate(g))!;
        const bo = generateNewBuiltObject(g, e, d, null, x, y);
        takeOwnershipOfBuiltObject(g, e, bo, e, false);
        bo.xpos = x;
        bo.ypos = y;
        rebuildIndexes(g);
        return bo;
    }
    /** The shields are shot down: the next step opens the window. */
    function breach(g: Galaxy, w: GreatWorkRecord, rec: CaptureRec): void {
        w.base!.currentShields = 0;
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(rec.breachedAt).toBeGreaterThanOrEqual(0);
    }
    /** Fights the ground war on in 5-day steps until it ends (at most `steps`). */
    function fight(g: Galaxy, w: GreatWorkRecord, rec: CaptureRec, steps = 200): void {
        for (let i = 0; i < steps && rec.invaders.count > 0; i++) {
            rec.battleAt = galaxyStarDate(g) - 5 * GAME_DAY_LENGTH;
            stepCapture(g, w, rec, galaxyStarDate(g));
        }
    }

    it('capture: a finished wonder is plated to about 30,000 shields and garrisoned per wonder; add-on off leaves no state', () => {
        const { g, w, rec, base } = captureOpen();
        expect(rec.plated).toBe(true);
        expect(base.shieldsCapacity).toBeGreaterThan(27000);
        expect(base.shieldsCapacity).toBeLessThan(40000);
        expect(base.currentShields).toBe(base.shieldsCapacity);
        expect(base.actualEmpire).toBe(compactFaction(g));
        expect(base.firepowerRaw).toBeGreaterThan(0);
        expect(rec.garrison.count).toBe(garrisonSize(g, w.wonder));
        expect(garrisonSize(g, w.wonder)).toBe(captureParam(g, 'gwCaptureGarrisonOther'));
        for (const t of rec.garrison.items) {
            expect(t.empire).toBe(compactFaction(g));
            expect(t.maintenanceMultiplier).toBe(0);
            expect(t.readiness).toBe(100);
            expect(t.overallDefendStrength).toBeGreaterThan(0);
        }
        expect(rec.garrison.items.some((t) => t.type === TroopType.Armored)).toBe(true);
        expect(garrisonSize(g, 'casino')).toBe(8);
        expect(garrisonSize(g, 'ultramind')).toBe(10);
        expect(garrisonSize(g, 'sanctuary')).toBe(6);
        expect(garrisonSize(g, 'ark')).toBe(14);
        expect(captureParam(g, 'gwCaptureShields')).toBe(30000);
        expect(captureParam(g, 'gwCaptureRechargeDays')).toBe(360);
        for (const tag of ['Giantworks Capture Breach News', 'Giantworks Capture Captured News', 'Giantworks Capture Action Invade', 'Reputation Cause giantworks.capture']) expect(tryGetText(tag)).not.toBeNull();
        // Whole shields: no window, nothing to land on.
        expect(rec.breachedAt).toBe(-1);
        expect(rec.landingOpen).toBe(false);
        // They refill from empty over gwCaptureRechargeDays (a year: capacity / 600 game seconds), and not at all under fire.
        expect(base.shieldRechargeRate).toBeCloseTo(base.shieldsCapacity / 600, 3);
        base.currentShields -= 1000;
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(base.shieldRechargeRate).toBe(0);
        expect(rec.breachedAt).toBe(-1); // dented, not broken
        rec.lastHit = galaxyStarDate(g) - 3 * GAME_DAY_LENGTH;
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(base.shieldRechargeRate).toBeCloseTo(base.shieldsCapacity / 600, 3);
        // The Beacon is never capturable (it is the Reclaimers' own relay).
        expect(capturableWork({ ...w, wonder: 'beacon' } as GreatWorkRecord)).toBe(false);
        expect(capturableWork(w)).toBe(true);
        // The Compact never sells it in a trade deal (stock tradeable bases); an empire holding it may.
        const e = actors(g)[0];
        expect(scenarioQuery(g, 'baseTradeable', true, { base, giver: compactFaction(g)!, receiver: e })).toBe(false);
        expect(scenarioQuery(g, 'baseTradeable', true, { base, giver: e, receiver: actors(g)[1] })).toBe(true);
        const off = gw({ threatGiantworks: false });
        capturePeriodic(off);
        expect(peekCaptureState(off)).toBeNull();
    }, 1800000);

    it('capture: broken shields open a one-year landing window; a share of the weapons fires, sparing troop carriers while any other hostile ship is in range, and the Compact answers the attacker', () => {
        const { g, w, rec, base } = captureOpen();
        const e = actors(g)[0];
        const compact = compactFaction(g)!;
        breach(g, w, rec);
        const sched = shieldBreakOf(g, base)!;
        expect(sched.days).toBe(360);
        expect(rec.landingOpen).toBe(true);
        // Only gwCaptureBreachedWeaponsPct % of the weapons may fire (the rest are held a day ahead).
        const ws = base.weapons;
        const share = captureParam(g, 'gwCaptureBreachedWeaponsPct') / 100;
        const firing = ws.filter((x) => x.lastFired <= g.nowMs);
        expect(firing.length).toBe(ws.filter((_, i) => keepsFiring(i, share)).length);
        expect(Math.abs(firing.length - ws.length * share)).toBeLessThanOrEqual(1);
        // Spread through the list, so every kind of gun keeps its share.
        for (const type of new Set(ws.map((x) => x.component.type))) {
            const all = ws.filter((x) => x.component.type === type).length;
            if (all >= 5) expect(firing.filter((x) => x.component.type === type).length).toBeGreaterThan(0);
        }
        // Half a year on the stock recharge cannot beat the schedule: the window is still open.
        sched.brokenAt = galaxyStarDate(g) - 180 * GAME_DAY_LENGTH;
        base.currentShields = base.shieldsCapacity;
        stepShields(g);
        expect(base.currentShields / base.shieldsCapacity).toBeCloseTo(0.5, 1);
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(rec.landingOpen).toBe(true);
        // An attacker's warship and its troop carrier near the base: the carrier is spared while the warship is there.
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: base, attacker: base, attackingEmpire: e });
        const war = warship(g, e, base.xpos + 600, base.ypos);
        const carrier = troopShip(g, e, base.xpos - 600, base.ypos, 2);
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(rec.sparesTroopers).toBe(true);
        expect(scenarioQuery(g, 'builtObjectSparesStaticTarget', false, { builtObject: base, target: carrier })).toBe(true);
        expect(scenarioQuery(g, 'builtObjectSparesStaticTarget', false, { builtObject: base, target: war })).toBe(false);
        expect(scenarioQuery(g, 'attackWithoutWar', false, { empire: compact, target: e })).toBe(true); // it answers the whole fleet in range
        expect(scenarioQuery(g, 'attackWithoutWar', false, { empire: compact, target: actors(g)[1] })).toBe(false);
        // The carrier alone: it is fair game.
        builtObjectCompleteTeardown(g, war);
        rebuildIndexes(g);
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(rec.sparesTroopers).toBe(false);
        expect(scenarioQuery(g, 'builtObjectSparesStaticTarget', false, { builtObject: base, target: carrier })).toBe(false);
        // A year on, the shields are whole: the window closes, the weapons all fire again (no more held).
        sched.brokenAt = galaxyStarDate(g) - 361 * GAME_DAY_LENGTH;
        stepShields(g);
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(rec.breachedAt).toBe(-1);
        expect(rec.landingOpen).toBe(false);
        expect(scenarioQuery(g, 'attackWithoutWar', false, { empire: compact, target: e })).toBe(false);
        expect(rec.stats.breaches).toBe(1);
    }, 1800000);

    it('capture: at half its components damaged its guns fall silent; a Smarter AI attacker then invades when it has the troops and destroys it when it has not', () => {
        const { g, w, rec, base } = captureOpen();
        breach(g, w, rec);
        const comps = base.components.items;
        for (let i = 0; i < Math.ceil(comps.length * 0.5); i++) comps[i].status = ComponentStatus.Damaged;
        base.reDefine();
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(rec.quiet).toBe(true);
        expect(base.weapons.every((x) => x.lastFired > g.nowMs)).toBe(true); // all silent
        // An AI attacker without troops in reach destroys it; one with plenty invades.
        const ai = actors(g).filter((e) => !isHumanEmpire(g, e));
        const [poor, rich] = ai;
        for (const e of [poor, rich]) for (const sg of empireShipGroups(e)) if (sg !== null) for (const b of sg.ships) if (b.troops !== null) b.troops.clear();
        // The rich empire's troop fleet: a transport with 40 strong troops, a fleet of its own, near the work.
        const ship = troopShip(g, rich, base.xpos + 20000, base.ypos, 40, 300);
        const fleet = new ShipGroup(g);
        fleet.empire = rich;
        fleet.posture = FleetPosture.Attack;
        fleet.ships.push(ship);
        fleet.leadShip = ship;
        ship.shipGroup = fleet;
        empireShipGroups(rich).push(fleet);
        ship.isAutoControlled = true;
        expect(fleet.leadShip).toBe(ship);
        expect(aiQuietChoice(g, w, rec, poor).choice).toBe('destroy');
        const q = aiQuietChoice(g, w, rec, rich);
        expect(q.troops).toBeGreaterThan(q.need);
        expect(q.choice).toBe('capture');
        // The choice is made once per window, at the quiet point, for each attacker (deterministically).
        rec.hostiles[poor.empireId] = galaxyStarDate(g);
        rec.hostiles[rich.empireId] = galaxyStarDate(g);
        rec.aiAt = -Infinity;
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(rec.plans[poor.empireId]).toBe('destroy');
        expect(rec.plans[rich.empireId]).toBe('capture');
        expect(rec.campaign?.empire).toBe(rich);
        expect(rec.campaign?.stage).toBe('capture');
        expect(w.captureBy).toBe(rich.empireId); // its destroy strikes stop (ai.ts, ark.ts)
        expect(aiReview(g, w, rich)).toBe('none');
        expect(rec.stats.aiCapture).toBe(1);
        expect(rec.stats.aiDestroy).toBe(1);
    }, 1800000);

    it('capture: troops land within the window and win the ground war by the stock maths; the work and its benefits pass to the captor, every empire thinks less of it, and it is no war crime', () => {
        const { g, w, rec, base } = captureOpen();
        const e = g.playerEmpire!;
        const witness = actors(g).find((x) => x !== e)!;
        breach(g, w, rec);
        // A player's troop ship far away does not land; ordered to attack the work with its troops and close by, it does.
        const near = troopShip(g, e, base.xpos + 500, base.ypos, 30, 250);
        expect(availableThreatActions(g, e, base).map((a) => a.kind)).toContain(INVADE_ACTION);
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(rec.invaders.count).toBe(0); // no order naming the work
        expect(scenarioQuery(g, 'virtualInvasionTargets', [], { empire: e, x: base.xpos, y: base.ypos, range: 5000 })).toEqual([base]);
        assignMission(g, near, BuiltObjectMissionType.Attack, base, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(rec.invaders.count).toBe(30);
        expect(rec.invader).toBe(e);
        expect(near.troops!.count).toBe(0);
        expect(rec.stats.landings).toBe(1);
        // The forces: the stock troop matchups and Space Control (the guns still fire: the defenders hold the space).
        const f = captureForces(g, rec);
        expect(f.attackingStrength).toBeGreaterThan(f.defendingStrength);
        expect(f.defend.reasons).toContain('Space Control');
        // Only one invader at a time.
        const other = actors(g).find((x) => x !== e && x !== witness)!;
        expect(mayInvade(g, rec, other)).toBe(false);
        const before = obtainEmpireEvaluation(g, witness, e).incidentEvaluation;
        fight(g, w, rec);
        expect(rec.stats.captured).toBe(1);
        expect(base.actualEmpire).toBe(e);
        expect(w.holder).toBe(e);
        expect(greatWorkBeneficiary(g, w)).toBe(e);
        expect(greatWorkShares(g, w)).toEqual([{ empire: e, share: 1, role: 'owner' }]);
        expect(rec.garrison.count).toBeGreaterThan(0);
        for (const t of rec.garrison.items) expect(t.empire).toBe(e);
        expect(rec.invaders.count).toBe(0);
        expect(obtainEmpireEvaluation(g, witness, e).incidentEvaluation).toBeLessThan(before);
        expect(warCrimesRecord(g, e)?.counts.greatWork ?? 0).toBe(0);
        expect(rec.captures[0].by).toBe(e.name);
        // Destroyed after the capture: the record lets go.
        base.hasBeenDestroyed = true;
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(rec.base).toBeNull();
    }, 1800000);

    it('capture: too few troops are wiped out by the garrison, which then regrows; the window closing stops new landings', () => {
        const { g, w, rec, base } = captureOpen();
        const e = g.playerEmpire!;
        breach(g, w, rec);
        const near = troopShip(g, e, base.xpos + 500, base.ypos, 1, 20);
        expect(runThreatAction(g, e, INVADE_ACTION, base)).toBe(true);
        expect(rec.invaders.count).toBe(1);
        fight(g, w, rec);
        expect(rec.stats.repelled).toBe(1);
        expect(rec.invader).toBeNull();
        expect(base.actualEmpire).toBe(compactFaction(g));
        expect(e.troops.items.some((t) => t.name === 'Test troop 0')).toBe(false); // dead troops leave the empire's list
        // The garrison lost troops and regrows one at a time.
        rec.garrison.items.splice(0, 3);
        const n = rec.garrison.count;
        rec.regrowAt = 0;
        stepCapture(g, w, rec, galaxyStarDate(g));
        expect(rec.garrison.count).toBe(n + 1);
        // The window closes: troops near it no longer land.
        shieldBreakOf(g, base)!.brokenAt = galaxyStarDate(g) - 361 * GAME_DAY_LENGTH;
        stepShields(g);
        stepCapture(g, w, rec, galaxyStarDate(g));
        loadTroopsOnto(near, e, [generateNewTroop('Late troop', TroopType.Infantry, 100, e, e.dominantRace, true)]);
        expect(runThreatAction(g, e, INVADE_ACTION, base)).toBe(false);
        expect(rec.invaders.count).toBe(0);
    }, 1800000);

    it('capture: the Ark flees once and can be captured at its escape system while its shields are down; it does not flee again there', () => {
        const a = arkOpen();
        const { g, w, rec: ark } = a;
        capturePeriodic(g);
        const rec = captureRecOf(g, w.id)!;
        expect(rec.base).toBe(a.ark);
        expect(rec.garrison.count).toBe(14);
        const e = g.playerEmpire!;
        arkSeed(g);
        const t = arkAtColony(a);
        attack(g, a, actors(g).find((x) => x !== t.empire)!);
        a.ark.currentShields = 0;
        arkPeriodic(g);
        expect(ark.phase).toBe('escaping');
        capturePeriodic(g);
        expect(rec.breachedAt).toBeGreaterThanOrEqual(0); // the weapons share applies on the way
        expect(rec.landingOpen).toBe(false); // but nobody lands on a ship in flight
        const star = ark.escapeStar!;
        a.ark.xpos = star.xpos;
        a.ark.ypos = star.ypos;
        arkPeriodic(g);
        expect(ark.phase).toBe('repairing');
        capturePeriodic(g);
        expect(rec.landingOpen).toBe(true);
        // Found and attacked again at the escape system it stays (crippled) where troops can reach it.
        attack(g, a, e);
        ark.lastEscape = galaxyStarDate(g) - 40 * GAME_DAY_LENGTH;
        arkPeriodic(g);
        expect(ark.phase).toBe('repairing');
        expect(ark.escapeStar).toBe(star);
        rebuildIndexes(g);
        troopShip(g, e, a.ark.xpos + 500, a.ark.ypos, 40, 300);
        expect(runThreatAction(g, e, INVADE_ACTION, a.ark)).toBe(true);
        fight(g, w, rec);
        expect(rec.stats.captured).toBe(1);
        expect(a.ark.actualEmpire).toBe(e);
        arkPeriodic(g);
        expect(ark.phase).toBe('seized'); // the Ark's own rule for a new holder: it stops roaming, its people stay aboard
        expect(ark.seizedBy).toBe(e);
    }, 3600000);

    it('capture: the Ground Report shows a Great Work\'s ground war in the stock view (its garrison, the invaders, the base in orbit, the strengths)', () => {
        const { g, w, rec, base } = captureOpen();
        const e = g.playerEmpire!;
        breach(g, w, rec);
        troopShip(g, e, base.xpos + 500, base.ypos, 6, 150);
        expect(runThreatAction(g, e, INVADE_ACTION, base)).toBe(true);
        const m = buildGreatWorkGroundReport({ galaxy: g, base, panelSize: 0 })!;
        expect(m).not.toBeNull();
        expect(m.items.filter((i) => i.kind === 'defendingTroop')).toHaveLength(rec.garrison.count);
        expect(m.items.filter((i) => i.kind === 'invadingTroop')).toHaveLength(6);
        expect(m.items.filter((i) => i.kind === 'base').map((i) => i.obj)).toEqual([base]);
        expect(m.items.some((i) => i.kind === 'population' || i.kind === 'facility')).toBe(false);
        expect(m.texts.some((t) => t.text === compactFaction(g)!.name)).toBe(true);
        expect(m.texts.some((t) => t.text === e.name)).toBe(true);
        const f = captureForces(g, rec);
        expect(m.defendingStrength).toBe(f.defendingStrength);
        expect(m.attackingStrength).toBe(f.attackingStrength);
        expect(m.statusBar).not.toBeNull();
        expect(m.shield).toBeNull(); // the shields are down
        for (const it of m.items) {
            expect(it.rect.x).toBeGreaterThanOrEqual(0);
            expect(it.rect.x + it.rect.w).toBeLessThanOrEqual(m.size.w);
            expect(it.rect.y + it.rect.h).toBeLessThanOrEqual(m.size.h);
        }
    }, 1800000);

    it('capture: save and load keep the window, the garrison, the invaders and the campaign; a save from before the feature gets it on load', () => {
        const { g, w, rec, base, game, gameData } = captureOpen();
        const e = g.playerEmpire!;
        breach(g, w, rec);
        troopShip(g, e, base.xpos + 500, base.ypos, 5, 150);
        expect(runThreatAction(g, e, INVADE_ACTION, base)).toBe(true);
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const lg = deserializeGame(text, gameData).game.galaxy;
        const lrec = captureRecOf(lg, w.id)!;
        expect(lrec.base!.builtObjectID).toBe(base.builtObjectID);
        expect(lrec.breachedAt).toBe(rec.breachedAt);
        expect(lrec.garrison.count).toBe(rec.garrison.count);
        expect(lrec.invaders.items.map((t) => t.name)).toEqual(rec.invaders.items.map((t) => t.name));
        expect(lrec.invader!.empireId).toBe(e.empireId);
        expect(shieldBreakOf(lg, lrec.base!)?.days).toBe(360);
        expect(lrec.base!.shieldsCapacity).toBe(base.shieldsCapacity);
        // Both copies fight on identically.
        rec.battleAt = lrec.battleAt = galaxyStarDate(g) - 5 * GAME_DAY_LENGTH;
        stepCapture(g, w, rec, galaxyStarDate(g));
        stepCapture(lg, greatWorks(lg)[0], lrec, galaxyStarDate(lg));
        expect(lrec.invaders.items.map((t) => t.readiness)).toEqual(rec.invaders.items.map((t) => t.readiness));
        expect(lrec.garrison.items.map((t) => t.readiness)).toEqual(rec.garrison.items.map((t) => t.readiness));
        // A save made before the feature: no capture state; the first step after loading plates and garrisons the work.
        const old = captureOpen();
        delete old.g.scenario!.state[CAPTURE_KEY];
        const t2 = new GalaxyTime();
        t2.bindGalaxy(old.g);
        const og = deserializeGame(serializeGame(old.game, t2, {} as StartGameOptions), old.gameData).game.galaxy;
        expect(peekCaptureState(og)).toBeNull();
        capturePeriodic(og);
        const orec = captureRecOf(og, greatWorks(og)[0].id)!;
        expect(orec.plated).toBe(true);
        expect(orec.garrison.count).toBe(garrisonSize(og, greatWorks(og)[0].wonder));
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

    /** The shuttle's clock: a 3-day step at a time (ships that were sent out are put at their world, the sim does not fly them here) until `done`. */
    function shuttleUntil(g: Galaxy, st: BeaconState, done: () => boolean, steps = 60): void {
        for (let i = 0; i < steps && !done(); i++) {
            g.nowMs += 3 * GAME_DAY_LENGTH;
            for (const c of cattleOf(st)) if (c.phase === 'out') {
                c.ship.xpos = c.from.xpos + 1000;
                c.ship.ypos = c.from.ypos;
            }
            harvestPeriodic(g, st);
        }
    }
    const laden = (st: BeaconState): CattleRec[] => cattleOf(st).filter((c) => c.phase === 'in');

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
            // real engines: about 20 top speed and 12 cruise (the template's 18 engines gave 5 / 3), the turn rate kept (0.117)
            expect(b.design!.topSpeed).toBeGreaterThanOrEqual(20);
            expect(b.design!.topSpeed).toBeLessThanOrEqual(22);
            expect(b.design!.cruiseSpeed).toBeGreaterThanOrEqual(12);
            expect(b.design!.cruiseSpeed).toBeLessThanOrEqual(14);
            expect(b.design!.turnRate).toBeGreaterThan(0.115);
            expect(b.design!.turnRate).toBeLessThan(0.13);
            expect(b.design!.components.filter((c) => c.type === ComponentType.EngineMainThrust).length).toBeGreaterThan(60);
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
        // purge: needs the owner; no credit cost; the world rebels (the battle is tested in 'the purge')
        const owner = normalsOf(g)[0];
        const rec = st.corrupted[0];
        rec.colony.empire = owner;
        owner.stateMoney = 10_000_000;
        const before = owner.stateMoney;
        expect(purgeCorruption(g, st, rec, owner)).toBe(true);
        expect(owner.stateMoney).toBe(before);
        expect(rec.purge).toBeDefined();
        expect(purgeCorruption(g, st, rec, owner)).toBe(false); // a battle is on
    }, 900000);

    // helper: a corrupted world owned by a normal empire
    function corruptedOwned(g: Galaxy, st: BeaconState, owner: Empire, idx = 1) {
        const colony = owner.colonies.filter((c) => c !== owner.capital)[idx] ?? owner.colonies[idx];
        if (!st.formerIndependents.includes(colony)) st.formerIndependents.push(colony);
        return corrupt(g, st, colony)!;
    }
    const setTech5 = (e: Empire, n: number): void => {
        let k = 0;
        for (const t of e.research.techTree) if (t.def.techLevel === 5) t.isResearched = k++ < n;
    };

    it('the siphon: a corrupted world siphons tech-5 knowledge of its owner (the nearest empire when independent), faster with more tech-5 techs, none with none; completion waits for the total', () => {
        const { g, site, st } = rolled();
        const [a, b] = normalsOf(g);
        const ra = corruptedOwned(g, st, a, 0);
        const total5 = a.research.techTree.filter((t) => t.def.techLevel === 5).length;
        expect(total5).toBeGreaterThan(4);
        const month = 30 * GAME_DAY_LENGTH;
        const credit = (): number => {
            const before = st.siphon?.total ?? 0;
            siphonPass(g, st); // (opens the record)
            st.siphon!.last = galaxyStarDate(g);
            g.nowMs += month;
            siphonPass(g, st);
            return st.siphon!.total - before;
        };
        setTech5(a, 0);
        siphonPass(g, st);
        expect(credit()).toBe(0);
        setTech5(a, 2);
        const two = credit();
        expect(two).toBeCloseTo(2 * 1, 5);
        setTech5(a, 4);
        expect(credit()).toBeCloseTo(2 * two, 5);
        expect(ra.siphoned).toBeCloseTo(0 + 2 + 4, 5);
        // an independent corrupted world drains the nearest empire
        const indep = st.formerIndependents.find((c) => c.empire === g.independentEmpire && !st.corrupted.some((r) => r.colony === c));
        if (indep !== undefined) {
            const r2 = corrupt(g, st, indep)!;
            const donor = siphonDonor(g, st, indep)!;
            expect(donor).not.toBe(g.independentEmpire);
            expect(siphonRateOf(g, st, r2)).toBeCloseTo(1 * tech5Count(donor), 5);
        }
        // the gate: the work waits at 99.9 % until enough has been siphoned
        const need = 2000;
        st.siphon!.total = need - 1;
        expect(beaconKind.canComplete!(g, site)).toBe(false);
        const work = { ...site, phase: 'building', wonder: 'beacon', convoys: [], delivered: 0, seenBy: [], knowledge: [] } as unknown as Parameters<typeof addProgress>[1];
        work.progress = 0.98;
        addProgress(g, work, 0.05);
        expect(work.progress).toBeCloseTo(0.999, 5);
        expect(work.phase).toBe('building');
        st.siphon!.total = need;
        expect(beaconKind.canComplete!(g, site)).toBe(true);
        // an older save (no record) starts at the share the build had made
        delete st.siphon;
        site.progress = 0.5;
        expect(siphonOf(g, st).total).toBe(1000);
        void b;
    }, 900000);

    it('siphon fallbacks: with the start-independent pool exhausted the Watchers may corrupt small colonies; a baseline siphon begins when the scaffold waits for the gate; a hard time limit opens the gate', () => {
        const { g, site, st } = rolled();
        const [a] = normalsOf(g);
        const year = 360 * GAME_DAY_LENGTH;
        // the pool: plenty of start-independent worlds, no fallback
        expect(st.rollDate).toBe(galaxyStarDate(g));
        const extra = a.colonies.filter((c) => c !== a.capital);
        expect(extra.length).toBeGreaterThanOrEqual(2);
        for (const c of extra) if (!st.formerIndependents.includes(c)) st.formerIndependents.push(c);
        const small = extra[0];
        const big = extra[1];
        small.population.totalAmount = 10_000_000;
        big.population.totalAmount = 900_000_000;
        expect(corruptCandidates(g, st).length).toBeGreaterThanOrEqual(3);
        // exhausted: fewer than beaconCorruptMinPool left (here: none start independent): any small, low-population colony, never a capital or a big one
        st.formerIndependents = [];
        const cands = corruptCandidates(g, st);
        expect(cands).toContain(small);
        expect(cands).not.toContain(big);
        expect(cands).not.toContain(a.capital);
        expect(cands.every((c) => c.population.totalAmount <= 30_000_000)).toBe(true);
        g.scenario!.params.beaconCorruptFallbackPop = 0;
        expect(corruptCandidates(g, st)).toHaveLength(0);
        delete g.scenario!.params.beaconCorruptFallbackPop;
        // the baseline siphon: nothing while the scaffold is still being built, 80 a month once it waits at 99.9 % for the gate
        const credit = (): number => {
            siphonPass(g, st);
            const before = st.siphon!.total;
            g.nowMs += 30 * GAME_DAY_LENGTH;
            siphonPass(g, st);
            return st.siphon!.total - before;
        };
        setTech5(a, 0);
        expect(credit()).toBe(0);
        const gw = site as unknown as { phase: string; progress: number; base: BuiltObject | null };
        gw.phase = 'building';
        gw.progress = 0.999;
        gw.base = a.builtObjects.find((o) => !o.hasBeenDestroyed)!;
        expect(credit()).toBeCloseTo(80, 5);
        expect(siphonOf(g, st).rate).toBe(80);
        expect(siphonOf(g, st).holdSince).toBeGreaterThan(0);
        // from nothing the gate opens within about two years of holding, with no tech-5 empire at all
        st.siphon!.total = 0;
        let months = 0;
        while (!siphonGateOpen(g, st) && months < 60) {
            credit();
            months++;
        }
        expect(months).toBeGreaterThanOrEqual(24);
        expect(months).toBeLessThanOrEqual(30);
        // the hard limit: the gate is open after beaconSiphonMaxYears whatever was taken
        st.siphon!.total = 0;
        st.rollDate = galaxyStarDate(g) - 29 * year;
        expect(siphonGateOpen(g, st)).toBe(false);
        expect(beaconKind.canComplete!(g, site)).toBe(false);
        st.rollDate = galaxyStarDate(g) - 31 * year;
        expect(siphonGateOpen(g, st)).toBe(true);
        expect(beaconKind.canComplete!(g, site)).toBe(true);
        siphonPass(g, st);
        expect(st.siphon!.gateDate).toBeGreaterThan(0);
        g.scenario!.params.beaconSiphonMaxYears = 0; // 0: no limit
        st.siphon!.total = 0;
        expect(siphonGateOpen(g, st)).toBe(false);
    }, 900000);

    it('guarding the held scaffold: one Watcher comes home and guards it (the other keeps corrupting; a lone Watcher guards and corruption pauses); an attack on the scaffold makes it defend work and self under the no-war rule, then it goes back to guarding', () => {
        const { g, st, site } = rolled();
        const [a, b] = normalsOf(g);
        const [w0, w1] = st.watchers;
        const gw = site as unknown as { phase: string; progress: number; base: BuiltObject | null };
        const base = a.builtObjects.find((o) => !o.hasBeenDestroyed)!;
        // not holding: nothing changes
        watchersPeriodic(g);
        expect(w0.mode).not.toBe('guard');
        gw.phase = 'building';
        gw.progress = 0.999;
        gw.base = base;
        watchersPeriodic(g);
        expect(w0.mode).toBe('guard');
        expect(w1.mode).not.toBe('guard'); // the other keeps corrupting
        expect(w0.ship!.cloaked).toBe(true);
        expect(builtObjectMission(w0.ship!.mission)?.type).toBe(BuiltObjectMissionType.Move);
        // an attack on the scaffold: the guard defends itself and the work, against the attackers only
        w0.ship!.xpos = base.xpos + 1000;
        w0.ship!.ypos = base.ypos;
        const hunter = b.builtObjects.find((o) => !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && o.topSpeed > 0 && o.shipGroup === null)!;
        const bystander = b.builtObjects.find((o) => !o.hasBeenDestroyed && o !== hunter && o.role === BuiltObjectRole.Military && o.topSpeed > 0 && o.shipGroup === null)!;
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: base, attacker: hunter, attackingEmpire: b });
        expect(w0.mode).toBe('fight');
        expect(w0.prevMode).toBe('guard');
        expect(w0.ship!.cloaked).toBe(false);
        const mayFire = (victim: BuiltObject): boolean => scenarioQuery(g, 'attackWithoutWar', false, { empire: st.faction!, target: victim.empire!, attacker: w0.ship!, victim });
        expect(mayFire(hunter)).toBe(true);
        expect(mayFire(bystander)).toBe(false);
        for (const e of normalsOf(g)) expect(atWarWith(e, st.faction!)).toBe(false);
        // the fight is over: back on guard, cloaked
        w0.ship!.xpos = 1;
        w0.ship!.ypos = 1;
        g.nowMs += 20 * GAME_DAY_LENGTH;
        watchersPeriodic(g);
        expect(w0.mode).toBe('guard');
        expect(w0.ship!.cloaked).toBe(true);
        // a lone Watcher guards (corruption pauses); the guard goes home when the scaffold no longer waits
        w1.dead = true;
        w1.mode = 'dead';
        w0.mode = 'parked';
        watchersPeriodic(g);
        expect(w0.mode).toBe('guard');
        gw.progress = 0.5;
        watchersPeriodic(g);
        expect(w0.mode).toBe('return');
    }, 900000);

    it('the dwell grows with the world\'s population (30 to 150 days), a restarted dwell after the Watcher defends itself, and the gap starts after the dwell', () => {
        const { g, st } = rolled();
        expect(dwellDaysFor(g, 1e6)).toBe(30);
        expect(dwellDaysFor(g, 1e11)).toBe(150);
        const mid = dwellDaysFor(g, 1.4e8);
        expect(mid).toBeGreaterThan(60);
        expect(mid).toBeLessThan(120);
        expect(dwellDaysFor(g, 5e8)).toBeGreaterThan(mid);
        const w = st.watchers[0];
        const ship = w.ship!;
        const [a] = normalsOf(g);
        const target = a.colonies[0];
        if (!st.formerIndependents.includes(target)) st.formerIndependents.push(target);
        ship.xpos = target.xpos + 1000;
        ship.ypos = target.ypos + 1000;
        w.target = target;
        w.mode = 'travel';
        w.until = 0;
        watchersPeriodic(g);
        expect(w.mode).toBe('dwell');
        expect(w.dwellDays).toBeCloseTo(dwellDaysFor(g, target.population.totalAmount), 5);
        const dwell = w.dwellDays!;
        const gap0 = w.nextCorruptDate;
        // 20 days in, it is attacked and defends itself: the progress on that world is lost
        g.nowMs += 20 * GAME_DAY_LENGTH;
        const hunter = a.builtObjects.find((o) => !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && o.topSpeed > 0 && o.shipGroup === null)!;
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: ship, attacker: hunter, attackingEmpire: a });
        expect(w.mode).toBe('fight');
        expect(st.stats.dwellResets).toBe(1);
        ship.xpos = 1;
        ship.ypos = 1;
        g.nowMs += 20 * GAME_DAY_LENGTH;
        watchersPeriodic(g);
        expect(w.mode).toBe('dwell');
        const resumedAt = w.modeDate;
        // it needs the whole dwell again from the end of the fight
        ship.xpos = target.xpos + 1000;
        ship.ypos = target.ypos + 1000;
        g.nowMs += (dwell - 1) * GAME_DAY_LENGTH;
        watchersPeriodic(g);
        expect(st.corrupted.some((c) => c.colony === target)).toBe(false);
        g.nowMs += 2 * GAME_DAY_LENGTH;
        watchersPeriodic(g);
        expect(st.corrupted.some((c) => c.colony === target)).toBe(true);
        expect(resumedAt).toBeGreaterThan(0);
        // the 80-160 day gap starts after the dwell finished
        const gap = (w.nextCorruptDate - galaxyStarDate(g)) / GAME_DAY_LENGTH;
        expect(gap).toBeGreaterThanOrEqual(79);
        expect(gap).toBeLessThanOrEqual(161);
        expect(gap0).toBeLessThan(w.nextCorruptDate);
    }, 900000);

    it('the purge: the world rebels (stock rebellion), the owner must win the ground battle; a win ends the corruption and the Watchers must re-seed it; a loss leaves it corrupted', () => {
        const { g, st } = rolled();
        const [a, b] = normalsOf(g);
        const rec = corruptedOwned(g, st, a, 1);
        const h = rec.colony;
        const m = (h.troops?.items.length ?? 0);
        void m;
        expect(startPurge(g, st, rec, b, 1)).toBe(false); // not the owner's
        expect(aiMayPurge(g, rec, 1)).toBe(garrisonStrength(h) >= purgeRebelStrength(g, h, 1) * 1.3);
        expect(startPurge(g, st, rec, a, 1)).toBe(true);
        expect(h.rebelling).toBe(true);
        expect(rebelsOn(g, h)).toBe(12);
        const strength = h.invadingTroops!.totalAttackStrength;
        expect(strength).toBeGreaterThan(purgeRebelStrength(g, h, 1) * 0.9);
        expect(strength).toBeLessThan(purgeRebelStrength(g, h, 1) * 1.1);
        // scales with the population: a full colony 750 thousand, a tiny one the floor, linear between
        const pop = h.population.totalAmount;
        h.population.totalAmount = 2e9;
        expect(purgeRebelStrength(g, h, 1)).toBeCloseTo(750_000, 0);
        h.population.totalAmount = 1e9;
        expect(purgeRebelStrength(g, h, 1)).toBeCloseTo(50_000 + 0.5 * 700_000, 0);
        h.population.totalAmount = 1e5;
        expect(purgeRebelStrength(g, h, 1)).toBeLessThan(52_000);
        expect(purgeRebelStrength(g, h, 0.5)).toBeLessThan(27_000);
        h.population.totalAmount = pop;
        expect(st.stats.purgeTried).toBe(1);
        // the stock ground battle, with an overwhelming garrison
        if (h.troops === null) h.troops = new TroopList();
        for (const t of makeTroopsSplit(g, a, 60_000_000, 30, 'Test garrison', null)) {
            t.colony = h;
            h.troops.add(t);
        }
        for (let i = 0; i < 400 && rebelsOn(g, h) > 0; i++) resolveInvasionBattles(g, h, 20);
        expect(rebelsOn(g, h)).toBe(0);
        expect(h.empire).toBe(a);
        purgePass(g, st);
        expect(rec.ended).toBe('purged');
        expect(st.stats.purged).toBe(1);
        expect(h.rebelling).toBe(false);
        // the Watchers leave it alone for a while, then it can be re-seeded with a new full dwell
        expect(corruptCandidates(g, st)).not.toContain(h);
        g.nowMs += 121 * GAME_DAY_LENGTH;
        expect(corruptCandidates(g, st)).toContain(h);
        expect(corrupt(g, st, h)).not.toBeNull();
        // a lost battle: the world secedes, the corruption stays
        const rec2 = st.corrupted[st.corrupted.length - 1];
        expect(startPurge(g, st, rec2, a, 1)).toBe(true);
        h.empire = g.independentEmpire;
        purgePass(g, st);
        expect(rec2.ended).toBeNull();
        expect(rec2.purge).toBeUndefined();
        expect(st.stats.purgeFailed).toBe(1);
    }, 900000);

    it('the research moratorium: a Diet motion once the Beacon is known; it slows research galaxy-wide, the AI votes by fear and tech race, breakers are called to account then sanctioned', () => {
        const { game } = createScenarioGame(base, { scenario: comboOverlayFs([...ids, 'characters-victory']), flags: { charactersVictory: true, cvCouncil: true, galacticCouncil: true }, options: age3 });
        const g = game.galaxy;
        g.scenario!.flags.gwBeacon = true;
        const site = { id: 0, system: g.systems.find((s) => s !== null)!, habitat: null, base: null, progress: 0, stage: 0, wonder: 'beacon', founders: [], startDate: galaxyStarDate(g), completeDate: null, destroyedBy: null } as GreatWorkSite;
        beaconRolled(g, site);
        const st = peekBeaconState(g)!;
        const members = normalsOf(g);
        const cs = councilState(g);
        const c: Council = { id: cs.nextId++, name: 'Interstellar Diet', foundedYear: 0, members: [...members], chair: null, motion: null, results: [], blocs: [], coLosses: {}, losses: {}, sanctions: [], threats: [], recognised: [], condemned: {}, splitFrom: 0 };
        cs.councils.push(c);
        const dst = dietState(g);
        const def = dietMotionKindDef(MOTION_MORATORIUM)!;
        expect(def).not.toBeNull();
        expect(dietOn(g)).toBe(true);
        // not until someone knows of the Beacon
        expect(def.proposable!(g)).toBe(false);
        const [a, b, d] = members;
        revealTo(g, { knowledge: st.watchers[0].knowledge }, a, KNOWLEDGE_SUSPECTED);
        expect(knowsBeacon(st, a)).toBe(true);
        expect(def.proposable!(g)).toBe(true);
        // AI votes: those who know vote yes; a racer who does not know votes no
        const motion = { id: 1, kind: MOTION_MORATORIUM, proposer: a, target: null, other: null, colony: null, resourceId: -1, text: 't', votes: [], status: 'voting', yes: 0, no: 0 } as never;
        expect(def.voteScore(g, dst, a, motion)).toBeGreaterThan(50);
        revealTo(g, { knowledge: st.watchers[0].knowledge }, b, KNOWLEDGE_SUSPECTED);
        expect(def.voteScore(g, dst, b, motion)).toBeGreaterThan(20);
        const sc = def.voteScore(g, dst, d, motion);
        expect(sc).toBeLessThan(def.voteScore(g, dst, b, motion));
        // passes: a law with a duration, the research slowed by the percentage for everyone but the breakers
        for (const e of members) if (e !== a && e !== b) e.research.techTree.forEach((t) => { if (t.def.techLevel > 3) t.isResearched = false; });
        def.apply(g, dst, motion, (kind, empire, other, colony, until) => {
            const law = { id: 99, kind, empire, other, colony, since: galaxyStarDate(g), until, text: 'law' };
            dst.laws.push(law);
            return law;
        });
        expect(st.stats.moratoriums).toBe(1);
        expect(def.proposable!(g)).toBe(false); // one at a time
        expect(lawInForce(dst, LAW_MORATORIUM)!.until).toBeCloseTo(galaxyStarDate(g) + 720 * GAME_DAY_LENGTH, 0);
        st.moratorium!.breakers = [d.empireId];
        expect(moratoriumFactor(g, a)).toBeCloseTo(0.6, 9);
        expect(moratoriumFactor(g, d)).toBe(1);
        expect(scenarioQuery(g, 'researchPowerFactor', 1, { empire: a, industry: 0 })).toBeCloseTo(0.6, 9);
        expect(scenarioQuery(g, 'researchPowerFactor', 1, { empire: d, industry: 0 })).toBe(1);
        // the breaker is called to account every month and sanctioned at the third breach
        const sanctions = c.sanctions.length;
        const grievance0 = dst.grievances[d.empireId] ?? 0;
        moratoriumMonthly(g);
        moratoriumMonthly(g);
        expect(dst.grievances[d.empireId] ?? 0).toBeGreaterThan(grievance0);
        expect(c.sanctions.length).toBe(sanctions);
        moratoriumMonthly(g);
        expect(st.moratorium!.sanctioned).toEqual([d.empireId]);
        expect(c.sanctions.length).toBeGreaterThan(sanctions);
        expect(st.stats.moratoriumBreaches).toBe(3);
        // it lapses with the law
        dst.laws = [];
        expect(moratoriumFactor(g, a)).toBe(1);
    }, 900000);

    it('a sighting: the Watcher shows itself over a colony, passive, then slips away cloaked; attacked, it defends itself against the attackers only and goes to war with no one', () => {
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
        // (the messages to the human owner and the NewsNet lines are checked in 'Watcher messages')
        // attacked by a: self-defence only. No war is declared or locked with anyone, the cloak stays down while it fights
        const hunter0 = a.builtObjects.find((o) => !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && o.topSpeed > 0 && o.shipGroup === null)!;
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: ship, attacker: hunter0, attackingEmpire: a });
        expect(w.mode).toBe('fight');
        expect(ship.cloaked).toBe(false);
        for (const e of normalsOf(g)) expect(atWarWith(e, st.faction!)).toBe(false);
        expect(obtainDiplomaticRelation(st.faction!, a).locked).toBeFalsy();
        expect(obtainDiplomaticRelation(a, st.faction!).locked).toBeFalsy();
        expect(w.attackedBy).toEqual([a.empireId]);
        // nobody may declare war on the Watchers (or they on anyone) before the Reclamation
        expect(scenarioQuery(g, 'declareWarBlocked', false, { empire: a, target: st.faction! })).toBe(true);
        expect(scenarioQuery(g, 'declareWarBlocked', false, { empire: st.faction!, target: b })).toBe(true);
        expect(scenarioQuery(g, 'declareWarBlocked', false, { empire: a, target: b })).toBe(false);
        // pirates and monsters do not change it
        const w2 = st.watchers[1];
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: w2.ship!, attacker: null, attackingEmpire: g.pirateEmpires[0] ?? null });
        expect(w2.mode).not.toBe('fight');
        // a's warship has been ordered at it (it was in view); it slips out of sight and a loses track
        const hunter = a.builtObjects.find((o) => !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && o.topSpeed > 0 && o.shipGroup === null)!;
        assignMission(g, hunter, BuiltObjectMissionType.Attack, ship, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        expect(builtObjectMission(hunter.mission)?.targetBuiltObject).toBe(ship);
        // with no attacker near and no hit for 15 days it breaks off and goes back to what it was doing (the sighting), then slips away and cloaks
        ship.xpos = 1;
        ship.ypos = 1;
        g.nowMs += 20 * GAME_DAY_LENGTH;
        watchersPeriodic(g);
        expect(w.mode).toBe('sighting');
        expect(w.attackerShips ?? []).toEqual([]);
        g.nowMs += 4 * GAME_DAY_LENGTH;
        watchersPeriodic(g);
        expect(w.mode).toBe('return');
        expect(ship.cloaked).toBe(true);
        expect(builtObjectMission(hunter.mission)?.targetBuiltObject ?? null).not.toBe(ship);
        for (const e of normalsOf(g)) expect(atWarWith(e, st.faction!)).toBe(false);
    }, 900000);

    it('Watcher messages: the first of each kind an empire gets is the first-encounter text and opens its popup; repeats are a seeded random variant, ticker and badge only', () => {
        const { g, st } = rolled();
        const w = st.watchers[0];
        const ship = w.ship!;
        const me = g.playerEmpire!;
        const target = me.colonies[0];
        const tag = (m: { scenarioPopup?: string }): string | undefined => m.scenarioPopup;
        const sighting = (): void => {
            ship.xpos = target.xpos + 1000;
            ship.ypos = target.ypos + 1000;
            w.target = target;
            w.mode = 'travel';
            w.until = -1;
            watchersPeriodic(g);
            expect(w.mode).toBe('sighting');
            g.nowMs += 10 * GAME_DAY_LENGTH;
            watchersPeriodic(g); // the sighting ends: the cloak message
            st.watchers[1].until = 0;
        };
        const before = empireMessages(me).length;
        sighting();
        let msgs = empireMessages(me).slice(before);
        const decloak1 = msgs.find((m) => m.title === 'An unidentified vessel')!;
        expect(decloak1.description).toContain('Something has appeared above');
        expect(tag(decloak1)).toBe('force');
        const cloak1 = msgs.find((m) => m.title === 'It is gone')!;
        expect(cloak1.description).toContain('is gone, and nobody saw it go');
        expect(tag(cloak1)).toBe('force');
        // the second time: a repeat variant, shown but never opened by itself
        const mark = empireMessages(me).length;
        g.nowMs += 300 * GAME_DAY_LENGTH;
        sighting();
        msgs = empireMessages(me).slice(mark);
        const decloak2 = msgs.find((m) => m.title === 'An unidentified vessel')!;
        expect(decloak2.description).toContain('went dark at midday');
        expect(tag(decloak2)).toBe('quiet');
        expect(tag(msgs.find((m) => m.title === 'It is gone')!)).toBe('quiet');
        // the variant pick is deterministic: the same seed and counter give the same variant, and it is one of the listed repeats
        const a = watcherVariant(g, st, 'cloak', me);
        st.rndCounter -= 1;
        expect(watcherVariant(g, st, 'cloak', me)).toBe(a);
        expect(['Repeat 1', 'Repeat 2', 'Repeat 3']).toContain(a);
        // an AI empire gets nothing; a message the routing sees as ticker + badge even where the settings say no
        const ai = normalsOf(g).find((e) => !isHumanEmpire(g, e))!;
        const aiBefore = empireMessages(ai).length;
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: ship, attacker: null, attackingEmpire: ai });
        expect(empireMessages(ai).length).toBe(aiBefore);
        const route = routeEmpireMessage(decloak1, me, defaultMessageOptions());
        expect(route).toMatchObject({ popup: true, ticker: true });
        expect(routeEmpireMessage(decloak2, me, defaultMessageOptions())).toMatchObject({ popup: true, ticker: true }); // (the badge; the UI opens only 'force' by itself)
    }, 900000);

    it('Watcher message throttle: the first detection / decloak / cloak always shows (popup); repeats inside beaconMsgRepeatDays get no ticker message (knowledge and the cloak-seen state still update), then show again', () => {
        const { g, st } = rolled();
        const w = st.watchers[0];
        const ship = w.ship!;
        const me = g.playerEmpire!;
        const target = me.colonies[0];
        const mine = me.builtObjects.find((o) => !o.hasBeenDestroyed)!;
        g.scenario!.params.beaconDetectPct = 100;
        const detect = (): number => {
            ship.cloakSeenBy = [];
            ship.xpos = mine.xpos + 5000;
            ship.ypos = mine.ypos + 5000;
            const n = empireMessages(me).length;
            watchersPeriodic(g);
            expect(cloakLapsedFor(ship, me, galaxyStarDate(g))).toBe(true); // (the cloak-seen state updates whatever the messages do)
            return empireMessages(me).slice(n).filter((m) => m.title === 'Something in the dark').length;
        };
        const d1 = detect();
        expect(d1).toBe(1);
        const first = empireMessages(me).filter((m) => m.scenarioPopup === 'force').length;
        expect(first).toBeGreaterThanOrEqual(1);
        const lvl = knowledgeLevel({ knowledge: w.knowledge }, me);
        // 30 days later: another detection, no new message; the knowledge rises
        g.nowMs += 30 * GAME_DAY_LENGTH;
        expect(detect()).toBe(0);
        expect(knowledgeLevel({ knowledge: w.knowledge }, me)).toBeGreaterThanOrEqual(lvl);
        expect(w.detections).toBe(2);
        // after the window: a repeat message again (quiet, no popup)
        g.nowMs += 125 * GAME_DAY_LENGTH;
        const n3 = empireMessages(me).length;
        expect(detect()).toBe(1);
        expect(empireMessages(me).slice(n3).every((m) => m.scenarioPopup !== 'force')).toBe(true);
        // the sighting messages (per world): a second sighting of the same world inside the window is not sent
        const sighting = (): void => {
            ship.xpos = target.xpos + 1000;
            ship.ypos = target.ypos + 1000;
            w.target = target;
            w.mode = 'travel';
            w.until = -1;
            watchersPeriodic(g);
            g.nowMs += 10 * GAME_DAY_LENGTH;
            watchersPeriodic(g);
            st.watchers[1].until = 0;
        };
        const nowS = empireMessages(me).length;
        sighting();
        const s1 = empireMessages(me).slice(nowS).filter((m) => m.title === 'An unidentified vessel' || m.title === 'It is gone').length;
        expect(s1).toBe(2);
        g.nowMs += 30 * GAME_DAY_LENGTH;
        const nowS2 = empireMessages(me).length;
        sighting();
        expect(empireMessages(me).slice(nowS2).filter((m) => m.title === 'An unidentified vessel' || m.title === 'It is gone').length).toBe(0);
        g.nowMs += 130 * GAME_DAY_LENGTH;
        const nowS3 = empireMessages(me).length;
        sighting();
        expect(empireMessages(me).slice(nowS3).filter((m) => m.title === 'An unidentified vessel' || m.title === 'It is gone').length).toBe(2);
    }, 900000);

    it('self-defence: an attacked Watcher may fire only at the ships that attacked it and their fleets; it breaks off, resumes its dwell and cloaks, with no war', () => {
        const { g, st } = rolled();
        const w = st.watchers[0];
        const ship = w.ship!;
        const [a, b] = normalsOf(g);
        const target = a.colonies[0];
        ship.xpos = target.xpos + 1000;
        ship.ypos = target.ypos + 1000;
        w.target = target;
        w.mode = 'travel';
        w.until = 0;
        watchersPeriodic(g);
        expect(w.mode).toBe('dwell');
        const ships = a.builtObjects.filter((o) => !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && o.topSpeed > 0);
        expect(ships.length).toBeGreaterThanOrEqual(2);
        const [culprit, other] = ships;
        const bShip = b.builtObjects.find((o) => !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && o.topSpeed > 0)!;
        const mayFire = (victim: BuiltObject): boolean => scenarioQuery(g, 'attackWithoutWar', false, { empire: st.faction!, target: victim.empire!, attacker: ship, victim });
        // not attacked: it fires at no one
        expect(mayFire(culprit)).toBe(false);
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: ship, attacker: culprit, attackingEmpire: a });
        expect(w.mode).toBe('fight');
        expect(w.prevMode).toBe('dwell');
        // only the attacker (and a ship sailing with it) is a target: not another ship of the same empire, nor any ship of another empire
        expect(mayFire(culprit)).toBe(true);
        expect(mayFire(other)).toBe(false);
        expect(mayFire(bShip)).toBe(false);
        const fleetmate = other;
        const sg = { ships: [culprit, fleetmate] };
        const old = (fleetmate as { shipGroup: unknown }).shipGroup;
        (fleetmate as { shipGroup: unknown }).shipGroup = sg;
        expect(mayFire(fleetmate)).toBe(true);
        (fleetmate as { shipGroup: unknown }).shipGroup = old;
        // an attacker from another empire joins the list; the other empire's bystanders stay safe
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: ship, attacker: bShip, attackingEmpire: b });
        expect(mayFire(bShip)).toBe(true);
        for (const e of normalsOf(g)) expect(atWarWith(e, st.faction!)).toBe(false);
        // the fight ends 15 days after the last hit with no attacker near: back to the dwell, cloaked again, the attackers forgotten
        ship.xpos = 1;
        ship.ypos = 1;
        g.nowMs += 20 * GAME_DAY_LENGTH;
        watchersPeriodic(g);
        expect(w.mode).toBe('dwell');
        expect(ship.cloaked).toBe(true);
        expect(mayFire(culprit)).toBe(false);
        expect(w.target).toBe(target);
        for (const e of normalsOf(g)) expect(atWarWith(e, st.faction!)).toBe(false);
        // after the Reclamation nothing changes: the faction is at war with everyone and the Watcher keeps its fleet
        const r = completed();
        const rw = r.st.watchers[0];
        expect(rw.mode).toBe('lead');
        scenarioEmit(r.g, 'builtObjectAttacked', { builtObject: rw.ship!, attacker: null, attackingEmpire: normalsOf(r.g)[0] });
        expect(rw.mode).toBe('lead');
        for (const e of normalsOf(r.g)) expect(atWarWith(e, r.st.faction!)).toBe(true);
    }, 1800000);


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

    it('Watcher fleets: each Watcher leads the escorts of one of the two biggest strike groups, defends the cores, and goes on an offensive only every 3 to 4 years; a dead Watcher\'s fleet reverts', () => {
        const { g, st } = completed();
        const f = st.faction!;
        f.stateMoney = 1e9;
        g.scenario!.params.beaconFundingModel = 1;
        g.scenario!.params.beaconGroups = 4;
        g.scenario!.params.beaconStrengthPct = 400; // (max-tech ships are big: a season has to be able to buy several of them per group)
        const t0 = galaxyStarDate(g);
        // the Reclamation made them flagships: no routine of their own, uncloaked, the first offensive 3 to 4 years away
        expect(st.watcherFleets).toHaveLength(2);
        for (const w of st.watchers) {
            expect(w.mode).toBe('lead');
            expect(w.ship!.cloaked).toBe(false);
        }
        for (const fl of st.watcherFleets!) {
            expect(fl.mode).toBe('defence');
            expect(fl.nextOffensive).toBeGreaterThanOrEqual(t0 + 3 * 360 * GAME_DAY_LENGTH - 1);
            expect(fl.nextOffensive).toBeLessThanOrEqual(t0 + 4 * 360 * GAME_DAY_LENGTH + 1);
        }
        // season 1: at the departure the two biggest groups become the Watcher fleets' escorts and stay; the rest depart as before
        expect(beginSeason(g, st, 1)).toBe(true);
        const season = st.season!;
        expect(season.groups.length).toBeGreaterThanOrEqual(3);
        const calc = calculateOverallStrengthFactorWithoutShields;
        let snap: { grp: (typeof season.groups)[number]; ships: BuiltObject[]; s: number }[] = [];
        for (let i = 0; i < 160 && season.phase === 'prep'; i++) {
            snap = season.groups.map((grp) => ({ grp, ships: [...grp.ships], s: grp.ships.reduce((a, b) => a + (b.hasBeenDestroyed ? 0 : Math.max(0, calc(b))), 0) }));
            g.nowMs += 5 * GAME_DAY_LENGTH;
            reclamationPeriodic(g);
        }
        expect(season.phase).toBe('offensive');
        const top2 = [...snap].sort((x, y) => y.s - x.s).slice(0, 2);
        for (const fl of st.watcherFleets!) {
            expect(fl.ships.length).toBeGreaterThan(0);
            expect(top2.some((t) => fl.ships.every((b) => t.ships.includes(b)))).toBe(true);
        }
        expect(top2.map((t) => t.grp.state)).toEqual(['done', 'done']);
        expect(season.groups.some((x) => x.state === 'travel')).toBe(true);
        expect(st.stats.wfFormed).toBe(2);
        // DEFENCE: they patrol the Beacon's star until a core exists, then the cores (one each, the Watcher with its escorts)
        const [f0, f1] = st.watcherFleets!;
        const w0 = st.watchers[0].ship!;
        driveWatcherFleets(g, st, galaxyStarDate(g));
        expect(f0.post).toBe(st.site!.system.systemStar);
        for (const b of [w0, ...f0.ships]) {
            const m = builtObjectMission(b.mission);
            expect(m?.type).toBe(BuiltObjectMissionType.Patrol);
            expect(m?.targetHabitat).toBe(f0.post);
        }
        const victim = normalsOf(g)[0];
        const [first, second] = victim.colonies.filter((c) => c !== victim.capital && c.population.totalAmount > 0).slice(0, 2);
        takeOwnershipOfColonyFull(g, victim, first, f, false, false);
        takeOwnershipOfColonyFull(g, victim, second, f, false, false);
        harvestPeriodic(g, st);
        expect(liveCores(st).length).toBeGreaterThanOrEqual(1);
        driveWatcherFleets(g, st, galaxyStarDate(g));
        expect(f0.post).toBe(liveCores(st)[0].colony);
        expect(builtObjectMission(w0.mission)?.targetHabitat).toBe(f0.post);
        // an enemy warship near a core draws the nearest fleet there
        const intruder = victim.builtObjects.find((o) => !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && o.topSpeed > 0)!;
        const coreWorld = liveCores(st)[0].colony;
        intruder.xpos = coreWorld.xpos + 2000;
        intruder.ypos = coreWorld.ypos + 2000;
        const responses = st.stats.wfResponses ?? 0;
        driveWatcherFleets(g, st, galaxyStarDate(g));
        expect([f0.post, f1.post]).toContain(coreWorld);
        expect(st.stats.wfResponses ?? 0).toBeGreaterThanOrEqual(responses);
        intruder.xpos = 1;
        intruder.ypos = 1;
        // NO OFFENSIVE before the date, whatever the targets: they keep to their cores
        g.scenario!.params.beaconWatcherFleetMinTargetValue = 0;
        g.scenario!.params.beaconWatcherFleetRatioPct = 0;
        g.scenario!.params.beaconWatcherFleetReachSectors = 100000;
        g.nowMs = f0.nextOffensive - 2 * GAME_DAY_LENGTH;
        driveWatcherFleets(g, st, galaxyStarDate(g));
        expect(f0.mode).toBe('defence');
        expect(f1.mode).toBe('defence');
        expect(st.stats.wfOffensives ?? 0).toBe(0);
        // ... and once the date has come the fleet goes after the most valuable world within reach, once. (Not while enemy warships are at the core it holds.)
        g.nowMs = Math.max(f0.nextOffensive, f1.nextOffensive) + GAME_DAY_LENGTH;
        const near = (fl: typeof f0): number => enemyNear(fl.post!);
        const enemyNear = (h: Habitat): number => normalsOf(g).reduce((n, e) => n + e.builtObjects.filter((o) => !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && g.calculateDistance(o.xpos, o.ypos, h.xpos, h.ypos) < 45000).length, 0);
        const guarded = near(f0) > 0 || near(f1) > 0;
        driveWatcherFleets(g, st, galaxyStarDate(g));
        if (guarded) expect([f0, f1].filter((x) => near(x) > 0).every((x) => x.mode === 'defence')).toBe(true);
        for (const e of normalsOf(g)) for (const o of e.builtObjects) if (!o.hasBeenDestroyed && o.role === BuiltObjectRole.Military) { o.xpos = 1; o.ypos = 1; }
        driveWatcherFleets(g, st, galaxyStarDate(g));
        const went = [f0, f1].filter((x) => x.mode === 'offensive');
        expect(went.length).toBeGreaterThanOrEqual(1);
        const off = went[0];
        expect(off.target).not.toBeNull();
        expect(off.target!.empire).not.toBe(f);
        expect(builtObjectMission(st.watchers[off.index].ship!.mission)?.type).toBe(BuiltObjectMissionType.Attack);
        expect(off.offensives).toBe(1);
        expect(watcherTargetValue(g, st, off.target!)).toBeGreaterThanOrEqual(0);
        // it ends after the offensive cap; the next one is 3 to 4 years later and the fleet is back on defence
        const end = galaxyStarDate(g) + 250 * GAME_DAY_LENGTH;
        g.nowMs += 250 * GAME_DAY_LENGTH;
        driveWatcherFleets(g, st, galaxyStarDate(g));
        expect(off.mode).toBe('defence');
        expect(off.nextOffensive).toBeGreaterThanOrEqual(end + 3 * 360 * GAME_DAY_LENGTH - 1);
        expect(off.nextOffensive).toBeLessThanOrEqual(end + 4 * 360 * GAME_DAY_LENGTH + 1);
        // a dead Watcher: its fleet is a normal fleet again (home, then the next season's groups)
        const dying = st.watchers[f1.index];
        const escorts = [...f1.ships];
        dying.ship!.hasBeenDestroyed = true;
        watchersPeriodic(g);
        expect(dying.dead).toBe(true);
        driveWatcherFleets(g, st, galaxyStarDate(g));
        expect(st.watcherFleets).toHaveLength(1);
        for (const b of escorts) if (!b.hasBeenDestroyed) expect(st.reserve).toContain(b);
        expect(st.stats.wfReverted).toBe(1);
    }, 1800000);

    it('the harvest: the first conquest becomes a core with a harvester; the other held worlds send their people in cattle ships to its pens; processing makes biofuel and counts as eliminated', () => {
        const { g, st } = completed();
        const f = st.faction!;
        const victim = normalsOf(g)[0];
        const worlds = victim.colonies.filter((c) => c !== victim.capital && c.population.totalAmount > 0).slice(0, 3);
        expect(worlds.length).toBeGreaterThanOrEqual(2);
        const [first, second] = worlds;
        takeOwnershipOfColonyFull(g, victim, first, f, false, false);
        harvestPeriodic(g, st);
        const core = liveCores(st)[0];
        expect(core.colony).toBe(first);
        expect(st.coreWorlds).toEqual([first]);
        expect(core.harvester).not.toBeNull();
        expect(core.harvester!.actualEmpire).toBe(f);
        expect(beaconShipRole(st, core.harvester!)).toBe('harvester');
        // a second held world is a feeder (one core per three held worlds): its first cattle ship leaves within the interval
        const pop2 = second.population.totalAmount;
        takeOwnershipOfColonyFull(g, victim, second, f, false, false);
        shuttleUntil(g, st, () => laden(st).length > 0);
        expect(liveCores(st)).toHaveLength(1);
        const cattle = laden(st)[0];
        expect(cattle.from).toBe(second);
        expect(cattle.core).toBe(first);
        expect(cattle.total).toBeGreaterThan(0);
        expect(second.population.totalAmount).toBeLessThan(pop2); // they leave at the launch
        expect(beaconShipRole(st, cattle.ship)).toBe('cattle');
        expect(cattle.ship.subRole).toBe(BuiltObjectSubRole.LargeFreighter);
        // its hyperdrive spools beaconCattleSpoolSeconds (120 s) before each jump, whatever the jump rolled, and a reDefine does not undo it; warp speed untouched
        const warp0 = cattle.ship.warpSpeed;
        const spoolMs = (baseMs?: number): number => {
            const base = baseMs ?? cattle.ship.hyperjumpInitiate * 1000;
            return base * scenarioQuery(g, 'hyperjumpSpoolFactor', 1, { ship: cattle.ship, here: true, baseMs });
        };
        expect(cattle.ship.hyperjumpInitiate).toBeGreaterThan(0);
        expect(spoolMs()).toBeCloseTo(120000, 3);
        expect(spoolMs(9300)).toBeCloseTo(120000, 3); // (the jump's own +-1 s roll)
        cattle.ship.reDefine();
        expect(spoolMs()).toBeCloseTo(120000, 3);
        expect(cattle.ship.warpSpeed).toBe(warp0);
        expect(scenarioQuery(g, 'hyperjumpSpoolFactor', 1, { ship: core.harvester!, here: true })).toBe(1); // only cattle ships
        g.scenario!.params.beaconCattleSpoolSeconds = 60;
        expect(spoolMs()).toBeCloseTo(60000, 3);
        delete g.scenario!.params.beaconCattleSpoolSeconds;
        const elim0 = st.popEliminated;
        // it docks: the people are penned at the core (not yet eliminated)
        const carried = cattle.total;
        cattle.ship.xpos = first.xpos + 1000;
        cattle.ship.ypos = first.ypos;
        harvestPeriodic(g, st);
        // ... and the ship stays: a pool ship of the core, empty, waiting for its next run
        expect(cattleOf(st).includes(cattle)).toBe(true);
        expect(cattle.ship.hasBeenDestroyed).toBe(false);
        expect(cattle.phase).toBe('idle');
        expect(cattle.total).toBe(0);
        expect(cattle.load).toEqual([]);
        expect(core.waiting).toBe(carried);
        expect(st.stats.cattleArrived).toBe(1);
        expect(st.popEliminated).toBe(elim0);
        // nothing is processed while the harvester is being built (beaconCoreBuildDays)
        expect(harvestMonthly(g, st)).toBe(0);
        g.nowMs = core.readyDate! + GAME_DAY_LENGTH;
        // processing: a share of the pens (and of the core's own people) becomes biofuel, and the processed are eliminated
        const fuel0 = fuelOf(st).income;
        const done = harvestMonthly(g, st);
        expect(done).toBeGreaterThan(0);
        expect(core.waiting).toBeLessThan(carried);
        expect(st.popEliminated).toBe(elim0 + done);
        expect(fuelOf(st).income).toBeGreaterThan(fuel0);
        expect(st.stats.processed).toBe(done);
    }, 900000);

    /** A Reclaimer holding `n` more worlds than its one core: [core, ...feeders]. */
    function heldWorlds(g: Galaxy, st: BeaconState, n: number): Habitat[] {
        g.scenario!.params.beaconCoreWorldsPer = 20; // one core
        const victim = normalsOf(g)[0];
        const worlds = victim.colonies.filter((c) => c !== victim.capital && c.population.totalAmount > 0).slice(0, n + 1);
        expect(worlds.length).toBe(n + 1);
        for (const w of worlds) takeOwnershipOfColonyFull(g, victim, w, st.faction!, false, false);
        harvestPeriodic(g, st);
        return worlds;
    }

    it('the cattle shuttle: a pool ship flies to a held world, loads for beaconCattleLoadDays, flies the people to the core, unloads and goes back for the next run; worlds are served fairly, about every beaconCattleDays', () => {
        const { g, st } = completed();
        g.scenario!.params.beaconCattlePoolWorldsPer = 3; // one ship for the three feeders
        const [first, ...feeders] = heldWorlds(g, st, 3);
        expect(liveCores(st)[0].colony).toBe(first);
        const core = liveCores(st)[0];
        expect(feedersOf(g, st).get(first)).toHaveLength(3);
        expect(poolTarget(g, 3)).toBe(1);
        harvestPeriodic(g, st);
        const pool = poolOf(st, first);
        expect(pool).toHaveLength(1); // one ship, whatever the number of runs
        const ship = pool[0];
        expect(ship.phase).toBe('idle'); // (spawned at the core)
        expect(st.stats.cattleSpawned).toBe(1);
        const pops = feeders.map((w) => w.population.totalAmount);
        const seen: Habitat[] = [];
        let penned = 0;
        // run it for a year: each step it is put where it was sent (the sim does not fly it here)
        let lastPhase = ship.phase;
        for (let i = 0; i < 120; i++) {
            g.nowMs += 3 * GAME_DAY_LENGTH;
            if (ship.phase === 'out') {
                ship.ship.xpos = ship.from.xpos + 1000;
                ship.ship.ypos = ship.from.ypos;
            } else if (ship.phase === 'in') {
                ship.ship.xpos = first.xpos + 1000;
                ship.ship.ypos = first.ypos;
            }
            const before = core.received;
            harvestPeriodic(g, st);
            if (ship.phase !== lastPhase && ship.phase === 'loading') {
                expect(ship.ship.xpos).toBeCloseTo(ship.from.xpos + 1000, 0);
                expect(ship.loadUntil).toBeCloseTo(galaxyStarDate(g) + 3 * GAME_DAY_LENGTH, -2); // beaconCattleLoadDays
                expect(ship.total).toBe(0); // nobody aboard until the loading is done
                seen.push(ship.from);
            }
            if (ship.phase === 'in' && lastPhase === 'loading') expect(ship.total).toBeGreaterThan(0);
            if (core.received > before) penned += core.received - before;
            lastPhase = ship.phase;
            expect(cattleOf(st)).toContain(ship); // it persists
            expect(ship.ship.hasBeenDestroyed).toBe(false);
        }
        // every feeder was served, several times, by the one ship; the people left their worlds and sit in the pens
        for (const w of feeders) expect(seen.filter((x) => x === w).length).toBeGreaterThanOrEqual(2);
        expect(st.stats.cattleLaunched).toBeGreaterThanOrEqual(6);
        expect(st.stats.cattleArrived).toBeGreaterThanOrEqual(5);
        expect(penned).toBeGreaterThan(0);
        feeders.forEach((w, k) => expect(w.population.totalAmount).toBeLessThan(pops[k]));
        // the loop alternates: no world is served twice in a row while others wait (fair order)
        for (let k = 3; k < seen.length; k++) expect(new Set(seen.slice(k - 3, k)).size).toBe(3);
        // about one run per world per beaconCattleDays (20): a year = 18 collections a world at most
        expect(seen.length).toBeLessThanOrEqual(3 * 19);
    }, 900000);

    it('cattle repair: a damaged pool ship waits at its core and is not sent out; it mends slowly (away from the core, slower still); a hurt outbound ship turns back', () => {
        const { g, st } = completed();
        const [first, second] = heldWorlds(g, st, 1);
        harvestPeriodic(g, st);
        const c = poolOf(st, first)[0];
        expect(c.phase).toBe('idle');
        // the other machines mend 4 x in the field
        const hv = liveCores(st)[0].harvester!;
        expect(scenarioQuery(g, 'repairRateFactor', 1, { builtObject: hv })).toBe(4);
        expect(cattleRepairFactor(g, c.ship)).toBe(1);
        expect(scenarioQuery(g, 'repairRateFactor', 1, { builtObject: c.ship })).toBe(1); // slow at the core
        c.ship.xpos += 200000;
        expect(scenarioQuery(g, 'repairRateFactor', 1, { builtObject: c.ship })).toBeCloseTo(0.1, 9); // slower in the field
        c.ship.xpos -= 200000;
        // hurt past beaconCattleRepairDamagePct (20 %): it stays, however due the world is
        const parts = c.ship.components.items;
        for (let i = 0; i < Math.ceil(parts.length * 0.4); i++) parts[i].status = ComponentStatus.Damaged;
        c.ship.reDefine();
        expect(cattleDamage(c.ship)).toBeGreaterThan(0.2);
        second.population.totalAmount; // (due: the first convoy date is within the interval)
        for (let i = 0; i < 12; i++) {
            g.nowMs += 5 * GAME_DAY_LENGTH;
            harvestPeriodic(g, st);
        }
        expect(c.phase).toBe('idle');
        expect(st.stats.cattleLaunched ?? 0).toBe(0);
        // mended: it goes
        for (const p of parts) p.status = ComponentStatus.Normal;
        c.ship.reDefine();
        expect(cattleDamage(c.ship)).toBe(0);
        shuttleUntil(g, st, () => c.phase !== 'idle', 4);
        expect(c.phase).toBe('out');
        expect(c.from).toBe(second);
        // hurt badly on the way out: it goes home, nobody is taken
        for (let i = 0; i < Math.ceil(parts.length * 0.7); i++) parts[i].status = ComponentStatus.Damaged;
        c.ship.reDefine();
        g.nowMs += 3 * GAME_DAY_LENGTH;
        harvestPeriodic(g, st);
        expect(c.phase).toBe('home');
        expect(st.stats.cattleRunsAborted).toBe(1);
        expect(c.total).toBe(0);
        // back at the core it is idle
        c.ship.xpos = first.xpos + 1000;
        c.ship.ypos = first.ypos;
        harvestPeriodic(g, st);
        expect(c.phase).toBe('idle');
    }, 900000);

    it('cattle losses: a destroyed pool ship is a real loss; the Reclaimers rebuild it from their biofuel after beaconCattleBuildDays, and until then the harvest is thinner; no biofuel, no replacement', () => {
        const { g, st } = completed();
        const other = normalsOf(g)[1];
        const [first] = heldWorlds(g, st, 3);
        g.scenario!.params.beaconCattlePoolWorldsPer = 1; // three feeders: three ships
        fuelOf(st).fleet = 0;
        for (let i = 0; i < 6; i++) {
            g.nowMs += 3 * GAME_DAY_LENGTH;
            harvestPeriodic(g, st);
        }
        expect(poolOf(st, first)).toHaveLength(3);
        const t0 = galaxyStarDate(g);
        const victim = poolOf(st, first)[0];
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: victim.ship, destroyer: other });
        expect(poolOf(st, first)).toHaveLength(2);
        expect(st.stats.cattleKilled).toBe(1);
        expect(st.stats.cattleOrdered).toBe(1);
        expect(st.cattleOrders).toHaveLength(1);
        // no biofuel: the order waits unpaid, the pool does not grow back on its own
        g.nowMs += 90 * GAME_DAY_LENGTH;
        harvestPeriodic(g, st);
        expect(poolOf(st, first)).toHaveLength(2);
        expect(st.cattleOrders![0].paid).toBe(false);
        expect(st.stats.cattleRebuilt ?? 0).toBe(0);
        // paid: the build clock starts then; nothing before beaconCattleBuildDays (60) are over
        fuelOf(st).fleet = 1e12;
        const fleet0 = fuelOf(st).fleet;
        harvestPeriodic(g, st);
        expect(st.cattleOrders![0].paid).toBe(true);
        expect(fuelOf(st).fleet).toBeLessThan(fleet0);
        expect(st.cattleOrders![0].ready).toBeCloseTo(galaxyStarDate(g) + 60 * GAME_DAY_LENGTH, -2);
        g.nowMs += 50 * GAME_DAY_LENGTH;
        harvestPeriodic(g, st);
        expect(poolOf(st, first)).toHaveLength(2);
        g.nowMs += 11 * GAME_DAY_LENGTH;
        harvestPeriodic(g, st);
        expect(poolOf(st, first)).toHaveLength(3);
        expect(st.stats.cattleRebuilt).toBe(1);
        expect(st.cattleOrders).toHaveLength(0);
        void t0;
        // a boarded ship (empty, or laden: the captives all go free) is a loss too
        const [b1] = laden(st).length > 0 ? laden(st) : [poolOf(st, first)[0]];
        const ordered = st.stats.cattleOrdered!;
        rescueCattle(g, st, b1.ship, other);
        expect(st.stats.cattleBoarded).toBe(1);
        expect(st.stats.cattleOrdered).toBe(ordered + 1);
        expect(cattleOf(st)).not.toContain(b1);
    }, 900000);

    it('cattle old saves: a one-way ship in flight becomes a pool ship of its core (it docks, then stays); an empty one is idle; saves hold the pool, its phases and the orders', () => {
        const { g, st, game, gameData } = completed();
        const [first, second] = heldWorlds(g, st, 2);
        const core = liveCores(st)[0];
        const f = st.faction!;
        // the old record: no phase, people aboard, no orders
        const mk = (): BuiltObject => spawnShip(g, f, cattleDesign(g, f)!, second.xpos, second.ypos);
        const race = second.population.dominantRace!.name;
        const old: CattleRec = { ship: mk(), from: second, core: first, load: [{ race, amount: 3_000_000 }], total: 3_000_000, launched: galaxyStarDate(g) };
        const oldEmpty: CattleRec = { ship: mk(), from: second, core: first, load: [], total: 0, launched: galaxyStarDate(g) };
        st.cattle = [old, oldEmpty];
        delete st.cattleOrders;
        cattleStep(g, st);
        expect(old.phase).toBe('in');
        expect(oldEmpty.phase).toBe('idle');
        expect(cattleOf(st)).toContain(old);
        const waiting = core.waiting;
        old.ship.xpos = first.xpos + 1000;
        old.ship.ypos = first.ypos;
        cattleStep(g, st);
        expect(core.waiting).toBe(waiting + 3_000_000);
        expect(old.phase).toBe('idle');
        expect(old.total).toBe(0);
        expect(old.ship.hasBeenDestroyed).toBe(false);
        expect(poolOf(st, first)).toContain(old);
        // the save round trip: a laden ship, a loading one, an idle one and an order
        old.phase = 'in';
        old.load = [{ race, amount: 2_000_000 }];
        old.total = 2_000_000;
        old.from = second;
        old.ship.xpos = second.xpos;
        old.ship.ypos = second.ypos;
        oldEmpty.phase = 'loading';
        oldEmpty.from = second;
        oldEmpty.loadUntil = galaxyStarDate(g) + 2 * GAME_DAY_LENGTH;
        st.cattleOrders = [{ core: first, paid: true, ready: galaxyStarDate(g) + 30 * GAME_DAY_LENGTH }];
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const lg = deserializeGame(text, gameData).game.galaxy;
        const ls = peekBeaconState(lg)!;
        expect(cattleOf(ls)).toHaveLength(cattleOf(st).length);
        const lo = cattleOf(ls).find((c) => c.ship.builtObjectID === old.ship.builtObjectID)!;
        expect(lo.phase).toBe('in');
        expect(lo.total).toBe(2_000_000);
        expect(lo.load).toEqual([{ race, amount: 2_000_000 }]);
        expect(lo.core.habitatIndex).toBe(first.habitatIndex);
        expect(lo.from.habitatIndex).toBe(second.habitatIndex);
        const le = cattleOf(ls).find((c) => c.ship.builtObjectID === oldEmpty.ship.builtObjectID)!;
        expect(le.phase).toBe('loading');
        expect(le.loadUntil).toBe(oldEmpty.loadUntil);
        expect(ls.cattleOrders).toHaveLength(1);
        expect(ls.cattleOrders![0].paid).toBe(true);
        expect(ls.cattleOrders![0].core.habitatIndex).toBe(first.habitatIndex);
        expect(beaconShipRole(ls, lo.ship)).toBe('cattle');
        // and the loaded game goes on with the loop
        lg.nowMs += 3 * GAME_DAY_LENGTH;
        cattleStep(lg, ls);
        expect(cattleOf(ls)).toContain(lo);
    }, 900000);

    it('cattle escorts: free warships (the reserve) are ordered to escort, else escorts are built from the biofuel; the world with the most interceptions gets destroyers, then cruisers; the counts decay; the escorts return to patrol when the ship docks', () => {
        const { g, st } = completed();
        const f = st.faction!;
        const victim = normalsOf(g)[0];
        const worlds = victim.colonies.filter((c) => c !== victim.capital && c.population.totalAmount > 0).slice(0, 3);
        expect(worlds.length).toBeGreaterThanOrEqual(3);
        for (const w of worlds) takeOwnershipOfColonyFull(g, victim, w, f, false, false);
        fuelOf(st).fleet = 1e9;
        // a free frigate in the reserve is taken before anything is built
        const frigateDesign = designFor(g, f, BuiltObjectSubRole.Frigate)!;
        const spare = spawnShip(g, f, frigateDesign, worlds[1].xpos, worlds[1].ypos);
        st.reserve.push(spare);
        harvestPeriodic(g, st);
        shuttleUntil(g, st, () => laden(st).length > 0);
        const c1 = laden(st)[0];
        expect(c1.escorts!.length).toBeGreaterThanOrEqual(1);
        expect(c1.escorts!.length).toBeLessThanOrEqual(2);
        for (const b of c1.escorts!) {
            expect(b.subRole).toBe(BuiltObjectSubRole.Frigate);
            const m = builtObjectMission(b.mission);
            expect(m?.type).toBe(BuiltObjectMissionType.Escort);
            expect(m?.targetBuiltObject).toBe(c1.ship);
        }
        expect(c1.escorts).toContain(spare);
        expect(st.reserve).not.toContain(spare);
        expect(st.stats.escortLight).toBe(1);
        // escalation: the world with the most interceptions sends destroyers, then cruisers; the others stay light
        const a = c1.from;
        const b = worlds.find((w) => w !== a && w !== c1.core)!;
        expect(escortPlan(g, st, a, 0)).toEqual({ tier: 0, count: 1 });
        noteIntercept(g, st, a);
        expect(escortPlan(g, st, a, 0)).toEqual({ tier: 1, count: 2 });
        expect(escortPlan(g, st, b, 0).tier).toBe(0);
        noteIntercept(g, st, a);
        noteIntercept(g, st, a);
        expect(escortPlan(g, st, a, 0)).toEqual({ tier: 2, count: 2 });
        noteIntercept(g, st, b);
        noteIntercept(g, st, b);
        noteIntercept(g, st, b);
        noteIntercept(g, st, b);
        expect(escortPlan(g, st, b, 0).tier).toBe(2); // now b leads
        expect(escortPlan(g, st, a, 0).tier).toBe(0);
        expect(escortPlan(g, st, a, 0).count).toBe(2);
        // a real cattle ship from the leader gets built cruisers (none are free)
        const built0 = st.stats.escortBuilt ?? 0;
        const c2: CattleRec = { ship: spawnShip(g, f, cattleDesign(g, f)!, b.xpos, b.ypos), from: b, core: c1.core, load: [], total: 1, launched: galaxyStarDate(g) };
        assignEscorts(g, st, c2);
        expect(c2.escorts).toHaveLength(2);
        expect(c2.escorts!.every((x) => x.subRole === BuiltObjectSubRole.Cruiser)).toBe(true);
        expect(st.stats.escortBuilt).toBe(built0 + 2);
        expect(st.stats.escortHeavy).toBe(1);
        // no biofuel: it steps down to what it can have
        const c3 = { ...c2, escorts: undefined, built: undefined };
        fuelOf(st).fleet = 0;
        assignEscorts(g, st, c3 as never);
        expect(c3.escorts ?? []).toHaveLength(0);
        // the counts decay slowly
        g.nowMs += 360 * GAME_DAY_LENGTH;
        harvestPeriodic(g, st);
        expect(interceptsAt(st, a)).toBeCloseTo(2, 0);
        expect(interceptsAt(st, b)).toBeCloseTo(3, 0);
        // docked: the escorts go back to patrol and are free again
        const escorts = [...c1.escorts!];
        c1.ship.xpos = c1.core.xpos + 1000;
        c1.ship.ypos = c1.core.ypos;
        harvestPeriodic(g, st);
        expect(c1.escorts).toEqual([]);
        for (const e of escorts) {
            expect(builtObjectMission(e.mission)?.type).toBe(BuiltObjectMissionType.Patrol);
            expect(st.reserve).toContain(e);
        }
    }, 900000);

    it('counterplay on the harvest: retaking a core frees its pens to the liberator; a destroyed cattle ship kills its captives (not counted as eliminated by default); a boarded one frees them; a destroyed harvester breaks the core', () => {
        const { g, st } = completed();
        const f = st.faction!;
        const [victim, other] = normalsOf(g);
        const worlds = victim.colonies.filter((c) => c !== victim.capital && c.population.totalAmount > 0).slice(0, 3);
        expect(worlds.length).toBeGreaterThanOrEqual(3);
        for (const w of worlds) takeOwnershipOfColonyFull(g, victim, w, f, false, false);
        harvestPeriodic(g, st);
        const core = liveCores(st)[0];
        core.pens = [{ race: core.colony.population.dominantRace!.name, amount: 500_000_000 }];
        core.waiting = 500_000_000;
        // a cattle ship destroyed: its captives die (eliminated), no core is touched
        g.scenario!.params.beaconCattlePoolWorldsPer = 1; // a ship a feeder: two laden ships at once
        shuttleUntil(g, st, () => laden(st).length >= 2);
        expect(laden(st).length).toBeGreaterThanOrEqual(2);
        const [c1, c2, c3] = laden(st);
        const elim = st.popEliminated;
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: c1.ship, destroyer: other });
        expect(st.popEliminated).toBe(elim); // the interceptors killed them, not the Reclaimers (beaconCattleDeadCountPct 0)
        expect(st.stats.cattleKilled).toBe(1);
        // 70 % of the captives escape in pods (to the world they came from, which the Reclaimers hold: the nearest free colony), the rest die
        expect(st.stats.captivesRescued).toBeGreaterThan(0.6 * c1.total);
        expect(st.stats.captivesRescued).toBeLessThanOrEqual(0.7 * c1.total + 1);
        expect(st.stats.captivesKilled! + st.stats.captivesRescued!).toBeCloseTo(c1.total, 0);
        expect(podWorld(g, st, c1, c1.ship)!.empire).not.toBe(f);
        const heldBy = c1.from.empire;
        c1.from.empire = other; // a world of origin that is not held by the Reclaimers gets its people back
        expect(podWorld(g, st, c1, c1.ship)).toBe(c1.from);
        c1.from.empire = heldBy;
        if (c3 !== undefined) {
            g.scenario!.params.beaconCattleDeadCountPct = 100; // counted, when the setting says so
            scenarioEmit(g, 'builtObjectKilledBy', { builtObject: c3.ship, destroyer: other });
            expect(st.popEliminated).toBeCloseTo(elim + 0.3 * c3.total, -1);
            delete g.scenario!.params.beaconCattleDeadCountPct;
        }
        // a cattle ship boarded: its captives are freed to the taker's worlds (the capture hook)
        const otherPop = other.colonies.reduce((a, c) => a + c.population.totalAmount, 0);
        expect(rescueCattle(g, st, c2.ship, other)).toBeGreaterThan(0);
        expect(other.colonies.reduce((a, c) => a + c.population.totalAmount, 0)).toBeGreaterThan(otherPop);
        expect(st.stats.captivesRescued!).toBeGreaterThanOrEqual(c2.total);
        // retaking the core: the pens go home with the world, and another held world becomes the core
        const pop = core.colony.population.totalAmount;
        takeOwnershipOfColonyFull(g, f, core.colony, victim, false, false);
        expect(core.ended).toBe('retaken');
        expect(core.colony.population.totalAmount).toBeGreaterThanOrEqual(pop + 400_000_000);
        expect(st.stats.captivesFreed).toBe(500_000_000);
        expect(core.harvester).toBeNull();
        harvestPeriodic(g, st);
        const next = liveCores(st)[0];
        expect(next).toBeDefined();
        expect(next.colony).not.toBe(core.colony);
        // its harvester destroyed: the core is broken, the world may not be a core again for a while, the pens freed toward the attacker
        next.pens = [{ race: next.colony.population.dominantRace!.name, amount: 300_000_000 }];
        next.waiting = 300_000_000;
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: next.harvester!, destroyer: other });
        expect(next.ended).toBe('broken');
        expect(st.stats.coresBroken).toBe(1);
        expect(st.stats.captivesFreed).toBe(800_000_000);
        expect(pickCore(g, st, galaxyStarDate(g))).not.toBe(next.colony);
    }, 900000);

    it('harvest cores: 2 / 3 below the size thresholds, then rising to 7 in the biggest galaxies, one per three held worlds; a second core is chosen away from the first', () => {
        const { g, st } = completed();
        const at = (n: number): number => {
            const was = g.starCount;
            g.starCount = n;
            const t = coreTarget(g);
            g.starCount = was;
            return t;
        };
        expect([at(250), at(400), at(699), at(700), at(1000), at(1399), at(1400), at(2700), at(4000), at(8000)]).toEqual([2, 2, 2, 3, 3, 3, 4, 6, 7, 7]);
        g.scenario!.params.beaconCoresMidStars = 300;
        expect(at(400)).toBe(3);
        delete g.scenario!.params.beaconCoresMidStars;
        g.starCount = 4000;
        expect([coreCountFor(g, 0), coreCountFor(g, 1), coreCountFor(g, 3), coreCountFor(g, 4), coreCountFor(g, 21), coreCountFor(g, 40)]).toEqual([0, 1, 1, 2, 7, 7]);
        // spread: with one core, a far world of similar size beats a near one
        const f = st.faction!;
        const all = normalsOf(g).flatMap((e) => e.colonies.filter((c) => c !== e.capital && c.population.totalAmount > 0));
        for (const w of all.slice(0, 12)) takeOwnershipOfColonyFull(g, w.empire!, w, f, false, false);
        harvestPeriodic(g, st);
        const cores = liveCores(st);
        expect(cores.length).toBe(coreCountFor(g, 12));
        expect(cores.length).toBeGreaterThanOrEqual(2);
        const d = g.calculateDistance(cores[0].colony.xpos, cores[0].colony.ypos, cores[1].colony.xpos, cores[1].colony.ypos);
        const near = Math.min(...all.slice(0, 12).filter((w) => w !== cores[0].colony).map((w) => g.calculateDistance(w.xpos, w.ypos, cores[0].colony.xpos, cores[0].colony.ypos)));
        expect(d).toBeGreaterThan(near);
    }, 900000);

    it('funding models: scripted (1) spawns the scripted strength; harvest only (0) spends the fleet biofuel and waits when it is empty; combined (2) gets the trickle plus the biofuel', () => {
        const { g, st } = completed();
        const fuel = fuelOf(st);
        const scripted = scriptedBudget(g, st, 1);
        // model 2 (default): the awakening reserve makes season 1 as strong as the scripted one
        expect(P_model(g)).toBe(2);
        expect(freeShare(g)).toBeCloseTo(0.5, 5);
        expect(fuel.startGrant).toBeCloseTo(scripted * 0.5, 0);
        expect(seasonBudget(g, st, 1)).toBeCloseTo(scripted, 0);
        g.scenario!.params.beaconFundingModel = 1;
        expect(seasonBudget(g, st, 1)).toBeCloseTo(scripted, 5);
        g.scenario!.params.beaconFundingModel = 0;
        fuel.fleet = 0;
        expect(seasonBudget(g, st, 1)).toBe(0);
        expect(beginSeason(g, st, 1)).toBe(false); // starved: no season
        fuel.fleet = scripted;
        expect(beginSeason(g, st, 1)).toBe(true);
        const season = st.season!;
        expect(season.freeLeft).toBe(0);
        for (let i = 0; i < 60 && season.phase === 'prep'; i++) {
            g.nowMs += 5 * GAME_DAY_LENGTH;
            reclamationPeriodic(g);
        }
        // the fleet was paid for: the account fell by what was spawned (the guard is paid from it too)
        expect(fuel.spentShips).toBeGreaterThan(scripted * 0.5);
        expect(fuel.fleet).toBeLessThan(scripted * 0.5);
        function P_model(gx: Galaxy): number {
            return Number(gx.scenario!.params.beaconFundingModel ?? 2);
        }
    }, 1800000);

    it('the art record: the season phase, its dates, the planned and actual launch, the station damage', () => {
        const { g, st } = completed();
        const a0 = beaconArtInfo(g, st);
        expect(a0.phase).toBe('awakening');
        expect(a0.phaseEnd).toBeGreaterThan(a0.phaseStart);
        st.faction!.stateMoney = 1e9;
        beginSeason(g, st, 1);
        const a1 = beaconArtInfo(g, st);
        expect(a1.phase).toBe('prep');
        expect(a1.season).toBe(1);
        expect(a1.launchAt).toBe(st.season!.end);
        expect(a1.launched).toBe(0);
        expect(a1.stationDamage).toBeGreaterThanOrEqual(0);
        expect(a1.stationShields).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < 120 && st.season!.phase === 'prep'; i++) {
            g.nowMs += 5 * GAME_DAY_LENGTH;
            reclamationPeriodic(g);
        }
        const a2 = beaconArtInfo(g, st);
        expect(a2.phase).toBe('offensive');
        expect(a2.launched).toBe(st.season!.departed);
        expect(st.launches).toBe(1); // the monotonic launch record the art fires on
        expect(st.lastLaunchDate).toBe(st.season!.departed);
        expect(a2.launchAt).toBeGreaterThan(0);
        expect(st.art?.phase).toBe('offensive'); // refreshed in the state every pass
        expect(beaconLooks(g).art?.phase).toBe('offensive');
        st.beacon!.hasBeenDestroyed = true;
        st.beaconDestroyed = true;
        expect(beaconArtInfo(g, st).phase).toBe('dead');
    }, 1800000);

    it('the cattle ship: a huge plated freighter of the Reclaimers that the AI never builds', () => {
        const { g, st } = completed();
        const d = cattleDesign(g, st.faction!)!;
        expect(d).not.toBeNull();
        expect(d.subRole).toBe(BuiltObjectSubRole.LargeFreighter);
        expect(d.isObsolete).toBe(true);
        const plain = designFor(g, st.faction!, BuiltObjectSubRole.LargeFreighter);
        if (plain !== null && plain !== d) expect(d.size).toBeGreaterThan(plain.size * 1.5);
        expect(cattleDesign(g, st.faction!)).toBe(d); // made once
    }, 900000);

    it('Thralls and transports: Thralls for a landing are raised at the nearest core, paid from the troop biofuel, on real transports (interceptable); a planet strike sends the stock planet destroyer and counts the dead as eliminated', () => {
        const { g, st } = completed();
        const f = st.faction!;
        f.stateMoney = 1e9;
        const victim = normalsOf(g)[0];
        const world = victim.colonies.find((c) => c !== victim.capital && c.population.totalAmount > 0)!;
        takeOwnershipOfColonyFull(g, victim, world, f, false, false);
        harvestPeriodic(g, st);
        expect(liveCores(st)[0].colony).toBe(world);
        fuelOf(st).troops = 1e6;
        const troops0 = fuelOf(st).troops;
        expect(beginSeason(g, st, 1)).toBe(true);
        const grp = st.season!.groups[0];
        grp.ships.push(spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.Cruiser)!, world.xpos, world.ypos));
        const before = st.thrallShips.length;
        const sp = st.season!.staging[grp.staging];
        const added = supplyTroops(g, st, grp, sp.x, sp.y);
        expect(added).toBeGreaterThan(0);
        expect(st.thrallShips.length).toBeGreaterThan(before);
        expect(fuelOf(st).troops).toBeLessThan(troops0);
        const thrall = st.thrallShips[st.thrallShips.length - 1];
        expect(thrall.troops!.count).toBeGreaterThan(0);
        expect(Math.hypot(thrall.xpos - world.xpos, thrall.ypos - world.ypos)).toBeLessThan(60000); // made at the core, not at the Beacon
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
        // the destroyer keeps its Attack order: a mission lost to a refuel or a retreat is given again at the next pass
        expect(grp.destroyer!.isAutoControlled).toBe(false);
        (builtObjectMission(grp.destroyer!.mission) as unknown as { clear(): void }).clear();
        reclamationPeriodic(g);
        expect(builtObjectMission(grp.destroyer!.mission)!.type).toBe(BuiltObjectMissionType.Attack);
        expect(builtObjectMission(grp.destroyer!.mission)!.targetHabitat).toBe(target);
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
    it('staging points: an empire with a colony near enough notices the gathering (sight alone never finds a fleet in deep space); a distant one does not', () => {
        const { g, st } = completed();
        beginSeason(g, st, 1);
        const sp = st.season!.staging[0];
        const [a, b] = normalsOf(g);
        const home = a.colonies[0];
        sp.x = home.xpos;
        sp.y = home.ypos;
        g.scenario!.params.beaconStagingDetectPct = 100;
        g.scenario!.params.beaconStagingDetectSectors = 1;
        const rnd = { nextDouble: () => 0.5 } as unknown as Parameters<typeof noticedGathering>[4];
        expect(noticedGathering(g, st, a, sp, rnd)).toBe(true); // at its door: 100 %
        const far = Math.min(...b.colonies.map((c) => g.calculateDistance(c.xpos, c.ypos, sp.x, sp.y)));
        if (far > g.sectorSize) expect(noticedGathering(g, st, b, sp, rnd)).toBe(false);
        g.scenario!.params.beaconStagingDetectSectors = 0;
        expect(noticedGathering(g, st, a, sp, rnd)).toBe(false); // the range is a parameter
        g.scenario!.params.beaconStagingDetectSectors = 5;
        g.scenario!.params.beaconStagingDetectPct = 0;
        expect(noticedGathering(g, st, a, sp, rnd)).toBe(false);
    }, 900000);

    it('one Beacon per galaxy: while one work is live the roll weight is nil and the Game Editor refuses a second', () => {
        const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
        const g = game.galaxy;
        expect(kindTaken(g, 'beacon')).toBe(false);
        expect(spawnThreatNow(g, g.playerEmpire!, 'giantworks:beacon')).toBe(true);
        expect(kindTaken(g, 'beacon')).toBe(true);
        expect(spawnableThreats(g).find((t) => t.key === 'giantworks:beacon')!.note).not.toBeNull();
        expect(spawnThreatNow(g, g.playerEmpire!, 'giantworks:beacon')).toBe(false);
        expect(greatWorks(g).filter((w) => w.wonder === 'beacon')).toHaveLength(1);
        expect(kindTaken(g, 'casino')).toBe(false);
    }, 900000);

    it('the cloak is honoured by every mission: only the faction itself may be ordered at a hidden Watcher; a lapsed cloak lets another empire target it', () => {
        const { g, st } = rolled();
        const ship = st.watchers[0].ship!;
        const [a, b] = normalsOf(g);
        const mine = a.builtObjects.find((o) => !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && o.topSpeed > 0)!;
        const ask = (bo: BuiltObject): boolean => scenarioQuery(g, 'assignMissionAllowed', true, { builtObject: bo, missionType: BuiltObjectMissionType.Attack, target: ship, x: -2000000001, y: -2000000001 });
        expect(ask(mine)).toBe(false);
        expect(ask(st.watchers[1].ship!)).toBe(true); // the faction's own ships are not refused
        ship.cloakSeenBy = [{ empireId: a.empireId, until: galaxyStarDate(g) + 1000 }];
        expect(ask(mine)).toBe(true);
        const theirs = b.builtObjects.find((o) => !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && o.topSpeed > 0)!;
        expect(ask(theirs)).toBe(false); // the cloak lapsed for the spotter only
        ship.cloaked = false;
        expect(ask(theirs)).toBe(true);
        // the stock combat spares a hidden Watcher too (it is not shot at, boarded or captured by an empire that cannot see it)
        ship.cloaked = true;
        ship.cloakSeenBy = [{ empireId: a.empireId, until: galaxyStarDate(g) + 1000 }];
        const spares = (bo: BuiltObject): boolean => scenarioQuery(g, 'builtObjectSparesStaticTarget', false, { builtObject: bo, target: ship });
        expect(spares(mine)).toBe(false); // a spotted it
        expect(spares(theirs)).toBe(true); // b did not
        expect(spares(st.watchers[1].ship!)).toBe(false); // its own faction's ships are not its keepers
        // a Watcher taken by another empire is lost to the faction (and no longer cloaked for its new owner)
        takeOwnershipOfBuiltObject(g, st.faction!, ship, a, false);
        watchersPeriodic(g);
        expect(st.watchers[0].dead).toBe(true);
        expect(ship.cloaked).toBe(false);
    }, 900000);

    it('the AI coalition and the harvest: members near a harvester strike it together; a cattle ship in sight is intercepted; a human is never ordered', () => {
        const { g, st } = completed();
        const f = st.faction!;
        st.popEliminated = st.popBaseline * 0.2; // losing: every free warship is called
        g.scenario!.params.beaconAiCoreRatioPct = 1;
        g.scenario!.params.beaconAiSharePct = 100;
        g.scenario!.params.beaconAiRatioPct = 100000; // the Beacon itself is out of reach: its operation takes no unit
        const members = coalitionMembers(g, st);
        const ai = members[0];
        const victim = normalsOf(g).find((e) => e !== ai && e.colonies.filter((c) => c !== e.capital && c.population.totalAmount > 0).length >= 3)!;
        const worlds = victim.colonies.filter((c) => c !== victim.capital && c.population.totalAmount > 0).slice(0, 3);
        for (const w of worlds) takeOwnershipOfColonyFull(g, victim, w, f, false, false);
        harvestPeriodic(g, st);
        const hv = liveCores(st)[0].harvester!;
        const human = g.playerEmpire!;
        const humanBefore = human.builtObjects.map((b) => b.mission);
        const war = ai.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.warpSpeed > 0);
        expect(war.length).toBeGreaterThan(0);
        for (const b of war) {
            b.xpos = hv.xpos + 4000;
            b.ypos = hv.ypos;
        }
        rebuildIndexes(g);
        expect(coalitionPass(g)).toBeGreaterThan(0);
        expect(st.stats.aiCore).toBe(1);
        const atHv = (o: { mission: unknown } | null): boolean => {
            const m = (o?.mission ?? null) as { type: number; targetBuiltObject: unknown } | null;
            return m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject === hv;
        };
        expect([...ai.builtObjects, ...ai.shipGroups.filter((x) => x !== null)].some((o) => atHv(o as never) || atHv((o as BuiltObject).shipGroup as never))).toBe(true);
        expect(human.builtObjects.map((b) => b.mission)).toEqual(humanBefore);
        // the harvester gone: the units go for a cattle ship within reach (one unit each)
        shuttleUntil(g, st, () => laden(st).length > 0);
        const c = laden(st)[0];
        expect(c).toBeDefined();
        builtObjectCompleteTeardown(g, hv);
        for (const b of war) {
            b.xpos = c.ship.xpos + 3000;
            b.ypos = c.ship.ypos;
            // the harvester is gone: their orders at it are over (the stock mission ends with its target)
            (builtObjectMission(b.mission) as unknown as { clear(): void } | null)?.clear();
            ((b.shipGroup as { mission?: { clear(): void } | null } | null)?.mission ?? null)?.clear();
        }
        c.ship.cloaked = undefined;
        rebuildIndexes(g);
        g.scenario!.params.beaconAiCoreRatioPct = 100000;
        coalitionPass(g);
        // sight is the stock fog's: no member sees it (the fog is not refreshed here), so nothing is ordered
        expect(members.some((e) => isObjectVisibleToThisEmpire(g, e, c.ship))).toBe(false);
        expect(st.stats.aiCattle ?? 0).toBe(0);
        // in sight (the scenario query the fog consults): one unit goes for it
        registerScenarioQuery({ id: 'test.beaconSeeCattle', flag: 'zzTestSeeCattle', query: 'objectVisibleToAll', run: (_g, v, x) => v || (x.object as unknown) === c.ship });
        g.scenario!.flags.zzTestSeeCattle = true;
        coalitionPass(g);
        g.scenario!.flags.zzTestSeeCattle = false;
        expect(st.stats.aiCattle).toBe(1);
        {
            const atC = [...ai.builtObjects].some((b) => {
                const m = ((b.shipGroup as { mission?: unknown } | null)?.mission ?? builtObjectMission(b.mission)) as { type: number; targetBuiltObject: unknown } | null;
                return m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject === c.ship;
            });
            expect(atC).toBe(true);
        }
    }, 900000);

    it('the AI coalition: members with free fleets near a staging fleet they know strike it together; a human is never ordered; short of the force nobody commits', () => {
        const { g, st } = completed();
        const f = st.faction!;
        f.stateMoney = 1e9;
        st.popEliminated = st.popBaseline * 0.2; // the galaxy is losing: every free warship is called (else only Attack fleets and the heavier single ships are)
        g.scenario!.params.beaconAiRatioPct = 10;
        g.scenario!.params.beaconAiStagingRatioPct = 10;
        beginSeason(g, st, 1);
        const season = st.season!;
        for (let i = 0; i < 40; i++) {
            g.nowMs += 5 * GAME_DAY_LENGTH;
            reclamationPeriodic(g);
            if (season.groups.every((x) => x.ships.length > 0)) break;
        }
        const grp = season.groups.find((x) => x.ships.length > 0)!;
        const sp = season.staging[grp.staging];
        for (const b of grp.ships) {
            b.xpos = sp.x;
            b.ypos = sp.y;
        }
        const members = coalitionMembers(g, st);
        expect(members.every((e) => !isHumanEmpire(g, e))).toBe(true);
        expect(members.length).toBeGreaterThan(0);
        const ai = members[0];
        const human = g.playerEmpire!;
        const humanBefore = human.builtObjects.map((b) => b.mission);
        const warships = ai.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.warpSpeed > 0 && b.shipGroup === null);
        for (const b of ai.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0) {
            b.xpos = sp.x + 2000;
            b.ypos = sp.y;
        }
        rebuildIndexes(g);
        // nobody has noticed the gathering yet: the pass still pools what members know (none), so no strike
        expect(coalitionPass(g)).toBe(0);
        revealTo(g, sp, ai, KNOWLEDGE_CONFIRMED);
        // an impossible ratio: not enough force, nobody commits
        g.scenario!.params.beaconAiRatioPct = 100000;
        g.scenario!.params.beaconAiStagingRatioPct = 100000;
        expect(coalitionPass(g)).toBe(0);
        g.scenario!.params.beaconAiRatioPct = 10;
        g.scenario!.params.beaconAiStagingRatioPct = 10;
        g.scenario!.params.beaconAiSharePct = 100;
        const n = coalitionPass(g);
        expect(n).toBeGreaterThan(0);
        expect(st.stats.aiStrikes).toBeGreaterThan(0);
        const ordered = [...ai.builtObjects, ...ai.shipGroups.filter((x) => x !== null)].filter((o) => {
            const m = (o as { mission?: { type?: number; targetBuiltObject?: unknown } | null }).mission;
            return m != null && m.type === BuiltObjectMissionType.Attack && (m.targetBuiltObject as BuiltObject | null)?.actualEmpire === f;
        });
        expect(ordered.length + warships.length).toBeGreaterThan(0);
        expect(ordered.length).toBeGreaterThan(0);
        // the human's ships were not touched
        expect(human.builtObjects.map((b) => b.mission)).toEqual(humanBefore);
        // the knowledge is pooled among members
        for (const e of members) expect(knowledgeLevel(sp, e)).toBe(KNOWLEDGE_CONFIRMED);
    }, 1800000);
    it('landings are sized in regiments: the ground war wears down readiness points of ONE random regiment a tick, so a landing fields at least half the defenders\' regiments, and a held world\'s garrison is many regiments, not one', () => {
        const { g, st } = completed();
        const f = st.faction!;
        const victim = normalsOf(g)[0];
        const world = victim.colonies.find((c) => c !== victim.capital && c.population.totalAmount > 0)!;
        // a garrison of 20 regiments
        world.troops ??= new TroopList();
        while (world.troops.count < 20) world.troops.add(makeFactionTroop(g, victim, 75, 'Guard', null));
        const plan = landingPlan(g, f, world, 150);
        expect(plan.regiments).toBeGreaterThanOrEqual(Math.ceil(0.5 * 22));
        expect(plan.strength).toBeGreaterThan(0);
        expect(plan.regiments).toBeLessThanOrEqual(groupCarryRegiments(g, f) + 100);
        beginSeason(g, st, 1);
        const grp = st.season!.groups[0];
        grp.target = world;
        grp.ships.push(spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.Cruiser)!, world.xpos, world.ypos));
        supplyTroops(g, st, grp, world.xpos, world.ypos);
        const regs = grp.transports.reduce((n, b) => n + (b.troops?.count ?? 0), 0);
        expect(regs).toBeGreaterThanOrEqual(Math.min(plan.regiments, groupCarryRegiments(g, f)) - 1);
        // a conquered world's garrison is many regiments of the garrison strength
        takeOwnershipOfColonyFull(g, victim, world, f, false, false);
        expect(world.troops!.count).toBeGreaterThanOrEqual(20);
        // beaconGarrison 150 000: the model's free share for nothing, the rest as far as the troop biofuel goes
        expect(world.troops!.totalDefendStrength).toBeGreaterThan(75_000);
        expect(world.troops!.totalDefendStrength).toBeLessThan(190_000);
    }, 900000);
    it('the campaign scales: strength is per strike group, the group count grows with the galaxy\'s colonies, and the Beacon\'s guard is a couple of groups\' worth', () => {
        const { g, st } = completed();
        g.scenario!.params.beaconMinStrength = 0;
        const refBefore = scriptedBudget(g, st, 1);
        g.scenario!.params.beaconGroupColonies = 0;
        g.scenario!.params.beaconGroups = 3;
        g.scenario!.params.beaconStrengthPct = 20;
        const few = scriptedBudget(g, st, 1);
        g.scenario!.params.beaconGroupColonies = 5; // many more groups (the test galaxy has tens of colonies)
        const many = scriptedBudget(g, st, 1);
        expect(many).toBeGreaterThan(few);
        g.scenario!.params.beaconStrengthPct = 40;
        expect(scriptedBudget(g, st, 1)).toBeGreaterThan(many * 1.5); // per-group strength doubled
        expect(refBefore).toBeGreaterThan(0);
        g.scenario!.params.beaconStrengthPct = 20;
        g.scenario!.params.beaconFundingModel = 1; // the scripted season: every group is fielded (a biofuel-paid one fields what it can afford)
        st.faction!.stateMoney = 1e9;
        expect(beginSeason(g, st, 1)).toBe(true);
        const k = st.season!.groups.length;
        expect(k).toBeGreaterThan(3); // 3 + one per five colonies
        expect(k).toBeLessThanOrEqual(16);
    }, 900000);
    it('victory: the Beacon and both Watchers destroyed and no world held ends the game in victory, and nothing short of that does', () => {
        const { g, st } = completed();
        const f = st.faction!;
        const [a] = normalsOf(g);
        beaconEndCheck(g);
        expect(st.ended).toBe(false);
        // a world is held
        const victim = normalsOf(g)[1];
        const world = victim.colonies.find((c) => c !== victim.capital && c.population.totalAmount > 0)!;
        takeOwnershipOfColonyFull(g, victim, world, f, false, false);
        // the Beacon dies (killed by an empire)
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: st.beacon!, destroyer: a });
        expect(st.beaconDestroyed).toBe(true);
        beaconEndCheck(g);
        expect(st.ended).toBe(false); // two Watchers left
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: st.watchers[0].ship!, destroyer: a });
        beaconEndCheck(g);
        expect(st.ended).toBe(false); // one Watcher and a held world left
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: st.watchers[1].ship!, destroyer: a });
        expect(st.watchers.every((w) => w.dead)).toBe(true);
        beaconEndCheck(g);
        expect(st.ended).toBe(false); // the world is still held
        takeOwnershipOfColonyFull(g, f, world, victim, false, false);
        reclamationMonthly(g);
        beaconEndCheck(g);
        expect(st.ended).toBe(true);
        expect(st.phase).toBe('ended');
        expect(g.gameIsFinished).toBe(true);
        expect(f.builtObjects.every((b) => b.hasBeenDestroyed)).toBe(true); // the leftovers fall silent
    }, 900000);
    it('threat game-end policy: only the Beacon destroyed after a launch (victory) and the Beacon\'s own loss (defeat) end the game', () => {
        const { g } = completed();
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        const keep = threatGameEndPolicy.restrict;
        threatGameEndPolicy.restrict = true;
        try {
            // a contained threat (the +100 containment code of another threat) and a non-Beacon defeat: no game end
            threatGameEnd(g, g.playerEmpire, GameEndOutcome.Victory, 'contained', 2001, true);
            threatGameEnd(g, g.playerEmpire, GameEndOutcome.Victory, 'contained', 1901);
            threatGameEnd(g, null, GameEndOutcome.Defeat, 'dark farms', 1902);
            threatGameEnd(g, null, GameEndOutcome.Defeat, 'time bomb', 2016);
            expect(ends).toEqual([]);
            // the Beacon's defeat still ends it
            threatGameEnd(g, null, GameEndOutcome.Defeat, 'beacon', 2051);
            expect(ends.map((e) => e.code)).toEqual([2051]);
            // reversible
            threatGameEndPolicy.restrict = false;
            threatGameEnd(g, g.playerEmpire, GameEndOutcome.Victory, 'contained', 1901);
            expect(ends.map((e) => e.code)).toEqual([2051, 1901]);
        } finally {
            threatGameEndPolicy.restrict = keep;
            setGameEndHandler(g, null);
        }
    }, 900000);
    it('the Beacon destroyed before it ever launched does not end the game; destroyed after a launch it does (victory)', () => {
        const keep = threatGameEndPolicy.restrict;
        threatGameEndPolicy.restrict = true;
        try {
            for (const launched of [false, true]) {
                const { g, st } = completed();
                const ends: GameEndEventArgs[] = [];
                setGameEndHandler(g, (e) => ends.push(e));
                const [a] = normalsOf(g);
                if (launched) st.launches = 1;
                scenarioEmit(g, 'builtObjectKilledBy', { builtObject: st.beacon!, destroyer: a });
                expect(st.beaconDestroyed).toBe(true);
                beaconEndCheck(g);
                if (launched) {
                    expect(ends.map((e) => [e.code, e.outcomeForPlayer])).toEqual([[2152, GameEndOutcome.Victory]]);
                    beaconEndCheck(g);
                    expect(ends.length).toBe(1); // once
                } else {
                    expect(ends).toEqual([]);
                }
                setGameEndHandler(g, null);
            }
        } finally {
            threatGameEndPolicy.restrict = keep;
        }
    }, 900000);
    it('the AI coalition against the Beacon: the members gather their free fleets at a waypoint, strike the Beacon together, and are released when it falls', () => {
        const { g, st } = completed();
        st.popEliminated = st.popBaseline * 0.2;
        g.scenario!.params.beaconAiRatioPct = 5;
        g.scenario!.params.beaconAiSharePct = 100;
        g.scenario!.params.beaconAiGatherPct = 50;
        const beacon = st.beacon!;
        const members = coalitionMembers(g, st);
        expect(members.length).toBeGreaterThan(0);
        // every member's warships wait close to the Beacon (gathered already)
        for (const e of members) for (const b of e.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0) {
            b.xpos = beacon.xpos + 100000;
            b.ypos = beacon.ypos;
        }
        rebuildIndexes(g);
        expect(coalitionPass(g)).toBeGreaterThan(0);
        expect(st.ai!.ops.beacon.go).toBe(true);
        expect(st.ai!.launches).toBe(1);
        expect(st.stats.aiStrikes).toBeGreaterThanOrEqual(1);
        const attacking = (): BuiltObject[] => members.flatMap((e) => e.builtObjects).filter((b) => {
            const m = builtObjectMission(b.mission) ?? ((b.shipGroup as { mission: ReturnType<typeof builtObjectMission> } | null)?.mission ?? null);
            return m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject === beacon;
        });
        expect(attacking().length).toBeGreaterThan(0);
        expect(st.ai!.held!.length).toBeGreaterThan(0);
        // the Beacon falls: the operation ends, the force is released (their Attack missions on it are cleared)
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: beacon, destroyer: members[0] });
        expect(st.beaconDestroyed).toBe(true);
        coalitionPass(g);
        expect(st.ai!.ops.beacon.go).toBe(false);
        expect(attacking()).toHaveLength(0);
        expect(st.ai!.held ?? []).toHaveLength(0);
    }, 900000);
});
