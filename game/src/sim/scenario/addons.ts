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

export type AddonGroup = 'Rim' | 'Hidden threats' | 'Giantworks' | 'Politics & court' | 'Economy & factions' | 'LLM layer' | 'Visuals' | 'Other';

/** Display order of the picker's groups, from the most vanilla-like to the most changes ("Other" collects scenarios this table does not know, e.g. a new mod). */
export const ADDON_GROUPS: readonly AddonGroup[] = ['Hidden threats', 'Giantworks', 'Economy & factions', 'Politics & court', 'Rim', 'LLM layer', 'Visuals', 'Other'];

/**
 * Picker status, ONE table: 'recommended' = top section; any other string = "Work in progress" section, the string being the
 * hover reason. Moving an add-on between sections is a one-line change. Visible add-ons not listed are WIP (WIP_DEFAULT_REASON).
 */
export const ADDON_STATUS: Readonly<Record<string, string>> = {
    'rimTrade': 'still being tuned',
    'rim-fauna': 'still being tuned',
    'rim-herders': 'still being tuned',
    'rim-frontier': 'still being tuned',
    'new-fauna': 'still being tuned',
    'rim-atmosphere': 'still being tuned',
    'cult': 'recommended',
    'hive': 'recommended',
    'doppelgangers': 'recommended',
    'darkfarms': 'recommended',
    'robotmutiny': 'recommended',
    'internal-security': 'recommended',
    'reputation': 'recommended',
    'emergent': 'off for now: being reworked',
    'espionage-consequences': 'recommended',
    'exchange': 'recommended',
    'chartered-companies': 'balance still being tuned',
    'art-bundle': 'visual extras, still in progress',
    'lively-galaxy': 'still being tuned',
    'corporatecoup': 'does not trigger in real games yet',
    'greytide': 'drones are not real ships yet',
    'privateers': 'recommended',
    'frontier-autonomy': 'no UI yet',
    'court-dynasties': 'on hold',
    'characters-victory': 'recommended',
    'colony-economy': 'new, balance pending',
    'voidbloom': 'still being tuned',
    'generation-ships': 'recommended',
    'purifier': 'recommended',
    'archive-cores': 'recommended',
    'probe-swarm': 'recommended',
    giantworks: 'recommended',
    'slavery': 'recommended',
    'scorched-earth': 'work in progress',
    'orbital-superiority': 'new',
    'longer-ground-combat': 'new',
    'jump-interdiction': 'new',
    'blockades-bite': 'new',
    mothballing: 'new',
    'slow-hyperdrive': 'new',
    veterans: 'new',
    'bvr-combat': 'new; art is placeholder, AI balance still being tuned',
    'decoys-chaff': 'new',
    'ambush-strike': 'new',
    'critical-hits': 'new',
    'damage-control': 'new',
    'armour-facing': 'new',
    'surrender-wrecks': 'new',
    'coordinated-landings': 'new',
    'war-crimes': 'recommended',
    'timebomb': 'lightly tested; the AI rarely uses it',
    'ghostarmada': 'lightly tested; the AI rarely uses it',
    'independents-active': 'lightly tested; the AI rarely uses it',
    'refugees-demographics': 'lightly tested; the AI rarely uses it',
    'llm-layer': 'new; needs a local model',
};
export const WIP_DEFAULT_REASON = 'still in progress';
export const ADDON_SECTIONS = ['Recommended', 'Work in progress'] as const;
export type AddonSection = (typeof ADDON_SECTIONS)[number];

/** The hover reason of a work-in-progress add-on, or null when it is recommended. */
export function addonWipReason(id: string): string | null {
    const v = ADDON_STATUS[id];
    return v === 'recommended' ? null : (v ?? WIP_DEFAULT_REASON);
}

