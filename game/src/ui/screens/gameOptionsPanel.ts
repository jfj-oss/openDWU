// The in-game Game Options screen (O, Escape menu → Options): a port of Main pnlGameOptions and its three sub-windows
// on the shared original-style window module (originalWindow.ts):
//   Options (pnlGameOptions, 700 × 696; layout Main.Part6.cs:1760-1936 method_402, read method_421, apply method_418)
//     Display Settings (Scroll / Zoom Speed, Star Density, GUI Scale, HotKeys, Advanced Settings...), Sound Volume,
//     Auto Save, Auto Pause in Game Screens, Loaded games are paused, Mouse scroll-wheel behavior, Automation (the
//     Mode presets, the 16 controls, Reset Warnings, Empire Settings) and Show Message Settings.
//   Your Empire Settings (pnlGameOptionsEmpireSettings, 500 × 769; Main.Part4.cs:4159-4430 method_556-565): default
//     engagement stances (auto and manual), Fleet Attack Settings, Attack Overmatch, Discoveries, Newly built ships
//     are automated, Suppress all pop-up screens.
//   Message Settings (pnlGameOptionsMessages, 735 × 502; Main.Part4.cs:4460-4577 method_566-567).
//   Advanced Display Settings (pnlGameOptionsAdvancedDisplaySettings, 440 × 500; Main.Part4.cs:4579-4747
//     method_568-569): Maximum Framerate, system nebulae on / detail, Galaxy View - Ship Display.
// Deviations: options apply as they change (the original applies when a window closes); the sim-affecting ones (the
// Automation controls, every Empire Settings value and the message settings) go through journaled player commands
// (setEmpireControl / setEmpireSetting / setMessageOptions), the rest are UI settings (ui/settings.ts). Our own options join the window the original
// would hold them in: GUI Scale is the Expanded build's fourth Display slider (Start.1.cs:1530-1568), the mute boxes
// sit beside the volume sliders, "Auto Pause in Game Screens" (hidden in the original) is shown, the map label /
// overlay / dither toggles are a "Map Display" group under Advanced Display Settings, and "Open messages
// automatically" / the stub count sit under the message columns. "Allow colonization and mining stations in other
// empires systems" is a galaxy-creation option (the original hides it in game, Main.Part4.cs:4245): it is shown
// read-only, reflecting this game's setting.
// Closing the window saves the player empire's settings as the next new game's defaults (YxwyUefOyQ + method_257;
// settings.newGameOptions, read by main.ts for the wizard's games).
// TODO(port): the main menu's Options panel editing those defaults before a game (Start.1.cs:1928-1960) — mainMenu.ts;
// the HotKeys button opens our shortcut list (BaconDistantWorlds/HotKeys remapping is not ported).

import './gameOptionsPanel.css';
import { AutomationLevel, type Empire } from '../../sim/empire';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import {
    ATTACK_OVERMATCH_LABELS,
    DISCOVERY_ABANDONED_ITEMS,
    DISCOVERY_RUIN_ITEMS,
    ENGAGEMENT_STANCE_ITEMS,
    attackRangeToStanceIndex,
    discoveryIndexWithSuppressedPopups,
    overmatchFactorToIndex,
    overmatchIndexToFactor,
    percentToPortion,
    portionToPercent,
    stanceIndexToAttackRange,
    type AttackRangeField,
    type EmpireSettingField,
} from '../../sim/player/empireSettings';
import { clampAutoSaveMinutes, clampMaximumFramerate, getSettings, resetAutomationResponses, updateSettings, type GalaxyViewDisplayKey, type UiSettings } from '../settings';
import { copyMessageOptions, getMessageOptions, MessageCategory, setMessageOption, setSuppressAllPopups, type MessageOptions } from '../messageRouting';
import { COLORS, checkBox, dropDown, el, glassButton, messageBox, numericUpDown, openOriginalWindow, place, text, type OriginalWindow } from '../originalWindow';
import { checkBoxRight, colorSlider, groupBox, labelledTrackBar } from '../originalWindowControls';
import { improvementsOptionsGroup, improvementsOptionsGroupHeight } from '../improvements'; // [dw2overlays]
import { AUTOMATION_MODE_ITEMS, AUTOMATION_PRESETS, detectAutomationMode, empireAutomationValues, gameOptionsFromEmpire, messageSettingsRows, type PendingEmpireValues } from './gameOptionsModel';

export type AutomationField =
    | 'controlMilitaryAttacks'
    | 'controlColonization'
    | 'controlColonyTaxRates'
    | 'controlStateConstruction'
    | 'controlDesigns'
    | 'controlDiplomacyGifts'
    | 'controlDiplomacyOffense'
    | 'controlDiplomacyTreaties'
    | 'controlMilitaryFleets'
    | 'controlTroopGeneration'
    | 'controlAgentAssignment'
    | 'controlResearch'
    | 'controlColonyFacilities'
    | 'controlPopulationPolicy'
    | 'controlCharacterLocations'
    | 'controlOfferPirateMissions';

export interface AutomationRow {
    field: AutomationField;
    label: string;
    kind: 'level' | 'bool';
    options?: readonly [string, string, string];
}

const level = (field: AutomationField, label: string, middle: string): AutomationRow => ({
    field,
    label,
    kind: 'level',
    options: ['Control manually', middle, 'Fully automate'],
});
const bool = (field: AutomationField, label: string): AutomationRow => ({ field, label, kind: 'bool' });

