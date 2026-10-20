// Giantworks, the Beacon: the AI's answer to the Reclaimers' armour. Not a port.
//
// The Reclaimers' ships carry plates that cancel every hit at or under their reactive rating (beaconState P.fleetReactivePct of the
// plate's own: UltraDense 10 -> 6), and beams lose damage with range (weapons.ts weaponDamageDropoff), so an AI fleet of long-range
// beams mostly bounces off. Here the AI empires at war with the Reclaimers (any normal AI empire once the Reclamation's war is on)
// design their NEW warships for it (scenario query aiDesignTweak, after the BVR chooser and Smarter AI's, which it wraps like the
// decoys chooser does: the chooser that was already chosen places the design, then its weak guns are retargeted):
//   - generic over the age's research tree (no component is named): every researched main weapon type is scored by its net damage
//     per unit of space against the plates: its expected hit at the expected engagement range (param beaconAiRangePct of its range,
//     less the range drop-off) minus the plates' reactive rating, halved for the types the armour pass halves (netHit). Components of
//     the placed design whose type scores under KEEP_SHARE of the best are swapped for the best type, beaconAiShiftPct % of each type
//     (never the last MIN_GUNS), within the size limit (none gets through the plates: nothing changes);
//   - a warship design review is forced once per beaconAiRedesignYears of the war, so the new line exists when the fleets are needed.
// The stock retrofit (never at war) and Smarter AI's retrofit (every month, off the front) then bring the old ships to the newest design.
// No effect without the Beacon flag, on humans, pirates, the independents or the faction itself. No Rnd of its own (a forced review
// replays the stock placement's draws, as every design review does).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { ComponentType } from '../../../data/components';
import { ComponentCategoryType } from '../../../data/policies';
import type { Design } from '../../../design';
import type { DesignSpecification } from '../../../data/designSpecifications';
import type { AIDesignChooser } from '../../../designPlacement';
import { createNewDesigns } from '../../../designGeneration';
import { DiplomaticRelationType } from '../../../diplomacy';
import { isHumanEmpire } from '../../../humanEmpires';
import { ShipDesignFocus } from '../../../researchSystem';
import { galaxyStarDate } from '../../../tick/simTime';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { registerScenarioPeriodic, registerScenarioQuery } from '../../hooks';
import { scenarioParam, scenarioState } from '../../state';
import { bvrOn } from '../../bvr/bvr';
import { BEACON_FLAG, P, peekBeaconState, warOn, type BeaconState } from './beaconState';

export const DESIGN_KEY = 'beaconAiDesign';
/** A weapon type gives way when its net damage per unit of space is under this share of the best type's (the net: the hit less the plates' rating, halved for the weapons the armour pass halves). */
export const KEEP_SHARE = 0.6;
/** The guns a hull keeps whatever the shift (point defence against the Reclaimers' fighters and missiles, and the other wars). */
export const MIN_GUNS = 1;
/** Weapon types that are not a warship's main armament (point defence, utility, bombardment, fighters, ion). */
const NOT_MAIN: ReadonlySet<ComponentType> = new Set([
    ComponentType.WeaponBombard,
    ComponentType.WeaponPointDefense,
    ComponentType.WeaponTractorBeam,
    ComponentType.WeaponIonDefense,
    ComponentType.WeaponIonCannon,
    ComponentType.WeaponIonPulse,
    ComponentType.WeaponGravityBeam,
    ComponentType.FighterBay,
]);
const MAIN_CATEGORIES: ReadonlySet<ComponentCategoryType> = new Set([ComponentCategoryType.WeaponBeam, ComponentCategoryType.WeaponTorpedo]);

/** The main-weapon component types the empire has researched (generic: whatever the research tree of the age offers). */
export function mainWeaponTypes(empire: Empire): ComponentType[] {
    const out = new Set<ComponentType>();
    for (const c of empire.research.researchedComponents) if (MAIN_CATEGORIES.has(c.category) && !NOT_MAIN.has(c.type)) out.add(c.type);
    return [...out];
}
const WARSHIPS: ReadonlySet<BuiltObjectSubRole> = new Set([
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.Carrier,
]);

const shiftPct = (g: Galaxy): number => Math.max(0, Math.min(100, scenarioParam(g, 'beaconAiShiftPct', 60)));
const rangePct = (g: Galaxy): number => Math.max(0, Math.min(95, scenarioParam(g, 'beaconAiRangePct', 55)));
const redesignYears = (g: Galaxy): number => Math.max(0, scenarioParam(g, 'beaconAiRedesignYears', 2));

