// The top strip ported from Main.Part12.cs MainInit / MainView.cs method_18 / ResearchButton.cs (src/ui/topBar.ts).
import { describe, expect, it } from 'vitest';
import {
    cornerRadiusCss,
    formatPercent0Net,
    researchReadout,
    showViewSystemName,
    TOP_BASE_SCALE,
    TOP_LEFT_BUTTONS,
    TOP_MIN_VIRTUAL_WIDTH,
    TOP_ROW_BUTTONS,
    TOP_ROW_WIDTH,
    topBarLayout,
    topBarScale,
    viewSystemName,
    type SystemNameGalaxy,
    type SystemNameHabitat,
} from '../src/ui/topBar';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { GalaxyLocationType } from '../src/sim/galaxyLocation';
import type { TechNode } from '../src/sim/researchSystem';

describe('topBarLayout (Main.Part12.cs MainInit 1714-1804)', () => {
    it('places the message box, history buttons and the 624 px row with the original formulas', () => {
        const l = topBarLayout(1920);
        const num3 = Math.trunc((1920 - 700) / 2);
        expect(l['lstMessages']).toEqual({ x: num3, y: 10, w: 668, h: 80 });
        expect(l['btnHistoryMessages']).toEqual({ x: num3 + 668, y: 10, w: 32, h: 48 });
        expect(l['btnGalacticHistory']).toEqual({ x: num3 + 668, y: 58, w: 32, h: 32 });
        expect(TOP_ROW_WIDTH).toBe(624);
        let x = Math.trunc((1920 - 624) / 2);
        for (const b of TOP_ROW_BUTTONS) {
            expect(l[b.name]).toEqual({ x, y: 90, w: b.w, h: b.h });
            x += b.w;
        }
        // The five tall centre buttons.
        expect(TOP_ROW_BUTTONS.filter((b) => b.h === 64).map((b) => b.name)).toEqual([
            'tbtnIntelligenceAgents',
            'tbtnEmpires',
            'btnEmpireSummary',
            'tbtnResearch',
            'tbtnDesigns',
        ]);
        expect(l['pnlMoney'].x + l['pnlMoney'].w).toBe(1920);
    });

    it('top-left controls sit at their original rects', () => {
        const byName = Object.fromEntries(TOP_LEFT_BUTTONS.map((b) => [b.name, [b.x, b.y, b.w, b.h]]));
        expect(byName).toEqual({
            btnGameMenu: [10, 10, 40, 40],
            btnHelp: [50, 10, 40, 40],
            btnPlayPause: [10, 62, 80, 34],
            btnGameSpeedDecrease: [10, 96, 40, 20],
            btnGameSpeedIncrease: [50, 96, 40, 20],
        });
    });

    it('corner curves map to CSS radii (tl tr br bl)', () => {
        expect(cornerRadiusCss([true, false, false, true])).toBe('7px 0 0 7px');
        expect(cornerRadiusCss([false, false, true, false], 5)).toBe('0 0 5px 0');
    });
});

describe('topBarScale', () => {
    it('matches the selection frame at 1080 p and follows the height and UI scale', () => {
        expect(topBarScale(1920, 1080, 1)).toBeCloseTo(Math.min(TOP_BASE_SCALE, 1920 / TOP_MIN_VIRTUAL_WIDTH));
        expect(topBarScale(3840, 2160, 1)).toBeCloseTo(2 * topBarScale(1920, 1080, 1));
        expect(topBarScale(1280, 720, 1)).toBeCloseTo(TOP_BASE_SCALE * (720 / 1080));
    });
    it('is capped by the width so narrow windows keep the virtual width', () => {
        const k = topBarScale(1440, 1080, 1.25);
        expect(1440 / k).toBeCloseTo(TOP_MIN_VIRTUAL_WIDTH);
    });
});

