// Custom galaxy size (not a port): the wizard's star-count box and "Sectors: W × H" boxes (startGameOptions.ts
// setGalaxyStarCount / setGalaxySectors), the base-game generation path past the C# 4..15 sector clamp
// (Galaxy.setCustomGalaxyDimensions, CreateGameOptions.customGalaxyDimensions) and the sector names past Z.
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import { createGame } from '../src/sim/game';
import { CUSTOM_MAX_SECTORS, generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { GalaxyShape } from '../src/sim/types';
import {
    GALAXY_MAX_STARS_PER_SECTOR,
    GALAXY_STAR_COUNT_MAX,
    GALAXY_STAR_COUNT_MIN,
    SECTOR_PRESETS,
    STAR_COUNT_PRESETS,
    defaultStartGameOptions,
    galaxyDensityWarning,
    galaxySectorCounts,
    galaxySizeIsCustom,
    galaxyStarCount,
    sectorsFor,
    setGalaxySectors,
    setGalaxyStarCount,
    starCountFor,
    toCreateGameOptions,
    type StartGameOptions,
} from '../src/sim/startGameOptions';
import { parseSectorColumn, sectorColumnName } from '../src/sim/sectorNames';
import { resolveSectorDescription } from '../src/sim/empireEvents';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { stateDigest } from '../src/sim/tick/digest';
import { sectorLabelStride } from '../src/ui/screens/galaxyMap';
import { loadGameDataFs } from './helpers/loadGameDataFs';

const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `S${i}`);

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 60000);

const start = (over: Partial<StartGameOptions> = {}): StartGameOptions => ({ ...defaultStartGameOptions(), seed: 7, raceName: 'Human', ...over, otherEmpires: { autogenerate: true, empireCount: 3, manual: [] } });

/** Every habitat's position and type, in order: equal fingerprints = the same generated galaxy. */
function fingerprint(g: Galaxy): string {
    let h = 0;
    for (const x of g.habitats) h = (Math.imul(h, 31) + Math.trunc(x.xpos) * 7 + Math.trunc(x.ypos) * 13 + x.type) | 0;
    return `${g.habitats.length}:${g.galaxyLocations.length}:${g.sizeX}x${g.sizeY}:${h}`;
}

describe('presets are the original game', () => {
    it('every preset star count / sector square leaves no custom field and passes the original values', () => {
        for (let si = 0; si < STAR_COUNT_PRESETS.length; si++) {
            for (let di = 0; di < SECTOR_PRESETS.length; di++) {
                const o = start({ starCountIndex: si, dimensionIndex: di });
                // Typing the preset values into the boxes selects the presets.
                setGalaxySectors(o, sectorsFor(di), sectorsFor(di));
                setGalaxyStarCount(o, starCountFor(si));
                expect(galaxySizeIsCustom(o)).toBe(false);
                expect(o.starCountIndex).toBe(si);
                expect(o.dimensionIndex).toBe(di);
                expect('customStarCount' in o || 'customSectorWidth' in o || 'customSectorHeight' in o).toBe(false);
                const c = toCreateGameOptions(o, gameData, names(10));
                expect(c.starCount).toBe(starCountFor(si));
                expect(c.sectorWidth).toBe(sectorsFor(di));
                expect(c.sectorHeight).toBe(sectorsFor(di));
                expect('customGalaxyDimensions' in c).toBe(false);
                expect(galaxyDensityWarning(o)).toBeNull();
            }
        }
    });

    it('a preset picked after a custom size clears it again', () => {
        const o = start();
        setGalaxySectors(o, 40, 30);
        setGalaxyStarCount(o, 2222);
        expect(galaxySizeIsCustom(o)).toBe(true);
        setGalaxySectors(o, 10, 10);
        setGalaxyStarCount(o, 700);
        expect(galaxySizeIsCustom(o)).toBe(false);
        expect(o.dimensionIndex).toBe(3);
        expect(o.starCountIndex).toBe(3);
    });

    it('the custom-size generation path gives the same galaxy as the faithful ctor for 4..15 square sizes', () => {
        for (const n of [4, 10, 15]) {
            const base = { seed: 3, shape: GalaxyShape.Elliptical, starCount: 200, sectorWidth: n, sectorHeight: n, systemNames: names(200), gameData };
            expect(fingerprint(generateGalaxy({ ...base, customGalaxyDimensions: true }))).toBe(fingerprint(generateGalaxy(base)));
        }
    });

    it('without the switch the C# clamp still applies (4..15)', () => {
        const g = generateGalaxy({ seed: 3, shape: GalaxyShape.Spiral, starCount: 100, sectorWidth: 40, sectorHeight: 2, systemNames: names(100), gameData });
        expect(g.sectorWidth).toBe(15);
        expect(g.sectorHeight).toBe(4);
    });
});

