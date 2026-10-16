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
    cultSecedeThreshold,
    cultKnownSites,
    cultSpread,
    cultState,
    peekCultState,
    registerCult,
} from '../src/sim/scenario/threats/cult';
import { normalEmpires, teardownIfDead } from '../src/sim/scenario/threats/framework';
import { CharacterRole, IntelligenceMission, generateNewCharacter, getEmpireCharacters } from '../src/sim/characters';
import { GameEndOutcome, setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { annualTroopMaintenance } from '../src/sim/troops';
import { militaryPotency, FleetPosture } from '../src/sim/diplomacyTick';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { empireTechLevel } from '../src/sim/scenario/threats/robotMutiny';
import { averageTechLevel, syncFactionTech } from '../src/sim/scenario/threats/factionNavy';
import { cultNavyMonthly, cultFleets } from '../src/sim/scenario/threats/cult';
import { makeFactionTroop } from '../src/sim/scenario/threats/framework';
import { BuiltObjectMissionPriority } from '../src/sim/missions/mission';
import { TroopList } from '../src/sim/cargo';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const FORCE = { cultSeedYear: 0, cultSpreadPct: 100, cultAmbassadorPct: 100, cultSecedeColonies: 1, cultAgentDetectPct: 0, cultExistChancePct: 100, cultMinYear: 0 };
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
        // A birth at a cult-held colony starts converted 25% of the time (onCharacterCreated), so draw until one is not.
        let other = generateNewCharacter(g, empireA, CharacterRole.ShipCaptain, governor.location).character;
        for (let i = 0; i < 30 && other !== undefined && st.converted.some((r) => r.character === other); i++) {
            other = generateNewCharacter(g, empireA, CharacterRole.ShipCaptain, governor.location).character;
        }
        expect(other).toBeDefined();
        expect(st.converted.some((r) => r.character === other)).toBe(false);
        cultSpread(g, st);
        expect(st.converted.some((r) => r.character === other)).toBe(true);
    }, 600000);

    it('the trigger: enough cult-held colonies secede — Way of Darkness rises, militia invades from inside', () => {
        const st = cultState(g);
        expect(cultHeldColonies(g, st)).toContain(colony);
        // The threshold follows the governed colonies: cultSecedeColonies 4 with one governed colony = the floor (2);
        // with 4+ governed it is 4; never above cultSecedeColonies (1 here, forced).
        const [empireA] = normalEmpires(g);
        const params = g.scenario!.params;
        const forced = params.cultSecedeColonies;
        params.cultSecedeColonies = 4;
        const governed = empireA.colonies.filter((c) => c.empire === empireA && getEmpireCharacters(empireA).some((ch) => ch.active && ch.role === CharacterRole.ColonyGovernor && ch.location === c)).length;
        expect(cultSecedeThreshold(g, empireA)).toBe(Math.min(4, Math.max(2, governed)));
        params.cultSecedeColonies = forced;
        expect(cultSecedeThreshold(g, empireA)).toBe(1);
        cultCheckTrigger(g);
        expect(st.faction).not.toBeNull();
        expect(st.faction!.name).toBe('Way of Darkness');
        expect(colony.invadingTroops).not.toBeNull();
        expect(colony.invadingTroops!.count).toBeGreaterThan(0);
        for (const t of colony.invadingTroops!.items) expect(t.empire).toBe(st.faction);
        // The rising force per colony is cultRisingStrength (800,000 by default, the Ground Report measure).
        expect(colony.invadingTroops!.totalAttackStrength).toBe(800000);
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

describe('Cult: economy and navy', () => {
    it('rises at the galaxy tech with money, a free port, the host\'s mining stations, a free navy, an income floor and free troops', () => {
        const { game } = ctGame();
        const g = game.galaxy;
        g.scenario!.params.cultPumpPct = 0; // the pump and the station founder have their own test
        g.scenario!.params.cultStationsPerMonth = 0;
        const st = cultState(g);
        const host = normalEmpires(g).find((e) => e.colonies.some((c) => c !== e.capital && c.population.totalAmount > 0) && e.miningStations.length > 0)!;
        expect(host).toBeDefined();
        const colony = host.colonies.find((c) => c !== host.capital && c.population.totalAmount > 0)!;
        const governor = generateNewCharacter(g, host, CharacterRole.ColonyGovernor, colony).character;
        convert(g, st, governor!);
        const hostPotency = militaryPotency(host);
        cultCheckTrigger(g);
        const faction = st.faction!;
        expect(faction).not.toBeNull();
        // Tech and money.
        expect(empireTechLevel(faction)).toBeGreaterThanOrEqual(averageTechLevel(g, faction));
        expect(faction.stateMoney).toBeGreaterThanOrEqual(1000000);
        expect(faction.privateMoney).toBeGreaterThanOrEqual(10000000);
        expect(st.navy!.pendingStrength).toBeCloseTo(hostPotency * 0.3, 3);
        // Smarter AI treats it like any AI empire.
        expect(faction.pirateEmpireBaseHabitat).toBeNull();
        expect(faction.dominantRace).not.toBeNull();
        expect(faction.playerEmpire).toBe(false);
        // The colony falls: a medium port with no upkeep, and the host's nearest mining stations.
        const hostStations = host.miningStations.length;
        takeOwnershipOfColonyFull(g, host, colony, faction, false, false);
        expect(faction.spacePorts.length).toBe(1);
        expect(faction.spacePorts[0].supportCostFactor).toBe(0);
        expect(st.navy!.stationsTaken).toBeGreaterThan(0);
        expect(faction.miningStations.length).toBe(st.navy!.stationsTaken);
        expect(host.miningStations.length).toBe(hostStations - st.navy!.stationsTaken);
        // The monthly handler: the starting navy at its tech, no upkeep, in a Defend fleet.
        cultNavyMonthly(g);
        const warships = faction.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed);
        expect(warships.length).toBeGreaterThan(0);
        expect(st.navy!.shipsSpawned + (st.navy!.pumpBought ?? 0)).toBe(warships.length);
        expect(warships.every((b) => b.supportCostFactor === 0)).toBe(true);
        expect(st.navy!.pendingStrength).toBe(0);
        expect(empireShipGroups(faction).some((sg) => sg !== null && sg.posture === FleetPosture.Defend && sg.ships.length > 0)).toBe(true);
        expect((faction.constructionShips as import('../src/sim/builtObject').BuiltObject[]).filter((b) => b.isShipYard).length).toBeGreaterThanOrEqual(2); // so its AI can build mining stations
        // Income floor: a month that nets less than the floor is topped up to it.
        const before = faction.stateMoney + faction.privateMoney;
        faction.stateMoney -= 200000;
        cultNavyMonthly(g);
        expect(faction.stateMoney + faction.privateMoney).toBeCloseTo(before + 50000, 0);
        // Troops cost it nothing; the host's still do.
        const t = makeFactionTroop(g, faction, 60, 'Cult Militia', null);
        faction.troops.add(t);
        expect(annualTroopMaintenance(faction)).toBe(0);
        expect(annualTroopMaintenance(host)).toBeGreaterThan(0);
        // The yearly sync never lowers it and does nothing when it is level with the galaxy.
        expect(syncFactionTech(g, faction)).toBe(false);
    }, 1200000);
});

describe('Cult: garrisons and fleets', () => {
    it('every held colony is kept at 2,000,000 defence strength; fleets defend a world under attack and attack otherwise', () => {
        const { game } = ctGame();
        const g = game.galaxy;
        const st = cultState(g);
        const host = normalEmpires(g).find((e) => e.colonies.some((c) => c !== e.capital && c.population.totalAmount > 0) && e.builtObjects.some((b) => b.role === BuiltObjectRole.Military))!;
        const colony = host.colonies.find((c) => c !== host.capital && c.population.totalAmount > 0)!;
        const governor = generateNewCharacter(g, host, CharacterRole.ColonyGovernor, colony).character;
        convert(g, st, governor!);
        cultCheckTrigger(g);
        const faction = st.faction!;
        takeOwnershipOfColonyFull(g, host, colony, faction, false, false);
        // A newly held world starts at the full 2M at once (free upkeep); after that it recovers gradually.
        expect(colony.troops!.totalDefendStrength).toBeGreaterThanOrEqual(2000000);
        expect(colony.troops!.totalDefendStrength).toBeLessThan(2000000 + 100 * 100);
        expect(annualTroopMaintenance(faction)).toBe(0);
        cultNavyMonthly(g);
        expect(colony.troops!.totalDefendStrength).toBeLessThan(2000000 + 100 * 100); // already full: nothing added
        colony.troops!.items.length = 0;
        expect(colony.troops!.totalDefendStrength).toBe(0);
        // Empty to full takes cultGarrisonRefillYears (2): 2M / 24 = ~83,333 a month.
        cultNavyMonthly(g);
        const m1 = colony.troops!.totalDefendStrength;
        expect(m1).toBeGreaterThan(83333 - 100);
        expect(m1).toBeLessThan(83333 + 100 * 100);
        cultNavyMonthly(g);
        expect(colony.troops!.totalDefendStrength).toBeGreaterThan(2 * 83333 - 200);
        expect(colony.troops!.totalDefendStrength).toBeLessThan(2 * 83333 + 200 * 100);
        // The 5-day fleet handler no longer refills it.
        const before = colony.troops!.totalDefendStrength;
        cultFleets(g);
        expect(colony.troops!.totalDefendStrength).toBe(before);
        // While enemy troops are on the ground, nothing is recovered (and the held counter ticks).
        colony.invadingTroops = new TroopList();
        const raider = makeFactionTroop(g, host, 100, 'Raider', null);
        raider.colony = colony;
        colony.invadingTroops.add(raider);
        cultNavyMonthly(g);
        expect(colony.troops!.totalDefendStrength).toBe(before);
        expect(st.navy!.garrisonHeld).toBeGreaterThan(0);
        colony.invadingTroops = new TroopList();
        // A faster refill param: it recovers again, and tops out at the target.
        g.scenario!.params.cultGarrisonRefillYears = 0.5;
        for (let i = 0; i < 6; i++) cultNavyMonthly(g);
        expect(colony.troops!.totalDefendStrength).toBeGreaterThanOrEqual(2000000);
        expect(colony.troops!.totalDefendStrength).toBeLessThan(2000000 + 100 * 100);
        g.scenario!.params.cultGarrisonRefillYears = 2;
        g.scenario!.params.cultGarrison = 500000;
        colony.troops!.items.length = 0;
        cultNavyMonthly(g);
        expect(colony.troops!.totalDefendStrength).toBeLessThan(500000);
        g.scenario!.params.cultGarrison = 2000000;
        // Fleets: nothing in range, so they are on the offensive.
        for (const sg of empireShipGroups(faction)) if (sg !== null) sg.posture = FleetPosture.Defend;
        const fleets = empireShipGroups(faction).filter((sg) => sg !== null && sg.ships.length > 0 && sg.leadShip !== null);
        expect(fleets.length).toBeGreaterThan(0);
        for (const e of g.empires) if (e !== faction) for (const b of e.builtObjects) if (b.role === BuiltObjectRole.Military) { b.xpos = colony.xpos + 90000; b.ypos = colony.ypos + 90000; }
        cultFleets(g);
        expect(fleets.every((sg) => sg!.posture === FleetPosture.Attack)).toBe(true);
        // An enemy warship arrives at the colony: every fleet defends it.
        const enemy = host.builtObjects.find((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed)!;
        enemy.xpos = colony.xpos + 500;
        enemy.ypos = colony.ypos;
        cultFleets(g);
        expect(fleets.every((sg) => sg!.posture === FleetPosture.Defend && sg!.gatherPoint === colony && sg!.mission !== null && sg!.mission.targetHabitat === colony)).toBe(true);
        // It leaves: the fleets are released and go back on the offensive.
        enemy.xpos = colony.xpos + 90000;
        enemy.ypos = colony.ypos + 90000;
        cultFleets(g);
        expect(fleets.every((sg) => sg!.posture === FleetPosture.Attack)).toBe(true);
        expect(fleets.every((sg) => sg!.mission === null || sg!.mission.priority !== BuiltObjectMissionPriority.High)).toBe(true);
        // Landed enemy troops also count as an attack.
        colony.invadingTroops = new TroopList();
        const t = makeFactionTroop(g, host, 100, 'Raider', null);
        t.colony = colony;
        colony.invadingTroops.add(t);
        cultFleets(g);
        expect(fleets.every((sg) => sg!.posture === FleetPosture.Defend)).toBe(true);
    }, 1200000);
});

describe('Cult: navy rebuild and mining stations', () => {
    it('the monthly pump buys warships while below its target; the faction founds mining stations itself', () => {
        const { game } = ctGame();
        const g = game.galaxy;
        const st = cultState(g);
        const host = normalEmpires(g).find((e) => e.colonies.some((c) => c !== e.capital && c.population.totalAmount > 0) && e.miningStations.length > 0 && e.builtObjects.some((b) => b.role === BuiltObjectRole.Military))!;
        const colony = host.colonies.find((c) => c !== host.capital && c.population.totalAmount > 0)!;
        const governor = generateNewCharacter(g, host, CharacterRole.ColonyGovernor, colony).character;
        convert(g, st, governor!);
        cultCheckTrigger(g);
        const faction = st.faction!;
        takeOwnershipOfColonyFull(g, host, colony, faction, false, false);
        cultNavyMonthly(g); // the starting navy
        const live = () => faction.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed);
        expect(live().length).toBeGreaterThan(0);
        // At target: the pump buys nothing.
        const bought0 = st.navy!.pumpBought ?? 0;
        g.scenario!.params.cultPumpPct = 0;
        cultNavyMonthly(g);
        expect(st.navy!.pumpBought ?? 0).toBe(bought0);
        g.scenario!.params.cultPumpPct = 500; // far above the galaxy average
        // Wiped out: three a month, paid at the design's price, free upkeep, in a fleet at its port world.
        for (const b of [...live()]) builtObjectCompleteTeardown(g, b);
        expect(live().length).toBe(0);
        faction.stateMoney = 5000000;
        cultNavyMonthly(g);
        expect(live().length).toBe(3);
        expect(st.navy!.pumpBought).toBe(bought0 + 3);
        expect(faction.stateMoney).toBeLessThan(5000000 + 50000);
        expect(live().every((b) => b.supportCostFactor === 0 && b.shipGroup !== null && b.isAutoControlled)).toBe(true);
        expect(live().every((b) => g.calculateDistance(b.xpos, b.ypos, colony.xpos, colony.ypos) < 5000)).toBe(true);
        // The ship cap and an empty treasury stop it.
        g.scenario!.params.cultPumpMaxShips = 4;
        cultNavyMonthly(g);
        expect(live().length).toBe(4);
        g.scenario!.params.cultPumpMaxShips = 120;
        faction.stateMoney = 0;
        faction.privateMoney = 0;
        st.navy!.lastWealth = 0; // (the income floor would otherwise refund the loss)
        g.scenario!.params.cultIncomeFloor = 0;
        cultNavyMonthly(g);
        expect(live().length).toBe(4);
        g.scenario!.params.cultIncomeFloor = 50000;
        // Mining stations: founded at the free resource bodies nearest its colony (its own target list is empty, it sits inside the host), paid, free upkeep, to a cap.
        const stations0 = faction.miningStations.length;
        const found0 = st.navy!.stationsFounded ?? 0;
        faction.stateMoney = 5000000;
        g.scenario!.params.cultStationsPerMonth = 2;
        cultNavyMonthly(g);
        const founded = (st.navy!.stationsFounded ?? 0) - found0;
        expect(founded).toBeGreaterThan(0);
        expect(founded).toBeLessThanOrEqual(2);
        expect(faction.miningStations.length).toBe(stations0 + founded);
        expect(faction.miningStations.slice(stations0).every((b) => b.supportCostFactor === 0)).toBe(true);
        g.scenario!.params.cultStationMax = faction.miningStations.length;
        cultNavyMonthly(g);
        expect((st.navy!.stationsFounded ?? 0) - found0).toBe(founded);
    }, 1200000);
});
