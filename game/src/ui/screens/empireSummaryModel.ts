// Pure data for the Empire Summary screen (empireSummary.ts): the figures and strings the original's four summary
// controls draw, without any DOM. Sources (DistantWorlds/Controls/):
// - EmpireSummaryColony.cs method_3 (empire stats + rankings, government attributes, the new-government preview) and
//   method_2 (the pirate faction branch);
// - EmpireSummaryBuiltObject.cs method_2..method_7 (Ships & Bases: count / firepower / maintenance per sub-role);
// - EmpireSummaryBonuses.cs DrawBonuses (race ability bonuses, ruin / wonder special bonuses, the leader's bonuses);
// - DistantWorlds.Types: Galaxy.cs 2114 ResolveWarWearinessDescription, 2234.. ResolveEmpireAbilityBonusDescription*,
//   Galaxy.5.cs 3304 OrderedNumberDescription / 3331 DetermineOrderedKnownEmpires, Galaxy.2.cs 3597
//   GenerateLeaderBonusDescription, Galaxy.6.cs 2778 IdentifyWonderHabitat / 2802 IdentifyRuinHabitat, Galaxy.8.cs
//   4303 ResolvePirateFactionModifierDescriptions, Empire.cs 2834 ResolveEmpireAbilityBonusDescriptions.
// Read-only: nothing here changes the sim.

import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Habitat } from '../../sim/types';
import type { Government } from '../../sim/data/governments';
import type { Race } from '../../sim/data/races';
import type { BuiltObject } from '../../sim/builtObject';
import type { Character } from '../../sim/characters';
import { CharacterRole, CharacterSkillType, countCharactersByRole } from '../../sim/characters';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { BUILT_OBJECT_SUB_ROLE, CHARACTER_ROLE, CHARACTER_SKILL, resolveEnumTextDescription } from '../../sim/enumText';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import { empireWarWeariness } from '../../sim/taxes';
import { totalColonyStrategicValue } from '../../sim/forceStructure';
import { civilityDescription } from '../../sim/empireRelationshipFactors';
import { PiratePlayStyle, pirateFactionModifiers } from '../../sim/pirates';
import { comparisonValue, knownEmpires, rankDescending, type ComparisonKind } from './empireComparison';
import { formatK, formatM, formatSignedPercent, gt } from './researchBenefits';

// -------------------------------------------------------------------------------------------------------------------
// Colours (the controls' SolidBrushes)
// -------------------------------------------------------------------------------------------------------------------

export const SUMMARY_COLORS = {
    /** solidBrush_0 (170, 170, 170): every label and value. */
    text: 'rgb(170, 170, 170)',
    /** Color.Red. */
    red: 'rgb(255, 0, 0)',
    /** Color.Green (0, 128, 0). */
    green: 'rgb(0, 128, 0)',
} as const;

// -------------------------------------------------------------------------------------------------------------------
// Number / text formats
// -------------------------------------------------------------------------------------------------------------------

const roundAway = (x: number): number => Math.sign(x) * Math.round(Math.abs(x)) + 0;

/** `v.ToString("+#0%;-#0%;" + GetText("Normal"))`: a signed percentage, "Normal" when it rounds to zero. */
export function percentOrNormal(v: number): string {
    const r = roundAway(v * 100);
    if (r === 0) return gt('Normal');
    return r < 0 ? `-${-r}%` : `+${r}%`;
}

/** `v.ToString("0%")`. */
export function percent0(v: number): string {
    return `${roundAway(v * 100)}%`;
}

/** `v.ToString("0")`. */
export function format0(v: number): string {
    return String(roundAway(v));
}

/** Galaxy.5.cs 3304 OrderedNumberDescription: 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function orderedNumberDescription(n: number): string {
    const s = String(n);
    switch (s.charAt(s.length - 1)) {
        case '1':
            return n % 100 !== 11 ? `${s}st` : `${s}th`;
        case '2':
            return n % 100 !== 12 ? `${s}nd` : `${s}th`;
        case '3':
            return n % 100 !== 13 ? `${s}rd` : `${s}th`;
        default:
            return `${s}th`;
    }
}

/** "(" + string.Format(GetText("Xth of Y"), OrderedNumberDescription(index + 1), count) + ")". */
export function rankText(index: number, count: number): string {
    return `(${gt('Xth of Y', orderedNumberDescription(index + 1), count)})`;
}

