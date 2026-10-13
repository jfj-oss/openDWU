// Influence borders: an optional galaxy-map display mode (Game Options -> Advanced Display Settings) that replaces the
// stock territory shading with angular, Voronoi-style empire regions. VISUAL ONLY: it reads the sim and never writes it.
//
//  1. Influence field. Every colony and every base / station of an empire adds influence to the star systems around it
//     (strength falls off with distance, see INFLUENCE below). A system is claimed by the empire with the most
//     influence there, when that is above INFLUENCE.threshold.
//  2. Cells. Each star system owns the straight-edged Voronoi cell around it (edges halfway to its neighbours), clipped
//     to an octagon of CELL_RADIUS_SPACINGS mean star spacings so empty deep space is not claimed. Cells never change
//     unless the galaxy does (cached per galaxy). A region is the union of its empire's cells: fills are disjoint, and
//     two empires share one border segment (drawn once). No smoothing anywhere.
//  3. Cost control: the influence + border geometry is recomputed by InfluenceBorderLayer only when the ownership
//     signature changes (checked at most every few seconds), cached as per-tile Graphics, and culled by tile.
//
// Pure geometry (computeInfluenceRegions) has no Pixi import; the layer at the bottom does.

import { Container, Graphics, Text } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Camera } from './camera';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { habitatDevelopmentLevel } from '../sim/developmentLevel';
import { SystemVisibilityStatus } from '../sim/visibility';
import { fogOf } from './fog';
import { empireColour } from './empireLayer';
import { getSettings } from '../ui/settings';

/** All tunable weights. Distances are in mean star spacings (sqrt(galaxy area / star count)). */
export const INFLUENCE = {
    /** A system is claimed only when the best empire's influence there is at least this. */
    threshold: 14,
    /** Colony: strength = base + perSqrtPop * sqrt(population in millions) * (devFloor + development / devScale). */
    colonyBase: 30,
    colonyPerSqrtPop: 3.2,
    colonyDevFloor: 0.5,
    colonyDevScale: 60,
    colonyMaxStrength: 140,
    /** Colony reach = reachBase + reachPerSqrtPop * sqrt(pop in millions), capped at reachMax. */
    colonyReachBase: 1.6,
    colonyReachPerSqrtPop: 0.12,
    colonyReachMax: 3.4,
    /** Bases / stations by sub-role: [strength, reach]. Bigger bases push further. */
    base: new Map<BuiltObjectSubRole, [number, number]>([
        [BuiltObjectSubRole.LargeSpacePort, [48, 2.6]],
        [BuiltObjectSubRole.MediumSpacePort, [38, 2.1]],
        [BuiltObjectSubRole.SmallSpacePort, [30, 1.7]],
        [BuiltObjectSubRole.DefensiveBase, [30, 2.0]],
        [BuiltObjectSubRole.ResortBase, [18, 1.2]],
        [BuiltObjectSubRole.GasMiningStation, [22, 1.3]],
        [BuiltObjectSubRole.MiningStation, [22, 1.3]],
        [BuiltObjectSubRole.EnergyResearchStation, [22, 1.4]],
        [BuiltObjectSubRole.WeaponsResearchStation, [22, 1.4]],
        [BuiltObjectSubRole.HighTechResearchStation, [22, 1.4]],
        [BuiltObjectSubRole.MonitoringStation, [20, 1.6]],
        [BuiltObjectSubRole.GenericBase, [18, 1.2]],
    ]),
    /** Any other base. */
    baseDefault: [16, 1.1] as [number, number],
};
/** Cell clip radius (apothem of the octagon), in mean star spacings. */
export const CELL_RADIUS_SPACINGS = 1.9;
/** Only regions at least this long (mean star spacings, major axis) get a name. */
export const NAME_MIN_LENGTH_SPACINGS = 3.5;
/** Game-day / wall-clock gap between recomputes (the layer checks this often; cells are cached). */
export const RECOMPUTE_INTERVAL_MS = 2500;

