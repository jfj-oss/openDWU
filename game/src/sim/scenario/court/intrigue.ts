// 19n court & dynasties, package 2 — court intrigue (tasks/19-mod-layer-scenarios.md §19n items 5 schemes, 6 secrets &
// hooks, 7 dynastic ties, 8 relationships, 10 claims). Not a port: a scenario package on the mod layer on top of
// package 1 (court.ts: houses, seats, factions, succession, legitimacy), 19m internal security (the hidden-thing
// registry and its leads) and 19d1 internal politics (loyalty / ambition / plots).
//   5. Schemes — an intelligence agent runs sway / blackmail / sabotage-loyalty / assassinate against a character (own or
//      foreign) as a new intelligence-mission kind through the ported mission lifecycle (espionage.ts
//      newCourtSchemeMission + performIntelligenceMissions: Empire.5.cs 5597 due date, Empire.6.cs 16
//      DetermineIntelligenceMissionOutcome, BaconEmpire.cs 655 ResetSpyMission, the capture kill loop). A foreign scheme
//      is a 19m hidden thing in the victim's empire: a detected outcome or a confirmed lead tells the victim who schemed
//      (an IncidentEvaluation hit as the ported detected missions give; an assassination also a casus belli claim).
//   6. Secrets & hooks — corruption (the Corrupt trait), cult membership (19f cult flag), defection talks (19d1: loyalty
//      < 25 with a defection target) are hidden things of the character's own empire; a scheme discovered is a secret
//      of its agent. A confirmed secret (or a successful sway / sabotage scheme digging up dirt) gives a hook: force
//      compliance once (a seat appointment, a faction withdrawal, a plot abandoned) or expose publicly (loyalty,
//      legitimacy and house-prestige hits).
//   7. Dynastic ties — envoys / wards / spouses exchanged through a proposal (the player: a new TREATY_PROPOSAL option on
//      the ported conversation, Main.Part9.cs:46 method_238 / Main.Part10.cs:3957 method_237; AIs among themselves by
//      their diplomatic strategy, answered by attitude): a yearly IncidentEvaluation bonus both ways; a spouse between
//      ruling houses leans both toward a defensive pact (the stock Empire.8.cs OfferMutualDefense) and gives the
//      sender's house a claim on the partner's succession (its capital).
//   8. Relationships — friends / rivals / lovers form between co-located characters (years together, trait
//      compatibility, one yearly roll per pair): friends lend a fleet (captainBonuses) and colony (stability term)
//      bonus; rivals lose loyalty yearly, sit worse on the council and plot against a rival in power; lovers across
//      houses reconcile or start a feud; across empires they make a tie.
//  10. Claims — houses claim colonies they lost (colonyOwnerChanged), through marriage, or as a casus belli
//      (assassination discovered); the council (a chancellor) recognizes them. claimsFor(empire) lists
//      {colony, strength, cause}; a claimed colony's governor weighs more in the 19d1 plot pick (secession). The 19g-3 war
//      goals hook (not merged here): warGoalCandidates should add goal('conquest', claimed colonies of the enemy) and a
//      free goal('casusBelli') when claimsFor(self) holds a casusBelli claim on the enemy.
//
// Gate: flag `courtIntrigue` AND `courtDynasties` (package 1 supplies houses and seats). Every hook slot this module
// fills returns its "off" value otherwise; with the flag off no scheme mission, hidden thing, tie or claim exists.
// Rnd: galaxy.rnd is drawn only in the yearly handler (relationship rolls, the lovers' feud roll, the AI scheme and tie
// rolls) and inside the ported mission resolution (the outcome roll; the stock death path) — all behind the flag.
// Queries, terms and the UI rows are pure.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { type Character, type IntelligenceMission, CharacterRole, CharacterTraitType, getEmpireCharacters, stellarObjectCharacters } from '../../characters';
import { CharacterDeathType, characterSendDeathMessage } from '../../characterRuntime';
import {
    IntelligenceMissionOutcome,
    IntelligenceMissionType,
    characterMission,
    getIntelligenceMissionSkillLevel,
    newCourtSchemeMission,
} from '../../espionage';
import { DiplomaticRelationType, DiplomaticStrategy, obtainEmpireEvaluation } from '../../diplomacy';
import { offerMutualDefense } from '../../diplomacyTick';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyCurrentStarDate } from '../../pirateRelations';
import { galaxyStarDate } from '../../tick/simTime';
import { registerScenarioEvent, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { raiseScenarioDecision, registerScenarioDecision, type ScenarioDecision } from '../decisions';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { scenarioMessage, scenarioText } from '../messages';
import { registerStabilityTerm } from '../stability';
import { scenarioProposalSlots, type ScenarioProposalOption } from '../proposalSlots';
import { espionageHooks } from '../emergent/espionageHooks';
import { POLITICS_FLAG, canPlot, defectionTarget, governedColony, isPoliticalEmpire, peekPoliticsState, politicsEntry, politicsState } from '../emergent/politics';
import { peekCultState } from '../threats/cult';
import {
    type HiddenThing,
    type Lead,
    peekSecurityState,
    registerHiddenThing,
    retireHiddenTarget,
    retireHiddenThing,
    securitySlots,
    setLeadLevel,
} from '../security/registry';
import { onLeadChanged } from '../security/security';
import {
    COURT_PARAMS,
    SEATS,
    addPrestige,
    appointToSeat,
    areRivals,
    courtExtensions,
    courtOn,
    courtRank,
    courtState,
    ensureHouse,
    feudIncident,
    houseById,
    houseOf,
    leaderLegitimacy,
    makeRivals,
    peekCourtState,
    rulingHouse,
    seatEligible,
    seatHolder,
    seatOf,
    seatSkill,
    type House,
    type SeatName,
} from './court';
import { ABRASIVE_TRAITS, HONEST_TRAITS, OPPOSED_TRAITS, RUTHLESS_TRAITS, SCHEMING_TRAITS, SOCIABLE_TRAITS } from './courtData';
import { isHumanEmpire } from '../../humanEmpires';

export const INTRIGUE_FLAG = 'courtIntrigue';
export const TIE_DECISION = 'court.tie';
const CULT_FLAG = 'cult';

// ---------------------------------------------------------------------------------------------------------------
// Params (scenarios/court-dynasties/scenario.json)
// ---------------------------------------------------------------------------------------------------------------

export const INTRIGUE_PARAMS = {
    schemePct: (g: Galaxy) => scenarioParam(g, 'courtSchemePct', 30),
    swayLoyalty: (g: Galaxy) => scenarioParam(g, 'courtSwayLoyalty', 15),
    sabotageLoyalty: (g: Galaxy) => scenarioParam(g, 'courtSabotageLoyalty', 20),
    blackmailConcessionPct: (g: Galaxy) => scenarioParam(g, 'courtBlackmailConcessionPct', 10),
    schemeIncident: (g: Galaxy) => scenarioParam(g, 'courtSchemeIncident', 10),
    assassinationIncident: (g: Galaxy) => scenarioParam(g, 'courtAssassinationIncident', 25),
    schemeTraceYears: (g: Galaxy) => scenarioParam(g, 'courtSchemeTraceYears', 2),
    schemeConcealment: (g: Galaxy) => scenarioParam(g, 'courtSchemeConcealment', 20),
    secretConcealment: (g: Galaxy) => scenarioParam(g, 'courtSecretConcealment', 50),
    exposeLoyalty: (g: Galaxy) => scenarioParam(g, 'courtExposeLoyalty', 20),
    exposeLegitimacy: (g: Galaxy) => scenarioParam(g, 'courtExposeLegitimacy', 10),
    exposePrestige: (g: Galaxy) => scenarioParam(g, 'courtExposePrestige', 10),
    tieEnvoyAttitude: (g: Galaxy) => scenarioParam(g, 'courtTieEnvoyAttitude', 2),
    tieWardAttitude: (g: Galaxy) => scenarioParam(g, 'courtTieWardAttitude', 4),
    tieSpouseAttitude: (g: Galaxy) => scenarioParam(g, 'courtTieSpouseAttitude', 6),
    tieEnvoyAccept: (g: Galaxy) => scenarioParam(g, 'courtTieEnvoyAccept', 0),
    tieWardAccept: (g: Galaxy) => scenarioParam(g, 'courtTieWardAccept', 10),
    tieSpouseAccept: (g: Galaxy) => scenarioParam(g, 'courtTieSpouseAccept', 20),
    tieProposalPct: (g: Galaxy) => scenarioParam(g, 'courtTieProposalPct', 20),
    tieProposalYears: (g: Galaxy) => scenarioParam(g, 'courtTieProposalYears', 5),
    relYears: (g: Galaxy) => scenarioParam(g, 'courtRelationshipYears', 2),
    relPct: (g: Galaxy) => scenarioParam(g, 'courtRelationshipPct', 30),
    loverPct: (g: Galaxy) => scenarioParam(g, 'courtLoverPct', 10),
    loverFeudPct: (g: Galaxy) => scenarioParam(g, 'courtLoverFeudPct', 50),
    rivalLoyalty: (g: Galaxy) => scenarioParam(g, 'courtRivalLoyalty', 3),
    rivalPlotPct: (g: Galaxy) => scenarioParam(g, 'courtRivalInPowerPlotPct', 150),
    friendFleetBonus: (g: Galaxy) => scenarioParam(g, 'courtFriendFleetBonus', 5),
    friendApproval: (g: Galaxy) => scenarioParam(g, 'courtFriendApproval', 1),
    rivalApproval: (g: Galaxy) => scenarioParam(g, 'courtRivalApproval', 1),
    claimStart: (g: Galaxy) => scenarioParam(g, 'courtClaimStart', 50),
    claimDecay: (g: Galaxy) => scenarioParam(g, 'courtClaimDecay', 5),
    marriageClaim: (g: Galaxy) => scenarioParam(g, 'courtMarriageClaim', 30),
    recognitionBonus: (g: Galaxy) => scenarioParam(g, 'courtClaimRecognition', 10),
    claimPlotPct: (g: Galaxy) => scenarioParam(g, 'courtClaimPlotPct', 100),
    casusBelliStrength: (g: Galaxy) => scenarioParam(g, 'courtCasusBelliStrength', 60),
    casusBelliYears: (g: Galaxy) => scenarioParam(g, 'courtCasusBelliYears', 10),
};
const P = INTRIGUE_PARAMS;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export type SchemeKind = 'sway' | 'blackmail' | 'sabotageLoyalty' | 'assassinate';
export const SCHEME_KINDS: readonly SchemeKind[] = ['sway', 'blackmail', 'sabotageLoyalty', 'assassinate'];
export type SchemeState = 'running' | 'succeeded' | 'failed' | 'captured';
export type SecretKind = 'corruption' | 'cult' | 'defection' | 'scheme';
export const SECRET_KINDS: readonly SecretKind[] = ['corruption', 'cult', 'defection', 'scheme'];
export type ComplianceAct = 'seat' | 'withdraw' | 'abandonPlot';
export type TieKind = 'envoy' | 'ward' | 'spouse' | 'lover';
export const TIE_KINDS: readonly TieKind[] = ['envoy', 'ward', 'spouse'];
export type RelKind = 'friend' | 'rival' | 'lover';
export type ClaimCause = 'former' | 'marriage' | 'casusBelli';

export interface Scheme {
    id: number;
    kind: SchemeKind;
    agent: Character;
    empire: Empire;
    target: Character;
    targetEmpire: Empire;
    mission: IntelligenceMission;
    start: number;
    state: SchemeState;
    /** Star date it ended (0 while running). */
    ended: number;
    /** The victim learned who schemed. */
    discovered: boolean;
    /** The 19m hidden thing (foreign schemes with 19m on). */
    thingId: string | null;
    /** Blackmail: the hook it uses and the act it forces. */
    hookId: number;
    act: ComplianceAct | null;
    seat: SeatName | null;
}

export interface Hook {
    id: number;
    holder: Empire;
    character: Character;
    secret: SecretKind;
    since: number;
    used: boolean;
}

export interface Tie {
    id: number;
    kind: TieKind;
    /** The sender (the character's origin empire). */
    from: Empire;
    to: Empire;
    character: Character;
    /** Lover ties: the other lover (of `to`). */
    partner: Character | null;
    /** The character's house at the time of the tie (the marriage claim's holder). */
    originHouse: number | null;
    since: number;
    ended: boolean;
}

export interface Relationship {
    a: Character;
    b: Character;
    kind: RelKind;
    /** Game year formed. */
    since: number;
}

/** Years two characters spent at the same location (counted once per game year). */
export interface Together {
    a: Character;
    b: Character;
    years: number;
    seen: number;
}

export interface ClaimRecord {
    id: number;
    /** The claiming house (null: the empire's ruling house at query time). */
    house: number | null;
    empire: Empire;
    colony: Habitat;
    cause: ClaimCause;
    /** Stored strength (former ownership decays; casus belli fixed); marriage claims derive theirs from the tie. */
    base: number;
    since: number;
    recognized: boolean;
    tieId: number;
    /** A casus belli: the offender empire. */
    against: Empire | null;
}

export interface Claim {
    colony: Habitat;
    strength: number;
    cause: ClaimCause;
    house: House | null;
    recognized: boolean;
    against: Empire | null;
}

export interface IntrigueEvent {
    year: number;
    empire: Empire;
    text: string;
}

export interface IntrigueState {
    nextScheme: number;
    schemes: Scheme[];
    nextHook: number;
    hooks: Hook[];
    nextTie: number;
    ties: Tie[];
    rels: Relationship[];
    together: Together[];
    nextClaim: number;
    claims: ClaimRecord[];
    /** Foreign sway: the character's opinion of the schemer empire (decays yearly). */
    opinions: { character: Character; empire: Empire; value: number }[];
    /** Tie proposals made: from → to → game year. */
    offers: { from: Empire; to: Empire; year: number }[];
    events: IntrigueEvent[];
}

export function intrigueState(galaxy: Galaxy): IntrigueState {
    return scenarioState<IntrigueState>(galaxy, 'courtIntrigue', () => ({
        nextScheme: 1,
        schemes: [],
        nextHook: 1,
        hooks: [],
        nextTie: 1,
        ties: [],
        rels: [],
        together: [],
        nextClaim: 1,
        claims: [],
        opinions: [],
        offers: [],
        events: [],
    }));
}

/** The state if it exists (pure readers / UI: never creates it). */
export function peekIntrigueState(galaxy: Galaxy): IntrigueState | null {
    const s = galaxy.scenario;
    if (s === null || !('courtIntrigue' in s.state)) return null;
    return s.state.courtIntrigue as IntrigueState;
}

export function intrigueOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, INTRIGUE_FLAG) && courtOn(galaxy);
}

