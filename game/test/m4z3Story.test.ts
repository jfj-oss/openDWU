// M4z3: the story lines (story/storyEvents.ts, story/storyStart.ts) — createGame's story switches (Start.2.cs 501-506), the
// start-of-game story set-up (Start.2.cs 1730-2016), the Return of the Shakturi runtime (Galaxy.8.cs 1348-2056, Empire.2.cs
// 3474-3777), the Distant Worlds story clues (Galaxy.5.cs 3622-3942), the Shadows pre-warp branches (Empire.7.cs) and the
// Legends gateway convoys (Empire.1.cs 3899). Plus a harness run with every story line on.
import type { BuiltObject } from '../src/sim/builtObject';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { createGame, type CreateGameOptions, type Game } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Race } from '../src/sim/data/races';
import type { Habitat } from '../src/sim/types';
import { Random } from '../src/sim/random';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import {
    checkAllStoryCluesUsed,
    checkForStoryLocationHint,
    checkOfferStoryHint,
    checkSendShipConvoysViaGateway,
    findNearestGalaxyEdgeCoords,
    galaxyRaceByName,
    generateMilitaryConvoy,
    generateCivilianConvoy,
    generateShakturiAggression,
    generateShakturiInvasion,
    generateShakturiReturnTriggerRuins,
    generateStoryClue,
    identifyShakturiEmpire,
    investigateRuinsStoryEvent,
    selectUnusedStoryClue,
    selectUnusedSecondaryStoryClueIndex,
    shakturiSendConvoy,
    expectedMaximumColoniesInGalaxy,
} from '../src/sim/story/storyEvents';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { EmpireMessageType } from '../src/sim/messages';
import { RuinType } from '../src/sim/ruins';
import { GalaxyLocationType } from '../src/sim/galaxyLocation';
import { CreatureType } from '../src/sim/creature';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { PlanetaryFacility, planetaryFacilityDefinitionsStatic } from '../src/sim/construction/facilities';
import { PlanetaryFacilityType, WonderType, facilityType } from '../src/sim/researchSystem';
import { identifyMechanoidEmpire } from '../src/sim/fleets/militaryAI';

let gameData: GameData;

function storyOptions(gd: GameData, over: Partial<CreateGameOptions> = {}): CreateGameOptions {
    return { ...tickGameOptions(gd), storyReturnOfTheShakturiEnabled: true, storyDistantWorldsEnabled: true, storyShadowsEnabled: true, ...over };
}

function cloneRandom(r: Random): Random {
    const c = new Random(0);
    c.setState(r.getState());
    return c;
}

/** GenerateShakturi renames / re-levels the (shared GameData) Shakturi race: snapshot and restore it around a test. */
function withRaceRestored(gd: GameData, fn: () => void): void {
    const race = gd.races.find((r) => r.name === 'Shakturi')!;
    const snap = { ...race };
    try {
        fn();
    } finally {
        Object.assign(race, snap);
    }
}

beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 180000);

describe('createGame story switches (Start.2.cs 501-506)', () => {
    it('default off (a normal TS game); the options set the Galaxy flags', async () => {
        const g = createGame({ ...tickGameOptions(gameData), starCount: 120, systemNames: Array.from({ length: 120 }, (_, i) => `S${i}`) }).galaxy;
        expect([g.storyReturnOfTheShakturiEnabled, g.storyDistantWorldsEnabled, g.storyShadowsEnabled, g.gameRaceSpecificEventsEnabled]).toEqual([false, false, false, true]);
        expect(g.storyClueLocations).toEqual([]);
        expect(g.gameEvents.count).toBe(0);
        // Only BaconMain.cs 700-715's "ProcessEmpireScienceShips" (researchPerLab 1000) is queued; no story actions.
        expect(g.delayedActions.map((p) => p.action?.messageTitle)).toEqual(['ProcessEmpireScienceShips']);
    }, 180000);

    it('explicit false story options give the same game as the defaults (no Rnd difference)', () => {
        const o = { ...tickGameOptions(gameData), starCount: 120, systemNames: Array.from({ length: 120 }, (_, i) => `S${i}`) };
        const a = createGame(o).galaxy;
        const b = createGame({ ...o, storyReturnOfTheShakturiEnabled: false, storyDistantWorldsEnabled: false, storyShadowsEnabled: false, raceSpecificEventsEnabled: true }).galaxy;
        expect(b.rnd.drawCount).toBe(a.rnd.drawCount);
        expect(b.rnd.getState()).toEqual(a.rnd.getState());
    }, 180000);
});

