// [dw2overlays] Fuel Range overlay (Improvements). With one of the player's ships or fleets selected: every refuelling
// point the player knows, coloured by where it lies against the selection's range rings (mainView.ts updateRangeRings /
// rangeRings.ts: green inside the 45% "there and back" ring, amber inside the 100% ring, grey beyond) and crossed out red
// where the ship may not or cannot refuel (no military refuelling agreement, no stock of its fuel); a dashed line to the
// point the sim itself would send it to refuel, and a short fuel / reach label at the ship. With nothing selected: the
// player's refuelling network (own points green, other empires' cyan; squares = resupply ships and deep-space depots).
// Data: rangeRings.ts fuelOverlayData (the ported fuel code in sim/movement.ts, read-only). NOT in the original.
//
// Cost: the data is refreshed twice a second and on a selection change (157 points on the 2500-star late save: well
// under a millisecond); the markers are redrawn only when the camera or the data changed (every frame at system zoom,
// for the points in view, as the planets orbit).

import { Container, Graphics, Text } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import type { Habitat } from '../sim/types';
import { drawnBuiltObjectPos, type MotionInterpolator } from './renderInterp';
import { overlayActive, type MapOverlayState } from '../ui/mapOverlays';
import type { SelectedObjectLike } from './mapHighlights';
import { dashSegments } from './overlayLayer';
import { circleAtScreenRes } from './screenCircle';
import { RefuelReach, fuelOverlayData, playerShipsOfSelection, type FuelOverlayData, type RefuelPoint } from './rangeRings';

export const FUEL_COLORS = {
    roundTrip: 0x4fe07a,
    oneWay: 0xf0c040,
    beyond: 0x7c8a99,
    blocked: 0xd05050,
    own: 0x4fe07a,
    foreign: 0x5fc8ff,
    nearest: 0xffffff,
} as const;

/** Marker colour and alpha for one point. */
export function refuelPointStyle(p: RefuelPoint): { color: number; alpha: number; hollow: boolean } {
    if (p.reach === null) return { color: p.own ? FUEL_COLORS.own : FUEL_COLORS.foreign, alpha: 0.9, hollow: false };
    if (!p.usable) return { color: FUEL_COLORS.blocked, alpha: 0.6, hollow: true };
    if (p.reach === RefuelReach.RoundTrip) return { color: FUEL_COLORS.roundTrip, alpha: 1, hollow: false };
    if (p.reach === RefuelReach.OneWay) return { color: FUEL_COLORS.oneWay, alpha: 1, hollow: false };
    return { color: FUEL_COLORS.beyond, alpha: 0.7, hollow: false };
}

/** "6.5M" / "830K" / "900": a world distance, short. */
export function shortDistance(d: number): string {
    if (d >= 1e6) return `${(d / 1e6).toFixed(d >= 1e7 ? 0 : 1)}M`;
    if (d >= 1e3) return `${Math.round(d / 1e3)}K`;
    return `${Math.round(d)}`;
}

/** The label at the ship: fuel %, reach, points in reach, where it would refuel. */
export function fuelLabelText(data: FuelOverlayData, galaxyName: (o: Habitat | BuiltObject) => string): string {
    const s = data.ship;
    if (s === null) return '';
    const pct = s.fuelCapacity > 0 ? Math.round((100 * s.currentFuel) / s.fuelCapacity) : 0;
    const reach = data.radii !== null ? `reach ${shortDistance(data.radii.range100)}` : 'no reach (out of fuel)';
    let rt = 0;
    let ow = 0;
    for (const p of data.points) {
        if (!p.usable) continue;
        if (p.reach === RefuelReach.RoundTrip) rt++;
        else if (p.reach === RefuelReach.OneWay) ow++;
    }
    const lines = [`Fuel ${pct}% · ${reach}`, `Refuel: ${rt} there-and-back · ${ow} one-way`];
    if (data.nearest !== null) lines.push(`Would refuel at ${galaxyName(data.nearest)}`);
    return lines.join('\n');
}

/** Hover text for one refuelling point. */
export function refuelPointTooltip(p: RefuelPoint, name: string, ownerName: string | null): string {
    const owner = p.own ? 'yours' : (ownerName ?? 'independent');
    const kind = p.militaryOnly ? 'Military refuelling point' : 'Refuelling point';
    let state = '';
    if (p.blocked === 'treaty') state = 'cannot refuel here: no military refuelling agreement';
    else if (p.blocked === 'fuel') state = "cannot refuel here: no stock of this ship's fuel";
    else if (p.reach === RefuelReach.RoundTrip) state = 'in reach, there and back';
    else if (p.reach === RefuelReach.OneWay) state = 'in reach, one way';
    else if (p.reach === RefuelReach.Beyond) state = 'beyond reach on the current fuel';
    return `${kind}: ${name} (${owner})${state !== '' ? `\n${state}` : ''}`;
}

export class FuelOverlay {
    readonly root = new Container();
    private markers = new Graphics();
    private line = new Graphics();
    private label: Text | null = null;
    private labelText = '';
    private data: FuelOverlayData | null = null;
    private dataFor: unknown = undefined;
    private frame = 0;
    private built = { valid: false, z: 0, x: 0, y: 0, w: 0, h: 0, data: null as FuelOverlayData | null };
    private drawnPoints: { x: number; y: number; p: RefuelPoint }[] = [];
    motion: MotionInterpolator | null = null;
    getSelection: () => SelectedObjectLike = () => null;

    constructor(
        private galaxy: Galaxy,
        parent: Container,
        private state: MapOverlayState,
    ) {
        this.root.addChild(this.markers, this.line);
        this.root.visible = false;
        parent.addChild(this.root);
    }

