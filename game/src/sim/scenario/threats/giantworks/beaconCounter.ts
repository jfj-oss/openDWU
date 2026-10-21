// The Beacon, part 3: counterplay and the dark bargain (Giantworks wonder, flag gwBeacon). Not a port.
//
// Counterplay (all emergent, nothing is a button except the purge):
//   - race against processing / feed the next season / intercept Thrall transports / hit the staging points: beaconFleet.ts
//     (the drain, the pools, the transports as real ships, the staging fleets as real ships);
//   - SALVAGE: every Reclaimer ship an empire destroys, and every hull it boards and captures, earns it salvage points; at 4,
//     12, 24 and 40 points a counter-tech step unlocks: (1) the next free shields breakthrough, (2) the next free armour and
//     weapons breakthroughs, (3) corruption resistance (counter-intelligence twice as sharp, the rebels of a purge half as strong), (4) the
//     Beacon's signal traced (every staging point is known to it as it forms);
//   - COUNTER-INTELLIGENCE: an empire's counter-intelligence agents find corrupted worlds (the Cult's discovery); a found world
//     can be purged (threat action beaconPurge; the AI purges when its garrison is strong enough);
//   - THE DARK BARGAIN: a Watcher privately offers an empire under pressure a deal through the stock decision pop-up: (a) give up
//     a colony and be spared for beaconSpareDays; (b) become the Reclaimers' protectorate and join their side of the war until,
//     beaconProtectorateYears later, they liquify it. Both are secret; any other empire may discover it (a chance each season,
//     sharper with counter-intelligence agents): discovery is a war crime ('collaboration', and the Diet may try it).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import { ComponentType } from '../../../data/components';
import { EmpireMessageType } from '../../../messages';
import { galaxyStarDate } from '../../../tick/simTime';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { changeDiplomaticRelation, declareWar, militaryPotency } from '../../../diplomacyTick';
import { takeOwnershipOfColonyFull } from '../../../combat/ownership';
import { isHumanEmpire } from '../../../humanEmpires';
import { CharacterRole, getEmpireCharacters, type IntelligenceMission } from '../../../characters';
import { GAME_DAY_LENGTH, registerScenarioQuery } from '../../hooks';
import { registerScenarioDecision, raiseScenarioDecision, type ScenarioDecision } from '../../decisions';
import { scenarioMessage, scenarioText as T } from '../../messages';
import { scenarioFlag } from '../../state';
import { applyReputation } from '../../reputation/ledger';
import { recordWarCrime, WAR_CRIMES_FLAG } from '../../charactersVictory/diet/warCrimes';
import {
    KNOWLEDGE_CONFIRMED,
    arcMessage,
    arcNews,
    knowledgeLevel,
    lockWar,
    normalEmpires,
    registerThreatAction,
    revealTo,
} from '../framework';
import { aiMayPurge, startPurge } from './beaconSiphon';
import { BEACON_FLAG, P, beaconRandom, peekBeaconState, salvageStepsOf, warOn, type BargainRec, type BeaconState, type CorruptRec, type SalvageRec } from './beaconState';

const TAG = 'Beacon';
const DECISION_KIND = 'beacon.bargain';
/** IntelligenceMissionType.CounterIntelligence (espionage.ts, as cult.ts). */
const COUNTER_INTELLIGENCE = 8;
/** Salvage points at which the four steps unlock. */
export const SALVAGE_STEPS: readonly number[] = [4, 12, 24, 40];

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

// ---------------------------------------------------------------------------------------------------------------
// Salvage
// ---------------------------------------------------------------------------------------------------------------

function salvageRec(st: BeaconState, e: Empire): SalvageRec {
    let r = st.salvage.find((s) => s.empireId === e.empireId);
    if (r === undefined) {
        r = { empireId: e.empireId, points: 0, steps: 0 };
        st.salvage.push(r);
    }
    return r;
}

