// [dw2overlays] Colony Target Scores (Improvements, ui/improvements.ts): extends the original's Potential Colonies
// overlay with a heat colour from the Expansion Planner's own list — its "Potential Colonies" mode (ui/screens/
// expansionPlanner.ts expansionTargets 'colonies': Main.Part4.cs:2364 method_532 → Empire.4.cs IdentifyColonizationTargets
// (filterOutDangerousTargets false, threshold 0, at most 5000, no low-quality targets, distant ones included), whose
// priority is Empire.4.cs DetermineColonizationValue). The colour is the target's rank among the current targets (the
// best green, the weakest red): the priorities span orders of magnitude, so a rank reads better than a ratio. NOT in the
// original (Distant Worlds 2 shades its colonization targets).
//
// Fog: the list only ever holds habitats in systems the player has explored (IdentifyColonizationTargets skips the
// others), as the planner shows them.
//
// Cost: identifyColonizationTargetsFull walks the explored systems' planets and moons; it is rebuilt only when
// colonyTargetSignature changes (systems explored, colonies founded or lost anywhere, the player's designs, and once a
// game month for the slower inputs: populations, policy), read inside withPureSimReads (UI-only, no lazy writes).
//
// Pixi / DOM free.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Habitat } from '../sim/types';
import { identifyColonizationTargetsFull } from '../sim/civilianAI';
import { withPureSimReads } from '../sim/readOnlyQuery';
import { galaxyStarDate } from '../sim/tick/simTime';
import { GAME_DAY_LENGTH } from '../sim/scenario/hooks';

export interface ColonyTargetScore {
    habitat: Habitat;
    /** DetermineColonizationValue (the planner's priority). */
    priority: number;
    /** 0 = the best target. */
    rank: number;
    /** 1 for the best target, 0 for the weakest (rank-based); 1 when there is only one. */
    heat: number;
}

export interface ColonyTargetScores {
    /** Best first (the planner's order). */
    list: ColonyTargetScore[];
    byHabitat: Map<Habitat, ColonyTargetScore>;
    /** Each system's best target. */
    bySystem: Map<number, ColonyTargetScore>;
}

/** Rank `targets` (already best first, as IdentifyColonizationTargets returns them; re-sorted stably to be safe). */
export function scoreColonyTargets(targets: readonly { habitat: Habitat | null; priority: number }[]): ColonyTargetScores {
    const rows = targets.filter((t): t is { habitat: Habitat; priority: number } => t.habitat !== null);
    const sorted = rows.map((t, i) => ({ t, i })).sort((a, b) => b.t.priority - a.t.priority || a.i - b.i);
    const n = sorted.length;
    const list: ColonyTargetScore[] = [];
    const byHabitat = new Map<Habitat, ColonyTargetScore>();
    const bySystem = new Map<number, ColonyTargetScore>();
    for (let k = 0; k < n; k++) {
        const { habitat, priority } = sorted[k].t;
        if (byHabitat.has(habitat)) continue;
        const s: ColonyTargetScore = { habitat, priority, rank: list.length, heat: 0 };
        list.push(s);
        byHabitat.set(habitat, s);
        if (!bySystem.has(habitat.systemIndex)) bySystem.set(habitat.systemIndex, s);
    }
    const m = list.length;
    for (const s of list) s.heat = m <= 1 ? 1 : 1 - s.rank / (m - 1);
    return { list, byHabitat, bySystem };
}

/** Heat colour: red (0) → amber (0.5) → green (1). */
export function heatColor(t: number): number {
    const x = Math.min(1, Math.max(0, t));
    const lerp = (a: number, b: number, u: number): number => Math.round(a + (b - a) * u);
    const [r, g, b] = x < 0.5 ? [lerp(0xe0, 0xf0, x * 2), lerp(0x40, 0xc0, x * 2), lerp(0x30, 0x30, x * 2)] : [lerp(0xf0, 0x40, (x - 0.5) * 2), lerp(0xc0, 0xe8, (x - 0.5) * 2), lerp(0x30, 0x60, (x - 0.5) * 2)];
    return (r << 16) | (g << 8) | b;
}

/** HabitatPrioritizationListView.cs:60-113 Quality column format "0%" (expansionPlanner.ts qualityPercent). */
export function qualityText(q: number): string {
    return `${Math.round(q * 100)}%`;
}

/** Hover text for one target. */
export function colonyTargetTooltip(s: ColonyTargetScore, total: number, systemName: string | null): string {
    const where = systemName !== null && systemName !== s.habitat.name ? ` (${systemName})` : '';
    return `Colony target ${s.rank + 1} of ${total}: ${s.habitat.name}${where}\nQuality ${qualityText(s.habitat.quality)} · score ${s.priority.toLocaleString('en-US')}`;
}

/** A game month in star-date ms (30 game days). */
const MONTH = 30 * GAME_DAY_LENGTH;

/** Changes when an input of the target list changes (see the file header). */
export function colonyTargetSignature(galaxy: Galaxy, player: Empire): number {
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
        h ^= v | 0;
        h = Math.imul(h, 0x01000193);
    };
    const sv = player.visibility.systemVisibility;
    for (let i = 0; i < sv.length; i++) mix(sv[i].status);
    mix(player.visibility.empiresSharedVisibility.length);
    for (const e of galaxy.empires) {
        if (e == null) continue;
        mix(e.colonies.length);
    }
    if (galaxy.independentEmpire !== null) mix(galaxy.independentEmpire.colonies.length);
    mix(player.designs.length);
    mix(Math.floor(galaxyStarDate(galaxy) / MONTH));
    return h >>> 0;
}

/** The Expansion Planner's Potential Colonies list for `player`, scored (uncached). */
export function computeColonyTargetScores(galaxy: Galaxy, player: Empire): ColonyTargetScores {
    if (player.dominantRace === null) return scoreColonyTargets([]);
    return withPureSimReads(() => scoreColonyTargets(identifyColonizationTargetsFull(galaxy, player, false, 0, 5000, false, true)));
}

const cache = new WeakMap<Galaxy, { sig: number; player: Empire; scores: ColonyTargetScores }>();

/** computeColonyTargetScores, rebuilt only when colonyTargetSignature changes. */
export function colonyTargetScoresFor(galaxy: Galaxy, player: Empire): ColonyTargetScores {
    const sig = colonyTargetSignature(galaxy, player);
    const c = cache.get(galaxy);
    if (c !== undefined && c.sig === sig && c.player === player) return c.scores;
    const scores = computeColonyTargetScores(galaxy, player);
    cache.set(galaxy, { sig, player, scores });
    return scores;
}