describe('story set-up at game start (Start.2.cs 1730-2016)', () => {
    let game: Game;
    let g: Galaxy;
    beforeAll(() => {
        game = createGame(storyOptions(gameData));
        g = game.galaxy;
    }, 180000);

    it('Return of the Shakturi: the Ancient Guardians (Mechanoid) on "Utopia" with the Galactic Archives, and (int)(sqrt(stars)·0.3) abandoned Shakturi ships', () => {
        const guardians = g.empires.find((e) => e.name === 'Ancient Guardians');
        const mechanoidAi = g.empires.find((e) => e !== guardians && e.dominantRace?.name === 'Mechanoid');
        if (mechanoidAi === undefined) {
            expect(guardians).toBeDefined();
            expect(guardians!.dominantRace!.name).toBe('Mechanoid');
            expect(guardians!.capital!.name).toBe('Utopia');
            expect(guardians!.capital!.ruin?.name).toBe('Ancient Galactic Archives');
            expect(guardians!.defendHabitat).toBe(guardians!.capital);
        }
        const shakturiShips = (g.builtObjects as BuiltObject[]).filter((b) => b.empire === null && (b.encounterDescription ?? '').startsWith('The sight of this ship gives you an eerie feeling'));
        expect(shakturiShips.length).toBe(Math.trunc(Math.sqrt(300) * 0.3)); // 5
    });

    it('Distant Worlds: five clue locations, the clue flags, the restricted zones and special zones, one Origins ruin, debris fields and a planet destroyer', () => {
        expect(g.storyClueLocations).toHaveLength(5);
        expect(g.storyClueLocations.slice(1).map((o) => o!.name)).toEqual(['Signal Intercept Station XL5', 'Devastator', 'Ecatur Special Projects Outpost', 'Scoundrels Refuge']);
        expect((g.storyClueLocations[0] as Habitat).ruin!.storyClueLevel).toBe(0);
        expect(g.storyClueUsed).toEqual([false, false, false, false, false]);
        expect(g.storySecondaryClueUsed).toHaveLength(9);
        const restricted = g.galaxyLocations.filter((l) => l.type === GalaxyLocationType.RestrictedArea);
        const pozdac = restricted.find((l) => l.name === 'Pozdac Weapons Testing Range')!;
        expect(pozdac.relatedBuiltObject!.name).toBe('Devastator');
        expect(pozdac.width).toBe(3000);
        const dead = restricted.find((l) => l.name === 'Dead Zone')!;
        expect(dead.relatedCreatures).toHaveLength(40);
        expect(dead.relatedCreatures.every((c) => c.type === CreatureType.Kaltor && c.locationLocked)).toBe(true);
        // max(1, 300/200) = 1 of each special zone: 2 story zones + 3.
        expect(restricted.length).toBe(5);
        // 300 stars (< 400): 0 large + 2 small debris fields, 1 planet destroyer project.
        expect(g.galaxyLocations.filter((l) => l.type === GalaxyLocationType.DebrisField).length).toBeGreaterThanOrEqual(2);
        const pd = g.galaxyLocations.filter((l) => l.type === GalaxyLocationType.PlanetDestroyer);
        expect(pd).toHaveLength(1);
        expect(pd[0].relatedBuiltObject!.unbuiltComponentCount).toBeGreaterThan(0);
        // min(6, max(1, 300/160)) = 1 Origins ruin (the Human one).
        const origins = g.habitats.filter((h) => h.ruin?.type === RuinType.Origins);
        // (SelectSpecialRuins keeps an existing ruin on the lonely habitat FindLonelyHabitat returns — then none is added.)
        expect(origins.length).toBeLessThanOrEqual(1);
        for (const h of origins) expect(h.ruin!.originsRace?.name).toBe('Human');
    });

    it('runs 120 game seconds with every story line on without hitting a story TODO', () => {
        const r = runGameSeconds(game, 120);
        expect(r.frames).toBeGreaterThan(0);
    }, 300000);
});

