// Add-on picker (the new-game wizard's Scenario page): the game starts with a SET of add-ons (scenario ids) instead of
// one scenario. Not a port. Pure: no DOM, no I/O — the wizard, main.ts and the tests share it.
//
// Dependencies. Every `include` of an add-on's scenario.json is a dependency, plus an optional explicit `requires`.
// A dependency is either
//   - "on"   (the default): the add-on only works with the other one running — ticking it ticks the other one, locked,
//             and switches it on (e.g. Time-Bomb Tech → The Cult, New Fauna → Rim Fauna, every threat → the framework);
//   - "data" (DATA_ONLY_INCLUDES below): the other one's overlay and code are loaded (race data, shared state, its
//             flags available) but it stays off unless the player ticks it too (e.g. Robot Mutiny loads Dark Farms for
//             the Harvester race; Internal Security loads the hidden threats "with their own flags").
// Both kinds are listed on the row ("needs" / "loads").
//
// Start. The ticked set plus every dependency, flattened deps-first, is the `include` of a synthetic composite scenario
// (COMPOSITE_SCENARIO_ID) built at game start, so the sim's gate — scenarioRuns reads only the running scenario's own
// direct `include` (tasks/19f-hidden-threats.md §0.9) — sees every package. Each package's overlay is applied once,
// in that order. When one ticked add-on's own include tree already covers the whole set (Time-Bomb Tech with its Cult,
// or any single add-on), the game starts that scenario exactly as before instead: same id, same overlay, same save.
//
// Flags. Every loaded package's flags start at their manifest defaults (an including package's value wins over the
// included one's, as in the nested include merge); then the first flag of every add-on that is on (ticked or "on"
// required) — its master switch — is forced on, and that of every add-on loaded only as data is forced off, so a row's
// tick always says whether the package runs. The per-add-on panels then override the other flags and the params.

import { parseScenarioManifest, type ScenarioManifest } from './manifest';
import { resolveScenarioIncludes, type ScenarioOverlay } from './overlay';

/** galaxy.scenario.id of a game started with several add-ons (its manifest `include` is the flattened set). */
export const COMPOSITE_SCENARIO_ID = 'addons';

export type AddonGroup = 'Rim' | 'Hidden threats' | 'Politics & court' | 'Economy & factions' | 'LLM layer' | 'Visuals' | 'Other';

/** Display order of the picker's groups ("Other" collects scenarios this table does not know, e.g. a new mod). */
export const ADDON_GROUPS: readonly AddonGroup[] = ['Rim', 'Hidden threats', 'Politics & court', 'Economy & factions', 'LLM layer', 'Visuals', 'Other'];

const GROUP_OF: Readonly<Record<string, AddonGroup>> = {
    'rim-fauna': 'Rim',
    'rim-herders': 'Rim',
    'rim-frontier': 'Rim',
    'new-fauna': 'Rim',
    rimTrade: 'Rim',
    cult: 'Hidden threats',
    darkfarms: 'Hidden threats',
    doppelgangers: 'Hidden threats',
    greytide: 'Hidden threats',
    hive: 'Hidden threats',
    silence: 'Hidden threats',
    timebomb: 'Hidden threats',
    robotmutiny: 'Hidden threats',
    corporatecoup: 'Hidden threats',
    ghostarmada: 'Hidden threats',
    emergent: 'Politics & court',
    'espionage-consequences': 'Politics & court',
    'refugees-demographics': 'Politics & court',
    'internal-security': 'Politics & court',
    'court-dynasties': 'Politics & court',
    'frontier-autonomy': 'Politics & court',
    'galactic-council': 'Politics & court',
    reputation: 'Politics & court',
    'lively-galaxy': 'Politics & court',
    'chartered-companies': 'Economy & factions',
    'resource-crises': 'Economy & factions',
    'independents-active': 'Economy & factions',
    'wreckage-salvage': 'Economy & factions',
    exchange: 'Economy & factions',
    'llm-layer': 'LLM layer',
    'event-log': 'LLM layer',
    'art-bundle': 'Visuals',
    'big-galaxies': 'Visuals',
    'rim-atmosphere': 'Visuals',
};

/**
 * Infrastructure and test beds: never listed, pulled in automatically when something needs them. (art-bundle is not
 * here: it only changes rendering, but that is a visible, player-facing choice.)
 */
export const HIDDEN_ADDONS: ReadonlySet<string> = new Set(['threat-framework', 'example', 'ai-parity', 'soak-15y']);

