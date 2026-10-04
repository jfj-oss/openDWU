// Game Options → Bacon Mod Settings (ours): this game's BaconSettings.txt values, editable at any time in a game.
// Our source is the Expanded mod, which carries the Bacon mod; the C# reads BaconSettings.txt once per game start into
// process-wide statics (BaconMain.cs 551 BaconInitialize, 605-1062). Here every game keeps its own values
// (Galaxy.baconSettingsOverrides: the keys that differ from the install's file) and this window changes them with the
// journaled setBaconSettings command, which re-runs BaconInitialize at the command's frame boundary
// (sim/baconSettings.ts applyBaconSettingsCommand), so a replay or the sim worker gets the same game.
//
// One row per key, in the file's order: the file key (humanised), the control (CheckBox / NumericUpDown / TextBox, as
// the key parses: bool / integer / float or text) and the file's own comment above the key (gameData
// baconSettingsComments). Keys the recreation does not read, and the saveStats file output, are shown disabled.
// Edits are pending until Apply; "File Values" restores the install's file.

import './baconSettingsWindow.css';
import type { Empire } from '../../sim/empire';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { installBaconSettings } from '../../sim/baconSettings';
import {
    BACON_SETTING_FIELDS,
    csTryParseDouble,
    mergeBaconSettings,
    normalizeBaconSettingValue,
    type BaconSettingKey,
    type BaconSettings,
    type BaconSettingsOverrides,
} from '../../sim/data/baconSettings';
import { COLORS, checkBox, el, glassButton, numericUpDown, openOriginalWindow, place, scrollPanel, text, textBox, type OriginalWindow } from '../originalWindow';

const W = 760;
const H = 720;
const FSIZE = 17;

/** Keys the recreation does not read yet (UI-only features or Bacon features not ported). Shown disabled. */
const NOT_USED: ReadonlySet<BaconSettingKey> = new Set<BaconSettingKey>([
    'shadow',
    'backgroundStarsAtZoomLevel',
    'lowStarCount',
    'lowIndependentLifeValue',
    'alwaysShowAsteroidColonies',
    'tradeTax',
    'addSalesTax',
    'newIDCost',
    'baseShipOfficerCost',
    'componentEquipCost',
    'orbitalAsteroidCost',
    'invasionStrategyResult',
    'invasionStrategyRemainingGuesses',
    'drawWeaponRangeCircles',
    'shipFreeRepairTimeFromCrewSkillAverage',
    'shipFreeRepairTimeFromCrewSkillExperienced',
    'shipFreeRepairTimeFromCrewSkillVeteran',
    'shipFreeRepairTimeFromCrewSkillElite',
    'shipFreeRepairTimeFromCrewSkillLegendary',
    'customDifficultyColonyCorruptionFactor',
    'customDifficultyWarWearinessFactor',
    'customDifficultyResearchRate',
    'customDifficultyPopulationGrowthRate',
    'customDifficultyMiningRate',
    'customDifficultyTargettingFactor',
    'customDifficultyCountermeasuresFactor',
    'customDifficultyColonyShipBuildSpeedRate',
    'customDifficultyColonyIncomeFactor',
    'allowPrivateShipAssigment',
]);
/** File output only (BaconMain.ProcessGameStats writes SaveStats*.xml; not done in a browser). Shown disabled. */
const FILE_ONLY: ReadonlySet<BaconSettingKey> = new Set<BaconSettingKey>(['saveStats', 'statSaveIntervalInGameDays']);

/** Descriptions for keys the shipped file has no comment for (BaconMain.cs field use). */
const FALLBACK_DESCRIPTIONS: Partial<Record<string, string>> = {
    priceReductionFactor: 'Divides the value of colonies and bases offered in diplomacy trades (BaconGalaxy.RefactorValueForEmpire).',
    warWearinessReduction: 'War weariness change per update while at peace (BaconEmpire.AdjustWarWearinessWhenAtPeace). Negative values reduce it.',
    AllowPrivateShipAssigment: 'Lets the player give missions to private ships.',
    TroopGarrisonMinimumPerColony: 'Troop target level for independent colonies. Written to the independents\' policy when applied.',
};

