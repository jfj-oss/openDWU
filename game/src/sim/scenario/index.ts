// Mod layer public API (tasks/MODLAYER-DESIGN.md). Scenario packages import from here.
export { parseScenarioManifest, emptyScenarioManifest } from './manifest';
export type { ScenarioManifest, ScenarioFlagDef, ScenarioParamDef, ScenarioHomePlacementRule, ScenarioResourcePlacementRule, ScenarioIndex } from './manifest';
export { applyScenarioOverlay, mergeRecordsByName, normaliseOverlayPath } from './overlay';
export type { ScenarioOverlay, LoadedScenario } from './overlay';
export { GalaxyScenario, createGalaxyScenario, scenarioActive, scenarioFlag, scenarioParam, scenarioState } from './state';
export type { ScenarioChoice, ScenarioResourceRule } from './state';
export { registerScenarioYearly, scenarioYearlyTick, gameYear, radiusFraction, scenarioResourceAllowed, scenarioHomeRing, scenarioFindHomeHabitat } from './hooks';
export type { ScenarioYearlyHandler } from './hooks';
export { createEmpireMidGame } from './empireMidGame';
export type { MidGameEmpireSpec } from './empireMidGame';
export { scenarioMessage, scenarioNews, scenarioText } from './messages';
export type { ScenarioMessageOptions } from './messages';
