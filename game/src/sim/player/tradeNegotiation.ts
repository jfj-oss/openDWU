// Task 17e2: the player's trade negotiation with another empire (no DOM).
//
// In the original the conversation (17e, player/diplomacyProposals.ts) offers two trade entries (Main.Part9.cs:219-257):
// - "Swap maps or tech" (OFFER_DEAL): the other empire answers OFFER_DEAL_RESPONSE with quick offers (Main.Part9.cs:273
//   swap territory maps / swap galaxy maps / sell up to three techs); the player's pick is settled at once
//   (Main.Part10.cs:4230-4323 method_237 OFFER_DEAL_TERRITORYMAP / _GALAXYMAP / _COMPONENT) → offerDealOptions /
//   submitOfferDeal.
// - "Negotiate a trade proposal..." / "...an end to this war..." / "...lifting trade sanctions..." (DEAL_BEGIN):
//   Main.Part10.cs:4324 method_302 opens two DiplomacyTradeTree controls (DistantWorlds.Controls/Controls/
//   DiplomacyTradeTree.cs): "them" (what the other empire gives, bound with refactorValuesForEmpire = true, no threats)
//   and "us" (what the player gives, includeAllItems, threats allowed), Main.Part8.cs:505-508. The player moves items
//   into each tree's offered list and proposes (DEAL_OFFER, Main.Part10.cs:4334): the other empire runs
//   Empire.EvaluateTradeOffer (Empire.7.cs:1779, ported in sim/tradeItems.ts evaluateTradeOffer) and on acceptance both
//   lists change hands through Galaxy.GiveTradeableItem (Galaxy.4.cs:3857, sim/tradeItems.ts giveTradeableItem) →
//   beginTradeNegotiation / tradeTreeRows / addTradeItem / removeTradeItem / clearTradeItems / submitTradeOffer.
// The tradeable-item model, values and acceptance rules are sim/tradeItems.ts (M4r); this module is the player side.
//
// Determinism: runs only from player input. galaxy.rnd draws, in the C# order: EvaluateTradeOffer's Next(0, 3) (a
// threat offer, Empire.7.cs:1893/1924; a low offer, :1996), whatever GiveTradeableItem's callees draw (DeclareWar
// flow-on, TakeOwnershipOfColony) and a refused threat's DeclareWar; OFFER_DEAL_COMPONENT draws one NextDouble
// (Main.Part10.cs:4296) when the tech's price is within the buyer's StateMoney. Listing and selecting draw nothing.
//
// TODO(port): Main.Part10.cs:4338 — a DEAL_OFFER that repeats, unchanged, the other empire's own earlier offer
//   (Main.cs tradeableItemList_0/_1, set by DEAL_IMPROVE when the player answers an *incoming* trade offer) is accepted
//   regardless of EvaluateTradeOffer. Incoming trade-offer conversations are not ported, so that case never arises here.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import { Habitat, HabitatType } from '../types';
import { GalaxyLocation } from '../galaxyLocation';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../diplomacy';
import { changeDiplomaticRelation, declareWar, formatThousands } from '../diplomacyTick';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { gameText } from '../colonyTick';
import { tryGetText } from '../textResolver';
import { splitString } from '../data/gameText';
import type { DialogPartType } from '../data/dialogSet';
import { galaxyStarDate } from '../tick/simTime';
import { PirateIncomeType } from '../pirates/pirateEconomy';
import { determineEmpireSystems } from '../forceStructure';
import { SystemVisibilityStatus } from '../visibility';
import { mergeGalaxyMap } from '../exploration';
import { doResearchBreakthrough, reviewDesignsBuiltObjectsImprovedComponents } from '../researchTick';
import {
    TradeableItem,
    TradeableItemType,
    TradeOfferResponse,
    containsType,
    determineAcceptGalaxyMapTrade,
    determineAcceptTerritoryMapTrade,
    evaluateTradeOffer,
    giveTradeableItem,
    isTechNode,
    refactorValueForEmpire,
    resolveTradeableItems,
    techTreeGetEquivalent,
    tradeableItemsTotalValue,
    valueEndWarAgainstUs,
    valueGalaxyMapForEmpire,
    valueLiftTradeSanctionsAgainstUs,
    valueMoney,
    valueTerritoryMapForEmpire,
} from '../tradeItems';

export { TradeableItem, TradeableItemType, TradeOfferResponse, evaluateTradeOffer };

// ---------------------------------------------------------------------------------------------------------------
// TradeableItemList helpers (TradeableItemList.cs).
// ---------------------------------------------------------------------------------------------------------------

/** TradeableItemList.cs:124 IndexOf (the `new` overload): the first item of the same type naming the same object
 *  (Money / TerritoryMap / GalaxyMap / ThreatenWar / ThreatenTradeSanctions match on type alone; a research project on
 *  its ResearchNodeId). */
