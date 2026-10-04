// Pure parts of the Game Options screen (gameOptionsPanel.ts): the Automation "Mode" presets (cmbOptionsAutomationMode,
// Main.Part6.cs:1944-2033 + 2117-2290), the message-settings order of the original window, and the new-game defaults
// the window saves on close (Main.Part9.cs:2531 YxwyUefOyQ / 2510 method_257). No DOM.

import { AutomationLevel, type Empire } from '../../sim/empire';
import { DEFAULT_GAME_OPTIONS_AUTOMATION, type GameOptionsAutomation } from '../../sim/game';
import type { EmpireSettingField } from '../../sim/player/empireSettings';
import { DESIGN_UPGRADE_KEYS, applyDesignUpgradePoliciesToGameOptions, type EmpirePolicy } from '../../sim/data/policies';
import { AUTOMATION_ROWS, automationValue, type AutomationField, type MessageOptionRow, MESSAGE_OPTION_ROWS } from './gameOptionsPanel';

/** One Automation control's value as the window holds it: the combo index (0 manual, 1 suggest, 2 full) or the check. */
export type AutomationValues = Record<AutomationField, number | boolean>;

/** cmbOptionsAutomationMode items (Main.Part3.cs:1059-1070). Index 0 "(Custom)" is shown when no preset matches. */
export const AUTOMATION_MODE_ITEMS = ['(Custom)', 'Default', 'Expert (none)', 'Rule in Absence (full)', 'Expansion', 'War and Combat', 'Diplomacy', 'Spy Master'] as const;

const M = 0;
const S = 1;
const F = 2;

/** A preset in GameOptions terms (Control*Default), statement order of the C# builders. */
function preset(o: {
    attacks: number;
    colonization: number;
    taxRates: boolean;
    shipBuilding: number;
    shipDesign: boolean;
    gifts: number;
    warTrade: number;
    treaties: number;
    fleets: boolean;
    troops: boolean;
    agents: number;
    research: boolean;
    facilities: number;
    population: boolean;
    characters: boolean;
    pirateMissions: number;
}): AutomationValues {
    return {
        controlMilitaryAttacks: o.attacks,
        controlColonization: o.colonization,
        controlColonyTaxRates: o.taxRates,
        controlStateConstruction: o.shipBuilding,
        controlDesigns: o.shipDesign,
        controlDiplomacyGifts: o.gifts,
        controlDiplomacyOffense: o.warTrade,
        controlDiplomacyTreaties: o.treaties,
        controlMilitaryFleets: o.fleets,
        controlTroopGeneration: o.troops,
        controlAgentAssignment: o.agents,
        controlResearch: o.research,
        controlColonyFacilities: o.facilities,
        controlPopulationPolicy: o.population,
        controlCharacterLocations: o.characters,
        controlOfferPirateMissions: o.pirateMissions,
    };
}

