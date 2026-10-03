// Game Options screen (gap 5, docs/parity/ui-render.md): the Empire Settings ports (Main.Part4.cs method_557-564), the
// journaled setEmpireSetting command and each value's effect on the sim, save/load of the values, the Automation
// "Mode" presets (Main.Part6.cs method_406-412 / UhvjHxwqlt), the view-control maths (Main.Part13.cs OnMouseWheel,
// Main.Part12.cs method_98) and the persisted UI options.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { tickGameOptions } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import { AutomationLevel } from '../src/sim/empire';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../src/sim/missions/mission';
import { assignMission } from '../src/sim/missions/assign';
import { newBuiltObjectShouldBeAutomated } from '../src/sim/construction/empireConstruction';
import { shipGroupCheckNeedGatherBeforeAttack } from '../src/sim/fleets/shipGroupTasks';
import { calculateOverallStrengthFactor } from '../src/sim/combat/threats';
import type { ShipGroup } from '../src/sim/fleets/shipGroup';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { issuePlayerCommand, replayCommandLog, runPlayerCommand } from '../src/sim/player/playerCommands';
import {
    EMPIRE_SETTING_FIELDS,
    applyEmpireSetting,
    attackRangeToStanceIndex,
    discoveryIndexWithSuppressedPopups,
    empireSettingValue,
    overmatchFactorToIndex,
    overmatchIndexToFactor,
    percentToPortion,
    portionToPercent,
    readEmpireSettings,
    stanceIndexToAttackRange,
} from '../src/sim/player/empireSettings';
import { AUTOMATION_ROWS } from '../src/ui/screens/gameOptionsPanel';
import { AUTOMATION_MODE_ITEMS, AUTOMATION_PRESETS, automationValuesEqual, detectAutomationMode, empireAutomationValues, messageSettingsRows } from '../src/ui/screens/gameOptionsModel';
import { edgeScrollPixels, keyScrollPixels, nebulaDetailScale, wheelNotches, wheelZoom, wheelZoomAnchor, wheelZoomVal } from '../src/render/viewInput';
import {
    clampMaximumFramerate,
    clearSettingsListeners,
    DEFAULT_SETTINGS,
    getSettings,
    loadedGamePaused,
    loadSettings,
    resetAutomationResponses,
    saveAutomationResponse,
    savedAutomationResponse,
    setSettingsStorage,
    tickerMaxFps,
    updateSettings,
    type SettingsStorage,
} from '../src/ui/settings';
import { sliderThumbLeft, sliderValueAt, trackBarSliderRect, trackBarTickX } from '../src/ui/originalWindowControls';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('Empire Settings value ports (Main.Part4.cs method_559-564)', () => {
    it('engagement stance index <-> attack range', () => {
        expect([0, 1, 2, 3].map(stanceIndexToAttackRange)).toEqual([-1, 0, 2000, 48000]);
        expect([-1, 0, 2000, 48000, 1500, 30000, 50000].map(attackRangeToStanceIndex)).toEqual([0, 1, 2, 3, 2, 3, -1]);
    });
    it('attack overmatch slider index <-> factor', () => {
        expect([0, 1, 2, 3, 4, 9].map(overmatchIndexToFactor)).toEqual([1, 1.5, 2, 3, 5, 2]);
        expect([1, 1.5, 2, 3, 5, 4].map(overmatchFactorToIndex)).toEqual([0, 1, 2, 3, 4, -1]);
    });
    it('portions: float <-> 0..100 spinner, clamped', () => {
        expect(portionToPercent(Math.fround(0.3))).toBe(30);
        expect(percentToPortion(30)).toBe(Math.fround(0.3));
        expect(percentToPortion(150)).toBe(1);
        expect(portionToPercent(-1)).toBe(0);
    });
    it('suppress all pop-ups skips "Ask what to do" (Main.Part2.cs:4098-4137)', () => {
        expect(discoveryIndexWithSuppressedPopups(0, 0, true)).toBe(1);
        expect(discoveryIndexWithSuppressedPopups(0, 3, true)).toBe(3);
        expect(discoveryIndexWithSuppressedPopups(0, 0, false)).toBe(0);
        expect(discoveryIndexWithSuppressedPopups(2, 0, true)).toBe(2);
    });
    it('rejects values the window cannot produce', () => {
        expect(empireSettingValue('stateMoney', 5)).toBeNull();
        expect(empireSettingValue('attackRangePatrol', -2)).toBeNull();
        expect(empireSettingValue('attackRangePatrol', 1.5)).toBeNull();
        expect(empireSettingValue('attackOvermatchFactor', 4)).toBeNull();
        expect(empireSettingValue('discoveryActionRuin', 5)).toBeNull();
        expect(empireSettingValue('discoveryActionAbandonedShipBase', 3)).toBeNull();
        expect(empireSettingValue('newShipsAutomated', 1)).toBeNull();
        expect(empireSettingValue('fleetAttackGatherPortion', 2)).toBe(1);
    });
});