export function tradeableItemIndexOf(list: readonly TradeableItem[], tradeableItem: TradeableItem): number {
    const t = tradeableItem.type;
    for (let index = 0; index < list.length; index++) {
        const other = list[index];
        if (other.type !== t) continue;
        switch (t) {
            case TradeableItemType.Money:
            case TradeableItemType.TerritoryMap:
            case TradeableItemType.GalaxyMap:
            case TradeableItemType.ThreatenWar:
            case TradeableItemType.ThreatenTradeSanctions:
                return index;
            case TradeableItemType.AdoptGovernmentStyle:
                if ((other.item as { governmentId?: number }).governmentId === (tradeableItem.item as { governmentId?: number }).governmentId) return index;
                break;
            case TradeableItemType.ResearchProject:
                if (isTechNode(other.item) && isTechNode(tradeableItem.item) && other.item.def.projectId === tradeableItem.item.def.projectId) return index;
                break;
            case TradeableItemType.SecretLocation:
                if (other.item instanceof GalaxyLocation) {
                    if (other.item === tradeableItem.item) return index;
                } else if (other.item instanceof Habitat && other.item === tradeableItem.item) {
                    return index;
                }
                break;
            default:
                // Colony / Base / SystemMap / IndependentColonyLocation / *Other / EndWar / LiftTradeSanctions / ContactEmpire.
                if (other.item === tradeableItem.item) return index;
                break;
        }
    }
    return -1;
}

/** TradeableItemList.cs:72 FindAnyGovernmentStyle. */
function findAnyGovernmentStyle(list: readonly TradeableItem[]): number {
    for (let index = 0; index < list.length; index++) if (list[index].type === TradeableItemType.AdoptGovernmentStyle) return index;
    return -1;
}

/** Galaxy.2.cs:2523 ResolveDescription(HabitatType): GameText "HabitatType <name>". */
function habitatTypeDescription(type: HabitatType): string {
    const name = HabitatType[type] ?? String(type);
    return tryGetText(`HabitatType ${name}`) ?? splitString(name);
}

/** `value.ToString("###,###,###,##0")`. */
function fmt(value: number): string {
    return formatThousands(value);
}

/**
 * TradeableItem.cs:36 ToString(showValue): the offered-items list entry (GameText key + string.Format args, gameText()
 * encoding; resolveGameText for display). `showSecretLocationNames` = TradeableItem.ShowSecretLocationNames, cleared for
 * the other empire's tree (DiplomacyTradeTree.cs:179 SetSelectedItemsInControl).
 */
export function tradeItemLabel(galaxy: Galaxy, item: TradeableItem, showValue = true, showSecretLocationNames = true): TradeLabel {
    let str1 = '';
    const e = item.item as Empire | null;
    switch (item.type) {
        case TradeableItemType.Money:
            str1 = gameText('Trade Description Money', fmt(typeof item.item === 'number' ? item.item : 0));
            break;
        case TradeableItemType.Colony: {
            const habitat1 = item.item as Habitat;
            const systemStar = galaxy.determineHabitatSystemStar(habitat1);
            str1 = gameText('Trade Description Colony NAME PLANETTYPE SYSTEMNAME', habitat1.name, habitatTypeDescription(habitat1.type), systemStar.name);
            break;
        }
        case TradeableItemType.Base: {
            // TODO(port): "Trade Description Base With Sector" also names Galaxy.ResolveSectorDescriptionStatic(x, y).
            const bo = item.item as BuiltObject;
            str1 = gameText('Trade Description Base', bo.name, bo.nearestSystemStar?.name ?? '');
            break;
        }
        case TradeableItemType.TerritoryMap:
            str1 = 'Trade Description Territory Map';
            break;
        case TradeableItemType.GalaxyMap:
            str1 = 'Trade Description Galaxy Map';
            break;
        case TradeableItemType.AdoptGovernmentStyle:
            str1 = gameText('Trade Description AdoptGovernmentStyle', String((item.item as { name?: string } | null)?.name ?? ''));
            break;
        case TradeableItemType.ThreatenWar:
            str1 = 'Trade Description Threaten War';
            break;
        case TradeableItemType.DeclareWarOther:
            str1 = gameText('Trade Description Declare War Other', e?.name ?? '');
            break;
        case TradeableItemType.ThreatenTradeSanctions:
            str1 = 'Trade Description Threaten Trade Sanctions';
            break;
        case TradeableItemType.InitiateTradeSanctionsOther:
            str1 = gameText('Trade Description Trade Sanctions Other', e?.name ?? '');
            break;
        case TradeableItemType.EndWar:
            str1 = 'Trade Description End War You';
            break;
        case TradeableItemType.EndWarOther:
            str1 = gameText('Trade Description End War Other', e?.name ?? '');
            break;
        case TradeableItemType.LiftTradeSanctions:
            str1 = 'Trade Description Lift Trade Sanctions You';
            break;
        case TradeableItemType.LiftTradeSanctionsOther:
            str1 = gameText('Trade Description Lift Trade Sanctions Other', e?.name ?? '');
            break;
        case TradeableItemType.ResearchProject:
            str1 = isTechNode(item.item) ? item.item.def.name : '';
            break;
        case TradeableItemType.ContactEmpire:
            str1 = e?.name ?? '';
            break;
        case TradeableItemType.SecretLocation:
            if (showSecretLocationNames) {
                if (item.item instanceof GalaxyLocation || item.item instanceof Habitat) str1 = item.item.name;
            } else {
                str1 = 'Secret Location';
            }
            break;
        case TradeableItemType.SystemMap:
            if (item.item instanceof Habitat) str1 = gameText('Trade Description System Map', item.item.name);
            break;
        case TradeableItemType.IndependentColonyLocation:
            if (item.item instanceof Habitat) str1 = item.item.name;
            break;
    }
    if (
        showValue &&
        item.type !== TradeableItemType.Money &&
        item.type !== TradeableItemType.TerritoryMap &&
        item.type !== TradeableItemType.GalaxyMap &&
        item.type !== TradeableItemType.ThreatenWar &&
        item.type !== TradeableItemType.ThreatenTradeSanctions
    ) {
        return { text: str1, value: item.value };
    }
    return { text: str1, value: null };
}