/** One system's Voronoi cell: CCW vertices (x0,y0,x1,y1,...); edge k runs vertex k -> k+1 and borders system tags[k] (-1 = clip). */
export interface Cell {
    verts: number[];
    tags: number[];
}
export interface CellSet {
    cells: Cell[];
    spacing: number;
    /** Systems the cells were built for (identity key). */
    systemCount: number;
}

function clipCell(c: Cell, nx: number, ny: number, d: number, tag: number): Cell {
    // Keep points with nx*x + ny*y <= d.
    const v = c.verts;
    const n = v.length / 2;
    const ov: number[] = [];
    const ot: number[] = [];
    for (let k = 0; k < n; k++) {
        const ax = v[2 * k];
        const ay = v[2 * k + 1];
        const bx = v[2 * ((k + 1) % n)];
        const by = v[2 * ((k + 1) % n) + 1];
        const da = nx * ax + ny * ay - d;
        const db = nx * bx + ny * by - d;
        const ina = da <= 0;
        const inb = db <= 0;
        const t = c.tags[k];
        if (ina) {
            ov.push(ax, ay);
            ot.push(t);
        }
        if (ina !== inb) {
            const f = da / (da - db);
            ov.push(ax + (bx - ax) * f, ay + (by - ay) * f);
            ot.push(ina ? tag : t);
        }
    }
    return { verts: ov, tags: ot };
}

/** The clipped Voronoi cell of every system (cached by the caller; depends only on the star positions). */
export function buildCells(xs: Float64Array | number[], ys: Float64Array | number[], sizeX: number, sizeY: number): CellSet {
    const n = xs.length;
    const spacing = Math.sqrt((sizeX * sizeY) / Math.max(1, n));
    const R = CELL_RADIUS_SPACINGS * spacing;
    const bucket = 2 * R;
    const gw = Math.max(1, Math.ceil(sizeX / bucket));
    const gh = Math.max(1, Math.ceil(sizeY / bucket));
    const grid: number[][] = Array.from({ length: gw * gh }, () => []);
    const gx = (x: number): number => Math.max(0, Math.min(gw - 1, Math.floor(x / bucket)));
    const gy = (y: number): number => Math.max(0, Math.min(gh - 1, Math.floor(y / bucket)));
    for (let i = 0; i < n; i++) grid[gy(ys[i]) * gw + gx(xs[i])].push(i);
    const cells: Cell[] = new Array(n);
    // Octagon with apothem R: vertices at the corner angles 22.5deg + k*45deg, circumradius R / cos(22.5deg).
    const cr = R / Math.cos(Math.PI / 8);
    for (let i = 0; i < n; i++) {
        const px = xs[i];
        const py = ys[i];
        let c: Cell = { verts: [], tags: [] };
        for (let k = 0; k < 8; k++) {
            const a = Math.PI / 8 + (k * Math.PI) / 4;
            c.verts.push(px + cr * Math.cos(a), py + cr * Math.sin(a));
            c.tags.push(-1);
        }
        const near: Array<[number, number]> = [];
        for (let yy = Math.max(0, gy(py) - 1); yy <= Math.min(gh - 1, gy(py) + 1); yy++) {
            for (let xx = Math.max(0, gx(px) - 1); xx <= Math.min(gw - 1, gx(px) + 1); xx++) {
                for (const j of grid[yy * gw + xx]) {
                    if (j === i) continue;
                    const dx = xs[j] - px;
                    const dy = ys[j] - py;
                    const d2 = dx * dx + dy * dy;
                    if (d2 <= 4 * cr * cr) near.push([d2, j]);
                }
            }
        }
        near.sort((a, b) => a[0] - b[0]);
        for (const [d2, j] of near) {
            // Skip neighbours whose bisector is beyond the farthest cell vertex.
            let far = 0;
            for (let k = 0; k < c.verts.length; k += 2) far = Math.max(far, (c.verts[k] - px) ** 2 + (c.verts[k + 1] - py) ** 2);
            if (d2 > 4 * far) break;
            const dx = xs[j] - px;
            const dy = ys[j] - py;
            const len = Math.sqrt(d2);
            if (len === 0) continue;
            const nx = dx / len;
            const ny = dy / len;
            c = clipCell(c, nx, ny, (nx * (px + xs[j]) + ny * (py + ys[j])) / 2, j);
            if (c.verts.length < 6) break;
        }
        // Clip to the playable area (0..sizeX, 0..sizeY): nothing is drawn outside the map.
        c = clipCell(c, -1, 0, 0, -1);
        if (c.verts.length >= 6) c = clipCell(c, 1, 0, sizeX, -1);
        if (c.verts.length >= 6) c = clipCell(c, 0, -1, 0, -1);
        if (c.verts.length >= 6) c = clipCell(c, 0, 1, sizeY, -1);
        cells[i] = c;
    }
    return { cells, spacing, systemCount: n };
}

