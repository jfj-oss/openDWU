// The Long Night under multiplayer lockstep (net/lockstep.ts gameReplaced, net/lockstepSim.ts adopt, simworker/worker.ts resetGalaxy): every peer's
// sim reaches the trigger on the same frame; only the HOST builds the Age 2 game and pushes it to the clients as a resync, so the clients never
// regenerate it. Two sessions in one process over the in-memory transport (as scripts/lockstep-demo.mjs --memory).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { CreateGameOptions } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GalaxyTime } from '../src/sim/galaxyTime';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { setGalaxyResetSupported, galaxyResetPending } from '../src/sim/galaxyReset';
import { performGalaxyReset } from '../src/sim/longNightReset';
import { spawnGreatWork } from '../src/sim/scenario/threats/giantworks/framework';
import { BEACON_KIND, peekBeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { lossCheck } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { galaxyAgeOf, memoryRecordOf, peekLongNight } from '../src/sim/scenario/threats/giantworks/longNightState';
import { GalaxyLockstepSim } from '../src/net/lockstepSim';
import { LockstepSession } from '../src/net/lockstep';
import { MemoryListener } from '../src/net/transport';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

describe('the Long Night in a multiplayer session', () => {
    it('the host builds Age 2 and every client gets it as a resync: same state, paused, deterministic', async () => {
        const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(['threat-framework', 'giantworks']), flags: {}, options: age3 });
        const g = game.galaxy;
        g.scenario!.flags.gwBeacon = true;
        expect(spawnGreatWork(g, BEACON_KIND)).toBe(true);
        const st = peekBeaconState(g)!;
        st.phase = 'reclamation';
        st.reclamationDate = 1;
        st.popBaseline = 1000;
        st.popEliminated = 900;
        const startOptions = {} as StartGameOptions;
        const replaced: string[] = [];
        const hostSim = new GalaxyLockstepSim(game, new GalaxyTime(), { gameData, startOptions, onGameReplaced: () => replaced.push('host') });
        const clientSim = new GalaxyLockstepSim(null, null, { gameData, startOptions, onGameReplaced: () => replaced.push('client') });
        const logs: string[] = [];
        const host = LockstepSession.host(hostSim, { inputDelay: 3, digestInterval: 30, hooks: { log: (m) => logs.push(m) } });
        hostSim.attach(host);
        const listener = new MemoryListener();
        listener.onLink = (link) => host.accept(link);
        const joined = LockstepSession.join(listener.connect(), clientSim, {});
        for (let i = 0; i < 400 && clientSim.game === null; i++) {
            host.step();
            await tick();
        }
        const client = await joined;
        clientSim.attach(client);
        replaced.length = 0;
        const pump = async (n: number, until: () => boolean = () => false): Promise<void> => {
            for (let i = 0; i < n && !until(); i++) {
                host.step();
                client.step();
                await tick();
            }
        };
        await pump(12);
        expect(host.frame).toBeGreaterThan(5);
        // every peer's sim reaches the trigger on the same frame: both ask for the swap
        const oldClientGame = clientSim.game;
        const cg = clientSim.galaxy;
        setGalaxyResetSupported(hostSim.galaxy, true);
        setGalaxyResetSupported(cg, true);
        lossCheck(hostSim.galaxy, peekBeaconState(hostSim.galaxy)!);
        lossCheck(cg, peekBeaconState(cg)!);
        expect(galaxyResetPending(hostSim.galaxy)).toBe(true);
        expect(galaxyResetPending(cg)).toBe(true);
        // the host builds Age 2 and pushes it; the client builds nothing
        const next = performGalaxyReset(hostSim.game, hostSim.time, gameData);
        hostSim.adopt(next.game, next.time);
        host.gameReplaced();
        await pump(2000, () => clientSim.game !== oldClientGame && client.frame >= host.frame && host.frame > 0);
        expect(clientSim.game).not.toBe(oldClientGame);
        expect(replaced.slice(0, 2)).toEqual(['host', 'client']);
        await pump(20);
        expect(client.clock.paused).toBe(true);
        expect(host.clock.paused).toBe(true);
        expect(galaxyAgeOf(clientSim.galaxy)).toBe(2);
        expect(galaxyAgeOf(hostSim.galaxy)).toBe(2);
        expect(peekLongNight(clientSim.galaxy)!.pending).toBeFalsy();
        expect(memoryRecordOf(clientSim.galaxy)).toEqual(memoryRecordOf(hostSim.galaxy));
        expect(clientSim.galaxy.playerEmpire!.name).toBe(hostSim.galaxy.playerEmpire!.name);
        // the digests agree at the same frame, and the session reports no further mismatch
        for (let i = 0; i < 200 && client.frame < host.frame; i++) {
            client.step();
            await tick();
        }
        expect(clientSim.digest()).toBe(hostSim.digest());
        expect(host.stats.digestMismatches).toBe(0);
        expect(logs.filter((l) => l.startsWith('desync'))).toEqual([]);
    }, 1800000);
});
