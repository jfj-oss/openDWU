// Faithful Habitat.LandscapePictureRef (Galaxy.6.cs 1956-2272 SelectXxxPlanet / SelectHabitatPictures, GalaxyImages.cs
// 75-94; sim/galaxyImages.ts):
// - a seeded galaxy's refs lie in the C#'s GalaxyImages range for each habitat type (asteroids: barren rock; stars and
//   gas clouds: -1), and the seed-1 game uses every one of the 30 landscape pictures;
// - each selector draws Rnd as the C# does — diameter, picture, landscape (gas giants in SelectHabitatPictures:
//   landscape first) — one sample each, the landscape being Offset + Next(0, Count) of its own sample;
// - the port changed no draw: the generation's Rnd / CryptoRnd draw counts, the state digest and the whole saved state
//   with the landscape refs blanked were the values measured on the code before the port (commit c602b02); they moved
//   since with the faithful PictureRef and SetupSun's SelectHabitatPictures(star) call (2 Rnd draws per star,
//   Galaxy.5.cs 1328; see the pins' reason comments);
// - the UI uses the index directly (bitmap_29[ref]): every ref resolves to a file in the asset manifest, for the Galaxy
//   Map / Intelligence / message pictures (landscapes/) and the ground report (planetmaps/);
// - a save from before the port (test/fixtures/before-sim-message-pipeline.dwusave.gz, placeholder refs) loads with
//   each placeholder mapped to a faithful index of the same planet type — the picture the UI showed for it before —
//   and round-trips.
import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
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
import { LANDSCAPE_IMAGE_COUNT, LANDSCAPE_IMAGE_FOLDERS, landscapeImageRangeOfType, migrateLegacyLandscapePictureRef } from '../src/sim/galaxyImages';
import { RaceEventType, EventMessageType } from '../src/sim/eventTypes';
import { landscapeImageUrl } from '../src/ui/landscapeImages';
import { groundReportLandscape } from '../src/ui/screens/groundReportModel';
import { eventMessagePresentation } from '../src/ui/eventMessagePresentation';

const gameRoot = resolve(__dirname, '..');
const installLinked = existsSync(resolve(gameRoot, 'public', 'assets', 'dwu', 'images', 'environment', 'landscapes'));

let gameData: GameData;
let seed5: Galaxy;
let game: Game;
let traceGalaxy: Galaxy;
/** Measured right after generation (the draw-order tests below draw on traceGalaxy, a galaxy of their own). */
let measured: { seed5Draws: object; seed5Digest: string; seed5Habitats: string; seed1Draws: object; seed1Digest: string };
let manifest: Record<string, string[]>;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
    seed5 = generateGalaxy({ seed: 5, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`), gameData });
    // Own createGame (not cachedTickGame): the draw counters are not part of a cached (deserialized) copy.
    game = createGame(tickGameOptions(gameData));
    const habitats = seed5.habitats.map((h) => [h.name, h.category, h.type, h.diameter, h.pictureRef, h.xpos, h.ypos, h.baseQuality, h.resources]);
    measured = {
        seed5Draws: { rnd: seed5.rnd.drawCount, crypto: seed5.cryptoRnd.drawCount },
        seed5Digest: stateDigest(seed5),
        seed5Habitats: sha(JSON.stringify(habitats)),
        seed1Draws: { rnd: game.galaxy.rnd.drawCount, crypto: game.galaxy.cryptoRnd.drawCount },
        seed1Digest: stateDigest(game.galaxy),
    };
    traceGalaxy = generateGalaxy({ seed: 3, shape: GalaxyShape.Spiral, starCount: 20, sectorWidth: 2, sectorHeight: 2, systemNames: Array.from({ length: 20 }, (_, i) => `T${i}`), gameData });
    // A private manifest (other tests regenerate public/asset-manifest.json concurrently).
    const out = join(mkdtempSync(join(tmpdir(), 'dwu-manifest-')), 'asset-manifest.json');
    execFileSync('node', ['scripts/gen-asset-manifest.mjs'], { cwd: gameRoot, env: { ...process.env, ASSET_MANIFEST_OUT: out } });
    manifest = JSON.parse(readFileSync(out, 'utf-8')) as Record<string, string[]>;
}, 300000);

const sha = (s: string): string => createHash('sha1').update(s).digest('hex');

/** GalaxyImages.cs 75-94, written out: [first, last] landscape index the C# can give a planet / moon of each type. */
const CS_PLANET_RANGES: Partial<Record<HabitatType, readonly [number, number]>> = {
    [HabitatType.BarrenRock]: [0, 3],
    [HabitatType.Continental]: [4, 8], // SelectContinentalPlanet 4-7; SelectHabitatPictures adds the forest one (8)
    [HabitatType.FrozenGasGiant]: [9, 10],
    [HabitatType.GasGiant]: [11, 16],
    [HabitatType.Ice]: [17, 19],
    [HabitatType.MarshySwamp]: [20, 22],
    [HabitatType.Ocean]: [23, 24],
    [HabitatType.Desert]: [25, 27],
    [HabitatType.Volcanic]: [28, 29],
};

/** The C# range for a habitat (null = LandscapePictureRef -1). */
function csRange(h: Habitat): readonly [number, number] | null {
    switch (h.category) {
        case HabitatCategoryType.Star:
        case HabitatCategoryType.GasCloud:
            return null;
        case HabitatCategoryType.Asteroid:
            return [0, 3]; // every asteroid kind: LandscapeImageOffsetBarrenRock + Next(0, LandscapeImageCountBarrenRock)
        default: {
            const r = CS_PLANET_RANGES[h.type];
            if (r === undefined) throw new Error(`no C# landscape range for planet type ${h.type}`);
            return r;
        }
    }
}

