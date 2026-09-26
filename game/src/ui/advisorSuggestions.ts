// suggest: the Advisor Suggestion window (Main.Part2.cs 2781 method_649 pnlAdvisorSuggestion) and its entries in the
// message queue column (DiplomaticMessageQueue.cs, advisor entries drawn grey with the advisor icon, :906-935). Built on
// the 16d popup system (messagePopups.ts: chips + conversation window classes).
//
// The queue lives on the player empire (src/sim/advisorQueue.ts, saved with the game); this module polls it, lets the
// player Approve / Decline / "Show me first" (Main.Part2.cs 1369 / 2732 / 2635 → src/sim/player/advisorSuggestions.ts),
// and opens the Build Order screen for a BuildOrder entry (Main.Part12.cs 2715 method_79 → method_628).
// Clicking an entry pauses the game (method_79: method_154 + bool_11) and closing the window resumes it if it paused it
// (method_660 → method_155).
//
// The C# shows no "turn automation off?" question in this flow: GenerateAutomationMessageBox (Main.Part12.cs 4452,
// "Leave automation on" / "Turn off automation") is asked when the player does a task by hand while its automation is
// Fully automated (e.g. Main.Part7.cs 360/365 colonize / build, Main.Part10.cs 4150 treaties); advisor suggestions only
// exist at SemiAutomated. The window therefore links to the level instead (automationSettingFor below; the Empire
// Policy / Game Options automation page changes it).

import './advisorSuggestions.css';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { EmpireMessage } from '../sim/messages';
import { galaxyStarDate } from '../sim/tick/simTime';
import { resolveGameText } from '../sim/textResolver';
import { formatThousands } from '../sim/diplomacyTick';
import { AdvisorMessageType, advisorSuggestions, expireOldAdvisorSuggestions } from '../sim/advisorQueue';
import {
    advisorSuggestionCost,
    advisorSuggestionShowTarget,
    advisorSuggestionTitle,
    approveSuggestion,
    declineSuggestion,
    type AdvisorShowTarget,
} from '../sim/player/advisorSuggestions';

/** The popup's content (pure; unit-tested). */
export interface AdvisorSuggestionView {
    /** Main.Part2.cs 2808-2819: Galaxy.ResolveDescription(AdvisorMessageType, message) (resolved GameText). */
    title: string;
    /** 2830: the message Description (resolved GameText). */
    text: string;
    /** The price Approve pays ("###,###,###,##0" credits), or null. */
    cost: string | null;
    /** A BuildOrder entry opens the Build Order screen instead of this window (Main.Part12.cs 2715). */
    opensBuildOrder: boolean;
    /** "Show me first" has a target (btnAdvisorSuggestionShow_Click's per-type method_645 / 646 / 647). */
    canShow: boolean;
    /** The automation setting this suggestion comes from (Game Options / Empire Policy automation rows). */
    automation: string;
}

/** Which automation row a suggestion type belongs to (the `Control*` level each CheckTaskAuthorized call site passes). */
export function automationSettingFor(t: AdvisorMessageType): string {
    const T = AdvisorMessageType;
    switch (t) {
        case T.BuildOrder:
        case T.BuildOneOff:
        case T.Retrofit:
            return 'Ship Building';
        case T.Colonization:
            return 'Colonization';
        case T.IntelligenceMission:
            return 'Intelligence Missions';
        case T.EnemyAttack:
        case T.EnemyBombard:
        case T.EnemyBlockade:
        case T.EnemyAttackPlanetDestroyer:
        case T.InvadeIndependent:
        case T.PrepareRaid:
        case T.DefendTerritory:
        case T.PirateRaid:
        case T.PirateFacilityEradicate:
        case T.DefendTarget:
            return 'Attacks Against Enemies';
        case T.DiplomaticGift:
            return 'Sending Diplomatic Gifts';
        case T.WarTradeSanctions:
        case T.ComplyTradeSanctionsOther:
        case T.ComplyWarOther:
            return 'War and Trade Sanctions';
        case T.ColonyFacility:
            return 'Colony Facility Building';
        case T.OfferPirateAttackMission:
        case T.OfferPirateDefendMission:
        case T.OfferPirateSmuggleMission:
        case T.AcceptPirateSmugglingMission:
            return 'Offer Pirate Missions';
        default:
            return 'Treaties';
    }
}

export function advisorSuggestionView(galaxy: Galaxy, player: Empire, m: EmpireMessage): AdvisorSuggestionView {
    const t = m.advisorMessageType as AdvisorMessageType;
    const cost = advisorSuggestionCost(galaxy, player, m);
    return {
        title: resolveGameText(advisorSuggestionTitle(galaxy, player, m)) || 'Advisor Suggestion',
        text: resolveGameText(m.description),
        cost: cost === null ? null : formatThousands(cost),
        opensBuildOrder: t === AdvisorMessageType.BuildOrder,
        canShow: advisorSuggestionShowTarget(m) !== null,
        automation: automationSettingFor(t),
    };
}

export interface AdvisorSuggestionsOptions {
    player: Empire;
    galaxy: Galaxy;
    /** The game clock (paused while the window is open, like method_79 / method_660). */
    clock?: { paused: boolean };
    /** "Show me first": centre and select the target; returns a function that restores the view (method_644). */
    show?: (target: AdvisorShowTarget) => (() => void) | void;
    /** A BuildOrder entry: open the Build Order screen (method_628). */
    openBuildOrder?: () => void;
    /** After Approve: the C#'s diplomaticMessageQueue_0.ExpireDiplomacyMessagesForEmpire for the conversation queue. */
    expireConversations?: (empire: Empire) => void;
}

