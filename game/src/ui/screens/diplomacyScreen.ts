// Diplomacy screen (task 15a): a streamlined Diplomacy panel opened with F5.
// One row per empire the player has met; the selected row shows the current
// relation, the treaty on offer (Accept Offer / Decline), the player's own
// outgoing offer, the player's automated strategy, side treaties and how that
// empire feels about the player with its factor breakdown.
// Sources:
// - DistantWorlds.Controls/Controls/EmpireDetailView.cs:573-608 (relation +
//   colour), :639-706 (treaty on offer), :733-757 (attitude block), :803
//   btnEmpireDetailAcceptTreaty_Click (accept);
// - DistantWorlds.Types/Empire.4.cs:55 ResolveFeelingDescription;
// - DistantWorlds.Types/Empire.7.cs:4164 DetermineEmpireRelationshipFactors;
// - DistantWorlds.Types/Empire.10.cs:681 CivilityDescription;
// - DistantWorlds/Main.Part10.cs:3930 method_235 (remove a proposal / decline).
// This is not the original 1:1 EmpireDetailView: no race portrait, no
// ambassador card, no conversation dialogs, no trade screen.
// TODO(port): proposing treaties from the player (Main.Part2.cs:1935 conversation path), pirate relations (Empire.7.cs:4270 pirate branch), ambassador card (EmpireDetailView.cs:613) — not in 15a

import './diplomacyScreen.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { EmpireMessage } from '../../sim/messages';
import { getGovernmentsStatic } from '../../sim/empire';
import {
    DiplomaticRelation,
    DiplomaticRelationType,
    DiplomaticStrategy,
    empireEvaluationByEmpire,
    empireEvaluationsOf,
} from '../../sim/diplomacy';
import {
    cancelBlockades,
    changeDiplomaticRelation,
    determineDesiredDiplomaticRelationTypical,
    processEndOfWarWithEmpire,
    resetAttitudeLevelsAtEndOfWar,
} from '../../sim/diplomacyTick';
import { galaxyStarDate } from '../../sim/tick/simTime';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../../sim/galaxyTime';
import { EmpireMessageType, empireMessages } from '../../sim/messages';
import { showToast } from '../toast';

/** EmpireDetailView relation colours (_NotMetColor … _TruceColor). */
export const RELATION_COLORS: Record<DiplomaticRelationType, number> = {
    [DiplomaticRelationType.NotMet]: 0xd2b48c, // Color.Tan
    [DiplomaticRelationType.None]: 0x808080,
    [DiplomaticRelationType.FreeTradeAgreement]: 0x00ff00,
    [DiplomaticRelationType.MutualDefensePact]: 0x4040e8,
    [DiplomaticRelationType.SubjugatedDominion]: 0xffff00, // Color.Yellow
    [DiplomaticRelationType.Protectorate]: 0x7070ff,
    [DiplomaticRelationType.TradeSanctions]: 0xffa500, // Color.Orange
    [DiplomaticRelationType.War]: 0xff0000,
    [DiplomaticRelationType.Truce]: 0xffff00, // Color.Yellow
};

/** Galaxy.2.cs:2488 ResolveDescription(DiplomaticRelationType) (GameText.txt:1860-1868). */
export function relationTypeLabel(type: DiplomaticRelationType): string {
    switch (type) {
        case DiplomaticRelationType.NotMet: return 'Not Met';
        case DiplomaticRelationType.None: return 'No relationship';
        case DiplomaticRelationType.FreeTradeAgreement: return 'Free Trade Agreement';
        case DiplomaticRelationType.MutualDefensePact: return 'Mutual Defense Pact';
        case DiplomaticRelationType.SubjugatedDominion: return 'Subjugated Dominion';
        case DiplomaticRelationType.Protectorate: return 'Protectorate';
        case DiplomaticRelationType.TradeSanctions: return 'Trade Sanctions';
        case DiplomaticRelationType.War: return 'War';
        case DiplomaticRelationType.Truce: return 'Truce';
    }
    return '';
}

