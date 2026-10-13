// System link lines: the dotted lines in an empire's colour between the systems of one empire at galaxy / sector
// zoom. Port of the galaxy pass MainView.2.cs method_250 5237-5336 (the XNA main view, MainView.cs 1550; the GDI
// fallback method_248 4205-4305 draws the same lines with a { 3, 5 } dash pen, MainView.2.cs 4223 / 4249).
//
// The network is sim state, not drawn geometry: Empire.9.cs 3273 EvaluateSystemLinks (sim/movement.ts
// evaluateSystemLinks; every periodic (30 s) empire pass and when a colony changes hands) gives every system of an empire
// (DetermineEmpireSystems) a SystemVisibility.LinkSystemStars entry: the system of the space port nearest to it, or,
// for a system with its own port, the nearest other port's system not already linked back (DetermineSpacePortSystemLink),
// else the capital's system; a system that does not reach the capital through those links gets one more link to it
// (from the nearest system with its own port, else a random one — galaxy.rnd, so the renderer only reads the result).
// ReciprocalLinkSystemStars is the reverse index. Pirate and independent empires get none.
//
// method_250 draws, at f > 150 (num16) with Clean Galaxy View off and no Game Editor empire, for every system in the
// view's sector range (the sectors under the four view edges, ResolveSector, 5144-5147 / 5226-5230) that the viewing
// empire has explored or sees (CheckSystemVisibilityStatus Visible / Explored, or GodMode) and that has a
// DominantEmpire, for the dominant empire and then each of SystemInfo.OtherEmpires:
//   - a line from the star to each LinkSystemStars entry whose system the viewer has explored / sees (5246-5260);
//   - a line to each ReciprocalLinkSystemStars entry not in LinkSystemStars whose system lies OUTSIDE the sector range
//     and is explored / seen (5262-5282): a link whose source system is off-view is drawn from its in-view end.
// Every empire with links is drawn (not only the player), each in its Empire.MainColor (the colour's own alpha, not
// method_250's int_15, which is forced to 255 at its top anyway: no fade, a hard gate at f = 150), one pixel wide,
// XnaDrawingHelper.DrawLine(..., dashed: true) (XnaDrawingHelper.cs 574-610): from the star, pieces of 6 px, every
// even one drawn (origin (0, 0): the 1 px quad lies on one side of the line), and the last piece — 6 to 12 px, from
// (n - 1) * 6 to the end, n = (int)(length / 6) — always drawn solid (origin (0, 0.5)); a line under 6 px draws nothing.
// The lines are drawn system by system interleaved with the system circles; here they are one layer under the faction
// rings (galaxyMarkers.ts).
// GameOptions.CleanGalaxyView (Expanded's "Clean Galaxy view", Start.1.cs 2935 / 3001, default off) hides these lines
// with the sector grid, the system circles and the names (MainView.2.cs method_250 5237 `!flag`): galaxyMarkers.ts
// passes `on` false then (cleanGalaxyView.ts).
//
// Cost: the network is collected (view-independent: source / target systems, colour, reciprocal flag, both gated on the
// viewer's visibility) once a second while the lines are shown, and kept with a content hash; the dash pieces are
// rebuilt only when that hash, the zoom or the sector range changes or the view leaves the cull rectangle (the view
// plus half a view on each side). Pieces are particles with static properties (one upload per rebuild), cut to the
// cull rectangle. Read only: works on the sim-worker replica (the link lists are cold-synced object fields).
//
// Two looks, picked by Settings.influenceBorders (the "new borders" setting; part of the rebuild key, so a flip rebuilds).
// Off: the classic port look above, unchanged (dashPieces, white quads, the full-alpha empire colour, 1 px).
// On (not the original's 1 px dotted line): thick, pale, faded, static capsule dashes. In screen px: LINK_WIDTH_PX wide,
// LINK_DASH_PX dashes with LINK_GAP_PX gaps (stretched a little per link so both ends are a dash), round caps, the
// empire colour mixed LINK_PALE toward white at LINK_ALPHA. Each dash is a body quad plus two half-disc cap particles
// (no overlap, so the alpha does not double). Static: the geometry is rebuilt only with the network / zoom / sector
// range, never per frame; pieces are sized in world units from the zoom, so they stay the same screen size and smooth.

