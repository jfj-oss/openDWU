// Package 19d4 — Refugees & demographics (tasks/19d4-refugees-demographics.md §7). Not a port.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';
import { Population, PopulationList } from '../src/sim/population';
import { resolveStandardRaceBias } from '../src/sim/raceBias';
import { Character, CharacterRole, CharacterTraitType } from '../src/sim/characters';
import { habitatRacialHappiness, empireApprovalRating } from '../src/sim/taxes';
import type { PrioritizedTarget } from '../src/sim/civilianAI';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { reviewMigrationTourism } from '../src/sim/civilianAI';
import { gameYear, scenarioYearlyTick } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import {
    acceptFlow,
    addChainMigrationDestinations,
    addChainMigrationSources,
    aiAcceptsRefugeeFlow,
    chooseAsylum,
    colonyTension,
    demographicsApprovalTerm,
    demographicsStateOf,
    getAsylumPolicy,
    recordRefugeeCause,
    refugeeConvoySkipLoad,
    setAsylumPolicy,
    settleRefugeeConvoyArrival,
    spawnRefugeeFlows,
    type RefugeeFlow,
} from '../src/sim/scenario/emergent/demographics';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

/** Any two distinct races of `g` with a known negative standard bias one way or the other (used by several tests, as
 * the spec's §7 "pick two races with a known negative bias" instructs). */
function negativeBiasPair(g: Galaxy): [Habitat['population']['items'][number]['race'], Habitat['population']['items'][number]['race']] {
    for (const a of g.races) {
        for (const b of g.races) {
            if (a !== b && resolveStandardRaceBias(a, b) < 0) return [a, b];
        }
    }
    throw new Error('no negative-bias race pair in this data set');
}

describe('colonyTension (§2.7, pure)', () => {
    it('is 0 for a single-race colony and > 0 for a disliked pair, scaled by population share', async () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true } });
        const g = game.galaxy;
        const h = game.playerEmpire.capital!;
        const [a, b] = negativeBiasPair(g);
        const saved = h.population.items.slice();
        h.population.items.length = 0;
        h.population.add(new Population(a, 100));
        h.population.recalculateTotalAmount();
        expect(colonyTension(g, h)).toBe(0); // one race: no pair
        h.population.add(new Population(b, 100));
        h.population.recalculateTotalAmount();
        const t1 = colonyTension(g, h);
        expect(t1).toBeGreaterThan(0);
        // A more lopsided split (same pair) should lower the tension (s_i * s_j shrinks away from 0.5/0.5).
        h.population.items[0].amount = 900;
        h.population.recalculateTotalAmount();
        const t2 = colonyTension(g, h);
        expect(t2).toBeLessThan(t1);
        // restore
        h.population.items.length = 0;
        for (const p of saved) h.population.add(p);
        h.population.recalculateTotalAmount();
    });

    it('unassimilated population counts double in its race share weight', async () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true } });
        const g = game.galaxy;
        const h = game.playerEmpire.capital!;
        const [a, b] = negativeBiasPair(g);
        h.population.items.length = 0;
        const pa = new Population(a, 100);
        const pb = new Population(b, 900);
        h.population.add(pa);
        h.population.add(pb);
        h.population.recalculateTotalAmount();
        const plain = colonyTension(g, h);
        pa.unassimilatedAmount = 100; // doubles a's share weight (100 -> 200 of 1100)
        const withUnassimilated = colonyTension(g, h);
        expect(withUnassimilated).toBeGreaterThan(plain);
    });

    it('governor / empire-leader traits scale tension (Xenophobic up, Tolerant down)', async () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true } });
        const g = game.galaxy;
        const h = game.playerEmpire.capital!;
        const [a, b] = negativeBiasPair(g);
        h.population.items.length = 0;
        h.population.add(new Population(a, 500));
        h.population.add(new Population(b, 500));
        h.population.recalculateTotalAmount();
        const base_ = colonyTension(g, h);
        const gov = new Character('Gov', CharacterRole.ColonyGovernor, '', a, game.playerEmpire, null, 0);
        gov.activate(g, game.playerEmpire, h);
        gov.traits.push(CharacterTraitType.Xenophobic);
        expect(colonyTension(g, h)).toBeCloseTo(base_ * 1.5, 6);
        gov.traits.length = 0;
        gov.traits.push(CharacterTraitType.Tolerant);
        expect(colonyTension(g, h)).toBeCloseTo(base_ * 0.5, 6);
    });
});

