// Diplomacy screen: war goals, war score and the peace-terms dialog (task 19g-3, scenario lively-galaxy flag warGoals).
// Not a port. Shown on a war row only when the flag is on; everything that changes the sim is a player command
// (playerOps `answerDecision` for the offer's decision, `proposePeaceTerms` for the player's terms, the stock
// `acceptProposal` / `declineProposal` otherwise), so the dialog replays from the command log.

import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { buildTerms, describeTerms, termsChoices, warView, type PeaceTermsResult } from '../../sim/scenario/lively/peaceTerms';
import type { PeaceTerms } from '../../sim/scenario/lively/warGoals';

interface Draft {
    cedeTheirs: Set<Habitat>;
    cedeOurs: Set<Habitat>;
    /** Who pays reparations. */
    payer: 'none' | 'they' | 'we';
    lump: number;
    perYear: number;
    years: number;
    demil: Set<Habitat>;
    demilYears: number;
    release: boolean;
}

const drafts = new WeakMap<Empire, Draft>(); // weak: per game (a Map kept every game's empires)
const replies = new WeakMap<Empire, PeaceTermsResult>();
let version = 0;
let built: { other: Empire; key: string; node: HTMLElement } | null = null;

function el(tag: string, className: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'diplomacy-propose-option', label) as HTMLButtonElement;
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

function emptyDraft(): Draft {
    return { cedeTheirs: new Set(), cedeOurs: new Set(), payer: 'none', lump: 0, perYear: 0, years: 0, demil: new Set(), demilYears: 10, release: false };
}

function draftFromTerms(t: PeaceTerms, player: Empire): Draft {
    const d = emptyDraft();
    for (const c of t.cede) (c.to === player ? d.cedeTheirs : d.cedeOurs).add(c.colony);
    if (t.reparations !== null) {
        d.payer = t.reparations.payer === player ? 'we' : 'they';
        d.lump = t.reparations.lump;
        d.perYear = t.reparations.perYear;
        d.years = t.reparations.years;
    }
    if (t.demilitarise !== null && t.demilitarise.empire !== player) {
        for (const s of t.demilitarise.systems) d.demil.add(s);
        d.demilYears = t.demilitarise.years;
    }
    d.release = t.release !== null && t.release.overlord !== player;
    return d;
}

function termsFromDraft(d: Draft, player: Empire, other: Empire, subject: Empire | null): PeaceTerms {
    const t: PeaceTerms = { cede: [], reparations: null, demilitarise: null, release: null };
    for (const c of d.cedeTheirs) t.cede.push({ colony: c, from: other, to: player });
    for (const c of d.cedeOurs) t.cede.push({ colony: c, from: player, to: other });
    if (d.payer !== 'none' && (d.lump > 0 || (d.perYear > 0 && d.years > 0))) {
        const payer = d.payer === 'we' ? player : other;
        t.reparations = { payer, payee: payer === player ? other : player, lump: d.lump, perYear: d.perYear, years: d.years };
    }
    if (d.demil.size > 0) t.demilitarise = { empire: other, beneficiary: player, systems: [...d.demil], years: d.demilYears };
    if (d.release && subject !== null) t.release = { overlord: other, subject };
    return t;
}

/** The war block for `other` (null: not at war, or the flag is off). `rerender` redraws the screen. */
export function warTermsBlock(player: Empire, other: Empire, rerender: () => void): HTMLElement | null {
    const galaxy = player.galaxy;
    const view = warView(galaxy, player, other);
    if (view === null) return null;
    const box = el('div', 'diplomacy-war');

    box.appendChild(el('div', 'diplomacy-section-heading', 'War Goals & Score'));
    box.appendChild(el('div', 'diplomacy-line', `Our goal: ${view.us.goal}${view.us.goalChosenBy === 'pending' ? ' (choose in the War Goal message)' : ''}`));
    box.appendChild(el('div', 'diplomacy-line', `Their goal: ${view.them.goal}`));
    const bal = el('div', 'diplomacy-line', `War score: ${view.us.score} vs ${view.them.score} (${view.balance > 0 ? '+' : ''}${view.balance}) after ${view.days} days`);
    bal.style.color = view.balance < 0 ? '#ff0000' : '#90ee90';
    box.appendChild(bal);
    const ledger = (label: string, s: typeof view.us): HTMLElement =>
        el('div', 'diplomacy-factor', `${label}: ${s.shipsDestroyed} ships destroyed (${s.shipValue}), ${s.coloniesTaken} colonies taken, ${s.invasions} invasions, ${s.blockadeDays} blockade-days`);
    box.appendChild(ledger('Us', view.us));
    box.appendChild(ledger('Them', view.them));

    if (view.theirOffer !== null) {
        box.appendChild(el('div', 'diplomacy-section-heading', 'Their Peace Terms'));
        for (const line of view.theirOffer) box.appendChild(el('div', 'diplomacy-line', line));
        const row = el('div', 'diplomacy-buttons');
        const answer = (option: 'accept' | 'decline' | 'counter'): void => {
            if (view.decisionId !== null) {
                issuePlayerCommand(galaxy, player, 'answerDecision', [view.decisionId, option], () => rerender());
            } else if (option === 'accept') {
                issuePlayerCommand(galaxy, player, 'acceptProposal', [other], () => rerender());
            } else if (option === 'decline') {
                issuePlayerCommand(galaxy, player, 'declineProposal', [other], () => rerender());
            } else {
                issuePlayerCommand(galaxy, player, 'proposePeaceTerms', [other, buildTerms(galaxy, player, other)], (r) => {
                    replies.set(other, r);
                    version++;
                    rerender();
                });
            }
        };
        row.append(button('Accept', () => answer('accept')), button('Decline', () => answer('decline')), button('Counter-offer', () => answer('counter')));
        box.appendChild(row);
    }

    box.appendChild(composer(player, other, rerender));
    return box;
}

