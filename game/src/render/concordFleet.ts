// Scenario 19a art — the Oranthi Concord's procedural fleet (tasks/19-mod-layer-scenarios.md "Concord art"): giant
// insects cybernetically augmented into ships, built on the biomech canvas of concordHull.ts. Not a port: the
// original has no such art.
//
// One anatomy per class, each a distinct silhouette (proportions taken from dorsal views of real insects):
//   frigate      — a wasp / dart: wide head with compound eyes and pincer mandibles, round thorax, wasp waist, banded
//                  egg-shaped gaster, two swept wing-fins, tucked legs, twin engine pods at the gaster's tail.
//   destroyer    — a mantis-hornet: triangular head, long prothorax spine, folded raptorial scythes reaching past the
//                  head (metal blade edges), long folded-wing abdomen, long spread legs.
//   battleship   — a huge armoured stag beetle: mandibles and a horn, a broad pronotum shield, parallel elytra with a
//                  suture and striae, grafted armour plates and turret-like sensor domes, four engine pods.
//   carrier      — a hive-backed beetle: the elytra replaced by a honeycomb brood back with glowing cells and three
//                  launch hatches.
//   construction — a worker ant: big head with manipulator mandibles ending in grafted claws, elbowed antennae, long
//                  mesosoma, petiole node, round gaster, long legs.
//   explorer     — a dragonfly: huge eyes, four long veined wings straight out, a long thin segmented tail.
//   freighter    — a bloated tick: small capitulum, a scutum shield, a swollen festooned body carrying strapped cargo
//                  sacs, eight legs.
//   treasure     — a giant armoured queen: small head and thorax, an enormous abdomen of dark armour bands floating
//                  on stretched glowing flesh, brood sacs, bolted plates, four engine pods.
//   port / base  — hives: domed honeycomb mounds with a spire of sensor clusters, organic buttress roots and grafted
//                  metal docking arms ending in chitin clamps.
// Everything is drawn in design units (0‥1000, bow up) and mirror-symmetric in silhouette about the vertical axis.

import {
    BIO_LAMP,
    BioCanvas,
    CABLE,
    CHITIN,
    CHITIN_PURPLE,
    COMB,
    CX,
    FLESH,
    FLESH_DARK,
    GRAFT,
    GRAFT_DARK,
    MARGIN_PINK,
    MARGIN_PURPLE,
    SEAM_PINK,
    SEAM_VIOLET,
    STEEL,
    U,
    bioLamp,
    both,
    boxShape,
    cables,
    capsuleShape,
    carve,
    circleShape,
    comb,
    compoundEye,
    curvedTube,
    dome,
    ellipseShape,
    emit,
    enginePod,
    graft,

    limb,
    polyShape,
    renderBio,
    segment,
    sensorCluster,
    tube,
    volume,
    wing,
    type BioRender,
    type Nozzle,
} from './concordHull';

export type ConcordHullKind = 'frigate' | 'destroyer' | 'battleship' | 'carrier' | 'freighter' | 'explorer' | 'construction' | 'treasure' | 'port' | 'base';

// ---------------------------------------------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------------------------------------------

/** Ellipse half-width profile (0 at both ends, 1 in the middle). */
const ell = (t: number): number => Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
/** Egg profile widest at `peak`. */
const egg = (t: number, peak: number): number => {
    const u = t < peak ? (t - peak) / peak : (t - peak) / (1 - peak);
    return Math.sqrt(Math.max(0, 1 - u * u));
};
/** Mostly parallel sides (elytra): rounded fore shoulder over `a`, rounded aft over `b`. */
const slab = (t: number, a: number, b: number): number => {
    if (t < a) return Math.sqrt(Math.max(0, 1 - ((a - t) / a) ** 2)) * 0.15 + 0.85 * Math.sqrt(Math.max(0, 1 - ((a - t) / a) ** 2));
    if (t > 1 - b) return Math.sqrt(Math.max(0, 1 - ((t - (1 - b)) / b) ** 2));
    return 1;
};
const sx = (s: number, dx: number): number => CX + s * dx;

/** Antennae: a beaded feeler pair from (dx, y) curving out to (tx, ty) (starboard given). */
function antennae(cv: BioCanvas, dx: number, y: number, cxp: number, cyp: number, tx: number, ty: number, r: number, lamp = true): void {
    both((s) => {
        curvedTube(cv, [sx(s, dx), y], [sx(s, cxp), cyp], [sx(s, tx), ty], r, r * 0.45, { z: 30, z1: 26, s: CHITIN, n: 12, beads: CHITIN_PURPLE });
        if (lamp) bioLamp(cv, sx(s, tx), ty, r * 1.2);
    });
}

/** Pincer mandibles from (dx, y) curving to the tips (tx, ty), inner teeth. */
function mandibles(cv: BioCanvas, dx: number, y: number, cxp: number, cyp: number, tx: number, ty: number, r: number, o: { metal?: boolean; z?: number } = {}): void {
    const z = o.z ?? 22;
    both((s) => {
        curvedTube(cv, [sx(s, dx), y], [sx(s, cxp), cyp], [sx(s, tx), ty], r, r * 0.22, { z, z1: z - 6, s: CHITIN, n: 12, film: 0.4 });
        // Inner teeth along the inner edge.
        for (let k = 1; k <= 3; k++) {
            const t = 0.25 + k * 0.17;
            const px = (1 - t) * (1 - t) * dx + 2 * (1 - t) * t * cxp + t * t * tx;
            const py = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * cyp + t * t * ty;
            const rr = r * (1 - t * 0.7);
            tube(cv, sx(s, px), py, sx(s, px - rr * 1.3), py - rr * 0.5, rr * 0.45, rr * 0.1, { z: z + 2, s: o.metal ? STEEL : CHITIN_PURPLE });
        }
        if (o.metal) {
            // Grafted metal cutting edge near the tip.
            const t = 0.75;
            const px = (1 - t) * (1 - t) * dx + 2 * (1 - t) * t * cxp + t * t * tx;
            const py = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * cyp + t * t * ty;
            graft(cv, circleShape(sx(s, px), py, r * 0.42), { h: 2, seam: 2.5, glow: 0.8, bolts: 0 });
        }
    });
}

