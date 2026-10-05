// Smarter AI add-on, part 3: defence that counts pirates (scenarios/smarter-ai, flag smarterAIDefence). Not a port.
//
// Stock Empire.9.cs ProjectForceStructure (forceStructure.ts projectForceStructure) adds pirate firepower to the threat
// multiplier (num10) only while the empire LACKS hyperdrive tech, and then counts every pirate ship in the galaxy. With
// this flag an AI empire also weighs what it knows is near its colonies:
//   - local hostile strength: the known pirate bases (Empire.KnownPirateBases, no Protection deal) within DEFENCE_RANGE of
//     a colony at their calculateDefendingStrength (fleets/militaryAI.ts; the base plus its defenders), plus the visible
//     threats (SystemVisibility.Threats, as Empire.9.cs IdentifyThreatenedSystemsPrioritized reads them: hostile
//     pirates and empires at war) within that range at their overall strength factor;
//   - the threat multiplier becomes at least 1 + 0.6 × local / own mobile strength (the stock war weight), capped at 4;
//   - while anything hostile is near, the warship total is at least WARSHIPS_PER_COLONY × colonies × the multiplier;
//   - BuildDefensiveBases (Empire.10.cs 1211) also considers the threatened colonies, not only strategic value > 250000.
// AI empires only. No Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { calculateOverallStrengthFactor } from '../../combat/threats';
import { calculateDefendingStrength } from '../../fleets/militaryAI';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { PirateRelationType, obtainPirateRelation } from '../../pirateRelations';
import { registerScenarioEvent, registerScenarioQuery } from '../hooks';
import { SMARTER_AI_FLAG, isSmarterAIEmpire, smarterAIOn } from './common';

export const SMARTER_AI_DEFENCE_FLAG = 'smarterAIDefence';

const SECTOR_SIZE = 2_000_000; // as research.ts
export interface DefenceRules {
    /** Hostile strength within this distance of a colony is local. */
    range: number;
    /** The warship floor per colony (× the threat multiplier) while anything hostile is near. */
    warshipsPerColony: number;
    /** The stock war weight of the threat ratio (Empire.9.cs 5014 `num6 += num7 / num4 * 0.6`). */
    weight: number;
}
export const DEFENCE_RULES: DefenceRules = { range: SECTOR_SIZE, warshipsPerColony: 1.5, weight: 0.6 };

export interface LocalThreat {
    /** Hostile strength near any colony (each base / ship counted once). */
    hostile: number;
    /** The empire's own mobile military strength. */
    own: number;
    /** Colonies with something hostile within range. */
    threatened: Habitat[];
}

function isHostileTo(galaxy: Galaxy, self: Empire, other: Empire | null): boolean {
    if (other === null || other === self || other === galaxy.independentEmpire) return false;
    if (other.pirateEmpireBaseHabitat !== null) return obtainPirateRelation(self, other).type !== PirateRelationType.Protection;
    return obtainDiplomaticRelation(self, other).type === DiplomaticRelationType.War;
}

/** The known / visible hostile strength near the empire's colonies. Deterministic, no Rnd. */
export function localThreat(galaxy: Galaxy, empire: Empire, rules: DefenceRules = DEFENCE_RULES): LocalThreat {
    const colonies = empire.colonies.filter((h) => h !== null && h.empire === empire);
    const r2 = rules.range * rules.range;
    const near = (x: number, y: number): Habitat[] => colonies.filter((h) => (h.xpos - x) ** 2 + (h.ypos - y) ** 2 <= r2);
    const threatened = new Set<Habitat>();
    const counted = new Set<BuiltObject>();
    let hostile = 0;
    for (const b of empire.knownPirateBases) {
        if (b === null || b.hasBeenDestroyed || b.empire === null || counted.has(b)) continue;
        if (obtainPirateRelation(b.empire, empire).type === PirateRelationType.Protection) continue;
        const hs = near(b.xpos, b.ypos);
        if (hs.length === 0) continue;
        counted.add(b);
        hostile += calculateDefendingStrength(galaxy, empire, b).strength;
        for (const h of hs) threatened.add(h);
    }
    for (const sv of empire.visibility.systemVisibility) {
        if (sv == null || sv.threats === null || sv.threats.length === 0) continue;
        for (const bo of sv.threats) {
            if (bo == null || bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Military || counted.has(bo) || !isHostileTo(galaxy, empire, bo.actualEmpire)) continue;
            const hs = near(bo.xpos, bo.ypos);
            if (hs.length === 0) continue;
            counted.add(bo);
            hostile += calculateOverallStrengthFactor(bo);
            for (const h of hs) threatened.add(h);
        }
    }
    let own = 0;
    for (const bo of empire.builtObjects) {
        if (bo != null && !bo.hasBeenDestroyed && bo.role === BuiltObjectRole.Military && bo.unbuiltComponentCount <= 0 && bo.topSpeed > 0) own += calculateOverallStrengthFactor(bo);
    }
    return { hostile, own, threatened: colonies.filter((h) => threatened.has(h)) };
}

/** The threat multiplier for a local threat: at least the stock one, at most 4. */
export function defenceThreatMultiplier(stock: number, t: LocalThreat, rules: DefenceRules = DEFENCE_RULES): number {
    if (t.hostile <= 0) return stock;
    return Math.min(4, Math.max(stock, 1 + (rules.weight * t.hostile) / Math.max(1, t.own)));
}

/** The warship total with the per-colony floor (only while something hostile is near). */
export function defenceWarshipFloor(stock: number, colonyCount: number, threat: number, t: LocalThreat, rules: DefenceRules = DEFENCE_RULES): number {
    if (t.hostile <= 0) return stock;
    return Math.max(stock, Math.ceil(colonyCount * rules.warshipsPerColony * threat));
}

const on = (galaxy: Galaxy, empire: Empire): boolean => smarterAIOn(galaxy, SMARTER_AI_DEFENCE_FLAG) && isSmarterAIEmpire(galaxy, empire);

registerScenarioQuery({
    id: 'smarterAI.defenceThreat',
    query: 'forceStructureThreat',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire }) => (on(galaxy, empire) ? defenceThreatMultiplier(value, localThreat(galaxy, empire)) : value),
});

registerScenarioQuery({
    id: 'smarterAI.defenceWarships',
    query: 'forceStructureWarships',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, threat }) => (on(galaxy, empire) ? defenceWarshipFloor(value, empire.colonies.length, threat, localThreat(galaxy, empire)) : value),
});

registerScenarioEvent({
    id: 'smarterAI.defensiveBases',
    event: 'defensiveBaseLocations',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, { empire, locations }) => {
        if (!on(galaxy, empire)) return;
        for (const h of localThreat(galaxy, empire).threatened) if (!locations.includes(h)) locations.push(h);
    },
});