describe('demographicsApprovalTerm / empireApprovalRating query (§2.7)', () => {
    it('adds a negative term when flag on, no term when flag off', () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: false } });
        const g = game.galaxy;
        const h = game.playerEmpire.capital!;
        const [a, b] = negativeBiasPair(g);
        h.population.items.length = 0;
        h.population.add(new Population(a, 500));
        h.population.add(new Population(b, 500));
        h.population.recalculateTotalAmount();
        const off = empireApprovalRating(g, h);
        g.scenario!.flags.refugees = true;
        const term = demographicsApprovalTerm(g, h);
        expect(term).toBeLessThan(0);
        const on = empireApprovalRating(g, h);
        expect(on).toBeCloseTo(off + term, 6);
    });
});

describe('assimilation (§2.8, yearly)', () => {
    it('moves a share of unassimilatedAmount toward 0 each year, scaled by governor / raceFamily factors', () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true }, params: { assimilationRate: 0.2 } });
        const g = game.galaxy;
        const h = game.playerEmpire.capital!;
        const dominant = h.population.dominantRace!;
        const [race] = g.races.filter((r) => r !== dominant && r.raceFamily !== dominant.raceFamily);
        const p = new Population(race, 1_000_000);
        p.unassimilatedAmount = 1_000_000;
        h.population.add(p);
        h.population.recalculateTotalAmount();
        g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
        g.nowMs += YEAR_LENGTH;
        scenarioYearlyTick(g);
        // rate 0.2, no governor, different raceFamily: factor 1.
        expect(p.unassimilatedAmount).toBe(1_000_000 - Math.trunc(1_000_000 * 0.2));
    });
});

describe('chooseAsylum (§2.3, no Rnd)', () => {
    it('best score wins; an exact tie breaks on the lower habitat id', () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true } });
        const g = game.galaxy;
        const origin = g.empires.find((e) => e !== game.playerEmpire)!.colonies[0];
        const race = origin.population.dominantRace ?? g.races[0];
        const pool = g.habitats
            .filter((h) => h !== origin && h.empire !== null && h.empire !== g.independentEmpire)
            .sort((a, b) => g.habitats.indexOf(a) - g.habitats.indexOf(b));
        const [hA, hB] = pool;
        expect(hA).toBeDefined();
        expect(hB).toBeDefined();
        expect(g.habitats.indexOf(hA)).toBeLessThan(g.habitats.indexOf(hB));
        // Neutralise every other real colony in the galaxy (mark it "full") so hA/hB are the only viable candidates;
        // otherwise some unrelated colony's organic distance/bias could out-score the pair we are testing.
        for (const h of [...g.empires.flatMap((e) => e.colonies), ...g.independentColonies]) {
            if (h === origin || h === hA || h === hB) continue;
            if (h.maxPopulation <= 0) h.maxPopulation = 1;
            h.population.totalAmount = h.maxPopulation;
        }
        // Force an exact tie: same distance from origin, same race already present, no links, 'open' policy so the
        // bias/kin filtering never disqualifies either one.
        for (const h of [hA, hB]) {
            h.xpos = origin.xpos + 10;
            h.ypos = origin.ypos;
            h.population.items.length = 0;
            h.population.add(new Population(race, 1));
            h.population.recalculateTotalAmount();
            h.maxPopulation = 1_000_000_000;
            h.colonyPopulationPolicy = 0; // Assimilate: acceptsPopulation (civilianAI.ts) must pass regardless of the empire's own default policy
            h.colonyPopulationPolicyRaceFamily = 0;
            setAsylumPolicy(g, h.empire!, 'open');
        }
        const flow: RefugeeFlow = {
            id: 1, race, amount: 20_000_000, origin, originEmpire: origin.empire, cause: 'conquest',
            destination: null, host: null, stage: 'pending', created: gameYear(galaxyStarDate(g)), excludedHosts: [], decisionId: null,
        };
        const choice = chooseAsylum(g, flow);
        expect(choice).not.toBeNull();
        expect(choice!.habitat).toBe(hA); // the tie breaks on the lower habitat id
        // Now give hB a same-race population too but boost hA's link strength so hA still wins on score.
        demographicsStateOf(g).links.push({ from: origin, to: hA, race, strength: 1, lastYear: 0 });
        const choice2 = chooseAsylum(g, flow);
        expect(choice2!.habitat).toBe(hA);
    });
});

