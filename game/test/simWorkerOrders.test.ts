// Sim worker, chunk 5 (docs/sim-worker.md §9): HUD, selection and orders through the worker host, driven in-process.
// - A scripted UI player builds the right-click action menu, the selection panel's buttons (incl. the pages whose
//   method_593 draws galaxy.rnd) and the habitat dispatch buttons through simQuery, and gives the orders they offer
//   (shipAction, rightClickOrder, constructionJobAdd, shipOrderKey, fleetPoint, a multi-ship "box" selection). Run on
//   the replica through the host, it gives the same menus, the same command log and the same state digest as the same
//   script run in-thread through the real app loop (simLoop.ts), tick for tick; building the menus on the replica
//   instead of in the worker does not (the authoritative galaxy.rnd misses the draws).
// - onApplied replies run with the command's effect already on the replica (also for fields that travel cold).
// - A replica object the sync no longer knows is never sent by value; runPlayerCommand refuses a replica.
// - The HUD / selection / sidebar / colony-list readers do not change the game (no writes, no galaxy.rnd draws).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { commandLog } from '../src/sim/player/commandLog';
import { issuePlayerCommand, runPlayerCommand } from '../src/sim/player/playerCommands';
import { createSimLoop } from '../src/simLoop';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { Habitat, HabitatCategoryType } from '../src/sim/types';
import { ShipGroup, empireShipGroups } from '../src/sim/fleets/shipGroup';
import { BuiltObjectMissionType, COORD_UNSET_DOUBLE, builtObjectMission } from '../src/sim/missions/mission';
import { ShipAction, ShipActionType, createShipAction } from '../src/sim/player/shipAction';
import type { ConstructionQueue } from '../src/sim/construction/constructionQueue';
import type { ShipActionResult } from '../src/sim/player/executeShipAction';
import { resolveHoverOrder, rightClickOrder, type OrderMenuItem } from '../src/sim/player/orderMenu';
import { fastFindNearestAvailableMilitaryShip } from '../src/sim/player/shipHotkeys';
import type { Camera } from '../src/render/camera';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import { alwaysHotFields } from '../src/simworker/replicaGalaxy';
import { setRemoteQuerySink, simQuery } from '../src/simworker/simQuery';
import type { QueryMessage, ToWorker } from '../src/simworker/protocol';
import { buildInfoModel, type InfoContext } from '../src/ui/selectionInfo';
import { itemPanelDefs, itemRowModel, panelItems, type RowContext } from '../src/ui/leftSidebar';
import { colonyMetrics, colonyRows, colonyScenarioInfo } from '../src/ui/screens/coloniesList';
import { viewSystemName } from '../src/ui/topBar';
import { tooltipText } from '../src/ui/mapTooltip';
import { isBoxSelectable, resolveBoxSelection } from '../src/render/boxSelect';
import {
    builtObjectCycleList,
    builtObjectRows,
    builtObjectStatusRows,
    buildingQueueText,
    cycleIdleShips,
    invasionVsText,
    multipleShipsSummary,
    ownerRows,
    playerColonyList,
    systemRows,
    threatRows,
    topSystemNameText,
    troopStrengthText,
} from '../src/ui/hud';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const END_MS = 22_000;
const START_OPTIONS = {} as StartGameOptions;

/** A fake wall clock: each tick is exactly one step's worth of real time, so the budget runs one step per tick. */
function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

interface Connected {
    host: SimHost;
    client: SimClientCore;
    time: GalaxyTime;
    posted: ToWorker[];
    /** Deliver the queries posted so far (host.query + its immediate flush message) and run their replies. */
    drainQueries: () => void;
    tick: () => void;
}

