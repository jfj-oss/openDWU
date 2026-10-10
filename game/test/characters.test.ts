import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape, HabitatCategoryType } from '../src/sim/types';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import { parseCharacterFile, parseCharacterNames } from '../src/sim/data/characters';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import type { Game } from '../src/sim/game';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime, YEAR_LENGTH } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { registerScenarioEvent, scenarioQuery } from '../src/sim/scenario/hooks';
import { stabilityTermValues } from '../src/sim/scenario/stability';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentType } from '../src/sim/data/components';
import { assignMission } from '../src/sim/missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { charactersCanGenerateAmountNonIntelligenceAgent } from '../src/sim/troops';
import { CV_LIVE_KEY, CV_STATE_KEY, peekCvState } from '../src/sim/scenario/charactersVictory/common';
import { assignEscorts, isVipShuttle, tripOfCharacter } from '../src/sim/scenario/charactersVictory/vip';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { leaveShipGroup } from '../src/sim/fleets/shipGroup';
import { generateVipShuttleDesign, vipComponentAllowed } from '../src/sim/scenario/charactersVictory/shuttleDesign';
import { colonyVacancy, reviewGovernors } from '../src/sim/scenario/charactersVictory/governorsCv';

import {
    CharacterEventType,
    CharacterRole,
    CharacterSkillType,
    CharacterTraitType,
    captainBonuses,
    determineValidTraitsForRole,
    empireCharactersHaveTrait,
    generateNewCharacter,
    generateStartingCharacters,
    getCharacterMaintenanceBonuses,
    getEmpireCharacters,
    identifyPirateBase,
    raceAvailableCharacters,
    resolveCharacterColonyCorruptionBonus,
    resolveCharacterColonyHappinessBonus,
    resolveCharacterColonyIncomeBonus,
    resolveEmpireLeaderWarWearinessDivisor,
    resolveLeaderTroopMaintenanceFactor,
    stellarObjectCharacters,
    type Character,
} from '../src/sim/characters';

// Empire.6.cs GenerateStartingCharacters (4304/4309), called as Start.2.cs 1477-1485 does
// (galaxy.AllowRaceStartingCharacters = true; every empire with a DominantRace, in empire order).
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 60000);

/** createGame stopped just before Start.2.cs 1474 (the starting characters) — test-only seam. */
function beforeCharacters(o: CreateGameOptions): Galaxy {
    return createGame({ ...o, __phaseHook: (phase) => (phase === 'diplomacy' ? 'stop' : undefined) }).galaxy;
}

function opts(piratePrevalence = 0): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData, piratePrevalence,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0.5 },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
    };
}

/** Wraps galaxy.rnd.next / nextDouble to log every Galaxy.Rnd draw. */
function traceRnd(g: Galaxy): string[] {
    const log: string[] = [];
    const rnd = g.rnd as unknown as { next: (...a: number[]) => number; nextDouble: () => number };
    const next = rnd.next.bind(rnd);
    const nextDouble = rnd.nextDouble.bind(rnd);
    rnd.next = (...a: number[]) => {
        const r = next(...a);
        log.push(`${a.join(',')}=${r}`);
        return r;
    };
    rnd.nextDouble = () => {
        const r = nextDouble();
        log.push(`d=${r}`);
        return r;
    };
    return log;
}

const describeCharacter = (c: Character) => ({
    role: CharacterRole[c.role],
    name: c.name,
    race: c.race?.name,
    skills: c.skills.items.map((s) => `${CharacterSkillType[s.type]}:${s.level}`),
    traits: c.traits.map((t) => CharacterTraitType[t]),
    location: c.location?.name,
    bonusesKnown: c.bonusesKnown,
});

