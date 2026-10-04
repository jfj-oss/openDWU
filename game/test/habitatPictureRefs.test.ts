// Faithful Habitat.PictureRef for planets, moons and asteroids (Galaxy.6.cs 1956-2272 SelectXxxPlanet /
// SelectHabitatPictures, Galaxy.5.cs / Galaxy.8.cs / Galaxy.9.cs asteroid draws; GalaxyImages.cs 11-58; the
// HabitatImageCache.cs GenerateHabitatImageFilepaths file order; sim/galaxyImages.ts):
// - the index table: offsets are the running sums of the counts in HabitatImageCache's order, 665 fixed pictures, and
//   each is a file of the install (asset manifest);
// - a seeded galaxy's refs lie in the C#'s range for each category and type (stars: the map-star range SetupSun's
//   SelectHabitatPictures draws, test/starMapPictureRefs.test.ts; gas clouds their own values), and every one resolves
//   to a manifest file (render/assets.ts habitatPictureUrl, the HabitatImageCache equivalent the Main View, the
//   selection panel and the lists use);
// - each selector draws Rnd as the C# does — one sample per picture, the picture being Offset + Next(0, Count) of its
//   own sample (SelectXxxPlanet: diameter, picture, landscape; SelectHabitatPictures: picture then landscape, gas
//   giants landscape / Next(0, 5) / picture);
// - the port changed no draw: the generation's Rnd / CryptoRnd draw counts, the state digests, the seed-5 habitats and
//   the whole seed-1 save with the picture refs blanked were the values measured on the code before the port (29dfa54);
//   they moved once since, deliberately, with SetupSun's SelectHabitatPictures(star) call (2 Rnd draws per star,
//   Galaxy.5.cs 1328; see the pins' reason comments);
// - a theme's planets/other pictures follow the 665 (HabitatImageOffsetOTHER + i), and a theme's copy of a fixed one is
//   used per file;
// - saves from before the port (no habitatPictureRefs marker; test/fixtures/before-sim-message-pipeline.dwusave.gz)
//   load with each planet / moon / asteroid ref mapped to the GalaxyImages index of the very picture the pre-port
//   renderer showed for it (its folder's file `ref mod n`), round-trip, and new saves are not migrated again.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

vi.mock('pixi.js', () => ({ Assets: { load: vi.fn() }, Texture: class {} }));

