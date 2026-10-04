// Fleet Settings panel (an Improvement: src/ui/screens/fleetSettings.ts, fleetSettingsModel.ts, ui/improvements.ts).
// - the pure helpers: the posture-range and engagement-stance ladders and how many cycle commands reach a step;
// - each control issues the existing journaled op the original's control issues, applied at the frame boundary;
// - quick repeated clicks (pendingCommands.ts) give the same command log, state digest and end state in-thread and in
//   sim-worker mode (replies 3 ticks late);
// - the improvement switch: default on; off hides the Q key (inert, not in the shortcuts table).
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/toast', () => ({ showToast: vi.fn() }));

import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { ensureShips } from './helpers/ensureShips';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { flushPlayerCommands, issuePlayerCommand, pendingPlayerCommands } from '../src/sim/player/playerCommands';
import { empireShipGroups, type ShipGroup } from '../src/sim/fleets/shipGroup';
import { FleetPosture } from '../src/sim/diplomacyTick';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import type { TroopLoadout } from '../src/sim/player/fleetOps';
import { createSimLoop } from '../src/simLoop';
import type { Camera } from '../src/render/camera';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { StepMessage, ToWorker } from '../src/simworker/protocol';
import { PendingValues } from '../src/ui/pendingCommands';
import { displayedFleetTroopLoadout, fleetLoadoutSpin, issueFleetTroopLoadout } from '../src/ui/screens/fleetsList';
import {
    FLEET_RANGE_LADDER,
    FLEET_STANCE_LADDER,
    FleetSettingsPending,
    fleetDesignBehaviours,
    fleetForSelection,
    fleetRangeCycles,
    fleetRangeStep,
    fleetRangeStepLabel,
    fleetResupplyShips,
    fleetSettingsView,
    fleetStanceAfter,
    fleetStanceCycles,
    fleetStanceFields,
    fleetStanceIndex,
    issueClearAttackPoint,
    issueEmpireSetting,
    issueFleetAutomated,
    issueFleetHomeBase,
    issueFleetOnce,
    issueFleetPosture,
    issueFleetRange,
    issueFleetStance,
    issueResupplyMembership,
    unassignedResupplyShips,
} from '../src/ui/screens/fleetSettingsModel';
import { improvementById, isImprovementEnabled, setImprovementEnabled } from '../src/ui/improvements';
import { setSettingsStorage } from '../src/ui/settings';
import { KEY_BINDINGS, dispatchKey } from '../src/ui/keyboard';
import { nextAttackRangeSquared } from '../src/sim/player/shipHotkeys';
import { findNewest } from '../src/sim/design';
import { cloneDesign } from '../src/sim/gameStartTail';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('Fleet Settings: pure helpers', () => {
    it('posture range: the five SetFleetRange steps, the C# labels and the cycles to a step', () => {
        expect(FLEET_RANGE_LADDER.map(fleetRangeStep)).toEqual([0, 1, 2, 3, 4]);
        // The ShipGroup default (double.MaxValue) is "Anywhere"; the AI's 48000² / 500000² are System / Nearby Systems.
        expect(fleetRangeStep(Number.MAX_VALUE)).toBe(4);
        expect(fleetRangeStep(2304000000.0)).toBe(1);
        expect(fleetRangeStep(250000000000.0)).toBe(2);
        expect(fleetRangeStepLabel(0, FleetPosture.Attack)).toBe('Target');
        expect(fleetRangeStepLabel(0, FleetPosture.Defend)).toBe('Home Base');
        expect(fleetRangeStepLabel(2, FleetPosture.Attack)).toBe('Nearby Systems');
        expect(fleetRangeStepLabel(4, FleetPosture.Defend)).toBe('Anywhere');
        expect(fleetRangeCycles(Number.MAX_VALUE, 0)).toBe(1); // Anywhere → Target wraps
        expect(fleetRangeCycles(2250000.0, 4)).toBe(4);
        expect(fleetRangeCycles(250000000000.0, 2)).toBe(0);
        expect(fleetRangeCycles(250000000000.0, 1)).toBe(4);
    });

    it('engagement stance: the `,` key cycle (0 → 2000² → 48000² → 0; any other value → 48000²)', () => {
        expect(FLEET_STANCE_LADDER.map(fleetStanceIndex)).toEqual([0, 1, 2]);
        expect(fleetStanceIndex(123)).toBe(-1);
        for (let from = 0; from < 3; from++) {
            for (let to = 0; to < 3; to++) {
                const n = fleetStanceCycles(FLEET_STANCE_LADDER[from], to);
                expect(n).toBe((to - from + 3) % 3);
                expect(fleetStanceAfter(FLEET_STANCE_LADDER[from], n)).toBe(FLEET_STANCE_LADDER[to]);
            }
        }
        // An off-ladder value (a sensor range) reaches System in one press, then cycles.
        expect(fleetStanceCycles(1e9, 2)).toBe(1);
        expect(fleetStanceCycles(1e9, 0)).toBe(2);
        expect(fleetStanceAfter(1e9, 2)).toBe(nextAttackRangeSquared(nextAttackRangeSquared(1e9)));
    });

    it('default stances: an automated fleet reads the automated set, a manual one the *Manual set (ShipGroup.cs 2321)', () => {
        expect(fleetStanceFields(true).map((f) => f.field)).toEqual(['attackRangeAttack', 'attackRangePatrol', 'attackRangeEscort', 'attackRangeOther']);
        expect(fleetStanceFields(false).map((f) => f.field)).toEqual(['attackRangeAttackManual', 'attackRangePatrolManual', 'attackRangeEscortManual', 'attackRangeOtherManual']);
    });
});

