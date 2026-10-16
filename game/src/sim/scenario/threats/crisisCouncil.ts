// The Galactic Council reacts to a loose crisis faction (crisis interactions, piece 9). Not a port. Only the council's
// existing motion kinds are used, through its extension point (emergent/council.ts registerCouncilExtension), so it
// works for the galactic-council add-on and for Characters & Victory's Interstellar Diet alike, and only in a game
// where a council exists (the extension is only asked by a running council):
//   - 'threat' (declare the faction a threat to the galaxy, weight 85): the joint defence. Once it passes, AI members
//     that have met a non-pirate faction and are not yet at war with it declare war on it (a joint war; the stock war
//     machinery, peace stays possible). A pirate-kind faction (the Purifier) gets the stock joint-defence bonus only.
//   - 'sanction' (non-pirate faction, weight 70): trade sanctions on the faction.
//   - 'condemn' (weight 55): an empire seen helping the faction (the exposed waker, a treaty partner of the faction).
// Votes lean a little toward acting against the crisis (+15) and against its helper (+10 when the voter is at war with
// the faction). Rnd: none.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { DiplomaticRelationType } from '../../diplomacy';
import { declareWar } from '../../diplomacyTick';
import { isHumanEmpire } from '../../humanEmpires';
import { registerScenarioYearly } from '../hooks';
import { scenarioNews } from '../messages';
import { COUNCIL_FLAG, hasMet, peekCouncilState, registerCouncilExtension, type Council, type MotionCandidate, type Motion } from '../emergent/council';
import { activeCrises, crisisHelpers, crisisState, isCrisisFaction } from './crisis';

const byId = (a: Empire, b: Empire): number => a.empireId - b.empireId;

function crisisCandidates(galaxy: Galaxy, c: Council, year: number): MotionCandidate[] {
    const out: MotionCandidate[] = [];
    for (const { entry, faction } of activeCrises(galaxy)) {
        const pirate = faction.pirateEmpireBaseHabitat !== null;
        if (crisisState(galaxy).harmed[entry.key] !== true) continue; // a faction that has hurt no one yet is not tabled
        const helpers = crisisHelpers(galaxy, entry, faction);
        for (const a of [...c.members].sort(byId)) {
            if (a === faction || isCrisisFaction(galaxy, a) || (!pirate && !hasMet(a, faction))) continue; // (a pirate faction has no diplomatic relations to have met through)
            const atWar = a.diplomaticRelations.byEmpire(faction)?.type === DiplomaticRelationType.War;
            if (!c.threats.includes(faction)) out.push({ kind: 'threat', proposer: a, target: faction, other: null, resourceId: -1, weight: 85 + (atWar ? 5 : 0) });
            if (!pirate && !c.sanctions.some((s) => s.target === faction && s.kind === 'sanction')) out.push({ kind: 'sanction', proposer: a, target: faction, other: null, resourceId: -1, weight: 70 + (atWar ? 5 : 0) });
            for (const h of helpers) {
                if (h === a || !hasMet(a, h)) continue;
                const last = c.condemned[h.empireId];
                if (last === undefined || year - last >= 3) out.push({ kind: 'condemn', proposer: a, target: h, other: faction, resourceId: -1, weight: 55 });
            }
        }
    }
    return out;
}

function crisisVoteBias(galaxy: Galaxy, voter: Empire, m: Motion): number {
    const crises = activeCrises(galaxy);
    if (crises.length === 0) return 0;
    for (const { faction } of crises) {
        if (m.target === faction && (m.kind === 'threat' || m.kind === 'sanction')) return 15;
        if (m.kind === 'condemn' && m.other === faction) return voter.diplomaticRelations.byEmpire(faction)?.type === DiplomaticRelationType.War ? 10 : 0;
    }
    return 0;
}

registerCouncilExtension({ id: 'crisis', candidates: crisisCandidates, voteBias: crisisVoteBias });

/** After the council's yearly session (order 40): a passed 'threat' on a non-pirate faction becomes a joint war. */
export function crisisJointWar(galaxy: Galaxy): void {
    const cs = peekCouncilState(galaxy);
    if (cs === null) return;
    const st = crisisState(galaxy);
    for (const { entry, faction } of activeCrises(galaxy)) {
        if (faction.pirateEmpireBaseHabitat !== null) continue;
        for (const c of cs.councils) {
            if (!c.threats.includes(faction)) continue;
            const joined: Empire[] = [];
            for (const m of [...c.members].sort(byId)) {
                if (m === faction || isCrisisFaction(galaxy, m) || isHumanEmpire(galaxy, m) || !hasMet(m, faction)) continue;
                const k = `jointWar:${c.id}:${faction.empireId}:${m.empireId}`;
                if (st.done[k]) continue;
                st.done[k] = true;
                if (m.diplomaticRelations.byEmpire(faction)?.type === DiplomaticRelationType.War) continue;
                declareWar(galaxy, m, faction);
                joined.push(m);
            }
            if (joined.length > 0) scenarioNews(galaxy, null, `${c.name}: the ${joined.map((e) => e.name).join(', ')} go to war with the ${entry.label} in a joint war the council called.`, () => true, faction, { category: 'council', importance: 2 });
        }
    }
}

registerScenarioYearly({ id: 'crisis.council.jointWar', flag: COUNCIL_FLAG, order: 41, run: (g) => crisisJointWar(g) });