function head(cv: BioCanvas, y0: number, y1: number, hw: number, o: { eyeX: number; eyeY: number; eyeA: number; eyeB: number; seed: number; h?: number; sensor?: number }): void {
    segment(cv, { y0, y1, hw: (t) => hw * Math.pow(ell(t), 0.6), ht: (t) => (o.h ?? 46) * (0.6 + 0.4 * ell(t)), z: 10, margin: 6, seed: o.seed, film: 0.1, keel: 2 });
    both((s) => compoundEye(cv, sx(s, o.eyeX), o.eyeY, o.eyeA, o.eyeB, { z: cv.heightAt(sx(s, o.eyeX), o.eyeY) * 0.7, seed: o.seed + (s > 0 ? 1 : 2), glow: 0.35 }));
    if (o.sensor !== undefined) sensorCluster(cv, CX, (y0 + y1) / 2 - (y1 - y0) * 0.08, o.sensor, { lenses: 5 });
}

/** Bolted armour plate (mirrored pair or on the axis). */
function armour(cv: BioCanvas, pts: readonly (readonly [number, number])[], o: { mirror?: boolean; bolts?: number; panel?: number; seed?: number; glow?: number } = {}): void {
    const sh = polyShape(pts.map(([x, y]) => [x, y] as const));
    graft(cv, sh, { h: 5, bolts: o.bolts ?? 6, panel: o.panel ?? 0, seed: o.seed, glow: o.glow });
    if (o.mirror) graft(cv, polyShape(pts.map(([x, y]) => [U - x, y] as const)), { h: 5, bolts: o.bolts ?? 6, panel: o.panel ?? 0, seed: (o.seed ?? 3) + 1, glow: o.glow, colour: SEAM_VIOLET });
}

/** Intersegmental glow: a pulsing flesh line across the body at y (half-width w). */
function jointGlow(cv: BioCanvas, y: number, w: number, power = 0.5): void {
    emit(cv, ellipseShape(CX, y, w, 2.2), SEAM_PINK, power * 0.7, 'pulse');
}

// ---------------------------------------------------------------------------------------------------------------
// Ships
// ---------------------------------------------------------------------------------------------------------------

function buildFrigate(cv: BioCanvas): void {
    const seed = 11;
    // Wing-fins, swept (low, under the body), then legs.
    wing(cv, [CX + 55, 300], [CX + 270, 700], 74, { z: 3, seed, veins: 5 });
    wing(cv, [CX + 50, 380], [CX + 205, 690], 46, { z: 2, seed: seed + 1, veins: 4 });
    limb(cv, [[CX + 60, 300], [CX + 135, 255], [CX + 165, 175]], 13, 6, { z: 6, claw: 16, seam: true });
    limb(cv, [[CX + 70, 370], [CX + 165, 395], [CX + 205, 470]], 13, 6, { z: 6, claw: 16, seam: true });
    limb(cv, [[CX + 65, 430], [CX + 160, 515], [CX + 190, 630]], 14, 6, { z: 6, claw: 18, seam: true });
    // Engine pods at the tail, then the gaster over their fore ends.
    both((s) => enginePod(cv, sx(s, 92), 690, 900, 30, { z: 26 }));
    segment(cv, { y0: 500, y1: 915, hw: (t) => 128 * egg(t, 0.36), ht: (t) => 66 * (0.45 + 0.55 * egg(t, 0.36)), z: 12, plates: 5, lip: 3.5, margin: 8, seed, film: 0.5 });
    for (let k = 1; k < 5; k++) jointGlow(cv, 500 + (415 * k) / 5, 128 * egg(k / 5, 0.36) * 0.9, 0.4);
    // Sting cannon.
    tube(cv, CX, 880, CX, 960, 12, 3, { z: 30, s: STEEL });
    tube(cv, CX, 860, CX, 905, 16, 13, { z: 30, s: GRAFT, bands: 3, bandSurf: GRAFT_DARK });
    // Petiole and thorax.
    segment(cv, { y0: 455, y1: 530, hw: (t) => 22 + 10 * Math.abs(2 * t - 1), ht: () => 34, z: 10, seed, film: 0.3 });
    segment(cv, { y0: 232, y1: 478, hw: (t) => 92 * Math.pow(ell(t), 0.75), ht: (t) => 72 * (0.5 + 0.5 * ell(t)), z: 10, plates: 2, lip: 4, margin: 6, keel: 3, seed: seed + 1, film: 0.2 });
    armour(cv, [[CX - 42, 300], [CX + 42, 300], [CX + 30, 360], [CX - 30, 360]], { bolts: 6, panel: 14, seed });
    // Head, eyes, mandibles, antennae.
    head(cv, 130, 255, 98, { eyeX: 64, eyeY: 190, eyeA: 34, eyeB: 50, seed, sensor: 18 });
    mandibles(cv, 34, 150, 110, 90, 14, 48, 18);
    antennae(cv, 26, 140, 70, 60, 165, 40, 5.5);
    // Cables from the thorax plate to the engine pods.
    both((s) => cables(cv, [[sx(s, 40), 360], [sx(s, 60), 470], [sx(s, 92), 600], [sx(s, 66), 690]], 3.2, { n: 2, clamp: 45 }));
}

