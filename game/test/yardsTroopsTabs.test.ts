// Construction Yards / Ships and Bases detail tabs (builtObjectDataTabs.ts): the Troops tab's icon view
// (CharacterTroopListIconView.cs BindData) and the ship troop loadout group (Main.Part11.cs 4433 method_179 - method_181,
// chkUseTroopLoadouts_CheckedChanged / numTroopLoadout*_ValueChanged → the journaled 'setShipTroopLoadout' op), the
// Set Fleet combo (Main.Part11.cs 4630 method_182, Main.Part6.cs 2898 cmbBuiltObjectSetFleet_SelectedIndexChanged), the
// manufacturing-plant grids (Main.Part11.cs 3366 method_169: ManufacturerListView.cs / ComponentListView.cs BindData),
// the cargo construction-resource shortage label and the tab captions (ctlBuiltObjectList_SelectionChanged).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Character } from '../src/sim/characters';
import { Troop, TroopType } from '../src/sim/cargo';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { flushPlayerCommands, issuePlayerCommand, pendingPlayerCommands } from '../src/sim/player/playerCommands';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { shipTroopLoadoutSize } from '../src/sim/player/fleetOps';
import { resolveComponentCategoryAbbreviation } from '../src/sim/player/designEditor';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import type { ManufacturingQueue } from '../src/sim/manufacturingQueue';
import { componentDefinitionsStatic } from '../src/sim/designGeneration';
import { COMMAND_FAILURE } from '../src/simworker/commandFailure';
import {
    builtObjectTabLabels,
    builtObjectTroopIconItems,
    characterTroopIconItems,
    componentWaitRows,
    constructionResourceShortageText,
    dataTabContentKey,
    manufacturerRows,
    setFleetChoice,
    setFleetIndexAfter,
    setFleetItems,
    shipTroopLoadout,
    shipTroopLoadoutOn,
    shipTroopLoadoutSpin,
    shipTroopLoadoutView,
    siteManufacturingQueue,
    troopLoadoutTotalText,
} from '../src/ui/screens/builtObjectDataTabs';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const L = (infantry: number, armored = 0, artillery = 0, specialForces = 0) => ({ infantry, armored, artillery, specialForces });

