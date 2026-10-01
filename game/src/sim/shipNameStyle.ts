// Per-empire / per-race ship naming styles.
//
// DEVIATION from the original (documented): DW:U 1.9.5 has exactly one race-specific naming
// input, Race.DesignNamesIndex (races/*.txt) -> one of the 14 design-name families in
// designNames.txt (Empire.cs 3791 / 3119 GenerateDesignName). That already drives *design* names
// (and so the "<design> 001" names of small warships) and is ported in designNames.ts.
// Every other ship / base name comes from Galaxy.5.cs SelectRandomUniqueStandardShipName /
// SelectRandomUniqueMilitaryShipName / SelectUniqueBuiltObjectName, which use one galaxy-wide
// word list for every empire, so all races' freighters and cruisers read alike
// ("Venerable Renegade"). shipNames.txt (Galaxy.SubRoleNameSet) is a player-only override and
// ships empty.
//
// This module layers a per-race flavour on top WITHOUT changing the random-call sequence:
//  - the word lists are swapped for the empire's style lists, but the RNG still draws
//    Next(0, <original list length>) exactly as the C# does; the drawn index is mapped onto
//    the style list with `index % style.length` (so every golden RNG pin is unaffected);
//  - a registry prefix ("HFS", "IKES", "ME-W", ...) built from the empire's name initials and
//    the style's per-role-class letters is prepended to ship names (never to bases, never to
//    the player's shipNames.txt custom names). Pirates use the corsair style (no prefix).
// The style is a pure function of the empire's dominant race (+ pirate flag) and its name, so
// it needs no save state: names are plain strings on BuiltObject and round-trip as before.

import { BuiltObjectSubRole } from './builtObjectTypes';

export type ShipNameStyleId = 'naval' | 'martial' | 'hive' | 'mercantile' | 'scholarly' | 'machine' | 'mystic' | 'corsair';

/** Role class of a ship sub-role for prefixing; 'base' never gets a prefix. */
export type ShipNameRoleClass = 'war' | 'civ' | 'survey' | 'works' | 'base';

export interface ShipNameStyle {
    id: ShipNameStyleId;
    /** Registry prefix templates per role class; `{I}` = empire initials. '' = no prefix. */
    registry: Record<Exclude<ShipNameRoleClass, 'base'>, string>;
    militaryAdjectives: readonly string[];
    militaryNouns: readonly string[];
    standardAdjectives: readonly string[];
    standardNouns: readonly string[];
    /** Replacements for the 4-word MonitoringStation / research / DefensiveBase arrays and the
     *  2-word GenericBase array of SelectUniqueBuiltObjectName (index-mapped, same draws). */
    monitoringWords: readonly string[];
    researchWords: readonly string[];
    defensiveWords: readonly string[];
    genericBaseWords: readonly string[];
}

