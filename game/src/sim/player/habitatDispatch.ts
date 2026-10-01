// Habitat selection-panel "dispatch" buttons (not in the original as buttons: the original offers the same orders in the
// right-click action menu of a SELECTED SHIP with the habitat under the cursor — Main.Part8.cs 3202 method_344, system-zoom
// ship branch: "Build at X", "Colonize X", "Mine X", "Explore", Patrol / Blockade / Attack ...). Here the player selects the
// habitat and the nearest idle ship that is not selected is sent: for every candidate ship the same action menu is built
// (orderMenu.buildActionMenu with the cursor on the habitat) and the entries that target the habitat are the orders it can
// take, so the validity rules are the original's. Headless; no Rnd. The order itself goes through the existing player
// command path ('shipAction' → executeShipAction, which marks the mission as a player order).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { HabitatCategoryType } from '../types';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectMissionType } from '../missions/mission';
import { checkAlreadyHaveMiningStationAtHabitat } from '../missions/cmdConstruction';
import { ShipAction } from './shipAction';
import { buildActionMenu, describeSubRole, isSelectablePlayerShip, type OrderMenuItem } from './orderMenu';

/** One kind of order a habitat can be sent a ship for (a button). */
export interface DispatchOption {
    /** Stable id: `mission:<BuiltObjectMissionType>` or `build:<BuiltObjectSubRole>`. */
    id: string;
    /** Button label ("Explore", "Colonize", "Build Mining Station"). */
    label: string;
    /** What is missing when no ship qualifies ("no available explorer"). */
    role: string;
    /** The ship to send (null: none qualifies). */
    ship: BuiltObject | null;
    /** The order it takes (null with ship). */
    action: ShipAction | null;
    /** Queued + active tasks of `ship`. */
    tasks: number;
    /** Tooltip text. */
    hint: string;
}

/** Active mission + queued missions (+ the fleet's, when in a fleet). 0 = idle. */
export function shipTaskCount(ship: BuiltObject): number {
    let n = 0;
    const m = ship.mission as { type?: number } | null;
    if (m !== null && m !== undefined && (m.type ?? 0) !== BuiltObjectMissionType.Undefined) n++;
    n += (ship.subsequentMissions ?? []).length;
    return n;
}

function distSq(ship: BuiltObject, x: number, y: number): number {
    const dx = ship.xpos - x;
    const dy = ship.ypos - y;
    return dx * dx + dy * dy;
}

/**
 * Pick the dispatch ship: fewest queued/active tasks first (so idle ships win), then nearest to (x, y), then list order. `excluded` (the current selection) and ships failing `qualifies` are skipped. Pure.
 */
export function pickDispatchShip<T extends BuiltObject>(ships: readonly T[], x: number, y: number, excluded: ReadonlySet<BuiltObject> | readonly BuiltObject[] = [], qualifies?: (s: T) => boolean): T | null {
    const ex = excluded instanceof Set ? excluded : new Set(excluded);
    let best: T | null = null;
    let bestTasks = 0;
    let bestDist = 0;
    for (const s of ships) {
        if (ex.has(s) || s.hasBeenDestroyed || (qualifies !== undefined && !qualifies(s))) continue;
        const t = shipTaskCount(s);
        const d = distSq(s, x, y);
        if (best === null || t < bestTasks || (t === bestTasks && d < bestDist)) {
            best = s;
            bestTasks = t;
            bestDist = d;
        }
    }
    return best;
}

const SKIPPED_MISSIONS = new Set<BuiltObjectMissionType>([
    BuiltObjectMissionType.Move,
    BuiltObjectMissionType.Refuel,
    BuiltObjectMissionType.Repair,
    BuiltObjectMissionType.Retrofit,
    BuiltObjectMissionType.Escape,
    BuiltObjectMissionType.Retire,
    BuiltObjectMissionType.Escort,
    BuiltObjectMissionType.Waypoint,
]);

const MISSION_ROLE: Partial<Record<BuiltObjectMissionType, { label: string; role: string }>> = {
    [BuiltObjectMissionType.Explore]: { label: 'Explore', role: 'explorer' },
    [BuiltObjectMissionType.Colonize]: { label: 'Colonize', role: 'colony ship' },
    [BuiltObjectMissionType.ExtractResources]: { label: 'Mine', role: 'mining ship' },
    [BuiltObjectMissionType.Patrol]: { label: 'Patrol', role: 'warship' },
    [BuiltObjectMissionType.Blockade]: { label: 'Blockade', role: 'warship' },
    [BuiltObjectMissionType.Attack]: { label: 'Attack', role: 'warship' },
    [BuiltObjectMissionType.Bombard]: { label: 'Bombard', role: 'bombardment ship' },
    [BuiltObjectMissionType.Capture]: { label: 'Invade', role: 'troop ship' },
    [BuiltObjectMissionType.Raid]: { label: 'Raid', role: 'raiding ship' },
    [BuiltObjectMissionType.UnloadTroops]: { label: 'Unload troops', role: 'troop ship' },
    [BuiltObjectMissionType.LoadTroops]: { label: 'Load troops', role: 'troop ship' },
};

