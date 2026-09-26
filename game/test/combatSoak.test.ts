// @slow — soak: 30 game-minutes (1800 s) of the seed-1 harness game with a battle report (test:slow tier).
// Combat verification scenario (6) (tasks/COMBAT-VERIFICATION-2026-09-26.md): battles demonstrably occur in an unscripted
// game. Mirrors `node scripts/sim-run.mjs --stars 300 --empires 4 --seconds 1800 --combat` (the harness game config):
// every ship / base destroyed and every closed SpaceBattleStats record — a ship's BattleStats replaced at AssignMission
// (BuiltObject.2.cs 7643) or dropped at mission completion (4517-4532) — with weapon activity.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { runGameSeconds } from '../src/sim/tick/harness';
import { SpaceBattleStats } from '../src/sim/combat/damage';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';

interface BattleRecord {
    ship: BuiltObject;
    stats: SpaceBattleStats;
    atMs: number;
}

let gameData: GameData;
let g: Galaxy;
const seen = new Map<BuiltObject, unknown>();
const battles: BattleRecord[] = [];
const destroyed: BuiltObject[] = [];
const destroyedSeen = new Set<BuiltObject>();

const active = (st: unknown): st is SpaceBattleStats =>
    st instanceof SpaceBattleStats && (st.weaponsHits > 0 || st.weaponsMisses > 0 || st.damageToUs !== 0 || st.shieldsDamageAbsorbed > 0);

function watch(galaxy: Galaxy): void {
    for (const bo of galaxy.builtObjects) {
        if (bo === null) continue;
        const prev = seen.get(bo);
        if (prev !== undefined && prev !== bo.battleStats && active(prev)) battles.push({ ship: bo, stats: prev, atMs: galaxy.nowMs });
        if (bo.battleStats !== prev) seen.set(bo, bo.battleStats);
        if (bo.hasBeenDestroyed && !destroyedSeen.has(bo)) {
            destroyedSeen.add(bo);
            destroyed.push(bo);
            if (active(bo.battleStats)) {
                battles.push({ ship: bo, stats: bo.battleStats, atMs: galaxy.nowMs });
                seen.set(bo, null);
            }
        }
    }
}

beforeAll(async () => {
    gameData = await loadGameDataFs();
    g = cachedTickGame(gameData).galaxy;
}, 180000);

describe('(6) 30 game-minutes on the harness: battles occur and are recorded', () => {
    for (let part = 1; part <= 3; part++) {
        it(`runs game-minutes ${(part - 1) * 10}-${part * 10}`, () => {
            const r = runGameSeconds(g, 600, { onFrame: watch });
            expect(r.frames).toBe(36000);
        }, 900000);
    }

    it('reports battles, destroyed ships and per-battle SpaceBattleStats', () => {
        expect(g.nowMs).toBeGreaterThanOrEqual(1800000);
        const hits = battles.reduce((a, b) => a + b.stats.weaponsHits, 0);
        const misses = battles.reduce((a, b) => a + b.stats.weaponsMisses, 0);
        const kills = battles.reduce((a, b) => a + b.stats.destroyedEnemyShipBaseSize, 0);
        const summary = {
            battles: battles.length,
            destroyed: destroyed.length,
            destroyedMilitary: destroyed.filter((b) => b.role === BuiltObjectRole.Military).length,
            hits,
            misses,
            damageToEnemy: Math.round(battles.reduce((a, b) => a + b.stats.weaponsDamageToEnemy, 0)),
            shieldsAbsorbed: Math.round(battles.reduce((a, b) => a + b.stats.shieldsDamageAbsorbed, 0)),
            killedSize: kills,
        };
        console.log('combat soak', JSON.stringify(summary));
        // Seed 1 / 1800 s (sim-run --combat, 2026-09-26): 319 records, 25 destroyed, hit rate ≈ 0.6. Loose floors only:
        // the exact numbers move with every sim change.
        expect(summary.battles).toBeGreaterThan(50);
        expect(summary.destroyed).toBeGreaterThan(5);
        expect(summary.destroyedMilitary).toBeGreaterThan(0);
        expect(hits).toBeGreaterThan(100);
        expect(summary.killedSize).toBeGreaterThan(0);
        // Per-record sanity (SpaceBattleStats.cs 93-133): hits carry damage, damage is not negative, a hit ≥ 350 out is
        // also counted long-range.
        for (const b of battles) {
            expect(b.stats.weaponsDamageToEnemy).toBeGreaterThanOrEqual(0);
            expect(b.stats.weaponsHitsLongRange).toBeLessThanOrEqual(b.stats.weaponsHits);
            if (b.stats.weaponsHits === 0) expect(b.stats.weaponsDamageToEnemy).toBe(0);
        }
    });
});
