// Smarter AI add-on (scenarios/smarter-ai): shared switches and the per-game state. Not a port.
//
// AI empires only: never the player, never a pirate faction, never the independents. Everything here is gated on the
// master flag `smarterAI` plus a sub flag; with the add-on off (or no scenario) no handler runs and nothing is stored.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { scenarioFlag, scenarioState } from '../state';
import { registerScenarioGameStart } from '../hooks';

export const SMARTER_AI_FLAG = 'smarterAI';
export const SMARTER_AI_RESEARCH_FLAG = 'smarterAIResearch';
export const SMARTER_AI_GROWTH_TAX_FLAG = 'smarterAIGrowthTax';
export const SMARTER_AI_GROWTH_TAX_THRESHOLD_PARAM = 'smarterAIGrowthTaxThreshold';
export const SMARTER_AI_GROWTH_TAX_THRESHOLD_DEFAULT = 70;
export const SMARTER_AI_STATE_KEY = 'smarterAI';

/** One empire's research orders (project ids). `base` is fixed at the empire's first use; `current` is re-weighed yearly. */
export interface SmarterResearchOrders {
    base: { weapons: number[]; energy: number[]; highTech: number[] };
    current: { weapons: number[]; energy: number[]; highTech: number[] };
    /** The dynamic signals of the last evaluation. */
    threat: boolean;
    reach: boolean;
}

/** galaxy.scenario.state.smarterAI (plain data, saved with the game). Keys are empire ids. */
export interface SmarterAIState {
    orders: Record<string, SmarterResearchOrders>;
    /** Growth taxes: the empire is in the debt override (hysteresis memory). */
    debt: Record<string, boolean>;
}

export function smarterAIState(galaxy: Galaxy): SmarterAIState {
    return scenarioState<SmarterAIState>(galaxy, SMARTER_AI_STATE_KEY, () => ({ orders: {}, debt: {} }));
}

export function smarterAIOn(galaxy: Galaxy, sub: string): boolean {
    return scenarioFlag(galaxy, SMARTER_AI_FLAG) && scenarioFlag(galaxy, sub);
}

/** An empire the add-on drives: an active AI empire with a race, not the player, a pirate faction or the independents. */
/** Set at the end of createGame: before that (galaxy generation, starting techs) the add-on stays out, so the same
 *  seed gives the same galaxy with it on or off. */
export const SMARTER_AI_LIVE_KEY = 'smarterAILive';

registerScenarioGameStart({
    id: 'smarterAI.live',
    flag: SMARTER_AI_FLAG,
    run: (galaxy) => {
        if (scenarioFlag(galaxy, SMARTER_AI_FLAG)) galaxy.scenario!.state[SMARTER_AI_LIVE_KEY] = true;
    },
});

/** The game has started (a save from before the live marker that already has add-on state counts as started). */
export function smarterAILive(galaxy: Galaxy): boolean {
    const st = galaxy.scenario?.state;
    if (st === undefined) return false;
    return st[SMARTER_AI_LIVE_KEY] === true || (!(SMARTER_AI_LIVE_KEY in st) && SMARTER_AI_STATE_KEY in st);
}

export function isSmarterAIEmpire(galaxy: Galaxy, empire: Empire | null): empire is Empire {
    return (
        empire !== null &&
        smarterAILive(galaxy) &&
        empire.active &&
        empire !== galaxy.playerEmpire &&
        !empire.playerEmpire &&
        empire !== galaxy.independentEmpire &&
        empire.pirateEmpireBaseHabitat === null &&
        empire.dominantRace !== null
    );
}
