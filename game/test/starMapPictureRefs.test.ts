// Habitat.MapPictureRef and the star's SelectHabitatPictures call (Galaxy.5.cs SetupSun 1320-1328; Galaxy.6.cs SelectStar
// 2525, SelectHabitatPictures 2214-2238; Galaxy.4.cs GenerateGasCloud 2923-2947; GalaxyImages.cs 59-71; Main.Part13.cs
// LoadMapStars; sim/galaxyImages.ts MAP_STAR_IMAGE_FOLDERS):
// - SetupSun makes the call at the C#'s point — once per star, after the diameter / PictureRef / MapPictureRef /
//   LandscapePictureRef / radiation bytes are set from SelectStar and before the black-hole name / super-nova draws — and
//   it draws PictureRef then MapPictureRef, MapStarImageOffsetX + Next(0, MapStarImageCountX) of one sample each (a
//   count of 1 still draws), nothing for a super nova (traced on a seed-5 generation and on synthetic stars);
// - a seeded galaxy's stars hold refs in their type's map-star range (super nova 0 / 0), gas clouds MapPictureRef
//   16-23 by type, every other habitat 0;
// - the star sprites resolve to files of the install: bitmap_196 (the mapstars folders in LoadMapStars order) has the
//   GalaxyImages counts, every star's bitmap_196[MapPictureRef] is a file of its own type's folder, a super nova's
//   bitmap_206[NovaImageIndexMajor] a supernovae/ file;
// - saves from before the port (no habitatMapPictureRefs marker; test/fixtures/before-sim-message-pipeline.dwusave.gz)
//   load with each star's MapPictureRef the bitmap_196 index of the very picture the old renderer showed for it
//   (mapstars/<type>/ file `PictureRef mod n`), gas clouds 16-23, the rest 0; they round-trip, and new saves are not
//   migrated again.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

vi.mock('pixi.js', () => ({ Assets: { load: vi.fn() }, Texture: class {} }));

