// Colony Economy: what designations and facilities do (docs/ECONOMY.md §2-3). Not a port: every effect goes through a
// stock mechanic by a scenario hook —
//   construction speed      colonyConstructionFactor (constructionQueue.ts baconReviewConstructionSpeed, both paths)
//   income / growth /       colonyResourceBonuses (taxes.ts RecalculateCriticalResourceSupplyBonuses): IncomeBoost,
//   development / troops /    PopulationGrowthRate, Development, RecruitedTroopStrength, Research* resource bonuses, read
//   research                  by the stock AnnualRevenue / growth / DevelopmentLevel / troop strength / research sums
//   tax revenue             colonyTaxRevenue (Habitat.cs 6083 RecalculateAnnualTaxRevenue)
//   tourism                 colonyScenicFactor (Habitat.cs 1116: tourism destinations are ranked by scenic × 1000)
//   approval                stability terms (stability.ts; the 19m ledger lists them)
//   mining                  extractionRateFactor (BuiltObject.2.cs 7930 IndustrialProcessing extraction rate)
//   population cap          colonyMaxPopulation (Habitat.cs 5172 GrowPopulation's cap)
//   pirates                 pirateControlGrowthFactor (BaconHabitat.cs 1388 ReviewPirateControl growth step),
//                           raidCountdownRate (pirate raid countdown recovery)
//   repairs                 repairRateFactor (BaconBuiltObject.cs 4763 DoRepairs interval)
//   ship / base prices      designPriceFactor (Design.cs 1143 CalculateCurrentPurchasePrice)
//   early warning           objectVisibleToAll (Empire.9.cs 3198 IsObjectVisibleToThisEmpire)
//   relations               applyReputation (bias term; reputation/ledger.ts, the stock EmpireEvaluation when off)
//   deposits                HabitatResource abundance (the stock extraction amount v × Abundance / 1000)
// Queries are pure and never draw. The source lists (which colonies boost what) are cached per galaxy and rebuilt
// whenever the add-on's state changes (bumpEcon); distances and governor skills are read live.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import { ColonyResourceEffect } from '../../developmentLevel';
import { DiplomaticRelationType } from '../../diplomacy';
import { calculateStrategicResourceSupplyGrowthFactor } from '../../taxes';
import { galaxyStarDate } from '../../tick/simTime';
import { registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { registerStabilityTerm } from '../stability';
import { applyReputation } from '../reputation/ledger';
import { wreckFields, wrecksAt, takeWrecks } from '../wreckage/common';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { Cargo, ResourceRef } from '../../cargo';
import { recalculateMaximumPopulation } from '../../types';
import { performPrivateTransaction } from '../../treasury';
import {
    DAY,
    YEAR,
    Designation,
    DESIGNATION_NAMES,
    ECON_DESIG_FLAG,
    ECON_FAC_FLAG,
    ECON_FLAG,
    activeFacilities,
    designationOf,
    econRevision,
    governorBoost,
    econOn,
    econParam,
    econState,
    empireRecord,
    facilityDef,
    isEconEmpire,
    peekEconState,
    type EconFacility,
    type FacilityId,
} from './common';

export const SECTOR = 2_000_000;

// ---------------------------------------------------------------------------------------------------------------
// Numbers (at 100 % strength)
// ---------------------------------------------------------------------------------------------------------------

export const ECON_EFFECTS = {
    industrialConstructionPct: 25,
    industrialApproval: -4,
    tradeIncomePct: 10,
    tradeRaidRate: 1.25,
    tradeRaidRange: 1.5 * SECTOR,
    resortScenic: 0.5,
    resortApprovalNear: 3,
    resortRange: 1.5 * SECTOR,
    resortGrowthPct: -10,
    resortConstructionPct: -15,
    miningRatePct: 15,
    miningRange: 1.5 * SECTOR,
    miningApproval: -3,
    miningTaxFactor: 0.9,
    coreGrowthPct: 15,
    coreMaxPopPct: 10,
    coreIncomePct: -10,
    coreFullShare: 0.8,
    frontierTroopPct: 20,
    frontierPirateFactor: 0.6,
    frontierIncomePct: -10,
    /** A designation's bonus grows this much per working facility at the colony. */
    perFacilityBoost: 0.1,
    // Facilities
    shipyardPct: 20,
    foundryPct: 30,
    foundryApproval: -3,
    componentWorksPct: 2,
    componentWorksMaxPct: 8,
    drydockRepair: 1.5,
    exchangeIncomePct: 8,
    bankIncomePct: 3,
    freePortIncomePct: 12,
    freePortRaidRate: 1.3,
    freePortRaidRange: 1.5 * SECTOR,
    customsTaxFactor: 1.1,
    customsIncomePct: -3,
    resortComplexScenic: 1.0,
    mediaApprovalHere: 4,
    mediaApprovalNear: 2,
    mediaRange: 2 * SECTOR,
    gardensApproval: 8,
    gardensGrowthPct: 10,
    retreatPerYear: 1,
    retreatCap: 10,
    consortiumPct: 15,
    consortiumRange: 2 * SECTOR,
    warehouseDevelopment: 3,
    warehouseShortageRelief: 0.3,
    surveyAbundance: 60,
    surveyYears: 2,
    refineryIncomePct: 5,
    refineryMiningPct: 5,
    medicalGrowthPct: 15,
    medicalApproval: 1,
    universityResearchPct: 3,
    arcologyMaxPopPct: 15,
    culturalApproval: 1,
    culturalMax: 3,
    securityTroopPct: 25,
    securityPirateFactor: 0.6,
    militiaConstructionPct: 40,
    militiaRaidRate: 0.7,
    militiaRaidRange: 1.5 * SECTOR,
    outpostRange: SECTOR,
    colonistGrowthPct: 40,
    colonistRange: 2 * SECTOR,
    colonistYears: 5,
    // Phase 2
    roboticsTroopMaintPct: 4,
    roboticsTroopMaintMaxPct: 12,
    roboticsTroopPct: 10,
    depotMaintPct: 15,
    depotRange: 2 * SECTOR,
    salvageRange: 2 * SECTOR,
    salvageWrecks: 4,
    salvageResourceShare: 0.25,
    salvageValueShare: 0.1,
    salvageFallbackIncomePct: 4,
    marketIncomePct: 5,
    marketShortageRange: 2 * SECTOR,
    guildFreighterPct: 10,
    guildFreighterMaxPct: 30,
    blackMarketIncomePct: 15,
    blackMarketRaidRate: 1.4,
    blackMarketRaidRange: 1.5 * SECTOR,
    blackMarketPirateFactor: 1.3,
    casinoIncomePct: 15,
    casinoCorruptionFactor: 1.2,
    preserveApproval: 3,
    preserveScenic: 0.3,
    preserveHealPerYear: 0.03,
    shrineApproval: 3,
    gasRefineryPct: 20,
    gasRefineryRange: 2 * SECTOR,
    gasRefineryIncomePct: 3,
    extractorsMaintPct: 30,
    extractorsRange: 2 * SECTOR,
    stripMinePct: 30,
    stripMineDamagePerYear: 0.02,
    adminCorruptionHere: 0.5,
    adminCorruptionNear: 0.7,
    adminRange: 2 * SECTOR,
    geneticsGrowthPct: 10,
    geneticsNewColonyPct: 25,
    geneticsRange: 3 * SECTOR,
    senateApproval: 1,
    senateApprovalMax: 2,
    senateVotePct: 20,
    senateVoteMaxPct: 40,
    fortressBonus: 30,
    charterApproval: 4,
    charterTaxFactor: 0.9,
    charterDrift: -1.5,
    // Synergies
    supplyChainFactor: 1.2,
    supplyChainRange: 2 * SECTOR,
    touristTradeFactor: 1.25,
    touristTradeRange: 3 * SECTOR,
    marketFactor: 1.25,
    marketRange: 3 * SECTOR,
};
const X = ECON_EFFECTS;

/** Marker resource id of the add-on's resource bonuses (no resource: the UI labels them "Colony Economy"). */
export const ECON_BONUS_RESOURCE_ID = -1;

const desigStrength = (g: Galaxy) => econParam(g, 'econStrengthPct') / 100;
const facStrength = (g: Galaxy) => econParam(g, 'econFacilityStrengthPct') / 100;

function near(a: Habitat | BuiltObject, b: { xpos: number; ypos: number }, r: number): boolean {
    const dx = a.xpos - b.xpos;
    const dy = a.ypos - b.ypos;
    return dx * dx + dy * dy <= r * r;
}

/** The designation's bonus scale at `h`: strength × (1 + perFacilityBoost per working facility). */
function bonusScale(galaxy: Galaxy, h: Habitat): number {
    return desigStrength(galaxy) * (1 + X.perFacilityBoost * activeFacilities(galaxy, h).length);
}

/** A working facility's strength at `h` (0: none): strength × the governor's matching skill. */
function fac(galaxy: Galaxy, h: Habitat, id: FacilityId): number {
    const f = activeFacilities(galaxy, h).find((x) => x.id === id);
    if (f === undefined) return 0;
    return facStrength(galaxy) * governorBoost(h, facilityDef(id).skill);
}

function hasDesignationNear(galaxy: Galaxy, e: Empire, h: Habitat, d: Designation, range: number): boolean {
    for (const c of e.colonies) if (c !== h && designationOf(galaxy, c) === d && near(c, h, range)) return true;
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Source cache (rebuilt on state changes)
// ---------------------------------------------------------------------------------------------------------------

interface Src {
    h: Habitat;
    pct: number;
    range: number;
    /** Facility (governor boost read live) or null (a designation). */
    id: FacilityId | null;
}

interface EmpireSources {
    mining: Src[];
    media: Src[];
    resort: Src[];
    colonist: Src[];
    outposts: Habitat[];
    drydockSystems: Set<number>;
    /** Orbital Warehouses by system index. */
    warehouses: Map<number, Habitat>;
    componentWorks: number;
    culturalCenters: number;
    // Phase 2
    depots: Src[];
    extractors: Src[];
    gas: Src[];
    strip: Src[];
    admin: Src[];
    genetics: Src[];
    markets: Src[];
    shrines: Map<string, Habitat>;
    robotics: number;
    guilds: number;
    senates: number;
}

interface Cache {
    rev: number;
    empires: Map<number, EmpireSources>;
    raid: Src[];
}

const caches = new WeakMap<Galaxy, Cache>();

function sources(galaxy: Galaxy): Cache {
    const rev = econRevision(galaxy);
    const c = caches.get(galaxy);
    if (c !== undefined && c.rev === rev) return c;
    const out: Cache = { rev, empires: new Map(), raid: [] };
    const st = peekEconState(galaxy);
    if (st !== null) {
        for (const e of galaxy.empires) {
            if (!isEconEmpire(galaxy, e)) continue;
            const s: EmpireSources = { mining: [], media: [], resort: [], colonist: [], outposts: [], drydockSystems: new Set(), warehouses: new Map(), componentWorks: 0, culturalCenters: 0, depots: [], extractors: [], gas: [], strip: [], admin: [], genetics: [], markets: [], shrines: new Map(), robotics: 0, guilds: 0, senates: 0 };
            for (const h of e.colonies) {
                const rec = st.colonies[h.habitatIndex];
                if (rec === undefined) continue;
                const d = designationOf(galaxy, h);
                if (d === Designation.MiningHub) s.mining.push({ h, pct: X.miningRatePct * desigStrength(galaxy), range: X.miningRange, id: null });
                if (d === Designation.Resort) s.resort.push({ h, pct: X.resortApprovalNear * desigStrength(galaxy), range: X.resortRange, id: null });
                if (d === Designation.TradeHub) out.raid.push({ h, pct: X.tradeRaidRate, range: X.tradeRaidRange, id: null });
                for (const f of activeFacilities(galaxy, h)) {
                    switch (f.id) {
                        case 'miningConsortium': s.mining.push({ h, pct: X.consortiumPct, range: X.consortiumRange, id: f.id }); break;
                        case 'oreRefinery': s.mining.push({ h, pct: X.refineryMiningPct, range: -1, id: f.id }); break;
                        case 'mediaNetwork': s.media.push({ h, pct: X.mediaApprovalNear, range: X.mediaRange, id: f.id }); break;
                        case 'colonistOffice': s.colonist.push({ h, pct: X.colonistGrowthPct, range: X.colonistRange, id: f.id }); break;
                        case 'surveyOutpost': s.outposts.push(h); break;
                        case 'orbitalDrydock': s.drydockSystems.add(h.systemIndex); break;
                        case 'componentWorks': s.componentWorks++; break;
                        case 'orbitalWarehouse': if (!s.warehouses.has(h.systemIndex)) s.warehouses.set(h.systemIndex, h); break;
                        case 'culturalCenter': s.culturalCenters++; break;
                        case 'freePort': out.raid.push({ h, pct: X.freePortRaidRate, range: X.freePortRaidRange, id: f.id }); break;
                        case 'militiaYard': out.raid.push({ h, pct: X.militiaRaidRate, range: X.militiaRaidRange, id: f.id }); break;
                        case 'blackMarket': out.raid.push({ h, pct: X.blackMarketRaidRate, range: X.blackMarketRaidRange, id: f.id }); break;
                        case 'fleetDepot': s.depots.push({ h, pct: X.depotMaintPct, range: X.depotRange, id: f.id }); break;
                        case 'automatedExtractors': s.extractors.push({ h, pct: X.extractorsMaintPct, range: X.extractorsRange, id: f.id }); break;
                        case 'gasRefinery': s.gas.push({ h, pct: X.gasRefineryPct, range: X.gasRefineryRange, id: f.id }); break;
                        case 'stripMine': s.strip.push({ h, pct: X.stripMinePct, range: -1, id: f.id }); break;
                        case 'adminCenter': s.admin.push({ h, pct: 1, range: X.adminRange, id: f.id }); break;
                        case 'geneticsInstitute': s.genetics.push({ h, pct: X.geneticsNewColonyPct, range: X.geneticsRange, id: f.id }); break;
                        case 'commoditiesMarket': s.markets.push({ h, pct: 1, range: X.marketShortageRange, id: f.id }); break;
                        case 'pilgrimageShrine': {
                            const race = h.population?.dominantRace?.name ?? null;
                            if (race !== null && !s.shrines.has(race)) s.shrines.set(race, h);
                            break;
                        }
                        case 'roboticsPlant': s.robotics++; break;
                        case 'merchantGuild': s.guilds++; break;
                        case 'senateHall': s.senates++; break;
                    }
                }
            }
            out.empires.set(e.empireId, s);
        }
    }
    caches.set(galaxy, out);
    return out;
}

function empireSources(galaxy: Galaxy, e: Empire | null): EmpireSources | null {
    if (e === null) return null;
    return sources(galaxy).empires.get(e.empireId) ?? null;
}

/** A source's strength now (a facility: strength × its governor's skill). */
function srcPct(galaxy: Galaxy, s: Src): number {
    if (s.id === null) return s.pct;
    return s.pct * facStrength(galaxy) * governorBoost(s.h, facilityDef(s.id).skill);
}

// ---------------------------------------------------------------------------------------------------------------
// Effects by channel (pure)
// ---------------------------------------------------------------------------------------------------------------

/** Construction speed factor at `h` (kind 'yard': ships built at its yards; 'colony': the bases its own queue builds; 'facility': its planetary facilities and wonders). */
export function constructionFactor(galaxy: Galaxy, h: Habitat, kind: 'yard' | 'colony' | 'facility'): number {
    const d = designationOf(galaxy, h);
    if (d === Designation.None) return 1;
    let pct = 0;
    if (d === Designation.Industrial) {
        let v = X.industrialConstructionPct * bonusScale(galaxy, h);
        if (h.empire !== null && hasDesignationNear(galaxy, h.empire, h, Designation.MiningHub, X.supplyChainRange)) v *= X.supplyChainFactor;
        pct += v;
        if (kind === 'yard') pct += X.shipyardPct * fac(galaxy, h, 'privateShipyard');
        else pct += X.foundryPct * fac(galaxy, h, 'heavyFoundry');
    } else if (d === Designation.Resort) pct += X.resortConstructionPct * desigStrength(galaxy);
    else if (d === Designation.Frontier && kind !== 'yard') pct += X.militiaConstructionPct * fac(galaxy, h, 'militiaYard');
    return Math.max(0.1, 1 + pct / 100);
}

export interface EconBonus {
    effect: ColonyResourceEffect;
    value: number;
    label: string;
}

/** The resource-channel bonuses at `h` (income / growth / development / troops / research). Pure. */
export function colonyBonuses(galaxy: Galaxy, h: Habitat): EconBonus[] {
    const out: EconBonus[] = [];
    const e = h.empire;
    if (e === null || !isEconEmpire(galaxy, e)) return out;
    const d = designationOf(galaxy, h);
    const name = DESIGNATION_NAMES[d];
    const add = (effect: ColonyResourceEffect, value: number, label: string) => {
        if (value !== 0) out.push({ effect, value, label });
    };
    const ds = desigStrength(galaxy);
    const sc = bonusScale(galaxy, h);
    const race = h.population?.dominantRace ?? null;
    const troops = race !== null ? race.troopStrength / 100 : 1;
    switch (d) {
        case Designation.TradeHub:
            add(ColonyResourceEffect.IncomeBoost, X.tradeIncomePct * sc, name);
            break;
        case Designation.Resort:
            add(ColonyResourceEffect.PopulationGrowthRate, X.resortGrowthPct * ds, name);
            break;
        case Designation.CoreWorld: {
            add(ColonyResourceEffect.PopulationGrowthRate, X.coreGrowthPct * sc, name);
            const pop = h.population?.totalAmount ?? 0;
            if (pop < X.coreFullShare * h.maxPopulation) add(ColonyResourceEffect.IncomeBoost, X.coreIncomePct * ds, `${name} (growing)`);
            break;
        }
        case Designation.Frontier:
            add(ColonyResourceEffect.RecruitedTroopStrength, X.frontierTroopPct * sc * troops, name);
            add(ColonyResourceEffect.IncomeBoost, X.frontierIncomePct * ds, name);
            break;
    }
    for (const f of activeFacilities(galaxy, h)) {
        const k = facStrength(galaxy) * governorBoost(h, facilityDef(f.id).skill);
        const label = facilityDef(f.id).name;
        switch (f.id) {
            case 'tradeExchange': {
                let v = X.exchangeIncomePct * k;
                if (hasDesignationNear(galaxy, e, h, Designation.Industrial, X.marketRange)) v *= X.marketFactor;
                add(ColonyResourceEffect.IncomeBoost, v, label);
                break;
            }
            case 'investmentBank': add(ColonyResourceEffect.IncomeBoost, X.bankIncomePct * k, label); break;
            case 'freePort': add(ColonyResourceEffect.IncomeBoost, X.freePortIncomePct * k, label); break;
            case 'customsBureau': add(ColonyResourceEffect.IncomeBoost, X.customsIncomePct * facStrength(galaxy), label); break;
            case 'pleasureGardens': add(ColonyResourceEffect.PopulationGrowthRate, X.gardensGrowthPct * k, label); break;
            case 'orbitalWarehouse': add(ColonyResourceEffect.Development, Math.round(X.warehouseDevelopment * k), label); break;
            case 'oreRefinery': add(ColonyResourceEffect.IncomeBoost, X.refineryIncomePct * k, label); break;
            case 'medicalComplex': add(ColonyResourceEffect.PopulationGrowthRate, X.medicalGrowthPct * k, label); break;
            case 'university':
                add(ColonyResourceEffect.ResearchWeapons, X.universityResearchPct * k, label);
                add(ColonyResourceEffect.ResearchEnergy, X.universityResearchPct * k, label);
                add(ColonyResourceEffect.ResearchHighTech, X.universityResearchPct * k, label);
                break;
            case 'privateSecurity': add(ColonyResourceEffect.RecruitedTroopStrength, X.securityTroopPct * k * troops, label); break;
            case 'roboticsPlant': add(ColonyResourceEffect.RecruitedTroopStrength, X.roboticsTroopPct * k * troops, label); break;
            case 'salvageYard': if (!wreckageActive(galaxy)) add(ColonyResourceEffect.IncomeBoost, X.salvageFallbackIncomePct * k, label); break;
            case 'commoditiesMarket': add(ColonyResourceEffect.IncomeBoost, X.marketIncomePct * k, label); break;
            case 'blackMarket': add(ColonyResourceEffect.IncomeBoost, X.blackMarketIncomePct * k, label); break;
            case 'spaceportCasino': add(ColonyResourceEffect.IncomeBoost, X.casinoIncomePct * k, label); break;
            case 'gasRefinery': add(ColonyResourceEffect.IncomeBoost, X.gasRefineryIncomePct * k, label); break;
            case 'geneticsInstitute': add(ColonyResourceEffect.PopulationGrowthRate, X.geneticsGrowthPct * k, label); break;
        }
    }
    // A Colonist Office nearby: new colonies grow faster for their first years.
    const s = empireSources(galaxy, e);
    if (s !== null && s.colonist.length > 0) {
        const rec = peekEconState(galaxy)?.colonies[h.habitatIndex];
        const founded = rec?.foundedAt ?? -1;
        if (founded >= 0 && galaxyStarDate(galaxy) - founded < X.colonistYears * YEAR) {
            let best = 0;
            for (const c of s.colonist) if (c.h !== h && c.h.empire === e && near(c.h, h, c.range)) best = Math.max(best, srcPct(galaxy, c));
            add(ColonyResourceEffect.PopulationGrowthRate, best, 'Colonist Office');
        }
    }
    // A Genetics Institute nearby: the same for new colonies, 3 sectors.
    if (s !== null && s.genetics.length > 0) {
        const rec = peekEconState(galaxy)?.colonies[h.habitatIndex];
        const founded = rec?.foundedAt ?? -1;
        if (founded >= 0 && galaxyStarDate(galaxy) - founded < X.colonistYears * YEAR) {
            let best = 0;
            for (const c of s.genetics) if (c.h !== h && c.h.empire === e && near(c.h, h, c.range)) best = Math.max(best, srcPct(galaxy, c));
            add(ColonyResourceEffect.PopulationGrowthRate, best, 'Genetics Institute');
        }
    }
    return out;
}

/** Tax revenue factor at `h`. */
export function taxFactor(galaxy: Galaxy, h: Habitat): number {
    let f = 1;
    if (designationOf(galaxy, h) === Designation.MiningHub) f *= 1 - (1 - X.miningTaxFactor) * desigStrength(galaxy);
    const k = fac(galaxy, h, 'customsBureau');
    if (k > 0) f *= 1 + (X.customsTaxFactor - 1) * k;
    if (fac(galaxy, h, 'frontierCharter') > 0) f *= 1 - (1 - X.charterTaxFactor) * facStrength(galaxy);
    return f;
}

/** Scenic factor added at `h` (tourism). */
export function scenicBonus(galaxy: Galaxy, h: Habitat): number {
    if (designationOf(galaxy, h) !== Designation.Resort) return 0;
    let v = X.resortScenic * desigStrength(galaxy);
    let r = X.resortComplexScenic * fac(galaxy, h, 'resortComplex');
    if (r > 0 && h.empire !== null && hasDesignationNear(galaxy, h.empire, h, Designation.TradeHub, X.touristTradeRange)) r *= X.touristTradeFactor;
    v += r;
    v += X.preserveScenic * fac(galaxy, h, 'naturePreserve');
    return v;
}

export interface ApprovalLine {
    label: string;
    value: number;
}

/** The add-on's approval terms at `h`, by cause. Pure. */
export function approvalLines(galaxy: Galaxy, h: Habitat): ApprovalLine[] {
    const out: ApprovalLine[] = [];
    const e = h.empire;
    if (e === null || !isEconEmpire(galaxy, e)) return out;
    const d = designationOf(galaxy, h);
    const ds = desigStrength(galaxy);
    if (d === Designation.Industrial) out.push({ label: 'Industrial designation', value: X.industrialApproval * ds });
    if (d === Designation.MiningHub) out.push({ label: 'Mining Hub designation', value: X.miningApproval * ds });
    for (const f of activeFacilities(galaxy, h)) {
        const k = facStrength(galaxy) * governorBoost(h, facilityDef(f.id).skill);
        switch (f.id) {
            case 'heavyFoundry': out.push({ label: 'Heavy Foundry', value: X.foundryApproval * facStrength(galaxy) }); break;
            case 'pleasureGardens': out.push({ label: 'Pleasure Gardens', value: X.gardensApproval * k }); break;
            case 'mediaNetwork': out.push({ label: 'Media Network', value: (X.mediaApprovalHere - X.mediaApprovalNear) * k }); break;
            case 'medicalComplex': out.push({ label: 'Medical Complex', value: X.medicalApproval * k }); break;
            case 'naturePreserve': out.push({ label: 'Nature Preserve', value: X.preserveApproval * k }); break;
            case 'frontierCharter': out.push({ label: 'Frontier Charter', value: X.charterApproval * k }); break;
        }
    }
    const s = empireSources(galaxy, e);
    if (s !== null) {
        let media = 0;
        for (const m of s.media) if (m.h.empire === e && near(m.h, h, m.range)) media = Math.max(media, srcPct(galaxy, m));
        if (media > 0) out.push({ label: 'Media Network nearby', value: media });
        let resort = 0;
        for (const r of s.resort) if (r.h !== h && r.h.empire === e && near(r.h, h, r.range)) resort = Math.max(resort, r.pct);
        if (resort > 0) out.push({ label: 'Resort World nearby', value: resort });
        if (s.culturalCenters > 0) out.push({ label: 'Cultural Centers', value: Math.min(X.culturalMax, X.culturalApproval * s.culturalCenters) * facStrength(galaxy) });
        if (s.senates > 0) out.push({ label: 'Senate Halls', value: Math.min(X.senateApprovalMax, X.senateApproval * s.senates) * facStrength(galaxy) });
        const race = h.population?.dominantRace?.name ?? null;
        const shrine = race !== null ? s.shrines.get(race) : undefined;
        if (shrine !== undefined && shrine.empire === e) out.push({ label: 'Pilgrimage Shrine', value: X.shrineApproval * fac(galaxy, shrine, 'pilgrimageShrine') });
        // Commodities Market within range: shortages hurt less (as the warehouse, by range).
        let mk = 0;
        for (const m of s.markets) if (m.h.empire === e && near(m.h, h, m.range)) mk = Math.max(mk, fac(galaxy, m.h, 'commoditiesMarket'));
        if (mk > 0) {
            const short = 15 * (1 - calculateStrategicResourceSupplyGrowthFactor(galaxy, h));
            if (short > 0) out.push({ label: 'Commodities Market', value: short * X.warehouseShortageRelief * mk });
        }
        // Orbital Warehouse in the system: shortages hurt less (part of the stock -15 × (1 - supply) term back).
        const wh = s.warehouses.get(h.systemIndex);
        if (wh !== undefined && wh.empire === e) {
            const k = fac(galaxy, wh, 'orbitalWarehouse');
            const short = k > 0 ? 15 * (1 - calculateStrategicResourceSupplyGrowthFactor(galaxy, h)) : 0;
            if (short > 0) out.push({ label: 'Orbital Warehouse', value: short * X.warehouseShortageRelief * k });
        }
    }
    return out.filter((l) => l.value !== 0);
}

/** Mining rate factor for a mining station / ship of `bo`'s empire. */
export function extractionFactor(galaxy: Galaxy, bo: BuiltObject): number {
    const s = empireSources(galaxy, bo.empire);
    if (s === null || (s.mining.length === 0 && s.gas.length === 0 && s.strip.length === 0)) return 1;
    let desig = 0;
    let consortium = 0;
    let refinery = 0;
    for (const m of s.mining) {
        if (m.h.empire !== bo.empire) continue;
        if (m.id === null) {
            if (near(m.h, bo, m.range)) desig = Math.max(desig, m.pct);
        } else if (m.id === 'miningConsortium') {
            if (near(m.h, bo, m.range)) consortium = Math.max(consortium, srcPct(galaxy, m));
        } else if (bo.parentHabitat !== null && bo.parentHabitat.systemIndex === m.h.systemIndex) refinery = Math.max(refinery, srcPct(galaxy, m));
    }
    let gas = 0;
    const isGas = bo.subRole === BuiltObjectSubRole.GasMiningStation || bo.subRole === BuiltObjectSubRole.GasMiningShip;
    if (isGas) for (const m of s.gas) if (m.h.empire === bo.empire && near(m.h, bo, m.range)) gas = Math.max(gas, srcPct(galaxy, m));
    let strip = 0;
    const sys = bo.parentHabitat?.systemIndex ?? -1;
    for (const m of s.strip) if (m.h.empire === bo.empire && m.h.systemIndex === sys) strip = Math.max(strip, srcPct(galaxy, m));
    return 1 + (desig + consortium + refinery + gas + strip) / 100;
}

/** Population cap factor at `h`. */
export function maxPopulationFactor(galaxy: Galaxy, h: Habitat): number {
    let pct = 0;
    if (designationOf(galaxy, h) === Designation.CoreWorld) pct += X.coreMaxPopPct * desigStrength(galaxy);
    pct += X.arcologyMaxPopPct * fac(galaxy, h, 'arcology');
    return 1 + pct / 100;
}

/** Pirate control growth factor at `h`. */
export function pirateGrowthFactor(galaxy: Galaxy, h: Habitat): number {
    let f = 1;
    if (designationOf(galaxy, h) === Designation.Frontier) f *= 1 - (1 - X.frontierPirateFactor) * desigStrength(galaxy);
    const k = fac(galaxy, h, 'privateSecurity');
    if (k > 0) f *= Math.max(0.1, 1 - (1 - X.securityPirateFactor) * k);
    if (fac(galaxy, h, 'blackMarket') > 0) f *= X.blackMarketPirateFactor;
    return f;
}

/** Raid countdown recovery factor at (x, y). */
export function raidFactor(galaxy: Galaxy, x: number, y: number): number {
    const list = sources(galaxy).raid;
    if (list.length === 0) return 1;
    let f = 1;
    const p = { xpos: x, ypos: y };
    let trade = false;
    let port = false;
    let militia = false;
    let black = false;
    for (const s of list) {
        if (s.h.empire === null || !near(s.h, p, s.range)) continue;
        if (s.id === null && !trade) {
            trade = true;
            f *= 1 + (s.pct - 1) * desigStrength(galaxy);
        } else if (s.id === 'freePort' && !port) {
            port = true;
            f *= s.pct;
        } else if (s.id === 'militiaYard' && !militia) {
            militia = true;
            f *= s.pct;
        } else if (s.id === 'blackMarket' && !black) {
            black = true;
            f *= s.pct;
        }
    }
    return f;
}

/** Self-repair speed factor of `bo` (an Orbital Drydock in its system). */
export function repairFactor(galaxy: Galaxy, bo: BuiltObject): number {
    const s = empireSources(galaxy, bo.empire);
    if (s === null || s.drydockSystems.size === 0) return 1;
    const h = bo.parentHabitat ?? bo.nearestSystemStar ?? null;
    if (h === null || !s.drydockSystems.has(h.systemIndex)) return 1;
    return X.drydockRepair;
}

/** Design price factor of `empire` (Component Works). */
export function priceFactor(galaxy: Galaxy, e: Empire | null): number {
    const s = empireSources(galaxy, e);
    if (s === null || s.componentWorks === 0) return 1;
    return 1 - Math.min(X.componentWorksMaxPct, X.componentWorksPct * s.componentWorks * facStrength(galaxy)) / 100;
}

/** Survey Outposts: `object` is within range of one of `empire`'s outposts. */
export function outpostSees(galaxy: Galaxy, empire: Empire, object: BuiltObject | Habitat): boolean {
    const s = empireSources(galaxy, empire);
    if (s === null || s.outposts.length === 0) return false;
    for (const h of s.outposts) if (h.empire === empire && near(h, object, X.outpostRange * Math.max(1, Math.min(1.5, governorBoost(h, undefined))))) return true;
    return false;
}

/** Troop upkeep factor of `e` (Robotics Plants). */
export function troopMaintFactor(galaxy: Galaxy, e: Empire): number {
    const s = empireSources(galaxy, e);
    if (s === null || s.robotics === 0) return 1;
    return 1 - Math.min(X.roboticsTroopMaintMaxPct, X.roboticsTroopMaintPct * s.robotics * facStrength(galaxy)) / 100;
}

/** Upkeep factor of `bo` (Fleet Depot for state ships / bases, Automated Extractors for mining stations). */
export function shipMaintFactor(galaxy: Galaxy, bo: BuiltObject): number {
    const s = empireSources(galaxy, bo.empire);
    if (s === null || (s.depots.length === 0 && s.extractors.length === 0)) return 1;
    let pct = 0;
    const station = bo.subRole === BuiltObjectSubRole.MiningStation || bo.subRole === BuiltObjectSubRole.GasMiningStation;
    if (station) for (const m of s.extractors) if (m.h.empire === bo.empire && near(m.h, bo, m.range)) pct = Math.max(pct, srcPct(galaxy, m));
    if (bo.owner !== null) for (const m of s.depots) if (m.h.empire === bo.empire && near(m.h, bo, m.range)) pct = Math.max(pct, srcPct(galaxy, m));
    return 1 - Math.min(90, pct) / 100;
}

/** Freighter target factor of `e` (Merchant Guild Halls). */
export function freighterFactor(galaxy: Galaxy, e: Empire): number {
    const s = empireSources(galaxy, e);
    if (s === null || s.guilds === 0) return 1;
    return 1 + Math.min(X.guildFreighterMaxPct, X.guildFreighterPct * s.guilds * facStrength(galaxy)) / 100;
}

/** Corruption factor at `h` (Administrative Center here / nearby, Spaceport Casino here). */
export function corruptionFactor(galaxy: Galaxy, h: Habitat): number {
    const e = h.empire;
    const s = empireSources(galaxy, e);
    let f = 1;
    if (fac(galaxy, h, 'spaceportCasino') > 0) f *= X.casinoCorruptionFactor;
    if (s !== null && s.admin.length > 0) {
        let best = 1;
        for (const a of s.admin) {
            if (a.h.empire !== e) continue;
            if (a.h === h) best = Math.min(best, 1 - (1 - X.adminCorruptionHere) * Math.min(1.5, srcPct(galaxy, a)));
            else if (near(a.h, h, a.range)) best = Math.min(best, 1 - (1 - X.adminCorruptionNear) * Math.min(1.5, srcPct(galaxy, a)));
        }
        f *= Math.max(0.1, best);
    }
    return f;
}

/** Fortress bonus added at `h` (Fortress Bunker). */
export function fortressBonus(galaxy: Galaxy, h: Habitat): number {
    return X.fortressBonus * fac(galaxy, h, 'fortressBunker');
}

/** Diet vote weight factor of `e` (Senate Halls). */
export function voteFactor(galaxy: Galaxy, e: Empire): number {
    const s = empireSources(galaxy, e);
    if (s === null || s.senates === 0) return 1;
    return 1 + Math.min(X.senateVoteMaxPct, X.senateVotePct * s.senates * facStrength(galaxy)) / 100;
}

/** Frontier Autonomy drift terms at `h` (Frontier Charter). */
export function driftTerms(galaxy: Galaxy, h: Habitat): { cause: string; amount: number }[] {
    const k = fac(galaxy, h, 'frontierCharter');
    return k > 0 ? [{ cause: 'Frontier Charter', amount: X.charterDrift * k }] : [];
}

function wreckageActive(galaxy: Galaxy): boolean {
    return wreckFields(galaxy).length > 0 || (galaxy.scenario?.flags['wreckage'] ?? false);
}

// ---------------------------------------------------------------------------------------------------------------
// AI facility values (facilities.ts picks the best affordable one)
// ---------------------------------------------------------------------------------------------------------------

/** How much `e`'s private sector wants `id` at `h` (0: not at all). Pure, no Rnd. */
export function facilityValue(galaxy: Galaxy, e: Empire, h: Habitat, id: FacilityId): number {
    const s = empireSources(galaxy, e);
    const pop = h.population?.totalAmount ?? 0;
    const yard = h.basesAtHabitat.some((b) => b !== null && !b.hasBeenDestroyed && b.isShipYard);
    const port = h.hasSpacePort || yard;
    const countOwn = (fid: FacilityId) => {
        let n = 0;
        for (const c of e.colonies) for (const f of activeFacilities(galaxy, c)) if (f.id === fid) n++;
        return n;
    };
    const revenueWeight = 1 + Math.min(2, Math.max(0, h.annualTaxRevenue) / 50000);
    let v = 1;
    switch (id) {
        case 'privateShipyard': v = yard ? 3 : 0.4; break;
        case 'heavyFoundry': v = 1.2; break;
        case 'componentWorks': v = (s?.componentWorks ?? 0) < 4 ? 2.2 : 0.2; break;
        case 'orbitalDrydock': v = port ? 1.8 : 0.5; break;
        case 'tradeExchange': v = 2.5; break;
        case 'investmentBank': v = countOwn('investmentBank') < 2 ? 2 : 0.6; break;
        case 'freePort': v = 1.6; break;
        case 'customsBureau': v = 1.5; break;
        case 'resortComplex': v = 2 + h.scenicFactor; break;
        case 'mediaNetwork': {
            let n = 0;
            for (const c of e.colonies) if (c !== h && near(c, h, X.mediaRange)) n++;
            v = 0.8 + Math.min(2, n / 3);
            break;
        }
        case 'pleasureGardens': v = 1.5; break;
        case 'diplomaticRetreat': v = countOwn('diplomaticRetreat') < 1 ? 1.4 : 0.3; break;
        case 'miningConsortium': {
            let n = 0;
            for (const m of e.miningStations) if (m !== null && !m.hasBeenDestroyed && near(h, m, X.consortiumRange)) n++;
            v = 0.5 + Math.min(3, n / 2);
            break;
        }
        case 'orbitalWarehouse': v = 1.2; break;
        case 'deepSurveyOffice': v = 1.3; break;
        case 'oreRefinery': v = 1.4; break;
        case 'medicalComplex': v = 1 + 2 * Math.max(0, 1 - pop / Math.max(1, h.maxPopulation)); break;
        case 'university': v = countOwn('university') < 3 ? 2 : 0.5; break;
        case 'arcology': v = pop > 0.8 * h.maxPopulation ? 2.5 : 0.5; break;
        case 'culturalCenter': v = (s?.culturalCenters ?? 0) < X.culturalMax ? 1.8 : 0.2; break;
        case 'privateSecurity': v = 1.6 + (h.pirateColonyControl.count > 0 ? 1.5 : 0); break;
        case 'militiaYard': v = 1.3; break;
        case 'surveyOutpost': v = 1.1; break;
        case 'colonistOffice': v = countOwn('colonistOffice') < 2 ? 1.5 : 0.3; break;
        case 'roboticsPlant': v = (s?.robotics ?? 0) < 3 ? 1.6 : 0.3; break;
        case 'fleetDepot': v = port ? 1.7 : 0.8; break;
        case 'salvageYard': v = wreckageActive(galaxy) ? (wrecksAt(galaxy, h.xpos, h.ypos, X.salvageRange).length > 0 ? 2.2 : 0.8) : 0.9; break;
        case 'commoditiesMarket': v = 1.5; break;
        case 'merchantGuild': v = (s?.guilds ?? 0) < 3 ? 1.6 : 0.2; break;
        case 'blackMarket': v = 1.2; break;
        case 'spaceportCasino': v = 1.8; break;
        case 'naturePreserve': v = 1 + Math.min(1, h.damage * 10) + h.scenicFactor / 2; break;
        case 'pilgrimageShrine': {
            const race = h.population?.dominantRace?.name ?? null;
            v = race !== null && !(s?.shrines.has(race) ?? false) ? 1.6 : 0.1;
            break;
        }
        case 'gasRefinery': v = 1.3; break;
        case 'automatedExtractors': {
            let n = 0;
            for (const m of e.miningStations) if (m !== null && !m.hasBeenDestroyed && near(h, m, X.extractorsRange)) n++;
            v = 0.4 + Math.min(2.5, n / 2);
            break;
        }
        case 'stripMine': v = 0.9; break;
        case 'adminCenter': v = (s?.admin.length ?? 0) < 3 ? 2 : 0.4; break;
        case 'geneticsInstitute': v = 1.4; break;
        case 'senateHall': v = (s?.senates ?? 0) < 2 ? 1.5 : 0.2; break;
        case 'fortressBunker': v = 1.2 + (h.pirateColonyControl.count > 0 ? 0.8 : 0); break;
        case 'bountyOffice': v = countOwn('bountyOffice') < 1 ? 2.2 : 0.2; break;
        case 'frontierCharter': v = 1.1; break;
    }
    return v * revenueWeight;
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly effects that change the game state (Diplomatic Retreat, Deep Survey Office)
// ---------------------------------------------------------------------------------------------------------------

function retreatYear(galaxy: Galaxy): void {
    const st = econState(galaxy);
    for (const e of galaxy.empires) {
        if (!isEconEmpire(galaxy, e)) continue;
        let k = 0;
        for (const h of e.colonies) k = Math.max(k, fac(galaxy, h, 'diplomaticRetreat'));
        if (k <= 0) continue;
        const r = empireRecord(galaxy, e);
        const given = (r.retreatGiven ??= {});
        for (const rel of e.diplomaticRelations) {
            const o = rel.otherEmpire;
            if (o === null || !isEconEmpire(galaxy, o) || rel.type === DiplomaticRelationType.NotMet || rel.type === DiplomaticRelationType.War) continue;
            const had = given[o.empireId] ?? 0;
            const add = Math.min(X.retreatCap - had, X.retreatPerYear * k);
            if (add <= 0) continue;
            given[o.empireId] = had + add;
            applyReputation(galaxy, o, e, add, { cause: 'diplomaticRetreat', labelKey: 'Diplomatic Retreat', source: 'colonyEconomy', term: 'bias', decayPerYear: 0 });
        }
    }
    void st;
}

function surveyTick(galaxy: Galaxy): void {
    const st = peekEconState(galaxy);
    if (st === null) return;
    const now = galaxyStarDate(galaxy);
    for (const e of galaxy.empires) {
        if (!isEconEmpire(galaxy, e)) continue;
        for (const h of e.colonies) {
            const f = activeFacilities(galaxy, h).find((x) => x.id === 'deepSurveyOffice');
            if (f === undefined) continue;
            const last = f.lastFind ?? f.finished;
            if (now - last < X.surveyYears * YEAR) continue;
            f.lastFind = now;
            const k = facStrength(galaxy) * governorBoost(h, facilityDef(f.id).skill);
            let best: { r: { resourceId: number; abundance: number }; key: number } | null = null;
            for (const o of galaxy.systemHabitatsOf(h.systemIndex)) {
                for (const r of o.resources) {
                    if (r.abundance >= 1000) continue;
                    const key = r.abundance * 100000 + o.habitatIndex;
                    if (best === null || key > best.key) best = { r, key };
                }
            }
            if (best !== null) best.r.abundance = Math.min(1000, Math.round(best.r.abundance + X.surveyAbundance * k));
        }
    }
}

/** Nature Preserve heals the planet, a Strip-Mine Charter damages it; Salvage Yards salvage nearby wrecks. Yearly. */
function planetYear(galaxy: Galaxy): void {
    for (const e of galaxy.empires) {
        if (!isEconEmpire(galaxy, e)) continue;
        for (const h of e.colonies) {
            const facs = activeFacilities(galaxy, h);
            if (facs.length === 0) continue;
            let dmg = 0;
            for (const f of facs) {
                if (f.id === 'naturePreserve') dmg -= X.preserveHealPerYear * fac(galaxy, h, 'naturePreserve');
                else if (f.id === 'stripMine') dmg += X.stripMineDamagePerYear;
                else if (f.id === 'salvageYard') salvage(galaxy, e, h);
            }
            if (dmg !== 0) {
                const before = h.damage;
                h.damage = Math.fround(Math.max(0, Math.min(0.9, h.damage + dmg)));
                if (h.damage !== before) recalculateMaximumPopulation(h);
            }
        }
    }
}

function salvage(galaxy: Galaxy, e: Empire, h: Habitat): void {
    const hits = wrecksAt(galaxy, h.xpos, h.ypos, X.salvageRange).slice(0, X.salvageWrecks);
    if (hits.length === 0) return;
    const taken = takeWrecks(galaxy, hits.map((x) => x.wreck));
    const k = fac(galaxy, h, 'salvageYard');
    if (h.cargo === null) return;
    let value = 0;
    for (const w of taken) {
        value += w.value;
        for (const r of w.resources) {
            const amount = Math.floor(r.amount * X.salvageResourceShare * k);
            if (amount > 0) h.cargo.add(new Cargo(new ResourceRef(r.resourceId), amount, e));
        }
    }
    if (value > 0) performPrivateTransaction(e, value * X.salvageValueShare * k);
}

// ---------------------------------------------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------------------------------------------

const on = (g: Galaxy) => econOn(g, ECON_DESIG_FLAG) || econOn(g, ECON_FAC_FLAG);

registerScenarioQuery({ id: 'colonyEconomy.construction', flag: ECON_FLAG, query: 'colonyConstructionFactor', run: (g, v, a) => (on(g) ? v * constructionFactor(g, a.habitat, a.kind) : v) });
registerScenarioQuery({
    id: 'colonyEconomy.bonuses',
    flag: ECON_FLAG,
    query: 'colonyResourceBonuses',
    run: (g, v, a) => {
        if (!on(g)) return v;
        const b = colonyBonuses(g, a.habitat);
        if (b.length === 0) return v;
        return [...v, ...b.map((x) => ({ resourceId: ECON_BONUS_RESOURCE_ID, effect: x.effect, value: x.value, appliesOnlyToSources: false }))];
    },
});
registerScenarioQuery({ id: 'colonyEconomy.tax', flag: ECON_FLAG, order: 40, query: 'colonyTaxRevenue', run: (g, v, a) => (on(g) && v > 0 ? v * taxFactor(g, a.habitat) : v) });
registerScenarioQuery({ id: 'colonyEconomy.scenic', flag: ECON_FLAG, query: 'colonyScenicFactor', run: (g, v, a) => (on(g) ? v + scenicBonus(g, a.habitat) : v) });
registerScenarioQuery({ id: 'colonyEconomy.mining', flag: ECON_FLAG, query: 'extractionRateFactor', run: (g, v, a) => (on(g) ? v * extractionFactor(g, a.builtObject) : v) });
registerScenarioQuery({ id: 'colonyEconomy.maxPop', flag: ECON_FLAG, query: 'colonyMaxPopulation', run: (g, v, a) => (on(g) ? Math.trunc(v * maxPopulationFactor(g, a.habitat)) : v) });
registerScenarioQuery({ id: 'colonyEconomy.pirates', flag: ECON_FLAG, query: 'pirateControlGrowthFactor', run: (g, v, a) => (on(g) ? v * pirateGrowthFactor(g, a.habitat) : v) });
registerScenarioQuery({ id: 'colonyEconomy.raids', flag: ECON_FLAG, query: 'raidCountdownRate', run: (g, v, a) => (on(g) ? v * raidFactor(g, a.x, a.y) : v) });
registerScenarioQuery({ id: 'colonyEconomy.repair', flag: ECON_FLAG, query: 'repairRateFactor', run: (g, v, a) => (econOn(g, ECON_FAC_FLAG) ? v * repairFactor(g, a.builtObject) : v) });
registerScenarioQuery({ id: 'colonyEconomy.price', flag: ECON_FLAG, query: 'designPriceFactor', run: (g, v, a) => (econOn(g, ECON_FAC_FLAG) ? v * priceFactor(g, a.empire) : v) });
registerScenarioQuery({ id: 'colonyEconomy.outpost', flag: ECON_FLAG, query: 'objectVisibleToAll', run: (g, v, a) => v || (econOn(g, ECON_FAC_FLAG) && outpostSees(g, a.empire, a.object)) });
registerStabilityTerm({
    id: 'colonyEconomy.approval',
    flag: ECON_FLAG,
    cause: 'colonyEconomy',
    label: 'Colony Economy',
    run: (g, h, e) => {
        if (e === null || !on(g)) return null;
        const lines = approvalLines(g, h);
        if (lines.length === 0) return null;
        let s = 0;
        for (const l of lines) s += l.value;
        return s;
    },
});
registerScenarioYearly({ id: 'colonyEconomy.retreat', flag: ECON_FLAG, run: (g) => econOn(g, ECON_FAC_FLAG) && retreatYear(g) });
registerScenarioQuery({ id: 'colonyEconomy.troopMaint', flag: ECON_FLAG, query: 'troopMaintenanceFactor', run: (g, v, a) => (econOn(g, ECON_FAC_FLAG) ? v * troopMaintFactor(g, a.empire) : v) });
registerScenarioQuery({ id: 'colonyEconomy.shipMaint', flag: ECON_FLAG, query: 'shipMaintenanceFactor', run: (g, v, a) => (econOn(g, ECON_FAC_FLAG) ? v * shipMaintFactor(g, a.builtObject) : v) });
registerScenarioQuery({ id: 'colonyEconomy.freighters', flag: ECON_FLAG, query: 'privateFreighterFactor', run: (g, v, a) => (econOn(g, ECON_FAC_FLAG) ? v * freighterFactor(g, a.empire) : v) });
registerScenarioQuery({ id: 'colonyEconomy.corruption', flag: ECON_FLAG, query: 'colonyCorruptionFactor', run: (g, v, a) => (econOn(g, ECON_FAC_FLAG) ? v * corruptionFactor(g, a.habitat) : v) });
registerScenarioQuery({ id: 'colonyEconomy.fortress', flag: ECON_FLAG, query: 'colonyFortressBonus', run: (g, v, a) => (econOn(g, ECON_FAC_FLAG) ? v + fortressBonus(g, a.habitat) : v) });
registerScenarioQuery({ id: 'colonyEconomy.dietVote', flag: ECON_FLAG, query: 'dietVoteWeightFactor', run: (g, v, a) => (econOn(g, ECON_FAC_FLAG) ? v * voteFactor(g, a.empire) : v) });
registerScenarioQuery({ id: 'colonyEconomy.drift', flag: ECON_FLAG, query: 'frontierDriftTerms', run: (g, v, a) => (econOn(g, ECON_FAC_FLAG) ? [...v, ...driftTerms(g, a.habitat)] : v) });
registerScenarioYearly({ id: 'colonyEconomy.planets', flag: ECON_FLAG, run: (g) => econOn(g, ECON_FAC_FLAG) && planetYear(g) });
registerScenarioPeriodic({ id: 'colonyEconomy.survey', flag: ECON_FLAG, periodDays: 90, run: (g) => econOn(g, ECON_FAC_FLAG) && surveyTick(g) });

export type { EconFacility };
export { DAY };
