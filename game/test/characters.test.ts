import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import { parseCharacterFile, parseCharacterNames } from '../src/sim/data/characters';
import {
    CharacterEventType,
    CharacterRole,
    CharacterSkillType,
    CharacterTraitType,
    captainBonuses,
    determineValidTraitsForRole,
    empireCharactersHaveTrait,
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
        expect(draws).toEqual([63, 43, 43, 21]);
        expect(log.filter((d) => d.startsWith('d=')).length).toBe(0);
        const summary = g.empires.map((e) => ({ race: e.dominantRace!.name, leader: e.leader?.name, characters: getEmpireCharacters(e).map(describeCharacter) }));
        // (re-pinned: createGame now runs the price reviews, first galaxy tick, per-empire setup,
        // starting ships and diplomacy before this step, so the character draws come later in the
        // Rnd stream; draw counts per character are unchanged in shape.)
        // (re-pinned M4k: game-start research shifts the Rnd stream before this step.)
        // (re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in each game-start Empire.DoTasks long block.)
        // re-pinned M4u: the game-start Empire.DoTasks runs the character reviews (ReviewCharacterTraits / ApplyCharacterLocationBonus Rnd) and ReviewEmpireEvents (DoRaceEvent Rnd), moving the Rnd stream (and empire placement / races) from the first empire on.
        expect(summary[0]).toEqual({
            "race": "Human",
            "leader": "Derras Walkin",
            "characters": [
                {
                    "role": "Ambassador",
                    "name": "Than Bendu",
                    "race": "Human",
                    "skills": [
                        "Diplomacy:25"
                    ],
                    "traits": [
                        "Tolerant",
                        "EloquentSpeaker"
                    ],
                    "location": "Sol 2",
                    "bonusesKnown": false
                },
                {
                    "role": "Leader",
                    "name": "Derras Walkin",
                    "race": "Human",
                    "skills": [
                        "MilitaryShipConstructionSpeed:-5",
                        "WarWeariness:-3"
                    ],
                    "traits": [
                        "PoorAdministrator",
                        "Trusting"
                    ],
                    "location": "Sol 2",
                    "bonusesKnown": true
                },
                {
                    "role": "IntelligenceAgent",
                    "name": "Yuri Tarfan",
                    "race": "Human",
                    "skills": [
                        "Espionage:-4"
                    ],
                    "traits": [
                        "InspiringPresence"
                    ],
                    "location": "Sol 2",
                    "bonusesKnown": false
                }
            ]
        });
        expect(summary.slice(1).map((s) => [s.race, s.leader, s.characters.map((c) => `${c.role}:${c.name}`)])).toEqual([
            [
                "Haakonish",
                "Doktan Rustov",
                [
                    "ColonyGovernor:Yentor Zhukziban",
                    "Leader:Doktan Rustov",
                    "IntelligenceAgent:Wokor Erakto"
                ]
            ],
            [
                "Dhayut",
                "Randul Oseri",
                [
                    "TroopGeneral:Maqtor Aklon",
                    "Leader:Randul Oseri",
                    "IntelligenceAgent:Wek Urtion"
                ]
            ],
            [
                "Ugnari",
                "Olbar Gokaal",
                [
                    "IntelligenceAgent:Tek Ixito",
                    "Leader:Olbar Gokaal"
                ]
            ]
        ]);
        // Human empire full draw sequence: Leader (15: name 2, skill count, skill picks + levels, trait
        // count, trait), one agent (16: Next(0,4) race roll + ...), then 6 × (CharacterTransferLocation +
        // CharacterStart: Next(0,5), Next(0,20), Next(0,80) each) for the 3 characters; the second empire's draws follow.
        // (re-pinned M4s1: the Rnd stream reaching this step moved, see above.)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785): the Human empire now activates 3 characters, so the 60-draw window spills into the next empire.)
        // (re-pinned M4u: see the summary pin above.)
        // (re-pinned M4f: the game-start AssignMissionsToBuiltObjectList draws shift the stream reaching this step.)
        // (Merge of M4f onto M4u/M4o/M4l: re-pinned once against the combined code.)
        expect(log.slice(0, 60)).toEqual([
            "0,31=14",
            "0,26=3",
            "0,2=1",
            "0,2=0",
            "0,3=1",
            "0,20=5",
            "0,3=1",
            "0,20=19",
            "0,4=1",
            "-5,-1=-5",
            "0,4=1",
            "-5,-1=-3",
            "0,2=1",
            "0,41=17",
            "0,41=0",
            "0,4=1",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,1=0",
            "0,31=7",
            "0,26=9",
            "0,2=0",
            "0,3=0",
            "0,3=0",
            "0,4=1",
            "-5,-1=-4",
            "0,2=0",
            "0,14=0",
            "0,5=0",
            "0,20=12",
            "0,80=69",
            "0,5=2",
            "0,20=12",
            "0,80=5",
            "0,5=1",
            "0,20=17",
            "0,80=33",
            "0,5=1",
            "0,20=0",
            "0,80=52",
            "0,5=0",
            "0,20=6",
            "0,80=47"
        ]);
        // (M4u: Leader 11 + agent 15 draws, activations at 26; M4f: at 40. Merged code: the Human leader activates with 20
        // trait rolls (Next(0, 1)), then the agent, so the activations start at 44.)
        // (M4x: Galaxy.Age 1 stream: the activations start at 45.)
        expect(log.slice(45, 63).map((d) => d.split('=')[0])).toEqual(Array.from({ length: 6 }, () => ['0,5', '0,20', '0,80']).flat());

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
        expect(leader.colonyHappiness).toBe(-10);
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
        expect(at.rolesAfterTick).toEqual(PIRATE_ROLES);
        const base = identifyPirateBase(p)!;
        const chars = getEmpireCharacters(p);
        expect(chars.map((c) => CharacterRole[c.role])).toEqual(PIRATE_ROLES);
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

// Pinned for seed 1 (TS port): the first AI pirate faction's starting characters, now generated
// inside GeneratePirateEmpire (Galaxy.8.cs 4822) during the first galaxy tick.
// (re-pinned M4k: the game-start Empire.DoTasks now runs PerformResearch — SelectNextResearchProject draws
// Rnd (SelectRandomLowestProject) and research events draw Next(0, num4) per industry — so later game-start
// Rnd draws shift.)
const PIRATE_ROLES: string[] = ['PirateLeader', 'IntelligenceAgent'];