describe('GalaxyImages landscape table (GalaxyImages.cs 75-94, Main.Part12.cs LoadEnvLandscapes)', () => {
    it('offsets are the running sums of the counts, in the LoadEnvLandscapes folder order', () => {
        expect(LANDSCAPE_IMAGE_FOLDERS.map((f) => [f.folder, f.offset, f.count])).toEqual([
            ['barrenrock', 0, 4], ['continental', 4, 4], ['forest', 8, 1], ['frozengasgiant', 9, 2], ['gasgiant', 11, 6],
            ['iceglacial', 17, 3], ['marshyswamp', 20, 3], ['ocean', 23, 2], ['sandydesert', 25, 3], ['volcanic', 28, 2],
        ]);
        let next = 0;
        for (const f of LANDSCAPE_IMAGE_FOLDERS) {
            expect(f.offset).toBe(next);
            next += f.count;
        }
        expect(LANDSCAPE_IMAGE_COUNT).toBe(30);
    });
    (installLinked ? it : it.skip)('each folder of the install has exactly its count of landscape_<i>.png', () => {
        for (const { folder, count } of LANDSCAPE_IMAGE_FOLDERS) {
            expect(manifest[`landscapes/${folder}`]).toEqual(Array.from({ length: count }, (_, i) => `landscape_${i}.png`));
        }
        expect(manifest['landscapes/other']).toBeUndefined(); // LoadEnvLandscapes' optional extra folder: none shipped
    });
});

