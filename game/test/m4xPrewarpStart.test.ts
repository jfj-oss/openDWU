// M4x — pre-warp start wiring and galaxy starting age. The wizard's era sliders (Start.1.cs 3685-3770
// btnStartNewGameStart_Click) map onto CreateGameOptions { galaxyAge, age, techLevel }; Galaxy.StartingAge is the
// galaxy age (Galaxy.cs 982 `StartingAge => _Age`); a tech-0 (PreWarp) createGame runs; and the state ledger rises
// over a seed-1 harness run now that DirectPrivateConstruction pays the state (M4f).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import { runGameSeconds } from '../src/sim/tick/harness';
import { Random } from '../src/sim/random';
import {
    aiEmpireAge,
    aiTechLevelForExpansion,
    defaultStartGameOptions,
    playerEmpireAge,
    techLevelForSliderIndex,
    techLevelFromBucket,
    toCreateGameOptions,
} from '../src/sim/startGameOptions';

let gameData: GameData;
beforeAll(async () => { gameData = await loadGameDataFs(); }, 300000);

describe('era sliders → ages / tech levels (Start.cs method_57 / method_54 / method_89 / method_109)', () => {
    it('player age: Start.1.cs 3710-3715 ("Starting" in a PreWarp galaxy is PreWarp)', () => {
        const r = new Random(7);
        expect(playerEmpireAge(1, 0, r)).toBe(0);
        expect(playerEmpireAge(1, 1, r)).toBe(1);
        expect(playerEmpireAge(3, 0, r)).toBe(3);
        expect(playerEmpireAge(5, 4, r)).toBe(5);
        // (Random): new Random(clock).Next(1, 6).
        const a = playerEmpireAge(0, 1, new Random(7));
        expect(a).toBe(new Random(7).next(1, 6));
    });

    it('player tech level: method_75 + method_54 (PreWarp 0, Normal 0.5, Level X = X)', () => {
        expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(techLevelForSliderIndex)).toEqual([0, 0.5, 1, 2, 3, 4, 5, 6, 7]);
    });

    it('AI tech level: method_89 (0 → 0, 1 → 0.5, n → [lo, hi))', () => {
        expect(aiTechLevelForExpansion(0, new Random(1))).toBe(0);
        expect(aiTechLevelForExpansion(1, new Random(1))).toBe(0.5);
        const d = new Random(3).nextDouble();
        expect(aiTechLevelForExpansion(3, new Random(3))).toBe(1.0 + d * (2.99 - 1.0));
        expect(aiTechLevelForExpansion(5, new Random(3))).toBe(3.0 + d * (4.99 - 3.0));
    });

    it('AI age: method_109 then method_57 (one Next(0, 2) draw from Young up)', () => {
        const r = new Random(5);
        expect(aiEmpireAge(0, r)).toBe(0);
        expect(aiEmpireAge(1, r)).toBe(1);
        expect(r.drawCount).toBe(0);
        const pick = new Random(5).next(0, 2);
        expect(aiEmpireAge(4, new Random(5))).toBe(pick === 0 ? 3 : 4);
    });

    it('method_55 bucket read back through method_199 / method_54', () => {
        expect([-1, 0, 0.5, 0.7, 1, 1.3, 2.99, 5.5, 6.5, 0.3].map(techLevelFromBucket)).toEqual([-1, 0, 0.5, 1, 1, 2, 3, 6, 7, 7]);
    });

    it('toCreateGameOptions: default = Starting era (galaxy age 1, age 1, tech 0.5); PreWarp galaxy = age 0 / tech 0', () => {
        const o = { ...defaultStartGameOptions(), seed: 1 };
        const c = toCreateGameOptions(o, gameData, []);
        expect(c.galaxyAge).toBe(1);
        expect([c.player.age, c.player.techLevel]).toEqual([1, 0.5]);
        for (const e of c.aiEmpires) expect([e.age, e.techLevel]).toEqual([1, 0.5]);
        const p = toCreateGameOptions({ ...o, galaxyExpansionIndex: 0, empireTechLevelIndex: 0 }, gameData, []);
        expect(p.galaxyAge).toBe(0);
        expect([p.player.age, p.player.techLevel]).toEqual([0, 0]);
        for (const e of p.aiEmpires) expect([e.age, e.techLevel]).toEqual([0, 0]);
        // Tech slider independent of the galaxy era (Start.1.cs 3716).
        const m = toCreateGameOptions({ ...o, galaxyExpansionIndex: 0, empireTechLevelIndex: 1 }, gameData, []);
        expect([m.galaxyAge, m.player.age, m.player.techLevel]).toEqual([0, 0, 0.5]);
    });
});

describe('Galaxy.StartingAge = Galaxy.Age (Galaxy.cs 982)', () => {
    it('comes from CreateGameOptions.galaxyAge, not the player age', () => {
        const base = tickGameOptions(gameData);
        const o: CreateGameOptions = { ...base, galaxyAge: 1, player: { ...base.player, age: 0 } };
        const g = createGame(o).galaxy;
        expect(g.age).toBe(1);
        expect(g.startingAge).toBe(1);
    }, 300000);
});

describe('PreWarp (tech level 0) start (Start.2.cs 1146 / 1308 / 1314 / 1367 gate on TechLevel > 0)', () => {
    it('no space port, no ships; 600 game-s run', () => {
        const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 0, techLevel: 0 });
        const base = tickGameOptions(gameData);
        const g = createGame({ ...base, player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)'), s('(Random)')] }).galaxy;
        for (const e of g.empires.filter((x) => x.pirateEmpireBaseHabitat === null)) {
            expect(e.spacePorts.length).toBe(0);
            expect(e.builtObjects.length).toBe(0);
            expect(e.privateBuiltObjects.length).toBe(0);
        }
        const r = runGameSeconds(g, 600);
        // Not stopOnTodo: stubs of packages still in flight (M4m / M4s / M4q ...) are reached on any 600 s run.
        expect(r.nowMs).toBeGreaterThanOrEqual(600000);
    }, 300000);
});

describe('state ledger, galaxy age 0 / tech 0.5, seed 1, 600 game-s', () => {
    it('state money rises (Empire.6.cs 741 DirectPrivateConstruction pays the state the private purchase price)', () => {
        const g = createGame({ ...tickGameOptions(gameData), galaxyAge: 0 }).galaxy;
        const player = g.playerEmpire!;
        const before = player.stateMoney;
        runGameSeconds(g, 600);
        // Seed 1 at the M4x commit: 20904.7 -> 33519.6.
        expect(player.stateMoney).toBeGreaterThan(before);
    }, 300000);
});
