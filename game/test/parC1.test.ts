// Parity batch C1 (docs/parity/ui-render.md #1, #4, #9, #10, #24): control groups, the display-type cycle (D), the
// panel-visibility cycle (T), H → the full message history, and the Ground Report ("[" / the Troops row).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { inThread, inWorker } from './helpers/simWorkerSides';
import type { GameData } from '../src/sim/data/gameData';
import type { Habitat } from '../src/sim/types';
import { HabitatType } from '../src/sim/types';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObject as BuiltObjectClass } from '../src/sim/builtObject';
import { galaxyToJSON, galaxyFromJSON } from '../src/sim/save/galaxySave';
import { commandLog } from '../src/sim/player/commandLog';
import { issuePlayerCommand, flushPlayerCommands, scheduleCommandLog, runScheduledUntil } from '../src/sim/player/playerCommands';
import { controlGroup, setControlGroup } from '../src/sim/player/controlGroups';
import { commandFailureValue } from '../src/simworker/commandFailure';
import { controlGroupActionArgs, dispatchKey, eventBindingKey, findBinding, KEY_BINDINGS, setControlGroupHandler, type ControlGroupKeyKind } from '../src/ui/keyboard';
import { createControlGroupKeys, controlGroupFocusPoint, selectedGameObject } from '../src/ui/controlGroups';
import { cycleMainViewDisplayType, mainViewDisplayType, nextMainViewDisplayType, setMainViewDisplayType, showsBattleBars, showsMapIndicators } from '../src/render/mainViewDisplay';
import { hudElementShown, nextPanelVisibility, cyclePanelVisibility, panelVisibility, resetPanelVisibility } from '../src/ui/panelVisibility';
import { HistoryFilter, resolveHistoryOpenFilter } from '../src/ui/screens/galacticHistory';
import {
    buildGroundReport,
    formatSignedPercent,
    formatThousandsK,
    groundReportColumns,
    groundReportKeyColony,
    groundReportLandscape,
    groundReportWindowSize,
    hotspotAt,
    nextGroundReportSize,
    reviewXCoords,
} from '../src/ui/screens/groundReportModel';
import { TroopList } from '../src/sim/cargo';
import type { Selection } from '../src/ui/hud';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 1_800_000);

