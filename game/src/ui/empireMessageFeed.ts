// Task 14a: the player's EmpireMessage queue -> the top-middle HUD ticker
// (Main.Part9.cs ReceiveMessageInternal / method_250).
// The C# Main registers itself as the player's IMessageRecipient. Here we poll the queue
// instead, because Empire.messageRecipient is saved by the save codec and a function on it
// cannot be serialized. The feed only reads messages; it never mutates them.
import { EmpireMessageType, empireMessages, type EmpireMessage } from '../sim/messages';
import type { Empire } from '../sim/empire';
import { formatNet, resolveGameText, tryGetText } from '../sim/textResolver';
import { getMessageOptions, routeEmpireMessage } from './messageRouting';

// Task 16d: the DisplayMessage<Category> options filter the ticker (messageRouting.ts); popups and the conversation queue are messagePopups.ts.
// Port of Main.Part9.cs ReceiveMessageInternal (ticker text + bool_2) and method_250
export function formatEmpireMessage(message: EmpireMessage, player: Empire | null): string | null {
    const t = message.messageType;
    if (t === EmpireMessageType.AdvisorSuggestion) return null;
    // [16d] Game.DisplayMessage<Category> (Main.Part9.cs:1572 bool_2): a category switched off in Game
    // Options hides the line. Uncategorised messages and conversations keep the 14a behaviour.
    const route = routeEmpireMessage(message, player, getMessageOptions());
    if (route.category !== null && route.conversation === null && !route.ticker) return null;
    // [/16d]
    if (
        (t === EmpireMessageType.DiplomaticRelationChange ||
            t === EmpireMessageType.ProposeDiplomaticRelation ||
            t === EmpireMessageType.AcceptDiplomaticRelation ||
            t === EmpireMessageType.RefuseDiplomaticRelation) &&
        typeof message.subject !== 'number'
    ) {
        return null;
    }
    // The C# sender built Description with string.Format(TextResolver.GetText(tag), args); the sim keeps the
    // gameText() "tag|arg0|…" encoding (M9 localises), resolved here against GameText.txt (textResolver.ts).
    const description = resolveGameText(message.description);
    let text: string;
    if (t === EmpireMessageType.Undefined || t === EmpireMessageType.Revolution) {
        text = description;
    } else {
        // method_250 (Main.Part9.cs 1041): string.Format(GetText("X says"), Sender.Name) + ": " for other empires
        // (the C# would crash on a null sender).
        text = description;
        if (message.sender !== null && message.sender !== player && t !== EmpireMessageType.GalacticNewsNet) {
            text = formatNet(tryGetText('X says') ?? '{0} says', [message.sender.name]) + ': ' + description;
        }
    }
    // ScrollingLinkList.AddItem: text.Replace("\n", " ").
    text = text.replace(/\r?\n/g, ' ').trim();
    return text === '' ? null : text;
}

export interface EmpireMessageFeed {
    poll(empire: Empire | null): string[];
    /** Like poll, with the message each ticker line came from. */
    pollMessages(empire: Empire | null): Array<{ message: EmpireMessage; text: string }>;
}

export function createEmpireMessageFeed(): EmpireMessageFeed {
    const seen = new WeakSet<EmpireMessage>();
    const pollMessages = (empire: Empire | null): Array<{ message: EmpireMessage; text: string }> => {
        if (empire === null) return [];
        const out: Array<{ message: EmpireMessage; text: string }> = [];
        for (const m of empireMessages(empire)) {
            if (m == null || seen.has(m)) continue;
            seen.add(m);
            const text = formatEmpireMessage(m, empire);
            if (text !== null) out.push({ message: m, text });
        }
        return out;
    };
    return {
        poll: (empire) => pollMessages(empire).map((e) => e.text),
        pollMessages,
    };
}

/** The player's persisted message history (C# Empire.MessageHistory,
 * Empire.cs 1727) when the sim model carries it; duck-typed so the UI works
 * whether or not the running save has the field. */
function messageHistoryOf(empire: Empire): EmpireMessage[] | null {
    const h = (empire as unknown as { messageHistory?: unknown }).messageHistory;
    if (Array.isArray(h)) return h as EmpireMessage[];
    // EmpireMessageList-style wrapper with an items array / iterator.
    if (h !== null && typeof h === 'object' && Symbol.iterator in (h as object)) {
        return [...(h as Iterable<EmpireMessage>)];
    }
    return null;
}

/** Port of Main.Part9.cs ReceiveMessageInternal 2404-2410 + 1512-1518: a
 * message shown in the ticker is stamped with the current star date and,
 * unless it is Informational, added to the player's message history
 * (Empire.AddHistoryMessage, which skips duplicates). */
export function recordTickerMessage(player: Empire, message: EmpireMessage, currentStarDate: number): void {
    message.starDate = currentStarDate;
    if (message.messageType === EmpireMessageType.Informational) return;
    const add = (player as unknown as { addHistoryMessage?: (m: EmpireMessage) => void }).addHistoryMessage;
    if (typeof add === 'function') {
        add.call(player, message);
        return;
    }
    const history = (player as unknown as { messageHistory?: unknown }).messageHistory;
    if (Array.isArray(history) && !history.includes(message)) history.push(message);
}

/** Ticker/history lines rebuilt from a loaded game's persisted message
 * history, oldest first (Main.Part4.cs 2987 method_542 sorts MessageHistory
 * by StarDate, EmpireMessage.cs 261). Empty when the model has no history. */
export function savedHistoryLines(player: Empire): Array<{ text: string; starDate: number }> {
    const history = messageHistoryOf(player);
    if (history === null) return [];
    const out: Array<{ text: string; starDate: number }> = [];
    const sorted = history
        .filter((m): m is EmpireMessage => m != null)
        .map((m, i) => ({ m, i }))
        .sort((a, b) => a.m.starDate - b.m.starDate || a.i - b.i);
    for (const { m } of sorted) {
        const text = formatEmpireMessage(m, player);
        if (text !== null) out.push({ text, starDate: m.starDate });
    }
    return out;
}
