import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { HabitatCategoryType, HabitatType, type Habitat } from '../src/sim/types';
import type { GameData } from '../src/sim/data/gameData';
import {
    BAR_FILL,
    BAR_FILL_LOW,
    buildInfoModel,
    builtObjectInfo,
    creatureInfo,
    dropShadowColor,
    engageSuffix,
    fmtK,
    fmtLarge,
    fmtSignedPct,
    habitatDescriptionLine,
    habitatInfo,
    multiShipInfo,
    planetTypeAbbreviation,
    populationIndicator,
    rowText,
    systemInfoModel,
    systemSummaryHabitats,
    WHITE,
    type InfoContext,
    type InfoModel,
    type InfoRow,
} from '../src/ui/selectionInfo';
import { selectionButtonIcon } from '../src/ui/orderMenu';
import { ShipAction, ShipActionType } from '../src/sim/player/shipAction';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { SELECTION_FRAME, SELECTION_FRAME_BASE_SCALE, selectionFrameScale } from '../src/ui/hud';

let gameData: GameData;
let galaxy: Galaxy;
let player: Empire;
let ctx: InfoContext;

beforeAll(async () => {
    gameData = await loadGameDataFs();
    galaxy = cachedTickGame(gameData).galaxy;
    player = galaxy.playerEmpire!;
    ctx = {
        galaxy,
        player,
        resource: (id) => gameData.resources.find((r) => r.resourceId === id) ?? null,
    };
});

const labelled = (m: InfoModel, label: string): Extract<InfoRow, { kind: 'row' }> | undefined =>
    m.rows.find((r): r is Extract<InfoRow, { kind: 'row' }> => r.kind === 'row' && r.label === label);
const bar = (m: InfoModel, label: string): Extract<InfoRow, { kind: 'bar' }> | undefined =>
    m.rows.find((r): r is Extract<InfoRow, { kind: 'bar' }> => r.kind === 'bar' && r.label === label);
const text = (r: { segs: { text?: string }[] } | undefined): string => (r?.segs ?? []).map((s) => s.text ?? '').join('');

describe('selectionInfo formatting (InfoPanel / .NET formats)', () => {
    it('formats like the original', () => {
        expect(fmtK(1094000)).toBe('1094K');
        expect(fmtK(198400)).toBe('198K');
        expect(fmtLarge(999999)).toBe('999999');
        expect(fmtLarge(29400000)).toBe('29M');
        expect(fmtSignedPct(0.31)).toBe('+31%');
        expect(fmtSignedPct(-0.05)).toBe('-5%');
        expect(fmtSignedPct(0)).toBe('0%');
        expect(engageSuffix(0)).toBe(' (Engage when attacked)');
        expect(engageSuffix(4000000)).toBe(' (Engage nearby targets)');
        expect(engageSuffix(2304000000)).toBe(' (Engage system targets)');
        expect(engageSuffix(9e18)).toBe(' (Engage detected targets)');
    });
    it('DrawPopulationIndicator thresholds', () => {
        expect(populationIndicator(0, 0)).toEqual({ pop: 0, dev: 0 });
        expect(populationIndicator(10_000_000, 10)).toEqual({ pop: 1, dev: 1 });
        expect(populationIndicator(150_000_000, 50)).toEqual({ pop: 3, dev: 3 });
        expect(populationIndicator(3_000_000_000, 90)).toEqual({ pop: 5, dev: 5 });
    });
    it('drop shadow contrasts with the text colour', () => {
        expect(dropShadowColor(WHITE)).toBe(0x000000);
        expect(dropShadowColor(0x000020)).toBe(0xffffff);
        expect(dropShadowColor(0x606060)).toBe(0x000000); // _UnknownColor
    });
    it('planet type abbreviations (PlanetType Abbreviation …)', () => {
        const h = (type: HabitatType, category: HabitatCategoryType): Habitat => ({ type, category }) as Habitat;
        expect(planetTypeAbbreviation(h(HabitatType.Continental, HabitatCategoryType.Planet))).toBe('Cont');
        expect(planetTypeAbbreviation(h(HabitatType.BarrenRock, HabitatCategoryType.Moon))).toBe('Rock');
        expect(planetTypeAbbreviation(h(HabitatType.GasGiant, HabitatCategoryType.Planet))).toBe('Gas');
        expect(planetTypeAbbreviation(h(HabitatType.BarrenRock, HabitatCategoryType.Asteroid))).toBe('Ast');
    });
});

