// Port of DistantWorlds.Types.Population (Population.cs) and
// DistantWorlds.Types.PopulationList (PopulationList.cs), limited to the
// members used by Galaxy generation: the Population(Race, long) ctor, the
// Amount/UnassimilatedAmount/GrowthRate properties, and
// PopulationList.Add / RecalculateTotalAmount. The serialization members
// (ISerializable/GetObjectData) and IComparable are omitted (out of scope).

import type { Race } from './data/races';

// Port of Population.cs (fields _Race/_Amount/_UnassimilatedAmount/
// _GrowthRate; ctor Population(Race race, long amount)). C# long is 64-bit;
// JS numbers are exact integers up to 2^53, which covers every population
// amount this game generates (quality <= 1 * 1000 * 1.5 * < 600000 * 1.2^age).
export class Population {
    race: Race;
    amount = 0; // C#: long _Amount
    unassimilatedAmount = 0; // C#: long _UnassimilatedAmount
    growthRate = 0; // C#: float _GrowthRate

    constructor(race?: Race, amount?: number) {
        if (race !== undefined && amount !== undefined) {
            this.race = race;
            this.amount = amount;
            // C#: this._GrowthRate = (float) race.ReproductiveRate;
            this.growthRate = Math.fround(race.reproductionRate);
        } else {
            this.race = race as Race;
        }
    }

    // Port of Population.cs CompareTo (IComparable<Population>).
    compareTo(other: Population): number {
        return this.amount < other.amount ? -1 : this.amount > other.amount ? 1 : 0;
    }
}

// Port of PopulationList.cs (a List<Population> wrapper exposing
// RecalculateTotalAmount). Only the members used by generation are ported.
export class PopulationList {
    items: Population[] = [];
    totalAmount = 0; // C#: long TotalAmount (kept in sync by Add/Remove/RecalculateTotalAmount)

    add(population: Population): void {
        this.items.push(population);
        this.totalAmount += population.amount;
    }

    remove(population: Population): boolean {
        const index = this.items.indexOf(population);
        if (index < 0) {
            return false;
        }
        this.items.splice(index, 1);
        this.totalAmount -= population.amount;
        return true;
    }

    // Port of PopulationList.cs RecalculateTotalAmount: TotalAmount = sum of
    // each population's Amount.
    recalculateTotalAmount(): void {
        let total = 0;
        for (const population of this.items) {
            total += population.amount;
        }
        this.totalAmount = total;
    }
}