// Main.Part6.cs:2524-2539 (order); labels Main.Part3.cs:613-633, 781-787, 928-933; select items
// Main.InitializeComponent.cs:10915-11165, Main.Part3.cs:624-637.
export const AUTOMATION_ROWS: readonly AutomationRow[] = [
    level('controlMilitaryAttacks', 'Attacks Against Enemies', 'Suggest attack targets'),
    level('controlColonization', 'Colonization', 'Suggest new colonies'),
    bool('controlColonyTaxRates', 'Colony Tax Rates'),
    level('controlStateConstruction', 'Ship Building', 'Suggest new ships and bases'),
    bool('controlDesigns', 'Ship Design'),
    level('controlDiplomacyGifts', 'Sending Diplomatic Gifts', 'Suggest gifts to empires'),
    level('controlDiplomacyOffense', 'War and Trade Sanctions', 'Suggest war and trade sanctions'),
    level('controlDiplomacyTreaties', 'Treaties', 'Suggest new treaties'),
    bool('controlMilitaryFleets', 'Fleet Formation'),
    bool('controlTroopGeneration', 'Troop Recruitment'),
    level('controlAgentAssignment', 'Intelligence Missions', 'Suggest offensive missions'),
    bool('controlResearch', 'Research'),
    level('controlColonyFacilities', 'Colony Facility Building', 'Suggest new colony facilities'),
    bool('controlPopulationPolicy', 'Colony Population Policies'),
    bool('controlCharacterLocations', 'Character Locations'),
    level('controlOfferPirateMissions', 'Offer Pirate Missions', 'Suggest pirate missions'),
];

type LevelField =
    | 'controlMilitaryAttacks'
    | 'controlColonization'
    | 'controlStateConstruction'
    | 'controlDiplomacyGifts'
    | 'controlDiplomacyOffense'
    | 'controlDiplomacyTreaties'
    | 'controlAgentAssignment'
    | 'controlColonyFacilities'
    | 'controlOfferPirateMissions';
type BoolField = Exclude<AutomationField, LevelField>;

const LEVEL_FIELDS: Record<LevelField, true> = {
    controlMilitaryAttacks: true,
    controlColonization: true,
    controlStateConstruction: true,
    controlDiplomacyGifts: true,
    controlDiplomacyOffense: true,
    controlDiplomacyTreaties: true,
    controlAgentAssignment: true,
    controlColonyFacilities: true,
    controlOfferPirateMissions: true,
};

function isLevelField(f: AutomationField): f is LevelField {
    return Object.prototype.hasOwnProperty.call(LEVEL_FIELDS, f);
}

/** The field's current value: AutomationLevel as 0/1/2 for level rows, a boolean otherwise. */
export function automationValue(empire: Empire, row: AutomationRow): number | boolean {
    const f = row.field;
    if (isLevelField(f)) return empire[f];
    return empire[f as BoolField];
}

// Port of Main.Part6.cs:2544 method_419: 0 → Manual, 1 → SemiAutomated, 2 → FullyAutomated, else Manual.
function method419(index: number): AutomationLevel {
    switch (index) {
        case 1:
            return AutomationLevel.PartiallyAutomated;
        case 2:
            return AutomationLevel.FullyAutomated;
        default:
            return AutomationLevel.Undefined;
    }
}

/** Port of Main.Part6.cs:2524-2539: the Empire field and value one Automation control sets. */
export function automationFieldValue(row: AutomationRow, value: number | boolean): { field: AutomationField; value: AutomationLevel | boolean } {
    const f = row.field;
    return isLevelField(f) ? { field: f, value: method419(typeof value === 'number' ? value : Number(value)) } : { field: f, value: Boolean(value) };
}

// Port of Main.Part6.cs:2524-2539: apply one Automation control to the player empire.
export function setAutomationValue(empire: Empire, row: AutomationRow, value: number | boolean): void {
    const fv = automationFieldValue(row, value);
    (empire as unknown as Record<string, unknown>)[fv.field] = fv.value;
}

/** The same through the command log (queued, applied at the next frame boundary); the value is also kept as pending
 *  for the new-game defaults the window saves on close. */
function issueAutomationValue(empire: Empire, row: AutomationRow, value: number | boolean): void {
    const fv = automationFieldValue(row, value);
    pendingEmpireValues[fv.field] = fv.value;
    issuePlayerCommand(empire.galaxy, empire, 'setEmpireControl', [fv.field, fv.value]);
}

export interface MessageOptionRow {
    label: string;
    categories: readonly MessageCategory[];
}

// Main.Part3.cs:934-972 (labels) and Main.Part6.cs:2406-2489 (bindings).
export const MESSAGE_OPTION_ROWS: readonly MessageOptionRow[] = [
    { label: 'New Ship Built', categories: [MessageCategory.BuiltObjectBuilt] },
    { label: 'Colony Gain or Loss', categories: [MessageCategory.ColonyInvaded, MessageCategory.NewColony] },
    { label: 'Empire Discovery', categories: [MessageCategory.DiplomacyEmpireMetDestroyed] },
    { label: 'Requests, Warnings and Gifts', categories: [MessageCategory.DiplomacyRequestWarning, MessageCategory.DiplomacyGift] },
    { label: 'Treaty offers', categories: [MessageCategory.DiplomacyTreaty] },
    { label: 'War and Trade Sanctions', categories: [MessageCategory.DiplomacyWarTradeSanctions] },
    { label: 'Research Breakthrough', categories: [MessageCategory.ResearchNewComponent] },
    { label: 'Intelligence Missions', categories: [MessageCategory.IntelligenceMissions] },
    { label: 'Exploration discoveries', categories: [MessageCategory.Exploration] },
    { label: 'Ship Mission Complete', categories: [MessageCategory.ShipMissionComplete] },
    { label: 'Ship Needs Refuelling or Repair', categories: [MessageCategory.ShipNeedsRefuelling] },
    { label: 'Construction Resource Shortage', categories: [MessageCategory.ConstructionResourceShortage] },
    { label: 'Under Attack - Civilian Ships', categories: [MessageCategory.UnderAttackCivilianShips] },
    { label: 'Under Attack - Civilian Bases', categories: [MessageCategory.UnderAttackCivilianBases] },
    { label: 'Under Attack - Exploration Ships', categories: [MessageCategory.UnderAttackExplorationShips] },
    { label: 'Under Attack - Colony & Construction Ships', categories: [MessageCategory.UnderAttackColonyConstructionShips] },
    { label: 'Under Attack - Military Ships', categories: [MessageCategory.UnderAttackMilitaryShips] },
    { label: 'Under Attack - Research, Monitoring, Resorts', categories: [MessageCategory.UnderAttackOtherStateBases] },
    { label: 'Under Attack - Colonies & Spaceports', categories: [MessageCategory.UnderAttackColoniesSpaceportsDefensiveBases] },
];

