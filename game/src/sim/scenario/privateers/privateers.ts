// Private-sector privateers (scenarios/privateers, flag privateers). Not a port.
//
// The private economy of every empire (the player's and the AI's; never pirates, the independents or an empire whose
// government nationalises the private sector — its "private" money is the state treasury) builds and runs its own small
// armed ships:
//   - Who pays: private money only (Empire.PrivateMoney, the pot that funds private freighters). The build goes through
//     the same steps as civilianAI.ts directPrivateConstruction (yard pick, construction queue, AddBuiltObjectToGalaxy as
//     a private object, the yard's income record, component orders, PerformPrivateTransaction); the ship sits in
//     Empire.PrivateBuiltObjects, so its upkeep is private maintenance like any freighter's. The state is never charged.
//   - Design: placed by the stock PlaceComponentsOnDesign (designPlacement.ts) from the empire's own escort / frigate /
//     destroyer template, with a size cap of PRIVATEER_RULES.sizeCapShare × MaximumConstructionSize and a research view
//     whose "best component" of every type is the previous component of that type the empire has researched (one tech
//     tier below), except engines (main thrust, vectoring), hyperdrives and reactors (the empire's best). The design is
//     never added to Empire.Designs (not in the design list, never picked by the state AI or retrofits) and is named
//     "Privateer <class>".
//   - When: only while the empire's private ships / bases have recently been attacked by pirates (the builtObjectAttacked
//     event, NotifyOfAttack), within a yearly spending cap (build + upkeep ≤ spendShare × private income) and a count cap
//     (one per shipsPerPrivateer private ships and bases). Extras retire when the threat has been quiet for a long time
//     or private money runs short.
//   - Behaviour: fully automated (privateShipMission event in place of the stock military assignment): engage a recent
//     raider near private assets, guard threatened private mining stations, escort private freighters on the busiest
//     routes, flee (Escape) from much stronger attackers. Missions are the stock Attack / Patrol / Escort / Escape.
//   - The state AI's planning ignores them: they are private (force structure, MilitaryPotency and the fleets only read
//     Empire.BuiltObjects) and the Smarter AI local-threat sum skips them (isPrivateer). In combat they are real ships.
//
// Rnd: none. The design placement gets a no-draw rnd (escort-to-destroyer placements never draw anyway), names are
// counters, every pick is by score with id tie-breaks. With the flag off nothing here runs.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { empireGovernmentAttributes } from '../../empire';
import { BuiltObject } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { Design, BuiltObjectStance } from '../../design';
import { BattleTactics, BuiltObjectFleeWhen, BuiltObjectRole, DesignSpecificationComponentRuleType, InvasionTactics, type DesignSpecification } from '../../data/designSpecifications';
import { ComponentType } from '../../data/components';
import { ComponentCategoryType } from '../../data/policies';
import type { ComponentDefinition } from '../../componentStatic';
import { generateOrderedComponentImprovementList } from '../../componentStatic';
import type { ResearchSystem } from '../../researchSystem';
import { placeComponentsOnDesignSized, type DesignTrimFamily } from '../../designPlacement';
import { canBuildDesign, componentDefinitionsStatic, findNewestCanBuild, placementView, resolveSubRoleDescription } from '../../designGeneration';
import { MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS, findShortestConstructionWaitQueue, getPrivateAnnualCashflow } from '../../civilianAI';
import { assignScrapMission, designCalculateMaintenanceCosts, procureConstructionComponentsAtBuiltObject } from '../../construction/empireConstruction';
import type { ConstructionQueue } from '../../construction/constructionQueue';
import { getPrivateAnnualRevenue, getPrivateFunds } from '../../forceStructure';
import { performPrivateTransaction } from '../../treasury';
import { performFinancialTransaction } from '../../logistics/contracts';
import { OrderType, empireCreateOrder } from '../../logistics/orders';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, isBuiltObject } from '../../missions/mission';
import { assignMission } from '../../missions/assign';
import { withinFuelRangeAndRefuel } from '../../movement';
import { calculateOverallStrengthFactor } from '../../combat/threats';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';

export const PRIVATEERS_FLAG = 'privateers';
export const PRIVATEERS_STATE_KEY = 'privateers';

