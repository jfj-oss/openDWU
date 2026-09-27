// 19d3 — espionage crisis actions (tasks/19d3-espionage-consequences.md §A3, §5). Not a port; each returns
// `{ ok, reason? }` and draws nothing. They reuse the ported mechanics: CancelIntelligenceMission (Empire.6.cs 90) +
// `Mission = null` as CharacterMission.cs btnCancelMission_Click, the CivilityRating setter (Empire.cs 1430),
// GiveTradeableItem(Money) (Galaxy.4.cs 3857), and the player's diplomacy proposals (Main.Part10.cs 4591
// TRADESANCTIONS_IMPOSE / 4649 WAR_DECLARE) for the player's own sanctions / war.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { getEmpireCharacters, CharacterRole } from '../../characters';
import { IntelligenceMissionType, cancelIntelligenceMission, characterMission } from '../../espionage';
import { obtainDiplomaticRelation, DiplomaticRelationType } from '../../diplomacy';
import { applyReputation } from '../reputation/ledger';
import { setCivilityRating } from '../../diplomacyTick';
import { TradeableItem, TradeableItemType, giveTradeableItem } from '../../tradeItems';
import { submitProposal } from '../../player/diplomacyProposals';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioMessage, scenarioText } from '../messages';
import type { SpyCrisis } from './espionage';

export interface ActionResult {
    ok: boolean;
    reason?: string;
}

/** Ends the crisis (stage resolved) and tells both sides. */
export function resolveCrisis(galaxy: Galaxy, c: SpyCrisis, how: string, good: boolean): void {
    c.stage = 'resolved';
    c.awaiting = null;
    c.resolution = how;
    c.resolvedStarDate = galaxyStarDate(galaxy);
    const text = scenarioText('Emergent Spy Crisis Resolved', c.offender.name, c.victim.name, how);
    const type = good ? EmpireMessageType.GeneralGoodEvent : EmpireMessageType.GeneralNeutralEvent;
    scenarioMessage(galaxy, c.offender, scenarioText('Emergent Spy Crisis Title', c.victim.name), text, { type, subject: c.victim });
    scenarioMessage(galaxy, c.victim, scenarioText('Emergent Spy Crisis Title', c.offender.name), text, { type, subject: c.offender });
}

/** The offender refuses (or ignores) the demand; escalation happens at the deadline. */
export function refuseCrisis(galaxy: Galaxy, c: SpyCrisis): void {
    c.response = 'refused';
    scenarioMessage(galaxy, c.victim, scenarioText('Emergent Spy Crisis Title', c.offender.name), scenarioText('Emergent Spy Crisis Refused', c.offender.name, scenarioText('Emergent Demand ' + (c.demand === 'recall' ? 'Recall' : c.demand === 'apology' ? 'Apology' : 'Reparations'), c.amount.toLocaleString('en-US'))), {
        type: EmpireMessageType.GeneralWarning,
        subject: c.offender,
        sender: c.offender,
    });
}

/** §A3 recall: cancel every mission of the offender against the victim (CancelIntelligenceMission, Mission = null). */
export function complyRecall(galaxy: Galaxy, offender: Empire, c: SpyCrisis): ActionResult {
    if (c.stage === 'resolved' || offender !== c.offender) return { ok: false, reason: 'no open crisis' };
    for (const ch of getEmpireCharacters(offender)) {
        if (ch === null || ch.role !== CharacterRole.IntelligenceAgent) continue;
        const m = characterMission(ch);
        if (m === null || m.type === IntelligenceMissionType.Undefined || m.type === IntelligenceMissionType.CounterIntelligence || m.targetEmpire !== c.victim) continue;
        cancelIntelligenceMission(offender, m);
        ch.mission = null;
    }
    c.response = 'complied';
    resolveCrisis(galaxy, c, scenarioText('Emergent Resolution Recall'), true);
    return { ok: true };
}

/** §A3 apology: offender civility −2, the victim's incident with the offender +severity/2. */
export function complyApology(galaxy: Galaxy, offender: Empire, c: SpyCrisis): ActionResult {
    if (c.stage === 'resolved' || offender !== c.offender) return { ok: false, reason: 'no open crisis' };
    setCivilityRating(offender, offender.civilityRating - 2);
    applyReputation(galaxy, c.victim, offender, c.severity / 2, { cause: 'espionage.apology', source: '19d3' });
    c.response = 'complied';
    resolveCrisis(galaxy, c, scenarioText('Emergent Resolution Apology'), true);
    return { ok: true };
}

/** §A3 reparations: the amount moves as a Money trade item (fails without the money). */
export function complyReparations(galaxy: Galaxy, offender: Empire, c: SpyCrisis): ActionResult {
    if (c.stage === 'resolved' || offender !== c.offender) return { ok: false, reason: 'no open crisis' };
    if (offender.stateMoney < c.amount) return { ok: false, reason: 'not enough money' };
    const item = new TradeableItem(TradeableItemType.Money, c.amount, c.amount);
    giveTradeableItem(galaxy, offender, c.victim, item, [item]);
    c.response = 'complied';
    resolveCrisis(galaxy, c, scenarioText('Emergent Resolution Reparations', c.amount.toLocaleString('en-US')), true);
    return { ok: true };
}

/** The player's sanctions over a crisis: the diplomacy screen's TRADESANCTIONS_IMPOSE proposal. */
export function playerImposeSanctions(galaxy: Galaxy, player: Empire, other: Empire): ActionResult {
    const rt = obtainDiplomaticRelation(player, other).type;
    if (rt === DiplomaticRelationType.TradeSanctions || rt === DiplomaticRelationType.War) return { ok: true };
    const r = submitProposal(galaxy, player, other, 'TRADESANCTIONS_IMPOSE');
    return r.ok ? { ok: true } : { ok: false, reason: r.message };
}

/** The player's war over a crisis: the diplomacy screen's WAR_DECLARE proposal. */
export function playerDeclareWar(galaxy: Galaxy, player: Empire, other: Empire): ActionResult {
    if (obtainDiplomaticRelation(player, other).type === DiplomaticRelationType.War) return { ok: true };
    const r = submitProposal(galaxy, player, other, 'WAR_DECLARE');
    return r.ok ? { ok: true } : { ok: false, reason: r.message };
}
