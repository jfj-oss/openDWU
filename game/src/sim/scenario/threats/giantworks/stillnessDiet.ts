// The Stillness Engine in the Galactic Diet (registerDietMotionKind like beaconDiet.ts; flag gwHarvestCycle, Age 2, the Diet on). Not a port.
//   Silence the Stillness Engine     an AI owner's running Engine is switched off when it passes (a human owner switches its own off by an order on the base).
//   Demolish the Stillness Engine    law (stillnessDemolish, until repealed): destroying it is legal, a member needs no war (stillness.ts demolishLegal); AND the Engine is
//                                    banned for good: no new one can be built in this galaxy (StillnessState.banned stays even if the law is repealed).
// AI votes: the lean toward the Engine (stillnessAi.ts engineLean: expansionists destroy, isolationists protect, shifted by the owner's standing); the owner votes no. The Diet adds
// the proposer's standing itself (proposerBias). Candidates: an AI member that leans to destroy moves them.
// Rnd: none.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import { isHumanEmpire } from '../../../humanEmpires';
import { dietOn, dietWarExcuse, registerDietMotionKind, lawInForce, peekDietState, type DietKindCandidate } from '../../charactersVictory/diet/dietState';
import { scenarioNews, scenarioText as T } from '../../messages';
import { resolveSectorDescription } from '../../../empireEvents';
import { AP, engineLean, sideOf } from './stillnessAi';
import { LAW_DEMOLISH_STILL, STILL_TAG, engineOf, engineOwner, stillState, stillnessActive, stillnessPlayer, switchEngine } from './stillness';

export const MOTION_SILENCE = 'stillnessSilence';
export const MOTION_DEMOLISH = 'stillnessDemolish';

function on(g: Galaxy): boolean {
    return stillnessActive(g) && dietOn(g);
}

function candidate(kind: string, proposer: Empire, weight: number): DietKindCandidate {
    return { kind, proposer, target: null, other: null, colony: null, resourceId: -1, weight };
}

/** The Silence motion may be moved: a running Engine owned by an AI empire. Pure. */
export function silenceable(g: Galaxy): boolean {
    const eng = engineOf(g);
    const owner = engineOwner(g, eng);
    return on(g) && eng !== null && eng.status === 'running' && owner !== null && !isHumanEmpire(g, owner);
}

/** The Demolish motion may be moved: an Engine stands (or builds) and the Diet has not ruled yet. Pure. */
export function demolishable(g: Galaxy): boolean {
    return on(g) && engineOf(g) !== null && stillState(g).banned === false && lawInForce(peekDietState(g), LAW_DEMOLISH_STILL) === null;
}

/** The score of `voter` on a motion against the Engine: its lean (0.6 per point, less `bar`); the owner votes no. Pure. */
function againstScore(g: Galaxy, voter: Empire, proposer: Empire, bar: number): number {
    if (voter === proposer) return 100;
    const owner = engineOwner(g);
    if (owner === null) return 0;
    if (voter === owner) return -100;
    return 0.6 * engineLean(g, voter, owner) - bar;
}

registerDietMotionKind({
    kind: MOTION_SILENCE,
    label: 'Silence the Stillness Engine',
    needs: 'none',
    proposable: (g) => silenceable(g),
    text: () => T(`${STILL_TAG} Diet Silence`),
    effect: () => T(`${STILL_TAG} Diet Silence Effect`),
    apply: (g) => {
        if (silenceable(g)) switchEngine(g, false, null);
    },
    voteScore: (g, _st, voter, m) => againstScore(g, voter, m.proposer, 6),
    candidates: (g, _st, a) => {
        if (!silenceable(g) || !stillnessPlayer(g, a)) return [];
        const owner = engineOwner(g);
        if (owner === null || owner === a || sideOf(g, a, owner) !== 'destroy') return [];
        return [candidate(MOTION_SILENCE, a, 14 + 0.3 * Math.max(0, engineLean(g, a, owner)))];
    },
});

registerDietMotionKind({
    kind: MOTION_DEMOLISH,
    label: 'Demolish the Stillness Engine',
    needs: 'none',
    proposable: (g) => demolishable(g),
    text: () => T(`${STILL_TAG} Diet Demolish`),
    effect: () => T(`${STILL_TAG} Diet Demolish Effect`),
    apply: (g, _st, _m, addLaw) => {
        const st = stillState(g);
        const eng = engineOf(g);
        st.banned = true;
        addLaw(LAW_DEMOLISH_STILL, null, null, null, -1);
        scenarioNews(g, null, T(`${STILL_TAG} Diet Demolish News`, eng === null ? '' : resolveSectorDescription(g, eng.x, eng.y)));
    },
    voteScore: (g, _st, voter, m) => againstScore(g, voter, m.proposer, 12),
    candidates: (g, _st, a) => {
        if (!demolishable(g) || !stillnessPlayer(g, a)) return [];
        const owner = engineOwner(g);
        if (owner === null || owner === a) return [];
        const lean = engineLean(g, a, owner);
        return lean >= AP.sideAt(g) + 10 ? [candidate(MOTION_DEMOLISH, a, 12 + 0.4 * lean)] : [];
    },
});

/** A war over the Engine is not an outrage for the Diet: no emergency case for the Regent. */
export function registerStillnessDiet(): void {
    dietWarExcuse.fn = (g, attacker, target) => {
        const eng = engineOf(g);
        return eng !== null && eng.ownerId === target.empireId && eng.warOver.includes(attacker.empireId);
    };
}

