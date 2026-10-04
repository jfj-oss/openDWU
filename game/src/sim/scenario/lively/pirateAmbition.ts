// Scenario package "lively-galaxy" (task 19l item 4, `pirateAmbition`). Not a port: a pirate faction rich and armed
// enough graduates from raiding to holding ground — it seizes an independent colony it already controls (or, failing
// that, the weakest nearby independent) as a permanent base and starts behaving like a small empire. Flag off = the
// stock game (no state, no event, no query).
//
// Ownership transfer reuses the existing ported primitive exactly as scenario/empireMidGame.ts's capital hand-over
// does: Empire.1.cs 54/59/64 TakeOwnershipOfColony (combat/ownership.ts takeOwnershipOfColonyFull(galaxy, empire,
// colony, empire, false, false)). That single call already does everything a stock conquest does: colony.empire
// becomes the pirate faction, the colony joins empire.colonies, the previous owner's (independent) bookkeeping is
// unwound, and it fires the mod-layer `colonyOwnerChanged` event — no bespoke ownership code here.
//
// Once owned, "behaves like a small empire" is almost entirely stock behaviour we unlock rather than write:
//   - Defence: Empire.9.cs 1763-1770 resolveLocationsToDefend (characters.ts) already lists, for a pirate faction,
//     every one of empire.colonies that also carries a PirateColonyControl record for it — which is exactly what
//     seizeAmbitionColony sets up below. Empire.9.cs 2454 reviewFleetPostures (fleets/shipGroupTasks.ts), already
//     called every pirate tick (tick/pirateTick.ts), then assigns some of its fleets FleetPosture.Defend there on its
//     own next pass — no new fleet code needed.
//   - Freighters / mining / smuggling: logistics/contracts.ts, logistics/freight.ts and pirates/pirateConstruction.ts
//     already branch on `empire.pirateEmpireBaseHabitat !== null` for a colony-owning pirate faction (they already
//     support it for the faction's original base habitat); a second owned colony is just more of the same input.
//   - Keeps raiding others: unaffected — nothing here touches missionsMarket.ts / pirateShipMissions.ts.
//
// The only genuinely new state is: which faction has gone "ambitious", how many colonies it holds this way (capped),
// a global once-per-N-years gate on a NEW faction going ambitious, the NewsNet beat, and the threat read normal
// empires take from it — via the existing pirate-relation evaluation ledger (Empire.8.cs 2512 ChangePirateEvaluation,
// pirateRelations.ts changePirateEvaluation), which is the C# port's own "how much do we fear/trust this pirate
// faction" number (it already feeds pirate mission pricing and protection-deal willingness), for every empire that
// has met the faction (PirateRelationType !== NotMet — Empire.3.cs 3528 CheckHaveMetPirates' own gate).
//
// Rnd: none. The trigger is a deterministic threshold check (money, ship count) in the yearly handler; picking a
// target and applying the effects draws nothing.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { takeOwnershipOfColonyFull } from '../../combat/ownership';
import { PirateColonyControl } from '../../pirates/pirateColonyControl';
import { changePirateEvaluation, obtainPirateRelation, PirateRelationEvaluationType, PirateRelationType } from '../../pirateRelations';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { gameYear, registerScenarioYearly } from '../hooks';
import { scenarioParam, scenarioState } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { LIVELY_GALAXY_ID } from './livelyGalaxy';

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export interface PirateAmbitionEntry {
    /** Colonies held under this mechanic (bounded by `pirateAmbitionColonyCap`). */
    colonies: number;
    /** Star date of the faction's first seizure. */
    firstSeizeDate: number;
}

/** Ambitious pirate factions (key: pirate empireId). Only factions that have seized at least one colony appear here. */
export function pirateAmbitionState(galaxy: Galaxy): Record<string, PirateAmbitionEntry> {
    return scenarioState(galaxy, 'lively.pirateAmbition', () => ({}) as Record<string, PirateAmbitionEntry>);
}

interface PirateAmbitionGlobal {
    /** Game year a faction last went ambitious for the first time (-1 = never); gates new factions, not growth. */
    lastNewAmbitionYear: number;
}

export function pirateAmbitionGlobal(galaxy: Galaxy): PirateAmbitionGlobal {
    return scenarioState(galaxy, 'lively.pirateAmbition.global', () => ({ lastNewAmbitionYear: -1 }));
}

function isPirateWarship(bo: { role: BuiltObjectRole; hasBeenDestroyed: boolean }): boolean {
    return bo.role === BuiltObjectRole.Military && !bo.hasBeenDestroyed;
}

