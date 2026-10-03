import { beforeAll, describe, expect, it } from 'vitest';

// Task M3f — Galaxy.8.cs GenerateSuperPirateFaction (3984) with its design pipeline:
// Empire.10.cs GenerateDesignFromSpec (3387), GenerateSuperPirate(Defensive)BaseDesign
// (3937/3963), Get*Components (3760/3853), AddComponentsToDesign (2320),
// UpgradeMilitaryShipDesignMoreEngines/MoreWeapons (4206/4121).
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { setGovernmentsStatic } from '../src/sim/empire';
import { GalaxyShape, HabitatCategoryType, type Habitat } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import {
    generateSuperPirateFaction,
    resolveSuperPirateShipImageIndex,
    upgradeMilitaryShipDesignMoreEngines,
    upgradeMilitaryShipDesignMoreWeapons,
} from '../src/sim/pirates';
import { Design } from '../src/sim/design';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { startStarDateForAge } from '../src/sim/galaxyTime';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function opts(): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0.5 },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
        piratePrevalence: 1.0,
    };
}

function spyRnd(g: Galaxy): { k: string; v: number }[] {
    const log: { k: string; v: number }[] = [];
    const rnd = g.rnd as unknown as { next: (...a: number[]) => number; nextDouble: () => number };
    const next = rnd.next.bind(rnd);
    const nextDouble = rnd.nextDouble.bind(rnd);
    rnd.next = (...a: number[]) => { const v = next(...a); log.push({ k: 'n' + a.join(','), v }); return v; };
    rnd.nextDouble = () => { const v = nextDouble(); log.push({ k: 'd', v }); return v; };
    return log;
}

function run() {
    const g = createGame(opts()).galaxy;
    const fuel = g.resourceSystem.fuelResources[0].resourceId;
    const home = g.habitats.find((x) => x.category !== HabitatCategoryType.GasCloud && x.category !== HabitatCategoryType.Star && x.empire === null && x.basesAtHabitat.length === 0 && x.resources.some((r) => r.resourceId === fuel)) as Habitat;
    const independent = g.habitats.filter((x) => x.empire === g.independentEmpire && x.population.totalAmount > 0);
    const log = spyRnd(g);
    const p = generateSuperPirateFaction(g, { independentColonies: independent, startingAge: 1, difficultyLevel: 1.0 }, home, 'Deadly Phantoms', null, 4);
    return { g, p, home, log };
}

const S = BuiltObjectSubRole;
const SHIP_ROLES = [S.Escort, S.Frigate, S.Destroyer, S.Cruiser, S.CapitalShip, S.Carrier];

