// Smarter AI add-on, ship design part: one weapon type (scenarios/smarter-ai, flag smarterAIWeaponFocus). Not a port.
//
// The Extended AI Improvement Mod 1.05 gives every race's warship templates one weapon family. Here that is done per
// empire from its research instead of per race by hand: the main weapon slots of a warship template (beam weapons of
// any kind, torpedoes and missiles, fighter bays) are merged into one rule of the family where the empire's research
// is furthest ahead (the highest tech level of a researched component of that family, improvements included). The
// focus is remembered per empire and moves only when another family gets ahead by more than SWITCH_MARGIN tech levels.
//   - Fighters replace the guns only on cruisers and capital ships (FIGHTER_HULLS), at one bay per FIGHTER_BAY_SLOTS
//     weapon slots; smaller hulls take the better direct-fire family. A carrier keeps its own fighter bays and merges
//     only its other weapons.
//   - Point defence, ion, gravity, area and super weapons are not main weapons and stay as the template has them.
// AI empires only (common.ts isSmarterAIEmpire). The template is never mutated (the caller clones it). No Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { ComponentDefinition } from '../../componentStatic';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { ComponentType } from '../../data/components';
import { ComponentCategoryType } from '../../data/policies';
import { DesignSpecificationComponentRuleType, newComponentRuleByCategory, newComponentRuleByType, type DesignSpecificationComponentRule } from '../../data/designSpecifications';
import type { ResearchSystem } from '../../researchSystem';
import { scenarioState } from '../state';

export const SMARTER_AI_WEAPON_FOCUS_FLAG = 'smarterAIWeaponFocus';
export const SMARTER_AI_DESIGN_STATE_KEY = 'smarterAIDesign';
/** Another family must lead the current focus by more than this many tech levels to take over. */
export const SWITCH_MARGIN = 1;
/** Weapon slots per fighter bay when fighters take the guns' place. */
export const FIGHTER_BAY_SLOTS = 3;
export const FIGHTER_HULLS: ReadonlySet<BuiltObjectSubRole> = new Set([BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip]);

export type WeaponFamily = 'beam' | 'torpedo' | 'fighter';
export const WEAPON_FAMILIES: readonly WeaponFamily[] = ['beam', 'torpedo', 'fighter'];

/** galaxy.scenario.state.smarterAIDesign (plain data, saved with the game). Keys are empire ids. */
export interface SmarterAIDesignState {
    focus: Record<string, WeaponFamily>;
}

export function smarterAIDesignState(galaxy: Galaxy): SmarterAIDesignState {
    return scenarioState<SmarterAIDesignState>(galaxy, SMARTER_AI_DESIGN_STATE_KEY, () => ({ focus: {} }));
}

export function componentFamily(c: { type: ComponentType; category: ComponentCategoryType }): WeaponFamily | null {
    if (c.type === ComponentType.FighterBay) return 'fighter';
    if (c.category === ComponentCategoryType.WeaponBeam) return 'beam';
    if (c.category === ComponentCategoryType.WeaponTorpedo && c.type !== ComponentType.WeaponBombard) return 'torpedo';
    return null;
}

/** The family of a template rule (null: not a main weapon). */
export function ruleFamily(r: DesignSpecificationComponentRule): WeaponFamily | null {
    return componentFamily({ type: r.componentType, category: r.componentCategory });
}

/** Per family, the highest tech level among the researched components (improvements included); 0 = none researched. */
export function familyTechLevels(research: ResearchSystem): Record<WeaponFamily, number> {
    const out: Record<WeaponFamily, number> = { beam: 0, torpedo: 0, fighter: 0 };
    for (const c of research.researchedComponents as ComponentDefinition[]) {
        const f = componentFamily(c);
        if (f === null) continue;
        const lv = Math.max(c.techLevel, research.resolveImprovedComponentValues(c).techLevel, 1);
        if (lv > out[f]) out[f] = lv;
    }
    return out;
}

