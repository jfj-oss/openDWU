// AutoPauseWhenInPopupWindow (GameOptions, default true — Main.Part9.cs:2714). While a screen window is open a running
// game is paused; when the last one closes it resumes only if it was running before the first opened (the original's
// `if (AutoPause && TimeState == Running) { flag = true; Pause(); }` ... `if (flag) { flag = false; Resume(); }`,
// e.g. Main.Part6.cs method_425 / method_426). Nested windows (message boxes, sub-windows) only count.

/** The slice of GalaxyTime this needs. */
export interface PausableClock {
    paused: boolean;
}

/** Pure open/close state machine; `enabled` is read at each first-open. */
export class AutoPauseState {
    private depth = 0;
    private pausedByUs = false;

    constructor(private readonly enabled: () => boolean = () => true) {}

    /** A top-level or nested window opened. */
    open(clock: PausableClock | null): void {
        if (this.depth++ !== 0) return;
        if (clock !== null && this.enabled() && !clock.paused) {
            this.pausedByUs = true;
            clock.paused = true;
        }
    }

    /** A window closed. */
    close(clock: PausableClock | null): void {
        if (this.depth === 0) return;
        if (--this.depth !== 0) return;
        if (this.pausedByUs) {
            this.pausedByUs = false;
            if (clock !== null) clock.paused = false;
        }
    }

    /** Forget everything (new clock / new game). */
    reset(): void {
        this.depth = 0;
        this.pausedByUs = false;
    }

    get openCount(): number {
        return this.depth;
    }
}

let boundClock: PausableClock | null = null;
let state: AutoPauseState | null = null;

/** The HUD binds its clock here (hud.ts createHud). Rebinding resets the nesting state. */
export function bindAutoPauseClock(clock: PausableClock | null, enabled: () => boolean): void {
    boundClock = clock;
    state = new AutoPauseState(enabled);
}

export function autoPauseOpen(): void {
    state?.open(boundClock);
}

export function autoPauseClose(): void {
    state?.close(boundClock);
}
