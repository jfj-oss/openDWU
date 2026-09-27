// Task 19l "Livelier mid game" items 4-5 — scenario lively-galaxy: pirateAmbition, livingCalendar.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { getGovernmentsStatic } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { scenarioQuery } from '../src/sim/scenario';
import {
    pickAmbitionTarget,
    pirateAmbitionGlobal,
    pirateAmbitionState,
    pirateAmbitionYearly,
} from '../src/sim/scenario/lively/pirateAmbition';
import { festivalState, livingCalendarYearly } from '../src/sim/scenario/lively/livingCalendar';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

function lively(flags: Record<string, boolean>, params: Record<string, number> = {}): Galaxy {
    return createScenarioGame(base, { scenario: 'lively-galaxy', flags, params }).game.galaxy;
}

function aiEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e) => e !== null && e.active && e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
}

/** Repositions `n` populated independent colonies (starting at `skip`) right on top of `pirateEmpire`'s base, with
 * ascending population (so repeated picks are deterministic: lowest population first), and returns them in seize
 * order. Already-seized colonies (empire !== independentEmpire) are skipped automatically. */
function forcedNearbyIndependents(g: Galaxy, pirateEmpire: Empire, n: number, skip = 0) {
    const base = pirateEmpire.pirateEmpireBaseHabitat!;
    const list = g.independentColonies.filter((h) => h.empire === g.independentEmpire && h.population.totalAmount > 0).slice(skip, skip + n);
    expect(list.length).toBe(n);
    list.forEach((h, i) => {
        h.xpos = base.xpos + 100;
        h.ypos = base.ypos + 100;
        h.population.totalAmount = 1000 + i * 1000; // ascending: list[0] is weakest, seized first
    });
    return list;
}

describe('19l pirateAmbition', () => {
    it('a rich, armed faction seizes and holds an independent colony as a base', () => {
        const g = lively({ pirateAmbition: true }, { pirateAmbitionMoney: 0, pirateAmbitionShips: 0, pirateAmbitionColonyCap: 1 });
        const pirate = g.pirateEmpires.find((e) => e !== null && e.active && e.pirateEmpireBaseHabitat !== null)!;
        expect(pirate).toBeDefined();
        const [target] = forcedNearbyIndependents(g, pirate, 1);
        pirate.stateMoney = 1e6;

        expect(pickAmbitionTarget(g, pirate)).toBe(target);
        pirateAmbitionYearly(g);

        expect(target.empire).toBe(pirate);
        expect(pirate.colonies.includes(target)).toBe(true);
        expect(target.pirateColonyControl.getByFaction(pirate)).not.toBeNull();
        expect(pirateAmbitionState(g)[String(pirate.empireId)].colonies).toBe(1);

        // Capped at 1: a second eligible target is not seized.
        const [second] = forcedNearbyIndependents(g, pirate, 1);
        pirateAmbitionYearly(g);
        expect(second.empire).not.toBe(pirate);
        expect(pirateAmbitionState(g)[String(pirate.empireId)].colonies).toBe(1);
    }, 120000);

    it('holds a colony cap above 1, and gates a new faction going ambitious to one per N years', () => {
        const g = lively(
            { pirateAmbition: true },
            { pirateAmbitionMoney: 0, pirateAmbitionShips: 0, pirateAmbitionColonyCap: 3, pirateAmbitionCooldownYears: 8, pirateAmbitionSeizeRadiusFraction: 0.001 },
        );
        const pirates = g.pirateEmpires.filter((e) => e !== null && e.active && e.pirateEmpireBaseHabitat !== null);
        expect(pirates.length).toBeGreaterThanOrEqual(2);
        const [p1, p2] = pirates;
        p1.stateMoney = 1e6;
        p2.stateMoney = 1e6;
        forcedNearbyIndependents(g, p1, 3, 0);
        forcedNearbyIndependents(g, p2, 3, 3);

        // One yearly pass: only p1 (first in the list) goes ambitious and seizes one colony; p2 is blocked by the
        // once-per-N-years gate on a *new* faction even though it independently qualifies.
        pirateAmbitionYearly(g);
        expect(pirateAmbitionState(g)[String(p1.empireId)]?.colonies).toBe(1);
        expect(pirateAmbitionState(g)[String(p2.empireId)]).toBeUndefined();

        // p1 keeps growing (already ambitious, not gated by the new-faction cooldown) up to its cap.
        pirateAmbitionYearly(g);
        pirateAmbitionYearly(g);
        pirateAmbitionYearly(g);
        expect(pirateAmbitionState(g)[String(p1.empireId)].colonies).toBe(3); // capped
        expect(pirateAmbitionState(g)[String(p2.empireId)]).toBeUndefined(); // still gated

        // Once the cooldown has (simulated) elapsed, a second faction may go ambitious.
        pirateAmbitionGlobal(g).lastNewAmbitionYear = -1000;
        pirateAmbitionYearly(g);
        expect(pirateAmbitionState(g)[String(p2.empireId)]?.colonies).toBe(1);
    }, 120000);
});

