// The main menu's Options panel part that edits the new-game defaults (Start.1.cs:1928-1960 method_155 fills the Automation
// controls of pnlGameOptions from a GameOptions, uwcbgxAbxH re-picks the Mode, method_163 reads them back, method_164 saves on
// close; Start.1.cs:2730 method_181 for the Empire Settings window). Before a game exists there is no player empire: the
// controls edit settings.newGameOptions directly (the GameOptions the next new game starts from, main.ts), the same record the
// in-game Options window writes on close (gameOptionsPanel.ts). Same layout and controls as that window's Automation group.
// TODO(port): the message-settings defaults (Start.1.cs:2480 method_167/168 Display* fields) — not saved with the defaults.

import { type GameOptionsAutomation } from '../../sim/game';
import {
    ATTACK_OVERMATCH_LABELS,
    DISCOVERY_ABANDONED_ITEMS,
    DISCOVERY_RUIN_ITEMS,
    ENGAGEMENT_STANCE_ITEMS,
    attackRangeToStanceIndex,
    overmatchFactorToIndex,
    overmatchIndexToFactor,
    percentToPortion,
    portionToPercent,
    stanceIndexToAttackRange,
} from '../../sim/player/empireSettings';
import { getSettings, updateSettings } from '../settings';
import { numericUpDown, openOriginalWindow, place, type OriginalWindow } from '../originalWindow';
import { groupBox, labelledTrackBar } from '../originalWindowControls';
import { F19, F2, F4, F7, AUTOMATION_ROWS, button, check, combo, label, rightLabel, type AutomationField } from './gameOptionsPanel';
import {
    AUTOMATION_MODE_ITEMS,
    AUTOMATION_PRESETS,
    automationValuesFromGameOptions,
    currentNewGameOptions,
    detectAutomationMode,
    gameOptionsWithAutomationValues,
    newGameOptionsToSettings,
    type AutomationValues,
} from './gameOptionsModel';

/** Save the edited GameOptions as the next new game's defaults (method_164 → ApplyOptionsValues / method_257). */
export function saveNewGameOptions(o: Readonly<GameOptionsAutomation>): void {
    updateSettings({ newGameOptions: newGameOptionsToSettings(o) });
}

/** cmbOptionsAutomationMode_SelectedIndexChanged (Start.1.cs:1736-1772): the preset's values over the controls; "(Custom)" does nothing. */
export function applyAutomationModeToGameOptions(o: Readonly<GameOptionsAutomation>, modeIndex: number): GameOptionsAutomation {
    const preset = AUTOMATION_PRESETS[modeIndex];
    return preset === undefined ? { ...o } : gameOptionsWithAutomationValues(o, preset);
}

/** One Automation control edited: method_163 reads every control back, so the other fields keep their values. */
export function setGameOptionsControl(o: Readonly<GameOptionsAutomation>, field: AutomationField, value: number | boolean): GameOptionsAutomation {
    return gameOptionsWithAutomationValues(o, { ...automationValuesFromGameOptions(o), [field]: value });
}

const OPTIONS_W = 700;
const AUTOMATION_H = 291;
const EMPIRE_W = 500;
const EMPIRE_H = 700;

let openWin: OriginalWindow | null = null;
let openEmpireWin: OriginalWindow | null = null;

