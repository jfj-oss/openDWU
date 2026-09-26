import { baconSettings } from '../src/sim/data/baconSettings';
// M4z1 — teardown & empire lifecycle: Empire.cs 4879 CompleteTeardown (events.ts empireCompleteTeardown), EmpireCounters.cs
// 119 ProcessEmpireElimination, Empire.1.cs 1102/2883 InitiateEmpireSplit / SplinterEmpire (empireEvents.ts), Empire.7.cs
// 650-697 ReviewCharacterLocation ColonyGovernor population-growth branch (characters.ts), Habitat.cs 7909 system-star
// teardown + Galaxy.9.cs 3151 RemoveSystem (events.ts), BaconHabitat.cs 1269 GenerateDefensivePirateRaiders
// (combat/invasion.ts), and Empire.1.cs 3322 RemoveDefeatedEmpireRelations after an elimination. Each test builds its own
// createGame galaxy (seed 1) and finishes with a harness run so the tick meets the torn-down state.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { empireCompleteTeardown, processEmpireElimination, removeSystem } from '../src/sim/events';
import { initiateEmpireSplit } from '../src/sim/empireEvents';
import { eliminatePirateFaction } from '../src/sim/pirates/pirateGalaxyTick';
import { removeDefeatedEmpireRelations } from '../src/sim/diplomacyTick';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { CharacterRole, CharacterSkillType, CharacterTraitType, generateNewCharacter, reviewCharacterLocation, type Character } from '../src/sim/characters';
import { determineColonizationValue } from '../src/sim/tradeItems';
import { generateDefensivePirateRaiders } from '../src/sim/combat/invasion';
import { PlanetaryFacilityType } from '../src/sim/researchSystem';
import { Troop, TroopList, TroopType } from '../src/sim/cargo';
import { empireRaidStrengthFactor } from '../src/sim/combat/boarding';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyFromJSON, galaxyToJSON } from '../src/sim/save/galaxySave';
import { HabitatCategoryType } from '../src/sim/types';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGalaxy(): Galaxy {
    return cachedTickGame(gameData).galaxy;
}

/** Every reference a live empire keeps to `dead` after its teardown (should be none). */
function referencesTo(galaxy: Galaxy, dead: Empire): string[] {
    const out: string[] = [];
    const all = [...galaxy.empires, ...galaxy.pirateEmpires, galaxy.independentEmpire!];
    for (const e of all) {
        if (e.diplomaticRelations.toArray().some((r) => r.otherEmpire === dead)) out.push(`${e.name} diplomaticRelations`);
        if ((e.empireEvaluations as { empire: Empire | null }[]).some((v) => v.empire === dead)) out.push(`${e.name} empireEvaluations`);
        if (e.pirateRelations.toArray().some((r) => r.otherEmpire === dead)) out.push(`${e.name} pirateRelations`);
        if (e.knownPirateEmpires.includes(dead)) out.push(`${e.name} knownPirateEmpires`);
        if (e.empiresViewable.includes(dead)) out.push(`${e.name} empiresViewable`);
        if (e.visibility.empiresSharedVisibility.includes(dead.visibility)) out.push(`${e.name} empiresSharedVisibility`);
        if (e.pirateMissions.containsEmpire(dead)) out.push(`${e.name} pirateMissions`);
    }
    for (const b of galaxy.builtObjects) if (b != null && (b.empire === dead || b.actualEmpire === dead)) out.push(`ship ${b.name}`);
    for (const h of galaxy.habitats) if (h.empire === dead) out.push(`colony ${h.name}`);
    return out;
}