/** Main.Part6.cs:2406-2489: each checkbox reads its row's first category. */
export function messageRowValue(options: MessageOptions, row: MessageOptionRow, kind: 'popup' | 'ticker'): boolean {
    return options[kind][row.categories[0]];
}

/** Main.Part6.cs:2406-2489: a checkbox sets every category of its row. */
export function setMessageRowValue(row: MessageOptionRow, kind: 'popup' | 'ticker', value: boolean): void {
    for (const c of row.categories) setMessageOption(kind, c, value);
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export interface GameOptionsPanelOptions {
    empire: Empire;
}

/** GenerateFont sizes the windows use (Main.Part12.cs:1521-1534): font_2, font_4, font_7, the GlassButton font, and
 *  the 19 px bold of the Empire Settings group captions (Main.Part4.cs:4174). */
const F2 = 18.67;
const F4 = 20.77;
const F7 = 16.67;
const FBUTTON = 15.83;
const F19 = 19;

/** pnlGameOptions.Size (method_402) and the sub-windows' (method_556 / 566 / 568). The Empire Settings, Message
 *  Settings and Advanced Display windows are taller than the original's by the rows we add (see the file header). */
const OPTIONS_W = 700;
const OPTIONS_H = 696;
const EMPIRE_W = 500;
const EMPIRE_H = 769 + 25;
const MESSAGES_W = 735;
const MESSAGES_H = 502 + 43;
const ADVANCED_W = 440;
const ADVANCED_H = 500 + 110 + 10 + improvementsOptionsGroupHeight(); // [dw2overlays] + the Improvements group

interface OpenState {
    win: OriginalWindow;
    close: () => void;
}

let open: OpenState | null = null;
/** The open sub-windows (closed with the Options window, like method_413). */
const subWindows = new Map<'empire' | 'messages' | 'advanced', OriginalWindow>();
/** The values this Options session issued as commands (gameOptionsModel.ts gameOptionsFromEmpire). */
let pendingEmpireValues: PendingEmpireValues = {};
/** This game's "Allow colonization and mining stations in other empires systems" start option (main.ts registers it). */
let allowSameSystemSource: (() => boolean | null) | null = null;

/** Open the Game Options window, or close it if it is already open. */
export function toggleGameOptionsPanel(opts: GameOptionsPanelOptions): void {
    if (open) open.close();
    else open = createGameOptionsPanel(opts);
}

/** Open the Game Options window (the Escape menu's Options button); brings it to the front when already open. */
export function openGameOptionsPanel(opts: GameOptionsPanelOptions): void {
    if (open) {
        document.body.appendChild(open.win.root);
        return;
    }
    open = createGameOptionsPanel(opts);
}

/** Close the Game Options window and its sub-windows (no-op when closed). */
export function closeGameOptionsPanel(): void {
    open?.close();
    for (const w of [...subWindows.values()]) w.close();
}

// [leftovers] begin
/** pnlGameOptions.Visible: the autosave waits while the panel is open (Main.Part12.cs:4015). */
export function isGameOptionsPanelOpen(): boolean {
    return open !== null;
}
// [leftovers] end

/** main.ts: where the Empire Settings window reads this game's same-system start option (null = unknown). */
export function setAllowSameSystemSource(source: (() => boolean | null) | null): void {
    allowSameSystemSource = source;
}

/** A label at (x, y) in font_4, (170, 170, 170), no drop shadow (WinForms Label). */
function label(parent: HTMLElement, content: string, x: number, y: number, size = F4, bold = false): HTMLDivElement {
    const t = text(content, { size, bold, color: COLORS.label, shadow: false, className: 'go-label' });
    parent.appendChild(place(t, x, y));
    return t;
}

/** A Label with AutoSize off and TextAlign MiddleRight in a w × h box (method_404). */
function rightLabel(parent: HTMLElement, content: string, x: number, y: number, w: number, h: number): HTMLDivElement {
    const t = text(content, { size: F4, color: COLORS.label, shadow: false, className: 'go-label go-label-right' });
    parent.appendChild(place(t, x, y, w, h));
    return t;
}

/** Combo boxes use font_4 in the source; the Forgotten Futurist line box is taller than the 21 px control, so the
 *  text is drawn at font_8's 18.67 px to keep its descenders inside. */
const FCOMBO = 18.67;

function combo(parent: HTMLElement, items: readonly string[], index: number, x: number, y: number, w: number, h: number, onChange: (i: number) => void, size = FCOMBO): HTMLSelectElement {
    const s = dropDown(
        items.map((label, i) => ({ value: String(i), label })),
        String(index),
        (v) => onChange(Number(v)),
    );
    s.classList.add('go-combo');
    s.style.fontSize = `${size}px`;
    if (index < 0) s.selectedIndex = -1;
    parent.appendChild(place(s, x, y, w, h));
    return s;
}

function check(parent: HTMLElement, content: string, checked: boolean, x: number, y: number, onChange: ((v: boolean) => void) | null, size = F4): HTMLLabelElement {
    const c = checkBox(content, checked, onChange, size);
    c.classList.add('go-check');
    parent.appendChild(place(c, x, y));
    return c;
}

function button(parent: HTMLElement, content: string, x: number, y: number, w: number, h: number, onClick: () => void): HTMLButtonElement {
    const b = glassButton(content, { onClick, size: FBUTTON, className: 'go-button' });
    parent.appendChild(place(b, x, y, w, h));
    return b;
}

function slider(parent: HTMLElement, value: number, min: number, max: number, x: number, y: number, w: number, onChange: (v: number) => void): ReturnType<typeof colorSlider> {
    const s = colorSlider({ value, min, max, width: w, height: 16, thumbSize: 20, largeChange: 5, onChange });
    parent.appendChild(place(s.el, x, y));
    return s;
}

/**
 * The game's message options (Game.DisplayMessage* / DisplayPopup*, GameOptions.SuppressAllPopups; Galaxy.messageOptions)
 * are what the player's message pipeline records by (sim/playerMessages.ts): every change of the UI's copy goes to the
 * game as the journaled setMessageOptions command.
 */
function issueMessageOptions(empire: Empire): void {
    issuePlayerCommand(empire.galaxy, empire, 'setMessageOptions', [copyMessageOptions(getMessageOptions())]);
}

/** The player's empire changes through the command log (setEmpireControl / setEmpireSetting). */
function issueSetting(empire: Empire, field: EmpireSettingField, value: number | boolean): void {
    pendingEmpireValues[field] = value;
    issuePlayerCommand(empire.galaxy, empire, 'setEmpireSetting', [field, value]);
}

function createGameOptionsPanel(opts: GameOptionsPanelOptions): OpenState {
    const { empire } = opts;
    const s = getSettings();
    pendingEmpireValues = {};
    const win = openOriginalWindow({
        id: 'gameoptions',
        title: 'Options',
        icon: 'gameOptions.png',
        width: OPTIONS_W,
        height: OPTIONS_H,
        onClose: () => {
            open = null;
            for (const w of [...subWindows.values()]) w.close();
            // method_413 → method_418's tail: YxwyUefOyQ (the player empire's settings become the GameOptions
            // defaults of the next new game) and method_257 (save the defaultOptions file).
            updateSettings({ newGameOptions: { ...gameOptionsFromEmpire(empire, pendingEmpireValues) } });
            pendingEmpireValues = {};
        },
    });
    const body = win.body;
    body.classList.add('go-body');

    // --- grpOptionsDisplaySettings (12, 7) 659 × 134, the Expanded build's four slider rows (Start.1.cs:1537-1568:
    // labels from y 24, sliders (130, 26) 515 × 16, 22 px apart).
    const display = place(groupBox('Display Settings', 659, 134, F2), 12, 7);
    body.appendChild(display);
    const rows: [string, number, number, number, (v: number) => void][] = [
        ['Scroll Speed', s.mainViewScrollSpeed, 1, 100, (v) => updateSettings({ mainViewScrollSpeed: v })],
        ['Zoom Speed', s.mainViewZoomSpeed, 1, 100, (v) => updateSettings({ mainViewZoomSpeed: v })],
        ['Star Density', s.starFieldSize, 50, 2000, (v) => updateSettings({ starFieldSize: v })],
        ['GUI Scale', s.uiScale, 50, 200, (v) => updateSettings({ uiScale: v })],
    ];
    rows.forEach(([name, value, min, max, fn], i) => {
        label(display, name, 10, 24 + 22 * i);
        slider(display, value, min, max, 130, 26 + 22 * i, 515, fn);
    });
    // btnHotKeys / btnGameOptionsAdvancedDisplaySettings (Main.Part6.cs:1787-1790: 250 × 26 at x 15 / 395), below the
    // fourth row. HotKeys opens the keyboard shortcut list (the "?" overlay, hud.ts 'shortcuts').
    button(display, 'HotKeys', 15, 110, 250, 22, () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })));
    button(display, 'Advanced Settings...', 395, 110, 250, 22, () => openAdvancedDisplaySettings());

    // --- grpOptionsVolume (12, 147) 659 × 74: Music (17, 22) / Effects (17, 47), sliders (81, 24 / 49). The sliders
    // leave room for our mute boxes (568 → 490 px).
    const volume = place(groupBox('Sound Volume', 659, 74, F2), 12, 147);
    body.appendChild(volume);
    label(volume, 'Music', 17, 22);
    slider(volume, Math.round(s.musicVolume * 100), 0, 100, 81, 24, 490, (v) => updateSettings({ musicVolume: v / 100, musicMuted: false }));
    check(volume, 'Mute', s.musicMuted, 585, 21, (v) => updateSettings({ musicMuted: v }));
    label(volume, 'Effects', 17, 47);
    slider(volume, Math.round(s.soundVolume * 100), 0, 100, 81, 49, 490, (v) => updateSettings({ soundVolume: v / 100, soundMuted: false }));
    check(volume, 'Mute', s.soundMuted, 585, 46, (v) => updateSettings({ soundMuted: v }));

    // --- grpOptionsAutoSave (12, 228) 180 × 54: chkOptionsAutoSave "Every [num] minutes" (7, 19), num (72, 20) 35 × 21.
    const autoSave = place(groupBox('Auto Save', 180, 54, F2), 12, 228);
    body.appendChild(autoSave);
    const minutes = numericUpDown({
        value: clampAutoSaveMinutes(s.autoSaveMinutes),
        min: 10,
        max: 60,
        size: F4 - 4,
        onChange: (v) => updateSettings({ autoSaveMinutes: clampAutoSaveMinutes(v) }),
    });
    minutes.setEnabled(s.autoSave);
    check(autoSave, 'Every', s.autoSave, 7, 19, (v) => {
        minutes.setEnabled(v); // chkOptionsAutoSave_CheckedChanged (Main.Part3.cs:587)
        updateSettings({ autoSave: v });
    });
    autoSave.appendChild(place(minutes.el, 72, 20, 35, 21));
    label(autoSave, 'minutes', 112, 21);

    // chkOptionsAutoPauseInPopup: the original's (12, 10) box is hidden; ours sits between Auto Save and the right column.
    check(body, 'Auto Pause in Game Screens', s.autoPauseInPopup, 206, 232, (v) => updateSettings({ autoPauseInPopup: v }));

    // chkOptionsLoadedGamesPaused: CheckAlign / TextAlign MiddleRight at (Width - (Width + 30), 228) — right edge 670.
    const loaded = checkBoxRight('Loaded games are paused', s.loadedGamesPaused, (v) => updateSettings({ loadedGamesPaused: v }), F4);
    loaded.classList.add('go-check', 'go-anchor-right');
    place(loaded, 0, 228);
    loaded.style.left = '';
    loaded.style.right = `${win.bodySize.w - 670}px`;
    body.appendChild(loaded);

    // lblOptionsMouseScrollMode (223, 258) + cmbOptionsMouseScrollWheelBehaviour 240 × 21, right-aligned with the
    // check box above (x 670 - 240, y 254); the combo is brought to the front.
    label(body, 'Mouse scroll-wheel behavior', 223, 258);
    combo(body, ['No movement', 'Move to selected item', 'Move to mouse cursor location'], s.mouseScrollWheelBehaviour, 670 - 240, 254, 240, 21, (i) =>
        updateSettings({ mouseScrollWheelBehaviour: i }),
    );

    // --- grpOptionsControl "Automation" (12, 288) 659 × 291.
    buildAutomationGroup(body, empire);

    // btnGameOptionsShowMessages (12, 589) 660 × 35.
    button(body, 'Show Message Settings', 12, 589, 660, 35, () => openMessageSettings());

    function openAdvancedDisplaySettings(): void {
        openSubWindow('advanced', () => createAdvancedDisplaySettings());
    }
    function openMessageSettings(): void {
        openSubWindow('messages', () => createMessageSettings(empire));
    }

    function buildAutomationGroup(parent: HTMLElement, emp: Empire): void {
        const g = place(groupBox('Automation', 659, 291, F2), 12, 288);
        parent.appendChild(g);
        // pnlOptionsAutomationMode (10, 21) 217 × 41, BackColor (128, 192, 0, 128); lblOptionsAutomationMode (5, 9) font_7.
        const modePanel = place(el('div', 'go-mode-panel'), 10, 21, 217, 41);
        g.appendChild(modePanel);
        label(modePanel, 'Mode', 5, 9, F7, true);
        // The 16 controls, as the window shows them (the empire's values; commands apply at the next frame boundary).
        const values = empireAutomationValues(emp);
        const controls = new Map<AutomationField, HTMLSelectElement | HTMLInputElement>();
        const setControl = (row: AutomationRow, v: number | boolean): void => {
            values[row.field] = v;
            issueAutomationValue(emp, row, v);
        };
        // cmbOptionsAutomationMode (58, 25) 162 × 24 (parented to the group, over the mode panel).
        const mode = combo(g, AUTOMATION_MODE_ITEMS, detectAutomationMode(values), 58, 25, 162, 24, (i) => {
            const p = AUTOMATION_PRESETS[i];
            if (p === undefined) return; // "(Custom)"
            // method_405: set every control (without re-detecting) — here each one is a command.
            for (const row of AUTOMATION_ROWS) {
                setControl(row, p[row.field]);
                const c = controls.get(row.field);
                if (c instanceof HTMLSelectElement) c.value = String(p[row.field]);
                else if (c) c.checked = Boolean(p[row.field]);
            }
        });
        mode.dataset.go = 'mode';
        // UhvjHxwqlt: any control change re-picks the mode (Custom when no preset matches).
        const redetect = (): void => {
            mode.value = String(detectAutomationMode(values));
        };
        // btnGameOptionsResetAutomationMessages (228, 20) 73 × 40 "Reset Warnings".
        const reset = button(g, 'Reset Warnings', 228, 20, 73, 40, () => {
            void messageBox({
                caption: 'Reset Automation Messages?',
                text: 'This will reenable all automation prompts, informing you when you attempt to manually control an automated function.\n\nAre you sure that you want to do this?',
                buttons: ['Yes', 'No'],
                icon: 'question',
                width: 520,
            }).then((r) => {
                if (r === 'Yes') resetAutomationResponses(); // MessageBoxExManager.ResetAllSavedResponses()
            });
        });
        reset.classList.add('go-button-wrap');
        // Check boxes at x 9 (Main.Part6.cs:1911-1924).
        const checkY: Partial<Record<AutomationField, number>> = {
            controlColonyTaxRates: 73,
            controlPopulationPolicy: 96,
            controlDesigns: 119,
            controlTroopGeneration: 142,
            controlMilitaryFleets: 165,
            controlResearch: 188,
            controlCharacterLocations: 211,
        };
        // Combos: the label right-aligned in 236 × 21 at x 191 (Intelligence Missions 241 × 21 at 186), the combo
        // 220 × 24 at x 429 (Main.Part6.cs:1867-1910).
        const comboRows: [AutomationField, number, number][] = [
            ['controlColonization', 23, 19],
            ['controlStateConstruction', 52, 48],
            ['controlAgentAssignment', 81, 77],
            ['controlMilitaryAttacks', 110, 106],
            ['controlDiplomacyGifts', 139, 135],
            ['controlDiplomacyTreaties', 168, 164],
            ['controlDiplomacyOffense', 197, 193],
            ['controlColonyFacilities', 226, 222],
            ['controlOfferPirateMissions', 255, 251],
        ];
        for (const row of AUTOMATION_ROWS) {
            if (row.kind === 'bool') {
                const y = checkY[row.field] ?? 0;
                const c = check(g, row.label, values[row.field] === true, 9, y, (v) => {
                    setControl(row, v);
                    redetect();
                });
                controls.set(row.field, c.querySelector('input')!);
            }
        }
        for (const [field, ly, cy] of comboRows) {
            const row = AUTOMATION_ROWS.find((r) => r.field === field)!;
            const wide = field === 'controlAgentAssignment';
            rightLabel(g, row.label, wide ? 186 : 191, ly - 2, wide ? 241 : 236, 21);
            const sel = combo(g, row.options ?? [], Number(values[field]), 429, cy, 220, 24, (i) => {
                setControl(row, i);
                redetect();
            });
            controls.set(field, sel);
        }
        // btnGameOptionsEmpireSettings (7, 250) 179 × 35 "Empire Settings".
        button(g, 'Empire Settings', 7, 250, 179, 35, () => openSubWindow('empire', () => createEmpireSettings(emp)));
    }

    function close(): void {
        win.close();
    }
    return { win, close };
}