describe('ship troop loadout (method_179 - method_181)', () => {
    it('method_180 weights: Infantry / Special Forces 100, Armored 200, Artillery 400', () => {
        expect(shipTroopLoadoutSize(L(1, 1, 1, 1))).toBe(800);
        expect(shipTroopLoadoutSize(L(3))).toBe(300);
    });

    it('ticking the box: (byte)(TroopCapacity / 100) Infantry', () => {
        expect(shipTroopLoadoutOn(650)).toEqual(L(6));
        expect(shipTroopLoadoutOn(0)).toEqual(L(0));
        expect(shipTroopLoadoutOn(99)).toEqual(L(0));
    });

    it('a spinner over TroopCapacity backs off by ceil(excess / 100) units, then stores', () => {
        // Capacity 600: 4 infantry + 1 armored = 600 fits.
        expect(shipTroopLoadoutSpin(L(4), 'armored', 1, 600)).toEqual(L(4, 1));
        // 4 infantry + 2 armored = 800 > 600: excess 200 → 2 units off armored → 0.
        expect(shipTroopLoadoutSpin(L(4), 'armored', 2, 600)).toEqual(L(4, 0));
        // 1 artillery = 400 + 4 inf = 800 > 700: excess 100 → 1 unit off → 0 (stored).
        expect(shipTroopLoadoutSpin(L(4), 'artillery', 1, 700)).toEqual(L(4, 0, 0));
        // Infantry raised to 7 with capacity 600: excess 100 → 6.
        expect(shipTroopLoadoutSpin(L(4), 'infantry', 7, 600)).toEqual(L(6));
        // The same value: no ValueChanged.
        expect(shipTroopLoadoutSpin(L(4), 'infantry', 4, 600)).toBeNull();
        // Others already over capacity: the back-off cannot go below 0 → no change, nothing stored.
        expect(shipTroopLoadoutSpin(L(9), 'armored', 1, 500)).toBeNull();
        expect(shipTroopLoadoutSpin(L(9, 1), 'specialForces', 1, 500)).toBeNull();
        // 10 infantry + 1 artillery = 1400 > 1000: 4 units off the artillery spinner → 0 (stored).
        expect(shipTroopLoadoutSpin(L(10), 'artillery', 1, 1000)).toEqual(L(10, 0, 0));
        // NumericUpDown range 0..100.
        expect(shipTroopLoadoutSpin(L(0), 'infantry', 500, 1_000_000)).toEqual(L(100));
        expect(shipTroopLoadoutSpin(L(2), 'infantry', -3, 600)).toEqual(L(0));
    });

    it('the group: unticked for 255s, "{total} / {capacity}", the fleet override note', () => {
        const ship = { troopLoadoutInfantry: 255, troopLoadoutArmored: 255, troopLoadoutArtillery: 255, troopLoadoutSpecialForces: 255, troopCapacity: 800, shipGroup: null } as unknown as BuiltObject;
        expect(shipTroopLoadout(ship)).toBeNull();
        expect(shipTroopLoadoutView(ship, null)).toEqual({ checked: false, values: L(0), total: '0 / 800', fleetNote: '' });
        const inFleet = { ...ship, troopLoadoutInfantry: 2, troopLoadoutArmored: 1, troopLoadoutArtillery: 0, troopLoadoutSpecialForces: 0, shipGroup: {} } as unknown as BuiltObject;
        expect(shipTroopLoadout(inFleet)).toEqual(L(2, 1));
        const v = shipTroopLoadoutView(inFleet, shipTroopLoadout(inFleet));
        expect(v.checked).toBe(true);
        expect(v.total).toBe('400 / 800');
        expect(v.fleetNote).toMatch(/fleet/i);
        expect(troopLoadoutTotalText(L(1, 0, 1), 1200)).toBe('500 / 1200');
        expect(shipTroopLoadoutView(null, null)).toEqual({ checked: false, values: L(0), total: '', fleetNote: '' });
    });

    it("'setShipTroopLoadout' is applied at the frame boundary, journaled, and refuses other empires' ships and over-capacity loadouts", () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        const ship = p.builtObjects.find((b) => b != null && !b.hasBeenDestroyed && b.role !== BuiltObjectRole.Base)!;
        expect(ship).toBeTruthy();
        ship.troopCapacity = 1000;
        let r: boolean | null = null;
        issuePlayerCommand(g.galaxy, p, 'setShipTroopLoadout', [ship, shipTroopLoadoutOn(ship.troopCapacity)], (v) => (r = v));
        expect(pendingPlayerCommands(g.galaxy)).toBe(1);
        expect(ship.troopLoadoutInfantry).not.toBe(10);
        flushPlayerCommands(g.galaxy);
        expect(r).toBe(true);
        expect(shipTroopLoadout(ship)).toEqual(L(10));
        expect(commandLog(g.galaxy).some((e) => e.source === 'player' && (e as PlayerLogEntry).op === 'setShipTroopLoadout')).toBe(true);
        // A spinner step, then over capacity (refused, unchanged).
        issuePlayerCommand(g.galaxy, p, 'setShipTroopLoadout', [ship, shipTroopLoadoutSpin(L(10), 'infantry', 6, 1000)!]);
        flushPlayerCommands(g.galaxy);
        expect(shipTroopLoadout(ship)).toEqual(L(6));
        issuePlayerCommand(g.galaxy, p, 'setShipTroopLoadout', [ship, shipTroopLoadoutSpin(L(6), 'artillery', 1, 1000)!]);
        flushPlayerCommands(g.galaxy);
        expect(shipTroopLoadout(ship)).toEqual(L(6, 0, 1));
        issuePlayerCommand(g.galaxy, p, 'setShipTroopLoadout', [ship, L(6, 0, 2)], (v) => (r = v));
        flushPlayerCommands(g.galaxy);
        expect(r).toBe(false);
        expect(shipTroopLoadout(ship)).toEqual(L(6, 0, 1));
        // Unticked: 255 each.
        issuePlayerCommand(g.galaxy, p, 'setShipTroopLoadout', [ship, null]);
        flushPlayerCommands(g.galaxy);
        expect(shipTroopLoadout(ship)).toBeNull();
        expect(ship.troopLoadoutArtillery).toBe(255);
        // Another empire's ship.
        const foreign = g.galaxy.empires.find((e) => e !== p && e.builtObjects.length > 0)!.builtObjects.find((b) => b != null)!;
        const before = shipTroopLoadout(foreign);
        issuePlayerCommand(g.galaxy, p, 'setShipTroopLoadout', [foreign, L(0)], (v) => (r = v));
        flushPlayerCommands(g.galaxy);
        expect(r).toBe(false);
        expect(shipTroopLoadout(foreign)).toEqual(before);
        expect(COMMAND_FAILURE.setShipTroopLoadout('gone', [ship, null])).toBe(false);
    }, 300000);
});

