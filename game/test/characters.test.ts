import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import type { Galaxy } from '../src/sim/galaxy';
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
        const g = createGame(opts()).galaxy;
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
        const g = createGame(opts()).galaxy;
        const { draws, log } = startNormalEmpires(g);
        // Rnd draws per empire (generation of random characters + 6 per activated character).
        expect(draws).toEqual([59, 129, 52, 33]);
        expect(log.filter((d) => d.startsWith('d=')).length).toBe(0);
        const summary = g.empires.map((e) => ({ race: e.dominantRace!.name, leader: e.leader?.name, characters: getEmpireCharacters(e).map(describeCharacter) }));
        expect(summary[0]).toEqual({
            race: 'Human',
            leader: 'Yan Kesky',
            characters: [
                { role: 'Ambassador', name: 'Than Bendu', race: 'Human', skills: ['Diplomacy:25'], traits: ['Tolerant', 'EloquentSpeaker'], location: 'Hotaulf', bonusesKnown: false },
                { role: 'Leader', name: 'Yan Kesky', race: 'Human', skills: ['ColonyHappiness:7'], traits: ['Xenophobic'], location: 'Hotaulf', bonusesKnown: true },
                { role: 'IntelligenceAgent', name: 'Gerrin Dobachi', race: 'Human', skills: ['Assassination:-3'], traits: ['IntelligenceCorrupt'], location: 'Hotaulf', bonusesKnown: false },
                { role: 'IntelligenceAgent', name: 'Lorien Kesky', race: 'Human', skills: ['Concealment:10', 'Sabotage:-3'], traits: ['IntelligenceCorrupt'], location: 'Hotaulf', bonusesKnown: false },
            ],
        });
        expect(summary.slice(1).map((s) => [s.race, s.leader, s.characters.map((c) => `${c.role}:${c.name}`)])).toEqual([
            ['Haakonish', 'Bakra Yemodo', ['ColonyGovernor:Yentor Zhukziban', 'Leader:Bakra Yemodo', 'IntelligenceAgent:Uza Fushti', 'IntelligenceAgent:Fhasha Takruan']],
            ['Dhayut', 'Wudri Losit', ['TroopGeneral:Maqtor Aklon', 'Leader:Wudri Losit', 'IntelligenceAgent:Kibul Nassiki']],
            ['Ugnari', 'Ossan Edari', ['IntelligenceAgent:Tek Ixito', 'Leader:Ossan Edari']],
        ]);
        // Human empire full draw sequence: Leader (9: name 2, skill count 1, pick 2, level 2, trait count 1,
        // trait 1), agent 1 (11: Next(0,4) race roll + ...), agent 2 (15), then 4 × (CharacterTransferLocation
        // + CharacterStart: Next(0,5), Next(0,20), Next(0,80) each).
        expect(log.slice(0, 35)).toEqual([
            '0,31=27', '0,26=13', '0,2=0', '0,3=0', '0,4=2', '0,4=0', '2,10=7', '0,2=0', '0,41=36',
            '0,4=2', '0,31=19', '0,26=7', '0,2=0', '0,3=1', '0,3=2', '0,4=1', '-5,-1=-3', '0,2=1', '0,14=12', '0,14=13',
            '0,4=0', '0,31=3', '0,26=13', '0,2=1', '0,2=0', '0,3=1', '0,3=1', '0,3=2', '0,3=2', '0,4=0', '5,16=10', '0,4=1', '-5,-1=-3', '0,2=0', '0,14=12',
        ]);
        expect(log.slice(35, 59).map((d) => d.split('=')[0])).toEqual(Array.from({ length: 8 }, () => ['0,5', '0,20', '0,80']).flat());

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
        const g2 = createGame(opts()).galaxy;
        const r2 = startNormalEmpires(g2);
        expect(r2.log).toEqual(log);
        expect(g2.empires.map((e) => getEmpireCharacters(e).map(describeCharacter))).toEqual(g.empires.map((e) => getEmpireCharacters(e).map(describeCharacter)));
    }, 120000);

    it('bonus getters read the leader and the colony characters (bonuses known only)', () => {
        const g = createGame(opts()).galaxy;
        startNormalEmpires(g);
        const human = g.empires[0];
        const cap = human.capital!;
        const leader = human.leader!;
        // Habitat.cs 616-624: colony characters excluding leaders count only when BonusesKnown (none) + leader.
        expect(resolveCharacterColonyHappinessBonus(cap)).toBe(leader.colonyHappiness);
        expect(leader.colonyHappiness).toBe(7);
        expect(resolveCharacterColonyIncomeBonus(cap)).toBe(leader.colonyIncome);
        expect(resolveCharacterColonyCorruptionBonus(cap)).toBe(leader.colonyCorruption);
        expect(resolveEmpireLeaderWarWearinessDivisor(human)).toBe(1.0 + leader.warWeariness / 100.0);
        expect(resolveLeaderTroopMaintenanceFactor(human)).toBe(1.0 + leader.troopMaintenance / 100.0);
        // Haakonish leader: MilitaryShipMaintenance 7 → military ship maintenance bonus via GetCharacterMaintenanceBonuses.
        const haak = g.empires[1];
        expect(haak.leader!.militaryShipMaintenance).toBe(7);
        const military = haak.builtObjects.find((b) => b.role === 1 /* BuiltObjectRole.Military */);
        if (military) expect(getCharacterMaintenanceBonuses(military)).toBe(7);
        expect(empireCharactersHaveTrait(human, CharacterRole.Scientist, CharacterTraitType.UltraGenius)).toBe(false);
    }, 120000);
});

describe('GenerateStartingCharacters(pirate base) (Galaxy.8.cs 4822)', () => {
    it('AI pirate factions: PirateLeader + agents at the pirate base, no race characters', () => {
        const g = createGame(opts(1)).galaxy;
        expect(g.pirateEmpires.length).toBeGreaterThan(0);
        // Start.2.cs 500: AllowRaceStartingCharacters is false while AI pirates are generated.
        g.allowRaceStartingCharacters = false;
        const p = g.pirateEmpires[0];
        const base = identifyPirateBase(p)!;
        const log = traceRnd(g);
        generateStartingCharacters(g, p, base);
        const chars = getEmpireCharacters(p);
        expect(chars.map((c) => CharacterRole[c.role])).toEqual(['PirateLeader', 'IntelligenceAgent']);
        expect(p.leader).toBe(chars[0]);
        expect(chars.every((c) => c.location === base)).toBe(true);
        expect(chars[0].bonusesKnown).toBe(true);
        expect(stellarObjectCharacters(base)).toEqual(chars);
        // BuiltObject.ReviewCaptainBonuses ran on the base.
        expect(captainBonuses(base)).not.toBeNull();
        expect(log.length).toBeGreaterThan(12);
    }, 120000);
});
