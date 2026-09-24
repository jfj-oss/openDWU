// M4a time model (tasks/M4-plan.md §1.7).
//
// C#: Galaxy.CurrentDateTime is a DateTime (100 ns ticks) driven by a stopwatch × TimeSpeed
// (Galaxy.cs 1114); Galaxy.CurrentStarDate = (CurrentDateTime.Ticks − _StartDateTime.Ticks) / 10000
// + _StartStarDate (Galaxy.cs 1098), i.e. integer game ms. Every DoTasks `timePassed` is
// `TimeSpan.Ticks / 10000000.0` seconds and every interval test compares TimeSpans or those doubles.
//
// TS: sim time is an integer count of game milliseconds since game start (`galaxy.nowMs`, a
// field in galaxy.ts's M4a section). Touch fields store game ms too. DateTime.MinValue (the C#
// default of every `_Last*Touch` field) is the sentinel MIN_TIME = −2^52 ms: `now − MIN_TIME`
// stays an exact integer below 2^53, so every `>=`/`>` interval test against it passes like the
// C# one does. (The C# difference would be ≈ 6.3e10 s; ours is ≈ 4.5e12 s — only the magnitude of
// the first-call `timePassed` differs, never which blocks fire.)
//
// Seconds from ms: C# `(double)span.Ticks / 1e7` with Ticks = ms × 10000 is the correctly rounded
// quotient of the same rational as `ms / 1000`, so `spanSeconds` is bit-identical to the C#.

import type { Galaxy } from '../galaxy';
import { startStarDateForAge } from '../galaxyTime';

/** DateTime.MinValue stand-in (game ms). */
export const MIN_TIME = -(2 ** 52);

/** Galaxy.3.cs 5139-5142 IntermediateProcessingSpan / Periodic / Long / Huge (TimeSpans, as ms). */
export const INTERMEDIATE_PROCESSING_SPAN_MS = 3000;
export const PERIODIC_PROCESSING_SPAN_MS = 10000;
export const LONG_PROCESSING_SPAN_MS = 60000;
export const HUGE_PROCESSING_SPAN_MS = 240000;

/** Galaxy.3.cs 5138 RealSecondsInGalacticYear = 600. */
export const REAL_SECONDS_IN_GALACTIC_YEAR = 600;

/** `(double)(a − b).Ticks / 10000000.0` — seconds between two sim times (ms). */
export function spanSeconds(nowMs: number, thenMs: number): number {
    return (nowMs - thenMs) / 1000;
}

/** Galaxy.CurrentDateTime as sim ms. */
export function galaxyNow(galaxy: Galaxy): number {
    return galaxy.nowMs;
}

/**
 * Galaxy.CurrentStarDate (Galaxy.cs 1098): elapsed game ms + _StartStarDate, where
 * _StartStarDate = StartStarDate + Age × 30000000 (Start.2.cs 450-451, galaxyTime.ts).
 */
export function galaxyStarDate(galaxy: Galaxy): number {
    return startStarDateForAge(galaxy.age) + galaxy.nowMs;
}

/**
 * Keeps the legacy seconds clock (`galaxy.currentTimeSeconds`, read by creature.ts and
 * characters.ts) in step with the integer ms clock. The plan (§1.7) makes it a getter over
 * `nowMs`; galaxy.ts's `step()` still writes it, so until `step` is retired the scheduler assigns it
 * at the start of every frame instead.
 */
export function syncLegacySecondsClock(galaxy: Galaxy): void {
    galaxy.currentTimeSeconds = galaxy.nowMs / 1000;
}
