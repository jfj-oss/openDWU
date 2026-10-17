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
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly } from '../src/sim/scenario/hooks';
import {
    CULT_CODE_CONTAINED,
    CULT_HANDLER_IDS,
    convert,
    cultCheckTrigger,
    cultDiscovery,
    cultEndCheck,
    cultGuardiansWar,
    cultSeedCandidates,
    cultHeldColonies,
    cultSecedeThreshold,
    cultKnownSites,
    cultSpread,
    deconvert,
    cultWorldSpread,
    cultReachableColonies,
    cultSourceWorlds,
    cultState,
    peekCultState,
    registerCult,
} from '../src/sim/scenario/threats/cult';
import { colonyGovernor } from '../src/sim/scenario/governors';
import { normalEmpires, teardownIfDead } from '../src/sim/scenario/threats/framework';
import { CharacterRole, CharacterTraitType, IntelligenceMission, generateNewCharacter, getEmpireCharacters } from '../src/sim/characters';
import { GameEndOutcome, setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { empireCompleteTeardown } from '../src/sim/events';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { annualTroopMaintenance } from '../src/sim/troops';
import { calculateForceStrengths, calculatePopulationStrength } from '../src/sim/combat/invasion';
import { militaryPotency, FleetPosture, calculateOverallStrengthFactorWithoutShields } from '../src/sim/diplomacyTick';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { empireTechLevel } from '../src/sim/scenario/threats/robotMutiny';
import { averageTechLevel, givePortAt, makeTroopOfStrength, syncFactionTech } from '../src/sim/scenario/threats/factionNavy';
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

describe('Cult: the fleet of an empire it wipes out', () => {
    it('is handed at most cultCapturedFleetMax warships (the strongest); the rest are scuttled with the empire; bases and other ships are handed over as in the original', () => {
        const { game } = ctGame();
        const g = game.galaxy;
        g.scenario!.params.cultCapturedFleetMax = 3;
        const st = cultState(g);
        const host = normalEmpires(g).find((e) => e.colonies.some((c) => c !== e.capital && c.population.totalAmount > 0) && e.miningStations.length > 0)!;
        const colony = host.colonies.find((c) => c !== host.capital && c.population.totalAmount > 0)!;
        convert(g, st, generateNewCharacter(g, host, CharacterRole.ColonyGovernor, colony).character);
        cultCheckTrigger(g);
        const faction = st.faction!;
        expect(faction).not.toBeNull();
        const isWar = (b: { role: BuiltObjectRole; subRole: number; hasBeenDestroyed: boolean }): boolean => b.role === BuiltObjectRole.Military && b.subRole !== 6 && !b.hasBeenDestroyed;
        const victim = normalEmpires(g, faction).find((e) => e !== host && e.builtObjects.filter(isWar).length > 3)!;
        expect(victim).toBeDefined();
        const warships = victim.builtObjects.filter(isWar);
        const strongest = [...warships].sort((a, b) => calculateOverallStrengthFactorWithoutShields(b) - calculateOverallStrengthFactorWithoutShields(a)).slice(0, 3);
        const before = faction.builtObjects.filter(isWar).length;
        const others = victim.builtObjects.filter((b) => !isWar(b) && !b.hasBeenDestroyed);
        empireCompleteTeardown(g, victim, faction);
        const gained = faction.builtObjects.filter(isWar);
        expect(gained.length).toBe(before + 3);
        for (const b of strongest) expect(b.actualEmpire).toBe(faction);
        for (const b of warships) if (!strongest.includes(b)) expect(b.hasBeenDestroyed || b.actualEmpire !== faction).toBe(true);
        expect(others.some((b) => b.actualEmpire === faction)).toBe(true);
        // A conqueror that is not the Cult is handed all of them, as before.
        const victim2 = normalEmpires(g, faction).find((e) => e !== host && e.active && e.builtObjects.filter(isWar).length > 3)!;
        const ships2 = victim2.builtObjects.filter(isWar);
        const conqueror = normalEmpires(g, faction).find((e) => e !== victim2)!;
        empireCompleteTeardown(g, victim2, conqueror);
        for (const b of ships2) expect(b.actualEmpire).toBe(conqueror);
    }, 900000);
});

describe('Cult: the Ancient Guardians are beyond the creed', () => {
    it('their characters are never converted, their colonies are out of reach of the spread and never rise, and no war is fought with the theocracy', () => {
        const { game } = ctGame();
        const g = game.galaxy;
        const st = cultState(g);
        const mech = g.races.find((r) => r.name.toLowerCase() === 'mechanoid')!;
        expect(mech).toBeDefined();
        const [host, guardians] = normalEmpires(g).filter((e) => e !== g.playerEmpire);
        guardians.dominantRace = mech; // the story empire, as identifyMechanoidEmpire finds it
        const colony = guardians.colonies.find((c) => c !== guardians.capital && c.population.totalAmount > 0) ?? guardians.capital!;
        const governor = generateNewCharacter(g, guardians, CharacterRole.ColonyGovernor, colony).character;
        convert(g, st, governor);
        expect(st.converted.some((r) => r.character === governor)).toBe(false);
        expect(cultSeedCandidates(g, st).some((c) => c.empire === guardians)).toBe(false);
        // A host's cult-held colony makes the theocracy rise; the Guardians are not made its enemy and their colonies are out of reach.
        const hostColony = host.colonies.find((c) => c !== host.capital && c.population.totalAmount > 0)!;
        convert(g, st, generateNewCharacter(g, host, CharacterRole.ColonyGovernor, hostColony).character);
        cultCheckTrigger(g);
        const faction = st.faction!;
        expect(faction).not.toBeNull();
        expect(faction.diplomaticRelations.byEmpire(guardians)?.locked ?? false).toBe(false);
        expect(faction.diplomaticRelations.byEmpire(guardians)?.type).not.toBe(DiplomaticRelationType.War);
        expect(cultGuardiansWar(g, faction, guardians)).toBe(true);
        expect(cultGuardiansWar(g, guardians, faction)).toBe(true);
        expect(cultGuardiansWar(g, faction, host)).toBe(false);
        for (const source of cultSourceWorlds(g, st)) {
            for (const h of cultReachableColonies(g, st, source, 1e12)) expect(h.empire).not.toBe(guardians);
        }
        for (let i = 0; i < 10; i++) cultWorldSpread(g, st);
        expect(st.converted.some((r) => r.character.empire === guardians)).toBe(false);
        // Held colonies of the Guardians do not count (even a governor placed there by hand).
        expect(cultHeldColonies(g, st).some((h) => h.empire === guardians)).toBe(false);
    }, 900000);
});

describe('Cult: contained before it rose', () => {
    it('purging every convert before the theocracy exists ends only the cult\'s own story: the news is posted, no game end', () => {
        const { game } = ctGame();
        const g = game.galaxy;
        const st = cultState(g);
        const [empireA] = normalEmpires(g);
        const governor = generateNewCharacter(g, empireA, CharacterRole.ColonyGovernor, empireA.colonies.find((c) => c !== empireA.capital && c.population.totalAmount > 0) ?? empireA.capital!).character;
        convert(g, st, governor);
        expect(st.hadConverts).toBe(true);
        expect(st.faction).toBeNull();
        deconvert(g, st, governor);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        try {
            cultEndCheck(g, st);
            expect(st.ended).toBe(true);
            expect(st.sentStages['Contained']).toBeDefined();
            expect(ends).toEqual([]);
            expect(g.gameIsFinished).toBe(false);
        } finally {
            setGameEndHandler(g, null);
        }
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
        expect(st.navy!.pendingStrength).toBeCloseTo(hostPotency * 0.5, 3);
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
        // Fleets: the secure-home phase is over here (it has its own test); nothing in range, so they are on the offensive.
        st.navy!.secure = { start: 0, clearSince: -1, ended: 1, reason: 'clear' };
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

describe('Cult: secure home first', () => {
    it('the starting fleet holds its world (no offensive) until it is clear of enemies for a while, or a timeout', () => {
        const { game } = ctGame();
        const g = game.galaxy;
        g.scenario!.params.cultPumpPct = 0;
        g.scenario!.params.cultStationsPerMonth = 0;
        const st = cultState(g);
        const host = normalEmpires(g).find((e) => e.colonies.some((c) => c !== e.capital && c.population.totalAmount > 0) && e.builtObjects.some((b) => b.role === BuiltObjectRole.Military))!;
        const colony = host.colonies.find((c) => c !== host.capital && c.population.totalAmount > 0)!;
        const governor = generateNewCharacter(g, host, CharacterRole.ColonyGovernor, colony).character;
        convert(g, st, governor!);
        cultCheckTrigger(g);
        const faction = st.faction!;
        takeOwnershipOfColonyFull(g, host, colony, faction, false, false);
        cultNavyMonthly(g);
        const fleets = empireShipGroups(faction).filter((sg) => sg !== null && sg.ships.length > 0 && sg.leadShip !== null);
        expect(fleets.length).toBeGreaterThan(0);
        for (const e of g.empires) if (e !== faction) for (const b of e.builtObjects) if (b.role === BuiltObjectRole.Military) { b.xpos = colony.xpos + 90000; b.ypos = colony.ypos + 90000; }
        const step = (days: number) => { g.nowMs += days * GAME_DAY_LENGTH; cultFleets(g); };
        // Nothing around, but the phase holds: defend posture at the world, not Attack.
        cultFleets(g);
        expect(st.navy!.secure!.ended).toBeUndefined();
        expect(fleets.every((sg) => sg!.posture === FleetPosture.Defend && sg!.gatherPoint === colony)).toBe(true);
        step(30);
        expect(st.navy!.secure!.ended).toBeUndefined();
        // An enemy shows up: the 60-day clock restarts.
        const enemy = host.builtObjects.find((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed)!;
        enemy.xpos = colony.xpos + 500;
        enemy.ypos = colony.ypos;
        step(30);
        expect(st.navy!.secure!.clearSince).toBe(-1);
        enemy.xpos = colony.xpos + 90000;
        enemy.ypos = colony.ypos + 90000;
        step(5);
        step(40);
        expect(st.navy!.secure!.ended).toBeUndefined();
        step(30);
        expect(st.navy!.secure!.ended).toBeDefined();
        expect(st.navy!.secure!.reason).toBe('clear');
        // Released: the fleets go on the offensive.
        cultFleets(g);
        expect(fleets.every((sg) => sg!.posture === FleetPosture.Attack)).toBe(true);
    }, 1200000);

    it('ends on the timeout even if enemies stay', () => {
        const { game } = ctGame();
        const g = game.galaxy;
        g.scenario!.params.cultPumpPct = 0;
        g.scenario!.params.cultStationsPerMonth = 0;
        const st = cultState(g);
        const host = normalEmpires(g).find((e) => e.colonies.some((c) => c !== e.capital && c.population.totalAmount > 0) && e.builtObjects.some((b) => b.role === BuiltObjectRole.Military))!;
        const colony = host.colonies.find((c) => c !== host.capital && c.population.totalAmount > 0)!;
        convert(g, st, generateNewCharacter(g, host, CharacterRole.ColonyGovernor, colony).character!);
        cultCheckTrigger(g);
        takeOwnershipOfColonyFull(g, host, colony, st.faction!, false, false);
        cultNavyMonthly(g);
        const enemy = host.builtObjects.find((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed)!;
        enemy.xpos = colony.xpos + 500;
        enemy.ypos = colony.ypos;
        cultFleets(g);
        g.nowMs += 361 * GAME_DAY_LENGTH;
        cultFleets(g);
        expect(st.navy!.secure!.reason).toBe('timeout');
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
        g.scenario!.params.cultPumpThreatPct = 1e9; // (the host's navy sits beside the colony: the threat check has its own test)
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

describe('Cult: the pump spawns at the safest home and banks while every home is threatened', () => {
    it('safest port world chosen; banked while threatened; released together as one fleet', () => {
        const { game } = ctGame();
        const g = game.galaxy;
        const st = cultState(g);
        const host = normalEmpires(g).find((e) => e.colonies.some((c) => c !== e.capital && c.population.totalAmount > 0) && e.miningStations.length > 0 && e.builtObjects.filter((b) => b.role === BuiltObjectRole.Military).length >= 5)!;
        const cols = host.colonies.filter((c) => c !== host.capital && c.population.totalAmount > 0);
        const colony = cols[0];
        const governor = generateNewCharacter(g, host, CharacterRole.ColonyGovernor, colony).character;
        convert(g, st, governor!);
        cultCheckTrigger(g);
        const faction = st.faction!;
        takeOwnershipOfColonyFull(g, host, colony, faction, false, false);
        cultNavyMonthly(g); // the starting navy (and its first port)
        const navy = st.navy!;
        const live = () => faction.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed);
        // A second home far from the first.
        const far = [...host.colonies, ...normalEmpires(g).flatMap((e) => e.colonies)].filter((c) => c.empire !== faction && !c.hasBeenDestroyed && g.calculateDistance(c.xpos, c.ypos, colony.xpos, colony.ypos) > 60000).sort((a, b) => b.population.totalAmount - a.population.totalAmount)[0];
        takeOwnershipOfColonyFull(g, far.empire!, far, faction, false, false);
        givePortAt(g, 'cult', faction, navy, far);
        givePortAt(g, 'cult', faction, navy, colony);
        for (const b of [...live()]) builtObjectCompleteTeardown(g, b);
        g.scenario!.params.cultPumpPct = 500;
        g.scenario!.params.cultPumpMaxShips = 100;
        faction.stateMoney = 50000000;
        // Park the host's whole navy on the first home: the second is the safer one.
        const park = (h: { xpos: number; ypos: number }): void => {
            for (const b of host.builtObjects) if (b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed) { b.xpos = h.xpos + 300; b.ypos = h.ypos; }
        };
        park(colony);
        navy.pumpShipStrength = 1000; // a strong batch estimate: the second home (nothing of the host's there) is clear
        const bought0 = navy.pumpBought ?? 0;
        const before = live().length;
        // Threatened everywhere: nothing is spawned, the purchases are banked (nothing charged yet).
        park(colony);
        // Second home is safe: the three ships appear there.
        cultNavyMonthly(g);
        const spawned = live();
        expect(spawned.length).toBe(before + 3);
        expect(spawned.every((b) => g.calculateDistance(b.xpos, b.ypos, far.xpos, far.ypos) < 5000)).toBe(true);
        expect(navy.pumpBought).toBe(bought0 + 3);
        // Now both homes are threatened: banked.
        for (const b of [...live()]) builtObjectCompleteTeardown(g, b);
        const hostShips = host.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed);
        hostShips.forEach((b, i) => { const h = i % 2 === 0 ? colony : far; b.xpos = h.xpos + 300; b.ypos = h.ypos; });
        const money0 = faction.stateMoney;
        navy.pumpShipStrength = 1; // a tiny estimate: the batch cannot beat the host's navy
        cultNavyMonthly(g);
        expect(live().length).toBe(0);
        expect(navy.pumpBank).toBe(3);
        expect(faction.stateMoney).toBeGreaterThanOrEqual(money0); // nothing charged while banked
        cultNavyMonthly(g);
        cultNavyMonthly(g);
        expect(live().length).toBe(0);
        expect(navy.pumpBank).toBe(9);
        // The bank reaches its size: all released together at the least-threatened home, one fleet.
        const fleets0 = empireShipGroups(faction).filter((sg) => sg !== null).length;
        cultNavyMonthly(g);
        expect(live().length).toBe(12);
        expect(navy.pumpBank).toBe(0);
        expect(new Set(live().map((b) => b.shipGroup)).size).toBe(1);
        expect(empireShipGroups(faction).filter((sg) => sg !== null).length).toBe(fleets0 + 1);
        // Banked, then a home clears: released at once.
        for (const b of [...live()]) builtObjectCompleteTeardown(g, b);
        navy.pumpShipStrength = 1;
        cultNavyMonthly(g);
        expect(navy.pumpBank).toBe(3);
        for (const b of host.builtObjects) if (b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed) { b.xpos = 1e9; b.ypos = 1e9; }
        cultNavyMonthly(g);
        expect(navy.pumpBank).toBe(0);
        expect(live().length).toBe(6);
        // The ship cap bounds the bank.
        for (const b of [...live()]) builtObjectCompleteTeardown(g, b);
        g.scenario!.params.cultPumpMaxShips = 2;
        hostShips.forEach((b) => { b.xpos = colony.xpos + 300; b.ypos = colony.ypos; });
        cultNavyMonthly(g);
        expect(navy.pumpBank ?? 0).toBeLessThanOrEqual(2);
    }, 1200000);
});

describe('Cult: keeps spreading once it has risen', () => {
    /** A game with the host's `n` populated non-capital colonies given governors (returned), pump and station founder off. */
    function hostWithColonies(params: Record<string, number>, n: number) {
        const { game } = ctGame({ cultPumpPct: 0, cultStationsPerMonth: 0, cultWorldSpreadPct: 0, ...params });
        const g = game.galaxy;
        Object.assign(g.scenario!.params, { cultPumpPct: 0, cultStationsPerMonth: 0, cultWorldSpreadPct: 0, ...params }); // hidden settings are not declared in the manifest
        const st = cultState(g);
        const host = normalEmpires(g).filter((e) => e.colonies.filter((c) => c !== e.capital && c.population.totalAmount > 0).length >= n).sort((a, b) => b.colonies.length - a.colonies.length)[0];
        expect(host).toBeDefined();
        const colonies = host.colonies.filter((c) => c !== host.capital && c.population.totalAmount > 0).slice(0, n);
        const governors = colonies.map((c) => generateNewCharacter(g, host, CharacterRole.ColonyGovernor, c).character!);
        return { g, st, host, colonies, governors };
    }

    it('before the theocracy exists a lone cult-held colony waits for the threshold; after it exists, any cult-held colony rises on its own', () => {
        const { g, st, host, colonies, governors } = hostWithColonies({ cultSecedeColonies: 2, cultSecedeMinColonies: 2 }, 3);
        // One held colony of an empire with several governed colonies: below the threshold of 2, nothing rises.
        convert(g, st, governors[0]);
        cultCheckTrigger(g);
        expect(st.faction).toBeNull();
        expect(colonies[0].invadingTroops === null || colonies[0].invadingTroops.count === 0).toBe(true);
        // A second one reaches it: both rise.
        convert(g, st, governors[1]);
        cultCheckTrigger(g);
        const faction = st.faction!;
        expect(faction).not.toBeNull();
        expect(st.risings).toBe(2);
        for (const c of [colonies[0], colonies[1]]) {
            expect(c.invadingTroops!.count).toBeGreaterThan(0);
            expect(c.invadingTroops!.totalAttackStrength).toBe(800000);
        }
        // The third, alone (a threshold of 2 would never be met by it), rises as soon as it is cult-held; the theocracy
        // backs the rising with enough force to win (24 times the defence, at least the base 800,000).
        expect(cultHeldColonies(g, st).filter((c) => c.empire === host)).not.toContain(colonies[2]);
        colonies[2].troops!.add(makeTroopOfStrength(g, host, 300000, 'Garrison', null));
        convert(g, st, governors[2]);
        cultCheckTrigger(g);
        const inv = colonies[2].invadingTroops!;
        expect(inv.count).toBeGreaterThan(0);
        for (const t of inv.items) expect(t.empire).toBe(faction);
        expect(inv.totalAttackStrength).toBeGreaterThan(800000);
        expect(inv.totalAttackStrength).toBeLessThanOrEqual(10000000);
        const { attackingStrength, defendingStrength } = calculateForceStrengths(g, colonies[2], host, faction, colonies[2].troops!, null, inv, null);
        expect(attackingStrength / (defendingStrength + calculatePopulationStrength(g, colonies[2], faction, host).result)).toBeGreaterThan(20);
        expect(st.risings).toBe(3);
        // A rising still unresolved is not doubled on the next check.
        const force = inv.totalAttackStrength;
        cultCheckTrigger(g);
        expect(colonies[2].invadingTroops!.totalAttackStrength).toBe(force);
        expect(st.risings).toBe(3);
        // With cultRisingOverkill 0 it is the base force again.
        g.scenario!.params.cultRisingOverkill = 0;
        colonies[2].invadingTroops = null;
        cultCheckTrigger(g);
        expect(colonies[2].invadingTroops!.totalAttackStrength).toBe(800000);
    }, 1200000);

    it('a cult world spreads the creed to a governor of another colony within range; Logical / Lawful governors resist half the time, Spiritual ones never', () => {
        const { g, st, host, colonies, governors } = hostWithColonies({ cultSecedeColonies: 1, cultWorldSpreadPct: 100, cultWorldSpreadRange: 1e9, cultWorldSpreadNewGovernors: 0 }, 2);
        const source = colonies[0];
        convert(g, st, governors[0]);
        cultCheckTrigger(g);
        const faction = st.faction!;
        takeOwnershipOfColonyFull(g, host, source, faction, false, false);
        expect(cultSourceWorlds(g, st)).toEqual([source]);
        // Reach: colonies with an unconverted governor (none without, new governors off), nearest first; none out of range.
        const reach = cultReachableColonies(g, st, source, 1e9);
        expect(reach).toContain(colonies[1]);
        expect(reach.every((h) => h.empire !== faction && colonyGovernor(h) !== null && !st.converted.some((r) => r.character === colonyGovernor(h)))).toBe(true);
        expect(cultReachableColonies(g, st, source, 0)).toEqual([]);
        // Narrow the range to the nearest one only, so the outcome is that one governor.
        const targetColony = reach[0];
        const target = colonyGovernor(targetColony)!;
        const range = g.calculateDistance(source.xpos, source.ypos, targetColony.xpos, targetColony.ypos);
        g.scenario!.params.cultWorldSpreadRange = range;
        expect(cultReachableColonies(g, st, source, range)).toEqual([targetColony]);
        // Out of range / spread off: nothing.
        g.scenario!.params.cultWorldSpreadRange = Math.max(0, range - 1);
        cultWorldSpread(g, st);
        expect(st.worldConverts ?? 0).toBe(0);
        g.scenario!.params.cultWorldSpreadRange = range;
        g.scenario!.params.cultWorldSpreadPct = 0;
        cultWorldSpread(g, st);
        expect(st.worldConverts ?? 0).toBe(0);
        g.scenario!.params.cultWorldSpreadPct = 100;
        // Spiritual: always converted, the colony is cult-held, and it rises at the next check (the theocracy exists).
        target.traits = [CharacterTraitType.Spiritual];
        cultWorldSpread(g, st);
        expect(st.worldConverts).toBe(1);
        expect(cultHeldColonies(g, st)).toContain(targetColony);
        cultCheckTrigger(g);
        expect(targetColony.invadingTroops!.count).toBeGreaterThan(0);
        // Logical: about half the tries convert it (deconverted between tries).
        target.traits = [CharacterTraitType.Logical];
        let hits = 0;
        for (let i = 0; i < 80; i++) {
            deconvert(g, st, target);
            const before = st.worldConverts!;
            cultWorldSpread(g, st);
            if (st.worldConverts! > before) hits++;
        }
        expect(hits).toBeGreaterThan(20);
        expect(hits).toBeLessThan(60);
    }, 1200000);

    it('a nearby colony with no governor gets a believer as its governor (unless cultWorldSpreadNewGovernors is 0)', () => {
        const { g, st, host, colonies, governors } = hostWithColonies({ cultSecedeColonies: 1, cultWorldSpreadPct: 100, cultWorldSpreadRange: 1e9 }, 2);
        const source = colonies[0];
        convert(g, st, governors[0]);
        cultCheckTrigger(g);
        takeOwnershipOfColonyFull(g, host, source, st.faction!, false, false);
        // The nearest populated colony of anyone, stripped of its governor, is the one candidate in range.
        const bare = cultReachableColonies(g, st, source, 1e9)[0];
        colonyGovernor(bare)?.kill(g);
        expect(colonyGovernor(bare)).toBeNull();
        const range = g.calculateDistance(source.xpos, source.ypos, bare.xpos, bare.ypos);
        g.scenario!.params.cultWorldSpreadRange = range;
        g.scenario!.params.cultWorldSpreadNewGovernors = 0;
        expect(cultReachableColonies(g, st, source, range)).toEqual([]);
        cultWorldSpread(g, st);
        expect(colonyGovernor(bare)).toBeNull();
        g.scenario!.params.cultWorldSpreadNewGovernors = 1;
        expect(cultReachableColonies(g, st, source, range)).toEqual([bare]);
        cultWorldSpread(g, st);
        const preacher = colonyGovernor(bare);
        expect(preacher).not.toBeNull();
        expect(st.converted.some((r) => r.character === preacher)).toBe(true);
        expect(cultHeldColonies(g, st)).toContain(bare);
        // A converted governor is not a target again.
        expect(cultReachableColonies(g, st, source, range)).toEqual([]);
    }, 1200000);

    it('the theocracy\'s own characters are not converts, though their world still spreads the creed', () => {
        const { g, st, host, colonies, governors } = hostWithColonies({ cultSecedeColonies: 1, cultSpreadPct: 100, cultAmbassadorPct: 100 }, 1);
        convert(g, st, governors[0]);
        cultCheckTrigger(g);
        const faction = st.faction!;
        takeOwnershipOfColonyFull(g, host, colonies[0], faction, false, false);
        const member = generateNewCharacter(g, faction, CharacterRole.ShipCaptain, colonies[0]).character;
        expect(member).toBeDefined();
        convert(g, st, governors[0]); // (already converted: no-op) the spreader stays on the list
        cultSpread(g, st);
        expect(st.converted.some((r) => r.character === member)).toBe(false);
    }, 1200000);

    it('the starting fleet scales with cultNavyPct', () => {
        const fleetAt = (pct: number) => {
            const { g, st, host, colonies, governors } = hostWithColonies({ cultSecedeColonies: 1, cultNavyPct: pct }, 1);
            convert(g, st, governors[0]);
            cultCheckTrigger(g);
            const pending = st.navy!.pendingStrength;
            takeOwnershipOfColonyFull(g, host, colonies[0], st.faction!, false, false);
            cultNavyMonthly(g);
            expect(st.navy!.pendingStrength).toBe(0);
            const ships = st.faction!.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed);
            const strength = ships.reduce((sum, b) => sum + calculateOverallStrengthFactorWithoutShields(b), 0);
            return { pending, strength, ships: st.navy!.shipsSpawned };
        };
        const small = fleetAt(30);
        const large = fleetAt(50);
        expect(large.pending / small.pending).toBeCloseTo(5 / 3, 6);
        // The fleet's strength reaches the share asked for (the last ship overshoots a little), so 50 % is a bigger fleet than 30 %.
        expect(small.strength).toBeGreaterThanOrEqual(small.pending);
        expect(large.strength).toBeGreaterThanOrEqual(large.pending);
        expect(large.ships).toBeGreaterThan(small.ships);
        expect(large.strength).toBeGreaterThan(small.strength);
    }, 1200000);
});
