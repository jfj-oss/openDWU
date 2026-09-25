// Galaxy time: game-year constants, star-date formatting, and the
// pause/speed clock (the app's view over the galaxy's sim clock). Ports of Galaxy.3.cs
// InitializeStatics (RealSecondsInGalacticYear/YearLength/StartStarDate),
// Galaxy.cs CurrentStarDate/ResolveStarDateDescription, Start.2.cs
// startStarDate = StartStarDate + age * 30000000, and Main.Part4.cs speed
// buttons (speed *= 2 / /= 2 clamped to [0.25, 4]; Pause/Resume).

// Port of Galaxy.3.cs InitializeStatics: RealSecondsInGalacticYear = 600.
export const REAL_SECONDS_IN_GALACTIC_YEAR = 600;
// Port of Galaxy.3.cs InitializeStatics: YearLength = RealSecondsInGalacticYear * 1000 (ms per game year).
export const YEAR_LENGTH = REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
// Port of Galaxy.3.cs InitializeStatics: StartStarDate = 1260000000L (= year 2100).
export const START_STAR_DATE = 1_260_000_000;
// Port of Main.Part4.cs speed buttons: min/max TimeSpeed.
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4.0;

// Port of Galaxy.cs ResolveStarDateDescription(starDate, datePartSeparator).
// C# int/long casts truncate toward zero — Math.trunc matches.
export function resolveStarDateDescription(starDate: number, sep = '.'): string {
    const num = Math.trunc(starDate / (1000 * REAL_SECONDS_IN_GALACTIC_YEAR));
    const num2 = num * (1000 * REAL_SECONDS_IN_GALACTIC_YEAR);
    const num3 = (1000.0 * REAL_SECONDS_IN_GALACTIC_YEAR) / 12.0;
    let num4 = Math.trunc((starDate - num2) / num3);
    const num5 = Math.trunc(num4 * num3);
    const num6 = num3 / 30.0;
    let num7 = Math.trunc((starDate - (num2 + num5)) / num6);
    num4++;
    num7++;
    return `${String(num).padStart(4, '0')}${sep}${String(num4).padStart(2, '0')}${sep}${String(num7).padStart(2, '0')}`;
}

// Port of Start.2.cs: startStarDate = Galaxy.StartStarDate + age * 30000000
// (30000000 ms = 50 game years per age step).
export function startStarDateForAge(age: number): number {
    return START_STAR_DATE + age * 30_000_000;
}

// The galaxy's sim clock as GalaxyTime reads it when bound (a Galaxy satisfies it: `nowMs` is the scheduler's
// integer game-ms clock, tick/simTime.ts; `age` fixes _StartStarDate, Start.2.cs 450-451).
export interface GalaxyClockSource {
    nowMs: number;
    age: number;
}

// Galaxy time clock: game time runs at TimeSpeed × real time; Pause stops
// the clock. advance(realDtMs) returns the game ms advanced (0 when paused).
//
// Bound to a galaxy (bindGalaxy), it is a thin view over the one sim clock: elapsed ms is `galaxy.nowMs` (advanced
// only by the scheduler, tick/scheduler.ts runSimFrame) and the start date is the galaxy's (startStarDateForAge), so
// currentStarDate === galaxyStarDate(galaxy); only the pause/speed controls live here. The app binds its clock; an
// unbound clock keeps its own elapsed ms (headless tests, save-format fixtures).
export class GalaxyTime {
    // Port of Galaxy.cs _StartStarDate (set from StartStarDate or
    // startStarDateForAge in Start.2.cs).
    private ownStartStarDate: number;
    private ownElapsedMs = 0;
    // Not initialised by gameSave.ts's Object.create revival: treat undefined as unbound.
    private source: GalaxyClockSource | null = null;
    // C# starts paused until the player resumes (Main.Part4.cs Pause/Resume).
    paused = true;
    speed = 1.0;

    constructor(startStarDate: number = START_STAR_DATE) {
        this.ownStartStarDate = startStarDate;
    }

    /** Make this clock a view over `galaxy`'s sim clock (see the class comment). */
    bindGalaxy(galaxy: GalaxyClockSource): this {
        this.source = galaxy;
        return this;
    }

    get boundGalaxy(): GalaxyClockSource | null {
        return this.source ?? null;
    }

    get startStarDate(): number {
        const src = this.source;
        return src != null ? startStarDateForAge(src.age) : this.ownStartStarDate;
    }

    set startStarDate(value: number) {
        this.ownStartStarDate = value;
    }

    /** Game ms since the start (bound: `galaxy.nowMs`). */
    get elapsedMs(): number {
        const src = this.source;
        return src != null ? src.nowMs : this.ownElapsedMs;
    }

    set elapsedMs(value: number) {
        if (this.source != null) throw new Error('GalaxyTime: a bound clock is advanced by the sim scheduler, not set');
        this.ownElapsedMs = value;
    }

    // Port of Galaxy.cs CurrentStarDate: ms of game time elapsed + start.
    get currentStarDate(): number {
        return this.elapsedMs + this.startStarDate;
    }

    // Game ms advanced for a real-time delta (0 while paused).
    advance(realDtMs: number): number {
        if (this.paused) {
            return 0;
        }
        if (this.source != null) throw new Error('GalaxyTime: a bound clock is advanced by the sim scheduler (SimDriver)');
        const advanced = realDtMs * this.speed;
        this.elapsedMs += advanced;
        return advanced;
    }

    // Port of Main.Part4.cs speed-up button: speed *= 2, max 4.0.
    faster(): void {
        this.speed = Math.min(SPEED_MAX, this.speed * 2);
    }

    // Port of Main.Part4.cs slow-down button: speed /= 2, min 0.25.
    slower(): void {
        this.speed = Math.max(SPEED_MIN, this.speed / 2);
    }

    // Port of Main.Part4.cs Pause/Resume toggle.
    togglePause(): void {
        this.paused = !this.paused;
    }
}