// Hidden-threat framework (tasks/19b-dark-farms.md §5.A, tasks/19f-hidden-threats.md §0). Not a port: generic machinery
// the scenario threats (19b Dark Farms, the ten 19f threats) compose from ported functions. Every step cites the C#
// analogue it reuses.
//
// Anatomy of a threat: hidden state (threatState) · spread rule (a periodic / yearly handler) · trigger (a predicate in
// that handler) · faction (createThreatFaction) · dirty methods (invadeFromInside, flipToFaction, refitInPlace, event
// handlers) · discovery (revealTo / knowledgeLevel / threatKnownSites) · arc (arcMessage / arcNews, threatGameEnd).
//
// Rnd policy: nothing here draws on its own except through the stock functions it calls (createEmpireMidGame,
// createNewDesigns, generateNewCharacter …), and those are only called from a threat's own gated handlers.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { Design } from '../../design';
import type { EmpirePolicy } from '../../data/policies';
import type { Race } from '../../data/races';
import { Troop, TroopList, TroopType } from '../../cargo';
import { generateNewTroop } from '../../builtObjectPlacement';
import { takeOwnershipOfBuiltObject } from '../../combat/ownership';
import { createNewDesigns } from '../../designGeneration';
import { declareWar } from '../../diplomacyTick';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { empireCompleteTeardown } from '../../events';
import { EmpireMessageType } from '../../messages';
import { GameEndEventArgs, GameEndOutcome, onGameEnd } from '../../victory';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { Random } from '../../random';
import { startStarDateForAge } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { createEmpireMidGame } from '../empireMidGame';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { scenarioParam, scenarioState } from '../state';
import { gameYear, registerScenarioGameStart } from '../hooks';
import type { Character, StellarObject } from '../../characters';
import { getEmpireCharacters } from '../../characters';
import { GalaxyLocation } from '../../galaxyLocation';
import { mirrorPackageDiscovery } from '../security/registry';

// ---------------------------------------------------------------------------------------------------------------
// Hidden state
// ---------------------------------------------------------------------------------------------------------------

/** A threat's saved state bag: galaxy.scenario.state[key] (plain objects + graph references; no new classes). */
export function threatState<T>(galaxy: Galaxy, key: string, init: () => T): T {
    return scenarioState(galaxy, key, init);
}

/** The state bag if it exists (never creates it: pure readers such as UI selectors use this). */
export function peekThreatState<T>(galaxy: Galaxy, key: string): T | null {
    const s = galaxy.scenario;
    if (s === null || !(key in s.state)) return null;
    return s.state[key] as T;
}

// ---------------------------------------------------------------------------------------------------------------
// Discovery knowledge (levels: 1 rumour, 2 suspected, 3 confirmed)
// ---------------------------------------------------------------------------------------------------------------

export const KNOWLEDGE_RUMOUR = 1;
export const KNOWLEDGE_SUSPECTED = 2;
export const KNOWLEDGE_CONFIRMED = 3;

/** One empire's knowledge of a hidden site / carrier. */
export interface ThreatKnowledge {
    empireId: number;
    level: number;
    /** Star date the level was reached. */
    date: number;
}

/** Anything a threat hides (a site or a carrier) carries its knowledge list. */
export interface ThreatSite {
    knowledge: ThreatKnowledge[];
}

/** The level `empire` knows `site` at (0 = unknown). */
export function knowledgeLevel(site: ThreatSite, empire: Empire | null): number {
    if (empire === null) return 0;
    for (const k of site.knowledge) if (k.empireId === empire.empireId) return k.level;
    return 0;
}

/**
 * Records that `empire` knows `site` at `level` (knowledge only rises). Returns true when the level is new for that
 * empire (the caller then sends its discovery message). All discovery goes through here.
 */