/** Host + client wired in-process (messages structured-cloned as postMessage would; queries answered at once, as worker.ts does). */
function connect(game: Game, time: GalaxyTime): Connected {
    const host = new SimHost(game, time, START_OPTIONS, { now: fakeClock() });
    const snap = structuredClone(host.snapshot());
    const queries: QueryMessage[] = [];
    const posted: ToWorker[] = [];
    const toHost = (m: ToWorker): void => {
        const c = structuredClone(m);
        posted.push(c);
        if (c.type === 'command') host.command(c);
        else if (c.type === 'clock') host.clock(c);
        else if (c.type === 'query') queries.push(c);
    };
    const client = new SimClientCore(gameData, snap, { post: toHost, now: fakeClock() });
    const uiTime = new GalaxyTime();
    uiTime.bindGalaxy(client.galaxy);
    uiTime.speed = time.speed;
    uiTime.paused = time.paused;
    const drainQueries = (): void => {
        while (queries.length > 0) {
            host.query(queries.shift()!);
            client.receive(structuredClone(host.flush()));
            client.frame(uiTime);
        }
    };
    const tick = (): void => {
        drainQueries();
        client.syncClock(uiTime);
        const m = host.tick(FRAME_REAL_MS);
        if (m !== null) client.receive(structuredClone(m));
        client.frame(uiTime);
        drainQueries();
    };
    return { host, client, time: uiTime, posted, drainQueries, tick };
}

// ---------------------------------------------------------------------------------------------------------------
// The scripted UI player (mode-agnostic: simQuery + issuePlayerCommand, on whatever galaxy it is handed)
// ---------------------------------------------------------------------------------------------------------------

interface UiRun {
    /** What each step saw (menus, buttons, replies), compared between the two runs. */
    seen: string[];
    fleet: ShipGroup | null;
    /** The ship / colony the steps act on, resolved once per run. */
    builder: BuiltObject | null;
}
const runs = new WeakMap<Galaxy, UiRun>();
function runOf(g: Galaxy): UiRun {
    let r = runs.get(g);
    if (r === undefined) runs.set(g, (r = { seen: [], fleet: null, builder: null }));
    return r;
}

const flat = (items: readonly OrderMenuItem[]): OrderMenuItem[] => items.flatMap((i) => [i, ...flat(i.children)]);
const menuText = (items: readonly OrderMenuItem[] | null): string => (items === null ? 'null' : flat(items).filter((i) => !i.separator).map((i) => `${i.label}${i.enabled ? '' : '(off)'}`).join('|'));
const actionText = (a: ShipAction | null): string => {
    if (a === null) return '-';
    const t = a.target as { name?: string } | null;
    return `${a.actionType}/${a.missionType}/${t?.name ?? ''}/${a.design?.name ?? ''}/${a.position.x},${a.position.y}`;
};

function constructionShip(p: Empire): BuiltObject {
    const s = p.builtObjects.find((b) => b.subRole === BuiltObjectSubRole.ConstructionShip && b.builtAt === null && b.topSpeed > 0 && !b.hasBeenDestroyed);
    expect(s).toBeDefined();
    return s!;
}
/** Unowned bodies of the player's home system (their buttons / "Build here" designs draw galaxy.rnd). */
function homeBodies(g: Galaxy, p: Empire): Habitat[] {
    return g.systems[p.capital!.systemIndex].habitats.filter((h) => h.empire === null && h.category !== HabitatCategoryType.Star);
}
function freeShips(p: Empire, n: number): BuiltObject[] {
    return p.builtObjects.filter((b) => b.role !== BuiltObjectRole.Base && b.builtAt === null && b.topSpeed > 0 && b.shipGroup === null && b.subRole !== BuiltObjectSubRole.ConstructionShip).slice(0, n);
}

interface UiStep {
    atMs: number;
    what: string;
    issue: (g: Galaxy, p: Empire, run: UiRun) => void;
}

