import { describe, expect, it } from 'vitest';
import { chromeButtonFile, clearHudMessages, formatCashflow, formatClockLabel, formatMoney, formatPopulation, getHudMessageHistory, getHudMessages, habitatTypeLabel, hudTransformOrigin, nextInCycle, playerColonyList, pushHudMessage, resourceIconUrl } from '../src/ui/hud';
import { historyRows } from '../src/ui/screens/messageHistory';
import { computeHudLayout, TOP_BAR_BUTTONS } from '../src/ui/hudLayout';
import { START_STAR_DATE } from '../src/sim/galaxyTime';
import { Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';
import type { SystemInfo } from '../src/sim/types';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';

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

describe('message history (task 12i)', () => {
    it('records pushed messages with their date (defaulting to empty)', () => {
        clearHudMessages();
        pushHudMessage('first', '2100.01.01');
        pushHudMessage('second');
        expect(getHudMessageHistory()).toEqual([
            { text: 'first', at: '2100.01.01' },
            { text: 'second', at: '' },
        ]);
        clearHudMessages();
    });

    it('caps the history at 500 entries, dropping the oldest', () => {
        clearHudMessages();
        for (let i = 1; i <= 503; i++) pushHudMessage(`m${i}`);
        const history = getHudMessageHistory();
        expect(history.length).toBe(500);
        expect(history[0].text).toBe('m4');
        expect(history[history.length - 1].text).toBe('m503');
        clearHudMessages();
    });

    it('clears the history with clearHudMessages', () => {
        clearHudMessages();
        pushHudMessage('x');
        expect(getHudMessageHistory().length).toBe(1);
        clearHudMessages();
        expect(getHudMessageHistory().length).toBe(0);
    });
});

describe('historyRows (task 12i)', () => {
    it('puts the newest entry first', () => {
        const rows = historyRows([
            { text: 'a', at: '' },
            { text: 'b', at: '2100.01.02' },
            { text: 'c', at: '' },
        ]);
        expect(rows.map((r) => r.text)).toEqual(['c', 'b', 'a']);
        expect(rows.map((r) => r.at)).toEqual(['', '2100.01.02', '']);
    });

    it('returns an empty list for no entries', () => {
        expect(historyRows([])).toEqual([]);
    });
});

describe('hudTransformOrigin (task 10f)', () => {
    const layout = computeHudLayout(1920, 1080);
    const rectFor = (name: string) => layout[name] ?? { x: 0, y: 0, w: 0, h: 0 };

    it('scales right-anchored panels from their right edge', () => {
        expect(hudTransformOrigin('pnlMoney', rectFor('pnlMoney'))).toBe('100% 0');
        expect(hudTransformOrigin('pnlOptionsList', rectFor('pnlOptionsList'))).toBe('100% 100%');
    });

    it('scales the bottom-left selection panel from its bottom edge', () => {
        expect(hudTransformOrigin('pnlSelection', rectFor('pnlSelection'))).toBe('0 100%');
    });

    it('scales top-middle elements from top-centre', () => {
        expect(hudTransformOrigin('lstMessages', rectFor('lstMessages'))).toBe('50% 0');
        for (const name of TOP_BAR_BUTTONS) {
            expect(hudTransformOrigin(name, rectFor(name)), `${name} should scale from top-centre`).toBe('50% 0');
        }
    });

    it('defaults other elements to top-left', () => {
        expect(hudTransformOrigin('pnlTopLeftBar', rectFor('pnlTopLeftBar'))).toBe('0 0');
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

describe('nextInCycle (task 10h)', () => {
    const list = ['a', 'b', 'c'];

    it('steps forward and back with wrap-around', () => {
        expect(nextInCycle(list, 'a', 1)).toBe('b');
        expect(nextInCycle(list, 'b', 1)).toBe('c');
        expect(nextInCycle(list, 'c', 1)).toBe('a');
        expect(nextInCycle(list, 'b', -1)).toBe('a');
        expect(nextInCycle(list, 'a', -1)).toBe('c');
        expect(nextInCycle(list, 'c', -1)).toBe('b');
    });

    it('returns null for an empty list', () => {
        expect(nextInCycle([], 'a', 1)).toBeNull();
        expect(nextInCycle([], null, -1)).toBeNull();
    });

    it('starts at the first item going forward when current is not in the list', () => {
        expect(nextInCycle(list, null, 1)).toBe('a');
        expect(nextInCycle(list, 'zzz', 1)).toBe('a');
    });

    it('starts at the last item going back when current is not in the list', () => {
        expect(nextInCycle(list, null, -1)).toBe('c');
        expect(nextInCycle(list, 'zzz', -1)).toBe('c');
    });

    it('works on a single-item list', () => {
        expect(nextInCycle(['only'], 'only', 1)).toBe('only');
        expect(nextInCycle(['only'], 'only', -1)).toBe('only');
    });
});

describe('playerColonyList (task 10h)', () => {
    function planet(name: string, population: number): Habitat {
        const h = new Habitat(HabitatCategoryType.Planet, HabitatType.Ocean, name, 0, 0);
        if (population > 0) {
            // totalAmount is what generation sets via RecalculateTotalAmount;
            // the cycler only reads it.
            h.population.totalAmount = population;
        }
        return h;
    }

    function galaxyWith(habitats: Habitat[], owner: Empire | null, others?: Habitat[]): Galaxy {
        const system = { systemStar: habitats[0], habitats: [...habitats, ...(others ?? [])] } as unknown as SystemInfo;
        return { systems: [system] } as unknown as Galaxy;
    }

    it('keeps only owned planets/moons of the given empire', () => {
        const player = {} as Empire;
        const rival = {} as Empire;
        const p1 = planet('Alpha', 100);
        p1.owner = player;
        const m1 = new Habitat(HabitatCategoryType.Moon, HabitatType.BarrenRock, 'Beta', 0, 0);
        m1.owner = player;
        const p2 = planet('Gamma', 50);
        p2.owner = rival;
        const star = new Habitat(HabitatCategoryType.Star, HabitatType.MainSequence, 'Sun', 0, 0);
        star.owner = player;
        const g = galaxyWith([star, p1, m1, p2], player);
        expect(playerColonyList(g, player).map((h) => h.name)).toEqual(['Alpha', 'Beta']);
    });

    it('orders by descending population when every colony has one', () => {
        const player = {} as Empire;
        const small = planet('Small', 10);
        small.owner = player;
        const big = planet('Big', 1000);
        big.owner = player;
        const mid = planet('Mid', 100);
        mid.owner = player;
        const g = galaxyWith([small, big, mid], player);
        expect(playerColonyList(g, player).map((h) => h.name)).toEqual(['Big', 'Mid', 'Small']);
    });

    it('falls back to name order when some colony has no population', () => {
        const player = {} as Empire;
        const b = planet('Bravo', 1000);
        b.owner = player;
        const a = planet('Alfa', 0);
        a.owner = player;
        const g = galaxyWith([b, a], player);
        expect(playerColonyList(g, player).map((h) => h.name)).toEqual(['Alfa', 'Bravo']);
    });

    it('breaks population ties by name', () => {
        const player = {} as Empire;
        const z = planet('Zeta', 50);
        z.owner = player;
        const y = planet('Yota', 50);
        y.owner = player;
        const g = galaxyWith([z, y], player);
        expect(playerColonyList(g, player).map((h) => h.name)).toEqual(['Yota', 'Zeta']);
    });
});