describe('Troops tab icon view (CharacterTroopListIconView.BindData)', () => {
    it('order and texts: characters, recruits (faded), troops, invaders; garrison / foreign markers', () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        const own = (p.characters ?? []).filter((c) => c != null) as Character[];
        const otherEmpire = g.galaxy.empires.find((e) => e !== p && (e.characters ?? []).length > 0)!;
        const foreign = (otherEmpire.characters ?? [])[0] as Character;
        expect(own.length).toBeGreaterThan(0);
        expect(foreign).toBeTruthy();
        const tr = (name: string, garrisoned = false): Troop => {
            const t = new Troop(name, TroopType.Infantry, 50, 80, 100, 1, null, null);
            t.garrisoned = garrisoned;
            return t;
        };
        const items = characterTroopIconItems(p, [own[0], foreign], [foreign], [tr('1st', true), tr('2nd')], [tr('Recruit')], [tr('Enemy')]);
        expect(items.map((i) => i.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(items[0].text).toBe(own[0].name);
        expect(items[0].character).toBe(own[0]);
        expect(items[0].foreignColor).toBeNull();
        expect(items[0].tooltip.split('\n')[1]).not.toBe(p.name);
        // Another empire's character: its MainColor (bold) and its empire's name on the tooltip's second line.
        expect(items[1].foreignColor).toBe(otherEmpire.mainColor);
        expect(items[1].tooltip.split('\n')[1]).toBe(otherEmpire.name);
        expect(items[2].text).toBe('Recruiting - Recruit (, 50, 80)');
        expect(items[2].faded).toBe(true);
        // "* " for a garrisoned troop, then "(Strength, OverallAttack, OverallDefend)" (no race: no strength level).
        expect(items[3].text).toBe('* 1st (, 50, 80)');
        expect(items[3].garrisoned).toBe(true);
        expect(items[3].tooltip.split('\n')).toEqual(['Readiness: 1', 'Attack Strength: 50', 'Overall Attack Strength: 50', 'Defend Strength: 80', 'Overall Defend Strength: 80', 'GARRISONED']);
        expect(items[4].text).toBe('2nd (, 50, 80)');
        expect(items[4].faded).toBe(false);
        expect(items[5].text).toBe('INVADING - Enemy (, 50, 80)');
        expect(items[6].text).toBe(`INVADING - ${foreign.name}`);
    }, 300000);

    it('a seed-1 ship / colony binds its own troops and characters (read only)', () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        const colony = p.colonies[0];
        const items = builtObjectTroopIconItems(colony);
        const troops = colony.troops?.items ?? [];
        expect(items.filter((i) => i.troop !== null).map((i) => i.troop)).toEqual(troops);
        for (const i of items) if (i.troop !== null) expect(i.text).toContain(i.troop.name);
        expect(builtObjectTroopIconItems(null)).toEqual([]);
        const key = dataTabContentKey('troops', colony);
        expect(dataTabContentKey('troops', colony)).toBe(key);
    }, 300000);
});

