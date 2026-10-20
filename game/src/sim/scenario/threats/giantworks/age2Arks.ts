// The Harvest Cycle, Age 2: the survivor arks. Not a port. The Generation Ships arc (../generationShips.ts) is recycled as it is (scout, first contact,
// ultimatum, cede / war, the world ship), switched on in every Age 2 galaxy whether or not the add-on was picked (enableThreat, as the Game Editor's
// spawn does). Only the flavour and the tech change:
//   - the world ships are survivors of the old age: one short Age 2 line ends the first-contact message (GameText "LongNight Ark Contact Line");
//   - the ark's fleet and the empire it founds carry AGE 1 level-1 tech (the stock tree's tier 1: early shields, beams, reactors; param age2ArkTechLevel);
//     the founded empire keeps it as it is; it comes once the target empires reach tech 2 (genShipsTechLevel) with 1.5x the target's firepower (genShipsFleetFactorPct);
//   - the owner meeting the ark's scout (first contact) reaches knowledge milestone 5 (age2Milestones.ts milestoneArk).
// The arc's timing is the add-on's (years in); the threat-year floor is lifted to 0 so Age 2 does not wait 30 years for it.
// Rnd: none drawn here.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import { AGE_PREPARATION, LN_TAG, peekLongNight, registerMemoryContributor } from './longNightState';
import { scenarioText as T } from '../../messages';
import { enableThreat } from '../framework';
import { scenarioParam } from '../../state';
import { ComponentType } from '../../../data/components';
import { ResearchAbilityType } from '../../../researchSystem';
import { milestoneArk } from './age2Milestones';

/** Kept as strings here: generationShips.ts imports this file. */
const GEN_SHIPS_KEY = 'generationShips';
/** Age 2 defaults: the ark's tech level, the tech level the target empires must reach for it to come, and the escort's share of the target's firepower. */
export const ARK_TECH = 1;
export const ARK_TRIGGER_TECH = 2;
export const ARK_FLEET_PCT = 150;

export function isAge2(galaxy: Galaxy): boolean {
    const ln = peekLongNight(galaxy);
    return ln !== null && ln.age >= AGE_PREPARATION;
}

/** The Age 1 tech level of an ark in an Age 2 galaxy (param age2ArkTechLevel, default 1: the stock tree's level-1 parts, shields and beams among them); null in Age 1. Pure. */
export function age2ArkTechLevel(galaxy: Galaxy): number | null {
    if (!isAge2(galaxy)) return null;
    return Math.max(1, Math.trunc(scenarioParam(galaxy, 'age2ArkTechLevel', ARK_TECH)));
}

/** The Age 2 flavour line appended to an ark's first-contact message (empty in Age 1). Pure. */
export function age2ArkFlavour(galaxy: Galaxy): string {
    return isAge2(galaxy) ? `\n\n${T(`${LN_TAG} Ark Contact Line`)}` : '';
}

/**
 * The ark fleet MUST have shields: the lowest stock shield component is researched for the faction (with the parents it needs) whatever its tier,
 * so the designs can carry it even when the level-1 set holds none. True when anything changed.
 */
export function ensureArkShields(galaxy: Galaxy, faction: Empire): boolean {
    const byId = galaxy.researchStatic?.componentsById;
    if (byId === undefined) return false;
    const race = faction.dominantRace;
    const allowed = galaxy.researchStatic?.allowedRaces;
    const tree = faction.research.techTree;
    const isShield = (n: (typeof tree)[number]): boolean => n.def.components.some((id) => byId.get(id)?.type === ComponentType.Shields);
    if (tree.some((n) => n.isResearched && isShield(n))) return false;
    let best = null as (typeof tree)[number] | null;
    for (const n of tree) {
        if (!isShield(n) || n.def.techLevel >= 100) continue;
        const a = allowed?.get(n.def.projectId);
        if (a !== undefined && a.size > 0 && (race === null || !a.has(race.name))) continue;
        if (best === null || n.def.techLevel < best.def.techLevel || (n.def.techLevel === best.def.techLevel && n.def.projectId < best.def.projectId)) best = n;
    }
    if (best === null) return false;
    const done = (n: (typeof tree)[number]): void => {
        if (n.isResearched) return;
        n.parentNodes.forEach((pn, i) => { if (n.parentIsRequired[i]) done(pn); });
        n.isResearched = true;
        n.selfResearched = true;
        n.isEnabled = true;
        n.progress = n.cost;
    };
    done(best);
    faction.research.update(race);
    faction.reviewResearchAbilities();
    faction.reviewDesignsBuiltObjectsImprovedComponents();
    return true;
}

/** The ark's scout met `empire` (first contact with it): milestone 5. */
export function onArkScoutContact(galaxy: Galaxy, empire: Empire): void {
    if (isAge2(galaxy)) milestoneArk(galaxy, empire);
}

/** The new Age 2 galaxy: the Generation Ships threat on (the add-on or not), the threat-year floor lifted. */
export function enableAge2Arks(galaxy: Galaxy): void {
    if (galaxy.scenario === null || !isAge2(galaxy)) return;
    enableThreat(galaxy, GEN_SHIPS_KEY);
    const params = galaxy.scenario.params;
    // Age 2 pacing: the ark comes once the empires reach tech 2 (not 3), with an escort of 1.5x (not 1.7x) the target's firepower.
    if (params['generationShipsMinYear'] === undefined) params['generationShipsMinYear'] = 0;
    if (params['genShipsTechLevel'] === undefined) params['genShipsTechLevel'] = ARK_TRIGGER_TECH;
    if (params['genShipsFleetFactorPct'] === undefined) params['genShipsFleetFactorPct'] = ARK_FLEET_PCT;
}

export function registerAge2Arks(): void {
    registerMemoryContributor({ id: 'age2.arks', capture: () => undefined, restore: (g) => enableAge2Arks(g) });
}