const GROUP_OF: Readonly<Record<string, AddonGroup>> = {
    'rim-fauna': 'Rim',
    'rim-herders': 'Rim',
    'rim-frontier': 'Rim',
    'new-fauna': 'Rim',
    rimTrade: 'Rim',
    voidbloom: 'Rim',
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
    'generation-ships': 'Hidden threats',
    'archive-cores': 'Hidden threats',
    'probe-swarm': 'Hidden threats',
    giantworks: 'Giantworks',
    'void-whale': 'Hidden threats',
    'hollow-fleet': 'Hidden threats',
    purifier: 'Hidden threats',
    emergent: 'Politics & court',
    'espionage-consequences': 'Politics & court',
    'refugees-demographics': 'Politics & court',
    'internal-security': 'Politics & court',
    'court-dynasties': 'Politics & court',
    'frontier-autonomy': 'Politics & court',
    'galactic-council': 'Politics & court',
    'characters-victory': 'Politics & court',
    reputation: 'Politics & court',
    'lively-galaxy': 'Politics & court',
    'chartered-companies': 'Economy & factions',
    'resource-crises': 'Economy & factions',
    'independents-active': 'Economy & factions',
    'wreckage-salvage': 'Economy & factions',
    'colony-defence': 'Economy & factions',
    'scorched-earth': 'Politics & court',
    'war-crimes': 'Politics & court',
    'bounty-hunters': 'Politics & court',
    'orbital-superiority': 'Other',
    'longer-ground-combat': 'Other',
    'jump-interdiction': 'Other',
    'blockades-bite': 'Other',
    mothballing: 'Other',
    'slow-hyperdrive': 'Other',
    veterans: 'Other',
    beaching: 'Other',
    'bvr-combat': 'Other',
    'decoys-chaff': 'Other',
    'ambush-strike': 'Other',
    'critical-hits': 'Other',
    'damage-control': 'Other',
    'armour-facing': 'Other',
    'surrender-wrecks': 'Other',
    'coordinated-landings': 'Other',
    slavery: 'Economy & factions',
    exchange: 'Economy & factions',
    privateers: 'Economy & factions',
    'colony-economy': 'Economy & factions',
    'themed-names': 'Visuals',
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
// big-galaxies: its extended palette is now automatic in the base game (empireColors.ts); old saves with the add-on still load.
// resource-crises: withdrawn from the picker (its per-luxury approval loss stacked to absurd values); saves that use it still load.
// colony-defence: withdrawn from the picker (the user wants the original's pirate control); saves that use it still load.
// wreckage-salvage: RETIRED (the user: it should not be enableable); saves that had it on load with it off and the debris fields removed (scenario/retired.ts).
// silence: TEMPORARILY DISABLED (the user; to come back to): code and data stay, a save that had it on loads with it off and its zone removed (scenario/retired.ts).
export const HIDDEN_ADDONS: ReadonlySet<string> = new Set(['threat-framework', 'example', 'ai-parity', 'soak-15y', 'resource-crises', 'colony-defence', 'big-galaxies', 'galactic-council', 'themed-names', 'event-log', 'fighting-retreats', 'coordinated-landings', 'decoys-chaff', 'ambush-strike', 'critical-hits', 'damage-control', 'armour-facing', 'surrender-wrecks', 'wreckage-salvage', 'silence']);

/**
 * Add-ons set on another wizard page (not listed on the Scenario page, but named in the summaries like any other):
 * Smarter AI and Orbital superiority live on the Other Empires page (withSmarterAI / withOrbitalSuperiority below).
 */
export const ELSEWHERE_ADDONS: ReadonlySet<string> = new Set(['smarter-ai', 'orbital-superiority', 'longer-ground-combat', 'jump-interdiction', 'blockades-bite', 'mothballing', 'slow-hyperdrive', 'fighting-retreats', 'veterans', 'beaching', 'coordinated-landings']);

/** openDWU Classic: add-ons every game starts with (treated as base game: no picker). Smarter AI stays the Other Empires page's toggle. */
export const CLASSIC_BASE_ADDONS: readonly string[] = ['themed-names', 'event-log'];
/** Add-ons every new game starts with in BOTH editions (base game: hidden from the picker, always ticked). */
export const BASE_ADDONS: readonly string[] = CLASSIC_BASE_ADDONS;

/** The Fighting retreats gameplay change (scenarios/fighting-retreats): hidden from the picker, the Other Empires page's checkbox. */
export const FIGHTING_RETREATS_ADDON_ID = 'fighting-retreats';

/** Folds the Other Empires page's "Fighting retreats" checkbox (StartGameOptions.fightingRetreats) into the picks. */
export function withFightingRetreats(picked: readonly string[], overrides: AddonOverrides, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    return withToggleAddon(picked, overrides, FIGHTING_RETREATS_ADDON_ID, 'fightingRetreats', on);
}

/** The Smarter AI add-on (scenarios/smarter-ai). */
export const SMARTER_AI_ADDON_ID = 'smarter-ai';

/** The Other Empires page's Smarter AI choice (StartGameOptions.smarterAI). */
export interface SmarterAIChoice {
    enabled: boolean;
    research: boolean;
    growthTaxes: boolean;
    /** Cut costs when broke (smarterAIBudget; absent in older options = on). */
    budget?: boolean;
    /** Keep fleets up to date (smarterAIRetrofit; absent in older options = on). */
    retrofit?: boolean;
    /** Growth taxes: colonies below this % of their maximum population are untaxed. */
    growthTaxThreshold: number;
    /** Smarter colony picks (absent = on). */
    colonies?: boolean;
    /** Absorb independent worlds (absent = on). */
    independents?: boolean;
    /** Defence that counts pirates (smarterAIDefence). */
    defence?: boolean;
    /** Pirate clean-up (smarterAIPirates). */
    pirates?: boolean;
    /** Statecraft (smarterAIResearchStations / Wonders / Espionage / Diplomacy; absent = on). */
    researchStations?: boolean;
    wonders?: boolean;
    espionage?: boolean;
    diplomacy?: boolean;
    /** Ship design (smarterAIDesignTune / WeaponFocus / DesignScale / DesignTrim; absent = off). */
    designTune?: boolean;
    weaponFocus?: boolean;
    designScale?: boolean;
    designTrim?: boolean;
    /** Pre-warp opening (smarterAIOpening; absent = on) and the capital population share that ends it (absent = 90). */
    opening?: boolean;
    openingPopShare?: number;
}

export function defaultSmarterAIChoice(): SmarterAIChoice {
    return { enabled: true, research: true, growthTaxes: true, growthTaxThreshold: 50, budget: true, retrofit: true, colonies: true, independents: true, defence: true, pirates: true, researchStations: true, wonders: true, espionage: true, diplomacy: true, designTune: true, weaponFocus: true, designScale: true, designTrim: true, opening: true, openingPopShare: 90 };
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
            flags: {
                ...overrides.flags,
                smarterAIResearch: smart.research,
                smarterAIGrowthTax: smart.growthTaxes,
                smarterAIBudget: smart.budget !== false,
                smarterAIRetrofit: smart.retrofit !== false,
                smarterAIColonies: smart.colonies !== false,
                smarterAIIndependents: smart.independents !== false,
                smarterAIDefence: smart.defence ?? true,
                smarterAIPirates: smart.pirates ?? true,
                smarterAIResearchStations: smart.researchStations ?? true,
                smarterAIWonders: smart.wonders ?? true,
                smarterAIEspionage: smart.espionage ?? true,
                smarterAIDiplomacy: smart.diplomacy ?? true,
                smarterAIDesignTune: smart.designTune ?? false,
                smarterAIWeaponFocus: smart.weaponFocus ?? false,
                smarterAIDesignScale: smart.designScale ?? false,
                smarterAIDesignTrim: smart.designTrim ?? false,
                smarterAIOpening: smart.opening ?? true,
            },
            params: { ...overrides.params, smarterAIGrowthTaxThreshold: smart.growthTaxThreshold, smarterAIOpeningPopShare: smart.openingPopShare ?? 90 },
        },
    };
}

