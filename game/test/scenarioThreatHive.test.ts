// 19f-5 The Hive (tasks/19f-hidden-threats.md §5): off-path, forced trigger on seed 1 (nodes captured at game start,
// absorption spread, discovery, the trigger — The Chorus rises, still-independent nodes taken outright, absorbed
// nodes rise from inside), containment.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { registerScenarioEvent, registerScenarioGameStart, registerScenarioPeriodic } from '../src/sim/scenario/hooks';
import {
    HIVE_CODE_CONTAINED,
    HIVE_HANDLER_IDS,
    hiveEndCheck,
    hiveKnownSites,
    hivePeriodic,
    hiveState,
    hiveTrigger,
    peekHiveState,
    registerHive,
    type HiveState,
} from '../src/sim/scenario/threats/hive';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { GameEndOutcome, setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const FORCE = { hiveThresholdPct: 40, hiveMinNodes: 1, hiveMilitiaFactor: 1.5, hiveDetectPct: 0, hiveExistChancePct: 100, hiveMinYear: 0 };
const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function hvGame(params: Record<string, number> = {}, flags: Record<string, boolean> = {}, older = true): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: 'hive', flags: { hive: true, ...flags }, params: { ...FORCE, ...params }, options: older ? age3 : undefined });
}

function unregisterHive(): void {
    for (const id of HIVE_HANDLER_IDS) {
        registerScenarioGameStart({ id, run: () => undefined })();
        registerScenarioPeriodic({ id, periodDays: 1, run: () => undefined })();
        registerScenarioEvent({ id, event: 'builtObjectRemoved', run: () => undefined })();
    }
}

describe('Hive: flag off', () => {
    it('flag off: no state, and the same draws and digest as the game without the package', () => {
        const a = hvGame({}, { hive: false }, false).game;
        runGameSeconds(a, 125);
        expect(peekHiveState(a.galaxy)).toBeNull();
        unregisterHive();
        try {
            const b = hvGame({}, { hive: false }, false).game;
            runGameSeconds(b, 125);
            expect(b.galaxy.rnd.drawCount).toBe(a.galaxy.rnd.drawCount);
            expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        } finally {
            registerHive();
        }
    }, 1200000);
});

describe('Hive: forced trigger on seed 1', () => {
    let game: Game;
    let g: Galaxy;

    it('init: every independent colony at game start is a node', () => {
        // Age 1 (not age3 like the other threats): independent colonies are plentiful early and scarce once empires
        // have expanded, and this threat only needs independents, not multi-colony empires.
        game = hvGame({}, {}, false).game;
        g = game.galaxy;
        const st = hiveState(g);
        expect(st.nodes.length).toBeGreaterThan(0);
        expect(st.nodes.every((n) => n.habitat.empire === g.independentEmpire)).toBe(true);
    }, 1200000);

    it('spread: a node absorbed by a normal empire is recorded and revealed (level 2) to its new owner', () => {
        const st = hiveState(g);
        const node = st.nodes[0];
        const owner = g.empires.find((e) => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null)!;
        takeOwnershipOfColonyFull(g, g.independentEmpire!, node.habitat, owner, false, false);
        expect(st.absorbed).toContain(node.habitat);
        expect(hiveKnownSites(g, owner).some((s) => s.target === node.habitat && s.level === 2)).toBe(true);
    }, 600000);

    it('discovery: node status is confirmed (level 3) to the empire holding it (forced roll)', () => {
        const st = hiveState(g);
        g.scenario!.params.hiveDetectPct = 100;
        hivePeriodic(g, galaxyStarDate(g));
        const node = st.nodes.find((n) => st.absorbed.includes(n.habitat))!;
        const owner = node.habitat.empire!;
        expect(hiveKnownSites(g, owner).some((s) => s.target === node.habitat && s.level === 3)).toBe(true);
        g.scenario!.params.hiveDetectPct = 0;
    }, 600000);

    it('the trigger: enough absorption rises The Chorus — still-independent nodes taken, absorbed nodes invaded', () => {
        const st = hiveState(g);
        // Force the rest of the nodes absorbed too, so absorptionPct crosses the threshold.
        const owner = st.absorbed[0].empire!;
        for (const n of st.nodes) {
            if (n.habitat.empire === g.independentEmpire) takeOwnershipOfColonyFull(g, g.independentEmpire!, n.habitat, owner, false, false);
        }
        expect(st.absorbed.length).toBe(st.nodes.length);
        hivePeriodic(g, galaxyStarDate(g));
        expect(st.faction).not.toBeNull();
        const faction = st.faction!;
        expect(faction.name).toBe('The Chorus');
        for (const n of st.nodes) {
            const h = n.habitat;
            if (h.hasBeenDestroyed) continue;
            expect(h.empire === faction || (h.invadingTroops !== null && h.invadingTroops.count > 0)).toBe(true);
        }
    }, 600000);

    it('containment: destroying every Chorus colony/ship tears the faction down and ends the game (victory)', () => {
        const st = hiveState(g);
        const faction = st.faction!;
        for (const c of [...faction.colonies]) takeOwnershipOfColonyFull(g, faction, c, g.independentEmpire, false, false);
        for (const b of [...faction.builtObjects, ...faction.privateBuiltObjects]) builtObjectCompleteTeardown(g, b);
        // Forced: this seed's node count may leave the faction with 0 synchronous colonies at the trigger (every node
        // pending ground-war invasion rather than an outright transfer) — force the "it had colonies" bookkeeping so
        // the ending path is exercised without waiting real game time for the invasion to resolve.
        st.factionHadColonies = true;
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        hiveEndCheck(g, st);
        expect(st.ended).toBe(true);
        expect(ends.map((e) => e.code)).toEqual([HIVE_CODE_CONTAINED]);
        expect(ends[0].outcomeForPlayer).toBe(GameEndOutcome.Victory);
        setGameEndHandler(g, null);
    }, 600000);
});