interface Found {
    id: string;
    label: string;
    role: string;
    action: ShipAction;
}

/** The orders targeting `habitat` that the action menu of `ship` offers (a Build design per sub-role: the first enabled one). */
function ordersForShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject, habitat: Habitat): Found[] {
    const out: Found[] = [];
    const seen = new Set<string>();
    const menu = buildActionMenu({
        galaxy,
        empire,
        selected: ship,
        cursorX: Math.trunc(habitat.xpos),
        cursorY: Math.trunc(habitat.ypos),
        zoomFactor: 1,
        pickAt: () => habitat,
    });
    const visit = (items: OrderMenuItem[]): void => {
        for (const it of items) {
            if (it.key === 'Queue Next Mission') continue;
            if (it.action !== null && it.enabled && it.action.target === habitat && !it.action.isSubsequentAction) {
                const mt = it.action.missionType;
                if (mt !== BuiltObjectMissionType.Undefined && !SKIPPED_MISSIONS.has(mt)) {
                    const design = it.action.design;
                    let found: Found | null = null;
                    if (mt === BuiltObjectMissionType.Build && design !== null) {
                        found = { id: `build:${design.subRole}`, label: `Build ${describeSubRole(design.subRole)}`, role: 'construction ship', action: it.action };
                    } else {
                        const info = MISSION_ROLE[mt];
                        if (info !== undefined) found = { id: `mission:${mt}`, label: info.label, role: info.role, action: it.action };
                    }
                    if (found !== null && !seen.has(found.id)) {
                        seen.add(found.id);
                        out.push(found);
                    }
                }
            }
            visit(it.children);
        }
    };
    visit(menu);
    return out;
}

/** Candidate ships: the player's mobile, finished ships. */
export function dispatchCandidates(empire: Empire): BuiltObject[] {
    return empire.builtObjects.filter((b) => !b.hasBeenDestroyed && b.topSpeed > 0 && isSelectablePlayerShip(empire, b));
}

/**
 * The buttons for a selected habitat. Every order kind some player ship (selected or not) could take is listed; the ship is
 * the best unselected one (pickDispatchShip). Kinds nobody unselected can take are listed with ship = null (disabled).
 * A baseline "Build Mining Station" / "Explore" entry is always listed when it applies to the habitat, so the button
 * explains itself ("no available construction ship") instead of vanishing.
 */
export function habitatDispatchOptions(galaxy: Galaxy, empire: Empire, habitat: Habitat, selected: readonly BuiltObject[] = []): DispatchOption[] {
    if (habitat.category === HabitatCategoryType.Star && habitat.empire === empire) return [];
    const excluded = new Set(selected);
    const perShip = new Map<BuiltObject, Found[]>();
    const kinds = new Map<string, Found>();
    for (const ship of dispatchCandidates(empire)) {
        const f = ordersForShip(galaxy, empire, ship, habitat);
        perShip.set(ship, f);
        for (const x of f) if (!kinds.has(x.id)) kinds.set(x.id, x);
    }
    const addBaseline = (id: string, label: string, role: string): void => {
        if (!kinds.has(id)) kinds.set(id, { id, label, role, action: null as unknown as ShipAction });
    };
    const isBody = habitat.category !== HabitatCategoryType.Star;
    if (isBody && habitat.resources.length > 0 && !checkAlreadyHaveMiningStationAtHabitat(habitat, empire)) {
        const mining = habitat.category === HabitatCategoryType.GasCloud ? BuiltObjectSubRole.GasMiningStation : BuiltObjectSubRole.MiningStation;
        if (![...kinds.keys()].some((k) => k.startsWith('build:'))) addBaseline(`build:${mining}`, `Build ${describeSubRole(mining)}`, 'construction ship');
    }
    if (!empire.visibility.checkSystemExplored(habitat.systemIndex)) addBaseline(`mission:${BuiltObjectMissionType.Explore}`, 'Explore', 'explorer');
    const ships = [...perShip.keys()];
    const options: DispatchOption[] = [];
    for (const k of kinds.values()) {
        const ship = pickDispatchShip(ships, habitat.xpos, habitat.ypos, excluded, (s) => (perShip.get(s) ?? []).some((f) => f.id === k.id));
        const action = ship !== null ? ((perShip.get(ship) ?? []).find((f) => f.id === k.id)?.action ?? null) : null;
        const tasks = ship !== null ? shipTaskCount(ship) : 0;
        options.push({
            id: k.id,
            label: k.label,
            role: k.role,
            ship,
            action,
            tasks,
            hint: ship !== null ? `${k.label}: sends ${ship.name} (${tasks === 0 ? 'idle' : `${tasks} task${tasks === 1 ? '' : 's'} queued`})` : `No available ${k.role}`,
        });
    }
    return options;
}
