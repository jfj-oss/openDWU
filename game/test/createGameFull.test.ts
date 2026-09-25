import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { TroopType } from '../src/sim/cargo';
import { empireGovernmentAttributes, type Empire } from '../src/sim/empire';
import { annualTroopMaintenance } from '../src/sim/troops';
import { TROOP_ANNUAL_MAINTENANCE, annualStateMaintenance } from '../src/sim/forceStructure';
import { getEmpireCharacters } from '../src/sim/characters';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';

// The full Start.2.cs CreateGameFromSettings sequence as createGame runs it (starting colonies,
// price reviews, first galaxy tick with independent traders + pirate factions, per-empire space
// ports / stations / ruins / taxes / troops, starting ships, diplomacy, characters, the near-player
// pirate, ruins and the game-start tail): a summary of the resulting game-start state.
let gameData: GameData;
beforeAll(async () => { gameData = await loadGameDataFs(); }, 60000);

function opts(techLevel: number, age: number): CreateGameOptions {
    const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age, techLevel });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)'), s('(Random)')],
        piratePrevalence: 1.0,
    };
}

const S = BuiltObjectSubRole;
const PORTS = new Set([S.SmallSpacePort, S.MediumSpacePort, S.LargeSpacePort]);
const RESEARCH = new Set([S.WeaponsResearchStation, S.EnergyResearchStation, S.HighTechResearchStation]);
const MINING = new Set([S.MiningStation, S.GasMiningStation]);

function countBySubRole(list: BuiltObject[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const b of list) out[S[b.subRole]] = (out[S[b.subRole]] ?? 0) + 1;
    return out;
}

function empireSummary(e: Empire) {
    const ships = (list: BuiltObject[]) => list.filter((b) => !PORTS.has(b.subRole) && !RESEARCH.has(b.subRole) && !MINING.has(b.subRole));
    return {
        name: e.name,
        race: e.dominantRace!.name,
        colonies: e.colonies.length,
        spacePorts: e.builtObjects.filter((b) => PORTS.has(b.subRole)).length,
        researchStations: e.builtObjects.filter((b) => RESEARCH.has(b.subRole)).length,
        miningStations: e.privateBuiltObjects.filter((b) => MINING.has(b.subRole)).length,
        stateShips: countBySubRole(ships(e.builtObjects)),
        privateShips: countBySubRole(ships(e.privateBuiltObjects)),
        troops: e.troops.count,
        characters: getEmpireCharacters(e).length,
        taxRates: e.colonies.map((c) => c.taxRate),
    };
}

function summary(g: Galaxy) {
    const empires = g.empires.filter((e) => e.pirateEmpireBaseHabitat === null);
    const ind = g.independentEmpire!;
    return {
        empires: empires.map(empireSummary),
        pirates: g.pirateEmpires.map((p) => ({
            name: p.name,
            bases: p.builtObjects.filter((b) => PORTS.has(b.subRole) || b.subRole === S.GenericBase).length,
            fleet: countBySubRole(p.builtObjects.filter((b) => !PORTS.has(b.subRole) && b.subRole !== S.GenericBase && b.subRole !== S.DefensiveBase)),
            private: countBySubRole(p.privateBuiltObjects),
            characters: getEmpireCharacters(p).length,
        })),
        independentTraders: ind.privateBuiltObjects.filter((b) => b.subRole === S.SmallFreighter || b.subRole === S.MediumFreighter).length,
        unownedBuiltObjects: g.builtObjects.filter((b) => b.empire === null).length,
        builtObjects: g.builtObjects.length,
        ruins: g.ruinCount,
    };
}

// A cheap fingerprint of the whole galaxy for determinism checks.
function fingerprint(g: Galaxy) {
    return {
        summary: summary(g),
        objects: g.builtObjects.map((b) => [b.builtObjectID, b.empire?.name ?? null, S[b.subRole], b.name, b.xpos, b.ypos]),
        characters: g.empires.map((e) => getEmpireCharacters(e).map((c) => `${c.role}:${c.name}:${c.location?.name ?? ''}`)),
        ruins: g.habitats.filter((h) => h.ruin !== null).map((h) => `${h.name}:${h.ruin!.name}`),
        rnd: JSON.stringify(g.rnd),
    };
}

