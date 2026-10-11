// [charactersVictory] Our own procedural art for the Interstellar Diet (no original image): the domed-hall glyph of the
// top-bar button and the map marks — the host world's seat icon and the enforcer fleets' shield emblem — drawn with
// Pixi Graphics at a constant screen size (`z` = camera zoom).

import type { Graphics } from 'pixi.js';

/** The top-bar glyph: a domed hall on a stepped base with four columns (white on the glass button). */
export const DIET_GLYPH_SVG =
    '<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" style="display:block;margin:auto">' +
    '<path d="M6 13 Q16 2 26 13 Z" fill="#d8d8e0"/>' +
    '<rect x="5" y="13" width="22" height="2" fill="#d8d8e0"/>' +
    '<rect x="7" y="16" width="2.4" height="8" fill="#b8b8c4"/><rect x="12" y="16" width="2.4" height="8" fill="#b8b8c4"/>' +
    '<rect x="17.6" y="16" width="2.4" height="8" fill="#b8b8c4"/><rect x="22.6" y="16" width="2.4" height="8" fill="#b8b8c4"/>' +
    '<rect x="4" y="24.5" width="24" height="2" fill="#d8d8e0"/><rect x="3" y="27" width="26" height="2" fill="#a0a0ac"/>' +
    '<circle cx="16" cy="5" r="1.4" fill="#ffd24a"/></svg>';

/** The seat colour (violet gold) and the enforcers' (steel blue with a gold rim). */
export const DIET_SEAT_COLOR = 0xc8a0ff;
export const DIET_ENFORCER_COLOR = 0x5aa0ff;
export const DIET_GOLD = 0xffd24a;

/** The host world's seat: a small domed hall above the planet, in a ring (pulsing brighter while in session). */
export function drawDietSeat(g: Graphics, x: number, y: number, z: number, inSession: boolean, pulse: number): void {
    const s = 1 / z;
    const cy = y - 26 * s;
    const ring = (inSession ? 15 + 2 * pulse : 14) * s;
    g.circle(x, cy, ring).fill({ color: 0x101018, alpha: 0.7 }).stroke({ width: 1.6 * s, color: DIET_SEAT_COLOR, alpha: inSession ? 0.7 + 0.3 * pulse : 0.8 });
    // Dome.
    g.moveTo(x - 9 * s, cy - 1 * s)
        .quadraticCurveTo(x, cy - 15 * s, x + 9 * s, cy - 1 * s)
        .closePath()
        .fill({ color: DIET_SEAT_COLOR, alpha: 0.95 });
    g.rect(x - 10 * s, cy - 1 * s, 20 * s, 2 * s).fill({ color: 0xe8e0ff });
    for (const cx of [-7, -2.5, 2, 6.5]) g.rect(x + cx * s, cy + 2 * s, 1.6 * s, 6 * s).fill({ color: 0xd0c8f0 });
    g.rect(x - 11 * s, cy + 8.5 * s, 22 * s, 2 * s).fill({ color: 0xe8e0ff });
    g.circle(x, cy - 12.5 * s, 1.4 * s).fill({ color: DIET_GOLD });
    // A thin tether to the planet.
    g.moveTo(x, cy + ring).lineTo(x, y - 6 * s).stroke({ width: 1 * s, color: DIET_SEAT_COLOR, alpha: 0.6 });
}

/** The enforcers' emblem beside the fleet's lead ship: a shield with a gold chevron and a star. */
export function drawEnforcerEmblem(g: Graphics, x: number, y: number, z: number): void {
    const s = 1 / z;
    const ox = x + 14 * s;
    const oy = y - 16 * s;
    g.moveTo(ox - 7 * s, oy - 8 * s)
        .lineTo(ox + 7 * s, oy - 8 * s)
        .lineTo(ox + 7 * s, oy + 1 * s)
        .quadraticCurveTo(ox + 6 * s, oy + 7 * s, ox, oy + 10 * s)
        .quadraticCurveTo(ox - 6 * s, oy + 7 * s, ox - 7 * s, oy + 1 * s)
        .closePath()
        .fill({ color: 0x0c1830, alpha: 0.9 })
        .stroke({ width: 1.5 * s, color: DIET_GOLD, alpha: 1 });
    g.moveTo(ox - 4.5 * s, oy + 2 * s)
        .lineTo(ox, oy - 2 * s)
        .lineTo(ox + 4.5 * s, oy + 2 * s)
        .stroke({ width: 1.8 * s, color: DIET_ENFORCER_COLOR, alpha: 1 });
    star(g, ox, oy - 4.8 * s, 2.4 * s);
    g.fill({ color: DIET_GOLD });
}

function star(g: Graphics, x: number, y: number, r: number): void {
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r : r * 0.45;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
    }
    g.closePath();
}
