// The "Waypoints & Known Locations" map overlay (an Improvement, ui/waypoints.ts) and the original's location-hint
// pulse.
//
// Port (always drawn, as the original): MainView.2.cs 3436 method_229 / 3455 method_230 — every Empire.LocationHints
// point of the player, drawn by method_250 (so only above BaconMain minZoomLevelForWeaponsCircles, as the event pings)
// as a dashed circle (XnaDrawingHelper.DrawCircle(area, color, 1, dashed: true): 30 sides, every other one drawn) in
// color_17 = (96, 64, 255) (MainView.cs 1469), growing from 1 to int_10 = 40 px over double_13 = 2.4 s and fading from
// 47 % of the period on (alpha 255 - 250 * ...). One shared phase (double_12, advanced once per method_229 run by the
// wall time since dateTime_4); a hint more than 40 px outside the view is skipped.
//
// Our addition (toggled by the overlay row and its two sub-toggles): a marker with a name label for each of the
// player's waypoints (sim/player/waypoints.ts), the point-like known locations and the hints (sim/player/
// knownLocations.ts). Markers are screen-sized (each a container at its world point scaled 1/zoom), so the icons and
// labels read the same at every zoom; labels follow the system names' clutter rule (mainView.ts: greedy, a label
// within MAP_LABEL_MIN_SPACING_PX of one already kept is hidden), waypoints first, then known locations, then hints.
// The layer sits in the overlay root (MainView: the last world child, above the ships). The marker list is rebuilt
// only when the waypoints / hints / known locations change (a signature read every few frames), so a late game costs
// a culled loop over a few dozen containers per frame. Render only: reads the galaxy (the replica in worker mode).

import { Container, Graphics, Text } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { hintSource, hintSubject } from '../sim/player/hintSubjects';
import { isMarkerDismissed, waypointState, type Waypoint } from '../sim/player/waypoints';
import { knownLocationTooltip, knownLocations, knownLocationsSignature, type KnownLocation } from '../sim/player/knownLocations';
import type { GalaxyLocation } from '../sim/galaxyLocation';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { overlayActive, type MapOverlayState } from '../ui/mapOverlays';
import { getSettings } from '../ui/settings';
import { WEAPON_CIRCLES_MIN_FACTOR } from './weaponRangeCircles';

/** MainView.cs 1469 color_17 = Color.FromArgb(96, 64, 255). */
export const HINT_PULSE_COLOR = 0x6040ff;
/** MainView.cs 1468 double_13. */
export const HINT_PULSE_PERIOD_S = 2.4;
/** MainView.cs 1470 int_10. */
export const HINT_PULSE_MAX_RADIUS_PX = 40;
/** XnaDrawingHelper.DrawCircle(Rectangle, Color, int, bool): 30 segments. */
export const HINT_PULSE_SIDES = 30;
/** method_230: hints more than 40 px outside the view are not drawn. */
export const HINT_PULSE_MARGIN_PX = 40;

/** The system-name clutter rule (mainView.ts): labels closer than this (px) to a kept one are hidden. */
export const MAP_LABEL_MIN_SPACING_PX = 80;

export const WAYPOINT_COLOR = 0x46d8ff;
export const KNOWN_LOCATION_COLOR = 0xffb840;
const WAYPOINT_LABEL = 0xc8f4ff;
const LOCATION_LABEL = 0xffe0a8;
const HINT_LABEL = 0xc4b8ff;
const FONT_FAMILY = 'Forgotten Futurist, sans-serif';

/** method_229's phase (double_12) with dateTime_4 (DateTime.MinValue at start). Wall-clock seconds. */
export class HintPulseClock {
    phase = 0;
    last = -Infinity;

    /** method_229's head: advance by the time since the last run and wrap (once per run, whatever the hint count). */
    advance(now: number): void {
        this.phase += now - this.last;
        const p = HINT_PULSE_PERIOD_S;
        if (this.phase > p) {
            if (this.phase > p * 2.0) this.phase = 0.0;
            this.phase -= p;
        }
        this.last = now;
    }

    /** method_230: the circle's radius (px; the C#'s signed num5) and alpha (0-255) at the current phase. */
    circle(): { radius: number; alpha: number } {
        const p = HINT_PULSE_PERIOD_S;
        const num3 = p * 0.47;
        const num4 = Math.min(1.0, Math.max(0.0, (this.phase - num3) / num3));
        const alpha = 255 - Math.trunc(num4 * 250.0);
        const radius = 1 + Math.trunc((this.phase / p) * HINT_PULSE_MAX_RADIUS_PX);
        return { radius, alpha };
    }
}

