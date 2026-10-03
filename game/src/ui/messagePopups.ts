// Task 16d: popup card (Main.Part9.cs:2381 pnlMessagePopup), conversation queue (DiplomaticMessageQueue.cs)
// and conversation dialog (method_254) for the player's EmpireMessages, routed by messageRouting.ts.
// Like the ticker feed (empireMessageFeed.ts) it polls Empire.Messages, dedupes by identity and resolves the
// sim's gameText() encodings (textResolver.ts).
// The conversation buttons are conversationActions.ts (the option lists of Main.Part9.cs:46 method_238); their sim effects
// go through issuePlayerCommand. The popup card's text and a Go to button jump to the message's subject (messageGoto.ts).
// The windows follow the original: the card is pnlMessagePopup (MessagePopup.cs: 335 × 280, the message picture over the
// text), a conversation opens pnlDiplomacyTalk (Main.Part8.cs:449 method_296: 430 × 778, flag + name, race picture,
// the message in the response panel, the method_238 options as links), an event pnlEventMessage (Main.Part4.cs:115
// method_513: 420 × 660, picture, title, text, Investigate / Leave alone or Close / Go to Event Location).
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
import { resolveGameText, tryGetText } from '../sim/textResolver';
import { isProposalValid, proposalLabel, relationTypeLabel, setDiplomacyMessageExpiry, toggleDiplomacyScreen } from './screens/diplomacyScreen';
import { issuePlayerCommand } from '../sim/player/playerCommands';
// [proposals] begin
// [proposals] end
import { showToast } from './toast';
// [diplovoice] begin
import { layerVoiceOf } from '../llm/voiceJob'; // [llm] 19s-2
import { diplomatVoiceConfig, rememberVoicedMessage, voiceDiplomatReply, voicedLineToggle, voicedMessageText, voicingIndicator } from './diplomatVoice';
// [diplovoice] end
import { COLORS, FONT, el, glassButton, gradientPanel, openOriginalWindow, place, rgbCss, text, type OriginalWindow } from './originalWindow';
import { flagImage, raceImage } from './screens/diplomacyScreen';
import { diplomacyBackgroundColor } from './screens/diplomacyRelationsView';
import { empireFlagUrl } from './selectionInfoView';
import { habitatImageUrl, shipImageUrl } from './selectionInfo';
import { landscapeImageUrl } from './screens/intelligence';
import { characterPortraitUrl } from './characterPortrait';
import { messageCardFlagEmpire, messageCardText, messageImageUrl, messagePicture, type MessagePicture } from './messagePicture';
import { CARD, CARD_STRIP_H, EVENT, TALK, cardHeight, cardPosition, eventButtonRects, eventPanelLayout } from './messageWindowLayout';
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
    queue: ConversationEntry[];
    seen: WeakSet<EmpireMessage>;
    closeDialog: () => void;
    // [popupstubs] begin
    showPopup: (m: EmpireMessage) => void;
    closePopup: () => void;
    openDialog: (entry: ConversationEntry) => void;
    openKey: () => EmpireMessage | null;
    // [popupstubs] end
    showEvent: (p: EventPopup) => void;
    closeEvent: () => void;
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

// ---------------------------------------------------------------------------------------------------------------
// The windows (DOM). Built on originalWindow.ts: the card is a headerless window holding MessagePopup's GradientPanel,
// the conversation is pnlDiplomacyTalk (as the Diplomacy screen's talk panel), events are pnlEventMessage.
// ---------------------------------------------------------------------------------------------------------------

/** TextResolver.GetText for a plain key (the key itself when GameText is not loaded). */
function gt(key: string): string {
    return tryGetText(key) ?? key;
}

/** A picture box: an <img> (hidden when the file is missing). */
function pictureImg(url: string | null, className = 'msg-pic-img'): HTMLImageElement {
    const img = el('img', className);
    img.alt = '';
    img.draggable = false;
    if (url !== null) img.src = url;
    else img.style.visibility = 'hidden';
    img.addEventListener('error', () => (img.style.visibility = 'hidden'));
    return img;
}

