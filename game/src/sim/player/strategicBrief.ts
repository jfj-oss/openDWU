// 18c — the strategic brief: a compact, JSON-able snapshot of an AI empire's situation, handed to the local model so it
// can make that empire's *strategic* choices a few times per game year (tasks/18-local-llm-diplomacy.md). The scripted
// C# AI keeps running fleets, economy and construction, and it keeps deciding each relation's DiplomaticStrategy
// (Empire.8.cs 66 ReviewDiplomaticStrategies). The model only picks among the moves that strategy already allows —
// the choices the scripted AI makes by coin flip (Empire.8.cs 587 ImplementDiplomaticStrategy: gift vs. treaty offer,
// Rnd.Next(0, 2)) or by timer (…IfTimePassed, CalculateNextAllowableProposalDate) — plus a few policy / tech-emphasis
// values within one step of the race's own Policy/<race>.txt. So it makes those choices deliberate instead of random,
// never overrides the empire's temperament or logistics.
//
// Legal moves ("decisions", chosen by id) — what the C# lets an AI initiate, each only when the AI's own gates pass:
// - declare-war:<e>      Empire.8.cs 587 Conquer branch: strategy Conquer, relation not War → CheckReadyForWar (1433) →
//                        StartWar (1515, ControlDiplomacyOffense gate) → DeclareWar (Empire.7.cs 4870: news broadcast).
// - offer-free-trade:<e> Befriend branch → OfferFreeTrade (1801: reclusive / hyperdrive / proposal-interval / treaty gates).
// - offer-mutual-defense:<e> Ally branch → OfferMutualDefense (1824; a Protectorate when our colony value is > 4x theirs).
// - cancel-treaty:<e>    Punish / Undermine → CancelTreatiesIfTimePassed (1657) → CancelTreaties (1671).
// - impose-sanctions:<e> Punish / Undermine → StartTradeSanctionsIfTimePassed (1572) → StartTradeSanctions (1586).
// - lift-sanctions:<e>   ApplyDiplomaticStrategyToRelation (755) TradeSanctions case → EndTradeSanctionsIfTimePassed (1609).
// - propose-peace:<e>    ApplyDiplomaticStrategyToRelation War case: ConsiderEndWar (899) says end → EndWarRequest (1550).
// - send-gift:<e>        Ally / Befriend / Placate / DefendPlacate branches → GiveGiftWhenSufficientTimePassed (1741/1778).
// - war-target:<e>       at war with two or more empires: the war-start fleet calls (Empire.8.cs 1014 PrepareFleetsForWar +
//                        Empire.7.cs 4828 SendAttackFleets) aimed at the chosen enemy.
// - tech-focus           an open "Tech emphasis" slot (EmpirePolicy.ResearchDesignTechFocus1..6; Galaxy.4.cs 917
//                        ResolveTechFocus index, as the 17d policy panel sets it) — the first slot the race's policy file
//                        leaves at None.
// - policy:<Field>       an EmpirePolicy priority the sim reads (WarWillingness, TradePriority, AlliancePriority,
//                        ResearchPriority, ExplorationPriority), within one level of the race file's value.
// - none                 no change.
// Every treaty move must also be on the 17e conversation menu seen from the AI's side (player/diplomacyProposals.ts
// listProposals(galaxy, ai, other) — Main.Part9.cs:339 TREATY_PROPOSAL), so nothing is offered that a human in the same
// seat could not do. player/strategicDecisions.ts re-checks every gate on the live galaxy and then calls the ported C#
// function, whose own gates still run.
//
// Read-only: nothing here mutates the galaxy or draws galaxy.rnd (relations / evaluations are looked up, never
// obtained; CheckReadyForWar is not called here because it assigns refuel missions). Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { Character, CharacterRole, CharacterTraitType } from '../characters';
import { DiplomaticRelationType, DiplomaticStrategy, WarObjective, empireEvaluationByEmpire, empireEvaluationsOf, type DiplomaticRelation } from '../diplomacy';
import {
    FleetPosture,
    IDEAL_TIME_BETWEEN_GIFTS,
    MANUAL,
    calculateNextAllowableProposalDate,
    considerEndWar,
    determineDesiredDiplomaticRelationTypical,
    determineEmpiresAtWarWith,
    determineRelativeStrength,
    militaryPotency,
} from '../diplomacyTick';
import { checkEmpireHasHyperDriveTech, totalColonyStrategicValue } from '../forceStructure';
import { empireShipGroups } from '../fleets/shipGroup';
import { empireWarWeariness } from '../taxes';
import { calculateAnnualCashflow } from '../treasury';
import { galaxyStarDate } from '../tick/simTime';
import { resolveStarDateDescription } from '../galaxyTime';
import { loadEmpirePolicy } from '../researchSystem';
import { ComponentCategoryType, resolveTechFocus, type EmpirePolicy } from '../data/policies';
import { ComponentType } from '../data/components';
import { EmpireMessageType, empireMessages } from '../messages';
import { resolveGameText } from '../textResolver';
import { listProposals } from './diplomacyProposals';
import { RACE_FAMILY_NAMES, governmentName, personaLines, raceBonuses, raceTraits, type BriefTrait } from './diplomatBrief';
import { feelingDescription } from './relationFactors';

