// 17c — the order menu and the selection panel's action buttons (src/sim/player/orderMenu.ts): Main.Part8.cs
// 1537-5066 method_316-344 (right-click action menu), Main.Part3.cs 1968 method_593 (the eight buttons), Main.Part10.cs
// 248-697 / 3310-3559 (the default right-click order and its execution). Seed-1 harness game; expectations follow the C#.
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import type { Habitat } from '../src/sim/types';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { ShipActionType, createShipAction } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import {
    buildActionMenu,
    openActionMenu,
    resolveHoverOrder,
    rightClickOrder,
    selectionActions,
    selectionAfterClick,
    selectionButtons,
    applyAutomationOff,
    type OrderMenuContext,
    type OrderMenuItem,
} from '../src/sim/player/orderMenu';

let gameData: GameData;
let galaxy: Galaxy;
let player: Empire;

beforeEach(async () => {
    gameData ??= await loadGameDataFs();
    galaxy = cachedTickGame(gameData).galaxy;
    player = galaxy.playerEmpire!;
});

/** A mobile armed player ship (not a base, not being built). */
function playerWarship(): BuiltObject {
    const ship = player.builtObjects.find((b) => b.role !== BuiltObjectRole.Base && b.builtAt === null && b.topSpeed > 0 && b.firepowerRaw > 0);
    expect(ship).toBeDefined();
    return ship!;
}
/** An unarmed mobile player ship. */
function playerCivilian(): BuiltObject {
    const ship = player.builtObjects.find((b) => b.role !== BuiltObjectRole.Base && b.builtAt === null && b.topSpeed > 0 && b.firepowerRaw <= 0 && b.fighterCapacity <= 0 && (b.troops === null || b.troops.totalAttackStrength <= 0));
    expect(ship).toBeDefined();
    return ship!;
}
/** An AI empire's capital, in a system the player has explored (Empire.SetSystemVisibility Explored). */
function enemyColony(): Habitat {
    const e = galaxy.empires.find((x) => x !== player && x.capital !== null && x.pirateEmpireBaseHabitat === null && x !== galaxy.independentEmpire);
    expect(e).toBeDefined();
    const colony = e!.capital!;
    player.visibility.setSystemVisibility(galaxy.systems[colony.systemIndex].systemStar, SystemVisibilityStatus.Explored);
    return colony;
}
/** A menu context with the cursor on `target` at system zoom (double_0 = 1). */
function ctxAt(selected: OrderMenuContext['selected'], target: Habitat | BuiltObject | ShipGroup | null, zoomFactor = 1): OrderMenuContext {
    const x = target === null ? 0 : target instanceof ShipGroup ? target.leadShip!.xpos : target.xpos;
    const y = target === null ? 0 : target instanceof ShipGroup ? target.leadShip!.ypos : target.ypos;
    return { galaxy, empire: player, selected, cursorX: Math.trunc(x), cursorY: Math.trunc(y), zoomFactor, pickAt: () => target };
}
const keys = (items: OrderMenuItem[]): string[] => items.filter((i) => !i.separator).map((i) => i.key);
function find(items: OrderMenuItem[], key: string): OrderMenuItem | undefined {
    return items.find((i) => i.key === key);
}
function militaryShips(n: number): BuiltObject[] {
    const list = player.builtObjects.filter((b) => b.role !== BuiltObjectRole.Base && b.builtAt === null && b.topSpeed > 0).slice(0, n);
    expect(list.length).toBe(n);
    for (const s of list) {
        s.role = BuiltObjectRole.Military;
        s.subRole = BuiltObjectSubRole.Frigate;
    }
    return list;
}
function makeFleet(): ShipGroup {
    const [ship] = militaryShips(1);
    executeShipAction(galaxy, player, [ship], createShipAction(ShipActionType.CreateNewFleet, null), true);
    return ship.shipGroup as ShipGroup;
}

