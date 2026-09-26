// 19f-1 Grey Tide (tasks/19f-hidden-threats.md §1): off-path, forced seed on seed 1 (nest, drone production, spread to
// a new nest, eating a resource extractor), discovery (explored system), counterplay (destroy the nest), containment.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { gameYear, registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly } from '../src/sim/scenario/hooks';
import {
    GREY_TIDE_CODE_CONTAINED,
    GREY_TIDE_HANDLER_IDS,
    destroyNest,
    foundNest,
    greyTideCandidates,
    greyTideEndCheck,
    greyTideKnownSites,
    greyTidePeriodic,
    greyTideState,
    peekGreyTideState,
    registerGreyTide,
    type Nest,
} from '../src/sim/scenario/threats/greyTide';
import { availableThreatActions } from '../src/sim/scenario/threats/framework';
import { GameEndOutcome, setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const FORCE = { greyTideSeedYear: 0, greyTideDronesPerNestYear: 24, greyTideNestYears: 1, greyTideMaxNests: 3, greyTideEatRange: 1000000 };
const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function gtGame(params: Record<string, number> = {}, flags: Record<string, boolean> = {}, older = true): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: 'greytide', flags: { greyTide: true, ...flags }, params: { ...FORCE, ...params }, options: older ? age3 : undefined });
}

function forceYear(g: Galaxy): void {
    g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
}

function unregisterGreyTide(): void {
    for (const id of GREY_TIDE_HANDLER_IDS) {
        registerScenarioYearly({ id, run: () => undefined })();
        registerScenarioPeriodic({ id, periodDays: 1, run: () => undefined })();
        registerScenarioEvent({ id, event: 'builtObjectRemoved', run: () => undefined })();
    }
}

describe('Grey Tide: flag off', () => {
    it('flag off: no state, and the same draws and digest as the game without the package', () => {
        const a = gtGame({}, { greyTide: false }, false).game;
        forceYear(a.galaxy);
        runGameSeconds(a, 125);
        expect(peekGreyTideState(a.galaxy)).toBeNull();
        unregisterGreyTide();
        try {
            const b = gtGame({}, { greyTide: false }, false).game;
            forceYear(b.galaxy);
            runGameSeconds(b, 125);
            expect(b.galaxy.rnd.drawCount).toBe(a.galaxy.rnd.drawCount);
            expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        } finally {
            registerGreyTide();
        }
    }, 1200000);
});

describe('Grey Tide: forced seed on seed 1', () => {
    let game: Game;
    let g: Galaxy;
    let nest: Nest;

    it('seed: one nest on an eligible unexplored gas giant after the year boundary', () => {
        game = gtGame().game;
        g = game.galaxy;
        const st = greyTideState(g);
        const eligible = greyTideCandidates(g, st);
        expect(eligible.length).toBeGreaterThan(0);
        forceYear(g);
        runGameSeconds(game, 125);
        expect(st.nests).toHaveLength(1);
        nest = st.nests[0];
        expect(nest.state).toBe('alive');
        expect(eligible).toContain(nest.habitat);
        expect(st.faction).not.toBeNull();
        expect(st.faction!.pirateEmpireBaseHabitat).toBe(nest.habitat);
    }, 1200000);

    it('spread: drones accumulate for free and a nest past nestYears founds the nearest new nest', () => {
        const st = greyTideState(g);
        nest.nextSpawnDate = galaxyStarDate(g); // force the date gate open (production is driven by period count, not wall time)
        for (let i = 0; i < 3; i++) greyTidePeriodic(g, galaxyStarDate(g));
        expect(nest.drones + nest.droneProgress).toBeGreaterThan(0);
        expect(st.nests.length).toBeGreaterThan(1);
        expect(st.nests.length).toBeLessThanOrEqual(3); // greyTideMaxNests
    }, 600000);

    it('eating: a drone destroys the nearest resource extractor within range and the swarm declares itself', () => {
        const st = greyTideState(g);
        // A synthetic resource extractor at the nest: any live built object of a normal empire, relabelled and moved.
        const target = g.empires.flatMap((e) => (e === null ? [] : e.builtObjects)).find((b) => !b.hasBeenDestroyed && b !== null)!;
        expect(target).toBeDefined();
        target.role = BuiltObjectRole.Resource;
        target.xpos = nest.habitat.xpos;
        target.ypos = nest.habitat.ypos;
        nest.drones = Math.max(nest.drones, 1);
        greyTidePeriodic(g, galaxyStarDate(g));
        expect(target.hasBeenDestroyed).toBe(true);
        expect(st.declared).toBe(true);
    }, 600000);

    it('discovery: an empire that has explored the nest system knows it (level 3)', () => {
        const st = greyTideState(g);
        const owner = g.empires.find((e) => e !== null && e.active && e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire)!;
        owner.systemVisibility[nest.habitat.systemIndex].status = 2 /* Explored */ as never;
        greyTidePeriodic(g, galaxyStarDate(g));
        expect(greyTideKnownSites(g, owner).some((s) => s.target === nest.habitat && s.level === 3)).toBe(true);
        expect(greyTideKnownSites(g, g.playerEmpire!)).toEqual([]);
    }, 600000);

    it('the player destroys a known nest through the command queue; containment ends the game', () => {
        const player = g.playerEmpire!;
        const st = greyTideState(g);
        for (const n of st.nests) if (n !== nest) destroyNest(n);
        expect(availableThreatActions(g, player, nest.habitat)).toEqual([]);
        (nest.knowledge as { empireId: number; level: number; date: number }[]).push({ empireId: player.empireId, level: 3, date: 0 });
        const acts = availableThreatActions(g, player, nest.habitat);
        expect(acts).toEqual([{ kind: 'greyTide.destroy', label: 'Destroy Nest' }]);

        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        destroyNest(nest);
        greyTideEndCheck(g, st);
        expect(st.ended).toBe(true);
        expect(ends.map((e) => e.code)).toEqual([GREY_TIDE_CODE_CONTAINED]);
        expect(ends[0].outcomeForPlayer).toBe(GameEndOutcome.Victory);
        setGameEndHandler(g, null);
    }, 600000);
});
