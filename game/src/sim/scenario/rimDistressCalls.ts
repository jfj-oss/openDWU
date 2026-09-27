// 19i "Rim atmosphere" item 10 (ticker half) — rare garbled distress-call ticker lines from rim outposts. A
// scenario-owned periodic tick (registerScenarioPeriodic, hooks.ts), gated on the rimAtmosphere flag: every
// RIM_DISTRESS_PERIOD_DAYS, each independent-empire colony past the scenario's rimInner has a small chance of one
// flavour ticker line to the player (scenarios/rim-atmosphere/GameText.txt's "Rim Distress Call *" keys).
//
// Rim test: radiusFraction (hooks.ts) — the same simple distance-from-centre-over-sizeX/2 fraction
// scenarioHomeRing/scenarioResourceAllowed already use for generation-time placement rules. Not the render layer's
// percentile-based curve (rimGeometry/rimFraction/rimWeight, src/render/rimAtmosphereLayer.ts): that module imports
// pixi.js, and src/sim must stay DOM/Pixi-free (game/CLAUDE.md; see rimShared.ts). A rare ticker flourish does not
// need pixel-identical curves with the visuals, only "clearly past the rim" — a coarser independent approximation.
//
// May draw galaxy.rnd (hooks.ts's stated policy: "scenario code draws from galaxy.rnd only inside its own hooks");
// with the flag off, or this scenario not chosen, the handler's gate never opens (scenarioGateOpen), so nothing is
// drawn and no pin/digest moves for any other game.

import type { Galaxy } from '../galaxy';
import type { Habitat } from '../types';
import { radiusFraction, registerScenarioPeriodic } from './hooks';
import { scenarioMessage, scenarioText } from './messages';
import { RIM_FLAG_NAME } from './rimShared';
import { scenarioParam } from './state';

/** scenarios/rim-atmosphere/GameText.txt keys (garbled, half-heard flavour lines; {0} = the outpost's name). */
export const RIM_DISTRESS_CALL_KEYS: readonly string[] = ['Rim Distress Call 1', 'Rim Distress Call 2', 'Rim Distress Call 3', 'Rim Distress Call 4'];

/** How often the check runs (a game day = YEAR_LENGTH / 360, hooks.ts GAME_DAY_LENGTH): the scenario's
 *  distressCallRate param is the per-check chance at the rim's outer edge, so this period sets how "rare" reads in
 *  wall-clock terms at 1x more than the rate itself does. */
export const RIM_DISTRESS_PERIOD_DAYS = 6;

/**
 * Pure: the chance of a distress call at this check for an outpost at `fraction` (radiusFraction) of the galaxy
 * radius, given `rimInner` and the scenario's `distressCallRate` (the rate once fully past the rim band — same
 * (1 − rimInner)/2, clamped 0.04–0.3, band shape the render layer's rimBand uses, so the ramp-in reads the same even
 * though the two curves are computed independently). 0 at or inside rimInner, `distressCallRate` at 1.0 fraction.
 */
export function rimDistressCallChance(fraction: number, rimInner: number, distressCallRate: number): number {
    if (!(fraction > rimInner)) return 0;
    const band = Math.min(0.3, Math.max(0.04, (1 - rimInner) * 0.5));
    const t = Math.min(1, (fraction - rimInner) / band);
    return Math.max(0, Math.min(1, t * distressCallRate));
}

function rimOutposts(galaxy: Galaxy): Habitat[] {
    const ind = galaxy.independentEmpire;
    return ind === null ? [] : ind.colonies.filter((h): h is Habitat => h != null);
}

registerScenarioPeriodic({
    id: 'rimAtmosphere.distressCalls',
    flag: RIM_FLAG_NAME,
    periodDays: RIM_DISTRESS_PERIOD_DAYS,
    run(galaxy: Galaxy): void {
        const player = galaxy.playerEmpire;
        if (player === null || !player.active) return;
        const rimInner = scenarioParam(galaxy, 'rimInner', 0.72);
        const rate = scenarioParam(galaxy, 'distressCallRate', 0.05);
        if (rate <= 0) return;
        for (const h of rimOutposts(galaxy)) {
            const chance = rimDistressCallChance(radiusFraction(galaxy, h.xpos, h.ypos), rimInner, rate);
            if (chance <= 0 || !(galaxy.rnd.nextDouble() < chance)) continue;
            const key = RIM_DISTRESS_CALL_KEYS[galaxy.rnd.next(0, RIM_DISTRESS_CALL_KEYS.length)];
            scenarioMessage(galaxy, player, scenarioText('Rim Distress Call Title'), scenarioText(key, h.name), { subject: h });
            break; // one line per check — "rare", not a flood
        }
    },
});