/** The harness game with a fresh player fleet of two warships (Fleet Formation automation off, as a player would). */
function gameWithFleet(): { game: Game; sg: ShipGroup } {
    const game = cachedTickGame(gameData);
    const p = game.playerEmpire;
    ensureShips(game.galaxy, p, BuiltObjectSubRole.Escort, 2);
    run(game, 'setEmpireControl', ['controlMilitaryFleets', false]);
    const ships = p.builtObjects.filter((b) => b != null && b.role === BuiltObjectRole.Military && b.subRole !== BuiltObjectSubRole.ResupplyShip && b.shipGroup === null).slice(0, 2);
    run(game, 'setShipsFleet', [ships, 'new']);
    const fleets = empireShipGroups(p).filter((g): g is ShipGroup => g !== null);
    return { game, sg: fleets[fleets.length - 1] };
}
function run(game: Game, op: Parameters<typeof issuePlayerCommand>[2], args: unknown[]): void {
    issuePlayerCommand(game.galaxy, game.playerEmpire, op, args as never);
    flushPlayerCommands(game.galaxy);
}
/** The player log entries added since `from`. */
function opsSince(game: Game, from: number): PlayerLogEntry[] {
    return commandLog(game.galaxy).slice(from).filter((e): e is PlayerLogEntry => (e as PlayerLogEntry).source === 'player');
}
/** Issue through the panel's control, check nothing applies before the frame boundary, flush; the new log entries. */
function click(game: Game, issue: () => boolean): PlayerLogEntry[] {
    const from = commandLog(game.galaxy).length;
    expect(issue()).toBe(true);
    expect(pendingPlayerCommands(game.galaxy)).toBeGreaterThan(0);
    flushPlayerCommands(game.galaxy);
    return opsSince(game, from);
}

