// Task 16d: popup card (Main.Part9.cs:2381 pnlMessagePopup), conversation queue (DiplomaticMessageQueue.cs)
// and conversation dialog (method_254) for the player's EmpireMessages, routed by messageRouting.ts.
// Like the ticker feed (empireMessageFeed.ts) it polls Empire.Messages, dedupes by identity and resolves the
// sim's gameText() encodings (textResolver.ts).
// The conversation buttons are conversationActions.ts (the option lists of Main.Part9.cs:46 method_238); their sim effects
// go through issuePlayerCommand. The popup card's text and a Go to button jump to the message's subject (messageGoto.ts).
// TODO(port): the original's reply text panel after a choice (Main.Part10.cs:3590 method_230): a toast summarises it here

import { closeEventSting, playDiplomacyMood, playMessageSounds } from '../audio/gameAudio'; // [audio]
import './messagePopups.css';
import { getMessageOptions, playerDefeatGameEnd, routeEmpireMessage, shouldQueueConversation, type DialogPartType } from './messageRouting';
import { onGameEnd } from '../sim/victory';
import { EmpireMessageType, empireMessages, type EmpireMessage, empireMessageHistory } from '../sim/messages';
import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import type { ConversationReplyPart } from '../sim/player/conversationReplies';
import { galaxyStarDate } from '../sim/tick/simTime';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { resolveGameText } from '../sim/textResolver';
import { isProposalValid, proposalLabel, relationTypeLabel, setDiplomacyMessageExpiry, toggleDiplomacyScreen } from './screens/diplomacyScreen';
import { issuePlayerCommand } from '../sim/player/playerCommands';
// [proposals] begin
// [proposals] end
import { showToast } from './toast';
// [diplovoice] begin
import { layerVoiceOf } from '../llm/voiceJob'; // [llm] 19s-2
import { diplomatVoiceConfig, rememberVoicedMessage, voiceDiplomatReply, voicedLineToggle, voicedMessageText, voicingIndicator } from './diplomatVoice';
// [diplovoice] end
import { rgbCss } from './hud';
import { conversationActions, pirateOfferPriceLine, type ConversationAction } from './conversationActions';
import { pirateProtectionPriceText } from './pirateProtectionPrice';
import { goToMessage, messageGoToTarget } from './messageGoto';
// [suggest] begin
import { expireAdvisorSuggestionsForEmpire, receiveAdvisorSuggestionMessage } from '../sim/advisorQueue';
// [suggest] end
// [popupstubs] begin
import { isConversationExpired } from './messageStubs';
import { pushMessageStub, markMessageStubRead } from './messageStubList';
import { getSettings } from './settings';
import { isScenarioDecision } from '../sim/scenario/decisions';
// [popupstubs] end

export interface ConversationEntry {
    message: EmpireMessage;
    conversation: DialogPartType;
    sender: Empire | null;
}

/**
 * The pirate protection / truce / extortion offer conversations (dialog/base_dialog.txt PIRATE_PROTECTIONPROPOSEINITIATE,
 * PIRATE_TRUCEPROPOSEINITIATE, PIRATE_EXTORTPROTECTION — all EmpireMessageType.PirateOfferProtection,
 * messageRouting.ts classifyEmpireMessage / Main.Part9.cs:2075). Each has an Accept response
 * (PIRATE_PROTECTIONACCEPTRESPONSE / PIRATE_TRUCEACCEPTRESPONSE, Main.Part10.cs:5132) and a Reject response
 * (PIRATE_PROTECTIONREJECTRESPONSE / PIRATE_TRUCEREJECTRESPONSE, text-only) in the dialog data; the original opens
 * the full Diplomacy talk panel for the conversation (Main.Part8.cs:449 method_296), which this popup offers as a
 * separate "Open Diplomacy" button alongside a direct Accept / Decline.
 */
const PIRATE_PROTECTION_CONVERSATIONS: ReadonlySet<DialogPartType> = new Set<DialogPartType>([
    'PIRATE_PROTECTIONPROPOSEINITIATE',
    'PIRATE_TRUCEPROPOSEINITIATE',
    'PIRATE_EXTORTPROTECTION',
]);

