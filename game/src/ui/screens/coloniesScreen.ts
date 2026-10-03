// Colonies screen: a port of the original pnlColonyInfo (the "Colonies" ScreenPanel) on the shared original-style
// window (originalWindow.ts).
//
// Sources: Main.Part11.cs method_166 (open + the 1015 × 760 layout of every control), UnlxwvByxj_SelectionChanged
// (binds the detail controls to the selected colony), btnColonyGotoHabitat_Click / txtColonyName_Leave /
// numColonyTaxRate_Leave; Main.Part4.cs btnColonySelect_Click (method_208), btnColonyShowExpansionPlanner_Click
// (method_160("colonies")), btnColonyShowRuin_Click, lnkColonyGrowth / lnkColonyApproval / lnkColonyConstruction
// (method_456 Galactopedia topics); Main.Part5.cs btnColonyMakeCapital_Click; Main.Part6.cs btnColonyTroopsRecruit /
// Disband / Garrison / Ungarrison, btnColonyFacilityBuild_Click. Controls: HabitatListView.cs (the colony grid),
// PopulationListView.cs, HabitatAttitudeSummary.cs, CargoListView.cs, HabitatResourceListView.cs,
// CharacterTroopListIconView.cs, ConstructionYardListView.cs, DockingBayListView.cs, PlanetaryFacilityListIconView.cs,
// PlanetaryFacilityDefinitionDropDown.cs, ColonyPopulationPolicyDropDown.cs, GalaxyMap.cs (gmapColony) and
// InfoPanel.cs (pnlColonyHabitatInfo, ShowExtendedInfo).
//
// Orders go through the command log (issuePlayerCommand): tax changes as ColonyTaxUp/Down actions (the only colony
// tax command the sim has), recruiting and facility building as the selection panel's ShipActions, disband /
// garrison as the Troops screen's ops, wait-queue moves as the Construction Yards screen's op.
// Kept from the earlier streamlined list (mod layer): the 19d2 shortage marker and the scenario approval breakdown
// on the approval icon, the 19d1 governor-loyalty tooltip on the name.
//
// TODO(port): Construction Yard tab's purchaser panel (pnlColonyConstructionYardPurchaser), Scrap Ship / Remove Ship — Main.Part6.cs:3460-3560
// TODO(port): Show Ruin Details window (method_550 pnlRuinDetail) — shown as a message box with the ruin's description here
// TODO(port): character portraits in the Troops & Characters tab (CharacterImageCache) — CharacterTroopListIconView.cs
// TODO(port): racial / wonder / resource bonus lines of the attitude summary — HabitatAttitudeSummary.cs DetermineHabitat*Bonuses
// TODO(port): AutoPauseWhenInPopupWindow pause / resume — Main.Part11.cs method_166 / method_186

import './coloniesScreen.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import { HabitatCategoryType, type Habitat } from '../../sim/types';
import type { BuiltObject } from '../../sim/builtObject';
import type { Troop } from '../../sim/cargo';
import type { Race } from '../../sim/data/races';
import type { Facility } from '../../sim/data/facilities';
import { ColonyPopulationPolicy } from '../../sim/data/policies';
import { CharacterRole, findCharactersAtLocationNotTransferring, type Character } from '../../sim/characters';
import { habitatDevelopmentLevel } from '../../sim/developmentLevel';
import {
    calculatePopulationPolicyConcern,
    calculateExterminationConcern,
    calculateRacialReputationConcern,
    calculateStrategicResourceSupplyGrowthFactor,
    empireApprovalRating,
    empireCivilityRatingApprovalRaw,
    empireWarWeariness,
    habitatRacialHappiness,
    habitatTaxApproval,
    modifyApprovalValueByEmpireAttributes,
    raidEconomyDamageFactor,
} from '../../sim/taxes';
import { getPlagueUnhappinessFactorWithPlague } from '../../sim/eventTypes';
import { empireGovernmentAttributes } from '../../sim/empire';
import { strategicValue } from '../../sim/territory';
import { habitatAnnualRevenue } from '../../sim/forceStructure';
import { calculatePlanetaryFacilityCost, type PlanetaryFacility } from '../../sim/construction/facilities';
import { resolveBuildableFacilities, resolveBuildableFacilitiesPirates, resolveBuildableWonders } from '../../sim/player/executeShipAction';
import { ShipActionType, createShipAction } from '../../sim/player/shipAction';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { checkFacilityOwnedByColonyOwner, colonyPopulationPolicyLocked, colonyTroopTransports } from '../../sim/player/colonyOrders';
import { checkCanInitiateAttackAgainstPirateFacilities } from '../../sim/pirates/pirateEmpireAI';
import { formatNet, tryGetText } from '../../sim/textResolver';
import { componentDefinitionsStatic } from '../../sim/designGeneration';
import { troopImageUrl, wireTroopImageFallback } from '../../render/troopImages';
import { raceHasConcordArt } from '../../render/concordArt';
import { facilityImageUrl, habitatImageUrl, habitatInfo, type InfoTarget } from '../selectionInfo';
import { empireFlagUrl, renderInfoModel } from '../selectionInfoView';
import { racePortraitUrl } from '../empireEmblem';
import { resourceIconUrl, formatMoney } from '../hud';
import { governorLoyaltyText } from '../emergentPolitics'; // [emergent]
import { approvalMood, colonyScenarioInfo, formatThousandsK, type ApprovalMood } from './coloniesList';
import { habitatTypeDescription } from './expansionPlanner';
import { drawSystemsMiniMap } from './galaxyMap';
import { recruitOptions, troopTypeDescription } from './troops';
import { siteQueue, waitRows, yardRows, type ConstructionSite } from './constructionYards';
import {
    COLORS,
    FONT,
    OwGrid,
    chromeImageUrl,
    dropDown,
    dropText,
    el,
    glassButton,
    gradientPanel,
    linkLabel,
    messageBox,
    openOriginalWindow,
    place,
    scrollPanel,
    setText,
    tabStrip,
    text,
    textBox,
    type GridColumn,
    type OriginalWindow,
} from '../originalWindow';

/** GameText lookup with the English text as fallback (tests run without GameText loaded). */
function T(key: string, english: string): string {
    return tryGetText(key) ?? english;
}

// -------------------------------------------------------------------------------------------------------------------
// Layout (Main.Part11.cs method_166, body-relative original pixels)
// -------------------------------------------------------------------------------------------------------------------

/** pnlColonyInfo.Size = new Size(1015, 760). */
export const COLONIES_WINDOW = { w: 1015, h: 760 } as const;

export const COLONIES_LAYOUT = {
    count: { x: 10, y: 8 },
    growthLink: { x: 430, y: 8, w: 250, h: 21 },
    expansionPlanner: { x: 740, y: 6, w: 200, h: 21 },
    grid: { x: 10, y: 30, w: 670, h: 315 },
    mapTitle: { x: 690, y: 27 },
    map: { x: 690, y: 45, w: 300, h: 300 },
    buttons: [
        { id: 'select', x: 10, w: 120 },
        { id: 'goto', x: 135, w: 120 },
        { id: 'galaxyMap', x: 260, w: 150 },
        { id: 'capital', x: 415, w: 130 },
        { id: 'ruin', x: 550, w: 130 },
    ],
    buttonsY: 348,
    buttonsH: 39,
    nameLabel: { x: 690, y: 362 },
    nameBox: { x: 740, y: 360, w: 155, h: 20 },
    taxLabel: { x: 903, y: 362 },
    taxBox: { x: 936, y: 362, w: 40, h: 23 },
    taxPercent: { x: 975, y: 362 },
    tabs: { x: 10, y: 390, w: 670, h: 300 },
    info: { x: 690, y: 390, w: 300, h: 300 },
} as const;

/** The tab control's page area (TabPage at (4, 22) in the 670 × 300 EnhancedTabControl). */
export const TAB_PAGE = { x: 4, y: 26, w: 662, h: 271 } as const;

// -------------------------------------------------------------------------------------------------------------------
// Pure helpers (tested)
// -------------------------------------------------------------------------------------------------------------------

/** HabitatListView.BindData Cells[4]: the system name — a star / gas cloud is its own system, a planet / asteroid
 *  names its parent, a moon its grandparent. */
export function colonySystemName(h: Pick<Habitat, 'category' | 'name' | 'parent'>): string {
    switch (h.category) {
        case HabitatCategoryType.Star:
        case HabitatCategoryType.GasCloud:
            return h.name;
        case HabitatCategoryType.Planet:
        case HabitatCategoryType.Asteroid:
            return h.parent?.name ?? '';
        case HabitatCategoryType.Moon:
            return h.parent?.parent?.name ?? '';
    }
    return '';
}

/** HabitatListView.BindData Cells[5]: the facilities as "Name, Name (40%)" (under construction: the progress "0%"). */
export function colonyFacilitiesText(facilities: readonly { name: string; constructionProgress: number }[] | null): string {
    if (facilities === null || facilities.length === 0) return '';
    return facilities
        .filter((f) => f != null)
        .map((f) => (f.constructionProgress < 1 ? `${f.name} (${formatPercent0(f.constructionProgress)})` : f.name))
        .join(', ');
}

