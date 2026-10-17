// Giantworks: the Interstellar Diet's four motions (registerDietMotionKind). Not a port. With Characters & Victory's Diet off
// (dietOn) none of this exists.
//   Inspect the Great Work     - the Diet's inspectors report to every member: each gets the first cargo hints and every shortlist
//                                loses its weakest wrong candidate. It narrows, it never proves.
//   Protect the Great Work     - law: attacking the work, its convoys or its guards breaks it (the Diet's violation path).
//   Authorise demolition       - law: destroying a Great Work is no longer a war crime. The only exemption there is (besides a
//                                wonder that turned hostile); the Compact is angry all the same.
//   Internationalise the work  - law: a finished, peaceful wonder's benefits are split among the members (benefits.ts).
// Rnd: none. AI voters weigh their own shortlist's expected menace and value, never the secret answer.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import { aggressionLevel, cautionLevel, friendlinessLevel } from '../../../diplomacyTick';
import { dietCouncil } from '../../charactersVictory/diet/diet';
import { dietMembership } from '../../charactersVictory/diet/dietAi';
import { dietOn, lawInForce, peekDietState, registerDietMotionKind, type DietKindCandidate, type DietState } from '../../charactersVictory/diet/dietState';
import { scenarioNews, scenarioText } from '../../messages';
import { scenarioFlag } from '../../state';
import { LAW_DEMOLISH, LAW_INTERNATIONALISE, LAW_PROTECT } from './actions';
import { greatWorkTerritoryOwner } from './benefits';
import { expectedMenace, expectedValue, grantTrueHint, workLevel } from './knowledge';
import { buildingWorks, GW_FLAG, gwParam, gwState, greatWorks, TAG, type GreatWorkRecord } from './state';
import { KNOWLEDGE_SUSPECTED } from '../framework';

export const MOTION_INSPECT = 'gwInspect';

function on(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, GW_FLAG) && dietOn(galaxy);
}

function p(e: Empire): { caution: number; friendly: number; aggression: number } {
    return { caution: (cautionLevel(e) - 100) / 50, friendly: (friendlinessLevel(e) - 100) / 50, aggression: (aggressionLevel(e) - 100) / 50 };
}

/** The work an empire's opinion is about: the one it knows best (the first it suspects, else the first building). Pure. */
function focusWork(galaxy: Galaxy, e: Empire): GreatWorkRecord | null {
    const b = buildingWorks(galaxy);
    return b.find((w) => workLevel(w, e) >= KNOWLEDGE_SUSPECTED) ?? null;
}

function members(galaxy: Galaxy): Empire[] {
    const c = dietCouncil(galaxy);
    return c === null ? [] : dietMembership(galaxy, c);
}

function finishedPeaceful(galaxy: Galaxy): GreatWorkRecord[] {
    return greatWorks(galaxy).filter((w) => w.phase === 'complete' && !w.hostile);
}

function candidate(kind: string, proposer: Empire, weight: number): DietKindCandidate {
    return { kind, proposer, target: null, other: null, colony: null, resourceId: -1, weight };
}

// --- Inspect ------------------------------------------------------------------------------------------------------

registerDietMotionKind({
    kind: MOTION_INSPECT,
    label: 'Inspect the Great Work',
    needs: 'none',
    proposable: (g) => on(g) && buildingWorks(g).some((w) => w.narrowed < 3),
    text: () => scenarioText(`${TAG} Diet Inspect`),
    effect: () => 'The Diet sends inspectors to the Great Work. Every member learns the first cargo hints and loses one wrong candidate from its shortlist. It narrows the list; it cannot prove what is being built.',
    apply: (g) => {
        const need = Math.max(1, gwParam(g, 'giantworksHintsToSuspect'));
        for (const w of buildingWorks(g)) {
            w.narrowed += Math.max(0, gwParam(g, 'giantworksInspectNarrows'));
            for (const m of members(g)) for (let i = 0; i < need; i++) if (grantTrueHint(g, w, m) === null) break;
        }
        gwState(g).stats.inspections++;
        scenarioNews(g, null, scenarioText(`${TAG} Diet Inspect News`));
    },
    voteScore: (g, _st, voter, m) => {
        if (voter === m.proposer) return 100;
        const w = focusWork(g, voter);
        const pr = p(voter);
        let s = 8 + 14 * pr.caution + 12 * pr.friendly;
        if (w !== null) {
            s += 25 * expectedMenace(g, w, voter);
            if (greatWorkTerritoryOwner(g, w) === voter) s -= 18 * expectedValue(g, w, voter);
        }
        return s;
    },
    candidates: (g, _st, a) => {
        if (!on(g) || !buildingWorks(g).some((w) => w.narrowed < 2)) return [];
        const w = focusWork(g, a);
        if (w === null) return [];
        const menace = expectedMenace(g, w, a);
        return menace >= 0.3 ? [candidate(MOTION_INSPECT, a, 14 + 40 * menace + 6 * p(a).caution)] : [];
    },
});

// --- Protect ------------------------------------------------------------------------------------------------------