const REL = DiplomaticRelationType;
const STRAT = DiplomaticStrategy;

// ---------------------------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------------------------

export type StrategicKind =
    | 'DeclareWar'
    | 'OfferFreeTrade'
    | 'OfferMutualDefense'
    | 'CancelTreaty'
    | 'ImposeTradeSanctions'
    | 'LiftTradeSanctions'
    | 'ProposePeace'
    | 'SendGift'
    | 'WarTarget'
    | 'SetTechFocus'
    | 'SetPolicy'
    | 'NoChange';

/** One legal decision as the model sees it. */
export interface StrategicDecisionOption {
    /** Stable id the model answers with. */
    id: string;
    kind: StrategicKind;
    /** What it does, in words. */
    what: string;
    /** The other empire's name (empire decisions). */
    target?: string;
    /** Facts behind it (the gate that allowed it, the current value …). */
    note?: string;
    /** Choice decisions (tech-focus / policy): the allowed `targetId` values. */
    to?: string[];
    /** Choice decisions: the current value (answering it means "keep", i.e. no change). */
    now?: string;
}

/** A decision with the sim objects it acts on (never serialized). */
export interface StrategicOptionDef extends StrategicDecisionOption {
    targetEmpire?: Empire;
    /** SetTechFocus: the 1-based slot; SetPolicy: the EmpirePolicy key. */
    slot?: number;
    field?: StrategicPolicyField;
    /** SendGift: GiveGiftWhenSufficientTimePassed's `small` argument as the scripted branch passes it. */
    small?: boolean;
    /** Choice decisions: targetId → value (ResolveTechFocus index, or the priority value). */
    choices?: Map<string, number>;
}

// ---------------------------------------------------------------------------------------------------------------
// Policy / tech emphasis tables
// ---------------------------------------------------------------------------------------------------------------

/** The EmpirePolicy priorities the model may nudge (each read by the ported AI: diplomacyTick.ts
 *  ReviewDiplomaticStrategies / CheckMustConquer for the first three, forceStructure / civilianAI for the others). */
export const STRATEGIC_POLICY_FIELDS = [
    { field: 'WarWillingness', key: 'warWillingness', label: 'Willingness to go to war' },
    { field: 'TradePriority', key: 'tradePriority', label: 'Free trade agreement priority' },
    { field: 'AlliancePriority', key: 'alliancePriority', label: 'Mutual defense pact priority' },
    { field: 'ResearchPriority', key: 'researchPriority', label: 'Research priority' },
    { field: 'ExplorationPriority', key: 'explorationPriority', label: 'Exploration priority' },
] as const;
export type StrategicPolicyField = (typeof STRATEGIC_POLICY_FIELDS)[number]['field'];
type StrategicPolicyKey = (typeof STRATEGIC_POLICY_FIELDS)[number]['key'];

/** Main.Part3.cs:4429-4486 method_608: the four-item priority combo's values (Low / Normal / High / Very High). */
export const PRIORITY_LEVELS: readonly { name: string; value: number }[] = [
    { name: 'Low', value: 0.5 },
    { name: 'Normal', value: 1.0 },
    { name: 'High', value: 1.5 },
    { name: 'VeryHigh', value: 2.0 },
];

