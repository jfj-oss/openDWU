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
import { registerScenarioEvent, registerScenarioGameStart, registerScenarioPeriodic, scenarioQuery } from '../src/sim/scenario/hooks';
import {
    HIVE_CODE_CONTAINED,
    HIVE_HANDLER_IDS,
    hiveEndCheck,
    formerIndependentGuess,
    hiveKnownSites,
    hivePeriodic,
    hiveState,
    hiveTrigger,
    peekHiveState,
    registerHive,
    type HiveState,
} from '../src/sim/scenario/threats/hive';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { annualTroopMaintenance } from '../src/sim/troops';
import { Population } from '../src/sim/population';
import { FleetPosture } from '../src/sim/diplomacyTick';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { empireTechLevel } from '../src/sim/scenario/threats/robotMutiny';
import { averageTechLevel, pumpShipCap } from '../src/sim/scenario/threats/factionNavy';
import { hiveNavyMonthly, hiveFleets } from '../src/sim/scenario/threats/hive';
import { makeFactionTroop, normalEmpires } from '../src/sim/scenario/threats/framework';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { GameEndOutcome, setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const FORCE = { hiveThresholdPct: 40, hiveMinNodes: 1, hiveMilitiaFactor: 1.5, hiveDetectPct: 0, hiveExistChancePct: 100, hiveMinYear: 0, hiveRiseChancePct: 100 };
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

    it('economy and navy: tech at the galaxy average, money, free ports on its biggest worlds, a free navy, an income floor, free troops', () => {
        const st = hiveState(g);
        const faction = st.faction!;
        expect(empireTechLevel(faction)).toBeGreaterThanOrEqual(averageTechLevel(g, faction));
        expect(faction.stateMoney).toBeGreaterThanOrEqual(1000000);
        expect(faction.privateMoney).toBeGreaterThanOrEqual(10000000);
        expect(st.navy!.pendingStrength).toBeGreaterThan(0);
        // Give it a few worlds (the nodes' ground wars may not have resolved), then the monthly handler.
        for (const n of st.nodes.slice(0, 5)) if (n.habitat.empire !== faction && !n.habitat.hasBeenDestroyed) takeOwnershipOfColonyFull(g, n.habitat.empire!, n.habitat, faction, false, false);
        expect(faction.colonies.length).toBeGreaterThan(0);
        g.scenario!.params.hivePumpPct = 0; // the pump and the station founder have their own test
        g.scenario!.params.hiveStationsPerMonth = 0;
        hiveNavyMonthly(g);
        expect(faction.spacePorts.length).toBeGreaterThanOrEqual(1);
        expect(faction.spacePorts.length).toBeLessThanOrEqual(4);
        expect(faction.spacePorts.every((b) => b.supportCostFactor === 0)).toBe(true);
        const warships = faction.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed);
        expect(warships.length).toBeGreaterThan(0);
        expect(warships.every((b) => b.supportCostFactor === 0)).toBe(true);
        expect(empireShipGroups(faction).some((sg) => sg !== null && sg.posture === FleetPosture.Defend && sg.ships.length > 0)).toBe(true);
        expect((faction.constructionShips as import('../src/sim/builtObject').BuiltObject[]).filter((b) => b.isShipYard).length).toBeGreaterThanOrEqual(2); // so its AI can build mining stations
        const before = faction.stateMoney + faction.privateMoney;
        faction.stateMoney -= 200000;
        hiveNavyMonthly(g);
        expect(faction.stateMoney + faction.privateMoney).toBeCloseTo(before + 50000, 0);
        faction.troops.add(makeFactionTroop(g, faction, 60, 'Chorus Militia', null));
        expect(annualTroopMaintenance(faction)).toBe(0);
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

describe('Hive: nodes are every colony that was independent', () => {
    it('an older start: the colonies its settling took from the independents are nodes, already absorbed by their empires', () => {
        const { game } = hvGame({}, {}, true);
        const g = game.galaxy;
        const st = hiveState(g);
        expect(st.tracked).toBe(true);
        expect(st.absorbed.length).toBeGreaterThan(0);
        for (const h of st.absorbed) {
            expect(h.empire).not.toBeNull();
            expect(h.empire).not.toBe(g.independentEmpire);
            expect(st.nodes.some((n) => n.habitat === h)).toBe(true);
        }
        // Still-independent colonies are nodes too, and no habitat is listed twice.
        for (const h of g.independentColonies) expect(st.nodes.some((n) => n.habitat === h)).toBe(true);
        expect(new Set(st.nodes.map((n) => n.habitat)).size).toBe(st.nodes.length);
    }, 1200000);

    it('the record is kept in a game the Hive rolled "not this game" for (no advisory, no rise), so a later editor spawn knows the nodes', () => {
        const { game } = hvGame({ hiveExistChancePct: 0 }, {}, false);
        const g = game.galaxy;
        const st = peekHiveState(g)!;
        expect(st).not.toBeNull();
        expect(st.tracked).toBe(true);
        expect(st.nodes.length).toBeGreaterThan(0);
        const node = st.nodes[0];
        const owner = g.empires.find((e) => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null)!;
        takeOwnershipOfColonyFull(g, g.independentEmpire!, node.habitat, owner, false, false);
        expect(st.absorbed).toContain(node.habitat);
        expect(hiveKnownSites(g, owner)).toEqual([]);
        hivePeriodic(g, galaxyStarDate(g));
        expect(st.faction).toBeNull();
    }, 1200000);

    it('formerIndependentGuess: an empire colony whose people are of a race no empire has was taken from the independents; colonies of an empire\'s own race are not', () => {
        const { game } = hvGame({}, {}, true);
        const g = game.galaxy;
        expect(formerIndependentGuess(g)).toEqual([]);
        const owner = g.empires.find((e) => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null)!;
        const colony = owner.colonies.find((c) => c !== owner.capital && c.population.totalAmount > 0)!;
        const used = new Set(g.empires.map((e) => e.dominantRace));
        const stranger = g.races.find((r) => !used.has(r))!;
        expect(stranger).toBeDefined();
        colony.population.items.length = 0;
        colony.population.add(new Population(stranger, 1000000, g));
        colony.population.recalculateTotalAmount();
        expect(formerIndependentGuess(g)).toEqual([colony]);
    }, 1200000);
});

describe('Hive: the fleet of an empire it wipes out', () => {
    it('conquestWarshipLimit answers hiveCapturedFleetMax for the Chorus and nothing for any other conqueror', () => {
        const { game } = hvGame({ hiveCapturedFleetMax: 7 }, {}, false);
        const g = game.galaxy;
        const st = hiveState(g);
        expect(hiveTrigger(g, st)).toBe(true);
        const [a, b] = normalEmpires(g, st.faction);
        expect(scenarioQuery(g, 'conquestWarshipLimit', Number.POSITIVE_INFINITY, { conqueror: st.faction!, empire: a })).toBe(7);
        expect(scenarioQuery(g, 'conquestWarshipLimit', Number.POSITIVE_INFINITY, { conqueror: b, empire: a })).toBe(Number.POSITIVE_INFINITY);
    }, 1200000);
});

describe('Hive: the rise chance (hiveRiseChancePct)', () => {
    it('meeting the threshold does not raise the Chorus by itself: a yearly roll, once per game year', () => {
        const { game } = hvGame({ hiveRiseChancePct: 0 }, {}, false);
        const g = game.galaxy;
        const st = hiveState(g);
        const owner = g.empires.find((e) => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null)!;
        for (const n of st.nodes) if (n.habitat.empire === g.independentEmpire) takeOwnershipOfColonyFull(g, g.independentEmpire!, n.habitat, owner, false, false);
        expect(st.absorbed.length).toBe(st.nodes.length);
        hivePeriodic(g, galaxyStarDate(g));
        expect(st.faction).toBeNull(); // chance 0: not this year
        const year = st.riseRollYear;
        expect(year).toBeDefined();
        g.scenario!.params.hiveRiseChancePct = 100;
        hivePeriodic(g, galaxyStarDate(g));
        expect(st.faction).toBeNull(); // the year's roll has been made
        st.riseRollYear = year! - 1;
        hivePeriodic(g, galaxyStarDate(g));
        expect(st.faction).not.toBeNull(); // next year, chance 100: it rises
    }, 1200000);
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

describe('Hive: garrisons and fleets', () => {
    it('every held node is kept at 2,000,000 defence strength; fleets defend a world under attack and attack otherwise', () => {
        const { game } = hvGame({}, {}, false);
        const g = game.galaxy;
        const st = hiveState(g);
        const owner = g.empires.find((e) => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.builtObjects.some((b) => b.role === BuiltObjectRole.Military))!;
        for (const n of st.nodes.slice(0, 3)) takeOwnershipOfColonyFull(g, g.independentEmpire!, n.habitat, owner, false, false);
        hiveTrigger(g, st);
        const faction = st.faction!;
        for (const n of st.nodes.slice(0, 3)) if (n.habitat.empire !== faction && !n.habitat.hasBeenDestroyed) takeOwnershipOfColonyFull(g, n.habitat.empire!, n.habitat, faction, false, false);
        hiveNavyMonthly(g);
        expect(faction.colonies.length).toBeGreaterThan(0);
        for (const c of faction.colonies) {
            expect(c.troops!.totalDefendStrength).toBeGreaterThanOrEqual(2000000);
            expect(c.troops!.totalDefendStrength).toBeLessThan(2000000 + 100 * 100);
        }
        const colony = faction.colonies[0];
        colony.troops!.items.length = 0;
        hiveNavyMonthly(g);
        expect(colony.troops!.totalDefendStrength).toBeGreaterThan(83333 - 100); // gradual: 2M over hiveGarrisonRefillYears (2)
        expect(colony.troops!.totalDefendStrength).toBeLessThan(83333 + 100 * 100);
        const grown = colony.troops!.totalDefendStrength;
        hiveFleets(g); // the 5-day handler no longer refills
        expect(colony.troops!.totalDefendStrength).toBe(grown);
        const fleets = empireShipGroups(faction).filter((sg) => sg !== null && sg.ships.length > 0 && sg.leadShip !== null);
        expect(fleets.length).toBeGreaterThan(0);
        for (const sg of fleets) sg!.posture = FleetPosture.Defend;
        for (const e of g.empires) if (e !== faction) for (const b of e.builtObjects) if (b.role === BuiltObjectRole.Military) { b.xpos = colony.xpos + 90000; b.ypos = colony.ypos + 90000; }
        hiveFleets(g);
        expect(fleets.every((sg) => sg!.posture === FleetPosture.Attack)).toBe(true);
        const enemy = owner.builtObjects.find((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed)!;
        enemy.xpos = colony.xpos + 500;
        enemy.ypos = colony.ypos;
        hiveFleets(g);
        expect(fleets.every((sg) => sg!.posture === FleetPosture.Defend && sg!.mission !== null && sg!.mission.targetHabitat !== null && faction.colonies.includes(sg!.mission.targetHabitat))).toBe(true);
        enemy.xpos = colony.xpos + 90000;
        enemy.ypos = colony.ypos + 90000;
        hiveFleets(g);
        expect(fleets.every((sg) => sg!.posture === FleetPosture.Attack)).toBe(true);
    }, 1200000);
});

describe('Hive: navy rebuild and mining stations', () => {
    it('the monthly pump buys warships while below its target; the faction founds mining stations itself', () => {
        const { game } = hvGame({}, {}, false);
        const g = game.galaxy;
        const st = hiveState(g);
        const owner = g.empires.find((e) => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.builtObjects.some((b) => b.role === BuiltObjectRole.Military) && e.miningStations.length > 0)!;
        for (const n of st.nodes.slice(0, 3)) takeOwnershipOfColonyFull(g, g.independentEmpire!, n.habitat, owner, false, false);
        hiveTrigger(g, st);
        const faction = st.faction!;
        for (const n of st.nodes.slice(0, 3)) if (n.habitat.empire !== faction && !n.habitat.hasBeenDestroyed) takeOwnershipOfColonyFull(g, n.habitat.empire!, n.habitat, faction, false, false);
        g.scenario!.params.hiveStationsPerMonth = 0;
        hiveNavyMonthly(g);
        const live = () => faction.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed);
        expect(live().length).toBeGreaterThan(0);
        g.scenario!.params.hivePumpPct = 0;
        hiveNavyMonthly(g);
        expect(st.navy!.pumpBought ?? 0).toBe(0);
        g.scenario!.params.hivePumpPct = 500;
        g.scenario!.params.hivePumpThreatPct = 1e9; // (the threat check has its own test, in the Cult file)
        for (const b of [...live()]) builtObjectCompleteTeardown(g, b);
        faction.stateMoney = 5000000;
        hiveNavyMonthly(g);
        expect(live().length).toBe(3);
        expect(live().every((b) => b.supportCostFactor === 0 && b.shipGroup !== null)).toBe(true);
        g.scenario!.params.hivePumpMaxShips = 4;
        hiveNavyMonthly(g);
        expect(live().length).toBe(4);
        // Default cap scales with the galaxy: the largest normal empire's warships (pumpCapPct 100), at least pumpMinShips.
        delete g.scenario!.params.hivePumpMaxShips;
        const largest = Math.max(...normalEmpires(g, faction).map((e) => e.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed).length));
        expect(pumpShipCap(g, 'hive', faction)).toBe(Math.max(30, largest));
        g.scenario!.params.hivePumpCapPct = 1000;
        g.scenario!.params.hivePumpMinShips = 0;
        expect(pumpShipCap(g, 'hive', faction)).toBe(largest * 10);
        delete g.scenario!.params.hivePumpCapPct;
        delete g.scenario!.params.hivePumpMinShips;
        g.scenario!.params.hiveStationsPerMonth = 1;
        const stations0 = faction.miningStations.length;
        const found0 = st.navy!.stationsFounded ?? 0;
        faction.stateMoney = 5000000;
        hiveNavyMonthly(g);
        const founded = (st.navy!.stationsFounded ?? 0) - found0;
        expect(founded).toBe(1);
        expect(faction.miningStations.length).toBe(stations0 + 1);
    }, 1200000);
});
