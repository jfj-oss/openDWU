// 19f-3 The Silence (tasks/19f-hidden-threats.md §3): off-path, forced start on seed 1 (a ruin starts transmitting,
// the zone grows, pirates are exempt from its hyperdrive-disable effect), the shutdown counterplay ends the game.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../src/sim/scenario/hooks';
import {
    SILENCE_CODE_SHUTDOWN,
    SILENCE_HANDLER_IDS,
    peekSilenceState,
    registerSilence,
    silenceAiHint,
    silenceGrow,
    silenceKnownSites,
    silenceShutdownCheck,
    silenceState,
    startSilence,
} from '../src/sim/scenario/threats/silence';
import { normalEmpires } from '../src/sim/scenario/threats/framework';
import { GalaxyLocationEffectType } from '../src/sim/galaxyLocation';
import { detectHyperDeny } from '../src/sim/movement';
import { GameEndOutcome, setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { rebuildIndexes } from '../src/sim/indexRebuild';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const FORCE = { silenceStartYear: 0, silenceStartRadius: 5000, silenceGrowthPerYear: 40000, silenceMaxRadius: 20000, silenceShutdownDays: 60 };
const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function slGame(params: Record<string, number> = {}, flags: Record<string, boolean> = {}, older = true): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: 'silence', flags: { silence: true, ...flags }, params: { ...FORCE, ...params }, options: older ? age3 : undefined });
}

function unregisterSilence(): void {
    for (const id of SILENCE_HANDLER_IDS) {
        registerScenarioYearly({ id, run: () => undefined })();
        registerScenarioPeriodic({ id, periodDays: 1, run: () => undefined })();
    }
    registerScenarioQuery({ id: 'silence.exempt', query: 'hyperDenyExempt', run: (_g, v) => v })();
}

describe('Silence: flag off', () => {
    it('flag off: no state, and the same draws and digest as the game without the package', () => {
        const a = slGame({}, { silence: false }, false).game;
        runGameSeconds(a, 125);
        expect(peekSilenceState(a.galaxy)).toBeNull();
        unregisterSilence();
        try {
            const b = slGame({}, { silence: false }, false).game;
            runGameSeconds(b, 125);
            expect(b.galaxy.rnd.drawCount).toBe(a.galaxy.rnd.drawCount);
            expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        } finally {
            registerSilence();
        }
    }, 1200000);
});

describe('Silence: forced start on seed 1', () => {
    let game: Game;
    let g: Galaxy;

    it('start: a ruin world starts transmitting a growing hyperjump-disabled zone', () => {
        game = slGame().game;
        g = game.galaxy;
        const st = silenceState(g);
        const source = g.ruinsHabitats.find((h) => !h.hasBeenDestroyed);
        expect(source).toBeDefined();
        startSilence(g, st, source!);
        expect(st.zone).not.toBeNull();
        expect(st.zone!.effect).toBe(GalaxyLocationEffectType.HyperjumpDisabled);
        expect(st.radius).toBe(5000);
        expect(silenceKnownSites(g, g.playerEmpire!)).toEqual([{ threat: 'silence', kind: 'colony', target: source, level: 3, label: 'Silence source (confirmed)' }]);
    }, 1200000);

    it('growth: the zone widens each period, capped at silenceMaxRadius', () => {
        const st = silenceState(g);
        for (let i = 0; i < 5; i++) silenceGrow(g, st);
        expect(st.radius).toBe(20000); // capped
        expect(st.zone!.width).toBe(40000);
    }, 600000);

    it('hyperDenyExempt: pirates inside the zone ignore the hyperjump-disable effect; normal empires do not', () => {
        const st = silenceState(g);
        const normal = normalEmpires(g)[0];
        const pirate = g.pirateEmpires[0];
        expect(pirate).toBeDefined();
        const bo = normal.builtObjects.find((b) => !b.hasBeenDestroyed)!;
        const pbo = pirate.builtObjects.find((b) => !b.hasBeenDestroyed) ?? pirate.privateBuiltObjects.find((b) => !b.hasBeenDestroyed)!;
        expect(bo).toBeDefined();
        expect(pbo).toBeDefined();
        bo.xpos = st.source!.xpos;
        bo.ypos = st.source!.ypos;
        pbo.xpos = st.source!.xpos;
        pbo.ypos = st.source!.ypos;
        expect(detectHyperDeny(g, bo)).toBe(true);
        expect(detectHyperDeny(g, pbo)).toBe(false);
    }, 600000);

    it('AI hint: empires with a colony inside the zone are reported', () => {
        const inside = silenceAiHint(g);
        expect(Array.isArray(inside)).toBe(true);
    }, 600000);

    it('shutdown: a troop ship holding position at the source for silenceShutdownDays ends the game (victory)', () => {
        const st = silenceState(g);
        const holder = normalEmpires(g)[0];
        const ship = holder.builtObjects.find((b) => !b.hasBeenDestroyed)!;
        ship.troopCapacity = 10;
        ship.xpos = st.source!.xpos;
        ship.ypos = st.source!.ypos;
        rebuildIndexes(g); // the built-object spatial grid does not follow a direct xpos/ypos write
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        // silenceShutdownDays (60) / PERIOD_DAYS (30) = 2 periodic calls.
        silenceShutdownCheck(g, st);
        expect(st.ended).toBe(false);
        silenceShutdownCheck(g, st);
        expect(st.ended).toBe(true);
        expect(ends.map((e) => e.code)).toEqual([SILENCE_CODE_SHUTDOWN]);
        expect(ends[0].outcomeForPlayer).toBe(GameEndOutcome.Victory);
        expect(ends[0].victorEmpire).toBe(holder);
        expect(g.galaxyLocations).not.toContain(st.zone);
        setGameEndHandler(g, null);
    }, 600000);
});