/** Galaxy.cs 2114 ResolveWarWearinessDescription. */
export function warWearinessDescription(v: number): string {
    if (v <= 0) return gt('None');
    if (v <= 6) return gt('Mild');
    if (v <= 12) return gt('Tolerable');
    if (v <= 18) return gt('Significant');
    if (v <= 26) return gt('Serious');
    if (v <= 34) return gt('Critical');
    return gt('Rampant');
}

/** EmpireSummaryColony.cs method_3: the war-weariness value's colour, yellow through red. */
export function warWearinessColor(v: number): string {
    if (v <= 0) return SUMMARY_COLORS.text;
    if (v <= 6) return 'rgb(255, 255, 0)';
    if (v <= 12) return 'rgb(255, 205, 0)';
    if (v <= 18) return 'rgb(255, 155, 0)';
    if (v <= 26) return 'rgb(255, 105, 0)';
    if (v <= 34) return 'rgb(255, 55, 0)';
    return 'rgb(255, 0, 0)';
}

/** EmpireSummaryColony.cs method_5(value, higherIsGood): grey at 0, else green for a good change and red for a bad one. */
export function modifierColor(v: number, higherIsGood: boolean): string {
    if (v < 0) return higherIsGood ? SUMMARY_COLORS.red : SUMMARY_COLORS.green;
    if (v > 0) return higherIsGood ? SUMMARY_COLORS.green : SUMMARY_COLORS.red;
    return SUMMARY_COLORS.text;
}

/** EmpireSummaryEconomy.cs method_7: red when negative. */
export function negativeColor(v: number): string {
    return v < 0 ? SUMMARY_COLORS.red : SUMMARY_COLORS.text;
}

// -------------------------------------------------------------------------------------------------------------------
// EmpireSummaryColony (method_3)
// -------------------------------------------------------------------------------------------------------------------

export interface StatRow {
    label: string;
    value: string;
    color?: string;
    /** The "(Xth of Y)" ranking drawn after the value (normal font). */
    rank?: string;
}

/** DetermineOrderedKnownEmpires(empire, type).IndexOf(empire): the empire's 0-based place among the empires it knows,
 *  with the count (null when it is not in the list). */
export function knownEmpireRank(galaxy: Galaxy, empire: Empire, kind: ComparisonKind): { index: number; count: number } | null {
    const ranked = rankDescending(knownEmpires(empire).map((e) => ({ item: e, value: comparisonValue(galaxy, e, kind) })));
    const i = ranked.findIndex((r) => r.item === empire);
    return i < 0 ? null : { index: i, count: ranked.length };
}

/** Number of distinct systems (DetermineHabitatSystemStar) the colonies are in. */
export function colonySystemCount(galaxy: Galaxy, colonies: readonly Habitat[]): number {
    const set = new Set<unknown>();
    for (const c of colonies) set.add(galaxy.determineHabitatSystemStar(c) ?? c);
    return set.size;
}

/** The Troops row: the empire's troops plus those still recruiting at its colonies (each once). */
export function troopCount(empire: Empire): number {
    const seen = new Set<unknown>(empire.troops.items);
    for (const c of empire.colonies) {
        for (const t of c.troopsToRecruit?.items ?? []) if (t != null) seen.add(t);
    }
    return seen.size;
}

/** Wars the empire is fighting (DiplomaticRelationType.War). */
export function warCount(empire: Empire): number {
    let n = 0;
    for (const r of empire.diplomaticRelations) if (r.type === DiplomaticRelationType.War) n++;
    return n;
}

/** The eight stat rows at the top of EmpireSummaryColony.method_3, in order. */
export function colonyStatRows(galaxy: Galaxy, empire: Empire): StatRow[] {
    const rank = (kind: ComparisonKind): string | undefined => {
        const r = knownEmpireRank(galaxy, empire, kind);
        return r === null ? undefined : rankText(r.index, r.count);
    };
    const ww = empireWarWeariness(empire);
    const wars = warCount(empire);
    let wwText = warWearinessDescription(ww);
    if (wars > 0) wwText += ` (${gt('At war with').toLowerCase()} ${wars} ${gt('empires')})`;
    return [
        { label: gt('Capitals'), value: empire.capitals.map((h) => h.name).join(', ') },
        { label: gt('Territory'), value: gt('X colonies in Y systems', empire.colonies.length, colonySystemCount(galaxy, empire.colonies)), rank: rank('territory') },
        { label: gt('Population'), value: formatM(empire.totalPopulation), rank: rank('population') },
        { label: gt('Strategic Value'), value: formatK(totalColonyStrategicValue(empire)), rank: rank('strategicValue') },
        { label: gt('Reputation'), value: gt(civilityDescription(empire.civilityRating)), color: empire.civilityRating < 0 ? SUMMARY_COLORS.red : SUMMARY_COLORS.green },
        { label: gt('War weariness'), value: wwText, color: warWearinessColor(ww) },
        { label: gt('Troops'), value: String(troopCount(empire)) },
        { label: gt('Intelligence Agents'), value: String(countCharactersByRole(empire.characters as Character[], CharacterRole.IntelligenceAgent)) },
    ];
}

