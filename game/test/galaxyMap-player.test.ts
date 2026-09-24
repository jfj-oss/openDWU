import { describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { EmpireVisibility, SystemVisibilityStatus } from '../src/sim/visibility';
import { GalaxyShape, HabitatCategoryType, type Habitat } from '../src/sim/types';
import {
    GOD_MODE_PLAYER,
    GalaxyMapViewMode,
    computeViewModeSelection,
    empireGalaxyMapPlayer,
} from '../src/ui/screens/galaxyMap';

// Task 13e — the Galaxy Map's view of the real player empire (Main.Part9.cs
// cmbGalaxyMapViewMode_SelectedValueChanged). The pure parts only; the DOM
// screen is covered by screenshots (see galaxyMap.test.ts).
const galaxy = generateGalaxy({ seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`) });

describe('empireGalaxyMapPlayer (task 13e)', () => {
    const vis = new EmpireVisibility(galaxy);
    const emp = { visibility: vis, resourceMap: vis.resourceMap, colonies: [], diplomaticRelations: [], knownPirateBases: [] } as unknown as Empire;
    const p = empireGalaxyMapPlayer(emp);

    it('systemExplored follows the empire visibility, with index guards', () => {
        vis.setSystemVisibility(galaxy.systems[3].systemStar, SystemVisibilityStatus.Explored);
        expect(p.systemExplored(3)).toBe(true);
        expect(p.systemExplored(4)).toBe(false);
        // checkSystemExplored indexes without a bounds check; the builder guards.
        expect(p.systemExplored(-1)).toBe(false);
        expect(p.systemExplored(galaxy.systems.length + 5)).toBe(false);
    });

    it('Explored Systems shows explored systems only', () => {
        // System 9 is a star (gas-cloud systems count as always explored, so
        // they can't serve as the negative case).
        const sel = computeViewModeSelection(galaxy, GalaxyMapViewMode.ExploredSystems, p);
        expect(sel.systems).toContain(galaxy.systems[3].systemStar);
        expect(sel.systems).not.toContain(galaxy.systems[9].systemStar);
    });

    it('resourcesKnown follows the empire resource map', () => {
        const h = galaxy.systems[3].systemStar;
        expect(p.resourcesKnown(h)).toBe(false);
        vis.resourceMap.setResourcesKnown(h, true);
        expect(p.resourcesKnown(h)).toBe(true);
    });

    it('enemyColonies collects colonies of empires at war, in order', () => {
        const e1 = {} as Habitat;
        const e2 = {} as Habitat;
        const f1 = {} as Habitat;
        const enemy = { colonies: [e1, e2] } as unknown as Empire;
        const friend = { colonies: [f1] } as unknown as Empire;
        const relations = [
            { type: DiplomaticRelationType.War, otherEmpire: enemy },
            { type: DiplomaticRelationType.None, otherEmpire: friend },
            { type: DiplomaticRelationType.War, otherEmpire: null },
            { type: DiplomaticRelationType.War, otherEmpire: emp },
        ];
        const ep = { ...emp, diplomaticRelations: relations } as unknown as Empire;
        expect(empireGalaxyMapPlayer(ep).enemyColonies()).toEqual([e1, e2]);
    });

    it('knownPirateBaseHabitats returns the parent habitats of known bases', () => {
        const ph = {} as Habitat;
        const ep = { ...emp, knownPirateBases: [{ parentHabitat: ph }, { parentHabitat: null }] } as unknown as Empire;
        expect(empireGalaxyMapPlayer(ep).knownPirateBaseHabitats()).toEqual([ph]);
    });

    it('colonies() is the empire own array; colonizationTargets() is empty', () => {
        const cols = [{} as Habitat];
        const ep = { ...emp, colonies: cols } as unknown as Empire;
        const q = empireGalaxyMapPlayer(ep);
        expect(q.colonies()).toBe(cols);
        expect(q.colonizationTargets()).toEqual([]);
    });
});

describe('IndependentPopulations owner check (task 13e)', () => {
    it('keeps only unowned or independent-population habitats', () => {
        const star = {} as Habitat;
        const ind = {};
        const other = {};
        const mk = (empire: unknown): Habitat => ({ population: { totalAmount: 5 }, category: HabitatCategoryType.Planet, systemIndex: 0, empire }) as unknown as Habitat;
        const a = mk(null);
        const b = mk(ind);
        const c = mk(other);
        const fakeGalaxy = { habitats: [a, b, c], independentEmpire: ind, determineHabitatSystemStar: () => star } as unknown as Parameters<typeof computeViewModeSelection>[0];
        const sel = computeViewModeSelection(fakeGalaxy, GalaxyMapViewMode.IndependentPopulations, GOD_MODE_PLAYER);
        expect(sel.habitats).toEqual([a, b]);
        expect(sel.systems).toEqual([star]);
    });
});