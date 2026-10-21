// Scorched earth (scenarios/scorched-earth; docs/DARK_THEMES.md §2). Not a port: DW:U has no such choice.
//
// When an enemy invasion fleet reaches a colony — the stock attack notice (attackAI.ts notifyOfAttackHabitat, the
// `habitatAttacked` event) from a major empire's ship that carries troops or sails with a fleet that does, or enemy
// troops on the ground — the colony's owner chooses:
//   - Defend (the stock game), or
//   - Scorch: the colony's population and the planet's BASE quality fall linearly to nothing over scorchRuinYears.
//     Capture stops it at once and the captor gets what is left (the stock TerraformingFacility raises base quality
//     again: colonyTick.ts terraformColony); a world burned out is cleared (ownership.ts clearColony, no owner).
// When the attackers have not struck for scorchSiegeClearDays and no enemy troops stand on the ground, the siege is
// beaten off: the AI calls the burning off, the player is asked (Stop / Keep burning).
// The player answers through scenario decisions (decisions.ts: the message popup, journaled); the AI decides at once
// from its species (Race aggression / friendliness), its government, the world's value and its odds of holding it
// (troops + calculateSpaceControlStrengths against the attackers). The capital is never scorched.
// Reputation: every other major empire's attitude to the scorcher −scorchReputation (reputation/ledger.ts
// applyReputation), and a `colonyScorched` event for War Crimes.
// Rnd: none. State: scenario.state.scorchedEarth (plain data, habitat indices).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { ShipGroup } from '../../fleets/shipGroup';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { isHumanEmpire } from '../../humanEmpires';
import { calculateSpaceControlStrengths } from '../../combat/invasion';
import { clearColony } from '../../combat/ownership';
import { EmpireMessageType } from '../../messages';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic, scenarioEmit } from '../hooks';
import { scenarioParam, scenarioState } from '../state';
import { scenarioMessage } from '../messages';
import { raiseScenarioDecision, registerScenarioDecision, type ScenarioDecision } from '../decisions';
import { applyReputation } from '../reputation/ledger';

export const SCORCHED_EARTH_FLAG = 'scorchedEarth';
const KEY = 'scorchedEarth';
const CHOICE = 'scorchedEarth.choice';
const CANCEL = 'scorchedEarth.cancel';

/** Scorching leaning per government (governments.txt GovernmentId): the ruthless burn, the cautious defend. */
export const SCORCH_GOVERNMENT_WEIGHT: Readonly<Record<number, number>> = {
    0: 1.0, // Despotism
    1: 0.5, // Feudalism
    2: 0.0, // Monarchy
    3: -0.5, // Republic
    4: -1.0, // Democracy
    5: 1.5, // Military Dictatorship
    6: -0.5, // Way of the Ancients
    7: 2.0, // Way of Darkness
    8: 0.0, // Technocracy
    9: -1.0, // Mercantile Guild (property is worth more whole)
    10: -1.5, // Utopian Paradise
    11: 1.0, // Hive Mind
    12: -0.5, // Corporate Nationalism
};

export interface Siege {
    habitat: number;
    owner: number;
    attacker: number;
    started: number;
    lastAttack: number;
    choice: 'pending' | 'defend' | 'scorch';
}

export interface Scorching {
    habitat: number;
    owner: number;
    attacker: number;
    started: number;
    pop0: number;
    quality0: number;
    /** 0..1 at the last step. */
    progress: number;
    cancelAsked: boolean;
}

export interface ScorchedEarthState {
    sieges: Siege[];
    burning: Scorching[];
    stats: {
        sieges: number;
        defended: number;
        scorched: number;
        ruined: number;
        captured: number;
        cancelled: number;
        /** Per scorched world: how it ended. */
        log: { colony: string; owner: string; attacker: string; year: number; outcome: 'ruined' | 'captured' | 'cancelled' | 'lost' | 'burning'; left: number; captor: string | null }[];
    };
}

export function scorchState(g: Galaxy): ScorchedEarthState {
    return scenarioState<ScorchedEarthState>(g, KEY, () => ({ sieges: [], burning: [], stats: { sieges: 0, defended: 0, scorched: 0, ruined: 0, captured: 0, cancelled: 0, log: [] } }));
}

