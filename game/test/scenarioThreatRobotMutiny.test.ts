// 19f #9 Robot Mutiny (tasks/19f-hidden-threats.md §9): flag off (byte-identical), seeding, hidden sleeper growth,
// risings only where the robots win, the faction becoming a full empire on its first capture, the transmitter's beacon
// fleets (yearly targets, replenishment, best tech + bonus clamped), neutralising the source, defeat/containment.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { gameYear, registerScenarioPeriodic, registerScenarioYearly } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { createEmpireMidGame } from '../src/sim/scenario/empireMidGame';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { TroopList, TroopType } from '../src/sim/cargo';
import { generateNewTroop } from '../src/sim/builtObjectPlacement';
import { FleetPosture, calculateOverallStrengthFactorWithoutShields, militaryPotency } from '../src/sim/diplomacyTick';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { taskShipGroups } from '../src/sim/fleets/militaryAI';
import { makeRobotTroop, factionPopulationSharePct, normalEmpires } from '../src/sim/scenario/threats/framework';
import {
    ROBOT_MUTINY_CODE_CONTAINED,
    ROBOT_MUTINY_CODE_DEFEAT,
    ROBOT_MUTINY_HANDLER_IDS,
    beaconShipCount,
    beaconFirepowerTarget,
    strongestEmpireFirepower,
    assaultCandidates,
    beaconTechLevel,
    empireTechLevel,
    isRobotTroop,
    maxDesignTechLevel,
    mutinyAccrueSleepers,
    mutinyBeacon,
    mutinyPeriodic,
    mutinyRobotsWin,
    mutinySeed,
    mutinySleepersAt,
    mutinyTrigger,
    peekRobotMutinyState,
    registerRobotMutiny,
    robotMutinyState,
    type RobotMutinyState,
} from '../src/sim/scenario/threats/robotMutiny';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

/** Small beacon (10 % scale) so the forced tests stay fast; the seed-1 comparison test runs the defaults. */
function rmGame(flags: Record<string, boolean> = {}, params: Record<string, number> = {}, older = true): { game: Game; g: Galaxy } {
    const { game } = createScenarioGame(base, {
        scenario: 'robotmutiny',
        flags: { threatRobotMutiny: true, ...flags },
        params: { mutinyYear: 0, mutinyMinRobots: 1, mutinyShipFlipPct: 100, mutinyBeaconScalePct: 10, mutinyInitialTransports: 0, mutinyFoundWorlds: 0, mutinyFullTakeoverPct: 0, robotMutinyExistChancePct: 100, robotMutinyMinYear: 0, ...params },
        options: older ? age3 : undefined,
    });
    return { game, g: game.galaxy };
}

/** Places a robot troop in `colony`'s garrison, owned by `empire` (as the stock RoboticTroopFoundry would). */
function placeGarrisonRobot(g: Galaxy, colony: Habitat, empire: Empire): void {
    const t = makeRobotTroop(g, empire, 60, 'BattleBot Group');
    if (colony.troops === null) colony.troops = new TroopList();
    t.colony = colony;
    colony.troops.add(t);
    empire.troops.add(t);
}

/** A strong non-robot garrison troop (a defender the robots cannot beat). */
function placeGuard(colony: Habitat, empire: Empire, strength: number): void {
    const t = generateNewTroop('Guard', TroopType.Infantry, strength, empire, empire.dominantRace, false);
    t.readiness = 100;
    t.colony = colony;
    if (colony.troops === null) colony.troops = new TroopList();
    colony.troops.add(t);
    empire.troops.add(t);
}

/** Seeds the source (a ruin world; any empty planet when the seed has no ruins). */
function seeded(g: Galaxy): RobotMutinyState {
    const st = robotMutinyState(g);
    mutinySeed(g, st);
    if (st.source === null) st.source = g.habitats.find((h) => h !== null && h.empire === null && h.population.totalAmount === 0 && !h.hasBeenDestroyed)!;
    return st;
}

