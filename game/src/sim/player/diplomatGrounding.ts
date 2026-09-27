// 19s-2 VOICES — diplomat grounding (tasks/19-mod-layer-scenarios.md §19s item 2; the 18b upgrade). Not a port.
// With the voices flag on, the 18b diplomat brief carries the ledger between the two empires and the claims /
// casus belli, taken from the grounding digest (sim/scenario/llm/digest.ts digestFor(ai, player)): the AI empire's
// reputation causes about the player and the grievances the player holds against it (19o, when present), the AI's
// claims on the player's colonies and the player's on its own, the casus belli it holds, and the war score of a war
// between them (19g-3). Pure (reads only; digestFor is side-effect free); flag off → the brief is returned unchanged,
// so the 18b prompt is byte-identical.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { DiplomatBrief } from './diplomatBrief';
import { digestFor, type DigestCause, type DigestClaim, type DigestWar } from '../scenario/llm/digest';
import { voicesOn } from '../scenario/llm/voiceCues';

export interface DiplomatGrounding {
    /** 19o ledger: our (the AI's) sum and causes about them, and what they (the player) hold against us. */
    ledger?: { sum: number; ourCauses: DigestCause[]; theyHoldAgainstUs: DigestCause[] };
    /** 19n claims / 19g-3 casus belli: our claims on their colonies, how many of ours they claim, whom we hold a casus belli against. */
    claims?: { oursOnTheirColonies: DigestClaim[]; theirClaimsOnOurs: number; casusBelliAgainst: string[] };
    /** 19g-3: the war between us, when at war (score −100..100 for us, the goals). */
    war?: DigestWar;
}

/** The grounding of `ai` speaking to `player`; null with voices off or nothing to say. */
export function diplomatGrounding(galaxy: Galaxy, ai: Empire, player: Empire): DiplomatGrounding | null {
    if (!voicesOn(galaxy)) return null;
    const d = digestFor(galaxy, ai, player, { events: 0 });
    const out: DiplomatGrounding = {};
    const rep = d.other?.reputation;
    if (rep !== undefined) out.ledger = { sum: rep.sum, ourCauses: rep.causes, theyHoldAgainstUs: rep.held };
    if (d.claims !== undefined) out.claims = { oursOnTheirColonies: d.claims.ours, theirClaimsOnOurs: d.claims.theirs, casusBelliAgainst: d.claims.casusBelli };
    const war = d.wars?.find((w) => w.vs === d.other?.name);
    if (war !== undefined) out.war = war;
    return Object.keys(out).length > 0 ? out : null;
}

/** `brief` with its grounding (a copy), or `brief` itself when there is none (flag off: unchanged). */
export function groundDiplomatBrief(galaxy: Galaxy, brief: DiplomatBrief, ai: Empire, player: Empire): DiplomatBrief {
    const g = diplomatGrounding(galaxy, ai, player);
    return g === null ? brief : { ...brief, grounding: g };
}
