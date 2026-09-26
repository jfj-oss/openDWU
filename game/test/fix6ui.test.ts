// fix6ui: ship hotkeys (N2), zoom-level default orders (N5), the ? overlay key list (#12) and the sim/render
// decoupling (playtest 2026-09-25-b). Seed-1 harness game for the order keys; expectations follow the C#.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { resolveHoverOrder } from '../src/sim/player/orderMenu';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import {
    KEY_BINDINGS,
    SHIP_COMMAND_ACTIONS,
    dispatchKey,
    findBinding,
    isKeyActionAvailable,
    setShipCommandHandler,
    type ShipCommandAction,
} from '../src/ui/keyboard';
import {
    SelectionHistory,
    executeShipOrderKey,
    fastFindNearestAvailableMilitaryShip,
    nextAttackRangeSquared,
    type HistoryEntry,
} from '../src/ui/shipHotkeys';
import { hoverOrderTarget } from '../src/ui/orderMenu';
import { MAX_CATCH_UP_REAL_MS, SIM_BUDGET_MS_AT_1X, SimFrameBudget, type SteppableDriver } from '../src/simLoop';

const NONE = { ctrl: false, alt: false, shift: false };
const key = (k: string) => ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, target: null });

describe('N2 ship-order and selection keys (Main.Part7.cs Main_KeyUp)', () => {
    afterEach(() => setShipCommandHandler(null));

    it('maps E/R/A/S/, and Z/N/B/L to their Main_KeyUp commands', () => {
        const expected: Array<[string, ShipCommandAction]> = [
            ['E', 'commandEscape'], // ShipEscapeCommand
            ['R', 'commandRefuel'], // RefuelShip
            ['A', 'automateShip'], // EnableAuto
            ['S', 'stopShip'], // StopShip
            [',', 'cycleEngagementStance'], // CycleShipEngagmentRange
            ['Z', 'selectNearestMilitaryShip'], // FindNearestMilitaryShip
            ['N', 'selectionForward'], // CycleSelectionForward
            ['B', 'selectionBackward'], // CycleSelectionBackward
            ['L', 'lockView'], // ToggleViewLock
        ];
        for (const [k, action] of expected) {
            expect(findBinding(k, NONE)?.action, k).toBe(action);
            expect(findBinding(k.toLowerCase(), NONE)?.action, k).toBe(action);
        }
        expect([...SHIP_COMMAND_ACTIONS].sort()).toEqual(expected.map((e) => e[1]).sort());
    });

    it('dispatchKey routes them to the registered handler (no "not yet available" toast)', () => {
        const seen: string[] = [];
        setShipCommandHandler((a) => seen.push(a));
        for (const k of ['E', 'R', 'A', 'S', ',', 'Z', 'N', 'B', 'L']) dispatchKey(key(k), {});
        expect(seen).toEqual(['commandEscape', 'commandRefuel', 'automateShip', 'stopShip', 'cycleEngagementStance', 'selectNearestMilitaryShip', 'selectionForward', 'selectionBackward', 'lockView']);
    });

    it('#12: every bound key action is available in the ? overlay (F4 landed with the intel screen)', () => {
        const unavailable = [...new Set(KEY_BINDINGS.map((b) => b.action))].filter((a) => !isKeyActionAvailable(a));
        expect(unavailable).toEqual([]);
    });

    it('RrhupiLdOr cycles 0 → 4,000,000 → 2.304E+09 → 0 (other values → 2.304E+09)', () => {
        expect(nextAttackRangeSquared(0)).toBe(4000000);
        expect(nextAttackRangeSquared(4000000)).toBe(2304000000);
        expect(nextAttackRangeSquared(2304000000)).toBe(0);
        expect(nextAttackRangeSquared(123)).toBe(2304000000);
    });
});