export function revealTo(galaxy: Galaxy, site: ThreatSite, empire: Empire, level: number): boolean {
    const now = galaxyStarDate(galaxy);
    for (const k of site.knowledge) {
        if (k.empireId !== empire.empireId) continue;
        if (k.level >= level) return false;
        k.level = level;
        k.date = now;
        mirrorPackageDiscovery(galaxy, { knowledge: site.knowledge }, empire, level); // 19m: the lead follows (flag-gated)
        return true;
    }
    site.knowledge.push({ empireId: empire.empireId, level, date: now });
    mirrorPackageDiscovery(galaxy, { knowledge: site.knowledge }, empire, level); // 19m: the lead follows (flag-gated)
    return true;
}

/** A site / carrier an empire knows of, for the UI (map overlay, selection panel). */
export interface KnownThreatSite {
    /** Threat key (e.g. "darkFarms"). */
    threat: string;
    kind: 'colony' | 'ship';
    target: Habitat | BuiltObject;
    level: number;
    /** Display label (e.g. "Dark Farm (suspected)"). */
    label: string;
}

type KnownSitesProvider = (galaxy: Galaxy, empire: Empire) => KnownThreatSite[];
// `var` + lazy creation: threat modules register at module load, possibly while this module is still initialising
// (an import cycle through the UI / player code), when a `const` would still be in its temporal dead zone.
// eslint-disable-next-line no-var
var knownSitesProvidersStore: Map<string, KnownSitesProvider> | undefined;
function knownSitesProviders(): Map<string, KnownSitesProvider> {
    return (knownSitesProvidersStore ??= new Map());
}

/** A threat module registers how to list what an empire knows (called by threatKnownSites). */
export function registerThreatKnownSites(threat: string, provider: KnownSitesProvider): void {
    knownSitesProviders().set(threat, provider);
}

/**
 * Pure selector for the UI: every registered threat's sites / carriers `empire` knows at level ≥ minLevel (default 2,
 * suspected), in threat-key order. No state is created, nothing draws.
 */
