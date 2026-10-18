// The fork look's Reclaimer fleet (Giantworks add-on, the Beacon; render only): every fork-look frame's data by its file
// (the art builds under ~/data/agent-tmp/watcher-fork/work: build_fork.py, build_capital.py, build_frigate.py, ships.py).
// threatArt.ts picks the files and draws them at their drawScale (each keeps the drawn length of the Mass Effect frame it
// replaces; the Watcher is sized against the capital design instead), beaconFx.ts / beaconForkFx.ts draw their engine
// bands and blinking navigation lights from it.

import type { ForkArt } from './beaconForkArtData';
import { CAPITAL_FORK_ART } from './beaconForkCapitalArtData';
import { FRIGATE_FORK_ART } from './beaconForkFrigateArtData';
import { DESTROYER_FORK_ART } from './beaconForkDestroyerArtData';
import { CRUISER_FORK_ART } from './beaconForkCruiserArtData';
import { CARRIER_FORK_ART } from './beaconForkCarrierArtData';
import { CATTLE_FORK_ART } from './beaconForkCattleArtData';
import { HARVESTER_FORK_ART } from './beaconForkHarvesterArtData';

export type ForkFleetArt = ForkArt & { readonly drawScale: number };

/** The fork-look frames other than the Watcher's, by file. */
export const FORK_FLEET: Readonly<Record<string, ForkFleetArt>> = {
    'capitalship-fork': CAPITAL_FORK_ART,
    'frigate-fork': FRIGATE_FORK_ART,
    'destroyer-fork': DESTROYER_FORK_ART,
    'cruiser-fork': CRUISER_FORK_ART,
    'carrier-fork': CARRIER_FORK_ART,
    'cattle-fork': CATTLE_FORK_ART,
    'harvester-fork': HARVESTER_FORK_ART,
};

/** The Reclaimer frames (beaconFileForSubRole's) the fork look replaces, and with what. The escort takes the frigate's
 * spear (the two Mass Effect frames are drawn about the same length). */
export const FORK_REPLACES: Readonly<Record<string, string>> = {
    capitalship: 'capitalship-fork',
    frigate: 'frigate-fork',
    escort: 'frigate-fork',
    destroyer: 'destroyer-fork',
    cruiser: 'cruiser-fork',
    carrier: 'carrier-fork',
};

/** A fork-look frame's data (null: not one). */
export function forkFleetArt(file: string): ForkFleetArt | null {
    return Object.hasOwn(FORK_FLEET, file) ? FORK_FLEET[file] : null;
}
