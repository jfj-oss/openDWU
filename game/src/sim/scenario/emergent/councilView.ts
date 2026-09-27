// 19d8 — pure row builder for the diplomacy screen's "Council" block (members, chair, current motion, last 5 results,
// the player's bloc). No DOM, no Rnd, no state changes (never creates the package state).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { resolveStarDateDescription } from '../../galaxyTime';
import { pendingScenarioDecisions } from '../decisions';
import { COUNCIL_VOTE_DECISION, blocOf, councilOn, peekCouncilState, prestige, voteDeadline, type Council, type Motion } from './council';

export interface CouncilMemberRow {
    empire: Empire;
    name: string;
    chair: boolean;
    bloc: string;
    prestige: number;
    losses: number;
}

export interface CouncilViewModel {
    name: string;
    founded: number;
    chair: string;
    members: CouncilMemberRow[];
    /** The motion on the floor ('' = none). */
    motion: string;
    /** "3 for, 1 against, 0 abstaining so far — vote by DATE" ('' = none). */
    motionStatus: string;
    /** The player's pending vote decision id (0 = none). */
    voteDecisionId: number;
    results: { text: string; passed: boolean }[];
    /** The player's bloc ('' = none), with its members. */
    yourBloc: string;
    /** Other councils (a split council): names. */
    rivals: string[];
    /** True when the player is not a member (the block shows the council it knows of). */
    observer: boolean;
    /** The council and the motion on the floor by reference (19s-2 speeches key on them; null = none). */
    councilRef: Council | null;
    motionRef: Motion | null;
}

/** The player's council (or the first council when the player holds no seat); null when off / none founded. */
export function councilView(galaxy: Galaxy, player: Empire): CouncilViewModel | null {
    if (!councilOn(galaxy)) return null;
    const st = peekCouncilState(galaxy);
    if (st === null || st.councils.length === 0) return null;
    const c: Council = st.councils.find((x) => x.members.includes(player)) ?? st.councils[0];
    const m = c.motion !== null && c.motion.status === 'voting' ? c.motion : null;
    let motionStatus = '';
    let voteDecisionId = 0;
    if (m !== null) {
        const yes = m.votes.filter((v) => v.vote === 'yes').length;
        const no = m.votes.filter((v) => v.vote === 'no').length;
        const ab = m.votes.filter((v) => v.vote === 'abstain').length;
        motionStatus = `${yes} for, ${no} against, ${ab} abstaining so far — vote closes ${resolveStarDateDescription(voteDeadline(galaxy, m))}`;
        const d = pendingScenarioDecisions(galaxy, player).find((x) => x.kind === COUNCIL_VOTE_DECISION && x.context.motionId === m.id);
        if (d !== undefined) voteDecisionId = d.id;
    }
    const yb = blocOf(c, player);
    return {
        name: c.name,
        founded: c.foundedYear,
        chair: c.chair?.name ?? '',
        members: c.members.map((e) => ({
            empire: e,
            name: e.name,
            chair: e === c.chair,
            bloc: blocOf(c, e)?.name ?? '',
            prestige: Math.round(prestige(c, e)),
            losses: c.losses[e.empireId] ?? 0,
        })),
        motion: m !== null ? `${m.text} (moved by the ${m.proposer.name})` : '',
        motionStatus,
        voteDecisionId,
        results: c.results.slice(-5).reverse().map((r) => ({ text: `${r.year}: ${r.text} — ${r.passed ? 'passed' : 'failed'} ${r.yes}-${r.no}-${r.abstain}`, passed: r.passed })),
        yourBloc: yb !== null ? `${yb.name} (${yb.members.map((e) => e.name).join(', ')}; ${yb.hardness} years)` : '',
        rivals: st.councils.filter((x) => x !== c).map((x) => x.name),
        observer: !c.members.includes(player),
        councilRef: c,
        motionRef: m,
    };
}
