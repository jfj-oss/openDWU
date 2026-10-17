// Giantworks: the wonder registry (the contract's registerGreatWork, re-exported by framework.ts) and the lore tables the
// AI and the hint system read. Not a port. Pure.

import type { GreatWorkKind } from './types';

// `var` + lazy creation: wonder modules register at module load, possibly while the framework is still initialising.
// eslint-disable-next-line no-var
var kindStore: Map<string, GreatWorkKind> | undefined;
function kinds(): Map<string, GreatWorkKind> {
    return (kindStore ??= new Map());
}

/** A wonder module registers its kind once at load (re-registering an id replaces it). */
export function registerGreatWork(kind: GreatWorkKind): void {
    kinds().set(kind.id, kind);
}

/** Every registered wonder, in id order (never the registration order: module import order must not matter). */
export function greatWorkKinds(): GreatWorkKind[] {
    return [...kinds().values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function greatWorkKind(id: string): GreatWorkKind | null {
    return kinds().get(id) ?? null;
}

/** Test hook: removes a registered kind (the framework tests register a throw-away wonder). */
export function unregisterGreatWork(id: string): void {
    kinds().delete(id);
}

/**
 * What an AI empire expects of a wonder it only knows from a shortlist: the common-lore danger (0 harmless .. 1 an
 * extinction fleet) and the common-lore value (0 useless .. 1 a fortune). The AI weighs the shortlist's mean, never the
 * secret answer. Unknown ids (a later wonder) get the middle values.
 */
export const KIND_MENACE: Readonly<Record<string, number>> = { beacon: 0.9, ultramind: 0.45, casino: 0.25, sanctuary: 0.15, riftgate: 0.5, ark: 0.4 };
export const KIND_VALUE: Readonly<Record<string, number>> = { beacon: 0.05, ultramind: 0.7, casino: 0.8, sanctuary: 0.6, riftgate: 0.5, ark: 0.3 };

export function kindMenace(id: string): number {
    return KIND_MENACE[id] ?? 0.4;
}
export function kindValue(id: string): number {
    return KIND_VALUE[id] ?? 0.4;
}
