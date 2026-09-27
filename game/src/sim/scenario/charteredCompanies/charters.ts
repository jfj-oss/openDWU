// Scenario package 19c — chartered companies (tasks/19c-chartered-companies.md). Not a port: an empire funds a private
// expedition that settles a far world as a *company*, a sub-empire of the founder's race bound by a Subjugated Dominion
// or Protectorate treaty, which pays the founder a tariff on its sales. Every step reuses ported mechanics:
//   - the company is a mid-game empire (scenario/empireMidGame.ts createEmpireMidGame → Galaxy.7.cs GenerateEmpire,
//     as Galaxy.8.cs 1348 GenerateShakturi), created with the target planet kept as it is (preserveHome);
//   - the relation mirrors BaconDistantWorlds/BaconHabitat.cs 1126 LeaveEmpire(grantingIndependance: false):
//     ChangeDiplomaticRelation(SubjugatedDominion), DetermineEmpireRelationshipFactors, the new empire's evaluation of
//     its old owner FirstContactPenalty 0 / IncidentEvaluation +60; plus Empire.8.cs 1853 OfferMilitaryRefueling both
//     ways. Tribute is the stock Empire.1.cs 996 ProcessSubjugationTribute (treasury.ts), untouched;
//   - the expedition ships follow Galaxy.8.cs 1546 GenerateCivilianConvoy (story/storyEvents.ts generateCivilianConvoy:
//     GenerateNewBuiltObject, TakeOwnershipOfBuiltObject, AssignMission Move);
//   - tech and maps move through the stock trade path (tradeItems.ts ResolveTradeableItems* / GiveTradeableItem);
//   - nationalisation reuses conquest: Empire.cs TakeOwnershipOfColony (combat/ownership.ts takeOwnershipOfColonyFull)
//     and Empire.cs 4874 CompleteTeardown(conqueror); release mirrors Empire.8.cs 1641 EndSubjugation.
// This scenario runs without 19a (rim trader): "rim goods" are every resource, and "rim worlds" are habitats at a galaxy
// radius fraction ≥ rimRadiusPct (they double a target's value in charterTargets).
//
// Rnd (spec §5): draws only in grantCharter / nationaliseCompany / releaseCompany and their ported callees — reached from
// a player command (player/playerOps.ts charter* ops, journaled in the command log) or from the yearly handler — and the
// yearly handler's one rnd.next(0, 100) per qualifying AI founder. The tariff listener, the war block, eligibility and
// the queries never draw. With no scenario or `charteredCompanies` off none of this runs.
//
// TODO(19c-2): charter terms as a tradeable treaty renegotiated in the trade panel (new TradeableItem type); exclusive
// luxury rights; requisitioning the company fleet in war for a fee; corruption / scandal story events (19d, 19f-10
// "Corporate coup"); explicit competition AI between rival companies beyond independent AI charters; a rim-trader
// (19a) tariff restricted to rim goods sold to the Concord; the freight-overlay hub marker + tariff row (19e-9).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { EmpirePolicy } from '../../data/policies';
import type { BuiltObject } from '../../builtObject';
import type { Design } from '../../design';
import { HabitatCategoryType, HabitatType, type Habitat } from '../../types';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../missions/mission';
import { assignMission } from '../../missions/assign';
import { designsFindNewestCanBuild } from '../../forceStructure';
import { findNewestCanBuild } from '../../designGeneration';
import { generateNewBuiltObject } from '../../empireEvents';
import { takeOwnershipOfBuiltObject, takeOwnershipOfColonyFull } from '../../combat/ownership';
import { empireCompleteTeardown } from '../../events';
import { canEmpireColonizeHabitat } from '../../exploration';
import { determineColonizationValue, giveTradeableItem, resolveTradeableItemsMaps, resolveTradeableItemsResearchProjects, TradeableItemType } from '../../tradeItems';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../diplomacy';
import { applyReputation } from '../reputation/ledger';
import { changeDiplomaticRelation, friendlinessLevel, militaryPotency, offerMilitaryRefueling } from '../../diplomacyTick';
import { determineEmpireRelationshipFactors } from '../../empireRelationshipFactors';
import { fastFindNearestSpacePort } from '../../stationPlacement';
import { determineSpacePortAtHabitat } from '../../logistics/colonySupply';
import { thisYearsForeignTradeBonuses, thisYearsSpacePortIncome } from '../../treasury';
import { annualTaxRevenue } from '../../forceStructure';
import { baconSettings } from '../../data/baconSettings';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { gameYear, radiusFraction, registerScenarioEvent, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { raiseScenarioDecision, registerScenarioDecision, type ScenarioDecision } from '../decisions';
import { createEmpireMidGame } from '../empireMidGame';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';

export const CHARTER_FLAG = 'charteredCompanies';
export const AI_CHARTER_FLAG = 'aiCharters';
export const HQ_EXPORT_FLAG = 'companyHqExportOnly';
export const CHARTER_EXPIRY_DECISION = 'charters.expiry';

export type CharterKind = 'dominion' | 'protectorate';
export type CharterStatus = 'active' | 'autonomous' | 'released' | 'nationalised' | 'dissolved' | 'revoked';

/** One charter (saved plain data: ids, not object references — spec §6). */
export interface Charter {
    companyId: number;
    founderId: number;
    /** Galaxy.habitats index of the settled world. */
    targetIndex: number;
    kind: CharterKind;
    tariffPct: number;
    durationYears: number;
    startYear: number;
    feePaid: number;
    tariffThisYear: number;
    tariffLastYear: number;
    tariffTotal: number;
    status: CharterStatus;
    /** Game year the expiry question was raised for the current term (-1: not yet). */
    expiryNotifiedYear: number;
}

export interface CharterTerms {
    kind: CharterKind;
    tariffPct: number;
    durationYears: number;
}

interface ChartersState {
    charters: Charter[];
}

// ---------------------------------------------------------------------------------------------------------------
// Params and state
// ---------------------------------------------------------------------------------------------------------------

export const charterFee = (g: Galaxy): number => scenarioParam(g, 'charterFee', 30000);
const tariffDefault = (g: Galaxy): number => scenarioParam(g, 'charterTariffPct', 15);
const durationDefault = (g: Galaxy): number => scenarioParam(g, 'charterDurationYears', 20);
const startPopulationMillions = (g: Galaxy): number => scenarioParam(g, 'companyStartPopulation', 50);
const escortCount = (g: Galaxy): number => Math.trunc(scenarioParam(g, 'companyEscorts', 3));
const freighterCount = (g: Galaxy): number => Math.trunc(scenarioParam(g, 'companyFreighters', 2));
const maxCompaniesPerFounder = (g: Galaxy): number => Math.trunc(scenarioParam(g, 'maxCompaniesPerFounder', 2));
const aiCharterChancePct = (g: Galaxy): number => scenarioParam(g, 'aiCharterChancePct', 25);
const rimRadius = (g: Galaxy): number => scenarioParam(g, 'rimRadiusPct', 60) / 100;

/** The default terms (params). */
export function defaultCharterTerms(galaxy: Galaxy): CharterTerms {
    return { kind: 'dominion', tariffPct: tariffDefault(galaxy), durationYears: durationDefault(galaxy) };
}

function chartersState(galaxy: Galaxy): ChartersState {
    return scenarioState<ChartersState>(galaxy, 'charteredCompanies.charters', () => ({ charters: [] }));
}

/** Every charter in the game, oldest first (empty without the scenario / before the first charter). No Rnd. */
export function allCharters(galaxy: Galaxy): readonly Charter[] {
    if (galaxy.scenario === null || !('charteredCompanies.charters' in galaxy.scenario.state)) return [];
    return chartersState(galaxy).charters;
}

export function empireById(galaxy: Galaxy, id: number): Empire | null {
    for (const e of galaxy.empires) if (e !== null && e.empireId === id) return e;
    return null;
}

const currentYear = (galaxy: Galaxy): number => gameYear(galaxyStarDate(galaxy));

// ---------------------------------------------------------------------------------------------------------------
// Queries (spec §4.12; pure)
// ---------------------------------------------------------------------------------------------------------------

/** The founder's charters (every status), oldest first. */
export function chartersOf(galaxy: Galaxy, founder: Empire): Charter[] {
    return allCharters(galaxy).filter((c) => c.founderId === founder.empireId);
}

/** The charter whose company is `company` (null: not a company). */
export function charterOfCompany(galaxy: Galaxy, company: Empire): Charter | null {
    return allCharters(galaxy).find((c) => c.companyId === company.empireId) ?? null;
}

/** The active charter of `company` (null when it is not a company, or no longer bound). */
export function activeCharterOfCompany(galaxy: Galaxy, company: Empire): Charter | null {
    const c = charterOfCompany(galaxy, company);
    return c !== null && c.status === 'active' ? c : null;
}

/** True when `e` was founded as a company (any status). */
export function isCompany(galaxy: Galaxy, e: Empire): boolean {
    return charterOfCompany(galaxy, e) !== null;
}

/** Active companies of `founder`. */
export function activeCompanyCount(galaxy: Galaxy, founder: Empire): number {
    return allCharters(galaxy).filter((c) => c.founderId === founder.empireId && c.status === 'active').length;
}

/** Years left of the current term (0 when expired / inactive). */
export function charterYearsLeft(galaxy: Galaxy, c: Charter): number {
    if (c.status !== 'active') return 0;
    return Math.max(0, c.startYear + c.durationYears - currentYear(galaxy));
}

/**
 * Tribute per year a dominion company pays: the stock Empire.1.cs 996 ProcessSubjugationTribute formula for a full
 * year ((annualTaxRevenue + thisYearsForeignTradeBonuses + thisYearsSpacePortIncome) × SubjugationTributePercentage);
 * 0 for a protectorate or a company no longer bound.
 */
export function estimatedTribute(galaxy: Galaxy, company: Empire): number {
    const c = activeCharterOfCompany(galaxy, company);
    if (c === null || c.kind !== 'dominion') return 0;
    return (annualTaxRevenue(galaxy, company) + thisYearsForeignTradeBonuses(company) + thisYearsSpacePortIncome(galaxy, company)) * baconSettings.subjugationTributePercentage;
}

/** True for a habitat in the galaxy rim (radius fraction ≥ rimRadiusPct / 100). */
export function isRimWorld(galaxy: Galaxy, h: Habitat): boolean {
    return radiusFraction(galaxy, h.xpos, h.ypos) >= rimRadius(galaxy);
}

// ---------------------------------------------------------------------------------------------------------------
// Eligibility and targets (spec §4.2 / §4.3; pure, no Rnd)
// ---------------------------------------------------------------------------------------------------------------

function isFounderCapable(galaxy: Galaxy, e: Empire): string {
    if (!e.active) return 'Empire is not active.';
    if (e.pirateEmpireBaseHabitat !== null) return 'Pirates cannot charter companies.';
    if (e === galaxy.independentEmpire) return 'Independents cannot charter companies.';
    if (isCompany(galaxy, e)) return 'A company cannot charter companies.';
    return '';
}

/** Why `founder` may (ok) or may not charter a company to settle `target`. */
export function charterEligibility(galaxy: Galaxy, founder: Empire, target: Habitat): { ok: boolean; reason: string } {
    const no = (reason: string) => ({ ok: false, reason });
    if (!scenarioFlag(galaxy, CHARTER_FLAG)) return no('Chartered companies are not enabled.');
    const f = isFounderCapable(galaxy, founder);
    if (f !== '') return no(f);
    if (founder.stateMoney < charterFee(galaxy)) return no(`Not enough money: the charter fee is ${Math.round(charterFee(galaxy))} credits.`);
    if (activeCompanyCount(galaxy, founder) >= maxCompaniesPerFounder(galaxy)) return no('Maximum number of companies reached.');
    if (galaxy.nextEmpireId >= galaxy.maximumEmpireCount) return no('No room for another empire in this galaxy.');
    if (target.category !== HabitatCategoryType.Planet && target.category !== HabitatCategoryType.Moon) return no('Only planets and moons can be settled.');
    if (target.empire !== null || target.owner !== null) return no('The world is already owned.');
    if (target.population.items.length > 0 || target.population.totalAmount > 0) return no('The world is already populated.');
    if (!founder.visibility.checkSystemExplored(target.systemIndex)) return no('The system has not been explored.');
    for (const h of galaxy.systemHabitatsOf(target.systemIndex)) {
        if (h.empire !== null && h.empire !== galaxy.independentEmpire) return no('Another empire already has a colony in this system.');
    }
    // Empire.4.cs 4434 CanEmpireColonizeHabitat with the founder's race and newest colony ship (as the colonize
    // order does, executeShipAction.ts); no range check — a company settles beyond the founder's colonisation range.
    const latestColonyShip = findNewestCanBuild(founder.designs, BuiltObjectSubRole.ColonyShip, founder);
    if (!canEmpireColonizeHabitat(galaxy, founder, founder, target, founder.colonizableHabitatTypesForEmpire(), latestColonyShip, false)) return no('Our settlers cannot live on this world.');
    // Empire.6.cs 2280 CheckShouldAttemptColonization's dominant-empire test.
    const dom = galaxy.systems[target.systemIndex].dominantEmpire ?? null;
    if (dom !== null && dom.empire !== null && dom.empire !== founder && dom.totalStrategicValue > 100000) return no('The system is dominated by another empire.');
    return { ok: true, reason: '' };
}

/**
 * Eligible targets for `founder`, best first: DetermineColonizationValue (Empire.4.cs 4199) × 2 for a rim world, ties
 * by habitat index. `limit` caps the list (the AI uses 20).
 */
export function charterTargets(galaxy: Galaxy, founder: Empire, limit = Infinity): Habitat[] {
    if (!scenarioFlag(galaxy, CHARTER_FLAG)) return [];
    const scored: { h: Habitat; v: number }[] = [];
    for (const h of galaxy.habitats) {
        if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
        if (h.empire !== null || !founder.visibility.checkSystemExplored(h.systemIndex)) continue;
        if (!charterEligibility(galaxy, founder, h).ok) continue;
        const v = determineColonizationValue(galaxy, founder, h) * (isRimWorld(galaxy, h) ? 2 : 1);
        scored.push({ h, v });
    }
    scored.sort((a, b) => b.v - a.v || a.h.habitatIndex - b.h.habitatIndex);
    return scored.slice(0, limit).map((s) => s.h);
}

// ---------------------------------------------------------------------------------------------------------------
// Company policy (spec §4.5)
// ---------------------------------------------------------------------------------------------------------------

const COLONIZE_PRIORITY_FIELD: Partial<Record<HabitatType, keyof EmpirePolicy>> = {
    [HabitatType.Continental]: 'colonizeContinentalPriority',
    [HabitatType.MarshySwamp]: 'colonizeMarshySwampPriority',
    [HabitatType.Ocean]: 'colonizeOceanPriority',
    [HabitatType.Desert]: 'colonizeDesertPriority',
    [HabitatType.Ice]: 'colonizeIcePriority',
    [HabitatType.Volcanic]: 'colonizeVolcanicPriority',
};

/** The company's policy over its race's stock policy: a trading, expanding, peaceful posture. */
export function companyPolicy(policy: EmpirePolicy, nativeType: HabitatType): void {
    policy.tradePriority = 4;
    policy.tradeWithOtherEmpires = true;
    policy.explorationPriority = 2;
    const field = COLONIZE_PRIORITY_FIELD[nativeType];
    if (field !== undefined) (policy as unknown as Record<string, number>)[field] = 2;
    policy.warWillingness = 0.5;
    policy.breakTreatyWillingness = 0.5;
    policy.subjugationPriority = 0.5;
    policy.diplomacySendGiftsUpToAmount = 0;
    policy.buildPlanetDestroyers = false;
}

// ---------------------------------------------------------------------------------------------------------------
// Granting a charter (spec §4.4)
// ---------------------------------------------------------------------------------------------------------------

const CORPORATE_NATIONALISM = 12;

function newestDesign(company: Empire, subRole: BuiltObjectSubRole, fallback: BuiltObjectSubRole | null): Design | null {
    return designsFindNewestCanBuild(company.designs, subRole) ?? (fallback !== null ? designsFindNewestCanBuild(company.designs, fallback) : null);
}

/**
 * The expedition (Galaxy.8.cs 1546 GenerateCivilianConvoy pattern): colony ship, construction ship, escorts and
 * freighters for the company, spawned at the founder's space port nearest the target (else its capital) and sent to
 * the target. Draws galaxy.rnd (parking points, GenerateNewBuiltObject).
 */
function spawnExpedition(galaxy: Galaxy, founder: Empire, company: Empire, target: Habitat): BuiltObject[] {
    const port = fastFindNearestSpacePort(galaxy, target.xpos, target.ypos, founder);
    const origin = port ?? founder.capital ?? target;
    const roles: [BuiltObjectSubRole, BuiltObjectSubRole | null][] = [
        [BuiltObjectSubRole.ColonyShip, null],
        [BuiltObjectSubRole.ConstructionShip, null],
    ];
    for (let i = 0; i < escortCount(galaxy); i++) roles.push([BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate]);
    for (let i = 0; i < freighterCount(galaxy); i++) roles.push([BuiltObjectSubRole.SmallFreighter, BuiltObjectSubRole.MediumFreighter]);
    const ships: BuiltObject[] = [];
    for (const [subRole, fallback] of roles) {
        const design = newestDesign(company, subRole, fallback);
        if (design === null) continue;
        const p = galaxy.selectRelativeParkingPoint();
        const bo = generateNewBuiltObject(galaxy, company, design, null, origin.xpos + p.x, origin.ypos + p.y);
        if (bo.subRole === BuiltObjectSubRole.ColonyShip) bo.nativeRace = founder.dominantRace;
        takeOwnershipOfBuiltObject(galaxy, company, bo, company, false);
        bo.isAutoControlled = true;
        assignMission(galaxy, bo, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.Normal);
        ships.push(bo);
    }
    return ships;
}

export interface GrantResult {
    ok: boolean;
    reason: string;
    company: Empire | null;
}

/**
 * Charters a company for `founder` to settle `target` (player command or the yearly AI handler). Draws galaxy.rnd
 * (createEmpireMidGame, the expedition, the ported callees).
 */
export function grantCharter(galaxy: Galaxy, founder: Empire, target: Habitat, terms: CharterTerms): GrantResult {
    const el = charterEligibility(galaxy, founder, target);
    if (!el.ok) return { ok: false, reason: el.reason, company: null };
    const race = founder.dominantRace;
    if (race === null) return { ok: false, reason: 'The empire has no race.', company: null };
    const fee = charterFee(galaxy);
    const kind: CharterKind = terms.kind === 'protectorate' ? 'protectorate' : 'dominion';
    const tariffPct = Math.max(0, Math.min(50, terms.tariffPct));
    const durationYears = Math.max(1, Math.min(100, Math.trunc(terms.durationYears)));
    founder.stateMoney -= fee;
    const systemName = galaxy.systems[target.systemIndex]?.systemStar.name ?? target.name;
    // Population ≈ companyStartPopulation: GenerateEmpire (age 0) settles trunc(f × 2.2e9 + f × rnd × 5e8), mean f × 2.45e9.
    const factor = (startPopulationMillions(galaxy) * 1e6) / 2.45e9;
    const governmentId = race.disallowedGovernments.includes(CORPORATE_NATIONALISM) ? founder.governmentId : CORPORATE_NATIONALISM;
    const company = createEmpireMidGame(galaxy, {
        race,
        name: scenarioText('Scenario Charter Company Name', systemName),
        home: target,
        age: 0,
        techLevel: 0.5,
        governmentId,
        preserveHome: true,
        homeSystemFactor: factor,
        setup: false,
        configurePolicy: (p) => companyPolicy(p, race.nativeHabitatType),
    });
    if (company === null) {
        founder.stateMoney += fee;
        return { ok: false, reason: 'No room for another empire in this galaxy.', company: null };
    }
    // Money (overrides GenerateEmpire's start money): the fee finances the company.
    company.stateMoney = fee * 0.6;
    company.privateMoney = fee * 0.4;
    // Tech and maps via the stock trade path.
    for (const item of resolveTradeableItemsResearchProjects(galaxy, founder, company, false, false)) giveTradeableItem(galaxy, founder, company, item, null);
    for (const item of resolveTradeableItemsMaps(galaxy, founder, company, false)) {
        if (item.type === TradeableItemType.GalaxyMap) giveTradeableItem(galaxy, founder, company, item, null);
    }
    // Relation: BaconHabitat.cs 1126 LeaveEmpire (grantingIndependance false), founder as initiator on both sides.
    const rel = obtainDiplomaticRelation(founder, company);
    changeDiplomaticRelation(galaxy, founder, rel, kind === 'dominion' ? DiplomaticRelationType.SubjugatedDominion : DiplomaticRelationType.Protectorate);
    void determineEmpireRelationshipFactors(company, founder);
    const ev = obtainEmpireEvaluation(galaxy, company, founder);
    ev.firstContactPenalty = 0.0;
    ev.incidentEvaluation = ev.incidentEvaluationStock + 60.0; // `+= 60` (the stock getter: never bakes in a 19o ledger sum)
    offerMilitaryRefueling(founder, company);
    offerMilitaryRefueling(company, founder);
    spawnExpedition(galaxy, founder, company, target);
    const year = currentYear(galaxy);
    chartersState(galaxy).charters.push({
        companyId: company.empireId,
        founderId: founder.empireId,
        targetIndex: target.habitatIndex,
        kind,
        tariffPct,
        durationYears,
        startYear: year,
        feePaid: fee,
        tariffThisYear: 0,
        tariffLastYear: 0,
        tariffTotal: 0,
        status: 'active',
        expiryNotifiedYear: -1,
    });
    scenarioNews(galaxy, founder, scenarioText('Scenario Charter News', company.name, founder.name, target.name), undefined, target);
    scenarioMessage(galaxy, founder, company.name, scenarioText('Scenario Charter Granted', company.name, target.name), { type: EmpireMessageType.GeneralGoodEvent, subject: target });
    return { ok: true, reason: '', company };
}

// ---------------------------------------------------------------------------------------------------------------
// Ending / renewing a charter (spec §4.10 / §4.11)
// ---------------------------------------------------------------------------------------------------------------

function activePair(galaxy: Galaxy, founder: Empire, company: Empire): Charter | null {
    const c = activeCharterOfCompany(galaxy, company);
    return c !== null && c.founderId === founder.empireId ? c : null;
}

/**
 * Nationalises `company`: its colonies go to the founder (Empire.cs TakeOwnershipOfColony), then Empire.cs 4874
 * CompleteTeardown(conqueror) hands its ships and cargo over (taking the last colony already runs it). The other
 * companies of the founder resent it. Returns false when `company` is not an active company of `founder`.
 */
export function nationaliseCompany(galaxy: Galaxy, founder: Empire, company: Empire): boolean {
    const c = activePair(galaxy, founder, company);
    if (c === null) return false;
    c.status = 'nationalised';
    for (const colony of [...company.colonies]) takeOwnershipOfColonyFull(galaxy, company, colony, founder, false, false);
    if (company.active && galaxy.empires.includes(company)) empireCompleteTeardown(galaxy, company, founder);
    scenarioNews(galaxy, founder, scenarioText('Scenario Charter Nationalised', company.name, founder.name));
    for (const other of allCharters(galaxy)) {
        if (other.founderId !== founder.empireId || other.status !== 'active') continue;
        const e = empireById(galaxy, other.companyId);
        if (e !== null) applyReputation(galaxy, e, founder, -20.0, { cause: 'charters.nationalised', source: '19c', legacy: 'factored' });
    }
    return true;
}

/** Releases `company` from its charter (Empire.8.cs 1641 EndSubjugation without the automation prompt). */
export function releaseCompany(galaxy: Galaxy, founder: Empire, company: Empire): boolean {
    const c = activePair(galaxy, founder, company);
    if (c === null) return false;
    c.status = 'released';
    changeDiplomaticRelation(galaxy, founder, obtainDiplomaticRelation(founder, company), DiplomaticRelationType.None);
    const text = scenarioText('Scenario Charter Released', company.name, founder.name);
    scenarioMessage(galaxy, founder, company.name, text);
    scenarioMessage(galaxy, company, company.name, text);
    return true;
}

/** Renews the charter for another term (same kind; optional new tariff / duration). */
export function renewCharter(galaxy: Galaxy, founder: Empire, company: Empire, terms: Partial<Pick<CharterTerms, 'tariffPct' | 'durationYears'>> = {}): boolean {
    const c = activePair(galaxy, founder, company);
    if (c === null) return false;
    c.startYear = currentYear(galaxy);
    if (terms.tariffPct !== undefined) c.tariffPct = Math.max(0, Math.min(50, terms.tariffPct));
    if (terms.durationYears !== undefined) c.durationYears = Math.max(1, Math.min(100, Math.trunc(terms.durationYears)));
    c.expiryNotifiedYear = -1;
    scenarioMessage(galaxy, founder, company.name, scenarioText('Scenario Charter Renewed', company.name, c.durationYears));
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Tariff (spec §4.6): contractInitiated listener, no Rnd
// ---------------------------------------------------------------------------------------------------------------

/** Applies the tariff of one contracted sale (exported for tests). Returns the tariff moved. */
export function applyCharterTariff(galaxy: Galaxy, seller: Empire, buyer: Empire | null, resourceId: number, value: number): number {
    if (resourceId < 0 || !(value > 0)) return 0;
    const c = activeCharterOfCompany(galaxy, seller);
    if (c === null || c.tariffPct <= 0) return 0;
    const founder = empireById(galaxy, c.founderId);
    if (founder === null || buyer === founder) return 0;
    const t = (value * c.tariffPct) / 100;
    seller.privateMoney -= t;
    founder.stateMoney += t;
    c.tariffThisYear += t;
    c.tariffTotal += t;
    return t;
}

registerScenarioEvent({
    id: 'charters.tariff',
    flag: CHARTER_FLAG,
    event: 'contractInitiated',
    run: (galaxy, ev) => {
        applyCharterTariff(galaxy, ev.seller, ev.buyer, ev.resourceId, ev.value);
    },
});

// ---------------------------------------------------------------------------------------------------------------
// War rules (spec §4.8): declareWar query, no Rnd
// ---------------------------------------------------------------------------------------------------------------

/** True when `self` may not declare war on `target` under the charter rules (AI companies / AI founders only). */
export function charterWarBlocked(galaxy: Galaxy, self: Empire, target: Empire): boolean {
    if (self === galaxy.playerEmpire) return false;
    const own = activeCharterOfCompany(galaxy, self);
    if (own !== null && own.founderId === target.empireId) return true;
    const theirs = activeCharterOfCompany(galaxy, target);
    return theirs !== null && theirs.founderId === self.empireId;
}

registerScenarioQuery({
    id: 'charters.warBlocked',
    flag: CHARTER_FLAG,
    query: 'declareWarBlocked',
    run: (galaxy, value, args) => value || charterWarBlocked(galaxy, args.empire, args.target),
});

/** Single export point (spec §4.7): with companyHqExportOnly a company trades only at its capital's space port. */
registerScenarioQuery({
    id: 'charters.singlePort',
    flag: HQ_EXPORT_FLAG,
    query: 'foreignTradingPosts',
    run: (galaxy, value, args) => {
        if (value !== undefined || !scenarioFlag(galaxy, CHARTER_FLAG) || !isCompany(galaxy, args.other)) return value;
        return determineSpacePortAtHabitat(args.other.capital);
    },
});

// ---------------------------------------------------------------------------------------------------------------
// Expiry decision and the yearly handler (spec §4.9)
// ---------------------------------------------------------------------------------------------------------------

/** C5: an AI founder renews when tariffs paid the fee, nationalises when ≥ 3× stronger, else releases. */
export function aiExpiryChoice(galaxy: Galaxy, founder: Empire, company: Empire, c: Charter): 'renew' | 'nationalise' | 'release' {
    if (c.tariffTotal >= c.feePaid) return 'renew';
    if (militaryPotency(founder) >= 3 * militaryPotency(company)) return 'nationalise';
    return 'release';
}

function decisionPair(galaxy: Galaxy, d: ScenarioDecision): { founder: Empire; company: Empire; c: Charter } | null {
    const company = empireById(galaxy, d.context.companyId as number);
    if (company === null) return null;
    const c = activeCharterOfCompany(galaxy, company);
    if (c === null || c.founderId !== d.empire.empireId) return null;
    return { founder: d.empire, company, c };
}

registerScenarioDecision({
    id: CHARTER_EXPIRY_DECISION,
    flag: CHARTER_FLAG,
    kind: CHARTER_EXPIRY_DECISION,
    resolve: (galaxy, d, optionId) => {
        const p = decisionPair(galaxy, d);
        if (p === null) return;
        if (optionId === 'renew') {
            // Only for the term the question was raised for (the player may have renewed from the Charters screen).
            if (p.c.startYear === d.context.termStart) renewCharter(galaxy, p.founder, p.company);
        } else if (optionId === 'nationalise') nationaliseCompany(galaxy, p.founder, p.company);
        else if (optionId === 'release') releaseCompany(galaxy, p.founder, p.company);
    },
    aiChoose: (galaxy, d) => {
        const p = decisionPair(galaxy, d);
        return p === null ? d.defaultOption : aiExpiryChoice(galaxy, p.founder, p.company, p.c);
    },
});

function chartedType(c: Charter): DiplomaticRelationType {
    return c.kind === 'dominion' ? DiplomaticRelationType.SubjugatedDominion : DiplomaticRelationType.Protectorate;
}

/** The yearly charter handler (exported for tests; registered below). May draw (AI charters, expiry outcomes). */
export function chartersYearly(galaxy: Galaxy, year: number): void {
    const st = chartersState(galaxy);
    // a. Status and the year's tariff.
    for (const c of st.charters) {
        if (c.status !== 'active') continue;
        const company = empireById(galaxy, c.companyId);
        const founder = empireById(galaxy, c.founderId);
        if (company === null || !company.active) {
            c.status = 'dissolved';
            continue;
        }
        if (founder === null || !founder.active) {
            c.status = 'autonomous';
            continue;
        }
        const relType = obtainDiplomaticRelation(founder, company).type;
        if (relType !== chartedType(c)) {
            c.status = relType === DiplomaticRelationType.War && founder === galaxy.playerEmpire ? 'revoked' : 'autonomous';
            scenarioNews(galaxy, company, scenarioText('Scenario Charter Autonomy', company.name, founder.name));
            continue;
        }
        if (c.tariffThisYear > 0) scenarioMessage(galaxy, founder, company.name, scenarioText('Scenario Charter Tariff', company.name, Math.round(c.tariffThisYear)));
        c.tariffLastYear = c.tariffThisYear;
        c.tariffThisYear = 0;
    }
    // b. Expiry: a decision for the founder (the player answers; an AI founder answers at once through aiExpiryChoice).
    for (const c of [...st.charters]) {
        if (c.status !== 'active' || year < c.startYear + c.durationYears || c.expiryNotifiedYear >= c.startYear) continue;
        const founder = empireById(galaxy, c.founderId);
        const company = empireById(galaxy, c.companyId);
        if (founder === null || company === null) continue;
        c.expiryNotifiedYear = year;
        raiseScenarioDecision(galaxy, founder, {
            kind: CHARTER_EXPIRY_DECISION,
            title: company.name,
            text: scenarioText('Scenario Charter Expiring', company.name),
            options: [
                { id: 'renew', label: 'Renew' },
                { id: 'release', label: 'Release' },
                { id: 'nationalise', label: 'Nationalise' },
            ],
            defaultOption: 'renew',
            expiresDays: 360,
            context: { companyId: company.empireId, termStart: c.startYear },
        });
    }
    // c. AI founders charter rival companies.
    if (!scenarioFlag(galaxy, AI_CHARTER_FLAG)) return;
    const fee = charterFee(galaxy);
    for (const e of [...galaxy.empires]) {
        if (e === null || e === galaxy.playerEmpire || isFounderCapable(galaxy, e) !== '') continue;
        if (e.stateMoney < 2 * fee || activeCompanyCount(galaxy, e) >= maxCompaniesPerFounder(galaxy)) continue;
        const targets = charterTargets(galaxy, e, 20);
        if (targets.length === 0) continue;
        if (galaxy.rnd.next(0, 100) < aiCharterChancePct(galaxy)) {
            grantCharter(galaxy, e, targets[0], { kind: friendlinessLevel(e) >= 120 ? 'protectorate' : 'dominion', tariffPct: tariffDefault(galaxy), durationYears: durationDefault(galaxy) });
        }
    }
}

registerScenarioYearly({ id: 'charters.yearly', flag: CHARTER_FLAG, order: 20, run: chartersYearly });
