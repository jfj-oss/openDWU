// 19b Dark Farms (tasks/19b-dark-farms.md §11): off-path, forced trigger on seed 1 (spawn, production, hidden sleepers
// and robots), discovery, the turn (faction, flipped sleepers, invasion from inside → the colony flips), dirty methods,
// retake, purge (player command), end conditions, save/load. The spread soak lives in scenarioDarkFarmsSpread.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { gameYear, registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly, scenarioEmit } from '../src/sim/scenario/hooks';
import {
    DARK_FARMS_CODE_CONTAINED,
    DARK_FARMS_CODE_DEFEAT,
    DARK_FARMS_HANDLER_IDS,
    darkFarmsEndCheck,
    darkFarmsKnownSites,
    darkFarmsPeriodic,
    darkFarmsState,
    darkFarmsTurn,
    eligibleFarmColonies,
    farmHiddenStrength,
    harvesterBlight,
    peekDarkFarmsState,
    purgeableFarm,
    registerDarkFarms,
    revealFarm,
    spawnFarm,
    type DarkFarm,
} from '../src/sim/scenario/threats/darkFarms';
import { availableThreatActions, knowledgeLevel } from '../src/sim/scenario/threats/framework';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { inflictBombardDamage } from '../src/sim/combat/damage';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { CharacterRole, getEmpireCharacters } from '../src/sim/characters';
import { createShipAction, ShipActionType } from '../src/sim/player/shipAction';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { threatRows } from '../src/ui/hud';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

/** Forced trigger (§11): no grace, certain spawn, any colony eligible by size. */
const FORCE = { graceYears: 0, spawnChancePerMille: 1000, minDevelopment: 0, minPopulationMillions: 0, turnFleetRatioPct: 0, darkFarmsExistChancePct: 100, darkFarmsMinYear: 0 };
/** Empires at age 3 (several colonies each: the seed-1 age-1 empires own only their capitals). */
const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function dfGame(params: Record<string, number> = {}, flags: Record<string, boolean> = {}, older = true): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: 'darkfarms', flags: { darkFarms: true, ...flags }, params: { ...FORCE, ...params }, options: older ? age3 : undefined });
}

/** The yearly tick runs at the next long block (as if a year had just turned). */
function farmHiddenStrengthOf(f: DarkFarm): number {
    return farmHiddenStrength(f.habitat.empire!.galaxy, f);
}

function forceYear(g: Galaxy): void {
    g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
}

function saveText(game: Game, scenario: { id: string; flags: Record<string, boolean>; params: Record<string, number> }): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1, scenario });
}

function scenarioChoice(g: Galaxy): { id: string; flags: Record<string, boolean>; params: Record<string, number> } {
    return { id: g.scenario!.id, flags: { ...g.scenario!.flags }, params: { ...g.scenario!.params } };
}

/** Removes the package's hooks (replace by id, then unregister); registerDarkFarms() restores them. */
function unregisterDarkFarms(): void {
    for (const id of DARK_FARMS_HANDLER_IDS) {
        registerScenarioYearly({ id, run: () => undefined })();
        registerScenarioPeriodic({ id, periodDays: 1, run: () => undefined })();
        registerScenarioEvent({ id, event: 'builtObjectRemoved', run: () => undefined })();
    }
}

describe('Dark Farms: flag off', () => {
    it('flag off: no state, and the same draws and digest as the game without the package', () => {
        const a = dfGame({}, { darkFarms: false }, false).game;
        forceYear(a.galaxy);
        runGameSeconds(a, 125);
        expect(peekDarkFarmsState(a.galaxy)).toBeNull();
        unregisterDarkFarms();
        try {
            const b = dfGame({}, { darkFarms: false }, false).game;
            forceYear(b.galaxy);
            runGameSeconds(b, 125);
            expect(b.galaxy.rnd.drawCount).toBe(a.galaxy.rnd.drawCount);
            expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        } finally {
            registerDarkFarms();
        }
    }, 1200000);
});