function buildDestroyer(cv: BioCanvas): void {
    const seed = 23;
    // Folded wing-fins along the abdomen, long legs.
    wing(cv, [CX + 60, 520], [CX + 230, 880], 64, { z: 3, seed, veins: 6 });
    limb(cv, [[CX + 65, 475], [CX + 210, 430], [CX + 280, 560]], 11, 4.5, { z: 6, claw: 18, seam: true });
    limb(cv, [[CX + 65, 535], [CX + 215, 625], [CX + 262, 815]], 11, 4.5, { z: 6, claw: 18, seam: true });
    both((s) => enginePod(cv, sx(s, 56), 780, 945, 27, { z: 8 }));
    segment(cv, { y0: 520, y1: 945, hw: (t) => 108 * egg(t, 0.42), ht: (t) => 58 * (0.45 + 0.55 * egg(t, 0.42)), z: 12, plates: 6, lip: 3, margin: 7, seed, film: 0.6, keel: 2 });
    for (let k = 1; k < 6; k++) jointGlow(cv, 520 + (425 * k) / 6, 108 * egg(k / 6, 0.42) * 0.85, 0.35);
    // Meso / metathorax and the long prothorax spine.
    segment(cv, { y0: 395, y1: 560, hw: (t) => 76 * Math.pow(ell(t), 0.7), ht: () => 60, z: 10, plates: 2, lip: 3, margin: 6, seed: seed + 1, film: 0.3, keel: 3 });
    segment(cv, { y0: 140, y1: 425, hw: (t) => 44 + 22 * Math.max(0, 1 - t * 3) + 10 * Math.max(0, (t - 0.8) * 5), ht: () => 56, z: 12, margin: 4, seed: seed + 2, film: 0.15, keel: 4 });
    armour(cv, [[CX - 20, 250], [CX + 20, 250], [CX + 17, 380], [CX - 17, 380]], { bolts: 8, panel: 18, seed });
    cables(cv, [[CX + 30, 420], [CX + 44, 500], [CX + 70, 640], [CX + 56, 780]], 3, { n: 3, clamp: 40, mirror: true });
    // Raptorial scythes: coxa from the prothorax front, femur forward past the head, tibia blade folded back.
    both((s) => {
        limb(cv, [[sx(s, 40), 225], [sx(s, 112), 170], [sx(s, 132), 30]], 28, 18, { z: 16, mirror: false, seam: true, knuckle: MARGIN_PINK });
        tube(cv, sx(s, 132), 30, sx(s, 96), 150, 14, 6, { z: 30, s: CHITIN_PURPLE });
        // Grafted blade edge and spines along the femur's inner side.
        volume(cv, polyShape([[sx(s, 108), 40], [sx(s, 116), 40], [sx(s, 104), 165], [sx(s, 96), 160]]), { z: 34, h: 6, bevel: 3, s: STEEL });
        emit(cv, polyShape([[sx(s, 112), 40], [sx(s, 117), 40], [sx(s, 105), 165], [sx(s, 101), 165]]), SEAM_PINK, 0.6, 'pulse');
        for (let k = 0; k < 4; k++) tube(cv, sx(s, 108 - k * 3), 62 + k * 26, sx(s, 90 - k * 3), 54 + k * 26, 4.5, 1, { z: 36, s: CHITIN });
    });
    head(cv, 55, 165, 92, { eyeX: 68, eyeY: 88, eyeA: 26, eyeB: 32, seed, h: 40 });
    sensorCluster(cv, CX, 120, 16, { lenses: 4 });
    antennae(cv, 22, 64, 60, 20, 135, 18, 4.5);
}

