import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { generateGalaxy } from '../src/sim/galaxy';
import { Empire, setGovernmentsStatic } from '../src/sim/empire';
import { GalaxyShape } from '../src/sim/types';
import { ComponentType } from '../src/sim/data/components';
import { buildResearchStatic, loadEmpirePolicy } from '../src/sim/researchSystem';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Race } from '../src/sim/data/races';
import {
    PiratePlayStyle,
    pirateFactionModifiers,
    raceDefaultPiratePlaystyle,
    setEmpireDifficultyFactors,
    generatePirateEmpireName,
} from '../src/sim/pirates';

// Task C2d — pirate factions at game start.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function opts(): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0.5 },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
        piratePrevalence: 1.0,
    };
}

describe('pirateFactionModifiers', () => {
    it('Balanced: all factors 1.0', () => {
        const m = pirateFactionModifiers(PiratePlayStyle.Balanced);
        for (const v of Object.values(m)) expect(v).toBe(1.0);
    });
    it('Pirate: raidBonusFactor 1.4, planetaryFacilityBuildFactor 1.5', () => {
        const m = pirateFactionModifiers(PiratePlayStyle.Pirate);
        expect(m.raidBonusFactor).toBe(1.4);
        expect(m.planetaryFacilityBuildFactor).toBe(1.5);
    });
    it('Smuggler: smugglingIncomeFactor 1.5, planetaryFacilityEliminationFactor 1.7', () => {
        const m = pirateFactionModifiers(PiratePlayStyle.Smuggler);
        expect(m.smugglingIncomeFactor).toBe(1.5);
        expect(m.planetaryFacilityEliminationFactor).toBe(1.7);
    });
    it('Undefined: all factors 1.0', () => {
        const m = pirateFactionModifiers(PiratePlayStyle.Undefined);
        for (const v of Object.values(m)) expect(v).toBe(1.0);
    });
});

describe('raceDefaultPiratePlaystyle', () => {
    const humanRace = () => gameData.races.find((r) => r.name === 'Human')!;
    function withExtra(extra: Record<string, string> | undefined): Race {
        const base = humanRace();
        return { ...base, extra } as Race;
    }
    it("file value '0' -> Balanced", () => {
        expect(raceDefaultPiratePlaystyle(withExtra({ PirateDefaultPlaystyle: '0' }))).toBe(PiratePlayStyle.Balanced);
    });
    it("file value '3' -> Smuggler", () => {
        expect(raceDefaultPiratePlaystyle(withExtra({ PirateDefaultPlaystyle: '3' }))).toBe(PiratePlayStyle.Smuggler);
    });
    it("file value '9' (out of range) -> Undefined", () => {
        expect(raceDefaultPiratePlaystyle(withExtra({ PirateDefaultPlaystyle: '9' }))).toBe(PiratePlayStyle.Undefined);
    });
    it('missing extra/value -> Undefined', () => {
        expect(raceDefaultPiratePlaystyle(withExtra(undefined))).toBe(PiratePlayStyle.Undefined);
        expect(raceDefaultPiratePlaystyle(withExtra({}))).toBe(PiratePlayStyle.Undefined);
    });
});

describe('setEmpireDifficultyFactors', () => {
    function makeGalaxyAndEmpire() {
        const g = generateGalaxy({ seed: 5, shape: GalaxyShape.Spiral, starCount: 50, sectorWidth: 4, sectorHeight: 4, systemNames: Array.from({ length: 50 }, (_, i) => `S${i}`), gameData });
        const habitat = g.habitats[0];
        const race = gameData.races.find((r) => r.name === 'Human')!;
        const stat = buildResearchStatic(gameData.research, gameData.components, gameData.races, gameData.policies, gameData.piratePolicies);
        const policy = loadEmpirePolicy(stat, race, false);
        // Use the Empire class directly via a pirate-style ctor (not player empire).
        const empire = new Empire(g, 'Test', false, habitat, race, policy);
        return { g, empire };
    }
    it('non-player empire, galaxy difficulty 1.0, modifier 0 -> difficultyLevel 1.0', () => {
        const { g, empire } = makeGalaxyAndEmpire();
        empire.difficultyLevelModifier = 0;
        setEmpireDifficultyFactors(g, empire, 1.0);
        expect(empire.difficultyLevel).toBeCloseTo(1.0, 10);
    });
    it('non-player empire, galaxy difficulty 1.0, modifier 0.5 -> difficultyLevel 1.5, researchRate = 1/1.5', () => {
        const { g, empire } = makeGalaxyAndEmpire();
        empire.difficultyLevelModifier = 0.5;
        setEmpireDifficultyFactors(g, empire, 1.0);
        expect(empire.difficultyLevel).toBeCloseTo(1.5, 10);
        expect(empire.difficultyFactors!.researchRate).toBeCloseTo(1 / 1.5, 10);
    });
});