/** Whether `entry`'s conversation dialog shows Accept / Open Diplomacy / Decline (below) rather than a plain OK. */
export function isPirateProtectionOfferEntry(entry: ConversationEntry): boolean {
    return PIRATE_PROTECTION_CONVERSATIONS.has(entry.conversation) && entry.sender !== null;
}

/**
 * The "Open Diplomacy" button's action: Main.Part8.cs:449 method_296 (the advisor-queue click handler, method_79)
 * always opened the full Diplomacy talk panel on the message's sender. `toggleDiplomacyScreen`'s `selectedEmpire`
 * re-selects that empire even when the screen is already open on someone else, rather than toggling it closed.
 */
export function openDiplomacyForPirateOffer(player: Empire, sender: Empire): void {
    toggleDiplomacyScreen({ player, selectedEmpire: sender });
}

/** A treaty proposal from the sender that the player can still accept or decline (EmpireDetailView.cs:639-706 flag3). */
export function isAnswerableProposal(entry: ConversationEntry, player: Empire, starDate: number): boolean {
    if (entry.message.messageType !== EmpireMessageType.ProposeDiplomaticRelation) return false;
    if (entry.sender === null) return false;
    const p = player.proposedDiplomaticRelations.byEmpire(entry.sender);
    if (p === null) return false;
    return isProposalValid(p, entry.sender, player, starDate);
}

// Stand-in for DiplomaticMessageQueue.cs:404 ExpireInvalidMessages — TODO(port): the full per-type expiry rules
// [popupstubs] + DiplomaticMessageQueue.cs:671 method_3: entries older than 250 x RealSecondsInGalacticYear expire.
export function pruneConversationQueue(queue: ConversationEntry[], player: Empire, starDate: number): number {
    let removed = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
        const e = queue[i];
        if (
            (e.message.messageType === EmpireMessageType.ProposeDiplomaticRelation && !isAnswerableProposal(e, player, starDate)) ||
            (e.message.starDate > 0 && isConversationExpired(e.message.starDate, starDate))
        ) {
            queue.splice(i, 1);
            removed++;
        }
    }
    return removed;
}

/** The dialog's sub-heading: the treaty on offer (EmpireDetailView.cs text14), the relation type, or the title.
 * Without `starDate` a proposal counts as answerable while it is still in the player's proposed list. */
export function conversationHeading(entry: ConversationEntry, player: Empire, starDate?: number): string {
    const sender = entry.sender;
    const subject = entry.message.subject;
    if (entry.message.messageType === EmpireMessageType.ProposeDiplomaticRelation && sender !== null) {
        const p = player.proposedDiplomaticRelations.byEmpire(sender);
        const answerable = p !== null && (starDate === undefined || isAnswerableProposal(entry, player, starDate));
        if (p !== null && answerable) {
            return `Treaty on Offer: ${proposalLabel(p.type, player.diplomaticRelations.byEmpire(sender), player)}`;
        }
    }
    if (typeof subject === 'number') return relationTypeLabel(subject);
    return resolveGameText(entry.message.title);
}

/** The toast after an answered conversation (the reply text of the part in the original's dialog files, abridged). */
export function replyToast(part: ConversationReplyPart): string {
    switch (part) {
        case 'DEAL_ACCEPT':
            return 'Deal accepted';
        case 'DEAL_REJECT':
            return 'Deal rejected';
        case 'MUTUALDEFENSE_HONORREQUESTHELP':
            return 'We stand with our ally';
        case 'MUTUALDEFENSE_DECLINEREQUESTHELP':
            return 'Mutual defense request declined';
        case 'TRADESANCTIONS_REQUESTLIFTOTHER_ACCEPT':
            return 'Trade sanctions lifted';
        case 'TRADESANCTIONS_REQUESTIMPOSEJOINT_ACCEPT':
            return 'Trade sanctions imposed';
        case 'WAR_DECLARE_REQUESTJOINT_ACCEPT':
            return 'War declared';
        case 'WAR_END_REQUESTOTHER_ACCEPT':
            return 'War ended';
        case 'HISTORY_OFFER_STORYCLUE_ACCEPT':
        case 'HISTORY_OFFER_STORYMESSAGE_ACCEPT':
            return 'Secret revealed';
        default:
            return 'Information purchased';
    }
}

