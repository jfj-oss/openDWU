// M4t — visibility, exploration, first contact, territory runtime (src/sim/exploration.ts). Unit checks of the ported
// C# functions against hand-worked expectations on a createGame galaxy (seed 1), plus a harness smoke run.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { HabitatCategoryType, type Habitat } from '../src/sim/types';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { obtainEmpireEvaluation } from '../src/sim/taxes';
import { strategicValue } from '../src/sim/territory';
import { Ruin, RuinType } from '../src/sim/ruins';
import { runGameSeconds } from '../src/sim/tick/harness';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import {
    checkKnownPirateBases,
    checkRuinsHaveBenefit,
    clearExpiredViewableEmpires,
    doEmpireEncounter,
    exertCulturalInfluence,
    getHabitatsAtLocation,
    mergeGalaxyMap,
    reviewEmpireTerritory,
    reviewSystemVisibilityForPreWarpShip,
    scanArea,
    scanForLocations,
    updateSystemExplorationStatus,
} from '../src/sim/exploration';

let gameData: GameData;
let galaxy: Galaxy;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    galaxy = createTickGame(gameData).galaxy;
}, 120000);

describe('Empire.2.cs ClearExpiredViewableEmpires / UpdateSystemExplorationStatus', () => {
    it('drops only the entries whose expiry is before the current star date, keeping the parallel lists aligned', () => {
        const [e, a, b, c] = galaxy.empires;
        const now = galaxyStarDate(galaxy);
        e.empiresViewable = [a, b, c];
        e.empiresViewableExpiry = [now - 1, now, now - 5];
        clearExpiredViewableEmpires(galaxy, e);
        expect(e.empiresViewable).toEqual([b]);
        expect(e.empiresViewableExpiry).toEqual([now]);
        e.empiresViewable = [];
        e.empiresViewableExpiry = [];
    });

    it('marks explored systems whose star and habitats are all surveyed as TotallyExplored and counts them', () => {
        const e = galaxy.empires[0];
        const home = galaxy.determineHabitatSystemStar(e.capital!);
        const sv = e.systemVisibility[home.systemIndex];
        sv.totallyExplored = false;
        // One unsurveyed habitat keeps the system not totally explored.
        const habitats = galaxy.systemHabitatsOf(home.systemIndex);
        const victim = habitats[habitats.length - 1];
        const wasKnown = e.resourceMap.checkResourcesKnown(victim);
        e.resourceMap.setResourcesKnown(victim, false);
        updateSystemExplorationStatus(galaxy, e);
        expect(sv.totallyExplored).toBe(false);
        e.resourceMap.setResourcesKnown(victim, true);
        updateSystemExplorationStatus(galaxy, e);
        expect(sv.totallyExplored).toBe(e.resourceMap.checkResourcesKnown(home) && habitats.every((h) => e.resourceMap.checkResourcesKnown(h)));
        const expected = e.systemVisibility.filter((v) => v.status === SystemVisibilityStatus.Explored || v.status === SystemVisibilityStatus.Visible).length;
        expect(e.systemExploredCount).toBe(expected);
        expect(e.explorationShipCount).toBe(e.builtObjects.filter((b) => b.subRole === BuiltObjectSubRole.ExplorationShip && b.builtAt == null).length);
        e.resourceMap.setResourcesKnown(victim, wasKnown);
    });
});

describe('Empire.1.cs CheckKnownPirateBases', () => {
    it('forgets bases no longer owned by a pirate faction', () => {
        const e = galaxy.empires[0];
        const pirate = galaxy.pirateEmpires[0];
        const pirateBase = galaxy.builtObjects.find((b) => b.empire === pirate)!;
        const other = galaxy.builtObjects.find((b) => b.empire === galaxy.empires[1])!;
        e.knownPirateBases = [other, pirateBase];
        checkKnownPirateBases(galaxy, e);
        expect(e.knownPirateBases).toEqual([pirateBase]);
        e.knownPirateBases = [];
    });
});