const year = (galaxy: Galaxy): number => Math.floor(galaxyStarDate(galaxy) / YEAR_LENGTH);

function logIntrigue(galaxy: Galaxy, empire: Empire, text: string): void {
    const st = intrigueState(galaxy);
    st.events.push({ year: year(galaxy), empire, text });
    if (st.events.length > 200) st.events.splice(0, st.events.length - 200);
}

function tellPlayer(galaxy: Galaxy, empire: Empire, tag: string, args: unknown[], type: EmpireMessageType, subject: unknown = null): void {
    if (empire !== galaxy.playerEmpire) return;
    scenarioMessage(galaxy, empire, scenarioText(`${tag} Title`), scenarioText(tag, ...args), { type, subject: (subject ?? empire.capital) as never });
}

function isLeader(c: Character): boolean {
    return c.role === CharacterRole.Leader || c.role === CharacterRole.PirateLeader;
}

function politicsOn(galaxy: Galaxy, c: Character): boolean {
    return scenarioFlag(galaxy, POLITICS_FLAG) && isPoliticalEmpire(galaxy, c.empire) && canPlot(c);
}

/** Moves a character's 19d1 loyalty (no-op without internal politics / for leaders). */
function shiftLoyalty(galaxy: Galaxy, c: Character, amount: number, cause: string): void {
    if (!politicsOn(galaxy, c) || amount === 0) return;
    const e = politicsEntry(galaxy, c);
    e.loyalty = clamp(e.loyalty + amount, 0, 100);
    e.lastCauses.push({ cause, amount });
}

/** The IncidentEvaluation pattern (court.ts applyChancellor; the ported incidents): `of`'s evaluation of `about` moves. */
function shiftAttitude(galaxy: Galaxy, of: Empire, about: Empire, amount: number): void {
    if (of === about || amount === 0 || !isPoliticalEmpire(galaxy, of) || !isPoliticalEmpire(galaxy, about)) return;
    const ev = obtainEmpireEvaluation(galaxy, of, about);
    ev.incidentEvaluation = ev.incidentEvaluationRaw + amount;
}

function met(a: Empire, b: Empire): boolean {
    const rel = a.diplomaticRelations.byEmpire(b);
    return rel !== null && rel.type !== DiplomaticRelationType.NotMet;
}

function atWar(a: Empire, b: Empire): boolean {
    const rel = a.diplomaticRelations.byEmpire(b);
    return rel !== null && rel.type === DiplomaticRelationType.War;
}

/** `of`'s IncidentEvaluation-based overall attitude to `about` without creating an evaluation (0 when none). Pure. */
function attitudePeek(of: Empire, about: Empire): number {
    const list = of.empireEvaluations as { empire: Empire | null; overallAttitude: number }[] | null;
    return list?.find((x) => x.empire === about)?.overallAttitude ?? 0;
}

let traitCache: Map<string, CharacterTraitType> | null = null;
function trait(name: string): CharacterTraitType {
    traitCache ??= new Map();
    let t = traitCache.get(name);
    if (t === undefined) {
        t = (CharacterTraitType as unknown as Record<string, CharacterTraitType>)[name] ?? CharacterTraitType.Undefined;
        traitCache.set(name, t);
    }
    return t;
}
const hasTrait = (c: Character, name: string): boolean => c.traits.includes(trait(name));

// ---------------------------------------------------------------------------------------------------------------
// 6. Secrets & hooks
// ---------------------------------------------------------------------------------------------------------------

function isConvert(galaxy: Galaxy, c: Character): boolean {
    if (!scenarioFlag(galaxy, CULT_FLAG)) return false;
    const cst = peekCultState(galaxy);
    return cst !== null && cst.converted.some((r) => r.character === c);
}

/** Does `c` carry this secret now? (scheme: the character ran a scheme that is on record.) Pure. */
export function secretApplies(galaxy: Galaxy, c: Character, kind: SecretKind): boolean {
    if (!c.active) return false;
    switch (kind) {
        case 'corruption':
            return c.traits.includes(CharacterTraitType.Corrupt);
        case 'cult':
            return isConvert(galaxy, c);
        case 'defection': {
            if (!scenarioFlag(galaxy, POLITICS_FLAG) || !canPlot(c) || !isPoliticalEmpire(galaxy, c.empire)) return false;
            const e = peekPoliticsState(galaxy)?.chars.get(c);
            return e !== undefined && e.loyalty < 25 && defectionTarget(galaxy, c, c.empire) !== null;
        }
        case 'scheme':
            return (peekIntrigueState(galaxy)?.schemes ?? []).some((s) => s.agent === c && s.state !== 'running');
    }
}

/** The secrets `c` carries (pure; in SECRET_KINDS order). */
export function secretsOf(galaxy: Galaxy, c: Character): SecretKind[] {
    return SECRET_KINDS.filter((k) => secretApplies(galaxy, c, k));
}

const SECRET_PACKAGE = '19n.secret.';

function secretKindOfThing(t: HiddenThing): SecretKind | null {
    return t.package.startsWith(SECRET_PACKAGE) ? (t.package.substring(SECRET_PACKAGE.length) as SecretKind) : null;
}

/** Yearly: every secret (corruption / cult / defection) of a court character is a hidden thing of its own empire. */
export function registerSecrets(galaxy: Galaxy): void {
    for (const empire of galaxy.empires) {
        if (!isPoliticalEmpire(galaxy, empire)) continue;
        for (const c of getEmpireCharacters(empire)) {
            if (!c.active || c.empire !== empire) continue;
            for (const kind of ['corruption', 'cult', 'defection'] as const) {
                if (!secretApplies(galaxy, c, kind)) continue;
                registerHiddenThing(galaxy, { kind: 'secret', concealment: P.secretConcealment(galaxy) + Math.max(0, c.concealment), empire, target: c, package: `${SECRET_PACKAGE}${kind}` });
            }
        }
    }
}

