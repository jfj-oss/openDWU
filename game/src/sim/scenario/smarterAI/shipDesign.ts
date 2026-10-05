// Smarter AI add-on, ship design part (scenarios/smarter-ai). Not a port.
//
// One scenario query, `aiDesignTweak` (designGeneration.ts createNewDesigns), lets the add-on choose an AI empire's new
// warship design (designPlacement.ts AIDesignChooser). The choice places the stock template first (the reference), then
// a changed template several times, and keeps the changed design only if it passes the safety net (below). Priority
// order: shields > firepower > fuel (operational range). Sub flags under the master switch, all off by default:
//   - smarterAIDesignTune "Mod-style designs", after the Extended AI Improvement Mod 1.05 warship templates
//     ($DWU/Customization/Extended AI Improvement Mod 1.05/designTemplates):
//       * clutter dropped: stealth cloaks, tractor beams, assault pods, bombard weapons, fighter bays on non-carriers,
//         ion defence on escorts and frigates (the mod keeps it from destroyers up), point defence capped at
//         POINT_DEFENCE_CAP — unless the race's design tech focus names that component;
//       * HyperDeny on cruisers and capital ships, a super beam on capital ships when researched (and the stock
//         super-weapon add-on, Empire.10.cs 2946-2977, does not give the race one already);
//       * engines × ENGINE_FACTOR on escorts and frigates only (stock counts from destroyers up); armour stays at the
//         stock design's count;
//       * the freed space: shields up to × 1.5, the extra engines, fuel up to FUEL_FACTOR (level 1 below);
//       * races whose templates rely on stealth (a cloak on every warship template and Sensors as a design tech
//         focus, e.g. the Ketarov) are left alone.
//   - smarterAIWeaponFocus "One weapon type": the main weapon slots merge into the best-quality weapon type
//     (weaponFocus.ts), sized to keep BASE_FIRE_SHARE of the stock design's firepower.
//   - smarterAIDesignScale "Bigger warships": the design may grow to SCALE_SHARE of the maximum construction size
//     while the economy carries it (designGrowthAffordable); otherwise it stays within the stock design's size.
//   - smarterAIDesignTrim "Trim by priority": a design over its size target loses, in turn, point defence beyond one,
//     fuel down to stock, the extra engines of escorts and frigates, weapons (not below MIN_FIRE_SHARE), shields
//     (not below stock); never armour, never engines below stock.
// The space up to the size target is filled level by level (FILL_LEVELS), each level shields, then weapons, then the
// extra engines of escorts and frigates, then fuel, one component at a time while it fits (and does not slow the
// hyperdrive): level 1 = shields × 1.5, firepower BASE_FIRE_SHARE, engines × ENGINE_FACTOR, fuel × FUEL_FACTOR; each
// further level +0.5 × stock shields and +0.2 × stock firepower (carriers: +0.25 × stock fighter bays).
// Safety net: the changed design is used only if it fits the maximum size, has at least MIN_FIRE_SHARE of the stock
// design's firepower, at least its shields and at least its hyperdrive speed; otherwise this review keeps the stock
// design.
// AI empires only (common.ts isSmarterAIEmpire), so galaxy setup is untouched. The empire's template is never
// mutated (copies are changed). No Rnd of its own (createNewDesigns replays the stock placement's draws).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { ComponentType } from '../../data/components';
import { ComponentCategoryType, resolveTechFocuses } from '../../data/policies';
import { DesignSpecificationComponentRuleType, newComponentRuleByCategory, newComponentRuleByType, type DesignSpecification, type DesignSpecificationComponentRule } from '../../data/designSpecifications';
import type { AIDesignChooser, DesignPlacementTweak, DesignPlacer } from '../../designPlacement';
import { ShipDesignFocus } from '../../researchSystem';
import { raceAggressionLevel } from '../../racePeriodic';
import { calculateAnnualCashflow, thisYearsForeignTradeBonuses, thisYearsResortIncome, thisYearsSpacePortIncome } from '../../treasury';
import { annualTaxRevenue, calculateAnnualSubjugationTributeIncome } from '../../forceStructure';
import { registerScenarioQuery } from '../hooks';
import { SMARTER_AI_FLAG, isSmarterAIEmpire, smarterAIOn } from './common';
import { debtWithHysteresis, stateUpkeep } from './taxes';
import { SMARTER_AI_ECONOMY_STATE_KEY, type SmarterEconomyState } from './budget';
import { SMARTER_AI_WEAPON_FOCUS_FLAG, isMainWeapon, isMainWeaponRule, mergeWeaponRules, pickBestWeapon } from './weaponFocus';

