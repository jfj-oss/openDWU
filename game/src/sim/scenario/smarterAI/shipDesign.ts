// Smarter AI add-on, ship design part (scenarios/smarter-ai). Not a port.
//
// One scenario query, `aiDesignTweak` (designGeneration.ts createNewDesigns, before the stock PlaceComponentsOnDesign),
// changes an AI empire's new warship design. Each change has its own sub flag under the master switch:
//   - smarterAIDesignTune "Mod-style designs": the pattern of the Extended AI Improvement Mod 1.05 warship templates
//     ($DWU/Customization/Extended AI Improvement Mod 1.05/designTemplates), applied on top of any race's template:
//       * no stealth cloak, tractor beam, assault pod or bombard weapon on warships, and no ion defence on escorts and
//         frigates (the mod keeps it from destroyers up) — unless the race's design tech focus names that component;
//       * engines × 1.5, fuel cells × 2, shields × 1.5, point defence capped at POINT_DEFENCE_CAP;
//       * fleet targeting and fleet countermeasures on escorts and frigates;
//       * races whose templates rely on stealth (a cloak on every warship template and Sensors as a design tech focus,
//         e.g. the Ketarov) are left alone.
//   - smarterAIWeaponFocus "One weapon type": weaponFocus.ts.
//   - smarterAIDesignScale "Bigger warships": destroyers and cruisers also grow towards SCALE_SHARE of the maximum
//     construction size (the stock capital ship / carrier size-up pass, Empire.10.cs 2269-2346), not while the empire
//     is in debt (taxes.ts debtWithHysteresis, read-only on the budget package's memory).
//   - smarterAIDesignTrim "Keep speed when trimming": an oversize warship loses armour, then extra weapons, before its
//     engines (the stock trim pass, Empire.10.cs 2681-2911, removes engines first).
// AI empires only (common.ts isSmarterAIEmpire), so galaxy setup is untouched. The empire's template is never
// mutated (a copy is changed). No Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { ComponentType } from '../../data/components';
import { ComponentCategoryType, resolveTechFocuses } from '../../data/policies';
import { DesignSpecificationComponentRuleType, newComponentRuleByType, type DesignSpecification, type DesignSpecificationComponentRule } from '../../data/designSpecifications';
import type { DesignPlacementTweak, DesignTrimFamily } from '../../designPlacement';
import { calculateAnnualCashflow } from '../../treasury';
import { registerScenarioQuery } from '../hooks';
import { SMARTER_AI_FLAG, isSmarterAIEmpire, smarterAIOn } from './common';
import { debtWithHysteresis, stateUpkeep } from './taxes';
import { SMARTER_AI_ECONOMY_STATE_KEY, type SmarterEconomyState } from './budget';
import { SMARTER_AI_WEAPON_FOCUS_FLAG, directFireFamily, empireWeaponFocus, familyTechLevels, mergeWeaponRules } from './weaponFocus';

export const SMARTER_AI_DESIGN_TUNE_FLAG = 'smarterAIDesignTune';
export const SMARTER_AI_DESIGN_SCALE_FLAG = 'smarterAIDesignScale';
export const SMARTER_AI_DESIGN_TRIM_FLAG = 'smarterAIDesignTrim';

export const ENGINE_FACTOR = 1.5;
export const FUEL_FACTOR = 2;
export const SHIELD_FACTOR = 1.5;
export const POINT_DEFENCE_CAP = 2;
/** Share of the maximum construction size destroyers and cruisers grow towards. */
export const SCALE_SHARE: Readonly<Partial<Record<BuiltObjectSubRole, number>>> = {
    [BuiltObjectSubRole.Destroyer]: 0.6,
    [BuiltObjectSubRole.Cruiser]: 0.8,
};
/** The trim order of "Keep speed when trimming": armour, then the extra weapons, before the engines. */
export const KEEP_SPEED_TRIM_ORDER: readonly DesignTrimFamily[] = ['gasExtractor', 'mineExtractor', 'luxuryExtractor', 'troop', 'passenger', 'armor', 'beam', 'torpedo', 'fighterBay', 'engine', 'shields', 'energyCollector'];

export const WARSHIP_SUB_ROLES: ReadonlySet<BuiltObjectSubRole> = new Set([
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.Carrier,
]);
const SMALL_HULLS: ReadonlySet<BuiltObjectSubRole> = new Set([BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate]);

