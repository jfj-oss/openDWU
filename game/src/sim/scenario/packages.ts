// Scenario packages (tasks/MODLAYER-DESIGN.md §4). Each package module registers its hooks (registerScenarioYearly, ...)
// when imported; import it here so every game — app and tests — has it registered. game.ts imports this module.
// Keep the list sorted; a package's code only runs behind its scenario id / flags.
import './threats/corporateCoup';
import './threats/darkFarms';
import './threats/exchange';
import './threats/ghostArmada';
import './threats/robotMutiny';
import './threats/timeBomb';
