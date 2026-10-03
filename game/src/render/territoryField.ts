// Empire territory overlay geometry (docs/territory.md). Pure: no Pixi, no DOM, no sim mutation.
//
// The original draws territory as a per-pixel owner bitmap: EmpireTerritory.cs CalculateEmpireTerritoryGrid (365-509)
// gives every pixel of the view to the colony with the highest influence there, CalculateColonyInfluenceAtPoint
// (520-533) = r² / max(1, d²) when d <= r (else 0), and paints it the owner's MainColor; MainView.2.cs 262-275 /
// Main.Part12.cs 3240 (method_148) smooth it (GraphicsHelper.SmoothImage) and blend it at 25% alpha (method_236(0.25)).
// The galaxy-wide copy is a 2000x2000 bitmap baked into the galaxy backdrop; zoomed in, MainView recomputes it at
// viewport resolution for the visible section.
//
// Here the same ownership rule is evaluated on a vertex grid and turned into a vector mesh with marching squares, so
// the edges stay sharp at every zoom without re-rasterising per frame. Per grid vertex we keep the best influence
// (and its empire) and the best influence of any OTHER empire; empire E owns the region where
//     s_E = min(ln f_E, ln f_E - ln g_E) > 0
// (f_E = E's best r²/d², g_E = the best of the other empires): ln f_E > 0 is "inside one of E's influence circles"
// and ln f_E > ln g_E is "E has the strongest influence here" (= the original's per-pixel argmax). Both terms are
// smooth in position, so interpolating the zero crossing along cell edges puts the borders (circle arcs and the
// Apollonius arcs between rival colonies) within a tiny fraction of a cell of the exact curve; two neighbours get the
// same crossing point on a shared edge (s_F = -s_E there), so contested borders have no gaps or double-blended seams.
//
// The build is a generator so the caller can spread it over several frames (time-sliced; never per frame).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { SystemVisibilityStatus } from '../sim/visibility';

/** One influence source: a colony with its owner (index into galaxy.empires) and influence radius. */
export interface TerritorySource {
    x: number;
    y: number;
    r: number;
    /** Index of the owning empire in galaxy.empires. */
    owner: number;
}

/**
 * The colonies that project territory for the viewing empire. Port of the colony filter of EmpireTerritory.cs
 * CalculateEmpireTerritoryGrid (394-437): every active empire's colonies with `colony.Owner == empire`, not destroyed,
 * that the viewer has explored (`godMode || viewingEmpire == null || CheckSystemExplored(colony.SystemIndex)` — the
 * same test filters the rival colonies a pixel is contested with, 427, so an unexplored rival colony does not push
 * the viewer's known borders back). `viewer === null` is god mode / reveal.
 *
 * Deviation: the original calls Empire.RecalculateColonyInfluenceRadiuses (398-401) from the renderer, mutating the
 * sim; here the radius the sim keeps (Habitat.colonyInfluenceRadius, sim/territory.ts) is read as-is. A zero radius
 * (independent / no population / empty colony) projects nothing, as CalculateColonyInfluenceAtPoint returns 0.
 */
export function collectTerritorySources(galaxy: Galaxy, viewer: Empire | null): TerritorySource[] {
    const out: TerritorySource[] = [];
    for (let e = 0; e < galaxy.empires.length; e++) {
        const empire = galaxy.empires[e];
        if (empire == null || !empire.active || empire.colonies == null) continue;
        for (const colony of empire.colonies) {
            if (colony == null || colony.hasBeenDestroyed || colony.owner !== empire) continue;
            const r = colony.colonyInfluenceRadius;
            if (!(r > 0)) continue;
            if (viewer !== null && viewer.visibility.checkSystemVisibilityStatus(colony.systemIndex) < SystemVisibilityStatus.Explored) continue;
            out.push({ x: colony.xpos, y: colony.ypos, r, owner: e });
        }
    }
    return out;
}

/** Triangle mesh of one empire's territory, in galaxy (world) coordinates. */
export interface TerritoryMeshData {
    owner: number;
    positions: Float32Array;
    indices: Uint32Array;
}

/** Grid cells along the galaxy's longer side. The interpolated borders are sub-cell accurate, so this is far coarser
 * than the original's 2000 px bitmap for the same look (a cell is ~15-30k units; influence radii are 100k-3M). */
export const TERRITORY_GRID_CELLS = 1024;

const NEG = -1e4;