/** A value for each field that differs from the default (Main.Part9.cs method_260). */
const CHANGED: Record<(typeof EMPIRE_SETTING_FIELDS)[number], number | boolean> = {
    attackRangePatrol: 0,
    attackRangeEscort: 48000,
    attackRangeAttack: -1,
    attackRangeOther: 2000,
    attackRangePatrolManual: 48000,
    attackRangeEscortManual: 0,
    attackRangeAttackManual: 2000,
    attackRangeOtherManual: 0,
    attackOvermatchFactor: 5,
    fleetAttackRefuelPortion: Math.fround(0.8),
    fleetAttackGatherPortion: Math.fround(0.1),
    discoveryActionRuin: 4,
    discoveryActionAbandonedShipBase: 2,
    newShipsAutomated: false,
};

describe('setEmpireSetting: the journaled command for every Empire Settings value', () => {
    it('each field changes through the command, is journaled, and bad values are refused', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const before = readEmpireSettings(p);
        for (const f of EMPIRE_SETTING_FIELDS) expect(before[f]).not.toEqual(CHANGED[f]);
        for (const f of EMPIRE_SETTING_FIELDS) {
            expect(runPlayerCommand(g, p, 'setEmpireSetting', [f, CHANGED[f]])).toBe(true);
            expect(readEmpireSettings(p)[f]).toEqual(CHANGED[f]);
        }
        expect(runPlayerCommand(g, p, 'setEmpireSetting', ['attackOvermatchFactor', 7])).toBe(false);
        expect(p.attackOvermatchFactor).toBe(5);
        const ops = (commandLog(g) as PlayerLogEntry[]).filter((e) => e.op === 'setEmpireSetting');
        expect(ops).toHaveLength(EMPIRE_SETTING_FIELDS.length + 1);
    }, 300000);

    it('seed + log replays them; save/load keeps them', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        for (const f of EMPIRE_SETTING_FIELDS) issuePlayerCommand(g, p, 'setEmpireSetting', [f, CHANGED[f]]);
        runGameSeconds(g, 3);
        for (const f of EMPIRE_SETTING_FIELDS) expect(readEmpireSettings(p)[f]).toEqual(CHANGED[f]);
        const { seed, ...options } = tickGameOptions(gameData);
        const replay = replayCommandLog(seed, options, commandLog(g), g.nowMs);
        expect(readEmpireSettings(replay.playerEmpire)).toEqual(readEmpireSettings(p));
        expect(stateDigest(replay.galaxy)).toBe(stateDigest(g));
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const loaded = deserializeGame(serializeGame(game, time, {} as StartGameOptions), gameData).game;
        expect(readEmpireSettings(loaded.playerEmpire)).toEqual(readEmpireSettings(p));
    }, 600000);
});

