import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { GalaxyShape } from '../src/sim/types';
import { TroopType } from '../src/sim/cargo';
import { COLONY_MAXIMUM_TROOP_STRENGTH } from '../src/sim/empire';
import { strategicValue } from '../src/sim/territory';
import {
    annualTroopMaintenance,
    annualTroopMaintenanceIncludeRecruiting,
    calculateCostPerTroop,
    estimatedDefensiveForceRequired,
    generateCapitalStartingTroops,
    generateColonyStartingTroops,
    processColonyTroops,
    registerTroopGeneralHook,
    troopLevelRequired,
} from '../src/sim/troops';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

let gameData: GameData;
beforeAll(async () => { gameData = await loadGameDataFs(); }, 60000);

const DIFFICULTY = 1.0;
const TECH = 0.5;

function opts(): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: TECH });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8, galaxyAge: 1,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: TECH },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
    };
}

// Records every Galaxy.Rnd call made while `fn` runs.
function recordRnd<T>(galaxy: Galaxy, fn: () => T): { result: T; draws: { kind: string; args: number[]; value: number }[] } {
    const rnd = galaxy.rnd;
    const draws: { kind: string; args: number[]; value: number }[] = [];
    const origNext = rnd.next.bind(rnd) as (...a: number[]) => number;
    const origNextDouble = rnd.nextDouble.bind(rnd);
    rnd.next = (...args: number[]) => { const v = origNext(...args); draws.push({ kind: 'Next', args, value: v }); return v; };
    rnd.nextDouble = () => { const v = origNextDouble(); draws.push({ kind: 'NextDouble', args: [], value: v }); return v; };
    try {
        return { result: fn(), draws };
    } finally {
        rnd.next = origNext;
        rnd.nextDouble = origNextDouble;
    }
}

function ordinalOk(name: string, n: number, label: string): boolean {
    const m = /^(\d+)(st|nd|rd|th) (.*)$/.exec(name);
    return m !== null && Number(m[1]) === n && m[3] === label;
}

interface RunSummary {
    capitals: { levelRequired: number; edfr: number; draw: number; troops: number; names: string[] }[];
    colonyTroops: number[];
    maintenance: number[];
    processDraws: string[];
    troopGenerals: string[];
}

