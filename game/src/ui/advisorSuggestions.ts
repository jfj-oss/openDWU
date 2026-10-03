// suggest: the Advisor Suggestion window (Main.Part2.cs 2781 method_649 pnlAdvisorSuggestion). Its queue entries
// (DiplomaticMessageQueue.cs, advisor entries drawn grey with the advisor icon, :906-935) are stubs in the list under the
// top-right panel (popupstubs, messageStubList.ts). The window is an original-style ScreenPanel (originalWindow.ts).
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
import { ADVISOR_SUGGESTION_LIFETIME, AdvisorMessageType, advisorSuggestions } from '../sim/advisorQueue';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { Habitat } from '../sim/types';
import { COLORS, FONT, el, glassButton, openOriginalWindow, place, scrollPanel, text, type OriginalWindow } from './originalWindow';
import { advisorIconUrl } from './messageStubs';
import { habitatImageUrl } from './selectionInfo';
import {
    advisorSuggestionCost,
    advisorSuggestionShowTarget,
    advisorSuggestionTitle,
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

/** pnlAdvisorSuggestion (Main.Part2.cs:2788 method_649): a ScreenPanel 355 × 448, centred. */
const SUGGEST_W = 355;
const SUGGEST_H = 448;

/** The window's picture (method_659): the subject habitat's picture when there is one, else the advisor icon.
 *  TODO(port): the composed pictures (method_650 / 656 / 657: habitat + design / ship / character) — Main.Part2.cs:2943 */
function suggestionPictureUrl(m: EmpireMessage): string | null {
    const subject = m.subject;
    const icon = advisorIconUrl(m.advisorMessageType as AdvisorMessageType);
    return subject instanceof Habitat ? (habitatImageUrl(subject) ?? icon) : icon;
}

/** Start polling the player's advisor queue. Idempotent. */
export function installAdvisorSuggestions(opts: AdvisorSuggestionsOptions): void {
    removeAdvisorSuggestions();
    const { player, galaxy } = opts;

    let current: EmpireMessage | null = null;
    let win: OriginalWindow | null = null;
    let pausedByUs = false;
    let expiryQueued = false;
    let restoreView: (() => void) | null = null;

    // Main.Part2.cs 1363 pnlAdvisorSuggestion_CloseButtonClicked / method_644 + method_660.
    function close(): void {
        if (current === null) return;
        current = null;
        const w = win;
        win = null;
        w?.close();
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
            const w = win;
            win = null;
            w?.close();
        }
        current = m;
        let shown = false;
        const w = openOriginalWindow({
            id: 'advisor-suggestion',
            title: resolveGameText('Advisor Suggestion'),
            iconUrl: advisorIconUrl(m.advisorMessageType as AdvisorMessageType),
            width: SUGGEST_W,
            height: SUGGEST_H,
            onClose: () => {
                if (win === w) close();
            },
            // "Show me first": the panel moves to (20, 20) (Main.Part2.cs:2728).
            onResize: (ww) => {
                if (shown) moveTopLeft(ww);
            },
        });
        win = w;
        w.frame.setAttribute('role', 'dialog');
        const moveTopLeft = (ww: OriginalWindow): void => {
            ww.frame.style.left = '20px';
            ww.frame.style.top = '20px';
        };
        const body = w.body;
        // picAdvisorSuggestionImage: 300 × 105 at (20, 10), Zoom.
        const pic = el('img', 'advisor-suggestion-picture');
        pic.alt = '';
        pic.draggable = false;
        const url = suggestionPictureUrl(m);
        if (url !== null) pic.src = url;
        else pic.style.visibility = 'hidden';
        pic.addEventListener('error', () => (pic.style.visibility = 'hidden'));
        body.appendChild(place(pic, 20, 10, 300, 105));
        // lblAdvisorSuggestionTitle: (10, 125) 320 × 32, 22.67 px bold, centred.
        const title = place(el('div', 'advisor-suggestion-title ow-shadow', view.title), 10, 125, 320, 32);
        title.style.fontSize = `${FONT.title}px`;
        body.appendChild(title);
        // pnlAdvisorSuggestionDescriptionContainer: (10, 155) 320 × 170, the description (16.67 px) 302 wide.
        const desc = place(scrollPanel('advisor-suggestion-desc'), 10, 155, 320, 170);
        const t = text(view.text, { size: FONT.large, color: COLORS.gridText, wrapWidth: 302, className: 'advisor-suggestion-text' });
        desc.appendChild(t);
        if (view.cost !== null) {
            const c = el('div', 'advisor-suggestion-cost');
            c.append(el('span', 'advisor-suggestion-cost-label', 'Cost'), el('span', 'advisor-suggestion-cost-value', `${view.cost} credits`));
            c.append(el('span', 'advisor-suggestion-cost-money', `(treasury ${formatThousands(player.stateMoney)})`));
            desc.appendChild(c);
        }
        desc.appendChild(el('div', 'advisor-suggestion-automation', `${view.automation}: suggest (semi-automated)`));
        body.appendChild(desc);
        // Approve (10, 335) 100 × 40, Show me first (115, 335) 110 × 40, Decline (230, 335) 100 × 40.
        const approve = glassButton(resolveGameText('Approve'), {
            onClick: () => {
                // Command log: queued, applied at the next frame boundary.
                issuePlayerCommand(galaxy, player, 'approveSuggestion', [m], (r) => {
                    for (const e of r.expireDiplomacyFor) opts.expireConversations?.(e);
                });
                close();
            },
        });
        const show = glassButton(resolveGameText('Show me first'), {
            disabled: !view.canShow,
            onClick: () => {
                const target = advisorSuggestionShowTarget(m);
                if (target !== null && opts.show) restoreView = opts.show(target) ?? null;
                show.disabled = true;
                shown = true;
                moveTopLeft(w);
            },
        });
        const decline = glassButton(resolveGameText('Decline'), {
            onClick: () => {
                issuePlayerCommand(galaxy, player, 'declineSuggestion', [m]);
                close();
            },
        });
        body.append(place(approve, 10, 335, 100, 40), place(show, 115, 335, 110, 40), place(decline, 230, 335, 100, 40));
    }

    function tick(): void {
        // DiplomaticMessageQueue.cs 864 method_3: expire old entries.
        // The expiry changes saved state, so it is a command too (issued only when an entry is due, so the log stays small).
        const due = galaxyStarDate(galaxy) - ADVISOR_SUGGESTION_LIFETIME;
        if (advisorSuggestions(player).some((x) => x != null && x.starDate < due) && !expiryQueued) {
            expiryQueued = true;
            issuePlayerCommand(galaxy, player, 'expireAdvisorSuggestions', [], () => (expiryQueued = false));
        }
        if (current !== null && !advisorSuggestions(player).includes(current)) close();
    }

    const timer = setInterval(tick, 250);
    installed = { timer, close, open, current: () => current };
}

/** Stop polling and remove the queue column and the window. No-op when not installed. */
export function removeAdvisorSuggestions(): void {
    if (installed === null) return;
    const s = installed;
    installed = null;
    clearInterval(s.timer);
    s.close();
}
