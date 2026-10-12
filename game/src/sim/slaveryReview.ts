// Slavery add-on review (scenarios/slavery; docs/DARK_THEMES.md §1; the pure rules are slavery.ts). Not a port. Runs from
// the empire's intermediate block right after the stock ReviewColonyPopulationPolicy (tick/empireTick.ts):
//
//   - bookkeeping on the stock Empire.penalColonies list: colonies on it are adopted (Habitat.slavery), lost ones
//     dropped (one that rebelled away to independence counts as a breakaway); with the switch (the stock "Use Penal
//     Colonies to implement 'Enslave' policy") off, or no Enslave population policy left at a colony, it is released;
//   - the reputation stain: every empire whose switch is off loses attitude toward the slaver, per penal colony and
//     year (reputation/ledger.ts applyReputation: the ledger when the Reputation add-on runs, else the stock
//     IncidentEvaluation); the stock slaveryOffense line (colonyTick.ts) stays as well;
//   - labour convoys (the Voidbloom / Refugees convoy pattern: a pre-loaded passenger ship on a Transport mission):
//     people under the Enslave population policy at the empire's other colonies (which lose them) are shipped to its
//     penal colonies until they reach their target workers; workers die off slowly there, so convoys keep coming. The
//     AI sets Enslave on the people it ships; the player chooses whom to enslave with the stock colony drop-downs;
//   - the AI (replacing the stock IdentifyBestNewPenalColonies): sets the switch from its SPECIES (Race aggression /
//     friendliness / loyalty, races.txt) and GOVERNMENT (a weight per governments.txt row; democracies and utopias
//     never), only when a luxury- or rare-rich colony would earn more as a penal colony after the garrison's upkeep,
//     and designates such colonies only while it can pay the garrison AND staff them (workers there plus enslavable
//     people elsewhere not yet promised ≥ AI_MIN_STAFF_SHARE).
//
// Rnd: none (every choice is a deterministic score; ties go to the lower habitat index). Human empires choose for
// themselves (the stock Policy screen switch; the Colonies window's "Make / Release penal colony"; journaled ops).
// Runs only with the add-on on (tick/empireTick.ts).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { Habitat } from './types';
import { TroopType } from './cargo';
import { calculateCostPerTroop, troopLevelRequiredStock } from './troops';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from './tick/simTime';
import { isHumanEmpire } from './humanEmpires';
import { galaxyResourceCurrentPrices } from './design';
import { applyReputation } from './scenario/reputation/ledger';
import { Population, PopulationList } from './population';
import { recalculateEmpirePopulation } from './taxes';
import { generateDesignFromSpec } from './designGeneration';
import { generateNewBuiltObject } from './empireEvents';
import { assignMission } from './missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from './missions/mission';
import { builtObjectCompleteTeardown } from './combat/teardown';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { GAME_DAY_LENGTH } from './scenario/hooks';
import { scenarioEmit } from './scenario/hooks';
import {
    SLAVERY_PARAMS,
    isPenalColony,
    isPenalResource,
    penalGarrisonFor,
    penalGarrisonRequired,
    penalResourceMultiplier,
    penalTargetWorkers,
    penalWorkers,
    penalYears,
    populationPolicyFor,
    slaveryAllowed,
    slaveryOn,
    type SlaveryEmpireState,
} from './slavery';
import { ColonyPopulationPolicy } from './data/policies';
import type { Race } from './data/races';

/**
 * Adoption weight per government (governments.txt GovernmentId → weight; null = never allows slavery). Authoritarian,
 * collective and oligarchic rule lean to it; republics resist it; democracies and utopias forbid it.
 */
export const SLAVERY_GOVERNMENT_WEIGHT: Readonly<Record<number, number | null>> = {
    0: 1.5, // Despotism
    1: 1.0, // Feudalism
    2: 0.5, // Monarchy
    3: -1.5, // Republic
    4: null, // Democracy
    5: 1.5, // Military Dictatorship
    6: -1.0, // Way of the Ancients
    7: 2.0, // Way of Darkness
    8: 0.0, // Technocracy
    9: 1.0, // Mercantile Guild (oligarchy)
    10: null, // Utopian Paradise
    11: 1.0, // Hive Mind (collective)
    12: 0.5, // Corporate Nationalism
};

