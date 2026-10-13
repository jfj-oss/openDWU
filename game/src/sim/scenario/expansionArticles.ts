// Galactopedia field guide of the expansions: one short article per new thing an add-on brings that a player meets in
// game (creatures, factions, goods, ships, mechanics). Numbers are the add-ons' manifest defaults (scenarios/*/scenario.json)
// and the constants in src/sim/scenario/**. Colony Economy facilities, refined goods and designations have their own
// pages (ui/scenario/colonyEconomyPedia.ts). Rendered by galactopedia.ts; each article links back to its expansion.

export type ArticleKind = 'creature' | 'faction' | 'good' | 'ship' | 'mechanic';

export interface ExpansionArticle {
    /** Unique slug (the item id suffix). */
    id: string;
    /** EXPANSIONS id the article belongs to. */
    exp: string;
    /** Name of the add-on it comes from (as in the picker). */
    addon: string;
    kind: ArticleKind;
    /** Title without the kind suffix. */
    title: string;
    /** Paragraphs. */
    text: string[];
}

/** `exp` of an article of a standalone add-on (in no expansion; the Galactopedia lists it under Expansions). */
export const STANDALONE_EXP = 'standalone';

const A = (exp: string, addon: string, kind: ArticleKind, id: string, title: string, ...text: string[]): ExpansionArticle => ({ id, exp, addon, kind, title, text });

const RF = 'Rim Fauna';
const NF = 'New Fauna';
const RH = 'Rim Herders';
const RT = 'The Rim Trade';
const RFR = 'Rim Frontier';
const CV = 'Characters & Victory';
const VB = 'The Voidbloom War';

export const KIND_SUFFIX: Readonly<Record<ArticleKind, string>> = { creature: 'creature', faction: 'faction', good: 'good', ship: 'ship', mechanic: '' };

