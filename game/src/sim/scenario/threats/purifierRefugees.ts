// Purifier refugees (crisis interactions, piece 7). Not a port. When the Purifier destroys a populated colony
// (habitatDestroyed, the planet still holds its people at that instant), a share of each race's population survives
// and flees:
//   - refugees-demographics on: ordinary refugee flows (cause 'crisis'; emergent/demographics.ts spawnCrisisRefugeeFlows):
//     the add-on's own asylum choice, AI acceptance and visible convoys. A flow it cannot place is settled the stock way.
//   - otherwise (and for stranded flows): the stock population functions move them at once (PopulationList.add on the
//     receiving colony, acceptsPopulation as the civilian migration AI uses): the victim's own nearest colonies first,
//     then neighbouring empires' (not at war with the victim).
// A receiving colony takes a temporary crowding hit on its approval (a stability term, fading linearly) and keeps the
// refugees as extra population (it grows). Share param purifierRefugeeShare (default 0.2), crowding purifierCrowding
// (default 4 approval points) over purifierCrowdingYears (default 1.5). No Rnd (convoys draw as any accepted flow does).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { Race } from '../../data/races';
import { Population } from '../../population';
import { acceptsPopulation } from '../../civilianAI';
import { recalculateEmpirePopulation } from '../../taxes';
import { DiplomaticRelationType } from '../../diplomacy';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { isHumanEmpire } from '../../humanEmpires';
import { addMissingText, tryGetText } from '../../textResolver';
import { scenarioFlag, scenarioParam } from '../state';
import { scenarioMessage, scenarioText } from '../messages';
import { registerStabilityTerm } from '../stability';
import { spawnCrisisRefugeeFlows } from '../emergent/demographics';
import { crisisState } from './crisis';
import { peekThreatState } from './framework';

const TEXTS = [
    "'Purifier refugees: message texts (scenarioText tags).",
    'Crisis Refugees Title;Survivors flee',
    'Crisis Refugees;Survivors of {0} have fled to {1}. The colony is crowded, but it has taken them in.',
    'Crisis Refugees Lost;Survivors of {0} fled, but no colony could take them in.',
].join('\n');

const P = {
    share: (g: Galaxy) => scenarioParam(g, 'purifierRefugeeShare', 0.2),
    crowding: (g: Galaxy) => scenarioParam(g, 'purifierCrowding', 4),
    years: (g: Galaxy) => scenarioParam(g, 'purifierCrowdingYears', 1.5),
    sectors: (g: Galaxy) => scenarioParam(g, 'purifierRefugeeSectors', 4),
};

const MIN_RELOCATE = 1_000_000;

function notePlaced(galaxy: Galaxy, to: Habitat, host: Empire | null): void {
    const st = crisisState(galaxy);
    const until = galaxyStarDate(galaxy) + P.years(galaxy) * YEAR_LENGTH;
    const rec = st.crowding.find((c) => c.habitat === to);
    if (rec !== undefined) rec.until = Math.max(rec.until, until);
    else st.crowding.push({ habitat: to, amount: P.crowding(galaxy), until });
    void host;
}