describe('Main.Part8.cs 3202 method_344 — the action menu', () => {
    it('a player warship over an enemy colony: Move to / Attack / Patrol / Blockade <colony>, then Stop / Join Fleet / Refuel / Retire', () => {
        const ship = playerWarship();
        const colony = enemyColony();
        const items = buildActionMenu(ctxAt(ship, colony));
        const k = keys(items);
        expect(k.slice(0, 4)).toEqual(['Move to X', 'Attack X', 'Patrol X', 'Blockade X']);
        const attack = find(items, 'Attack X')!;
        expect(attack.label).toContain(colony.name);
        expect(attack.action!.missionType).toBe(BuiltObjectMissionType.Attack);
        expect(attack.action!.target).toBe(colony);
        expect(find(items, 'Blockade X')!.action!.missionType).toBe(BuiltObjectMissionType.Blockade);
        expect(k).toContain('Retire');
        // Picking "Attack <colony>" through the 17b executor gives the ship that mission.
        executeShipAction(galaxy, player, ship, attack.action!, true);
        expect(builtObjectMission(ship.mission)!.type).toBe(BuiltObjectMissionType.Attack);
    });

    it('a player warship over an own colony: Move to / Patrol, a Refuel sub-menu and (when damaged) Repair; no Attack', () => {
        const ship = playerWarship();
        const colony = player.capital!;
        ship.damagedComponentCount = 1;
        const items = buildActionMenu(ctxAt(ship, colony));
        const k = keys(items);
        expect(k[0]).toBe('Move to X');
        expect(k).toContain('Patrol X');
        expect(k).not.toContain('Attack X');
        expect(k).not.toContain('Blockade X');
        expect(k).toContain('Refuel');
        expect(find(items, 'Refuel')!.children.length).toBeGreaterThan(0);
        expect(k).toContain('Repair');
        const repair = find(items, 'Repair')!;
        expect(repair.children.map((c) => c.key)).toContain('At nearest ship yard');
    });

    it('a civilian ship has no attack / blockade / patrol entries over an enemy colony', () => {
        const ship = playerCivilian();
        const items = buildActionMenu(ctxAt(ship, enemyColony()));
        const all = JSON.stringify(keys(items));
        expect(all).not.toContain('Attack');
        expect(all).not.toContain('Blockade');
        expect(keys(items)[0]).toBe('Move to X');
    });

    it('empty space: "Move here" with the click point as the position', () => {
        const ship = playerWarship();
        const ctx = ctxAt(ship, null);
        ctx.cursorX = 123456;
        ctx.cursorY = 654321;
        const items = buildActionMenu(ctx);
        const move = items[0];
        expect(move.key).toBe('Move here');
        expect(move.action!.target).toBeNull();
        expect(move.action!.position).toEqual({ x: 123456, y: 654321 });
    });

    it('a ship with a mission gets "Queue Next Mission" whose actions are all IsSubsequentAction', () => {
        const ship = playerWarship();
        const colony = enemyColony();
        executeShipAction(galaxy, player, ship, buildActionMenu(ctxAt(ship, colony))[0].action!, true); // Move to
        const queue = find(buildActionMenu(ctxAt(ship, colony)), 'Queue Next Mission')!;
        expect(queue).toBeDefined();
        const walk = (items: OrderMenuItem[]): void => {
            for (const i of items) {
                if (i.action !== null) expect(i.action.isSubsequentAction).toBe(true);
                walk(i.children);
            }
        };
        walk(queue.children);
        expect(keys(queue.children)).toContain('Clear All Queued Missions');
    });

    it('a fleet over an enemy colony: Attack / Prepare and Attack / Patrol / Blockade, Refuel all ships, Disband Fleet', () => {
        const g = makeFleet();
        const items = buildActionMenu(ctxAt(g, enemyColony()));
        const k = keys(items);
        expect(k).toEqual(expect.arrayContaining(['Move to X', 'Attack X', 'Prepare and Attack X', 'Patrol X', 'Blockade X', 'Disband Fleet', 'Return to base']));
        expect(find(items, 'Disband Fleet')!.action!.actionType).toBe(ShipActionType.DisbandShipGroup);
    });

    it('an own colony: Build at X (designs with costs), facilities, tax sub-menu; a design dearer than StateMoney is disabled', () => {
        const colony = player.capital!;
        player.stateMoney = 0;
        const items = buildActionMenu(ctxAt(colony, colony));
        const k = keys(items);
        expect(k).toContain('Change Colony Tax');
        expect(find(items, 'Change Colony Tax')!.children.map((c) => c.label)).toEqual(['+5%', '+1%', '-1%', '-5%']);
        const build = find(items, 'Build at X');
        if (build !== undefined && build.children.length > 0) {
            expect(build.children.every((c) => !c.enabled)).toBe(true);
            expect(build.children[0].label).toMatch(/\(\d+ .+\)$/);
        }
    });

    it('galaxy zoom (double_0 > 100): target sub-menus (Move to / Attack) instead of direct entries', () => {
        const ship = playerWarship();
        const colony = enemyColony();
        const items = buildActionMenu(ctxAt(ship, colony, 500));
        const k = keys(items);
        expect(k).toContain('Move to');
        const attack = find(items, 'Attack');
        expect(attack).toBeDefined();
        expect(attack!.children.some((c) => c.action!.target === colony)).toBe(true);
    });

    it('actionMenu_Opening: cancelled while a default order exists and Ctrl is up', () => {
        const ship = playerWarship();
        const ctx = ctxAt(ship, enemyColony());
        const order = createShipAction(ShipActionType.AutomateShip, ship);
        expect(openActionMenu(ctx, order, false)).toBeNull();
        expect(openActionMenu(ctx, order, true)!.length).toBeGreaterThan(0);
        expect(openActionMenu({ ...ctx, selected: null }, null, false)).toEqual([]);
    });
});

