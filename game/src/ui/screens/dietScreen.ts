// [charactersVictory] The Interstellar Diet window (docs/CHARACTERS_AND_VICTORY.md §7, §9): one original-style
// ScreenPanel from the top bar with three tabs — Session (the motions with their effects and projected result, our
// vote, the Regent's veto, our delegate, proposing), In force (measures, sanctions, enforcer fleets, past votes) and
// Members (weights, delegates and their presence). Every action is a journaled player command (multiplayer-safe).

import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { requestSimRefresh } from '../../simworker/refresh';
import { dietView, type DietViewModel, type DietMemberRow } from '../../sim/scenario/charactersVictory/diet/dietView';
import { peekDietState, type DietMotionKind } from '../../sim/scenario/charactersVictory/diet/dietState';
import { strategicValue } from '../../sim/territory';
import { showToast } from '../toast';
import { COLORS, FONT, OwGrid, darkRect, dropDown, el, glassButton, messageBox, openOriginalWindow, place, scrollPanel, tabStrip, text, type OriginalWindow } from '../originalWindow';

type Tab = 'session' | 'inForce' | 'members';

let open: { win: OriginalWindow; timer: number } | null = null;

export function closeDietScreen(): void {
    if (open !== null) open.win.close();
}

const YELLOW = 'rgb(255, 192, 0)';
const GREEN = 'rgb(128, 255, 128)';
const RED = 'rgb(255, 112, 112)';
const GREY = 'rgb(170, 170, 170)';

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
    const page = (): HTMLDivElement => {
        const p = place(el('div', 'diet-page'), 0, oy, bw, bh - oy);
        win.body.appendChild(p);
        return p;
    };
    const pages: Record<Tab, HTMLDivElement> = { session: page(), inForce: page(), members: page() };
    let tab: Tab = 'session';
    const strip = tabStrip(
        [
            { id: 'session', label: 'Session' },
            { id: 'inForce', label: 'In force' },
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

    // --- Members grid (built once) ---
    const grid = new OwGrid<DietMemberRow>({
        key: (r) => r.empire,
        rowHeight: 24,
        fontSize: FONT.normal,
        empty: 'No members.',
        rowClass: (r) => (r.you ? 'diet-you' : ''),
        columns: [
            { id: 'name', header: 'Member', fill: 1.4, sort: (r) => r.name, render: (r, c) => (c.textContent = r.name) },
            { id: 'weight', header: 'Vote weight', width: 96, align: 'right', sort: (r) => r.weight, render: (r, c) => ((c.textContent = r.weight.toFixed(1)), (c.title = r.weightNote)) },
            // A gap after the right-aligned vote weight, so the number never runs into the delegate's name.
            { id: 'gap', header: '', width: 24, render: (_r, c) => (c.textContent = '') },
            { id: 'delegate', header: 'Delegate', fill: 1.1, render: (r, c) => (c.textContent = r.delegate) },
            {
                id: 'presence',
                header: 'Presence',
                width: 120,
                sort: (r) => r.presence,
                render: (r, c) => {
                    c.textContent = r.presence;
                    c.style.color = r.presence === 'present' ? GREEN : r.presence === 'lost' || r.presence === 'none' ? RED : GREY;
                },
            },
            { id: 'tags', header: 'Notes', fill: 1, render: (r, c) => (c.textContent = r.tags) },
        ],
    });
    pages.members.appendChild(place(grid.el, 8, 30, bw - 16, bh - oy - 40));
    const membersHead = place(text('', { size: FONT.normal, color: GREY }), 10, 4, bw - 20, 22);
    pages.members.appendChild(membersHead);

    function render(): void {
        const vm = dietView(galaxy, player);
        if (vm === null) {
            pages.session.replaceChildren(place(text('The Interstellar Diet has not been founded yet: it forms once enough empires have met.', { size: FONT.large, color: GREY }), 16, 16, bw - 32));
            pages.inForce.replaceChildren();
            grid.setRows([]);
            return;
        }
        renderSession(vm);
        renderInForce(vm);
        membersHead.textContent = `Vote weight: size and strength (empire score), standing with the other members, gifts and spies; a lesser delegate counts less. Only delegates present at the host world vote.`;
        grid.setRows(vm.members);
    }

    function line(parent: HTMLElement, s: string, y: number, color = GREY, size: number = FONT.normal, x = 12, w = bw - 24): number {
        const t = place(text(s, { size, color }), x, y, w);
        t.style.whiteSpace = 'normal';
        parent.appendChild(t);
        return y + Math.ceil(size * 1.45) * Math.max(1, Math.ceil((s.length * size * 0.5) / w));
    }

    function renderSession(vm: DietViewModel): void {
        const p = pages.session;
        p.replaceChildren();
        let y = 6;
        y = line(p, `Host world: ${vm.worldName} (the ${vm.host}) — ${vm.hostBonuses}`, y);
        y = line(p, `Regent: ${vm.regent}${vm.emperor !== '' ? ` — EMPEROR: ${vm.emperor}` : ''}`, y, vm.emperor !== '' ? RED : GREY);
        const s = vm.session;
        if (s === null) {
            y = line(p, `No session sitting. The next session is called on ${vm.nextSession}.${vm.proposal !== '' ? ` Our motion for it: ${vm.proposal}.` : ''}`, y, YELLOW, FONT.large);
        } else {
            y = line(p, `${s.emergency ? 'EMERGENCY SESSION' : 'Session'} — ${s.stage === 'gathering' ? `delegates gathering; the floor opens ${s.opens}` : 'the floor is open'}; the vote closes ${s.closes}.`, y, YELLOW, FONT.large);
        }
        // Our delegate.
        if (vm.member) {
            const row = place(el('div', 'diet-row'), 12, y + 2, bw - 24, 28);
            row.appendChild(place(text('Our delegate:', { size: FONT.normal, color: GREY }), 0, 4, 120));
            const opts = vm.governors.map((g, i) => ({ value: String(i), label: `${g.label}${g.best ? ' — most important' : ' — lesser (weight penalty)'}` }));
            const cur = Math.max(0, vm.governors.findIndex((g) => g.current));
            if (opts.length > 0) {
                const dd = dropDown(opts, String(cur), (v) => {
                    const g = vm.governors[Number(v)];
                    act('dietSetDelegate', [g.best ? null : g.character], `Delegate: ${g.character.name}`);
                });
                row.appendChild(place(dd, 125, 0, 520, 26));
            } else row.appendChild(place(text('no governor to send — we have no vote', { size: FONT.normal, color: RED }), 125, 4, 520));
            if (s !== null) row.appendChild(place(text(`${s.ourDelegate}: ${s.ourPresence}`, { size: FONT.normal, color: s.ourPresence.startsWith('present') ? GREEN : GREY }), 660, 4, bw - 700));
            p.appendChild(row);
            y += 34;
        } else {
            y = line(p, 'We hold no seat in the Diet (observer).', y, RED);
        }
        // Motions.
        const listH = bh - oy - y - 76;
        const list = place(scrollPanel('diet-motions'), 8, y, bw - 16, listH);
        p.appendChild(list);
        let my = 4;
        const motions = s?.motions ?? [];
        if (motions.length === 0) {
            list.appendChild(place(text(s === null ? 'Motions are put to the next session by the members.' : 'No motions on the agenda.', { size: FONT.normal, color: GREY }), 8, my, bw - 40));
        }
        for (const m of motions) {
            const block = place(darkRect(96), 4, my, bw - 40, 104);
            // Title one line (ellipsis, full text in the tooltip) and the effect wrapped, both short of the vote buttons.
            const title = place(text(m.text, { size: FONT.normal, color: m.vetoed ? RED : YELLOW, bold: true }), 8, 6, bw - 340);
            title.style.whiteSpace = 'nowrap';
            title.style.overflow = 'hidden';
            title.style.textOverflow = 'ellipsis';
            title.title = m.text;
            block.appendChild(title);
            block.appendChild(place(text(`Moved by the ${m.proposer}. ${m.effect}`, { size: FONT.small ?? FONT.normal, color: GREY, wrapWidth: bw - 340 }), 8, 28));
            block.appendChild(place(text(`${m.advice}${m.advice !== '' ? ' · ' : ''}Projected: ${m.projected}${m.vetoed ? ' · VETOED by the Regent' : ''}`, { size: FONT.small ?? FONT.normal, color: m.projectedYes > m.projectedNo ? GREEN : RED }), 8, 76, bw - 340));
            if (vm.member && s !== null) {
                let bx = bw - 316;
                for (const [v, label] of [
                    ['yes', 'Yes'],
                    ['no', 'No'],
                    ['abstain', 'Abstain'],
                ] as const) {
                    const b = glassButton(label, { size: FONT.normal, toggled: m.ourVote === v, onClick: () => act('dietVote', [m.id, v], `Voted ${label.toLowerCase()}`) });
                    block.appendChild(place(b, bx, 8, 84, 30));
                    bx += 88;
                }
                if (s.vetoAvailable) {
                    const vb = glassButton(m.vetoed ? 'Withdraw veto' : 'Veto', { size: FONT.normal, toggled: m.vetoed, onClick: () => act('dietVeto', [m.id], m.vetoed ? 'Veto withdrawn' : 'Veto cast') });
                    block.appendChild(place(vb, bw - 316, 50, 260, 30));
                }
            }
            list.appendChild(block);
            my += 110;
        }
        // Proposing and the Regent's powers.
        if (vm.member) {
            const by = bh - oy - 70;
            const bar = place(el('div', 'diet-bar'), 8, by, bw - 16, 64);
            bar.appendChild(place(text('Move a motion:', { size: FONT.normal, color: GREY }), 4, 6, 110));
            let kind: DietMotionKind = 'sanction';
            const targets = targetOptions(galaxy, player, 'empire');
            let target = targets[0]?.value ?? '';
            const tdd = dropDown(targets, target, (v) => (target = v));
            const kdd = dropDown(vm.proposable.map((k) => ({ value: k.kind, label: k.label })), kind, (v) => {
                kind = v as DietMotionKind;
                const needs = vm.proposable.find((k) => k.kind === kind)!.needs;
                const opts = targetOptions(galaxy, player, needs);
                tdd.replaceChildren(...opts.map((o) => Object.assign(document.createElement('option'), { value: o.value, textContent: o.label })));
                target = opts[0]?.value ?? '';
                tdd.disabled = needs === 'none';
            });
            bar.appendChild(place(kdd, 115, 2, 300, 26));
            bar.appendChild(place(tdd, 420, 2, 330, 26));
            bar.appendChild(
                place(
                    glassButton('Propose', {
                        size: FONT.normal,
                        onClick: () => {
                            const args = proposalArgs(galaxy, player, kind, target);
                            if (args === null) {
                                showToast('Choose a target');
                                return;
                            }
                            act('dietPropose', args, 'Motion moved');
                        },
                    }),
                    756,
                    0,
                    110,
                    30,
                ),
            );
            if (vm.regentIsYou) {
                bar.appendChild(place(glassButton('Emergency session', { size: FONT.normal, disabled: !vm.canEmergency, title: 'Once every few years: delegates have three months to arrive', onClick: () => act('dietEmergency', [], 'Emergency session called') }), 4, 34, 200, 28));
                bar.appendChild(
                    place(
                        glassButton('Declare ourselves Emperor', {
                            size: FONT.normal,
                            disabled: !vm.canEmperor,
                            onClick: () => {
                                void messageBox({
                                    caption: 'Declare ourselves Emperor',
                                    text: `Every empire may go to war with us. We must hold our capital and ${vm.worldName} until the countdown ends to win the galaxy.`,
                                    buttons: ['Yes', 'No'],
                                    defaultButton: 'No',
                                    icon: 'warning',
                                }).then((r) => {
                                    if (r === 'Yes') act('dietDeclareEmperor', [], 'We are Emperor');
                                });
                            },
                        }),
                        210,
                        34,
                        260,
                        28,
                    ),
                );
            }
            p.appendChild(bar);
        }
    }

    function renderInForce(vm: DietViewModel): void {
        const p = pages.inForce;
        p.replaceChildren();
        const sp = place(scrollPanel('diet-inforce'), 8, 4, bw - 16, bh - oy - 12);
        p.appendChild(sp);
        let y = 4;
        const head = (s: string): void => {
            y = line(sp, s, y + 4, YELLOW, FONT.large, 8, bw - 48);
        };
        head('Measures in force');
        if (vm.laws.length === 0) y = line(sp, 'None.', y, GREY, FONT.normal, 16, bw - 56);
        for (const l of vm.laws) y = line(sp, `${l.text} — since ${l.since}, ${l.until}`, y, GREY, FONT.normal, 16, bw - 56);
        head('Sanctions');
        if (vm.sanctions.length === 0) y = line(sp, 'None.', y, GREY, FONT.normal, 16, bw - 56);
        for (const s of vm.sanctions) y = line(sp, s, y, GREY, FONT.normal, 16, bw - 56);
        head(`Enforcer fleets (Diet fund: ${vm.fund.toLocaleString()} credits)`);
        if (vm.enforcers.length === 0) y = line(sp, 'None.', y, GREY, FONT.normal, 16, bw - 56);
        for (const f of vm.enforcers) y = line(sp, `Blockade of the ${f.target}: ${f.ships} ships, ${f.stage}${f.station !== '—' ? ` at ${f.station}` : ''}. They only return fire; attacking them is open defiance.`, y, f.target === player.name ? RED : GREY, FONT.normal, 16, bw - 56);
        head('Past votes');
        if (vm.history.length === 0) y = line(sp, 'None yet.', y, GREY, FONT.normal, 16, bw - 56);
        for (const h of vm.history) y = line(sp, `${h.date}: ${h.text} — ${h.result} (${h.tally})`, y, h.result === 'passed' ? GREEN : RED, FONT.normal, 16, bw - 56);
        sp.style.height = `${bh - oy - 12}px`;
        const filler = el('div');
        filler.style.height = `${y}px`;
        sp.appendChild(filler);
    }

    render();
    requestSimRefresh(galaxy, [player], () => {
        if (win.root.isConnected) render();
    });
    timer = window.setInterval(() => {
        if (!win.root.isConnected) return;
        // Rebuild only when something changed (keeps dropdowns and scroll steady while the game runs).
        const sig = signature(galaxy);
        if (sig !== lastSig) {
            lastSig = sig;
            render();
        } else if (tab === 'members') grid.setRows(dietView(galaxy, player)?.members ?? []);
    }, 2000);
    let lastSig = signature(galaxy);
    open = { win, timer };
}

function signature(galaxy: Galaxy): string {
    const st = peekDietState(galaxy);
    if (st === null) return 'none';
    const s = st.session;
    return `${st.nextId}|${s?.id ?? 0}|${s?.stage ?? ''}|${s?.motions.map((m) => `${m.id}:${m.votes.length}`).join(',') ?? ''}|${st.vetoMotionId ?? 0}|${st.laws.length}|${st.enforcers.length}|${st.regent?.empireId ?? -1}|${st.emperor?.empire.empireId ?? -1}|${s?.delegates.map((d) => `${d.character?.name ?? ''}${d.lost ? 'x' : ''}`).join(',') ?? ''}`;
}

/** Target choices for a proposed motion (value = an id string the proposal decodes). */
function targetOptions(galaxy: Galaxy, player: Empire, needs: 'none' | 'empire' | 'pirate' | 'pair' | 'colony' | 'law'): { value: string; label: string }[] {
    const met = (e: Empire): boolean => {
        const r = player.diplomaticRelations.byEmpire(e);
        return r !== null && r.type !== DiplomaticRelationType.NotMet;
    };
    const st = peekDietState(galaxy);
    switch (needs) {
        case 'none':
            return [{ value: '', label: '(galaxy-wide)' }];
        case 'empire':
            return galaxy.empires
                .filter((e) => e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && (e === player || met(e)) && st?.faction !== e)
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