/** The popup card's header text. */
export function popupTitle(message: EmpireMessage): string {
    return resolveGameText(message.title) || message.sender?.name || 'Message';
}

export interface MessagePopupsOptions {
    player: Empire;
    galaxy: Galaxy;
    // [popupstubs] begin
    /** The game clock: an immediate conversation pauses it (Main.Part9.cs 1544 method_253 → method_154 + bool_11). */
    clock?: { paused: boolean };
    // [popupstubs] end
}

interface Installed {
    timer: ReturnType<typeof setInterval>;
    popup: HTMLElement;
    dialogRoot: HTMLElement;
    queue: ConversationEntry[];
    seen: WeakSet<EmpireMessage>;
    closeDialog: () => void;
    // [popupstubs] begin
    showPopup: (m: EmpireMessage) => void;
    closePopup: () => void;
    openDialog: (entry: ConversationEntry) => void;
    openKey: () => EmpireMessage | null;
    // [popupstubs] end
}

let installed: Installed | null = null;

// [popupstubs] begin
/**
 * The conversation queue rebuilt from a loaded game's message history (the C# queue is not saved): each history message
 * that ReceiveMessageInternal would queue (not the immediate ones, which opened at once), newer than the queue's
 * 250-year expiry, oldest first; stale treaty offers are then pruned. A non-offer conversation the player had already
 * dismissed before saving comes back until it expires — TODO(port): the C# drops the whole queue on load
 * (Main.Part12.cs 1204 ClearData); here the history stands in so pending offers survive a load.
 */
export function rebuildConversationQueue(history: readonly EmpireMessage[], player: Empire, starDate: number): ConversationEntry[] {
    const out: ConversationEntry[] = [];
    const options = getMessageOptions();
    const sorted = history.filter((m) => m != null).map((m, i) => ({ m, i })).sort((a, b) => a.m.starDate - b.m.starDate || a.i - b.i);
    for (const { m } of sorted) {
        if (m.messageType === EmpireMessageType.AdvisorSuggestion) continue;
        if (isConversationExpired(m.starDate, starDate)) continue;
        const route = routeEmpireMessage(m, player, options);
        if (route.conversation === null || shouldQueueConversation(route, options) !== 'queue') continue;
        out.push({ message: m, conversation: route.conversation, sender: m.sender });
    }
    pruneConversationQueue(out, player, starDate);
    return out;
}

/** The installed conversation queue (read-only view for the stub list; empty when not installed). */
export function conversationQueue(): readonly ConversationEntry[] {
    return installed?.queue ?? [];
}

/** Open the popup card for a plain message (a clicked stub). */
export function openMessageCard(m: EmpireMessage): void {
    installed?.showPopup(m);
}

/** Open the conversation dialog for a queued entry (a clicked stub). */
export function openConversation(entry: ConversationEntry): void {
    installed?.openDialog(entry);
}

/** Drop `m` from the conversation queue (its stub was dismissed); closes its dialog when open. */
export function dismissConversation(m: EmpireMessage): void {
    if (installed === null) return;
    const i = installed.queue.findIndex((e) => e.message === m);
    if (i >= 0) installed.queue.splice(i, 1);
    if (installed.openKey() === m) installed.closeDialog();
}

/** Close the popup card when it shows `m`. */
export function closeMessageCardFor(m: EmpireMessage): void {
    if (installed !== null && installed.openKey() === m) installed.closePopup();
}

/** The message whose card or conversation is open (null: none). */
export function openMessageKey(): EmpireMessage | null {
    return installed?.openKey() ?? null;
}
// [popupstubs] end

