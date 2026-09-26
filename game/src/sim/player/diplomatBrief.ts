// 18b — the diplomat brief: a compact, JSON-able snapshot of how an AI empire sees the player, handed to the local model
// so it can *voice* that empire's reply in a diplomatic conversation. The model never decides anything: the reply's
// verdict (accept / refuse) comes from the ported C# evaluator (player/diplomacyProposals.ts submitProposal,
// player/tradeNegotiation.ts submitTradeOffer, or the AI's own proposal on the incoming path), and the brief carries
// that verdict plus the original dialog line (the fallback text). The model may attach one counter-proposal chosen by
// id from `counters`; player/diplomatCounter.ts then puts it through the incoming path, where the sim's evaluator
// decides whether the AI stands behind it.
//
// Read-only: nothing here mutates the galaxy or draws galaxy.rnd (the brief is built from UI input between ticks; the
// digest must not move) — evaluations are looked up with empireEvaluationByEmpire, never ObtainEmpireEvaluation (which
// adds a missing one). Headless: no DOM / Pixi.
//
// Sources for the facts (all read, none re-derived):
// - race traits: races.txt via data/races.ts (Intelligence, Aggression, Caution, Friendliness, Loyalty — "normal = 100"
//   per the file's header — plus the bonus columns);
// - attitude: EmpireEvaluation.OverallAttitude, Empire.4.cs:55 ResolveFeelingDescription and Empire.7.cs:4164
//   DetermineEmpireRelationshipFactors (player/relationFactors.ts);
// - relative strength: Empire.cs MilitaryPotency and Empire.9.cs DetermineRelativeStrength (diplomacyTick.ts);
// - counter-proposals: the proposals the AI's own code sends the player for the current relation (Empire.8.cs 1801
//   OfferFreeTrade, 1824 OfferMutualDefense, 1550 EndWarRequest, 755 ApplyDiplomaticStrategyToRelation's SubjugatedDominion
//   release request) — see listDiplomatCounters.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { getGovernmentsStatic } from '../empire';
import { Habitat } from '../types';
import { DiplomaticRelationType, DiplomaticStrategy, empireEvaluationByEmpire, empireEvaluationsOf, type DiplomaticRelation } from '../diplomacy';
import { determineDesiredDiplomaticRelationTypical, determineRelativeStrength, militaryPotency } from '../diplomacyTick';
import { checkEmpireHasHyperDriveTech, totalColonyStrategicValue } from '../forceStructure';
import { EmpireMessageType, empireMessages } from '../messages';
import { resolveGameText } from '../textResolver';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../galaxyTime';
import { galaxyStarDate } from '../tick/simTime';
import { Character, CharacterRole, CharacterTraitType } from '../characters';
import type { Race } from '../data/races';
import type { DialogPartType } from '../data/dialogSet';
import { feelingDescription, relationshipFactors } from './relationFactors';

// ---------------------------------------------------------------------------------------------------------------
// Brief shape (JSON-able; C# names for enums)
// ---------------------------------------------------------------------------------------------------------------

/** One race trait from races.txt (normal = 100) with a plain-word reading for the persona. */
export interface BriefTrait {
    trait: string;
    value: number;
    /** '' when the value is ordinary. */
    reads: string;
}

export interface DiplomatCounter {
    /** Stable id the model answers with. */
    id: string;
    /** DiplomaticRelationType name the AI would propose. */
    proposes: string;
    /** What it means, in the words of the proposal. */
    label: string;
}

/** What the AI is answering. */
export type DiplomatContext =
    | {
          kind: 'proposal';
          /** The player's option (ProposalOption.id / label, label resolved). */
          optionId: string;
          label: string;
          /** submitProposal's verdict. */
          accepted: boolean;
          reply: DialogPartType | null;
          /** The original dialog line (dialog/<race>.txt, formatted) — the fallback text. */
          original: string;
      }
    | {
          kind: 'trade';
          /** What the player asked for / offered (TradeableItem labels, resolved). */
          theyGive: string[];
          weGive: string[];
          accepted: boolean;
          reply: DialogPartType | null;
          original: string;
      }
    | {
          kind: 'incoming';
          /** EmpireMessageType name of the AI's message to the player. */
          messageType: string;
          /** The dialog heading ("Treaty on Offer: Free Trade Agreement" …). */
          heading: string;
          /** The message text as the sim wrote it — the fallback text. */
          original: string;
      };

