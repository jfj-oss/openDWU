// Parity batch D1: the SystemView control (picSystemMap on the Galaxy Map window, picSystem on the HUD), the Galaxy
// Map's Back / Forward history and the shared map layers. Pure helpers + draws into a recording 2D context (no DOM).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { stateDigest } from '../src/sim/tick/digest';
import { Camera } from '../src/render/camera';
import { Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import {
    drawRegionView,
    drawSystemView,
    findNearestHabitatNear,
    hudMapClickScale,
    hudSystemScale,
    regionScale,
    regionViewOrigin,
    resolveSectorClamped,
    systemViewHabitatColor,
    systemViewHabitatSize,
    systemViewHabitats,
    systemViewWorldAt,
} from '../src/ui/systemView';
import {
    GALAXY_MAP_HISTORY_MAX,
    createGalaxyMapHistory,
    galaxyMapHistoryBack,
    galaxyMapHistoryButtons,
    galaxyMapHistoryClear,
    galaxyMapHistoryForward,
    galaxyMapHistoryPush,
    galaxyMapSystemOf,
    galaxyMapSystemScale,
} from '../src/ui/screens/galaxyMap';
import { nebulaCompositeSize, NEBULA_COMPOSITE_PX } from '../src/ui/screens/galaxyMapLayers';
import { drawHudSystemMap, hudSystemMapClickTarget, hudSystemMapScaleFactor, SYSTEM_MAP_PANEL, SYSTEM_MAP_PIC } from '../src/ui/hudSystemMap';
import { computeHudLayout } from '../src/ui/hudLayout';

/** A 2D context that records calls (and the fill / stroke style at each fill / stroke). */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: { name: string; args: unknown[]; fill: unknown; stroke: unknown }[] } {
    const calls: { name: string; args: unknown[]; fill: unknown; stroke: unknown }[] = [];
    const state: Record<string | symbol, unknown> = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', globalAlpha: 1 };
    const ctx = new Proxy(state, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (prop === 'measureText') return (s: string) => ({ width: s.length * 6 });
            return (...args: unknown[]) => {
                calls.push({ name: String(prop), args, fill: target.fillStyle, stroke: target.strokeStyle });
            };
        },
        set(target, prop, value) {
            target[prop] = value;
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
}

/** A habitat with any category / type pair (the constructor validates the combination; these only test lookups). */
const hab = (cat: HabitatCategoryType, type: HabitatType, diameter = 100): Habitat => {
    const h = new Habitat(HabitatCategoryType.Planet, HabitatType.Ocean, 'h', 0, 0);
    h.category = cat;
    h.type = type;
    h.diameter = diameter;
    return h;
};

describe('SystemView.cs method_5 helpers', () => {
    it('dot sizes by diameter (num7); gas clouds and black holes scale with the view', () => {
        const p = (d: number) => systemViewHabitatSize(hab(HabitatCategoryType.Planet, HabitatType.Ocean, d), 184);
        expect([p(1300), p(1100), p(800), p(400), p(180), p(179), p(80), p(79), p(30), p(29)]).toEqual([11, 9, 7, 6, 5, 4, 4, 3, 3, 2]);
        expect(systemViewHabitatSize(hab(HabitatCategoryType.Star, HabitatType.BlackHole, 4000), 184)).toBe(Math.trunc(4000 / 184));
        expect(systemViewHabitatSize(hab(HabitatCategoryType.GasCloud, HabitatType.Hydrogen, 9000), 100)).toBe(90);
    });

    it('brushes by habitat type (Main.Part13.cs solidBrush_7..24)', () => {
        const c = (cat: HabitatCategoryType, t: HabitatType) => systemViewHabitatColor(hab(cat, t));
        expect(c(HabitatCategoryType.Star, HabitatType.MainSequence)).toBe('rgb(255, 255, 0)');
        expect(c(HabitatCategoryType.Star, HabitatType.BlackHole)).toBe('rgb(0, 0, 176)');
        expect(c(HabitatCategoryType.Planet, HabitatType.Volcanic)).toBe('rgb(255, 69, 0)');
        expect(c(HabitatCategoryType.Planet, HabitatType.Desert)).toBe('rgb(244, 164, 96)');
        expect(c(HabitatCategoryType.Planet, HabitatType.Continental)).toBe('rgb(0, 128, 0)');
        expect(c(HabitatCategoryType.Planet, HabitatType.Ocean)).toBe('rgb(0, 0, 255)');
        expect(c(HabitatCategoryType.Planet, HabitatType.Ice)).toBe('rgb(0, 255, 255)');
        expect(c(HabitatCategoryType.Asteroid, HabitatType.Ice)).toBe('rgb(64, 64, 64)');
        expect(c(HabitatCategoryType.Planet, HabitatType.GasGiant)).toBe('rgb(255, 0, 0)');
        expect(c(HabitatCategoryType.Planet, HabitatType.FrozenGasGiant)).toBe('rgb(255, 20, 147)');
        expect(c(HabitatCategoryType.GasCloud, HabitatType.Argon)).toBe('rgba(238, 130, 238, 0.376)');
        expect(c(HabitatCategoryType.Asteroid, HabitatType.Metal)).toBe('rgb(64, 64, 64)');
        expect(c(HabitatCategoryType.Planet, HabitatType.Undefined)).toBeNull();
    });

    it('the HUD scale (method_5 relativeToView), the region scale (method_9) and the click scale (picSystem_MouseUp)', () => {
        expect(hudSystemScale(1, 82)).toBe(82);
        expect(hudSystemScale(9.99, 82)).toBe(82);
        expect(hudSystemScale(10, 82)).toBe(10 * 10 - 18);
        expect(hudSystemScale(50, 82)).toBe(482);
        expect(regionScale(100)).toBe(25000);
        expect(regionScale(2499)).toBe(25000);
        expect(regionScale(2500)).toBe(25000);
        expect(regionScale(5000)).toBe(50000);
        expect(regionScale(20000)).toBe(75000);
        expect(hudMapClickScale(50, 82)).toBe(482);
        expect(hudMapClickScale(100, 82)).toBe(35000);
        expect(hudMapClickScale(4000, 82)).toBe(40000);
    });
});

describe('Galaxy Map Back / Forward (Main.Part10.cs method_213 / method_215)', () => {
    const hs = Array.from({ length: 120 }, (_, i) => new Habitat(HabitatCategoryType.Planet, HabitatType.Ocean, `p${i}`, i, 0));

    it('records visits, skips a repeat of the current entry and steps back / forward', () => {
        const h = createGalaxyMapHistory();
        expect(galaxyMapHistoryButtons(h)).toEqual({ back: false, forward: false });
        galaxyMapHistoryPush(h, hs[0]);
        galaxyMapHistoryPush(h, hs[0]);
        galaxyMapHistoryPush(h, hs[1]);
        galaxyMapHistoryPush(h, hs[2]);
        expect(h.list).toEqual([hs[0], hs[1], hs[2]]);
        expect(galaxyMapHistoryButtons(h)).toEqual({ back: true, forward: false });
        expect(galaxyMapHistoryBack(h)).toBe(hs[1]);
        expect(galaxyMapHistoryBack(h)).toBe(hs[0]);
        expect(galaxyMapHistoryBack(h)).toBeNull();
        expect(galaxyMapHistoryButtons(h)).toEqual({ back: false, forward: true });
        expect(galaxyMapHistoryForward(h)).toBe(hs[1]);
        // A visit from an earlier position overwrites the next entry and drops the rest.
        galaxyMapHistoryPush(h, hs[5]);
        expect(h.list).toEqual([hs[0], hs[1], hs[5]]);
        expect(h.index).toBe(2);
        galaxyMapHistoryClear(h);
        expect(h).toEqual({ list: [], index: 0 });
    });

    it('keeps at most dremNtuMsv = 100 entries, shifting the oldest out', () => {
        const h = createGalaxyMapHistory();
        for (const x of hs) galaxyMapHistoryPush(h, x);
        expect(GALAXY_MAP_HISTORY_MAX).toBe(100);
        expect(h.list.length).toBe(100);
        expect(h.list[0]).toBe(hs[20]);
        expect(h.list[99]).toBe(hs[119]);
        expect(h.index).toBe(99);
    });
});

describe('HUD layout: the mini-map and the View popup coexist bottom-right', () => {
    it('pnlSystemMap is 330 × 290 at 10 px from the corner; the View popup sits above it', () => {
        for (const [w, hgt] of [[1920, 1080], [1280, 720], [3840, 2160]] as const) {
            const l = computeHudLayout(w, hgt);
            expect(l['pnlSystemMap']).toEqual({ x: w - SYSTEM_MAP_PANEL.w - 10, y: hgt - SYSTEM_MAP_PANEL.h - 10, w: 330, h: 290 });
            expect(l['pnlOptionsList'].y).toBeLessThan(l['pnlSystemMap'].y);
            expect(l['pnlOptionsList'].x + l['pnlOptionsList'].w).toBe(l['pnlSystemMap'].x + l['pnlSystemMap'].w);
            // The selection frame (bottom-left, 399 wide) does not reach the mini-map.
            expect(l['pnlSelection'].x + l['pnlSelection'].w).toBeLessThan(l['pnlSystemMap'].x);
        }
        expect(SYSTEM_MAP_PIC).toEqual({ x: 45, y: 5, size: 280 });
    });
});

describe('nebula composite size (galaxyMapLayers.ts)', () => {
    it('keeps the galaxy aspect at NEBULA_COMPOSITE_PX on the long side', () => {
        expect(nebulaCompositeSize(1000, 1000)).toEqual({ w: NEBULA_COMPOSITE_PX, h: NEBULA_COMPOSITE_PX });
        expect(nebulaCompositeSize(2000, 1000)).toEqual({ w: NEBULA_COMPOSITE_PX, h: NEBULA_COMPOSITE_PX / 2 });
    });
});

describe('SystemView draws on a real game (read-only)', () => {
    let gameData: GameData;
    let game: Game;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
        game = await cachedTickGame(gameData);
    }, 600_000);

    it('picSystemMap: the home system with its orbits, the crosshair and the name; clicks map to its habitats', () => {
        const galaxy = game.galaxy;
        const player = galaxy.playerEmpire!;
        const capital = player.capital ?? player.colonies[0];
        const star = galaxyMapSystemOf(galaxy, capital);
        expect(star.parent).toBeNull();
        const scale = galaxyMapSystemScale(galaxy);
        expect(scale).toBe(Math.trunc((23000 * 2) / 250));
        const { ctx, calls } = recordingContext();
        drawSystemView(ctx, { galaxy, player, width: 250, height: 250, star, scale, centerX: star.xpos, centerY: star.ypos, indicator: { selected: capital, system: star }, systemName: star.name });
        const habitats = systemViewHabitats(galaxy, star);
        const planets = habitats.filter((h) => h.category === HabitatCategoryType.Planet).length;
        expect(planets).toBeGreaterThan(0);
        // One orbit stroke per planet in pen_1, then one fill per drawn habitat.
        const orbitStrokes = calls.filter((c) => c.name === 'stroke' && c.stroke === 'rgb(32, 32, 88)').length;
        expect(orbitStrokes).toBe(planets);
        expect(calls.some((c) => c.name === 'fillText' && c.args[0] === star.name)).toBe(true);
        // The capital is owned: its 2 px ring in the empire colour.
        expect(calls.filter((c) => c.name === 'stroke' && typeof c.stroke === 'string' && (c.stroke as string).startsWith('rgba(')).length).toBeGreaterThan(0);
        // A click on the capital's pixel selects it (picSystemMap_MouseUp → FindNearestHabitat).
        const px = Math.trunc((capital.xpos - star.xpos) / scale) + 125;
        const py = Math.trunc((capital.ypos - star.ypos) / scale) + 125;
        const w = systemViewWorldAt(star, 250, 250, scale, px, py);
        expect(findNearestHabitatNear(galaxy, w.x, w.y)).toBe(capital);
    });

    it('a view filter draws its habitats in yellow and the rest grey (SetSelectedHabitats)', () => {
        const galaxy = game.galaxy;
        const player = galaxy.playerEmpire!;
        const capital = player.capital ?? player.colonies[0];
        const star = galaxyMapSystemOf(galaxy, capital);
        const { ctx, calls } = recordingContext();
        drawSystemView(ctx, { galaxy, player, width: 250, height: 250, star, scale: galaxyMapSystemScale(galaxy), centerX: star.xpos, centerY: star.ypos, selectedHabitats: [capital] });
        const fills = calls.filter((c) => c.name === 'fill');
        expect(fills.filter((c) => c.fill === 'rgb(255, 255, 0)').length).toBe(1);
        expect(fills.filter((c) => c.fill === 'rgb(80, 80, 80)').length).toBe(systemViewHabitats(galaxy, star).length - 1);
    });

    it('an unexplored system shows only its star and "(Not Explored)"', () => {
        const galaxy = game.galaxy;
        const player = galaxy.playerEmpire!;
        const sys = galaxy.systems.find((s) => s.systemStar.category === HabitatCategoryType.Star && s.habitats.length > 2 && player.visibility.checkSystemVisibilityStatus(s.systemStar.systemIndex) === SystemVisibilityStatus.Unexplored);
        expect(sys).toBeDefined();
        const { ctx, calls } = recordingContext();
        drawSystemView(ctx, { galaxy, player, width: 250, height: 250, star: sys!.systemStar, scale: 184, centerX: sys!.systemStar.xpos, centerY: sys!.systemStar.ypos, systemName: sys!.systemStar.name });
        expect(calls.filter((c) => c.name === 'fill').length).toBe(1);
        expect(calls.some((c) => c.name === 'fillText' && c.args[0] === '(Not Explored)')).toBe(true);
        expect(calls.some((c) => c.name === 'fillText' && c.args[0] === sys!.systemStar.name)).toBe(false);
    });

    it('the HUD map draws the system view below factor 100 and the region view above, without writing the sim', () => {
        const galaxy = game.galaxy;
        const player = galaxy.playerEmpire!;
        const capital = player.capital ?? player.colonies[0];
        const before = stateDigest(galaxy);
        const camera = new Camera();
        camera.setViewport(1920, 1080);
        camera.maxZoom = 4;
        camera.setGalaxyBounds(galaxy.sizeX, galaxy.sizeY);
        camera.centerOn(capital.xpos, capital.ypos);
        for (const factor of [1, 20, 99, 100, 3000, 20000]) {
            camera.zoom = 1 / factor;
            const { ctx, calls } = recordingContext();
            drawHudSystemMap(ctx, galaxy, camera);
            expect(calls.length, `factor ${factor}`).toBeGreaterThan(5);
            if (factor < 100) {
                // The view rectangle (48, color_7) is filled in the system view.
                expect(calls.some((c) => c.name === 'fillRect' && c.fill === `rgba(96, 96, 255, ${48 / 255})`)).toBe(true);
            } else {
                expect(calls.some((c) => c.name === 'fillRect' && c.fill === `rgba(96, 96, 255, ${24 / 255})`)).toBe(true);
            }
        }
        expect(stateDigest(galaxy)).toBe(before);
    });

    it('the region view (method_9) draws the systems of the sectors in view, ringed by their owner', () => {
        const galaxy = game.galaxy;
        const player = galaxy.playerEmpire!;
        const capital = player.capital ?? player.colonies[0];
        const { ctx, calls } = recordingContext();
        drawRegionView(ctx, { galaxy, player, width: 280, height: 280, viewX: capital.xpos, viewY: capital.ypos, zoomFactor: 3000, viewWidth: 1920, viewHeight: 1080, fleetPostures: true });
        const o = regionViewOrigin(galaxy, capital.xpos, capital.ypos, 280, 280, 3000);
        const s0 = resolveSectorClamped(galaxy, o.x0, o.cy);
        const s1 = resolveSectorClamped(galaxy, o.x1, o.cy);
        expect(s1.x).toBeGreaterThanOrEqual(s0.x);
        const shown = galaxy.systems.filter((sys) => {
            const x = (sys.systemStar.xpos - o.x0) / o.scale;
            const y = (sys.systemStar.ypos - o.y0) / o.scale;
            return x >= 0 && x <= 280 && y >= 0 && y <= 280;
        });
        expect(shown.length).toBeGreaterThan(0);
        expect(calls.filter((c) => c.name === 'fill').length).toBeGreaterThanOrEqual(shown.length);
        // The player's home system is ringed in its colour.
        expect(calls.some((c) => c.name === 'stroke' && typeof c.stroke === 'string' && (c.stroke as string).startsWith('rgba('))).toBe(true);
    });

    it('a click moves the view by the clicked offset (picSystem_MouseUp)', () => {
        const galaxy = game.galaxy;
        const k = hudSystemMapScaleFactor(galaxy);
        expect(k).toBe(Math.trunc(23000 / 280));
        const star = galaxy.systems[0].systemStar;
        expect(hudSystemMapClickTarget(galaxy, { x: star.xpos, y: star.ypos, zoomFactor: 1 }, 140, 140)).toEqual({ x: Math.trunc(star.xpos), y: Math.trunc(star.ypos) });
        expect(hudSystemMapClickTarget(galaxy, { x: star.xpos, y: star.ypos, zoomFactor: 1 }, 150, 130)).toEqual({ x: Math.trunc(star.xpos) + 10 * k, y: Math.trunc(star.ypos) - 10 * k });
        expect(hudSystemMapClickTarget(galaxy, { x: star.xpos, y: star.ypos, zoomFactor: 500 }, 141, 140)).toEqual({ x: Math.trunc(star.xpos) + 35000, y: Math.trunc(star.ypos) });
    });
});

describe('landscape pictures (pnlGalaxyMapHabitatPicture)', () => {
    it('maps GalaxyImages indexes through and the sim placeholders to their type range', async () => {
        const { resolveLandscapeRef, habitatLandscapeImageUrl } = await import('../src/ui/landscapeImages');
        expect(resolveLandscapeRef(5)).toBe(5);
        expect(resolveLandscapeRef(-1)).toBe(-1);
        expect(resolveLandscapeRef(400)).toBe(4);
        expect(resolveLandscapeRef(409)).toBe(7);
        expect(resolveLandscapeRef(1000)).toBe(23);
        expect(resolveLandscapeRef(1009)).toBe(24);
        expect(resolveLandscapeRef(1605)).toBe(11 + 3);
        expect(resolveLandscapeRef(3000)).toBe(-1);
        expect(habitatLandscapeImageUrl(1401)).toBe('/assets/dwu/images/environment/landscapes/volcanic/landscape_0.png');
    });
});