function composer(player: Empire, other: Empire, rerender: () => void): HTMLElement {
    const galaxy = player.galaxy;
    const choices = termsChoices(galaxy, player, other);
    const reply = replies.get(other) ?? null;
    const key = [version, ...choices.theirColonies.map((c) => c.habitatIndex), '|', ...choices.ourColonies.map((c) => c.habitatIndex), '|', ...choices.theirSystems.map((s) => s.habitatIndex), '|', choices.theirSubjects.length].join(',');
    if (built !== null && built.other === other && built.key === key) return built.node;

    let draft = drafts.get(other);
    if (draft === undefined) {
        draft = emptyDraft();
        drafts.set(other, draft);
    }
    const d = draft;
    const subject = choices.theirSubjects[0] ?? null;
    const box = el('div', 'diplomacy-propose');
    box.appendChild(el('div', 'diplomacy-section-heading', 'Offer Peace Terms…'));

    const checkList = (label: string, items: Habitat[], set: Set<Habitat>): void => {
        if (items.length === 0) return;
        const group = el('div', 'diplomacy-propose-group');
        group.appendChild(el('div', 'diplomacy-propose-label', label));
        for (const h of items) {
            const line = el('label', 'diplomacy-line');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = set.has(h);
            cb.addEventListener('change', () => (cb.checked ? set.add(h) : set.delete(h)));
            line.append(cb, document.createTextNode(` ${h.name}`));
            group.appendChild(line);
        }
        box.appendChild(group);
    };
    checkList('They cede to us', choices.theirColonies, d.cedeTheirs);
    checkList('We cede to them', choices.ourColonies, d.cedeOurs);
    checkList('They demilitarise', choices.theirSystems, d.demil);

    const num = (label: string, value: number, set: (v: number) => void): HTMLElement => {
        const line = el('label', 'diplomacy-line');
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.value = String(value);
        input.style.width = '7em';
        input.addEventListener('change', () => set(Math.max(0, Math.floor(Number(input.value) || 0))));
        line.append(document.createTextNode(`${label} `), input);
        return line;
    };
    const rep = el('div', 'diplomacy-propose-group');
    rep.appendChild(el('div', 'diplomacy-propose-label', 'Reparations'));
    const sel = document.createElement('select');
    for (const [v, t] of [
        ['none', 'None'],
        ['they', 'They pay us'],
        ['we', 'We pay them'],
    ] as const) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        o.selected = d.payer === v;
        sel.appendChild(o);
    }
    sel.addEventListener('change', () => (d.payer = sel.value as Draft['payer']));
    rep.append(sel, num('Lump sum', d.lump, (v) => (d.lump = v)), num('Per year', d.perYear, (v) => (d.perYear = v)), num('Years', d.years, (v) => (d.years = v)));
    if (d.demil.size > 0 || choices.theirSystems.length > 0) rep.appendChild(num('Demilitarisation years', d.demilYears, (v) => (d.demilYears = Math.max(1, v))));
    box.appendChild(rep);

    if (subject !== null) {
        const line = el('label', 'diplomacy-line');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = d.release;
        cb.addEventListener('change', () => (d.release = cb.checked));
        line.append(cb, document.createTextNode(` They release the ${subject.name}`));
        box.appendChild(line);
    }

    const row = el('div', 'diplomacy-propose-options');
    row.appendChild(
        button('Suggest', () => {
            drafts.set(other, draftFromTerms(buildTerms(galaxy, player, other), player));
            version++;
            rerender();
        }),
    );
    row.appendChild(
        button('Status quo', () => {
            drafts.set(other, emptyDraft());
            version++;
            rerender();
        }),
    );
    row.appendChild(
        button('Offer terms', () => {
            issuePlayerCommand(galaxy, player, 'proposePeaceTerms', [other, termsFromDraft(d, player, other, subject)], (r) => {
                replies.set(other, r);
                version++;
                rerender();
            });
        }),
    );
    box.appendChild(row);

    if (reply !== null) {
        const cls = !reply.ok ? 'diplomacy-reply-error' : reply.accepted ? 'diplomacy-reply-accepted' : 'diplomacy-reply-refused';
        const line = el('div', `diplomacy-reply ${cls}`);
        line.appendChild(el('span', 'diplomacy-reply-speaker', `${other.name}:`));
        line.appendChild(el('span', 'diplomacy-reply-text', reply.message));
        box.appendChild(line);
        if (reply.counter !== null) for (const t of describeTerms(reply.counter)) box.appendChild(el('div', 'diplomacy-factor', t));
    }
    built = { other, key, node: box };
    return box;
}

/** The list row's war-score suffix (e.g. " (score +23)"), or ''. */
export function warRowSuffix(player: Empire, other: Empire): string {
    const v = warView(player.galaxy, player, other);
    if (v === null) return '';
    return ` (score ${v.balance > 0 ? '+' : ''}${v.balance})`;
}
