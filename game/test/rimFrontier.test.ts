// Scenario 19h "rim frontier geography" (tasks/19-mod-layer-scenarios.md §19h): storm belt, sparser rim, gravity shoals,
// inward fuel, rim sensor fog, map scale; flag off = the faithful game; stacks with the 19a rim trader.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame, cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame, inlineOverlay, loadScenarioOverlayFs, scenarioGameData, scenarioIndexFs } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { radiusFraction, resolveScenarioIncludes, scenarioQuery } from '../src/sim/scenario';
import { GalaxyLocationEffectType, GalaxyLocationType } from '../src/sim/galaxyLocation';
import { HabitatCategoryType } from '../src/sim/types';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { RIM_FRONTIER_DEFAULTS, rimFrontierState } from '../src/sim/scenario/rimFrontier/common';
import { rimGoodIds, rimTraderEmpire } from '../src/sim/scenario/rimTrade/common';
import { resolveSectorDescription } from '../src/sim/empireEvents';
import { sectorColumnLabel } from '../src/ui/screens/galaxyMap';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const D = RIM_FRONTIER_DEFAULTS;

function stormsBy(g: Galaxy): { inner: number; belt: number } {
    let inner = 0;
    let belt = 0;
    for (const l of g.galaxyLocations) {
        if (l.type !== GalaxyLocationType.NebulaCloud || l.effect !== GalaxyLocationEffectType.LightningDamage) continue;
        const c = l.resolveLocationCenter();
        if (radiusFraction(g, c.x, c.y) >= D.rimFrontierBeltInner) belt++;
        else inner++;
    }
    return { inner, belt };
}

function starsBeyond(g: Galaxy, f: number): { beyond: number; total: number } {
    let beyond = 0;
    let total = 0;
    for (const h of g.habitats) {
        if (h.category !== HabitatCategoryType.Star) continue;
        total++;
        if (radiusFraction(g, h.xpos, h.ypos) >= f) beyond++;
    }
    return { beyond, total };
}

function fuelBeyond(g: Galaxy, f: number): number {
    const ids = ['Caslon', 'Hydrogen'].map((n) => g.resourceSystem.resources.find((r) => r.name === n)!.resourceId);
    let n = 0;
    for (const h of g.habitats) {
        if (h.resources.some((r) => ids.includes(r.resourceId)) && radiusFraction(g, h.xpos, h.ypos) > f) n++;
    }
    return n;
}