import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { Galaxy, generateGalaxy } from '../src/sim/galaxy';
import { setGovernmentsStatic } from '../src/sim/empire';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { GalaxyShape, Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';
import { MAP_STAR_IMAGE_COUNT, MAP_STAR_IMAGE_FOLDERS, gasCloudMapPictureRef, mapStarImageRangeOfType, migratePreMapPictureRef } from '../src/sim/galaxyImages';

const { MANIFEST, mapStarImageUrls, mapStarUrls, starPictureUrls } = await import('../src/render/assets');

const gameRoot = resolve(__dirname, '..');
const installLinked = existsSync(resolve(gameRoot, 'public', 'assets', 'dwu', 'images', 'environment', 'mapstars'));
const MBIG = 2147483647;
const next = (sample: number, min: number, max: number): number => Math.trunc(sample * (1 / MBIG) * (max - min)) + min;

/** GalaxyImages.cs 59-71, written out: [first, last] map-star index SelectHabitatPictures gives each star type. */
const CS_STAR_RANGES: Partial<Record<HabitatType, readonly [number, number]>> = {
    [HabitatType.MainSequence]: [0, 5],
    [HabitatType.RedGiant]: [6, 6],
    [HabitatType.SuperGiant]: [7, 7],
    [HabitatType.WhiteDwarf]: [8, 10],
    [HabitatType.Neutron]: [11, 12],
    [HabitatType.BlackHole]: [13, 13],
};
/** Galaxy.6.cs SelectStar 2525-2620: [PictureRef values, MapPictureRef range] before SelectHabitatPictures. */
const SELECT_STAR: Partial<Record<HabitatType, readonly [readonly number[], readonly [number, number]]>> = {
    [HabitatType.MainSequence]: [[83, 84], [1, 4]],
    [HabitatType.RedGiant]: [[85], [7, 9]],
    [HabitatType.SuperGiant]: [[86], [7, 9]],
    [HabitatType.WhiteDwarf]: [[87], [13, 15]],
    [HabitatType.Neutron]: [[88], [6, 6]],
    [HabitatType.BlackHole]: [[95], [0, 0]],
    [HabitatType.SuperNova]: [[0], [0, 0]],
};
/** Galaxy.4.cs 2923-2947. */
const CS_CLOUD_MAP_REFS: Partial<Record<HabitatType, number>> = {
    [HabitatType.Ammonia]: 16, [HabitatType.Argon]: 17, [HabitatType.CarbonDioxide]: 18, [HabitatType.Chlorine]: 19,
    [HabitatType.Helium]: 20, [HabitatType.Hydrogen]: 21, [HabitatType.NitrogenOxygen]: 22, [HabitatType.Oxygen]: 23,
};

interface PictureCall {
    habitat: Habitat;
    category: HabitatCategoryType;
    type: HabitatType;
    name: string;
    diameter: number;
    radiation: [number, number, number];
    pictureRef: number;
    mapPictureRef: number;
    landscapePictureRef: number;
    samples: number[];
    drawsAfter: number;
}
interface SunCall {
    star: Habitat | null;
    calls: PictureCall[];
    end: number;
}

let gameData: GameData;
let seed5: Galaxy;
let sunCalls: SunCall[];
let traceGalaxy: Galaxy;
let game: Game;
let manifest: Record<string, string[]>;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
    // Seed 5 with SetupSun and SelectHabitatPictures observed (the tracer only reads the samples: the same galaxy).
    const proto = Galaxy.prototype as unknown as Record<string, (this: Galaxy, ...a: unknown[]) => unknown>;
    const setupSun = proto.setupSun;
    const select = proto.selectHabitatPictures;
    sunCalls = [];
    let current: SunCall | null = null;
    proto.setupSun = function (this: Galaxy, ...a: unknown[]) {
        const rec: SunCall = { star: null, calls: [], end: 0 };
        current = rec;
        try {
            rec.star = setupSun.apply(this, a) as Habitat;
            rec.end = this.rnd.drawCount;
            return rec.star;
        } finally {
            current = null;
            sunCalls.push(rec);
        }
    };
    proto.selectHabitatPictures = function (this: Galaxy, ...a: unknown[]) {
        if (current === null) return select.apply(this, a);
        const h = a[0] as Habitat;
        const call: PictureCall = {
            habitat: h, category: h.category, type: h.type, name: h.name, diameter: h.diameter, radiation: [h.solarRadiation, h.microwaveRadiation, h.xrayRadiation],
            pictureRef: h.pictureRef, mapPictureRef: h.mapPictureRef, landscapePictureRef: h.landscapePictureRef, samples: [], drawsAfter: 0,
        };
        this.rnd.setTrace((v) => call.samples.push(v));
        try {
            return select.apply(this, a);
        } finally {
            this.rnd.setTrace(null);
            call.drawsAfter = this.rnd.drawCount;
            current.calls.push(call);
        }
    };
    try {
        seed5 = generateGalaxy({ seed: 5, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`), gameData });
    } finally {
        proto.setupSun = setupSun;
        proto.selectHabitatPictures = select;
    }
    traceGalaxy = generateGalaxy({ seed: 3, shape: GalaxyShape.Spiral, starCount: 20, sectorWidth: 2, sectorHeight: 2, systemNames: Array.from({ length: 20 }, (_, i) => `T${i}`), gameData });
    game = cachedTickGame(gameData);
    // A private manifest (other tests regenerate public/asset-manifest.json concurrently).
    const out = join(mkdtempSync(join(tmpdir(), 'dwu-manifest-')), 'asset-manifest.json');
    execFileSync('node', ['scripts/gen-asset-manifest.mjs'], { cwd: gameRoot, env: { ...process.env, ASSET_MANIFEST_OUT: out } });
    manifest = JSON.parse(readFileSync(out, 'utf-8')) as Record<string, string[]>;
}, 300000);

/** The star / cloud / other refs that disagree with the C#. */
function badRefs(habitats: readonly Habitat[]): string[] {
    const bad: string[] = [];
    for (const h of habitats) {
        let ok: boolean;
        if (h.category === HabitatCategoryType.Star) {
            const r = CS_STAR_RANGES[h.type];
            ok = r === undefined ? h.type === HabitatType.SuperNova && h.pictureRef === 0 && h.mapPictureRef === 0 : [h.pictureRef, h.mapPictureRef].every((v) => Number.isInteger(v) && v >= r[0] && v <= r[1]);
        } else if (h.category === HabitatCategoryType.GasCloud) {
            ok = h.mapPictureRef === CS_CLOUD_MAP_REFS[h.type];
        } else {
            ok = h.mapPictureRef === 0;
        }
        if (!ok) bad.push(`${h.name} cat ${h.category} type ${h.type}: pictureRef ${h.pictureRef} mapPictureRef ${h.mapPictureRef}`);
    }
    return bad;
}

describe('GalaxyImages map-star table (GalaxyImages.cs 59-71, Main.Part13.cs LoadMapStars)', () => {
    it('folders in bitmap_196 order; offsets are the running sums of the counts; 14 pictures', () => {
        expect(MAP_STAR_IMAGE_FOLDERS.map((f) => [f.folder, f.type, f.offset, f.count])).toEqual([
            ['mainsequence', HabitatType.MainSequence, 0, 6], ['redgiant', HabitatType.RedGiant, 6, 1], ['supergiant', HabitatType.SuperGiant, 7, 1],
            ['whitedwarf', HabitatType.WhiteDwarf, 8, 3], ['neutron', HabitatType.Neutron, 11, 2], ['blackhole', HabitatType.BlackHole, 13, 1],
        ]);
        let n = 0;
        for (const f of MAP_STAR_IMAGE_FOLDERS) {
            expect(f.offset).toBe(n);
            n += f.count;
        }
        expect(MAP_STAR_IMAGE_COUNT).toBe(14);
        for (const [type, [first, last]] of Object.entries(CS_STAR_RANGES)) expect(mapStarImageRangeOfType(Number(type) as HabitatType)).toEqual([first, last - first + 1]);
        expect(mapStarImageRangeOfType(HabitatType.SuperNova)).toBeNull();
        for (const [type, ref] of Object.entries(CS_CLOUD_MAP_REFS)) expect(gasCloudMapPictureRef(Number(type) as HabitatType)).toBe(ref);
        expect(gasCloudMapPictureRef(HabitatType.Ocean)).toBe(0);
    });
    (installLinked ? it : it.skip)('the install has exactly the GalaxyImages counts: bitmap_196 is 14 files', () => {
        for (const { folder, count } of MAP_STAR_IMAGE_FOLDERS) expect(manifest[`mapstars/${folder}`]?.length, folder).toBe(count);
        for (const k of Object.keys(MANIFEST)) delete MANIFEST[k];
        Object.assign(MANIFEST, manifest);
        expect(mapStarImageUrls().length).toBe(MAP_STAR_IMAGE_COUNT);
        expect(new Set(mapStarImageUrls()).size).toBe(MAP_STAR_IMAGE_COUNT); // redgiant / supergiant: two StarDisk_144 files, two folders
    });
});

describe('SetupSun calls SelectHabitatPictures(star) (Galaxy.5.cs 1328)', () => {
    it('once per star, at the C# point: after the SelectStar fields and the radiation bytes, before the name / nova draws', () => {
        expect(sunCalls.length).toBe(seed5.habitats.filter((h) => h.category === HabitatCategoryType.Star).length);
        const bad: string[] = [];
        for (const sun of sunCalls) {
            const star = sun.star!;
            expect(sun.calls.length, star.name).toBe(1);
            const c = sun.calls[0];
            expect(c.habitat).toBe(star);
            expect(c.category).toBe(HabitatCategoryType.Star);
            // Set before the call (Galaxy.5.cs 1320-1327): the GenerateCodeName name, the diameter (a super nova's is
            // re-set later from its progression), SelectStar's PictureRef / MapPictureRef, LandscapePictureRef -1 and
            // the radiation bytes.
            expect(c.name, star.name).toMatch(/^[A-Z]{2}\d{1,3}$/);
            if (star.type !== HabitatType.SuperNova) expect(c.diameter).toBe(star.diameter);
            expect(c.radiation).toEqual([star.solarRadiation, star.microwaveRadiation, star.xrayRadiation]);
            const [pictureRefs, [mFirst, mLast]] = SELECT_STAR[star.type]!;
            if (!pictureRefs.includes(c.pictureRef) || c.mapPictureRef < mFirst || c.mapPictureRef > mLast) bad.push(`${star.name} (${star.type}): SelectStar ${c.pictureRef} / ${c.mapPictureRef}`);
            if (star.type === HabitatType.MainSequence) expect(c.pictureRef).toBe(c.diameter <= 1200 ? 83 : 84);
            expect(c.landscapePictureRef).toBe(-1);
            // The draws after it in SetupSun: GenerateBlackHoleName's 2, the super nova's code name (3), NextDouble and
            // the two nova image indices; none for the other stars.
            const after = sun.end - c.drawsAfter;
            expect(after, `${star.name} (${star.type})`).toBe(star.type === HabitatType.BlackHole ? 2 : star.type === HabitatType.SuperNova ? 6 : 0);
            if (star.type === HabitatType.BlackHole) expect(star.name).not.toBe(c.name);
        }
        expect(bad).toEqual([]);
    });

    it('draws PictureRef then MapPictureRef, each Offset + Next(0, Count) of its own sample; a super nova draws nothing', () => {
        const types = new Set<HabitatType>();
        for (const sun of sunCalls) {
            const star = sun.star!;
            const c = sun.calls[0];
            types.add(star.type);
            const r = mapStarImageRangeOfType(star.type);
            if (r === null) {
                expect(c.samples).toEqual([]);
                expect([star.pictureRef, star.mapPictureRef]).toEqual([0, 0]);
                continue;
            }
            expect(c.samples.length, `${star.name} (${star.type})`).toBe(2);
            expect(star.pictureRef).toBe(r[0] + next(c.samples[0], 0, r[1]));
            expect(star.mapPictureRef).toBe(r[0] + next(c.samples[1], 0, r[1]));
        }
        // Seed 5 has every star type but the black hole and the super nova (traced on synthetic stars below).
        expect([...types].sort((a, b) => a - b)).toEqual(expect.arrayContaining([HabitatType.MainSequence, HabitatType.RedGiant, HabitatType.SuperGiant, HabitatType.WhiteDwarf, HabitatType.Neutron]));
    });

    it('SelectHabitatPictures on each star type (Galaxy.6.cs 2214-2238), a count of 1 drawing too', () => {
        const g = traceGalaxy;
        for (const type of [HabitatType.MainSequence, HabitatType.RedGiant, HabitatType.SuperGiant, HabitatType.WhiteDwarf, HabitatType.Neutron, HabitatType.BlackHole, HabitatType.SuperNova]) {
            const r = mapStarImageRangeOfType(type);
            const seen = new Set<number>();
            for (let k = 0; k < 60; k++) {
                const h = Object.create(Habitat.prototype) as Habitat;
                Object.assign(h, { category: HabitatCategoryType.Star, type, resources: [], landscapePictureRef: -1, pictureRef: 83, mapPictureRef: 1 });
                const samples: number[] = [];
                const before = g.rnd.drawCount;
                g.rnd.setTrace((v) => samples.push(v));
                try {
                    g.selectHabitatPictures(h);
                } finally {
                    g.rnd.setTrace(null);
                }
                expect(g.rnd.drawCount - before).toBe(samples.length);
                expect(h.landscapePictureRef).toBe(-1);
                if (r === null) {
                    expect(samples.length).toBe(0);
                    expect([h.pictureRef, h.mapPictureRef]).toEqual([83, 1]); // untouched
                    continue;
                }
                expect(samples.length, String(type)).toBe(2);
                expect(h.pictureRef).toBe(r[0] + next(samples[0], 0, r[1]));
                expect(h.mapPictureRef).toBe(r[0] + next(samples[1], 0, r[1]));
                seen.add(h.mapPictureRef);
            }
            if (r !== null) expect(seen.size).toBe(r[1]); // the whole range
        }
    });
});

describe('seeded galaxies store the C# refs', () => {
    for (const [name, habitats] of [['seed 5 (generateGalaxy)', () => seed5.habitats], ['seed 1 (createGame)', () => game.galaxy.habitats]] as const) {
        it(`${name}: stars in their type's map-star range (super nova 0 / 0), gas clouds 16-23, the rest 0`, () => {
            expect(badRefs(habitats())).toEqual([]);
        });
    }
    it('seed 1 spreads over each star range (the whole Next(0, Count)) and has gas clouds', () => {
        const stars = game.galaxy.habitats.filter((h) => h.category === HabitatCategoryType.Star);
        expect(new Set(stars.filter((h) => h.type === HabitatType.MainSequence).map((h) => h.mapPictureRef)).size).toBe(6);
        expect(new Set(stars.filter((h) => h.type === HabitatType.WhiteDwarf).map((h) => h.mapPictureRef)).size).toBe(3);
        expect(game.galaxy.habitats.some((h) => h.category === HabitatCategoryType.GasCloud)).toBe(true);
    });
});