/** Two populated colonies of AI empires (any empire order), excluding capitals where possible. */
function twoColonies(g: Galaxy): [Habitat, Habitat] {
    const out: Habitat[] = [];
    for (const e of normalEmpires(g)) {
        if (e === g.playerEmpire) continue;
        for (const c of e.colonies) if (c !== e.capital && c.population.totalAmount > 0 && out.length < 2) out.push(c);
    }
    for (const e of normalEmpires(g)) for (const c of e.colonies) if (!out.includes(c) && c.population.totalAmount > 0 && out.length < 2) out.push(c);
    return [out[0], out[1]];
}

function unregisterRobotMutiny(): void {
    for (const id of ROBOT_MUTINY_HANDLER_IDS) {
        registerScenarioYearly({ id, run: () => undefined })();
        registerScenarioPeriodic({ id, periodDays: 1, run: () => undefined })();
    }
}

describe('Robot Mutiny: flag off', () => {
    it('flag off: no state, and the same draws and digest as the game without the package', () => {
        const a = rmGame({ threatRobotMutiny: false }, {}, false).game;
        runGameSeconds(a, 125);
        expect(peekRobotMutinyState(a.galaxy)).toBeNull();
        unregisterRobotMutiny();
        try {
            const b = rmGame({ threatRobotMutiny: false }, {}, false).game;
            runGameSeconds(b, 125);
            expect(b.galaxy.rnd.drawCount).toBe(a.galaxy.rnd.drawCount);
            expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        } finally {
            registerRobotMutiny();
        }
    }, 1200000);
});

