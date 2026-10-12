// Colony Economy add-on (scenarios/colony-economy; docs/ECONOMY.md): switches, params, the designation and facility
// tables and the per-game state. Not a port. Every handler is gated on the master flag `colonyEconomy` plus a sub flag;
// with the add-on off (or no scenario) nothing runs and nothing is stored.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { empireGovernmentAttributes } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { Design } from '../../design';
import type { CharacterSkillType } from '../../characters';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { YEAR_LENGTH } from '../../galaxyTime';
import { colonyGovernor } from '../governors';

export const ECON_FLAG = 'colonyEconomy';
export const ECON_DESIG_FLAG = 'econDesignations';
export const ECON_FAC_FLAG = 'econFacilities';
export const ECON_BOND_FLAG = 'econBonds';
export const ECON_REFINE_FLAG = 'econRefinement';
export const ECON_STATE_KEY = 'colonyEconomy';
export const ECON_SCENARIO_ID = 'colony-economy';

/** Manifest defaults (scenario.json). */
export const ECON_PARAMS = {
    econCooldownYears: 3,
    econStrengthPct: 100,
    econFacilityStrengthPct: 100,
    econFacilityCostPct: 100,
    econFacilityBuildPct: 100,
    econReserveK: 30,
    econSpendSharePct: 80,
    econMediumPopM: 800,
    econLargePopM: 3000,
    econBondRatePct: 8,
    econBondTermYears: 5,
    econBondCapPct: 100,
    econBondPrivateSharePct: 50,
} as const;
export type EconParamName = keyof typeof ECON_PARAMS;

export function econParam(galaxy: Galaxy, name: EconParamName): number {
    return scenarioParam(galaxy, name, ECON_PARAMS[name]);
}

/** Star-date ms per game day / year. */
export const DAY = YEAR_LENGTH / 360;
export const YEAR = YEAR_LENGTH;

/** The master switch and `sub` are on. */
export function econOn(galaxy: Galaxy, sub: string): boolean {
    return galaxy.scenario !== null && scenarioFlag(galaxy, ECON_FLAG) && scenarioFlag(galaxy, sub);
}

/** An empire the add-on runs for: an active normal empire with a race (not the independents, not a pirate faction). */
export function isEconEmpire(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e.dominantRace !== null;
}

/**
 * An empire with a private sector of its own: not one whose government nationalises it (GovernmentAttributes
 * SpecialFunctionCode 1: its "private" money is the state treasury, Empire.4.cs 1757 GetPrivateFunds), so private
 * facilities and bonds (borrowing from yourself) do not apply there. Designations still do.
 */
