// @slow
// 19b Dark Farms spread (tasks/19b-dark-farms.md §5.E, §11 test 5): after the turn the farm's robots ride its
// transports to a weakly garrisoned enemy colony and take it (a second colony) within a few months of game time.
import { beforeAll, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Habitat } from '../src/sim/types';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { darkFarmsPeriodic, darkFarmsState, darkFarmsTurn, eligibleFarmColonies, spawnFarm } from '../src/sim/scenario/threats/darkFarms';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { militaryShipCount } from '../src/sim/scenario/threats/framework';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

it('spread: faction transports land robots on an enemy colony and take it', () => {
    const { game } = createScenarioGame(base, {
        scenario: 'darkfarms',
        flags: { darkFarms: true },
        params: {
            graceYears: 0,
            spawnChancePerMille: 0,
            minDevelopment: 0,
            minPopulationMillions: 0,
            turnFleetRatioPct: 0,
            troopsPerYear: 36,
            sleepersPerYear: 12,
            sleeperTurnCount: 100,
            troopStrength: 400,
            garrisonYears: 0,
            maxFarms: 1,
            darkFarmsExistChancePct: 100,
            darkFarmsMinYear: 0,
        },
        options: (o) => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) }),
    });
    const g = game.galaxy;
    const st = darkFarmsState(g);
    // The farm grows on the AI empire with the smallest navy (a weak host: the case the spread rule is about).
    const hosts = g.empires.filter((e) => e !== g.playerEmpire && eligibleFarmColonies(g, st).some((c) => c.empire === e));
    const host = hosts.reduce((a, b) => (militaryShipCount(b) < militaryShipCount(a) ? b : a));
    const farm = spawnFarm(g, st, eligibleFarmColonies(g, st).find((c) => c.empire === host)!);
    for (let i = 0; i < 8; i++) darkFarmsPeriodic(g, galaxyStarDate(g));
    expect(darkFarmsTurn(g, st, farm)).toBe(true);
    const start = galaxyStarDate(g);
    let unloads = 0;
    const taken = new Set<Habitat>();
    for (let t = 0; t < 10 && taken.size < 2; t++) {
        runGameSeconds(game, 60);
        unloads += st.transports.filter((b) => { const m = builtObjectMission(b.mission); return m !== null && m.type === BuiltObjectMissionType.Attack && m.targetHabitat !== null && (b.troops?.count ?? 0) > 0; }).length;
        for (const c of st.faction!.colonies) taken.add(c);
    }
    const days = (galaxyStarDate(g) - start) / GAME_DAY_LENGTH;
    expect(taken.has(farm.habitat)).toBe(true);
    expect(unloads).toBeGreaterThan(0);
    expect(taken.size, `faction colonies after ${Math.round(days)} days`).toBeGreaterThanOrEqual(2);
    expect(days).toBeLessThanOrEqual(360);
}, 2400000);