/** Dash look, in screen px. */
export const LINK_WIDTH_PX = 5;
export const LINK_DASH_PX = 15;
export const LINK_GAP_PX = 16;
/** Fraction of the way from the empire colour to white, and the dash alpha. */
export const LINK_PALE = 0.68;
/** Zoomed out past LINK_SCALE_REF_F (world units per screen px) the dash look shrinks on screen with the zoom, as
 * (REF / f)^LINK_SCALE_POW, down to LINK_SCALE_MIN of its size, so the dashes don't dwarf the map at galaxy zoom. */
export const LINK_SCALE_REF_F = 300;
export const LINK_SCALE_POW = 0.75;
export const LINK_SCALE_MIN = 0.3;
/** Screen-size factor of the dash look at zoom factor `f`. */
export function linkScreenScale(f: number): number {
    return f <= LINK_SCALE_REF_F ? 1 : Math.max(LINK_SCALE_MIN, Math.pow(LINK_SCALE_REF_F / f, LINK_SCALE_POW));
}
export const LINK_ALPHA = 0.5;

import { Container, Particle, ParticleContainer, Texture } from 'pixi.js';
import { makeTextureCanvas, textureFromCanvas } from './textureCanvas';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Habitat } from '../sim/types';
import { SystemVisibilityStatus } from '../sim/visibility';
import { displayColorForEmpire } from '../sim/empireColors';
import { resolveSectorClamped } from '../ui/systemView';
import { fogOf } from './fog';
import { localViewerEmpire } from '../localViewer';
import { getSettings } from '../ui/settings';

/** XnaDrawingHelper.cs 584: float x2 = 6f — the dash / gap length in screen px. */
export const SYSTEM_LINK_DASH_PX = 6;
/** method_250 5257: DrawLine(..., lineThickness 1, dashed: true). */
export const SYSTEM_LINK_WIDTH_PX = 1;
/** MainView.2.cs 5153 num16 = 150: the lines are drawn only when f > 150. */
export const SYSTEM_LINK_MIN_FACTOR = 150;
/** How often the network is recollected while shown (the galaxy markers' refresh rate). */
const REFRESH_MS = 1000;

/** One line method_250 may draw: from a system's star to a linked system star, in an empire's colour. */
export interface SystemLink {
    /** The drawing system (Galaxy.Systems index k). */
    fromSystem: number;
    /** The linked star's SystemIndex. */
    toSystem: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    /** Empire.MainColor (0xRRGGBB). */
    color: number;
    /** The empire whose link this is (Empire.empireId). */
    empireId: number;
    /** From ReciprocalLinkSystemStars: drawn only while the linked system is outside the view's sector range. */
    reciprocal: boolean;
    /** Sector of the drawing system (SystemInfo.Sector). */
    sx: number;
    sy: number;
    /** Sector of the linked system (Systems[habitat.SystemIndex].Sector). */
    tx: number;
    ty: number;
}

/** The sectors under the view (method_250 5144-5147: ResolveSector of the view's left / right / top / bottom edge). */
export interface SectorRange {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
}

/** The galaxy fields the collection reads (a Galaxy, or a stand-in in tests). */
export type SystemLinkGalaxy = Pick<Galaxy, 'systems'>;

/**
 * method_250 5237-5336, view-independent part: every line the viewer may see, in the C#'s drawing order (systems in
 * Galaxy.Systems order; per system the dominant empire, then SystemInfo.OtherEmpires; per empire LinkSystemStars, then
 * the ReciprocalLinkSystemStars not among them). `seen(i)` is the viewer's
 * `GodMode || CheckSystemVisibilityStatus(i) is Visible or Explored`; both ends must pass it. Appends to `out` and
 * returns a 32-bit hash of what it appended (systems, colour, kind), so a caller can keep its geometry when nothing moved.
 */
