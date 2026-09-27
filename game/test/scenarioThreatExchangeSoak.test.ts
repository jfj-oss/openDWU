// @slow — soak: The Exchange (19f #8) over multi-year runs of the seed-1 harness game (test:slow tier).
// (1) With a rich purse: the fleet fills to exchangeFleetCap in two stock fleets (the smaller filled first) and over a
//     2-year run no warship ever leaves the station's system (assignMissionAllowed guard + periodic recall).
// (2) With the default params: the stock pirate-faction research potential at appearance and 5 years later (the
//     numbers are logged for the task report).
import { appendFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { CreateGameOptions } from '../src/sim/game';
import { runGameSeconds } from '../src/sim/tick/harness';
import { gameYear } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../src/sim/galaxyTime';
import { annualResearchPotential } from '../src/sim/researchTick';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { assignMission } from '../src/sim/missions/assign';
import { exchangeInSystem, exchangeState } from '../src/sim/scenario/threats/exchange';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

/** Soak numbers: logged, and appended to $EXCHANGE_SOAK_OUT when set (the task report). */
function report(line: string): void {
    console.log(line);
    const out = process.env.EXCHANGE_SOAK_OUT;
    if (out !== undefined && out !== '') appendFileSync(out, line + '\n');
}

function start(params: Record<string, number>) {
    const { game } = createScenarioGame(base, { scenario: 'exchange', flags: { threatExchange: true }, params: { exchangeYear: 0, ...params }, options: age3 });
    const g = game.galaxy;
    g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
    runGameSeconds(game, 65);
    return { game, g, st: exchangeState(g) };
}

describe('The Exchange soak', () => {
    it('fleet: capped, two fleets, never outside the station system over a 2-year run', () => {
        const { game, g, st } = start({ exchangeIncomeStep: 5000000, exchangeIncomeCap: 50000000, exchangeFleetCap: 12 });
        const f = st.faction!;
        expect(f).not.toBeNull();
        let maxShips = 0;
        let outside = 0;
        for (let t = 0; t < 2 * REAL_SECONDS_IN_GALACTIC_YEAR; t += 30) {
            runGameSeconds(game, 30);
            const ships = st.warships.filter((b) => !b.hasBeenDestroyed);
            maxShips = Math.max(maxShips, ships.length);
            expect(ships.length).toBeLessThanOrEqual(12);
            for (const b of ships) if (!exchangeInSystem(g, st, b.xpos, b.ypos)) outside++;
        }
        expect(maxShips).toBe(12);
        expect(outside).toBe(0);
        expect(st.fleets.length).toBe(2);
        const [a, b] = st.fleets.map((x) => x.ships.filter((s) => !s.hasBeenDestroyed).length);
        expect(a + b).toBe(st.warships.filter((s) => !s.hasBeenDestroyed).length);
        expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
        for (const fl of st.fleets) for (const s of fl.ships) expect(s.shipGroup).toBe(fl);
        // The guard refuses a mission out of the system (the ship keeps its patrol).
        const ship = st.warships.find((s) => !s.hasBeenDestroyed)!;
        const far = g.habitats.find((h) => h !== null && !exchangeInSystem(g, st, h.xpos, h.ypos))!;
        const before = builtObjectMission(ship.mission);
        assignMission(g, ship, BuiltObjectMissionType.Attack, far, null, BuiltObjectMissionPriority.High);
        expect(builtObjectMission(ship.mission)).toBe(before);
        expect(f.colonies.length).toBe(0);
        // Research through the stock pirate-faction branch: station + 2 research stations + the fleet.
        expect(st.researchStations.length).toBe(2);
        report(`[exchange soak] rich purse, 2 years: ships ${a}+${b}, built objects ${f.builtObjects.length}, research potential ${Math.round(annualResearchPotential(f))}, purse ${Math.round(st.purse)}, spent ${JSON.stringify(st.spent)}`);
    }, 3600000);

    it('research potential at appearance and 5 years later (default params)', () => {
        const { game, st } = start({});
        const f = st.faction!;
        const at = annualResearchPotential(f);
        const objs0 = f.builtObjects.length;
        for (let t = 0; t < 5 * REAL_SECONDS_IN_GALACTIC_YEAR; t += 120) runGameSeconds(game, 120);
        const after = annualResearchPotential(f);
        report(
            `[exchange soak] research potential: at appearance (+65 s) ${Math.round(at)} (${objs0} built objects), after 5 years ${Math.round(after)} (${f.builtObjects.length} built objects, ` +
                `${st.researchStations.length} research stations, ${st.warships.filter((b) => !b.hasBeenDestroyed).length} warships); techs known ${f.research.techTree.filter((n) => n !== null && n.isResearched).length}; ` +
                `missions ${st.missionsAssigned}, caught ${st.caughtLog.length}, contracts ${JSON.stringify(st.contractsPosted)}, funded ${Math.round(st.fundedTotal)}, sales ${st.sales.length}, purse ${Math.round(st.purse)}`,
        );
        expect(at).toBeGreaterThan(0);
        expect(after).toBeGreaterThanOrEqual(at);
        expect(f.colonies.length).toBe(0);
        expect(st.ended).toBe(false);
    }, 3600000);
});