function el(tag: string, className: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function swatch(sender: Empire | null): HTMLElement {
    const s = el('span', 'message-swatch');
    s.style.background = sender ? rgbCss(sender.mainColor) : 'transparent';
    return s;
}

/** Start routing the player's messages into the popup card and the conversation queue. Idempotent. */
export function installMessagePopups(opts: MessagePopupsOptions): void {
    removeMessagePopups();
    const { player, galaxy } = opts;

    // Popup card (pnlMessagePopup).
    const popup = el('div', 'message-popup');
    popup.hidden = true;
    const popupHeader = el('div', 'message-popup-header');
    const popupTitleEl = el('div', 'message-popup-title');
    const popupClose = el('button', 'message-popup-close', '✕') as HTMLButtonElement;
    popupClose.type = 'button';
    popupClose.title = 'Close';
    popupHeader.append(popupTitleEl, popupClose);
    const popupBody = el('div', 'message-popup-body');
    const popupFooter = el('div', 'message-popup-footer');
    popup.append(popupHeader, popupBody, popupFooter);
    popupClose.addEventListener('click', () => closePopup());
    popupBody.addEventListener('click', () => {
        if (popupMessage !== null && popupBody.classList.contains('message-popup-body-goto')) {
            goToMessage(popupMessage, galaxy);
            closePopup();
        }
    });

    // Conversation dialog (method_254).
    const dialogRoot = el('div', 'message-conversation-wrap');
    dialogRoot.hidden = true;

    const queue: ConversationEntry[] = [];
    const seen = new WeakSet<EmpireMessage>();
    // [audio] begin — messages already in Empire.Messages (a loaded save) were received before: no arrival sound.
    const heardBefore = new WeakSet<EmpireMessage>(empireMessages(player).filter((m) => m != null));
    // [audio] end
    let dialogEntry: ConversationEntry | null = null;
    // [popupstubs] begin
    let popupMessage: EmpireMessage | null = null;
    let pausedByUs = false;
    // [popupstubs] end

    document.body.append(popup, dialogRoot);

    // [popupstubs] begin
    // Escape closes the open card (not the stub list); a conversation dialog on top takes Escape first.
    function onPopupKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape' && !popup.hidden && dialogEntry === null) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closePopup();
        }
    }

    function closePopup(): void {
        if (popup.hidden) return;
        popup.hidden = true;
        popupMessage = null;
        document.removeEventListener('keydown', onPopupKeyDown);
    }
    // [popupstubs] end

    function showPopup(m: EmpireMessage): void {
        popupTitleEl.textContent = popupTitle(m);
        popupBody.textContent = resolveGameText(m.description);
        // [popupstubs] begin
        popupFooter.textContent = resolveStarDateDescription(m.starDate > 0 ? m.starDate : galaxyStarDate(galaxy));
        popupMessage = m;
        // Mod layer: a pending scenario decision shows its options; a click answers it (scenario/decisions.ts).
        const decision = m.subject;
        if (isScenarioDecision(decision) && decision.answer === null) {
            const row = el('div', 'message-conversation-buttons');
            for (const o of decision.options) {
                const b = el('button', 'message-conversation-button', o.label) as HTMLButtonElement;
                b.type = 'button';
                b.addEventListener('click', () => {
                    // A player command (journaled, applied at the next frame boundary) so seed + command log replays it.
                    issuePlayerCommand(galaxy, decision.empire, 'answerScenarioDecision', [decision.id, o.id]);
                    closePopup();
                });
                row.appendChild(b);
            }
            popupFooter.appendChild(row);
        }
        // A notification about a place: a Go to button, and the text jumps there too (Main.Part9.cs:912 method_249).
        if (messageGoToTarget(m) !== null) {
            const row = el('div', 'message-conversation-buttons');
            const go = el('button', 'message-conversation-button message-popup-goto', 'Go to') as HTMLButtonElement;
            go.type = 'button';
            go.addEventListener('click', () => {
                goToMessage(m, galaxy);
                closePopup();
            });
            row.appendChild(go);
            popupFooter.appendChild(row);
            popupBody.classList.add('message-popup-body-goto');
            popupBody.title = 'Go to';
        } else {
            popupBody.classList.remove('message-popup-body-goto');
            popupBody.title = '';
        }
        markMessageStubRead(m);
        if (popup.hidden) document.addEventListener('keydown', onPopupKeyDown);
        // [popupstubs] end
        popup.hidden = false;
    }

    function removeEntry(entry: ConversationEntry): void {
        const i = queue.indexOf(entry);
        if (i >= 0) queue.splice(i, 1);
    }

    function onDialogKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeDialog();
        }
    }

    function closeDialog(switching = false): void {
        if (dialogEntry === null) return;
        dialogEntry = null;
        if (!switching) closeEventSting(); // [audio] Main.Part8.cs:435 talk closed → method_522
        document.removeEventListener('keydown', onDialogKeyDown);
        dialogRoot.replaceChildren();
        dialogRoot.hidden = true;
        // [popupstubs] begin
        if (pausedByUs && opts.clock) opts.clock.paused = false; // method_155 on the dialog's close
        pausedByUs = false;
        // [popupstubs] end
    }

    // The effect of a conversation button. Every sim change goes through the command queue (applied at the next frame
    // boundary, journaled), so seed + command log replays it.
    function runConversationAction(a: ConversationAction, entry: ConversationEntry, needsAnswer: boolean, finish: () => void): void {
        const sender = entry.sender;
        const e = a.effect;
        switch (e.kind) {
            case 'acceptProposal':
                if (sender === null) return;
                issuePlayerCommand(galaxy, player, 'acceptProposal', [sender], (ok) => ok && showToast('Treaty accepted'));
                finish();
                return;
            case 'declineProposal':
                if (sender === null) return;
                issuePlayerCommand(galaxy, player, 'declineProposal', [sender]);
                finish();
                return;
            case 'demandSubjugation':
                if (sender === null) return;
                issuePlayerCommand(galaxy, player, 'submitProposal', [sender, 'WAR_END_SUBJUGATIONDEMAND'], (r) => {
                    if (r.message !== '') showToast(r.message);
                });
                finish();
                return;
            case 'acceptPirate':
                if (sender === null) return;
                // Main.Part10.cs 5132 PIRATE_PROTECTIONACCEPTRESPONSE / PIRATE_TRUCEACCEPTRESPONSE (playerOps.ts
                // acceptPirateOfferProtection → the ported Empire.3.cs 4213 AcceptPirateProtection).
                issuePlayerCommand(galaxy, player, 'acceptPirateOfferProtection', [sender], (result) => {
                    showToast(
                        !result.accepted
                            ? 'We already have an arrangement with them'
                            : result.cost > 0
                              ? `Protection accepted — ${pirateProtectionPriceText(result.cost)}`
                              : 'Truce accepted',
                    );
                });
                finish();
                return;
            case 'reply':
                if (sender === null) return;
                issuePlayerCommand(galaxy, player, 'answerConversation', [sender, e.part, e.related, e.cost], (r) => {
                    if (r.noFunds) showToast("Looks like you don't have enough money to pay for this");
                    else if (r.ok) showToast(replyToast(e.part));
                    if (r.history !== null) {
                        showEventMessagePopup({ title: r.history.title, text: r.history.text, imageUrl: null, footer: resolveStarDateDescription(galaxyStarDate(galaxy)) });
                    }
                    // Main.Part10.cs: ExpireDiplomacyMessagesForEmpire after the treaty / war replies.
                    if (r.expireFor !== null && expireDiplomacyMessagesForEmpire(queue, r.expireFor) > 0 && dialogEntry !== null && !queue.includes(dialogEntry)) closeDialog();
                });
                finish();
                return;
            case 'openDiplomacy':
                if (sender !== null) openDiplomacyForPirateOffer(player, sender);
                if (needsAnswer) closeDialog();
                else finish();
                return;
            case 'goto':
                goToMessage(entry.message, galaxy);
                if (needsAnswer) closeDialog();
                else finish();
                return;
            case 'close':
                finish();
                return;
        }
    }

    function openDialog(entry: ConversationEntry): void {
        // [audio] begin — Main.Part8.cs:469-473 method_296: `if (!pnlDiplomacyTalk.Visible) method_521(empire)`.
        if (dialogEntry === null) playDiplomacyMood(galaxy, entry.sender, player);
        // [audio] end
        if (dialogEntry !== null) closeDialog(true);
        dialogEntry = entry;
        // [popupstubs] begin
        markMessageStubRead(entry.message);
        // [popupstubs] end
        const starDate = galaxyStarDate(galaxy);
        const win = el('div', 'message-conversation-window');
        const titlebar = el('div', 'message-conversation-titlebar');
        const title = el('div', 'message-conversation-title');
        title.append(swatch(entry.sender), document.createTextNode(entry.sender?.name ?? 'Message'));
        const close = el('button', 'message-conversation-close', '✕') as HTMLButtonElement;
        close.type = 'button';
        close.title = 'Close';
        close.addEventListener('click', () => closeDialog());
        titlebar.append(title, close);

        const body = el('div', 'message-conversation-body');
        const headingText = conversationHeading(entry, player, starDate);
        const textEl = el('div', 'message-conversation-text', resolveGameText(entry.message.description));
        body.append(el('div', 'message-conversation-heading', headingText), textEl);
        // A pirate protection offer names its price per month and per year (the original shows the monthly fee only).
        if (isPirateProtectionOfferEntry(entry)) {
            const priceLine = pirateOfferPriceLine(entry, { player, galaxy });
            if (priceLine !== '') body.appendChild(el('div', 'message-conversation-price', priceLine));
        }
        // [diplovoice] begin
        voiceIncoming(entry, headingText, textEl);
        // [diplovoice] end

        const buttons = el('div', 'message-conversation-buttons');
        const button = (text: string, onClick: () => void): HTMLButtonElement => {
            const b = el('button', 'message-conversation-button', text) as HTMLButtonElement;
            b.type = 'button';
            b.addEventListener('click', onClick);
            buttons.appendChild(b);
            return b;
        };
        const actions = conversationActions(entry, {
            player,
            galaxy,
            answerable: isAnswerableProposal(entry, player, starDate),
            pirateOffer: isPirateProtectionOfferEntry(entry),
        });
        // A conversation that asks for an answer stays queued when only looked at (Go to / Open Diplomacy).
        const needsAnswer = actions.some((a) => ['acceptProposal', 'declineProposal', 'acceptPirate', 'reply', 'demandSubjugation'].includes(a.effect.kind));
        const finish = (): void => {
            removeEntry(entry);
            closeDialog();
        };
        for (const a of actions) {
            button(a.label, () => runConversationAction(a, entry, needsAnswer, finish));
        }
        win.append(titlebar, body, buttons);
        dialogRoot.replaceChildren(win);
        dialogRoot.hidden = false;
        document.addEventListener('keydown', onDialogKeyDown);
    }

    // [diplovoice] begin
    // 18b: the AI empire's message voiced by the local model (the original stays under "original" and in the tooltip).
    // One voiced line per message; a counter-proposal's message reuses the reply that announced it.
    function voiceIncoming(entry: ConversationEntry, heading: string, textEl: HTMLElement): void {
        const sender = entry.sender;
        if (sender === null || sender === player || sender === galaxy.independentEmpire || sender.pirateEmpireBaseHabitat !== null) return;
        const original = resolveGameText(entry.message.description);
        if (original.trim() === '') return;
        // [llm] 19s-2: a message the voices layer already upgraded keeps that text (its scripted part stays visible).
        if (layerVoiceOf(entry.message) !== undefined) return;
        const view = { showOriginal: false };
        const show = (text: string): void => {
            textEl.after(voicedLineToggle(textEl, text, original, view));
        };
        const cached = voicedMessageText(entry.message);
        if (cached !== undefined) {
            show(cached);
            return;
        }
        void diplomatVoiceConfig().then(async (cfg) => {
            if (cfg === null || dialogEntry !== entry) return;
            const pending = voicingIndicator();
            textEl.after(pending);
            const v = await voiceDiplomatReply({
                galaxy,
                ai: sender,
                player,
                context: { kind: 'incoming', messageType: EmpireMessageType[entry.message.messageType] ?? '', heading, original },
                cfg,
            });
            pending.remove();
            if (!v.voiced) return;
            rememberVoicedMessage(entry.message, v.text);
            if (dialogEntry === entry) show(v.text);
        });
    }
    // [diplovoice] end

    function tick(): void {
        const options = getMessageOptions();
        let toOpen: ConversationEntry | null = null;
        for (const m of empireMessages(player)) {
            if (m == null || seen.has(m)) continue;
            seen.add(m);
            // [suggest] begin
            // Main.Part9.cs 2226 ReceiveMessageInternal, case AdvisorSuggestion: the BuildOrder advice joins the advisor
            // queue (advisorSuggestions.ts shows it).
            if (receiveAdvisorSuggestionMessage(player, m)) continue;
            // [suggest] end
            const route = routeEmpireMessage(m, player, options);
            // Main.Part9.cs 1994-2020: the player's own EmpireDefeated message → Galaxy_GameEnd(defeat).
            const defeat = playerDefeatGameEnd(m, player, galaxy.empires);
            if (defeat !== null) onGameEnd(galaxy, defeat);
            // [popupstubs] begin
            // A popup message becomes a stub under the top-right panel; the card opens by itself only with the
            // "Open messages automatically" option (the 16d behaviour).
            if (route.popup) {
                if (m.starDate <= 0) m.starDate = galaxyStarDate(galaxy);
                const auto = getSettings().openMessagesAutomatically;
                pushMessageStub(m, auto);
                if (auto) showPopup(m);
            }
            // [popupstubs] end
            const action = shouldQueueConversation(route, options);
            // [audio] begin — Main.Part9.cs:2352-2360 ResolveMessage / ResolveImportantMessage on arrival.
            if (!heardBefore.has(m)) playMessageSounds(m.messageType, route, options.suppressAllPopups);
            // [audio] end
            if (action === 'none' || route.conversation === null) continue;
            // [popupstubs] begin
            m.starDate = galaxyStarDate(galaxy); // Main.Part9.cs 2361
            // [popupstubs] end
            const entry: ConversationEntry = { message: m, conversation: route.conversation, sender: m.sender };
            queue.push(entry);
            if (action === 'open') toOpen = entry;
        }
        pruneConversationQueue(queue, player, galaxyStarDate(galaxy));
        if (dialogEntry !== null && !queue.includes(dialogEntry)) closeDialog();
        if (toOpen !== null && queue.includes(toOpen)) {
            // [popupstubs] begin
            // Main.Part9.cs 1544 method_253: the immediate conversation pauses the game (method_154) until answered.
            if (opts.clock && !opts.clock.paused) {
                opts.clock.paused = true;
                pausedByUs = true;
            }
            // [popupstubs] end
            openDialog(toOpen);
        }
    }

    // [popupstubs] begin
    // A loaded game: the pending conversations come back from the saved message history.
    for (const entry of rebuildConversationQueue(empireMessageHistory(player) ?? [], player, galaxyStarDate(galaxy))) {
        seen.add(entry.message);
        queue.push(entry);
    }
    // [popupstubs] end

    const timer = setInterval(tick, 250);
    installed = {
        timer, popup, dialogRoot, queue, seen, closeDialog,
        // [popupstubs] begin
        showPopup, closePopup, openDialog,
        openKey: () => dialogEntry?.message ?? popupMessage,
        // [popupstubs] end
    };
    // [proposals] begin
    // The player's own conversation (17e) expires the other empire's pending messages, as the C# does.
    setDiplomacyMessageExpiry((empire) => {
        // [suggest] begin
        expireAdvisorSuggestionsForEmpire(player, empire); // DiplomaticMessageQueue.cs 357-380 (the advisor cases)
        // [suggest] end
        if (expireDiplomacyMessagesForEmpire(queue, empire) === 0) return;
        if (dialogEntry !== null && !queue.includes(dialogEntry)) closeDialog();
    });
    // [proposals] end
}

