// [constructionPriority] The order in which a human empire's AUTOMATED construction ships take the stock automation's
// jobs (Build Order screen). Not in the original. The stock assignment (civilianAI.ts assignMissionConstructionShip,
// Empire.5.cs) already runs its blocks in a fixed order — research stations, strategic-resource mining stations, resort
// bases, monitoring stations, luxury mining stations — and still decides where each is worthwhile; a priority order only
// regroups those blocks by ranked category:
//   researchResort  research stations, then resort bases
//   mining          strategic-resource mining (gas and mineral), then luxury mining
//   other           everything else of the block list (monitoring stations; defensive bases and space ports are built
//                   through the state shipyards / build plans, not this list)
// The stock blocks before these (planet destroyers, debris salvage, repairs) keep their place.
//
// Defaults: a NEW game (createGame marks the galaxy) uses DEFAULT_CONSTRUCTION_PRIORITY for every human empire; a save
// from before this existed has no mark and keeps the stock order until the player sets one. AI empires never use it.
// Journaled per empire: the `setConstructionPriority` player op. Headless: no DOM / Pixi. No Rnd.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { isHumanEmpire } from '../humanEmpires';

export type ConstructionPriorityCategory = 'researchResort' | 'mining' | 'other';

export const CONSTRUCTION_PRIORITY_CATEGORIES: readonly ConstructionPriorityCategory[] = ['researchResort', 'mining', 'other'];

/** The user's default: research stations and resort bases, then mining stations, then everything else. */
export const DEFAULT_CONSTRUCTION_PRIORITY: readonly ConstructionPriorityCategory[] = ['researchResort', 'mining', 'other'];

export const CONSTRUCTION_PRIORITY_LABELS: Record<ConstructionPriorityCategory, string> = {
    researchResort: 'Research stations and resort bases',
    mining: 'Mining stations (gas and mineral)',
    other: 'Everything else (monitoring stations, ...)',
};

declare module '../empire' {
    interface Empire {
        /** [constructionPriority] the ranked categories, or 'stock' for the original order. Absent: the galaxy default. */
        constructionPriority?: ConstructionPriorityCategory[] | 'stock';
    }
}
declare module '../galaxy' {
    interface Galaxy {
        /** [constructionPriority] set by createGame: human empires without an order of their own use the default. */
        constructionPriorityDefault?: boolean;
    }
}

function validOrder(order: unknown): order is ConstructionPriorityCategory[] {
    return (
        Array.isArray(order) &&
        order.length === CONSTRUCTION_PRIORITY_CATEGORIES.length &&
        CONSTRUCTION_PRIORITY_CATEGORIES.every((c) => order.includes(c))
    );
}

/** The order the empire's automated construction ships use, or null for the stock order. */
export function constructionPriorityOf(galaxy: Galaxy, empire: Empire): readonly ConstructionPriorityCategory[] | null {
    if (!isHumanEmpire(galaxy, empire)) return null;
    const own = empire.constructionPriority;
    if (own === 'stock') return null;
    if (own !== undefined) return own;
    return galaxy.constructionPriorityDefault === true ? DEFAULT_CONSTRUCTION_PRIORITY : null;
}

/** The `setConstructionPriority` player op: a permutation of the categories, or 'stock'. */
export function setConstructionPriority(galaxy: Galaxy, empire: Empire, order: ConstructionPriorityCategory[] | 'stock'): boolean {
    if (!isHumanEmpire(galaxy, empire)) return false;
    if (order === 'stock') {
        empire.constructionPriority = 'stock';
        return true;
    }
    if (!validOrder(order)) return false;
    empire.constructionPriority = order.slice();
    return true;
}

/** The order with category `i` moved one place up (dir -1) or down (+1); null when it cannot move. */
export function movedConstructionPriority(order: readonly ConstructionPriorityCategory[], i: number, dir: -1 | 1): ConstructionPriorityCategory[] | null {
    const j = i + dir;
    if (i < 0 || i >= order.length || j < 0 || j >= order.length) return null;
    const out = order.slice();
    [out[i], out[j]] = [out[j], out[i]];
    return out;
}
