// Task 16d: streamlined Game Options (O): the Automation group (Main.Part6.cs:2524-2560) and the Popup /
// Scrolling Messages groups (Main.Part3.cs:934-972, Main.Part6.cs:2406-2489). Options apply immediately.
// TODO(port): the rest of pnlGameOptions (display, sound, auto-save, encounters) — the Esc menu Options modal covers display/sound; semi-automated "Suggest …" needs the sim's AdvisorSuggestion prompt (diplomacyTick.ts checkTaskAuthorized TODO)

import './gameOptionsPanel.css';
import { AutomationLevel, type Empire } from '../../sim/empire';
import {
    getMessageOptions,
    MessageCategory,
    setMessageOption,
    setSuppressAllPopups,
    type MessageOptions,
} from '../messageRouting';

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

// Port of Main.Part6.cs:2524-2539: apply one Automation control to the player empire.
export function setAutomationValue(empire: Empire, row: AutomationRow, value: number | boolean): void {
    const f = row.field;
    if (isLevelField(f)) {
        empire[f] = method419(typeof value === 'number' ? value : Number(value));
    } else {
        empire[f as BoolField] = Boolean(value);
    }
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

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Game Options panel, or close it if it is already open. */
export function toggleGameOptionsPanel(opts: GameOptionsPanelOptions): void {
    if (open) {
        open.close();
    } else {
        open = createGameOptionsPanel(opts);
    }
}

/** Close the Game Options panel (no-op when closed). */
export function closeGameOptionsPanel(): void {
    open?.close();
}

function el(tag: string, className: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function checkbox(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'game-options-checkbox';
    cb.checked = checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    return cb;
}

function createGameOptionsPanel(opts: GameOptionsPanelOptions): OpenState {
    const { empire } = opts;
    const root = el('div', 'game-options-wrap');
    const win = el('div', 'game-options-window');

    const titlebar = el('div', 'game-options-titlebar');
    titlebar.appendChild(el('div', 'game-options-heading', 'Game Options'));
    const closeBtn = el('button', 'game-options-close', '✕') as HTMLButtonElement;
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = el('div', 'game-options-body');

    // Automation group.
    const auto = el('section', 'game-options-section');
    auto.appendChild(el('div', 'game-options-section-title', 'Automation'));
    for (const row of AUTOMATION_ROWS) {
        const line = el('label', 'game-options-row');
        line.appendChild(el('span', 'game-options-label', row.label));
        const value = automationValue(empire, row);
        if (row.kind === 'level' && row.options) {
            const select = document.createElement('select');
            select.className = 'game-options-select';
            row.options.forEach((text, i) => {
                const o = document.createElement('option');
                o.value = String(i);
                o.textContent = text;
                select.appendChild(o);
            });
            select.value = String(value);
            select.addEventListener('change', () => setAutomationValue(empire, row, Number(select.value)));
            line.appendChild(select);
        } else {
            line.appendChild(checkbox(value === true, (v) => setAutomationValue(empire, row, v)));
        }
        auto.appendChild(line);
    }

    // Messages group.
    const msgs = el('section', 'game-options-section');
    msgs.appendChild(el('div', 'game-options-section-title', 'Messages'));
    const table = el('div', 'game-options-messages');
    table.append(
        el('span', 'game-options-header-cell'),
        el('span', 'game-options-header-cell game-options-center', 'Popup'),
        el('span', 'game-options-header-cell game-options-center', 'Scrolling'),
    );
    const options = getMessageOptions();
    for (const row of MESSAGE_OPTION_ROWS) {
        table.appendChild(el('span', 'game-options-label', row.label));
        for (const kind of ['popup', 'ticker'] as const) {
            const cell = el('span', 'game-options-center');
            cell.appendChild(checkbox(messageRowValue(options, row, kind), (v) => setMessageRowValue(row, kind, v)));
            table.appendChild(cell);
        }
    }
    msgs.appendChild(table);
    const suppress = el('label', 'game-options-row game-options-suppress');
    suppress.append(
        el('span', 'game-options-label', 'Suppress all pop-up screens'),
        checkbox(options.suppressAllPopups, (v) => setSuppressAllPopups(v)),
    );
    msgs.appendChild(suppress);

    body.append(auto, msgs);
    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    function close(): void {
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu Escape handler from opening too.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    return { root, close };
}