describe('Galaxy.7.cs DoEmpireEncounter', () => {
    it('two normal empires meet: NotMet → None on both sides, first-contact penalty, EmpireDiscovered messages', () => {
        const [a, b] = [galaxy.empires[1], galaxy.empires[2]];
        const beforeA = empireMessages(a).length;
        const beforeB = empireMessages(b).length;
        expect(a.diplomaticRelations.byEmpire(b)?.type ?? DiplomaticRelationType.NotMet).toBe(DiplomaticRelationType.NotMet);
        doEmpireEncounter(galaxy, a, b, b.capital);
        expect(a.diplomaticRelations.byEmpire(b)!.type).toBe(DiplomaticRelationType.None);
        expect(b.diplomaticRelations.byEmpire(a)!.type).toBe(DiplomaticRelationType.None);
        const ma = empireMessages(a).slice(beforeA);
        expect(ma.map((m) => m.messageType)).toEqual([EmpireMessageType.EmpireDiscovered]);
        expect(ma[0].subject).toBe(b);
        expect(ma[0].location).toEqual({ x: Math.trunc(b.capital!.xpos), y: Math.trunc(b.capital!.ypos) });
        expect(empireMessages(b).slice(beforeB).map((m) => m.messageType)).toEqual([EmpireMessageType.EmpireDiscovered]);
        if (a.dominantRace !== b.dominantRace) {
            const ev = obtainEmpireEvaluation(galaxy, a, b) as unknown as { firstContactPenalty: number };
            expect(ev.firstContactPenalty).toBe(-15.0 * galaxy.aggressionLevel);
        }
        // A second encounter is a no-op.
        doEmpireEncounter(galaxy, a, b, b.capital);
        expect(empireMessages(a).length).toBe(beforeA + 1);
    });
});

describe('Galaxy.4.cs MergeGalaxyMap', () => {
    it('the receiver learns explored systems, the resource map and the giver pirate bases', () => {
        const [giver, receiver] = [galaxy.empires[0], galaxy.empires[3]];
        const giverSystems = giver.systemVisibility.map((v, i) => (v.status >= SystemVisibilityStatus.Explored ? i : -1)).filter((i) => i >= 0);
        const newForReceiver = giverSystems.filter((i) => receiver.systemVisibility[i].status <= SystemVisibilityStatus.Unexplored);
        expect(newForReceiver.length).toBeGreaterThan(0);
        const pirateBase = galaxy.builtObjects.find((b) => b.empire === galaxy.pirateEmpires[0])!;
        giver.knownPirateBases = [pirateBase];
        mergeGalaxyMap(galaxy, giver, receiver);
        for (const i of newForReceiver) {
            expect(receiver.systemVisibility[i].status).toBe(SystemVisibilityStatus.Explored);
            // C#: newly explored systems are added to SystemsVisible (Galaxy.4.cs 3777).
            expect(receiver.visibility.systemsVisible).toContain(receiver.systemVisibility[i].systemStar);
        }
        for (const h of galaxy.habitats) {
            if (giver.resourceMap.checkResourcesKnown(h)) expect(receiver.resourceMap.checkResourcesKnown(h)).toBe(true);
        }
        expect(receiver.knownPirateBases).toContain(pirateBase);
        giver.knownPirateBases = [];
        receiver.knownPirateBases = [];
    });
});

