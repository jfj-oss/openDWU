// The smuggling-mission resource picker: a port of pnlPirateSmugglingMissionResourceSelection (Main.Part8.cs 5067 method_345
// lays it out, 5094 btnPirateSmugglingMissionAssign_Click / 5128 btnPirateSmugglingMissionCancel_Click / 5132
// cmbPirateSmugglingMissionResourceSelection_SelectedIndexChanged). The "Assign Mercenary Smuggling Mission" order on a
// colony with no resource chosen (ShipActionType.GeneratePirateMissionSmuggling, Target2 null → method_345) opens it: a
// 330 × 75 BorderPanel (48, 48, 64) at (60, ClientHeight − 115) with the resource combo ("All Resources" first, then every
// resource by name; ResourceDropDown with allowNullResource), the price per 100 units, Assign Mission and Cancel.
// Assign issues the assignPirateSmugglingMission command (sim/pirates/pirateMissionsPanel.ts).

import './pirateSmugglingPicker.css';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Habitat } from '../sim/types';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { pirateSmugglingPricePer100 } from '../sim/pirates/pirateMissionsPanel';
import { tryGetText } from '../sim/textResolver';
import { glassButton, hudScale } from './originalWindow';
import { uiScaleFactor } from './settings';

const T = (tag: string, fallback: string): string => tryGetText(tag) ?? fallback;

/** .NET "#.0" (no leading zero below 1). */
export function formatHashDot0(v: number): string {
    const t = (Math.round(v * 10) / 10).toFixed(1);
    return t.startsWith('0.') ? t.slice(1) : t;
}

/** The combo's entries: "All Resources" (null), then the resources sorted by name (Resource.CompareTo with no SortTag). */
export function smugglingResourceChoices(resources: readonly { resourceId: number; name: string }[]): { resourceId: number | null; name: string }[] {
    const sorted = resources.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return [{ resourceId: null, name: T('All Resources', 'All Resources') }, ...sorted.map((r) => ({ resourceId: r.resourceId, name: r.name }))];
}

let open: { root: HTMLDivElement; close: () => void } | null = null;

/** method_346: hide the panel. */
export function closePirateSmugglingPicker(): void {
    open?.close();
}

/** method_345: show the panel for `habitat` (the selected colony). In-thread the price is computed as the C# does; on a
 *  sim-worker replica the same pure read runs on the replica. */
export function openPirateSmugglingPicker(galaxy: Galaxy, player: Empire, habitat: Habitat): HTMLDivElement {
    closePirateSmugglingPicker();
    const root = document.createElement('div');
    root.className = 'pirate-smuggle-picker';
    root.dataset.hud = 'pnlPirateSmugglingMissionResourceSelection';
    const place = (): void => {
        const k = hudScale(window.innerHeight, uiScaleFactor());
        root.style.transform = `scale(${k})`;
        root.style.left = `${Math.round(60 * k)}px`;
        root.style.top = `${Math.round(window.innerHeight - 115 * k)}px`;
    };
    const choices = smugglingResourceChoices(galaxy.resources.map((r) => ({ resourceId: r.resourceId, name: r.name })));
    const select = document.createElement('select');
    select.className = 'pirate-smuggle-select';
    choices.forEach((c, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = c.name;
        select.appendChild(o);
    });
    select.value = '0';
    const price = document.createElement('div');
    price.className = 'pirate-smuggle-price';
    const chosen = (): number | null => choices[Number(select.value)]?.resourceId ?? null;
    const paint = (): void => {
        // 5132-5142: "for X credits per 100 units" ("0" until a colony is selected).
        price.textContent = (tryGetText('for X credits per 100 units') ?? 'for {0} credits per 100 units').replace('{0}', formatHashDot0(pirateSmugglingPricePer100(galaxy, player, habitat, chosen())));
    };
    select.addEventListener('change', paint);
    const close = (): void => {
        window.removeEventListener('resize', place);
        root.remove();
        if (open?.root === root) open = null;
    };
    const assign = glassButton(T('Assign Mission', 'Assign Mission'), {
        className: 'pirate-smuggle-assign',
        onClick: () => {
            issuePlayerCommand(galaxy, player, 'assignPirateSmugglingMission', [habitat, chosen()]);
            close();
        },
    });
    const cancel = glassButton(T('Cancel', 'Cancel'), { className: 'pirate-smuggle-cancel', onClick: () => close() });
    root.append(select, price, assign, cancel);
    document.body.appendChild(root);
    place();
    paint();
    window.addEventListener('resize', place);
    open = { root, close };
    return root;
}
