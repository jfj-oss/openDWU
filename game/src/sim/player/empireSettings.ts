// The player's "Other Empire Settings" (Game Options → Empire Settings, Main.Part4.cs:4159-4430 method_556-565): the
// default engagement stances (automated and manual, four mission types each), the fleet attack settings (refuel /
// gather portions, attack overmatch), the discovery actions (ruins / abandoned ships and bases) and "Newly built ships
// are automated". These are Empire fields the sim reads (missions/assign.ts, fleets/shipGroupTasks.ts,
// combat/threats.ts, exploration.ts, combat/ownership.ts, construction/empireConstruction.ts), so the UI changes them
// only through the journaled `setEmpireSetting` player command (player/playerOps.ts) — replays stay deterministic.
// Headless: no DOM / Pixi.

import type { Empire } from '../empire';

/** The Empire fields the Empire Settings window writes (method_558, statement order). */
export const EMPIRE_SETTING_FIELDS = [
    'attackRangePatrol',
    'attackRangeEscort',
    'attackRangeAttack',
    'attackRangeOther',
    'attackRangePatrolManual',
    'attackRangeEscortManual',
    'attackRangeAttackManual',
    'attackRangeOtherManual',
    'attackOvermatchFactor',
    'fleetAttackRefuelPortion',
    'fleetAttackGatherPortion',
    'discoveryActionRuin',
    'discoveryActionAbandonedShipBase',
    'newShipsAutomated',
] as const;
export type EmpireSettingField = (typeof EMPIRE_SETTING_FIELDS)[number];

export type AttackRangeField =
    | 'attackRangePatrol'
    | 'attackRangeEscort'
    | 'attackRangeAttack'
    | 'attackRangeOther'
    | 'attackRangePatrolManual'
    | 'attackRangeEscortManual'
    | 'attackRangeAttackManual'
    | 'attackRangeOtherManual';

/** The engagement-stance combo items (Main.Part3.cs:1100 method_583; GameText "No default stance" = "No default stance (no change)"). */
export const ENGAGEMENT_STANCE_ITEMS = ['No default stance (no change)', 'Engage when attacked', 'Engage nearby targets', 'Engage system targets'] as const;

/** Port of Main.Part4.cs:4363 method_563: stance combo index → attack range (-1 none, 0 when attacked, 2000 nearby, 48000 system). */
export function stanceIndexToAttackRange(index: number): number {
    switch (index) {
        case 0:
            return -1;
        case 1:
            return 0;
        case 2:
            return 2000;
        case 3:
            return 48000;
        default:
            return 0;
    }
}

/** Port of Main.Part4.cs:4383 method_564: attack range → stance combo index (-1 = no item, only for an impossible input). */
export function attackRangeToStanceIndex(range: number): number {
    if (range < 0) return 0;
    if (range === 0) return 1;
    if (range >= 0 && range <= 2000) return 2;
    if (range > 2000 && range <= 48000) return 3;
    return -1;
}

/** sldGameOptionsAttackOvermatch labels (Main.Part4.cs:4235 SetLabels). */
export const ATTACK_OVERMATCH_LABELS = ['1:1', '1.5:1', '2:1', '3:1', '5:1'] as const;

/** Port of Main.Part4.cs:4321 method_561: overmatch slider index → AttackOvermatchFactor (default 2f). */
export function overmatchIndexToFactor(index: number): number {
    switch (index) {
        case 0:
            return 1;
        case 1:
            return 1.5;
        case 2:
            return 2;
        case 3:
            return 3;
        case 4:
            return 5;
        default:
            return 2;
    }
}

/** Port of Main.Part4.cs:4344 method_562: AttackOvermatchFactor → slider index (-1 when it is none of the five). */
export function overmatchFactorToIndex(factor: number): number {
    if (factor === 1) return 0;
    if (factor === 1.5) return 1;
    if (factor === 2) return 2;
    if (factor === 3) return 3;
    if (factor === 5) return 4;
    return -1;
}

