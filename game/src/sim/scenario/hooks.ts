// Scenario hook points (tasks/MODLAYER-DESIGN.md §4). Not a port. Each hook is a no-op unless the game runs a scenario
// that asks for it, so the faithful game's state and Galaxy.Rnd stream are untouched when no scenario is chosen.
//
// Rnd policy: scenario code draws from galaxy.rnd only inside its own hooks (a yearly handler, a generation rule of its
// manifest, and what those call). With no scenario, no rule and no handler, none of these draw.

import type { Galaxy } from '../galaxy';
import type { Race } from '../data/races';
import type { Habitat } from '../types';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Creature } from '../creature';
import type { GalaxyLocation } from '../galaxyLocation';
import { YEAR_LENGTH } from '../galaxyTime';
import { galaxyStarDate } from '../tick/simTime';
import { scenarioRuns, type GalaxyScenario } from './state';
import type { Resource } from '../data/resources';
import type { Character, CaptainBonuses } from '../characters';
import type { EmpireActivity } from '../pirates/empireActivity';
import type { Design } from '../design';
import type { Facility } from '../data/facilities';
import type { DesignPlacementTweak } from '../designPlacement';
import type { DesignSpecification } from '../data/designSpecifications';

// ---------------------------------------------------------------------------
// Handler registries (shared gate)
// ---------------------------------------------------------------------------

/** Gate shared by every scenario handler. A handler needs `flag` or `scenarioId`; an ungated one never runs. */
export interface ScenarioHandlerGate {
    /** Unique id per registry (e.g. "darkFarms.spawn"); ties in `order` run in id order. Re-registering an id replaces it. */
    id: string;
    /** Run order among handlers of the same registry (lower first; default 0). */
    order?: number;
    /** Only runs when this scenario flag is on (omitted: no flag gate). */
    flag?: string;
    /** Only runs in this scenario (omitted: any scenario). */
    scenarioId?: string;
}

function register<T extends ScenarioHandlerGate>(list: T[], handler: T): () => void {
    const i = list.findIndex((h) => h.id === handler.id);
    if (i >= 0) list.splice(i, 1);
    list.push(handler);
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return () => {
        const j = list.indexOf(handler);
        if (j >= 0) list.splice(j, 1);
    };
}

/** True when `h` may run in this galaxy's scenario. */
export function scenarioGateOpen(galaxy: Galaxy, h: ScenarioHandlerGate): boolean {
    return scenarioGateOpenFor(galaxy.scenario, h);
}