/** Points a destroyed Reclaimer ship is worth by its class (the Watchers are worth a great deal). */
export function salvageWorth(galaxy: Galaxy, bo: BuiltObject, isWatcher: boolean): number {
    if (isWatcher) return 12 * P.salvageKill(galaxy);
    const hull = bo.subRole;
    // CapitalShip 5, Carrier 6, Cruiser 4 (the enum values), the rest of the warships 1-2; transports and bases 1
    const w = hull === 5 || hull === 7 ? 3 : hull === 4 ? 2 : 1;
    return w * P.salvageKill(galaxy);
}

export function addSalvage(galaxy: Galaxy, st: BeaconState, e: Empire, points: number): void {
    const r = salvageRec(st, e);
    r.points += points;
    while (r.steps < SALVAGE_STEPS.length && r.points >= SALVAGE_STEPS[r.steps]) {
        r.steps++;
        applySalvageStep(galaxy, st, e, r.steps);
    }
}

export function onKilledForSalvage(galaxy: Galaxy, st: BeaconState, bo: BuiltObject, destroyer: Empire | null, isWatcher: boolean): void {
    if (destroyer === null || destroyer === st.faction || !destroyer.active || destroyer === galaxy.independentEmpire || destroyer.pirateEmpireBaseHabitat !== null) return;
    addSalvage(galaxy, st, destroyer, salvageWorth(galaxy, bo, isWatcher));
}

/** builtObjectOwnerChanged: a Reclaimer hull boarded and captured is worth the most. */
export function onBoarded(galaxy: Galaxy, bo: BuiltObject, from: Empire | null, to: Empire | null): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || from !== st.faction || to === null || to === st.faction || !to.active || to === galaxy.independentEmpire || to.pirateEmpireBaseHabitat !== null) return;
    void bo;
    addSalvage(galaxy, st, to, P.salvageBoard(galaxy));
}

const SHIELD_TYPES: readonly ComponentType[] = [ComponentType.Shields, ComponentType.ShieldRecharge];
const ARMS_TYPES: readonly ComponentType[] = [ComponentType.Armor, ComponentType.WeaponBeam, ComponentType.WeaponTorpedo, ComponentType.WeaponMissile, ComponentType.WeaponIonCannon];

/**
 * A free breakthrough: the cheapest project (lowest tech level) not yet researched whose components include one of `types` and
 * whose required parents are researched is completed, as a research breakthrough completes it. Returns its name, or null.
 */
export function grantBreakthrough(galaxy: Galaxy, e: Empire, types: readonly ComponentType[]): string | null {
    const byId = galaxy.researchStatic?.componentsById;
    if (byId === undefined) return null;
    let best = null as (typeof e.research.techTree)[number] | null;
    for (const n of e.research.techTree) {
        if (n.isResearched || n.def.techLevel >= 100) continue;
        if (!n.def.components.some((id) => types.includes(byId.get(id)?.type as ComponentType))) continue;
        if (n.parentNodes.some((p, i) => n.parentIsRequired[i] && !p.isResearched)) continue;
        const allowed = galaxy.researchStatic?.allowedRaces.get(n.def.projectId);
        if (allowed !== undefined && allowed.size > 0 && (e.dominantRace === null || !allowed.has(e.dominantRace.name))) continue;
        if (best === null || n.def.techLevel < best.def.techLevel || (n.def.techLevel === best.def.techLevel && n.def.projectId < best.def.projectId)) best = n;
    }
    if (best === null) return null;
    best.isResearched = true;
    best.selfResearched = true;
    best.isEnabled = true;
    best.progress = best.cost;
    e.research.update(e.dominantRace);
    e.reviewResearchAbilities();
    e.reviewDesignsBuiltObjectsImprovedComponents();
    return best.def.name;
}