/** Every tuning constant of the add-on (the three caps can be overridden by the scenario params). */
export const PRIVATEER_RULES = {
    /** Largest privateer: this share of Empire.MaximumConstructionSize (military). Param privateersSizeCap (%). */
    sizeCapShare: 0.4,
    /** Build + upkeep per year: at most this share of the private income. Param privateersSpendShare (%). */
    spendShare: 0.18,
    /** One privateer per this many private ships and bases (privateers not counted). Param privateersShipsPer. */
    shipsPerPrivateer: 8,
    /** Privateer upkeep is at most this share of the private sector's spare cashflow (before privateer upkeep). */
    cashflowShare: 0.25,
    /** A privateer build never spends more than this share of the private money on hand. */
    fundsShare: 0.5,
    /** An attack on a private ship / base this recent makes the empire build (days). */
    recentDays: 180,
    /** Incidents this recent send privateers after the raider (days). */
    responseDays: 60,
    /** Quiet this long (no incident) → retire down to quietKeepShare of the count cap (days). */
    quietDays: 720,
    quietKeepShare: 0.25,
    /** Hysteresis: upkeep above spendShare × income × this retires one privateer per review. */
    overspendRetire: 1.25,
    /** Repeated attacks on one victim within this many days are one incident. */
    incidentMergeDays: 10,
    /** Incidents kept per empire (newest). */
    incidentsKept: 24,
    /** Engage only when the privateers sent have at least this share of the raider's strength. */
    engageStrengthRatio: 0.6,
    /** Flee (Escape) from an attacker at least this many times stronger than the privateer. */
    fleeStrengthRatio: 2.5,
    /** A station / freighter counts an incident within this distance as near it. */
    nearDistance: 60000,
    /** Privateers per guarded station at most. */
    guardsPerStation: 2,
    /** Review period (game days): build, retire, reassign. */
    reviewDays: 30,
    /** The privateer design is re-placed at most once per this many days (and when the cap or tech changes). */
    designReviewDays: 180,
    /** Template scales tried in turn until the placed design fits the size cap. */
    templateScales: [1, 0.75, 0.6, 0.45, 0.33, 0.25] as readonly number[],
    /** The stock trim pass's removal order for privateers: armour, shields and extra engines go before the weapons. */
    trimOrder: ['gasExtractor', 'mineExtractor', 'luxuryExtractor', 'troop', 'passenger', 'fighterBay', 'armor', 'energyCollector', 'engine', 'shields', 'torpedo', 'beam'] as readonly DesignTrimFamily[],
};

/** One attack on a private ship / base by pirates (plain data + graph refs, saved with the game). */
export interface PrivateerIncident {
    date: number;
    x: number;
    y: number;
    victimId: number;
    attacker: BuiltObject | null;
}

export interface PrivateerEmpireState {
    incidents: PrivateerIncident[];
    lastIncident: number;
    builds: { date: number; cost: number }[];
    design: Design | null;
    designDate: number;
    designCap: number;
    serial: number;
    built: number;
    retired: number;
}

/** galaxy.scenario.state.privateers. */
export interface PrivateersState {
    /** Per empire id. */
    empires: Record<string, PrivateerEmpireState>;
    /** Every privateer design ever made (the ships keep theirs). */
    designs: Design[];
}

function privateersState(galaxy: Galaxy): PrivateersState {
    return scenarioState<PrivateersState>(galaxy, PRIVATEERS_STATE_KEY, () => ({ empires: {}, designs: [] }));
}

function empireState(galaxy: Galaxy, empire: Empire): PrivateerEmpireState {
    const s = privateersState(galaxy);
    const k = String(empire.empireId);
    let e = s.empires[k];
    if (e === undefined) {
        e = { incidents: [], lastIncident: -1, builds: [], design: null, designDate: -1, designCap: 0, serial: 0, built: 0, retired: 0 };
        s.empires[k] = e;
    }
    return e;
}

function rule(galaxy: Galaxy): { sizeCapShare: number; spendShare: number; shipsPerPrivateer: number } {
    return {
        sizeCapShare: scenarioParam(galaxy, 'privateersSizeCap', PRIVATEER_RULES.sizeCapShare * 100) / 100,
        spendShare: scenarioParam(galaxy, 'privateersSpendShare', PRIVATEER_RULES.spendShare * 100) / 100,
        shipsPerPrivateer: Math.max(1, scenarioParam(galaxy, 'privateersShipsPer', PRIVATEER_RULES.shipsPerPrivateer)),
    };
}