/** Main.Part2.cs:175-190 method_618: the combo index a priority value selects (four items). */
export function priorityLevelIndex(value: number): number {
    if (value <= 0.5) return 0;
    if (value < 1.5) return 1;
    if (value < 2.0) return 2;
    return 3;
}

/** Main.Part3.cs:4825-4861 method_609 "Tech emphasis" items 1-27 (index = Galaxy.4.cs 917 ResolveTechFocus index;
 *  0 None and the super weapons 28-33 are not offered). */
export const TECH_FOCUS_NAMES: readonly string[] = [
    'None', 'Beams', 'Phasers', 'RailGuns', 'Torpedoes', 'BombardWeapons', 'Missiles', 'AreaWeapons', 'IonWeapons',
    'Fighters', 'Armor', 'Shields', 'Reactors', 'MainThrustEngines', 'VectoringEngines', 'HyperDrives',
    'HyperDisruption', 'Construction', 'DamageControl', 'CombatTargetting', 'Countermeasures', 'Sensors', 'Medicine',
    'Recreation', 'TractorBeams', 'AssaultPods', 'GravityBeamWeapons', 'GravityAreaWeapons',
];

/** The ResolveTechFocus index of a policy slot (reverse of Galaxy.4.cs 917; 0 when None). */
export function techFocusIndex(f: { category: ComponentCategoryType; type: ComponentType }): number {
    if (f.category === ComponentCategoryType.Undefined && f.type === ComponentType.Undefined) return 0;
    for (let i = 1; i <= 33; i++) {
        const r = resolveTechFocus(i);
        if (r.category === f.category && r.type === f.type) return i;
    }
    return 0;
}

function techFocusName(index: number): string {
    return TECH_FOCUS_NAMES[index] ?? `Focus${index}`;
}

/** The race's own policy (Galaxy.4.cs LoadEmpirePolicy: Policy/<race>.txt, or the defaults) — the baseline the model
 *  may deviate from by one step. */
function racePolicy(galaxy: Galaxy, ai: Empire): EmpirePolicy | null {
    const race = ai.dominantRace;
    if (race == null) return null;
    return loadEmpirePolicy(galaxy.researchStatic, race, ai.pirateEmpireBaseHabitat !== null);
}

