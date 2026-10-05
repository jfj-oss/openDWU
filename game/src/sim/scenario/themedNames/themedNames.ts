// Themed names for AI empires (scenarios/themed-names). Not a port.
//
// AI empires (never the player, a pirate faction or the independents) get race-flavoured names for
//   - their new automated fleets and strike forces (event fleetFormed, in place of "Nth Fleet" / "Nth Strike Force"),
//   - their new colonies founded by a colony ship on an empty world (event colonyFounded; a population that joins
//     keeps its world's name),
//   - the empire itself, once at the end of game set-up (scenario game start), by race and government.
// The name lists are the add-on's GameText.txt lines ("ThemedNames <kind> <race>", Generic for unknown races).
//
// Rnd: none. Every pick is a hash of a per-empire seed (empire id, race and capital at first use) and a per-kind
// counter, so the galaxy's random sequence is the same with the add-on on or off. Names never repeat within one empire
// (fleets, colonies) or across empires (empire names); a list that runs out continues with a numeral suffix.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { ShipGroup } from '../../fleets/shipGroup';
import { getGovernmentsStatic } from '../../empire';
import { tryGetText } from '../../textResolver';
import { resolveEmpireShipNameStyle, shipRegistryPrefix } from '../../shipNameStyle';
import { scenarioFlag, scenarioState } from '../state';
import { registerScenarioEvent, registerScenarioGameStart } from '../hooks';

export const THEMED_NAMES_FLAG = 'themedNames';
export const THEMED_NAMES_FLEETS_FLAG = 'themedNamesFleets';
export const THEMED_NAMES_COLONIES_FLAG = 'themedNamesColonies';
export const THEMED_NAMES_EMPIRES_FLAG = 'themedNamesEmpires';
export const THEMED_NAMES_STATE_KEY = 'themedNames';

const GENERIC = 'Generic';

/** galaxy.scenario.state.themedNames (plain data, saved with the game). Keys: `<empireId>` / `<empireId>:<kind>`. */
export interface ThemedNamesState {
    /** Per-empire hash seed, fixed at the empire's first use. */
    seeds: Record<string, number>;
    /** Next candidate index per empire and kind. */
    counters: Record<string, number>;
    /** Names already given per empire and kind. */
    used: Record<string, string[]>;
}

function themedState(galaxy: Galaxy): ThemedNamesState {
    return scenarioState<ThemedNamesState>(galaxy, THEMED_NAMES_STATE_KEY, () => ({ seeds: {}, counters: {}, used: {} }));
}

function on(galaxy: Galaxy, sub: string): boolean {
    return scenarioFlag(galaxy, THEMED_NAMES_FLAG) && scenarioFlag(galaxy, sub);
}

/** An empire the add-on names: an active AI empire with a race, not the player, a pirate faction or the independents. */
export function isThemedNamesEmpire(galaxy: Galaxy, empire: Empire | null): empire is Empire {
    return (
        empire !== null &&
        empire.active &&
        empire !== galaxy.playerEmpire &&
        !empire.playerEmpire &&
        empire !== galaxy.independentEmpire &&
        empire.pirateEmpireBaseHabitat === null &&
        empire.dominantRace !== null
    );
}

// --- Hashing ---------------------------------------------------------------------------------------------------------

