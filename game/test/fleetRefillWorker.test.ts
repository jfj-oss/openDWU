// Fleet auto-refill / Replenish (src/sim/player/fleetRefill.ts) through the sim worker host: the commands issued on the
// REPLICA (template, assignment, yard, auto-refill toggle, Replenish) with ships lost in between give the in-thread
// state digest and command log tick for tick, the replacements are queued in both, and the replica shows the status.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { commandLog } from '../src/sim/player/commandLog';
import { issuePlayerCommand } from '../src/sim/player/playerCommands';
import { createSimLoop } from '../src/simLoop';
import type { Camera } from '../src/render/camera';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker } from '../src/simworker/protocol';
import { empireShipGroups, type ShipGroup } from '../src/sim/fleets/shipGroup';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { fleetDesignBook, unassignedWarships } from '../src/sim/player/fleetTemplates';
import { fleetRefillStatus, refillYards } from '../src/sim/player/fleetRefill';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

const NAME = 'Worker Refill';
const fleetOf = (p: Empire): ShipGroup | null => empireShipGroups(p).find((f) => f !== null && f.name === NAME) ?? null;

/** What the UI does, tick by tick, on `g` (the in-thread game or the replica). */
type Step = { tick: number; run: (g: Galaxy, p: Empire, replies: unknown[]) => void };
const STEPS: Step[] = [
    { tick: 1, run: (g, p, r) => issuePlayerCommand(g, p, 'fleetTemplateCreate', [NAME], (x) => r.push(x)) },
    {
        tick: 3,
        run: (g, p, r) => {
            const counts = new Map<BuiltObject['design'], number>();
            for (const b of unassignedWarships(p)) counts.set(b.design, (counts.get(b.design) ?? 0) + 1);
            const id = fleetDesignBook(p).templates.find((t) => t.name === NAME)!.id;
            for (const [d, n] of counts) issuePlayerCommand(g, p, 'fleetTemplateSetEntry', [id, d, n], (x) => r.push(x));
            issuePlayerCommand(g, p, 'fleetTemplateForm', [id, p.capital, false], (x) => r.push((x as { ok: boolean }).ok));
        },
    },
    { tick: 6, run: (g, p, r) => issuePlayerCommand(g, p, 'fleetTemplateRefillYard', [fleetOf(p)!, refillYards(p)[0] ?? null], (x) => r.push(x)) },
    { tick: 8, run: (g, p, r) => issuePlayerCommand(g, p, 'fleetTemplateAutoRefill', [fleetOf(p)!, true], (x) => r.push(x)) },
    { tick: 250, run: (g, p, r) => issuePlayerCommand(g, p, 'fleetTemplateAutoRefill', [fleetOf(p)!, false], (x) => r.push(x)) },
    { tick: 300, run: (g, p, r) => issuePlayerCommand(g, p, 'fleetTemplateReplenish', [fleetOf(p)!], (x) => r.push((x as { queued: number }).queued)) },
];
/** Battle losses, applied to the authoritative game between ticks (identically in both runs). */
const LOSSES: { tick: number; n: number }[] = [
    { tick: 20, n: 1 },
    { tick: 280, n: 1 },
];
const TICKS = 420;

function lose(game: Game, tick: number): void {
    for (const l of LOSSES) {
        if (l.tick !== tick) continue;
        const f = fleetOf(game.playerEmpire)!;
        for (const b of f.ships.slice(0, l.n)) builtObjectCompleteTeardown(game.galaxy, b);
    }
}

function prepare(): Game {
    const game = cachedTickGame(gameData);
    game.playerEmpire.controlMilitaryFleets = false;
    game.playerEmpire.stateMoney = 2_000_000;
    return game;
}

describe('sim worker: fleet auto-refill and Replenish', () => {
    it('commands issued on the replica give the in-thread digest, log, replies and replacements', () => {
        // In-thread reference: the app loop.
        const ref = prepare();
        const rt = new GalaxyTime();
        rt.paused = false;
        rt.speed = 4;
        const loop = createSimLoop(ref.galaxy, rt, {} as Camera, false);
        (loop.budget as { now: () => number }).now = fakeClock();
        const refReplies: unknown[] = [];
        for (let t = 0; t < TICKS; t++) {
            for (const s of STEPS) if (s.tick === t) s.run(ref.galaxy, ref.playerEmpire, refReplies);
            lose(ref, t);
            loop.tick(FRAME_REAL_MS);
        }

        // Worker: host + client in-process, the steps issued on the replica.
        const game = prepare();
        const time = new GalaxyTime();
        time.paused = false;
        time.speed = 4;
        const host = new SimHost(game, time, {} as StartGameOptions, { now: fakeClock() });
        const toHost = (m: ToWorker): void => {
            const c = structuredClone(m);
            if (c.type === 'command') host.command(c);
            else if (c.type === 'clock') host.clock(c);
            else if (c.type === 'refresh') host.refresh(c);
        };
        const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: toHost, now: fakeClock() });
        const ui = new GalaxyTime();
        ui.bindGalaxy(client.galaxy);
        ui.speed = 4;
        ui.paused = false;
        const tick = (): void => {
            client.syncClock(ui);
            const m = host.tick(FRAME_REAL_MS);
            if (m !== null) client.receive(structuredClone(m));
            client.frame(ui);
        };
        const wkReplies: unknown[] = [];
        for (let t = 0; t < TICKS; t++) {
            if (STEPS.some((s) => s.tick === t)) client.replica.apply(structuredClone(host.sync.delta(true)), true);
            for (const s of STEPS) if (s.tick === t) s.run(client.galaxy, client.game.playerEmpire, wkReplies);
            lose(game, t);
            tick();
        }
        expect(game.galaxy.nowMs).toBe(ref.galaxy.nowMs);
        expect(JSON.stringify(commandLog(game.galaxy))).toBe(JSON.stringify(commandLog(ref.galaxy)));
        expect(host.digest()).toBe(stateDigest(ref.galaxy));
        // Let the last replies land.
        ui.paused = true;
        for (let t = 0; t < 40; t++) tick();
        expect(wkReplies).toEqual(refReplies);
        // The refill happened: one replacement from auto-refill, one from Replenish.
        const refOrders = fleetDesignBook(ref.playerEmpire).orders.filter((o) => o.refillLinkId !== undefined);
        expect(refOrders.reduce((s, o) => s + o.queued, 0)).toBe(2);
        expect(refReplies[refReplies.length - 1]).toBe(1);
        // The replica shows the same status as the worker's game.
        client.replica.apply(structuredClone(host.sync.delta(true)), true);
        expect(stateDigest(client.galaxy)).toBe(host.digest());
        const rs = fleetRefillStatus(client.galaxy, client.game.playerEmpire, fleetOf(client.game.playerEmpire)!)!;
        const as = fleetRefillStatus(game.galaxy, game.playerEmpire, fleetOf(game.playerEmpire)!)!;
        expect({ b: rs.building, m: rs.missing, at: rs.buildingAt, auto: rs.link.autoRefill }).toEqual({ b: as.building, m: as.missing, at: as.buildingAt, auto: as.link.autoRefill });
        expect(rs.building).toBe(2);
        client.dispose();
        host.dispose();
    }, 900000);
});
