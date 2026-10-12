// Keeps ordinary start empires (the player and the placed AI empires) out of the rim band whenever any member of The
// Rim expansion that defines the rim is on (rimTrade, rim-frontier, rim-fauna, rim-herders, rim-atmosphere). The rim
// band is the sim-side equivalent of src/render/rimCurve.ts's rimInner (scenarioParam 'rimInner', default 0.72;
// src/sim must not import render code). Hooks acceptHomeHabitat (game.ts player loop / findAiCapital). Pirates and the
// independents never reach that query; the rim-living races (the Oranthi Concord, the Ossuvan herders) are exempt.
// Fallback: after RIM_START_REJECT_CAP rejections per empire kind the rule stands down (the player loop and the AI retry pick the least-rim candidate first, game.ts), so game creation never stalls
// when the galaxy has no suitable non-rim habitat.

import { radiusFraction, registerScenarioQuery } from './hooks';
import { scenarioParam, scenarioState } from './state';
import type { Galaxy } from '../galaxy';

const RIM_START_FLAGS = ['rimTrader', 'rimFrontier', 'rimFauna', 'rimHerders', 'rimAtmosphere'] as const;
const RIM_LIVING_RACES: ReadonlySet<string> = new Set(['Oranthi', 'Ossuvan']);
export const RIM_START_REJECT_CAP = 600;
const REJECT_KEY = 'rimStarts.rejected';

/** Sim-side rim boundary (fraction of the galaxy radius), matching the render curve's rimInner default. */
export function rimInnerFraction(galaxy: Galaxy): number {
    return Math.min(0.98, Math.max(0, scenarioParam(galaxy, 'rimInner', 0.72)));
}

for (const flag of RIM_START_FLAGS) {
    registerScenarioQuery({
        id: `rimStarts.${flag}`,
        flag,
        query: 'acceptHomeHabitat',
        run: (galaxy, value, a) => {
            if (!value || RIM_LIVING_RACES.has(a.race.name)) return value;
            if (radiusFraction(galaxy, a.habitat.xpos, a.habitat.ypos) < rimInnerFraction(galaxy)) return value;
            const n = scenarioState(galaxy, `${REJECT_KEY}.${a.empireKind}`, () => ({ n: 0 }));
            if (n.n >= RIM_START_REJECT_CAP) return value;
            n.n++;
            return false;
        },
    });
}