/** scenarioGateOpen on a GalaxyScenario (generation set-up runs before the Galaxy exists). */
export function scenarioGateOpenFor(s: GalaxyScenario | null, h: ScenarioHandlerGate): boolean {
    if (s === null) return false;
    if (h.scenarioId === undefined && h.flag === undefined) return false;
    if (h.scenarioId !== undefined && !scenarioRuns(s, h.scenarioId)) return false;
    if (h.flag !== undefined && s.flags[h.flag] !== true) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Yearly / periodic scenario ticks
// ---------------------------------------------------------------------------

/** A yearly handler a scenario package registers at module load. */
export interface ScenarioYearlyHandler extends ScenarioHandlerGate {
    /** `year` = the game year that just began (floor(starDate / YEAR_LENGTH)). May draw galaxy.rnd. */
    run: (galaxy: Galaxy, year: number) => void;
}

/** A periodic handler: runs every `periodDays` game days (a game day = YEAR_LENGTH / 360: 12 months of 30 days). */
export interface ScenarioPeriodicHandler extends ScenarioHandlerGate {
    periodDays: number;
    /** `starDate` = the current star date. May draw galaxy.rnd. */
    run: (galaxy: Galaxy, starDate: number) => void;
}

/** Star-date ms per game day (ResolveStarDateDescription: 12 months of 30 days). */
export const GAME_DAY_LENGTH = YEAR_LENGTH / 360;

const yearlyHandlers: ScenarioYearlyHandler[] = [];
const periodicHandlers: ScenarioPeriodicHandler[] = [];

/** Registers (or replaces, by id) a yearly handler. Returns an unregister function (tests). */
export function registerScenarioYearly(handler: ScenarioYearlyHandler): () => void {
    return register(yearlyHandlers, handler);
}

/** Registers (or replaces, by id) a periodic handler. Returns an unregister function (tests). */
export function registerScenarioPeriodic(handler: ScenarioPeriodicHandler): () => void {
    if (!(handler.periodDays > 0)) throw new Error(`registerScenarioPeriodic(${handler.id}): periodDays must be > 0`);
    return register(periodicHandlers, handler);
}

/** The game year of a star date. */
export function gameYear(starDate: number): number {
    return Math.floor(starDate / YEAR_LENGTH);
}

/**
 * The yearly scenario tick, called once per Galaxy.DoTasks long block (galaxyTick.ts, after CheckVictoryConditions).
 * The first call anchors the current year; afterwards every handler whose gate passes runs once per new game year (if
 * several years passed at once — never at normal speeds — it runs once, for the latest year).
 */
export function scenarioYearlyTick(galaxy: Galaxy): void {
    const s = galaxy.scenario;
    if (s === null) return;
    const year = gameYear(galaxyStarDate(galaxy));
    if (s.lastYear < 0) {
        s.lastYear = year;
        return;
    }
    if (year <= s.lastYear) return;
    s.lastYear = year;
    for (const h of [...yearlyHandlers]) {
        if (scenarioGateOpen(galaxy, h)) h.run(galaxy, year);
    }
}

/**
 * The periodic scenario tick (same call site, right after the yearly one; the long block runs every 60 game seconds =
 * 36 game days at 1x, so a period shorter than that runs once per long block). Per handler: the first call with its
 * gate open anchors it (GalaxyScenario.periodicLast[id] = now); afterwards it runs when periodDays have passed since
 * its last run.
 */
export function scenarioPeriodicTick(galaxy: Galaxy): void {
    const s = galaxy.scenario;
    if (s === null) return;
    const now = galaxyStarDate(galaxy);
    for (const h of [...periodicHandlers]) {
        if (!scenarioGateOpen(galaxy, h)) continue;
        const last = s.periodicLast[h.id];
        if (last === undefined) {
            s.periodicLast[h.id] = now;
            continue;
        }
        if (now - last < h.periodDays * GAME_DAY_LENGTH) continue;
        s.periodicLast[h.id] = now;
        h.run(galaxy, now);
    }
}

// ---------------------------------------------------------------------------
// Game start
// ---------------------------------------------------------------------------

/** Game-start helpers game.ts passes in (its private ports), so this module does not import game.ts. */
export interface HomePlacementHelpers {
    randomPointInRing: (galaxy: Galaxy, min: number, max: number) => { x: number; y: number };
    inNebula: (galaxy: Galaxy, habitat: Habitat) => boolean;
    /** The game's start tech level option (techLevelForSliderIndex: 0 pre-warp, 0.5 normal, 1..7 wizard levels; not saved). */
    startTechLevel?: number;
    /** Each empire's own start tech level (createGame's EmpireStartOptions.techLevel; not saved). */
    empireTechLevels?: ReadonlyMap<Empire, number>;
}

/** Runs once at the end of createGame (after every stock start step, before the first scheduler frame). May draw. */
export interface ScenarioGameStartHandler extends ScenarioHandlerGate {
    run: (galaxy: Galaxy, ctx: HomePlacementHelpers) => void;
}

const gameStartHandlers: ScenarioGameStartHandler[] = [];

export function registerScenarioGameStart(handler: ScenarioGameStartHandler): () => void {
    return register(gameStartHandlers, handler);
}

/** createGame's last step when the game has a scenario. */
export function scenarioGameStart(galaxy: Galaxy, ctx: HomePlacementHelpers): void {
    if (galaxy.scenario === null) return;
    for (const h of [...gameStartHandlers]) {
        if (scenarioGateOpen(galaxy, h)) h.run(galaxy, ctx);
    }
}

// ---------------------------------------------------------------------------
// Events (scenarioEmit) and queries (scenarioQuery)
// ---------------------------------------------------------------------------

/**
 * Base-sim events. Each emit site is one line guarded by `galaxy.scenario !== null` placed after the stock code, so
 * with no scenario nothing is built or called. Event handlers may draw galaxy.rnd (their gate is on).
 */
export interface ScenarioEvents {
    /** combat/ownership.ts takeOwnershipOfColonyFull (end; covers conquest, independents absorbed, secession). */
    colonyOwnerChanged: { colony: Habitat; from: Empire | null; to: Empire | null };
    /** A new colony founded by a colony ship (missions: colonize). */
    colonyFounded: { colony: Habitat; empire: Empire };
    /** combat/ownership.ts takeOwnershipOfBuiltObject (end). */
    builtObjectOwnerChanged: { builtObject: BuiltObject; from: Empire | null; to: Empire | null };
    /** A ship or base finished construction (construction yard completion). */
    builtObjectBuilt: { builtObject: BuiltObject; empire: Empire | null };
    /** combat/teardown.ts builtObjectCompleteTeardown (top). */
    builtObjectRemoved: { builtObject: BuiltObject };
    /**
     * combat/teardown.ts builtObjectCompleteTeardown (top, before builtObjectRemoved) when HasBeenDestroyed was already
     * set — a ship / base destroyed by weapons, creatures, self-destruct or area damage (set only by the combat destroy
     * branches), torn down by DoExplosions (BuiltObject.1.cs 14) or CleanupInvalidShips (Empire.8.cs 2896). 19e-7.
     */
    builtObjectDestroyed: { builtObject: BuiltObject };
    /**
     * civilianAI.ts assignMissionConstructionShip end (Empire.5.cs 2669, end of case ConstructionShip) and
     * pirateShipMissions.ts pirateAssignConstructionShip end (Empire.1.cs 5116): the stock AI found no task and the
     * ship is still idle. Handlers may assign a mission (19e-7 salvage).
     */
    constructionShipIdle: { empire: Empire; ship: BuiltObject };
    /** combat/damage.ts inflictBombardDamage (end). */
    habitatBombarded: { builtObject: BuiltObject; habitat: Habitat; bombardPower: number };
    /** espionage.ts completeIntelligenceMission (end). */
    intelMissionCompleted: { empire: Empire; mission: unknown; outcome: unknown };
    /** events.ts empireCompleteTeardown (top). */
    empireEliminated: { empire: Empire; conqueror: Empire | null };
    /**
     * combat/damage.ts inflictDamageFull, the ship-destroyed branch (BuiltObject.2.cs ~6560-6600, after the stock
     * bookkeeping): `destroyer` = the attacking object's empire (null for monsters / unowned). Fires at the moment of
     * the killing blow, ahead of (and distinct from) builtObjectDestroyed's later teardown-time signal — kept as its
     * own event (not merged into builtObjectDestroyed) so a 19e-7 wreckage handler and this one don't both fire off a
     * single kill under double-different payload shapes, and so rimTrade's raid-stats counter isn't double-counted.
     */
    builtObjectKilledBy: { builtObject: BuiltObject; destroyer: Empire | null };
    /** researchTick.ts doResearchBreakthrough (end). */
    researchCompleted: { empire: Empire; project: unknown };
    /** characters.ts generateNewCharacter (end). */
    characterCreated: { character: unknown; empire: Empire };
    /** combat/ownership.ts investigateAbandonedBuiltObject (end). */
    abandonedShipClaimed: { builtObject: BuiltObject; empire: Empire };
    /** A diplomatic relation changed type (diplomacyTick changeDiplomaticRelation, end): war declared, treaty signed, ... */
    diplomaticRelationChanged: { empire: Empire; other: Empire; from: number; to: number };
    /** diplomacyTick.ts declareWar (Empire.7.cs 4883 DeclareWar): end of the new-war branch, after both sides' war objectives are set. */
    warDeclared: { empire: Empire; target: Empire };
    /**
     * combat/damage.ts inflictWarDamageBuiltObject / inflictWarDamageHabitat (Galaxy.3.cs 529 / 541 InflictWarDamage), after
     * the victim's relation ledger is charged: a ship / base destroyed, or a colony invaded or destroyed. `value` is the
     * war value charged (Galaxy.3.cs 474 / 507 CalculateWarValue). Only emitted when the victim has a relation with the
     * inflictor.
     */
    warDamageInflicted: { inflictor: Empire; victim: Empire; builtObject: BuiltObject | null; habitat: Habitat | null; value: number };
    /** diplomacyTick.ts endWarRequest (Empire.8.cs 1550 EndWarRequest): `empire` just queued an end-war proposal to `other`. */
    peaceProposed: { empire: Empire; other: Empire };
    /**
     * A war ended by an accepted end-war proposal: `empire` accepted `other`'s proposal. Sites: diplomacyTick.ts
     * considerTreatyProposals (Empire.3.cs 3651-3675), player/playerOrders.ts acceptProposal (EmpireDetailView.cs 803),
     * player/diplomacyProposals.ts WAR_END (Main.Part10.cs 4679). After the stock end-of-war processing.
     */
    peaceSigned: { empire: Empire; other: Empire };
    /** A disaster event hit a colony (events.ts). */
    disaster: { empire: Empire | null; habitat: Habitat | null; disasterType: number };
    /** logistics/contracts.ts initiateContract (end): a private/state sale (no Rnd in handlers — 19e-9 contract rule). */
    /**
     * 19j: a ship (or the giant ion cannon) killed a creature — combat/damage.ts inflictDamageFull (BuiltObject.2.cs 6227),
     * inflictIonDamage (6133), habitatInflictIonDamage (Habitat.cs 2357), right before its CompleteTeardown. No Rnd in handlers.
     */
    creatureKilled: { creature: Creature; killer: BuiltObject | Habitat | null; empire: Empire | null };
    /**
     * combat/attackAI.ts notifyOfAttackBuiltObject (Galaxy.7.cs 2987 NotifyOfAttack, top): a ship or base is under attack.
     * No Rnd in handlers. 19a passive posture (the Concord remembers who attacked it).
     */
    builtObjectAttacked: { builtObject: BuiltObject; attacker: unknown; attackingEmpire: Empire | null };
    /**
     * espionage.ts performIntelligenceMissions (Empire.5.cs 5890-5990), right after the outcome and the blamed empire are
     * known, for the detected outcomes (SucceedDetect / FailDetect / Capture): `blamed` is the empire the target holds
     * responsible (the performer, or a framed empire under 19d3). `missionType` is IntelligenceMissionType. No Rnd in handlers.
     */
    intelMissionExposed: { empire: Empire; blamed: Empire; target: Empire; missionType: number; outcome: number };
    /** 19j: combat/attackAI.ts notifyOfAttackHabitat (Galaxy.7.cs 3058 NotifyOfAttack, top): a colony is under attack. No Rnd in handlers. */
    habitatAttacked: { habitat: Habitat; attacker: unknown; attackingEmpire: Empire | null; bombarded: boolean };
    /**
     * taxes.ts reviewTaxes (Empire.10.cs 158 ReviewTaxes), end: every colony's rate was just set. Handlers may change
     * the rates (and must recalculate the colony revenue they change). No Rnd in handlers. Smarter AI growth taxes.
     */
    taxesReviewed: { empire: Empire };
    /**
     * tick/empireTick.ts, intermediate block (Empire.cs 3626-3630): the empire's colonisation targets were just
     * re-identified and the stock InvadeUnwillingColonizationTargets ran (expanding races only). Handlers may draw Rnd
     * (fleet missions). Smarter AI independents.
     */
    colonizationTargetsReviewed: { empire: Empire };
    contractInitiated: {
        seller: Empire;
        buyer: Empire;
        sellingPoint: unknown;
        destination: unknown;
        resourceId: number;
        componentId: number;
        amount: number;
        value: number;
        isState: boolean;
        freighter: BuiltObject | null;
    };
    /**
     * construction/empireConstruction.ts buildDefensiveBases (Empire.10.cs 1211), after the strategic-value > 250000
     * colonies were added: handlers may push more habitats onto `locations`. No Rnd. Smarter AI defence.
     */
    defensiveBaseLocations: { empire: Empire; locations: unknown[] };
    /**
     * fleets/militaryAI.ts huntPirates (Empire.9.cs 1603), right after its Next(0, 3) draw (`roll`): a handler that sets
     * `handled` replaces the stock hunt for this call. Unlike most events the handler MAY draw galaxy.rnd (mission
     * assignment): it runs only behind its flag, in place of the stock step. Smarter AI pirate clean-up.
     */
    huntPirates: { empire: Empire; roll: number; handled: boolean };
    /**
     * tick/empireTick.ts long block, in place of directConstruction (Empire.1.cs 3698 DirectConstruction) while the
     * stateAIDormant query holds for the empire: the handler runs its own state build order. May draw galaxy.rnd
     * (placement / names), as the stock step it replaces does. Smarter AI pre-warp opening.
     */
    dormantStateConstruction: { empire: Empire };
}
export type ScenarioEventName = keyof ScenarioEvents;

export interface ScenarioEventHandler<E extends ScenarioEventName = ScenarioEventName> extends ScenarioHandlerGate {
    event: E;
    run: (galaxy: Galaxy, payload: ScenarioEvents[E]) => void;
}

const eventHandlers: ScenarioEventHandler[] = [];

/**
 * Perf: handlers indexed by key (event / query name), in registry order. Each per-key array is rebuilt (never mutated)
 * when its registry changes, so iterating one is iterating a snapshot — the same as the former `[...list]` copy filtered
 * by key. Dispatch then touches only the handlers of that key instead of every registered handler.
 */
function indexByKey<T>(list: readonly T[], key: (h: T) => string): Map<string, readonly T[]> {
    const m = new Map<string, T[]>();
    for (const h of list) {
        const k = key(h);
        const a = m.get(k);
        if (a === undefined) m.set(k, [h]);
        else a.push(h);
    }
    return m;
}
const NO_HANDLERS: readonly never[] = [];

let eventIndex: Map<string, readonly ScenarioEventHandler[]> | null = null;

export function registerScenarioEvent<E extends ScenarioEventName>(handler: ScenarioEventHandler<E>): () => void {
    eventIndex = null;
    const unregister = register(eventHandlers, handler as unknown as ScenarioEventHandler);
    return () => {
        eventIndex = null;
        unregister();
    };
}

/** Delivers an event to the gated handlers subscribed to it (no-op without a scenario). */
export function scenarioEmit<E extends ScenarioEventName>(galaxy: Galaxy, event: E, payload: ScenarioEvents[E]): void {
    if (galaxy.scenario === null) return;
    if (eventIndex === null) eventIndex = indexByKey(eventHandlers, (h) => h.event);
    const list = eventIndex.get(event) ?? NO_HANDLERS;
    for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (scenarioGateOpen(galaxy, h)) (h.run as (g: Galaxy, p: ScenarioEvents[E]) => void)(galaxy, payload);
    }
}

