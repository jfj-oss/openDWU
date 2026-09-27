// 19p event log (tasks/19-mod-layer-scenarios.md §19p). Not a port: a scenario-side mirror of what happened in the
// galaxy — one typed, append-only list of events {date, category, importance, actors, place, text key + args, data,
// source package} that the scenario message helpers (scenario/messages.ts scenarioMessage / scenarioNews) and the
// ported empire messages (messages.ts sendEmpireMessage, the sink of Empire.7.cs SendMessageToEmpire and of the
// Galactic NewsNet broadcast, events.ts SendNewsBroadcastCore) feed. Consumers: the Galactic History screen (category
// filter / importance sort), chronicleExport (chronicle.ts; the future local-model chronicle 19e-4 and the replay
// theatre 19e-1) and the `?eventLog=dump` dev URL.
//
// Gate: flag `eventLog` (scenarios/event-log/scenario.json). Every tap returns at once with the flag off, so the game
// is byte-identical; with it on the log only writes its own scenario state bag (never galaxy.rnd, never sim state).
// Text is never stored resolved: a scenario entry keeps the GameText tag + args of its scenarioText call, a ported
// entry keeps the deferred gameText() encoding (`tag|arg|…`) split into tag + args; chronicle.ts resolves them.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { Empire as EmpireClass } from '../../empire';
import { BuiltObject } from '../../builtObject';
import { Habitat } from '../../types';
import { Character } from '../../characters';
import { DiplomaticRelationType } from '../../diplomacy';
import { EmpireMessage, EmpireMessageType, setEmpireMessageTap } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';

export const EVENT_LOG_FLAG = 'eventLog';
export const EVENT_LOG_STATE_KEY = 'eventLog';
/** Default ring size (param `eventLogSize`). */
export const EVENT_LOG_DEFAULT_SIZE = 5000;

// ---------------------------------------------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------------------------------------------

