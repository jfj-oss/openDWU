// 19o reputation channel (tasks/19-mod-layer-scenarios.md §19o). Not a port: the slot through which the ported attitude
// model reads the scenario reputation ledger. diplomacy.ts (EmpireEvaluation) and pirateRelations.ts (PirateRelation)
// import only this module (type imports aside), so the core stays free of scenario imports; ledger.ts fills the slots at
// module load. Every slot returns null when the ledger is off or holds nothing for the pair: the caller then uses its
// stock field unchanged (flag off ⇒ byte-identical).

import type { EmpireEvaluation } from '../../diplomacy';
import type { PirateRelation } from '../../pirateRelations';

export interface ReputationChannel {
    /** Ledger sum (incident term) the owner of `ev` holds against ev.empire; null = nothing / off. */
    incident: ((ev: EmpireEvaluation) => number | null) | null;
    /** Ledger sum (bias term) the owner of `ev` holds against ev.empire; null = nothing / off. */
    bias: ((ev: EmpireEvaluation) => number | null) | null;
    /** Ledger sum (both terms) r.thisEmpire holds against r.otherEmpire (a pirate pair); null = nothing / off. */
    pirate: ((r: PirateRelation) => number | null) | null;
}

export const reputationChannel: ReputationChannel = { incident: null, bias: null, pirate: null };
