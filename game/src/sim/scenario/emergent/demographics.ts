// Package 19d4 — Refugees & demographics (tasks/19d4-refugees-demographics.md). Scenario id "refugees-demographics",
// flag `refugees`. Not a port; builds on ported multi-race colony populations, race attitudes, migration and the
// already-ported refugee events (story/eventActions.ts GenerateRefugeeFleet, exploration.ts ruins Refugees).
//
// The 19d1 shared "§S" scenario infrastructure (approval-term registry, common decision helpers) is not on this
// branch. Everything here is local to this package; a future 19d1 merge can factor the tension approval-term
// registration and the asylum decision into that shared layer without changing this module's exported API.
//
// Rnd policy (tasks/MODLAYER-DESIGN.md): draws only happen in spawnRefugeeFlows (flow sizing) and the government-in-
// exile path (createEmpireMidGame's own draws), both reached only from the flagged `reviewMigrationTourism` hook or
// this package's own yearly tick. Every other function here is pure / no-Rnd, as the spec requires.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Race } from '../../data/races';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import { Population, PopulationList } from '../../population';
import { resolveStandardRaceBias } from '../../raceBias';
import { CharacterRole, CharacterTraitType, stellarObjectCharacters } from '../../characters';
import { recalculateEmpirePopulation } from '../../taxes';
import { acceptsPopulation, PrioritizedTarget, prioritizedTargetListAdd } from '../../civilianAI';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import type { DesignSpecification } from '../../data/designSpecifications';
import { generateDesignFromSpec } from '../../designGeneration';
import { generateNewBuiltObject } from '../../empireEvents';
import { makeHabitatIntoColonyRuntime } from '../../missions/cmdTroops';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, isHabitat } from '../../missions/mission';
import { builtObjectCompleteTeardown } from '../../combat/teardown';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../diplomacy';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { raceFriendlinessLevel } from '../../colonyTick';
import { registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly, gameYear } from '../hooks';
import { registerStabilityTerm } from '../stability';
import { colonyQuarantined, securitySlots } from '../security/registry';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { registerScenarioDecision, raiseScenarioDecision } from '../decisions';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { createEmpireMidGame } from '../empireMidGame';

// ---------------------------------------------------------------------------------------------------------------
// State (§3)
// ---------------------------------------------------------------------------------------------------------------

export type RefugeeCauseKind = 'conquest' | 'bombardment' | 'plague' | 'disaster' | 'policy' | 'secession' | 'crisis';
export type RefugeeFlowStage = 'pending' | 'asking' | 'travelling' | 'settled' | 'stranded' | 'lost';
export type AsylumPolicy = 'open' | 'kin' | 'closed';

export interface RefugeeCause {
    habitat: Habitat;
    cause: RefugeeCauseKind;
    oldOwner: Empire | null;
    year: number;
    /** Set once a flow has been spawned for this cause (spawnRefugeeFlows consumes causes exactly once). */
    handled: boolean;
}

export interface RefugeeFlow {
    id: number;
    race: Race;
    amount: number;
    origin: Habitat;
    originEmpire: Empire | null;
    cause: RefugeeCauseKind;
    destination: Habitat | null;
    host: Empire | null;
    stage: RefugeeFlowStage;
    created: number; // game year
    /** Habitats already refused (redirect / AI refusal) so chooseAsylum does not re-offer them. */
    excludedHosts: Habitat[];
    /** Pending player decision id (refugees.asylum), when one is open for this flow. */
    decisionId: number | null;
}

export interface MigrationLink {
    from: Habitat;
    to: Habitat;
    race: Race;
    strength: number; // 0..1
    lastYear: number;
}

export interface DemographicsState {
    causes: RefugeeCause[];
    flows: RefugeeFlow[];
    /** Convoy ship -> the flow it carries (a ship may carry only part of a flow's amount). */
    convoys: Map<BuiltObject, { flow: RefugeeFlow; race: Race; amount: number }>;
    links: MigrationLink[];
    asylum: Map<Empire, AsylumPolicy>;
    /** Population currently hosted by an empire that is not its dominant race (race -> amount), recomputed yearly. */
    hosted: Map<Empire, Map<Race, number>>;
    nextFlowId: number;
    /** Running total of the diaspora-diplomacy incidentEvaluation delta applied between (host, guest) pairs, capped
     * at +10 (spec §2.10) independently of the shared incidentEvaluation cap. Key: `${hostEmpireId}:${guestEmpireId}`. */
    diasporaEval: Map<string, number>;
    /** Habitats given an exile empire already (§2.6b: at most one per eliminated empire). Key: old owner's empire id. */
    exileFounded: Set<number>;
    /** Last-seen population policy per habitat (habitat -> [colonyPopulationPolicy, colonyPopulationPolicyRaceFamily]),
     * used to detect the transition into Exterminate/Enslave the "policy" cause needs (colonyTick.ts
     * reviewColonyPopulationPolicy only *applies* an already-set policy; it never emits a scenario event). */
    lastPolicy: Map<Habitat, [number, number]>;
}

const POPULATION_FLOOR = 10_000_000; // spec §2.2 "the port's population floor"

function demographicsState(galaxy: Galaxy): DemographicsState {
    return scenarioState<DemographicsState>(galaxy, 'demographics', () => ({
        causes: [],
        flows: [],
        convoys: new Map(),
        links: [],
        asylum: new Map(),
        hosted: new Map(),
        nextFlowId: 1,
        diasporaEval: new Map(),
        exileFounded: new Set(),
        lastPolicy: new Map(),
    }));
}

/** Test / UI accessor: the package's saved state (throws when there is no scenario, like scenarioState itself). */
export function demographicsStateOf(galaxy: Galaxy): DemographicsState {
    return demographicsState(galaxy);
}

function empireId(e: Empire | null): number {
    return e === null ? -1 : e.empireId;
}

