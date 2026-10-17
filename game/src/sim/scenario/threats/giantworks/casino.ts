// Giantworks wonder A: The Gilded Orbit, a resort and casino ring (flag gwCasino). Not a port; composed of ported functions.
// Registered from scenario/packages.ts through registerGreatWork; every handler is gated by the Giantworks flag, so with the
// add-on off nothing here runs, draws or is saved.
//
//   Open     - the finished resort pays the empire whose territory holds it (or the empire that seized it), less the Compact's
//              cut (benefits.ts greatWorkPay): paid by the clock (at each of the framework's periodic steps) a share of an average empire's yearly tax revenue
//              (gwCasinoIncomePct), booked as the stock resort income (treasury.ts addResortIncome, Counters.TourismIncome).
//              That empire's colonies within gwCasinoHappinessSectors are happier (query empireApprovalRating) and draw
//              tourists (colonyScenicFactor: the stock tourism destinations); those within gwCasinoImmigrationSectors draw
//              immigrants (query colonyMigrationFactor: the stock migration destinations).
//   The twist - with gwCasinoFrontPct (40 %) the resort is a front for a huge smuggling empire, rolled at completion from the
//              add-on's own random stream. It surfaces gwCasinoRevealMinYears..MaxYears after completion, sooner when an
//              agent's DeepCover mission against the Compact succeeds (gwCasinoDeepCoverPct): a new pirate faction (the stock
//              createEmpireMidGame pirate, its designs at the best tech level the empires have reached) fortifies the system
//              with THREE huge pirate bases (the super-pirate base design) guarded by a fleet of high-tier warships; the
//              resort's income and its colonies' bonuses stop, the casino counts as hostile (destroying or seizing it is no
//              crime), and the pirates plant stock Criminal Network facilities on the colonies within gwCasinoNetSectors (the
//              facility's corruption cuts the colony's revenue, as the stock facility does), their raiders prey on private
//              freighters, and the crisis interactions (crisis.ts) count fighting them as helping.
//   Purge    - nothing special: when all three bases are gone (destroyed, or taken over) the pirate faction breaks (the stock
//              eliminatePirateFaction: its fleets are dismissed, its networks removed), the casino is under renovation for
//              gwCasinoRenovationDays (6 months), then runs clean at gwCasinoCleanPct (80 %) of the normal benefit.
//
// Rnd: the twist and the reveal date draw the add-on's own Random (state.ts ownRandom); the pirate faction's creation, designs,
// names and ship placement draw galaxy.rnd inside this module's gated handlers only (stock functions). The benefit queries are
// pure. State: scenario.state.giantworksCasino (plain data plus Empire / BuiltObject / Habitat references).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import { BuiltObject } from '../../../builtObject';
import type { Design } from '../../../design';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import type { Habitat } from '../../../types';
import { isHumanEmpire } from '../../../humanEmpires';
import { EmpireMessageType } from '../../../messages';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { galaxyStarDate } from '../../../tick/simTime';
import { PiratePlayStyle, addPirateStartingShip, determineOrbitalBaseLocation, generateSuperPirateBaseDesign, resolveSuperPirateShipImageIndex, selectRandomPirateRace, upgradeMilitaryShipDesignMoreEngines, upgradeMilitaryShipDesignMoreWeapons } from '../../../pirates';
import { eliminatePirateFaction } from '../../../pirates/pirateGalaxyTick';
import { PirateColonyControl } from '../../../pirates/pirateColonyControl';
import { PirateRelationType, changePirateRelation, obtainPirateRelation } from '../../../pirateRelations';
import { checkRemoveFacilityTracking, facilitiesCountCompletedByType, queueFacilityConstruction } from '../../../construction/facilities';
import { PlanetaryFacilityType } from '../../../researchSystem';
import { generateDesignFromSpec } from '../../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { IntelligenceMissionType } from '../../../espionage';
import { isObjectVisibleToThisEmpire } from '../../../independentTraders';
import { addResortIncome } from '../../../treasury';
import { annualTaxRevenue } from '../../../forceStructure';
import { calculateOverallStrengthFactor } from '../../../combat/threats';
import { calculateOverallStrengthFactorWithoutShields, militaryPotency } from '../../../diplomacyTick';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { assignMission } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { isAiControlled } from '../../../missions/playerOrder';
import { createEmpireMidGame } from '../../empireMidGame';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery, scenarioQuery } from '../../hooks';
import { scenarioMessage, scenarioNews, scenarioText } from '../../messages';
import { scenarioParam, scenarioState } from '../../state';
import { peekThreatState } from '../framework';
import { empireTechLevel, maxDesignTechLevel, raiseFactionTech } from '../robotMutiny';
import { isActor } from './actions';
import { compactFaction, greatWorkBeneficiary, greatWorkPay, greatWorkShares, greatWorks, kindName, markGreatWorkHostile, registerGreatWork, registerHostileWonderCrisis, type GreatWorkRecord } from './framework';
import type { GreatWorkSite } from './types';
import { GW_FLAG, PERIOD_DAYS, TAG, isCompact, logGw, nextRandom, ordinaryEmpires, ownRandom } from './state';

export const CASINO_ID = 'casino';
export const CASINO_KEY = 'giantworksCasino';

// ---------------------------------------------------------------------------------------------------------------
// Parameters (scenarios/giantworks/scenario.json; the defaults here are the same values)
// ---------------------------------------------------------------------------------------------------------------