export const EVENT_CATEGORIES = ['war', 'diplomacy', 'politics', 'economy', 'exploration', 'threat', 'character', 'rim', 'council', 'pirate', 'story', 'other'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type EventImportance = 0 | 1 | 2 | 3;

/** An actor: an empire (independents included), a pirate faction (an empire id in the pirate list) or a character
 *  (an index into the log's own character registry — the port's Character has no id). */
export interface ActorRef {
    kind: 'empire' | 'faction' | 'character';
    id: number;
}

/** Where it happened: a habitat (Habitat.HabitatIndex + its SystemIndex), a system, or just a point. */
export interface EventPlace {
    habitat?: number;
    system?: number;
    x: number;
    y: number;
}

/** How textKey + args resolve: `scenario` = scenarioText(key, ...args); `game` = resolveGameText([key, ...args].join('|')). */
export type EventTextFormat = 'scenario' | 'game';

export interface EventLogEntry {
    id: number;
    starDate: number;
    category: EventCategory;
    importance: EventImportance;
    actors: ActorRef[];
    /** Empire ids that received the message (the player's history view reads it). */
    seenBy: number[];
    place: EventPlace | null;
    textKey: string;
    args: (string | number)[];
    textFormat: EventTextFormat;
    titleKey?: string;
    titleArgs?: (string | number)[];
    /** Small JSON: the EmpireMessageType name (`msg`), `news` for broadcasts, a money amount, … */
    data: Record<string, string | number | boolean> | null;
    /** Package id (scenario id: 'emergent', 'cult', …) or 'game' for the ported messages. */
    source: string;
}

/** The saved state bag (plain data plus the character registry — Character references, saved as graph objects). */
export interface EventLogState {
    nextId: number;
    entries: EventLogEntry[];
    characters: Character[];
}

export function eventLogOn(galaxy: Galaxy | null | undefined): boolean {
    return galaxy != null && galaxy.scenario != null && scenarioFlag(galaxy, EVENT_LOG_FLAG);
}

export function eventLogState(galaxy: Galaxy): EventLogState {
    return scenarioState<EventLogState>(galaxy, EVENT_LOG_STATE_KEY, () => ({ nextId: 1, entries: [], characters: [] }));
}

/** The state without creating it (null when off or never written). */
export function peekEventLog(galaxy: Galaxy): EventLogState | null {
    const s = galaxy.scenario;
    if (s === null || !(EVENT_LOG_STATE_KEY in s.state)) return null;
    return s.state[EVENT_LOG_STATE_KEY] as EventLogState;
}

/** The entries (oldest first); empty when the log is off or empty. */
export function eventLogEntries(galaxy: Galaxy): readonly EventLogEntry[] {
    return peekEventLog(galaxy)?.entries ?? [];
}

export function eventLogSize(galaxy: Galaxy): number {
    return Math.max(1, Math.trunc(scenarioParam(galaxy, 'eventLogSize', EVENT_LOG_DEFAULT_SIZE)));
}

// ---------------------------------------------------------------------------------------------------------------
// Actors and places
// ---------------------------------------------------------------------------------------------------------------

function isPirateFaction(galaxy: Galaxy, e: Empire): boolean {
    return galaxy.pirateEmpires.includes(e);
}

/** The ActorRef of an empire (a pirate faction's kind is 'faction'; ids share one space). */
export function empireActor(galaxy: Galaxy, e: Empire): ActorRef {
    return { kind: isPirateFaction(galaxy, e) ? 'faction' : 'empire', id: e.empireId };
}

/** The ActorRef of a character (registers it in the log's registry on first use; flag-on only). */
export function characterActor(galaxy: Galaxy, c: Character): ActorRef {
    const reg = eventLogState(galaxy).characters;
    let i = reg.indexOf(c);
    if (i < 0) {
        reg.push(c);
        i = reg.length - 1;
    }
    return { kind: 'character', id: i };
}

/** The ActorRef of a character already in the registry (queries never register). */
function knownCharacterActor(galaxy: Galaxy, c: Character): ActorRef | null {
    const i = peekEventLog(galaxy)?.characters.indexOf(c) ?? -1;
    return i >= 0 ? { kind: 'character', id: i } : null;
}

/** Actor → display name (empire / faction name, character name); `#id` when gone. */
export function actorName(galaxy: Galaxy, a: ActorRef): string {
    if (a.kind === 'character') return peekEventLog(galaxy)?.characters[a.id]?.name ?? `#c${a.id}`;
    const e = findEmpireById(galaxy, a.id);
    return e !== null ? e.name : `#${a.id}`;
}

export function findEmpireById(galaxy: Galaxy, id: number): Empire | null {
    for (const e of galaxy.empires) if (e != null && e.empireId === id) return e;
    for (const e of galaxy.pirateEmpires) if (e != null && e.empireId === id) return e;
    const ind = galaxy.independentEmpire;
    return ind != null && ind.empireId === id ? ind : null;
}

function sameActor(a: ActorRef, b: ActorRef): boolean {
    // Empires and pirate factions share the empire id space: a pirate faction matches either kind.
    if ((a.kind === 'character') !== (b.kind === 'character')) return false;
    return a.id === b.id;
}

function addActor(list: ActorRef[], a: ActorRef | null): void {
    if (a !== null && !list.some((x) => sameActor(x, a))) list.push(a);
}

function habitatPlace(h: Habitat): EventPlace {
    return { habitat: h.habitatIndex, system: h.systemIndex, x: Math.round(h.xpos), y: Math.round(h.ypos) };
}

/** A subject → the place it names (Habitat, BuiltObject, a character's location, a point). */
function subjectPlace(subject: unknown): EventPlace | null {
    if (subject instanceof Habitat) return habitatPlace(subject);
    if (subject instanceof BuiltObject) return { x: Math.round(subject.xpos), y: Math.round(subject.ypos) };
    if (subject instanceof Character) {
        const loc = subject.location;
        if (loc instanceof Habitat) return habitatPlace(loc);
        if (loc instanceof BuiltObject) return { x: Math.round(loc.xpos), y: Math.round(loc.ypos) };
        return null;
    }
    if (typeof subject === 'object' && subject !== null) {
        const p = subject as { x?: unknown; y?: unknown };
        if (typeof p.x === 'number' && typeof p.y === 'number' && (p.x !== 0 || p.y !== 0)) return { x: Math.round(p.x), y: Math.round(p.y) };
    }
    return null;
}

/** A subject → the actors it names (the empire itself, a character, the owner of a habitat / ship). */
function subjectActors(galaxy: Galaxy, subject: unknown, out: ActorRef[]): void {
    if (subject instanceof EmpireClass) addActor(out, empireActor(galaxy, subject));
    else if (subject instanceof Character) {
        addActor(out, characterActor(galaxy, subject));
        if (subject.empire !== null) addActor(out, empireActor(galaxy, subject.empire));
    } else if (subject instanceof Habitat) {
        if (subject.empire != null && subject.empire !== galaxy.independentEmpire) addActor(out, empireActor(galaxy, subject.empire));
    } else if (subject instanceof BuiltObject) {
        if (subject.empire != null) addActor(out, empireActor(galaxy, subject.empire));
    }
}

function argValue(a: unknown): string | number {
    return typeof a === 'number' && Number.isFinite(a) ? a : String(a);
}

// ---------------------------------------------------------------------------------------------------------------
// Append + importance-weighted retention
// ---------------------------------------------------------------------------------------------------------------

export type EventLogEntryInput = Omit<EventLogEntry, 'id' | 'starDate'> & { starDate?: number };

function sameArgs(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Appends one entry (flag-on callers only). The same event delivered to several empires in one burst (a NewsNet
 * broadcast, a package's per-recipient loop) merges into the last entry: same date, source, category and text → the
 * actors and recipients are unioned. Over the size cap the oldest entry of the lowest importance present is dropped.
 */
export function appendEvent(galaxy: Galaxy, input: EventLogEntryInput): EventLogEntry {
    const st = eventLogState(galaxy);
    const starDate = input.starDate ?? galaxyStarDate(galaxy);
    const last = st.entries.length > 0 ? st.entries[st.entries.length - 1] : null;
    if (last !== null && last.starDate === starDate && last.source === input.source && last.category === input.category && last.textKey === input.textKey && sameArgs(last.args, input.args) && last.textFormat === input.textFormat) {
        for (const a of input.actors) addActor(last.actors, a);
        for (const id of input.seenBy) if (!last.seenBy.includes(id)) last.seenBy.push(id);
        if (input.importance > last.importance) last.importance = input.importance;
        if (last.place === null && input.place !== null) last.place = input.place;
        return last;
    }
    const entry: EventLogEntry = { ...input, id: st.nextId++, starDate };
    if (entry.titleKey === undefined) delete entry.titleKey;
    if (entry.titleArgs === undefined) delete entry.titleArgs;
    st.entries.push(entry);
    enforceRetention(st, eventLogSize(galaxy));
    return entry;
}

/** Drops entries until at most `cap` remain: always the oldest entry of the lowest importance present. */
export function enforceRetention(st: EventLogState, cap: number): void {
    while (st.entries.length > cap) {
        let victim = -1;
        for (let imp = 0; imp <= 3 && victim < 0; imp++) victim = st.entries.findIndex((e) => e.importance === imp);
        st.entries.splice(victim < 0 ? 0 : victim, 1);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Scenario taps (scenario/messages.ts): package defaults by text-tag prefix
// ---------------------------------------------------------------------------------------------------------------

/** Explicit event-log options of a scenario message / news call (all optional). */
export interface ScenarioLogOptions {
    category?: EventCategory;
    importance?: EventImportance;
    /** Extra actors (e.g. a herder / league id as a faction). */
    actors?: ActorRef[];
    data?: Record<string, string | number | boolean>;
}

/**
 * Per-package defaults, matched on the GameText tag's prefix (every package's tags share one: see the scenarios'
 * GameText.txt headers). Longest prefix first. `source` is the package's scenario id.
 */
export const PACKAGE_DEFAULTS: readonly { prefix: string; source: string; category: EventCategory }[] = [
    // 19d3 espionage consequences (scenarios/espionage-consequences)
    { prefix: 'Emergent Spy', source: 'espionage-consequences', category: 'diplomacy' },
    { prefix: 'Emergent Resolution', source: 'espionage-consequences', category: 'diplomacy' },
    { prefix: 'Emergent Exposure', source: 'espionage-consequences', category: 'diplomacy' },
    { prefix: 'Emergent Demand', source: 'espionage-consequences', category: 'diplomacy' },
    { prefix: 'Emergent Stolen', source: 'espionage-consequences', category: 'diplomacy' },
    { prefix: 'Emergent Framed', source: 'espionage-consequences', category: 'diplomacy' },
    { prefix: 'Emergent False Flag', source: 'espionage-consequences', category: 'diplomacy' },
    // 19d4 refugees & demographics
    { prefix: 'Emergent Refugee', source: 'refugees-demographics', category: 'politics' },
    { prefix: 'Emergent Exile', source: 'refugees-demographics', category: 'politics' },
    { prefix: 'Emergent Demographics', source: 'refugees-demographics', category: 'politics' },
    // 19d2 resource crises
    { prefix: 'Emergent Fuel', source: 'resource-crises', category: 'economy' },
    { prefix: 'Emergent Shortage', source: 'resource-crises', category: 'economy' },
    { prefix: 'Emergent Reserves', source: 'resource-crises', category: 'economy' },
    { prefix: 'Emergent Fleets', source: 'resource-crises', category: 'economy' },
    { prefix: 'Emergent Crisis', source: 'resource-crises', category: 'economy' },
    { prefix: 'Emergent Supply', source: 'resource-crises', category: 'economy' },
    { prefix: 'Emergent Price', source: 'resource-crises', category: 'economy' },
    // 19d1 internal politics (every other "Emergent " tag)
    { prefix: 'Emergent ', source: 'emergent', category: 'politics' },
    // 19m internal security
    { prefix: 'Security ', source: 'internal-security', category: 'politics' },
    // 19c chartered companies, 19a rim trader, 19g-7 rim fauna
    { prefix: 'Scenario Charter', source: 'chartered-companies', category: 'economy' },
    { prefix: 'Scenario RimTrade', source: 'rimTrade', category: 'rim' },
    { prefix: 'Scenario RimFauna', source: 'rim-fauna', category: 'rim' },
    // 19b / 19f hidden threats (threats/framework.ts spec.prefix)
    { prefix: 'DarkFarms ', source: 'darkfarms', category: 'threat' },
    { prefix: 'Cult ', source: 'cult', category: 'threat' },
    { prefix: 'Doppel ', source: 'doppelgangers', category: 'threat' },
    { prefix: 'Hive ', source: 'hive', category: 'threat' },
    { prefix: 'Coup ', source: 'corporatecoup', category: 'threat' },
    { prefix: 'Mutiny ', source: 'robotmutiny', category: 'threat' },
    { prefix: 'TimeBomb ', source: 'timebomb', category: 'threat' },
    { prefix: 'Silence ', source: 'silence', category: 'threat' },
    { prefix: 'Exchange ', source: 'exchange', category: 'threat' },
    { prefix: 'GhostArmada ', source: 'ghostarmada', category: 'threat' },
    { prefix: 'GreyTide ', source: 'greytide', category: 'threat' },
    { prefix: 'Council ', source: 'council', category: 'council' },
];

export function packageDefaults(textKey: string): { source: string; category: EventCategory } {
    for (const d of PACKAGE_DEFAULTS) if (textKey.startsWith(d.prefix)) return d;
    return { source: 'scenario', category: 'other' };
}

/** Tags that mark a turning point (importance 3 whatever the message type). */
const TURNING_POINT = /\bVictory\b|Coup Success|Secession\b|Cult Coup\b|Defeat\b/;

/** Scenario message type → importance (news broadcasts start at 2: the whole galaxy hears them). */
function scenarioImportance(type: EmpireMessageType, key: string, news: boolean): EventImportance {
    if (TURNING_POINT.test(key)) return 3;
    if (news) return 2;
    switch (type) {
        case EmpireMessageType.GeneralBadEvent:
        case EmpireMessageType.GeneralWarning:
            return 2;
        default:
            return 1;
    }
}

// scenarioText capture: the resolved text of the last few scenarioText calls → their tag + args, so a scenario
// message stores the key it was built from (the call sites pass resolved strings). Module-level and bounded; never
// part of the game state (a lookup miss only means the entry keeps the literal as its key, which scenarioText
// resolves to itself).
const recentTexts = new Map<string, { key: string; args: (string | number)[] }>();
const RECENT_TEXTS_MAX = 64;

export function noteScenarioText(resolved: string, key: string, args: readonly unknown[]): void {
    if (resolved === key && args.length === 0) return;
    recentTexts.delete(resolved);
    recentTexts.set(resolved, { key, args: args.map(argValue) });
    if (recentTexts.size > RECENT_TEXTS_MAX) recentTexts.delete(recentTexts.keys().next().value!);
}

function scenarioTextKey(resolved: string): { key: string; args: (string | number)[] } {
    return recentTexts.get(resolved) ?? { key: resolved, args: [] };
}

let scenarioSendDepth = 0;
/** Runs a scenario helper's own sendEmpireMessage calls without the ported-message tap (they log once, above it). */
export function withoutEmpireMessageTap<T>(fn: () => T): T {
    scenarioSendDepth++;
    try {
        return fn();
    } finally {
        scenarioSendDepth--;
    }
}

/** scenarioMessage tap (flag-checked here). */
export function logScenarioMessage(galaxy: Galaxy, recipient: Empire, message: EmpireMessage, log: ScenarioLogOptions | undefined): void {
    if (!eventLogOn(galaxy)) return;
    const text = scenarioTextKey(message.description);
    const title = message.title !== '' ? scenarioTextKey(message.title) : null;
    let def = packageDefaults(text.key);
    if (def.source === 'scenario' && title !== null) def = packageDefaults(title.key); // a literal text: the title's tag
    const actors: ActorRef[] = [];
    addActor(actors, empireActor(galaxy, recipient));
    if (message.sender !== null) addActor(actors, empireActor(galaxy, message.sender));
    subjectActors(galaxy, message.subject, actors);
    for (const a of log?.actors ?? []) addActor(actors, a);
    appendEvent(galaxy, {
        category: log?.category ?? def.category,
        importance: log?.importance ?? scenarioImportance(message.messageType, text.key + ' ' + (title?.key ?? ''), false),
        actors,
        seenBy: [recipient.empireId],
        place: subjectPlace(message.subject),
        textKey: text.key,
        args: text.args,
        textFormat: 'scenario',
        titleKey: title?.key,
        titleArgs: title?.args,
        data: { msg: EmpireMessageType[message.messageType], ...(log?.data ?? {}) },
        source: def.source,
    });
}

/** scenarioNews tap (flag-checked here): one entry per broadcast, the recipients in seenBy. */
export function logScenarioNews(galaxy: Galaxy, source: Empire | null, description: string, recipients: readonly Empire[], subject: unknown, log: ScenarioLogOptions | undefined): void {
    if (!eventLogOn(galaxy)) return;
    const text = scenarioTextKey(description);
    const def = packageDefaults(text.key);
    const actors: ActorRef[] = [];
    if (source !== null) addActor(actors, empireActor(galaxy, source));
    subjectActors(galaxy, subject, actors);
    for (const a of log?.actors ?? []) addActor(actors, a);
    appendEvent(galaxy, {
        category: log?.category ?? def.category,
        importance: log?.importance ?? scenarioImportance(EmpireMessageType.GalacticNewsNet, text.key, true),
        actors,
        seenBy: recipients.map((e) => e.empireId),
        place: subjectPlace(subject),
        textKey: text.key,
        args: text.args,
        textFormat: 'scenario',
        data: { msg: 'GalacticNewsNet', news: true, ...(log?.data ?? {}) },
        source: def.source,
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Ported-message tap (messages.ts sendEmpireMessage)
// ---------------------------------------------------------------------------------------------------------------

/**
 * EmpireMessageType (messages.ts, the port of EmpireMessageType.cs) → [category, importance]; null = not logged.
 * Not logged: per-ship chatter and advisories (ShipNeeds*, ShipMissionComplete, ShipBaseScrapped, AdvisorSuggestion,
 * ConstructionResourceShortage), Informational (the C# history skips it too, Main.Part9.cs 1508-1517) and the battle
 * alerts the history's Non-Battle filter drops (BattleAttacking / BattleUnderAttack / IncomingEnemyFleet — one per
 * engagement; the outcomes are logged: ColonyLost/Gained, ShipBaseBoarded*, EmpireDefeated).
 */
export const EMPIRE_MESSAGE_EVENT: Readonly<Record<keyof typeof EmpireMessageType, readonly [EventCategory, EventImportance] | null>> = {
    Undefined: null,
    DiplomaticRelationChange: ['diplomacy', 2],
    ProposeDiplomaticRelation: ['diplomacy', 1],
    AcceptDiplomaticRelation: ['diplomacy', 2],
    RefuseDiplomaticRelation: ['diplomacy', 1],
    RemoveColoniesFromSystem: ['diplomacy', 1],
    StopMissionsAgainstUs: ['diplomacy', 1],
    StopAttacks: ['diplomacy', 1],
    LeaveSystem: ['diplomacy', 1],
    RequestJointWar: ['war', 1],
    RequestJointTradeSanctions: ['diplomacy', 1],
    RequestStopWar: ['war', 1],
    RequestLiftTradeSanctions: ['diplomacy', 1],
    GiveGift: ['diplomacy', 1],
    Informational: null,
    ShipBaseCompleted: ['economy', 0],
    ShipBasePurchased: ['economy', 0],
    NewColony: ['exploration', 1],
    NewColonyFailed: ['exploration', 0],
    ResearchBreakthrough: ['economy', 1],
    BattleUnderAttack: null,
    BattleAttacking: null,
    IncomingEnemyFleet: null,
    CharacterAppearance: ['character', 1],
    CharacterDeath: ['character', 2],
    CharacterMissionAccomplished: ['character', 1],
    CharacterMissionFailure: ['character', 1],
    EmpireDiscovered: ['exploration', 1],
    ColonyGained: ['war', 2],
    ColonyLost: ['war', 2],
    ColonyDefended: ['war', 1],
    ColonyRebelling: ['politics', 2],
    EmpireDefeated: ['war', 3],
    RequestHonorMutualDefense: ['war', 1],
    BlockadeInitiated: ['war', 1],
    BlockadeCancelled: ['war', 0],
    ExplorationRuins: ['exploration', 1],
    ExplorationBuiltObject: ['exploration', 1],
    ExplorationHabitat: ['exploration', 0],
    ExplorationLocation: ['exploration', 1],
    GalacticHistory: ['story', 2],
    SellInfoUnmetEmpire: ['pirate', 0],
    SellInfoIndependentColony: ['pirate', 0],
    SellInfoSystemMap: ['pirate', 0],
    SellInfoRuins: ['pirate', 0],
    SellInfoDebrisField: ['pirate', 0],
    SellInfoRestrictedArea: ['pirate', 0],
    SellInfoPlanetDestroyer: ['pirate', 0],
    PirateOfferProtection: ['pirate', 1],
    CancelPirateProtection: ['pirate', 1],
    Revolution: ['politics', 3],
    RestrictedResourceDiscovered: ['economy', 1],
    RestrictedResourceTradingAllowed: ['economy', 0],
    RestrictedResourceTradingBlocked: ['economy', 1],
    OfferTrade: ['economy', 0],
    ShipMissionComplete: null,
    ShipNeedsRefuelling: null,
    ShipNeedsRepair: null,
    RemoveForcesFromSystem: ['diplomacy', 1],
    GeneralWarning: ['other', 1],
    GeneralBadEvent: ['other', 1],
    GeneralNeutralEvent: ['other', 0],
    GeneralGoodEvent: ['other', 1],
    GeneralDecision: ['other', 1],
    HistoryOfferLocationHint: ['story', 1],
    HistoryOfferStoryClue: ['story', 1],
    ColonyFacilityCompleted: ['economy', 0],
    ColonyFacilityCancelled: ['economy', 0],
    ColonyWonderBegun: ['economy', 2],
    ColonyShipMissionCancelled: ['exploration', 0],
    StoryMessage: ['story', 2],
    AdvisorSuggestion: null,
    ColonyDestroyed: ['war', 3],
    MilitaryRefuelingAllowed: ['diplomacy', 0],
    MilitaryRefuelingBlocked: ['diplomacy', 0],
    MiningRightsAllowed: ['diplomacy', 0],
    MiningRightsBlocked: ['diplomacy', 0],
    CharacterSkillTraitChange: ['character', 0],
    ResearchCriticalBreakthrough: ['economy', 1],
    ResearchCriticalFailure: ['economy', 1],
    GalacticNewsNet: ['other', 2],
    ShipBaseBoardedCaptured: ['war', 1],
    ShipBaseBoardedLost: ['war', 1],
    PirateAttackMissionAvailable: ['pirate', 0],
    PirateAttackMissionCompleted: ['pirate', 1],
    PirateAttackMissionFailed: ['pirate', 1],
    PirateDefendMissionFailed: ['pirate', 1],
    PirateDefendMissionAvailable: ['pirate', 0],
    PirateDefendMissionCompleted: ['pirate', 1],
    PirateSmugglingMissionAvailable: ['pirate', 0],
    PirateSmugglingMissionCompleted: ['pirate', 1],
    PirateSmugglerDetected: ['pirate', 0],
    PlanetaryFacilityDestroyed: ['war', 1],
    ShipBaseScrapped: null,
    ConstructionResourceShortage: null,
    RaidBonuses: ['pirate', 1],
    RaidVictim: ['pirate', 2],
    PlanetaryFacilityDamaged: ['war', 0],
};

/** The category / importance a ported message is logged with (null: not logged). */
export function empireMessageEvent(type: EmpireMessageType, subject: unknown = null): readonly [EventCategory, EventImportance] | null {
    const name = EmpireMessageType[type] as keyof typeof EmpireMessageType | undefined;
    const row = name !== undefined ? EMPIRE_MESSAGE_EVENT[name] : null;
    if (row === null || row === undefined) return null;
    // A treaty change whose subject is War (Main.Part9.cs treaty titles: "War Declared!") is a war event.
    if ((type === EmpireMessageType.DiplomaticRelationChange || type === EmpireMessageType.ProposeDiplomaticRelation) && subject === DiplomaticRelationType.War) return ['war', 3];
    return row;
}

/** A NewsNet story's category from its GameText tag (events.ts SendNewsBroadcastCore texts). */
export function newsCategory(key: string): EventCategory {
    if (/Pirate/i.test(key)) return 'pirate';
    if (/\bwar\b|Defeated|destroyed|Peace/i.test(key)) return 'war';
    if (/Leader|Revolution|Government/i.test(key)) return 'politics';
    if (/Wonder|Research|Economic/i.test(key)) return 'economy';
    if (/Disaster|PLAGUE|Outbreak|Creature/i.test(key)) return 'threat';
    return 'other';
}

/** Splits a deferred gameText() string (`tag|arg|…`, colonyTick.ts gameText) into tag + args; joins back losslessly. */
function splitGameText(s: string): { key: string; args: string[] } {
    const parts = s.split('|');
    return { key: parts[0], args: parts.slice(1) };
}

/** The ported-message tap (installed below; messages.ts calls it for every delivered message). */
export function tapEmpireMessage(message: EmpireMessage, recipient: Empire): void {
    if (scenarioSendDepth > 0) return;
    const galaxy = recipient.galaxy;
    if (!eventLogOn(galaxy)) return;
    const row = empireMessageEvent(message.messageType, message.subject);
    if (row === null) return;
    const news = message.messageType === EmpireMessageType.GalacticNewsNet;
    let description = message.description;
    // SendNewsBroadcastCore: description = title + " - " + text (title = "NEWSNET: <empire>"); keep the story only.
    if (news && message.title !== '' && description.startsWith(message.title + ' - ')) description = description.substring(message.title.length + 3);
    const text = splitGameText(description);
    const actors: ActorRef[] = [];
    if (!news) addActor(actors, empireActor(galaxy, recipient));
    if (message.sender !== null) addActor(actors, empireActor(galaxy, message.sender));
    subjectActors(galaxy, message.subject, actors);
    const title = !news && message.title !== '' ? splitGameText(message.title) : null;
    const data: Record<string, string | number | boolean> = { msg: EmpireMessageType[message.messageType] };
    if (news) data.news = true;
    if (message.money !== 0) data.money = message.money;
    appendEvent(galaxy, {
        category: news ? newsCategory(text.key) : row[0],
        importance: row[1],
        actors,
        seenBy: [recipient.empireId],
        place: subjectPlace(message.subject) ?? subjectPlace(message.location),
        textKey: text.key,
        args: text.args,
        textFormat: 'game',
        titleKey: title?.key,
        titleArgs: title?.args,
        data,
        source: 'game',
    });
}

setEmpireMessageTap(tapEmpireMessage);

// ---------------------------------------------------------------------------------------------------------------
// Queries (pure: never create state; `since` is a star date, inclusive)
// ---------------------------------------------------------------------------------------------------------------

export type ActorLike = ActorRef | Empire | Character;
export type PlaceQuery = Habitat | { habitat: number } | { system: number } | { x: number; y: number; radius: number };

function toActor(galaxy: Galaxy, a: ActorLike): ActorRef | null {
    if (a instanceof EmpireClass) return empireActor(galaxy, a);
    if (a instanceof Character) return knownCharacterActor(galaxy, a);
    return a;
}

function involves(e: EventLogEntry, a: ActorRef): boolean {
    return e.actors.some((x) => sameActor(x, a));
}

/** Everything that happened between A and B (both actors of the entry), oldest first. */
export function eventsBetween(galaxy: Galaxy, a: ActorLike, b: ActorLike, since = 0): EventLogEntry[] {
    const ra = toActor(galaxy, a);
    const rb = toActor(galaxy, b);
    if (ra === null || rb === null) return [];
    return eventLogEntries(galaxy).filter((e) => e.starDate >= since && involves(e, ra) && involves(e, rb));
}

/** Everything at a place: a habitat (by index), a system (any habitat in it), or within `radius` of a point. */
export function eventsAt(galaxy: Galaxy, place: PlaceQuery, since = 0): EventLogEntry[] {
    const q: PlaceQuery = place instanceof Habitat ? { habitat: place.habitatIndex } : place;
    const match = (p: EventPlace | null): boolean => {
        if (p === null) return false;
        if ('habitat' in q) return p.habitat === q.habitat;
        if ('system' in q) return p.system === q.system;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        return dx * dx + dy * dy <= q.radius * q.radius;
    };
    return eventLogEntries(galaxy).filter((e) => e.starDate >= since && match(e.place));
}

/** Entries of one category at or above `minImportance`, oldest first. */
export function eventsByCategory(galaxy: Galaxy, category: EventCategory, since = 0, minImportance = 0): EventLogEntry[] {
    return eventLogEntries(galaxy).filter((e) => e.category === category && e.starDate >= since && e.importance >= minImportance);
}

/** One empire's history: every entry it is an actor of, oldest first. */
export function timeline(galaxy: Galaxy, empire: Empire, since = 0): EventLogEntry[] {
    const a = empireActor(galaxy, empire);
    return eventLogEntries(galaxy).filter((e) => e.starDate >= since && involves(e, a));
}

/** What an empire was told (recipient) or took part in (actor): the Galactic History view of the log. */
export function eventsKnownTo(galaxy: Galaxy, empire: Empire, since = 0): EventLogEntry[] {
    const a = empireActor(galaxy, empire);
    return eventLogEntries(galaxy).filter((e) => e.starDate >= since && (e.seenBy.includes(empire.empireId) || involves(e, a)));
}