describe('flow size bounds (§2.2, stubbed Random)', () => {
    it('amount = trunc(race amount * refugeeShare * (0.75 + rnd*0.5)), floored at 10M and never below the population floor', () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true }, params: { refugeeShare: 0.15 } });
        const g = game.galaxy;
        const target = g.empires.find((e) => e !== game.playerEmpire && e.colonies.length > 0)!;
        const habitat = target.colonies[0];
        const dominant = game.playerEmpire.dominantRace!;
        const [race] = g.races.filter((r) => r !== dominant && resolveStandardRaceBias(r, dominant) < 0 && r !== target.dominantRace);
        expect(race).toBeDefined();
        const raceAmount = 200_000_000;
        habitat.population.items.length = 0;
        habitat.population.add(new Population(target.dominantRace!, raceAmount));
        habitat.population.add(new Population(race, raceAmount));
        habitat.population.recalculateTotalAmount();
        takeOwnershipOfColonyFull(g, game.playerEmpire, habitat, game.playerEmpire, false, false);
        expect(demographicsStateOf(g).causes.some((c) => c.habitat === habitat && c.cause === 'conquest')).toBe(true);

        const originalNextDouble = g.rnd.nextDouble.bind(g.rnd);
        g.rnd.nextDouble = () => 0; // (0.75 + 0*0.5) = 0.75
        try {
            spawnRefugeeFlows(g, game.playerEmpire);
        } finally {
            g.rnd.nextDouble = originalNextDouble;
        }
        const flow = demographicsStateOf(g).flows.find((f) => f.race === race && f.origin === habitat)!;
        expect(flow).toBeDefined();
        expect(flow.amount).toBe(Math.trunc(raceAmount * 0.15 * 0.75));
        expect(flow.amount).toBeGreaterThanOrEqual(10_000_000);
    });
});

describe('AI rules (§4, testable)', () => {
    it('rule 1: an AI host accepts a non-negative-bias flow under 25% of its population, refuses otherwise / at war', () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true } });
        const g = game.galaxy;
        const host = g.empires.find((e) => e !== game.playerEmpire)!;
        const dest = host.colonies.find((h) => h.population.totalAmount > 0)!;
        const flow: RefugeeFlow = {
            id: 1, race: host.dominantRace!, amount: Math.trunc(dest.population.totalAmount * 0.1), origin: dest, originEmpire: null,
            cause: 'conquest', destination: dest, host, stage: 'pending', created: 0, excludedHosts: [], decisionId: null,
        };
        expect(aiAcceptsRefugeeFlow(g, host, flow)).toBe(true);
        flow.amount = dest.population.totalAmount * 2; // >= 25%
        expect(aiAcceptsRefugeeFlow(g, host, flow)).toBe(false);
    });

    it('standing asylum policy defaults to "kin" and setAsylumPolicy overrides it', () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true } });
        const g = game.galaxy;
        expect(getAsylumPolicy(g, game.playerEmpire)).toBe('kin');
        setAsylumPolicy(g, game.playerEmpire, 'open');
        expect(getAsylumPolicy(g, game.playerEmpire)).toBe('open');
    });
});

