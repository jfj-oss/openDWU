// 19f #6 Time-bomb tech (tasks/19f-hidden-threats.md §6), Cult-driven: flag off (byte-identical), inert without the
// cult flag, forced placement, holder tracking via the researchCompleted emit, no detonation without a cult cell,
// cell-driven detonation (trigger formula), the cultBomb 19m lead (suspected → confirmed → AI purge defuses), the cult
// faction inheriting nodes and war-detonating, abandon, and the end conditions gated on the cult. Short, direct-call
// tests (as scenarioDarkFarms.test.ts does): years are exercised through the module's own functions, not a tick soak.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { gameYear, registerScenarioEvent, registerScenarioYearly, scenarioEmit } from '../src/sim/scenario/hooks';
import { stateDigest } from '../src/sim/tick/digest';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import {
    TIME_BOMB_CODE_CONTAINED,
    TIME_BOMB_CODE_DEFEAT,
    TIME_BOMB_HANDLER_IDS,
    TIME_BOMB_PROJECT_IDS,
    abandonTech,
    cellStrength,
    cultNodesHeld,
    detonate,
    detonationChancePerMille,
    peekTimeBombState,
    prioritisesCounterIntelligence,
    registerTimeBomb,
    ruinlessHabitats,
    timeBombState,
    timeBombYearly,
} from '../src/sim/scenario/threats/timeBomb';
import { convert, cultCheckTrigger, cultEndCheck, cultState, peekCultState } from '../src/sim/scenario/threats/cult';
import { atWar, normalEmpires, teardownIfDead } from '../src/sim/scenario/threats/framework';
import { aiSecurity } from '../src/sim/scenario/security/security';
import { peekSecurityState, type Lead } from '../src/sim/scenario/security/registry';
import { reputationCauses } from '../src/sim/scenario/reputation/ledger';
import { CharacterRole, generateNewCharacter, type Character } from '../src/sim/characters';
import { IntelligenceMissionType, characterMission } from '../src/sim/espionage';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const FORCE = { timeBombStartYear: 0, timeBombChancePerMillePerColony: 1000, timeBombMaxChancePct: 100, timeBombDefeatDestroyed: 2, cultSecedeColonies: 1 };
const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function tbGame(flags: Record<string, boolean> = {}): { game: Game; g: Galaxy } {
    const { game } = createScenarioGame(base, { scenario: 'timebomb', flags: { threatTimeBomb: true, cult: true, ...flags }, params: FORCE, options: age3 });
    return { game, g: game.galaxy };
}

function forceYear(g: Galaxy): void {
    g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
}

function unregisterTimeBomb(): void {
    for (const id of TIME_BOMB_HANDLER_IDS) {
        registerScenarioYearly({ id, run: () => undefined })();
        registerScenarioEvent({ id, event: 'researchCompleted', run: () => undefined })();
    }
}

describe('Time-bomb tech: flag off', () => {
    it('flag off: no state, and the same draws and digest as the game without the package', () => {
        const a = tbGame({ threatTimeBomb: false, cult: false }).game;
        runGameSeconds(a, 125);
        expect(peekTimeBombState(a.galaxy)).toBeNull();
        unregisterTimeBomb();
        try {
            const b = tbGame({ threatTimeBomb: false, cult: false }).game;
            runGameSeconds(b, 125);
            expect(b.galaxy.rnd.drawCount).toBe(a.galaxy.rnd.drawCount);
            expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        } finally {
            registerTimeBomb();
        }
    }, 1200000);
});