export function cloneSpec(spec: DesignSpecification): DesignSpecification {
    return { ...spec, componentRules: spec.componentRules.map((r) => ({ ...r })) };
}

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
    for (const t of focusTypes) out.delete(t);
    return out;
}

/** "Mod-style designs" on `rules` (the caller's copy) for a `subRole` warship. Pure. Returns whether anything changed. */
export function tuneRules(rules: DesignSpecificationComponentRule[], subRole: BuiltObjectSubRole, focusTypes: readonly ComponentType[] = []): boolean {
    const drop = droppedTypes(subRole, focusTypes);
    let changed = false;
    const kept: DesignSpecificationComponentRule[] = [];
    for (const r of rules) {
        const isPod = r.componentCategory === ComponentCategoryType.AssaultPod;
        if (drop.has(r.componentType) || (isPod && drop.has(ComponentType.AssaultPod))) {
            changed = true;
            continue;
        }
        const before = r.amount;
        if (r.componentType === ComponentType.EngineMainThrust) r.amount = Math.round(r.amount * ENGINE_FACTOR);
        else if (r.componentType === ComponentType.StorageFuel) r.amount = Math.round(r.amount * FUEL_FACTOR);
        else if (r.componentCategory === ComponentCategoryType.Shields) r.amount = Math.round(r.amount * SHIELD_FACTOR);
        else if (r.componentCategory === ComponentCategoryType.WeaponPointDefense) r.amount = Math.min(r.amount, POINT_DEFENCE_CAP);
        if (r.amount !== before) changed = true;
        kept.push(r);
    }
    if (SMALL_HULLS.has(subRole)) {
        for (const t of [ComponentType.ComputerTargettingFleet, ComponentType.ComputerCountermeasuresFleet]) {
            if (hasType(kept, t)) continue;
            kept.push(newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, t, 1));
            changed = true;
        }
    }
    rules.length = 0;
    rules.push(...kept);
    return changed;
}

/** In debt by the add-on's test (read-only: the budget package's hysteresis memory is read, not written). */
export function designInDebt(galaxy: Galaxy, empire: Empire): boolean {
    const econ = galaxy.scenario?.state[SMARTER_AI_ECONOMY_STATE_KEY] as SmarterEconomyState | undefined;
    return debtWithHysteresis(econ?.debt[String(empire.empireId)] === true, empire.stateMoney, calculateAnnualCashflow(galaxy, empire), stateUpkeep(empire));
}

/** The tweak for `empire`'s new `spec.subRole` design (null: stock). */
export function smarterDesignTweak(galaxy: Galaxy, empire: Empire, spec: DesignSpecification): DesignPlacementTweak | null {
    if (!WARSHIP_SUB_ROLES.has(spec.subRole)) return null;
    const tune = smarterAIOn(galaxy, SMARTER_AI_DESIGN_TUNE_FLAG) && !reliesOnStealth(empire);
    const focusOn = smarterAIOn(galaxy, SMARTER_AI_WEAPON_FOCUS_FLAG);
    const share = smarterAIOn(galaxy, SMARTER_AI_DESIGN_SCALE_FLAG) ? (SCALE_SHARE[spec.subRole] ?? 0) : 0;
    const trim = smarterAIOn(galaxy, SMARTER_AI_DESIGN_TRIM_FLAG);
    let out: DesignSpecification | null = null;
    if (tune) {
        const s = cloneSpec(spec);
        if (tuneRules(s.componentRules, s.subRole, resolveTechFocuses(empire.policy).types)) out = s;
    }
    if (focusOn) {
        const focus = empireWeaponFocus(galaxy, empire);
        if (focus !== null) {
            const s = out ?? cloneSpec(spec);
            if (mergeWeaponRules(s.componentRules, s.subRole, focus, directFireFamily(familyTechLevels(empire.research)))) out = s;
        }
    }
    const scaleShare = share > 0 && !designInDebt(galaxy, empire) ? share : 0;
    if (out === null && scaleShare === 0 && !trim) return null;
    return { spec: out ?? spec, scaleShare, trimOrder: trim ? KEEP_SPEED_TRIM_ORDER : null };
}

registerScenarioQuery({
    id: 'smarterAI.design',
    query: 'aiDesignTweak',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, spec }) => {
        if (value !== null || !isSmarterAIEmpire(galaxy, empire)) return value;
        return smarterDesignTweak(galaxy, empire, spec);
    },
});