describe('Main.Part3.cs 1968 method_593 — the selection panel buttons', () => {
    it('a ship: Stop, Refuel/Repair, Retrofit, Escape, (Load Troops), Join Fleet, Automate/Manual, (Fighters)', () => {
        const ship = playerWarship();
        const a = selectionActions({ galaxy, empire: player, selected: ship }, null)!;
        expect(a.length).toBe(8);
        expect(a[0]!.missionType).toBe(BuiltObjectMissionType.Hold);
        expect([BuiltObjectMissionType.Refuel, BuiltObjectMissionType.Repair]).toContain(a[1]!.missionType);
        expect(a[3]!.missionType).toBe(BuiltObjectMissionType.Escape);
        expect([ShipActionType.AutomateShip, ShipActionType.UnautomateShip]).toContain(a[6]!.actionType);
    });

    it('a fleet: Stop, Refuel, Load Troops, Home Base, Attack Target, Posture, Range, Automate', () => {
        const g = makeFleet();
        const b = selectionButtons({ galaxy, empire: player, selected: g }, null)!;
        expect(b.map((x) => x.action?.actionType)).toEqual([
            ShipActionType.Undefined,
            ShipActionType.Undefined,
            ShipActionType.Undefined,
            ShipActionType.SetFleetHomeBase,
            ShipActionType.SetFleetAttackPoint,
            ShipActionType.SetFleetPosture,
            ShipActionType.SetFleetRange,
            g.leadShip!.isAutoControlled ? ShipActionType.UnautomateShip : ShipActionType.AutomateShip,
        ]);
        expect(b[5].hint).toMatch(/Set Posture/);
        expect(b[6].hint).toMatch(/Set Range/);
        // A fleet of a ship without troop space: Load Troops is disabled and says why.
        expect(b[2].enabled).toBe(false);
        expect(b[2].hint).toMatch(/ALL TROOP CARRIERS FULL/);
    });

    it('an own colony: recruit / mercenary / wonder / facility buttons and Build options; disabled ones carry their reason', () => {
        const colony = player.capital!;
        const b = selectionButtons({ galaxy, empire: player, selected: colony }, null)!;
        expect(b[7].action!.actionType).toBe(ShipActionType.BuildOptions);
        expect(b[6].action!.actionType).toBe(ShipActionType.ColonyBuildOptions);
        expect(b[5].action!.actionType).toBe(ShipActionType.ColonyBuildWonder);
        for (const x of b) {
            if (x.action !== null && !x.enabled) expect(x.hint).toMatch(/\(.+\)$/);
        }
    });

    it('the BuildOptions page of an own colony without money: every build button disabled with (NOT ENOUGH MONEY) or (CANNOT BUILD)', () => {
        const colony = player.capital!;
        player.stateMoney = 0;
        const b = selectionButtons({ galaxy, empire: player, selected: colony }, createShipAction(ShipActionType.BuildOptions, colony))!;
        expect(b[7].action!.actionType).toBe(ShipActionType.ReturnToTop);
        const builds = b.slice(0, 6).filter((x) => x.action !== null);
        expect(builds.length).toBeGreaterThan(0);
        for (const x of builds) {
            expect(x.enabled).toBe(false);
            expect(x.hint).toMatch(/\((NOT ENOUGH MONEY|CANNOT BUILD|SPACEPORT ALREADY AT COLONY)\)$/);
        }
    });

    it('after clicking a build button the Build Options page stays open; Automate returns to the top', () => {
        const ship = playerWarship();
        const a = selectionActions({ galaxy, empire: player, selected: ship }, null)!;
        expect(selectionAfterClick(a[6]!)).toBeNull();
        const colony = player.capital!;
        const page = selectionActions({ galaxy, empire: player, selected: colony }, createShipAction(ShipActionType.BuildOptions, colony))!;
        const build = page.find((x) => x !== null && x.design !== null)!;
        expect(selectionAfterClick(build)!.actionType).toBe(ShipActionType.BuildOptions);
    });
});