/** Shared beetle body: legs, pods, elytra (or the hive back), pronotum, head with mandibles and horn. */
function beetle(cv: BioCanvas, o: { seed: number; hive: boolean }): void {
    const seed = o.seed;
    limb(cv, [[CX + 190, 300], [CX + 300, 255], [CX + 335, 165]], 23, 10, { z: 6, claw: 22, seam: true });
    limb(cv, [[CX + 220, 470], [CX + 335, 485], [CX + 385, 575]], 23, 10, { z: 6, claw: 22, seam: true });
    limb(cv, [[CX + 220, 590], [CX + 325, 680], [CX + 350, 800]], 23, 10, { z: 6, claw: 22, seam: true });
    for (const dx of [70, 172]) both((s) => enginePod(cv, sx(s, dx), 790, 958, 34, { z: 8 }));
    const ey0 = 405;
    const ey1 = 905;
    if (!o.hive) {
        // Elytra: two parallel wing cases, the suture between them, longitudinal striae.
        // Elytra: one silhouette (straight suture, rounded shoulders and tip), two convex cases on it (each sweeps its
        // own long highlight), striae.
        segment(cv, { y0: ey0, y1: ey1, hw: (t) => 252 * Math.pow(slab(t, 0.06, 0.45), 0.85), ht: (t) => 60 * (0.55 + 0.45 * slab(t, 0.12, 0.5)), pow: 3.2, z: 14, margin: 11, seed, film: 0.45 });
        both((s) => {
            const ecx = sx(s, 124);
            segment(cv, { cx: ecx, y0: ey0 + 6, y1: ey1 - 10, hw: (t) => 128 * Math.pow(slab(t, 0.06, 0.45), 0.85), ht: (t) => 34 * slab(t, 0.15, 0.5), pow: 1.8, z: 0, mode: 'add', margin: 0, seed: seed + (s > 0 ? 8 : 9), film: s > 0 ? 0.45 : 0.62 });
            for (let k = -2; k <= 2; k++) carve(cv, capsuleShape(ecx + k * 34, ey0 + 60, ecx + k * 30, ey1 - 130 + Math.abs(k) * 30, 1.5), 1.6, 1.2, undefined, 0.25);
        });
        carve(cv, boxShape(CX, (ey0 + ey1) / 2 - 10, 3, (ey1 - ey0) / 2 - 20, 2), 4, 2, CHITIN_PURPLE, 0.3);
        emit(cv, boxShape(CX, (ey0 + ey1) / 2 - 20, 2.2, (ey1 - ey0) / 2 - 40), SEAM_PINK, 0.7, 'pulse');
        both((s) => {
            // A bolted armour plate on each elytron's shoulder, a sensor implant, cables along the suture.
            armour(cv, [[sx(s, 70), 560], [sx(s, 170), 550], [sx(s, 180), 640], [sx(s, 76), 655]], { bolts: 6, panel: 20, seed: seed + (s > 0 ? 2 : 3), glow: 0.9 });
            sensorCluster(cv, sx(s, 200), 470, 18, { lenses: 5 });
            cables(cv, [[sx(s, 26), 440], [sx(s, 30), 620], [sx(s, 44), 800]], 3.4, { n: 2, clamp: 46 });
        });
    } else {
        // Hive back: a domed shell carrying honeycomb with brood hatches.
        segment(cv, { y0: ey0, y1: ey1, hw: (t) => 255 * Math.pow(slab(t, 0.08, 0.45), 0.9), ht: (t) => 70 * (0.55 + 0.45 * slab(t, 0.1, 0.4)), pow: 3, z: 14, margin: 14, seed, film: 0.45 });
        comb(cv, polyShape([[CX - 205, 440], [CX + 205, 440], [CX + 228, 600], [CX + 190, 820], [CX, 875], [CX - 190, 820], [CX - 228, 600]]), 17, { z: 0, h: 9, seed, lit: 0.08, capped: 0.4, mode: 'add' });
        // Launch hatches: grafted iris rings.
        for (const [dx, y, r] of [[0, 520, 42], [120, 690, 36], [-120, 690, 36]] as const) {
            graft(cv, circleShape(CX + dx, y, r), { h: 6, bolts: 8, glow: 1 });
            carve(cv, circleShape(CX + dx, y, r * 0.62), 6, 3, FLESH_DARK, 0.2);
            emit(cv, circleShape(CX + dx, y, r * 0.55), SEAM_VIOLET, 0.9, 'pulse', r * 0.3);
            for (let k = 0; k < 6; k++) {
                const a = (k / 6) * Math.PI * 2;
                tube(cv, CX + dx + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, CX + dx + Math.cos(a + 0.9) * r * 0.2, y + Math.sin(a + 0.9) * r * 0.2, 3.5, 2, { z: cv.heightAt(CX + dx, y) + 1, s: GRAFT_DARK });
            }
        }
        both((s) => cables(cv, [[sx(s, 236), 470], [sx(s, 246), 620], [sx(s, 226), 800]], 3.4, { n: 3, clamp: 40 }));
    }
    // Scutellum.
    volume(cv, polyShape([[CX - 46, 400], [CX + 46, 400], [CX, 470]]), { z: 40, h: 40, bevel: 14, s: CHITIN, film: 0.2 });
    // Pronotum shield and head.
    segment(cv, { y0: 192, y1: 428, hw: (t) => 232 * Math.pow(egg(t, 0.62), 0.8), ht: (t) => 96 * (0.5 + 0.5 * egg(t, 0.6)), pow: 2.6, z: 14, margin: 12, seed: seed + 1, film: 0.25, keel: 4 });
    both((s) => {
        armour(cv, [[sx(s, 40), 262], [sx(s, 105), 268], [sx(s, 118), 330], [sx(s, 44), 352]], { bolts: 6, panel: 20, seed: seed + (s > 0 ? 6 : 7) });
        sensorCluster(cv, sx(s, 175), 330, 22, { lenses: 6 });
    });
    head(cv, 110, 232, 112, { eyeX: 86, eyeY: 170, eyeA: 26, eyeB: 34, seed, h: 52 });
    // Stag mandibles and a short horn.
    mandibles(cv, 60, 140, 180, 95, 52, 28, 28, { metal: true, z: 30 });
    curvedTube(cv, [CX, 175], [CX, 110], [CX, 66], 30, 9, { z: 52, z1: 64, s: CHITIN, n: 10, film: 0.3 });
    bioLamp(cv, CX, 72, 6);
    antennae(cv, 70, 130, 130, 120, 200, 70, 6);
}

function buildBattleship(cv: BioCanvas): void {
    beetle(cv, { seed: 37, hive: false });
}

function buildCarrier(cv: BioCanvas): void {
    beetle(cv, { seed: 41, hive: true });
}

