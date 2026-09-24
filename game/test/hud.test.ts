import { describe, expect, it } from 'vitest';
import { chromeButtonFile, clearHudMessages, formatCashflow, formatClockLabel, formatMoney, formatPopulation, getHudMessages, habitatTypeLabel, pushHudMessage, resourceIconUrl } from '../src/ui/hud';
import { computeHudLayout } from '../src/ui/hudLayout';
import { START_STAR_DATE } from '../src/sim/galaxyTime';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';

// The DOM overlay itself needs a browser (jsdom is not configured), so this
// tests the pure control → chrome-image mapping from LoadUiChromeButtons and
// the element set the streamlined HUD renders.

describe('formatClockLabel (task 07b)', () => {
    it('formats the star date with an integer speed', () => {
        expect(formatClockLabel(START_STAR_DATE, 1)).toBe('2100.01.01 (1x)');
        expect(formatClockLabel(START_STAR_DATE, 4)).toBe('2100.01.01 (4x)');
    });

    it('formats fractional speeds as fractions', () => {
        expect(formatClockLabel(START_STAR_DATE, 0.25)).toBe('2100.01.01 (¼x)');
        expect(formatClockLabel(START_STAR_DATE, 0.5)).toBe('2100.01.01 (½x)');
    });
});

describe('chromeButtonFile', () => {
    it('maps controls to their original chrome button images', () => {
        expect(chromeButtonFile('tbtnColonies')).toBe('coloniesButton.png');
        expect(chromeButtonFile('tbtnBuiltObjects')).toBe('shipsAndBasesButton.png');
        expect(chromeButtonFile('tbtnEmpires')).toBe('diplomacyButton.png');
        expect(chromeButtonFile('tbtnGalaxyMap')).toBe('galaxyMapButton.png');
        expect(chromeButtonFile('tbtnShipGroups')).toBe('fleetsButton.png');
        expect(chromeButtonFile('btnGameMenu')).toBe('gameOptionsButton.png');
        expect(chromeButtonFile('btnHelp')).toBe('galactopediaButton.png');
        expect(chromeButtonFile('btnHistoryMessages')).toBe('messagesButton.png');
        // Cycle chips are text pills now (task 05d) — no chrome files.
        expect(chromeButtonFile('btnCycleShipGroups')).toBeNull();
        expect(chromeButtonFile('btnZoomIn')).toBe('zoomin.png');
        expect(chromeButtonFile('btnZoomColony')).toBe('zoomcolony.png');
    });

    it('returns null for controls with no chrome file', () => {
        // Runtime bitmaps in the original (play/pause) or absent files.
        expect(chromeButtonFile('btnPlayPause')).toBeNull();
        expect(chromeButtonFile('btnZoomSystem')).toBeNull();
        expect(chromeButtonFile('lblStarDate')).toBeNull();
    });
});

describe('formatPopulation (task 10b)', () => {
    it('formats billions with one decimal', () => {
        expect(formatPopulation(1_200_000_000)).toBe('1.2B');
        expect(formatPopulation(2_000_000_000)).toBe('2B');
    });

    it('formats millions without a forced decimal', () => {
        expect(formatPopulation(350_000_000)).toBe('350M');
        expect(formatPopulation(1_500_000)).toBe('1.5M');
    });

    it('formats thousands with one decimal', () => {
        expect(formatPopulation(4_200)).toBe('4.2K');
        expect(formatPopulation(4_000)).toBe('4K');
    });

    it('keeps smaller amounts plain', () => {
        expect(formatPopulation(999)).toBe('999');
        expect(formatPopulation(0)).toBe('0');
    });
});

describe('habitatTypeLabel (task 10b)', () => {
    it('splits the enum name into words and appends the category word', () => {
        expect(habitatTypeLabel(HabitatType.MarshySwamp, HabitatCategoryType.Planet)).toBe('Marshy Swamp Planet');
        expect(habitatTypeLabel(HabitatType.Continental, HabitatCategoryType.Moon)).toBe('Continental Moon');
        expect(habitatTypeLabel(HabitatType.MainSequence, HabitatCategoryType.Star)).toBe('Main Sequence Star');
        expect(habitatTypeLabel(HabitatType.BarrenRock, HabitatCategoryType.Asteroid)).toBe('Barren Rock Asteroid');
        expect(habitatTypeLabel(HabitatType.Hydrogen, HabitatCategoryType.GasCloud)).toBe('Hydrogen Gas cloud');
    });

    it('omits the category word when no category is given', () => {
        expect(habitatTypeLabel(HabitatType.MarshySwamp)).toBe('Marshy Swamp');
        expect(habitatTypeLabel(HabitatType.FrozenGasGiant)).toBe('Frozen Gas Giant');
    });
});

describe('resourceIconUrl (task 10b)', () => {
    it('builds the original resource icon path from the picture ref', () => {
        expect(resourceIconUrl(0)).toBe('/assets/dwu/images/ui/resources/Resource_0.bmp');
        expect(resourceIconUrl(17)).toBe('/assets/dwu/images/ui/resources/Resource_17.bmp');
    });
});

