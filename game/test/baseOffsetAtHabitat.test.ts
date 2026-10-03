// Where a construction ship's base sits on its habitat (user report: "a mining station way too far off the centre
// of its moon, barely attached"). The C# chain, all ported 1:1:
//   - the AI / player order picks a target point inside the body: Galaxy.6.cs 3770 SelectRelativeHabitatSurfacePoint,
//     |(x, y)| < max(Diameter - 10, 1) / 2 (Empire.6.cs CheckResourceAssignBuild, Main.Part4.cs method_540, ...);
//   - BaconBuiltObjectMission.cs 385-420 Build: ClearParent, ConditionalHyperTo, SetParent, MoveTo + ImpulseTo at
//     that relative point;
//   - BuiltObject.2.cs 6851 DoMovement → 7183 CheckForArrival: relative to the parent with a non-zero relative point
//     the arrival allowance is targetArrivalDistance 1.0 + Galaxy.MovementPrecision 30 (Galaxy.3.cs 4980) — so the
//     ship stops up to 31 units short of the point, and ImpulseTo (same allowance) is then already "arrived";
//   - BuiltObject.2.cs 1521-1590 case Build: the base takes the ship's ParentOffsetX/Y and
//     AddBuiltObjectToGalaxy(..., (int)ParentOffsetX, (int)ParentOffsetY) (Empire.7.cs).
// So a ship-built base may sit up to (Diameter - 10) / 2 + 31 from the body's centre — on a small moon its centre can
// be at or past the rim. That is the original's placement, not a port deviation; these tests pin it.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Design } from '../src/sim/design';
import { HabitatCategoryType, type Habitat } from '../src/sim/types';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, COORD_UNSET_DOUBLE } from '../src/sim/missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../src/sim/missions/assign';
import { boardShipEligible, jobInvalidReason, type ConstructionJob } from '../src/sim/player/constructionBoard';
import { MOVEMENT_PRECISION } from '../src/sim/movement';
import { runGameSeconds } from '../src/sim/tick/harness';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

/** SelectRelativeHabitatSurfacePoint's range: max(Diameter - 10, 1) / 2. */
function surfaceRange(h: Habitat): number {
    return Math.max(h.diameter - 10.0, 1.0) / 2.0;
}

/** CheckForArrival's allowance for a parent-relative MoveTo / ImpulseTo: targetArrivalDistance 1 + MovementPrecision. */
const ARRIVAL_ALLOWANCE = 1.0 + MOVEMENT_PRECISION;
/** AddBuiltObjectToGalaxy gets (int)ParentOffsetX / (int)ParentOffsetY: up to 1 unit per axis. */
const TRUNC_SLACK = Math.SQRT2;

function miningDesign(game: Game, h: Habitat): Design {
    const sub = h.category === HabitatCategoryType.GasCloud ? BuiltObjectSubRole.GasMiningStation : BuiltObjectSubRole.MiningStation;
    const d = game.playerEmpire.designs.find((x) => x.subRole === sub && !x.isObsolete);
    expect(d).toBeDefined();
    return d!;
}