/** Stop polling and remove the popup, the queue and the dialog. No-op when not installed. */
export function removeMessagePopups(): void {
    if (installed === null) return;
    const s = installed;
    installed = null;
    clearInterval(s.timer);
    // [proposals] begin
    setDiplomacyMessageExpiry(null);
    // [proposals] end
    s.closeDialog();
    s.closePopup(); // [popupstubs]
    s.popup.remove();
    s.dialogRoot.remove();
    s.queue.length = 0;
}

// [proposals] begin
/**
 * DiplomaticMessageQueue.cs:344 ExpireDiplomacyMessagesForEmpire(empire): drops the queued diplomacy messages from
 * `empire` (DiplomaticRelationChange / ProposeDiplomaticRelation / RefuseDiplomaticRelation / OfferTrade). Returns how
 * many were dropped. The AdvisorSuggestion cases (:357-380) are advisorQueue.ts expireAdvisorSuggestionsForEmpire (suggest).
 */
export function expireDiplomacyMessagesForEmpire(queue: ConversationEntry[], empire: Empire | null): number {
    if (empire === null) return 0;
    let removed = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
        const m = queue[i].message;
        switch (m.messageType) {
            case EmpireMessageType.DiplomaticRelationChange:
            case EmpireMessageType.ProposeDiplomaticRelation:
            case EmpireMessageType.RefuseDiplomaticRelation:
            case EmpireMessageType.OfferTrade:
                if (m.sender === empire) {
                    queue.splice(i, 1);
                    removed++;
                }
                break;
        }
    }
    return removed;
}
// [proposals] end