export interface GovernmentRow {
    label: string;
    value: string;
    color: string;
}

/** The government attribute rows (EmpireSummaryColony.cs method_3, also the preview column for another government). */
export function governmentRows(g: Government): GovernmentRow[] {
    const row = (label: string, factor: number, higherIsGood: boolean): GovernmentRow => ({
        label: gt(label),
        value: percentOrNormal(factor - 1),
        color: modifierColor(factor - 1, higherIsGood),
    });
    return [
        row('War weariness', g.warWeariness, false),
        row('Maintenance costs', g.maintenanceCosts, false),
        row('Approval', g.approvalRating, true),
        row('Growth rate', g.populationGrowth, true),
        row('Research speed', g.researchSpeed, true),
        row('Troop recruitment', g.troopRecruitment, true),
        row('Corruption', g.corruption, false),
        row('Colony Income', g.tradeBonus, true),
    ];
}

/** Main.Part4.cs cmbEmpireSummaryChangeGovernmentType_SelectedIndexChanged: the revolution button's text and state for
 *  a selected government id (-1 = "(Select government...)"). */
export function revolutionButtonState(empire: Empire, governmentId: number, governmentName: string | null): { text: string; enabled: boolean } {
    let out: { text: string; enabled: boolean };
    if (governmentId !== empire.governmentId && governmentId !== -1) out = { text: gt('Have Revolution and switch to GOVERNMENT', governmentName ?? ''), enabled: true };
    else out = { text: gt('Have Revolution and switch government'), enabled: false };
    const race = empire.dominantRace as Race | null;
    if (race !== null && race.canChangeGovernment === false) out = { text: `(${gt('Race cannot change government', race.name)})`, enabled: false };
    return out;
}

// -------------------------------------------------------------------------------------------------------------------
// EmpireSummaryColony (method_2): pirate factions
// -------------------------------------------------------------------------------------------------------------------

export interface PirateModifierLine {
    text: string;
    color: string;
}

/** Galaxy.2.cs ResolveDescription(PiratePlayStyle). */
export function piratePlayStyleDescription(style: PiratePlayStyle): string {
    switch (style) {
        case PiratePlayStyle.Balanced: return gt('PiratePlayStyle Balanced');
        case PiratePlayStyle.Pirate: return gt('PiratePlayStyle Pirate');
        case PiratePlayStyle.Mercenary: return gt('PiratePlayStyle Mercenary');
        case PiratePlayStyle.Smuggler: return gt('PiratePlayStyle Smuggler');
        default: return gt('None');
    }
}

/** Galaxy.8.cs 4303 ResolvePirateFactionModifierDescriptions, coloured as EmpireSummaryColony.method_2 draws them. */
export function pirateModifierLines(style: PiratePlayStyle): PirateModifierLine[] {
    const m = pirateFactionModifiers(style);
    const entries: [string, number, boolean][] = [
        ['Pirate Bonus Modifier Smuggling Income', m.smugglingIncomeFactor, true],
        ['Pirate Bonus Modifier Raid Strength', m.raidStrengthFactor, true],
        ['Pirate Bonus Modifier Raid Bonuses', m.raidBonusFactor, true],
        ['Pirate Bonus Modifier Looting Bonuses', m.lootingFactor, true],
        ['Pirate Bonus Modifier Ship Maintenance State', m.shipMaintenanceStateFactor, false],
        ['Pirate Bonus Modifier Ship Maintenance Private', m.shipMaintenancePrivateFactor, false],
        ['Pirate Bonus Modifier Research Weapons', m.researchWeaponsFactor, true],
        ['Pirate Bonus Modifier Research Energy', m.researchEnergyFactor, true],
        ['Pirate Bonus Modifier Research HighTech', m.researchHighTechFactor, true],
        ['Pirate Bonus Modifier Facility Build', m.planetaryFacilityBuildFactor, false],
        ['Pirate Bonus Modifier Wonder Build', m.planetaryWonderBuildFactor, false],
        ['Pirate Bonus Modifier Facility Elimination', m.planetaryFacilityEliminationFactor, true],
    ];
    const out: PirateModifierLine[] = [];
    for (const [tag, f, bonus] of entries) {
        if (f === 1.0) continue;
        const good = bonus ? f > 1.0 : f < 1.0;
        out.push({ text: `${gt(tag)}: ${formatSignedPercent(f - 1.0)}`, color: good ? SUMMARY_COLORS.green : SUMMARY_COLORS.red });
    }
    return out;
}

