// Sim worker, chunk 3 (docs/sim-worker.md §9): map overlays, the trade-flow ledger and the rim scenario wiring, with
// the host + replica client driven in-process (as test/simWorker.test.ts does).
// - Trade flows: the overlay's enable / disable on the REPLICA galaxy switch recording in the worker; the ledger the
//   replica reads (tradeFlowLedger, flowsInWindow, the freighter leaders) equals the in-thread ledger of the same run;
//   recording moves no digest; the placeholder / stale-view hand-over around the toggle.
// - Rim atmosphere: the per-system rim weights and name overrides are installed in the worker before the first tick
//   (the in-thread MainView.init point), reach the replica with the snapshot, and the replica install is a no-op;
//   the run gives the in-thread digest.
// - Territory overlay (render/territoryField.ts): the replica carries the influence sources and the rebuild
//   signature follows the authoritative one.
// - The overlay readers leave the replica untouched (its save text before and after is the same).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { createSimLoop } from '../src/simLoop';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import { BuiltObject } from '../src/sim/builtObject';
import type { Camera } from '../src/render/camera';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { installWorkerBootState, SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker } from '../src/simworker/protocol';
import { fillFreighterDestinations, TRADE_FLOWS_SIDE_KEY } from '../src/simworker/tradeFlowSync';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import {
    disableTradeFlowRecording,
    empirePairTotals,
    enableTradeFlowRecording,
    flowCategory,
    flowsInWindow,
    hubsInWindow,
    tradeFlowLedger,
    type FlowRow,
    type TradeFlowLedger,
} from '../src/sim/logistics/tradeFlows';
import { contractListenersActive } from '../src/sim/logistics/contractEvents';
import { GalaxyScenario } from '../src/sim/scenario/state';
import { RIM_WEIGHTS_STATE_KEY } from '../src/sim/scenario/rimState';
import { RIM_NAMES_STATE_KEY } from '../src/sim/scenario/rimNames';
import { installRimAtmosphereData } from '../src/render/rimAtmosphereWiring';
import { setRemoteCommandSink } from '../src/sim/player/playerCommands';
import { collectTerritorySources, TerritoryGrid, territorySignature } from '../src/render/territoryField';
import { scenarioMapFeatures } from '../src/sim/scenario/mapFeatures';
import type { StellarObject } from '../src/sim/logistics/contracts';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const START_OPTIONS = {} as StartGameOptions;
const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const c of cleanups.splice(0).reverse()) c();
});

function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

interface Wired {
    host: SimHost;
    client: SimClientCore;
    tick: () => void;
    /** A full compare applied at once: the replica exactly current. */
    settle: () => void;
    time: GalaxyTime;
}

/** Host + client wired in-process (messages structured-cloned as postMessage would). */
function connect(game: Game, time: GalaxyTime): Wired {
    const host = new SimHost(game, time, START_OPTIONS, { now: fakeClock() });
    const snap = structuredClone(host.snapshot());
    const toHost = (m: ToWorker): void => {
        const c = structuredClone(m);
        if (c.type === 'command') host.command(c);
        else if (c.type === 'clock') host.clock(c);
        else if (c.type === 'tradeFlows') host.setTradeFlowRecording(c);
    };
    const client = new SimClientCore(gameData, snap, { post: toHost, now: fakeClock() });
    const uiTime = new GalaxyTime();
    uiTime.bindGalaxy(client.galaxy);
    uiTime.speed = time.speed;
    uiTime.paused = time.paused;
    const tick = (): void => {
        client.syncClock(uiTime);
        const m = host.tick(FRAME_REAL_MS);
        if (m !== null) client.receive(structuredClone(m));
        client.frame(uiTime);
    };
    const settle = (): void => {
        host.tradeFlows.refresh(true);
        client.replica.apply(structuredClone(host.sync.delta(true)), true);
    };
    const w = { host, client, tick, settle, time: uiTime };
    cleanups.push(() => {
        client.dispose();
        host.dispose();
    });
    return w;
}