describe('setEmpireSetting: the sim reads each value', () => {
    it('NewShipsAutomated → NewBuiltObjectShouldBeAutomated (Empire.2.cs 625)', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        expect(newBuiltObjectShouldBeAutomated(p, BuiltObjectSubRole.Escort)).toBe(true);
        runPlayerCommand(game.galaxy, p, 'setEmpireSetting', ['newShipsAutomated', false]);
        expect(newBuiltObjectShouldBeAutomated(p, BuiltObjectSubRole.Escort)).toBe(false);
        expect(newBuiltObjectShouldBeAutomated(p, BuiltObjectSubRole.ColonyShip)).toBe(false);
    }, 300000);

    it('the default engagement stances set a new mission\'s attack range (BuiltObject.AssignMission 7699-7731)', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ship = p.builtObjects.find((b): b is BuiltObject => b !== null && b.role !== BuiltObjectRole.Base);
        expect(ship).toBeDefined();
        const bo = ship!;
        const target = p.capital!;
        const sq = (n: number): number => Math.fround(Math.fround(n) * Math.fround(n));
        const cases: [BuiltObjectMissionType, string, string][] = [
            [BuiltObjectMissionType.Patrol, 'attackRangePatrol', 'attackRangePatrolManual'],
            [BuiltObjectMissionType.Escort, 'attackRangeEscort', 'attackRangeEscortManual'],
            [BuiltObjectMissionType.Attack, 'attackRangeAttack', 'attackRangeAttackManual'],
            [BuiltObjectMissionType.Move, 'attackRangeOther', 'attackRangeOtherManual'],
        ];
        for (const [type, auto, manual] of cases) {
            for (const [range, field, manuallyAssigned] of [
                [0, auto, false],
                [2000, auto, false],
                [48000, manual, true],
                [0, manual, true],
            ] as [number, string, boolean][]) {
                runPlayerCommand(g, p, 'setEmpireSetting', [field as (typeof EMPIRE_SETTING_FIELDS)[number], range]);
                bo.isAutoControlled = true;
                bo.attackRangeSquared = -7;
                assignMission(g, bo, type, target, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned });
                expect([type, field, bo.attackRangeSquared]).toEqual([type, field, sq(range)]);
            }
        }
    }, 300000);

    it('FleetAttackGatherPortion → ShipGroup.CheckNeedGatherBeforeAttack (ShipGroup.cs 2161)', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ships = p.builtObjects.filter((b): b is BuiltObject => b !== null && b.role !== BuiltObjectRole.Base && b.builtAt === null).slice(0, 2);
        expect(ships).toHaveLength(2);
        // One ship far from the lead: half the fleet is dispersed; the target outguns the ships near the lead.
        ships[1].xpos = ships[0].xpos + 200000;
        const target = g.builtObjects
            .filter((b): b is BuiltObject => b !== null && b.empire !== p)
            .reduce((a, b) => (calculateOverallStrengthFactor(b) > calculateOverallStrengthFactor(a) ? b : a));
        expect(calculateOverallStrengthFactor(target)).toBeGreaterThan(calculateOverallStrengthFactor(ships[0]));
        const fleet = { leadShip: ships[0], ships, empire: p } as unknown as ShipGroup;
        runPlayerCommand(g, p, 'setEmpireSetting', ['fleetAttackGatherPortion', percentToPortion(30)]);
        expect(shipGroupCheckNeedGatherBeforeAttack(g, fleet, target).result).toBe(true);
        runPlayerCommand(g, p, 'setEmpireSetting', ['fleetAttackGatherPortion', percentToPortion(60)]);
        expect(shipGroupCheckNeedGatherBeforeAttack(g, fleet, target).result).toBe(false);
    }, 300000);

    it('the remaining values land on the Empire fields the sim reads', () => {
        // AttackOvermatchFactor: combat/threats.ts EvaluateAdequateAttackers, fighters.ts; FleetAttackRefuelPortion:
        // fleets/shipGroupTasks.ts CheckNeedRefuelBeforeAttack; DiscoveryActionRuin: exploration.ts
        // CheckForShipsDiscoveringRuins; DiscoveryActionAbandonedShipBase: combat/ownership.ts.
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        for (const f of ['attackOvermatchFactor', 'fleetAttackRefuelPortion', 'discoveryActionRuin', 'discoveryActionAbandonedShipBase'] as const) {
            runPlayerCommand(game.galaxy, p, 'setEmpireSetting', [f, CHANGED[f]]);
            expect(p[f]).toBe(CHANGED[f]);
        }
    }, 300000);

    it('applyEmpireSetting writes only the listed fields', () => {
        const e = { stateMoney: 1 } as unknown as Parameters<typeof applyEmpireSetting>[0];
        expect(applyEmpireSetting(e, 'stateMoney', 99)).toBe(false);
        expect((e as unknown as { stateMoney: number }).stateMoney).toBe(1);
    });
});