/** An AI's leaning to slavery from its species and government (null: its government forbids it). Pure. */
export function aiSlaveryScore(e: Empire): number | null {
    const race = e.dominantRace;
    if (race === null) return null;
    const g = SLAVERY_GOVERNMENT_WEIGHT[e.governmentId];
    if (g === null) return null;
    // Race.Aggression / Friendliness / Loyalty (races.txt, 50-150, 100 = average): aggressive, unfriendly (xenophobic)
    // and disloyal (little regard for others' bonds) species lean to it.
    const species = (race.aggression - 100) / 25 + (100 - race.friendliness) / 25 + (100 - race.loyalty) / 50;
    return (g ?? 0) + species;
}

export function slaveryState(e: Empire): SlaveryEmpireState {
    return (e.slavery ??= {
        penal: [],
        races: [],
        lastAiReview: -1,
        adoptedAt: -1,
        convoys: [],
        stats: { designated: 0, released: 0, revolts: 0, breakaways: 0, extraLuxury: 0, taxPeak: 0, convoys: 0, convoysLost: 0, workersShipped: 0, workersDied: 0, peakFactor: 1 },
    });
}

/** Summed abundance of a colony's luxury / restricted resources. */
function penalResourceAbundance(galaxy: Galaxy, h: Habitat): number {
    let n = 0;
    for (const r of h.resources) if (r !== null && isPenalResource(galaxy, r.resourceId)) n += r.abundance;
    return n;
}

/** One penal colony's year, against the same colony free (credits / year; the soak and the Colonies window). */
export interface PenalLedger {
    workers: number;
    target: number;
    /** Luxury / restricted extraction multiplier at those workers. */
    multiplier: number;
    taxFree: number;
    taxPenal: number;
    /** Luxury / restricted output a year, free and penal (units). */
    outputFree: number;
    outputPenal: number;
    luxuryValue: number;
    garrisonUpkeep: number;
    /** taxPenal − taxFree + luxuryValue − garrisonUpkeep (revolt losses come on top: a rebelling colony extracts nothing). */
    net: number;
}

/**
 * Estimate (no state change) of `h` as a penal colony of its owner with `workers` enslaved workers (default: those
 * there now). Tax: the free colony's tax (the stored one divided by the factor it holds now) × the staffed factor.
 */
export function penalLedger(galaxy: Galaxy, h: Habitat, workers = penalWorkers(h)): PenalLedger {
    const e = h.empire!;
    const p = SLAVERY_PARAMS;
    const target = penalTargetWorkers(h);
    const staffing = Math.min(1, workers / target);
    const multiplier = penalResourceMultiplier(staffing);
    const tax = Math.max(0, h.annualTaxRevenue);
    const nowFactor = isPenalColony(h) ? 1 + (p.PENAL_TAX_MAX_FACTOR - 1) * Math.min(1, penalWorkers(h) / target) : 1;
    const taxFree = tax / nowFactor;
    const taxPenal = taxFree * (1 + (p.PENAL_TAX_MAX_FACTOR - 1) * staffing);
    // industry.ts extractResources: min(9, max(3, pop / 1e8)) units of volume a second; each resource yields
    // volume / (1000 / abundance).
    const pop = h.population != null ? h.population.totalAmount : 0;
    const vol = Math.min(9, Math.max(3, pop / 1e8)) * REAL_SECONDS_IN_GALACTIC_YEAR;
    const prices = galaxyResourceCurrentPrices(galaxy);
    let outputFree = 0;
    let luxuryValue = 0;
    for (const r of h.resources) {
        if (r === null || !isPenalResource(galaxy, r.resourceId)) continue;
        const units = (vol * r.abundance) / 1000;
        outputFree += units;
        luxuryValue += (multiplier - 1) * units * (prices[r.resourceId] ?? 0);
    }
    // Garrison upkeep: only the troops beyond the colony's stock garrison (troopLevelRequiredStock), at the colony's
    // (else the empire's) average troop strength.
    const need = penalGarrisonFor(workers, isPenalColony(h) ? penalYears(galaxy, h) : 0);
    const extra = Math.max(0, need - troopLevelRequiredStock(galaxy, h, galaxy.difficultyLevel));
    const garrisonUpkeep = Math.ceil(extra / averageTroopStrength(e, h)) * calculateCostPerTroop(e, TroopType.Infantry, h, null);
    return { workers, target, multiplier, taxFree, taxPenal, outputFree, outputPenal: outputFree * multiplier, luxuryValue, garrisonUpkeep, net: taxPenal - taxFree + luxuryValue - garrisonUpkeep };
}

