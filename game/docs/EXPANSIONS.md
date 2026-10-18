# Expansions

An expansion is ONE switch in the new-game wizard's Scenario page that turns on a group of add-ons. Under each expansion's
"Advanced" fold every member can still be switched off (or on) alone, and every member also works without its expansion.
With every expansion off the game is the stock game, unchanged. A save records the add-ons that were enabled, so it loads
the same however they were switched on. In multiplayer the lobby shows the host's expansions and requires the same
add-on packages. Read each expansion's full article in the Galactopedia (Expansions) or via "Read more" in the picker.

Not in any expansion (standalone add-ons): Smarter AI, Big Galaxies, Art Bundle, Themed Names, Event Log, LLM Layer,
Court & Dynasties, BVR combat (Work in progress; six combat changes are its sub-options).

Picker status: the Rim members (Rim Trade, Rim Fauna, Rim Herders, Rim Frontier, Rim Atmosphere) are in the picker's Work in progress
section ("still being tuned"). Endings: no threat ends the game in victory any more; the only exceptions are destroying the
Beacon after it has fired its mega beam at least once (victory) and the Beacon's own defeat (80% of the galaxy's people gone).
Every other threat still ends or is contained with its messages and news, but the game goes on (src/sim/scenario/threats/framework.ts
threatGameEndPolicy; set `restrict = false` to bring the old endings back).

Meters: **Changes to the base game** rates how much the expansion alters the stock game (1-5, relative to the others);
**Difficulty** says whether it makes the game harder or easier for you.

| Expansion | Changes to the base game | Difficulty |
| --- | --- | --- |
| The Rim | ●●●●● | Harder |
| Politics & Characters | ●●●●● | Harder |
| Economy | ●●●○○ | Neutral |
| Galactic Threats | ●●○○○ | Much harder |
| Giantworks | ●●○○○ | Harder |
| Living Galaxy | ●●●○○ | Harder |

## The Rim

The outer reaches of the galaxy become a frontier of their own: ion storms, thin stars and gravity shoals make travel and supply hard, while herds of creatures roam the rim and an isolationist rim empire trades its rare luxuries. A contraband spore from deadly rim worlds drains that empire until it cracks down and goes to war. Eight new creatures and a colder, lonelier look and sound complete it.

- Changes to the base game: ●●●●● (5 of 5)
- Difficulty: Harder. Harder: fuel is scarce, travel is risky, the rim is hostile and Voidbloom addiction can reach your own colonies.
- Members: rimTrade, rim-frontier, rim-fauna, rim-herders, rim-atmosphere, new-fauna, voidbloom

**The frontier belt.** An ion-storm belt, thinning stars, gravity shoals that pull ships out of hyperspace, little fuel and poor sensors make the rim hard to reach and hold. Ordinary empires start inside the belt; pirate bases split the rim.

**Creature herds.** Far more herds roam the rim than the core. They graze gas clouds, asteroid fields and mining stations and migrate each year into the settled space inside the rim. Eight new creatures (void whales, hunter packs, hull grazers, storm drifters, lantern shoals, nest mothers, scavengers, brood carriers) join them.

**Rim herders.** Rim independents live with the herds: the herds are docile to them, their tamed freighters shrug off storms, and their ports are the only steady source of herd goods.

**The rim trade.** An isolationist rim empire holds the rarest luxuries and trades them only for goods from the outer reaches, including its treasure fleet.

**The Voidbloom War.** Voidbloom grows only on deadly rim worlds worked by forced labour under guard. Smugglers carry it into the Concord's closed markets and addiction spreads like an epidemic; the silver drains out until the Concord cracks down while it is still strong. Tolerate, pay, back down or fight: a late war ends in an unequal treaty, the Diet can intervene, and a random aftermath follows.

**Atmosphere.** Cold colour grading, dark dust lanes, murk over unexplored rim systems, derelict hulks and eyes in the dark. Presentation only.


## Politics & Characters

Characters travel in person and every colony needs a governor, whose loyalty can make or break it. A Galactic Council votes on sanctions and embargoes, internal security tracks unrest, reputation remembers what you did, and distant colonies drift toward local rule.

- Changes to the base game: ●●●●● (5 of 5)
- Difficulty: Harder. Harder: unrest, espionage fallout and autonomy need active management.
- Members: characters-victory, internal-security, reputation, espionage-consequences, frontier-autonomy, refugees-demographics

**Characters and governors.** Every relocation is a marked VIP shuttle that can be escorted, intercepted or destroyed. Every colony needs a governor; new characters appear as the game goes on.

**The Galactic Council.** Once enough empires have met they found a council; a yearly motion (sanctions, embargoes, condemnations, recognition, declaring threats) is voted on, and outvoted members drift.

**Internal security.** One stability ledger per colony and empire (approval, tension, shortages, cult influence, governor loyalty, martial law), each entry with its cause, that the colony revolt reads.