/** The in-thread app loop (simLoop.ts), one render frame of exactly FRAME_REAL_MS per call. */
function inThread(game: Game): { tick: () => void } {
    const time = new GalaxyTime();
    time.paused = false;
    const loop = createSimLoop(game.galaxy, time, {} as Camera, false);
    (loop.budget as { now: () => number }).now = fakeClock();
    return { tick: () => loop.tick(FRAME_REAL_MS) };
}

/** A stellar object by game identity (comparable across the in-thread game, the worker's and the replica). */
function objKey(o: StellarObject | null): string {
    if (o === null) return '-';
    return o instanceof BuiltObject ? `b${o.builtObjectID}` : `h${(o as { habitatIndex: number }).habitatIndex}`;
}

/** The ledger's recorded content by game identity (what the overlay and panel read; not `index`, see tradeFlowSync.ts). */
function canonicalLedger(l: TradeFlowLedger): string {
    return JSON.stringify({
        version: l.version,
        start: l.startStarDate,
        entries: l.entries.map((e) => ({
            from: objKey(e.sellingPoint),
            to: objKey(e.destination),
            r: e.resourceId,
            c: e.componentId,
            sys: [e.sellerSystem, e.destSystem],
            pos: [e.postFromX, e.postFromY, e.postToX, e.postToY, e.sysFromX, e.sysFromY, e.sysToX, e.sysToY],
            slots: [...e.slotMonth],
            value: [...e.value],
            amount: [...e.amount],
            count: [...e.count],
            sellers: [...e.sellers].map((x) => x.empireId).sort((a, b) => a - b),
            buyers: [...e.buyers].map((x) => x.empireId).sort((a, b) => a - b),
            last: e.lastStarDate,
        })),
    });
}

function canonicalRows(rows: readonly FlowRow[]): string {
    return JSON.stringify(
        rows.map((r) => ({
            key: r.key,
            from: [r.fromX, r.fromY],
            to: [r.toX, r.toY],
            sp: objKey(r.sellingPoint),
            d: objKey(r.destination),
            res: r.resourceIds,
            cat: r.category.key,
            v: r.value,
            a: r.amount,
            n: r.count,
            vy: r.valuePerYear,
            rec: r.recency,
            s: r.sellers.map((e) => e.empireId),
            b: r.buyers.map((e) => e.empireId),
        })),
    );
}

function canonicalDest(galaxy: Galaxy, dest: { get(b: BuiltObject): StellarObject | undefined }): string {
    const out: string[] = [];
    for (const bo of galaxy.builtObjects) {
        if (bo === null || bo === undefined || bo.hasBeenDestroyed || bo.contractsToFulfill.length === 0) continue;
        const d = dest.get(bo);
        if (d !== undefined) out.push(`${objKey(bo)}>${objKey(d)}`);
    }
    return out.sort().join(',');
}

const RUN_MS = 40_000;