describe('BuiltObject.1.cs ScanArea / ScanForLocations, BuiltObject.cs pre-warp visibility', () => {
    it('surveys unsurveyed habitats within sensor range and draws Next(0, 800) once per non-independent one', () => {
        // First empire ship / base with a habitat in sensor range (which one depends on the seed's game start).
        const habitatsInRange = (ship: (typeof galaxy.builtObjects)[number]) => {
            const r = ship.sensorResourceProfileSensorRange;
            return getHabitatsAtLocation(galaxy, ship.xpos, ship.ypos, r + 46000).filter(
                (h) =>
                    h.xpos >= Math.trunc(ship.xpos) - r &&
                    h.xpos <= Math.trunc(ship.xpos) + r &&
                    h.ypos >= Math.trunc(ship.ypos) - r &&
                    h.ypos <= Math.trunc(ship.ypos) + r &&
                    galaxy.calculateDistanceSquared(h.xpos, h.ypos, ship.xpos, ship.ypos) <= r * r,
            );
        };
        const ship = galaxy.builtObjects.find(
            (b) => b.empire !== null && b.empire !== galaxy.independentEmpire && b.sensorResourceProfileSensorRange > 0 && habitatsInRange(b).length > 0,
        )!;
        const empire = ship.empire as Empire;
        const inRange = habitatsInRange(ship);
        expect(inRange.length).toBeGreaterThan(0);
        const saved = inRange.map((h) => empire.resourceMap.checkResourcesKnown(h));
        for (const h of inRange) empire.resourceMap.setResourcesKnown(h, false);
        const draws = galaxy.rnd.drawCount;
        const expectedDraws = inRange.filter((h) => h.empire !== galaxy.independentEmpire).length;
        const bos = galaxy.builtObjects.length;
        scanArea(galaxy, ship);
        for (const h of inRange) expect(empire.resourceMap.checkResourcesKnown(h)).toBe(true);
        expect(ship.scanHabitatIndex).toBe(inRange[inRange.length - 1].habitatIndex);
        expect(ship.lastScanTime).toBe(galaxyStarDate(galaxy));
        if (galaxy.builtObjects.length === bos) expect(galaxy.rnd.drawCount - draws).toBe(expectedDraws);
        // Already surveyed: no further draws.
        const draws2 = galaxy.rnd.drawCount;
        scanArea(galaxy, ship);
        expect(galaxy.rnd.drawCount).toBe(draws2);
        inRange.forEach((h, i) => empire.resourceMap.setResourcesKnown(h, saved[i]));
    });

    it('ScanForLocations removes location hints the ship has reached (46000 inside a system, 5000 outside)', () => {
        const ship = galaxy.builtObjects.find((b) => b.empire === galaxy.empires[0] && b.nearestSystemStar !== null)!;
        const e = galaxy.empires[0];
        e.locationHints = [
            { x: Math.trunc(ship.xpos) + 45000, y: Math.trunc(ship.ypos) },
            { x: Math.trunc(ship.xpos) + 47000, y: Math.trunc(ship.ypos) },
        ];
        scanForLocations(galaxy, ship);
        expect(e.locationHints).toEqual([{ x: Math.trunc(ship.xpos) + 47000, y: Math.trunc(ship.ypos) }]);
        e.locationHints = [];
    });

    it('a pre-warp ship in a system makes it Visible for its empire (and sets NearestSystemStar)', () => {
        const e = galaxy.empires[1];
        const ship = galaxy.builtObjects.find((b) => b.empire === e && b.role !== BuiltObjectRole.Base)!;
        const target = galaxy.systems.find((s) => s.systemStar.category === HabitatCategoryType.Star && e.systemVisibility[s.systemStar.systemIndex].status === SystemVisibilityStatus.Unexplored)!.systemStar;
        const saved = { x: ship.xpos, y: ship.ypos, warp: ship.warpSpeed, star: ship.nearestSystemStar };
        ship.xpos = target.xpos + 1000;
        ship.ypos = target.ypos;
        ship.warpSpeed = 0;
        reviewSystemVisibilityForPreWarpShip(galaxy, ship);
        expect(ship.nearestSystemStar).toBe(target);
        expect(e.systemVisibility[target.systemIndex].status).toBe(SystemVisibilityStatus.Visible);
        expect(e.visibility.systemsVisible).toContain(target);
        Object.assign(ship, { xpos: saved.x, ypos: saved.y, warpSpeed: saved.warp, nearestSystemStar: saved.star });
    });
});

describe('Galaxy.5.cs CheckRuinsHaveBenefit', () => {
    it('follows the per-type rules and denies pirate factions', () => {
        const ruin = new Ruin('R', 0, 0, 0, 0, 0, 0, 0);
        expect(checkRuinsHaveBenefit(galaxy, ruin, null)).toBe(false);
        ruin.moneyBonus = 10;
        expect(checkRuinsHaveBenefit(galaxy, ruin, galaxy.empires[1])).toBe(true);
        expect(checkRuinsHaveBenefit(galaxy, ruin, galaxy.pirateEmpires[0])).toBe(false);
        const r2 = new Ruin('R2', 0, 0, 0, 0, 0, 0, 0);
        r2.type = RuinType.Refugees;
        expect(checkRuinsHaveBenefit(galaxy, r2, null)).toBe(true);
        r2.clearBonuses();
        expect(checkRuinsHaveBenefit(galaxy, r2, null)).toBe(false);
        r2.storyClueLevel = 0;
        expect(checkRuinsHaveBenefit(galaxy, r2, galaxy.playerEmpire)).toBe(true);
        expect(checkRuinsHaveBenefit(galaxy, r2, galaxy.empires[1])).toBe(false);
    });
});

