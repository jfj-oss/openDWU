// Sim worker: quick repeated clicks (docs/sim-worker.md §4.4 "Quick repeats", src/ui/pendingCommands.ts). A control that
// computes its next value from what the game shows reads state one command reply behind — in-thread for the rest of the
// frame, in sim-worker mode for a whole round trip. The controls compute from the value they last sent until its reply
// lands, so:
// - N clicks give N steps in both modes (Colonies tax spinner, Fleets troop-loadout spinners, Fleet Designs + / −), with
//   the same command log and state digest as in-thread, also with replies several ticks late;
// - a double-clicked Expansion Planner "Build and Send Colony Ship" buys one ship in both modes;
// - the Empire Policy automation combos issue the same setEmpireControl commands in both modes (X → Y → X in quick
//   succession sends all three);
// - without the overlay (the old code) worker mode loses steps / buys twice (the tests would catch a regression).
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/toast', () => ({ showToast: vi.fn() }));

import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { commandLog } from '../src/sim/player/commandLog';
import { issuePlayerCommand } from '../src/sim/player/playerCommands';
import { empireShipGroups, type ShipGroup } from '../src/sim/fleets/shipGroup';
import type { TroopLoadout } from '../src/sim/player/fleetOps';
import { fleetDesignBook } from '../src/sim/player/fleetTemplates';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { findNewestCanBuild } from '../src/sim/designGeneration';
import { canEmpireColonizeHabitat } from '../src/sim/exploration';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { defaultEmpirePolicy } from '../src/sim/data/policies';
import { planetaryFacilityDefinitionsStatic } from '../src/sim/construction/facilities';
import { createSimLoop } from '../src/simLoop';
import type { Camera } from '../src/render/camera';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { StepMessage, ToWorker } from '../src/simworker/protocol';
import { PendingOnce, PendingValues } from '../src/ui/pendingCommands';
import { colonyTaxPercent, displayedColonyTaxPercent, issueColonyTaxRate } from '../src/ui/screens/coloniesScreen';
import { displayedFleetTroopLoadout, fleetLoadoutSpin, issueFleetTroopLoadout } from '../src/ui/screens/fleetsList';
import { FleetTemplateCounts, fleetTemplateDesignGroups } from '../src/ui/screens/fleetDesignsTab';
import { plannerBuildColonyShip } from '../src/ui/screens/expansionPlanner';
import { buildPolicyPanel, issuePolicyPanel, panelControls, type ComboControl } from '../src/ui/screens/empirePolicyModel';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const START_OPTIONS = {} as StartGameOptions;

function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

/** The UI's per-screen state (the overlays the screens hold), one per run. `naive`: no overlay (the old code). */
class Ui {
    readonly tax = new PendingValues<Habitat, number>();
    readonly loadout = new PendingValues<ShipGroup, TroopLoadout | null>();
    readonly counts = new FleetTemplateCounts();
    readonly busy = new PendingOnce<Habitat>();
    readonly policy = new PendingValues<string, unknown>();
    readonly replies: string[] = [];
    constructor(readonly naive = false) {}
    /** An overlay as the click sees it: the screen's, or a fresh one per click (nothing remembered: the old code). */
    pv<K, V>(own: PendingValues<K, V>): PendingValues<K, V> {
        return this.naive ? new PendingValues<K, V>() : own;
    }
}

/** A UI action at tick `tick` (on the in-thread game, or on the replica in worker mode). */
interface Click {
    tick: number;
    run: (g: Galaxy, p: Empire, ui: Ui) => void;
}

/** In-thread: the real app loop, one render frame of FRAME_REAL_MS per tick; clicks before the frame. */
function runInThread(game: Game, clicks: readonly Click[], ticks: number, ui = new Ui()): { log: string; digest: string; game: Game; ui: Ui } {
    const time = new GalaxyTime();
    time.paused = false;
    const loop = createSimLoop(game.galaxy, time, {} as Camera, false);
    (loop.budget as { now: () => number }).now = fakeClock();
    for (let t = 0; t < ticks; t++) {
        for (const c of clicks) if (c.tick === t) c.run(game.galaxy, game.playerEmpire, ui);
        loop.tick(FRAME_REAL_MS);
    }
    return { log: JSON.stringify(commandLog(game.galaxy)), digest: stateDigest(game.galaxy), game, ui };
}