const days = (n: number): number => n * GAME_DAY_LENGTH;

// --- Who ---------------------------------------------------------------------------------------------------------

/** An empire whose private sector runs privateers: active, not a pirate faction / the independents, private money of its own. */
export function isPrivateerEmpire(galaxy: Galaxy, empire: Empire | null): empire is Empire {
    if (empire === null || !empire.active || empire === galaxy.independentEmpire || empire.pirateEmpireBaseHabitat !== null) return false;
    const gov = empireGovernmentAttributes(empire);
    return !(gov !== null && gov.specialFunctionCode === 1);
}

/** True for a privateer: a private ship (Owner null) of a privateer design. False with the add-on off. */
export function isPrivateer(galaxy: Galaxy, bo: BuiltObject | null | undefined): boolean {
    if (bo == null || bo.owner !== null || bo.design === null || !scenarioFlag(galaxy, PRIVATEERS_FLAG)) return false;
    const s = galaxy.scenario!.state[PRIVATEERS_STATE_KEY] as PrivateersState | undefined;
    return s !== undefined && s.designs.includes(bo.design);
}

/** The empire's privateers (alive, under construction included), in PrivateBuiltObjects order. */
export function empirePrivateers(galaxy: Galaxy, empire: Empire): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const bo of empire.privateBuiltObjects as BuiltObject[]) if (bo != null && !bo.hasBeenDestroyed && isPrivateer(galaxy, bo)) out.push(bo);
    return out;
}

function isPirateEmpire(galaxy: Galaxy, e: Empire | null): boolean {
    return e !== null && (e.pirateEmpireBaseHabitat !== null || galaxy.pirateEmpires.includes(e));
}

// --- Threat signal (NotifyOfAttack) -----------------------------------------------------------------------------------

function onBuiltObjectAttacked(galaxy: Galaxy, p: { builtObject: BuiltObject; attacker: unknown; attackingEmpire: Empire | null }): void {
    const victim = p.builtObject;
    const empire = victim.empire;
    if (victim.owner !== null || !isPrivateerEmpire(galaxy, empire) || !isPirateEmpire(galaxy, p.attackingEmpire)) return;
    const attacker = isBuiltObject(p.attacker) ? p.attacker : null;
    if (isPrivateer(galaxy, victim)) {
        // Flee from a much stronger attacker (the stock Escape mission, as threats.ts sends smugglers off).
        if (attacker !== null && victim.builtAt === null) maybeFlee(galaxy, victim, attacker);
        return;
    }
    const st = empireState(galaxy, empire);
    const now = galaxyStarDate(galaxy);
    st.lastIncident = now;
    for (const inc of st.incidents) {
        if (inc.victimId === victim.builtObjectID && now - inc.date <= days(PRIVATEER_RULES.incidentMergeDays)) {
            inc.date = now;
            inc.x = victim.xpos;
            inc.y = victim.ypos;
            if (attacker !== null) inc.attacker = attacker;
            return;
        }
    }
    st.incidents.push({ date: now, x: victim.xpos, y: victim.ypos, victimId: victim.builtObjectID, attacker });
    if (st.incidents.length > PRIVATEER_RULES.incidentsKept) st.incidents.splice(0, st.incidents.length - PRIVATEER_RULES.incidentsKept);
}

function maybeFlee(galaxy: Galaxy, ship: BuiltObject, attacker: BuiltObject): void {
    const m = builtObjectMission(ship.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Escape) return;
    const ours = Math.max(1, calculateOverallStrengthFactor(ship));
    if (calculateOverallStrengthFactor(attacker) < PRIVATEER_RULES.fleeStrengthRatio * ours) return;
    assignMission(galaxy, ship, BuiltObjectMissionType.Escape, attacker, null, BuiltObjectMissionPriority.High);
}

function recentIncidents(galaxy: Galaxy, st: PrivateerEmpireState, withinDays: number): PrivateerIncident[] {
    const now = galaxyStarDate(galaxy);
    return st.incidents.filter((i) => now - i.date <= days(withinDays));
}

// --- Design -------------------------------------------------------------------------------------------------------