export const SMARTER_AI_DESIGN_TUNE_FLAG = 'smarterAIDesignTune';
export const SMARTER_AI_DESIGN_SCALE_FLAG = 'smarterAIDesignScale';
export const SMARTER_AI_DESIGN_TRIM_FLAG = 'smarterAIDesignTrim';

/** Engines on escorts and frigates (destroyers and up keep the template's count). */
export const ENGINE_FACTOR = 1.5;
/** Fuel cells: this × the template's (never fewer). */
export const FUEL_FACTOR = 2;
/** Shields at fill level 1, and the step per further level (× the template's). */
export const SHIELD_FACTOR = 1.5;
export const SHIELD_LEVEL_STEP = 0.5;
export const POINT_DEFENCE_CAP = 2;
/** Firepower kept by the weapon focus (share of the stock design's), and the step per further fill level. */
export const BASE_FIRE_SHARE = 0.8;
export const FIRE_LEVEL_STEP = 0.2;
/** Safety net: a changed design needs at least this share of the stock design's firepower. */
export const MIN_FIRE_SHARE = 0.75;
/** Carriers: fighter bays per further fill level (× the template's). */
export const FIGHTER_BAY_LEVEL_STEP = 0.25;
export const FILL_LEVELS = 4;
/** Size targets, as shares of the maximum construction size ("Bigger warships"). */
export const SCALE_SHARE: Readonly<Partial<Record<BuiltObjectSubRole, number>>> = {
    [BuiltObjectSubRole.Escort]: 0.3,
    [BuiltObjectSubRole.Frigate]: 0.4,
    [BuiltObjectSubRole.Destroyer]: 0.6,
    [BuiltObjectSubRole.Cruiser]: 0.8,
    [BuiltObjectSubRole.CapitalShip]: 1,
    [BuiltObjectSubRole.Carrier]: 1,
};
/** Growth needs warship upkeep below this share of annual income ... */
export const GROWTH_MAX_UPKEEP_SHARE = 0.35;
/** ... and this many years of state upkeep in cash (and not in debt). */
export const GROWTH_CASH_YEARS = 1;

export const WARSHIP_SUB_ROLES: ReadonlySet<BuiltObjectSubRole> = new Set([
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.Carrier,
]);
const SMALL_HULLS: ReadonlySet<BuiltObjectSubRole> = new Set([BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate]);
const HYPER_DENY_HULLS: ReadonlySet<BuiltObjectSubRole> = new Set([BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip]);

export function cloneSpec(spec: DesignSpecification): DesignSpecification {
    return { ...spec, componentRules: spec.componentRules.map((r) => ({ ...r })) };
}

const MH = DesignSpecificationComponentRuleType.MustHave;
const hasType = (rules: readonly DesignSpecificationComponentRule[], t: ComponentType): boolean => rules.some((r) => r.componentType === t && r.amount > 0);

/** The race's templates rely on stealth: every warship template has a cloak and Sensors is a design tech focus. */
export function reliesOnStealth(empire: Empire): boolean {
    const focus = resolveTechFocuses(empire.policy);
    if (!focus.categories.includes(ComponentCategoryType.Sensor)) return false;
    let warships = 0;
    for (const s of empire.designSpecifications) {
        if (s === null || !WARSHIP_SUB_ROLES.has(s.subRole)) continue;
        warships++;
        if (!hasType(s.componentRules, ComponentType.SensorStealth)) return false;
    }
    return warships > 0;
}

/** The components "Mod-style designs" drops from this hull, minus those the tech focus names. */
function droppedTypes(subRole: BuiltObjectSubRole, focusTypes: readonly ComponentType[]): Set<ComponentType> {
    const out = new Set<ComponentType>([ComponentType.SensorStealth, ComponentType.WeaponTractorBeam, ComponentType.AssaultPod, ComponentType.WeaponBombard]);
    if (SMALL_HULLS.has(subRole)) out.add(ComponentType.WeaponIonDefense);
    if (subRole !== BuiltObjectSubRole.Carrier) out.add(ComponentType.FighterBay);
    for (const t of focusTypes) out.delete(t);
    return out;
}

