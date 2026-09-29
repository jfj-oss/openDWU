// Fog of war at system / planet zoom: what the Main View may draw, pick and describe, from the player's knowledge.
// Render/UI only: reads the sim's visibility state (Empire.visibility, long-range scanners, ship positions), never
// writes it.
//
// Rules ported (DistantWorlds/Controls/MainView.1.cs, the system-zoom draw pass, and Main.Part10/11.cs picking):
//   * A ship / base is drawn only if `GodMode || PlayerEmpire.IsObjectVisibleToThisEmpire(builtObject)` (MainView.1.cs
//     884; the culled-first order: off-screen ships are skipped before the check). The same call gates its
//     explosions, weapons, shield/tractor strikes, hyper animations (they are drawn inside that per-ship block), its
//     liveries / damage overlays, exhaust, lights, and picking / hovering / selecting it (Main.Part11.cs 1387 / 1432 /
//     1636, Main.Part10.cs 555 / 1178 / 1278, Main.Part7.cs 3482).
//   * A launched fighter: `IsObjectVisibleToThisEmpire(fighter)` (MainView.1.cs 1337, Main.Part11.cs 1598) — its
//     carrier visible (and not merely a known pirate base), Empire.9.cs 3095-3112, then the precise tail.
//   * A creature: the Creature overload (Empire.9.cs 3037; creatureLayer.ts creatureVisibleToEmpire).
//   * The precise IsObjectVisibleToThisEmpire (imprecise + a ship / long-range scanner covering the point) is used
//     everywhere the C# renderer / picker calls it; the Imprecise variant only for the galaxy-zoom symbol pass
//     (MainView.2.cs 4845 / 5920; galaxyMarkers.ts).
//   * Planets / moons / asteroids / gas clouds of a system the player has not explored (MainView.1.cs 175-215,
//     440-448, 1750-1770): status Unexplored draws only the star, unless one of the player's ships / long-range
//     scanners is in range (flag4: distance - sensor range <= MaxSolarSystemSize + 500) — then a body is drawn only
//     if it is a gas cloud or `IsObjectVisibleToThisEmpire(habitat)`; its orbit ring and name label follow the same
//     rule. Explored / Visible systems draw everything. The star's name label / info is not offered while
//     Unexplored (Main.Part10.cs 1190 hover, 1291 select, Main.Part7.cs 3489).
//   * GodMode skips all of it. Here: `?godMode=1` (already read by creatureLayer.ts) or `?reveal=1`.
//
// Per-frame cache: FogOfWar.begin() (MainView.update) drops the memo; each object's answer is computed once per frame.

import type { BuiltObject } from '../sim/builtObject';
import type { Creature } from '../sim/creature';
import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import type { Fighter } from '../sim/combat/fighters';
import { isObjectVisibleToThisEmpire } from '../sim/independentTraders';
import { HabitatCategoryType, type Habitat, type SystemInfo } from '../sim/types';
import { MAX_SOLAR_SYSTEM_SIZE, SystemVisibilityStatus, THREAT_RANGE } from '../sim/visibility';
import { creatureVisibleToEmpire } from './creatureLayer';

// ---------------------------------------------------------------------------------------------------------------
// Pure rules (unit-tested with hand-built state)
// ---------------------------------------------------------------------------------------------------------------

/** MainView.1.cs 1608/884: whether the player may see a ship / base (precise IsObjectVisibleToThisEmpire). */
export function builtObjectVisibleToPlayer(galaxy: Galaxy, player: Empire | null, bo: BuiltObject): boolean {
    return player === null || isObjectVisibleToThisEmpire(galaxy, player, bo);
}

/** MainView.1.cs 1337: whether the player may see a launched fighter. */
export function fighterVisibleToPlayer(galaxy: Galaxy, player: Empire | null, f: Fighter): boolean {
    return player === null || isObjectVisibleToThisEmpire(galaxy, player, f);
}

/** Empire.9.cs 3037: whether the player may see a creature. */
export function creatureVisibleToPlayer(galaxy: Galaxy, player: Empire | null, c: Creature): boolean {
    return player === null || creatureVisibleToEmpire(galaxy, player, c);
}

/** Empire.CheckSystemVisibilityStatus for the player; Visible with no player. */
export function playerSystemStatus(player: Empire | null, systemIndex: number): SystemVisibilityStatus {
    return player === null ? SystemVisibilityStatus.Visible : player.visibility.checkSystemVisibilityStatus(systemIndex);
}

/**
 * MainView.1.cs 227-310 `flag4`: an unexplored system with one of the player's ships, or long-range scanners, close
 * enough — dist(system star, ship) - max(ThreatRange, proximity array, long range) <= MaxSolarSystemSize + 500, or
 * dist(star, scanner) - its long range <= the same.
 */
export function systemHasPlayerSensors(galaxy: Galaxy, player: Empire, star: Habitat): boolean {
    const limit = MAX_SOLAR_SYSTEM_SIZE + 500;
    for (const bo of galaxy.builtObjects) {
        if (bo === null || bo.empire !== player) continue;
        let range = THREAT_RANGE;
        if (bo.sensorProximityArrayRange > range) range = bo.sensorProximityArrayRange;
        if (bo.sensorLongRange > range) range = bo.sensorLongRange;
        if (Math.trunc(galaxy.calculateDistance(star.xpos, star.ypos, bo.xpos, bo.ypos)) - range <= limit) return true;
    }
    for (const s of player.longRangeScanners as BuiltObject[]) {
        if (s == null) continue;
        if (Math.trunc(galaxy.calculateDistance(star.xpos, star.ypos, s.xpos, s.ypos)) - s.sensorLongRange <= limit) return true;
    }
    return false;
}