/** A tree / list entry's text: `text` is a GameText key (+ args, gameText() encoding; resolveGameText for display) or a
 *  literal name; `value`, when set, is shown after it as " (###,###,##0)". */
export interface TradeLabel {
    text: string;
    value: number | null;
}

/** The display string of a label once `text` is resolved: `text (value)`. */
export function formatTradeLabel(resolvedText: string, label: TradeLabel): string {
    return label.value === null ? resolvedText : `${resolvedText} (${fmt(label.value)})`;
}

// ---------------------------------------------------------------------------------------------------------------
// The two DiplomacyTradeTree controls.
// ---------------------------------------------------------------------------------------------------------------

/** DiplomacyTradeTree.cs state: the items `empire` can give `otherEmpire` and the ones picked for this deal. */
export interface TradeTree {
    /** The giving empire (DiplomacyTradeTree._Empire). */
    empire: Empire;
    otherEmpire: Empire;
    allowDiplomaticThreats: boolean;
    refactorValuesForEmpire: boolean;
    /** _TradeableItems (Reset). */
    tradeableItems: TradeableItem[];
    /** _SelectedItems: the offered list (required items first). */
    selected: TradeableItem[];
    /** _RequiredItems: selected and not removable. */
    required: TradeableItem[];
    /** _ExcludedItems: hidden from the tradeable list. */
    excluded: TradeableItem[];
}

export type TradeNegotiationKind = 'trade' | 'end-war' | 'lift-sanctions';

export interface TradeNegotiation {
    player: Empire;
    other: Empire;
    kind: TradeNegotiationKind;
    /** ctlDiplomacyTradeUs: what the player gives. */
    us: TradeTree;
    /** ctlDiplomacyTradeThem: what the other empire gives. */
    them: TradeTree;
}

/** DiplomacyTradeTree.cs:220 Reset: the tree's tradeable items (Galaxy.4.cs:4406 ResolveTradeableItems; includeAllItems
 *  for the player's own tree). */
function resolveTreeItems(galaxy: Galaxy, empire: Empire, otherEmpire: Empire, refactorValuesForEmpire: boolean): TradeableItem[] {
    return resolveTradeableItems(galaxy, empire, otherEmpire, false, refactorValuesForEmpire, empire === galaxy.playerEmpire);
}

/**
 * The tradeable items of each side as the trade screen binds them (Main.Part8.cs:505-508 DoBind + DiplomacyTradeTree.cs:220
 * Reset): `us` = what `player` can give `other` (ResolveTradeableItems(player, other, false, refactor false,
 * includeAllItems true)); `them` = what `other` can give `player` (ResolveTradeableItems(other, player, false,
 * refactor true, includeAllItems false): maps from attitude 5, techs from attitude 25 x difficulty, special techs from
 * 50 x difficulty — Galaxy.4.cs:4406). No galaxy.rnd.
 */
export function tradeableItems(galaxy: Galaxy, player: Empire, other: Empire): { us: TradeableItem[]; them: TradeableItem[] } {
    return { us: resolveTreeItems(galaxy, player, other, false), them: resolveTreeItems(galaxy, other, player, true) };
}

function newTree(galaxy: Galaxy, empire: Empire, otherEmpire: Empire, allowDiplomaticThreats: boolean, refactorValuesForEmpire: boolean): TradeTree {
    return {
        empire,
        otherEmpire,
        allowDiplomaticThreats,
        refactorValuesForEmpire,
        tradeableItems: resolveTreeItems(galaxy, empire, otherEmpire, refactorValuesForEmpire),
        selected: [],
        required: [],
        excluded: [],
    };
}

/** DiplomacyTradeTree.cs:153 SetSelectedItems(selectedItems, requiredItems, excludedItems). */
function setSelectedItems(tree: TradeTree, selectedItems: TradeableItem[] | null, requiredItems: TradeableItem[] | null, excludedItems: TradeableItem[] | null): void {
    tree.required = requiredItems ?? [];
    tree.excluded = excludedItems ?? [];
    tree.selected = [...tree.required, ...(selectedItems ?? [])];
}

/**
 * The negotiation a DEAL_BEGIN option opens (Main.Part10.cs:4324 → Main.Part8.cs:636 method_302 with the option's
 * RelatedInfo, Main.Part9.cs:229-252): both trees Reset; ending a war / lifting sanctions preselects the other empire's
 * EndWar / LiftTradeSanctions item (valued ValueEndWarAgainstUs / ValueLiftTradeSanctionsAgainstUs refactored for the
 * player) as a required item of their side and hides the player's own one. Null when the relation no longer fits `kind`
 * (the caller — listProposals — gates the rest).
 */