/**
 * Worker mode: host + replica in-process; the worker's step messages reach the main thread `latency` ticks late (a
 * round trip longer than a frame). Clicks run on the replica before the tick, so they reach the same boundaries as
 * in-thread.
 */
function runWorker(game: Game, clicks: readonly Click[], ticks: number, latency: number, ui = new Ui()): { log: string; digest: string; host: SimHost; client: SimClientCore; ui: Ui; settle: () => void } {
    const time = new GalaxyTime();
    time.paused = false;
    const host = new SimHost(game, time, START_OPTIONS, { now: fakeClock() });
    const toHost = (m0: ToWorker): void => {
        const m = structuredClone(m0);
        if (m.type === 'command') host.command(m);
        else if (m.type === 'clock') host.clock(m);
        else if (m.type === 'refresh') host.refresh(m);
        else if (m.type === 'hostOp') host.hostOp(m);
    };
    let wall = 0;
    const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: toHost, now: () => wall });
    const uiTime = new GalaxyTime();
    uiTime.bindGalaxy(client.galaxy);
    uiTime.speed = time.speed;
    uiTime.paused = false;
    const inFlight: { at: number; m: StepMessage }[] = [];
    let t = 0;
    const tick = (): void => {
        wall += FRAME_REAL_MS;
        client.syncClock(uiTime);
        const m = host.tick(FRAME_REAL_MS);
        if (m !== null) inFlight.push({ at: t + latency, m: structuredClone(m) });
        while (inFlight.length > 0 && inFlight[0].at <= t) client.receive(inFlight.shift()!.m);
        client.frame(uiTime);
        t++;
    };
    for (; t < ticks; ) {
        for (const c of clicks) if (c.tick === t) c.run(client.galaxy, client.game.playerEmpire, ui);
        tick();
    }
    const log = JSON.stringify(commandLog(game.galaxy));
    const digest = host.digest();
    // The last replies arrive (the game paused).
    const settle = (): void => {
        uiTime.paused = true;
        for (let i = 0; i < latency + 10; i++) tick();
    };
    return { log, digest, host, client, ui, settle };
}

const firstColony = (p: Empire): Habitat => p.colonies[0];

/** The player's first fleet (one is formed from idle military ships at tick 0 when there is none). */
function firstFleet(p: Empire): ShipGroup | null {
    return empireShipGroups(p)[0] ?? null;
}
const formFleetIfNone: Click = {
    tick: 0,
    run: (g, p) => {
        // The Fleet Formation automation would disband an idle fleet of AI-controlled ships that it counts as surplus
        // (Empire.9.cs MaintainShipGroups, shipGroupTasks.ts maintainShipGroups): off first (both modes), as the tax
        // test turns off the tax automation.
        issuePlayerCommand(g, p, 'setEmpireControl', ['controlMilitaryFleets', false]);
        if (firstFleet(p) !== null) return;
        const ships = p.builtObjects.filter((b) => b != null && b.role === BuiltObjectRole.Military && b.shipGroup === null).slice(0, 2);
        issuePlayerCommand(g, p, 'setShipsFleet', [ships, 'new']);
    },
};

