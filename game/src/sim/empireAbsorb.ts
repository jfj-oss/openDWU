// One empire absorbing another (19c nationalisation, any "merge" scenario).
//
// The C# has no general absorb / merge / annex path: `absorb` only appears in the shield-damage battle stats
// (Galaxy.1.cs 5220-5246, SpaceBattleStats), no DiplomaticRelationType transition leads out of SubjugatedDominion into
// absorption (the dominion relation only ends by EndSubjugation, Empire.8.cs 1641, or war), and the empire-level
// Empire.CompleteTeardown(conqueror) (Empire.cs 4874/4879) is called with a live conqueror only from
//   - Empire.1.cs 205-216 TakeOwnershipOfColony, when the old owner loses its last colony (conquest);
//   - Galaxy.1.cs 688-760 GuardiansDepart (the Freedom Alliance story victory: the Ancient Guardians' empire merges
//     into the player — techs, galaxy map, every colony, then CompleteTeardown(PlayerEmpire, true, false));
//   - Galaxy.8.cs 3183 EliminatePirateFaction (pirates only).
// GuardiansDepart is therefore the one stock absorb path; `absorbEmpire` below is its body with the Guardians-specific
// parts (the Mechanoid lookup, the Way of the Ancients government and the per-colony population swap) left to
// `guardiansDepart`, which passes them back in through `beforeColony` so the statement order is the C#'s.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { getGovernmentsStatic } from './empire';
import type { Habitat } from './types';
import { Population, PopulationList } from './population';
import { findNodeById } from './researchSystem';
import { doResearchBreakthrough, reviewDesignsBuiltObjectsImprovedComponents } from './researchTick';
import { mergeGalaxyMap } from './exploration';
import { takeOwnershipOfColonyFull } from './combat/ownership';
import { empireCompleteTeardown } from './events';
import type { Race } from './data/races';

export interface AbsorbEmpireOptions {
    /** Galaxy.1.cs 736-753: GuardiansDepart's per-colony step, run just before each TakeOwnershipOfColony. */
    beforeColony?: (habitat: Habitat) => void;
}

/**
 * Galaxy.1.cs 715-760 GuardiansDepart body, generalised from (Mechanoid empire → PlayerEmpire) to (absorbed → into).
 * In order: every tech `absorbed` has researched and `into` has not becomes a silent breakthrough (715-731, then
 * Research.Update / ReviewDesignsBuiltObjectsImprovedComponents / ReviewResearchAbilities); MergeGalaxyMap(absorbed, into)
 * (732); every colony (a copy of the list) goes to `into` through into.TakeOwnershipOfColony(colony, into, false) (733-755;
 * troops, colony-located characters, bases, cargo and orders change sides there, and taking the last colony runs the
 * conquest ending: "You have been defeated!" + CompleteTeardown(into) — Empire.1.cs 205-216); finally, if `absorbed` is
 * still active (it had no colonies), CompleteTeardown(into, removeFromGalaxy: true, sendMessages: false) (756-759).
 * The teardown hands every remaining ship and its cargo to `into`, removes all relations / evaluations with `absorbed`,
 * dissolves its fleets, kills its remaining characters and moves it to Galaxy.DefeatedEmpires (Empire.cs 4879).
 * No Rnd of its own; the callees draw what they draw (the teardown and ownership transfers draw none).
 */
export function absorbEmpire(galaxy: Galaxy, into: Empire, absorbed: Empire, options: AbsorbEmpireOptions = {}): void {
    if (into === absorbed) return;
    // 715-731
    if (absorbed.research != null && absorbed.research.techTree != null) {
        for (let k = 0; k < absorbed.research.techTree.length; k++) {
            if (absorbed.research.techTree[k].isResearched) {
                const researchNode = findNodeById(into.research.techTree, absorbed.research.techTree[k].def.projectId);
                if (researchNode != null && !researchNode.isResearched) {
                    doResearchBreakthrough(galaxy, into, researchNode, true, true, true);
                }
            }
        }
        into.research.update(into.dominantRace);
        reviewDesignsBuiltObjectsImprovedComponents(into);
        into.reviewResearchAbilities();
    }
    // 732
    mergeGalaxyMap(galaxy, absorbed, into);
    // 733-755
    const habitatList = absorbed.colonies.slice();
    for (let l = 0; l < habitatList.length; l++) {
        const habitat = habitatList[l];
        options.beforeColony?.(habitat);
        takeOwnershipOfColonyFull(galaxy, into, habitat, into, false, false);
    }
    // 756-759
    if (absorbed.active) empireCompleteTeardown(galaxy, absorbed, into, true, false);
}

/**
 * Galaxy.1.cs 688 GuardiansDepart: the Ancient Guardians (the Mechanoid empire) join the player. Not yet called: its caller
 * is the Freedom Alliance victory branch of CheckGlobalVictoryConditions (Galaxy.1.cs 425-434, victory.ts
 * decimateEmpireAndGuardiansDepart — TODO(port) M4z3, with DecimateEmpire).
 */
export function guardiansDepart(galaxy: Galaxy): void {
    const player = galaxy.playerEmpire;
    if (player === null) return;
    // 690-707
    let empire: Empire | null = null;
    let race: Race | null = null;
    for (let i = 0; i < galaxy.races.length; i++) {
        if (galaxy.races[i].name.toLowerCase() === 'mechanoid') {
            race = galaxy.races[i];
            break;
        }
    }
    for (let j = 0; j < galaxy.empires.length; j++) {
        if (galaxy.empires[j].dominantRace !== null && galaxy.empires[j].dominantRace === race) {
            empire = galaxy.empires[j];
            break;
        }
    }
    if (empire === null) return;
    // 710-714: GovernmentAttributesList.GetFirstByAvailability(2) (Way of the Ancients).
    let firstByAvailability = null;
    for (const g of getGovernmentsStatic()) {
        if (g !== null && g.availability === 2) {
            firstByAvailability = g;
            break;
        }
    }
    if (firstByAvailability !== null && !player.allowableGovernmentTypes.includes(firstByAvailability.governmentId)) {
        player.allowableGovernmentTypes.push(firstByAvailability.governmentId);
    }
    absorbEmpire(galaxy, player, empire, {
        beforeColony: (habitat) => {
            // 738-752
            habitat.population.add(new Population(player.dominantRace!, 500000000));
            const populationList = new PopulationList();
            if (habitat.population != null && habitat.population.items.length > 0) {
                for (let m = 0; m < habitat.population.items.length; m++) {
                    if (habitat.population.items[m].race === race) populationList.add(habitat.population.items[m]);
                }
                for (let n = 0; n < populationList.items.length; n++) habitat.population.remove(populationList.items[n]);
            }
        },
    });
}