function buildConstruction(cv: BioCanvas): void {
    const seed = 53;
    // Long ant legs from the mesosoma.
    limb(cv, [[CX + 50, 360], [CX + 190, 300], [CX + 260, 190]], 13, 5, { z: 6, claw: 20, seam: true });
    limb(cv, [[CX + 55, 450], [CX + 215, 470], [CX + 300, 600]], 13, 5, { z: 6, claw: 20, seam: true });
    limb(cv, [[CX + 50, 520], [CX + 200, 620], [CX + 270, 830]], 14, 5, { z: 6, claw: 22, seam: true });
    both((s) => enginePod(cv, sx(s, 60), 790, 950, 30, { z: 8 }));
    // Gaster (4 tergites) and the petiole node.
    segment(cv, { y0: 600, y1: 950, hw: (t) => 158 * egg(t, 0.42), ht: (t) => 78 * (0.45 + 0.55 * egg(t, 0.42)), z: 12, plates: 4, lip: 4, margin: 8, seed, film: 0.55 });
    for (let k = 1; k < 4; k++) jointGlow(cv, 600 + (350 * k) / 4, 158 * egg(k / 4, 0.42) * 0.88, 0.45);
    segment(cv, { y0: 545, y1: 625, hw: (t) => 40 * Math.pow(ell(t), 0.6), ht: () => 50, z: 10, seed, film: 0.2 });
    // Mesosoma: a domed pronotum then narrower segments.
    segment(cv, { y0: 290, y1: 560, hw: (t) => (t < 0.55 ? 82 * Math.pow(egg(t / 0.55, 0.5), 0.7) : 60 * Math.pow(ell(0.5 + (t - 0.55) / 0.9), 0.7)), ht: (t) => 68 * (t < 0.55 ? 0.6 + 0.4 * egg(t / 0.55, 0.5) : 0.7), z: 10, margin: 6, seed: seed + 1, film: 0.3, keel: 3 });
    armour(cv, [[CX - 30, 470], [CX + 30, 470], [CX + 26, 545], [CX - 26, 545]], { bolts: 6, panel: 12, seed });
    both((s) => {
        // A cargo / tool rack and cables on the mesosoma.
        graft(cv, boxShape(sx(s, 50), 390, 14, 38, 4), { h: 5, bolts: 4, glow: 0.8, colour: SEAM_VIOLET });
        cables(cv, [[sx(s, 30), 470], [sx(s, 34), 560], [sx(s, 100), 690], [sx(s, 64), 790]], 3, { n: 2, clamp: 40 });
    });
    // The big worker head with manipulator mandibles ending in grafted claws.
    head(cv, 110, 305, 120, { eyeX: 92, eyeY: 205, eyeA: 22, eyeB: 30, seed, h: 56, sensor: 22 });
    both((s) => {
        curvedTube(cv, [sx(s, 60), 135], [sx(s, 150), 80], [sx(s, 70), 30], 24, 12, { z: 30, z1: 26, s: CHITIN, n: 12, film: 0.4 });
        // Grafted tool claws: a steel wrist and two fingers.
        dome(cv, sx(s, 70), 34, 17, { z: 30, h: 10, s: GRAFT });
        emit(cv, circleShape(sx(s, 70), 34, 19), SEAM_PINK, 0.8, 'pulse');
        tube(cv, sx(s, 70), 34, sx(s, 40), 14, 6, 3, { z: 36, s: STEEL });
        tube(cv, sx(s, 70), 34, sx(s, 30), 46, 6, 3, { z: 36, s: STEEL });
    });
    // Elbowed antennae: scape out, funiculus forward.
    both((s) => {
        tube(cv, sx(s, 45), 130, sx(s, 160), 110, 7, 6, { z: 40, s: CHITIN });
        curvedTube(cv, [sx(s, 160), 110], [sx(s, 200), 70], [sx(s, 178), 22], 6, 3, { z: 40, s: CHITIN, n: 10, beads: CHITIN_PURPLE });
        bioLamp(cv, sx(s, 178), 22, 6);
    });
}

function buildExplorer(cv: BioCanvas): void {
    const seed = 67;
    // Four long wings straight out (the hind pair broader at the base).
    wing(cv, [CX + 40, 205], [CX + 460, 175], 62, { z: 4, seed, veins: 7 });
    wing(cv, [CX + 40, 270], [CX + 445, 315], 78, { z: 3, seed: seed + 1, veins: 7 });
    limb(cv, [[CX + 30, 210], [CX + 85, 170], [CX + 92, 130]], 8, 4, { z: 6, claw: 10 });
    limb(cv, [[CX + 34, 250], [CX + 92, 250], [CX + 108, 205]], 8, 4, { z: 6, claw: 10 });
    // The long tail: ten segments, a swelling at the base, claspers and engine pods at the tip.
    both((s) => enginePod(cv, sx(s, 36), 830, 945, 19, { z: 10 }));
    segment(cv, { y0: 300, y1: 905, hw: (t) => 30 + 16 * Math.max(0, 1 - t * 6) + 8 * Math.max(0, (t - 0.86) * 7) - 4 * Math.abs(Math.sin(t * Math.PI * 10)), ht: () => 36, z: 12, plates: 10, lip: 3, margin: 5, seed, film: 0.5, keel: 2 });
    for (let k = 1; k < 10; k++) jointGlow(cv, 300 + (605 * k) / 10, 28, 0.55);
    cables(cv, [[CX, 330], [CX, 830]], 2.6, { n: 1, clamp: 60, glowEnds: false });
    both((s) => tube(cv, sx(s, 14), 895, sx(s, 26), 958, 7, 2, { z: 30, s: CHITIN_PURPLE }));
    // Thorax.
    segment(cv, { y0: 150, y1: 315, hw: (t) => 66 * Math.pow(ell(t), 0.65), ht: () => 66, z: 10, plates: 2, lip: 3, margin: 6, seed: seed + 1, film: 0.2, keel: 3 });
    armour(cv, [[CX - 28, 200], [CX + 28, 200], [CX + 24, 280], [CX - 24, 280]], { bolts: 6, panel: 12, seed });
    // Head: the eyes nearly meet on top.
    segment(cv, { y0: 70, y1: 165, hw: (t) => 70 * Math.pow(ell(t), 0.5), ht: () => 40, z: 12, seed, film: 0.1 });
    both((s) => compoundEye(cv, sx(s, 36), 108, 40, 44, { z: 24, seed: seed + (s > 0 ? 3 : 4), glow: 0.4 }));
    sensorCluster(cv, CX, 150, 12, { lenses: 4 });
    // Long sensor feelers.
    antennae(cv, 12, 75, 40, 20, 120, 14, 3.5);
}

