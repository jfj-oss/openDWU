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
        expect(a.capitals.map((c) => [c.edfr, c.levelRequired, c.troops])).toEqual([[1125, 843, 13], [1391, 1042, 6], [1604, 1203, 10], [605, 453, 8]]);
        expect(a.colonyTroops).toEqual([8, 6, 6, 4]);
        expect(a.maintenance).toEqual([21000, 10800, 13600, 10800]);
        expect(a.processDraws).toEqual(['', '', '', '']); // garrisons already meet TroopLevelRequired
        expect(run(true)).toEqual(a);
    }, 120000);

    it('ProcessColonyTroops recruits under-garrisoned capitals (Rnd: Next(0,70) per completed recruit)', () => {
        const b = run(false);
        expect(b.capitals.map((c) => c.troops)).toEqual([13, 7, 6, 1]);
        expect(b.maintenance).toEqual([13000, 6300, 5100, 900]);
        // Empire 4 (1 troop, level 453) recruits two troops; each completion draws Next(0,70).
        expect(b.processDraws).toEqual(['', '', '', 'Next(0,70)=50 Next(0,70)=1']);
        // The second roll is 1 → Empire.GenerateNewCharacter(TroopGeneral) via the hook.
        expect(b.troopGenerals.length).toBe(1);
        expect(b.troopGenerals[0]).toMatch(/:3rd /);
        expect(run(false)).toEqual(b);
    }, 120000);
});