describe('Empire.cs 4879 CompleteTeardown — a normal empire conquered', () => {
    it('hands ships and cargo to the conqueror, strips every relation, kills characters, drops troops, then the tick runs on', () => {
        const galaxy = newGalaxy();
        const human = galaxy.empires[0];
        const victim = galaxy.empires[3];
        const ships = [...victim.builtObjects, ...victim.privateBuiltObjects];
        expect(ships.length).toBeGreaterThan(0);
        // The victim's colony goes independent first (as TakeOwnershipOfColony does before the "last colony lost" teardown;
        // the characters at the colony change empire with it).
        takeOwnershipOfColonyFull(galaxy, victim, victim.capital!, galaxy.independentEmpire!, false, false);
        const characters = (victim.characters as Character[]).slice();
        const troops = victim.troops.items.slice();
        empireCompleteTeardown(galaxy, victim, human);

        expect(victim.active).toBe(false);
        expect(galaxy.empires.includes(victim)).toBe(false);
        expect(galaxy.defeatedEmpires).toEqual([victim]);
        expect(human.counters.eliminateEmpireCount).toBe(1);
        expect(human.counters.eliminatePirateEmpireCount).toBe(0);
        expect(victim.builtObjects.length).toBe(0);
        expect(victim.privateBuiltObjects.length).toBe(0);
        // TakeOwnershipOfBuiltObject: military / state ships join the conqueror, private ones follow the C# role switch.
        for (const b of ships) expect(b.actualEmpire === human || b.empire === human || b.empire === galaxy.independentEmpire || b.hasBeenDestroyed).toBe(true);
        for (const c of characters) expect(c.empire).toBe(null);
        expect(victim.characters.length).toBe(0);
        expect(victim.troops.count).toBe(0);
        for (const t of troops) expect(t.empire).toBe(null);
        expect(victim.visibility.resourceMap).toBe(null); // _ResourceMap = null (Empire.cs 5173)
        expect(victim.pirateRelations.count).toBe(0);
        expect(victim.empireEvaluations.length).toBe(0);
        expect(referencesTo(galaxy, victim)).toEqual([]);
        // The save codec accepts the torn-down empire (DefeatedEmpires, null ResourceMap). Saved before the harness run: after
        // one, runtime classes the codec does not register yet (ShipGroup, DistressSignal, ...) stop any save.
        const reloaded = galaxyFromJSON(galaxyToJSON(galaxy), gameData);
        expect(reloaded.defeatedEmpires.length).toBe(1);
        expect(reloaded.defeatedEmpires[0].name).toBe(victim.name);
        expect(reloaded.defeatedEmpires[0].visibility.resourceMap).toBe(null);

        runGameSeconds(galaxy, 120);
        expect(referencesTo(galaxy, victim)).toEqual([]);
    }, 300000);

    it('without a conqueror tears the ships down and removes them from Galaxy.BuiltObjects', () => {
        const galaxy = newGalaxy();
        const victim = galaxy.empires[2];
        const ships = [...victim.builtObjects, ...victim.privateBuiltObjects];
        takeOwnershipOfColonyFull(galaxy, victim, victim.capital!, galaxy.independentEmpire!, false, false);
        empireCompleteTeardown(galaxy, victim, null, true, false);
        for (const b of ships) {
            expect(b.hasBeenDestroyed).toBe(true);
            expect(galaxy.builtObjects.includes(b)).toBe(false);
        }
        expect(galaxy.defeatedEmpires).toEqual([victim]);
        expect(referencesTo(galaxy, victim)).toEqual([]);
        runGameSeconds(galaxy, 60);
    }, 300000);

    it('EmpireCounters.ProcessEmpireElimination: pirates count separately; beating the Mechanoids sets HaveDefeatedAncientGuardians', () => {
        const galaxy = newGalaxy();
        const human = galaxy.empires[0];
        const other = galaxy.empires[1];
        processEmpireElimination(galaxy, human, galaxy.pirateEmpires[0]);
        expect(human.counters.eliminatePirateEmpireCount).toBe(1);
        expect(human.counters.eliminateEmpireCount).toBe(0);
        const race = other.dominantRace!;
        const mech = gameData.races.find((r) => r.name === 'Mechanoid')!;
        other.dominantRace = mech; // Galaxy.8.cs IdentifyMechanoidEmpire: first non-pirate empire of race "mechanoid"
        processEmpireElimination(galaxy, human, other);
        other.dominantRace = race;
        expect(human.haveDefeatedAncientGuardians).toBe(true);
        expect(human.counters.eliminateEmpireCount).toBe(1);
        // EliminateEmpireStrategicValue += TotalColonyStrategicValue (max(10000, ...) per colony; one colony here).
        expect(human.counters.eliminateEmpireStrategicValue).toBeGreaterThanOrEqual(10000);
    }, 300000);

    it('RemoveDefeatedEmpireRelations drops a relation that still points at an inactive empire', () => {
        const galaxy = newGalaxy();
        const human = galaxy.empires[0];
        const victim = galaxy.empires[1];
        takeOwnershipOfColonyFull(galaxy, victim, victim.capital!, galaxy.independentEmpire!, false, false);
        empireCompleteTeardown(galaxy, victim, human);
        // A relation re-added behind the teardown's back (e.g. restored by an older save) is cleaned by the tick entry point.
        const stale = human.diplomaticRelations.byEmpire(galaxy.empires[1]);
        expect(stale).not.toBe(null);
        stale!.otherEmpire = victim;
        removeDefeatedEmpireRelations(galaxy, human);
        expect(human.diplomaticRelations.toArray().some((r) => r.otherEmpire === victim)).toBe(false);
    }, 300000);
});

