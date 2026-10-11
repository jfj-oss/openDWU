// Colony Economy UI (docs/ECONOMY.md §6): the colony screen's Economy tab and the Empire Summary's treasury (bonds)
// window. Pure view models come from the sim (designations.ts / facilities.ts / bonds.ts); every action is a journaled
// player command (playerOps.ts econ*). DOM only here; no sim writes.

import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import {
    DESIGNATIONS,
    DESIGNATION_NAMES,
    DESIGNATION_SUMMARY,
    Designation,
    ECON_BOND_FLAG,
    ECON_DESIG_FLAG,
    ECON_FAC_FLAG,
    designationCooldownDays,
    designationOf,
    designationRefusal,
    designationScores,
    econOn,
    REFINERY_FACILITIES,
    facilitiesLostByChange,
    facilitySlotView,
    bondView,
} from '../../sim/scenario/colonyEconomy/index';
import { approvalLines, colonyBonuses } from '../../sim/scenario/colonyEconomy/effects';
import { colonyGoodsView, empireGoodsStatus, refinementActive, yardSupplyView } from '../../sim/scenario/colonyEconomy/refinement';
import { ColonyResourceEffect } from '../../sim/developmentLevel';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { resolveStarDateDescription } from '../../sim/galaxyTime';
import { COLORS, FONT, checkBox, dropDown, el, glassButton, gradientPanel, linkLabel, messageBox, openOriginalWindow, place, scrollPanel, text, type OriginalWindow } from '../originalWindow';
import { formatThousandsK } from '../screens/coloniesList';

/** The add-on's colony tab is shown (designations or facilities on). */
export function econVisible(galaxy: Galaxy): boolean {
    return econOn(galaxy, ECON_DESIG_FLAG) || econOn(galaxy, ECON_FAC_FLAG);
}

export function econBondsVisible(galaxy: Galaxy): boolean {
    return econOn(galaxy, ECON_BOND_FLAG);
}

const EFFECT_NAMES: Partial<Record<ColonyResourceEffect, string>> = {
    [ColonyResourceEffect.IncomeBoost]: 'income',
    [ColonyResourceEffect.PopulationGrowthRate]: 'growth',
    [ColonyResourceEffect.Development]: 'development',
    [ColonyResourceEffect.RecruitedTroopStrength]: 'troop strength',
    [ColonyResourceEffect.ResearchWeapons]: 'weapons research',
    [ColonyResourceEffect.ResearchEnergy]: 'energy research',
    [ColonyResourceEffect.ResearchHighTech]: 'high-tech research',
};

const signed = (v: number, d = 0): string => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;

/** The colony's live add-on effects as text lines (the Economy tab). Pure. */
export function econEffectLines(galaxy: Galaxy, h: Habitat): string[] {
    const out: string[] = [];
    for (const b of colonyBonuses(galaxy, h)) {
        const n = EFFECT_NAMES[b.effect] ?? 'bonus';
        const pct = b.effect === ColonyResourceEffect.Development ? '' : '%';
        out.push(`${b.label}: ${signed(b.value, 0)}${pct} ${n}`);
    }
    for (const l of approvalLines(galaxy, h)) out.push(`${l.label}: ${signed(l.value, 1)} approval`);
    // Refinement chain: the refined goods this colony's port and yards hold.
    const goods = colonyGoodsView(galaxy, h);
    if (goods !== null) out.push(`Refined goods here: ${goods.map((g) => `${g.name} ${Math.round(g.held)}`).join(', ')}`);
    return out;
}