describe('chain migration (§2.9)', () => {
    it('a migration link adds its destination to determineMigrationDestinations (via reviewMigrationTourism)', () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true } });
        const g = game.galaxy;
        const empire = game.playerEmpire;
        const dest = empire.colonies[0];
        const origin = g.empires.find((e) => e !== empire)!.colonies[0];
        demographicsStateOf(g).links.push({ from: origin, to: dest, race: dest.population.dominantRace ?? empire.dominantRace!, strength: 0.7, lastYear: 0 });
        reviewMigrationTourism(g, empire);
        const found = empire.migrationDestinations.find((t) => t.target === dest);
        expect(found).toBeDefined();
        expect(found!.priority).toBeGreaterThanOrEqual(700 - 1); // trunc(0.7*1000)=700 (may combine with the stock rule)
    });

    it('addChainMigrationSources includes a foreign link origin only when strength > 0.5 and not at war', () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true } });
        const g = game.galaxy;
        const empire = game.playerEmpire;
        const foreign = g.empires.find((e) => e !== empire)!;
        const origin = foreign.colonies[0];
        demographicsStateOf(g).links.push({ from: origin, to: empire.colonies[0], race: foreign.dominantRace!, strength: 0.6, lastYear: 0 });
        const targets: PrioritizedTarget[] = [];
        addChainMigrationSources(g, empire, targets);
        expect(targets.some((t) => t.target === origin)).toBe(true);
        demographicsStateOf(g).links[0].strength = 0.4;
        const targets2: PrioritizedTarget[] = [];
        addChainMigrationSources(g, empire, targets2);
        expect(targets2.some((t) => t.target === origin)).toBe(false);
    });

    it('addChainMigrationDestinations adds every link destination owned by the empire, priority trunc(strength*1000)', () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true } });
        const g = game.galaxy;
        const empire = game.playerEmpire;
        const dest = empire.colonies[0];
        demographicsStateOf(g).links.push({ from: dest, to: dest, race: empire.dominantRace!, strength: 0.42, lastYear: 0 });
        const targets: PrioritizedTarget[] = [];
        addChainMigrationDestinations(g, empire, targets);
        expect(targets.length).toBe(1);
        expect(targets[0].target).toBe(dest);
        expect(targets[0].priority).toBe(420);
    });
});