function major(g: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

function empireById(g: Galaxy, id: number): Empire | null {
    for (const e of g.empires) if (e !== null && e.empireId === id) return e;
    return null;
}

function carriesTroops(bo: BuiltObject): boolean {
    if (bo.troops !== null && bo.troops.count > 0) return true;
    const fleet = bo.shipGroup as ShipGroup | null;
    if (fleet === null) return false;
    for (const s of fleet.ships) if (s.troops !== null && s.troops.count > 0) return true;
    return false;
}

/** Is `bo` (or its fleet) an invasion force? */
function isInvasionAttacker(attacker: unknown): attacker is BuiltObject {
    return typeof attacker === 'object' && attacker !== null && 'troops' in attacker && 'shipGroup' in attacker && carriesTroops(attacker as BuiltObject);
}

export function scorchingOf(g: Galaxy, h: Habitat): Scorching | null {
    const st = g.scenario?.state[KEY] as ScorchedEarthState | undefined;
    return st?.burning.find((b) => b.habitat === h.habitatIndex) ?? null;
}

/** The AI's score for scorching `h` against `attacker` (≥ scorchAiScore: scorch). Pure. */
export function aiScorchScore(g: Galaxy, h: Habitat, owner: Empire, attacker: Empire): number {
    const race = owner.dominantRace;
    const species = race === null ? 0 : (race.aggression - 100) / 25 + (100 - race.friendliness) / 50;
    const gov = SCORCH_GOVERNMENT_WEIGHT[owner.governmentId] ?? 0;
    // Odds of holding: our troops + orbital strength against theirs (their landed troops and troop ships nearby).
    const space = calculateSpaceControlStrengths(g, h, owner, attacker);
    const ours = (h.troops !== null ? h.troops.totalDefendStrength : 0) + space.defenders;
    let theirs = space.attackers + (h.invadingTroops !== null ? h.invadingTroops.totalAttackStrength : 0);
    if (theirs <= 0) theirs = 1;
    const odds = ours / (ours + theirs);
    // A rich world is worth denying: its population (log scale).
    const pop = h.population != null ? h.population.totalAmount : 0;
    const value = Math.max(0, Math.log10(Math.max(1, pop / 1e8)));
    return species + gov + (0.5 - odds) * 6 + value;
}

function onAttack(g: Galaxy, h: Habitat, attacker: unknown, attackingEmpire: Empire | null): void {
    const owner = h.empire;
    if (!major(g, owner) || !major(g, attackingEmpire) || owner === attackingEmpire || h.population == null || h.population.totalAmount <= 0) return;
    const invading = isInvasionAttacker(attacker) || (h.invadingTroops !== null && h.invadingTroops.count > 0);
    const st = scorchState(g);
    const now = galaxyStarDate(g);
    const s = st.sieges.find((x) => x.habitat === h.habitatIndex);
    if (s !== undefined) {
        if (s.attacker === attackingEmpire.empireId) s.lastAttack = now;
        return;
    }
    if (!invading || owner.capital === h || scorchingOf(g, h) !== null) return;
    const siege: Siege = { habitat: h.habitatIndex, owner: owner.empireId, attacker: attackingEmpire.empireId, started: now, lastAttack: now, choice: 'pending' };
    st.sieges.push(siege);
    st.stats.sieges++;
    raiseScenarioDecision(g, owner, {
        kind: CHOICE,
        title: 'Scorched earth?',
        text: `An invasion fleet of the ${attackingEmpire.name} has reached ${h.name}. Defend the colony, or scorch it: its people and the planet's quality will fall to nothing over about ${scenarioParam(g, 'scorchRuinYears', 1.5)} years, and the invaders will win only what is left. Other empires will think less of us.`,
        options: [
            { id: 'defend', label: 'Defend' },
            { id: 'scorch', label: 'Scorch' },
        ],
        defaultOption: 'defend',
        expiresDays: scenarioParam(g, 'scorchDecisionDays', 10),
        context: { habitat: h.habitatIndex },
    });
}

function startScorching(g: Galaxy, h: Habitat, s: Siege): void {
    const st = scorchState(g);
    const owner = empireById(g, s.owner);
    if (owner === null || h.empire !== owner || scorchingOf(g, h) !== null) return;
    st.burning.push({ habitat: h.habitatIndex, owner: s.owner, attacker: s.attacker, started: galaxyStarDate(g), pop0: h.population.totalAmount, quality0: h.baseQuality, progress: 0, cancelAsked: false });
    st.stats.scorched++;
    const v = -scenarioParam(g, 'scorchReputation', 6);
    for (const o of g.empires) if (major(g, o) && o !== owner && v !== 0) applyReputation(g, o, owner, v, { cause: 'scorchedEarth', labelKey: 'Reputation Cause scorchedEarth', source: 'scorched-earth', legacy: 'factored' });
    scenarioEmit(g, 'colonyScorched', { empire: owner, colony: h, attacker: empireById(g, s.attacker) });
    const att = empireById(g, s.attacker);
    if (att !== null && isHumanEmpire(g, att)) scenarioMessage(g, att, 'Scorched earth', `The defenders of ${h.name} are burning their own world rather than let us take it.`, { type: EmpireMessageType.GeneralBadEvent, subject: h, popup: false });
}

function resolveSiege(g: Galaxy, d: ScenarioDecision, option: string): void {
    const st = scorchState(g);
    const idx = d.context.habitat as number;
    const s = st.sieges.find((x) => x.habitat === idx);
    const h = g.habitats[idx];
    if (s === undefined || h === undefined || s.choice !== 'pending') return;
    s.choice = option === 'scorch' ? 'scorch' : 'defend';
    if (s.choice === 'scorch') startScorching(g, h, s);
    else st.stats.defended++;
}

function stopBurning(g: Galaxy, b: Scorching, outcome: 'ruined' | 'captured' | 'cancelled' | 'lost'): void {
    const st = scorchState(g);
    st.burning.splice(st.burning.indexOf(b), 1);
    const h = g.habitats[b.habitat];
    const owner = empireById(g, b.owner);
    const captor = outcome === 'captured' ? h.empire : null;
    if (outcome === 'ruined') st.stats.ruined++;
    if (outcome === 'captured') st.stats.captured++;
    if (outcome === 'cancelled') st.stats.cancelled++;
    st.stats.log.push({ colony: h.name, owner: owner?.name ?? '', attacker: empireById(g, b.attacker)?.name ?? '', year: Math.round((b.started / YEAR_LENGTH) * 10) / 10, outcome, left: Math.round((1 - b.progress) * 100) / 100, captor: captor?.name ?? null });
    if (st.stats.log.length > 200) st.stats.log.shift();
    if (captor !== null && isHumanEmpire(g, captor)) scenarioMessage(g, captor, 'A scorched world', `${h.name} was half burned when we took it: ${Math.round((1 - b.progress) * 100)}% of its people and quality are left. A terraforming facility can restore the planet.`, { subject: h, popup: false });
}

/** One burning step (every scorch period). */
function burn(g: Galaxy): void {
    const st = scorchState(g);
    const now = galaxyStarDate(g);
    const years = scenarioParam(g, 'scorchRuinYears', 1.5);
    for (const b of [...st.burning]) {
        const h = g.habitats[b.habitat];
        if (h === undefined || h.hasBeenDestroyed) {
            stopBurning(g, b, 'lost');
            continue;
        }
        if (h.empire === null || h.empire.empireId !== b.owner) {
            stopBurning(g, b, h.empire !== null && h.empire !== g.independentEmpire ? 'captured' : 'lost');
            continue;
        }
        b.progress = Math.min(1, (now - b.started) / (years * YEAR_LENGTH));
        const keep = 1 - b.progress;
        if (keep <= 0) {
            h.baseQuality = Math.fround(0.01);
            stopBurning(g, b, 'ruined');
            clearColony(g, h, null);
            continue;
        }
        const pop = h.population;
        const target = b.pop0 * keep;
        if (pop != null && pop.totalAmount > target && pop.totalAmount > 0) {
            const k = target / pop.totalAmount;
            for (const p of pop.items) p.amount = Math.trunc(p.amount * k);
            pop.recalculateTotalAmount();
        }
        const q = Math.fround(Math.max(0.01, b.quality0 * keep));
        if (h.baseQuality > q) h.baseQuality = q;
    }
}

/** Sieges beaten off (or the colony lost): close them, and offer to stop the burning. */
function reviewSieges(g: Galaxy): void {
    const st = scorchState(g);
    const now = galaxyStarDate(g);
    const clear = scenarioParam(g, 'scorchSiegeClearDays', 45) * GAME_DAY_LENGTH;
    for (const s of [...st.sieges]) {
        const h = g.habitats[s.habitat];
        const lost = h === undefined || h.empire === null || h.empire.empireId !== s.owner;
        const troops = h !== undefined && h.invadingTroops !== null && h.invadingTroops.count > 0;
        if (!lost && (troops || now - s.lastAttack < clear || s.choice === 'pending')) continue;
        st.sieges.splice(st.sieges.indexOf(s), 1);
        const b = h !== undefined ? scorchingOf(g, h) : null;
        if (lost || b === null || b.cancelAsked) continue;
        const owner = empireById(g, s.owner)!;
        b.cancelAsked = true;
        raiseScenarioDecision(g, owner, {
            kind: CANCEL,
            title: 'The attack on ' + h.name + ' is beaten off',
            text: `The invaders have withdrawn from ${h.name}, which still burns: ${Math.round((1 - b.progress) * 100)}% of its people and quality are left. Stop the burning?`,
            options: [
                { id: 'stop', label: 'Stop the burning' },
                { id: 'continue', label: 'Keep burning' },
            ],
            defaultOption: 'stop',
            expiresDays: scenarioParam(g, 'scorchDecisionDays', 10),
            context: { habitat: s.habitat },
        });
    }
}

/** Starts burning `h` against `attacker` (tests; the decision path does the same). */
export function beginScorching(g: Galaxy, h: Habitat, attacker: Empire): void {
    startScorching(g, h, { habitat: h.habitatIndex, owner: h.empire!.empireId, attacker: attacker.empireId, started: galaxyStarDate(g), lastAttack: galaxyStarDate(g), choice: 'scorch' });
}

/** The periodic step (exported for tests). */
export function scorchTick(g: Galaxy): void {
    reviewSieges(g);
    burn(g);
}

registerScenarioDecision({
    kind: CHOICE,
    alwaysAsk: true, aiPure: true,
    flag: SCORCHED_EARTH_FLAG,
    id: CHOICE,
    resolve: resolveSiege,
    aiChoose: (g, d) => {
        const h = g.habitats[d.context.habitat as number];
        const s = scorchState(g).sieges.find((x) => x.habitat === h.habitatIndex);
        const owner = d.empire;
        const att = s !== undefined ? empireById(g, s.attacker) : null;
        if (att === null || h.empire !== owner) return 'defend';
        return aiScorchScore(g, h, owner, att) >= scenarioParam(g, 'scorchAiScore', 2.5) ? 'scorch' : 'defend';
    },
});

registerScenarioDecision({
    kind: CANCEL,
    alwaysAsk: true, aiPure: true,
    flag: SCORCHED_EARTH_FLAG,
    id: CANCEL,
    resolve: (g, d, option) => {
        const h = g.habitats[d.context.habitat as number];
        const b = h !== undefined ? scorchingOf(g, h) : null;
        if (b !== null && option === 'stop') stopBurning(g, b, 'cancelled');
    },
    aiChoose: () => 'stop',
});

registerScenarioEvent({
    id: 'scorchedEarth.attack',
    flag: SCORCHED_EARTH_FLAG,
    event: 'habitatAttacked',
    run: (g, { habitat, attacker, attackingEmpire }) => onAttack(g, habitat, attacker, attackingEmpire),
});

registerScenarioPeriodic({
    id: 'scorchedEarth.burn',
    flag: SCORCHED_EARTH_FLAG,
    periodDays: 5,
    run: (g) => {
        const st = g.scenario?.state[KEY] as ScorchedEarthState | undefined;
        if (st === undefined || (st.burning.length === 0 && st.sieges.length === 0)) return;
        scorchTick(g);
    },
});