class GrowF32 {
    a = new Float32Array(4096);
    n = 0;
    push2(x: number, y: number): number {
        if (this.n + 2 > this.a.length) {
            const b = new Float32Array(this.a.length * 2);
            b.set(this.a);
            this.a = b;
        }
        this.a[this.n++] = x;
        this.a[this.n++] = y;
        return this.n / 2 - 1;
    }
}
class GrowU32 {
    a = new Uint32Array(8192);
    n = 0;
    push3(i: number, j: number, k: number): void {
        if (this.n + 3 > this.a.length) {
            const b = new Uint32Array(this.a.length * 2);
            b.set(this.a);
            this.a = b;
        }
        this.a[this.n++] = i;
        this.a[this.n++] = j;
        this.a[this.n++] = k;
    }
}
interface Builder {
    pos: GrowF32;
    idx: GrowU32;
}

/** Reusable scratch grids (one set per galaxy size) so repeated builds do not reallocate ~10 MB each time. */
export class TerritoryGrid {
    readonly nx: number;
    readonly ny: number;
    readonly cell: number;
    /** Top empire per vertex (owner index + 1; 0 = none). */
    readonly top: Uint16Array;
    /** ln of the best influence per vertex (NEG = none). */
    readonly l1: Float32Array;
    /** ln of the best influence of any empire other than `top` (NEG = none). */
    readonly l2: Float32Array;
    constructor(readonly sizeX: number, readonly sizeY: number, cells = TERRITORY_GRID_CELLS) {
        this.cell = Math.max(sizeX, sizeY) / cells;
        this.nx = Math.max(1, Math.ceil(sizeX / this.cell));
        this.ny = Math.max(1, Math.ceil(sizeY / this.cell));
        const n = (this.nx + 1) * (this.ny + 1);
        this.top = new Uint16Array(n);
        this.l1 = new Float32Array(n);
        this.l2 = new Float32Array(n);
    }
}

/**
 * Build the territory meshes, one per owning empire. A generator: it yields every so often (after a batch of colonies
 * or grid rows) so the caller can stop when its frame budget is spent and resume next frame; the return value is the
 * finished meshes. `grid` is overwritten.
 */