export function collectSystemLinks(galaxy: SystemLinkGalaxy, seen: (systemIndex: number) => boolean, out: SystemLink[], colorOf: (e: Empire) => number = displayColorForEmpire): number {
    let h = 0x811c9dc5 | 0;
    const mix = (v: number): void => {
        h = Math.imul(h ^ v, 0x01000193);
    };
    const systems = galaxy.systems;
    const emit = (empire: Empire | null | undefined, k: number, star: Habitat, sx: number, sy: number): void => {
        if (empire == null) return;
        const sv = empire.systemVisibility?.[star.systemIndex];
        if (sv == null) return;
        const links = sv.linkSystemStars ?? [];
        const color = colorOf(empire) & 0xffffff;
        const push = (hb: Habitat, reciprocal: boolean): void => {
            const ts = systems[hb.systemIndex]?.sector ?? null;
            if (ts == null) return;
            out.push({ fromSystem: k, toSystem: hb.systemIndex, x0: star.xpos, y0: star.ypos, x1: hb.xpos, y1: hb.ypos, color, empireId: empire.empireId, reciprocal, sx, sy, tx: ts.x, ty: ts.y });
            mix(k);
            mix(hb.systemIndex);
            mix(color);
            mix(reciprocal ? 1 : 2);
        };
        // 5246-5260 / 5290-5308: LinkSystemStars.
        for (let i = 0; i < links.length; i++) {
            const hb = links[i];
            if (hb == null || !seen(hb.systemIndex)) continue;
            push(hb, false);
        }
        // 5262-5282 / 5310-5333: ReciprocalLinkSystemStars not in LinkSystemStars (the sector test is view-dependent:
        // selectSystemLinks).
        const recips = sv.reciprocalLinkSystemStars ?? [];
        for (let i = 0; i < recips.length; i++) {
            const hb = recips[i];
            if (hb == null || links.includes(hb) || !seen(hb.systemIndex)) continue;
            push(hb, true);
        }
    };
    for (let k = 0; k < systems.length; k++) {
        const sys = systems[k];
        if (sys == null || sys.systemStar == null || sys.sector == null) continue;
        // 5237: visible / explored (or GodMode) with a DominantEmpire.
        const dom = sys.dominantEmpire;
        if (dom == null || !seen(k)) continue;
        const star = sys.systemStar;
        emit(dom.empire, k, star, sys.sector.x, sys.sector.y);
        const others = sys.otherEmpires;
        if (others != null) for (const o of others) emit(o?.empire, k, star, sys.sector.x, sys.sector.y);
    }
    mix(out.length);
    return h >>> 0;
}

/** method_250 5144-5147 (+ method_225 5382-5388): the sector range under a view centred on (cx, cy), `width` x `height`
 * px at zoom factor f (world units per px). */
export function viewSectorRange(galaxy: Pick<Galaxy, 'sectorSize' | 'sectorWidth' | 'sectorHeight'>, cx: number, cy: number, width: number, height: number, f: number): SectorRange {
    const icx = Math.trunc(cx);
    const icy = Math.trunc(cy);
    const w = width * f;
    const h = height * f;
    const left = Math.trunc(icx - w / 2);
    const right = Math.trunc(icx + w / 2);
    const top = Math.trunc(icy - h / 2);
    const bottom = Math.trunc(icy + h / 2);
    const g = galaxy as Galaxy;
    return {
        x0: resolveSectorClamped(g, left, icy).x,
        x1: resolveSectorClamped(g, right, icy).x,
        y0: resolveSectorClamped(g, icx, top).y,
        y1: resolveSectorClamped(g, icx, bottom).y,
    };
}

