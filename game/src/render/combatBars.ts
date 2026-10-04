// Battle bars at close zoom (zoom factor <= 3): the original's shield line, boarding (assault) bar, flashing boarding
// icon and fleet-leader badge over each ship, and the shield line over fighters. Render only: reads the sim, never
// writes it.
//
// Sources (DistantWorlds/Controls, the XNA path):
//   MainView.1.cs 1251-1295 — per ship, inside the ship draw block, when double_0 <= 3:
//     - int_34 < 1 (display type 0, mainViewDisplay.ts showsBattleBars) and BuiltObject.InBattle:
//       · ShieldsCapacity > 0: method_194 at (left, top - 8), width = the ship image's width at zoom factor 1
//         (bitmap5 = list_9, PrepareBuiltObjectImageNEW(..., 1.0), DetermineBuiltObjectSizeNEW at zoom 1)
//       · AssaultDefenseValue > 0 || AssaultAttackValue > 0: method_195 at (left, top - 4) with
//         (AssaultDefenseValueDefault, AssaultDefenseValueFixed, max(0, AssaultDefenseValue - Fixed), AssaultAttackValue)
//         — when AssaultAttackValue > 0, else when AssaultDefenseValueDefault > 0
//       · AssaultAttackValue > 0: ui/chrome/assault.png (texture2D_25 = bitmap_88) at its own size, centred on the ship,
//         tinted method_214(Red, Yellow, CurrentDateTime) — a 2 s red ↔ yellow pulse
//     - int_34 < 2 (showsMapIndicators) and the ship leads its fleet: method_191 — ui/chrome/fleetLeader.png scaled to 20 x 20
//       (texture2D_10, MainView.1.cs 2206-2208) with its top-left at (left + width + 2 - fleetLeader.png's own width,
//       top - 2)
//     where (left, top) = the ship centre (screen px, truncated) minus half that zoom-1 image.
//   MainView.1.cs 1542-1547 — a fighter in battle with ShieldsCapacity > 0: method_194 at (left, top - 8) of its drawn
//     image (bitmap11, prepared at the current zoom).
//   MainView.2.cs 2942 method_194 — a 2 px line: [left, left + n] in color_9 (64, 0, 255) and, while shields < capacity,
//     [left + n, left + width] in color_10 (255, 0, 96), n = (int)(current / capacity x width).
//   MainView.2.cs 2952 method_195 — three 2 px segments: AssaultDefenseValueFixed share in color_11 (64, 255, 0), the
//     rest of the defence in color_12 (36, 144, 0), then the remainder in color_14 (255, 96, 0) when an attack is
//     under way (shares of fixed + defence + attack) or color_13 (8, 32, 0) otherwise (shares of the default defence).
//   MainView.cs 1434-1439 — color_9..color_14.
//   GDI twin: MainView.cs 4521-4535 (shield line + badge only).
// XnaDrawingHelper.DrawLine (non-dashed) draws a thickness-tall quad centred on the line (origin (0, 0.5)).

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Camera } from './camera';
import type { AssetStore } from './assets';
import type { BuiltObject } from '../sim/builtObject';
import type { Fighter } from '../sim/combat/fighters';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import { showsBattleBars, showsMapIndicators } from './mainViewDisplay';

/** MainView.1.cs 1251: the bars are drawn while the zoom factor is at most 3. */
export const BATTLE_BARS_MAX_FACTOR = 3.0;
/** method_194 / method_195: lines are 2 px thick. */
export const BAR_THICKNESS_PX = 2;
/** MainView.1.cs 1258 / 1268: the shield line 8 px and the boarding bar 4 px above the image's top. */
export const SHIELD_LINE_OFFSET_PX = 8;
export const ASSAULT_BAR_OFFSET_PX = 4;
/** MainView.1.cs 2206: texture2D_10 = fleetLeader.png scaled to 20 x 20. */
export const FLEET_LEADER_BADGE_PX = 20;
/** bitmap_43.Width: fleetLeader.png's own width (14 x 13 in the stock install), used for the badge's x. */
export const FLEET_LEADER_ART_WIDTH_PX = 14;

