// Player orders the UI screens give (moved here from src/ui so the command log can replay them headless;
// tasks/M4-agent-brief.md "Command log"). Each is the ported click handler's sim effect, unchanged; the UI issues them
// through player/playerCommands.ts (applied at the next frame boundary) and re-exports them for its own use.
// Headless: no DOM / Pixi.

import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Design } from '../design';
import type { Race } from '../data/races';
import type { Galaxy } from '../galaxy';
import { Troop } from '../cargo';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { ResearchSystem, nodeIndustry, type TechNode } from '../researchSystem';
import { DiplomaticRelation, DiplomaticRelationType } from '../diplomacy';
import { cancelBlockades, changeDiplomaticRelation, processEndOfWarWithEmpire, resetAttitudeLevelsAtEndOfWar } from '../diplomacyTick';
import { galaxyStarDate } from '../tick/simTime';

const S = BuiltObjectSubRole;

// ---------------------------------------------------------------------------------------------------------------
// Research queue (researchScreen)
// ---------------------------------------------------------------------------------------------------------------

/** Port of ResearchSystem.cs:1635 CheckNodeValidForRace (allowed-races half). */
export function checkNodeValidForRace(rs: ResearchSystem, node: TechNode, race: Race | null): boolean {
    // TODO(port): DisallowedRaces — ResearchSystem.cs:1640 (not exposed by researchSystem.ts)
    if (rs.allowedRacesCount(node) > 0) return race !== null && rs.allowedRacesContains(node, race);
    return true;
}

// Port of ResearchTree.cs:1185-1189 OnMouseClick (left click, not queued)
export function queueResearchProject(rs: ResearchSystem, node: TechNode, race: Race | null): boolean {
    if (node.isResearched) return false;
    const items = rs.researchQueueFor(nodeIndustry(node));
    if (items === null) return false;
    if (items.includes(node)) return false;
    if (!checkNodeValidForRace(rs, node, race) || !rs.canResearchNode(node)) return false;
    items.push(node);
    return true;
}