describe('selectionInfo models (harness game)', () => {
    it('a player ship: BaconInfoPanel.DrawBuiltObject rows and bar graphs', () => {
        const ship = player.builtObjects.find((b) => b.role !== BuiltObjectRole.Base && b.unbuiltComponentCount === 0)!;
        const m = builtObjectInfo(ctx, ship);
        expect(m.title[0].text).toBe(ship.name);
        expect(m.title[0].color).toBe(player.mainColor);
        expect(m.corner?.flagOf).toBe(player);
        expect(m.rows.some((r) => r.kind === 'band')).toBe(true);
        expect(text(labelled(m, 'Type'))).toMatch(/\((STATE|PRIVATE)\)$/);
        expect(text(labelled(m, 'Empire'))).toBe(player.name);
        expect(text(labelled(m, 'Design'))).toBe(`${ship.design!.name} (size ${ship.size})`);
        const fuel = bar(m, 'Fuel')!;
        expect(fuel.max).toBe(Math.trunc(ship.fuelCapacity));
        expect(fuel.current).toBe(Math.max(0, Math.trunc(ship.currentFuel)));
        expect(fuel.fill).toBe(ship.currentFuel < Math.trunc(ship.fuelCapacity / 3) ? BAR_FILL_LOW : BAR_FILL);
        expect(bar(m, 'Energy')).toBeDefined();
        expect(bar(m, 'Shields')).toBeDefined();
        expect(bar(m, 'Speed')!.max).toBe(Math.trunc(ship.topSpeed));
        expect(labelled(m, 'Weapons')).toBeDefined();
        expect(m.automated).toBe(ship.isAutoControlled);
    });

    it('a base has no Speed bar and no mission line', () => {
        const base = player.builtObjects.find((b) => b.role === BuiltObjectRole.Base);
        if (base === undefined) return;
        const m = builtObjectInfo(ctx, base);
        expect(bar(m, 'Speed')).toBeUndefined();
        expect(labelled(m, 'Fleet')).toBeUndefined();
        expect(text(labelled(m, 'Type'))).toContain(base.owner !== null ? '(STATE)' : '(PRIVATE)');
    });

    it('another empire\'s ship hides its fuel and fighters as (Unknown)', () => {
        const other = galaxy.empires.find((e) => e !== player && e !== galaxy.independentEmpire && !player.empiresViewable.includes(e) && e.builtObjects.length > 0);
        if (other === undefined) return;
        const m = builtObjectInfo(ctx, other.builtObjects[0]);
        expect(text(labelled(m, 'Fuel'))).toBe('(Unknown)');
        expect(m.automated).toBe(false);
    });

    it('the player capital: DrawHabitat colony rows', () => {
        const cap = player.capital!;
        const m = habitatInfo(ctx, cap);
        expect(m.title.map((s) => s.text).join(' ')).toContain(cap.name);
        expect(m.title.some((s) => s.text === `(${player.name})`)).toBe(true);
        expect(m.rows.some((r) => r.kind === 'line' && rowText(r) === habitatDescriptionLine(cap))).toBe(true);
        for (const l of ['System', 'Populace', 'Resource', 'Value', 'GDP', 'Tax', 'Facilities']) expect(labelled(m, l), l).toBeDefined();
        expect(text(labelled(m, 'GDP'))).toMatch(/of empire GDP\) \(\d+% corruption\)$/);
        expect(text(labelled(m, 'Tax'))).toMatch(/^\d+%/);
        expect(labelled(m, 'Colonize')).toBeUndefined();
    });

    it('an unowned planet gets a Colonize row and no Value / GDP', () => {
        const sys = galaxy.systems[player.capital!.systemIndex];
        const p = sys.habitats.find((h) => h.empire === null && (h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon))!;
        const m = habitatInfo(ctx, p);
        expect(labelled(m, 'Colonize')).toBeDefined();
        expect(labelled(m, 'Value')).toBeUndefined();
        expect(labelled(m, 'GDP')).toBeUndefined();
        expect(m.corner).toBeNull();
    });

    it('the capital system: DrawSystemInfo owner / resources / colonies summary', () => {
        const sys = galaxy.systems[player.capital!.systemIndex];
        const m = systemInfoModel(ctx, sys);
        expect(m.title[0].text).toBe(`${sys.systemStar.name} System`);
        const owner = labelled(m, 'Owner')!;
        expect(owner.segs[0].flagOf).toBe(player);
        expect(text(owner)).toContain(player.name);
        expect(labelled(m, 'Resource')).toBeDefined();
        const summary = m.rows.find((r) => r.kind === 'colonies');
        expect(summary).toBeDefined();
        if (summary?.kind === 'colonies') {
            expect(summary.items.map((i) => i.habitat)).toEqual(systemSummaryHabitats(galaxy, sys.systemStar).slice(0, summary.items.length));
            expect(summary.items[0].habitat).toBe(player.capital);
            expect(summary.items[0].flagOf).toBe(player);
        }
        // The dispatcher: a star picked as a system vs. as itself.
        expect(buildInfoModel(ctx, { habitat: sys.systemStar, system: sys, systemInfo: true }).title[0].text).toBe(`${sys.systemStar.name} System`);
        expect(buildInfoModel(ctx, { habitat: sys.systemStar, system: sys }).rows.some((r) => r.kind === 'row' && r.label === 'ENERGY')).toBe(true);
    });

    it('a multi-selection: "(Multiple Ships)" with the summary and a ship grid', () => {
        const ships = player.builtObjects.filter((b) => b.role !== BuiltObjectRole.Base).slice(0, 3);
        const m = multiShipInfo(ctx, ships);
        expect(m.title[0].text).toBe('(Multiple Ships)');
        expect(rowText(m.rows.find((r) => r.kind === 'line')!)).toMatch(/^3 ships, \d+ firepower, \d+ boarding strength, \d+ troops \(\d+ strength\)$/);
        const grid = m.rows.find((r) => r.kind === 'grid');
        expect(grid?.kind === 'grid' && grid.cells.map((c) => c.ship)).toEqual(ships);
    });

    it('a creature: Health / Speed bars', () => {
        const c = galaxy.creatures?.[0];
        if (c === undefined) return;
        const m = creatureInfo(ctx, c, null);
        expect(m.title[0].text).toBe(c.name);
        expect(bar(m, 'Health')!.max).toBe(c.damageKillThreshold);
        expect(bar(m, 'Speed')!.max).toBe(c.movementSpeed);
    });

    it('builders do not touch the galaxy random sequence', () => {
        const before = JSON.stringify(galaxy.rnd);
        const sys = galaxy.systems[player.capital!.systemIndex];
        for (const h of sys.habitats) habitatInfo(ctx, h);
        systemInfoModel(ctx, sys);
        for (const b of player.builtObjects) builtObjectInfo(ctx, b);
        expect(JSON.stringify(galaxy.rnd)).toBe(before);
    });
});

