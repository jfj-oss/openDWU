// What a research project unlocks, as the original's hover panel lists it (ResearchTree.cs DrawProjectInfo →
// Galaxy.GenerateBenefitDetail). Ports of
//   Galaxy.5.cs 983 GenerateBenefitDetail (one column of description / value lines per benefit)
//   Galaxy.5.cs 922 ResolveComponentDescriptionLines + BaconGalaxy.cs 427 ResolveComponentDescriptionDetailed
//   Galaxy.5.cs 390 ResolveFighterDescription, 795 ResolveResearchAbilityLines
//   Galaxy.2.cs 2257 ResolveDescription(ResearchNode) (the node text drawn when a node has no images)
//   Galaxy.5.cs 160 DetermineMaximumConstructionSizeForYard → ResearchNodeList.cs 458 CheckAncestorsForAbility
// plus the .NET number formats they use. Pure reads of the sim (no state changes).

import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import { ComponentType } from '../../sim/data/components';
import type { ComponentDefinition } from '../../sim/componentStatic';
import type { ResearchAbility } from '../../sim/data/research';
import type { Fighter } from '../../sim/data/fighters';
import {
    PlanetaryFacilityType,
    ResearchAbilityType,
    abilityRelatedSubRole,
    abilityRelatedTroopType,
    abilityTypeFromFile,
    facilityType,
    type ResearchSystem,
    type TechNode,
} from '../../sim/researchSystem';
import { TroopType } from '../../sim/cargo';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { resolveDescription } from '../../sim/messages';
import { formatNet, tryGetText } from '../../sim/textResolver';
import { resolvePlanetaryFacilityLines } from '../../sim/construction/facilityText';
import { calculatePlanetaryFacilityCost } from '../../sim/construction/facilities';
import { checkWonderBuiltDef } from '../../sim/construction/wonders';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../../sim/galaxyTime';

// -------------------------------------------------------------------------------------------------------------------
// Text and .NET number formats
// -------------------------------------------------------------------------------------------------------------------

/** `string.Format(TextResolver.GetText(tag), args)`; the tag itself when no GameText table is loaded. GameText's
 *  literal `\n` sequences become line breaks (the original's Replace("\n", NewLine)). */
export function gt(tag: string, ...args: unknown[]): string {
    return formatNet(tryGetText(tag) ?? GAME_TEXT_FALLBACK[tag] ?? tag, args).replace(/\\n/g, '\n');
}

/** GameText.txt templates (with arguments) used before / without the loaded table (headless tests). */
const GAME_TEXT_FALLBACK: Record<string, string> = {
    'Improvements to COMPONENT': 'Improvements to {0}',
    'Build FACILITY': 'Build {0}',
    'X per 100 distance': '{0} per 100 distance',
    'seconds abbreviation': 'secs',
    'X secs': '{0} secs',
    'X months': '{0} months',
    'X credits': '{0} credits',
    'RACE only': '{0} only',
    'Not RACE': 'Not available to {0}',
    'Must first research PROJECT': 'Must first research {0}',
    '#X in queue': '#{0} in queue',
    'No project': 'No project',
    'X% from Y government style': '{0} from {1} government style',
    'X% from Y race': '{0} from {1} race',
    'Crash Research Initiate Question':
        'Would you like to initiate a crash program to research {0}?\\n\\nThis would triple our research speed for this project, but would cost us {1} credits.\\n\\nShould we spend {1} credits on this crash research program?',
    'Crash Research Cannot Afford':
        'Initiating crash research for this project will cost us {0} credits.\\n\\nUnfortunately we do not have enough money for this - we currently have only {1} credits.',
};

/** .NET custom formats round half away from zero. */
function roundAway(x: number): number {
    return Math.sign(x) * Math.round(Math.abs(x)) + 0;
}

/** `v.ToString("0,K")` (also "#0,K" / "#######0,K"): thousands, rounded, a literal K. */
export function formatK(v: number): string {
    return `${roundAway(v / 1000)}K`;
}

/** `v.ToString("0,,M")`: millions, rounded, a literal M. */
export function formatM(v: number): string {
    return `${roundAway(v / 1e6)}M`;
}

