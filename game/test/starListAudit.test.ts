// Star-list audit (tasks/STAR-LIST-AUDIT-2026-09-26.md): C# SystemInfo.Habitats excludes the star (Galaxy.4.cs 2340
// DetermineHabitatsInSystem, Galaxy.6.cs 4611) while the TS SystemInfo.habitats holds it at [0]. One test per fixed
// reader group, asserting the visible effect of reading planetsOf() instead of the star-inclusive list.
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import { HabitatCategoryType, planetsOf, type Habitat } from '../src/sim/types';
import { Ruin, RuinType } from '../src/sim/ruins';
import { investigateRuins } from '../src/sim/exploration';
import { valueGalaxyMapForEmpire } from '../src/sim/tradeItems';
import { updateEmpireRefuellingLocations } from '../src/sim/independentTraders';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { assignShipSystemPatrol } from '../src/sim/player/executeShipAction';
import { BuiltObjectMissionType, type BuiltObjectMission } from '../src/sim/missions/mission';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('map knowledge readers (Galaxy.4.cs 4635, Galaxy.5.cs 4496)', () => {
    it('ValueGalaxyMapForEmpire does not count the star', () => {
        const g = createTickGame(gameData).galaxy;
        const [a, b] = g.empires.filter((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null);
        const i = g.systems.findIndex((s, k) => a.visibility.checkSystemExplored(k) && planetsOf(s).length > 0);
        expect(i).toBeGreaterThanOrEqual(0);
        const star = g.systems[i].systemStar;
        a.resourceMap.setResourcesKnown(star, true);
        b.resourceMap.setResourcesKnown(star, false);
        const before = valueGalaxyMapForEmpire(g, a, b);
        // The requesting empire learning the star alone leaves the map's value unchanged (C# never looks at it).
        b.resourceMap.setResourcesKnown(star, true);
        expect(valueGalaxyMapForEmpire(g, a, b)).toBe(before);
    });

    it('InvestigateRuins Refugees spawn at the first planet > 400 from the ruin, never the star', () => {
        const g = createTickGame(gameData).galaxy;
        const e = g.playerEmpire!;
        // a ruin planet more than 400 from its star, with a later sibling also > 400 away
        const ruinsHabitat = g.habitats.find((h) => {
            if (h.category !== HabitatCategoryType.Planet || h.ruin !== null) return false;
            const s = g.systems[h.systemIndex];
            return g.calculateDistance(h.xpos, h.ypos, s.systemStar.xpos, s.systemStar.ypos) > 400 && planetsOf(s).some((p) => g.calculateDistance(h.xpos, h.ypos, p.xpos, p.ypos) > 400);
        })!;
        expect(ruinsHabitat).toBeDefined();
        const system = g.systems[ruinsHabitat.systemIndex];
        const expected = planetsOf(system).find((p) => g.calculateDistance(ruinsHabitat.xpos, ruinsHabitat.ypos, p.xpos, p.ypos) > 400)!;
        const ruin = new Ruin('R', 0, 0, 0, 0, 0, 0, 0);
        ruin.type = RuinType.Refugees;
        ruinsHabitat.ruin = ruin;
        const got: { type: number; message: string; location: unknown }[] = [];
        e.eventMessageRecipient = { receiveEventMessage: (type: number, _t: string, message: string, _d: unknown, location: unknown) => got.push({ type, message, location }) } as never;
        const n0 = g.builtObjects.length;
        investigateRuins(g, e, ruinsHabitat);
        const spawned = g.builtObjects.slice(n0).filter((b) => b !== null);
        expect(spawned.length).toBeGreaterThan(0);
        for (const b of spawned) {
            const dExpected = g.calculateDistance(b.xpos, b.ypos, expected.xpos, expected.ypos);
            const dStar = g.calculateDistance(b.xpos, b.ypos, system.systemStar.xpos, system.systemStar.ypos);
            expect(dExpected).toBeLessThan(dStar);
        }
        expect(got.some((m) => m.message.includes(expected.name))).toBe(true);
    });
});

describe('refuelling readers (Empire.6.cs 3905, Galaxy.6.cs 3219 / 3375)', () => {
    it('a refuelling base parked at a (non gas cloud) star is no refuelling point', () => {
        const g = createTickGame(gameData).galaxy;
        const empire = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e.spacePorts.length > 0)!;
        const port = empire.spacePorts[0] as BuiltObject;
        expect(port.isRefuellingDepot).toBe(true);
        // move the port from its colony to a normal star the empire has explored and that has no other refuelling point
        const sysIndex = g.systems.findIndex((s, k) => s.systemStar.category === HabitatCategoryType.Star && empire.visibility.checkSystemExplored(k) && planetsOf(s).every((h) => h.basesAtHabitat.length === 0 && h.population.items.length === 0));
        expect(sysIndex).toBeGreaterThanOrEqual(0);
        const star = g.systems[sysIndex].systemStar;
        const from = port.parentHabitat!;
        from.basesAtHabitat.splice(from.basesAtHabitat.indexOf(port), 1);
        star.basesAtHabitat.push(port);
        port.parentHabitat = star;
        port.xpos = star.xpos;
        port.ypos = star.ypos;
        updateEmpireRefuellingLocations(g, empire);
        // C# only walks a star's bases when it is a gas cloud; a star's own bases are never in Systems[].Habitats.
        expect(empire.refuellingLocations.includes(port)).toBe(false);
    });
});

describe('AI asset / target readers (Empire.9.cs 312, 4528; Empire.2.cs 4186 …)', () => {
    it('AssignShipSystemPatrol ignores a base at the star: no assets, so the ship moves to the star', () => {
        const g = createTickGame(gameData).galaxy;
        const empire = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e.spacePorts.length > 0)!;
        const port = empire.spacePorts[0] as BuiltObject;
        const ship = empire.builtObjects.find((b) => b.role === BuiltObjectRole.Military) ?? empire.builtObjects.find((b) => b !== port && b.role !== BuiltObjectRole.Base)!;
        expect(ship).toBeDefined();
        const system = g.systems.find((s) => s.systemStar.category === HabitatCategoryType.Star && planetsOf(s).every((h) => h.owner !== empire && h.basesAtHabitat.every((b) => b.empire !== empire)))!;
        const star = system.systemStar;
        const from = port.parentHabitat!;
        from.basesAtHabitat.splice(from.basesAtHabitat.indexOf(port), 1);
        star.basesAtHabitat.push(port);
        port.parentHabitat = star;
        expect(assignShipSystemPatrol(g, empire, ship, system, false)).toBe(true);
        const mission = ship.mission as BuiltObjectMission;
        // Empire.9.cs 284-305: an empty asset list sends the ship to the star (Move), not on Patrol.
        expect(mission.type).toBe(BuiltObjectMissionType.Move);
        expect(mission.targetHabitat).toBe(star);
    });
});