function buildFreighter(cv: BioCanvas): void {
    const seed = 79;
    // Eight legs from the front half.
    limb(cv, [[CX + 150, 280], [CX + 270, 220], [CX + 330, 130]], 17, 7, { z: 6, claw: 16, seam: true });
    limb(cv, [[CX + 190, 340], [CX + 320, 330], [CX + 390, 380]], 17, 7, { z: 6, claw: 16, seam: true });
    limb(cv, [[CX + 200, 410], [CX + 320, 480], [CX + 370, 570]], 17, 7, { z: 6, claw: 16, seam: true });
    limb(cv, [[CX + 190, 470], [CX + 280, 590], [CX + 300, 720]], 17, 7, { z: 6, claw: 16, seam: true });
    both((s) => enginePod(cv, sx(s, 80), 790, 955, 32, { z: 8 }));
    // The swollen body (leathery chitin with growth wrinkles) and its festooned aft margin.
    segment(cv, { y0: 150, y1: 920, hw: (t) => 265 * egg(t, 0.6) * (1 - 0.035 * Math.max(0, t - 0.75) * Math.abs(Math.sin(t * 90))), ht: (t) => 120 * (0.4 + 0.6 * egg(t, 0.58)), pow: 2, z: 10, margin: 12, seed, film: 0.5, s: CHITIN_PURPLE });
    for (let k = 0; k < 9; k++) {
        const a = Math.PI * (0.18 + (0.64 * k) / 8);
        carve(cv, capsuleShape(CX + Math.cos(a) * 250, 600 + Math.sin(a) * 300, CX + Math.cos(a) * 218, 600 + Math.sin(a) * 262, 2), 2, 1.5, MARGIN_PURPLE, 0.25);
    }
    // Scutum shield on the front.
    segment(cv, { y0: 160, y1: 430, hw: (t) => 180 * Math.pow(egg(t, 0.35), 0.8), ht: () => 30, z: 0, mode: 'add', margin: 10, seed: seed + 1, film: 0.2 });
    // Strapped cargo sacs.
    const sacs: [number, number, number, number][] = [
        [0, 560, 120, 150],
        [150, 520, 70, 110],
        [-150, 520, 70, 110],
        [120, 730, 78, 90],
        [-120, 730, 78, 90],
    ];
    for (const [dx, y, a, b] of sacs) {
        const z = cv.heightAt(CX + dx, y) - 8;
        volume(cv, ellipseShape(CX + dx, y, a, b), { z, h: Math.min(a, b) * 0.55, bevel: Math.min(a, b) * 0.9, prof: 'round', s: FLESH_DARK, mode: 'max' });
        emit(cv, ellipseShape(CX + dx, y, a * 0.55, b * 0.55), SEAM_VIOLET, 0.22, 'pulse', Math.min(a, b) * 0.5);
        // Straps across and along the sac.
        tube(cv, CX + dx - a, y, CX + dx + a, y, 4.5, 4.5, { z: 1, s: GRAFT_DARK, mode: 'add' });
        tube(cv, CX + dx, y - b, CX + dx, y + b, 4.5, 4.5, { z: 1, s: GRAFT_DARK, mode: 'add' });
        dome(cv, CX + dx, y, 12, { z: cv.heightAt(CX + dx, y), h: 4, s: STEEL, mode: 'over' });
    }
    // Capitulum with chelicerae.
    segment(cv, { y0: 70, y1: 180, hw: (t) => 52 * Math.pow(ell(t), 0.6), ht: () => 44, z: 12, margin: 5, seed, film: 0.1 });
    both((s) => tube(cv, sx(s, 18), 120, sx(s, 22), 40, 11, 4, { z: 38, s: CHITIN_PURPLE }));
    sensorCluster(cv, CX, 125, 16, { lenses: 4 });
    both((s) => {
        armour(cv, [[sx(s, 40), 220], [sx(s, 120), 230], [sx(s, 110), 330], [sx(s, 40), 340]], { bolts: 6, panel: 16, seed: seed + (s > 0 ? 1 : 2) });
        cables(cv, [[sx(s, 90), 330], [sx(s, 210), 520], [sx(s, 120), 800]], 3.4, { n: 3, clamp: 50 });
    });
}