/**
 * Add-ons set on another wizard page (not listed on the Scenario page, but named in the summaries like any other):
 * Smarter AI lives on the Other Empires page (withSmarterAI below).
 */
export const ELSEWHERE_ADDONS: ReadonlySet<string> = new Set(['smarter-ai']);

/** The Smarter AI add-on (scenarios/smarter-ai). */
export const SMARTER_AI_ADDON_ID = 'smarter-ai';

/** The Other Empires page's Smarter AI choice (StartGameOptions.smarterAI). */
export interface SmarterAIChoice {
    enabled: boolean;
    research: boolean;
    growthTaxes: boolean;
    /** Growth taxes: colonies below this % of their maximum population are untaxed. */
    growthTaxThreshold: number;
}

export function defaultSmarterAIChoice(): SmarterAIChoice {
    return { enabled: false, research: true, growthTaxes: true, growthTaxThreshold: 70 };
}

/**
 * The Scenario page's picks and overrides with the Smarter AI choice folded in: ticked = the add-on picked and its
 * sub-switches / threshold as overrides; unticked = the add-on dropped. Pure.
 */
export function withSmarterAI(picked: readonly string[], overrides: AddonOverrides, smart: SmarterAIChoice | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    const p = picked.filter((id) => id !== SMARTER_AI_ADDON_ID);
    if (smart == null || !smart.enabled) return { picked: p, overrides };
    return {
        picked: [...p, SMARTER_AI_ADDON_ID],
        overrides: {
            flags: { ...overrides.flags, smarterAIResearch: smart.research, smarterAIGrowthTax: smart.growthTaxes },
            params: { ...overrides.params, smarterAIGrowthTaxThreshold: smart.growthTaxThreshold },
        },
    };
}

/**
 * `include` entries that are loaded for their data / shared state but are not switched on by the including add-on
 * (their manifests' flags default off there, and the including package works without them running).
 */
export const DATA_ONLY_INCLUDES: Readonly<Record<string, readonly string[]>> = {
    // "Includes the hidden threats (their own flags)": the ledger reads them when they run.
    'internal-security': ['cult', 'doppelgangers', 'hive', 'greytide', 'corporatecoup'],
    // "Includes the rim herders (off by default)": its manifest overrides rimHerders / rimFauna to false.
    'independents-active': ['rim-herders'],
    // "includes darkfarms for the Harvester race the faction wears" (robotMutiny.ts header); the farms stay off.
    robotmutiny: ['darkfarms'],
};

export interface AddonDependency {
    id: string;
    kind: 'on' | 'data';
}

/** One picker entry per scenario of the index. */
export interface AddonInfo {
    id: string;
    name: string;
    description: string;
    group: AddonGroup;
    hidden: boolean;
    /** Direct dependencies: `include` (minus nothing) plus `requires`, each tagged "on" / "data". */
    deps: AddonDependency[];
    conflicts: string[];
    /** The master switch: the manifest's first flag (null: no flags, e.g. the threat framework). */
    masterFlag: string | null;
}

export interface AddonCatalog {
    /** Index order (scenario folder order); the canonical order of a selection. */
    list: AddonInfo[];
    byId: Map<string, AddonInfo>;
    manifests: Map<string, ScenarioManifest>;
}

export function addonDependencies(m: ScenarioManifest): AddonDependency[] {
    const dataOnly = DATA_ONLY_INCLUDES[m.id] ?? [];
    const out: AddonDependency[] = [];
    for (const id of [...m.include, ...(m.requires ?? [])]) {
        if (id === m.id || out.some((d) => d.id === id)) continue;
        out.push({ id, kind: dataOnly.includes(id) ? 'data' : 'on' });
    }
    return out;
}

export function addonCatalog(manifests: readonly ScenarioManifest[]): AddonCatalog {
    const list = manifests.map((m): AddonInfo => ({
        id: m.id,
        name: m.name,
        description: m.description,
        group: GROUP_OF[m.id] ?? 'Other',
        hidden: HIDDEN_ADDONS.has(m.id),
        deps: addonDependencies(m),
        conflicts: [...(m.conflicts ?? [])],
        masterFlag: m.flags.length > 0 ? m.flags[0].name : null,
    }));
    return { list, byId: new Map(list.map((a) => [a.id, a])), manifests: new Map(manifests.map((m) => [m.id, m])) };
}

