// [charactersVictory] The Interstellar Diet window (docs/CHARACTERS_AND_VICTORY.md §7, §9): one original-style
// ScreenPanel (opened from the Diplomacy screen's Diet block) with four tabs — Session (what is happening now and when,
// our delegate, the agenda with our vote, proposing and the Regent's powers), In force (measures, sanctions, enforcer
// fleets), History (every motion voted on) and Members (weights, delegates, presence). Built from the Diplomacy screen's
// pieces: its empire flags and name colours, EmpireDetailView's dark section blocks, ListViewBase grids and
// GlassButtons. Every action is a journaled player command (multiplayer-safe).

import './dietScreen.css';
import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import { displayColorForEmpire } from '../../sim/empireColors';
import { YEAR_LENGTH, resolveStarDateDescription } from '../../sim/galaxyTime';
import { galaxyStarDate } from '../../sim/tick/simTime';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { requestSimRefresh } from '../../simworker/refresh';
import { dietView, type DietViewModel, type DietMemberRow, type DietMotionRow } from '../../sim/scenario/charactersVictory/diet/dietView';
import { peekDietState, type DietMotionKind } from '../../sim/scenario/charactersVictory/diet/dietState';
import { strategicValue } from '../../sim/territory';
import { showToast } from '../toast';
import { armMapPick } from '../orderMenu';
import { CHARACTER_IMAGE_SPEC, characterPortrait } from '../characterPortrait';
import { readableTextColors } from '../selectionInfo';
import { empireFlagUrl } from '../selectionInfoView';
import {
    COLORS,
    FONT,
    OwGrid,
    barGraph,
    checkBox,
    darkRect,
    dropDown,
    el,
    glassButton,
    linkLabel,
    messageBox,
    openOriginalWindow,
    place,
    rgbCss,
    scrollPanel,
    setGlassColors,
    tabStrip,
    text,
    type GridColumn,
    type OriginalWindow,
} from '../originalWindow';

type Tab = 'session' | 'inForce' | 'history' | 'members';

let open: { win: OriginalWindow; timer: number } | null = null;

export function closeDietScreen(): void {
    if (open !== null) open.win.close();
}

const HEADER_TEXT = 'rgb(200, 200, 200)';
const DAY = YEAR_LENGTH / 360;

// ---------------------------------------------------------------------------------------------------------------
// Small widgets
// ---------------------------------------------------------------------------------------------------------------

// Empire flags as URLs, resolved once per empire (empireFlagUrl composes the stock flag / scenario emblem asynchronously).
const flagUrls = new WeakMap<Empire, string>();
function flagImg(galaxy: Galaxy, e: Empire, w: number, h: number): HTMLImageElement {
    const img = el('img', 'diet-flag');
    img.alt = '';
    img.draggable = false;
    img.width = w;
    img.height = h;
    const known = flagUrls.get(e);
    if (known !== undefined) img.src = known;
    else {
        void empireFlagUrl(galaxy, e).then((url) => {
            flagUrls.set(e, url);
            img.src = url;
        });
    }
    return img;
}

/** An empire as the Diplomacy list shows it: its flag and its name in its colour (the readable variant of a dark colour). */
function empireChip(galaxy: Galaxy, e: Empire | null, you: Empire | null = null, flag: [number, number] = [30, 18]): HTMLElement {
    const chip = el('span', 'diet-emp');
    if (e === null) {
        chip.appendChild(el('span', 'diet-emp-name diet-muted', 'none'));
        return chip;
    }
    const t = readableTextColors(displayColorForEmpire(e));
    chip.style.setProperty('--diet-shadow', t.shadow === 0 ? '#000' : '#fff');
    chip.appendChild(flagImg(galaxy, e, flag[0], flag[1]));
    const name = el('span', 'diet-emp-name', e.name);
    name.style.color = rgbCss(t.color);
    chip.appendChild(name);
    if (you !== null && e === you) chip.appendChild(el('span', 'diet-muted', '(us)'));
    return chip;
}

function badge(label: string, kind: '' | 'pass' | 'fail' | 'veto' | 'ours', title = ''): HTMLElement {
    const b = el('span', `diet-badge${kind !== '' ? ` diet-${kind}` : ''}`, label);
    if (title !== '') b.title = title;
    return b;
}

/** A game date's distance: "59 days", "5 months", "2.5 years". */
function spanText(from: number, to: number): string {
    const days = Math.ceil((to - from) / DAY);
    if (days <= 0) return 'now';
    if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
    if (days < 720) return `${Math.round(days / 30)} months`;
    const y = Math.round((days / 360) * 10) / 10;
    return `${y} years`;
}

/** "2151.03.05 — in 59 days". */
function whenText(at: number, now: number): string {
    return at < 0 ? '—' : `${resolveStarDateDescription(at)} — ${now >= at ? 'now' : `in ${spanText(now, at)}`}`;
}

function resultKind(r: string): 'pass' | 'fail' | 'veto' {
    return r === 'passed' ? 'pass' : r === 'vetoed' ? 'veto' : 'fail';
}

const RESULT_WORD: Record<string, string> = { passed: 'PASSED', failed: 'FAILED', vetoed: 'VETOED' };