function buildTreasure(cv: BioCanvas): void {
    const seed = 97;
    // Small legs at the thorax.
    limb(cv, [[CX + 60, 175], [CX + 150, 140], [CX + 175, 80]], 14, 6, { z: 6, claw: 14, seam: true });
    limb(cv, [[CX + 65, 215], [CX + 165, 225], [CX + 195, 290]], 14, 6, { z: 6, claw: 14, seam: true });
    for (const dx of [80, 200]) both((s) => enginePod(cv, sx(s, dx), 820, 965, 36, { z: 8 }));
    // The enormous abdomen: stretched glowing flesh membrane carrying dark armour bands.
    const y0 = 215;
    const y1 = 935;
    const hw = (t: number): number => 340 * egg(t, 0.5) * (t < 0.06 ? Math.sqrt(t / 0.06) : 1);
    segment(cv, { y0, y1, hw, ht: (t) => 120 * (0.4 + 0.6 * egg(t, 0.5)), pow: 2.2, z: 10, seed, s: FLESH_DARK, film: 0.2 });
    emit(cv, ellipseShape(CX, (y0 + y1) / 2, 330, 350), SEAM_PINK, 0.3, 'pulse', 120);
    const bands = 9;
    for (let k = 0; k < bands; k++) {
        const ta = (k + 0.08) / bands;
        const tb = (k + 0.93) / bands;
        const ya = y0 + (y1 - y0) * ta;
        const yb = y0 + (y1 - y0) * tb;
        // Each band: a central tergite plate and two side plates (islands on the membrane).
        segment(cv, { y0: ya, y1: yb, hw: (t) => hw(ta + (tb - ta) * t) * 0.42 * Math.pow(ell(t), 0.25), ht: () => 14, z: 2, mode: 'add', margin: 4, seed: seed + k, film: 0.4 + k * 0.13, plates: 1 });
        both((s) => {
            const wm = hw((ta + tb) / 2);
            volume(cv, polyShape([[sx(s, wm * 0.45), ya + 2], [sx(s, wm * 0.93), ya + 8], [sx(s, wm * 0.93), yb - 6], [sx(s, wm * 0.45), yb]]), { z: 1, h: 12, bevel: 6, s: CHITIN, mode: 'add', onHull: true, film: 0.3 + k * 0.11 });
            if (k % 2 === 1) graft(cv, boxShape(sx(s, wm * 0.64), (ya + yb) / 2, wm * 0.1, (yb - ya) * 0.28, 3), { h: 5, bolts: 4, glow: 0.8, seed: k });
        });
        if (k % 3 === 1) sensorCluster(cv, CX, (ya + yb) / 2, 18, { lenses: 5 });
    }
    // Brood sacs along the flanks.
    both((s) => {
        for (const [dy, r] of [[420, 40], [560, 46], [700, 40]] as const) {
            const x = sx(s, hw((dy - y0) / (y1 - y0)) * 0.97);
            volume(cv, circleShape(x, dy, r), { z: 20, h: r * 0.8, bevel: r, s: FLESH, film: 0.1 });
            emit(cv, circleShape(x, dy, r * 0.7), SEAM_VIOLET, 0.55, 'pulse', r * 0.5);
            tube(cv, x - r, dy, x + r, dy, 5, 5, { z: 1, s: GRAFT_DARK, mode: 'add' });
        }
        cables(cv, [[sx(s, 70), 230], [sx(s, 130), 420], [sx(s, 140), 650], [sx(s, 80), 820]], 4, { n: 3, clamp: 50 });
    });
    // Thorax and head.
    segment(cv, { y0: 120, y1: 250, hw: (t) => 104 * Math.pow(ell(t), 0.7), ht: () => 62, z: 12, plates: 2, lip: 3, margin: 7, seed: seed + 1, film: 0.2, keel: 3 });
    armour(cv, [[CX - 40, 150], [CX + 40, 150], [CX + 34, 230], [CX - 34, 230]], { bolts: 6, panel: 14, seed });
    head(cv, 40, 135, 82, { eyeX: 54, eyeY: 82, eyeA: 22, eyeB: 30, seed, h: 40 });
    mandibles(cv, 28, 52, 70, 24, 16, 12, 12);
}

// ---------------------------------------------------------------------------------------------------------------
// Hives
// ---------------------------------------------------------------------------------------------------------------

/** A grafted docking arm from (x0, y0) out to (x1, y1): banded metal boom, cables, a fleshy socket, a chitin clamp. */
function dockArm(cv: BioCanvas, x0: number, y0: number, x1: number, y1: number, w: number): void {
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / L;
    const uy = (y1 - y0) / L;
    const nx = -uy;
    const ny = ux;
    tube(cv, x0, y0, x1, y1, w, w * 0.8, { z: 14, s: GRAFT, bands: 6, bandSurf: GRAFT_DARK });
    for (const o of [-1, 1]) tube(cv, x0 + nx * w * 1.2 * o, y0 + ny * w * 1.2 * o, x1 - ux * w * 2 + nx * w * 1.1 * o, y1 - uy * w * 2 + ny * w * 1.1 * o, w * 0.28, w * 0.28, { z: 10, s: CABLE });
    // Socket at the root.
    volume(cv, circleShape(x0, y0, w * 2), { z: 18, h: w * 1.2, bevel: w * 1.4, s: FLESH_DARK });
    emit(cv, circleShape(x0, y0, w * 1.9), SEAM_PINK, 0.8, 'pulse', w * 0.6);
    // The clamp: two curved chitin claws around a docking ring.
    const cx = x1;
    const cy = y1;
    volume(cv, circleShape(cx, cy, w * 1.5), { z: 14, h: w * 1.1, bevel: w, s: GRAFT_DARK });
    carve(cv, circleShape(cx, cy, w * 0.8), 6, 3, FLESH_DARK, 0.1);
    emit(cv, circleShape(cx, cy, w * 0.7), SEAM_VIOLET, 0.9, 'pulse', w * 0.3);
    for (const o of [-1, 1]) {
        const p0: [number, number] = [cx + nx * w * 1.2 * o, cy + ny * w * 1.2 * o];
        const p1: [number, number] = [cx + ux * w * 2.4 + nx * w * 3 * o, cy + uy * w * 2.4 + ny * w * 3 * o];
        const p2: [number, number] = [cx + ux * w * 4 + nx * w * 0.6 * o, cy + uy * w * 4 + ny * w * 0.6 * o];
        curvedTube(cv, p0, p1, p2, w * 0.7, w * 0.15, { z: 20, s: CHITIN, n: 8, film: 0.3 });
    }
    bioLamp(cv, cx + ux * w * 1.6, cy + uy * w * 1.6, Math.max(4, w * 0.35));
}