const DEFAULTS = {
    gwCasinoFrontPct: 40,
    gwCasinoRevealMinYears: 1,
    gwCasinoRevealMaxYears: 3,
    gwCasinoDeepCoverPct: 60,
    gwCasinoIncomePct: 50,
    gwCasinoHappiness: 8,
    gwCasinoHappinessSectors: 2,
    gwCasinoScenicPct: 50,
    gwCasinoImmigrationPct: 25,
    gwCasinoImmigrationSectors: 4,
    gwCasinoBasePowerPct: 80,
    gwCasinoStrengthPct: 45,
    gwCasinoMinShips: 12,
    gwCasinoMaxShips: 60,
    gwCasinoFleetCapPct: 130,
    gwCasinoAiMarginPct: 90,
    gwCasinoGuardPct: 66,
    gwCasinoRaiders: 4,
    gwCasinoRaidSectors: 8,
    gwCasinoNetSectors: 6,
    gwCasinoNetMax: 10,
    gwCasinoNetDays: 30,
    gwCasinoRenovationDays: 180,
    gwCasinoCleanPct: 80,
} as const;

export type CasinoParamName = keyof typeof DEFAULTS;

export function casinoParam(galaxy: Galaxy, name: CasinoParamName): number {
    return scenarioParam(galaxy, name, DEFAULTS[name]);
}

/** The longest stretch one payment covers (days). */
const MAX_PAY_SPAN_DAYS = 120;
/** The income never falls below this a year, however poor the empires (credits). */
const INCOME_FLOOR = 1_000_000;
/** The pirate treasury at its founding (the stock pirate start is 20 000). */
const PIRATE_START_MONEY = 1_000_000;
/** The huge bases the smugglers build (the user's decision: three). */
const HUGE_BASES = 3;
/** Reveal attempts that find no empire id left before the front gives up. */
const MAX_SPAWN_FAILS = 6;
/** Escalating hull classes of the smugglers' fleet, in the order they are fitted (a cycle; no randomness). */
const FLEET_CYCLE: readonly BuiltObjectSubRole[] = [
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.Carrier,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.Carrier,
];

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

/**
 * open       - the resort is running (a front not yet found out, or an honest casino) at the full benefit;
 * revealed   - the smugglers' front is out: the pirate faction holds the system; no benefit;
 * renovation - the front is broken; closed for gwCasinoRenovationDays;
 * clean      - reopened after a purge, at gwCasinoCleanPct of the benefit;
 * closed     - the casino was destroyed (the front, if it never surfaced, with it).
 */
export type CasinoPhase = 'open' | 'revealed' | 'renovation' | 'clean' | 'closed';

export interface CasinoRec {
    workId: number;
    /** The site's system star (distance base of the benefits). */
    star: Habitat;
    /** The twist was rolled (a smugglers' front). */
    front: boolean;
    phase: CasinoPhase;
    openedAt: number;
    /** Star date the front surfaces by itself (front only). */
    revealAt: number;
    revealedAt: number;
    /** The empire whose agent found the front out (null: it surfaced by itself). */
    exposedBy: Empire | null;
    spawnFails: number;
    renovationUntil: number;
    /** The empire that takes the main benefit (refreshed every period) and the share of the full benefit in force (0 .. 1). */
    beneficiary: Empire | null;
    benefit: number;
    /** Credits paid to empires (not the Compact) so far, and the last payment's star date. */
    paid: number;
    lastPay: number;
    /** The smugglers (null before the reveal and after the purge), the system habitat they hold, their three bases, their guards. */
    faction: Empire | null;
    home: Habitat | null;
    bases: BuiltObject[];
    guards: BuiltObject[];
    /** Colonies with a Criminal Network planted by the smugglers, and when the next one is due. */
    networks: Habitat[];
    nextNetwork: number;
    plantedTotal: number;
    /** Raid orders given to the smugglers' ships (count), and the empires that destroyed their bases (latest last). */
    raidOrders: number;
    /** Warships scrapped by the fleet cap. */
    scrapped: number;
    killers: Empire[];
    purgedBy: Empire | null;
    purgedAt: number;
    /** Strength of the huge bases and the fleet at the reveal (overall strength factor sums), for the soak report. */
    baseStrength: number;
    fleetStrength: number;
    /** The force's military potency at the reveal (the fleet cap's base). */
    potency0: number;
}

export interface CasinoState {
    sites: CasinoRec[];
    /** The live smugglers (the crisis entry reads it). */
    faction: Empire | null;
}

function newState(): CasinoState {
    return { sites: [], faction: null };
}

export function casinoState(galaxy: Galaxy): CasinoState {
    return scenarioState<CasinoState>(galaxy, CASINO_KEY, newState);
}

export function peekCasinoState(galaxy: Galaxy): CasinoState | null {
    return peekThreatState<CasinoState>(galaxy, CASINO_KEY);
}

/** The casino record of a Great Work (null: none yet). Pure. */
export function casinoRecOf(galaxy: Galaxy, workId: number): CasinoRec | null {
    return peekCasinoState(galaxy)?.sites.find((r) => r.workId === workId) ?? null;
}

function recSite(galaxy: Galaxy, rec: CasinoRec): GreatWorkRecord | null {
    return greatWorks(galaxy).find((w) => w.id === rec.workId) ?? null;
}

function alive(bo: BuiltObject | null | undefined, faction: Empire | null): bo is BuiltObject {
    return bo !== null && bo !== undefined && !bo.hasBeenDestroyed && faction !== null && bo.actualEmpire === faction;
}

/** The state's `faction` (the crisis entry reads it): the first smugglers still loose, else null. */
function syncFaction(galaxy: Galaxy): void {
    const st = casinoState(galaxy);
    st.faction = st.sites.find((r) => smugglersLoose(galaxy, r))?.faction ?? null;
}

/** The smugglers are loose: the faction is active and still a pirate faction. Pure. */
export function smugglersLoose(galaxy: Galaxy, rec: CasinoRec): boolean {
    const f = rec.faction;
    return f !== null && f.active && galaxy.pirateEmpires.includes(f);
}

// ---------------------------------------------------------------------------------------------------------------
// Income and benefits
// ---------------------------------------------------------------------------------------------------------------