/** The Orbital superiority gameplay change (scenarios/orbital-superiority; the Other Empires page's "Gameplay changes"). */
export const ORBITAL_SUPERIORITY_ADDON_ID = 'orbital-superiority';

/**
 * The picks with the Other Empires page's Orbital superiority checkbox folded in (StartGameOptions.orbitalSuperiority):
 * ticked = the add-on picked (its master flag on), unticked = dropped. Pure.
 */
export function withOrbitalSuperiority(picked: readonly string[], overrides: AddonOverrides, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    return withToggleAddon(picked, overrides, ORBITAL_SUPERIORITY_ADDON_ID, 'orbitalSuperiority', on);
}

/** The Longer ground battles gameplay change (scenarios/longer-ground-combat; also under "Gameplay changes"). */
export const LONGER_GROUND_COMBAT_ADDON_ID = 'longer-ground-combat';

/** The picks with the Other Empires page's Longer ground battles checkbox folded in (StartGameOptions.longerGroundCombat). Pure. */
export function withLongerGroundCombat(picked: readonly string[], overrides: AddonOverrides, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    return withToggleAddon(picked, overrides, LONGER_GROUND_COMBAT_ADDON_ID, 'longerGroundCombat', on);
}

/** The Defensive jump interdiction gameplay change (scenarios/jump-interdiction; also under "Gameplay changes"). */
export const JUMP_INTERDICTION_ADDON_ID = 'jump-interdiction';

/** The picks with the Other Empires page's Jump interdiction checkbox folded in (StartGameOptions.jumpInterdiction). Pure. */
export function withJumpInterdiction(picked: readonly string[], overrides: AddonOverrides, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    return withToggleAddon(picked, overrides, JUMP_INTERDICTION_ADDON_ID, 'jumpInterdiction', on);
}

/** The Blockades that bite gameplay change (scenarios/blockades-bite; also under "Gameplay changes"). */
export const BLOCKADES_BITE_ADDON_ID = 'blockades-bite';

/** The picks with the Other Empires page's Blockades that bite checkbox folded in (StartGameOptions.blockadesBite). Pure. */
export function withBlockadesBite(picked: readonly string[], overrides: AddonOverrides, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    return withToggleAddon(picked, overrides, BLOCKADES_BITE_ADDON_ID, 'blockadesBite', on);
}

/** The Mothballing gameplay change (scenarios/mothballing; also under "Gameplay changes"). */
export const MOTHBALLING_ADDON_ID = 'mothballing';

/** The picks with the Other Empires page's Mothballing checkbox folded in (StartGameOptions.mothballing). Pure. */
export function withMothballing(picked: readonly string[], overrides: AddonOverrides, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    return withToggleAddon(picked, overrides, MOTHBALLING_ADDON_ID, 'mothballing', on);
}

/** The Slower hyperdrive spool gameplay change (scenarios/slow-hyperdrive; also under "Gameplay changes"). */
export const SLOW_HYPERDRIVE_ADDON_ID = 'slow-hyperdrive';

/** The picks with the Other Empires page's Slower hyperdrive checkbox folded in (StartGameOptions.slowHyperdrive). Pure. */
export function withSlowHyperdrive(picked: readonly string[], overrides: AddonOverrides, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    return withToggleAddon(picked, overrides, SLOW_HYPERDRIVE_ADDON_ID, 'slowHyperdrive', on);
}

/** The Veterans gameplay change (scenarios/veterans; also under "Gameplay changes"). */
export const VETERANS_ADDON_ID = 'veterans';

/** The picks with the Other Empires page's Veterans checkbox folded in (StartGameOptions.veterans). Pure. */
export function withVeterans(picked: readonly string[], overrides: AddonOverrides, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    return withToggleAddon(picked, overrides, VETERANS_ADDON_ID, 'veterans', on);
}

/** The Beached ships gameplay change (scenarios/beaching; also under "Gameplay changes"). */
export const BEACHING_ADDON_ID = 'beaching';