/** The first 1-based tech emphasis slot the race's policy file leaves at None (the model's slot), or 0 when none. */
export function openTechFocusSlot(galaxy: Galaxy, ai: Empire): number {
    const base = racePolicy(galaxy, ai);
    if (base === null) return 0;
    for (let i = 0; i < 6; i++) {
        const f = base.researchDesignTechFocus[i];
        if (f === undefined || techFocusIndex(f) === 0) return i + 1;
    }
    return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

function relName(t: DiplomaticRelationType): string {
    return DiplomaticRelationType[t] ?? 'None';
}

function strategyName(s: DiplomaticStrategy): string {
    return s === STRAT.Undefined ? 'None' : (DiplomaticStrategy[s] ?? 'None');
}

function characters(e: Empire): Character[] {
    return (e.characters as unknown[]).filter((c): c is Character => c instanceof Character);
}

/** Attack-posture fleets with ships (the count Empire.8.cs 1433 CheckReadyForWar / 899 ConsiderEndWar test). */
function attackFleetCount(e: Empire): number {
    let n = 0;
    for (const sg of empireShipGroups(e)) {
        if (sg == null) continue;
        const posture = (sg as unknown as { posture?: FleetPosture }).posture ?? FleetPosture.Attack;
        if (posture === FleetPosture.Attack && sg.ships.length > 0) n++;
    }
    return n;
}

/** The empires `ai` can deal with: met, active, not itself / the independents / a pirate faction, relations both ways
 *  present (so the 17e menu can be listed without adding one). */
export function strategicCounterparts(galaxy: Galaxy, ai: Empire): { other: Empire; rel: DiplomaticRelation; theirs: DiplomaticRelation }[] {
    const out: { other: Empire; rel: DiplomaticRelation; theirs: DiplomaticRelation }[] = [];
    if (ai.pirateEmpireBaseHabitat !== null) return out;
    for (const rel of ai.diplomaticRelations) {
        const other = rel.otherEmpire;
        if (other === null || other === ai || !other.active || other === galaxy.independentEmpire || other.pirateEmpireBaseHabitat !== null) continue;
        if (rel.type === REL.NotMet) continue;
        const theirs = other.diplomaticRelations.byEmpire(ai);
        if (theirs === null) continue;
        out.push({ other, rel, theirs });
    }
    return out;
}

/** Empire ref used in decision ids: "e<empireId>". */
export function strategicEmpireRef(e: Empire): string {
    return `e${e.empireId}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Legal decisions
// ---------------------------------------------------------------------------------------------------------------

/**
 * The strategic decisions `ai` may take now (see the header for the C# gate behind each). Read-only. Also used by
 * applyStrategicDecisions to re-check a decision on the live galaxy right before it is applied.
 */
export function listStrategicOptions(galaxy: Galaxy, ai: Empire): StrategicOptionDef[] {
    const out: StrategicOptionDef[] = [];
    if (!ai.active || ai.pirateEmpireBaseHabitat !== null || ai === galaxy.independentEmpire) return out;
    const now = galaxyStarDate(galaxy);
    const fleets = attackFleetCount(ai);
    const wars = determineEmpiresAtWarWith(ai).filter((e) => e.active);
    const offense = ai.controlDiplomacyOffense !== MANUAL;
    const treaties = ai.controlDiplomacyTreaties !== MANUAL;
    const gifts = ai.controlDiplomacyGifts !== MANUAL;
    const hyper = checkEmpireHasHyperDriveTech(ai);

    for (const { other, rel } of strategicCounterparts(galaxy, ai)) {
        const ref = strategicEmpireRef(other);
        const menu = new Set(listProposals(galaxy, ai, other).filter((o) => o.enabled).map((o) => o.id.split(':')[0]));
        const strat = rel.strategy;
        const timeOk = now >= calculateNextAllowableProposalDate(galaxy, rel);
        const pending = other.proposedDiplomaticRelations.byEmpire(ai) !== null;
        const add = (kind: StrategicKind, id: string, what: string, note: string, extra: Partial<StrategicOptionDef> = {}): void => {
            out.push({ id: `${id}:${ref}`, kind, what, target: other.name, note, targetEmpire: other, ...extra });
        };
        const treatyGate = !other.reclusive && (hyper || checkEmpireHasHyperDriveTech(other));

        // Empire.8.cs 587 Conquer: `if (type != War && CheckReadyForWar(otherEmpire)) StartWar(otherEmpire)`.
        if (rel.type !== REL.War && !rel.locked && strat === STRAT.Conquer && offense && hyper && fleets > 0 && menu.has('WAR_DECLARE')) {
            add('DeclareWar', 'declare-war', `Declare war on the ${other.name}`, 'your strategy toward them is Conquer; goes ahead only if your attack fleets are ready (CheckReadyForWar)');
        }
        // Befriend: OfferFreeTrade.
        if (rel.type === REL.None && strat === STRAT.Befriend && treaties && treatyGate && timeOk && !pending && menu.has('OFFER_FREETRADE')) {
            add('OfferFreeTrade', 'offer-free-trade', `Propose a Free Trade Agreement to the ${other.name}`, 'your strategy toward them is Befriend; they decide whether to accept');
        }
        // Ally: OfferMutualDefense (Protectorate when our colony value is over 4x theirs).
        if ((rel.type === REL.None || rel.type === REL.FreeTradeAgreement) && strat === STRAT.Ally && treaties && treatyGate && timeOk && !pending && (menu.has('OFFER_MUTUALDEFENSE') || menu.has('OFFER_PROTECTORATE'))) {
            const protectorate = totalColonyStrategicValue(ai) / totalColonyStrategicValue(other) > 4.0;
            add('OfferMutualDefense', 'offer-mutual-defense', `Propose a ${protectorate ? 'Protectorate (under your protection)' : 'Mutual Defense Pact'} to the ${other.name}`, 'your strategy toward them is Ally; they decide whether to accept');
        }
        const punish = strat === STRAT.Punish || strat === STRAT.Undermine;
        // Punish / Undermine: CancelTreatiesIfTimePassed, StartTradeSanctionsIfTimePassed.
        if ((rel.type === REL.FreeTradeAgreement || rel.type === REL.MutualDefensePact || rel.type === REL.Protectorate) && punish && offense && treaties && timeOk && menu.has('CANCELTREATY')) {
            add('CancelTreaty', 'cancel-treaty', `Cancel your ${relName(rel.type)} with the ${other.name}`, `your strategy toward them is ${strategyName(strat)}`);
        }
        if (rel.type !== REL.TradeSanctions && rel.type !== REL.War && rel.type !== REL.SubjugatedDominion && punish && offense && timeOk && menu.has('TRADESANCTIONS_IMPOSE')) {
            add('ImposeTradeSanctions', 'impose-sanctions', `Impose trade sanctions on the ${other.name}`, `your strategy toward them is ${strategyName(strat)}`);
        }
        // Empire.8.cs 755 TradeSanctions case: our sanctions, and the strategy no longer wants them.
        const desired = determineDesiredDiplomaticRelationTypical(strat, rel.type);
        if (rel.type === REL.TradeSanctions && rel.initiator === ai && desired !== REL.TradeSanctions && desired !== REL.War && offense && timeOk && menu.has('TRADESANCTIONS_LIFT')) {
            add('LiftTradeSanctions', 'lift-sanctions', `Lift your trade sanctions on the ${other.name}`, `your strategy toward them (${strategyName(strat)}) no longer calls for sanctions`);
        }
        // Empire.8.cs 755 War case: ConsiderEndWar → EndWarRequest.
        if (rel.type === REL.War && !rel.locked && offense && timeOk && !pending && menu.has('WAR_END')) {
            const c = considerEndWar(galaxy, ai, other, false);
            if (c.end) add('ProposePeace', 'propose-peace', `Propose an end to the war with the ${other.name}`, 'your war council judges the war can end (ConsiderEndWar); they decide whether to accept');
        }
        // Gifts (Empire.8.cs 587 Ally / Befriend / Placate / DefendPlacate branches, with their attitude thresholds).
        if (rel.type !== REL.War && gifts && menu.has('GIFT_GIVE') && ai.stateMoney > 8400.0 && now >= rel.lastGiftDate + IDEAL_TIME_BETWEEN_GIFTS && (ai.policy?.diplomacySendGiftsUpToAmount ?? 0) > 0) {
            const theirAttitude = empireEvaluationByEmpire(empireEvaluationsOf(other), ai)?.overallAttitude ?? 0;
            const treaty = rel.type === REL.MutualDefensePact || rel.type === REL.Protectorate;
            let gift: { small: boolean } | null = null;
            if (strat === STRAT.Ally) gift = treaty ? (theirAttitude < 50 ? { small: true } : null) : theirAttitude < 50 ? { small: false } : null;
            else if (strat === STRAT.Befriend) gift = treaty || rel.type === REL.FreeTradeAgreement ? (theirAttitude < 25 ? { small: true } : null) : theirAttitude < 25 ? { small: false } : null;
            else if (strat === STRAT.Placate || strat === STRAT.DefendPlacate) gift = theirAttitude < 0 ? { small: false } : null;
            if (gift !== null) add('SendGift', 'send-gift', `Send the ${other.name} a ${gift.small ? 'small' : 'generous'} gift of credits`, `your strategy toward them is ${strategyName(strat)}; their attitude to you is ${Math.round(theirAttitude)}`, { small: gift.small });
        }
        // War focus: only a choice when there are two or more wars.
        if (rel.type === REL.War && wars.length >= 2 && ai.controlMilitaryFleets && fleets > 0) {
            add('WarTarget', 'war-target', `Concentrate your attack fleets on the ${other.name}`, `you are at war with ${wars.map((e) => e.name).join(', ')}`);
        }
    }

    // Tech emphasis: the slot the race file leaves open.
    const policy = ai.policy;
    if (policy !== null) {
        const slot = openTechFocusSlot(galaxy, ai);
        if (slot > 0) {
            const inUse = new Set(policy.researchDesignTechFocus.map(techFocusIndex));
            const current = techFocusIndex(policy.researchDesignTechFocus[slot - 1] ?? { category: ComponentCategoryType.Undefined, type: ComponentType.Undefined });
            const choices = new Map<string, number>();
            for (let i = 1; i <= 27; i++) if (!inUse.has(i)) choices.set(techFocusName(i), i);
            if (choices.size > 0) {
                const fixed = policy.researchDesignTechFocus.slice(0, slot - 1).map(techFocusIndex).filter((i) => i > 0).map(techFocusName);
                out.push({
                    id: 'tech-focus',
                    kind: 'SetTechFocus',
                    what: `Set tech emphasis ${slot} (research and ship design preference)`,
                    note: `now ${techFocusName(current)}; your race's fixed emphases: ${fixed.join(', ') || 'none'}`,
                    to: [...choices.keys()],
                    now: techFocusName(current),
                    slot,
                    choices,
                });
            }
        }
        // Policy priorities: one step around the race file's value.
        const base = racePolicy(galaxy, ai);
        if (base !== null) {
            for (const f of STRATEGIC_POLICY_FIELDS) {
                const cur = priorityLevelIndex((policy as unknown as Record<StrategicPolicyKey, number>)[f.key]);
                const home = priorityLevelIndex((base as unknown as Record<StrategicPolicyKey, number>)[f.key]);
                const choices = new Map<string, number>();
                for (let i = Math.max(0, home - 1); i <= Math.min(PRIORITY_LEVELS.length - 1, home + 1); i++) {
                    if (i !== cur) choices.set(PRIORITY_LEVELS[i].name, PRIORITY_LEVELS[i].value);
                }
                if (choices.size === 0) continue;
                out.push({
                    id: `policy:${f.field}`,
                    kind: 'SetPolicy',
                    what: `Set ${f.label}`,
                    note: `now ${PRIORITY_LEVELS[cur].name}; your race's usual level is ${PRIORITY_LEVELS[home].name}`,
                    to: [...choices.keys()],
                    now: PRIORITY_LEVELS[cur].name,
                    field: f.field,
                    choices,
                });
            }
        }
    }
    out.push({ id: 'none', kind: 'NoChange', what: 'Change nothing this time' });
    return out;
}