describe('custom size options', () => {
    it('clamps sectors to 1..90 and the star count to its range and density cap', () => {
        const o = start();
        expect(setGalaxySectors(o, 0, 500)).toEqual({ width: 1, height: CUSTOM_MAX_SECTORS });
        expect(galaxySectorCounts(o)).toEqual({ width: 1, height: 90 });
        expect(setGalaxyStarCount(o, 1)).toBe(GALAXY_STAR_COUNT_MIN);
        expect(setGalaxyStarCount(o, 1e9)).toBe(GALAXY_STAR_COUNT_MAX);
        // 1 × 1: at most GALAXY_MAX_STARS_PER_SECTOR stars (100 = the Dwarf preset value, so it becomes the preset).
        setGalaxySectors(o, 1, 1);
        expect(galaxyStarCount(o)).toBe(GALAXY_MAX_STARS_PER_SECTOR);
        expect(o.customStarCount).toBeUndefined();
        expect(o.starCountIndex).toBe(0);
        // A custom count keeps its slider bracket for the slider-keyed values (MaximumEmpireAmount).
        setGalaxySectors(o, 60, 60);
        setGalaxyStarCount(o, 3000);
        expect(o.customStarCount).toBe(3000);
        expect(o.starCountIndex).toBe(5);
        const c = toCreateGameOptions(o, gameData, names(10));
        expect(c.starCount).toBe(3000);
        expect([c.sectorWidth, c.sectorHeight, c.customGalaxyDimensions]).toEqual([60, 60, true]);
        expect(c.maximumEmpireAmount).toBe(toCreateGameOptions(start({ starCountIndex: 5 }), gameData, names(10)).maximumEmpireAmount);
        // A hand-edited options object (?newgame= JSON) is clamped on read.
        expect(galaxyStarCount(start({ customStarCount: 9000, customSectorWidth: 2, customSectorHeight: 2 }))).toBe(400);
    });

    it('warns outside the original presets\' density range', () => {
        const o = start();
        setGalaxySectors(o, 90, 90);
        setGalaxyStarCount(o, 500);
        expect(galaxyDensityWarning(o)?.kind).toBe('sparse');
        setGalaxySectors(o, 3, 3);
        setGalaxyStarCount(o, 900);
        expect(galaxyDensityWarning(o)?.kind).toBe('dense');
        setGalaxySectors(o, 30, 30);
        setGalaxyStarCount(o, 4000);
        expect(galaxyDensityWarning(o)).toBeNull();
    });

    it('a custom size round-trips through the options JSON and a save', () => {
        const o = start();
        setGalaxySectors(o, 24, 18);
        setGalaxyStarCount(o, 333);
        const back = JSON.parse(JSON.stringify(o)) as StartGameOptions;
        expect(galaxySectorCounts(back)).toEqual({ width: 24, height: 18 });
        expect(galaxyStarCount(back)).toBe(333);
        const game = createGame(toCreateGameOptions(back, gameData, names(400)));
        const g = game.galaxy;
        expect([g.sectorWidth, g.sectorHeight, g.sizeX, g.sizeY, g.starCount]).toEqual([24, 18, 24 * g.sectorSize, 18 * g.sectorSize, 333]);
        const time = new GalaxyTime();
        time.togglePause();
        const text = serializeGame(game, time, back);
        const restored = deserializeGame(text, gameData);
        expect([restored.game.galaxy.sectorWidth, restored.game.galaxy.sectorHeight, restored.game.galaxy.sizeX]).toEqual([24, 18, g.sizeX]);
        expect(restored.game.galaxy.habitatIndexGrid.length).toBe(g.habitatIndexGrid.length);
        expect(stateDigest(restored.game.galaxy)).toBe(stateDigest(g));
        expect(galaxySectorCounts(restored.startOptions)).toEqual({ width: 24, height: 18 });
        expect(serializeGame(restored.game, restored.time, restored.startOptions)).toBe(text);
    }, 120000);
});

