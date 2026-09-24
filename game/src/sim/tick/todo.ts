// M4a: TODO(port) stub registry (tasks/M4-plan.md §3.1 rule 4, §5.2).
//
// Every unported callee of the tick skeletons is a named no-op stub in its owning package module.
// A stub never draws Galaxy.Rnd (when the C# would, the stub carries a `// RND:` note). Each stub
// calls `todo(ID)` with a numeric id registered once at module load, so a soak run can report which
// stubs were reached (and how often) and a CI run can make reaching one fatal (`stopOnTodo`).
// The counter is a flat Int32 array increment: stubs sit on per-object per-frame paths.

const names: string[] = [];
let counts = new Float64Array(256);
let stopOnTodo = false;

/** Registers a stub site `"<package> <C# name>"` and returns its id. Call at module load. */
export function registerTodo(pkg: string, name: string): number {
    const id = names.length;
    names.push(`${pkg} ${name}`);
    if (id >= counts.length) {
        const grown = new Float64Array(counts.length * 2);
        grown.set(counts);
        counts = grown;
    }
    return id;
}

/** Marks a stub as reached. Throws when `stopOnTodo` is on (harness option). */
export function todo(id: number): void {
    counts[id]++;
    if (stopOnTodo) {
        throw new Error(`TODO(port) ${names[id]}`);
    }
}

export function setStopOnTodo(on: boolean): void {
    stopOnTodo = on;
}

export function resetTodoCounts(): void {
    counts.fill(0);
}

/** Reached stubs since the last reset: `{ "<package> <name>": hits }`, in registration order. */
export function todoHits(): Record<string, number> {
    const out: Record<string, number> = {};
    for (let i = 0; i < names.length; i++) {
        if (counts[i] > 0) out[names[i]] = counts[i];
    }
    return out;
}

/** All registered stub names (package + C# name), in registration order. */
export function registeredTodos(): readonly string[] {
    return names;
}
