import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { HabitatCategoryType } from '../src/sim/types';
import {
    buttonColumnTop,
    clampScroll,
    fmtMillionsM,
    idleShipsList,
    itemClickTarget,
    itemHabitatStatus,
    itemListArea,
    itemPanelDefs,
    itemRowModel,
    maxScroll,
    nextSizeFactor,
    noItemsText,
    panelButtonHint,
    panelItems,
    panelLayout,
    panelMetrics,
    panelTitleText,
    shiftToggleSelection,
    snapSizeFactor,
    visibleItemRange,
    ROW_TEXT,
    type RowContext,
    type RowSeg,
} from '../src/ui/leftSidebar';
import type { PlannerStatusInput } from '../src/ui/screens/expansionPlanner';

const text = (segs: RowSeg[]): string => segs.map((s) => (s.kind === 'text' ? s.text : '[img]')).join(' ');

describe('left sidebar: panels (Main.Part11.cs method_163)', () => {
    it('lists the original panels in order, Potential Colonies only for non-pirates, Idle Ships as our extra', () => {
        expect(itemPanelDefs(false).map((d) => d.title)).toEqual([
            'Colonies',
            'Characters',
            'Space Ports / Construction Yards',
            'Mining Stations',
            'Construction Ships',
            'Exploration Ships',
            'Enemy Targets',
            'Fleets',
            'Military Ships',
            'Potential Colonies',
            'Pirate Missions',
            'Potential Mining Locations',
            'Potential Research Locations',
            'Potential Resort Locations',
            'Special Locations',
            'Idle Ships',
        ]);
        expect(itemPanelDefs(true).some((d) => d.id === 'potentialColonies')).toBe(false);
        expect(itemPanelDefs(false).filter((d) => d.extra).map((d) => d.id)).toEqual(['idleShips']);
        const military = itemPanelDefs(false).find((d) => d.id === 'militaryShips')!;
        expect(military.toggles).toEqual([['Excluding Ships in Fleets', 'Including Ships in Fleets']]);
    });

    it('formats the header, hint and empty text like the source', () => {
        expect(panelTitleText('Construction Ships', 3)).toBe('Construction Ships (3)');
        expect(panelTitleText('Construction Ships', 0)).toBe('Construction Ships');
        expect(noItemsText('Fleets')).toBe('(No Fleets)');
        expect(panelButtonHint('Colonies', false)).toBe('Colonies: click to show items');
        expect(panelButtonHint('Colonies', true)).toBe('Colonies: click to close items');
        expect(fmtMillionsM(10_696_000_000)).toBe('10696M');
    });
});

describe('left sidebar: geometry (method_666 / ItemListPanel.DrawPanel)', () => {
    it('snaps and cycles the size factor (SetSizeFactor / CycleChangeSize)', () => {
        expect([0.5, 1, 1.2, 1.33, 1.5, 3].map(snapSizeFactor)).toEqual([1, 1, 1.33, 1.33, 1.77, 1.77]);
        expect([1, 1.33, 1.77].map(nextSizeFactor)).toEqual([1.33, 1.77, 1]);
        const m = panelMetrics(1.33);
        expect(m).toMatchObject({ titleBar: 23, toggle: 18, item: 54, gap: 2, scrollPerClick: 33, imageSize: 39 });
    });

    it('places the area above the selection panel', () => {
        // A 1080 px window at UI scale 100 %: 1261 original px tall, pnlInfoPanel at 941.
        expect(itemListArea(1261, 941, 1)).toEqual({ x: 8, y: 280, w: 300, h: 480, button: 26, icon: 16 });
        // The 768 px original minimum: 20 px buttons (num / 15), 5 rows of items.
        expect(itemListArea(768, 500, 1)).toEqual({ x: 8, y: 167, w: 300, h: 265, button: 20, icon: 14 });
        expect(buttonColumnTop({ h: 480, button: 26 }, 14)).toBe(58);
        expect(buttonColumnTop({ h: 200, button: 26 }, 14)).toBe(0);
    });

    it('lays out the title, bars and items', () => {
        const m = panelMetrics(1);
        const L = panelLayout(272, 480, m, 0);
        expect(L.title).toEqual({ x: 0, y: 0, w: 271, h: 18 });
        expect(L.scrollUp).toEqual({ x: 0, y: 19, w: 271, h: 14 });
        expect(L.items).toEqual({ x: 0, y: 35, w: 272, h: 429 });
        expect(L.scrollDown).toEqual({ x: 0, y: 465, w: 271, h: 14 });
        expect(L.closeIcon).toEqual({ x: 258, y: 5 });
        expect(L.sizeIcon).toEqual({ x: 240, y: 5 });
        const T = panelLayout(272, 480, m, 1);
        expect(T.toggles).toEqual([{ x: 0, y: 19, w: 271, h: 14 }]);
        expect(T.scrollUp.y).toBe(34);
        expect(T.items.y).toBe(50);
        expect(T.scrollDown.y + T.scrollDown.h).toBe(479);
    });

    it('clamps scrolling and finds the visible rows', () => {
        const m = panelMetrics(1);
        expect(maxScroll(12, m, 480, 0)).toBe(86);
        expect(maxScroll(3, m, 480, 0)).toBe(0);
        expect(clampScroll(500, 12, m, 480, 0)).toBe(86);
        expect(clampScroll(-5, 12, m, 480, 0)).toBe(0);
        expect(visibleItemRange(86, 429, 12, m)).toEqual({ first: 2, last: 11 });
        expect(visibleItemRange(0, 429, 3, m)).toEqual({ first: 0, last: 2 });
    });
});