describe('seeded galaxies store the C# landscape index', () => {
    for (const [name, galaxy] of [['seed 5 (generateGalaxy)', () => seed5], ['seed 1 (createGame)', () => game.galaxy]] as const) {
        it(`${name}: every habitat's ref lies in its type's GalaxyImages range`, () => {
            const bad: string[] = [];
            for (const h of galaxy().habitats) {
                const r = csRange(h);
                const ok = r === null ? h.landscapePictureRef === -1 : h.landscapePictureRef >= r[0] && h.landscapePictureRef <= r[1];
                if (!ok) bad.push(`${h.name} cat ${h.category} type ${h.type}: ${h.landscapePictureRef}`);
            }
            expect(bad).toEqual([]);
        });
    }
    it('the seed-1 game uses all 30 landscape pictures (each type its whole range)', () => {
        const used = new Set(game.galaxy.habitats.map((h) => h.landscapePictureRef).filter((r) => r >= 0));
        expect([...used].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    });
});

describe('draw order (Galaxy.6.cs SelectXxxPlanet / SelectHabitatPictures)', () => {
    const MBIG = 2147483647;
    /** Run fn on a galaxy with a tracer; the raw InternalSample values it drew. */
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

    it('SelectXxxPlanet: Next(diameter), the picture, then Offset + Next(0, Count) for the landscape — 3 draws', () => {
        const g = traceGalaxy;
        const cases: [string, number, number, readonly [number, number]][] = [
            ['selectBarrenRockPlanet', 80, 340, [0, 4]],
            ['selectContinentalPlanet', 200, 320, [4, 4]],
            ['selectIcePlanet', 180, 320, [17, 3]],
            ['selectMarshySwampPlanet', 200, 320, [20, 3]],
            ['selectOceanPlanet', 200, 320, [23, 2]],
            ['selectDesertPlanet', 180, 330, [25, 3]],
            ['selectVolcanicPlanet', 160, 330, [28, 2]],
            ['selectGasGiantPlanet', 550, 970, [11, 6]],
            ['selectFrozenGasGiantPlanet', 480, 680, [9, 2]],
        ];
        for (const [fn, dMin, dMax, [offset, count]] of cases) {
            for (let k = 0; k < 25; k++) {
                const before = g.rnd.drawCount;
                const { result, samples } = traced(g, () => (g as unknown as Record<string, () => { diameter: number; landscapePictureRef: number }>)[fn]());
                expect(g.rnd.drawCount - before, fn).toBe(3);
                expect(samples.length).toBe(3);
                expect(result.diameter).toBe(next(samples[0], dMin, dMax));
                expect(result.landscapePictureRef, fn).toBe(next(samples[2], 0, count) + offset);
            }
        }
    });

    it('SelectHabitatPictures: the landscape draw of each kind (Continental + Forest; gas giants draw it first)', () => {
        const g = traceGalaxy;
        const make = (category: HabitatCategoryType, type: HabitatType): Habitat => {
            const h = Object.create(Habitat.prototype) as Habitat;
            Object.assign(h, { category, type, resources: [], landscapePictureRef: -1, pictureRef: 0 });
            return h;
        };
        // [category, type, landscape sample index, offset, count]
        const cases: [HabitatCategoryType, HabitatType, number, number, number][] = [
            [HabitatCategoryType.Asteroid, HabitatType.BarrenRock, 1, 0, 4],
            [HabitatCategoryType.Asteroid, HabitatType.Ice, 1, 0, 4],
            [HabitatCategoryType.Asteroid, HabitatType.Metal, 1, 0, 4],
            [HabitatCategoryType.Planet, HabitatType.BarrenRock, 1, 0, 4],
            [HabitatCategoryType.Planet, HabitatType.Continental, 1, 4, 5],
            [HabitatCategoryType.Moon, HabitatType.Ice, 1, 17, 3],
            [HabitatCategoryType.Planet, HabitatType.MarshySwamp, 1, 20, 3],
            [HabitatCategoryType.Planet, HabitatType.Ocean, 1, 23, 2],
            [HabitatCategoryType.Planet, HabitatType.Desert, 1, 25, 3],
            [HabitatCategoryType.Planet, HabitatType.Volcanic, 1, 28, 2],
            [HabitatCategoryType.Planet, HabitatType.GasGiant, 0, 11, 6],
            [HabitatCategoryType.Planet, HabitatType.FrozenGasGiant, 0, 9, 2],
        ];
        for (const [category, type, at, offset, count] of cases) {
            for (let k = 0; k < 25; k++) {
                const h = make(category, type);
                const { samples } = traced(g, () => g.selectHabitatPictures(h));
                expect(samples.length, `${category}/${type}`).toBe(2);
                expect(h.landscapePictureRef, `${category}/${type}`).toBe(next(samples[at], 0, count) + offset);
            }
        }
    });

    it('generation draws as the C# (counts and state pinned; the landscape port itself changed no draw)', () => {
        // Values measured on commit c602b02 (placeholder landscape refs); the landscape port changed only the landscape
        // values. The draw counts / digests moved with SetupSun's SelectHabitatPictures(star) (Galaxy.5.cs 1328).
        // seed5Habitats and seed1SaveWithoutLandscapes also hold Habitat.PictureRef: re-measured after the faithful
        // pictureRef port, which test/habitatPictureRefs.test.ts checks with the picture refs blanked as well.
        // Moved {"rnd":175856,"crypto":364815} → {"rnd":169111,"crypto":352715}: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(measured.seed5Draws).toMatchPin('landscapeRefs.seed5Draws', {"rnd": 169111, "crypto": 352715});
        // Moved "92e5c3c9a325a220" → "563e841e53e25225": SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(measured.seed5Digest).toMatchPin('landscapeRefs.seed5Digest', "563e841e53e25225");
        // Moved #c1c7b97f32 → #3f3ecd6438: faithful habitat pictureRef (Galaxy.6.cs) (2026-10-04)
        // Moved #3f3ecd6438 → #49cd310363: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(measured.seed5Habitats).toMatchPin('landscapeRefs.seed5Habitats', "0c70d91aad0a30d6e5d939e033124dbc0a47d1c9");
        // Moved {"rnd":288729,"crypto":587179} → {"rnd":262043,"crypto":528421}: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(measured.seed1Draws).toMatchPin('landscapeRefs.seed1Draws', {"rnd": 262043, "crypto": 528421});
        // Moved "0cecc3d70b1487e6" → "4948f3713d8cdf2d": SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        // Moved "4948f3713d8cdf2d" → "906ac92570a441cc": galaxy long block clears the independent empire's never-processed message inbox (leak fix; only Empire.messages.length in the digest and the saved list change, RNG draws unchanged) (2026-10-10)
        expect(measured.seed1Digest).toMatchPin('landscapeRefs.seed1Digest', "906ac92570a441cc");
        // The whole saved game, landscape refs blanked (on a loaded copy, so `game` keeps its refs).
        const time = new GalaxyTime();
        time.togglePause();
        const start = { ...defaultStartGameOptions(), seed: 1 };
        const copy = deserializeGame(serializeGame(game, time, start), gameData);
        for (const h of copy.game.galaxy.habitats) h.landscapePictureRef = -2;
        // Moved #f49403b7b3 → #869ba44598: faithful habitat pictureRef (Galaxy.6.cs) (2026-10-04)
        // Moved #869ba44598 → #47ed84cdb0: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        // Moved #47ed84cdb0 → #2f99c2bee0: galaxy long block clears the independent empire's never-processed message inbox (leak fix; only Empire.messages.length in the digest and the saved list change, RNG draws unchanged) (2026-10-10)
        expect(sha(serializeGame(copy.game, copy.time, start))).toMatchPin('landscapeRefs.seed1SaveWithoutLandscapes', "ab7dde4eefdf4a51db84f65f539c35679328e90e");
    });
});

describe('the UI shows bitmap_29[LandscapePictureRef] directly', () => {
    const fileOf = (url: string): string => url.replace('/assets/dwu/images/environment/', '');
    const inManifest = (rel: string): boolean => {
        const slash = rel.lastIndexOf('/');
        return (manifest[rel.slice(0, slash)] ?? []).includes(rel.slice(slash + 1));
    };
    (installLinked ? it : it.skip)('every index 0-29 is a file of the asset manifest; -1 and 30+ show nothing', () => {
        for (let ref = 0; ref < LANDSCAPE_IMAGE_COUNT; ref++) {
            const url = landscapeImageUrl(ref);
            expect(url, `ref ${ref}`).not.toBeNull();
            expect(inManifest(fileOf(url!)), url!).toBe(true);
        }
        expect(landscapeImageUrl(-1)).toBeNull();
        expect(landscapeImageUrl(30)).toBeNull();
        expect(landscapeImageUrl(1401)).toBeNull(); // a placeholder is no index (migrated on load, see below)
    });
    (installLinked ? it : it.skip)('every landscaped habitat of the seed-1 game resolves to a manifest file of its own type', () => {
        const folderOfType: Partial<Record<HabitatType, string[]>> = {
            [HabitatType.BarrenRock]: ['barrenrock'], [HabitatType.Continental]: ['continental', 'forest'],
            [HabitatType.FrozenGasGiant]: ['frozengasgiant'], [HabitatType.GasGiant]: ['gasgiant'], [HabitatType.Ice]: ['iceglacial'],
            [HabitatType.MarshySwamp]: ['marshyswamp'], [HabitatType.Ocean]: ['ocean'], [HabitatType.Desert]: ['sandydesert'],
            [HabitatType.Volcanic]: ['volcanic'],
        };
        for (const h of game.galaxy.habitats) {
            const url = landscapeImageUrl(h.landscapePictureRef);
            if (h.landscapePictureRef < 0) {
                expect(url).toBeNull();
                continue;
            }
            expect(url, h.name).not.toBeNull();
            const rel = fileOf(url!);
            expect(inManifest(rel), rel).toBe(true);
            const folders = h.category === HabitatCategoryType.Asteroid ? ['barrenrock'] : folderOfType[h.type]!;
            expect(folders.some((f) => rel.startsWith(`landscapes/${f}/`)), `${h.name} (${h.type}) → ${rel}`).toBe(true);
        }
    });
    (installLinked ? it : it.skip)('the ground report (ColonyInvasion planet maps) reads the same index', () => {
        const names: Partial<Record<HabitatType, string>> = { [HabitatType.Volcanic]: 'Volcanic', [HabitatType.Desert]: 'Desert', [HabitatType.MarshySwamp]: 'MarshySwamp', [HabitatType.Continental]: 'Continental', [HabitatType.Ocean]: 'Ocean', [HabitatType.Ice]: 'Ice', [HabitatType.BarrenRock]: 'BarrenRock' };
        for (const h of game.galaxy.habitats) {
            if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
            const file = groundReportLandscape(names[h.type] ?? String(h.type), h.landscapePictureRef);
            expect(manifest.planetmaps.includes(file), `${h.name}: ${file}`).toBe(true);
        }
        // Its own picture now, not the type default: the second continental / ocean landscapes, the forest's jungle.
        expect(groundReportLandscape('Continental', 5)).toBe('continental2.png');
        expect(groundReportLandscape('Continental', 8)).toBe('jungle1.png');
        expect(groundReportLandscape('Ocean', 24)).toBe('ocean2.png');
    });
    it('the Underwater Leviathan race event shows bitmap_29[LandscapeImageOffsetOcean + 1] (Main.Part4.cs 1197)', () => {
        const p = eventMessagePresentation(EventMessageType.RaceEvent, RaceEventType.UnderwaterLeviathan, null, game.playerEmpire, game.galaxy);
        expect(p.picture).toEqual({ kind: 'landscape', ref: 24 });
        expect(landscapeImageUrl(24)).toBe('/assets/dwu/images/environment/landscapes/ocean/landscape_1.png');
    });
});

describe('saves from before the port (placeholder refs)', () => {
    /** The UI's pre-port resolver (ui/landscapeImages.ts resolveLandscapeRef, removed): what an old save showed. */
    function preportPicture(ref: number): number {
        if (ref < 30) return ref;
        const base = Math.trunc(ref / 100) * 100;
        const r = ({ 200: [0, 4], 400: [4, 4], 600: [17, 3], 800: [20, 3], 1000: [23, 2], 1200: [25, 3], 1400: [28, 2], 1600: [11, 6], 1800: [9, 2] } as Record<number, [number, number]>)[base];
        return r[0] + Math.min(r[1] - 1, Math.trunc(((((ref - base) % 10) + 0.5) * r[1]) / 10));
    }

    it('migrateLegacyLandscapePictureRef: placeholders to their type range; faithful refs kept; junk to the type default', () => {
        expect(migrateLegacyLandscapePictureRef(-1, HabitatType.MainSequence)).toBe(-1);
        expect(migrateLegacyLandscapePictureRef(5, HabitatType.Continental)).toBe(5);
        expect(migrateLegacyLandscapePictureRef(29, HabitatType.Volcanic)).toBe(29);
        expect(migrateLegacyLandscapePictureRef(400, HabitatType.Continental)).toBe(4);
        expect(migrateLegacyLandscapePictureRef(409, HabitatType.Continental)).toBe(7);
        expect(migrateLegacyLandscapePictureRef(1000, HabitatType.Ocean)).toBe(23);
        expect(migrateLegacyLandscapePictureRef(1009, HabitatType.Ocean)).toBe(24);
        expect(migrateLegacyLandscapePictureRef(1605, HabitatType.GasGiant)).toBe(14);
        expect(migrateLegacyLandscapePictureRef(1401, HabitatType.Volcanic)).toBe(28);
        expect(migrateLegacyLandscapePictureRef(209, HabitatType.Metal)).toBe(3); // an asteroid's barren-rock placeholder
        // Every placeholder the old selectors could store lands in its own type's range, as the old UI showed it.
        for (const base of [200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800]) {
            for (let t = 0; t < 10; t++) {
                const m = migrateLegacyLandscapePictureRef(base + t, HabitatType.Undefined);
                expect(m).toBe(preportPicture(base + t));
            }
        }
        // Out of range but no placeholder: the first picture of the habitat's type (none for a star).
        expect(migrateLegacyLandscapePictureRef(30, HabitatType.Desert)).toBe(25);
        expect(migrateLegacyLandscapePictureRef(3000, HabitatType.Ice)).toBe(17);
        expect(migrateLegacyLandscapePictureRef(215, HabitatType.Ocean)).toBe(23);
        expect(migrateLegacyLandscapePictureRef(3000, HabitatType.MainSequence)).toBe(-1);
        expect(landscapeImageRangeOfType(HabitatType.Metal)).toBeNull();
    });

    it('the pre-port fixture loads with faithful refs: the same pictures as before, and it round-trips', () => {
        const text = gunzipSync(readFileSync(join(__dirname, 'fixtures', 'before-sim-message-pipeline.dwusave.gz'))).toString('utf8');
        // The refs as saved: every Habitat {$s, $v} of the graph, by habitatIndex.
        const raw = JSON.parse(text) as { galaxy: { shapes: string[][]; galaxy: unknown } };
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
                    saved.set(f('habitatIndex'), { ref: f('landscapePictureRef'), type: f('type'), category: f('category') });
                }
            }
            for (const x of Object.values(o)) walk(x);
        };
        walk(raw.galaxy.galaxy);
        const placeholders = [...saved.values()].filter((s) => s.ref >= 30);
        expect(placeholders.length).toBeGreaterThan(1000);

        const { game: loaded, time, startOptions } = deserializeGame(text, gameData);
        const g = loaded.galaxy;
        expect(saved.size).toBe(g.habitats.length);
        const bad: string[] = [];
        for (const h of g.habitats) {
            const s = saved.get(h.habitatIndex)!;
            expect(s.type).toBe(h.type);
            const expected = s.ref >= 30 ? preportPicture(s.ref) : s.ref;
            if (h.landscapePictureRef !== expected) bad.push(`${h.name}: saved ${s.ref} → ${h.landscapePictureRef}, expected ${expected}`);
            const r = csRange(h);
            if (r === null ? h.landscapePictureRef !== -1 : h.landscapePictureRef < r[0] || h.landscapePictureRef > r[1]) bad.push(`${h.name} (${h.type}): ${h.landscapePictureRef} out of range`);
            if (h.landscapePictureRef >= 0 && landscapeImageUrl(h.landscapePictureRef) === null) bad.push(`${h.name}: no picture`);
        }
        expect(bad).toEqual([]);

        // Save → load → save: no placeholder left, the same text.
        const again = serializeGame(loaded, time, startOptions);
        const reloaded = deserializeGame(again, gameData);
        expect(reloaded.game.galaxy.habitats.every((h) => h.landscapePictureRef < 30)).toBe(true);
        expect(serializeGame(reloaded.game, reloaded.time, startOptions) === again).toBe(true);
    }, 300000);
});