/** Influence of every empire on every system: `owner[i]` = index into galaxy.empires or -1. */
export function computeOwners(galaxy: Galaxy, viewer: Empire | null, xs: ArrayLike<number>, ys: ArrayLike<number>, spacing: number): { owner: Int16Array; strength: Float32Array } {
    const n = xs.length;
    const empIndex = new Map<Empire, number>();
    galaxy.empires.forEach((e, i) => {
        if (e != null && e.active && e !== galaxy.independentEmpire) empIndex.set(e, i);
    });
    // Per-system, per-empire influence kept sparse: best and its empire plus a small map for ties.
    const acc: Map<number, number>[] = new Array(n);
    const bucket = 4 * spacing;
    const gw = Math.max(1, Math.ceil(galaxy.sizeX / bucket));
    const gh = Math.max(1, Math.ceil(galaxy.sizeY / bucket));
    const grid: number[][] = Array.from({ length: gw * gh }, () => []);
    const gx = (x: number): number => Math.max(0, Math.min(gw - 1, Math.floor(x / bucket)));
    const gy = (y: number): number => Math.max(0, Math.min(gh - 1, Math.floor(y / bucket)));
    for (let i = 0; i < n; i++) grid[gy(ys[i]) * gw + gx(xs[i])].push(i);
    const explored = (sys: number): boolean => viewer === null || viewer.visibility.checkSystemVisibilityStatus(sys) >= SystemVisibilityStatus.Explored;
    const emit = (x: number, y: number, emp: number, strength: number, reachSp: number): void => {
        const reach = reachSp * spacing;
        const x0 = gx(x - reach), x1 = gx(x + reach), y0 = gy(y - reach), y1 = gy(y + reach);
        for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) {
                for (const i of grid[yy * gw + xx]) {
                    const d = Math.hypot(xs[i] - x, ys[i] - y);
                    if (d >= reach) continue;
                    const f = 1 - d / reach;
                    const v = strength * f * f;
                    let m = acc[i];
                    if (m === undefined) m = acc[i] = new Map();
                    m.set(emp, (m.get(emp) ?? 0) + v);
                }
            }
        }
    };
    for (const [empire, e] of empIndex) {
        for (const c of empire.colonies) {
            if (c == null || c.hasBeenDestroyed || c.owner !== empire) continue;
            if (!explored(c.systemIndex)) continue;
            const pop = c.population.totalAmount / 1e6;
            if (!(pop > 0)) continue;
            const sp = Math.sqrt(pop);
            const dev = habitatDevelopmentLevel(c);
            const s = Math.min(INFLUENCE.colonyMaxStrength, INFLUENCE.colonyBase + INFLUENCE.colonyPerSqrtPop * sp * (INFLUENCE.colonyDevFloor + dev / INFLUENCE.colonyDevScale));
            emit(c.xpos, c.ypos, e, s, Math.min(INFLUENCE.colonyReachMax, INFLUENCE.colonyReachBase + INFLUENCE.colonyReachPerSqrtPop * sp));
        }
        for (const b of empire.builtObjects) {
            if (b.role !== BuiltObjectRole.Base || b.hasBeenDestroyed) continue;
            const star = b.nearestSystemStar;
            if (star === null || !explored(star.systemIndex)) continue;
            const [s, r] = INFLUENCE.base.get(b.subRole) ?? INFLUENCE.baseDefault;
            emit(b.xpos, b.ypos, e, s, r);
        }
    }
    const owner = new Int16Array(n).fill(-1);
    const strength = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const m = acc[i];
        if (m === undefined) continue;
        let best = -1;
        let bv = INFLUENCE.threshold;
        for (const [e, v] of m) {
            if (v > bv || (v === bv && e < best)) {
                bv = v;
                best = e;
            }
        }
        owner[i] = best;
        strength[i] = bv;
    }
    return { owner, strength };
}