describe('researchReadout (ResearchButton.cs DrawIndustryRow)', () => {
    const node = (progress: number, cost: number) => ({ progress, cost }) as unknown as TechNode;
    it('shows the head of each queue as "0%" and "  -----" for an empty queue', () => {
        const rows = researchReadout({ researchQueueWeapons: [node(58, 100), node(1, 2)], researchQueueEnergy: [], researchQueueHighTech: [node(0.7, 1)] });
        expect(rows.map((r) => r.text)).toEqual(['58%', '  -----', '70%']);
        expect(rows.map((r) => r.y)).toEqual([5, 23, 41]);
        expect(rows[1].node).toBeNull();
    });
    it('no empire: three idle rows', () => {
        expect(researchReadout(null).map((r) => r.text)).toEqual(['  -----', '  -----', '  -----']);
    });
    it('.NET "0%" rounding', () => {
        expect(formatPercent0Net(0.005)).toBe('1%');
        expect(formatPercent0Net(0.584)).toBe('58%');
        expect(formatPercent0Net(1)).toBe('100%');
    });
});

describe('viewSystemName (Main.Part11.cs method_149 string_22)', () => {
    const star = (over: Partial<SystemNameHabitat> = {}): SystemNameHabitat => ({
        name: 'Sol', xpos: 0, ypos: 0, systemIndex: 3, category: HabitatCategoryType.Star, type: HabitatType.MainSequence, ...over,
    });
    const galaxy = (h: SystemNameHabitat | null, locs: { type: GalaxyLocationType; name: string }[] = []): SystemNameGalaxy => ({
        fastFindNearestSystem: () => h,
        determineGalaxyLocationsAtPoint: () => locs,
    });
    const player = (status: SystemVisibilityStatus, known: unknown[] = []) => ({
        visibility: { checkSystemVisibilityStatus: () => status, knownGalaxyLocations: known },
    });

    it('names explored systems by star type', () => {
        expect(viewSystemName(galaxy(star()), player(SystemVisibilityStatus.Explored), 10, 10)).toBe('Sol system');
        expect(viewSystemName(galaxy(star({ type: HabitatType.BlackHole })), player(SystemVisibilityStatus.Visible), 0, 0)).toBe('Sol Black Hole');
        expect(viewSystemName(galaxy(star({ type: HabitatType.SuperNova })), player(SystemVisibilityStatus.Visible), 0, 0)).toBe('Sol Nova');
        expect(viewSystemName(galaxy(star({ type: HabitatType.Argon, category: HabitatCategoryType.GasCloud })), player(SystemVisibilityStatus.Visible), 0, 0)).toBe('Sol Gas Cloud');
        expect(viewSystemName(galaxy(star()), player(SystemVisibilityStatus.Visible), 0, 0, () => 'Rim 4')).toBe('Rim 4 system');
    });
    it('unexplored systems and gas clouds', () => {
        expect(viewSystemName(galaxy(star()), player(SystemVisibilityStatus.Unexplored), 0, 0)).toBe('(Unexplored System)');
        expect(viewSystemName(galaxy(star({ category: HabitatCategoryType.GasCloud })), player(SystemVisibilityStatus.Unexplored), 0, 0)).toBe('(Unexplored Gas Cloud)');
    });
    it('far from any system: a known restricted area / super nova, else deep space', () => {
        const far = star({ xpos: 100000 });
        const area = { type: GalaxyLocationType.RestrictedArea, name: 'Forbidden Zone' };
        expect(viewSystemName(galaxy(far, [area]), player(SystemVisibilityStatus.Visible, [area]), 0, 0)).toBe('Forbidden Zone');
        expect(viewSystemName(galaxy(far, [area]), player(SystemVisibilityStatus.Visible, []), 0, 0)).toBe('(Deep Space)');
        expect(viewSystemName(galaxy(null), null, 0, 0)).toBe('(Deep Space)');
    });
    it('is shown only below zoom factor 100', () => {
        expect(showViewSystemName(1 / 50)).toBe(true);
        expect(showViewSystemName(1 / 100)).toBe(false);
        expect(showViewSystemName(1 / 3000)).toBe(false);
    });
});