export function beginTradeNegotiation(galaxy: Galaxy, player: Empire, other: Empire, kind: TradeNegotiationKind): TradeNegotiation | null {
    const rel = obtainDiplomaticRelation(player, other);
    if (kind === 'end-war' && (rel.type !== DiplomaticRelationType.War || rel.locked)) return null;
    if (kind === 'lift-sanctions' && (rel.type !== DiplomaticRelationType.TradeSanctions || rel.locked)) return null;
    // Main.Part8.cs:505-508: ctlDiplomacyTradeThem.DoBind(other, player, threats false, refactor true); Us (player, other, true, false).
    const them = newTree(galaxy, other, player, false, true);
    const us = newTree(galaxy, player, other, true, false);
    if (kind === 'end-war') {
        // Main.Part9.cs:231-237.
        let value = valueEndWarAgainstUs(galaxy, other, player);
        value = refactorValueForEmpire(galaxy, value, player, other);
        setSelectedItems(them, null, [new TradeableItem(TradeableItemType.EndWar, other, value)], null);
        setSelectedItems(us, null, null, [new TradeableItem(TradeableItemType.EndWar, player, 0)]);
    } else if (kind === 'lift-sanctions') {
        // Main.Part9.cs:244-250.
        let value2 = valueLiftTradeSanctionsAgainstUs(galaxy, other, player);
        value2 = refactorValueForEmpire(galaxy, value2, player, other);
        setSelectedItems(them, null, [new TradeableItem(TradeableItemType.LiftTradeSanctions, other, value2)], null);
        setSelectedItems(us, null, null, [new TradeableItem(TradeableItemType.LiftTradeSanctions, player, 0)]);
    }
    return { player, other, kind, us, them };
}

/** One entry of a tree: a group heading with child items, or a single top-level item. */
export interface TradeTreeRow {
    item: TradeableItem;
    /** Tree node text. */
    label: TradeLabel;
}
export interface TradeTreeGroup {
    /** GameText key of the heading ("Money", "Research", ...) or of the single node. */
    heading: string;
    /** A single clickable node (maps, end war / lift sanctions with your empire, threats) rather than a group. */
    single: boolean;
    rows: TradeTreeRow[];
}

/** DiplomacyTradeTree.cs:732 FilterOutSelectedAndExcludedItems: a copy without the selected / excluded non-money items. */
function filterOutSelectedAndExcludedItems(tree: TradeTree): TradeableItem[] {
    const list = tree.tradeableItems.slice();
    const idx: number[] = [];
    for (const selectedItem of tree.selected) {
        if (selectedItem.type === TradeableItemType.Money) continue;
        const num = tradeableItemIndexOf(tree.tradeableItems, selectedItem);
        if (num >= 0) idx.push(num);
    }
    for (const excludedItem of tree.excluded) {
        if (excludedItem.type === TradeableItemType.Money) continue;
        const num2 = tradeableItemIndexOf(tree.tradeableItems, excludedItem);
        if (num2 >= 0) idx.push(num2);
    }
    idx.sort((a, b) => a - b);
    idx.reverse();
    for (const i of idx) list.splice(i, 1);
    return list;
}

/**
 * The tree's clickable items: DiplomacyTradeTree.cs:255 PopulateTradeableItems(FilterOutSelectedAndExcludedItems(...)),
 * in its node order. Territory and galaxy maps exclude each other once one is offered, as do the two threats; money
 * lines are only those the giver can spare (an AI keeps max(10,000, 10% of StateMoney)); only the first territory map,
 * galaxy map and system map are listed; threats only on the player's side (allowDiplomaticThreats).
 */