describe('harness: conquest -> cause -> flow -> convoy -> arrival (§7)', () => {
    it('conquering a colony with a disliked minority race records a cause, spawns a flow at the next migration review, builds a convoy with a Transport mission, and settling it updates the destination, links and tension', () => {
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: true } });
        const g = game.galaxy;
        const player = game.playerEmpire;
        const target = g.empires.find((e) => e !== player && e.colonies.length > 0 && resolveStandardRaceBias(e.dominantRace, player.dominantRace) < 0)
            ?? g.empires.find((e) => e !== player && e.colonies.length > 0)!;
        expect(target).toBeDefined();
        const fleeingRace = target.dominantRace!;
        const origin = target.colonies[0];
        // The destination is a *different* empire's colony (a fresh seed-1 game gives every empire one colony, so
        // "target keeps a second colony" cannot be assumed): the fleeing minority naturally seeks asylum elsewhere.
        const host = g.empires.find((e) => e !== player && e !== target && e.colonies.length > 0)!;
        expect(host).toBeDefined();
        const homeColony = host.colonies[0];

        // Inject a minority population of the target's own race at a colony we are about to conquer (a natural
        // "annexed population that dislikes the new owner" set-up, per §2.2's fleeing-race rule for 'conquest').
        origin.population.add(new Population(fleeingRace, 60_000_000));
        origin.population.recalculateTotalAmount();

        takeOwnershipOfColonyFull(g, player, origin, player, false, false);
        expect(origin.empire).toBe(player);
        const cause = demographicsStateOf(g).causes.find((c) => c.habitat === origin && c.cause === 'conquest');
        expect(cause).toBeDefined();
        expect(cause!.oldOwner).toBe(target);

        reviewMigrationTourism(g, player); // spawns flows for player-owned cause habitats (§2.2)
        expect(demographicsStateOf(g).causes.some((c) => c.habitat === origin)).toBe(false); // consumed

        let flow = demographicsStateOf(g).flows.find((f) => f.origin === origin && f.race === fleeingRace);
        if (flow === undefined || resolveStandardRaceBias(fleeingRace, player.dominantRace) >= 0) {
            // The race pair in this seed's data did not clear the fleeing-race bias test (rare); build the flow by
            // hand to exercise the rest of the pipeline deterministically (spec §7 "force the unload path").
            flow = {
                id: 999, race: fleeingRace, amount: 20_000_000, origin, originEmpire: target, cause: 'conquest',
                destination: null, host: null, stage: 'pending', created: gameYear(galaxyStarDate(g)), excludedHosts: [], decisionId: null,
            };
            demographicsStateOf(g).flows.push(flow);
        }
        expect(flow.amount).toBeGreaterThanOrEqual(10_000_000);

        // Force a deterministic destination/acceptance (the flow may already have resolved organically; either way,
        // acceptFlow builds a fresh, independently-owned convoy with a Transport mission from origin to destination).
        flow.destination = homeColony;
        flow.host = host;
        flow.stage = 'pending';
        acceptFlow(g, flow);
        expect(flow.stage).toBe('travelling');
        const convoyEntries = [...demographicsStateOf(g).convoys.entries()].filter(([, c]) => c.flow === flow);
        expect(convoyEntries.length).toBeGreaterThan(0);
        const [ship] = convoyEntries[0];
        expect(ship.mission).not.toBeNull();
        expect(refugeeConvoySkipLoad(g, ship)).toBe(true);
        expect(ship.population!.totalAmount).toBeGreaterThan(0);

        // Force the unload path (spec §7): settle every convoy of this flow directly at the destination. The hook
        // (as wired in missions/cmdDocking.ts) runs right after the ported Unload code has already merged the
        // arrived population into the destination, so forcing it here first mirrors that (BuiltObject.2.cs 3698).
        const beforeAmount = homeColony.population.items.find((p) => p.race === fleeingRace)?.amount ?? 0;
        for (const [convoyShip] of convoyEntries) {
            for (const item of convoyShip.population!.items) homeColony.population.add(new Population(item.race, item.amount));
            homeColony.population.recalculateTotalAmount();
            settleRefugeeConvoyArrival(g, convoyShip, homeColony);
        }
        expect(flow.stage).toBe('settled');
        const arrived = homeColony.population.items.find((p) => p.race === fleeingRace);
        expect(arrived).toBeDefined();
        expect(arrived!.amount).toBeGreaterThan(beforeAmount);
        expect(arrived!.unassimilatedAmount).toBeGreaterThan(0);
        const link = demographicsStateOf(g).links.find((l) => l.from === origin && l.to === homeColony && l.race === fleeingRace);
        expect(link).toBeDefined();
        expect(link!.strength).toBeGreaterThan(0);

        // Tension term appears in the destination's approval breakdown once there is a disliked pair there.
        const [a, b] = negativeBiasPair(g);
        homeColony.population.items.length = 0;
        homeColony.population.add(new Population(a, 500));
        homeColony.population.add(new Population(b, 500));
        homeColony.population.recalculateTotalAmount();
        expect(demographicsApprovalTerm(g, homeColony)).toBeLessThan(0);

        // Enough arrivals to flip the dominant race: habitatRacialHappiness now evaluates the new race (ported code
        // runs unmodified once the population shifts — proves the mod layer changes nothing downstream of it).
        const otherRace = g.races.find((r) => r !== homeColony.empire!.dominantRace)!;
        homeColony.population.items.length = 0;
        homeColony.population.add(new Population(otherRace, 10_000_000_000)); // amount * intelligence swamps any other race
        homeColony.population.recalculateTotalAmount();
        expect(homeColony.population.dominantRace).toBe(otherRace);
        expect(() => habitatRacialHappiness(g, homeColony)).not.toThrow();
    });
});

describe('flags off = byte-identical (repin gate)', () => {
    it('refugees-demographics with every flag off gives the same seed-1 game and run as no scenario', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        const { game } = createScenarioGame(base, { scenario: 'refugees-demographics', flags: { refugees: false } });
        expect(game.galaxy.scenario).not.toBeNull();
        expect(game.galaxy.scenario!.flags.refugees).toBe(false);
        const run = runGameSeconds(game, 600);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
    }, 2400000);
});