export function* buildTerritoryMeshes(sources: readonly TerritorySource[], grid: TerritoryGrid): Generator<void, TerritoryMeshData[], void> {
    const { nx, ny, cell, top } = grid;
    const v1 = grid.l1; // raw influence during the splat, ln() afterwards
    const v2 = grid.l2;
    const stride = nx + 1;
    top.fill(0);
    v1.fill(0);
    v2.fill(0);

    // 1. Splat each colony's influence r²/max(1,d²) onto the vertices within r + 2 cells (the margin gives the vertices
    // just outside a circle a value, so the outer border is interpolated, not snapped to the last inside vertex).
    let work = 0;
    for (const s of sources) {
        const e = s.owner + 1;
        const R = s.r + 2 * cell;
        const R2 = R * R;
        const r2 = s.r * s.r;
        const i0 = Math.max(0, Math.floor((s.x - R) / cell));
        const i1 = Math.min(nx, Math.ceil((s.x + R) / cell));
        const j0 = Math.max(0, Math.floor((s.y - R) / cell));
        const j1 = Math.min(ny, Math.ceil((s.y + R) / cell));
        for (let j = j0; j <= j1; j++) {
            const dy = j * cell - s.y;
            const dy2 = dy * dy;
            if (dy2 > R2) continue;
            let k = j * stride + i0;
            for (let i = i0; i <= i1; i++, k++) {
                const dx = i * cell - s.x;
                const d2 = dx * dx + dy2;
                if (d2 > R2) continue;
                const v = r2 / Math.max(1, d2);
                if (top[k] === e) {
                    if (v > v1[k]) v1[k] = v;
                } else if (v > v1[k]) {
                    v2[k] = v1[k];
                    v1[k] = v;
                    top[k] = e;
                } else if (v > v2[k]) {
                    v2[k] = v;
                }
            }
        }
        work += (i1 - i0 + 1) * (j1 - j0 + 1);
        if (work > 150000) {
            work = 0;
            yield;
        }
    }
    for (let k = 0; k < v1.length; k++) {
        v1[k] = v1[k] > 0 ? Math.log(v1[k]) : NEG;
        v2[k] = v2[k] > 0 ? Math.log(v2[k]) : NEG;
        if ((k & 0x3ffff) === 0x3ffff) yield;
    }
    yield;

    // 2. Marching squares per cell.
    const builders = new Map<number, Builder>();
    const builder = (e: number): Builder => {
        let b = builders.get(e);
        if (b === undefined) {
            b = { pos: new GrowF32(), idx: new GrowU32() };
            builders.set(e, b);
        }
        return b;
    };
    const sv = [0, 0, 0, 0];
    const px = [0, 0, 0, 0];
    const py = [0, 0, 0, 0];
    const ptsX: number[] = [];
    const ptsY: number[] = [];
    // The original's bitmap covers exactly the galaxy (EmpireTerritory.cs 389-393 / 470-475 clamp every colony's
    // pixel box to [0, size)), so nothing is drawn past the galaxy edge. The grid starts at 0; only the last column /
    // row of cells can reach past sizeX / sizeY, so clip against those two edges (Sutherland-Hodgman; a convex
    // polygon stays convex).
    const maxX = grid.sizeX;
    const maxY = grid.sizeY;
    const clipX: number[] = [];
    const clipY: number[] = [];
    const clipEdge = (horizontal: boolean, limit: number): void => {
        clipX.length = 0;
        clipY.length = 0;
        const n = ptsX.length;
        for (let q = 0; q < n; q++) {
            const ax = ptsX[q], ay = ptsY[q];
            const bx = ptsX[(q + 1) % n], by = ptsY[(q + 1) % n];
            const av = horizontal ? ax : ay;
            const bv = horizontal ? bx : by;
            const aIn = av <= limit;
            const bIn = bv <= limit;
            if (aIn) {
                clipX.push(ax);
                clipY.push(ay);
            }
            if (aIn !== bIn) {
                const t = (limit - av) / (bv - av);
                clipX.push(ax + (bx - ax) * t);
                clipY.push(ay + (by - ay) * t);
            }
        }
        ptsX.length = 0;
        ptsY.length = 0;
        for (let q = 0; q < clipX.length; q++) {
            ptsX.push(clipX[q]);
            ptsY.push(clipY[q]);
        }
    };
    const emitFan = (e: number): void => {
        let outX = false;
        let outY = false;
        for (let q = 0; q < ptsX.length; q++) {
            if (ptsX[q] > maxX) outX = true;
            if (ptsY[q] > maxY) outY = true;
        }
        if (outX) clipEdge(true, maxX);
        if (outY) clipEdge(false, maxY);
        const n = ptsX.length;
        if (n < 3) return;
        const b = builder(e);
        const base = b.pos.push2(ptsX[0], ptsY[0]);
        for (let q = 1; q < n; q++) b.pos.push2(ptsX[q], ptsY[q]);
        for (let q = 1; q < n - 1; q++) b.idx.push3(base, base + q, base + q + 1);
    };
    const emitQuad = (e: number, xa: number, ya: number, xb: number, yb: number): void => {
        xb = Math.min(xb, maxX);
        yb = Math.min(yb, maxY);
        if (xb <= xa || yb <= ya) return;
        const b = builder(e);
        const base = b.pos.push2(xa, ya);
        b.pos.push2(xb, ya);
        b.pos.push2(xb, yb);
        b.pos.push2(xa, yb);
        b.idx.push3(base, base + 1, base + 2);
        b.idx.push3(base, base + 2, base + 3);
    };
    // s_E at vertex k (see the header): the top empire's margin over the rest, or for any other empire the upper bound
    // given by the second-best influence (exact when E is the runner-up, which is every two-empire border).
    const sAt = (e: number, k: number): number => {
        const a = v1[k];
        const b = v2[k];
        if (top[k] === e) return Math.min(a, a - b);
        return Math.min(b, b - a);
    };
    const corners = [0, 0, 0, 0];
    for (let j = 0; j < ny; j++) {
        const y0 = j * cell;
        const y1 = (j + 1) * cell;
        let runE = 0;
        let runStart = 0;
        let runEnd = 0;
        const flush = (): void => {
            if (runE !== 0) emitQuad(runE, runStart, y0, runEnd, y1);
            runE = 0;
        };
        for (let i = 0; i < nx; i++) {
            const k00 = j * stride + i;
            corners[0] = k00;
            corners[1] = k00 + 1;
            corners[2] = k00 + 1 + stride;
            corners[3] = k00 + stride;
            if (v1[corners[0]] <= 0 && v1[corners[1]] <= 0 && v1[corners[2]] <= 0 && v1[corners[3]] <= 0) {
                flush();
                continue;
            }
            const x0 = i * cell;
            const x1 = (i + 1) * cell;
            // Fast path: one empire owns all four corners.
            const e0 = top[corners[0]];
            if (e0 !== 0 && top[corners[1]] === e0 && top[corners[2]] === e0 && top[corners[3]] === e0 &&
                sAt(e0, corners[0]) > 0 && sAt(e0, corners[1]) > 0 && sAt(e0, corners[2]) > 0 && sAt(e0, corners[3]) > 0) {
                if (runE === e0 && runEnd === x0) {
                    runEnd = x1;
                } else {
                    flush();
                    runE = e0;
                    runStart = x0;
                    runEnd = x1;
                }
                continue;
            }
            flush();
            px[0] = x0; py[0] = y0;
            px[1] = x1; py[1] = y0;
            px[2] = x1; py[2] = y1;
            px[3] = x0; py[3] = y1;
            // Candidate owners: the top empire of every corner it actually owns (influence >= 1 there).
            for (let c = 0; c < 4; c++) {
                const e = top[corners[c]];
                if (e === 0 || v1[corners[c]] < 0) continue;
                let seen = false;
                for (let c2 = 0; c2 < c; c2++) if (top[corners[c2]] === e && v1[corners[c2]] >= 0) seen = true;
                if (seen) continue;
                let pos = 0;
                for (let q = 0; q < 4; q++) {
                    sv[q] = sAt(e, corners[q]);
                    if (sv[q] > 0) pos++;
                }
                if (pos === 0) continue;
                const saddle = pos === 2 && (sv[0] > 0) === (sv[2] > 0);
                if (saddle && (sv[0] + sv[1] + sv[2] + sv[3]) / 4 <= 0) {
                    // Disconnected saddle: one corner triangle per owned corner.
                    for (let q = 0; q < 4; q++) {
                        if (!(sv[q] > 0)) continue;
                        const qp = (q + 3) % 4;
                        const qn = (q + 1) % 4;
                        ptsX.length = 0;
                        ptsY.length = 0;
                        let t = sv[qp] / (sv[qp] - sv[q]);
                        ptsX.push(px[qp] + (px[q] - px[qp]) * t);
                        ptsY.push(py[qp] + (py[q] - py[qp]) * t);
                        ptsX.push(px[q]);
                        ptsY.push(py[q]);
                        t = sv[q] / (sv[q] - sv[qn]);
                        ptsX.push(px[q] + (px[qn] - px[q]) * t);
                        ptsY.push(py[q] + (py[qn] - py[q]) * t);
                        emitFan(e);
                    }
                    continue;
                }
                // Walk the cell boundary: owned corners plus the zero crossings. Every point lies on the square's
                // boundary in cyclic order, so the polygon is convex and a fan triangulates it.
                ptsX.length = 0;
                ptsY.length = 0;
                for (let q = 0; q < 4; q++) {
                    const qn = (q + 1) % 4;
                    const a = sv[q];
                    const b = sv[qn];
                    if (a > 0) {
                        ptsX.push(px[q]);
                        ptsY.push(py[q]);
                    }
                    if ((a > 0) !== (b > 0)) {
                        const t = a / (a - b);
                        ptsX.push(px[q] + (px[qn] - px[q]) * t);
                        ptsY.push(py[q] + (py[qn] - py[q]) * t);
                    }
                }
                emitFan(e);
            }
        }
        flush();
        if ((j & 7) === 7) yield;
    }

    const out: TerritoryMeshData[] = [];
    for (const [e, b] of [...builders].sort((p, q) => p[0] - q[0])) {
        if (b.idx.n === 0) continue;
        out.push({ owner: e - 1, positions: b.pos.a.slice(0, b.pos.n), indices: b.idx.a.slice(0, b.idx.n) });
    }
    return out;
}

