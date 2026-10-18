// Retired / disabled add-on state, cleaned when a save loads (gameSave.ts deserializeGame). Not a port.
//   - Wreckage & Salvage (scenarios/wreckage-salvage) is retired, and Surrender (scenarios/surrender-wrecks) no longer leaves wrecks:
//     a save that has either one's debris fields, wreck records or salvage missions loses them (salvagers are released to idle).
//   - The Silence (scenarios/silence) is temporarily disabled: a save with it active or pending loses its zone and state quietly.
// Both add-ons stay in the scenario index as hidden packages, so old saves still resolve their include lists.
// No Rnd; a no-op on a game without a scenario or without that state.

import type { Galaxy } from '../galaxy';
import { purgeWreckageState } from './wreckage/wreckage';
import { purgeSilence } from './threats/silence';

export function migrateRetiredAddonState(galaxy: Galaxy): void {
    const s = galaxy.scenario;
    if (s === null) return;
    if ('wreckage' in s.state || s.flags['wreckage'] === true || s.flags['surrenderWrecks'] === true) purgeWreckageState(galaxy);
    if ('silence' in s.state || s.flags['silence'] === true) purgeSilence(galaxy);
}
