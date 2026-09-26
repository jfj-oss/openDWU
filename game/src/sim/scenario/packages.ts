// Scenario packages (tasks/MODLAYER-DESIGN.md §4). Each package module registers its hooks (registerScenarioYearly, ...)
// when imported; import it here so every game — app and tests — has it registered. game.ts imports this module.
// Keep the list sorted; a package's code only runs behind its scenario id / flags.
import './charteredCompanies/charters';
import './rimTrade/rimTrader';
import './emergent/espionage';
export {};
