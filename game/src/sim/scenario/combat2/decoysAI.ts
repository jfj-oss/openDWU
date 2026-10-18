// Decoys and chaff, AI part (scenarios/decoys-chaff, flag decoysAI). Not a port. AI empires only (never a human seat, pirates or the
// independents). No Rnd of its own.
//
// Ship design (scenario query aiDesignTweak, after Smarter AI's and the BVR chooser, which it wraps): every AI warship template
// asks for at least one countermeasures (ECM) component, so it carries decoys, and decoyAiExtraEcm more when enemies at war with the
// empire field enough missiles or torpedoes (seeking weapons are what decoys and ECM answer). The chooser that was already chosen
// (BVR's, Smarter AI's) places the design as it would; only the template it is given asks for the extra ECM.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { ComponentType } from '../../data/components';
import { DesignSpecificationComponentRuleType, newComponentRuleByType, type DesignSpecification } from '../../data/designSpecifications';
import type { AIDesignChooser, DesignPlacementTweak } from '../../designPlacement';
import { DiplomaticRelationType } from '../../diplomacy';
import { isHumanEmpire } from '../../humanEmpires';
import { registerScenarioQuery } from '../hooks';
import { c2Param, decoysAiOn } from './common';

const WARSHIPS: ReadonlySet<BuiltObjectSubRole> = new Set([
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.Carrier,
]);

/** An AI empire this package acts for. */
export function isDecoyAiEmpire(galaxy: Galaxy, empire: Empire | null): empire is Empire {
    return empire !== null && decoysAiOn(galaxy) && empire !== galaxy.independentEmpire && empire.pirateEmpireBaseHabitat === null && !isHumanEmpire(galaxy, empire);
}

/** Missile / torpedo launchers across the designs of the empires at war with `empire` (a count of ships built with them). */
export function enemySeekingLaunchers(galaxy: Galaxy, empire: Empire): number {
    let n = 0;
    for (const e of galaxy.empires) {
        if (e === null || e === empire || e === galaxy.independentEmpire || !e.active) continue;
        if (empire.diplomaticRelations.byEmpire(e)?.type !== DiplomaticRelationType.War) continue;
        for (const d of e.designs) {
            if (d.isObsolete || d.buildCount <= 0) continue;
            for (const c of d.components) {
                if (c.type === ComponentType.WeaponMissile || c.type === ComponentType.WeaponSuperMissile || c.type === ComponentType.WeaponTorpedo || c.type === ComponentType.WeaponSuperTorpedo) n += d.buildCount;
            }
        }
    }
    return n;
}

/** The template with its countermeasures rule raised to `amount` (a copy; the empire's template is never mutated). */
export function withEcm(spec: DesignSpecification, amount: number): DesignSpecification {
    const rules = spec.componentRules.map((r) => ({ ...r }));
    const r = rules.find((x) => x.componentType === ComponentType.ComputerCountermeasures);
    if (r === undefined) rules.push(newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, ComponentType.ComputerCountermeasures, amount));
    else if (r.amount < amount || r.componentRuleType === DesignSpecificationComponentRuleType.MustNotHave) {
        r.amount = Math.max(r.amount, amount);
        r.componentRuleType = DesignSpecificationComponentRuleType.MustHave;
    }
    return { ...spec, componentRules: rules };
}

/** ECM components the AI wants on a new warship of `spec.subRole` (0: leave the template alone). */
export function wantedEcm(galaxy: Galaxy, empire: Empire, spec: DesignSpecification): number {
    if (!WARSHIPS.has(spec.subRole)) return 0;
    const threat = enemySeekingLaunchers(galaxy, empire) >= 6 ? c2Param(galaxy, 'decoyAiExtraEcm') : 0;
    return 1 + threat;
}

/** The chooser for one warship review: the one already chosen (or the stock placement) given the ECM-raised template. */
export function decoyDesignChooser(galaxy: Galaxy, empire: Empire, spec: DesignSpecification, chosen: AIDesignChooser | null): AIDesignChooser | null {
    if (!isDecoyAiEmpire(galaxy, empire)) return chosen;
    const want = wantedEcm(galaxy, empire, spec);
    if (want <= 0) return chosen;
    if (chosen !== null) {
        return {
            choose: (place, maxShipSize) =>
                chosen.choose((s, tweak) => place(withEcm(s, want), tweak === null ? null : ({ ...tweak, spec: withEcm(tweak.spec, want) } as DesignPlacementTweak)), maxShipSize),
        };
    }
    return { choose: (place) => place(withEcm(spec, want), null) };
}

registerScenarioQuery({
    id: 'decoys.design',
    query: 'aiDesignTweak',
    flag: 'decoysAI',
    // After Smarter AI's chooser (0), the BVR chooser (-5) and the Concord's (-10).
    order: 10,
    run: (galaxy, value, { empire, spec }) => decoyDesignChooser(galaxy, empire, spec, value),
});
