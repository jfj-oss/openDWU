// Generation Ships (docs/NEW_THREATS.md §1): an early-game crisis. Not a port: new scenario behaviour composed of
// ported functions (each composed step cites its stock analogue). Registered from scenario/packages.ts; every handler
// is gated by the `threatGenerationShips` flag (and the threat framework's existence lottery), so with the flag off
// nothing here runs and nothing draws.
//
// Arc (one ship per six empires in the game, at most four; the first as below, each further one 2-4 years after the
// previous and aimed at a different empire; the Force start option aims the first at the player): once genShipsEmpiresAtTech empires reach genShipsTechLevel (researched tech level, as the
// beacon level of robotMutiny.ts empireTechLevel) — and between genShipsEarliestYear and genShipsLatestYear years in
// (the latest year fires it whatever the tech) — a world ship, an escort of about genShipsFleetFactorPct % of the
// target empire's military firepower (measured at that moment; never below genShipsMinFirepower) at the target's tech
// level, and troop transports (genShipsRegiments per genShipsRegimentFirepower of escort firepower) appear at the galaxy edge nearest a
// populated colony, owned by a new faction (createThreatFaction, adoptOnly: no colony yet). A scout flies to the
// colony; first contact follows (genShipsContactDays), the ultimatum genShipsUltimatumDays later. Meanwhile the
// target's AI plans and funds a larger navy (forceStructureThreat / forceStructureWarships / stateConstructionBudget). The owner answers the
// ultimatum in a scenario decision (the player: popup, journaled command; the AI: by strength, aiUltimatumChoice).
//
// Flavours: Pilgrims (accept a substitute world; grateful protectorate afterwards), Heirs (cede or war; a lasting
// grudge if ceded), Ark Faith (no substitute, fight to the end, no cult afterwards: survivors scatter), Quiet Ship (no
// ultimatum: only the scouts' report, then the ship AI attacks; defeated in battle only, captured by the stock rules).
//
// Outcomes: ceded / substitute / conquered → the world ship lands (its sleepers join the colony) and the faction is an
// ordinary small empire. Destroyed → a debris field (the Wreckage add-on records the wreck itself when it is on) and,
// with Archive Cores, a chance of a core for the killer. Captured → the sleepers join the captor's nearest colony and
// the captor recovers a core. Repelled (no warships and no troops left, or genShipsWarYears passed) → the survivors
// scatter (torn down).
//
// Rnd: the flavour, target and race picks use this module's own seeded Random (never galaxy.rnd). The stock functions
// called at arrival (createThreatFaction, design generation, ship names) and later (colony founding, debris field) draw
// galaxy.rnd, as they do for any threat. Fixed iteration orders: galaxy.empires, empire.colonies, list order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import type { Race } from '../../data/races';
import type { BuiltObject } from '../../builtObject';
import { Habitat, HabitatCategoryType, HabitatType } from '../../types';
import { ComponentType } from '../../data/components';
import type { ComponentDefinition } from '../../componentStatic';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { EmpireMessageType } from '../../messages';
import { Random } from '../../random';
import { YEAR_LENGTH, startStarDateForAge } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { generateNewBuiltObject } from '../../empireEvents';
import { generateDesignFromSpec } from '../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../gameStartTail';
import { takeOwnershipOfBuiltObject, takeOwnershipOfColonyFull } from '../../combat/ownership';
import { builtObjectCompleteTeardown } from '../../combat/teardown';
import { calculateOverallStrengthFactorWithoutShields, changeDiplomaticRelation, identifyShakturiEmpire, militaryPotency } from '../../diplomacyTick';
import { identifyMechanoidEmpire } from '../../fleets/militaryAI';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { makeHabitatIntoColonyRuntime } from '../../missions/cmdTroops';
import { habitatGenerateNewTroop } from '../../troops';
import { TroopType } from '../../cargo';
import { empireShipGroups, shipGroupAssignMission } from '../../fleets/shipGroup';
import { reviewEmpireTerritory } from '../../exploration';
import { Population, PopulationList } from '../../population';
import { generateDebrisField } from '../../story/storyStart';
import { isHumanEmpire } from '../../humanEmpires';
import { GAME_DAY_LENGTH, gameYear, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery, scenarioEmit } from '../hooks';
import { registerScenarioDecision, raiseScenarioDecision, type ScenarioDecision } from '../decisions';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { scenarioFlag, scenarioParam } from '../state';
import { applyReputation } from '../reputation/ledger';
import { grantArchiveCore } from './archiveCores';
import { empireTechLevel, maxDesignTechLevel, raiseFactionTech } from './robotMutiny';
import {
    KNOWLEDGE_CONFIRMED,
    arcMessage,
    arcNews,
    createThreatFaction,
    forcedThreatVictim,
    invadeFromInside,
    loadTroopsOnto,
    lockWar,
    makeFactionTroop,
    normalEmpires,
    pastThreatMinYear,
    peekThreatState,
    registerThreatExistence,
    registerThreatKnownSites,
    revealTo,
    teardownIfDead,
    threatExists,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatKnowledge,
} from './framework';

export const GEN_SHIPS_KEY = 'generationShips';
export const GEN_SHIPS_FLAG = 'threatGenerationShips';
const TAG = 'GenShips';
const PERIOD_DAYS = 10;
const LANDING_RANGE = 3000;
/** Escorts within this of the target count as "on station"; owner warships within it block a landing. */
const STATION_RANGE = 8000;
/** The world ship lands within this of its destination. */
const ARRIVE_RANGE = 4000;
const WRECKAGE_FLAG = 'wreckage';
const SPAWN_MARGIN = 46000; // 2 × Galaxy.MaxSolarSystemSize beyond the outermost system in the target's direction

export const GEN_SHIPS_FLAVOURS = ['pilgrims', 'heirs', 'ark', 'quiet'] as const;
export type GenShipsFlavour = (typeof GEN_SHIPS_FLAVOURS)[number];
const FLAVOUR_TEXT: Record<GenShipsFlavour, string> = { pilgrims: 'Pilgrims', heirs: 'Heirs', ark: 'Ark', quiet: 'Quiet' };

export type GenShipsPhase = 'waiting' | 'arrived' | 'contact' | 'ultimatum' | 'war' | 'settling' | 'settled' | 'ended';
export type GenShipsOutcome = 'ceded' | 'substitute' | 'conquered' | 'repelled' | 'destroyed' | 'captured' | null;

export interface GenShipsState {
    phase: GenShipsPhase;
    flavour: GenShipsFlavour | null;
    faction: Empire | null;
    target: Habitat | null;
    owner: Empire | null;
    /** Where the world ship goes to land (the target, or the substitute world). */
    settleAt: Habitat | null;
    worldShip: BuiltObject | null;
    escorts: BuiltObject[];
    transports: BuiltObject[];
    scouts: BuiltObject[];
    spawnX: number;
    spawnY: number;
    arrivalDate: number;
    contactDate: number;
    ultimatumDate: number;
    warDate: number;
    settleDate: number;
    endDate: number;
    /** Escort firepower at spawn, and the target empire's (both calculateOverallStrengthFactorWithoutShields sums). */
    fleetStrength: number;
    ownerStrengthAtSpawn: number;
    ownerStrengthAtUltimatum: number;
    regiments: number;
    sleepers: number;
    /** The owner's answer ('cede' | 'substitute' | 'refuse') and who gave it. */
    answer: string | null;
    answeredBy: string | null;
    outcome: GenShipsOutcome;
    worldShipFate: 'landed' | 'destroyed' | 'captured' | 'scattered' | null;
    /** The empire that destroyed or captured the world ship. */
    worldShipTaker: Empire | null;
    landings: number;
    sentStages: SentStages;
    knowledge: ThreatKnowledge[];
    /** Which ship of the wave this is (0 = the first; instance k > 0 lives at GEN_SHIPS_KEY#k). */
    index: number;
    /** First ship only: ships planned for the game, ships launched so far, when the next one comes. */
    planned: number;
    spawned: number;
    nextDate: number;
    /** The gas-mining strike (Heirs / Ark Faith / Quiet Ship): started, finished, gas stations destroyed. */
    strikeStart: number;
    strikeDone: boolean;
    stationsHit: number;
    strikeTargets: BuiltObject[];
    /** Where the world ship was last seen alive. */
    lastX: number;
    lastY: number;
    /** The pirate faction the survivors became, its ships and its base. */
    pirate: Empire | null;
    pirateShips: BuiltObject[];
    pirateBase: Habitat | null;
}

function newState(): GenShipsState {
    return {
        phase: 'waiting', flavour: null, faction: null, target: null, owner: null, settleAt: null, worldShip: null, escorts: [], transports: [], scouts: [],
        spawnX: 0, spawnY: 0, arrivalDate: 0, contactDate: 0, ultimatumDate: 0, warDate: 0, settleDate: 0, endDate: 0,
        fleetStrength: 0, ownerStrengthAtSpawn: 0, ownerStrengthAtUltimatum: 0, regiments: 0, sleepers: 0,
        answer: null, answeredBy: null, outcome: null, worldShipFate: null, worldShipTaker: null, landings: 0, sentStages: {}, knowledge: [],
        index: 0, planned: 1, spawned: 1, nextDate: 0, strikeStart: 0, strikeDone: false, stationsHit: 0, strikeTargets: [], lastX: 0, lastY: 0, pirate: null, pirateShips: [], pirateBase: null,
    };
}