describe('extremes generate', () => {
    it('90 × 90 with 4000 stars, every star inside, index grids sized to the galaxy', () => {
        const g = generateGalaxy({ seed: 1, shape: GalaxyShape.Spiral, starCount: 4000, sectorWidth: 90, sectorHeight: 90, systemNames: names(4000), gameData, customGalaxyDimensions: true });
        expect([g.sectorWidth, g.sectorHeight]).toEqual([90, 90]);
        const stars = g.systems.filter((s) => s.systemStar.parent === null);
        expect(stars.length).toBeGreaterThanOrEqual(4000);
        for (const s of stars) {
            expect(s.systemStar.xpos).toBeGreaterThanOrEqual(0);
            expect(s.systemStar.xpos).toBeLessThanOrEqual(g.sizeX);
            expect(s.systemStar.ypos).toBeGreaterThanOrEqual(0);
            expect(s.systemStar.ypos).toBeLessThanOrEqual(g.sizeY);
        }
        expect(g.habitatIndexGrid.length).toBe(g.indexMaxX);
        expect(resolveSectorDescription(g, g.sizeX - 1, g.sizeY - 1)).toBe('CL90');
    }, 300000);

    it('a full game starts on 90 × 90 with 500 stars and on 1 × 1 with 100', () => {
        for (const [w, stars] of [[90, 500], [1, 100]] as const) {
            const o = start();
            setGalaxySectors(o, w, w);
            setGalaxyStarCount(o, stars);
            const game = createGame(toCreateGameOptions(o, gameData, names(stars)));
            expect([game.galaxy.sectorWidth, game.galaxy.starCount]).toEqual([w, stars]);
            expect(game.galaxy.playerEmpire?.capital).toBeTruthy();
        }
    }, 300000);

    it('a non-square galaxy keeps its ring / ellipse inside the rectangle', () => {
        for (const shape of [GalaxyShape.Ring, GalaxyShape.Elliptical]) {
            for (const [w, h] of [[60, 8], [8, 60]]) {
                const g = generateGalaxy({ seed: 2, shape, starCount: 300, sectorWidth: w, sectorHeight: h, systemNames: names(300), gameData, customGalaxyDimensions: true });
                const xs = g.systems.map((s) => s.systemStar.xpos / g.sizeX);
                const ys = g.systems.map((s) => s.systemStar.ypos / g.sizeY);
                const mean = (a: number[]): number => a.reduce((p, c) => p + c, 0) / a.length;
                // Centred on the rectangle (the C# square formula would centre one axis on the other's half-size).
                expect(Math.abs(mean(xs) - 0.5)).toBeLessThan(0.1);
                expect(Math.abs(mean(ys) - 0.5)).toBeLessThan(0.1);
            }
        }
    }, 300000);
});

describe('sector names past Z', () => {
    it('columns 0..25 are the C# letter, then AA, AB, …', () => {
        for (let i = 0; i < 26; i++) expect(sectorColumnName(i)).toBe(String.fromCharCode(65 + i));
        expect(sectorColumnName(26)).toBe('AA');
        expect(sectorColumnName(27)).toBe('AB');
        expect(sectorColumnName(51)).toBe('AZ');
        expect(sectorColumnName(52)).toBe('BA');
        expect(sectorColumnName(89)).toBe('CL');
        const seen = new Set<string>();
        for (let i = 0; i < CUSTOM_MAX_SECTORS; i++) {
            const n = sectorColumnName(i);
            expect(seen.has(n)).toBe(false);
            seen.add(n);
            expect(parseSectorColumn(`${n}12`)).toEqual({ column: i, rest: '12' });
        }
    });

    it('map labels thin out only past 15 sectors', () => {
        expect(sectorLabelStride(15, 2)).toBe(1);
        expect(sectorLabelStride(90, 600 / 90)).toBe(3);
        expect(sectorLabelStride(90, 40)).toBe(1);
    });
});