let commentsSource: (() => Readonly<Record<string, string>> | null | undefined) | null = null;
/** main.ts: where the window reads BaconSettings.txt's comments (gameData.baconSettingsComments). */
export function setBaconSettingsCommentsSource(source: (() => Readonly<Record<string, string>> | null | undefined) | null): void {
    commentsSource = source;
}

let openWin: OriginalWindow | null = null;

/** "fighterOnBomberViolence" → "Fighter On Bomber Violence". */
export function humanizeBaconKey(fileKey: string): string {
    const words = fileKey.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The value a text box holds as the key would read it from the file (',' as '.', ReadBaconSettings). */
function parseTextValue(key: BaconSettingKey, raw: string): unknown {
    const t = BACON_SETTING_FIELDS[key].type;
    if (t === 'string') return raw;
    const d = csTryParseDouble(raw.replace(/,/g, '.'));
    return d === null ? undefined : d;
}

function formatValue(v: unknown): string {
    return typeof v === 'number' ? String(v) : String(v ?? '');
}

/** The rows' keys, in BaconInitialize order (the derived minZoomLevelForWeaponsCircles has no row). */
export function baconSettingsWindowKeys(): BaconSettingKey[] {
    return (Object.keys(BACON_SETTING_FIELDS) as BaconSettingKey[]).filter((k) => BACON_SETTING_FIELDS[k].type !== 'derived');
}

/** Open Game Options → Bacon Mod Settings for the player's game (brings it to the front when open). */
export function openBaconSettingsWindow(empire: Empire, onClose?: () => void): OriginalWindow {
    if (openWin !== null && !openWin.closed) {
        document.body.appendChild(openWin.root);
        return openWin;
    }
    const galaxy = empire.galaxy;
    const win = openOriginalWindow({ id: 'bacon-settings', title: 'Bacon Mod Settings', width: W, height: H, onClose: () => {
            openWin = null;
            onClose?.();
        },
    });
    openWin = win;
    const body = win.body;
    body.classList.add('bs-body');
    const bw = win.bodySize.w;
    const bh = win.bodySize.h;

    const intro = text('This game\'s BaconSettings.txt values. New games start from the file; changes apply to this game only, from the next frame.', {
        size: FSIZE - 1,
        color: COLORS.label,
        shadow: false,
        className: 'bs-intro',
    });
    body.appendChild(place(intro, 12, 8, bw - 24, 40));

    const list = scrollPanel('bs-list');
    body.appendChild(place(list, 12, 50, bw - 24, bh - 50 - 56));

    let install: BaconSettings = { ...installBaconSettings() };
    let current: BaconSettings = mergeBaconSettings(install, galaxy.baconSettingsOverrides);
    /** The pending value per key (what Apply sends; a text box that does not parse holds its previous value). */
    let pending: Record<string, unknown> = { ...current };
    const invalid = new Set<BaconSettingKey>();
    const labels = new Map<BaconSettingKey, HTMLElement>();
    const status = text('', { size: FSIZE - 1, color: COLORS.label, shadow: false, className: 'bs-status' });

    function changed(k: BaconSettingKey): boolean {
        const v = normalizeBaconSettingValue(k, pending[k]);
        return v !== undefined && !Object.is(v, install[k]);
    }
    function markRow(k: BaconSettingKey): void {
        labels.get(k)?.classList.toggle('bs-changed', changed(k));
    }
    function dirty(): boolean {
        return baconSettingsWindowKeys().some((k) => !Object.is(normalizeBaconSettingValue(k, pending[k]) ?? current[k], current[k]));
    }
    function updateStatus(): void {
        const n = baconSettingsWindowKeys().filter(changed).length;
        const parts = [n === 0 ? 'All values as in BaconSettings.txt.' : `${n} value${n === 1 ? '' : 's'} differ from BaconSettings.txt.`];
        if (invalid.size > 0) parts.push(`${invalid.size} invalid (ignored).`);
        if (dirty()) parts.push('Not applied yet.');
        status.textContent = parts.join(' ');
    }

    function build(): void {
        list.replaceChildren();
        labels.clear();
        invalid.clear();
        const comments = commentsSource?.() ?? null;
        let lastDescription = '';
        for (const k of baconSettingsWindowKeys()) {
            const d = BACON_SETTING_FIELDS[k];
            const disabled = NOT_USED.has(k) || FILE_ONLY.has(k);
            const row = el('div', `bs-row${disabled ? ' bs-disabled' : ''}`);
            const name = el('div', 'bs-name', humanizeBaconKey(d.fileKey));
            name.title = `${d.fileKey} (file value: ${formatValue(install[k])})`;
            labels.set(k, name);
            const control = el('div', 'bs-control');
            const onValue = (v: unknown): void => {
                pending[k] = v;
                markRow(k);
                updateStatus();
            };
            if (d.type === 'bool') {
                control.appendChild(checkBox('', current[k] === true, disabled ? null : (v) => onValue(v), FSIZE));
            } else if (d.type === 'int' || d.type === 'short' || d.type === 'long' || d.type === 'intOrNull') {
                const range = d.type === 'short' ? [-32768, 32767] : d.type === 'long' ? [-9007199254740991, 9007199254740991] : [-2147483648, 2147483647];
                const cur = current[k];
                const spin = numericUpDown({
                    value: typeof cur === 'number' ? cur : 0,
                    min: d.min ?? range[0],
                    max: d.max ?? range[1],
                    size: FSIZE,
                    align: 'right',
                    onChange: (v) => onValue(v),
                });
                spin.setEnabled(!disabled);
                spin.el.classList.add('bs-spin');
                control.appendChild(spin.el);
            } else {
                const box = textBox(formatValue(current[k]), '', (raw) => {
                    const v = parseTextValue(k, raw);
                    const ok = v !== undefined && normalizeBaconSettingValue(k, v) !== undefined;
                    box.classList.toggle('bs-invalid', !ok);
                    if (ok) invalid.delete(k);
                    else invalid.add(k);
                    if (ok) onValue(v);
                    else updateStatus();
                });
                box.classList.add('bs-text');
                box.disabled = disabled;
                control.appendChild(box);
            }
            row.append(name, control);
            let description = comments?.[d.fileKey] ?? FALLBACK_DESCRIPTIONS[d.fileKey] ?? '';
            // Keys under one comment block share it: show it once, on the block's first key.
            if (description === lastDescription && comments?.[d.fileKey] !== undefined) description = '';
            else lastDescription = description;
            const note = NOT_USED.has(k) ? 'Not used by this recreation yet.' : FILE_ONLY.has(k) ? 'Writes stats files; not available here.' : '';
            if (description !== '' || note !== '') {
                const desc = el('div', 'bs-desc');
                if (note !== '') desc.appendChild(el('span', 'bs-note', note + (description !== '' ? ' ' : '')));
                if (description !== '') desc.appendChild(document.createTextNode(description));
                desc.title = description;
                row.appendChild(desc);
            }
            list.appendChild(row);
            markRow(k);
        }
        updateStatus();
    }

    function apply(requested: BaconSettingsOverrides): void {
        const scroll = list.scrollTop;
        // The command's result is the game's stored set (with the sim worker the replica's field may land a frame later).
        issuePlayerCommand(galaxy, empire, 'setBaconSettings', [requested], (stored) => {
            if (win.closed) return;
            install = { ...installBaconSettings() };
            current = mergeBaconSettings(install, stored);
            pending = { ...current };
            build();
            list.scrollTop = scroll;
        });
    }

    body.appendChild(place(status, 12, bh - 46, bw - 12 - 3 * 140 - 2 * 8 - 12 - 12, 40));
    const buttons: [string, number, () => void][] = [
        [
            'Apply',
            bw - 12 - 3 * 140 - 2 * 8,
            () => {
                const out: Record<string, unknown> = {};
                for (const k of baconSettingsWindowKeys()) {
                    if (NOT_USED.has(k) || FILE_ONLY.has(k)) {
                        // Disabled rows keep the game's value.
                        if (!Object.is(current[k], install[k])) out[k] = current[k];
                    } else if (changed(k)) out[k] = normalizeBaconSettingValue(k, pending[k]);
                }
                apply(out as BaconSettingsOverrides);
            },
        ],
        ['File Values', bw - 12 - 2 * 140 - 8, () => apply({})],
        ['Close', bw - 12 - 140, () => win.close()],
    ];
    for (const [label, x, onClick] of buttons) body.appendChild(place(glassButton(label, { onClick, size: 15.83 }), x, bh - 46, 140, 34));
    build();
    return win;
}

/** Close the window (Game Options closing, the main menu). */
export function closeBaconSettingsWindow(): void {
    openWin?.close();
}
