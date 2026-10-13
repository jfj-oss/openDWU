// Diplomacy screen: war goals, war score and the peace-terms dialog (task 19g-3, scenario lively-galaxy flag warGoals).
// Not a port. Shown on a war row only when the flag is on; everything that changes the sim is a player command
// (playerOps `answerDecision` for the offer's decision, `proposePeaceTerms` for the player's terms, the stock
// `acceptProposal` / `declineProposal` otherwise), so the dialog replays from the command log.

import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { buildTerms, describeTerms, previewAcceptance, termsChoices, warView, type PeaceTermsResult } from '../../sim/scenario/lively/peaceTerms';
import type { PeaceTerms } from '../../sim/scenario/lively/warGoals';
import { currentLlmLayer } from '../../llm/llmLayer';
import { interpretPeaceWords } from '../../llm/peaceDraft';
import { readReplica } from '../../llm/replicaReads';
import { FONT, checkBox, dropDown, glassButton, numericUpDown } from '../originalWindow';
import { voidbloomTermChoices, voidbloomTermText } from '../../sim/scenario/voidbloom/treaty'; // [voidbloom]

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
    /** [voidbloom] The Concord's extra terms asked (ScenarioTerm kinds). */
    extra: Set<string>;
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
    return glassButton(label, { size: FONT.normal, className: 'ow-flow diplomacy-war-btn', onClick });
}

function emptyDraft(): Draft {
    return { cedeTheirs: new Set(), cedeOurs: new Set(), payer: 'none', lump: 0, perYear: 0, years: 0, demil: new Set(), demilYears: 10, release: false, extra: new Set() };
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
    for (const x of t.extra ?? []) if (x.to === player) d.extra.add(x.kind);
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
    const extra = voidbloomTermChoices(player.galaxy, player, other).filter((x) => d.extra.has(x.kind));
    if (extra.length > 0) t.extra = extra;
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
            const line = checkBox(h.name, set.has(h), (v) => void (v ? set.add(h) : set.delete(h)));
            line.classList.add('ow-flow', 'diplomacy-line');
            group.appendChild(line);
        }
        box.appendChild(group);
    };
    checkList('They cede to us', choices.theirColonies, d.cedeTheirs);
    checkList('We cede to them', choices.ourColonies, d.cedeOurs);
    checkList('They demilitarise', choices.theirSystems, d.demil);

    const num = (label: string, value: number, set: (v: number) => void): HTMLElement => {
        const line = el('label', 'diplomacy-line');
        const spin = numericUpDown({ value, min: 0, max: 2_000_000_000, size: FONT.normal, onChange: set });
        spin.el.classList.add('ow-flow');
        line.append(document.createTextNode(`${label} `), spin.el);
        return line;
    };
    const rep = el('div', 'diplomacy-propose-group');
    rep.appendChild(el('div', 'diplomacy-propose-label', 'Reparations'));
    const sel = dropDown(
        [
            { value: 'none', label: 'None' },
            { value: 'they', label: 'They pay us' },
            { value: 'we', label: 'We pay them' },
        ],
        d.payer,
        (v) => (d.payer = v as Draft['payer']),
    );
    sel.classList.add('ow-flow');
    sel.style.fontSize = `${FONT.normal}px`;
    rep.append(sel, num('Lump sum', d.lump, (v) => (d.lump = v)), num('Per year', d.perYear, (v) => (d.perYear = v)), num('Years', d.years, (v) => (d.years = v)));
    if (d.demil.size > 0 || choices.theirSystems.length > 0) rep.appendChild(num('Demilitarisation years', d.demilYears, (v) => (d.demilYears = Math.max(1, v))));
    box.appendChild(rep);

    if (subject !== null) {
        const line = checkBox(`They release the ${subject.name}`, d.release, (v) => (d.release = v));
        line.classList.add('ow-flow', 'diplomacy-line');
        box.appendChild(line);
    }
    // [voidbloom] The unequal-treaty terms (a Voidbloom war with the Concord).
    const vbTerms = voidbloomTermChoices(galaxy, player, other);
    if (vbTerms.length > 0) {
        const group = el('div', 'diplomacy-propose-group');
        group.appendChild(el('div', 'diplomacy-propose-label', 'Treaty rights'));
        for (const x of vbTerms) {
            const line = checkBox(voidbloomTermText(x), d.extra.has(x.kind), (v) => void (v ? d.extra.add(x.kind) : d.extra.delete(x.kind)));
            line.classList.add('ow-flow', 'diplomacy-line');
            group.appendChild(line);
        }
        box.appendChild(group);
    }

    // The live read-out of the other side's answer (pure: nothing is asked of them, nothing is drawn).
    const previewLine = el('div', 'diplomacy-factor');
    const refreshPreview = (): void => {
        const p = readReplica(galaxy, () => previewAcceptance(galaxy, player, other, termsFromDraft(d, player, other, subject)));
        previewLine.textContent = p.verdict === 'human' ? `${other.name} will answer for themselves.` : p.verdict === 'accept' ? `${other.name} would accept these terms.` : p.shortBy > 0 ? `${other.name} would refuse: they need about ${p.shortBy} more points.` : `${other.name} would refuse these terms for now.`;
    };
    refreshPreview();
    box.addEventListener('change', refreshPreview); // the controls update the draft first (target phase), then this runs
    box.addEventListener('input', refreshPreview);
    box.appendChild(previewLine);

    // [llm] Plain words -> the draft (only with the model layer on and the endpoint answering). The player still presses Offer terms.
    const layer = currentLlmLayer();
    if (layer !== null && layer.on && layer.queue !== null && layer.queue.metrics().endpoint === 'up') {
        const queue = layer.queue;
        const words = document.createElement('input');
        words.type = 'text';
        words.placeholder = 'Or say it in words: "Give me Kygnos and 2,000 a year for five years"';
        words.style.cssText = `width:100%;font-size:${FONT.normal}px`;
        const note = el('div', 'diplomacy-factor');
        let busy = false;
        const go = (): void => {
            if (busy || words.value.trim() === '') return;
            busy = true;
            note.textContent = 'Drafting…';
            void interpretPeaceWords(galaxy, player, other, queue, words.value).then((r) => {
                busy = false;
                if (r === null) {
                    note.textContent = 'No draft came back: set the terms by hand.';
                    return;
                }
                drafts.set(other, draftFromTerms(r.terms, player));
                note.textContent = [r.understood, r.unmapped !== '' ? `Not mapped: ${r.unmapped}` : ''].filter((x) => x !== '').join(' ');
                version++;
                rerender();
            });
        };
        words.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') go();
        });
        box.append(words, button('Draft', go), note);
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