/** The EmpirePolicy key of a strategic policy field. */
export function policyKeyOf(field: StrategicPolicyField): StrategicPolicyKey {
    return STRATEGIC_POLICY_FIELDS.find((f) => f.field === field)!.key;
}

// ---------------------------------------------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------------------------------------------

export interface StrategicEmpireView {
    ref: string;
    name: string;
    race: string;
    isPlayer?: true;
    /** DiplomaticRelationType name. */
    relation: string;
    /** Galactic years since it last changed. */
    years?: number;
    /** Your DiplomaticStrategy toward them (set by your scripted council each review) and the relation it wants. */
    yourStrategy: string;
    wants: string;
    /** Your OverallAttitude toward them and theirs toward you, with the feeling words. */
    yourAttitude: string;
    theirAttitude: string;
    /** MilitaryPotency ratio (yours / theirs) and DetermineRelativeStrength's class from your side. */
    strength: { ratio: number; you: 'weaker' | 'comparable' | 'stronger' };
    /** War or Conquer: the war objective your scripted council set. */
    warObjective?: string;
    /** A treaty offer of yours they have not answered yet. */
    offerPending?: true;
    colonies: number;
}

export interface StrategicBrief {
    empire: { name: string; race: string; raceFamily: string; government: string; starDate: string };
    /** The ruler (persona). */
    speaker: { name: string; role: string; traits: string[] } | null;
    race: BriefTrait[];
    raceBonuses: string[];
    state: {
        colonies: number;
        population: number;
        capital: string;
        money: number;
        annualCashflow: number;
        militaryStrength: number;
        attackFleets: number;
        warWeariness: number;
        atWarWith: string[];
    };
    research: { techEmphasis: string[]; industryFocus: string };
    policy: Record<string, string>;
    empires: StrategicEmpireView[];
    /** Threats and war targets the scripted AI tracks. */
    threats: string[];
    /** Recent diplomatic messages and news this empire received (newest first). */
    incidents: string[];
    decisions: StrategicDecisionOption[];
}