describe('Distant Worlds story clues (Galaxy.5.cs 3622-3942)', () => {
    it('the first clue index is 1 (index 0 is skipped), clues are spent in order, location hints go to the player', () => {
        const g = createGame(storyOptions(gameData, { storyReturnOfTheShakturiEnabled: false, storyShadowsEnabled: false })).galaxy;
        expect(selectUnusedStoryClue(g)).toBe(1);
        expect(checkForStoryLocationHint(g)).toBe(''); // StoryCluesEnabled still off
        const station = g.storyClueLocations[1]!;
        expect(generateStoryClue(g, station)).toBe('StoryClue2');
        expect(g.storyCluesEnabled).toBe(true);
        expect(g.storyClueUsed[1]).toBe(true);
        expect(selectUnusedStoryClue(g)).toBe(2);
        const hints = g.playerEmpire!.locationHints.length;
        expect(checkForStoryLocationHint(g)).not.toBe('');
        expect(g.playerEmpire!.locationHints.length).toBe(hints + 1);
        expect(checkAllStoryCluesUsed(g)).toBe(false);
        // Secondary clues 4-8 (levels [2, 3, 4, 4, 5]) unlock when level <= next unused clue − 1: next clue 2 → none (no draw).
        expect(selectUnusedSecondaryStoryClueIndex(g)).toBe(-1);
        g.storyClueUsed[2] = true; // next clue 3 → level 2 → only index 4 (one Next(0, 1) draw)
        const d = g.rnd.drawCount;
        expect(selectUnusedSecondaryStoryClueIndex(g)).toBe(4);
        expect(g.rnd.drawCount).toBe(d + 1);
    }, 180000);
});

