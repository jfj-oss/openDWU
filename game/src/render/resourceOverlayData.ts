// [dw2overlays] Resources overlay data (Improvements, ui/improvements.ts): the resources the player knows of, per system
// and per habitat, from the player's ResourceMap (Empire.ResourceMap.CheckResourcesKnown — the same knowledge the
// original's InfoPanel resource list, Galaxy Map "Known Resources" view and Expansion Planner use). NOT a port: the
// original draws no resource icons on the main map (Distant Worlds 2 does).
//
// Rarity follows HabitatPrioritizationListView.cs:605 GetResourceCellRarity (the Expansion Planner's VR / R / C column):
// a super-luxury resource is very rare, a luxury resource rare, the rest common. Abundance is HabitatResource.Abundance
// (0..1000, shown as a percentage, ui/resourceAbundance.ts).
//
// Cost: one pass over the galaxy's habitats per rebuild, and a rebuild only when the knowledge changes —
// knownResourceSignature hashes the ResourceMap bit array (one bit per habitat: ~10 KB on a 2500-star galaxy), so a
// caller can poll it a few times a second for nothing.
//
// Read-only and Pixi / DOM free.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Habitat } from '../sim/types';
import type { Resource } from '../sim/data/resources';
import { abundancePercentText } from '../ui/resourceAbundance';

export enum ResourceRarity {
    Common = 0,
    Rare = 1,
    VeryRare = 2,
}

/** Frame / bar colour per rarity (common grey-blue, rare gold, very rare violet). */
export const RARITY_COLORS: readonly number[] = [0xa8b4c4, 0xf2c14e, 0xc58bff];
export const RARITY_LABELS: readonly string[] = ['common', 'rare', 'very rare'];

/** HabitatPrioritizationListView.cs:605 GetResourceCellRarity for one resource (super luxury VR, luxury R, else C). */
export function resourceRarity(r: Pick<Resource, 'type' | 'superLuxuryBonusAmount'> | undefined): ResourceRarity {
    if (r === undefined) return ResourceRarity.Common;
    if (r.superLuxuryBonusAmount > 0) return ResourceRarity.VeryRare;
    if (r.type === 2) return ResourceRarity.Rare;
    return ResourceRarity.Common;
}

export interface KnownHabitatResources {
    habitat: Habitat;
    /** The habitat's resources, rarest first, then most abundant. */
    resources: { resourceId: number; abundance: number; rarity: ResourceRarity }[];
}

/** One resource of a system: the best abundance among its known habitats and how many of them carry it. */
export interface KnownSystemResource {
    resourceId: number;
    maxAbundance: number;
    habitatCount: number;
    rarity: ResourceRarity;
}

export interface KnownSystemResources {
    systemIndex: number;
    /** The system star (where the galaxy-zoom icons sit). */
    star: Habitat;
    /** Rarest first, then most abundant, then resource id. */
    resources: KnownSystemResource[];
    habitats: KnownHabitatResources[];
}

export interface KnownResourceIndex {
    /** Systems with at least one known resource, in Galaxy.Systems order. */
    systems: KnownSystemResources[];
    bySystem: Map<number, KnownSystemResources>;
    /** Resource id → systems where the player knows of it. */
    systemCountByResource: Map<number, number>;
}

function byRarityThenAbundance(a: { rarity: ResourceRarity; resourceId: number }, b: { rarity: ResourceRarity; resourceId: number }, aAb: number, bAb: number): number {
    return b.rarity - a.rarity || bAb - aAb || a.resourceId - b.resourceId;
}

/**
 * Group the habitats whose resources `known` says the player knows (and that have any) by system. `resourceDef` looks a
 * resource up by id (galaxy.resourceSystem.byId).
 */
export function buildKnownResourceIndex(
    habitats: readonly Habitat[],
    systemStar: (systemIndex: number) => Habitat | null,
    known: (h: Habitat) => boolean,
    resourceDef: (id: number) => Resource | undefined,
): KnownResourceIndex {
    const bySystem = new Map<number, KnownSystemResources>();
    const order: number[] = [];
    for (const h of habitats) {
        if (h == null || h.resources.length === 0 || !known(h)) continue;
        const star = systemStar(h.systemIndex);
        if (star === null) continue;
        let sys = bySystem.get(h.systemIndex);
        if (sys === undefined) {
            sys = { systemIndex: h.systemIndex, star, resources: [], habitats: [] };
            bySystem.set(h.systemIndex, sys);
            order.push(h.systemIndex);
        }
        const res = h.resources.map((r) => ({ resourceId: r.resourceId, abundance: r.abundance, rarity: resourceRarity(resourceDef(r.resourceId)) }));
        res.sort((a, b) => byRarityThenAbundance(a, b, a.abundance, b.abundance));
        sys.habitats.push({ habitat: h, resources: res });
        for (const r of res) {
            const e = sys.resources.find((x) => x.resourceId === r.resourceId);
            if (e === undefined) sys.resources.push({ resourceId: r.resourceId, maxAbundance: r.abundance, habitatCount: 1, rarity: r.rarity });
            else {
                e.habitatCount++;
                if (r.abundance > e.maxAbundance) e.maxAbundance = r.abundance;
            }
        }
    }
    order.sort((a, b) => a - b);
    const systems: KnownSystemResources[] = [];
    const systemCountByResource = new Map<number, number>();
    for (const i of order) {
        const sys = bySystem.get(i)!;
        sys.resources.sort((a, b) => byRarityThenAbundance(a, b, a.maxAbundance, b.maxAbundance));
        for (const r of sys.resources) systemCountByResource.set(r.resourceId, (systemCountByResource.get(r.resourceId) ?? 0) + 1);
        systems.push(sys);
    }
    return { systems, bySystem, systemCountByResource };
}