describe('19l livingCalendar', () => {
    it('a festival raises approval for a month, then expires', () => {
        const g = lively({ livingCalendar: true }, { festivalChance: 1, electionChance: 0, coronationChance: 0, anniversaryChance: 0 });
        const empire = aiEmpires(g)[0];
        const habitat = empire.capital!;
        const before = scenarioQuery(g, 'empireApprovalRating', 50, { habitat, empire });

        livingCalendarYearly(g);
        const entry = festivalState(g)[String(empire.empireId)];
        expect(entry).toBeDefined();
        expect(entry.until).toBeGreaterThan(galaxyStarDate(g));
        const during = scenarioQuery(g, 'empireApprovalRating', 50, { habitat, empire });
        expect(during).toBeCloseTo(before + entry.bonus);

        // Expired: the query no longer adds the bonus.
        entry.until = galaxyStarDate(g) - 1;
        const after = scenarioQuery(g, 'empireApprovalRating', 50, { habitat, empire });
        expect(after).toBeCloseTo(before);
    }, 120000);

    it('an election changes the leader of an election-manner government when rolled', () => {
        const g = lively({ livingCalendar: true }, { festivalChance: 0, electionChance: 1, coronationChance: 0, anniversaryChance: 0 });
        const electionGovId = getGovernmentsStatic().findIndex((gov) => gov !== null && gov.leaderReplacementTypicalManner === 2);
        expect(electionGovId).toBeGreaterThanOrEqual(0);
        const empire = aiEmpires(g).find((e) => e.capital !== null)!;
        empire.governmentId = electionGovId;
        empire.lastLeaderChangeDate = 0; // long past: the cooldown gate is open
        const before = empire.leader;

        livingCalendarYearly(g);

        expect(empire.leader).not.toBe(before);
        expect(empire.leader).not.toBeNull();
        expect(empire.lastLeaderChangeDate).toBe(galaxyStarDate(g));
    }, 120000);
});

describe('19l items 4-5 flags off', () => {
    it('lively-galaxy with every flag off gives the same seed-1 game and short run as no scenario', () => {
        const ref = cachedTickGameRun(base, { seconds: 60 });
        const { game } = createScenarioGame(base, {
            scenario: 'lively-galaxy',
            flags: { ambitionPressure: false, borderFriction: false, smallerInvasions: false, pirateAmbition: false, livingCalendar: false },
        });
        expect(game.galaxy.scenario?.id).toBe('lively-galaxy');
        const run = runGameSeconds(game, 60);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
        expect(game.galaxy.scenario!.state).toEqual({});
    }, 300000);

    it('the manifest defaults include pirateAmbition and livingCalendar on', () => {
        const g = lively({});
        expect(g.scenario!.flags.pirateAmbition).toBe(true);
        expect(g.scenario!.flags.livingCalendar).toBe(true);
    }, 120000);
});