function inRange(r: SectorRange, x: number, y: number): boolean {
    return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** method_250's view-dependent part: the drawing system inside the sector range (5229), a reciprocal link only when
 * its other end is outside it (5268-5269 / 5320-5321). */
export function selectSystemLinks(links: readonly SystemLink[], range: SectorRange, out: SystemLink[] = []): SystemLink[] {
    for (const l of links) {
        if (!inRange(range, l.sx, l.sy)) continue;
        if (l.reciprocal && inRange(range, l.tx, l.ty)) continue;
        out.push(l);
    }
    return out;
}

/**
 * XnaDrawingHelper.DrawLine dashed (XnaDrawingHelper.cs 574-610) along a line of `lengthPx` screen px: the pieces drawn,
 * appended to `out` as (start px, end px, centred) triples — n = (int)(length / 6) pieces of 6 px from the start, the
 * even ones drawn with origin (0, 0) (centred 0), the last one (index n - 1) drawn from (n - 1) * 6 to the end with
 * origin (0, 0.5) (centred 1). Only pieces overlapping [fromPx, toPx] are appended (culling). Returns the count added.
 */
export function dashPieces(lengthPx: number, out: number[], fromPx = 0, toPx = lengthPx): number {
    const d = SYSTEM_LINK_DASH_PX;
    const n = Math.trunc(lengthPx / d);
    if (n <= 0) return 0;
    const i0 = Math.max(0, Math.floor(fromPx / d) - 1);
    const i1 = Math.min(n - 1, Math.ceil(toPx / d));
    let added = 0;
    for (let i = i0; i <= i1; i++) {
        if (i === n - 1) {
            out.push(i * d, lengthPx, 1);
            added++;
        } else if (i % 2 === 0) {
            out.push(i * d, i * d + d, 0);
            added++;
        }
    }
    return added;
}

/** Liang–Barsky: the parameter range [t0, t1] of the segment (x0, y0) → (x1, y1) inside the rectangle, or null. */
export function clipSegment(x0: number, y0: number, x1: number, y1: number, rx0: number, ry0: number, rx1: number, ry1: number): [number, number] | null {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - rx0, rx1 - x0, y0 - ry0, ry1 - y0];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return null;
            continue;
        }
        const t = q[i] / p[i];
        if (p[i] < 0) {
            if (t > t1) return null;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return null;
            if (t < t1) t1 = t;
        }
    }
    return [t0, t1];
}

/** Perf counters (scripts/colonylinks-shots.mjs reads them through the view). */
export interface SystemLinkStats {
    /** Lines in the collected network (both ends known to the viewer). */
    network: number;
    /** Lines drawn in the last build (after the sector-range selection). */
    drawn: number;
    /** Dash pieces in the last build (after culling). */
    pieces: number;
    collects: number;
    builds: number;
    lastCollectMs: number;
    lastBuildMs: number;
    maxBuildMs: number;
}

/** The pale dash colour: the empire colour mixed toward white. */
export function paleLinkColor(c: number): number {
    const m = (v: number): number => Math.round(v + (255 - v) * LINK_PALE);
    return m((c >> 16) & 255) * 65536 + m((c >> 8) & 255) * 256 + m(c & 255);
}

/** Dashes along a line of `lengthPx` screen px: (start, end) px pairs appended to `out`, evenly stretched so the line
 * starts and ends on a dash. Only dashes overlapping [fromPx, toPx] are appended. */
export function capsuleDashes(lengthPx: number, out: number[], fromPx = 0, toPx = lengthPx): number {
    if (lengthPx < LINK_WIDTH_PX) return 0;
    const n = Math.max(1, Math.round((lengthPx + LINK_GAP_PX) / (LINK_DASH_PX + LINK_GAP_PX)));
    const period = (lengthPx + LINK_GAP_PX) / n;
    const dash = period - LINK_GAP_PX;
    const i0 = Math.max(0, Math.floor(fromPx / period) - 1);
    const i1 = Math.min(n - 1, Math.ceil(toPx / period));
    let added = 0;
    for (let i = i0; i <= i1; i++) {
        out.push(i * period, i * period + dash);
        added++;
    }
    return added;
}

let aaLineTex: Texture | null = null;
/** The classic dash texture: 4×4, rows 1–2 white and rows 0 / 3 transparent. Drawn twice the line width tall, so linear
 * filtering fades each long edge over half a pixel: a thin rotated quad no longer stair-steps (no MSAA on the map). */
function aaLineTexture(): Texture {
    if (aaLineTex !== null) return aaLineTex;
    const { canvas, ctx } = makeTextureCanvas(4, 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 1, 4, 2);
    aaLineTex = textureFromCanvas(canvas, 'systemLinkAaLine');
    return aaLineTex;
}