/** `v.ToString("###,###,###,##0")`. */
export function formatGrouped(v: number): string {
    const r = roundAway(v);
    const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return r < 0 ? `-${s}` : s;
}

/** `v.ToString("0.00")` / "0.0" / "0.000": fixed decimals, half away from zero. */
export function formatFixed(v: number, decimals: number): string {
    const k = 10 ** decimals;
    return (roundAway(v * k) / k).toFixed(decimals);
}

/** `v.ToString("0.#")`. */
export function formatOneOptionalDecimal(v: number): string {
    const s = formatFixed(v, 1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** `v.ToString("+#0%;-#0%;+0%")` (and "+0%"): a signed whole percentage. */
export function formatSignedPercent(v: number): string {
    const r = roundAway(v * 100);
    return r < 0 ? `-${-r}%` : `+${r}%`;
}

/** `v.ToString("+#%")`: like "+0%" but an empty integer part when it rounds to 0 (".NET '#' drops a lone zero"). */
export function formatSignedPercentHash(v: number): string {
    const r = roundAway(v * 100);
    if (r === 0) return '+%';
    return r < 0 ? `-${-r}%` : `+${r}%`;
}

/** `string.Format("{0:P2}", v)` in the invariant culture: "12.34 %". */
export function formatP2(v: number): string {
    return `${formatFixed(v * 100, 2)} %`;
}

// -------------------------------------------------------------------------------------------------------------------
// ResolveDescription(ResearchNode) and the benefit count
// -------------------------------------------------------------------------------------------------------------------

/** ResearchNodeDefinition.BenefitCount (ResearchNodeDefinition.cs 69). */
export function benefitCount(rs: ResearchSystem, node: TechNode): number {
    const d = node.def;
    return d.components.length + d.componentImprovements.length + d.abilities.length + d.fighters.length + (rs.planetaryFacilityOf(node) !== null ? 1 : 0) + (d.plagueChange !== null ? 1 : 0);
}

/** ResearchNode.CountRequiredParents (ResearchNode.cs 126). */
export function countRequiredParents(node: TechNode): number {
    let n = 0;
    for (const r of node.parentIsRequired) if (r) n++;
    return n;
}

function fighterById(galaxy: Galaxy | null, id: number): Fighter | null {
    return galaxy?.researchStatic?.fighters.find((f) => f.fighterId === id) ?? null;
}

/** Port of Galaxy.2.cs 2257 ResolveDescription(ResearchNode researchProject). */
export function resolveNodeDescription(galaxy: Galaxy | null, rs: ResearchSystem, node: TechNode): string {
    const d = node.def;
    let text = '';
    if (d.components.length > 0) text = d.components.map((id) => rs.definitionFor(id)?.name ?? '').join(', ');
    if (d.componentImprovements.length > 0) {
        if (text.length > 0) text += ' + ';
        let text2 = '';
        for (const ci of d.componentImprovements) text2 += (rs.definitionFor(ci.componentId)?.name ?? '') + ', ';
        if (text2.length >= 3) text2 = text2.substring(0, text2.length - 2);
        text += gt('Improvements to COMPONENT', text2);
    }
    if (d.abilities.length > 0) {
        if (text.length > 0) text += ' + ';
        text += d.abilities.map((a) => a.name).join(', ');
    }
    if (d.fighters.length > 0) {
        if (text.length > 0) text += ' + ';
        text += d.fighters.map((id) => fighterById(galaxy, id)?.name ?? '').join(', ');
    }
    const f = rs.planetaryFacilityOf(node);
    if (f !== null) {
        if (text.length > 0) text += ' + ';
        text += gt('Build FACILITY', f.name);
    }
    return text;
}

// -------------------------------------------------------------------------------------------------------------------
// GenerateBenefitDetail
// -------------------------------------------------------------------------------------------------------------------

/** One benefit column: description[i] with its value[i] (null / '' = a wrapped line without a value). */
export interface BenefitColumn {
    descriptions: (string | null)[];
    values: (string | null)[];
}

/** ComponentImprovement values: the improvement's own, or the component's (new ComponentImprovement(component)). */
interface ImprovementValues {
    techLevel: number;
    value1: number;
    value2: number;
    value3: number;
    value4: number;
    value5: number;
    value6: number;
    value7: number;
}

/** Port of ResearchNodeList.cs 458 CheckAncestorsForAbility (depth-first over ParentNodes). */
export function checkAncestorsForAbility(node: TechNode, type: ResearchAbilityType): ResearchAbility | null {
    for (const a of node.def.abilities) if (abilityTypeFromFile(a.type) === type) return a;
    for (const p of node.parentNodes) {
        const r = checkAncestorsForAbility(p, type);
        if (r !== null) return r;
    }
    return null;
}

/** Port of Galaxy.5.cs 160 DetermineMaximumConstructionSizeForYard. */
export function determineMaximumConstructionSizeForYard(node: TechNode | null): number {
    if (node === null) return 160;
    return checkAncestorsForAbility(node, ResearchAbilityType.ConstructionSize)?.value ?? 160;
}

const secs = (): string => gt('seconds abbreviation');
const per100 = (v: number): string => gt('X per 100 distance', String(v));

/** Port of BaconGalaxy.cs 427 ResolveComponentDescriptionDetailed (8 lines). */
export function resolveComponentDescriptionDetailed(galaxy: Galaxy | null, component: ComponentDefinition, imp: ImprovementValues, project: TechNode | null): BenefitColumn {
    const d: (string | null)[] = new Array(8).fill(null);
    const v: (string | null)[] = new Array(8).fill(null);
    const fire = (i: number): void => {
        d[i] = gt('Fire Rate');
        v[i] = formatFixed(imp.value6 / 1000.0, 2) + ' ' + secs();
    };
    // Damage / Range / Energy Used / Speed / Damage Loss / Fire Rate at lines 0-5 (the beam family).
    const weaponBlock = (): void => {
        d[0] = gt('Damage');
        v[0] = String(imp.value1);
        d[1] = gt('Range');
        v[1] = String(imp.value2);
        d[2] = gt('Energy Used');
        v[2] = String(imp.value3);
        d[3] = gt('Speed');
        v[3] = String(imp.value4);
        d[4] = gt('Damage Loss');
        v[4] = per100(imp.value5);
        fire(5);
    };
    // A described special weapon: text at 0, power / range / energy / speed / loss / fire rate at 1-6.
    const specialBlock = (desc: string, power: string, loss: string): void => {
        d[0] = gt(desc);
        d[1] = gt(power);
        v[1] = String(imp.value1);
        d[2] = gt('Range');
        v[2] = String(imp.value2);
        d[3] = gt('Energy Used');
        v[3] = String(imp.value3);
        d[4] = gt('Speed');
        v[4] = String(imp.value4);
        d[5] = gt(loss);
        v[5] = per100(imp.value5);
        fire(6);
    };
    const one = (desc: string, value: string): void => {
        d[0] = gt(desc);
        v[0] = value;
    };
    switch (component.type) {
        case ComponentType.WeaponBeam:
        case ComponentType.WeaponSuperBeam:
            weaponBlock();
            break;
        case ComponentType.WeaponTorpedo:
        case ComponentType.WeaponBombard:
        case ComponentType.WeaponSuperTorpedo:
            weaponBlock();
            d[6] = gt('Bombard Damage');
            v[6] = formatM(imp.value7 * 1000000.0);
            break;
        case ComponentType.WeaponMissile:
        case ComponentType.WeaponSuperMissile:
            weaponBlock();
            d[6] = gt('Bombard Damage');
            v[6] = formatM(imp.value7 * 1000000.0);
            d[7] = gt('Missiles are X less effective against armor', '50%');
            break;
        case ComponentType.WeaponPointDefense:
            specialBlock('Close-in weapons system that fires deadly bursts at enemy fighters, disabling or destroying them', 'Damage', 'Damage Loss');
            break;
        case ComponentType.WeaponIonCannon:
            specialBlock('Fires a bolt of ionized particles that disables weapons and engines of the target ship or base', 'Disabling Power', 'Power Loss');
            break;
        case ComponentType.WeaponIonPulse:
            specialBlock('Fires an omni-directional shockwave that disables weapons and engines of nearby ships and bases', 'Disabling Power', 'Power Loss');
            break;
        case ComponentType.WeaponIonDefense:
            d[0] = gt('Protects a ship or base against the disabling effects of Ion weapons');
            d[1] = gt('Ion Defense Strength');
            v[1] = String(imp.value1);
            break;
        case ComponentType.WeaponTractorBeam:
            specialBlock('Gravitic beam that pulls enemy ships towards you for capture or attack', 'Pulling Power', 'Power Loss');
            break;
        case ComponentType.WeaponGravityBeam:
            specialBlock('Gravitic beam that damages enemy ships with blasts of powerful gravity waves', 'Damage', 'Power Loss');
            break;
        case ComponentType.WeaponAreaGravity:
            d[0] = gt('Sends out a blast of pulsing gravity waves from a targetted point in space');
            d[1] = gt('Power');
            v[1] = String(imp.value1);
            d[2] = gt('Firing Range');
            v[2] = String(imp.value2);
            d[3] = gt('Pull Range');
            v[3] = String(imp.value5);
            d[4] = gt('Damage Range');
            v[4] = String(roundAway(imp.value7));
            d[5] = gt('Duration');
            v[5] = gt('X secs', formatFixed(imp.value2 / imp.value4, 2));
            d[6] = gt('Energy Used');
            v[6] = String(imp.value3);
            d[7] = gt('Fire Rate');
            v[7] = formatFixed(imp.value6 / 1000.0, 2) + ' ' + secs();
            break;
        case ComponentType.AssaultPod:
            d[0] = gt('Short-range shuttles that allow boarding and capture of enemy ships or bases');
            d[1] = gt('Assault Strength');
            v[1] = String(imp.value1);
            d[2] = gt('Boarding Range');
            v[2] = String(imp.value2);
            d[3] = gt('Energy Used');
            v[3] = String(imp.value3);
            d[4] = gt('Speed');
            v[4] = String(imp.value4);
            d[5] = gt('Shield Penetration');
            v[5] = String(imp.value5);
            d[6] = gt('Launch Rate');
            v[6] = formatFixed(imp.value6 / 1000.0, 2) + ' ' + secs();
            break;
        case ComponentType.HyperDeny:
            d[0] = gt('Projects a powerful gravity well that prevents nearby ships from initiating a hyperjump');
            d[1] = gt('Range');
            v[1] = String(imp.value2);
            d[2] = gt('Energy Used');
            v[2] = String(imp.value3);
            break;
        case ComponentType.HyperStop:
            d[0] = gt('Projects a powerful gravity well that pulls enemy ships out of hyperspace within a defined range');
            d[1] = gt('Hyper Stop Range');
            v[1] = String(imp.value2);
            break;
        case ComponentType.WeaponAreaDestruction:
        case ComponentType.WeaponSuperArea:
            weaponBlock();
            break;
        case ComponentType.FighterBay:
            d[0] = gt('Provides facilities for manufacture, storage and repair of star fighters and bombers aboard ships or bases');
            d[1] = gt('Fighter Capacity');
            v[1] = String(Math.trunc(imp.value1 / 10));
            d[2] = gt('Repair Rate');
            v[2] = String(imp.value2);
            break;
        case ComponentType.Armor:
            d[0] = gt('Rating');
            v[0] = String(imp.value1);
            d[1] = gt('Reactive Rating');
            v[1] = String(imp.value2);
            break;
        case ComponentType.Shields:
            d[0] = gt('Strength');
            v[0] = String(imp.value1);
            d[1] = gt('Recharge Rate');
            v[1] = formatOneOptionalDecimal(imp.value2 / 10.0);
            break;
        case ComponentType.ShieldRecharge:
            d[0] = gt('Restores the shield levels of nearby friendly ships when their shields drop below 50%');
            d[1] = gt('Recharge Range');
            v[1] = String(imp.value1);
            d[2] = gt('Max Recharge Amount');
            v[2] = String(imp.value2);
            d[3] = gt('Energy Required');
            v[3] = String(imp.value3);
            break;
        case ComponentType.EngineMainThrust:
            d[0] = gt('Maximum Thrust');
            v[0] = String(imp.value1);
            d[1] = gt('Max Energy Usage');
            v[1] = String(imp.value2);
            d[2] = gt('Cruise Thrust');
            v[2] = String(imp.value3);
            d[3] = gt('Cruise Energy Usage');
            v[3] = String(imp.value4);
            break;
        case ComponentType.EngineVectoring:
            d[0] = gt('Thrust');
            v[0] = String(imp.value1);
            d[1] = gt('Energy Usage');
            v[1] = String(imp.value2);
            break;
        case ComponentType.HyperDrive:
            d[0] = gt('Speed');
            v[0] = String(imp.value1);
            d[1] = gt('Energy Usage');
            v[1] = String(imp.value2);
            d[2] = gt('Typical Jump Initiation');
            v[2] = String(imp.value3) + ' ' + secs();
            if (imp.value4 > 0 && imp.value5 > 0) {
                d[3] = 'Gravity well effect';
                v[3] = formatP2(imp.value4 / imp.value5) + '.';
            }
            break;
        case ComponentType.Reactor: {
            d[0] = gt('Energy Output');
            v[0] = String(imp.value1);
            d[1] = gt('Storage Capacity');
            v[1] = String(imp.value2);
            d[2] = gt('Fuel Type');
            const rid = imp.value4 & 255;
            v[2] = galaxy?.resources.find((r) => r.resourceId === rid)?.name ?? galaxy?.resources[rid]?.name ?? '';
            d[3] = gt('X fuel units per 1000 energy units', formatFixed((imp.value3 / 1000.0 / imp.value2) * 1000.0, 2));
            v[3] = '';
            break;
        }
        case ComponentType.EnergyCollector:
            one('Potential Energy', String(imp.value1));
            break;
        case ComponentType.ExtractorMine:
        case ComponentType.ExtractorGasExtractor:
        case ComponentType.ExtractorLuxury:
            one('Extraction', String(imp.value1));
            break;
        case ComponentType.ManufacturerWeaponsPlant:
        case ComponentType.ManufacturerEnergyPlant:
        case ComponentType.ManufacturerHighTechPlant:
        case ComponentType.StorageFuel:
        case ComponentType.StorageCargo:
        case ComponentType.StorageTroop:
            one('Capacity', String(imp.value1));
            break;
        case ComponentType.StoragePassenger:
            one('Capacity', formatK(imp.value1));
            break;
        case ComponentType.StorageDockingBay:
            one('Cargo Throughput', String(imp.value1));
            break;
        case ComponentType.SensorProximityArray:
            d[0] = gt('Range');
            v[0] = String(imp.value1);
            d[1] = gt('Hyperjump Tracking');
            v[1] = String(roundAway(imp.value2)) + '%';
            break;
        case ComponentType.SensorResourceProfileSensor:
        case ComponentType.SensorLongRange:
            one('Range', String(imp.value1));
            break;
        case ComponentType.SensorTraceScanner:
            d[0] = gt('Allows scanning another ship or base to determine its cargo, onboard troops and component status');
            d[1] = gt('Scan Range');
            v[1] = String(imp.value1);
            d[2] = gt('Scan Power');
            v[2] = String(imp.value2);
            break;
        case ComponentType.SensorScannerJammer:
            d[0] = gt('Jams enemy trace scanners, preventing them from scanning the contents of a ship');
            d[1] = gt('Jamming Power');
            v[1] = String(imp.value2);
            break;
        case ComponentType.SensorStealth:
            one('Stealth Rating', String(imp.value1));
            break;
        case ComponentType.ComputerTargetting:
        case ComponentType.ComputerCountermeasures:
            one('Effectiveness', `+${imp.value1}%`);
            break;
        case ComponentType.ComputerTargettingFleet:
        case ComponentType.ComputerCountermeasuresFleet:
            one('Fleet Bonus', `+${imp.value2}%`);
            break;
        case ComponentType.ComputerCommandCenter:
            one('Maintenance savings', `${imp.value1}%`);
            break;
        case ComponentType.ComputerCommerceCenter:
            one('Trade bonuses', formatFixed(imp.value1 / 10.0, 1) + '%');
            break;
        case ComponentType.LabsWeaponsLab:
        case ComponentType.LabsEnergyLab:
        case ComponentType.LabsHighTechLab:
            one('Research Output', String(imp.value1));
            break;
        case ComponentType.ConstructionBuild: {
            d[0] = gt('Construction Speed');
            v[0] = String(imp.value1);
            const size = determineMaximumConstructionSizeForYard(project);
            d[1] = gt('Maximum ship size');
            v[1] = String(size);
            d[2] = gt('Maximum base size');
            v[2] = String(size * 3);
            break;
        }
        case ComponentType.HabitationLifeSupport:
        case ComponentType.HabitationHabModule:
            one('Support Size', String(imp.value1));
            break;
        case ComponentType.DamageControl:
            d[0] = gt('Damage Reduction') + ' %';
            v[0] = formatFixed(imp.value1 / 10.0, 1) + '%';
            d[1] = gt('Repair Component');
            v[1] = imp.value2 <= 0 ? '(' + gt('None') + ')' : String(imp.value2) + ' ' + secs();
            break;
        case ComponentType.HabitationMedicalCenter:
            one('Effectiveness', String(imp.value1));
            break;
        case ComponentType.HabitationRecreationCenter:
            one('Value', String(imp.value1));
            break;
        case ComponentType.HabitationColonization:
            one('Population Amount', formatM(imp.value1));
            break;
        case ComponentType.WeaponPhaser:
        case ComponentType.WeaponSuperPhaser:
            weaponBlock();
            d[6] = gt('Phasers Description');
            break;
        case ComponentType.WeaponRailGun:
        case ComponentType.WeaponSuperRailGun:
            weaponBlock();
            d[6] = gt('Bombard Damage');
            v[6] = formatM(imp.value7 * 1000000.0);
            d[7] = gt('Rail Guns Description');
            break;
        case ComponentType.EnergyToFuel:
            one('Fuel Production Rate', String(imp.value1));
            break;
    }
    return { descriptions: d, values: v };
}

/** Port of Galaxy.5.cs 922 ResolveComponentDescriptionLines: title, size / static energy, then the detail lines. */
export function resolveComponentDescriptionLines(galaxy: Galaxy | null, component: ComponentDefinition, improvement: ImprovementValues | null, project: TechNode | null): BenefitColumn {
    const d: (string | null)[] = new Array(10).fill(null);
    const v: (string | null)[] = new Array(10).fill(null);
    d[0] = improvement !== null && improvement.techLevel !== component.techLevel ? gt('Improvements to COMPONENT', component.name) : component.name;
    d[1] = gt('Size') + ': ' + component.size + ',   ' + gt('Static Energy Used') + ': ' + component.energyUsed;
    const detail = resolveComponentDescriptionDetailed(galaxy, component, improvement ?? component, project);
    for (let i = 0; i < detail.descriptions.length; i++) {
        d[i + 2] = detail.descriptions[i];
        v[i + 2] = detail.values[i];
    }
    return { descriptions: d, values: v };
}

/** Port of Galaxy.5.cs 390 ResolveFighterDescription. */
export function resolveFighterDescription(f: Fighter): BenefitColumn {
    const d: (string | null)[] = new Array(9).fill(null);
    const v: (string | null)[] = new Array(9).fill(null);
    d[0] = f.name;
    d[1] = gt('Top Speed');
    d[2] = gt('Turn Rate');
    d[3] = gt('Shields');
    d[4] = gt('Targetting');
    d[5] = gt('Countermeasures');
    v[1] = String(f.topSpeed);
    v[2] = String(roundAway(f.turnRate * (180.0 / Math.PI))) + '°/' + gt('second abbreviation');
    v[3] = String(f.shieldsCapacity);
    v[4] = f.targetingModifier + '%';
    v[5] = f.countermeasureModifier + '%';
    // fighters.txt Type: 0 Interceptor, 1 Bomber (FighterSpecificationList.cs 106).
    const bomber = f.type === 1;
    d[6] = gt(bomber ? 'Bombing Damage' : 'Weapons Damage');
    d[7] = gt(bomber ? 'Bombing Range' : 'Weapons Range');
    d[8] = gt(bomber ? 'Bombing Fire Rate' : 'Weapons Fire Rate');
    v[6] = String(f.weaponDamage);
    v[7] = String(f.weaponRange);
    v[8] = formatFixed(f.weaponFireRate / 1000.0, 2) + ' ' + secs();
    return { descriptions: d, values: v };
}

const troopName = (t: TroopType): string => resolveDescription(TroopType as unknown as Record<number, string>, t);
const subRoleName = (s: BuiltObjectSubRole): string => resolveDescription(BuiltObjectSubRole as unknown as Record<number, string>, s);

/** Port of Galaxy.5.cs 795 ResolveResearchAbilityLines. */
export function resolveResearchAbilityLines(ability: ResearchAbility): BenefitColumn {
    const d: (string | null)[] = [null, null, null, null];
    const v: (string | null)[] = [null, null, null, null];
    const plus = (x: number): string => `+${Math.abs(x)}%`;
    switch (abilityTypeFromFile(ability.type)) {
        case ResearchAbilityType.Troop: {
            const troopType = abilityRelatedTroopType(ability) ?? TroopType.Undefined;
            d[0] = ability.name;
            v[0] = '';
            if (troopType !== TroopType.Undefined) {
                if (ability.value > 0) {
                    d[1] = gt('Increases the Attack Strength of newly recruited TROOPTYPE', troopName(troopType));
                    d[2] = gt('Bonus');
                    v[2] = plus(ability.value);
                } else if (ability.value < 0) {
                    d[1] =
                        troopType === TroopType.Artillery
                            ? gt('Increases the interception accuracy of all TROOPTYPE against invaders', troopName(troopType))
                            : gt('Increases the Defend Strength of newly recruited TROOPTYPE', troopName(troopType));
                    d[2] = gt('Bonus');
                    v[2] = plus(ability.value);
                } else {
                    const desc: Partial<Record<TroopType, string>> = {
                        [TroopType.Infantry]: 'Troop Type Description Infantry',
                        [TroopType.Armored]: 'Troop Type Description Armored',
                        [TroopType.Artillery]: 'Troop Type Description Artillery',
                        [TroopType.SpecialForces]: 'Troop Type Description SpecialForces',
                    };
                    const tag = desc[troopType];
                    d[1] = gt('Enable recruiting TROOPTYPE', troopName(troopType)) + '\n' + (tag ? gt(tag) : '');
                }
            } else {
                d[1] = gt('Lowers maintenance costs of all troops');
                d[2] = gt('Bonus');
                v[2] = `-${Math.abs(ability.value)}%`;
            }
            break;
        }
        case ResearchAbilityType.Boarding:
            d[0] = ability.name;
            v[0] = '';
            if (ability.value > 0) {
                d[1] = gt('Improved Boarding attack strength');
                d[2] = gt('Bonus');
                v[2] = plus(ability.value);
            } else if (ability.value < 0) {
                d[1] = gt('Improved Boarding defense strength');
                d[2] = gt('Bonus');
                v[2] = plus(ability.value);
            }
            break;
        case ResearchAbilityType.EnableShipSubRole: {
            const subRole = abilityRelatedSubRole(ability);
            if (subRole !== null && subRole !== BuiltObjectSubRole.Undefined) {
                d[0] = ability.name;
                v[0] = '';
                d[1] = gt('Enable building of SHIPTYPE', subRoleName(subRole)) + '  (' + gt('When construction size allows').toLowerCase() + ')';
                v[1] = '';
                if (subRole === BuiltObjectSubRole.Carrier) {
                    d[2] = gt('Note that Carriers can be built 50% larger than current maximum ship construction size');
                    v[2] = '';
                }
            }
            break;
        }
        case ResearchAbilityType.ColonizeHabitatType:
        case ResearchAbilityType.PopulationGrowthRate:
            d[0] = ability.name;
            v[0] = '';
            break;
        case ResearchAbilityType.ConstructionSize:
            d[0] = ability.name;
            v[0] = '';
            d[1] = gt('Maximum ship size');
            v[1] = String(ability.value);
            d[2] = gt('Maximum base size');
            v[2] = String(ability.value * 3);
            d[3] = '(' + gt('Bases built at colonies have unlimited size') + ')';
            break;
    }
    return { descriptions: d, values: v };
}

/** Port of Galaxy.5.cs 983 GenerateBenefitDetail: components, improvements, fighters, abilities, facility, plague. */
export function generateBenefitDetail(galaxy: Galaxy | null, empire: Empire | null, rs: ResearchSystem, node: TechNode): BenefitColumn[] {
    const out: BenefitColumn[] = [];
    const d = node.def;
    for (const id of d.components) {
        const c = rs.definitionFor(id);
        if (c) out.push(resolveComponentDescriptionLines(galaxy, c, null, node));
    }
    for (const ci of d.componentImprovements) {
        const c = rs.definitionFor(ci.componentId);
        if (c) out.push(resolveComponentDescriptionLines(galaxy, c, ci, node));
    }
    for (const id of d.fighters) {
        const f = fighterById(galaxy, id);
        if (f) out.push(resolveFighterDescription(f));
    }
    for (const a of d.abilities) out.push(resolveResearchAbilityLines(a));
    const facility = rs.planetaryFacilityOf(node);
    if (facility !== null) {
        const lines = resolvePlanetaryFacilityLines(facility);
        const cost = calculatePlanetaryFacilityCost(facility, empire);
        const costText = '  (' + gt('X credits', formatGroupedFacility(cost)) + ')';
        if (facilityType(facility) === PlanetaryFacilityType.Wonder) {
            lines.descriptions[0] = gt('Wonder') + ': ' + lines.descriptions[0] + costText;
            if (galaxy !== null && checkWonderBuiltDef(galaxy, facility)) lines.descriptions[0] = gt('Wonder Already Built').toUpperCase() + '\n' + lines.descriptions[0];
        } else {
            lines.descriptions[0] = gt('Planetary Facility') + ': ' + lines.descriptions[0] + costText;
        }
        out.push({ descriptions: lines.descriptions, values: lines.values });
    }
    const pc = d.plagueChange;
    if (pc !== null) {
        const plague = galaxy?.researchStatic?.plagues[pc.plagueId] ?? null;
        const a: (string | null)[] = new Array(8).fill(null);
        const b: (string | null)[] = new Array(8).fill(null);
        a[0] = plague?.name ?? '';
        a[1] = pc.description;
        a[2] = gt('Mortality Rate');
        b[2] = formatFixed(pc.mortalityRate, 3);
        a[3] = gt('Infection');
        b[3] = String(roundAway(pc.infectionChance));
        a[4] = gt('Duration');
        b[4] = gt('X months', formatFixed((pc.duration / REAL_SECONDS_IN_GALACTIC_YEAR) * 12, 1));
        const exceptionRace = plague?.exceptionRaceName ?? '';
        if (exceptionRace !== '' && (galaxy?.races.some((r) => r.name === exceptionRace) ?? false)) {
            a[5] = exceptionRace + ' ' + gt('Mortality Rate');
            b[5] = formatFixed(pc.exceptionMortalityRate, 3);
            a[6] = exceptionRace + ' ' + gt('Infection');
            b[6] = String(roundAway(pc.exceptionInfectionChance));
            a[7] = exceptionRace + ' ' + gt('Duration');
            b[7] = gt('X months', formatFixed((pc.exceptionDuration / REAL_SECONDS_IN_GALACTIC_YEAR) * 12, 1));
        }
        out.push({ descriptions: a, values: b });
    }
    return out;
}

/** `cost.ToString("#,###,##0")`. */
function formatGroupedFacility(v: number): string {
    return formatGrouped(v);
}