describe('Dark Farms: forced trigger on seed 1', () => {
    let game: Game;
    let g: Galaxy;
    let farm: DarkFarm;

    it('spawn: one farm on an eligible non-capital colony after the year boundary', () => {
        game = dfGame({ troopsPerYear: 24, sleepersPerYear: 12, sleeperTurnCount: 100, troopStrength: 400, maxFarms: 1, traceDetectPct: 0, agentDetectPct: 0 }).game;
        g = game.galaxy;
        const st = darkFarmsState(g);
        const eligible = eligibleFarmColonies(g, st);
        expect(eligible.length).toBeGreaterThan(0);
        forceYear(g);
        runGameSeconds(game, 125);
        expect(st.farms).toHaveLength(1);
        farm = st.farms[0];
        expect(farm.state).toBe('hidden');
        expect(farm.host.capital).not.toBe(farm.habitat);
        expect(eligible).toContain(farm.habitat);
        // The seed-1 farm colony (the first eligible colony in galaxy.empires / colonies order: the roll always hits).
        expect(farm.habitat).toBe(eligible[0]);
        expect(farm.habitat.name).toMatchPin('darkFarms.seed1FarmColony', 'S265 1');
    }, 1200000);

    it('production: hidden robots and sleepers accumulate for free; sleepers are host private freighters', () => {
        const st = darkFarmsState(g);
        const money = farm.host.stateMoney;
        for (let i = 0; i < 6; i++) darkFarmsPeriodic(g, galaxyStarDate(g));
        let troops = 0;
        let tp = 0;
        let ships = 0;
        let sp = 0;
        for (let i = 0; i < farm.periods; i++) {
            tp += (24 * 30) / 365;
            while (tp >= 1) {
                tp -= 1;
                if (troops < 4 * 24) troops++;
            }
            sp += (12 * 30) / 365;
            while (sp >= 1) {
                sp -= 1;
                ships++;
            }
        }
        expect(farm.hiddenTroops).toBe(troops);
        const sleepers = st.sleepers.filter((s) => s.farmId === farm.id);
        expect(sleepers.length).toBe(ships);
        expect(sleepers.length).toBeGreaterThan(2);
        for (const s of sleepers) {
            expect(farm.host.privateBuiltObjects).toContain(s.bo);
            expect(s.bo.actualEmpire).toBe(farm.host);
            expect(s.bo.owner).toBeNull();
            expect([BuiltObjectSubRole.SmallFreighter, BuiltObjectSubRole.MediumFreighter]).toContain(s.bo.subRole);
            expect(farm.host.designs).toContain(s.bo.design);
        }
        expect(farm.host.stateMoney).toBe(money);
        // Hidden: nobody knows (the player's UI shows nothing), no Troop objects exist yet.
        expect(darkFarmsKnownSites(g, g.playerEmpire!)).toEqual([]);
        expect(farm.habitat.invadingTroops === null || farm.habitat.invadingTroops.count === 0).toBe(true);
    }, 600000);

    it('discovery: a trace scanner next to a sleeper exposes it (level 3) and its farm (level 2), with messages', () => {
        const st = darkFarmsState(g);
        g.scenario!.params.traceDetectPct = 100;
        const host = farm.host;
        const scanner = host.builtObjects.find((b) => !b.hasBeenDestroyed && b.role !== undefined && b.xpos !== 0)!;
        const s = st.sleepers.find((x) => x.farmId === farm.id)!;
        scanner.sensorTraceScannerPower = 20;
        scanner.sensorTraceScannerRange = 1000;
        s.bo.xpos = scanner.xpos + 100;
        s.bo.ypos = scanner.ypos;
        const before = empireMessages(host).length;
        darkFarmsPeriodic(g, galaxyStarDate(g));
        expect(knowledgeLevel(s, host)).toBe(3);
        expect(knowledgeLevel(farm, host)).toBeGreaterThanOrEqual(2);
        expect(farm.exposedDate).toBeGreaterThan(0);
        const msgs = empireMessages(host).slice(before);
        expect(msgs.some((m) => m.messageType === EmpireMessageType.GeneralWarning && m.subject === s.bo)).toBe(true);
        expect(msgs.some((m) => m.subject === farm.habitat)).toBe(true);
        scanner.sensorTraceScannerPower = 0;
        g.scenario!.params.traceDetectPct = 0;
    }, 600000);

    it('an AI host that knows its farm recruits there / purges, and retires the sleepers it found (AI rule 7)', () => {
        const st = darkFarmsState(g);
        const ai = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.some((c) => c !== e.capital && c.population.totalAmount > 0))!;
        const colony = ai.colonies.find((c) => c !== ai.capital && c.population.totalAmount > 0)!;
        const farm2 = spawnFarm(g, st, colony);
        farm2.hiddenTroops = 1;
        revealFarm(g, st, farm2, ai, 3);
        expect(farm2.exposedDate).toBeGreaterThan(0);
        const recruiting = colony.troopsToRecruit?.count ?? 0;
        const garrison = colony.troops?.totalDefendStrength ?? 0;
        darkFarmsPeriodic(g, galaxyStarDate(g));
        // Garrison ≥ 1.2 × the hidden strength: purge (the farm turns now); else troops are being recruited there.
        if (garrison >= 1.2 * 1 * farmHiddenStrengthOf(farm2)) expect(farm2.state).toBe('turned');
        else expect((colony.troopsToRecruit?.count ?? 0) > recruiting || farm2.state === 'turned').toBe(true);
        farm2.state = 'dead';
        st.sleepers = st.sleepers.filter((s) => s.farmId !== farm2.id);
    }, 600000);

    it('save / load mid-growth: the loaded game runs on identically', () => {
        const text = saveText(game, scenarioChoice(g));
        const loaded = deserializeGame(text, scenarioGameData(base, 'darkfarms')).game;
        runGameSeconds(game, 60);
        runGameSeconds(loaded, 60);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(g));
        expect(darkFarmsState(loaded.galaxy).farms[0].hiddenTroops).toBe(farm.hiddenTroops);
    }, 1200000);

    it('the turn: faction created, sleepers flipped + armed + loaded, robots rise inside, the colony flips', () => {
        const st = darkFarmsState(g);
        if (farm.state === 'hidden') {
            const host = farm.host;
            const sleepers = st.sleepers.filter((s) => s.farmId === farm.id).map((s) => s.bo);
            const before = empireMessages(host).length;
            expect(darkFarmsTurn(g, st, farm)).toBe(true);
            const faction = st.faction!;
            expect(faction.dominantRace!.name).toBe('Harvester');
            expect(faction.name).toBe('Harvester Collective');
            for (const e of g.empires) {
                if (e === faction || e.pirateEmpireBaseHabitat !== null || !e.active) continue;
                expect(obtainDiplomaticRelation(faction, e).type).toBe(DiplomaticRelationType.War);
                expect(obtainDiplomaticRelation(faction, e).locked).toBe(true);
            }
            for (const bo of sleepers.filter((b) => !b.hasBeenDestroyed)) {
                expect(bo.actualEmpire).toBe(faction);
                expect(faction.builtObjects).toContain(bo);
                expect(bo.subRole).toBe(BuiltObjectSubRole.TroopTransport);
                expect(bo.weapons.length).toBeGreaterThan(0);
                expect(bo.troops!.count).toBeGreaterThanOrEqual(1);
            }
            expect(farm.state).toBe('turned');
            expect(farm.habitat.invadingTroops!.count).toBeGreaterThan(0);
            const turn = empireMessages(host).slice(before).find((m) => m.messageType === EmpireMessageType.GeneralBadEvent && m.subject === farm.habitat);
            expect(turn?.description).toContain('Harvester Collective');
        }
        runGameSeconds(game, 120);
        expect(farm.habitat.empire).toBe(st.faction);
        expect(st.faction!.capital).toBe(farm.habitat);
        expect(st.faction!.colonies).toContain(farm.habitat);
        // Saboteurs arrive with the first colony (dirty methods on).
        expect(getEmpireCharacters(st.faction!).filter((c) => c.role === CharacterRole.IntelligenceAgent).length).toBeGreaterThanOrEqual(1);
        expect(darkFarmsKnownSites(g, g.playerEmpire!).some((x) => x.target === farm.habitat && x.level === 3)).toBe(true);
    }, 1200000);

    it('save / load after the turn', () => {
        const text = saveText(game, scenarioChoice(g));
        const loaded = deserializeGame(text, scenarioGameData(base, 'darkfarms')).game;
        runGameSeconds(game, 60);
        runGameSeconds(loaded, 60);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(g));
        expect(darkFarmsState(loaded.galaxy).faction!.name).toBe('Harvester Collective');
    }, 1200000);

    it('blight bombardment: a Harvester ship bombarding a populated colony infects it (Xaraktor plague path)', () => {
        const st = darkFarmsState(g);
        g.scenario!.params.blightChancePct = 100;
        const ship = st.faction!.builtObjects.find((b) => !b.hasBeenDestroyed)!;
        const target = g.empires.find((e) => e !== st.faction && e.pirateEmpireBaseHabitat === null)!.colonies.find((c) => c.plagueId < 0 && c.population.totalAmount > 0)!;
        const blight = harvesterBlight(g)!;
        expect(blight).not.toBeNull();
        inflictBombardDamage(g, ship, target, 5);
        expect(target.plagueId).toBe(blight.plagueId);
        // Dirty methods off: no blight.
        const other = g.empires.find((e) => e !== st.faction && e.pirateEmpireBaseHabitat === null)!.colonies.find((c) => c.plagueId < 0 && c.population.totalAmount > 0 && c !== target)!;
        g.scenario!.flags.darkFarmsDirtyMethods = false;
        scenarioEmit(g, 'habitatBombarded', { builtObject: ship, habitat: other, bombardPower: 5 });
        expect(other.plagueId).toBeLessThan(0);
        g.scenario!.flags.darkFarmsDirtyMethods = true;
    }, 600000);

    it('end: the Harvester population share ends the game with code 1902', () => {
        const st = darkFarmsState(g);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        g.scenario!.params.defeatPopulationPct = 0.0001;
        darkFarmsEndCheck(g, st);
        expect(ends.map((e) => e.code)).toEqual([DARK_FARMS_CODE_DEFEAT]);
        expect(ends[0].victorEmpire).toBe(st.faction);
        expect(st.ended).toBe(true);
        st.ended = false;
        g.scenario!.params.defeatPopulationPct = 100;
        setGameEndHandler(g, null);
    }, 600000);

    it('retake: taking the farm colony destroys the farm (retakeDestroysFarm 1) or re-hides it (0)', () => {
        const st = darkFarmsState(g);
        const faction = st.faction!;
        const host = farm.host;
        takeOwnershipOfColonyFull(g, faction, farm.habitat, host, false, false);
        expect(farm.state).toBe('dead');
        // Knob 0: a second farm handed to the faction and retaken keeps working, hidden, under the new owner.
        g.scenario!.params.retakeDestroysFarm = 0;
        const colony = host.colonies.find((c) => c !== host.capital && c !== farm.habitat && c.population.totalAmount > 0)!;
        const farm2 = spawnFarm(g, st, colony);
        farm2.state = 'turned';
        takeOwnershipOfColonyFull(g, host, colony, faction, false, false);
        expect(colony.empire).toBe(faction);
        takeOwnershipOfColonyFull(g, faction, colony, host, false, false);
        expect(farm2.state).toBe('hidden');
        expect(farm2.host).toBe(host);
        farm2.state = 'dead';
        g.scenario!.params.retakeDestroysFarm = 1;
    }, 600000);

    it('end: containment (no farm, no colony, no ship) tears the faction down; the player share of kills wins (1901)', () => {
        const st = darkFarmsState(g);
        const faction = st.faction!;
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        for (const f of st.farms) f.state = 'dead';
        for (const c of [...faction.colonies]) takeOwnershipOfColonyFull(g, faction, c, farm.host, false, false);
        for (const b of [...faction.builtObjects, ...faction.privateBuiltObjects]) builtObjectCompleteTeardown(g, b);
        st.killsByEmpire = { [g.playerEmpire!.empireId]: 3 };
        darkFarmsEndCheck(g, st);
        expect(faction.active).toBe(false);
        expect(st.ended).toBe(true);
        expect(ends.map((e) => e.code)).toEqual([DARK_FARMS_CODE_CONTAINED]);
        expect(empireMessages(g.playerEmpire!).some((m) => m.messageType === EmpireMessageType.GalacticNewsNet && m.description.includes('destroyed'))).toBe(true);
        setGameEndHandler(g, null);
    }, 600000);
});