/** Port of Main.Part4.cs:4309 method_559: a portion (float) → the 0..100 NumericUpDown value. (decimal)(float * 100f)
 *  keeps 7 significant digits (0.3f → 30); the integer spinner shows it rounded. */
export function portionToPercent(portion: number): number {
    return Math.max(0, Math.min(100, Math.round(Math.fround(portion * 100))));
}

/** Port of Main.Part4.cs:4315 method_560: the 0..100 NumericUpDown value → a portion, (float)(value / 100.0) clamped 0..1. */
export function percentToPortion(percent: number): number {
    return Math.max(0, Math.min(1, Math.fround(percent / 100)));
}

/** cmbGameOptionsEncounterRuins items (Main.Part3.cs:646). Index = Empire.DiscoveryActionRuin. */
export const DISCOVERY_RUIN_ITEMS = [
    'Ask what to do',
    'Investigate - show all results',
    'Investigate - report discoveries',
    'Investigate - report major discoveries',
    'Investigate - do not show results',
] as const;

/** cmbGameOptionsEncounterAbandonedShipOrBase items (Main.Part3.cs:639). Index = Empire.DiscoveryActionAbandonedShipBase. */
export const DISCOVERY_ABANDONED_ITEMS = ['Ask what to do', 'Investigate - show all results', 'Investigate - do not show results'] as const;

/** Main.Part2.cs:4098-4137 / Main.Part4.cs:4290-4300: with "Suppress all pop-up screens" on, "Ask what to do" is not
 *  allowed — the combo moves to Math.Max(1, current empire value). */
export function discoveryIndexWithSuppressedPopups(selected: number, empireValue: number, suppressAllPopups: boolean): number {
    if (suppressAllPopups && selected < 1) return Math.max(1, empireValue);
    return selected;
}

function isAttackRangeField(f: string): f is AttackRangeField {
    return f.startsWith('attackRange');
}

/**
 * The value `field` takes for `value`, or null when it is not a value the window can produce (rejected, so a bad or
 * hand-edited command cannot put the sim in a state the UI cannot show). Attack ranges are integers >= -1; the
 * overmatch is one of the slider's five factors; portions are floats in 0..1 (method_560 clamps); the discovery actions
 * are combo indices; NewShipsAutomated is a boolean.
 */
export function empireSettingValue(field: string, value: unknown): number | boolean | null {
    if (!(EMPIRE_SETTING_FIELDS as readonly string[]).includes(field)) return null;
    if (field === 'newShipsAutomated') return typeof value === 'boolean' ? value : null;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (isAttackRangeField(field)) return Number.isInteger(value) && value >= -1 ? value : null;
    switch (field) {
        case 'attackOvermatchFactor':
            return overmatchFactorToIndex(value) >= 0 ? value : null;
        case 'fleetAttackRefuelPortion':
        case 'fleetAttackGatherPortion':
            return Math.fround(Math.max(0, Math.min(1, value)));
        case 'discoveryActionRuin':
            return Number.isInteger(value) && value >= 0 && value < DISCOVERY_RUIN_ITEMS.length ? value : null;
        case 'discoveryActionAbandonedShipBase':
            return Number.isInteger(value) && value >= 0 && value < DISCOVERY_ABANDONED_ITEMS.length ? value : null;
    }
    return null;
}

/** Port of Main.Part4.cs:4271 method_558 for one control: `_Game.PlayerEmpire.<field> = value`. False when rejected. */
export function applyEmpireSetting(empire: Empire, field: string, value: unknown): boolean {
    const v = empireSettingValue(field, value);
    if (v === null) return false;
    (empire as unknown as Record<string, unknown>)[field] = v;
    return true;
}

/** The current value of every Empire Settings field (method_557 reads these). */
export function readEmpireSettings(empire: Empire): Record<EmpireSettingField, number | boolean> {
    const out = {} as Record<EmpireSettingField, number | boolean>;
    for (const f of EMPIRE_SETTING_FIELDS) out[f] = (empire as unknown as Record<string, number | boolean>)[f];
    return out;
}