/** Run a build to completion synchronously (tests, tools). */
export function buildTerritoryMeshesSync(sources: readonly TerritorySource[], grid: TerritoryGrid): TerritoryMeshData[] {
    const gen = buildTerritoryMeshes(sources, grid);
    for (;;) {
        const r = gen.next();
        if (r.done === true) return r.value;
    }
}

/**
 * Point owner by the original's rule (EmpireTerritory.cs CalculateEmpireTerritoryGrid 476-501 with
 * CalculateColonyInfluenceAtPoint 520-533): the empire of the colony with the highest r²/max(1,d²) among colonies
 * whose influence circle contains the point, or -1. Reference for tests.
 */
export function territoryOwnerAt(sources: readonly TerritorySource[], x: number, y: number): number {
    let best = 0;
    let owner = -1;
    for (const s of sources) {
        const d2 = Math.max(1, (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y));
        const r2 = s.r * s.r;
        if (r2 < d2) continue;
        const v = r2 / d2;
        if (v > best) {
            best = v;
            owner = s.owner;
        }
    }
    return owner;
}

/**
 * Cheap change signature of the sources (positions quantised to a grid cell, radii to half a cell), so the layer
 * rebuilds when territory changes visibly (ownership, exploration, influence growth, a colony lost) and not when a
 * colony merely creeps along its orbit.
 */
export function territorySignature(sources: readonly TerritorySource[], cell: number): number {
    let h = 0x811c9dc5 ^ sources.length;
    const mix = (v: number): void => {
        h = Math.imul(h ^ (v | 0), 0x01000193);
    };
    for (const s of sources) {
        mix(s.owner);
        mix(Math.round(s.x / cell));
        mix(Math.round(s.y / cell));
        mix(Math.round((2 * s.r) / cell));
    }
    return h >>> 0;
}
