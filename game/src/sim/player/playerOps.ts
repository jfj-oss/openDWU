// The player commands the command log carries (tasks/M4-agent-brief.md "Command log"): one entry per UI entry point
// that changes the sim. Each op is `(galaxy, empire, ...args) => result` and only calls the existing executor, so the
// order behaves exactly as before; what changes is WHEN it runs (player/playerCommands.ts applies it at the next frame
// boundary, stamped with the sim time) and that it is journaled (args through player/commandCodec.ts) for replay.
// Adding an op: a new key here, plain arguments the codec can write (sim objects, data), and the UI call site issues
// it through issuePlayerCommand. Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Design } from '../design';
import type { ShipGroup } from '../fleets/shipGroup';
import type { Character, IntelligenceMission } from '../characters';
import type { Troop } from '../cargo';
import type { TechNode } from '../researchSystem';
import type { EmpirePolicy } from '../data/policies';
import type { ConstructionQueue } from '../construction/constructionQueue';
import type { ShipAction } from './shipAction';
import { executeShipAction, type ShipActionSelection } from './executeShipAction';
import { addConstructionJob, cancelConstructionJob, moveConstructionJobUp } from './constructionBoard';
import { applyAutomationOff, fleetPointClick, rightClickOrder } from './orderMenu';
import {
    fleetLoadTroops,
    fleetRepairAndRefuel,
    fleetRetrofit,
    retrofitSelectedShips,
    refuelSelectedShips,
    renameFleet,
    repairSelectedShips,
    retireSelectedShips,
    setFleetHomeColony,
    setFleetTroopLoadout,
    setShipsFleet,
    type SetFleetTarget,
    type TroopLoadout,
} from './fleetOps';
import { buildNewShips } from '../construction/empireConstruction';
import {
    buildFleetFromTemplate,
    cancelFleetBuildOrder,
    createFleetTemplate,
    deleteFleetTemplate,
    formFleetFromExisting,
    renameFleetTemplate,
    setFleetTemplateEntry,
    type FleetBuildMode,
    type SectorRef,
} from './fleetTemplates';
import { submitProposal } from './diplomacyProposals';
import { answerConversationReply, type ConversationRelated, type ConversationReplyPart } from './conversationReplies';
import { submitTradeOffer, type TradeNegotiation } from './tradeNegotiation';
import { executeAdvisorCommands, type AdvisorCommand, type ValidatedCommand } from './advisorCommands';
import type { AdvisorBrief } from './advisorBrief';
import { proposeDiplomatCounter } from './diplomatCounter';
import type { DiplomatBrief } from './diplomatBrief';
import { deleteDesign, saveDesign, setDesignSubRoleShouldBeUpgraded, type DesignDraft } from './designEditor';
import { executeShipOrderKey, type ShipOrderKeyAction } from './shipHotkeys';
import { initiateCrashResearchProgram } from '../researchTick';
import type { EmpireMessage } from '../messages';
import { approveSuggestion, declineSuggestion } from './advisorSuggestions';
import { expireOldAdvisorSuggestions } from '../advisorQueue';
import { galaxyStarDate } from '../tick/simTime';
import { investigateRuins } from '../exploration';
import { cancelIntelligenceMission, characterMission } from '../espionage';
import { scenarioFlag } from '../scenario/state';
import { ESPIONAGE_FLAG } from '../scenario/emergent/espionageHooks';
import { setMissionFrame } from '../scenario/emergent/espionage';
import { grantAutonomy, runPoliticsAction, type PoliticsActionName } from '../scenario/emergent/politicsActions';
import { answerScenarioDecision, pendingScenarioDecisions } from '../scenario/decisions';
import { proposePeaceTerms } from '../scenario/lively/peaceTerms';
import type { PeaceTerms } from '../scenario/lively/warGoals';
import { runSecurityAction, startInvestigation, type SecurityActionName } from '../scenario/security/security';
import { appointToSeat, type SeatName } from '../scenario/court/court';
import { concedeSector, orderSector, type FrontierOrder } from '../scenario/frontier/frontier';
import { proposeTie, startScheme, useHook, type ComplianceAct, type HookAction, type SchemeKind, type TieKind } from '../scenario/court/intrigue';
import {
    acceptProposal,
    declineProposal,
    dequeueResearchProject,
    disbandTroops,
    moveWaitQueueItem,
    queueResearchProject,
    renameTroop,
    setTroopsGarrisoned,
    toggleDesignAutoRetrofit,
    toggleDesignObsolete,
    type WaitQueueMove,
} from './playerOrders';
import { grantCharter, nationaliseCompany, releaseCompany, renewCharter, type CharterTerms } from '../scenario/charteredCompanies/charters';
import { obtainPirateRelation, PirateRelationType } from '../pirateRelations';
import { acceptPirateProtection, calculatePirateProtectionPricePerMonth } from '../pirates/pirateRelationsAI';
import { orderSalvage } from '../scenario/wreckage/wreckage';
import { applyLlmStrategicCommand, type LlmStrategicCommand } from '../scenario/llm/strategic';