const STYLES: Record<ShipNameStyleId, ShipNameStyle> = {
    // Classic blue-water navy: HMS/USS-style registries, virtue names.
    naval: {
        id: 'naval',
        registry: { war: '{I}S', civ: '{I}M', survey: '{I}R', works: '{I}C' },
        militaryAdjectives: ['Valiant', 'Indomitable', 'Resolute', 'Steadfast', 'Gallant', 'Dauntless', 'Intrepid', 'Vigilant', 'Invincible', 'Formidable', 'Implacable', 'Illustrious', 'Courageous', 'Glorious', 'Defiant', 'Relentless'],
        militaryNouns: ['Guardian', 'Sentinel', 'Defender', 'Endeavour', 'Victory', 'Resolution', 'Vanguard', 'Bulwark', 'Ranger', 'Constitution', 'Enterprise', 'Repulse', 'Warspite', 'Valour', 'Triumph', 'Agincourt', 'Trafalgar', 'Majesty', 'Dreadnought', 'Paladin'],
        standardAdjectives: ['Bright', 'Fair', 'Lucky', 'Northern', 'Southern', 'Golden', 'Silver', 'Steady', 'Swift', 'Gentle', 'Prosperous', 'Faithful', 'Hopeful', 'Morning', 'Evening', 'Blue'],
        standardNouns: ['Horizon', 'Mariner', 'Voyager', 'Pathfinder', 'Wanderer', 'Clipper', 'Harbour', 'Tide', 'Compass', 'Anchor', 'Lantern', 'Heron', 'Albatross', 'Kestrel', 'Endurance', 'Discovery', 'Pioneer', 'Haven'],
        monitoringWords: ['Watch', 'Lighthouse', 'Beacon', 'Picket Station'],
        researchWords: ['Observatory', 'Naval Laboratory', 'Research Station', 'Survey Institute'],
        defensiveWords: ['Fort', 'Coastal Battery', 'Bastion', 'Gun Platform'],
        genericBaseWords: ['Station', 'Dockyard'],
    },
    // Warrior cultures: imperial registries, blood-and-steel names.
    martial: {
        id: 'martial',
        registry: { war: 'I{I}S', civ: '{I}T', survey: '{I}V', works: '{I}F' },
        militaryAdjectives: ['Bloodied', 'Iron', 'Savage', 'Merciless', 'Burning', 'Howling', 'Crimson', 'Unyielding', 'Ruthless', 'Thundering', 'Black', 'Furious', 'Wrathful', 'Grim', 'Brutal', 'Eternal'],
        militaryNouns: ['Blade', 'Warhammer', 'Conqueror', 'Slayer', 'Ravager', 'Warlord', 'Bloodfang', 'Spear', 'Talon', 'Executioner', 'Fury', 'Vengeance', 'Annihilator', 'Butcher', 'Destroyer', 'Reaver', 'Gorehound', 'Skullcrusher', 'Tyrant', 'Dominion'],
        standardAdjectives: ['Stalwart', 'Hardened', 'Iron', 'Loyal', 'Tireless', 'Grim', 'Stern', 'Sworn', 'Unbroken', 'Dutiful', 'Scarred', 'Bold'],
        standardNouns: ['Hauler', 'Packbeast', 'Forager', 'Spoils', 'Tribute', 'Outrider', 'Scout', 'Warband', 'Quartermaster', 'Plunder', 'March', 'Muster', 'Ironworks', 'Forge'],
        monitoringWords: ['Watchtower', 'Sentry Post', 'War Beacon', 'Lookout'],
        researchWords: ['War College', 'Arsenal', 'Weapons Proving Ground', 'Forge Station'],
        defensiveWords: ['Citadel', 'Fortress', 'Bastion', 'War Platform'],
        genericBaseWords: ['Garrison', 'Stronghold'],
    },
    // Insectoid hive-minds: brood/drone designations.
    hive: {
        id: 'hive',
        registry: { war: '{I}B', civ: '{I}D', survey: '{I}K', works: '{I}W' },
        militaryAdjectives: ['Swarming', 'Ravenous', 'Chittering', 'Venomous', 'Devouring', 'Teeming', 'Skittering', 'Gnawing', 'Burrowing', 'Molting', 'Spined', 'Carapaced'],
        militaryNouns: ['Brood', 'Stinger', 'Mandible', 'Swarm', 'Queen', 'Hivewarden', 'Spawn', 'Carapace', 'Thorax', 'Barb', 'Mantis', 'Locust', 'Hornet', 'Devourer', 'Broodmother', 'Pincer'],
        standardAdjectives: ['Diligent', 'Humming', 'Laden', 'Tireless', 'Gathering', 'Burrowing', 'Wandering', 'Silent', 'Patient', 'Clustered'],
        standardNouns: ['Drone', 'Forager', 'Worker', 'Gatherer', 'Larva', 'Cocoon', 'Nectar', 'Comb', 'Seeker', 'Tender', 'Chrysalis', 'Colony', 'Nestling', 'Pupa'],
        monitoringWords: ['Antenna', 'Feeler Node', 'Watch Cell', 'Sensory Node'],
        researchWords: ['Gene Vat', 'Thought Chamber', 'Hatchery', 'Incubator'],
        defensiveWords: ['Spire', 'Brood Nest', 'Stinger Battery', 'Hive Bastion'],
        genericBaseWords: ['Nest', 'Hive'],
    },
    // Trading cultures: merchant-guild registries, fortune names.
    mercantile: {
        id: 'mercantile',
        registry: { war: '{I}G', civ: '{I}T', survey: '{I}P', works: '{I}W' },
        militaryAdjectives: ['Profitable', 'Insured', 'Hostile', 'Leveraged', 'Bonded', 'Chartered', 'Collateral', 'Audited', 'Contracted', 'Guaranteed', 'Premium', 'Hedged'],
        militaryNouns: ['Takeover', 'Enforcer', 'Underwriter', 'Collector', 'Arbitrator', 'Liquidator', 'Guarantee', 'Dividend', 'Escort', 'Repossessor', 'Embargo', 'Tariff', 'Foreclosure', 'Monopoly'],
        standardAdjectives: ['Prosperous', 'Golden', 'Lucky', 'Wealthy', 'Thrifty', 'Shrewd', 'Bountiful', 'Opulent', 'Fortunate', 'Gilded', 'Silken', 'Lavish', 'Frugal', 'Honest'],
        standardNouns: ['Fortune', 'Venture', 'Bargain', 'Caravan', 'Ledger', 'Coin', 'Dividend', 'Merchant', 'Profit', 'Commerce', 'Exchange', 'Trader', 'Prospect', 'Bounty', 'Purse', 'Enterprise'],
        monitoringWords: ['Customs Post', 'Toll Beacon', 'Tariff Station', 'Trade Watch'],
        researchWords: ['Patent Office', 'Innovation Hub', 'Development Lab', 'Venture Lab'],
        defensiveWords: ['Security Post', 'Escort Platform', 'Guard Battery', 'Vault Defense'],
        genericBaseWords: ['Exchange', 'Emporium'],
    },
    // Scholarly / scientific cultures: concepts and luminaries.
    scholarly: {
        id: 'scholarly',
        registry: { war: '{I}D', civ: '{I}A', survey: '{I}RV', works: '{I}E' },
        militaryAdjectives: ['Absolute', 'Axiomatic', 'Rigorous', 'Logical', 'Precise', 'Empirical', 'Calculated', 'Definitive', 'Irrefutable', 'Theoretical', 'Entropic', 'Quantum'],
        militaryNouns: ['Theorem', 'Proof', 'Paradox', 'Corollary', 'Conclusion', 'Postulate', 'Equation', 'Constant', 'Hypothesis', 'Variable', 'Singularity', 'Vector', 'Lemma', 'Refutation'],
        standardAdjectives: ['Curious', 'Patient', 'Learned', 'Wise', 'Inquiring', 'Methodical', 'Lucid', 'Studious', 'Thoughtful', 'Erudite', 'Diligent', 'Bright'],
        standardNouns: ['Insight', 'Inquiry', 'Discovery', 'Observation', 'Treatise', 'Lexicon', 'Codex', 'Catalogue', 'Archive', 'Measure', 'Axiom', 'Principle', 'Analysis', 'Survey'],
        monitoringWords: ['Observatory', 'Listening Array', 'Sensor Array', 'Watch Institute'],
        researchWords: ['Academy', 'Institute', 'University', 'Collegium'],
        defensiveWords: ['Deflector Array', 'Defense Lattice', 'Ward Platform', 'Field Battery'],
        genericBaseWords: ['Athenaeum', 'Station'],
    },
    // Machine intelligences: serial designations.
    machine: {
        id: 'machine',
        registry: { war: '{I}-W', civ: '{I}-L', survey: '{I}-P', works: '{I}-F' },
        militaryAdjectives: ['Prime', 'Null', 'Binary', 'Recursive', 'Terminal', 'Optimal', 'Absolute', 'Linear', 'Parallel', 'Final', 'Hardened', 'Overclocked'],
        militaryNouns: ['Executor', 'Protocol', 'Algorithm', 'Subroutine', 'Directive', 'Process', 'Iterator', 'Compiler', 'Kernel', 'Override', 'Purge', 'Daemon', 'Sequence', 'Cascade'],
        standardAdjectives: ['Efficient', 'Automated', 'Indexed', 'Calibrated', 'Synchronous', 'Scheduled', 'Cached', 'Routine', 'Nominal', 'Persistent'],
        standardNouns: ['Unit', 'Node', 'Relay', 'Module', 'Carrier', 'Buffer', 'Packet', 'Datum', 'Probe', 'Assembler', 'Servitor', 'Drone', 'Mechanism', 'Agent'],
        monitoringWords: ['Sensor Node', 'Relay', 'Monitor', 'Uplink'],
        researchWords: ['Compute Core', 'Data Node', 'Processing Array', 'Logic Engine'],
        defensiveWords: ['Defense Node', 'Firewall', 'Gun Matrix', 'Barrier Node'],
        genericBaseWords: ['Node', 'Hub'],
    },
    // Contemplative / naturalist cultures: nature and spirit names.
    mystic: {
        id: 'mystic',
        registry: { war: '{I}W', civ: '{I}P', survey: '{I}S', works: '{I}A' },
        militaryAdjectives: ['Serene', 'Eternal', 'Silent', 'Radiant', 'Hallowed', 'Tranquil', 'Ancestral', 'Sacred', 'Ascendant', 'Luminous', 'Veiled', 'Immortal'],
        militaryNouns: ['Warden', 'Spirit', 'Oath', 'Grace', 'Penance', 'Requiem', 'Tempest', 'Storm', 'Tide', 'Ancestor', 'Covenant', 'Lotus', 'Blossom', 'Thornguard'],
        standardAdjectives: ['Gentle', 'Peaceful', 'Wandering', 'Dreaming', 'Drifting', 'Quiet', 'Blessed', 'Humble', 'Verdant', 'Misty', 'Dawn', 'Moonlit'],
        standardNouns: ['Pilgrim', 'Harmony', 'Grove', 'Dream', 'Song', 'Petal', 'Willow', 'River', 'Seed', 'Meadow', 'Breeze', 'Lantern', 'Reverie', 'Blossom'],
        monitoringWords: ['Vigil', 'Shrine', 'Watchstone', 'Lantern'],
        researchWords: ['Sanctum', 'Contemplarium', 'Temple of Learning', 'Retreat'],
        defensiveWords: ['Ward', 'Sanctuary', 'Guardian Stone', 'Aegis'],
        genericBaseWords: ['Haven', 'Temple'],
    },
    // Pirates: no registry, raider names.
    corsair: {
        id: 'corsair',
        registry: { war: '', civ: '', survey: '', works: '' },
        militaryAdjectives: ['Black', 'Bloody', 'Crooked', 'Dread', 'Rusty', 'Grinning', 'Wicked', 'Cursed', 'Jagged', 'Drunken', 'Scarlet', 'Lawless', 'Mad', 'One-Eyed'],
        militaryNouns: ['Cutlass', 'Corsair', 'Buccaneer', 'Marauder', 'Raider', 'Kraken', 'Plunder', 'Mutiny', 'Gallows', 'Skull', 'Jackal', 'Hook', 'Blackheart', 'Scallywag', 'Reaver', 'Revenge'],
        standardAdjectives: ['Shady', 'Sneaky', 'Slippery', 'Dubious', 'Crafty', 'Wily', 'Grimy', 'Shabby', 'Hidden', 'Smuggled', 'Stolen', 'Contraband'],
        standardNouns: ['Smuggler', 'Rogue', 'Scoundrel', 'Bandit', 'Swindle', 'Loot', 'Booty', 'Stash', 'Fence', 'Haul', 'Racket', 'Rascal', 'Rumrunner', 'Rat'],
        monitoringWords: ['Lookout', 'Crow\'s Nest', 'Spyglass', 'Watch Post'],
        researchWords: ['Workshop', 'Den', 'Lab', 'Hideout'],
        defensiveWords: ['Battery', 'Gun Nest', 'Redoubt', 'Bunker'],
        genericBaseWords: ['Hideout', 'Den'],
    },
};

