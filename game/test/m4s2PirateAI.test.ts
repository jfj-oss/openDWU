// M4s2 — pirate faction AI (tasks/M4-plan.md §3.3 M4s, s2 part): PirateColonyControl, ReviewPirateControl, raid countdowns,
// corruption, raids, protection pricing, galaxy pirate steps, plus a harness smoke test. Expected values are worked by hand
// from the C# (PirateColonyControlList.cs, BaconHabitat.cs 1388, Habitat.cs 1608, BaconEmpire.cs 1253, Empire.1.cs 4065,
// Empire.2.cs 2653, Galaxy.8.cs 3053).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame, cachedTickGameRun } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';
import { runGameSeconds } from '../src/sim/tick/harness';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { PirateColonyControl, PirateColonyControlList } from '../src/sim/pirates/pirateColonyControl';
import {
    checkSendPirateRaid,
    getNearbyBuiltObjects,
    pirateRecalculateEmpireCorruption,
    reviewPirateControl,
    updateRaidCountdownBuiltObject,
    updateRaidCountdownHabitat,
} from '../src/sim/pirates/pirateAI';
import { calculatePirateProtectionPricePerMonth } from '../src/sim/pirates/pirateRelationsAI';
import { checkPirateEmpireTerminated } from '../src/sim/pirates/pirateGalaxyTick';
import { countSpaceports, getShipsAtHabitatNotLeaving } from '../src/sim/pirates/pirateShipMissions';
import { pirateDetermineOwnedColonies } from '../src/sim/pirates/pirateConstruction';

const f = Math.fround;

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function freshGalaxy(): Galaxy {
    return cachedTickGame(gameData).galaxy;
}

/** A populated independent colony with no pirate ship (non-base) within 1500 (ReviewPirateControl's scan). */
function quietIndependentColony(galaxy: Galaxy): Habitat {
    for (const h of galaxy.independentColonies) {
        if (h.population == null || h.population.totalAmount <= 0) continue;
        const near = getNearbyBuiltObjects(galaxy, h.xpos, h.ypos, 1500.0).filter((b) => b.role !== BuiltObjectRole.Base && b.empire !== null && b.empire.pirateEmpireBaseHabitat !== null);
        if (near.length === 0) return h;
    }
    throw new Error('no quiet independent colony');
}

describe('PirateColonyControlList (PirateColonyControlList.cs)', () => {
    it('keeps float control levels, sorts descending with Sort()+Reverse(), and finds by faction / facility control', () => {
        const list = new PirateColonyControlList();
        list.add(new PirateColonyControl(3, 0.3));
        list.add(new PirateColonyControl(7, 0.7, true));
        list.add(new PirateColonyControl(5, 0.5));
        expect(list.at(0).controlLevel).toBe(f(0.3));
        list.sort();
        list.reverse();
        expect(list.items.map((c) => c.empireId)).toEqual([7, 5, 3]);
        expect(list.getHighestControl()!.empireId).toBe(7);
        expect(list.getByFacilityControl()!.empireId).toBe(7);
        expect(list.getByFaction(5)!.controlLevel).toBe(f(0.5));
        expect(list.checkFactionHasControl(3)).toBe(true);
        expect(list.checkFactionHasControl(4)).toBe(false);
        expect(list.indexOfEmpireId(3)).toBe(2);
        // empireId > 255: the C# ctor returns before assigning anything.
        const c = new PirateColonyControl(300, 0.9, true);
        expect(c.empireId).toBe(0);
        expect(c.controlLevel).toBe(0);
        expect(c.hasFacilityControl).toBe(false);
    });
});

describe('ReviewPirateControl (BaconHabitat.cs 1388)', () => {
    it('decays control with no pirate ships nearby: -0.5 * (timePassed / year) per call, removal at 0 with a ColonyLost message', () => {
        const galaxy = freshGalaxy();
        const h = quietIndependentColony(galaxy);
        const pirate = galaxy.pirateEmpires[0];
        h.pirateColonyControl = new PirateColonyControlList();
        h.pirateColonyControl.add(new PirateColonyControl(pirate.empireId, 0.2));
        const draws = galaxy.rnd.drawCount;
        // timePassed 60 s: num5 = (float)(-0.5 * 60 / 600) = -0.05f; ControlLevel = Max(0f, 0.2f + -0.05f).
        reviewPirateControl(galaxy, h, 60);
        expect(h.pirateColonyControl.count).toBe(1);
        expect(h.pirateColonyControl.at(0).controlLevel).toBe(f(f(0.2) + f(-0.05)));
        // 0.15 - 0.2 → Max(0, -0.05) = 0 → removed; the faction is told it lost the colony.
        const before = empireMessages(pirate).length;
        reviewPirateControl(galaxy, h, 240);
        expect(h.pirateColonyControl.count).toBe(0);
        const msgs = empireMessages(pirate);
        expect(msgs.length).toBe(before + 1);
        expect(msgs[msgs.length - 1].messageType).toBe(EmpireMessageType.ColonyLost);
        expect(galaxy.rnd.drawCount).toBe(draws);
    }, 120000);

    it('facility control without a pirate facility loses its floor and HasFacilityControl', () => {
        const galaxy = freshGalaxy();
        const h = quietIndependentColony(galaxy);
        const pirate = galaxy.pirateEmpires[0];
        h.pirateColonyControl = new PirateColonyControlList();
        const control = new PirateColonyControl(pirate.empireId, 0.52, true);
        h.facilities = [];
        h.pirateColonyControl.add(control);
        // No pirate facility on the colony: the facility floor is 0 and HasFacilityControl is cleared.
        reviewPirateControl(galaxy, h, 60);
        expect(control.hasFacilityControl).toBe(false);
        expect(control.controlLevel).toBe(f(f(0.52) + f(-0.05)));
    }, 120000);
});

