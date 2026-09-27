// Scenario 19a art — the Concord's procedural fleet (tasks/19-mod-layer-scenarios.md "Concord art"): frigate,
// destroyer, battleship, construction ship, explorer and the Exchange space port, built from the shaded hull
// primitives of concordHull.ts. Not a port: the original has no such art.
//
// Design language (old industrial rim-trader yard work): naval-grey plating over dark steel, staggered plates with
// bevelled seams and rivet rows, dark turquoise enamel panels framed in copper, small turquoise lamp gems, rust
// streaking aft from seams and rivets, chipped paint on the edges, grime in the seams, soot at the nozzles. The three
// warships share one hull: a lofted armoured spine with a domed sensor prow and a copper collar, a stack of chevron
// armour plates, turrets on the axis, a turquoise spine panel with lamp gems, nacelles on pylons with copper-tipped
// noses, ribbed radiator panels outboard, and the same stern engine block with the nozzle bells flush with its aft
// edge (positioned where the thruster marks land: ±62 % of the block's half-width, spread evenly) — scaled up and
// multiplied from frigate to battleship. Everything is drawn in design units (0‥1000, bow up) and mirrored about the
// vertical axis.

import {
    BARE,
    CX,
    COPPER,
    COPPER_DARK,
    GLASS,
    GOLD,
    GUN,
    HullCanvas,
    LAMP_TURQ,
    LAMP_WARM,
    M,
    NAVAL,
    NAVAL_DARK,
    NAVAL_LIGHT,
    STEEL,
    TURQ,
    TURQ_LIGHT,
    U,
    barShape,
    both,
    bowl,
    boxShape,
    carve,
    circleShape,
    dome,
    emissive,
    engineBell,
    glowLamp,
    greebles,
    hashTone,
    loft,
    NOZZLE_DARK,
    ellipseShape,
    paint,
    pipe,
    plateField,
    polyShape,
    radiator,
    type Shape,
    renderHull,
    ringShape,
    rivetRow,
    shadedBox,
    shadedCylinder,
    stain,
    torus,
    turret,
    vents,
    volume,
    type RgbaImageLike,
    type Surf,
} from './concordHull';

export type ConcordHullKind = 'frigate' | 'destroyer' | 'battleship' | 'construction' | 'explorer' | 'port';

const HULL_MATS = [M.paint, M.plate] as const;

// ---------------------------------------------------------------------------------------------------------------
// Shared warship hull
// ---------------------------------------------------------------------------------------------------------------

interface WarshipCfg {
    seed: number;
    /** Spine: max half-width, crown height, fore / aft ends. */
    W: number;
    Hs: number;
    y0: number;
    y1: number;
    /** Armour skirt: half-span at its widest, reached at fraction `skirtT` of the length. */
    skirt: number;
    skirtT: number;
    /** Chevron armour plates from `plateY` aft, `plates` of them. */
    plates: number;
    plateY: number;
    /** Turrets on the axis (x 0) or mirrored pairs (x > 0). */
    turrets: { y: number; r: number; barrels: number; x?: number; z?: number }[];
    /** Nacelles: x offset, radius, fore end. */
    nx: number;
    nr: number;
    ny0: number;
    /** Engine block half-width and nozzle count. */
    eH: number;
    engines: number;
    /** Turquoise spine panel: centre y and half-length. */
    panel: { y: number; hy: number };
    mastY: number;
    dish?: boolean;
}

/** Stern engine block with its nozzle bells flush with the aft edge at ±62 % of the half-width (the thruster marks). */
function engineBlock(cv: HullCanvas, eH: number, n: number, yEnd: number, hy: number): void {
    const yc = yEnd - hy;
    // A tapered housing (narrower forward), rounded, then a heat-shield plate across its forward face.
    volume(cv, polyShape([
        [CX - eH * 0.86, yc - hy],
        [CX + eH * 0.86, yc - hy],
        [CX + eH, yc + hy * 0.2],
        [CX + eH, yEnd],
        [CX - eH, yEnd],
        [CX - eH, yc + hy * 0.2],
    ]), { z: 8, h: 40, bevel: 18, prof: 'round', s: GUN });
    shadedBox(cv, CX, yc - hy * 0.5, eH * 0.7, hy * 0.36, { z: 30, h: 12, bevel: 6, prof: 'chamfer', s: NAVAL_DARK, r: 6, mode: 'max' });
    vents(cv, CX, yc - hy * 0.5, eH * 0.24, hy * 0.26, 4);
    const spacing = n > 1 ? (eH * 1.24) / (n - 1) : 0;
    const r = Math.min(eH * 0.34, n > 1 ? spacing * 0.44 : eH * 0.34);
    for (let k = 0; k < n; k++) {
        const x = n === 1 ? CX : CX - eH * 0.62 + spacing * k;
        engineBell(cv, x, yEnd - hy * 2.2, yEnd - 0.5, r, { z: 16 });
    }
    paint(cv, boxShape(CX, yEnd - 3, eH - 10, 2.5), COPPER_DARK, [M.gun, M.plate]);
    stain(cv, boxShape(CX, yEnd - hy * 0.6, eH, hy * 0.6), 'soot', 0.3);
}