describe('sim worker: quick repeated clicks — N clicks give N steps in both modes', () => {
    it('Colonies tax spinner: N clicks inside one frame / one per tick, replies 3 ticks late — N steps, same log and digest', () => {
        const base = cachedTickGame(gameData);
        const start = colonyTaxPercent(firstColony(base.playerEmpire).taxRate);
        const dir = start > 40 ? -1 : 1;
        const N = 5;
        // A spinner click: the browser steps the box's own value (the box keeps it while focused); the change handler
        // issues the steps from the rate shown — the last one sent (the old code: the colony's rate on the replica).
        let box: number | null = null;
        const click = (tick: number): Click => ({
            tick,
            run: (g, p, ui) => {
                const h = firstColony(p);
                box = (box ?? displayedColonyTaxPercent(h, ui.tax)) + dir;
                issueColonyTaxRate(g, p, h, box, ui.pv(ui.tax));
            },
        });
        const reset = (): void => {
            box = null;
        };
        const clicks: Click[] = [
            // The automation would set the rates itself: off first (both modes).
            { tick: 0, run: (g, p) => issuePlayerCommand(g, p, 'setEmpireControl', ['controlColonyTaxRates', false]) },
            // N clicks within one frame, then N more one per tick.
            ...Array.from({ length: N }, () => click(2)),
            ...Array.from({ length: N }, (_, i) => click(4 + i)),
        ];
        const ticks = 14;
        const ref = runInThread(cachedTickGame(gameData), clicks, ticks);
        reset();
        const wk = runWorker(cachedTickGame(gameData), clicks, ticks, 3);
        const want = Math.max(0, Math.min(50, start + dir * 2 * N));
        expect(colonyTaxPercent(firstColony(ref.game.playerEmpire).taxRate)).toBe(want);
        expect(colonyTaxPercent(firstColony(wk.host.game.playerEmpire).taxRate)).toBe(want);
        expect(wk.log).toBe(ref.log);
        expect(wk.digest).toBe(ref.digest);
        wk.settle();
        // The replies landed: the box shows the game's rate again (nothing left pending).
        expect(wk.ui.tax.size).toBe(0);
        expect(displayedColonyTaxPercent(firstColony(wk.client.game.playerEmpire), wk.ui.tax)).toBe(want);
        expect(wk.client.pendingReplies).toBe(0);
        wk.client.dispose();
        wk.host.dispose();

        // The old code (each click's steps from the replica's rate) overshoots in worker mode.
        reset();
        const naive = runWorker(cachedTickGame(gameData), clicks, ticks, 3, new Ui(true));
        expect(colonyTaxPercent(firstColony(naive.host.game.playerEmpire).taxRate)).not.toBe(want);
        naive.client.dispose();
        naive.host.dispose();
    }, 600000);

    it('Fleets troop-loadout spinners: N clicks give N percent, the check box too, in both modes', () => {
        const N = 4;
        const spin = (tick: number): Click => ({
            tick,
            run: (g, p, ui) => {
                const sg = firstFleet(p)!;
                const l = displayedFleetTroopLoadout(sg, ui.pv(ui.loadout));
                if (l === null) return;
                issueFleetTroopLoadout(g, p, sg, fleetLoadoutSpin(l, 'armored', l.armored + 1), ui.pv(ui.loadout));
            },
        });
        const clicks: Click[] = [
            formFleetIfNone,
            // "Use Troop Loadouts" on (100 % infantry), then infantry down to 50 and N armored clicks, in quick succession.
            { tick: 8, run: (g, p, ui) => issueFleetTroopLoadout(g, p, firstFleet(p)!, { infantry: 100, armored: 0, artillery: 0, specialForces: 0 }, ui.pv(ui.loadout)) },
            {
                tick: 9,
                run: (g, p, ui) => {
                    const sg = firstFleet(p)!;
                    const l = displayedFleetTroopLoadout(sg, ui.pv(ui.loadout));
                    if (l !== null) issueFleetTroopLoadout(g, p, sg, fleetLoadoutSpin(l, 'infantry', 50), ui.pv(ui.loadout));
                },
            },
            ...Array.from({ length: N }, (_, i) => spin(10 + Math.floor(i / 2))),
        ];
        const ticks = 18;
        const ref = runInThread(cachedTickGame(gameData), clicks, ticks);
        expect(firstFleet(ref.game.playerEmpire), 'the harness game has (or forms) a player fleet').not.toBeNull();
        const wk = runWorker(cachedTickGame(gameData), clicks, ticks, 3);
        for (const sg of [firstFleet(ref.game.playerEmpire)!, firstFleet(wk.host.game.playerEmpire)!]) {
            expect([sg.troopLoadoutInfantry, sg.troopLoadoutArmored, sg.troopLoadoutArtillery, sg.troopLoadoutSpecialForces]).toEqual([50, N, 0, 0]);
        }
        expect(wk.log).toBe(ref.log);
        expect(wk.digest).toBe(ref.digest);
        wk.settle();
        expect(wk.ui.loadout.size).toBe(0);
        wk.client.dispose();
        wk.host.dispose();

        const naive = runWorker(cachedTickGame(gameData), clicks, ticks, 3, new Ui(true));
        const nsg = firstFleet(naive.host.game.playerEmpire)!;
        expect([nsg.troopLoadoutInfantry, nsg.troopLoadoutArmored]).not.toEqual([50, N]);
        naive.client.dispose();
        naive.host.dispose();
    }, 600000);

    it('Fleet Designs + / −: N clicks give N ships in the design, in both modes', () => {
        const N = 6;
        const template = (p: Empire) => fleetDesignBook(p).templates.find((t) => t.name === 'Quick Clicks') ?? null;
        const design = (p: Empire) => fleetTemplateDesignGroups(p)[0].designs[0];
        const plus = (tick: number, by = 1): Click => ({
            tick,
            run: (_g, p, ui) => {
                const t = template(p)!;
                (ui.naive ? new FleetTemplateCounts() : ui.counts).step(p, t, design(p), by);
            },
        });
        const clicks: Click[] = [
            { tick: 0, run: (g, p) => issuePlayerCommand(g, p, 'fleetTemplateCreate', ['Quick Clicks']) },
            ...Array.from({ length: N }, () => plus(6)),
            ...Array.from({ length: N }, (_, i) => plus(7 + i)),
            plus(7 + N, -1),
            plus(7 + N, -1),
        ];
        const ticks = 7 + N + 6;
        const ref = runInThread(cachedTickGame(gameData), clicks, ticks);
        const wk = runWorker(cachedTickGame(gameData), clicks, ticks, 3);
        for (const p of [ref.game.playerEmpire, wk.host.game.playerEmpire]) {
            expect(template(p)!.entries.find((e) => e.design === design(p))?.count).toBe(2 * N - 2);
        }
        expect(wk.log).toBe(ref.log);
        expect(wk.digest).toBe(ref.digest);
        wk.settle();
        const rp = wk.client.game.playerEmpire;
        expect(wk.ui.counts.count(template(rp)!, design(rp))).toBe(2 * N - 2);
        wk.client.dispose();
        wk.host.dispose();

        const naive = runWorker(cachedTickGame(gameData), clicks, ticks, 3, new Ui(true));
        const np = naive.host.game.playerEmpire;
        expect(template(np)!.entries.find((e) => e.design === design(np))?.count).not.toBe(2 * N - 2);
        naive.client.dispose();
        naive.host.dispose();
    }, 600000);
});