/** Colony screen: the Economy tab page (designation picker + facility slots) into `page` (662 × 271). */
export function renderEconomyTab(page: HTMLElement, galaxy: Galaxy, empire: Empire, h: Habitat, rerender: () => void): void {
    const owned = h.empire === empire;
    const cur = designationOf(galaxy, h);
    // --- Designation (left) ---------------------------------------------------------------------------------------
    const left = gradientPanel({ corners: { tl: true, br: true } });
    page.appendChild(place(left, 0, 0, 300, 271));
    left.appendChild(place(text('Designation', { bold: true, size: FONT.title ?? FONT.normal }), 8, 6));
    const scores = designationScores(galaxy, h);
    const best = scores[0];
    let choice = String(cur === Designation.None ? best.designation : cur);
    const dd = dropDown(
        [Designation.None, ...DESIGNATIONS].map((d) => ({ value: String(d), label: DESIGNATION_NAMES[d] + (d === best.designation ? ' (suggested)' : '') })),
        String(cur),
        (v) => {
            choice = v;
        },
    );
    choice = String(cur);
    const cool = designationCooldownDays(galaxy, h);
    dd.disabled = !owned || !econOn(galaxy, ECON_DESIG_FLAG) || cool > 0;
    left.appendChild(place(dd, 8, 30, 170, 21));
    const apply = glassButton('Designate', {
        disabled: dd.disabled,
        onClick: () => {
            const d = Number(choice) as Designation;
            const why = designationRefusal(galaxy, empire, h, d);
            if (why !== null) {
                void messageBox({ caption: 'Designation', text: why, icon: 'warning' });
                return;
            }
            const lost = facilitiesLostByChange(galaxy, h, d);
            const run = (): void => issuePlayerCommand(galaxy, empire, 'econSetDesignation', [h, d], () => rerender());
            if (lost.length === 0) {
                run();
                return;
            }
            void messageBox({
                caption: 'Change designation',
                text: `Changing ${h.name} to ${DESIGNATION_NAMES[d]} closes: ${lost.join(', ')} (the private sector gets a quarter of the price back).\n\nAre you sure?`,
                buttons: ['Yes', 'No'],
                icon: 'question',
            }).then((b) => {
                if (b === 'Yes') run();
            });
        },
    });
    left.appendChild(place(apply, 184, 28, 108, 25));
    const sug = `Suggested: ${DESIGNATION_NAMES[best.designation]} (${best.score})${best.reasons.length > 0 ? ` — ${best.reasons.join(', ')}` : ''}`;
    left.appendChild(place(text(sug, { size: FONT.small, color: COLORS.gridText, wrapWidth: 284 }), 8, 58));
    const cd = cool > 0 ? `Can change again in ${cool} days` : 'Can change now';
    left.appendChild(place(text(cd, { size: FONT.small, color: cool > 0 ? COLORS.red : COLORS.green }), 8, 92));
    left.appendChild(place(text(`${DESIGNATION_NAMES[cur]}: ${DESIGNATION_SUMMARY[cur]}`, { size: FONT.small, wrapWidth: 284 }), 8, 110));
    const fx = scrollPanel('econ-effects');
    left.appendChild(place(fx, 8, 160, 284, 104));
    const lines = econEffectLines(galaxy, h);
    if (lines.length === 0) fx.appendChild(el('div', 'col-att-line col-att-note', 'No add-on effects at this colony.'));
    for (const l of lines) {
        const d = el('div', 'col-att-line col-att-factor', l);
        d.style.color = l.startsWith('Refined goods') ? COLORS.gridText : l.includes(': -') ? COLORS.red : COLORS.green;
        fx.appendChild(d);
    }
    // --- Facilities (right) -----------------------------------------------------------------------------------------
    const right = gradientPanel({ corners: { tl: true, br: true } });
    page.appendChild(place(right, 306, 0, 356, 271));
    if (!econOn(galaxy, ECON_FAC_FLAG)) {
        right.appendChild(place(text('Private facilities are off in this game.', { size: FONT.small }), 8, 8));
        return;
    }
    const v = facilitySlotView(galaxy, empire, h);
    right.appendChild(place(text(`Private facilities — ${v.size} colony, ${v.slots} slot${v.slots === 1 ? '' : 's'}`, { bold: true }), 8, 6));
    const list = scrollPanel('econ-facilities');
    right.appendChild(place(list, 8, 28, 340, 200));
    const row = (label: string, status: string, color: string, tip: string, btn: HTMLButtonElement | null): void => {
        const r = el('div', 'econ-fac-row');
        r.style.position = 'relative';
        r.style.height = '24px';
        r.title = tip;
        r.appendChild(place(text(label, { size: FONT.small }), 2, 4, 170, 16));
        r.appendChild(place(text(status, { size: FONT.small, color }), 160, 4, 100, 16));
        if (btn !== null) r.appendChild(place(btn, 262, 1, 72, 21));
        list.appendChild(r);
    };
    // Phase 4: at a Mining Hub / Core World the first refinery sits in the extra refinery-only slot.
    type Entry = { kind: 'built'; b: (typeof v.built)[number] } | { kind: 'req'; r: (typeof v.requests)[number] };
    const entries: Entry[] = [...v.built.map((b) => ({ kind: 'built' as const, b })), ...v.requests.map((r) => ({ kind: 'req' as const, r }))];
    const isRef = (x: Entry): boolean => REFINERY_FACILITIES.has(x.kind === 'built' ? x.b.id : x.r.id);
    const refEntry = v.refinerySlot ? (entries.find(isRef) ?? null) : null;
    const normal = entries.filter((x) => x !== refEntry);
    const showEntry = (label: string, x: Entry | null | undefined): void => {
        if (x === undefined || x === null) {
            row(`${label}: empty`, '', COLORS.gridText, '', null);
        } else if (x.kind === 'built') {
            const b = x.b;
            const status = b.progress < 1 ? `Building ${Math.round(b.progress * 100)}%` : b.unpaid ? 'Unpaid' : b.working ? 'Working' : 'Idle';
            row(`${label}: ${b.name}`, status, b.progress < 1 ? COLORS.gridText : b.working ? COLORS.green : COLORS.red, b.effect, null);
        } else {
            const rq = x.r;
            const cancel = glassButton('Cancel', { disabled: !owned, onClick: () => issuePlayerCommand(galaxy, empire, 'econCancelRequest', [h, rq.id], () => rerender()) });
            row(`${label}: ${rq.name}`, rq.commissioned ? 'Commissioned' : 'Requested', COLORS.gridText, rq.commissioned ? 'Waiting for the treasury to afford its share' : 'Waiting for the private sector to afford it', cancel);
        }
    };
    for (let i = 0; i < v.slots; i++) showEntry(`Slot ${i + 1}`, normal[i]);
    if (v.refinerySlot) showEntry('Refinery slot', refEntry);
    for (let i = v.slots; i < normal.length; i++) {
        const x = normal[i];
        if (x.kind === 'built') row(`${x.b.name} (over the slot count)`, x.b.working ? 'Working' : 'Idle', COLORS.gridText, x.b.effect, null);
    }
    if (cur === Designation.None) list.appendChild(place(text('Designate the colony to build private facilities.', { size: FONT.small, color: COLORS.gridText }), 2, 4 + 24 * v.slots + 6));
    else {
        const head = el('div', 'col-att-line col-att-header', `${DESIGNATION_NAMES[cur]} facilities`);
        head.style.marginTop = '6px';
        list.appendChild(head);
        for (const o of v.options) {
            const req = glassButton(o.refusal === 'Requested' ? 'Requested' : 'Request', {
                disabled: !owned || o.refusal !== null,
                onClick: () => issuePlayerCommand(galaxy, empire, 'econRequestFacility', [h, o.id], () => rerender()),
            });
            const tip = `${o.effect}\nPrice ${formatThousandsK(o.price)}, ${o.buildDays} days, upkeep ${formatThousandsK(o.upkeep)} a year${o.refusal !== null ? `\n${o.refusal}` : ''}`;
            row(o.name, formatThousandsK(o.price), COLORS.gridText, tip, req);
            if (o.refinery) {
                // Phase 4: "Fund from treasury" — the state commissions the refinery (journaled; it stays private-owned).
                const fund = glassButton('Fund', {
                    disabled: !owned || o.refusal !== null,
                    onClick: () => issuePlayerCommand(galaxy, empire, 'econRequestFacility', [h, o.id, true], () => rerender()),
                });
                fund.title = `Fund from treasury: the state pays ${formatThousandsK(o.stateShare)} now (the private sector the rest); the refinery stays private-owned and earns private money.`;
                const last = list.lastElementChild as HTMLElement | null;
                if (last !== null) {
                    const btn = last.querySelector('button');
                    if (btn !== null) place(btn as HTMLButtonElement, 196, 1, 62, 21);
                    last.appendChild(place(fund, 262, 1, 72, 21));
                }
            }
        }
    }
    right.appendChild(place(text(`Private surplus: ${formatThousandsK(v.surplus)}`, { size: FONT.small }), 8, 234));
    const auto = checkBox('Private sector builds on its own', v.autoFacilities, owned ? (on) => issuePlayerCommand(galaxy, empire, 'econSetAutoFacilities', [on], () => rerender()) : null, FONT.small);
    right.appendChild(place(auto, 150, 232));
}