/** Warships currently held by the faction. */
export function pirateWarshipCount(empire: Empire): number {
    let n = 0;
    for (const bo of empire.builtObjects) if (bo !== null && isPirateWarship(bo)) n++;
    return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------------------------------------------

/**
 * An independent colony to seize: the highest-control independent colony the faction already holds a
 * PirateColonyControl record for (empire.colonies already carries these — Empire.9.cs 1763-1770, pirates.ts
 * pirateReviewColoniesToControl keeps it current every pirate tick), or, failing that, the weakest (lowest
 * population) independent colony within `pirateAmbitionSeizeRadiusFraction` of the faction's base — the same
 * `galaxy.sizeX * 0.25` search scale pirateReviewColoniesToControl (Empire.1.cs 3103) uses for its own candidates.
 */
export function pickAmbitionTarget(galaxy: Galaxy, pirateEmpire: Empire): Habitat | null {
    const base = pirateEmpire.pirateEmpireBaseHabitat;
    if (base === null) return null;
    let best: Habitat | null = null;
    let bestControl = -Infinity;
    for (const h of pirateEmpire.colonies) {
        if (h === null || h.hasBeenDestroyed || h.empire !== galaxy.independentEmpire) continue;
        const control = h.pirateColonyControl.getByFaction(pirateEmpire);
        if (control === null) continue;
        if (control.controlLevel > bestControl) {
            bestControl = control.controlLevel;
            best = h;
        }
    }
    if (best !== null) return best;
    const radius = galaxy.sizeScale * scenarioParam(galaxy, 'pirateAmbitionSeizeRadiusFraction', 0.25);
    let weakest: Habitat | null = null;
    let weakestPop = Infinity;
    for (const h of galaxy.independentColonies) {
        if (h === null || h.hasBeenDestroyed || h.empire !== galaxy.independentEmpire || h.population === null || h.population.totalAmount <= 0) continue;
        if (galaxy.calculateDistance(base.xpos, base.ypos, h.xpos, h.ypos) > radius) continue;
        if (h.population.totalAmount < weakestPop) {
            weakestPop = h.population.totalAmount;
            weakest = h;
        }
    }
    return weakest;
}

// ---------------------------------------------------------------------------------------------------------------
// Seizure
// ---------------------------------------------------------------------------------------------------------------

function seizeAmbitionColony(galaxy: Galaxy, pirateEmpire: Empire, colony: Habitat): void {
    const entries = pirateAmbitionState(galaxy);
    const key = String(pirateEmpire.empireId);
    const wasFirst = entries[key] === undefined;
    const colonyName = colony.name;

    // Empire.1.cs 54/59/64 TakeOwnershipOfColony, exactly as scenario/empireMidGame.ts adoptEmpire's capital hand-over.
    takeOwnershipOfColonyFull(galaxy, pirateEmpire, colony, pirateEmpire, false, false);

    // Ensure the PirateColonyControl record resolveLocationsToDefend (characters.ts, Empire.9.cs 1763-1770) reads: a
    // colony the pirate faction has just conquered outright already deserves the highest, facility-backed control.
    if (colony.pirateColonyControl.getByFaction(pirateEmpire) === null) {
        colony.pirateColonyControl.add(new PirateColonyControl(pirateEmpire.empireId, 100, true));
    }

    const entry = entries[key] ?? { colonies: 0, firstSeizeDate: galaxyStarDate(galaxy) };
    entry.colonies++;
    entries[key] = entry;
    if (wasFirst) pirateAmbitionGlobal(galaxy).lastNewAmbitionYear = gameYear(galaxyStarDate(galaxy));

    // AI empires read this as a bigger threat: Empire.8.cs 2512 ChangePirateEvaluation (pirateRelations.ts) on
    // RaidsAgainstOurColonies, the ledger the port already uses to price protection deals and pirate missions, for
    // every empire that has met this faction (Empire.3.cs 3528 CheckHaveMetPirates' own gate: type !== NotMet).
    const penalty = scenarioParam(galaxy, 'pirateAmbitionThreatPenalty', 8);
    for (const empire of galaxy.empires) {
        if (empire === null || !empire.active || empire === galaxy.independentEmpire) continue;
        const rel = obtainPirateRelation(empire, pirateEmpire);
        if (rel.type === PirateRelationType.NotMet) continue;
        changePirateEvaluation(empire, pirateEmpire, -penalty, PirateRelationEvaluationType.RaidsAgainstOurColonies);
    }

    scenarioMessage(galaxy, pirateEmpire, scenarioText('Lively Pirate Ambition Title'), scenarioText('Lively Pirate Ambition Own', colonyName), {
        type: EmpireMessageType.ColonyGained,
        subject: colony,
    });
    scenarioNews(galaxy, null, scenarioText('Lively Pirate Ambition News', pirateEmpire.name, colonyName), (e) => e !== pirateEmpire, colony);
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly trigger
// ---------------------------------------------------------------------------------------------------------------

/** The yearly pirate-ambition check (exported for tests). No Rnd. */
export function pirateAmbitionYearly(galaxy: Galaxy): void {
    const entries = pirateAmbitionState(galaxy);
    const cap = Math.max(1, Math.trunc(scenarioParam(galaxy, 'pirateAmbitionColonyCap', 3)));
    const cooldownYears = scenarioParam(galaxy, 'pirateAmbitionCooldownYears', 8);
    const moneyThreshold = scenarioParam(galaxy, 'pirateAmbitionMoney', 300000);
    const shipsThreshold = scenarioParam(galaxy, 'pirateAmbitionShips', 10);
    const year = gameYear(galaxyStarDate(galaxy));
    const global = pirateAmbitionGlobal(galaxy);

    for (const pirateEmpire of galaxy.pirateEmpires) {
        if (pirateEmpire === null || !pirateEmpire.active || pirateEmpire.pirateEmpireBaseHabitat === null || pirateEmpire.pirateEmpireSuperPirates) continue;
        const key = String(pirateEmpire.empireId);
        const entry = entries[key];
        if (entry !== undefined && entry.colonies >= cap) continue; // capped: keeps raiding, does not seize further
        if (entry === undefined && global.lastNewAmbitionYear >= 0 && year - global.lastNewAmbitionYear < cooldownYears) continue; // one new faction per N years
        if (pirateEmpire.stateMoney < moneyThreshold) continue;
        if (pirateWarshipCount(pirateEmpire) < shipsThreshold) continue;
        const target = pickAmbitionTarget(galaxy, pirateEmpire);
        if (target === null) continue;
        seizeAmbitionColony(galaxy, pirateEmpire, target);
    }
}

registerScenarioYearly({ id: 'lively.pirateAmbition', scenarioId: LIVELY_GALAXY_ID, flag: 'pirateAmbition', order: 30, run: (g) => pirateAmbitionYearly(g) });