describe('sim worker: one-shot purchases', () => {
    it('a double-clicked "Build and Send Colony Ship" buys one ship in both modes (one order; the game refuses a second)', () => {
        // A target the player can colonize with its newest colony ship (the planner's own checks), by index: one it has
        // explored, or else (the harness game's player may have explored none it can settle yet) the nearest one it could
        // settle once its system is explored — that system is then explored in every copy of the game (the
        // ResolveSystemVisibility outcome of a scout's visit), before the clicks.
        const key = { age: 2 };
        const probe = cachedTickGame(gameData, key);
        const pp = probe.playerEmpire;
        const ship = findNewestCanBuild(pp.designs, BuiltObjectSubRole.ColonyShip, pp);
        expect(ship, 'the player can build a colony ship').not.toBeNull();
        const types = pp.colonizableHabitatTypesForEmpire();
        const colonizable = (h: Habitat | null): boolean => h != null && canEmpireColonizeHabitat(probe.galaxy, pp, pp, h, types, ship!);
        let index = probe.galaxy.habitats.findIndex(colonizable);
        let explore: number | null = null;
        if (index < 0) {
            const cap = pp.capital!;
            let best = Infinity;
            probe.galaxy.habitats.forEach((h, i) => {
                if (h == null || pp.visibility.checkSystemExplored(h.systemIndex)) return;
                const v = pp.visibility.systemVisibility[h.systemIndex];
                const was = v.status;
                v.status = SystemVisibilityStatus.Explored;
                const d = probe.galaxy.calculateDistance(cap.xpos, cap.ypos, h.xpos, h.ypos);
                if (colonizable(h) && d < best) {
                    best = d;
                    index = i;
                    explore = h.systemIndex;
                }
                v.status = was;
            });
        }
        expect(index, 'a colonizable target').toBeGreaterThanOrEqual(0);
        expect(pp.stateMoney).toBeGreaterThan(ship!.calculateCurrentPurchasePrice(probe.galaxy));
        const game = (): Game => {
            const g = cachedTickGame(gameData, key);
            if (explore !== null) g.playerEmpire.visibility.systemVisibility[explore].status = SystemVisibilityStatus.Explored;
            const gp = g.playerEmpire;
            const gs = findNewestCanBuild(gp.designs, BuiltObjectSubRole.ColonyShip, gp);
            expect(canEmpireColonizeHabitat(g.galaxy, gp, gp, g.galaxy.habitats[index], gp.colonizableHabitatTypesForEmpire(), gs), 'the target is colonizable').toBe(true);
            return g;
        };
        const build: Click['run'] = (g, p, ui) => {
            plannerBuildColonyShip(g, p, g.habitats[index], ui.naive ? new PendingOnce<Habitat>() : ui.busy, (r) => ui.replies.push(r.text));
        };
        // A double click, then a third click a tick later (inside the worker's round trip; in-thread the target then has
        // its colony ship).
        const clicks: Click[] = [
            { tick: 2, run: build },
            { tick: 2, run: build },
            { tick: 3, run: build },
        ];
        const ticks = 12;
        const orders = (log: string): number => (JSON.parse(log) as { op?: string }[]).filter((e) => e.op === 'shipAction').length;
        const shipsFor = (g: Game): number => g.playerEmpire.builtObjects.filter((b) => b != null && b.subRole === BuiltObjectSubRole.ColonyShip && (b.mission as { targetHabitat?: unknown } | null)?.targetHabitat === g.galaxy.habitats[index]).length;
        const ref = runInThread(game(), clicks, ticks);
        const wk = runWorker(game(), clicks, ticks, 3);
        expect(shipsFor(ref.game)).toBe(1);
        expect(shipsFor(wk.host.game)).toBe(1);
        // One order in both modes (the button is busy until its reply / the target has its ship).
        expect(orders(ref.log)).toBe(1);
        expect(orders(wk.log)).toBe(1);
        expect(wk.log).toBe(ref.log);
        expect(wk.digest).toBe(ref.digest);
        wk.settle();
        expect(wk.ui.busy.size).toBe(0);
        expect(ref.ui.replies).toHaveLength(1);
        expect(ref.ui.replies[0]).toMatch(/colonize/i);
        expect(wk.ui.replies).toEqual(ref.ui.replies);
        wk.client.dispose();
        wk.host.dispose();

        // Without the busy guard the stale replica lets three orders through — and the game still buys one ship (method_539
        // runs in the game, after BuildColonize's "a colony ship is on its way" check). The old planner bought one per
        // order (a buildNewShips + a separate colonize order).
        const naive = runWorker(game(), clicks, ticks, 3, new Ui(true));
        expect(orders(naive.log)).toBe(3);
        expect(shipsFor(naive.host.game)).toBe(1);
        naive.client.dispose();
        naive.host.dispose();
    }, 600000);
});

