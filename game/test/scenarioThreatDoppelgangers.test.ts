// 19f-4 Doppelgangers (tasks/19f-hidden-threats.md §4): off-path, forced vectors on seed 1 (recapture roll, planted
// derelict claimed), the trigger (The Mirror rises, sleepers flip in place), discovery, containment.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { gameYear, registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly, scenarioEmit } from '../src/sim/scenario/hooks';
import {
    DOPPELGANGERS_CODE_CONTAINED,
    DOPPELGANGERS_HANDLER_IDS,
    doppelgangersEndCheck,
    doppelgangersKnownSites,
    doppelgangersPeriodic,
    doppelgangersState,
    doppelgangersTrigger,
    onBuiltObjectOwnerChanged,
    peekDoppelgangersState,
    registerDoppelgangers,
} from '../src/sim/scenario/threats/doppelgangers';
import { normalEmpires } from '../src/sim/scenario/threats/framework';
import { GameEndOutcome, setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const FORCE = { doppelSleeperPct: 100, doppelTurnCount: 2, doppelPlantPerYear: 3, doppelDetectPct: 0, doppelgangersExistChancePct: 100, doppelgangersMinYear: 0 };
const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function ddGame(params: Record<string, number> = {}, flags: Record<string, boolean> = {}, older = true): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: 'doppelgangers', flags: { doppelgangers: true, ...flags }, params: { ...FORCE, ...params }, options: older ? age3 : undefined });
}

function forceYear(g: Galaxy): void {
    g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
}

function unregisterDoppelgangers(): void {
    for (const id of DOPPELGANGERS_HANDLER_IDS) {
        registerScenarioYearly({ id, run: () => undefined })();
        registerScenarioPeriodic({ id, periodDays: 1, run: () => undefined })();
        registerScenarioEvent({ id, event: 'builtObjectRemoved', run: () => undefined })();
    }
}

describe('Doppelgangers: flag off', () => {
    it('flag off: no state, and the same draws and digest as the game without the package', () => {
        const a = ddGame({}, { doppelgangers: false }, false).game;
        forceYear(a.galaxy);
        runGameSeconds(a, 125);
        expect(peekDoppelgangersState(a.galaxy)).toBeNull();
        unregisterDoppelgangers();
        try {
            const b = ddGame({}, { doppelgangers: false }, false).game;
            forceYear(b.galaxy);
            runGameSeconds(b, 125);
            expect(b.galaxy.rnd.drawCount).toBe(a.galaxy.rnd.drawCount);
            expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        } finally {
            registerDoppelgangers();
        }
    }, 1200000);
});

describe('Doppelgangers: forced vectors on seed 1', () => {
    let game: Game;
    let g: Galaxy;

    it('vector (a): a recaptured ship becomes a sleeper for its true owner (100% forced)', () => {
        game = ddGame().game;
        g = game.galaxy;
        forceYear(g);
        runGameSeconds(game, 125);
        const st = doppelgangersState(g);
        const [empireA, empireB] = normalEmpires(g);
        const bo = empireA.privateBuiltObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Freight)!;
        expect(bo).toBeDefined();
        onBuiltObjectOwnerChanged(g, bo, empireA, empireB); // captured by an enemy
        expect(st.captured.some((c) => c.bo === bo && c.owner === empireA)).toBe(true);
        onBuiltObjectOwnerChanged(g, bo, empireB, empireA); // recaptured by its true owner
        expect(st.captured.some((c) => c.bo === bo)).toBe(false);
        expect(st.sleepers).toHaveLength(1);
        expect(st.sleepers[0].bo).toBe(bo);
        expect(st.sleepers[0].trueOwner).toBe(empireA);
    }, 600000);

    it('vector (b): a planted derelict claimed by its own empire becomes a sleeper for free', () => {
        const st = doppelgangersState(g);
        const [empireA] = normalEmpires(g);
        // Synthesize a planted derelict directly (the yearly handler's own placement draws are not what this checks).
        const bo = empireA.privateBuiltObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Freight && !st.sleepers.some((s) => s.bo === b))!;
        st.planted.push(bo);
        scenarioEmit(g, 'abandonedShipClaimed', { builtObject: bo, empire: empireA });
        expect(st.planted).toHaveLength(0);
        expect(st.sleepers.some((s) => s.bo === bo && s.trueOwner === empireA)).toBe(true);
    }, 600000);

    it('the trigger: The Mirror rises once doppelTurnCount sleepers are live; every sleeper flips in place', () => {
        const st = doppelgangersState(g);
        expect(st.sleepers.length).toBeGreaterThanOrEqual(2);
        const before = st.sleepers.map((s) => s.bo);
        expect(doppelgangersTrigger(g, st)).toBe(true);
        const faction = st.faction!;
        expect(faction.name).toBe('The Mirror');
        for (const bo of before) {
            expect(bo.actualEmpire).toBe(faction);
            expect(faction.builtObjects).toContain(bo);
        }
    }, 600000);

    it('discovery: a suspect sleeper (still hidden, pre-trigger) is confirmed to its true owner', () => {
        // Exercise the discovery roll on a fresh game (post-trigger sleepers are already flipped, so use a new one).
        const { game: g2 } = ddGame({ doppelDetectPct: 100, doppelTurnCount: 1000 });
        const gg = g2.galaxy;
        forceYear(gg);
        runGameSeconds(g2, 125);
        const st2 = doppelgangersState(gg);
        const [empireA, empireB] = normalEmpires(gg);
        const bo = empireA.privateBuiltObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Freight)!;
        onBuiltObjectOwnerChanged(gg, bo, empireA, empireB);
        onBuiltObjectOwnerChanged(gg, bo, empireB, empireA);
        expect(st2.sleepers).toHaveLength(1);
        doppelgangersPeriodic(gg, galaxyStarDate(gg));
        expect(doppelgangersKnownSites(gg, empireA).some((s) => s.target === bo && s.level === 3)).toBe(true);
    }, 600000);

    it('containment: destroying every flipped ship tears the faction down and ends the game (victory)', () => {
        const st = doppelgangersState(g);
        const faction = st.faction!;
        for (const bo of [...faction.builtObjects]) builtObjectCompleteTeardown(g, bo);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        doppelgangersEndCheck(g, st);
        expect(faction.active).toBe(false);
        expect(st.ended).toBe(true);
        expect(ends.map((e) => e.code)).toEqual([DOPPELGANGERS_CODE_CONTAINED]);
        expect(ends[0].outcomeForPlayer).toBe(GameEndOutcome.Victory);
        setGameEndHandler(g, null);
    }, 600000);
});