/** EmpireDetailView.cs:573-608 text11: the label plus the Subjugated / Protectorate suffix. */
export function relationDescription(rel: DiplomaticRelation, player: Empire): string {
    let text = relationTypeLabel(rel.type);
    switch (rel.type) {
        case DiplomaticRelationType.SubjugatedDominion:
            text = rel.initiator !== player ? `${text} (They subjugate us)` : `${text} (We subjugate them)`;
            break;
        case DiplomaticRelationType.Protectorate:
            text = rel.initiator !== player ? `${text} (They protect us)` : `${text} (We protect them)`;
            break;
    }
    return text;
}

/** Empire.4.cs:55 ResolveFeelingDescription (sequential ifs; later ones overwrite). */
export function feelingDescription(overallAttitude: number): string {
    let result = '';
    if (overallAttitude <= -45) result = 'Furious';
    if (overallAttitude >= -44 && overallAttitude <= -20) result = 'Angry';
    if (overallAttitude >= -19 && overallAttitude <= -5) result = 'Annoyed';
    if (overallAttitude >= -4 && overallAttitude <= 7) result = 'Cautious';
    if (overallAttitude >= 8 && overallAttitude <= 20) result = 'Pleased';
    if (overallAttitude >= 21 && overallAttitude <= 44) result = 'Friendly';
    if (overallAttitude >= 45) result = 'Delighted';
    return result;
}

/** Empire.10.cs:681 CivilityDescription (if / else if chain verbatim). */
export function civilityDescription(rating: number): string {
    if (rating < -50.0) return 'Diabolical';
    else if (rating >= -50.0 && rating <= -30.0) return 'Evil';
    else if (rating >= -30.0 && rating <= -20.0) return 'Notorious';
    else if (rating >= -20.0 && rating <= -10.0) return 'Nasty';
    else if (rating >= -10.0 && rating <= -1.0) return 'Dubious';
    else if (rating >= -1.0 && rating <= 4.0) return 'Satisfactory';
    else if (rating >= 4.0 && rating <= 10.0) return 'Respectable';
    else if (rating >= 10.0 && rating <= 16.0) return 'Admired';
    else if (rating >= 16.0 && rating <= 22.0) return 'Noble';
    else if (rating > 22.0) return 'Heroic';
    return '';
}

/** C# ToString("+0;-0;0"): round half away from zero, then '+N', '-N' or '0'. */
export function formatSigned(v: number): string {
    const n = Math.sign(v) * Math.round(Math.abs(v));
    if (n > 0) return `+${n}`;
    if (n < 0) return `-${-n}`;
    return '0';
}

export interface RelationshipFactor {
    value: number;
    description: string;
}

/** Empire.7.cs:4164 DetermineEmpireRelationshipFactors, non-pirate branch
 * (`this` = the player, `otherEmpire` = the viewed empire). */