export function genShipsState(galaxy: Galaxy): GenShipsState {
    return threatState(galaxy, GEN_SHIPS_KEY, newState);
}

export function peekGenShipsState(galaxy: Galaxy): GenShipsState | null {
    return peekThreatState<GenShipsState>(galaxy, GEN_SHIPS_KEY);
}

/** The wave's cap (most ships in one game). */
const MAX_WAVE = 4;

function instanceKey(index: number): string {
    return index === 0 ? GEN_SHIPS_KEY : `${GEN_SHIPS_KEY}#${index}`;
}

/** Every launched generation ship's state, first ship first (none: empty). Pure. */
export function genShipsStates(galaxy: Galaxy): GenShipsState[] {
    const out: GenShipsState[] = [];
    for (let k = 0; k < MAX_WAVE; k++) {
        const st = peekThreatState<GenShipsState>(galaxy, instanceKey(k));
        if (st !== null) out.push(st);
    }
    return out;
}

/** Ships a game with `empires` empires gets: one per `perShip` empires, at least 1, at most 4. Pure. */
export function genShipsWaveSize(empires: number, perShip: number): number {
    return Math.max(1, Math.min(MAX_WAVE, Math.floor(empires / Math.max(1, perShip))));
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
const P = {
    techLevel: (g: Galaxy) => p(g, 'genShipsTechLevel', 3),
    empiresAtTech: (g: Galaxy) => p(g, 'genShipsEmpiresAtTech', 2),
    earliestYear: (g: Galaxy) => p(g, 'genShipsEarliestYear', 5),
    latestYear: (g: Galaxy) => p(g, 'genShipsLatestYear', 15),
    flavour: (g: Galaxy) => Math.trunc(p(g, 'genShipsFlavour', -1)),
    fleetFactorPct: (g: Galaxy) => p(g, 'genShipsFleetFactorPct', 170),
    heavyPct: (g: Galaxy) => p(g, 'genShipsHeavyPct', 40),
    carrierPct: (g: Galaxy) => p(g, 'genShipsCarrierPct', 15),
    techGap: (g: Galaxy) => p(g, 'genShipsTechGap', 2),
    hyperdriveTech: (g: Galaxy) => p(g, 'genShipsHyperdriveTech', 4),
    extraFuelPct: (g: Galaxy) => p(g, 'genShipsExtraFuelPct', 50),
    empiresPerShip: (g: Galaxy) => p(g, 'genShipsEmpiresPerShip', 6),
    staggerMinYears: (g: Galaxy) => p(g, 'genShipsStaggerMinYears', 2),
    staggerMaxYears: (g: Galaxy) => p(g, 'genShipsStaggerMaxYears', 4),
    strikeDays: (g: Galaxy) => p(g, 'genShipsStrikeDays', 180),
    strikeReachSectors: (g: Galaxy) => p(g, 'genShipsStrikeReachSectors', 40),
    strikeGroups: (g: Galaxy) => Math.trunc(p(g, 'genShipsStrikeGroups', 3)),
    minFirepower: (g: Galaxy) => p(g, 'genShipsMinFirepower', 700),
    regimentFirepower: (g: Galaxy) => p(g, 'genShipsRegimentFirepower', 1000),
    maxEscorts: (g: Galaxy) => Math.trunc(p(g, 'genShipsMaxEscorts', 90)),
    regiments: (g: Galaxy) => p(g, 'genShipsRegiments', 30),
    minRegiments: (g: Galaxy) => p(g, 'genShipsMinRegiments', 12),
    maxRegiments: (g: Galaxy) => p(g, 'genShipsMaxRegiments', 90),
    troopStrength: (g: Galaxy) => p(g, 'genShipsTroopStrength', 100),
    sleepersM: (g: Galaxy) => p(g, 'genShipsSleepersM', 1500),
    contactDays: (g: Galaxy) => p(g, 'genShipsContactDays', 60),
    ultimatumDays: (g: Galaxy) => p(g, 'genShipsUltimatumDays', 540),
    answerDays: (g: Galaxy) => p(g, 'genShipsAnswerDays', 60),
    warYears: (g: Galaxy) => p(g, 'genShipsWarYears', 2),
    aiBuildupPct: (g: Galaxy) => p(g, 'genShipsAiBuildupPct', 220),
    aiFightRatioPct: (g: Galaxy) => p(g, 'genShipsAiFightRatioPct', 100),
    aiGarrisonPct: (g: Galaxy) => p(g, 'genShipsAiGarrisonPct', 120),
    coreOnKillPct: (g: Galaxy) => p(g, 'genShipsCoreOnKillPct', 60),
    grudge: (g: Galaxy) => p(g, 'genShipsGrudge', 60),
    gratitude: (g: Galaxy) => p(g, 'genShipsGratitude', 50),
};

/** The escort's three groups, by share of the firepower: big hulls, carriers, and the screens (also the strike fleets). */
const HEAVY_CYCLE = [BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip];
const CARRIER_CYCLE = [BuiltObjectSubRole.Carrier];
const SCREEN_CYCLE = [BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate];
const SCREEN_SUBROLES: ReadonlySet<BuiltObjectSubRole> = new Set(SCREEN_CYCLE);
const DESIGN_SUBROLES = [...new Set([...HEAVY_CYCLE, ...CARRIER_CYCLE, ...SCREEN_CYCLE]), BuiltObjectSubRole.TroopTransport, BuiltObjectSubRole.ExplorationShip, BuiltObjectSubRole.ColonyShip, BuiltObjectSubRole.Escort];
const WARSHIP_SUBROLES: ReadonlySet<BuiltObjectSubRole> = new Set([...HEAVY_CYCLE, ...CARRIER_CYCLE, ...SCREEN_CYCLE]);
/** Component families that stay outdated: weapons, fighter bays, armour, shields, engines / thrusters. */
/** The only parts the world-ship builders have at the top tier (user 2026-10-15): reactors and fuel storage; the
 *  hyperdrive is picked separately (the most efficient of tech <= genShipsHyperdriveTech). Everything else is outdated:
 *  weapons incl. special / super weapons, armour, shields and recharge, engines, ECM, targeting, countermeasures,
 *  repair, tractor beams, sensors, bays. */
const TOP_TIER_TYPES: ReadonlySet<ComponentType> = new Set([ComponentType.Reactor, ComponentType.StorageFuel, ComponentType.HyperDrive]);
const OUTDATED_TYPES = { has: (t: ComponentType): boolean => !TOP_TIER_TYPES.has(t) };
/** Planetary-facility-only components (components.txt: "only intended for ... the planetary facility"): never on ships. */
const PLANETARY_ONLY_COMPONENTS: ReadonlySet<string> = new Set(['Giant Ion Cannon']);
const REGIMENTS_PER_TRANSPORT = 6;

function ownRandom(galaxy: Galaxy, salt: number): Random {
    return new Random(((galaxy.randomSeed ^ salt) >>> 1) & 0x7fffffff);
}

function alive(bo: BuiltObject | null, faction: Empire | null): bo is BuiltObject {
    return bo !== null && !bo.hasBeenDestroyed && faction !== null && bo.actualEmpire === faction;
}

function strengthOf(list: readonly BuiltObject[]): number {
    let s = 0;
    for (const b of list) if (!b.hasBeenDestroyed) s += calculateOverallStrengthFactorWithoutShields(b);
    return s;
}

/** The escort's living firepower. Pure. */
export function genShipsFleetStrength(st: GenShipsState): number {
    return strengthOf(st.escorts.filter((b) => alive(b, st.faction)));
}

function fmt(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}

function months(days: number): number {
    return Math.max(1, Math.round(days / 30));
}

function flavourText(st: GenShipsState): string {
    return FLAVOUR_TEXT[st.flavour ?? 'pilgrims'];
}

// ---------------------------------------------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------------------------------------------

function yearsIn(galaxy: Galaxy): number {
    return gameYear(galaxyStarDate(galaxy)) - gameYear(startStarDateForAge(galaxy.age));
}

/** The arrival gate: enough empires at the tech level inside the year window, or the latest year. Pure. */
export function genShipsTriggerReady(galaxy: Galaxy): boolean {
    const y = yearsIn(galaxy);
    if (y < P.earliestYear(galaxy) || !pastThreatMinYear(galaxy, GEN_SHIPS_KEY)) return false;
    if (y >= P.latestYear(galaxy)) return true;
    let n = 0;
    for (const e of normalEmpires(galaxy)) if (empireTechLevel(e) >= P.techLevel(galaxy)) n++;
    return n >= P.empiresAtTech(galaxy);
}

/** Candidate target colonies: populated colonies of normal empires, best (population × quality) first, capitals last. Pure. */
export function genShipsTargetCandidates(galaxy: Galaxy): Habitat[] {
    const out: { h: Habitat; score: number }[] = [];
    // Not the story factions (the Ancient Guardians, the Shakturi) and not another threat's colony-less faction.
    const mech = identifyMechanoidEmpire(galaxy);
    const shak = identifyShakturiEmpire(galaxy);
    for (const e of normalEmpires(galaxy)) {
        if (e === mech || e === shak || e.capital === null || e.capital.empire !== e) continue;
        for (const c of e.colonies) {
            if (c.hasBeenDestroyed) continue;
            const pop = c.population.totalAmount;
            if (pop <= 0) continue;
            // Capitals only as a last resort (a lost capital this early would end an empire).
            out.push({ h: c, score: pop * (0.5 + c.quality) * (c === e.capital ? 1e-6 : 1) });
        }
    }
    out.sort((a, b) => b.score - a.score || galaxy.habitats.indexOf(a.h) - galaxy.habitats.indexOf(b.h));
    return out.map((x) => x.h);
}

/** The spawn point: beyond the outermost system star in the target's direction from the galaxy centre. Pure. */
export function genShipsSpawnPoint(galaxy: Galaxy, target: Habitat): { x: number; y: number } {
    const cx = galaxy.sizeX / 2;
    const cy = galaxy.sizeY / 2;
    let dx = target.xpos - cx;
    let dy = target.ypos - cy;
    let len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) {
        dx = 1;
        dy = 0;
        len = 1;
    }
    dx /= len;
    dy /= len;
    let far = len;
    for (const sys of galaxy.systems) {
        const s = sys.systemStar;
        if (s === null) continue;
        const sx = s.xpos - cx;
        const sy = s.ypos - cy;
        const proj = sx * dx + sy * dy;
        const perp = Math.abs(sx * dy - sy * dx);
        if (proj > far && perp < proj * 0.35) far = proj;
    }
    const r = far + SPAWN_MARGIN;
    const x = Math.min(galaxy.sizeX - 1000, Math.max(1000, cx + dx * r));
    const y = Math.min(galaxy.sizeY - 1000, Math.max(1000, cy + dy * r));
    return { x, y };
}