function run(colonyGarrisons: boolean): RunSummary {
    // State right after the starting colonies (capital garrisons from GenerateEmpire), before
    // createGame's own ReviewTaxes / ProcessColonyTroops (Start.2.cs 1320-1339) — test-only __phaseHook.
    const galaxy = createGame({ ...opts(), __phaseHook: (phase) => (phase === 'startingColonies' ? 'stop' : undefined) }).galaxy;
    const summary: RunSummary = { capitals: [], colonyTroops: [], maintenance: [], processDraws: [], troopGenerals: [] };
    // Stand-in for Empire.GenerateNewCharacter(TroopGeneral) (characters port): records the call.
    registerTroopGeneralHook((_g, e, loc, troop) => { summary.troopGenerals.push(`${e.name}@${loc.name}:${troop.name}`); });
    for (const empire of galaxy.empires) {
        const capital = empire.capital!;
        const race = empire.dominantRace!;
        empire.troops.clear();
        capital.troops!.clear();
        // M4j: GenerateEmpire's Empire.DoTasks now runs EvaluateColonyVariables with recruitment, which may queue
        // troops (named from the same counter) — reset them with the garrison.
        capital.troopsToRecruit?.clear();
        empire.troopCount = 0;
        // Galaxy.7.cs 5292-5316.
        const edfr = estimatedDefensiveForceRequired(galaxy, capital, false, DIFFICULTY);
        // Habitat.cs 5486-5514: StrategicValue / 750 * (caution/100)^2, × HomeworldDefensePriority.
        const caution = Math.pow(race.caution / 100.0, 2.0);
        let expectedEdfr = Math.trunc((strategicValue(capital) / 750.0) * caution);
        if (capital === empire.homeWorld) expectedEdfr = Math.trunc(expectedEdfr * empire.policy!.homeworldDefensePriority);
        expect(edfr).toBe(expectedEdfr);
        const { result: created, draws } = recordRnd(galaxy, () => generateCapitalStartingTroops(galaxy, empire, capital, race, TECH, DIFFICULTY));
        expect(draws.map((d) => d.kind)).toEqual(['NextDouble']);
        const num6 = Math.min(edfr * 2, COLONY_MAXIMUM_TROOP_STRENGTH / 100);
        const expectedCount = empire.troopCanRecruitInfantry ? Math.trunc(Math.trunc(num6 * draws[0].value) / 100) : 0;
        expect(created.length).toBe(expectedCount);
        expect(capital.troops!.count).toBe(expectedCount);
        expect(empire.troops.count).toBe(expectedCount);
        created.forEach((t, i) => {
            expect(ordinalOk(t.name, i + 1, empire.troopDescription)).toBe(true);
            expect(t.type).toBe(TroopType.Infantry);
            expect(t.colony).toBe(capital);
            expect(t.readiness).toBe(100);
        });
        summary.capitals.push({ levelRequired: troopLevelRequired(galaxy, capital, DIFFICULTY), edfr, draw: draws[0].value, troops: created.length, names: created.map((t) => t.name) });

        // Habitat.cs TroopLevelRequired (318) on the capital: min(EDFR*0.5, 1500) * 1.5 * max(infantry, garrison level).
        const pol = empire.policy!;
        const expectedLevel = Math.max(Math.trunc(Math.trunc(Math.min(Math.trunc(edfr * 0.5), 1500) * 1.5) * Math.max(pol.troopRecruitInfantryLevel, pol.troopGarrisonLevel)), pol.troopGarrisonMinimumPerColony * 100);
        expect(troopLevelRequired(galaxy, capital, DIFFICULTY)).toBe(expectedLevel);

        // Galaxy.8.cs 685-696 (MakeHabitatIntoColony garrison). This galaxy's empires own only
        // their capital, so the formula is exercised on it (1.5× capital TroopLevelRequired).
        for (const colony of colonyGarrisons ? empire.colonies : []) {
            const level = troopLevelRequired(galaxy, colony, DIFFICULTY);
            const before = empire.troopCount;
            const r = recordRnd(galaxy, () => generateColonyStartingTroops(galaxy, colony, empire, race, DIFFICULTY));
            expect(r.draws.map((d) => d.kind)).toEqual(['NextDouble']);
            const n = Math.trunc(Math.trunc(level * (0.5 + r.draws[0].value)) / 100);
            expect(r.result.length).toBe(n);
            r.result.forEach((t, i) => expect(ordinalOk(t.name, before + i + 1, empire.troopDescription)).toBe(true));
            summary.colonyTroops.push(n);
        }

        // Maintenance: Empire.cs AnnualTroopMaintenance.
        const m = annualTroopMaintenance(empire);
        if (empire.troops.count > 0) expect(m).toBeGreaterThan(0);
        expect(annualTroopMaintenanceIncludeRecruiting(empire)).toBe(m); // nothing being recruited yet
        expect(calculateCostPerTroop(empire, TroopType.Infantry, capital, null)).toBeGreaterThan(0);
        summary.maintenance.push(m);

        // Start.2.cs 1324-1328 (galaxy age > 0).
        const p = recordRnd(galaxy, () => {
            for (const colony of empire.colonies) {
                processColonyTroops(galaxy, empire, colony, null, 0.0, 100.0, 100.0, DIFFICULTY);
                processColonyTroops(galaxy, empire, colony, null, 0.0, 300.0, 300.0, DIFFICULTY);
                processColonyTroops(galaxy, empire, colony, null, 0.0, 300.0, 300.0, DIFFICULTY);
            }
        });
        for (const d of p.draws) expect(d.kind).toBe('Next');
        summary.processDraws.push(p.draws.map((d) => `Next(${d.args.join(',')})=${d.value}`).join(' '));
        // Every troop name stays ordinal-consistent: _TroopCount == number of names generated.
        const all = [...empire.troops.items];
        const ordinals = all.map((t) => Number(/^(\d+)/.exec(t.name)![1])).sort((a, b) => a - b);
        expect(new Set(ordinals).size).toBe(ordinals.length);
        expect(ordinals.length === 0 || ordinals[ordinals.length - 1] === empire.troopCount).toBe(true);
    }
    registerTroopGeneralHook(null);
    return summary;
}