/** An ordinary AI empire the package acts for. */
export function isBeaconAiEmpire(galaxy: Galaxy, empire: Empire | null, st: BeaconState | null): empire is Empire {
    return empire !== null && st !== null && st.faction !== null && empire !== st.faction && empire.active && empire !== galaxy.independentEmpire && empire.pirateEmpireBaseHabitat === null && !isHumanEmpire(galaxy, empire);
}

/** The empire is at war with the Reclaimers (its own relation, or the Reclamation's war is on and the relation is not peace or better). */
export function atWarWithReclaimers(galaxy: Galaxy, empire: Empire, st: BeaconState): boolean {
    if (st.faction === null) return false;
    const rel = empire.diplomaticRelations.byEmpire(st.faction)?.type;
    if (rel === DiplomaticRelationType.War) return true;
    return warOn(st) && rel === undefined;
}

/** The hit that does nothing against the Reclaimers' plates: the best plate on their ships (UltraDense 10 when none is in sight) times the fleet's reactive share. Pure. */
export function reclaimerRating(galaxy: Galaxy, st: BeaconState): number {
    let plate = 0;
    for (const bo of st.faction?.builtObjects ?? []) {
        if (bo.hasBeenDestroyed || bo.components === null) continue;
        for (const c of bo.components.items) if (c.category === ComponentCategoryType.Armor && c.value2 > plate) plate = c.value2;
    }
    if (plate <= 0) plate = 10;
    return (plate * P.fleetReactivePct(galaxy)) / 100;
}

/** The hit of a weapon of `type` with damage `value1`, when it meets its target at `fraction` of its range (weapons.ts weaponDamageDropoff: linear loss with the distance flown; missiles and BVR torpedoes none). Pure. */
export function expectedHit(type: ComponentType, value1: number, fraction: number, bvr: boolean): number {
    if (type === ComponentType.WeaponMissile || type === ComponentType.WeaponSuperMissile) return value1;
    if ((type === ComponentType.WeaponTorpedo || type === ComponentType.WeaponSuperTorpedo) && bvr) return value1;
    return value1 * Math.max(0, 1 - fraction);
}

/**
 * The damage a hit of `type` does past the plates (combat/damage.ts armour pass): the hit less the plates' reactive rating (a phaser's
 * rating is halved), then halved again for the types the pass halves (rail guns, stock missiles; not BVR launchers, which the pass leaves
 * alone: isBvrMissile). 0 for a hit the plates cancel. Pure.
 */
export function netHit(type: ComponentType, hit: number, rating: number): number {
    const r = type === ComponentType.WeaponPhaser || type === ComponentType.WeaponSuperPhaser ? Math.max(1, Math.trunc(rating / 2)) : rating;
    const net = Math.max(0, hit - r);
    const halved = type === ComponentType.WeaponRailGun || type === ComponentType.WeaponSuperRailGun || type === ComponentType.WeaponMissile || type === ComponentType.WeaponSuperMissile;
    return halved ? net / 2 : net;
}

/** The net damage per unit of space of `type`'s best researched component at the engagement range, 0 when none is researched. */
export function netPerSpace(galaxy: Galaxy, empire: Empire, type: ComponentType, rating: number): number {
    const focus = empire.dominantRace !== null && empire.policy !== null ? empire.policy.researchDesignOverallFocus : ShipDesignFocus.Balanced;
    const ci = empire.research.evaluateDesiredComponentImprovement(type, focus);
    if (ci === null) return 0;
    return netHit(type, expectedHit(type, ci.value1, rangePct(galaxy) / 100, bvrOn(galaxy)), rating) / Math.max(1, ci.improvedComponent.size);
}

/** The researched main-weapon type with the most net damage per unit of space against the plates, null when none gets through. */
export function pierceWeapon(galaxy: Galaxy, empire: Empire, rating: number): ComponentType | null {
    let best: ComponentType | null = null;
    let bestScore = 0;
    for (const type of mainWeaponTypes(empire)) {
        const score = netPerSpace(galaxy, empire, type, rating);
        if (score > bestScore) {
            bestScore = score;
            best = type;
        }
    }
    return best;
}

/**
 * `design` (placed by the stock placement or the chooser that was already chosen) with the weak main weapons swapped for the best type
 * (changed in place, like bvr bvrFixLaunchers; the placement itself resolves a rule by tech level, so a rule for a given type is not
 * kept). Per weak type, `pct` % of its components (rounded up, the type keeping at least MIN_GUNS) become components of `to`, the
 * last ones first; swaps that push the design over `maxShipSize` are taken back. Returns the design, or the one it was given when
 * nothing changed. Pure but for `design`.
 */