// MainView.cs 1434-1439.
export const COLOR_9 = 0x4000ff;
export const COLOR_10 = 0xff0060;
export const COLOR_11 = 0x40ff00;
export const COLOR_12 = 0x249000;
export const COLOR_13 = 0x082000;
export const COLOR_14 = 0xff6000;

export const FLEET_LEADER_URL = '/assets/dwu/images/ui/chrome/fleetLeader.png';
export const ASSAULT_ICON_URL = '/assets/dwu/images/ui/chrome/assault.png';

/** One 2 px bar segment in screen px relative to the image's top-left: [x1, x2] at height y. */
export interface BarLine {
    x1: number;
    x2: number;
    y: number;
    color: number;
}

/** Port of MainView.2.cs 2942 method_194: the shield line of an image `width` px wide, at height y. */
export function shieldLine(width: number, capacity: number, current: number, y: number, out: BarLine[] = []): BarLine[] {
    const num = Math.trunc((current / capacity) * width);
    if (current < capacity) out.push({ x1: num, x2: width, y, color: COLOR_10 });
    out.push({ x1: 0, x2: num, y, color: COLOR_9 });
    return out;
}

/**
 * Port of MainView.2.cs 2952 method_195(width, int_14 = AssaultDefenseValueDefault, int_15 = AssaultDefenseValueFixed,
 * int_16 = defence above the fixed part, int_17 = AssaultAttackValue): the boarding bar at height y.
 */
export function assaultBar(width: number, defenseDefault: number, defenseFixed: number, defenseRest: number, attack: number, y: number, out: BarLine[] = []): BarLine[] {
    if (attack > 0) {
        const num = defenseFixed + defenseRest + attack;
        const num2 = Math.trunc(Math.min(1.0, defenseFixed / num) * width);
        const num3 = Math.trunc(Math.min(1.0, defenseRest / num) * width);
        out.push({ x1: 0, x2: num2, y, color: COLOR_11 });
        out.push({ x1: num2, x2: num2 + num3, y, color: COLOR_12 });
        out.push({ x1: num2 + num3, x2: width, y, color: COLOR_14 });
    } else if (defenseDefault > 0) {
        const num4 = Math.trunc(Math.min(1.0, defenseFixed / defenseDefault) * width);
        const num5 = Math.trunc(Math.min(1.0, defenseRest / defenseDefault) * width);
        out.push({ x1: 0, x2: num4, y, color: COLOR_11 });
        out.push({ x1: num4, x2: num4 + num5, y, color: COLOR_12 });
        out.push({ x1: num4 + num5, x2: width, y, color: COLOR_13 });
    }
    return out;
}

/** The ship fields the bars read. */
export type BarShip = Pick<
    BuiltObject,
    'inBattle' | 'shieldsCapacity' | 'currentShields' | 'assaultDefenseValue' | 'assaultDefenseValueFixed' | 'assaultDefenseValueDefault' | 'assaultAttackValue' | 'shipGroup'
>;

/**
 * MainView.1.cs 1253-1279: the shield line and boarding bar of a ship whose zoom-1 image is `unitPx` square, relative
 * to that image's top-left (y < 0 is above it). Empty when the ship is not in battle.
 */
export function shipBattleBars(bo: BarShip, unitPx: number, out: BarLine[] = []): BarLine[] {
    if (!bo.inBattle) return out;
    if (bo.shieldsCapacity > 0) shieldLine(unitPx, bo.shieldsCapacity, Math.trunc(bo.currentShields), -SHIELD_LINE_OFFSET_PX, out);
    if (bo.assaultDefenseValue > 0 || bo.assaultAttackValue > 0) {
        const fixed = bo.assaultDefenseValueFixed;
        const rest = Math.max(0, bo.assaultDefenseValue - fixed);
        if (bo.assaultAttackValue > 0 || bo.assaultDefenseValueDefault > 0) {
            assaultBar(unitPx, bo.assaultDefenseValueDefault, fixed, rest, bo.assaultAttackValue, -ASSAULT_BAR_OFFSET_PX, out);
        }
    }
    return out;
}