describe('left sidebar: potential-location colour (ItemListPanel.cs method_1)', () => {
    const base: PlannerStatusInput = {
        forColonization: true,
        inRange: true,
        specialRuins: false,
        superLuxuryKnown: false,
        inOurSystem: false,
        quality: 0.8,
        nearPirateBase: false,
        territoryOk: true,
        canColonizeBecauseAtWar: false,
        colonizationLikeliness: 0,
        techSurvivesStorms: true,
        shipsSurviveStorms: true,
        inStorm: false,
        dangerous: false,
        category: HabitatCategoryType.Planet,
    };
    it('follows the first-match ladder', () => {
        expect(itemHabitatStatus(base, true, false)).toEqual({ color: ROW_TEXT, reason: '' });
        expect(itemHabitatStatus({ ...base, inRange: false, specialRuins: true }, true, false).reason).toBe('Too far from existing colonies');
        expect(itemHabitatStatus({ ...base, inRange: false }, false, true).reason).toBe(''); // range only matters when colonizing
        expect(itemHabitatStatus({ ...base, nearPirateBase: true, inOurSystem: true }, true, false)).toEqual({ color: 0xffff00, reason: 'Pirate base in this system' });
        expect(itemHabitatStatus({ ...base, inOurSystem: true }, true, false)).toEqual({ color: 0x00ff00, reason: 'In our system' });
        expect(itemHabitatStatus({ ...base, inOurSystem: true, quality: 0.3 }, true, false).reason).toBe('Low quality - poor colonization');
        expect(itemHabitatStatus({ ...base, territoryOk: false }, false, true)).toEqual({ color: 0xff0000, reason: "In another empire's system" });
        expect(itemHabitatStatus({ ...base, territoryOk: false }, false, false).reason).toBe('');
        expect(itemHabitatStatus({ ...base, inStorm: true, shipsSurviveStorms: false }, false, true).reason).toBe('Galactic storm');
        expect(itemHabitatStatus({ ...base, dangerous: true }, true, false).reason).toBe('Nearby pirates or space monsters');
    });
});