/** A lofted nacelle: bulbous intake cowl with a copper lip, tapering body with collar bands, lamp gem, turquoise hatch. */
function nacelle(cv: HullCanvas, x: number, y0: number, y1: number, r: number, seed: number, z0 = 6): void {
    loft(cv, {
        cx: x,
        y0,
        y1,
        hw: (t) => r * (t < 0.12 ? Math.sqrt(t / 0.12) * 1.08 : 1.08 - 0.25 * Math.min(1, (t - 0.12) / 0.3) + 0.12 * Math.max(0, (t - 0.7) / 0.3)),
        ht: (t) => r * (0.9 + 0.2 * (t < 0.12 ? t / 0.12 : 1 - 0.3 * Math.min(1, (t - 0.12) / 0.3))),
        pow: 2,
        z: z0,
        s: NAVAL_DARK,
    });
    const L = y1 - y0;
    for (let k = 1; k < 5; k++) {
        const y = y0 + L * (0.15 + 0.17 * k);
        volume(cv, boxShape(x, y, r * 1.1, 3.5), { h: 2.5, bevel: 2, prof: 'round', s: STEEL, mode: 'add', onHull: true });
    }
    torus(cv, x, y0 + L * 0.1, r * 0.72, r * 0.12, { z: z0 + r * 0.72, s: COPPER });
    dome(cv, x, y0 + L * 0.1, r * 0.6, { z: z0 + r * 0.55, h: r * 0.45, s: GUN });
    carve(cv, circleShape(x, y0 + L * 0.1, r * 0.3), 3, 2, NOZZLE_DARK, 0.2);
    glowLamp(cv, x, y0 + L * 0.1, r * 0.12);
    carve(cv, boxShape(x, y0 + L * 0.52, r * 0.26, L * 0.08, 3), 2, 1.5, TURQ, 0.05);
    rivetRow(cv, x - r * 0.5, y0 + L * 0.2, x - r * 0.5, y1 - r, 9, 1.8);
    rivetRow(cv, x + r * 0.5, y0 + L * 0.2, x + r * 0.5, y1 - r, 9, 1.8);
    stain(cv, circleShape(x, y0 + L * 0.2, r * 0.25), 'rust', 0.5 + 0.3 * hashTone(seed, x));
}