export interface TuneExtras {
    /** Add a HyperDeny rule (cruisers and capital ships). */
    hyperDeny: boolean;
    /** Add a super beam rule (capital ships with one researched, when the stock add-on gives none). */
    superBeam: boolean;
}

/**
 * The rule part of "Mod-style designs" on `rules` (the caller's copy) for a `subRole` warship: clutter dropped,
 * HyperDeny / super beam added. The counts (engines, point defence, shields, fuel)
 * are set by planRules and the fill (chooseDesign). Pure. Returns whether anything changed.
 */
export function tuneRules(rules: DesignSpecificationComponentRule[], subRole: BuiltObjectSubRole, focusTypes: readonly ComponentType[] = [], extras: TuneExtras = { hyperDeny: false, superBeam: false }): boolean {
    const drop = droppedTypes(subRole, focusTypes);
    const kept = rules.filter((r) => {
        const isPod = r.componentCategory === ComponentCategoryType.AssaultPod;
        const isBay = r.componentType === ComponentType.FighterBay || r.componentCategory === ComponentCategoryType.Fighter;
        return !(drop.has(r.componentType) || (isPod && drop.has(ComponentType.AssaultPod)) || (isBay && drop.has(ComponentType.FighterBay)));
    });
    let changed = kept.length !== rules.length;
    const add = (t: ComponentType): void => {
        if (hasType(kept, t)) return;
        kept.push(newComponentRuleByType(MH, t, 1));
        changed = true;
    };
    if (extras.hyperDeny && HYPER_DENY_HULLS.has(subRole)) add(ComponentType.HyperDeny);
    if (extras.superBeam && subRole === BuiltObjectSubRole.CapitalShip) add(ComponentType.WeaponSuperBeam);
    rules.length = 0;
    rules.push(...kept);
    return changed;
}

/** In debt by the add-on's test (read-only: the budget package's hysteresis memory is read, not written). */
export function designInDebt(galaxy: Galaxy, empire: Empire): boolean {
    const econ = galaxy.scenario?.state[SMARTER_AI_ECONOMY_STATE_KEY] as SmarterEconomyState | undefined;
    return debtWithHysteresis(econ?.debt[String(empire.empireId)] === true, empire.stateMoney, calculateAnnualCashflow(galaxy, empire), stateUpkeep(empire));
}

/** Annual income, the revenue side of treasury.ts calculateAnnualCashflow. */
export function annualIncome(galaxy: Galaxy, empire: Empire): number {
    return annualTaxRevenue(galaxy, empire) + thisYearsForeignTradeBonuses(empire) + thisYearsSpacePortIncome(galaxy, empire) + thisYearsResortIncome(galaxy, empire) + calculateAnnualSubjugationTributeIncome(galaxy, empire);
}

/** Annual upkeep of the empire's warships (treasury.ts annualStateMaintenanceExcludingUnderConstruction, warships only). */
export function warshipUpkeep(empire: Empire): number {
    let sum = 0;
    for (const bo of empire.builtObjects) if (bo.unbuiltComponentCount <= 0 && WARSHIP_SUB_ROLES.has(bo.subRole)) sum += bo.annualSupportCost;
    return sum * (1 - empire.shipMaintenanceSavings);
}

/** "Bigger warships" may grow a design: warship upkeep below GROWTH_MAX_UPKEEP_SHARE of income, GROWTH_CASH_YEARS of upkeep in cash, not in debt. */
export function designGrowthAffordable(galaxy: Galaxy, empire: Empire): boolean {
    const income = annualIncome(galaxy, empire);
    if (!(income > 0) || designInDebt(galaxy, empire)) return false;
    if (empire.stateMoney < GROWTH_CASH_YEARS * stateUpkeep(empire)) return false;
    return warshipUpkeep(empire) < GROWTH_MAX_UPKEEP_SHARE * income;
}

export interface DesignStats {
    size: number;
    fire: number;
    shields: number;
    fuel: number;
    warp: number;
}

/** The figures the choice weighs, from `d` as `empire` would build it (Design.ReDefine with its research). */
export function designStats(empire: Empire, d: Design): DesignStats {
    d.empire = empire;
    d.reDefine();
    return { size: d.quickCalculateSize(), fire: d.firepowerRaw, shields: d.shieldsCapacity, fuel: d.fuelCapacity, warp: d.warpSpeed };
}

