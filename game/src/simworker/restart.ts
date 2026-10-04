// Sim worker: restarting after the worker stopped (docs/sim-worker.md §4.6). A fatal worker error (its loop or the
// sync threw, an uncaught error, a message that could not be read, the reply backstop) ends that worker for good: the
// main thread fails every request waiting on it (clientCore.ts workerFailed) and terminates it. The game itself is not
// lost — the app offers to restart it in a new worker, from the best save text it can get:
//
//  1. the worker's own save of its last state, sent with its fatal error when the worker could still serialize its game
//     (worker.ts fatal: the sim is intact when only the sync or the host failed) — exact;
//  2. the replica, serialized on the main thread (serializeGame of the replica game): the game as the main view last
//     showed it. Hot data is current; cold data may be up to a cold cycle older (§8 "Cold staleness"), and the replica
//     keeps no command log, so the restarted game's log starts at the restart;
//  3. this game's last autosave (ui/autosave.ts), older but written by the worker.
//
// Each source is tried in that order: a source whose text cannot be had, or that the new worker cannot load, gives way
// to the next. The new game resumes paused. No DOM / Pixi imports (main.ts shows the message box and boots the game).

export type RestartSourceKind = 'worker' | 'replica' | 'autosave';

export interface RestartSource {
    kind: RestartSourceKind;
    /** For the message box ("the simulation's last state", "the last autosave (autosave-2, 12 minutes ago)"). */
    label: string;
    /** The save text (null / a throw: not available, the next source is tried). */
    text(): string | null | Promise<string | null>;
}

export interface RestartInputs {
    /** The worker's own save of its last state (SimWorkerClient.rescueSave), or null. */
    rescue: string | null;
    /** Serialize the replica game on the main thread, or null when there is none. */
    replica: (() => string) | null;
    /** This game's last autosave, or null. */
    autosave: { name: string; savedAt: number; read: () => Promise<string | null> } | null;
    /** Wall clock (Date.now) for the autosave's age. */
    now?: () => number;
}

/** How long ago `ms` was, in the message box's words. */
function ago(ms: number): string {
    const min = Math.round(ms / 60000);
    if (min < 1) return 'less than a minute ago';
    if (min === 1) return '1 minute ago';
    if (min < 120) return `${min} minutes ago`;
    return `${Math.round(min / 60)} hours ago`;
}

/** The restart sources available, best first (see the file header). */
export function restartSources(input: RestartInputs): RestartSource[] {
    const out: RestartSource[] = [];
    const rescue = input.rescue;
    if (rescue !== null && rescue !== '') out.push({ kind: 'worker', label: "the simulation's last state", text: () => rescue });
    const replica = input.replica;
    if (replica !== null) out.push({ kind: 'replica', label: 'the game as last shown', text: () => replica() });
    const auto = input.autosave;
    if (auto !== null) {
        const now = (input.now ?? Date.now)();
        out.push({ kind: 'autosave', label: `the last autosave (${auto.name}, ${ago(now - auto.savedAt)})`, text: () => auto.read() });
    }
    return out;
}

/** The message box text offering the restart (the first source is named; the others are the fallbacks). */
export function restartPromptText(reason: string, sources: readonly RestartSource[]): string {
    const head = `The simulation stopped (${reason}). The orders still on their way were not carried out.`;
    if (sources.length === 0) return `${head}\n\nThere is no saved state to restart from: return to the main menu.`;
    const rest = sources.length > 1 ? ` (if that cannot be loaded: ${sources.slice(1).map((s) => s.label).join(', then ')})` : '';
    return `${head}\n\nRestart from ${sources[0].label}${rest}? The game resumes paused.`;
}

export interface RestartAttempt {
    source: RestartSource;
    error: string;
}

/**
 * Try the sources in order: the first whose text boots (`boot`: load it into a new worker and build its replica) wins.
 * Returns the booted result with its source and the attempts that failed before it, or null (with every failure)
 * when none could be loaded.
 */
export async function restartFromSources<T>(sources: readonly RestartSource[], boot: (text: string, source: RestartSource) => Promise<T>): Promise<{ result: T; source: RestartSource; failed: RestartAttempt[] } | { result: null; failed: RestartAttempt[] }> {
    const failed: RestartAttempt[] = [];
    for (const source of sources) {
        let text: string | null;
        try {
            text = await source.text();
        } catch (err) {
            failed.push({ source, error: `its save could not be made (${err instanceof Error ? err.message : String(err)})` });
            continue;
        }
        if (text === null || text === '') {
            failed.push({ source, error: 'no save text' });
            continue;
        }
        try {
            return { result: await boot(text, source), source, failed };
        } catch (err) {
            failed.push({ source, error: `it could not be loaded (${err instanceof Error ? err.message : String(err)})` });
        }
    }
    return { result: null, failed };
}