/**
 * Every add-on `roots` pull in, deps-first (a DFS post-order over `roots` in the given order; each id once). `kinds`
 * picks the edges followed ("on" only: what gets switched on; both: what gets loaded). Unknown ids are skipped; a cycle
 * is cut where it closes (the id being visited is not revisited), so a bad manifest cannot loop.
 */
export function addonClosure(cat: AddonCatalog, roots: readonly string[], kinds: 'on' | 'all' = 'all'): string[] {
    const out: string[] = [];
    const done = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string): void => {
        if (done.has(id) || visiting.has(id)) return;
        const a = cat.byId.get(id);
        if (a === undefined) return;
        visiting.add(id);
        for (const d of a.deps) if (kinds === 'all' || d.kind === 'on') visit(d.id);
        visiting.delete(id);
        done.add(id);
        out.push(id);
    };
    for (const r of roots) visit(r);
    return out;
}

/** Include cycles among the catalog (each as a path a → … → a); empty for a sound index. */
export function addonCycles(cat: AddonCatalog): string[][] {
    const cycles: string[][] = [];
    const state = new Map<string, 1 | 2>();
    const stack: string[] = [];
    const visit = (id: string): void => {
        state.set(id, 1);
        stack.push(id);
        for (const d of cat.byId.get(id)?.deps ?? []) {
            if (!cat.byId.has(d.id)) continue;
            const s = state.get(d.id);
            if (s === 1) cycles.push([...stack.slice(stack.indexOf(d.id)), d.id]);
            else if (s === undefined) visit(d.id);
        }
        stack.pop();
        state.set(id, 2);
    };
    for (const a of cat.list) if (!state.has(a.id)) visit(a.id);
    return cycles;
}

/** A selection in canonical (index) order, unknown and duplicate ids dropped. */
export function canonicalAddons(cat: AddonCatalog, picked: readonly string[]): string[] {
    const set = new Set(picked);
    return cat.list.filter((a) => set.has(a.id)).map((a) => a.id);
}

/** The scenario ids a set of picks starts with: `on` = switched on, `loaded` = every overlay applied (deps-first). */
export function addonSets(cat: AddonCatalog, picked: readonly string[]): { picked: string[]; on: string[]; loaded: string[] } {
    const p = canonicalAddons(cat, picked);
    return { picked: p, on: addonClosure(cat, p, 'on'), loaded: addonClosure(cat, p, 'all') };
}

/** Transitive `include` closure of one scenario (what starting it on its own applies). */
function includeClosure(cat: AddonCatalog, id: string, seen = new Set<string>()): Set<string> {
    if (seen.has(id)) return seen;
    seen.add(id);
    for (const inc of cat.manifests.get(id)?.include ?? []) includeClosure(cat, inc, seen);
    return seen;
}

/**
 * How a selection starts: null = the stock game; `single` = an existing scenario whose own include tree loads exactly
 * the set (the old single-scenario start); otherwise the composite manifest.
 */
export type AddonStartPlan = null | { kind: 'single'; id: string } | { kind: 'composite'; id: typeof COMPOSITE_SCENARIO_ID; manifest: ScenarioManifest };

export function planAddonStart(cat: AddonCatalog, picked: readonly string[]): AddonStartPlan {
    const { picked: p, loaded } = addonSets(cat, picked);
    if (p.length === 0) return null;
    const want = new Set(loaded);
    for (const id of p) {
        const inc = includeClosure(cat, id);
        if (inc.size === want.size && [...inc].every((x) => want.has(x))) return { kind: 'single', id };
    }
    return { kind: 'composite', id: COMPOSITE_SCENARIO_ID, manifest: compositeScenarioManifest(cat, p) };
}

/**
 * The synthetic scenario a multi-add-on game runs: no files, no flags of its own; `include` = the picks and all their
 * dependencies, flattened deps-first (so the direct-include gate sees each one). `picked` keeps its order.
 */
export function compositeScenarioManifest(cat: AddonCatalog, picked: readonly string[]): ScenarioManifest {
    const include = addonClosure(cat, picked, 'all');
    const names = picked.filter((id) => !cat.byId.get(id)?.hidden).map((id) => cat.byId.get(id)?.name ?? id);
    return parseScenarioManifest({
        id: COMPOSITE_SCENARIO_ID,
        name: names.length > 0 ? `Add-ons: ${names.join(', ')}` : 'Add-ons',
        description: `Several add-ons together: ${include.join(', ')}.`,
        include,
    });
}