describe('pirate faction elimination (Galaxy.8.cs 3183 EliminatePirateFaction → Empire.CompleteTeardown)', () => {
    it('a conquered pirate faction is torn down without throwing and the galaxy keeps ticking', () => {
        const galaxy = newGalaxy();
        const human = galaxy.empires[0];
        const faction = galaxy.pirateEmpires[0];
        const ships = [...faction.builtObjects];
        eliminatePirateFaction(galaxy, faction, human);
        expect(faction.active).toBe(false);
        expect(galaxy.pirateEmpires.includes(faction)).toBe(false);
        expect(galaxy.defeatedEmpires.includes(faction)).toBe(false); // only Galaxy.Empires members go to DefeatedEmpires
        expect(human.counters.eliminatePirateEmpireCount).toBe(1);
        for (const b of ships) expect(b.empire === faction || b.actualEmpire === faction).toBe(false);
        expect(referencesTo(galaxy, faction)).toEqual([]);
        runGameSeconds(galaxy, 120);
        expect(referencesTo(galaxy, faction)).toEqual([]);
    }, 300000);

    it('a terminated pirate faction (no conqueror) is torn down too', () => {
        const galaxy = newGalaxy();
        const faction = galaxy.pirateEmpires[2];
        eliminatePirateFaction(galaxy, faction, null);
        expect(galaxy.pirateEmpires.includes(faction)).toBe(false);
        expect(referencesTo(galaxy, faction)).toEqual([]);
        runGameSeconds(galaxy, 60);
    }, 300000);
});

/** Hands `count` populous independent colonies to `empire` so SplinterEmpire has colonies to take (strategic value ≥ 20000). */
function growEmpire(galaxy: Galaxy, empire: Empire, count: number): Habitat[] {
    const picked = galaxy.independentColonies.filter((h) => h.population.items.length > 0).slice(0, count);
    for (const h of picked) {
        takeOwnershipOfColonyFull(galaxy, galaxy.independentEmpire!, h, empire, false, false);
        h.setDevelopmentLevel(100);
        h.population.items[0].amount = 2000000000;
        h.population.recalculateTotalAmount();
    }
    return picked;
}

describe('Empire.1.cs 1102 InitiateEmpireSplit / 2883 SplinterEmpire', () => {
    it('creates a new empire from the colony nearest a random point, at war with the source when declareWar', () => {
        const galaxy = newGalaxy();
        const source = galaxy.empires[1];
        growEmpire(galaxy, source, 6);
        const coloniesBefore = source.colonies.slice();
        const empiresBefore = galaxy.empires.length;
        const nextIdBefore = galaxy.nextEmpireId;
        initiateEmpireSplit(galaxy, source, 0.4, true);
        expect(galaxy.empires.length).toBe(empiresBefore + 1);
        const splinter = galaxy.empires[galaxy.empires.length - 1];
        expect(galaxy.nextEmpireId).toBe(nextIdBefore + 1);
        expect(source.empireSplitCount).toBe(1);
        // num = max(1, (int)(0.4 * 7)) = 2 colonies at most (the second only when one is below the approval threshold).
        expect(splinter.colonies.length).toBeGreaterThanOrEqual(1);
        expect(splinter.colonies.length).toBeLessThanOrEqual(2);
        for (const h of splinter.colonies) {
            expect(coloniesBefore.includes(h)).toBe(true);
            expect(source.colonies.includes(h)).toBe(false);
            expect(h.empire).toBe(splinter);
        }
        expect(splinter.capital).not.toBe(source.capital);
        // DeclareWar(empire) after the -40 incident.
        expect(source.diplomaticRelations.byEmpire(splinter)!.type).toBe(DiplomaticRelationType.War);
        // Research.Clone: same researched projects, no parent links.
        const researched = (e: Empire) => e.research.techTree.filter((n) => n.isResearched).map((n) => n.def.projectId);
        expect(researched(splinter)).toEqual(researched(source));
        expect(splinter.research.techTree.every((n) => n.parentNodes.length === 0 && n.isEnabled)).toBe(true);
        expect(source.lastDisasterDate).toBe(galaxyStarDate(galaxy));
        runGameSeconds(galaxy, 120);
        expect(galaxy.empires.includes(splinter)).toBe(true);
    }, 300000);

    it('does nothing (but still draws the coordinates) when no other colony qualifies', () => {
        const galaxy = newGalaxy();
        const source = galaxy.empires[1];
        const empiresBefore = galaxy.empires.length;
        const draws = galaxy.rnd.drawCount;
        initiateEmpireSplit(galaxy, source, 0.3, false);
        expect(galaxy.empires.length).toBe(empiresBefore);
        expect(source.empireSplitCount).toBe(0);
        expect(galaxy.rnd.drawCount - draws).toBeGreaterThanOrEqual(2);
    }, 300000);
});