/** Open the "Automation" new-game defaults window (the main menu's Options panel). Brings it to the front when open. */
export function openNewGameDefaultsPanel(): OriginalWindow {
    if (openWin && !openWin.closed) {
        document.body.appendChild(openWin.root);
        return openWin;
    }
    // The GameOptions being edited, as the saved defaults give it (method_260's defaults when none were saved).
    let go = currentNewGameOptions(getSettings().newGameOptions);
    const commit = (next: GameOptionsAutomation): void => {
        go = next;
        saveNewGameOptions(go);
    };
    const win = openOriginalWindow({
        id: 'newgame-defaults',
        title: 'Options',
        icon: 'gameOptions.png',
        width: OPTIONS_W,
        height: AUTOMATION_H + 59 + 70,
        onClose: () => {
            openEmpireWin?.close();
            openWin = null;
        },
    });
    openWin = win;
    const body = win.body;
    body.classList.add('go-body');
    label(body, 'These are the settings your next new game starts with.', 14, 8, F4 - 3);

    // grpOptionsControl "Automation" (12, 288 in the game window; here at the top) 659 × 291.
    const g = place(groupBox('Automation', 659, AUTOMATION_H, F2), 12, 36);
    body.appendChild(g);
    const modePanel = place(document.createElement('div'), 10, 21, 217, 41);
    modePanel.className = 'go-mode-panel';
    g.appendChild(modePanel);
    label(modePanel, 'Mode', 5, 9, F7, true);
    const values: AutomationValues = automationValuesFromGameOptions(go);
    const controls = new Map<AutomationField, HTMLSelectElement | HTMLInputElement>();
    const mode = combo(g, AUTOMATION_MODE_ITEMS, detectAutomationMode(values), 58, 25, 162, 24, (i) => {
        const preset = AUTOMATION_PRESETS[i];
        if (preset === undefined) return; // "(Custom)"
        commit(applyAutomationModeToGameOptions(go, i));
        // method_155: every control shown from the preset, without re-detecting.
        for (const row of AUTOMATION_ROWS) {
            values[row.field] = preset[row.field];
            const c = controls.get(row.field);
            if (c instanceof HTMLSelectElement) c.value = String(preset[row.field]);
            else if (c) c.checked = Boolean(preset[row.field]);
        }
    });
    mode.dataset.go = 'mode';
    const edited = (row: (typeof AUTOMATION_ROWS)[number], v: number | boolean): void => {
        values[row.field] = v;
        commit(setGameOptionsControl(go, row.field, v));
        mode.value = String(detectAutomationMode(values)); // uwcbgxAbxH
    };
    const checkY: Partial<Record<AutomationField, number>> = {
        controlColonyTaxRates: 73, controlPopulationPolicy: 96, controlDesigns: 119, controlTroopGeneration: 142,
        controlMilitaryFleets: 165, controlResearch: 188, controlCharacterLocations: 211,
    };
    const comboRows: [AutomationField, number, number][] = [
        ['controlColonization', 23, 19], ['controlStateConstruction', 52, 48], ['controlAgentAssignment', 81, 77],
        ['controlMilitaryAttacks', 110, 106], ['controlDiplomacyGifts', 139, 135], ['controlDiplomacyTreaties', 168, 164],
        ['controlDiplomacyOffense', 197, 193], ['controlColonyFacilities', 226, 222], ['controlOfferPirateMissions', 255, 251],
    ];
    for (const row of AUTOMATION_ROWS) {
        if (row.kind !== 'bool') continue;
        const c = check(g, row.label, values[row.field] === true, 9, checkY[row.field] ?? 0, (v) => edited(row, v));
        controls.set(row.field, c.querySelector('input')!);
    }
    for (const [field, ly, cy] of comboRows) {
        const row = AUTOMATION_ROWS.find((r) => r.field === field)!;
        const wide = field === 'controlAgentAssignment';
        rightLabel(g, row.label, wide ? 186 : 191, ly - 2, wide ? 241 : 236, 21);
        controls.set(field, combo(g, row.options ?? [], Number(values[field]), 429, cy, 220, 24, (i) => edited(row, i)));
    }
    button(g, 'Empire Settings', 7, 250, 179, 35, () => openNewGameEmpireSettings(() => go, commit));
    return win;
}

