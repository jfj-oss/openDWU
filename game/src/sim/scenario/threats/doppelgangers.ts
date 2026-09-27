// 19f-4 Doppelgangers (tasks/19f-hidden-threats.md §4). Not a port: new scenario behaviour composed of ported functions.
// Registered from scenario/packages.ts; every handler is gated by the `doppelgangers` flag, so flag off draws nothing.
//
// Arc: ships an empire loses to capture sometimes come back "clean" — really sleepers loyal to nobody. Two vectors:
// (a) the original owner recaptures a ship an enemy/pirate held (builtObjectOwnerChanged) — a roll decides it is a
// sleeper; (b) each year, an empire that has lost ships is planted derelicts of its own designs near its territory
// (generateUnownedShipAtLocation); its own explorers claim them (abandonedShipClaimed) and they are sleepers for free
// (the guaranteed vector — captures are rare in AI-vs-AI play). At doppelTurnCount live sleepers galaxy-wide, "The
// Mirror" rises (createThreatFaction, race = the sleepers' majority original owner) and every sleeper flips in place
// (flipToFaction's default removeFromFleet leaves its old fleet before it turns on it).
//
// Rnd (§0.4): draws only in the flag-gated builtObjectOwnerChanged handler (the sleeper roll), the yearly planting
// handler (and the stock functions it calls) and the periodic discovery roll. Fixed iteration orders: sleepers /
// captured records by id / array order, galaxy.empires order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { BuiltObject } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { findNewestCanBuild } from '../../designGeneration';
import { generateUnownedShipAtLocation } from '../../story/storyStart';
import { EmpireMessageType } from '../../messages';
import { GameEndOutcome } from '../../victory';
import { galaxyStarDate } from '../../tick/simTime';
import { registerHiddenThing } from '../security/registry';
import { registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly } from '../hooks';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';
import {
    KNOWLEDGE_CONFIRMED,
    KNOWLEDGE_SUSPECTED,
    arcMessage,
    arcNews,
    createThreatFaction,
    flipToFaction,
    knowledgeLevel,
    normalEmpires,
    pastThreatMinYear,
    peekThreatState,
    revealTo,
    registerThreatExistence,
    registerThreatKnownSites,
    teardownIfDead,
    threatExists,
    threatGameEnd,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatKnowledge,
} from './framework';

export const DOPPELGANGERS_KEY = 'doppelgangers';
export const DOPPELGANGERS_FLAG = 'doppelgangers';
const TAG = 'Doppel';
/** Game-end codes (19f §0.8: 1911 Grey Tide … 1920 Corporate Coup; +100 = victory/containment). */
export const DOPPELGANGERS_CODE_CONTAINED = 2014;
const PERIOD_DAYS = 30;

export interface Sleeper {
    id: number;
    bo: BuiltObject;
    /** The empire it looked like it still belonged to when it turned out to be a sleeper. */
    trueOwner: Empire;
    since: number;
    knowledge: ThreatKnowledge[];
}

/** A ship currently away from the empire that last normally owned it (captured by an enemy or a pirate). */
export interface CapturedRecord {
    bo: BuiltObject;
    owner: Empire;
}

export interface DoppelgangersState {
    nextId: number;
    faction: Empire | null;
    sleepers: Sleeper[];
    captured: CapturedRecord[];
    /** Derelicts planted by §5.E's yearly vector, awaiting a claim (abandonedShipClaimed). */
    planted: BuiltObject[];
    sentStages: SentStages;
    factionHadColonies: boolean;
    ended: boolean;
}

function newState(): DoppelgangersState {
    return { nextId: 1, faction: null, sleepers: [], captured: [], planted: [], sentStages: {}, factionHadColonies: false, ended: false };
}

export function doppelgangersState(galaxy: Galaxy): DoppelgangersState {
    return threatState(galaxy, DOPPELGANGERS_KEY, newState);
}