/** MainView.1.cs 1281: the flashing boarding icon shows while the ship is boarding (in battle, AssaultAttackValue > 0). */
export function showsAssaultIcon(bo: Pick<BuiltObject, 'inBattle' | 'assaultAttackValue'>): boolean {
    return bo.inBattle && bo.assaultAttackValue > 0;
}

/** MainView.1.cs 1289: the fleet-leader badge (any battle state). */
export function showsFleetLeaderBadge(bo: Pick<BuiltObject, 'shipGroup'>): boolean {
    const sg = bo.shipGroup as ShipGroup | null;
    return sg !== null && sg !== undefined && sg.leadShip === bo;
}

/** MainView.1.cs 1292 method_191: the badge's top-left relative to the image's top-left. */
export function fleetLeaderBadgeOffset(unitPx: number): { x: number; y: number } {
    return { x: unitPx + 2 - FLEET_LEADER_ART_WIDTH_PX, y: -2 };
}

/**
 * Port of MainView.2.cs 3157 method_214 (and 3136 method_213's colour sweep): the colour between `from` and `to` at
 * `ms` (a DateTime's Second / Millisecond): a 2 s triangle wave (to at :00.000, from at :01.000, to again at :02.000),
 * with the C#'s byte arithmetic per channel. Colours are 0xAARRGGBB.
 */
export function pulseColor(from: number, to: number, second: number, millisecond: number): number {
    let num2 = millisecond;
    if (second % 2 === 1) num2 += 1000;
    const num = num2 <= 1000 ? Math.abs(1000 - num2) / 1000.0 : (num2 - 1000) / 1000.0;
    let out = 0;
    for (const shift of [24, 16, 8, 0]) {
        const a = (from >>> shift) & 0xff;
        const b = (to >>> shift) & 0xff;
        // (byte)(a - (byte)((a - b) * num)): the inner cast wraps a negative product mod 256.
        const inner = Math.trunc((a - b) * num) & 0xff;
        out = out * 256 + ((a - inner) & 0xff);
    }
    return out >>> 0;
}

/** method_214(Color.FromArgb(255, 0, 0), Color.FromArgb(255, 255, 0), CurrentDateTime) at game time `nowMs`. */
export function assaultIconTint(nowMs: number): number {
    const totalMs = Math.floor(nowMs);
    const second = ((Math.floor(totalMs / 1000) % 60) + 60) % 60;
    const ms = ((totalMs % 1000) + 1000) % 1000;
    return pulseColor(0xffff0000, 0xffffff00, second, ms) & 0xffffff;
}

/** A drawn ship the layer decorates: its drawn centre and its zoom-1 image side (px). */
export interface DrawnBarShip {
    bo: BuiltObject;
    x: number;
    y: number;
    unitPx: number;
}

/** A drawn fighter: its drawn centre and drawn size (px). */
export interface DrawnBarFighter {
    fighter: Fighter;
    x: number;
    y: number;
    px: number;
}

/**
 * The battle-bar layer (world space, above the ships and fighters). Each frame at f <= 3 it draws the bars of every
 * ship / fighter the ship and fighter layers drew this frame, at their drawn (render-interpolated) positions.
 */
export class BattleBarLayer {
    readonly root = new Container();
    private lines = new Graphics();
    private icons = new Container();
    private badgeTex: Texture | null = null;
    private assaultTex: Texture | null = null;
    private pool: Sprite[] = [];
    private used = 0;
    private scratch: BarLine[] = [];
    private drawnLast = false;

    constructor(world: Container, store: AssetStore) {
        world.addChild(this.root);
        this.root.addChild(this.lines, this.icons);
        this.root.visible = false;
        if (store.dwuPresent) {
            void store.loadFirst([FLEET_LEADER_URL], () => Texture.EMPTY).then((t) => {
                if (t !== Texture.EMPTY) this.badgeTex = t;
            });
            void store.loadFirst([ASSAULT_ICON_URL], () => Texture.EMPTY).then((t) => {
                if (t !== Texture.EMPTY) this.assaultTex = t;
            });
        }
    }