/** Port of Main.Part6.cs method_406 / 407 / 408 / 409 / LrAjSoHuFL / 410 / 411, keyed by the mode combo index. */
export const AUTOMATION_PRESETS: Readonly<Record<number, AutomationValues>> = {
    // 1 Default — method_408.
    1: preset({ agents: S, attacks: S, colonization: F, taxRates: true, gifts: M, fleets: true, shipBuilding: S, shipDesign: true, treaties: S, troops: true, warTrade: S, research: true, facilities: S, population: false, characters: true, pirateMissions: S }),
    // 2 Expert (none) — method_407.
    2: preset({ attacks: M, colonization: M, taxRates: false, shipBuilding: M, shipDesign: false, gifts: M, warTrade: M, treaties: M, fleets: false, troops: false, agents: M, research: false, facilities: M, population: false, characters: false, pirateMissions: M }),
    // 3 Rule in Absence (full) — method_406.
    3: preset({ attacks: F, colonization: F, taxRates: true, shipBuilding: F, shipDesign: true, gifts: F, warTrade: F, treaties: F, fleets: true, troops: true, agents: F, research: true, facilities: F, population: true, characters: true, pirateMissions: F }),
    // 4 Expansion — method_409.
    4: preset({ attacks: F, colonization: S, taxRates: true, shipBuilding: S, shipDesign: true, gifts: M, warTrade: F, treaties: S, fleets: true, troops: true, agents: F, research: true, facilities: S, population: false, characters: true, pirateMissions: S }),
    // 5 War and Combat — LrAjSoHuFL.
    5: preset({ attacks: S, colonization: F, taxRates: true, shipBuilding: F, shipDesign: true, gifts: M, warTrade: S, treaties: F, fleets: true, troops: true, agents: S, research: true, facilities: F, population: true, characters: true, pirateMissions: S }),
    // 6 Diplomacy — method_410.
    6: preset({ attacks: S, colonization: F, taxRates: true, shipBuilding: F, shipDesign: true, gifts: S, warTrade: S, treaties: S, fleets: true, troops: true, agents: F, research: true, facilities: F, population: false, characters: true, pirateMissions: S }),
    // 7 Spy Master — method_411.
    7: preset({ attacks: F, colonization: F, taxRates: true, shipBuilding: F, shipDesign: true, gifts: M, warTrade: F, treaties: F, fleets: true, troops: true, agents: S, research: true, facilities: F, population: true, characters: true, pirateMissions: S }),
};

/** The window's Automation values for an empire (method_421 / method_412). */
export function empireAutomationValues(empire: Empire): AutomationValues {
    const out = {} as AutomationValues;
    for (const row of AUTOMATION_ROWS) out[row.field] = automationValue(empire, row);
    return out;
}

/** GameOptions.CompareAutomationEquality over the 16 controls. */
export function automationValuesEqual(a: AutomationValues, b: AutomationValues): boolean {
    return AUTOMATION_ROWS.every((r) => (r.kind === 'bool' ? Boolean(a[r.field]) === Boolean(b[r.field]) : Number(a[r.field]) === Number(b[r.field])));
}

/** Port of Main.Part6.cs:1994 UhvjHxwqlt: the mode combo index for the current controls — the first preset they equal,
 *  in the C#'s test order (Default, Expert, Rule in Absence, Expansion, War and Combat, Diplomacy, Spy Master), else 0. */
export function detectAutomationMode(values: AutomationValues): number {
    for (const i of [1, 2, 3, 4, 5, 6, 7]) if (automationValuesEqual(values, AUTOMATION_PRESETS[i])) return i;
    return 0;
}

/** Main.Part4.cs:4472-4549 method_566: the Message Settings rows top to bottom (both columns use the same order). */
export const MESSAGE_SETTINGS_ORDER: readonly string[] = [
    'New Ship Built',
    'Requests, Warnings and Gifts',
    'Treaty offers',
    'War and Trade Sanctions',
    'Colony Gain or Loss',
    'Empire Discovery',
    'Research Breakthrough',
    'Intelligence Missions',
    'Exploration discoveries',
    'Ship Mission Complete',
    'Ship Needs Refuelling or Repair',
    'Under Attack - Civilian Ships',
    'Under Attack - Civilian Bases',
    'Under Attack - Exploration Ships',
    'Under Attack - Colony & Construction Ships',
    'Under Attack - Military Ships',
    'Under Attack - Research, Monitoring, Resorts',
    'Under Attack - Colonies & Spaceports',
    'Construction Resource Shortage',
];

/** MESSAGE_OPTION_ROWS in the Message Settings window's order. */
export function messageSettingsRows(): MessageOptionRow[] {
    return MESSAGE_SETTINGS_ORDER.map((label) => {
        const row = MESSAGE_OPTION_ROWS.find((r) => r.label === label);
        if (row === undefined) throw new Error(`message option row "${label}" missing`);
        return row;
    });
}

// ---------------------------------------------------------------------------
// New-game defaults (GameOptions *Default fields)
// ---------------------------------------------------------------------------

/** Empire field values the window issued as commands this session (they apply at the next frame boundary, and in
 *  worker mode reach the replica later still): they win over the empire's current values when the defaults are read. */