const UI_STEPS: UiStep[] = [
    {
        atMs: 1_000,
        what: 'action menu at galaxy zoom over a home body: "Build here" (galaxy.rnd), pick the first design',
        issue: (g, p, run) => {
            const ship = constructionShip(p);
            run.builder = ship;
            const h = homeBodies(g, p)[0];
            simQuery(g, p, 'actionMenu', [ship, Math.trunc(h.xpos), Math.trunc(h.ypos), 200, h, null, true], (items) => {
                run.seen.push(`menu ${menuText(items)}`);
                const pick = flat(items ?? []).find((i) => i.enabled && i.action !== null && i.action.missionType === BuiltObjectMissionType.Build && i.action.design !== null);
                expect(pick).toBeDefined();
                run.seen.push(`pick ${actionText(pick!.action)}`);
                issuePlayerCommand(g, p, 'shipAction', [ship, pick!.action!, true, { x: Math.trunc(h.xpos), y: Math.trunc(h.ypos) }], (r: ShipActionResult) => {
                    // onApplied: the order's effect is on the replica already (mission is not an always-hot field).
                    run.seen.push(`applied ${String(r.ok)} mission ${builtObjectMission(ship)?.type ?? 'none'} ${ship.subsequentMissions?.length ?? 0}`);
                });
            });
        },
    },
    {
        atMs: 2_000,
        what: 'selection buttons of an unowned home body (top page draws galaxy.rnd), click the first enabled one',
        issue: (g, p, run) => {
            const h = homeBodies(g, p)[1] ?? homeBodies(g, p)[0];
            simQuery(g, p, 'selectionButtons', [h, null], (buttons) => {
                run.seen.push(`buttons ${(buttons ?? []).map((b) => `${actionText(b.action)}:${b.enabled}`).join('|')}`);
                const b = (buttons ?? []).find((x) => x.enabled && x.action !== null);
                if (b !== undefined) issuePlayerCommand(g, p, 'shipAction', [h, b.action!, false, undefined], (r) => run.seen.push(`applied ${String(r.ok)} ${r.message ?? ''}`));
            });
        },
    },
    {
        atMs: 3_000,
        what: 'the capital\'s Build Options page (draws galaxy.rnd), build the first enabled design',
        issue: (g, p, run) => {
            const cap = p.capital!;
            simQuery(g, p, 'selectionButtons', [cap, createShipAction(ShipActionType.BuildOptions, cap)], (buttons) => {
                run.seen.push(`build page ${(buttons ?? []).map((b) => `${actionText(b.action)}:${b.enabled}`).join('|')}`);
                const b = (buttons ?? []).find((x) => x.enabled && x.action !== null && x.action.design !== null);
                if (b !== undefined) issuePlayerCommand(g, p, 'shipAction', [cap, b.action!, false, undefined], (r) => run.seen.push(`applied ${String(r.ok)} queue ${(cap.constructionQueue as ConstructionQueue | null)?.constructionWaitQueue?.length ?? 'n/a'}`));
            });
        },
    },
    {
        atMs: 4_000,
        what: 'habitat dispatch: re-resolved at click time, a build goes to the construction job board, else the ship goes',
        issue: (g, p, run) => {
            const h = homeBodies(g, p).find((x) => x.resources.length > 0) ?? homeBodies(g, p)[0];
            simQuery(g, p, 'habitatDispatch', [h], (options) => {
                run.seen.push(`dispatch ${options.map((o) => `${o.id}:${o.ship?.name ?? '-'}`).join('|')}`);
                const o = options.find((x) => x.ship !== null);
                if (o === undefined) return;
                simQuery(g, p, 'habitatDispatch', [h], (now) => {
                    const fresh = now.find((x) => x.id === o.id)!;
                    const design = fresh.action!.design;
                    if (o.id.startsWith('build:') && design !== null) {
                        const pos = fresh.action!.position;
                        const zero = pos.x === 0 && pos.y === 0;
                        issuePlayerCommand(g, p, 'constructionJobAdd', [design, h, zero ? COORD_UNSET_DOUBLE : pos.x, zero ? COORD_UNSET_DOUBLE : pos.y], (id) => run.seen.push(`job ${id} board ${p.constructionBoard?.jobs.length ?? 0}`));
                    } else {
                        issuePlayerCommand(g, p, 'shipAction', [fresh.ship!, fresh.action!, true, { x: h.xpos, y: h.ypos }], (r) => run.seen.push(`sent ${String(r.ok)}`));
                    }
                });
            });
        },
    },
    {
        atMs: 5_000,
        what: 'right-click default order (resolveHoverOrder on the local galaxy), then the menu query (null: order given)',
        issue: (g, p, run) => {
            const ship = freeShips(p, 1)[0];
            const target = g.habitats.filter((h) => h.parent !== null && h.systemIndex !== p.capital!.systemIndex)[3];
            const hover = resolveHoverOrder({ galaxy: g, empire: p, selected: ship, x: Math.trunc(target.xpos), y: Math.trunc(target.ypos), target, shift: false, alt: false, ctrl: false });
            run.seen.push(`hover ${hover.text} ${actionText(hover.action)}`);
            expect(hover.action).not.toBeNull();
            issuePlayerCommand(g, p, 'rightClickOrder', [ship, hover.action!, { ctrl: false, alt: false }, 1], (r) => run.seen.push(`right ${r.kind}`));
            // The non-order outcomes stay local reads (idle-ships picker with nothing selected).
            const idle = rightClickOrder(g, p, null, null, { ctrl: false, alt: false }, 1);
            run.seen.push(`idle ${idle.kind}`);
            simQuery(g, p, 'actionMenu', [ship, Math.trunc(target.xpos), Math.trunc(target.ypos), 1, target, hover.action, false], (items) => run.seen.push(`menu after order ${menuText(items)}`));
        },
    },
    {
        atMs: 6_000,
        what: 'box selection of free ships: the list buttons, New Fleet; the reply names the new fleet',
        issue: (g, p, run) => {
            const box = resolveBoxSelection(freeShips(p, 3).filter((b) => isBoxSelectable(b, p)), p);
            const list = box.kind === 'list' ? box.ships : freeShips(p, 3);
            simQuery(g, p, 'selectionButtons', [list, null], (buttons) => {
                run.seen.push(`list buttons ${(buttons ?? []).map((b) => actionText(b.action)).join('|')}`);
                const nf = (buttons ?? []).find((b) => b.action?.actionType === ShipActionType.CreateNewFleet) ?? null;
                const action = nf?.action ?? createShipAction(ShipActionType.CreateNewFleet, null);
                issuePlayerCommand(g, p, 'shipAction', [list, action, false, undefined], (r) => {
                    if (r.select instanceof ShipGroup) run.fleet = r.select;
                    run.seen.push(`fleet ${r.select instanceof ShipGroup ? `${r.select.name} ${r.select.ships.length}` : 'none'}`);
                });
            });
        },
    },
    {
        atMs: 7_000,
        what: 'the selection panel automation toggle and a ship hotkey order',
        issue: (g, p, run) => {
            const ship = run.builder!;
            const automated = ship.isAutoControlled;
            issuePlayerCommand(g, p, 'shipAction', [ship, createShipAction(automated ? ShipActionType.UnautomateShip : ShipActionType.AutomateShip, ship), false, undefined], () => {
                run.seen.push(`automated ${String(automated)} -> ${String(ship.isAutoControlled)}`);
            });
            const mil = fastFindNearestAvailableMilitaryShip(g, p.capital!.xpos, p.capital!.ypos, p) ?? freeShips(p, 1)[0];
            issuePlayerCommand(g, p, 'shipOrderKey', [mil, 'stopShip'], (changed) => run.seen.push(`stop ${String(changed)}`));
        },
    },
    {
        atMs: 8_000,
        what: 'the fleet\'s attack point (the next map click after SetFleetAttackPoint)',
        issue: (g, p, run) => {
            const fleet = run.fleet ?? empireShipGroups(p).find((x) => x !== null) ?? null;
            if (fleet === null) return;
            const target = g.habitats.filter((h) => h.parent !== null)[10];
            issuePlayerCommand(g, p, 'fleetPoint', [fleet, 'SetFleetAttackPoint', target], (ok) => run.seen.push(`fleet point ${String(ok)}`));
        },
    },
    {
        atMs: 9_000,
        what: 'the same "Build here" menu again, at a later state (galaxy.rnd draws again)',
        issue: (g, p, run) => {
            const ship = run.builder!;
            const h = homeBodies(g, p)[2] ?? homeBodies(g, p)[0];
            simQuery(g, p, 'actionMenu', [ship, Math.trunc(h.xpos), Math.trunc(h.ypos), 200, h, null, true], (items) => run.seen.push(`menu2 ${menuText(items)}`));
        },
    },
];