describe('Automation Mode presets (Main.Part6.cs method_406-412, UhvjHxwqlt)', () => {
    it('has the eight items and seven presets covering every control', () => {
        expect(AUTOMATION_MODE_ITEMS).toHaveLength(8);
        for (let i = 1; i <= 7; i++) for (const r of AUTOMATION_ROWS) expect(AUTOMATION_PRESETS[i][r.field]).toBeDefined();
    });
    it('detects each preset, and Custom otherwise', () => {
        for (let i = 1; i <= 7; i++) expect(detectAutomationMode(AUTOMATION_PRESETS[i])).toBe(i);
        expect(detectAutomationMode({ ...AUTOMATION_PRESETS[2], controlResearch: true })).toBe(0);
        expect(AUTOMATION_PRESETS[2].controlColonization).toBe(AutomationLevel.Undefined);
        expect(AUTOMATION_PRESETS[3].controlColonization).toBe(AutomationLevel.FullyAutomated);
    });
    it('a preset applied through setEmpireControl commands is what the window then detects', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        // The new-game defaults (method_260: population policy automated) match no preset: "(Custom)".
        expect(detectAutomationMode(empireAutomationValues(p))).toBe(0);
        for (const r of AUTOMATION_ROWS) runPlayerCommand(game.galaxy, p, 'setEmpireControl', [r.field, AUTOMATION_PRESETS[5][r.field]]);
        expect(automationValuesEqual(empireAutomationValues(p), AUTOMATION_PRESETS[5])).toBe(true);
        expect(detectAutomationMode(empireAutomationValues(p))).toBe(5);
    }, 300000);
    it('message settings rows follow the original window order', () => {
        const rows = messageSettingsRows();
        expect(rows).toHaveLength(19);
        expect(rows[0].label).toBe('New Ship Built');
        expect(rows[4].label).toBe('Colony Gain or Loss');
        expect(rows[18].label).toBe('Construction Resource Shortage');
    });
});

describe('view controls (Main.Part13.cs OnMouseWheel, Main.Part12.cs method_98 / 99)', () => {
    it('wheel notches from DOM deltas', () => {
        expect(wheelNotches(100, 0)).toBe(1);
        expect(wheelNotches(50, 0)).toBe(1); // a notch at device pixel ratio 2
        expect(wheelNotches(-53, 0)).toBe(-1);
        expect(wheelNotches(240, 0)).toBe(2);
        expect(wheelNotches(4, 0)).toBeCloseTo(0.04); // trackpad
        expect(wheelNotches(-3, 1)).toBe(-1);
        expect(wheelNotches(1, 2)).toBe(1);
        expect(wheelNotches(Number.NaN, 0)).toBe(0);
    });
    it('Zoom Speed: val = notches × speed / 100, clamped ±0.85; zoom = 1 / (factor × (1 + val))', () => {
        expect(wheelZoomVal(1, 12)).toBeCloseTo(0.12);
        expect(wheelZoomVal(-10, 100)).toBe(-0.85);
        expect(wheelZoom(1, -1, 12)).toBeCloseTo(1 / 0.88);
        expect(wheelZoom(1, 1, 12)).toBeCloseTo(1 / 1.12);
    });
    it('mouse scroll-wheel behaviour anchors', () => {
        expect(wheelZoomAnchor(0, true, true)).toBe('center');
        expect(wheelZoomAnchor(1, true, true)).toBe('selection');
        expect(wheelZoomAnchor(1, false, false)).toBe('center');
        expect(wheelZoomAnchor(2, true, true)).toBe('cursor');
        expect(wheelZoomAnchor(2, false, true)).toBe('center');
    });
    it('Scroll Speed keeps the old speeds at the default and scales linearly', () => {
        expect(edgeScrollPixels(10)).toBe(16);
        expect(keyScrollPixels(10)).toBe(60);
        expect(edgeScrollPixels(20)).toBe(32);
        expect(keyScrollPixels(1)).toBe(6);
    });
    it('nebula detail multiplier: Low is the unchanged resolution', () => {
        expect([0, 1, 2].map(nebulaDetailScale)).toEqual([1, 1.3, 1.6]);
    });
});