// [suggest] begin
/** DiplomaticMessageQueue.cs 344 ExpireDiplomacyMessagesForEmpire for the installed conversation queue (an approved
 *  advisor suggestion's diplomacy change, Main.Part2.cs 1900-1934 / 2214 / 2235). No-op when not installed. */
export function expireConversationsForEmpire(empire: Empire): void {
    if (installed === null) return;
    expireDiplomacyMessagesForEmpire(installed.queue, empire);
}
// [suggest] end

// [leftovers] begin
/** An event message (Empire.EventMessageRecipient, Main.Part4.cs:487 method_523) shown on the popup card. */
export interface EventPopup {
    title: string;
    text: string;
    /** The event's picture (method_523 `bitmap`), or null. */
    imageUrl: string | null;
    /** Footer text (the star date). */
    footer: string;
    /** btnEventMessageGoto (Main.Part4.cs:216-229): shown when the event has a location. */
    onGoTo?: (() => void) | null;
    /** btnEventMessageInvestigate / btnEventMessageAvoid (Main.Part4.cs:73-76 method_510): choice buttons; each closes the card. */
    actions?: { label: string; onClick: () => void }[];
}

/**
 * Show an event message on the 16d popup card (replacing the card's current message, as a new popup does).
 * Returns false when the popups are not installed. The event panel's layout (image above title + text, Go To / Close)
 * is Main.Part4.cs:115-229 method_508; here it is the card with the picture on top.
 */
