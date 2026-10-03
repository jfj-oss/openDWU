// Game Options → new-game defaults (gap 5, docs/parity/ui-render.md): closing the in-game Options window saves the player
// empire's automation / engagement / discovery settings as GameOptions defaults (Main.Part9.cs:2531 YxwyUefOyQ +
// Main.Part9.cs:2510 method_257), which the next new game copies onto its player (Start.2.cs 1352-1363, 2122-2146).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import { AutomationLevel, type Empire } from '../src/sim/empire';
import { createGame, DEFAULT_GAME_OPTIONS_AUTOMATION, type GameOptionsAutomation } from '../src/sim/game';
import { gameOptionsFromEmpire, newGameOptionsFromSettings } from '../src/ui/screens/gameOptionsModel';
import { workerCreateOptions, reviveCreateOptions } from '../src/simworker/bootOptions';
import { DEFAULT_SETTINGS, loadSettings, setSettingsStorage, updateSettings, type SettingsStorage } from '../src/ui/settings';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

/** Every GameOptionsAutomation field different from DEFAULT_GAME_OPTIONS_AUTOMATION. */
const CUSTOM: GameOptionsAutomation = {
    controlColonizationDefault: AutomationLevel.Undefined,
    controlColonyTaxRatesDefault: false,
    controlShipDesignDefault: false,
    controlDiplomaticGiftsDefault: AutomationLevel.FullyAutomated,
    controlWarTradeSanctionsDefault: AutomationLevel.FullyAutomated,
    controlTreatyNegotiationDefault: AutomationLevel.Undefined,
    controlAttacksOnEnemiesDefault: AutomationLevel.FullyAutomated,
    controlFleetFormationDefault: false,
    controlShipBuildingDefault: AutomationLevel.Undefined,
    controlTroopRecruitmentDefault: false,
    controlAgentAssignmentDefault: AutomationLevel.FullyAutomated,
    controlResearchDefault: false,
    controlColonyFacilitiesDefault: AutomationLevel.Undefined,
    controlCharacterLocationsDefault: false,
    controlPopulationPolicyDefault: false,
    controlOfferPirateMissionsDefault: AutomationLevel.Undefined,
    attackOverMatchFactor: 3,
    attackRangePatrol: 0,
    attackRangeEscort: 48000,
    attackRangeOther: 2000,
    attackRangeAttack: 48000,
    attackRangePatrolManual: 2000,
    attackRangeEscortManual: 0,
    attackRangeOtherManual: 48000,
    attackRangeAttackManual: 2000,
    fleetAttackRefuelPortion: Math.fround(0.5),
    fleetAttackGatherPortion: Math.fround(0.1),
    discoveryActionRuin: 2,
    discoveryActionAbandonedShipBase: 1,
    newShipsAutomated: false,
};

