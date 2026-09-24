import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { setGovernmentsStatic, type Empire } from '../src/sim/empire';
import { GalaxyShape } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import {
    calculateMaxTechPoints,
    createNewDesigns,
    findNewestCanBuildFullEvaluate,
    findNewestPlanetDestroyer,
    getHighestTechByType,
    researchComponentMaxTechPoints,
    researchComponentTechPoints,
    SHIP_IMAGE_PLANET_DESTROYER,
} from '../src/sim/designGeneration';
import { startStarDateForAge } from '../src/sim/galaxyTime';
import { BuiltObjectStance, type Design } from '../src/sim/design';
import { ComponentType } from '../src/sim/data/components';
import {
    BattleTactics,
    BuiltObjectFleeWhen,
    BuiltObjectRole,
    DesignSpecificationComponentRuleType,
    InvasionTactics,
    buildDefaultDesignSpecifications,
    getDefaultDesignSpecificationBySubRole,
    newComponentRuleByType,
} from '../src/sim/data/designSpecifications';

// Task M3f — BaconEmpire.cs CreateNewDesigns planet-destroyer tail (1039-1091):
// GenerateDesignFromSpec(PlanetDestroyerDesignSpecification) / Galaxy.GeneratePlanetDestroyerDesign
// (Galaxy.7.cs 4862, GetPlanetDestroyerComponents Galaxy.8.cs 2362), replace-if-better; and
// Design.CalculateTechLevel (Design.cs 959) with ResearchSystem.ComponentMaxTechPoints
// (ResearchSystem.cs 1290).
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function opts(techLevel: number): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
        piratePrevalence: 0,
    };
}

// research.txt: 272 "Super Beam Weapons" (Death Ray, Value1 1800), 273 "Advanced Super Weapons"
// (Super Laser, WeaponSuperBeam Value1 30000 → ComponentImprovement.IsPlanetDestroyer).
const SUPER_LASER = 25;
function researchSuperWeapons(e: Empire): void {
    for (const n of e.research.techTree) if (n.def.projectId === 272 || n.def.projectId === 273) n.isResearched = true;
    e.research.update();
}

function setup(techLevel = 8): { g: Galaxy; e: Empire; sd: number } {
    const g = createGame(opts(techLevel)).galaxy;
    const e = g.playerEmpire!;
    return { g, e, sd: startStarDateForAge(g.age) };
}

const worldDestroyers = (e: Empire) => (e.designs as Design[]).filter((d) => d.name === 'World Destroyer');

describe('planet destroyer designs (CreateNewDesigns tail)', () => {
    it('policy.BuildPlanetDestroyers + a planet-destroyer super weapon → "World Destroyer" (GeneratePlanetDestroyerDesign path)', () => {
        const { g, e, sd } = setup();
        expect(worldDestroyers(e).length).toBe(0);
        expect(e.planetDestroyerDesignSpecification).toBeNull(); // no PlanetDestroyer template ships for Human
        researchSuperWeapons(e);
        e.policy!.buildPlanetDestroyers = true;
        createNewDesigns(g, e, sd, sd, true);
        const wd = worldDestroyers(e);
        expect(wd.length).toBe(1);
        const d = wd[0];
        expect(d.role).toBe(BuiltObjectRole.Military);
        expect(d.subRole).toBe(BuiltObjectSubRole.CapitalShip);
        expect(d.pictureRef).toBe(SHIP_IMAGE_PLANET_DESTROYER);
        expect(d.pictureRef).toBe(0);
        expect(d.empire).toBe(e);
        expect(d.dateCreated).toBe(sd);
        expect(d.stance).toBe(BuiltObjectStance.AttackEnemies);
        expect(d.fleeWhen).toBe(BuiltObjectFleeWhen.Shields20);
        expect(d.tacticsStrongerShips).toBe(BattleTactics.Standoff);
        expect(d.tacticsWeakerShips).toBe(BattleTactics.AllWeapons);
        expect(d.tacticsInvasion).toBe(InvasionTactics.DoNotInvade);
        expect(d.isPlanetDestroyer).toBe(true);
        // GetHighestTechByType(WeaponSuperBeam) = the Super Laser; 30 armor, 60 fuel, 60 cargo.
        const defs = g.researchStatic!.componentStatic!.definitions;
        expect(getHighestTechByType(ComponentType.WeaponSuperBeam, defs)!.componentId).toBe(SUPER_LASER);
        expect(d.components.filter((c) => c.componentId === SUPER_LASER).length).toBe(1);
        expect(d.components.filter((c) => c.type === ComponentType.Armor).length).toBe(30);
        expect(d.components.filter((c) => c.type === ComponentType.StorageFuel).length).toBe(60);
        expect(d.components.filter((c) => c.type === ComponentType.StorageCargo).length).toBe(60);
        expect(findNewestPlanetDestroyer(e.designs as Design[])).toBe(d);
        // The tail only adds to Designs (never LatestDesigns).
        expect(e.latestDesigns[BuiltObjectSubRole.CapitalShip]).not.toBe(d);

        // A second pass generates an equivalent design → not added again.
        createNewDesigns(g, e, sd, sd, true);
        expect(worldDestroyers(e).length).toBe(1);
        expect(worldDestroyers(e)[0]).toBe(d);
    }, 60000);

    it('no World Destroyer without the policy or without a planet-destroyer weapon (and no throw)', () => {
        const a = setup();
        researchSuperWeapons(a.e);
        a.e.policy!.buildPlanetDestroyers = false;
        createNewDesigns(a.g, a.e, a.sd, a.sd, true);
        expect(worldDestroyers(a.e).length).toBe(0);

        const b = setup();
        b.e.policy!.buildPlanetDestroyers = true; // no Super Laser researched
        createNewDesigns(b.g, b.e, b.sd, b.sd, true);
        expect(worldDestroyers(b.e).length).toBe(0);
    }, 60000);

    it('PlanetDestroyerDesignSpecification path: GenerateDesignFromSpec(spec, 0.0), renamed "World Destroyer"', () => {
        const { g, e, sd } = setup();
        researchSuperWeapons(e);
        e.policy!.buildPlanetDestroyers = true;
        const cap = getDefaultDesignSpecificationBySubRole(buildDefaultDesignSpecifications(), BuiltObjectSubRole.CapitalShip)!;
        e.planetDestroyerDesignSpecification = {
            ...cap,
            componentRules: [...cap.componentRules, newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, ComponentType.WeaponSuperBeam, 1)],
        };
        createNewDesigns(g, e, sd, sd, true);
        const wd = worldDestroyers(e);
        expect(wd.length).toBe(1);
        const d = wd[0];
        expect(d.pictureRef).toBe(0);
        expect(d.empire).toBe(e);
        expect(d.subRole).toBe(BuiltObjectSubRole.CapitalShip);
        expect(d.tacticsStrongerShips).toBe(BattleTactics.Standoff);
        expect(d.fleeWhen).toBe(BuiltObjectFleeWhen.Shields20);
        expect(d.tacticsInvasion).toBe(InvasionTactics.DoNotInvade);
        expect(d.components.some((c) => c.type === ComponentType.WeaponSuperBeam)).toBe(true);
    }, 60000);
});

