// 19f #9 Robot Mutiny (tasks/19f-hidden-threats.md §9): flag off, seeding, forced trigger (robots rise from
// colonies and majority-robot ships flip), discovery, and defeat/containment. Short, direct-call tests.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { gameYear } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { TroopList } from '../src/sim/cargo';
import { makeRobotTroop, factionPopulationSharePct } from '../src/sim/scenario/threats/framework';
import {
    ROBOT_MUTINY_CODE_CONTAINED,
    ROBOT_MUTINY_CODE_DEFEAT,
    isRobotTroop,
    mutinyPeriodic,
    mutinyTrigger,
    peekRobotMutinyState,
    robotMutinyState,
} from '../src/sim/scenario/threats/robotMutiny';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function rmGame(flags: Record<string, boolean> = {}): { game: Game; g: Galaxy } {
    const { game } = createScenarioGame(base, { scenario: 'robotmutiny', flags: { threatRobotMutiny: true, ...flags }, params: { mutinyYear: 0, mutinyMinRobots: 1, mutinyShipFlipPct: 100 }, options: age3 });
    return { game, g: game.galaxy };
}

function forceYear(g: Galaxy): void {
    g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
}

/** Places a robot troop in `colony`'s garrison, owned by `empire` (as the stock RoboticTroopFoundry would). */
function placeGarrisonRobot(g: Galaxy, colony: import('../src/sim/types').Habitat, empire: import('../src/sim/empire').Empire): void {
    const t = makeRobotTroop(g, empire, 60, 'BattleBot Group');
    if (colony.troops === null) colony.troops = new TroopList();
    t.colony = colony;
    colony.troops.add(t);
    empire.troops.add(t);
}

describe('Robot Mutiny: flag off', () => {
    it('no state with the flag off', () => {
        const { game, g } = rmGame({ threatRobotMutiny: false });
        runGameSeconds(game, 65);
        expect(peekRobotMutinyState(g)).toBeNull();
    }, 300000);
});

describe('Robot Mutiny: seeding, forced trigger, discovery, ends', () => {
    it('seeding: a ruin world is picked as the source (skips gracefully with no ruins on this seed)', () => {
        const { game, g } = rmGame();
        forceYear(g);
        runGameSeconds(game, 65);
        const st = peekRobotMutinyState(g)!;
        expect(st.seeded).toBe(true);
        if (g.ruinsHabitats.length > 0) expect(st.source).not.toBeNull();
    }, 300000);

    it('trigger: garrisoned robot troops rise from inside; a majority-robot ship flips to the faction', () => {
        const { game, g } = rmGame();
        const host = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.some((c) => c !== e.capital))!;
        const colony = host.colonies.find((c) => c !== host.capital)!;
        placeGarrisonRobot(g, colony, host);
        placeGarrisonRobot(g, colony, host);
        const ship = host.builtObjects.find((b) => b.troopCapacity > 0 && !b.hasBeenDestroyed);
        if (ship !== undefined) {
            if (ship.troops === null) ship.troops = new TroopList();
            const t = makeRobotTroop(g, host, 60, 'BattleBot Group');
            t.builtObject = ship;
            ship.troops.add(t);
            host.troops.add(t);
        }
        const st = robotMutinyState(g);
        const nBefore = g.empires.length;
        expect(mutinyTrigger(g, st)).toBe(true);
        expect(g.empires.length).toBe(nBefore + 1);
        const faction = st.faction!;
        expect(faction.dominantRace!.name).toBe('Harvester');
        expect(obtainDiplomaticRelation(faction, host).type).toBe(DiplomaticRelationType.War);
        expect(colony.invadingTroops!.count).toBeGreaterThanOrEqual(2);
        expect(colony.troops!.items.some((t) => isRobotTroop(g, t))).toBe(false);
        if (ship !== undefined) expect(ship.actualEmpire).toBe(faction);
    }, 600000);

    it('end: the faction holding enough population share ends the game in defeat (1919)', () => {
        const { game, g } = rmGame();
        const host = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.some((c) => c.population.totalAmount > 0))!;
        const colony = host.colonies.find((c) => c.population.totalAmount > 0)!;
        placeGarrisonRobot(g, colony, host);
        const st = robotMutinyState(g);
        expect(mutinyTrigger(g, st)).toBe(true);
        const faction = st.faction!;
        // Simulate the ground war resolving in the faction's favour (the stock invasion, not re-tested here).
        takeOwnershipOfColonyFull(g, host, colony, faction, false, false);
        expect(factionPopulationSharePct(g, faction)).toBeGreaterThan(0);
        g.scenario!.params.mutinyDefeatPopulationPct = 0.0001;
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        mutinyPeriodic(g);
        expect(ends.map((e) => e.code)).toEqual([ROBOT_MUTINY_CODE_DEFEAT]);
        setGameEndHandler(g, null);
    }, 600000);

    it('end: a torn-down faction is contained (2019)', () => {
        const { game, g } = rmGame();
        const host = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null)!;
        const colony = host.colonies[0];
        placeGarrisonRobot(g, colony, host);
        const st = robotMutinyState(g);
        expect(mutinyTrigger(g, st)).toBe(true);
        const faction = st.faction!;
        // No colonies taken, no ships: the faction is already "dead" by teardownIfDead's rule.
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        mutinyPeriodic(g);
        expect(faction.active).toBe(false);
        expect(ends.map((e) => e.code)).toEqual([ROBOT_MUTINY_CODE_CONTAINED]);
        setGameEndHandler(g, null);
    }, 600000);
});