export interface DiplomatBrief {
    empire: { name: string; race: string; raceFamily: string; government: string };
    /** Who speaks: the empire's Ambassador at the player's capital, else its Leader. */
    speaker: { name: string; role: string; traits: string[] } | null;
    /** races.txt traits of the empire's dominant race. */
    race: BriefTrait[];
    /** Race bonuses that colour the persona (races.txt bonus columns, non-zero only), e.g. "TradeBonus 20%". */
    raceBonuses: string[];
    player: { name: string; race: string; government: string };
    relation: {
        /** DiplomaticRelationType name (their relation with the player). */
        current: string;
        /** Galactic years since it last changed, when known. */
        years?: number;
        /** Their DiplomaticStrategy toward the player. */
        strategy: string;
        /** The relation that strategy wants (DetermineDesiredDiplomaticRelationTypical, Empire.8.cs). */
        wants: string;
        /** Side treaties in force. */
        treaties: string[];
    };
    /** Their attitude toward the player: OverallAttitude, the feeling word and the named factors behind it. */
    attitude: { score: number; feeling: string; factors: { value: number; reason: string }[] } | null;
    /** MilitaryPotency ratio (theirs / the player's) and DetermineRelativeStrength's class from their side. */
    strength: { ratio: number; they: 'weaker' | 'comparable' | 'stronger' };
    /** Recent incidents between the two empires and wars/treaties with third parties. */
    incidents: string[];
    /** The exchange being voiced, with the evaluator's verdict and the original line. */
    exchange:
        | { kind: 'proposal'; playerProposes: string; verdict: 'accepted' | 'refused' | 'answered'; originalLine: string }
        | { kind: 'trade'; playerAsksFor: string[]; playerOffers: string[]; verdict: 'accepted' | 'refused'; originalLine: string }
        | { kind: 'incoming'; youSend: string; subject: string; originalLine: string };
    /** Counter-proposals the empire may attach (by id). Empty when none apply. */
    counters: DiplomatCounter[];
}

// ---------------------------------------------------------------------------------------------------------------
// Persona
// ---------------------------------------------------------------------------------------------------------------

/** races.txt header, Race Family column: 0=Humanoid, 1=Ursidian, 2=Insectoid, 3=Reptilian, 4=Amphibian, 5=Rodent, 6=Machine. */
const RACE_FAMILY_NAMES = ['Humanoid', 'Ursidian', 'Insectoid', 'Reptilian', 'Amphibian', 'Rodent', 'Machine'];

// Plain-word readings of a trait value against the file's "normal = 100": [very low, low, high, very high].
// Flavour only (the sim uses the raw numbers); bands: < 80, < 95, 95..105 ordinary, > 105, > 120.
const TRAIT_WORDS: Record<string, [string, string, string, string]> = {
    Intelligence: ['simple and blunt', 'plain-spoken', 'clever', 'brilliant and condescending'],
    Aggression: ['peaceable', 'restrained', 'aggressive', 'belligerent and warlike'],
    Caution: ['reckless', 'bold', 'cautious', 'deeply suspicious'],
    Friendliness: ['cold and xenophobic', 'aloof', 'friendly', 'warm and gregarious'],
    Loyalty: ['fickle', 'opportunistic', 'loyal', 'fiercely loyal to allies'],
};

export function traitReading(trait: string, value: number): string {
    const w = TRAIT_WORDS[trait];
    if (w === undefined) return '';
    if (value < 80) return w[0];
    if (value < 95) return w[1];
    if (value > 120) return w[3];
    if (value > 105) return w[2];
    return '';
}

/** The race's diplomacy-relevant races.txt columns with their readings. */
export function raceTraits(race: Race | null): BriefTrait[] {
    if (race === null) return [];
    const rows: [string, number][] = [
        ['Intelligence', race.intelligence],
        ['Aggression', race.aggression],
        ['Caution', race.caution],
        ['Friendliness', race.friendliness],
        ['Loyalty', race.loyalty],
    ];
    return rows.map(([trait, value]) => ({ trait, value, reads: traitReading(trait, value) }));
}