export function relationshipFactors(player: Empire, other: Empire, playerGovernmentName: string): RelationshipFactor[] {
    if (other.pirateEmpireBaseHabitat !== null || player.pirateEmpireBaseHabitat !== null) return [];
    const ev = empireEvaluationByEmpire(empireEvaluationsOf(other), player);
    if (ev === null) return [];
    const list: RelationshipFactor[] = [];
    const add = (value: number, description: string): void => {
        list.push({ value, description });
    };
    if (ev.firstContactPenalty < 0.0) add(ev.firstContactPenalty, 'Our ignorance of your strange alien ways causes us to distrust you');
    if (ev.militaryForcesInSystems < 0) add(ev.militaryForcesInSystems, 'Your military forces in our systems violate our territory');
    if (ev.relationshipWithFriendsPositiveCumulative > 0.0) add(ev.relationshipWithFriendsPositiveCumulative, 'You have formed beneficial treaties with our friends');
    if (ev.relationshipWithFriendsNegativeCumulative < 0.0) add(ev.relationshipWithFriendsNegativeCumulative, 'You have trade sanctions or are at war with our friends');
    if (ev.systemCompetitionCumulative < 0.0) add(ev.systemCompetitionCumulative, 'Your colonies and bases trespass in our systems!');
    const reputation = ev.reputationWeighted;
    if (reputation > 0.0) add(reputation, `We respect your good reputation (${civilityDescription(player.civilityRating)})`);
    else if (reputation < 0.0) add(reputation, `We are troubled by your poor reputation (${civilityDescription(player.civilityRating)})`);
    if (ev.tradeVolume > 0) {
        const tv = ev.tradeVolume;
        add(
            tv,
            tv > 20
                ? 'Our empires generate a colossal amount of trade'
                : tv > 13
                  ? 'Our empires produce a large amount of trade'
                  : tv <= 6
                    ? 'Our empires share a small volume of trade'
                    : 'Our empires share a fair amount of trade',
        );
    }
    if (ev.governmentStyleAffinityCumulative < 0.0) add(ev.governmentStyleAffinityCumulative, `We are unhappy with your style of government (${playerGovernmentName})`);
    if (ev.governmentStyleAffinityCumulative > 0.0) add(ev.governmentStyleAffinityCumulative, `We like your style of government (${playerGovernmentName})`);
    if (ev.covetousnessCumulative < 0.0) add(ev.covetousnessCumulative, 'We covet your colonies and resources...');
    if (ev.blockades < 0) add(ev.blockades, 'You have blockaded our colonies and space ports!');
    if (ev.biasRaw > 0.0) add(ev.biasRaw, 'We naturally like you');
    else if (ev.biasRaw < 0.0) add(ev.biasRaw, 'We instinctively dislike you');
    if (ev.envy < 0) add(ev.envy, 'We are envious of your huge strength and power');
    if (ev.restrictedResourceTrading < 0.0) add(ev.restrictedResourceTrading, 'We are upset that you refuse to trade valuable resources with us');
    if (ev.restrictedResourceTrading > 0.0) add(ev.restrictedResourceTrading, 'We are happy that you trade valuable resources with us');
    if (ev.militaryRefueling > 0) add(ev.militaryRefueling, 'We appreciate your help with military refueling');
    if (ev.miningRights > 0) add(ev.miningRights, 'We appreciate mining rights within your territory');
    if (ev.incidentEvaluationRaw < 0.0) add(ev.incidentEvaluationRaw, 'Our past dealings with you have been terrible');
    if (ev.incidentEvaluationRaw > 0.0) add(ev.incidentEvaluationRaw, 'Our past dealings with you have been good');
    if (ev.slaveryOffense < 0.0) add(ev.slaveryOffense, 'We are angry at your enslavement of our race at your colonies');
    if (ev.racialOffense < 0.0) add(ev.racialOffense, 'We are outraged at your extermination of our race at your colonies');

    const aggression = player.galaxy.aggressionLevel;
    for (const f of list) {
        if (f.value > 0.0) {
            f.value /= aggression;
            f.value *= ev.diplomacyFactor;
        } else {
            f.value *= aggression;
            f.value /= ev.diplomacyFactor;
        }
    }
    // C# list.Sort(); list.Reverse() → descending by value. .NET's List.Sort is
    // unstable for ties; Array.prototype.sort is stable, so tie order here is
    // insertion order (may differ from the original for equal values).
    list.sort((a, b) => b.value - a.value);
    return list;
}

/** EmpireDetailView.cs:639-706 flag3: is the other empire's offer still open?
 * The C# also removes invalid proposals while drawing; the panel does not (no
 * mutation on render). The sim's considerTreatyProposals clears them. */
