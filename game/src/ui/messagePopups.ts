// Task 16d: popup card (Main.Part9.cs:2381 pnlMessagePopup), conversation queue (DiplomaticMessageQueue.cs)
// and conversation dialog (method_254) for the player's EmpireMessages, routed by messageRouting.ts.
// Like the ticker feed (empireMessageFeed.ts) it polls Empire.Messages and dedupes by identity.
// TODO(port): the original DialogPart conversation texts and reply options (Main.Part10.cs); here the dialog shows the message text with Accept/Decline for treaty offers and OK otherwise
// TODO(port): popup "go to subject" click (Main.Part9.cs:784 method_244)

import './messagePopups.css';
import { getMessageOptions, routeEmpireMessage, shouldQueueConversation, type DialogPartType } from './messageRouting';
import { EmpireMessageType, empireMessages, type EmpireMessage } from '../sim/messages';
import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import { galaxyStarDate } from '../sim/tick/simTime';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { isProposalValid, proposalLabel, relationTypeLabel, acceptProposal, declineProposal } from './screens/diplomacyScreen';
import { showToast } from './toast';
import { rgbCss } from './hud';

export interface ConversationEntry {
    message: EmpireMessage;
    conversation: DialogPartType;
    sender: Empire | null;
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
export function pruneConversationQueue(queue: ConversationEntry[], player: Empire, starDate: number): number {
    let removed = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
        const e = queue[i];
        if (e.message.messageType === EmpireMessageType.ProposeDiplomaticRelation && !isAnswerableProposal(e, player, starDate)) {
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
    return entry.message.title;
}

/** The popup card's header text. */
export function popupTitle(message: EmpireMessage): string {
    return message.title || message.sender?.name || 'Message';
}

export interface MessagePopupsOptions {
    player: Empire;
    galaxy: Galaxy;
}

interface Installed {
    timer: ReturnType<typeof setInterval>;
    popup: HTMLElement;
    queueRoot: HTMLElement;
    dialogRoot: HTMLElement;
    queue: ConversationEntry[];
    seen: WeakSet<EmpireMessage>;
    closeDialog: () => void;
}

let installed: Installed | null = null;

const MAX_CHIPS = 8;

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
    popupClose.addEventListener('click', () => {
        popup.hidden = true;
    });

    // Conversation queue column (DiplomaticMessageQueue).
    const queueRoot = el('div', 'message-queue');

    // Conversation dialog (method_254).
    const dialogRoot = el('div', 'message-conversation-wrap');
    dialogRoot.hidden = true;

    const queue: ConversationEntry[] = [];
    const seen = new WeakSet<EmpireMessage>();
    let dialogEntry: ConversationEntry | null = null;
    let renderedKey: unknown[] = [];

    document.body.append(popup, queueRoot, dialogRoot);

    function showPopup(m: EmpireMessage): void {
        popupTitleEl.textContent = popupTitle(m);
        popupBody.textContent = m.description;
        popupFooter.textContent = resolveStarDateDescription(galaxyStarDate(galaxy));
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

    function closeDialog(): void {
        if (dialogEntry === null) return;
        dialogEntry = null;
        document.removeEventListener('keydown', onDialogKeyDown);
        dialogRoot.replaceChildren();
        dialogRoot.hidden = true;
        renderChips();
    }

    function openDialog(entry: ConversationEntry): void {
        if (dialogEntry !== null) closeDialog();
        dialogEntry = entry;
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
        body.append(
            el('div', 'message-conversation-heading', conversationHeading(entry, player, starDate)),
            el('div', 'message-conversation-text', entry.message.description),
        );

        const buttons = el('div', 'message-conversation-buttons');
        const button = (text: string, onClick: () => void): HTMLButtonElement => {
            const b = el('button', 'message-conversation-button', text) as HTMLButtonElement;
            b.type = 'button';
            b.addEventListener('click', onClick);
            buttons.appendChild(b);
            return b;
        };
        if (isAnswerableProposal(entry, player, starDate) && entry.sender !== null) {
            const sender = entry.sender;
            button('Accept Offer', () => {
                if (acceptProposal(player, sender)) showToast('Treaty accepted');
                removeEntry(entry);
                closeDialog();
            });
            button('Decline', () => {
                declineProposal(player, sender);
                removeEntry(entry);
                closeDialog();
            });
        } else {
            button('OK', () => {
                removeEntry(entry);
                closeDialog();
            });
        }
        win.append(titlebar, body, buttons);
        dialogRoot.replaceChildren(win);
        dialogRoot.hidden = false;
        document.addEventListener('keydown', onDialogKeyDown);
        renderChips();
    }

    // Rebuilds the chips only when the queue (or the open entry) changed.
    function renderChips(): void {
        const key: unknown[] = [dialogEntry, ...queue];
        if (key.length === renderedKey.length && key.every((k, i) => k === renderedKey[i])) return;
        renderedKey = key;
        queueRoot.replaceChildren();
        for (const entry of queue.slice(0, MAX_CHIPS)) {
            const chip = el('button', 'message-chip') as HTMLButtonElement;
            chip.type = 'button';
            if (entry === dialogEntry) chip.classList.add('message-chip-active');
            chip.title = entry.message.description;
            chip.append(swatch(entry.sender), el('span', 'message-chip-name', entry.sender?.name ?? 'Message'));
            chip.addEventListener('click', () => openDialog(entry));
            queueRoot.appendChild(chip);
        }
        if (queue.length > MAX_CHIPS) queueRoot.appendChild(el('div', 'message-queue-more', `+${queue.length - MAX_CHIPS} more`));
    }

    function tick(): void {
        const options = getMessageOptions();
        let toOpen: ConversationEntry | null = null;
        for (const m of empireMessages(player)) {
            if (m == null || seen.has(m)) continue;
            seen.add(m);
            const route = routeEmpireMessage(m, player, options);
            if (route.popup) showPopup(m);
            const action = shouldQueueConversation(route, options);
            if (action === 'none' || route.conversation === null) continue;
            const entry: ConversationEntry = { message: m, conversation: route.conversation, sender: m.sender };
            queue.push(entry);
            if (action === 'open') toOpen = entry;
        }
        pruneConversationQueue(queue, player, galaxyStarDate(galaxy));
        if (dialogEntry !== null && !queue.includes(dialogEntry)) closeDialog();
        if (toOpen !== null && queue.includes(toOpen)) openDialog(toOpen);
        renderChips();
    }

    const timer = setInterval(tick, 250);
    installed = { timer, popup, queueRoot, dialogRoot, queue, seen, closeDialog };
}

/** Stop polling and remove the popup, the queue and the dialog. No-op when not installed. */
export function removeMessagePopups(): void {
    if (installed === null) return;
    const s = installed;
    installed = null;
    clearInterval(s.timer);
    s.closeDialog();
    s.popup.remove();
    s.queueRoot.remove();
    s.dialogRoot.remove();
    s.queue.length = 0;
}