describe('sim worker chunk 3: the trade-flow ledger through the host', () => {
    it('the replica reads the in-thread ledger, recording runs in the worker and moves no digest', () => {
        // In-thread reference: recording switched on before the first frame, as the overlay does at view start.
        const ref = cachedTickGame(gameData);
        enableTradeFlowRecording(ref.galaxy, galaxyStarDate(ref.galaxy));
        cleanups.push(() => disableTradeFlowRecording(ref.galaxy));
        const loop = inThread(ref);
        let ticks = 0;
        while (ref.galaxy.nowMs < RUN_MS) {
            loop.tick();
            ticks++;
        }

        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        const w = connect(game, time);
        const rg = w.client.galaxy;
        // What the freight overlay calls (freightOverlay.ts syncRecording), on the replica.
        const first = enableTradeFlowRecording(rg, galaxyStarDate(rg));
        // Nothing recorded on the main thread: the replica has no listener of its own; the placeholder stands in.
        expect(tradeFlowLedger(rg)).toBe(first);
        expect(first.entries.length).toBe(0);
        expect(w.host.tradeFlows.isRecording).toBe(true);
        expect(tradeFlowLedger(game.galaxy)).not.toBeNull();
        let wTicks = 0;
        while (game.galaxy.nowMs < RUN_MS) {
            w.tick();
            wTicks++;
        }
        expect(wTicks).toBe(ticks);
        expect(w.host.digest()).toBe(stateDigest(ref.galaxy));

        const refLedger = tradeFlowLedger(ref.galaxy)!;
        const authLedger = tradeFlowLedger(game.galaxy)!;
        expect(refLedger.version).toBeGreaterThan(0);
        expect(canonicalLedger(authLedger)).toBe(canonicalLedger(refLedger));

        // Through the ordinary cold cycle the replica already holds a synced ledger (not the placeholder).
        const coldSynced = tradeFlowLedger(rg)!;
        expect(coldSynced).not.toBe(first);
        expect(coldSynced.entries.length).toBeGreaterThan(0);

        // After a full compare it is exact.
        w.settle();
        const rl = tradeFlowLedger(rg)!;
        expect(canonicalLedger(rl)).toBe(canonicalLedger(refLedger));
        // Replica identity: every entry's endpoints and empires are replica objects.
        for (const e of rl.entries) {
            expect(w.client.replica.decoder.idOf(e.sellingPoint)).toBeGreaterThanOrEqual(0);
            expect(w.client.replica.decoder.idOf(e.destination)).toBeGreaterThanOrEqual(0);
            for (const s of e.sellers) expect(rg.empires.includes(s) || rg.pirateEmpires.includes(s) || s === rg.independentEmpire).toBe(true);
        }
        // The overlay's and the panel's queries give the in-thread rows.
        const now = galaxyStarDate(ref.galaxy);
        expect(galaxyStarDate(rg)).toBe(now);
        for (const level of ['system', 'post'] as const) {
            for (const months of [1, 12]) {
                const a = flowsInWindow(refLedger, now, months, { categoryOf: (r, c) => flowCategory(ref.galaxy, r, c) }, level);
                const b = flowsInWindow(rl, now, months, { categoryOf: (r, c) => flowCategory(rg, r, c) }, level);
                expect(canonicalRows(b)).toBe(canonicalRows(a));
            }
        }
        const player = rg.playerEmpire!;
        const refPlayer = ref.galaxy.playerEmpire!;
        expect(canonicalRows(flowsInWindow(rl, now, 12, { empire: player }))).toBe(canonicalRows(flowsInWindow(refLedger, now, 12, { empire: refPlayer })));
        const hubs = (g: Galaxy) => JSON.stringify(hubsInWindow(g, now).map((h) => [objKey(h.port), h.owner?.empireId ?? -1, h.income]));
        expect(hubs(rg)).toBe(hubs(ref.galaxy));
        const pairs = (g: Galaxy) => JSON.stringify(empirePairTotals(g, now).map((p) => [p.a.empireId, p.b.empireId, p.value]));
        expect(pairs(rg)).toBe(pairs(ref.galaxy));
        // The in-flight leaders' freighter → destination set (freightOverlay.ts buildLeaders).
        expect(canonicalDest(rg, rl.freighterDestination)).toBe(canonicalDest(ref.galaxy, refLedger.freighterDestination));
        const live = new Map<BuiltObject, StellarObject>();
        fillFreighterDestinations(ref.galaxy, refLedger.freighterDestination, live);
        expect((rl.freighterDestination as unknown as Map<BuiltObject, StellarObject>).size).toBe(live.size);
        console.log(`[sw chunk 3] ${rl.entries.length} flow series, version ${rl.version}, ${live.size} freighters in flight`);

        // Recording off: the worker drops its listener and ledger; the replica reads null at once.
        disableTradeFlowRecording(rg);
        expect(tradeFlowLedger(rg)).toBeNull();
        expect(w.host.tradeFlows.isRecording).toBe(false);
        expect(tradeFlowLedger(game.galaxy)).toBeNull();
        // Back on before the "off" synced: the old view is not shown again; a fresh placeholder is.
        const again = enableTradeFlowRecording(rg, galaxyStarDate(rg));
        expect(again).not.toBe(rl);
        expect(again.entries.length).toBe(0);
        expect(tradeFlowLedger(rg)).toBe(again);
        w.settle();
        const fresh = tradeFlowLedger(rg)!;
        expect(fresh).not.toBe(rl);
        expect(fresh).not.toBe(again);
        expect(fresh.startStarDate).toBe(galaxyStarDate(game.galaxy));
        disableTradeFlowRecording(rg);
        w.settle();
        expect((w.client.replica.decoder.object(1) as Record<string, unknown>)[TRADE_FLOWS_SIDE_KEY]).toBeUndefined();
        disableTradeFlowRecording(ref.galaxy);
        expect(contractListenersActive()).toBe(false);
    }, 1_200_000);

    it('host dispose drops the worker recording', () => {
        const game = cachedTickGame(gameData);
        const w = connect(game, new GalaxyTime());
        enableTradeFlowRecording(w.client.galaxy);
        expect(contractListenersActive()).toBe(true);
        w.client.dispose();
        w.host.dispose();
        expect(contractListenersActive()).toBe(false);
        expect(tradeFlowLedger(game.galaxy)).toBeNull();
    }, 600000);
});