const INCIDENT_TYPES: ReadonlySet<EmpireMessageType> = new Set([
    EmpireMessageType.DiplomaticRelationChange,
    EmpireMessageType.ProposeDiplomaticRelation,
    EmpireMessageType.AcceptDiplomaticRelation,
    EmpireMessageType.RefuseDiplomaticRelation,
    EmpireMessageType.GiveGift,
    EmpireMessageType.StopAttacks,
    EmpireMessageType.StopMissionsAgainstUs,
    EmpireMessageType.RemoveForcesFromSystem,
    EmpireMessageType.RequestJointWar,
    EmpireMessageType.RequestHonorMutualDefense,
    EmpireMessageType.BlockadeInitiated,
    EmpireMessageType.GalacticNewsNet,
]);

const YEAR_MS = 600_000;

function attitudeText(v: number | undefined): string {
    if (v === undefined) return 'unknown';
    return `${Math.round(v)} (${feelingDescription(v)})`;
}

/** The recent incidents in `ai`'s inbox (newest first). */
export function strategicIncidents(ai: Empire, max = 6): string[] {
    const out: string[] = [];
    const msgs = empireMessages(ai);
    for (let i = msgs.length - 1; i >= 0 && out.length < max; i--) {
        const m = msgs[i];
        if (m == null || !INCIDENT_TYPES.has(m.messageType)) continue;
        const text = resolveGameText(m.description).replace(/\s+/g, ' ').trim();
        if (text === '') continue;
        const from = m.sender !== null && m.sender !== ai && m.messageType !== EmpireMessageType.GalacticNewsNet ? `From ${m.sender.name}: ` : '';
        out.push(`${from}${text.length > 150 ? `${text.slice(0, 147)}...` : text}`);
    }
    return out;
}