describe('formatMoney / formatCashflow (task 10d)', () => {
    it('adds thousands separators', () => {
        expect(formatMoney(641607)).toBe('641,607');
        expect(formatMoney(213959)).toBe('213,959');
        expect(formatMoney(0)).toBe('0');
    });

    it('keeps the minus sign outside the separators', () => {
        expect(formatMoney(-5000)).toBe('-5,000');
    });

    it('formats cashflow in parentheses with a sign', () => {
        expect(formatCashflow(213959)).toBe('(+213,959)');
        expect(formatCashflow(-5000)).toBe('(-5,000)');
        expect(formatCashflow(0)).toBe('(0)');
    });
});

describe('message ring buffer (task 10d)', () => {
    it('keeps the last five messages, newest last', () => {
        clearHudMessages();
        for (let i = 1; i <= 8; i++) pushHudMessage(`msg${i}`);
        expect([...getHudMessages()]).toEqual(['msg4', 'msg5', 'msg6', 'msg7', 'msg8']);
        clearHudMessages();
    });

    it('keeps fewer than five as-is', () => {
        clearHudMessages();
        pushHudMessage('a');
        pushHudMessage('b');
        expect([...getHudMessages()]).toEqual(['a', 'b']);
        clearHudMessages();
    });
});

describe('streamlined HUD element set (task 05c)', () => {
    const REMOVED = [
        'picSystem',
        'pnlBuiltObjectDetail',
        'pnlInfoPanel',
        'pnlHabitatInfo',
        'pnlColonyHabitatInfo',
        'pnlDetailInfoShipGroup',
        'pnlDetailInfo',
        'pnlSystemMap',
        'btnCycleBasesBack',
        'btnCycleColoniesBack',
        'btnCycleMilitaryBack',
        'btnCycleConstructionBack',
        'btnCycleOtherBack',
        'btnCycleShipGroupsBack',
        'btnCycleIdleShipsBack',
        'btnCycleShipStance',
        'btnSelectionAction1',
        'btnSelectionAction2',
        'btnSelectionAction3',
        'btnSelectionAction4',
        'btnSelectionAction5',
        'btnSelectionAction6',
        'btnSelectionAction7',
        'btnSelectionAction8',
        'btnSelectionBack',
        'btnSelectionForward',
        'btnMapOverlay1',
        'btnMapOverlay2',
        'btnMapOverlay3',
        'btnMapOverlay4',
        'btnMapOverlay5',
        'btnMapOverlay6',
        'btnMapOverlay7',
        'btnMapOverlay8',
        'btnMapCivilianFade',
        'btnZoomSelection',
        'btnZoomIn',
        'btnZoomOut',
        'btnZoomColony',
        'btnZoomSystem',
        'btnZoomRegion',
        'jQaYpdpkDs',
        'btnLockView',
        'btnSelectNearestMilitary',
        'btnSelectionPanelSize',
        'btnGameMenu',
        'btnHelp',
        'btnPlayPause',
        'btnGameSpeedDecrease',
        'btnGameSpeedIncrease',
        'lblStarDate',
        'lblSystemName',
        'lblStateMoney',
        'lblPrivateMoney',
        'lblGodData',
    ];

    it('renders none of the removed controls', () => {
        const layout = computeHudLayout(1920, 1080);
        const rendered = new Set(Object.keys(layout));
        for (const name of REMOVED) {
            expect(rendered.has(name), `${name} should be removed`).toBe(false);
        }
    });

    it('keeps the top-middle message panel and screen-launch row', () => {
        const layout = computeHudLayout(1920, 1080);
        expect(layout['lstMessages']).toBeDefined();
        for (const name of [
            'tbtnColonies',
            'btnExpansionPlanner',
            'btnEmpireGraphs',
            'btnEmpirePolicy',
            'btnGameEditor',
            'tbtnIntelligenceAgents',
            'tbtnEmpires',
            'btnEmpireSummary',
            'tbtnResearch',
            'tbtnDesigns',
            'btnBuildOrder',
            'tbtnConstructionYards',
            'tbtnBuiltObjects',
            'tbtnShipGroups',
            'tbtnTroops',
            'btnHistoryMessages',
            'btnGalacticHistory',
        ]) {
            expect(layout[name], `${name} missing from top bar`).toBeDefined();
        }
    });

    it('has the four streamlined panels', () => {
        const layout = computeHudLayout(1920, 1080);
        expect(layout['pnlTopLeftBar']).toEqual({ x: 10, y: 10, w: 300, h: 40 });
        expect(layout['pnlMoney'].x).toBe(1920 - 230 - 10);
        expect(layout['pnlSelection']).toEqual({ x: 10, y: 1080 - 220 - 10, w: 300, h: 220 });
        expect(layout['pnlOptionsList']).toEqual({ x: 1920 - 220 - 10, y: 1080 - 10, w: 220, h: 0 });
    });
});