/** Types that keep the empire's best component (engines, hyperdrives, reactors). */
const BEST_TECH_TYPES: ReadonlySet<ComponentType> = new Set([ComponentType.EngineMainThrust, ComponentType.EngineVectoring, ComponentType.HyperDrive, ComponentType.Reactor]);

/** The previous researched component of `best`'s type (lower tech level, best of those by the stock metric); `best` when there is none. */
export function previousTierComponent(research: ResearchSystem, best: ComponentDefinition | null): ComponentDefinition | null {
    if (best === null || BEST_TECH_TYPES.has(best.type)) return best;
    const older = research.researchedComponents.filter((c) => c.type === best.type && c.componentId !== best.componentId && c.techLevel < best.techLevel);
    if (older.length === 0) return best;
    return research.determineBestComponentAmong(best.type, older) ?? best;
}

/**
 * A view of `research` whose desired component of each type / category is one tier below (previousTierComponent).
 * Everything else reads through to the empire's research (improvement levels, researched set, ordered lists).
 */
export function tierDownResearch(research: ResearchSystem): ResearchSystem {
    const view = Object.create(research) as ResearchSystem;
    const proto = Object.getPrototypeOf(research) as ResearchSystem;
    view.evaluateDesiredComponent = (type, focus, preferLatest = false) => previousTierComponent(research, proto.evaluateDesiredComponent.call(research, type, focus, preferLatest));
    view.evaluateDesiredComponentByCategory = (category, focus, preferLatest = false) => previousTierComponent(research, proto.evaluateDesiredComponentByCategory.call(research, category, focus, preferLatest));
    return view;
}

const NO_RND = { next: (lo: number): number => lo };

/** The template with every wanted amount scaled by `f` (at least 1 of each wanted component; MustNotHave / ShouldNotHave kept). */
function scaleTemplate(spec: DesignSpecification, f: number): DesignSpecification {
    if (f >= 1) return spec;
    return {
        ...spec,
        componentRules: spec.componentRules.map((r) =>
            r.componentRuleType === DesignSpecificationComponentRuleType.MustHave || r.componentRuleType === DesignSpecificationComponentRuleType.ShouldHave ? { ...r, amount: Math.max(1, Math.round(r.amount * f)) } : r,
        ),
    };
}

/** The size cap of the empire's privateers. */
export function privateerSizeCap(galaxy: Galaxy, empire: Empire): number {
    return Math.trunc(empire.maximumConstructionSize(BuiltObjectSubRole.Escort) * rule(galaxy).sizeCapShare);
}

/** The class the privateer is placed from: a destroyer when the empire's destroyer fits the cap, else a frigate that fits, else an escort. */
function privateerSubRole(empire: Empire, cap: number): BuiltObjectSubRole {
    const designs = empire.designs as Design[];
    for (const sr of [BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate]) {
        const d = findNewestCanBuild(designs, sr, empire, null, false);
        if (d !== null && d.size > 0 && d.size <= cap && empire.componentsAvailable[sr]) return sr;
    }
    return BuiltObjectSubRole.Escort;
}