describe('star sprites resolve to files of the install', () => {
    (installLinked ? it : it.skip)("every star's bitmap_196[MapPictureRef] is a file of its type's mapstars folder; a super nova's bitmap_206 picture exists", () => {
        for (const k of Object.keys(MANIFEST)) delete MANIFEST[k];
        Object.assign(MANIFEST, manifest);
        const folderOf = new Map(MAP_STAR_IMAGE_FOLDERS.map((f) => [f.type, f.folder]));
        const bad: string[] = [];
        let novae = 0;
        for (const h of [...game.galaxy.habitats, ...seed5.habitats]) {
            if (h.category !== HabitatCategoryType.Star) {
                if (h.category !== HabitatCategoryType.GasCloud && mapStarUrls(h).length !== 0) bad.push(`${h.name}: not a star but ${mapStarUrls(h)[0]}`);
                continue;
            }
            const url = mapStarUrls(h)[0];
            // A super nova's MapPictureRef 0 is bitmap_196[0] (main sequence) where the C# reads it.
            const folder = h.type === HabitatType.SuperNova ? 'mainsequence' : folderOf.get(h.type)!;
            const m = url === undefined ? null : /\/assets\/dwu\/images\/environment\/mapstars\/([^/]+)\/([^/]+)$/.exec(url);
            if (m === null || m[1] !== folder || !manifest[`mapstars/${m[1]}`].includes(m[2])) bad.push(`${h.name} (${h.type}) ${h.mapPictureRef}: ${url}`);
            const pic = starPictureUrls(h)[0];
            if (h.type === HabitatType.SuperNova) {
                novae++;
                const n = pic === undefined ? null : /\/environment\/supernovae\/([^/]+)$/.exec(pic);
                if (n === null || manifest.supernovae[h.novaImageIndexMajor] !== n[1]) bad.push(`${h.name}: nova ${h.novaImageIndexMajor} -> ${pic}`);
            } else if (pic !== url) bad.push(`${h.name}: starPictureUrls ${pic} != ${url}`);
        }
        expect(bad).toEqual([]);
        expect(novae).toBeGreaterThan(0);
    });
});