interface Installed {
    timer: ReturnType<typeof setInterval>;
    wrap: HTMLElement;
    close: () => void;
    // [popupstubs] begin
    open: (m: EmpireMessage) => void;
    current: () => EmpireMessage | null;
    // [popupstubs] end
}
let installed: Installed | null = null;

// [popupstubs] begin
// The queue's entries are stubs in the list under the top-right panel (messageStubList.ts); a clicked stub opens here.
/** Open the Advisor Suggestion window for a queued suggestion (a clicked stub). No-op when not installed. */
export function openAdvisorSuggestion(m: EmpireMessage): void {
    installed?.open(m);
}

/** The suggestion whose window is open (null: none). */
export function openAdvisorSuggestionKey(): EmpireMessage | null {
    return installed?.current() ?? null;
}
// [popupstubs] end

function el(tag: string, className: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

/** Start polling the player's advisor queue. Idempotent. */
export function installAdvisorSuggestions(opts: AdvisorSuggestionsOptions): void {
    removeAdvisorSuggestions();
    const { player, galaxy } = opts;
    const wrap = el('div', 'message-conversation-wrap advisor-suggestion-wrap');
    wrap.hidden = true;
    document.body.append(wrap);

    let current: EmpireMessage | null = null;
    let keyListening = false;
    let pausedByUs = false;
    let restoreView: (() => void) | null = null;

    function onKey(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }

    // Main.Part2.cs 1363 pnlAdvisorSuggestion_CloseButtonClicked / method_644 + method_660.
    function close(): void {
        if (current === null) return;
        current = null;
        document.removeEventListener('keydown', onKey);
        keyListening = false;
        wrap.replaceChildren();
        wrap.hidden = true;
        wrap.classList.remove('advisor-suggestion-shown');
        restoreView?.();
        restoreView = null;
        if (pausedByUs && opts.clock) opts.clock.paused = false;
        pausedByUs = false;
    }

    function open(m: EmpireMessage): void {
        // method_79: pause (and resume on close) when the game runs.
        if (opts.clock && !opts.clock.paused && !pausedByUs) {
            opts.clock.paused = true;
            pausedByUs = true;
        }
        const view = advisorSuggestionView(galaxy, player, m);
        if (view.opensBuildOrder) {
            opts.openBuildOrder?.();
            if (pausedByUs && opts.clock) opts.clock.paused = false;
            pausedByUs = false;
            return;
        }
        if (current !== null) {
            current = null;
            wrap.replaceChildren();
        }
        current = m;
        const win = el('div', 'message-conversation-window advisor-suggestion-window');
        win.setAttribute('role', 'dialog');
        const bar = el('div', 'message-conversation-titlebar');
        bar.append(el('div', 'message-conversation-title', 'Advisor Suggestion'));
        const x = el('button', 'message-conversation-close', '✕') as HTMLButtonElement;
        x.type = 'button';
        x.title = 'Close';
        x.addEventListener('click', close);
        bar.append(x);
        const body = el('div', 'message-conversation-body');
        body.append(el('div', 'advisor-suggestion-title', view.title), el('div', 'message-conversation-text', view.text));
        if (view.cost !== null) {
            const c = el('div', 'advisor-suggestion-cost');
            c.append(el('span', 'advisor-suggestion-cost-label', 'Cost'), el('span', 'advisor-suggestion-cost-value', `${view.cost} credits`));
            const money = el('span', 'advisor-suggestion-cost-money', `(treasury ${formatThousands(player.stateMoney)})`);
            c.append(money);
            body.append(c);
        }
        body.append(el('div', 'advisor-suggestion-automation', `${view.automation}: suggest (semi-automated)`));
        const buttons = el('div', 'message-conversation-buttons');
        const button = (text: string, onClick: () => void): HTMLButtonElement => {
            const b = el('button', 'message-conversation-button', text) as HTMLButtonElement;
            b.type = 'button';
            b.addEventListener('click', onClick);
            buttons.append(b);
            return b;
        };
        button('Approve', () => {
            const r = approveSuggestion(galaxy, player, m);
            for (const e of r.expireDiplomacyFor) opts.expireConversations?.(e);
            close();
        });
        const show = button('Show me first', () => {
            const target = advisorSuggestionShowTarget(m);
            if (target !== null && opts.show) restoreView = opts.show(target) ?? null;
            show.disabled = true;
            wrap.classList.add('advisor-suggestion-shown'); // Location (20, 20)
        });
        show.disabled = !view.canShow;
        button('Decline', () => {
            declineSuggestion(galaxy, player, m);
            close();
        });
        win.append(bar, body, buttons);
        wrap.replaceChildren(win);
        wrap.hidden = false;
        if (!keyListening) document.addEventListener('keydown', onKey);
        keyListening = true;
    }

    function tick(): void {
        // DiplomaticMessageQueue.cs 864 method_3: expire old entries.
        expireOldAdvisorSuggestions(player, galaxyStarDate(galaxy));
        if (current !== null && !advisorSuggestions(player).includes(current)) close();
    }

    const timer = setInterval(tick, 250);
    installed = { timer, wrap, close, open, current: () => current };
}

/** Stop polling and remove the queue column and the window. No-op when not installed. */
export function removeAdvisorSuggestions(): void {
    if (installed === null) return;
    const s = installed;
    installed = null;
    clearInterval(s.timer);
    s.close();
    s.wrap.remove();
}