// ---------------------------------------------------------------------------------------------------------------
// §2.1 Causes (record only, no Rnd)
// ---------------------------------------------------------------------------------------------------------------

/** Records a refugee cause at `habitat`. Exported so 19d1 (secession) / 19d2 (crises ≥ 2 years) can call it directly.
 * Self-guards on the flag (defence in depth: this package's own event handlers already gate on it, but a future
 * caller from another package should not have to remember to). */
export function recordRefugeeCause(galaxy: Galaxy, habitat: Habitat, cause: RefugeeCauseKind, oldOwner: Empire | null): void {
    if (!scenarioFlag(galaxy, 'refugees')) return;
    const st = demographicsState(galaxy);
    st.causes.push({ habitat, cause, oldOwner, year: gameYear(galaxyStarDate(galaxy)), handled: false });
}

const NATURAL_DISASTER_TYPES = new Set([1, 2, 3, 4, 5, 6]); // DisasterEventType Earthquake..Eruption (eventTypes.ts declaration order, EconomicCrisis/Plague excluded)

registerScenarioEvent({
    id: 'emergent.demographics.cause.conquest',
    flag: 'refugees',
    event: 'colonyOwnerChanged',
    run: (galaxy, { colony, from, to }) => {
        // combat/ownership.ts takeOwnershipOfColonyFull already reassigned colony.empire to `to` by the time this
        // fires; `from` is the previous owner (Galaxy.9.cs / Empire.1.cs TakeOwnershipOfColony call sites).
        if (from === null || to === null || from === to) return;
        if (from === galaxy.independentEmpire) return; // independent colonies settling is not a refugee-causing conquest
        recordRefugeeCause(galaxy, colony, 'conquest', from);
    },
});

registerScenarioEvent({
    id: 'emergent.demographics.cause.bombardment',
    flag: 'refugees',
    event: 'habitatBombarded',
    run: (galaxy, { habitat, bombardPower }) => {
        // combat/damage.ts inflictBombardDamage only touches population when !planetaryShieldPresent and there is a
        // population to reduce (BuiltObject.2.cs 5816 5923-5934: num4 = bombardPower * 250000 spread across races).
        // The event fires unconditionally at the end of the function, so approximate "population was lost" from the
        // same guard the ported code uses, read live (nothing else mutates it between the loss and this handler).
        if (habitat.planetaryShieldPresent) return;
        if (bombardPower <= 1) return;
        if (habitat.population === null || habitat.population.totalAmount <= 0) return;
        recordRefugeeCause(galaxy, habitat, 'bombardment', habitat.empire);
    },
});

registerScenarioEvent({
    id: 'emergent.demographics.cause.disaster',
    flag: 'refugees',
    event: 'disaster',
    run: (galaxy, { habitat, disasterType }) => {
        if (habitat === null) return;
        // eventTypes.ts DisasterEventType: 0 Undefined, 1..6 the natural disasters, then Plague, EconomicCrisis, ...
        const t = disasterType as unknown as number;
        if (t === 7 /* Plague */) recordRefugeeCause(galaxy, habitat, 'plague', habitat.empire);
        else if (NATURAL_DISASTER_TYPES.has(t)) recordRefugeeCause(galaxy, habitat, 'disaster', habitat.empire);
    },
});

/** ColonyPopulationPolicy.cs order (types.ts): Assimilate=0, DoNotAccept=1, Resettle=2, Enslave=3, Exterminate=4. */
const POLICY_ENSLAVE = 3;
const POLICY_EXTERMINATE = 4;

/** §2.1 "policy" cause: polled yearly (no scenarioEmit site exists for a colonyPopulationPolicy write — colonyTick.ts
 * reviewColonyPopulationPolicy only applies an already-set policy). Detects the transition into Enslave/Exterminate. */