/** .NET "0%": ×100, rounded half away from zero. */
export function formatPercent0(v: number): string {
    return `${roundAway(v * 100)}%`;
}

function roundAway(v: number): number {
    return v < 0 ? -Math.round(-v) : Math.round(v);
}

/** HabitatListView TaxRate column, format "#0%;-#0%;0%". */
export function formatTaxPercent(rate: number): string {
    const v = roundAway(rate * 100);
    return v === 0 ? '0%' : `${v}%`;
}

/** HabitatListView TotalPopulation column, format "0,,M": millions, rounded, "M" suffix. */
export function formatPopulationM(amount: number): string {
    return `${roundAway(amount / 1_000_000)}M`;
}

/** HabitatListView StrategicValue column: max(1, StrategicValue / 1000) in "####K" (no digit for 0). */
export function formatStrategicValueK(value: number): string {
    const v = roundAway(Math.max(1, value / 1000));
    return v === 0 ? 'K' : `${v}K`;
}

/** PopulationListView GrowthRate column, format "+#0.0%;-#0.0%;0.0%". */
export function formatGrowthPercent(growth: number): string {
    const v = Math.round(growth * 1000) / 10;
    if (v === 0) return '0.0%';
    return `${v > 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}%`;
}

/** HabitatListView.SelectApprovalImage: the mood icon, angry while the colony rebels. */
export function colonyApprovalMood(rating: number, rebelling: boolean): ApprovalMood {
    return rebelling ? 'angry' : approvalMood(rating);
}

/** HabitatListView Cells[9] tooltip: the integer rating, "(REBELLING)" after it while rebelling. */
export function colonyApprovalTooltip(rating: number, rebelling: boolean): string {
    const s = String(Math.trunc(rating));
    return rebelling ? `${s} (${T('Rebelling', 'Rebelling').toUpperCase()})` : s;
}

/** lblColonyCount: "Your empire has X colonies in Y systems" (Y = Empire.DetermineEmpireSystems: distinct systems). */
export function colonyCountText(colonies: number, systems: number): string {
    return formatNet(T('Your empire has X colonies in Y systems', 'Your empire has {0} colonies in {1} systems'), [String(colonies), String(systems)]);
}

/** The distinct systems (by systemIndex) of a colony list. */
export function countColonySystems(colonies: readonly Pick<Habitat, 'systemIndex'>[]): number {
    return new Set(colonies.map((c) => c.systemIndex)).size;
}

export type ColonyTabId = 'population' | 'cargo' | 'resources' | 'troops' | 'construction' | 'docking' | 'facilities';

/** tabColonyData's pages in their Controls order (Main.InitializeComponent.cs 1691-1697). */
export const COLONY_TABS: readonly ColonyTabId[] = ['population', 'cargo', 'resources', 'troops', 'construction', 'docking', 'facilities'];

export interface ColonyTabCounts {
    cargo: number;
    resources: number;
    population: number;
    troopsAndCharacters: number;
    underConstruction: number;
    docked: number;
    facilities: number;
}

/** UnlxwvByxj_SelectionChanged: each tab's caption, with " (n)" when its list is not empty. */
export function colonyTabLabels(c: ColonyTabCounts | null): Record<ColonyTabId, string> {
    const n = (label: string, count: number): string => (c !== null && count > 0 ? `${label} (${count})` : label);
    return {
        population: n(T('Population', 'Population'), c?.population ?? 0),
        cargo: n(T('Cargo', 'Cargo'), c?.cargo ?? 0),
        resources: n(T('Resources', 'Resources'), c?.resources ?? 0),
        troops: n(T('Troops & Characters', 'Troops & Characters'), c?.troopsAndCharacters ?? 0),
        construction: n(T('Construction Yard', 'Construction Yard'), c?.underConstruction ?? 0),
        docking: n(T('Docking Bay', 'Docking Bay'), c?.docked ?? 0),
        facilities: n(T('Facilities', 'Facilities'), c?.facilities ?? 0),
    };
}

export interface PopulationRow {
    race: Race | null;
    name: string;
    amount: number;
    /** GrowthRate - 1. */
    growth: number;
    total: boolean;
}

/** PopulationListView.BindData: the populations largest first (PopulationList.Sort + Reverse), then the TOTAL row
 *  with PopulationList.OverallGrowthRate - 1 (the amount-weighted mean growth). */
export function populationRows(items: readonly { race: Race; amount: number; growthRate: number }[]): PopulationRow[] {
    const sorted = items.filter((p) => p != null).slice().sort((a, b) => b.amount - a.amount);
    const rows: PopulationRow[] = sorted.map((p) => ({ race: p.race, name: p.race?.name ?? '', amount: p.amount, growth: p.growthRate - 1, total: false }));
    if (items.length === 0) return rows;
    let total = 0;
    let weighted = 0;
    for (const p of sorted) {
        total += p.amount;
        weighted += p.amount * (p.growthRate - 1);
    }
    rows.push({ race: null, name: T('TOTAL', 'TOTAL'), amount: total, growth: total > 0 ? weighted / total : 0, total: true });
    return rows;
}

/** ColonyPopulationPolicyDropDown.GeneratePolicies order. */
export const POPULATION_POLICIES: readonly ColonyPopulationPolicy[] = [
    ColonyPopulationPolicy.Assimilate,
    ColonyPopulationPolicy.DoNotAccept,
    ColonyPopulationPolicy.Resettle,
    ColonyPopulationPolicy.Enslave,
    ColonyPopulationPolicy.Exterminate,
];

/** Galaxy.ResolveDescription(ColonyPopulationPolicy). */
export function populationPolicyLabel(p: ColonyPopulationPolicy): string {
    switch (p) {
        case ColonyPopulationPolicy.Assimilate:
            return T('Assimilate', 'Assimilate');
        case ColonyPopulationPolicy.DoNotAccept:
            return T('Do Not Accept', 'Do Not Accept');
        case ColonyPopulationPolicy.Resettle:
            return T('Resettle', 'Resettle');
        case ColonyPopulationPolicy.Enslave:
            return T('Enslave', 'Enslave');
        case ColonyPopulationPolicy.Exterminate:
            return T('Exterminate', 'Exterminate');
    }
    return '';
}

/** HabitatAttitudeSummary.ResolveFeelingDescription. */
export function feelingDescription(rating: number): string {
    if (rating > 15) return T('happy', 'happy');
    if (rating > 0) return T('satisfied', 'satisfied');
    if (rating > -15) return T('unhappy', 'unhappy');
    return T('angry', 'angry');
}

/** .NET "+0;-0;0". */
export function formatSigned0(v: number): string {
    const r = roundAway(v);
    return r > 0 ? `+${r}` : r < 0 ? `${r}` : '0';
}

/** HabitatAttitudeSummary's development line (DetermineHabitatAttitudeFactors num1 thresholds). */
export function developmentDescription(value: number): string {
    if (value > 16) return T('Our colony has a very high level of development', 'Our colony has a very high level of development');
    if (value > 12) return T('Our colony has a high level of development', 'Our colony has a high level of development');
    if (value > 8) return T('Our colony has a reasonable level of development', 'Our colony has a reasonable level of development');
    if (value > 4) return T('Our colony has some development', 'Our colony has some development');
    return T('Our colony has begun to develop', 'Our colony has begun to develop');
}

export interface AttitudeFactor {
    value: number;
    description: string;
}

/** HabitatAttitudeFactorList: Sort (by value) then Reverse — largest first; a stable order for equal values. */
export function sortAttitudeFactors(factors: readonly AttitudeFactor[]): AttitudeFactor[] {
    return factors.slice().sort((a, b) => b.value - a.value);
}

/** The tax change as ColonyTaxUp5 / Up1 / Down5 / Down1 steps from `currentRate` to `targetPercent` (clamped to the
 *  0..50% the action allows, Main.Part7.cs 830-862): fives first, then ones. */
export function taxSteps(currentRate: number, targetPercent: number): ShipActionType[] {
    const from = roundAway(currentRate * 100);
    const to = Math.max(0, Math.min(50, Math.round(targetPercent)));
    let d = to - from;
    const steps: ShipActionType[] = [];
    while (d >= 5) {
        steps.push(ShipActionType.ColonyTaxUp5);
        d -= 5;
    }
    while (d <= -5) {
        steps.push(ShipActionType.ColonyTaxDown5);
        d += 5;
    }
    while (d > 0) {
        steps.push(ShipActionType.ColonyTaxUp1);
        d -= 1;
    }
    while (d < 0) {
        steps.push(ShipActionType.ColonyTaxDown1);
        d += 1;
    }
    return steps;
}

// -------------------------------------------------------------------------------------------------------------------
// Sim reads (impure)
// -------------------------------------------------------------------------------------------------------------------

/** One row of the colony grid (HabitatListView.BindData). */
export interface ColonyGridRow {
    habitat: Habitat;
    name: string;
    empireName: string;
    isCapital: boolean;
    isRegionalCapital: boolean;
    type: string;
    system: string;
    facilities: string;
    facilityPicture: number | null;
    quality: number;
    development: number;
    population: number;
    approval: number;
    rebelling: boolean;
    value: number;
    taxRate: number;
    revenue: number;
    /** Mod layer (19d2): the shortage marker's tooltip, or null. */
    shortage: string | null;
    /** Mod layer: the scenario approval terms ('Shortages -6.0' lines), or null. */
    approvalBreakdown: string | null;
}