/** Places a privateer design for `empire` (the stock pipeline, tier-down research, size cap). Null when none can be made. No Rnd. */
export function generatePrivateerDesign(galaxy: Galaxy, empire: Empire): Design | null {
    const cap = privateerSizeCap(galaxy, empire);
    if (cap <= 0) return null;
    const tryRole = (subRole: BuiltObjectSubRole): Design | null => {
        const spec = (empire.designSpecifications.find((s) => s != null && s.subRole === subRole) ?? null) as DesignSpecification | null;
        if (spec === null || !empire.componentsAvailable[subRole]) return null;
        const torpedoes = generateOrderedComponentImprovementList(componentDefinitionsStatic(galaxy), ComponentCategoryType.WeaponTorpedo, 1);
        // The stock trim pass stops at the template's essentials, so the template is scaled down until the design fits.
        for (const f of PRIVATEER_RULES.templateScales) {
            const view = { ...placementView(empire, galaxy), research: tierDownResearch(empire.research), rnd: NO_RND };
            const d = new Design(`Privateer ${resolveSubRoleDescription(subRole)}`);
            d.role = spec.role;
            d.subRole = spec.subRole;
            d.imageScalingType = spec.imageScalingMode;
            d.imageScalingFactor = spec.imageScalingFactor;
            const scaled = scaleTemplate(spec, f);
            const placed = placeComponentsOnDesignSized(view, d, scaled, torpedoes, cap, empire.maximumConstructionSizeBase(subRole), null, { spec: scaled, scaleShare: 0, trimOrder: PRIVATEER_RULES.trimOrder });
            if (placed === null) continue;
            placed.name = d.name;
            placed.role = spec.role;
            placed.subRole = spec.subRole;
            placed.reDefine();
            placed.size = placed.quickCalculateSize();
            if (placed.size > cap || placed.firepowerRaw <= 0 || placed.topSpeed <= 0 || !canBuildDesign(empire, placed)) continue;
            placed.stance = BuiltObjectStance.AttackEnemies;
            placed.fleeWhen = BuiltObjectFleeWhen.Shields50;
            placed.tacticsStrongerShips = BattleTactics.Evade;
            placed.tacticsWeakerShips = BattleTactics.AllWeapons;
            placed.tacticsInvasion = InvasionTactics.DoNotInvade;
            placed.empire = empire;
            placed.allowAutoRetrofit = false;
            const stock = findNewestCanBuild(empire.designs as Design[], subRole, empire, null, false);
            placed.pictureRef = stock !== null ? stock.pictureRef : 0;
            placed.dateCreated = galaxyStarDate(galaxy);
            return placed;
        }
        return null;
    };
    const first = privateerSubRole(empire, cap);
    return tryRole(first) ?? (first !== BuiltObjectSubRole.Escort ? tryRole(BuiltObjectSubRole.Escort) : null);
}

/** The empire's current privateer design (re-placed when stale, when the cap changed, or when the components changed). */
function currentDesign(galaxy: Galaxy, empire: Empire, st: PrivateerEmpireState): Design | null {
    const now = galaxyStarDate(galaxy);
    const cap = privateerSizeCap(galaxy, empire);
    const fresh = st.design !== null && st.designCap === cap && now - st.designDate < days(PRIVATEER_RULES.designReviewDays);
    if (fresh) return st.design;
    st.designDate = now;
    st.designCap = cap;
    const d = generatePrivateerDesign(galaxy, empire);
    if (d === null) return st.design;
    if (st.design !== null && d.isEquivalent(st.design)) return st.design;
    privateersState(galaxy).designs.push(d);
    st.design = d;
    return d;
}

// --- Build / retire ------------------------------------------------------------------------------------------------

/** The private sector's ships and bases the count cap is per (privateers not counted). */
function privateAssetCount(galaxy: Galaxy, empire: Empire): number {
    let n = 0;
    for (const bo of empire.privateBuiltObjects as BuiltObject[]) if (bo != null && !bo.hasBeenDestroyed && !isPrivateer(galaxy, bo)) n++;
    return n;
}

function annualUpkeep(list: readonly BuiltObject[]): number {
    let n = 0;
    for (const bo of list) n += bo.annualSupportCost;
    return n;
}

/** Builds one privateer at the shortest private yard queue (directPrivateConstruction's steps). True when queued. */
function buildPrivateer(galaxy: Galaxy, empire: Empire, st: PrivateerEmpireState, design: Design, price: number): boolean {
    st.serial++;
    const bo = new BuiltObject(design, `${design.name} ${st.serial}`, galaxy);
    bo.purchasePrice = price;
    const found = findShortestConstructionWaitQueue(galaxy, empire.spacePorts, bo);
    const yard = found.yard;
    if (yard === null || found.shortestWaitQueueTime / REAL_SECONDS_IN_GALACTIC_YEAR >= MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS) {
        st.serial--;
        return false;
    }
    const queue = yard.constructionQueue as ConstructionQueue | null;
    if (queue === null || !queue.addBuiltObjectToConstruct(bo)) {
        st.serial--;
        return false;
    }
    design.buildCount++;
    bo.suppressAutoRetrofit = true;
    empire.addBuiltObjectToGalaxy(bo, yard, false, false);
    const now = galaxyStarDate(galaxy);
    performFinancialTransaction(yard, price, now, false);
    bo.builtAt = yard;
    const cargo = procureConstructionComponentsAtBuiltObject(galaxy, empire, bo, yard, true);
    for (const item of cargo.items) empireCreateOrder(galaxy, empire, yard, item.commodity, item.amount, false, OrderType.ConstructionShortage);
    performPrivateTransaction(empire, -price);
    st.builds.push({ date: now, cost: price });
    st.built++;
    return true;
}

