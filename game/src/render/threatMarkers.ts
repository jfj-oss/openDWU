// 19r item 4 — threat site markers by reveal level (the 19f threats' discovery: threatKnownSites, framework.ts
// knowledge levels 1 rumour / 2 suspected / 3 confirmed). Suspected sites draw uncertain (broken strokes, a flicker,
// lower alpha, a small "?"); confirmed ones solid. One look per threat:
//   greyTide   ash cloud (Grey Tide nest)          cult        violet ring + glyph (cult world)
//   silence    pulsing dead-signal circle          doppelgangers  mirrored double outline (sleeper ship)
//   hive       hex lattice tint (Hive world)        darkFarms   red pulse (Dark Farm)
//   exchange   ledger-and-scales icon (Exchange station)
//   giantworks         the Great Work's site: four stage arcs filling with its progress, a crane over it (a star
//                      once complete) — the structure itself is no secret, so it is drawn solid from the rumour on
//   giantworksCompact  the Founders' Compact emblem over a founding world: three linked rings in a seal (faint and
//                      uncertain at rumour level)
// Unknown threat keys fall back to the framework's ring (colony) / diamond (ship). Pure selection + geometry here;
// drawThreatMarker issues the Pixi Graphics calls.

import type { Graphics } from 'pixi.js';

export const KNOWLEDGE_RUMOUR = 1;
export const KNOWLEDGE_SUSPECTED = 2;
export const KNOWLEDGE_CONFIRMED = 3;

export type ThreatMarkerKind = 'ash' | 'cultRing' | 'deadSignal' | 'mirror' | 'hex' | 'redPulse' | 'ledger' | 'greatWork' | 'compact' | 'ring' | 'diamond';

/** Giantworks' site rows (threatKnownSites): the Great Work itself, and each founding world of the Compact. */
export const GW_SITE_THREAT = 'giantworks';
export const GW_COMPACT_THREAT = 'giantworksCompact';

/** The seven threat looks by threat key (the 19f modules' *_KEY constants). */
export const THREAT_MARKER_KINDS: Readonly<Record<string, ThreatMarkerKind>> = {
    greyTide: 'ash',
    cult: 'cultRing',
    silence: 'deadSignal',
    doppelgangers: 'mirror',
    hive: 'hex',
    darkFarms: 'redPulse',
    exchange: 'ledger',
    [GW_SITE_THREAT]: 'greatWork',
    [GW_COMPACT_THREAT]: 'compact',
};

export const THREAT_MARKER_COLOURS: Readonly<Record<ThreatMarkerKind, number>> = {
    ash: 0x9a948c,
    cultRing: 0xa050ff,
    deadSignal: 0x7fd8ff,
    mirror: 0xe8e8ff,
    hex: 0xe0c020,
    redPulse: 0xff3030,
    ledger: 0x40d890,
    greatWork: 0xffc04a,
    compact: 0xe6d08c,
    ring: 0xffa020,
    diamond: 0xffa020,
};

export interface ThreatMarkerStyle {
    kind: ThreatMarkerKind;
    colour: number;
    /** Confirmed (solid) vs suspected (uncertain). */
    solid: boolean;
    /** Base alpha (suspected draws fainter). */
    alpha: number;
    /** Dash pattern for strokes: 0 = continuous, else segments per circle. */
    dashes: number;
    /** greatWork: the site's stage (0..4) and progress (0..1), set by the layer from the site each frame. */
    stage?: number;
    progress?: number;
}

/**
 * The marker a site gets at `level` (null below suspected: rumours are not drawn). `kind` = the site kind
 * ('colony' | 'ship') for the fallback shape.
 */
export function threatMarkerStyle(threat: string, level: number, kind: 'colony' | 'ship'): ThreatMarkerStyle | null {
    const k = (Object.hasOwn(THREAT_MARKER_KINDS, threat) ? THREAT_MARKER_KINDS[threat] : undefined) ?? (kind === 'ship' ? 'diamond' : 'ring');
    // Giantworks: the site and the Compact's founders are marked from the rumour on (the site always solid).
    if (k === 'greatWork') return level >= KNOWLEDGE_RUMOUR ? { kind: k, colour: THREAT_MARKER_COLOURS[k], solid: true, alpha: 1, dashes: 0 } : null;
    if (k === 'compact') {
        if (!(level >= KNOWLEDGE_RUMOUR)) return null;
        const sure = level >= KNOWLEDGE_SUSPECTED;
        return { kind: k, colour: THREAT_MARKER_COLOURS[k], solid: sure, alpha: sure ? 0.9 : 0.55, dashes: sure ? 0 : 18 };
    }
    if (!(level >= KNOWLEDGE_SUSPECTED)) return null;
    const solid = level >= KNOWLEDGE_CONFIRMED;
    let colour = THREAT_MARKER_COLOURS[k];
    if ((k === 'ring' || k === 'diamond') && solid) colour = 0xff3030;
    return { kind: k, colour, solid, alpha: solid ? 1 : 0.8, dashes: solid ? 0 : 14 };
}