describe('Empire.7.cs 650-697 ReviewCharacterLocation — ColonyGovernor population-growth branch', () => {
    function governor(galaxy: Galaxy, empire: Empire, location: Habitat | null = null): Character {
        const c = generateNewCharacter(galaxy, empire, CharacterRole.ColonyGovernor, location ?? empire.capital).character;
        const base = (c as unknown as { skillBase: Int8Array }).skillBase;
        const traits = (c as unknown as { skillTraits: Int8Array }).skillTraits;
        base.fill(0);
        traits.fill(0);
        base[CharacterSkillType.PopulationGrowth] = 20;
        c.traits.length = 0;
        return c;
    }

    it('stays at its colony while it can still grow', () => {
        const galaxy = newGalaxy();
        const human = galaxy.empires[0];
        const c = governor(galaxy, human);
        expect(c.traits.includes(CharacterTraitType.Demoralizing)).toBe(false);
        const home = c.location as Habitat;
        expect(home).toBe(human.capital);
        home.maxPopulation = home.population.totalAmount + 20000000; // num8 = Min(1e9, max - 1e7) > total
        expect(reviewCharacterLocation(galaxy, human, c, false)).toBe(home);
    }, 300000);

    it('moves to the growing colony with the best DetermineColonizationValue when its own colony is full', () => {
        const galaxy = newGalaxy();
        const human = galaxy.empires[0];
        const extra = growEmpire(galaxy, human, 3);
        for (const h of extra) {
            h.population.items[0].amount = 100000000;
            h.population.recalculateTotalAmount();
            h.maxPopulation = 5000000000;
        }
        // The governor sits on the extra colony with the lowest value, which is full (Population >= MaximumPopulation - 1e7).
        const value = (h: Habitat) => determineColonizationValue(galaxy, human, h);
        const sorted = extra.slice().sort((x, y) => value(x) - value(y));
        const home = sorted[0];
        home.maxPopulation = home.population.totalAmount;
        const c = governor(galaxy, human, home);
        expect(c.location).toBe(home);
        // The capital (> 1e9 people) never counts as growing; the best other growing colony wins when its value beats home's.
        const expected = sorted[sorted.length - 1];
        expect(value(expected)).toBeGreaterThan(value(home));
        const result = reviewCharacterLocation(galaxy, human, c, true);
        expect(result).toBe(expected);
        expect(c.transferDestination).toBe(expected);
        runGameSeconds(galaxy, 60);
    }, 300000);
});

/** An independent colony with the troop lists a colony has once TakeOwnershipOfColony ran on it. */
function raiderColony(galaxy: Galaxy): Habitat {
    const planet = galaxy.independentColonies.find((h) => h.population.items.length > 0)!;
    if (planet.troops === null) planet.troops = new TroopList();
    if (planet.invadingTroops === null) planet.invadingTroops = new TroopList();
    if (planet.facilities === null) planet.facilities = [];
    return planet;
}