export function tradeTreeRows(galaxy: Galaxy, tree: TradeTree): TradeTreeGroup[] {
    const tradeable = filterOutSelectedAndExcludedItems(tree);
    // PopulateTradeableItems :261 excluded items (already filtered above for non-money; money matches on type).
    if (tree.excluded.length > 0) {
        const drop = tradeable.filter((t) => tradeableItemIndexOf(tree.excluded, t) >= 0);
        for (const d of drop) tradeable.splice(tradeable.indexOf(d), 1);
    }
    const removeFirst = (type: TradeableItemType): void => {
        const n = tradeableItemIndexOf(tradeable, new TradeableItem(type, null, 0));
        if (n >= 0) tradeable.splice(n, 1);
    };
    if (tree.selected.length > 0) {
        if (containsType(tree.selected, TradeableItemType.TerritoryMap)) removeFirst(TradeableItemType.GalaxyMap);
        else if (containsType(tree.selected, TradeableItemType.GalaxyMap)) removeFirst(TradeableItemType.TerritoryMap);
        if (containsType(tree.selected, TradeableItemType.ThreatenTradeSanctions)) removeFirst(TradeableItemType.ThreatenWar);
        else if (containsType(tree.selected, TradeableItemType.ThreatenWar)) removeFirst(TradeableItemType.ThreatenTradeSanctions);
    }
    const groups: TradeTreeGroup[] = [];
    const empire = tree.empire;
    const isPlayer = empire === galaxy.playerEmpire;
    // :311 Money (always shown).
    const num6 = isPlayer ? 0.0 : Math.max(10000.0, empire.stateMoney * 0.1);
    const money: TradeTreeRow[] = [];
    for (const t of tradeable) {
        if (t.type === TradeableItemType.Money && typeof t.item === 'number' && t.item <= empire.stateMoney - num6) {
            money.push({ item: t, label: { text: gameText('X credits', fmt(t.item)), value: null } });
        }
    }
    groups.push({ heading: 'Money', single: false, rows: money });
    const group = (heading: string, type: TradeableItemType, label: (t: TradeableItem) => TradeLabel): void => {
        const rows = tradeable.filter((t) => t.type === type).map((t) => ({ item: t, label: label(t) }));
        if (rows.length > 0) groups.push({ heading, single: false, rows });
    };
    const firstSingle = (type: TradeableItemType, label: (t: TradeableItem) => TradeLabel): void => {
        const t = tradeable.find((x) => x.type === type);
        if (t !== undefined) groups.push({ heading: label(t).text, single: true, rows: [{ item: t, label: label(t) }] });
    };
    const valued = (text: string, t: TradeableItem): TradeLabel => ({ text, value: t.value });
    group('Disputed Colonies', TradeableItemType.Colony, (t) => {
        const habitat = t.item as Habitat;
        const habitat2 = galaxy.determineHabitatSystemStar(habitat);
        return valued(gameText('Trade Description Colony NAME PLANETTYPE SYSTEMNAME', habitat.name, habitatTypeDescription(habitat.type), habitat2.name), t);
    });
    group('Disputed Bases', TradeableItemType.Base, (t) => {
        const bo = t.item as BuiltObject;
        return valued(gameText('Trade Description Base', bo.name, bo.nearestSystemStar?.name ?? ''), t);
    });
    firstSingle(TradeableItemType.TerritoryMap, (t) => valued('Trade Description Territory Map', t));
    firstSingle(TradeableItemType.GalaxyMap, (t) => valued('Trade Description Galaxy Map', t));
    group('Communications with Unknown Empires', TradeableItemType.ContactEmpire, (t) => valued((t.item as Empire).name, t));
    firstSingle(TradeableItemType.SystemMap, (t) => valued(gameText('Trade Description System Map', (t.item as Habitat).name), t));
    group('Locations of Independent Colonies', TradeableItemType.IndependentColonyLocation, (t) => valued((t.item as Habitat).name, t));
    group('Secret Locations', TradeableItemType.SecretLocation, (t) => {
        let text3 = t.item instanceof GalaxyLocation || t.item instanceof Habitat ? t.item.name : '';
        if (tree.otherEmpire === galaxy.playerEmpire) text3 = 'Secret Location';
        return valued(text3, t);
    });
    group('Research', TradeableItemType.ResearchProject, (t) => valued(isTechNode(t.item) ? t.item.def.name : '', t));
    group('Declare War on...', TradeableItemType.DeclareWarOther, (t) => valued((t.item as Empire).name, t));
    group('Initiate Trade Sanctions against...', TradeableItemType.InitiateTradeSanctionsOther, (t) => valued((t.item as Empire).name, t));
    group('End War with...', TradeableItemType.EndWarOther, (t) => valued((t.item as Empire).name, t));
    group('Lift Trade Sanctions against...', TradeableItemType.LiftTradeSanctionsOther, (t) => valued((t.item as Empire).name, t));
    // :636-657 single nodes (the node text carries no value).
    const singles = (heading: string, type: TradeableItemType): void => {
        for (const t of tradeable) if (t.type === type) groups.push({ heading, single: true, rows: [{ item: t, label: { text: heading, value: null } }] });
    };
    singles('Lift Trade Sanctions against Your Empire', TradeableItemType.LiftTradeSanctions);
    singles('End War with Your Empire', TradeableItemType.EndWar);
    if (tree.allowDiplomaticThreats) {
        singles('Threaten Trade Sanctions unless you agree', TradeableItemType.ThreatenTradeSanctions);
        singles('Threaten War unless you agree', TradeableItemType.ThreatenWar);
    }
    return groups;
}

/**
 * DiplomacyTradeTree.cs:898 TradeableItems_MouseClick on an item: add it to the offered list. Money accumulates into one
 * entry and is capped at what the giver can spare (an AI keeps max(20,000, 30% of StateMoney); the player may give all).
 * `item` must be one of tradeTreeRows(tree)'s items. Returns whether the list changed.
 */