/**
 * Query hooks: a stock value a scenario may adjust. Each site is `if (galaxy.scenario !== null) v = scenarioQuery(...)`
 * after the stock computation. Query handlers never draw galaxy.rnd and must be pure (the value may be asked any number
 * of times).
 */
export interface ScenarioQueries {
    /** taxes.ts empireApprovalRating(h) (Habitat.cs approval of its empire): the rating; an additive term goes here. */
    empireApprovalRating: { value: number; args: { habitat: Habitat; empire: Empire | null } };
    /**
     * researchTick.ts annualResearchPotential (Empire.cs 1817): true computes a normal empire's potential through the
     * stock pirate-faction branch (built objects + research stations, no population) — 19f #8 The Exchange, a faction
     * without colonies. Pure.
     */
    researchAsPirateFaction: { value: boolean; args: { empire: Empire } };
    /**
     * pirates/missionsMarket.ts reviewPirateDefendMissions (Empire.2.cs 1313 ReviewPirateDefendMissions), the ownership
     * test `TargetEmpire(target) != RequestingEmpire`: the empire the target must still belong to for the Defend contract
     * to pay (stock: the requester). 19f #8 The Exchange posts Defend contracts on another empire's colonies. Pure.
     */
    pirateDefendClient: { value: Empire | null; args: { activity: EmpireActivity } };
    /**
     * pirates/missionsMarket.ts pirateCheckAcceptDefendMission (Empire.2.cs 2045 PirateCheckAcceptDefendMission), the
     * rule that the pirate faction must protect the contract's target empire: true lets `pirate` bid without that
     * pact (the stock distance / strength tests still apply). 19f #8: contracts financed by the Exchange. Pure.
     */
    pirateDefendBidAllowed: { value: boolean; args: { pirate: Empire; activity: EmpireActivity } };
    /** diplomacyTick.ts declareWar (Empire.7.cs 4883), first line: true blocks the declaration (19c charter war rules). */
    declareWarBlocked: { value: boolean; args: { empire: Empire; target: Empire } };
    /**
     * combat/invasion.ts battle-victory capture (Empire.7.cs 4653-4680): `false` = the winning ship's empire does NOT
     * permanently take the habitat — ownership is set to null instead, so the stock lost-colony adoption
     * (`scanForNewOwnerHabitat`) can re-seat it with its original owner. Exchange (19e) raids but never holds ground:
     * a merchant-spy faction's warships may win the fight without annexing the colony.
     */
    combatCaptureAllowed: { value: boolean; args: { capturingEmpire: Empire | null; habitat: Habitat } };
    /**
     * logistics/freight.ts addForeignTradingPosts (Empire.4.cs 540-576): `undefined` = stock posts; otherwise the only
     * trading post `empire` may use at `other` (null: none) — 19c companyHqExportOnly.
     */
    foreignTradingPosts: { value: BuiltObject | null | undefined; args: { empire: Empire; other: Empire } };
    /**
     * independentTraders.ts findShipOutsideSystemWithScanRange (Empire.9.cs 3449): the range modifier of the ships-outside-
     * systems scan (not the stationary long-range scanners) for a target at (x, y). 19h sensor fog.
     */
    scanRangeModifier: { value: number; args: { x: number; y: number } };
    /**
     * cmdMovement.ts HyperTo in-flight step (BuiltObject.2.cs HyperTo): the point where a jump that moved the ship from
     * (fromX, fromY) to (toX, toY) this step must end early (null = no stop). 19h gravity shoals.
     */
    hyperjumpStop: { value: { x: number; y: number } | null; args: { ship: BuiltObject; fromX: number; fromY: number; toX: number; toY: number; exitX: number; exitY: number } };
    /** industry.ts industrialProcessing (BuiltObject.2.cs 7859 extraction block): true = the extractor mines nothing this pass. */
    extractionBlocked: { value: boolean; args: { builtObject: BuiltObject } };
    /** civilianAI.ts resolvePrioritizedPatrolMiningStations (Empire.5.cs 1331): a station's wanted escort (SortTag, firepower). */
    miningStationPatrolPriority: { value: number; args: { builtObject: BuiltObject; empire: Empire } };
    /** events.ts creatureScanForTarget (Creature.cs 1245): true = the creature leaves this target alone. */
    creatureIgnoresTarget: { value: boolean; args: { creature: Creature; target: unknown } };
    /**
     * movement.ts detectHyperDeny's RestrictedArea/HyperjumpDisabled location loop (BuiltObject.1.cs 1737): true when
     * `builtObject` should ignore `location`'s hyperjump-disable effect (19f: the Silence — pirate ships are immune
     * inside its zone). Default false (not exempt); never draws.
     */
    hyperDenyExempt: { value: boolean; args: { builtObject: BuiltObject; location: GalaxyLocation } };
    /**
     * diplomacyTick.ts reviewDiplomaticStrategies, at Empire.8.cs 100/139 (num9 = -10 / aggression: the attitude score
     * num6 must fall below it for the Conquer / Punish branches, the gate SOAK-2026-09-26 §A2 names). The value is a
     * relaxation in attitude points (stock 0): num9 is raised by it and the Conquer predicates' attitude tests
     * (overallAttitude2 < -5 / -10 / 0) read the attitude lowered by it. `empire` reviews its relation with `other`.
     */
    warReviewAttitudeRelax: { value: number; args: { empire: Empire; other: Empire } };
    /**
     * Minimum ships of a troop fleet sent against colony `target` (stock 10): Empire.8.cs 504 CheckCanConductNewWar,
     * 1041/1049 PrepareFleetsForWar (the audit's "1047" ≥10-ship troop fleet rule) and 1163 SelectFleetWarAttackTarget.
     */
    invasionMinFleetShips: { value: number; args: { empire: Empire; target: Habitat } };
    /** Share of the required troop strength a troop fleet must carry (stock 0.5: Empire.8.cs 1049 `>= num3 / 2`). */
    invasionTroopRatio: { value: number; args: { empire: Empire; target: Habitat } };
    /**
     * combat/attackAI.ts shouldAttack (BuiltObject.1.cs ShouldAttack), stance AttackEnemies, right before the diplomatic
     * relation test (War → attack; otherwise only a ship's own Attack-mission target): true lets `empire`'s ship engage
     * `target`'s ships and bases without a war, as pirates do. Stock false. 19a tit-for-tat strikes. Never draws.
     */
    attackWithoutWar: { value: boolean; args: { empire: Empire; target: Empire } };
    /** 19j: events.ts applyLocationEffects (BuiltObject.cs 3934 ApplyLocationEffects): true = no lightning / ship-damage effects. */
    builtObjectStormImmune: { value: boolean; args: { builtObject: BuiltObject } };
    /** 19j: movement.ts rechargeReactors (BuiltObject.1.cs 2509 RechargeReactors): true = recharging burns no fuel. */
    builtObjectSelfFuelling: { value: boolean; args: { builtObject: BuiltObject } };
    /**
     * researchTick.ts performResearchProjects (Empire.3.cs 1890 PerformResearch, per industry), first line: true skips
     * the industry's research this pass (19a rimTraderResearchCap: the Concord's stagnation).
     */
    researchFrozen: { value: boolean; args: { empire: Empire; industry: number } };
    /**
     * independentTraders.ts isObjectVisibleToThisEmpire (Empire.9.cs 3198), first line: true makes the object visible to
     * `empire` regardless of sensors (19a treasure-fleet beacon: a galaxy-wide position broadcast).
     */
    objectVisibleToAll: { value: boolean; args: { empire: Empire; object: BuiltObject | Habitat } };
    /** events.ts clearEmptyDebrisFields (Galaxy.5.cs 2893): true keeps a debris field with no abandoned ships (19e-7 wreck fields). */
    debrisFieldPersists: { value: boolean; args: { location: GalaxyLocation } };
    /**
     * pirateAI.ts updateRaidCountdownBuiltObject / updateRaidCountdownHabitat (BuiltObject.1.cs 2894, Habitat.cs 1608): a
     * multiplier on the raid-countdown recovery of a target at (x, y) (1 = stock). 19e-7: raids come faster near big wreck fields.
     */
    raidCountdownRate: { value: number; args: { x: number; y: number } };
    /**
     * Whether `empire` accepts `other`'s end-war proposal (stock value: ConsiderEndWar's verdict). Sites:
     * diplomacyTick.ts considerTreatyProposals (Empire.3.cs 3651 `if (ConsiderEndWar(thisEmpire, out endReason))`) and
     * player/diplomacyProposals.ts WAR_END (Main.Part10.cs 4679).
     */
    endWarAcceptance: { value: boolean; args: { empire: Empire; other: Empire } };
    /**
     * missions/assign.ts assignMission (BuiltObject.2.cs 7620 AssignMission), next to the 7622-7625 precondition return:
     * false refuses the new mission (the ship keeps its current one). `x` / `y` are the mission's point (-2000000001 unset).
     */
    assignMissionAllowed: { value: boolean; args: { builtObject: BuiltObject; missionType: number; target: unknown; x: number; y: number } };
    /**
     * colonyTick.ts checkSatisfaction (Habitat.cs 5992 CheckSatisfaction: the EmpireApprovalRating read that decides the
     * revolt and, below `leaveThreshold` (num5) while rebelling without troops, LeaveEmpire): the value the revolt test
     * uses. 19m internal security answers the colony's stability-ledger total (and holds it at the leave threshold under
     * martial law). Never draws.
     */
    colonyRevoltApproval: { value: number; args: { habitat: Habitat; leaveThreshold: number } };
    /**
     * game.ts player capital loop / Start.cs method_51 findAiCapital (the C#'s own home-system search), consulted right
     * after the stock candidate is accepted (no Rnd between the check and the stock accept, so a rejection re-enters
     * the C#'s own loop and re-rolls exactly as an ordinary stock rejection would): false rejects a stock-accepted
     * candidate habitat (the search tries its next candidate; no extra Rnd draws). Default true. 19h rim-frontier keeps
     * ordinary player/AI starts inside the rim belt.
     */
    acceptHomeHabitat: { value: boolean; args: { race: Race; habitat: Habitat; empireKind: 'player' | 'ai' } };
    /**
     * pirates.ts generateNewPirateEmpires (Galaxy.9.cs GenerateNewPirateEmpires) candidate test, consulted right after
     * the stock candidate is accepted: false rejects a stock-accepted pirate-base candidate (the loop's own re-roll, no
     * extra Rnd draws). Default true. 19h rim-frontier splits pirate factions between the rim and the core.
     */
    acceptPirateBase: { value: boolean; args: { habitat: Habitat } };
    /**
     * pirates.ts generateNewPirateEmpires (Galaxy.9.cs GenerateNewPirateEmpires), first line: the total pirate-faction
     * count the stock formula computed (Math.trunc(2 × PiratePrevalence × MaximumEmpireAmount)). Default the stock
     * value; never draws. 19h rimPirateFactionCap: an explicit ceiling on the faction count regardless of galaxy size /
     * pirate prevalence.
     */
    pirateFactionCount: { value: number; args: Record<string, never> };
    /**
     * Base-placement candidate test (pirates.ts generateNewPirateEmpires; independent-colony / mining-station placement
     * may call it too): true when (x, y) sits inside a rim herd's home range (plus a scenario's avoidance buffer) and
     * the candidate should be rejected. Default false (no fauna, or no scenario).
     */
    placementAvoidsHerds: { value: boolean; args: { x: number; y: number } };
    /**
     * forceStructure.ts recalculateAnnualTaxRevenue (Habitat.cs 6083 RecalculateAnnualTaxRevenue): the colony's gross
     * tax revenue (AnnualRevenue × TaxRate × TaxComplianceRate) before the Max(0) and the state support cost. 19n
     * steward (tax efficiency). Never draws.
     */
    colonyTaxRevenue: { value: number; args: { habitat: Habitat; empire: Empire } };
    /**
     * forceStructure.ts recalculateAnnualTaxRevenue (Habitat.cs 6083 RecalculateAnnualTaxRevenue): the tax rate the
     * revenue product uses (stock: the colony's TaxRate). 19g-5 frontier sectors: the sector governor's local rate
     * override and the sector rule's collection factor. Never draws.
     */
    colonyTaxRate: { value: number; args: { habitat: Habitat; empire: Empire } };
    /**
     * characters.ts reviewCaptainBonuses (BuiltObject.cs 1448 ReviewCaptainBonuses): the ship's captain bonus bytes
     * (100 = none). A handler returns a changed copy (never mutates `value`). 19n marshal (fleet repair / damage
     * control). Never draws.
     */
    captainBonuses: { value: CaptainBonuses; args: { builtObject: BuiltObject; empire: Empire } };
    /**
     * researchTick.ts selectNextResearchProject (Empire.3.cs 1391), the race's <Industry>ResearchProjectOrder read: the
     * ordered project ids the empire tries first (stock: the race's list). `industry` is IndustryType. Smarter AI.
     */
    researchProjectOrder: { value: readonly number[]; args: { empire: Empire; industry: number } };
    /**
     * civilianAI.ts identifyColonizationTargetsFull (Empire.4.cs 4662), the DetermineColonizationValue read: a
     * candidate's value before the threshold / danger tests (stock: unchanged). `filterOutDangerousTargets` is the
     * caller's flag (true for the colonisation list). Pure, never draws. Smarter AI colonies / independents.
     */
    colonizationTargetValue: { value: number; args: { empire: Empire; habitat: Habitat; filterOutDangerousTargets: boolean } };
    /**
     * construction/empireConstruction.ts directConstruction (Empire.6.cs 2630 colonisation block): the most new colony
     * ships this pass may order (stock: Infinity when the freighter / military gate is open, 0 when closed). Pure,
     * never draws. Smarter AI colonies.
     */
    colonyShipBuildCap: { value: number; args: { empire: Empire } };
    /**
     * A numeric AI build target (Smarter AI budget). `kind`: 'defensiveForce' = buildDefensiveBases' firepower required
     * per colony (Empire.10.cs 1211, num2); 'researchStationsPerColony' = checkBuildoutResearchCapacityAtColonies' cap
     * (stock 2); 'wonderMoneyDivisor' = reviewColonyWonders' StateMoney / 1.5 gate (Empire.3.cs 165). Never draws.
     */
    aiBuildTarget: { value: number; args: { empire: Empire; kind: 'defensiveForce' | 'researchStationsPerColony' | 'wonderMoneyDivisor' } };
    /** empireConstruction.ts directConstruction (Empire.6.cs 2630): colony ships may be built this review (stock: the freighter / military ratio check). Never draws. */
    colonizationBuildAllowed: { value: boolean; args: { empire: Empire } };
    /** empireConstruction.ts directConstruction: skip queueing a new state build of this sub-role (stock false). Smarter AI budget. Never draws. */
    stateBuildSkipped: { value: boolean; args: { empire: Empire; subRole: number } };
    /**
     * forceStructure.ts projectForceStructure (Empire.9.cs 4990), after the threat multiplier (num10, 1-4) is clamped:
     * the multiplier. Smarter AI defence (local pirate / enemy firepower near the colonies). Never draws.
     */
    forceStructureThreat: { value: number; args: { empire: Empire } };
    /**
     * forceStructure.ts projectForceStructure, the warship total (num13) after the expanding-race cap: the total.
     * `threat` is the final multiplier. Smarter AI defence (a per-colony floor). Never draws.
     */
    forceStructureWarships: { value: number; args: { empire: Empire; threat: number } };
    /** stationPlacement.ts determineResearchStationLocation (Empire.5.cs 3580), end: the sorted research-bonus build locations. Smarter AI. No Rnd. */
    researchStationLocations: { value: Habitat[]; args: { empire: Empire } };
    /** stationPlacement.ts analyzeNewResearchFacilities (Empire.5.cs 3495), end: the research station to build next (null = none). Smarter AI. No Rnd. */
    researchStationDesign: { value: Design | null; args: { empire: Empire; weapons: Design | null; energy: Design | null; highTech: Design | null } };
    /** characters.ts reviewCharacterLocation (Empire.7.cs 479), Scientist case: the station the scientist should move to (null = stock fallback). Smarter AI. No Rnd. */
    scientistStation: { value: BuiltObject | null; args: { empire: Empire; character: Character } };
    /** construction/wonders.ts reviewColonyWonders (Empire.3.cs 114): the money the empire may spend on `wonder` (stock: money / 1.5). Smarter AI. No Rnd. */
    wonderBudget: { value: number; args: { empire: Empire; wonder: Facility } };
    /** espionage.ts assignSpecialMissions (Empire.5.cs 5401): the counter-intelligence share of agents (0-1). Smarter AI. No Rnd. */
    counterIntelligenceProportion: { value: number; args: { empire: Empire } };
    /** pirates/pirateAI.ts determineDesirePirateProtection (Empire.2.cs 2754): whether `empire` wants `pirate`'s protection. Smarter AI. No Rnd. */
    pirateProtectionDesired: { value: boolean; args: { empire: Empire; pirate: Empire } };
    /**
     * pirates/missionsMarket.ts reviewPirateRelations (Empire.2.cs 2401), right before the cancel: true keeps `empire`'s
     * protection by `pirate` (the cashflow and desire cancels both skipped). Smarter AI pre-warp opening. No Rnd.
     */
    pirateProtectionKept: { value: boolean; args: { empire: Empire; pirate: Empire } };
    /**
     * tick/empireTick.ts empireDoTasks (Empire.1.cs 3427), once per call: true = the empire's state AI makes no strategic
     * moves this call (military, colonisation, espionage, active diplomacy, facility / defensive / station planning;
     * directConstruction is replaced by the dormantStateConstruction event). Research, taxes, private construction,
     * ship missions and the passive steps still run. Smarter AI pre-warp opening. Pure, never draws.
     */
    stateAIDormant: { value: boolean; args: { empire: Empire } };
    /**
     * designGeneration.ts createNewDesigns (BaconEmpire.CreateNewDesigns), before PlaceComponentsOnDesign: changes to
     * the template, the size-up share and the trim order of `empire`'s new `spec.subRole` design (stock: null = none).
     * Handlers must not mutate `spec` (it is the empire's own template). Smarter AI ship design. No Rnd.
     */
    aiDesignTweak: { value: DesignPlacementTweak | null; args: { empire: Empire; spec: DesignSpecification } };
}
export type ScenarioQueryName = keyof ScenarioQueries;