describe('raid countdowns (Habitat.cs 1608 / BuiltObject.1.cs 2894)', () => {
    it('count down by (int)(timePassed / 10), clamped to [0, 255]', () => {
        const galaxy = freshGalaxy();
        const h = galaxy.independentColonies[0];
        h.raidCountdown = 60;
        updateRaidCountdownHabitat(galaxy, h, 25);
        expect(h.raidCountdown).toBe(58);
        updateRaidCountdownHabitat(galaxy, h, 9.99);
        expect(h.raidCountdown).toBe(58);
        updateRaidCountdownHabitat(galaxy, h, 1000);
        expect(h.raidCountdown).toBe(0);
        const bo = galaxy.pirateEmpires[0].builtObjects[0];
        bo.raidCountdown = 3;
        updateRaidCountdownBuiltObject(galaxy, bo, 20);
        expect(bo.raidCountdown).toBe(1);
    }, 120000);
});

describe('pirate empire steps', () => {
    it('PirateRecalculateEmpireCorruption draws one NextDouble; no income → corruption 0', () => {
        const galaxy = freshGalaxy();
        const pirate = galaxy.pirateEmpires[0];
        const draws = galaxy.rnd.drawCount;
        pirateRecalculateEmpireCorruption(galaxy, pirate);
        expect(galaxy.rnd.drawCount).toBe(draws + 1);
        // CalculatePirateIncome: no colonies, no protection, empty PirateEconomy → 0 → num3 = 1 → (1 - 1) * factor = 0.
        expect(pirate.corruption).toBe(0);
    }, 120000);

    it('CheckSendPirateRaid only fires once, when the pre-warp flags are clear', () => {
        const galaxy = freshGalaxy();
        const empire = galaxy.empires.find((e) => e.capital !== null)!;
        // Tech level 0.5 start: the game-start aggregate flag is set, and Start.2.cs 1127 sets SendPirateRaid for every
        // empire (M4z3), so no raid.
        expect(empire.preWarpProgressEventsOccurred).toBe(true);
        expect(empire.preWarpProgressEventOccurredSendPirateRaid).toBe(true);
        empire.preWarpProgressEventOccurredSendPirateRaid = false;
        checkSendPirateRaid(galaxy, empire);
        expect(empire.preWarpProgressEventOccurredSendPirateRaid).toBe(false);
        empire.preWarpProgressEventsOccurred = false;
        checkSendPirateRaid(galaxy, empire);
        expect(empire.preWarpProgressEventOccurredSendPirateRaid).toBe(true);
    }, 120000);

    it('CalculatePirateProtectionPricePerMonth is 0 between pirate factions; CheckPirateEmpireTerminated is false with a base', () => {
        const galaxy = freshGalaxy();
        const [a, b] = galaxy.pirateEmpires;
        expect(calculatePirateProtectionPricePerMonth(galaxy, a, b)).toEqual({ price: 0, pirateAttackForcesFactor: 0 });
        // A normal empire is not a pirate faction: the whole price block is skipped.
        expect(calculatePirateProtectionPricePerMonth(galaxy, galaxy.empires[0], b).price).toBe(0);
        expect(checkPirateEmpireTerminated(galaxy, a)).toBe(false);
        expect(countSpaceports(a.builtObjects)).toBeGreaterThan(0);
        expect(pirateDetermineOwnedColonies(a)).toEqual([]);
    }, 120000);

    it('GetShipsAtHabitatNotLeaving keeps idle ships in range and drops bases', () => {
        const galaxy = freshGalaxy();
        const pirate = galaxy.pirateEmpires[0];
        const base = pirate.pirateEmpireBaseHabitat!;
        const ships = getShipsAtHabitatNotLeaving(pirate.builtObjects, base, 1.0e9);
        for (const s of ships) expect(s.role).not.toBe(BuiltObjectRole.Base);
        // Every idle non-base ship is within the huge range; ships with a mission count when their target is in range too.
        expect(ships.length).toBe(pirate.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role !== BuiltObjectRole.Base).length);
    }, 120000);
});

describe('harness smoke (pirate faction AI running)', () => {
    it('600 game-s: pirate ships get missions, pirates build ships, no stub throws', () => {
        const shipsBefore = freshGalaxy().pirateEmpires.reduce((n, p) => n + p.builtObjects.length + p.privateBuiltObjects.length, 0);
        const { game, run: r } = cachedTickGameRun(gameData, { seconds: 600 }); // createTickGame + runGameSeconds(g, 600), built once and cached (test/helpers/gameCache.ts)
        const galaxy = game.galaxy;
        const shipsAfter = galaxy.pirateEmpires.reduce((n, p) => n + p.builtObjects.length + p.privateBuiltObjects.length, 0);
        expect(shipsAfter).toBeGreaterThan(shipsBefore);
        let withMission = 0;
        for (const p of galaxy.pirateEmpires) {
            for (const b of p.builtObjects) {
                const m = builtObjectMission(b.mission);
                if (m !== null && m.type !== BuiltObjectMissionType.Undefined) withMission++;
            }
        }
        expect(withMission).toBeGreaterThan(0);
        for (const key of ['M4s pirateAssignShipMissions', 'M4s pirateTaskFleets', 'M4s reviewPirateControl', 'M4s pirateDoConstruction']) {
            expect(r.todoHits[key] ?? 0, key).toBe(0);
        }
    }, 300000);
});