// ---------------------------------------------------------------------------------------------------------------
// Treasury window (Empire Summary → "Bonds & private sector")
// ---------------------------------------------------------------------------------------------------------------

let treasury: OriginalWindow | null = null;

export function openTreasuryWindow(galaxy: Galaxy, empire: Empire): void {
    if (treasury !== null && !treasury.closed) {
        treasury.close();
        treasury = null;
        return;
    }
    let timer = 0;
    const win = openOriginalWindow({
        id: 'econTreasury',
        title: `Treasury: Bonds, Private Sector & Supply — ${empire.name}`,
        width: 640,
        height: refinementActive(galaxy) ? 640 : 430,
        onClose: () => {
            window.clearInterval(timer);
            treasury = null;
        },
    });
    treasury = win;
    const body = win.body;
    const render = (): void => {
        if (win.closed) return;
        body.replaceChildren();
        const v = bondView(galaxy, empire);
        const f = facilitySlotView(galaxy, empire, empire.capital ?? empire.colonies[0]);
        const panel = gradientPanel({ corners: { tl: true, br: true } });
        body.appendChild(place(panel, 10, 10, 620, 120));
        const kv = (label: string, value: string, x: number, y: number, color?: string): void => {
            panel.appendChild(place(text(label, { size: FONT.small, color: COLORS.gridText }), x, y));
            panel.appendChild(place(text(value, { size: FONT.small, bold: true, color }), x + 150, y));
        };
        kv('Treasury', formatThousandsK(empire.stateMoney), 10, 8, empire.stateMoney < 0 ? COLORS.red : undefined);
        kv('Private money', formatThousandsK(empire.privateMoney), 10, 26);
        kv('Private surplus', formatThousandsK(f.surplus), 10, 44);
        kv('Outstanding debt', `${formatThousandsK(v.outstanding)} / ${formatThousandsK(v.cap)}`, 10, 62);
        kv('Arrears', formatThousandsK(v.arrears), 10, 80, v.arrears > 0 ? COLORS.red : undefined);
        kv('Debt service a year', formatThousandsK(v.annualService), 320, 8);
        kv('Interest paid (total)', formatThousandsK(v.interestPaid), 320, 26);
        kv('Borrowed / repaid', `${formatThousandsK(v.borrowedTotal)} / ${formatThousandsK(v.repaidTotal)}`, 320, 44);
        kv('New bond rate', `${(v.quote.rate * 100).toFixed(1)}% over ${v.quote.termYears} years`, 320, 62);
        kv('New bond: at most', v.quote.refusal === null ? formatThousandsK(v.quote.max) : v.quote.refusal, 320, 80, v.quote.refusal === null ? COLORS.green : COLORS.red);
        if (v.defaulted) panel.appendChild(place(text('Defaulted: no lender buys your bonds for now', { size: FONT.small, color: COLORS.red }), 10, 100));
        // Bonds table.
        const tbl = scrollPanel('econ-bonds');
        body.appendChild(place(tbl, 10, 140, 620, 200));
        const head = el('div', 'col-att-line col-att-header', 'Bond      Principal   Outstanding   Rate    Instalment   Left   Matures');
        tbl.appendChild(head);
        if (v.bonds.length === 0) tbl.appendChild(el('div', 'col-att-line col-att-note', 'No bonds outstanding.'));
        for (const b of v.bonds) {
            const r = el('div', 'econ-bond-row');
            r.style.position = 'relative';
            r.style.height = '24px';
            const cell = (s: string, x: number, w: number, color?: string) => r.appendChild(place(text(s, { size: FONT.small, color }), x, 4, w, 16));
            cell(`#${b.id}`, 2, 50);
            cell(formatThousandsK(b.principal), 60, 80);
            cell(formatThousandsK(b.outstanding), 145, 80);
            cell(`${b.ratePct.toFixed(1)}%`, 235, 50);
            cell(formatThousandsK(b.instalment) + '/mo', 290, 80);
            cell(String(b.paymentsLeft), 380, 40, b.missed > 0 ? COLORS.red : undefined);
            cell(resolveStarDateDescription(b.maturity), 420, 110);
            const repay = glassButton('Repay', { disabled: empire.stateMoney < b.outstanding, onClick: () => issuePlayerCommand(galaxy, empire, 'econRepayBond', [b.id], () => render()) });
            r.appendChild(place(repay, 540, 1, 70, 21));
            tbl.appendChild(r);
        }
        // Actions.
        const amounts = [25_000, 50_000, 100_000, 250_000].filter((a) => a <= Math.max(25_000, v.quote.max));
        let amount = String(Math.min(v.quote.max, amounts[amounts.length - 1] ?? 25_000));
        const dd = dropDown([...amounts.map((a) => ({ value: String(a), label: formatThousandsK(a) })), { value: String(v.quote.max), label: `Most (${formatThousandsK(v.quote.max)})` }], amount, (x) => {
            amount = x;
        });
        dd.disabled = v.quote.refusal !== null;
        body.appendChild(place(dd, 10, 352, 150, 21));
        const sell = glassButton('Sell bond', { disabled: v.quote.refusal !== null, onClick: () => issuePlayerCommand(galaxy, empire, 'econIssueBond', [Number(amount)], () => render()) });
        body.appendChild(place(sell, 168, 350, 120, 25));
        const auto = checkBox('Sell bonds automatically when the treasury runs low', v.autoBonds, (on) => issuePlayerCommand(galaxy, empire, 'econSetAutoBonds', [on], () => render()), FONT.small);
        body.appendChild(place(auto, 300, 354));
        body.appendChild(place(text('The state borrows from its own private sector; instalments (principal + interest) are paid monthly from the treasury back to private money. Investment Banks lower the rate.', { size: FONT.small, color: COLORS.gridText, wrapWidth: 620 }), 10, 384));
        // Phase 4: refined goods — each good's status, and which goods each shipyard's queued builds lack.
        if (refinementActive(galaxy)) {
            const sp = scrollPanel('econ-supply');
            body.appendChild(place(sp, 10, 420, 620, 180));
            sp.appendChild(el('div', 'col-att-line col-att-header', 'Refined goods (needed from tech level; your refineries)'));
            for (const g of empireGoodsStatus(galaxy, empire)) {
                const tier = g.key === 'precision' ? 7 : 3;
                const needed = g.now >= tier ? 'needed now' : g.next >= tier ? 'needed soon' : 'not needed yet';
                const d = el('div', 'col-att-line', `${g.name}: ${needed}; ${g.refineries} working refiner${g.refineries === 1 ? 'y' : 'ies'}`);
                d.style.color = g.now >= tier && g.refineries === 0 ? COLORS.red : g.next >= tier && g.refineries === 0 ? '#e8c040' : COLORS.gridText;
                sp.appendChild(d);
            }
            sp.appendChild(el('div', 'col-att-line col-att-header', 'Shipyards: goods their queued builds lack'));
            const yards = yardSupplyView(galaxy, empire);
            if (yards.length === 0) sp.appendChild(el('div', 'col-att-line col-att-note', 'No shipyards.'));
            for (const y of yards) {
                const lack = y.lacking.length === 0 ? 'supplied' : y.lacking.map((l) => `${l.name} ${l.held}/${l.need}`).join(', ');
                const d = el('div', 'col-att-line', `${y.yard}${y.colony !== '' && y.colony !== y.yard ? ` (${y.colony})` : ''}: ${y.builds} build${y.builds === 1 ? '' : 's'}${y.waiting > 0 ? `, ${y.waiting} waiting for goods` : ''} — ${lack}`);
                d.style.color = y.waiting > 0 ? COLORS.red : y.lacking.length > 0 ? '#e8c040' : COLORS.green;
                sp.appendChild(d);
            }
        }
    };
    render();
    timer = window.setInterval(render, 2000);
    void linkLabel;
}