export type PendingEmpireValues = Partial<Record<AutomationField | EmpireSettingField, number | boolean>>;

/**
 * Port of Main.Part9.cs:2531 YxwyUefOyQ, the PlayerEmpire part (statement order), plus Main.Part4.cs:4319-4320 (method_558
 * also writes gameOptions_0.FleetAttackRefuelPortion / GatherPortion): the GameOptions defaults taken from the player
 * empire when the Options window closes (Main.Part6.cs:2540, method_418's tail; method_257 then saves the file).
 */
export function gameOptionsFromEmpire(empire: Empire, pending: PendingEmpireValues = {}): GameOptionsAutomation {
    const num = (f: AutomationField | EmpireSettingField): number => {
        const p = pending[f];
        return typeof p === 'number' ? p : Number((empire as unknown as Record<string, number>)[f]);
    };
    const bool = (f: AutomationField | EmpireSettingField): boolean => {
        const p = pending[f];
        return typeof p === 'boolean' ? p : Boolean((empire as unknown as Record<string, boolean>)[f]);
    };
    return {
        controlAgentAssignmentDefault: num('controlAgentAssignment') as AutomationLevel,
        controlAttacksOnEnemiesDefault: num('controlMilitaryAttacks') as AutomationLevel,
        controlColonizationDefault: num('controlColonization') as AutomationLevel,
        controlColonyTaxRatesDefault: bool('controlColonyTaxRates'),
        controlDiplomaticGiftsDefault: num('controlDiplomacyGifts') as AutomationLevel,
        controlFleetFormationDefault: bool('controlMilitaryFleets'),
        controlShipBuildingDefault: num('controlStateConstruction') as AutomationLevel,
        controlShipDesignDefault: bool('controlDesigns'),
        controlTreatyNegotiationDefault: num('controlDiplomacyTreaties') as AutomationLevel,
        controlTroopRecruitmentDefault: bool('controlTroopGeneration'),
        controlCharacterLocationsDefault: bool('controlCharacterLocations'),
        controlWarTradeSanctionsDefault: num('controlDiplomacyOffense') as AutomationLevel,
        controlResearchDefault: bool('controlResearch'),
        controlColonyFacilitiesDefault: num('controlColonyFacilities') as AutomationLevel,
        controlPopulationPolicyDefault: bool('controlPopulationPolicy'),
        controlOfferPirateMissionsDefault: num('controlOfferPirateMissions') as AutomationLevel,
        attackRangePatrol: num('attackRangePatrol'),
        attackRangeEscort: num('attackRangeEscort'),
        attackRangeAttack: num('attackRangeAttack'),
        attackRangeOther: num('attackRangeOther'),
        attackRangePatrolManual: num('attackRangePatrolManual'),
        attackRangeEscortManual: num('attackRangeEscortManual'),
        attackRangeAttackManual: num('attackRangeAttackManual'),
        attackRangeOtherManual: num('attackRangeOtherManual'),
        attackOverMatchFactor: num('attackOvermatchFactor'),
        fleetAttackRefuelPortion: num('fleetAttackRefuelPortion'),
        fleetAttackGatherPortion: num('fleetAttackGatherPortion'),
        discoveryActionRuin: num('discoveryActionRuin'),
        discoveryActionAbandonedShipBase: num('discoveryActionAbandonedShipBase'),
        newShipsAutomated: bool('newShipsAutomated'),
    };
}

/**
 * Main.Part9.cs:2491 method_256's counterpart for "defaultOptions" (the GameOptions file read at start-up, else
 * method_260's defaults): the saved defaults (ui/settings.ts newGameOptions) as createGame's `gameOptions`, field by
 * field over DEFAULT_GAME_OPTIONS_AUTOMATION (a missing or mistyped field keeps its default; an AutomationLevel outside
 * the enum is Manual, as method_419 maps an unknown index). Undefined when nothing was saved.
 */