export interface ScenarioQueryHandler<Q extends ScenarioQueryName = ScenarioQueryName> extends ScenarioHandlerGate {
    query: Q;
    run: (galaxy: Galaxy, value: ScenarioQueries[Q]['value'], args: ScenarioQueries[Q]['args']) => ScenarioQueries[Q]['value'];
}

const queryHandlers: ScenarioQueryHandler[] = [];

let queryIndex: Map<string, readonly ScenarioQueryHandler[]> | null = null;

export function registerScenarioQuery<Q extends ScenarioQueryName>(handler: ScenarioQueryHandler<Q>): () => void {
    queryIndex = null;
    const unregister = register(queryHandlers, handler as unknown as ScenarioQueryHandler);
    return () => {
        queryIndex = null;
        unregister();
    };
}

/** Folds the gated handlers of `query` over the stock value (returns it unchanged without a scenario / handler). */
export function scenarioQuery<Q extends ScenarioQueryName>(galaxy: Galaxy, query: Q, value: ScenarioQueries[Q]['value'], args: ScenarioQueries[Q]['args']): ScenarioQueries[Q]['value'] {
    if (galaxy.scenario === null) return value;
    if (queryIndex === null) queryIndex = indexByKey(queryHandlers, (h) => h.query);
    const list = queryIndex.get(query) ?? NO_HANDLERS;
    let v = value;
    for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (scenarioGateOpen(galaxy, h)) v = (h.run as ScenarioQueryHandler<Q>['run'])(galaxy, v, args);
    }
    return v;
}

