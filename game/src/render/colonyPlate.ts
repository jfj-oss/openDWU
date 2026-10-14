// The colony plate the original draws beside a populated colony when zoomed right in (Main View zoom < 2): a hexagon
// whose top half is the empire's colour with the colony name (and the capital / secondary-capital icon), and whose
// bottom half shows the dominant race's portrait, the population / development bars and the known resources.
// Port of Controls/MainView.1.cs method_89 (the bitmap, built with GDI+) drawn by method_86 (centred on the right
// edge of the planet's square rect, vertically centred); method_155 (MainView.2.cs 584) the 5 x 5 bar grid.
// Render-only: reads the habitat, never writes it.

import { Texture } from 'pixi.js';
import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import type { Habitat } from '../sim/types';
import { habitatDevelopmentLevel } from '../sim/developmentLevel';
import { resourceIconPath } from '../ui/resourceIcons';

/** Main View zoom (f = 1 / camera zoom) below which a populated colony gets the plate (MainView.1.cs 1826 double_0 < 2). */
export const COLONY_PLATE_MAX_F = 2;
/** font_0: GenerateFont(16.67, regular) (MainView.cs 624). */
const FONT_PX = 16.67;
const CHROME = '/assets/dwu/images/ui/chrome/';

const images = new Map<string, HTMLImageElement | null>();
let imageVersion = 0;
/** An image once loaded (null until then; a redraw follows through `imageVersion`). */
function image(url: string): HTMLImageElement | null {
    const have = images.get(url);
    if (have !== undefined) return have !== null && have.complete && have.naturalWidth > 0 ? have : null;
    if (typeof Image === 'undefined') return null;
    const img = new Image();
    images.set(url, img);
    img.onload = () => imageVersion++;
    img.onerror = () => images.set(url, null);
    img.src = url;
    return null;
}

/** ControlPaint.Light / Dark (System.Windows.Forms): HLS lightness moved halfway to white / toward black. */
function shade(rgb: number, light: boolean): string {
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
    const f = (c: number) => Math.round(light ? c + (255 - c) * 0.5 : c * 0.5);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
}
const css = (rgb: number): string => `rgb(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255})`;

/** method_89's colour: the empire's main colour; a pirate faction's (1, 1, 1) black shows as (48, 48, 48). */
function plateColor(h: Habitat, independent: Empire | null): number {
    const e = h.empire;
    if (e === null || e === independent) return 0xa0a0a0; // color_1
    if (e.pirateEmpireBaseHabitat !== null && e.mainColor === 0x010101) return 0x303030;
    return e.mainColor;
}

/** method_155's two bar counts: population (> 0, 20 M, 100 M, 500 M, 2.5 G) and development (> 0, 20, 40, 60, 80). */
export function colonyPlateBars(population: number, development: number): [number, number] {
    const p = population > 2_500_000_000 ? 5 : population > 500_000_000 ? 4 : population > 100_000_000 ? 3 : population > 20_000_000 ? 2 : population > 0 ? 1 : 0;
    const d = development > 80 ? 5 : development > 60 ? 4 : development > 40 ? 3 : development > 20 ? 2 : development > 0 ? 1 : 0;
    return [p, d];
}

interface PlateInput {
    name: string;
    color: number;
    /** 'capital' (Empire.Capital), 'secondary' (Empire.Capitals), or null. */
    capital: 'capital' | 'secondary' | null;
    raceUrl: string | null;
    bars: [number, number] | null;
    resourceUrls: string[];
}

