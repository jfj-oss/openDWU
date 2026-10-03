// Pure model of the Design Editor's read-outs (the original pnlDesignDetail panels) and the Designs window's labels:
// what each panel draws, as rows of text, computed from a Design without touching the DOM. Ports of
//   DistantWorlds.Controls/Controls/DesignDefense.cs DrawDefenseInfo, DesignEnergy.cs DrawEnergyInfo,
//   DesignMovement.cs DrawMovementInfo, DesignIndustry.cs DrawIndustryInfo, WeaponListView.cs GenerateDamageGraph,
//   ComponentDetail.cs DrawComponentDetailInfo (via Galaxy.5.cs 950 ResolveComponentDescriptionComplete),
//   DistantWorlds/Main.Part9.cs:5030 method_292 (the weapons panel's right column), Main.Part8.cs:808 method_305
//   (the Designs window's maximum size label), Galaxy.2.cs:2189 ResolveComponentCategoryAbbreviation,
//   DistantWorlds.Types/Design.cs CalculateBoardingAssaultValue (1181), CalculateBoardingDefenseValue (1203),
//   CalculateTotalWeaponsEnergyUsePerSecond (1061) / CalculateWeaponEnergyUsePerSecond.
// Pure reads of the sim (no state changes).

import type { Design } from '../../sim/design';
import type { Empire } from '../../sim/empire';
import type { Race } from '../../sim/data/races';
import type { ComponentDefinition } from '../../sim/componentStatic';
import { ComponentType } from '../../sim/data/components';
import { ComponentCategoryType } from '../../sim/data/policies';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { IndustryType } from '../../sim/types';
import { identifyLatestBomberSpecification, identifyLatestFighterSpecification } from '../../sim/combat/fighters';
import { resolveComponentTypeDescription } from '../../sim/player/designEditor';
import { formatNet, tryGetText } from '../../sim/textResolver';
import { resolveComponentDescriptionDetailed } from './researchBenefits';
import {
    STANDARD_FAMILY_COUNT,
    STANDARD_SHIP_IMAGE_START_INDEX,
    SHIP_SET_IMAGE_COUNT,
} from '../../render/builtObjectLayer';

/** TextResolver.GetText with the key itself as the fallback (tests run without GameText.txt). */
export function gt(key: string, ...args: unknown[]): string {
    const t = tryGetText(key);
    if (t === null) return args.length > 0 ? `${key} (${args.join(', ')})` : key;
    return args.length > 0 ? formatNet(t, args) : t;
}

const none = (): string => `(${gt('None')})`;

/** .NET Math.Round(x, MidpointRounding.AwayFromZero) as the custom numeric formats use it. */
function roundAway(x: number, decimals = 0): number {
    const f = 10 ** decimals;
    const v = Math.abs(x) * f;
    const r = Math.floor(v + 0.5 + 1e-9);
    return (Math.sign(x) * r) / f;
}

/** ToString("0.00") / ("0.0"): fixed decimals, rounded half away from zero. */
export function fixed(x: number, decimals: number): string {
    return roundAway(x, decimals).toFixed(decimals);
}

