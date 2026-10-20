// [Beacon] Population relocation on the colony screen's Population tab (sim/scenario/threats/giantworks/beaconRelocation.ts): a destination pick, an
// amount (slider and field), the order's cost, and the progress of the order from this colony. No new screens: one block in the existing tab, shown only
// for our own colony while the Beacon add-on is on. Every change is a journaled player command (playerOps relocatePopulation / relocateCancel).

import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { scenarioText } from '../../sim/scenario/messages';
import { RELOC_MIN_PEOPLE, relocationOn, relocationPlan, relocationTargets, relocationView } from '../../sim/scenario/threats/giantworks/beaconRelocation';
import { COLORS, FONT, dropDown, el, glassButton, messageBox, place, text, textBox } from '../originalWindow';

/** The colony screen shows the block for `h` (our own colony, the add-on on). */
export function relocationVisible(galaxy: Galaxy, empire: Empire, h: Habitat): boolean {
    return galaxy.scenario !== null && relocationOn(galaxy) && h.empire === empire;
}

/** "3.2 billion" / "450 million" (people). Pure. */
export function formatPeople(n: number): string {
    if (n >= 1e9) return `${(Math.round(n / 1e8) / 10).toLocaleString('en-US')} billion`;
    return `${Math.round(n / 1e6).toLocaleString('en-US')} million`;
}

/** The progress line of an order: "3.2 of 10 billion moved". Pure. */
export function relocationProgressText(o: { total: number; moved: number; lost: number; seized: number; abandon: boolean }): string {
    const unit = o.total >= 1e9 ? 1e9 : 1e6;
    const word = o.total >= 1e9 ? 'billion' : 'million';
    const n = (v: number): string => (Math.round((v / unit) * 10) / 10).toLocaleString('en-US');
    const extra = [o.lost > 0 ? `${formatPeople(o.lost)} lost` : '', o.seized > 0 ? `${formatPeople(o.seized)} seized` : ''].filter((s) => s !== '').join(', ');
    return `${n(o.moved)} of ${n(o.total)} ${word} moved${extra !== '' ? ` (${extra})` : ''}`;
}

const WHY: Record<string, string> = {
    off: 'Relocation is not available.',
    colonies: 'Pick another colony of ours.',
    busy: 'An order from this colony is already under way.',
    nobody: 'No one here can live at that colony.',
    room: 'That colony has no room.',
    amount: 'Enter at least a million people.',
    funds: 'The treasury cannot pay for it.',
};

