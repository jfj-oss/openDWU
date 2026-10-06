// Smarter AI add-on: diplomacy with purpose (scenarios/smarter-ai, flag smarterAIDiplomacy). Not a port.
//
// Stock AI offers treaties from its per-empire strategy (diplomacyTick.ts reviewDiplomaticStrategies /
// implementDiplomaticStrategy, Empire.8.cs) and takes pirate protection on a cashflow rule
// (pirates/pirateRelationsAI.ts determineDesirePirateProtectionCore, Empire.2.cs 2754). For AI empires this package:
//   - every 90 days, when the empire faces a shared threat — a runaway empire (score at least RUNAWAY_FACTOR × its own)
//     or pirate pressure on its colonies — it courts the empires facing the same threat (the runaway's score also
//     RUNAWAY_FACTOR × theirs, or pressure from the same pirates): a free trade offer where there is no treaty, a mutual
//     defence offer over free trade; friendliest first, at most MAX_OFFERS a review, never to empires it plans to
//     conquer, undermine or punish. Only offers the empire itself would accept from that partner (offerIsGenuine: the
//     stock acceptance rule, DetermineDesiredDiplomaticRelationTypical of its strategy towards the partner, Empire.3.cs
//     ProcessProposals / Main.Part10.cs method_232) — a threat does not make it court an empire its strategy does not
//     want a treaty with. The stock offers (offerFreeTrade / offerMutualDefense: proposal spacing, automation) and the
//     receiver's stock evaluation decide the rest;
//   - wants a pirate faction's protection exactly when a year of it costs less than the losses expected without it:
//     pressure (pirate strength near its colonies / (that + its own mobile firepower)) × PIRATE_LOSS_SHARE × its
//     colonies' annual revenue (query pirateProtectionDesired; also drives the stock cancel review).
// The player can be a partner: the add-on steers AI empires only, and an offer to the player is a stock proposal the
// player answers. An offer to the player is made only when it is the exact treaty the empire's strategy wants
// (EmpireDetailView.cs:639-706 flag3, the rule the player's popup and diplomacy screen hold a proposal to), so it shows
// as an Accept / Decline conversation and the empire grants the same treaty when the player asks for it instead.
// No Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { DiplomaticRelationType, DiplomaticStrategy, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../diplomacy';
import { determineDesiredDiplomaticRelationTypical, offerFreeTrade, offerMutualDefense } from '../../diplomacyTick';
import { habitatAnnualRevenue, totalColonyStrategicValue, totalMobileMilitaryFirepower } from '../../forceStructure';
import { calculateAttackingFirepowerNearEmpireTargetsList, calculateDistanceToNearestColony, calculatePirateProtectionPricePerMonth } from '../../pirates/pirateRelationsAI';
import { registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { SMARTER_AI_FLAG, isSmarterAIStrategist, smarterAIOn } from './common';
import { SMARTER_AI_DIPLOMACY_FLAG } from './statecraft';

/** A runaway empire's score is at least this multiple of ours. */
export const RUNAWAY_FACTOR = 2;
/** Pirate pressure from which pirates are a threat worth an alliance. */
export const PIRATE_THREAT_PRESSURE = 0.25;
/** The share of a year's colony revenue lost at full pirate pressure. */
export const PIRATE_LOSS_SHARE = 0.3;
/** Treaty offers per empire per review. */
export const MAX_OFFERS = 2;

function on(galaxy: Galaxy, empire: Empire | null): empire is Empire {
    return smarterAIOn(galaxy, SMARTER_AI_DIPLOMACY_FLAG) && isSmarterAIStrategist(galaxy, empire);
}

/** Pirate strength bearing on the empire: its forces attacking near the empire, or its fleet scaled by base proximity. */
export function pirateStrengthNear(galaxy: Galaxy, empire: Empire, pirate: Empire): number {
    const attacking = calculateAttackingFirepowerNearEmpireTargetsList(galaxy, pirate.builtObjects, empire);
    const d = calculateDistanceToNearestColony(galaxy, empire, pirate);
    const s = galaxy.sectorSize;
    const proximity = d <= 2 * s ? 1 : d <= 4 * s ? 0.5 : 0.15;
    return Math.max(attacking, proximity * totalMobileMilitaryFirepower(pirate.builtObjects));
}

/** Pirate pressure in [0, 1]: their strength near us over (that + our mobile firepower). */
export function piratePressure(galaxy: Galaxy, empire: Empire, pirate: Empire): number {
    const p = pirateStrengthNear(galaxy, empire, pirate);
    if (!(p > 0)) return 0;
    return p / (p + totalMobileMilitaryFirepower(empire.builtObjects));
}

/** The losses a year expected from `pirate` without protection. */
export function expectedAnnualPirateLoss(galaxy: Galaxy, empire: Empire, pirate: Empire): number {
    let revenue = 0;
    for (const h of empire.colonies) if (h !== null && h.empire === empire) revenue += Math.max(0, habitatAnnualRevenue(galaxy, h));
    return piratePressure(galaxy, empire, pirate) * PIRATE_LOSS_SHARE * revenue;
}

/** Protection is worth it: a year of it is cheaper than the expected losses, and a month of it is affordable now. */
export function protectionWorthIt(monthlyPrice: number, expectedLoss: number, money: number): boolean {
    return monthlyPrice * 12 < expectedLoss && money >= monthlyPrice;
}

/** The met empire with the highest score at least RUNAWAY_FACTOR × ours (null: none). */
export function runawayEmpire(galaxy: Galaxy, self: Empire): Empire | null {
    let best: Empire | null = null;
    for (const e of galaxy.empires) {
        if (e === null || e === self || !e.active || e.pirateEmpireBaseHabitat !== null || e === galaxy.independentEmpire) continue;
        if (obtainDiplomaticRelation(self, e).type === DiplomaticRelationType.NotMet) continue;
        if (e.score > 0 && e.score >= RUNAWAY_FACTOR * Math.max(1, self.score) && (best === null || e.score > best.score)) best = e;
    }
    return best;
}

/** The pirate factions pressing the empire (pressure at least PIRATE_THREAT_PRESSURE). */
export function threateningPirates(galaxy: Galaxy, empire: Empire): Empire[] {
    return galaxy.pirateEmpires.filter((p) => p !== null && p.active && p !== empire && piratePressure(galaxy, empire, p) >= PIRATE_THREAT_PRESSURE);
}

export interface TreatyPlan {
    partner: Empire;
    offer: DiplomaticRelationType.FreeTradeAgreement | DiplomaticRelationType.MutualDefensePact;
}

const HOSTILE_STRATEGIES: ReadonlySet<DiplomaticStrategy> = new Set([DiplomaticStrategy.Conquer, DiplomaticStrategy.Undermine, DiplomaticStrategy.DefendUndermine, DiplomaticStrategy.Punish]);

/**
 * Whether `self` would accept `offer` from `partner` by the stock rule, so the offer is one it genuinely wants:
 * DetermineDesiredDiplomaticRelationTypical(strategy towards the partner) is Free Trade, Mutual Defense or Protectorate
 * for a free trade agreement, Mutual Defense for a defence pact (Empire.3.cs ProcessProposals; Main.Part10.cs:4149 /
 * 4201 with method_232). Towards the player the wanted treaty must be exactly the offer (EmpireDetailView.cs flag3,
 * which drops any other proposal), and a defence offer must not turn into a Protectorate (offerMutualDefense,
 * Empire.8.cs 1824: strategic value ratio over 4), which that rule would drop too.
 */
export function offerIsGenuine(galaxy: Galaxy, self: Empire, partner: Empire, offer: TreatyPlan['offer']): boolean {
    const r = obtainDiplomaticRelation(self, partner);
    const wanted = determineDesiredDiplomaticRelationTypical(r.strategy, r.type);
    if (partner === galaxy.playerEmpire) {
        if (wanted !== offer) return false;
        return offer !== DiplomaticRelationType.MutualDefensePact || !(totalColonyStrategicValue(self) / totalColonyStrategicValue(partner) > 4.0);
    }
    if (offer === DiplomaticRelationType.MutualDefensePact) return wanted === DiplomaticRelationType.MutualDefensePact;
    return wanted === DiplomaticRelationType.FreeTradeAgreement || wanted === DiplomaticRelationType.MutualDefensePact || wanted === DiplomaticRelationType.Protectorate;
}

/** The treaty offers for the empire's shared threats (see the file comment), friendliest partner first. */
export function sharedThreatPlans(galaxy: Galaxy, self: Empire): TreatyPlan[] {
    const runaway = runawayEmpire(galaxy, self);
    const pirates = threateningPirates(galaxy, self);
    if (runaway === null && pirates.length === 0) return [];
    const plans: { plan: TreatyPlan; attitude: number }[] = [];
    for (const e of galaxy.empires) {
        if (e === null || e === self || e === runaway || !e.active || e.pirateEmpireBaseHabitat !== null || e === galaxy.independentEmpire) continue;
        const r = obtainDiplomaticRelation(self, e);
        if (r.type !== DiplomaticRelationType.None && r.type !== DiplomaticRelationType.FreeTradeAgreement) continue;
        if (HOSTILE_STRATEGIES.has(r.strategy)) continue;
        const shared = (runaway !== null && runaway.score >= RUNAWAY_FACTOR * Math.max(1, e.score)) || pirates.some((p) => piratePressure(galaxy, e, p) >= PIRATE_THREAT_PRESSURE);
        if (!shared) continue;
        const offer = r.type === DiplomaticRelationType.None ? DiplomaticRelationType.FreeTradeAgreement : DiplomaticRelationType.MutualDefensePact;
        if (!offerIsGenuine(galaxy, self, e, offer)) continue;
        plans.push({ plan: { partner: e, offer }, attitude: obtainEmpireEvaluation(galaxy, e, self).overallAttitude });
    }
    plans.sort((a, b) => b.attitude - a.attitude);
    return plans.slice(0, MAX_OFFERS).map((p) => p.plan);
}

/** Makes the shared-threat offers through the stock offer paths. */
export function pursueSharedThreatTreaties(galaxy: Galaxy, self: Empire): TreatyPlan[] {
    const plans = sharedThreatPlans(galaxy, self);
    for (const p of plans) {
        if (p.offer === DiplomaticRelationType.FreeTradeAgreement) offerFreeTrade(galaxy, self, p.partner);
        else offerMutualDefense(galaxy, self, p.partner);
    }
    return plans;
}

registerScenarioPeriodic({
    id: 'smarterAI.diplomacy',
    flag: SMARTER_AI_FLAG,
    periodDays: 90,
    run: (galaxy) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_DIPLOMACY_FLAG)) return;
        for (const e of galaxy.empires) if (on(galaxy, e)) pursueSharedThreatTreaties(galaxy, e);
    },
});

registerScenarioQuery({
    id: 'smarterAI.pirateProtection',
    query: 'pirateProtectionDesired',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, pirate }) => {
        if (!on(galaxy, empire) || pirate.pirateEmpireBaseHabitat === null) return value;
        const price = calculatePirateProtectionPricePerMonth(galaxy, pirate, empire).price;
        return protectionWorthIt(price, expectedAnnualPirateLoss(galaxy, empire, pirate), empire.stateMoney);
    },
});