/**
 * The safety net: `d` fits `maxSize`, keeps MIN_FIRE_SHARE of the stock firepower, at least the stock shields and at
 * least the stock hyperdrive speed (fewer weapons can mean fewer reactors, and Design.ReDefine then slows the jump). Pure.
 */
export function passesSafetyNet(d: DesignStats, stock: DesignStats, maxSize: number): boolean {
    return d.size <= maxSize && d.fire >= MIN_FIRE_SHARE * stock.fire && d.shields >= stock.shields && d.warp >= stock.warp;
}

export interface DesignOptions {
    tune: boolean;
    focus: boolean;
    /** Size target share of the maximum construction size (0: stay within the stock design's size). */
    share: number;
    trim: boolean;
    /** Tune extras (resolved from research and race). */
    extras: TuneExtras;
    focusTypes: readonly ComponentType[];
    designFocus: ShipDesignFocus;
}

type Family = 'shields' | 'weapons' | 'fuel' | 'engines' | 'pd' | 'armor';
const FAMILIES: readonly Family[] = ['shields', 'weapons', 'fuel', 'engines', 'pd', 'armor'];
const FILL_ORDER: readonly Family[] = ['shields', 'weapons', 'engines', 'fuel'];
const TRIM_ORDER: readonly Family[] = ['pd', 'fuel', 'engines', 'weapons', 'shields'];

/** One adjustable family of rules: the first MustHave rule (`index`) takes the changes, the others keep `others`. */
interface Handle {
    index: number;
    others: number;
    /** The stock design's count (the reference for the floors and the fill levels). */
    stock: number;
    /** Floor of the family's total (trimming stops there). */
    floor: number;
}

function ruleFamily(r: DesignSpecificationComponentRule, carrier: boolean): Family | null {
    if (r.componentRuleType !== MH) return null;
    return componentFamilyOf({ type: r.componentType, category: r.componentCategory }, carrier);
}

function componentFamilyOf(c: { type: ComponentType; category: ComponentCategoryType }, carrier: boolean): Family | null {
    if (c.category === ComponentCategoryType.Shields) return 'shields';
    if (c.category === ComponentCategoryType.Armor) return 'armor';
    if (c.type === ComponentType.StorageFuel) return 'fuel';
    if (c.type === ComponentType.EngineMainThrust) return 'engines';
    if (c.category === ComponentCategoryType.WeaponPointDefense) return 'pd';
    if (carrier ? c.type === ComponentType.FighterBay : isMainWeapon(c)) return 'weapons';
    return null;
}

/**
 * Per family, the count in the stock design `stock` placed from `spec` (capital ships and carriers: after the stock
 * size-up and trim passes). Engines exclude the extra one per engine rule of the SpeedAgility design focus.
 */
export function stockFamilyCounts(spec: DesignSpecification, stock: Design, speedAgility: boolean): Record<Family, number> {
    const carrier = spec.subRole === BuiltObjectSubRole.Carrier;
    const out: Record<Family, number> = { shields: 0, weapons: 0, fuel: 0, engines: 0, pd: 0, armor: 0 };
    for (const c of stock.components) {
        const f = componentFamilyOf(c, carrier);
        if (f !== null) out[f]++;
    }
    if (speedAgility) out.engines = Math.max(0, out.engines - spec.componentRules.filter((r) => ruleFamily(r, carrier) === 'engines').length);
    return out;
}

/**
 * The changed template's rules and its adjustable families (pure on `spec`): tune and focus applied, every family set
 * to its starting count (`counts`: the stock design's; point defence capped when tuning, weapons as the focus sizes them), a shields and a fuel rule added when tuning a template
 * without one. `stock` is the stock design's figures, `mainFire` its main-weapon firepower.
 */