describe('YxwyUefOyQ: the player empire → GameOptions defaults', () => {
    it('a fresh game\'s player gives back method_260\'s defaults, field for field', () => {
        const game = createGame(tickGameOptions(gameData));
        expect(gameOptionsFromEmpire(game.playerEmpire)).toEqual(DEFAULT_GAME_OPTIONS_AUTOMATION);
    }, 300000);

    it('maps each Empire field to its *Default (the C# statement pairs), and pending commands win', () => {
        const e = {
            controlAgentAssignment: AutomationLevel.FullyAutomated,
            controlMilitaryAttacks: AutomationLevel.Undefined,
            controlColonization: AutomationLevel.PartiallyAutomated,
            controlColonyTaxRates: false,
            controlDiplomacyGifts: AutomationLevel.FullyAutomated,
            controlMilitaryFleets: false,
            controlStateConstruction: AutomationLevel.Undefined,
            controlDesigns: true,
            controlDiplomacyTreaties: AutomationLevel.FullyAutomated,
            controlTroopGeneration: false,
            controlCharacterLocations: true,
            controlDiplomacyOffense: AutomationLevel.Undefined,
            controlResearch: false,
            controlColonyFacilities: AutomationLevel.FullyAutomated,
            controlPopulationPolicy: true,
            controlOfferPirateMissions: AutomationLevel.PartiallyAutomated,
            attackRangePatrol: 0,
            attackRangeEscort: 2000,
            attackRangeAttack: 48000,
            attackRangeOther: -1,
            attackRangePatrolManual: 48000,
            attackRangeEscortManual: 0,
            attackRangeAttackManual: -1,
            attackRangeOtherManual: 2000,
            attackOvermatchFactor: 1.5,
            fleetAttackRefuelPortion: 0.25,
            fleetAttackGatherPortion: 0.75,
            discoveryActionRuin: 3,
            discoveryActionAbandonedShipBase: 2,
            newShipsAutomated: false,
        } as unknown as Empire;
        const o = gameOptionsFromEmpire(e);
        expect(o.controlAgentAssignmentDefault).toBe(AutomationLevel.FullyAutomated);
        expect(o.controlAttacksOnEnemiesDefault).toBe(AutomationLevel.Undefined);
        expect(o.controlColonizationDefault).toBe(AutomationLevel.PartiallyAutomated);
        expect(o.controlFleetFormationDefault).toBe(false);
        expect(o.controlShipBuildingDefault).toBe(AutomationLevel.Undefined);
        expect(o.controlShipDesignDefault).toBe(true);
        expect(o.controlTreatyNegotiationDefault).toBe(AutomationLevel.FullyAutomated);
        expect(o.controlTroopRecruitmentDefault).toBe(false);
        expect(o.controlWarTradeSanctionsDefault).toBe(AutomationLevel.Undefined);
        expect(o.controlColonyFacilitiesDefault).toBe(AutomationLevel.FullyAutomated);
        expect(o.controlOfferPirateMissionsDefault).toBe(AutomationLevel.PartiallyAutomated);
        expect(o.attackOverMatchFactor).toBe(1.5);
        expect(o.attackRangeOther).toBe(-1);
        expect(o.attackRangeAttackManual).toBe(-1);
        expect(o.fleetAttackRefuelPortion).toBe(0.25);
        expect(o.discoveryActionRuin).toBe(3);
        expect(o.newShipsAutomated).toBe(false);
        // A command the window issued but the sim has not applied yet (the next frame boundary / the worker).
        const p = gameOptionsFromEmpire(e, { controlResearch: true, attackRangePatrol: 48000, newShipsAutomated: true, controlColonization: AutomationLevel.Undefined });
        expect(p.controlResearchDefault).toBe(true);
        expect(p.attackRangePatrol).toBe(48000);
        expect(p.newShipsAutomated).toBe(true);
        expect(p.controlColonizationDefault).toBe(AutomationLevel.Undefined);
    });
});

describe('the saved defaults (method_257 / method_256) and the next new game (Start.2.cs)', () => {
    const mem = new Map<string, string>();
    const storage: SettingsStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
    afterEach(() => {
        mem.clear();
        setSettingsStorage(null);
    });

    it('persists in the UI settings and validates field by field', () => {
        setSettingsStorage(storage);
        expect(DEFAULT_SETTINGS.newGameOptions).toBeNull();
        expect(newGameOptionsFromSettings(loadSettings().newGameOptions)).toBeUndefined();
        updateSettings({ newGameOptions: { ...CUSTOM } as unknown as Record<string, number | boolean> });
        expect(newGameOptionsFromSettings(loadSettings().newGameOptions)).toEqual(CUSTOM);
        // A missing / mistyped field keeps its default; an AutomationLevel outside the enum is Manual (method_419).
        const partial = newGameOptionsFromSettings({ attackRangePatrol: 0, newShipsAutomated: 'yes' as unknown as boolean, controlResearchDefault: 1, controlColonizationDefault: 7 });
        expect(partial!.attackRangePatrol).toBe(0);
        expect(partial!.newShipsAutomated).toBe(DEFAULT_GAME_OPTIONS_AUTOMATION.newShipsAutomated);
        expect(partial!.controlResearchDefault).toBe(DEFAULT_GAME_OPTIONS_AUTOMATION.controlResearchDefault);
        expect(partial!.controlColonizationDefault).toBe(AutomationLevel.Undefined);
        expect(partial!.fleetAttackGatherPortion).toBe(DEFAULT_GAME_OPTIONS_AUTOMATION.fleetAttackGatherPortion);
        // A corrupt blob keeps null.
        mem.set('dwu-ui-settings', JSON.stringify({ newGameOptions: [1, 2] }));
        expect(loadSettings().newGameOptions).toBeNull();
    });

    it('createGame copies them onto the player only (Start.2.cs 1352-1363 / 2122-2146), also through the worker boot options', () => {
        const opts = { ...tickGameOptions(gameData), gameOptions: CUSTOM };
        // [simworker] the options cross the thread boundary unchanged (structured clone of a plain object).
        const revived = reviveCreateOptions(structuredClone(workerCreateOptions(opts)), gameData);
        expect(revived.gameOptions).toEqual(CUSTOM);
        const game = createGame(revived);
        expect(gameOptionsFromEmpire(game.playerEmpire)).toEqual(CUSTOM);
        // AI empires keep their own settings (the ctor's FullyAutomated, not GameOptions).
        for (const e of game.galaxy.empires) {
            if (e === game.playerEmpire || e.pirateEmpireBaseHabitat !== null) continue;
            expect(e.controlResearch).toBe(true);
        }
    }, 300000);
});