function retire(galaxy: Galaxy, empire: Empire, st: PrivateerEmpireState, ship: BuiltObject): void {
    st.retired++;
    ship.retireForNextMission = true;
    const m = builtObjectMission(ship.mission);
    if (ship.builtAt === null && (m === null || m.priority <= BuiltObjectMissionPriority.Normal) && assignScrapMission(galaxy, empire, ship)) ship.retireForNextMission = false;
}

function reviewEmpire(galaxy: Galaxy, empire: Empire): void {
    const st = empireState(galaxy, empire);
    const now = galaxyStarDate(galaxy);
    const r = rule(galaxy);
    st.builds = st.builds.filter((b) => now - b.date < days(360));
    st.incidents = st.incidents.filter((i) => now - i.date < days(360) && (i.attacker === null || !i.attacker.hasBeenDestroyed || now - i.date < days(PRIVATEER_RULES.responseDays)));
    const privateers = empirePrivateers(galaxy, empire);
    const active = privateers.filter((b) => !b.retireForNextMission);
    const income = Math.max(0, getPrivateAnnualRevenue(galaxy, empire));
    const budget = r.spendShare * income;
    const upkeep = annualUpkeep(active);
    const spent = st.builds.reduce((a, b) => a + b.cost, 0);
    const countCap = Math.floor(privateAssetCount(galaxy, empire) / r.shipsPerPrivateer);
    const recent = recentIncidents(galaxy, st, PRIVATEER_RULES.recentDays);
    const quiet = st.lastIncident < 0 || now - st.lastIncident > days(PRIVATEER_RULES.quietDays);
    // Retire: money short (private funds negative, or upkeep well over the yearly budget) or a long quiet (down to the keep share).
    const oldest = (): BuiltObject | null => {
        let best: BuiltObject | null = null;
        for (const b of active) if (best === null || b.dateBuilt < best.dateBuilt || (b.dateBuilt === best.dateBuilt && b.builtObjectID < best.builtObjectID)) best = b;
        return best;
    };
    const keep = quiet ? Math.floor(countCap * PRIVATEER_RULES.quietKeepShare) : countCap;
    if (active.length > 0 && (getPrivateFunds(empire) < 0 || getPrivateAnnualCashflow(galaxy, empire) < 0 || upkeep > budget * PRIVATEER_RULES.overspendRetire || active.length > keep)) {
        const o = oldest();
        if (o !== null) retire(galaxy, empire, st, o);
        return;
    }
    // Build: a recent incident, under the count cap, within the yearly budget and the money on hand.
    if (recent.length === 0 || active.length >= Math.min(countCap, 1 + recent.length)) return;
    const design = currentDesign(galaxy, empire, st);
    if (design === null) return;
    const price = design.calculateCurrentPurchasePrice(galaxy);
    const maint = designCalculateMaintenanceCosts(galaxy, design, empire);
    if (upkeep + maint + spent + price > budget) return;
    if (price > getPrivateFunds(empire) * PRIVATEER_RULES.fundsShare) return;
    // Keep the freighter economy fed: privateer upkeep never takes more than cashflowShare of the private sector's spare
    // cashflow (the gate DirectPrivateConstruction builds freighters and mining ships against).
    const spare = getPrivateAnnualCashflow(galaxy, empire);
    if (spare - maint <= 0 || upkeep + maint > PRIVATEER_RULES.cashflowShare * (spare + upkeep)) return;
    buildPrivateer(galaxy, empire, st, design, price);
}

// --- Missions -----------------------------------------------------------------------------------------------------

const dist2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

function missionTargetOf(bo: BuiltObject): unknown {
    const m = builtObjectMission(bo.mission);
    return m === null ? null : m.target;
}

function privateerCountOn(privateers: readonly BuiltObject[], target: unknown, self: BuiltObject): number {
    let n = 0;
    for (const p of privateers) if (p !== self && missionTargetOf(p) === target) n++;
    return n;
}