// ---------------------------------------------------------------------------
// Leader succession (19n court & dynasties)
// ---------------------------------------------------------------------------

/**
 * characterRuntime.ts performChangeLeader (Empire.6.cs 4873 PerformChangeLeader), right before its ChangeLeader call:
 * a gated handler may replace the new-leader pool and the change type (the manner the message reports). Returning null
 * keeps the stock pool. Unlike a query, a handler MAY draw galaxy.rnd (a succession crisis roll): it only runs behind
 * its flag, inside the stock leader-change step. The first handler that answers wins.
 */
export interface ScenarioSuccessionHandler extends ScenarioHandlerGate {
    run: (galaxy: Galaxy, empire: Empire, pool: Character[], changeType: number) => { pool: Character[]; changeType: number } | null;
}

const successionHandlers: ScenarioSuccessionHandler[] = [];

export function registerScenarioSuccession(handler: ScenarioSuccessionHandler): () => void {
    return register(successionHandlers, handler);
}

/** performChangeLeader's hook (callers check galaxy.scenario !== null). */
export function scenarioLeaderSuccession(galaxy: Galaxy, empire: Empire, pool: Character[], changeType: number): { pool: Character[]; changeType: number } | null {
    for (const h of successionHandlers) {
        if (!scenarioGateOpen(galaxy, h)) continue;
        const r = h.run(galaxy, empire, pool, changeType);
        if (r !== null) return r;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Placement (generation)
// ---------------------------------------------------------------------------

/** The generation options a scenario may change before the galaxy is built (createGame). */
export interface ScenarioGenerationSetup {
    starCount: number;
    sectorWidth: number;
    sectorHeight: number;
    /** The base game's custom-size switch (CreateGameOptions.customGalaxyDimensions): a set-up that takes the sector
     *  counts past the C# 4..15 clamp turns it on, as the wizard's sector boxes do. */
    customGalaxyDimensions?: boolean;
}

/**
 * Galaxy generation hooks (19h). None may draw galaxy.rnd: a package that needs randomness here uses its own Random
 * seeded from the galaxy seed, so the faithful draws only move where a hook changes the outcome (a rejected star
 * position is re-rolled from galaxy.rnd by the stock loop).
 */
export interface ScenarioGenerationHandler extends ScenarioHandlerGate {
    /** createGame, before generateGalaxy: may change the options and add resource rules to the scenario. */
    setup?: (scenario: GalaxyScenario, resources: readonly Resource[], o: ScenarioGenerationSetup) => void;
    /** generateGalaxy right after GenerateNebulae (before the clusters and the star loop). */
    afterNebulae?: (galaxy: Galaxy) => void;
    /** SetupSun (Galaxy.5.cs) candidate position: false rejects it (the stock loop re-rolls, up to its 100 tries). */
    acceptStarPosition?: (galaxy: Galaxy, x: number, y: number) => boolean;
    /**
     * createGame, right after generateGalaxy returns: every habitat's faithful resource selection (Galaxy.4.cs
     * SelectResources, run throughout setupSolarSystem / generateGasCloud) has already happened. May draw (its own
     * Random, never galaxy.rnd — generateGalaxy itself is done drawing galaxy.rnd for resources by this point, but the
     * stock loop's later steps, e.g. empire placement, have not started). 19h fuel oases.
     */
    afterGeneration?: (galaxy: Galaxy) => void;
}

const generationHandlers: ScenarioGenerationHandler[] = [];

export function registerScenarioGeneration(handler: ScenarioGenerationHandler): () => void {
    return register(generationHandlers, handler);
}

/** createGame: every gated setup hook over the generation options (no-op without a scenario). */
export function scenarioGenerationSetup(scenario: GalaxyScenario | null, resources: readonly Resource[], o: ScenarioGenerationSetup): ScenarioGenerationSetup {
    if (scenario === null) return o;
    for (const h of generationHandlers) if (h.setup !== undefined && scenarioGateOpenFor(scenario, h)) h.setup(scenario, resources, o);
    return o;
}

/** generateGalaxy after GenerateNebulae (callers check galaxy.scenario !== null). */
export function scenarioAfterNebulae(galaxy: Galaxy): void {
    for (const h of generationHandlers) if (h.afterNebulae !== undefined && scenarioGateOpen(galaxy, h)) h.afterNebulae(galaxy);
}

/** createGame, right after generateGalaxy returns (callers check galaxy.scenario !== null). */
export function scenarioAfterGeneration(galaxy: Galaxy): void {
    for (const h of generationHandlers) if (h.afterGeneration !== undefined && scenarioGateOpen(galaxy, h)) h.afterGeneration(galaxy);
}

/** SetupSun position test (callers check galaxy.scenario !== null). */
export function scenarioAcceptStarPosition(galaxy: Galaxy, x: number, y: number): boolean {
    for (const h of generationHandlers) {
        if (h.acceptStarPosition !== undefined && scenarioGateOpen(galaxy, h) && !h.acceptStarPosition(galaxy, x, y)) return false;
    }
    return true;
}

/** Distance of (x, y) from the galaxy centre as a fraction of sizeX / 2 (the scale randomPointInRing uses). */
export function radiusFraction(galaxy: Galaxy, x: number, y: number): number {
    const cx = galaxy.sizeX / 2.0;
    const cy = galaxy.sizeY / 2.0;
    // Non-square custom size: the fraction of the inscribed ellipse (randomPointInRing stretches y by SizeY / SizeX).
    if (galaxy.sizeX !== galaxy.sizeY) return Math.hypot((x - cx) / cx, (y - cy) / cy);
    return Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / cx;
}

/**
 * Resource placement hook (Galaxy.selectResources' resource loop): false when a scenario rule keeps `resourceId` off
 * this habitat. True (no effect) with no scenario or no rule for the resource.
 */
export function scenarioResourceAllowed(galaxy: Galaxy, habitat: Habitat, resourceId: number): boolean {
    const s = galaxy.scenario;
    if (s === null || s.resourceRules.length === 0) return true;
    for (const r of s.resourceRules) {
        if (r.resourceId !== resourceId) continue;
        const f = radiusFraction(galaxy, habitat.xpos, habitat.ypos);
        return f >= r.minRadius && f <= r.maxRadius;
    }
    return true;
}


/** The home-placement ring a scenario sets for `race`, or null (no scenario / no rule). */
export function scenarioHomeRing(galaxy: Galaxy, race: Race): { minRadius: number; maxRadius: number } | null {
    const s = galaxy.scenario;
    if (s === null || s.manifest === null || s.manifest.homePlacement.length === 0) return null;
    const rule = s.manifest.homePlacement.find((r) => r.race.toLowerCase() === race.name.toLowerCase());
    return rule === undefined ? null : { minRadius: rule.minRadius, maxRadius: rule.maxRadius };
}

/**
 * Home-system placement hook (createGame, before the stock capital search): when the scenario has a homePlacement rule
 * for `race`, an uncolonized `habitatType` habitat in the ring, outside nebulae, in a system with no empire colony,
 * with at least `minPlanets` planets, and away from other colonies (`minColonyDistance`). Up to 200 tries (draws
 * galaxy.rnd: randomPointInRing per try). null = no rule, or nothing found (the caller then runs the stock search).
 */
export function scenarioFindHomeHabitat(
    galaxy: Galaxy,
    race: Race,
    habitatType: Habitat['type'],
    helpers: HomePlacementHelpers,
    minColonyDistance: number,
    minPlanets = 3,
): Habitat | null {
    const ring = scenarioHomeRing(galaxy, race);
    if (ring === null) return null;
    let fallback: Habitat | null = null;
    for (let tries = 0; tries < 200; tries++) {
        const p = helpers.randomPointInRing(galaxy, ring.minRadius, ring.maxRadius);
        const h = galaxy.findNearestUncolonizedHabitat(p.x, p.y, habitatType);
        if (h === null || helpers.inNebula(galaxy, h)) continue;
        const f = radiusFraction(galaxy, h.xpos, h.ypos);
        if (f < ring.minRadius || f > ring.maxRadius) continue;
        const star = galaxy.determineHabitatSystemStar(h);
        if (galaxy.systemHabitatsOf(star.systemIndex).some((x) => x.empire !== null && x.empire !== galaxy.independentEmpire)) continue;
        const near = galaxy.findNearestColony(h.xpos, h.ypos, null, false);
        if (near !== null && galaxy.calculateDistance(h.xpos, h.ypos, near.xpos, near.ypos) < minColonyDistance) continue;
        if (galaxy.systemPlanetCount(galaxy.systems[star.systemIndex]) < minPlanets) {
            fallback ??= h;
            continue;
        }
        return h;
    }
    return fallback;
}
