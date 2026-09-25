// 18b — a counter-proposal the voiced AI empire attached to its reply (diplomatBrief.ts `counters`, chosen by id).
// It is sent exactly as the AI's own code sends a treaty proposal to the player (Empire.8.cs 1801 OfferFreeTrade /
// 1824 OfferMutualDefense / 1550 EndWarRequest): a DiplomaticRelation added to the player's ProposedDiplomaticRelations
// plus a ProposeDiplomaticRelation EmpireMessage with the GenerateMessageDescription line (Empire.7.cs 3859). From there
// it is the ordinary incoming path: the 16d conversation queue / dialog and the Diplomacy screen's "Treaty on Offer"
// show it, the player accepts (EmpireDetailView.cs:803) or declines, and it expires with Galaxy.TreatyOfferValidYears.
//
// The model does not decide whether the AI stands behind the counter — the sim does, with the incoming path's validity
// rule (EmpireDetailView.cs:639-706 flag3: the proposal type must be the AI's DetermineDesiredDiplomaticRelationTypical
// for its strategy toward the player). A counter that fails it is withdrawn and nothing is sent.
//
// No proposal-interval gate (CalculateNextAllowableProposalDate): a counter is part of the conversation, like the C#'s
// own in-conversation counter (Empire.8.cs ConsiderTreatyProposals adds a Protectorate counter to a Mutual Defense offer
// without the interval check).
//
// Determinism: runs only from UI input between ticks, like submitProposal; draws no galaxy.rnd.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { DiplomaticRelation, DiplomaticRelationType } from '../diplomacy';
import { determineDesiredDiplomaticRelationTypical, determineRelativeStrength, generateMessageDescriptionRelation, militaryPotency } from '../diplomacyTick';
import { EmpireMessageType, empireMessages, sendMessageToEmpire, type EmpireMessage } from '../messages';
import { galaxyStarDate } from '../tick/simTime';
import { listDiplomatCounters, type DiplomatBrief } from './diplomatBrief';

export type DiplomatCounterStatus =
    /** Sent: in the player's proposed relations, with its message. */
    | 'proposed'
    /** The id is not one of the brief's counters (the model invented it). */
    | 'unknown'
    /** No longer legal in the current relation (it changed since the brief). */
    | 'stale'
    /** The AI already has an offer open with the player (ProposedDiplomaticRelations holds one per empire). */
    | 'pending'
    /** The sim's evaluator does not stand behind it (not the AI's desired relation). */
    | 'withdrawn';

export interface DiplomatCounterOutcome {
    id: string;
    status: DiplomatCounterStatus;
    /** DiplomaticRelationType name proposed ('' when unknown). */
    proposes: string;
    /** The message sent on the incoming path (status 'proposed'). */
    message: EmpireMessage | null;
}

/**
 * Put the counter `counterId` from `brief` through the incoming path as `ai`'s proposal to `player`. Re-checks
 * legality against the live state, then the evaluator (the AI's desired relation), then sends it.
 */
export function proposeDiplomatCounter(galaxy: Galaxy, ai: Empire, player: Empire, brief: DiplomatBrief, counterId: string): DiplomatCounterOutcome {
    const listed = brief.counters.find((c) => c.id === counterId);
    if (listed === undefined) return { id: counterId, status: 'unknown', proposes: '', message: null };
    const def = listDiplomatCounters(ai, player).find((c) => c.id === counterId);
    if (def === undefined) return { id: counterId, status: 'stale', proposes: listed.proposes, message: null };
    if (player.proposedDiplomaticRelations.byEmpire(ai) !== null) return { id: counterId, status: 'pending', proposes: def.proposes, message: null };

    // EmpireDetailView.cs:639-706 flag3 (ui isProposalValid): DetermineDesiredDiplomaticRelationTypical(their strategy,
    // their relation type) must equal the offered type.
    const relation = ai.diplomaticRelations.byEmpire(player);
    if (relation === null) return { id: counterId, status: 'stale', proposes: def.proposes, message: null };
    if (determineDesiredDiplomaticRelationTypical(relation.strategy, relation.type) !== def.type) {
        return { id: counterId, status: 'withdrawn', proposes: def.proposes, message: null };
    }

    // Empire.8.cs 1801-1822 OfferFreeTrade body (same shape in OfferMutualDefense / EndWarRequest), past its gates.
    const now = galaxyStarDate(galaxy);
    const proposal = new DiplomaticRelation(def.type, ai, ai, player, now, relation.supplyRestrictedResources);
    player.proposedDiplomaticRelations.add(proposal);
    const ourPotencyVersusThem = determineRelativeStrength(galaxy, militaryPotency(ai), player);
    const description = generateMessageDescriptionRelation(relation, def.type, ourPotencyVersusThem);
    relation.lastDiplomacyTradeOfferDate = now;
    sendMessageToEmpire(ai, player, EmpireMessageType.ProposeDiplomaticRelation, def.type, description);
    const msgs = empireMessages(player);
    const message = msgs.length > 0 && msgs[msgs.length - 1].sender === ai ? msgs[msgs.length - 1] : null;
    return { id: counterId, status: 'proposed', proposes: DiplomaticRelationType[def.type] ?? '', message };
}
