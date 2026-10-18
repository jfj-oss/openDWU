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
        about: 'The outer reaches of the galaxy become a frontier of their own: ion storms, thin stars and gravity shoals make travel and supply hard, while herds of creatures roam the rim and an isolationist rim empire trades its rare luxuries. A contraband spore from deadly rim worlds drains that empire until it cracks down and goes to war. Eight new creatures and a colder, lonelier look and sound complete it.',
        changes: 5,
        difficulty: 1,
        difficultyNote: 'Harder: fuel is scarce, travel is risky, the rim is hostile and Voidbloom addiction can reach your own colonies.',
        features: [
            { heading: 'The frontier belt', text: 'An ion-storm belt, thinning stars, gravity shoals that pull ships out of hyperspace, little fuel and poor sensors make the rim hard to reach and hold. Ordinary empires start inside the belt; pirate bases split the rim.' },
            { heading: 'Creature herds', text: 'Far more herds roam the rim than the core. They graze gas clouds, asteroid fields and mining stations and migrate each year into the settled space inside the rim. Eight new creatures (void whales, hunter packs, hull grazers, storm drifters, lantern shoals, nest mothers, scavengers, brood carriers) join them.' },
            { heading: 'Rim herders', text: 'Rim independents live with the herds: the herds are docile to them, their tamed freighters shrug off storms, and their ports are the only steady source of herd goods.' },
            { heading: 'The rim trade', text: 'An isolationist rim empire holds the rarest luxuries and trades them only for goods from the outer reaches, including its treasure fleet. With the Rim expansion the new-game wizard preselects Arrival: Late, so the Erutkah refugees of the Return of the Shakturi story come around years 50 to 60 (you can still choose otherwise).' },
            { heading: 'The Voidbloom War', text: 'Voidbloom grows only on deadly rim worlds worked by forced labour under guard. Smugglers carry it into the Concord\'s closed markets and addiction spreads like an epidemic; the silver drains out until the Concord cracks down while it is still strong. Tolerate, pay, back down or fight: a late war ends in an unequal treaty, the Diet can intervene, and a random aftermath follows.' },
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
        about: 'Threats come from outside and below. Early on, a generation ship arrives to claim a populated world and a dead civilisation\'s probe swarm spreads through the asteroid fields; what they leave behind are archive cores of lost technology. Later, hidden threats rise: a spreading cult, a hive mind, a hyperdrive-killing ruin, a mining swarm, ghost fleets, a robot uprising and more, forcing every empire to unite or fall.',
        changes: 3,
        difficulty: 2,
        difficultyNote: 'Much harder: an early crisis tests your fleet, and the late game turns against everyone.',
        features: [
            { heading: 'Generation ships', text: 'Early in the game a world ship and its escort arrive at the galaxy edge, scout a populated colony and demand it eighteen months later. Pilgrims, Heirs, the Ark Faith or the silent Quiet Ship: cede, offer another world, or fight.' },
            { heading: 'The dead probe swarm and archive cores', text: 'Self-replicating probes expand mining stations through the asteroid fields and attack any ship in their systems until their mothercore falls. Archive cores from world ships, the mothercore and ruins give research: study them slowly or seal them for one big payoff.' },
            { heading: 'The Cult and the Time-Bomb', text: 'A creed spreads from governor to governor across borders; ruins hold research with a planet-killing failure mode the cult can trigger.' },
            { heading: 'The Chorus (hive)', text: 'Every independent colony is a node of one hidden mind that declares once enough nodes have been absorbed.' },
            { heading: 'The Silence and the Grey Tide', text: 'A precursor ruin makes hyperdrives fail in a widening radius; a mining swarm eats extractors and founds nests.' },
            { heading: 'Ghosts, mutiny, doppelgangers, dark farms', text: 'Dead empires return as ghost fleets, robot garrisons rise on a broadcast, lost ships return as sleepers, and overdeveloped colonies grow hidden factories.' },
        ],
    },
    giantworks: {
        about: 'Independent worlds in three far-apart regions band together as the Founders\' Compact. Years later their convoys raise a gigantic scaffold in five stages, and nobody knows what it will be until it is finished: a resort and casino, a planet-sized supercomputer, an aquarium of void whales, or the Beacon that calls an extinction fleet from dark space.',
        changes: 2,
        difficulty: 1,
        difficultyNote: 'Slightly harder: most wonders pay whoever holds them, but one of them can end the galaxy, and you never know which before it is finished.',
        features: [
            { heading: 'The Founders\' Compact', text: 'Independent worlds in three far-apart regions band together as the Founders\' Compact. Years later their convoys build a gigantic scaffold in five stages, and nobody knows what it will be. Cargo hints and spies give a shortlist, never proof: protect it, sabotage it or destroy it before it is finished, and live with what it turns out to be.' },
            { heading: 'The wonders', text: 'The Gilded Orbit (a resort that smugglers may take over), the Ultramind (a supercomputer that can decide it is being abused), the Leviathan Sanctuary (a glass sphere of live void whales that can breach), the Ark Engine (a walking ark that takes the independents\' descendants home) and the Beacon (a relay that calls the Reclaimers; only in galaxies of six or more empires). Each can be switched off in the add-on\'s settings.' },
            { heading: 'The Gilded Orbit', text: 'The resort wonder pays its holder a flood of resort and tourism income and lifts the colonies round it. Three to six years after it opens, half the time smugglers take it over: that brings a pirate faction with three huge bases and a high-tier fleet, criminal networks and freighter raids, until all three bases are destroyed and the resort reopens, renovated, at 80%.' },
            { heading: 'The Ultramind', text: 'A planet-sized supercomputer that sells research to up to three empires (+100% for the empire whose territory holds it, +50% for the other partners) and keeps a standing for each: only the empire that declared a war, attacked it, sabotaged it or refused its requests loses standing. The holder sets one directive at a time (Research, War, Economy or Intelligence; action buttons under the selection panel). If any partner\'s standing reaches nothing it wakes and goes to war only with the partners that had lost its trust; the rest are offered a deal. Withdraw from the contract, grant its requests, deploy a Logic Bomb, or have the Diet sanction the empire that is upsetting it.' },
            { heading: 'The Leviathan Sanctuary', text: 'A glass sphere of live void whales that pays resort income, speeds the owner\'s nearby colonies\' growth and lets its whales breed. It breaches about once in fifty years if left alone, far sooner if it is shot at or sabotaged: enraged whales then hunt the nearest colony and the Leviathan itself comes out, while the owner pays a year of repairs.' },
            { heading: 'The Ark Engine', text: 'A planet-sized machine ship that roams from empire to empire. At each it picks one colony that used to be independent, parks beside it and takes that colony\'s original people home in a stream of free passenger ships. The people keep growing aboard. Its owner may let them go (the Compact\'s favour and a trade deal) or refuse; shooting down the passenger ships costs standing. Attack the Ark and it fights back; break its 30,000 shields and it flees to an empty system for a year to mend.' },
            { heading: 'The Beacon\'s harvest', text: 'Finished, the Beacon calls the Reclaimers, who take worlds and carry their people in huge cattle ships to a few harvest cores, where they are rendered into the fuel that pays for their troops and fleets. Intercept the cattle ships (their captives die), destroy a core\'s harvester or retake the core (its pens go free) to starve them. The game is lost when they have eliminated 80% of the galaxy\'s people.' },
            { heading: 'The Diet', text: 'Destroying the work before it is finished is a war crime unless the Diet authorises demolition. The Diet can also send inspectors, protect the work, internationalise a finished wonder or sanction the empire that is upsetting the Ultramind.' },
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
            { heading: 'Emergent politics', text: 'Internal politics, espionage consequences and refugees on top of the faithful game.' },
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