describe('tab captions (ctlBuiltObjectList_SelectionChanged)', () => {
    it('"Troops & Characters" counts troops and characters', () => {
        expect(builtObjectTabLabels(null).troops).toBe('Troops & Characters');
        const o = { cargo: null, constructionQueue: null, dockingBays: null, troops: { items: [{}, {}] }, characters: [{}], weapons: [], damagedComponentCount: 0 } as unknown as BuiltObject;
        expect(builtObjectTabLabels(o).troops).toBe('Troops & Characters (3)');
    });
});

describe('Set Fleet combo (method_182 / cmbBuiltObjectSetFleet_SelectedIndexChanged)', () => {
    it('items, choices and the item shown after the order', () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        const items = setFleetItems(p);
        const fleets = empireShipGroups(p).filter((x) => x != null);
        expect(items.slice(0, 3)).toEqual(['Set Fleet...', '(None)', '(New Fleet)']);
        expect(items.slice(3)).toEqual(fleets.map((f) => f.name ?? ''));
        expect(setFleetChoice(p, 'Set Fleet...')).toEqual({ kind: 'nothing' });
        expect(setFleetChoice(p, '(New Fleet)')).toEqual({ kind: 'order', target: 'new' });
        expect(setFleetChoice(p, '(None)')).toEqual({ kind: 'order', target: null });
        if (fleets.length > 0) {
            expect(setFleetChoice(p, fleets[0].name ?? '')).toEqual({ kind: 'order', target: fleets[0] });
            expect(setFleetIndexAfter(items, fleets[0], fleets[0])).toBe(3);
        }
        expect(setFleetIndexAfter(items, 'new', null)).toBe(items.length - 1);
        expect(setFleetIndexAfter(items, null, null)).toBe(0);
    }, 300000);

    it("picking '(New Fleet)' for a selected warship forms a fleet through 'setShipsFleet'", () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        const ship = p.builtObjects.find((b) => b != null && b.role === BuiltObjectRole.Military && b.shipGroup === null);
        if (ship === undefined) return;
        const choice = setFleetChoice(p, '(New Fleet)');
        expect(choice.kind).toBe('order');
        if (choice.kind !== 'order') return;
        let joined: unknown = undefined;
        issuePlayerCommand(g.galaxy, p, 'setShipsFleet', [[ship], choice.target], (r) => (joined = r));
        flushPlayerCommands(g.galaxy);
        expect(ship.shipGroup).toBe(joined);
        expect(setFleetItems(p)).toContain((joined as { name: string }).name);
        // '(None)': leave it again.
        const none = setFleetChoice(p, '(None)');
        if (none.kind !== 'order') throw new Error('order expected');
        issuePlayerCommand(g.galaxy, p, 'setShipsFleet', [[ship], none.target]);
        flushPlayerCommands(g.galaxy);
        expect(ship.shipGroup).toBeNull();
    }, 300000);
});