const ev = (key: string, code: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => ({ key, code, ctrlKey: !!mods.ctrl, altKey: false, shiftKey: !!mods.shift, target: null });

describe('keyboard: the Expanded Main_KeyUp keys (GameHotKeysMappingFile.json defaults)', () => {
    it('0-9 select, Ctrl+0-9 set, Shift+0-9 select with focus (by the physical digit key)', () => {
        const seen: [ControlGroupKeyKind, number][] = [];
        setControlGroupHandler((k, i) => seen.push([k, i]));
        expect(dispatchKey(ev('3', 'Digit3'), {})).toBe('selectControlGroup3');
        expect(dispatchKey(ev('0', 'Digit0', { ctrl: true }), {})).toBe('setControlGroup0');
        // Shift+1 is "!" in KeyboardEvent.key.
        expect(dispatchKey(ev('!', 'Digit1', { shift: true }), {})).toBe('selectControlGroupWithFocus1');
        expect(seen).toEqual([['select', 3], ['set', 0], ['selectWithFocus', 1]]);
        setControlGroupHandler(null);
        expect(controlGroupActionArgs('setControlGroup9')).toEqual({ kind: 'set', index: 9 });
        expect(controlGroupActionArgs('cycleFleets')).toBeNull();
        expect(eventBindingKey({ key: 'ü', code: 'BracketLeft' })).toBe('[');
    });

    it('D cycles the display type, T the panels, [ opens the Ground Report, K the advisor chat, H the message history', () => {
        const at = (k: string) => findBinding(k, { ctrl: false, alt: false, shift: false })?.action;
        expect(at('D')).toBe('cycleMainDisplayTypes');
        expect(at('T')).toBe('cyclePanelVisibility');
        expect(at('[')).toBe('groundInvasionStatus');
        expect(at('K')).toBe('advisorChat');
        expect(at('H')).toBe('messageHistoryScreen');
        // The overlay shows one 0-9 row per variant.
        const shown = KEY_BINDINGS.filter((b) => !b.overlayHidden && /ControlGroup/.test(b.action));
        expect(shown.map((b) => [b.overlayKey, b.modifiers.ctrl, b.modifiers.shift])).toEqual([['0-9', false, false], ['0-9', true, false], ['0-9', false, true]]);
    });

    it('D and T step their states (dispatchKey)', () => {
        setMainViewDisplayType(0);
        dispatchKey(ev('d', 'KeyD'), {});
        expect(mainViewDisplayType()).toBe(1);
        resetPanelVisibility();
        dispatchKey(ev('t', 'KeyT'), {});
        expect(panelVisibility()).toBe('map');
        resetPanelVisibility();
        setMainViewDisplayType(0);
    });
});

describe('display type (Main.int_34, btnMainViewDisplayToggle_Click)', () => {
    it('cycles 0 → 1 → 2 → 0 and gates bars (< 1) and indicators (< 2)', () => {
        expect([0, 1, 2, 7].map(nextMainViewDisplayType)).toEqual([1, 2, 0, 0]);
        setMainViewDisplayType(0);
        expect([cycleMainViewDisplayType(), cycleMainViewDisplayType(), cycleMainViewDisplayType()]).toEqual([1, 2, 0]);
        expect([0, 1, 2].map((t) => [showsBattleBars(t), showsMapIndicators(t)])).toEqual([[true, true], [false, true], [false, false]]);
    });
});

describe('panel visibility (CyclePanelVisibility, method_472 / method_473)', () => {
    it('all → system-map corner only → none → all', () => {
        expect(nextPanelVisibility('all')).toBe('map');
        expect(nextPanelVisibility('map')).toBe('none');
        expect(nextPanelVisibility('none')).toBe('all');
        resetPanelVisibility();
        expect([cyclePanelVisibility(), cyclePanelVisibility(), cyclePanelVisibility()]).toEqual(['map', 'none', 'all']);
    });
    it('keeps the MainView-drawn money block, and the map corner in the first step', () => {
        expect(hudElementShown('pnlSelection', 'map')).toBe(false);
        expect(hudElementShown('lstMessages', 'map')).toBe(false);
        expect(hudElementShown('pnlItemList', 'map')).toBe(false);
        expect(hudElementShown('pnlOptionsList', 'map')).toBe(true);
        expect(hudElementShown('pnlOptionsList', 'none')).toBe(false);
        expect(hudElementShown('pnlMoney', 'none')).toBe(true);
        expect(hudElementShown('pnlSelection', 'all')).toBe(true);
    });
});

describe('H: method_528("either")', () => {
    it('keeps the last filter unless it was Galactic History', () => {
        expect(resolveHistoryOpenFilter(HistoryFilter.GalacticHistory, 'either')).toBe(HistoryFilter.All);
        expect(resolveHistoryOpenFilter(HistoryFilter.NonBattle, 'either')).toBe(HistoryFilter.NonBattle);
        expect(resolveHistoryOpenFilter(HistoryFilter.All, 'either')).toBe(HistoryFilter.All);
        expect(resolveHistoryOpenFilter(HistoryFilter.All, 'galactichistory')).toBe(HistoryFilter.GalacticHistory);
        expect(resolveHistoryOpenFilter(HistoryFilter.GalacticHistory, 'nonbattle')).toBe(HistoryFilter.NonBattle);
    });
});

describe('control groups: Game.PlayerHotkey0..9 on the galaxy, journaled, saved', () => {
    it('a game without groups saves as before; a set group survives the save with its object identity', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        expect(g.playerHotkeys).toBeUndefined();
        expect(JSON.stringify(galaxyToJSON(g))).not.toContain('playerHotkeys');
        const ship = game.playerEmpire.builtObjects.find((b) => b != null) as BuiltObject;
        const capital = game.playerEmpire.capital as Habitat;
        expect(setControlGroup(g, 1, ship)).toBe(true);
        expect(setControlGroup(g, 0, capital)).toBe(true);
        expect(setControlGroup(g, 10, ship)).toBe(false);
        const loaded = galaxyFromJSON(JSON.parse(JSON.stringify(galaxyToJSON(g))), gameData);
        const s1 = controlGroup(loaded, 1) as BuiltObject;
        expect(s1).toBeInstanceOf(BuiltObjectClass);
        expect(s1.builtObjectID).toBe(ship.builtObjectID);
        expect(loaded.builtObjects.includes(s1) || loaded.playerEmpire!.builtObjects.includes(s1)).toBe(true);
        expect((controlGroup(loaded, 0) as Habitat).habitatIndex).toBe(capital.habitatIndex);
        expect(controlGroup(loaded, 5)).toBeNull();
    }, 600000);

    it('the setControlGroup op is journaled and replays to the same groups', () => {
        const game = cachedTickGame(gameData);
        const side = inThread(game);
        const ships = game.playerEmpire.builtObjects.filter((b) => b != null).slice(0, 2) as BuiltObject[];
        side.tick();
        issuePlayerCommand(game.galaxy, game.playerEmpire, 'setControlGroup', [2, ships]);
        issuePlayerCommand(game.galaxy, game.playerEmpire, 'setControlGroup', [7, game.galaxy.systems[0]]);
        side.tick();
        side.tick();
        const log = commandLog(game.galaxy).filter((e) => 'op' in e && e.op === 'setControlGroup');
        expect(log.length).toBe(2);
        const fresh = cachedTickGame(gameData);
        scheduleCommandLog(fresh.galaxy, commandLog(game.galaxy));
        runScheduledUntil(fresh.galaxy, game.galaxy.nowMs);
        const g2 = controlGroup(fresh.galaxy, 2) as BuiltObject[];
        expect(g2.map((b) => b.builtObjectID)).toEqual(ships.map((b) => b.builtObjectID));
        expect(controlGroup(fresh.galaxy, 7)).toBe(fresh.galaxy.systems[0]);
        expect(commandFailureValue('setControlGroup', 'x', [])).toBe(false);
        side.dispose();
    }, 600000);

    it('worker mode: the assignment reaches the authoritative galaxy and comes back to the replica', () => {
        const w = inWorker(cachedTickGame(gameData), gameData);
        const rShip = w.player.builtObjects.find((b) => b != null) as BuiltObject;
        let applied: boolean | null = null;
        issuePlayerCommand(w.galaxy, w.player, 'setControlGroup', [4, rShip], (r) => (applied = r));
        for (let i = 0; i < 4; i++) w.tick();
        expect(applied).toBe(true);
        const real = controlGroup(w.real, 4) as BuiltObject;
        expect(real).not.toBe(rShip);
        expect(real.builtObjectID).toBe(rShip.builtObjectID);
        // The replica's own slot holds the replica's ship (the sync, not a full settle).
        expect(controlGroup(w.galaxy, 4)).toBe(rShip);
        expect(w.replicaWrites()).toEqual([]);
        w.dispose();
    }, 600000);
});

