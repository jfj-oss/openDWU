// Scenario packages (tasks/MODLAYER-DESIGN.md §4). Each package module registers its hooks (registerScenarioYearly, ...)
// when imported; import it here so every game — app and tests — has it registered. game.ts imports this module.
// Keep the list sorted; a package's code only runs behind its scenario id / flags.
import './charteredCompanies/charters';
import './rimFrontier/rimFrontier';
import './independents/independents';
import './newFauna/newFauna';
import './rimFauna/rimFauna';
import './rimHerders/rimHerders';
import './rimTrade/rimTrader';
import './rimTrade/treasureFleet';
import './rimTrade/passive';
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
import './threats/silence';
import './lively/livelyGalaxy';
import './rimDistressCalls'; // 19i item 10 ticker half (rimAtmosphere flag)
import './emergent/council'; // 19d8 galactic council (flag galacticCouncil)
import './wreckage/wreckage'; // 19e-7 battle wreckage & salvage (flag wreckage)
import './lively/peaceTerms';
import './lively/warGoals';
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
import './smarterAI/budget'; // Smarter AI cut costs when broke (flags smarterAI + smarterAIBudget; AI empires only)
import './smarterAI/retrofit'; // Smarter AI keep fleets up to date (flags smarterAI + smarterAIRetrofit; AI empires only)
import './smarterAI/defence'; // Smarter AI defence that counts pirates (flags smarterAI + smarterAIDefence; AI empires only)
import './smarterAI/pirates'; // Smarter AI pirate clean-up (flags smarterAI + smarterAIPirates; AI empires only)
export {};