/** FNV-1a 32-bit. */
export function fnv1a(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** A 32-bit mix of a seed and a salt. */
function mix(seed: number, salt: string): number {
    let h = fnv1a(`${seed}:${salt}`);
    h ^= h >>> 16;
    h = Math.imul(h, 0x45d9f3b) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
}

const ROMAN: readonly [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

export function romanNumeral(n: number): string {
    let out = '';
    for (const [v, r] of ROMAN) {
        while (n >= v) {
            out += r;
            n -= v;
        }
    }
    return out;
}

/**
 * The next unused name of a candidate space of `size` names (`gen(i)`, i in 0..size-1; '' = not a valid candidate):
 * candidate k is index hash(h, k) mod size, from the empire's counter on. When the hashed walk finds nothing free (the
 * space is nearly used up) every candidate is swept in order, then again with " II", " III", ... appended. Returns
 * the name and the advanced counter.
 */
function nextUnique(size: number, h: number, counter: number, gen: (i: number) => string, taken: (name: string) => boolean): { name: string; counter: number } {
    const n = Math.max(1, size);
    const tries = 8 * n + 64;
    for (let k = counter; k < counter + tries; k++) {
        const name = gen(mix(h, String(k)) % n);
        if (name !== '' && !taken(name)) return { name, counter: k + 1 };
    }
    const start = h % n;
    for (let round = 0; round < 1000; round++) {
        for (let i = 0; i < n; i++) {
            const base = gen((start + i) % n);
            if (base === '') continue;
            const name = round === 0 ? base : `${base} ${romanNumeral(round + 1)}`;
            if (!taken(name)) return { name, counter: counter + tries };
        }
    }
    return { name: `Unnamed ${counter + 1}`, counter: counter + 1 };
}

// --- Name lists ------------------------------------------------------------------------------------------------------

function textList(tag: string): string[] {
    const t = tryGetText(tag);
    if (t === null) return [];
    return t.split('|').map((s) => s.trim()).filter((s) => s !== '');
}

/** The race's list of `kind`, or the Generic one (a modded / unknown race, or a missing line). */
function raceList(kind: string, raceName: string): string[] {
    const own = textList(`ThemedNames ${kind} ${raceName}`);
    if (own.length > 0) return own;
    return textList(`ThemedNames ${kind} ${GENERIC}`);
}

/** The race's lists for one name kind come from the same race (no mixing of a race's patterns with generic parts). */
function raceKey(kinds: readonly string[], raceName: string): string {
    return kinds.every((k) => textList(`ThemedNames ${k} ${raceName}`).length > 0) ? raceName : GENERIC;
}

function empireSeed(galaxy: Galaxy, empire: Empire): number {
    const st = themedState(galaxy);
    const key = String(empire.empireId);
    let seed = st.seeds[key];
    if (seed === undefined) {
        seed = fnv1a(`${empire.empireId}|${empire.dominantRace?.name ?? ''}|${empire.capital?.name ?? ''}|${empire.name}`);
        st.seeds[key] = seed;
    }
    return seed;
}

function usedList(st: ThemedNamesState, key: string): string[] {
    let u = st.used[key];
    if (u === undefined) {
        u = [];
        st.used[key] = u;
    }
    return u;
}

// --- Fleets ----------------------------------------------------------------------------------------------------------

const FLEET_KINDS = ['FleetAdj', 'FleetNoun', 'FleetGroup', 'FleetPattern'] as const;

/** The next themed fleet name of `empire` (advances its counter). Empty when there are no lists (no GameText). */
export function nextThemedFleetName(galaxy: Galaxy, empire: Empire): string {
    const race = raceKey(FLEET_KINDS, empire.dominantRace?.name ?? GENERIC);
    const adj = raceList('FleetAdj', race);
    const noun = raceList('FleetNoun', race);
    const group = raceList('FleetGroup', race);
    const patterns = raceList('FleetPattern', race);
    if (adj.length === 0 || noun.length === 0 || group.length === 0 || patterns.length === 0) return '';
    const st = themedState(galaxy);
    const key = `${empire.empireId}:fleet`;
    const used = usedList(st, key);
    const size = patterns.length * adj.length * noun.length * group.length;
    const gen = (i: number): string => {
        const p = patterns[i % patterns.length];
        i = Math.floor(i / patterns.length);
        const a = adj[i % adj.length];
        i = Math.floor(i / adj.length);
        const n = noun[i % noun.length];
        i = Math.floor(i / noun.length);
        const f = group[i % group.length];
        const name = p.replace(/\{A\}/g, a).replace(/\{N\}/g, n).replace(/\{F\}/g, f).replace(/\s+/g, ' ').trim();
        // Skip a combination that repeats a word ("Strike Strike Group"); the walk moves on to the next candidate.
        // ("Venomous Venom", "Drumming Drum": one word starting with the other, or the same first five letters).
        const words = name.toLowerCase().split(/[\s-]+/).filter((w) => w !== 'of' && w !== 'the');
        for (let x = 0; x < words.length; x++) {
            for (let y = x + 1; y < words.length; y++) {
                const [s, l] = words[x].length <= words[y].length ? [words[x], words[y]] : [words[y], words[x]];
                if (s === l || (s.length >= 4 && l.startsWith(s)) || (s.length >= 5 && s.slice(0, 5) === l.slice(0, 5))) return '';
            }
        }
        return name;
    };
    const r = nextUnique(size, mix(empireSeed(galaxy, empire), 'fleet'), st.counters[key] ?? 0, gen, (name) => used.includes(name));
    st.counters[key] = r.counter;
    used.push(r.name);
    return r.name;
}

function onFleetFormed(galaxy: Galaxy, p: { empire: Empire; fleet: ShipGroup; strikeForce: boolean }): void {
    if (!on(galaxy, THEMED_NAMES_FLEETS_FLAG) || !isThemedNamesEmpire(galaxy, p.empire)) return;
    const name = nextThemedFleetName(galaxy, p.empire);
    if (name !== '') p.fleet.name = name;
}

// --- Colonies --------------------------------------------------------------------------------------------------------

/** The next themed colony name of `empire` for `colony` (advances its counter). Empty without lists. */
export function nextThemedColonyName(galaxy: Galaxy, empire: Empire, colony: Habitat): string {
    const raceName = empire.dominantRace?.name ?? GENERIC;
    const list = raceList('Colony', raceName);
    if (list.length === 0) return '';
    const st = themedState(galaxy);
    const key = `${empire.empireId}:colony`;
    const used = usedList(st, key);
    const home = empire.dominantRace?.homeSystemName ?? raceName;
    const star = galaxy.determineHabitatSystemStar(colony)?.name ?? colony.name;
    const capital = empire.capital?.name ?? home;
    const gen = (i: number): string =>
        list[i]
            .replace(/\{Home\}/g, home)
            .replace(/\{Star\}/g, star)
            .replace(/\{Capital\}/g, capital)
            .replace(/\s+/g, ' ')
            .trim();
    // Taken: given before, or the name of one of the empire's colonies (a pattern may give an existing world's name).
    const taken = (name: string): boolean => used.includes(name) || empire.colonies.some((c) => c !== colony && c.name === name);
    const r = nextUnique(list.length, mix(empireSeed(galaxy, empire), 'colony'), st.counters[key] ?? 0, gen, taken);
    st.counters[key] = r.counter;
    used.push(r.name);
    return r.name;
}

function onColonyFounded(galaxy: Galaxy, p: { colony: Habitat; empire: Empire; joined?: boolean }): void {
    if (!on(galaxy, THEMED_NAMES_COLONIES_FLAG) || p.joined === true || !isThemedNamesEmpire(galaxy, p.empire)) return;
    if (p.colony.owner !== p.empire || p.colony.hasBeenDestroyed) return;
    const name = nextThemedColonyName(galaxy, p.empire, p.colony);
    // As the player's rename (player/colonyOrders.ts renameColony): Habitat.name is what every view reads.
    if (name !== '') p.colony.name = name;
}

// --- Empire names ----------------------------------------------------------------------------------------------------

/** The government style of a government id ("ThemedNames Government <name>"; Generic when unknown). */
function governmentStyle(governmentId: number): string {
    const gov = getGovernmentsStatic()[governmentId] ?? null;
    if (gov === null) return GENERIC;
    return tryGetText(`ThemedNames Government ${gov.name}`)?.trim() || GENERIC;
}

/** A themed empire name for `empire` not in `taken`. Empty without lists. Pure (no state written). */
export function themedEmpireName(galaxy: Galaxy, empire: Empire, taken: (name: string) => boolean): string {
    const parts = raceList('EmpirePart', empire.dominantRace?.name ?? GENERIC);
    let templates = textList(`ThemedNames EmpireStyle ${governmentStyle(empire.governmentId)}`);
    if (templates.length === 0) templates = textList(`ThemedNames EmpireStyle ${GENERIC}`);
    if (parts.length === 0 || templates.length === 0) return '';
    const gen = (i: number): string => templates[i % templates.length].replace(/\{0\}/g, parts[Math.floor(i / templates.length)]).replace(/\s+/g, ' ').trim();
    return nextUnique(parts.length * templates.length, mix(empireSeed(galaxy, empire), 'empire'), 0, gen, taken).name;
}

/**
 * Renames `empire` and carries the new name into what holds a copy of the old one: the messages already sent (every
 * empire's queue and history) and ship names that carry the empire's registry initials (shipNameStyle.ts). Everything
 * else (diplomacy, empire lists, later message texts) reads Empire.name.
 */
export function renameEmpireEverywhere(galaxy: Galaxy, empire: Empire, name: string): void {
    const old = empire.name;
    if (name === '' || name === old) return;
    const style = resolveEmpireShipNameStyle(empire);
    empire.name = name;
    if (style !== null) {
        for (const bo of empire.builtObjects) {
            if (bo === null || bo === undefined || typeof bo.name !== 'string') continue;
            const before = shipRegistryPrefix(style, old, bo.subRole);
            const after = shipRegistryPrefix(style, name, bo.subRole);
            if (before !== '' && before !== after && bo.name.startsWith(`${before} `)) bo.name = after === '' ? bo.name.slice(before.length + 1) : after + bo.name.slice(before.length);
        }
    }
    const fix = (m: unknown): void => {
        if (m === null || typeof m !== 'object') return;
        const o = m as { title?: unknown; description?: unknown };
        if (typeof o.title === 'string' && o.title.includes(old)) o.title = o.title.split(old).join(name);
        if (typeof o.description === 'string' && o.description.includes(old)) o.description = o.description.split(old).join(name);
    };
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires]) {
        if (e === null) continue;
        for (const m of e.messages) fix(m);
        for (const m of e.messageHistory) fix(m);
    }
}

function onGameStart(galaxy: Galaxy): void {
    if (!on(galaxy, THEMED_NAMES_EMPIRES_FLAG)) return;
    const all = (): Empire[] => [...galaxy.empires, ...galaxy.pirateEmpires].filter((e): e is Empire => e !== null);
    for (const empire of galaxy.empires) {
        if (!isThemedNamesEmpire(galaxy, empire)) continue;
        const name = themedEmpireName(galaxy, empire, (n) => all().some((e) => e !== empire && e.name === n));
        renameEmpireEverywhere(galaxy, empire, name);
    }
}

registerScenarioGameStart({ id: 'themedNames.empires', flag: THEMED_NAMES_FLAG, run: (galaxy) => onGameStart(galaxy) });
registerScenarioEvent({ id: 'themedNames.fleets', flag: THEMED_NAMES_FLAG, event: 'fleetFormed', run: onFleetFormed });
registerScenarioEvent({ id: 'themedNames.colonies', flag: THEMED_NAMES_FLAG, event: 'colonyFounded', run: onColonyFounded });