describe('N2 order keys on the seed-1 game', () => {
    let gameData: GameData;
    let galaxy: Galaxy;
    let player: Empire;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
    });
    beforeEach(() => {
        galaxy = createTickGame(gameData).galaxy;
        player = galaxy.playerEmpire!;
    });
    const mobileShip = (military: boolean): BuiltObject => {
        const s = player.builtObjects.find((b) => b.role !== BuiltObjectRole.Base && b.builtAt === null && b.topSpeed > 0 && (b.role === BuiltObjectRole.Military) === military);
        expect(s).toBeDefined();
        return s!;
    };

    it('S stops the ship: no mission, speeds 0, manual control (Main.Part7.cs 3046-3063)', () => {
        const ship = mobileShip(false);
        ship.isAutoControlled = true;
        ship.targetSpeed = 50;
        ship.preferredSpeed = 50;
        expect(executeShipOrderKey(galaxy, player, ship, 'stopShip')).toBe(true);
        expect(ship.targetSpeed).toBe(0);
        expect(ship.preferredSpeed).toBe(0);
        expect(ship.isAutoControlled).toBe(false);
        const m = builtObjectMission(ship.mission);
        expect(m === null || m.type === BuiltObjectMissionType.Undefined).toBe(true);
    });

    it('A automates the ship and gives it a mission (EnableAuto → AssignMissionToBuiltObject)', () => {
        const ship = mobileShip(true);
        ship.isAutoControlled = false;
        expect(executeShipOrderKey(galaxy, player, ship, 'automateShip')).toBe(true);
        expect(ship.isAutoControlled).toBe(true);
    });

    it('R sends the ship to refuel at the nearest refuelling point (Normal priority, manual)', () => {
        const ship = mobileShip(true);
        ship.isAutoControlled = true;
        expect(executeShipOrderKey(galaxy, player, ship, 'commandRefuel')).toBe(true);
        const m = builtObjectMission(ship.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.Refuel);
        expect(m.priority).toBe(BuiltObjectMissionPriority.Normal);
        expect(ship.isAutoControlled).toBe(false);
    });

    it('E with no attackers and no threats does nothing; , cycles a military ship stance', () => {
        const ship = mobileShip(true);
        const before = builtObjectMission(ship.mission)?.type ?? BuiltObjectMissionType.Undefined;
        expect(executeShipOrderKey(galaxy, player, ship, 'commandEscape')).toBe(false);
        expect(builtObjectMission(ship.mission)?.type ?? BuiltObjectMissionType.Undefined).toBe(before);
        const r0 = ship.attackRangeSquared;
        expect(executeShipOrderKey(galaxy, player, ship, 'cycleEngagementStance')).toBe(true);
        expect(ship.attackRangeSquared).toBe(nextAttackRangeSquared(r0));
        // , is a no-op on a civilian ship (Role != Military).
        const civ = mobileShip(false);
        const c0 = civ.attackRangeSquared;
        expect(executeShipOrderKey(galaxy, player, civ, 'cycleEngagementStance')).toBe(false);
        expect(civ.attackRangeSquared).toBe(c0);
    });

    it('order keys ignore another empire\'s ship and a planet', () => {
        const other = galaxy.empires.find((e) => e !== player && e.builtObjects.some((b) => b.topSpeed > 0 && b.builtAt === null))!;
        const theirs = other.builtObjects.find((b) => b.topSpeed > 0 && b.builtAt === null)!;
        for (const a of ['commandEscape', 'commandRefuel', 'automateShip', 'stopShip', 'cycleEngagementStance'] as const) {
            expect(executeShipOrderKey(galaxy, player, theirs, a), a).toBe(false);
            expect(executeShipOrderKey(galaxy, player, player.capital, a), a).toBe(false);
        }
    });

    it('fleet: , sets the fleet and every ship; S stops every ship and turns automation off', () => {
        const ships = player.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.builtAt === null && b.topSpeed > 0).slice(0, 2);
        expect(ships.length).toBeGreaterThan(0);
        const sg = new ShipGroup(galaxy);
        sg.empire = player;
        for (const s of ships) {
            sg.ships.push(s);
            s.shipGroup = sg;
            s.isAutoControlled = true;
        }
        sg.leadShip = ships[0];
        sg.attackRangeSquared = 0;
        expect(executeShipOrderKey(galaxy, player, sg, 'cycleEngagementStance')).toBe(true);
        expect(sg.attackRangeSquared).toBe(4000000);
        for (const s of ships) expect(s.attackRangeSquared).toBe(4000000);
        expect(executeShipOrderKey(galaxy, player, sg, 'stopShip')).toBe(true);
        for (const s of ships) {
            expect(s.targetSpeed).toBe(0);
            expect(s.isAutoControlled).toBe(false);
        }
        expect(executeShipOrderKey(galaxy, player, sg, 'automateShip')).toBe(true);
        for (const s of ships) expect(s.isAutoControlled).toBe(true);
    });

    it('Z finds the nearest available military ship to the view centre (Galaxy.3.cs 838)', () => {
        const ship = mobileShip(true);
        expect(fastFindNearestAvailableMilitaryShip(galaxy, ship.xpos, ship.ypos, player)).toBe(ship);
    });

    it('N5: a SystemInfo pick resolves as its star, so the default order is not empty at Sector/Galaxy zoom', () => {
        const ship = mobileShip(true);
        const sys = galaxy.systems.find((s) => s.systemStar !== player.capital && s.habitats.indexOf(player.capital!) < 0)!;
        expect(hoverOrderTarget(sys)).toBe(sys.systemStar);
        expect(hoverOrderTarget(null)).toBeNull();
        expect(hoverOrderTarget(ship)).toBe(ship);
        const x = Math.trunc(sys.systemStar.xpos);
        const y = Math.trunc(sys.systemStar.ypos);
        const raw = resolveHoverOrder({ galaxy, empire: player, selected: ship, x, y, target: sys, shift: false, alt: false, ctrl: false });
        const fixed = resolveHoverOrder({ galaxy, empire: player, selected: ship, x, y, target: hoverOrderTarget(sys), shift: false, alt: false, ctrl: false });
        expect(raw.action).toBeNull();
        expect(fixed.action).not.toBeNull();
        expect(fixed.text).not.toBe('');
    });
});