function warship(cv: HullCanvas, c: WarshipCfg): void {
    const { W, Hs, y0, y1 } = c;
    const L = y1 - y0;
    const T = (t: number): number => y0 + L * t;
    // Armour skirt outline (half-span at fraction t): flares from the head to its widest, then steps in to the block.
    const span = (t: number): number => {
        if (t <= 0.1) return c.skirt * 0.2;
        if (t <= c.skirtT) return c.skirt * (0.2 + 0.8 * Math.pow((t - 0.1) / (c.skirtT - 0.1), 0.75));
        if (t <= 0.93) return c.skirt;
        return c.skirt - (c.skirt - c.eH) * ((t - 0.93) / 0.07);
    };
    // The skirt as a shape: horizontal distance to its flank (cheap; the flanks are near vertical).
    const skirtShape = (k: number, inset = 0): Shape => ({
        d: (x, y) => {
            const t = (y - y0) / L;
            return Math.max(Math.abs(x - CX) - span(t) * k + inset, T(0.1) + inset - y, y - T(1) + inset);
        },
        box: [CX - c.skirt * k, T(0.1), CX + c.skirt * k, T(1)],
    });
    // Radiator panels standing out from the skirt's flanks (ribbed, in dark frames, on spars).
    both((s) => {
        for (const [t, k] of [[0.5, 0.8], [0.66, 1]] as const) {
            const hy = L * 0.05 * k;
            const reach = c.skirt * 0.2 * k;
            const x = CX + s * (span(t) + reach * 0.5 - c.skirt * 0.06);
            radiator(cv, x, T(t), reach * 0.5, hy, Math.max(5, Math.round(hy / 7)), { z: 6, s: STEEL, frame: GUN, dir: 'x' });
            glowLamp(cv, x + s * (reach * 0.5 - 5), T(t) - hy + 5, 2.8);
        }
    });
    volume(cv, skirtShape(1), { z: 4, h: Hs * 0.26, bevel: c.skirt * 0.1, prof: 'round', s: NAVAL_DARK });
    volume(cv, skirtShape(0.8), { z: 4 + Hs * 0.2, h: Hs * 0.14, bevel: c.skirt * 0.06, prof: 'round', s: NAVAL });
    // Copper trim just inside the outer skirt's edge, turquoise panels on the upper skirt.
    volume(cv, { d: (x, y) => Math.abs(skirtShape(1).d(x, y) + c.skirt * 0.035) - 2.2, box: skirtShape(1).box }, { h: 2.5, bevel: 2.2, prof: 'round', s: COPPER_DARK, mode: 'add', onHull: true });
    both((s) => {
        for (const t of [0.5, 0.64]) {
            const x = CX + s * span(t) * 0.62;
            const y = T(t);
            const hw = c.skirt * 0.09;
            volume(cv, boxShape(x, y, hw + 4, L * 0.035 + 4, 5), { h: 2.5, bevel: 2.5, prof: 'round', s: COPPER, mode: 'add', onHull: true });
            carve(cv, boxShape(x, y, hw, L * 0.035, 4), 3, 2, TURQ, 0);
            glowLamp(cv, x, y, 3);
        }
    });
    // Skirt edge lamps.
    both((s) => glowLamp(cv, CX + s * c.skirt * 0.93, T(0.9), 3.4));
    // Nacelles on the skirt, joined to the spine by pipes.
    both((s) => {
        const x = CX + s * c.nx;
        nacelle(cv, x, c.ny0, y1 - 30, c.nr, c.seed + (s > 0 ? 1 : 2), 4 + Hs * 0.3);
        for (const f of [0.35, 0.7]) {
            const py = c.ny0 + (y1 - 30 - c.ny0) * f;
            pipe(cv, [[CX + s * W * 0.6, py], [x - s * c.nr * 0.8, py]], 4.5, { z: Hs * 0.42, s: COPPER_DARK, collar: GUN });
        }
    });
    // Spine: a chain of bulbous modules, pinched at the joints.
    const mods: [number, number, number, number][] = [
        [0.09, 0.5, 0.1, 0.7],
        [0.24, 0.78, 0.13, 0.86],
        [0.43, 1, 0.16, 1],
        [0.64, 0.92, 0.15, 0.94],
        [0.84, 0.78, 0.13, 0.84],
    ];
    mods.forEach(([t, wf, lf, hf], k) => {
        const a = W * wf;
        const b = L * lf;
        volume(cv, ellipseShape(CX, T(t), a, b), { z: 8, h: Hs * hf, bevel: Math.min(a, b) * 0.7, prof: 'round', s: k === 2 ? NAVAL_LIGHT : NAVAL, seam: 2.6 });
        // A dorsal armour cap and flank strakes on each module.
        volume(cv, ellipseShape(CX, T(t) - b * 0.1, a * 0.55, b * 0.72), { h: 6, bevel: 4, prof: 'chamfer', s: k % 2 ? NAVAL : NAVAL_DARK, mode: 'add', onHull: true });
        both((s) => volume(cv, barShape(CX + s * a * 0.72, T(t) - b * 0.45, CX + s * a * 0.78, T(t) + b * 0.45, a * 0.06), { h: 4, bevel: 3, prof: 'round', s: STEEL, mode: 'add', onHull: true }));
    });
    // Layered armour scales on the skirt, stepping aft.
    both((s) => {
        for (let q = 0; q < 4; q++) {
            const t0 = 0.3 + q * 0.13;
            const xi = CX + s * (W * 0.95);
            const xo = CX + s * span(t0 + 0.1) * 0.9;
            volume(cv, polyShape([
                [xi, T(t0)],
                [xo, T(t0 + 0.07)],
                [xo, T(t0 + 0.12)],
                [xi, T(t0 + 0.1)],
            ]), { h: 5, bevel: 3.5, prof: 'chamfer', s: q % 2 ? NAVAL_DARK : NAVAL, mode: 'add', onHull: true });
            stain(cv, barShape(xi, T(t0 + 0.1), xo, T(t0 + 0.12), 1.5), 'rust', 0.7);
        }
    });
    // Armoured cheeks on the mid module.
    both((s) => {
        const cy = T(0.42);
        volume(cv, ellipseShape(CX + s * W * 0.9, cy, W * 0.36, L * 0.085), { z: 8, h: Hs * 0.6, bevel: W * 0.32, prof: 'round', s: NAVAL_DARK, seam: 2.2 });
        volume(cv, ellipseShape(CX + s * W * 0.94, cy + L * 0.02, W * 0.2, L * 0.045), { h: 5, bevel: 4, prof: 'chamfer', s: NAVAL, mode: 'add', onHull: true });
        glowLamp(cv, CX + s * W * 0.95, cy - L * 0.055, 3.2);
    });
    engineBlock(cv, c.eH, c.engines, U - 36, 40 + c.eH * 0.05);
    // Plating over the whole hull (mirrored), before the raised fittings.
    plateField(cv, 0, 0, U, U, { pw: 58 + W * 0.1, ph: 32 + W * 0.05, seed: c.seed, mats: HULL_MATS, rivet: 1.7, tone: 0.16, rust: 0.6 });
    // Sensor prow: dome in a copper collar, a lamp gem at the tip.
    const py = T(0.07);
    const pr = W * 0.34;
    torus(cv, CX, py, pr * 1.1, pr * 0.15, { z: Hs * 0.5, s: COPPER });
    dome(cv, CX, py, pr, { z: Hs * 0.5, h: pr * 0.7, s: GUN });
    carve(cv, ringShape(CX, py, pr * 0.55, 1.2), 1.5, 0.8);
    glowLamp(cv, CX, py - pr * 0.3, pr * 0.14);
    // Copper collar band across the second module (the family trim line).
    volume(cv, boxShape(CX, T(0.15), W * 1.1, 5), { h: 3, bevel: 3, prof: 'round', s: COPPER, mode: 'add', onHull: true });
    // Chevron armour stack.
    for (let k = 0; k < c.plates; k++) {
        const yc = c.plateY + k * W * 0.5;
        const hw = W * (0.78 - 0.05 * k);
        volume(cv, polyShape([
            [CX - hw, yc + W * 0.3],
            [CX, yc - W * 0.06],
            [CX + hw, yc + W * 0.3],
            [CX + hw, yc + W * 0.48],
            [CX, yc + W * 0.14],
            [CX - hw, yc + W * 0.48],
        ]), { h: 8, bevel: 5, prof: 'round', s: k % 2 ? NAVAL_LIGHT : NAVAL, mode: 'add', onHull: true });
        both((s) => rivetRow(cv, CX + s * 10, yc + W * 0.03, CX + s * hw * 0.9, yc + W * 0.34, 8, 1.7));
        stain(cv, boxShape(CX, yc + W * 0.46, hw * 0.3, 2), 'rust', 0.6);
    }
    // Turquoise spine panel in its copper frame, lamp gems down the sides.
    const P = c.panel;
    const pw = W * 0.3;
    volume(cv, boxShape(CX, P.y, pw + 6, P.hy + 6, 7), { h: 3, bevel: 3, prof: 'round', s: COPPER, mode: 'add', onHull: true });
    carve(cv, boxShape(CX, P.y, pw, P.hy, 5), 4, 2.5, TURQ, 0);
    plateField(cv, CX - pw, P.y - P.hy, CX + pw, P.y + P.hy, { pw: pw * 0.5, ph: P.hy * 0.33, seed: c.seed + 9, mats: [M.turq], rivet: 0, tone: 0.1, rust: 0.2 });
    for (let k = 0; k < 4; k++) {
        const y = P.y - P.hy * 0.75 + (P.hy * 1.5 * k) / 3;
        both((s) => glowLamp(cv, CX + s * pw * 0.55, y, 3.6));
    }
    glowLamp(cv, CX, P.y - P.hy - 14, 4.5);
    // Sensor mast (and dish).
    const my = c.mastY;
    const mz = cv.heightAt(CX, my);
    shadedBox(cv, CX, my, W * 0.3, W * 0.2, { z: mz - 4, h: 16, bevel: 10, prof: 'round', s: NAVAL_DARK, r: 8 });
    if (c.dish === true) {
        bowl(cv, CX, my, W * 0.22, { z: mz + 10, h: 10, s: NAVAL_LIGHT, rim: COPPER });
        dome(cv, CX, my, W * 0.05, { z: mz + 12, h: 10, s: GUN });
    } else dome(cv, CX, my, W * 0.14, { z: mz + 8, h: 12, s: GUN });
    both((s) => shadedCylinder(cv, CX + s * W * 0.2, my + W * 0.12, CX + s * W * 0.5, my + W * 0.4, 2.2, { z: mz + 14, s: STEEL, caps: 'round' }));
    for (const t of c.turrets) {
        if ((t.x ?? 0) === 0) turret(cv, CX, t.y, t.r, { barrels: t.barrels, z: t.z });
        else both((s) => turret(cv, CX + s * (t.x ?? 0), t.y, t.r, { barrels: t.barrels, z: t.z }));
    }
    greebles(cv, CX + W * 0.4, T(0.3), CX + c.skirt * 0.9, y1 - 30, Math.round(c.skirt * 0.18), { seed: c.seed + 3, size: 7 + W * 0.03, mats: HULL_MATS, s: NAVAL_DARK, alt: STEEL });
    both((s) => vents(cv, CX + s * W * 0.5, my + W * 0.1, W * 0.12, W * 0.2, 5));
}

