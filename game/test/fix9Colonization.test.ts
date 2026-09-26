// fix9 A4: Empire.9.cs 4035 CheckWhetherHabitatIsDangerous was a stub returning false, so IdentifyColonizationTargets
// (Empire.4.cs 4736, filterOutDangerousTargets) kept re-sending colony ships to systems with pirate warships, where they
// were attacked, cancelled the mission and fled (CheckForAttack → Escape) over and over.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { checkWhetherHabitatIsDangerous } from '../src/sim/resourceTargets';
import { identifyColonizationTargets } from '../src/sim/civilianAI';
import { PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function fakeShip(empire: Empire, x: number, y: number, role: BuiltObjectRole, warpSpeed: number, topSpeed: number): BuiltObject {
    return { empire, role, warpSpeed, topSpeed, xpos: x, ypos: y } as unknown as BuiltObject;
}

describe('CheckWhetherHabitatIsDangerous (Empire.9.cs 4035)', () => {
    it('flags pirate warships in the system threat list, except Protection pirates and non-pirates', () => {
        const g = cachedTickGame(gameData).galaxy;
        const empire = g.empires.find((e) => e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire && e !== g.playerEmpire)!;
        const pirate = g.pirateEmpires.find((e) => e.pirateEmpireBaseHabitat !== null)!;
        const other = g.empires.find((e) => e.pirateEmpireBaseHabitat === null && e !== empire && e !== g.independentEmpire)!;
        const sys = g.systems.find((s) => g.systemHabitatsOf(s.systemStar.systemIndex).length > 0 && (s.creatures ?? []).length === 0)!;
        const habitat: Habitat = g.systemHabitatsOf(sys.systemStar.systemIndex)[0];
        const sv = empire.systemVisibility[sys.systemStar.systemIndex];
        const saved = sv.threats;
        const relation = obtainPirateRelation(empire, pirate);
        const savedType = relation.type;
        try {
            sv.threats = [];
            expect(checkWhetherHabitatIsDangerous(g, empire, habitat)).toBe(false);
            // a hyperdrive-capable pirate warship anywhere in the system (4063)
            sv.threats = [fakeShip(pirate, habitat.xpos + 50000, habitat.ypos, BuiltObjectRole.Military, 5000, 20)];
            relation.type = PirateRelationType.None;
            expect(checkWhetherHabitatIsDangerous(g, empire, habitat)).toBe(true);
            // paying protection to that faction (4050)
            relation.type = PirateRelationType.Protection;
            expect(checkWhetherHabitatIsDangerous(g, empire, habitat)).toBe(false);
            relation.type = PirateRelationType.None;
            // sub-light pirate ship: only within 2000 of the habitat (4067-4073)
            sv.threats = [fakeShip(pirate, habitat.xpos + 1999, habitat.ypos, BuiltObjectRole.Military, 0, 20)];
            expect(checkWhetherHabitatIsDangerous(g, empire, habitat)).toBe(true);
            sv.threats = [fakeShip(pirate, habitat.xpos + 2001, habitat.ypos, BuiltObjectRole.Military, 0, 20)];
            expect(checkWhetherHabitatIsDangerous(g, empire, habitat)).toBe(false);
            // non-pirate empires' warships and pirate non-military ships are not a danger (4045)
            sv.threats = [fakeShip(other, habitat.xpos, habitat.ypos, BuiltObjectRole.Military, 5000, 20), fakeShip(pirate, habitat.xpos, habitat.ypos, BuiltObjectRole.Freight, 5000, 20)];
            expect(checkWhetherHabitatIsDangerous(g, empire, habitat)).toBe(false);
        } finally {
            sv.threats = saved;
            relation.type = savedType;
        }
    });

    it('drops a colonization target in a pirate-threatened system and records it in DangerousHabitats', () => {
        const g = cachedTickGame(gameData).galaxy;
        const pirate = g.pirateEmpires.find((e) => e.pirateEmpireBaseHabitat !== null)!;
        let checked = 0;
        for (const empire of g.empires) {
            if (empire.pirateEmpireBaseHabitat !== null || empire === g.independentEmpire || empire === g.playerEmpire) continue;
            const targets = identifyColonizationTargets(g, empire);
            if (targets.length === 0) continue;
            const target = targets[0].habitat;
            const sv = empire.systemVisibility[target.systemIndex];
            const saved = sv.threats;
            const relation = obtainPirateRelation(empire, pirate);
            const savedType = relation.type;
            try {
                relation.type = PirateRelationType.None;
                sv.threats = [fakeShip(pirate, target.xpos + 30000, target.ypos, BuiltObjectRole.Military, 5000, 20)];
                const after = identifyColonizationTargets(g, empire);
                expect(after.some((t) => t.habitat === target)).toBe(false);
                expect(empire.dangerousHabitats).toContain(target);
                checked++;
            } finally {
                sv.threats = saved;
                relation.type = savedType;
            }
            break;
        }
        expect(checked).toBe(1);
    });
});