/** The picks with the Other Empires page's Beached ships checkbox folded in (StartGameOptions.beaching). Pure. */
export function withBeaching(picked: readonly string[], overrides: AddonOverrides, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    return withToggleAddon(picked, overrides, BEACHING_ADDON_ID, 'beaching', on);
}

/** The BVR combat gameplay change (scenarios/bvr-combat; also under "Gameplay changes"). */
export const BVR_COMBAT_ADDON_ID = 'bvr-combat';

/** The picks with the Other Empires page's BVR combat checkbox folded in (StartGameOptions.bvrCombat). Pure. */
export function withBvrCombat(picked: readonly string[], overrides: AddonOverrides, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    return withToggleAddon(picked, overrides, BVR_COMBAT_ADDON_ID, 'bvrCombat', on);
}

/**
 * The six combat gameplay changes after BVR combat (scenarios/<id>; each its own checkbox under "Gameplay changes" on the Other
 * Empires page, off by default): the StartGameOptions key, the add-on id and the master flag of each.
 */
export const COMBAT2_ADDONS = [
    { key: 'decoys', id: 'decoys-chaff', flag: 'decoys' },
    { key: 'ambushStrike', id: 'ambush-strike', flag: 'ambush' },
    { key: 'criticalHits', id: 'critical-hits', flag: 'criticalHits' },
    { key: 'damageControl', id: 'damage-control', flag: 'damageControl' },
    { key: 'armourFacing', id: 'armour-facing', flag: 'armourFacing' },
    { key: 'surrenderWrecks', id: 'surrender-wrecks', flag: 'surrender' },
] as const;
export type Combat2Key = (typeof COMBAT2_ADDONS)[number]['key'];
export type Combat2Choice = { readonly [K in Combat2Key]?: boolean | null };

/** The picks with the Other Empires page's six combat checkboxes folded in (StartGameOptions decoys ... surrenderWrecks). Pure. */
export function withCombat2(picked: readonly string[], overrides: AddonOverrides, choice: Combat2Choice | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    let w = { picked: [...picked], overrides };
    for (const a of COMBAT2_ADDONS) w = withToggleAddon(w.picked, w.overrides, a.id, a.flag, choice?.[a.key]);
    return w;
}

/** The Coordinated landings gameplay change (scenarios/coordinated-landings; also under "Gameplay changes"). */
export const COORDINATED_LANDINGS_ADDON_ID = 'coordinated-landings';

/**
 * The Other Empires page's Coordinated landings state (StartGameOptions.coordinatedLandings): an explicit tick or untick
 * wins; unset follows Smarter AI (on whenever Smarter AI is on, off otherwise).
 */
export function coordinatedLandingsChoice(explicit: boolean | undefined, smart: SmarterAIChoice | null | undefined): boolean {
    return explicit ?? (smart != null && smart.enabled);
}

/** The picks with the Coordinated landings checkbox folded in (see coordinatedLandingsChoice). Pure. */
export function withCoordinatedLandings(picked: readonly string[], overrides: AddonOverrides, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    return withToggleAddon(picked, overrides, COORDINATED_LANDINGS_ADDON_ID, 'coordinatedLandings', on);
}

/** A one-checkbox add-on folded into the picks: ticked = picked with its master flag on, unticked = dropped. Pure. */
function withToggleAddon(picked: readonly string[], overrides: AddonOverrides, id: string, flag: string, on: boolean | null | undefined): { picked: string[]; overrides: AddonOverrides } {
    const p = picked.filter((x) => x !== id);
    if (on !== true) return { picked: p, overrides };
    return { picked: [...p, id], overrides: { flags: { ...overrides.flags, [flag]: true }, params: overrides.params } };
}

/**
 * `include` entries that are loaded for their data / shared state but are not switched on by the including add-on
 * (their manifests' flags default off there, and the including package works without them running).
 */
