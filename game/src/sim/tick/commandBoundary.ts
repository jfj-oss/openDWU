// Command-log boundary hook (tasks/M4-agent-brief.md "Command log"): external commands (player clicks, the local
// advisor) reach the sim only at a frame boundary. The player layer (player/playerCommands.ts) registers a drainer per
// galaxy; the scheduler calls it at the start of every frame, before the clock advances, and the app loop calls it
// once per render frame (so orders given while paused still land). Kept free of player-layer imports: the tick path
// never reaches the command executors statically (test/aiAdvisor18c.test.ts import walk).

import type { Galaxy } from '../galaxy';

type Drainer = (galaxy: Galaxy) => void;

const drainers = new WeakMap<Galaxy, Drainer>();
let frameDepth = 0;

/** Install the galaxy's command drainer (player/playerCommands.ts). */
export function setCommandDrainer(galaxy: Galaxy, drainer: Drainer): void {
    drainers.set(galaxy, drainer);
}

/** Apply the galaxy's pending external commands now (a frame boundary). No-op when nothing is pending. */
export function drainCommandBoundary(galaxy: Galaxy): void {
    const d = drainers.get(galaxy);
    if (d !== undefined) d(galaxy);
}

/** True while runSimFrame is running (external commands must not be applied then). */
export function inSimFrame(): boolean {
    return frameDepth > 0;
}

export function enterSimFrame(): void {
    frameDepth++;
}

export function leaveSimFrame(): void {
    frameDepth--;
}