function startNormalEmpires(g: Galaxy): { draws: number[]; log: string[] } {
    const log = traceRnd(g);
    const draws: number[] = [];
    // Start.2.cs 1478-1485.
    g.allowRaceStartingCharacters = true;
    for (const e of g.empires) {
        if (e.dominantRace === null) continue;
        const before = log.length;
        generateStartingCharacters(g, e);
        draws.push(log.length - before);
    }
    return { draws, log };
}

describe('character data parsers', () => {
    it('characterNames.txt: one first/last line pair per race family (Replace(" ","").Split(","))', () => {
        const names = gameData.characterNames!;
        expect(names.firstNames.length).toBe(gameData.raceFamilies.length);
        expect(names.firstNames[0].length).toBe(31);
        expect(names.lastNames[0].length).toBe(26);
        expect(names.firstNames[0][0]).toBe('Donato');
        // REPTILIAN first names end with ", " → trailing empty name, as in C#.
        expect(names.firstNames[3][names.firstNames[3].length - 1]).toBe('');
        const tiny = parseCharacterNames("﻿'c\r\n\r\nA, B\r\nC,D\r\n", 1);
        expect(tiny).toEqual({ firstNames: [['A', 'B']], lastNames: [['C', 'D']] });
    });

    it('characters/<race>.txt: 16 comma tokens per line', () => {
        const rows = gameData.characterFiles!.get('Human')!;
        expect(rows.length).toBe(1);
        expect(rows[0].tokens).toEqual(['0', 'Than Bendu', '2', '', 'Human', '1', '25', '0', '0', '0', '0', '0', '0', '37', '39', '0']);
        expect(() => parseCharacterFile('1, a, 2', 'x.txt')).toThrow('Could not read Role at line 1 of file x.txt');
    });

    it('Race.AvailableCharacters (LoadCharactersCompleteFilePath): skills/traits go through AddSkill/AddTrait', () => {
        // Before the starting characters consume the appearance-order-0 entries.
        const g = beforeCharacters(opts());
        const human = g.races.find((r) => r.name === 'Human')!;
        const [than] = raceAvailableCharacters(g, human)!;
        expect(describeCharacter(than)).toEqual({ role: 'Ambassador', name: 'Than Bendu', race: 'Human', skills: ['Diplomacy:25'], traits: ['Tolerant', 'EloquentSpeaker'], location: undefined, bonusesKnown: false });
        expect(than.appearanceOrder).toBe(0);
        // Ugnari "Tek Ixito" lists trait 32 (Measured), not valid for an IntelligenceAgent → AddTrait rejects it.
        const ugnari = g.races.find((r) => r.name === 'Ugnari')!;
        const [tek] = raceAvailableCharacters(g, ugnari)!;
        expect(tek.traits).toEqual([]);
        expect(determineValidTraitsForRole(CharacterRole.IntelligenceAgent, true).includes(CharacterTraitType.Measured)).toBe(false);
        expect(tek.espionage).toBe(70);
    }, 60000);
});