export const DATA_ONLY_INCLUDES: Readonly<Record<string, readonly string[]>> = {
    // "Includes the hidden threats (their own flags)": the ledger reads them when they run.
    // Emergent Galaxy (internal politics) is off for now (user 2026-10-16): loaded for its shared state, never switched on.
    'internal-security': ['cult', 'doppelgangers', 'hive', 'greytide', 'corporatecoup', 'emergent'],
    reputation: ['emergent'],
    // "Includes the rim herders (off by default)": its manifest overrides rimHerders / rimFauna to false.
    'independents-active': ['rim-herders'],
    // "includes darkfarms for the Harvester race the faction wears" (robotMutiny.ts header); the farms stay off.
    robotmutiny: ['darkfarms'],
    // Giantworks loads darkfarms for the Harvester race the awakened Ultramind wears (ultramind.ts, as Robot Mutiny); the farms stay off.
    giantworks: ['darkfarms'],
    // Loaded only so the war goals (peace talks) can run: llmFoundations requiresFlags forces warGoals on and the rest off.
    'llm-layer': ['lively-galaxy'],
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
    /** Null = recommended; else the work-in-progress hover reason. */
    wip: string | null;
    /** Direct dependencies: `include` (minus nothing) plus `requires`, each tagged "on" / "data". */
    deps: AddonDependency[];
    conflicts: string[];
    /** The master switch: the manifest's first flag (null: no flags, e.g. the threat framework). */
    masterFlag: string | null;
    /** Can be switched on in a saved game (the Load screen's "Add add-ons…"; manifest addableToSave). */
    addableToSave: boolean;
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
        wip: addonWipReason(m.id),
        deps: addonDependencies(m),
        conflicts: [...(m.conflicts ?? [])],
        masterFlag: m.flags.length > 0 ? m.flags[0].name : null,
        addableToSave: m.addableToSave === true,
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
        if (master !== null && !subAddonOfRunning(id, onSet)) {
            masters.add(master);
            flags[master] = true;
        }
    }
    for (const [k, v] of Object.entries(overrides.flags)) if (k in flags && !masters.has(k)) flags[k] = v;
    for (const [k, v] of Object.entries(overrides.params)) if (k in params && Number.isFinite(v)) params[k] = v;
    // Flag-level requiresFlags: an add-on that is only loaded (not on) gets every flag off but the forced ones.
    const forced = forcedFlags(cat, flags, on);
    for (const [target, fl] of forced) {
        if (!onSet.has(target)) for (const f of cat.manifests.get(target)?.flags ?? []) flags[f.name] = false;
        for (const f of fl.keys()) flags[f] = true;
    }
    // The galactic council is a hidden background part of Characters & Victory: its flag follows cvCouncil (the Interstellar Diet).
    if (onSet.has('characters-victory') && onSet.has('galactic-council') && 'cvCouncil' in flags && 'galacticCouncil' in flags) flags.galacticCouncil = flags.cvCouncil;
    return { flags, params };
}

/**
 * Sub-add-ons: add-ons that are the sub-options of another one (BVR combat's six combat changes). Ticking the parent loads and
 * runs them all, but each one's master flag is an ordinary option of the parent's panel (default on, the player can switch it
 * off) instead of being forced on. Ticked on their own (an old save or options with just one of them) they are masters again.
 */
export const SUB_ADDONS: Readonly<Record<string, readonly string[]>> = {
    'bvr-combat': ['decoys-chaff', 'ambush-strike', 'critical-hits', 'damage-control', 'armour-facing', 'surrender-wrecks'],
};

/** The parent add-on of a sub-add-on (null: not a sub-add-on). */
export function subAddonParent(id: string): string | null {
    for (const [parent, subs] of Object.entries(SUB_ADDONS)) if (subs.includes(id)) return parent;
    return null;
}

function subAddonOfRunning(id: string, onSet: ReadonlySet<string>): boolean {
    const parent = subAddonParent(id);
    return parent !== null && onSet.has(parent);
}

/**
 * Flags forced on by requiresFlags: target add-on id -> (flag -> names of the requiring flags' add-ons). A requirer
 * counts when its add-on is on and its flag is on in `flags`.
 */
export function forcedFlags(cat: AddonCatalog, flags: Readonly<Record<string, boolean>>, on: readonly string[]): Map<string, Map<string, string[]>> {
    const out = new Map<string, Map<string, string[]>>();
    for (const id of on) {
        const m = cat.manifests.get(id);
        for (const f of m?.flags ?? []) {
            if (flags[f.name] !== true || f.requiresFlags === undefined) continue;
            for (const [target, names] of Object.entries(f.requiresFlags)) {
                if (!cat.byId.has(target)) continue;
                const t = out.get(target) ?? new Map<string, string[]>();
                for (const n of names) t.set(n, [...(t.get(n) ?? []), m!.name]);
                out.set(target, t);
            }
        }
    }
    return out;
}

/**
 * Flag-level dependencies (manifest flag `requiresAddons`): every switched-on flag of a running add-on pulls its
 * required add-ons into the picks (repeated until stable; a dependency that conflicts with a running add-on, or that
 * the index lacks, is skipped). Pure and deterministic; a selection with no such flag on is returned unchanged.
 */
export function withFlagAddons(cat: AddonCatalog, picked: readonly string[], overrides: AddonOverrides = { flags: {}, params: {} }): string[] {
    let p = canonicalAddons(cat, picked);
    for (let guard = 0; guard < 16; guard++) {
        const { on } = addonSets(cat, p);
        const flags = resolveAddonSwitches(cat, p, overrides).flags;
        const add: string[] = [];
        for (const id of on) {
            for (const f of cat.manifests.get(id)?.flags ?? []) {
                if (flags[f.name] !== true) continue;
                for (const dep of f.requiresAddons ?? []) {
                    if (cat.byId.has(dep) && !on.includes(dep) && !add.includes(dep)) add.push(dep);
                }
            }
        }
        const next = add.filter((d) => toggleAddon(cat, p, d, true).includes(d));
        if (next.length === 0) return p;
        p = canonicalAddons(cat, [...p, ...next]);
    }
    return p;
}

/**
 * Expansions: ONE picker switch that ticks a group of add-ons. Purely a picker grouping: the switch ticks / unticks
 * the members as ordinary explicit picks, so a game (and its save, and the lobby's package list) records the members
 * exactly as if they had been ticked one by one, each member's manifest flags, params and placement included. Each
 * member can still be switched off (or on) alone, in the picker's "Advanced" fold; with every member off the
 * expansion is off and the game is the stock one. Hidden members (threat-framework) come in as dependencies.
 */