describe('troops (game start)', () => {
    it('garrisons, names, maintenance and ProcessColonyTroops on a seed-1 galaxy; deterministic', () => {
        const a = run(true);
        // Re-pinned by M4j (was [[1125, 843, 13], [1391, 1042, 6], [1604, 1203, 10], [605, 453, 8]]): GenerateEmpire's
        // Empire.DoTasks now grows the capitals' development level / growth (EvaluateColonyVariables), raising their
        // StrategicValue and so EstimatedDefensiveForceRequired.
        // Re-pinned again at the M4 wave-1 merge (M4k): the game-start Empire.DoTasks also runs PerformResearch, whose
        // research-queue selection and research events draw Rnd (and completed research changes troop types).
        // Re-pinned by M4s1: ReviewPirateRelations draws Rnd.NextDouble in each game-start Empire.DoTasks long block, so
        // the empires / garrison rolls move.
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        // (re-pinned M4u: game-start character reviews (ReviewCharacterTraits Rnd) and ReviewEmpireEvents (DoRaceEvent Rnd) move the empires / garrisons.)
        // (re-pinned M4m: the game-start Empire.DoTasks runs the military AI — IdentifyMilitaryObjectives Next(0, EmpireEvaluations.Count), CheckTemptingTargets Next(0, Empires.Count), DetermineRandomAttacks Next(0, n) — which shifts the Rnd stream.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        // Moved #1418521596 → #da0d5c8662: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved #da0d5c8662 → #2e28be26b3: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved #2e28be26b3 → #2b6f4f6d20: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(a.capitals.map((c) => [c.edfr, c.levelRequired, c.troops])).toMatchPin('troops.capitals');
        // Moved [12,10,13,2] → [4,9,12,4]: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved [4,9,12,4] → [8,10,9,6]: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved [8,10,9,6] → [5,6,16,3]: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(a.colonyTroops).toMatchPin('troops.colonyTroops');
        // Moved [24000,20700,24300,6300] → [11000,15300,11900,13500]: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved [11000,15300,11900,13500] → [14000,16200,7650,14400]: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved [14000,16200,7650,14400] → [6800,8100,14450,12600]: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(a.maintenance).toMatchPin('troops.maintenance');
        expect(a.processDraws).toMatchPin('troops.processDraws'); // garrisons already meet TroopLevelRequired
        expect(run(true)).toEqual(a);
    }, 120000);

    it('ProcessColonyTroops recruits under-garrisoned capitals (Rnd: Next(0,70) per completed recruit)', () => {
        const b = run(false);
        // (re-pinned at the M4 wave-1 merge: M4k PerformResearch at game start, see above)
        // (re-pinned M4s1: ReviewPirateRelations' game-start Rnd draw moves the empires / garrison rolls.)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        // (re-pinned M4u: game-start character reviews (ReviewCharacterTraits Rnd) and ReviewEmpireEvents (DoRaceEvent Rnd) move the empires / garrisons.)
        // (re-pinned M4m: the game-start Empire.DoTasks runs the military AI — IdentifyMilitaryObjectives Next(0, EmpireEvaluations.Count), CheckTemptingTargets Next(0, Empires.Count), DetermineRandomAttacks Next(0, n) — which shifts the Rnd stream.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        // Moved [12,12,13,5] → [7,0,2,6]: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved [7,0,2,6] → [6,7,8,5]: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved [6,7,8,5] → [3,2,1,2]: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(b.capitals.map((c) => c.troops)).toMatchPin('troops.recruitCapitalTroops');
        // Moved [12000,10800,11700,4500] → [7000,0,1700,5400]: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved [7000,0,1700,5400] → [6000,6300,6800,4500]: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved [6000,6300,6800,4500] → [2550,1800,850,1800]: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(b.maintenance).toMatchPin('troops.recruitMaintenance');
        // The under-garrisoned capitals recruit troops; each completion draws ChanceNewTroopGeneralFromRecruitment's
        // Next(0, 70 / race general-appearance chance).
        // Moved ["","","",""] → #edcbc03e8b: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved #edcbc03e8b → ["","","",""]: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved ["","","",""] → #c4769d44ed: SetupSun SelectHabitatPictures (Galaxy.5.cs 1323): star PictureRef/MapPictureRef draws (2026-10-04)
        expect(b.processDraws).toMatchPin('troops.recruitProcessDraws');
        // No roll is 1 → no Empire.GenerateNewCharacter(TroopGeneral) call.
        expect(b.troopGenerals.length).toMatchPin('troops.recruitTroopGenerals', 0);
        expect(run(false)).toEqual(b);
    }, 120000);
});