/** Explicit style per shipped race (races/*.txt Name, lower-cased). */
const RACE_STYLES: Readonly<Record<string, ShipNameStyleId>> = {
    human: 'naval', ketarov: 'naval', ugnari: 'naval',
    boskara: 'hive', dhayut: 'hive', gizurean: 'hive',
    ikkuro: 'martial', mortalen: 'martial', naxxilian: 'martial', shakturi: 'martial', sluken: 'martial',
    atuuk: 'mercantile', haakonish: 'mercantile', securan: 'mercantile', teekan: 'mercantile',
    kiadian: 'scholarly', quameno: 'scholarly', zenox: 'scholarly',
    mechanoid: 'machine',
    ackdarian: 'mystic', shandar: 'mystic', wekkarus: 'mystic',
};

/** Race traits the fallback (modded races) reads; a subset of data/races.ts Race. */
export interface ShipNameRaceLike {
    name: string;
    raceFamily: number;
    aggression: number;
    intelligence: number;
    friendliness: number;
}

/** Empire fields the styling reads; a subset of empire.ts Empire. */
export interface ShipNameEmpireLike {
    name: string;
    dominantRace: ShipNameRaceLike | null;
    pirateEmpireBaseHabitat: unknown;
}

/** Style for a race: explicit table, else by race family / traits (raceFamilies.txt: 2 Insectoid, 6 Machine). */
export function resolveRaceShipNameStyle(race: ShipNameRaceLike): ShipNameStyle {
    const explicit = RACE_STYLES[race.name.trim().toLowerCase()];
    if (explicit !== undefined) return STYLES[explicit];
    if (race.raceFamily === 6) return STYLES.machine;
    if (race.raceFamily === 2) return STYLES.hive;
    if (race.aggression >= 120) return STYLES.martial;
    if (race.intelligence >= 125) return STYLES.scholarly;
    if (race.friendliness >= 110) return STYLES.mercantile;
    return STYLES.naval;
}