/** The DOM for a MessagePopup _MainImage (messagePicture.ts), capped at 240 × 180 like LimitImageSize. */
function messagePictureElement(p: MessagePicture, galaxy: Galaxy): HTMLElement {
    const box = el('div', 'msg-pic');
    switch (p.kind) {
        case 'url': {
            box.appendChild(pictureImg(p.url));
            // ImprintFlag: the sender's flag at (65, 30) 100 × 60 on the (231 × 180) treaty picture.
            if (p.flag !== null) box.appendChild(place(flagImage(p.flag, 100, 60, 'msg-pic-flag'), 65, 30, 100, 60));
            if (p.striped) box.classList.add('msg-pic-striped');
            break;
        }
        case 'research': {
            // The 170 × 134 overlay: researchbreakthrough.png (0, 0) 79 × 134, the benefit × 2.5 right-aligned.
            box.classList.add('msg-pic-research');
            box.appendChild(place(pictureImg(messageImageUrl(8)), 0, 0, 79, 134));
            const pic = pictureImg(p.url, `msg-pic-benefit${p.tile ? ' msg-pic-tile' : ''}`);
            pic.addEventListener('load', () => {
                const k = p.tile ? 2.5 : Math.min(2.5, 120 / Math.max(1, pic.naturalWidth, pic.naturalHeight));
                const w = Math.trunc(pic.naturalWidth * k);
                const h = Math.trunc(pic.naturalHeight * k);
                place(pic, 170 - w, Math.trunc((134 - h) / 2), w, h);
            });
            box.appendChild(pic);
            break;
        }
        case 'ship':
            box.appendChild(pictureImg(shipImageUrl(p.builtObject)));
            break;
        case 'habitat':
            box.appendChild(pictureImg(habitatImageUrl(p.habitat), 'msg-pic-img msg-pic-planet'));
            break;
        case 'landscape':
            box.appendChild(pictureImg(landscapeImageUrl(p.ref)));
            if (p.striped) box.classList.add('msg-pic-striped');
            break;
        case 'character':
            box.appendChild(pictureImg(characterPortraitUrl(p.character), 'msg-pic-img msg-pic-character'));
            break;
        case 'flag': {
            const f = pictureImg(null, 'msg-pic-img msg-pic-largeflag');
            f.style.visibility = '';
            void empireFlagUrl(galaxy, p.empire).then((u) => (f.src = u));
            box.appendChild(f);
            break;
        }
        case 'empire': {
            // 170 × 60: the flag (0, 0) 100 × 60, the dominant race (110, 0) 60 × 60.
            box.classList.add('msg-pic-empire');
            box.append(place(flagImage(p.empire, 100, 60, 'msg-pic-flag'), 0, 0, 100, 60), place(raceImage(p.empire, 60, 'msg-pic-race'), 110, 0, 60, 60));
            if (p.striped) box.classList.add('msg-pic-striped');
            break;
        }
    }
    return box;
}