/** Threats, war objectives and harassment targets the scripted AI tracks. */
export function strategicThreats(galaxy: Galaxy, ai: Empire): string[] {
    const out: string[] = [];
    const incoming = ai.incomingEnemyFleetsAndPlanetDestroyers.length;
    if (incoming > 0) out.push(`${incoming} enemy fleet(s) or planet destroyer(s) are heading for your colonies`);
    for (const { other, rel } of strategicCounterparts(galaxy, ai)) {
        if (rel.type === REL.War) {
            out.push(`War with the ${other.name}${rel.initiator === ai ? ' (you declared it)' : rel.initiator === other ? ' (they declared it)' : ''}: damage dealt so far ships/bases ${Math.round(rel.warDamageBuiltObject)}, colonies ${Math.round(rel.warDamageColony)}`);
        }
        if ((rel.type === REL.War || rel.strategy === STRAT.Conquer) && rel.warObjective !== WarObjective.Undefined) {
            const cols = rel.warObjectiveColonies.filter((h) => h != null).map((h) => h.name);
            out.push(`War objective against the ${other.name}: ${WarObjective[rel.warObjective]}${cols.length > 0 ? ` (colonies ${cols.slice(0, 4).join(', ')})` : ''}`);
        }
    }
    const raid = ai.empiresToAttack.filter((e) => e != null).map((e) => e.name);
    if (raid.length > 0) out.push(`Your ships harass: ${raid.join(', ')}`);
    return out;
}

/**
 * Build the strategic brief for AI empire `ai`. Pure: reads the galaxy, never mutates it, no Rnd.
 */
