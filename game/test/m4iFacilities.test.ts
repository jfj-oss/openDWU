// M4i planetary facilities and wonders (tasks/M4-plan.md §3.3 M4i): Habitat.QueueFacilityConstruction /
// ConstructFacilities / ReviewPlanetaryFacilities, Galaxy.ReviewWondersBuilt / CheckWonderBuilt, Empire.TrackedWonders,
// Galaxy.CalculatePlanetaryFacilityCost, and a harness run of the facility AI.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame, createTickGameAtAge } from './helpers/tickGame';
import { runGameSeconds } from '../src/sim/tick/harness';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { PlanetaryFacilityType, facilityType } from '../src/sim/researchSystem';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../src/sim/galaxyTime';
import { strategicValue } from '../src/sim/territory';
import {
    PlanetaryFacility,
    calculatePlanetaryFacilityCost,
    canBuildWonder,
    constructFacilities,
    definitionsFindFacilityByType,
    definitionsGetWonders,
    facilitiesCountByType,
    planetaryFacilityDefinitionsStatic,
    queueFacilityConstruction,
    queueWonderConstruction,
    reviewPlanetaryFacilities,
    trackedWondersAddUpdateBuildDate,
    trackedWondersRemoveBuildDate,
    type PlanetaryFacilityBuildDate,
} from '../src/sim/construction/facilities';
import { checkWonderBuiltDef, reviewWondersBuilt } from '../src/sim/construction/wonders';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function aiEmpire(g: Galaxy): Empire {
    return g.empires.find((e) => e !== g.playerEmpire)!;
}