/** FNV-1a over the player's ResourceMap bits (and the habitat count): changes whenever a habitat's resources become
 * known. `reveal` (the fog's dev reveal) gives a fixed different value. */
export function knownResourceSignature(galaxy: Galaxy, player: Empire | null, reveal: boolean): number {
    let h = 0x811c9dc5 ^ galaxy.habitats.length;
    if (reveal) return (h ^ 0x5a5a5a5a) >>> 0;
    const bits = player?.resourceMap?.resourcesKnown ?? null;
    if (bits === null) return h >>> 0;
    for (let i = 0; i < bits.length; i++) {
        h ^= bits[i];
        h = Math.imul(h, 0x01000193);
    }
    return (h ^ bits.length) >>> 0;
}

const cache = new WeakMap<Galaxy, { sig: number; player: Empire | null; index: KnownResourceIndex }>();

/** The player's known-resource index, rebuilt only when knownResourceSignature changes. */
export function knownResourceIndexFor(galaxy: Galaxy, player: Empire | null, reveal = false): KnownResourceIndex {
    const sig = knownResourceSignature(galaxy, player, reveal);
    const c = cache.get(galaxy);
    if (c !== undefined && c.sig === sig && c.player === player) return c.index;
    const map = player?.resourceMap ?? null;
    const index = buildKnownResourceIndex(
        galaxy.habitats,
        (i) => galaxy.systems[i]?.systemStar ?? null,
        reveal ? () => true : (h) => map !== null && map.checkResourcesKnown(h),
        (id) => galaxy.resourceSystem.byId.get(id),
    );
    cache.set(galaxy, { sig, player, index });
    return index;
}

/** The systems to draw for a filter (null = all known), in index order. */
export function systemsForFilter(index: KnownResourceIndex, resourceId: number | null): KnownSystemResources[] {
    if (resourceId === null) return index.systems;
    return index.systems.filter((s) => s.resources.some((r) => r.resourceId === resourceId));
}

/** The icons one system shows: the filtered resource alone, else its first `max` (rarest / most abundant). */
export function systemIcons(sys: KnownSystemResources, resourceId: number | null, max: number): KnownSystemResource[] {
    if (resourceId !== null) {
        const r = sys.resources.find((x) => x.resourceId === resourceId);
        return r === undefined ? [] : [r];
    }
    return sys.resources.slice(0, Math.max(0, max));
}

/** The icons one habitat shows (system zoom): the filtered resource alone, else all of them. */
export function habitatIcons(h: KnownHabitatResources, resourceId: number | null): KnownHabitatResources['resources'] {
    return resourceId === null ? h.resources : h.resources.filter((r) => r.resourceId === resourceId);
}

/** Galaxy / sector zoom: how many icons per system fit at zoom factor f (world units per pixel). */
export function maxSystemIcons(f: number): number {
    if (f > 2500) return 1;
    if (f > 900) return 2;
    if (f > 300) return 3;
    return 4;
}

export interface ResourcePickerOption {
    resourceId: number | null;
    label: string;
    rarity: ResourceRarity | null;
    systems: number;
}

/** The "…" picker: every resource (rarest group first, then by name) with the count of systems where the player knows
 * of it; the ones known nowhere come last in their group. */
export function resourcePickerOptions(resources: readonly Resource[], index: KnownResourceIndex): ResourcePickerOption[] {
    const out: ResourcePickerOption[] = [{ resourceId: null, label: 'All known resources', rarity: null, systems: index.systems.length }];
    const rows = resources.map((r) => ({ r, rarity: resourceRarity(r), systems: index.systemCountByResource.get(r.resourceId) ?? 0 }));
    rows.sort((a, b) => b.rarity - a.rarity || Number(b.systems > 0) - Number(a.systems > 0) || a.r.name.localeCompare(b.r.name));
    for (const x of rows) {
        out.push({ resourceId: x.r.resourceId, label: `${x.r.name} — ${x.systems === 0 ? 'none known' : `${x.systems} system${x.systems === 1 ? '' : 's'}`}`, rarity: x.rarity, systems: x.systems });
    }
    return out;
}

/** Hover text for a system's (or one habitat's) known resources. */
export function resourceTooltipText(
    title: string,
    resources: readonly { resourceId: number; rarity: ResourceRarity; abundance?: number; maxAbundance?: number; habitatCount?: number }[],
    resourceName: (id: number) => string,
): string {
    const lines = [title];
    for (const r of resources) {
        const ab = r.maxAbundance ?? r.abundance ?? 0;
        const n = r.habitatCount !== undefined && r.habitatCount > 1 ? ` · ${r.habitatCount} sources` : '';
        lines.push(`${resourceName(r.resourceId)}  ${abundancePercentText(ab)} (${RARITY_LABELS[r.rarity]})${n}`);
    }
    return lines.join('\n');
}
