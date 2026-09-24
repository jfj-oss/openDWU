import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape, HabitatCategoryType, HabitatType, IndustryType } from '../src/sim/types';
import type { Galaxy } from '../src/sim/galaxy';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import { getMostTerrestrialResourcePrevalance } from '../src/sim/startHabitats';
import { clearRuinBonusesForAge, findPlanetMoonBeyondRangeOrFurthestNoRuins, Ruin, RuinType } from '../src/sim/ruins';

// Start.2.cs 1156-1304 (start habitats + unlock-tech ruins) and 1536-1565
// (SelectRuins pass, Age>0 clearing), as createGame runs them.
let gameData: GameData;
beforeAll(async () => { gameData = await loadGameDataFs(); }, 60000);

function opts(techLevel: number): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
    };
}

// Counts Galaxy.Rnd draws (Next + NextDouble) from now on.
function drawCounter(galaxy: Galaxy): () => number {
    const rnd = galaxy.rnd;
    const next = rnd.next.bind(rnd) as (...x: number[]) => number;
    const nextDouble = rnd.nextDouble.bind(rnd);
    let n = 0;
    rnd.next = ((...a: number[]) => { n++; return next(...a); }) as typeof rnd.next;
    rnd.nextDouble = () => { n++; return nextDouble(); };
    return () => n;
}

// createGame's own Start.2.cs 1156-1304 (per empire) and 1534-1565 steps, with the draws of each
// counted at the phase boundaries (test-only __phaseHook); stopped right after the ruins.
function run(techLevel: number) {
    const perEmpire: { gas: number; preWarp: number; unlock: number }[] = [];
    let count: () => number = () => 0;
    let mark = 0;
    let cur = { gas: 0, preWarp: 0, unlock: 0 };
    let habitatsBefore = 0;
    let ruins = 0;
    let clear = 0;
    const since = () => {
        const n = count() - mark;
        mark = count();
        return n;
    };
    const galaxy = createGame({
        ...opts(techLevel),
        __phaseHook: (phase, g) => {
            switch (phase) {
                case 'firstGalaxyTick':
                    count = drawCounter(g);
                    habitatsBefore = g.habitats.length;
                    break;
                case 'empire:baseFacilities':
                    since();
                    break;
                case 'empire:gasGiantBonus':
                    cur = { gas: since(), preWarp: 0, unlock: 0 };
                    break;
                case 'empire:preWarpResources':
                    cur.preWarp = since();
                    break;
                case 'empire:unlockTechRuin':
                    cur.unlock = since();
                    perEmpire.push(cur);
                    break;
                case 'nearPlayerPirate':
                    since();
                    break;
                case 'startRuins':
                    ruins = since();
                    break;
                case 'ruins':
                    clear = since();
                    return 'stop';
            }
            return undefined;
        },
    }).galaxy;
    const withRuins = galaxy.habitats.filter((h) => h.ruin !== null);
    return {
        galaxy,
        perEmpire,
        ruins,
        clear,
        added: galaxy.habitats.length - habitatsBefore,
        ruinCount: galaxy.ruinCount,
        ruinNames: withRuins.map((h) => `${h.name}:${h.ruin!.name}:${RuinType[h.ruin!.type]}`),
        researchBonus: galaxy.habitats.filter((h) => h.researchBonus > 0).length,
    };
}

describe('Ruin', () => {
    it('ctor defaults and ClearBonuses (Ruin.cs)', () => {
        const r = new Ruin('X', 3, 0.2, 1, 2, 100, 7, 5000);
        expect(r.type).toBe(RuinType.Standard);
        expect(r.storyClueLevel).toBe(-1);
        expect(r.gameEventId).toBe(-32768);
        r.clearBonuses();
        expect([r.moneyBonus, r.mapSystemReveal, r.researchBonus, r.researchProjectId, r.specialGovernmentId]).toEqual([0, 0, 0, -1, -1]);
        const u = new Ruin('Y', 0, 0.1, 0, 0, 0, 0, 0);
        u.type = RuinType.UnlockResearchProject;
        u.researchProjectId = 42;
        u.clearBonuses();
        expect(u.researchProjectId).toBe(42);
    });
});