describe('19h rim frontier — generation', () => {
    let on: Game;
    let off: Game;
    beforeAll(() => {
        off = cachedTickGame(base);
        on = createScenarioGame(base, { scenario: 'rim-frontier' }).game;
    }, 600000);

    it('the manifest is in the index with the flag and every param', () => {
        const m = scenarioIndexFs().find((x) => x.id === 'rim-frontier')!;
        expect(m.flags.map((f) => f.name)).toEqual(['rimFrontier']);
        expect(m.params.map((p) => p.name).sort()).toEqual(Object.keys(D).sort());
        for (const p of m.params) expect(p.default).toBe(D[p.name as keyof typeof D]);
        // The raised star-count cap (was 2000).
        expect(m.params.find((p) => p.name === 'rimFrontierStarCount')?.max).toBe(4000);
    });

    it('1: storm density rises in the belt; the core is untouched', () => {
        const a = stormsBy(off.galaxy);
        const b = stormsBy(on.galaxy);
        expect(b.inner).toBe(a.inner);
        expect(b.belt).toBeGreaterThanOrEqual(a.belt + 10);
        expect(rimFrontierState(on.galaxy).addedStorms.length).toBe(Math.round(D.rimFrontierStormDensity * 3 * on.galaxy.sectorWidth));
    });

    it('2: stars thin past the thinning radius (same star count)', () => {
        const a = starsBeyond(off.galaxy, D.rimFrontierThinRadius);
        const b = starsBeyond(on.galaxy, D.rimFrontierThinRadius);
        expect(b.total).toBe(a.total);
        expect(b.beyond).toBeLessThan(a.beyond * 0.75);
    });

    it('4: Caslon and Hydrogen only roll inside the fuel radius', () => {
        expect(fuelBeyond(off.galaxy, D.rimFrontierFuelMaxRadius)).toBeGreaterThan(5);
        expect(fuelBeyond(on.galaxy, D.rimFrontierFuelMaxRadius)).toBe(0);
    });

    it('3: gravity shoals are map locations that end a hyperjump crossing them', () => {
        const g = on.galaxy;
        const shoals = rimFrontierState(g).shoals;
        expect(shoals.length).toBe(D.rimFrontierShoalCount);
        const s = shoals[0];
        expect(g.galaxyLocations).toContain(s);
        expect(g.determineGalaxyLocationsAtPoint(s.xpos + s.width / 2, s.ypos + s.height / 2)).toContain(s);
        const r = s.width / 2;
        const cx = s.xpos + r;
        const cy = s.ypos + s.height / 2;
        const ship = on.galaxy.empires[0]!.builtObjects[0];
        const args = { ship, fromX: cx - 3 * r, fromY: cy, toX: cx + 3 * r, toY: cy, exitX: cx + 10 * r, exitY: cy };
        const stop = scenarioQuery(g, 'hyperjumpStop', null, args)!;
        expect(stop).not.toBeNull();
        expect(Math.hypot(stop.x - cx, stop.y - cy)).toBeLessThan(r);
        expect(Math.hypot(stop.x - cx, stop.y - cy)).toBeGreaterThan(r - 2);
        // Restarting from the stop point crosses the shoal freely; a step that ends short of it or an exit before it is not stopped.
        expect(scenarioQuery(g, 'hyperjumpStop', null, { ...args, fromX: stop.x, fromY: stop.y })).toBeNull();
        expect(scenarioQuery(g, 'hyperjumpStop', null, { ...args, toX: cx - 1.5 * r })).toBeNull();
        expect(scenarioQuery(g, 'hyperjumpStop', null, { ...args, exitX: cx - 1.5 * r })).toBeNull();
        expect(scenarioQuery(off.galaxy, 'hyperjumpStop', null, args)).toBeNull();
    });

    it('5: ship sensors reach less far toward rim targets', () => {
        const g = on.galaxy;
        const cx = g.sizeX / 2;
        expect(scenarioQuery(g, 'scanRangeModifier', 1, { x: cx, y: cx })).toBe(1);
        expect(scenarioQuery(g, 'scanRangeModifier', 1, { x: cx + 0.9 * cx, y: cx })).toBe(D.rimFrontierFogFactor);
        expect(scenarioQuery(off.galaxy, 'scanRangeModifier', 1, { x: cx + 0.9 * cx, y: cx })).toBe(1);
    });

    it('6: the extent multiplier spreads the same stars wider (past the 15-sector clamp too); the star count param', () => {
        const wide = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimFrontierExtent: 1.5 } }).game.galaxy;
        expect(wide.sectorWidth).toBe(12);
        expect(wide.sizeX).toBe(12 * wide.sectorSize);
        expect(starsBeyond(wide, 0).total).toBe(starsBeyond(off.galaxy, 0).total);
        let maxX = 0;
        for (const h of wide.habitats) maxX = Math.max(maxX, h.xpos);
        expect(maxX).toBeGreaterThan(off.galaxy.sizeX);
        const big = (o: CreateGameOptions): CreateGameOptions => ({ ...o, sectorWidth: 15, sectorHeight: 15, starCount: 120, systemNames: Array.from({ length: 150 }, (_, i) => `S${i}`) });
        const huge = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimFrontierExtent: 1.7, rimFrontierStarCount: 150 }, options: big }).game.galaxy;
        expect(huge.sectorWidth).toBe(26);
        expect(starsBeyond(huge, 0).total).toBe(150);
    }, 600000);

    it('6b: the raised star-count cap (4000) at max extent (1.7) — still 26 sectors, unique sector labels, index grid covers it', () => {
        const big = (o: CreateGameOptions): CreateGameOptions => ({
            ...o,
            sectorWidth: 15,
            sectorHeight: 15,
            starCount: 4000,
            systemNames: Array.from({ length: 4400 }, (_, i) => `S${i}`),
        });
        const g = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimFrontierExtent: 1.7, rimFrontierStarCount: 4000 }, options: big }).game.galaxy;
        expect(starsBeyond(g, 0).total).toBe(4000);
        // 15 (the wizard's max) * 1.7 = 25.5 → round → 26 = SCENARIO_MAX_SECTORS: sector labels stay one letter (A..Z),
        // never the two-letter (AA..) range a >26 count would need (galaxyMap.ts sectorColumnLabel, empireEvents.ts
        // resolveSectorDescription, hud.ts missionTargetText all assume String.fromCharCode(i + 65)).
        expect(g.sectorWidth).toBe(26);
        expect(g.sectorHeight).toBe(26);
        const labels = new Set<string>();
        for (let x = 0; x < g.sectorWidth; x++) {
            for (let y = 0; y < g.sectorHeight; y++) {
                const label = resolveSectorDescription(g, x * g.sectorSize, y * g.sectorSize);
                expect(label).toMatch(/^[A-Z]\d+$/);
                labels.add(label);
            }
        }
        expect(labels.size).toBe(g.sectorWidth * g.sectorHeight);
        for (let i = 0; i < g.sectorWidth; i++) expect(sectorColumnLabel(i)).toBe(String.fromCharCode(65 + i));
        // The location index grid (Galaxy.4.cs AddGalaxyLocationIndex, sized off sizeX/sizeY) is rebuilt at the
        // extended galaxy size, not the stock 15-sector one, and covers every corner.
        expect(g.sizeX).toBe(26 * g.sectorSize);
        expect(g.sizeY).toBe(26 * g.sectorSize);
        expect(() => g.determineGalaxyLocationsAtPoint(0, 0)).not.toThrow();
        expect(() => g.determineGalaxyLocationsAtPoint(g.sizeX - 1, g.sizeY - 1)).not.toThrow();
    }, 600000);
});