describe('base placement at a habitat (construction ship)', () => {
    it('a mining station built at a moon sits where the ship parked: within 31 of the surface point, (d - 10) / 2 + 31 of the centre', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ships = (p.constructionShips as BuiltObject[]).filter((s) => boardShipEligible(p, s));
        expect(ships.length).toBeGreaterThan(0);
        const ship = ships[0];
        clearPreviousMissionRequirements(g, ship, true);
        ship.subsequentMissions.length = 0;
        ship.revertMission = null;
        // The nearest moon the player may build a mining station at.
        const moons = g.habitats.filter((h) => h.category === HabitatCategoryType.Moon && h.resources.length > 0 && h.basesAtHabitat.length === 0);
        moons.sort((a, b) => Math.hypot(a.xpos - ship.xpos, a.ypos - ship.ypos) - Math.hypot(b.xpos - ship.xpos, b.ypos - ship.ypos));
        const moon = moons.find((h) => {
            const job = { id: 0, design: miningDesign(game, h), habitat: h, x: COORD_UNSET_DOUBLE, y: COORD_UNSET_DOUBLE, ship: null, active: false, basesAtStart: 0, attempts: 0 } as ConstructionJob;
            return jobInvalidReason(g, p, job) === null;
        });
        expect(moon).toBeDefined();
        const h = moon!;
        // Empire.6.cs CheckResourceAssignBuild: SelectRelativeHabitatSurfacePoint, then AssignMission(Build, habitat, design, x, y).
        const target = g.selectRelativeHabitatSurfacePoint(h);
        expect(Math.hypot(target.x, target.y)).toBeLessThanOrEqual(surfaceRange(h));
        assignMission(g, ship, BuiltObjectMissionType.Build, h, null, BuiltObjectMissionPriority.Normal, { design: miningDesign(game, h), x: target.x, y: target.y });
        let base: BuiltObject | undefined;
        for (let t = 0; t < 900 && base === undefined; t += 1) {
            runGameSeconds(game, 1);
            base = h.basesAtHabitat.find((b) => b.empire === p && b.role === BuiltObjectRole.Base);
        }
        expect(base, `no base built at ${h.name}`).toBeDefined();
        const b = base!;
        expect(b.parentHabitat).toBe(h);
        // The ship stays parked on its Build command while the yard works (speed 0, same parent offset); the base took
        // that offset ((int) cast).
        expect(builtObjectMission(ship.mission)?.type).toBe(BuiltObjectMissionType.Build);
        expect(ship.parentHabitat).toBe(h);
        expect(b.parentOffsetX).toBe(Math.trunc(ship.parentOffsetX));
        expect(b.parentOffsetY).toBe(Math.trunc(ship.parentOffsetY));
        // ... which is within the arrival allowance of the chosen surface point,
        expect(Math.hypot(b.parentOffsetX - target.x, b.parentOffsetY - target.y)).toBeLessThanOrEqual(ARRIVAL_ALLOWANCE + TRUNC_SLACK);
        // so within (d - 10) / 2 + 31 of the moon's centre — the bound the original has too (no clamp to the radius).
        expect(Math.hypot(b.parentOffsetX, b.parentOffsetY)).toBeLessThanOrEqual(surfaceRange(h) + ARRIVAL_ALLOWANCE + TRUNC_SLACK);
        // Its drawn position follows: xpos = habitat + offset.
        expect(Math.hypot(b.xpos - h.xpos - b.parentOffsetX, b.ypos - h.ypos - b.parentOffsetY)).toBeLessThan(1e-6);
    }, 600000);

    it('in a running game every mining station is within (d - 10) / 2 + 31 of its body, and ship-built ones do use the slack', () => {
        const start = cachedTickGame(gameData).galaxy;
        const startNames = new Set<string>();
        for (const b of start.builtObjects) if (b && b.role === BuiltObjectRole.Base && b.parentHabitat !== null) startNames.add(`${b.parentHabitat.name}|${b.name}`);
        const g = cachedTickGame(gameData, { seconds: 600 }).galaxy;
        let checked = 0;
        let beyondSurface = 0;
        for (const b of g.builtObjects) {
            if (!b || b.parentHabitat === null) continue;
            if (b.subRole !== BuiltObjectSubRole.MiningStation && b.subRole !== BuiltObjectSubRole.GasMiningStation) continue;
            const h = b.parentHabitat;
            const d = Math.hypot(b.parentOffsetX, b.parentOffsetY);
            expect(d, `${b.name} at ${h.name} (diameter ${h.diameter})`).toBeLessThanOrEqual(surfaceRange(h) + ARRIVAL_ALLOWANCE + TRUNC_SLACK);
            checked++;
            // Built during the run by a construction ship: may be past the surface range by up to the allowance.
            if (!startNames.has(`${h.name}|${b.name}`) && d > surfaceRange(h)) beyondSurface++;
        }
        expect(checked).toBeGreaterThan(20);
        expect(beyondSurface).toBeGreaterThan(0);
    }, 600000);
});
