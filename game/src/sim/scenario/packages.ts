// Scenario packages (tasks/MODLAYER-DESIGN.md §4). Each package module registers its hooks (registerScenarioYearly, ...)
// when imported; import it here so every game — app and tests — has it registered. game.ts imports this module.
// Keep the list sorted; a package's code only runs behind its scenario id / flags.
import './charteredCompanies/charters';
import './rimFrontier/rimFrontier';
import './rimStarts';
import './independents/independents';
import './newFauna/newFauna';
import './rimFauna/rimFauna';
import './rimHerders/rimHerders';
import './rimTrade/rimTrader';
import './rimTrade/treasureFleet';
import './rimTrade/treasureRaids'; // 19a treasure fleet stragglers, AI raids and loot (flag rimTrader)
import './rimTrade/passive';
import './rimTrade/patrol'; // 19a rim patrols, construction-ship escorts, explorers (flag rimTraderPassive)
import './rimTrade/concordDesigns'; // 19a huge long-range Concord warship designs (flag rimTrader)
import './rimTrade/rareGoods'; // 19a rare goods: development 50, one effect each, ordering priority (flag rimTrader)
import './rimTrade/wealth'; // 19a Concord wealth and navy (flag rimTrader) // 19a passive posture (flag rimTraderPassive) + colony cap on every path (flag rimTrader)
import './emergent/espionage';
import './threats/darkFarms';
import './emergent/crises'; // 19d2 resource crises (flag resourceCrises)
import './emergent/politics';
import './emergent/politicsActions';
import './emergent/demographics';
import './threats/corporateCoup';
import './threats/exchange';
import './threats/ghostArmada';
import './threats/robotMutiny';
import './threats/timeBomb';
import './threats/cult';
import './threats/doppelgangers';
import './threats/greyTide';
import './threats/hive';
import './threats/archiveCores';
import './threats/generationShips';
import './threats/giantworks/framework';
import './threats/probeSwarm';
import './threats/voidWhale';
import './threats/hollowFleet';
import './threats/purifier';
import './threats/silence';
import './threats/giantworks/beacon'; // Giantworks: the Beacon wonder (registers against the contract stub until the framework lands)
import './threats/crisis'; // crisis interactions: reputation for helping or ignoring, opportunists (reads every threat's faction)
import './threats/crisisCouncil'; // crisis interactions: the council reacts (extension of emergent/council)
import './lively/livelyGalaxy';
import './rimDistressCalls'; // 19i item 10 ticker half (rimAtmosphere flag)
import './emergent/council'; // 19d8 galactic council (flag galacticCouncil)
import './wreckage/wreckage'; // 19e-7 battle wreckage & salvage (flag wreckage)
import './lively/peaceTerms';
import './lively/warGoals';
import './llm/memory';
import './lively/pirateAmbition';
import './lively/livingCalendar';
import './reputation/ledger'; // 19o reputation & grievances ledger (flag reputationLedger; fills the attitude channel)
import './eventLog/log'; // 19p event log (flag eventLog; installs the ported-message tap)
import './security/security'; // 19m internal security (flag internalSecurity; it fills the 19d1 / 19d4 hook slots)
import './court/court'; // 19n court & dynasties (flag courtDynasties; after 19m: it fills 19d1 / 19m hook slots)
import './court/intrigue'; // 19n package 2 court intrigue (flag courtIntrigue; fills the espionage / 19m / proposal slots)
import './security/security'; // 19m internal security (flag internalSecurity; last: it fills the 19d1 / 19d4 hook slots)
import './frontier/frontier'; // 19g-5 frontier autonomy (flag frontierAutonomy; after 19n / 19m: ledger terms, leads)
import './smarterAI/research'; // Smarter AI optimised research order (flags smarterAI + smarterAIResearch; AI empires only)
import './smarterAI/taxes'; // Smarter AI growth taxes (flags smarterAI + smarterAIGrowthTax; AI empires only)
import './smarterAI/colonies'; // Smarter AI colony picks (flags smarterAI + smarterAIColonies; AI empires only)
import './smarterAI/independents'; // Smarter AI absorb independents (flags smarterAI + smarterAIIndependents; AI empires only)
import './smarterAI/budget'; // Smarter AI cut costs when broke (flags smarterAI + smarterAIBudget; AI empires only)
import './smarterAI/retrofit'; // Smarter AI keep fleets up to date (flags smarterAI + smarterAIRetrofit; AI empires only)
import './smarterAI/defence'; // Smarter AI defence that counts pirates (flags smarterAI + smarterAIDefence; AI empires only)
import './smarterAI/pirates'; // Smarter AI pirate clean-up (flags smarterAI + smarterAIPirates; AI empires only)
import './smarterAI/researchStations'; // Smarter AI research stations (flag smarterAIResearchStations)
import './smarterAI/wonders'; // Smarter AI wonders (flag smarterAIWonders; after research: prepends to its research order)
import './smarterAI/espionage'; // Smarter AI espionage (flag smarterAIEspionage)
import './smarterAI/diplomacy'; // Smarter AI diplomacy (flag smarterAIDiplomacy)
import './smarterAI/opening'; // Smarter AI pre-warp opening (flag smarterAIOpening; after diplomacy / taxes: its protection and tax handlers run last)
import './smarterAI/shipDesign'; // Smarter AI ship design (flags smarterAIDesignTune / WeaponFocus / DesignScale / DesignTrim; AI empires only)
import './privateers/privateers'; // Private-sector privateers (flag privateers; player + AI empires' private sectors; no Rnd)
import './themedNames/themedNames'; // Themed names for AI empires (flag themedNames; AI empires only; no Rnd)
import './colonyDefence/colonyDefence'; // Defended colonies resist pirates (flag colonyDefence; every empire's colonies; no Rnd)
import './bountyHunters/bountyHunters'; // Bounty hunters (flag bountyHunters; a pooled bounty on a pariah, a mercenary pirate faction hunts it; no Rnd beyond the faction's creation)
import './charactersVictory/diet/warCrimes'; // War crimes remembered (flag warCrimes; records, reputation, the Diet's tribunal; no Rnd)
import './scorchedEarth/scorchedEarth'; // Scorched earth (flag scorchedEarth; the defender's Defend / Scorch choice; no Rnd)
import './charactersVictory/vip'; // Characters & Victory VIP shuttles, escorts, decoys (flag charactersVictory + cvVipShuttles / cvEscorts / cvRulerDecoys)
import './charactersVictory/governorsCv'; // Characters & Victory governors on every colony (flag charactersVictory + cvGovernors; vacancy term in the stability ledger)
import './charactersVictory/diet/diet'; // Characters & Victory part 2: the Interstellar Diet (flag charactersVictory + cvCouncil; extends emergent/council through registerCouncilExtension)
import './colonyEconomy/index'; // Colony Economy: designations, private facilities, bonds (flag colonyEconomy; docs/ECONOMY.md)
import './coordinatedLandings/coordinatedLandings'; // Coordinated landings (flag coordinatedLandings; invading transports land together; no Rnd)
import './fightingRetreats/fightingRetreats'; // Fighting retreats (flag fightingRetreats; losing fleets withdraw to repair; no Rnd)
import './voidbloom/index'; // The Voidbloom War (flag voidbloom; Rim expansion, requires rimTrade; docs/VOIDBLOOM_WAR.md)
import './orbital/orbitalAI'; // Orbital superiority (flag orbitalSuperiority; invasion orbit states in orbital/orbitalSuperiority.ts, AI here)
import './blockades/blockadesBite'; // Blockades that bite (flag blockadesBite; reuses the orbital measure and relief search)
import './hyperdrive/slowHyperdrive'; // Slower hyperdrive spool (flag slowHyperdrive; every ship's jump spool × hyperjumpSpoolFactor)
import './interdiction/jumpInterdiction'; // Defensive jump interdiction (flag jumpInterdiction; armed bases lengthen hostile ships' jump spool)
import './mothballing/mothballing'; // Mothballing: fleets / warships in reserve at a space port (flags mothballing + mothballingAI; a Gameplay change)
import './veterans/veterans'; // Veterans (flag veterans): ship / troop battle experience and ranks
export {};