// Port of ResearchTree.cs:1209-1225 OnMouseClick (right click, queued): remove the node, then drop
// every later entry that can no longer be researched (evaluated as it goes, as in the C#).
export function dequeueResearchProject(rs: ResearchSystem, node: TechNode): boolean {
    const items = rs.researchQueueFor(nodeIndustry(node));
    if (items === null || !items.includes(node)) return false;
    if (node.isRushing) return false; // "Cannot cancel crash programs"
    const index1 = items.indexOf(node);
    items.splice(index1, 1);
    const researchNodeList = [...items];
    if (index1 < researchNodeList.length) {
        for (let index2 = index1; index2 < researchNodeList.length; ++index2) {
            if (!rs.canResearchNode(researchNodeList[index2])) {
                const i = items.indexOf(researchNodeList[index2]);
                if (i >= 0) items.splice(i, 1);
            }
        }
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Troops (troops screen)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Port of Main.Part9.cs:4070 btnTroopDisband_Click after the automation prompt: removes each selected player troop
 * from its colony's Troops / TroopsToRecruit, its ship's Troops and the empire's Troops, and clears its
 * BuiltObject / Colony / AwaitingPickup / Empire. Returns the empire-list index the C# reselects (lowest selected
 * index − 1; −1 for none).
 */
export function disbandTroops(player: Empire, selected: readonly Troop[]): number {
    if (selected.length <= 0) return -1;
    let num = Number.MAX_SAFE_INTEGER;
    if (player.troops !== null) {
        for (const t of selected) {
            const num2 = player.troops.items.indexOf(t);
            if (num2 < num) num = num2;
        }
        num--;
    }
    for (const troop of selected) {
        if (troop == null || troop.empire !== player) continue;
        const colony = troop.colony as Habitat | null;
        if (colony !== null && colony.troops !== null && colony.troopsToRecruit !== null) {
            if (colony.troops.contains(troop)) colony.troops.remove(troop);
            else if (colony.troopsToRecruit.contains(troop)) colony.troopsToRecruit.remove(troop);
        }
        const bo = troop.builtObject as BuiltObject | null;
        if (bo !== null && bo.troops != null && bo.troops.contains(troop)) bo.troops.remove(troop);
        const empireTroops = (troop.empire as Empire).troops;
        if (empireTroops.contains(troop)) empireTroops.remove(troop);
        troop.builtObject = null;
        troop.colony = null;
        troop.awaitingPickup = false;
        troop.empire = null;
    }
    return num;
}

/** Port of Main.Part11.cs:3707 btnTroopGarrison_Click / 3684 btnTroopUngarrison_Click: only troops at a player colony. */
export function setTroopsGarrisoned(player: Empire, selected: readonly Troop[], garrisoned: boolean): number {
    let changed = 0;
    for (const troop of selected) {
        const colony = troop?.colony as Habitat | null;
        if (troop != null && troop.atColony && colony !== null && colony.empire === player) {
            troop.garrisoned = garrisoned;
            changed++;
        }
    }
    return changed;
}

/** Port of Main.Part9.cs:4140 (txtTroopInfoName change): a non-blank name renames the selected troop. */
export function renameTroop(troop: Troop | null, text: string): boolean {
    if (troop === null || text.trim() === '') return false;
    troop.name = text;
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Designs list (shipDesigns)
// ---------------------------------------------------------------------------------------------------------------

// DesignListView.cs BindData / Main.Part8.cs:1082 ctlDesignsList_CellClick: the six private sub-roles
// whose designs cannot be manually retrofitted.
export function isPrivateDesignSubRole(subRole: BuiltObjectSubRole): boolean {
    switch (subRole) {
        case S.SmallFreighter:
        case S.MediumFreighter:
        case S.LargeFreighter:
        case S.PassengerShip:
        case S.GasMiningShip:
        case S.MiningShip:
            return true;
        default:
            return false;
    }
}

// Main.Part8.cs:1091 ctlDesignsList_CellClick, "Obsolete" column.
export function toggleDesignObsolete(design: Design): void {
    design.isObsolete = !design.isObsolete;
}

// Main.Part8.cs:1082 ctlDesignsList_CellClick, "AutoRetrofit" column.
export function toggleDesignAutoRetrofit(design: Design, empire: Empire): boolean {
    if (isPrivateDesignSubRole(design.subRole)) return false;
    design.allowAutoRetrofit = !design.allowAutoRetrofit;
    const apply = (list: BuiltObject[]): void => {
        for (const bo of list) {
            if (bo !== null && bo.design === design) bo.suppressAutoRetrofit = !design.allowAutoRetrofit;
        }
    };
    apply(empire.builtObjects);
    apply(empire.privateBuiltObjects);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Construction wait queue (constructionYards)
// ---------------------------------------------------------------------------------------------------------------

export type WaitQueueMove = 'top' | 'up' | 'down' | 'bottom';

// Main.Part5.cs:2147-2213 (Move to Top / Move Up / Move Down / Move to Bottom),
// in place on the live wait queue. Returns whether the order changed.
export function moveWaitQueueItem(queue: BuiltObject[], item: BuiltObject, move: WaitQueueMove): boolean {
    const num = queue.indexOf(item);
    switch (move) {
        case 'top':
            if (num > 0) {
                queue.splice(num, 1);
                queue.splice(0, 0, item);
                return true;
            }
            return false;
        case 'up':
            if (num > 0) {
                queue.splice(num, 1);
                queue.splice(num - 1, 0, item);
                return true;
            }
            return false;
        case 'down':
            if (num >= 0 && num < queue.length - 1) {
                queue.splice(num, 1);
                queue.splice(num + 1, 0, item);
                return true;
            }
            return false;
        case 'bottom':
            if (num >= 0 && num < queue.length - 1) {
                queue.splice(num, 1);
                queue.splice(queue.length, 0, item);
                return true;
            }
            return false;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Answers to the other empire's treaty proposal (diplomacy screen, message popups)
// ---------------------------------------------------------------------------------------------------------------

/** Accept the other empire's treaty on offer. */
export function acceptProposal(player: Empire, other: Empire): boolean {
    // Port of EmpireDetailView.cs:803 btnEmpireDetailAcceptTreaty_Click (the player's accept path; the sim has no separate entry point)
    const galaxy: Galaxy = player.galaxy;
    const diplomaticRelation1 = player.proposedDiplomaticRelations.byEmpire(other);
    if (diplomaticRelation1 === null) return false;
    // The fallback is not added to the list, as in the C#.
    const diplomaticRelation2 =
        player.diplomaticRelations.byEmpire(other) ?? new DiplomaticRelation(DiplomaticRelationType.NotMet, player, player, other, false);
    switch (diplomaticRelation1.type) {
        case DiplomaticRelationType.None:
        case DiplomaticRelationType.SubjugatedDominion:
        case DiplomaticRelationType.Truce:
            switch (diplomaticRelation2.type) {
                case DiplomaticRelationType.TradeSanctions:
                    changeDiplomaticRelation(galaxy, player, diplomaticRelation2, diplomaticRelation1.type);
                    cancelBlockades(galaxy, player, other);
                    cancelBlockades(galaxy, other, player);
                    break;
                case DiplomaticRelationType.War: {
                    resetAttitudeLevelsAtEndOfWar(galaxy, diplomaticRelation2);
                    diplomaticRelation2.type = diplomaticRelation1.type;
                    diplomaticRelation2.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
                    let diplomaticRelation3 = other.diplomaticRelations.byEmpire(player);
                    if (diplomaticRelation3 === null) {
                        diplomaticRelation3 = new DiplomaticRelation(DiplomaticRelationType.NotMet, other, other, player, false);
                        other.diplomaticRelations.add(diplomaticRelation3);
                    }
                    diplomaticRelation3.type = diplomaticRelation1.type;
                    diplomaticRelation3.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
                    processEndOfWarWithEmpire(galaxy, player, other);
                    processEndOfWarWithEmpire(galaxy, other, player);
                    break;
                }
            }
            break;
        default:
            changeDiplomaticRelation(galaxy, player, diplomaticRelation2, diplomaticRelation1.type);
            break;
    }
    player.proposedDiplomaticRelations.remove(diplomaticRelation1);
    return true;
}

/** Main.Part10.cs:3930 method_235 on the player's proposals: decline the other empire's offer. */
export function declineProposal(player: Empire, other: Empire): boolean {
    // TODO(port): the conversation's refusal reply message (Main.Part10.cs conversation options) is not sent
    const diplomaticRelation = player.proposedDiplomaticRelations.byEmpire(other);
    if (diplomaticRelation === null) return false;
    player.proposedDiplomaticRelations.remove(diplomaticRelation);
    return true;
}