export function hookById(galaxy: Galaxy, id: number): Hook | null {
    return peekIntrigueState(galaxy)?.hooks.find((h) => h.id === id) ?? null;
}

/** The live hooks `holder` has (pure). */
export function hooksOf(galaxy: Galaxy, holder: Empire): Hook[] {
    return (peekIntrigueState(galaxy)?.hooks ?? []).filter((h) => h.holder === holder && !h.used && h.character.active);
}

/** A live hook of `holder` on `c` (pure). */
export function hookOn(galaxy: Galaxy, holder: Empire, c: Character): Hook | null {
    return hooksOf(galaxy, holder).find((h) => h.character === c) ?? null;
}

/** `holder` learns `c`'s secret: a hook (one live hook per holder, character and secret). No Rnd. */
export function grantHook(galaxy: Galaxy, holder: Empire, c: Character, secret: SecretKind): Hook | null {
    if (!intrigueOn(galaxy) || !c.active || !isPoliticalEmpire(galaxy, holder)) return null;
    const st = intrigueState(galaxy);
    const have = st.hooks.find((h) => h.holder === holder && h.character === c && h.secret === secret && !h.used);
    if (have !== undefined) return have;
    const h: Hook = { id: st.nextHook++, holder, character: c, secret, since: galaxyStarDate(galaxy), used: false };
    st.hooks.push(h);
    logIntrigue(galaxy, holder, scenarioText('Court Hook Gained', c.name, secretLabel(secret)));
    tellPlayer(galaxy, holder, 'Court Hook Gained', [c.name, secretLabel(secret)], EmpireMessageType.GeneralGoodEvent, c);
    return h;
}

export function secretLabel(k: SecretKind): string {
    return scenarioText(`Court Secret ${k}`);
}

/** Why `holder` cannot force `act` with `hook` (null: it can). Direct compliance needs one of our own characters. Pure. */
export function complianceBlocked(galaxy: Galaxy, holder: Empire, hook: Hook | null, act: ComplianceAct, seat: SeatName | null, viaBlackmail = false): string | null {
    if (!intrigueOn(galaxy)) return 'Court intrigue is off';
    if (hook === null || hook.holder !== holder || hook.used) return 'No such hook';
    const c = hook.character;
    if (!c.active || c.empire === null) return 'Gone';
    const own = c.empire === holder;
    if (!own && !viaBlackmail) return 'A foreign character: run a blackmail scheme';
    switch (act) {
        case 'seat':
            if (own) {
                if (seat === null) return 'No seat';
                if (isLeader(c) || !seatEligible(c, seat)) return 'Not eligible for the seat';
                return null;
            }
            return seatOf(galaxy, c) === null ? 'Holds no seat' : null;
        case 'withdraw':
            return (peekCourtState(galaxy)?.factions ?? []).some((f) => f.members.includes(c)) ? null : 'In no faction';
        case 'abandonPlot':
            return politicsOn(galaxy, c) ? null : 'No plot';
    }
}

/**
 * The character acts as told once (no Rnd): 'seat' — our character takes the seat (a foreign one vacates theirs);
 * 'withdraw' — it leaves its faction (dissolved below the minimum or without its leader); 'abandonPlot' — its 19d1
 * ambition drops to 0, loyalty to at least 50, the plot's exposure and hidden thing end.
 */
export function applyCompliance(galaxy: Galaxy, holder: Empire, c: Character, act: ComplianceAct, seat: SeatName | null): boolean {
    const empire = c.empire;
    if (empire === null) return false;
    switch (act) {
        case 'seat': {
            if (empire === holder) return seat !== null && appointToSeat(galaxy, empire, seat, c).ok;
            const s = seatOf(galaxy, c);
            return s !== null && appointToSeat(galaxy, empire, s, null).ok;
        }
        case 'withdraw': {
            const cst = courtState(galaxy);
            let any = false;
            for (const f of [...cst.factions]) {
                if (!f.members.includes(c)) continue;
                any = true;
                f.members = f.members.filter((m) => m !== c);
                if (f.leader === c || f.members.length < COURT_PARAMS.factionMin(galaxy)) cst.factions.splice(cst.factions.indexOf(f), 1);
            }
            return any;
        }
        case 'abandonPlot': {
            if (!politicsOn(galaxy, c)) return false;
            const e = politicsEntry(galaxy, c);
            e.ambition = 0;
            e.loyalty = Math.max(e.loyalty, 50);
            politicsState(galaxy).exposed.delete(c);
            retireHiddenTarget(galaxy, 'plot', c, 'abandoned');
            return true;
        }
    }
}

/**
 * Expose a secret publicly (no Rnd): the character's loyalty −courtExposeLoyalty, its house's prestige
 * −courtExposePrestige, the leader's legitimacy −courtExposeLegitimacy when the character is the leader (half when of
 * the ruling house); the secret's hidden thing ends and every hook on that secret is spent.
 */
export function exposeSecret(galaxy: Galaxy, holder: Empire, c: Character, secret: SecretKind): void {
    const empire = c.empire;
    shiftLoyalty(galaxy, c, -P.exposeLoyalty(galaxy), 'Exposed');
    const h = houseOf(galaxy, c);
    if (h !== null) addPrestige(h, -P.exposePrestige(galaxy));
    if (empire !== null && isPoliticalEmpire(galaxy, empire)) {
        const leader = empire.leader;
        const hit = leader === c ? P.exposeLegitimacy(galaxy) : h !== null && h === rulingHouse(galaxy, empire) ? P.exposeLegitimacy(galaxy) / 2 : 0;
        if (leader !== null && hit > 0) courtState(galaxy).legitimacy.set(leader, clamp(leaderLegitimacy(galaxy, empire) - hit, 0, 100));
    }
    const st = intrigueState(galaxy);
    for (const x of st.hooks) if (x.character === c && x.secret === secret) x.used = true;
    const sec = peekSecurityState(galaxy);
    if (sec !== null) for (const t of sec.things) if (!t.retired && t.target === c && t.kind === 'secret' && secretKindOfThing(t) === secret) retireHiddenThing(galaxy, t, 'exposed');
    const text = scenarioText('Court Exposed', c.name, secretLabel(secret), holder.name);
    logIntrigue(galaxy, holder, text);
    if (empire !== null && empire !== holder) logIntrigue(galaxy, empire, text);
    tellPlayer(galaxy, holder, 'Court Exposed', [c.name, secretLabel(secret), holder.name], EmpireMessageType.GeneralNeutralEvent, c);
    if (empire !== null && empire !== holder) tellPlayer(galaxy, empire, 'Court Exposed', [c.name, secretLabel(secret), holder.name], EmpireMessageType.GeneralBadEvent, c);
}

export type HookAction = 'comply' | 'expose';

/** The player op `courtHook` (and the AI): spend a hook — force compliance on one of our characters, or expose. */
export function useHook(galaxy: Galaxy, empire: Empire, hookId: number, action: HookAction, act: ComplianceAct = 'abandonPlot', seat: SeatName | null = null): { ok: boolean; reason?: string } {
    const hook = hookById(galaxy, hookId);
    if (action === 'expose') {
        if (!intrigueOn(galaxy)) return { ok: false, reason: 'Court intrigue is off' };
        if (hook === null || hook.holder !== empire || hook.used || !hook.character.active) return { ok: false, reason: 'No such hook' };
        exposeSecret(galaxy, empire, hook.character, hook.secret);
        return { ok: true };
    }
    const why = complianceBlocked(galaxy, empire, hook, act, seat);
    if (why !== null || hook === null) return { ok: false, reason: why ?? 'No such hook' };
    if (!applyCompliance(galaxy, empire, hook.character, act, seat)) return { ok: false, reason: 'Nothing to do' };
    hook.used = true;
    logIntrigue(galaxy, empire, scenarioText('Court Complied', hook.character.name, scenarioText(`Court Act ${act}`)));
    return { ok: true };
}

/** AI rule for hooks on its own characters: a faction member withdraws, a would-be plotter abandons the plot. Pure. */
export function aiOwnHookAct(galaxy: Galaxy, empire: Empire, hook: Hook): ComplianceAct | null {
    if (complianceBlocked(galaxy, empire, hook, 'withdraw', null) === null) return 'withdraw';
    const e = peekPoliticsState(galaxy)?.chars.get(hook.character);
    if (e !== undefined && e.loyalty < 35 && e.ambition > 50 && complianceBlocked(galaxy, empire, hook, 'abandonPlot', null) === null) return 'abandonPlot';
    return null;
}

/** A foreign character in power (leader, heir, seat holder). */
function inPower(galaxy: Galaxy, c: Character): boolean {
    const e = c.empire;
    if (e === null) return false;
    return isLeader(c) || seatOf(galaxy, c) !== null || peekCourtState(galaxy)?.heirs.get(e) === c;
}

