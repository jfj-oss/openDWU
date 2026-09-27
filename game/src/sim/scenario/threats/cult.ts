// 19f-2 The Cult (tasks/19f-hidden-threats.md §2). Not a port: new scenario behaviour composed of ported functions.
// Registered from scenario/packages.ts; every handler is gated by the `cult` flag, so flag off draws nothing.
//
// Arc: a creed passes character to character (findCharactersAtLocationOrTransferring's cross-empire generalisation,
// framework.ts allCharactersAtLocation — anyone sharing a location, any empire, is a conversion candidate: the vector
// that lets the creed cross empire borders through ambassadors and diplomats). A colony is cult-held when its governor
// is converted. Once one empire has cultSecedeColonies cult-held colonies, the cult declares (createThreatFaction,
// governmentId 7 "Way of Darkness" — governments.txt is not overlaid, so the id is cited directly) and each cult-held
// colony rises from inside with converted-race militia (invadeFromInside) — the stock ground war hands it to the
// theocracy, as 19b Dark Farms' turn does for the Harvesters.
//
// Rnd (§0.4): draws only in the flag-gated yearly seed handler, the periodic spread/discovery handler (and the stock
// functions they call). Fixed iteration orders: converted characters in conversion order, galaxy.empires order, each
// empire's character-list order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { CharacterRole, CharacterTraitType, type Character, type IntelligenceMission, getEmpireCharacters } from '../../characters';
import { EmpireMessageType } from '../../messages';
import { GameEndOutcome } from '../../victory';
import { gameYear, registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly } from '../hooks';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';
import { startStarDateForAge } from '../../galaxyTime';
import { registerHiddenThing, retireHiddenTarget } from '../security/registry';
import {
    KNOWLEDGE_CONFIRMED,
    allCharactersAtLocation,
    arcMessage,
    arcNews,
    createThreatFaction,
    invadeFromInside,
    knowledgeLevel,
    makeFactionTroop,
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

export const CULT_KEY = 'cult';
export const CULT_FLAG = 'cult';
const TAG = 'Cult';
/** Game-end codes (19f §0.8: 1911 Grey Tide … 1920 Corporate Coup; +100 = victory/containment). */
export const CULT_CODE_CONTAINED = 2012;
const PERIOD_DAYS = 60;
/** "Way of Darkness" governments.txt id (not overlaid; cited directly, 19f §2). */
const WAY_OF_DARKNESS_GOVERNMENT = 7;
/** IntelligenceMissionType.CounterIntelligence (espionage.ts, as darkFarms.ts). */
const COUNTER_INTELLIGENCE = 8;
/** 19m concealment of a convert (CounterEspionageFactored scale 25–100). */
const CONVERT_CONCEALMENT = 50;

export interface ConvertRecord {
    character: Character;
    knowledge: ThreatKnowledge[];
}

export interface CultState {
    converted: ConvertRecord[];
    faction: Empire | null;
    sentStages: SentStages;
    factionHadColonies: boolean;
    hadConverts: boolean;
    ended: boolean;
}

function newState(): CultState {
    return { converted: [], faction: null, sentStages: {}, factionHadColonies: false, hadConverts: false, ended: false };
}

export function cultState(galaxy: Galaxy): CultState {
    return threatState(galaxy, CULT_KEY, newState);
}

export function peekCultState(galaxy: Galaxy): CultState | null {
    return peekThreatState<CultState>(galaxy, CULT_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}

const P = {
    seedYear: (g: Galaxy) => p(g, 'cultSeedYear', 40),
    spreadPct: (g: Galaxy) => p(g, 'cultSpreadPct', 8),
    ambassadorPct: (g: Galaxy) => p(g, 'cultAmbassadorPct', 15),
    secedeColonies: (g: Galaxy) => p(g, 'cultSecedeColonies', 4),
    agentDetectPct: (g: Galaxy) => p(g, 'cultAgentDetectPct', 15),
};

function recordOf(st: CultState, c: Character): ConvertRecord | undefined {
    return st.converted.find((r) => r.character === c);
}

function isConverted(st: CultState, c: Character): boolean {
    return recordOf(st, c) !== undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Seed (yearly)
// ---------------------------------------------------------------------------------------------------------------

/** Candidates: active, Spiritual-trait characters of a normal empire, not already converted, in empire/list order. */
export function cultSeedCandidates(galaxy: Galaxy, st: CultState): Character[] {
    const out: Character[] = [];
    for (const e of normalEmpires(galaxy, st.faction)) {
        for (const c of getEmpireCharacters(e)) {
            if (!c.active || !c.traits.includes(CharacterTraitType.Spiritual) || isConverted(st, c)) continue;
            out.push(c);
        }
    }
    return out;
}

export function cultYearly(galaxy: Galaxy, year: number): void {
    if (!threatExists(galaxy, CULT_KEY)) return; // §0 rarity: not this game — no state, no draws.
    const st = cultState(galaxy);
    if (st.ended) return;
    const startYear = gameYear(startStarDateForAge(galaxy.age));
    if (year < startYear + P.seedYear(galaxy) || !pastThreatMinYear(galaxy, CULT_KEY, year)) return; // §0 timing: also waits for the shared/overridden floor.
    if (st.converted.length > 0) return; // already seeded
    const candidates = cultSeedCandidates(galaxy, st);
    if (candidates.length === 0) return;
    const c = candidates[galaxy.rnd.next(0, candidates.length)];
    convert(galaxy, st, c);
}

/** Also used by tests to force a conversion. */
export function convert(galaxy: Galaxy, st: CultState, c: Character): void {
    if (isConverted(st, c)) return;
    const record: ConvertRecord = { character: c, knowledge: [] };
    st.converted.push(record);
    st.hadConverts = true;
    // 19m: the convert joins the hidden-thing registry (no-op unless internalSecurity).
    registerHiddenThing(galaxy, { kind: 'convert', concealment: CONVERT_CONCEALMENT, empire: c.empire, target: c, package: '19f.cult', site: record });
}

/**
 * The reverse of convert: `c` loses its cult status (a 19m purge / counter-intelligence roll-up of a cell, 19f §6
 * Time Bomb counterplay). Its 19m 'convert' hidden thing retires with `outcome`. Returns false when `c` was not
 * converted. No Rnd. The cult's own containment (cultEndCheck) sees the shorter list on its next period.
 */
export function deconvert(galaxy: Galaxy, st: CultState, c: Character, outcome = 'deconverted'): boolean {
    const i = st.converted.findIndex((r) => r.character === c);
    if (i < 0) return false;
    st.converted.splice(i, 1);
    retireHiddenTarget(galaxy, 'convert', c, outcome); // 19m (flag-gated)
    return true;
}

/** Converted, active characters present at `colony` (any empire), in conversion order. Pure. */
export function convertsAt(st: CultState, colony: Habitat): Character[] {
    return st.converted.filter((r) => r.character.active && r.character.location === colony).map((r) => r.character);
}

/** Slots other packages fill (no-op when null): 19f §6 Time Bomb records the empires the cult seceded from. */
export interface CultHooks {
    /** cultTrigger raised the theocracy's militia inside `host`'s cult-held colonies (the faction exists). No Rnd. */
    triggered: ((galaxy: Galaxy, host: Empire, faction: Empire) => void) | null;
}
export const cultHooks: CultHooks = { triggered: null };

// ---------------------------------------------------------------------------------------------------------------
// Spread (periodic): character → character, at their shared location, across empire borders.
// ---------------------------------------------------------------------------------------------------------------

function spreadFactor(c: Character): number {
    let pct = 1;
    if (c.traits.includes(CharacterTraitType.Logical) || c.traits.includes(CharacterTraitType.Lawful)) pct *= 0.5;
    if (c.traits.includes(CharacterTraitType.Spiritual)) pct *= 2;
    return pct;
}

export function cultSpread(galaxy: Galaxy, st: CultState): void {
    const basePct = P.spreadPct(galaxy);
    const ambassadorPct = P.ambassadorPct(galaxy);
    if (basePct <= 0 && ambassadorPct <= 0) return;
    for (const r of [...st.converted]) {
        const c = r.character;
        if (!c.active) continue;
        const base = c.role === CharacterRole.Ambassador ? ambassadorPct : basePct;
        if (base <= 0) continue;
        for (const other of allCharactersAtLocation(galaxy, c.location, st.faction)) {
            if (other === c || isConverted(st, other)) continue;
            const pct = base * spreadFactor(other);
            if (galaxy.rnd.nextDouble() * 100 < pct) convert(galaxy, st, other);
        }
    }
}

/** characterCreated: a new character born at a cult-held colony starts converted 25% of the time. */
export function onCharacterCreated(galaxy: Galaxy, character: unknown, empire: Empire): void {
    void empire;
    const st = peekCultState(galaxy);
    if (st === null) return;
    const c = character as Character;
    const colony = c.location as Habitat | null;
    if (colony === null || !cultHeldColonies(galaxy, st).includes(colony)) return;
    if (galaxy.rnd.nextDouble() < 0.25) convert(galaxy, st, c);
}

// ---------------------------------------------------------------------------------------------------------------
// Cult-held colonies and the secession trigger
// ---------------------------------------------------------------------------------------------------------------

/** A colony is cult-held when its governor (present, ColonyGovernor role) is converted. */
export function cultHeldColonies(galaxy: Galaxy, st: CultState): Habitat[] {
    const out: Habitat[] = [];
    for (const e of normalEmpires(galaxy, st.faction)) {
        for (const colony of e.colonies) {
            const governor = getEmpireCharacters(e).find((c) => c.active && c.role === CharacterRole.ColonyGovernor && c.location === colony);
            if (governor !== undefined && isConverted(st, governor)) out.push(colony);
        }
    }
    return out;
}

function cultHeldColoniesOf(galaxy: Galaxy, st: CultState, empire: Empire): Habitat[] {
    return cultHeldColonies(galaxy, st).filter((h) => h.empire === empire);
}

/** §2 trigger: an empire with ≥ cultSecedeColonies cult-held colonies loses them to the theocracy. */
export function cultCheckTrigger(galaxy: Galaxy): void {
    const st = cultState(galaxy);
    const need = P.secedeColonies(galaxy);
    for (const e of normalEmpires(galaxy, st.faction)) {
        const held = cultHeldColoniesOf(galaxy, st, e);
        if (held.length >= need) cultTrigger(galaxy, st, e, held);
    }
}

/** Ensures the theocracy exists (created once, from the first empire to secede) and rises its held colonies. */
export function cultTrigger(galaxy: Galaxy, st: CultState, host: Empire, held: Habitat[]): boolean {
    let faction = st.faction;
    if (faction === null || !faction.active) {
        faction = createThreatFaction(galaxy, {
            race: host.dominantRace ?? 'Human',
            name: scenarioText(`${TAG} Faction Name`),
            governmentId: WAY_OF_DARKNESS_GOVERNMENT,
            enemies: normalEmpires(galaxy),
        });
        if (faction === null) return false;
        st.faction = faction;
    }
    for (const h of held) {
        if (h.empire !== host || h.hasBeenDestroyed) continue;
        const inv = h.invadingTroops;
        if (inv !== null && inv.count > 0) continue;
        const race = h.population?.dominantRace ?? host.dominantRace ?? null;
        const strength = race?.troopStrength ?? 60;
        const troop = makeFactionTroop(galaxy, faction, strength, scenarioText(`${TAG} Militia Name`), race);
        invadeFromInside(galaxy, h, faction, [troop]);
    }
    if (cultHooks.triggered !== null) cultHooks.triggered(galaxy, host, faction);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Turn', onceKey: `Turn:${host.empireId}`, textTag: `${TAG} Turn News`, args: [host.name] });
    arcMessage(galaxy, st.sentStages, [host], { prefix: TAG, stage: 'Turn', onceKey: `Turn:${host.empireId}`, type: EmpireMessageType.GeneralBadEvent });
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Discovery (periodic): counter-intelligence agents find converted characters in their own empire.
// ---------------------------------------------------------------------------------------------------------------

function agentIsCounterIntel(c: Character): boolean {
    if (c.role !== CharacterRole.IntelligenceAgent || !c.active) return false;
    const m = c.mission as IntelligenceMission | null;
    return m !== null && m.type === COUNTER_INTELLIGENCE;
}

export function cultDiscovery(galaxy: Galaxy, st: CultState): void {
    const pct = P.agentDetectPct(galaxy) / 1000;
    if (pct <= 0) return;
    for (const e of normalEmpires(galaxy, st.faction)) {
        const agents = getEmpireCharacters(e).filter(agentIsCounterIntel);
        if (agents.length === 0) continue;
        for (const r of st.converted) {
            const c = r.character;
            if (!c.active || c.empire !== e || knowledgeLevel(r, e) >= KNOWLEDGE_CONFIRMED) continue;
            for (const agent of agents) {
                if (galaxy.rnd.nextDouble() < pct * agent.espionageFactored) {
                    if (revealTo(galaxy, r, e, KNOWLEDGE_CONFIRMED)) {
                        arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Cultist Found', onceKey: `Cultist:${galaxy.empires.indexOf(e)}:${st.converted.indexOf(r)}`, args: [c.name], type: EmpireMessageType.GeneralWarning });
                    }
                    break;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic
// ---------------------------------------------------------------------------------------------------------------

export function cultPeriodic(galaxy: Galaxy, now: number): void {
    if (!threatExists(galaxy, CULT_KEY)) return; // §0 rarity: not this game — no state, no draws.
    void now;
    const st = cultState(galaxy);
    if (st.ended) return;
    st.converted = st.converted.filter((r) => r.character.active);
    cultSpread(galaxy, st);
    if (pastThreatMinYear(galaxy, CULT_KEY)) cultCheckTrigger(galaxy); // §0 timing: the secession trigger waits for the floor.
    cultDiscovery(galaxy, st);
    cultEndCheck(galaxy, st);
}

// ---------------------------------------------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------------------------------------------

export function cultEndCheck(galaxy: Galaxy, st: CultState): void {
    if (st.ended) return;
    const faction = st.faction;
    if (faction !== null) {
        if (faction.active && faction.colonies.length > 0) st.factionHadColonies = true;
        if (faction.active && faction.colonies.length > 0) return;
        if (faction.active && !st.factionHadColonies) return;
        if (!teardownIfDead(galaxy, faction) && faction.active) return;
    } else if (!st.hadConverts || st.converted.length > 0) {
        return;
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Contained' });
    st.ended = true;
    const player = galaxy.playerEmpire;
    if (player !== null) threatGameEnd(galaxy, player, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), CULT_CODE_CONTAINED);
}

// ---------------------------------------------------------------------------------------------------------------
// Player counterplay: dismissing / assassinating a converted character clears it from the list on the next sweep
// (checked via c.active above); a stub threat action lets tests / UI check a target's status without one.
// ---------------------------------------------------------------------------------------------------------------

export function cultKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekCultState(galaxy);
    if (st === null) return [];
    const out: KnownThreatSite[] = [];
    for (const h of cultHeldColonies(galaxy, st)) {
        if (h.empire !== empire) continue;
        out.push({ threat: CULT_KEY, kind: 'colony', target: h, level: KNOWLEDGE_CONFIRMED, label: scenarioText(`${TAG} Colony Row`) });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const CULT_HANDLER_IDS = ['cult.yearly', 'cult.periodic', 'cult.characterCreated'] as const;

export function registerCult(): void {
    registerThreatExistence(CULT_KEY, CULT_FLAG);
    registerScenarioYearly({ id: 'cult.yearly', flag: CULT_FLAG, order: 10, run: cultYearly });
    registerScenarioPeriodic({ id: 'cult.periodic', flag: CULT_FLAG, order: 10, periodDays: PERIOD_DAYS, run: cultPeriodic });
    registerScenarioEvent({ id: 'cult.characterCreated', flag: CULT_FLAG, event: 'characterCreated', run: (g, e) => onCharacterCreated(g, e.character, e.empire) });
    registerThreatKnownSites(CULT_KEY, cultKnownSites);
}

registerCult();