export const EXPANSION_ARTICLES: readonly ExpansionArticle[] = [
    // ---------------------------------------------------------------- The Rim
    A('the-rim', RF, 'creature', 'kaltor-herd', 'Kaltor Herd',
        'Rim herds are Kaltor groups of one leader and 3 to 6 followers (4 to 7 in all) that keep a home range of 20,000 units around a pasture. They graze gas clouds, asteroid fields and, above all, mining stations: each feeding tick eats 10% of every resource stock in the station\'s hold and deals 8 damage to it, and a station is three times as attractive as a bare cloud. Herds are common beyond 55% of the galaxy radius (0.4 herds per system at the rim, none at the core), up to 40 at game start.',
        'Every year, from day 90, half of the herds migrate up to 600,000 units, as far in as 35% of the radius, into settled space. Each station lost to a herd costs the nearby colony 3 approval (at most 20) until it fades. A full wild herd splits 15% of years and breeds 50% of years; wild herds below their starting count are replaced 30% of years.',
        'Deal with it: escort or defend stations in herd ranges (the AI weights escorts for grazed stations), kill the herd with warships, or befriend the Ossuvan herders, to whom herds are docile. Killed herds drop herd goods near herders.'),
    A('the-rim', NF, 'creature', 'void-whale', 'Void Whale',
        'A huge, gentle creature (size 1,000 to 1,400, groups of 1 to 3) that grazes and migrates but never starts a fight; it hits back if attacked. Whales occur everywhere at 0.012 groups per system, up to 20 groups, and migrate up to 4,000,000 units (half of the groups each season). A group gains a young 15% of years.',
        'Killing one drops a 40-unit haul into the killer\'s hold. Rim herders tame whales and use them as living freighters that shrug off storms. Leave wild whales alone unless you need the haul; they cost you nothing.'),
    A('the-rim', NF, 'creature', 'hunter-pack', 'Hunter Pack',
        'A pack of 4 to 6 fast Kaltor-based hunters (size 45 to 70). They stalk freighters within 40,000 units and ignore everything else; they flee any warship within 25,000, for 60,000 units. A pack gains a young 50% of years; no more than 30 packs exist before brood carriers stop seeding.',
        'Escort freighters with a warship, or avoid pack ranges. Herders tame packs as living miners.'),
    A('the-rim', NF, 'creature', 'hull-grazer', 'Hull Grazer',
        'A slug that finds ships and stations within 60,000 units (it drifts toward traffic from up to 1,500,000) and latches onto the hull. Each grazer deals 10 hull damage a day, through shields, and siphons 3% of the host\'s fuel capacity a day. A host carries at most 2 grazers, a system 8 and the galaxy 70; a new grazer spreads to a ship or station met within 2,000 units 20% of the time, every 30 days.',
        'A working point-defence component deals 25 damage a day to a latched grazer, and a space port\'s crews scrape one off 10% of days. Keep point defence fitted, and quarantine infested ships from your docks.'),
    A('the-rim', NF, 'creature', 'storm-drifter', 'Storm Drifter',
        'A creature (size 260 to 380) that rides the rim\'s ion storms in a cloud of 30,000 units radius. Inside it, ship sensor range falls to a tenth, and hyperjumps may misfire. Every tick 5% of drifters ride to another storm. It does not attack.',
        'Route around the cloud, or fly a herder guide\'s lane. Sensor probes and listening posts outside the cloud keep watch.'),
    A('the-rim', NF, 'creature', 'lantern-shoal', 'Lantern Shoal',
        'A harmless swarm of lights (size 180 to 260) drifting into the rim\'s gravity shoals. Civilian jumps passing within 40,000 units stop at the lights, so ships that follow them end up in a shoal and are pulled out of hyperspace.',
        'Route freighters away from the lights, or send a warship to scatter them.'),
    A('the-rim', NF, 'creature', 'nest-mother', 'Nest Mother',
        'A stationary giant (size 1,600 to 2,200) that guards the richest habitat of a rim system within 15,000 units. Every 120 days she spawns a young, up to 6, that stay as her herd (size 30 to 50, fast). When she has lost 70% of her hit points she escapes by hyperdrive at least 3,000,000 units away and founds a new nest.',
        'Do not settle or mine in her system unless you bring a fleet; if you do, finish her before she flees or she reappears elsewhere. The system holds the richest habitat.'),
    A('the-rim', NF, 'creature', 'scavenger', 'Scavenger',
        'A slug (size 90 to 150, groups of 1 to 3) that eats wrecks and debris fields within 120,000 units, 20 salvage a tick, and carries the salvage. Killing one drops that salvage into the killer\'s hold. It never attacks.',
        'Salvage your own wrecks first (see Wreckage and Salvage), then hunt scavengers for the load. A group gains a young 30% of years.'),
    A('the-rim', NF, 'creature', 'brood-carrier', 'Brood Carrier',
        'A big traveller (size 700 to 950) with the fastest hyperdrive of the fauna. It crosses up to 400,000 units, and every 180 days seeds a hunter pack at a planet it passes within 20,000 units (until 30 packs exist).',
        'Kill carriers early; a dead carrier seeds nothing.'),
    A('the-rim', NF, 'creature', 'tamed-creatures', 'Tamed Creatures',
        'Rim herders tame whales and hunter packs near their colonies (60,000 units; one tamed whale and hunter herd per herder colony at start). A tamed creature carries a harness, is docile to its herders, counts as one of their herds for the harvest, and a tamed whale walks with a herder freighter as a living freighter.',
        'Do not attack harnessed creatures if you want herder standing: each kill costs 8 standing.'),
    A('the-rim', RH, 'faction', 'ossuvan-herders', 'Ossuvan Herders',
        'Six independent peoples of the rim live with the herds (the Ossuvan race; "symbiotic"). Herds are docile to their colonies and ships, defend them from up to 30,000 units, and the herders harvest herd goods every 90 days (4 per herd member, stock cap 1,500 per colony). Their tamed freighters shrug off storms.',
        'Peaceful neighbours gain 10 standing a year (cap 100). At 20 standing the herders lend a drover and a guide. Killing herd creatures costs 8 standing each; a protectorate is offered after 3 years without a herd kill, with 50% of the herd goods paid to the protector yearly. Conquering a herder colony leaves its herds feral for 5 years, with attack range x4 and 80% of a mature herd\'s hit piercing armour.'),
    A('the-rim', RH, 'mechanic', 'drovers-and-guides', 'Drovers and Guides',
        'Two herder characters offered to a neighbour at 20 standing. A drover rides with a ship or fleet and herds ignore that ship; a guide reveals safe lanes through gravity shoals and fog around the ship carrying it. They leave if standing falls below 0.',
        'Station a guide on freighters crossing the shoals; keep standing up by not killing herd creatures.'),
    A('the-rim', RH, 'mechanic', 'migration-warnings', 'Migration Warnings',
        'The herders warn you 30 days before the yearly migration season about the corridors (60,000 units around herd ranges) the herds will cross. A warship that ignores a warning inside a corridor costs 15 standing; warships within 2,000 units of their own colony or base are exempt.',
        'Move fleets and slow freighters out of the corridors for the season.'),
    A('the-rim', RH, 'mechanic', 'stampede', 'Stampede',
        'When a herder colony is attacked, up to 3 wild herds within 4,000,000 units rally to defend it for 60 days (at most once per 360 days per colony).',
        'Do not invade herder colonies without a plan; the AI waits at a staging post with 40,000 troop strength for up to 2 years before it gives up.'),
    A('the-rim', RH, 'good', 'kaltor-shell', 'Kaltor Shell',
        'A herd good (base price 30) that never occurs on planets. Herders harvest it from the herds; killing a herd creature drops 10 units. Herd goods count as rim goods for the Oranthi Concord when both add-ons are on.',
        'Buy from herder ports, your protectorate tribute, or kill drops. Trade it to the Concord as a rim good.'),
    A('the-rim', RH, 'good', 'kaltor-crystal', 'Kaltor Crystal',
        'The second herd good (base price 35), harvested and dropped in the same way as Kaltor Shell. It counts as a rim good for the Concord.',
        'See Kaltor Shell.'),
    A('the-rim', RT, 'faction', 'oranthi-concord', 'Oranthi Concord',
        'The isolationist rim empire (Oranthi race, built on the Ackdarian stock) with 3 starting colonies (at most 10), a treasury of 5,000,000, 40 starting warships (navy target 80) and tech level 4, though it holds Ship Construction level 8. It trades its rare goods only for rim goods, never starts a war and barely expands. At year 1 it broadcasts to every empire.',
        'Trade: standing of 1,500 opens its port (the capital port only, if single port is on); it buys up to 400 units of each rim good and sells rare goods at 2.5 per rim good. It declares war only on an empire that provoked it: standing below -3,000 angers it, and then its fleets retaliate within 2 sectors at twice the damage taken (at most 2,000 war value), with 2 strike fleets of up to 8 ships while half the navy stays home. Never provoke it: its warships are huge and long-ranged.'),
    A('the-rim', RT, 'good', 'rim-goods', 'Rim Goods',
        'Voidstone (price 30), Rimfrost Lichen (40) and Umbral Gas (30) occur only in the outer ring beyond 72% of the galaxy radius. They are the only currency the Concord accepts. Each year the Concord consumes 200 units of each.',
        'Find them with survey ships on the rim and ship them to the Concord\'s port or treasure fleet. Herd goods count too.'),
    A('the-rim', RT, 'good', 'oranthi-porcelain', 'Oranthi Porcelain',
        'A rare good (price 250) with no source except the Concord. A colony holding it gains +8 approval and +20 development (a rare good is worth 50, a stock luxury 30). Colonies order rare goods from development 60 (stock 80).',
        'Sell the Concord rim goods to earn standing, then buy.'),
    A('the-rim', RT, 'good', 'moonsilk', 'Moonsilk',
        'A rare good (price 250). A colony holding it earns +15% income and +20 development.',
        'Same trade as Oranthi Porcelain.'),
    A('the-rim', RT, 'good', 'starleaf-tea', 'Starleaf Tea',
        'A rare good (price 250). A colony holding it grows its population 25% faster and gains +20 development.',
        'Same trade as Oranthi Porcelain.'),
    A('the-rim', RT, 'ship', 'treasure-ship', 'Treasure Ship',
        'The Concord\'s trading ship (size 1,500) that sails in the treasure fleet. Every 360 days a fleet of 8 treasure ships, escorted by 3 capital ships, 5 cruisers and a carrier, circles 6 foreign ports (one per empire), buying rim goods and selling rare goods, 200 units per good per ship per stop. Each leg a ship straggles 4% of the time, for 10 to 40 days; the escorts turn back after 20.',
        'Its beacon is visible to every empire. Docking is a safe way to trade. Sinking a treasure ship costs 3,000 standing and invites war.'),
    A('the-rim', RT, 'ship', 'concord-designs', 'Concord Designs',
        'Every Concord warship (escort to capital ship and carrier, troop transport and resupply ship) is built at the maximum construction size (1,350, carriers x1.5) with extra fuel cells for a range of 40 sectors. The Concord starts with the most efficient drive, reactor and fuel cell. Its ships use real insect-photo art with grafts and blinking lights.',
        'Expect large, long-ranged ships; match them with mass, not numbers.'),
    A('the-rim', RT, 'mechanic', 'treasure-fleet', 'The Treasure Fleet',
        'A yearly voyage of the Oranthi Concord: see Treasure Ship. The route is the nearest foreign ports; arrivals and departures are announced. The beacon option shows the fleet to everyone wherever it sails.',
        'Meet it at your port with rim goods in stock.'),
    A('the-rim', RT, 'mechanic', 'treasure-raids', 'Treasure Raids',
        'Each time the treasure fleet leaves a port, each treasure ship has a 4% chance to straggle for 10 to 40 days: it stays to finish loading, detours to refuel, or an engine fault (2 to 6 days out) stops it dead for 5 to 20 days. A straggler more than 60,000 units from every escort is exposed; after 20 days the convoy holds and the escorts turn back for it.',
        'Every 5 days pirates and aggressive AI empires (never a human player, never the Concord) weigh a raid within 8 sectors: the loot must outweigh the 3,000 standing penalty and their force must have 1.5 times the firepower defending the target within 150,000 units (up to 4 fleets combined against the main body). A sunk treasure ship\'s cargo goes to the raider\'s nearest space port; a captured one keeps it in the hold.',
        'Protect stragglers near your space, or catch one yourself if the Concord\'s anger is worth the cargo.'),
    // The Voidbloom War (docs/VOIDBLOOM_WAR.md; numbers are scenarios/voidbloom/scenario.json defaults).
    A('the-rim', VB, 'good', 'voidbloom', 'Voidbloom',
        'A contraband spore (price 120), its own category: no stock luxury slot. It grows only on a few Voidbloom worlds in the rim (one per 140 stars, at least 3) and only a colony there can harvest it, about 12 units every 30 days per million workers to the power 0.6, stockpiled up to 4,000. No mining station can take it.',
        'A colony that tastes it gets a short boost (up to +8 approval, +20 development while freshly supplied) and an addiction that grows each supplied month and fades slowly: up to -14 approval, -25% income and +50% corruption at full addiction, and up to -18 approval more in withdrawal when the supply stops.',
        'Where it is banned only smugglers sell it (pirates, independents and empires whose policy is to smuggle), at a 150% black-market premium. Every purchase is paid mostly by the buyer\'s private sector and 15% by its state treasury: the silver drain.'),
    A('the-rim', VB, 'mechanic', 'voidbloom-worlds', 'Voidbloom Worlds',
        'Deadly rim planets: nobody is born there and 35% of the people die each year. They need labour convoys (12 million workers, 15,000 credits, every 90 days below 40 million; conquered peoples go first) and a garrison of 2 troops plus 1 per 10 million workers. A short garrison risks a revolt (up to 12% a month): the workers take the world for themselves.',
        'AI empires value them four times as much as any other colony target and send fleets against worlds held by enemies or independents. If no empire has settled one by year 10, a rim cartel does.'),
    A('the-rim', VB, 'mechanic', 'voidbloom-spread', 'Voidbloom Spread',
        'Demand spreads like an epidemic, not everywhere at once: a colony starts to want Voidbloom only after exposure from growing worlds and addicted colonies within 14 sectors. The Concord\'s colonies are three times as exposed (the Canton market) and smugglers seek them out from anywhere once anyone grows it.',
        'A ban halves the exposure (half again with a Customs Bureau, less with Internal Security) and a banning empire\'s colonies seize what they find. Some races are resistant, a few immune; stable governments and contented colonies resist best.'),
    A('the-rim', VB, 'mechanic', 'the-crackdown', 'The Crackdown',
        'When 12% of the Concord is addicted, or 400,000 credits have drained out of it, a commissioner is appointed to its worst-hit colony and publishes an open letter. Customs then search every ship carrying Voidbloom near a Concord colony (30% a sweep near the commissioner, half elsewhere) and burn what they seize in public. Neutral ships searched cost the Concord their owners\' goodwill.',
        'Each smuggling empire faces the crisis: back down and hand over the smugglers, pay 250,000 credits for 5 years of quiet, tolerate a police action, or go to war. The police action is a task force of 8 warships that blockades your Voidbloom worlds, raids and destroys their stock, burns the fields (25% yield for 540 days), frees labour convoys, hunts your freighters, kills governors and finally occupies a world whose garrison is too thin.'),
    A('the-rim', VB, 'mechanic', 'unequal-treaty', 'The Unequal Treaty',
        'The Concord cracks down while it is still strong; a war then is very hard. It signs away rights only once it has declined (addiction, the silver drained, an empty treasury and its frozen research all count). The terms: a barren rock ceded (it grows into a trade hub), an indemnity in instalments, a treaty port, no tolls, no inspections, a 10% cut of its customs income and legal Voidbloom. Strong empires later demand the same (most-favoured nation).',
        'A random aftermath follows, shifted by the treaty\'s harshness: Self-Strengthening and a revanche war 15 to 30 years on, a zealot\'s civil war, a client state, an opening that wakes the giant, or collapse into successor states. Ten years on a pretext incident offers the victor a second war; the Concord capital\'s wonder can then be looted and burned.'),
    A('the-rim', VB, 'mechanic', 'voidbloom-diet', 'Voidbloom in the Diet',
        'With the Interstellar Diet the Concord sits and votes as a full member but never hosts it nor holds the Regency. Members vote by self-interest: those hurt by the drug for Ban Voidbloom, those profiting from smuggling or wanting open Concord ports against; with no strong interest, a slight lean to the ban. Motions: Ban Voidbloom, Open the Concord\'s Ports, a Diet-mediated treaty, sanctions on smugglers or on the Concord, and after legalisation Galactic Prohibition.',
        'After legalisation the galaxy grows dependent on the rim growers, temperance movements demand bans, neural detox research (300,000 credits, 4 years) speeds recovery, leaders pick up the habit and pirate syndicates grow rich.'),
    A('the-rim', RFR, 'mechanic', 'storm-belt', 'Storm Belt and Gravity Shoals',
        'Beyond 70% of the galaxy radius an ion-storm belt (density 0.5) damages ships, stars thin out (half of the positions past 60% are rejected), 4 gravity shoals pull ships out of hyperspace, and ship sensors there work at half range (listening posts are exempt). Ordinary empires start inside the belt; 60% of new pirate factions are placed in the rim.',
        'Carry a herder guide to reveal safe lanes, or wait for storm drifters and lantern shoals to move on.'),
    A('the-rim', RFR, 'mechanic', 'rim-fuel', 'Rim Fuel',
        'Caslon and Hydrogen occur only inside 65% of the radius, with one guaranteed fuel source per rim sector as an oasis. Pirate rim bases prefer to sit within 2,000,000 units of an oasis.',
        'Build fuel depots at oases and plan jumps by range.'),
    A('the-rim', RFR, 'mechanic', 'pirate-herd-hunts', 'Pirate Herd Hunts',
        'Pirate factions within 300,000 units of a herd send ships after it 30% of years and are paid 500 credits per herd member killed. New bases keep 5,000 units clear of herd ranges.',
        'Escort herds in your protectorate, or kill the hunters.'),

    // ------------------------------------------------- Politics & Characters
    A('politics-characters', CV, 'ship', 'vip-shuttle', 'VIP Shuttle',
        'Every character relocation is a free shuttle (size 180) carrying one passenger, with gold ring marking, no weapons, no upkeep and no fuel. It cannot be ordered, and if it is destroyed or captured its passenger dies. A ruler travels with 2 identical decoys; a Steal Operations Map mission reveals the real one.',
        'Idle warships escort important trips automatically (at most 20% of idle warships; important trips wait up to 60 days). Attacking another empire\'s shuttle costs 15 attitude with the victim, a ruler\'s 40. Use the "Automate VIP escorts" setting and the Characters screen\'s escort level.'),
    A('politics-characters', CV, 'mechanic', 'governor-vacancy', 'Governor Vacancy',
        'Every colony needs a governor. A colony with none (colonies under 50 million are exempt) has a 360-day grace; then neglect rises over 4 years: construction pauses, output falls up to 50%, approval falls up to 20, development falls 2 levels a year, and emigration starts. A governor takes 5 years to recover a fully neglected colony. A Diet delegate who dies leaves the post locked for 5 to 6 years.',
        'Keep reserve governors (10% of colonies), trained at the capital in 180 days for 2,000 credits.'),
    A('politics-characters', CV, 'mechanic', 'interstellar-diet', 'The Interstellar Diet',
        'With Characters & Victory on, the galactic council is the Interstellar Diet. Sessions meet every 2 to 3 years at a host world (the strongest member\'s colony nearest the galaxy centre), which gains +15% income, happiness and growth, +25% construction speed and tourism. Delegates travel there by VIP shuttle (150 days to gather, 60 to vote); only those present vote. A lesser delegate votes at half weight.',
        'Attacking delegates or the host world costs 30 attitude with every member; attacking the enforcers 25.'),
    A('politics-characters', CV, 'mechanic', 'diet-motions', 'Diet Motions',
        'Each session considers 1 to 3 motions: sanctions, embargoes, condemnations, lifting, recognising a new state or a claim, an enforced truce (3 years), galactic free trade, banning planet destroyers or bombardment, outlawing a pirate faction (1,500 bounty per warship), protecting or opening the independents, expulsion (10 years) and repeal. A motion passes when the weighted yes beats the no; weight is 10 times the root of the member\'s score ratio, raised by standing, gifts and spying.',
        'Send gifts and spies before the vote, and move your own motion each session.'),
    A('politics-characters', CV, 'ship', 'council-enforcers', 'Council Enforcers',
        'A sanction sends a neutral fleet from the host world to blockade the sanctioned empire\'s colony: 6 cruisers, 2 carriers, 2 capital ships and 2 resupply ships, x1 to x3 by the target\'s strength, copied from members\' designs. It blocks trade and construction there and only returns fire. Members pay half the price, then 10% a year.',
        'Lift the sanction to recall it. Attacking it is open defiance (-25 attitude with every member).'),
    A('politics-characters', CV, 'mechanic', 'delegate-strikes', 'Delegate Strikes',
        'An AI empire at war with a delegate\'s empire may attack the delegate\'s VIP shuttle on its way to or from a session if it is aggressive and careless of its reputation, or desperate (under 0.6 of its enemy\'s military). It sends its nearest warship within 4 sectors and fuel reach, at most once per pair of empires every 120 days. A shuttle at warp cannot be caught, so the strike comes while it is slow: at its origin, or lying in wait at its destination. A delegate who dies abroad leaves a post that takes 5 to 6 years to fill.',
        'Let idle warships escort your delegate, and keep wars few in a session year.'),
    A('politics-characters', CV, 'mechanic', 'regent-and-emperor', 'Regent and Emperor',
        'The strongest member can be elected Regent for 6 years, with a veto once per session and an emergency session every 4 years. A Regent may bid to be Emperor: the AI bids with 25% of the members\' score or military. The Emperor wins the game by holding their capital and the host world for 5 years; everyone may declare war on an Emperor, and the bid fails if either is lost.',
        'Take the host world from a rival Regent, or ally against the bidder.'),
    A('politics-characters', 'Galactic Council', 'mechanic', 'galactic-council', 'Galactic Council',
        'Once 3 empires have met, a council forms. Each year a motion is put to a vote (60 days for the player). Outvoted members drift into blocs after 3 shared defeats; a bloc votes as one after 2 years and may split the council after 6. Declaring a threat gives members a yearly joint-defence attitude bonus against it.',
        'Sanctions last at least 3 years. A leaver cannot rejoin for 5 years and costs 10 attitude with each member.'),
    A('politics-characters', 'Internal Security', 'mechanic', 'internal-security', 'Internal Security',
        'A stability ledger per colony and empire records each cause of unrest (approval, ethnic tension, shortages, herd losses, cult influence, governor loyalty, purges, martial law). Hidden plots produce leads through one counter-intelligence roll; agents investigate (90 days) and confirmed leads unlock arrests, exile, purges (5 approval for 2 years), amnesty (+20 loyalty), quarantine (3 years), martial law (8 approval for 5 years), fleet recalls and scrapping suspect ships.',
        'Read the ledger before ordering a purge; martial law costs approval.'),
    A('politics-characters', 'Reputation & Grievances', 'mechanic', 'reputation-ledger', 'Reputation Ledger',
        'Every attitude change an add-on makes between two empires is a ledger entry with its cause, size and yearly fade. The diplomacy screen lists why each empire feels as it does.',
        'Open the diplomacy screen to see which grievance to repair.'),
    A('politics-characters', 'Espionage Consequences', 'mechanic', 'espionage-crises', 'Espionage Crises',
        'An exposed agent opens a diplomatic crisis (demand, sanction or war) once its severity passes 12. Stolen technology is resold on the black market (25% a year), and a false-flag mission (AI chance 30%) can turn two rivals on each other.',
        'Use agents with skill, and answer a demand before it grows into war.'),
    A('politics-characters', 'Frontier Autonomy', 'mechanic', 'frontier-sectors', 'Frontier Sectors',
        'Distant colonies drift toward local rule: autonomy grows with travel time to the capital (up to 3 steps, 2 a year each), no warships (3), a different race (3) and low approval, and shrinks with a governor of the ruling house (4), a nearby fleet (3) and high approval. Two or more colonies past autonomy 40 in one sector form a frontier sector under a sector governor who sets a local tax (down to 50% at autonomy 100), raises a militia (20% of its tax, up to 3 ships), signs trade compacts (25% a year) and may refuse unpopular orders.',
        'Rule it loosely (tax 80%, smuggling tolerated, slower drift) or tightly (tax 110%, 3 unrest, faster drift). Past autonomy 65 with a governor under 35 loyalty, the sector warns for 2 years and then secedes; fleets, honours, a purge or a concession answer it.'),
    A('politics-characters', 'Refugees & Demographics', 'mechanic', 'refugees', 'Refugees',
        'War, bombardment, plague, disaster and harsh population policy send convoys of refugees (15% of the population) to asylum. Colony race mix, ethnic tension and migration links follow, and tension feeds the stability ledger. Refugees from a cult-held colony carry the creed half the time.',
        'Offer asylum for population, or quarantine for security.'),

    // ----------------------------------------------------------------- Economy
    A('economy', 'The Exchange', 'faction', 'exchange', 'The Exchange',
        'A neutral merchant-spy faction that appears in year 7 near the galactic core as a vast trading station. It funds the weaker side of every war (5% of its treasury a year), runs 6 high-skill agents (up to 20), sells intelligence on rivals (20,000 base), hires pirates in its own name and guards its system with 2 patrol fleets (20 warships at most). Its income is 100,000 a year of existence, up to 1,000,000; docking costs a 5% tariff.',
        'Trace its money and spies, have the council sanction it, and blockade it for 120 days (or destroy the station) to close it.'),
    A('economy', 'Chartered Companies', 'faction', 'chartered-company', 'Chartered Company',
        'A trading company chartered by an empire (fee 30,000) is a sub-empire of the founder\'s race, bound by a Subjugated Dominion or Protectorate treaty, starting with 50 million settlers, 3 escorts and 2 freighters. It pays the founder 15% of its sales for 20 years; charters can be renewed, released or nationalised. Two companies per founder; the AI charters rivals (25% a year).',
        'Charter companies on the far rim to claim land cheaply; watch for governors being bought.'),
    A('economy', 'Corporate Coup', 'mechanic', 'corporate-coup', 'Corporate Coup',
        'A chartered company buys the founder\'s colony governors (10 per mille a year each); once 3 are bought and the charter is 10 years old, it declares independence with its fleet and the bought colonies. If the company holds 40% of the founder\'s population, the founder loses.',
        'Keep governors loyal, nationalise suspect charters and watch the stability ledger.'),
    A('economy', 'Privateers', 'ship', 'privateer', 'Privateer',
        'A small armed ship built by an empire\'s private economy once raiders have hit it. At most 40% of the largest buildable ship, one tier behind the best components (engines, hyperdrives and reactors the best), paid from private money (18% of private income, one per 8 private ships and bases). Fully automated: escorts busy routes, guards threatened mining stations and flees much stronger foes.',
        'Viewable but cannot be ordered; they do not count in the navy\'s plans.'),
    A('economy', 'Wreckage & Salvage', 'mechanic', 'salvage', 'Wreckage and Salvage',
        'Every destroyed ship or base drifts into a debris field (joins a field within 4,000 units, decays in 10 years). A construction or mining ship ordered to a field (right click) recovers 30% of the build resources of 3 wrecks per 30-day trip, and 20% of trips yield a foreign technology. Pirates salvage too and raid twice as fast within 150,000 units of a field with 5 or more wrecks.',
        'Salvage after battles; clear fields near pirate territory.'),

    // --------------------------------------------------------- Galactic Threats
    A('galactic-threats', 'Threat Framework', 'mechanic', 'threat-framework', 'Hidden Threats',
        'Each hidden threat exists in a game with a 25% chance, and none can seed, trigger or rise before year 30 (each can be set alone). Most are quiet until the late game, then force every empire to unite or fall. Trace scanners, spies and counter-intelligence find them early.',
        'Do not assume any threat exists in your game; do not ignore leads.'),
    A('galactic-threats', 'Generation Ships', 'faction', 'generation-ships', 'Generation Ships',
        'Once two empires reach tech level 3 (from year 5; by year 15 at the latest), a giant world ship arrives at the galaxy edge with an escort of about 1.3 times the military firepower of the empire it chooses (never below 700), at that empire\'s tech level, and troop transports with 30 regiments per 1,000 escort firepower (12 to 90). From first contact the threatened empire funds a navy more than twice its usual size, gathers it over the world and raises its garrison there. It wants one populated colony. A scout arrives first; first contact comes about 2 months after the arrival, the ultimatum 18 months after that: build up, or prepare to give the world away.',
        'Four kinds arrive. Pilgrims plead and accept another world (an empty habitable planet nearby, or one of your smaller colonies); settled, they are a grateful protectorate. Heirs of an old empire give only cede or war, and hold a lasting grudge if you cede. The Ark Faith takes no substitute and fights to the end; its survivors scatter. The Quiet Ship sends nothing but what your scouts see: its crew is long dead and its ship mind follows its colonisation orders, so it must be beaten in battle.',
        'Ceded or conquered, the world ship lands and its 1,500 million sleepers found a small empire. Destroyed, it leaves a wreck field (salvage with Wreckage & Salvage) and often an Archive Core; captured by the stock boarding rules, its sleepers join your nearest colony and you recover a core. If the fleet loses its warships and troops, or fights 2 years without winning, it scatters.'),
    A('galactic-threats', 'Archive Cores', 'mechanic', 'archive-cores', 'Archive Cores',
        'Sealed memories of lost technology, recovered from a captured or destroyed generation ship, from the Probe Swarm\'s mothercore, or rarely (4%) from investigated ruins. Choose: study it (4 yearly boosts of 8% of a year of your research each) or seal it (one boost of 45% after 5 years). A boost goes into your current research projects; the smallest is 15,000 points.',
        'Study when you need help now; seal when you can wait. The AI studies at war and seals at peace.'),
    A('galactic-threats', 'Dead Probe Swarm', 'faction', 'probe-swarm', 'Dead Probe Swarm',
        'From year 6, the self-replicating probes of a long-dead civilisation wake at an asteroid field far from every capital. Their mothercore is a base like a pirate\'s, with tech-3 ships, but they never raid, extort, take missions, trade or talk. They earn 60,000 a year plus 15,000 per mining station (at most 250,000) and spend it only on warships and on new mining stations, one every 75 days, at the richest free asteroid fields, gas giants, planets and moons nearest the mothercore (with no limit on stations, and 4 warships plus one for every two stations), never on a colonised world. They may build in systems that hold colonies; there their warships attack ships but never raid or invade the colony, and fire on its defences only in return. Systems they hold glow dark brown on the galaxy map.',
        'Any ship that enters a system with a swarm station is attacked. Destroy the mothercore to stop the expansion: the swarm dissolves, its stations drift to the independents, and the killer salvages 60,000 points of drone technology and an Archive Core.'),
    A('galactic-threats', 'The Cult', 'faction', 'cult', 'The Cult',
        'A creed that appears in year 40 and spreads from character to character (8% a period; ambassadors 15%), across borders. A colony is cult-held when its governor is converted. When one empire has 4 cult-held colonies, the cult secedes and rises as a theocracy.',
        'Counter-intelligence detects agents; quarantine, purge or exile converted governors.'),
    A('galactic-threats', 'Time-Bomb Tech', 'mechanic', 'time-bomb', 'Time-Bomb Tech',
        'From year 30, 3 precursor ruins hold research with huge bonuses and a planet-killing failure mode. A cult cell on a colony whose empire holds the tech may detonate it (2 per mille a year per node, at most 5%); at war the seceded cult does so on purpose (10% a year). Five destroyed planets end the game while the cult is undefeated.',
        'Do not research the tech if the cult is alive.'),
    A('galactic-threats', 'The Hive', 'faction', 'chorus', 'The Chorus (Hive)',
        'Every independent colony at game start (at least 5) is a node of one hidden mind. A node absorbed by an empire stays a node. When 40% are absorbed the Chorus declares, taking up to 30 independent nodes outright and rising from inside every absorbed one with militia 1.5x as strong.',
        'Absorb independents sparingly; confirm nodes with agents (15% a period).'),
    A('galactic-threats', 'The Silence', 'faction', 'silence', 'The Silence',
        'From year 50 a precursor ruin transmits and hyperdrives fail in a widening radius (5,000, growing 4,000 a year to 120,000; pirates are immune). Stranded fleets and pirate raids are the danger.',
        'A ship holding position at the source for 60 cumulative days shuts it down.'),
    A('galactic-threats', 'Grey Tide', 'faction', 'grey-tide', 'Grey Tide',
        'From year 60 a dormant mining swarm seeds in an unexplored gas giant. Each nest builds 3 drones a year and founds another after 4 years (40 nests at most). Drones within 3,000 units eat resource extractors; they never attack colonies.',
        'Explore systems to expose nests, and destroy every nest to end it.'),
    A('galactic-threats', 'Ghost Armada', 'faction', 'ghost-armada', 'Ghost Armada',
        'Three years after an empire dies, the wrecks of its lost warships (up to 40 recorded) rise as a ghost fleet of up to 30 ships flying its old colours, raiding within 60,000 units of the debris field, and targeting the empire that destroyed it.',
        'Mind your kills: the dead come back.'),
    A('galactic-threats', 'Robot Mutiny', 'faction', 'robot-mutiny', 'Robot Mutiny',
        'From year 70, when 30 robot (BattleBot) troops exist galaxy-wide, one hidden transmitter on a ruin world can wake them. Garrisons of 2 or more robots build 15 hidden sleepers a year. At the broadcast colonies rise wherever robots can win; the first captured colony makes the machines a full empire, and the transmitter spawns beacon warships (100, 200, then 300 a year, one tech level above the best empire) until silenced. 40% of the population ends the game.',
        'Keep robot garrisons small; agents find the source (8% a period).'),
    A('galactic-threats', 'Doppelgangers', 'faction', 'doppelgangers', 'Doppelgangers (The Mirror)',
        'Ships lost to capture return as sleepers (35% on recapture); derelicts of an empire\'s own designs are planted near it (2 a year). With 8 live sleepers The Mirror rises and every sleeper turns on its old fleet at once.',
        'Trace scanners (10% a period) reveal sleepers.'),
    A('galactic-threats', 'Dark Farms', 'faction', 'harvester-collective', 'Harvester Collective (Dark Farms)',
        'From year 25 an overdeveloped colony (development 70, population 3,000 million) may grow a hidden factory (4 per mille a year, 2 at most) that builds 6 robot troops (strength 60) and 2 armed sleeper freighters a year. At 10 sleepers (or 20% of the host fleet, or after 12 years) the Harvester Collective rises, using blight bombardment (25%), assault pods and saboteurs, and spreads by invading weakly garrisoned worlds. A Harvester majority of 40% ends the game.',
        'Trace scanners (10%) and agents (15%) find farms; retaking the colony destroys the farm.'),

    // ----------------------------------------------------------- Living Galaxy
    A('living-galaxy', 'Lively Galaxy', 'mechanic', 'restless-empires', 'Restless Empires',
        'An empire with idle warships and long peace gains ambition (1 a year at 15 idle ships, up to 20); at 5 it grows restless and relaxes its war-review threshold (0.6 per point). Overlapping borders breed yearly incidents (35% at the reference overlap) that sour relations by 4. Troop fleets smaller than the stock 10 ships may invade colonies under 30,000 troops.',
        'Keep garrisons up on contested borders.'),
    A('living-galaxy', 'Lively Galaxy', 'mechanic', 'war-goals', 'War Goals and Terms',
        'Wars record a goal and a war score (50 per invasion, 1 per blockade-day, 200 while the goal is held). Peace carries terms priced by the score: ceded colonies (1.5x war value), reparations (25 credits a point over 5 years), demilitarised systems (10 years) and released subjects. A broken demilitarisation drops relations by 25 and is a casus belli (10 years).',
        'Choose a goal in 30 days when war starts; you have 60 days to answer a peace offer.'),
    A('living-galaxy', 'Lively Galaxy', 'mechanic', 'ambitious-pirates', 'Ambitious Pirates',
        'A rich pirate faction (300,000 credits, 10 warships) may seize an independent colony as a permanent base (3 colonies at most), then defend it, run freighters for it and raid from it.',
        'Defend independents your neighbours depend on, or retake the base.'),
    A('living-galaxy', 'Lively Galaxy', 'mechanic', 'living-calendar', 'Festivals and Elections',
        'Yearly festivals (25%, +10 approval), elections (20%), coronations (Monarchy, 15%) and anniversaries every 5 years give small approval and relation effects and news between the crises.',
        'Use them: a festival is a good time to send a gift.'),
    A('living-galaxy', 'Emergent Galaxy', 'mechanic', 'internal-politics', 'Internal Politics',
        'Characters have ambition and loyalty; disloyal ones plot defections, secessions (from 6 colonies) and coups when approval falls below -5.',
        'Keep approval positive and loyal governors in the colonies that matter.'),
    A('living-galaxy', 'Independents as Actors', 'faction', 'independent-leagues', 'Independent Leagues',
        'Independent colonies raise a militia (up to 3 ships, refreshed every 90 days), build up to 2 mining stations in nearby space and, 25% of years, form leagues (radius 1 sector) that pool defence at 1.5x, share stations and send one extra colony.',
        'Leagues defend themselves; conquer them early or befriend them.'),
    A('living-galaxy', 'Defended Colonies Resist Pirates', 'mechanic', 'colony-defence', 'Colony Defence',
        'A colony with a space port or defensive base that has repulsed a raid or destroyed a pirate ship or facility in the last year gains no pirate control, and none can start there. A repulsed raid halves pirate control (to at most 25% with no facility), and the faction cannot restart a facility there for 2 years.',
        'Keep a defensive base in orbit above pirate-threatened colonies.'),
    A(STANDALONE_EXP, 'Slavery', 'mechanic', 'slavery', 'Slavery and Penal Colonies',
        'The Slavery add-on takes over the game\'s own enslavement. Its switch is the Policy screen\'s "Use Penal Colonies to implement \'Enslave\' policy"; who is enslaved is each colony\'s population policy (Enslave); the penal colonies are the empire\'s penal colony list, which the Colonies window\'s "Make / Release penal colony" edits (the game no longer picks them by itself). Labour convoys ship enslaved people from your other colonies, which lose them, and the workers die off at about 5% a year, so the convoys keep coming.',
        'Staffing (enslaved workers against a target of a quarter of the planet\'s maximum population, 50 million to 400 million) drives the reward: luxury and restricted resources are extracted at up to six times the rate, and tax at up to twice (this replaces the original slavery income bonus). A penal colony with few workers gives little.',
        'The cost: its approval falls by 10 (the enslaved race\'s other colonies by 4), and unrest grows every year it is a penal colony. Only a large garrison holds it down (40,000 troop strength plus 300,000 per billion workers, rising 10% a year to double); short of that the colony rebels, stops producing, and may break away as an independent world. Every empire that does not use penal colonies thinks less of you each year, on top of the original offence the enslaved peoples\' own empires take.',
        'AI empires choose by species and government: aggressive, unfriendly, disloyal peoples under despots, military dictators, the Way of Darkness, feudal lords, hive minds and merchant guilds lean to it; democracies and utopias never do. They make penal colonies only of luxury- and rare-rich worlds they can staff and garrison, where it pays.'),
    A('politics-characters', 'War Crimes Remembered', 'mechanic', 'war-crimes', 'War Crimes',
        'Every empire\'s war crimes are recorded: bombarding colonies, destroying planets, scorched earth, attacking refugee convoys or Diet delegates, enslaving conquered peoples and attacking independent worlds. The record fades by only 3% a year, so crimes are remembered for generations, and each one costs attitude with every empire, the victim twice as much.',
        'When the Interstellar Diet sits, members may move a War Crimes Tribunal against the worst offender (a record of 40 or more). They vote by self-interest (victims and enemies for, allies and friends against) and by their own records. A passed tribunal brings sanctions and reparations to the victims (10% of the offender\'s treasury) and, for a record of 100 or more, the trial and removal of its leader. The Diet window shows the worst record.'),
    A('living-galaxy', 'Scorched Earth', 'mechanic', 'scorched-earth', 'Scorched Earth',
        'When an enemy invasion fleet (a ship carrying troops, or one sailing with such a fleet) reaches a colony, its owner chooses: Defend, or Scorch. A scorched colony loses its people and its planet\'s base quality steadily, burning out completely in about a year and a half (scorchRuinYears); a burned-out world is left empty. The capital is never scorched.',
        'Capture stops the burning at once: the captor gets whatever is left, and a Terraforming Facility restores the planet\'s quality over time. If the attackers are beaten off (no attack for 45 days and no troops on the ground), the defender may call the burning off.',
        'The AI weighs its species (aggressive, unfriendly peoples burn more readily), its government (military dictatorships and the Way of Darkness burn; democracies, utopias and merchant guilds rarely do), the world\'s population and its odds of holding it. Scorching costs a little reputation with every empire and is remembered as a war crime.'),
];

