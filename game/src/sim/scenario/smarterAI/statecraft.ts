// Smarter AI add-on, statecraft part (scenarios/smarter-ai): research stations, wonders, espionage and diplomacy.
// Shared flags and per-game state. Not a port. AI empires only (common.ts isSmarterAIEmpire); every feature is gated on
// the master flag `smarterAI` plus its own sub flag, and stores nothing while off.

import type { Galaxy } from '../../galaxy';
import { scenarioState } from '../state';

export const SMARTER_AI_RESEARCH_STATIONS_FLAG = 'smarterAIResearchStations';
export const SMARTER_AI_WONDERS_FLAG = 'smarterAIWonders';
export const SMARTER_AI_ESPIONAGE_FLAG = 'smarterAIEspionage';
export const SMARTER_AI_DIPLOMACY_FLAG = 'smarterAIDiplomacy';
export const SMARTER_AI_STATECRAFT_STATE_KEY = 'smarterAIStatecraft';

/** One empire's wonder plan: the wonder it pursues and the research project that unlocks it. */
export interface SmarterWonderPlan {
    facilityId: number;
    projectId: number;
    /** The stance it was picked for (re-picked when it changes). */
    aggressive: boolean;
}

/** galaxy.scenario.state.smarterAIStatecraft (plain data, saved with the game). Keys are empire ids. */
export interface SmarterAIStatecraftState {
    wonders: Record<string, SmarterWonderPlan | null>;
    /** Star dates at which hostile intelligence missions against the empire were exposed (last year only). */
    spiedOn: Record<string, number[]>;
}

export function statecraftState(galaxy: Galaxy): SmarterAIStatecraftState {
    return scenarioState<SmarterAIStatecraftState>(galaxy, SMARTER_AI_STATECRAFT_STATE_KEY, () => ({ wonders: {}, spiedOn: {} }));
}