export function planRules(
    spec: DesignSpecification,
    opts: DesignOptions,
    research: Parameters<typeof pickBestWeapon>[0],
    stock: DesignStats,
    mainFire: number,
    counts: Record<Family, number>,
): { rules: DesignSpecificationComponentRule[]; handles: Partial<Record<Family, Handle>> } {
    const carrier = spec.subRole === BuiltObjectSubRole.Carrier;
    const rules = spec.componentRules.map((r) => ({ ...r }));
    const start: Record<Family, number> = { ...counts };
    if (opts.tune) {
        tuneRules(rules, spec.subRole, opts.focusTypes, opts.extras);
        if (!rules.some((r) => ruleFamily(r, carrier) === 'shields')) rules.push(newComponentRuleByCategory(MH, ComponentCategoryType.Shields, 0));
        if (!rules.some((r) => ruleFamily(r, carrier) === 'fuel')) rules.push(newComponentRuleByType(MH, ComponentType.StorageFuel, 0));
        start.pd = Math.min(counts.pd, POINT_DEFENCE_CAP);
    }
    if (opts.focus) {
        const pick = pickBestWeapon(research, opts.designFocus);
        const slots = rules.reduce((sum, r) => sum + (isMainWeaponRule(r) ? r.amount : 0), 0);
        if (pick !== null && slots > 0) {
            const kept = stock.fire - mainFire;
            const n = stock.fire > 0 ? Math.max(1, Math.ceil((BASE_FIRE_SHARE * stock.fire - kept) / Math.max(1, pick.ci.value1))) : slots;
            mergeWeaponRules(rules, pick.type, n);
            if (!carrier) start.weapons = n;
        }
    }
    const handles: Partial<Record<Family, Handle>> = {};
    for (const f of FAMILIES) {
        const index = rules.findIndex((r) => ruleFamily(r, carrier) === f);
        if (index < 0) continue;
        // The non-carrier weapons without a focus keep the template's rules (several families).
        const total = f === 'weapons' && !carrier && !opts.focus ? rules.reduce((sum, r) => sum + (ruleFamily(r, carrier) === f ? r.amount : 0), 0) : start[f];
        const others = rules.reduce((sum, r, i) => sum + (i !== index && ruleFamily(r, carrier) === f ? r.amount : 0), 0);
        rules[index].amount = Math.max(0, total - others);
        // Floors: shields, fuel, engines and armour never below the stock design's; point defence keeps one; weapons
        // keep one slot (the firepower floor is checked on the placed design).
        const floor = f === 'pd' ? Math.min(1, total) : f === 'weapons' ? Math.max(others, 1) : Math.max(others, Math.min(total, counts[f]));
        handles[f] = { index, others, stock: counts[f], floor };
    }
    return { rules, handles };
}

/**
 * The design for `spec` (see the file comment): `place` is createNewDesigns' placer, `maxShipSize` the hard size limit.
 * Returns the stock design when the changed one fails the safety net.
 */
export function chooseDesign(empire: Empire, spec: DesignSpecification, opts: DesignOptions, place: DesignPlacer, maxShipSize: number): Design | null {
    const stock = place(spec, null);
    if (stock === null) return null;
    const s0 = designStats(empire, stock);
    let mainFire = 0;
    for (const c of stock.components) {
        if (!isMainWeapon(c)) continue;
        const v = empire.research.resolveImprovedComponentValues(c).value1;
        if (v > 0) mainFire += v;
    }
    const carrier = spec.subRole === BuiltObjectSubRole.Carrier;
    const counts = stockFamilyCounts(spec, stock, empire.policy?.researchDesignOverallFocus === ShipDesignFocus.SpeedAgility);
    const { rules, handles } = planRules(spec, opts, empire.research, s0, mainFire, counts);
    const target = Math.min(maxShipSize, Math.max(s0.size, Math.trunc(opts.share * maxShipSize)));
    const count = (f: Family): number => {
        const h = handles[f]!;
        return h.others + rules[h.index].amount;
    };
    const setCount = (f: Family, n: number): void => {
        const h = handles[f]!;
        rules[h.index].amount = Math.max(0, n - h.others);
    };
    const tryPlace = (): { d: Design; s: DesignStats } | null => {
        const tweak: DesignPlacementTweak = { spec: { ...spec, componentRules: rules.map((r) => ({ ...r })) }, scaleShare: 0, trimOrder: opts.trim ? [] : null };
        const d = place(tweak.spec, tweak);
        return d === null ? null : { d, s: designStats(empire, d) };
    };
    let best = tryPlace();
    if (best === null) return stock;
    // Trim by priority while over the size target.
    if (opts.trim && best.s.size > target) {
        for (const f of TRIM_ORDER) {
            const h = handles[f];
            if (h === undefined) continue;
            while (best.s.size > target && count(f) > h.floor) {
                setCount(f, count(f) - 1);
                const t = tryPlace();
                if (t === null || (f === 'weapons' && t.s.fire < MIN_FIRE_SHARE * s0.fire)) {
                    setCount(f, count(f) + 1);
                    break;
                }
                best = t;
            }
            if (best.s.size <= target) break;
        }
    }
    // Fill the space up to the target, level by level: shields, then weapons, then fuel.
    const wants = (f: Family, level: number, s: DesignStats): boolean => {
        const h = handles[f];
        if (h === undefined) return false;
        const extra = level - 1;
        switch (f) {
            case 'shields':
                if (level === 1 && !opts.tune) return false;
                return count(f) < Math.ceil(Math.max(1, h.stock) * (SHIELD_FACTOR + SHIELD_LEVEL_STEP * extra) - 1e-9);
            case 'weapons':
                if (carrier) return count(f) < Math.ceil(h.stock * (1 + FIGHTER_BAY_LEVEL_STEP * extra) - 1e-9);
                return s.fire < s0.fire * (BASE_FIRE_SHARE + FIRE_LEVEL_STEP * extra);
            case 'engines':
                return opts.tune && SMALL_HULLS.has(spec.subRole) && count(f) < Math.round(h.stock * ENGINE_FACTOR);
            case 'fuel':
                if (level === 1 && !opts.tune) return false;
                return count(f) < Math.max(1, h.stock) * FUEL_FACTOR;
            default:
                return false;
        }
    };
    const blocked = new Set<Family>();
    if (best.s.size <= target) {
        for (let level = 1; level <= FILL_LEVELS; level++) {
            for (const f of FILL_ORDER) {
                while (!blocked.has(f) && wants(f, level, best.s)) {
                    setCount(f, count(f) + 1);
                    const t = tryPlace();
                    // A step must fit and must not slow the hyperdrive (the reactors follow the energy use).
                    if (t === null || t.s.size > target || t.s.warp < Math.min(s0.warp, best.s.warp)) {
                        setCount(f, count(f) - 1);
                        blocked.add(f);
                        break;
                    }
                    best = t;
                }
            }
        }
    }
    return passesSafetyNet(best.s, s0, maxShipSize) ? best.d : stock;
}

