import { describe, expect, it } from 'vitest';
import {
    habitatLabelFontSize,
    habitatLabelVisible,
    moonDotPx,
    moonZoomFactor,
    planetSpritePx,
    planetZoomFactor,
    starDiscMaxFactor,
    starGalaxySpritePx,
    starSpritePx,
} from '../src/render/mainView';
import { HabitatType } from '../src/sim/types';

// Task 12p: system-zoom body sizes in the original's zoom factor f = 1/z
// (z = px per world unit). Planets/moons use compressed factors with a 4 px
// floor; stars use the plain factor (floor 4, no cap); the galaxy-level map
// star icon is floored at 10 px plus 2.

describe('compressed zoom factors (Main.Part11.cs)', () => {
    it('planetZoomFactor divides by 1.25 above f = 10, floored at 10', () => {
        expect(planetZoomFactor(1)).toBe(1);
        expect(planetZoomFactor(10)).toBe(10);
        expect(planetZoomFactor(12)).toBe(10); // 12/1.25 = 9.6 -> max(10, 9.6)
        expect(planetZoomFactor(50)).toBe(40);
        expect(planetZoomFactor(70)).toBe(56);
    });

    it('moonZoomFactor divides by 1.1 above f = 10', () => {
        expect(moonZoomFactor(50)).toBeCloseTo(45.4545, 4);
        expect(moonZoomFactor(70)).toBeCloseTo(63.636, 3);
    });
});

describe('planetSpritePx / moonDotPx (Diameter / factor, min 4 px)', () => {
    it('planets keep real scale and snap to the 4 px floor', () => {
        expect(planetSpritePx(300, 1)).toBe(300); // f 1
        expect(planetSpritePx(300, 0.1)).toBe(30); // f 10
        expect(planetSpritePx(300, 1 / 12)).toBe(30); // f 12 -> 300/10
        expect(planetSpritePx(300, 1 / 50)).toBe(7); // f 50 -> 300/40
        expect(planetSpritePx(300, 1 / 70)).toBe(5); // f 70 -> 300/56
        expect(planetSpritePx(100, 1 / 50)).toBe(4); // 100/40 = 2.5 -> floor
        expect(planetSpritePx(100, 1 / 70)).toBe(4); // 100/56 = 1.78 -> floor
    });

    it('moons use the moon factor', () => {
        expect(moonDotPx(400, 1)).toBe(400);
        expect(moonDotPx(400, 0.1)).toBe(40);
        expect(moonDotPx(400, 1 / 50)).toBe(8); // 400/45.45... = 8.8 -> 8
        expect(moonDotPx(400, 1 / 70)).toBe(6); // 400/63.63... = 6.28 -> 6
        expect(moonDotPx(100, 1 / 50)).toBe(4); // floor
    });
});

describe('starSpritePx / starGalaxySpritePx (no compression)', () => {
    it('stars are D/f with a 4 px floor and no cap', () => {
        expect(starSpritePx(1000, 1)).toBe(1000);
        expect(starSpritePx(1000, 0.1)).toBe(100);
        expect(starSpritePx(1000, 1 / 50)).toBe(20);
        expect(starSpritePx(1000, 1 / 70)).toBe(14); // 1000/70 = 14.28 -> 14
        expect(starSpritePx(150, 1 / 50)).toBe(4); // 150/50 = 3 -> floor
    });

    it('the galaxy-level map star icon is floored at 10 px, plus 2', () => {
        expect(starGalaxySpritePx(1000, 1 / 70)).toBe(16); // 14 + 2
        expect(starGalaxySpritePx(400, 1 / 70)).toBe(12); // 5.71 -> 5, floor 10, +2
    });
});

describe('starDiscMaxFactor (method_60 result column)', () => {
    it('per-type disc/corona cutoffs', () => {
        expect(starDiscMaxFactor(HabitatType.MainSequence)).toBe(60);
        expect(starDiscMaxFactor(HabitatType.RedGiant)).toBe(75);
        expect(starDiscMaxFactor(HabitatType.WhiteDwarf)).toBe(40);
        expect(starDiscMaxFactor(HabitatType.Neutron)).toBe(30);
        expect(starDiscMaxFactor(HabitatType.BlackHole)).toBe(150);
    });
});

describe('habitatLabelVisible (MainView.1.cs label rules)', () => {
    it('planets name down to f < 10; populated colonies name down to f < 500', () => {
        expect(habitatLabelVisible(true, false, 5)).toBe(true); // planet, f < 10
        expect(habitatLabelVisible(true, false, 10)).toBe(false); // not < 10
        expect(habitatLabelVisible(false, false, 5)).toBe(false); // non-planet, unpopulated
        expect(habitatLabelVisible(false, true, 50)).toBe(true); // populated colony
        expect(habitatLabelVisible(true, true, 600)).toBe(false); // f >= 500
    });
});

describe('habitatLabelFontSize (method_84 font switch)', () => {
    it('NormalFont (17 px) below f = 3, TinyFont (11 px) at or above', () => {
        expect(habitatLabelFontSize(2)).toBe(17);
        expect(habitatLabelFontSize(3)).toBe(11);
    });
});