export function retarget(galaxy: Galaxy, empire: Empire, design: Design, to: ComponentType, rating: number, pct: number, maxShipSize: number): Design {
    if (pct <= 0 || !WARSHIPS.has(design.subRole)) return design;
    const focus = empire.dominantRace !== null && empire.policy !== null ? empire.policy.researchDesignOverallFocus : ShipDesignFocus.Balanced;
    const replacement = empire.research.evaluateDesiredComponentImprovement(to, focus)?.improvedComponent ?? null;
    if (replacement === null) return design;
    const bestScore = netPerSpace(galaxy, empire, to, rating);
    const slots = new Map<ComponentType, number[]>();
    design.components.forEach((c, i) => {
        if (c === null || c.type === to || !MAIN_CATEGORIES.has(c.category) || NOT_MAIN.has(c.type)) return;
        const list = slots.get(c.type);
        if (list === undefined) slots.set(c.type, [i]);
        else list.push(i);
    });
    const swaps: { at: number; was: Design['components'][number] }[] = [];
    for (const [type, list] of slots) {
        if (netPerSpace(galaxy, empire, type, rating) >= KEEP_SHARE * bestScore) continue; // this weapon does its share
        const take = Math.min(Math.ceil((list.length * pct) / 100), Math.max(0, list.length - MIN_GUNS));
        for (let k = 0; k < take; k++) {
            const at = list[list.length - 1 - k];
            swaps.push({ at, was: design.components[at] });
            design.components[at] = replacement;
        }
    }
    if (swaps.length === 0) return design;
    design.size = design.quickCalculateSize();
    while (swaps.length > 0 && design.size > maxShipSize) {
        const s = swaps.pop()!;
        design.components[s.at] = s.was;
        design.size = design.quickCalculateSize();
    }
    if (swaps.length > 0) design.reDefine();
    return design;
}

/** The chooser for one warship review: the one already chosen (or the stock placement) with its weak guns retargeted. */
export function beaconDesignChooser(galaxy: Galaxy, empire: Empire, spec: DesignSpecification, chosen: AIDesignChooser | null): AIDesignChooser | null {
    const st = peekBeaconState(galaxy);
    if (st === null || !isBeaconAiEmpire(galaxy, empire, st) || !WARSHIPS.has(spec.subRole) || !atWarWithReclaimers(galaxy, empire, st)) return chosen;
    const rating = reclaimerRating(galaxy, st);
    const to = pierceWeapon(galaxy, empire, rating);
    if (to === null) return chosen;
    const pct = shiftPct(galaxy);
    return {
        choose: (place, maxShipSize) => {
            const d = chosen !== null ? chosen.choose(place, maxShipSize) : place(spec, null);
            return d === null ? null : retarget(galaxy, empire, d, to, rating, pct, maxShipSize);
        },
    };
}

registerScenarioQuery({
    id: 'beacon.aiDesign',
    query: 'aiDesignTweak',
    flag: BEACON_FLAG,
    // After the Concord's (-10), BVR's (-5) and Smarter AI's (0), before the decoys' (10).
    order: 5,
    run: (galaxy, value, { empire, spec }) => beaconDesignChooser(galaxy, empire, spec, value),
});

interface DesignState {
    /** Empire id -> star date of its last forced review. */
    forced: Record<string, number>;
}

/** Once per beaconAiRedesignYears of the war, each AI empire at war with the Reclaimers reviews its warship designs at once (the stock review is every half year at best, and waits for its own design's age). */
export function forceReviews(galaxy: Galaxy): number {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || !(st.phase === 'reclamation')) return 0;
    const years = redesignYears(galaxy);
    if (!(years > 0)) return 0;
    const state = scenarioState<DesignState>(galaxy, DESIGN_KEY, () => ({ forced: {} }));
    const now = galaxyStarDate(galaxy);
    let n = 0;
    for (const e of galaxy.empires) {
        if (!isBeaconAiEmpire(galaxy, e, st) || e.capital === null || !atWarWithReclaimers(galaxy, e, st)) continue;
        const last = state.forced[String(e.empireId)];
        if (last !== undefined && now - last < years * YEAR_LENGTH) continue;
        state.forced[String(e.empireId)] = now;
        createNewDesigns(galaxy, e, now, now, true);
        n++;
    }
    return n;
}

registerScenarioPeriodic({
    id: 'beacon.aiDesignReview',
    flag: BEACON_FLAG,
    periodDays: 30,
    run: (galaxy) => {
        forceReviews(galaxy);
    },
});