/** Short titles the article list shows: "Void Whale (creature)". */
export function articleTitle(a: ExpansionArticle): string {
    const s = KIND_SUFFIX[a.kind];
    return s === '' ? a.title : `${a.title} (${s})`;
}

/**
 * An article's picture. HARD ART RULE: the repo never holds the original game's art. 'own' is our art (public/art/);
 * 'stock' is a file of the player's install, shown live; 'fauna' is a New Fauna body rasterised live in the palette of
 * the install's creature frames (render/creatureRig.ts); 'lantern' the lantern shoal's motes.
 */
export type ArticleImage =
    | { kind: 'own'; src: string; width: number }
    | { kind: 'stock'; src: string; width: number }
    | { kind: 'fauna'; body: string }
    | { kind: 'lantern' };

const own = (src: string, width = 260): ArticleImage => ({ kind: 'own', src, width });
const stock = (src: string, width = 96): ArticleImage => ({ kind: 'stock', src: `/assets/dwu/images/${src}`, width });
const fauna = (body: string): ArticleImage => ({ kind: 'fauna', body });
/** Resource pictures: the third column of scenarios/{rimTrade,rim-herders}/resources.txt. */
const resource = (pictureRef: number): ArticleImage => stock(`ui/resources/Resource_${pictureRef}.bmp`, 48);