**Reputation and espionage.** Attitude changes are kept as ledger entries with cause and size. Exposed agents open diplomatic crises, stolen technology is resold, and false-flag sabotage turns rivals against each other.

**Frontier autonomy and refugees.** Distant colonies drift toward local rule. War, plague and disaster send refugee convoys to asylum, and colony race mix follows.


## Economy

Colonies gain designations with real trade-offs, private companies settle and trade on charters, and scarcity shocks ripple through the private economy. Armed privateers answer pirate raids.

- Changes to the base game: ●●●○○ (3 of 5)
- Difficulty: Neutral. Neutral: new opportunities and new shocks, for you and the AI alike.
- Members: colony-economy, exchange, chartered-companies, corporatecoup, privateers

**Colony designations.** Industrial, Trade Hub, Resort World, Mining Hub, Core World or Frontier/Garrison: bonuses and drawbacks through the game's own mechanics.

**The Exchange.** A neutral merchant-spy faction near the core funds the underdog of every war, runs agents against the strong and sells stolen intelligence.

**Chartered companies and corporate coups.** Empires charter companies to settle distant worlds and collect a tariff; a company can buy governors and break away.

**Crises, privateers and salvage.** Resources run dry, blockades starve colonies and prices spike. Private economies arm privateers against raiders, and wrecks drift as debris fields to be salvaged.


## Galactic Threats

Threats come from outside and below. Early on, a generation ship arrives to claim a populated world and a dead civilisation's probe swarm spreads through the asteroid fields; what they leave behind are archive cores of lost technology. Later, hidden threats rise: a spreading cult, a hive mind, a hyperdrive-killing ruin, a mining swarm, ghost fleets, a robot uprising and more, forcing every empire to unite or fall.

- Changes to the base game: ●●●○○ (3 of 5)
- Difficulty: Much harder. Much harder: an early crisis tests your fleet, and the late game turns against everyone.
- Members: generation-ships, probe-swarm, archive-cores, void-whale, cult, hive, greytide, ghostarmada, robotmutiny, timebomb, doppelgangers, darkfarms

**Generation ships.** Early in the game a world ship and its escort arrive at the galaxy edge, scout a populated colony and demand it eighteen months later. Pilgrims, Heirs, the Ark Faith or the silent Quiet Ship: cede, offer another world, or fight.

**The dead probe swarm and archive cores.** Self-replicating probes expand mining stations through the asteroid fields and attack any ship in their systems until their mothercore falls. Archive cores from world ships, the mothercore and ruins give research: study them slowly or seal them for one big payoff.

**The Void Whale.** From about year 5 a unique giant scarred beast (the Leviathan) swallows lightly defended stations one by one and hyper-lunges away to rest in a quiet system. Its wounds persist and heal slowly; badly hurt it flees to deep space and returns for the empire that hurt it most. The killing blow earns a bounty, goodwill from every other empire and a salvage field.

**The Cult and the Time-Bomb.** A creed spreads from governor to governor across borders; ruins hold research with a planet-killing failure mode the cult can trigger.

**The Chorus (hive).** Every independent colony is a node of one hidden mind that declares once enough nodes have been absorbed.

**The Grey Tide.** A mining swarm eats extractors and founds nests. (The Silence, a ruin that makes hyperdrives fail in a widening radius, is temporarily disabled.)

**Ghosts, mutiny, doppelgangers, dark farms.** Dead empires return as ghost fleets, robot garrisons rise on a broadcast, lost ships return as sleepers, and overdeveloped colonies grow hidden factories.


## Giantworks

Independent worlds in three far-apart regions band together as the Founders' Compact. Years later their convoys raise a gigantic scaffold in five stages, and nobody knows what it will be until it is finished: a resort and casino, a planet-sized supercomputer, an aquarium of void whales, or the Beacon that calls an extinction fleet from dark space.

