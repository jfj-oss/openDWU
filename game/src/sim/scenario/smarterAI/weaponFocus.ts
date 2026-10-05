// Smarter AI add-on, ship design part: one weapon type (scenarios/smarter-ai, flag smarterAIWeaponFocus). Not a port.
//
// The Extended AI Improvement Mod 1.05 gives every race's warship templates one long-range weapon family, picked by
// hand. Here the pick is by quality: of the empire's best component of each direct-fire weapon type (beams, phasers,
// railguns, torpedoes, missiles; ResearchSystem.EvaluateDesiredComponentImprovement, as the placement resolves a rule
// of that type), the one with the most damage per unit of space, weighted by the square root of its range over
// RANGE_REFERENCE (so a long-range torpedo is not swapped for a short-range phaser of similar damage). The template's
// main weapon rules (beam and torpedo families) are merged into one rule of that type; shipDesign.ts sets its count.
//   - Fighter bays stay a carrier's own weapon (and are clutter on other hulls: shipDesign.ts).
//   - Point defence, ion, gravity, area and super weapons are not main weapons and stay as the template has them.
// AI empires only (common.ts isSmarterAIEmpire). The template is never mutated (the caller clones it). No Rnd.

import type { ComponentImprovementEntry } from '../../componentStatic';
import { ComponentType } from '../../data/components';
import { ComponentCategoryType } from '../../data/policies';
import { DesignSpecificationComponentRuleType, newComponentRuleByType, type DesignSpecificationComponentRule } from '../../data/designSpecifications';
import type { ResearchSystem, ShipDesignFocus } from '../../researchSystem';

export const SMARTER_AI_WEAPON_FOCUS_FLAG = 'smarterAIWeaponFocus';
/** Range (in game units) at which a weapon's score is its plain damage per unit of space. */
export const RANGE_REFERENCE = 300;
/** The direct-fire weapon types the focus picks from. */
export const WEAPON_CANDIDATES: readonly ComponentType[] = [ComponentType.WeaponBeam, ComponentType.WeaponPhaser, ComponentType.WeaponRailGun, ComponentType.WeaponTorpedo, ComponentType.WeaponMissile];

export type WeaponFamily = 'beam' | 'torpedo' | 'fighter';

export function componentFamily(c: { type: ComponentType; category: ComponentCategoryType }): WeaponFamily | null {
    if (c.type === ComponentType.FighterBay) return 'fighter';
    if (c.category === ComponentCategoryType.WeaponBeam) return 'beam';
    if (c.category === ComponentCategoryType.WeaponTorpedo && c.type !== ComponentType.WeaponBombard) return 'torpedo';
    return null;
}

/** A main (merged) weapon: beam or torpedo family, not fighters. */
export function isMainWeapon(c: { type: ComponentType; category: ComponentCategoryType }): boolean {
    const f = componentFamily(c);
    return f === 'beam' || f === 'torpedo';
}

/** A template rule that is a main weapon slot. */
export function isMainWeaponRule(r: DesignSpecificationComponentRule): boolean {
    return r.componentRuleType === DesignSpecificationComponentRuleType.MustHave && isMainWeapon({ type: r.componentType, category: r.componentCategory });
}

/** Damage per unit of space × sqrt(range / RANGE_REFERENCE). 0 for a component that does no damage. Pure. */
export function weaponScore(ci: Pick<ComponentImprovementEntry, 'value1' | 'value2' | 'improvedComponent'>): number {
    const size = ci.improvedComponent.size;
    if (ci.value1 <= 0 || size <= 0) return 0;
    return (ci.value1 / size) * Math.sqrt(Math.max(1, ci.value2) / RANGE_REFERENCE);
}

export interface WeaponPick {
    type: ComponentType;
    ci: ComponentImprovementEntry;
    score: number;
}

/** The best-scoring researched direct-fire weapon type (ties: the earlier candidate); null when none is researched. */
export function pickBestWeapon(research: ResearchSystem, designFocus: ShipDesignFocus): WeaponPick | null {
    let best: WeaponPick | null = null;
    for (const type of WEAPON_CANDIDATES) {
        const ci = research.evaluateDesiredComponentImprovement(type, designFocus);
        if (ci === null) continue;
        const score = weaponScore(ci);
        if (score > 0 && (best === null || score > best.score)) best = { type, ci, score };
    }
    return best;
}

/**
 * The template's main weapon rules merged into one MustHave rule of `type` with `amount` slots, in place of the first
 * of them (in place on `rules`, which must be the caller's own copy). Returns the merged rule's index, or -1 when the
 * template has no main weapon rule (nothing changed).
 */
export function mergeWeaponRules(rules: DesignSpecificationComponentRule[], type: ComponentType, amount: number): number {
    const at = rules.findIndex(isMainWeaponRule);
    if (at < 0) return -1;
    const kept: DesignSpecificationComponentRule[] = [];
    let index = -1;
    for (let i = 0; i < rules.length; i++) {
        if (i === at) {
            index = kept.length;
            kept.push(newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, type, amount));
        }
        if (!isMainWeaponRule(rules[i])) kept.push(rules[i]);
    }
    rules.length = 0;
    rules.push(...kept);
    return index;
}