function withRim(game: Game): void {
    const s = new GalaxyScenario();
    s.id = 'rim-test';
    s.flags = { rimAtmosphere: true };
    s.params = { rimInner: 0.6 };
    game.galaxy.scenario = s;
}

describe('sim worker chunk 3: rim atmosphere wiring in the worker', () => {
    it('installs before the first tick, reaches the replica, and the run gives the in-thread digest', () => {
        // In-thread: MainView.init installs it before the first frame.
        const ref = cachedTickGame(gameData);
        withRim(ref);
        installRimAtmosphereData(ref.galaxy);
        const refState = ref.galaxy.scenario!.state;
        expect((refState[RIM_WEIGHTS_STATE_KEY] as number[]).length).toBe(ref.galaxy.systems.length);
        expect((refState[RIM_WEIGHTS_STATE_KEY] as number[]).some((x) => x > 0)).toBe(true);
        expect(Object.keys(refState[RIM_NAMES_STATE_KEY] as object).length).toBeGreaterThan(0);

        const game = cachedTickGame(gameData);
        withRim(game);
        installWorkerBootState(game.galaxy);
        const time = new GalaxyTime();
        time.paused = false;
        const w = connect(game, time);
        const rg = w.client.galaxy;
        // With the snapshot, before any tick.
        expect(JSON.stringify(rg.scenario!.state[RIM_WEIGHTS_STATE_KEY])).toBe(JSON.stringify(refState[RIM_WEIGHTS_STATE_KEY]));
        expect(JSON.stringify(rg.scenario!.state[RIM_NAMES_STATE_KEY])).toBe(JSON.stringify(refState[RIM_NAMES_STATE_KEY]));
        // The view's own install (MainView.init) is a no-op on the replica: it never writes replica state. (A replica
        // write would never be repaired: the worker's value does not change, so no delta re-sends it.)
        const before = JSON.stringify(rg.scenario!.state);
        installRimAtmosphereData(rg);
        expect(JSON.stringify(rg.scenario!.state)).toBe(before);
        // ... even where the state is missing: any galaxy with a remote command sink counts as a replica.
        const bare = { scenario: Object.assign(new GalaxyScenario(), { flags: { rimAtmosphere: true } }), systems: ref.galaxy.systems, sizeX: ref.galaxy.sizeX, sizeY: ref.galaxy.sizeY, randomSeed: 1 } as unknown as Galaxy;
        installRimAtmosphereData(bare);
        expect(Object.keys(bare.scenario!.state).length).toBe(2);
        const bareReplica = { ...bare, scenario: Object.assign(new GalaxyScenario(), { flags: { rimAtmosphere: true } }) } as unknown as Galaxy;
        setRemoteCommandSink(bareReplica, () => undefined);
        installRimAtmosphereData(bareReplica);
        expect(bareReplica.scenario!.state).toEqual({});
        setRemoteCommandSink(bareReplica, null);

        const loop = inThread(ref);
        for (let i = 0; i < 600; i++) {
            loop.tick();
            w.tick();
        }
        expect(game.galaxy.nowMs).toBe(ref.galaxy.nowMs);
        expect(w.host.digest()).toBe(stateDigest(ref.galaxy));
        w.settle();
        expect(JSON.stringify(rg.scenario!.state)).toBe(JSON.stringify(ref.galaxy.scenario!.state));
    }, 1_200_000);

    it('a game without the flag installs nothing', () => {
        const game = cachedTickGame(gameData);
        const before = JSON.stringify(game.galaxy.scenario?.state ?? null);
        installWorkerBootState(game.galaxy);
        expect(JSON.stringify(game.galaxy.scenario?.state ?? null)).toBe(before);
    }, 600000);
});