export function addTradeItem(galaxy: Galaxy, tree: TradeTree, item: TradeableItem): boolean {
    const visible = tradeTreeRows(galaxy, tree).some((g) => g.rows.some((r) => r.item === item));
    if (!visible) return false;
    const empire = tree.empire;
    let num = tradeableItemIndexOf(tree.selected, item);
    if (item.type === TradeableItemType.AdoptGovernmentStyle) num = findAnyGovernmentStyle(tree.selected);
    let num2 = Math.max(20000.0, empire.stateMoney * 0.3);
    if (empire === galaxy.playerEmpire) num2 = 0.0;
    if (num < 0) {
        if (item.type === TradeableItemType.Money && typeof item.item === 'number') {
            if (empire.stateMoney - num2 >= item.item) {
                tree.selected.push(item);
            } else if (empire.stateMoney - num2 > 0.0) {
                const num3 = Math.trunc(empire.stateMoney - num2);
                tree.selected.push(new TradeableItem(TradeableItemType.Money, num3, valueMoney(num3)));
            } else {
                return false;
            }
        } else {
            tree.selected.push(item);
        }
        return true;
    }
    if (item.type === TradeableItemType.AdoptGovernmentStyle) {
        tree.selected[num] = item;
        return true;
    }
    const cur = tree.selected[num];
    if (item.type === TradeableItemType.Money && typeof cur.item === 'number' && typeof item.item === 'number') {
        let num4 = cur.item + item.item;
        if (num4 > empire.stateMoney - num2) num4 = Math.trunc(empire.stateMoney - num2);
        tree.selected[num] = new TradeableItem(TradeableItemType.Money, num4, valueMoney(num4));
        return true;
    }
    return false;
}

/** DiplomacyTradeTree.cs:1020 SelectedItems_MouseClick: drop an offered item (not a required one). */
export function removeTradeItem(tree: TradeTree, index: number): boolean {
    if (index < 0 || index >= tree.selected.length || tree.required.includes(tree.selected[index])) return false;
    tree.selected.splice(index, 1);
    return true;
}

/** DiplomacyTradeTree.cs:1033 btnClearSelectedItems_Click ("Clear Offered Items"): back to the required items. */
export function clearTradeItems(tree: TradeTree): void {
    tree.selected = [...tree.required];
}

/** DiplomacyTradeTree.cs:250 UpdateOfferedItemsHeading: "Offered Items (<TotalValue>)". */
export function offeredItemsValue(tree: TradeTree): number {
    return tradeableItemsTotalValue(tree.selected);
}

// ---------------------------------------------------------------------------------------------------------------
// Proposing the deal (Main.Part10.cs:4334 DEAL_OFFER).
// ---------------------------------------------------------------------------------------------------------------

export interface TradeOfferResult {
    /** False when the deal is no longer possible (an item gone, money spent, the relation changed). */
    ok: boolean;
    response: TradeOfferResponse;
    /** Both lists changed hands (Accept / AcceptUnfair). */
    accepted: boolean;
    /** The reply's DialogPartType (dialog/*.txt key); null when !ok. */
    reply: DialogPartType | null;
    replyArgs: string[];
    /** For a refused submit: why. */
    message: string;
    /** The conversation option offered next ("Would you accept this trade?" / "How about this trade then?", Main.Part9.cs
     *  305-332); '' when the negotiation is over. */
    nextOptionLabel: string;
    /** DiplomaticMessageQueue.ExpireDiplomacyMessagesForEmpire target (a refused threat was carried out). */
    expireMessagesFor: Empire | null;
}

function refusedOffer(message: string): TradeOfferResult {
    return { ok: false, response: TradeOfferResponse.Undefined, accepted: false, reply: null, replyArgs: [], message, nextOptionLabel: '', expireMessagesFor: null };
}

/** Whether every picked item can still change hands (the original pauses the game during the conversation,
 *  Main.Part8.cs:456; here the sim may have moved on since the trees were built). */
function staleItem(galaxy: Galaxy, tree: TradeTree): TradeableItem | null {
    const fresh = resolveTreeItems(galaxy, tree.empire, tree.otherEmpire, tree.refactorValuesForEmpire);
    for (const t of tree.selected) {
        if (tree.required.includes(t)) continue;
        if (t.type === TradeableItemType.Money) {
            if (typeof t.item === 'number' && t.item > tree.empire.stateMoney) return t;
        } else if (tradeableItemIndexOf(fresh, t) < 0) {
            return t;
        }
    }
    return null;
}

/**
 * The player proposes the deal on the table: port of Main.Part10.cs:4334 case DEAL_OFFER (initiator = the player,
 * empire = the other empire) and the IL_10b3 tail (:5168). The other empire evaluates `us.selected` offered against
 * `them.selected` requested (EvaluateTradeOffer, disallowCriticalItems true); on Accept / AcceptUnfair every offered item
 * goes to them and every requested item to the player (GiveTradeableItem); on Refuse / RefuseUnfair a threat in the
 * offer is carried out (war declared / trade sanctions imposed). Replies: DEAL_ACCEPT, DEAL_ACCEPTCOMPLAIN, DEAL_IMPROVE,
 * DEAL_REJECT, DEAL_REJECTCOMPLAIN.
 */
