// M4y — Empire.7.cs ReviewCharacterLocation fleet branches (FleetAdmiral 838-918, TroopGeneral 1135-1206, PirateLeader
// 698-746) with Empire.8.cs 4755-4797 GenerateOrderedFleetsBy* (src/sim/fleets/fleetOrdering.ts). Hand-built fleets on
// a createTickGame galaxy from pirate escorts (as test/m4lShipGroup.test.ts), expectations worked from the C#.
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType } from '../src/sim/missions/mission';
import { FleetPosture } from '../src/sim/diplomacyTick';
import { ShipGroup, empireShipGroups } from '../src/sim/fleets/shipGroup';
import { shipGroupAddShipToFleet, shipGroupTotalOverallStrengthFactor } from '../src/sim/fleets/shipGroupTasks';
import { generateOrderedFleetsByFighterStrength, generateOrderedFleetsByOverallStrength, generateOrderedFleetsByTroopAttackStrength } from '../src/sim/fleets/fleetOrdering';
import { Character, CharacterRole, CharacterSkillType, reviewCharacterLocation } from '../src/sim/characters';

let gameData: GameData;
let galaxy: Galaxy;
let pirate: Empire;
let ships: BuiltObject[];

beforeEach(async () => {
    gameData ??= await loadGameDataFs();
    galaxy = createTickGame(gameData).galaxy;
    const escorts = (e: Empire): BuiltObject[] => e.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.subRole === BuiltObjectSubRole.Escort);
    pirate = [...galaxy.pirateEmpires].sort((a, b) => escorts(b).length - escorts(a).length)[0];
    ships = escorts(pirate);
    for (const other of galaxy.pirateEmpires) {
        for (const s of escorts(other)) {
            if (ships.length >= 4 || other === pirate) break;
            other.builtObjects.splice(other.builtObjects.indexOf(s), 1);
            s.empire = pirate;
            pirate.builtObjects.push(s);
            ships.push(s);
        }
    }
    expect(ships.length).toBeGreaterThanOrEqual(4);
});

function fleet(name: string, members: BuiltObject[]): ShipGroup {
    const sg = new ShipGroup(galaxy);
    sg.empire = pirate;
    sg.name = name;
    empireShipGroups(pirate).push(sg);
    for (const s of members) shipGroupAddShipToFleet(galaxy, sg, s);
    return sg;
}

function character(role: CharacterRole, skills: [CharacterSkillType, number][]): Character {
    const home = pirate.builtObjects.find((b) => b.role === BuiltObjectRole.Base) ?? ships[ships.length - 1];
    const c = new Character('Test ' + role, role, '', pirate.dominantRace, pirate, home, 0);
    c.activate(galaxy, pirate, home);
    const base = (c as unknown as { skillBase: Int8Array }).skillBase;
    for (const [t, v] of skills) base[t] = v;
    return c;
}

describe('Empire.8.cs GenerateOrderedFleetsBy*', () => {
    it('orders descending by the tag (Sort then Reverse; ties by name then reversed) and clears SortTags', () => {
        const [a, b, c, d] = ships;
        const f1 = fleet('Alpha', [a]);
        const f2 = fleet('Bravo', [b, c]);
        const f3 = fleet('Charlie', [d]);
        (a as unknown as { troops: unknown }).troops = { totalAttackStrength: 50 };
        (b as unknown as { troops: unknown }).troops = { totalAttackStrength: 20 };
        (c as unknown as { troops: unknown }).troops = null;
        (d as unknown as { troops: unknown }).troops = { totalAttackStrength: 20 };
        // Tags 50, 20, 20 → ascending [Bravo(20), Charlie(20), Alpha(50)] → reversed.
        expect(generateOrderedFleetsByTroopAttackStrength(pirate)).toEqual([f1, f3, f2]);
        for (const f of [f1, f2, f3]) expect(f.sortTag).toBe(0);
        // No fighters anywhere: all tags 0 → name order reversed.
        for (const s of ships) s.fighters = [];
        expect(generateOrderedFleetsByFighterStrength(pirate)).toEqual([f3, f2, f1]);
        const byStrength = generateOrderedFleetsByOverallStrength(galaxy, pirate);
        for (let i = 1; i < byStrength.length; i++) {
            expect(shipGroupTotalOverallStrengthFactor(galaxy, byStrength[i - 1])).toBeGreaterThanOrEqual(shipGroupTotalOverallStrengthFactor(galaxy, byStrength[i]));
        }
    });
});