describe('Selection history (Main.Part10.cs list_5 / int_22, btnSelectionForward/Back_Click)', () => {
    const a = { id: 'a' } as unknown as HistoryEntry;
    const b = { id: 'b' } as unknown as HistoryEntry;
    const c = { id: 'c' } as unknown as HistoryEntry;
    const ok = () => true;

    it('push appends, skips duplicates of the current entry, and B/N walk back and forward (wrapping)', () => {
        const h = new SelectionHistory();
        h.push(a);
        h.push(b);
        h.push(b);
        h.push(c);
        expect(h.entries).toEqual([a, b, c]);
        expect(h.back(true, ok)).toBe(b);
        expect(h.back(true, ok)).toBe(a);
        expect(h.back(true, ok)).toBe(c); // wraps to the end
        expect(h.forward(true, ok)).toBe(a); // wraps to the start
        expect(h.forward(true, ok)).toBe(b);
    });

    it('selecting inside the history inserts after the cursor; the next entry just advances', () => {
        const h = new SelectionHistory();
        h.push(a);
        h.push(b);
        h.back(true, ok); // at a
        h.push(b); // == entries[index + 1] → just advance
        expect(h.entries).toEqual([a, b]);
        expect(h.index).toBe(1);
        h.back(true, ok);
        h.push(c);
        expect(h.entries).toEqual([a, c, b]);
    });

    it('drops entries that are gone and caps at 100 entries', () => {
        const h = new SelectionHistory();
        h.push(a);
        h.push(b);
        h.push(c);
        expect(h.back(true, (o) => o !== b)).toBe(a);
        expect(h.entries).toEqual([a, c]);
        const big = new SelectionHistory();
        for (let i = 0; i < 150; i++) big.push({ i } as unknown as HistoryEntry);
        expect(big.entries.length).toBe(100);
        expect((big.entries[0] as unknown as { i: number }).i).toBe(50);
    });
});