/** One marker of the overlay. */
export interface MapMarker {
    kind: 'waypoint' | 'location' | 'hint';
    key: string;
    x: number;
    y: number;
    name: string;
    waypoint: Waypoint | null;
    known: KnownLocation | null;
}

/** What the overlay shows: the player's waypoints (when `showWaypoints`), then the known locations and the hints (when
 *  `showKnown`; a hint at a listed location is that location's, drawn only as its pulse). Pure. */
export function mapMarkers(galaxy: Galaxy, player: Empire | null, showWaypoints: boolean, showKnown: boolean, reveal = false): MapMarker[] {
    const out: MapMarker[] = [];
    if (player === null) return out;
    if (showWaypoints) {
        for (const w of waypointState(galaxy)?.list ?? []) {
            if (w.empireId !== player.empireId) continue;
            out.push({ kind: 'waypoint', key: `w:${w.id}`, x: w.x, y: w.y, name: w.name, waypoint: w, known: null });
        }
    }
    if (showKnown) {
        for (const k of knownLocations(galaxy, player, reveal)) {
            if (k.kind === 'hint' && k.location !== null) continue;
            out.push({ kind: k.kind, key: k.key, x: k.x, y: k.y, name: k.kind === 'hint' ? `? ${k.name}` : k.name, waypoint: null, known: k });
        }
    }
    return out;
}

/** The hover text of a marker. */
export function markerTooltip(galaxy: Galaxy, player: Empire | null, m: MapMarker): string {
    if (m.waypoint !== null) {
        const w = m.waypoint;
        return `${w.name}\nYour waypoint, placed ${resolveStarDateDescription(w.starDate)}\nRight-click: rename or delete`;
    }
    if (m.known !== null) return knownLocationTooltip(galaxy, player, m.known);
    return m.name;
}

/** A change key for mapMarkers' input. */
function markerSignature(galaxy: Galaxy, player: Empire | null, showWaypoints: boolean, showKnown: boolean, reveal: boolean): string {
    let s = `${showWaypoints ? 1 : 0}${showKnown ? 1 : 0}|`;
    if (showWaypoints) for (const w of waypointState(galaxy)?.list ?? []) s += `${w.id}:${w.x},${w.y}:${w.empireId}:${w.name};`;
    if (showKnown && player !== null && (player.locationHints?.length ?? 0) <= 64) for (const h of player.locationHints ?? []) s += `${hintSubject(galaxy, h.x, h.y) ?? ''}${hintSource(galaxy, h.x, h.y) ?? ''}\u0001`;
    if (showKnown) s += `|${knownLocationsSignature(player, reveal)}|${waypointState(galaxy)?.dismissed?.join(',') ?? ''}`;
    return s;
}

/** Greedy label pass (the system names' rule): keeps a label unless one kept is within `min` px. Pure. */
export function labelAllowed(kept: readonly number[], sx: number, sy: number, min = MAP_LABEL_MIN_SPACING_PX): boolean {
    const m2 = min * min;
    for (let i = 0; i < kept.length; i += 2) {
        const dx = kept[i] - sx;
        const dy = kept[i + 1] - sy;
        if (dx * dx + dy * dy < m2) return false;
    }
    return true;
}

class MarkerView {
    readonly root = new Container();
    readonly icon = new Graphics();
    readonly label: Text;
    marker: MapMarker;
    /** Screen position this frame (valid while root.visible). */
    sx = 0;
    sy = 0;
    constructor(marker: MapMarker, parent: Container) {
        this.marker = marker;
        drawIcon(this.icon, marker.kind);
        const fill = marker.kind === 'waypoint' ? WAYPOINT_LABEL : marker.kind === 'location' ? LOCATION_LABEL : HINT_LABEL;
        this.label = new Text({
            text: marker.name,
            style: { fontFamily: FONT_FAMILY, fontSize: 12, fill, stroke: { color: 0x000000, width: 3 } },
        });
        this.label.anchor.set(0, 0.5);
        this.label.position.set(marker.kind === 'waypoint' ? 11 : 9, marker.kind === 'waypoint' ? -11 : 0);
        this.root.addChild(this.icon, this.label);
        this.root.visible = false;
        parent.addChild(this.root);
    }

    setMarker(m: MapMarker): void {
        if (m.name !== this.marker.name) this.label.text = m.name;
        this.marker = m;
    }