let capTex: Texture | null = null;
/** The right half of a disc (flat edge on the left, vertically centred): the round end of a dash. 31 texels of radius,
 * 1 texel of transparent margin; the disc diameter is 62 texels of the 64 tall. */
function capTexture(): Texture {
    if (capTex !== null) return capTex;
    const { canvas, ctx } = makeTextureCanvas(32, 64);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 32, 31, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    capTex = textureFromCanvas(canvas, 'systemLinkCap');
    return capTex;
}
const CAP_TEX_DIAMETER = 62;

export class SystemLinkLayer {
    /** Holds the classic, body and cap particle layers (positioned at the build origin). */
    readonly root = new Container();
    /** Classic look (influenceBorders off): the original 1 px dash pieces. */
    private readonly classic: ParticleContainer;
    private readonly classicPool: Particle[] = [];
    private readonly bodies: ParticleContainer;
    private readonly caps: ParticleContainer;
    readonly stats: SystemLinkStats = { network: 0, drawn: 0, pieces: 0, collects: 0, builds: 0, lastCollectMs: 0, lastBuildMs: 0, maxBuildMs: 0 };
    private network: SystemLink[] = [];
    private networkHash = -1;
    private version = 0;
    private lastRefresh = -Infinity;
    private readonly bodyPool: Particle[] = [];
    private readonly capPool: Particle[] = [];
    private readonly pieces: number[] = [];
    private readonly selected: SystemLink[] = [];
    private key = { v: -1, z: NaN, caps: false, sx0: -1, sx1: -1, sy0: -1, sy1: -1, x0: 0, y0: 0, x1: 0, y1: 0 };

    constructor(private readonly galaxy: Galaxy) {
        // Every property static: the pieces are uploaded once per rebuild (update()), not every frame.
        const dyn = { position: false, vertex: false, rotation: false, uvs: false, color: false };
        this.bodies = new ParticleContainer({ texture: Texture.WHITE, dynamicProperties: dyn });
        this.caps = new ParticleContainer({ texture: capTexture(), dynamicProperties: dyn });
        this.classic = new ParticleContainer({ texture: aaLineTexture(), dynamicProperties: dyn });
        this.root.addChild(this.classic, this.bodies, this.caps);
        this.root.visible = false;
    }

    /** Recollect the network (view-independent); bumps the version only when what it would draw changed. */
    refresh(): void {
        const t0 = performance.now();
        const g = this.galaxy;
        const fog = fogOf(g);
        const player = localViewerEmpire(g);
        const vis = fog.reveal || player === null ? null : player.visibility;
        const seen = vis === null ? () => true : (i: number) => {
            const st = vis.checkSystemVisibilityStatus(i);
            return st === SystemVisibilityStatus.Visible || st === SystemVisibilityStatus.Explored;
        };
        const next: SystemLink[] = [];
        const hash = collectSystemLinks(g, seen, next);
        this.network = next;
        if (hash !== this.networkHash) {
            this.networkHash = hash;
            this.version++;
        }
        this.stats.network = next.length;
        this.stats.collects++;
        this.stats.lastCollectMs = performance.now() - t0;
    }

    /** Per frame. `on`: the faction-markers toggle (the rings' gate). */
    update(f: number, z: number, cam: Camera, on: boolean): void {
        const shown = on && f > SYSTEM_LINK_MIN_FACTOR;
        this.root.visible = shown;
        if (!shown) return;
        const now = performance.now();
        if (now - this.lastRefresh >= REFRESH_MS) {
            this.lastRefresh = now;
            this.refresh();
        }
        const range = viewSectorRange(this.galaxy, cam.x, cam.y, cam.width, cam.height, f);
        const capsules = getSettings().influenceBorders;
        const k = this.key;
        const hw = cam.width / (2 * z);
        const hh = cam.height / (2 * z);
        const inRect = cam.x - hw >= k.x0 && cam.x + hw <= k.x1 && cam.y - hh >= k.y0 && cam.y + hh <= k.y1;
        if (!(k.v === this.version && k.z === z && inRect && k.caps === capsules && k.sx0 === range.x0 && k.sx1 === range.x1 && k.sy0 === range.y0 && k.sy1 === range.y1)) this.rebuild(f, z, cam, range, capsules);
    }

