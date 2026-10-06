// Sim worker: what a player command's `onApplied` gets when the worker could not apply the command (docs/sim-worker.md
// §4.4 "Failed commands"). In-thread every issued command reaches its executor at the next frame boundary and its
// callback always gets the executor's result. On a replica some commands cannot reach the executor at all — an
// argument the replica or the worker no longer knows (a ship destroyed meanwhile), a result that cannot cross, the
// worker gone (it stopped, the game was closed or reloaded), no reply in time — and the UI flows that wait on the reply
// (Recruit, the Design Editor's Save, the build / yard queues, proposals, renames, ...) must not hang. Such a command's
// callback gets the op's own FAILURE value: the value the executor returns when it refuses the order (false, null, 0,
// -1, `{ ok: false, ... }`, ...), so every caller handles it on its existing refusal path, with `reason` as the message
// where the result carries one.
//
// The table is typed per op (a new player op does not compile without its failure value).
// No DOM / Pixi imports.

import type { PlayerOpArgs, PlayerOpName, PlayerOpResult } from '../sim/player/playerOps';
import { TradeOfferResponse } from '../sim/tradeItems';

type FailureTable = { [K in PlayerOpName]: (reason: string, args: PlayerOpArgs<K>) => PlayerOpResult<K> };

const no = (): false => false;
const zero = (): 0 => 0;
const refused = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