describe('sim worker chunk 3: map overlays on the replica', () => {
    it('the territory sources and rebuild signature follow the authoritative game; the overlay readers write nothing', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        const w = connect(game, time);
        const rg = w.client.galaxy;
        const grid = new TerritoryGrid(rg.sizeX, rg.sizeY);
        const sig = (g: Galaxy): number => territorySignature(collectTerritorySources(g, g.playerEmpire), grid.cell);
        const srcs = (g: Galaxy): string => JSON.stringify(collectTerritorySources(g, g.playerEmpire));
        expect(collectTerritorySources(rg, rg.playerEmpire).length).toBeGreaterThan(0);
        expect(srcs(rg)).toBe(srcs(game.galaxy));
        expect(sig(rg)).toBe(sig(game.galaxy));
        const sigs = new Set<number>([sig(game.galaxy)]);
        for (let i = 0; i < 6; i++) {
            for (let k = 0; k < 600; k++) w.tick();
            sigs.add(sig(game.galaxy));
            w.settle();
            expect(srcs(rg)).toBe(srcs(game.galaxy));
            expect(sig(rg)).toBe(sig(game.galaxy));
        }
        console.log(`[sw chunk 3] territory signatures over 60 s: ${sigs.size}`);

        // The overlay readers (empireLayer / territoryField, overlayLayer's scenario markers, the freight overlay and
        // Trade Flows panel queries) on the replica leave its save text unchanged.
        enableTradeFlowRecording(rg);
        for (let k = 0; k < 600; k++) w.tick();
        w.settle();
        const text = JSON.stringify(galaxyToJSON(rg));
        const now = galaxyStarDate(rg);
        collectTerritorySources(rg, rg.playerEmpire);
        for (const e of rg.empires) collectTerritorySources(rg, e);
        scenarioMapFeatures(rg, rg.playerEmpire);
        const l = tradeFlowLedger(rg)!;
        flowsInWindow(l, now, 12, { categoryOf: (r, c) => flowCategory(rg, r, c) }, 'system');
        flowsInWindow(l, now, 1, { categoryOf: (r, c) => flowCategory(rg, r, c) }, 'post');
        hubsInWindow(rg, now);
        empirePairTotals(rg, now);
        expect(JSON.stringify(galaxyToJSON(rg)) === text).toBe(true);
        expect(stateDigest(rg)).toBe(w.host.digest());
    }, 1_200_000);
});