describe('Design.CalculateTechLevel / ResearchSystem.ComponentMaxTechPoints', () => {
    it('max/min tech points follow the 2^(level-1) × BaseTechCost sums (special projects → max level + 1)', () => {
        const { g } = setup(1);
        const tp = researchComponentTechPoints(g);
        const defs = g.researchStatic!.componentStatic!.definitions;
        expect(tp.max.length).toBe(defs.length);
        expect(tp.min.length).toBe(defs.length);
        const nodes = g.researchStatic!.definitions;
        const maxLevel = Math.max(...nodes.filter((n) => n.techLevel < 100).map((n) => n.techLevel));
        const sum = (lvl: number) => { let s = 0; for (let i = lvl; i > 0; i--) s += Math.pow(2, i - 1) * 120000; return s; };
        // Super Laser (only project 273, level 101 >= 100 → maxLevel + 1).
        const allowed = g.researchStatic!.allowedRaces.get(273)?.size ?? 0;
        expect(tp.max[SUPER_LASER]).toBe(Math.trunc(sum(maxLevel + 1) + (allowed > 0 ? 1 : 0)));
        expect(calculateMaxTechPoints(SUPER_LASER, 120000, nodes, g.researchStatic!.allowedRaces)).toBe(tp.max[SUPER_LASER]);
        const sum0 = (lvl: number) => { let s = 0; for (let i = lvl; i > 0; i--) s += Math.pow(2, i - 1) * 120000; return s; };
        for (let id = 0; id < defs.length; id++) {
            const referenced = nodes.some((n) => n.components.includes(id) || n.componentImprovements.some((ci) => ci.componentId === id));
            if (referenced) {
                expect(tp.min[id]).toBeLessThanOrEqual(tp.max[id]);
            } else {
                // C# quirk kept: an unreferenced component has max 0 (num1 = 0) but min = sum to
                // maxLevel + 1 (num1 stays 100 → val1 + 1).
                expect(tp.max[id]).toBe(0);
                expect(tp.min[id]).toBe(Math.trunc(sum0(maxLevel + 1)));
            }
        }
    }, 60000);

    it('CalculateTechLevel = Σ maxTechPoints × size / Size; higher tech designs score higher', () => {
        const lo = setup(1);
        const hi = setup(8);
        const maxLo = researchComponentMaxTechPoints(lo.g);
        const capLo = (lo.e.designs as Design[]).find((d) => d.subRole === BuiltObjectSubRole.CapitalShip)!;
        const capHi = (hi.e.designs as Design[]).find((d) => d.subRole === BuiltObjectSubRole.CapitalShip)!;
        let s = 0;
        for (const c of capLo.components) s += maxLo[c.componentId] * c.size;
        expect(capLo.calculateTechLevel(lo.e, maxLo)).toBe(s / capLo.size);
        const tLo = capLo.calculateTechLevel(lo.e, maxLo);
        const tHi = capHi.calculateTechLevel(hi.e, researchComponentMaxTechPoints(hi.g));
        expect(tLo).toBeGreaterThan(120000);
        expect(tHi).toBeGreaterThan(tLo);
        expect(capLo.calculateTechLevel(null, maxLo)).toBe(1.0);
    }, 60000);

    it('FindNewestCanBuildFullEvaluate: optimized designs no longer throw; newest wins unless the optimized one is within 1.5×', () => {
        const { e } = setup(8);
        const designs = e.designs as Design[];
        const esc = designs.find((d) => d.subRole === BuiltObjectSubRole.Escort && !d.isObsolete)!;
        expect(findNewestCanBuildFullEvaluate(designs, BuiltObjectSubRole.Escort, null)).toBe(esc);
        const opt = Object.assign(Object.create(Object.getPrototypeOf(esc)), esc) as Design;
        opt.components = [...esc.components];
        opt.optimizedDesign = 1;
        opt.dateCreated = 0;
        const list = [...designs, opt];
        // Same components → same tech level → num3 / num2 = 1 < 1.5 → the optimized design.
        expect(findNewestCanBuildFullEvaluate(list, BuiltObjectSubRole.Escort, null)).toBe(opt);
    }, 60000);
});