function buildFrigate(cv: HullCanvas): void {
    warship(cv, {
        seed: 11,
        W: 86,
        Hs: 80,
        y0: 40,
        y1: 905,
        skirt: 205,
        skirtT: 0.72,
        plates: 2,
        plateY: 330,
        turrets: [{ y: 215, r: 42, barrels: 2 }],
        nx: 112,
        nr: 38,
        ny0: 560,
        eH: 180,
        engines: 2,
        panel: { y: 560, hy: 55 },
        mastY: 700,
    });
}

function buildDestroyer(cv: HullCanvas): void {
    warship(cv, {
        seed: 23,
        W: 108,
        Hs: 96,
        y0: 30,
        y1: 900,
        skirt: 268,
        skirtT: 0.7,
        plates: 2,
        plateY: 360,
        turrets: [
            { y: 210, r: 46, barrels: 2 },
            { y: 330, r: 50, barrels: 2 },
        ],
        nx: 149,
        nr: 46,
        ny0: 540,
        eH: 240,
        engines: 2,
        panel: { y: 560, hy: 50 },
        mastY: 690,
        dish: true,
    });
    // Missile cell blocks on the skirt either side of the spine: a grid of hatches.
    both((s) => {
        const x = CX + s * 185;
        const z = cv.heightAt(x, 470);
        shadedBox(cv, x, 470, 28, 50, { z, h: 10, bevel: 6, prof: 'chamfer', s: NAVAL_DARK, r: 4 });
        for (let r = 0; r < 4; r++) for (let q = 0; q < 2; q++) carve(cv, boxShape(x - 11 + q * 22, 438 + r * 21, 8, 8, 2), 3, 1.5, STEEL, 0.1);
        stain(cv, boxShape(x, 520, 24, 3), 'rust', 0.6);
    });
}

function buildBattleship(cv: HullCanvas): void {
    warship(cv, {
        seed: 37,
        W: 132,
        Hs: 112,
        y0: 30,
        y1: 900,
        skirt: 380,
        skirtT: 0.66,
        plates: 2,
        plateY: 380,
        turrets: [
            { y: 205, r: 54, barrels: 3 },
            { y: 330, r: 58, barrels: 3 },
            { y: 560, r: 40, barrels: 2, x: 250 },
            { y: 700, r: 38, barrels: 2, x: 300 },
        ],
        nx: 186,
        nr: 52,
        ny0: 600,
        eH: 300,
        engines: 4,
        panel: { y: 580, hy: 60 },
        mastY: 720,
        dish: true,
    });
    both((s) => {
        // Hangar bays in the skirt: recessed, lit deck lamps at the mouth, a copper lintel.
        const x = CX + s * 225;
        carve(cv, boxShape(x, 440, 30, 40, 4), 14, 4, STEEL, 0.3);
        for (let q = 0; q < 3; q++) carve(cv, boxShape(x, 412 + q * 20, 26, 1.2), 2, 0.6);
        emissive(cv, boxShape(x, 476, 26, 2.5), LAMP_WARM, 0.8);
        volume(cv, boxShape(x, 398, 34, 3.5), { h: 3, bevel: 3, prof: 'round', s: COPPER, mode: 'add', onHull: true });
        stain(cv, boxShape(x, 482, 26, 3), 'rust', 0.8);
        dome(cv, CX + s * 330, 640, 12, { z: cv.heightAt(CX + s * 330, 640), h: 9, s: GUN });
    });
}