function applySalvageStep(galaxy: Galaxy, st: BeaconState, e: Empire, step: number): void {
    st.stats.salvageSteps++;
    let detail: string | null = null;
    if (step === 1) detail = grantBreakthrough(galaxy, e, SHIELD_TYPES);
    else if (step === 2) {
        const a = grantBreakthrough(galaxy, e, ARMS_TYPES);
        const b = grantBreakthrough(galaxy, e, ARMS_TYPES);
        detail = [a, b].filter((x): x is string => x !== null).join(', ') || null;
    } else if (step === 4 && st.season !== null) {
        for (const sp of st.season.staging) revealTo(galaxy, sp, e, KNOWLEDGE_CONFIRMED);
    }
    if (!isHumanEmpire(galaxy, e)) return;
    const body = step <= 2 ? T(`${TAG} Salvage ${step}`, detail !== null ? T(`${TAG} Salvage Tech`, detail) : T(`${TAG} Salvage Tech None`)) : T(`${TAG} Salvage ${step}`);
    scenarioMessage(galaxy, e, T(`${TAG} Salvage Title`), body, { type: EmpireMessageType.GeneralGoodEvent, popup: false });
}

/** Factor on `empire`'s purge rebels' strength and (inverted) on its counter-intelligence: 0.5 once the corruption-resistance step is unlocked. Pure. */
export function resistanceFactor(st: BeaconState, empire: Empire): number {
    return salvageStepsOf(st, empire) >= 3 ? 0.5 : 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Counter-intelligence and the purge
// ---------------------------------------------------------------------------------------------------------------

function agentIsCounterIntel(c: import('../../../characters').Character): boolean {
    if (c.role !== CharacterRole.IntelligenceAgent || !c.active) return false;
    const m = c.mission as IntelligenceMission | null;
    return m !== null && m.type === COUNTER_INTELLIGENCE;
}

/** Begins the purge of `rec` for `by` (its owner): the world rebels and `by` must win the ground battle. False when it cannot start. */
export function purgeCorruption(galaxy: Galaxy, st: BeaconState, rec: CorruptRec, by: Empire): boolean {
    return startPurge(galaxy, st, rec, by, resistanceFactor(st, by));
}

function corruptionOf(st: BeaconState, colony: Habitat): CorruptRec | undefined {
    return st.corrupted.find((c) => c.colony === colony && c.ended === null);
}

/** Every 60 days: counter-intelligence agents find corrupted worlds of their empire; the AI purges what it finds; bargains may be discovered. */
export function counterIntelligencePass(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || !st.faction.active) return;
    const rnd = beaconRandom(galaxy, st, 101);
    for (const e of normalEmpires(galaxy, st.faction)) {
        const agents = getEmpireCharacters(e).filter(agentIsCounterIntel);
        const mult = salvageStepsOf(st, e) >= 3 ? 2 : 1;
        for (const rec of st.corrupted) {
            if (rec.ended !== null || rec.colony.empire !== e || knowledgeLevel({ knowledge: rec.knowledge }, e) >= KNOWLEDGE_CONFIRMED) continue;
            for (const agent of agents) {
                if (rnd.nextDouble() < (P.agentDetectPct(galaxy) / 1000) * agent.espionageFactored * mult) {
                    if (revealTo(galaxy, { knowledge: rec.knowledge }, e, KNOWLEDGE_CONFIRMED) && isHumanEmpire(galaxy, e)) {
                        arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Corrupt Found', onceKey: `CorruptFound:${st.corrupted.indexOf(rec)}`, args: [rec.colony.name], type: EmpireMessageType.GeneralWarning, subject: rec.colony });
                    }
                    break;
                }
            }
        }
        // the AI purges what it knows
        if (!isHumanEmpire(galaxy, e)) for (const rec of st.corrupted) if (rec.ended === null && rec.colony.empire === e && knowledgeLevel({ knowledge: rec.knowledge }, e) >= KNOWLEDGE_CONFIRMED && aiMayPurge(galaxy, rec, resistanceFactor(st, e))) purgeCorruption(galaxy, st, rec, e);
    }
    discoverBargains(galaxy, st, rnd);
}

// ---------------------------------------------------------------------------------------------------------------
// The dark bargain
// ---------------------------------------------------------------------------------------------------------------

function activeBargain(st: BeaconState, e: Empire): BargainRec | undefined {
    return st.bargains.find((b) => b.empireId === e.empireId && !b.ended);
}