/**
 * MainView.1.cs 440-448 / 1760-1770: whether a body of a system is drawn (with its ring and name). `status` is the
 * player's CheckSystemVisibilityStatus of that system, `sensors` its `flag4` (only read while Unexplored).
 */
export function habitatDrawnInFog(
    galaxy: Galaxy,
    player: Empire | null,
    h: Habitat,
    status: SystemVisibilityStatus,
    sensors: boolean,
): boolean {
    if (player === null || status !== SystemVisibilityStatus.Unexplored) return true;
    if (h.category === HabitatCategoryType.Star) return true;
    if (!sensors) return false;
    if (h.category === HabitatCategoryType.GasCloud) return true;
    return isObjectVisibleToThisEmpire(galaxy, player, h);
}

/** Main.Part10.cs 1291 / Main.Part7.cs 3489: a habitat of an Unexplored system cannot be hovered or selected. */
export function habitatInfoKnown(player: Empire | null, h: Habitat): boolean {
    return playerSystemStatus(player, h.systemIndex) !== SystemVisibilityStatus.Unexplored;
}

/** The parts of the HUD's Selection the fog looks at (hud.ts Selection is structurally compatible). */
export interface FogSelection {
    builtObject?: BuiltObject;
    shipGroup?: { leadShip?: BuiltObject | null } | null;
    creature?: Creature;
}

/**
 * Main.Part10.cs method_209 (1270-1300): the selection panel shows no information on a ship, fleet (its lead ship) or
 * creature the player cannot see — true when the selection should be dropped. Habitat selections are decided at pick
 * time (habitatInfoKnown), not here.
 */
export function selectionUnseen(galaxy: Galaxy, player: Empire | null, sel: FogSelection | null): boolean {
    if (sel === null || player === null) return false;
    const bo = sel.shipGroup?.leadShip ?? sel.builtObject;
    if (sel.creature !== undefined) return !creatureVisibleToPlayer(galaxy, player, sel.creature);
    if (bo !== undefined && bo !== null) return bo.hasBeenDestroyed ? false : !builtObjectVisibleToPlayer(galaxy, player, bo);
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-frame cache
// ---------------------------------------------------------------------------------------------------------------

export class FogOfWar {
    /** Dev toggle (`?reveal=1` / `?godMode=1`): everything is seen, like the original's GodMode. */
    reveal = false;
    private memo = new Map<object, boolean>();
    private sensors = new Map<SystemInfo | Habitat, boolean>();

    constructor(private galaxy: Galaxy) {}

    /** Start of a frame: forget last frame's answers. */
    begin(): void {
        this.memo.clear();
        this.sensors.clear();
    }

    get player(): Empire | null {
        return this.reveal ? null : this.galaxy.playerEmpire;
    }

    private cached(o: object, compute: () => boolean): boolean {
        const hit = this.memo.get(o);
        if (hit !== undefined) return hit;
        const v = compute();
        this.memo.set(o, v);
        return v;
    }

    builtObject(bo: BuiltObject): boolean {
        const p = this.player;
        if (p === null) return true;
        if (bo.empire === p) return true;
        return this.cached(bo, () => builtObjectVisibleToPlayer(this.galaxy, p, bo));
    }

    fighter(f: Fighter): boolean {
        const p = this.player;
        if (p === null) return true;
        return this.cached(f, () => fighterVisibleToPlayer(this.galaxy, p, f));
    }

    creature(c: Creature): boolean {
        const p = this.player;
        if (p === null) return true;
        return this.cached(c, () => creatureVisibleToPlayer(this.galaxy, p, c));
    }

    status(systemIndex: number): SystemVisibilityStatus {
        return playerSystemStatus(this.player, systemIndex);
    }

    /** flag4 of a system (cached for the frame). */
    systemSensors(star: Habitat): boolean {
        const p = this.player;
        if (p === null) return true;
        let v = this.sensors.get(star);
        if (v === undefined) {
            v = systemHasPlayerSensors(this.galaxy, p, star);
            this.sensors.set(star, v);
        }
        return v;
    }

    /** Whether a habitat is drawn (with its ring and label) at system zoom. */
    habitatDrawn(h: Habitat): boolean {
        const p = this.player;
        if (p === null) return true;
        const status = playerSystemStatus(p, h.systemIndex);
        if (status !== SystemVisibilityStatus.Unexplored) return true;
        if (h.category === HabitatCategoryType.Star) return true;
        const star = this.galaxy.systems[h.systemIndex]?.systemStar;
        if (star === undefined) return true;
        return this.cached(h, () => habitatDrawnInFog(this.galaxy, p, h, status, this.systemSensors(star)));
    }

    /** Whether the selection panel must drop this selection (see selectionUnseen). */
    selectionUnseen(sel: FogSelection | null): boolean {
        return selectionUnseen(this.galaxy, this.player, sel);
    }

    /** Whether a habitat may be hovered / selected / described (its system is not Unexplored). */
    habitatInfo(h: Habitat): boolean {
        return habitatInfoKnown(this.player, h);
    }
}

const registry = new WeakMap<Galaxy, FogOfWar>();

/** The fog of a galaxy, shared by every layer (one per galaxy; MainView begins each frame and sets `reveal`). */
export function fogOf(galaxy: Galaxy): FogOfWar {
    let f = registry.get(galaxy);
    if (f === undefined) {
        f = new FogOfWar(galaxy);
        registry.set(galaxy, f);
    }
    return f;
}
