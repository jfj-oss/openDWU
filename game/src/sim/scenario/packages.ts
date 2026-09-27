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
export {};