const issuedSteps = new WeakMap<Galaxy, Set<UiStep>>();
function dueUiSteps(g: Galaxy): UiStep[] {
    let s = issuedSteps.get(g);
    if (s === undefined) issuedSteps.set(g, (s = new Set()));
    const out = UI_STEPS.filter((x) => x.atMs <= g.nowMs && !s!.has(x));
    for (const x of out) s.add(x);
    return out;
}

/** The in-thread reference: the real app loop, the UI script issuing on the live game between frames. */
function runInThread(): { game: Game; ticks: number; draws: number[] } {
    const ref = cachedTickGame(gameData);
    const time = new GalaxyTime();
    time.paused = false;
    const loop = createSimLoop(ref.galaxy, time, {} as Camera, false);
    (loop.budget as { now: () => number }).now = fakeClock();
    let ticks = 0;
    const draws: number[] = [];
    let n = 0;
    ref.galaxy.rnd.setTrace(() => n++);
    while (ref.galaxy.nowMs < END_MS) {
        for (const s of dueUiSteps(ref.galaxy)) {
            const before = n;
            s.issue(ref.galaxy, ref.playerEmpire, runOf(ref.galaxy));
            draws.push(n - before);
        }
        loop.tick(FRAME_REAL_MS);
        ticks++;
    }
    ref.galaxy.rnd.setTrace(null);
    return { game: ref, ticks, draws };
}

