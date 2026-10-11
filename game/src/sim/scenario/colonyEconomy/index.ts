// Colony Economy add-on (scenarios/colony-economy; docs/ECONOMY.md). Importing this module registers every handler.
import './designations';
import './facilities';
import './effects';
import './bonds';
export * from './common';
export { designationScores, suggestDesignation, setDesignation, designationRefusal, designationCooldownDays, facilitiesLostByChange, reviewAiDesignations } from './designations';
export { requestFacility, cancelFacilityRequest, setAutoFacilities, facilitySlotView, colonySlots, privateSurplus } from './facilities';
export { issueBond, repayBond, setAutoBonds, bondView, bondQuote } from './bonds';
export { colonyBonuses, approvalLines, constructionFactor, scenicBonus, ECON_BONUS_RESOURCE_ID } from './effects';