/** One empire's contiguous region, for its name label. */
export interface Region {
    owner: number;
    cx: number;
    cy: number;
    /** Principal-axis angle (rad, -pi/2..pi/2), length along it and thickness across it. */
    angle: number;
    length: number;
    thickness: number;
    cells: number;
}

/** Contiguous regions per empire with a centroid, principal axis and extents. */
export function computeRegions(cs: CellSet, owner: Int16Array): Region[] {
    const n = owner.length;
    const comp = new Int32Array(n).fill(-1);
    const out: Region[] = [];
    for (let s = 0; s < n; s++) {
        if (owner[s] < 0 || comp[s] >= 0) continue;
        const stack = [s];
        comp[s] = s;
        const members: number[] = [];
        while (stack.length > 0) {
            const i = stack.pop()!;
            members.push(i);
            for (const t of cs.cells[i].tags) {
                if (t >= 0 && comp[t] < 0 && owner[t] === owner[s]) {
                    comp[t] = s;
                    stack.push(t);
                }
            }
        }
        // Area-weighted moments of the member cells (polygon vertices, triangle-fan weights).
        let A = 0, mx = 0, my = 0;
        const pts: number[] = [];
        for (const i of members) {
            const v = cs.cells[i].verts;
            const k = v.length / 2;
            for (let a = 0; a < k; a++) pts.push(v[2 * a], v[2 * a + 1]);
        }
        for (const i of members) {
            const v = cs.cells[i].verts;
            const k = v.length / 2;
            let a2 = 0, cx = 0, cy = 0;
            for (let a = 0; a < k; a++) {
                const b = (a + 1) % k;
                const cr = v[2 * a] * v[2 * b + 1] - v[2 * b] * v[2 * a + 1];
                a2 += cr;
                cx += (v[2 * a] + v[2 * b]) * cr;
                cy += (v[2 * a + 1] + v[2 * b + 1]) * cr;
            }
            if (a2 === 0) continue;
            A += a2 / 2;
            mx += cx / 3;
            my += cy / 3;
        }
        if (A <= 0) continue;
        const ccx = mx / (2 * A);
        const ccy = my / (2 * A);
        let sxx = 0, syy = 0, sxy = 0;
        for (let a = 0; a < pts.length; a += 2) {
            const dx = pts[a] - ccx, dy = pts[a + 1] - ccy;
            sxx += dx * dx;
            syy += dy * dy;
            sxy += dx * dy;
        }
        let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const ux = Math.cos(angle), uy = Math.sin(angle);
        let lo = Infinity, hi = -Infinity, wlo = Infinity, whi = -Infinity;
        for (let a = 0; a < pts.length; a += 2) {
            const dx = pts[a] - ccx, dy = pts[a + 1] - ccy;
            const u = dx * ux + dy * uy, w = -dx * uy + dy * ux;
            if (u < lo) lo = u;
            if (u > hi) hi = u;
            if (w < wlo) wlo = w;
            if (w > whi) whi = w;
        }
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        // The principal-axis box is centred on the centroid only roughly; use the box centre for placement.
        const bu = (lo + hi) / 2, bw = (wlo + whi) / 2;
        out.push({ owner: owner[s], cx: ccx + bu * ux - bw * uy, cy: ccy + bu * uy + bw * ux, angle, length: hi - lo, thickness: whi - wlo, cells: members.length });
    }
    return out;
}

export interface BorderGeometry {
    /** Tiles of the galaxy; each holds the cells to fill and the border segments to stroke. */
    tiles: Array<{ minX: number; minY: number; maxX: number; maxY: number; fills: Array<{ owner: number; verts: number[] }>; borders: Array<{ owner: number; seg: number[] }>; edges: Array<{ owner: number; quads: number[] }> }>;
    regions: Region[];
    claimed: number;
}
export const TILES = 6;