/** The same script on the replica through the host (`localQueries`: build the menus on the replica instead). */
function runOnReplica(localQueries = false): { game: Game; w: Connected; ticks: number } {
    const game = cachedTickGame(gameData);
    const time = new GalaxyTime();
    time.paused = false;
    const w = connect(game, time);
    const rg = w.client.galaxy;
    if (localQueries) setRemoteQuerySink(rg, null);
    let ticks = 0;
    while (game.galaxy.nowMs < END_MS) {
        const due = dueUiSteps(rg);
        if (due.length > 0) {
            // Resolve the script's targets on an exactly-current replica, as the in-thread script reads the live game.
            w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
            expect(rg.nowMs).toBe(game.galaxy.nowMs);
            for (const s of due) s.issue(rg, w.client.game.playerEmpire, runOf(rg));
            w.drainQueries();
        }
        w.tick();
        ticks++;
        expect(rg.nowMs).toBe(game.galaxy.nowMs);
    }
    return { game, w, ticks };
}

describe('sim worker chunk 5: orders from the HUD, the order menu and the selection panel', () => {
    it('menus, buttons and dispatch built in the worker give the in-thread menus, command log and digest, tick for tick', () => {
        const ref = runInThread();
        // The script is meaningful: the "Build here" menu and the build pages draw galaxy.rnd in-thread.
        expect(ref.draws[0]).toBeGreaterThan(0);
        expect(ref.draws[1]).toBeGreaterThan(0);
        expect(ref.draws[2]).toBeGreaterThan(0);
        const refRun = runOf(ref.game.galaxy);
        expect(refRun.seen.some((x) => x.startsWith('fleet ') && x !== 'fleet none')).toBe(true);

        const { game, w, ticks } = runOnReplica();
        const rg = w.client.galaxy;
        expect(ticks).toBe(ref.ticks);
        expect(runOf(rg).seen).toEqual(refRun.seen);
        expect(JSON.stringify(commandLog(game.galaxy))).toBe(JSON.stringify(commandLog(ref.game.galaxy)));
        expect(w.host.digest()).toBe(stateDigest(ref.game.galaxy));
        // The queries went to the worker (none ran on the replica's own galaxy.rnd), and replies resolved to replica objects.
        expect(w.posted.filter((m) => m.type === 'query').length).toBeGreaterThanOrEqual(7);
        expect(runOf(rg).fleet?.empire).toBe(w.client.game.playerEmpire);
        // The replica is still exact (nothing on the main thread wrote it).
        w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
        expect(stateDigest(rg)).toBe(w.host.digest());
        w.client.dispose();
        w.host.dispose();
    }, 900000);

    it('building the menus on the replica instead loses the galaxy.rnd draws (the gate above is sensitive)', () => {
        const ref = runInThread();
        const { w } = runOnReplica(true);
        expect(w.host.digest()).not.toBe(stateDigest(ref.game.galaxy));
        w.client.dispose();
        w.host.dispose();
    }, 900000);
});

