// Sim worker, Main View hot path (docs/sim-worker.md §9 chunk 2, audit §3): with the galaxy binding's hot-field
// configuration (src/simworker/replicaGalaxy.ts), what the main view reads every frame is on the replica as soon as the
// step's hot part is applied — without pumping the cold queue:
// - the touched ships' hot fields, their shots (Weapon x / y / distance / LastFired) and fighters;
// - the habitat a touched ship is parked at (its committed position and orbit pair, which the ship's position was just
//   derived from: renderInterp.ts followsParent);
// - the player's system visibility (render/fog.ts);
// - and no mission / command object is born in the hot stream (they travel cold: no hot birth bursts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Habitat } from '../src/sim/types';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import { galaxyToJSON } from '../src/sim/save/galaxySave';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 300000);

function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

describe('sim worker: the Main View’s per-frame fields arrive with the hot part', () => {
    it('touched ships, their shots, parked-at habitats and the player’s visibility are current without the cold pump', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const time = new GalaxyTime();
        time.paused = false;
        const host = new SimHost(game, time, {} as StartGameOptions, { now: fakeClock() });
        // A very slow cold pump: only what the hot part carries is current.
        const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: () => undefined, now: fakeClock(), coldBudgetMs: 0 });
        try {
            const rg = client.galaxy;
            const uiTime = new GalaxyTime();
            uiTime.bindGalaxy(rg);
            uiTime.paused = false;
            const replicaOf = (o: object): unknown => client.replica.decoder.object(host.sync.encoder.knownId(o));
            const hotBorn: string[] = [];
            let inHotApply = false;
            client.replica.decoder.onNewObject = (o) => {
                if (inHotApply) hotBorn.push((o as object).constructor?.name ?? '?');
            };
            let checkedShips = 0;
            let checkedParked = 0;
            let checkedShots = 0;
            for (let i = 0; i < 300; i++) {
                const touchBefore = new Map<BuiltObject, number>();
                for (const bo of g.builtObjects) if (bo !== null) touchBefore.set(bo, bo.lastTouch);
                const m = host.tick(FRAME_REAL_MS);
                if (m === null) continue;
                // Hot part only (the frame's cold pump has a zero budget, and nothing is forced: births-only deps aside).
                inHotApply = true;
                const st = client.replica.apply(structuredClone(m.delta));
                inHotApply = false;
                if (st.bornParts === 0) expect(hotBorn.filter((n) => n === 'BuiltObjectMission' || n === 'Command')).toEqual([]);
                hotBorn.length = 0;
                expect(rg.nowMs).toBe(g.nowMs);
                for (const bo of g.builtObjects) {
                    if (bo === null || touchBefore.get(bo) === bo.lastTouch) continue;
                    const r = replicaOf(bo) as BuiltObject | null;
                    if (r === null) continue; // born this step in a cold part
                    checkedShips++;
                    expect([r.xpos, r.ypos, r.heading, r.currentSpeed, r.lastTouch, r.hasBeenDestroyed]).toEqual([bo.xpos, bo.ypos, bo.heading, bo.currentSpeed, bo.lastTouch, bo.hasBeenDestroyed]);
                    expect([r.lastShieldStrike, r.currentShields, r.nearestSystemStar === null]).toEqual([bo.lastShieldStrike, bo.currentShields, bo.nearestSystemStar === null]);
                    for (let k = 0; k < bo.weapons.length; k++) {
                        const w = bo.weapons[k];
                        const rw = r.weapons[k];
                        if (rw === undefined) continue;
                        checkedShots++;
                        expect([rw.x, rw.y, rw.distanceTravelled, rw.lastFired, rw.resetNext]).toEqual([w.x, w.y, w.distanceTravelled, w.lastFired, w.resetNext]);
                    }
                    const h = bo.parentHabitat as Habitat | null;
                    if (h !== null) {
                        const rh = replicaOf(h) as Habitat;
                        checkedParked++;
                        expect([rh.xpos, rh.ypos, rh.orbitAngle, rh.lastTouch]).toEqual([h.xpos, h.ypos, h.orbitAngle, h.lastTouch]);
                    }
                }
                const pv = game.playerEmpire.visibility.systemVisibility;
                const rv = client.game.playerEmpire.visibility.systemVisibility;
                for (let k = 0; k < pv.length; k++) if (rv[k] !== undefined) expect(rv[k].status).toBe(pv[k].status);
                // The rest of the frame (cold pump at a zero budget, render time).
                client.frame(uiTime);
            }
            expect(checkedShips).toBeGreaterThan(1000);
            expect(checkedParked).toBeGreaterThan(100);
            expect(checkedShots).toBeGreaterThan(100);
            // Everything else converges: after a full compare the replica is the worker's game.
            client.replica.apply(structuredClone(host.sync.delta(true)), true);
            expect(JSON.stringify(galaxyToJSON(rg))).toBe(JSON.stringify(galaxyToJSON(g)));
        } finally {
            client.dispose();
            host.dispose();
        }
    }, 600000);
});