export interface Expansion {
    id: string;
    name: string;
    description: string;
    /** Scenario ids, in display order (those the index does not have are skipped). */
    members: readonly string[];
}

export const EXPANSIONS: readonly Expansion[] = [
    { id: 'the-rim', name: 'The Rim', description: 'The frontier beyond the core: rim trade, frontier settlement, wild fauna and herders, the rim atmosphere, and the Voidbloom War.', members: ['rimTrade', 'rim-frontier', 'rim-fauna', 'rim-herders', 'rim-atmosphere', 'new-fauna', 'voidbloom'] },
    { id: 'politics-characters', name: 'Politics & Characters', description: 'Governors, VIPs and the Galactic Council, internal security, reputation, espionage fallout, frontier autonomy, refugees, war crimes remembered and bounty hunters.', members: ['characters-victory', 'internal-security', 'reputation', 'espionage-consequences', 'frontier-autonomy', 'refugees-demographics', 'war-crimes', 'bounty-hunters'] },
    { id: 'economy', name: 'Economy', description: 'Colony economy, the exchange, chartered companies, corporate coups and privateers.', members: ['colony-economy', 'exchange', 'chartered-companies', 'corporatecoup', 'privateers'] },
    { id: 'galactic-threats', name: 'Galactic Threats', description: 'The hidden end-game threats (cult, hive, greytide, ghost armada, robot mutiny, time bomb, doppelgangers, dark farms) and the early ones: generation ships, a dead probe swarm, the archive cores they leave and the Void Whale, plus the mid-game Purifier: an ancient planet destroyer you can hunt.', members: ['threat-framework', 'generation-ships', 'probe-swarm', 'hollow-fleet', 'archive-cores', 'void-whale', 'purifier', 'cult', 'hive', 'greytide', 'ghostarmada', 'robotmutiny', 'timebomb', 'doppelgangers', 'darkfarms'] },
    { id: 'giantworks', name: 'Giantworks', description: 'The independents\' Great Work: worlds in three far-apart regions band together and build a gigantic wonder in secret, never known for certain until it is finished. Each wonder it can turn out to be has its own switch in the add-on\'s settings.', members: ['giantworks'] },
    { id: 'living-galaxy', name: 'Living Galaxy', description: 'A galaxy that moves on its own: lively events and active independents.', members: ['lively-galaxy', 'independents-active'] },
];

/**
 * Add-ons whose threat aims at one empire: right-clicking their row in the picker toggles "guarantee this threat
 * against my empire" (the add-on's `<key>Force` param, 1 = on; threats/framework.ts threatForced). add-on id → param.
 */
export const FORCEABLE_THREATS: Readonly<Record<string, string>> = { 'generation-ships': 'generationShipsForce', cult: 'cultForce', purifier: 'purifierForce' };

/**
 * The expansion's members this index has, visible ones only (hidden infrastructure comes in as a dependency). Work in
 * progress add-ons are not members for the switch: they live in the picker's closed WIP dropdown, ticked one by one
 * (an expansion with no other member does not appear). A recommended member that needs a WIP add-on still pulls it in.
 */
export function expansionMembers(cat: AddonCatalog, e: Expansion): string[] {
    return e.members.filter((id) => cat.byId.has(id) && !cat.byId.get(id)!.hidden && addonWipReason(id) === null);
}

/** Ticks / unticks every member of an expansion (members that conflict or are needed by others stay as they are). */
export function toggleExpansion(cat: AddonCatalog, picked: readonly string[], id: string, on: boolean): string[] {
    const e = EXPANSIONS.find((x) => x.id === id);
    let p = canonicalAddons(cat, picked);
    if (e === undefined) return p;
    // Repeat: a member needed by a later member (untick) or needing an earlier one can only change on the second pass.
    for (let pass = 0; pass < 2; pass++) for (const m of expansionMembers(cat, e)) p = toggleAddon(cat, p, m, on);
    return p;
}

/** One expansion of the picker: 'on' = every member runs, 'partial' = some, 'off' = none. */
export interface ExpansionRow {
    id: string;
    name: string;
    description: string;
    state: 'on' | 'partial' | 'off';
    /** Members (the Advanced fold), same rows as the groups'. */
    members: AddonRow[];
}

/** The picker's expansions for a set of ticks (members in display order). */
export function expansionRows(cat: AddonCatalog, model: AddonPickerModel): ExpansionRow[] {
    const rows = new Map(model.groups.flatMap((g) => g.rows).map((r) => [r.id, r] as const));
    const out: ExpansionRow[] = [];
    for (const e of EXPANSIONS) {
        const members = expansionMembers(cat, e).map((id) => rows.get(id)).filter((r): r is AddonRow => r !== undefined);
        if (members.length === 0) continue;
        const n = members.filter((r) => r.checked).length;
        out.push({ id: e.id, name: e.name, description: e.description, state: n === 0 ? 'off' : n === members.length ? 'on' : 'partial', members });
    }
    return out;
}

/** Ids that belong to some expansion (the picker lists them under it, not in the plain groups). */
export function expansionMemberIds(cat: AddonCatalog): Set<string> {
    return new Set(EXPANSIONS.flatMap((e) => expansionMembers(cat, e)));
}