describe('sim worker chunk 5: onApplied, dropped objects, runPlayerCommand', () => {
    it('onApplied runs with the command\'s effect on the replica, also for cold fields', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        const w = connect(game, time);
        for (let i = 0; i < 5; i++) w.tick();
        // Not always-hot: without the touched compare it would reach the replica only with the cold cycle.
        expect(alwaysHotFields().has('BuiltObject.isAutoControlled')).toBe(false);
        const p = w.client.game.playerEmpire;
        const ship = freeShips(p, 1)[0];
        const real = w.host.sync.encoder.objectOf(w.client.replica.decoder.idOf(ship)) as BuiltObject;
        expect(real).toBeInstanceOf(BuiltObject);
        const was = ship.isAutoControlled;
        let seen: boolean | null = null;
        issuePlayerCommand(w.client.galaxy, p, 'shipAction', [ship, createShipAction(was ? ShipActionType.UnautomateShip : ShipActionType.AutomateShip, ship), false, undefined], () => {
            seen = ship.isAutoControlled;
            expect(seen).toBe(real.isAutoControlled);
        });
        w.tick();
        expect(seen).toBe(!was);
        // A colony order: its construction wait list (two levels below the colony) is current in the callback too.
        const cap = p.capital!;
        const realCap = w.host.sync.encoder.objectOf(w.client.replica.decoder.idOf(cap)) as Habitat;
        let queued = -1;
        simQuery(w.client.galaxy, p, 'selectionButtons', [cap, createShipAction(ShipActionType.BuildOptions, cap)], (buttons) => {
            const b = (buttons ?? []).find((x) => x.enabled && x.action !== null && x.action.design !== null)!;
            issuePlayerCommand(w.client.galaxy, p, 'shipAction', [cap, b.action!, false, undefined], () => {
                queued = (cap.constructionQueue as ConstructionQueue).constructionWaitQueue?.length ?? 0;
                expect(queued).toBe((realCap.constructionQueue as ConstructionQueue).constructionWaitQueue?.length ?? 0);
            });
        });
        w.drainQueries();
        w.tick();
        expect(queued).toBeGreaterThanOrEqual(0);
        // The money panel query runs CheckAgeVariableIncome in the game itself (the replica gets the result).
        const realEmpire = w.host.galaxy.playerEmpire!;
        realEmpire.useAveragedVariableIncome = false;
        let income: unknown = undefined;
        simQuery(w.client.galaxy, p, 'moneyPanel', [], (r) => (income = r));
        w.drainQueries();
        expect(income).not.toBeUndefined();
        expect(realEmpire.useAveragedVariableIncome).toBe(true);
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it('a replica object the sync no longer knows is not sent (no command, no query, no callback)', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        const w = connect(game, time);
        const p = w.client.game.playerEmpire;
        const gone = Object.create(BuiltObject.prototype) as BuiltObject;
        gone.name = 'Gone';
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const before = w.posted.length;
        let called = false;
        issuePlayerCommand(w.client.galaxy, p, 'shipAction', [gone, createShipAction(ShipActionType.AutomateShip, gone), false, undefined], () => (called = true));
        simQuery(w.client.galaxy, p, 'selectionButtons', [gone, null], () => (called = true));
        w.tick();
        expect(w.posted.length).toBe(before);
        expect(called).toBe(false);
        expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/BuiltObject Gone is no longer in the game/);
        // A query the worker cannot run answers with an error: no callback either.
        simQuery(w.client.galaxy, p, 'habitatDispatch', [null as unknown as Habitat], () => (called = true));
        w.tick();
        expect(called).toBe(false);
        warn.mockRestore();
        // runPlayerCommand needs its result at once, which a replica cannot give: callers take the async path.
        expect(() => runPlayerCommand(w.client.galaxy, p, 'automationOff', ['Colony Tax Rates'])).toThrow(/sim-worker replica/);
        w.client.dispose();
        w.host.dispose();
    }, 600000);
});