function pollPolicyCauses(galaxy: Galaxy): void {
    const st = demographicsState(galaxy);
    for (const empire of galaxy.empires) {
        for (const h of empire.colonies) {
            const prev = st.lastPolicy.get(h);
            const cur: [number, number] = [h.colonyPopulationPolicy, h.colonyPopulationPolicyRaceFamily];
            st.lastPolicy.set(h, cur);
            if (prev === undefined) continue;
            const becamePolicy = (p: number, c: number) => (c === POLICY_ENSLAVE || c === POLICY_EXTERMINATE) && p !== c;
            if (becamePolicy(prev[0], cur[0]) || becamePolicy(prev[1], cur[1])) recordRefugeeCause(galaxy, h, 'policy', empire);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// §2.2 Flows
// ---------------------------------------------------------------------------------------------------------------

/** Called at the end of reviewMigrationTourism(galaxy, empire) (civilianAI.ts, one guarded line). */
export function spawnRefugeeFlows(galaxy: Galaxy, empire: Empire): void {
    if (!scenarioFlag(galaxy, 'refugees')) return;
    const st = demographicsState(galaxy);
    const share = scenarioParam(galaxy, 'refugeeShare', 0.15);
    for (const cause of st.causes) {
        if (cause.handled) continue;
        if (cause.habitat.empire !== empire) continue; // "for the owner of each cause habitat"
        cause.handled = true;
        const pop = cause.habitat.population;
        if (pop === null || pop.items.length === 0) continue;
        const dominant = empire.dominantRace;
        for (const item of pop.items.slice()) {
            let fleeing: boolean;
            if (cause.cause === 'bombardment' || cause.cause === 'plague' || cause.cause === 'disaster') fleeing = true;
            else if (cause.cause === 'policy') fleeing = item.race !== dominant;
            else fleeing = dominant !== null && item.race !== dominant && resolveStandardRaceBias(item.race, dominant) < 0;
            if (!fleeing) continue;
            // RND(19d4): flow size.
            let amount = Math.trunc(item.amount * share * (0.75 + galaxy.rnd.nextDouble() * 0.5));
            amount = Math.max(amount, 10_000_000);
            if (item.amount - amount < POPULATION_FLOOR) amount = Math.max(0, item.amount - POPULATION_FLOOR);
            if (amount < 10_000_000) continue; // nothing to spare above the floor
            item.amount -= amount;
            const flow: RefugeeFlow = {
                id: st.nextFlowId++,
                race: item.race,
                amount,
                origin: cause.habitat,
                originEmpire: empire,
                cause: cause.cause,
                destination: null,
                host: null,
                stage: 'pending',
                created: gameYear(galaxyStarDate(galaxy)),
                excludedHosts: [],
                decisionId: null,
            };
            st.flows.push(flow);
        }
        pop.recalculateTotalAmount();
        recalculateEmpirePopulation(empire);
    }
    st.causes = st.causes.filter((c) => !c.handled);
    // Move every pending flow through asylum selection right away (chooseAsylum draws no Rnd; convoy creation draws
    // Rnd only through generateNewBuiltObject, which is fine here since we are already inside a flagged hook).
    for (const flow of st.flows) {
        if (flow.stage !== 'pending') continue;
        processAsylumSelection(galaxy, flow);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// §2.3 Destination — chooseAsylum (no Rnd)
// ---------------------------------------------------------------------------------------------------------------

interface AsylumCandidate {
    habitat: Habitat;
    host: Empire;
    score: number;
}

function linksFromOrigin(state: DemographicsState, origin: Habitat): number {
    return state.links.filter((l) => l.from === origin).length;
}

function linkStrength(state: DemographicsState, origin: Habitat, destination: Habitat, race: Race): number {
    const link = state.links.find((l) => l.from === origin && l.to === destination && l.race === race);
    return link === undefined ? 0 : link.strength;
}

function asylumPolicyOf(state: DemographicsState, empire: Empire): AsylumPolicy {
    return state.asylum.get(empire) ?? 'kin';
}

function asylumAllows(policy: AsylumPolicy, race: Race, hostDominant: Race | null): boolean {
    if (policy === 'open') return true;
    if (policy === 'closed') return false;
    // 'kin'
    return hostDominant !== null && (race === hostDominant || race.raceFamily === hostDominant.raceFamily);
}

/** §2.3 chooseAsylum(galaxy, flow): the best colony destination, or a fallback uncolonised habitat, or null (stranded). */
export function chooseAsylum(galaxy: Galaxy, flow: RefugeeFlow): { habitat: Habitat; host: Empire | null } | null {
    const st = demographicsState(galaxy);
    const origin = flow.origin;
    const range = 3 * galaxy.sectorSize * (1 + 0.5 * linksFromOrigin(st, origin));
    const originOwner = flow.originEmpire;
    const candidates: AsylumCandidate[] = [];
    const consider = (h: Habitat, host: Empire) => {
        if (h === origin) return;
        if (flow.excludedHosts.includes(h)) return;
        if (colonyQuarantined(galaxy, h)) return; // 19m quarantine blocks refugee inflow (flag-gated)
        if (!acceptsPopulation(galaxy, h, host, flow.race)) return;
        if (originOwner !== null && obtainDiplomaticRelation(host, originOwner).type === DiplomaticRelationType.War) return;
        const policy = asylumPolicyOf(st, host);
        if (!asylumAllows(policy, flow.race, h.population?.dominantRace ?? null)) return;
        if (h.population === null || h.population.totalAmount >= h.maxPopulation) return;
        const distance = galaxy.calculateDistance(h.xpos, h.ypos, origin.xpos, origin.ypos);
        if (distance > range) return;
        const hostDominant = h.population.dominantRace ?? host.dominantRace;
        const sameRaceAlready = h.population.items.some((p) => p.race === flow.race);
        const score =
            -distance / galaxy.sectorSize +
            (10 * resolveStandardRaceBias(flow.race, hostDominant)) / 100 +
            (sameRaceAlready ? 5 : 0) +
            5 * linkStrength(st, origin, h, flow.race);
        candidates.push({ habitat: h, host, score });
    };
    for (const empire of galaxy.empires) {
        if (empire === galaxy.independentEmpire) continue;
        for (const h of empire.colonies) consider(h, empire);
    }
    if (galaxy.independentEmpire !== null) {
        for (const h of galaxy.independentColonies) consider(h, galaxy.independentEmpire);
    }
    if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score || galaxy.habitats.indexOf(a.habitat) - galaxy.habitats.indexOf(b.habitat));
        return { habitat: candidates[0].habitat, host: candidates[0].host };
    }
    // Fallback: nearest uncolonised habitat of the race's native type within range.
    const fallback = galaxy.findNearestUncolonizedHabitat(origin.xpos, origin.ypos, flow.race.nativeHabitatType);
    if (fallback !== null && !flow.excludedHosts.includes(fallback)) {
        const distance = galaxy.calculateDistance(fallback.xpos, fallback.ypos, origin.xpos, origin.ypos);
        if (distance <= range) return { habitat: fallback, host: null };
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// §2.4 Asylum decision + §2.5 Convoy
// ---------------------------------------------------------------------------------------------------------------

function markStranded(galaxy: Galaxy, flow: RefugeeFlow): void {
    flow.stage = 'stranded';
    if (flow.amount > 100_000_000) {
        scenarioNews(galaxy, null, scenarioText('Emergent Refugee Stranded News', flow.race.name, flow.origin.name, String(flow.amount)));
    }
}

function processAsylumSelection(galaxy: Galaxy, flow: RefugeeFlow): void {
    const choice = chooseAsylum(galaxy, flow);
    if (choice === null) {
        markStranded(galaxy, flow);
        return;
    }
    flow.destination = choice.habitat;
    flow.host = choice.host;
    if (choice.host === null) {
        // Uncolonised fallback: no asylum decision needed, accepted immediately.
        acceptFlow(galaxy, flow);
        return;
    }
    if (choice.host === galaxy.playerEmpire) {
        flow.stage = 'asking';
        const decision = raiseScenarioDecision(galaxy, choice.host, {
            kind: 'refugees.asylum',
            title: scenarioText('Emergent Refugee Asylum Title'),
            text: scenarioText('Emergent Refugee Asylum Text', String(flow.amount), flow.race.name, flow.origin.name, flow.cause, choice.habitat.name),
            options: [
                { id: 'accept', label: scenarioText('Emergent Refugee Asylum Accept') },
                { id: 'redirect', label: scenarioText('Emergent Refugee Asylum Redirect') },
                { id: 'refuse', label: scenarioText('Emergent Refugee Asylum Refuse') },
            ],
            defaultOption: asylumPolicyOf(demographicsState(galaxy), choice.host) === 'closed' ? 'refuse' : 'accept',
            expiresDays: 90,
            context: { flowId: flow.id },
        });
        flow.decisionId = decision.id;
        return;
    }
    // AI host: §4 rule 1 immediately.
    if (aiAcceptsRefugeeFlow(galaxy, choice.host, flow)) acceptFlow(galaxy, flow);
    else {
        flow.excludedHosts.push(choice.habitat);
        processAsylumSelection(galaxy, flow);
    }
}

registerScenarioDecision({
    id: 'emergent.demographics.decision.asylum',
    flag: 'refugees',
    kind: 'refugees.asylum',
    resolve: (galaxy, decision, optionId) => {
        const st = demographicsState(galaxy);
        const flow = st.flows.find((f) => f.id === decision.context.flowId);
        if (flow === undefined) return;
        if (optionId === 'accept') acceptFlow(galaxy, flow);
        else if (optionId === 'redirect' && flow.destination !== null) {
            flow.excludedHosts.push(flow.destination);
            processAsylumSelection(galaxy, flow);
        } else {
            if (flow.destination !== null) flow.excludedHosts.push(flow.destination);
            processAsylumSelection(galaxy, flow);
        }
    },
    aiChoose: (galaxy, decision) => {
        void galaxy;
        return decision.defaultOption;
    },
});

/** DesignSpecificationList.GetBySubRole(subRole) (story/eventActions.ts 409 designSpecificationsGetBySubRole; copied
 * locally per the spec's "export one or copy it with a cite" note). */
function designSpecByRole(empire: Empire, subRole: BuiltObjectSubRole): DesignSpecification | null {
    for (const s of empire.designSpecifications) {
        if (s !== null && s.subRole === subRole) return s;
    }
    return null;
}

const MAX_CONVOY_SHIPS = 5;

/** Builds the physical convoy for an accepted flow (flow.destination/.host already resolved). Exported so tests can
 * force the convoy/arrival path deterministically (spec §7 "or force the unload path") without depending on
 * chooseAsylum's outcome against procedurally generated game data. */
export function acceptFlow(galaxy: Galaxy, flow: RefugeeFlow): void {
    if (flow.destination === null) {
        markStranded(galaxy, flow);
        return;
    }
    flow.stage = 'travelling';
    const destination = flow.destination;
    const origin = flow.origin;
    const specOwner = origin.empire ?? flow.originEmpire ?? galaxy.independentEmpire;
    if (specOwner === null || galaxy.independentEmpire === null) {
        markStranded(galaxy, flow);
        return;
    }
    const spec = designSpecByRole(specOwner, BuiltObjectSubRole.PassengerShip);
    const design = generateDesignFromSpec(galaxy, specOwner, spec, 3.0, galaxyStarDate(galaxy));
    if (design === null) {
        markStranded(galaxy, flow);
        return;
    }
    const st = demographicsState(galaxy);
    const independentEmpire = galaxy.independentEmpire;
    let remaining = flow.amount;
    let carriedTotal = 0;
    for (let i = 0; i < MAX_CONVOY_SHIPS && remaining > 0; i++) {
        const ship = generateNewBuiltObject(galaxy, independentEmpire, design, origin);
        // BuiltObject.populationCapacity is only known once reDefine() (generateNewBuiltObject's) has run.
        const capacity = Math.max(1, ship.populationCapacity);
        const amount = Math.min(capacity, remaining);
        remaining -= amount;
        carriedTotal += amount;
        ship.name = scenarioText('Emergent Refugee Convoy RACE', flow.race.name);
        ship.population = new PopulationList();
        ship.population.add(new Population(flow.race, amount));
        ship.population.recalculateTotalAmount();
        const missionPopulation = new PopulationList();
        missionPopulation.add(new Population(flow.race, amount));
        assignMission(galaxy, ship, BuiltObjectMissionType.Transport, origin, destination, BuiltObjectMissionPriority.Normal, { population: missionPopulation });
        st.convoys.set(ship, { flow, race: flow.race, amount });
    }
    if (carriedTotal < flow.amount) {
        // The rest is lost in transit (capped at MAX_CONVOY_SHIPS ships).
        scenarioMessage(galaxy, flow.originEmpire ?? independentEmpire, scenarioText('Emergent Refugee Convoy Title'), scenarioText('Emergent Refugee Convoy Overflow', String(flow.amount - carriedTotal), flow.race.name));
    }
    scenarioMessage(galaxy, flow.originEmpire ?? independentEmpire, scenarioText('Emergent Refugee Convoy Title'), scenarioText('Emergent Refugee Convoy Departed', String(carriedTotal), flow.race.name, origin.name, destination.name));
    if (flow.host !== null) scenarioMessage(galaxy, flow.host, scenarioText('Emergent Refugee Convoy Title'), scenarioText('Emergent Refugee Convoy Inbound', String(carriedTotal), flow.race.name, origin.name));
}

// ---------------------------------------------------------------------------------------------------------------
// §2.5/§2.6 Convoy docking hooks (missions/cmdDocking.ts, two guarded lines: cmdLoad / cmdUnload)
// ---------------------------------------------------------------------------------------------------------------

/** cmdLoad hook (BuiltObject.2.cs 3232 case Load): refugee convoys are pre-loaded (the population left the origin at
 * flow-spawn time, §2.2), so the pickup leg is a no-op — true tells the caller to complete the Load command at once
 * without touching bo.population (which would otherwise be wiped and re-filled from the origin's *current*
 * population, double-charging it and failing outright below the ported 30M floor at refugee-flow scale). */
export function refugeeConvoySkipLoad(galaxy: Galaxy, bo: BuiltObject): boolean {
    const st = demographicsState(galaxy);
    return st.convoys.has(bo);
}

/** cmdUnload hook (BuiltObject.2.cs 3698 case Unload), called with bo.population still holding the arrived items
 * (before the ported code clears them). Settles the population at `dockedAt` (or founds an independent colony there
 * when it is uncolonised — the ported Unload code silently drops population at an empty destination). */
export function settleRefugeeConvoyArrival(galaxy: Galaxy, bo: BuiltObject, dockedAt: unknown): void {
    const st = demographicsState(galaxy);
    const convoy = st.convoys.get(bo);
    if (convoy === undefined) return;
    if (!isHabitat(dockedAt)) return;
    const habitat = dockedAt;
    const items = bo.population !== null ? bo.population.items.slice() : [];
    for (const item of items) {
        if (habitat.empire === null) {
            // §2.6b: a large conquest flow headed for an uncolonised habitat, whose old owner is gone, founds a
            // government in exile instead of an independent colony (eligibility uses the flow's full amount; only
            // this ship's own share is placed here — later ships of the same convoy just add to the new capital,
            // like any other colonised destination, so the flow's total is never double-counted).
            if (!tryFoundExileEmpire(galaxy, convoy.flow, habitat)) {
                makeHabitatIntoColonyRuntime(galaxy, galaxy.independentEmpire!, habitat, galaxy.independentEmpire!, item.race, item.amount);
            } else if (habitat.empire !== null) {
                habitat.population.items.length = 0;
                habitat.population.add(new Population(item.race, item.amount));
                habitat.population.recalculateTotalAmount();
                recalculateEmpirePopulation(habitat.empire);
            }
        } else {
            const existing = habitat.population.items.find((p) => p.race === item.race);
            if (existing !== undefined) existing.unassimilatedAmount += item.amount;
        }
        const hosted = st.hosted.get(habitat.empire ?? galaxy.independentEmpire!) ?? new Map<Race, number>();
        hosted.set(item.race, (hosted.get(item.race) ?? 0) + item.amount);
        st.hosted.set(habitat.empire ?? galaxy.independentEmpire!, hosted);
        strengthenLink(galaxy, convoy.flow.origin, habitat, item.race);
    }
    convoy.flow.stage = 'settled';
    securitySlots.refugeesArrived?.(galaxy, convoy.flow.origin, habitat); // 19m: refugees can carry the creed (flag-gated)
    scenarioMessage(galaxy, convoy.flow.host ?? habitat.empire ?? galaxy.independentEmpire!, scenarioText('Emergent Refugee Convoy Title'), scenarioText('Emergent Refugee Convoy Settled', String(convoy.amount), convoy.race.name, habitat.name));
    if (convoy.amount > 100_000_000) {
        scenarioNews(galaxy, habitat.empire, scenarioText('Emergent Refugee Convoy Settled News', String(convoy.amount), convoy.race.name, habitat.name));
    }
}

function strengthenLink(galaxy: Galaxy, from: Habitat, to: Habitat, race: Race): void {
    const st = demographicsState(galaxy);
    let link = st.links.find((l) => l.from === from && l.to === to && l.race === race);
    if (link === undefined) {
        link = { from, to, race, strength: 0, lastYear: gameYear(galaxyStarDate(galaxy)) };
        st.links.push(link);
    }
    link.strength = Math.min(1, link.strength + 0.3);
    link.lastYear = gameYear(galaxyStarDate(galaxy));
}

/** A lost convoy (destroyed in transit): its share is lost. Call from wherever ship destruction is handled once a
 * combat/attrition package needs it; exported for that future hook (spec §2.5 "a destroyed convoy's share is lost"). */
export function loseRefugeeConvoy(galaxy: Galaxy, bo: BuiltObject): void {
    const st = demographicsState(galaxy);
    const convoy = st.convoys.get(bo);
    if (convoy === undefined) return;
    convoy.flow.stage = 'lost';
    st.convoys.delete(bo);
    if (convoy.amount > 100_000_000) {
        scenarioNews(galaxy, null, scenarioText('Emergent Refugee Convoy Lost News', String(convoy.amount), convoy.race.name));
    }
}

/** Periodic sweep (every 30 game days): tears down convoy ships whose flow has settled or been lost. Kept out of the
 * cmdUnload hook itself so it never mutates `bo` / `mission` while cmdDocking's own command loop is still using them. */
registerScenarioPeriodic({
    id: 'emergent.demographics.convoySweep',
    flag: 'refugees',
    periodDays: 30,
    run: (galaxy) => {
        const st = demographicsState(galaxy);
        for (const [ship, convoy] of [...st.convoys]) {
            if (convoy.flow.stage === 'settled' || convoy.flow.stage === 'lost') {
                st.convoys.delete(ship);
                if (!ship.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, ship);
            }
        }
    },
});

// ---------------------------------------------------------------------------------------------------------------
// §2.6b Government in exile
// ---------------------------------------------------------------------------------------------------------------

function empireEliminated(e: Empire): boolean {
    return !e.active || e.colonies.length === 0;
}

function tryFoundExileEmpire(galaxy: Galaxy, flow: RefugeeFlow, habitat: Habitat): boolean {
    const oldOwner = flow.cause === 'conquest' ? flow.originEmpire : null;
    if (oldOwner === null) return false;
    if (flow.amount < 500_000_000) return false;
    if (!empireEliminated(oldOwner)) return false;
    const st = demographicsState(galaxy);
    const key = oldOwner.empireId;
    if (st.exileFounded.has(key)) return false;
    if (galaxy.nextEmpireId >= galaxy.maximumEmpireCount) return false;
    const conqueror = flow.origin.empire; // whoever currently owns the origin (the conqueror), if still around
    const atWarWith = conqueror !== null && obtainDiplomaticRelation(oldOwner, conqueror).type === DiplomaticRelationType.War ? [conqueror] : [];
    const empire = createEmpireMidGame(galaxy, {
        race: flow.race,
        home: habitat,
        name: scenarioText('Emergent Exile Empire NAME', oldOwner.name),
        age: 0,
        // Empire.cs does not keep a live scalar "tech level" post-generation; approximate with the Normal start.
        // TODO(port): a closer oldOwner tech-level estimate (e.g. from completed research) if this matters in play.
        techLevel: 0.5,
        governmentId: oldOwner.governmentId,
        setup: false,
        relationBias: 0,
        atWarWith,
    });
    if (empire === null) return false;
    st.exileFounded.add(key);
    // The caller (settleRefugeeConvoyArrival) sets the capital's population from this ship's own carried amount
    // right after this returns true, so the flow's total is never double-counted across a multi-ship convoy.
    scenarioMessage(galaxy, empire, scenarioText('Emergent Exile Empire Title'), scenarioText('Emergent Exile Empire Text', oldOwner.name, habitat.name));
    scenarioNews(galaxy, null, scenarioText('Emergent Exile Empire News', oldOwner.name, empire.name, habitat.name));
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// §2.7 Demographic tension
// ---------------------------------------------------------------------------------------------------------------

function governorTraitFactor(h: Habitat): number {
    const chars = stellarObjectCharacters(h);
    if (chars === null) return 1;
    const governor = chars.find((c) => c.role === CharacterRole.ColonyGovernor);
    if (governor === undefined) return 1;
    if (governor.traits.includes(CharacterTraitType.Xenophobic)) return 1.5;
    if (governor.traits.includes(CharacterTraitType.Tolerant)) return 0.5;
    return 1;
}

function leaderTraitFactor(h: Habitat): number {
    const leader = h.empire?.leader ?? null;
    if (leader === null) return 1;
    if (leader.traits.includes(CharacterTraitType.Xenophobic)) return 1.25;
    if (leader.traits.includes(CharacterTraitType.Tolerant)) return 0.75;
    return 1;
}

/** §2.7 colonyTension(galaxy, h): T (already scaled by the governor / empire-leader trait multipliers). No Rnd. */
export function colonyTension(galaxy: Galaxy, h: Habitat): number {
    void galaxy;
    const pop = h.population;
    if (pop === null || pop.items.length < 2) return 0;
    const weights = pop.items.map((p) => p.amount + p.unassimilatedAmount); // unassimilated counts double
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return 0;
    let T = 0;
    for (let i = 0; i < pop.items.length; i++) {
        for (let j = i + 1; j < pop.items.length; j++) {
            const si = weights[i] / total;
            const sj = weights[j] / total;
            const a = resolveStandardRaceBias(pop.items[i].race, pop.items[j].race);
            const b = resolveStandardRaceBias(pop.items[j].race, pop.items[i].race);
            const avg = (a + b) / 2;
            T += si * sj * Math.max(0, -avg) / 10;
        }
    }
    return T * governorTraitFactor(h) * leaderTraitFactor(h);
}

/** The "cosmopolitan" bonus: up to +3 when every pair of races at the colony has a positive average bias. No Rnd. */
function cosmopolitanBonus(h: Habitat): number {
    const pop = h.population;
    if (pop === null || pop.items.length < 2) return 0;
    const weights = pop.items.map((p) => p.amount + p.unassimilatedAmount);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return 0;
    let bonus = 0;
    for (let i = 0; i < pop.items.length; i++) {
        for (let j = i + 1; j < pop.items.length; j++) {
            const si = weights[i] / total;
            const sj = weights[j] / total;
            const a = resolveStandardRaceBias(pop.items[i].race, pop.items[j].race);
            const b = resolveStandardRaceBias(pop.items[j].race, pop.items[i].race);
            const avg = (a + b) / 2;
            if (avg <= 0) return 0; // "when every pair's bias is > 0"
            bonus += (si * sj * avg) / 10;
        }
    }
    return Math.min(3, bonus);
}

/** The approval-term value the `empireApprovalRating` scenarioQuery adds (id `demographics.tension`, "Ethnic
 * tension"): -tensionWeight * T + the cosmopolitan bonus. Exported for the UI and for 19d1 (governor loyalty). */
export function demographicsApprovalTerm(galaxy: Galaxy, h: Habitat): number {
    const weight = scenarioParam(galaxy, 'tensionWeight', 1);
    return -weight * colonyTension(galaxy, h) + cosmopolitanBonus(h);
}

// Approval term through the mod layer's stability terms (scenario/stability.ts; the 19m ledger lists it as "tension").
registerStabilityTerm({
    id: 'demographics.tension',
    flag: 'refugees',
    cause: 'tension',
    label: 'Ethnic tension',
    run: (galaxy, habitat) => demographicsApprovalTerm(galaxy, habitat),
});

// ---------------------------------------------------------------------------------------------------------------
// §2.8/§2.9/§2.10 Yearly bookkeeping
// ---------------------------------------------------------------------------------------------------------------

function assimilationFactor(h: Habitat, race: Race): number {
    let f = 1;
    const chars = stellarObjectCharacters(h);
    const governor = chars?.find((c) => c.role === CharacterRole.ColonyGovernor);
    if (governor !== undefined) {
        if (governor.traits.includes(CharacterTraitType.Tolerant)) f *= 1.5;
        else if (governor.traits.includes(CharacterTraitType.Xenophobic)) f *= 0.5;
    }
    const dominant = h.population.dominantRace;
    if (dominant !== null && race.raceFamily === dominant.raceFamily) f *= 1.5;
    return f;
}

function reviewAssimilation(galaxy: Galaxy): void {
    const rate = scenarioParam(galaxy, 'assimilationRate', 0.1);
    for (const empire of galaxy.empires) {
        for (const h of empire.colonies) {
            if (h.population === null) continue;
            for (const item of h.population.items) {
                if (item.unassimilatedAmount <= 0) continue;
                const move = Math.trunc(item.unassimilatedAmount * rate * assimilationFactor(h, item.race));
                item.unassimilatedAmount = Math.max(0, item.unassimilatedAmount - move);
            }
        }
    }
}

function reviewLinks(galaxy: Galaxy): void {
    const st = demographicsState(galaxy);
    for (const link of st.links) link.strength -= 0.1;
    st.links = st.links.filter((l) => l.strength > 0);
}

function reviewFlowExpiry(galaxy: Galaxy): void {
    const st = demographicsState(galaxy);
    const year = gameYear(galaxyStarDate(galaxy));
    st.flows = st.flows.filter((f) => {
        if ((f.stage === 'pending' || f.stage === 'asking') && year - f.created >= 2) return false;
        return true;
    });
}

function reviewHosted(galaxy: Galaxy): void {
    const st = demographicsState(galaxy);
    st.hosted = new Map();
    for (const empire of galaxy.empires) {
        const dominant = empire.dominantRace;
        const map = new Map<Race, number>();
        for (const h of empire.colonies) {
            if (h.population === null) continue;
            for (const p of h.population.items) {
                if (p.race === dominant) continue;
                map.set(p.race, (map.get(p.race) ?? 0) + p.amount);
            }
        }
        st.hosted.set(empire, map);
    }
}

// §4.2 AI asylum policy.
function reviewAiAsylumPolicies(galaxy: Galaxy): void {
    const st = demographicsState(galaxy);
    for (const empire of galaxy.empires) {
        if (empire === galaxy.playerEmpire) continue;
        if (empire.dominantRace === null) continue;
        let warCount = 0;
        for (const other of galaxy.empires) {
            if (other === empire) continue;
            if (obtainDiplomaticRelation(empire, other).type === DiplomaticRelationType.War) warCount++;
        }
        let tensionSum = 0;
        let colonyCount = 0;
        for (const h of empire.colonies) {
            tensionSum += colonyTension(galaxy, h);
            colonyCount++;
        }
        const avgTension = colonyCount > 0 ? tensionSum / colonyCount : 0;
        let policy: AsylumPolicy;
        if (avgTension > 10 || warCount >= 2) policy = 'closed';
        else if (raceFriendlinessLevel(galaxy, empire.dominantRace) < 90) policy = 'kin';
        else policy = 'open';
        st.asylum.set(empire, policy);
    }
}

// §4.3 AI empires set the most-disliked minority race to Assimilate at high-tension colonies.
function reviewAiPopulationPolicy(galaxy: Galaxy): void {
    for (const empire of galaxy.empires) {
        if (empire === galaxy.playerEmpire) continue;
        const dominant = empire.dominantRace;
        if (dominant === null) continue;
        for (const h of empire.colonies) {
            if (colonyTension(galaxy, h) <= 15) continue;
            if (h.population === null) continue;
            let worst: Race | null = null;
            let worstBias = Infinity;
            for (const p of h.population.items) {
                if (p.race === dominant) continue;
                const bias = resolveStandardRaceBias(p.race, dominant);
                if (bias < worstBias) {
                    worstBias = bias;
                    worst = p.race;
                }
            }
            if (worst === null) continue;
            const sameFamily = worst.raceFamily === dominant.raceFamily;
            const current = sameFamily ? h.colonyPopulationPolicyRaceFamily : h.colonyPopulationPolicy;
            if (current === POLICY_ENSLAVE || current === 0 /* Assimilate */) continue;
            if (sameFamily) h.colonyPopulationPolicyRaceFamily = 0;
            else h.colonyPopulationPolicy = 0;
        }
    }
}

// §2.10 Diaspora diplomacy.
function reviewDiasporaDiplomacy(galaxy: Galaxy): void {
    const st = demographicsState(galaxy);
    for (const host of galaxy.empires) {
        const dominant = host.dominantRace;
        for (const guest of galaxy.empires) {
            if (guest === host || guest.dominantRace === null) continue;
            const race = guest.dominantRace;
            let hostedAmount = 0;
            let assimilatePolicy = true;
            let harshPolicy = false;
            for (const h of host.colonies) {
                if (h.population === null) continue;
                const p = h.population.items.find((x) => x.race === race);
                if (p === undefined || race === dominant) continue;
                hostedAmount += p.amount;
                const sameFamily = dominant !== null && race.raceFamily === dominant.raceFamily;
                const policy = sameFamily ? h.colonyPopulationPolicyRaceFamily : h.colonyPopulationPolicy;
                if (policy !== 0) assimilatePolicy = false;
                if (policy === POLICY_ENSLAVE || policy === POLICY_EXTERMINATE) harshPolicy = true;
            }
            if (hostedAmount < 100_000_000) continue;
            const key = `${empireId(host)}:${empireId(guest)}`;
            const running = st.diasporaEval.get(key) ?? 0;
            let delta = 0;
            if (harshPolicy) delta = -3;
            else if (assimilatePolicy) delta = 1;
            if (delta === 0) continue;
            const capped = Math.max(-10, Math.min(10, running + delta));
            const applied = capped - running;
            st.diasporaEval.set(key, capped);
            if (applied !== 0) {
                const evaluation = obtainEmpireEvaluation(galaxy, guest, host);
                evaluation.incidentEvaluation += applied;
            }
        }
    }
}

registerScenarioYearly({
    id: 'emergent.demographics',
    flag: 'refugees',
    order: 40,
    run: (galaxy) => {
        pollPolicyCauses(galaxy);
        reviewAssimilation(galaxy);
        reviewLinks(galaxy);
        reviewFlowExpiry(galaxy);
        reviewHosted(galaxy);
        reviewAiAsylumPolicies(galaxy);
        reviewAiPopulationPolicy(galaxy);
        reviewDiasporaDiplomacy(galaxy);
        // High-tension colony warnings (once per 5 years per colony) + dominant-race-changed notices are emitted as
        // they occur (see checkTensionWarning / dominant-race tracking below), not here.
        checkTensionWarnings(galaxy);
    },
});

// ---------------------------------------------------------------------------------------------------------------
// §5 Messages that need per-tick tracking (tension warning cadence, dominant-race change)
// ---------------------------------------------------------------------------------------------------------------

const lastTensionWarningYear = new WeakMap<Habitat, number>();
const lastKnownDominantRace = new WeakMap<Habitat, Race | null>();

function checkTensionWarnings(galaxy: Galaxy): void {
    const year = gameYear(galaxyStarDate(galaxy));
    for (const empire of galaxy.empires) {
        for (const h of empire.colonies) {
            const t = colonyTension(galaxy, h);
            if (t > 15) {
                const last = lastTensionWarningYear.get(h);
                if (last === undefined || year - last >= 5) {
                    lastTensionWarningYear.set(h, year);
                    scenarioMessage(galaxy, empire, scenarioText('Emergent Demographics Tension Title'), scenarioText('Emergent Demographics Tension Text', h.name), { type: EmpireMessageType.GeneralWarning, subject: h });
                }
            }
            const dominant = h.population?.dominantRace ?? null;
            const known = lastKnownDominantRace.get(h);
            if (known !== undefined && known !== dominant && dominant !== null) {
                scenarioMessage(galaxy, empire, scenarioText('Emergent Demographics Dominant Race Title'), scenarioText('Emergent Demographics Dominant Race Text', h.name, dominant.name), { type: EmpireMessageType.GeneralNeutralEvent, subject: h });
            }
            lastKnownDominantRace.set(h, dominant);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// §4 AI rules
// ---------------------------------------------------------------------------------------------------------------

/** §4.1: an AI host accepts a flow when the dominant-race bias is non-negative and the flow is < 25% of the
 * destination's population; never when at war with the flow's origin owner. No Rnd. */
export function aiAcceptsRefugeeFlow(galaxy: Galaxy, host: Empire, flow: RefugeeFlow): boolean {
    if (flow.originEmpire !== null && obtainDiplomaticRelation(host, flow.originEmpire).type === DiplomaticRelationType.War) return false;
    if (resolveStandardRaceBias(host.dominantRace, flow.race) < 0) return false;
    const destPop = flow.destination?.population?.totalAmount ?? 0;
    if (destPop > 0 && flow.amount >= destPop * 0.25) return false;
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// §5 Player-facing: standing asylum policy
// ---------------------------------------------------------------------------------------------------------------

/** Empire Policy screen `// [emergent]` action: sets the player's (or any empire's) standing asylum policy. Default
 * for the player is 'kin' (asylumPolicyOf's fallback), matching the spec. */
export function setAsylumPolicy(galaxy: Galaxy, empire: Empire, policy: AsylumPolicy): void {
    demographicsState(galaxy).asylum.set(empire, policy);
}

export function getAsylumPolicy(galaxy: Galaxy, empire: Empire): AsylumPolicy {
    return asylumPolicyOf(demographicsState(galaxy), empire);
}

// ---------------------------------------------------------------------------------------------------------------
// §2.9 Chain migration (civilianAI.ts determineMigrationDestinations / determineMigrationSources, two guarded lines)
// ---------------------------------------------------------------------------------------------------------------

/** Adds each migration-link destination owned by `empire` to its migration-destination list, priority
 * trunc(link.strength * 1000) (so passenger ships favour moving that race along the link). No Rnd. */
export function addChainMigrationDestinations(galaxy: Galaxy, empire: Empire, list: PrioritizedTarget[]): void {
    if (!scenarioFlag(galaxy, 'refugees')) return;
    const st = demographicsState(galaxy);
    for (const link of st.links) {
        if (link.to.empire !== empire) continue;
        prioritizedTargetListAdd(list, new PrioritizedTarget(link.to, Math.trunc(link.strength * 1000)));
    }
}

/** Adds a foreign migration-link origin to `empire`'s migration sources even when its migrationFactor >= 0, while
 * strength > 0.5 and the relation allows migration (not war / trade sanctions). No Rnd. */
export function addChainMigrationSources(galaxy: Galaxy, empire: Empire, list: PrioritizedTarget[]): void {
    if (!scenarioFlag(galaxy, 'refugees')) return;
    const st = demographicsState(galaxy);
    for (const link of st.links) {
        if (link.strength <= 0.5) continue;
        const origin = link.from;
        if (origin.empire === null || origin.empire === empire) continue;
        const relation = obtainDiplomaticRelation(empire, origin.empire);
        if (relation.type === DiplomaticRelationType.War || relation.type === DiplomaticRelationType.TradeSanctions) continue;
        prioritizedTargetListAdd(list, new PrioritizedTarget(origin, Math.trunc(origin.migrationFactor * 1000)));
    }
}

/** Test accessor for §2.6b (government in exile): same check settleRefugeeConvoyArrival runs on first arrival. */
export function tryFoundExileEmpireForFlow(galaxy: Galaxy, flow: RefugeeFlow, habitat: Habitat): boolean {
    return tryFoundExileEmpire(galaxy, flow, habitat);
}