/** The world ships' race: always Human (user 2026-10-15); a race no active empire uses only if the data has no Human. */
function pickRace(galaxy: Galaxy, rnd: Random): Race | null {
    const human = galaxy.races.find((r) => r !== null && r.name === 'Human') ?? null;
    if (human !== null) return human;
    const used = new Set(galaxy.empires.filter((e) => e !== null && e.active).map((e) => e.dominantRace));
    const free = galaxy.races.filter((r) => r !== null && r.playable && !used.has(r));
    const pool = free.length > 0 ? free : galaxy.races.filter((r) => r !== null && r.playable);
    return pool.length > 0 ? pool[rnd.next(0, pool.length)] : null;
}

/** The tech level of the outdated components for a target at `ownerLvl`: `gap` below, never below 1. Pure. */
export function genShipsLowLevel(ownerLvl: number, gap: number): number {
    return Math.max(1, Math.trunc(ownerLvl - gap));
}

/**
 * The component definitions the world-ship builders have: every part except reactors, fuel storage and the hyperdrive only up to `low`
 * (the lowest of the family if it has none that old), the hyperdrive the most efficient one of tech <= `hyperTech`,
 * the reactors, fuel storage and everything else up to `top`. Pure.
 */
export function genShipsComponentDefinitions(defs: readonly ComponentDefinition[], low: number, hyperTech: number, top: number): ComponentDefinition[] {
    const lowest = new Map<ComponentType, ComponentDefinition>();
    for (const d of defs) if (OUTDATED_TYPES.has(d.type) && !PLANETARY_ONLY_COMPONENTS.has(d.name) && d.techLevel <= top && (!lowest.has(d.type) || d.techLevel < lowest.get(d.type)!.techLevel)) lowest.set(d.type, d);
    // The hyperdrive: slower but efficient (user 2026-10-15) — the lowest energy use per second (components.txt Value2)
    // of tech <= hyperTech, ties to the slower drive (Calista-Dal WarpDrive with the stock data: 15,000, energy 60).
    let hyper: ComponentDefinition | null = null;
    for (const d of defs) {
        if (d.type !== ComponentType.HyperDrive || d.techLevel > hyperTech) continue;
        if (hyper === null || d.value2 < hyper.value2 || (d.value2 === hyper.value2 && d.value1 < hyper.value1)) hyper = d;
    }
    const out: ComponentDefinition[] = [];
    for (const d of defs) {
        if (d.techLevel > top || PLANETARY_ONLY_COMPONENTS.has(d.name)) continue;
        if (d.type === ComponentType.HyperDrive) {
            if (hyper === null || d === hyper) out.push(d);
        } else if (OUTDATED_TYPES.has(d.type)) {
            if (d.techLevel <= low || lowest.get(d.type) === d) out.push(d);
        } else out.push(d);
    }
    return out;
}

/** Bigger hulls whose extra room is all fuel (user 2026-10-15): copies of the design's own fuel storage adding about
 *  `pct` % of its size, then the stock ReDefine (the same thrust over more mass: slower). Pure apart from `d`. */
function addExtraFuel(d: Design, pct: number): void {
    if (pct <= 0) return;
    const fuel = d.components.filter((c) => c.type === ComponentType.StorageFuel).sort((a, b) => b.value1 - a.value1 || a.componentId - b.componentId)[0];
    if (fuel === undefined || !(fuel.size > 0)) return;
    const n = Math.round((d.size * pct) / 100 / fuel.size);
    for (let i = 0; i < n; i++) d.components.push(fuel);
    if (n > 0) d.reDefine();
}

function factionDesigns(galaxy: Galaxy, faction: Empire, lvl: number): Map<BuiltObjectSubRole, Design> {
    raiseFactionTech(galaxy, faction, lvl);
    const now = galaxyStarDate(galaxy);
    const top = maxDesignTechLevel(galaxy) || lvl;
    const defs = galaxy.researchStatic?.componentStatic?.definitions ?? [];
    const old = genShipsComponentDefinitions(defs, genShipsLowLevel(lvl, P.techGap(galaxy)), P.hyperdriveTech(galaxy), top);
    const out = new Map<BuiltObjectSubRole, Design>();
    for (const sub of DESIGN_SUBROLES) {
        const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === sub) ?? galaxyDesignSpecificationBySubRole(sub);
        let d: Design | null = null;
        if (spec !== null && spec !== undefined) {
            try {
                // Warships: big hulls from outdated parts with top reactors / fuel (the techAdvance path of the stock
                // placement over the filtered definitions); the others at the target's level.
                d = WARSHIP_SUBROLES.has(sub) ? generateDesignFromSpec(galaxy, faction, spec, top, now, old) : generateDesignFromSpec(galaxy, faction, spec, lvl, now);
            } catch {
                d = null;
            }
        }
        if (d === null) d = faction.designs.filter((x) => x.subRole === sub).at(-1) ?? null;
        if (d === null) continue;
        if (WARSHIP_SUBROLES.has(sub)) addExtraFuel(d, P.extraFuelPct(galaxy));
        if (!faction.designs.includes(d)) faction.designs.push(d);
        out.set(sub, d);
    }
    return out;
}

/** As robotMutiny's beacon spawn (GenerateMilitaryConvoy: GenerateNewBuiltObject + TakeOwnershipOfBuiltObject). */
function spawnShip(galaxy: Galaxy, faction: Empire, design: Design, x: number, y: number, name: string | null = null): BuiltObject {
    const pt = galaxy.selectRelativeParkingPoint();
    const bo = generateNewBuiltObject(galaxy, faction, design, null, x + pt.x, y + pt.y);
    takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
    bo.supportCostFactor = 0; // fed by the world ship: no upkeep
    if (name !== null) bo.name = name;
    return bo;
}

function hold(galaxy: Galaxy, bo: BuiltObject, x: number, y: number): void {
    assignMission(galaxy, bo, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x, y, manuallyAssigned: true });
}