/** Receivers for survivors of `from`: the victim's own colonies by distance, then other empires' (up to three). */
function receivers(galaxy: Galaxy, from: Habitat, victim: Empire, race: Race): Habitat[] {
    const range = P.sectors(galaxy) * galaxy.sectorSize;
    const near = (list: Habitat[]): Habitat[] =>
        list
            .filter((h) => h !== from && !h.hasBeenDestroyed && h.population !== null && h.population.totalAmount < h.maxPopulation && galaxy.calculateDistance(h.xpos, h.ypos, from.xpos, from.ypos) <= range)
            .sort((a, b) => galaxy.calculateDistanceSquared(a.xpos, a.ypos, from.xpos, from.ypos) - galaxy.calculateDistanceSquared(b.xpos, b.ypos, from.xpos, from.ypos) || a.habitatIndex - b.habitatIndex);
    const out = near(victim.colonies).filter((h) => acceptsPopulation(galaxy, h, victim, race)).slice(0, 3);
    if (out.length >= 3) return out;
    const others: Habitat[] = [];
    for (const e of galaxy.empires) {
        if (e === null || e === victim || !e.active || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        if (victim.diplomaticRelations.byEmpire(e)?.type === DiplomaticRelationType.War) continue;
        for (const h of e.colonies) if (acceptsPopulation(galaxy, h, e, race)) others.push(h);
    }
    for (const h of near(others)) if (out.length < 3) out.push(h);
    return out;
}

/** The stock path: move `amount` of `race` from the dying colony to its nearest receivers at once. Returns the amount placed. */
function relocate(galaxy: Galaxy, from: Habitat, victim: Empire, race: Race, amount: number): number {
    const to = receivers(galaxy, from, victim, race);
    if (to.length === 0) return 0;
    let placed = 0;
    const each = Math.trunc(amount / to.length);
    for (const h of to) {
        const pop = h.population!;
        const room = Math.max(0, h.maxPopulation - pop.totalAmount);
        const take = Math.min(each, room);
        if (take < MIN_RELOCATE) continue;
        pop.add(new Population(race, take, galaxy));
        pop.recalculateTotalAmount();
        if (h.empire !== null) recalculateEmpirePopulation(h.empire);
        notePlaced(galaxy, h, h.empire);
        placed += take;
        if (h.empire !== null && isHumanEmpire(galaxy, h.empire)) scenarioMessage(galaxy, h.empire, scenarioText('Crisis Refugees Title'), scenarioText('Crisis Refugees', from.name, h.name), { type: EmpireMessageType.GeneralNeutralEvent, subject: h, popup: false });
    }
    return placed;
}

/** Called by the Purifier's habitatDestroyed handler for a populated, empire-owned colony. */
export function purifierRefugees(galaxy: Galaxy, habitat: Habitat, victim: Empire): void {
    const pop = habitat.population;
    if (pop === null || pop.totalAmount <= 0) return;
    if (tryGetText('Crisis Refugees Title') === null) addMissingText(TEXTS);
    const share = P.share(galaxy);
    if (scenarioFlag(galaxy, 'refugees')) {
        for (const flow of spawnCrisisRefugeeFlows(galaxy, habitat, victim, share)) {
            if (flow.stage === 'stranded') {
                flow.stage = 'lost';
                relocate(galaxy, habitat, victim, flow.race, flow.amount);
            } else if (flow.destination !== null) notePlaced(galaxy, flow.destination, flow.host);
        }
        return;
    }
    for (const item of pop.items.slice()) {
        const amount = Math.trunc(item.amount * share);
        if (amount < MIN_RELOCATE) continue;
        const placed = relocate(galaxy, habitat, victim, item.race, amount);
        item.amount -= placed;
    }
    pop.recalculateTotalAmount();
    if (isHumanEmpire(galaxy, victim) && pop.totalAmount > 0 && crisisState(galaxy).crowding.length === 0) {
        scenarioMessage(galaxy, victim, scenarioText('Crisis Refugees Title'), scenarioText('Crisis Refugees Lost', habitat.name), { type: EmpireMessageType.GeneralNeutralEvent, popup: false });
    }
}

/** The crowding term at a refugee-receiving colony (pure; fades linearly to zero). */
export function crowdingTerm(galaxy: Galaxy, h: Habitat): number | null {
    const st = peekThreatState<{ crowding: { habitat: Habitat; amount: number; until: number }[] }>(galaxy, 'crisis');
    if (st === null || st.crowding.length === 0) return null;
    const rec = st.crowding.find((c) => c.habitat === h);
    if (rec === undefined) return null;
    const now = galaxyStarDate(galaxy);
    if (now >= rec.until) return null;
    const span = Math.max(1, P.years(galaxy) * YEAR_LENGTH);
    return -rec.amount * Math.min(1, (rec.until - now) / span);
}

registerStabilityTerm({ id: 'crisis.crowding', flag: 'threatPurifier', order: 90, cause: 'crowding', label: 'Crowded with refugees', run: (g, h) => crowdingTerm(g, h) });