function buildConstruction(cv: HullCanvas): void {
    const seed = 53;
    const cargo: Surf[] = [
        { c: [0.1, 0.28, 0.27], m: M.cargo },
        { c: [0.4, 0.2, 0.14], m: M.cargo },
        { c: [0.46, 0.38, 0.18], m: M.cargo },
        { c: [0.3, 0.32, 0.34], m: M.cargo },
    ];
    // Flank racks with cargo pods, fuel tanks aft (under the hull's edges).
    both((s) => {
        volume(cv, barShape(CX + s * 150, 390, CX + s * 150, 690, 36), { z: 6, h: 22, bevel: 8, prof: 'chamfer', s: STEEL }); // pod rack
        for (let k = 0; k < 3; k++) {
            const y = 420 + k * 104;
            const x = CX + s * 178;
            shadedBox(cv, x, y, 44, 46, { z: 14, h: 44, bevel: 16, prof: 'round', s: cargo[(k + 1) % 4], r: 10 });
            for (let q = -2; q <= 2; q++) volume(cv, boxShape(x + q * 15, y, 2.2, 40), { h: 2.5, bevel: 2.2, prof: 'round', s: cargo[(k + 1) % 4], mode: 'add', onHull: true });
            volume(cv, boxShape(x, y - 38, 42, 3), { h: 2.5, bevel: 2.5, prof: 'round', s: STEEL, mode: 'add', onHull: true });
            stain(cv, boxShape(x, y + 38, 38, 4), 'rust', 0.8);
            glowLamp(cv, x + s * 32, y - 30, 2.8);
        }
        const tx = CX + s * 170;
        shadedCylinder(cv, tx, 715, tx, 870, 38, { z: 8, s: NAVAL_LIGHT, caps: 'round', bands: 4, bandSurf: COPPER });
        dome(cv, tx, 715, 12, { z: 40, h: 6, s: GUN });
        pipe(cv, [[tx - s * 38, 740], [CX + s * 118, 740]], 5, { z: 34, s: COPPER_DARK, collar: GUN });
        pipe(cv, [[tx - s * 38, 840], [CX + s * 118, 840]], 5, { z: 34, s: COPPER_DARK, collar: GUN });
        stain(cv, circleShape(tx, 800, 20), 'rust', 0.6);
    });
    // Boxy main hull (superelliptic loft) and the engine block.
    loft(cv, { y0: 300, y1: 900, hw: (t) => 128 * (t < 0.06 ? 0.8 + 0.2 * (t / 0.06) : 1), ht: () => 66, pow: 4, z: 8, s: NAVAL });
    engineBlock(cv, 150, 3, U - 40, 44);
    // Stepped deck blocks.
    shadedBox(cv, CX, 500, 96, 70, { z: 60, h: 22, bevel: 12, prof: 'round', s: NAVAL_DARK, r: 10 });
    shadedBox(cv, CX, 660, 104, 72, { z: 60, h: 18, bevel: 10, prof: 'round', s: NAVAL_LIGHT, r: 10 });
    shadedBox(cv, CX, 810, 86, 50, { z: 60, h: 14, bevel: 8, prof: 'round', s: NAVAL_DARK, r: 8 });
    plateField(cv, 0, 0, U, U, { pw: 56, ph: 32, seed, mats: HULL_MATS, rivet: 1.8, tone: 0.16, rust: 0.7 });
    // Hatches, vents and a spine truss of pipes.
    both((s) => {
        for (let k = 0; k < 2; k++) {
            carve(cv, boxShape(CX + s * 52, 475 + k * 55, 34, 20, 4), 4, 2, STEEL, 0.2);
            vents(cv, CX + s * 52, 475 + k * 55, 24, 13, 4);
        }
        carve(cv, boxShape(CX + s * 55, 660, 36, 50, 4), 5, 2, STEEL, 0.2);
        for (let q = 0; q < 3; q++) carve(cv, boxShape(CX + s * 55, 626 + q * 34, 32, 1.4), 2, 0.6);
        pipe(cv, [[CX + s * 112, 330], [CX + s * 112, 890]], 5.5, { z: 72, s: STEEL });
        for (let q = 0; q < 6; q++) dome(cv, CX + s * 112, 350 + q * 100, 8, { z: 72, h: 6, s: COPPER_DARK });
    });
    // Turquoise spine panel + lamps (the family trim), copper band.
    volume(cv, boxShape(CX, 660, 20, 64, 5), { h: 3, bevel: 3, prof: 'round', s: COPPER, mode: 'add', onHull: true });
    carve(cv, boxShape(CX, 660, 14, 58, 4), 3, 2, TURQ, 0);
    for (let k = 0; k < 4; k++) glowLamp(cv, CX, 614 + k * 31, 3.4);
    volume(cv, boxShape(CX, 318, 126, 5), { h: 3, bevel: 3, prof: 'round', s: COPPER, mode: 'add', onHull: true });
    // Bridge block forward: chamfered, a glazed window strip and lamps.
    volume(cv, polyShape([
        [CX - 60, 350],
        [CX + 60, 350],
        [CX + 80, 372],
        [CX + 80, 430],
        [CX - 80, 430],
        [CX - 80, 372],
    ]), { z: 70, h: 26, bevel: 14, prof: 'round', s: NAVAL_LIGHT });
    carve(cv, polyShape([
        [CX - 54, 358],
        [CX + 54, 358],
        [CX + 66, 370],
        [CX - 66, 370],
    ]), 3, 1.2, { c: [0.05, 0.22, 0.24], m: M.glass }, 0);
    emissive(cv, boxShape(CX, 365, 50, 2.5), LAMP_TURQ, 0.4);
    shadedBox(cv, CX, 405, 30, 14, { z: 92, h: 8, bevel: 5, prof: 'round', s: GUN, r: 4 });
    both((s) => glowLamp(cv, CX + s * 62, 415, 3.2));
    glowLamp(cv, CX, 405, 3.5);
    // Open gantry frame at the bow: two rails, cross beams, diagonal lattice, the void between.
    both((s) => {
        const x = CX + s * 108;
        shadedBox(cv, x, 175, 18, 150, { z: 10, h: 48, bevel: 12, prof: 'round', s: STEEL, r: 4 });
        volume(cv, boxShape(x, 175, 4, 146), { h: 2, bevel: 2, prof: 'round', s: COPPER_DARK, mode: 'add', onHull: true });
        for (let k = 0; k < 6; k++) carve(cv, boxShape(x, 50 + k * 50, 10, 12, 2), 6, 2, GUN, 0.3);
        dome(cv, x, 38, 22, { z: 34, h: 16, s: GUN });
        glowLamp(cv, x, 32, 4);
    });
    for (const y of [45, 180, 305]) shadedBox(cv, CX, y, 108, 9, { z: 28, h: 18, bevel: 7, prof: 'round', s: GUN, r: 3 });
    both((s) => {
        shadedCylinder(cv, CX + s * 100, 58, CX - s * 100, 168, 4.5, { z: 30, s: STEEL, caps: 'round' });
        shadedCylinder(cv, CX + s * 100, 192, CX - s * 100, 294, 4.5, { z: 30, s: STEEL, caps: 'round' });
    });
    // Winch on the fore crossbar.
    shadedCylinder(cv, CX - 30, 45, CX + 30, 45, 13, { z: 40, s: COPPER_DARK, bands: 5, bandSurf: GUN });
    // Crane arms: pivots on the rail heads aft, two segments reaching into the frame, hook blocks.
    both((s) => {
        const px = CX + s * 108;
        dome(cv, px, 300, 26, { z: 60, h: 20, s: NAVAL_DARK });
        shadedCylinder(cv, px, 300, CX + s * 62, 190, 10, { z: 82, s: NAVAL_LIGHT, caps: 'round', bands: 5, bandSurf: GUN });
        dome(cv, CX + s * 62, 190, 12, { z: 86, h: 8, s: COPPER });
        shadedCylinder(cv, CX + s * 62, 190, CX + s * 30, 108, 7.5, { z: 88, s: NAVAL_LIGHT, caps: 'round', bands: 4, bandSurf: GUN });
        shadedBox(cv, CX + s * 30, 102, 10, 12, { z: 80, h: 14, bevel: 4, prof: 'chamfer', s: GUN, r: 2 });
        glowLamp(cv, CX + s * 30, 96, 2.6, LAMP_WARM);
    });
    // A half-built truss segment held in the frame.
    shadedBox(cv, CX, 125, 36, 26, { z: 14, h: 22, bevel: 6, prof: 'chamfer', s: BARE, r: 3 });
    for (let k = 0; k < 3; k++) carve(cv, boxShape(CX - 22 + k * 22, 125, 7, 18, 1), 6, 1);
    greebles(cv, CX + 60, 440, CX + 125, 880, 22, { seed: seed + 5, size: 8, mats: HULL_MATS, s: NAVAL_DARK, alt: STEEL });
}