/** Open (or bring to the front) one of the Options sub-windows. */
function openSubWindow(kind: 'empire' | 'messages' | 'advanced', create: () => OriginalWindow): void {
    const existing = subWindows.get(kind);
    if (existing && !existing.closed) {
        document.body.appendChild(existing.root);
        return;
    }
    const w = create();
    subWindows.set(kind, w);
}

// ---------------------------------------------------------------------------
// Your Empire Settings (pnlGameOptionsEmpireSettings, method_556)
// ---------------------------------------------------------------------------

function createEmpireSettings(empire: Empire): OriginalWindow {
    const win = openOriginalWindow({
        id: 'gameoptions-empire',
        title: 'Your Empire Settings',
        width: EMPIRE_W,
        height: EMPIRE_H,
        onClose: () => subWindows.delete('empire'),
    });
    const body = win.body;
    body.classList.add('go-body');

    // grpGameOptionsDefaultEngagementStances / ...Manual: (10, 10) / (10, 177) 465 × 156, 19 px bold captions; labels
    // (10, 29 + 31 i), combos 230 × 21 at (140, 25 + 31 i). method_557 reads the empire's AttackRange* (method_564).
    const stances: [string, AttackRangeField[]][] = [
        ['Default Engagement Stances - Auto', ['attackRangePatrol', 'attackRangeEscort', 'attackRangeAttack', 'attackRangeOther']],
        ['Default Engagement Stances - Manual', ['attackRangePatrolManual', 'attackRangeEscortManual', 'attackRangeAttackManual', 'attackRangeOtherManual']],
    ];
    const missionLabels = ['Patrol', 'Escort', 'Attack/Bombard', 'Other']; // GameText "Mission Patrol" = Patrol, "Mission Escort" = Escort
    stances.forEach(([caption, fields], gi) => {
        const g = place(groupBox(caption, 465, 156, F19), 10, gi === 0 ? 10 : 177);
        body.appendChild(g);
        fields.forEach((field, i) => {
            label(g, missionLabels[i], 10, 29 + 31 * i);
            combo(g, ENGAGEMENT_STANCE_ITEMS, attackRangeToStanceIndex(empire[field]), 140, 25 + 31 * i, 230, 21, (idx) => issueSetting(empire, field, stanceIndexToAttackRange(idx)));
        });
    });

    // grpGameOptionsFleetAttackSettings (10, 344) 465 × 90: numRefuel (10, 25) / numGather (10, 56) 45 × 21 (0..100),
    // labels (60, 27) / (60, 58). method_559 / method_560.
    const fleet = place(groupBox('Fleet Attack Settings', 465, 90, F19), 10, 344);
    body.appendChild(fleet);
    const portion = (field: 'fleetAttackRefuelPortion' | 'fleetAttackGatherPortion', y: number, caption: string): void => {
        const n = numericUpDown({ value: portionToPercent(empire[field]), min: 0, max: 100, size: F4 - 4, onChange: (v) => issueSetting(empire, field, percentToPortion(v)) });
        fleet.appendChild(place(n.el, 10, y, 45, 21));
        label(fleet, caption, 60, y + 2);
    };
    portion('fleetAttackRefuelPortion', 25, 'First refuel when this percentage of fleet need fuel');
    portion('fleetAttackGatherPortion', 56, 'First assemble when this percentage of fleet dispersed');

    // sldGameOptionsAttackOvermatch (10, 458) 465 × 62, LabelWidth 120, font_4, labels 1:1 .. 5:1 (method_561 / 562).
    const overmatch = labelledTrackBar({
        width: 465,
        height: 62,
        labelText: 'Attack Overmatch',
        labelWidth: 120,
        labels: ATTACK_OVERMATCH_LABELS,
        value: Math.max(0, overmatchFactorToIndex(empire.attackOvermatchFactor)),
        size: F4,
        onChange: (i) => issueSetting(empire, 'attackOvermatchFactor', overmatchIndexToFactor(i)),
    });
    body.appendChild(place(overmatch.el, 10, 458));

    // grpGameOptionsDiscoveries (10, 537) 465 × 99: Ruins label (7, 23) + combo (198, 18) 260 × 21; Abandoned label
    // (7, 50, max 188 × 40) + combo (198, 58). With "Suppress all pop-up screens" on, "Ask what to do" is skipped.
    const disc = place(groupBox('Discoveries', 465, 99, F19), 10, 537);
    body.appendChild(disc);
    let suppress = getMessageOptions().suppressAllPopups;
    label(disc, 'When encounter Ruins', 7, 23);
    const ruinIndex = (): number => discoveryIndexWithSuppressedPopups(empire.discoveryActionRuin, empire.discoveryActionRuin, suppress);
    const abandonedIndex = (): number => discoveryIndexWithSuppressedPopups(empire.discoveryActionAbandonedShipBase, empire.discoveryActionAbandonedShipBase, suppress);
    const ruins = combo(disc, DISCOVERY_RUIN_ITEMS, ruinIndex(), 198, 18, 260, 21, (i) => {
        const v = discoveryIndexWithSuppressedPopups(i, empire.discoveryActionRuin, suppress);
        ruins.value = String(v);
        issueSetting(empire, 'discoveryActionRuin', v);
    });
    const abLabel = text('When encounter Abandoned Ship or Base', { size: F4, color: COLORS.label, shadow: false, wrapWidth: 188, className: 'go-label' });
    disc.appendChild(place(abLabel, 7, 50));
    const abandoned = combo(disc, DISCOVERY_ABANDONED_ITEMS, abandonedIndex(), 198, 58, 260, 21, (i) => {
        const v = discoveryIndexWithSuppressedPopups(i, empire.discoveryActionAbandonedShipBase, suppress);
        abandoned.value = String(v);
        issueSetting(empire, 'discoveryActionAbandonedShipBase', v);
    });
    // method_557 shows the suppressed-popup correction at once; the empire takes it the way method_558 would on close.
    if (Number(ruins.value) !== empire.discoveryActionRuin) issueSetting(empire, 'discoveryActionRuin', Number(ruins.value));
    if (Number(abandoned.value) !== empire.discoveryActionAbandonedShipBase) issueSetting(empire, 'discoveryActionAbandonedShipBase', Number(abandoned.value));

    // chkOptionsNewShipsAutomated (10, 645), chkOptionsSuppressAllPopups (10, 670) (CheckAlign TopLeft).
    check(body, 'Newly built ships are automated', empire.newShipsAutomated, 10, 645, (v) => issueSetting(empire, 'newShipsAutomated', v));
    check(body, 'Suppress all pop-up screens', suppress, 10, 670, (v) => {
        suppress = v;
        setSuppressAllPopups(v); // GameOptions.SuppressAllPopups (the UI's copy: ui/messageRouting.ts)
        issueMessageOptions(empire); // and the game's
        // chkOptionsSuppressAllPopups_CheckedChanged (Main.Part2.cs:4098).
        if (v) {
            const r = discoveryIndexWithSuppressedPopups(Number(ruins.value), empire.discoveryActionRuin, true);
            if (r !== Number(ruins.value)) {
                ruins.value = String(r);
                issueSetting(empire, 'discoveryActionRuin', r);
            }
            const a = discoveryIndexWithSuppressedPopups(Number(abandoned.value), empire.discoveryActionAbandonedShipBase, true);
            if (a !== Number(abandoned.value)) {
                abandoned.value = String(a);
                issueSetting(empire, 'discoveryActionAbandonedShipBase', a);
            }
        }
    });

    // chkOptionsAllowSameSystemAsOtherEmpires: a galaxy-creation option (hidden in game in the original). Read-only.
    const same = allowSameSystemSource?.() ?? null;
    const sameBox = check(body, 'Allow colonization and mining stations in other empires systems', same === true, 10, 695, null, F7);
    sameBox.classList.add('go-readonly');
    sameBox.title = same === null ? 'Set when the galaxy is created (New Game)' : 'Set when the galaxy is created (New Game); fixed for this game';
    return win;
}

