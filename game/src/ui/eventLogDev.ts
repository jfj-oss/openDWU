// 19p event log dev hook (tasks/19-mod-layer-scenarios.md §19p). Not a port. `?eventLog=dump` logs the chronicle
// digest (sim/scenario/eventLog/chronicle.ts chronicleExport) to the console at start and whenever the log grew (checked
// every 30 s); `__dwu.eventLog.dump()` / `.export(since)` work without the URL. No-op for a game without the flag.
// [simworker] In worker mode `galaxy` is the replica: the log lives in scenario state, which the replica syncs in the
// cold cycle, so a dump may trail the worker by about a second; the readers here are peeks (no write to the replica).
import type { Galaxy } from '../sim/galaxy';
import { eventLogEntries, eventLogOn } from '../sim/scenario/eventLog/log';
import { chronicleExport, type ChronicleExport } from '../sim/scenario/eventLog/chronicle';

export interface EventLogDevHook {
    dump: () => void;
    export: (since?: number) => ChronicleExport;
    stop: () => void;
}

/** True for `?eventLog=dump`. */
export function eventLogDumpRequested(search: string): boolean {
    return new URLSearchParams(search).get('eventLog') === 'dump';
}

let current: EventLogDevHook | null = null;

/** Installs the hook for `galaxy` (stops the previous game's). */
export function installEventLogDevHook(galaxy: Galaxy, search: string): EventLogDevHook {
    current?.stop();
    const dump = (): void => {
        if (!eventLogOn(galaxy)) {
            console.info('[eventLog] off (scenario flag eventLog)');
            return;
        }
        const d = chronicleExport(galaxy, 0);
        console.info(`[eventLog] ${d.json.count} events\n${d.markdown}`);
        console.info('[eventLog] json', d.json);
    };
    let timer: ReturnType<typeof setInterval> | null = null;
    if (eventLogDumpRequested(search)) {
        dump();
        let last = -1;
        timer = setInterval(() => {
            const entries = eventLogEntries(galaxy);
            const key = entries.length > 0 ? entries[entries.length - 1].id : 0;
            if (key === last) return;
            last = key;
            dump();
        }, 30000);
    }
    current = {
        dump,
        export: (since = 0) => chronicleExport(galaxy, since),
        stop: () => {
            if (timer !== null) clearInterval(timer);
            timer = null;
        },
    };
    return current;
}