function privateerStrengthOn(privateers: readonly BuiltObject[], target: unknown, self: BuiltObject): number {
    let n = 0;
    for (const p of privateers) if (p !== self && missionTargetOf(p) === target) n += calculateOverallStrengthFactor(p);
    return n;
}

interface PrivateerOrder {
    type: BuiltObjectMissionType;
    target: BuiltObject;
    priority: BuiltObjectMissionPriority;
}

/** The privateer's best task now (no Rnd): engage a recent raider, guard a threatened station, escort a busy freighter, or patrol a home port. */
function choosePrivateerOrder(galaxy: Galaxy, empire: Empire, ship: BuiltObject, privateers: readonly BuiltObject[]): PrivateerOrder | null {
    const st = empireState(galaxy, empire);
    const ours = Math.max(1, calculateOverallStrengthFactor(ship));
    const reach = (x: number, y: number): boolean => withinFuelRangeAndRefuel(galaxy, ship, x, y, 0.1);
    const near = PRIVATEER_RULES.nearDistance * PRIVATEER_RULES.nearDistance;
    // 1. Engage: the raider of a recent incident, alive, not much stronger than what is sent, closest first.
    const recent = recentIncidents(galaxy, st, PRIVATEER_RULES.responseDays);
    let best: BuiltObject | null = null;
    let bestD = Infinity;
    for (const inc of recent) {
        const a = inc.attacker;
        if (a === null || a.hasBeenDestroyed || !isPirateEmpire(galaxy, a.empire) || a.role !== BuiltObjectRole.Military) continue;
        const sent = ours + privateerStrengthOn(privateers, a, ship);
        if (sent < PRIVATEER_RULES.engageStrengthRatio * calculateOverallStrengthFactor(a)) continue;
        const d = dist2(ship.xpos, ship.ypos, a.xpos, a.ypos);
        if ((d < bestD || (d === bestD && best !== null && a.builtObjectID < best.builtObjectID)) && reach(a.xpos, a.ypos)) {
            best = a;
            bestD = d;
        }
    }
    if (best !== null) return { type: BuiltObjectMissionType.Attack, target: best, priority: BuiltObjectMissionPriority.Normal };
    // 2. Guard: private mining stations with a recent incident near them or a known pirate base nearby.
    const threatAt = (x: number, y: number): number => {
        let n = 0;
        for (const inc of recentIncidents(galaxy, st, PRIVATEER_RULES.recentDays)) if (dist2(x, y, inc.x, inc.y) <= near) n++;
        for (const pb of empire.knownPirateBases) if (pb != null && !pb.hasBeenDestroyed && dist2(x, y, pb.xpos, pb.ypos) <= near * 4) n++;
        return n;
    };
    let guard: BuiltObject | null = null;
    let guardScore = 0;
    for (const s of empire.miningStations) {
        if (s == null || s.hasBeenDestroyed || s.owner !== null || s.empire !== empire) continue;
        if (privateerCountOn(privateers, s, ship) >= PRIVATEER_RULES.guardsPerStation) continue;
        const t = threatAt(s.xpos, s.ypos);
        if (t <= 0) continue;
        const score = t * 1e12 - dist2(ship.xpos, ship.ypos, s.xpos, s.ypos) / 1e6;
        if ((guard === null || score > guardScore || (score === guardScore && s.builtObjectID < guard.builtObjectID)) && reach(s.xpos, s.ypos)) {
            guard = s;
            guardScore = score;
        }
    }
    if (guard !== null) return { type: BuiltObjectMissionType.Patrol, target: guard, priority: BuiltObjectMissionPriority.Low };
    // 3. Escort: an unescorted private freighter under way, on the busiest route (destination shared by most freighters),
    //    threatened routes first.
    const freighters: BuiltObject[] = [];
    const byDest = new Map<unknown, number>();
    for (const f of empire.privateBuiltObjects as BuiltObject[]) {
        if (f == null || f.hasBeenDestroyed || f.role !== BuiltObjectRole.Freight || f.builtAt !== null) continue;
        const m = builtObjectMission(f.mission);
        if (m === null || m.type !== BuiltObjectMissionType.Transport || m.target === null) continue;
        freighters.push(f);
        byDest.set(m.target, (byDest.get(m.target) ?? 0) + 1);
    }
    let escort: BuiltObject | null = null;
    let escortScore = -Infinity;
    for (const f of freighters) {
        if (privateerCountOn(privateers, f, ship) > 0) continue;
        if (ship.warpSpeed <= 0 && f.warpSpeed > 0) continue;
        const busy = byDest.get(builtObjectMission(f.mission)!.target) ?? 0;
        const score = (busy + 5 * threatAt(f.xpos, f.ypos)) * 1e12 - dist2(ship.xpos, ship.ypos, f.xpos, f.ypos) / 1e6;
        if ((escort === null || score > escortScore || (score === escortScore && f.builtObjectID < escort.builtObjectID)) && reach(f.xpos, f.ypos)) {
            escort = f;
            escortScore = score;
        }
    }
    if (escort !== null && escortScore >= 2e12) return { type: BuiltObjectMissionType.Escort, target: escort, priority: BuiltObjectMissionPriority.Normal };
    // 4. Otherwise patrol the nearest space port of the empire.
    let port: BuiltObject | null = null;
    let portD = Infinity;
    for (const sp of empire.spacePorts) {
        if (sp == null || sp.hasBeenDestroyed) continue;
        const d = dist2(ship.xpos, ship.ypos, sp.xpos, sp.ypos);
        if (d < portD) {
            port = sp;
            portD = d;
        }
    }
    if (port !== null) return { type: BuiltObjectMissionType.Patrol, target: port, priority: BuiltObjectMissionPriority.Low };
    if (escort !== null) return { type: BuiltObjectMissionType.Escort, target: escort, priority: BuiltObjectMissionPriority.Normal };
    return null;
}