describe('createGame full game start (seed 1, Spiral 300 stars, 8x8, Human + 3 AIs, pirates 1.0)', () => {
    it('techLevel 0.5, age 1: pinned game-start summary; deterministic', () => {
        const g = createGame(opts(0.5, 1)).galaxy;
        const a = summary(g);
        // Pinned for seed 1 (TS port).
        expect(a).toEqual(PINNED_SUMMARY);
        // Every normal empire: a space port at the capital, ships, troops and a leader.
        for (const e of g.empires.filter((x) => x.pirateEmpireBaseHabitat === null)) {
            expect(e.spacePorts.length).toBeGreaterThan(0);
            expect(e.leader).not.toBeNull();
            // Empire.cs AnnualTroopMaintenance (2025) with the leader's TroopMaintenance skill
            // (characters exist now; no colony / ship characters have TroopMaintenance bonuses known).
            const gov = empireGovernmentAttributes(e);
            const num2 = 1.0 + e.leader!.troopMaintenance / 100.0;
            let expected = 0.0;
            for (const t of e.troops.items) {
                if (t.type === TroopType.PirateRaider || t.beingRecruited) continue;
                let num3 = TROOP_ANNUAL_MAINTENANCE * t.maintenanceMultiplier * e.troopMaintenanceFactor;
                if (gov !== null) num3 *= gov.maintenanceCosts;
                expected += num3 / num2;
            }
            expect(annualTroopMaintenance(e)).toBeCloseTo(expected, 9);
            // BuiltObject.AnnualSupportCost (BuiltObject.cs 782): every state ship/base costs upkeep.
            expect(Number.isFinite(annualStateMaintenance(e))).toBe(true);
            expect(annualStateMaintenance(e)).toBeGreaterThan(0);
        }
        for (const p of g.pirateEmpires) expect(p.leader).not.toBeNull();
        expect(fingerprint(createGame(opts(0.5, 1)).galaxy)).toEqual(fingerprint(g));
    }, 120000);

    it('techLevel 0, age 0: runs without throwing; deterministic', () => {
        const a = fingerprint(createGame(opts(0, 0)).galaxy);
        expect(a.summary.empires.length).toBe(4);
        for (const e of a.summary.empires) {
            // Pre-warp start: no space ports / stations / starting ships (Start.2.cs 1138, 1308, 1314, 1367).
            expect(e.spacePorts).toBe(0);
            expect(e.researchStations).toBe(0);
            expect(e.miningStations).toBe(0);
            expect(e.stateShips).toEqual({});
            expect(e.characters).toBeGreaterThan(0);
        }
        expect(fingerprint(createGame(opts(0, 0)).galaxy)).toEqual(a);
    }, 120000);

    it('techLevel 0.5, age 2: runs without throwing (several colonies per empire); deterministic', () => {
        const a = fingerprint(createGame(opts(0.5, 2)).galaxy);
        expect(a.summary.empires.length).toBe(4);
        expect(a.summary.empires.some((e) => e.colonies > 1)).toBe(true);
        for (const e of a.summary.empires) expect(e.spacePorts).toBe(1 + Math.trunc(e.colonies / 4.5));
        expect(fingerprint(createGame(opts(0.5, 2)).galaxy)).toEqual(a);
    }, 120000);

    it('galaxy age 1 (Start.2.cs int_5 > 0: ProcessColonyTroops + second empire DoTasks): runs; deterministic', () => {
        const o = (): CreateGameOptions => ({ ...opts(0.5, 1), galaxyAge: 1 });
        const g = createGame(o()).galaxy;
        for (const e of g.empires.filter((x) => x.pirateEmpireBaseHabitat === null)) expect(Number.isFinite(annualStateMaintenance(e))).toBe(true);
        expect(fingerprint(createGame(o()).galaxy)).toEqual(fingerprint(g));
    }, 120000);
});