describe('sim worker: Empire Policy automation settings', () => {
    it('issue the same setEmpireControl / setPolicy commands in both modes (X → Y → X in quick succession sends each)', () => {
        const flip = (tick: number, index: number): Click => ({
            tick,
            run: (_g, p, ui) => {
                const ctx = { facilities: planetaryFacilityDefinitionsStatic(p.galaxy) };
                const controls = panelControls(buildPolicyPanel(p, p.policy ?? defaultEmpirePolicy(), ctx));
                const combo = controls.get('AutomationColonyTaxRates') as ComboControl;
                combo.index = index;
                const research = controls.get('AutomationResearch') as ComboControl;
                research.index = 1 - index;
                issuePolicyPanel(p, false, controls, ctx, ui.pv(ui.policy));
            },
        });
        const clicks: Click[] = [flip(2, 0), flip(3, 1), flip(4, 0), flip(4, 1), flip(5, 0)];
        const ticks = 12;
        const ref = runInThread(cachedTickGame(gameData), clicks, ticks);
        const wk = runWorker(cachedTickGame(gameData), clicks, ticks, 3);
        const controlOps = (log: string): string[] =>
            (JSON.parse(log) as { op?: string; args?: unknown[] }[]).filter((e) => e.op === 'setEmpireControl').map((e) => JSON.stringify(e.args));
        expect(controlOps(ref.log).length).toBeGreaterThanOrEqual(5);
        expect(controlOps(wk.log)).toEqual(controlOps(ref.log));
        expect(wk.log).toBe(ref.log);
        expect(wk.digest).toBe(ref.digest);
        for (const p of [ref.game.playerEmpire, wk.host.game.playerEmpire]) {
            expect(p.controlColonyTaxRates).toBe(false);
            expect(p.controlResearch).toBe(true);
        }
        wk.settle();
        expect(wk.ui.policy.size).toBe(0);
        wk.client.dispose();
        wk.host.dispose();
    }, 600000);
});
