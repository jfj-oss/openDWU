// The Harvest Cycle, Age 2: the Diet's side of the corrupted empire (corrupted.ts). Not a port. Two things, both under flag gwHarvestCycle with
// the Diet on and the corruption live:
//   - VOTES: the corrupted empire votes against every preparation motion (isPreparationMotion: the Severance's; corrupted.ts) and against the
//     exposure motion. It is the one vote the Watchers care about: its score is capped at -60 (a 'no' whatever the proposer's standing).
//   - EXPOSE THE CORRUPTED MEMBER (a new motion): a HUMAN who holds a CONFIRMED Internal Security lead on the corrupted leader may move it (no
//     AI ever does: nobody exposes an innocent empire on a guess). Its target is the corrupted empire, named by the lead. Passed, it ends the
//     corruption (exposed) and every other AI member treats the empire as an enemy: each declares war on it (stock declareWar, the treaties
//     and rules it may have still apply). Failed, nothing happens.
// Rnd: none. AI voters weigh it like any motion; the proposer's vote is the proposal's (100).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { declareWar, aggressionLevel, friendlinessLevel } from '../../../diplomacyTick';
import { isHumanEmpire } from '../../../humanEmpires';
import { dietMembership } from '../../charactersVictory/diet/dietAi';
import { dietCouncil } from '../../charactersVictory/diet/diet';
import { dietOn, registerDietMotionKind, type DietMotion } from '../../charactersVictory/diet/dietState';
import { registerScenarioQuery } from '../../hooks';
import { scenarioNews, scenarioText as T } from '../../messages';
import { HARVEST_CYCLE_FLAG } from './longNightState';
import { activeCorrupted, confirmedLeadOf, corruptionOn, endCorruption, isAiEmpire, isPreparationMotion } from './corrupted';

export const MOTION_EXPOSE = 'corruptExpose';

/** The most a corrupted empire's score may be for a preparation or exposure motion (a sure 'no'). */
const AGAINST = -60;

function on(galaxy: Galaxy): boolean {
    return corruptionOn(galaxy) && dietOn(galaxy);
}

/** The motion's target while it is corrupted and a member's confirmed lead names it: the corrupted empire, else null. Pure. */
function exposable(galaxy: Galaxy): Empire | null {
    return activeCorrupted(galaxy);
}

/**
 * The corrupted empire's vote. Pure: the score it replaces on a preparation or exposure motion, unchanged otherwise. Ballots by other voters and
 * the proposer's own 100 are untouched.
 */
export function corruptedVoteScore(galaxy: Galaxy, score: number, voter: Empire, kind: string, proposer: Empire): number {
    if (!on(galaxy) || voter !== activeCorrupted(galaxy) || voter === proposer) return score;
    return isPreparationMotion(kind) || kind === MOTION_EXPOSE ? Math.min(score, AGAINST) : score;
}

/** Moved by a human holding a confirmed lead on the corrupted leader (and only then). Pure. */
export function canExpose(galaxy: Galaxy, e: Empire): boolean {
    return on(galaxy) && isHumanEmpire(galaxy, e) && exposable(galaxy) !== null && confirmedLeadOf(galaxy, e) !== null;
}

registerScenarioQuery({ id: 'corrupted.vote', flag: HARVEST_CYCLE_FLAG, query: 'dietVoteScore', run: (g, v, a) => corruptedVoteScore(g, v, a.voter, a.kind, a.proposer) });

registerDietMotionKind({
    kind: MOTION_EXPOSE,
    label: 'Expose the corrupted member',
    needs: 'none',
    proposable: (g) => on(g) && exposable(g) !== null && g.empires.some((e) => e !== null && canExpose(g, e)),
    proposableBy: (g, e) => canExpose(g, e),
    prepare: (g, e) => {
        const target = exposable(g);
        if (target === null || !canExpose(g, e)) return null;
        return { target, other: null, colony: null, resourceId: -1 };
    },
    text: (g, _st, m) => T('Corrupt Motion Text', m.target?.name ?? ''),
    effect: () => T('Corrupt Motion Effect'),
    apply: (g, _st, m: DietMotion) => {
        const target = m.target;
        if (target === null || activeCorrupted(g) !== target) return;
        const council = dietCouncil(g);
        const members = council === null ? [] : dietMembership(g, council);
        endCorruption(g, 'exposed', m.proposer);
        for (const x of members) {
            if (x === target || !isAiEmpire(g, x) || obtainDiplomaticRelation(x, target).type === DiplomaticRelationType.War) continue;
            declareWar(g, x, target);
        }
        scenarioNews(g, null, T('Corrupt Motion News', target.name));
    },
    voteScore: (g, _st, voter, m) => {
        if (voter === activeCorrupted(g)) return AGAINST;
        return 30 + 10 * ((aggressionLevel(voter) - 100) / 50) + 6 * ((friendlinessLevel(voter) - 100) / 50);
    },
});