// Seed 1, techLevel 0.5, age 1, piratePrevalence 1.0 (TS port). Tax rates are C# floats.
// Re-pinned at the M4 wave-1 merge: the game-start Empire.DoTasks now runs PerformResearch (M4k: queue picks and
// research-event rolls draw Rnd, completed research changes components / troop types) and EvaluateColonyVariables /
// ProcessColonyTroops recruitment (M4j), so every later Rnd consumer (names, pirates, placement) shifts.
// Re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in every game-start Empire long block and the Galaxy long
// block's independent-colony pirate offers draw per colony (IndependentColoniesMake{Smuggling,Defend}OffersToPirates).
// (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
// Re-pinned M4u: the game-start Empire.DoTasks runs the character reviews (ReviewCharacterTraits / ApplyCharacterLocationBonus Rnd) and ReviewEmpireEvents (DoRaceEvent Rnd); empire placement, names and pirates shift.
// Re-pinned M4f: game-start AssignMissionsToBuiltObjectList draws move the empire-placement / ruins stream.
// (Merge of M4f onto M4u/M4o/M4l: re-pinned once against the combined code.)
// Re-pinned M4x: galaxyAge now defaults to 1 (standard preset, Start.cs 3298-3327). Before M4x these pins had Galaxy.Age 0
// with StartingAge 1 (a mix the C# cannot produce); Galaxy.Age 1 adds military starting ships, the int_5 > 0 game-start
// steps and StartStarDate + 30000000, so the Rnd stream moves.
// (re-pinned M4m: the game-start Empire.DoTasks runs the military AI — IdentifyMilitaryObjectives Next(0, EmpireEvaluations.Count), CheckTemptingTargets Next(0, Empires.Count), DetermineRandomAttacks Next(0, n) — which shifts the Rnd stream.)
const PINNED_SUMMARY: unknown = {
    "empires": [
        {
            "name": "Sol Commonwealth",
            "race": "Human",
            "colonies": 1,
            "spacePorts": 1,
            "researchStations": 1,
            "miningStations": 6,
            "stateShips": {
                "Escort": 2,
                "Frigate": 2,
                "Destroyer": 2,
                "ExplorationShip": 5,
                "ConstructionShip": 2
            },
            "privateShips": {
                "SmallFreighter": 1,
                "GasMiningShip": 2,
                "MiningShip": 2
            },
            "troops": 11,
            "characters": 3,
            "taxRates": [
                0.30000001192092896
            ]
        },
        {
            "name": "Haakonish Corporation",
            "race": "Haakonish",
            "colonies": 1,
            "spacePorts": 1,
            "researchStations": 1,
            "miningStations": 6,
            "stateShips": {
                "Escort": 4,
                "Frigate": 5,
                "ExplorationShip": 7,
                "ConstructionShip": 3
            },
            "privateShips": {
                "SmallFreighter": 1,
                "GasMiningShip": 2,
                "MiningShip": 2
            },
            "troops": 5,
            "characters": 3,
            "taxRates": [
                0.2800000011920929
            ]
        },
        {
            "name": "Dhayut Nation",
            "race": "Dhayut",
            "colonies": 1,
            "spacePorts": 1,
            "researchStations": 1,
            "miningStations": 6,
            "stateShips": {
                "Escort": 2,
                "Frigate": 4,
                "ExplorationShip": 4,
                "ConstructionShip": 1
            },
            "privateShips": {
                "SmallFreighter": 1,
                "GasMiningShip": 2,
                "MiningShip": 2
            },
            "troops": 5,
            "characters": 3,
            "taxRates": [
                0.2199999988079071
            ]
        },
        {
            "name": "Free Ugnari Consortium",
            "race": "Ugnari",
            "colonies": 1,
            "spacePorts": 1,
            "researchStations": 1,
            "miningStations": 6,
            "stateShips": {
                "Escort": 3,
                "Frigate": 3,
                "Destroyer": 3,
                "ExplorationShip": 7,
                "ConstructionShip": 3
            },
            "privateShips": {
                "SmallFreighter": 1,
                "GasMiningShip": 2,
                "MiningShip": 2
            },
            "troops": 5,
            "characters": 2,
            "taxRates": [
                0.3199999928474426
            ]
        }
    ],
    "pirates": [
        {
            "name": "Dread Force",
            "bases": 1,
            "fleet": {
                "Escort": 1,
                "ExplorationShip": 1,
                "ConstructionShip": 1
            },
            "private": {
                "SmallFreighter": 2,
                "MiningShip": 1,
                "GasMiningShip": 1,
                "GasMiningStation": 2
            },
            "characters": 2
        },
        {
            "name": "Red Storm Gang",
            "bases": 1,
            "fleet": {
                "Escort": 1,
                "ExplorationShip": 1,
                "ConstructionShip": 1
            },
            "private": {
                "SmallFreighter": 1,
                "MiningShip": 1,
                "GasMiningShip": 1,
                "GasMiningStation": 2
            },
            "characters": 2
        },
        {
            "name": "Fierce Company",
            "bases": 1,
            "fleet": {
                "ExplorationShip": 1,
                "ConstructionShip": 1
            },
            "private": {
                "SmallFreighter": 4,
                "MiningShip": 1,
                "GasMiningShip": 1,
                "GasMiningStation": 3
            },
            "characters": 2
        },
        {
            "name": "Ugnar Pillagers",
            "bases": 1,
            "fleet": {
                "Escort": 2,
                "ConstructionShip": 1
            },
            "private": {
                "SmallFreighter": 1,
                "GasMiningStation": 1
            },
            "characters": 2
        },
        {
            "name": "Dirty Prowlers",
            "bases": 1,
            "fleet": {
                "Escort": 1,
                "ExplorationShip": 1,
                "ConstructionShip": 1
            },
            "private": {
                "SmallFreighter": 1,
                "MiningShip": 1,
                "GasMiningShip": 1,
                "GasMiningStation": 2
            },
            "characters": 2
        },
        {
            "name": "Deadly Buccaneers",
            "bases": 1,
            "fleet": {
                "Escort": 1,
                "ExplorationShip": 1,
                "ConstructionShip": 1
            },
            "private": {
                "SmallFreighter": 1,
                "MiningShip": 1,
                "GasMiningShip": 1,
                "GasMiningStation": 2
            },
            "characters": 2
        },
        {
            "name": "Dread Star Authority",
            "bases": 1,
            "fleet": {
                "Escort": 1,
                "ExplorationShip": 1,
                "ConstructionShip": 1
            },
            "private": {
                "SmallFreighter": 2,
                "MiningShip": 1,
                "GasMiningShip": 1,
                "GasMiningStation": 1,
                "MiningStation": 1
            },
            "characters": 2
        },
        {
            "name": "Red Rock Bandits",
            "bases": 1,
            "fleet": {
                "Escort": 1,
                "ExplorationShip": 1,
                "ConstructionShip": 1
            },
            "private": {
                "SmallFreighter": 1,
                "MiningShip": 1,
                "GasMiningShip": 1,
                "MiningStation": 2
            },
            "characters": 3
        }
    ],
    "independentTraders": 150,
    "unownedBuiltObjects": 20,
    "builtObjects": 358,
    "ruins": 24
};