function isIdle(bo: BuiltObject): boolean {
    const m = builtObjectMission(bo.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined || m.type === BuiltObjectMissionType.Hold;
}

/** Arrival: the faction, its fleet and the world ship at the galaxy edge. Returns false when nothing could arrive. */
export function genShipsArrive(galaxy: Galaxy, st: GenShipsState): boolean {
    const rnd = ownRandom(galaxy, 0x47534831 + st.index * 0x1111);
    const fixed = P.flavour(galaxy);
    st.flavour = GEN_SHIPS_FLAVOURS[fixed >= 0 && fixed < 4 ? fixed : rnd.next(0, 4)];
    // Each ship of the wave aims at a different empire; the Force start option aims the first at the player.
    const taken = new Set<Empire>();
    for (const o of genShipsStates(galaxy)) if (o !== st && o.owner !== null) taken.add(o.owner);
    let candidates = genShipsTargetCandidates(galaxy).filter((h) => h.empire === null || !taken.has(h.empire));
    const victim = st.index === 0 ? forcedThreatVictim(galaxy, GEN_SHIPS_KEY) : null;
    if (victim !== null) {
        const mine = candidates.filter((h) => h.empire === victim);
        if (mine.length > 0) candidates = mine;
    }
    if (candidates.length === 0) return false;
    const nonCapital = candidates.filter((h) => h.empire === null || h !== h.empire.capital).length;
    const target = candidates[rnd.next(0, Math.max(1, Math.min(5, nonCapital)))];
    const owner = target.empire!;
    const race = pickRace(galaxy, rnd);
    if (race === null) return false;
    const pt = genShipsSpawnPoint(galaxy, target);
    const lvl = Math.max(1, Math.min(empireTechLevel(owner), maxDesignTechLevel(galaxy) || 7));
    const bias = st.flavour === 'pilgrims' ? 0 : st.flavour === 'heirs' ? -20 : st.flavour === 'ark' ? -50 : -100;
    const faction = createThreatFaction(galaxy, { race, name: scenarioText(`${TAG} Faction ${FLAVOUR_TEXT[st.flavour]}`, race.name), techLevel: lvl, relationBias: bias });
    if (faction === null) return false;
    // As ghostArmada / darkFarms: stock AI reads Empire.Capital without a null check; a habitat near the edge stands in
    // until the faction owns a colony (cleared before it takes one, so takeOwnershipOfColonyFull picks the real one).
    faction.capital = galaxy.findNearestHabitatOfType(pt.x, pt.y, HabitatType.Undefined);
    const designs = factionDesigns(galaxy, faction, lvl);
    st.faction = faction;
    st.target = target;
    st.owner = owner;
    st.settleAt = target;
    st.spawnX = st.lastX = pt.x;
    st.spawnY = st.lastY = pt.y;
    st.arrivalDate = galaxyStarDate(galaxy);
    st.contactDate = st.arrivalDate + P.contactDays(galaxy) * GAME_DAY_LENGTH;
    st.ownerStrengthAtSpawn = militaryPotency(owner);
    const want = Math.max(P.minFirepower(galaxy), (st.ownerStrengthAtSpawn * P.fleetFactorPct(galaxy)) / 100);
    // Escort: big hulls (battleships, cruisers), carriers and the screens (destroyers, frigates), each group's designs in
    // a fixed cycle until its share of the firepower is reached; what a missing group leaves is made up by the others.
    let strength = 0;
    const heavyShare = Math.max(0, P.heavyPct(galaxy)) / 100;
    const carrierShare = Math.max(0, P.carrierPct(galaxy)) / 100;
    const groups: { cycle: BuiltObjectSubRole[]; share: number }[] = [
        { cycle: HEAVY_CYCLE.filter((x) => designs.has(x)), share: heavyShare },
        { cycle: CARRIER_CYCLE.filter((x) => designs.has(x)), share: carrierShare },
        { cycle: SCREEN_CYCLE.filter((x) => designs.has(x)), share: Math.max(0, 1 - heavyShare - carrierShare) },
    ];
    const addEscort = (cycle: BuiltObjectSubRole[], n: number): number => {
        const bo = spawnShip(galaxy, faction, designs.get(cycle[n % cycle.length])!, pt.x, pt.y);
        st.escorts.push(bo);
        const f = calculateOverallStrengthFactorWithoutShields(bo);
        strength += f;
        return f;
    };
    for (const g of groups) {
        let got = 0;
        for (let i = 0; g.cycle.length > 0 && got < want * g.share && st.escorts.length < P.maxEscorts(galaxy); i++) got += addEscort(g.cycle, i);
    }
    const fill = groups.flatMap((g) => g.cycle);
    for (let i = 0; fill.length > 0 && strength < want && st.escorts.length < P.maxEscorts(galaxy); i++) addEscort(fill, i);
    st.fleetStrength = strength;
    // Troops: genShipsRegiments per genShipsRegimentFirepower of escort firepower (clamped).
    st.regiments = Math.round(Math.min(P.maxRegiments(galaxy), Math.max(P.minRegiments(galaxy), (P.regiments(galaxy) * strength) / Math.max(1, P.regimentFirepower(galaxy)))));
    const transport = designs.get(BuiltObjectSubRole.TroopTransport) ?? null;
    if (transport !== null) {
        let left = st.regiments;
        let n = 0;
        while (left > 0) {
            const bo = spawnShip(galaxy, faction, transport, pt.x, pt.y);
            const k = Math.min(REGIMENTS_PER_TRANSPORT, left);
            const troops = Array.from({ length: k }, (_, j) => makeFactionTroop(galaxy, faction, P.troopStrength(galaxy), scenarioText(`${TAG} Troop Name`, race.name, ++n + j * 0), race));
            loadTroopsOnto(bo, faction, troops);
            st.transports.push(bo);
            left -= k;
        }
    }
    const colony = designs.get(BuiltObjectSubRole.ColonyShip) ?? designs.get(BuiltObjectSubRole.Cruiser) ?? null;
    if (colony !== null) st.worldShip = spawnShip(galaxy, faction, colony, pt.x, pt.y, scenarioText(`${TAG} World Ship Name ${FLAVOUR_TEXT[st.flavour]}`));
    st.sleepers = Math.round(P.sleepersM(galaxy) * 1e6);
    const scoutDesign = designs.get(BuiltObjectSubRole.ExplorationShip) ?? designs.get(BuiltObjectSubRole.Escort) ?? null;
    if (scoutDesign !== null) {
        const scout = spawnShip(galaxy, faction, scoutDesign, pt.x, pt.y);
        st.scouts.push(scout);
        assignMission(galaxy, scout, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
    }
    for (const b of [...st.escorts, ...st.transports]) hold(galaxy, b, pt.x, pt.y);
    if (st.worldShip !== null) hold(galaxy, st.worldShip, pt.x, pt.y);
    st.phase = 'arrived';
    const where = galaxy.determineHabitatSystemStar(target)?.name ?? target.name;
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Arrival', textTag: `${TAG} Arrival News ${FLAVOUR_TEXT[st.flavour]}`, args: [faction.name, where], subject: st.worldShip });
    for (const e of normalEmpires(galaxy, faction)) revealTo(galaxy, st, e, 1);
    revealTo(galaxy, st, owner, KNOWLEDGE_CONFIRMED);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Contact, ultimatum, the decision
// ---------------------------------------------------------------------------------------------------------------

function ownerMessage(galaxy: Galaxy, st: GenShipsState, stage: string, args: unknown[], type: EmpireMessageType, popup: boolean): void {
    const owner = st.owner;
    if (owner === null || !owner.active) return;
    const key = `${stage}:${owner.empireId}`;
    const got = (st.sentStages[key] ??= []);
    if (got.includes(owner.empireId)) return;
    got.push(owner.empireId);
    const fl = flavourText(st);
    scenarioMessage(galaxy, owner, scenarioText(`${TAG} ${stage} Title ${fl}`), scenarioText(`${TAG} ${stage} ${fl}`, ...args), { type, subject: st.worldShip ?? st.target, popup });
}

function contact(galaxy: Galaxy, st: GenShipsState): void {
    st.phase = 'contact';
    st.ultimatumDate = galaxyStarDate(galaxy) + P.ultimatumDays(galaxy) * GAME_DAY_LENGTH;
    const target = st.target!;
    ownerMessage(galaxy, st, 'Contact', [st.faction!.name, target.name, months(P.ultimatumDays(galaxy)), fmt(st.fleetStrength), st.regiments], EmpireMessageType.GeneralWarning, true);
}

/** A substitute world for the Pilgrims: the nearest empty habitable planet, else the owner's smallest other colony. Pure. */
export function genShipsSubstitute(galaxy: Galaxy, st: GenShipsState): Habitat | null {
    const target = st.target;
    const owner = st.owner;
    if (target === null || owner === null) return null;
    const GOOD = [HabitatType.Continental, HabitatType.Ocean, HabitatType.MarshySwamp, HabitatType.Desert, HabitatType.Ice, HabitatType.Volcanic];
    let best: Habitat | null = null;
    let bestD = Number.MAX_VALUE;
    for (const h of galaxy.habitats) {
        if (h === null || h.hasBeenDestroyed || h.empire !== null || h.population.totalAmount > 0 || h.quality < 0.3) continue;
        if ((h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) || !GOOD.includes(h.type)) continue;
        if (h.basesAtHabitat != null && h.basesAtHabitat.length > 0) continue;
        const d = galaxy.calculateDistance(target.xpos, target.ypos, h.xpos, h.ypos);
        if (d < bestD) {
            bestD = d;
            best = h;
        }
    }
    if (best !== null) return best;
    let small: Habitat | null = null;
    for (const c of owner.colonies) {
        if (c === target || c === owner.capital || c.hasBeenDestroyed) continue;
        if (small === null || c.population.totalAmount < small.population.totalAmount) small = c;
    }
    return small;
}

function ultimatum(galaxy: Galaxy, st: GenShipsState): void {
    st.ownerStrengthAtUltimatum = st.owner !== null ? militaryPotency(st.owner) : 0;
    if (st.flavour === 'quiet' || st.owner === null || !st.owner.active) {
        startWar(galaxy, st);
        return;
    }
    st.phase = 'ultimatum';
    const fl = flavourText(st);
    const options = [{ id: 'cede', label: scenarioText(`${TAG} Option Cede`, st.target!.name) }];
    const sub = st.flavour === 'pilgrims' ? genShipsSubstitute(galaxy, st) : null;
    if (sub !== null) options.push({ id: 'substitute', label: scenarioText(`${TAG} Option Substitute`, sub.name) });
    options.push({ id: 'refuse', label: scenarioText(`${TAG} Option Refuse ${fl}`) });
    raiseScenarioDecision(galaxy, st.owner, {
        kind: DECISION_KIND,
        title: scenarioText(`${TAG} Ultimatum Title ${fl}`),
        text: scenarioText(`${TAG} Ultimatum ${fl}`, st.faction!.name, st.target!.name, fmt(genShipsFleetStrength(st)), st.regiments, months(P.answerDays(galaxy))),
        options,
        defaultOption: 'refuse',
        expiresDays: P.answerDays(galaxy),
        context: { substitute: sub !== null ? galaxy.habitats.indexOf(sub) : -1, index: st.index },
    });
}

const DECISION_KIND = 'genShips.ultimatum';

/** The AI's answer: fight when its navy matches the fleet, else cede (Pilgrims: offer a substitute). Pure. */
export function aiUltimatumChoice(galaxy: Galaxy, st: GenShipsState, options: readonly string[]): string {
    const owner = st.owner;
    if (owner === null) return 'refuse';
    const ratio = (100 * militaryPotency(owner)) / Math.max(1, genShipsFleetStrength(st));
    const fight = P.aiFightRatioPct(galaxy);
    if (ratio >= fight) return 'refuse';
    if (st.flavour === 'pilgrims' && options.includes('substitute')) return 'substitute';
    if (st.flavour === 'heirs' && ratio >= fight * 0.75) return 'refuse';
    return 'cede';
}

function decisionState(galaxy: Galaxy, d: ScenarioDecision): GenShipsState | null {
    const index = typeof d.context.index === 'number' ? d.context.index : 0;
    return genShipsStates(galaxy).find((x) => (x.index ?? 0) === index) ?? null;
}

function resolveUltimatum(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const st = decisionState(galaxy, d);
    if (st === null || st.phase !== 'ultimatum') return;
    st.answer = optionId;
    st.answeredBy = d.answeredBy;
    const faction = st.faction!;
    const owner = st.owner!;
    const fl = flavourText(st);
    if (optionId === 'refuse') {
        startWar(galaxy, st);
        return;
    }
    if (optionId === 'substitute') {
        const idx = typeof d.context.substitute === 'number' ? d.context.substitute : -1;
        const sub = idx >= 0 ? galaxy.habitats[idx] : null;
        if (sub === null || sub === undefined || sub.hasBeenDestroyed || (sub.empire !== null && sub.empire !== owner)) {
            startWar(galaxy, st);
            return;
        }
        if (sub.empire === owner) {
            faction.capital = null;
            takeOwnershipOfColonyFull(galaxy, owner, sub, faction, false, true);
        }
        st.settleAt = sub;
        st.outcome = 'substitute';
    } else {
        faction.capital = null;
        takeOwnershipOfColonyFull(galaxy, owner, st.target!, faction, false, true);
        st.outcome = 'ceded';
    }
    beginSettling(galaxy, st);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Agreed', textTag: `${TAG} Agreed News ${fl}`, args: [owner.name, faction.name, st.settleAt!.name] });
}

// ---------------------------------------------------------------------------------------------------------------
// War
// ---------------------------------------------------------------------------------------------------------------

function startWar(galaxy: Galaxy, st: GenShipsState): void {
    const faction = st.faction!;
    const owner = st.owner;
    st.phase = 'war';
    st.warDate = galaxyStarDate(galaxy);
    if (owner !== null && owner.active) lockWar(galaxy, faction, owner);
    const fl = flavourText(st);
    if (st.flavour !== 'quiet') arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'War', textTag: `${TAG} War News ${fl}`, args: [faction.name, owner?.name ?? '', st.target?.name ?? ''] });
    else ownerMessage(galaxy, st, 'Moves', [st.target?.name ?? ''], EmpireMessageType.GeneralWarning, false);
}

/** The owner's gas mining stations within the strike fleets' reach (the faction's spawn point), nearest first. Pure. */
export function genShipsStrikeTargets(galaxy: Galaxy, st: GenShipsState): BuiltObject[] {
    const owner = st.owner;
    if (owner === null || !owner.active) return [];
    const reach = P.strikeReachSectors(galaxy) * galaxy.sectorSize;
    const out: { b: BuiltObject; d: number }[] = [];
    // Mining stations are mostly private-sector (Empire.PrivateBuiltObjects), so both lists.
    const all = [...owner.builtObjects, ...owner.privateBuiltObjects];
    for (const b of all) {
        if (b.hasBeenDestroyed || b.subRole !== BuiltObjectSubRole.GasMiningStation) continue;
        const d = galaxy.calculateDistance(st.spawnX, st.spawnY, b.xpos, b.ypos);
        if (d <= reach) out.push({ b, d });
    }
    out.sort((a, b) => a.d - b.d || all.indexOf(a.b) - all.indexOf(b.b));
    return out.map((x) => x.b);
}

/**
 * The opening of the war for Heirs / Ark Faith / Quiet Ship: the screens (destroyers and frigates; else the lightest
 * half of the escort) go out in up to genShipsStrikeGroups strike fleets against the owner's gas mining stations, to
 * cripple its fuel; the rest of the fleet and the transports wait at the edge. Returns true while the strike goes on;
 * when no station is left within reach or genShipsStrikeDays have passed it ends and every fleet regroups (the assault
 * on the colony). Missions only, no Rnd.
 */
function directStrike(galaxy: Galaxy, st: GenShipsState): boolean {
    const now = galaxyStarDate(galaxy);
    if (st.strikeStart === 0) st.strikeStart = now;
    for (const t of st.strikeTargets) if (t.hasBeenDestroyed) st.stationsHit++;
    st.strikeTargets = st.strikeTargets.filter((t) => !t.hasBeenDestroyed);
    const stations = genShipsStrikeTargets(galaxy, st);
    const late = now - st.strikeStart > P.strikeDays(galaxy) * GAME_DAY_LENGTH;
    if (stations.length === 0 || late || st.escorts.length === 0) {
        st.strikeDone = true;
        st.strikeTargets = [];
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Regroup', textTag: `${TAG} Regroup News`, args: [st.faction!.name, st.owner?.name ?? '', st.stationsHit, st.target?.name ?? ''] });
        return false;
    }
    let strikers = st.escorts.filter((b) => SCREEN_SUBROLES.has(b.subRole));
    if (strikers.length === 0) strikers = [...st.escorts].sort((a, b) => calculateOverallStrengthFactorWithoutShields(a) - calculateOverallStrengthFactorWithoutShields(b)).slice(0, Math.max(1, Math.floor(st.escorts.length / 2)));
    const groups = Math.max(1, Math.min(P.strikeGroups(galaxy), stations.length, strikers.length));
    st.strikeTargets = stations.slice(0, groups);
    strikers.forEach((bo, i) => {
        const goal = st.strikeTargets[i % groups];
        const m = builtObjectMission(bo.mission);
        if (m === null || m.type !== BuiltObjectMissionType.Attack || m.targetBuiltObject !== goal) {
            assignMission(galaxy, bo, BuiltObjectMissionType.Attack, goal, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        }
    });
    for (const b of [...st.escorts.filter((x) => !strikers.includes(x)), ...st.transports]) if (isIdle(b)) hold(galaxy, b, st.spawnX, st.spawnY);
    if (st.sentStages['Strike'] === undefined) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Strike', textTag: `${TAG} Strike News`, args: [st.faction!.name, st.owner?.name ?? '', stations.length] });
    }
    return true;
}

function directWar(galaxy: Galaxy, st: GenShipsState): void {
    const faction = st.faction!;
    const target = st.target!;
    // Third party took the target: at war with it too. Target gone: the owner's nearest colony.
    if (target.hasBeenDestroyed) {
        const next = st.owner !== null ? nearestColony(galaxy, st.owner, st.spawnX, st.spawnY) : null;
        if (next === null) return endScatter(galaxy, st, 'repelled');
        st.target = st.settleAt = next;
        return;
    }
    if (target.empire === faction) {
        st.outcome = 'conquered';
        beginSettling(galaxy, st);
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Conquered', textTag: `${TAG} Conquered News ${flavourText(st)}`, args: [faction.name, target.name, st.owner?.name ?? ''] });
        return;
    }
    if (target.empire !== null && target.empire !== st.owner && target.empire !== galaxy.independentEmpire && !obtainDiplomaticRelation(faction, target.empire).locked) lockWar(galaxy, faction, target.empire);
    if (st.flavour !== 'pilgrims' && !st.strikeDone && directStrike(galaxy, st)) return;
    const escorts = st.escorts;
    const holder = target.empire;
    if (holder !== null && holder === st.owner) commitDefence(galaxy, st, holder, target);
    let onStation = 0;
    for (const bo of escorts) {
        if (galaxy.calculateDistance(bo.xpos, bo.ypos, target.xpos, target.ypos) <= STATION_RANGE) onStation++;
        const m = builtObjectMission(bo.mission);
        if (m === null || m.type !== BuiltObjectMissionType.Attack || m.targetHabitat !== target) {
            assignMission(galaxy, bo, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        }
    }
    let defenders = 0;
    if (holder !== null) {
        for (const b of holder.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0) continue;
            if (galaxy.calculateDistance(b.xpos, b.ypos, target.xpos, target.ypos) <= STATION_RANGE) defenders++;
        }
    }
    // Transports wait at a staging point (STATION_RANGE × 3 short of the world, on the edge side) until half the
    // escort is on station and no defending warship is near, then close in and land (the stock landing of a troop ship
    // attacking a colony, cmdAttack.ts ~590, done here as darkFarms.directFaction does). Move orders only: an Attack
    // order would let the stock command land them past the defenders.
    const clear = defenders === 0 && (escorts.length === 0 || onStation * 2 >= escorts.length);
    const dx = st.spawnX - target.xpos;
    const dy = st.spawnY - target.ypos;
    const dl = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const stageX = target.xpos + (dx / dl) * STATION_RANGE * 3;
    const stageY = target.ypos + (dy / dl) * STATION_RANGE * 3;
    for (const bo of st.transports) {
        if (bo.troops === null || bo.troops.count === 0) continue;
        if (clear && galaxy.calculateDistance(bo.xpos, bo.ypos, target.xpos, target.ypos) <= LANDING_RANGE) {
            const troops = [...bo.troops.items];
            bo.troops.clear();
            for (const t of troops) t.builtObject = null;
            invadeFromInside(galaxy, target, faction, troops);
            st.landings++;
            continue;
        }
        const m = builtObjectMission(bo.mission);
        if (clear) {
            if (m === null || m.type !== BuiltObjectMissionType.Move || m.targetHabitat !== target) {
                assignMission(galaxy, bo, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
            }
        } else if (galaxy.calculateDistance(bo.xpos, bo.ypos, stageX, stageY) > LANDING_RANGE && (m === null || m.type !== BuiltObjectMissionType.Move || m.targetHabitat !== null)) {
            hold(galaxy, bo, stageX, stageY);
        }
    }
    const troopsLeft = st.transports.some((b) => b.troops !== null && b.troops.count > 0) || (target.invadingTroops !== null && target.invadingTroops.items.some((t) => t.empire === faction));
    const tooLong = galaxyStarDate(galaxy) - st.warDate > P.warYears(galaxy) * YEAR_LENGTH;
    if ((escorts.length === 0 && !troopsLeft) || tooLong) endScatter(galaxy, st, 'repelled');
}

/**
 * The threatened AI commits its navy (a human decides for themself): its mobile warships not already fighting near the
 * world hold position over the target (Patrol, as the stock defend-colony missions), and attack an escort that comes
 * within STATION_RANGE × 3 of it. Missions only, no Rnd.
 */
function commitDefence(galaxy: Galaxy, st: GenShipsState, owner: Empire, target: Habitat): void {
    if (isHumanEmpire(galaxy, owner)) return;
    let near: BuiltObject | null = null;
    let nearD = STATION_RANGE * 3;
    for (const e of st.escorts) {
        const d = galaxy.calculateDistance(e.xpos, e.ypos, target.xpos, target.ypos);
        if (d < nearD) {
            nearD = d;
            near = e;
        }
    }
    // Fleets first (the fleet AI would override a member's own order): the whole fleet takes the order.
    for (const sg of empireShipGroups(owner)) {
        if (sg === null || sg.ships.length === 0) continue;
        const m = sg.mission;
        if (near !== null) {
            if (m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject !== null && !m.targetBuiltObject.hasBeenDestroyed && m.targetBuiltObject.actualEmpire === st.faction) continue;
            shipGroupAssignMission(galaxy, sg, BuiltObjectMissionType.Attack, near, null, BuiltObjectMissionPriority.High, true);
        } else if (m === null || !(m.type === BuiltObjectMissionType.Patrol && m.targetHabitat === target)) {
            shipGroupAssignMission(galaxy, sg, BuiltObjectMissionType.Patrol, target, null, BuiltObjectMissionPriority.High, true);
        }
    }
    for (const b of owner.builtObjects) {
        if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0 || b.subRole === BuiltObjectSubRole.TroopTransport) continue;
        if (b.shipGroup !== null) continue;
        const m = builtObjectMission(b.mission);
        if (near !== null) {
            if (m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject !== null && !m.targetBuiltObject.hasBeenDestroyed && m.targetBuiltObject.actualEmpire === st.faction) continue;
            assignMission(galaxy, b, BuiltObjectMissionType.Attack, near, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        } else if (m === null || !(m.type === BuiltObjectMissionType.Patrol && m.targetHabitat === target) && m.type !== BuiltObjectMissionType.Refuel && m.type !== BuiltObjectMissionType.Repair) {
            assignMission(galaxy, b, BuiltObjectMissionType.Patrol, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        }
    }
}

/**
 * The threatened AI recruits infantry at the world (Habitat.GenerateNewTroop into TroopsToRecruit, as the stock
 * garrison review recruits, troops.ts 812) while its garrison, recruits included, is below genShipsAiGarrisonPct % of
 * the invaders' attack strength; at most 3 in training at once.
 */
function levyGarrison(galaxy: Galaxy, st: GenShipsState, owner: Empire, target: Habitat): void {
    if (!owner.troopCanRecruitInfantry || target.troops === null || target.troopsToRecruit === null || target.troopsToRecruit.count >= 3) return;
    let invaders = 0;
    for (const b of st.transports) if (b.troops !== null) invaders += b.troops.totalAttackStrength;
    const have = target.troops.totalDefendStrengthExcludeReadiness + target.troopsToRecruit.totalDefendStrengthExcludeReadiness;
    if (have >= (invaders * P.aiGarrisonPct(galaxy)) / 100) return;
    const t = habitatGenerateNewTroop(galaxy, target, TroopType.Infantry, null, false);
    if (t !== null) target.troopsToRecruit.add(t);
}

function nearestColony(galaxy: Galaxy, empire: Empire, x: number, y: number): Habitat | null {
    let best: Habitat | null = null;
    let bestD = Number.MAX_VALUE;
    for (const c of empire.colonies) {
        if (c.hasBeenDestroyed) continue;
        const d = galaxy.calculateDistance(x, y, c.xpos, c.ypos);
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    return best;
}

function isGasGiant(h: Habitat): boolean {
    return h.type === HabitatType.GasGiant || h.type === HabitatType.FrozenGasGiant;
}

/**
 * Where the survivors' pirate base goes: the free gas giant nearest to where the world ship was whose gas is the fuel
 * their reactors burn (the fuel of the first survivor with a fuel type); failing that the nearest free gas giant with
 * any fuel. Pure.
 */
export function genShipsPirateBase(galaxy: Galaxy, x: number, y: number, ships: readonly BuiltObject[]): Habitat | null {
    const wanted = ships.find((b) => b.fuelType !== null)?.fuelType?.resourceId ?? -1;
    const anyFuel = new Set(galaxy.resourceSystem.fuelResources.map((r) => r.resourceId));
    let best: Habitat | null = null;
    let bestD = Number.MAX_VALUE;
    let fallback: Habitat | null = null;
    let fallbackD = Number.MAX_VALUE;
    for (const h of galaxy.habitats) {
        if (h === null || h.hasBeenDestroyed || !isGasGiant(h) || h.empire !== null || h.population.totalAmount > 0) continue;
        if (h.basesAtHabitat != null && h.basesAtHabitat.length > 0) continue;
        const d = galaxy.calculateDistance(x, y, h.xpos, h.ypos);
        if (d < bestD && h.resources.some((r) => r.resourceId === wanted)) {
            bestD = d;
            best = h;
        }
        if (d < fallbackD && h.resources.some((r) => anyFuel.has(r.resourceId))) {
            fallbackD = d;
            fallback = h;
        }
    }
    return best ?? fallback;
}

/**
 * The faction is beaten or has given up: the survivors become a pirate faction (the stock pirate-faction creation:
 * base, construction ship, freighters, mining stations) on a gas giant near where the world ship was, and every
 * surviving ship is handed over, upkeep-free. Returns false (nothing changed) when there is nothing to hand over or no
 * base site / empire slot.
 */
function becomePirates(galaxy: Galaxy, st: GenShipsState): boolean {
    const faction = st.faction!;
    const ships = faction.builtObjects.filter((b) => !b.hasBeenDestroyed && b.topSpeed > 0);
    if (ships.length === 0) return false;
    const ws = st.worldShip;
    const x = ws !== null && !ws.hasBeenDestroyed ? ws.xpos : st.lastX;
    const y = ws !== null && !ws.hasBeenDestroyed ? ws.ypos : st.lastY;
    const base = genShipsPirateBase(galaxy, x, y, st.escorts.length > 0 ? st.escorts : ships);
    if (base === null || faction.dominantRace === null) return false;
    const pirate = createThreatFaction(galaxy, { race: faction.dominantRace, name: scenarioText(`${TAG} Pirate Name`, faction.name), kind: 'pirate', home: base });
    if (pirate === null) return false;
    st.pirate = pirate;
    st.pirateBase = base;
    for (const b of ships) {
        takeOwnershipOfBuiltObject(galaxy, pirate, b, pirate, false);
        b.supportCostFactor = 0;
        st.pirateShips.push(b);
        hold(galaxy, b, base.xpos, base.ypos);
    }
    if (st.owner !== null && st.owner.active) lockWar(galaxy, pirate, st.owner);
    return true;
}

/** The faction gives up: the survivors turn pirate (becomePirates); with none, or no base site, every remaining ship scatters (torn down). */
function endScatter(galaxy: Galaxy, st: GenShipsState, outcome: GenShipsOutcome): void {
    const faction = st.faction!;
    if (st.outcome === null || outcome !== 'repelled') st.outcome = outcome;
    if (st.worldShipFate === null) st.worldShipFate = 'scattered';
    if (becomePirates(galaxy, st)) {
        st.phase = 'ended';
        st.endDate = galaxyStarDate(galaxy);
        if (st.worldShip !== null && st.worldShip.actualEmpire !== faction) st.worldShip = null;
        st.escorts = [];
        st.transports = [];
        st.scouts = [];
        teardownIfDead(galaxy, faction);
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Pirates', textTag: `${TAG} Pirates News`, args: [faction.name, st.owner?.name ?? '', st.pirateBase?.name ?? '', st.pirate!.name] });
        return;
    }
    st.phase = 'ended';
    st.endDate = galaxyStarDate(galaxy);
    const ws = st.worldShip;
    st.worldShip = null;
    for (const b of [...faction.builtObjects]) if (!b.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, b);
    if (ws !== null && !ws.hasBeenDestroyed && ws.actualEmpire === faction) builtObjectCompleteTeardown(galaxy, ws);
    st.escorts = [];
    st.transports = [];
    st.scouts = [];
    teardownIfDead(galaxy, faction);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Scatter', textTag: `${TAG} Scatter News ${flavourText(st)}`, args: [faction.name, st.owner?.name ?? ''] });
}

// ---------------------------------------------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------------------------------------------

function beginSettling(galaxy: Galaxy, st: GenShipsState): void {
    st.phase = 'settling';
    st.settleDate = galaxyStarDate(galaxy);
    const faction = st.faction!;
    const owner = st.owner;
    // Peace (the locked war ends) and the after-story relations.
    if (owner !== null && owner.active) {
        const a = obtainDiplomaticRelation(faction, owner);
        const b = obtainDiplomaticRelation(owner, faction);
        a.locked = false;
        b.locked = false;
        if (a.type === DiplomaticRelationType.War) changeDiplomaticRelation(galaxy, faction, a, DiplomaticRelationType.None);
        if (st.flavour === 'pilgrims' && st.outcome !== 'conquered') {
            applyReputation(galaxy, faction, owner, P.gratitude(galaxy), { cause: 'genShips.gratitude', labelKey: 'GenShips Reputation Gratitude', source: 'generation-ships', decayPerYear: 0, term: 'bias' });
            applyReputation(galaxy, owner, faction, P.gratitude(galaxy) / 2, { cause: 'genShips.gratitude', labelKey: 'GenShips Reputation Gratitude', source: 'generation-ships', decayPerYear: 0, term: 'bias' });
            changeDiplomaticRelation(galaxy, owner, obtainDiplomaticRelation(owner, faction), DiplomaticRelationType.Protectorate);
        } else if (st.flavour === 'heirs') {
            applyReputation(galaxy, faction, owner, -P.grudge(galaxy), { cause: 'genShips.grudge', labelKey: 'GenShips Reputation Grudge', source: 'generation-ships', decayPerYear: 0, term: 'bias' });
        }
    }
    for (const bo of st.escorts) hold(galaxy, bo, st.settleAt!.xpos, st.settleAt!.ypos);
    if (st.worldShip !== null && alive(st.worldShip, faction)) {
        assignMission(galaxy, st.worldShip, BuiltObjectMissionType.Move, st.settleAt, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
    }
}

function directSettling(galaxy: Galaxy, st: GenShipsState): void {
    const faction = st.faction!;
    const at = st.settleAt!;
    const ws = st.worldShip;
    const arrived = ws === null || galaxy.calculateDistance(ws.xpos, ws.ypos, at.xpos, at.ypos) <= ARRIVE_RANGE;
    const late = galaxyStarDate(galaxy) - st.settleDate > 180 * GAME_DAY_LENGTH;
    if (!arrived && !late) {
        if (ws !== null && isIdle(ws)) assignMission(galaxy, ws, BuiltObjectMissionType.Move, at, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        return;
    }
    if (at.hasBeenDestroyed || (at.empire !== null && at.empire !== faction)) {
        endScatter(galaxy, st, 'repelled');
        return;
    }
    const race = faction.dominantRace!;
    const sleepers = ws !== null ? st.sleepers : 0;
    if (at.empire === null) {
        // Empire.1.cs 16 MakeHabitatIntoColony, as the stock Colonize command (cmdTroops.ts cmdColonize).
        faction.capital = null;
        makeHabitatIntoColonyRuntime(galaxy, faction, at, faction, race, Math.max(1e6, sleepers));
        reviewEmpireTerritory(galaxy, true);
        scenarioEmit(galaxy, 'colonyFounded', { colony: at, empire: faction, joined: false });
    } else if (sleepers > 0) {
        addPopulation(galaxy, at, race, sleepers);
    }
    if (faction.capital === null || faction.capital.empire !== faction) faction.capital = at;
    st.worldShip = null;
    if (ws !== null) {
        st.worldShipFate = 'landed';
        builtObjectCompleteTeardown(galaxy, ws);
    }
    st.phase = 'settled';
    st.endDate = galaxyStarDate(galaxy);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Settled', textTag: `${TAG} Settled News ${flavourText(st)}`, args: [faction.name, at.name] });
}

function addPopulation(galaxy: Galaxy, h: Habitat, race: Race, amount: number): void {
    if (h.population == null) h.population = new PopulationList();
    h.population.add(new Population(race, amount, galaxy));
    h.population.recalculateTotalAmount();
}

// ---------------------------------------------------------------------------------------------------------------
// The world ship's fate (events)
// ---------------------------------------------------------------------------------------------------------------

function stateOfWorldShip(galaxy: Galaxy, bo: BuiltObject): GenShipsState | null {
    return genShipsStates(galaxy).find((x) => x.worldShip === bo) ?? null;
}

function onOwnerChanged(galaxy: Galaxy, bo: BuiltObject, to: Empire | null): void {
    const st = stateOfWorldShip(galaxy, bo);
    if (st === null || to === null || to === st.faction || to === st.pirate) return;
    st.worldShip = null;
    st.worldShipFate = 'captured';
    st.worldShipTaker = to;
    const home = nearestColony(galaxy, to, bo.xpos, bo.ypos);
    const race = st.faction?.dominantRace ?? null;
    if (home !== null && race !== null) addPopulation(galaxy, home, race, st.sleepers);
    if (isHumanEmpire(galaxy, to)) scenarioMessage(galaxy, to, scenarioText(`${TAG} Captured Title`), scenarioText(`${TAG} Captured`, bo.name, home?.name ?? ''), { type: EmpireMessageType.GeneralGoodEvent, subject: home, popup: false });
    grantArchiveCore(galaxy, to, 'worldShip', bo.name);
    if (st.phase !== 'settled' && st.phase !== 'ended' && st.faction !== null && st.faction.colonies.length === 0) endScatter(galaxy, st, 'captured');
}

function onKilledBy(galaxy: Galaxy, bo: BuiltObject, destroyer: Empire | null): void {
    const st = stateOfWorldShip(galaxy, bo);
    if (st === null) return;
    st.worldShip = null;
    st.worldShipFate = 'destroyed';
    st.worldShipTaker = destroyer;
    if (!scenarioFlag(galaxy, WRECKAGE_FLAG)) generateDebrisField(galaxy, bo.xpos, bo.ypos, scenarioText(`${TAG} Wreck Field`, bo.name), 10);
    const rnd = ownRandom(galaxy, 0x57524b31 ^ Math.trunc(galaxyStarDate(galaxy)));
    if (destroyer !== null && rnd.nextDouble() * 100 < P.coreOnKillPct(galaxy)) grantArchiveCore(galaxy, destroyer, 'worldShip', bo.name);
    if (st.phase !== 'settled' && st.phase !== 'ended' && st.faction !== null && st.faction.colonies.length === 0) endScatter(galaxy, st, 'destroyed');
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic driver
// ---------------------------------------------------------------------------------------------------------------

export function genShipsPeriodic(galaxy: Galaxy): void {
    if (!threatExists(galaxy, GEN_SHIPS_KEY)) return; // §0 rarity: not this game — no state, no draws.
    const first = genShipsState(galaxy);
    if (first.phase === 'waiting') {
        if (!genShipsTriggerReady(galaxy)) return;
        if (!genShipsArrive(galaxy, first)) {
            first.phase = 'ended';
            return;
        }
        first.planned = genShipsWaveSize(normalEmpires(galaxy).length, P.empiresPerShip(galaxy));
        first.spawned = 1;
        first.nextDate = first.arrivalDate + staggerDays(galaxy, 1);
        return;
    }
    // The rest of the wave: one more ship every 2-4 years, each aimed at another empire.
    if ((first.spawned ?? 1) < (first.planned ?? 1) && galaxyStarDate(galaxy) >= (first.nextDate ?? 0)) {
        const k = first.spawned;
        const next = threatState(galaxy, instanceKey(k), newState);
        next.index = k;
        if (!genShipsArrive(galaxy, next)) next.phase = 'ended';
        first.spawned = k + 1;
        first.nextDate = galaxyStarDate(galaxy) + staggerDays(galaxy, k + 1);
    }
    for (const st of genShipsStates(galaxy)) driveInstance(galaxy, st);
}

/** Days until the wave's ship `k`: the stagger window, drawn from the scenario's own Random. */
function staggerDays(galaxy: Galaxy, k: number): number {
    const lo = Math.min(P.staggerMinYears(galaxy), P.staggerMaxYears(galaxy));
    const hi = Math.max(P.staggerMinYears(galaxy), P.staggerMaxYears(galaxy));
    return (lo + ownRandom(galaxy, 0x47534832 + k * 0x1111).nextDouble() * (hi - lo)) * YEAR_LENGTH;
}

/** The pirate remnants harass the empire the generation ship was aimed at: idle ones go for its nearest non-military assets. */
function harass(galaxy: Galaxy, st: GenShipsState): void {
    const pirate = st.pirate;
    const owner = st.owner;
    if (pirate === null || !pirate.active) return;
    st.pirateShips = st.pirateShips.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === pirate);
    if (owner === null || !owner.active) return;
    for (const b of st.pirateShips) {
        if (b.role !== BuiltObjectRole.Military || b.shipGroup !== null || !isIdle(b)) continue;
        let goal: BuiltObject | null = null;
        let goalD = Number.MAX_VALUE;
        for (const t of owner.builtObjects) {
            if (t.hasBeenDestroyed || t.role === BuiltObjectRole.Military) continue;
            const d = galaxy.calculateDistance(b.xpos, b.ypos, t.xpos, t.ypos);
            if (d < goalD) {
                goalD = d;
                goal = t;
            }
        }
        if (goal !== null) assignMission(galaxy, b, BuiltObjectMissionType.Attack, goal, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
    }
}

function driveInstance(galaxy: Galaxy, st: GenShipsState): void {
    if (st.pirate !== null) harass(galaxy, st);
    if (st.phase === 'waiting' || st.phase === 'settled' || st.phase === 'ended') return;
    const faction = st.faction;
    if (faction === null || !faction.active) {
        // Wiped out in battle (the stock teardown of an empire with nothing left) before any other ending.
        st.outcome ??= 'repelled';
        st.worldShipFate ??= 'destroyed';
        st.phase = 'ended';
        st.endDate = galaxyStarDate(galaxy);
        return;
    }
    st.escorts = st.escorts.filter((b) => alive(b, faction));
    st.transports = st.transports.filter((b) => alive(b, faction));
    st.scouts = st.scouts.filter((b) => alive(b, faction));
    if (st.worldShip !== null && !alive(st.worldShip, faction)) st.worldShip = null;
    if (st.worldShip !== null) {
        st.lastX = st.worldShip.xpos;
        st.lastY = st.worldShip.ypos;
    }
    const now = galaxyStarDate(galaxy);
    switch (st.phase) {
        case 'arrived': {
            const scout = st.scouts[0];
            const near = scout !== undefined && st.target !== null && galaxy.calculateDistance(scout.xpos, scout.ypos, st.target.xpos, st.target.ypos) <= STATION_RANGE * 3;
            if (now >= st.contactDate || near) contact(galaxy, st);
            break;
        }
        case 'contact':
            if (now >= st.ultimatumDate) ultimatum(galaxy, st);
            break;
        case 'war':
            directWar(galaxy, st);
            break;
        case 'settling':
            directSettling(galaxy, st);
            break;
        default:
            break;
    }
    // From first contact the threatened AI gathers its navy over the world (it has 18 months to get there) and raises
    // its garrison there.
    if ((st.phase === 'contact' || st.phase === 'ultimatum' || st.phase === 'war') && st.owner !== null && st.target !== null && st.target.empire === st.owner && !isHumanEmpire(galaxy, st.owner)) {
        if (st.phase !== 'war') commitDefence(galaxy, st, st.owner, st.target);
        levyGarrison(galaxy, st, st.owner, st.target);
    }
    if (st.phase === 'arrived' || st.phase === 'contact' || st.phase === 'ultimatum') {
        for (const b of [...st.escorts, ...st.transports]) if (isIdle(b)) hold(galaxy, b, st.spawnX, st.spawnY);
        if (st.worldShip !== null && isIdle(st.worldShip)) hold(galaxy, st.worldShip, st.spawnX, st.spawnY);
    }
    if (st.worldShip === null && st.faction !== null && st.faction.colonies.length === 0 && (st.phase === 'war' || st.phase === 'contact' || st.phase === 'ultimatum' || st.phase === 'arrived')) {
        endScatter(galaxy, st, st.worldShipFate === 'captured' ? 'captured' : 'destroyed');
    }
}

// ---------------------------------------------------------------------------------------------------------------
// AI build-up and the faction's dormant state AI
// ---------------------------------------------------------------------------------------------------------------

function threatened(galaxy: Galaxy, empire: Empire): boolean {
    return genShipsStates(galaxy).some((st) => st.owner === empire && (st.phase === 'contact' || st.phase === 'ultimatum' || st.phase === 'war'));
}

function factionDormant(galaxy: Galaxy, empire: Empire): boolean {
    return genShipsStates(galaxy).some((st) => st.faction === empire && st.phase !== 'settled' && st.phase !== 'ended');
}

// ---------------------------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------------------------

export function genShipsKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const out: KnownThreatSite[] = [];
    for (const st of genShipsStates(galaxy)) {
        if (st.worldShip === null || st.phase === 'settled' || st.phase === 'ended') continue;
        const level = st.knowledge.find((k) => k.empireId === empire.empireId)?.level ?? 0;
        if (level <= 0) continue;
        out.push({ threat: GEN_SHIPS_KEY, kind: 'ship', target: st.worldShip, level, site: st, label: scenarioText(`${TAG} Site Row ${flavourText(st)}`) });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const GEN_SHIPS_HANDLER_IDS = ['genShips.periodic', 'genShips.ownerChanged', 'genShips.killedBy'] as const;

export function registerGenerationShips(): void {
    registerThreatExistence(GEN_SHIPS_KEY, GEN_SHIPS_FLAG);
    registerScenarioPeriodic({ id: 'genShips.periodic', flag: GEN_SHIPS_FLAG, periodDays: PERIOD_DAYS, order: 12, run: (g) => genShipsPeriodic(g) });
    registerScenarioEvent({ id: 'genShips.ownerChanged', flag: GEN_SHIPS_FLAG, event: 'builtObjectOwnerChanged', run: (g, e) => onOwnerChanged(g, e.builtObject, e.to) });
    registerScenarioEvent({ id: 'genShips.killedBy', flag: GEN_SHIPS_FLAG, event: 'builtObjectKilledBy', run: (g, e) => onKilledBy(g, e.builtObject, e.destroyer) });
    registerScenarioDecision({
        id: 'genShips.decision',
        kind: DECISION_KIND,
        flag: GEN_SHIPS_FLAG,
        resolve: resolveUltimatum,
        aiChoose: (g, d) => {
            const st = decisionState(g, d);
            return st === null ? d.defaultOption : aiUltimatumChoice(g, st, d.options.map((o) => o.id));
        },
    });
    registerScenarioQuery({ id: 'genShips.buildupThreat', flag: GEN_SHIPS_FLAG, query: 'forceStructureThreat', run: (g, v, a) => (threatened(g, a.empire) ? Math.max(v, 4) : v) });
    registerScenarioQuery({
        id: 'genShips.buildupWarships',
        flag: GEN_SHIPS_FLAG,
        query: 'forceStructureWarships',
        run: (g, v, a) => (threatened(g, a.empire) ? Math.max(v, (v * P.aiBuildupPct(g)) / 100) : v),
    });
    registerScenarioQuery({ id: 'genShips.buildupBudget', flag: GEN_SHIPS_FLAG, query: 'stateConstructionBudget', run: (g, v, a) => (threatened(g, a.empire) ? Math.max(v, a.projectedSupport) : v) });
    registerScenarioQuery({ id: 'genShips.factionDormant', flag: GEN_SHIPS_FLAG, query: 'stateAIDormant', run: (g, v, a) => v || factionDormant(g, a.empire) });
    registerThreatKnownSites(GEN_SHIPS_KEY, genShipsKnownSites);
}

registerGenerationShips();
