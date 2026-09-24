import { describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/sim/galaxy';
import { GalaxyShape, HabitatCategoryType, HabitatType, Habitat } from '../src/sim/types';
import {
    GOD_MODE_PLAYER,
    GalaxyMapViewMode,
    VIEW_MODE_LABELS,
    computeViewModeSelection,
    findNearestSystemAt,
    galaxyMapScale,
    mapToWorld,
    sectorColumnLabel,
    starBrushColor,
    starDotSizes,
    type GalaxyMapPlayer,
} from '../src/ui/screens/galaxyMap';

// Task C3 — Galaxy Map screen: pure parts (the DOM screen needs a browser;
// jsdom isn't configured, see hud.test.ts). Screenshots cover the rest.
const galaxy = generateGalaxy({ seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`) });

describe('galaxy map rendering helpers (GalaxyMap.cs)', () => {
    it('star colours follow method_4 / Main.Part13.cs brushes', () => {
        const star = (t: HabitatType) => new Habitat(HabitatCategoryType.Star, t, 'x', 0, 0);
        expect(starBrushColor(star(HabitatType.MainSequence))).toBe('rgb(255, 255, 0)');
        expect(starBrushColor(star(HabitatType.RedGiant))).toBe('rgb(255, 0, 0)');
        expect(starBrushColor(star(HabitatType.SuperGiant))).toBe('rgb(255, 0, 0)');
        expect(starBrushColor(star(HabitatType.WhiteDwarf))).toBe('rgb(255, 255, 255)');
        expect(starBrushColor(star(HabitatType.Neutron))).toBe('rgb(0, 255, 255)');
        expect(starBrushColor(star(HabitatType.BlackHole))).toBe('rgb(0, 0, 176)');
        expect(starBrushColor(star(HabitatType.SuperNova))).toBe('rgb(128, 0, 128)');
        expect(starBrushColor(new Habitat(HabitatCategoryType.GasCloud, HabitatType.Hydrogen, 'g', 0, 0))).toBe('rgb(238, 130, 238)');
        expect(starBrushColor(new Habitat(HabitatCategoryType.Planet, HabitatType.Ocean, 'p', 0, 0))).toBeNull();
    });

    it('dot sizes (num28/num29)', () => {
        expect(starDotSizes(650, false)).toEqual({ normal: 2, selected: 5 });
        expect(starDotSizes(650, true)).toEqual({ normal: 3, selected: 5 });
        expect(starDotSizes(300, true)).toEqual({ normal: 2, selected: 5 });
    });

    it('scale and map->world (double_4 = SizeX / width)', () => {
        expect(galaxyMapScale(galaxy, 600)).toBe(galaxy.sizeX / 600);
        const p = mapToWorld(galaxy, 600, 300, 150);
        expect(p.x).toBe(Math.trunc(300 * galaxy.sizeX / 600));
        expect(p.y).toBe(Math.trunc(150 * galaxy.sizeX / 600));
    });

    it('sector labels A.. / 1..', () => {
        expect(sectorColumnLabel(0)).toBe('A');
        expect(sectorColumnLabel(5)).toBe('F');
    });

    it('click selects the nearest top-level habitat', () => {
        const star = galaxy.systems[7].systemStar;
        expect(findNearestSystemAt(galaxy, star.xpos + 10, star.ypos - 10)).toBe(star);
        const hit = findNearestSystemAt(galaxy, galaxy.sizeX / 2, galaxy.sizeY / 2)!;
        expect(hit.parent).toBeNull();
    });
});

describe('view modes (cmbGalaxyMapViewMode_SelectedValueChanged)', () => {
    it('has the 11 original modes', () => {
        expect(VIEW_MODE_LABELS.length).toBe(11);
        expect(VIEW_MODE_LABELS[GalaxyMapViewMode.ResearchLocations]).toBe('Research Locations');
    });

    it('Default clears the filter', () => {
        expect(computeViewModeSelection(galaxy, GalaxyMapViewMode.Default)).toEqual({ systems: null, habitats: null });
    });

    it('Scenic / Research / Independent pick the matching habitats and their systems', () => {
        const cases: [GalaxyMapViewMode, (h: Habitat) => boolean][] = [
            [GalaxyMapViewMode.ScenicLocations, (h) => h.scenicFactor > 0],
            [GalaxyMapViewMode.ResearchLocations, (h) => h.researchBonus > 0],
            [GalaxyMapViewMode.IndependentPopulations, (h) => h.population.totalAmount > 0],
        ];
        for (const [mode, pred] of cases) {
            const sel = computeViewModeSelection(galaxy, mode);
            const expected = galaxy.habitats.filter(pred);
            expect(sel.habitats).toEqual(expected);
            for (const h of expected) expect(sel.systems).toContain(galaxy.determineHabitatSystemStar(h));
            expect(new Set(sel.systems).size).toBe(sel.systems!.length);
        }
    });

    it('Explored Systems honours the player visibility', () => {
        // The first three star systems (gas clouds are SystemInfo entries too
        // and always count as explored, so they are skipped here).
        const starIdx = galaxy.systems
            .map((sys, i) => ({ sys, i }))
            .filter(({ sys }) => sys.systemStar.category === HabitatCategoryType.Star)
            .slice(0, 3)
            .map(({ i }) => i);
        const player: GalaxyMapPlayer = { ...GOD_MODE_PLAYER, systemExplored: (i) => starIdx.includes(i), resourcesKnown: () => false };
        const sel = computeViewModeSelection(galaxy, GalaxyMapViewMode.ExploredSystems, player);
        const starSystems = sel.systems!.filter((h) => h.category === HabitatCategoryType.Star);
        expect(starSystems.map((h) => h.systemIndex).sort((a, b) => a - b)).toEqual(starIdx);
        expect(sel.habitats).toEqual([]);
    });

    it('Potential Colonies filters by habitat type', () => {
        const targets = galaxy.habitats.filter((h) => h.category === HabitatCategoryType.Planet).slice(0, 40);
        const player: GalaxyMapPlayer = { ...GOD_MODE_PLAYER, colonizationTargets: () => targets };
        const all = computeViewModeSelection(galaxy, GalaxyMapViewMode.PotentialColonies, player, { habitatType: HabitatType.Undefined });
        expect(all.habitats).toEqual(targets);
        const oceans = computeViewModeSelection(galaxy, GalaxyMapViewMode.PotentialColonies, player, { habitatType: HabitatType.Ocean });
        expect(oceans.habitats!.every((h) => h.type === HabitatType.Ocean)).toBe(true);
    });

    it('empire-only modes are empty in god mode', () => {
        for (const m of [GalaxyMapViewMode.OurSystems, GalaxyMapViewMode.EnemySystems, GalaxyMapViewMode.PirateBases, GalaxyMapViewMode.AncientRuins]) {
            expect(computeViewModeSelection(galaxy, m).habitats).toEqual([]);
        }
    });
});