function averageTroopStrength(e: Empire, h: Habitat): number {
    if (h.troops !== null && h.troops.count > 0) return Math.max(1, h.troops.totalDefendStrengthExcludeReadiness / h.troops.count);
    if (e.troops != null && e.troops.count > 0) return Math.max(1, e.troops.totalDefendStrengthExcludeReadiness / e.troops.count);
    return 1000;
}

/**
 * May `q` at colony `c` be shipped to a penal colony? Its stock population policy there is Enslave; `potential`
 * (the AI planning): any people of another species, since the AI sets that policy itself when it ships them.
 */
function shippable(e: Empire, c: Habitat, race: Race, potential: boolean): boolean {
    if (race === e.dominantRace) return false;
    return potential || populationPolicyFor(c, race) === ColonyPopulationPolicy.Enslave;
}

/** People `e` could ship from colony `c` (keeps PENAL_SOURCE_KEEP_SHARE of each). */
function enslavableAt(e: Empire, c: Habitat, potential: boolean): number {
    if (c.population == null || c.slavery !== undefined || e.penalColonies.includes(c)) return 0;
    let n = 0;
    for (const q of c.population.items) if (shippable(e, c, q.race, potential)) n += Math.trunc(q.amount * (1 - SLAVERY_PARAMS.PENAL_SOURCE_KEEP_SHARE));
    return n;
}

/**
 * Enslavable people across the empire not yet promised to a penal colony (its shortfall to target, minus convoys at
 * sea). `potential`: as the AI counts them (any people of another species); else only those under the Enslave policy.
 */
export function enslavablePool(e: Empire, potential = false): number {
    let n = 0;
    for (const c of e.colonies) n += enslavableAt(e, c, potential);
    for (const h of e.slavery?.penal ?? []) n -= Math.max(0, penalTargetWorkers(h) - penalWorkers(h) - labourAtSea(e, h));
    return Math.max(0, n);
}

function labourAtSea(e: Empire, h: Habitat): number {
    let n = 0;
    for (const c of e.slavery?.convoys ?? []) if (c.world === h) n += c.amount;
    return n;
}

/** Why `h` cannot be made a penal colony by `e` (null: it can). */
export function penalDesignationBlocked(galaxy: Galaxy, e: Empire, h: Habitat): string | null {
    if (!slaveryOn(galaxy)) return 'the Slavery add-on is off';
    if (h.empire !== e || !e.colonies.includes(h)) return 'not your colony';
    if (!slaveryAllowed(e)) return "your policy does not use penal colonies to implement 'Enslave'";
    if (e.capital === h || (e.capitals != null && e.capitals.includes(h))) return 'a capital cannot be a penal colony';
    if (h.population == null || h.population.totalAmount <= 0) return 'no population';
    return null;
}

/** The stock population policies of a penal colony: every other people there is enslaved. */
function enslaveAt(h: Habitat): void {
    h.colonyPopulationPolicy = ColonyPopulationPolicy.Enslave;
    h.colonyPopulationPolicyRaceFamily = ColonyPopulationPolicy.Enslave;
}

/** Adopts a colony on the stock penalColonies list into the add-on's bookkeeping. */
function adopt(galaxy: Galaxy, e: Empire, st: SlaveryEmpireState, h: Habitat): void {
    h.slavery = { empireId: e.empireId, since: galaxyStarDate(galaxy), lastConvoy: -1, workersArrived: 0, extraLuxury: 0 };
    if (!st.penal.includes(h)) st.penal.push(h);
    st.stats.designated++;
    refreshRaces(st);
    // War crimes (scenario/warCrimes): enslaving a conquered people.
    if (galaxy.scenario !== null) scenarioEmit(galaxy, 'colonyEnslaved', { empire: e, colony: h });
}