/** Start.1.cs:2730 method_181 / 174: the Empire Settings window over the GameOptions (stances, fleet attack, overmatch, discoveries, new ships). */
function openNewGameEmpireSettings(get: () => GameOptionsAutomation, commit: (o: GameOptionsAutomation) => void): void {
    if (openEmpireWin && !openEmpireWin.closed) {
        document.body.appendChild(openEmpireWin.root);
        return;
    }
    const win = openOriginalWindow({ id: 'newgame-defaults-empire', title: 'Your Empire Settings', width: EMPIRE_W, height: EMPIRE_H, onClose: () => (openEmpireWin = null) });
    openEmpireWin = win;
    const body = win.body;
    body.classList.add('go-body');
    const set = <K extends keyof GameOptionsAutomation>(k: K, v: GameOptionsAutomation[K]): void => commit({ ...get(), [k]: v });
    type RangeKey = 'attackRangePatrol' | 'attackRangeEscort' | 'attackRangeAttack' | 'attackRangeOther' | 'attackRangePatrolManual' | 'attackRangeEscortManual' | 'attackRangeAttackManual' | 'attackRangeOtherManual';
    const stances: [string, RangeKey[]][] = [
        ['Default Engagement Stances - Auto', ['attackRangePatrol', 'attackRangeEscort', 'attackRangeAttack', 'attackRangeOther']],
        ['Default Engagement Stances - Manual', ['attackRangePatrolManual', 'attackRangeEscortManual', 'attackRangeAttackManual', 'attackRangeOtherManual']],
    ];
    const missionLabels = ['Patrol', 'Escort', 'Attack/Bombard', 'Other'];
    stances.forEach(([caption, fields], gi) => {
        const g = place(groupBox(caption, 465, 156, F19), 10, gi === 0 ? 10 : 177);
        body.appendChild(g);
        fields.forEach((field, i) => {
            label(g, missionLabels[i], 10, 29 + 31 * i);
            combo(g, ENGAGEMENT_STANCE_ITEMS, attackRangeToStanceIndex(get()[field]), 140, 25 + 31 * i, 230, 21, (idx) => set(field, stanceIndexToAttackRange(idx)));
        });
    });
    const fleet = place(groupBox('Fleet Attack Settings', 465, 90, F19), 10, 344);
    body.appendChild(fleet);
    const portion = (field: 'fleetAttackRefuelPortion' | 'fleetAttackGatherPortion', y: number, caption: string): void => {
        const n = numericUpDown({ value: portionToPercent(get()[field]), min: 0, max: 100, size: F4 - 4, onChange: (v) => set(field, percentToPortion(v)) });
        fleet.appendChild(place(n.el, 10, y, 45, 21));
        label(fleet, caption, 60, y + 2);
    };
    portion('fleetAttackRefuelPortion', 25, 'First refuel when this percentage of fleet need fuel');
    portion('fleetAttackGatherPortion', 56, 'First assemble when this percentage of fleet dispersed');
    const overmatch = labelledTrackBar({
        width: 465, height: 62, labelText: 'Attack Overmatch', labelWidth: 120, labels: ATTACK_OVERMATCH_LABELS,
        value: Math.max(0, overmatchFactorToIndex(get().attackOverMatchFactor)), size: F4,
        onChange: (i) => set('attackOverMatchFactor', overmatchIndexToFactor(i)),
    });
    body.appendChild(place(overmatch.el, 10, 458));
    const disc = place(groupBox('Discoveries', 465, 99, F19), 10, 537);
    body.appendChild(disc);
    label(disc, 'When encounter Ruins', 7, 23);
    combo(disc, DISCOVERY_RUIN_ITEMS, get().discoveryActionRuin, 198, 18, 260, 21, (i) => set('discoveryActionRuin', i));
    label(disc, 'When encounter Abandoned Ship or Base', 7, 50, F4 - 4);
    combo(disc, DISCOVERY_ABANDONED_ITEMS, get().discoveryActionAbandonedShipBase, 198, 58, 260, 21, (i) => set('discoveryActionAbandonedShipBase', i));
    check(body, 'Newly built ships are automated', get().newShipsAutomated, 10, 645, (v) => set('newShipsAutomated', v));
}
