// Starting empires never share a home system. Regression for a player's galaxy (3000 stars, 40 x 40 sectors, the
// player + 25 auto-generated empires) where four Human empires — and two Boskara, two Kiadian — started in one system
// each. Cause (game.ts findAiCapital): with more empires than the 20 playable races, races repeat; the C# "(Random)"
// proximity search only looks inside the race's region while keeping 0.75 * SizeX / (sqrt(empires) - 1) from every
// colony, which a second empire of the race practically never meets, so it falls to Start.cs method_51's fallback —
// the MainSequence star nearest the region's centre, the same star every time. The original's wizard caps the
// auto-generated empires at max(playable races, 20) - 1 (Start.2.cs 4200, BaconStart.method_61), so it never gets
// there; our wizard allows up to 100 (Big Galaxies, task 19k-1). A repeated race now searches as a region-less race.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameData } from '../src/sim/data/gameData';
import { parseSystemNames } from '../src/sim/data';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { defaultStartGameOptions, toCreateGameOptions, type StartGameOptions } from '../src/sim/startGameOptions';
import { loadGameDataFs } from './helpers/loadGameDataFs';

let gameData: GameData;
let systemNames: string[];
beforeAll(async () => {
    gameData = await loadGameDataFs();
    systemNames = parseSystemNames(readFileSync(resolve(__dirname, '../public/assets/dwu/systemNames.txt'), 'utf8'));
}, 120000);

/** The wizard settings saved in the player's test1.dwusave (deserializeGame's startOptions). */
const PLAYER_GALAXY: Partial<StartGameOptions> = {
    "shape": 1,
    "starCountIndex": 5,
    "dimensionIndex": 4,
    "seed": 149181972,
    "raceName": "Gizurean",
    "empireName": "Buugg",
    "governmentId": 4,
    "flagShapeIndex": 5,
    "primaryColor": "#520001",
    "secondaryColor": "#003170",
    "colonyPrevalenceIndex": 0,
    "alienLifeIndex": 0,
    "spaceCreaturesIndex": 3,
    "piratesIndex": 5,
    "pirateProximityIndex": 1,
    "pirateStrengthIndex": 3,
    "galaxyResearchSpeed": 160,
    "aggressionIndex": 2,
    "difficultyIndex": 2,
    "difficultyScaling": false,
    "victory": {
        "territory": true,
        "territoryPercent": 33,
        "population": true,
        "populationPercent": 33,
        "economy": true,
        "economyPercent": 33,
        "timeLimit": false,
        "timeLimitYears": 30,
        "startDateYears": 20,
        "timeStart": true,
        "enableDisasterEvents": true,
        "enableRaceSpecificConditions": true,
        "enableRaceSpecificEvents": true,
        "victoryThresholdPercentage": 0.8,
        "enableStoryEvents": true,
        "enableStoryEventsShadows": true,
        "enableStoryDistantWorlds": true
    },
    "colonization": {
        "enforceRangeLimits": false,
        "colonizationRangeKly": 2000,
        "colonyInfluenceRangePercent": 100,
        "allowSameSystemAsOtherEmpires": true
    },
    "otherEmpires": {
        "autogenerate": true,
        "empireCount": 25,
        "manual": []
    },
    "galaxyExpansionIndex": 0,
    "empireExpansionIndex": 1,
    "empireTechLevelIndex": 0,
    "empireType": "CustomStandard",
    "piratePlayStyleIndex": 0,
    "destroyedPiratesDoNotRespawn": false,
    "spawnNewEmpires": true,
    "allowTechTrading": true,
    "allowGiantKaltorGeneration": true,
    "empireCorruptionIndex": 0,
    "homeSystemIndex": 2,
    "startLocationIndex": 4,
    "scaleDebrisFields": true,
    "scenario": null,
    "customStarCount": 3000,
    "customSectorWidth": 40,
    "customSectorHeight": 40
};

/** createGame up to the empire capitals (stops before the starting colonies; the capitals are all placed by then). */
function capitalsOf(opts: CreateGameOptions): Galaxy {
    return createGame({ ...opts, __phaseHook: (phase) => (phase === 'startingColonies' ? 'stop' : undefined) }).galaxy;
}

function startOptions(o: Partial<StartGameOptions>): CreateGameOptions {
    return toCreateGameOptions({ ...defaultStartGameOptions(), ...o } as StartGameOptions, gameData, systemNames);
}

/** Home systems holding more than one empire's capital, as "star: empire, empire". */
function sharedHomeSystems(galaxy: Galaxy): string[] {
    const bySystem = new Map<number, string[]>();
    for (const e of galaxy.empires) {
        const s = e.capital!.systemIndex;
        bySystem.set(s, [...(bySystem.get(s) ?? []), e.name]);
    }
    return [...bySystem].filter(([, n]) => n.length > 1).map(([s, n]) => `${galaxy.systems[s].systemStar.name}: ${n.join(', ')}`);
}

function repeatedRaces(galaxy: Galaxy): number {
    return galaxy.empires.length - new Set(galaxy.empires.map((e) => e.dominantRace)).size;
}

describe('starting empires get their own home systems', () => {
    it("the player's 26-empire, 3000-star galaxy (races repeat): one capital per system", () => {
        const galaxy = capitalsOf(startOptions(PLAYER_GALAXY));
        expect(galaxy.empires).toHaveLength(26);
        expect(repeatedRaces(galaxy)).toBeGreaterThan(0); // the case under test: 4 Human, 2 Boskara / Kiadian / Naxxilian
        expect(sharedHomeSystems(galaxy)).toEqual([]);
    }, 300000);

    // The AI races are all distinct here; a random player race can still repeat one of them (the player's race is
    // picked apart from the empire-start list, Start.2.cs method_48, as in the original).
    it('a standard galaxy at the original wizard cap (700 stars, 19 other empires)', () => {
        const galaxy = capitalsOf(startOptions({ seed: 7, otherEmpires: { autogenerate: true, empireCount: 19, manual: [] } }));
        expect(galaxy.empires).toHaveLength(20);
        expect(repeatedRaces(galaxy)).toBeLessThanOrEqual(1);
        expect(sharedHomeSystems(galaxy)).toEqual([]);
    }, 300000);

    it('a standard-size galaxy past the cap (700 stars, 35 other empires, races repeat)', () => {
        const galaxy = capitalsOf(startOptions({ seed: 7, otherEmpires: { autogenerate: true, empireCount: 35, manual: [] } }));
        expect(galaxy.empires).toHaveLength(36);
        expect(repeatedRaces(galaxy)).toBeGreaterThan(0);
        expect(sharedHomeSystems(galaxy)).toEqual([]);
    }, 300000);
});
