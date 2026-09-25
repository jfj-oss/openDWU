import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import { createGame, type CreateGameOptions, type Game } from '../src/sim/game';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { GalaxyShape } from '../src/sim/types';
import { defaultStartGameOptions, toCreateGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { flatEmpireList } from '../src/sim/save/galaxySave';
import { BuiltObject } from '../src/sim/builtObject';
import { Design } from '../src/sim/design';
import { Character, getEmpireCharacters } from '../src/sim/characters';
import type { Empire } from '../src/sim/empire';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyStarDate } from '../src/sim/tick/simTime';

const systemNames = Array.from({ length: 200 }, (_, i) => `Test System ${i}`);

let gameData: GameData;

beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 60000);

describe('game save/load (11a2)', { timeout: 60000 }, () => {
    // Pinned seed: defaultStartGameOptions uses Date.now() for the seed.
    const startOptions = { ...defaultStartGameOptions(), seed: 42 };

    it('createGame → advance 10 s → serialize/deserialize/serialize is byte-identical', () => {
        const game = createGame(toCreateGameOptions(startOptions, gameData, systemNames));
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(10_000);

        const text1 = serializeGame(game, time, startOptions);
        const restored = deserializeGame(text1, gameData);
        const text2 = serializeGame(restored.game, restored.time, restored.startOptions);

        expect(text2).toBe(text1);
    });

    it('restored player empire keeps its name and colony count', () => {
        const game = createGame(toCreateGameOptions(startOptions, gameData, systemNames));
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(10_000);

        const restored = deserializeGame(serializeGame(game, time, startOptions), gameData);

        expect(restored.game.playerEmpire.name).toBe(game.playerEmpire.name);
        expect(restored.game.playerEmpire.colonies.length).toBe(game.playerEmpire.colonies.length);
    });

    it('a clock bound to the galaxy saves the sim time and resumes at the same star date', () => {
        const game = createGame(toCreateGameOptions(startOptions, gameData, systemNames));
        const time = new GalaxyTime().bindGalaxy(game.galaxy);
        time.speed = 2;
        runGameSeconds(game, 5, { speed: 2 });
        expect(time.currentStarDate).toBe(galaxyStarDate(game.galaxy));

        const text = serializeGame(game, time, startOptions);
        const restored = deserializeGame(text, gameData);
        expect(restored.time.elapsedMs).toBe(game.galaxy.nowMs);
        expect(restored.game.galaxy.nowMs).toBe(game.galaxy.nowMs);
        const rebound = new GalaxyTime().bindGalaxy(restored.game.galaxy);
        expect(rebound.currentStarDate).toBe(restored.time.currentStarDate);
        expect(rebound.currentStarDate).toBe(galaxyStarDate(game.galaxy));
        expect(restored.time.speed).toBe(2);
    });

    it('rejects the pre-M3 version-1 format', () => {
        expect(() => deserializeGame(JSON.stringify({ version: 1 }), gameData)).toThrow(/Unsupported save version 1/);
    });
});