/** The options for `empire`'s `subRole` design (null: every ship design switch is off, or not a warship). */
export function smarterDesignOptions(galaxy: Galaxy, empire: Empire, subRole: BuiltObjectSubRole): DesignOptions | null {
    if (!WARSHIP_SUB_ROLES.has(subRole)) return null;
    const tune = smarterAIOn(galaxy, SMARTER_AI_DESIGN_TUNE_FLAG) && !reliesOnStealth(empire);
    const focus = smarterAIOn(galaxy, SMARTER_AI_WEAPON_FOCUS_FLAG);
    const scale = smarterAIOn(galaxy, SMARTER_AI_DESIGN_SCALE_FLAG);
    const trim = smarterAIOn(galaxy, SMARTER_AI_DESIGN_TRIM_FLAG);
    if (!tune && !focus && !scale && !trim) return null;
    const share = scale && designGrowthAffordable(galaxy, empire) ? (SCALE_SHARE[subRole] ?? 0) : 0;
    const race = empire.dominantRace;
    const designFocus = race !== null && empire.policy !== null ? empire.policy.researchDesignOverallFocus : ShipDesignFocus.Balanced;
    // Empire.10.cs 2946-2977: the stock super-weapon add-on for aggressive, intelligent races.
    const stockSuper = race !== null && raceAggressionLevel(galaxy, race) >= 100 && race.intelligence >= 100;
    const superBeam = !stockSuper && empire.research.evaluateDesiredComponentImprovement(ComponentType.WeaponSuperBeam, ShipDesignFocus.Balanced) !== null;
    return { tune, focus, share, trim, extras: { hyperDeny: true, superBeam }, focusTypes: resolveTechFocuses(empire.policy).types, designFocus };
}

/** The design chooser for `empire`'s new `spec.subRole` design (null: stock). */
export function smarterDesignChooser(galaxy: Galaxy, empire: Empire, spec: DesignSpecification): AIDesignChooser | null {
    const opts = smarterDesignOptions(galaxy, empire, spec.subRole);
    if (opts === null) return null;
    return { choose: (place, maxShipSize) => chooseDesign(empire, spec, opts, place, maxShipSize) };
}

registerScenarioQuery({
    id: 'smarterAI.design',
    query: 'aiDesignTweak',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, spec }) => {
        if (value !== null || !isSmarterAIEmpire(galaxy, empire)) return value;
        return smarterDesignChooser(galaxy, empire, spec);
    },
});
