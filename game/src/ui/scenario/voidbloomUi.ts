// [voidbloom] The Voidbloom War's diplomacy-screen block (shown with the Concord's trade terms) and the colony lines.
// Calm, in the screen's own style: label / value lines, the screen's buttons. Every change is a journaled player
// command (playerOps vbSetPolicy / vbSetAutomation / vbLabourConvoy / vbLevyGarrison / vbStartDetox / vbBribeOfficials).

import type { Empire } from '../../sim/empire';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { voidbloomPanel } from '../../sim/scenario/voidbloom/view';

function el(tag: string, className: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function btn(label: string, onClick: () => void, active = false): HTMLButtonElement {
    const b = el('button', 'diplomacy-button', label) as HTMLButtonElement;
    b.type = 'button';
    if (active) {
        b.disabled = true;
        b.style.opacity = '0.65';
    }
    b.addEventListener('click', onClick);
    return b;
}

/** The block for `player` (null: the add-on is off). `rerender` redraws the screen after a command lands. */
export function voidbloomBlock(player: Empire, rerender: () => void): HTMLElement | null {
    const galaxy = player.galaxy;
    const p = voidbloomPanel(galaxy, player);
    if (p === null) return null;
    const run = (op: Parameters<typeof issuePlayerCommand>[2], args: unknown[]): void => issuePlayerCommand(galaxy, player, op, args as never, () => rerender());
    const box = el('div', 'diplomacy-rimterms');
    box.appendChild(el('div', 'diplomacy-section-heading', p.title));
    for (const l of p.lines) {
        const line = el('div', 'diplomacy-rimterms-line');
        const v = el('span', 'diplomacy-rimterms-value', l.value);
        if (l.bad === true) v.style.color = '#d9776b';
        line.append(el('span', 'diplomacy-rimterms-label', l.label), v);
        box.appendChild(line);
    }
    box.appendChild(el('div', 'diplomacy-line', `Policy: ${p.policyText}`));
    const pol = el('div', 'diplomacy-buttons');
    pol.append(
        btn('Smuggle', () => run('vbSetPolicy', ['smuggle']), p.policy === 'smuggle'),
        btn('Legal only', () => run('vbSetPolicy', ['legal']), p.policy === 'legal'),
        btn('Ban', () => run('vbSetPolicy', ['ban']), p.policy === 'ban'),
    );
    box.appendChild(pol);
    if (p.worlds.length > 0) {
        box.appendChild(el('div', 'diplomacy-propose-label', 'Our Voidbloom worlds'));
        for (const w of p.worlds) {
            const line = el('div', 'diplomacy-rimterms-line');
            const v = el('span', 'diplomacy-rimterms-value', `workers ${w.workers}, garrison ${w.garrison}, ${w.yieldText}, stock ${w.stock}${w.burned ? ', fields burned' : ''}`);
            if (w.short) v.style.color = '#d9776b';
            line.append(el('span', 'diplomacy-rimterms-label', w.name), v);
            box.appendChild(line);
            const row = el('div', 'diplomacy-buttons');
            row.append(btn('Send labour convoy', () => run('vbLabourConvoy', [w.world])), btn('Raise a garrison troop', () => run('vbLevyGarrison', [w.world])));
            box.appendChild(row);
        }
        const auto = el('div', 'diplomacy-buttons');
        auto.append(
            btn(p.autoLabour ? 'Automatic convoys: on' : 'Automatic convoys: off', () => run('vbSetAutomation', [{ labour: !p.autoLabour }])),
            btn(p.autoGarrison ? 'Automatic garrison: on' : 'Automatic garrison: off', () => run('vbSetAutomation', [{ garrison: !p.autoGarrison }])),
        );
        box.appendChild(auto);
    }
    const acts = el('div', 'diplomacy-buttons');
    if (p.canDetox) acts.appendChild(btn(p.detoxText, () => run('vbStartDetox', [])));
    else acts.appendChild(el('span', 'diplomacy-line diplomacy-muted', p.detoxText));
    if (p.canBribe) acts.appendChild(btn(`Bribe the Concord's officials (${p.bribeCost.toLocaleString('en-US')})`, () => run('vbBribeOfficials', [])));
    box.appendChild(acts);
    for (const h of p.history) box.appendChild(el('div', 'diplomacy-line diplomacy-muted', h));
    return box;
}