describe('GenerateStartingCharacters (normal empires, seed 1)', () => {
    it('creates the C# starting characters, deterministic Rnd use', () => {
        const g = beforeCharacters(opts());
        const { draws, log } = startNormalEmpires(g);
        // Rnd draws per empire (generation of random characters + 6 per activated character).
        // (re-pinned M4k: the game-start Empire.DoTasks now runs PerformResearch, whose research-queue selection and research events draw Rnd)
        // (re-pinned M4s1: ReviewPirateRelations draws one Rnd.NextDouble per Empire long block, incl. the game-start DoTasks)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        // (re-pinned M4u: the game-start Empire.DoTasks runs the character reviews and ReviewEmpireEvents, whose Rnd moves the
        // empire placement and races)
        // (Merge of M4f onto M4u/M4o/M4l: re-pinned once against the combined code.)
        // (re-pinned M4x: galaxyAge now defaults to 1, so Galaxy.Age 1 (military starting ships, int_5 > 0 game-start
        // steps) moves the Rnd stream reaching this step.)
        // (re-pinned M4m: the game-start Empire.DoTasks runs the military AI — IdentifyMilitaryObjectives Next(0, EmpireEvaluations.Count), CheckTemptingTargets Next(0, Empires.Count), DetermineRandomAttacks Next(0, n) — which shifts the Rnd stream.)
        // (M4m merge onto M4s2/M4y: re-pinned once against the merged code.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        // Moved [53,57,49,21] → [37,62,53,40]: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved [37,62,53,40] → [67,49,45,27]: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved [67,49,45,27] → [49,58,50,26]: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(draws).toMatchPin('characters.drawsPerEmpire');
        expect(log.filter((d) => d.startsWith('d=')).length).toBe(0);
        const summary = g.empires.map((e) => ({ race: e.dominantRace!.name, leader: e.leader?.name, characters: getEmpireCharacters(e).map(describeCharacter) }));
        // (re-pinned: createGame now runs the price reviews, first galaxy tick, per-empire setup,
        // starting ships and diplomacy before this step, so the character draws come later in the
        // Rnd stream; draw counts per character are unchanged in shape.)
        // (re-pinned M4k: game-start research shifts the Rnd stream before this step.)
        // (re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in each game-start Empire.DoTasks long block.)
        // re-pinned M4u: the game-start Empire.DoTasks runs the character reviews (ReviewCharacterTraits / ApplyCharacterLocationBonus Rnd) and ReviewEmpireEvents (DoRaceEvent Rnd), moving the Rnd stream (and empire placement / races) from the first empire on.
        // (re-pinned M4m: the game-start Empire.DoTasks runs the military AI, shifting the Rnd stream before this step.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        // Moved #ee2aabf5a3 → #cfcd8778ea: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved #cfcd8778ea → #cfbdaffa37: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved #cfbdaffa37 → #b8cebf0fc6: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(summary[0]).toMatchPin('characters.humanSummary');
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        // Moved #85c85ee56b → #c91fd66eee: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved #c91fd66eee → #25e9872cfe: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved #25e9872cfe → #8813640a82: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(summary.slice(1).map((s) => [s.race, s.leader, s.characters.map((c) => `${c.role}:${c.name}`)])).toMatchPin('characters.otherEmpires');
        // Human empire full draw sequence: Leader (15: name 2, skill count, skill picks + levels, trait
        // count, trait), one agent (16: Next(0,4) race roll + ...), then 6 × (CharacterTransferLocation +
        // CharacterStart: Next(0,5), Next(0,20), Next(0,80) each) for the 3 characters; the second empire's draws follow.
        // (re-pinned M4s1: the Rnd stream reaching this step moved, see above.)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785): the Human empire now activates 3 characters, so the 60-draw window spills into the next empire.)
        // (re-pinned M4u: see the summary pin above.)
        // (re-pinned M4f: the game-start AssignMissionsToBuiltObjectList draws shift the stream reaching this step.)
        // (Merge of M4f onto M4u/M4o/M4l: re-pinned once against the combined code.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        // Moved #03cf764cc3 → #cdd8b96693: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved #cdd8b96693 → #ff6ff3f142: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved #ff6ff3f142 → #5d56d45b17: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(log.slice(0, 60)).toMatchPin('characters.drawLog60');
        // (M4u: Leader 11 + agent 15 draws, activations at 26; M4f: at 40. Merged code: the Human leader activates with 20
        // trait rolls (Next(0, 1)), then the agent, so the activations start at 44.)
        // (M4x: Galaxy.Age 1 stream: the activations start at 45.)
        // (M4m merge: the merged stream generates a leader and an agent with fewer rolls (no 20 trait rolls): the
        // activations start at 19.)
        // (M4q merge: the merged stream's first leader rolls more traits again: the activations start at 35.)
        const activations = Array.from({ length: 6 }, () => ['0,5', '0,20', '0,80']).flat();
        const activationsAt = log.findIndex((_, i) => activations.every((a, j) => log[i + j]?.split('=')[0] === a));
        // Moved 35 → 19: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved 19 → 49: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved 49 → 31: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(activationsAt).toMatchPin('characters.activationsAt', 31);
        expect(log.slice(activationsAt, activationsAt + 18).map((d) => d.split('=')[0])).toEqual(activations);

        for (const e of g.empires) {
            const chars = getEmpireCharacters(e);
            expect(e.leader).not.toBeNull();
            expect(e.leader!.role).toBe(CharacterRole.Leader);
            for (const c of chars) {
                expect(c.active).toBe(true);
                expect(c.empire).toBe(e);
                expect(c.location).toBe(e.capital);
                expect(c.eventHistory.map((ev) => ev.type)).toEqual([CharacterEventType.CharacterTransferLocation, CharacterEventType.CharacterStart]);
            }
            expect(stellarObjectCharacters(e.capital!)).toEqual(chars);
            // The dominant race's appearance-order-0 character was consumed.
            expect(raceAvailableCharacters(g, e.dominantRace!)!.filter((c) => c.appearanceOrder === 0)).toEqual([]);
        }

        // Determinism.
        const g2 = beforeCharacters(opts());
        const r2 = startNormalEmpires(g2);
        expect(r2.log).toEqual(log);
        expect(g2.empires.map((e) => getEmpireCharacters(e).map(describeCharacter))).toEqual(g.empires.map((e) => getEmpireCharacters(e).map(describeCharacter)));
        // createGame's own 1474-1482 step makes the same characters with the same draws.
        let fullLog: string[] = [];
        let atCharacters = -1;
        const g3 = createGame({
            ...opts(),
            __phaseHook: (phase, gal) => {
                if (phase === 'diplomacy') fullLog = traceRnd(gal);
                if (phase === 'characters') atCharacters = fullLog.length;
            },
        }).galaxy;
        expect(fullLog.slice(0, atCharacters)).toEqual(log);
        expect(g3.empires.map((e) => getEmpireCharacters(e).map(describeCharacter))).toEqual(g.empires.map((e) => getEmpireCharacters(e).map(describeCharacter)));
    }, 120000);

    it('bonus getters read the leader and the colony characters (bonuses known only)', () => {
        const g = createGame(opts()).galaxy; // createGame generates the starting characters (Start.2.cs 1474-1482)
        const human = g.empires[0];
        const dhayut = g.empires[2];
        const cap = dhayut.capital!;
        const leader = dhayut.leader!;
        // Habitat.cs 616-624: colony characters excluding leaders count only when BonusesKnown (none) + leader.
        expect(resolveCharacterColonyHappinessBonus(cap)).toBe(leader.colonyHappiness);
        // pinned for seed 1 (re-pinned M4k: game-start research shifts the Rnd stream; re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        // (re-pinned M4u: game-start character reviews / race events shift the Rnd stream; the new Dhayut leader.)
        // (re-pinned M4f: game-start AssignMissionsToBuiltObjectList draws shift the character stream)
        // (merge of M4f onto M4u/M4o/M4l: re-pinned once; the merged stream gives the Dhayut leader Nashan Xetry.)
        // (re-pinned M4m: the game-start Empire.DoTasks runs the military AI — IdentifyMilitaryObjectives Next(0, EmpireEvaluations.Count), CheckTemptingTargets Next(0, Empires.Count), DetermineRandomAttacks Next(0, n) — which shifts the Rnd stream.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        // Moved 0 → 15: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved 15 → 10: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved 10 → 0: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(leader.colonyHappiness).toMatchPin('characters.dhayutLeaderColonyHappiness', 0);
        expect(resolveCharacterColonyIncomeBonus(cap)).toBe(leader.colonyIncome);
        expect(resolveCharacterColonyCorruptionBonus(cap)).toBe(leader.colonyCorruption);
        expect(resolveEmpireLeaderWarWearinessDivisor(dhayut)).toBe(1.0 + leader.warWeariness / 100.0);
        expect(resolveLeaderTroopMaintenanceFactor(dhayut)).toBe(1.0 + leader.troopMaintenance / 100.0);
        // Military ships without captains: GetCharacterMaintenanceBonuses = leader MilitaryShipMaintenance.
        for (const e of g.empires) {
            for (const b of e.builtObjects) {
                if (b.role === 1 /* BuiltObjectRole.Military */ && (b.characters === null || b.characters.length === 0)) expect(getCharacterMaintenanceBonuses(b)).toBe(e.leader!.militaryShipMaintenance);
            }
        }
        expect(empireCharactersHaveTrait(human, CharacterRole.Scientist, CharacterTraitType.UltraGenius)).toBe(false);
    }, 120000);
});

