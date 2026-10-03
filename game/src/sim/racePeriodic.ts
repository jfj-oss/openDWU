// Race periodic personality (Race.cs 111-123, 306-400): races with a PeriodicChangeInterval (Dhayut, Gizurean, Securan)
// switch to their PeriodicFactors* levels for PeriodicChangeLength years every interval (Galaxy.cs 3425
// ReviewRacePeriodicChanges, colonyTick.ts reviewRacePeriodicChanges). The C# Race properties ReproductiveRate /
// AggressionLevel / CautionLevel / FriendlinessLevel return the periodic values while ChangePeriodActive; every sim read
// of them goes through the accessors here (only Galaxy.cs 3501-3529 reads the *Original values).
// ChangePeriodActive is kept per galaxy (Galaxy.raceChangePeriodActive) because the TS Race objects are shared parsed
// game data. Leaf module (type-only imports) so low-level modules such as population.ts can use it.
import type { Race } from './data/races';
import type { Galaxy } from './galaxy';

/** Race.cs 121 ChangePeriodYearsInterval ("PeriodicChangeInterval", Race.cs 1343). */
export function raceChangePeriodYearsInterval(race: Race): number {
    return race.changePeriodYearsInterval ?? 0;
}

/** Race.cs 123 ChangePeriodYearsLength ("PeriodicChangeLength", Race.cs 1346). */
export function raceChangePeriodYearsLength(race: Race): number {
    return race.changePeriodYearsLength ?? 0;
}

/** Race.cs 306 ChangePeriodActive (per galaxy, see Galaxy.raceChangePeriodActive). */
export function raceChangePeriodActive(galaxy: Galaxy, race: Race): boolean {
    return galaxy.raceChangePeriodActive.has(race);
}

/** Race.cs 111 PeriodicGrowthRate = 1.0 (file value clamped to [1.0, 2.0] by the loader, Race.cs 1349). */
export function racePeriodicGrowthRate(race: Race): number {
    return race.periodicGrowthRate ?? 1.0;
}

/** Race.cs 113 PeriodicAggressionLevel = 100 (file value clamped to [50, 200] by the loader, Race.cs 1352). */
export function racePeriodicAggressionLevel(race: Race): number {
    return race.periodicAggressionLevel ?? 100;
}

/** Race.cs 115 PeriodicCautionLevel = 100 (clamped to [50, 200], Race.cs 1355). */
export function racePeriodicCautionLevel(race: Race): number {
    return race.periodicCautionLevel ?? 100;
}

/** Race.cs 117 PeriodicFriendlinessLevel = 100 (clamped to [50, 200], Race.cs 1358). */
export function racePeriodicFriendlinessLevel(race: Race): number {
    return race.periodicFriendlinessLevel ?? 100;
}

/** Race.cs 320 ReproductiveRate: PeriodicGrowthRate while ChangePeriodActive, else _ReproductiveRate. */
export function raceReproductiveRate(galaxy: Galaxy, race: Race): number {
    return raceChangePeriodActive(galaxy, race) ? racePeriodicGrowthRate(race) : race.reproductionRate;
}

/** Race.cs 348 AggressionLevel (PeriodicAggressionLevel while ChangePeriodActive). */
export function raceAggressionLevel(galaxy: Galaxy, race: Race): number {
    return raceChangePeriodActive(galaxy, race) ? racePeriodicAggressionLevel(race) : race.aggression;
}

/** Race.cs 368 CautionLevel (PeriodicCautionLevel while ChangePeriodActive). */
export function raceCautionLevel(galaxy: Galaxy, race: Race): number {
    return raceChangePeriodActive(galaxy, race) ? racePeriodicCautionLevel(race) : race.caution;
}

/** Race.cs 384 FriendlinessLevel (PeriodicFriendlinessLevel while ChangePeriodActive). */
export function raceFriendlinessLevel(galaxy: Galaxy, race: Race): number {
    return raceChangePeriodActive(galaxy, race) ? racePeriodicFriendlinessLevel(race) : race.friendliness;
}
