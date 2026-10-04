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
import { DiplomaticRelation, DiplomaticRelationType, obtainDiplomaticRelation } from '../diplomacy';
import type { Character } from '../characters';
import { cancelBlockades, changeDiplomaticRelation, processEndOfWarWithEmpire, resetAttitudeLevelsAtEndOfWar } from '../diplomacyTick';
import { galaxyStarDate } from '../tick/simTime';
import { scenarioEmit } from '../scenario/hooks';
import { haveRevolution } from '../treasury';

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

/**
 * Not in the original (our research queue panel): move a queued project to `toIndex` in its industry's queue.
 * The target is clamped so a project stays after every queued parent and before every queued child, and a crash
 * program at the head keeps its place. Returns true if the queue order changed.
 */
export function moveResearchProject(rs: ResearchSystem, node: TechNode, toIndex: number): boolean {
    const items = rs.researchQueueFor(nodeIndustry(node));
    if (items === null) return false;
    const from = items.indexOf(node);
    if (from < 0 || node.isRushing || !Number.isFinite(toIndex)) return false;
    const rest = items.filter((n) => n !== node);
    let lo = rest.length > 0 && rest[0].isRushing ? 1 : 0;
    let hi = rest.length;
    for (let i = 0; i < rest.length; i++) {
        if (node.parentNodes.includes(rest[i])) lo = Math.max(lo, i + 1);
        if (rest[i].parentNodes.includes(node)) hi = Math.min(hi, i);
    }
    if (lo > hi) return false;
    const to = Math.min(hi, Math.max(lo, Math.trunc(toIndex)));
    if (to === from) return false;
    rest.splice(to, 0, node);
    items.splice(0, items.length, ...rest);
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
// Empire Summary (empireSummary.ts): the name box and the revolution button
// ---------------------------------------------------------------------------------------------------------------

/** Port of Main.Part9.cs:4306 txtEmpireSummaryName_Leave: a non-blank name becomes `PlayerEmpire.Name` (the setter
 *  only stores it; there is no MaxLength on the text box). Ours stores the trimmed text. Everything derived from the
 *  name (ship registry prefixes in shipNameStyle.ts, message text, flags keyed by empire id) reads it live, so only
 *  ships named after this get the new prefix. Returns false (no change) for a blank name. */
export function renameEmpire(empire: Empire, text: string): boolean {
    const name = text.trim();
    if (name === '') return false;
    empire.name = name;
    return true;
}

/** Port of Main.Part6.cs:3028 btnEmpireSummaryChangeGovernment_Click after its "Have a Revolution?" Yes:
 *  `PlayerEmpire.HaveRevolution(PlayerEmpire.DominantRace, governmentId)` (damage factor 1.0). The click only acts
 *  when the id is a government (>= 0) other than the current one; the button is disabled when the dominant race
 *  cannot change government (Main.Part4.cs:4758 cmbEmpireSummaryChangeGovernmentType_SelectedIndexChanged), the combo
 *  lists only AllowableGovernmentTypes and the controls are hidden for pirates (Main.Part9.cs:4233). There is no
 *  cooldown. Returns the new government id, or -1 when rejected. */
export function changeGovernmentByRevolution(galaxy: Galaxy, empire: Empire, governmentId: number): number {
    if (!Number.isInteger(governmentId) || governmentId < 0 || governmentId === empire.governmentId) return -1;
    if (empire.pirateEmpireBaseHabitat !== null) return -1;
    if (!empire.allowableGovernmentTypes.includes(governmentId)) return -1;
    const race = empire.dominantRace as Race | null;
    if (race !== null && race.canChangeGovernment === false) return -1;
    return haveRevolution(galaxy, empire, race, governmentId, 1.0);
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
    let endedWar = false; // mod layer (peaceSigned)
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
                    endedWar = true;
                    break;
                }
            }
            break;
        default:
            changeDiplomaticRelation(galaxy, player, diplomaticRelation2, diplomaticRelation1.type);
            break;
    }
    player.proposedDiplomaticRelations.remove(diplomaticRelation1);
    if (endedWar && galaxy.scenario !== null) scenarioEmit(galaxy, 'peaceSigned', { empire: player, other }); // mod layer
    return true;
}

/** Port of TradeRestrictedResourcesPanel.cs chkTradeResources_CheckedChanged (the diplomacy screen's restricted-resource
 *  checkbox): `PlayerEmpire.ObtainDiplomaticRelation(_Empire).SupplyRestrictedResources = Checked`. */
export function setSupplyRestrictedResources(player: Empire, other: Empire, supply: boolean): boolean {
    if (other === player) return false;
    obtainDiplomaticRelation(player, other).supplyRestrictedResources = supply;
    return true;
}

/** Port of Main.Part2.cs:4652 method_683 (btnRelationAllianceNameApply_Click, in game: the Locked checkbox is hidden
 *  and disabled, method_682(false)): the name goes on the player's relation with `other` and on `other`'s relation
 *  with the player (ObtainDiplomaticRelation both ways). */
export function setAllianceName(player: Empire, other: Empire, name: string): boolean {
    if (other === player) return false;
    obtainDiplomaticRelation(player, other).allianceName = name;
    obtainDiplomaticRelation(other, player).allianceName = name;
    return true;
}

/** Port of CharacterSummary.cs txtName_Leave: `_Character.Name = txtName.Text` (any text, as the C# stores it). */
export function renameCharacter(character: Character | null, name: string): boolean {
    if (character === null) return false;
    character.name = name;
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