describe('GenerateStartingCharacters(pirate base) (Galaxy.8.cs 4822)', () => {
    it('AI pirate factions: PirateLeader + agents at the pirate base, no race characters', () => {
        // GeneratePirateEmpire (Galaxy.8.cs 4822) generates them; Start.2.cs 500 keeps
        // AllowRaceStartingCharacters false while the AI pirates are generated (first galaxy tick).
        const at: { rolesAfterTick: string[] | null; pirate: Empire | null } = { rolesAfterTick: null, pirate: null };
        const g = createGame({
            ...opts(1),
            __phaseHook: (phase, gal) => {
                if (phase === 'priceReviews') expect(gal.allowRaceStartingCharacters).toBe(false);
                if (phase === 'firstGalaxyTick') {
                    at.pirate = gal.pirateEmpires[0];
                    at.rolesAfterTick = getEmpireCharacters(at.pirate).map((c) => CharacterRole[c.role]);
                }
            },
        }).galaxy;
        expect(g.pirateEmpires.length).toBeGreaterThan(0);
        const p = at.pirate!;
        expect(p).toBe(g.pirateEmpires[0]);
        // Generated during the first galaxy tick, untouched by the rest of createGame.
        // Pinned for seed 1 (TS port): the first AI pirate faction's starting characters, now generated
        // inside GeneratePirateEmpire (Galaxy.8.cs 4822) during the first galaxy tick.
        // (re-pinned M4k: the game-start Empire.DoTasks now runs PerformResearch — SelectNextResearchProject draws
        // Rnd (SelectRandomLowestProject) and research events draw Next(0, num4) per industry — so later game-start
        // Rnd draws shift.)
        expect(at.rolesAfterTick).toMatchPin('characters.pirateRoles');
        const base = identifyPirateBase(p)!;
        const chars = getEmpireCharacters(p);
        expect(chars.map((c) => CharacterRole[c.role])).toEqual(at.rolesAfterTick);
        expect(p.leader).toBe(chars[0]);
        expect(chars.every((c) => c.location === base)).toBe(true);
        expect(chars[0].bonusesKnown).toBe(true);
        expect(stellarObjectCharacters(base)).toEqual(chars);
        // BuiltObject.ReviewCaptainBonuses ran on the base.
        expect(captainBonuses(base)).not.toBeNull();
        // No race (AvailableCharacters) characters: every character was generated.
        expect(chars.every((c) => c.appearanceOrder !== 0 || c.race === null || !raceAvailableCharacters(g, c.race)!.includes(c))).toBe(true);
    }, 120000);
});