describe('Fleet Settings: each control issues the original control\'s op', () => {
    it('posture / range / stance / automation / home base / attack point / empire settings / troops / resupply', () => {
        const { game, sg } = gameWithFleet();
        const g = game.galaxy;
        const p = game.playerEmpire;
        const pend = new FleetSettingsPending();
        expect(fleetForSelection(p, { shipGroup: sg })).toBe(sg);
        expect(fleetForSelection(p, { builtObject: sg.ships[0] })).toBe(sg);
        expect(fleetForSelection(p, null)).toBeNull();

        // Posture: shipAction SetFleetPosture (Main.Part7.cs 1274 toggle); clicking the shown value sends nothing.
        expect(sg.posture).toBe(FleetPosture.Attack);
        expect(issueFleetPosture(g, p, sg, FleetPosture.Attack, pend)).toBe(false);
        let e = click(game, () => issueFleetPosture(g, p, sg, FleetPosture.Defend, pend));
        expect(e.map((x) => x.op)).toEqual(['shipAction']);
        expect(sg.posture).toBe(FleetPosture.Defend);

        // Range: SetFleetRange cycles from the shown step to the clicked one (Anywhere → Sector is four).
        expect(fleetRangeStep(sg.postureRangeSquared)).toBe(4);
        e = click(game, () => issueFleetRange(g, p, sg, 3, pend));
        expect(e.map((x) => x.op)).toEqual(['shipAction', 'shipAction', 'shipAction', 'shipAction']);
        expect(sg.postureRangeSquared).toBe(1000000000000.0);
        e = click(game, () => issueFleetRange(g, p, sg, 1, pend));
        expect(e).toHaveLength(3);
        expect(sg.postureRangeSquared).toBe(2304000000.0);

        // Stance: shipOrderKey cycleEngagementStance (the `,` key) on the fleet; fleet and ships take the value.
        const target = (fleetStanceIndex(sg.attackRangeSquared) + 1 + 3) % 3;
        e = click(game, () => issueFleetStance(g, p, sg, target, pend));
        expect(new Set(e.map((x) => x.op))).toEqual(new Set(['shipOrderKey']));
        expect(e.every((x) => x.args[1] === 'cycleEngagementStance')).toBe(true);
        expect(sg.attackRangeSquared).toBe(FLEET_STANCE_LADDER[target]);
        for (const s of sg.ships) expect(s.attackRangeSquared).toBe(FLEET_STANCE_LADDER[target]);

        // Automation: shipAction Unautomate / AutomateShip (method_348: every ship).
        const auto = fleetSettingsView(sg, pend).automated;
        e = click(game, () => issueFleetAutomated(g, p, sg, !auto, pend));
        expect(e.map((x) => x.op)).toEqual(['shipAction']);
        for (const s of sg.ships) expect(s.isAutoControlled).toBe(!auto);

        // Home base: setFleetHomeColony from the combo, fleetPoint SetFleetHomeBase (no target) to clear.
        const colony = p.colonies[0];
        e = click(game, () => issueFleetHomeBase(g, p, sg, colony, pend));
        expect(e.map((x) => x.op)).toEqual(['setFleetHomeColony']);
        expect(sg.gatherPoint).toBe(colony);
        e = click(game, () => issueFleetHomeBase(g, p, sg, null, pend));
        expect(e.map((x) => x.op)).toEqual(['fleetPoint']);
        expect(e[0].args[1]).toBe('SetFleetHomeBase');
        expect(sg.gatherPoint).toBeNull();

        // Attack point: fleetPoint SetFleetAttackPoint with no target clears it (nothing to send when there is none).
        expect(issueClearAttackPoint(g, p, sg, pend)).toBe(false);
        sg.attackPoint = colony; // as if picked on the map
        e = click(game, () => issueClearAttackPoint(g, p, sg, pend));
        expect(e.map((x) => [x.op, x.args[1]])).toEqual([['fleetPoint', 'SetFleetAttackPoint']]);
        expect(sg.attackPoint).toBeNull();

        // Empire-wide: setEmpireSetting (Main.Part4.cs 4271 method_558).
        e = click(game, () => issueEmpireSetting(g, p, 'attackOvermatchFactor', 3, pend));
        expect(e.map((x) => x.op)).toEqual(['setEmpireSetting']);
        expect(p.attackOvermatchFactor).toBe(3);
        click(game, () => issueEmpireSetting(g, p, 'fleetAttackGatherPortion', Math.fround(0.5), pend));
        expect(p.fleetAttackGatherPortion).toBe(Math.fround(0.5));
        click(game, () => issueEmpireSetting(g, p, 'attackRangeAttackManual', 2000, pend));
        expect(p.attackRangeAttackManual).toBe(2000);

        // Troops: setFleetTroopLoadout (the Fleets window's helpers), Load Troops once while its reply is pending.
        const lp = new PendingValues<ShipGroup, TroopLoadout | null>();
        issueFleetTroopLoadout(g, p, sg, { infantry: 60, armored: 40, artillery: 0, specialForces: 0 }, lp);
        flushPlayerCommands(g);
        expect([sg.troopLoadoutInfantry, sg.troopLoadoutArmored]).toEqual([60, 40]);
        const from = commandLog(g).length;
        expect(issueFleetOnce(g, p, sg, 'fleetLoadTroops', pend)).toBe(true);
        expect(issueFleetOnce(g, p, sg, 'fleetLoadTroops', pend)).toBe(false); // busy until the reply
        flushPlayerCommands(g);
        expect(opsSince(game, from).map((x) => x.op)).toEqual(['fleetLoadTroops']);
        expect(issueFleetOnce(g, p, sg, 'fleetRepairAndRefuel', pend)).toBe(true);
        flushPlayerCommands(g);

        // Resupply: setShipsFleet puts a free resupply ship into the fleet and takes it out (cmbBuiltObjectSetFleet).
        // The harness empire may have no resupply design yet: one is made from its escort design (sub-role only).
        if (findNewest(p.designs, BuiltObjectSubRole.ResupplyShip) === null) {
            const d = cloneDesign(sg.ships[0].design);
            d.subRole = BuiltObjectSubRole.ResupplyShip;
            d.name = 'Test Resupply';
            p.designs.push(d);
        }
        if (unassignedResupplyShips(p).length === 0) ensureShips(g, p, BuiltObjectSubRole.ResupplyShip, fleetResupplyShips(sg).length + 1);
        const resupply = unassignedResupplyShips(p)[0];
        expect(resupply, 'a free resupply ship').toBeDefined();
        e = click(game, () => issueResupplyMembership(g, p, resupply, sg, pend));
        expect(e.map((x) => x.op)).toEqual(['setShipsFleet']);
        expect(fleetResupplyShips(sg)).toContain(resupply);
        expect(unassignedResupplyShips(p)).not.toContain(resupply);
        e = click(game, () => issueResupplyMembership(g, p, resupply, null, pend));
        expect(e.map((x) => x.op)).toEqual(['setShipsFleet']);
        expect(resupply.shipGroup).toBeNull();

        // Tactics / flee: read from the ships' designs.
        const rows = fleetDesignBehaviours(sg);
        expect(rows.reduce((n, r) => n + r.count, 0)).toBe(sg.ships.length);
        for (const r of rows) expect(r.fleeWhen).not.toBe('');

        // Every reply landed: nothing left pending.
        for (const v of [pend.posture, pend.range, pend.stance, pend.automated, pend.home, pend.attack, pend.empire, pend.member]) expect(v.size).toBe(0);
        expect(pend.once.size).toBe(0);
    }, 600000);
});