/** Suspected markers flicker (0.55-1 × alpha); confirmed ones are steady (1). `t` in seconds. */
export function uncertaintyFlicker(solid: boolean, t: number, seed: number): number {
    if (solid) return 1;
    const a = Math.sin(t * 2.3 + seed) * 0.5 + 0.5;
    const b = Math.sin(t * 5.1 + seed * 1.7) * 0.5 + 0.5;
    return 0.55 + 0.45 * (0.6 * a + 0.4 * b);
}

/** A 0-1 pulse of period `period` s (dead-signal / red pulse rings). */
export function pulsePhase(t: number, period: number): number {
    const p = (t / period) % 1;
    return p < 0 ? p + 1 : p;
}

/** Hex lattice cell centres (pointy-top, cell radius `cell`) whose cell lies within `r` of the origin. */
export function hexLatticeCentres(r: number, cell: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    const dx = Math.sqrt(3) * cell;
    const dy = 1.5 * cell;
    const rows = Math.ceil(r / dy) + 1;
    for (let j = -rows; j <= rows; j++) {
        const off = (j & 1) === 0 ? 0 : dx / 2;
        const cols = Math.ceil(r / dx) + 1;
        for (let i = -cols; i <= cols; i++) {
            const x = i * dx + off;
            const y = j * dy;
            if (Math.hypot(x, y) + cell * 0.5 <= r) out.push({ x, y });
        }
    }
    return out;
}

/** Deterministic ash-cloud puffs (offsets and radii relative to r). */
export function ashPuffs(seed: number, n = 9): { x: number; y: number; r: number }[] {
    const out: { x: number; y: number; r: number }[] = [];
    let s = (seed * 2654435761) >>> 0;
    const rnd = (): number => {
        s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
        return s / 4294967296;
    };
    for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rnd() * 0.6;
        const d = 0.35 + rnd() * 0.45;
        out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.28 + rnd() * 0.22 });
    }
    return out;
}

function strokeCircle(g: Graphics, x: number, y: number, r: number, width: number, colour: number, alpha: number, dashes: number, phase = 0): void {
    if (dashes <= 0) {
        g.circle(x, y, r).stroke({ width, color: colour, alpha });
        return;
    }
    const step = (Math.PI * 2) / dashes;
    for (let k = 0; k < dashes; k++) {
        const a0 = k * step + phase;
        g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
        g.arc(x, y, r, a0, a0 + step * 0.55);
    }
    g.stroke({ width, color: colour, alpha });
}

function questionMark(g: Graphics, x: number, y: number, s: number, colour: number, alpha: number, w: number): void {
    g.moveTo(x - s * 0.5, y - s * 0.4).arc(x, y - s * 0.4, s * 0.5, Math.PI, Math.PI * 2.35).lineTo(x, y + s * 0.35).stroke({ width: w, color: colour, alpha });
    g.circle(x, y + s * 0.8, w * 0.7).fill({ color: colour, alpha });
}

/**
 * Draws one marker at world (x, y) around a target of radius `r` (world units) at zoom z (px per world unit); `t` is
 * the render clock in seconds, `seed` varies flicker / ash per site.
 */
