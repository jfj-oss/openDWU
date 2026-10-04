// WP1 (original-style New Game wizard): the pure pieces ported with the restyle — the government attributes text
// (Start.1.cs method_208), the start-location ring (Start.2.cs cmbYourEmpireStartLocation_SelectedIndexChanged), the
// ColorDropDown palette (ColorDropDown.ResolveColors) and LabelledTrackBar's LinkWidth (LabelledTrackBar.cs DoLayout).
import { describe, expect, it } from 'vitest';
import {
    ALIEN_LIFE_TICKS,
    COLONY_PREVALENCE_TICKS,
    governmentAttributesText,
    startLocationRing,
    wizardColorPalette,
} from '../src/ui/screens/newGameWizard';
import { trackBarSliderRect } from '../src/ui/originalWindowControls';
import { GalaxyShape } from '../src/sim/types';
import type { Government } from '../src/sim/data/governments';

const gov = (o: Partial<Government>): Government =>
    ({
        governmentId: 0,
        name: 'Test',
        corruption: 1,
        warWeariness: 1,
        maintenanceCosts: 1,
        approvalRating: 1,
        populationGrowth: 1,
        researchSpeed: 1,
        troopRecruitment: 1,
        tradeBonus: 1,
        ...o,
    }) as Government;

describe('governmentAttributesText (Start.1.cs method_208)', () => {
    it('lists the eight factors as "+x%" / "-x%", "Normal" at 1.0, in the original order', () => {
        const text = governmentAttributesText(gov({ approvalRating: 0.95, corruption: 1.1, researchSpeed: 0.75, troopRecruitment: 1.2, warWeariness: 0.65 }), (t) => t);
        expect(text.split('\n')).toEqual([
            'Approval: -5%',
            'Corruption: +10%',
            'Growth rate: Normal',
            'Research speed: -25%',
            'Colony Income: Normal',
            'Maintenance costs: Normal',
            'Troop recruitment: +20%',
            'War weariness: -35%',
        ]);
    });

    it('formats like .NET "+#0%;-#0%;Normal": half away from zero, a value rounding to 0 is Normal', () => {
        expect(governmentAttributesText(gov({ approvalRating: 1.125 }), (t) => t).split('\n')[0]).toBe('Approval: +13%');
        expect(governmentAttributesText(gov({ approvalRating: 0.875 }), (t) => t).split('\n')[0]).toBe('Approval: -13%');
        expect(governmentAttributesText(gov({ approvalRating: 0.996 }), (t) => t).split('\n')[0]).toBe('Approval: Normal');
    });

    it('says the government is random without one', () => {
        expect(governmentAttributesText(null, (t) => t)).toBe('(Government randomly selected)');
    });
});

describe('startLocationRing (Start.2.cs 2794)', () => {
    it('maps the start locations to the ring the original draws', () => {
        expect(startLocationRing('Deep Core', GalaxyShape.Elliptical)).toEqual({ inner: 0, width: 0.29 });
        expect(startLocationRing('Outer Rim', GalaxyShape.Elliptical)).toEqual({ inner: 0.86, width: 0.14 });
        expect(startLocationRing('Void', GalaxyShape.Ring)).toEqual({ inner: 0.29, width: 0.53 });
        expect(startLocationRing('Edge', GalaxyShape.ClustersEven)).toEqual({ inner: 0.48, width: 0.96 });
    });

    it('"(Random)" covers the whole galaxy, wider for the irregular and cluster shapes', () => {
        expect(startLocationRing('(Random)', GalaxyShape.Spiral)).toEqual({ inner: 0, width: 1.0 });
        expect(startLocationRing('(Random)', GalaxyShape.Irregular)).toEqual({ inner: 0, width: 1.44 });
        expect(startLocationRing('(Random)', GalaxyShape.ClustersVaried)).toEqual({ inner: 0, width: 1.44 });
    });
});

describe('wizardColorPalette (ColorDropDown.ResolveColors)', () => {
    it('is Galaxy.SelectColorFromKey(0 .. 19)', () => {
        const p = wizardColorPalette();
        expect(p).toHaveLength(20);
        expect(p[0]).toBe('#0000b0');
        expect(p[10]).toBe('#ff0030');
        expect(p[19]).toBe('#ffa6c9');
    });
});

describe('the Colonization page trackbar labels (Start.cs method_34 SetLabels)', () => {
    it('are the original names', () => {
        expect(COLONY_PREVALENCE_TICKS).toEqual(['Scarce', 'Occasional', 'Normal', 'Plentiful', 'Abundant']);
        expect(ALIEN_LIFE_TICKS).toEqual(['Rare', 'Scattered', 'Normal', 'Plentiful', 'Teeming']);
    });
});

describe('trackBarSliderRect LinkWidth (LabelledTrackBar.cs DoLayout)', () => {
    it('keeps the LinkWidth free right of the slider', () => {
        // tbarStartNewGameTheGalaxyPirates: 403 × 55, LabelWidth 60, LinkWidth 65.
        expect(trackBarSliderRect(403, 55, 60, 25, 65)).toEqual({ x: 88, y: 30, w: 403 - (6 + 60 + 50 + 65), h: 22 });
        // Without a link the rect is the old one.
        expect(trackBarSliderRect(630, 55, 80)).toEqual({ x: 108, y: 30, w: 630 - (6 + 80 + 50), h: 22 });
    });
});
