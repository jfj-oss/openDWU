// The Main View's galaxy-pass sector grid and its edge labels — port of MainView.2.cs method_250 5130-5217 (the XNA
// galaxy pass; its GDI twin is method_248 4036-4122). At zoom factor f > 150 (num16) and with Clean Galaxy view off
// (`!flag`), each sector boundary inside the view is a 1 px line in main_0.color_5 = (32, 32, 88) (Main.Part13.cs 199)
// — the colour of main_0.pen_1 (Main.Part12.cs 2295), the pen the original draws the planet / moon orbits with
// (MainView.1.cs 414 / 432) — opaque at every zoom past the threshold (no fade: method_250 forces int_15 = 255 and the
// line colour carries no alpha), so on the bright galaxy backdrop it reads very faint. Each column is labelled with its
// letter `(char)(i + 65)` and each row with `(j + 1)` (the same names as Galaxy.7.cs 1508 ResolveSectorDescription, i.e.
// the "C4" of every sector readout) in main_0.color_7 = (96, 96, 255) (Main.Part13.cs 201), SmallFont, along all four
// edges of the galaxy, clamped to stay on screen while that edge is scrolled off.

import { Container, Text } from 'pixi.js';
import { sectorColumnName } from '../sim/sectorNames';
import type { Camera } from './camera';

/** main_0.color_5 (Main.Part13.cs 199) = pen_1's colour (Main.Part12.cs 2295): the sector grid and the orbit lines. */
export const SECTOR_GRID_COLOR = 0x202058;
/** main_0.color_7 (Main.Part13.cs 201): the sector labels' brush (method_250 5148 solidBrush). */
export const SECTOR_LABEL_COLOR = 0x6060ff;
/** method_250 5153 num16: the grid and labels are drawn only while the zoom factor is above this. */
export const SECTOR_GRID_MIN_FACTOR = 150;
/** SmallFont.xnb metrics (read from the shipped font): `MeasureString("H")` = 7 x 16 (line spacing), cap height 10 px. */
const H_WIDTH = 7;
const LINE_SPACING = 16;
/** The font size whose cap height matches SmallFont's 10 px H (TODO(port): SmallFont's face is not recoverable from the
 *  compiled .xnb; the map font stands in). */
export const SECTOR_LABEL_FONT_PX = 13;

/** method_250 5153: the grid and labels are drawn at f > 150 unless Clean Galaxy view is on. */
export function sectorGridVisible(f: number, cleanGalaxyView: boolean): boolean {
    return f > SECTOR_GRID_MIN_FACTOR && !cleanGalaxyView;
}

export interface SectorLabelPos {
    text: string;
    x: number;
    y: number;
}

/**
 * method_250 5139-5217: the screen positions (top-left, px) of the column letters (top and bottom) and row numbers
 * (left and right) for a view `w` x `h` px whose top-left is world (left, top) at f world units per px.
 * `stride` labels every n-th column / row (custom galaxy sizes only; 1 for the C# 4..15 sectors a side).
 */
export function layoutSectorLabels(
    sectorSize: number,
    sectorsX: number,
    sectorsY: number,
    left: number,
    top: number,
    w: number,
    h: number,
    f: number,
    stride: { cols: number; rows: number } = { cols: 1, rows: 1 },
): SectorLabelPos[] {
    // galaxy_0.ResolveSector of the view's edges (clamped to the galaxy, Galaxy.6.cs CorrectSectorCoords).
    const sec = (v: number, n: number): number => Math.max(0, Math.min(n - 1, Math.trunc(Math.trunc(v) / sectorSize)));
    const c0 = sec(left, sectorsX); // num8
    const c1 = sec(left + w * f, sectorsX); // num9
    const r0 = sec(top, sectorsY); // num10
    const r1 = sec(top + h * f, sectorsY); // num11
    const sectorPx = sectorSize / f; // num5 (= (SizeX / f) / SectorMaxX)
    const dx = sectorPx / 2 - H_WIDTH / 2; // num6
    const dy = sectorPx / 2 - LINE_SPACING / 2; // num7
    // The lines' extent (num17 / num18 vertical, num19 / num20 horizontal): the screen edge, or the galaxy edge once
    // the first / last sector is in view. (The C# tests the row range against SectorMaxX and the columns against
    // SectorMaxY — the same for its square sector grids; the port uses each axis's own count.)
    const lineTop = r0 <= 1 ? (r0 * sectorSize - top) / f : 0;
    const lineBottom = r1 >= sectorsY - 1 ? ((r1 + 1) * sectorSize - top) / f : h;
    const lineLeft = c0 <= 1 ? (c0 * sectorSize - left) / f : 0;
    const lineRight = c1 >= sectorsX - 1 ? ((c1 + 1) * sectorSize - left) / f : w;
    const out: SectorLabelPos[] = [];
    for (let i = c0; i <= c1; i++) {
        if (i % stride.cols !== 0) continue;
        const x = (i * sectorSize - left) / f + dx;
        const text = sectorColumnName(i);
        out.push({ text, x, y: Math.max(0, lineTop - 1) });
        out.push({ text, x, y: Math.min(h - 11, lineBottom - 14) });
    }
    for (let j = r0; j <= r1; j++) {
        if (j % stride.rows !== 0) continue;
        const y = (j * sectorSize - top) / f + dy;
        const text = String(j + 1);
        out.push({ text, x: Math.max(0, lineLeft - 2), y });
        out.push({ text, x: Math.min(w - 8, lineRight - 14), y });
    }
    return out;
}

/** Custom galaxy size (not a port), the rule of galaxyMap.ts sectorLabelStride: every n-th label once a big custom
 *  galaxy makes the cells too small for one each (the C# galaxies have at most 15 sectors a side: always 1). */
function labelStride(count: number, cellPx: number): number {
    if (count <= 15) return 1;
    return Math.max(1, Math.ceil(16 / Math.max(cellPx, 1e-6)));
}

/** The labels as pooled Pixi Texts, kept in world space (right above the grid, below the systems) at 1 / zoom scale. */
export class SectorLabelLayer {
    readonly root = new Container();
    private pool: Text[] = [];

    constructor(private fontFamily: string) {
        this.root.eventMode = 'none';
    }

    update(visible: boolean, cam: Camera, sectorSize: number, sectorsX: number, sectorsY: number): void {
        this.root.visible = visible;
        if (!visible) return;
        const z = cam.zoom;
        const f = 1 / z;
        const tl = cam.screenToWorld(0, 0);
        const sectorPx = sectorSize * z;
        const stride = { cols: labelStride(sectorsX, sectorPx), rows: labelStride(sectorsY, sectorPx) };
        const labels = layoutSectorLabels(sectorSize, sectorsX, sectorsY, tl.x, tl.y, cam.width, cam.height, f, stride);
        while (this.pool.length < labels.length) {
            const t = new Text({ text: '', style: { fontSize: SECTOR_LABEL_FONT_PX, fill: SECTOR_LABEL_COLOR, fontFamily: this.fontFamily } });
            this.root.addChild(t);
            this.pool.push(t);
        }
        for (let k = 0; k < this.pool.length; k++) {
            const t = this.pool[k];
            const l = labels[k];
            if (l === undefined) {
                t.visible = false;
                continue;
            }
            t.visible = true;
            if (t.text !== l.text) t.text = l.text;
            t.scale.set(f);
            t.position.set(tl.x + Math.round(l.x) * f, tl.y + Math.round(l.y) * f);
        }
    }
}