describe('generateSuperPirateFaction (seed 1, createGame, tech 4)', () => {
    it('adds the faction with 8 designs, the Phantom base, 3 defensive bases and 20-29 warships', () => {
        const { g, p, home, log } = run();
        expect(p.pirateEmpireSuperPirates).toBe(true);
        expect(g.pirateEmpires).toContain(p);
        expect(p.pirateEmpireBaseHabitat).toBe(home);
        // Designs: the 8 super-pirate designs are appended after CreateNewDesigns' own.
        const sp = (p.designs as Design[]).slice(-8);
        expect(sp.map((d) => d.subRole)).toEqual([...SHIP_ROLES, S.DefensiveBase, S.GenericBase]);
        expect(sp.map((d) => d.pictureRef)).toEqual([64, 65, 66, 67, 68, 69, 70, 71]);
        expect(sp.map((d) => resolveSuperPirateShipImageIndex(d.subRole))).toEqual([64, 65, 66, 67, 68, 69, 70, 71]);
        expect(sp[6].name).toBe('Phantom Pirate Defensive Base');
        expect(sp[7].name).toBe('Phantom Pirate Base');
        const sd = startStarDateForAge(g.age);
        for (const d of sp) expect(d.dateCreated).toBe(sd);
        for (const d of sp.slice(0, 6)) expect(d.empire).toBe(p);
        expect(sp[6].empire).toBeNull();
        expect(sp[7].empire).toBeNull();
        // Tech 4 designs: every component evaluated at tech level <= 4 (EvaluateLatest).
        for (const d of sp) for (const c of d.components) expect(c.techLevel).toBeLessThanOrEqual(4);
        // UpgradeMilitaryShipDesignMoreWeapons minimum beam counts (Galaxy.8.cs 4130-4166).
        const minBeams = [3, 5, 6, 10, 16, 4];
        sp.slice(0, 6).forEach((d, i) => {
            const beams = d.components.filter((c) => c.category === ComponentCategoryType.WeaponBeam).length;
            if (beams > 0) expect(beams).toBeGreaterThanOrEqual(minBeams[i]);
        });
        // Base designs: AddComponentsToDesign components (30 armor on the base, 15 on defensive).
        expect(sp[7].components.filter((c) => c.type === ComponentType.Armor).length).toBe(30);
        expect(sp[6].components.filter((c) => c.type === ComponentType.Armor).length).toBe(15);
        expect(sp[7].components.filter((c) => c.type === ComponentType.HabitationHabModule).length).toBeGreaterThan(0);

        // BuiltObjects: base, 3 defensive bases, then the warships.
        const bos = p.builtObjects;
        expect(bos[0].subRole).toBe(S.GenericBase);
        expect(bos[0].design).toBe(sp[7]);
        expect(bos[0].parentHabitat).toBe(home);
        expect(bos.slice(1, 4).map((b) => b.subRole)).toEqual([S.DefensiveBase, S.DefensiveBase, S.DefensiveBase]);
        for (const b of bos.slice(0, 4)) {
            expect(home.basesAtHabitat).toContain(b);
            expect(b.empire).toBe(p);
        }
        expect(sp[7].buildCount).toBe(1);
        expect(sp[6].buildCount).toBe(3);
        const iWar = log.findIndex((e) => e.k === 'n20,30');
        const warships = log[iWar].v;
        expect(warships).toBeGreaterThanOrEqual(20);
        expect(warships).toBeLessThan(30);
        expect(bos.length).toBe(4 + warships);
        for (const b of bos.slice(4)) {
            expect(SHIP_ROLES).toContain(b.subRole);
            expect(b.parentHabitat).toBe(home);
        }
        expect(sp.slice(0, 6).reduce((n, d) => n + d.buildCount, 0)).toBe(warships);
    }, 60000);

    it('Rnd: base name + heading, 3 × (defensive name, heading, orbital location), Next(20,30), 7 draws per warship', () => {
        const { log } = run();
        const iWar = log.findIndex((e) => e.k === 'n20,30');
        const warships = log[iWar].v;
        // Warships: Next(0,25) type, SelectRandomUniqueMilitaryShipName (Next(0,76), Next(0,162),
        // Next(0,5)), heading NextDouble, AddBuiltObjectToGalaxy offset NextDouble × 2.
        for (let w = 0; w < warships; w++) {
            expect(log.slice(iWar + 1 + 7 * w, iWar + 8 + 7 * w).map((e) => e.k)).toEqual(['n0,25', 'n0,76', 'n0,162', 'n0,5', 'd', 'd', 'd']);
        }
        expect(log.length).toBe(iWar + 1 + 7 * warships);
        // Walk forward from the base name: GeneratePirateBaseName Next(0,13), Next(0,20),
        // [Next(0,4) (+ Next(0,20) on 1) unless a gas cloud], heading NextDouble.
        let i = log.findIndex((e, k) => e.k === 'n0,13' && log[k + 1]?.k === 'n0,20' && k > log.length - 7 * warships - 40);
        expect(i).toBeGreaterThan(0);
        i += 2;
        if (log[i].k === 'n0,4') {
            i++;
            if (log[i - 1].v === 1) expect(log[i++].k).toBe('n0,20');
        }
        expect(log[i++].k).toBe('d');
        // Defensive bases: SelectUniqueBuiltObjectName Next(0,4) (defensive-base array), heading,
        // DetermineOrbitalBaseLocation (NextDouble, Next(0,2), NextDouble per attempt).
        for (let b = 0; b < 3; b++) {
            expect(log[i++].k).toBe('n0,4');
            expect(log[i++].k).toBe('d');
            let attempts = 0;
            while (log[i].k === 'd' && log[i + 1].k === 'n0,2' && log[i + 2].k === 'd') {
                i += 3;
                attempts++;
            }
            expect(attempts).toBeGreaterThanOrEqual(1);
        }
        expect(i).toBe(iWar);
    }, 60000);

    it('Rnd before the base: design pipeline draws only in GenerateDesignName (seed 1: one Next(0,36))', () => {
        const { log } = run();
        const iWar = log.findIndex((e) => e.k === 'n20,30');
        const iBase = log.slice(0, iWar).map((e) => e.k).lastIndexOf('n0,13');
        // Race: SelectRandomPirateRace Next(0, count); SelectRelativeHabitatSurfacePoint (2).
        expect(log[0].k.startsWith('n0,')).toBe(true);
        expect(log.slice(1, 3).map((e) => e.k)).toEqual(['d', 'd']);
        // The last draw before the base name is the CapitalShip's new proper design name.
        expect(log[iBase - 1].k).toBe('n0,36');
    }, 60000);

    it('is deterministic (pinned names)', () => {
        const fp = () => {
            const { p } = run();
            return [
                (p.designs as Design[]).slice(-8).map((d) => `${S[d.subRole]}:${d.name}:${d.components.length}`),
                p.builtObjects.slice(0, 8).map((b) => `${S[b.subRole]}:${b.name}`),
                p.builtObjects.length,
            ];
        };
        const a = fp();
        expect(fp()).toEqual(a);
        // Seed 1: [super-pirate designs (subRole:name:component count), first 8 BuiltObjects, BuiltObject count].
        // (re-pinned: generateSuperPirateFaction now runs on the full createGame state — stations, starting
        // ships, characters, ruins and the game-start tail consumed Rnd and changed the tech/design inputs.)
        // (re-pinned M4k: the game-start Empire.DoTasks now runs PerformResearch — SelectNextResearchProject draws
        // Rnd (SelectRandomLowestProject) and research events draw Next(0, num4) per industry — so later game-start
        // Rnd draws shift.)
        // (re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in every game-start Empire long block and the Galaxy long
        // block's independent-colony pirate offers draw per colony, so later game-start draws shift.)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        // (re-pinned M4u: game-start character reviews (ReviewCharacterTraits Rnd) and ReviewEmpireEvents (DoRaceEvent Rnd) move the stream before the super-pirate generation.)
        // (re-pinned M4f: Start.2.cs 1373 AssignMissionsToBuiltObjectList draws per idle ship at game start shift every later draw)
        // (Merge of M4f onto M4u/M4o/M4l: re-pinned once against the combined code.)
        // Re-pinned M4x: galaxyAge now defaults to 1 (standard preset, Start.cs 3298-3327). Before M4x these pins had Galaxy.Age 0
        // with StartingAge 1 (a mix the C# cannot produce); Galaxy.Age 1 adds military starting ships, the int_5 > 0 game-start
        // steps and StartStarDate + 30000000, so the Rnd stream moves.
        // (re-pinned M4m: the game-start Empire.DoTasks runs the military AI — IdentifyMilitaryObjectives Next(0, EmpireEvaluations.Count), CheckTemptingTargets Next(0, Empires.Count), DetermineRandomAttacks Next(0, n) — which shifts the Rnd stream.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        // (re-pinned M4z6: the game-start EvaluateColonyVariables colony orders (Empire.4.cs 2357 / 3186) shift the Rnd stream
        // before the super-pirate generation.)
        // Moved #e022079545 → #cceb332a00: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved #cceb332a00 → #f4b98fffc3: sweep 2: Habitat.DoTasks on generated planets/moons (Galaxy.8.cs 215-551, Galaxy.5.cs 1587/1731; Habitat.cs 1399) with the Habitat ctor LastTouch = now - 30 s (Habitat.cs 6297-6303: orbits advance 30 s more); BaconMain.cs 700-715 queues ProcessEmpireScienceShips (Galaxy.Rnd.Next(26, 35) at BaconInitialize) and BaconGalaxy.cs 322-329 / BaconEmpire.cs 170-275 ProcessScienceShips; Start.2.cs 508-509 ColonizationRange(EnforceLimit) and Galaxy.BaseTechCost plumbed (defaults unchanged) (2026-09-26)
        // Moved #f4b98fffc3 → #3d8cd96269: BaconMain.cs 686-697 BaconInitialize queues the SaveStats delayed action (1 day; BaconGalaxy.cs 319 re-queues it every statSaveIntervalInGameDays) and BaconMain.cs 1069/1075-1087 AddOtherDelayedEvents queues ClearShipsAboutToBeDestroyed with Galaxy.Rnd.Next(10, 12) after the 700-715 science-ship Next(26, 35) (2026-09-26)
        // Moved #3d8cd96269 → #6a2ed05cf6: per-empire/race ship naming styles (shipNameStyle.ts deviation): registry prefixes + race word lists; name strings only, Rnd draws unchanged (2026-10-01)
        // Moved #6a2ed05cf6 → #6df472ecb9: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        expect(a).toMatchPin('superPirates.faction');
    }, 60000);
});

