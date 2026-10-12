// Not a port: which add-on (scenario) messages pop up. Every add-on message is a General*Event (the Exploration
// category, popups on by default), so without this each one became a stub card. With the Message Settings option
// "Add-on messages: only big moments pop up" (on by default) an add-on message pops up only for a big moment; the
// rest still reach the ticker and the message history (the sim's routing and records are unchanged: UI only).

import { EmpireMessageType, type EmpireMessage } from '../sim/messages';
import { addonTextTag } from '../sim/textResolver';
import { getSettings } from './settings';

/** Title tags of the moments worth a popup: victories and defeats, a hidden threat's reveal, coups, secession, the
 *  Diet's sessions, results, regency, empire and expulsion, the treasure fleet's arrival, a Voidbloom world gained or lost
 *  to its workers. */
const BIG_MOMENT = /Victory|Defeat|Turn Title|Trigger Title|Rise Title|Start Title|Shutdown Title|Detonation Title|Coup|Secession|Breakaway|Expelled|Emperor|Regent Title|Session Title|Emergency Title|Results Title|Enforcers Title|Ruler Revealed|Ultimatum|Sector Formed|Treasure Title|Voidbloom Revolt Title|Voidbloom World Title/;

const GATED = new Set<EmpireMessageType>([EmpireMessageType.GeneralBadEvent, EmpireMessageType.GeneralNeutralEvent, EmpireMessageType.GeneralGoodEvent]);

/** False when `m` is an add-on message that should stay in the ticker / history only (no stub, no card). */
export function addonPopupAllowed(m: EmpireMessage): boolean {
    if (!GATED.has(m.messageType)) return true; // decisions (GeneralDecision) and every stock type: as routed
    const tag = addonTextTag(m.title);
    if (tag === null) return true; // a stock message
    if (!getSettings().addonPopupsBigOnly) return true;
    return BIG_MOMENT.test(tag);
}