function safe<T>(f: () => T, fallback: T): T {
    try {
        const v = f();
        return typeof v === 'number' && !Number.isFinite(v) ? fallback : v;
    } catch {
        return fallback;
    }
}

/** HabitatListView.BindData for one colony. */
export function colonyGridRow(galaxy: Galaxy, h: Habitat): ColonyGridRow {
    const empire = h.empire;
    const facilities = (h.facilities ?? []).filter((f) => f != null);
    const sc = colonyScenarioInfo(galaxy, h);
    return {
        habitat: h,
        name: h.name,
        empireName: empire?.name ?? '',
        isCapital: empire !== null && empire.capital === h,
        isRegionalCapital: empire !== null && empire.capital !== h && (empire.capitals ?? []).includes(h),
        type: habitatTypeDescription(h.type, h.category),
        system: colonySystemName(h),
        facilities: colonyFacilitiesText(facilities),
        facilityPicture: facilities.length > 0 ? facilities[0].def.pictureRef : null,
        quality: safe(() => h.quality, 0),
        development: safe(() => Math.trunc(habitatDevelopmentLevel(h)), 0),
        population: h.population?.totalAmount ?? 0,
        approval: safe(() => empireApprovalRating(galaxy, h), 0),
        rebelling: h.rebelling === true,
        value: safe(() => strategicValue(h), 0),
        taxRate: h.taxRate ?? 0,
        revenue: safe(() => habitatAnnualRevenue(galaxy, h), 0),
        shortage: sc?.shortage ?? null,
        approvalBreakdown: sc !== null && sc.approvalBreakdown.length > 0 ? sc.approvalBreakdown.map((l) => `${l.label} ${l.value.toFixed(1)}`).join('\n') : null,
    };
}

/** The characters at a colony (Habitat.Characters: the empire's characters located there, not transferring). */
export function colonyCharacters(h: Habitat): Character[] {
    const empire = h.empire;
    if (empire === null) return [];
    return findCharactersAtLocationNotTransferring((empire.characters ?? []) as Character[], h, empire, null);
}

function colonyTabCounts(h: Habitat): ColonyTabCounts {
    const queue = siteQueue({ kind: 'colony', habitat: h });
    let building = 0;
    for (const y of queue?.constructionYards ?? []) if (y?.shipUnderConstruction) building++;
    return {
        cargo: h.cargo?.items.length ?? 0,
        resources: h.resources.length,
        population: h.population?.items.length ?? 0,
        troopsAndCharacters: (h.troops?.items.length ?? 0) + colonyCharacters(h).length,
        underConstruction: building,
        docked: (h.dockingBays ?? []).filter((b) => b != null && b.dockedShip !== null).length,
        facilities: (h.facilities ?? []).length,
    };
}

/** HabitatAttitudeSummary.DrawSummary: the header and the attitude factors (DetermineHabitatAttitudeFactors). */
export function colonyAttitudeSummary(galaxy: Galaxy, h: Habitat): { header: string; notes: string[]; factors: AttitudeFactor[] } {
    const rating = safe(() => empireApprovalRating(galaxy, h), 0);
    const header = `${formatNet(T('The inhabitants of COLONY are FEELING with you', 'The inhabitants of {0} are {1} with you'), [h.name, feelingDescription(rating)])} (${formatSigned0(rating)})`;
    const notes: string[] = [];
    const empire = h.empire;
    const raid = raidEconomyDamageFactor(h);
    if (h.raidCountdown > 0) notes.push(`${T('Raid Economy Damage Description', 'Our economy has been damaged by a recent raid')} (-${formatPercent0(raid)})`);
    if (empire !== null) {
        if (empire.economyEfficiency > 1) notes.push(`${T('Economy Efficiency Bonus Description', 'Our economy is running efficiently')} (+${formatPercent0(empire.economyEfficiency - 1)})`);
        else if (empire.economyEfficiency < 1) notes.push(`${T('Economy Efficiency Penalty Description', 'Our economy is running inefficiently')} (-${formatPercent0(1 - empire.economyEfficiency)})`);
    }
    const factors: AttitudeFactor[] = [];
    const add = (value: number, description: string): void => {
        factors.push({ value, description });
    };
    const mod = (v: number): number => modifyApprovalValueByEmpireAttributes(galaxy, h, v);
    const num1 = mod(safe(() => habitatDevelopmentLevel(h), 0) / 5.0);
    add(num1, developmentDescription(num1));
    const num2 = mod(habitatTaxApproval(h));
    if (num2 > 0) add(num2, T('We approve of the current tax rate', 'We approve of the current tax rate'));
    else if (num2 < 0) add(num2, T('The current tax rate is too high!', 'The current tax rate is too high!'));
    if (empire !== null && empire.leaderChangeInfluence !== 0) {
        const num5 = mod(empire.leaderChangeInfluence * 20.0);
        const leader = (empire.leader as { name?: string } | null)?.name ?? '';
        if (num5 > 0) add(num5, formatNet(T('Leader Change Colony Boost', 'Our new empire leader {0} is boosting happiness'), [leader]));
        else add(num5, formatNet(T('Leader Change Colony Disrupt', "Our empire's disruptive leadership change ({0}) is reducing happiness"), [leader]));
    }
    if (empire !== null && empire !== galaxy.independentEmpire) {
        let num11 = mod(empireWarWeariness(empire) * -0.3);
        const gov = empireGovernmentAttributes(empire);
        if (gov !== null && gov.warWeariness !== 0) num11 *= gov.warWeariness;
        const dom = h.population?.dominantRace ?? null;
        if (dom !== null && Math.trunc(dom.warWearinessAttenuation) > 0) num11 *= 1 - Math.trunc(dom.warWearinessAttenuation) / 100;
        if (num11 > 0) add(num11, T('We are happy that our empire is at peace', 'We are happy that our empire is at peace'));
        else if (num11 < 0) add(num11, T("We tire of our empire's wars", "We tire of our empire's wars"));
    }
    const num13 = mod(h.culturalDistressFactor * -1.0);
    if (num13 > 0) add(num13, T('We have no cultural distress', 'We have no cultural distress'));
    else if (num13 < 0) add(num13, T('We are in awe of nearby colonies of other empires', 'We are in awe of nearby colonies of other empires'));
    const num14 = mod(h.conqueredFactor);
    if (num14 < 0) add(num14, T('We are angry at the recent conquest of our colony', 'We are angry at the recent conquest of our colony'));
    const num15 = mod(-15.0 * (1.0 - safe(() => calculateStrategicResourceSupplyGrowthFactor(galaxy, h), 1)));
    if (num15 < 0) add(num15, T('Resource shortages are hampering the growth of our colony', 'Resource shortages are hampering the growth of our colony'));
    const num16 = mod(h.happinessModifier);
    if (num16 > 0) add(num16, T('Recreational and medical facilities benefit us', 'Recreational and medical facilities benefit us'));
    else if (num16 < 0) add(num16, T('We have been incited to rebellion', 'We have been incited to rebellion'));
    if (empire !== null) {
        const owner = h.owner;
        const num17 = owner !== null && owner !== galaxy.independentEmpire ? safe(() => empireCivilityRatingApprovalRaw(galaxy, owner), 0) : 0;
        const dom = h.population?.dominantRace ?? null;
        const num18 = dom !== null ? calculateRacialReputationConcern(dom) : 1;
        const num19 = mod(num17 / num18);
        if (num19 > 0.5) add(num19, T("We are proud of our empire's good reputation", "We are proud of our empire's good reputation"));
        else if (num19 < -0.5) add(num19, T("We are concerned about our empire's poor reputation", "We are concerned about our empire's poor reputation"));
    }
    const num20 = mod(safe(() => habitatRacialHappiness(galaxy, h), 0));
    if (num20 > 0) add(num20, T('We have no racial unhappiness', 'We have no racial unhappiness'));
    else if (num20 < 0 && h.population?.dominantRace && empire?.dominantRace) {
        add(num20, formatNet(T('RACE are unhappy being part of our RACE empire', '{0}s are unhappy being part of our {1} empire'), [h.population.dominantRace.name, empire.dominantRace.name]));
    }
    const policy = calculatePopulationPolicyConcern(h);
    if (policy < 0) {
        const ext = calculateExterminationConcern(h);
        const slavery = policy - ext < 0;
        if (ext < 0 && slavery) add(policy, T('The inhabitants are upset at your harsh policy of enslavement and extermination', 'The inhabitants are upset at your harsh policy of enslavement and extermination'));
        else if (ext < 0) add(policy, T('The inhabitants are upset at your harsh policy of extermination', 'The inhabitants are upset at your harsh policy of extermination'));
        else add(policy, T('The inhabitants are upset at your harsh policy of enslavement', 'The inhabitants are upset at your harsh policy of enslavement'));
    }
    const num21 = mod(h.warWithOurRace);
    if (num21 > 0) add(num21, T('You are not at war with empires of our race', 'You are not at war with empires of our race'));
    else if (num21 < 0 && h.population?.dominantRace) add(num21, formatNet(T('RACE are upset that we are at war with their species', '{0}s are upset that we are at war with their species'), [h.population.dominantRace.name]));
    const num22 = mod(h.damage * -20.0);
    if (num22 < 0) add(num22, T("Our colony's environment has been ravaged by destruction", "Our colony's environment has been ravaged by destruction"));
    const num23 = mod(raid * -20.0);
    if (num23 < 0) add(num23, T('Raid Unhappiness Description', 'A recent raid has made us unhappy'));
    const plague = safe(() => getPlagueUnhappinessFactorWithPlague(galaxy, h), { result: 0, plague: null });
    const num24 = mod(plague.result);
    if (num24 < 0 && plague.plague !== null) add(num24, formatNet(T('Plague Unhappiness Description', 'The {0} plague is making us unhappy'), [(plague.plague as { name?: string }).name ?? '']));
    return { header, notes, factors: sortAttitudeFactors(factors) };
}