// ---------------------------------------------------------------------------------------------------------------
// Characters & Victory add-on (scenarios/characters-victory; docs/CHARACTERS_AND_VICTORY.md): flag-off identity, VIP
// shuttle trips (spawn, arrival, death aboard), the shuttle design's restrictions, the governor cap and vacancy decline.
// ---------------------------------------------------------------------------------------------------------------
describe('Characters & Victory add-on', () => {
    const SC = 'characters-victory';
    const ALL_OFF = { charactersVictory: false, cvVipShuttles: false, cvEscorts: false, cvRulerDecoys: false, cvGovernors: false };
    const ON = { charactersVictory: true, cvVipShuttles: true, cvEscorts: true, cvRulerDecoys: true, cvGovernors: true };

    it('flags off: byte-identical to the plain seed-1 game (digest, Rnd stream, no state)', () => {
        const ref = cachedTickGameRun(gameData, { seconds: 900 });
        const { game } = createScenarioGame(gameData, { scenario: SC, flags: ALL_OFF });
        expect(Object.keys(game.galaxy.scenario!.flags).sort()).toEqual(Object.keys(ALL_OFF).sort());
        runGameSeconds(game, 900);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect(CV_STATE_KEY in game.galaxy.scenario!.state).toBe(false);
        expect(CV_LIVE_KEY in game.galaxy.scenario!.state).toBe(false);
    }, 1200000);

    function cvGame(): Game {
        return createScenarioGame(gameData, { scenario: SC, flags: ON }).game;
    }

    it('a transfer is a VIP shuttle trip: the character boards, the colony loses it at once, it arrives and the shuttle despawns', () => {
        const game = cvGame();
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const c = getEmpireCharacters(e).find((x) => x.active && x.location === e.capital && x.role !== CharacterRole.Leader)!;
        expect(c).toBeDefined();
        // A far destination: the empire's capital is the only colony at the start, so send the character to a far AI capital
        // as if it were an ambassador trip target — any habitat works as a destination (we only check the mechanics).
        const dest = g.empires.filter((x) => x !== e && x.capital !== null).sort((a, b) => b.empireId - a.empireId)[0].capital!;
        const arrived: string[] = [];
        const off = registerScenarioEvent({ id: 'test.cvArrive', flag: 'charactersVictory', event: 'vipTripArrived', run: (_g, ev) => arrived.push(ev.character.name) });
        try {
            c.transferToNewLocation(dest, g);
            const t = tripOfCharacter(g, c)!;
            expect(t).not.toBeNull();
            expect(c.location).toBe(t.shuttle);
            expect(stellarObjectCharacters(e.capital!)!.includes(c)).toBe(false);
            expect(stellarObjectCharacters(t.shuttle)!).toContain(c);
            expect(t.shuttle.subRole).toBe(BuiltObjectSubRole.PassengerShip);
            expect(isVipShuttle(g, t.shuttle)).toBe(true);
            // The shuttle refuses outside orders.
            assignMission(g, t.shuttle, BuiltObjectMissionType.Patrol, e.capital, null, BuiltObjectMissionPriority.Normal);
            expect(builtObjectMission(t.shuttle.mission)!.type).toBe(BuiltObjectMissionType.Move);
            // Fly until it arrives (or the stuck-trip deadline completes it).
            for (let i = 0; i < 400 && tripOfCharacter(g, c) !== null; i++) runGameSeconds(game, 3);
            expect(tripOfCharacter(g, c)).toBeNull();
            if (c.active) {
                expect(c.location).toBe(dest);
                expect(c.transferDestination).toBeNull();
                expect(arrived).toContain(c.name);
            }
            expect(t.shuttle.hasBeenDestroyed).toBe(true); // despawned
            expect(e.builtObjects.includes(t.shuttle)).toBe(false);
        } finally {
            off();
        }
    }, 600000);

    it('a passenger dies with a destroyed shuttle (the stock ShipDestroyed path)', () => {
        const game = cvGame();
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const c = getEmpireCharacters(e).find((x) => x.active && x.location === e.capital && x.role !== CharacterRole.Leader)!;
        const dest = g.empires.find((x) => x !== e && x.capital !== null)!.capital!;
        c.transferToNewLocation(dest, g);
        const t = tripOfCharacter(g, c)!;
        t.shuttle.hasBeenDestroyed = true; // as the combat destroy branch sets it before the teardown
        builtObjectCompleteTeardown(g, t.shuttle);
        expect(c.active).toBe(false);
        runGameSeconds(game, 6);
        expect(peekCvState(g)!.trips.some((x) => x.character === c)).toBe(false);
        expect(peekCvState(g)!.counters.tripsLost).toBeGreaterThanOrEqual(1);
    }, 600000);

    it('the VIP Shuttle design carries only the allowed components (no weapons, cargo, troops, sensors) at the fixed size', () => {
        const g = cvGame().galaxy;
        for (const e of g.empires.filter((x) => x.dominantRace !== null).slice(0, 3)) {
            const d = generateVipShuttleDesign(g, e)!;
            expect(d).not.toBeNull();
            for (const comp of d.components) expect(vipComponentAllowed(comp.type)).toBe(true);
            expect(d.components.some((x) => x.type === ComponentType.HyperDrive)).toBe(true);
            expect(d.firepowerRaw).toBe(0);
            expect(d.size).toBeLessThanOrEqual(180);
            expect(e.designs.includes(d)).toBe(false);
        }
    }, 600000);

    it('governors: outside the non-agent cap, a vacancy declines after the grace (approval term, taxes, no construction) and recovers', () => {
        const game = cvGame();
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const h = e.capital!;
        const govs = getEmpireCharacters(e).filter((x) => x.active && x.role === CharacterRole.ColonyGovernor);
        const before = charactersCanGenerateAmountNonIntelligenceAgent(e);
        // Governors do not count toward the stock cap.
        expect(scenarioQuery(g, 'characterCapExempt', 0, { empire: e })).toBe(govs.length);
        generateNewCharacter(g, e, CharacterRole.ColonyGovernor, h);
        expect(charactersCanGenerateAmountNonIntelligenceAgent(e)).toBe(before); // a new governor takes no room
        govs.push(getEmpireCharacters(e).filter((x) => x.active && x.role === CharacterRole.ColonyGovernor).pop()!);
        // Remove every governor at the capital: vacant.
        for (const c of govs) c.kill(g);
        expect(colonyVacancy(g, h).vacant).toBe(true);
        reviewGovernors(g, e);
        const r0 = peekCvState(g)!.colonies.find((x) => x.colony === h)!;
        expect(r0.vacantSince).toBeGreaterThanOrEqual(0);
        // Back-date the vacancy past the grace plus two years: neglect, a negative 'vacancy' term, lower taxes, paused facilities.
        r0.vacantSince -= (180 + 720) * (YEAR_LENGTH / 360);
        r0.updated -= 720 * (YEAR_LENGTH / 360);
        r0.riseAt = -1;
        reviewGovernors(g, e);
        expect(r0.neglect).toBeGreaterThan(0.4);
        const term = stabilityTermValues(g, h).find((x) => x.cause === 'vacancy')!;
        expect(term.value).toBeCloseTo(-20 * r0.neglect, 6);
        expect(scenarioQuery(g, 'colonyTaxRevenue', 1000, { habitat: h, empire: e })).toBeCloseTo(1000 * (1 - 0.5 * r0.neglect), 6);
        expect(scenarioQuery(g, 'colonyFacilityConstructionPaused', false, { habitat: h })).toBe(true);
        // A governor arrives: recovery at 1/5 per year.
        const n0 = r0.neglect;
        generateNewCharacter(g, e, CharacterRole.ColonyGovernor, h);
        r0.updated -= 360 * (YEAR_LENGTH / 360);
        reviewGovernors(g, e);
        expect(r0.vacantSince).toBe(-1);
        expect(r0.neglect).toBeCloseTo(Math.max(0, n0 - 0.2), 3);
    }, 600000);

    it('escorts: an important trip on a dangerous route takes idle warships (cap, floor), which are released on arrival', () => {
        const game = cvGame();
        const g = game.galaxy;
        const e = g.empires.find((x) => x !== g.playerEmpire && x.dominantRace !== null && x.capital !== null)!;
        // Ten idle, armed warships at the capital (out of their fleets, no mission).
        const war = e.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.firepowerRaw > 0 && b.warpSpeed > 0 && b.subRole !== BuiltObjectSubRole.TroopTransport && b.subRole !== BuiltObjectSubRole.ResupplyShip);
        for (const b of war) {
            if (b.shipGroup !== null) leaveShipGroup(g, b);
            const m = builtObjectMission(b.mission);
            if (m !== null) m.clear();
            b.isAutoControlled = true;
            b.xpos = e.capital!.xpos + 500;
            b.ypos = e.capital!.ypos + 500;
        }
        expect(war.length).toBeGreaterThanOrEqual(5);
        const c = getEmpireCharacters(e).find((x) => x.active && x.location === e.capital && x.role !== CharacterRole.Leader)!;
        // An unclaimed planet a few systems away (military ships are welcome there).
        const cap0 = e.capital!;
        const dest = g.habitats
            .filter((h) => h.empire === null && h.category === HabitatCategoryType.Planet && Math.hypot(h.xpos - cap0.xpos, h.ypos - cap0.ypos) > 500000)
            .sort((a, b) => Math.hypot(a.xpos - cap0.xpos, a.ypos - cap0.ypos) - Math.hypot(b.xpos - cap0.xpos, b.ypos - cap0.ypos))[0];
        c.transferToNewLocation(dest, g);
        const t = tripOfCharacter(g, c)!;
        t.importance = 10;
        t.danger = 1;
        if (t.escorts.length === 0) assignEscorts(g, t);
        const cap = Math.floor((war.length * 20) / 100);
        expect(t.escorts.length).toBeGreaterThan(0);
        expect(t.escorts.length).toBeLessThanOrEqual(Math.max(0, cap));
        for (const b of t.escorts) {
            const m = builtObjectMission(b.mission)!;
            expect(m.type).toBe(BuiltObjectMissionType.Escort);
            expect(m.targetBuiltObject).toBe(t.shuttle);
        }
        expect(t.waitUntil).toBeGreaterThan(0); // important and dangerous: waits for its escort to join
        const escorts = [...t.escorts];
        for (let i = 0; i < 600 && tripOfCharacter(g, c) !== null; i++) runGameSeconds(game, 3);
        expect(tripOfCharacter(g, c)).toBeNull();
        for (const b of escorts) {
            const m = builtObjectMission(b.mission);
            expect(m === null || m.type !== BuiltObjectMissionType.Escort || m.targetBuiltObject !== t.shuttle).toBe(true);
        }
    }, 600000);

    it('a CV game with trips in flight saves and reloads identically', () => {
        const game = cvGame();
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const c = getEmpireCharacters(e).find((x) => x.active && x.location === e.capital && x.role !== CharacterRole.Leader)!;
        c.transferToNewLocation(g.empires.find((x) => x !== e && x.capital !== null)!.capital!, g);
        runGameSeconds(game, 30);
        expect(peekCvState(g)!.trips.length).toBeGreaterThan(0);
        const saveText = (gm: Game): string => {
            const time = new GalaxyTime();
            time.togglePause();
            time.advance(gm.galaxy.nowMs);
            return serializeGame(gm as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: SC, flags: ON, params: {} } });
        };
        const gd = scenarioGameData(gameData, SC);
        const text = saveText(game);
        const back = deserializeGame(text, gd).game;
        expect(peekCvState(back.galaxy)!.trips.length).toBe(peekCvState(g)!.trips.length);
        runGameSeconds(game, 120);
        runGameSeconds(back, 120);
        expect(stateDigest(back.galaxy)).toBe(stateDigest(game.galaxy));
        expect(saveText(back)).toBe(saveText(game));
    }, 600000);
});