    private pos(o: Habitat | BuiltObject): { x: number; y: number } {
        if ('builtObjectID' in o) return this.motion !== null ? drawnBuiltObjectPos(this.motion, o) : { x: o.xpos, y: o.ypos };
        return this.motion !== null ? this.motion.habitatPos(o) : { x: o.xpos, y: o.ypos };
    }

    update(z: number, cam: Camera): void {
        const player = this.galaxy.playerEmpire;
        if (!overlayActive(this.state, 'fuelRange') || player === null) {
            if (this.root.visible) {
                this.root.visible = false;
                this.markers.clear();
                this.line.clear();
                this.drawnPoints = [];
                this.built.valid = false;
                this.data = null;
            }
            return;
        }
        const sel = this.getSelection();
        const { ships, lead } = playerShipsOfSelection(sel, player);
        const selKey = lead;
        if (this.data === null || selKey !== this.dataFor || this.frame % 30 === 0) {
            const from = lead !== null ? { x: lead.xpos, y: lead.ypos } : null;
            this.data = fuelOverlayData(this.galaxy, player, ships, from);
            this.dataFor = selKey;
            this.labelText = fuelLabelText(this.data, (o) => o.name);
        }
        this.frame++;
        const data = this.data;
        const f = 1 / z;
        const systemZoom = f < 70;
        const k = this.built;
        if (systemZoom || !(k.valid && k.z === z && k.x === cam.x && k.y === cam.y && k.w === cam.width && k.h === cam.height && k.data === data)) {
            k.valid = true;
            k.z = z;
            k.x = cam.x;
            k.y = cam.y;
            k.w = cam.width;
            k.h = cam.height;
            k.data = data;
            this.drawMarkers(z, cam, data);
        }
        this.drawLine(z, data, lead);
        this.root.visible = true;
    }

    private drawMarkers(z: number, cam: Camera, data: FuelOverlayData): void {
        const g = this.markers;
        g.clear();
        this.drawnPoints = [];
        const halfW = cam.width / (2 * z) + 20 / z;
        const halfH = cam.height / (2 * z) + 20 / z;
        const r = 5 / z;
        // Draw the beyond / blocked ones first, the usable ones on top.
        const order = data.points.slice().sort((a, b) => Number(a.usable) - Number(b.usable) || (b.reach ?? 0) - (a.reach ?? 0));
        for (const p of order) {
            const o = p.target;
            if (o.xpos < cam.x - halfW || o.xpos > cam.x + halfW || o.ypos < cam.y - halfH || o.ypos > cam.y + halfH) continue;
            const at = this.pos(o);
            const st = refuelPointStyle(p);
            if (p.militaryOnly) g.rect(at.x - r * 0.8, at.y - r * 0.8, r * 1.6, r * 1.6);
            else g.poly([at.x, at.y - r, at.x + r, at.y, at.x, at.y + r, at.x - r, at.y]);
            if (st.hollow) {
                g.stroke({ width: 1.5 / z, color: st.color, alpha: st.alpha });
                g.moveTo(at.x - r * 0.7, at.y - r * 0.7).lineTo(at.x + r * 0.7, at.y + r * 0.7).stroke({ width: 1.5 / z, color: st.color, alpha: st.alpha });
            } else {
                g.fill({ color: st.color, alpha: st.alpha * 0.85 }).stroke({ width: 1 / z, color: 0x000000, alpha: 0.6 });
            }
            this.drawnPoints.push({ x: at.x, y: at.y, p });
        }
    }

    private drawLine(z: number, data: FuelOverlayData, lead: BuiltObject | null): void {
        const g = this.line;
        g.clear();
        if (data.ship === null || lead === null) {
            if (this.label !== null) this.label.visible = false;
            return;
        }
        const f = 1 / z;
        const a = this.pos(lead);
        if (data.nearest !== null) {
            const b = this.pos(data.nearest);
            const pt = data.points.find((p) => p.target === data.nearest);
            const color = pt === undefined || pt.reach === RefuelReach.Beyond ? FUEL_COLORS.blocked : pt.reach === RefuelReach.RoundTrip ? FUEL_COLORS.roundTrip : FUEL_COLORS.oneWay;
            for (const [x1, y1, x2, y2] of dashSegments(a.x, a.y, b.x, b.y, 8 * f, 5 * f, 300)) g.moveTo(x1, y1).lineTo(x2, y2);
            g.stroke({ width: 1.5 * f, color, alpha: 0.9 });
            circleAtScreenRes(g, b.x, b.y, 10 * f, z).stroke({ width: 2 * f, color: FUEL_COLORS.nearest, alpha: 0.9 });
        }
        const text = this.labelText;
        if (this.label === null) {
            this.label = new Text({ text: '', style: { fontFamily: 'sans-serif', fontSize: 12, fill: 0xffe9a0, stroke: { color: 0x000000, width: 3 }, lineHeight: 15 } });
            this.label.anchor.set(0.5, 0);
            this.root.addChild(this.label);
        }
        if (this.label.text !== text) this.label.text = text;
        this.label.visible = true;
        this.label.position.set(a.x, a.y + 26 * f);
        this.label.scale.set(f);
    }

    /** The hover text of the refuelling point under world (wx, wy), or null. */
    hitTest(wx: number, wy: number, z: number): string | null {
        if (!this.root.visible) return null;
        const r = 7 / z;
        for (const d of this.drawnPoints) {
            if (Math.abs(wx - d.x) <= r && Math.abs(wy - d.y) <= r) {
                const owner = d.p.target.empire as { name?: string } | null;
                return refuelPointTooltip(d.p, d.p.target.name, owner?.name ?? null);
            }
        }
        return null;
    }

    destroy(): void {
        this.label?.destroy();
        this.label = null;
    }
}