/** Style for an empire's ships, or null (no empire / no race: original naming unchanged). */
export function resolveEmpireShipNameStyle(empire: ShipNameEmpireLike | null | undefined): ShipNameStyle | null {
    if (empire === null || empire === undefined) return null;
    if (empire.pirateEmpireBaseHabitat !== null && empire.pirateEmpireBaseHabitat !== undefined) return STYLES.corsair;
    if (empire.dominantRace === null || empire.dominantRace === undefined) return null;
    return resolveRaceShipNameStyle(empire.dominantRace);
}

const INITIAL_SKIP = new Set(['of', 'the', 'and', 'de', 'la', 'du', 'von']);

/** Two-letter registry initials from an empire name ("Human Federation" -> "HF", "Zenox" -> "ZE"). */
export function empireRegistryInitials(empireName: string): string {
    const words = empireName.split(/[^A-Za-z]+/).filter((w) => w.length > 0 && !INITIAL_SKIP.has(w.toLowerCase()));
    if (words.length === 0) return '';
    if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

/** Role class of a sub-role for the registry prefix. */
export function shipNameRoleClass(subRole: BuiltObjectSubRole): ShipNameRoleClass {
    const S = BuiltObjectSubRole;
    switch (subRole) {
        case S.Escort: case S.Frigate: case S.Destroyer: case S.Cruiser: case S.CapitalShip:
        case S.TroopTransport: case S.Carrier: case S.ResupplyShip:
            return 'war';
        case S.ExplorationShip:
            return 'survey';
        case S.ConstructionShip: case S.MiningShip: case S.GasMiningShip:
            return 'works';
        case S.SmallFreighter: case S.MediumFreighter: case S.LargeFreighter:
        case S.ColonyShip: case S.PassengerShip:
            return 'civ';
        default:
            return 'base';
    }
}

/** Registry prefix ("HFS") for this empire + sub-role, or '' (bases, pirates, no initials). */
export function shipRegistryPrefix(style: ShipNameStyle, empireName: string, subRole: BuiltObjectSubRole): string {
    const roleClass = shipNameRoleClass(subRole);
    if (roleClass === 'base') return '';
    const template = style.registry[roleClass];
    if (template === '') return '';
    const initials = empireRegistryInitials(empireName);
    if (initials === '') return '';
    return template.replace('{I}', initials);
}

/** `name` with the empire's registry prefix for `subRole` prepended (unchanged when there is none). */
export function applyShipRegistryPrefix(empire: ShipNameEmpireLike | null | undefined, subRole: BuiltObjectSubRole, name: string): string {
    const style = resolveEmpireShipNameStyle(empire);
    if (style === null || name === '') return name;
    const prefix = shipRegistryPrefix(style, empire!.name, subRole);
    return prefix === '' ? name : prefix + ' ' + name;
}

/** Map an index drawn against the ORIGINAL list length onto a style list (keeps the RNG sequence). */
export function pickStyled(list: readonly string[], drawnIndex: number): string {
    return list[drawnIndex % list.length];
}

export const SHIP_NAME_STYLES: Readonly<Record<ShipNameStyleId, ShipNameStyle>> = STYLES;