describe('manufacturing-plant grids (method_169)', () => {
    it('ManufacturerListView / ComponentListView rows', () => {
        const comp = (id: number, name: string, size: number, industry = 1, category = ComponentCategoryType.WeaponBeam) => ({ componentId: id, name, size, industry, category, pictureRef: id + 100 });
        const parent = comp(62, 'Weapons Plant', 10, 1, ComponentCategoryType.Manufacturer);
        const beam = comp(5, 'Maxos Blaster', 8);
        const byId = (id: number) => (id === 62 ? parent : null) as never;
        const rows = manufacturerRows(
            [
                { component: beam, progress: 2, manufacturingSpeed: 24000, industry: 1, parentBuiltObjectComponentIndex: -1, parentBuiltObjectComponentId: 62 },
                { component: null, progress: 0, manufacturingSpeed: 12, industry: 2, parentBuiltObjectComponentIndex: 3, parentBuiltObjectComponentId: -1 },
            ] as never,
            byId,
        );
        expect(rows[0]).toMatchObject({ index: 0, parentPictureRef: 162, parentTooltip: 'Weapons Plant(Weapon)', componentPictureRef: 105, componentName: 'Maxos Blaster', progressText: '25%', speed: 24000 });
        expect(rows[1]).toMatchObject({ index: 1, parentPictureRef: null, componentPictureRef: null, componentName: '', progress: 0, progressText: '0', speed: 12 });
        const wait = componentWaitRows([beam, parent] as never);
        expect(wait.map((r) => [r.index, r.name, r.category, r.size, r.tech])).toEqual([
            [0, 'Maxos Blaster', 'WBM', 8, '1K'],
            [1, 'Weapons Plant', 'MNF', 10, '1K'],
        ]);
        expect(manufacturerRows(null, byId)).toEqual([]);
        expect(componentWaitRows(null)).toEqual([]);
        expect(resolveComponentCategoryAbbreviation(ComponentCategoryType.ShieldRecharge)).toBe('SHR');
        expect(resolveComponentCategoryAbbreviation(ComponentCategoryType.Undefined)).toBe('');
    });

    it('bound to the player\'s ship / base queue only (a colony and other empires bind none)', () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        const base = p.builtObjects.find((b): b is BuiltObject => b != null && b.manufacturingQueue != null)!;
        expect(base).toBeTruthy();
        const mq = base.manufacturingQueue as ManufacturingQueue;
        expect(siteManufacturingQueue(base, p)).toBe(mq);
        expect(siteManufacturingQueue(p.colonies[0], p)).toBeNull();
        expect(siteManufacturingQueue(null, p)).toBeNull();
        const other = g.galaxy.empires.find((e) => e !== p && e.builtObjects.some((b) => b != null && b.manufacturingQueue != null))!;
        expect(siteManufacturingQueue(other.builtObjects.find((b) => b != null && b.manufacturingQueue != null)!, p)).toBeNull();
        const defs = componentDefinitionsStatic(g.galaxy);
        const rows = manufacturerRows(mq.manufacturers, (id) => defs.find((d) => d.componentId === id) ?? null);
        expect(rows.length).toBe(mq.manufacturers?.length ?? 0);
        for (const r of rows) expect(r.parentTooltip).toMatch(/\((Weapon|Energy|HighTech)\)$/);
    }, 300000);
});

describe('cargo: lblBuiltObjectCargoConstructionResourceShortage', () => {
    it('lists the queue\'s DeficientResources in "Construction Resource Shortage Message"', () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        const base = p.builtObjects.find((b): b is BuiltObject => b != null && b.manufacturingQueue != null)!;
        const mq = base.manufacturingQueue as ManufacturingQueue;
        mq.deficientResources.clear();
        expect(constructionResourceShortageText(g.galaxy, base)).toBe('');
        const [a, b] = g.galaxy.resources;
        mq.deficientResources.checkAddResource(a.resourceId, 0);
        mq.deficientResources.checkAddResource(b.resourceId, 0);
        const t = constructionResourceShortageText(g.galaxy, base);
        expect(t).toContain(base.name);
        expect(t).toContain(`${a.name}, ${b.name}`);
        expect(constructionResourceShortageText(g.galaxy, p.colonies[0])).toBe('');
        expect(constructionResourceShortageText(g.galaxy, null)).toBe('');
        const k1 = dataTabContentKey('cargo', base);
        mq.deficientResources.clear();
        expect(dataTabContentKey('cargo', base)).not.toBe(k1);
    }, 300000);
});
