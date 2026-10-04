// Selection panel "Bonuses" text for built objects and fleets. Pure reads of the sim.
// Port of Galaxy.2.cs 4084 GenerateCharacterBonusDescription(ShipGroup) and 4152 GenerateCharacterBonusDescription(
// BuiltObject); drawn by BaconInfoPanel.cs 777 (DrawBuiltObject) / 1067 (DrawShipGroup) when InfoPanel.ShowExtendedInfo.

import type { BuiltObject } from '../sim/builtObject';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import {
    CharacterRole, CharacterSkillType, captainBonuses, getHighestSkillLevel, getHighestSkillLevelExcludeLeaders,
    getHighestSkillLevelExcludeRoles, stellarObjectCharacters, type Character,
} from '../sim/characters';
import { CHARACTER_ROLE, CHARACTER_SKILL, resolveEnumTextDescription } from '../sim/enumText';

/** .NET `double.ToString("+0%;-0%")`: rounded half away from zero, "+" for zero and up. */
export function fmtPlusMinusPct(v: number): string {
    const p = v * 100;
    const r = Math.sign(p) * Math.round(Math.abs(p));
    return r < 0 ? `-${-r}%` : `+${r}%`;
}

const skill = (t: CharacterSkillType): string => resolveEnumTextDescription(CHARACTER_SKILL, CharacterSkillType[t]);
const role = (r: CharacterRole): string => resolveEnumTextDescription(CHARACTER_ROLE, CharacterRole[r]);

/** The ShipGroup overload: the admiral bonuses of the fleet, "+10% Targeting, +5% Weapons Damage". */
export function shipGroupCharacterBonusDescription(fleet: ShipGroup | null): string {
    let text = '';
    if (fleet === null) return text;
    const parts: [number, CharacterSkillType][] = [
        [fleet.targetingBonus, CharacterSkillType.Targeting],
        [fleet.countermeasuresBonus, CharacterSkillType.Countermeasures],
        [fleet.shipManeuveringBonus, CharacterSkillType.ShipManeuvering],
        [fleet.fightersBonus, CharacterSkillType.Fighters],
        [fleet.shipEnergyUsageBonus, CharacterSkillType.ShipEnergyUsage],
        [fleet.weaponsDamageBonus, CharacterSkillType.WeaponsDamage],
        [fleet.weaponsRangeBonus, CharacterSkillType.WeaponsRange],
        [fleet.shieldRechargeRateBonus, CharacterSkillType.ShieldRechargeRate],
        [fleet.damageControlBonus, CharacterSkillType.DamageControl],
        [fleet.repairBonus, CharacterSkillType.RepairBonus],
        [fleet.hyperjumpSpeedBonus, CharacterSkillType.HyperjumpSpeed],
    ];
    for (const [v, t] of parts) if (v !== 1.0) text += `${fmtPlusMinusPct(v - 1.0)} ${skill(t)}, `;
    if (text !== '' && text.length >= 2) text = text.substring(0, text.length - 2);
    return text;
}