function raceBonuses(race: Race | null): string[] {
    if (race === null) return [];
    const out: string[] = [];
    const add = (name: string, v: number): void => {
        if (v !== 0) out.push(`${name} ${v}%`);
    };
    add('TradeBonus', race.tradeBonus);
    add('EspionageBonus', race.espionageBonus);
    add('ResearchBonus', race.researchBonus);
    add('WarWearinessAttenuation', race.warWearinessAttenuation);
    add('TroopMaintenanceSavings', race.troopMaintenanceSavings);
    add('ShipMaintenanceSavings', race.shipMaintenanceSavings);
    if (!race.expanding) out.push('does not expand (static empire)');
    return out;
}

function governmentName(e: Empire): string {
    if (e.governmentId < 0) return '';
    return getGovernmentsStatic()[e.governmentId]?.name ?? '';
}

function characters(e: Empire): Character[] {
    return (e.characters as unknown[]).filter((c): c is Character => c instanceof Character);
}

/** The character who speaks for `ai` to `player`: its Ambassador posted at the player's capital
 *  (Character.cs AmbassadorAssignedToEmpire, location = the other empire's capital), else its Leader. */
export function diplomatCharacter(ai: Empire, player: Empire): Character | null {
    const chars = characters(ai);
    const amb = chars.find((c) => c.role === CharacterRole.Ambassador && c.location instanceof Habitat && c.location.empire === player);
    return amb ?? chars.find((c) => c.role === CharacterRole.Leader) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Counter-proposals
// ---------------------------------------------------------------------------------------------------------------

const REL = DiplomaticRelationType;

/** The relation type a player proposal option asks for (none for warnings, gifts, trade …). */
export function proposalTargetType(optionId: string): DiplomaticRelationType | null {
    switch (optionId) {
        case 'OFFER_FREETRADE':
            return REL.FreeTradeAgreement;
        case 'OFFER_MUTUALDEFENSE':
            return REL.MutualDefensePact;
        case 'OFFER_PROTECTORATE':
            return REL.Protectorate;
        case 'WAR_END':
        case 'TRADESANCTIONS_LIFT':
        case 'SUBJUGATION_REQUESTRELEASE':
            return REL.None;
    }
    return null;
}

interface CounterDef extends DiplomatCounter {
    type: DiplomaticRelationType;
}

/**
 * The proposals `ai`'s own code can send `player` in the current relation (the legal counter set):
 * - None / FreeTradeAgreement: OfferMutualDefense (Empire.8.cs 1824: a Protectorate when the AI's
 *   TotalColonyStrategicValue is over 4x the player's); None also OfferFreeTrade (1801). Both need a non-reclusive player
 *   and hyperdrive tech on one side (the gates at the top of both methods).
 * - War: EndWarRequest (1550, relation None). TODO(port): SubjugateRequest (1527) — the incoming path's validity check
 *   (EmpireDetailView.cs:639-706, DetermineDesiredDiplomaticRelationTypical) never yields SubjugatedDominion, so such an
 *   offer could never be answered there.
 * - TradeSanctions imposed by the player: the None request whose GenerateMessageDescription line is "We ask you to end
 *   your trade sanctions against us" (Empire.7.cs 3859).
 * - SubjugatedDominion with the AI subjugated: the release request (Empire.8.cs 755 ApplyDiplomaticStrategyToRelation).
 * - Truce: the None peace offer.
 * Locked relations offer nothing; `exclude` drops the type the player just proposed (the AI does not counter a refused
 * offer with the same offer).
 */
export function listDiplomatCounters(ai: Empire, player: Empire, exclude: DiplomaticRelationType | null = null): CounterDef[] {
    const rel = ai.diplomaticRelations.byEmpire(player);
    if (rel === null || rel.type === REL.NotMet || rel.locked) return [];
    const theirs = player.diplomaticRelations.byEmpire(ai);
    if (theirs?.locked === true) return [];
    if (ai.pirateEmpireBaseHabitat !== null || player.pirateEmpireBaseHabitat !== null) return [];
    const out: CounterDef[] = [];
    const treatyGate = (): boolean => !player.reclusive && (checkEmpireHasHyperDriveTech(ai) || checkEmpireHasHyperDriveTech(player));
    const pact = (): void => {
        if (!treatyGate()) return;
        const protectorate = totalColonyStrategicValue(ai) / totalColonyStrategicValue(player) > 4.0;
        out.push(
            protectorate
                ? { id: 'protectorate', type: REL.Protectorate, proposes: 'Protectorate', label: 'We offer you a Protectorate treaty under our protection' }
                : { id: 'mutual-defense', type: REL.MutualDefensePact, proposes: 'MutualDefensePact', label: 'We propose a Mutual Defense Pact' },
        );
    };
    switch (rel.type) {
        case REL.None:
            if (treatyGate()) out.push({ id: 'free-trade', type: REL.FreeTradeAgreement, proposes: 'FreeTradeAgreement', label: 'We propose a Free Trade Agreement' });
            pact();
            break;
        case REL.FreeTradeAgreement:
            pact();
            break;
        case REL.War:
            out.push({ id: 'end-war', type: REL.None, proposes: 'None', label: 'We propose an end to this war' });
            break;
        case REL.TradeSanctions:
            if (rel.initiator === player) out.push({ id: 'lift-sanctions', type: REL.None, proposes: 'None', label: 'We ask you to lift your trade sanctions against us' });
            break;
        case REL.SubjugatedDominion:
            if (rel.initiator === player) out.push({ id: 'release', type: REL.None, proposes: 'None', label: 'We ask for release from subjugation' });
            break;
        case REL.Truce:
            out.push({ id: 'peace', type: REL.None, proposes: 'None', label: 'We propose a lasting peace' });
            break;
    }
    return out.filter((c) => c.type !== exclude);
}

// ---------------------------------------------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------------------------------------------

/** EmpireMessage types from the AI to the player that record a diplomatic incident. */
const INCIDENT_MESSAGE_TYPES: ReadonlySet<EmpireMessageType> = new Set([
    EmpireMessageType.DiplomaticRelationChange,
    EmpireMessageType.ProposeDiplomaticRelation,
    EmpireMessageType.AcceptDiplomaticRelation,
    EmpireMessageType.RefuseDiplomaticRelation,
    EmpireMessageType.GiveGift,
    EmpireMessageType.StopAttacks,
    EmpireMessageType.StopMissionsAgainstUs,
    EmpireMessageType.RemoveForcesFromSystem,
    EmpireMessageType.LeaveSystem,
    EmpireMessageType.RemoveColoniesFromSystem,
    EmpireMessageType.RequestJointWar,
    EmpireMessageType.RequestJointTradeSanctions,
    EmpireMessageType.RequestHonorMutualDefense,
    EmpireMessageType.BlockadeInitiated,
    EmpireMessageType.MilitaryRefuelingAllowed,
    EmpireMessageType.MilitaryRefuelingBlocked,
    EmpireMessageType.MiningRightsAllowed,
    EmpireMessageType.MiningRightsBlocked,
    EmpireMessageType.RestrictedResourceTradingAllowed,
    EmpireMessageType.RestrictedResourceTradingBlocked,
]);

const YEAR_MS = REAL_SECONDS_IN_GALACTIC_YEAR * 1000;

function years(ms: number): number {
    return Math.round((ms / YEAR_MS) * 10) / 10;
}

function relationsOfType(e: Empire, types: DiplomaticRelationType[], exclude: Empire[]): string[] {
    const out: string[] = [];
    for (const r of e.diplomaticRelations) {
        const o = r.otherEmpire;
        if (o === null || !o.active || exclude.includes(o) || !types.includes(r.type)) continue;
        out.push(o.name);
    }
    return out;
}

/** What the sim records between the two empires (newest messages first), and the wars / pacts with third parties. */
export function diplomatIncidents(galaxy: Galaxy, ai: Empire, player: Empire, maxMessages = 6): string[] {
    const out: string[] = [];
    const now = galaxyStarDate(galaxy);
    const rel = ai.diplomaticRelations.byEmpire(player);
    const ours = player.diplomaticRelations.byEmpire(ai);
    if (rel !== null && rel.type === REL.War) {
        out.push(`At war with you${rel.initiator === ai ? ' (we declared it)' : rel.initiator === player ? ' (you declared it)' : ''}; war damage so far: ships/bases ${rel.warDamageBuiltObject}, colonies ${rel.warDamageColony}`);
    }
    if (rel !== null && rel.type === REL.TradeSanctions) out.push(rel.initiator === ai ? 'We have trade sanctions against you' : 'You have trade sanctions against us');
    // DiplomaticRelation.LastGiftDate: set on the giver's relation (Main.Part10.cs:4907 GIFT_GIVE).
    if (ours !== null && ours.lastGiftDate > 0) out.push(`You sent us a gift ${years(now - ours.lastGiftDate)} years ago`);
    if (rel !== null && rel.lastGiftDate > 0) out.push(`We sent you a gift ${years(now - rel.lastGiftDate)} years ago`);

    const msgs = empireMessages(player);
    let n = 0;
    for (let i = msgs.length - 1; i >= 0 && n < maxMessages; i--) {
        const m = msgs[i];
        if (m == null || m.sender !== ai || !INCIDENT_MESSAGE_TYPES.has(m.messageType)) continue;
        const text = resolveGameText(m.description).replace(/\s+/g, ' ').trim();
        if (text === '') continue;
        out.push(`We told you (${EmpireMessageType[m.messageType]}): "${text.length > 160 ? `${text.slice(0, 157)}...` : text}"`);
        n++;
    }

    const theirWars = relationsOfType(ai, [REL.War], [player]);
    if (theirWars.length > 0) out.push(`We are at war with: ${theirWars.join(', ')}`);
    const theirPacts = relationsOfType(ai, [REL.MutualDefensePact, REL.Protectorate], [player]);
    if (theirPacts.length > 0) out.push(`Our defense pacts: ${theirPacts.join(', ')}`);
    const playerWars = relationsOfType(player, [REL.War], [ai]);
    if (playerWars.length > 0) out.push(`You are at war with: ${playerWars.join(', ')}`);
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------------------------

/** Options whose C# case only answers (Main.Part10.cs:4925/4939 warnings, :4227 OFFER_DEAL, :4324 DEAL_BEGIN): no verdict. */
const NO_DECISION_OPTIONS: ReadonlySet<string> = new Set(['WARNING_INTELLIGENCEMISSIONS', 'WARNING_ATTACKS', 'OFFER_DEAL', 'DEAL_BEGIN']);

function strategyName(s: DiplomaticStrategy): string {
    return s === DiplomaticStrategy.Undefined ? 'None' : (DiplomaticStrategy[s] ?? 'None');
}

function sideTreaties(rel: DiplomaticRelation | null, ours: DiplomaticRelation | null): string[] {
    const t: string[] = [];
    if (rel?.militaryRefuelingToOther) t.push('We allow you military refueling');
    if (ours?.militaryRefuelingToOther) t.push('You allow us military refueling');
    if (rel?.miningRightsToOther) t.push('We grant you mining rights');
    if (ours?.miningRightsToOther) t.push('You grant us mining rights');
    return t;
}

/**
 * Build the diplomat brief for `ai` speaking to `player` about `context` (built after the evaluator ran, so the relation
 * and counters reflect the verdict). Pure: reads the galaxy, never mutates it, no Rnd.
 */
export function buildDiplomatBrief(galaxy: Galaxy, ai: Empire, player: Empire, context: DiplomatContext): DiplomatBrief {
    const race = ai.dominantRace ?? null;
    const rel = ai.diplomaticRelations.byEmpire(player);
    const ours = player.diplomaticRelations.byEmpire(ai);
    const now = galaxyStarDate(galaxy);

    const speakerChar = diplomatCharacter(ai, player);
    const speaker =
        speakerChar !== null
            ? {
                  name: speakerChar.name,
                  role: CharacterRole[speakerChar.role],
                  traits: speakerChar.traits.filter((t) => t !== CharacterTraitType.Undefined).map((t) => CharacterTraitType[t]),
              }
            : null;

    const ev = empireEvaluationByEmpire(empireEvaluationsOf(ai), player);
    const attitude =
        ev !== null && ai.pirateEmpireBaseHabitat === null && player.pirateEmpireBaseHabitat === null
            ? {
                  score: Math.round(ev.overallAttitude),
                  feeling: feelingDescription(ev.overallAttitude),
                  // DetermineEmpireRelationshipFactors(this = player, other = ai): how `ai` feels about the player.
                  factors: relationshipFactors(player, ai, governmentName(player)).map((f) => ({ value: Math.round(f.value * 10) / 10, reason: f.description })),
              }
            : null;

    const theirs = militaryPotency(ai);
    const playerPotency = militaryPotency(player);
    const cls = playerPotency > 0 ? determineRelativeStrength(galaxy, theirs, player) : 1;
    const strength = {
        ratio: playerPotency > 0 ? Math.round((theirs / playerPotency) * 100) / 100 : theirs > 0 ? 99 : 1,
        they: (cls < 0 ? 'weaker' : cls > 0 ? 'stronger' : 'comparable') as 'weaker' | 'comparable' | 'stronger',
    };

    let exchange: DiplomatBrief['exchange'];
    let exclude: DiplomaticRelationType | null = null;
    switch (context.kind) {
        case 'proposal':
            exchange = {
                kind: 'proposal',
                playerProposes: context.label,
                verdict: NO_DECISION_OPTIONS.has(context.optionId.split(':')[0]) ? 'answered' : context.accepted ? 'accepted' : 'refused',
                originalLine: context.original,
            };
            exclude = proposalTargetType(context.optionId);
            break;
        case 'trade':
            exchange = { kind: 'trade', playerAsksFor: context.theyGive, playerOffers: context.weGive, verdict: context.accepted ? 'accepted' : 'refused', originalLine: context.original };
            break;
        case 'incoming':
            exchange = { kind: 'incoming', youSend: context.messageType, subject: context.heading, originalLine: context.original };
            break;
    }

    const counters = context.kind === 'incoming' ? [] : listDiplomatCounters(ai, player, exclude).map(({ id, proposes, label }) => ({ id, proposes, label }));

    const relation: DiplomatBrief['relation'] = {
        current: DiplomaticRelationType[rel?.type ?? REL.NotMet] ?? 'NotMet',
        strategy: strategyName(rel?.strategy ?? DiplomaticStrategy.Undefined),
        wants: DiplomaticRelationType[determineDesiredDiplomaticRelationTypical(rel?.strategy ?? DiplomaticStrategy.Undefined, rel?.type ?? REL.NotMet)] ?? 'None',
        treaties: sideTreaties(rel, ours),
    };
    if (rel !== null && rel.startDateOfLastChange > 0 && now >= rel.startDateOfLastChange) relation.years = years(now - rel.startDateOfLastChange);

    return {
        empire: {
            name: ai.name,
            race: race?.name ?? '',
            raceFamily: race !== null ? (RACE_FAMILY_NAMES[race.raceFamily] ?? '') : '',
            government: governmentName(ai),
        },
        speaker,
        race: raceTraits(race),
        raceBonuses: raceBonuses(race),
        player: { name: player.name, race: player.dominantRace?.name ?? '', government: governmentName(player) },
        relation,
        attitude,
        strength,
        incidents: diplomatIncidents(galaxy, ai, player),
        exchange,
        counters,
    };
}

/** The persona lines of the system prompt: the race's non-ordinary traits in plain words, plus the speaker's traits. */
export function personaLines(brief: DiplomatBrief): string[] {
    const lines: string[] = [];
    const words = brief.race.filter((t) => t.reads !== '').map((t) => `${t.reads} (${t.trait} ${t.value})`);
    lines.push(
        words.length > 0
            ? `The ${brief.empire.race} are ${words.join(', ')}.`
            : `The ${brief.empire.race} are even-tempered (all traits near normal).`,
    );
    if (brief.raceBonuses.length > 0) lines.push(`Racial strengths: ${brief.raceBonuses.join(', ')}.`);
    if (brief.empire.government !== '') lines.push(`Government: ${brief.empire.government}.`);
    if (brief.speaker !== null && brief.speaker.traits.length > 0) lines.push(`${brief.speaker.name} personally is: ${brief.speaker.traits.join(', ')}.`);
    return lines;
}