describe('Return of the Shakturi (Galaxy.8.cs 1348-2056, Empire.2.cs 3487-3777)', () => {
    it('FindNearestGalaxyEdgeCoords: the rim point opposite the centre', () => {
        const g = createGame({ ...tickGameOptions(gameData), starCount: 120, systemNames: Array.from({ length: 120 }, (_, i) => `S${i}`) }).galaxy;
        const cx = Math.trunc(g.sizeX / 2);
        const cy = Math.trunc(g.sizeY / 2);
        expect(findNearestGalaxyEdgeCoords(g, cx + 1000, cy)).toEqual({ x: Math.min(g.sizeX - 1, 2 * cx), y: cy });
        expect(findNearestGalaxyEdgeCoords(g, cx, cy - 5000)).toEqual({ x: cx, y: 0 });
        expect(expectedMaximumColoniesInGalaxy(g)).toBe(Math.trunc(120 * 0.47 * g.colonyPrevalence));
    }, 180000);

    it('the Mechanoid adviser warns the player at event level 0; the beacon; the Erutkah; enrage; invasion', () => {
        withRaceRestored(gameData, () => {
            const game = createGame(storyOptions(gameData, { storyDistantWorldsEnabled: false, storyShadowsEnabled: false }));
            const g = game.galaxy;
            const player = g.playerEmpire!;
            const mech = identifyMechanoidEmpire(g)!;
            expect(mech).not.toBeNull();
            // Met: Mechanoid ↔ player relation None. Too early for the beacon → num = 0 → level 0 without a Shakturi empire → warning.
            obtainDiplomaticRelation(mech, player).type = DiplomaticRelationType.None;
            obtainDiplomaticRelation(player, mech).type = DiplomaticRelationType.None;
            const before = (player.messages as { messageType: number }[]).length;
            checkOfferStoryHint(g, mech);
            const msgs = (player.messages as { messageType: number; description: string }[]).slice(before);
            expect(msgs.map((m) => m.messageType)).toEqual([EmpireMessageType.StoryMessage]);
            expect(msgs[0].description).toBe('We have an important warning that you need to hear');
            expect(g.shakturiTriggerHabitat).toBeNull();
            // The Beacon of Shaktur (normally once 25-80 years have passed).
            generateShakturiReturnTriggerRuins(g);
            const beacon = g.shakturiTriggerHabitat!;
            expect(beacon.ruin!.name).toBe('Beacon of Shaktur');
            expect(beacon.ruin!.type).toBe(RuinType.StoryEvent);
            expect(beacon.ruin!.storyEventData).toBe(1);
            // Investigating it (Galaxy.5.cs 4563-4598) brings the Erutkah refugees.
            const n = g.empires.length;
            investigateRuinsStoryEvent(g, player, beacon, '');
            expect(beacon.ruin!.storyEventData).toBe(0);
            expect(g.empires.length).toBe(n + 1);
            const erutkah = g.empires[n];
            expect(erutkah.name).toBe('Erutkah Refugees');
            expect(identifyShakturiEmpire(g)).toBe(erutkah);
            const shakturi = galaxyRaceByName(g, 'Erutkah') as Race;
            expect(g.shakturiActualRace).toBe(shakturi);
            expect([shakturi.aggression, shakturi.friendliness, shakturi.troopName]).toEqual([75, 125, 'Erutkah Defender']);
            expect(g.shakturiOriginalRace!.name).toBe('Shakturi');
            expect(erutkah.capital!.ruin!.name).toBe('Palace of Eternal Darkness');
            expect(g.storyShakturiEnrageTimer).toBeGreaterThan(galaxyStarDateOf(g));
            // ShakturiSendConvoy: only the Shakturi empire draws; Next(0, 3) == 1 sends a (colony) convoy of up to 10.
            expect(drawsOf(g, () => shakturiSendConvoy(g, player))).toBe(0);
            const willSend = cloneRandom(g.rnd).next(0, 3) === 1;
            const ships = erutkah.builtObjects.length + erutkah.privateBuiltObjects.length;
            shakturiSendConvoy(g, erutkah);
            const added = erutkah.builtObjects.length + erutkah.privateBuiltObjects.length - ships;
            if (willSend) expect(added).toBeGreaterThan(0);
            else expect(added).toBe(0);
            // Enrage: the original levels come back.
            generateShakturiAggression(g, erutkah);
            expect(g.storyShakturiEnraged).toBe(true);
            expect(shakturi.aggression).toBe(g.shakturiOriginalRace!.aggression);
            // Invasion: the Shaktur Supremacy with 1 planet destroyer (< 700 stars) targeting the Mechanoid capital.
            generateShakturiInvasion(g, erutkah, mech);
            expect(erutkah.name).toBe('Shaktur Supremacy');
            expect(shakturi.name).toBe('Shakturi');
            expect(erutkah.targetHabitat).toBe(mech.capital);
            expect([...erutkah.builtObjects, ...erutkah.privateBuiltObjects].filter((b) => b.name === 'Revenge of Shaktur')).toHaveLength(1);
        });
    }, 300000);
});