// -------------------------------------------------------------------------------------------------------------------
// EmpireSummaryBuiltObject
// -------------------------------------------------------------------------------------------------------------------

export interface ShipRoleStats {
    count: number;
    firepower: number;
    maintenance: number;
}

/** method_4 / method_7: count every object; firepower (FirepowerRaw) and maintenance (AnnualSupportCost) of the
 *  completed ones; maintenance less the empire's ShipMaintenanceSavings share (truncated). */
export function shipRoleStats(list: readonly BuiltObject[], subRoles: readonly BuiltObjectSubRole[] | null, shipMaintenanceSavings: number): ShipRoleStats {
    let count = 0;
    let firepower = 0;
    let maintenance = 0;
    for (const b of list) {
        if (b == null) continue;
        if (subRoles !== null && !subRoles.includes(b.subRole)) continue;
        count++;
        if (b.unbuiltComponentCount <= 0) {
            firepower += b.firepowerRaw;
            maintenance += Math.trunc(b.annualSupportCost);
        }
    }
    maintenance -= Math.trunc(maintenance * shipMaintenanceSavings);
    return { count, firepower, maintenance };
}

/** Firepower: plain below 100,000, else "0,K". */
export function formatFirepower(n: number): string {
    return n >= 100000 ? formatK(n) : String(n);
}

export type ShipRowSpec = { gapBefore?: boolean; roles: BuiltObjectSubRole[]; label?: string };

const S = BuiltObjectSubRole;

/** method_2's three columns: the sub-roles of each row (a gap of num2 = 8 px before a new group). */
export const SHIP_COLUMNS: { title: string; military: boolean; privateList: boolean; rows: ShipRowSpec[] }[] = [
    {
        title: 'Ship Role Military',
        military: true,
        privateList: false,
        rows: [
            { roles: [S.Escort] }, { roles: [S.Frigate] }, { roles: [S.Destroyer] }, { roles: [S.Cruiser] }, { roles: [S.CapitalShip] },
            { gapBefore: true, roles: [S.TroopTransport] }, { roles: [S.Carrier] }, { roles: [S.ResupplyShip] },
        ],
    },
    {
        title: 'Other State',
        military: false,
        privateList: false,
        rows: [
            { roles: [S.ExplorationShip] }, { roles: [S.ConstructionShip] }, { roles: [S.ColonyShip] },
            { gapBefore: true, roles: [S.SmallSpacePort] }, { roles: [S.MediumSpacePort] }, { roles: [S.LargeSpacePort] },
            { gapBefore: true, roles: [S.DefensiveBase] },
            { roles: [S.EnergyResearchStation, S.HighTechResearchStation, S.WeaponsResearchStation], label: 'Research Station' },
            { roles: [S.ResortBase] },
            { roles: [S.GenericBase, S.MonitoringStation], label: 'Other Bases' },
        ],
    },
    {
        title: 'PRIVATE',
        military: false,
        privateList: true,
        rows: [
            { roles: [S.SmallFreighter] }, { roles: [S.MediumFreighter] }, { roles: [S.LargeFreighter] },
            { gapBefore: true, roles: [S.PassengerShip] },
            { gapBefore: true, roles: [S.MiningShip] }, { roles: [S.GasMiningShip] },
            { gapBefore: true, roles: [S.MiningStation] }, { roles: [S.GasMiningStation] },
        ],
    },
];

/** method_7's row label: the explicit one, else ResolveDescription(subRole) ("Other Bases" for several). */
export function shipRowLabel(spec: ShipRowSpec): string {
    if (spec.label !== undefined) return gt(spec.label);
    if (spec.roles.length > 1) return gt('Other Bases');
    return resolveEnumTextDescription(BUILT_OBJECT_SUB_ROLE, BuiltObjectSubRole[spec.roles[0]]);
}

// -------------------------------------------------------------------------------------------------------------------
// EmpireSummaryBonuses
// -------------------------------------------------------------------------------------------------------------------