    private rebuild(f: number, z: number, cam: Camera, range: SectorRange, capsules: boolean): void {
        const k = this.key;
        k.caps = capsules;
        const hw = cam.width / (2 * z);
        const hh = cam.height / (2 * z);
        const t0 = performance.now();
        k.v = this.version;
        k.z = z;
        k.sx0 = range.x0;
        k.sx1 = range.x1;
        k.sy0 = range.y0;
        k.sy1 = range.y1;
        k.x0 = cam.x - 2 * hw;
        k.x1 = cam.x + 2 * hw;
        k.y0 = cam.y - 2 * hh;
        k.y1 = cam.y + 2 * hh;
        this.build(f, range, capsules);
        const ms = performance.now() - t0;
        this.stats.builds++;
        this.stats.lastBuildMs = ms;
        if (ms > this.stats.maxBuildMs) this.stats.maxBuildMs = ms;
    }

    private build(f: number, range: SectorRange, capsules: boolean): void {
        if (capsules) this.buildCapsules(f, range);
        else this.buildClassic(f, range);
    }

    /** The classic look: the port's 1 px dashed lines (dashPieces), full-alpha empire colour. */
    private buildClassic(f: number, range: SectorRange): void {
        const k = this.key;
        const sel = this.selected;
        sel.length = 0;
        selectSystemLinks(this.network, range, sel);
        // Camera-local origin (float32 particle positions).
        const ox = (k.x0 + k.x1) / 2;
        const oy = (k.y0 + k.y1) / 2;
        this.root.position.set(ox, oy);
        this.classic.visible = true;
        this.bodies.visible = false;
        this.caps.visible = false;
        const out = this.classic.particleChildren;
        const width = SYSTEM_LINK_WIDTH_PX * f;
        // Cut two pieces beyond the cull rectangle, so a piece crossing its edge is kept whole.
        const pad = 2 * SYSTEM_LINK_DASH_PX * f;
        const pieces = this.pieces;
        let n = 0;
        for (const l of sel) {
            const dx = l.x1 - l.x0;
            const dy = l.y1 - l.y0;
            const lenW = Math.sqrt(dx * dx + dy * dy);
            const lenPx = lenW / f;
            if (lenPx < SYSTEM_LINK_DASH_PX) continue;
            const clip = clipSegment(l.x0, l.y0, l.x1, l.y1, k.x0 - pad, k.y0 - pad, k.x1 + pad, k.y1 + pad);
            if (clip === null) continue;
            pieces.length = 0;
            dashPieces(lenPx, pieces, clip[0] * lenPx, clip[1] * lenPx);
            const ux = dx / lenW;
            const uy = dy / lenW;
            const rot = Math.atan2(dy, dx);
            for (let i = 0; i < pieces.length; i += 3) {
                const s = pieces[i] * f;
                let part = this.classicPool[n];
                if (part === undefined) {
                    part = new Particle({ texture: aaLineTexture(), anchorX: 0, anchorY: 0 });
                    this.classicPool.push(part);
                }
                part.x = l.x0 + ux * s - ox;
                part.y = l.y0 + uy * s - oy;
                part.rotation = rot;
                // The 4-texel texture: x spans the piece; y is 2 × width with the opaque core (rows 1–2) the line width.
                part.scaleX = ((pieces[i + 1] - pieces[i]) * f) / 4;
                part.scaleY = (2 * width) / 4;
                // Anchor 0.25 puts the core's top edge where anchor 0 put the 1-texel quad's (0.5 stays centred).
                part.anchorY = pieces[i + 2] === 1 ? 0.5 : 0.25;
                part.tint = l.color;
                part.alpha = 1;
                out[n++] = part;
            }
        }
        out.length = n;
        this.bodies.particleChildren.length = 0;
        this.caps.particleChildren.length = 0;
        this.classic.update();
        this.bodies.update();
        this.caps.update();
        this.stats.drawn = sel.length;
        this.stats.pieces = n;
    }