/** Shared-edge mode: 'both' = each side draws its own darker strip, 'darker' = only the darker empire's, 'off' = none. */
export type SharedEdgeMode = 'both' | 'darker' | 'off';
/** Depth of the shared-edge strip, in mean star spacings. */
export const SHARED_EDGE_DEPTH_SPACINGS = 0.14;

export function buildGeometry(cs: CellSet, owner: Int16Array, sizeX: number, sizeY: number, edgeMode: SharedEdgeMode = 'off', lum: (owner: number) => number = () => 0): BorderGeometry {
    const depth = SHARED_EDGE_DEPTH_SPACINGS * cs.spacing;
    const tiles: BorderGeometry['tiles'] = [];
    for (let i = 0; i < TILES * TILES; i++) tiles.push({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, fills: [], borders: [], edges: [] });
    let claimed = 0;
    for (let i = 0; i < owner.length; i++) {
        const e = owner[i];
        if (e < 0) continue;
        const c = cs.cells[i];
        if (c.verts.length < 6) continue;
        claimed++;
        const v = c.verts;
        // Tile by the cell's centre (mean of vertices).
        let mx = 0, my = 0;
        for (let k = 0; k < v.length; k += 2) { mx += v[k]; my += v[k + 1]; }
        mx /= v.length / 2; my /= v.length / 2;
        const t = tiles[Math.max(0, Math.min(TILES - 1, Math.floor((my / sizeY) * TILES))) * TILES + Math.max(0, Math.min(TILES - 1, Math.floor((mx / sizeX) * TILES)))];
        for (let k = 0; k < v.length; k += 2) {
            if (v[k] < t.minX) t.minX = v[k];
            if (v[k] > t.maxX) t.maxX = v[k];
            if (v[k + 1] < t.minY) t.minY = v[k + 1];
            if (v[k + 1] > t.maxY) t.maxY = v[k + 1];
        }
        t.fills.push({ owner: e, verts: v });
        const seg: number[] = [];
        const n = v.length / 2;
        for (let k = 0; k < n; k++) {
            const nb = c.tags[k];
            const no = nb >= 0 ? owner[nb] : -1;
            if (no === e) continue;
            // A shared border between two claimed cells is drawn once (from the lower system index).
            if (no >= 0 && nb < i) continue;
            const b = (k + 1) % n;
            seg.push(v[2 * k], v[2 * k + 1], v[2 * b], v[2 * b + 1]);
        }
        if (seg.length > 0) t.borders.push({ owner: e, seg });
        if (edgeMode !== 'off') {
            // Shared edges (a claimed neighbour of another empire): one flat quad per edge, inset into this cell. Each cell
            // draws its own side of the boundary, so 'both' needs no extra pass; 'darker' keeps only the darker empire's.
            const quads: number[] = [];
            for (let k = 0; k < n; k++) {
                const nb = c.tags[k];
                const no = nb >= 0 ? owner[nb] : -1;
                if (no < 0 || no === e) continue;
                if (edgeMode === 'darker') {
                    const le = lum(e), lo = lum(no);
                    if (le > lo || (le === lo && e > no)) continue;
                }
                const b = (k + 1) % n;
                const ax = v[2 * k], ay = v[2 * k + 1], bx = v[2 * b], by = v[2 * b + 1];
                const dx = bx - ax, dy = by - ay;
                const len = Math.hypot(dx, dy);
                if (len < 1e-6) continue;
                // Cells are CCW, so the inward normal is the left of the edge direction.
                const d = Math.min(depth, len * 0.5);
                const ix = (-dy / len) * d, iy = (dx / len) * d;
                quads.push(ax, ay, bx, by, bx + ix, by + iy, ax + ix, ay + iy);
            }
            if (quads.length > 0) t.edges.push({ owner: e, quads });
        }
    }
    return { tiles, regions: computeRegions(cs, owner), claimed };
}

// ---------------------------------------------------------------------------------------------------------------
// Pixi layer