export interface BonusLine {
    text: string;
    /** The 15 × 15 picture left of the text. */
    image: { kind: 'race'; pictureIndex: number } | { kind: 'ruin'; pictureRef: number } | { kind: 'facility'; pictureRef: number } | { kind: 'character'; file: string } | null;
}

/** Empire.cs 2834 ResolveEmpireAbilityBonusDescriptions(includeDominantRaceInDescriptions, out bonusRaces). */
export function abilityBonusLines(e: Empire, includeDominantRace: boolean): BonusLine[] {
    const out: BonusLine[] = [];
    const add = (value: number, race: Race | null, tag: string, sign: '+' | '-'): void => {
        if (!(value > 0)) return;
        let text = gt(tag, sign + percent0(value));
        if (race !== null && (includeDominantRace || race !== e.dominantRace)) text += ` (${gt('BONUS from RACE', race.name)})`;
        out.push({ text, image: race !== null ? { kind: 'race', pictureIndex: race.pictureIndex } : null });
    };
    add(e.shipMaintenanceSavings, e.shipMaintenanceSavingsRace, 'Ship Maintenance Ability Bonus', '-');
    add(e.resourceExtractionBonus, e.resourceExtractionBonusRace, 'Resource Extraction Ability Bonus', '+');
    add(e.researchBonus, e.researchBonusRace, 'Research Ability Bonus', '+');
    add(e.espionageBonus, e.espionageBonusRace, 'Espionage Ability Bonus', '+');
    add(e.tradeBonus, e.tradeBonusRace, 'Trade Ability Bonus', '+');
    return out;
}

/** A wonder as the empire's SpecialBonus*Wonder fields hold it (a PlanetaryFacility). */
interface WonderLike {
    name?: string;
    pictureRef?: number;
    wonderType?: unknown;
    type?: unknown;
}

/** Galaxy.6.cs 2802 IdentifyRuinHabitat. */
export function identifyRuinHabitat(galaxy: Galaxy, ruin: unknown): Habitat | null {
    for (const h of galaxy.ruinsHabitats) if (h.ruin !== null && h.ruin === ruin) return h;
    return null;
}

/** Galaxy.6.cs 2778 IdentifyWonderHabitat: the empire colony with a completed wonder of the same WonderType. */
export function identifyWonderHabitat(empire: Empire, wonder: WonderLike): Habitat | null {
    for (const h of empire.colonies) {
        if (h == null || h.hasBeenDestroyed || h.facilities == null) continue;
        for (const f of h.facilities) {
            const pf = f as unknown as { constructionProgress?: number; wonderType?: unknown; type?: unknown };
            if (pf == null) continue;
            if ((pf.constructionProgress ?? 0) >= 1 && pf.wonderType !== undefined && pf.wonderType === wonder.wonderType && (pf.type === wonder.type || wonder.type === undefined)) return h;
        }
    }
    return null;
}

/** EmpireSummaryBonuses.cs method_1: "+20% bonus in Wealth" / "… from RUIN at PLANET in the STAR system". */
export function specialBonusText(galaxy: Galaxy, empire: Empire, value: number, label: string, ruin: { name: string } | null, wonder: WonderLike | null): string {
    if (!(value > 0)) return '';
    const v = `+${percent0(value)}`;
    let result = gt('Ruins Bonus Description', v, label);
    if (ruin !== null) {
        const h = identifyRuinHabitat(galaxy, ruin);
        if (h !== null) result = gt('Ruins Bonus Description Ruins', v, label, ruin.name, h.name, galaxy.determineHabitatSystemStar(h)?.name ?? '');
    } else if (wonder !== null) {
        const h = identifyWonderHabitat(empire, wonder);
        if (h !== null) result = gt('Ruins Bonus Description Ruins', v, label, wonder.name ?? '', h.name, galaxy.determineHabitatSystemStar(h)?.name ?? '');
    }
    return result;
}