export function isProposalValid(proposal: DiplomaticRelation, other: Empire, player: Empire, starDate: number): boolean {
    const validMs = Math.trunc(0.2 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000); // Galaxy.TreatyOfferValidYears (Galaxy.3.cs:5059)
    if (starDate > proposal.lastDiplomacyTradeOfferDate + validMs) return false;
    const theirs = other.diplomaticRelations.byEmpire(player);
    // A missing relation matches the fresh NotMet relation ObtainDiplomaticRelation would add.
    const strategy = theirs ? theirs.strategy : DiplomaticStrategy.Undefined;
    const type = theirs ? theirs.type : DiplomaticRelationType.NotMet;
    if (determineDesiredDiplomaticRelationTypical(strategy, type) !== proposal.type) return false;
    return true;
}

/** EmpireDetailView.cs:639-706 text14: the label of a treaty on offer. */
export function proposalLabel(proposalType: DiplomaticRelationType, current: DiplomaticRelation | null, player: Empire): string {
    const currentType = current ? current.type : DiplomaticRelationType.NotMet;
    switch (proposalType) {
        case DiplomaticRelationType.None:
            switch (currentType) {
                case DiplomaticRelationType.FreeTradeAgreement:
                case DiplomaticRelationType.MutualDefensePact:
                case DiplomaticRelationType.Protectorate:
                    return 'Cancelling Treaty';
                case DiplomaticRelationType.SubjugatedDominion:
                    if (current!.initiator === player) return 'Request release from Subjugation';
                    return 'Offering release from Subjugation';
                case DiplomaticRelationType.TradeSanctions:
                    return 'Lifting Trade Sanctions';
                case DiplomaticRelationType.War:
                    return 'Ending War';
                case DiplomaticRelationType.Truce:
                    return 'Peace Treaty';
            }
            return '';
        default:
            return relationTypeLabel(proposalType);
    }
}

export interface DiplomacyRow {
    empire: Empire;
    name: string;
    color: number;
    relationType: DiplomaticRelationType;
    relationText: string;
    relationColor: number;
    attitude: number | null;
    feeling: string;
    ourStrategy: string;
    treaties: string[];
    incoming: DiplomaticRelation | null;
    incomingText: string;
    incomingMessage: string;
    outgoing: DiplomaticRelation | null;
    outgoingText: string;
    factors: RelationshipFactor[];
}

function strategyLabel(strategy: DiplomaticStrategy): string {
    if (strategy === DiplomaticStrategy.Undefined) return '(None)';
    const name = DiplomaticStrategy[strategy] ?? '';
    return name.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Rows for the panel: every met, active, non-pirate, non-independent empire, sorted by name. */
export function diplomacyRows(player: Empire, starDate: number, playerGovernmentName: string): DiplomacyRow[] {
    const rels: DiplomaticRelation[] = [];
    for (const rel of player.diplomaticRelations) {
        if (rel.type === DiplomaticRelationType.NotMet) continue;
        const other = rel.otherEmpire;
        if (other === null || !other.active) continue;
        if (other === player.galaxy.independentEmpire) continue;
        if (other.pirateEmpireBaseHabitat !== null) continue;
        rels.push(rel);
    }
    rels.sort((a, b) => a.otherEmpire!.name.localeCompare(b.otherEmpire!.name));

    return rels.map((rel) => {
        const other = rel.otherEmpire!;
        const ev = empireEvaluationByEmpire(empireEvaluationsOf(other), player);
        const attitude = ev ? ev.overallAttitude : null;
        const feeling = ev && attitude !== null ? `${feelingDescription(attitude)} with us (${formatSigned(attitude)})` : '';
        const theirs = other.diplomaticRelations.byEmpire(player);

        const treaties: string[] = [];
        if (rel.militaryRefuelingToOther) treaties.push('We allow them military refueling');
        if (theirs?.militaryRefuelingToOther) treaties.push('They allow us military refueling');
        if (rel.miningRightsToOther) treaties.push('We grant them mining rights');
        if (theirs?.miningRightsToOther) treaties.push('They grant us mining rights');
        if (rel.supplyRestrictedResources) treaties.push('Restricted resources traded');

        let incoming = player.proposedDiplomaticRelations.byEmpire(other);
        if (incoming !== null && !isProposalValid(incoming, other, player, starDate)) incoming = null;
        let incomingText = '';
        let incomingMessage = '';
        if (incoming !== null) {
            incomingText = proposalLabel(incoming.type, rel, player);
            const msgs: EmpireMessage[] = empireMessages(player);
            for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if (m.sender === other && m.messageType === EmpireMessageType.ProposeDiplomaticRelation && m.subject === incoming.type) {
                    incomingMessage = m.description;
                    break;
                }
            }
        }

        const outgoing = other.proposedDiplomaticRelations.byEmpire(player);
        const outgoingText = outgoing !== null ? proposalLabel(outgoing.type, rel, player) : '';

        return {
            empire: other,
            name: other.name,
            color: other.mainColor,
            relationType: rel.type,
            relationText: relationDescription(rel, player),
            relationColor: RELATION_COLORS[rel.type],
            attitude,
            feeling,
            ourStrategy: strategyLabel(rel.strategy),
            treaties,
            incoming,
            incomingText,
            incomingMessage,
            outgoing,
            outgoingText,
            factors: relationshipFactors(player, other, playerGovernmentName),
        };
    });
}

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