/** What a fully running Gilded Orbit pays a year: gwCasinoIncomePct of an average empire's yearly tax revenue (at least INCOME_FLOOR). Pure. */
export function casinoAnnualIncome(galaxy: Galaxy): number {
    const es = ordinaryEmpires(galaxy);
    let sum = 0;
    for (const e of es) sum += annualTaxRevenue(galaxy, e);
    const mean = es.length > 0 ? sum / es.length : 0;
    return Math.max(INCOME_FLOOR, mean) * (casinoParam(galaxy, 'gwCasinoIncomePct') / 100);
}

function benefitFor(galaxy: Galaxy, rec: CasinoRec): number {
    if (rec.phase === 'open') return 1;
    if (rec.phase === 'clean') return Math.max(0, Math.min(1, casinoParam(galaxy, 'gwCasinoCleanPct') / 100));
    return 0;
}

/** The share of the full benefit that applies to colony `h` (0: none): the beneficiary's colonies within `sectors` of a running casino. Pure. */
export function casinoLocalBenefit(galaxy: Galaxy, h: Habitat, sectors: number): number {
    const st = peekCasinoState(galaxy);
    const owner = h.empire;
    if (st === null || owner === null || st.sites.length === 0) return 0;
    let best = 0;
    for (const r of st.sites) {
        if (r.benefit <= 0 || r.beneficiary !== owner) continue;
        const range = sectors * galaxy.sectorSize;
        if (galaxy.calculateDistanceSquared(h.xpos, h.ypos, r.star.xpos, r.star.ypos) > range * range) continue;
        if (r.benefit > best) best = r.benefit;
    }
    return best;
}

/**
 * Pays the income earned since the last payment (the framework's periodic runs once per long block, every 36 game days, whatever
 * its nominal period; the pay follows the clock) by the framework's shares, and books it as the stock resort / tourism income.
 * Returns what the empires (not the Compact) got.
 */
function payIncome(galaxy: Galaxy, site: GreatWorkRecord, rec: CasinoRec): number {
    const now = galaxyStarDate(galaxy);
    const since = rec.lastPay < 0 ? rec.openedAt : rec.lastPay;
    rec.lastPay = now;
    if (rec.benefit <= 0) return 0;
    const elapsed = Math.max(0, Math.min(now - since, MAX_PAY_SPAN_DAYS * GAME_DAY_LENGTH));
    const amount = (casinoAnnualIncome(galaxy) * rec.benefit * elapsed) / YEAR_LENGTH;
    if (!(amount > 0)) return 0;
    const shares = greatWorkShares(galaxy, site);
    greatWorkPay(galaxy, site, amount);
    let paid = 0;
    for (const s of shares) {
        if (s.empire === null || !s.empire.active || isCompact(galaxy, s.empire)) continue;
        const x = amount * s.share;
        addResortIncome(galaxy, s.empire, x);
        s.empire.counters.processTourismIncome(x);
        paid += x;
    }
    rec.paid += paid;
    return paid;
}

// ---------------------------------------------------------------------------------------------------------------
// Wonder hooks
// ---------------------------------------------------------------------------------------------------------------

function ensureRec(galaxy: Galaxy, site: GreatWorkRecord): CasinoRec {
    const st = casinoState(galaxy);
    let rec = st.sites.find((r) => r.workId === site.id) ?? null;
    if (rec !== null) return rec;
    const now = galaxyStarDate(galaxy);
    // The twist and the reveal date: the add-on's own stream (a fixed number of draws, whatever the roll).
    const rnd = ownRandom(galaxy, 9100 + site.id);
    const roll = rnd.nextDouble() * 100;
    const minY = Math.max(0, casinoParam(galaxy, 'gwCasinoRevealMinYears'));
    const maxY = Math.max(minY, casinoParam(galaxy, 'gwCasinoRevealMaxYears'));
    const years = minY + rnd.nextDouble() * (maxY - minY);
    rec = {
        workId: site.id,
        star: site.system.systemStar,
        front: roll < casinoParam(galaxy, 'gwCasinoFrontPct'),
        phase: 'open',
        openedAt: site.completeDate ?? now,
        revealAt: (site.completeDate ?? now) + years * YEAR_LENGTH,
        revealedAt: -1,
        exposedBy: null,
        spawnFails: 0,
        renovationUntil: -1,
        beneficiary: null,
        benefit: 1,
        paid: 0,
        lastPay: -1,
        faction: null,
        home: null,
        bases: [],
        guards: [],
        networks: [],
        nextNetwork: -1,
        plantedTotal: 0,
        raidOrders: 0,
        scrapped: 0,
        killers: [],
        purgedBy: null,
        purgedAt: -1,
        baseStrength: 0,
        fleetStrength: 0,
        potency0: 0,
    };
    st.sites.push(rec);
    return rec;
}

/** The wonder activates: the roll is made and the resort opens. */
function onComplete(galaxy: Galaxy, site: GreatWorkSite): void {
    const w = site as GreatWorkRecord;
    const rec = ensureRec(galaxy, w);
    rec.beneficiary = greatWorkBeneficiary(galaxy, w);
    rec.benefit = benefitFor(galaxy, rec);
    logGw(galaxy, galaxyStarDate(galaxy), `casino ${w.id} opens: front ${rec.front ? `yes, reveal due year ${(rec.revealAt / YEAR_LENGTH).toFixed(2)}` : 'no'}`);
    const b = rec.beneficiary;
    if (b !== null && isHumanEmpire(galaxy, b)) {
        scenarioMessage(galaxy, b, scenarioText(`${TAG} Casino Open Title`), scenarioText(`${TAG} Casino Open`, w.system.systemStar.name), {
            type: EmpireMessageType.GeneralGoodEvent,
            subject: w.base ?? w.system.systemStar,
            popup: false,
        });
    }
}

