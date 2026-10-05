// Mod layer public API (tasks/MODLAYER-DESIGN.md). Scenario packages import from here.
export { parseScenarioManifest, emptyScenarioManifest, mergeScenarioManifests } from './manifest';
export type { ScenarioManifest, ScenarioFlagDef, ScenarioParamDef, ScenarioHomePlacementRule, ScenarioResourcePlacementRule, ScenarioIndex } from './manifest';
export { applyScenarioOverlay, mergeRecordsByName, normaliseOverlayPath, resolveScenarioIncludes } from './overlay';
export type { ScenarioOverlay, LoadedScenario } from './overlay';
export {
    COMPOSITE_SCENARIO_ID, ADDON_GROUPS, HIDDEN_ADDONS, DATA_ONLY_INCLUDES, addonCatalog, addonClosure, addonCycles, addonSets, canonicalAddons,
    planAddonStart, compositeScenarioManifest, ELSEWHERE_ADDONS, SMARTER_AI_ADDON_ID, defaultSmarterAIChoice, withSmarterAI, compositeOverlay, addonStartOverlay, scenarioOverlayFor, resolveAddonSwitches, addonPickerModel, toggleAddon,
} from './addons';
export type { SmarterAIChoice, AddonGroup, AddonInfo, AddonCatalog, AddonDependency, AddonStartPlan, AddonOverrides, AddonRow, AddonPickerModel } from './addons';
export { GalaxyScenario, createGalaxyScenario, scenarioActive, scenarioFlag, scenarioParam, scenarioState } from './state';
export type { ScenarioChoice, ScenarioResourceRule } from './state';
export {
    registerScenarioYearly, registerScenarioPeriodic, registerScenarioGameStart, registerScenarioEvent, registerScenarioQuery,
    scenarioYearlyTick, scenarioPeriodicTick, scenarioGameStart, scenarioEmit, scenarioQuery, scenarioGateOpen,
    gameYear, GAME_DAY_LENGTH, radiusFraction, scenarioResourceAllowed, scenarioHomeRing, scenarioFindHomeHabitat,
    registerScenarioGeneration, scenarioGenerationSetup, scenarioAfterNebulae, scenarioAcceptStarPosition, scenarioGateOpenFor,
} from './hooks';
export type {
    ScenarioHandlerGate, ScenarioYearlyHandler, ScenarioPeriodicHandler, ScenarioGameStartHandler, ScenarioEventHandler, ScenarioEvents,
    ScenarioEventName, ScenarioQueryHandler, ScenarioQueries, ScenarioQueryName, HomePlacementHelpers,
    ScenarioGenerationHandler, ScenarioGenerationSetup,
} from './hooks';
export { registerScenarioDecision, raiseScenarioDecision, answerScenarioDecision, pendingScenarioDecisions, expireScenarioDecisions, isScenarioDecision } from './decisions';
export type { ScenarioDecision, ScenarioDecisionOption, ScenarioDecisionHandler, RaiseDecisionSpec } from './decisions';
export { createEmpireMidGame } from './empireMidGame';
export type { MidGameEmpireSpec } from './empireMidGame';
export { scenarioMessage, scenarioNews, scenarioText } from './messages';
// 19e-7 wreck records (consumed by 19g-7b Scavenger, 19f-7 Ghost Armada): wrecksAt is the query.
export { wrecksAt, wreckFields, wreckFieldAtPoint, wreckFieldValue, wreckRemaining, takeWrecks } from './wreckage/common';
export type { WreckRecord, WreckField, WreckHit } from './wreckage/common';
export type { ScenarioMessageOptions } from './messages';
// 19i "Rim atmosphere" data/wiring (items 10-12; render-side counterpart: src/render/rimAtmosphereWiring.ts).
export { RIM_FLAG_NAME } from './rimShared';
export { RIM_NAME_TABLE, buildRimNameOverrides, formatSurveyDesignation, installRimNameOverrides, rimSystemDisplayName, RIM_NAMES_STATE_KEY } from './rimNames';
export type { RimNameHost } from './rimNames';
export { RIM_TEXT_SUFFIX, rimMessageKey, rimText } from './rimMessages';
export { RIM_WEIGHTS_STATE_KEY, installRimWeights, rimWeightOfSystem } from './rimState';
export type { RimWeightHost } from './rimState';
export { RIM_DISTRESS_CALL_KEYS, RIM_DISTRESS_PERIOD_DAYS, rimDistressCallChance } from './rimDistressCalls';