/** A section heading with an optional note at its right end (both absolutely placed). */
function heading(parent: HTMLElement, label: string, x: number, y: number, note = '', noteRight = 0): void {
    parent.appendChild(place(el('div', 'diet-heading', label), x, y));
    if (note !== '') {
        const n = place(el('div', 'diet-note', note), 0, y + 4);
        n.style.right = `${noteRight}px`;
        n.style.left = 'auto';
        parent.appendChild(n);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------------------------------------------

/** Open (or close, when open) the Interstellar Diet window for `player`. */
export function toggleDietScreen(galaxy: Galaxy, player: Empire): void {
    if (open !== null) {
        open.win.close();
        return;
    }
    const W = 1060;
    const H = 740;
    let timer = 0;
    const win = openOriginalWindow({
        id: 'diet',
        title: 'The Interstellar Diet',
        icon: 'diplomacy.png',
        width: W,
        height: H,
        noAutoPause: true,
        onClose: () => {
            window.clearInterval(timer);
            open = null;
        },
    });
    const bw = win.bodySize.w;
    const bh = win.bodySize.h;
    const oy = 32;
    const ph = bh - oy; // page height
    const pw = bw - 16; // block width
    const page = (): HTMLDivElement => {
        const p = place(el('div', 'diet-page'), 0, oy, bw, ph);
        win.body.appendChild(p);
        return p;
    };
    const pages: Record<Tab, HTMLDivElement> = { session: page(), inForce: page(), history: page(), members: page() };
    let tab: Tab = 'session';
    const strip = tabStrip(
        [
            { id: 'session', label: 'Session' },
            { id: 'inForce', label: 'In force' },
            { id: 'history', label: 'History' },
            { id: 'members', label: 'Members' },
        ],
        tab,
        (id) => {
            tab = id as Tab;
            show();
            render();
        },
        150,
    );
    win.body.appendChild(place(strip, 10, 4, bw - 20));
    const show = (): void => {
        for (const [k, p] of Object.entries(pages)) p.style.display = k === tab ? '' : 'none';
    };
    show();

    const act = (op: 'dietVote' | 'dietVeto' | 'dietSetDelegate' | 'dietEmergency' | 'dietDeclareEmperor' | 'dietPropose', args: unknown[], done: string): void => {
        issuePlayerCommand(galaxy, player, op as never, args as never, (ok: unknown) => {
            showToast(ok === true ? done : `${done}: not possible now`);
            render();
        });
    };

    /** Per-window UI state that survives re-renders: the motion being composed, the cards opened, the history filter. */
    let propKind: DietMotionKind = 'sanction';
    let propTarget = '';
    const expanded = new Set<number>();
    let showAll = false;
    /** Countdown texts refreshed in place by the timer (no rebuild, so a drop-down being used stays open). */
    let live: { node: HTMLElement; text: (now: number) => string }[] = [];
    const countdown = (node: HTMLElement, f: (now: number) => string, now: number): void => {
        node.textContent = f(now);
        live.push({ node, text: f });
    };

    function render(): void {
        const vm = dietView(galaxy, player);
        live = [];
        if (vm === null) {
            const p = pages[tab];
            p.replaceChildren();
            const b = place(darkRect(), 8, 4, pw, 70);
            b.appendChild(place(el('div', 'diet-heading', 'The Interstellar Diet has not been founded'), 14, 8));
            b.appendChild(place(el('div', 'diet-note', 'It forms once enough empires have met.'), 14, 38));
            p.appendChild(b);
            return;
        }
        if (tab === 'session') renderSession(vm);
        else if (tab === 'inForce') renderInForce(vm);
        else if (tab === 'history') renderHistory(vm);
        else renderMembers(vm);
    }

    // --- Session ---------------------------------------------------------------------------------------------

    function renderSession(vm: DietViewModel): void {
        const p = pages.session;
        const keepScroll = p.querySelector('.diet-agenda')?.scrollTop ?? 0;
        p.replaceChildren();
        const s = vm.session;
        const now = vm.now;

        // What is happening now, and when.
        let y0 = 4;
        if (vm.emperorBid !== null) {
            // An Emperor's bid is the biggest thing happening: a banner above everything else.
            const b = vm.emperorBid;
            const banner = place(darkRect(), 8, y0, pw, 30);
            banner.classList.add('diet-block', 'diet-alarm');
            const row = place(el('div', 'diet-row'), 14, 0, pw - 28, 30);
            const tag = el('span', 'diet-bad', 'EMPEROR');
            tag.style.fontWeight = 'bold';
            tag.style.fontSize = `${FONT.large}px`;
            const hold = el('span', 'diet-shadow', `must hold ${b.capital} until ${resolveStarDateDescription(b.untilAt)} (${spanText(now, b.untilAt)} to go)`);
            row.append(tag, empireChip(galaxy, b.empire, player), hold);
            banner.title = vm.emperor;
            banner.appendChild(row);
            p.appendChild(banner);
            y0 += 36;
        }
        const topH = 112;
        const top = place(darkRect(), 8, y0, pw, topH);
        top.classList.add('diet-block');
        p.appendChild(top);
        const title = place(el('div', 'diet-heading'), 16, 8);
        top.appendChild(title);
        const sub = place(el('div', 'diet-shadow'), 16, 36);
        sub.style.fontSize = `${FONT.large}px`;
        top.appendChild(sub);
        const stepsW = 470;
        if (s === null) {
            title.textContent = 'The Diet is not sitting';
            title.style.color = 'rgb(170, 170, 170)';
            countdown(sub, (n) => `Next session is called on ${resolveStarDateDescription(vm.nextSessionAt)} — in ${spanText(n, vm.nextSessionAt)}`, now);
            const q = place(el('div', 'diet-shadow'), 16, 70, stepsW + 20);
            q.style.whiteSpace = 'normal';
            if (!vm.member) {
                q.textContent = 'We hold no seat in the Diet: we may only watch.';
                q.style.color = COLORS.red;
            } else if (vm.proposal !== '') {
                q.textContent = `Our motion for it: ${vm.proposal}`;
                q.style.color = COLORS.link;
            } else {
                q.textContent = 'Members put their motions to each session; ours can be moved below.';
                q.style.color = 'rgb(130, 130, 130)';
            }
            top.appendChild(q);
        } else {
            const gathering = s.stage === 'gathering';
            title.textContent = `${s.emergency ? 'Emergency session' : 'Session in progress'} — ${gathering ? 'delegates are gathering' : 'the floor is open'}`;
            title.style.color = COLORS.link;
            const at = gathering ? s.opensAt : s.closesAt;
            countdown(sub, (n) => `${gathering ? 'The floor opens' : 'The vote closes'} ${whenText(at, n)}`, now);
            // The three stages: gathering, the floor open (votes cast), the tally.
            const steps = place(el('div', 'diet-steps'), 16, 66, stepsW);
            const names = ['Gathering', 'Floor open', 'Tally'];
            const cur = gathering ? 0 : 1;
            names.forEach((n, i) => steps.appendChild(el('div', `diet-step${i < cur ? ' diet-done' : i === cur ? ' diet-now' : ''}`, n)));
            top.appendChild(steps);
            const dates = [s.calledAt, s.opensAt, s.closesAt];
            const cell = stepsW / 3;
            dates.forEach((d, i) => {
                const t = place(el('div', 'diet-stepdate', i === 0 ? `called ${resolveStarDateDescription(d)}` : `${i === 1 ? 'opens' : 'closes'} ${resolveStarDateDescription(d)}`), 16 + i * cell, 92, cell);
                t.style.fontSize = `${FONT.small}px`;
                top.appendChild(t);
            });
        }
        // The facts at the right: the seat, the Regent, our weight, the Emperor's bid.
        const facts = place(el('div', 'diet-facts'), 600, 10, pw - 600 - 12);
        const fact = (label: string, node: HTMLElement | string, tip = ''): void => {
            facts.appendChild(el('div', 'diet-label', label));
            const v = el('div', 'diet-fact');
            if (typeof node === 'string') v.textContent = node;
            else v.appendChild(node);
            if (tip !== '') v.title = tip;
            facts.appendChild(v);
        };
        {
            const seat = el('span', 'diet-emp');
            seat.append(empireChip(galaxy, vm.hostEmpire, player), el('span', 'diet-muted', `— ${vm.worldName}`));
            fact('Seat', seat, `Host world ${vm.worldName}: ${vm.hostBonuses}`);
        }
        {
            const r = el('span', 'diet-emp');
            r.appendChild(empireChip(galaxy, vm.regentEmpire, player));
            if (vm.regentEmpire !== null) r.appendChild(el('span', 'diet-muted', `until ${resolveStarDateDescription(vm.regentUntilAt)}`));
            fact('Regent', r, 'The Regent may veto one motion per session, call emergency sessions and declare themselves Emperor.');
        }
        const me = vm.members.find((m) => m.you);
        if (me !== undefined) {
            const total = vm.members.reduce((a, m) => a + m.weight, 0);
            fact('Our weight', `${me.weight.toFixed(1)} of ${total.toFixed(1)} (${total > 0 ? Math.round((me.weight / total) * 100) : 0}%)`, me.weightNote);
        }
        if (vm.warCrimes !== '') {
            fact('Crimes', vm.warCrimes);
        }
        top.appendChild(facts);

        // Our delegate.
        let y = y0 + topH + 6;
        const dBlock = place(darkRect(), 8, y, pw, 44);
        p.appendChild(dBlock);
        if (vm.member) {
            const row = place(el('div', 'diet-row'), 12, 4, pw - 24, 36);
            row.appendChild(el('span', 'diet-label', 'Our delegate'));
            const cur = vm.governors.find((g) => g.current);
            if (cur !== undefined) {
                const pic = characterPortrait(cur.character, 'small', CHARACTER_IMAGE_SPEC.small.bitmap);
                pic.style.width = pic.style.height = '34px';
                row.appendChild(pic);
            }
            const opts = vm.governors.map((g, i) => ({ value: String(i), label: `${g.character.name}${g.post !== '' ? `, governor of ${g.post}` : ''}${g.best ? '' : ' — lesser delegate'}` }));
            if (opts.length > 0) {
                const dd = dropDown(
                    opts,
                    String(Math.max(0, vm.governors.findIndex((g) => g.current))),
                    (v) => {
                        const g = vm.governors[Number(v)];
                        act('dietSetDelegate', [g.best ? null : g.character], `Delegate: ${g.character.name}`);
                    },
                    'Our most important governor weighs fully; a lesser delegate counts for less.',
                );
                dd.style.width = '420px';
                dd.style.height = '26px';
                row.appendChild(dd);
            } else row.appendChild(el('span', 'diet-bad', 'no governor to send — we have no vote'));
            if (s !== null) {
                const k = s.ourPresenceKind;
                const word = k === 'present' ? `Present at ${vm.worldName}` : k === 'travelling' ? `On the way to ${vm.worldName}` : k === 'lost' ? 'Lost on the way' : k === 'none' ? 'No delegate to send' : 'Still at home';
                const chip = el('span', k === 'present' ? 'diet-good' : k === 'lost' || k === 'none' ? 'diet-bad' : 'diet-warn', word);
                chip.style.fontWeight = 'bold';
                chip.style.textShadow = '1px 1px 0 #000';
                row.appendChild(chip);
                if (s.ourLesser) row.appendChild(badge('lesser delegate', '', s.ourPresence));
            } else row.appendChild(el('span', 'diet-muted', 'sent to the host world when a session is called'));
            dBlock.appendChild(row);
        } else {
            dBlock.appendChild(place(el('div', 'diet-note', 'We hold no seat in the Diet (observer).'), 14, 13));
        }
        y += 44 + 6;

        // The bottom bar: moving a motion, the Regent's powers.
        const ours = s !== null && s.motions.some((m) => m.proposerEmpire === player);
        const regentRow = vm.member && vm.regentIsYou;
        const queuedRow = vm.member && vm.proposal !== '' && s !== null; // (no session: the top block already says it)
        const barH = !vm.member ? 0 : regentRow || queuedRow ? 82 : 46;
        const barY = ph - barH - 4;

        // The agenda.
        heading(p, s !== null ? `Agenda — ${s.motions.length} motion${s.motions.length === 1 ? '' : 's'}` : 'Latest votes', 14, y, s !== null && s.motions.length > 0 ? 'click a motion for details' : '', 22);
        y += 28;
        const listH = barY - y - 6;
        const list = place(scrollPanel('diet-agenda'), 8, y, pw, Math.max(60, listH));
        p.appendChild(list);
        if (s !== null) {
            if (s.motions.length === 0) list.appendChild(el('div', 'diet-empty', 'No motions on the agenda.'));
            for (const m of s.motions) list.appendChild(motionCard(vm, m));
        } else if (vm.history.length === 0) {
            list.appendChild(el('div', 'diet-empty', 'The Diet has not voted on anything yet.'));
        } else {
            for (const h of vm.history.slice(0, 6)) {
                const row = el('div', 'diet-vote');
                row.append(el('span', 'diet-vote-date', h.date), badge(RESULT_WORD[h.result] ?? h.result.toUpperCase(), resultKind(h.result)), el('span', 'diet-vote-text', h.text), el('span', 'diet-vote-tally', h.tally));
                (row.children[2] as HTMLElement).title = h.text;
                list.appendChild(row);
            }
        }

        list.scrollTop = keepScroll;
        if (!vm.member) return;
        const bar = place(darkRect(), 8, barY, pw, barH);
        p.appendChild(bar);
        const row1 = place(el('div', 'diet-row'), 12, 8, pw - 24, 30);
        row1.appendChild(el('span', 'diet-label', 'Move a motion'));
        if (!vm.proposable.some((k) => k.kind === propKind)) propKind = vm.proposable[0]?.kind ?? 'sanction';
        const needsOf = (k: DietMotionKind) => vm.proposable.find((x) => x.kind === k)?.needs ?? 'empire';
        const targetOpts = (k: DietMotionKind) => targetOptions(galaxy, player, needsOf(k));
        let opts = targetOpts(propKind);
        if (!opts.some((o) => o.value === propTarget)) propTarget = opts[0]?.value ?? '';
        const tdd = dropDown(opts, propTarget, (v) => (propTarget = v), 'The empire, pair, colony or measure the motion names.');
        tdd.disabled = needsOf(propKind) === 'none' || needsOf(propKind) === 'point';
        const kdd = dropDown(
            vm.proposable.map((k) => ({ value: k.kind, label: k.label })),
            propKind,
            (v) => {
                propKind = v as DietMotionKind;
                opts = targetOpts(propKind);
                tdd.replaceChildren(...opts.map((o) => Object.assign(document.createElement('option'), { value: o.value, textContent: o.label })));
                propTarget = opts[0]?.value ?? '';
                tdd.value = propTarget;
                tdd.disabled = needsOf(propKind) === 'none' || needsOf(propKind) === 'point';
                const lab = propose.querySelector('.ow-glass-text');
                if (lab !== null) lab.textContent = proposeLabel();
            },
            'The kind of motion.',
        );
        kdd.style.width = '330px';
        tdd.style.width = '330px';
        kdd.style.height = tdd.style.height = '26px';
        const gathering = s !== null && s.stage === 'gathering';
        const joinsNow = gathering ? !ours : false;
        const proposeLabel = (): string => (needsOf(propKind) === 'point' ? 'Pick the place on the map...' : joinsNow ? 'Add to this session' : 'Put to the next session');
        const propose = glassButton(proposeLabel(), {
            size: FONT.normal,
            disabled: gathering && ours,
            title: gathering ? (ours ? 'We have already moved a motion in this session.' : 'Delegates are still gathering: our motion joins this session.') : 'Motions are heard at the next session (one of ours at a time).',
            onClick: () => {
                if (needsOf(propKind) === 'point') {
                    // The Diet window closes, the next map click names the place (the server snaps it to the nearest empty void), then the window comes back.
                    const kind = propKind;
                    const back = (): void => {
                        if (open === null) toggleDietScreen(galaxy, player);
                    };
                    closeDietScreen();
                    if (!armMapPick('Click the empty void where it is to be built (right click cancels)', (x, y) => issuePlayerCommand(galaxy, player, 'dietPropose' as never, [kind, null, null, null, -1, { x, y }] as never, (ok: unknown) => {
                        showToast(ok === true ? 'Motion queued for the next session' : 'The motion could not be moved: no empty void there');
                        back();
                    }), back)) back();
                    return;
                }
                const args = proposalArgs(galaxy, player, propKind, propTarget);
                if (args === null) {
                    showToast('Choose a target');
                    return;
                }
                act('dietPropose', args, joinsNow ? 'Motion added to this session' : 'Motion queued for the next session');
            },
        });
        propose.style.width = '190px';
        propose.style.height = '30px';
        row1.append(kdd, tdd, propose);
        bar.appendChild(row1);
        if (regentRow || queuedRow) {
            const row2 = place(el('div', 'diet-row'), 12, 44, pw - 24, 30);
            if (queuedRow) {
                const q = el('span', 'diet-warn', `Queued for the next session: ${vm.proposal}`);
                q.style.textShadow = '1px 1px 0 #000';
                row2.appendChild(q);
            }
            if (regentRow) {
                const lbl = el('span', 'diet-label', "Regent's powers");
                lbl.title = 'Veto one motion per session; call an emergency session once every few years; declare ourselves Emperor.';
                const sp = el('span');
                sp.style.flex = '1';
                const em = glassButton('Emergency session', { size: FONT.normal, disabled: !vm.canEmergency, title: vm.canEmergency ? 'Delegates have three months to arrive. Once every few years.' : 'Not while a session sits, and only once every few years.', onClick: () => act('dietEmergency', [], 'Emergency session called') });
                em.style.width = '200px';
                em.style.height = '30px';
                const emp = glassButton('Declare ourselves Emperor', {
                    size: FONT.normal,
                    disabled: !vm.canEmperor,
                    title: vm.emperorNote !== '' ? vm.emperorNote : 'Nearly every empire goes to war with us; hold our capital to win.',
                    colors: { glow: 0xa02020 },
                    onClick: () => {
                        void messageBox({
                            caption: 'Declare ourselves Emperor',
                            text: `Nearly every empire will rise against us at once, with their fleets marching on our colonies and stations. We must hold our capital for ten years to win the galaxy.`,
                            buttons: ['Yes', 'No'],
                            defaultButton: 'No',
                            icon: 'warning',
                        }).then((r) => {
                            if (r === 'Yes') act('dietDeclareEmperor', [], 'We are Emperor');
                        });
                    },
                });
                emp.style.width = '250px';
                emp.style.height = '30px';
                row2.append(sp, lbl, em, emp);
            }
            bar.appendChild(row2);
        }
    }

    /** One motion: a short name, who moved it and whom it names, the projected tally, and our vote. */
    function motionCard(vm: DietViewModel, m: DietMotionRow): HTMLElement {
        const s = vm.session!;
        const lead = m.projectedYes > m.projectedNo;
        const idle = m.projectedYes + m.projectedNo === 0 && !m.vetoed;
        const card = el('div', `diet-card ${m.vetoed ? 'diet-veto' : idle ? 'diet-idle' : lead ? 'diet-pass' : 'diet-fail'}`);
        const main = el('div', 'diet-card-main');
        const t = el('div', 'diet-card-title');
        const name = el('span', '', m.text);
        name.title = m.text;
        t.appendChild(name);
        if (m.proposerEmpire === player) t.appendChild(badge('OURS', 'ours'));
        if (m.vetoed) t.appendChild(badge('VETOED', 'veto', 'The Regent has vetoed this motion: it fails at the tally.'));
        main.appendChild(t);
        const subr = el('div', 'diet-card-sub');
        const by = el('span');
        by.append('Moved by ', empireChip(galaxy, m.proposerEmpire, player, [24, 14]));
        subr.appendChild(by);
        if (m.targetEmpire !== null && m.targetEmpire !== m.proposerEmpire) {
            const on = el('span');
            on.append('Names ', empireChip(galaxy, m.targetEmpire, player, [24, 14]));
            subr.appendChild(on);
        }
        if (m.advice !== '') {
            const a = el('span', m.advice.startsWith('Favourable') ? 'diet-good' : m.advice.startsWith('Against') ? 'diet-bad' : 'diet-muted', m.advice.replace(/ \(-?\d+\)$/, ''));
            a.title = `Our advisers' reading: ${m.advice}`;
            subr.appendChild(a);
        }
        main.appendChild(subr);
        const tally = el('div', 'diet-tally');
        const total = m.projectedYes + m.projectedNo;
        const bar = el('div', 'diet-vbar');
        if (total > 0) {
            const f = el('div', 'diet-for');
            f.style.width = `${(m.projectedYes / total) * 100}%`;
            const ag = el('div', 'diet-against');
            ag.style.width = `${(m.projectedNo / total) * 100}%`;
            bar.append(f, ag);
        }
        tally.appendChild(bar);
        const nums = el('span', '', total > 0 ? `${m.projectedYes.toFixed(1)} for · ${m.projectedNo.toFixed(1)} against — ${m.vetoed ? 'vetoed' : lead ? 'likely to pass' : 'likely to fail'}` : s.stage === 'gathering' ? 'no votes yet: delegates are still gathering' : 'no votes weighed yet');
        nums.title = m.projected;
        tally.appendChild(nums);
        const more = linkLabel(expanded.has(m.id) ? 'hide' : 'details', () => {
            if (expanded.has(m.id)) expanded.delete(m.id);
            else expanded.add(m.id);
            render();
        }, FONT.small);
        tally.appendChild(more);
        main.appendChild(tally);
        card.appendChild(main);
        if (vm.member) {
            const actions = el('div', 'diet-card-actions');
            for (const [v, label, glow] of [
                ['yes', 'Yes', 0x208020],
                ['no', 'No', 0x902020],
                ['abstain', 'Abstain', undefined],
            ] as const) {
                const b = glassButton(label, { size: FONT.normal, toggled: m.ourVote === v, title: `Vote ${label.toLowerCase()}${s.stage === 'gathering' ? ` (the floor opens ${s.opens}; our vote stands)` : ''}`, onClick: () => act('dietVote', [m.id, v], `Voted ${label.toLowerCase()}`) });
                if (glow !== undefined) setGlassColors(b, { glow });
                actions.appendChild(b);
            }
            if (s.vetoAvailable) {
                const vb = glassButton(m.vetoed ? 'Withdraw our veto' : 'Veto (Regent)', { size: FONT.normal, toggled: m.vetoed, title: 'The Regent may veto one motion per session.', colors: { glow: 0xa05010 }, onClick: () => act('dietVeto', [m.id], m.vetoed ? 'Veto withdrawn' : 'Veto cast') });
                vb.classList.add('diet-wide');
                actions.appendChild(vb);
            }
            card.appendChild(actions);
        }
        if (expanded.has(m.id)) {
            const d = el('div', 'diet-detail');
            d.textContent = `${m.effect}${m.advice !== '' ? ` Our advisers: ${m.advice.charAt(0).toLowerCase()}${m.advice.slice(1)}.` : ''}`;
            card.appendChild(d);
        }
        card.title = m.effect;
        card.addEventListener('click', () => {
            if (expanded.has(m.id)) expanded.delete(m.id);
            else expanded.add(m.id);
            render();
        });
        card.addEventListener('mouseleave', () => void 0);
        return card;
    }

    // --- In force --------------------------------------------------------------------------------------------

    /** A heading, a note at its right and a grid under it; returns the next y. Fixed 24 px rows, capped at `maxRows`. */
    function gridSection<T>(p: HTMLElement, y: number, label: string, note: string, rows: T[], cols: GridColumn<T>[], maxRows: number, rowClass?: (r: T) => string, empty = 'None.'): number {
        heading(p, label, 14, y, note, 22);
        y += 28;
        if (rows.length === 0) {
            const none = place(el('div', 'diet-empty', empty), 8, y, pw, 30);
            none.style.background = 'rgba(0, 0, 0, 0.376)';
            none.style.padding = '5px 14px';
            p.appendChild(none);
            return y + 30 + 12;
        }
        const g = new OwGrid<T>({ key: (r) => r, rowHeight: 24, fontSize: FONT.normal, empty, rowClass, columns: cols });
        g.el.classList.add('diet-grid');
        g.setRows(rows);
        const shown = Math.max(1, Math.min(maxRows, rows.length));
        place(g.el, 8, y, pw, 26 + shown * 24 + 2);
        p.appendChild(g.el);
        return y + 26 + shown * 24 + 2 + 12;
    }

    const empCol = <T,>(id: string, header: string, pick: (r: T) => Empire | null, fill = 1.4, flag: [number, number] = [24, 14], none = 'none'): GridColumn<T> => ({
        id,
        header,
        fill,
        sort: (r) => pick(r)?.name ?? '',
        render: (r, c) => {
            const e = pick(r);
            if (e === null) c.appendChild(el('span', 'diet-muted', none));
            else c.appendChild(empireChip(galaxy, e, player, flag));
        },
    });

    function renderInForce(vm: DietViewModel): void {
        const p = pages.inForce;
        p.replaceChildren();
        let y = 2;
        y = gridSection(
            p,
            y,
            'Measures in force',
            '',
            vm.laws,
            [
                { id: 'text', header: 'Measure', fill: 3, render: (r, c) => ((c.textContent = r.text), (c.title = r.text)) },
                { id: 'since', header: 'Since', width: 110, render: (r, c) => (c.textContent = r.since) },
                { id: 'until', header: 'Until', width: 150, render: (r, c) => (c.textContent = r.until) },
            ],
            4,
        );
        y = gridSection(
            p,
            y,
            'Sanctions',
            '',
            vm.sanctionRows,
            [
                empCol('target', 'Target', (r) => r.target, 2),
                { id: 'kind', header: 'Kind', fill: 1.2, render: (r, c) => (c.textContent = r.kind === 'sanction' ? 'Trade sanctions' : 'Embargo') },
                { id: 'since', header: 'Since year', width: 120, align: 'right', render: (r, c) => (c.textContent = String(r.since)) },
            ],
            3,
        );
        y = gridSection(
            p,
            y,
            'Enforcer fleets',
            `Diet fund: ${vm.fund.toLocaleString()} credits`,
            vm.enforcers,
            [
                empCol('target', 'Blockading', (r) => r.targetEmpire, 2),
                { id: 'ships', header: 'Ships', width: 90, align: 'center', render: (r, c) => (c.textContent = String(r.ships)) },
                { id: 'stage', header: 'Stage', fill: 1, render: (r, c) => (c.textContent = r.stage) },
                { id: 'station', header: 'At', fill: 1.4, render: (r, c) => (c.textContent = r.station) },
            ],
            3,
            (r) => (r.targetEmpire === player ? 'diet-warn-row' : ''),
        );
        const hint = place(el('div', 'diet-note', 'Enforcers only return fire; attacking one is open defiance of the Diet.'), 14, y - 6);
        p.appendChild(hint);
    }

    // --- History ---------------------------------------------------------------------------------------------

    function renderHistory(vm: DietViewModel): void {
        const p = pages.history;
        p.replaceChildren();
        const cb = checkBox('Show failed and vetoed motions', showAll, (v) => {
            showAll = v;
            renderHistory(vm);
        });
        place(cb, 14, 7);
        p.appendChild(cb);
        const rows = vm.motionLog.filter((r) => showAll || r.result === 'passed');
        const g = new OwGrid<DietViewModel['motionLog'][number]>({
            key: (r) => r,
            rowHeight: 26,
            fontSize: FONT.normal,
            empty: showAll ? 'No motions have been voted on yet.' : 'No motions have passed yet.',
            columns: [
                { id: 'year', header: 'Year', width: 70, align: 'right', sort: (r) => r.year, render: (r, c) => (c.textContent = String(r.year)) },
                { id: 'gap', header: '', width: 12, render: () => void 0 },
                { id: 'text', header: 'Motion', fill: 2.6, sort: (r) => r.text, render: (r, c) => ((c.textContent = r.text), (c.title = r.text)) },
                empCol('by', 'Moved by', (r) => r.proposerEmpire, 1.5),
                empCol('names', 'Names', (r) => r.targetEmpire, 1.5, [24, 14], '—'),
                {
                    id: 'result',
                    header: 'Result',
                    width: 100,
                    sort: (r) => r.result,
                    render: (r, c) => c.appendChild(badge(RESULT_WORD[r.result] ?? r.result, resultKind(r.result))),
                },
                { id: 'vote', header: 'For – against', width: 120, align: 'right', render: (r, c) => (c.textContent = `${r.yes.toFixed(1)} – ${r.no.toFixed(1)}`) },
            ],
        });
        g.el.classList.add('diet-grid');
        g.setRows(rows);
        p.appendChild(place(g.el, 8, 34, pw, ph - 42));
    }

    // --- Members ---------------------------------------------------------------------------------------------

    function renderMembers(vm: DietViewModel): void {
        const p = pages.members;
        p.replaceChildren();
        const sitting = vm.session !== null;
        const maxW = vm.members.reduce((a, m) => Math.max(a, m.weight), 0);
        const g = new OwGrid<DietMemberRow>({
            key: (r) => r.empire,
            rowHeight: 30,
            fontSize: FONT.normal,
            empty: 'No members.',
            rowClass: (r) => (r.you ? 'diet-you' : ''),
            columns: [
                { ...empCol<DietMemberRow>('name', 'Member', (r) => r.empire, 1.8, [36, 22]), sort: (r) => r.name },
                {
                    id: 'weight',
                    header: 'Vote weight',
                    width: 190,
                    sort: (r) => r.weight,
                    title: 'Size and strength (empire score), standing with the other members, gifts and spies; a lesser delegate counts less. Only delegates present at the host world vote.',
                    render: (r, c) => {
                        const box = el('div', 'diet-cell-bar');
                        box.appendChild(barGraph(r.weight, maxW, 130, 30, COLORS.link));
                        box.appendChild(el('span', '', r.weight.toFixed(1)));
                        c.title = r.weightNote;
                        c.appendChild(box);
                    },
                },
                { id: 'gap', header: '', width: 22, render: () => void 0 },
                { id: 'delegate', header: 'Delegate', fill: 1.3, render: (r, c) => (c.textContent = r.delegate) },
                {
                    id: 'presence',
                    header: 'Presence',
                    width: 120,
                    sort: (r) => r.presence,
                    render: (r, c) => {
                        c.textContent = !sitting ? '—' : r.presence;
                        c.style.color = !sitting ? COLORS.label : r.presence === 'present' ? COLORS.green : r.presence === 'lost' || r.presence === 'none' ? 'rgb(255, 120, 120)' : r.presence === 'travelling' ? COLORS.link : COLORS.label;
                    },
                },
                { id: 'tags', header: 'Notes', fill: 1.6, render: (r, c) => ((c.textContent = r.tags), (c.title = r.tags)) },
            ],
        });
        g.el.classList.add('diet-grid');
        g.setRows(vm.members);
        p.appendChild(place(g.el, 8, 4, pw, ph - 12));
    }

    render();
    requestSimRefresh(galaxy, [player], () => {
        if (win.root.isConnected) render();
    });
    timer = window.setInterval(() => {
        if (!win.root.isConnected) return;
        // Rebuild only when something changed (keeps dropdowns and scroll steady while the game runs); the countdowns tick in place.
        const sig = signature(galaxy, player);
        if (sig !== lastSig) {
            lastSig = sig;
            render();
        } else {
            const now = galaxyStarDate(galaxy);
            for (const l of live) l.node.textContent = l.text(now);
        }
    }, 2000);
    let lastSig = signature(galaxy, player);
    open = { win, timer };
}

function signature(galaxy: Galaxy, player: Empire): string {
    const st = peekDietState(galaxy);
    if (st === null) return 'none';
    const s = st.session;
    return `${st.nextId}|${s?.id ?? 0}|${s?.stage ?? ''}|${s?.motions.map((m) => `${m.id}:${m.votes.length}`).join(',') ?? ''}|${st.vetoMotionId ?? 0}|${st.laws.length}|${st.enforcers.length}|${st.regent?.empireId ?? -1}|${st.emperor?.empire.empireId ?? -1}|${s?.delegates.map((d) => `${d.character?.name ?? ''}${d.lost ? 'x' : ''}`).join(',') ?? ''}|${st.history.length}|${st.proposals[player.empireId]?.kind ?? ''}`;
}

/** Target choices for a proposed motion (value = an id string the proposal decodes). */
function targetOptions(galaxy: Galaxy, player: Empire, needs: 'none' | 'empire' | 'pirate' | 'pair' | 'colony' | 'law' | 'point'): { value: string; label: string }[] {
    const met = (e: Empire): boolean => {
        const r = player.diplomaticRelations.byEmpire(e);
        return r !== null && r.type !== DiplomaticRelationType.NotMet;
    };
    const st = peekDietState(galaxy);
    switch (needs) {
        case 'none':
            return [{ value: '', label: '(galaxy-wide)' }];
        case 'point':
            return [{ value: '', label: '(you pick the place on the map)' }];
        case 'empire':
            // Others first, ourselves last: a motion naming ourselves is rarely what is meant.
            return galaxy.empires
                .filter((e) => e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && (e === player || met(e)) && st?.faction !== e)
                .sort((a, b) => Number(a === player) - Number(b === player))
                .map((e) => ({ value: `e${e.empireId}`, label: e === player ? `${e.name} (us)` : e.name }));
        case 'pirate':
            return galaxy.pirateEmpires.filter((e) => e !== null && e.active).map((e) => ({ value: `e${e.empireId}`, label: e.name }));
        case 'pair': {
            const out: { value: string; label: string }[] = [];
            for (const a of galaxy.empires) {
                if (a === null || !a.active || a.pirateEmpireBaseHabitat !== null || a === galaxy.independentEmpire) continue;
                for (const r of a.diplomaticRelations) {
                    const b = r.otherEmpire;
                    if (b === null || r.type !== DiplomaticRelationType.War || b.empireId <= a.empireId || b.pirateEmpireBaseHabitat !== null) continue;
                    if (!(a === player || met(a)) || !(b === player || met(b))) continue;
                    out.push({ value: `p${a.empireId}:${b.empireId}`, label: `${a.name} and ${b.name}` });
                }
            }
            return out.length > 0 ? out : [{ value: '', label: '(no wars between known empires)' }];
        }
        case 'colony': {
            const cols: Habitat[] = [];
            for (const e of galaxy.empires) {
                if (e === null || e === player || !e.active || e.pirateEmpireBaseHabitat !== null || !met(e)) continue;
                for (const h of e.colonies) if (galaxy.checkEmpireTerritoryIdAtLocation(h.xpos, h.ypos) === player.empireId) cols.push(h);
            }
            cols.sort((a, b) => strategicValue(b) - strategicValue(a));
            const out = cols.slice(0, 15).map((h) => ({ value: `h${h.habitatIndex}`, label: `${h.name} (the ${h.empire?.name ?? ''})` }));
            return out.length > 0 ? out : [{ value: '', label: '(no foreign colony inside our territory)' }];
        }
        case 'law':
            return (st?.laws ?? []).filter((l) => l.kind !== 'truce').map((l) => ({ value: `l${l.id}`, label: l.text }));
    }
}

function proposalArgs(galaxy: Galaxy, player: Empire, kind: DietMotionKind, v: string): unknown[] | null {
    const emp = (id: number): Empire | null => [...galaxy.empires, ...galaxy.pirateEmpires].find((e) => e !== null && e.empireId === id) ?? null;
    const global = ['freeTrade', 'banPlanetDestroyers', 'banBombard', 'protectIndependents', 'openIndependents'];
    if (global.includes(kind)) return [kind, null, null, null, -1];
    if (v === '') return null;
    if (v.startsWith('e')) return [kind, emp(Number(v.slice(1))), null, null, -1];
    if (v.startsWith('p')) {
        const [a, b] = v.slice(1).split(':').map(Number);
        return [kind, emp(a), emp(b), null, -1];
    }
    if (v.startsWith('h')) {
        const idx = Number(v.slice(1));
        const h = galaxy.habitats[idx] ?? null;
        return h === null ? null : [kind, h.empire, null, h, -1];
    }
    if (v.startsWith('l')) return [kind, null, null, null, Number(v.slice(1))];
    void player;
    return null;
}

export const DIET_COLORS = COLORS;