export function newGameOptionsFromSettings(stored: Readonly<Record<string, number | boolean>> | null): GameOptionsAutomation | undefined {
    if (stored === null) return undefined;
    const out = { ...DEFAULT_GAME_OPTIONS_AUTOMATION } as GameOptionsAutomation;
    const rec = out as unknown as Record<string, number | boolean>;
    for (const key of Object.keys(DEFAULT_GAME_OPTIONS_AUTOMATION)) {
        const v = stored[key];
        const d = rec[key];
        if (typeof v !== typeof d || (typeof v === 'number' && !Number.isFinite(v))) continue;
        if (key.startsWith('control') && typeof v === 'number') {
            rec[key] = v === AutomationLevel.PartiallyAutomated || v === AutomationLevel.FullyAutomated ? v : AutomationLevel.Undefined;
        } else rec[key] = v;
    }
    // GameOptions.DesignUpgrade* (default true; saved by the Empire Policy screen): kept when boolean.
    for (const key of DESIGN_UPGRADE_KEYS) if (typeof stored[key] === 'boolean') out[key] = stored[key] as boolean;
    return out;
}

/** Port of Start.1.cs:2353 method_171: an AutomationLevel as the combo index (Manual 0, SemiAutomated 1, FullyAutomated 2). */
export function automationLevelToIndex(level: AutomationLevel): number {
    return level === AutomationLevel.PartiallyAutomated ? 1 : level === AutomationLevel.FullyAutomated ? 2 : 0;
}

/** Start.1.cs:1928-1943 (method_155 / PopulateOptionsValues): the main menu Options panel's 16 Automation controls for a GameOptions. */
export function automationValuesFromGameOptions(o: Readonly<GameOptionsAutomation>): AutomationValues {
    const L = automationLevelToIndex;
    return {
        controlMilitaryAttacks: L(o.controlAttacksOnEnemiesDefault),
        controlColonization: L(o.controlColonizationDefault),
        controlColonyTaxRates: o.controlColonyTaxRatesDefault,
        controlStateConstruction: L(o.controlShipBuildingDefault),
        controlDesigns: o.controlShipDesignDefault,
        controlDiplomacyGifts: L(o.controlDiplomaticGiftsDefault),
        controlDiplomacyOffense: L(o.controlWarTradeSanctionsDefault),
        controlDiplomacyTreaties: L(o.controlTreatyNegotiationDefault),
        controlMilitaryFleets: o.controlFleetFormationDefault,
        controlTroopGeneration: o.controlTroopRecruitmentDefault,
        controlAgentAssignment: L(o.controlAgentAssignmentDefault),
        controlResearch: o.controlResearchDefault,
        controlColonyFacilities: L(o.controlColonyFacilitiesDefault),
        controlPopulationPolicy: o.controlPopulationPolicyDefault,
        controlCharacterLocations: o.controlCharacterLocationsDefault,
        controlOfferPirateMissions: L(o.controlOfferPirateMissionsDefault),
    };
}

/** Start.1.cs:2116 method_163 (+ method_170): the 16 Control*Default fields from the panel's controls, the other fields kept. */
export function gameOptionsWithAutomationValues(o: Readonly<GameOptionsAutomation>, v: Readonly<AutomationValues>): GameOptionsAutomation {
    const lv = (x: number | boolean): AutomationLevel => (x === 1 ? AutomationLevel.PartiallyAutomated : x === 2 ? AutomationLevel.FullyAutomated : AutomationLevel.Undefined);
    return {
        ...o,
        controlAttacksOnEnemiesDefault: lv(v.controlMilitaryAttacks),
        controlColonizationDefault: lv(v.controlColonization),
        controlColonyTaxRatesDefault: Boolean(v.controlColonyTaxRates),
        controlShipBuildingDefault: lv(v.controlStateConstruction),
        controlShipDesignDefault: Boolean(v.controlDesigns),
        controlDiplomaticGiftsDefault: lv(v.controlDiplomacyGifts),
        controlWarTradeSanctionsDefault: lv(v.controlDiplomacyOffense),
        controlTreatyNegotiationDefault: lv(v.controlDiplomacyTreaties),
        controlFleetFormationDefault: Boolean(v.controlMilitaryFleets),
        controlTroopRecruitmentDefault: Boolean(v.controlTroopGeneration),
        controlAgentAssignmentDefault: lv(v.controlAgentAssignment),
        controlResearchDefault: Boolean(v.controlResearch),
        controlColonyFacilitiesDefault: lv(v.controlColonyFacilities),
        controlPopulationPolicyDefault: Boolean(v.controlPopulationPolicy),
        controlCharacterLocationsDefault: Boolean(v.controlCharacterLocations),
        controlOfferPirateMissionsDefault: lv(v.controlOfferPirateMissions),
    };
}

