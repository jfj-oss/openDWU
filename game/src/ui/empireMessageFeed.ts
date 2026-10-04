// Task 14a: the player's messages -> the top-middle HUD ticker (Main.Part9.cs ReceiveMessageInternal / method_250).
// The player's message pipeline (sim/playerMessages.ts) handles each message in the sim tick — the star-date stamp and
// the Empire.MessageHistory entry of a ticker line (Main.Part9.cs 2404-2410, 1508-1517) are game state — and the feed
// reads what it handled (the game view's PlayerMessageStream, both modes) and formats the line. It writes nothing.
import { EmpireMessageType, type EmpireMessage } from '../sim/messages';
import type { Empire } from '../sim/empire';
import { formatNet, resolveGameText, tryGetText } from '../sim/textResolver';
import { getMessageOptions, routeEmpireMessage, tickerShown } from './messageRouting';
import { playerMessageStream } from './messagePipeline';

// Task 16d: the DisplayMessage<Category> options filter the ticker (messageRouting.ts); popups and the conversation queue are messagePopups.ts.
// Port of Main.Part9.cs ReceiveMessageInternal (ticker text + bool_2) and method_250
export function formatEmpireMessage(message: EmpireMessage, player: Empire | null): string | null {
    // [16d] Game.DisplayMessage<Category> (Main.Part9.cs:1572 bool_2): sim/messageRouting.ts tickerShown.
    if (!tickerShown(message, routeEmpireMessage(message, player, getMessageOptions()))) return null;
    return tickerLineText(message, player);
}

/** The ticker line of a message the pipeline gave one (PlayerMessageReceipt.ticker); null when it reads empty. */
export function tickerLineText(message: EmpireMessage, player: Empire | null): string | null {
    const t = message.messageType;
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
        const stream = playerMessageStream(empire);
        if (stream === undefined) return out;
        // Every message the pipeline handled, once, with its line when the pipeline gave it one (and recorded it).
        for (const r of stream.receipts()) {
            if (seen.has(r.message)) continue;
            seen.add(r.message);
            if (!r.ticker) continue;
            const text = tickerLineText(r.message, empire);
            if (text !== null) out.push({ message: r.message, text });
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