function applyOrder(galaxy: Galaxy, ship: BuiltObject, o: PrivateerOrder | null): void {
    if (o === null) return;
    const m = builtObjectMission(ship.mission);
    if (m !== null && m.type === o.type && m.target === o.target) return;
    assignMission(galaxy, ship, o.type, o.target, null, o.priority);
    if (o.type === BuiltObjectMissionType.Escort || o.type === BuiltObjectMissionType.Patrol) o.target.currentEscortForceAssigned += ship.firepowerRaw;
}

function onPrivateShipMission(galaxy: Galaxy, p: { empire: Empire; ship: BuiltObject; handled: boolean }): void {
    if (!isPrivateer(galaxy, p.ship)) return;
    p.handled = true;
    if (p.ship.empire !== p.empire || !isPrivateerEmpire(galaxy, p.empire)) return;
    applyOrder(galaxy, p.ship, choosePrivateerOrder(galaxy, p.empire, p.ship, empirePrivateers(galaxy, p.empire)));
}

/** The periodic re-think of privateers on routine work: a better task replaces a low-priority one. */
function reassignEmpire(galaxy: Galaxy, empire: Empire): void {
    const privateers = empirePrivateers(galaxy, empire);
    for (const ship of privateers) {
        if (ship.builtAt !== null || ship.retireForNextMission || ship.topSpeed <= 0) continue;
        const m = builtObjectMission(ship.mission);
        if (m === null || m.type === BuiltObjectMissionType.Undefined) continue; // the stock assignShipMissions pass asks the event
        const routine = m.type === BuiltObjectMissionType.Patrol || m.type === BuiltObjectMissionType.Escort || m.type === BuiltObjectMissionType.Move || m.type === BuiltObjectMissionType.MoveAndWait;
        if (!routine || m.priority > BuiltObjectMissionPriority.Normal) continue;
        applyOrder(galaxy, ship, choosePrivateerOrder(galaxy, empire, ship, privateers));
    }
}

function review(galaxy: Galaxy): void {
    for (const empire of galaxy.empires) {
        if (!isPrivateerEmpire(galaxy, empire)) continue;
        reviewEmpire(galaxy, empire);
        reassignEmpire(galaxy, empire);
    }
}

registerScenarioEvent({ id: 'privateers.attacked', flag: PRIVATEERS_FLAG, event: 'builtObjectAttacked', run: onBuiltObjectAttacked });
registerScenarioEvent({ id: 'privateers.mission', flag: PRIVATEERS_FLAG, event: 'privateShipMission', run: onPrivateShipMission });
registerScenarioPeriodic({ id: 'privateers.review', flag: PRIVATEERS_FLAG, periodDays: PRIVATEER_RULES.reviewDays, run: (g) => review(g) });