describe('createGame with piratePrevalence', () => {
    it('generates at least one well-formed pirate empire', () => {
        const game = createGame(opts());
        const g = game.galaxy;
        const normalIds = g.empires.map((e) => e.empireId);
        expect(g.pirateEmpires.length).toBeGreaterThan(0);

        const ids = g.pirateEmpires.map((e) => e.empireId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) for (const nid of normalIds) expect(id).toBeGreaterThan(nid);

        const fuelResourceId = g.resourceSystem.fuelResources[0].resourceId;
        for (const pirate of g.pirateEmpires) {
            const base = pirate.pirateEmpireBaseHabitat;
            expect(base).not.toBeNull();
            expect(base!.resources.some((r: any) => r.resourceId === fuelResourceId)).toBe(true);
            expect(pirate.name.length).toBeGreaterThan(0);
            expect(pirate.dominantRace).not.toBeNull();
            expect(pirate.dominantRace!.canBePirate).toBe(true);
            expect(pirate.piratePlayStyle).toBeGreaterThanOrEqual(PiratePlayStyle.Balanced);
            expect(pirate.piratePlayStyle).toBeLessThanOrEqual(PiratePlayStyle.Smuggler);
            expect(pirate.stateMoney).toBe(20000);
            expect(pirate.pirateFactionModifiers).not.toBeNull();
        }
    });

    it('no pirate base is in the same system as a populated independent colony', () => {
        const game = createGame(opts());
        const g = game.galaxy;
        for (const pirate of g.pirateEmpires) {
            const base = pirate.pirateEmpireBaseHabitat!;
            const sameSystemIndependent = g.habitats.some(
                (h) => h.systemIndex === base.systemIndex && h.empire === g.independentEmpire && h.population.totalAmount > 0,
            );
            expect(sameSystemIndependent).toBe(false);
        }
    });

    it('pirates start with researched tech but no colonisation module', () => {
        const game = createGame(opts());
        const g = game.galaxy;
        expect(g.pirateEmpires.length).toBeGreaterThan(0);
        for (const pirate of g.pirateEmpires) {
            const researched = pirate.research.techTree.filter((n: any) => n.isResearched);
            expect(researched.length).toBeGreaterThan(10);
            expect(pirate.research.researchedComponents.some((c: any) => c.type === ComponentType.HabitationColonization)).toBe(false);
        }
    });

    it('pirate colours differ pairwise', () => {
        const game = createGame(opts());
        const g = game.galaxy;
        for (let i = 0; i < g.pirateEmpires.length; i++) {
            for (let j = i + 1; j < g.pirateEmpires.length; j++) {
                const a = g.pirateEmpires[i];
                const b = g.pirateEmpires[j];
                expect(a.mainColor === b.mainColor && a.secondaryColor === b.secondaryColor).toBe(false);
            }
        }
    });

    it('is deterministic across runs', () => {
        function fingerprint() {
            const g = createGame(opts()).galaxy;
            return g.pirateEmpires.map((e) => [e.name, e.pirateEmpireBaseHabitat!.name, e.dominantRace!.name, e.mainColor]);
        }
        const a = fingerprint();
        const b = fingerprint();
        expect(b).toEqual(a);
        // Pinned for seed 1 (TS port; C# parity ends at the first Empire.DoTasks).
        expect(a).toEqual(PINNED_SEED1_PIRATES);
    });

    it('piratePrevalence unset -> zero pirate empires', () => {
        const o = opts();
        delete o.piratePrevalence;
        const game = createGame(o);
        expect(game.galaxy.pirateEmpires.length).toBe(0);
    });
});

describe('generatePirateEmpireName', () => {
    it('returns 2 or 3 words, or "<system name> <group>", and draws exactly 4 Rnd values', () => {
        const mkGalaxy = () => generateGalaxy({ seed: 7, shape: GalaxyShape.Spiral, starCount: 60, sectorWidth: 4, sectorHeight: 4, systemNames: Array.from({ length: 60 }, (_, i) => `S${i}`), gameData });
        const g1 = mkGalaxy();
        const g2 = mkGalaxy();
        const habitat = g1.habitats[0];
        const name = generatePirateEmpireName(g1, habitat, PiratePlayStyle.Pirate);
        const words = name.split(' ');
        expect(words.length === 2 || words.length === 3).toBe(true);

        // g2: consume exactly 4 Rnd draws the same way, then compare next draw.
        g2.rnd.next(0, 1e9);
        g2.rnd.next(0, 1e9);
        g2.rnd.next(0, 1e9);
        g2.rnd.next(0, 1e9);
        const expected = g2.rnd.next(0, 1e9);
        const actual = g1.rnd.next(0, 1e9);
        expect(actual).toBe(expected);
    });
});

// Pinned for seed 1 (TS port; C# parity ends at the first Empire.DoTasks).
// (re-pinned: design generation + colonizable-habitat search)
// (re-pinned M3e: each faction now gets its SmallSpacePort base, fleet and mining stations —
// Galaxy.8.cs 4623-4820 — which draws Rnd (base name, headings, ship names, AddBuiltObjectToGalaxy
// offsets, station surface points), and FindNearestPirateFaction now finds factions, so the
// 1,000,000 spacing rule of GenerateNewPirateEmpires applies. The first faction is unchanged.)
const PINNED_SEED1_PIRATES: unknown[] = [
    ['Lone Dagger Authority', 'S182 3', 'Ackdarian', 32639],
    ['Fearsome Fang Gang', 'S153 8', 'Dhayut', 8323096],
    ['Burning Dagger Ravagers', 'S259 2', 'Atuuk', 796684],
    ['Dhayu Spaceways', 'S95 2', 'Haakonish', 7364656],
    ['S22 Clan', 'S24 6', 'Kiadian', 88],
    ['Red Confederation', 'S214 4', 'Kiadian', 5570576],
    ['Lone Fang Spaceways', 'S252 4', 'Haakonish', 5453],
];