describe('Robot Mutiny: seeding, sleepers, risings, empire, beacon', () => {
    it('seeding: a ruin world is picked as the source (skips gracefully with no ruins on this seed)', () => {
        const { game, g } = rmGame();
        g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
        runGameSeconds(game, 65);
        const st = peekRobotMutinyState(g)!;
        expect(st.seeded).toBe(true);
        if (g.ruinsHabitats.length > 0) expect(st.source).not.toBeNull();
    }, 300000);

    it('sleepers: only colonies with >= 2 robots accrue 15 a year, hidden from the garrison and the empire', () => {
        const { g } = rmGame();
        const st = seeded(g);
        const [a, b] = twoColonies(g);
        const ea = a.empire!;
        placeGarrisonRobot(g, a, ea);
        placeGarrisonRobot(g, a, ea);
        placeGarrisonRobot(g, b, b.empire!); // one robot only
        const garrisonA = a.troops!.count;
        const troopsA = ea.troops.count;
        mutinyAccrueSleepers(g, st);
        expect(mutinySleepersAt(st, a)).toBe(15);
        expect(mutinySleepersAt(st, b)).toBe(0);
        mutinyAccrueSleepers(g, st);
        expect(mutinySleepersAt(st, a)).toBe(30);
        // Hidden: no Troop object anywhere.
        expect(a.troops!.count).toBe(garrisonA);
        expect(ea.troops.count).toBe(troopsA);
        // Source neutralised: growth stops.
        st.sourceTaken = true;
        mutinyAccrueSleepers(g, st);
        expect(mutinySleepersAt(st, a)).toBe(30);
    }, 300000);

    it('rising: every colony with robots rises at once (sleepers materialise)', () => {
        const { g } = rmGame();
        const st = seeded(g);
        const [a, b] = twoColonies(g);
        placeGarrisonRobot(g, a, a.empire!);
        placeGarrisonRobot(g, a, a.empire!);
        placeGarrisonRobot(g, b, b.empire!);
        placeGarrisonRobot(g, b, b.empire!);
        placeGuard(b, b.empire!, 30000);
        st.sleepers = [
            { colony: a, count: 40 },
            { colony: b, count: 3 },
        ];
        expect(mutinyTrigger(g, st)).toBe(true);
        const faction = st.faction!;
        expect(faction.dominantRace!.name).toBe('Harvester');
        // A rose: 2 garrison robots + 40 sleepers invade from inside as stock BattleBot troops of the faction.
        expect(a.invadingTroops!.count).toBe(42);
        expect(a.invadingTroops!.items.every((t) => isRobotTroop(g, t) && t.empire === faction)).toBe(true);
        expect(a.troops!.items.some((t) => isRobotTroop(g, t))).toBe(false);
        expect(mutinySleepersAt(st, a)).toBe(0);
        // Every BattleBot defects at the rising, win or lose (the stock ground war decides): B's 2 robots + 3 sleepers too.
        expect(b.invadingTroops!.count).toBe(5);
        expect(mutinySleepersAt(st, b)).toBe(0);
    }, 600000);

    it('empire: the first captured colony makes the faction a full empire under the stock AI', () => {
        const { game, g } = rmGame();
        const st = seeded(g);
        const [a] = twoColonies(g);
        const host = a.empire!;
        placeGarrisonRobot(g, a, host);
        expect(mutinyTrigger(g, st)).toBe(true);
        const faction = st.faction!;
        expect(obtainDiplomaticRelation(faction, host).locked).toBe(true);
        // The stock conquest's hand-over (takeOwnershipOfColony), as when the rising wins the ground war.
        takeOwnershipOfColonyFull(g, host, a, faction, false, false);
        mutinyPeriodic(g);
        expect(st.becameEmpire).toBe(true);
        expect(faction.name).toBe('Broadcast Machine Dominion');
        expect(faction.capital).not.toBeNull();
        expect(faction.dominantRace!.expanding).toBe(true);
        expect(faction.pirateEmpireBaseHabitat).toBeNull();
        expect(obtainDiplomaticRelation(faction, host).type).toBe(DiplomaticRelationType.War);
        expect(obtainDiplomaticRelation(faction, host).locked).toBe(true); // at war with everyone, for good
        expect(faction.controlMilitaryFleets && faction.controlDesigns && faction.controlTroopGeneration && faction.initiateConstruction).toBe(true);
        expect(normalEmpires(g)).toContain(faction);
        // The stock AI runs it: its long/huge touches advance with the game.
        const before = faction.lastLongTouch;
        runGameSeconds(game, 30);
        expect(faction.active).toBe(true);
        expect(faction.lastLongTouch).toBeGreaterThan(before);
    }, 600000);

    it('a faction with fleets but no colony has the transmitter world as its capital (stock TaskShipGroups reads Capital)', () => {
        // Soak 2026-10-04: before the fix the faction had capital null from the trigger until its first capture, and
        // Empire.9.cs TaskShipGroups (IdentifyThreatenedSystemsPrioritized(Capital.Xpos, …)) threw on every tick.
        const { game, g } = rmGame();
        const st = seeded(g);
        expect(mutinyTrigger(g, st)).toBe(true);
        const faction = st.faction!;
        expect(faction.colonies.length).toBe(0);
        expect(empireShipGroups(faction).filter((sg) => sg !== null).length).toBeGreaterThan(0);
        expect(faction.capital).toBe(st.source);
        expect(() => taskShipGroups(g, faction)).not.toThrow();
        expect(() => runGameSeconds(game, 60)).not.toThrow();
        // Lost again (a stock path nulls it): the periodic pass restores the stand-in.
        faction.capital = null;
        mutinyPeriodic(g);
        expect(faction.capital).toBe(st.source);
        // The first captured colony replaces the stand-in.
        const [a] = twoColonies(g);
        takeOwnershipOfColonyFull(g, a.empire!, a, faction, false, false);
        mutinyPeriodic(g);
        expect(st.becameEmpire).toBe(true);
        expect(faction.capital).toBe(a);
    }, 600000);

    it('beacon: firepower scaled to the strongest normal empire (x scale), replenishment, Attack fleets, tech = best + 1 clamped', () => {
        const { g } = rmGame({}, { mutinyBeaconScalePct: 100, mutinyBeaconMinFirepower: 0 });
        const st = seeded(g);
        const [a] = twoColonies(g);
        placeGarrisonRobot(g, a, a.empire!);
        const strongest = strongestEmpireFirepower(g, null);
        expect(strongest).toBeGreaterThan(0);
        expect(mutinyTrigger(g, st)).toBe(true);
        const faction = st.faction!;
        const y0 = st.risingYear!;
        const best = Math.max(...normalEmpires(g, faction).map(empireTechLevel));
        expect(st.beaconTech).toBe(Math.min(best + 1, maxDesignTechLevel(g)));
        const warFp = () => st.beaconShips!.filter((b) => !b.hasBeenDestroyed).reduce((s, b) => s + calculateOverallStrengthFactorWithoutShields(b), 0);
        const maxShip = Math.max(...st.beaconShips!.map((b) => calculateOverallStrengthFactorWithoutShields(b)));
        // Year 1: about 1.3x the strongest empire (never short, over by less than one ship).
        const t1 = beaconFirepowerTarget(g, faction, 1);
        expect(t1).toBeCloseTo(strongest * 1.3, 3);
        expect(militaryPotency(faction)).toBeGreaterThanOrEqual(t1);
        expect(militaryPotency(faction)).toBeLessThan(t1 + maxShip + 1);
        expect(st.beaconShips!.every((b) => b.role === BuiltObjectRole.Military && b.actualEmpire === faction)).toBe(true);
        expect((st.beaconTransports ?? []).length).toBeGreaterThan(0);
        const groups = empireShipGroups(faction).filter((sg) => sg !== null && sg.ships.some((b) => st.beaconShips!.includes(b)));
        expect(groups.length).toBeGreaterThan(0);
        expect(groups.every((sg) => sg!.posture === FleetPosture.Attack)).toBe(true);
        // Same year: nothing more.
        expect(mutinyBeacon(g, st, y0).length).toBe(0);
        // Growth +0.1x a year, capped at 1.8x.
        expect(beaconFirepowerTarget(g, faction, 2)).toBeCloseTo(strongest * 1.4, 3);
        expect(beaconFirepowerTarget(g, faction, 20)).toBeCloseTo(strongest * 1.8, 3);
        mutinyBeacon(g, st, y0 + 1);
        const t2 = beaconFirepowerTarget(g, faction, 2);
        expect(militaryPotency(faction)).toBeGreaterThanOrEqual(t2);
        expect(militaryPotency(faction)).toBeLessThan(t2 + maxShip + 1);
        // Losses are replenished, no unlimited stacking.
        for (const b of st.beaconShips!.slice(0, 5)) b.hasBeenDestroyed = true;
        const before = militaryPotency(faction);
        mutinyBeacon(g, st, y0 + 2);
        expect(militaryPotency(faction)).toBeGreaterThanOrEqual(beaconFirepowerTarget(g, faction, 3));
        expect(militaryPotency(faction)).toBeLessThan(Math.max(before, beaconFirepowerTarget(g, faction, 3)) + 2 * maxShip + 1);
        void warFp;
        // Clamp: a huge bonus caps at the generator's maximum tech level.
        g.scenario!.params.mutinyTechBonus = 100;
        expect(beaconTechLevel(g, faction)).toBe(maxDesignTechLevel(g));
        // Neutralised source: no more spawning.
        for (const b of st.beaconShips!.slice(0, 5)) b.hasBeenDestroyed = true;
        st.sourceTaken = true;
        expect(mutinyBeacon(g, st, y0 + 4).length).toBe(0);
    }, 600000);

    it('rising: 30 transports, 3 founded worlds, tech 5, purple colour; full takeover absorbs the Guardians and turtles', () => {
        const mkMech = (g: Galaxy) => {
            const donor = normalEmpires(g).find((e) => e !== g.playerEmpire && e.colonies.length > 1)!;
            const ships = donor.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.topSpeed > 0).slice(0, 16);
            return createEmpireMidGame(g, { race: 'Mechanoid', name: 'Ancient Guardians', adoptOnly: true, adopt: { colonies: [donor.colonies[donor.colonies.length - 1]], builtObjects: ships } })!;
        };
        const mobile = (e: Empire) => e.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0).length;
        // Aggressive variant: an eighth of the Guardians' fleet, transports, worlds.
        const a = rmGame({}, { mutinyInitialTransports: 30, mutinyFoundWorlds: 3 });
        const sa = seeded(a.g);
        const mechA = mkMech(a.g);
        const before = mobile(mechA);
        expect(mutinyTrigger(a.g, sa)).toBe(true);
        const fa = sa.faction!;
        expect(sa.turtle).toBe(false);
        expect(mobile(mechA)).toBe(before - Math.round(before / 8));
        expect(fa.colonies.length).toBeGreaterThanOrEqual(3);
        expect(sa.beaconTransports!.length).toBeGreaterThanOrEqual(30);
        expect(fa.mainColor).toBe(0x4b3586);
        expect(fa.secondaryColor).toBe(0x0080ff);
        expect(obtainDiplomaticRelation(fa, mechA).locked).toBe(true);
        // Full takeover: the whole Guardians absorbed, no transports, the turtle posture.
        const t = rmGame({}, { mutinyFullTakeoverPct: 100 });
        const stt = seeded(t.g);
        const mechT = mkMech(t.g);
        expect(mutinyTrigger(t.g, stt)).toBe(true);
        expect(stt.turtle).toBe(true);
        expect(mechT.active).toBe(false);
        expect(stt.faction!.colonies.length).toBeGreaterThan(0);
        expect(stt.beaconTransports!.length).toBe(0);
    }, 600000);

    it('assault: the weakest-garrisoned colony near the transmitter is the target', () => {
        const { g } = rmGame();
        const st = seeded(g);
        expect(mutinyTrigger(g, st)).toBe(true);
        const c = assaultCandidates(g, st);
        expect(c.length).toBeGreaterThan(0);
        const def = (h: Habitat) => (h.troops !== null ? h.troops.totalDefendStrength : 0);
        for (let i = 1; i < c.length; i++) expect(def(c[i - 1])).toBeLessThanOrEqual(def(c[i]));
    }, 600000);

    it('end: the faction holding enough population share ends the game in defeat (1919)', () => {
        const { g } = rmGame();
        const st = seeded(g);
        const host = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.some((c) => c.population.totalAmount > 0))!;
        const colony = host.colonies.find((c) => c.population.totalAmount > 0)!;
        placeGarrisonRobot(g, colony, host);
        expect(mutinyTrigger(g, st)).toBe(true);
        const faction = st.faction!;
        takeOwnershipOfColonyFull(g, host, colony, faction, false, false);
        expect(factionPopulationSharePct(g, faction)).toBeGreaterThan(0);
        g.scenario!.params.mutinyDefeatPopulationPct = 0.0001;
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        mutinyPeriodic(g);
        expect(ends.map((e) => e.code)).toEqual([ROBOT_MUTINY_CODE_DEFEAT]);
        setGameEndHandler(g, null);
    }, 600000);

    it('end: with the source silenced, a torn-down faction is contained (2019)', () => {
        const { g } = rmGame({}, { mutinyBeaconScalePct: 0 });
        const st = seeded(g);
        const host = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null)!;
        placeGarrisonRobot(g, host.colonies[0], host);
        placeGuard(host.colonies[0], host, 30000); // the robots stay dormant
        expect(mutinyTrigger(g, st)).toBe(true);
        const faction = st.faction!;
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        mutinyPeriodic(g); // source live: not torn down
        expect(faction.active).toBe(true);
        st.sourceTaken = true;
        mutinyPeriodic(g);
        expect(faction.active).toBe(false);
        expect(ends.map((e) => e.code)).toEqual([ROBOT_MUTINY_CODE_CONTAINED]);
        setGameEndHandler(g, null);
    }, 600000);
});