/** Automation / control fields of Empire the UI sets directly (Game Options panel and the automation prompts). */
function isEmpireControlField(empire: Empire, field: string): boolean {
    return /^control[A-Z]/.test(field) && field in empire;
}

export const PLAYER_OPS = {
    // --- Orders (selection panel, action menu, right click, hotkeys, fleet point pick) ---
    /** Main.Part7.cs 45 method_347 (selection buttons, action menu, troops screen recruit). */
    shipAction: (galaxy: Galaxy, empire: Empire, selected: ShipActionSelection, action: ShipAction, fromActionMenu: boolean, actionMenuPoint?: { x: number; y: number }) =>
        executeShipAction(galaxy, empire, selected, action, fromActionMenu, { actionMenuPoint }),
    /** Main.Part10.cs 3310-3559: the default right-click order for the selected ship / fleet. */
    rightClickOrder: (galaxy: Galaxy, empire: Empire, selected: ShipActionSelection, order: ShipAction, keys: { ctrl: boolean; alt: boolean }, zoomFactor: number) =>
        rightClickOrder(galaxy, empire, selected, order, keys, zoomFactor),
    /** Main.Part10.cs 3063-3125: the fleet's attack point / home base pick. */
    fleetPoint: (galaxy: Galaxy, empire: Empire, fleet: ShipGroup, mode: 'SetFleetAttackPoint' | 'SetFleetHomeBase', target: unknown) =>
        fleetPointClick(galaxy, empire, fleet, mode, target),
    // --- Ships and Bases window / Fleets window buttons (player/fleetOps.ts) ---
    /** Main.Part6.cs cmbBuiltObjectSetFleet: form a new fleet / join a fleet / leave the fleet for the selected ships. */
    setShipsFleet: (galaxy: Galaxy, empire: Empire, ships: BuiltObject[], target: SetFleetTarget) => setShipsFleet(galaxy, empire, ships, target),
    refuelShips: (galaxy: Galaxy, empire: Empire, ships: BuiltObject[]) => refuelSelectedShips(galaxy, empire, ships),
    repairShips: (galaxy: Galaxy, empire: Empire, ships: BuiltObject[]) => repairSelectedShips(galaxy, empire, ships),
    retrofitShips: (galaxy: Galaxy, empire: Empire, ships: BuiltObject[]) => retrofitSelectedShips(galaxy, empire, ships),
    retireShips: (galaxy: Galaxy, empire: Empire, ships: BuiltObject[]) => retireSelectedShips(galaxy, empire, ships),
    renameFleet: (_galaxy: Galaxy, _empire: Empire, fleet: ShipGroup, name: string) => renameFleet(fleet, name),
    setFleetHomeColony: (_galaxy: Galaxy, empire: Empire, fleet: ShipGroup, colony: Habitat) => setFleetHomeColony(empire, fleet, colony),
    setFleetTroopLoadout: (_galaxy: Galaxy, empire: Empire, fleet: ShipGroup, loadout: TroopLoadout | null) => setFleetTroopLoadout(empire, fleet, loadout),
    fleetLoadTroops: (galaxy: Galaxy, empire: Empire, fleet: ShipGroup) => fleetLoadTroops(galaxy, empire, fleet),
    fleetRetrofit: (galaxy: Galaxy, empire: Empire, fleet: ShipGroup) => fleetRetrofit(galaxy, empire, fleet),
    fleetRepairAndRefuel: (galaxy: Galaxy, empire: Empire, fleet: ShipGroup) => fleetRepairAndRefuel(galaxy, empire, fleet),
    /** Main_KeyUp ship-order keys (E / R / A / S / ,). */
    shipOrderKey: (galaxy: Galaxy, empire: Empire, selected: ShipActionSelection, action: ShipOrderKeyAction) => executeShipOrderKey(galaxy, empire, selected, action),

    // --- Automation ---
    /** GenerateAutomationMessageBox "Turn off automation". */
    automationOff: (_galaxy: Galaxy, empire: Empire, task: string) => applyAutomationOff(empire, task),
    /** An Empire.control* field (Game Options automation rows, the per-screen automation prompts). */
    setEmpireControl: (_galaxy: Galaxy, empire: Empire, field: string, value: number | boolean) => {
        if (!isEmpireControlField(empire, field)) return false;
        (empire as unknown as Record<string, unknown>)[field] = value;
        return true;
    },

    // --- Empire policy / construction / research ---
    /** Main.Part2.cs WqesexberY_Click: `PlayerEmpire.Policy = method_597(panel)`. */
    setPolicy: (_galaxy: Galaxy, empire: Empire, policy: EmpirePolicy) => {
        empire.policy = policy;
        return true;
    },
    // Fleet Designs tab of the Fleets window (player/fleetTemplates.ts; a documented deviation, no C# counterpart).
    fleetTemplateCreate: (_galaxy: Galaxy, empire: Empire, name: string) => createFleetTemplate(empire, name),
    fleetTemplateRename: (_galaxy: Galaxy, empire: Empire, id: number, name: string) => renameFleetTemplate(empire, id, name),
    fleetTemplateDelete: (_galaxy: Galaxy, empire: Empire, id: number) => deleteFleetTemplate(empire, id),
    fleetTemplateSetEntry: (_galaxy: Galaxy, empire: Empire, id: number, design: Design, count: number) => setFleetTemplateEntry(empire, id, design, count),
    fleetTemplateForm: (galaxy: Galaxy, empire: Empire, id: number, rally: Habitat | null, allowSubstitutes: boolean) => formFleetFromExisting(galaxy, empire, id, rally, allowSubstitutes),
    fleetTemplateBuild: (galaxy: Galaxy, empire: Empire, id: number, mode: FleetBuildMode, sector: SectorRef | null, rally: Habitat | null, allowSubstitutes: boolean) =>
        buildFleetFromTemplate(galaxy, empire, id, mode, sector, rally, allowSubstitutes),
    fleetTemplateCancelOrder: (galaxy: Galaxy, empire: Empire, orderId: number) => cancelFleetBuildOrder(galaxy, empire, orderId),
    /** Main.Part2.cs 1135 btnBuildOrderPurchase_Click. */
    buildNewShips: (galaxy: Galaxy, empire: Empire, designs: (Design | null)[], amounts: number[]) => buildNewShips(galaxy, empire, designs, amounts),
    /** Main.Part5.cs 2147-2213: the site's construction wait queue order. */
    moveWaitQueueItem: (_galaxy: Galaxy, _empire: Empire, site: BuiltObject | Habitat, item: BuiltObject, move: WaitQueueMove) => {
        const queue = (site.constructionQueue as ConstructionQueue | null)?.constructionWaitQueue ?? null;
        return queue !== null && moveWaitQueueItem(queue, item, move);
    },
    queueResearch: (_galaxy: Galaxy, empire: Empire, node: TechNode) => queueResearchProject(empire.research, node, empire.dominantRace),
    dequeueResearch: (_galaxy: Galaxy, empire: Empire, node: TechNode) => dequeueResearchProject(empire.research, node),
    crashResearch: (galaxy: Galaxy, empire: Empire, node: TechNode, cost: number) => {
        initiateCrashResearchProgram(galaxy, empire, node, cost);
        return node.isRushing;
    },

    // --- Construction job board (player/constructionBoard.ts; not in the C#) ---
    /** Add a base build (habitat or point; x / y the Build mission's coordinates) to the player's construction job board. */
    constructionJobAdd: (galaxy: Galaxy, empire: Empire, design: Design, habitat: Habitat | null, x: number, y: number) => addConstructionJob(galaxy, empire, design, habitat, x, y),
    constructionJobCancel: (galaxy: Galaxy, empire: Empire, jobId: number) => cancelConstructionJob(galaxy, empire, jobId),
    constructionJobMoveUp: (galaxy: Galaxy, empire: Empire, jobId: number) => moveConstructionJobUp(galaxy, empire, jobId),

    // --- Designs ---
    saveDesign: (galaxy: Galaxy, empire: Empire, draft: DesignDraft) => saveDesign(galaxy, empire, draft),
    deleteDesign: (_galaxy: Galaxy, empire: Empire, designs: Design[]) => deleteDesign(empire, designs),
    toggleDesignObsolete: (_galaxy: Galaxy, _empire: Empire, design: Design) => {
        toggleDesignObsolete(design);
        return true;
    },
    toggleDesignAutoRetrofit: (_galaxy: Galaxy, empire: Empire, design: Design) => toggleDesignAutoRetrofit(design, empire),
    setDesignSubRoleUpgrade: (_galaxy: Galaxy, empire: Empire, subRole: number, upgrade: boolean) => {
        setDesignSubRoleShouldBeUpgraded(empire, subRole, upgrade);
        return true;
    },

    // --- Troops ---
    disbandTroops: (_galaxy: Galaxy, empire: Empire, troops: Troop[]) => disbandTroops(empire, troops),
    garrisonTroops: (_galaxy: Galaxy, empire: Empire, troops: Troop[], garrisoned: boolean) => setTroopsGarrisoned(empire, troops, garrisoned),
    renameTroop: (_galaxy: Galaxy, _empire: Empire, troop: Troop, name: string) => renameTroop(troop, name),

    // --- Intelligence agents ---
    /** CharacterMission.cs btnAssignMission_Click: `_Character.Mission = GetState()`. */
    setAgentMission: (_galaxy: Galaxy, _empire: Empire, agent: Character, mission: IntelligenceMission) => {
        agent.mission = mission;
        return true;
    },
    /** CharacterMission.cs btnCancelMission_Click: CancelIntelligenceMission, then Mission = null. */
    cancelAgentMission: (_galaxy: Galaxy, empire: Empire, agent: Character) => {
        const m = characterMission(agent);
        if (m !== null) cancelIntelligenceMission(empire, m);
        agent.mission = null;
        return true;
    },
    /** 19d3 (scenario `espionageConsequences` only; not a port): blame another empire for the agent's mission (false flag). */
    setAgentMissionFrame: (galaxy: Galaxy, _empire: Empire, mission: IntelligenceMission, framed: Empire | null) =>
        scenarioFlag(galaxy, ESPIONAGE_FLAG) ? setMissionFrame(galaxy, mission, framed) : false,
    /** Main.Part6.cs 3351 btnIntelligenceAgentsDisband_Click: `Mission = null; Kill(galaxy)`. */
    dismissCharacter: (galaxy: Galaxy, _empire: Empire, character: Character) => {
        character.mission = null;
        character.kill(galaxy);
        return true;
    },

    // --- Diplomacy ---
    /** Main.Part10.cs 3957 method_237: a conversation option (by id; re-resolved on the live state). */
    submitProposal: (galaxy: Galaxy, empire: Empire, other: Empire, optionId: string) => submitProposal(galaxy, empire, other, optionId),
    /** Main.Part10.cs 4334 DEAL_OFFER. */
    submitTradeOffer: (galaxy: Galaxy, _empire: Empire, negotiation: TradeNegotiation) => submitTradeOffer(galaxy, negotiation),
    /** Main.Part10.cs 3957 method_237 for the replies to an incoming conversation (conversationReplies.ts). */
    answerConversation: (galaxy: Galaxy, empire: Empire, sender: Empire, part: ConversationReplyPart, related: ConversationRelated, cost: number) =>
        answerConversationReply(galaxy, empire, sender, part, related, cost),
    acceptProposal: (_galaxy: Galaxy, empire: Empire, other: Empire) => acceptProposal(empire, other),
    declineProposal: (_galaxy: Galaxy, empire: Empire, other: Empire) => declineProposal(empire, other),

    // --- Pirates ---
    /**
     * The "Accept" button on a PirateOfferProtection popup (message popup / advisorQueue bug fix): the player agrees
     * to the pirate's protection / truce / extortion offer (dialog/base_dialog.txt PIRATE_PROTECTIONPROPOSEINITIATE,
     * PIRATE_TRUCEPROPOSEINITIATE, PIRATE_EXTORTPROTECTION; the response text is PIRATE_PROTECTIONACCEPTRESPONSE /
     * PIRATE_TRUCEACCEPTRESPONSE, Main.Part10.cs:5132-5166). The price is recomputed fresh here (Empire.2.cs:2649
     * CalculatePirateProtectionPricePerMonth), as the C# does when the popup's ConversationOption is built
     * (Main.Part9.cs:2077), rather than trusting the message's possibly-stale `Money` — this executor runs at the
     * frame boundary (player/playerCommands.ts), the only place sim state (obtainPirateRelation's lazy creation of
     * the PirateRelation record) may be written and stay replay-safe. Applies through the already-ported Empire.3.cs
     * 4213 AcceptPirateProtection (pirateRelationsAI.ts), the same call the AI's own auto-accept uses
     * (diplomacyTick.ts ProcessMessages, EmpireMessageType.PirateOfferProtection). No funds gate: neither
     * AcceptPirateProtection nor that AI auto-accept path checks funds, and the C#'s player-conversation-only check
     * (Main.Part10.cs:5145 `initiator.StateMoney < conversationOption_0.Cost`) reads the pirate's money, not the
     * payer's, in the decompile — too ambiguous to reproduce as a real gate.
     */
    acceptPirateOfferProtection: (galaxy: Galaxy, empire: Empire, pirateEmpire: Empire): { accepted: boolean; cost: number } => {
        if (obtainPirateRelation(empire, pirateEmpire).type === PirateRelationType.Protection) return { accepted: false, cost: 0 };
        const cost = calculatePirateProtectionPricePerMonth(galaxy, pirateEmpire, empire).price;
        acceptPirateProtection(galaxy, empire, pirateEmpire, cost);
        return { accepted: true, cost };
    },

    // --- Mod layer (scenarios) ---
    /** A scenario decision's option (scenario/decisions.ts; the message popup's buttons, the 19g-3 terms dialog). */
    answerDecision: (galaxy: Galaxy, _empire: Empire, decisionId: number, optionId: string) => answerScenarioDecision(galaxy, decisionId, optionId, 'player'),
    /** 19g-3 war goals: offer `other` peace on `terms` (the diplomacy screen's terms dialog). */
    proposePeaceTerms: (galaxy: Galaxy, empire: Empire, other: Empire, terms: PeaceTerms) => proposePeaceTerms(galaxy, empire, other, terms),

    // --- Advisor suggestions (semi-automated tasks awaiting Approve / Decline; Main.Part2.cs 1369 / 2732) ---
    approveSuggestion: (galaxy: Galaxy, empire: Empire, message: EmpireMessage) => approveSuggestion(galaxy, empire, message),
    declineSuggestion: (galaxy: Galaxy, empire: Empire, message: EmpireMessage) => declineSuggestion(galaxy, empire, message),
    /** DiplomaticMessageQueue.cs 864 method_3: drop suggestions older than their lifetime (at this boundary's date). */
    expireAdvisorSuggestions: (galaxy: Galaxy, empire: Empire) => expireOldAdvisorSuggestions(empire, galaxyStarDate(galaxy)),

    // --- The local model (18a advisor chat, 18b diplomat counter-proposal) ---
    advisorCommands: (galaxy: Galaxy, empire: Empire, brief: AdvisorBrief, commands: (AdvisorCommand | ValidatedCommand)[]) => executeAdvisorCommands(galaxy, empire, brief, commands),
    diplomatCounter: (galaxy: Galaxy, player: Empire, ai: Empire, brief: DiplomatBrief, counterId: string) => proposeDiplomatCounter(galaxy, ai, player, brief, counterId),

    // --- Mod layer (tasks/MODLAYER-DESIGN.md §4): scenario decisions and scenario actions are player input too ---
    /** A scenario decision answered from its message popup (scenario/decisions.ts); only the empire's own questions. */
    answerScenarioDecision: (galaxy: Galaxy, empire: Empire, decisionId: number, optionId: string) => {
        const d = pendingScenarioDecisions(galaxy, empire).find((x) => x.id === decisionId);
        return d !== undefined && answerScenarioDecision(galaxy, decisionId, optionId, 'player');
    },
    /** 19c: charter a company to settle `target` (tasks/19c-chartered-companies.md §4.4). */
    charterCompany: (galaxy: Galaxy, empire: Empire, target: Habitat, terms: CharterTerms) => grantCharter(galaxy, empire, target, terms).ok,
    /** 19c Charters screen: Renew / Release / Nationalise (§4.10 / §4.11). */
    charterRenew: (galaxy: Galaxy, empire: Empire, company: Empire) => renewCharter(galaxy, empire, company),
    charterRelease: (galaxy: Galaxy, empire: Empire, company: Empire) => releaseCompany(galaxy, empire, company),
    charterNationalise: (galaxy: Galaxy, empire: Empire, company: Empire) => nationaliseCompany(galaxy, empire, company),
    /** 19e-7 (scenario flag `wreckage`): send a construction / mining ship to salvage a debris field (right-click menu). */
    /** Main.Part4.cs:1831-1835 btnEventMessageInvestigate (EncounterRuins pop-up): Galaxy.InvestigateRuins(PlayerEmpire, habitat). */
    investigateRuins: (galaxy: Galaxy, empire: Empire, habitat: Habitat) => investigateRuins(galaxy, empire, habitat),
    salvageWreckField: (galaxy: Galaxy, empire: Empire, ship: BuiltObject, fieldId: number) => orderSalvage(galaxy, empire, ship, fieldId, true),
    // [emergent] begin — scenario 19d1 internal politics (scenario/emergent/politicsActions.ts; flag-gated inside)
    politicsAction: (galaxy: Galaxy, empire: Empire, action: PoliticsActionName, character: Character) => runPoliticsAction(galaxy, empire, action, character),
    grantAutonomy: (galaxy: Galaxy, empire: Empire, colony: Habitat) => grantAutonomy(galaxy, empire, colony),
    // [emergent] end
    // [security] begin — scenario 19m internal security (scenario/security/security.ts; flag-gated inside)
    /** "Investigate lead": assign an agent to a lead (the agent stays on counter-intelligence while it runs). */
    securityInvestigate: (galaxy: Galaxy, empire: Empire, leadId: number, agent: Character) => startInvestigation(galaxy, empire, leadId, agent),
    /** An action a confirmed lead unlocks (arrest / exile / purge / amnesty / quarantine / martialLaw / recallFleet / scrapShip). */
    securityAction: (galaxy: Galaxy, empire: Empire, action: SecurityActionName, leadId: number) => runSecurityAction(galaxy, empire, action, leadId),
    // [security] end
    // [court] begin — scenario 19n court & dynasties (scenario/court/court.ts; flag-gated inside)
    /** Appoint a character to a council seat (null vacates it). */
    courtAppoint: (galaxy: Galaxy, empire: Empire, seat: SeatName, character: Character | null) => appointToSeat(galaxy, empire, seat, character),
    /** 19n package 2: an agent runs a scheme (sway / blackmail / sabotageLoyalty / assassinate) against a character. */
    courtScheme: (galaxy: Galaxy, empire: Empire, agent: Character, kind: SchemeKind, target: Character, act: ComplianceAct | null = null, seat: SeatName | null = null) =>
        startScheme(galaxy, empire, agent, kind, target, act, seat),
    /** Spend a hook: force compliance on one of our characters (seat / withdraw / abandonPlot) or expose the secret. */
    courtHook: (galaxy: Galaxy, empire: Empire, hookId: number, action: HookAction, act: ComplianceAct = 'abandonPlot', seat: SeatName | null = null) => useHook(galaxy, empire, hookId, action, act, seat),
    /** Propose a dynastic tie (envoy / ward / spouse) to another empire (also offered on the Diplomacy conversation). */
    courtProposeTie: (galaxy: Galaxy, empire: Empire, other: Empire, kind: TieKind) => proposeTie(galaxy, empire, other, kind),
    // [court] end
    // [frontier] begin — scenario 19g-5 frontier autonomy (scenario/frontier/frontier.ts; flag-gated inside)
    /** A colony-policy order to a frontier sector (rule loose / normal / tight, herd tolerance, revoke the local tax); the governor may refuse. */
    frontierOrder: (galaxy: Galaxy, empire: Empire, sectorId: number, order: FrontierOrder) => orderSector(galaxy, empire, sectorId, order),
    /** A concession to a restless sector (loose rule, local tax, autonomy grant, governor loyalty). */
    frontierConcede: (galaxy: Galaxy, empire: Empire, sectorId: number) => concedeSector(galaxy, empire, sectorId),
    // [frontier] end
    // [llm] begin — 19s-3 strategic upgrade (scenario/llm/strategic.ts; flag llmStrategic, no-op when off): the local
    // model's validated choice for an AI empire (`empire` = that AI), or its refusal; the only way a model choice
    // reaches the sim, so seed + command log replays it without the model.
    llmStrategic: (galaxy: Galaxy, empire: Empire, command: LlmStrategicCommand) => applyLlmStrategicCommand(galaxy, empire, command),
    // [llm] end
} as const;

export type PlayerOps = typeof PLAYER_OPS;
export type PlayerOpName = keyof PlayerOps;
type Tail<T extends unknown[]> = T extends [unknown, unknown, ...infer R] ? R : never;
/** The op's arguments after (galaxy, empire). */
export type PlayerOpArgs<K extends PlayerOpName> = Tail<Parameters<PlayerOps[K]>>;
export type PlayerOpResult<K extends PlayerOpName> = ReturnType<PlayerOps[K]>;