function plateInput(h: Habitat, galaxy: Galaxy): PlateInput {
    const e = h.empire;
    const independent = galaxy.independentEmpire;
    let capital: PlateInput['capital'] = null;
    if (e !== null && e !== independent) {
        if (e.capital === h) capital = 'capital';
        else if (e.capitals.includes(h)) capital = 'secondary';
    }
    const populated = h.population.items.length > 0;
    const race = populated ? h.population.dominantRace : null;
    const player = galaxy.playerEmpire;
    const known = player !== null && player.resourceMap.checkResourcesKnown(h);
    const resourceUrls: string[] = [];
    if (known) {
        for (const r of h.resources) {
            const def = galaxy.resourceSystem.byId.get(r.resourceId);
            if (def !== undefined) resourceUrls.push(resourceIconPath(def.pictureRef));
        }
    }
    return {
        name: h.name,
        color: plateColor(h, independent),
        capital,
        raceUrl: race !== null ? `/assets/dwu/images/units/races/race_${race.pictureIndex}.png` : null,
        bars: populated ? colonyPlateBars(h.population.totalAmount, habitatDevelopmentLevel(h)) : null,
        resourceUrls,
    };
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** mainView.ts MAP_FONT_FAMILY (not imported: mainView imports this module). */
const FONT = `${FONT_PX}px "Forgotten Futurist", sans-serif`;

/** The plate bitmap (method_89), on a 2D canvas. */
function drawPlate(p: PlateInput): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (measureCtx === null) return null;
    measureCtx.font = FONT;
    // Graphics.MeasureString pads the text by about 1/6 em on the right.
    const num = Math.trunc(measureCtx.measureText(p.name).width + FONT_PX / 6);
    const num2 = p.capital !== null ? 16 : 0;
    const num3 = p.bars !== null ? 20 : 0;
    const num4 = num3;
    const num5 = 16 * p.resourceUrls.length;
    const num6 = num2 + num;
    const num7 = num3 + num4 + 6 + num5;
    const num8 = Math.max(num6, num7);
    const num9 = 36;
    const num10 = num8 + 18;
    const num11 = num10 + 2;
    const num12 = Math.trunc(num11 / 2) - Math.trunc(num10 / 2);
    const num13 = 1;
    const c = document.createElement('canvas');
    c.width = num11;
    c.height = 38;
    const g = c.getContext('2d');
    if (g === null) return null;
    const num14 = Math.trunc(num9 / 4);
    const num15 = Math.trunc(num9 * 0.5);
    const hex: [number, number][] = [
        [num12, num13 + num15],
        [num12 + num14, num13],
        [num12 + num10 - num14, num13],
        [num12 + num10, num13 + num15],
        [num12 + num10 - num14, num13 + num9],
        [num12 + num14, num13 + num9],
    ];
    const path = (pts: [number, number][], close: boolean): void => {
        g.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
        if (close) g.closePath();
    };
    const col = css(p.color);
    path(hex, true);
    g.fillStyle = '#000'; // solidBrush_2
    g.fill();
    path(hex.slice(0, 4), true);
    g.fillStyle = col;
    g.fill();
    path(hex, true);
    g.strokeStyle = col;
    g.lineWidth = 1;
    g.stroke();
    // The bevel: light top-left edge, dark right / bottom edges (2 px pens).
    path([[num12 - 1, num13 + num15], [num12 + num14 - 1, num13 - 1], [num12 + num10 - num14 + 1, num13 - 1]], false);
    g.strokeStyle = shade(p.color, true);
    g.lineWidth = 2;
    g.stroke();
    path([[num12 + num10 - num14 + 1, num13 - 1], [num12 + num10 + 1, num13 + num15], [num12 + num10 - num14 + 1, num13 + num9 + 1], [num12 + num14 - 1, num13 + num9 + 1], [num12 - 1, num13 + num15]], false);
    g.strokeStyle = shade(p.color, false);
    g.stroke();
    let x = num12 + num14 + Math.trunc((num8 - num6) / 2);
    let y = num13 + 2;
    if (p.capital !== null) {
        const icon = image(`${CHROME}${p.capital === 'capital' ? 'capital.png' : 'fleetLeader.png'}`);
        if (icon !== null) g.drawImage(icon, x, y, 15, 15);
        x += num2;
    }
    // method_266: white text with a 1 px black drop shadow.
    g.font = FONT;
    g.textBaseline = 'top';
    g.fillStyle = '#000';
    g.fillText(p.name, x + 1, y + 1);
    g.fillStyle = '#fff';
    g.fillText(p.name, x, y);
    x = num12 + num14 + 3 + Math.trunc((num8 - num7) / 2);
    y = num13 + num15 + 2;
    g.beginPath();
    g.moveTo(num12, num13 + num15 + 0.5);
    g.lineTo(num12 + num10, num13 + num15 + 0.5);
    g.strokeStyle = col;
    g.lineWidth = 1;
    g.stroke();
    if (p.bars !== null) {
        if (p.raceUrl !== null) {
            const race = image(p.raceUrl);
            if (race !== null) g.drawImage(race, x, y, 15, 15);
        }
        x += 17;
        // method_155: a 5 x 5 grid of 3 x 2 cells (4 / 3 px apart), lit (40, 40, 40)... per Main's brushes:
        // solidBrush_2 = color_6 (32, 32, 84) for the grid, solidBrush_3 = color_8 (96, 96, 255) for the lit cells.
        for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
            g.fillStyle = 'rgb(32,32,84)';
            g.fillRect(x + i * 4, y + (4 - j) * 3, 3, 2);
        }
        g.fillStyle = 'rgb(96,96,255)';
        for (let k = 0; k < p.bars[0]; k++) for (let l = 0; l < p.bars[1]; l++) g.fillRect(x + k * 4, y + (4 - l) * 3, 3, 2);
        x += num4;
    }
    x += 4;
    g.beginPath();
    g.moveTo(x + 0.5, num13 + num15);
    g.lineTo(x + 0.5, num13 + num9);
    g.strokeStyle = col;
    g.stroke();
    x += 5;
    y++;
    for (const url of p.resourceUrls) {
        const icon = image(url);
        const ar = icon !== null && icon.naturalHeight > 0 ? icon.naturalWidth / icon.naturalHeight : 1;
        const w = ar < 1 ? Math.trunc(12 * ar) : 12;
        const h = ar < 1 ? 12 : Math.trunc(12 / ar);
        if (icon !== null) g.drawImage(icon, x, y + Math.trunc((12 - h) / 2), w, h);
        x += w + 2;
    }
    return c;
}

/** One habitat's plate texture, redrawn when what it shows changes (and once its images have loaded). */
export class ColonyPlateCache {
    private entries = new Map<Habitat, { key: string; tex: Texture }>();

    /** The plate texture for `h` (null without a 2D canvas). */
    get(h: Habitat, galaxy: Galaxy): Texture | null {
        const input = plateInput(h, galaxy);
        const key = `${JSON.stringify(input)}|${imageVersion}`;
        const have = this.entries.get(h);
        if (have !== undefined && have.key === key) return have.tex;
        const canvas = drawPlate(input);
        if (canvas === null) return null;
        have?.tex.destroy(true);
        const tex = Texture.from(canvas);
        this.entries.set(h, { key, tex });
        return tex;
    }

    /** Drop a habitat's plate (it left the view's system). */
    drop(h: Habitat): void {
        this.entries.get(h)?.tex.destroy(true);
        this.entries.delete(h);
    }

    destroy(): void {
        for (const e of this.entries.values()) e.tex.destroy(true);
        this.entries.clear();
    }
}