    destroy(): void {
        if (!this.root.destroyed) this.root.destroy({ children: true });
    }
}

/** The marker icons in screen px around (0, 0): a pennant on a pole (waypoint), a diamond (known location), a ringed
 *  dot (hint). */
function drawIcon(g: Graphics, kind: MapMarker['kind']): void {
    if (kind === 'waypoint') {
        g.moveTo(0, 0).lineTo(0, -16).stroke({ width: 3, color: 0x000000, alpha: 0.7 });
        g.moveTo(0, 0).lineTo(0, -16).stroke({ width: 1.5, color: WAYPOINT_COLOR });
        g.poly([0, -16, 10, -12.5, 0, -9]).fill({ color: WAYPOINT_COLOR }).stroke({ width: 1, color: 0x000000, alpha: 0.7 });
        g.circle(0, 0, 2.5).fill({ color: WAYPOINT_COLOR }).stroke({ width: 1, color: 0x000000, alpha: 0.7 });
    } else if (kind === 'location') {
        g.poly([0, -6, 6, 0, 0, 6, -6, 0]).fill({ color: 0x000000, alpha: 0.45 }).stroke({ width: 2, color: KNOWN_LOCATION_COLOR });
        g.circle(0, 0, 1.5).fill({ color: KNOWN_LOCATION_COLOR });
    } else {
        g.circle(0, 0, 5).fill({ color: 0x000000, alpha: 0.4 }).stroke({ width: 1.5, color: 0x9c88ff });
        g.circle(0, 0, 1.5).fill({ color: 0x9c88ff });
    }
}

/** Hit box of a marker icon around its anchor (px): the pennant reaches up and right. */
function iconHit(kind: MapMarker['kind'], dx: number, dy: number): boolean {
    if (kind === 'waypoint') return dx >= -6 && dx <= 13 && dy >= -19 && dy <= 6;
    return dx * dx + dy * dy <= 9 * 9;
}

export class LocationMarkerLayer {
    /** World-space; MainView puts it in the overlay root. */
    readonly root = new Container();
    private readonly pulses = new Graphics();
    private readonly markersRoot = new Container();
    private readonly pulseClock = new HintPulseClock();
    private views = new Map<string, MarkerView>();
    /** Draw order = label priority (waypoints, locations, hints). */
    private order: MarkerView[] = [];
    private sig = '';
    private frame = 0;
    private readonly kept: number[] = [];
    /** GodMode (fog.ts reveal; MainView sets it): every location is listed. */
    reveal = false;
    /** MainView: the location's name is drawn by the region labels now (MainView.2.cs 4675-4705) — its marker shows
     *  no second label. */
    regionNamed: ((l: GalaxyLocation) => boolean) | null = null;

    constructor(
        private readonly galaxy: Galaxy,
        private readonly overlays: MapOverlayState,
    ) {
        this.root.addChild(this.pulses, this.markersRoot);
    }

    /** The overlay row is on (and the improvement enabled) — what the markers need besides their sub-toggle. */
    private active(): boolean {
        return overlayActive(this.overlays, 'waypoints');
    }

    /** Rebuild the marker list now (a waypoint command was applied), instead of at the next signature check. */
    invalidate(): void {
        this.sig = '';
        this.frame = 0;
    }

    update(z: number, cam: Camera): void {
        this.updatePulses(z, cam);
        const on = this.active();
        const s = getSettings();
        const showW = on && s.waypointsShowPlayer;
        const showK = on && s.waypointsShowKnown;
        if (!showW && !showK) {
            if (this.markersRoot.visible) this.markersRoot.visible = false;
            if (this.order.length > 0) this.rebuild([]);
            this.sig = '';
            return;
        }
        this.markersRoot.visible = true;
        if (this.frame++ % 15 === 0) {
            const sig = markerSignature(this.galaxy, this.galaxy.playerEmpire, showW, showK, this.reveal);
            if (sig !== this.sig) {
                this.sig = sig;
                this.rebuild(mapMarkers(this.galaxy, this.galaxy.playerEmpire, showW, showK, this.reveal));
            }
        }
        const inv = 1 / z;
        const halfW = cam.width / 2;
        const halfH = cam.height / 2;
        const kept = this.kept;
        kept.length = 0;
        for (const v of this.order) {
            const m = v.marker;
            const sx = (m.x - cam.x) * z + halfW;
            const sy = (m.y - cam.y) * z + halfH;
            if (sx < -150 || sy < -40 || sx > cam.width + 40 || sy > cam.height + 40) {
                v.root.visible = false;
                continue;
            }
            v.sx = sx;
            v.sy = sy;
            v.root.position.set(m.x, m.y);
            v.root.scale.set(inv);
            v.root.visible = true;
            const loc = m.kind === 'location' ? m.known?.location ?? null : null;
            const show = !(loc !== null && this.regionNamed?.(loc) === true) && labelAllowed(kept, sx, sy);
            if (show) kept.push(sx, sy);
            v.label.visible = show;
        }
    }