describe('Empire.7.cs ReviewCharacterLocation fleet branches', () => {
    it('FleetAdmiral (838-918): picks the strongest unled Attack fleet and moves to its strongest ship', () => {
        const [a, b, c, d] = ships;
        a.firepowerRaw = 10;
        b.firepowerRaw = 30;
        c.firepowerRaw = 5;
        d.firepowerRaw = 1;
        const fBig = fleet('Big', [a, b, c]);
        const fSmall = fleet('Small', [d]);
        expect(shipGroupTotalOverallStrengthFactor(galaxy, fBig)).toBeGreaterThan(shipGroupTotalOverallStrengthFactor(galaxy, fSmall));
        const adm = character(CharacterRole.FleetAdmiral, [[CharacterSkillType.Targeting, 10]]);
        expect(adm.determineFleet()).toBeNull();
        const d0 = galaxy.rnd.drawCount;
        expect(reviewCharacterLocation(galaxy, pirate, adm, false)).toBe(b); // DetermineStrongestShip: max FirepowerRaw
        expect(adm.transferDestination).toBeNull();
        // A Defend-posture fleet is never picked.
        fBig.posture = FleetPosture.Defend;
        expect(reviewCharacterLocation(galaxy, pirate, adm, false)).toBe(d);
        fBig.posture = FleetPosture.Attack;
        expect(reviewCharacterLocation(galaxy, pirate, adm, true)).toBe(b);
        expect(adm.transferDestination).toBe(b);
        expect(galaxy.rnd.drawCount).toBe(d0);
        // Once in transfer, ReviewCharacterLocation returns the location untouched.
        expect(reviewCharacterLocation(galaxy, pirate, adm, true)).toBe(adm.location);
    });

    it('FleetAdmiral in a fleet: stays on a High-priority mission; a second admiral skips fleets already led', () => {
        const [a, b, c, d] = ships;
        a.firepowerRaw = 10;
        b.firepowerRaw = 30;
        c.firepowerRaw = 5;
        d.firepowerRaw = 1;
        const fBig = fleet('Big', [a, b, c]);
        fleet('Small', [d]);
        const adm = character(CharacterRole.FleetAdmiral, [[CharacterSkillType.Targeting, 10]]);
        adm.completeLocationTransfer(a, galaxy);
        expect(adm.determineFleet()).toBe(fBig);
        const m = new BuiltObjectMission(galaxy, b, BuiltObjectMissionType.Attack, null, null, BuiltObjectMissionPriority.High);
        fBig.mission = m;
        expect(m.priority).toBe(BuiltObjectMissionPriority.High);
        expect(reviewCharacterLocation(galaxy, pirate, adm, false)).toBe(a); // break → Location
        // Low priority: re-evaluated; its own fleet stays best (shipGroup7 == shipGroup5) → its strongest ship (909-917).
        (m as unknown as { _missionPriority: BuiltObjectMissionPriority })._missionPriority = BuiltObjectMissionPriority.Low;
        expect(reviewCharacterLocation(galaxy, pirate, adm, false)).toBe(b);
        adm.completeLocationTransfer(b, galaxy);
        expect(reviewCharacterLocation(galaxy, pirate, adm, false)).toBe(b); // already there → Location (918)
        // A second admiral may not take the led fleet: it goes to Small's strongest ship.
        const adm2 = character(CharacterRole.FleetAdmiral, [[CharacterSkillType.Targeting, 10]]);
        expect(reviewCharacterLocation(galaxy, pirate, adm2, false)).toBe(d);
    });

    it('TroopGeneral (1135-1206): attack general goes to the strongest troop transport of the best troop fleet', () => {
        const [a, b, c, d] = ships;
        (a as unknown as { troops: unknown }).troops = { totalAttackStrength: 10 };
        (b as unknown as { troops: unknown }).troops = { totalAttackStrength: 40 };
        (c as unknown as { troops: unknown }).troops = { totalAttackStrength: 35 };
        (d as unknown as { troops: unknown }).troops = null;
        fleet('One', [a, b]); // 50
        const fTwo = fleet('Two', [c]); // 35
        fleet('Three', [d]); // 0
        const gen = character(CharacterRole.TroopGeneral, [[CharacterSkillType.TroopGroundAttack, 10]]);
        expect(reviewCharacterLocation(galaxy, pirate, gen, false)).toBe(b);
        // Already in fleet One (the best): shipGroup3 == shipGroup → break → Location.
        gen.completeLocationTransfer(a, galaxy);
        expect(reviewCharacterLocation(galaxy, pirate, gen, false)).toBe(a);
        // A second attack general skips fleet One (led) and takes Two.
        const gen2 = character(CharacterRole.TroopGeneral, [[CharacterSkillType.TroopGroundAttack, 10]]);
        expect(reviewCharacterLocation(galaxy, pirate, gen2, true)).toBe(c);
        expect(gen2.transferDestination).toBe(c);
        void fTwo;
    });
});
