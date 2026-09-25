// Standard race bias (cycle-free). Ports of
//   Galaxy.cs ResolveStandardRaceBias (2086), the per-race RaceBiasList that
//   Galaxy.cs LoadRaceBiases (1967) builds (RaceBiasList.cs LoadBiases / GetBias), and
//   RaceFamilyBiasList.cs LoadFromFile / GetBias (Galaxy.RaceFamiliesStatic[..].Biases).
// No Galaxy.Rnd.
//
// C# keeps these as statics (Race.Biases on the loaded RaceList, Galaxy.RaceFamiliesStatic);
// createGame registers the parsed tables with setRaceBiasesStatic, like setGovernmentsStatic.

import type { Race } from './data/races';
import type { BiasMatrix } from './data/biases';

interface RaceBiasesStatic {
    races: Race[];
    raceBiases: BiasMatrix;
    raceFamilyCount: number;
    raceFamilyBiases: BiasMatrix;
}
let raceBiasesStatic: RaceBiasesStatic | null = null;
/**
 * M4z3: RaceBiasList.SetBias (RaceBiasList.cs 50) writes into Race.Biases (ExecuteEventAction ChangeRaceBias). The TS derives
 * Race.Biases from the static matrix on every read, so written values are kept here per race, keyed by the other race's
 * name, and win over the matrix value. Reset with the static tables. TODO(port): not written to saves (C# serializes the
 * Galaxy's RaceList with the game).
 */
let raceBiasOverrides = new Map<Race, Map<string, number>>();

export function setRaceBiasesStatic(races: Race[], raceBiases: BiasMatrix, raceFamilyCount: number, raceFamilyBiases: BiasMatrix): void {
    raceBiasesStatic = { races, raceBiases, raceFamilyCount, raceFamilyBiases };
    raceBiasOverrides = new Map();
}

// Race.Biases after Galaxy.cs LoadRaceBiases (2049-2069): null when not Populated.
// Keys are races[k].Name in RaceList order, values list5[k].
function raceBiasList(s: RaceBiasesStatic, race: Race): { key: string; value: number }[] | null {
    const list2 = s.raceBiases.names; // file row names, file order
    const list = s.raceBiases.matrix; // file rows
    const num5 = list2.indexOf(race.name);
    if (num5 < 0 || num5 >= list.length || list[num5] === undefined) return null;
    const row = list[num5];
    const list5: number[] = [];
    for (let j = 0; j < row.length; j++) list5.push(0);
    for (let k = 0; k < row.length; k++) {
        // C# indexes races[k] for k < row.Count (the loader throws if a row exceeds races.Count).
        const num6 = list2.indexOf(s.races[k].name);
        if (num6 >= 0 && num6 < row.length) list5[k] = row[num6];
    }
    // RaceBiasList.LoadBiases: only Populated when races.Count == biases.Count.
    if (s.races.length !== list5.length) return null;
    const overrides = raceBiasOverrides.get(race);
    return s.races.map((r, index) => ({ key: r.name, value: overrides?.get(r.name) ?? list5[index] }));
}

/** RaceBiasList.cs 38 Race.Biases.GetBias(race): 0 for a null race or a race without a populated list. No Rnd. */
export function raceBiasesGetBias(race: Race, otherRace: Race | null): number {
    if (otherRace === null) return 0;
    const s = raceBiasesStatic;
    if (s === null) throw new Error('raceBiasesGetBias: setRaceBiasesStatic was not called');
    const biases = raceBiasList(s, race);
    if (biases === null) return 0;
    for (const b of biases) if (b.key === otherRace.name) return b.value;
    return 0;
}

/** RaceBiasList.cs 50 Race.Biases.SetBias(raceName, value): only replaces an existing key (unpopulated list: no-op). No Rnd. */
export function raceBiasesSetBias(race: Race, raceName: string, value: number): void {
    const s = raceBiasesStatic;
    if (s === null) throw new Error('raceBiasesSetBias: setRaceBiasesStatic was not called');
    const biases = raceBiasList(s, race);
    if (biases === null || !biases.some((b) => b.key === raceName)) return;
    let m = raceBiasOverrides.get(race);
    if (m === undefined) {
        m = new Map();
        raceBiasOverrides.set(race, m);
    }
    m.set(raceName, value);
}

// Galaxy.cs ResolveStandardRaceBias(race, otherRace) (2086).
export function resolveStandardRaceBias(race: Race | null, otherRace: Race | null): number {
    const result = 0.0;
    if (race != null && otherRace != null) {
        const s = raceBiasesStatic;
        if (s === null) throw new Error('resolveStandardRaceBias: setRaceBiasesStatic was not called');
        const biases = raceBiasList(s, race);
        if (biases !== null) {
            // RaceBiasList.GetBias(Race) → GetBias(race.Name): first matching key.
            for (const b of biases) if (b.key === otherRace.name) return b.value;
            return 0;
        }
        if (race.raceFamily >= 0 && race.raceFamily < s.raceFamilyCount) {
            // RaceFamilyBiasList.LoadFromFile stores every pair as (rowFamilyId, value)
            // (`new KeyValuePair<int,int>(result1, intList[index])`), so GetBias(id) returns
            // the row's first value when id is the row's own family id, else 0.
            const row = s.raceFamilyBiases.matrix[race.raceFamily];
            if (row !== undefined && row.length > 0 && otherRace.raceFamily === race.raceFamily) return row[0];
            return 0;
        }
    }
    return result;
}