import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import { createGame, type Game } from '../src/sim/game';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { setGovernmentsStatic } from '../src/sim/empire';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { GalaxyShape, Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';
import {
    HABITAT_IMAGE_COUNT,
    HABITAT_IMAGE_SETS,
    PRE_PORT_HABITAT_FOLDERS,
    habitatImageFile,
    habitatImageRangeOf,
    migratePrePortPictureRef,
    prePortHabitatFolder,
} from '../src/sim/galaxyImages';
import { CustomizationSet, setActiveCustomizationSet } from '../src/sim/data/customization';
import { EventMessageType, RaceEventType } from '../src/sim/eventTypes';
import { eventMessagePresentation } from '../src/ui/eventMessagePresentation';

const { MANIFEST, habitatPictureUrl } = await import('../src/render/assets');

const gameRoot = resolve(__dirname, '..');
const installLinked = existsSync(resolve(gameRoot, 'public', 'assets', 'dwu', 'images', 'environment', 'planets'));
const sha = (s: string): string => createHash('sha1').update(s).digest('hex');

let gameData: GameData;
let seed5: Galaxy;
let game: Game;
let traceGalaxy: Galaxy;
let measured: { seed5Draws: object; seed5Digest: string; seed5HabitatsWithoutPictures: string; seed1Draws: object; seed1Digest: string };
let manifest: Record<string, string[]>;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
    seed5 = generateGalaxy({ seed: 5, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`), gameData });
    // Own createGame (not cachedTickGame): the draw counters are not part of a cached (deserialized) copy.
    game = createGame(tickGameOptions(gameData));
    const habitats = seed5.habitats.map((h) => [h.name, h.category, h.type, h.diameter, h.xpos, h.ypos, h.baseQuality, h.resources, h.landscapePictureRef]);
    measured = {
        seed5Draws: { rnd: seed5.rnd.drawCount, crypto: seed5.cryptoRnd.drawCount },
        seed5Digest: stateDigest(seed5),
        seed5HabitatsWithoutPictures: sha(JSON.stringify(habitats)),
        seed1Draws: { rnd: game.galaxy.rnd.drawCount, crypto: game.galaxy.cryptoRnd.drawCount },
        seed1Digest: stateDigest(game.galaxy),
    };
    traceGalaxy = generateGalaxy({ seed: 3, shape: GalaxyShape.Spiral, starCount: 20, sectorWidth: 2, sectorHeight: 2, systemNames: Array.from({ length: 20 }, (_, i) => `T${i}`), gameData });
    // A private manifest (other tests regenerate public/asset-manifest.json concurrently).
    const out = join(mkdtempSync(join(tmpdir(), 'dwu-manifest-')), 'asset-manifest.json');
    execFileSync('node', ['scripts/gen-asset-manifest.mjs'], { cwd: gameRoot, env: { ...process.env, ASSET_MANIFEST_OUT: out } });
    manifest = JSON.parse(readFileSync(out, 'utf-8')) as Record<string, string[]>;
}, 300000);

/** GalaxyImages.cs 11-58, written out: [first, last] picture index the C# can give each category / type. */
const CS_PLANET_RANGES: Partial<Record<HabitatType, readonly [number, number]>> = {
    [HabitatType.BarrenRock]: [0, 20],
    [HabitatType.Continental]: [21, 66], // SelectContinentalPlanet 21-40; SelectHabitatPictures adds the 26 forest (41-66)
    [HabitatType.FrozenGasGiant]: [67, 120], // Argon 67, Helium 77, Krypton 87, Tyderios 98, Any 111-120
    [HabitatType.GasGiant]: [121, 153], // Argon 121, Caslon 126, Helium 131, Hydrogen 139, Krypton 147, Any 152-153
    [HabitatType.Ice]: [154, 171],
    [HabitatType.MarshySwamp]: [172, 189],
    [HabitatType.Ocean]: [190, 203],
    [HabitatType.Desert]: [204, 228],
    [HabitatType.Volcanic]: [229, 248],
};
const CS_ASTEROID_RANGES: Partial<Record<HabitatType, readonly [number, number]>> = {
    [HabitatType.BarrenRock]: [249, 448], // AsteroidsNormal
    [HabitatType.Ice]: [449, 548],
    [HabitatType.Metal]: [549, 664], // AsteroidsMetal 549-648; GenerateTreasureAsteroid gold 649-656, crystal 657-664
};
/** A star's PictureRef: SetupSun's SelectHabitatPictures draw, MapStarImageOffsetX + Next(0, MapStarImageCountX)
 *  (Galaxy.6.cs 2214-2237: 0-13), a super nova SelectStar's 0; in a save from before that port, SelectStar's own values. */
const STAR_REFS = new Set(Array.from({ length: 14 }, (_, i) => i));
const PRE_PORT_STAR_REFS = new Set([0, 83, 84, 85, 86, 87, 88, 95]);

/** The C# range of a planet / moon / asteroid, null for stars and gas clouds. */
function csRange(h: Habitat): readonly [number, number] | null {
    if (h.category === HabitatCategoryType.Star || h.category === HabitatCategoryType.GasCloud) return null;
    const r = (h.category === HabitatCategoryType.Asteroid ? CS_ASTEROID_RANGES : CS_PLANET_RANGES)[h.type];
    if (r === undefined) throw new Error(`no C# picture range for category ${h.category} type ${h.type}`);
    return r;
}
function badRefs(habitats: readonly Habitat[], prePortStars = false): string[] {
    const bad: string[] = [];
    for (const h of habitats) {
        const r = csRange(h);
        let ok: boolean;
        if (r !== null) ok = Number.isInteger(h.pictureRef) && h.pictureRef >= r[0] && h.pictureRef <= r[1];
        else if (h.category === HabitatCategoryType.Star) ok = (prePortStars ? PRE_PORT_STAR_REFS : STAR_REFS).has(h.pictureRef);
        else ok = h.pictureRef >= 71 && h.pictureRef <= 82;
        if (!ok) bad.push(`${h.name} cat ${h.category} type ${h.type}: ${h.pictureRef}`);
    }
    return bad;
}

const inManifest = (rel: string): boolean => {
    const slash = rel.lastIndexOf('/');
    return (manifest[rel.slice(0, slash)] ?? []).includes(rel.slice(slash + 1));
};

describe('GalaxyImages habitat table (GalaxyImages.cs 11-58, HabitatImageCache.cs GenerateHabitatImageFilepaths)', () => {
    it('offsets are the running sums of the counts, in HabitatImageCache file order; 665 fixed pictures', () => {
        expect(HABITAT_IMAGE_SETS.map((s) => [s.prefix, s.offset, s.count])).toEqual([
            ['Barren', 0, 21], ['Continental', 21, 20], ['Forest', 41, 26], ['FrozenGasAr', 67, 10], ['FrozenGasHe', 77, 10],
            ['FrozenGasKr', 87, 11], ['FrozenGasTy', 98, 13], ['FrozenGasOt', 111, 10], ['GasGiantAr', 121, 5], ['GasGiantCa', 126, 5],
            ['GasGiantHe', 131, 8], ['GasGiantHy', 139, 8], ['GasGiantKr', 147, 5], ['GasGiantOt', 152, 2], ['Glacial', 154, 18],
            ['Marsh', 172, 18], ['Ocean', 190, 14], ['Desert', 204, 25], ['Volcanic', 229, 20], ['AstRck', 249, 200], ['AstIce', 449, 100],
            ['AstMtl', 549, 100], ['AstGold', 649, 8], ['AstCryst', 657, 8],
        ]);
        let next = 0;
        for (const s of HABITAT_IMAGE_SETS) {
            expect(s.offset).toBe(next);
            next += s.count;
        }
        expect(HABITAT_IMAGE_COUNT).toBe(665); // HabitatImageOffsetOTHER
        expect(habitatImageFile(0)).toBe('planets/barrenrock/Barren-0001.png');
        expect(habitatImageFile(41)).toBe('planets/forest/Forest-0001.png');
        expect(habitatImageFile(120)).toBe('planets/frozengasgiant/FrozenGasOt-0010.png');
        expect(habitatImageFile(664)).toBe('asteroids/metal/AstCryst-0008.png');
        expect(habitatImageFile(665)).toBeNull();
        expect(habitatImageFile(-1)).toBeNull();
    });
    (installLinked ? it : it.skip)('every one of the 665 pictures is a file of the install (asset manifest)', () => {
        const missing: string[] = [];
        for (let ref = 0; ref < HABITAT_IMAGE_COUNT; ref++) if (!inManifest(habitatImageFile(ref)!)) missing.push(`${ref}: ${habitatImageFile(ref)}`);
        expect(missing).toEqual([]);
        expect(manifest['planets/other'] ?? []).toEqual([]); // only a theme's planets/other is appended (HabitatImageCache 334)
    });
});

describe('seeded galaxies store the C# picture index', () => {
    for (const [name, galaxy] of [['seed 5 (generateGalaxy)', () => seed5], ['seed 1 (createGame)', () => game.galaxy]] as const) {
        it(`${name}: every habitat's ref lies in its category / type's GalaxyImages range`, () => {
            expect(badRefs(galaxy().habitats)).toEqual([]);
        });
    }
    it('the seed-1 game spreads over each type range (the whole Next(0, Count), not 10 values)', () => {
        const byType = new Map<string, Set<number>>();
        for (const h of game.galaxy.habitats) {
            if (csRange(h) === null) continue;
            const k = `${h.category === HabitatCategoryType.Asteroid ? 'asteroid' : 'planet'}:${h.type}`;
            if (!byType.has(k)) byType.set(k, new Set());
            byType.get(k)!.add(h.pictureRef);
        }
        // Seed 1 (since SetupSun's star picture draws): all 21 barren rock pictures, 22 of the 25 desert ones, both the
        // continental and the forest pictures (SelectHabitatPictures: 21-66), all 200 rocky asteroids — not 10 values.
        expect(byType.get(`planet:${HabitatType.BarrenRock}`)!.size).toBe(21);
        expect(byType.get(`planet:${HabitatType.Desert}`)!.size).toBeGreaterThan(20);
        const continental = [...byType.get(`planet:${HabitatType.Continental}`)!];
        expect(continental.some((r) => r < 41) && continental.some((r) => r >= 41)).toBe(true); // the forest pictures too
        expect(continental.length).toBeGreaterThan(10);
        expect(byType.get(`asteroid:${HabitatType.BarrenRock}`)!.size).toBe(200);
    });
    (installLinked ? it : it.skip)('every planet / moon / asteroid ref resolves to a manifest file (habitatPictureUrl, the HabitatImageCache)', () => {
        Object.assign(MANIFEST, manifest);
        const bad: string[] = [];
        for (const h of game.galaxy.habitats) {
            if (csRange(h) === null) continue;
            const file = habitatImageFile(h.pictureRef);
            const url = habitatPictureUrl(h.pictureRef);
            if (file === null || !inManifest(file) || url !== `/assets/dwu/images/environment/${file}`) bad.push(`${h.name}: ${h.pictureRef} -> ${url}`);
        }
        expect(bad).toEqual([]);
    });
    it('habitatImageRangeOf agrees with the written-out C# ranges', () => {
        for (const [types, category] of [[CS_PLANET_RANGES, HabitatCategoryType.Planet], [CS_PLANET_RANGES, HabitatCategoryType.Moon], [CS_ASTEROID_RANGES, HabitatCategoryType.Asteroid]] as const) {
            for (const [type, [first, last]] of Object.entries(types)) expect(habitatImageRangeOf(category, Number(type) as HabitatType)).toEqual([first, last - first + 1]);
        }
        expect(habitatImageRangeOf(HabitatCategoryType.Star, HabitatType.MainSequence)).toBeNull();
        expect(habitatImageRangeOf(HabitatCategoryType.GasCloud, HabitatType.Hydrogen)).toBeNull();
    });
});

describe('draw order (Galaxy.6.cs SelectXxxPlanet / SelectHabitatPictures)', () => {
    const MBIG = 2147483647;
    function traced<T>(g: Galaxy, fn: () => T): { result: T; samples: number[] } {
        const samples: number[] = [];
        g.rnd.setTrace((v) => samples.push(v));
        try {
            return { result: fn(), samples };
        } finally {
            g.rnd.setTrace(null);
        }
    }
    const next = (sample: number, min: number, max: number): number => Math.trunc(sample * (1 / MBIG) * (max - min)) + min;

    it('SelectXxxPlanet: Next(diameter), then Offset + Next(0, Count) for the picture, then the landscape — 3 draws', () => {
        const g = traceGalaxy;
        const cases: [string, number, number, readonly [number, number]][] = [
            ['selectBarrenRockPlanet', 80, 340, [0, 21]],
            ['selectContinentalPlanet', 200, 320, [21, 20]], // Galaxy.6.cs 1983: Continental only, no forest
            ['selectIcePlanet', 180, 320, [154, 18]],
            ['selectMarshySwampPlanet', 200, 320, [172, 18]],
            ['selectOceanPlanet', 200, 320, [190, 14]],
            ['selectDesertPlanet', 180, 330, [204, 25]],
            ['selectVolcanicPlanet', 160, 330, [229, 20]],
            ['selectGasGiantPlanet', 550, 970, [121, 33]], // 2254: Any + Argon + Caslon + Helium + Hydrogen + Krypton
            ['selectFrozenGasGiantPlanet', 480, 680, [67, 54]], // 2270: Any + Argon + Helium + Krypton + Tyderios
        ];
        for (const [fn, dMin, dMax, [offset, count]] of cases) {
            for (let k = 0; k < 40; k++) {
                const before = g.rnd.drawCount;
                const { result, samples } = traced(g, () => (g as unknown as Record<string, () => { diameter: number; pictureRef: number }>)[fn]());
                expect(g.rnd.drawCount - before, fn).toBe(3);
                expect(samples.length).toBe(3);
                expect(result.diameter).toBe(next(samples[0], dMin, dMax));
                expect(result.pictureRef, fn).toBe(next(samples[1], 0, count) + offset);
            }
        }
    });

    it('SelectHabitatPictures: the picture draw of each asteroid / planet kind (picture first, then the landscape)', () => {
        const g = traceGalaxy;
        const make = (category: HabitatCategoryType, type: HabitatType): Habitat => {
            const h = Object.create(Habitat.prototype) as Habitat;
            Object.assign(h, { category, type, resources: [], landscapePictureRef: -1, pictureRef: 0 });
            return h;
        };
        // [category, type, offset, count] — the picture is the first of the two samples.
        const cases: [HabitatCategoryType, HabitatType, number, number][] = [
            [HabitatCategoryType.Asteroid, HabitatType.BarrenRock, 249, 200],
            [HabitatCategoryType.Asteroid, HabitatType.Ice, 449, 100],
            [HabitatCategoryType.Asteroid, HabitatType.Metal, 549, 100],
            [HabitatCategoryType.Asteroid, HabitatType.Undefined, 249, 200], // default: AsteroidsNormal
            [HabitatCategoryType.Planet, HabitatType.BarrenRock, 0, 21],
            [HabitatCategoryType.Planet, HabitatType.Continental, 21, 46], // 2094: Continental + Forest
            [HabitatCategoryType.Moon, HabitatType.Ice, 154, 18],
            [HabitatCategoryType.Planet, HabitatType.MarshySwamp, 172, 18],
            [HabitatCategoryType.Planet, HabitatType.Ocean, 190, 14],
            [HabitatCategoryType.Planet, HabitatType.Desert, 204, 25],
            [HabitatCategoryType.Planet, HabitatType.Volcanic, 229, 20],
            [HabitatCategoryType.Planet, HabitatType.GasGiant, 121, 33], // no resources: landscape, then every set (2190)
            [HabitatCategoryType.Planet, HabitatType.FrozenGasGiant, 67, 54], // 2140
        ];
        for (const [category, type, offset, count] of cases) {
            const at = type === HabitatType.GasGiant || type === HabitatType.FrozenGasGiant ? 1 : 0;
            for (let k = 0; k < 40; k++) {
                const h = make(category, type);
                const { samples } = traced(g, () => g.selectHabitatPictures(h));
                expect(samples.length, `${category}/${type}`).toBe(2);
                expect(h.pictureRef, `${category}/${type}`).toBe(next(samples[at], 0, count) + offset);
            }
        }
    });

    it('SelectHabitatPictures gas giants with resources: landscape, Next(0, 5) (1: Any), else the most abundant gas set', () => {
        const g = traceGalaxy;
        const id = (name: string): number => (g as unknown as { getResourceByName(n: string): { resourceId: number } | null }).getResourceByName(name)!.resourceId;
        // [type, dominant resource, offset, count]
        const cases: [HabitatType, string, number, number][] = [
            [HabitatType.FrozenGasGiant, 'Argon', 67, 10],
            [HabitatType.FrozenGasGiant, 'Helium', 77, 10],
            [HabitatType.FrozenGasGiant, 'Krypton', 87, 11],
            [HabitatType.FrozenGasGiant, 'Tyderios', 98, 13],
            [HabitatType.FrozenGasGiant, 'Hydrogen', 67, 54], // default: every set
            [HabitatType.GasGiant, 'Argon', 121, 5],
            [HabitatType.GasGiant, 'Caslon', 126, 5],
            [HabitatType.GasGiant, 'Helium', 131, 8],
            [HabitatType.GasGiant, 'Hydrogen', 139, 8],
            [HabitatType.GasGiant, 'Krypton', 147, 5],
            [HabitatType.GasGiant, 'Tyderios', 121, 33], // default
        ];
        const anySet: Partial<Record<HabitatType, readonly [number, number]>> = { [HabitatType.FrozenGasGiant]: [111, 10], [HabitatType.GasGiant]: [152, 2] };
        let anyHits = 0;
        for (const [type, gas, offset, count] of cases) {
            for (let k = 0; k < 40; k++) {
                const h = Object.create(Habitat.prototype) as Habitat;
                Object.assign(h, { category: HabitatCategoryType.Planet, type, resources: [{ resourceId: id(gas), abundance: 900 }, { resourceId: id('Argon') === id(gas) ? id('Krypton') : id('Argon'), abundance: 100 }], landscapePictureRef: -1, pictureRef: 0 });
                const { samples } = traced(g, () => g.selectHabitatPictures(h));
                expect(samples.length).toBe(3);
                if (next(samples[1], 0, 5) === 1) {
                    anyHits++;
                    const [o, c] = anySet[type]!;
                    expect(h.pictureRef).toBe(next(samples[2], 0, c) + o);
                } else {
                    expect(h.pictureRef, `${type}/${gas}`).toBe(next(samples[2], 0, count) + offset);
                }
            }
        }
        expect(anyHits).toBeGreaterThan(0);
    });

    it('generation draws as the C# (counts and state pinned; the PictureRef port itself changed no draw)', () => {
        // Values measured on commit 29dfa54 (placeholder picture refs); the PictureRef port changed only the picture
        // values. They moved with SetupSun's SelectHabitatPictures(star) (Galaxy.5.cs 1328): 2 more Rnd draws per star
        // (none for a super nova), which shift every later sample of the generation.
        // Moved {"rnd":175856,"crypto":364815} → {"rnd":169111,"crypto":352715}: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(measured.seed5Draws).toMatchPin('pictureRefs.seed5Draws', {"rnd": 169111, "crypto": 352715});
        // Moved "92e5c3c9a325a220" → "563e841e53e25225": SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(measured.seed5Digest).toMatchPin('pictureRefs.seed5Digest', "563e841e53e25225");
        // Moved #b9b595ffcb → #3a26d844ee: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(measured.seed5HabitatsWithoutPictures).toMatchPin('pictureRefs.seed5HabitatsWithoutPictures', "a1a3e179c8958a632f94a36c4700a84da6a17a95");
        // Moved {"rnd":288729,"crypto":587179} → {"rnd":262043,"crypto":528421}: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(measured.seed1Draws).toMatchPin('pictureRefs.seed1Draws', {"rnd": 262043, "crypto": 528421});
        // Moved "0cecc3d70b1487e6" → "4948f3713d8cdf2d": SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(measured.seed1Digest).toMatchPin('pictureRefs.seed1Digest', "4948f3713d8cdf2d");
        // The whole saved game with every picture ref blanked and the save markers removed (on a loaded copy).
        const time = new GalaxyTime();
        time.togglePause();
        const start = { ...defaultStartGameOptions(), seed: 1 };
        const copy = deserializeGame(serializeGame(game, time, start), gameData);
        for (const h of copy.game.galaxy.habitats) {
            h.pictureRef = -2;
            h.mapPictureRef = -2;
            h.landscapePictureRef = -2;
        }
        const obj = JSON.parse(serializeGame(copy.game, copy.time, start)) as { galaxy: { habitatPictureRefs?: string; habitatMapPictureRefs?: string } };
        expect(obj.galaxy.habitatPictureRefs).toBe('GalaxyImages');
        expect(obj.galaxy.habitatMapPictureRefs).toBe('MapStarImages');
        delete obj.galaxy.habitatPictureRefs;
        delete obj.galaxy.habitatMapPictureRefs;
        // Moved #91c58990ed → #ff3777c6bb: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(sha(JSON.stringify(obj))).toMatchPin('pictureRefs.seed1SaveWithoutPictures', "4139f9fa81a480bf7f5e3e80849933529785fdb5");
    }, 300000);
});

describe('the UI uses the index directly', () => {
    it('race events: habitatImageCache.ObtainImage(HabitatImageOffsetOcean + 1) / (HabitatImageOffsetContinental + 1) (Main.Part4.cs 1188 / 1208)', () => {
        const wine = eventMessagePresentation(EventMessageType.RaceEvent, RaceEventType.NepthysWineVintage, null, game.playerEmpire, game.galaxy).picture;
        expect(wine).toMatchObject({ kind: 'pair', left: { kind: 'habitatPicture', ref: 191 } });
        expect(habitatImageFile(191)).toBe('planets/ocean/Ocean-0002.png');
        const harmony = eventMessagePresentation(EventMessageType.RaceEvent, RaceEventType.NaturalHarmonyColonyQualityIncreased, null, game.playerEmpire, game.galaxy).picture;
        expect(harmony).toEqual({ kind: 'habitatPicture', ref: 22 });
        expect(habitatImageFile(22)).toBe('planets/continental/Continental-0002.png');
    });
    it("a theme's planets/other pictures follow the 665 fixed ones; a theme's copy of a fixed picture is used per file", () => {
        for (const k of Object.keys(MANIFEST)) delete MANIFEST[k];
        MANIFEST['planets/barrenrock'] = ['Barren-0001.png'];
        const set = new CustomizationSet({
            set: 'Test Theme',
            files: ['images/environment/planets/other/Zeta.png', 'images/environment/planets/other/alpha.png', 'images/environment/planets/other/notes.txt', 'images/environment/planets/ocean/Ocean-0001.png'],
        } as unknown as ConstructorParameters<typeof CustomizationSet>[0]);
        try {
            expect(habitatPictureUrl(665)).toBeNull(); // no theme: nothing past the table
            setActiveCustomizationSet(set);
            // Directory.GetFiles(other, "*.png") in Windows order: alpha, Zeta.
            expect(habitatPictureUrl(665)).toContain('/planets/other/alpha.png');
            expect(habitatPictureUrl(666)).toContain('/planets/other/Zeta.png');
            expect(habitatPictureUrl(667)).toBeNull();
            // Ocean-0001 is missing from this manifest but the theme has it (GetFilePathForImage: the set's file).
            expect(habitatPictureUrl(190)).toBe('/assets/dwu/images/environment/planets/ocean/Ocean-0001.png');
            expect(habitatPictureUrl(0)).toBe('/assets/dwu/images/environment/planets/barrenrock/Barren-0001.png');
            expect(habitatPictureUrl(1)).toBeNull();
        } finally {
            setActiveCustomizationSet(null);
            for (const k of Object.keys(MANIFEST)) delete MANIFEST[k];
        }
    });
});

describe('saves from before the port (placeholder refs)', () => {
    /** HabitatImageCache file name -> GalaxyImages index. */
    const indexOfFile = new Map<string, number>();
    for (let ref = 0; ref < HABITAT_IMAGE_COUNT; ref++) indexOfFile.set(habitatImageFile(ref)!, ref);

    (installLinked ? it : it.skip)('PRE_PORT_HABITAT_FOLDERS is the install folder listing the old renderer indexed', () => {
        for (const [folder, segments] of Object.entries(PRE_PORT_HABITAT_FOLDERS)) {
            const decoded: number[] = [];
            for (const [first, run] of segments) for (let i = 0; i < run; i++) decoded.push(first < 0 ? -1 : first + i);
            expect(decoded, folder).toEqual(manifest[folder].map((f) => indexOfFile.get(`${folder}/${f}`) ?? -1));
        }
    });

    it('migratePrePortPictureRef: the file `ref mod n` of the old folder; files outside the table to the type range', () => {
        // Barren rock placeholder 100 + t: planets/barrenrock has 26 files, 100 % 26 = 22 -> Barren-0023 (not in the
        // C# table) -> range 0 + (22 % 21) = 1; 104 % 26 = 0 -> Barren-0001 = 0.
        expect(migratePrePortPictureRef(104, HabitatCategoryType.Planet, HabitatType.BarrenRock)).toBe(0);
        expect(migratePrePortPictureRef(100, HabitatCategoryType.Planet, HabitatType.BarrenRock)).toBe(1);
        // Desert 1105 % 30 = 25 -> Desert-0026 (outside) -> 204 + 25 % 25; 1100 % 30 = 20 -> Desert-0021 = 224.
        expect(migratePrePortPictureRef(1100, HabitatCategoryType.Moon, HabitatType.Desert)).toBe(224);
        expect(migratePrePortPictureRef(1105, HabitatCategoryType.Moon, HabitatType.Desert)).toBe(204);
        // A pre-port gas giant already held a GalaxyImages value, shown modulo the 66-file folder: 126 % 66 = 60.
        expect(migratePrePortPictureRef(126, HabitatCategoryType.Planet, HabitatType.GasGiant)).toBe(148);
        // Asteroids: 2002 % 200 = 2 -> AstRck-0003 = 251; metal 2206 % 116 = 2 -> AstCryst-0003 = 659; a treasure
        // asteroid's 649 % 116 = 69 -> AstMtl-0054 = 602.
        expect(migratePrePortPictureRef(2002, HabitatCategoryType.Asteroid, HabitatType.BarrenRock)).toBe(251);
        expect(migratePrePortPictureRef(2206, HabitatCategoryType.Asteroid, HabitatType.Metal)).toBe(659);
        expect(migratePrePortPictureRef(649, HabitatCategoryType.Asteroid, HabitatType.Metal)).toBe(602);
        // Stars and gas clouds keep theirs.
        expect(migratePrePortPictureRef(83, HabitatCategoryType.Star, HabitatType.MainSequence)).toBe(83);
        expect(migratePrePortPictureRef(79, HabitatCategoryType.GasCloud, HabitatType.Hydrogen)).toBe(79);
        expect(prePortHabitatFolder(HabitatCategoryType.Planet, HabitatType.Undefined)).toBe('planets/ocean'); // PLANET_FOLDERS ?? 'ocean'
        // Every placeholder of every type lands in the type's C# range.
        for (const [type, base] of [[HabitatType.BarrenRock, 100], [HabitatType.Continental, 300], [HabitatType.Ice, 500], [HabitatType.MarshySwamp, 700], [HabitatType.Ocean, 900], [HabitatType.Desert, 1100], [HabitatType.Volcanic, 1300], [HabitatType.GasGiant, 1500], [HabitatType.FrozenGasGiant, 1700]] as const) {
            const [first, last] = CS_PLANET_RANGES[type]!;
            for (let t = 0; t < 10; t++) {
                const m = migratePrePortPictureRef(base + t, HabitatCategoryType.Planet, type);
                expect(m >= first && m <= last, `${type} ${base + t} -> ${m}`).toBe(true);
            }
        }
    });

    it('the pre-port fixture loads with faithful refs: the picture the old renderer showed, and it round-trips', () => {
        const text = gunzipSync(readFileSync(join(__dirname, 'fixtures', 'before-sim-message-pipeline.dwusave.gz'))).toString('utf8');
        const raw = JSON.parse(text) as { galaxy: { shapes: string[][]; galaxy: unknown; habitatPictureRefs?: string } };
        expect(raw.galaxy.habitatPictureRefs).toBeUndefined();
        const saved = new Map<number, { ref: number; type: number; category: number }>();
        const walk = (v: unknown): void => {
            if (Array.isArray(v)) {
                for (const x of v) walk(x);
                return;
            }
            if (v === null || typeof v !== 'object') return;
            const o = v as Record<string, unknown>;
            if (typeof o.$s === 'number' && Array.isArray(o.$v)) {
                const shape = raw.galaxy.shapes[o.$s];
                if (shape[0] === 'Habitat') {
                    const values = o.$v as unknown[];
                    const f = (name: string): number => values[shape.indexOf(name) - 1] as number;
                    saved.set(f('habitatIndex'), { ref: f('pictureRef'), type: f('type'), category: f('category') });
                }
            }
            for (const x of Object.values(o)) walk(x);
        };
        walk(raw.galaxy.galaxy);
        expect([...saved.values()].filter((s) => s.ref >= 1000).length).toBeGreaterThan(500); // placeholders

        const { game: loaded, time, startOptions } = deserializeGame(text, gameData);
        const g = loaded.galaxy;
        expect(saved.size).toBe(g.habitats.length);
        expect(badRefs(g.habitats, true)).toEqual([]);
        const bad: string[] = [];
        let same = 0;
        let outside = 0;
        for (const h of g.habitats) {
            const s = saved.get(h.habitatIndex)!;
            expect(s.type).toBe(h.type);
            const folder = prePortHabitatFolder(h.category, h.type);
            if (folder === null) {
                if (h.pictureRef !== s.ref) bad.push(`${h.name}: star / cloud ref changed ${s.ref} -> ${h.pictureRef}`);
                continue;
            }
            if (!installLinked) continue;
            // The old renderer: render/assets.ts pickFromFolder(folder, ref) over the install's sorted listing.
            const files = manifest[folder];
            const shown = `${folder}/${files[((s.ref % files.length) + files.length) % files.length]}`;
            const index = indexOfFile.get(shown);
            if (index !== undefined) {
                same++;
                if (h.pictureRef !== index) bad.push(`${h.name}: saved ${s.ref} showed ${shown} (${index}), migrated to ${h.pictureRef}`);
            } else {
                outside++; // a file outside the C# table: the type range (checked by badRefs above)
            }
        }
        expect(bad).toEqual([]);
        if (installLinked) {
            // 968 of the fixture's 1080 planets / moons / asteroids keep their picture exactly; 112 showed a file outside
            // the C# table.
            expect(same + outside).toBe(g.habitats.filter((h) => csRange(h) !== null).length);
            expect(same).toBeGreaterThan(5 * outside);
        }

        // Save -> load -> save: the marker is written, nothing is migrated twice, the same text.
        const again = serializeGame(loaded, time, startOptions);
        expect((JSON.parse(again) as { galaxy: { habitatPictureRefs?: string } }).galaxy.habitatPictureRefs).toBe('GalaxyImages');
        const reloaded = deserializeGame(again, gameData);
        expect(reloaded.game.galaxy.habitats.map((h) => h.pictureRef)).toEqual(g.habitats.map((h) => h.pictureRef));
        expect(serializeGame(reloaded.game, reloaded.time, startOptions) === again).toBe(true);
    }, 300000);

    it('a new save keeps its refs; the same save without the marker would be migrated (the marker gates it)', () => {
        const time = new GalaxyTime();
        const start = { ...defaultStartGameOptions(), seed: 1 };
        const text = serializeGame(game, time, start);
        const refs = game.galaxy.habitats.map((h) => h.pictureRef);
        expect(deserializeGame(text, gameData).game.galaxy.habitats.map((h) => h.pictureRef)).toEqual(refs);
        const obj = JSON.parse(text) as { galaxy: { habitatPictureRefs?: string } };
        delete obj.galaxy.habitatPictureRefs;
        const old = deserializeGame(JSON.stringify(obj), gameData).game.galaxy.habitats.map((h) => h.pictureRef);
        expect(old.filter((r, i) => r !== refs[i]).length).toBeGreaterThan(1000);
    }, 300000);
});