describe('Main.Part10.cs — right-click orders', () => {
    it('a warship hovering an enemy colony defaults to Attack; the right-click assigns it (manually, not automated)', () => {
        const ship = playerWarship();
        const colony = enemyColony();
        const hover = resolveHoverOrder({ galaxy, empire: player, selected: ship, x: Math.trunc(colony.xpos), y: Math.trunc(colony.ypos), target: colony, shift: false, alt: false, ctrl: false });
        expect(hover.action!.missionType).toBe(BuiltObjectMissionType.Attack);
        expect(hover.text).toMatch(/^Right-click to Attack .*Ctrl-Right-click for more missions/);
        const r = rightClickOrder(galaxy, player, ship, hover.action, { ctrl: false, alt: false });
        expect(r).toEqual({ kind: 'order', executed: true, attackClick: true });
        const m = builtObjectMission(ship.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.Attack);
        expect(m.targetHabitat).toBe(colony);
        expect(ship.isAutoControlled).toBe(false);
    });

    it('Ctrl held: no default order (the menu opens instead); nothing selected: the idle-ships picker', () => {
        const ship = playerWarship();
        const colony = enemyColony();
        expect(resolveHoverOrder({ galaxy, empire: player, selected: ship, x: 0, y: 0, target: colony, shift: false, alt: false, ctrl: true }).action).toBeNull();
        expect(rightClickOrder(galaxy, player, ship, null, { ctrl: true, alt: false }).kind).toBe('none');
        const idle = rightClickOrder(galaxy, player, null, null, { ctrl: false, alt: false });
        if (idle.kind === 'idleShips') expect(idle.items.every((i) => i.select !== undefined)).toBe(true);
        expect(rightClickOrder(galaxy, player, player.capital!, null, { ctrl: false, alt: false }).kind).toBe('center');
    });

    it('the hover order over empty space is Move here with the point', () => {
        const ship = playerWarship();
        const h = resolveHoverOrder({ galaxy, empire: player, selected: ship, x: 5, y: 7, target: null, shift: false, alt: false, ctrl: false });
        expect(h.action!.missionType).toBe(BuiltObjectMissionType.Move);
        expect(h.action!.position).toEqual({ x: 5, y: 7 });
    });

    it('applyAutomationOff turns the prompted automation off (the C# "Turn off automation" answer)', () => {
        player.controlColonyTaxRates = true;
        expect(applyAutomationOff(player, 'Colony Tax Rates')).toBe(true);
        expect(player.controlColonyTaxRates).toBe(false);
        expect(applyAutomationOff(player, 'Nope')).toBe(false);
    });
});

describe('Rnd', () => {
    it('a ship menu over an enemy colony and the ship buttons draw no galaxy.rnd (only the build pages / "Build here" do)', () => {
        const g3 = cachedTickGame(gameData).galaxy;
        const ship = playerWarship();
        const target = enemyColony();
        buildActionMenu(ctxAt(ship, target));
        selectionActions({ galaxy, empire: player, selected: ship }, null);
        expect(galaxy.rnd.next(0, 1 << 30)).toBe(g3.rnd.next(0, 1 << 30));
    });
});