function mix(c: number, k: number): number {
    const r = Math.round(((c >> 16) & 255) * k), g = Math.round(((c >> 8) & 255) * k), b = Math.round((c & 255) * k);
    return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
}
export const FILL_DARKEN = 0.55;
export const FILL_ALPHA = 0.2;
/** Shared-edge strip colour = the empire's fill colour scaled by this, at this alpha. */
export const EDGE_DARKEN = 0.4;
export const EDGE_ALPHA = 0.65;
function luminance(c: number): number {
    return 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
}

/** Empire names on influence borders: Source Serif 4 (SIL OFL 1.1, bundled under public/fonts/source-serif-4), a
 *  calm book serif; falls back to the system serifs until it has loaded. */
const NAME_FONT_FAMILY = "'openDWU Serif', Georgia, 'Times New Roman', serif";
let nameFontState: 'idle' | 'loading' | 'ready' = 'idle';
const nameFontWaiters: Array<() => void> = [];
function loadNameFont(onReady: () => void): void {
    if (nameFontState === 'ready') return;
    nameFontWaiters.push(onReady);
    if (nameFontState === 'loading' || typeof FontFace === 'undefined' || typeof document === 'undefined') return;
    nameFontState = 'loading';
    const faces = [
        new FontFace('openDWU Serif', "url('/fonts/source-serif-4/source-serif-4-600-latin.woff2') format('woff2')", { weight: '600', unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212' }),
        new FontFace('openDWU Serif', "url('/fonts/source-serif-4/source-serif-4-600-latin-ext.woff2') format('woff2')", { weight: '600', unicodeRange: 'U+0100-024F, U+1E00-1EFF, U+2C60-2C7F, U+A720-A7FF' }),
    ];
    Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff))))
        .then(() => {
            nameFontState = 'ready';
            for (const w of nameFontWaiters.splice(0)) w();
        })
        .catch(() => {
            nameFontState = 'ready'; // keep the system serif fallback
        });
}

export class InfluenceBorderLayer {
    readonly root = new Container();
    private tiles: Array<{ g: Graphics; minX: number; minY: number; maxX: number; maxY: number }> = [];
    private names: Array<{ t: Text; r: Region }> = [];
    private cells: CellSet | null = null;
    private xs: Float64Array = new Float64Array(0);
    private ys: Float64Array = new Float64Array(0);
    private sig = '';
    private lastMs = -Infinity;
    private frame = 0;
    /** Duration of the last recompute (ms), for the perf report. */
    lastComputeMs = 0;

    constructor(private galaxy: Galaxy) {
        loadNameFont(() => {
            this.sig = ''; // rebuild once the serif has loaded, so the names don't stay in the fallback font
        });
        this.root.visible = false;
    }

    /** Signature of the ownership (cheap): owner per system. */
    private signature(owner: Int16Array): string {
        let h = 2166136261;
        for (let i = 0; i < owner.length; i++) h = Math.imul(h ^ (owner[i] + 2), 16777619);
        return `${h}:${this.galaxy.empires.length}:${getSettings().influenceSharedEdges}`;
    }

    /** Recompute now (ignoring the throttle); returns whether the geometry changed. */
    recompute(): boolean {
        const t0 = performance.now();
        const galaxy = this.galaxy;
        if (this.cells === null || this.cells.systemCount !== galaxy.systems.length) {
            const n = galaxy.systems.length;
            this.xs = new Float64Array(n);
            this.ys = new Float64Array(n);
            for (let i = 0; i < n; i++) {
                this.xs[i] = galaxy.systems[i].systemStar.xpos;
                this.ys[i] = galaxy.systems[i].systemStar.ypos;
            }
            this.cells = buildCells(this.xs, this.ys, galaxy.sizeX, galaxy.sizeY);
            this.sig = '';
        }
        const { owner } = computeOwners(galaxy, fogOf(galaxy).player, this.xs, this.ys, this.cells.spacing);
        const edgeMode = getSettings().influenceSharedEdges;
        const sig = this.signature(owner);
        this.lastComputeMs = performance.now() - t0;
        if (sig === this.sig) return false;
        this.sig = sig;
        const geo = buildGeometry(this.cells, owner, galaxy.sizeX, galaxy.sizeY, edgeMode, (e) => luminance(this.colour(e)));
        this.apply(geo);
        this.lastComputeMs = performance.now() - t0;
        return true;
    }