describe('BaconHabitat.cs 1269 GenerateDefensivePirateRaiders', () => {
    it('adds pirateBaseTroops + Next(0, 3) raiders of (int)(50 * TroopStrength / 100 * RaidStrengthFactor) to the colony and faction', () => {
        const galaxy = newGalaxy();
        const faction = galaxy.pirateEmpires[0];
        const planet = raiderColony(galaxy);
        // Only the test's pirate base counts (the seed-1 colony may already have other facilities).
        planet.facilities = [];
        planet.facilities.push({ type: PlanetaryFacilityType.PirateBase, constructionProgress: 1.0, value2: 1 } as never);
        const before = planet.troops!.count;
        const factionBefore = faction.troops.count;
        const draws = galaxy.rnd.drawCount;
        generateDefensivePirateRaiders(galaxy, planet, faction, false);
        expect(galaxy.rnd.drawCount - draws).toBe(1); // Next(0, 3)
        const expectedCount = planet.troops!.count - before;
        // num2 = BaconHabitat.pirateBaseTroops (BaconSettings.txt: 5) (+ piratebase bonus when the colony carries one).
        const pb = planet.baconValues !== null && planet.baconValues.has('piratebase') ? 1 : 0;
        expect(expectedCount).toBeGreaterThanOrEqual(baconSettings.pirateBaseTroops);
        expect(expectedCount).toBeLessThanOrEqual(baconSettings.pirateBaseTroops + 2 + pb * 100);
        expect(planet.troops!.count - before).toBe(expectedCount);
        expect(faction.troops.count - factionBefore).toBe(expectedCount);
        const strength = Math.trunc(50 * (faction.dominantRace!.troopStrength / 100.0) * empireRaidStrengthFactor(faction));
        const raider = planet.troops!.items[planet.troops!.count - 1];
        expect(raider.type).toBe(TroopType.PirateRaider);
        expect(raider.attackStrength).toBe(strength);
        expect(raider.defendStrength).toBe(strength);
        expect(raider.empire).toBe(faction);
    }, 300000);

    it('moves the current defenders to the invaders when currentDefendingTroopsInvade', () => {
        const galaxy = newGalaxy();
        const faction = galaxy.pirateEmpires[1];
        const planet = raiderColony(galaxy);
        planet.troops!.add(new Troop('Defenders', TroopType.Infantry, 50, 50, 100, 100, galaxy.independentEmpire, null));
        const defenders = planet.troops!.items.slice();
        generateDefensivePirateRaiders(galaxy, planet, faction, true);
        for (const t of defenders) expect(planet.invadingTroops!.contains(t)).toBe(true);
        expect(planet.troops!.items.every((t) => t.type === TroopType.PirateRaider)).toBe(true);
    }, 300000);
});

describe('Galaxy.9.cs 3151 RemoveSystem + Habitat.cs 7909 system-star teardown', () => {
    it('removes the system, its star and habitats, re-indexes habitats and system indexes', () => {
        const galaxy = newGalaxy();
        const idx = galaxy.systems.findIndex((s, i) => i > 0 && s.systemStar.category === HabitatCategoryType.Star && s.habitats.every((h) => h.empire === null) && !galaxy.builtObjects.some((b) => b != null && b.nearestSystemStar === s.systemStar));
        const system = galaxy.systems[idx];
        const star = system.systemStar;
        const members = system.habitats.slice();
        const systemsBefore = galaxy.systems.length;
        const habitatsBefore = galaxy.habitats.length;
        const later = galaxy.habitats.find((h) => h.systemIndex === idx + 1)!;
        const laterIndex = later.habitatIndex;
        const human = galaxy.empires[0];
        const svBefore = human.visibility.systemVisibility.length;
        removeSystem(galaxy, system);
        expect(galaxy.systems.length).toBe(systemsBefore - 1);
        expect(galaxy.habitats.length).toBe(habitatsBefore - members.length);
        expect(galaxy.habitats.includes(star)).toBe(false);
        expect(later.systemIndex).toBe(idx);
        expect(later.habitatIndex).toBe(laterIndex - members.length);
        expect(galaxy.habitats.every((h, i) => h.habitatIndex === i)).toBe(true);
        expect(human.visibility.systemVisibility.length).toBe(svBefore - 1);
        expect(human.visibility.systemVisibility.some((v) => v.systemStar === star)).toBe(false);
        expect(system.systemStar).toBe(null);
        expect(galaxy.systems[idx].systemStar.systemIndex).toBe(idx);
    }, 300000);
});