describe('sim worker chunk 5: the HUD, selection and list readers do not change the game', () => {
    it('selection panel, left sidebar (incl. the slow panels), colony list, top bar, tooltips, hover orders, box select: no writes, no galaxy.rnd draws', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const before = JSON.stringify(galaxyToJSON(g));
        let draws = 0;
        g.rnd.setTrace(() => draws++);
        const resource = (id: number) => gameData.resources.find((d) => d.resourceId === id) ?? null;
        const ctx: InfoContext = { galaxy: g, player: p, resource };
        const sysOf = (h: Habitat) => g.systems[h.systemIndex];
        for (const bo of g.builtObjects.slice(0, 120)) {
            if (bo === null) continue;
            const home = bo.nearestSystemStar ?? g.systems[0].systemStar;
            buildInfoModel(ctx, { habitat: home, system: sysOf(home), builtObject: bo });
        }
        for (const sg of [...empireShipGroups(p), ...g.empires.flatMap((e) => empireShipGroups(e)).slice(0, 10)]) {
            if (sg === null || sg.leadShip === null) continue;
            const home = g.systems[0].systemStar;
            buildInfoModel(ctx, { habitat: home, system: sysOf(home), shipGroup: sg });
        }
        const multi = freeShips(p, 4);
        buildInfoModel(ctx, { habitat: p.capital!, system: sysOf(p.capital!), builtObjects: multi });
        for (const h of g.habitats.slice(0, 400)) buildInfoModel(ctx, { habitat: h, system: sysOf(h) });
        for (const e of g.empires) for (const h of e.colonies.slice(0, 5)) buildInfoModel(ctx, { habitat: h, system: sysOf(h) });
        for (const s of g.systems.slice(0, 40)) buildInfoModel(ctx, { habitat: s.systemStar, system: s, systemInfo: true });
        for (const c of g.creatures.slice(0, 20)) buildInfoModel(ctx, { habitat: g.systems[0].systemStar, system: g.systems[0], creature: c }, null);
        const rowCtx: RowContext = { galaxy: g, player: p, sizeFactor: 1, resource };
        for (const d of [...itemPanelDefs(false), ...itemPanelDefs(true)]) {
            for (const toggles of [[], [0], [1], [0, 1]]) {
                for (const item of panelItems(d.id, g, p, { toggles }).slice(0, 25)) itemRowModel(rowCtx, d.id, item);
            }
        }
        colonyRows(p, (h) => colonyMetrics(g, h), (h) => colonyScenarioInfo(g, h));
        for (const h of g.habitats.slice(0, 200)) {
            viewSystemName(g, p, h.xpos, h.ypos);
            tooltipText(h, g.systems[h.systemIndex]?.systemStar.name ?? null);
        }
        fastFindNearestAvailableMilitaryShip(g, p.capital!.xpos, p.capital!.ypos, p);
        resolveBoxSelection(g.builtObjects.slice(0, 200).filter((b): b is BuiltObject => b !== null && isBoxSelectable(b, p)), p);
        const ships = p.builtObjects.slice(0, 20);
        for (const s of [null, ...ships]) {
            for (const t of [null, ...g.habitats.slice(0, 30), ...g.builtObjects.slice(0, 20)]) {
                const x = Math.trunc(t?.xpos ?? 0);
                const y = Math.trunc(t?.ypos ?? 0);
                const hover = resolveHoverOrder({ galaxy: g, empire: p, selected: s, x, y, target: t, shift: false, alt: false, ctrl: false });
                // The right-click's local outcomes (no order given): idle-ships picker / centre / Ctrl.
                if (hover.action === null || s === null) rightClickOrder(g, p, s, hover.action, { ctrl: false, alt: false }, 1);
                rightClickOrder(g, p, s, hover.action, { ctrl: true, alt: false }, 1);
            }
        }
        // The HUD's own timers / selection rows.
        playerColonyList(g, p);
        for (const kind of ['bases', 'military', 'construction', 'other'] as const) builtObjectCycleList(p, kind);
        cycleIdleShips(p, { builtObject: null, shipGroup: null }, 1);
        multipleShipsSummary(multi, g, true);
        for (const bo of g.builtObjects.slice(0, 120)) {
            if (bo === null) continue;
            builtObjectRows(bo);
            builtObjectStatusRows(bo, p);
            threatRows(bo, p);
        }
        for (const h of g.habitats.slice(0, 300)) {
            troopStrengthText(h, g);
                invasionVsText(h, g, p);
                buildingQueueText(h.constructionQueue as ConstructionQueue | null);
            if (h.empire !== null) ownerRows(h);
            threatRows(h, p);
            topSystemNameText(g, h.xpos, h.ypos, 0.01);
        }
        for (const sys of g.systems.slice(0, 60)) systemRows(sys);
        g.rnd.setTrace(null);
        expect(draws).toBe(0);
        expect(JSON.stringify(galaxyToJSON(g)) === before).toBe(true);
    }, 600000);
});