describe('19h rim frontier — faithful path, save, stacking', () => {
    it('flag off: the same seed-1 game and 600 s run as no scenario', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier', flags: { rimFrontier: false } });
        expect('rimFrontier' in game.galaxy.scenario!.state).toBe(false);
        const run = runGameSeconds(game, 600);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
    }, 1200000);

    it('with the rim trader: both run; the Concord on the rim, rim goods, frontier features; save resumes identically', () => {
        const byId = new Map(scenarioIndexFs().map((m) => [m.id, loadScenarioOverlayFs(m.id)] as const));
        const both = resolveScenarioIncludes(inlineOverlay({ id: 'rimTradeFrontier', include: ['rimTrade', 'rim-frontier'] }), byId);
        const forceOranthi = (o: CreateGameOptions): CreateGameOptions => ({ ...o, aiEmpires: [{ ...o.aiEmpires[0], race: 'Oranthi' }, ...o.aiEmpires.slice(1)] });
        const { game } = createScenarioGame(base, { scenario: both, options: forceOranthi });
        const g = game.galaxy;
        expect(g.scenario!.flags).toMatchObject({ rimFrontier: true, rimTrader: true });
        const r = rimTraderEmpire(g)!;
        expect(r).not.toBeNull();
        expect(radiusFraction(g, r.capital!.xpos, r.capital!.ypos)).toBeGreaterThanOrEqual(0.8);
        const rim = rimGoodIds(g);
        let rimCount = 0;
        for (const h of g.habitats) {
            if (!h.resources.some((x) => rim.includes(x.resourceId))) continue;
            rimCount++;
            expect(radiusFraction(g, h.xpos, h.ypos)).toBeGreaterThanOrEqual(0.72);
        }
        expect(rimCount).toBeGreaterThan(0);
        expect(rimFrontierState(g).shoals.length).toBe(D.rimFrontierShoalCount);
        expect(fuelBeyond(g, D.rimFrontierFuelMaxRadius)).toBe(0);
        runGameSeconds(game, 300);
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(g.nowMs);
        const text = serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'rimTradeFrontier', flags: { ...g.scenario!.flags }, params: {} } });
        const loaded = deserializeGame(text, scenarioGameData(base, both)).game;
        expect(rimFrontierState(loaded.galaxy).shoals.map((s) => s.name)).toEqual(rimFrontierState(g).shoals.map((s) => s.name));
        expect(loaded.galaxy.galaxyLocations).toContain(rimFrontierState(loaded.galaxy).shoals[0]);
        runGameSeconds(game, 120);
        runGameSeconds(loaded, 120);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(g));
    }, 1200000);
});