describe('Sim/render decoupling: SimFrameBudget step accounting', () => {
    /** A fake SimDriver: each step costs `stepCostMs` of wall time on a fake clock (advance(FRAME_REAL_MS) = 1 step). */
    function fakeDriver(stepCostMs: number) {
        let clock = 0;
        let acc = 0;
        const d: SteppableDriver & { steps: number; paused: boolean } = {
            maxFrames: 4,
            steps: 0,
            paused: false,
            advance(dt: number) {
                if (this.paused) return 0;
                acc += dt;
                let n = 0;
                while (acc >= FRAME_REAL_MS && n < this.maxFrames) {
                    acc -= FRAME_REAL_MS;
                    clock += stepCostMs;
                    n++;
                    this.steps++;
                }
                if (n === this.maxFrames) acc = Math.min(acc, FRAME_REAL_MS);
                return n;
            },
        };
        return { d, now: () => clock, advanceClock: (ms: number) => (clock += ms) };
    }

    /** Steps per real second when the renderer takes `renderMs` per frame (plus the sim's own wall time). */
    function stepsPerRealSecond(speed: number, renderMs: number, stepCostMs: number, seconds = 20): number {
        const { d, now, advanceClock } = fakeDriver(stepCostMs);
        const budget = new SimFrameBudget(now);
        let last = now();
        while (now() < seconds * 1000) {
            advanceClock(renderMs); // the slow render
            const t = now();
            budget.run(d, t - last, speed, false);
            last = t;
        }
        return d.steps / (now() / 1000);
    }

    it('with a fast renderer every speed runs the full 60 fixed steps per real second', () => {
        for (const speed of [1, 2, 4]) expect(stepsPerRealSecond(speed, 16, 0.2)).toBeCloseTo(60, 0);
    });

    it('a 0.7 fps renderer (1,430 ms frames) no longer slows the game clock', () => {
        // The old driver ran at most 4 steps per render frame: 4 / 1.43 s ≈ 2.8 steps/s (≈ 5 % of real time).
        for (const speed of [1, 2, 4]) {
            const sps = stepsPerRealSecond(speed, 1430, 0.5);
            expect(sps, `speed ${speed}`).toBeGreaterThan(59);
            expect(sps, `speed ${speed}`).toBeLessThan(61);
        }
    });

    it('the wall budget: 50 ms × speed per frame, or 75 % of a slow frame', () => {
        const b = new SimFrameBudget(() => 0);
        expect(b.budgetMs(1, 16)).toBe(SIM_BUDGET_MS_AT_1X);
        expect(b.budgetMs(0.25, 16)).toBe(SIM_BUDGET_MS_AT_1X);
        expect(b.budgetMs(2, 16)).toBe(SIM_BUDGET_MS_AT_1X * 2);
        expect(b.budgetMs(4, 16)).toBe(SIM_BUDGET_MS_AT_1X * 4);
        expect(b.budgetMs(1, 1430)).toBeCloseTo(1072.5, 6);
        expect(b.budgetMs(4, 60_000)).toBe(MAX_CATCH_UP_REAL_MS * 0.75);
    });

    it('expensive steps (3 ms) on a slow renderer still keep up at 1×/2×/4×', () => {
        // 1,430 ms render + 18 % sim work ≈ 1.75 s frames: under the 2 s catch-up cap, so nothing is dropped.
        for (const speed of [1, 2, 4]) expect(stepsPerRealSecond(speed, 1430, 3), `speed ${speed}`).toBeGreaterThan(59);
    });

    it('a sim slower than real time is limited, not frozen: the renderer still gets frames', () => {
        // 40 ms per step would need 2.4 s of work per real second; the budget holds the sim to ~3/4 of the wall time.
        const sps = stepsPerRealSecond(1, 100, 40);
        expect(sps).toBeGreaterThan(10);
        expect(sps).toBeLessThan(60);
    });

    it('caps catch-up at 2 s, drops the backlog when paused, and restores maxFrames', () => {
        const { d, now } = fakeDriver(0);
        const budget = new SimFrameBudget(now);
        budget.run(d, 60_000, 1, false); // tab was hidden for a minute
        // 2,000 ms / (1000 / 60) = 120 steps (119 when the float backlog ends a hair short).
        expect(d.steps).toBeGreaterThanOrEqual(Math.round(MAX_CATCH_UP_REAL_MS / FRAME_REAL_MS) - 1);
        expect(d.steps).toBeLessThanOrEqual(Math.round(MAX_CATCH_UP_REAL_MS / FRAME_REAL_MS));
        expect(d.maxFrames).toBe(4);
        budget.run(d, 500, 1, true);
        expect(budget.backlogMs).toBe(0);
        const before = d.steps;
        d.paused = true; // the live pause probe stops mid-frame
        expect(budget.run(d, 500, 1, false)).toBe(0);
        expect(d.steps).toBe(before);
        expect(budget.backlogMs).toBe(0);
    });
});