// ---------------------------------------------------------------------------
// Message Settings (pnlGameOptionsMessages, method_566)
// ---------------------------------------------------------------------------

function createMessageSettings(empire: Empire): OriginalWindow {
    const win = openOriginalWindow({
        id: 'gameoptions-messages',
        title: 'Message Settings',
        width: MESSAGES_W,
        height: MESSAGES_H,
        onClose: () => subWindows.delete('messages'),
    });
    const body = win.body;
    body.classList.add('go-body');
    const options: MessageOptions = getMessageOptions();
    const rows = messageSettingsRows();
    // grpOptionsScrollingMessages (12, 10) / grpOptionsPopupMessages (367, 10), 340 × 412; boxes (7, 22 + 20 i).
    const groups: ['ticker' | 'popup', string, number][] = [
        ['ticker', 'Scrolling Messages', 12],
        ['popup', 'Popup Messages', 367],
    ];
    for (const [kind, caption, x] of groups) {
        const g = place(groupBox(caption, 340, 412, F2), x, 10);
        body.appendChild(g);
        rows.forEach((row, i) => check(g, row.label, messageRowValue(options, row, kind), 7, 22 + 20 * i, (v) => {
            setMessageRowValue(row, kind, v);
            issueMessageOptions(empire);
        }));
    }
    // Ours: the popup stubs (ui/messageStubList.ts).
    const st = getSettings();
    check(body, 'Open messages automatically', st.openMessagesAutomatically, 14, 432, (v) => updateSettings({ openMessagesAutomatically: v }));
    label(body, 'Message stubs shown at once', 420, 434);
    const stubs = numericUpDown({ value: st.messageStubsVisible, min: 1, max: 6, size: F4 - 4, onChange: (v) => updateSettings({ messageStubsVisible: v }) });
    body.appendChild(place(stubs.el, 660, 431, 45, 21));
    return win;
}