registerDietMotionKind({
    kind: LAW_PROTECT,
    label: 'Protect the Great Work',
    needs: 'none',
    proposable: (g) => on(g) && buildingWorks(g).length > 0 && lawInForce(peekDietState(g), LAW_PROTECT) === null && lawInForce(peekDietState(g), LAW_DEMOLISH) === null,
    text: () => scenarioText(`${TAG} Diet Protect`),
    effect: () => 'Attacking the Great Work, its convoys or its guards breaks Diet law: every member resents the offender, who is called to account.',
    apply: (g, _st, _m, addLaw) => {
        addLaw(LAW_PROTECT, null, null, null, -1);
        scenarioNews(g, null, scenarioText(`${TAG} Diet Protect News`));
    },
    voteScore: (g, _st, voter, m) => {
        if (voter === m.proposer) return 100;
        const w = focusWork(g, voter);
        const pr = p(voter);
        let s = 4 + 12 * pr.friendly - 12 * pr.aggression;
        if (w !== null) {
            s += 40 * expectedValue(g, w, voter) - 45 * expectedMenace(g, w, voter);
            if (greatWorkTerritoryOwner(g, w) === voter) s += 15;
        }
        return s;
    },
    candidates: (g, st, a) => {
        if (!on(g) || lawInForce(st, LAW_PROTECT) !== null || lawInForce(st, LAW_DEMOLISH) !== null) return [];
        const w = focusWork(g, a);
        if (w === null) return [];
        const value = expectedValue(g, w, a);
        const menace = expectedMenace(g, w, a);
        return value >= gwParam(g, 'giantworksAiProtectValuePct') / 100 && menace < 0.35 ? [candidate(LAW_PROTECT, a, 12 + 28 * value)] : [];
    },
});

// --- Authorise demolition -----------------------------------------------------------------------------------------

registerDietMotionKind({
    kind: LAW_DEMOLISH,
    label: 'Authorise demolition of the Great Work',
    needs: 'none',
    proposable: (g) => on(g) && buildingWorks(g).length > 0 && lawInForce(peekDietState(g), LAW_DEMOLISH) === null,
    text: () => scenarioText(`${TAG} Diet Demolish`),
    effect: () => 'Destroying a Great Work is no longer a war crime. Nothing proves what is being built: the Diet only withdraws its protection. The Compact will be angry.',
    apply: (g, st, _m, addLaw) => {
        (st as DietState).laws = (st as DietState).laws.filter((l) => l.kind !== LAW_PROTECT);
        addLaw(LAW_DEMOLISH, null, null, null, -1);
        scenarioNews(g, null, scenarioText(`${TAG} Diet Demolish News`));
    },
    voteScore: (g, _st, voter, m) => {
        if (voter === m.proposer) return 100;
        const w = focusWork(g, voter);
        const pr = p(voter);
        let s = -22 + 6 * pr.aggression - 8 * pr.friendly;
        if (w !== null) {
            s += 75 * expectedMenace(g, w, voter) - 32 * expectedValue(g, w, voter);
            if (greatWorkTerritoryOwner(g, w) === voter) s -= 14;
        }
        return s;
    },
    candidates: (g, st, a) => {
        if (!on(g) || lawInForce(st, LAW_DEMOLISH) !== null) return [];
        const w = focusWork(g, a);
        if (w === null) return [];
        const menace = expectedMenace(g, w, a);
        return menace >= (gwParam(g, 'giantworksAiDestroyMenacePct') / 100) * 0.85 ? [candidate(LAW_DEMOLISH, a, 14 + 45 * menace + 8 * p(a).aggression)] : [];
    },
});

// --- Internationalise ---------------------------------------------------------------------------------------------

registerDietMotionKind({
    kind: LAW_INTERNATIONALISE,
    label: 'Internationalise the Great Work',
    needs: 'none',
    proposable: (g) => on(g) && finishedPeaceful(g).length > 0 && lawInForce(peekDietState(g), LAW_INTERNATIONALISE) === null,
    text: () => scenarioText(`${TAG} Diet Intl`),
    effect: () => "The finished Great Work's benefits are shared among the members of the Diet. The empire whose territory holds it keeps a smaller part.",
    apply: (g, _st, _m, addLaw) => {
        addLaw(LAW_INTERNATIONALISE, null, null, null, -1);
        scenarioNews(g, null, scenarioText(`${TAG} Diet Intl News`));
    },
    voteScore: (g, _st, voter, m) => {
        if (voter === m.proposer) return 100;
        const owner = finishedPeaceful(g).some((w) => greatWorkTerritoryOwner(g, w) === voter);
        return owner ? -70 : 22 + 8 * p(voter).friendly;
    },
    candidates: (g, st, a) => {
        if (!on(g) || lawInForce(st, LAW_INTERNATIONALISE) !== null) return [];
        const ws = finishedPeaceful(g);
        if (ws.length === 0 || ws.some((w) => greatWorkTerritoryOwner(g, w) === a)) return [];
        return [candidate(LAW_INTERNATIONALISE, a, 14 + 6 * p(a).friendly)];
    },
});