describe('control group keys (method_208 / method_209 / method_157)', () => {
    it('set reads the selection at once, select applies it, an empty group clears, focus centres without zooming', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const capital = game.playerEmpire.capital as Habitat;
        const system = g.systems[capital.systemIndex];
        let sel: Selection | null = { habitat: capital, system };
        const selected: unknown[] = [];
        let centred: { x: number; y: number } | null = null;
        let sounds = 0;
        const keys = createControlGroupKeys({
            galaxy: g,
            player: game.playerEmpire,
            camera: { centerOn: (x, y) => (centred = { x, y }) },
            getSelection: () => sel,
            select: (o) => selected.push(o),
            godMode: () => false,
            playSetSound: () => sounds++,
        });
        keys.handle('set', 3);
        expect(sounds).toBe(1);
        // Pending until the boundary, then on the galaxy.
        expect(keys.group(3)).toBe(capital);
        flushPlayerCommands(g);
        expect(controlGroup(g, 3)).toBe(capital);
        sel = null;
        keys.handle('selectWithFocus', 3);
        expect(selected).toEqual([capital]);
        expect(centred).toEqual({ x: Math.trunc(capital.xpos), y: Math.trunc(capital.ypos) });
        keys.handle('select', 6); // unassigned: method_209(null) clears
        expect(selected).toEqual([capital, null]);
        // The galaxy-zoom star selection is the C# SystemInfo.
        expect(selectedGameObject({ habitat: system.systemStar, system, systemInfo: true })).toBe(system);
        expect(controlGroupFocusPoint(g, system)).toEqual({ x: Math.trunc(system.systemStar.xpos), y: Math.trunc(system.systemStar.ypos) });
        // An unexplored system's habitat is not selected (outside GodMode).
        const hidden = g.habitats.find((h) => game.playerEmpire.visibility.checkSystemVisibilityStatus(h.systemIndex) === 0);
        if (hidden !== undefined) {
            setControlGroup(g, 8, hidden);
            keys.handle('select', 8);
            expect(selected.length).toBe(2);
        }
    }, 600000);
});