/** One AI empire's hooks: own characters comply; a hook on a hostile empire's ruler / heir / councillor is exposed. */
export function aiHooks(galaxy: Galaxy, empire: Empire): void {
    for (const hook of hooksOf(galaxy, empire)) {
        const c = hook.character;
        if (c.empire === empire) {
            const act = aiOwnHookAct(galaxy, empire, hook);
            if (act !== null) useHook(galaxy, empire, hook.id, 'comply', act);
        } else if (c.empire !== null && inPower(galaxy, c) && attitudePeek(empire, c.empire) < -10) {
            useHook(galaxy, empire, hook.id, 'expose');
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Schemes
// ---------------------------------------------------------------------------------------------------------------

/** Built lazily: this module loads inside an import cycle with espionage.ts (via packages.ts). */
let schemeTypes: Record<SchemeKind, IntelligenceMissionType> | null = null;
function schemeType(k: SchemeKind): IntelligenceMissionType {
    schemeTypes ??= {
        sway: IntelligenceMissionType.CourtSway,
        blackmail: IntelligenceMissionType.CourtBlackmail,
        sabotageLoyalty: IntelligenceMissionType.CourtSabotageLoyalty,
        assassinate: IntelligenceMissionType.CourtAssassinate,
    };
    return schemeTypes[k];
}

export function schemeLabel(k: SchemeKind): string {
    return scenarioText(`Court Scheme ${k}`);
}

/** Agents of `empire` free for a scheme: active, idle or on counter-intelligence, not investigating a 19m lead. Pure. */
export function schemeAgents(galaxy: Galaxy, empire: Empire): Character[] {
    const busy = new Set(peekSecurityState(galaxy)?.investigations.map((i) => i.agent) ?? []);
    return getEmpireCharacters(empire).filter((c) => {
        if (!c.active || c.role !== CharacterRole.IntelligenceAgent || c.empire !== empire || busy.has(c)) return false;
        const m = characterMission(c);
        return m === null || m.type === IntelligenceMissionType.Undefined || m.type === IntelligenceMissionType.CounterIntelligence;
    });
}

export function runningScheme(galaxy: Galaxy, empire: Empire, target: Character): Scheme | null {
    return peekIntrigueState(galaxy)?.schemes.find((s) => s.state === 'running' && s.empire === empire && s.target === target) ?? null;
}

/** Why `agent` cannot run `kind` against `target` (null: it can). Pure. */
export function schemeBlocked(galaxy: Galaxy, empire: Empire, agent: Character | null, kind: SchemeKind, target: Character | null): string | null {
    if (!intrigueOn(galaxy)) return 'Court intrigue is off';
    if (!SCHEME_KINDS.includes(kind)) return 'No such scheme';
    if (agent === null || !schemeAgents(galaxy, empire).includes(agent)) return 'Agent unavailable';
    if (target === null || !target.active || target === agent || !isPoliticalEmpire(galaxy, target.empire)) return 'No such target';
    const own = target.empire === empire;
    if (own && isLeader(target)) return 'Not our leader';
    if (!own && !met(empire, target.empire)) return 'Not met';
    if (kind === 'assassinate' && own) return 'Not our own character';
    if (kind === 'blackmail' && hookOn(galaxy, empire, target) === null) return 'Needs a hook (a secret)';
    if (runningScheme(galaxy, empire, target) !== null) return 'Already a scheme against them';
    return null;
}

/**
 * The player op `courtScheme` (and the AI): the agent takes a court scheme mission (espionage.ts newCourtSchemeMission,
 * the ported mission length cascade). A foreign scheme is a 19m hidden thing in the victim's empire (concealment: the
 * agent's ConcealmentFactored + courtSchemeConcealment). Blackmail names the act it forces (the AI's pick by default).
 */
export function startScheme(galaxy: Galaxy, empire: Empire, agent: Character, kind: SchemeKind, target: Character, act: ComplianceAct | null = null, seat: SeatName | null = null): { ok: boolean; reason?: string; scheme?: Scheme } {
    const why = schemeBlocked(galaxy, empire, agent, kind, target);
    if (why !== null) return { ok: false, reason: why };
    const st = intrigueState(galaxy);
    const now = galaxyCurrentStarDate(galaxy);
    const mission = newCourtSchemeMission(empire, agent, schemeType(kind), now, target);
    agent.mission = mission;
    const hook = kind === 'blackmail' ? hookOn(galaxy, empire, target) : null;
    const s: Scheme = {
        id: st.nextScheme++,
        kind,
        agent,
        empire,
        target,
        targetEmpire: target.empire!,
        mission,
        start: now,
        state: 'running',
        ended: 0,
        discovered: false,
        thingId: null,
        hookId: hook?.id ?? 0,
        act,
        seat,
    };
    st.schemes.push(s);
    if (s.targetEmpire !== empire) {
        const thing = registerHiddenThing(galaxy, {
            kind: 'scheme',
            concealment: Math.max(1, agent.concealmentFactored + P.schemeConcealment(galaxy)),
            empire: s.targetEmpire,
            target: agent,
            package: `19n.scheme#${s.id}`,
        });
        s.thingId = thing?.id ?? null;
    }
    logIntrigue(galaxy, empire, scenarioText('Court Scheme Started', agent.name, schemeLabel(kind), target.name));
    return { ok: true, scheme: s };
}

function schemeOfMission(galaxy: Galaxy, mission: IntelligenceMission): Scheme | null {
    return peekIntrigueState(galaxy)?.schemes.find((s) => s.mission === mission && s.state === 'running') ?? null;
}

function schemeOfThing(galaxy: Galaxy, thing: HiddenThing): Scheme | null {
    return peekIntrigueState(galaxy)?.schemes.find((s) => s.thingId === thing.id) ?? null;
}

/** Blackmail's forced act when none was named (the AI rule): our character abandons a plot or leaves a faction; a foreign one leaves its seat or faction. */
export function aiBlackmailAct(galaxy: Galaxy, empire: Empire, hook: Hook): { act: ComplianceAct; seat: SeatName | null } {
    const acts: ComplianceAct[] = hook.character.empire === empire ? ['abandonPlot', 'withdraw'] : ['seat', 'withdraw'];
    for (const a of acts) if (complianceBlocked(galaxy, empire, hook, a, null, true) === null) return { act: a, seat: null };
    return { act: acts[0], seat: null };
}

/** The effect of a successful scheme (no Rnd except the stock death path's). */
function applySchemeEffect(galaxy: Galaxy, s: Scheme): void {
    const t = s.target;
    const own = s.targetEmpire === s.empire;
    switch (s.kind) {
        case 'sway':
            if (own) shiftLoyalty(galaxy, t, P.swayLoyalty(galaxy), 'Swayed');
            else {
                shiftLoyalty(galaxy, t, -P.swayLoyalty(galaxy) / 2, 'Swayed');
                const st = intrigueState(galaxy);
                const o = st.opinions.find((x) => x.character === t && x.empire === s.empire);
                if (o === undefined) st.opinions.push({ character: t, empire: s.empire, value: P.swayLoyalty(galaxy) });
                else o.value = Math.min(100, o.value + P.swayLoyalty(galaxy));
            }
            digDirt(galaxy, s);
            break;
        case 'sabotageLoyalty':
            shiftLoyalty(galaxy, t, -P.sabotageLoyalty(galaxy), 'Sabotage');
            digDirt(galaxy, s);
            break;
        case 'blackmail': {
            const hook = hookById(galaxy, s.hookId);
            if (hook === null || hook.used || !hook.character.active) return;
            const pick = s.act !== null ? { act: s.act, seat: s.seat } : aiBlackmailAct(galaxy, s.empire, hook);
            if (complianceBlocked(galaxy, s.empire, hook, pick.act, pick.seat, true) === null) applyCompliance(galaxy, s.empire, t, pick.act, pick.seat);
            // A concession: a foreign ruler pays courtBlackmailConcessionPct% of the treasury.
            if (!own && isLeader(t) && t.empire !== null) {
                const amount = Math.max(0, t.empire.stateMoney * P.blackmailConcessionPct(galaxy)) / 100;
                t.empire.stateMoney -= amount;
                s.empire.stateMoney += amount;
            }
            hook.used = true;
            break;
        }
        case 'assassinate':
            // Empire.6.cs 117 CompleteIntelligenceMission, case AssassinateCharacter: the stock death path.
            if (t.active) {
                characterSendDeathMessage(galaxy, t, CharacterDeathType.Assassination);
                t.kill(galaxy);
            }
            break;
    }
}

/** A successful sway / sabotage scheme digs up the target's secrets: the schemer gains hooks. */
function digDirt(galaxy: Galaxy, s: Scheme): void {
    for (const k of secretsOf(galaxy, s.target)) grantHook(galaxy, s.empire, s.target, k);
}

/**
 * The victim learns who schemed (a detected outcome, a capture, a confirmed 19m lead): its evaluation of the schemer
 * drops (courtSchemeIncident; courtAssassinationIncident for an assassination), it gains a hook on the agent (secret
 * "scheme") and, for an assassination, a casus belli claim on the schemer's capital. No Rnd.
 */
export function schemeDiscovered(galaxy: Galaxy, s: Scheme): void {
    if (s.discovered) return;
    s.discovered = true;
    const victim = s.targetEmpire;
    const schemer = s.empire;
    if (victim === schemer) {
        // Our own character learned we schemed against them: they resent it.
        shiftLoyalty(galaxy, s.target, -P.schemeIncident(galaxy), 'Scheme');
        return;
    }
    if (!isPoliticalEmpire(galaxy, victim) || !isPoliticalEmpire(galaxy, schemer)) return;
    shiftAttitude(galaxy, victim, schemer, -(s.kind === 'assassinate' ? P.assassinationIncident(galaxy) : P.schemeIncident(galaxy)));
    if (s.agent.active) grantHook(galaxy, victim, s.agent, 'scheme');
    if (s.kind === 'assassinate' && schemer.capital !== null) addClaim(galaxy, victim, rulingHouse(galaxy, victim)?.id ?? null, schemer.capital, 'casusBelli', P.casusBelliStrength(galaxy), 0, schemer);
    const text = scenarioText('Court Scheme Discovered', schemer.name, schemeLabel(s.kind), s.target.name, s.agent.name);
    logIntrigue(galaxy, victim, text);
    tellPlayer(galaxy, victim, 'Court Scheme Discovered', [schemer.name, schemeLabel(s.kind), s.target.name, s.agent.name], EmpireMessageType.GeneralWarning, s.agent);
    tellPlayer(galaxy, schemer, 'Court Scheme Exposed', [s.agent.name, schemeLabel(s.kind), victim.name], EmpireMessageType.GeneralBadEvent, s.agent);
}

/**
 * espionageHooks.courtScheme — a due scheme after the ported outcome roll (Empire.6.cs 16): success applies the
 * effect; a detected outcome (SucceedDetect / FailDetect / Capture) confirms the victim's 19m lead (or, without 19m,
 * tells it directly). The capture kill and the agent's return to counter-intelligence are the ported code's.
 */
export function resolveScheme(galaxy: Galaxy, self: Empire, mission: IntelligenceMission, agent: Character, outcome: number): void {
    const s = schemeOfMission(galaxy, mission);
    if (s === null || !intrigueOn(galaxy)) return;
    const O = IntelligenceMissionOutcome;
    const success = outcome === O.SucceedNotDetect || outcome === O.SucceedDetect;
    const detected = outcome === O.SucceedDetect || outcome === O.FailDetect || outcome === O.Capture;
    s.state = success ? 'succeeded' : outcome === O.Capture ? 'captured' : 'failed';
    s.ended = galaxyStarDate(galaxy);
    if (success) applySchemeEffect(galaxy, s);
    if (detected) discoverScheme(galaxy, s);
    const tag = success ? 'Court Scheme Succeeded' : 'Court Scheme Failed';
    logIntrigue(galaxy, self, scenarioText(tag, agent.name, schemeLabel(s.kind), s.target.name));
    tellPlayer(galaxy, self, tag, [agent.name, schemeLabel(s.kind), s.target.name], success ? EmpireMessageType.CharacterMissionAccomplished : EmpireMessageType.CharacterMissionFailure, agent);
}

/** A detection: the victim's lead on the scheme is confirmed through 19m (its message and reaction), else told directly. */
function discoverScheme(galaxy: Galaxy, s: Scheme): void {
    const thing = s.thingId === null ? null : (peekSecurityState(galaxy)?.things.find((t) => t.id === s.thingId) ?? null);
    if (thing !== null && !thing.retired) {
        const lead = setLeadLevel(galaxy, thing, s.targetEmpire, 'confirmed', 'package');
        if (lead !== null) onLeadChanged(galaxy, lead, thing);
    }
    schemeDiscovered(galaxy, s);
}

/** securitySlots.courtThingAlive: a scheme lives while running (agent active) and courtSchemeTraceYears after it ends; a secret while it applies. */
export function courtThingAlive(galaxy: Galaxy, t: HiddenThing): boolean {
    if (t.kind === 'secret') {
        const k = secretKindOfThing(t);
        const c = t.target as Character;
        return k !== null && c.empire === t.empire && secretApplies(galaxy, c, k);
    }
    if (t.kind === 'scheme') {
        const s = schemeOfThing(galaxy, t);
        if (s === null || s.discovered) return false;
        if (s.state === 'running') return s.agent.active;
        return galaxyStarDate(galaxy) - s.ended <= P.schemeTraceYears(galaxy) * YEAR_LENGTH;
    }
    return false;
}

/** securitySlots.courtLeadChanged: a confirmed secret → a hook for the lead's empire; a confirmed scheme → discovered. */
export function courtLeadChanged(galaxy: Galaxy, lead: Lead, thing: HiddenThing): void {
    if (!intrigueOn(galaxy) || lead.level !== 'confirmed') return;
    if (thing.kind === 'secret') {
        const k = secretKindOfThing(thing);
        if (k !== null) grantHook(galaxy, lead.empire, thing.target as Character, k);
    } else if (thing.kind === 'scheme') {
        const s = schemeOfThing(galaxy, thing);
        if (s !== null) schemeDiscovered(galaxy, s);
    }
}

/** Yearly: schemes whose agent died on the mission (the victim's counter-intelligence captured it) or left it. */
export function sweepSchemes(galaxy: Galaxy): void {
    const st = intrigueState(galaxy);
    const now = galaxyStarDate(galaxy);
    for (const s of st.schemes) {
        if (s.state !== 'running') continue;
        if (!s.agent.active) {
            s.state = 'captured';
            s.ended = now;
            if (s.targetEmpire !== s.empire) schemeDiscovered(galaxy, s);
        } else if (s.agent.mission !== s.mission || !s.target.active) {
            s.state = 'failed';
            s.ended = now;
        }
    }
    // Bounded: drop ended schemes older than the trace window + 5 years.
    st.schemes = st.schemes.filter((s) => s.state === 'running' || now - s.ended <= (P.schemeTraceYears(galaxy) + 5) * YEAR_LENGTH);
}

function schemeSkill(agent: Character, kind: SchemeKind): number {
    switch (kind) {
        case 'sway':
        case 'sabotageLoyalty':
            return agent.psyOpsFactored;
        case 'blackmail':
            return agent.espionageFactored;
        case 'assassinate':
            return agent.assassinationFactored;
    }
}

/** A ruler's inclination to scheme: 1 + 0.5 per scheming trait − 0.4 per honest trait (0–3). Pure. */
export function schemeInclination(leader: Character | null): number {
    if (leader === null) return 1;
    let f = 1;
    for (const n of SCHEMING_TRAITS) if (hasTrait(leader, n)) f += 0.5;
    for (const n of HONEST_TRAITS) if (hasTrait(leader, n)) f -= 0.4;
    return clamp(f, 0, 3);
}

export interface SchemePlan {
    kind: SchemeKind;
    target: Character;
}

/**
 * The scheme an AI would run (pure; first match): blackmail a hostile ruler / heir / councillor it holds a hook on;
 * sway its most disloyal ambitious courtier; (ruthless rulers at war) assassinate the enemy's heir or marshal; sabotage
 * the loyalty of a hostile empire's least loyal governor.
 */
export function aiSchemePlan(galaxy: Galaxy, empire: Empire): SchemePlan | null {
    for (const h of hooksOf(galaxy, empire)) {
        const c = h.character;
        if (c.empire !== null && c.empire !== empire && inPower(galaxy, c) && attitudePeek(empire, c.empire) < 0 && runningScheme(galaxy, empire, c) === null) return { kind: 'blackmail', target: c };
    }
    const pst = peekPoliticsState(galaxy);
    const cst = peekCourtState(galaxy);
    if (pst !== null) {
        let best: Character | null = null;
        let bestScore = 0;
        const ruling = cst?.ruling.get(empire);
        for (const c of getEmpireCharacters(empire)) {
            if (!c.active || isLeader(c) || !canPlot(c) || runningScheme(galaxy, empire, c) !== null) continue;
            const e = pst.chars.get(c);
            if (e === undefined || e.loyalty >= 40 || e.ambition < 50 || cst?.members.get(c) === ruling) continue;
            const score = (100 - e.loyalty) * e.ambition;
            if (score > bestScore) {
                best = c;
                bestScore = score;
            }
        }
        if (best !== null) return { kind: 'sway', target: best };
    }
    const leader = empire.leader;
    const ruthless = leader !== null && RUTHLESS_TRAITS.some((n) => hasTrait(leader, n));
    for (const other of galaxy.empires) {
        if (other === empire || !isPoliticalEmpire(galaxy, other) || !met(empire, other)) continue;
        if (ruthless && atWar(empire, other)) {
            const heir = cst?.heirs.get(other) ?? null;
            const t = heir !== null && heir.active && heir.empire === other ? heir : seatHolder(galaxy, other, 'marshal');
            if (t !== null && runningScheme(galaxy, empire, t) === null) return { kind: 'assassinate', target: t };
        }
    }
    for (const other of galaxy.empires) {
        if (other === empire || !isPoliticalEmpire(galaxy, other) || !met(empire, other)) continue;
        if (!(atWar(empire, other) || attitudePeek(empire, other) < -10)) continue;
        let best: Character | null = null;
        let bestLoyalty = Infinity;
        for (const c of getEmpireCharacters(other)) {
            if (!c.active || c.role !== CharacterRole.ColonyGovernor || c.empire !== other || runningScheme(galaxy, empire, c) !== null) continue;
            const colony = governedColony(c);
            if (colony === null || colony === other.capital) continue;
            const l = pst?.chars.get(c)?.loyalty ?? 50;
            if (l < bestLoyalty) {
                best = c;
                bestLoyalty = l;
            }
        }
        if (best !== null) return { kind: 'sabotageLoyalty', target: best };
    }
    return null;
}

/** One AI empire's yearly scheme: a plan and a free agent → one roll (courtSchemePct% × the ruler's inclination). */
export function aiSchemes(galaxy: Galaxy, empire: Empire): Scheme | null {
    const agents = schemeAgents(galaxy, empire);
    if (agents.length === 0) return null;
    const plan = aiSchemePlan(galaxy, empire);
    if (plan === null) return null;
    let agent = agents[0];
    for (const a of agents) if (schemeSkill(a, plan.kind) > schemeSkill(agent, plan.kind)) agent = a;
    const chance = (P.schemePct(galaxy) / 100) * schemeInclination(empire.leader);
    if (chance <= 0) return null;
    // RND(19n): AI scheme roll
    if (!(galaxy.rnd.nextDouble() < chance)) return null;
    return startScheme(galaxy, empire, agent, plan.kind, plan.target).scheme ?? null;
}

/** The success chance the ported roll will use for a scheme (UI). Pure. */
export function schemeSkillLevel(agent: Character, kind: SchemeKind): number {
    return getIntelligenceMissionSkillLevel(agent, { type: schemeType(kind), targetEmpire: null } as unknown as IntelligenceMission);
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Dynastic ties
// ---------------------------------------------------------------------------------------------------------------

export function tieLabel(k: TieKind): string {
    return scenarioText(`Court Tie ${k}`);
}

function liveTie(t: Tie): boolean {
    if (t.ended || !t.character.active) return false;
    switch (t.kind) {
        case 'envoy':
            return t.character.empire === t.from;
        case 'ward':
        case 'spouse':
            return t.character.empire === t.to;
        case 'lover':
            return t.partner !== null && t.partner.active;
    }
}

/** The live ties between two empires (either direction). Pure. */
export function tiesBetween(galaxy: Galaxy, a: Empire, b: Empire): Tie[] {
    return (peekIntrigueState(galaxy)?.ties ?? []).filter((t) => liveTie(t) && ((t.from === a && t.to === b) || (t.from === b && t.to === a)));
}

export function empireTies(galaxy: Galaxy, e: Empire): Tie[] {
    return (peekIntrigueState(galaxy)?.ties ?? []).filter((t) => liveTie(t) && (t.from === e || t.to === e));
}

function tieCharacters(galaxy: Galaxy): Set<Character> {
    const out = new Set<Character>();
    for (const t of peekIntrigueState(galaxy)?.ties ?? []) if (liveTie(t)) out.add(t.character);
    return out;
}

/** Who `from` would send (pure): envoy — its best diplomat; ward / spouse — a ruling-house courtier (youngest / lowest rank). */
export function tieCandidate(galaxy: Galaxy, from: Empire, kind: TieKind): Character | null {
    const cst = peekCourtState(galaxy);
    if (cst === null) return null;
    const tied = tieCharacters(galaxy);
    const heir = cst.heirs.get(from);
    const pool = getEmpireCharacters(from).filter((c) => c.active && c.empire === from && !isLeader(c) && c !== heir && canPlot(c) && !tied.has(c) && seatOf(galaxy, c) === null);
    if (kind === 'envoy') {
        let best: Character | null = null;
        for (const c of pool) if (best === null || c.diplomacy > best.diplomacy) best = c;
        return best;
    }
    const ruling = cst.ruling.get(from);
    const house = pool.filter((c) => cst.members.get(c) === ruling);
    let best: Character | null = null;
    for (const c of house) {
        if (best === null) best = c;
        else if (kind === 'ward') {
            const bc = cst.born.get(c) ?? -1;
            const bb = cst.born.get(best) ?? -1;
            if (bc > bb || (bc === bb && courtRank(galaxy, c) < courtRank(galaxy, best))) best = c;
        } else if (courtRank(galaxy, c) < courtRank(galaxy, best)) best = c;
    }
    return best;
}

function acceptThreshold(galaxy: Galaxy, kind: TieKind): number {
    return kind === 'spouse' ? P.tieSpouseAccept(galaxy) : kind === 'ward' ? P.tieWardAccept(galaxy) : P.tieEnvoyAccept(galaxy);
}

export function tieAttitude(galaxy: Galaxy, kind: TieKind): number {
    return kind === 'spouse' ? P.tieSpouseAttitude(galaxy) : kind === 'ward' ? P.tieWardAttitude(galaxy) : P.tieEnvoyAttitude(galaxy);
}

/** Why `from` cannot propose a `kind` tie to `to` (null: it can). Pure. */
export function tieBlocked(galaxy: Galaxy, from: Empire, to: Empire, kind: TieKind): string | null {
    if (!intrigueOn(galaxy)) return 'Court intrigue is off';
    if (!TIE_KINDS.includes(kind)) return 'No such tie';
    if (from === to || !isPoliticalEmpire(galaxy, from) || !isPoliticalEmpire(galaxy, to)) return 'No such empire';
    if (!met(from, to)) return 'Not met';
    if (atWar(from, to)) return 'At war';
    if (tiesBetween(galaxy, from, to).some((t) => t.kind === kind)) return 'Already tied';
    if (tieCandidate(galaxy, from, kind) === null) return kind === 'envoy' ? 'No courtier to send' : 'No member of the ruling house to send';
    return null;
}

/** The receiver's answer (the AI rule, also for the player's proposals to an AI): overall attitude ≥ the kind's threshold. */
export function tieAcceptable(galaxy: Galaxy, to: Empire, from: Empire, kind: TieKind): boolean {
    let v = attitudePeek(to, from);
    // A swayed ruler or chancellor of the receiver leans toward the proposer.
    for (const o of peekIntrigueState(galaxy)?.opinions ?? []) if (o.empire === from && o.character.active && o.character.empire === to && inPower(galaxy, o.character)) v += o.value / 2;
    return v >= acceptThreshold(galaxy, kind);
}

/**
 * The tie takes effect (no Rnd): an immediate IncidentEvaluation gain both ways (2 × the yearly one); a ward or spouse
 * moves to the partner's court (Character.cs 4451 DefectToEmpire; a spouse joins the partner's ruling house); a spouse
 * sent from a ruling house to a ruled empire gives the house a claim on the partner's capital (succession).
 */
export function establishTie(galaxy: Galaxy, from: Empire, to: Empire, kind: TieKind, c: Character, partner: Character | null = null): Tie {
    const st = intrigueState(galaxy);
    const origin = houseOf(galaxy, c);
    const t: Tie = { id: st.nextTie++, kind, from, to, character: c, partner, originHouse: origin?.id ?? null, since: galaxyStarDate(galaxy), ended: false };
    st.ties.push(t);
    const bonus = kind === 'lover' ? P.tieEnvoyAttitude(galaxy) : tieAttitude(galaxy, kind);
    shiftAttitude(galaxy, to, from, 2 * bonus);
    shiftAttitude(galaxy, from, to, 2 * bonus);
    if (kind === 'ward' || kind === 'spouse') {
        c.mission = null;
        c.defectToEmpire(to, to.capital);
        const cst = courtState(galaxy);
        if (kind === 'spouse') {
            const rh = rulingHouse(galaxy, to);
            if (rh !== null) cst.members.set(c, rh.id);
            else ensureHouse(galaxy, c);
            const fromRuling = rulingHouse(galaxy, from);
            if (origin !== null && fromRuling !== null && origin === fromRuling && rh !== null && to.capital !== null) addClaim(galaxy, from, origin.id, to.capital, 'marriage', 0, t.id, null);
        } else ensureHouse(galaxy, c);
    }
    const text = scenarioText('Court Tie Made', tieLabel(kind), c.name, from.name, to.name);
    logIntrigue(galaxy, from, text);
    logIntrigue(galaxy, to, text);
    tellPlayer(galaxy, from, 'Court Tie Made', [tieLabel(kind), c.name, from.name, to.name], EmpireMessageType.GeneralGoodEvent, c);
    tellPlayer(galaxy, to, 'Court Tie Made', [tieLabel(kind), c.name, from.name, to.name], EmpireMessageType.GeneralGoodEvent, c);
    return t;
}

/**
 * A tie proposal (no Rnd): an AI receiver answers at once (tieAcceptable); the player receives a decision
 * (accept / decline) answered through the command queue.
 */
export function proposeTie(galaxy: Galaxy, from: Empire, to: Empire, kind: TieKind): { ok: boolean; accepted: boolean; reason?: string; tie?: Tie } {
    const why = tieBlocked(galaxy, from, to, kind);
    if (why !== null) return { ok: false, accepted: false, reason: why };
    const st = intrigueState(galaxy);
    const y = year(galaxy);
    const o = st.offers.find((x) => x.from === from && x.to === to);
    if (o === undefined) st.offers.push({ from, to, year: y });
    else o.year = y;
    const c = tieCandidate(galaxy, from, kind)!;
    if (isHumanEmpire(galaxy, to)) {
        raiseScenarioDecision(galaxy, to, {
            kind: TIE_DECISION,
            title: scenarioText('Court Tie Offer Title'),
            text: scenarioText('Court Tie Offer', from.name, tieLabel(kind), c.name),
            options: [
                { id: 'accept', label: scenarioText('Court Option Accept') },
                { id: 'decline', label: scenarioText('Court Option Decline') },
            ],
            defaultOption: 'decline',
            expiresDays: 180,
            context: { from: from.empireId, kind },
        });
        return { ok: true, accepted: false };
    }
    if (!tieAcceptable(galaxy, to, from, kind)) {
        logIntrigue(galaxy, from, scenarioText('Court Tie Refused', to.name, tieLabel(kind)));
        return { ok: true, accepted: false, reason: 'Refused' };
    }
    return { ok: true, accepted: true, tie: establishTie(galaxy, from, to, kind, c) };
}

registerScenarioDecision({
    id: TIE_DECISION,
    kind: TIE_DECISION,
    flag: INTRIGUE_FLAG,
    resolve: (galaxy, d: ScenarioDecision, optionId) => {
        if (optionId !== 'accept') return;
        const from = galaxy.empires.find((e) => e.empireId === d.context.from) ?? null;
        const kind = d.context.kind as TieKind;
        if (from === null || tieBlocked(galaxy, from, d.empire, kind) !== null) return;
        establishTie(galaxy, from, d.empire, kind, tieCandidate(galaxy, from, kind)!);
    },
    aiChoose: (galaxy, d) => {
        const from = galaxy.empires.find((e) => e.empireId === d.context.from) ?? null;
        return from !== null && tieAcceptable(galaxy, d.empire, from, d.context.kind as TieKind) ? 'accept' : 'decline';
    },
});

/** The kind an AI proposes to `to` (pure): a spouse when both are ruled by houses and friendly enough, else a ward, else an envoy. */
export function aiTieKind(galaxy: Galaxy, from: Empire, to: Empire): TieKind | null {
    for (const k of ['spouse', 'ward', 'envoy'] as const) if (tieBlocked(galaxy, from, to, k) === null && attitudePeek(from, to) >= acceptThreshold(galaxy, k)) return k;
    return null;
}

/** One AI empire's yearly tie proposal: to the first empire it befriends / allies / placates (throttled), one roll. */
export function aiTies(galaxy: Galaxy, empire: Empire): Tie | null {
    const st = intrigueState(galaxy);
    const y = year(galaxy);
    for (const other of galaxy.empires) {
        if (other === empire || !isPoliticalEmpire(galaxy, other)) continue;
        const rel = empire.diplomaticRelations.byEmpire(other);
        if (rel === null || rel.type === DiplomaticRelationType.NotMet || rel.type === DiplomaticRelationType.War) continue;
        if (rel.strategy !== DiplomaticStrategy.Befriend && rel.strategy !== DiplomaticStrategy.Ally && rel.strategy !== DiplomaticStrategy.Placate) continue;
        const o = st.offers.find((x) => x.from === empire && x.to === other);
        if (o !== undefined && y - o.year < P.tieProposalYears(galaxy)) continue;
        const kind = aiTieKind(galaxy, empire, other);
        if (kind === null) continue;
        // RND(19n): AI tie proposal
        if (!(galaxy.rnd.nextDouble() * 100 < P.tieProposalPct(galaxy))) return null;
        return proposeTie(galaxy, empire, other, kind).tie ?? null;
    }
    return null;
}

/** Yearly: live ties lend attitude both ways; a spouse between ruling houses leans toward a defensive pact; dead ties end. */
export function reviewTies(galaxy: Galaxy): void {
    const st = intrigueState(galaxy);
    for (const t of st.ties) {
        if (t.ended) continue;
        if (!liveTie(t)) {
            t.ended = true;
            st.claims = st.claims.filter((c) => !(c.cause === 'marriage' && c.tieId === t.id));
            continue;
        }
        const bonus = t.kind === 'lover' ? P.tieEnvoyAttitude(galaxy) : tieAttitude(galaxy, t.kind);
        shiftAttitude(galaxy, t.to, t.from, bonus);
        shiftAttitude(galaxy, t.from, t.to, bonus);
        if (t.kind === 'spouse' && st.claims.some((c) => c.tieId === t.id)) {
            // The defensive-pact lean: an AI side offers the stock mutual defence pact (Empire.8.cs OfferMutualDefense),
            // answered by the stock ConsiderTreatyProposals (Empire.3.cs 3606).
            for (const [a, b] of [[t.from, t.to], [t.to, t.from]] as const) {
                if (isHumanEmpire(galaxy, a) || !isPoliticalEmpire(galaxy, a) || !isPoliticalEmpire(galaxy, b)) continue;
                const rel = a.diplomaticRelations.byEmpire(b);
                if (rel !== null && (rel.type === DiplomaticRelationType.None || rel.type === DiplomaticRelationType.FreeTradeAgreement)) offerMutualDefense(galaxy, a, b);
            }
        }
    }
    if (st.ties.length > 200) st.ties = st.ties.filter((t) => !t.ended);
}

// Player proposals on the ported conversation (Main.Part9.cs:46 method_238 TREATY_PROPOSAL menu → method_237).
scenarioProposalSlots.options = (galaxy, player, other): ScenarioProposalOption[] => {
    if (!intrigueOn(galaxy)) return [];
    return TIE_KINDS.map((k) => {
        const why = tieBlocked(galaxy, player, other, k);
        return { id: `SCENARIO_COURT_TIE:${k}`, label: scenarioText(`Court Tie Propose ${k}`), enabled: why === null, hint: why ?? '' };
    });
};
scenarioProposalSlots.submit = (galaxy, player, other, id) => {
    const kind = id.substring('SCENARIO_COURT_TIE:'.length) as TieKind;
    const r = proposeTie(galaxy, player, other, kind);
    return { accepted: r.accepted, message: r.accepted ? scenarioText('Court Tie Accepted', other.name, tieLabel(kind)) : scenarioText('Court Tie Refused', other.name, tieLabel(kind)) };
};

// ---------------------------------------------------------------------------------------------------------------
// 8. Relationships
// ---------------------------------------------------------------------------------------------------------------

/** Trait compatibility of two characters (pure; symmetric). */
export function compatibility(galaxy: Galaxy, a: Character, b: Character): number {
    let v = 0;
    for (const t of a.traits) if (t !== CharacterTraitType.Undefined && b.traits.includes(t)) v += 10;
    for (const [x, y] of OPPOSED_TRAITS) {
        if ((hasTrait(a, x) && hasTrait(b, y)) || (hasTrait(a, y) && hasTrait(b, x))) v -= 15;
    }
    for (const n of SOCIABLE_TRAITS) v += (hasTrait(a, n) ? 5 : 0) + (hasTrait(b, n) ? 5 : 0);
    for (const n of ABRASIVE_TRAITS) v -= (hasTrait(a, n) ? 5 : 0) + (hasTrait(b, n) ? 5 : 0);
    if (a.race !== null && a.race === b.race) v += 5;
    else if (hasTrait(a, 'Xenophobic') || hasTrait(b, 'Xenophobic')) v -= 20;
    const ha = houseOf(galaxy, a);
    const hb = houseOf(galaxy, b);
    if (ha !== null && hb !== null) {
        if (ha === hb) v += 10;
        else if (areRivals(ha, hb)) v -= 20;
    }
    return clamp(v, -100, 100);
}

export function relationshipOf(galaxy: Galaxy, a: Character, b: Character): Relationship | null {
    return peekIntrigueState(galaxy)?.rels.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a)) ?? null;
}

/** The characters `c` relates to by `kind` (active; pure). */
export function relationsOf(galaxy: Galaxy, c: Character, kind: RelKind): Character[] {
    const out: Character[] = [];
    for (const r of peekIntrigueState(galaxy)?.rels ?? []) {
        if (r.kind !== kind) continue;
        const o = r.a === c ? r.b : r.b === c ? r.a : null;
        if (o !== null && o.active) out.push(o);
    }
    return out;
}

/** Friends count lovers too. */
function friendsOf(galaxy: Galaxy, c: Character): Character[] {
    return [...relationsOf(galaxy, c, 'friend'), ...relationsOf(galaxy, c, 'lover')];
}

/** Co-located groups: active court characters (no ship captains) at the same location, not transferring (first-seen order). */
function coLocated(galaxy: Galaxy): Character[][] {
    const groups = new Map<unknown, Character[]>();
    for (const e of galaxy.empires) {
        if (!isPoliticalEmpire(galaxy, e)) continue;
        for (const c of getEmpireCharacters(e)) {
            if (!c.active || c.empire !== e || c.role === CharacterRole.ShipCaptain || c.location === null || c.transferDestination !== null) continue;
            let g = groups.get(c.location);
            if (g === undefined) groups.set(c.location, (g = []));
            g.push(c);
        }
    }
    return [...groups.values()].filter((g) => g.length > 1);
}

function together(st: IntrigueState, a: Character, b: Character): Together {
    let t = st.together.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (t === undefined) st.together.push((t = { a, b, years: 0, seen: -1 }));
    return t;
}

/**
 * Yearly: every co-located pair counts a year together; after courtRelationshipYears one roll a year: no relation →
 * friends (chance courtRelationshipPct% × compatibility / 50) or rivals (the same × −compatibility / 50); friends of
 * compatibility ≥ 20 → lovers (courtLoverPct%). Lovers of two houses: a feud (courtLoverFeudPct%, one roll) or the
 * houses reconcile; lovers of two empires make a tie.
 */
export function reviewRelationships(galaxy: Galaxy, y: number): void {
    const st = intrigueState(galaxy);
    st.rels = st.rels.filter((r) => r.a.active && r.b.active);
    st.together = st.together.filter((t) => t.a.active && t.b.active);
    const minYears = P.relYears(galaxy);
    const scale = P.relPct(galaxy) / 100;
    for (const g of coLocated(galaxy)) {
        for (let i = 0; i < g.length; i++) {
            for (let j = i + 1; j < g.length; j++) {
                const a = g[i];
                const b = g[j];
                const t = together(st, a, b);
                if (t.seen === y) continue;
                t.seen = y;
                t.years++;
                if (t.years < minYears) continue;
                const rel = relationshipOf(galaxy, a, b);
                if (rel !== null && rel.kind !== 'friend') continue;
                const compat = compatibility(galaxy, a, b);
                if (rel === null) {
                    const pf = Math.min(0.9, (scale * Math.max(0, compat)) / 50);
                    const pr = Math.min(0.9, (scale * Math.max(0, -compat)) / 50);
                    if (pf <= 0 && pr <= 0) continue;
                    // RND(19n): relationship roll
                    const r = galaxy.rnd.nextDouble();
                    if (r < pf) formRelationship(galaxy, a, b, 'friend', y);
                    else if (r >= 1 - pr) formRelationship(galaxy, a, b, 'rival', y);
                } else if (compat >= 20 && !isLeader(a) && !isLeader(b)) {
                    // RND(19n): lovers roll
                    if (galaxy.rnd.nextDouble() * 100 < P.loverPct(galaxy)) {
                        rel.kind = 'lover';
                        rel.since = y;
                        loversAcrossHouses(galaxy, a, b, y);
                    }
                }
            }
        }
    }
}

export function formRelationship(galaxy: Galaxy, a: Character, b: Character, kind: RelKind, y: number): Relationship {
    const st = intrigueState(galaxy);
    let r = relationshipOf(galaxy, a, b);
    if (r === null) st.rels.push((r = { a, b, kind, since: y }));
    else {
        r.kind = kind;
        r.since = y;
    }
    if (a.empire !== null) logIntrigue(galaxy, a.empire, scenarioText(`Court Relationship ${kind}`, a.name, b.name));
    return r;
}

/** Lovers of two houses (one roll in the same empire): a feud, or the houses' rivalry ends; of two empires: a tie. */
export function loversAcrossHouses(galaxy: Galaxy, a: Character, b: Character, y: number): void {
    const ea = a.empire;
    const eb = b.empire;
    if (ea === null || eb === null) return;
    if (ea !== eb) {
        if (!tiesBetween(galaxy, ea, eb).some((t) => t.kind === 'lover' && ((t.character === a && t.partner === b) || (t.character === b && t.partner === a)))) establishTie(galaxy, ea, eb, 'lover', a, b);
        return;
    }
    const ha = houseOf(galaxy, a);
    const hb = houseOf(galaxy, b);
    if (ha === null || hb === null || ha === hb) return;
    // RND(19n): lovers' feud roll
    if (galaxy.rnd.nextDouble() * 100 < P.loverFeudPct(galaxy)) {
        makeRivals(ha, hb);
        feudIncident(galaxy, ea, ha, hb, y);
    } else if (areRivals(ha, hb)) {
        ha.rivals = ha.rivals.filter((x) => x !== hb.id);
        hb.rivals = hb.rivals.filter((x) => x !== ha.id);
        logIntrigue(galaxy, ea, scenarioText('Court Reconciled', ha.name, hb.name));
    }
}

/** Yearly: a character with rivals in its own empire loses courtRivalLoyalty (19d1 cause "Rival"). */
export function rivalLoyalty(galaxy: Galaxy): void {
    const amount = P.rivalLoyalty(galaxy);
    if (amount <= 0) return;
    for (const r of intrigueState(galaxy).rels) {
        if (r.kind !== 'rival' || r.a.empire !== r.b.empire) continue;
        shiftLoyalty(galaxy, r.a, -amount, 'Rival');
        shiftLoyalty(galaxy, r.b, -amount, 'Rival');
    }
}

function colonyGovernor(h: Habitat): Character | null {
    const chars = stellarObjectCharacters(h);
    if (chars === null) return null;
    for (const c of chars) if (c.active && c.role === CharacterRole.ColonyGovernor && c.empire === h.empire) return c;
    return null;
}

/** Ledger term "friends": +courtFriendApproval per friend of the governor at the colony, −courtRivalApproval per rival there. Pure. */
export function friendsTerm(galaxy: Galaxy, h: Habitat): number | null {
    if (!intrigueOn(galaxy) || peekIntrigueState(galaxy) === null) return null;
    const gov = colonyGovernor(h);
    if (gov === null) return null;
    const here = (c: Character): boolean => c.location === h && c.transferDestination === null;
    const f = friendsOf(galaxy, gov).filter(here).length;
    const r = relationsOf(galaxy, gov, 'rival').filter(here).length;
    const v = f * P.friendApproval(galaxy) - r * P.rivalApproval(galaxy);
    return v === 0 ? null : v;
}

/** Captain bonus points of a fleet whose admiral has friends in its empire: courtFriendFleetBonus per friend (max 2). Pure. */
export function friendFleetPoints(galaxy: Galaxy, admiral: Character): number {
    const n = friendsOf(galaxy, admiral).filter((c) => c.empire === admiral.empire).length;
    return Math.min(2, n) * P.friendFleetBonus(galaxy);
}

// ---------------------------------------------------------------------------------------------------------------
// 10. Claims
// ---------------------------------------------------------------------------------------------------------------

function addClaim(galaxy: Galaxy, empire: Empire, house: number | null, colony: Habitat, cause: ClaimCause, base: number, tieId: number, against: Empire | null): ClaimRecord {
    const st = intrigueState(galaxy);
    const have = st.claims.find((c) => c.empire === empire && c.colony === colony && c.cause === cause);
    if (have !== undefined) {
        have.base = Math.max(have.base, base);
        have.since = galaxyStarDate(galaxy);
        if (tieId !== 0) have.tieId = tieId;
        return have;
    }
    const c: ClaimRecord = { id: st.nextClaim++, house, empire, colony, cause, base, since: galaxyStarDate(galaxy), recognized: false, tieId, against };
    st.claims.push(c);
    logIntrigue(galaxy, empire, scenarioText('Court Claim', houseById(galaxy, house ?? undefined)?.name ?? empire.name, colony.name, scenarioText(`Court Claim Cause ${cause}`)));
    return c;
}

function claimStrength(galaxy: Galaxy, c: ClaimRecord): number {
    let v = c.base;
    if (c.cause === 'marriage') {
        const t = peekIntrigueState(galaxy)?.ties.find((x) => x.id === c.tieId) ?? null;
        if (t === null || !liveTie(t)) return 0;
        v = P.marriageClaim(galaxy) + (houseById(galaxy, c.house ?? undefined)?.prestige ?? 0) / 2;
    }
    if (c.recognized) v += P.recognitionBonus(galaxy);
    return clamp(v, 0, 100);
}

/**
 * The claims `empire`'s houses hold on colonies another empire owns (pure): {colony, strength 0–100, cause, house,
 * recognized, against}. Causes: 'former' (a colony the empire lost; decays yearly), 'marriage' (a spouse tie: the
 * partner's capital — its succession), 'casusBelli' (an assassination discovered: the offender's capital). The 19g-3
 * war goals read this list (see the header).
 */
export function claimsFor(galaxy: Galaxy, empire: Empire): Claim[] {
    if (!intrigueOn(galaxy)) return [];
    const out: Claim[] = [];
    for (const c of peekIntrigueState(galaxy)?.claims ?? []) {
        if (c.empire !== empire || c.colony.hasBeenDestroyed || c.colony.empire === empire || c.colony.empire === null) continue;
        const strength = claimStrength(galaxy, c);
        if (strength <= 0) continue;
        out.push({ colony: c.colony, strength, cause: c.cause, house: houseById(galaxy, c.house ?? undefined) ?? rulingHouse(galaxy, empire), recognized: c.recognized, against: c.against });
    }
    return out;
}

/** True while `victim` holds a casus belli against `offender` (pure). */
export function holdsCasusBelli(galaxy: Galaxy, victim: Empire, offender: Empire): boolean {
    return claimsFor(galaxy, victim).some((c) => c.cause === 'casusBelli' && c.against === offender);
}

/** The strongest foreign claim on a colony (pure; 0 = none). */
export function strongestClaimOn(galaxy: Galaxy, colony: Habitat): number {
    let best = 0;
    for (const c of peekIntrigueState(galaxy)?.claims ?? []) {
        if (c.colony !== colony || c.empire === colony.empire || !isPoliticalEmpire(galaxy, c.empire)) continue;
        best = Math.max(best, claimStrength(galaxy, c));
    }
    return best;
}

function onColonyOwnerChanged(galaxy: Galaxy, colony: Habitat, from: Empire | null, to: Empire | null): void {
    if (!intrigueOn(galaxy) || peekCourtState(galaxy)?.seeded !== true) return;
    if (from === null || from === to || !isPoliticalEmpire(galaxy, from)) return;
    addClaim(galaxy, from, rulingHouse(galaxy, from)?.id ?? null, colony, 'former', P.claimStart(galaxy), 0, null);
}

/** Yearly: former-ownership claims decay, casus belli expire, a seated chancellor recognizes its empire's claims. */
export function reviewClaims(galaxy: Galaxy): void {
    const st = intrigueState(galaxy);
    const now = galaxyStarDate(galaxy);
    for (const c of st.claims) {
        if (c.cause === 'former') c.base -= P.claimDecay(galaxy);
        if (!c.recognized && seatHolder(galaxy, c.empire, 'chancellor') !== null) c.recognized = true;
    }
    st.claims = st.claims.filter(
        (c) =>
            c.empire.active &&
            !c.colony.hasBeenDestroyed &&
            !(c.cause === 'former' && c.base <= 0) &&
            !(c.cause === 'casusBelli' && now - c.since > P.casusBelliYears(galaxy) * YEAR_LENGTH) &&
            !(c.cause === 'former' && c.colony.empire === c.empire),
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Plot weight (court.ts courtExtensions): rivals in power, claimed colonies
// ---------------------------------------------------------------------------------------------------------------

/**
 * Extra 19d1 plot weight (pure): × courtRivalInPowerPlotPct% when a rival of `c` rules or sits on the council (rivals
 * join the opposing side); × (1 + claim strength / 100 × courtClaimPlotPct%) for the governor of a colony another
 * empire's house claims (a secession toward the claimant).
 */
export function intriguePlotFactor(galaxy: Galaxy, empire: Empire, c: Character): number {
    if (!intrigueOn(galaxy) || peekIntrigueState(galaxy) === null) return 1;
    let f = 1;
    if (relationsOf(galaxy, c, 'rival').some((r) => r.empire === empire && (isLeader(r) || seatOf(galaxy, r) !== null))) f *= P.rivalPlotPct(galaxy) / 100;
    const colony = governedColony(c);
    if (colony !== null) {
        const s = strongestClaimOn(galaxy, colony);
        if (s > 0) f *= 1 + (s / 100) * (P.claimPlotPct(galaxy) / 100);
    }
    return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly handler, slots, registrations
// ---------------------------------------------------------------------------------------------------------------

/** Foreign sway opinions: a swayed ruler / councillor warms its empire to the schemer (value / 5 a year); decays 20%. */
function reviewOpinions(galaxy: Galaxy): void {
    const st = intrigueState(galaxy);
    for (const o of st.opinions) {
        const c = o.character;
        if (c.active && c.empire !== null && c.empire !== o.empire && inPower(galaxy, c)) shiftAttitude(galaxy, c.empire, o.empire, o.value / 5);
        o.value *= 0.8;
    }
    st.opinions = st.opinions.filter((o) => o.character.active && o.value >= 1);
}

/** The yearly handler (order 6: after the court's, before 19d1 plots and the 19m detection rolls). */
export function intrigueYearly(galaxy: Galaxy, y: number): void {
    if (!courtOn(galaxy) || peekCourtState(galaxy)?.seeded !== true) return;
    const st = intrigueState(galaxy);
    st.hooks = st.hooks.filter((h) => !h.used && h.character.active && isPoliticalEmpire(galaxy, h.holder));
    sweepSchemes(galaxy);
    registerSecrets(galaxy);
    reviewRelationships(galaxy, y);
    rivalLoyalty(galaxy);
    reviewTies(galaxy);
    reviewOpinions(galaxy);
    reviewClaims(galaxy);
    for (const e of galaxy.empires.filter((x) => isPoliticalEmpire(galaxy, x))) {
        if (isHumanEmpire(galaxy, e)) continue;
        aiHooks(galaxy, e);
        aiSchemes(galaxy, e);
        aiTies(galaxy, e);
    }
}

espionageHooks.courtScheme = (galaxy, self, mission, agent, outcome) => resolveScheme(galaxy, self, mission, agent, outcome);
securitySlots.courtThingAlive = (galaxy, t) => intrigueOn(galaxy) && courtThingAlive(galaxy, t);
securitySlots.courtLeadChanged = (galaxy, lead, thing) => courtLeadChanged(galaxy, lead, thing);
courtExtensions.plotScoreFactor = (galaxy, empire, c) => intriguePlotFactor(galaxy, empire, c);

registerScenarioYearly({ id: 'court.intrigue', flag: INTRIGUE_FLAG, order: 6, run: intrigueYearly });
registerScenarioEvent({ id: 'court.intrigue.claims', flag: INTRIGUE_FLAG, event: 'colonyOwnerChanged', run: (galaxy, p) => onColonyOwnerChanged(galaxy, p.colony, p.from, p.to) });
registerStabilityTerm({ id: 'court.friends', flag: INTRIGUE_FLAG, order: 62, cause: 'friends', label: 'Friends and rivals', run: (g, h) => friendsTerm(g, h) });
registerScenarioQuery({
    id: 'court.friends',
    flag: INTRIGUE_FLAG,
    query: 'captainBonuses',
    run: (galaxy, value, { builtObject, empire }) => {
        const group = builtObject.shipGroup;
        if (group === null || group === undefined || !intrigueOn(galaxy) || peekIntrigueState(galaxy) === null) return value;
        let pts = 0;
        for (const c of getEmpireCharacters(empire)) {
            if (c.active && c.role === CharacterRole.FleetAdmiral && c.determineFleet() === group) {
                pts = friendFleetPoints(galaxy, c);
                break;
            }
        }
        if (pts <= 0) return value;
        return { ...value, repair: Math.min(200, value.repair + pts), damageControl: Math.min(200, value.damageControl + pts) };
    },
});

/** The intrigue chronicle of an empire (UI). */
export function intrigueEvents(galaxy: Galaxy, empire: Empire): IntrigueEvent[] {
    return (peekIntrigueState(galaxy)?.events ?? []).filter((e) => e.empire === empire);
}

/** Seat skill re-export for the UI (which seat a forced appointment would suit). */
export function bestSeatFor(c: Character): SeatName | null {
    let best: SeatName | null = null;
    let bestV = -Infinity;
    for (const s of SEATS) {
        if (!seatEligible(c, s)) continue;
        const v = seatSkill(c, s);
        if (v > bestV) {
            best = s;
            bestV = v;
        }
    }
    return best;
}