// ---------------------------------------------------------------------------
// Advanced Display Settings (pnlGameOptionsAdvancedDisplaySettings, method_568)
// ---------------------------------------------------------------------------

/** grpGameOptionsAdvancedDisplaySettingsGalaxyIcons check boxes and their positions (method_568). */
const GALAXY_ICON_BOXES: [string, GalaxyViewDisplayKey, number, number][] = [
    ['Fleets', 'galaxyViewDisplayFleets', 10, 22],
    ['Resupply Ships', 'galaxyViewDisplayResupplyShips', 10, 44],
    ['Military Ships', 'galaxyViewDisplayMilitaryShips', 10, 66],
    ['Space Ports', 'galaxyViewDisplaySpacePorts', 10, 88],
    ['Other Bases', 'galaxyViewDisplayOtherBases', 10, 110],
    ['Exploration Ships', 'galaxyViewDisplayExplorationShips', 180, 22],
    ['Colony Ships', 'galaxyViewDisplayColonyShips', 180, 44],
    ['Construction Ships', 'galaxyViewDisplayConstructionShips', 180, 66],
    ['Civilian ships', 'galaxyViewDisplayCivilianShips', 180, 88],
    ['Always show enemy Fleets', 'galaxyViewDisplayAlwaysEnemyFleets', 10, 154],
    ['Always show enemy Military ships', 'galaxyViewDisplayAlwaysEnemyMilitaryShips', 10, 176],
    ['Always show Pirates', 'galaxyViewDisplayAlwaysPirates', 10, 198],
];