/** Wars the protectorate fights on the Reclaimers' side: every normal empire that is not itself in the pocket. */
function protectorateEnemies(galaxy: Galaxy, st: BeaconState, e: Empire): Empire[] {
    return normalEmpires(galaxy, st.faction).filter((x) => x !== e && !(activeBargain(st, x)?.kind === 'protectorate'));
}

function makePeaceWith(galaxy: Galaxy, faction: Empire, e: Empire): void {
    const a = obtainDiplomaticRelation(faction, e);
    const b = obtainDiplomaticRelation(e, faction);
    a.locked = false;
    b.locked = false;
    if (a.type === DiplomaticRelationType.War) changeDiplomaticRelation(galaxy, faction, a, DiplomaticRelationType.None);
    if (b.type === DiplomaticRelationType.War) changeDiplomaticRelation(galaxy, e, b, DiplomaticRelationType.None);
}

/** The colony an empire would give up: its smallest populated colony that is not its capital (null when it has fewer than two). */
export function colonyToCede(e: Empire): Habitat | null {
    const cands = e.colonies.filter((c) => !c.hasBeenDestroyed && c.population.totalAmount > 0 && c !== e.capital);
    if (e.colonies.length < 2 || cands.length === 0) return null;
    return cands.sort((a, b) => a.population.totalAmount - b.population.totalAmount || a.name.localeCompare(b.name))[0];
}

/** Offers a bargain to `e` (the decision pop-up for a human, an immediate AI choice otherwise). Returns false when nothing was offered. */
export function makeOffer(galaxy: Galaxy, st: BeaconState, e: Empire): boolean {
    if (st.faction === null || activeBargain(st, e) !== undefined) return false;
    const colony = colonyToCede(e);
    const now = galaxyStarDate(galaxy);
    st.offered[String(e.empireId)] = now;
    st.stats.offers++;
    const years = Math.round((P.spareDays(galaxy) / 360) * 10) / 10;
    const options = [{ id: 'refuse', label: T(`${TAG} Offer Refuse`) }];
    if (colony !== null) options.push({ id: 'cede', label: T(`${TAG} Offer Cede`, colony.name, years) });
    options.push({ id: 'protectorate', label: T(`${TAG} Offer Protectorate`) });
    raiseScenarioDecision(galaxy, e, {
        kind: DECISION_KIND,
        title: T(`${TAG} Offer Title`),
        text: T(`${TAG} Offer`, colony?.name ?? '-', years),
        options,
        defaultOption: 'refuse',
        expiresDays: 120,
        context: { colony: colony !== null ? galaxy.habitats.indexOf(colony) : -1 },
    });
    return true;
}

/** Applies the empire's answer. */
export function resolveBargain(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const st = peekBeaconState(galaxy);
    const e = d.empire;
    if (st === null || st.faction === null || !st.faction.active || !e.active) return;
    const faction = st.faction;
    const now = galaxyStarDate(galaxy);
    if (optionId === 'refuse' || activeBargain(st, e) !== undefined) {
        st.stats.refused++;
        return;
    }
    if (optionId === 'cede') {
        const idx = Number(d.context['colony']);
        const colony = Number.isFinite(idx) && idx >= 0 ? galaxy.habitats[idx] ?? null : null;
        if (colony === null || colony.hasBeenDestroyed || colony.empire !== e) return;
        st.ceding = true;
        takeOwnershipOfColonyFull(galaxy, e, colony, faction, false, false);
        st.ceding = false;
        makePeaceWith(galaxy, faction, e);
        st.bargains.push({ empireId: e.empireId, kind: 'cede', date: now, until: now + days(P.spareDays(galaxy)), colonyName: colony.name, discovered: false, discoveredDate: 0, ended: false });
        st.stats.accepted++;
        if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, T(`${TAG} Ceded Title`, colony.name), T(`${TAG} Ceded`, colony.name), { type: EmpireMessageType.GeneralWarning, popup: false });
        return;
    }
    if (optionId === 'protectorate') {
        makePeaceWith(galaxy, faction, e);
        st.bargains.push({ empireId: e.empireId, kind: 'protectorate', date: now, until: now + (P.protectorateYears(galaxy) * 360 * GAME_DAY_LENGTH), colonyName: '', discovered: false, discoveredDate: 0, ended: false });
        st.stats.accepted++;
        for (const x of protectorateEnemies(galaxy, st, e)) if (obtainDiplomaticRelation(e, x).type !== DiplomaticRelationType.War) declareWar(galaxy, e, x);
        if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, T(`${TAG} Protectorate Title`), T(`${TAG} Protectorate`), { type: EmpireMessageType.GeneralWarning, popup: false });
    }
}