/** Every periodic of the framework (a long block) after completion: the beneficiary, the income, the renovation's end, the reveal that is due. */
function periodic(galaxy: Galaxy, site: GreatWorkSite): void {
    const w = site as GreatWorkRecord;
    const rec = ensureRec(galaxy, w);
    const now = galaxyStarDate(galaxy);
    rec.beneficiary = greatWorkBeneficiary(galaxy, w);
    if (rec.phase === 'renovation' && now >= rec.renovationUntil) reopen(galaxy, w, rec);
    rec.benefit = benefitFor(galaxy, rec);
    if (rec.phase === 'open' || rec.phase === 'clean') payIncome(galaxy, w, rec);
    else rec.lastPay = now; // closed or hunted: no back pay
    if (rec.phase === 'open' && rec.front && now >= rec.revealAt) reveal(galaxy, w, rec, null);
}

/** The casino is destroyed: the benefits stop for good, and a front that never surfaced dies with it. */
function onDestroyed(galaxy: Galaxy, site: GreatWorkSite, by: Empire | null): void {
    const w = site as GreatWorkRecord;
    const rec = casinoRecOf(galaxy, w.id);
    if (rec === null) return;
    void by;
    rec.benefit = 0;
    rec.beneficiary = null;
    if (rec.phase === 'open') rec.front = false;
    if (rec.phase !== 'revealed') rec.phase = 'closed';
    logGw(galaxy, galaxyStarDate(galaxy), `casino ${w.id} destroyed (${rec.phase})`);
}

// ---------------------------------------------------------------------------------------------------------------
// The reveal: the smugglers
// ---------------------------------------------------------------------------------------------------------------

/** The best tech level among the ordinary empires, within what the design generator reaches (the smugglers' designs are built at it). Pure. */
export function topTechLevel(galaxy: Galaxy): number {
    let best = 1;
    for (const e of ordinaryEmpires(galaxy)) best = Math.max(best, empireTechLevel(e));
    const max = maxDesignTechLevel(galaxy);
    return max > 0 ? Math.min(best, max) : best;
}

function siteHome(site: GreatWorkRecord): Habitat {
    return site.habitat ?? site.system.systemStar;
}

/** High-tier warship designs of the faction at `lvl` (the super-pirate pipeline: more engines, more weapons; the Phantom hull pictures). Draws Rnd (naming). */
function fleetDesigns(galaxy: Galaxy, faction: Empire, lvl: number): Map<BuiltObjectSubRole, Design> {
    raiseFactionTech(galaxy, faction, lvl);
    const now = galaxyStarDate(galaxy);
    const out = new Map<BuiltObjectSubRole, Design>();
    for (const sub of new Set(FLEET_CYCLE)) {
        const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === sub) ?? galaxyDesignSpecificationBySubRole(sub);
        if (spec === null || spec === undefined) continue;
        let d: Design | null = null;
        try {
            d = generateDesignFromSpec(galaxy, faction, spec, lvl, now);
        } catch {
            d = null;
        }
        if (d === null) continue;
        d = upgradeMilitaryShipDesignMoreEngines(d) ?? d;
        d = upgradeMilitaryShipDesignMoreWeapons(d) ?? d;
        d.pictureRef = resolveSuperPirateShipImageIndex(sub);
        faction.designs.push(d);
        out.set(sub, d);
    }
    return out;
}

/** One huge base in orbit round `home` (generateSuperPirateFaction's base block: the design, the orbit, the fuel and shields). */
function placeHugeBase(galaxy: Galaxy, faction: Empire, design: Design, home: Habitat, index: number): BuiltObject {
    design.buildCount++;
    const bo = new BuiltObject(design, scenarioText(`${TAG} Casino Base Name`, index + 1), galaxy, true);
    bo.empire = faction;
    bo.purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
    bo.heading = galaxy.selectRandomHeading();
    bo.targetHeading = bo.heading;
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    bo.currentShields = bo.shieldsCapacity;
    bo.supportCostFactor = 0; // the front pays for them
    const p = determineOrbitalBaseLocation(galaxy, home);
    faction.addBuiltObjectToGalaxy(bo, home, false, true, Math.trunc(p.x), Math.trunc(p.y), false);
    return bo;
}