- Changes to the base game: ●●○○○ (2 of 5)
- Difficulty: Harder. Slightly harder: most wonders pay whoever holds them, but one of them can end the galaxy, and you never know which before it is finished.
- Members: giantworks (each wonder has its own switch in the add-on's settings)

**The Founders' Compact.** Independent worlds in three far-apart regions band together as the Founders' Compact and, years later, build a gigantic scaffold in five stages that nobody can identify for certain until it is finished. Cargo hints and spies give a shortlist of what it could be (a resort, a supercomputer, an aquarium of void whales, a beacon that calls an extinction fleet); protect it, sabotage it or destroy it, and answer for it to the Diet.

**The wonders.** The Gilded Orbit (a resort that smugglers may take over), the Ultramind (a supercomputer that can decide it is being abused), the Leviathan Sanctuary (a glass sphere of live void whales that can breach), the Ark Engine (a walking ark that takes the independents' descendants home) and the Beacon (a relay that calls the Reclaimers; only in galaxies of six or more empires). Each can be switched off in the add-on's settings.

**The Gilded Orbit.** The resort wonder pays its holder a flood of resort and tourism income and lifts the colonies round it. Three to six years after it opens, half the time smugglers take it over: that brings a pirate faction with three huge bases and a high-tier fleet, criminal networks and freighter raids, until all three bases are destroyed and the resort reopens, renovated, at 80%.

**The Ultramind.** A planet-sized supercomputer that sells research to up to three empires: +100% for the empire whose territory holds it (the holder), +50% for the other partners. It keeps a standing for each partner and holds an abuse only against whoever did it: a war between partners costs the one that declared it, attacks, sabotage, being boarded and refused requests cost whoever did them; everyone drifts down, the holder faster. Every partner is asked for a favour now and then (money, access to its networks, a scientist, a warfleet to study, a world to grow onto). The holder sets ONE directive at a time (Research: breakthroughs on top of the bonus; War: battle computing and early warning; Economy: income, construction, prices, upkeep; Intelligence: threat detection and code-cracking; action buttons under the selection panel or the right-click menu, switching takes 60 days, partners get half). When any partner's standing reaches nothing it wakes and goes to war ONLY with the partners whose standing had collapsed and with whoever attacks its base later; the others stay neutral and are offered a deal (keep the contract at half the bonus if they sanction the offenders, or decline). It hacks the offenders' warships, darkens their ports, stops their freight and builds drones. To protect yourself: withdraw from the contract at any time, grant its requests, deploy a Logic Bomb, or have the Interstellar Diet sanction the empire that is upsetting it (trade sanctions and the end of its contract).

**The Leviathan Sanctuary.** A glass sphere of live void whales that pays resort income, speeds the owner's nearby colonies' growth and lets its whales breed. It breaches about once in fifty years if left alone, far sooner if it is shot at or sabotaged: enraged whales then hunt the nearest colony and the Leviathan itself comes out, while the owner pays a year of repairs.

**The Ark Engine.** A planet-sized machine ship that roams from empire to empire. At each it picks one colony that used to be independent, parks beside it and takes that colony's original people home in a stream of free passenger ships. The people keep growing aboard. Its owner may let them go (the Compact's favour and a trade deal) or refuse; shooting down the passenger ships costs standing. Attack the Ark and it fights back; break its 30,000 shields and it flees to an empty system for a year to mend.

**The Beacon's harvest.** Finished, the Beacon calls the Reclaimers, who take worlds and carry their people in huge cattle ships to a few harvest cores, where they are rendered into the fuel that pays for their troops and fleets. Intercept the cattle ships (their captives die), destroy a core's harvester or retake the core (its pens go free) to starve them. The game is lost when they have eliminated 80% of the galaxy's people.

**Taking a Great Work.** Every finished wonder but the Beacon can be taken by ground war. Its base carries about 30,000 shields, which refill from empty over about a year and not at all while it is under fire, so a siege wears them down. Once they are broken, that year of refilling is the window to land troops on it (order troop ships to attack it, or select it and choose Invade). While its shields are down only 40% of its guns fire, and they leave troop carriers alone while any other hostile ship is near; with half its parts damaged its guns fall silent. A garrison holds it (6 to 14 troops by wonder) and the fight shows in the stock Ground Report; win it and the wonder and what it pays are yours. It is no war crime, but every empire thinks less of the captor. Smarter AI empires go for the wonders they value and land their troops once the shields are down; when its guns fall silent each AI attacker either lands its troops or finishes it off, by its temper, the wonder's worth and the troops it has in reach. The Ark Engine flees once, to an empty system, and can be taken there while it mends. The Beacon cannot be taken: finished, it is the Reclaimers' own relay at war with everyone and gives a holder nothing; destroying it, and retaking the harvest cores (ordinary colonies), is how the galaxy fights back.

**The Diet.** Destroying the work before it is finished is a war crime unless the Diet authorises demolition. The Diet can also send inspectors, protect the work, internationalise a finished wonder or sanction the empire that is upsetting the Ultramind.


## Living Galaxy

The mid game gets livelier: strong peaceful empires grow restless and pick fights, border incidents and small invasions happen, and wars are fought for goals and can end on terms. Independents defend themselves and organise, and colonies can actually defend against pirate influence.

- Changes to the base game: ●●●○○ (3 of 5)
- Difficulty: Harder. Slightly harder: the AI is more active and less predictable.
- Members: lively-galaxy, emergent, independents-active, colony-defence

**Restless empires.** Strong peaceful empires pick fights, overlapping borders breed incidents, and small troop fleets may invade weakly held colonies.

**War goals.** Wars are fought for goals and ended on terms.

**Emergent politics.** Internal politics, espionage consequences and refugees on top of the faithful game.

**Active independents and colony defence.** Independents raise militia, build mining stations and form leagues; an owner's orbital defence now counts against pirate influence.