export function submitTradeOffer(galaxy: Galaxy, negotiation: TradeNegotiation): TradeOfferResult {
    const initiator = negotiation.player;
    const empire = negotiation.other;
    if (!empire.active || initiator === empire) return refusedOffer('No longer on offer');
    if (negotiation.kind !== 'trade') {
        const rel = obtainDiplomaticRelation(initiator, empire);
        const want = negotiation.kind === 'end-war' ? DiplomaticRelationType.War : DiplomaticRelationType.TradeSanctions;
        if (rel.type !== want || rel.locked) return refusedOffer('No longer on offer');
    }
    const stale = staleItem(galaxy, negotiation.us) ?? staleItem(galaxy, negotiation.them);
    if (stale !== null) return refusedOffer('No longer on offer');

    const tradeableItemList = negotiation.us.selected;
    const tradeableItemList2 = negotiation.them.selected;
    const result: TradeOfferResult = { ok: true, response: TradeOfferResponse.Undefined, accepted: false, reply: null, replyArgs: [], message: '', nextOptionLabel: '', expireMessagesFor: null };
    const tradeOfferResponse = evaluateTradeOffer(galaxy, empire, initiator, tradeableItemList, tradeableItemList2, true);
    result.response = tradeOfferResponse;
    switch (tradeOfferResponse) {
        case TradeOfferResponse.RefuseUnfair:
        case TradeOfferResponse.Refuse:
            if (empire !== galaxy.playerEmpire) {
                for (const item of tradeableItemList) {
                    if (item.type === TradeableItemType.ThreatenWar) {
                        if (initiator.pirateEmpireBaseHabitat === null && empire.pirateEmpireBaseHabitat === null) {
                            declareWar(galaxy, initiator, empire);
                            result.expireMessagesFor = empire;
                        }
                    } else if (item.type === TradeableItemType.ThreatenTradeSanctions && initiator.pirateEmpireBaseHabitat === null && empire.pirateEmpireBaseHabitat === null) {
                        const currentDiplomaticRelation = obtainDiplomaticRelation(initiator, empire);
                        changeDiplomaticRelation(galaxy, initiator, currentDiplomaticRelation, DiplomaticRelationType.TradeSanctions);
                        sendMessageToEmpire(initiator, empire, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.TradeSanctions, 'We terminate all trade with you effective immediately!');
                        result.expireMessagesFor = empire;
                    }
                }
            }
            break;
        case TradeOfferResponse.Accept:
        case TradeOfferResponse.AcceptUnfair:
            for (const item2 of tradeableItemList) giveTradeableItem(galaxy, initiator, empire, item2, tradeableItemList2);
            for (const item3 of tradeableItemList2) giveTradeableItem(galaxy, empire, initiator, item3, tradeableItemList);
            result.accepted = true;
            break;
    }
    // IL_10b3 (Main.Part10.cs:5168).
    switch (tradeOfferResponse) {
        case TradeOfferResponse.Accept:
            result.reply = 'DEAL_ACCEPT';
            break;
        case TradeOfferResponse.AcceptUnfair:
            result.reply = 'DEAL_ACCEPTCOMPLAIN';
            break;
        case TradeOfferResponse.PromptForImprovement:
            result.reply = 'DEAL_IMPROVE';
            result.nextOptionLabel = 'How about this trade then?'; // Main.Part9.cs:322
            break;
        case TradeOfferResponse.Refuse:
            result.reply = 'DEAL_REJECT';
            result.nextOptionLabel = 'Would you accept this trade?'; // Main.Part9.cs:328
            break;
        case TradeOfferResponse.RefuseUnfair:
            result.reply = 'DEAL_REJECTCOMPLAIN';
            result.nextOptionLabel = 'Would you accept this trade?';
            break;
    }
    reviewDesignsBuiltObjectsImprovedComponents(initiator);
    initiator.reviewResearchAbilities();
    reviewDesignsBuiltObjectsImprovedComponents(empire);
    empire.reviewResearchAbilities();
    result.message = result.reply ?? '';
    return result;
}

// ---------------------------------------------------------------------------------------------------------------
// "Swap maps or tech" (OFFER_DEAL).
// ---------------------------------------------------------------------------------------------------------------

export interface OfferDealOption {
    /** 'OFFER_DEAL_TERRITORYMAP' | 'OFFER_DEAL_GALAXYMAP' | 'OFFER_DEAL_COMPONENT:<ResearchNodeId>'. */
    id: string;
    part: 'OFFER_DEAL_TERRITORYMAP' | 'OFFER_DEAL_GALAXYMAP' | 'OFFER_DEAL_COMPONENT';
    /** ConversationOption.Text (GameText key + args, gameText() encoding). */
    label: string;
    /** ConversationOption.RelatedInfo. */
    item: TradeableItem;
    /** ConversationOption.Cost. */
    cost: number;
}

/**
 * Main.Part9.cs:273 case OFFER_DEAL_RESPONSE: the quick offers after "Swap maps or tech" — swap territory maps (valued
 * ValueTerritoryMapForEmpire(player, other)), swap galaxy maps (ValueGalaxyMapForEmpire), and sell up to three of the
 * player's techs from ResolveTradeableItems(player, other, false, refactor false). No galaxy.rnd.
 */