    private sprite(tex: Texture): Sprite {
        let s = this.pool[this.used];
        if (s === undefined) {
            s = new Sprite(tex);
            this.pool.push(s);
            this.icons.addChild(s);
        }
        s.texture = tex;
        s.visible = true;
        this.used++;
        return s;
    }

    update(z: number, cam: Camera, ships: Iterable<DrawnBarShip>, fighters: Iterable<DrawnBarFighter>, nowMs: number): void {
        const f = 1 / z;
        if (!(f <= BATTLE_BARS_MAX_FACTOR)) {
            if (this.drawnLast) {
                this.lines.clear();
                for (const s of this.pool) s.visible = false;
                this.drawnLast = false;
            }
            this.root.visible = false;
            return;
        }
        this.root.visible = true;
        this.drawnLast = true;
        // Float32 vertices: draw relative to the camera centre (galaxy coordinates run to millions).
        const ox = cam.x;
        const oy = cam.y;
        this.root.position.set(ox, oy);
        const g = this.lines;
        g.clear();
        this.used = 0;
        const k = 1 / z; // world units per screen px
        const tint = assaultIconTint(nowMs);
        const bars = showsBattleBars();
        const badges = showsMapIndicators();
        let any = false;
        for (const d of ships) {
            const bo = d.bo;
            const half = Math.trunc(d.unitPx / 2);
            const left = d.x - ox - half * k;
            const top = d.y - oy - half * k;
            if (bars) {
                const lines = shipBattleBars(bo, d.unitPx, (this.scratch.length = 0, this.scratch));
                for (const l of lines) any = this.addLine(g, left, top, l, k) || any;
            }
            if (bars && showsAssaultIcon(bo) && this.assaultTex !== null) {
                const t = this.assaultTex;
                const s = this.sprite(t);
                s.anchor.set(0, 0);
                // At its own size, centred: (int)centre - Width / 2.
                s.position.set(d.x - ox - Math.trunc(t.width / 2) * k, d.y - oy - Math.trunc(t.height / 2) * k);
                s.scale.set(k);
                s.tint = tint;
            }
            if (badges && showsFleetLeaderBadge(bo) && this.badgeTex !== null) {
                const o = fleetLeaderBadgeOffset(d.unitPx);
                const s = this.sprite(this.badgeTex);
                s.anchor.set(0, 0);
                s.position.set(left + o.x * k, top + o.y * k);
                s.scale.set((FLEET_LEADER_BADGE_PX * k) / (this.badgeTex.width || 1), (FLEET_LEADER_BADGE_PX * k) / (this.badgeTex.height || 1));
                s.tint = 0xffffff;
            }
        }
        for (const d of bars ? fighters : []) {
            const fi = d.fighter;
            if (!fi.inBattle || !(fi.specification.shieldsCapacity > 0)) continue;
            const half = Math.trunc(d.px / 2);
            const left = d.x - ox - half * k;
            const top = d.y - oy - half * k;
            const lines = shieldLine(d.px, fi.specification.shieldsCapacity, Math.trunc(fi.currentShields), -SHIELD_LINE_OFFSET_PX, (this.scratch.length = 0, this.scratch));
            for (const l of lines) any = this.addLine(g, left, top, l, k) || any;
        }
        for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
        this.lines.visible = any;
    }

    /** One 2 px segment (XnaDrawingHelper.DrawLine: a quad of the thickness centred on the line). */
    private addLine(g: Graphics, left: number, top: number, l: BarLine, k: number): boolean {
        if (l.x1 === l.x2) return false;
        const x1 = Math.min(l.x1, l.x2);
        const w = Math.abs(l.x2 - l.x1);
        g.rect(left + x1 * k, top + (l.y - BAR_THICKNESS_PX / 2) * k, w * k, BAR_THICKNESS_PX * k).fill({ color: l.color, alpha: 1 });
        return true;
    }
}