type MapDisplayKey = 'showSystemNames' | 'showRegionLabels' | 'freightFlowsDefault' | 'ditherGradients' | 'pullStationsToCentre' | 'showWeaponRangeCircles';

function createAdvancedDisplaySettings(): OriginalWindow {
    const win = openOriginalWindow({
        id: 'gameoptions-advanced',
        title: 'Advanced Display Settings',
        width: ADVANCED_W,
        height: ADVANCED_H,
        onClose: () => subWindows.delete('advanced'),
    });
    const body = win.body;
    body.classList.add('go-body');
    const st = getSettings();

    // grpGameOptionsAdvancedDisplaySettingsMaximumFramerate (12, 10) 400 × 60: Unlimited (8, 22), num (127, 23)
    // 45 × 21 (10..100), "fps" (177, 22). MaximumFramerate <= 0 = Unlimited.
    const fr = place(groupBox('Maximum Framerate', 400, 60, F2), 12, 10);
    body.appendChild(fr);
    const unlimited = st.maximumFramerate <= 0;
    const fps = numericUpDown({
        value: unlimited ? 50 : clampMaximumFramerate(st.maximumFramerate),
        min: 10,
        max: 100,
        size: F4 - 4,
        onChange: (v) => updateSettings({ maximumFramerate: clampMaximumFramerate(v) }),
    });
    fps.setEnabled(!unlimited);
    check(fr, 'Unlimited', unlimited, 8, 22, (v) => {
        // chkGameOptionsAdvancedDisplaySettingsMaximumFramerateUnlimited_CheckedChanged (Main.Part4.cs:4731).
        fps.setEnabled(!v);
        updateSettings({ maximumFramerate: v ? -1 : fps.value });
    });
    fr.appendChild(place(fps.el, 127, 23, 45, 21));
    label(fr, 'fps', 177, 22);

    // chkOptionsShowSystemNebulae (15, 87); tbarGameOptionsAdvancedDisplaySettingsSystemNebulaeDetail (12, 115)
    // 400 × 52, LabelWidth 160, Low / Medium / High.
    check(body, 'Display nebulae clouds in systems', st.showSystemNebulae, 15, 87, (v) => updateSettings({ showSystemNebulae: v }));
    const detail = labelledTrackBar({
        width: 400,
        height: 52,
        labelText: 'System Nebulae Detail',
        labelWidth: 160,
        labels: ['Low', 'Medium', 'High'],
        value: st.systemNebulaeDetail,
        size: F4,
        onChange: (v) => updateSettings({ systemNebulaeDetail: v }),
    });
    body.appendChild(place(detail.el, 12, 115));

    // grpGameOptionsAdvancedDisplaySettingsGalaxyIcons (12, 184) 400 × 231.
    const icons = place(groupBox('Galaxy View - Ship Display', 400, 231, F2), 12, 184);
    body.appendChild(icons);
    for (const [caption, key, x, y] of GALAXY_ICON_BOXES) check(icons, caption, st[key], x, y, (v) => updateSettings({ [key]: v } as Partial<UiSettings>));

    // Ours: the map label / overlay / output toggles (were in the Escape menu's Options panel).
    const map = place(groupBox('Map Display', 400, 134, F2), 12, 425);
    body.appendChild(map);
    const mapBoxes: [string, MapDisplayKey][] = [
        ['Show system names', 'showSystemNames'],
        ['Show region labels', 'showRegionLabels'],
        ['Freight flows overlay on at start', 'freightFlowsDefault'],
        ['Dither gradients (no banding)', 'ditherGradients'],
        ['Draw stations closer to their planet / moon', 'pullStationsToCentre'],
        ['Show weapon range circles for the selected ship', 'showWeaponRangeCircles'],
    ];
    mapBoxes.forEach(([caption, key], i) => check(map, caption, st[key], 10, 22 + 22 * i, (v) => updateSettings({ [key]: v } as Partial<UiSettings>)));
    // [dw2overlays] Ours: the Improvements category (ui/improvements.ts) — the Distant Worlds 2-inspired additions, each
    // on or off; an improvement that is off hides its rows from the View popup.
    body.appendChild(place(improvementsOptionsGroup({ groupBox, checkBox: (l, c, fn, size) => checkBox(l, c, fn, size), place }, 400, F2, F4), 12, 569));
    return win;
}