/** Expansions switched on or partly on for a set of ticks (names; for the lobby's match-host line). */
export function activeExpansions(cat: AddonCatalog, packages: readonly string[]): string[] {
    const set = new Set(packages);
    return EXPANSIONS.filter((e) => expansionMembers(cat, e).some((id) => set.has(id))).map((e) => e.name);
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
    /** Work-in-progress hover reason (null = recommended). */
    wip: string | null;
    /** Hover text: why the checkbox is locked / disabled (empty when it is free). */
    tooltip: string;
}

export interface AddonPickerModel {
    /** The same rows split into the picker's two sections (Recommended first), each keeping the topic groups. */
    sections: { section: AddonSection; groups: { group: AddonGroup; rows: AddonRow[] }[] }[];
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
                wip: a.wip,
                tooltip: locked ? `needed by ${requiredBy.join(', ')}` : conflictsWith.length > 0 ? `conflicts with ${conflictsWith.join(', ')}` : '',
            });
        }
        rows.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
        if (rows.length > 0) groups.push({ group, rows });
    }
    const sections = ADDON_SECTIONS.map((section) => ({
        section,
        groups: groups.map((g) => ({ group: g.group, rows: g.rows.filter((r) => (r.wip === null) === (section === 'Recommended')) })).filter((g) => g.rows.length > 0),
    })).filter((x) => x.groups.length > 0);
    const finalNames = cat.list.filter((a) => onSet.has(a.id) && !a.hidden).map((a) => a.name);
    let panels = on.filter((id) => {
        if (ELSEWHERE_ADDONS.has(id)) return false;
        const m = cat.manifests.get(id)!;
        return m.flags.length > 1 || m.params.length > 0;
    });
    // A parent's panel (BVR combat) comes first, then the panels of its sub-add-ons.
    for (const [parent, subs] of Object.entries(SUB_ADDONS)) {
        if (!panels.includes(parent)) continue;
        const at = panels.indexOf(parent);
        const own = panels.filter((x) => subs.includes(x));
        panels = [...panels.slice(0, at).filter((x) => !own.includes(x)), parent, ...own, ...panels.slice(at + 1).filter((x) => !own.includes(x))];
    }
    return { sections, groups, finalNames, summary: finalNames.length === 0 ? 'None (the original game)' : finalNames.join(', '), panels };
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

// ---------------------------------------------------------------------------------------------------------------------
// Adding add-ons to a saved game (the Load screen's "Add add-ons…", saveLoad.ts)
// ---------------------------------------------------------------------------------------------------------------------
//
// Only add-ons whose manifest says addableToSave (nothing at galaxy generation or game start; their state starts on
// first use) can be added, together with what they need switched on, which must be addable too. Removing is not offered.
// The game then runs the combined set: the save's add-ons plus the new ones as one composite scenario (or a single
// scenario when one add-on alone covers the set), its galaxy.scenario updated so the next save records the new set
// and loads normally (sim/scenario/addToSave.ts, applied by deserializeGame's explicit `addAddons` path).

/** A save's scenario as the loader reads it (savedScenarioId / savedScenarioInclude): id null = the original game. */
export interface SavedScenarioRef {
    id: string | null;
    /** The flattened add-on list of a composite ('addons') save; null otherwise. */
    include: string[] | null;
}

/** Every package a saved scenario loads (its overlays): a composite's flattened list, a single scenario's include tree. */
export function savedScenarioPackages(cat: AddonCatalog, saved: SavedScenarioRef): string[] {
    if (saved.id === null) return [];
    if (saved.id === COMPOSITE_SCENARIO_ID) return [...(saved.include ?? [])];
    return addonClosure(cat, [saved.id], 'all');
}

/** The add-ons the Load screen offers for a save: addable, visible, not loaded by it yet, and needing only addable add-ons. */
export function addonsAddableToSave(cat: AddonCatalog, saved: SavedScenarioRef): AddonInfo[] {
    const loaded = new Set(savedScenarioPackages(cat, saved));
    return cat.list.filter((a) => {
        if (a.hidden || !a.addableToSave || loaded.has(a.id)) return false;
        const adding = addonClosure(cat, [a.id], 'all').filter((x) => !loaded.has(x));
        if (adding.some((x) => !(cat.byId.get(x)?.addableToSave ?? false))) return false;
        // Not against anything the save runs (its loaded packages; data-only ones too: the overlays would clash).
        return !adding.some((x) => [...loaded].some((y) => conflictsBetween(cat, x, y)));
    });
}

/** What adding add-ons to a save does (the journaled record of it: player/commandLog.ts AddonsLogEntry). Plain data. */
export interface SaveAddonAddition {
    /** The save's scenario before (checked against the save). */
    from: SavedScenarioRef;
    /** The add-ons the player picked (canonical order). */
    added: string[];
    /** The scenario the game runs from now on (the game data must be built for it). */
    to: { id: string; include: string[] | null };
    /** The new manifest's name and description (a composite's "Add-ons: …"). */
    name: string;
    description: string;
    /** The new manifest's flattened include list (empty for a single scenario: its own manifest's). */
    manifestInclude: string[];
    /** Flag / param definitions the new packages bring (names the save's scenario does not know yet). */
    newFlags: ScenarioManifest['flags'];
    newParams: ScenarioManifest['params'];
    /** The values the new switches start with (and the masters of the picked add-ons, forced on). */
    flags: Record<string, boolean>;
    params: Record<string, number>;
    /** Some new package carries data files (its overlay changes the game data, e.g. Themed Names' GameText.txt). */
    withData: boolean;
}

