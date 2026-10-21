// A screen's render is several independent stages (list, buttons, detail, map...). One stage throwing (an add-on's extras,
// a row with odd data) must not leave the others stale or half-built, so each runs on its own and the failure is reported.

export type RenderStage = readonly [name: string, run: () => void];

/** Runs every stage in order; a throwing stage is reported (console.error by default) and the rest still run. Returns the names that failed. */
export function runStages(stages: readonly RenderStage[], report: (name: string, error: unknown) => void = (n, e) => console.error(`[ui] ${n} failed`, e)): string[] {
    const failed: string[] = [];
    for (const [name, run] of stages) {
        try {
            run();
        } catch (e) {
            failed.push(name);
            report(name, e);
        }
    }
    return failed;
}