describe('ColorSlider / LabelledTrackBar geometry', () => {
    it('thumb position and the inverse', () => {
        expect(sliderThumbLeft(0, 0, 100, 515, 20)).toBe(0);
        expect(sliderThumbLeft(100, 0, 100, 515, 20)).toBe(495);
        expect(sliderValueAt(10 + 495 / 2, 0, 100, 515, 20)).toBe(50);
        expect(sliderValueAt(-50, 1, 100, 515, 20)).toBe(1);
        expect(sliderValueAt(9999, 1, 100, 515, 20)).toBe(100);
    });
    it('LabelledTrackBar.DoLayout / OnPaint (465 × 62, LabelWidth 120)', () => {
        const r = trackBarSliderRect(465, 62, 120);
        expect(r).toEqual({ x: 148, y: 37, w: 289, h: 22 });
        expect(trackBarTickX(0, 5, r.x, r.w, 10)).toBe(152);
        expect(trackBarTickX(4, 5, r.x, r.w, 10)).toBe(152 + 279);
    });
});

function makeFakeStorage(): SettingsStorage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('UI options persist (ui/settings.ts)', () => {
    let storage: ReturnType<typeof makeFakeStorage>;
    beforeEach(() => {
        storage = makeFakeStorage();
        setSettingsStorage(storage);
        clearSettingsListeners();
        updateSettings({ ...DEFAULT_SETTINGS });
    });
    afterEach(() => {
        setSettingsStorage(null);
        clearSettingsListeners();
    });

    it('defaults are the original GameOptions (Main.Part9.cs method_260)', () => {
        expect(DEFAULT_SETTINGS).toMatchObject({
            mainViewScrollSpeed: 10,
            mainViewZoomSpeed: 12,
            mouseScrollWheelBehaviour: 2,
            starFieldSize: 1000,
            showSystemNebulae: true,
            systemNebulaeDetail: 0,
            maximumFramerate: -1,
            loadedGamesPaused: true,
            autoPauseInPopup: true,
        });
    });

    it('every Options value round-trips through storage', () => {
        const patch = {
            mainViewScrollSpeed: 37,
            mainViewZoomSpeed: 55,
            mouseScrollWheelBehaviour: 0,
            starFieldSize: 1500,
            showSystemNebulae: false,
            systemNebulaeDetail: 2,
            maximumFramerate: 60,
            loadedGamesPaused: false,
            autoPauseInPopup: false,
            uiScale: 125,
            musicVolume: 0.4,
            soundVolume: 0.2,
            musicMuted: true,
            autoSave: false,
            autoSaveMinutes: 45,
            showRegionLabels: true,
            galaxyViewDisplayCivilianShips: true,
            openMessagesAutomatically: true,
            messageStubsVisible: 3,
        };
        updateSettings(patch);
        expect(loadSettings()).toMatchObject(patch);
    });

    it('out-of-range stored values are clamped', () => {
        storage.setItem('dwu-ui-settings', JSON.stringify({ mainViewScrollSpeed: 0, mainViewZoomSpeed: 500, mouseScrollWheelBehaviour: 7, starFieldSize: 5, systemNebulaeDetail: 9, maximumFramerate: 3 }));
        expect(loadSettings()).toMatchObject({ mainViewScrollSpeed: 1, mainViewZoomSpeed: 100, mouseScrollWheelBehaviour: 2, starFieldSize: 50, systemNebulaeDetail: 2, maximumFramerate: 10 });
        storage.setItem('dwu-ui-settings', JSON.stringify({ maximumFramerate: -1 }));
        expect(loadSettings().maximumFramerate).toBe(-1);
    });

    it('maximum framerate and loaded games paused', () => {
        expect(clampMaximumFramerate(0)).toBe(-1);
        expect(clampMaximumFramerate(500)).toBe(100);
        expect(tickerMaxFps(-1)).toBe(0);
        expect(tickerMaxFps(50)).toBe(50);
        expect(loadedGamePaused(false, true)).toBe(true);
        expect(loadedGamePaused(true, false)).toBe(false);
    });

    it('automation prompt answers are remembered and Reset Warnings clears them', () => {
        expect(savedAutomationResponse('Research')).toBeNull();
        saveAutomationResponse('Research', true);
        saveAutomationResponse('Fleet Formation', false);
        expect(loadSettings().automationPromptResponses).toEqual({ Research: true, 'Fleet Formation': false });
        expect(savedAutomationResponse('Fleet Formation')).toBe(false);
        resetAutomationResponses();
        expect(savedAutomationResponse('Research')).toBeNull();
        expect(getSettings().automationPromptResponses).toEqual({});
    });
});