/** The facilities the player can order at a colony (UnlxwvByxj_SelectionChanged: ResolveBuildableFacilities, or the
 *  pirate list at a colony the pirate player does not own, then ResolveBuildableWonders). */
export function buildableFacilities(galaxy: Galaxy, player: Empire, h: Habitat): Facility[] {
    let list = safe(() => resolveBuildableFacilities(galaxy, h), [] as Facility[]);
    if (player.pirateEmpireBaseHabitat !== null && h.empire !== player) list = safe(() => resolveBuildableFacilitiesPirates(galaxy, h, player), [] as Facility[]);
    return [...list, ...safe(() => resolveBuildableWonders(galaxy, h), [] as Facility[])];
}

// -------------------------------------------------------------------------------------------------------------------
// DOM
// -------------------------------------------------------------------------------------------------------------------

export interface ColoniesScreenOptions {
    /** The player's empire. */
    empire: Empire;
    /** The colony to select on open (method_166(habitat_9)). */
    selected?: Habitat | null;
    /** Select Colony (method_208): select it without moving the view. */
    onSelect?: (h: Habitat) => void;
    /** Go to Colony (method_157): select it, move the view, and close the screen. */
    onGoTo: (h: Habitat) => void;
    /** Show On Galaxy Map (method_169): open the Galaxy Map on the colony. */
    onShowOnGalaxyMap?: (h: Habitat) => void;
    /** Show Expansion Planner (method_160("colonies")). */
    onExpansionPlanner?: () => void;
    /** Show Construction Summary (the Construction Yards screen). */
    onConstructionSummary?: () => void;
    /** method_456(topic): open the Galactopedia on a topic. */
    onHelp?: (topic: string) => void;
    /** GenerateAutomationMessageBox: resolves true for "turn automation off". */
    confirmAutomationOff?: (task: string) => Promise<boolean>;
    /** Refresh period in ms (default 1000). */
    refreshMs?: number;
}