/** Draws the block into `parent` at (x, y), w x h original pixels. */
export function renderRelocationBlock(parent: HTMLElement, galaxy: Galaxy, empire: Empire, h: Habitat, rerender: () => void, x: number, y: number, w: number, hgt: number): void {
    void hgt;
    const view = relocationView(galaxy, h);
    const targets = relocationTargets(galaxy, empire, h);
    const box = el('div', 'col-reloc');
    place(box, x, y, w, hgt);
    parent.appendChild(box);
    box.appendChild(place(text('Relocate population', { bold: true, size: FONT.small }), 4, 2));
    const o = view.order;
    const live = o !== null && !o.done;
    // progress / last result
    const prog = o !== null ? `${live ? 'To' : o.ended === 'cancelled' ? 'Stopped, to' : 'Done, to'} ${o.to}: ${relocationProgressText(o)}` : 'No order from this colony.';
    box.appendChild(place(text(prog, { size: FONT.small, color: COLORS.gridText }), 120, 3));
    if (view.incomeFactor < 1) {
        const t = text(`Income ${Math.round(view.incomeFactor * 100)}% (took in ${formatPeople(view.intake)})`, { size: FONT.small, color: COLORS.red });
        t.title = 'Taking in many people cuts a world\'s income in proportion to their share of its population, for years after the last arrivals.';
        box.appendChild(place(t, w - 190, 3));
    }
    if (live) {
        const cancel = glassButton('Stop order', { onClick: () => issuePlayerCommand(galaxy, empire, 'relocateCancel', [o.id], () => rerender()) });
        box.appendChild(place(cancel, 4, 22, 100, 22));
        const note = text(o.abandon ? 'A full evacuation: the colony is abandoned when it is empty.' : 'Private passenger ships carry the people.', { size: FONT.small, color: COLORS.gridText });
        box.appendChild(place(note, 120, 26));
        return;
    }
    if (targets.length === 0) {
        box.appendChild(place(text(view.people < RELOC_MIN_PEOPLE ? 'Too few people to move.' : 'No other colony of ours can take them.', { size: FONT.small, color: COLORS.gridText }), 4, 26));
        return;
    }
    let dest = targets[0];
    let amount = Math.min(dest.max, Math.max(RELOC_MIN_PEOPLE, Math.floor(view.people / 2)));
    const dd = dropDown(
        targets.map((t, i) => ({ value: String(i), label: `${t.habitat.name} (room ${formatPeople(t.max)})` })),
        '0',
        (v) => {
            dest = targets[Number(v)];
            amount = Math.min(amount, dest.max);
            sync();
        },
    );
    box.appendChild(place(dd, 4, 22, 190, 21));
    const slider = el('input') as HTMLInputElement;
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1000';
    slider.addEventListener('keydown', (e) => e.stopPropagation());
    box.appendChild(place(slider, 200, 24, 110, 18));
    const field = textBox('', 'million', (v) => {
        const n = Number(v.replace(/,/g, ''));
        if (Number.isFinite(n)) {
            amount = Math.max(0, Math.min(dest.max, Math.round(n * 1e6)));
            slider.value = String(Math.round((amount / Math.max(1, dest.max)) * 1000));
            refresh();
        }
    });
    box.appendChild(place(field, 316, 22, 62, 21));
    box.appendChild(place(text('million', { size: FONT.small, color: COLORS.gridText }), 382, 26));
    const info = text('', { size: FONT.small, color: COLORS.gridText });
    box.appendChild(place(info, 4, 46));
    const go = glassButton('Relocate', {
        onClick: () => {
            const plan = relocationPlan(galaxy, empire, h, dest.habitat, amount);
            if (plan.error !== null) {
                void messageBox({ caption: 'Relocate population', text: WHY[plan.error] ?? 'Not possible.', icon: 'warning' });
                return;
            }
            const run = (): void => issuePlayerCommand(galaxy, empire, 'relocatePopulation', [h, dest.habitat, plan.amount], () => rerender());
            if (!plan.abandon) {
                run();
                return;
            }
            void messageBox({
                caption: 'Evacuate colony',
                text: scenarioText('Beacon Reloc Warning', h.name, formatPeople(plan.amount), dest.habitat.name, plan.cost.toLocaleString('en-US')),
                buttons: ['Yes', 'No'],
                icon: 'warning',
            }).then((b) => {
                if (b === 'Yes') run();
            });
        },
    });
    box.appendChild(place(go, w - 110, 44, 106, 22));
    slider.addEventListener('input', () => {
        amount = Math.round((Number(slider.value) / 1000) * dest.max);
        field.value = String(Math.round(amount / 1e6));
        refresh();
    });
    function refresh(): void {
        const plan = relocationPlan(galaxy, empire, h, dest.habitat, amount);
        const money = plan.cost > 0 ? `$${plan.cost.toLocaleString('en-US')}` : '$0';
        info.textContent = plan.error !== null && plan.error !== 'funds' ? (WHY[plan.error] ?? '') : `${formatPeople(plan.amount)} for ${money}${plan.error === 'funds' ? ' (not enough money)' : ''}${plan.abandon ? ' — evacuates the colony' : ''}`;
        info.style.color = plan.error === null ? (plan.abandon ? COLORS.red : COLORS.green) : COLORS.red;
    }
    function sync(): void {
        slider.value = String(Math.round((amount / Math.max(1, dest.max)) * 1000));
        field.value = String(Math.round(amount / 1e6));
        refresh();
    }
    sync();
}