/**
 * The combined set for a save plus `adding` (throws when one cannot be added). The composite's include is the canonical
 * closure of the save's packages and the picks (as a new game with that set would record it), unless that would reorder
 * the save's own packages (their overlays apply in the saved order): then the new packages follow the saved list.
 */
export function planSaveAddonAddition(cat: AddonCatalog, saved: SavedScenarioRef, adding: readonly string[], manifestFor?: (id: string) => ScenarioManifest | undefined): SaveAddonAddition {
    const offered = new Set(addonsAddableToSave(cat, saved).map((a) => a.id));
    const picked = canonicalAddons(cat, adding);
    if (picked.length === 0) throw new Error('No add-ons picked');
    for (const id of adding) if (!offered.has(id)) throw new Error(`Add-on ${cat.byId.get(id)?.name ?? id} cannot be added to this game`);
    const before = savedScenarioPackages(cat, saved);
    const beforeSet = new Set(before);
    let include = addonClosure(cat, canonicalAddons(cat, [...before, ...picked]), 'all');
    const keptOrder = include.filter((x) => beforeSet.has(x));
    if (keptOrder.join(',') !== before.join(',')) include = [...before, ...addonClosure(cat, picked, 'all').filter((x) => !beforeSet.has(x))];
    const newPackages = include.filter((x) => !beforeSet.has(x));
    // As planAddonStart: one package whose own include tree is exactly the set starts as that scenario.
    let to: SaveAddonAddition['to'] = { id: COMPOSITE_SCENARIO_ID, include };
    const want = new Set(include);
    for (const id of include) {
        const inc = includeClosure(cat, id);
        if (inc.size === want.size && [...inc].every((x) => want.has(x))) {
            to = { id, include: null };
            break;
        }
    }
    // Switches of the new packages: their defaults (an including package's definition wins, as resolveAddonSwitches),
    // the masters of what the picks switch on forced on, then the manifests' addedToSaveFlags.
    const mf = manifestFor ?? ((id: string) => cat.manifests.get(id));
    const savedNames = new Set<string>();
    for (const id of before) for (const f of [...(mf(id)?.flags ?? []), ...(mf(id)?.params ?? [])]) savedNames.add(f.name);
    const newFlags: ScenarioManifest['flags'] = [];
    const newParams: ScenarioManifest['params'] = [];
    const flags: Record<string, boolean> = {};
    const params: Record<string, number> = {};
    for (const id of [...newPackages].reverse()) {
        const m = mf(id);
        if (m === undefined) throw new Error(`add-on ${id} is not available`);
        for (const f of m.flags) {
            if (savedNames.has(f.name) || f.name in flags) continue;
            newFlags.push(JSON.parse(JSON.stringify(f)) as ScenarioManifest['flags'][number]); // plain JSON (no undefined keys): as journaled
            flags[f.name] = f.default;
        }
        for (const p of m.params) {
            if (savedNames.has(p.name) || p.name in params) continue;
            newParams.push(JSON.parse(JSON.stringify(p)) as ScenarioManifest['params'][number]);
            params[p.name] = p.default;
        }
    }
    const on = addonClosure(cat, picked, 'on').filter((x) => !beforeSet.has(x));
    for (const id of on) {
        const master = cat.byId.get(id)?.masterFlag ?? null;
        if (master !== null) flags[master] = true;
    }
    for (const id of on) for (const [k, v] of Object.entries(mf(id)?.addedToSaveFlags ?? {})) if (k in flags) flags[k] = v;
    const composite = compositeScenarioManifest(cat, include.filter((x) => !(cat.byId.get(x)?.hidden ?? false)));
    const single = to.id !== COMPOSITE_SCENARIO_ID ? mf(to.id) : undefined;
    return {
        from: { id: saved.id, include: saved.include === null ? null : [...saved.include] },
        added: picked,
        to,
        name: single?.name ?? composite.name,
        description: single?.description ?? `Several add-ons together: ${include.join(', ')}.`,
        manifestInclude: single !== undefined ? [...single.include] : include,
        newFlags,
        newParams,
        flags,
        params,
        withData: newPackages.some((id) => (mf(id)?.files.length ?? 0) > 0),
    };
}

/** Expansions the Load screen can add to a save: every member not loaded yet is addable, and at least one is not loaded. */
export function expansionsAddableToSave(cat: AddonCatalog, saved: SavedScenarioRef): { id: string; name: string; description: string; members: string[] }[] {
    const loaded = new Set(savedScenarioPackages(cat, saved));
    const addable = new Set(addonsAddableToSave(cat, saved).map((a) => a.id));
    const out: { id: string; name: string; description: string; members: string[] }[] = [];
    for (const e of EXPANSIONS) {
        const members = expansionMembers(cat, e);
        const todo = members.filter((id) => !loaded.has(id));
        if (todo.length > 0 && members.length > 0 && todo.every((id) => addable.has(id))) out.push({ id: e.id, name: e.name, description: e.description, members: todo });
    }
    return out;
}
