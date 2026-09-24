import { describe, expect, it } from 'vitest';
import { chromeButtonFile } from '../src/ui/hud';
import { computeHudLayout } from '../src/ui/hudLayout';

// The DOM overlay itself needs a browser (jsdom is not configured), so this
// tests the pure control → chrome-image mapping from LoadUiChromeButtons and
// the element set the streamlined HUD renders.

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