describe('Time-bomb tech: forced placement, holders, detonation, abandon, ends', () => {
    it('placement: three ruins seeded on ruin-less habitats after the year boundary', () => {
        const { game, g } = tbGame();
        const before = ruinlessHabitats(g).length;
        expect(before).toBeGreaterThan(0);
        forceYear(g);
        runGameSeconds(game, 65);
        const st = timeBombState(g);
        expect(st.placed).toBe(true);
        expect(st.nodes).toEqual([...TIME_BOMB_PROJECT_IDS]);
        expect(g.habitats.filter((h) => h.ruin !== null).length).toBeGreaterThanOrEqual(3);
    }, 300000);

    it('holders: a researchCompleted emit for a time-bomb node records the empire; detonation destroys the colony', () => {
        const { game, g } = tbGame();
        forceYear(g);
        runGameSeconds(game, 65);
        const st = timeBombState(g);
        const empire = g.empires.find((e) => e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.length > 0)!;
        const node = empire.research.techTree.find((n) => n.def.projectId === st.nodes[0])!;
        node.isResearched = true;
        scenarioEmit(g, 'researchCompleted', { empire, project: node });
        expect(st.holders[empire.empireId]).toContain(st.nodes[0]);

        const colony = empire.colonies[0];
        expect(colony.hasBeenDestroyed).toBe(false);
        detonate(g, st, colony, empire);
        expect(colony.hasBeenDestroyed).toBe(true);
        expect(colony.explosion).not.toBeNull();
        expect(st.destroyed).toContain(colony);
        expect(st.knowledge[empire.empireId]).toBeGreaterThanOrEqual(1);

        // Counterplay: abandoning clears isResearched and the holder entry.
        expect(abandonTech(g, empire)).toBe(true);
        expect(node.isResearched).toBe(false);
        expect(empire.research.techTree.some((n) => n.def.projectId === st.nodes[0] && n.isResearched)).toBe(false);
    }, 600000);

    it('end: no holder left after at least one detonation is contained (2016)', () => {
        const { game, g } = tbGame();
        forceYear(g);
        runGameSeconds(game, 65);
        const st = timeBombState(g);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        st.destroyed = [g.habitats[0]];
        st.holders = {};
        timeBombYearly(g, gameYear(galaxyStarDate(g)));
        expect(ends.map((e) => e.code)).toEqual([TIME_BOMB_CODE_CONTAINED]);
        expect(st.ended).toBe(true);
        setGameEndHandler(g, null);
    }, 300000);
});

// ---------------------------------------------------------------------------------------------------------------
// Cult-driven arc
// ---------------------------------------------------------------------------------------------------------------

function holdAll(g: Galaxy, e: Empire): void {
    const st = timeBombState(g);
    for (const id of st.nodes) {
        const node = e.research.techTree.find((n) => n.def.projectId === id)!;
        node.isResearched = true;
        scenarioEmit(g, 'researchCompleted', { empire: e, project: node });
    }
}

/** A converted governor at `colony` (forced: the stock AI assigns governors over play time). */
function cultGovernor(g: Galaxy, e: Empire, colony: Habitat): Character {
    const c = generateNewCharacter(g, e, CharacterRole.ColonyGovernor, colony).character;
    convert(g, cultState(g), c);
    return c;
}

function aiVictims(g: Galaxy): Empire[] {
    return normalEmpires(g).filter((e) => e !== g.playerEmpire && e.colonies.filter((c) => c.population.totalAmount > 0).length >= 3);
}

function spareColony(e: Empire, skip: Habitat[] = []): Habitat {
    return e.colonies.find((c) => c !== e.capital && c.population.totalAmount > 0 && !skip.includes(c) && !c.hasBeenDestroyed)!;
}

function cultBombLead(g: Galaxy, e: Empire, colony: Habitat): Lead | undefined {
    return peekSecurityState(g)?.leads.find((l) => l.kind === 'cultBomb' && l.empire === e && l.target === colony);
}