/**
 * The AI's answer: it refuses unless it is losing: weak (under half the strongest empires' military) and having lost worlds to
 * the Reclaimers. A single loss: give up a colony; three or more: the protectorate. Pure.
 */
export function aiBargainChoice(galaxy: Galaxy, d: ScenarioDecision): string {
    const st = peekBeaconState(galaxy);
    if (st === null) return 'refuse';
    const e = d.empire;
    const lost = st.lostBy[String(e.empireId)] ?? 0;
    const ref = normalEmpires(galaxy, st.faction).map((x) => militaryPotency(x)).sort((a, b) => b - a)[0] ?? 0;
    const mil = militaryPotency(e);
    const share = lost / Math.max(1, lost + e.colonies.length); // the part of its worlds it has already lost
    const canCede = d.options.some((o) => o.id === 'cede');
    if (mil < ref * 0.25 && lost >= 4 && share >= 0.3) return 'protectorate';
    if (mil < ref * 0.4 && lost >= 2 && share >= 0.2 && canCede) return 'cede';
    return 'refuse';
}

/** The empires the Reclaimers have hurt most, worst first (ties by empire id): the ones a Watcher offers a deal. Pure. */
export function offerCandidates(galaxy: Galaxy, st: BeaconState, now: number): Empire[] {
    return normalEmpires(galaxy, st.faction)
        .filter((e) => (st.lostBy[String(e.empireId)] ?? 0) > 0 && activeBargain(st, e) === undefined && now - (st.offered[String(e.empireId)] ?? -1e18) > days(360))
        .sort((a, b) => (st.lostBy[String(b.empireId)] ?? 0) - (st.lostBy[String(a.empireId)] ?? 0) || a.empireId - b.empireId);
}

/** Monthly: offers, the end of a term (a spared empire is hunted again; a protectorate is liquified). */
export function counterMonthly(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.phase !== 'reclamation' || st.faction === null || !st.faction.active) return;
    const now = galaxyStarDate(galaxy);
    const faction = st.faction;
    for (const b of st.bargains) {
        if (b.ended || now < b.until) continue;
        b.ended = true;
        const e = normalEmpires(galaxy, faction).find((x) => x.empireId === b.empireId);
        if (e === undefined) continue;
        lockWar(galaxy, faction, e);
        if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, T(`${TAG} ${b.kind === 'cede' ? 'Spare Ended' : 'Betrayed'} Title`), T(`${TAG} ${b.kind === 'cede' ? 'Spare Ended' : 'Betrayed'}`), { type: EmpireMessageType.GeneralBadEvent, popup: false });
        if (b.kind === 'protectorate') arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Betrayed', onceKey: `Betrayed:${b.empireId}`, textTag: `${TAG} Betrayed News`, args: [e.name] });
    }
    if (now >= st.nextOfferDate && st.season !== null && warOn(st)) {
        const rnd = beaconRandom(galaxy, st, 111);
        st.nextOfferDate = now + days(P.offerEveryDays(galaxy) * (0.7 + 0.6 * rnd.nextDouble()));
        const c = offerCandidates(galaxy, st, now);
        if (c.length > 0) makeOffer(galaxy, st, c[0]);
    }
}

/** Counter-intelligence of `e`: how many agents are on that mission. Pure. */
function counterAgents(e: Empire): number {
    return getEmpireCharacters(e).filter(agentIsCounterIntel).length;
}

