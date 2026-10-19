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
import { TROOP_FORK_ART } from './beaconForkTroopArtData';
import { EXPLORER_FORK_ART } from './beaconForkExplorerArtData';

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
    'troop-fork': TROOP_FORK_ART,
    'explorer-fork': EXPLORER_FORK_ART,
};

/** The Reclaimer frames (beaconFileForSubRole's) the fork look replaces, and with what. The escort takes the frigate's
 * spear (the two Mass Effect frames are drawn about the same length); the troop transports and passenger ships (the
 * frames' 'trooptransport') the troop ship; the exploration ships, though they share the escort's frame, the explorer
 * (threatArt.ts beaconArtFile). */
export const FORK_REPLACES: Readonly<Record<string, string>> = {
    capitalship: 'capitalship-fork',
    frigate: 'frigate-fork',
    escort: 'frigate-fork',
    destroyer: 'destroyer-fork',
    cruiser: 'cruiser-fork',
    carrier: 'carrier-fork',
    trooptransport: 'troop-fork',
};

/** The one Mass Effect frame the fork look still draws (the construction ship's: construction ships, freighters,
 * miners, resupply and colony ships other than the cattle ships) gets the fleet's plumes only: two engine bands at its
 * hips (frame px of construction.png; no lights). */
export const FORK_PLUMES_ONLY: Readonly<Record<string, ForkArt>> = {
    construction: {
        size: 432,
        breath: 5.6,
        glow: { x: 0, y: 0, w: 0, h: 0, dx: 0, dy: 0 },
        capitalLength: 1,
        nozzles: [
            { x: 188.0, y: 297.0, w: 22.0 },
            { x: 242.0, y: 297.0, w: 22.0 },
        ],
        lights: [],
    },
};

/** A fork-look frame's data (null: not one). */
export function forkFleetArt(file: string): ForkFleetArt | null {
    return Object.hasOwn(FORK_FLEET, file) ? FORK_FLEET[file] : null;
}

/** The plumes (and lights) of a frame the fork look draws: a fork-look frame's, or a plumes-only frame's (null: none). */
export function forkPlumeArt(file: string): ForkArt | null {
    return forkFleetArt(file) ?? (Object.hasOwn(FORK_PLUMES_ONLY, file) ? FORK_PLUMES_ONLY[file] : null);
}