describe('left sidebar: lists and rows on the seed-1 game', () => {
    let gameData: GameData;
    let galaxy: Galaxy;
    let player: Empire;
    let ctx: RowContext;

    beforeAll(async () => {
        gameData = await loadGameDataFs();
        galaxy = cachedTickGame(gameData).galaxy;
        player = galaxy.playerEmpire!;
        ctx = { galaxy, player, sizeFactor: 1, resource: (id) => gameData.resources.find((r) => r.resourceId === id) ?? null };
    });

    it('binds each panel from the empire lists (PopulateListsOnLefthandSide)', () => {
        expect(panelItems('colonies', galaxy, player)).toEqual(player.colonies.filter((h) => h != null));
        expect(panelItems('constructionShips', galaxy, player)).toEqual((player.constructionShips as BuiltObject[]).filter((b) => b != null && !b.hasBeenDestroyed));
        const mil = panelItems('militaryShips', galaxy, player) as BuiltObject[];
        expect(mil.every((b) => b.role === BuiltObjectRole.Military && b.shipGroup == null)).toBe(true);
        const milAll = panelItems('militaryShips', galaxy, player, { toggles: [1] }) as BuiltObject[];
        expect(milAll.length).toBe(player.builtObjects.filter((b) => b != null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military).length);
        const mining = panelItems('miningStations', galaxy, player) as BuiltObject[];
        expect(mining.every((b) => b.subRole === BuiltObjectSubRole.MiningStation || b.subRole === BuiltObjectSubRole.GasMiningStation)).toBe(true);
        for (const d of itemPanelDefs(false)) expect(Array.isArray(panelItems(d.id, galaxy, player))).toBe(true);
        expect(idleShipsList(player).every((x) => !('role' in x) || x.role !== BuiltObjectRole.Base)).toBe(true);
    });

    it('draws a colony row: pictures, name, (size, system), population / development / approval / GDP', () => {
        const cap = player.capital!;
        const row = itemRowModel(ctx, 'colonies', cap);
        expect(row.textX).toBe(75);
        expect(row.overlays[0].url).toMatch(/capital\.png$/);
        expect(text(row.line1)).toMatch(new RegExp(`^${cap.name} \\(\\d+\\.\\dK, .+ system\\)$`));
        expect(text(row.line2)).toMatch(/^\d+M \[img\] \d+% \[img\] GDP: -?\d+K/);
        expect(row.line2.filter((s) => s.at !== undefined).map((s) => s.at).slice(0, 5)).toEqual([0, 42, 55, 90, 111]);
    });

    it('draws a construction ship row: name, (Construction Ship), mission, fuel', () => {
        const cs = panelItems('constructionShips', galaxy, player)[0] as BuiltObject;
        expect(cs).toBeDefined();
        const row = itemRowModel(ctx, 'constructionShips', cs);
        expect(row.pictures[0]).toMatchObject({ x: 5, y: 5, size: 30, rotate: true });
        expect(row.line1[0]).toMatchObject({ kind: 'text', text: cs.name, font: 'bold' });
        expect(row.line1[1]).toMatchObject({ kind: 'text', text: '(Construction Ship)', font: 'small', gapBefore: 8 });
        const mission = row.line2[0];
        expect(mission).toMatchObject({ kind: 'text', font: 'small', maxWidth: 185 });
        expect(text(row.line2)).toMatch(/\[img\] \d+%/);
        expect(itemClickTarget(cs)).toEqual({ select: cs, centre: { x: cs.xpos, y: cs.ypos } });
    });

    it('draws fleet and military rows with firepower', () => {
        const sg = panelItems('fleets', galaxy, player)[0];
        if (sg) {
            const row = itemRowModel(ctx, 'fleets', sg);
            expect(text(row.line1)).toMatch(/\(\d+ ships\)/);
            expect(row.right.length).toBeGreaterThanOrEqual(1);
        }
        const ship = player.builtObjects.find((b) => b != null && b.role === BuiltObjectRole.Military);
        if (ship) {
            const row = itemRowModel(ctx, 'militaryShips', ship);
            expect(row.line2.some((s) => s.kind === 'img' && /firepower\.png$/.test(s.url))).toBe(true);
            expect(row.line2.some((s) => s.kind === 'text' && s.text === String(ship.firepowerRaw))).toBe(true);
        }
    });

    it('Shift-click toggles the player ships of a multi-selection (method_78 / method_140)', () => {
        const ships = player.builtObjects.filter((b) => b != null && b.role !== BuiltObjectRole.Base).slice(0, 2);
        expect(ships.length).toBe(2);
        const [a, b] = ships;
        expect(shiftToggleSelection(null, a, player)).toEqual([a]);
        expect(shiftToggleSelection(a, b, player)).toEqual([a, b]);
        expect(shiftToggleSelection(a, a, player)).toEqual([]);
        expect(shiftToggleSelection([a, b], b, player)).toEqual([a]);
        const base = player.builtObjects.find((x) => x != null && x.role === BuiltObjectRole.Base) ?? (player.spacePorts[0] as BuiltObject | undefined);
        if (base) expect(shiftToggleSelection([a], base, player)).toBeNull();
    });
});
