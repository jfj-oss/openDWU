// [improvements] Automatic design upgrades (same tech line) — the UI half. The rules live in the sim
// (sim/player/designLineUpgrade.ts); the Improvement switch (ui/improvements.ts 'designLineUpgrade', default on) reaches
// the sim only as the journaled player command `setDesignLineUpgrade`, issued when the game view starts (new game or
// load) and whenever the switch is toggled. A game run without the game view (tests, harness, seed runs) never gets
// the command, so it plays exactly as the original.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Design } from '../sim/design';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { DESIGN_LINE_UPGRADE_IMPROVEMENT, playerOwnsDesignSubRole } from '../sim/player/designLineUpgrade';
import { isImprovementEnabled, onImprovementsChange } from './improvements';

let uninstall: (() => void) | null = null;

/** Send the current switch to the sim now and on every toggle, until removeDesignLineUpgradeSync. */
export function installDesignLineUpgradeSync(galaxy: Galaxy, player: Empire): void {
    removeDesignLineUpgradeSync();
    issuePlayerCommand(galaxy, player, 'setDesignLineUpgrade', [isImprovementEnabled(DESIGN_LINE_UPGRADE_IMPROVEMENT)]);
    const off = onImprovementsChange((id, on) => {
        if (id === DESIGN_LINE_UPGRADE_IMPROVEMENT) issuePlayerCommand(galaxy, player, 'setDesignLineUpgrade', [on]);
    });
    uninstall = off;
}

export function removeDesignLineUpgradeSync(): void {
    uninstall?.();
    uninstall = null;
}

/** The Designs screen's hint for a design of a player-owned design type (null when none applies). */
export function designLineUpgradeHint(empire: Empire, design: Design): string | null {
    if (!isImprovementEnabled(DESIGN_LINE_UPGRADE_IMPROVEMENT) || !playerOwnsDesignSubRole(empire, design.subRole)) return null;
    return 'Your design type: auto-design only upgrades components';
}