describe('saves from before MapPictureRef (no habitatMapPictureRefs marker)', () => {
    it('migratePreMapPictureRef: the bitmap_196 index of the old renderer\'s file (PictureRef mod the folder count)', () => {
        // Main sequence 83 % 6 = 5, 84 % 6 = 0; red / super giant 6 / 7; white dwarf 87 % 3 = 0 -> 8; neutron 88 % 2 = 0
        // -> 11; black hole 13; super nova SelectStar's 0.
        const S = HabitatCategoryType.Star;
        expect(migratePreMapPictureRef(S, HabitatType.MainSequence, 83)).toBe(5);
        expect(migratePreMapPictureRef(S, HabitatType.MainSequence, 84)).toBe(0);
        expect(migratePreMapPictureRef(S, HabitatType.RedGiant, 85)).toBe(6);
        expect(migratePreMapPictureRef(S, HabitatType.SuperGiant, 86)).toBe(7);
        expect(migratePreMapPictureRef(S, HabitatType.WhiteDwarf, 87)).toBe(8);
        expect(migratePreMapPictureRef(S, HabitatType.Neutron, 88)).toBe(11);
        expect(migratePreMapPictureRef(S, HabitatType.BlackHole, 95)).toBe(13);
        expect(migratePreMapPictureRef(S, HabitatType.SuperNova, 0)).toBe(0);
        expect(migratePreMapPictureRef(S, HabitatType.WhiteDwarf, -1)).toBe(10);
        expect(migratePreMapPictureRef(HabitatCategoryType.GasCloud, HabitatType.Oxygen, 72)).toBe(23);
        expect(migratePreMapPictureRef(HabitatCategoryType.Planet, HabitatType.Ocean, 190)).toBe(0);
        expect(migratePreMapPictureRef(HabitatCategoryType.Asteroid, HabitatType.Metal, 600)).toBe(0);
    });

    it('the pre-port fixture loads with each star showing the picture the old renderer showed, and round-trips', () => {
        const text = gunzipSync(readFileSync(join(__dirname, 'fixtures', 'before-sim-message-pipeline.dwusave.gz'))).toString('utf8');
        const raw = JSON.parse(text) as { galaxy: { shapes: string[][]; habitatMapPictureRefs?: string } };
        expect(raw.galaxy.habitatMapPictureRefs).toBeUndefined();
        const habitatShapes = raw.galaxy.shapes.filter((s) => s[0] === 'Habitat');
        expect(habitatShapes.length).toBeGreaterThan(0);
        for (const s of habitatShapes) expect(s.includes('mapPictureRef')).toBe(false);

        const { game: loaded, time, startOptions } = deserializeGame(text, gameData);
        const g = loaded.galaxy;
        expect(badRefs(g.habitats.filter((h) => h.category !== HabitatCategoryType.Star))).toEqual([]);
        const bad: string[] = [];
        const stars = g.habitats.filter((h) => h.category === HabitatCategoryType.Star);
        expect(stars.length).toBeGreaterThan(30); // 40 in the fixture
        const old: Record<number, string> = { [HabitatType.MainSequence]: 'mainsequence', [HabitatType.RedGiant]: 'redgiant', [HabitatType.SuperGiant]: 'supergiant', [HabitatType.WhiteDwarf]: 'whitedwarf', [HabitatType.Neutron]: 'neutron', [HabitatType.BlackHole]: 'blackhole' };
        if (installLinked) {
            for (const k of Object.keys(MANIFEST)) delete MANIFEST[k];
            Object.assign(MANIFEST, manifest);
        }
        for (const h of stars) {
            // The save keeps SelectStar's PictureRef (SetupSun never redrew it before the port).
            if (!SELECT_STAR[h.type]![0].includes(h.pictureRef)) bad.push(`${h.name} (${h.type}): pictureRef ${h.pictureRef}`);
            const r = mapStarImageRangeOfType(h.type);
            if (r === null) {
                if (h.mapPictureRef !== 0) bad.push(`${h.name} super nova: ${h.mapPictureRef}`);
                continue;
            }
            if (h.mapPictureRef < r[0] || h.mapPictureRef >= r[0] + r[1]) bad.push(`${h.name} (${h.type}): ${h.mapPictureRef} out of range`);
            if (!installLinked) continue;
            // The old renderer: mapstars/<type>/ file `PictureRef mod n` (render/assets.ts pickFromFolder).
            const files = manifest[`mapstars/${old[h.type]}`];
            const shown = `/assets/dwu/images/environment/mapstars/${old[h.type]}/${files[h.pictureRef % files.length]}`;
            if (mapStarUrls(h)[0] !== shown) bad.push(`${h.name} (${h.type}) ${h.pictureRef}: showed ${shown}, now ${mapStarUrls(h)[0]}`);
        }
        expect(bad).toEqual([]);

        // Save -> load -> save: the marker is written, nothing is migrated twice, the same text.
        const again = serializeGame(loaded, time, startOptions);
        expect((JSON.parse(again) as { galaxy: { habitatMapPictureRefs?: string } }).galaxy.habitatMapPictureRefs).toBe('MapStarImages');
        const reloaded = deserializeGame(again, gameData);
        expect(reloaded.game.galaxy.habitats.map((h) => h.mapPictureRef)).toEqual(g.habitats.map((h) => h.mapPictureRef));
        expect(serializeGame(reloaded.game, reloaded.time, startOptions) === again).toBe(true);
    }, 300000);

    it('a new save keeps its drawn refs; the same save without the marker would be migrated (the marker gates it)', () => {
        const time = new GalaxyTime();
        const start = { ...defaultStartGameOptions(), seed: 1 };
        const text = serializeGame(game, time, start);
        const refs = game.galaxy.habitats.map((h) => h.mapPictureRef);
        expect(deserializeGame(text, gameData).game.galaxy.habitats.map((h) => h.mapPictureRef)).toEqual(refs);
        const obj = JSON.parse(text) as { galaxy: { habitatMapPictureRefs?: string } };
        expect(obj.galaxy.habitatMapPictureRefs).toBe('MapStarImages');
        delete obj.galaxy.habitatMapPictureRefs;
        const migrated = deserializeGame(JSON.stringify(obj), gameData).game.galaxy.habitats;
        // Without the marker each star's MapPictureRef is derived from its PictureRef (now a map-star draw of its own).
        expect(migrated.map((h) => h.mapPictureRef)).toEqual(migrated.map((h) => migratePreMapPictureRef(h.category, h.type, h.pictureRef)));
        expect(migrated.filter((h, i) => h.mapPictureRef !== refs[i]).length).toBeGreaterThan(10);
    }, 300000);
});