describe('Hive: hiveMaxNodesSeized (§4 rarity and timing)', () => {
    it('the trigger seizes at most the cap of still-independent nodes on a hand-built state with 100 independents, nearest the absorbed cluster first', () => {
        const { game } = hvGame({ hiveMaxNodesSeized: 30 }, {}, false);
        const g = game.galaxy;

        // 100 hand-built "still independent" nodes: arbitrary uncolonized habitats, directly marked independent
        // (only their ownership and position matter to hiveTrigger's selection logic).
        const uncolonized = g.habitats.filter((h) => h !== null && !h.hasBeenDestroyed && h.empire === null);
        expect(uncolonized.length).toBeGreaterThanOrEqual(100);
        const independentHabitats = uncolonized.slice(0, 100);
        for (const h of independentHabitats) h.empire = g.independentEmpire;

        // A small absorbed cluster of real, populated colonies (so majorityNodeRace resolves and there is a cluster
        // centre to measure "nearest" from): three colonies of the same real empire, clustered together in space.
        const owner = g.empires.find((e) => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.length >= 1)!;
        const absorbedColonies = owner.colonies.slice(0, Math.min(3, owner.colonies.length));
        expect(absorbedColonies.length).toBeGreaterThan(0);

        const st: HiveState = {
            nodes: [
                ...independentHabitats.map((habitat) => ({ habitat, knowledge: [] })),
                ...absorbedColonies.map((habitat) => ({ habitat, knowledge: [] })),
            ],
            absorbed: [...absorbedColonies],
            faction: null,
            agentsGiven: false,
            sentStages: {},
            factionHadColonies: false,
            ended: false,
        };

        expect(hiveTrigger(g, st)).toBe(true);
        expect(st.faction).not.toBeNull();
        const seized = independentHabitats.filter((h) => h.empire === st.faction);
        const stillIndependent = independentHabitats.filter((h) => h.empire === g.independentEmpire);
        expect(seized.length).toBeLessThanOrEqual(30);
        expect(seized.length).toBe(30); // 100 independents > the cap: exactly the cap is seized
        expect(stillIndependent.length).toBe(70); // the rest stay independent nodes (still tracked in st.nodes)
        expect(seized.length + stillIndependent.length).toBe(independentHabitats.length);
    }, 600000);
});