describe('Time-bomb tech: cult cells, leads, AI purge, end gating', () => {
    let game: Game;
    let g: Galaxy;
    let year: number;
    let victim: Empire;
    let bombed: Habitat;

    it('inert without the cult flag: no state, no draws', () => {
        game = tbGame().game;
        g = game.galaxy;
        g.scenario!.flags.cult = false;
        const draws = g.rnd.drawCount;
        timeBombYearly(g, gameYear(galaxyStarDate(g)));
        expect(peekTimeBombState(g)).toBeNull();
        expect(g.rnd.drawCount).toBe(draws);
        g.scenario!.flags.cult = true;
        forceYear(g);
        runGameSeconds(game, 65);
        expect(timeBombState(g).placed).toBe(true);
        year = gameYear(galaxyStarDate(g));
    }, 600000);

    it('no detonation without a cult cell over a 3-year run with holders present (max chance)', () => {
        const st = timeBombState(g);
        expect(peekCultState(g)?.converted.length ?? 0).toBe(0);
        for (const e of normalEmpires(g)) holdAll(g, e);
        const draws = g.rnd.drawCount;
        for (let y = 1; y <= 3; y++) timeBombYearly(g, year + y);
        expect(st.destroyed).toEqual([]);
        expect(g.rnd.drawCount).toBe(draws); // no cell ⇒ not even a roll
        for (const e of normalEmpires(g)) expect(e.colonies.every((c) => !c.hasBeenDestroyed)).toBe(true);
    }, 600000);

    it('trigger formula: min(perMille x nodes x strength, maxPct x 10); a cell detonates at max chance', () => {
        const st = timeBombState(g);
        victim = aiVictims(g)[0];
        expect(victim).toBeDefined();
        bombed = spareColony(victim);
        cultGovernor(g, victim, bombed);
        const cst = cultState(g);
        const strength = cellStrength(cst, bombed);
        expect(strength).toBeGreaterThanOrEqual(1);
        g.scenario!.params.timeBombChancePerMillePerColony = 2;
        g.scenario!.params.timeBombMaxChancePct = 5;
        expect(detonationChancePerMille(g, bombed)).toBe(Math.min(2 * st.nodes.length * strength, 50));
        g.scenario!.params.timeBombChancePerMillePerColony = 1000;
        g.scenario!.params.timeBombMaxChancePct = 100;
        expect(detonationChancePerMille(g, bombed)).toBe(1000);
        const agent = generateNewCharacter(g, victim, CharacterRole.IntelligenceAgent, victim.capital).character;
        agent.mission = null;
        timeBombYearly(g, year + 4);
        expect(bombed.hasBeenDestroyed).toBe(true);
        expect(st.destroyed).toContain(bombed);
        // AI: a year of counter-intelligence after the loss (the idle agent is put on it).
        expect(prioritisesCounterIntelligence(g, victim)).toBe(true);
        expect(characterMission(agent)?.type).toBe(IntelligenceMissionType.CounterIntelligence);
    }, 600000);

    it('cultBomb lead: suspected when the cell forms, confirmed when a roll fails, AI purge defuses it', () => {
        g.scenario!.flags.internalSecurity = true;
        const st = timeBombState(g);
        const colony = spareColony(victim, [bombed]);
        expect(colony).toBeDefined();
        const gov = cultGovernor(g, victim, colony);
        // Formation with no roll (chance 0): lead suspected.
        g.scenario!.params.timeBombMaxChancePct = 0;
        timeBombYearly(g, year + 5);
        expect(cultBombLead(g, victim, colony)?.level).toBe('suspected');
        // A failing roll (fake Rnd: 999 of 1000) confirms it.
        g.scenario!.params.timeBombMaxChancePct = 5;
        const next = g.rnd.next.bind(g.rnd);
        g.rnd.next = ((min: number, max: number) => (min === 0 && max === 1000 ? 999 : next(min, max))) as typeof g.rnd.next;
        try {
            timeBombYearly(g, year + 6);
        } finally {
            g.rnd.next = next;
        }
        expect(colony.hasBeenDestroyed).toBe(false);
        const lead = cultBombLead(g, victim, colony)!;
        expect(lead.level).toBe('confirmed');
        // The AI's security step purges the confirmed cultBomb lead: the governor is turned, the cell defused.
        aiSecurity(g, victim);
        expect(lead.closed).toBe(true);
        expect(lead.outcome).toBe('defused');
        expect(cultState(g).converted.some((r) => r.character === gov)).toBe(false);
        expect(gov.active).toBe(true);
        expect((st.cells ?? []).some((c) => c.colony === colony)).toBe(false);
        expect(detonationChancePerMille(g, colony)).toBe(0);
    }, 600000);

    it('end: defeat fires only while the cult is undefeated', () => {
        const st = timeBombState(g);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        g.scenario!.params.timeBombDefeatDestroyed = 1;
        g.scenario!.params.timeBombMaxChancePct = 0;
        expect(st.destroyed.length).toBeGreaterThanOrEqual(1);
        // No faction, no cell left: the cult is defeated, so the destroyed count does not end the game.
        timeBombYearly(g, year + 7);
        expect(ends).toEqual([]);
        expect(st.ended).toBe(false);
        // A new cell: the cult is back, the defeat fires.
        cultGovernor(g, victim, spareColony(victim, [bombed]));
        timeBombYearly(g, year + 8);
        expect(ends.map((e) => e.code)).toEqual([TIME_BOMB_CODE_DEFEAT]);
        expect(st.outcome).toBe('defeat');
        setGameEndHandler(g, null);
    }, 600000);
});