describe('selection action button images (Main.Part3.cs method_588)', () => {
    const none = (): null => null;
    it('maps actions to the chrome bitmaps', () => {
        const b = (action: ShipAction) => ({ action, enabled: true, hint: '', style: '' as const, count: 0 });
        expect(selectionButtonIcon(b(ShipAction.forMission(BuiltObjectMissionType.Hold, null)), null, none, none)?.url).toMatch(/chrome\/stop\.png$/);
        expect(selectionButtonIcon(b(ShipAction.forMission(BuiltObjectMissionType.Escape, null)), null, none, none)?.url).toMatch(/chrome\/emergency\.png$/);
        expect(selectionButtonIcon(b(ShipAction.forMission(BuiltObjectMissionType.Refuel, null)), null, none, none)?.url).toMatch(/chrome\/refuel\.png$/);
        expect(selectionButtonIcon(b(ShipAction.forAction(ShipActionType.AutomateShip, null)), null, none, none)?.url).toMatch(/chrome\/automate\.png$/);
        expect(selectionButtonIcon(b(ShipAction.forAction(ShipActionType.UnautomateShip, null)), null, none, none)?.url).toMatch(/chrome\/unautomate\.png$/);
        expect(selectionButtonIcon({ action: null, enabled: false, hint: '', style: '', count: 0 }, null, none, none)).toBeNull();
    });
    it('a build button shows the design\'s ship rotated 270°', () => {
        const design = player.designs.find((d) => d.subRole === BuiltObjectSubRole.ConstructionShip) ?? player.designs[0];
        const a = ShipAction.forMissionAt(BuiltObjectMissionType.Build, null, { x: 0, y: 0 }, design);
        const icon = selectionButtonIcon({ action: a, enabled: true, hint: '', style: 'build', count: 0 }, null, none, (d) => `ship-${d.pictureRef}`);
        expect(icon).toEqual({ url: `ship-${design.pictureRef}`, rotate: 270 });
    });
});

describe('selection frame scale', () => {
    it('is the original frame at ~683 px wide at 1080p and scales with the window height', () => {
        expect(Math.round(SELECTION_FRAME.w * selectionFrameScale(1080, 1, false))).toBe(683);
        expect(Math.round(SELECTION_FRAME.h * selectionFrameScale(1080, 1, false))).toBe(531);
        expect(selectionFrameScale(2160, 1, false)).toBeCloseTo(SELECTION_FRAME_BASE_SCALE * 2);
        expect(selectionFrameScale(1080, 1.25, false)).toBeCloseTo(SELECTION_FRAME_BASE_SCALE * 1.25);
        expect(selectionFrameScale(1080, 1, true)).toBeCloseTo(SELECTION_FRAME_BASE_SCALE * 0.75);
    });
});