describe('M4i unit: facilities', () => {
    it('CalculatePlanetaryFacilityCost is the definition BuildCost for a normal empire (factor 1)', () => {
        const g = createTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const defs = planetaryFacilityDefinitionsStatic(g);
        expect(defs.length).toBeGreaterThan(0);
        for (const d of defs) expect(calculatePlanetaryFacilityCost(d, e)).toBe(d.buildCost);
        expect(calculatePlanetaryFacilityCost(null, e)).toBe(0);
    });

    it('QueueFacilityConstruction adds one unbuilt facility per type, refuses a second of the same type', () => {
        const g = createTickGame(gameData).galaxy;
        const cap = aiEmpire(g).capital!;
        const n = cap.facilities?.length ?? 0;
        expect(queueFacilityConstruction(g, cap, PlanetaryFacilityType.PlanetaryShield)).toBe(true);
        expect(queueFacilityConstruction(g, cap, PlanetaryFacilityType.PlanetaryShield)).toBe(false);
        expect(cap.facilities!.length).toBe(n + 1);
        expect(cap.facilities![n].constructionProgress).toBe(0);
        expect(facilitiesCountByType(cap.facilities!, PlanetaryFacilityType.PlanetaryShield)).toBe(1);
    });

    it('ConstructFacilities advances progress by (float)(timePassed / clamp(100000 × 600 / StrategicValue, 90, 1800))', () => {
        const g = createTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const cap = e.capital!;
        cap.facilities = [];
        queueFacilityConstruction(g, cap, PlanetaryFacilityType.PlanetaryShield);
        const leaderSpeed = e.leader !== null ? e.leader.facilityConstructionSpeed : 0;
        let val = 100000.0 * (REAL_SECONDS_IN_GALACTIC_YEAR / strategicValue(cap));
        val = Math.max(90.0, Math.min(1800.0, val));
        let num = Math.fround(10.0 / val);
        num = Math.fround(num * Math.fround(1.0 + leaderSpeed / 100.0));
        constructFacilities(g, cap, 10.0);
        expect(cap.facilities[0].constructionProgress).toBe(Math.fround(0 + num));
    });

    it('a completed PlanetaryShield / FortifiedBunker set the habitat flags in ReviewPlanetaryFacilities', () => {
        const g = createTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const cap = e.capital!;
        cap.facilities = [];
        queueFacilityConstruction(g, cap, PlanetaryFacilityType.PlanetaryShield, true);
        queueFacilityConstruction(g, cap, PlanetaryFacilityType.FortifiedBunker, true);
        reviewPlanetaryFacilities(g, cap, e);
        expect(cap.planetaryShieldPresent).toBe(true);
        const bunker = cap.facilities.find((f) => f.type === PlanetaryFacilityType.FortifiedBunker)!;
        const b = bunker.value1 & 0xff;
        // 10 × ((1 + 0/10) × (1 + b/10)) − 10 = b (no ColonyDefense wonder), then (byte).
        expect(cap.defensiveFortressBonus).toBe(Math.trunc(Math.min(255, 10.0 * (1.0 + b / 10.0) - 10.0)) & 0xff);
        // An unfinished facility does not count.
        cap.facilities = [new PlanetaryFacility(definitionsFindFacilityByType(planetaryFacilityDefinitionsStatic(g), PlanetaryFacilityType.PlanetaryShield)!, 0.5)];
        reviewPlanetaryFacilities(g, cap, e);
        expect(cap.planetaryShieldPresent).toBe(false);
        expect(cap.defensiveFortressBonus).toBe(0);
    });

    it('ReviewWondersBuilt marks completed wonders only; a built wonder can no longer be queued anywhere', () => {
        const g = createTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const cap = e.capital!;
        const wonders = definitionsGetWonders(planetaryFacilityDefinitionsStatic(g));
        expect(wonders.length).toBeGreaterThan(0);
        const w = wonders.find((d) => canBuildWonder(g, cap, d))!;
        expect(facilityType(w)).toBe(PlanetaryFacilityType.Wonder);
        expect(queueWonderConstruction(g, cap, w)).toBe(true);
        reviewWondersBuilt(g);
        expect(checkWonderBuiltDef(g, w)).toBe(false);
        cap.facilities![cap.facilities!.length - 1].constructionProgress = 1;
        reviewWondersBuilt(g);
        expect(checkWonderBuiltDef(g, w)).toBe(true);
        expect(canBuildWonder(g, cap, w)).toBe(false);
        expect(queueWonderConstruction(g, g.empires[0].capital!, w)).toBe(false);
    });

    it('TrackedWonders AddUpdateBuildDate replaces the (colony, facility) entry', () => {
        const g = createTickGame(gameData).galaxy;
        const cap = aiEmpire(g).capital!;
        const list: PlanetaryFacilityBuildDate[] = [];
        trackedWondersAddUpdateBuildDate(list, cap, 7, 100);
        trackedWondersAddUpdateBuildDate(list, cap, 8, 150);
        trackedWondersAddUpdateBuildDate(list, cap, 7, 200);
        expect(list.map((d) => [d.facilityId, d.buildDate])).toEqual([
            [8, 150],
            [7, 200],
        ]);
        trackedWondersRemoveBuildDate(list, cap, 8);
        expect(list.length).toBe(1);
    });
});

describe('M4i harness: facility AI', () => {
    it('1200 game-seconds: facilities queued by the AI progress and never exceed 1', () => {
        // Age 0 (PreWarp) fixture: at the default age-1 start the empires form fleets within this run and
        // Empire.7.cs ReviewCharacterLocation's FleetAdmiral / TroopGeneral ShipGroup branches (838-, 1150-,
        // GenerateOrderedFleetsBy*, Empire.8.cs) are still TODO(port) throws in characters.ts; back to
        // createTickGame once they are ported.
        const g = createTickGameAtAge(gameData, 0).galaxy;
        const r = runGameSeconds(g, 1200);
        for (const e of g.empires) {
            for (const c of e.colonies) {
                for (const f of c.facilities ?? []) {
                    expect(f.constructionProgress).toBeGreaterThanOrEqual(0);
                    expect(f.constructionProgress).toBeLessThanOrEqual(1);
                }
            }
        }
        expect(Object.keys(r.todoHits).filter((k) => k.startsWith('M4i'))).toEqual([]);
    }, 600000);
});