export function peekDoppelgangersState(galaxy: Galaxy): DoppelgangersState | null {
    return peekThreatState<DoppelgangersState>(galaxy, DOPPELGANGERS_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}

const P = {
    sleeperPct: (g: Galaxy) => p(g, 'doppelSleeperPct', 35),
    turnCount: (g: Galaxy) => p(g, 'doppelTurnCount', 8),
    plantPerYear: (g: Galaxy) => p(g, 'doppelPlantPerYear', 2),
    detectPct: (g: Galaxy) => p(g, 'doppelDetectPct', 10),
};

function isNormal(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

// ---------------------------------------------------------------------------------------------------------------
// Vector (a): recapture roll (builtObjectOwnerChanged)
// ---------------------------------------------------------------------------------------------------------------

/** §4a: an empire recapturing a ship an enemy/pirate held may get a sleeper back instead of its own ship. */
export function onBuiltObjectOwnerChanged(galaxy: Galaxy, bo: BuiltObject, from: Empire | null, to: Empire | null): void {
    if (!threatExists(galaxy, DOPPELGANGERS_KEY)) return; // §0 rarity: not this game — no state, no draws.
    const st = peekDoppelgangersState(galaxy);
    if (st === null || st.faction !== null) return; // spread stops once the threat has risen (its sleepers are the faction's own ships now)
    if (isNormal(galaxy, to)) {
        const i = st.captured.findIndex((c) => c.bo === bo);
        if (i >= 0) {
            const rec = st.captured[i];
            st.captured.splice(i, 1);
            // Capture/recapture bookkeeping (above) may run before the floor (§0.3); the sleeper roll — seeding — waits.
            if (rec.owner === to && pastThreatMinYear(galaxy, DOPPELGANGERS_KEY) && galaxy.rnd.nextDouble() < P.sleeperPct(galaxy) / 100) makeSleeper(galaxy, st, bo, to);
            return;
        }
    }
    if (isNormal(galaxy, from) && (to === null || !isNormal(galaxy, to) || to !== from)) {
        if (!st.captured.some((c) => c.bo === bo)) st.captured.push({ bo, owner: from });
    }
}

function makeSleeper(galaxy: Galaxy, st: DoppelgangersState, bo: BuiltObject, owner: Empire): void {
    if (st.sleepers.some((s) => s.bo === bo)) return;
    const s: Sleeper = { id: st.nextId++, bo, trueOwner: owner, since: galaxyStarDate(galaxy), knowledge: [] };
    st.sleepers.push(s);
    registerHiddenThing(galaxy, { kind: 'sleeper', concealment: 60, empire: owner, target: bo, package: '19f.doppelgangers', site: s }); // 19m (flag-gated)
}

// ---------------------------------------------------------------------------------------------------------------
// Vector (b): yearly planting + claim
// ---------------------------------------------------------------------------------------------------------------

/** §4b: an empire that has lost ships gets up to plantPerYear derelicts of its own designs near its territory. */
export function doppelgangersYearly(galaxy: Galaxy, year: number): void {
    // §0 rarity/timing: not this game, or before the floor (planting is entirely seeding — Doppelgangers has no
    // own seed-year param, so the shared/overridden floor is its only gate) — no state, no draws.
    if (!threatExists(galaxy, DOPPELGANGERS_KEY) || !pastThreatMinYear(galaxy, DOPPELGANGERS_KEY, year)) return;
    const st = doppelgangersState(galaxy);
    if (st.ended || st.faction !== null) return;
    const perYear = P.plantPerYear(galaxy);
    if (perYear <= 0) return;
    for (const e of normalEmpires(galaxy)) {
        if (!st.captured.some((c) => c.owner === e) && !st.sleepers.some((s) => s.trueOwner === e)) continue;
        for (let i = 0; i < perYear; i++) plantDerelict(galaxy, st, e);
    }
}

function plantDerelict(galaxy: Galaxy, st: DoppelgangersState, owner: Empire): void {
    if (owner.colonies.length === 0) return;
    const design = findNewestCanBuild(owner.designs, BuiltObjectSubRole.SmallFreighter, owner) ?? findNewestCanBuild(owner.designs, BuiltObjectSubRole.MediumFreighter, owner);
    if (design === null) return;
    const at = owner.colonies[galaxy.rnd.next(0, owner.colonies.length)];
    const bo = generateUnownedShipAtLocation(galaxy, design, at.xpos, at.ypos);
    st.planted.push(bo);
}

/** §4b step 2: the empire's own explorers claim a planted derelict — it turns out to be a sleeper for free. */
function onAbandonedShipClaimed(galaxy: Galaxy, bo: BuiltObject, empire: Empire): void {
    const st = peekDoppelgangersState(galaxy);
    if (st === null || st.faction !== null) return;
    const i = st.planted.indexOf(bo);
    if (i < 0) return;
    st.planted.splice(i, 1);
    if (isNormal(galaxy, empire)) makeSleeper(galaxy, st, bo, empire);
}

// ---------------------------------------------------------------------------------------------------------------
// Discovery (periodic) — the trace-scanner rule against an empire's own ships (19b §5.F.23 analogue)
// ---------------------------------------------------------------------------------------------------------------

export function doppelgangersPeriodic(galaxy: Galaxy, now: number): void {
    if (!threatExists(galaxy, DOPPELGANGERS_KEY)) return; // §0 rarity: not this game — no state, no draws.
    void now;
    const st = doppelgangersState(galaxy);
    if (st.ended) return;
    if (st.faction === null) {
        const pct = P.detectPct(galaxy) / 100;
        if (pct > 0) {
            for (const s of [...st.sleepers].sort((a, b) => a.id - b.id)) {
                if (s.bo.hasBeenDestroyed || s.bo.actualEmpire !== s.trueOwner) continue;
                if (knowledgeLevel(s, s.trueOwner) >= KNOWLEDGE_CONFIRMED) continue;
                if (galaxy.rnd.nextDouble() < pct) suspectFound(galaxy, st, s);
            }
        }
        // §0 timing: the trigger waits for the floor (sleepers can't exist pre-floor anyway — belt and suspenders).
        if (pastThreatMinYear(galaxy, DOPPELGANGERS_KEY) && st.sleepers.filter((s) => !s.bo.hasBeenDestroyed).length >= P.turnCount(galaxy)) doppelgangersTrigger(galaxy, st);
    }
    doppelgangersEndCheck(galaxy, st);
}

function suspectFound(galaxy: Galaxy, st: DoppelgangersState, s: Sleeper): void {
    if (!revealTo(galaxy, s, s.trueOwner, KNOWLEDGE_CONFIRMED)) return;
    arcMessage(galaxy, st.sentStages, [s.trueOwner], {
        prefix: TAG,
        stage: 'Suspect',
        onceKey: `Suspect:${s.id}`,
        args: [s.bo.name],
        type: EmpireMessageType.GeneralWarning,
        subject: s.bo,
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Trigger / faction
// ---------------------------------------------------------------------------------------------------------------

/** Majority race among the sleepers' true (original) owners (ties: first seen, sleepers in id order). */
function majorityRace(st: DoppelgangersState) {
    const counts = new Map<string, number>();
    let best: string | null = null;
    let bestN = 0;
    for (const s of [...st.sleepers].sort((a, b) => a.id - b.id)) {
        const race = s.trueOwner.dominantRace;
        if (race === null) continue;
        const n = (counts.get(race.name) ?? 0) + 1;
        counts.set(race.name, n);
        if (n > bestN) {
            bestN = n;
            best = race.name;
        }
    }
    return best;
}

/** §4 trigger: doppelTurnCount live sleepers galaxy-wide → The Mirror rises, every sleeper flips in place. */
export function doppelgangersTrigger(galaxy: Galaxy, st: DoppelgangersState): boolean {
    if (st.faction !== null) return true;
    const race = majorityRace(st);
    if (race === null) return false;
    const faction = createThreatFaction(galaxy, {
        race,
        name: scenarioText(`${TAG} Faction Name`),
        enemies: normalEmpires(galaxy),
    });
    if (faction === null) return false;
    st.faction = faction;
    const sleepers = [...st.sleepers].sort((a, b) => a.id - b.id);
    for (const s of sleepers) {
        if (s.bo.hasBeenDestroyed) continue;
        flipToFaction(galaxy, s.bo, faction);
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Turn', textTag: `${TAG} Turn News` });
    for (const e of normalEmpires(galaxy, faction)) {
        arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Turn', type: EmpireMessageType.GeneralBadEvent });
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------------------------------------------

export function doppelgangersEndCheck(galaxy: Galaxy, st: DoppelgangersState): void {
    const faction = st.faction;
    if (faction === null || st.ended) return;
    if (faction.active && faction.colonies.length > 0) st.factionHadColonies = true;
    const ships = faction.builtObjects.filter((b) => !b.hasBeenDestroyed).length;
    if (faction.active && ships > 0) return;
    if (!teardownIfDead(galaxy, faction) && faction.active) return;
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Contained' });
    st.ended = true;
    const player = galaxy.playerEmpire;
    if (player !== null) threatGameEnd(galaxy, player, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), DOPPELGANGERS_CODE_CONTAINED);
}

// ---------------------------------------------------------------------------------------------------------------
// UI selector
// ---------------------------------------------------------------------------------------------------------------

export function doppelgangersKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekDoppelgangersState(galaxy);
    if (st === null) return [];
    const out: KnownThreatSite[] = [];
    for (const s of st.sleepers) {
        if (s.bo.hasBeenDestroyed) continue;
        const level = st.faction !== null ? KNOWLEDGE_CONFIRMED : knowledgeLevel(s, empire);
        if (level <= 0) continue;
        out.push({ threat: DOPPELGANGERS_KEY, kind: 'ship', target: s.bo, level, label: scenarioText(level >= KNOWLEDGE_CONFIRMED ? `${TAG} Suspect Row` : `${TAG} Rumour Row`) });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const DOPPELGANGERS_HANDLER_IDS = ['doppel.yearly', 'doppel.periodic', 'doppel.owner', 'doppel.claimed'] as const;

export function registerDoppelgangers(): void {
    registerThreatExistence(DOPPELGANGERS_KEY, DOPPELGANGERS_FLAG);
    registerScenarioYearly({ id: 'doppel.yearly', flag: DOPPELGANGERS_FLAG, order: 10, run: doppelgangersYearly });
    registerScenarioPeriodic({ id: 'doppel.periodic', flag: DOPPELGANGERS_FLAG, order: 10, periodDays: PERIOD_DAYS, run: doppelgangersPeriodic });
    registerScenarioEvent({ id: 'doppel.owner', flag: DOPPELGANGERS_FLAG, event: 'builtObjectOwnerChanged', run: (g, e) => onBuiltObjectOwnerChanged(g, e.builtObject, e.from, e.to) });
    registerScenarioEvent({ id: 'doppel.claimed', flag: DOPPELGANGERS_FLAG, event: 'abandonedShipClaimed', run: (g, e) => onAbandonedShipClaimed(g, e.builtObject, e.empire) });
    registerThreatKnownSites(DOPPELGANGERS_KEY, doppelgangersKnownSites);
}

registerDoppelgangers();