/**
 * The composite overlay: each included overlay applied once, in `include` order, without re-applying its own nested
 * includes (they are earlier in the flattened list). `byId` = every scenario overlay of the index.
 */
export function compositeOverlay(manifest: ScenarioManifest, byId: ReadonlyMap<string, ScenarioOverlay>): ScenarioOverlay {
    const includes = manifest.include.map((id): ScenarioOverlay => {
        const o = byId.get(id);
        if (o === undefined) throw new Error(`add-on ${id} is not available`);
        return { manifest: { ...o.manifest, include: [] }, files: o.files, includes: [] };
    });
    return { manifest, files: new Map(), includes };
}

/** The overlay a selection starts with (null = stock game). */
export function addonStartOverlay(cat: AddonCatalog, picked: readonly string[], byId: ReadonlyMap<string, ScenarioOverlay>): ScenarioOverlay | null {
    const plan = planAddonStart(cat, picked);
    if (plan === null) return null;
    if (plan.kind === 'composite') return compositeOverlay(plan.manifest, byId);
    const o = byId.get(plan.id);
    if (o === undefined) throw new Error(`add-on ${plan.id} is not available`);
    return resolveScenarioIncludes(o, byId);
}

/**
 * The overlay a saved / chosen scenario needs: `id` alone for a single scenario (its includes resolved), or the
 * composite rebuilt from its saved `include` list (already flattened: rebuilding keeps the same list and order).
 */
export function scenarioOverlayFor(id: string, include: readonly string[] | null, byId: ReadonlyMap<string, ScenarioOverlay>): ScenarioOverlay {
    if (id === COMPOSITE_SCENARIO_ID) {
        if (include === null) throw new Error('composite scenario without its add-on list');
        return compositeOverlay(parseScenarioManifest({ id, name: 'Add-ons', include: [...include] }), byId);
    }
    const o = byId.get(id);
    if (o === undefined) throw new Error(`Scenario "${id}" is not available`);
    return resolveScenarioIncludes(o, byId);
}

/** Flag / param values the player changed in the per-add-on panels. */
export interface AddonOverrides {
    flags: Record<string, boolean>;
    params: Record<string, number>;
}

/**
 * The resolved switches of a selection (see the file comment): every loaded package's flags and params, masters of the
 * "on" set forced on and of the data-only ones forced off, then the player's overrides (never over a master switch).
 */
export function resolveAddonSwitches(cat: AddonCatalog, picked: readonly string[], overrides: AddonOverrides = { flags: {}, params: {} }): { flags: Record<string, boolean>; params: Record<string, number> } {
    const { on, loaded } = addonSets(cat, picked);
    const flags: Record<string, boolean> = {};
    const params: Record<string, number> = {};
    // Dependents before their dependencies: the including package's definition of a shared name wins.
    for (const id of [...loaded].reverse()) {
        const m = cat.manifests.get(id)!;
        for (const f of m.flags) if (!(f.name in flags)) flags[f.name] = f.default;
        for (const p of m.params) if (!(p.name in params)) params[p.name] = p.default;
    }
    const onSet = new Set(on);
    const masters = new Set<string>();
    for (const id of loaded) {
        const master = cat.byId.get(id)!.masterFlag;
        if (master !== null && !onSet.has(id)) {
            masters.add(master);
            flags[master] = false;
        }
    }
    for (const id of on) {
        const master = cat.byId.get(id)!.masterFlag;
        if (master !== null) {
            masters.add(master);
            flags[master] = true;
        }
    }
    for (const [k, v] of Object.entries(overrides.flags)) if (k in flags && !masters.has(k)) flags[k] = v;
    for (const [k, v] of Object.entries(overrides.params)) if (k in params && Number.isFinite(v)) params[k] = v;
    return { flags, params };
}

/** One row of the picker. */
export interface AddonRow {
    id: string;
    name: string;
    description: string;
    checked: boolean;
    /** Checked because a ticked add-on needs it: cannot be unticked. */
    locked: boolean;
    /** Names of the ticked add-ons that need it ("required by …" / tooltip "needed by …"). */
    requiredBy: string[];
    /** Names of the add-ons it needs switched on ("needs: A, B"). Hidden infrastructure is left out. */
    needs: string[];
    /** Names of the add-ons it loads without switching them on ("loads: A"). */
    loads: string[];
    /** Loaded (as data) for these ticked add-ons while itself off. */
    loadedFor: string[];
    /** Greyed out: conflicts with a ticked add-on (names). */
    conflictsWith: string[];
    disabled: boolean;
    /** Hover text: why the checkbox is locked / disabled (empty when it is free). */
    tooltip: string;
}