// Full M3 game start (tech level 0.5 = "Normal": empires have ships, space
// ports, mining/research stations; pirate factions have bases and fleets;
// starting characters). createGame is slow, so one game is shared by the
// checks below.
describe('game save/load: M3 built objects, designs and characters', { timeout: 120000 }, () => {
    let game: Game;
    let text: string;
    let restored: ReturnType<typeof deserializeGame>;

    function fullGameOptions(): CreateGameOptions {
        const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 0, techLevel: 0.5 });
        return {
            seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
            systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
            player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)'), s('(Random)')],
            piratePrevalence: 1.0,
        };
    }

    beforeAll(() => {
        game = createGame(fullGameOptions());
        const time = new GalaxyTime();
        text = serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1 });
        restored = deserializeGame(text, gameData);
    }, 120000);

    const empireLists = ['builtObjects', 'privateBuiltObjects', 'spacePorts', 'miningStations', 'researchFacilities', 'constructionShips', 'freighters', 'resourceExtractors', 'designs', 'latestDesigns'] as const;

    function pairedEmpires(): [Empire, Empire][] {
        const a = flatEmpireList(game.galaxy);
        const b = flatEmpireList(restored.game.galaxy);
        expect(b.length).toBe(a.length);
        return a.map((e, i) => [e, b[i]]);
    }

    it('the game has ships, bases, pirates and characters to round-trip', () => {
        expect(game.galaxy.builtObjects.length).toBeGreaterThan(0);
        expect(game.playerEmpire.builtObjects.length).toBeGreaterThan(0);
        expect(game.playerEmpire.spacePorts.length).toBeGreaterThan(0);
        expect(game.galaxy.pirateEmpires.length).toBeGreaterThan(0);
        expect(getEmpireCharacters(game.playerEmpire).length).toBeGreaterThan(0);
    });

    it('serialize(deserialize(x)) is byte-identical', () => {
        expect(serializeGame(restored.game, restored.time, restored.startOptions)).toBe(text);
    });

    it('built-object counts per empire and galaxy match', () => {
        expect(restored.game.galaxy.builtObjects.length).toBe(game.galaxy.builtObjects.length);
        expect(restored.game.galaxy.nextBuiltObjectId).toBe(game.galaxy.nextBuiltObjectId);
        for (const [a, b] of pairedEmpires()) {
            expect(b.name).toBe(a.name);
            for (const list of empireLists) expect(b[list].length, `${a.name}.${list}`).toBe(a[list].length);
        }
    });

    it('names, designs, positions and owners of every built object match', () => {
        const [a, b] = [(game.galaxy.builtObjects as BuiltObject[]), (restored.game.galaxy.builtObjects as BuiltObject[])];
        const empiresA = flatEmpireList(game.galaxy);
        const empiresB = flatEmpireList(restored.game.galaxy);
        for (let i = 0; i < a.length; i++) {
            expect(b[i]).toBeInstanceOf(BuiltObject);
            expect(b[i].builtObjectID).toBe(a[i].builtObjectID);
            expect(b[i].name).toBe(a[i].name);
            expect(b[i].subRole).toBe(a[i].subRole);
            expect(b[i].xpos).toBe(a[i].xpos);
            expect(b[i].ypos).toBe(a[i].ypos);
            expect(b[i].design).toBeInstanceOf(Design);
            expect(b[i].design.name).toBe(a[i].design.name);
            expect(b[i].design.components.map((c) => c.componentId)).toEqual(a[i].design.components.map((c) => c.componentId));
            expect(b[i].components.items.map((c) => c.componentId)).toEqual(a[i].components.items.map((c) => c.componentId));
            expect(b[i].empire === null ? -1 : empiresB.indexOf(b[i].empire!)).toBe(a[i].empire === null ? -1 : empiresA.indexOf(a[i].empire!));
            expect(b[i].owner === null ? -1 : empiresB.indexOf(b[i].owner!)).toBe(a[i].owner === null ? -1 : empiresA.indexOf(a[i].owner!));
            expect(b[i].parentHabitat === null ? -1 : restored.game.galaxy.habitats.indexOf(b[i].parentHabitat!)).toBe(a[i].parentHabitat === null ? -1 : game.galaxy.habitats.indexOf(a[i].parentHabitat!));
        }
    });

    it('object identity is preserved across the lists that share an instance', () => {
        const galaxyById = new Map((restored.game.galaxy.builtObjects as BuiltObject[]).map((b) => [b.builtObjectID, b]));
        for (const [, e] of pairedEmpires()) {
            for (const list of ['builtObjects', 'privateBuiltObjects', 'spacePorts', 'miningStations'] as const) {
                for (const bo of e[list]) expect(galaxyById.get(bo.builtObjectID), `${e.name}.${list}`).toBe(bo);
            }
            for (const bo of e.builtObjects) expect(bo.owner).toBe(e);
            // A ship's design is the empire's own Design instance, and its
            // components reference the canonical static definitions.
            for (const bo of [...e.builtObjects, ...e.privateBuiltObjects]) {
                if (e.designs.length > 0) expect(e.designs.includes(bo.design) || restored.game.galaxy.popularDesigns.includes(bo.design)).toBe(true);
                expect(bo.design.empire === null || bo.design.empire === e || bo.design.empire === restored.game.galaxy.independentEmpire).toBe(true);
                for (const c of bo.components.items) expect(restored.game.galaxy.researchStatic!.componentStatic!.byId.get(c.componentId)).toBe(c.def);
                expect(bo._galaxy).toBe(restored.game.galaxy);
            }
        }
        const rp = restored.game.playerEmpire;
        expect(rp.spacePorts[0]).toBe(galaxyById.get(rp.spacePorts[0].builtObjectID));
        expect(rp.spacePorts[0].parentHabitat).toBe(rp.capital);
        expect(restored.game.galaxy.playerEmpire).toBe(rp);
        expect(rp.galaxy).toBe(restored.game.galaxy);
    });

    it('pirate factions keep their bases, fleets and base habitat', () => {
        for (let i = 0; i < game.galaxy.pirateEmpires.length; i++) {
            const a = game.galaxy.pirateEmpires[i];
            const b = restored.game.galaxy.pirateEmpires[i];
            expect(a.pirateEmpireBaseHabitat).not.toBeNull();
            expect(b.pirateEmpireBaseHabitat).toBe(restored.game.galaxy.habitats[game.galaxy.habitats.indexOf(a.pirateEmpireBaseHabitat!)]);
            expect(b.builtObjects.map((x) => [x.subRole, x.name])).toEqual(a.builtObjects.map((x) => [x.subRole, x.name]));
            expect(b.privateBuiltObjects.length).toBe(a.privateBuiltObjects.length);
            expect(b.piratePlayStyle).toBe(a.piratePlayStyle);
            for (const bo of b.builtObjects) expect(bo.pirateEmpireId).toBe(b.empireId & 0xff);
        }
    });

    it('characters per empire match, with their locations and empire re-linked', () => {
        for (const [a, b] of pairedEmpires()) {
            const ca = getEmpireCharacters(a);
            const cb = getEmpireCharacters(b);
            expect(cb.length, a.name).toBe(ca.length);
            for (let i = 0; i < ca.length; i++) {
                expect(cb[i]).toBeInstanceOf(Character);
                expect(cb[i].name).toBe(ca[i].name);
                expect(cb[i].role).toBe(ca[i].role);
                expect(cb[i].empire).toBe(b);
                expect(cb[i].race?.name ?? null).toBe(ca[i].race?.name ?? null);
                const la = ca[i].location;
                const lb = cb[i].location;
                if (la === null) expect(lb).toBeNull();
                else if (la instanceof BuiltObject) expect((lb as BuiltObject).builtObjectID).toBe(la.builtObjectID);
                else expect(restored.game.galaxy.habitats.indexOf(lb as never)).toBe(game.galaxy.habitats.indexOf(la));
            }
        }
    });

    it('research, visibility and troops survive the round trip', () => {
        for (const [a, b] of pairedEmpires()) {
            expect(b.research.techTree.filter((n) => n.isResearched).length).toBe(a.research.techTree.filter((n) => n.isResearched).length);
            expect(b.research.techTree.length > 0 ? b.research.techTree[0].def : null).toBe(a.research.techTree.length > 0 ? a.research.techTree[0].def : null);
            expect(b.visibility.systemVisibility.map((v) => v.status)).toEqual(a.visibility.systemVisibility.map((v) => v.status));
            expect(b.visibility.owner.active).toBe(a.active);
            expect(b.troops.count).toBe(a.troops.count);
            expect(b.designNameState.escortPrefix).toBe(a.designNameState.escortPrefix);
            if (a.capital !== null) {
                expect(restored.game.galaxy.empireTerritory.checkLocationOwnership(restored.game.galaxy, a.capital.xpos, a.capital.ypos)).toBe(game.galaxy.empireTerritory.checkLocationOwnership(game.galaxy, a.capital.xpos, a.capital.ypos));
            }
        }
    });

    it('the restored game keeps stepping and the RNG sequence continues identically', () => {
        restored.game.galaxy.step(1000);
        game.galaxy.step(1000);
        for (let i = 0; i < 5; i++) expect(restored.game.galaxy.rnd.next()).toBe(game.galaxy.rnd.next());
    });
});