interface OpenState {
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Colonies screen, or close it when it is open (Main.Part9.cs tbtnColonies_Click / F2). */
export function toggleColoniesScreen(opts: ColoniesScreenOptions): void {
    if (open) open.close();
    else open = createColoniesScreen(opts);
}

export function closeColoniesScreen(): void {
    open?.close();
}

export function isColoniesScreenOpen(): boolean {
    return open !== null;
}

function img(src: string, cls: string, title = ''): HTMLImageElement {
    const i = el('img', cls);
    i.src = src;
    i.alt = '';
    i.draggable = false;
    if (title) i.title = title;
    i.onerror = () => {
        i.style.visibility = 'hidden';
    };
    return i;
}

const flagUrls = new Map<number, string>();

function createColoniesScreen(opts: ColoniesScreenOptions): OpenState {
    const empire = opts.empire;
    const galaxy: Galaxy = empire.galaxy;
    const L = COLONIES_LAYOUT;
    let timer = 0;
    let selected: Habitat | null = opts.selected ?? empire.colonies[0] ?? null;
    let tab: ColonyTabId = 'population';
    let state: OpenState;

    const win: OriginalWindow = openOriginalWindow({
        id: 'colonies',
        title: T('Colonies', 'Colonies'),
        icon: 'colony.png',
        width: COLONIES_WINDOW.w,
        height: COLONIES_WINDOW.h,
        onClose: () => {
            window.clearInterval(timer);
            if (open === state) open = null;
        },
    });
    const body = win.body;

    // --- Top row ----------------------------------------------------------------------------------------------------
    const countLabel = dropText(body, '', L.count.x, L.count.y, { bold: true, color: COLORS.gridText });
    const growthLink = linkLabel(T('How can you help your colonies grow?...', 'How can you help your colonies grow?...'), () => opts.onHelp?.(T('Colony Growth', 'Colony Growth')));
    body.appendChild(place(growthLink, L.growthLink.x, L.growthLink.y, L.growthLink.w, L.growthLink.h));
    growthLink.classList.add('col-link-right');
    const expansionBtn = glassButton(T('Show Expansion Planner', 'Show Expansion Planner'), { onClick: () => opts.onExpansionPlanner?.(), disabled: !opts.onExpansionPlanner });
    body.appendChild(place(expansionBtn, L.expansionPlanner.x, L.expansionPlanner.y, L.expansionPlanner.w, L.expansionPlanner.h));

    // --- The colony grid (HabitatListView, column widths from method_166) ----------------------------------------------
    const flagFor = (e: Empire, cell: HTMLElement): void => {
        const cached = flagUrls.get(e.empireId);
        const f = img(cached ?? '', 'col-flag');
        if (cached === undefined) {
            f.removeAttribute('src');
            void empireFlagUrl(galaxy, e).then((u) => {
                flagUrls.set(e.empireId, u);
                f.src = u;
            });
        }
        cell.appendChild(f);
    };
    const columns: GridColumn<ColonyGridRow>[] = [
        {
            id: 'empire',
            header: '',
            fill: 30,
            sort: (r) => r.empireName,
            render: (r, c) => {
                const e = r.habitat.empire;
                if (e) flagFor(e, c);
                if (r.isCapital || r.isRegionalCapital) c.appendChild(img(chromeImageUrl('capital.png'), 'col-capital', r.isCapital ? 'Capital' : 'Regional capital'));
                c.title = r.empireName;
            },
        },
        {
            id: 'picture',
            header: '',
            fill: 25,
            render: (r, c) => {
                const u = habitatImageUrl(r.habitat);
                if (u) c.appendChild(img(u, 'col-planet'));
            },
        },
        {
            id: 'name',
            header: T('Name', 'Name'),
            fill: 105,
            sort: (r) => r.name,
            render: (r, c) => {
                c.append(el('span', 'col-ellipsis', r.name));
                if (r.shortage !== null) {
                    // Mod layer (19d2): shortage marker, lost luxuries in the tooltip.
                    const tag = el('span', 'col-shortage', '!');
                    tag.title = r.shortage;
                    c.appendChild(tag);
                }
                // [emergent] 19d1 internal politics: the governor's loyalty as the name tooltip (flag on only).
                const governor = governorLoyaltyText(galaxy, r.habitat);
                c.title = governor !== null ? `${r.name}\nGovernor ${governor}` : r.name;
            },
        },
        { id: 'type', header: T('Type', 'Type'), fill: 109, sort: (r) => r.type, render: (r, c) => cellText(c, r.type) },
        { id: 'system', header: T('System', 'System'), fill: 80, sort: (r) => r.system, render: (r, c) => cellText(c, r.system) },
        {
            id: 'facilities',
            header: T('Facilities', 'Facilities'),
            fill: 30,
            sort: (r) => r.facilities,
            render: (r, c) => {
                if (r.facilityPicture !== null) c.appendChild(img(facilityImageUrl(r.facilityPicture), 'col-facility'));
                c.title = r.facilities;
            },
            align: 'center',
        },
        { id: 'quality', header: T('Quality', 'Quality'), fill: 37, align: 'right', sort: (r) => r.quality, render: (r, c) => cellText(c, formatPercent0(r.quality)) },
        { id: 'development', header: T('Culture', 'Culture'), fill: 30, align: 'right', sort: (r) => r.development, render: (r, c) => cellText(c, String(r.development)) },
        { id: 'population', header: T('Population Abbreviation', 'Pop'), fill: 55, align: 'right', sort: (r) => r.population, render: (r, c) => cellText(c, formatPopulationM(r.population)) },
        {
            id: 'approval',
            header: '',
            fill: 25,
            align: 'center',
            sort: (r) => Math.trunc(r.approval),
            render: (r, c) => {
                const mood = colonyApprovalMood(r.approval, r.rebelling);
                const tip = colonyApprovalTooltip(r.approval, r.rebelling);
                c.appendChild(img(chromeImageUrl(`${mood}.png`), 'col-mood', r.approvalBreakdown !== null ? `${tip}\n${r.approvalBreakdown}` : tip));
            },
        },
        { id: 'value', header: T('Value', 'Value'), fill: 50, align: 'right', sort: (r) => r.value, render: (r, c) => cellText(c, formatStrategicValueK(r.value)) },
        { id: 'tax', header: T('Tax', 'Tax'), fill: 40, align: 'right', sort: (r) => r.taxRate, render: (r, c) => cellText(c, formatTaxPercent(r.taxRate)) },
        { id: 'revenue', header: T('Revenue', 'Revenue'), fill: 55, align: 'right', sort: (r) => r.revenue, render: (r, c) => cellText(c, formatThousandsK(r.revenue)) },
    ];
    const grid = new OwGrid<ColonyGridRow>({
        columns,
        key: (r) => r.habitat,
        rowHeight: 20,
        onSelect: (r) => selectColony(r.habitat),
        onDoubleClick: (r) => goTo(r.habitat),
        empty: T('(None)', '(None)'),
    });
    grid.el.classList.add('col-grid');
    body.appendChild(place(grid.el, L.grid.x, L.grid.y, L.grid.w, L.grid.h));

    // --- Galaxy map (gmapColony) --------------------------------------------------------------------------------------
    dropText(body, T('Location of selected Colony in Galaxy', 'Location of selected Colony in Galaxy'), L.mapTitle.x, L.mapTitle.y, { color: COLORS.gridText });
    const mapCanvas = el('canvas', 'col-map');
    body.appendChild(place(mapCanvas, L.map.x, L.map.y, L.map.w, L.map.h));
    mapCanvas.addEventListener('click', () => {
        if (selected) opts.onShowOnGalaxyMap?.(selected);
    });

    // --- Buttons row --------------------------------------------------------------------------------------------------
    const btnLabels: Record<string, string> = {
        select: T('Select Colony', 'Select Colony'),
        goto: T('Go to Colony', 'Go to Colony'),
        galaxyMap: T('Show On Galaxy Map', 'Show On Galaxy Map'),
        capital: T('Set as Capital', 'Set as Capital'),
        ruin: T('Show Ruin Details', 'Show Ruin Details'),
    };
    const buttons: Record<string, HTMLButtonElement> = {};
    for (const b of L.buttons) {
        const btn = glassButton(btnLabels[b.id], { onClick: () => onButton(b.id) });
        buttons[b.id] = btn;
        body.appendChild(place(btn, b.x, L.buttonsY, b.w, L.buttonsH));
    }

    // --- Name / tax ---------------------------------------------------------------------------------------------------
    dropText(body, T('Name', 'Name'), L.nameLabel.x, L.nameLabel.y, { color: COLORS.gridText });
    const nameBox = textBox('', '', () => {});
    nameBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nameBox.blur();
    });
    // txtColonyName_Leave: a non-blank name renames the selected colony.
    nameBox.addEventListener('blur', () => {
        const h = selected;
        if (h && nameBox.value.trim() !== '' && nameBox.value.trim() !== h.name) issuePlayerCommand(galaxy, empire, 'renameColony', [h, nameBox.value], () => refreshAll());
    });
    body.appendChild(place(nameBox, L.nameBox.x, L.nameBox.y, L.nameBox.w, L.nameBox.h));
    dropText(body, T('Tax', 'Tax'), L.taxLabel.x, L.taxLabel.y, { color: COLORS.gridText });
    const taxBox = el('input', 'ow-input col-tax');
    taxBox.type = 'number';
    taxBox.min = '0';
    taxBox.max = '50';
    taxBox.step = '1';
    taxBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') taxBox.blur();
        if (e.key !== 'Escape') e.stopPropagation();
    });
    taxBox.addEventListener('change', () => void applyTax());
    body.appendChild(place(taxBox, L.taxBox.x, L.taxBox.y, L.taxBox.w, L.taxBox.h));
    dropText(body, '%', L.taxPercent.x, L.taxPercent.y, { color: COLORS.gridText });

    // --- Tab control (tabColonyData) ----------------------------------------------------------------------------------
    const tabsHost = el('div', 'col-tabs');
    body.appendChild(place(tabsHost, L.tabs.x, L.tabs.y, L.tabs.w, L.tabs.h));
    const page = el('div', 'col-page');
    tabsHost.appendChild(place(page, TAB_PAGE.x, TAB_PAGE.y, TAB_PAGE.w, TAB_PAGE.h));
    let strip: HTMLDivElement | null = null;
    let stripLabels = '';
    const renderStrip = (): void => {
        const labels = colonyTabLabels(selected ? colonyTabCounts(selected) : null);
        const key = COLONY_TABS.map((t) => labels[t]).join('|');
        if (key === stripLabels && strip !== null) return;
        stripLabels = key;
        const s = tabStrip(
            COLONY_TABS.map((id) => ({ id, label: labels[id] })),
            tab,
            (id) => {
                tab = id as ColonyTabId;
                renderPage(true);
            },
        );
        place(s, 0, 0, L.tabs.w);
        if (strip) strip.replaceWith(s);
        else tabsHost.prepend(s);
        strip = s;
    };

    // --- Habitat info (pnlColonyHabitatInfo) --------------------------------------------------------------------------
    const info = gradientPanel({ corners: { tl: true, br: true }, className: 'col-info' });
    body.appendChild(place(info, L.info.x, L.info.y, L.info.w, L.info.h));
    const infoBox = el('div', 'sel-content-box col-info-box');
    info.appendChild(infoBox);
    // InfoPanel clicks: a colony of ours selects its row; anything else is left to the main view.
    const onInfoTarget = (t: InfoTarget): void => {
        if (t.kind === 'select' && empire.colonies.includes(t.obj as Habitat)) {
            selectColony(t.obj as Habitat);
            grid.select(t.obj, true);
        }
    };

    // --- Actions ------------------------------------------------------------------------------------------------------
    function selectColony(h: Habitat): void {
        if (selected === h) return;
        selected = h;
        refreshDetail(true);
    }

    function goTo(h: Habitat): void {
        state.close();
        opts.onGoTo(h);
    }

    function onButton(id: string): void {
        const h = selected;
        if (!h) return;
        switch (id) {
            case 'select':
                opts.onSelect?.(h);
                return;
            case 'goto':
                goTo(h);
                return;
            case 'galaxyMap':
                opts.onShowOnGalaxyMap?.(h);
                return;
            case 'capital':
                issuePlayerCommand(galaxy, empire, 'setColonyAsCapital', [h], () => refreshAll());
                return;
            case 'ruin':
                if (h.ruin) void messageBox({ caption: h.ruin.name, text: h.ruin.description ?? h.ruin.name, icon: 'information', width: 520 });
                return;
        }
    }

    async function applyTax(): Promise<void> {
        const h = selected;
        if (!h) return;
        const target = Number(taxBox.value);
        if (!Number.isFinite(target)) return;
        const steps = taxSteps(h.taxRate, target);
        if (steps.length === 0) return;
        // numColonyTaxRate_Leave: the automation question first, then the new rate.
        if (empire.controlColonyTaxRates && opts.confirmAutomationOff && (await opts.confirmAutomationOff(T('Colony Tax Rates', 'Colony Tax Rates')))) {
            issuePlayerCommand(galaxy, empire, 'setEmpireControl', ['controlColonyTaxRates', false]);
        }
        steps.forEach((s, i) => issuePlayerCommand(galaxy, empire, 'shipAction', [h, createShipAction(s, h), false], i === steps.length - 1 ? () => refreshAll() : undefined));
    }

    // --- Refresh ------------------------------------------------------------------------------------------------------
    function refreshGrid(): void {
        const rows = empire.colonies.map((h) => colonyGridRow(galaxy, h));
        grid.setRows(rows);
        if (selected !== null && !empire.colonies.includes(selected)) selected = empire.colonies[0] ?? null;
        if (selected !== null) grid.select(selected, false);
        setText(countLabel, colonyCountText(empire.colonies.length, countColonySystems(empire.colonies)));
    }

    let lastMapSystem: Habitat | null | undefined;
    function refreshDetail(selectionChanged: boolean): void {
        const h = selected;
        const sys = h ? galaxy.determineHabitatSystemStar(h) : null;
        if (sys !== lastMapSystem) {
            lastMapSystem = sys;
            drawSystemsMiniMap(mapCanvas, galaxy, L.map.w, new Set(sys ? [sys] : []));
        }
        buttons.select.disabled = !h || !opts.onSelect;
        buttons.goto.disabled = !h;
        buttons.galaxyMap.disabled = !h || !opts.onShowOnGalaxyMap;
        // Main.Part11.cs 3329: btnColonyMakeCapital disabled for a pirate player's non-owned colony.
        buttons.capital.disabled = !h || h.empire !== empire;
        buttons.ruin.disabled = !h || h.ruin === null;
        if (document.activeElement !== nameBox && nameBox.value !== (h?.name ?? '')) nameBox.value = h?.name ?? '';
        nameBox.disabled = !h || h.empire !== empire;
        if (document.activeElement !== taxBox) taxBox.value = h ? String(roundAway(Math.max(0, h.taxRate) * 100)) : '0';
        taxBox.disabled = !h || (empire.pirateEmpireBaseHabitat !== null && h.empire !== empire);
        renderStrip();
        renderInfo();
        renderPage(selectionChanged);
    }

    function renderInfo(): void {
        const h = selected;
        if (!h) {
            infoBox.replaceChildren();
            return;
        }
        const scroll = infoBox.querySelector('.sel-scroll');
        const top = scroll?.scrollTop ?? 0;
        const resource = (id: number): { name: string; pictureRef: number } | null => galaxy.resources.find((r) => r.resourceId === id) ?? null;
        const model = habitatInfo({ galaxy, player: empire, resource }, h);
        renderInfoModel(infoBox, model, { galaxy, onTarget: onInfoTarget });
        const next = infoBox.querySelector('.sel-scroll');
        if (next) next.scrollTop = top;
        // InfoPanel.DrawBackgroundPicture centres the picture in this panel's own 300 × 300 client area.
        const pic = infoBox.querySelector<HTMLImageElement>('.sel-picture');
        if (pic) {
            const side = Math.min(parseFloat(pic.style.width) || 200, L.info.h - 6);
            pic.style.width = `${side}px`;
            pic.style.height = `${side}px`;
            pic.style.left = `${Math.trunc((L.info.w - side) / 2)}px`;
            pic.style.top = `${Math.trunc((L.info.h - side) / 2)}px`;
        }
    }

    function renderPage(force: boolean): void {
        // Keep an open drop-down / focused field alive between timer refreshes.
        if (!force && page.contains(document.activeElement)) return;
        const scrolls = [...page.querySelectorAll<HTMLElement>('.ow-scroll')].map((s) => s.scrollTop);
        page.replaceChildren();
        const h = selected;
        if (!h) return;
        switch (tab) {
            case 'population':
                renderPopulation(h);
                break;
            case 'cargo':
                renderCargo(h);
                break;
            case 'resources':
                renderResources(h);
                break;
            case 'troops':
                renderTroops(h);
                break;
            case 'construction':
                renderConstruction(h);
                break;
            case 'docking':
                renderDocking(h);
                break;
            case 'facilities':
                renderFacilities(h);
                break;
        }
        if (!force) [...page.querySelectorAll<HTMLElement>('.ow-scroll')].forEach((s, i) => (s.scrollTop = scrolls[i] ?? 0));
    }

    // --- Population tab (ctlColonyPopulation, policies, pnlColonyPopulationAttitudeSummary) -----------------------
    function renderPopulation(h: Habitat): void {
        const rows = populationRows(h.population?.items ?? []);
        const g = new OwGrid<PopulationRow>({
            columns: [
                {
                    id: 'picture',
                    header: '',
                    fill: 40,
                    render: (r, c) => {
                        if (r.race) c.appendChild(img(racePortraitUrl(r.race.pictureIndex), 'col-race'));
                    },
                },
                { id: 'name', header: T('Name', 'Name'), fill: 120, render: (r, c) => cellText(c, r.name, r.total ? 'col-bold' : '') },
                { id: 'amount', header: T('Amount', 'Amount'), fill: 55, align: 'right', render: (r, c) => cellText(c, formatPopulationM(r.amount)) },
                { id: 'growth', header: T('Growth', 'Growth'), fill: 55, align: 'right', render: (r, c) => cellText(c, formatGrowthPercent(r.growth)) },
            ],
            key: (r) => r.race ?? 'total',
            rowHeight: 45,
        });
        g.setRows(rows);
        page.appendChild(place(g.el, 0, 0, 270, 185));
        // Main.Part11.cs 3247-3256 / 3329: the drop-downs are disabled during an extermination race event and for a
        // pirate player's non-owned colony.
        const owned = h.empire === empire;
        const policyRow = (label: string, y: number, value: number, sameFamily: boolean): HTMLSelectElement => {
            const l = text(label, { color: COLORS.gridText, size: FONT.small });
            l.classList.add('col-right-label');
            page.appendChild(place(l, 0, y, 182, 15));
            const dd = dropDown(
                POPULATION_POLICIES.map((p) => ({ value: String(p), label: populationPolicyLabel(p) })),
                String(value),
                (v) => issuePlayerCommand(galaxy, empire, 'setColonyPopulationPolicy', [h, sameFamily, Number(v)], () => renderPage(true)),
            );
            dd.disabled = !owned || colonyPopulationPolicyLocked(h);
            page.appendChild(place(dd, 185, y - 5, 85, 21));
            return dd;
        };
        const ddFamily = policyRow(T('Population Policy: Same Family', 'Population Policy: Same Family'), 193, h.colonyPopulationPolicyRaceFamily, true);
        const ddOthers = policyRow(T('Population Policy: All Other Races', 'Population Policy: All Other Races'), 220, h.colonyPopulationPolicy, false);
        const apply = glassButton(T('Apply this Policy to All Colonies', 'Apply this Policy to All Colonies'), {
            disabled: !owned,
            onClick: () => {
                // btnColonyPopulationApplyPolicyToAll_Click: the Yes/No question, then both drop-downs' policies.
                const family = Number(ddFamily.value);
                const others = Number(ddOthers.value);
                void messageBox({
                    caption: T('Apply Population Policy title', 'Apply Population Policy to All Colonies?'),
                    text: T('Apply Population Policy warning', 'This will apply the current population policy for this colony to all of the other colonies in your empire.\n\nAre you sure that you want to do this?').replace(/\\n/g, '\n'),
                    buttons: ['Yes', 'No'],
                    icon: 'question',
                }).then((b) => {
                    if (b === 'Yes') issuePlayerCommand(galaxy, empire, 'applyPopulationPolicyToAll', [family, others], () => refreshAll());
                });
            },
        });
        page.appendChild(place(apply, 5, 244, 265, 25));
        const bg = gradientPanel({ corners: { tl: true, br: true } });
        page.appendChild(place(bg, 274, 5, 385, 240));
        const sc = scrollPanel('col-attitude');
        bg.appendChild(place(sc, 8, 8, 370, 220));
        const sum = colonyAttitudeSummary(galaxy, h);
        const line = (s: string, cls: string, color?: string): void => {
            const d = el('div', `col-att-line ${cls}`, s);
            if (color) d.style.color = color;
            sc.appendChild(d);
        };
        line(sum.header, 'col-att-header');
        for (const n of sum.notes) line(n, 'col-att-note');
        for (const f of sum.factors) line(`${f.description} (${formatSigned0(f.value)})`, 'col-att-factor', f.value < 0 ? COLORS.red : COLORS.green);
        const lnk = linkLabel(T('Learn about Colony Approval...', 'Learn about Colony Approval...'), () => opts.onHelp?.(T('Colony Approval', 'Colony Approval')));
        lnk.classList.add('col-link-right');
        page.appendChild(place(lnk, 455, 250, 200, 21));
    }

    // --- Cargo tab (ctlColonyCargo) -----------------------------------------------------------------------------------
    function renderCargo(h: Habitat): void {
        interface CargoRow {
            key: number;
            empire: Empire | null;
            picture: string | null;
            name: string;
            amount: number;
            reserved: number;
        }
        const comps = componentDefinitionsStatic(galaxy);
        const rows: CargoRow[] = (h.cargo?.items ?? []).map((c, i) => {
            if (c.commodityComponent !== null) {
                const id = c.commodityComponent.componentId;
                const def = comps.find((d) => d.componentId === id);
                return { key: i, empire: c.empire as Empire | null, picture: def ? `/assets/dwu/images/ui/components/Component_${(def as { pictureRef?: number }).pictureRef ?? id}.bmp` : null, name: def?.name ?? '', amount: c.amount, reserved: c.reserved };
            }
            const r = galaxy.resources.find((x) => x.resourceId === c.commodity.resourceId);
            return { key: i, empire: c.empire as Empire | null, picture: r ? resourceIconUrl(r.pictureRef) : null, name: r?.name ?? '', amount: c.amount, reserved: c.reserved };
        });
        const g = new OwGrid<CargoRow>({
            columns: [
                {
                    id: 'empire',
                    header: T('Empire', 'Empire'),
                    fill: 30,
                    render: (r, c) => {
                        if (r.empire) flagFor(r.empire, c);
                    },
                },
                {
                    id: 'picture',
                    header: '',
                    fill: 50,
                    align: 'center',
                    render: (r, c) => {
                        if (r.picture) c.appendChild(img(r.picture, 'col-res'));
                    },
                },
                { id: 'name', header: T('Name', 'Name'), fill: 160, sort: (r) => r.name, render: (r, c) => cellText(c, r.name) },
                { id: 'amount', header: T('Amount Abbreviation', 'Amt'), fill: 60, align: 'right', sort: (r) => r.amount, render: (r, c) => cellText(c, formatMoney(r.amount)) },
                { id: 'reserved', header: T('Reserved Abbreviation', 'Rsvd'), fill: 60, align: 'right', sort: (r) => r.reserved, render: (r, c) => cellText(c, formatMoney(r.reserved)) },
            ],
            key: (r) => r.key,
            rowHeight: 26,
        });
        g.setRows(rows);
        page.appendChild(place(g.el, 0, 0, 350, 271));
        if (safe(() => calculateStrategicResourceSupplyGrowthFactor(galaxy, h), 1) < 1) {
            page.appendChild(place(text(T('Insufficient Strategic Resources For Growth', 'This colony has insufficient strategic resources, which is slowing development and population growth.'), { color: 'rgb(255, 255, 0)', wrapWidth: 290, size: FONT.small }), 365, 5));
        }
        // TODO(port): lblColonyCargoConstructionResourceShortage (ManufacturingQueue.DeficientResources) — Main.Part11.cs UnlxwvByxj_SelectionChanged
    }

    // --- Resources tab (ctlColonyResources) ---------------------------------------------------------------------------
    function renderResources(h: Habitat): void {
        interface ResRow {
            id: number;
            name: string;
            picture: number;
            abundance: number;
        }
        const rows: ResRow[] = h.resources.map((r) => {
            const d = galaxy.resources.find((x) => x.resourceId === r.resourceId);
            return { id: r.resourceId, name: d?.name ?? '', picture: d?.pictureRef ?? 0, abundance: r.abundance };
        });
        const g = new OwGrid<ResRow>({
            columns: [
                { id: 'picture', header: '', fill: 50, align: 'center', render: (r, c) => c.appendChild(img(resourceIconUrl(r.picture), 'col-res')) },
                { id: 'name', header: T('Type', 'Type'), fill: 190, sort: (r) => r.name, render: (r, c) => cellText(c, r.name) },
                // HabitatResourceListView: Abundance (0..1000) / 10 in "##0".
                { id: 'abundance', header: '%', fill: 60, align: 'right', sort: (r) => r.abundance, render: (r, c) => cellText(c, String(Math.round(r.abundance / 10))) },
            ],
            key: (r) => r.id,
            rowHeight: 26,
        });
        g.setRows(rows);
        page.appendChild(place(g.el, 0, 0, 300, 271));
    }

    // --- Troops & Characters tab (ctlColonyCharacterTroops + recruit / disband / garrison) ----------------------------
    let selectedTroops = new Set<Troop>();
    let selectedCharacter: Character | null = null;
    let transportChoice: BuiltObject | null = null;
    function renderTroops(h: Habitat): void {
        const box = scrollPanel('col-icons');
        page.appendChild(place(box, 0, 0, 540, 271));
        const raceCount = galaxy.races.length;
        for (const c of colonyCharacters(h)) {
            const t = el('div', 'col-icon col-icon-char');
            const role = CharacterRole[c.role] ?? '';
            t.appendChild(img(chromeImageUrl(`characterRole_${role}.png`), 'col-icon-img'));
            t.appendChild(el('div', 'col-icon-label', c.name));
            t.title = `${c.name} (${role.replace(/([a-z])([A-Z])/g, '$1 $2')})`;
            if (selectedCharacter === c) t.classList.add('col-icon-sel');
            t.addEventListener('click', () => {
                selectedCharacter = selectedCharacter === c ? null : c;
                selectedTroops = new Set();
                renderPage(true);
            });
            box.appendChild(t);
        }
        const troopTile = (tr: Troop, state: string): void => {
            const t = el('div', `col-icon col-troop ${state}${selectedTroops.has(tr) ? ' col-icon-sel' : ''}`);
            const i = img(troopImageUrl(tr, raceCount, { concordArt: raceHasConcordArt(galaxy, (tr.race as Race | null)?.name) }), 'col-icon-img');
            wireTroopImageFallback(i, tr, raceCount, { concordArt: raceHasConcordArt(galaxy, (tr.race as Race | null)?.name) });
            t.appendChild(i);
            t.appendChild(el('div', 'col-icon-label', tr.name));
            t.title = `${tr.name}\n${troopTypeDescription(tr.type)}  ${tr.attackStrength} / ${tr.defendStrength}${tr.garrisoned ? '\nGarrisoned' : ''}${state === 'col-recruit' ? '\nRecruiting' : ''}`;
            if (state === '') {
                t.addEventListener('click', (e) => {
                    if (!e.ctrlKey && !e.shiftKey) selectedTroops = new Set();
                    selectedCharacter = null;
                    if (selectedTroops.has(tr)) selectedTroops.delete(tr);
                    else selectedTroops.add(tr);
                    renderPage(true);
                });
            }
            box.appendChild(t);
        };
        for (const tr of h.troops?.items ?? []) troopTile(tr, '');
        for (const tr of h.troopsToRecruit?.items ?? []) troopTile(tr, 'col-recruit');
        for (const tr of h.invadingTroops?.items ?? []) troopTile(tr, 'col-invading');
        selectedTroops = new Set([...selectedTroops].filter((t) => h.troops?.items.includes(t)));

        const owned = !(empire.pirateEmpireBaseHabitat !== null && h.empire !== empire) && h.empire === empire;
        const recruit = owned ? recruitOptions(galaxy, empire, h) : [];
        const dd = dropDown(
            recruit.map((o, i) => ({ value: String(i), label: `${o.troop.name} (${troopTypeDescription(o.troop.type)})` })),
            '0',
            () => {},
        );
        dd.disabled = recruit.length === 0;
        page.appendChild(place(dd, 545, 10, 115, 21));
        const btn = (label: string, y: number, onClick: () => void, enabled: boolean, h2 = 25): void => {
            page.appendChild(place(glassButton(label, { onClick, disabled: !enabled }), 545, y, 110, h2));
        };
        btn(T('Recruit', 'Recruit'), 35, () => void recruitSelected(h, recruit[Number(dd.value)]?.action), owned && recruit.length > 0);
        const sel = [...selectedTroops];
        btn(T('Disband', 'Disband'), 70, () => void disband(sel), owned && sel.length > 0);
        btn(T('Garrison', 'Garrison'), 120, () => issuePlayerCommand(galaxy, empire, 'garrisonTroops', [sel, true], () => renderPage(true)), owned && sel.length > 0);
        btn(T('Ungarrison', 'Ungarrison'), 150, () => issuePlayerCommand(galaxy, empire, 'garrisonTroops', [sel, false], () => renderPage(true)), owned && sel.length > 0);
        if (selectedCharacter !== null && !colonyCharacters(h).includes(selectedCharacter)) selectedCharacter = null;
        // method_427: the empire's ships within 1000 with room for 100 troop size.
        const transports = owned ? colonyTroopTransports(galaxy, empire, h) : [];
        if (transportChoice === null || !transports.includes(transportChoice)) transportChoice = transports[0] ?? null;
        const tdd = dropDown(
            transports.map((b, i) => ({ value: String(i), label: b.name })),
            String(Math.max(0, transportChoice ? transports.indexOf(transportChoice) : 0)),
            (v) => {
                transportChoice = transports[Number(v)] ?? null;
            },
        );
        tdd.disabled = transports.length === 0;
        page.appendChild(place(tdd, 545, 200, 115, 21));
        // btnColonyTroopTransferTransport_Click: the selected troop(s) or character onto the transport.
        const items: (Troop | Character)[] = selectedCharacter !== null ? [selectedCharacter] : sel;
        btn(
            T('Transfer', 'Transfer'),
            225,
            () => {
                const transport = transportChoice;
                if (!transport) return;
                items.forEach((it, i) =>
                    issuePlayerCommand(galaxy, empire, 'colonyTransferToTransport', [h, it, transport], i === items.length - 1 ? () => {
                        selectedTroops = new Set();
                        selectedCharacter = null;
                        refreshAll();
                    } : undefined),
                );
            },
            owned && transportChoice !== null && items.length > 0,
        );
    }

    async function recruitSelected(h: Habitat, action: ReturnType<typeof createShipAction> | undefined): Promise<void> {
        if (!action) return;
        const r = await new Promise<{ automationPrompts: string[] }>((resolve) => issuePlayerCommand(galaxy, empire, 'shipAction', [h, action, false], resolve));
        refreshAll();
        for (const task of r.automationPrompts) {
            if (opts.confirmAutomationOff && (await opts.confirmAutomationOff(T(task, task)))) issuePlayerCommand(galaxy, empire, 'automationOff', [task], () => refreshAll());
        }
    }

    async function disband(list: Troop[]): Promise<void> {
        if (list.length === 0) return;
        if (empire.controlTroopGeneration && opts.confirmAutomationOff && (await opts.confirmAutomationOff(T('Troop Recruitment', 'Troop Recruitment')))) {
            issuePlayerCommand(galaxy, empire, 'setEmpireControl', ['controlTroopGeneration', false]);
        }
        issuePlayerCommand(galaxy, empire, 'disbandTroops', [list], () => {
            selectedTroops = new Set();
            refreshAll();
        });
    }

    // --- Construction Yard tab ----------------------------------------------------------------------------------------
    function renderConstruction(h: Habitat): void {
        const site: ConstructionSite = { kind: 'colony', habitat: h };
        const comps = componentDefinitionsStatic(galaxy);
        const yards = yardRows(site, (id) => comps.find((d) => d.componentId === id)?.name ?? '');
        type YardRow = (typeof yards)[number];
        const yg = new OwGrid<YardRow>({
            columns: [
                { id: 'ship', header: T('Ship', 'Ship'), fill: 192, render: (r, c) => cellText(c, r.ship) },
                { id: 'progress', header: T('Progress', 'Progress'), fill: 70, align: 'right', render: (r, c) => cellText(c, r.ship !== '' ? formatPercent0(r.progress) : '') },
                { id: 'speed', header: T('Speed', 'Speed'), fill: 58, align: 'right', render: (r, c) => cellText(c, String(Math.round(r.speed))) },
            ],
            key: (r) => r,
            rowHeight: 20,
            empty: T('(None)', '(None)'),
        });
        yg.setRows(yards);
        page.appendChild(place(yg.el, 0, 0, 390, 50));
        dropText(page, T('Ships waiting to be constructed', 'Ships waiting to be constructed'), 0, 115, { color: COLORS.gridText });
        const waits = waitRows(site);
        type WaitRow = (typeof waits)[number];
        let selWait: BuiltObject | null = null;
        const wg = new OwGrid<WaitRow>({
            columns: [
                { id: 'name', header: T('Name', 'Name'), fill: 170, render: (r, c) => cellText(c, r.name) },
                { id: 'role', header: T('Role', 'Role'), fill: 150, render: (r, c) => cellText(c, r.type) },
            ],
            key: (r) => r.builtObject,
            rowHeight: 20,
            onSelect: (r) => {
                selWait = r.builtObject;
            },
        });
        wg.setRows(waits);
        page.appendChild(place(wg.el, 0, 135, 390, 136));
        const owned = h.empire === empire;
        const move = (m: 'up' | 'down'): void => {
            if (selWait) issuePlayerCommand(galaxy, empire, 'moveWaitQueueItem', [h, selWait, m], () => renderPage(true));
        };
        page.appendChild(place(glassButton(T('Move Up', 'Move Up'), { onClick: () => move('up'), disabled: !owned }), 395, 135, 110, 25));
        page.appendChild(place(glassButton(T('Move Down', 'Move Down'), { onClick: () => move('down'), disabled: !owned }), 395, 165, 110, 25));
        page.appendChild(place(glassButton(T('Remove Ship', 'Remove Ship'), { disabled: true, title: 'Not available yet' }), 395, 225, 110, 40));
        page.appendChild(place(glassButton(T('Scrap Ship', 'Scrap Ship'), { disabled: true, title: 'Not available yet' }), 190, 54, 200, 22));
        page.appendChild(place(glassButton(T('Show Construction Summary', 'Show Construction Summary'), { onClick: () => opts.onConstructionSummary?.(), disabled: !opts.onConstructionSummary }), 190, 77, 200, 22));
        const lnk = linkLabel(`${T('Learn about Construction', 'Learn about Construction')}...`, () => opts.onHelp?.(T('Construction', 'Construction')));
        lnk.classList.add('col-link-right');
        page.appendChild(place(lnk, 505, 228, 150, 42));
    }

    // --- Docking Bay tab ----------------------------------------------------------------------------------------------
    function renderDocking(h: Habitat): void {
        interface DockRow {
            key: number;
            ship: BuiltObject | null;
        }
        const docked: DockRow[] = (h.dockingBays ?? []).map((b, i) => ({ key: i, ship: b?.dockedShip ?? null }));
        const dg = new OwGrid<DockRow>({
            columns: [{ id: 'ship', header: T('Ship', 'Ship'), fill: 1, render: (r, c) => cellText(c, r.ship ? `${r.ship.name}${r.ship.empire ? ` (${(r.ship.empire as Empire).name})` : ''}` : '') }],
            key: (r) => r.key,
            rowHeight: 20,
            empty: T('(None)', '(None)'),
        });
        dg.setRows(docked);
        page.appendChild(place(dg.el, 0, 0, 658, 70));
        dropText(page, T('Ships waiting to dock', 'Ships waiting to dock'), 0, 75, { color: COLORS.gridText });
        const wg = new OwGrid<BuiltObject>({
            columns: [
                { id: 'name', header: T('Name', 'Name'), fill: 210, render: (r, c) => cellText(c, r.name) },
                { id: 'empire', header: T('Empire', 'Empire'), fill: 200, render: (r, c) => cellText(c, (r.empire as Empire | null)?.name ?? '') },
            ],
            key: (r) => r,
            rowHeight: 20,
        });
        wg.setRows((h.dockingBayWaitQueue ?? []).filter((b) => b != null));
        page.appendChild(place(wg.el, 0, 95, 658, 176));
    }

    // --- Facilities tab (ctlColonyFacilities + cmbColonyFacilitiesToBuild) --------------------------------------------
    let facilityChoice = '';
    let selectedFacility: PlanetaryFacility | null = null;
    function renderFacilities(h: Habitat): void {
        const box = scrollPanel('col-icons');
        page.appendChild(place(box, 0, 0, 450, 271));
        const facilities = h.facilities ?? [];
        if (selectedFacility !== null && !facilities.includes(selectedFacility)) selectedFacility = null;
        for (const f of facilities) {
            if (!f) continue;
            const t = el('div', `col-icon col-fac${f.constructionProgress < 1 ? ' col-fac-building' : ''}${selectedFacility === f ? ' col-icon-sel' : ''}`);
            t.addEventListener('click', () => {
                selectedFacility = selectedFacility === f ? null : f;
                renderPage(true);
            });
            t.appendChild(img(facilityImageUrl(f.def.pictureRef), 'col-icon-img'));
            t.appendChild(el('div', 'col-icon-label', f.name));
            let tip = '';
            if (f.constructionProgress < 1) tip = `${formatPercent0(f.constructionProgress).replace('%', '')}% ${T('Complete', 'Complete').toLowerCase()}`;
            if (f.maintenance > 0) tip += `${tip ? '\n' : ''}${T('Facility Maintenance Cost', 'Maintenance')}: ${formatMoney(f.maintenance)} ${T('credits', 'credits')}${f.constructionProgress < 1 ? ` (${T('when completed', 'when completed')})` : ''}`;
            t.title = tip ? `${f.name}\n${tip}` : f.name;
            box.appendChild(t);
        }
        const defs = h.empire === empire || empire.pirateEmpireBaseHabitat !== null ? buildableFacilities(galaxy, empire, h) : [];
        const dd = dropDown(
            defs.map((d) => ({ value: String(d.facilityId), label: `${d.name} (${formatMoney(calculatePlanetaryFacilityCost(d, empire))})` })),
            defs.some((d) => String(d.facilityId) === facilityChoice) ? facilityChoice : String(defs[0]?.facilityId ?? ''),
            (v) => {
                facilityChoice = v;
            },
        );
        dd.disabled = defs.length === 0;
        page.appendChild(place(dd, 460, 10, 190, 21));
        const buildBtn = glassButton(T('Build Facility', 'Build Facility'), {
            disabled: defs.length === 0,
            onClick: () => {
                const def = defs.find((d) => String(d.facilityId) === dd.value);
                if (!def) return;
                if (empire.stateMoney < calculatePlanetaryFacilityCost(def, empire)) {
                    void messageBox({ caption: T('Build Facility', 'Build Facility'), text: T('Insufficient funds', 'You do not have enough money to build this facility.'), icon: 'warning' });
                    return;
                }
                issuePlayerCommand(galaxy, empire, 'shipAction', [h, createShipAction(ShipActionType.BuildPlanetaryFacility, def), false], () => refreshAll());
            },
        });
        page.appendChild(place(buildBtn, 460, 38, 190, 25));
        // ctlColonyFacilities_SelectedIndexChanged: "Scrap" for the colony owner's facility, "Attack" for a pirate
        // faction's (disabled unless CheckCanInitiateAttackAgainstPirateFacilities).
        const fIndex = selectedFacility === null ? -1 : facilities.indexOf(selectedFacility);
        const fac = fIndex >= 0 ? facilities[fIndex] : null;
        const ownedByColony = fac !== null && checkFacilityOwnedByColonyOwner(galaxy, h, fIndex);
        const canAct = fac !== null && h.empire === empire && (ownedByColony || checkCanInitiateAttackAgainstPirateFacilities(galaxy, h, empire, fac));
        const scrapBtn = glassButton(fac === null ? T('Scrap Facility', 'Scrap Facility') : ownedByColony ? T('Scrap', 'Scrap') : T('Attack', 'Attack'), {
            disabled: !canAct,
            onClick: () => {
                if (fac === null) return;
                const run = (): void => issuePlayerCommand(galaxy, empire, 'scrapColonyFacility', [h, fIndex, fac.planetaryFacilityDefinitionId], () => {
                    selectedFacility = null;
                    refreshAll();
                });
                if (!ownedByColony) {
                    run();
                    return;
                }
                void messageBox({
                    caption: T('Scrap Facility', 'Scrap Facility'),
                    text: `Are you sure that you want to scrap the ${fac.name} at your colony ${h.name}?`,
                    buttons: ['Yes', 'No'],
                    icon: 'question',
                }).then((b) => {
                    if (b === 'Yes') run();
                });
            },
        });
        page.appendChild(place(scrapBtn, 460, 84, 190, 25));
    }

    function refreshAll(): void {
        if (win.closed) return;
        refreshGrid();
        refreshDetail(false);
    }

    state = {
        close: () => {
            win.close();
        },
    };
    refreshGrid();
    refreshDetail(true);
    if (selected) grid.select(selected, true);
    timer = window.setInterval(refreshAll, opts.refreshMs ?? 1000);
    return state;
}

function cellText(cell: HTMLElement, s: string, cls = ''): void {
    const span = el('span', `col-ellipsis${cls ? ` ${cls}` : ''}`, s);
    cell.appendChild(span);
    if (!cell.title) cell.title = s;
}