describe('Time-bomb tech: the seceded cult inherits the nodes and war-detonates', () => {
    let game: Game;
    let g: Galaxy;
    let year: number;
    let host: Empire;
    let faction: Empire;

    it('secession: the cult faction inherits its host empire\'s precursor nodes', () => {
        game = tbGame().game;
        g = game.galaxy;
        forceYear(g);
        runGameSeconds(game, 65);
        const st = timeBombState(g);
        year = gameYear(galaxyStarDate(g));
        timeBombYearly(g, year);
        [host] = aiVictims(g);
        holdAll(g, host);
        cultGovernor(g, host, spareColony(host));
        cultCheckTrigger(g);
        faction = cultState(g).faction!;
        expect(faction).not.toBeNull();
        expect(st.cultHosts).toContain(host.empireId);
        expect(cultNodesHeld(g)).toEqual([...st.nodes]);
        for (const id of st.nodes) expect(faction.research.techTree.find((n) => n.def.projectId === id)?.isResearched).toBe(true);
    }, 600000);

    it('abandonTech strips the host, never the cult faction', () => {
        const st = timeBombState(g);
        expect(abandonTech(g, faction)).toBe(false);
        expect(abandonTech(g, host)).toBe(true);
        expect(cultNodesHeld(g)).toEqual([...st.nodes]);
        timeBombYearly(g, year + 1);
        expect(cultNodesHeld(g)).toEqual([...st.nodes]);
    }, 600000);

    it('war: the cult detonates an enemy cell colony that holds no node itself; the victim records a grievance', () => {
        g.scenario!.flags.reputationLedger = true;
        const st = timeBombState(g);
        const enemy = normalEmpires(g, faction).find((e) => e !== host && e !== g.playerEmpire && e.colonies.length >= 2)!;
        expect(enemy).toBeDefined();
        expect(atWar(faction, enemy)).toBe(true);
        expect(enemy.research.techTree.some((n) => st.nodes.includes(n.def.projectId) && n.isResearched)).toBe(false);
        const colony = spareColony(enemy);
        cultGovernor(g, enemy, colony);
        g.scenario!.params.timeBombChancePerMillePerColony = 0;
        g.scenario!.params.timeBombCultWarChancePct = 100;
        g.scenario!.params.timeBombDefeatDestroyed = 50;
        expect(detonationChancePerMille(g, colony)).toBe(1000);
        timeBombYearly(g, year + 2);
        expect(colony.hasBeenDestroyed).toBe(true);
        expect(reputationCauses(g, enemy, faction).some((e) => e.cause === 'timeBomb.cultDetonation' && e.value < 0)).toBe(true);
    }, 600000);

    it('containing the cult (its own containment path) ends the Time Bomb arc as contained', () => {
        const st = timeBombState(g);
        const cst = cultState(g);
        for (const c of [...faction.colonies]) takeOwnershipOfColonyFull(g, faction, c, g.independentEmpire, false, false);
        for (const b of [...faction.builtObjects, ...faction.privateBuiltObjects]) builtObjectCompleteTeardown(g, b);
        cst.converted = [];
        cst.factionHadColonies = true; // the militia's colonies were lost again (as the cult test's containment)
        teardownIfDead(g, faction);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        cultEndCheck(g, cst);
        expect(cst.ended).toBe(true);
        timeBombYearly(g, year + 3);
        expect(st.ended).toBe(true);
        expect(st.outcome).toBe('contained');
        expect(ends.map((e) => e.code)).not.toContain(TIME_BOMB_CODE_DEFEAT);
        setGameEndHandler(g, null);
    }, 600000);
});