    /** The new-borders look: pale, faded capsule dashes. */
    private buildCapsules(zoomF: number, range: SectorRange): void {
        // World units per (scaled) dash-look px: the look's px sizes shrink on screen when zoomed far out.
        const f = zoomF * linkScreenScale(zoomF);
        this.classic.visible = false;
        this.bodies.visible = true;
        this.caps.visible = true;
        this.classic.particleChildren.length = 0;
        this.classic.update();
        const k = this.key;
        const sel = this.selected;
        sel.length = 0;
        selectSystemLinks(this.network, range, sel);
        // Camera-local origin (float32 particle positions).
        const ox = (k.x0 + k.x1) / 2;
        const oy = (k.y0 + k.y1) / 2;
        this.root.position.set(ox, oy);
        const bodyOut = this.bodies.particleChildren;
        const capOut = this.caps.particleChildren;
        const width = LINK_WIDTH_PX * f;
        const r = width / 2;
        const capScale = width / CAP_TEX_DIAMETER;
        // A hair of overlap between a body and its caps, so no seam shows between the abutting edges.
        const eps = 0.15 * f;
        const pad = 2 * (LINK_DASH_PX + LINK_GAP_PX) * f;
        const pieces = this.pieces;
        let nb = 0;
        let nc = 0;
        const take = (pool: Particle[], i: number, tex: Texture): Particle => {
            let part = pool[i];
            if (part === undefined) {
                part = new Particle({ texture: tex, anchorX: 0, anchorY: 0.5 });
                pool.push(part);
            }
            return part;
        };
        const cap = capTexture();
        for (const l of sel) {
            const dx = l.x1 - l.x0;
            const dy = l.y1 - l.y0;
            const lenW = Math.sqrt(dx * dx + dy * dy);
            const lenPx = lenW / f;
            if (lenPx < LINK_WIDTH_PX) continue;
            const clip = clipSegment(l.x0, l.y0, l.x1, l.y1, k.x0 - pad, k.y0 - pad, k.x1 + pad, k.y1 + pad);
            if (clip === null) continue;
            pieces.length = 0;
            capsuleDashes(lenPx, pieces, clip[0] * lenPx, clip[1] * lenPx);
            const ux = dx / lenW;
            const uy = dy / lenW;
            const rot = Math.atan2(dy, dx);
            const tint = paleLinkColor(l.color);
            for (let i = 0; i < pieces.length; i += 2) {
                const s0 = pieces[i] * f;
                const s1 = pieces[i + 1] * f;
                const bodyLen = s1 - s0 - width;
                // Body between the two cap centres (a dash shorter than it is thick: just the two caps).
                if (bodyLen > 0) {
                    const b = take(this.bodyPool, nb, Texture.WHITE);
                    b.x = l.x0 + ux * (s0 + r - eps) - ox;
                    b.y = l.y0 + uy * (s0 + r - eps) - oy;
                    b.rotation = rot;
                    b.scaleX = bodyLen + 2 * eps;
                    b.scaleY = width;
                    b.tint = tint;
                    b.alpha = LINK_ALPHA;
                    bodyOut[nb++] = b;
                }
                // Start cap: flat edge at s0 + r, round side facing back; end cap: the mirror.
                const c0 = take(this.capPool, nc, cap);
                c0.x = l.x0 + ux * (s0 + r) - ox;
                c0.y = l.y0 + uy * (s0 + r) - oy;
                c0.rotation = rot + Math.PI;
                c0.scaleX = capScale;
                c0.scaleY = capScale;
                c0.tint = tint;
                c0.alpha = LINK_ALPHA;
                capOut[nc++] = c0;
                const c1 = take(this.capPool, nc, cap);
                c1.x = l.x0 + ux * (s1 - r) - ox;
                c1.y = l.y0 + uy * (s1 - r) - oy;
                c1.rotation = rot;
                c1.scaleX = capScale;
                c1.scaleY = capScale;
                c1.tint = tint;
                c1.alpha = LINK_ALPHA;
                capOut[nc++] = c1;
            }
        }
        bodyOut.length = nb;
        capOut.length = nc;
        this.bodies.update();
        this.caps.update();
        this.stats.drawn = sel.length;
        this.stats.pieces = nb + nc;
    }

    destroy(): void {
        this.root.destroy({ children: true });
    }
}