describe('Dark Farms: the player purges a farm through the command queue; UI rows', () => {
    it('a known farm on a player colony offers "Purge Dark Farm", which forces the turn', () => {
        const { game } = dfGame({ troopsPerYear: 12, sleepersPerYear: 6, sleeperTurnCount: 100, troopStrength: 60 });
        const g = game.galaxy;
        const player = g.playerEmpire!;
        const st = darkFarmsState(g);
        const colony = player.colonies.find((c: Habitat) => c !== player.capital && c.population.totalAmount > 0)!;
        const farm = spawnFarm(g, st, colony);
        for (let i = 0; i < 3; i++) darkFarmsPeriodic(g, galaxyStarDate(g));
        expect(availableThreatActions(g, player, colony)).toEqual([]);
        expect(threatRows(colony, player)).toEqual([]);
        revealFarm(g, st, farm, player, 3);
        expect(purgeableFarm(g, player, colony)).toBe(farm);
        expect(threatRows(colony, player)).toEqual([{ label: 'Threat', value: 'Dark Farm (confirmed)' }]);
        const acts = availableThreatActions(g, player, colony);
        expect(acts).toEqual([{ kind: 'darkFarms.purge', label: 'Purge Dark Farm' }]);
        const action = createShipAction(ShipActionType.ScenarioThreatAction, colony);
        action.extraData = acts[0].kind;
        runPlayerCommand(g, player, 'shipAction', [colony, action, true]);
        expect(farm.state).toBe('turned');
        expect(st.faction).not.toBeNull();
        expect(availableThreatActions(g, player, colony)).toEqual([]);
    }, 1200000);
});