export interface AddonPickerModel {
    groups: { group: AddonGroup; rows: AddonRow[] }[];
    /** Every add-on that will run (visible names, index order). */
    finalNames: string[];
    /** "None (the original game)" or "A, B, C". */
    summary: string;
    /** Add-ons switched on, with a parameter panel (hidden infrastructure included when it has flags / params). */
    panels: string[];
}

function conflictsBetween(cat: AddonCatalog, a: string, b: string): boolean {
    return (cat.byId.get(a)?.conflicts.includes(b) ?? false) || (cat.byId.get(b)?.conflicts.includes(a) ?? false);
}

/** The picker's state for a set of explicit ticks (pure; the wizard renders it). */
export function addonPickerModel(cat: AddonCatalog, picked: readonly string[]): AddonPickerModel {
    const { picked: p, on, loaded } = addonSets(cat, picked);
    const onSet = new Set(on);
    const loadedSet = new Set(loaded);
    const name = (id: string): string => cat.byId.get(id)?.name ?? id;
    const visible = (id: string): boolean => cat.byId.has(id) && !cat.byId.get(id)!.hidden;
    const closureOn = new Map(p.map((id) => [id, new Set(addonClosure(cat, [id], 'on'))] as const));
    const closureAll = new Map(p.map((id) => [id, new Set(addonClosure(cat, [id], 'all'))] as const));
    const groups: { group: AddonGroup; rows: AddonRow[] }[] = [];
    for (const group of ADDON_GROUPS) {
        const rows: AddonRow[] = [];
        for (const a of cat.list) {
            if (a.hidden || ELSEWHERE_ADDONS.has(a.id) || a.group !== group) continue;
            const requiredBy = p.filter((x) => x !== a.id && closureOn.get(x)!.has(a.id)).map(name);
            const checked = onSet.has(a.id);
            const loadedFor = checked || !loadedSet.has(a.id) ? [] : p.filter((x) => closureAll.get(x)!.has(a.id)).map(name);
            const conflictsWith = checked ? [] : on.filter((x) => conflictsBetween(cat, a.id, x)).map(name);
            const locked = requiredBy.length > 0;
            const disabled = locked || conflictsWith.length > 0;
            rows.push({
                id: a.id,
                name: a.name,
                description: a.description,
                checked,
                locked,
                requiredBy,
                needs: a.deps.filter((d) => d.kind === 'on' && visible(d.id)).map((d) => name(d.id)),
                loads: a.deps.filter((d) => d.kind === 'data' && visible(d.id)).map((d) => name(d.id)),
                loadedFor,
                conflictsWith,
                disabled,
                tooltip: locked ? `needed by ${requiredBy.join(', ')}` : conflictsWith.length > 0 ? `conflicts with ${conflictsWith.join(', ')}` : '',
            });
        }
        rows.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
        if (rows.length > 0) groups.push({ group, rows });
    }
    const finalNames = cat.list.filter((a) => onSet.has(a.id) && !a.hidden).map((a) => a.name);
    const panels = on.filter((id) => {
        if (ELSEWHERE_ADDONS.has(id)) return false;
        const m = cat.manifests.get(id)!;
        return m.flags.length > 1 || m.params.length > 0;
    });
    return { groups, finalNames, summary: finalNames.length === 0 ? 'None (the original game)' : finalNames.join(', '), panels };
}

/**
 * Ticks (`on`) or unticks an add-on; returns the new explicit picks (canonical order). Ticking something that conflicts
 * with a running add-on, or unticking one a ticked add-on needs, changes nothing. Unticking drops the explicit tick;
 * add-ons it had pulled in go with it unless another tick still needs them.
 */
export function toggleAddon(cat: AddonCatalog, picked: readonly string[], id: string, on: boolean): string[] {
    const p = canonicalAddons(cat, picked);
    const a = cat.byId.get(id);
    if (a === undefined || a.hidden) return p;
    if (on) {
        const running = addonClosure(cat, p, 'on');
        if (running.includes(id)) return p;
        const adding = addonClosure(cat, [id], 'on');
        if (adding.some((x) => running.some((y) => conflictsBetween(cat, x, y)))) return p;
        return canonicalAddons(cat, [...p, id]);
    }
    if (p.some((x) => x !== id && addonClosure(cat, [x], 'on').includes(id))) return p;
    return p.filter((x) => x !== id);
}