export function offerDealOptions(galaxy: Galaxy, player: Empire, other: Empire): OfferDealOption[] {
    const list: OfferDealOption[] = [];
    const num4 = valueTerritoryMapForEmpire(galaxy, player, other);
    const num5 = valueGalaxyMapForEmpire(galaxy, player, other);
    const tradeableItemList = resolveTradeableItems(galaxy, player, other, false, false);
    list.push({ id: 'OFFER_DEAL_TERRITORYMAP', part: 'OFFER_DEAL_TERRITORYMAP', label: 'Swap Territory maps (empire systems)', item: new TradeableItem(TradeableItemType.TerritoryMap, null, num4), cost: num4 });
    list.push({ id: 'OFFER_DEAL_GALAXYMAP', part: 'OFFER_DEAL_GALAXYMAP', label: 'Swap Galaxy maps (all exploration)', item: new TradeableItem(TradeableItemType.GalaxyMap, null, num5), cost: num5 });
    let num6 = 0;
    for (const item6 of tradeableItemList) {
        if (num6 < 3 && item6.type === TradeableItemType.ResearchProject && isTechNode(item6.item)) {
            const researchNode = item6.item;
            const text = gameText('Sell TECH for X credits', researchNode.def.name, fmt(item6.value));
            list.push({ id: `OFFER_DEAL_COMPONENT:${researchNode.def.projectId}`, part: 'OFFER_DEAL_COMPONENT', label: text, item: item6, cost: item6.value });
            num6++;
        }
    }
    return list;
}

export interface OfferDealResult {
    ok: boolean;
    accepted: boolean;
    /** DEAL_ACCEPT / DEAL_REJECT (ReroutedType = the offer, so no further options: Main.Part9.cs:326). */
    reply: DialogPartType | null;
    message: string;
}

/**
 * The player picks one of offerDealOptions' offers: Main.Part10.cs:4230-4323 method_237 (initiator = player, empire =
 * other). Maps: the other empire agrees per DetermineAcceptTerritoryMapTrade / DetermineAcceptGalaxyMapTrade (Empire.7.cs
 * 2758 / 2824) and both sides get the map. Tech: the buyer pays the price if it is within its StateMoney (one
 * Rnd.NextDouble drawn, :4296) and gets the breakthrough; the player earns the price (PirateEconomy SellInfo).
 * The option is re-resolved against the current state (ok = false when no longer offered).
 */
export function submitOfferDeal(galaxy: Galaxy, player: Empire, other: Empire, option: OfferDealOption | string): OfferDealResult {
    const id = typeof option === 'string' ? option : option.id;
    const chosen = offerDealOptions(galaxy, player, other).find((o) => o.id === id);
    if (chosen === undefined) return { ok: false, accepted: false, reply: null, message: 'No longer on offer' };
    const initiator = player;
    const empire = other;
    let accepted = false;
    switch (chosen.part) {
        case 'OFFER_DEAL_TERRITORYMAP': {
            // Main.Part10.cs:4230.
            const tradeableItem2 = chosen.item;
            if (determineAcceptTerritoryMapTrade(galaxy, empire, tradeableItem2.value, initiator)) {
                const habitatList = determineEmpireSystems(galaxy, initiator);
                const habitatList2 = determineEmpireSystems(galaxy, empire);
                for (let i = 0; i < habitatList.length; i++) {
                    const systemStar = habitatList[i];
                    if (!empire.visibility.checkSystemExplored(systemStar.systemIndex)) empire.visibility.setSystemVisibility(systemStar, SystemVisibilityStatus.Explored);
                }
                for (let j = 0; j < habitatList2.length; j++) {
                    const systemStar2 = habitatList2[j];
                    if (!initiator.visibility.checkSystemExplored(systemStar2.systemIndex)) initiator.visibility.setSystemVisibility(systemStar2, SystemVisibilityStatus.Explored);
                }
                accepted = true;
            }
            break;
        }
        case 'OFFER_DEAL_GALAXYMAP': {
            // Main.Part10.cs:4268.
            const tradeableItem = chosen.item;
            if (determineAcceptGalaxyMapTrade(galaxy, empire, tradeableItem.value, initiator)) {
                mergeGalaxyMap(galaxy, initiator, empire);
                mergeGalaxyMap(galaxy, empire, initiator);
                accepted = true;
            }
            break;
        }
        case 'OFFER_DEAL_COMPONENT': {
            // Main.Part10.cs:4287.
            const tradeableItem3 = chosen.item;
            if (tradeableItem3.value <= empire.stateMoney) {
                const num5 = empire.stateMoney * (0.25 + galaxy.rnd.nextDouble() * 0.25);
                if (empire.stateMoney >= num5 && isTechNode(tradeableItem3.item)) {
                    const equivalent = techTreeGetEquivalent(empire.research.techTree, tradeableItem3.item);
                    if (equivalent !== null && !equivalent.isResearched) {
                        doResearchBreakthrough(galaxy, empire, equivalent, false, true, false);
                        empire.stateMoney -= tradeableItem3.value;
                        initiator.stateMoney += tradeableItem3.value;
                        initiator.pirateEconomy.performIncome(tradeableItem3.value, PirateIncomeType.SellInfo, galaxyStarDate(galaxy));
                        accepted = true;
                    }
                }
            }
            break;
        }
    }
    const reply: DialogPartType = accepted ? 'DEAL_ACCEPT' : 'DEAL_REJECT';
    return { ok: true, accepted, reply, message: reply };
}