describe('start habitats + ruins (Start.2.cs 1156-1304, 1536-1565)', () => {
    it('tech level 0: gas giant bonus, pre-warp resources, unlock-tech ruin per empire; deterministic', () => {
        const a = run(0);
        const g = a.galaxy;
        // Every empire got an UnlockResearchProject ruin in its home system.
        for (const e of g.empires) {
            const home = g.systemHabitatsOf(e.capital!.systemIndex);
            const unlock = home.filter((h) => h.ruin !== null && h.ruin.type === RuinType.UnlockResearchProject);
            expect(unlock.length).toBe(1);
            expect([HabitatCategoryType.Planet, HabitatCategoryType.Moon]).toContain(unlock[0].category);
            const node = g.researchStatic!.definitions.find((d) => d.specialFunctionCode === 2)!;
            expect(unlock[0].ruin!.researchProjectId).toBe(node.projectId);
            const dev = unlock[0].ruin!.developmentBonus;
            expect(dev).toBeGreaterThanOrEqual(0.1);
            expect(dev).toBeLessThan(0.3);
        }
        // Important pre-warp resources now exist in every capital system.
        const important = g.resourceSystem.strategicResourcesOrderedByRelativeImportance.filter((r) => r.isImportantPreWarpResource);
        expect(important.length).toBeGreaterThan(0);
        for (const e of g.empires) {
            const star = g.determineHabitatSystemStar(e.capital!);
            for (const r of important) {
                const p = getMostTerrestrialResourcePrevalance(g, r)!;
                if (p.habitatIsGasCloud) continue;
                const ids = g.systemHabitatsOf(star.systemIndex).flatMap((h) => h.resources.filter((x) => x.resourceId === r.resourceId));
                expect(ids.length).toBeGreaterThan(0);
            }
        }
        // Research-bonus gas giants flagged on their systems.
        const flagged = g.systems.filter((s) => s.hasResearchBonus === true);
        expect(flagged.length).toBeGreaterThan(0);
        // Galaxy.1.cs 887-915: a system is flagged when its star or any non-asteroid habitat has a research bonus.
        for (const s of flagged) {
            const withBonus = [s.systemStar, ...g.systemHabitatsOf(s.systemStar.systemIndex)].filter((h) => h.researchBonus > 0);
            expect(withBonus.length).toBeGreaterThan(0);
        }
        // Every start research-bonus gas giant (research bonus 10-30 with an industry) sits in a flagged system.
        for (const h of g.habitats.filter((x) => x.type === HabitatType.GasGiant && x.researchBonusIndustry !== IndustryType.Undefined && x.researchBonus >= 10)) {
            expect(g.systems[h.systemIndex].hasResearchBonus).toBe(true);
        }
        // Ruins pass placed some standard / negative ruins on Continental/Swamp/Desert habitats.
        const std = g.habitats.filter((h) => h.ruin !== null && h.ruin.type !== RuinType.UnlockResearchProject);
        expect(std.length).toBeGreaterThan(0);
        for (const h of std) expect([HabitatType.Continental, HabitatType.MarshySwamp, HabitatType.Desert]).toContain(h.type);
        expect(a.ruinCount).toBe(std.length + g.empires.length);
        expect(a.clear).toBe(0);
        // Rnd draws per block, per empire (logged for the port notes).
        console.log('techLevel 0 draws', JSON.stringify(a.perEmpire), 'ruins pass', a.ruins, 'habitats added', a.added, 'ruins', a.ruinCount);
        const b = run(0);
        expect(b.perEmpire).toEqual(a.perEmpire);
        expect(b.ruinNames).toEqual(a.ruinNames);
        expect(b.ruins).toBe(a.ruins);
    }, 120000);

    it('tech level 0.5: only the gas giant block draws; no unlock ruins; deterministic', () => {
        const a = run(0.5);
        for (const p of a.perEmpire) {
            expect(p.preWarp).toBe(0);
            expect(p.unlock).toBe(0);
            expect([0, 1, 2]).toContain(p.gas);
        }
        expect(a.added).toBe(0);
        expect(a.galaxy.habitats.some((h) => h.ruin?.type === RuinType.UnlockResearchProject)).toBe(false);
        console.log('techLevel 0.5 draws', JSON.stringify(a.perEmpire), 'ruins pass', a.ruins, 'ruins', a.ruinCount);
        const b = run(0.5);
        expect(b.ruinNames).toEqual(a.ruinNames);
        expect(b.perEmpire).toEqual(a.perEmpire);
    }, 120000);

    it('Age > 0 clears bonuses of ruins in empire-dominated systems', () => {
        const a = run(0);
        const g = a.galaxy;
        const dominated = g.habitats.find((h) => h.ruin === null && [HabitatType.Continental, HabitatType.Desert].includes(h.type) && g.systems[h.systemIndex].dominantEmpire?.empire === g.playerEmpire);
        if (dominated === undefined) return;
        dominated.ruin = new Ruin('T', 0, 0.2, 0, 0, 1000, 0, 0);
        g.age = 1;
        clearRuinBonusesForAge(g);
        expect(dominated.ruin.researchBonus).toBe(0);
        expect(dominated.ruin.playerEmpireEncountered).toBe(true);
    }, 120000);

    it('FindPlanetMoonBeyondRangeOrFurthestNoRuins returns the furthest qualifying planet/moon', () => {
        const g = run(0.5).galaxy;
        const cap = g.empires[0].capital!;
        const hs = g.systemHabitatsOf(cap.systemIndex);
        const r = findPlanetMoonBeyondRangeOrFurthestNoRuins(g, cap, hs, 1e12);
        if (r.habitat !== null) {
            expect(r.distance).toBeCloseTo(g.calculateDistance(cap.xpos, cap.ypos, r.habitat.xpos, r.habitat.ypos), 6);
        }
        const near = findPlanetMoonBeyondRangeOrFurthestNoRuins(g, cap, hs, 0);
        if (r.habitat !== null) expect(near.habitat).not.toBeNull();
    }, 120000);
});