/** The saved defaults as a full GameOptions (method_260's defaults for what was never saved). */
export function currentNewGameOptions(stored: Readonly<Record<string, number | boolean>> | null): GameOptionsAutomation {
    return newGameOptionsFromSettings(stored) ?? { ...DEFAULT_GAME_OPTIONS_AUTOMATION };
}

/** The settings map for a GameOptions (settings.newGameOptions; design-upgrade flags only when not the default true). */
export function newGameOptionsToSettings(o: Readonly<GameOptionsAutomation>): Record<string, number | boolean> {
    const out: Record<string, number | boolean> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    return out;
}

/** The 14 Control*Default fields Main.Part3.cs:4179-4192 (method_597's tail) copies from the player empire. */
const POLICY_APPLY_DEFAULTS: readonly [AutomationField, keyof GameOptionsAutomation, 'level' | 'bool'][] = [
    ['controlAgentAssignment', 'controlAgentAssignmentDefault', 'level'],
    ['controlMilitaryAttacks', 'controlAttacksOnEnemiesDefault', 'level'],
    ['controlColonization', 'controlColonizationDefault', 'level'],
    ['controlColonyFacilities', 'controlColonyFacilitiesDefault', 'level'],
    ['controlColonyTaxRates', 'controlColonyTaxRatesDefault', 'bool'],
    ['controlDiplomacyGifts', 'controlDiplomaticGiftsDefault', 'level'],
    ['controlMilitaryFleets', 'controlFleetFormationDefault', 'bool'],
    ['controlResearch', 'controlResearchDefault', 'bool'],
    ['controlStateConstruction', 'controlShipBuildingDefault', 'level'],
    ['controlDesigns', 'controlShipDesignDefault', 'bool'],
    ['controlDiplomacyTreaties', 'controlTreatyNegotiationDefault', 'level'],
    ['controlTroopGeneration', 'controlTroopRecruitmentDefault', 'bool'],
    ['controlDiplomacyOffense', 'controlWarTradeSanctionsDefault', 'level'],
    ['controlCharacterLocations', 'controlCharacterLocationsDefault', 'bool'],
];

/**
 * Port of Main.Part3.cs:4179-4198 (method_597's tail, run on every Empire Policy apply) and Main.Part3.cs:3840 (after a
 * policy file load: ApplyDesignUpgradePoliciesToGameOptions only): the GameOptions after the screen applied `policy`.
 * `automation` are the values the screen just sent for the empire's controls (they win over the empire, which has not
 * taken them yet: next frame boundary, or a round trip in sim-worker mode); `withControls` false = the load path.
 * TODO(port): gameOptions_0.DefaultEmpirePolicy = policy.Clone() (4196-4198) — never read anywhere in the source.
 */
export function gameOptionsAfterPolicyApply(
    stored: Readonly<Record<string, number | boolean>> | null,
    empire: Empire,
    policy: EmpirePolicy,
    automation: Readonly<Partial<Record<AutomationField, number | boolean>>> | null,
): Record<string, number | boolean> {
    let o = currentNewGameOptions(stored);
    if (automation !== null) {
        const rec = o as unknown as Record<string, number | boolean>;
        for (const [field, key] of POLICY_APPLY_DEFAULTS) {
            const sent = automation[field];
            rec[key] = sent !== undefined ? sent : (empire as unknown as Record<string, number | boolean>)[field];
        }
    }
    o = applyDesignUpgradePoliciesToGameOptions(o, policy);
    return newGameOptionsToSettings(o);
}