export const COMMAND_FAILURE: FailureTable = {
    shipAction: (message) => ({ ok: false, message, automationPrompts: [] }),
    rightClickOrder: () => ({ kind: 'order', executed: false, attackClick: false }),
    fleetPoint: no,
    // The menus / pages / panel the UI shows from a command (docs/sim-worker.md §4.4): nothing to show.
    actionMenu: () => null,
    selectionButtons: () => null,
    habitatDispatch: () => [],
    moneyPanel: () => null,
    obtainUiRecords: () => undefined,
    setShipsFleet: () => null,
    refuelShips: zero,
    repairShips: zero,
    retrofitShips: () => ({ sent: 0, skipped: {} }),
    renameShip: no,
    setShipRetrofitStance: no,
    retireShips: zero,
    renameFleet: no,
    setFleetHomeColony: no,
    setFleetTroopLoadout: no,
    setShipTroopLoadout: no,
    fleetLoadTroops: no,
    fleetRetrofit: no,
    fleetRepairAndRefuel: no,
    enemyTargetList: () => [],
    enemyTargetAttack: () => null,
    enemyTargetCancel: no,
    shipOrderKey: no,
    setControlGroup: no,
    addWaypoint: zero,
    renameWaypoint: no,
    deleteWaypoint: no,
    dismissMarker: no,
    automationOff: no,
    setEmpireControl: no,
    setEmpireSetting: no,
    setPolicy: no,
    // createFleetTemplate never refuses in-thread; -1 is no template id (the tab finds no template to select).
    fleetTemplateCreate: () => -1,
    fleetTemplateRename: no,
    fleetTemplateDelete: no,
    fleetTemplateSetEntry: no,
    fleetTemplateForm: (message) => ({ ok: false, fleet: null, entries: [], message }),
    fleetTemplateBuild: (message) => ({ ok: false, orderId: null, fleet: null, queued: [], unbuildable: [], entries: [], message }),
    fleetTemplateCancelOrder: () => ({ ok: false, removed: 0, refund: 0 }),
    fleetTemplateAssign: no,
    fleetTemplateAutoRefill: no,
    fleetTemplateRefillYard: no,
    fleetTemplateReplenish: (message) => ({ ok: false, queued: 0, short: 0, message }),
    buildNewShips: (message) => ({ ok: false, message, title: 'Cannot Build Ships', built: [] }),
    moveWaitQueueItem: no,
    yardPurchase: () => null,
    yardRemoveFromQueue: no,
    yardScrapShip: no,
    scrapShips: zero,
    queueResearch: no,
    dequeueResearch: no,
    moveResearch: no,
    crashResearch: no,
    constructionJobAdd: zero,
    constructionJobCancel: no,
    constructionJobMoveUp: no,
    saveDesign: (message) => ({ ok: false, design: null, mustDo: [], shouldDo: [], message, title: 'Cannot Save Design' }),
    deleteDesign: (message) => ({ ok: false, deleted: [], message, title: 'Cannot Delete Design' }),
    toggleDesignObsolete: no,
    toggleDesignAutoRetrofit: no,
    setDesignSubRoleUpgrade: no,
    autoUpgradeDesigns: () => ({ added: [], select: null }),
    setDesignLineUpgrade: no,
    setStatePriorityShipyards: no,
    loadDesignFile: (message) => ({ ok: false, loaded: [], message, title: 'Cannot Load Designs' }),
    empireRename: no,
    empireChangeGovernment: () => -1,
    renameColony: no,
    setColonyAsCapital: no,
    setColonyPopulationPolicy: no,
    applyPopulationPolicyToAll: zero,
    scrapColonyFacility: () => 'rejected',
    editorRemovePirateFacilities: no,
    colonyTransferToTransport: no,
    disbandTroops: () => -1,
    garrisonTroops: zero,
    renameTroop: no,
    setAgentMission: no,
    cancelAgentMission: no,
    setAgentMissionFrame: no,
    transferCharacter: no,
    renameCharacter: no,
    dismissCharacter: no,
    submitProposal: (message) => ({ ok: false, accepted: false, message, reply: null, replyArgs: [], followUps: [], expireMessagesFor: null, automationPrompt: false, trade: null }),
    submitTradeOffer: (message) => ({ ok: false, response: TradeOfferResponse.Undefined, accepted: false, reply: null, replyArgs: [], message, nextOptionLabel: '', expireMessagesFor: null }),
    answerConversation: () => ({ ok: false, noFunds: false, expireFor: null, history: null, reply: null, replyArgs: [] }),
    acceptProposal: no,
    setSupplyRestrictedResources: no,
    setAllianceName: no,
    declineProposal: no,
    // cost -1: no price was ever computed — the popup tells this apart from "already protected" (accepted false, cost 0).
    acceptPirateOfferProtection: () => ({ accepted: false, cost: -1 }),
    answerDecision: no,
    proposePeaceTerms: (message) => ({ ok: false, accepted: false, message, counter: null }),
    approveSuggestion: () => ({ handled: false, expireDiplomacyFor: [] }),
    declineSuggestion: no,
    expireAdvisorSuggestions: zero,
    expireAdvisorSuggestionsForEmpire: zero,
    removeOldHistoryMessages: () => -1,
    setMessageOptions: no,
    setBaconSettings: () => ({}),
    storeChronicleYear: no,
    advisorCommands: (message, [, commands]) =>
        commands.map((c) => {
            const id = 'command' in c ? c.command.id : c.id;
            // The command id as its text: the chat / history lines read "✗ <text> — <message>".
            return { id, ok: false, status: 'failed' as const, text: id, message };
        }),
    diplomatCounter: (_message, [, , counterId]) => ({ id: counterId, status: 'stale', proposes: '', message: null }),
    answerScenarioDecision: no,
    charterCompany: no,
    charterRenew: no,
    charterRelease: no,
    charterNationalise: no,
    investigateRuins: () => undefined,
    investigateEncounteredBuiltObject: () => undefined,
    warnTargetOfPirateAttackFunding: () => undefined,
    exposeUncoveredPlanetDestroyer: () => undefined,
    salvageWreckField: no,
    pirateMissionButton: no,
    assignPirateSmugglingMission: no,
    storyEventAction: () => null,
    storyEventClose: no,
    politicsAction: refused,
    grantAutonomy: refused,
    securityInvestigate: refused,
    securityAction: refused,
    courtAppoint: refused,
    courtScheme: refused,
    courtHook: refused,
    courtProposeTie: (reason) => ({ ok: false, accepted: false, reason }),
    frontierOrder: refused,
    frontierConcede: refused,
    llmStrategic: () => null,
};

/** The failure value `op`'s callback gets (see the file header); undefined for an op the table does not know. */
export function commandFailureValue(op: string, reason: string, args: readonly unknown[]): unknown {
    if (!Object.prototype.hasOwnProperty.call(COMMAND_FAILURE, op)) return undefined;
    const f = COMMAND_FAILURE[op as PlayerOpName] as (reason: string, args: readonly unknown[]) => unknown;
    try {
        return f(reason, args);
    } catch {
        // A failure value that reads its arguments (advisorCommands, diplomatCounter) given odd ones.
        return undefined;
    }
}

/** The message a failed command's result carries (a plain string: resolveGameText shows it as it is). */
export function commandFailureMessage(detail: string): string {
    return `The order could not be carried out (the simulation did not apply it: ${detail.replace(/\|/g, '/')})`;
}