/** The BuiltObject overload. */
export function builtObjectCharacterBonusDescription(bo: BuiltObject | null): string {
    let text = '';
    if (bo === null) return text;
    const rolesToExclude = [CharacterRole.Leader, CharacterRole.Ambassador];
    let flag = false; // Leader
    let flag2 = false; // ColonyGovernor
    let flag3 = false; // Scientist
    let flag4 = false; // FleetAdmiral
    let flag5 = false; // ShipCaptain
    const empire = bo.empire;
    const leader = empire !== null ? empire.leader : null;
    const own = (bo.characters ?? []) as Character[];
    // builtObject.Characters + the parent colony's characters when it is the same empire.
    const withColony = (): Character[] => {
        const list: Character[] = [...own];
        const ph = bo.parentHabitat;
        if (ph !== null && ph.empire === bo.empire) {
            const pc = stellarObjectCharacters(ph);
            if (pc !== null && pc.length > 0) list.push(...pc);
        }
        return list;
    };
    // The mining / trade / tourism lines share one shape.
    const incomeLine = (type: CharacterSkillType, leaderValue: number | null): void => {
        let num = 0;
        const list = withColony();
        if (list.length > 0) {
            num = getHighestSkillLevelExcludeRoles(list, type, rolesToExclude);
            if (num !== 0) flag2 = true;
        }
        if (leader !== null && leaderValue !== null && leaderValue !== 0) {
            num += leaderValue;
            flag = true;
        }
        if (num !== 0) text += `${fmtPlusMinusPct(num / 100.0)} ${skill(type)}, `;
    };
    if (bo.isResourceExtractor) incomeLine(CharacterSkillType.MiningRate, leader?.miningRate ?? null);
    if (bo.isSpacePort) incomeLine(CharacterSkillType.TradeIncome, leader?.tradeIncome ?? null);
    if (bo.subRole === BuiltObjectSubRole.ResortBase) incomeLine(CharacterSkillType.TourismIncome, leader?.tourismIncome ?? null);
    if (bo.researchEnergy > 0 || bo.researchHighTech > 0 || bo.researchWeapons > 0) {
        let num4 = 0;
        let num5 = 0;
        let num6 = 0;
        if (own.length > 0) {
            num4 = getHighestSkillLevelExcludeLeaders(own, CharacterSkillType.ResearchEnergy);
            num5 = getHighestSkillLevelExcludeLeaders(own, CharacterSkillType.ResearchHighTech);
            num6 = getHighestSkillLevelExcludeLeaders(own, CharacterSkillType.ResearchWeapons);
            if (num4 !== 0 || num5 !== 0 || num6 !== 0) flag3 = true;
        }
        if (leader !== null) {
            if (leader.researchEnergy !== 0) { num4 += leader.researchEnergy; flag = true; }
            if (leader.researchHighTech !== 0) { num5 += leader.researchHighTech; flag = true; }
            if (leader.researchWeapons !== 0) { num6 += leader.researchWeapons; flag = true; }
        }
        if (num4 !== 0) text += `${fmtPlusMinusPct(num4 / 100.0)} ${skill(CharacterSkillType.ResearchEnergy)}, `;
        if (num5 !== 0) text += `${fmtPlusMinusPct(num5 / 100.0)} ${skill(CharacterSkillType.ResearchHighTech)}, `;
        if (num6 !== 0) text += `${fmtPlusMinusPct(num6 / 100.0)} ${skill(CharacterSkillType.ResearchWeapons)}, `;
    }
    if (bo.role === BuiltObjectRole.Base) {
        let num7 = 0;
        let num8 = 0;
        const list = withColony();
        if (list.length > 0) {
            switch (bo.subRole) {
                case BuiltObjectSubRole.SmallSpacePort:
                case BuiltObjectSubRole.MediumSpacePort:
                case BuiltObjectSubRole.LargeSpacePort:
                case BuiltObjectSubRole.DefensiveBase:
                    num7 = getHighestSkillLevelExcludeLeaders(list, CharacterSkillType.MilitaryBaseMaintenance);
                    break;
                default:
                    num8 = getHighestSkillLevelExcludeLeaders(list, CharacterSkillType.CivilianBaseMaintenance);
                    break;
            }
            if (num7 !== 0 || num8 !== 0) flag2 = true;
        }
        if (leader !== null) {
            if (leader.militaryBaseMaintenance !== 0) { num7 += leader.militaryBaseMaintenance; flag = true; }
            if (leader.civilianBaseMaintenance !== 0) { num8 += leader.civilianBaseMaintenance; flag = true; }
        }
        if (num7 !== 0) text += `${fmtPlusMinusPct(num7 / 100.0)} ${skill(CharacterSkillType.MilitaryBaseMaintenance)}, `;
        if (num8 !== 0) text += `${fmtPlusMinusPct(num8 / 100.0)} ${skill(CharacterSkillType.CivilianBaseMaintenance)}, `;
    } else {
        let num9 = 0;
        let num10 = 0;
        if (leader !== null) {
            if (bo.role === BuiltObjectRole.Military && leader.militaryShipMaintenance !== 0) { num9 += leader.militaryShipMaintenance; flag = true; }
            if (bo.role !== BuiltObjectRole.Military && leader.civilianShipMaintenance !== 0) { num10 += leader.civilianShipMaintenance; flag = true; }
        }
        if (bo.role === BuiltObjectRole.Military && num9 !== 0) text += `${fmtPlusMinusPct(num9 / 100.0)} ${skill(CharacterSkillType.MilitaryShipMaintenance)}, `;
        if (bo.role !== BuiltObjectRole.Military && num10 !== 0) text += `${fmtPlusMinusPct(num10 / 100.0)} ${skill(CharacterSkillType.CivilianShipMaintenance)}, `;
    }
    if (bo.isShipYard && bo.constructionQueue !== null) {
        let num11 = 0;
        let num12 = 0;
        const list = withColony();
        if (list.length > 0) {
            num11 = getHighestSkillLevelExcludeLeaders(list, CharacterSkillType.MilitaryShipConstructionSpeed);
            num12 = getHighestSkillLevelExcludeLeaders(list, CharacterSkillType.CivilianShipConstructionSpeed);
            if (num11 !== 0 || num12 !== 0) flag2 = true;
        }
        if (leader !== null) {
            if (leader.militaryShipConstructionSpeed !== 0) { num11 += leader.militaryShipConstructionSpeed; flag = true; }
            if (leader.civilianShipConstructionSpeed !== 0) { num12 += leader.civilianShipConstructionSpeed; flag = true; }
        }
        if (num11 !== 0) text += `${fmtPlusMinusPct(num11 / 100.0)} ${skill(CharacterSkillType.MilitaryShipConstructionSpeed)}, `;
        if (num12 !== 0) text += `${fmtPlusMinusPct(num12 / 100.0)} ${skill(CharacterSkillType.CivilianShipConstructionSpeed)}, `;
    }
    // Captain (BuiltObject.Captain*Bonus = byte / 100) plus the fleet's admiral bonuses; with a fleet the baseline is 2.0.
    const cb = captainBonuses(bo);
    const c = (v: number | undefined): number => (v ?? 100) / 100.0;
    const nums: [number, CharacterSkillType][] = [
        [c(cb?.targeting), CharacterSkillType.Targeting],
        [c(cb?.countermeasures), CharacterSkillType.Countermeasures],
        [c(cb?.shipManeuvering), CharacterSkillType.ShipManeuvering],
        [c(cb?.fighters), CharacterSkillType.Fighters],
        [c(cb?.shipEnergyUsage), CharacterSkillType.ShipEnergyUsage],
        [c(cb?.weaponsDamage), CharacterSkillType.WeaponsDamage],
        [c(cb?.weaponsRange), CharacterSkillType.WeaponsRange],
        [c(cb?.shieldRechargeRate), CharacterSkillType.ShieldRechargeRate],
        [c(cb?.damageControl), CharacterSkillType.DamageControl],
        [c(cb?.repair), CharacterSkillType.RepairBonus],
        [c(cb?.hyperjumpSpeed), CharacterSkillType.HyperjumpSpeed],
    ];
    let num13 = 1.0;
    const sg = bo.shipGroup as ShipGroup | null;
    if (sg !== null && sg !== undefined) {
        num13 += 1.0;
        const g = [sg.targetingBonus, sg.countermeasuresBonus, sg.shipManeuveringBonus, sg.fightersBonus, sg.shipEnergyUsageBonus,
            sg.weaponsDamageBonus, sg.weaponsRangeBonus, sg.shieldRechargeRateBonus, sg.damageControlBonus, sg.repairBonus, sg.hyperjumpSpeedBonus];
        for (let i = 0; i < nums.length; i++) nums[i][0] += g[i];
    }
    for (const [v, t] of nums) {
        if (v !== num13) {
            text += `${fmtPlusMinusPct(v - num13)} ${skill(t)}, `;
            flag4 = true;
            flag5 = true;
        }
    }
    const bonusOf = (t: CharacterSkillType): number => 1.0 + getHighestSkillLevel(own, t) / 100.0;
    for (const t of [CharacterSkillType.BoardingAssault, CharacterSkillType.SmugglingIncome, CharacterSkillType.SmugglingEvasion]) {
        const v = bonusOf(t);
        if (v !== 1.0) {
            text += `${fmtPlusMinusPct(v - 1.0)} ${skill(t)}, `;
            flag4 = true;
            flag5 = true;
        }
    }
    if (text !== '' && text.length >= 2) text = text.substring(0, text.length - 2);
    if (flag || flag3 || flag2 || flag4) {
        let text9 = '';
        if (flag) text9 += role(CharacterRole.Leader) + ' & ';
        if (flag2) text9 += role(CharacterRole.ColonyGovernor) + ' & ';
        if (flag3) text9 += role(CharacterRole.Scientist) + ' & ';
        if (flag5) text9 += role(CharacterRole.ShipCaptain) + ' & ';
        if (flag4) text9 += role(CharacterRole.FleetAdmiral) + ' & ';
        if (text9 !== '' && text9.length >= 3) text9 = text9.substring(0, text9.length - 3);
        text = text9 + ': ' + text;
    }
    return text;
}