describe('UpgradeMilitaryShipDesignMoreWeapons / MoreEngines (Galaxy.8.cs 4121 / 4206)', () => {
    it('tops up beams/torpedoes/point defense by sub-role and adds at most one engine of each kind', () => {
        const { g } = run();
        const defs = g.researchStatic!.componentStatic!.definitions;
        const beam = defs.find((c) => c.category === ComponentCategoryType.WeaponBeam)!;
        const torp = defs.find((c) => c.category === ComponentCategoryType.WeaponTorpedo)!;
        const main = defs.find((c) => c.type === ComponentType.EngineMainThrust)!;
        const vec = defs.find((c) => c.type === ComponentType.EngineVectoring)!;
        const d = new Design('x');
        d.subRole = S.Cruiser;
        d.components.push(beam, torp, main, vec);
        upgradeMilitaryShipDesignMoreWeapons(d);
        expect(d.components.filter((c) => c === beam).length).toBe(10);
        expect(d.components.filter((c) => c === torp).length).toBe(4);
        expect(d.components.filter((c) => c.category === ComponentCategoryType.WeaponPointDefense).length).toBe(0); // no PD to copy
        upgradeMilitaryShipDesignMoreEngines(d);
        upgradeMilitaryShipDesignMoreEngines(d);
        expect(d.components.filter((c) => c === main).length).toBe(3);
        expect(d.components.filter((c) => c === vec).length).toBe(3); // Cruiser: 3 vectoring max
        upgradeMilitaryShipDesignMoreEngines(d);
        expect(d.components.filter((c) => c === vec).length).toBe(3);
        expect(upgradeMilitaryShipDesignMoreWeapons(null)).toBeNull();
    }, 60000);
});