function buildExplorer(cv: HullCanvas): void {
    const seed = 71;
    // Antenna booms (swept back, trussed) carrying ribbed sensor arrays and small dishes.
    both((s) => {
        shadedCylinder(cv, CX + s * 90, 520, CX + s * 285, 585, 7, { z: 40, s: STEEL, caps: 'round', bands: 8, bandSurf: COPPER_DARK });
        shadedCylinder(cv, CX + s * 60, 548, CX + s * 250, 600, 4, { z: 34, s: GUN, caps: 'round' });
        radiator(cv, CX + s * 300, 575, 16, 58, 6, { z: 36, s: NAVAL_LIGHT, frame: GUN, dir: 'y' });
        glowLamp(cv, CX + s * 300, 516, 3.2);
        shadedCylinder(cv, CX + s * 50, 735, CX + s * 225, 815, 5.5, { z: 30, s: STEEL, caps: 'round', bands: 5, bandSurf: COPPER_DARK });
        bowl(cv, CX + s * 232, 818, 24, { z: 30, h: 8, s: NAVAL_LIGHT, rim: COPPER });
        dome(cv, CX + s * 232, 818, 5, { z: 34, h: 6, s: GUN });
        // Engine pods and their radiators.
        const x = CX + s * 90;
        radiator(cv, CX + s * 158, 800, 32, 62, 7, { z: 10, s: STEEL, frame: GUN, dir: 'x' });
        nacelle(cv, x, 680, U - 70, 36, seed + (s > 0 ? 1 : 2));
    });
    // Slender spine.
    loft(cv, {
        y0: 420,
        y1: 900,
        hw: (t) => 66 * (t < 0.1 ? 0.7 + 0.3 * (t / 0.1) : 1) * (1 + 0.12 * Math.sin(Math.PI * t)),
        ht: () => 62,
        pow: 2.2,
        z: 8,
        s: NAVAL,
    });
    // Collar joints and module caps (the warships' spine language).
    for (const y of [640, 760]) carve(cv, boxShape(CX, y, 80, 3.5), 4, 2.5, STEEL, 0.4);
    for (const [y, b] of [[700, 50], [830, 55]] as const) volume(cv, ellipseShape(CX, y, 40, b), { h: 6, bevel: 4, prof: 'chamfer', s: NAVAL_DARK, mode: 'add', onHull: true });
    engineBlock(cv, 145, 2, U - 36, 38);
    plateField(cv, 0, 0, U, U, { pw: 50, ph: 30, seed, mats: HULL_MATS, rivet: 1.7, tone: 0.14, rust: 0.5 });
    paint(cv, boxShape(CX, 600, 62, 4), COPPER, HULL_MATS);
    // Bulbous crew module: a big dome in a copper band, a ring of turquoise lamp windows, an observation blister.
    const my = 470;
    // Neck from the module to the dish mount.
    loft(cv, { y0: 300, y1: 420, hw: () => 44, ht: () => 50, pow: 2.4, z: 8, s: NAVAL_DARK });
    for (const y of [330, 360, 390]) carve(cv, boxShape(CX, y, 50, 2.5), 3, 2, STEEL, 0.4);
    torus(cv, CX, my, 112, 10, { z: 30, s: COPPER });
    dome(cv, CX, my, 108, { z: 20, h: 86, s: NAVAL_LIGHT });
    plateField(cv, CX - 108, my - 108, CX + 108, my + 108, { pw: 40, ph: 26, seed: seed + 3, mats: [M.paint], rivet: 1.5, tone: 0.1, rust: 0.4 });
    volume(cv, ringShape(CX, my, 80, 7), { h: 1, bevel: 3, prof: 'round', s: TURQ, mode: 'add', onHull: true });
    for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + Math.PI / 10;
        glowLamp(cv, CX + Math.cos(a) * 80, my + Math.sin(a) * 80, 3.6);
    }
    dome(cv, CX, my - 10, 34, { z: 98, h: 16, s: GLASS, mode: 'max' });
    emissive(cv, circleShape(CX, my - 10, 20), LAMP_TURQ, 0.25, 12);
    torus(cv, CX, my - 10, 36, 3.5, { z: 100, s: COPPER });
    // Spine panel and lamps aft of the module.
    paint(cv, boxShape(CX, 700, 20, 70, 4), COPPER, HULL_MATS);
    carve(cv, boxShape(CX, 700, 15, 65, 4), 2.5, 2, TURQ, 0);
    for (let k = 0; k < 4; k++) glowLamp(cv, CX, 650 + k * 34, 3.4);
    // Forward sensor dish on its mount, feed horn on three struts.
    shadedBox(cv, CX, 318, 46, 30, { z: 20, h: 44, bevel: 14, prof: 'round', s: NAVAL_DARK, r: 8 });
    const dy = 170;
    const dr = 152;
    bowl(cv, CX, dy, dr, { z: 28, h: 26, s: NAVAL, rim: COPPER });
    for (let q = 1; q < 4; q++) carve(cv, ringShape(CX, dy, dr * q * 0.24, 1), 1.2, 0.6);
    for (let q = 0; q < 16; q++) {
        const a = (q / 16) * Math.PI * 2;
        carve(cv, barShape(CX + Math.cos(a) * dr * 0.26, dy + Math.sin(a) * dr * 0.26, CX + Math.cos(a) * dr * 0.88, dy + Math.sin(a) * dr * 0.88, 0.7), 0.8, 0.4, undefined, 0.12);
    }
    const strut = (a: number): void => shadedCylinder(cv, CX + Math.cos(a) * dr * 0.88, dy + Math.sin(a) * dr * 0.88, CX, dy, 2.4, { z: 36, s: STEEL, caps: 'round' });
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) strut(a);
    dome(cv, CX, dy, 16, { z: 40, h: 12, s: GUN });
    glowLamp(cv, CX, dy, 5);
    greebles(cv, CX + 30, 560, CX + 62, 880, 10, { seed: seed + 7, size: 6, mats: HULL_MATS, s: NAVAL_DARK, alt: STEEL });
}