export function buildStrategicBrief(galaxy: Galaxy, ai: Empire): StrategicBrief {
    const race = ai.dominantRace ?? null;
    const now = galaxyStarDate(galaxy);
    const leader = characters(ai).find((c) => c.role === CharacterRole.Leader) ?? null;
    const potency = militaryPotency(ai);
    const policy = ai.policy;

    const empires: StrategicEmpireView[] = [];
    for (const { other, rel, theirs } of strategicCounterparts(galaxy, ai)) {
        const theirPotency = militaryPotency(other);
        const cls = theirPotency > 0 ? determineRelativeStrength(galaxy, potency, other) : 1;
        const v: StrategicEmpireView = {
            ref: strategicEmpireRef(other),
            name: other.name,
            race: other.dominantRace?.name ?? '',
            relation: relName(rel.type),
            yourStrategy: strategyName(rel.strategy),
            wants: relName(determineDesiredDiplomaticRelationTypical(rel.strategy, rel.type)),
            yourAttitude: attitudeText(empireEvaluationByEmpire(empireEvaluationsOf(ai), other)?.overallAttitude),
            theirAttitude: attitudeText(empireEvaluationByEmpire(empireEvaluationsOf(other), ai)?.overallAttitude),
            strength: {
                ratio: theirPotency > 0 ? Math.round((potency / theirPotency) * 100) / 100 : potency > 0 ? 99 : 1,
                you: cls < 0 ? 'weaker' : cls > 0 ? 'stronger' : 'comparable',
            },
            colonies: other.colonies.length,
        };
        if (other === galaxy.playerEmpire) v.isPlayer = true;
        if (rel.startDateOfLastChange > 0 && now >= rel.startDateOfLastChange) v.years = Math.round(((now - rel.startDateOfLastChange) / YEAR_MS) * 10) / 10;
        if ((rel.type === REL.War || rel.strategy === STRAT.Conquer) && rel.warObjective !== WarObjective.Undefined) v.warObjective = WarObjective[rel.warObjective];
        if (other.proposedDiplomaticRelations.byEmpire(ai) !== null) v.offerPending = true;
        void theirs;
        empires.push(v);
    }

    const policyView: Record<string, string> = {};
    if (policy !== null) {
        for (const f of STRATEGIC_POLICY_FIELDS) policyView[f.field] = PRIORITY_LEVELS[priorityLevelIndex((policy as unknown as Record<StrategicPolicyKey, number>)[f.key])].name;
    }
    const industry = policy === null ? 'None' : (['None', 'Weapons', 'Energy', 'HighTech'][policy.researchIndustryFocus as number] ?? 'None');

    const brief: StrategicBrief = {
        empire: {
            name: ai.name,
            race: race?.name ?? '',
            raceFamily: race !== null ? (RACE_FAMILY_NAMES[race.raceFamily] ?? '') : '',
            government: governmentName(ai),
            starDate: resolveStarDateDescription(now),
        },
        speaker:
            leader !== null
                ? { name: leader.name, role: CharacterRole[leader.role], traits: leader.traits.filter((t) => t !== CharacterTraitType.Undefined).map((t) => CharacterTraitType[t]) }
                : null,
        race: raceTraits(race),
        raceBonuses: raceBonuses(race),
        state: {
            colonies: ai.colonies.length,
            population: Math.round(ai.totalPopulation),
            capital: ai.capital?.name ?? '',
            money: Math.round(ai.stateMoney),
            annualCashflow: Math.round(calculateAnnualCashflow(galaxy, ai)),
            militaryStrength: Math.round(potency),
            attackFleets: attackFleetCount(ai),
            warWeariness: Math.round(empireWarWeariness(ai) * 10) / 10,
            atWarWith: determineEmpiresAtWarWith(ai).map((e) => e.name),
        },
        research: {
            techEmphasis: policy === null ? [] : policy.researchDesignTechFocus.map(techFocusIndex).filter((i) => i > 0).map(techFocusName),
            industryFocus: industry,
        },
        policy: policyView,
        empires,
        threats: strategicThreats(galaxy, ai),
        incidents: strategicIncidents(ai),
        decisions: listStrategicOptions(galaxy, ai).map(({ id, kind, what, target, note, to, now }) => {
            const d: StrategicDecisionOption = { id, kind, what };
            if (target !== undefined) d.target = target;
            if (note !== undefined) d.note = note;
            if (to !== undefined) d.to = to;
            if (now !== undefined) d.now = now;
            return d;
        }),
    };
    return brief;
}

/** The persona lines (18b's block: race temperament, bonuses, government, the ruler's own traits). */
export function strategicPersonaLines(brief: StrategicBrief): string[] {
    return personaLines(brief);
}