/** Each pass, every other empire may discover a bargain (beaconDiscoverPct, +4 points per counter-intelligence agent, up to 3). */
function discoverBargains(galaxy: Galaxy, st: BeaconState, rnd: ReturnType<typeof beaconRandom>): void {
    for (const b of st.bargains) {
        if (b.ended || b.discovered) continue;
        const dealer = normalEmpires(galaxy, st.faction).find((x) => x.empireId === b.empireId);
        if (dealer === undefined) continue;
        for (const o of normalEmpires(galaxy, st.faction)) {
            if (o === dealer) continue;
            const pct = P.discoverPct(galaxy) + 4 * Math.min(3, counterAgents(o)) * (salvageStepsOf(st, o) >= 3 ? 2 : 1);
            if (rnd.nextDouble() * 100 >= pct) continue;
            expose(galaxy, st, b, dealer, o);
            break;
        }
    }
}

/** The bargain is found out: a war crime (the Diet may try it), reputation, news. */
export function expose(galaxy: Galaxy, st: BeaconState, b: BargainRec, dealer: Empire, finder: Empire): void {
    if (b.discovered) return;
    b.discovered = true;
    b.discoveredDate = galaxyStarDate(galaxy);
    st.stats.discoveries++;
    const scale = b.kind === 'protectorate' ? 1 : 0.5;
    if (scenarioFlag(galaxy, WAR_CRIMES_FLAG)) recordWarCrime(galaxy, dealer, 'collaboration', null, `beacon:${b.empireId}`, 0, scale);
    else {
        for (const o of normalEmpires(galaxy, st.faction)) {
            if (o === dealer) continue;
            applyReputation(galaxy, o, dealer, -10 * scale, { cause: 'beacon.collaboration', labelKey: 'Reputation Cause beacon.collaboration', source: 'beacon', legacy: 'factored', decayPerYear: 1 });
        }
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Exposed', onceKey: `Exposed:${b.empireId}`, textTag: `${TAG} Exposed News`, args: [dealer.name], subject: dealer });
    if (isHumanEmpire(galaxy, dealer)) scenarioMessage(galaxy, dealer, T(`${TAG} Exposed Title`), T(`${TAG} Exposed Self`), { type: EmpireMessageType.GeneralBadEvent, popup: true });
    if (isHumanEmpire(galaxy, finder)) scenarioMessage(galaxy, finder, T(`${TAG} Exposed Title`), T(`${TAG} Exposed`, dealer.name), { type: EmpireMessageType.GeneralWarning, popup: false, subject: dealer });
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export function registerCounterplay(): void {
    registerScenarioDecision({ id: 'beacon.decision', kind: DECISION_KIND, alwaysAsk: true, aiPure: true, flag: BEACON_FLAG, resolve: resolveBargain, aiChoose: aiBargainChoice });
    // A protectorate cannot make peace with its patron's enemies (and they not with it) while the bargain stands.
    registerScenarioQuery({
        id: 'beacon.noPeace',
        flag: BEACON_FLAG,
        query: 'endWarAcceptance',
        run: (g, v, a) => {
            if (!v) return v;
            const st = peekBeaconState(g);
            if (st === null) return v;
            const pa = activeBargain(st, a.empire)?.kind === 'protectorate';
            const pb = activeBargain(st, a.other)?.kind === 'protectorate';
            return pa === pb || a.other === st.faction || a.empire === st.faction ? v : false;
        },
    });
    registerThreatAction('beaconPurge', {
        available: (g, empire, target) => {
            const st = peekBeaconState(g);
            if (st === null || st.faction === null || target === null || typeof target !== 'object' || !('population' in (target as object))) return false;
            const rec = corruptionOf(st, target as Habitat);
            return rec !== undefined && rec.colony.empire === empire && rec.purge === undefined && knowledgeLevel({ knowledge: rec.knowledge }, empire) >= KNOWLEDGE_CONFIRMED;
        },
        run: (g, empire, target) => {
            const st = peekBeaconState(g);
            if (st === null) return false;
            const rec = corruptionOf(st, target as Habitat);
            return rec !== undefined && purgeCorruption(g, st, rec, empire);
        },
        label: () => T(`${TAG} Purge Action`),
    });
}
