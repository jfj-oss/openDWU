// Mod layer public API (tasks/MODLAYER-DESIGN.md). Scenario packages import from here.
export { parseScenarioManifest, emptyScenarioManifest, mergeScenarioManifests } from './manifest';
export type { ScenarioManifest, ScenarioFlagDef, ScenarioParamDef, ScenarioHomePlacementRule, ScenarioResourcePlacementRule, ScenarioIndex } from './manifest';
export { applyScenarioOverlay, mergeRecordsByName, normaliseOverlayPath, resolveScenarioIncludes } from './overlay';
export type { ScenarioOverlay, LoadedScenario } from './overlay';
export { GalaxyScenario, createGalaxyScenario, scenarioActive, scenarioFlag, scenarioParam, scenarioState } from './state';
export type { ScenarioChoice, ScenarioResourceRule } from './state';
export {
    registerScenarioYearly, registerScenarioPeriodic, registerScenarioGameStart, registerScenarioEvent, registerScenarioQuery,
    scenarioYearlyTick, scenarioPeriodicTick, scenarioGameStart, scenarioEmit, scenarioQuery, scenarioGateOpen,
    gameYear, GAME_DAY_LENGTH, radiusFraction, scenarioResourceAllowed, scenarioHomeRing, scenarioFindHomeHabitat,
} from './hooks';
export type {
    ScenarioHandlerGate, ScenarioYearlyHandler, ScenarioPeriodicHandler, ScenarioGameStartHandler, ScenarioEventHandler, ScenarioEvents,
    ScenarioEventName, ScenarioQueryHandler, ScenarioQueries, ScenarioQueryName, HomePlacementHelpers,
} from './hooks';
export { registerScenarioDecision, raiseScenarioDecision, answerScenarioDecision, pendingScenarioDecisions, expireScenarioDecisions, isScenarioDecision } from './decisions';
export type { ScenarioDecision, ScenarioDecisionOption, ScenarioDecisionHandler, RaiseDecisionSpec } from './decisions';
export { createEmpireMidGame } from './empireMidGame';
export type { MidGameEmpireSpec } from './empireMidGame';
export { scenarioMessage, scenarioNews, scenarioText } from './messages';
export type { ScenarioMessageOptions } from './messages';
// 19i "Rim atmosphere" data/wiring (items 10-12; render-side counterpart: src/render/rimAtmosphereWiring.ts).
export { RIM_FLAG_NAME } from './rimShared';
export { RIM_NAME_TABLE, buildRimNameOverrides, formatSurveyDesignation, installRimNameOverrides, rimSystemDisplayName, RIM_NAMES_STATE_KEY } from './rimNames';
export type { RimNameHost } from './rimNames';
export { RIM_TEXT_SUFFIX, rimMessageKey, rimText } from './rimMessages';
export { RIM_WEIGHTS_STATE_KEY, installRimWeights, rimWeightOfSystem } from './rimState';
export type { RimWeightHost } from './rimState';
export { RIM_DISTRESS_CALL_KEYS, RIM_DISTRESS_PERIOD_DAYS, rimDistressCallChance } from './rimDistressCalls';