/** Galaxy.2.cs 3597 GenerateLeaderBonusDescription. */
export function leaderBonusDescription(leader: Character | null): string {
    if (leader === null) return '';
    let text = '';
    if (leader.bonusesKnown) {
        const skills: [CharacterSkillType, number][] = [
            [CharacterSkillType.Diplomacy, leader.diplomacy],
            [CharacterSkillType.ColonyIncome, leader.colonyIncome],
            [CharacterSkillType.ColonyHappiness, leader.colonyHappiness],
            [CharacterSkillType.PopulationGrowth, leader.populationGrowth],
            [CharacterSkillType.TradeIncome, leader.tradeIncome],
            [CharacterSkillType.TourismIncome, leader.tourismIncome],
            [CharacterSkillType.ColonyCorruption, leader.colonyCorruption],
            [CharacterSkillType.MiningRate, leader.miningRate],
            [CharacterSkillType.TroopRecruitment, leader.troopRecruitmentRate],
            [CharacterSkillType.MilitaryShipConstructionSpeed, leader.militaryShipConstructionSpeed],
            [CharacterSkillType.CivilianShipConstructionSpeed, leader.civilianShipConstructionSpeed],
            [CharacterSkillType.ColonyShipConstructionSpeed, leader.colonyShipConstructionSpeed],
            [CharacterSkillType.FacilityConstructionSpeed, leader.facilityConstructionSpeed],
            [CharacterSkillType.ResearchEnergy, leader.researchEnergy],
            [CharacterSkillType.ResearchHighTech, leader.researchHighTech],
            [CharacterSkillType.ResearchWeapons, leader.researchWeapons],
            [CharacterSkillType.Espionage, leader.espionage],
            [CharacterSkillType.CounterEspionage, leader.counterEspionage],
            [CharacterSkillType.MilitaryShipMaintenance, leader.militaryShipMaintenance],
            [CharacterSkillType.MilitaryBaseMaintenance, leader.militaryBaseMaintenance],
            [CharacterSkillType.CivilianShipMaintenance, leader.civilianShipMaintenance],
            [CharacterSkillType.CivilianBaseMaintenance, leader.civilianBaseMaintenance],
            [CharacterSkillType.TroopMaintenance, leader.troopMaintenance],
            [CharacterSkillType.WarWeariness, leader.warWeariness],
        ];
        for (const [type, value] of skills) {
            if (value !== 0) text += `${resolveEnumTextDescription(CHARACTER_SKILL, CharacterSkillType[type])} ${formatSignedPercent(value / 100)}, `;
        }
        if (text.length >= 2) text = text.substring(0, text.length - 2);
    } else {
        text = '?';
    }
    if (text !== '') text = `${resolveEnumTextDescription(CHARACTER_ROLE, CharacterRole[CharacterRole.Leader])} ${leader.name}: ${text}`;
    return text;
}

/** DrawBonuses: every line of the Bonuses panel, in order. */
export function bonusLines(galaxy: Galaxy, e: Empire): BonusLine[] {
    const out = abilityBonusLines(e, true);
    const special = (value: number, label: string, ruin: { name: string; pictureRef: number } | null, wonder: unknown): void => {
        const w = (wonder ?? null) as WonderLike | null;
        const text = specialBonusText(galaxy, e, value, gt(label), ruin, w);
        if (text === '') return;
        const image: BonusLine['image'] = ruin !== null ? { kind: 'ruin', pictureRef: ruin.pictureRef } : w !== null && w.pictureRef !== undefined ? { kind: 'facility', pictureRef: w.pictureRef } : null;
        out.push({ text, image });
    };
    special(e.specialBonusWealth, 'Wealth', e.specialBonusWealthRuin, e.specialBonusWealthWonder);
    special(e.specialBonusHappiness, 'Happiness', e.specialBonusHappinessRuin, e.specialBonusHappinessWonder);
    special(e.specialBonusDiplomacy, 'Diplomacy', e.specialBonusDiplomacyRuin, null);
    special(e.specialBonusResearchEnergy, 'Energy Research', e.specialBonusResearchEnergyRuin, e.specialBonusResearchEnergyWonder);
    special(e.specialBonusResearchHighTech, 'HighTech Research', e.specialBonusResearchHighTechRuin, e.specialBonusResearchHighTechWonder);
    special(e.specialBonusResearchWeapons, 'Weapons Research', e.specialBonusResearchWeaponsRuin, e.specialBonusResearchWeaponsWonder);
    special(e.specialBonusPopulationGrowth, 'Population Growth', null, e.specialBonusPopulationGrowthWonder);
    // TODO(port): the pirate research bonus from bases / fortresses (CalculatePirateResearchBonusFromFacilities) —
    // EmpireSummaryBonuses.cs DrawBonuses.
    const leader = (e.leader ?? null) as Character | null;
    const desc = leaderBonusDescription(leader);
    if (desc !== '') out.push({ text: desc, image: leader !== null && leader.pictureFilename ? { kind: 'character', file: leader.pictureFilename } : null });
    return out;
}
