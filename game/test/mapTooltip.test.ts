import { describe, expect, it } from 'vitest';
import { hoverPanelFill, tooltipText } from '../src/ui/mapTooltip';
import { Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';

// Task 12k: pure hover-tooltip text for a picked habitat.

/** A top-level star at a fixed position. */
function makeStar(name: string): Habitat {
    return new Habitat(HabitatCategoryType.Star, HabitatType.MainSequence, name, 0, 0);
}

/** A planet orbiting a star (parent given so the orbit ctor applies). */
function makePlanet(parent: Habitat, name: string): Habitat {
    const h = new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, name, parent, 0, true, 10_000, 10);
    h.diameter = 100;
    return h;
}

describe('tooltipText (task 12k)', () => {
    it('a star shows only its name', () => {
        const star = makeStar('Sol');
        expect(tooltipText(star, null)).toBe('Sol');
        // The system name is never appended to stars.
        expect(tooltipText(star, 'Sol')).toBe('Sol');
    });

    it('a planet with no empire shows name + system suffix', () => {
        const star = makeStar('Sol');
        const planet = makePlanet(star, 'Terra');
        expect(tooltipText(planet, 'Sol')).toBe('Terra (Sol)');
        // No systemName -> just the name.
        expect(tooltipText(planet, null)).toBe('Terra');
    });

    it('a colonized planet shows name — empire (system)', () => {
        const star = makeStar('Sol');
        const planet = makePlanet(star, 'Terra');
        // Empire is a plain field on Habitat; stub it like the sim does.
        planet.empire = { name: 'Terran Union' } as unknown as Habitat['empire'];
        expect(tooltipText(planet, 'Sol')).toBe('Terra — Terran Union (Sol)');
        // An empty empire name is treated as no empire.
        planet.empire = { name: '' } as unknown as Habitat['empire'];
        expect(tooltipText(planet, 'Sol')).toBe('Terra (Sol)');
    });

    it('omits the system suffix when it equals the planet name', () => {
        const star = makeStar('Aldebaran');
        const planet = makePlanet(star, 'Aldebaran');
        expect(tooltipText(planet, 'Aldebaran')).toBe('Aldebaran');
    });
});
// [uiwp6] HoverPanel.cs solidBrush_0: the owner's main colour at alpha 32, (64, 64, 64) at alpha 32 otherwise.
describe('hoverPanelFill (HoverPanel.cs method_0 / method_13)', () => {
    it('tints with the empire main colour at alpha 32', () => {
        expect(hoverPanelFill(0xff8000)).toBe('rgba(255, 128, 0, 0.125)');
    });
    it('falls back to (64, 64, 64) at alpha 32', () => {
        expect(hoverPanelFill(null)).toBe('rgba(64, 64, 64, 0.125)');
    });
});