describe('Ground Report (ColonyInvasion.cs)', () => {
    it('sizes, columns and the resize choice', () => {
        expect(groundReportWindowSize(0)).toEqual({ w: 580, h: 590 });
        expect(groundReportWindowSize(2)).toEqual({ w: 935, h: 856 });
        expect(nextGroundReportSize(0, { w: 1000, h: 900 })).toBe(0);
        expect(nextGroundReportSize(0, { w: 1200, h: 900 })).toBe(1);
        expect(nextGroundReportSize(0, { w: 1400, h: 800 })).toBe(1);
        expect(nextGroundReportSize(0, { w: 1400, h: 900 })).toBe(2);
        expect(nextGroundReportSize(2, { w: 1400, h: 900 })).toBe(0);
        expect(groundReportColumns(1).attackingForcesOrbitX).toBe(700);
        // ReviewXCoords with no troops at all: infantry / artillery close up on armour, special forces 35 px left.
        const c = reviewXCoords(0, new TroopList(), new TroopList());
        expect([c.defendingTroopsInfantryX, c.defendingTroopsArtilleryX, c.defendingTroopsSpecialForcesX, c.attackingTroopsSpecialForcesX]).toEqual([250, 250, 215, 110]);
        expect(groundReportLandscape('Ocean', 2)).toBe('ocean1.png');
        expect(groundReportLandscape('Ice', 18)).toBe('ice2.png');
        expect(formatThousandsK(12500)).toBe('13K');
        expect([formatSignedPercent(0.25), formatSignedPercent(-0.1), formatSignedPercent(0)]).toEqual(['+25%', '-10%', '+0%']);
    });

    it('the capital: its defenders, population and facilities; nothing attacks; the read writes nothing', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const capital = game.playerEmpire.capital as Habitat;
        const before = JSON.stringify(galaxyToJSON(g));
        const m = buildGroundReport({ galaxy: g, colony: capital, panelSize: 0, habitatTypeName: HabitatType[capital.type] });
        expect(JSON.stringify(galaxyToJSON(g))).toBe(before);
        expect(m.headerFill).toBe(true);
        expect(m.frontlineX).toBeNull();
        expect(m.attackingStrength).toBe(0);
        expect(m.defendingStrength).toBeGreaterThan(0);
        const troops = m.items.filter((i) => i.kind === 'defendingTroop');
        expect(troops.length).toBe(capital.troops!.count);
        expect(troops.every((t) => t.mirrored && t.readiness !== null)).toBe(true);
        expect(m.items.filter((i) => i.kind === 'facility').length).toBe((capital.facilities ?? []).length);
        expect(m.items.some((i) => i.kind === 'population')).toBe(true);
        expect(m.texts[0].text).toBe(game.playerEmpire.name);
        // Hotspots: the first match wins; the resize glyph is last.
        const first = m.items[0];
        expect(hotspotAt(m.hotspots, first.rect.x + 1, first.rect.y + 1)?.target).toBe(0);
        expect(hotspotAt(m.hotspots, m.resize.rect.x + 2, m.resize.rect.y + 2)?.target).toBe('resize');
        // The "[" key: a populated selected habitat, else the capital.
        const isH = (o: unknown): o is Habitat => o === capital || (o as Habitat)?.habitatIndex !== undefined;
        expect(groundReportKeyColony(null, isH, capital)).toBe(capital);
        const empty = g.habitats.find((h) => h.population.items.length === 0)!;
        expect(groundReportKeyColony(empty, isH, capital)).toBe(capital);
    }, 600000);
});
