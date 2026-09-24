import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/sim/galaxy';
import { setGovernmentsStatic } from '../src/sim/empire';
import { generateEmpire } from '../src/sim/empireGeneration';
import { ResearchSystem, buildResearchStatic, loadEmpirePolicy } from '../src/sim/researchSystem';
import { ComponentCategoryType, parseEmpirePolicy, resolveTechFocuses } from '../src/sim/data/policies';
import { ComponentType } from '../src/sim/data/components';
import { createGame } from '../src/sim/game';
import { GalaxyShape, HabitatCategoryType } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

// SetTechTreeStartingDefaults (+Pirates), EmpirePolicy tech focuses, tech level 0.5.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

const human = () => gameData.races.find((r) => r.name === 'Human')!;
function tree(pirate: boolean) {
    const stat = buildResearchStatic(gameData.research, gameData.components, gameData.races, gameData.policies, gameData.piratePolicies);
    const rs = new ResearchSystem(stat);
    rs.obtainTechTree();
    const policy = loadEmpirePolicy(stat, human(), pirate);
    if (pirate) rs.setTechTreeStartingDefaultsPirates(human(), policy);
    else rs.setTechTreeStartingDefaults(human(), policy);
    rs.update();
    return { rs, stat };
}
const typeResearched = (rs: ResearchSystem, t: ComponentType) => rs.researchedComponents.some((c) => c.type === t);

describe('empire policy', () => {
    it('parses ResearchDesignTechFocus slots via ResolveTechFocus', () => {
        const p = parseEmpirePolicy("'comment\nResearchDesignTechFocus1\t\t;9\nResearchDesignTechFocus2\t\t;6\nResearchDesignTechFocus3 ;1\nResearchDesignTechFocus4 ;junk\n");
        const f = resolveTechFocuses(p);
        expect(f.categories).toEqual([ComponentCategoryType.Fighter, ComponentCategoryType.WeaponBeam]);
        expect(f.types).toEqual([ComponentType.WeaponMissile]);
    });
    it('loads Policy/<race>.txt for every race with a file', () => {
        expect(gameData.policies!.get('Human')).toBeDefined();
        expect(gameData.piratePolicies!.size).toBeGreaterThan(0);
    });
});

describe('SetTechTreeStartingDefaults', () => {
    it('starting empire: hyperdrive, colonisation, construction, focus weapons; no high tech', () => {
        const { rs } = tree(false);
        expect(rs.hasHyperDrive()).toBe(true);
        expect(typeResearched(rs, ComponentType.HabitationColonization)).toBe(true);
        expect(typeResearched(rs, ComponentType.StorageDockingBay)).toBe(true);
        expect(typeResearched(rs, ComponentType.WeaponBeam)).toBe(true);
        // Human policy focus: Fighter (9), Missile (6), Beam (1).
        expect(typeResearched(rs, ComponentType.FighterBay)).toBe(true);
        expect(typeResearched(rs, ComponentType.WeaponMissile)).toBe(true);
        const researched = rs.techTree.filter((n) => n.isResearched);
        expect(researched.length).toBeGreaterThan(10);
        expect(researched.length).toBeLessThan(rs.techTree.length / 2);
        for (const n of rs.techTree) expect(n.selfResearched).toBe(n.isResearched);
    });
    it('pirates: no colonisation module, but assault pods and tractor beams', () => {
        const { rs } = tree(true);
        expect(typeResearched(rs, ComponentType.AssaultPod)).toBe(true);
        expect(typeResearched(rs, ComponentType.WeaponTractorBeam)).toBe(true);
        expect(typeResearched(rs, ComponentType.HabitationColonization)).toBe(false);
    });
    it('generateEmpire at tech level 0.5 ("Normal") no longer throws and is deterministic', () => {
        const run = () => {
            const g = generateGalaxy({ seed: 2, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`), gameData });
            const cap = g.habitats.find((h) => h.category === HabitatCategoryType.Planet && h.type === human().nativeHabitatType)!;
            const { empire } = generateEmpire(g, true, 'P', cap, human(), -1, 0, 1.0, 'Normal', 1, 0.5, 1.0);
            return { researched: empire.research.techTree.filter((n) => n.isResearched).map((n) => n.def.projectId), next: g.rnd.next(0, 1000000) };
        };
        const a = run();
        expect(a.researched.length).toBeGreaterThan(10);
        expect(run()).toEqual(a);
    });
    it('createGame works with tech level 0.5 for every empire', () => {
        const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 1, techLevel: 0.5 });
        const game = createGame({
            seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
            systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
            player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)')],
        });
        expect(game.galaxy.empires.length).toBe(3);
        for (const e of game.galaxy.empires) expect(e.hasHyperDriveTech).toBe(true);
    }, 60000);
});