/** Orders a ship to guard (patrol) a base: a standing manual order the pirate AI leaves alone. */
function guardBase(galaxy: Galaxy, ship: BuiltObject, base: BuiltObject): void {
    assignMission(galaxy, ship, BuiltObjectMissionType.Patrol, base, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
}

/**
 * The smugglers appear: a stock pirate faction (createEmpireMidGame kind 'pirate', designs at the best tech level) at the
 * casino's system, three huge bases and a fleet of high-tier warships, guards on station. Returns false when no empire id is left.
 */
function spawnSmugglers(galaxy: Galaxy, site: GreatWorkRecord, rec: CasinoRec): boolean {
    const race = selectRandomPirateRace(galaxy) ?? galaxy.races.find((r) => r !== null && r.canBePirate) ?? null;
    if (race === null) return false;
    const home = siteHome(site);
    const lvl = topTechLevel(galaxy);
    const faction = createEmpireMidGame(galaxy, {
        kind: 'pirate',
        race,
        home,
        name: scenarioText(`${TAG} Casino Faction Name`),
        piratePlayStyle: PiratePlayStyle.Pirate,
        techLevel: lvl,
    });
    if (faction === null) return false;
    const now = galaxyStarDate(galaxy);
    faction.stateMoney = Math.max(faction.stateMoney, PIRATE_START_MONEY);
    // The front's own: the Compact (the casino's owner) is never attacked by them.
    const compact = compactFaction(galaxy);
    if (compact !== null) changePirateRelation(faction, compact, PirateRelationType.Protection, now, 0);
    // The huge bases: the super-pirate base design at the best tech level, scaled by gwCasinoBasePowerPct.
    const power = Math.max(0.1, casinoParam(galaxy, 'gwCasinoBasePowerPct') / 100);
    const baseDesign = generateSuperPirateBaseDesign(galaxy, power, lvl, now);
    baseDesign.name = scenarioText(`${TAG} Casino Base Design`);
    faction.designs.push(baseDesign);
    rec.bases = [];
    for (let i = 0; i < HUGE_BASES; i++) rec.bases.push(placeHugeBase(galaxy, faction, baseDesign, home, i));
    // The fleet: warships of the best designs until the whole force (bases included) reaches gwCasinoStrengthPct of the strongest
    // navy, at least gwCasinoMinShips and at most gwCasinoMaxShips, two thirds of them on guard at the bases.
    const designs = fleetDesigns(galaxy, faction, lvl);
    let strongest = 1;
    for (const e of ordinaryEmpires(galaxy)) strongest = Math.max(strongest, militaryPotency(e));
    const target = (strongest * Math.max(0, casinoParam(galaxy, 'gwCasinoStrengthPct'))) / 100;
    const minShips = Math.max(0, Math.trunc(casinoParam(galaxy, 'gwCasinoMinShips')));
    const maxShips = Math.max(minShips, Math.trunc(casinoParam(galaxy, 'gwCasinoMaxShips')));
    let potency = militaryPotency(faction);
    const fleet: BuiltObject[] = [];
    let fleetStrength = 0;
    while (fleet.length < maxShips && (fleet.length < minShips || potency < target)) {
        const d = designs.get(FLEET_CYCLE[fleet.length % FLEET_CYCLE.length]) ?? designs.get(BuiltObjectSubRole.Cruiser) ?? null;
        if (d === null) break;
        d.buildCount++;
        const name = galaxy.selectRandomUniqueMilitaryShipName(null, faction, d.subRole);
        const ship = addPirateStartingShip(galaxy, faction, d, name, home, true);
        ship.supportCostFactor = 0;
        fleet.push(ship);
        fleetStrength += calculateOverallStrengthFactor(ship);
        potency += calculateOverallStrengthFactorWithoutShields(ship);
    }
    const guardCount = Math.round((fleet.length * Math.max(0, Math.min(100, casinoParam(galaxy, 'gwCasinoGuardPct')))) / 100);
    rec.guards = [];
    fleet.forEach((ship, i) => {
        if (i >= guardCount) return;
        rec.guards.push(ship);
        guardBase(galaxy, ship, rec.bases[i % rec.bases.length]);
    });
    rec.potency0 = militaryPotency(faction);
    rec.faction = faction;
    rec.home = home;
    rec.baseStrength = rec.bases.reduce((a, b) => a + calculateOverallStrengthFactor(b), 0);
    rec.fleetStrength = fleetStrength;
    syncFaction(galaxy);
    // Everyone knows where the bases are (the news says so): the stock hunters have targets.
    for (const e of ordinaryEmpires(galaxy)) {
        for (const b of rec.bases) if (!e.knownPirateBases.includes(b)) e.knownPirateBases.push(b);
        if (!e.knownPirateEmpires.includes(faction)) e.knownPirateEmpires.push(faction);
    }
    logGw(galaxy, now, `casino ${site.id}: smugglers ${faction.name} at ${home.name}, tech ${lvl}, ${rec.bases.length} bases (strength ${rec.baseStrength.toFixed(0)}), ${fleet.length} ships (strength ${fleetStrength.toFixed(0)}, potency ${rec.potency0} vs the strongest navy ${strongest})`);
    return true;
}

/** The front is out: the smugglers appear, the casino turns hostile, the benefits stop. Returns true when it surfaced. */
export function reveal(galaxy: Galaxy, site: GreatWorkRecord, rec: CasinoRec, by: Empire | null): boolean {
    if (rec.phase !== 'open' || !rec.front) return false;
    const now = galaxyStarDate(galaxy);
    if (!spawnSmugglers(galaxy, site, rec)) {
        rec.spawnFails++;
        rec.revealAt = now + 30 * GAME_DAY_LENGTH; // try again next month
        if (rec.spawnFails >= MAX_SPAWN_FAILS) {
            rec.front = false; // no room in the galaxy for another faction: the ring is quietly dissolved
            logGw(galaxy, now, `casino ${site.id}: front dissolved (no empire id for the smugglers)`);
        }
        return false;
    }
    rec.phase = 'revealed';
    rec.revealedAt = now;
    rec.exposedBy = by;
    rec.benefit = 0;
    rec.nextNetwork = now + 15 * GAME_DAY_LENGTH;
    markGreatWorkHostile(site, true);
    const name = kindName(site.wonder);
    if (site.base !== null && !site.base.hasBeenDestroyed) site.base.name = scenarioText(`${TAG} Casino Front Name`, name);
    const where = site.system.systemStar.name;
    scenarioNews(galaxy, null, scenarioText(`${TAG} Casino Front News`, name, where, rec.faction!.name, rec.bases.length), () => true, site.base ?? site.system.systemStar);
    const b = rec.beneficiary;
    if (b !== null && isHumanEmpire(galaxy, b)) {
        scenarioMessage(galaxy, b, scenarioText(`${TAG} Casino Front Title`), scenarioText(`${TAG} Casino Front Income`, name), { type: EmpireMessageType.GeneralBadEvent, subject: site.base ?? site.system.systemStar, popup: false });
    }
    if (by !== null && isHumanEmpire(galaxy, by)) {
        scenarioMessage(galaxy, by, scenarioText(`${TAG} Casino Front Title`), scenarioText(`${TAG} Casino Front Found`, name, where), { type: EmpireMessageType.GeneralWarning, subject: site.base ?? site.system.systemStar, popup: false });
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The smugglers at work
// ---------------------------------------------------------------------------------------------------------------

function hasNetwork(h: Habitat): boolean {
    return h.facilities !== null && facilitiesCountCompletedByType(h.facilities, PlanetaryFacilityType.PirateCriminalNetwork) > 0;
}

/** The colonies the smugglers may still corrupt: ordinary empires' colonies within gwCasinoNetSectors, nearest first (a colony defence that blocks pirate facilities protects). */
function networkCandidates(galaxy: Galaxy, rec: CasinoRec, faction: Empire): Habitat[] {
    const range = casinoParam(galaxy, 'gwCasinoNetSectors') * galaxy.sectorSize;
    const r2 = range * range;
    const out: { h: Habitat; d: number }[] = [];
    for (const e of ordinaryEmpires(galaxy)) {
        for (const h of e.colonies) {
            if (h === null || h.empire !== e || h.hasBeenDestroyed || h.population === null || h.population === undefined || h.population.totalAmount <= 0) continue;
            const d = galaxy.calculateDistanceSquared(h.xpos, h.ypos, rec.star.xpos, rec.star.ypos);
            if (d > r2 || rec.networks.includes(h) || hasNetwork(h) || h.pirateColonyControl.getByFacilityControl() !== null) continue;
            if (galaxy.scenario !== null && (scenarioQuery(galaxy, 'pirateFacilityBlocked', false, { habitat: h, pirate: faction }) || scenarioQuery(galaxy, 'pirateControlGainBlocked', false, { habitat: h }))) continue; // colony defence protects
            out.push({ h, d });
        }
    }
    out.sort((a, b) => a.d - b.d || a.h.habitatIndex - b.h.habitatIndex);
    return out.map((x) => x.h);
}

/** Plants a finished Criminal Network of `faction` on `h` (the stock facility and pirate control). */
function plantNetwork(galaxy: Galaxy, faction: Empire, h: Habitat): boolean {
    if (!queueFacilityConstruction(galaxy, h, PlanetaryFacilityType.PirateCriminalNetwork, true)) return false;
    let control = h.pirateColonyControl.getByFaction(faction);
    if (control === null) {
        control = new PirateColonyControl(faction.empireId, 1, true);
        h.pirateColonyControl.add(control);
    } else {
        control.controlLevel = Math.max(control.controlLevel, 1);
        control.hasFacilityControl = true;
    }
    if (!faction.colonies.includes(h)) faction.colonies.push(h);
    return true;
}

/** Removes the network the smugglers planted on `h` (and their control of it). */
function removeNetwork(h: Habitat, faction: Empire): void {
    const control = h.pirateColonyControl.getByFaction(faction);
    if (control === null || !control.hasFacilityControl) return;
    if (h.facilities !== null) {
        for (let i = h.facilities.length - 1; i >= 0; i--) {
            if (h.facilities[i].type === PlanetaryFacilityType.PirateCriminalNetwork) {
                checkRemoveFacilityTracking(h, h.facilities[i]);
                h.facilities.splice(i, 1);
            }
        }
    }
    h.pirateColonyControl.remove(control);
    const i = faction.colonies.indexOf(h);
    if (i >= 0 && h.empire !== faction) faction.colonies.splice(i, 1);
}

/** The networks that still stand (a host that invaded its own colony clears one). */
function pruneNetworks(rec: CasinoRec, faction: Empire): void {
    rec.networks = rec.networks.filter((h) => !h.hasBeenDestroyed && hasNetwork(h) && h.pirateColonyControl.getByFaction(faction)?.hasFacilityControl === true);
}

/** Monthly: one more network, on the nearest colony of the empire that carries the fewest of them. */
function spreadNetworks(galaxy: Galaxy, rec: CasinoRec, faction: Empire): void {
    const now = galaxyStarDate(galaxy);
    pruneNetworks(rec, faction);
    if (now < rec.nextNetwork) return;
    rec.nextNetwork = now + casinoParam(galaxy, 'gwCasinoNetDays') * GAME_DAY_LENGTH;
    if (rec.networks.length >= casinoParam(galaxy, 'gwCasinoNetMax')) return;
    const cands = networkCandidates(galaxy, rec, faction);
    if (cands.length === 0) return;
    const per = new Map<Empire, number>();
    for (const h of rec.networks) if (h.empire !== null) per.set(h.empire, (per.get(h.empire) ?? 0) + 1);
    let pick: Habitat = cands[0];
    let fewest = Number.MAX_VALUE;
    for (const h of cands) {
        const n = h.empire === null ? 0 : per.get(h.empire) ?? 0;
        if (n < fewest) {
            fewest = n;
            pick = h;
        }
    }
    if (!plantNetwork(galaxy, faction, pick)) return;
    rec.networks.push(pick);
    rec.plantedTotal++;
    const owner = pick.empire;
    if (owner !== null && isHumanEmpire(galaxy, owner)) {
        scenarioMessage(galaxy, owner, scenarioText(`${TAG} Casino Network Title`), scenarioText(`${TAG} Casino Network`, pick.name), { type: EmpireMessageType.GeneralWarning, subject: pick, popup: false });
    }
}

/** 10-day: idle raiders (AI-run warships that are not guards) go after the nearest private freighters near the base. */
function dispatchRaiders(galaxy: Galaxy, rec: CasinoRec, faction: Empire): void {
    const home = rec.home;
    const limit = Math.trunc(casinoParam(galaxy, 'gwCasinoRaiders'));
    if (home === null || limit <= 0) return;
    const range = casinoParam(galaxy, 'gwCasinoRaidSectors') * galaxy.sectorSize;
    const r2 = range * range;
    const prey: { bo: BuiltObject; d: number }[] = [];
    for (const e of ordinaryEmpires(galaxy)) {
        if (obtainPirateRelation(faction, e).type === PirateRelationType.Protection) continue; // paid up
        for (const bo of e.privateBuiltObjects) {
            if (bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Freight || bo.builtAt !== null) continue;
            const d = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, home.xpos, home.ypos);
            if (d <= r2) prey.push({ bo, d });
        }
    }
    if (prey.length === 0) return;
    prey.sort((a, b) => a.d - b.d || a.bo.builtObjectID - b.bo.builtObjectID);
    const hunted = new Set<BuiltObject>();
    const raiders: BuiltObject[] = [];
    for (const s of faction.builtObjects) {
        if (s.hasBeenDestroyed || s.role !== BuiltObjectRole.Military || !(s.topSpeed > 0) || rec.guards.includes(s) || !isAiControlled(s)) continue;
        const m = builtObjectMission(s.mission);
        if (m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject !== null && !m.targetBuiltObject.hasBeenDestroyed) {
            hunted.add(m.targetBuiltObject);
            continue;
        }
        raiders.push(s);
    }
    let free = limit - hunted.size;
    for (const s of raiders) {
        if (free <= 0) break;
        const target = prey.find((p) => !hunted.has(p.bo) && isObjectVisibleToThisEmpire(galaxy, faction, p.bo));
        if (target === undefined) break;
        assignMission(galaxy, s, BuiltObjectMissionType.Attack, target.bo, null, BuiltObjectMissionPriority.Normal);
        hunted.add(target.bo);
        rec.raidOrders++;
        free--;
    }
}

/**
 * While the smugglers hold the system the AI strikes their weakest standing base (the casino itself is spared, so the purge can
 * end in a renovation), against the other bases and every warship of theirs within two sectors of their home.
 */
function aiStrike(galaxy: Galaxy, site: GreatWorkSite): { target: BuiltObject; defenders: BuiltObject[]; marginPct?: number } | null {
    const rec = casinoRecOf(galaxy, site.id);
    const f = rec?.faction ?? null;
    if (rec === null || f === null || rec.phase !== 'revealed' || rec.home === null) return null;
    const standing = rec.bases.filter((b) => alive(b, f)).sort((a, b) => calculateOverallStrengthFactor(a) - calculateOverallStrengthFactor(b) || a.builtObjectID - b.builtObjectID);
    if (standing.length === 0) return null;
    const home = rec.home;
    const r2 = galaxy.sectorSize ** 2;
    const defenders: BuiltObject[] = standing.slice(1);
    for (const s of f.builtObjects) {
        if (s.hasBeenDestroyed || s.role !== BuiltObjectRole.Military || !(s.topSpeed > 0)) continue;
        if (galaxy.calculateDistanceSquared(s.xpos, s.ypos, home.xpos, home.ypos) <= r2) defenders.push(s);
    }
    return { target: standing[0], defenders, marginPct: casinoParam(galaxy, 'gwCasinoAiMarginPct') };
}

/** True when every one of the three bases is gone from the smugglers (destroyed, or no longer theirs). Pure. */
export function basesBroken(rec: CasinoRec): boolean {
    return rec.bases.length > 0 && rec.bases.every((b) => !alive(b, rec.faction));
}

/**
 * The smugglers cannot out-build the galaxy: warships above gwCasinoFleetCapPct of the founding force's military potency are scrapped,
 * the newest first (the guards are never touched). Their treasury is their own (the stock pirate economy), no top-up.
 */
function capFleet(galaxy: Galaxy, rec: CasinoRec, faction: Empire): void {
    const cap = (rec.potency0 * casinoParam(galaxy, 'gwCasinoFleetCapPct')) / 100;
    if (!(cap > 0)) return;
    let total = militaryPotency(faction);
    if (total <= cap) return;
    const ships: { bo: BuiltObject; s: number }[] = [];
    for (const b of faction.builtObjects) {
        if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || !(b.topSpeed > 0) || rec.guards.includes(b)) continue;
        ships.push({ bo: b, s: calculateOverallStrengthFactorWithoutShields(b) });
    }
    ships.sort((a, b) => b.bo.builtObjectID - a.bo.builtObjectID);
    for (const x of ships) {
        if (total <= cap) break;
        builtObjectCompleteTeardown(galaxy, x.bo);
        total -= x.s;
        rec.scrapped++;
    }
}

/** The 10-day upkeep of the live smugglers: the purge check, the networks, the raiders. */
function stepSmugglers(galaxy: Galaxy, rec: CasinoRec): void {
    const faction = rec.faction;
    if (faction === null) return;
    if (!smugglersLoose(galaxy, rec) || basesBroken(rec)) {
        purge(galaxy, rec);
        return;
    }
    capFleet(galaxy, rec, faction);
    spreadNetworks(galaxy, rec, faction);
    dispatchRaiders(galaxy, rec, faction);
}

/** The pirate-side periodic: runs whatever the casino's own phase is (the casino may be destroyed while the smugglers hold on). */
export function casinoPiratesPeriodic(galaxy: Galaxy): void {
    const st = peekCasinoState(galaxy);
    if (st === null) return;
    for (const rec of st.sites) if (rec.faction !== null) stepSmugglers(galaxy, rec);
}

// ---------------------------------------------------------------------------------------------------------------
// The purge and the renovation
// ---------------------------------------------------------------------------------------------------------------

/** The three bases are gone: the faction breaks, the casino is under renovation, then reopens clean. */
export function purge(galaxy: Galaxy, rec: CasinoRec): void {
    const faction = rec.faction;
    const now = galaxyStarDate(galaxy);
    if (faction !== null) {
        for (const h of rec.networks) removeNetwork(h, faction);
        if (faction.active && galaxy.pirateEmpires.includes(faction)) eliminatePirateFaction(galaxy, faction, null);
    }
    rec.networks = [];
    rec.guards = [];
    rec.faction = null;
    rec.purgedAt = now;
    rec.purgedBy = rec.killers.length > 0 ? rec.killers[rec.killers.length - 1] : null;
    syncFaction(galaxy);
    const site = recSite(galaxy, rec);
    if (site !== null) markGreatWorkHostile(site, false);
    const open = site !== null && site.phase === 'complete' && site.base !== null && !site.base.hasBeenDestroyed;
    rec.phase = open ? 'renovation' : 'closed';
    rec.renovationUntil = now + casinoParam(galaxy, 'gwCasinoRenovationDays') * GAME_DAY_LENGTH;
    rec.benefit = 0;
    if (site === null) return;
    const name = kindName(site.wonder);
    const where = site.system.systemStar.name;
    if (open) site.base!.name = scenarioText(`${TAG} Casino Renovation Name`, name);
    const by = rec.purgedBy;
    scenarioNews(galaxy, null, by === null ? scenarioText(`${TAG} Casino Purged News Unknown`, name, where) : scenarioText(`${TAG} Casino Purged News`, name, where, by.name), () => true, site.base ?? site.system.systemStar);
    logGw(galaxy, now, `casino ${site.id}: smugglers broken${by !== null ? ` by ${by.name}` : ''}; ${open ? 'renovation' : 'closed'}`);
}

/** The renovation is over: the casino reopens at gwCasinoCleanPct of the benefit. */
function reopen(galaxy: Galaxy, site: GreatWorkRecord, rec: CasinoRec): void {
    rec.phase = 'clean';
    rec.benefit = benefitFor(galaxy, rec);
    const name = kindName(site.wonder);
    if (site.base !== null && !site.base.hasBeenDestroyed) site.base.name = name;
    scenarioNews(galaxy, null, scenarioText(`${TAG} Casino Reopened News`, name, site.system.systemStar.name), () => true, site.base ?? site.system.systemStar);
    logGw(galaxy, galaxyStarDate(galaxy), `casino ${site.id}: reopens (${(rec.benefit * 100).toFixed(0)}%)`);
}

// ---------------------------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------------------------

/** A base of the smugglers fell: who did it (the news of the purge names the last). */
function onKilledBy(galaxy: Galaxy, bo: BuiltObject, destroyer: Empire | null): void {
    const st = peekCasinoState(galaxy);
    if (st === null || destroyer === null) return;
    for (const rec of st.sites) {
        if (rec.faction === null || !rec.bases.includes(bo)) continue;
        if (isActor(galaxy, destroyer)) rec.killers.push(destroyer);
    }
}

/** A successful DeepCover mission against the Compact (or an independent world) may find the front out early. */
function onIntelCompleted(galaxy: Galaxy, empire: Empire, mission: unknown): void {
    const m = mission as { type: number; targetEmpire?: Empire | null };
    if (m.type !== IntelligenceMissionType.DeepCover) return;
    const st = peekCasinoState(galaxy);
    if (st === null || st.sites.length === 0) return;
    const te = m.targetEmpire ?? null;
    if (te === null || (!isCompact(galaxy, te) && te !== galaxy.independentEmpire) || !isActor(galaxy, empire)) return;
    for (const rec of st.sites) {
        if (rec.phase !== 'open' || !rec.front) continue;
        const site = recSite(galaxy, rec);
        if (site === null || site.phase !== 'complete') continue;
        if (nextRandom(galaxy).nextDouble() * 100 < casinoParam(galaxy, 'gwCasinoDeepCoverPct')) reveal(galaxy, site, rec, empire);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registration (module load; imported from scenario/packages.ts)
// ---------------------------------------------------------------------------------------------------------------

registerGreatWork({
    id: CASINO_ID,
    flag: 'gwCasino',
    weight: 20,
    // The first tag is the most general (shared with the aquarium and the other lavish builds), the last the giveaway.
    hintTags: ['luxury', 'glass-ice', 'neon'],
    onComplete,
    periodic,
    onDestroyed,
    aiStrike,
});

// The smugglers are a crisis faction while they hold the system: attacking them counts as helping, those who protected the
// Great Work are its helpers (crisis.ts).
registerHostileWonderCrisis({ key: CASINO_KEY, flag: GW_FLAG, label: 'Smugglers' });

registerScenarioFramePeriodic({ id: 'giantworks.casino.pirates', flag: GW_FLAG, periodDays: PERIOD_DAYS, order: 21, run: (g) => casinoPiratesPeriodic(g) });
registerScenarioEvent({ id: 'giantworks.casino.killed', flag: GW_FLAG, event: 'builtObjectKilledBy', run: (g, e) => onKilledBy(g, e.builtObject, e.destroyer) });
registerScenarioEvent({ id: 'giantworks.casino.intel', flag: GW_FLAG, event: 'intelMissionCompleted', run: (g, e) => onIntelCompleted(g, e.empire, e.mission) });

registerScenarioQuery({
    id: 'giantworks.casino.approval',
    flag: GW_FLAG,
    query: 'empireApprovalRating',
    run: (g, v, a) => {
        const k = casinoLocalBenefit(g, a.habitat, casinoParam(g, 'gwCasinoHappinessSectors'));
        return k > 0 ? v + k * casinoParam(g, 'gwCasinoHappiness') : v;
    },
});
registerScenarioQuery({
    id: 'giantworks.casino.scenic',
    flag: GW_FLAG,
    query: 'colonyScenicFactor',
    run: (g, v, a) => {
        const k = casinoLocalBenefit(g, a.habitat, casinoParam(g, 'gwCasinoHappinessSectors'));
        return k > 0 ? Math.max(v, (k * casinoParam(g, 'gwCasinoScenicPct')) / 100) : v;
    },
});
registerScenarioQuery({
    id: 'giantworks.casino.immigration',
    flag: GW_FLAG,
    query: 'colonyMigrationFactor',
    run: (g, v, a) => {
        const k = casinoLocalBenefit(g, a.habitat, casinoParam(g, 'gwCasinoImmigrationSectors'));
        return k > 0 ? v + (k * casinoParam(g, 'gwCasinoImmigrationPct')) / 100 : v;
    },
});
// The smugglers take a pirate slot while they stay, so the stock respawn does not fill it with another faction.
registerScenarioQuery({
    id: 'giantworks.casino.slots',
    flag: GW_FLAG,
    query: 'pirateFactionCount',
    run: (g, v) => {
        const st = peekCasinoState(g);
        return st === null ? v : v + st.sites.filter((r) => smugglersLoose(g, r)).length;
    },
});

export const CASINO_HANDLER_IDS = ['giantworks.casino.pirates', 'giantworks.casino.killed', 'giantworks.casino.intel'] as const;
export const CASINO_QUERY_IDS = ['giantworks.casino.approval', 'giantworks.casino.scenic', 'giantworks.casino.immigration', 'giantworks.casino.slots'] as const;