function hiveMound(cv: BioCanvas, cx: number, cy: number, r: number, seed: number, h: number): void {
    volume(cv, circleShape(cx, cy, r), { z: 10, h, bevel: r * 0.9, prof: 'round', s: COMB, film: 0.2 });
    comb(cv, circleShape(cx, cy, r * 0.97), Math.max(11, r * 0.075), { h: 8, seed, lit: 0.05, capped: 0.45, mode: 'add' });
    // Chitin rim plates around the mound.
    for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const x = cx + Math.cos(a) * r * 0.98;
        const y = cy + Math.sin(a) * r * 0.98;
        volume(cv, ellipseShape(x, y, r * 0.16, r * 0.1), { z: 12, h: 20, bevel: 14, s: k % 2 ? CHITIN : CHITIN_PURPLE, film: k * 0.17 });
    }
}

function buildPort(cv: BioCanvas): void {
    const seed = 113;
    const C = 500;
    // Six docking arms (mirror pairs) and buttress roots between them.
    const arms: [number, number][] = [
        [-1.45, 420],
        [-0.55, 440],
        [0.55, 440],
        [1.45, 420],
        [2.3, 420],
        [-2.3, 420],
    ];
    for (const [a, L] of arms) dockArm(cv, C + Math.cos(a - Math.PI / 2) * 250, C + Math.sin(a - Math.PI / 2) * 250, C + Math.cos(a - Math.PI / 2) * L, C + Math.sin(a - Math.PI / 2) * L, 18);
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const x1 = C + Math.cos(a) * 380;
        const y1 = C + Math.sin(a) * 380;
        tube(cv, C + Math.cos(a) * 200, C + Math.sin(a) * 200, x1, y1, 34, 8, { z: 8, s: CHITIN, film: k * 0.2 });
        dome(cv, x1, y1, 12, { z: 12, h: 10, s: CHITIN_PURPLE });
    }
    hiveMound(cv, C, C, 290, seed, 110);
    // Inner ring of chitin plates and the central spire of sensor clusters.
    for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
        const x = C + Math.cos(a) * 150;
        const y = C + Math.sin(a) * 150;
        graft(cv, ellipseShape(x, y, 34, 22), { h: 6, bolts: 5, glow: 0.9, colour: k % 2 ? SEAM_VIOLET : SEAM_PINK, seed: k });
    }
    volume(cv, circleShape(C, C, 95), { z: 100, h: 46, bevel: 80, s: CHITIN, film: 0.3 });
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        segment(cv, { cx: C + Math.cos(a) * 60, y0: C + Math.sin(a) * 60 - 26, y1: C + Math.sin(a) * 60 + 26, hw: (t) => 22 * ell(t), ht: () => 20, z: cv.heightAt(C + Math.cos(a) * 60, C + Math.sin(a) * 60) - 4, margin: 4, seed: seed + k, film: k * 0.2 });
    }
    sensorCluster(cv, C, C, 34, { lenses: 7 });
    for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        bioLamp(cv, C + Math.cos(a) * 225, C + Math.sin(a) * 225, 7);
    }
}

function buildBase(cv: BioCanvas): void {
    const seed = 131;
    const C = 500;
    for (const a of [-0.9, 0.9, Math.PI - 0.7, Math.PI + 0.7]) dockArm(cv, C + Math.sin(a) * 180, C - Math.cos(a) * 180, C + Math.sin(a) * 400, C - Math.cos(a) * 400, 17);
    // Three overlapping comb mounds (a small cluster), the fore one tallest.
    hiveMound(cv, C - 120, C + 70, 165, seed, 80);
    hiveMound(cv, C + 120, C + 70, 165, seed + 1, 80);
    hiveMound(cv, C, C - 70, 200, seed + 2, 110);
    for (const [dx, dy] of [[0, -70], [-120, 90], [120, 90]] as const) sensorCluster(cv, C + dx, C + dy, 26, { lenses: 6 });
    both((s) => cables(cv, [[sx(s, 60), 560], [sx(s, 150), 640], [sx(s, 250), 620]], 4, { n: 3, clamp: 40 }));
}

const BUILDERS: Readonly<Record<ConcordHullKind, (cv: BioCanvas) => void>> = {
    frigate: buildFrigate,
    destroyer: buildDestroyer,
    battleship: buildBattleship,
    carrier: buildCarrier,
    freighter: buildFreighter,
    explorer: buildExplorer,
    construction: buildConstruction,
    treasure: buildTreasure,
    port: buildPort,
    base: buildBase,
};

/** A kind's full drawing. */
export interface ConcordHullDrawing extends BioRender {
    /** Nozzle sites (units → px: × side / 1000). */
    nozzles: Nozzle[];
    /** Bioluminescent lamp points. */
    lamps: Nozzle[];
}

/** Draw one kind at `side` px (bow up, symmetric about the vertical axis): the lit RGBA image. Pure; deterministic. */
export function drawConcordHull(kind: ConcordHullKind, side: number): ConcordHullDrawing {
    const cv = new BioCanvas(side);
    BUILDERS[kind](cv);
    const r = renderBio(cv, { seed: 1000 + Object.keys(BUILDERS).indexOf(kind) * 131 });
    return { ...r, nozzles: cv.nozzles.slice(), lamps: cv.lamps.slice() };
}