/** The focus: the leading family (ties: the current one, else beam > torpedo > fighter); the current one is kept until another leads it by more than SWITCH_MARGIN. Null when nothing is researched. Pure. */
export function pickWeaponFocus(levels: Record<WeaponFamily, number>, current: WeaponFamily | null): WeaponFamily | null {
    let best: WeaponFamily | null = null;
    for (const f of WEAPON_FAMILIES) {
        if (levels[f] <= 0) continue;
        if (best === null || levels[f] > levels[best] || (levels[f] === levels[best] && f === current)) best = f;
    }
    if (best === null) return current !== null && levels[current] > 0 ? current : null;
    if (current === null || levels[current] <= 0) return best;
    return levels[best] > levels[current] + SWITCH_MARGIN ? best : current;
}

/** The empire's weapon focus, re-evaluated (and remembered) on every call. */
export function empireWeaponFocus(galaxy: Galaxy, empire: Empire): WeaponFamily | null {
    const st = smarterAIDesignState(galaxy);
    const key = String(empire.empireId);
    const focus = pickWeaponFocus(familyTechLevels(empire.research), st.focus[key] ?? null);
    if (focus !== null) st.focus[key] = focus;
    return focus;
}

/**
 * The template's main weapon rules merged into `focus` (in place on `rules`, which must be the caller's own copy):
 * the merged rule takes the place of the first main weapon rule. A fighter focus on a small hull, or the merge on a
 * carrier, uses `directFire` (the better of beam / torpedo). Returns whether anything changed.
 */
export function mergeWeaponRules(rules: DesignSpecificationComponentRule[], subRole: BuiltObjectSubRole, focus: WeaponFamily, directFire: WeaponFamily): boolean {
    const carrier = subRole === BuiltObjectSubRole.Carrier;
    const target: WeaponFamily = focus === 'fighter' && (carrier || !FIGHTER_HULLS.has(subRole)) ? directFire : focus;
    let slots = 0;
    let at = -1;
    let families = 0;
    const seen = new Set<WeaponFamily>();
    for (let i = rules.length - 1; i >= 0; i--) {
        const r = rules[i];
        const f = ruleFamily(r);
        if (f === null || r.componentRuleType !== DesignSpecificationComponentRuleType.MustHave) continue;
        if (carrier && f === 'fighter') continue;
        if (!seen.has(f)) {
            seen.add(f);
            families++;
        }
        slots += r.amount;
        at = i;
    }
    if (at < 0) return false;
    // Already a single rule of the target family: nothing to do.
    const only = rules.filter((r) => ruleFamily(r) !== null && r.componentRuleType === DesignSpecificationComponentRuleType.MustHave && !(carrier && ruleFamily(r) === 'fighter'));
    if (families === 1 && only.length === 1 && seen.has(target)) return false;
    const merged =
        target === 'fighter'
            ? newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, ComponentType.FighterBay, Math.max(1, Math.round(slots / FIGHTER_BAY_SLOTS)))
            : newComponentRuleByCategory(DesignSpecificationComponentRuleType.MustHave, target === 'beam' ? ComponentCategoryType.WeaponBeam : ComponentCategoryType.WeaponTorpedo, slots);
    const kept: DesignSpecificationComponentRule[] = [];
    for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        if (i === at) kept.push(merged);
        const f = ruleFamily(r);
        if (f !== null && r.componentRuleType === DesignSpecificationComponentRuleType.MustHave && !(carrier && f === 'fighter')) continue;
        kept.push(r);
    }
    rules.length = 0;
    rules.push(...kept);
    return true;
}

/** The better direct-fire family by tech level (beam on a tie or when neither is researched). */
export function directFireFamily(levels: Record<WeaponFamily, number>): WeaponFamily {
    return levels.torpedo > levels.beam ? 'torpedo' : 'beam';
}