    /** method_229 / method_230: the player's location hints (always: the original has no toggle). */
    private updatePulses(z: number, cam: Camera): void {
        const g = this.pulses;
        if (g.visible) g.clear();
        const f = 1 / z;
        const player = this.galaxy.playerEmpire;
        // method_250 (MainView.cs 1538) did not run: dateTime_4 keeps its time.
        if (f <= WEAPON_CIRCLES_MIN_FACTOR || player === null) {
            g.visible = false;
            return;
        }
        const now = performance.now() / 1000;
        this.pulseClock.advance(now);
        const hints = player.locationHints ?? [];
        if (hints.length === 0) {
            g.visible = false;
            return;
        }
        const { radius, alpha } = this.pulseClock.circle();
        const left = cam.x - cam.width / (2 * z);
        const top = cam.y - cam.height / (2 * z);
        const r = Math.abs(radius) / z;
        const step = (Math.PI * 2) / HINT_PULSE_SIDES;
        let any = false;
        for (const p of hints) {
            if (isMarkerDismissed(this.galaxy, `h:${p.x},${p.y}`)) continue;
            // num / num2: (int)((x - viewLeft) / double_15).
            const sx = Math.trunc((p.x - left) * z);
            const sy = Math.trunc((p.y - top) * z);
            if (sx < -HINT_PULSE_MARGIN_PX || sx > cam.width + HINT_PULSE_MARGIN_PX || sy < -HINT_PULSE_MARGIN_PX || sy > cam.height + HINT_PULSE_MARGIN_PX) continue;
            const cx = left + sx / z;
            const cy = top + sy / z;
            // Dashed: segments 0, 2, 4, ... of 30.
            for (let i = 0; i < HINT_PULSE_SIDES; i += 2) {
                g.moveTo(cx + r * Math.cos(i * step), cy + r * Math.sin(i * step));
                g.lineTo(cx + r * Math.cos((i + 1) * step), cy + r * Math.sin((i + 1) * step));
            }
            any = true;
        }
        if (any) g.stroke({ width: 1 / z, color: HINT_PULSE_COLOR, alpha: Math.max(0, alpha) / 255 });
        g.visible = any;
    }

    private rebuild(list: MapMarker[]): void {
        const next = new Map<string, MarkerView>();
        const order: MarkerView[] = [];
        for (const m of list) {
            let v = this.views.get(m.key);
            if (v !== undefined && v.marker.kind !== m.kind) {
                v.destroy();
                v = undefined;
            }
            if (v === undefined) v = new MarkerView(m, this.markersRoot);
            else v.setMarker(m);
            this.views.delete(m.key);
            next.set(m.key, v);
            order.push(v);
        }
        for (const v of this.views.values()) v.destroy();
        this.views = next;
        this.order = order;
        // Hints under locations under waypoints (the first-kept labels on top).
        for (let i = order.length - 1, z = 0; i >= 0; i--, z++) this.markersRoot.setChildIndex(order[i].root, z);
    }

    /** The marker under screen point (sx, sy) (icon or shown label; waypoints first), or null. */
    hitTest(sx: number, sy: number): MapMarker | null {
        if (!this.markersRoot.visible) return null;
        for (const v of this.order) {
            if (!v.root.visible) continue;
            const dx = sx - v.sx;
            const dy = sy - v.sy;
            if (iconHit(v.marker.kind, dx, dy)) return v.marker;
            if (v.label.visible) {
                const lx = v.label.x;
                const ly = v.label.y;
                const w = v.label.width;
                const h = v.label.height;
                if (dx >= lx && dx <= lx + w && dy >= ly - h / 2 && dy <= ly + h / 2) return v.marker;
            }
        }
        return null;
    }

    /** Markers listed now (tests / the screenshot script). */
    get markers(): readonly MapMarker[] {
        return this.order.map((v) => v.marker);
    }

    destroy(): void {
        if (this.root.destroyed) return;
        this.views.clear();
        this.order = [];
        this.root.destroy({ children: true });
    }
}