/** ToString("#0.#"): up to one decimal, a trailing zero dropped. */
export function upToOneDecimal(x: number): string {
    const s = fixed(x, 1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** ToString("0,K"): the value in thousands (the ',' before the end scales by 1000) with a literal K. */
export function thousandsK(x: number): string {
    return `${roundAway(x / 1000)}K`;
}

/** An int field's ToString() (sim fields can carry float noise). */
export function intText(x: number): string {
    return String(Math.trunc(x));
}

export interface StatRow {
    label: string;
    value: string;
    /** Value colour (CSS) when not the panel's default. */
    color?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Design.cs boarding / weapons energy
// ---------------------------------------------------------------------------------------------------------------------

// Port of Design.cs:1181 CalculateBoardingAssaultValue.
export function calculateBoardingAssaultValue(design: Design, dominantRace: Race | null): number {
    const num2 = dominantRace !== null ? dominantRace.troopStrength / 100.0 : 1.0;
    let num = 0;
    for (const weapon of design.weapons) {
        if (weapon?.component && weapon.component.type === ComponentType.AssaultPod) num += Math.trunc(weapon.rawDamage * num2);
    }
    return num;
}

// Port of Design.cs:1203 CalculateBoardingDefenseValue.
export function calculateBoardingDefenseValue(design: Design, dominantRace: Race | null): number {
    const num2 = dominantRace !== null ? dominantRace.troopStrength / 100.0 : 1.0;
    let num = 0;
    for (const c of design.components) if (c?.type === ComponentType.HabitationHabModule) num += Math.trunc(20.0 * num2);
    for (const weapon of design.weapons) {
        if (weapon?.component && weapon.component.type === ComponentType.AssaultPod) num += Math.trunc(weapon.rawDamage * num2);
    }
    return num;
}

/** The research a design's weapons resolve their improved values with (ResearchSystem.ResolveImprovedComponentValues). */
export interface ImprovedValuesSource {
    resolveImprovedComponentValues(component: ComponentDefinition): { value3: number; value6: number };
}

// Port of Design.cs:1061 CalculateTotalWeaponsEnergyUsePerSecond (+ CalculateWeaponEnergyUsePerSecond).
export function calculateTotalWeaponsEnergyUsePerSecond(design: Design, research: ImprovedValuesSource | null): number {
    let num = 0.0;
    if (research === null) return num;
    for (const weapon of design.weapons) {
        if (!weapon?.component) continue;
        const imp = research.resolveImprovedComponentValues(weapon.component.def);
        if (imp.value6 > 0) num += imp.value3 / (imp.value6 / 1000.0);
    }
    return num;
}

// ---------------------------------------------------------------------------------------------------------------------
// The four stat panels
// ---------------------------------------------------------------------------------------------------------------------

// Port of DesignDefense.cs DrawDefenseInfo: label right-aligned in 140 px at x 10, the bold value at x 160, 14 px rows.
export function designDefenseRows(design: Design, dominantRace: Race | null): StatRow[] {
    const rows: StatRow[] = [];
    rows.push({ label: gt('Shields'), value: intText(design.shieldsCapacity) });
    rows.push({ label: gt('Shield Recharge Rate'), value: intText(design.shieldRechargeRate) });
    rows.push({ label: gt('Shield Area Recharge Range'), value: design.shieldAreaRechargeRange > 0 ? intText(design.shieldAreaRechargeRange) : none() });
    rows.push({ label: gt('Armor'), value: intText(design.armor) });
    rows.push({ label: gt('Reactive Armor Strength'), value: intText(design.armorReactive) });
    rows.push({ label: gt('Countermeasures'), value: design.countermeasureModifier > 0 ? `+${intText(design.countermeasureModifier)}%` : none() });
    rows.push({
        label: gt('Component Type Countermeasures Fleet'),
        value: design.fleetCountermeasureModifier > 0 ? `+${intText(design.fleetCountermeasureModifier)}%` : none(),
    });
    rows.push({ label: gt('Stealth: Visibility Range'), value: design.stealth < 1.0 ? `-${fixed((1.0 - design.stealth) * 100.0, 1)}%` : none() });
    const boarding = calculateBoardingDefenseValue(design, dominantRace);
    rows.push({ label: gt('Boarding Defense Strength'), value: boarding > 0 ? String(boarding) : none() });
    rows.push({ label: gt('Damage Reduction'), value: design.damageReduction > 0.0 ? `${roundAway(design.damageReduction * 100.0)}%` : none() });
    rows.push({
        label: gt('Repair Component'),
        value: design.damageRepair > 0 ? `${roundAway(design.damageRepair)} ${gt('seconds abbreviation')}` : none(),
    });
    return rows;
}

/** SelectGoodBadBrush (negativeIsBad): red below zero, green above, the label grey at zero. */
export function goodBadColor(value: number): string {
    if (value < 0) return 'rgb(255, 0, 0)';
    if (value > 0) return 'rgb(0, 128, 0)';
    return 'rgb(170, 170, 170)';
}

export interface EnergyPanel {
    /** Energy Collection, Reactor Power Output, Static Energy Usage, Excess Energy Output (rows at y 30, +14 …). */
    top: StatRow[];
    /** "Fuel Type = …" (a free line one row lower). */
    fuelType: string;
    /** Fuel Capacity, Energy Storage. */
    bottom: StatRow[];
    /** "X fuel units per 1000 energy units". */
    fuelPer1000: string;
}

// Port of DesignEnergy.cs DrawEnergyInfo.
export function designEnergyPanel(design: Design, resourceName: (id: number) => string = (id) => `#${id}`): EnergyPanel {
    const excess = design.reactorPowerOutput - design.staticEnergyConsumption;
    // (double)ReactorCycleFuelConsumption / 1000.0 / (double)ReactorStorageCapacity * 1000.0 — NaN / ∞ print as .NET does.
    const num2 = (design.reactorCycleFuelConsumption / 1000.0 / design.reactorStorageCapacity) * 1000.0;
    const per = Number.isFinite(num2) ? fixed(num2, 2) : Number.isNaN(num2) ? 'NaN' : '∞';
    return {
        top: [
            { label: gt('Energy Collection'), value: intText(design.energyCollection) },
            { label: gt('Reactor Power Output'), value: intText(design.reactorPowerOutput) },
            { label: gt('Static Energy Usage'), value: intText(design.staticEnergyConsumption) },
            { label: gt('Excess Energy Output'), value: String(roundAway(excess)), color: goodBadColor(excess) },
        ],
        fuelType: `${gt('Fuel Type')} = ${design.fuelType !== null ? resourceName(design.fuelType.resourceId) : none()}`,
        bottom: [
            { label: gt('Fuel Capacity'), value: intText(design.fuelCapacity) },
            { label: gt('Energy Storage'), value: intText(design.reactorStorageCapacity) },
        ],
        fuelPer1000: gt('X fuel units per 1000 energy units', per),
    };
}

/** Galaxy.MovementImpulseSpeed. */
export const MOVEMENT_IMPULSE_SPEED = 3;
/** Galaxy.SectorSize. */
export const SECTOR_SIZE = 2000000;

export interface MovementPanel {
    moving: boolean;
    /** Impulse, Cruise, Sprint, Hyper speeds. */
    speeds: [number, number, number, number];
    /** The energy burnt at each speed (ImpulseSpeedFuelBurn …). */
    burns: [number, number, number, number];
    /** The curve: the static-usage dash line y and the 3 px polyline, in panel pixels. */
    staticY: number;
    curve: { x: number; y: number }[];
    acceleration: string;
    turnRate: string;
    range: string;
}

/** DesignMovement.cs column x positions / widths (Impulse, Cruise, Sprint, Hyper). */
export const MOVEMENT_COLUMNS: readonly { x: number; w: number }[] = [
    { x: 70, w: 55 },
    { x: 125, w: 55 },
    { x: 180, w: 55 },
    { x: 235, w: 55 },
];
/** DesignMovement.cs row geometry (_TopMargin 8, _RowHeight 16). */
export const MOVEMENT_ROWS = { top: 8, row: 16 } as const;

// Port of DesignMovement.cs DrawMovementInfo (the numbers and the energy curve).
export function designMovementPanel(design: Design): MovementPanel {
    const { top, row } = MOVEMENT_ROWS;
    const num2 = top + row * 4 + 4;
    const num3 = top + row * 4 + 60 + 4;
    const burns: [number, number, number, number] = [design.impulseSpeedFuelBurn, design.cruiseSpeedFuelBurn, design.topSpeedFuelBurn, design.warpSpeedFuelBurn];
    const num4 = Math.max(design.topSpeedFuelBurn, design.warpSpeedFuelBurn);
    const usage = design.staticEnergyConsumption;
    const num5 = 60.0 / (usage + num4);
    const y = (v: number): number => (Number.isFinite(num5) ? num3 - Math.trunc(v * num5) : num3);
    const [c0, c1, c2, c3] = MOVEMENT_COLUMNS;
    const curve = [
        { x: c0.x, y: y(usage) },
        { x: c0.x + Math.trunc(c0.w / 2), y: y(usage + burns[0]) },
        { x: c1.x + Math.trunc(c1.w / 2), y: y(usage + burns[1]) },
        { x: c2.x + Math.trunc(c2.w / 2), y: y(usage + burns[2]) },
        { x: c3.x + Math.trunc(c3.w / 2), y: y(usage + burns[3]) },
        { x: c3.x + c3.w, y: y(usage + burns[3]) },
    ];
    let range: string;
    if (design.warpSpeed > 0) range = gt('Design Fuel Range Sector Description', fixed(design.maximumRange() / SECTOR_SIZE, 2));
    else range = gt('Design Fuel Range System Description', `${roundAway((design.maximumRange() / 48000.0) * 100)}%`);
    void num2;
    return {
        moving: design.topSpeed > 0,
        speeds: [MOVEMENT_IMPULSE_SPEED, design.cruiseSpeed, design.topSpeed, design.warpSpeed],
        burns,
        staticY: y(usage),
        curve,
        acceleration: `${gt('Acceleration')}: ${upToOneDecimal(design.accelerationRate)}/${gt('seconds abbreviation')}`,
        turnRate: `${gt('Turn Rate')}: ${roundAway(design.turnRate * (180.0 / Math.PI))}°/${gt('seconds abbreviation')}`,
        range,
    };
}

function joinOrNone(parts: string[]): string {
    return parts.length > 0 ? parts.join(', ') : none();
}

export interface IndustryPanel {
    rows: StatRow[];
    /** "Recreation" (drawn on the Medical row's right half). */
    recreation: StatRow;
}

// Port of DesignIndustry.cs DrawIndustryInfo.
export function designIndustryPanel(design: Design): IndustryPanel {
    const lower = (k: string): string => gt(k).toLowerCase();
    const research: string[] = [];
    if (design.researchWeapons > 0) research.push(`W:${thousandsK(design.researchWeapons)}`);
    if (design.researchEnergy > 0) research.push(`E:${thousandsK(design.researchEnergy)}`);
    if (design.researchHighTech > 0) research.push(`H:${thousandsK(design.researchHighTech)}`);
    const mining: string[] = [];
    if (design.extractionMine > 0) mining.push(`${intText(design.extractionMine)} ${lower('Normal')}`);
    if (design.extractionGas > 0) mining.push(`${intText(design.extractionGas)} ${lower('Gas')}`);
    if (design.extractionLuxury > 0) mining.push(`${intText(design.extractionLuxury)} ${lower('Luxury')}`);
    const manufacture: string[] = [];
    if (design.manufactureWeapons > 0) manufacture.push(`W:${thousandsK(design.manufactureWeapons)}`);
    if (design.manufactureEnergy > 0) manufacture.push(`E:${thousandsK(design.manufactureEnergy)}`);
    if (design.manufactureHighTech > 0) manufacture.push(`H:${thousandsK(design.manufactureHighTech)}`);
    return {
        rows: [
            { label: gt('Cargo Capacity'), value: design.cargoCapacity > 0 ? intText(design.cargoCapacity) : none() },
            { label: gt('Medical'), value: design.medicalCapacity > 0 ? intText(design.medicalCapacity) : none() },
            { label: gt('Research'), value: joinOrNone(research) },
            { label: gt('Mining'), value: joinOrNone(mining) },
            { label: gt('Manufacturing'), value: joinOrNone(manufacture) },
            { label: gt('Construction'), value: design.constructionYardCount > 0 ? `${design.constructionYardCount} ${lower('Yards')}` : none() },
            { label: gt('Docking Bays'), value: design.dockingBayCount > 0 ? `${design.dockingBayCount} ${lower('Bays')}` : none() },
        ],
        recreation: { label: gt('Recreation'), value: design.recreationCapacity > 0 ? intText(design.recreationCapacity) : none() },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Weapons panel (pnlDesignWeapons)
// ---------------------------------------------------------------------------------------------------------------------

/** The right column of pnlDesignWeapons (Main.Part9.cs:5081-5153), label at x ≈ 345, value at x 480, 15 px rows. */
export function designWeaponSummary(design: Design, player: Empire | null): StatRow[] {
    const rows: StatRow[] = [];
    rows.push({ label: gt('Firepower'), value: intText(design.firepowerRaw) });
    rows.push({ label: gt('Range Shortest/Longest'), value: `${intText(design.minimumWeaponsRange)}/${intText(design.maximumWeaponsRange)}` });
    // Fighter Firepower: the latest bomber's and interceptor's damage × the bays' fighters split between the two kinds.
    let fighters = none();
    let num = 0;
    if (design.fighterCapacity > 0) {
        num = Math.trunc(design.fighterCapacity / 10);
        fighters = String(num);
    }
    let num2 = 0;
    if (player !== null && player.research) {
        const bomber = identifyLatestBomberSpecification(player);
        const fighter = identifyLatestFighterSpecification(player);
        let num5 = 0;
        if (bomber !== null) num5++;
        if (fighter !== null) num5++;
        if (num5 > 0) {
            const num6 = Math.trunc(num / num5);
            if (bomber !== null) num2 += bomber.weaponDamage * num6;
            if (fighter !== null) num2 += fighter.weaponDamage * num6;
        }
    }
    rows.push({ label: gt('Fighter Firepower'), value: String(num2) });
    rows.push({ label: gt('Fighter Capacity'), value: fighters });
    rows.push({ label: gt('Targetting'), value: design.targettingModifier > 0 ? `+${intText(design.targettingModifier)}%` : none() });
    rows.push({ label: gt('Fleet Targeting'), value: design.fleetTargettingModifier > 0 ? `+${intText(design.fleetTargettingModifier)}%` : none() });
    rows.push({ label: gt('Troops'), value: intText(design.troopCapacity) });
    rows.push({ label: gt('Boarding Assault'), value: String(calculateBoardingAssaultValue(design, player?.dominantRace ?? null)) });
    rows.push({ label: gt('HyperDeny'), value: intText(design.weaponHyperDenyRange) });
    rows.push({ label: gt('Hyper Disruption'), value: intText(design.hyperStopRange) });
    let pd = 0;
    for (const w of design.weapons) if (w?.component && w.component.type === ComponentType.WeaponPointDefense) pd += w.rawDamage;
    rows.push({ label: gt('Component Type Point Defense'), value: String(pd) });
    rows.push({ label: gt('Bombard'), value: intText(design.bombardPower) });
    return rows;
}

/** WeaponListView.BindData's rows: every weapon but assault pods. */
export interface WeaponRow {
    component: ComponentDefinition;
    name: string;
    range: number;
    rawDamage: number;
    minDamage: number;
    /** GenerateDamageGraph's polygon (graph pixels). */
    polygon: { x: number; y: number }[];
    tooltip: string;
}

// Port of WeaponListView.cs GenerateDamageGraph: a red wedge from the raw damage at range 0 to the damage left at the
// weapon's range, over a 990-unit range axis.
export function damageGraphPolygon(rawDamage: number, damageLoss: number, range: number, width: number, height: number): { x: number; y: number }[] {
    const num1 = damageLoss * (range / 100.0);
    const num2 = Math.trunc(rawDamage - num1);
    const num3 = height / 2.0 / 50.0;
    const num4 = width / 990.0;
    const num5 = Math.trunc(height / 2.0);
    const num6 = (rawDamage * num3) / 2.0;
    const num7 = (num2 * num3) / 2.0;
    const x = Math.trunc(range * num4);
    return [
        { x: 0, y: Math.trunc(num5 - num6) },
        { x: 0, y: Math.trunc(num5 + num6) },
        { x, y: Math.trunc(num5 + num7) },
        { x, y: Math.trunc(num5 - num7) },
    ];
}

export function designWeaponRows(design: Design, graphWidth = 150, graphHeight = 17): WeaponRow[] {
    const out: WeaponRow[] = [];
    for (const w of design.weapons) {
        if (!w?.component || w.component.type === ComponentType.AssaultPod) continue;
        const minDamage = Math.trunc(w.rawDamage - w.damageLoss * (w.range / 100.0));
        out.push({
            component: w.component.def,
            name: w.component.def.name,
            range: w.range,
            rawDamage: w.rawDamage,
            minDamage,
            polygon: damageGraphPolygon(w.rawDamage, w.damageLoss, w.range, graphWidth, graphHeight),
            tooltip: `${gt('Range')}: ${w.range}, ${gt('Maximum Damage')}: ${w.rawDamage}, ${gt('Minimum Damage')}: ${minDamage}`,
        });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------------------------------------------------

// Port of Galaxy.2.cs:2189 ResolveComponentCategoryAbbreviation.
export function componentCategoryAbbreviation(category: ComponentCategoryType): string {
    const C = ComponentCategoryType;
    switch (category) {
        case C.Armor: return 'ARM';
        case C.Computer: return 'CMP';
        case C.Construction: return 'CST';
        case C.EnergyCollector: return 'ECL';
        case C.Engine: return 'ENG';
        case C.Extractor: return 'EXT';
        case C.Habitation: return 'HAB';
        case C.HyperDrive: return 'HYP';
        case C.Labs: return 'LAB';
        case C.Manufacturer: return 'MNF';
        case C.Reactor: return 'RCT';
        case C.Sensor: return 'SEN';
        case C.Shields: return 'SHD';
        case C.ShieldRecharge: return 'SHR';
        case C.Storage: return 'STR';
        case C.WeaponArea: return 'WAR';
        case C.WeaponBeam: return 'WBM';
        case C.WeaponSuperArea: return 'WSA';
        case C.WeaponSuperBeam: return 'WSB';
        case C.WeaponSuperTorpedo: return 'WST';
        case C.WeaponTorpedo: return 'WTP';
        case C.Fighter: return 'FTR';
        case C.WeaponPointDefense: return 'WPD';
        case C.WeaponIon: return 'WIO';
        case C.HyperDisrupt: return 'HDR';
        case C.WeaponGravity: return 'WGR';
        case C.AssaultPod: return 'ASP';
        default: return '';
    }
}

/** images/ui/components/Component_<PictureRef>.bmp (the componentImages the list views bind). */
export function componentImageUrl(pictureRef: number): string {
    return `/assets/dwu/images/ui/components/Component_${pictureRef}.bmp`;
}

/** ComponentListView.BindData (non-summarized): the resources the empire does not supply ((255, 128, 0) name, tooltip). */
export function missingComponentResources(component: ComponentDefinition, supplied: ReadonlySet<number> | null, resourceName: (id: number) => string): string | null {
    if (supplied === null) return null;
    const missing: string[] = [];
    for (const r of component.resourceRequirements) if (!supplied.has(r.resourceId)) missing.push(resourceName(r.resourceId));
    return missing.length > 0 ? `${gt('Missing Component Resource Supply')} ${missing.join(', ')}` : null;
}

export interface ComponentDetailModel {
    title: string;
    type: string;
    sizeCost: string;
    staticEnergy: string;
    energyUsed: number;
    lines: { description: string; value: string | null }[];
}

const INDUSTRY_NAMES: Record<number, string> = {
    [IndustryType.Undefined]: 'Undefined',
    [IndustryType.Weapon]: 'Weapon',
    [IndustryType.Energy]: 'Energy',
    [IndustryType.HighTech]: 'HighTech',
};

// Port of Galaxy.5.cs:950 ResolveComponentDescriptionComplete as ComponentDetail.DrawComponentDetailInfo uses it (the
// improved values from the player's research; the research project's cost is left out — no FindProjectForComponent).
export function componentDetailModel(player: Empire | null, component: ComponentDefinition): ComponentDetailModel {
    const imp = player?.research ? player.research.resolveImprovedComponentValues(component) : null;
    let type = `${resolveComponentTypeDescription(component.type)} (${INDUSTRY_NAMES[component.industry] ?? ''})`;
    if (component.category === ComponentCategoryType.WeaponTorpedo && component.value7 > 0) {
        type = `${gt('Bombarding Torpedo Weapon')} (${INDUSTRY_NAMES[component.industry] ?? ''})`;
    }
    const galaxy = (player?.galaxy as Parameters<typeof resolveComponentDescriptionDetailed>[0]) ?? null;
    const detail = resolveComponentDescriptionDetailed(galaxy, component, imp ?? component, null);
    const lines: { description: string; value: string | null }[] = [];
    for (let i = 0; i < detail.descriptions.length; i++) {
        const d = detail.descriptions[i];
        if (d !== null && d !== '') lines.push({ description: d, value: detail.values[i] !== null && detail.values[i] !== '' ? detail.values[i] : null });
    }
    return {
        title: component.name,
        type,
        sizeCost: `${gt('Size')}:${component.size}`,
        staticEnergy: String(component.energyUsed),
        energyUsed: component.energyUsed,
        lines,
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Designs window
// ---------------------------------------------------------------------------------------------------------------------

// Port of Main.Part8.cs:808 method_305: "Maximum Ship size: N[, C:n][, M:n]\nMaximum Base size: N (when not at colony)".
export function maximumSizeText(empire: Pick<Empire, 'maximumConstructionSize' | 'maximumConstructionSizeBase'>): string {
    const num = empire.maximumConstructionSize();
    const num2 = empire.maximumConstructionSize(BuiltObjectSubRole.SmallFreighter);
    const num3 = empire.maximumConstructionSize(BuiltObjectSubRole.Frigate);
    let text = String(num);
    if (num2 !== num) text += `, C:${num2}`;
    if (num3 !== num) text += `, M:${num3}`;
    return `${gt('Maximum Ship size')}: ${text}\n${gt('Maximum Base size')}: ${empire.maximumConstructionSizeBase()} (${gt('when not at colony')})`;
}

/** BuiltObjectImageCache.GetImagesSmall().Length: every pictureRef the picture combo lists. */
export const SHIP_PICTURE_COUNT = STANDARD_SHIP_IMAGE_START_INDEX + STANDARD_FAMILY_COUNT * SHIP_SET_IMAGE_COUNT;

/** The picture combo's groups (our addition: a heading per ship family; the original is one flat list). */
export function shipPictureGroups(): { label: string; first: number; last: number }[] {
    const out = [{ label: gt('Other'), first: 0, last: STANDARD_SHIP_IMAGE_START_INDEX - 1 }];
    for (let f = 0; f < STANDARD_FAMILY_COUNT; f++) {
        const first = STANDARD_SHIP_IMAGE_START_INDEX + f * SHIP_SET_IMAGE_COUNT;
        out.push({ label: `${gt('Family')} ${f + 1}`, first, last: first + SHIP_SET_IMAGE_COUNT - 1 });
    }
    return out;
}