    private colour(e: number): number {
        return empireColour(this.galaxy.empires[e], e);
    }

    private apply(geo: BorderGeometry): void {
        for (const t of this.tiles) t.g.destroy();
        for (const n of this.names) n.t.destroy();
        this.tiles = [];
        this.names = [];
        for (const tile of geo.tiles) {
            if (tile.fills.length === 0) continue;
            const g = new Graphics();
            for (const f of tile.fills) g.poly(f.verts, true).fill({ color: mix(this.colour(f.owner), FILL_DARKEN), alpha: FILL_ALPHA });
            for (const b of tile.borders) {
                const col = mix(this.colour(b.owner), FILL_DARKEN);
                for (let k = 0; k < b.seg.length; k += 4) g.moveTo(b.seg[k], b.seg[k + 1]).lineTo(b.seg[k + 2], b.seg[k + 3]);
                g.stroke({ color: col, alpha: FILL_ALPHA, width: 1, pixelLine: true });
            }
            for (const ed of tile.edges) {
                for (let k = 0; k < ed.quads.length; k += 8) g.poly(ed.quads.slice(k, k + 8), true);
                g.fill({ color: mix(this.colour(ed.owner), EDGE_DARKEN), alpha: EDGE_ALPHA });
            }
            this.root.addChild(g);
            this.tiles.push({ g, minX: tile.minX, minY: tile.minY, maxX: tile.maxX, maxY: tile.maxY });
        }
        const sp = this.cells?.spacing ?? 1;
        for (const r of geo.regions) {
            if (r.length < NAME_MIN_LENGTH_SPACINGS * sp) continue;
            const emp = this.galaxy.empires[r.owner];
            const t = new Text({ text: emp.name, style: { fontFamily: NAME_FONT_FAMILY, fontWeight: '600', fontSize: 96, fill: mix(this.colour(r.owner), 1.3), letterSpacing: 6 } });
            t.anchor.set(0.5);
            t.position.set(r.cx, r.cy);
            const fitW = (0.62 * r.length) / t.width;
            const fitH = (0.38 * r.thickness) / t.height;
            const s = Math.min(fitW, fitH);
            t.scale.set(s);
            t.rotation = Math.abs(r.angle) < 0.7 ? r.angle : 0;
            this.root.addChild(t);
            this.names.push({ t, r });
        }
    }

    /** Per-frame: `factor` = 1 / zoom. Returns true when it drew (the stock territory must stay hidden). */
    update(z: number, cam: Camera, enabled: boolean): void {
        this.frame++;
        const factor = 1 / z;
        const fade = Math.max(0, Math.min(1, (factor - 70) / (300 - 70)));
        const show = enabled && fade > 0;
        if (show) {
            const now = performance.now();
            if (this.sig === '' || (this.frame % 30 === 0 && now - this.lastMs >= RECOMPUTE_INTERVAL_MS)) {
                this.lastMs = now;
                this.recompute();
            }
        }
        this.root.visible = show && this.tiles.length > 0;
        if (!this.root.visible) return;
        const smooth = fade * fade * (3 - 2 * fade);
        const hw = cam.width / (2 * z), hh = cam.height / (2 * z);
        for (const t of this.tiles) {
            t.g.visible = !(t.maxX < cam.x - hw || t.minX > cam.x + hw || t.maxY < cam.y - hh || t.minY > cam.y + hh);
            t.g.alpha = smooth;
        }
        const namesOn = getSettings().influenceBorderNames;
        for (const n of this.names) {
            const screenH = n.t.height * z;
            // Fade out as the name grows past ~200 px on screen (zoomed in), gone by ~420 px; hidden below 9 px.
            const nameFade = Math.max(0, Math.min(1, (420 - screenH) / 220));
            const visible = namesOn && nameFade > 0 && screenH >= 9 && !(n.r.cx < cam.x - hw - n.t.width || n.r.cx > cam.x + hw + n.t.width || n.r.cy < cam.y - hh - n.t.width || n.r.cy > cam.y + hh + n.t.width);
            n.t.visible = visible;
            n.t.alpha = 0.8 * nameFade;
        }
    }
}
