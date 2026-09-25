// Task 14a: the player's EmpireMessage queue -> the top-middle HUD ticker
// (Main.Part9.cs ReceiveMessageInternal / method_250).
// The C# Main registers itself as the player's IMessageRecipient. Here we poll the queue
// instead, because Empire.messageRecipient is saved by the save codec and a function on it
// cannot be serialized. The feed never mutates the messages; like the C# receiver (Main.Part9.cs 1508-1517) it adds
// each one except Informational to the player's saved Empire.MessageHistory.
import { EmpireMessageType, addHistoryMessage, empireMessages, type EmpireMessage } from '../sim/messages';
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
}

export function createEmpireMessageFeed(): EmpireMessageFeed {
    const seen = new WeakSet<EmpireMessage>();
    return {
        poll(empire: Empire | null): string[] {
            if (empire === null) return [];
            const out: string[] = [];
            for (const m of empireMessages(empire)) {
                if (m == null || seen.has(m)) continue;
                seen.add(m);
                if (m.messageType !== EmpireMessageType.Informational) addHistoryMessage(empire, m);
                const text = formatEmpireMessage(m, empire);
                if (text !== null) out.push(text);
            }
            return out;
        },
    };
}
