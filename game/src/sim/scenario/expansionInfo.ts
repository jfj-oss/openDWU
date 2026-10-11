// Player-facing text of the expansions (addons.ts EXPANSIONS): the picker's "About" and meters and the Galactopedia's
// "Expansions" articles. The ratings are relative to each other: `changes` 1 (small) to 5 (rewrites much of the game),
// `difficulty` -2 (much easier) .. +2 (much harder) for the player. docs/EXPANSIONS.md carries the same text.

export interface ExpansionInfo {
    /** 2-4 sentences for the picker. */
    about: string;
    /** "Changes to the base game", 1..5. */
    changes: number;
    /** "Difficulty": negative = easier, 0 = neutral, positive = harder. */
    difficulty: number;
    /** The article's in-depth features: heading + text. */
    features: { heading: string; text: string }[];
    /** Shown under the difficulty meter: why. */
    difficultyNote: string;
}

export const EXPANSION_INFO: Readonly<Record<string, ExpansionInfo>> = {
    'the-rim': {
        about: 'The outer reaches of the galaxy become a frontier of their own: ion storms, thin stars and gravity shoals make travel and supply hard, while herds of creatures roam the rim and an isolationist rim empire trades its rare luxuries. Eight new creatures and a colder, lonelier look and sound complete it.',
        changes: 4,
        difficulty: 1,
        difficultyNote: 'Harder: fuel is scarce, travel is risky and the rim is hostile.',
        features: [
            { heading: 'The frontier belt', text: 'An ion-storm belt, thinning stars, gravity shoals that pull ships out of hyperspace, little fuel and poor sensors make the rim hard to reach and hold. Ordinary empires start inside the belt; pirate bases split the rim.' },
            { heading: 'Creature herds', text: 'Far more herds roam the rim than the core. They graze gas clouds, asteroid fields and mining stations and migrate each year into the settled space inside the rim. Eight new creatures (void whales, hunter packs, hull grazers, storm drifters, lantern shoals, nest mothers, scavengers, brood carriers) join them.' },
            { heading: 'Rim herders', text: 'Rim independents live with the herds: the herds are docile to them, their tamed freighters shrug off storms, and their ports are the only steady source of herd goods.' },
            { heading: 'The rim trade', text: 'An isolationist rim empire holds the rarest luxuries and trades them only for goods from the outer reaches, including its treasure fleet.' },
            { heading: 'Atmosphere', text: 'Cold colour grading, dark dust lanes, murk over unexplored rim systems, derelict hulks and eyes in the dark. Presentation only.' },
        ],
    },
    'politics-characters': {
        about: 'Characters travel in person and every colony needs a governor, whose loyalty can make or break it. A Galactic Council votes on sanctions and embargoes, internal security tracks unrest, reputation remembers what you did, and distant colonies drift toward local rule.',
        changes: 5,
        difficulty: 1,
        difficultyNote: 'Harder: unrest, espionage fallout and autonomy need active management.',
        features: [
            { heading: 'Characters and governors', text: 'Every relocation is a marked VIP shuttle that can be escorted, intercepted or destroyed. Every colony needs a governor; new characters appear as the game goes on.' },
            { heading: 'The Galactic Council', text: 'Once enough empires have met they found a council; a yearly motion (sanctions, embargoes, condemnations, recognition, declaring threats) is voted on, and outvoted members drift.' },
            { heading: 'Internal security', text: 'One stability ledger per colony and empire (approval, tension, shortages, cult influence, governor loyalty, martial law), each entry with its cause, that the colony revolt reads.' },
            { heading: 'Reputation and espionage', text: 'Attitude changes are kept as ledger entries with cause and size. Exposed agents open diplomatic crises, stolen technology is resold, and false-flag sabotage turns rivals against each other.' },
            { heading: 'Frontier autonomy and refugees', text: 'Distant colonies drift toward local rule. War, plague and disaster send refugee convoys to asylum, and colony race mix follows.' },
        ],
    },
    economy: {
        about: 'Colonies gain designations with real trade-offs, private companies settle and trade on charters, and scarcity shocks ripple through the private economy. Battles leave wrecks to salvage, and armed privateers answer pirate raids.',
        changes: 3,
        difficulty: 0,
        difficultyNote: 'Neutral: new opportunities and new shocks, for you and the AI alike.',
        features: [
            { heading: 'Colony designations', text: 'Industrial, Trade Hub, Resort World, Mining Hub, Core World or Frontier/Garrison: bonuses and drawbacks through the game\'s own mechanics.' },
            { heading: 'The Exchange', text: 'A neutral merchant-spy faction near the core funds the underdog of every war, runs agents against the strong and sells stolen intelligence.' },
            { heading: 'Chartered companies and corporate coups', text: 'Empires charter companies to settle distant worlds and collect a tariff; a company can buy governors and break away.' },
            { heading: 'Crises, privateers and salvage', text: 'Resources run dry, blockades starve colonies and prices spike. Private economies arm privateers against raiders, and wrecks drift as debris fields to be salvaged.' },
        ],
    },
    'galactic-threats': {
        about: 'Hidden end-game threats wait in the galaxy: a spreading cult, a hive mind, a hyperdrive-killing ruin, a mining swarm, ghost fleets, a robot uprising and more. Most stay quiet until late in the game, then force every empire to unite or fall.',
        changes: 2,
        difficulty: 2,
        difficultyNote: 'Much harder: the late game turns against everyone.',
        features: [
            { heading: 'The Cult and the Time-Bomb', text: 'A creed spreads from governor to governor across borders; ruins hold research with a planet-killing failure mode the cult can trigger.' },
            { heading: 'The Chorus (hive)', text: 'Every independent colony is a node of one hidden mind that declares once enough nodes have been absorbed.' },
            { heading: 'The Silence and the Grey Tide', text: 'A precursor ruin makes hyperdrives fail in a widening radius; a mining swarm eats extractors and founds nests.' },
            { heading: 'Ghosts, mutiny, doppelgangers, dark farms', text: 'Dead empires return as ghost fleets, robot garrisons rise on a broadcast, lost ships return as sleepers, and overdeveloped colonies grow hidden factories.' },
        ],
    },
    'living-galaxy': {
        about: 'The mid game gets livelier: strong peaceful empires grow restless and pick fights, border incidents and small invasions happen, and wars are fought for goals and can end on terms. Independents defend themselves and organise, and colonies can actually defend against pirate influence.',
        changes: 3,
        difficulty: 1,
        difficultyNote: 'Slightly harder: the AI is more active and less predictable.',
        features: [
            { heading: 'Restless empires', text: 'Strong peaceful empires pick fights, overlapping borders breed incidents, and small troop fleets may invade weakly held colonies.' },
            { heading: 'War goals', text: 'Wars are fought for goals and ended on terms.' },
            { heading: 'Emergent politics', text: 'Internal politics, resource crises, espionage consequences and refugees on top of the faithful game.' },
            { heading: 'Active independents and colony defence', text: 'Independents raise militia, build mining stations and form leagues; an owner\'s orbital defence now counts against pirate influence.' },
        ],
    },
};

/** A 1-5 bar as text for the meters ("●●●○○"). */
export function meterBar(n: number): string {
    const k = Math.max(0, Math.min(5, Math.round(n)));
    return '●'.repeat(k) + '○'.repeat(5 - k);
}

export function difficultyLabel(d: number): string {
    return d <= -2 ? 'Much easier' : d === -1 ? 'Easier' : d === 0 ? 'Neutral' : d === 1 ? 'Harder' : 'Much harder';
}