export function hasPrivateSector(galaxy: Galaxy, e: Empire | null): e is Empire {
    if (!isEconEmpire(galaxy, e)) return false;
    const gov = empireGovernmentAttributes(e);
    return gov === null || gov.specialFunctionCode !== 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Designations
// ---------------------------------------------------------------------------------------------------------------

export enum Designation {
    None = 0,
    Industrial = 1,
    TradeHub = 2,
    Resort = 3,
    MiningHub = 4,
    CoreWorld = 5,
    Frontier = 6,
}
export const DESIGNATIONS: readonly Designation[] = [Designation.Industrial, Designation.TradeHub, Designation.Resort, Designation.MiningHub, Designation.CoreWorld, Designation.Frontier];

export const DESIGNATION_NAMES: Readonly<Record<Designation, string>> = {
    [Designation.None]: 'None',
    [Designation.Industrial]: 'Industrial',
    [Designation.TradeHub]: 'Trade Hub',
    [Designation.Resort]: 'Resort World',
    [Designation.MiningHub]: 'Mining Hub',
    [Designation.CoreWorld]: 'Core World',
    [Designation.Frontier]: 'Frontier / Garrison',
};

/** One-line summary of a designation's bonuses and drawbacks (UI). Numbers at 100 % strength. */
export const DESIGNATION_SUMMARY: Readonly<Record<Designation, string>> = {
    [Designation.None]: 'No designation: the colony works as in the original game.',
    [Designation.Industrial]: '+25% construction speed (ships at its yards, facilities, wonders, colony-built bases); -4 approval.',
    [Designation.TradeHub]: '+10% colony income; pirate raids come 25% faster nearby.',
    [Designation.Resort]: '+0.5 scenic factor (tourism); +3 approval at own colonies within 1.5 sectors; -10% growth, -15% construction speed.',
    [Designation.MiningHub]: '+15% mining rate at own mining stations within 1.5 sectors; -3 approval, -10% tax revenue.',
    [Designation.CoreWorld]: '+15% growth, +10% population cap; -10% income while below 80% of its population cap.',
    [Designation.Frontier]: '+20% recruited troop strength, pirate control grows 40% slower; -10% income.',
};

// ---------------------------------------------------------------------------------------------------------------
// Facilities (phase 1: the first four of each designation)
// ---------------------------------------------------------------------------------------------------------------

export type FacilityId =
    | 'privateShipyard' | 'heavyFoundry' | 'componentWorks' | 'orbitalDrydock'
    | 'tradeExchange' | 'investmentBank' | 'freePort' | 'customsBureau'
    | 'resortComplex' | 'mediaNetwork' | 'pleasureGardens' | 'diplomaticRetreat'
    | 'miningConsortium' | 'orbitalWarehouse' | 'deepSurveyOffice' | 'oreRefinery'
    | 'medicalComplex' | 'university' | 'arcology' | 'culturalCenter'
    | 'privateSecurity' | 'militiaYard' | 'surveyOutpost' | 'colonistOffice'
    // Phase 2: the three extras of each designation.
    | 'roboticsPlant' | 'fleetDepot' | 'salvageYard'
    | 'commoditiesMarket' | 'merchantGuild' | 'blackMarket'
    | 'spaceportCasino' | 'naturePreserve' | 'pilgrimageShrine'
    | 'gasRefinery' | 'automatedExtractors' | 'stripMine'
    | 'adminCenter' | 'geneticsInstitute' | 'senateHall'
    | 'fortressBunker' | 'bountyOffice' | 'frontierCharter'
    // Phase 3: the refineries (refinement.ts).
    | 'smelter' | 'electronicsFab' | 'chemicalPlant' | 'fuelRefinery' | 'exoticsLab'
    // Phase 4: the third-step good (refinement.ts).
    | 'precisionWorks';

export interface EconFacilityDef {
    id: FacilityId;
    name: string;
    designation: Designation;
    /** Purchase price (credits, before econFacilityCostPct). */
    cost: number;
    /** Build time (game days, before econFacilityBuildPct). */
    buildDays: number;
    /** Private upkeep a year (share of the cost). */
    upkeepShare: number;
    /** A colony governor with this skill makes the facility stronger (×(1 + skill/50), at most ×2). */
    skill?: number;
    /** One line: what it does (numbers at 100 % strength). */
    effect: string;
}

const F = (id: FacilityId, name: string, designation: Designation, cost: number, buildDays: number, upkeepShare: number, effect: string, skill?: number, _exclusive?: FacilityId): EconFacilityDef => ({
    id, name, designation, cost, buildDays, upkeepShare, effect, ...(skill !== undefined ? { skill } : {}),
});
// CharacterSkillType values (characters.ts; CharacterSkillType.cs member order). Literal here: this table is built at
// module load, inside the scenario packages' import cycle through characters.ts. test/economyBreakdown.test.ts checks them.
export const SKILL = {
    Diplomacy: 1, ColonyIncome: 2, TradeIncome: 3, TourismIncome: 4, ColonyCorruption: 5, ColonyHappiness: 6, PopulationGrowth: 7, MiningRate: 8,
    TroopRecruitment: 9, MilitaryShipConstructionSpeed: 10, CivilianShipConstructionSpeed: 11, ColonyShipConstructionSpeed: 12, FacilityConstructionSpeed: 13,
    ResearchWeapons: 14, ResearchEnergy: 15, ResearchHighTech: 16, RepairBonus: 38,
} as const satisfies Partial<Record<keyof typeof CharacterSkillType, number>>;
const S = SKILL;
const D = Designation;

export const FACILITY_DEFS: readonly EconFacilityDef[] = [
    // Industrial
    F('privateShipyard', 'Private Shipyard', D.Industrial, 40000, 360, 0.1, '+20% ship construction speed at this colony\'s yards.', S.CivilianShipConstructionSpeed),
    F('heavyFoundry', 'Heavy Foundry', D.Industrial, 35000, 300, 0.1, '+30% construction speed of facilities, wonders and colony-built bases here; -3 approval.', S.FacilityConstructionSpeed),
    F('componentWorks', 'Component Works', D.Industrial, 50000, 360, 0.12, 'Ships and bases cost 2% less empire-wide per Component Works (at most 8%).', S.MilitaryShipConstructionSpeed),
    F('orbitalDrydock', 'Orbital Drydock', D.Industrial, 30000, 240, 0.1, 'Ships repair 50% faster in this system.', S.RepairBonus),
    // Trade Hub
    F('tradeExchange', 'Trade Exchange', D.TradeHub, 40000, 300, 0.1, '+8% colony income.', S.TradeIncome),
    F('investmentBank', 'Investment Bank', D.TradeHub, 45000, 360, 0.08, 'Bond interest -1.5 points per bank (at most -4); +3% colony income.', S.ColonyIncome),
    F('freePort', 'Free Port', D.TradeHub, 30000, 240, 0.1, '+12% colony income; pirate raids come 30% faster nearby.', S.TradeIncome),
    F('customsBureau', 'Customs Bureau', D.TradeHub, 30000, 240, 0.1, '+10% tax revenue here; -3% colony income.', S.ColonyCorruption),
    // Resort World
    F('resortComplex', 'Resort Complex', D.Resort, 40000, 300, 0.1, '+1.0 scenic factor (tourism income from passenger ships).', S.TourismIncome),
    F('mediaNetwork', 'Media Network', D.Resort, 35000, 300, 0.1, '+2 approval at own colonies within 2 sectors (+4 here).', S.ColonyHappiness),
    F('pleasureGardens', 'Pleasure Gardens', D.Resort, 30000, 240, 0.1, '+8 approval and +10% growth here (draws migrants).', S.ColonyHappiness),
    F('diplomaticRetreat', 'Diplomatic Retreat', D.Resort, 45000, 360, 0.1, 'Every empire you have met warms to you a little each year (+1 attitude, at most +10).', S.Diplomacy),
    // Mining Hub
    F('miningConsortium', 'Mining Consortium HQ', D.MiningHub, 45000, 360, 0.1, '+15% mining rate at own mining stations within 2 sectors.', S.MiningRate),
    F('orbitalWarehouse', 'Orbital Warehouse', D.MiningHub, 30000, 240, 0.08, '+3 development here; resource shortages cost 30% less approval at own colonies in the system.'),
    F('deepSurveyOffice', 'Deep Survey Office', D.MiningHub, 40000, 300, 0.1, 'Every 2 years the richest deposit in the system grows (+60 abundance, at most 1000).', S.MiningRate),
    F('oreRefinery', 'Ore Refinery', D.MiningHub, 40000, 300, 0.1, '+5% colony income and +5% mining rate in the system (refined goods come in a later phase).', S.MiningRate),
    // Core World
    F('medicalComplex', 'Medical Complex', D.CoreWorld, 40000, 300, 0.1, '+15% growth here; +1 approval.', S.PopulationGrowth),
    F('university', 'University', D.CoreWorld, 50000, 360, 0.1, '+3% research in all three fields (empire-wide, the stock resource-bonus channel).', S.ResearchHighTech),
    F('arcology', 'Arcology', D.CoreWorld, 60000, 420, 0.15, '+15% population cap here.', S.PopulationGrowth),
    F('culturalCenter', 'Cultural Center', D.CoreWorld, 45000, 360, 0.1, '+1 approval at every own colony per center (at most +3).', S.ColonyHappiness),
    // Frontier / Garrison
    F('privateSecurity', 'Private Security Firm', D.Frontier, 35000, 240, 0.1, '+25% recruited troop strength; pirate control grows 40% slower here.', S.TroopRecruitment),
    F('militiaYard', 'Militia Yard', D.Frontier, 30000, 240, 0.1, '+40% construction speed of facilities and colony-built bases here; pirate raids come 30% slower nearby; the private sector keeps 2 militia ships here (at most 6 an empire) that fight pirates within 1 sector.', S.MilitaryShipConstructionSpeed),
    F('surveyOutpost', 'Survey Outpost', D.Frontier, 30000, 240, 0.08, 'Every ship and base within 1 sector of the colony is visible to its owner (early warning).'),
    F('colonistOffice', 'Colonist Office', D.Frontier, 35000, 300, 0.1, 'New own colonies within 2 sectors grow 40% faster for their first 5 years.', S.ColonyShipConstructionSpeed),
    // --- Phase 2 ---
    F('roboticsPlant', 'Robotics Plant', D.Industrial, 45000, 300, 0.1, 'Troop upkeep 4% lower empire-wide per plant (at most 12%); +10% recruited troop strength here.', S.TroopRecruitment),
    F('fleetDepot', 'Fleet Depot', D.Industrial, 45000, 300, 0.1, 'Own state ships and bases within 2 sectors cost 15% less upkeep; ships within 2 sectors are refuelled every month (the state pays the fuel at its base price).', S.MilitaryShipConstructionSpeed),
    F('salvageYard', 'Salvage Yard', D.Industrial, 35000, 240, 0.1, 'Each year salvages up to 4 wrecks within 2 sectors (Wreckage add-on): a quarter of their resources to the colony, a tenth of their value to the private sector; +4% colony income otherwise.', S.RepairBonus),
    F('commoditiesMarket', 'Commodities Market', D.TradeHub, 40000, 300, 0.1, '+5% colony income; own colonies within 2 sectors lose 30% less approval to resource shortages.', S.TradeIncome),
    F('merchantGuild', 'Merchant Guild Hall', D.TradeHub, 45000, 360, 0.1, 'The private sector wants 10% more freighters per hall (at most 30%).', S.TradeIncome),
    F('blackMarket', 'Black Market', D.TradeHub, 30000, 240, 0.1, '+15% colony income (smuggling); pirate raids come 40% faster nearby, pirate control grows 30% faster here.', S.ColonyIncome),
    F('spaceportCasino', 'Spaceport Casino', D.Resort, 40000, 300, 0.1, '+15% colony income; +20% corruption here.', S.TourismIncome),
    F('naturePreserve', 'Nature Preserve', D.Resort, 35000, 300, 0.08, '+3 approval and +0.3 scenic factor here; planet damage heals 0.03 a year faster.', S.ColonyHappiness),
    F('pilgrimageShrine', 'Pilgrimage Shrine', D.Resort, 40000, 300, 0.1, '+3 approval at every own colony of the shrine world\'s race (one shrine per race counts).', S.ColonyHappiness),
    F('gasRefinery', 'Gas Refinery', D.MiningHub, 40000, 300, 0.1, '+20% gas mining at own gas stations within 2 sectors; +3% colony income.', S.MiningRate),
    F('automatedExtractors', 'Automated Extractors', D.MiningHub, 40000, 300, 0.08, 'Own mining stations within 2 sectors cost 30% less upkeep.', S.MiningRate),
    F('stripMine', 'Strip-Mine Charter', D.MiningHub, 30000, 240, 0.08, '+30% mining rate in the system; the planet loses 0.02 quality a year.', S.MiningRate),
    F('adminCenter', 'Administrative Center', D.CoreWorld, 50000, 360, 0.1, 'Corruption 50% lower here and 30% lower at own colonies within 2 sectors.', S.ColonyCorruption),
    F('geneticsInstitute', 'Genetics Institute', D.CoreWorld, 50000, 360, 0.1, '+10% growth here; new own colonies within 3 sectors grow 25% faster for 5 years.', S.PopulationGrowth),
    F('senateHall', 'Senate Hall', D.CoreWorld, 55000, 360, 0.15, '+1 approval at every own colony (at most +2); Interstellar Diet vote weight +20% per hall (at most +40%).', S.Diplomacy),
    F('fortressBunker', 'Fortress Bunker', D.Frontier, 40000, 300, 0.1, '+30 defensive fortress bonus here (ground defence).', S.TroopRecruitment),
    F('bountyOffice', 'Bounty Office', D.Frontier, 50000, 360, 0.1, 'The private sector keeps 3-6 bounty-hunter ships that hunt pirates within 2 sectors and earns a bounty per pirate ship destroyed; with Privateers on, 2 more privateers.', S.MilitaryShipConstructionSpeed),
    F('frontierCharter', 'Frontier Charter', D.Frontier, 30000, 240, 0.08, '+4 approval here and less drift toward autonomy (Frontier Autonomy); -10% tax revenue here.', S.ColonyHappiness),
    // --- Phase 3: the refineries (refinement.ts; only in a game started with the refinement chain on) ---
    F('smelter', 'Smelter', D.MiningHub, 45000, 300, 0.1, 'Refines Steel, Iridium, Lead and Carbon Fibre into Alloys (armour, engines, construction).', S.FacilityConstructionSpeed),
    F('electronicsFab', 'Electronics Fab', D.CoreWorld, 50000, 360, 0.1, 'Refines Silicon, Chromium, Aculon and Gold into Electronics (weapons, shields, sensors, computers).', S.ResearchHighTech),
    F('chemicalPlant', 'Chemical Plant', D.MiningHub, 40000, 300, 0.1, 'Refines Polymer, Helium, Argon and Krypton into Polymer Composites (habitation, storage, fighters).', S.FacilityConstructionSpeed),
    F('fuelRefinery', 'Fuel Refinery', D.MiningHub, 40000, 300, 0.1, 'Refines Caslon, Hydrogen and Tyderios into Reactor Fuel Cells (reactors, hyperdrives).', S.MiningRate),
    F('exoticsLab', 'Exotic Materials Lab', D.CoreWorld, 60000, 420, 0.12, 'Refines Emeros Crystal, Nekros Stone, Osalia and Dilithium Crystal into Exotics (super weapons; top tech-7 reactors, hyperdrives and weapons).', S.ResearchWeapons),
    // --- Phase 4: the third step ---
    F('precisionWorks', 'Precision Works', D.CoreWorld, 70000, 420, 0.12, 'Makes Precision Components from Electronics and Exotics (every tech-7+ component needs them).', S.ResearchHighTech),
];

/** Facilities that never stand at the same colony (the user's pairs). */
export const EXCLUSIVE_PAIRS: readonly (readonly [FacilityId, FacilityId])[] = [
    ['freePort', 'customsBureau'],
    ['blackMarket', 'customsBureau'],
    ['spaceportCasino', 'naturePreserve'],
    ['stripMine', 'deepSurveyOffice'],
];
/** The first of `ids` that may not stand beside `id` (null: none). */
export function exclusiveConflict(id: FacilityId, ids: readonly FacilityId[]): FacilityId | null {
    for (const [a, b] of EXCLUSIVE_PAIRS) {
        if (a === id && ids.includes(b)) return b;
        if (b === id && ids.includes(a)) return a;
    }
    return null;
}
/** Phase 1 facilities (the first four of each designation). */
export const PHASE1_FACILITIES: ReadonlySet<FacilityId> = new Set<FacilityId>(['privateShipyard', 'heavyFoundry', 'componentWorks', 'orbitalDrydock', 'tradeExchange', 'investmentBank', 'freePort', 'customsBureau', 'resortComplex', 'mediaNetwork', 'pleasureGardens', 'diplomaticRetreat', 'miningConsortium', 'orbitalWarehouse', 'deepSurveyOffice', 'oreRefinery', 'medicalComplex', 'university', 'arcology', 'culturalCenter', 'privateSecurity', 'militiaYard', 'surveyOutpost', 'colonistOffice']);

const DEF_BY_ID = new Map(FACILITY_DEFS.map((d) => [d.id, d]));
export function facilityDef(id: FacilityId): EconFacilityDef {
    const d = DEF_BY_ID.get(id);
    if (d === undefined) throw new Error(`colony economy: unknown facility ${id}`);
    return d;
}
export function isFacilityId(x: unknown): x is FacilityId {
    return typeof x === 'string' && DEF_BY_ID.has(x as FacilityId);
}
export function facilitiesOf(d: Designation): EconFacilityDef[] {
    return FACILITY_DEFS.filter((f) => f.designation === d);
}

// ---------------------------------------------------------------------------------------------------------------
// State (plain data keyed by stable ids; saved as-is)
// ---------------------------------------------------------------------------------------------------------------

export interface EconFacility {
    id: FacilityId;
    /** 0..1; 1 = built. */
    progress: number;
    /** Star date construction started / finished (0 until finished). */
    started: number;
    finished: number;
    /** Price paid (upkeep is upkeepShare of it). */
    cost: number;
    /** Requested by the player (UI only). */
    requested: boolean;
    /** Upkeep unpaid since this star date (0: paid up). A facility unpaid for a year closes. */
    unpaidSince: number;
    /** Deep Survey Office: star date of the last deposit find. */
    lastFind?: number;
}

export interface EconColony {
    designation: Designation;
    /** Star date the designation last changed (cooldown); -1 = never. */
    changedAt: number;
    facilities: EconFacility[];
    /** Player requests waiting for the private sector's money (facility ids, in order). */
    requests: FacilityId[];
    /** Star date the colony was founded by its current owner (Colonist Office's new-colony window), -1 unknown. */
    foundedAt: number;
    /** Phase 4: requests the treasury funds (commissioned refineries; a subset of `requests`). */
    commissioned?: FacilityId[];
    /** Phase 4: star date pirates last raided or controlled the colony (Bounty Office AI). */
    raidedAt?: number;
}

export interface Bond {
    id: number;
    principal: number;
    /** Principal still owed. */
    outstanding: number;
    /** Annual interest rate (fraction). */
    rate: number;
    issued: number;
    /** Star date the last instalment is due. */
    maturity: number;
    /** Instalments paid and missed (counts). */
    paid: number;
    missed: number;
    interestPaid: number;
}

export interface EconEmpire {
    bonds: Bond[];
    nextBondId: number;
    /** Arrears (unpaid instalments carried over). */
    arrears: number;
    /** Star date of the last bond issue / of a default (no new bonds for 5 years after one). */
    lastIssue: number;
    defaultedAt: number;
    /** Player setting: the state issues bonds by itself when the treasury runs low (AI empires: always). */
    autoBonds: boolean;
    /** Player setting: the private sector also builds facilities it chooses itself (requests always go first). */
    autoFacilities: boolean;
    /** Totals for the treasury view and the soaks. */
    borrowedTotal: number;
    repaidTotal: number;
    interestTotal: number;
    facilitySpend: number;
    facilityUpkeep: number;
    facilitiesBuilt: number;
    /** Diplomatic Retreat: attitude already given to each other empire (by empire id; capped). */
    retreatGiven?: Record<string, number>;
    /** Bounty Office (bounty.ts): the private sector's bounty hunters, their design and counters. */
    hunters?: BuiltObject[];
    hunterDesign?: Design | null;
    hunterDesignDate?: number;
    hunterSerial?: number;
    huntersBuilt?: number;
    bountiesPaid?: number;
    bountyKills?: number;
    /** Refinement (refinement.ts): goods made / used by key, completed builds and those short of goods. */
    goodsMade?: Record<string, number>;
    goodsUsed?: Record<string, number>;
    buildsTotal?: number;
    buildsShort?: number;
    /** Phase 4 (refinement.ts, every 30 days): per good (GOODS order), the highest tech level of the empire's researched
     *  components that need it (goodsNow) and of those its next research projects unlock (goodsNext). */
    goodsNow?: number[];
    goodsNext?: number[];
    /** Phase 4: no researched component needs any good yet (the early bonus), and a yard holds refined goods. */
    early?: boolean;
    earlySupplied?: boolean;
    /** Phase 4: builds waiting at a yard for goods (builtObjectID → star date the wait began), completed builds that
     *  waited, and the AI builds going on at the relief speed (refinement.ts). */
    waitStart?: Record<number, number>;
    buildsWaited?: number;
    reliefIds?: number[];
    reliefBuilds?: number;
    /** Bonds: what the AI's levy drew from the private surplus into a treasury in the red (bonds.ts maybeLevy). */
    levied?: number;
    /** Waits measured to their end (the goods arrived or the AI relief began; builtObjectID → days waited), and their
     *  totals: the time a build stood at factor 0, without the relief build that may follow (2026-10-11). */
    waitClosed?: Record<number, number>;
    waitClosedN?: number;
    waitClosedDays?: number;
    /** Phase 4: designs the AI swapped for a suppliable older one. */
    designFallbacks?: number;
    /** Phase 4: the facility tax paid to the state; the treasury's share of commissioned refineries. */
    facilityTax?: number;
    commissionSpend?: number;
    commissions?: number;
    /** Phase 4: goods the player was warned about (keys). */
    alerted?: string[];
    /** Phase 4: Militia Yard ships (bounty.ts), and Fleet Depot refuelling (effects.ts). */
    militia?: BuiltObject[];
    militiaSerial?: number;
    militiaBuilt?: number;
    depotFuel?: number;
}

/** The phase-3 refineries (built only in a game with the refined goods). */
export const REFINERY_FACILITIES: ReadonlySet<FacilityId> = new Set<FacilityId>(['smelter', 'electronicsFab', 'chemicalPlant', 'fuelRefinery', 'exoticsLab', 'precisionWorks']);

/**
 * Phase 4: a Mining Hub or Core World has one extra slot only a refinery may use. The slots the other facilities use:
 * every facility, less one refinery at such a colony. Pure.
 */
export function refinerySlotDesignation(d: Designation): boolean {
    return d === Designation.MiningHub || d === Designation.CoreWorld;
}
export function slotsUsed(d: Designation, ids: readonly FacilityId[]): { normal: number; refineries: number } {
    let ref = 0;
    for (const id of ids) if (REFINERY_FACILITIES.has(id)) ref++;
    const extra = refinerySlotDesignation(d) && ref > 0 ? 1 : 0;
    return { normal: ids.length - extra, refineries: ref };
}

export interface EconState {
    colonies: Record<string, EconColony>;
    empires: Record<string, EconEmpire>;
}

export function econState(galaxy: Galaxy): EconState {
    return scenarioState<EconState>(galaxy, ECON_STATE_KEY, () => ({ colonies: {}, empires: {} }));
}

/** The state if it exists (UI reads; never creates it). */
export function peekEconState(galaxy: Galaxy): EconState | null {
    const s = galaxy.scenario;
    if (s === null || !(ECON_STATE_KEY in s.state)) return null;
    return s.state[ECON_STATE_KEY] as EconState;
}

export function peekColony(galaxy: Galaxy, h: Habitat): EconColony | null {
    return peekEconState(galaxy)?.colonies[h.habitatIndex] ?? null;
}

export function colonyRecord(galaxy: Galaxy, h: Habitat): EconColony {
    const st = econState(galaxy);
    let c = st.colonies[h.habitatIndex];
    if (c === undefined) {
        c = { designation: Designation.None, changedAt: -1, facilities: [], requests: [], foundedAt: -1 };
        st.colonies[h.habitatIndex] = c;
    }
    return c;
}

export function peekEmpire(galaxy: Galaxy, e: Empire): EconEmpire | null {
    return peekEconState(galaxy)?.empires[e.empireId] ?? null;
}

export function empireRecord(galaxy: Galaxy, e: Empire): EconEmpire {
    const st = econState(galaxy);
    let r = st.empires[e.empireId];
    if (r === undefined) {
        r = { bonds: [], nextBondId: 1, arrears: 0, lastIssue: -1e18, defaultedAt: -1e18, autoBonds: false, autoFacilities: true, borrowedTotal: 0, repaidTotal: 0, interestTotal: 0, facilitySpend: 0, facilityUpkeep: 0, facilitiesBuilt: 0 };
        st.empires[e.empireId] = r;
    }
    return r;
}

/** The colony's designation (None without the add-on / record). Pure. */
export function designationOf(galaxy: Galaxy, h: Habitat): Designation {
    if (!econOn(galaxy, ECON_DESIG_FLAG)) return Designation.None;
    const c = peekColony(galaxy, h);
    return c === null || h.empire === null ? Designation.None : c.designation;
}

/** Built (finished, paid-up) facilities at `h` that match its designation. Pure. */
export function activeFacilities(galaxy: Galaxy, h: Habitat): EconFacility[] {
    if (!econOn(galaxy, ECON_FAC_FLAG)) return [];
    const c = peekColony(galaxy, h);
    if (c === null || h.empire === null || c.facilities.length === 0) return [];
    return c.facilities.filter((f) => f.progress >= 1 && f.unpaidSince === 0 && facilityDef(f.id).designation === c.designation);
}

export function hasActiveFacility(galaxy: Galaxy, h: Habitat, id: FacilityId): EconFacility | null {
    return activeFacilities(galaxy, h).find((f) => f.id === id) ?? null;
}

/** The governor bonus for `skill` at `h`: ×(1 + skill / 50), between 1 and 2. Pure. */
export function governorBoost(h: Habitat, skill: number | undefined): number {
    if (skill === undefined) return 1;
    const g = colonyGovernor(h);
    if (g === null) return 1;
    const s = g.getSkillLevel(skill);
    return 1 + Math.max(0, Math.min(1, s / 50));
}

// Revision of the add-on's state (effects.ts caches its source lists against it; not saved: a loaded game rebuilds).
const revs = new WeakMap<Galaxy, number>();
/** The add-on's state changed (designation, facility finished / closed / unpaid, owner): rebuild the source lists. */
export function bumpEcon(galaxy: Galaxy): void {
    revs.set(galaxy, (revs.get(galaxy) ?? 0) + 1);
}
export function econRevision(galaxy: Galaxy): number {
    return revs.get(galaxy) ?? 0;
}