/** Pictures by article id (articles without one show none). */
export const ARTICLE_IMAGES: Readonly<Record<string, ArticleImage>> = {
    'kaltor-herd': stock('units/creatures/kaltor/Kaltor_00000.png', 160),
    'void-whale': fauna('voidWhale'),
    'hunter-pack': fauna('hunter'),
    'hull-grazer': fauna('hullGrazer'),
    'storm-drifter': fauna('stormDrifter'),
    'lantern-shoal': { kind: 'lantern' },
    'nest-mother': fauna('nestMother'),
    scavenger: fauna('scavenger'),
    'brood-carrier': fauna('broodCarrier'),
    'tamed-creatures': fauna('voidWhale'),
    'ossuvan-herders': own('/art/herder/portrait.png', 200),
    'drovers-and-guides': own('/art/herder/portrait-thumb.png', 96),
    'kaltor-shell': resource(38),
    'kaltor-crystal': resource(0),
    'oranthi-concord': own('/art/concord-photo/port.png'),
    'rim-goods': resource(15),
    'oranthi-porcelain': resource(36),
    moonsilk: resource(29),
    'starleaf-tea': resource(21),
    voidbloom: own('/art/voidbloom/voidbloom.svg', 48),
    'treasure-ship': own('/art/concord-photo/treasure.png'),
    'concord-designs': own('/art/concord-photo/battleship.png'),
    'treasure-fleet': own('/art/concord-photo/treasure.png', 160),
    // Crops of our own Diet window (a motion card, the members grid), shot with a system font so no install font or
    // chrome image is in them (public/art/pedia/).
    'interstellar-diet': own('/art/pedia/diet-members.webp', 826),
    'regent-and-emperor': own('/art/pedia/diet-regent.webp', 807),
    'vip-shuttle': stock('units/ships/family0/passengership.png'),
    'council-enforcers': stock('units/ships/family0/cruiser.png'),
    'delegate-strikes': stock('units/ships/family0/passengership.png'),
    privateer: stock('units/ships/family0/escort.png'),
};