// ---------------------------------------------------------------------------------------------------------------
// The Exchange
// ---------------------------------------------------------------------------------------------------------------

function buildPort(cv: HullCanvas): void {
    const seed = 97;
    const CY = U / 2;
    const P = (r: number, a: number, s: 1 | -1): [number, number] => [CX + s * Math.cos(a) * r, CY + Math.sin(a) * r];
    const cargo: Surf[] = [
        { c: [0.1, 0.3, 0.29], m: M.cargo },
        { c: [0.45, 0.22, 0.15], m: M.cargo },
        { c: [0.5, 0.41, 0.2], m: M.cargo },
        { c: [0.38, 0.4, 0.41], m: M.cargo },
        { c: [0.2, 0.24, 0.3], m: M.cargo },
    ];
    // Right-half arm angles (y down); each is mirrored to the left: 12 docking arms.
    const arms = [-75, -45, -15, 15, 45, 75].map((d) => (d * Math.PI) / 180);
    // Docking arms with berths and moored cargo pods, tied by a second (outer) ring.
    torus(cv, CX, CY, 404, 11, { z: 10, h: 18, s: STEEL });
    arms.forEach((a, ai) => {
        both((s) => {
            const [x0, y0] = P(215, a, s);
            const [x1, y1] = P(456, a, s);
            volume(cv, barShape(x0, y0, x1, y1, 21), { z: 6, h: 36, bevel: 11, prof: 'round', s: NAVAL_DARK });
            volume(cv, barShape(x0, y0, x1, y1, 7), { h: 5, bevel: 3, prof: 'chamfer', s: STEEL, mode: 'add', onHull: true });
            // Docking collar at the tip.
            const [tx, ty] = P(466, a, s);
            torus(cv, tx, ty, 18, 7, { z: 20, s: COPPER });
            dome(cv, tx, ty, 12, { z: 18, h: 10, s: GUN });
            glowLamp(cv, tx, ty, 3.5, LAMP_WARM);
            // Berths: cradle crossbars and a pod each side (a few berths empty).
            const nx = -Math.sin(a) * s;
            const ny = Math.cos(a);
            const [ux, uy] = [Math.cos(a) * s, Math.sin(a)];
            [305, 362, 425].forEach((r, bi) => {
                const [bx, by] = P(r, a, s);
                const reach = 40 + r * 0.05;
                volume(cv, barShape(bx - nx * reach, by - ny * reach, bx + nx * reach, by + ny * reach, 5), { z: 18, h: 16, bevel: 4, prof: 'round', s: STEEL });
                for (const side of [-1, 1]) {
                    const key = ai * 7 + bi * 3 + (side > 0 ? 1 : 0);
                    if ((key * 37) % 13 === 3) continue; // an empty berth
                    const off = 20 + reach * 0.62;
                    const cx = bx + nx * side * off;
                    const cy = by + ny * side * off;
                    const L = 22 + ((key * 13) % 3) * 3;
                    const w = 12 + r * 0.02;
                    const surf = cargo[(key * 5) % cargo.length];
                    volume(cv, barShape(cx - ux * L, cy - uy * L, cx + ux * L, cy + uy * L, w), { z: 22, h: 28, bevel: 10, prof: 'round', s: surf });
                    for (let q = -1; q <= 1; q++) carve(cv, barShape(cx + ux * q * 13 - nx * w, cy + uy * q * 13 - ny * w, cx + ux * q * 13 + nx * w, cy + uy * q * 13 + ny * w, 0.9), 1.4, 0.5);
                    stain(cv, circleShape(cx, cy, 10), 'rust', 0.5);
                    stain(cv, circleShape(cx, cy, 20), 'soot', 0.15);
                }
            });
            rivetRow(cv, ...P(225, a + 0.035, s), ...P(450, a + 0.035, s), 10, 1.8);
            rivetRow(cv, ...P(225, a - 0.035, s), ...P(450, a - 0.035, s), 10, 1.8);
        });
    });
    // Warehouse blocks between the arms, stacked; some newer (clean paint, turquoise panels) bolted on.
    const sectors = [-90, -60, -30, 0, 30, 60, 90].map((d) => (d * Math.PI) / 180);
    sectors.forEach((a, k) => {
        const newer = k === 1 || k === 4;
        const s1: Surf = newer ? NAVAL_LIGHT : NAVAL_DARK;
        both((s) => {
            if ((k === 0 || k === 6) && s < 0) return; // on the axis: drawn once
            const [x0, y0] = P(186, a, s);
            const [x1, y1] = P(246, a, s);
            volume(cv, barShape(x0, y0, x1, y1, 52), { z: 20, h: 44, bevel: 10, prof: 'chamfer', s: s1 });
            const [m0, m1] = P(200, a, s);
            const [n0, n1] = P(236, a, s);
            volume(cv, barShape(m0, m1, n0, n1, 32), { z: 56, h: 22, bevel: 7, prof: 'chamfer', s: newer ? TURQ_LIGHT : NAVAL });
            const [cx, cy] = P(218, a, s);
            vents(cv, cx, cy, 14, 12, 4);
            if (newer) {
                glowLamp(cv, cx, cy, 3.5);
                paint(cv, circleShape(cx, cy, 26), COPPER, [M.paint]);
            } else {
                stain(cv, circleShape(cx, cy, 30), 'rust', 0.75);
                stain(cv, circleShape(cx, cy + 12, 26), 'soot', 0.35);
            }
            // Outer warehouse on the ring between the arms, and a crane over it.
            const [ox, oy] = P(300, a, s);
            const [ox1, oy1] = P(338, a, s);
            volume(cv, barShape(ox, oy, ox1, oy1, 22), { z: 30, h: 30, bevel: 8, prof: 'chamfer', s: k % 2 ? NAVAL : STEEL });
            if (k % 2 === 1) {
                const [px, py] = P(290, a, s);
                const [qx, qy] = P(360, a + 0.18, s);
                dome(cv, px, py, 10, { z: 60, h: 8, s: GUN });
                shadedCylinder(cv, px, py, qx, qy, 4, { z: 66, s: COPPER_DARK, caps: 'round', bands: 6, bandSurf: GUN });
                glowLamp(cv, qx, qy, 2.4, LAMP_WARM);
            }
        });
    });
    // Inner habitation ring with lit windows, spokes to the rotunda.
    torus(cv, CX, CY, 172, 22, { z: 24, h: 44, s: NAVAL });
    for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2 + Math.PI / 24;
        const [x, y] = P(172, a, 1);
        glowLamp(cv, x, y, 3, k % 3 === 0 ? LAMP_TURQ : LAMP_WARM, 0.8);
    }
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const [x0, y0] = P(120, a, 1);
        const [x1, y1] = P(160, a, 1);
        volume(cv, barShape(x0, y0, x1, y1, 12), { z: 40, h: 24, bevel: 6, prof: 'round', s: STEEL });
    }
    // Plating over the whole station.
    plateField(cv, 0, 0, U, U, { pw: 40, ph: 26, seed, mats: [M.paint, M.plate, M.cargo], rivet: 1.6, tone: 0.16, rust: 0.9 });
    // The gilded trading rotunda: cornice, ribbed dome, filigree rings, turquoise lantern, spire.
    torus(cv, CX, CY, 138, 11, { z: 60, s: COPPER });
    dome(cv, CX, CY, 134, { z: 58, h: 96, s: GOLD });
    for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + Math.PI / 16;
        volume(cv, barShape(...P(44, a, 1), ...P(130, a, 1), 2.6), { h: 3, bevel: 2.6, prof: 'round', s: COPPER, mode: 'add', onHull: true });
        // Filigree scrolls between the ribs.
        const b = a + Math.PI / 16;
        volume(cv, ringShape(...P(96, b, 1), 12, 1.4), { h: 1.8, bevel: 1.4, prof: 'round', s: COPPER, mode: 'add', onHull: true });
        glowLamp(cv, ...P(118, b, 1), 2.6);
    }
    for (const R of [70, 106]) volume(cv, ringShape(CX, CY, R, 2.2), { h: 2.4, bevel: 2.2, prof: 'round', s: COPPER, mode: 'add', onHull: true });
    dome(cv, CX, CY, 40, { z: 150, h: 16, s: GLASS, mode: 'max' });
    emissive(cv, circleShape(CX, CY, 32), LAMP_TURQ, 0.35, 20);
    for (let k = 0; k < 8; k++) volume(cv, barShape(...P(8, (k * Math.PI) / 4, 1), ...P(40, (k * Math.PI) / 4, 1), 1.8), { h: 2.5, bevel: 1.8, prof: 'round', s: GOLD, mode: 'add', onHull: true });
    torus(cv, CX, CY, 41, 4, { z: 152, s: COPPER });
    dome(cv, CX, CY, 9, { z: 168, h: 10, s: COPPER });
    glowLamp(cv, CX, CY, 3.2);
    // Soot and verdigris-dulled patches on the gilding (it is old).
    for (let k = 0; k < 7; k++) {
        const a = k * 2.1 + 0.4;
        stain(cv, circleShape(CX + Math.cos(a) * (60 + (k % 3) * 25), CY + Math.sin(a) * (60 + (k % 3) * 25), 16 + (k % 2) * 8), 'soot', 0.35);
    }
    // Pipes along the outer ring and grime.
    for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const [x, y] = P(262, a, 1);
        dome(cv, x, y, 9, { z: 40, h: 8, s: COPPER_DARK });
    }
    greebles(cv, CX + 150, CY - 280, CX + 290, CY + 280, 60, { seed: seed + 11, size: 6, mats: [M.paint, M.plate], s: STEEL, alt: NAVAL_LIGHT });
}

const BUILDERS: Readonly<Record<ConcordHullKind, (cv: HullCanvas) => void>> = {
    frigate: buildFrigate,
    destroyer: buildDestroyer,
    battleship: buildBattleship,
    construction: buildConstruction,
    explorer: buildExplorer,
    port: buildPort,
};

const WEAR: Readonly<Record<ConcordHullKind, number>> = { frigate: 0.9, destroyer: 0.95, battleship: 1, construction: 1.1, explorer: 0.85, port: 1.3 };

/** Draw one kind at `side` px (bow up, symmetric about the vertical axis): the lit RGBA image. Pure; deterministic. */
export function drawConcordHull(kind: ConcordHullKind, side: number): RgbaImageLike {
    const cv = new HullCanvas(side);
    BUILDERS[kind](cv);
    return renderHull(cv, { seed: 1000 + Object.keys(BUILDERS).indexOf(kind) * 131, wear: WEAR[kind], streak: kind === 'port' ? 40 : 60 });
}