// ---------------------------------------------------------------------------------------------------------------------
// In-thread vs sim-worker (the harness of simWorkerQuickClicks.test.ts)
// ---------------------------------------------------------------------------------------------------------------------

const START_OPTIONS = {} as StartGameOptions;
function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}
interface Ui {
    pend: FleetSettingsPending;
    loadout: PendingValues<ShipGroup, TroopLoadout | null>;
}
const newUi = (): Ui => ({ pend: new FleetSettingsPending(), loadout: new PendingValues() });
interface Click {
    tick: number;
    run: (g: Galaxy, p: Empire, ui: Ui) => void;
}

function runInThread(game: Game, clicks: readonly Click[], ticks: number, ui = newUi()): { log: string; digest: string; game: Game; ui: Ui } {
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

function runWorker(game: Game, clicks: readonly Click[], ticks: number, latency: number, ui = newUi()): { log: string; digest: string; host: SimHost; client: SimClientCore; ui: Ui; settle: () => void } {
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
    const settle = (): void => {
        uiTime.paused = true;
        for (let i = 0; i < latency + 10; i++) tick();
    };
    return { log, digest, host, client, ui, settle };
}

/** The player's newest fleet (the one the clicks form). */
function lastFleet(p: Empire): ShipGroup | null {
    const list = empireShipGroups(p).filter((g): g is ShipGroup => g !== null);
    return list[list.length - 1] ?? null;
}

describe('Fleet Settings: quick clicks give the same log, digest and settings in-thread and in sim-worker mode', () => {
    it('posture X → Y → X, range and stance steps, automation, home base, empire settings, loadout spinners', () => {
        const formed = { count: 0 };
        const form: Click = {
            tick: 0,
            run: (g, p) => {
                issuePlayerCommand(g, p, 'setEmpireControl', ['controlMilitaryFleets', false]);
                const ships = p.builtObjects.filter((b) => b != null && b.role === BuiltObjectRole.Military && b.subRole !== BuiltObjectSubRole.ResupplyShip && b.shipGroup === null).slice(0, 2);
                formed.count = ships.length;
                issuePlayerCommand(g, p, 'setShipsFleet', [ships, 'new']);
            },
        };
        const on = (tick: number, fn: (g: Galaxy, p: Empire, sg: ShipGroup, ui: Ui) => void): Click => ({
            tick,
            run: (g, p, ui) => {
                const sg = lastFleet(p);
                if (sg !== null) fn(g, p, sg, ui);
            },
        });
        const clicks: Click[] = [
            form,
            // Posture: Defend, Attack, Defend in one frame (three toggles) → Defend.
            on(4, (g, p, sg, ui) => issueFleetPosture(g, p, sg, FleetPosture.Defend, ui.pend)),
            on(4, (g, p, sg, ui) => issueFleetPosture(g, p, sg, FleetPosture.Attack, ui.pend)),
            on(4, (g, p, sg, ui) => issueFleetPosture(g, p, sg, FleetPosture.Defend, ui.pend)),
            // Range: Nearby, then Target a tick later (inside the worker's round trip) → Target.
            on(5, (g, p, sg, ui) => issueFleetRange(g, p, sg, 2, ui.pend)),
            on(6, (g, p, sg, ui) => issueFleetRange(g, p, sg, 0, ui.pend)),
            // Stance: System, then Nearby.
            on(6, (g, p, sg, ui) => issueFleetStance(g, p, sg, 2, ui.pend)),
            on(7, (g, p, sg, ui) => issueFleetStance(g, p, sg, 1, ui.pend)),
            // Automation: flip, flip back, flip again → the opposite of the start.
            on(7, (g, p, sg, ui) => issueFleetAutomated(g, p, sg, !fleetSettingsView(sg, ui.pend).automated, ui.pend)),
            on(7, (g, p, sg, ui) => issueFleetAutomated(g, p, sg, !fleetSettingsView(sg, ui.pend).automated, ui.pend)),
            on(8, (g, p, sg, ui) => issueFleetAutomated(g, p, sg, !fleetSettingsView(sg, ui.pend).automated, ui.pend)),
            // Home base: set, then clear, then set again.
            on(8, (g, p, sg, ui) => issueFleetHomeBase(g, p, sg, p.colonies[0], ui.pend)),
            on(8, (g, p, sg, ui) => issueFleetHomeBase(g, p, sg, null, ui.pend)),
            on(9, (g, p, sg, ui) => issueFleetHomeBase(g, p, sg, p.colonies[0], ui.pend)),
            // Empire-wide: overmatch 3:1 then 5:1; gather 50 %.
            on(9, (g, p, _sg, ui) => issueEmpireSetting(g, p, 'attackOvermatchFactor', 3, ui.pend)),
            on(9, (g, p, _sg, ui) => issueEmpireSetting(g, p, 'attackOvermatchFactor', 5, ui.pend)),
            on(10, (g, p, _sg, ui) => issueEmpireSetting(g, p, 'fleetAttackGatherPortion', Math.fround(0.5), ui.pend)),
            // Troops: on, then three armored spinner clicks in quick succession; Load Troops double-clicked.
            on(10, (g, p, sg, ui) => issueFleetTroopLoadout(g, p, sg, { infantry: 90, armored: 0, artillery: 0, specialForces: 0 }, ui.loadout)),
            ...[11, 11, 12].map((tick) =>
                on(tick, (g, p, sg, ui) => {
                    const l = displayedFleetTroopLoadout(sg, ui.loadout);
                    if (l !== null) issueFleetTroopLoadout(g, p, sg, fleetLoadoutSpin(l, 'armored', l.armored + 1), ui.loadout);
                }),
            ),
            on(12, (g, p, sg, ui) => issueFleetOnce(g, p, sg, 'fleetLoadTroops', ui.pend)),
            on(12, (g, p, sg, ui) => issueFleetOnce(g, p, sg, 'fleetLoadTroops', ui.pend)),
        ];
        const ticks = 20;
        const ref = runInThread(cachedTickGame(gameData), clicks, ticks);
        expect(formed.count, 'the harness player has two free warships').toBe(2);
        const wk = runWorker(cachedTickGame(gameData), clicks, ticks, 3);
        for (const game of [ref.game, wk.host.game]) {
            const p = game.playerEmpire;
            const sg = lastFleet(p)!;
            expect(sg.posture).toBe(FleetPosture.Defend);
            expect(sg.postureRangeSquared).toBe(FLEET_RANGE_LADDER[0]);
            expect(sg.attackRangeSquared).toBe(FLEET_STANCE_LADDER[1]);
            expect(sg.gatherPoint).toBe(p.colonies[0]);
            expect(p.attackOvermatchFactor).toBe(5);
            expect(p.fleetAttackGatherPortion).toBe(Math.fround(0.5));
            expect([sg.troopLoadoutInfantry, sg.troopLoadoutArmored]).toEqual([90, 3]);
        }
        // The same automation outcome in both modes, and a single Load Troops order.
        const autoOf = (g: Game) => lastFleet(g.playerEmpire)!.leadShip!.isAutoControlled;
        expect(autoOf(wk.host.game)).toBe(autoOf(ref.game));
        const ops = (log: string): string[] => (JSON.parse(log) as { op?: string }[]).map((e) => e.op ?? '').filter((o) => o !== '');
        expect(ops(ref.log).filter((o) => o === 'fleetLoadTroops')).toHaveLength(1);
        expect(ops(ref.log).filter((o) => o === 'shipOrderKey').length).toBeGreaterThanOrEqual(2);
        expect(wk.log).toBe(ref.log);
        expect(wk.digest).toBe(ref.digest);
        wk.settle();
        // The replies landed: the panel shows the game's values again.
        const ui = wk.ui;
        for (const v of [ui.pend.posture, ui.pend.range, ui.pend.stance, ui.pend.automated, ui.pend.home, ui.pend.empire]) expect(v.size).toBe(0);
        expect(ui.pend.once.size).toBe(0);
        expect(ui.loadout.size).toBe(0);
        const rsg = lastFleet(wk.client.game.playerEmpire)!;
        expect(fleetSettingsView(rsg, ui.pend).posture).toBe(FleetPosture.Defend);
        expect(fleetSettingsView(rsg, ui.pend).rangeSquared).toBe(FLEET_RANGE_LADDER[0]);
        expect(wk.client.pendingReplies).toBe(0);
        wk.client.dispose();
        wk.host.dispose();
    }, 600000);
});

describe('Fleet Settings: the Improvements switch', () => {
    it('is listed, default on; off makes Q inert (the shortcuts overlay skips its row)', () => {
        const store = new Map<string, string>();
        setSettingsStorage({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) });
        const spec = improvementById('fleetSettings');
        expect(spec?.default).toBe(true);
        expect(isImprovementEnabled('fleetSettings')).toBe(true);
        const q = KEY_BINDINGS.find((b) => b.key === 'Q');
        expect(q?.action).toBe('fleetSettings');
        expect(q?.improvement).toBe('fleetSettings');
        const ev = { key: 'q', ctrlKey: false, altKey: false, shiftKey: false, target: null };
        expect(dispatchKey(ev, {})).toBe('fleetSettings');
        setImprovementEnabled('fleetSettings', false);
        expect(isImprovementEnabled('fleetSettings')).toBe(false);
        expect(dispatchKey(ev, {})).toBeNull();
        expect(JSON.parse(store.get('dwu-ui-settings')!).improvements).toEqual({ fleetSettings: false });
        setImprovementEnabled('fleetSettings', true);
        expect(dispatchKey(ev, {})).toBe('fleetSettings');
        setSettingsStorage(null);
    });
});
