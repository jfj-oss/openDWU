// Pure parts of the Game Options screen (gameOptionsPanel.ts): the Automation "Mode" presets (cmbOptionsAutomationMode,
// Main.Part6.cs:1944-2033 + 2117-2290) and the message-settings order of the original window. No DOM.

import type { Empire } from '../../sim/empire';
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