export function drawThreatMarker(g: Graphics, st: ThreatMarkerStyle, x: number, y: number, r: number, z: number, t: number, seed: number): void {
    const px = 1 / z;
    const a = st.alpha * uncertaintyFlicker(st.solid, t, seed);
    const c = st.colour;
    const w = (st.solid ? 2.5 : 2) * px;
    const dashes = st.dashes;
    switch (st.kind) {
        case 'ash': {
            for (const p of ashPuffs(seed)) g.circle(x + p.x * r, y + p.y * r, p.r * r).fill({ color: 0x3a3632, alpha: (st.solid ? 0.38 : 0.2) * a });
            for (const p of ashPuffs(seed + 1, 6)) g.circle(x + p.x * r * 0.8, y + p.y * r * 0.8, p.r * r * 0.7).fill({ color: c, alpha: (st.solid ? 0.26 : 0.14) * a });
            strokeCircle(g, x, y, r * 1.05, w, c, 0.7 * a, dashes, t * 0.2);
            break;
        }
        case 'cultRing': {
            strokeCircle(g, x, y, r, w * 1.3, c, a, dashes, t * 0.3);
            strokeCircle(g, x, y, r * 1.14, w * 0.6, c, 0.6 * a, dashes, -t * 0.3);
            // Glyph: an eye of three strokes over the ring's top.
            const gx = x;
            const gy = y - r * 1.14;
            const s = Math.max(6 * px, r * 0.22);
            g.moveTo(gx - s, gy).quadraticCurveTo(gx, gy - s * 0.9, gx + s, gy).quadraticCurveTo(gx, gy + s * 0.9, gx - s, gy).stroke({ width: w, color: c, alpha: a });
            g.circle(gx, gy, s * 0.3).fill({ color: c, alpha: a });
            break;
        }
        case 'deadSignal': {
            const p = pulsePhase(t, 2.4);
            strokeCircle(g, x, y, r, w, c, 0.9 * a, dashes);
            // Rings contracting inward (a signal going dead), fading as they shrink.
            for (let k = 0; k < 3; k++) {
                const q = (p + k / 3) % 1;
                strokeCircle(g, x, y, r * (1.6 - 0.9 * q), w * 0.8, c, a * q * 0.6, dashes);
            }
            // Flat-line bar through the centre.
            g.moveTo(x - r * 0.5, y).lineTo(x - r * 0.12, y).lineTo(x - r * 0.05, y - r * 0.18).lineTo(x + r * 0.05, y + r * 0.1).lineTo(x + r * 0.12, y).lineTo(x + r * 0.5, y).stroke({ width: w, color: c, alpha: a });
            break;
        }
        case 'mirror': {
            // Two diamond outlines, one offset and mirrored: a ship that is not what it seems.
            const d = r * 0.9;
            const o = r * 0.28;
            const dia = (cx: number, cy: number, alpha: number): void => {
                g.moveTo(cx, cy - d).lineTo(cx + d * 0.7, cy).lineTo(cx, cy + d).lineTo(cx - d * 0.7, cy).closePath().stroke({ width: w, color: c, alpha });
            };
            dia(x - o, y, a);
            dia(x + o, y, a * (st.solid ? 0.85 : 0.45));
            g.moveTo(x, y - d * 1.2).lineTo(x, y + d * 1.2).stroke({ width: w * 0.5, color: c, alpha: 0.5 * a });
            break;
        }
        case 'hex': {
            const cell = Math.max(5 * px, r / 5);
            for (const h of hexLatticeCentres(r, cell)) {
                const hx = x + h.x;
                const hy = y + h.y;
                g.moveTo(hx + cell * 0.866, hy - cell * 0.5);
                for (let k = 1; k <= 6; k++) {
                    const ang = -Math.PI / 6 + (k * Math.PI) / 3;
                    g.lineTo(hx + Math.cos(ang) * cell, hy + Math.sin(ang) * cell);
                }
            }
            g.fill({ color: c, alpha: (st.solid ? 0.16 : 0.08) * a }).stroke({ width: w * 0.5, color: c, alpha: 0.55 * a });
            strokeCircle(g, x, y, r, w, c, a, dashes);
            break;
        }
        case 'redPulse': {
            const p = pulsePhase(t, 1.4);
            g.circle(x, y, r * 0.9).fill({ color: c, alpha: (st.solid ? 0.18 : 0.08) * a * (1 - p * 0.6) });
            strokeCircle(g, x, y, r, w * 1.2, c, a, dashes);
            strokeCircle(g, x, y, r * (1 + 0.6 * p), w, c, a * (1 - p), dashes);
            break;
        }
        case 'ledger': {
            strokeCircle(g, x, y, r, w, c, a, dashes);
            // Scales over a ledger: a beam with two pans above a closed book.
            const s = Math.max(9 * px, r * 0.45);
            const bx = x;
            const by = y - r - s * 1.1;
            g.moveTo(bx, by - s * 0.6).lineTo(bx, by + s * 0.3).stroke({ width: w, color: c, alpha: a });
            g.moveTo(bx - s, by - s * 0.45).lineTo(bx + s, by - s * 0.45).stroke({ width: w, color: c, alpha: a });
            for (const sx of [-1, 1]) {
                g.moveTo(bx + sx * s, by - s * 0.45).lineTo(bx + sx * s * 0.7, by).lineTo(bx + sx * s * 1.3, by).closePath().stroke({ width: w * 0.8, color: c, alpha: a });
            }
            g.rect(bx - s * 0.7, by + s * 0.3, s * 1.4, s * 0.55).fill({ color: c, alpha: 0.35 * a }).stroke({ width: w * 0.8, color: c, alpha: a });
            g.moveTo(bx, by + s * 0.3).lineTo(bx, by + s * 0.85).stroke({ width: w * 0.6, color: 0x0a1a10, alpha: a });
            break;
        }
        case 'greatWork': {
            // Four stage arcs round the site (Foundations, Frame, Superstructure, Fitting), filled with the progress.
            const prog = Math.max(0, Math.min(1, st.progress ?? (st.stage ?? 0) / 4));
            const gap = 0.12;
            g.circle(x, y, r).stroke({ width: w * 0.6, color: c, alpha: 0.25 * a });
            for (let q = 0; q < 4; q++) {
                const fill = greatWorkArcFill(prog, q);
                if (fill <= 0) continue;
                const a0 = -Math.PI / 2 + (q * Math.PI) / 2 + gap;
                const a1 = a0 + (Math.PI / 2 - 2 * gap) * fill;
                g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r).arc(x, y, r, a0, a1).stroke({ width: w * 1.6, color: c, alpha: a });
            }
            const s = Math.min(16 * px, Math.max(7 * px, r * 0.3));
            const gx = x;
            const gy = y - r - s * 0.9;
            if ((st.stage ?? 0) >= 4) {
                // complete: a four-point star
                g.moveTo(gx, gy - s).lineTo(gx + s * 0.25, gy - s * 0.25).lineTo(gx + s, gy).lineTo(gx + s * 0.25, gy + s * 0.25).lineTo(gx, gy + s).lineTo(gx - s * 0.25, gy + s * 0.25).lineTo(gx - s, gy).lineTo(gx - s * 0.25, gy - s * 0.25).closePath().fill({ color: c, alpha: a });
            } else {
                // a construction crane: mast, jib, counter-jib, the hook line
                g.moveTo(gx - s * 0.2, gy + s * 0.7).lineTo(gx - s * 0.2, gy - s * 0.6).stroke({ width: w, color: c, alpha: a });
                g.moveTo(gx - s * 0.75, gy - s * 0.6).lineTo(gx + s * 0.95, gy - s * 0.6).stroke({ width: w, color: c, alpha: a });
                g.moveTo(gx - s * 0.2, gy - s * 0.95).lineTo(gx + s * 0.95, gy - s * 0.6).stroke({ width: w * 0.6, color: c, alpha: a });
                g.moveTo(gx + s * 0.7, gy - s * 0.6).lineTo(gx + s * 0.7, gy + s * 0.05).stroke({ width: w * 0.6, color: c, alpha: a });
                g.rect(gx - s * 0.75, gy - s * 0.66, s * 0.25, s * 0.22).fill({ color: c, alpha: a });
            }
            break;
        }
        case 'compact': {
            // The Founders' Compact: three linked rings (the three founding circles) in a seal.
            strokeCircle(g, x, y, r, w, c, a, dashes, t * 0.15);
            const s = Math.max(9 * px, r * 0.5);
            const cx = x + r * 0.72;
            const cy = y - r * 0.72;
            g.circle(cx, cy, s * 1.05).fill({ color: 0x0c0a06, alpha: 0.55 * a });
            for (let k = 0; k < 3; k++) {
                const ang = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
                g.circle(cx + Math.cos(ang) * s * 0.36, cy + Math.sin(ang) * s * 0.36, s * 0.42).stroke({ width: w * 0.8, color: c, alpha: a });
            }
            g.circle(cx, cy, s * 1.05).stroke({ width: w * 0.6, color: c, alpha: 0.8 * a });
            break;
        }
        case 'diamond': {
            g.moveTo(x, y - r).lineTo(x + r, y).lineTo(x, y + r).lineTo(x - r, y).closePath().stroke({ width: w, color: c, alpha: a });
            break;
        }
        default: {
            strokeCircle(g, x, y, r, w * 1.2, c, a, dashes);
            strokeCircle(g, x, y, r + 5 * px, w * 0.5, c, 0.6 * a, dashes);
        }
    }
    // (The Compact's seal sits where the others put the "?": its "?" goes top left.)
    if (!st.solid) questionMark(g, x + (st.kind === 'compact' ? -r : r) * 0.95, y - r * 0.95, Math.max(7 * px, r * 0.18), c, a, w * 0.8);
}

/** How full stage arc `q` (0..3) of a Great Work's glyph is at `progress` (0..1). Pure. */
export function greatWorkArcFill(progress: number, q: number): number {
    return Math.max(0, Math.min(1, progress * 4 - q));
}