function drop(e: Empire, st: SlaveryEmpireState, h: Habitat): void {
    const i = st.penal.indexOf(h);
    if (i >= 0) st.penal.splice(i, 1);
    const j = e.penalColonies.indexOf(h);
    if (j >= 0) e.penalColonies.splice(j, 1);
    if (h.slavery !== undefined && h.slavery.empireId === e.empireId) delete h.slavery;
    refreshRaces(st);
}

/** Designates (on) or releases (off) a penal colony. The player op and the AI. False when refused / unchanged. */
export function setPenalColony(galaxy: Galaxy, e: Empire, h: Habitat, on: boolean): boolean {
    if (!slaveryOn(galaxy)) return false;
    if (on && (isPenalColony(h) || penalDesignationBlocked(galaxy, e, h) !== null)) return false;
    const st = slaveryState(e);
    if (on) {
        // The stock list is the penal colony list; the stock Enslave policy decides who works it.
        if (!e.penalColonies.includes(h)) e.penalColonies.push(h);
        enslaveAt(h);
        adopt(galaxy, e, st, h);
        return true;
    }
    if (!st.penal.includes(h) && !e.penalColonies.includes(h)) return false;
    drop(e, st, h);
    st.stats.released++;
    return true;
}

function refreshRaces(st: SlaveryEmpireState): void {
    const names: string[] = [];
    for (const h of st.penal) {
        const r = h.population != null ? h.population.dominantRace : null;
        if (r !== null && !names.includes(r.name)) names.push(r.name);
    }
    names.sort();
    st.races = names;
}

