// Task 14a: the player's EmpireMessage queue -> the top-middle HUD ticker
// (Main.Part9.cs ReceiveMessageInternal / method_250).
// The C# Main registers itself as the player's IMessageRecipient. Here we poll the queue
// instead, because Empire.messageRecipient is saved by the save codec and a function on it
// cannot be serialized. The feed only reads messages; it never mutates them.
import { EmpireMessageType, empireMessages, type EmpireMessage } from '../sim/messages';
import type { Empire } from '../sim/empire';

// TODO(port): _Game.DisplayMessage<Category> options (all on by default), popups (bool_), and the diplomatic conversation queue — Main.Part9.cs ReceiveMessageInternal
// Port of Main.Part9.cs ReceiveMessageInternal (ticker text + bool_2) and method_250
export function formatEmpireMessage(message: EmpireMessage, player: Empire | null): string | null {
    const t = message.messageType;
    if (t === EmpireMessageType.AdvisorSuggestion) return null;
    if (
        (t === EmpireMessageType.DiplomaticRelationChange ||
            t === EmpireMessageType.ProposeDiplomaticRelation ||
            t === EmpireMessageType.AcceptDiplomaticRelation ||
            t === EmpireMessageType.RefuseDiplomaticRelation) &&
        typeof message.subject !== 'number'
    ) {
        return null;
    }
    let text: string;
    if (t === EmpireMessageType.Undefined || t === EmpireMessageType.Revolution) {
        text = message.description;
    } else {
        // method_250: "{0} says: " prefix for other empires (the C# would crash on a null sender).
        text = message.description;
        if (message.sender !== null && message.sender !== player && t !== EmpireMessageType.GalacticNewsNet) {
            text = `${message.sender.name} says: ${message.description}`;
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
                const text = formatEmpireMessage(m, empire);
                if (text !== null) out.push(text);
            }
            return out;
        },
    };
}