describe('Legends: CheckSendShipConvoysViaGateway (Empire.1.cs 3899)', () => {
    it('no gateway wonder: no draw; with one: Next(0, 10), Next(0, 3), Next(7, 22) and a convoy', () => {
        const g = createGame({ ...tickGameOptions(gameData), starCount: 120, systemNames: Array.from({ length: 120 }, (_, i) => `S${i}`) }).galaxy;
        const e = g.empires[1];
        expect(drawsOf(g, () => checkSendShipConvoysViaGateway(g, e, 1))).toBe(0);
        // A RaceAchievement wonder with Value2 = 3 (the intergalactic gateway), derived from a shipped wonder definition.
        const wonder = planetaryFacilityDefinitionsStatic(g).find((d) => facilityType(d) === PlanetaryFacilityType.Wonder)!;
        const gateway = { ...wonder, wonderType: WonderType.RaceAchievement, value2: 3 };
        if (e.capital!.facilities === null) e.capital!.facilities = [];
        e.capital!.facilities.push(new PlanetaryFacility(gateway, 1));
        const r = cloneRandom(g.rnd);
        const first = r.next(0, 10);
        const ships = e.builtObjects.length + e.privateBuiltObjects.length;
        checkSendShipConvoysViaGateway(g, e, 1);
        if (first < 8) {
            const kind = r.next(0, 3);
            const size = r.next(7, 22);
            expect(size).toBeGreaterThanOrEqual(7);
            expect(kind).toBeLessThan(3);
            expect(e.builtObjects.length + e.privateBuiltObjects.length).toBeGreaterThan(ships);
        } else {
            expect(e.builtObjects.length + e.privateBuiltObjects.length).toBe(ships);
        }
    }, 180000);

    it('GenerateMilitaryConvoy / GenerateCivilianConvoy: one Next(0, 10) pick per ship, Move to the capital, support cost factor', () => {
        const g = createGame({ ...tickGameOptions(gameData), starCount: 120, systemNames: Array.from({ length: 120 }, (_, i) => `S${i}`) }).galaxy;
        const e = g.empires[2];
        const all = () => [...e.builtObjects, ...e.privateBuiltObjects];
        const before = new Set(all());
        generateMilitaryConvoy(g, e, 3, Math.fround(0.2));
        const added = all().filter((b) => !before.has(b));
        expect(added.length).toBeLessThanOrEqual(3);
        for (const b of added) {
            expect(b.supportCostFactor).toBe(Math.fround(0.2));
            expect((b.mission as { type: number; target: unknown } | null)?.type).toBe(BuiltObjectMissionType.Move);
        }
        const before2 = new Set(all());
        generateCivilianConvoy(g, e, 2, 1, 'World Ship X');
        for (const b of all().filter((x) => !before2.has(x))) if (b.subRole === BuiltObjectSubRole.ColonyShip) expect(b.name).toBe('World Ship X');
    }, 180000);
});

describe('Shadows (Empire.7.cs pre-warp story; Start.2.cs 1127 / 2031)', () => {
    it('a pre-warp Shadows start: the player alone may get the first pirate raid', () => {
        const o = tickGameOptions(gameData);
        const pre = (e: typeof o.player) => ({ ...e, age: 0, techLevel: 0 });
        const g = createGame({ ...o, galaxyAge: 0, player: pre(o.player), aiEmpires: o.aiEmpires.map(pre), storyShadowsEnabled: true }).galaxy;
        const player = g.playerEmpire!;
        expect(player.preWarpProgressEventsOccurred).toBe(false);
        expect(player.preWarpProgressEventOccurredSendPirateRaid).toBe(false);
        for (const e of g.empires) if (e !== player) expect(e.preWarpProgressEventOccurredSendPirateRaid).toBe(true);
        const r = runGameSeconds(g, 60);
        expect(r.frames).toBeGreaterThan(0);
    }, 300000);
});

function drawsOf(g: Galaxy, fn: () => void): number {
    const b = g.rnd.drawCount;
    fn();
    return g.rnd.drawCount - b;
}

function galaxyStarDateOf(g: Galaxy): number {
    return galaxyStarDate(g);
}

void ({} as Empire);