function majorEmpire(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

/** The intermediate-block review (tick/empireTick.ts). `timePassed` = seconds since the last one. */
export function reviewSlavery(galaxy: Galaxy, e: Empire, timePassed: number): void {
    if (!majorEmpire(galaxy, e)) return;
    const human = isHumanEmpire(galaxy, e);
    if (!human) aiReviewPolicy(galaxy, e);
    if (e.slavery === undefined && e.penalColonies.length === 0 && (human || !slaveryAllowed(e))) return;
    const st = slaveryState(e);
    // Bookkeeping. The stock list is the penal colony list: colonies on it the add-on has not adopted yet (a stock
    // choice made before, or a save from before the add-on) are adopted; lost ones dropped (a breakaway when its
    // slaves now rule it); with the switch off, or no Enslave policy left there (the stock rule, Empire.2.cs 3409),
    // every one is released.
    for (const h of [...e.penalColonies]) if (h.empire === e && slaveryAllowed(e) && !st.penal.includes(h)) adopt(galaxy, e, st, h);
    for (const h of [...st.penal]) {
        const enslaving = h.colonyPopulationPolicy === ColonyPopulationPolicy.Enslave || h.colonyPopulationPolicyRaceFamily === ColonyPopulationPolicy.Enslave;
        if (h.empire === e && slaveryAllowed(e) && e.penalColonies.includes(h) && enslaving) continue;
        if (h.empire === galaxy.independentEmpire) st.stats.breakaways++;
        if (h.empire === e) st.stats.released++;
        drop(e, st, h);
    }
    convoySweep(galaxy, st);
    const dt = timePassed / REAL_SECONDS_IN_GALACTIC_YEAR;
    for (const h of st.penal) {
        // The conditions: workers die off; convoys (both the AI's and the player's: automatic) bring more.
        if (h.population != null) {
            let died = 0;
            for (const q of h.population.items) {
                if (populationPolicyFor(h, q.race) !== ColonyPopulationPolicy.Enslave) continue;
                const d = Math.min(q.amount, Math.trunc(q.amount * SLAVERY_PARAMS.PENAL_WORKER_DEATH_PER_YEAR * dt));
                q.amount -= d;
                died += d;
            }
            if (died > 0) {
                h.population.recalculateTotalAmount();
                st.stats.workersDied += died;
            }
        }
        const f = penalResourceMultiplier(Math.min(1, penalWorkers(h) / penalTargetWorkers(h)));
        if (f > st.stats.peakFactor) st.stats.peakFactor = f;
        staffPenalColony(galaxy, e, st, h);
    }
    let tax = 0;
    for (const h of st.penal) tax += h.annualTaxRevenue;
    if (tax > st.stats.taxPeak) st.stats.taxPeak = tax;
    if (st.penal.length > 0) {
        // The stain: every empire that does not allow slavery thinks less of the slaver.
        const v = -SLAVERY_PARAMS.REPUTATION_STAIN_PER_YEAR * st.penal.length * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
        for (const o of galaxy.empires) {
            if (!majorEmpire(galaxy, o) || o === e || slaveryAllowed(o)) continue;
            applyReputation(galaxy, o, e, v, { cause: 'slavery.penalColonies', labelKey: 'Reputation Cause slavery.penalColonies', source: 'slavery', legacy: 'factored', decayPerYear: SLAVERY_PARAMS.REPUTATION_STAIN_PER_YEAR });
        }
    }
    if (!human && slaveryAllowed(e)) aiReviewColonies(galaxy, e, st);
}

/** The AI's policy: adopt when its species and government lean to it and a colony would pay; drop when they no longer do. */
function aiReviewPolicy(galaxy: Galaxy, e: Empire): void {
    if (e.policy == null) return;
    const score = aiSlaveryScore(e);
    const leans = score !== null && score >= SLAVERY_PARAMS.AI_ADOPT_SCORE;
    if (slaveryAllowed(e)) {
        // The add-on's choice replaces the race policy file's value (the switch is the stock policy).
        if (!leans) {
            e.policy.implementEnslavementWithPenalColonies = false;
            for (const h of [...(e.slavery?.penal ?? [])]) setPenalColony(galaxy, e, h, false);
        }
        return;
    }
    if (!leans || bestPenalCandidate(galaxy, e) === null) return;
    e.policy.implementEnslavementWithPenalColonies = true;
    slaveryState(e).adoptedAt = galaxyStarDate(galaxy);
}

/** The colony that would earn the most as a penal colony and can pay its garrison (null: none). */
function bestPenalCandidate(galaxy: Galaxy, e: Empire): Habitat | null {
    const p = SLAVERY_PARAMS;
    let best: Habitat | null = null;
    let bestNet = 0;
    const pool = enslavablePool(e, true);
    for (const h of e.colonies) {
        if (h.slavery !== undefined || e.penalColonies.includes(h) || h.rebelling || e.capital === h || (e.capitals != null && e.capitals.includes(h))) continue;
        if (h.population == null || h.population.totalAmount <= 0) continue;
        if (penalResourceAbundance(galaxy, h) < p.AI_MIN_RESOURCE_ABUNDANCE) continue;
        // Staffing: the workers there plus what the empire can still ship must reach a good share of the target.
        const target = penalTargetWorkers(h);
        const reach = Math.min(target, penalWorkers(h) + pool);
        if (reach < p.AI_MIN_STAFF_SHARE * target) continue;
        const l = penalLedger(galaxy, h, reach);
        if (l.garrisonUpkeep > p.AI_MAX_GARRISON_COST_SHARE * (l.taxPenal - l.taxFree + l.luxuryValue)) continue;
        if (l.net > bestNet || (l.net === bestNet && best !== null && h.habitatIndex < best.habitatIndex)) {
            best = h;
            bestNet = l.net;
        }
    }
    return best;
}

function aiReviewColonies(galaxy: Galaxy, e: Empire, st: SlaveryEmpireState): void {
    const p = SLAVERY_PARAMS;
    // Give up a colony whose garrison cannot hold it.
    for (const h of [...st.penal]) {
        const need = penalGarrisonRequired(galaxy, h);
        const have = h.troops !== null ? h.troops.totalDefendStrength : 0;
        if (h.rebelling && need > 0 && have < p.AI_RELEASE_GARRISON_SHARE * need) setPenalColony(galaxy, e, h, false);
        // ...or one it can no longer staff (after a year to fill it).
        else if (penalYears(galaxy, h) > 1 && penalWorkers(h) + labourAtSea(e, h) < 0.2 * penalTargetWorkers(h) && enslavablePool(e, true) <= 0) setPenalColony(galaxy, e, h, false);
    }
    if (st.penal.length >= p.AI_MAX_PENAL_COLONIES || e.stateMoney <= 0) return;
    const h = bestPenalCandidate(galaxy, e);
    if (h !== null) setPenalColony(galaxy, e, h, true);
}

/** Sends one labour convoy to `h` when it is short of workers and a source colony can spare them. */
function staffPenalColony(galaxy: Galaxy, e: Empire, st: SlaveryEmpireState, h: Habitat): void {
    const p = SLAVERY_PARAMS;
    const hs = h.slavery!;
    const now = galaxyStarDate(galaxy);
    if (hs.lastConvoy >= 0 && now - hs.lastConvoy < p.PENAL_CONVOY_INTERVAL_DAYS * GAME_DAY_LENGTH) return;
    if (penalWorkers(h) + labourAtSea(e, h) >= penalTargetWorkers(h) || e.stateMoney < p.PENAL_CONVOY_COST || galaxy.independentEmpire === null) return;
    // Source: the colony with the most people of one non-dominant species to spare (ties: lower habitat index).
    let src: Habitat | null = null;
    let race: Population['race'] | null = null;
    let best = 0;
    const ai = !isHumanEmpire(galaxy, e);
    for (const c of e.colonies) {
        if (c === h || c.slavery !== undefined || e.penalColonies.includes(c) || c.population == null || c.hasBeenDestroyed) continue;
        for (const q of c.population.items) {
            if (!shippable(e, c, q.race, ai)) continue;
            const spare = Math.trunc(q.amount * (1 - p.PENAL_SOURCE_KEEP_SHARE));
            if (spare > best || (spare === best && src !== null && c.habitatIndex < src.habitatIndex)) {
                best = spare;
                src = c;
                race = q.race;
            }
        }
    }
    if (src === null || race === null || best < p.PENAL_CONVOY_SIZE / 4) return;
    let spec = null;
    for (const s of e.designSpecifications) if (s !== null && s.subRole === BuiltObjectSubRole.PassengerShip) spec = s;
    if (spec === null) return;
    const design = generateDesignFromSpec(galaxy, e, spec, 3.0, now);
    if (design === null) return;
    const amount = Math.min(best, p.PENAL_CONVOY_SIZE);
    // The AI enslaves the people it ships (the stock population policy at the source; the player sets it itself).
    if (ai && populationPolicyFor(src, race) !== ColonyPopulationPolicy.Enslave) {
        if (e.dominantRace !== null && race.raceFamily === e.dominantRace.raceFamily) src.colonyPopulationPolicyRaceFamily = ColonyPopulationPolicy.Enslave;
        else src.colonyPopulationPolicy = ColonyPopulationPolicy.Enslave;
    }
    const item = src.population!.items.find((q) => q.race === race)!;
    item.amount -= amount;
    src.population!.recalculateTotalAmount();
    recalculateEmpirePopulation(e);
    e.stateMoney -= p.PENAL_CONVOY_COST;
    const ship = generateNewBuiltObject(galaxy, galaxy.independentEmpire, design, src);
    ship.name = `${e.name} labour convoy`;
    ship.slavery = 'sea';
    ship.population = new PopulationList();
    ship.population.add(new Population(race, amount, galaxy));
    ship.population.recalculateTotalAmount();
    const missionPopulation = new PopulationList();
    missionPopulation.add(new Population(race, amount, galaxy));
    assignMission(galaxy, ship, BuiltObjectMissionType.Transport, src, h, BuiltObjectMissionPriority.Normal, { population: missionPopulation });
    st.convoys.push({ ship, world: h, raceName: race.name, amount });
    st.stats.convoys++;
    st.stats.workersShipped += amount;
    hs.lastConvoy = now;
}

/** Settled convoys are torn down, sunk ones counted (outside the docking command loop). */
function convoySweep(galaxy: Galaxy, st: SlaveryEmpireState): void {
    for (const c of [...st.convoys]) {
        if (c.ship.slavery === 'sea' && c.ship.hasBeenDestroyed) c.ship.slavery = 'lost';
        if (c.ship.slavery === 'sea') continue;
        if (c.ship.slavery === 'done' && c.world.slavery !== undefined) c.world.slavery.workersArrived += c.amount;
        else st.stats.convoysLost++;
        st.convoys.splice(st.convoys.indexOf(c), 1);
        if (!c.ship.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, c.ship);
    }
}