/** The player's GovernmentAttributes.Name. */
export function playerGovernmentName(player: Empire): string {
    if (player.governmentId < 0) return '';
    return getGovernmentsStatic()[player.governmentId]?.name ?? '';
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export interface DiplomacyScreenOptions {
    player: Empire;
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Diplomacy screen, or close it if it is already open. */
export function toggleDiplomacyScreen(opts: DiplomacyScreenOptions): void {
    if (open) {
        open.close();
    } else {
        open = createDiplomacyScreen(opts);
    }
}

/** Close the Diplomacy screen (no-op when closed). */
export function closeDiplomacyScreen(): void {
    open?.close();
}

function rgb(c: number): string {
    return `rgb(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255})`;
}

const LIGHT_GREEN = '#90ee90';
const RED = '#ff0000';

function el(tag: string, className: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function createDiplomacyScreen(opts: DiplomacyScreenOptions): OpenState {
    const root = el('div', 'diplomacy-wrap');
    const win = el('div', 'diplomacy-window');

    const titlebar = el('div', 'diplomacy-titlebar');
    titlebar.appendChild(el('div', 'diplomacy-heading', 'Diplomacy'));
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'diplomacy-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = el('div', 'diplomacy-body');
    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    let selected: Empire | null = null;
    let listScroll = 0;
    let detailScroll = 0;

    function render(): void {
        const listPane = body.querySelector<HTMLElement>('.diplomacy-list');
        const detailPane = body.querySelector<HTMLElement>('.diplomacy-detail');
        if (listPane) listScroll = listPane.scrollTop;
        if (detailPane) detailScroll = detailPane.scrollTop;
        body.replaceChildren();

        const player = opts.player;
        const rows = diplomacyRows(player, galaxyStarDate(player.galaxy), playerGovernmentName(player));
        if (rows.length === 0) {
            body.classList.add('diplomacy-body-empty');
            body.appendChild(el('div', 'diplomacy-empty', 'No empires met yet'));
            return;
        }
        body.classList.remove('diplomacy-body-empty');
        let row = rows.find((r) => r.empire === selected);
        if (!row) {
            row = rows[0];
            selected = row.empire;
        }

        const list = el('div', 'diplomacy-list');
        for (const r of rows) {
            const line = el('div', r === row ? 'diplomacy-row diplomacy-row-selected' : 'diplomacy-row');
            const swatch = el('span', 'diplomacy-swatch');
            swatch.style.background = rgb(r.color);
            const name = el('span', 'diplomacy-name', r.name);
            name.title = r.name;
            const relation = el('span', 'diplomacy-relation', r.relationText);
            relation.style.color = rgb(r.relationColor);
            relation.title = r.relationText;
            const attitude = el('span', 'diplomacy-attitude', r.attitude !== null ? formatSigned(r.attitude) : '');
            if (r.attitude !== null) attitude.style.color = r.attitude < 0 ? RED : LIGHT_GREEN;
            line.append(swatch, name, relation, attitude);
            line.addEventListener('click', () => {
                selected = r.empire;
                detailScroll = 0;
                render();
            });
            list.appendChild(line);
        }

        const detail = el('div', 'diplomacy-detail');
        const title = el('div', 'diplomacy-detail-title');
        const tSwatch = el('span', 'diplomacy-swatch');
        tSwatch.style.background = rgb(row.color);
        title.append(tSwatch, el('span', 'diplomacy-detail-name', row.name));
        detail.appendChild(title);

        detail.appendChild(el('div', 'diplomacy-section-heading', 'Current Relationship With Us'));
        const relText = el('div', 'diplomacy-line', row.relationText);
        relText.style.color = rgb(row.relationColor);
        detail.appendChild(relText);

        detail.appendChild(el('div', 'diplomacy-section-heading', 'Treaty on Offer'));
        if (row.incoming) {
            detail.appendChild(el('div', 'diplomacy-line', row.incomingText));
            if (row.incomingMessage) detail.appendChild(el('div', 'diplomacy-message', row.incomingMessage));
            const buttons = el('div', 'diplomacy-buttons');
            const accept = el('button', 'diplomacy-button', 'Accept Offer') as HTMLButtonElement;
            accept.type = 'button';
            const decline = el('button', 'diplomacy-button', 'Decline') as HTMLButtonElement;
            decline.type = 'button';
            const other = row.empire;
            accept.addEventListener('click', () => {
                if (acceptProposal(player, other)) showToast('Treaty accepted');
                render();
            });
            decline.addEventListener('click', () => {
                declineProposal(player, other);
                render();
            });
            buttons.append(accept, decline);
            detail.appendChild(buttons);
        } else {
            detail.appendChild(el('div', 'diplomacy-line diplomacy-muted', '(none)'));
        }

        detail.appendChild(el('div', 'diplomacy-section-heading', 'Our offer to them'));
        detail.appendChild(
            row.outgoing
                ? el('div', 'diplomacy-line', row.outgoingText)
                : el('div', 'diplomacy-line diplomacy-muted', '(none)'),
        );

        detail.appendChild(el('div', 'diplomacy-line diplomacy-strategy', `Our strategy: ${row.ourStrategy}`));

        if (row.treaties.length > 0) {
            detail.appendChild(el('div', 'diplomacy-section-heading', 'Treaties'));
            const ul = el('ul', 'diplomacy-treaties');
            for (const t of row.treaties) ul.appendChild(el('li', 'diplomacy-treaty', t));
            detail.appendChild(ul);
        }

        if (row.feeling) {
            detail.appendChild(el('div', 'diplomacy-section-heading', 'Attitude'));
            const feeling = el('div', 'diplomacy-line diplomacy-feeling', row.feeling);
            if (row.attitude !== null) feeling.style.color = row.attitude < 0 ? RED : LIGHT_GREEN;
            detail.appendChild(feeling);
        }
        for (const f of row.factors) {
            const line = el('div', 'diplomacy-factor', `${f.description} (${formatSigned(f.value)})`);
            line.style.color = f.value < 0 ? RED : LIGHT_GREEN;
            detail.appendChild(line);
        }

        body.append(list, detail);
        list.scrollTop = listScroll;
        detail.scrollTop = detailScroll;
    }

    render();
    const timer = setInterval(render, 1000);

    function close(): void {
        clearInterval(timer);
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global
    // game-menu Escape handler (registered in createHud) from opening as well.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    return { root, close };
}