/** Start routing the player's messages into the popup card and the conversation queue. Idempotent. */
export function installMessagePopups(opts: MessagePopupsOptions): void {
    removeMessagePopups();
    const { player, galaxy } = opts;

    const queue: ConversationEntry[] = [];
    const seen = new WeakSet<EmpireMessage>();
    // [audio] begin — messages already in Empire.Messages (a loaded save) were received before: no arrival sound.
    const heardBefore = new WeakSet<EmpireMessage>(empireMessages(player).filter((m) => m != null));
    // [audio] end
    let dialogEntry: ConversationEntry | null = null;
    let dialogWin: OriginalWindow | null = null;
    // [popupstubs] begin
    let popupMessage: EmpireMessage | null = null;
    let cardWin: OriginalWindow | null = null;
    let eventWin: OriginalWindow | null = null;
    // [popupstubs] end

    // The pause rule of the original's message windows (the talk panel Main.Part8.cs:449 method_296 and the event panel
    // method_508-511 pause a running game; the popup card pnlMessagePopup never does) is the central
    // AutoPauseWhenInPopupWindow hook in openOriginalWindow (autoPause.ts): every window pauses, the card opts out.

    // ---- the popup card (pnlMessagePopup, MessagePopup.cs) ----

    function positionCard(win: OriginalWindow): void {
        const r = document.querySelector('.message-stubs')?.getBoundingClientRect();
        const stubs = r !== undefined && r.width > 0 ? { left: r.left, top: r.top } : null;
        const p = cardPosition(window.innerWidth, window.innerHeight, win.scale, stubs);
        win.frame.style.left = `${p.left}px`;
        win.frame.style.top = `${p.top}px`;
    }

    // [popupstubs] begin
    function closePopup(): void {
        const w = cardWin;
        if (w === null) return;
        cardWin = null;
        popupMessage = null;
        w.close();
    }
    // [popupstubs] end

    function showPopup(m: EmpireMessage): void {
        closePopup();
        // [popupstubs] begin
        popupMessage = m;
        // [popupstubs] end
        const W = CARD.width;
        const H = cardHeight();
        const win = openOriginalWindow({
            id: 'msgcard',
            noAutoPause: true,
            title: popupTitle(m),
            headerless: true,
            width: W,
            height: H,
            onClose: () => {
                if (cardWin === win) {
                    cardWin = null;
                    popupMessage = null;
                }
            },
            onResize: positionCard,
        });
        cardWin = win;
        win.frame.classList.add('msg-card');
        positionCard(win);
        // MessagePopup: a GradientPanel (39, 40, 44) / (22, 21, 26) / (51, 54, 61), 3 px (67, 67, 77) border, padding 12.
        const panel = place(gradientPanel({ borderWidth: 3, className: 'msg-card-panel' }), -3, -3, W, H);
        win.body.appendChild(panel);

        // OnPaint: the picture centred, the text (16.67 px, (170, 170, 170), drop shadow) 12 px under it, the block
        // centred vertically; the sender's flag at 50 % behind the text.
        const content = place(el('div', 'msg-card-content'), 0, 0, W - 6, CARD.height - 3);
        const picture = messagePicture(m, player);
        if (picture !== null) content.appendChild(messagePictureElement(picture, galaxy));
        const textBox = el('div', 'msg-card-textbox');
        const flagEmpire = messageCardFlagEmpire(m, player);
        if (flagEmpire !== null) textBox.appendChild(flagImage(flagEmpire, CARD.flagW, CARD.flagH, 'msg-card-flag'));
        const title = resolveGameText(m.title);
        if (title !== '') textBox.appendChild(el('div', 'msg-card-title ow-shadow', title));
        textBox.appendChild(el('div', 'msg-card-text ow-shadow', messageCardText(m, player, resolveGameText(m.description))));
        content.appendChild(textBox);
        panel.appendChild(content);

        const close = el('button', 'ow-close msg-card-close');
        close.type = 'button';
        close.title = 'Close';
        close.innerHTML = CLOSE_SVG;
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            closePopup();
        });
        panel.appendChild(place(close, W - 6 - 36, 4, 30, 30));

        // The strip: the star date, a scenario decision's options and Go to.
        const strip = place(el('div', 'msg-card-strip'), 0, CARD.height - 3, W - 6, CARD_STRIP_H - 3);
        panel.appendChild(strip);
        const buttons: HTMLButtonElement[] = [];
        // [popupstubs] begin
        // Mod layer: a pending scenario decision shows its options; a click answers it (scenario/decisions.ts).
        const decision = m.subject;
        if (isScenarioDecision(decision) && decision.answer === null) {
            for (const o of decision.options) {
                buttons.push(
                    glassButton(o.label, {
                        onClick: () => {
                            // A player command (journaled, applied at the next frame boundary) so seed + command log replays it.
                            issuePlayerCommand(galaxy, decision.empire, 'answerScenarioDecision', [decision.id, o.id]);
                            closePopup();
                        },
                    }),
                );
            }
        }
        // A notification about a place: a Go to button, and a click on the card jumps there too (pnlMessagePopup_Click,
        // Main.Part6.cs:2633; Main.Part9.cs:912 method_249).
        const hasTarget = messageGoToTarget(m) !== null;
        if (hasTarget) {
            buttons.push(
                glassButton(gt('Go to'), {
                    className: 'msg-card-goto',
                    onClick: () => {
                        goToMessage(m, galaxy);
                        closePopup();
                    },
                }),
            );
            content.classList.add('msg-card-goto-target');
            content.title = 'Go to';
            content.addEventListener('click', () => {
                goToMessage(m, galaxy);
                closePopup();
            });
        }
        const bw = buttons.length <= 1 ? 110 : Math.min(140, Math.floor((W - 6 - 24 - (buttons.length - 1) * 6) / buttons.length));
        let bx = W - 6 - 12 - bw;
        for (let i = buttons.length - 1; i >= 0; i--) {
            strip.appendChild(place(buttons[i], bx, 3, bw, 30));
            bx -= bw + 6;
        }
        const date = resolveStarDateDescription(m.starDate > 0 ? m.starDate : galaxyStarDate(galaxy));
        if (buttons.length <= 1) strip.appendChild(place(text(date, { size: FONT.tiny, color: 'rgb(120, 120, 120)', className: 'msg-card-date' }), 12, 10));
        else strip.title = date;
        markMessageStubRead(m);
        // [popupstubs] end
    }

    // ---- the conversation panel (pnlDiplomacyTalk, Main.Part8.cs:449 method_296) ----

    function removeEntry(entry: ConversationEntry): void {
        const i = queue.indexOf(entry);
        if (i >= 0) queue.splice(i, 1);
    }

    function closeDialog(switching = false): void {
        if (dialogEntry === null) return;
        dialogEntry = null;
        if (!switching) closeEventSting(); // [audio] Main.Part8.cs:435 talk closed → method_522
        const w = dialogWin;
        dialogWin = null;
        w?.close();
        // [popupstubs] begin
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
        const sender = entry.sender;
        const win = openOriginalWindow({
            id: 'msgtalk',
            title: sender?.name ?? 'Message',
            headerless: true,
            width: TALK.width,
            height: TALK.height,
            onClose: () => {
                if (dialogWin === win) closeDialog();
            },
        });
        dialogWin = win;
        win.frame.classList.add('msg-talk');
        // pnlDiplomacyTalkPanel: 410 × 758 at (10, 10), BackColor2 = BaconMain.SetColorForDiplomacyBackground(empire).
        const mid = sender !== null ? rgbCss(diplomacyBackgroundColor(sender.mainColor)) : 'rgb(22, 21, 26)';
        const panel = gradientPanel({ colors: ['rgb(39, 40, 44)', mid, 'rgb(51, 54, 61)'], corners: { tl: true, tr: true, br: true, bl: true }, radius: 20, className: 'dip-talk-panel' });
        place(panel, TALK.panel.x - 3, TALK.panel.y - 3, TALK.panel.w, TALK.panel.h);
        win.body.appendChild(panel);
        const close = el('button', 'ow-close dip-talk-close');
        close.type = 'button';
        close.title = 'Close';
        close.innerHTML = CLOSE_SVG;
        close.addEventListener('click', () => closeDialog());
        panel.appendChild(close);

        // The flag (50 × 30) and the empire's name (22.67 px bold), centred at y 8; the race picture 280 × 280 at y 45.
        const head = place(el('div', 'dip-talk-head'), 0, TALK.flag.y, TALK.panel.w, 34);
        if (sender !== null) head.appendChild(flagImage(sender, TALK.flag.w, TALK.flag.h, 'dip-talk-flag'));
        head.appendChild(text(sender?.name ?? popupTitle(entry.message), { size: FONT.title, bold: true, color: '#fff', className: 'dip-talk-name' }));
        panel.appendChild(head);
        if (sender !== null) panel.appendChild(place(raceImage(sender, TALK.race.w, 'dip-talk-race'), TALK.race.x, TALK.race.y, TALK.race.w, TALK.race.h));
        else {
            const pic = messagePicture(entry.message, player);
            if (pic !== null) panel.appendChild(place(messagePictureElement(pic, galaxy), TALK.race.x, TALK.race.y, TALK.race.w, TALK.race.h));
        }

        // pnlDiplomaticConversationResponse (method_230): the message, black at alpha 80 behind it.
        const resp = place(el('div', 'dip-talk-response ow-scroll msg-talk-response'), TALK.response.x, TALK.response.y, TALK.response.w, TALK.response.h);
        panel.appendChild(resp);
        const headingText = conversationHeading(entry, player, starDate);
        const textEl = el('div', 'msg-talk-text', resolveGameText(entry.message.description));
        if (headingText !== '' && headingText !== textEl.textContent) resp.appendChild(el('div', 'msg-talk-heading', headingText));
        resp.appendChild(textEl);
        // A pirate protection offer names its price per month and per year (the original shows the monthly fee only).
        if (isPirateProtectionOfferEntry(entry)) {
            const priceLine = pirateOfferPriceLine(entry, { player, galaxy });
            if (priceLine !== '') resp.appendChild(el('div', 'msg-talk-price', priceLine));
        }
        // [diplovoice] begin
        voiceIncoming(entry, headingText, textEl);
        // [diplovoice] end

        // ctlDiplomacyConversation (HyperlinkOptionsBox, method_238): the options as yellow links, in order.
        const optsBox = place(el('div', 'dip-talk-options ow-scroll'), TALK.options.x, TALK.options.y, TALK.options.w, TALK.options.h);
        const inner = el('div', 'dip-talk-options-inner');
        optsBox.appendChild(inner);
        panel.appendChild(optsBox);
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
            const link = el('a', `dip-talk-link msg-talk-option msg-talk-${a.effect.kind}`, a.label);
            link.href = '#';
            link.dataset.option = a.id;
            link.addEventListener('click', (ev) => {
                ev.preventDefault();
                runConversationAction(a, entry, needsAnswer, finish);
            });
            inner.appendChild(link);
        }
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

    // ---- the event panel (pnlEventMessage, Main.Part4.cs:115 method_513) ----

    function closeEvent(): void {
        const w = eventWin;
        eventWin = null;
        w?.close();
    }

    function showEvent(p: EventPopup): void {
        closeEvent();
        const win = openOriginalWindow({
            id: 'msgevent',
            title: resolveGameText(p.title),
            headerless: true,
            width: EVENT.width,
            height: EVENT.height,
            onClose: () => {
                if (eventWin === win) eventWin = null;
                closeEventSting(); // btnEventMessageClose_Click: method_522
            },
        });
        eventWin = win;
        win.frame.classList.add('msg-event');
        const extra = 0;
        const panel = gradientPanel({ corners: { tl: true, tr: true, br: true, bl: true }, radius: 20, className: 'msg-event-panel' });
        win.body.appendChild(panel);
        const panelRect = eventPanelLayout(false, 0).panel;
        place(panel, panelRect.x - 3, panelRect.y - 3, panelRect.w, panelRect.h); // sized first: the title wraps in it
        // The title first (its measured height places the text container).
        const titleEl = text(resolveGameText(p.title), { size: FONT.header, bold: true, color: '#fff', shadow: false, className: 'msg-event-title' });
        titleEl.style.maxWidth = `${EVENT.width - 40}px`;
        panel.appendChild(titleEl);
        const titleH = Math.max(1, Math.ceil(titleEl.offsetHeight || FONT.header * 1.25));
        const lay = eventPanelLayout(p.imageUrl !== null, titleH, false, extra);
        const titleW = Math.min(lay.titleMaxW, Math.ceil(titleEl.offsetWidth || lay.titleMaxW));
        place(titleEl, Math.trunc((lay.panel.w - titleW) / 2), lay.titleY);
        if (lay.picture !== null && p.imageUrl !== null) {
            // picEventMessage: SizeMode Zoom.
            panel.appendChild(place(pictureImg(p.imageUrl, 'msg-event-picture'), lay.picture.x, lay.picture.y, lay.picture.w, lay.picture.h));
        }
        // pnlEventMessageContainer (AutoScroll) holding lblEventMessageText (16.67 px, (170, 170, 170)).
        const container = place(el('div', 'msg-event-container ow-scroll'), lay.container.x, lay.container.y, lay.container.w, lay.container.h - 16);
        const body = text(resolveGameText(p.text), { size: FONT.large, color: COLORS.gridText, shadow: false, wrapWidth: lay.textW, className: 'msg-event-text' });
        container.appendChild(body);
        panel.appendChild(container);
        // The star date under the text (not in the original).
        const date = text(p.footer, { size: FONT.tiny, color: 'rgb(120, 120, 120)', shadow: false, className: 'msg-event-date' });
        panel.appendChild(place(date, lay.container.x, lay.container.y + lay.container.h - 14, lay.container.w, 14));

        // The buttons: Investigate / Leave alone (method_509-511), else Close + Go to Event Location (method_508).
        const buttons: HTMLButtonElement[] = [];
        if (p.actions !== undefined && p.actions.length > 0) {
            for (const a of p.actions) {
                buttons.push(
                    glassButton(a.label, {
                        onClick: () => {
                            closeEvent();
                            a.onClick();
                        },
                    }),
                );
            }
        } else {
            buttons.push(glassButton(gt('Close'), { className: 'msg-event-close', onClick: () => closeEvent() }));
            if (p.onGoTo) {
                const onGoTo = p.onGoTo;
                buttons.push(
                    glassButton(gt('Go to Event Location'), {
                        className: 'msg-event-goto',
                        onClick: () => {
                            closeEvent();
                            onGoTo();
                        },
                    }),
                );
            }
        }
        const rects = eventButtonRects(buttons.length, lay.buttonY, extra);
        buttons.forEach((b, i) => panel.appendChild(place(b, rects[i].x, rects[i].y, rects[i].w, rects[i].h)));
    }

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
        // Main.Part9.cs 1544 method_253: the immediate conversation opens (and pauses the game, method_154).
        if (toOpen !== null && queue.includes(toOpen)) openDialog(toOpen);
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
        timer, queue, seen, closeDialog,
        // [popupstubs] begin
        showPopup, closePopup, openDialog,
        openKey: () => dialogEntry?.message ?? popupMessage,
        // [popupstubs] end
        showEvent, closeEvent,
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

