import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/sim/galaxy';
import { setGovernmentsStatic } from '../src/sim/empire';
import { generateEmpire } from '../src/sim/empireGeneration';
import { ResearchSystem, buildResearchStatic, loadEmpirePolicy, ShipDesignFocus } from '../src/sim/researchSystem';
import { buildComponentStatic } from '../src/sim/componentStatic';
import { Random } from '../src/sim/random';
import { createGame } from '../src/sim/game';
import { GalaxyShape, HabitatCategoryType } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import { Design } from '../src/sim/design';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { loadDesignSpecification, BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { ComponentType } from '../src/sim/data/components';
import { placeComponentsOnDesign, type DesignPlacementEmpire } from '../src/sim/designPlacement';

// Empire.10.cs PlaceComponentsOnDesign (1677-2989) and helpers.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

const human = () => gameData.races.find((r) => r.name === 'Human')!;

// maxShipSize/maxBaseSize: MaximumConstructionSize isn't ported on Empire yet (TODO in
// empire.ts), so tests pick fixed values in the game's normal early/mid-game range —
// 300 for ships and 900 for bases — matching the scale DesignSpecification component
// rule amounts and component Size values are tuned for (component sizes are
// single/low-double-digit; starting hulls run in the low hundreds).
const MAX_SHIP_SIZE = 300;
const MAX_BASE_SIZE = 900;

function makeEmpireContext(techLevel: number, shipSizeCap = MAX_SHIP_SIZE, baseSizeCap = MAX_BASE_SIZE): DesignPlacementEmpire {
    const componentStatic = buildComponentStatic(gameData);
    const stat = buildResearchStatic(
        gameData.research,
        gameData.components,
        gameData.races,
        gameData.policies,
        gameData.piratePolicies,
        componentStatic,
    );
    const research = new ResearchSystem(stat);
    research.obtainTechTree();
    const policy = loadEmpirePolicy(stat, human(), false);
    if (techLevel <= 0.5) {
        research.setTechTreeStartingDefaults(human(), policy);
    } else {
        research.setTechTreeLevel(new Random(1), human(), techLevel, false);
    }
    research.update();
    policy.researchDesignOverallFocus = ShipDesignFocus.Balanced;
    return {
        research,
        policy,
        dominantRace: { aggressionLevel: human().aggression ?? 100, intelligenceLevel: human().intelligence ?? 100 },
        componentDefinitions: componentStatic.definitions,
        hasHyperDriveTech: research.hasHyperDrive(),
        // MaximumConstructionSize(Base) isn't ported on Empire yet; stub with the same fixed
        // ship/base sizes the tests pass explicitly (see MAX_SHIP_SIZE/MAX_BASE_SIZE below).
        maximumConstructionSize: () => shipSizeCap,
        maximumConstructionSizeBase: () => baseSizeCap,
        isPirate: false,
        rnd: new Random(7),
    };
}

function makeDesign(subRole: BuiltObjectSubRole, role: BuiltObjectRole): Design {
    const d = new Design(`test-${BuiltObjectSubRole[subRole]}`);
    d.subRole = subRole;
    d.role = role;
    return d;
}

function loadSpec(subRoleName: string, subRole: BuiltObjectSubRole, mobile: boolean) {
    const spec = loadDesignSpecification(gameData.designSpecificationTexts ?? new Map(), subRoleName, subRole, mobile, 'Human', false);
    expect(spec).not.toBeNull();
    return spec!;
}

describe('placeComponentsOnDesign', () => {
    it('places a full escort design (tech 0.5): command center, reactor, hyperdrive, researched', () => {
        const ctx = makeEmpireContext(0.5);
        const spec = loadSpec('Escort', BuiltObjectSubRole.Escort, true);
        const design = makeDesign(BuiltObjectSubRole.Escort, spec.role);
        const result = placeComponentsOnDesign(ctx, design, spec, null, MAX_SHIP_SIZE, MAX_BASE_SIZE, null, 0.0);

        expect(result).not.toBeNull();
        const types = result!.components.map((c) => c.type);
        expect(types).toContain(ComponentType.ComputerCommandCenter);
        expect(types).toContain(ComponentType.Reactor);
        expect(types).toContain(ComponentType.HyperDrive);
        for (const c of result!.components) {
            expect(ctx.research.checkComponentResearched(c)).toBe(true);
        }
        expect(result!.quickCalculateSize()).toBeLessThanOrEqual(MAX_SHIP_SIZE);
    });

    it('places a colony ship: command center, reactor, hyperdrive, colonization module', () => {
        const ctx = makeEmpireContext(0.5);
        const spec = loadSpec('ColonyShip', BuiltObjectSubRole.ColonyShip, true);
        const design = makeDesign(BuiltObjectSubRole.ColonyShip, spec.role);
        const result = placeComponentsOnDesign(ctx, design, spec, null, MAX_SHIP_SIZE, MAX_BASE_SIZE, null, 0.0);

        expect(result).not.toBeNull();
        const types = result!.components.map((c) => c.type);
        expect(types).toContain(ComponentType.ComputerCommandCenter);
        expect(types).toContain(ComponentType.Reactor);
        expect(types).toContain(ComponentType.HyperDrive);
        expect(types).toContain(ComponentType.HabitationColonization);
        for (const c of result!.components) {
            expect(ctx.research.checkComponentResearched(c)).toBe(true);
        }
    });

    it('places a small space port (base, no hyperdrive required): command center, reactor, docking bay', () => {
        const ctx = makeEmpireContext(0.5);
        const spec = loadSpec('SmallSpacePort', BuiltObjectSubRole.SmallSpacePort, false);
        const design = makeDesign(BuiltObjectSubRole.SmallSpacePort, spec.role);
        const result = placeComponentsOnDesign(ctx, design, spec, null, MAX_SHIP_SIZE, MAX_BASE_SIZE, null, 0.0);

        expect(result).not.toBeNull();
        const types = result!.components.map((c) => c.type);
        expect(types).toContain(ComponentType.ComputerCommandCenter);
        expect(types).toContain(ComponentType.Reactor);
        expect(types).toContain(ComponentType.StorageDockingBay);
        for (const c of result!.components) {
            expect(ctx.research.checkComponentResearched(c)).toBe(true);
        }
        expect(result!.quickCalculateSize()).toBeLessThanOrEqual(MAX_BASE_SIZE);
    });

    it('is deterministic across repeated runs at the same tech level', () => {
        const ctx1 = makeEmpireContext(3);
        const ctx2 = makeEmpireContext(3);
        const spec1 = loadSpec('Escort', BuiltObjectSubRole.Escort, true);
        const spec2 = loadSpec('Escort', BuiltObjectSubRole.Escort, true);
        const d1 = placeComponentsOnDesign(ctx1, makeDesign(BuiltObjectSubRole.Escort, spec1.role), spec1, null, MAX_SHIP_SIZE, MAX_BASE_SIZE, null, 0.0);
        const d2 = placeComponentsOnDesign(ctx2, makeDesign(BuiltObjectSubRole.Escort, spec2.role), spec2, null, MAX_SHIP_SIZE, MAX_BASE_SIZE, null, 0.0);
        expect(d1).not.toBeNull();
        expect(d2).not.toBeNull();
        expect(d1!.components.map((c) => c.componentId)).toEqual(d2!.components.map((c) => c.componentId));
    });

    it('trims an over-budget destroyer design down toward a small maxShipSize while keeping essentials', () => {
        // Empire.10.cs ~2362-2915: the over-budget trim pass. At tech 3 an untrimmed Destroyer
        // design (Human, Balanced focus) comes out around size 273; a cap of 250 sits above the
        // pass's own feasibility floor (~231 here — Empire.10.cs 2677-2680 skips trimming
        // altogether when even removing every candidate wouldn't fit, which is itself faithfully
        // ported, so a cap picked below that floor would legitimately stay over budget) and lets
        // the cascade actually remove components down to 248.
        const smallCap = 250;
        const ctx = makeEmpireContext(3, smallCap, MAX_BASE_SIZE);
        const spec = loadSpec('Destroyer', BuiltObjectSubRole.Destroyer, true);
        const design = makeDesign(BuiltObjectSubRole.Destroyer, spec.role);
        const undoCap = makeEmpireContext(3, 10000, MAX_BASE_SIZE);
        const untrimmedSpec = loadSpec('Destroyer', BuiltObjectSubRole.Destroyer, true);
        const untrimmed = placeComponentsOnDesign(
            undoCap,
            makeDesign(BuiltObjectSubRole.Destroyer, untrimmedSpec.role),
            untrimmedSpec,
            null,
            10000,
            MAX_BASE_SIZE,
            null,
            0.0,
        );
        const result = placeComponentsOnDesign(ctx, design, spec, null, smallCap, MAX_BASE_SIZE, null, 0.0);

        expect(result).not.toBeNull();
        expect(untrimmed).not.toBeNull();
        expect(result!.quickCalculateSize()).toBeLessThan(untrimmed!.quickCalculateSize());
        const types = result!.components.map((c) => c.type);
        expect(types).toContain(ComponentType.ComputerCommandCenter);
        expect(types).toContain(ComponentType.Reactor);
        expect(types).toContain(ComponentType.HyperDrive);
        expect(result!.quickCalculateSize()).toBeLessThanOrEqual(smallCap);
        for (const c of result!.components) {
            expect(ctx.research.checkComponentResearched(c)).toBe(true);
        }
    });

    it('places a design at a higher tech level with more advanced researched components', () => {
        const ctx = makeEmpireContext(3);
        const spec = loadSpec('Escort', BuiltObjectSubRole.Escort, true);
        const design = makeDesign(BuiltObjectSubRole.Escort, spec.role);
        const result = placeComponentsOnDesign(ctx, design, spec, null, MAX_SHIP_SIZE, MAX_BASE_SIZE, null, 0.0);
        expect(result).not.toBeNull();
        for (const c of result!.components) {
            expect(ctx.research.checkComponentResearched(c)).toBe(true);
        }
    });
});
