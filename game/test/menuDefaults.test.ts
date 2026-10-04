// Main menu Options editing the new-game defaults (Start.1.cs:1928-1960 method_155 / 163 / 164) and the Empire Policy
// screen's GameOptions persistence (Main.Part3.cs:3840 / 4179-4198, Galaxy.7.cs:5006 / 5042).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import { AutomationLevel } from '../src/sim/empire';
import { createGame, DEFAULT_GAME_OPTIONS_AUTOMATION } from '../src/sim/game';
import { DESIGN_UPGRADE_KEYS, applyDesignUpgradeGameOptionsToPolicies, applyDesignUpgradePoliciesToGameOptions, defaultEmpirePolicy } from '../src/sim/data/policies';
import {
    AUTOMATION_PRESETS,
    automationValuesFromGameOptions,
    detectAutomationMode,
    gameOptionsAfterPolicyApply,
    gameOptionsWithAutomationValues,
    newGameOptionsFromSettings,
} from '../src/ui/screens/gameOptionsModel';
import { applyAutomationModeToGameOptions, saveNewGameOptions, setGameOptionsControl } from '../src/ui/screens/newGameDefaultsPanel';
import { reviveCreateOptions, workerCreateOptions } from '../src/simworker/bootOptions';
import { getSettings, setSettingsStorage, type SettingsStorage } from '../src/ui/settings';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const mem = new Map<string, string>();
const storage: SettingsStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
afterEach(() => {
    mem.clear();
    setSettingsStorage(null);
});

describe('main menu Options: the new-game defaults', () => {
    it('a control edit changes only that Control*Default, and the Mode follows (uwcbgxAbxH)', () => {
        const base = { ...DEFAULT_GAME_OPTIONS_AUTOMATION };
        expect(detectAutomationMode(automationValuesFromGameOptions(base))).toBe(0); // method_260 differs from the Default preset
        const edited = setGameOptionsControl(base, 'controlResearch', false);
        expect(edited.controlResearchDefault).toBe(false);
        expect({ ...edited, controlResearchDefault: true }).toEqual(base);
        const colonization = setGameOptionsControl(base, 'controlColonization', 1);
        expect(colonization.controlColonizationDefault).toBe(AutomationLevel.PartiallyAutomated);
    });

    it('every preset round-trips through the GameOptions and is detected as its mode', () => {
        for (const i of [1, 2, 3, 4, 5, 6, 7]) {
            const o = applyAutomationModeToGameOptions(DEFAULT_GAME_OPTIONS_AUTOMATION, i);
            expect(detectAutomationMode(automationValuesFromGameOptions(o))).toBe(i);
            expect(automationValuesFromGameOptions(o)).toEqual(AUTOMATION_PRESETS[i]);
            // The attack ranges etc. are untouched by a mode.
            expect(o.attackRangePatrol).toBe(DEFAULT_GAME_OPTIONS_AUTOMATION.attackRangePatrol);
        }
        expect(applyAutomationModeToGameOptions(DEFAULT_GAME_OPTIONS_AUTOMATION, 0)).toEqual(DEFAULT_GAME_OPTIONS_AUTOMATION); // (Custom)
        const expert = applyAutomationModeToGameOptions(DEFAULT_GAME_OPTIONS_AUTOMATION, 2);
        expect(expert.controlColonizationDefault).toBe(AutomationLevel.Undefined);
        expect(gameOptionsWithAutomationValues(expert, AUTOMATION_PRESETS[3]).controlColonizationDefault).toBe(AutomationLevel.FullyAutomated);
    });

    it('saving puts the edit in settings.newGameOptions, where the new game reads it', () => {
        setSettingsStorage(storage);
        saveNewGameOptions(applyAutomationModeToGameOptions(DEFAULT_GAME_OPTIONS_AUTOMATION, 3));
        const revived = newGameOptionsFromSettings(getSettings().newGameOptions);
        expect(revived?.controlResearchDefault).toBe(true);
        expect(revived?.controlPopulationPolicyDefault).toBe(true);
        expect(revived?.controlColonizationDefault).toBe(AutomationLevel.FullyAutomated);
    });
});

describe('Empire Policy: GameOptions persistence', () => {
    it('Galaxy.7.cs 5006 / 5042 copy the 29 flags both ways', () => {
        expect(DESIGN_UPGRADE_KEYS).toHaveLength(29);
        const policy = defaultEmpirePolicy();
        policy.designUpgradeFrigate = false;
        policy.designUpgradeMiningStation = false;
        const go = applyDesignUpgradePoliciesToGameOptions({ ...DEFAULT_GAME_OPTIONS_AUTOMATION }, policy);
        expect(go.designUpgradeFrigate).toBe(false);
        expect(go.designUpgradeEscort).toBe(true);
        const other = defaultEmpirePolicy();
        applyDesignUpgradeGameOptionsToPolicies(go, other);
        expect(other.designUpgradeFrigate).toBe(false);
        expect(other.designUpgradeMiningStation).toBe(false);
        expect(other.designUpgradeCruiser).toBe(true);
    });

    it('an apply saves the empire\'s Control*Default (the panel\'s sent values win) and the flags; a load only the flags', () => {
        const policy = defaultEmpirePolicy();
        policy.designUpgradeCarrier = false;
        const fakeEmpire = { controlColonization: AutomationLevel.FullyAutomated, controlResearch: true } as never;
        const saved = gameOptionsAfterPolicyApply(null, fakeEmpire, policy, { controlColonization: AutomationLevel.Undefined, controlResearch: false });
        expect(saved.controlColonizationDefault).toBe(AutomationLevel.Undefined);
        expect(saved.controlResearchDefault).toBe(false);
        expect(saved.designUpgradeCarrier).toBe(false);
        // The fields the apply does not touch (ControlPopulationPolicy, OfferPirateMissions, ranges) keep their value.
        expect(saved.attackRangePatrol).toBe(DEFAULT_GAME_OPTIONS_AUTOMATION.attackRangePatrol);
        const loaded = gameOptionsAfterPolicyApply(saved, fakeEmpire, defaultEmpirePolicy(), null);
        expect(loaded.controlColonizationDefault).toBe(AutomationLevel.Undefined);
        expect(loaded.designUpgradeCarrier).toBe(true);
    });

    it('createGame (also through the worker boot options) gives the player the saved flags; default options change nothing', () => {
        const flagged = newGameOptionsFromSettings({ designUpgradeFrigate: false, designUpgradeLargeFreighter: false })!;
        const opts = { ...tickGameOptions(gameData), gameOptions: flagged };
        const revived = reviveCreateOptions(structuredClone(workerCreateOptions(opts)), gameData);
        const game = createGame(revived);
        expect(game.playerEmpire.policy!.designUpgradeFrigate).toBe(false);
        expect(game.playerEmpire.policy!.designUpgradeLargeFreighter).toBe(false);
        expect(game.playerEmpire.policy!.designUpgradeEscort).toBe(true);
        const plain = createGame(tickGameOptions(gameData));
        for (const k of DESIGN_UPGRADE_KEYS) expect(plain.playerEmpire.policy![k]).toBe(true);
    }, 300000);
});