export function showEventMessagePopup(p: EventPopup): boolean {
    if (installed === null) return false;
    const popup = installed.popup;
    const titleEl = popup.querySelector('.message-popup-title');
    const body = popup.querySelector('.message-popup-body');
    const footer = popup.querySelector('.message-popup-footer');
    if (titleEl === null || body === null || footer === null) return false;
    titleEl.textContent = resolveGameText(p.title);
    body.replaceChildren();
    body.classList.remove('message-popup-body-goto');
    body.removeAttribute('title');
    if (p.imageUrl !== null) {
        const img = el('img', 'message-popup-image') as HTMLImageElement;
        img.src = p.imageUrl;
        img.alt = '';
        img.draggable = false;
        body.appendChild(img);
    }
    body.appendChild(el('div', 'message-popup-event-text', resolveGameText(p.text)));
    if (p.onGoTo) {
        const onGoTo = p.onGoTo;
        const go = el('button', 'message-popup-goto', 'Go To') as HTMLButtonElement;
        go.type = 'button';
        go.addEventListener('click', () => {
            popup.hidden = true;
            onGoTo();
        });
        body.appendChild(go);
    }
    for (const action of p.actions ?? []) {
        const btn = el('button', 'message-popup-goto', action.label) as HTMLButtonElement;
        btn.type = 'button';
        btn.addEventListener('click', () => {
            popup.hidden = true;
            action.onClick();
        });
        body.appendChild(btn);
    }
    footer.textContent = p.footer;
    popup.hidden = false;
    return true;
}
// [leftovers] end
