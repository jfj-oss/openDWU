// 19f-2 The Cult (tasks/19f-hidden-threats.md §2): off-path, forced conversion on seed 1 (character→character spread
// across a shared location, a cult-held colony), the trigger (Way of Darkness rises, militia invades from inside),
// discovery, containment.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly } from '../src/sim/scenario/hooks';
import {
    CULT_CODE_CONTAINED,
    CULT_HANDLER_IDS,
    convert,
    cultCheckTrigger,
    cultDiscovery,
    cultEndCheck,
    cultHeldColonies,
    cultKnownSites,
    cultSpread,
    cultState,
    peekCultState,
    registerCult,
} from '../src/sim/scenario/threats/cult';
import { normalEmpires, teardownIfDead } from '../src/sim/scenario/threats/framework';
import { CharacterRole, IntelligenceMission, generateNewCharacter } from '../src/sim/characters';
import { GameEndOutcome, setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const FORCE = { cultSeedYear: 0, cultSpreadPct: 100, cultAmbassadorPct: 100, cultSecedeColonies: 1, cultAgentDetectPct: 0 };
const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function ctGame(params: Record<string, number> = {}, flags: Record<string, boolean> = {}, older = true): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: 'cult', flags: { cult: true, ...flags }, params: { ...FORCE, ...params }, options: older ? age3 : undefined });
}

function unregisterCult(): void {
    for (const id of CULT_HANDLER_IDS) {
        registerScenarioYearly({ id, run: () => undefined })();
        registerScenarioPeriodic({ id, periodDays: 1, run: () => undefined })();
        registerScenarioEvent({ id, event: 'characterCreated', run: () => undefined })();
    }
}

describe('Cult: flag off', () => {
    it('flag off: no state, and the same draws and digest as the game without the package', () => {
        const a = ctGame({}, { cult: false }, false).game;
        runGameSeconds(a, 125);
        expect(peekCultState(a.galaxy)).toBeNull();
        unregisterCult();
        try {
            const b = ctGame({}, { cult: false }, false).game;
            runGameSeconds(b, 125);
            expect(b.galaxy.rnd.drawCount).toBe(a.galaxy.rnd.drawCount);
            expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        } finally {
            registerCult();
        }
    }, 1200000);
});

describe('Cult: forced conversion on seed 1', () => {
    let game: Game;
    let g: Galaxy;
    let colony: import('../src/sim/types').Habitat;
    let governor: import('../src/sim/characters').Character;

    it('seed: a colony governor converted directly becomes a cult-held colony', () => {
        game = ctGame().game;
        g = game.galaxy;
        const st = cultState(g);
        const [empireA] = normalEmpires(g);
        // The stock AI assigns governors over play time; forced here (as a colony's governor) rather than waiting for it.
        colony = empireA.colonies.find((c) => c !== empireA.capital && c.population.totalAmount > 0) ?? empireA.capital!;
        governor = generateNewCharacter(g, empireA, CharacterRole.ColonyGovernor, colony).character;
        expect(governor).toBeDefined();
        convert(g, st, governor!);
        expect(cultHeldColonies(g, st)).toContain(colony);
        expect(cultKnownSites(g, empireA).some((s) => s.target === colony)).toBe(true);
    }, 1200000);

    it('spread: a converted character converts a co-located character at cultSpreadPct (forced 100%)', () => {
        const st = cultState(g);
        const [empireA] = normalEmpires(g);
        const other = generateNewCharacter(g, empireA, CharacterRole.ShipCaptain, governor.location).character;
        expect(other).toBeDefined();
        expect(st.converted.some((r) => r.character === other)).toBe(false);
        cultSpread(g, st);
        expect(st.converted.some((r) => r.character === other)).toBe(true);
    }, 600000);

    it('the trigger: enough cult-held colonies secede — Way of Darkness rises, militia invades from inside', () => {
        const st = cultState(g);
        expect(cultHeldColonies(g, st)).toContain(colony);
        cultCheckTrigger(g);
        expect(st.faction).not.toBeNull();
        expect(st.faction!.name).toBe('Way of Darkness');
        expect(colony.invadingTroops).not.toBeNull();
        expect(colony.invadingTroops!.count).toBeGreaterThan(0);
        for (const t of colony.invadingTroops!.items) expect(t.empire).toBe(st.faction);
    }, 600000);

    it('discovery: a counter-intelligence agent confirms a converted character in its own empire', () => {
        const st = cultState(g);
        const [empireA] = normalEmpires(g);
        const agent = generateNewCharacter(g, empireA, CharacterRole.IntelligenceAgent, empireA.capital).character;
        agent.mission = new IntelligenceMission(empireA, agent, 0); // defaults to CounterIntelligence
        const converted = st.converted.find((r) => r.character.empire === empireA)!;
        expect(converted).toBeDefined();
        // Detection is pct(1/1000) × espionageFactored (≥ 25 even at 0 espionage): a huge pct forces the roll regardless.
        g.scenario!.params.cultAgentDetectPct = 1000000;
        cultDiscovery(g, st);
        expect(converted.knowledge.some((k) => k.empireId === empireA.empireId && k.level === 3)).toBe(true);
        g.scenario!.params.cultAgentDetectPct = 0;
    }, 600000);

    it('containment: eliminating the theocracy ends the game (victory)', () => {
        const st = cultState(g);
        const faction = st.faction!;
        for (const c of [...faction.colonies]) takeOwnershipOfColonyFull(g, faction, c, g.independentEmpire, false, false);
        for (const b of [...faction.builtObjects, ...faction.privateBuiltObjects]) builtObjectCompleteTeardown(g, b);
        st.converted = [];
        expect(teardownIfDead(g, faction)).toBe(true);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        cultEndCheck(g, st);
        expect(st.ended).toBe(true);
        expect(ends.map((e) => e.code)).toEqual([CULT_CODE_CONTAINED]);
        expect(ends[0].outcomeForPlayer).toBe(GameEndOutcome.Victory);
        setGameEndHandler(g, null);
    }, 600000);
});