const CLOSE_SVG =
    '<svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true"><rect x="2" y="2" width="26" height="26" rx="8" ry="8"/>' +
    '<path class="ow-close-x" d="M8 8 L22 22 M8 22 L22 8"/></svg>';

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
    s.closeEvent();
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
/** An event message (Empire.EventMessageRecipient, Main.Part4.cs:487 method_523) shown on the event panel. */
export interface EventPopup {
    title: string;
    text: string;
    /** The event's picture (method_523 `bitmap`), or null. */
    imageUrl: string | null;
    /** The star date (shown under the text). */
    footer: string;
    /** btnEventMessageGoto (Main.Part4.cs:262-276): shown when the event has a location. */
    onGoTo?: (() => void) | null;
    /** btnEventMessageInvestigate / btnEventMessageAvoid (Main.Part4.cs:48-108 method_509-511): choice buttons; each closes the panel. */
    actions?: { label: string; onClick: () => void }[];
}

/**
 * Show an event message on the event panel (pnlEventMessage, Main.Part4.cs:115 method_513: 420 × 660, the picture
 * 360 × 270 on top, the title, the scrolling text, then Investigate / Leave alone or Close / Go to Event Location),
 * replacing the one shown. Returns false when the popups are not installed.
 */
export function showEventMessagePopup(p: EventPopup): boolean {
    if (installed === null) return false;
    installed.showEvent(p);
    return true;
}
// [leftovers] end
