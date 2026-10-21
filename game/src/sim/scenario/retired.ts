// Retired / disabled add-on state, cleaned when a save loads (gameSave.ts deserializeGame). Not a port.
//   - Wreckage & Salvage (scenarios/wreckage-salvage) is retired, and Surrender (scenarios/surrender-wrecks) no longer leaves wrecks:
//     a save that has either one's debris fields, wreck records or salvage missions loses them (salvagers are released to idle).
//   - The Silence (scenarios/silence) is temporarily disabled: a save with it active or pending loses its zone and state quietly.
//   - Emergent Galaxy (scenarios/emergent: loyalty, ambition, plots, coups) is off while it is reworked (user 2026-10-21: remove it
//     from saves too): a save with it on loads with its flag off, its politics state gone and any pending plot decision withdrawn.
//     What it already did (defections, coups, secessions) stays as history.
// Both add-ons stay in the scenario index as hidden packages, so old saves still resolve their include lists.
// No Rnd; a no-op on a game without a scenario or without that state.

import type { Galaxy } from '../galaxy';
import { purgeWreckageState } from './wreckage/wreckage';
import { purgeSilence } from './threats/silence';
import { withdrawScenarioDecisions } from './decisions';

export function migrateRetiredAddonState(galaxy: Galaxy): void {
    const s = galaxy.scenario;
    if (s === null) return;
    if ('wreckage' in s.state || s.flags['wreckage'] === true || s.flags['surrenderWrecks'] === true) purgeWreckageState(galaxy);
    if ('silence' in s.state || s.flags['silence'] === true) purgeSilence(galaxy);
    if ('politics' in s.state || s.flags['internalPolitics'] === true) purgeEmergentPolitics(galaxy);
}

/** Emergent Galaxy off in a loaded save: the flag, its state (scenarioState 'politics') and its pending plot decisions. */
export function purgeEmergentPolitics(galaxy: Galaxy): void {
    const s = galaxy.scenario;
    if (s === null) return;
    withdrawScenarioDecisions(galaxy, 'politics.plot', () => true); // emergent/politics.ts PLOT_DECISION
    delete s.state['politics'];
    s.flags['internalPolitics'] = false;
}
