// Stability terms (tasks/19-mod-layer-scenarios.md §19m item 1). Not a port: the mod layer's one channel for scenario
// approval terms. Every package that adds a signed term to a colony's approval (Habitat.cs 534 EmpireApprovalRating)
// registers it here WITH A CAUSE instead of a raw empireApprovalRating query, so the 19m stability ledger can list the
// causes and the sum stays one fold: stock value, then each gated term in (order, id) order — the same order and the
// same additions the former per-package query handlers applied — then any remaining empireApprovalRating queries.
// Terms are pure: no Rnd, no state creation.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import { scenarioGateOpen, scenarioQuery, type ScenarioHandlerGate } from './hooks';

export interface StabilityTermHandler extends ScenarioHandlerGate {
    /** Cause id of the ledger entry (e.g. "shortages"). */
    cause: string;
    /** Display label (Empire Summary / colony tooltip). */
    label: string;
    /** The signed approval term at `habitat` (null: no term here; skipped). Pure. */
    run: (galaxy: Galaxy, habitat: Habitat, empire: Empire | null) => number | null;
}

// `var` + lazy creation: packages register at module load, possibly inside an import cycle through taxes.ts.
// eslint-disable-next-line no-var
var termStore: StabilityTermHandler[] | undefined;
function terms(): StabilityTermHandler[] {
    return (termStore ??= []);
}

/** Registers (or replaces, by id) a stability term. Sorted like every scenario registry: (order, id). */
export function registerStabilityTerm(handler: StabilityTermHandler): () => void {
    const list = terms();
    const i = list.findIndex((h) => h.id === handler.id);
    if (i >= 0) list.splice(i, 1);
    list.push(handler);
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return () => {
        const j = list.indexOf(handler);
        if (j >= 0) list.splice(j, 1);
    };
}

/** One ledger line: a gated term's value at a colony. */
export interface StabilityTermValue {
    id: string;
    cause: string;
    label: string;
    value: number;
}

/** The gated terms at `h`, in fold order (null terms left out). */
export function stabilityTermValues(galaxy: Galaxy, h: Habitat): StabilityTermValue[] {
    const out: StabilityTermValue[] = [];
    if (galaxy.scenario === null) return out;
    for (const t of terms()) {
        if (!scenarioGateOpen(galaxy, t)) continue;
        const v = t.run(galaxy, h, h.empire);
        if (v !== null) out.push({ id: t.id, cause: t.cause, label: t.label, value: v });
    }
    return out;
}

/**
 * taxes.ts empireApprovalRating's mod-layer tail: the stock rating plus every gated term (in order), then the
 * empireApprovalRating query handlers. Callers check galaxy.scenario !== null.
 */
export function scenarioApprovalRating(galaxy: Galaxy, stock: number, h: Habitat): number {
    let v = stock;
    for (const t of terms()) {
        if (!scenarioGateOpen(galaxy, t)) continue;
        const x = t.run(galaxy, h, h.empire);
        if (x !== null) v = v + x;
    }
    return scenarioQuery(galaxy, 'empireApprovalRating', v, { habitat: h, empire: h.empire });
}