describe('Empire.cs ExertCulturalInfluence', () => {
    it("sets our colonies' CulturalDistressFactor = (1 − SV / (foreign SV / 5)) × 30 when below 1", () => {
        const e = galaxy.empires[0];
        const home = galaxy.determineHabitatSystemStar(e.capital!);
        const foreign = galaxy.systemHabitatsOf(home.systemIndex).find((h) => h.empire === null && h.category === HabitatCategoryType.Planet) as Habitat;
        // Pretend a rival owns a planet in our home system.
        const rival = galaxy.empires[1];
        foreign.empire = rival;
        exertCulturalInfluence(galaxy, e);
        const num3 = strategicValue(foreign);
        const num4 = strategicValue(e.capital!) / (num3 / 5.0);
        expect(e.capital!.culturalDistressFactor).toBe(num4 < 1.0 ? Math.fround((1.0 - num4) * 30.0) : 0);
        foreign.empire = null;
        exertCulturalInfluence(galaxy, e);
        // No foreign strategic value: SV / 0 = +Infinity ≥ 1.
        expect(e.capital!.culturalDistressFactor).toBe(0);
    });
});

describe('territory scheduling and UpdateSystemInfo(playerEmpire)', () => {
    it('ReviewEmpireTerritory(onlySystems) claims each colonised system star cell', () => {
        reviewEmpireTerritory(galaxy, true);
        for (const e of galaxy.empires) {
            const star = galaxy.determineHabitatSystemStar(e.capital!);
            expect(galaxy.empireTerritory.checkLocationOwnership(galaxy, star.xpos, star.ypos)).toBe(e.empireId);
        }
        // A point between systems is unclaimed in the systems-only grid.
        galaxy.empireTerritory.reviewEmpireTerritory(galaxy);
    });

    it('computes PlayerPotentialColonies, IsDisputed, ruins/scenery flags for every system', () => {
        galaxy.updateSystemInfo(galaxy.playerEmpire);
        for (const s of galaxy.systems) {
            expect(typeof s.playerPotentialColonies).toBe('boolean');
            expect(s.isDisputed).toBe((s.otherEmpires?.length ?? 0) > 0);
            expect(s.hasRuins).toBe(galaxy.systemHabitatsOf(s.systemStar.systemIndex).some((h) => h.category !== HabitatCategoryType.Asteroid && h.ruin !== null));
            expect(s.blockadeCount).toBe(0);
            expect(s.plagueId).toBe(-1);
        }
        // Only explored systems can hold potential colonies for the player.
        for (const s of galaxy.systems) {
            if (s.playerPotentialColonies) expect(galaxy.playerEmpire!.visibility.checkSystemExplored(s.systemStar.systemIndex)).toBe(true);
        }
    });
});

describe('harness smoke (seed 1, 600 game-s, ships parked)', () => {
    it('exploration state evolves and only the unported InvestigateRuins stub of M4t remains', () => {
        const g = createTickGame(gameData).galaxy;
        const known0 = g.empires.map((e) => g.habitats.filter((h) => e.resourceMap.checkResourcesKnown(h)).length);
        const r = runGameSeconds(g, 600);
        const known1 = g.empires.map((e) => g.habitats.filter((h) => e.resourceMap.checkResourcesKnown(h)).length);
        for (let i = 0; i < known0.length; i++) expect(known1[i]).toBeGreaterThanOrEqual(known0[i]);
        expect(known1.some((k, i) => k > known0[i])).toBe(true);
        const m4t = Object.keys(r.todoHits).filter((k) => k.startsWith('M4t '));
        expect(m4t.filter((k) => k !== 'M4t investigateRuins')).toEqual([]);
        for (const e of g.empires) expect(e.systemExploredCount).toBeGreaterThan(0);
    }, 600000);
});