export function threatKnownSites(galaxy: Galaxy, empire: Empire | null, minLevel = KNOWLEDGE_SUSPECTED): KnownThreatSite[] {
    if (galaxy.scenario === null || empire === null) return [];
    const out: KnownThreatSite[] = [];
    for (const key of [...knownSitesProviders().keys()].sort()) {
        for (const s of knownSitesProviders().get(key)!(galaxy, empire)) if (s.level >= minLevel) out.push(s);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Rarity and timing (tasks/19f-hidden-threats.md §0 "Rarity and timing"): hidden threats must be rare and late, not
// every-game. Every threat scenario includes scenarios/threat-framework/ (params threatExistChancePct default 25,
// threatMinYear default 30); a threat scenario may override either with its own `<key>ExistChancePct` /
// `<key>MinYear` param (default -1 = use the shared value).
// ---------------------------------------------------------------------------------------------------------------

const THREATS_KEY = 'threats';

interface ThreatsFrameworkState {
    /**
     * Per enabled threat key, whether it exists in this game: the hidden existence lottery, rolled once at game
     * start with this module's own seeded Random (never galaxy.rnd, so the faithful draw stream is untouched), in
     * fixed key order (registry keys sorted, independent of module import order). Never shown in any UI or message.
     */
    exists: Record<string, boolean>;
}

interface ThreatRegistration {
    key: string;
    flag: string;
}
// `var` + lazy creation: as knownSitesProvidersStore above — threat modules register at module load, possibly while
// this module is still initialising (an import cycle through the UI / player code).
// eslint-disable-next-line no-var
var threatRegistryStore: Map<string, ThreatRegistration> | undefined;
function threatRegistry(): Map<string, ThreatRegistration> {
    return (threatRegistryStore ??= new Map());
}

/**
 * A threat module registers its (state key, scenario flag) pair once at load, alongside registerThreatKnownSites,
 * so the shared existence lottery (rollThreatExistence) can find every enabled threat.
 */
export function registerThreatExistence(key: string, flag: string): void {
    threatRegistry().set(key, { key, flag });
}

function threatExistChancePctFor(galaxy: Galaxy, key: string): number {
    const shared = scenarioParam(galaxy, 'threatExistChancePct', 25);
    const override = scenarioParam(galaxy, `${key}ExistChancePct`, -1);
    return override >= 0 ? override : shared;
}

/**
 * The existence lottery: once per game, for every registered threat whose scenario flag is on, in fixed key order
 * (registry keys sorted), one roll with this module's own seeded Random decides whether it exists this game. No
 * threat enabled ⇒ no state is created and nothing is drawn (a scenario with every threat flag off stays byte-
 * identical to the game before this lottery existed). Registered as a game-start handler gated on
 * `scenarioId: 'threat-framework'` at a very low order, so it runs once, before every threat module's own game-start
 * handler (e.g. hive.init), in any scenario that includes scenarios/threat-framework/.
 */
function rollThreatExistence(galaxy: Galaxy): void {
    const s = galaxy.scenario;
    if (s === null) return;
    const keys = [...threatRegistry().keys()].sort().filter((k) => s.flags[threatRegistry().get(k)!.flag] === true);
    if (keys.length === 0) return;
    const st = threatState(galaxy, THREATS_KEY, (): ThreatsFrameworkState => ({ exists: {} }));
    const rnd = new Random(((galaxy.randomSeed ^ 0x74484c31) >>> 1) & 0x7fffffff);
    for (const key of keys) st.exists[key] = rnd.nextDouble() * 100 < threatExistChancePctFor(galaxy, key);
}

registerScenarioGameStart({ id: 'threatFramework.existenceLottery', scenarioId: 'threat-framework', order: -1000, run: (g) => rollThreatExistence(g) });

/**
 * True when `key`'s existence lottery says it exists this game; false if it was never rolled (the threat's flag is
 * off, or the scenario does not include scenarios/threat-framework/). Every threat handler (yearly, periodic, every
 * event) checks this first: not existing runs no handlers — no state, no draws — and the result is never surfaced
 * to the UI or any message.
 */
export function threatExists(galaxy: Galaxy, key: string): boolean {
    const st = peekThreatState<ThreatsFrameworkState>(galaxy, THREATS_KEY);
    return st !== null && st.exists[key] === true;
}

/** The game's own start year: every threat's "N years in" param (greyTideSeedYear, cultSeedYear, ...) is an offset from this. */
function threatStartYear(galaxy: Galaxy): number {
    return gameYear(startStarDateForAge(galaxy.age));
}

function threatMinYearOffset(galaxy: Galaxy, key: string): number {
    const shared = scenarioParam(galaxy, 'threatMinYear', 30);
    const override = scenarioParam(galaxy, `${key}MinYear`, -1);
    return override >= 0 ? override : shared;
}

/**
 * True once the game year has passed `key`'s year floor (startYear + threatMinYear, or its `<key>MinYear`
 * override). A module combines this with its own seed-year condition (the max of the two, per §0): no threat's
 * seeding, triggering or rising happens before the floor, though bookkeeping that merely tracks progress toward a
 * trigger (Hive's node-absorption count, Doppelgangers' capture record, Corporate Coup's bribery count, Ghost
 * Armada's wreck record) may run before it. `year` defaults to the current game year.
 */
export function pastThreatMinYear(galaxy: Galaxy, key: string, year?: number): boolean {
    const y = year ?? gameYear(galaxyStarDate(galaxy));
    return y >= threatStartYear(galaxy) + threatMinYearOffset(galaxy, key);
}

// ---------------------------------------------------------------------------------------------------------------
// Faction
// ---------------------------------------------------------------------------------------------------------------

export interface ThreatFactionSpec {
    /** Race (galaxy race or its name). */
    race: Race | string;
    name: string;
    /** 'empire' (default: adoptOnly, no capital until it owns a colony) or 'pirate' (a pirate faction based at `home`). */
    kind?: 'empire' | 'pirate';
    /** Pirate base habitat (kind 'pirate'). */
    home?: Habitat | null;
    techLevel?: number;
    /** Empires the faction is at locked war with from the start (no peace, ever). */
    enemies?: Empire[];
    configurePolicy?: (policy: EmpirePolicy) => void;
    /** Evaluation bias both ways with every other empire (default −100). */
    relationBias?: number;
    /** Government id (default: the race's preferred starting government); a threat's fixed theocracy/hive/corporate government (governments.txt is not overlaid, so ids are cited directly, e.g. the Cult's "Way of Darkness" = 7). */
    governmentId?: number;
}

/**
 * Creates a threat faction mid-game: createEmpireMidGame (adoptOnly; Galaxy.8.cs 1348 GenerateShakturi is the
 * analogue), locked wars with every enemy (Empire.7.cs 4868 DeclareWar with lockedWar), then CreateNewDesigns
 * (BaconEmpire.CreateNewDesigns, designGeneration.ts 611) so the war AI has designs from the race's templates. Returns
 * null when no empire id is left (Galaxy.MaximumEmpireCount, the GenerateShakturi guard).
 */
export function createThreatFaction(galaxy: Galaxy, spec: ThreatFactionSpec): Empire | null {
    const pirate = spec.kind === 'pirate';
    const faction = createEmpireMidGame(galaxy, {
        kind: pirate ? 'pirate' : 'empire',
        race: spec.race,
        name: spec.name,
        home: spec.home ?? null,
        adoptOnly: !pirate,
        techLevel: spec.techLevel,
        governmentId: spec.governmentId,
        configurePolicy: spec.configurePolicy,
        relationBias: spec.relationBias ?? -100,
    });
    if (faction === null) return null;
    for (const enemy of spec.enemies ?? []) lockWar(galaxy, faction, enemy);
    const now = galaxyStarDate(galaxy);
    createNewDesigns(galaxy, faction, now, now, true);
    return faction;
}

/** A war that never ends: DeclareWar(lockedWar: true), and `locked` set on both relations whatever path it took. */
export function lockWar(galaxy: Galaxy, faction: Empire, enemy: Empire): void {
    if (enemy === faction || !enemy.active) return;
    declareWar(galaxy, faction, enemy, null, true);
    const a = obtainDiplomaticRelation(faction, enemy);
    const b = obtainDiplomaticRelation(enemy, faction);
    a.locked = true;
    b.locked = true;
}

/** True when `a` and `b` are at war. */
export function atWar(a: Empire, b: Empire): boolean {
    return obtainDiplomaticRelation(a, b).type === DiplomaticRelationType.War;
}

// ---------------------------------------------------------------------------------------------------------------
// Dirty methods
// ---------------------------------------------------------------------------------------------------------------

/**
 * A troop of the faction that costs nothing to keep (§0.3/19f general form of 19b's robot troop): full readiness, no
 * maintenance, as the RoboticTroopFoundry branch of Habitat.GenerateNewTroop (troops.ts 387; Habitat.cs 7047-7084)
 * does for a free garrison. `race = null` marks it a BattleBot (pictureRef = galaxy.races.length, the stock robot-troop
 * marker, troops.ts 387 / orderMenu.ts 2300); a real race (Cult militia, Hive node militia) keeps its own bonuses
 * (applyBonusFactors true) and picture.
 */
export function makeFactionTroop(galaxy: Galaxy, faction: Empire, strength: number, name: string, race: Race | null = null): Troop {
    const troop = generateNewTroop(name, TroopType.Infantry, Math.trunc(strength), faction, race, race !== null);
    troop.maintenanceMultiplier = 0;
    troop.readiness = 100;
    if (race === null) troop.pictureRef = galaxy.races.length;
    return troop;
}

/** 19b Dark Farms' robot troop: makeFactionTroop with no race (kept as its own name — every 19b/19f call site cites it). */
export function makeRobotTroop(galaxy: Galaxy, faction: Empire, strength: number, name: string): Troop {
    return makeFactionTroop(galaxy, faction, strength, name, null);
}

/**
 * The troops rise inside `habitat`: they join habitat.invadingTroops (troop.colony = habitat) and the stock ground war
 * resolves it in the habitat tick (combat/invasion.ts resolveInvasionBattles, Habitat.cs 3365) — success runs the
 * stock conquest (processColonyConquest + takeOwnershipOfColony). Analogue: the rebel militia of CheckSatisfaction
 * (colonyTick.ts 340; Habitat.cs 5992).
 */
export function invadeFromInside(galaxy: Galaxy, habitat: Habitat, faction: Empire, troops: Troop[]): void {
    void galaxy;
    if (habitat.invadingTroops === null) habitat.invadingTroops = new TroopList();
    for (const t of troops) {
        t.empire = faction;
        t.colony = habitat;
        habitat.invadingTroops.add(t);
    }
}

/**
 * Hands a ship / base to the faction as a state object (Empire.1.cs 514 TakeOwnershipOfBuiltObject; ownership.ts 632).
 * A private freighter would land in the faction's private sector (the ownership rule keys on the old owner), so it is
 * moved to the state list here.
 */
export function flipToFaction(galaxy: Galaxy, bo: BuiltObject, faction: Empire): void {
    const from = bo.actualEmpire ?? faction;
    takeOwnershipOfBuiltObject(galaxy, from, bo, faction, false, true);
    const i = faction.privateBuiltObjects.indexOf(bo);
    if (i >= 0) faction.privateBuiltObjects.splice(i, 1);
    if (!faction.builtObjects.includes(bo)) faction.builtObjects.push(bo);
    bo.owner = faction;
    const f = faction.freighters.indexOf(bo);
    if (f >= 0) faction.freighters.splice(f, 1);
}

/**
 * Instant retrofit: the ship takes `design`'s components, role and sub-role, repaired and refuelled. Analogue: the
 * retrofit completion in ConstructionQueue (constructionQueue.ts ~615-632) without yard, time or cost.
 */
export function refitInPlace(galaxy: Galaxy, bo: BuiltObject, design: Design): void {
    void galaxy;
    const fresh = new (bo.constructor as new (d: Design, n: string, g: Galaxy, full: boolean, noEmpire: boolean) => BuiltObject)(design, bo.name, galaxy, true, true);
    bo.components = fresh.components;
    bo.design = design;
    bo.retrofitDesign = null;
    bo.role = design.role;
    bo.subRole = design.subRole;
    bo.pictureRef = design.pictureRef;
    bo.stance = design.stance;
    bo.fleeWhen = design.fleeWhen;
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    bo.currentShields = bo.shieldsCapacity;
    const owner = bo.actualEmpire;
    if (bo.troopCapacity > 0 && owner !== null && owner.policy !== null) bo.setTroopLoadoutsFromPolicy(owner.policy);
}

/** Loads `troops` onto `bo` (as a transport's LoadTroops completion: troop.builtObject, the ship's and empire's lists). */
export function loadTroopsOnto(bo: BuiltObject, faction: Empire, troops: Troop[]): void {
    if (bo.troops === null) bo.troops = new TroopList();
    for (const t of troops) {
        t.empire = faction;
        t.builtObject = bo;
        bo.troops.add(t);
        if (!faction.troops.contains(t)) faction.troops.add(t);
    }
}

/** Faction with no colonies and no ships ⇒ torn down (events.ts 1199 empireCompleteTeardown). Returns true if it was. */
export function teardownIfDead(galaxy: Galaxy, faction: Empire | null): boolean {
    if (faction === null || !faction.active) return false;
    const ships = faction.builtObjects.filter((b) => !b.hasBeenDestroyed).length + faction.privateBuiltObjects.filter((b) => !b.hasBeenDestroyed).length;
    if (faction.colonies.length > 0 || ships > 0) return false;
    empireCompleteTeardown(galaxy, faction, null);
    return true;
}

/** Normal empires (not the independents, not pirate factions, not `except`), in galaxy.empires order. */
export function normalEmpires(galaxy: Galaxy, except: Empire | null = null): Empire[] {
    return galaxy.empires.filter((e) => e !== null && e !== except && e !== galaxy.independentEmpire && e.active && e.pirateEmpireBaseHabitat === null);
}

/** State military ships of an empire. */
export function militaryShipCount(empire: Empire): number {
    let n = 0;
    for (const b of empire.builtObjects) if (b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed) n++;
    return n;
}

/**
 * 19f generalisation of 19b's DarkFarms.factionPopulationPct: `faction`'s share (percent) of the population held by
 * every active empire-owned colony (independents excluded). Used by any threat whose defeat condition is "the faction
 * / theocracy / mutiny now holds N% of the galaxy" (19f: Robot Mutiny, Corporate Coup; 19b: Dark Farms keeps its own
 * copy — this is the shared form new threats should call instead of duplicating it).
 */
export function factionPopulationSharePct(galaxy: Galaxy, faction: Empire): number {
    let total = 0;
    let mine = 0;
    for (const e of galaxy.empires) {
        if (e === null || !e.active || e === galaxy.independentEmpire) continue;
        for (const c of e.colonies) {
            total += c.population.totalAmount;
            if (e === faction) mine += c.population.totalAmount;
        }
    }
    return total > 0 ? (100 * mine) / total : 0;
}

/**
 * Every active character at `location`, across every empire (galaxy.empires order, then each empire's character-list
 * order) plus `extra` (a threat faction not yet in galaxy.empires' normal iteration, e.g. mid-creation). General form
 * of the Cult's character→character spread (findCharactersAtLocationOrTransferring per empire, characters.ts 4896):
 * any social-spread threat needs "who else is here" across empire boundaries, which no single empire's list gives.
 */
export function allCharactersAtLocation(galaxy: Galaxy, location: StellarObject | null, extra: Empire | null = null): Character[] {
    if (location === null) return [];
    const out: Character[] = [];
    for (const e of galaxy.empires) {
        if (e === null) continue;
        for (const c of getEmpireCharacters(e)) if (c.active && c.location === location) out.push(c);
    }
    if (extra !== null && !galaxy.empires.includes(extra)) {
        for (const c of getEmpireCharacters(extra)) if (c.active && c.location === location) out.push(c);
    }
    return out;
}

/**
 * Grows or shrinks a restricted zone in place, re-centred on (x, y) (Galaxy.4.cs AddGalaxyLocationIndex /
 * RemoveGalaxyLocationIndex via galaxy.ts 1680/1694; the zone itself is generateRestrictedZone's, storyStart.ts 304).
 * General form of the Silence's growing hyperdrive-denial radius: any threat with an area that widens over time
 * re-indexes the same way. `radius` is half the zone's side/diameter (generateRestrictedZone's own convention).
 */
export function resizeRestrictedZone(galaxy: Galaxy, zone: GalaxyLocation, x: number, y: number, radius: number): void {
    galaxy.removeGalaxyLocationIndex(zone);
    const size = radius * 2;
    zone.xpos = Math.fround(x - radius);
    zone.ypos = Math.fround(y - radius);
    zone.width = Math.fround(size);
    zone.height = Math.fround(size);
    galaxy.addGalaxyLocationIndex(zone);
}

// ---------------------------------------------------------------------------------------------------------------
// Arc: messages, news, game end
// ---------------------------------------------------------------------------------------------------------------

/** Per-threat record of which arc stages reached which empires (saved inside the threat's state). */
export type SentStages = Record<string, number[]>;

export interface ArcMessageSpec {
    /** GameText tag prefix of the threat (e.g. "DarkFarms"): the text is `<prefix> <stage>`, the title `<prefix> <stage> Title`. */
    prefix: string;
    /** Stage name (e.g. "Hint Energy"). */
    stage: string;
    /** Once-per-recipient key (default = stage; add a site id to allow once per site). */
    onceKey?: string;
    args?: unknown[];
    type?: EmpireMessageType;
    subject?: unknown;
    /** Text tag override (default `<prefix> <stage>`). */
    textTag?: string;
}

/**
 * Sends an arc message to each recipient that has not had this stage (onceKey) yet; records it in `sent`. Returns the
 * empires it reached. Goes through scenarioMessage → stock EmpireMessages → the UI's message routing.
 */
export function arcMessage(galaxy: Galaxy, sent: SentStages, recipients: (Empire | null)[], spec: ArcMessageSpec): Empire[] {
    const key = spec.onceKey ?? spec.stage;
    const got = (sent[key] ??= []);
    const reached: Empire[] = [];
    const tag = spec.textTag ?? `${spec.prefix} ${spec.stage}`;
    const titleTag = `${spec.prefix} ${spec.stage} Title`;
    for (const e of recipients) {
        if (e === null || !e.active || got.includes(e.empireId) || reached.includes(e)) continue;
        const title = scenarioText(titleTag);
        scenarioMessage(galaxy, e, title === titleTag ? scenarioText(`${spec.prefix} Faction Name`) : title, scenarioText(tag, ...(spec.args ?? [])), {
            type: spec.type ?? EmpireMessageType.GeneralNeutralEvent,
            subject: spec.subject ?? null,
        });
        got.push(e.empireId);
        reached.push(e);
    }
    return reached;
}

/** A Galactic NewsNet report for an arc stage, once per onceKey (recorded under empire id −1). */
export function arcNews(galaxy: Galaxy, sent: SentStages, spec: ArcMessageSpec): boolean {
    const key = spec.onceKey ?? spec.stage;
    const got = (sent[key] ??= []);
    if (got.includes(-1)) return false;
    scenarioNews(galaxy, null, scenarioText(spec.textTag ?? `${spec.prefix} ${spec.stage}`, ...(spec.args ?? [])), () => true, spec.subject ?? null);
    got.push(-1);
    return true;
}

/**
 * Ends the game (Galaxy.cs 1274 OnGameEnd; victory.ts onGameEnd) with a threat's code (19b: 1901 containment, 1902
 * defeat; 19f: 1911… defeat, +100 victory). `outcome` is the player's.
 */
export function threatGameEnd(galaxy: Galaxy, victor: Empire | null, outcome: GameEndOutcome, description: string, code: number): void {
    onGameEnd(galaxy, new GameEndEventArgs(victor, outcome, description, code));
}

// ---------------------------------------------------------------------------------------------------------------
// Player-side threat actions (through the command queue: player/playerOps.ts 'threatAction')
// ---------------------------------------------------------------------------------------------------------------

export interface ThreatActionHandler {
    /** Whether the action is offered for this target (pure; the order menu asks). */
    available: (galaxy: Galaxy, empire: Empire, target: unknown) => boolean;
    /** Applies it (runs at a command boundary). */
    run: (galaxy: Galaxy, empire: Empire, target: unknown) => boolean;
    /** Menu label. */
    label: () => string;
}

// eslint-disable-next-line no-var
var threatActionsStore: Map<string, ThreatActionHandler> | undefined;
function threatActions(): Map<string, ThreatActionHandler> {
    return (threatActionsStore ??= new Map());
}

export function registerThreatAction(kind: string, handler: ThreatActionHandler): void {
    threatActions().set(kind, handler);
}

/** The actions offered for `target` (kinds in sorted order). */
export function availableThreatActions(galaxy: Galaxy, empire: Empire | null, target: unknown): { kind: string; label: string }[] {
    if (galaxy.scenario === null || empire === null) return [];
    const out: { kind: string; label: string }[] = [];
    for (const kind of [...threatActions().keys()].sort()) {
        const h = threatActions().get(kind)!;
        if (h.available(galaxy, empire, target)) out.push({ kind, label: h.label() });
    }
    return out;
}

/** The executor behind the 'threatAction' player op. */
export function runThreatAction(galaxy: Galaxy, empire: Empire, kind: string, target: unknown): boolean {
    const h = threatActions().get(kind);
    if (h === undefined || galaxy.scenario === null || !h.available(galaxy, empire, target)) return false;
    return h.run(galaxy, empire, target);
}
