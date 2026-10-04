// Scenario 19h "rim frontier geography" (tasks/19-mod-layer-scenarios.md §19h): storm belt, sparser rim, gravity shoals,
// inward fuel, rim sensor fog, map scale; flag off = the faithful game; stacks with the 19a rim trader.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame, cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame, inlineOverlay, loadScenarioOverlayFs, scenarioGameData, scenarioIndexFs } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { radiusFraction, resolveScenarioIncludes, scenarioQuery } from '../src/sim/scenario';
import { GalaxyLocationEffectType, GalaxyLocationType } from '../src/sim/galaxyLocation';
import { HabitatCategoryType } from '../src/sim/types';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { RIM_FRONTIER_DEFAULTS, rimFrontierState, rimFuelOases } from '../src/sim/scenario/rimFrontier/common';
import { frontierPirateHunt } from '../src/sim/scenario/rimFrontier/rimFrontier';
import { rimGoodIds, rimTraderEmpire } from '../src/sim/scenario/rimTrade/common';
import { rimFaunaState, type RimHerd } from '../src/sim/scenario/rimFauna/common';
import { generateNewPirateEmpires, type PirateGenerationContext } from '../src/sim/pirates';
import { Creature, CreatureType } from '../src/sim/creature';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { resolveSectorDescription } from '../src/sim/empireEvents';
import { sectorColumnLabel } from '../src/ui/screens/galaxyMap';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const D = RIM_FRONTIER_DEFAULTS;

function stormsBy(g: Galaxy): { inner: number; belt: number } {
    let inner = 0;
    let belt = 0;
    for (const l of g.galaxyLocations) {
        if (l.type !== GalaxyLocationType.NebulaCloud || l.effect !== GalaxyLocationEffectType.LightningDamage) continue;
        const c = l.resolveLocationCenter();
        if (radiusFraction(g, c.x, c.y) >= D.rimFrontierBeltInner) belt++;
        else inner++;
    }
    return { inner, belt };
}

function starsBeyond(g: Galaxy, f: number): { beyond: number; total: number } {
    let beyond = 0;
    let total = 0;
    for (const h of g.habitats) {
        if (h.category !== HabitatCategoryType.Star) continue;
        total++;
        if (radiusFraction(g, h.xpos, h.ypos) >= f) beyond++;
    }
    return { beyond, total };
}

function fuelResourceIds(g: Galaxy): number[] {
    return ['Caslon', 'Hydrogen'].map((n) => g.resourceSystem.resources.find((r) => r.name === n)!.resourceId);
}

function fuelBeyond(g: Galaxy, f: number): number {
    const ids = fuelResourceIds(g);
    let n = 0;
    for (const h of g.habitats) {
        if (h.resources.some((r) => ids.includes(r.resourceId)) && radiusFraction(g, h.xpos, h.ypos) > f) n++;
    }
    return n;
}

/** Sector centre radiusFraction, from a system's stored sector (Galaxy.4.cs Systems build). */
function sectorCentreFraction(g: Galaxy, sector: { x: number; y: number }): number {
    return radiusFraction(g, (sector.x + 0.5) * g.sectorSize, (sector.y + 0.5) * g.sectorSize);
}

describe('19h rim frontier — generation', () => {
    let on: Game;
    let off: Game;
    beforeAll(() => {
        off = cachedTickGame(base);
        on = createScenarioGame(base, { scenario: 'rim-frontier' }).game;
    }, 600000);

    it('the manifest is in the index with the flag and every param', () => {
        const m = scenarioIndexFs().find((x) => x.id === 'rim-frontier')!;
        expect(m.flags.map((f) => f.name)).toEqual(['rimFrontier']);
        expect(m.params.map((p) => p.name).sort()).toEqual(Object.keys(D).sort());
        for (const p of m.params) expect(p.default).toBe(D[p.name as keyof typeof D]);
        // The raised star-count cap (was 2000).
        expect(m.params.find((p) => p.name === 'rimFrontierStarCount')?.max).toBe(4000);
    });

    it('1: storm density rises in the belt; the core is untouched', () => {
        const a = stormsBy(off.galaxy);
        const b = stormsBy(on.galaxy);
        expect(b.inner).toBe(a.inner);
        expect(b.belt).toBeGreaterThanOrEqual(a.belt + 10);
        expect(rimFrontierState(on.galaxy).addedStorms.length).toBe(Math.round(D.rimFrontierStormDensity * 3 * on.galaxy.sectorWidth));
    });

    it('2: stars thin past the thinning radius (same star count)', () => {
        const a = starsBeyond(off.galaxy, D.rimFrontierThinRadius);
        const b = starsBeyond(on.galaxy, D.rimFrontierThinRadius);
        expect(b.total).toBe(a.total);
        expect(b.beyond).toBeLessThan(a.beyond * 0.75);
    });

    it('4: Caslon and Hydrogen only roll inside the fuel radius (fuel oases isolated off — see the 9: describe block)', () => {
        const noOases = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimFrontierOasesPerSector: 0 } }).game.galaxy;
        expect(fuelBeyond(off.galaxy, D.rimFrontierFuelMaxRadius)).toBeGreaterThan(5);
        expect(fuelBeyond(noOases, D.rimFrontierFuelMaxRadius)).toBe(0);
    });

    it('3: gravity shoals are map locations that end a hyperjump crossing them', () => {
        const g = on.galaxy;
        const shoals = rimFrontierState(g).shoals;
        expect(shoals.length).toBe(D.rimFrontierShoalCount);
        const s = shoals[0];
        expect(g.galaxyLocations).toContain(s);
        expect(g.determineGalaxyLocationsAtPoint(s.xpos + s.width / 2, s.ypos + s.height / 2)).toContain(s);
        const r = s.width / 2;
        const cx = s.xpos + r;
        const cy = s.ypos + s.height / 2;
        const ship = on.galaxy.empires[0]!.builtObjects[0];
        const args = { ship, fromX: cx - 3 * r, fromY: cy, toX: cx + 3 * r, toY: cy, exitX: cx + 10 * r, exitY: cy };
        const stop = scenarioQuery(g, 'hyperjumpStop', null, args)!;
        expect(stop).not.toBeNull();
        expect(Math.hypot(stop.x - cx, stop.y - cy)).toBeLessThan(r);
        expect(Math.hypot(stop.x - cx, stop.y - cy)).toBeGreaterThan(r - 2);
        // Restarting from the stop point crosses the shoal freely; a step that ends short of it or an exit before it is not stopped.
        expect(scenarioQuery(g, 'hyperjumpStop', null, { ...args, fromX: stop.x, fromY: stop.y })).toBeNull();
        expect(scenarioQuery(g, 'hyperjumpStop', null, { ...args, toX: cx - 1.5 * r })).toBeNull();
        expect(scenarioQuery(g, 'hyperjumpStop', null, { ...args, exitX: cx - 1.5 * r })).toBeNull();
        expect(scenarioQuery(off.galaxy, 'hyperjumpStop', null, args)).toBeNull();
    });

    it('5: ship sensors reach less far toward rim targets', () => {
        const g = on.galaxy;
        const cx = g.sizeX / 2;
        expect(scenarioQuery(g, 'scanRangeModifier', 1, { x: cx, y: cx })).toBe(1);
        expect(scenarioQuery(g, 'scanRangeModifier', 1, { x: cx + 0.9 * cx, y: cx })).toBe(D.rimFrontierFogFactor);
        expect(scenarioQuery(off.galaxy, 'scanRangeModifier', 1, { x: cx + 0.9 * cx, y: cx })).toBe(1);
    });

    it('6: the extent multiplier spreads the same stars wider (past the 15-sector clamp too); the star count param', () => {
        const wide = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimFrontierExtent: 1.5 } }).game.galaxy;
        expect(wide.sectorWidth).toBe(12);
        expect(wide.sizeX).toBe(12 * wide.sectorSize);
        expect(starsBeyond(wide, 0).total).toBe(starsBeyond(off.galaxy, 0).total);
        let maxX = 0;
        for (const h of wide.habitats) maxX = Math.max(maxX, h.xpos);
        expect(maxX).toBeGreaterThan(off.galaxy.sizeX);
        const big = (o: CreateGameOptions): CreateGameOptions => ({ ...o, sectorWidth: 15, sectorHeight: 15, starCount: 120, systemNames: Array.from({ length: 150 }, (_, i) => `S${i}`) });
        const huge = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimFrontierExtent: 1.7, rimFrontierStarCount: 150 }, options: big }).game.galaxy;
        expect(huge.sectorWidth).toBe(26);
        expect(starsBeyond(huge, 0).total).toBe(150);
    }, 600000);

    it('6b: the raised star-count cap (4000) at max extent (1.7) — still 26 sectors, unique sector labels, index grid covers it', () => {
        const big = (o: CreateGameOptions): CreateGameOptions => ({
            ...o,
            sectorWidth: 15,
            sectorHeight: 15,
            starCount: 4000,
            systemNames: Array.from({ length: 4400 }, (_, i) => `S${i}`),
        });
        const g = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimFrontierExtent: 1.7, rimFrontierStarCount: 4000 }, options: big }).game.galaxy;
        expect(starsBeyond(g, 0).total).toBe(4000);
        // 15 (the wizard's largest preset) * 1.7 = 25.5 → round → 26 (the base custom-size path, Galaxy.setCustomGalaxyDimensions):
        // sector labels stay one letter (A..Z); past 26 columns they continue AA, AB, … (sectorNames.ts sectorColumnName).
        expect(g.sectorWidth).toBe(26);
        expect(g.sectorHeight).toBe(26);
        const labels = new Set<string>();
        for (let x = 0; x < g.sectorWidth; x++) {
            for (let y = 0; y < g.sectorHeight; y++) {
                const label = resolveSectorDescription(g, x * g.sectorSize, y * g.sectorSize);
                expect(label).toMatch(/^[A-Z]\d+$/);
                labels.add(label);
            }
        }
        expect(labels.size).toBe(g.sectorWidth * g.sectorHeight);
        for (let i = 0; i < g.sectorWidth; i++) expect(sectorColumnLabel(i)).toBe(String.fromCharCode(65 + i));
        // The location index grid (Galaxy.4.cs AddGalaxyLocationIndex, sized off sizeX/sizeY) is rebuilt at the
        // extended galaxy size, not the stock 15-sector one, and covers every corner.
        expect(g.sizeX).toBe(26 * g.sectorSize);
        expect(g.sizeY).toBe(26 * g.sectorSize);
        expect(() => g.determineGalaxyLocationsAtPoint(0, 0)).not.toThrow();
        expect(() => g.determineGalaxyLocationsAtPoint(g.sizeX - 1, g.sizeY - 1)).not.toThrow();
    }, 600000);
});

describe('19h rim frontier — faithful path, save, stacking', () => {
    it('flag off: the same seed-1 game and 600 s run as no scenario', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier', flags: { rimFrontier: false } });
        expect('rimFrontier' in game.galaxy.scenario!.state).toBe(false);
        const run = runGameSeconds(game, 600);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
    }, 1200000);

    it('with the rim trader: both run; the Concord on the rim, rim goods, frontier features; save resumes identically', () => {
        const byId = new Map(scenarioIndexFs().map((m) => [m.id, loadScenarioOverlayFs(m.id)] as const));
        const both = resolveScenarioIncludes(inlineOverlay({ id: 'rimTradeFrontier', include: ['rimTrade', 'rim-frontier'] }), byId);
        const forceOranthi = (o: CreateGameOptions): CreateGameOptions => ({ ...o, aiEmpires: [{ ...o.aiEmpires[0], race: 'Oranthi' }, ...o.aiEmpires.slice(1)] });
        // rimFrontierOasesPerSector: 0 isolates fuel-scarcity's own check below from the 9: fuel-oases feature (its own
        // describe block covers it) the same way the pirate-share test isolates the split from fuel scarcity.
        const { game } = createScenarioGame(base, { scenario: both, options: forceOranthi, params: { rimFrontierOasesPerSector: 0 } });
        const g = game.galaxy;
        expect(g.scenario!.flags).toMatchObject({ rimFrontier: true, rimTrader: true });
        const r = rimTraderEmpire(g)!;
        expect(r).not.toBeNull();
        expect(radiusFraction(g, r.capital!.xpos, r.capital!.ypos)).toBeGreaterThanOrEqual(0.8);
        const rim = rimGoodIds(g);
        let rimCount = 0;
        for (const h of g.habitats) {
            if (!h.resources.some((x) => rim.includes(x.resourceId))) continue;
            rimCount++;
            expect(radiusFraction(g, h.xpos, h.ypos)).toBeGreaterThanOrEqual(0.72);
        }
        expect(rimCount).toBeGreaterThan(0);
        expect(rimFrontierState(g).shoals.length).toBe(D.rimFrontierShoalCount);
        expect(fuelBeyond(g, D.rimFrontierFuelMaxRadius)).toBe(0);
        runGameSeconds(game, 300);
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(g.nowMs);
        const text = serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'rimTradeFrontier', flags: { ...g.scenario!.flags }, params: {} } });
        const loaded = deserializeGame(text, scenarioGameData(base, both)).game;
        expect(rimFrontierState(loaded.galaxy).shoals.map((s) => s.name)).toEqual(rimFrontierState(g).shoals.map((s) => s.name));
        expect(loaded.galaxy.galaxyLocations).toContain(rimFrontierState(loaded.galaxy).shoals[0]);
        runGameSeconds(game, 120);
        runGameSeconds(loaded, 120);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(g));
    }, 1200000);
});

describe('19h rim frontier — keep empire starts out of the rim', () => {
    it('every non-Concord empire capital sits inside the belt inner radius (seeds 1 and 2)', () => {
        for (const seed of [1, 2]) {
            const { game } = createScenarioGame(base, { scenario: 'rim-frontier', options: (o) => ({ ...o, seed }) });
            const g = game.galaxy;
            for (const e of g.empires) {
                if (e.dominantRace?.name === 'Oranthi') continue;
                expect(radiusFraction(g, e.capital!.xpos, e.capital!.ypos), `seed ${seed} empire ${e.name}`).toBeLessThan(D.rimFrontierBeltInner);
            }
        }
    }, 120000);

    it('the query: a rim candidate is rejected for an ordinary race, the Concord race is exempt', () => {
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier' });
        const g = game.galaxy;
        const rimHabitat = g.habitats.find((h) => radiusFraction(g, h.xpos, h.ypos) >= D.rimFrontierBeltInner)!;
        const coreHabitat = g.habitats.find((h) => radiusFraction(g, h.xpos, h.ypos) < D.rimFrontierBeltInner)!;
        const race = g.empires[0].dominantRace!;
        expect(scenarioQuery(g, 'acceptHomeHabitat', true, { race, habitat: rimHabitat, empireKind: 'ai' })).toBe(false);
        expect(scenarioQuery(g, 'acceptHomeHabitat', true, { race, habitat: coreHabitat, empireKind: 'ai' })).toBe(true);
        const concordRace = { ...race, name: 'Oranthi' };
        expect(scenarioQuery(g, 'acceptHomeHabitat', true, { race: concordRace, habitat: rimHabitat, empireKind: 'ai' })).toBe(true);
    });

    it('param 0: the stock (unfiltered) placement returns', () => {
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimFrontierKeepStartsOut: 0 } });
        const g = game.galaxy;
        const rimHabitat = g.habitats.find((h) => radiusFraction(g, h.xpos, h.ypos) >= D.rimFrontierBeltInner)!;
        const race = g.empires[0].dominantRace!;
        expect(scenarioQuery(g, 'acceptHomeHabitat', true, { race, habitat: rimHabitat, empireKind: 'player' })).toBe(true);
    });

    it('with the rim trader stacked: the Concord still lands in its own rim ring, everyone else stays inside the belt', () => {
        const byId = new Map(scenarioIndexFs().map((m) => [m.id, loadScenarioOverlayFs(m.id)] as const));
        const both = resolveScenarioIncludes(inlineOverlay({ id: 'rimStartsConcord', include: ['rimTrade', 'rim-frontier'] }), byId);
        const forceOranthi = (o: CreateGameOptions): CreateGameOptions => ({ ...o, aiEmpires: [{ ...o.aiEmpires[0], race: 'Oranthi' }, ...o.aiEmpires.slice(1)] });
        const { game } = createScenarioGame(base, { scenario: both, options: forceOranthi });
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        expect(r).not.toBeNull();
        expect(radiusFraction(g, r.capital!.xpos, r.capital!.ypos)).toBeGreaterThanOrEqual(0.72);
        for (const e of g.empires) {
            if (e === r) continue;
            expect(radiusFraction(g, e.capital!.xpos, e.capital!.ypos)).toBeLessThan(D.rimFrontierBeltInner);
        }
    }, 120000);
});

describe('19h rim frontier — pirate base rim/core share', () => {
    function ctxOf(g: Galaxy): PirateGenerationContext {
        return { independentColonies: g.independentColonies, startingAge: g.startingAge, difficultyLevel: g.difficultyLevel };
    }

    /** Grows galaxy.pirateEmpires to at least `count` (each new faction still reads the share off the live, growing
     *  galaxy.pirateEmpires.length as it is created, so batching them in fewer/larger calls changes nothing). */
    function growPirateFactions(g: Galaxy, count: number): void {
        let guard = 0;
        while (g.pirateEmpires.length < count && guard < 50) {
            guard++;
            generateNewPirateEmpires(g, ctxOf(g), { piratePrevalence: 2, maximumEmpireAmount: count * 2 + 10, pirateProximity: 0 });
        }
    }

    it('on seed 1 with 20 factions, 12 rim / 8 core (round(20 x 0.6))', () => {
        // Pirate bases are always placed at a fuel-bearing habitat (Galaxy.9.cs GenerateNewPirateEmpires searches by
        // fuel resource); the default fuel-scarcity radius (0.65) sits inside the default belt inner radius (0.7), so
        // stacking both at their defaults would make a "rim" (>= 0.7) pirate base structurally unreachable — not a
        // bug in the split, just two features of the same package fighting over the same knob. Isolate the split here
        // (fuel scarcity off) the way its own end-to-end coverage isolates fuel scarcity from the belt (test '4').
        // rimFrontierOasesPerSector: 0 isolates the split from 9: fuel oases too — with scarcity off almost every rim
        // sector already has natural fuel, so the "already has one" skip leaves only a sparse few oases; the shared
        // pirates.ts fallback slot (one candidate remembered per faction, whatever it was rejected for) would then as
        // often catch a wrong-side candidate as a right-side-but-far-from-an-oasis one. The oasis feature's own effect
        // on placement is covered by the 9: fuel oases describe block instead.
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimFrontierFuelMaxRadius: 1.5, rimFrontierOasesPerSector: 0 } });
        const g = game.galaxy;
        growPirateFactions(g, 20);
        const first20 = g.pirateEmpires.slice(0, 20);
        expect(first20.length).toBe(20);
        const inner = D.rimFrontierBeltInner;
        const rim = first20.filter((e) => radiusFraction(g, e.pirateEmpireBaseHabitat!.xpos, e.pirateEmpireBaseHabitat!.ypos) >= inner).length;
        expect(rim).toBe(12);
        expect(first20.length - rim).toBe(8);
    }, 120000);

    it('param 0: stock placement (no rim/core split)', () => {
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimFrontierPirateRimShare: 0 } });
        const g = game.galaxy;
        const anyHabitat = g.habitats[0];
        expect(scenarioQuery(g, 'acceptPirateBase', true, { habitat: anyHabitat })).toBe(true);
    });
});

describe('19h rim frontier — base placement avoids rim herds (stacks with 19g rim fauna)', () => {
    it('a candidate inside a herd home range + buffer is rejected; far away it is not', () => {
        const byId = new Map(scenarioIndexFs().map((m) => [m.id, loadScenarioOverlayFs(m.id)] as const));
        const both = resolveScenarioIncludes(inlineOverlay({ id: 'rimFrontierFaunaAvoid', include: ['rim-frontier', 'rim-fauna'] }), byId);
        const { game } = createScenarioGame(base, { scenario: both, params: { rimFrontierNestAvoidRadius: 1000 } });
        const g = game.galaxy;
        const herd: RimHerd = {
            id: 999001, type: CreatureType.Kaltor, leader: new Creature(g, CreatureType.Kaltor, null), followers: [],
            homeSystemIndex: 0, homeX: 500000, homeY: 500000, homeRange: 5000,
            birthSystemIndex: 0, birthX: 500000, birthY: 500000,
            feedSite: null, feedTicks: 0, feedingStation: null, migration: null, docileEmpireIds: [], victimEmpireIds: [],
        };
        rimFaunaState(g).herds.push(herd);
        expect(scenarioQuery(g, 'placementAvoidsHerds', false, { x: 500000, y: 500000 })).toBe(true);
        expect(scenarioQuery(g, 'placementAvoidsHerds', false, { x: 505500, y: 500000 })).toBe(true); // inside homeRange + buffer
        expect(scenarioQuery(g, 'placementAvoidsHerds', false, { x: 520000, y: 500000 })).toBe(false); // past the buffer
    });

    it('flag off: no rejection even at the herd centre', () => {
        const byId = new Map(scenarioIndexFs().map((m) => [m.id, loadScenarioOverlayFs(m.id)] as const));
        const both = resolveScenarioIncludes(inlineOverlay({ id: 'rimFrontierFaunaAvoidOff', include: ['rim-frontier', 'rim-fauna'] }), byId);
        const { game } = createScenarioGame(base, { scenario: both, flags: { rimFrontier: false } });
        expect(scenarioQuery(game.galaxy, 'placementAvoidsHerds', false, { x: 500000, y: 500000 })).toBe(false);
    });
});

describe('19h rim frontier — pirate herd hunting (not a port: new scenario rule)', () => {
    it('a faction in range starts a hunt (Attack mission on the herd leader); the herd\'s death later pays a bounty', () => {
        const byId = new Map(scenarioIndexFs().map((m) => [m.id, loadScenarioOverlayFs(m.id)] as const));
        const both = resolveScenarioIncludes(inlineOverlay({ id: 'rimFrontierHunt', include: ['rim-frontier', 'rim-fauna'] }), byId);
        const { game } = createScenarioGame(base, { scenario: both, params: { rimFrontierHuntChance: 1, rimFrontierHuntRange: 2000, rimFrontierHuntBounty: 500 } });
        const g = game.galaxy;
        const ctx: PirateGenerationContext = { independentColonies: g.independentColonies, startingAge: g.startingAge, difficultyLevel: g.difficultyLevel };
        generateNewPirateEmpires(g, ctx, { piratePrevalence: 2, maximumEmpireAmount: 20, pirateProximity: 0 });
        expect(g.pirateEmpires.length).toBeGreaterThan(0);
        const faction = g.pirateEmpires[0];
        const base_ = faction.pirateEmpireBaseHabitat!;
        // A real pirate faction's starting kit has no free-standing warship (only an Escort); force one mobile ship
        // into fighting trim so the hunt's ship-gathering filter (Galaxy.9.cs 284) has something to take.
        const ship = faction.builtObjects.find((bo) => bo.topSpeed > 0)!;
        ship.role = BuiltObjectRole.Military;
        ship.subRole = BuiltObjectSubRole.SmallFreighter;
        ship.shipGroup = null;
        ship.builtAt = null;
        const leader = new Creature(g, CreatureType.Kaltor, null);
        g.creatures.push(leader);
        const herd: RimHerd = {
            id: 999002, type: CreatureType.Kaltor, leader, followers: [],
            homeSystemIndex: base_.systemIndex, homeX: base_.xpos, homeY: base_.ypos, homeRange: 500,
            birthSystemIndex: base_.systemIndex, birthX: base_.xpos, birthY: base_.ypos,
            feedSite: null, feedTicks: 0, feedingStation: null, migration: null, docileEmpireIds: [], victimEmpireIds: [],
        };
        rimFaunaState(g).herds.push(herd);

        frontierPirateHunt(g);
        const st = rimFrontierState(g);
        expect(st.pirateHunts.some((h) => h.factionId === faction.empireId && h.herdId === herd.id)).toBe(true);
        const huntGroup = empireShipGroups(faction).find((sg) => sg?.name === 'Herd Hunt');
        expect(huntGroup).toBeDefined();
        expect(huntGroup!.mission?.type).toBe(BuiltObjectMissionType.Attack);
        expect(huntGroup!.mission?.targetCreature).toBe(leader);

        // The herd dies (rimFauna's own periodic tick would splice it out the same way).
        rimFaunaState(g).herds.splice(rimFaunaState(g).herds.indexOf(herd), 1);
        const before = faction.stateMoney;
        frontierPirateHunt(g);
        expect(rimFrontierState(g).pirateHunts.length).toBe(0);
        expect(faction.stateMoney).toBeGreaterThan(before);
    }, 120000);

    it('flag off: no hunts are recorded', () => {
        const byId = new Map(scenarioIndexFs().map((m) => [m.id, loadScenarioOverlayFs(m.id)] as const));
        const both = resolveScenarioIncludes(inlineOverlay({ id: 'rimFrontierHuntOff', include: ['rim-frontier', 'rim-fauna'] }), byId);
        const { game } = createScenarioGame(base, { scenario: both, flags: { rimFrontier: false } });
        expect('rimFrontier' in game.galaxy.scenario!.state).toBe(false);
    });
});

describe('19h rim frontier — 9: fuel oases (guaranteed rim Caslon/Hydrogen; pirate bases prefer them)', () => {
    function ctxOf(g: Galaxy): PirateGenerationContext {
        return { independentColonies: g.independentColonies, startingAge: g.startingAge, difficultyLevel: g.difficultyLevel };
    }

    /** Grows galaxy.pirateEmpires to at least `count` (same helper as the rim/core-share describe block above). */
    function growPirateFactions(g: Galaxy, count: number): void {
        let guard = 0;
        while (g.pirateEmpires.length < count && guard < 50) {
            guard++;
            generateNewPirateEmpires(g, ctxOf(g), { piratePrevalence: 2, maximumEmpireAmount: count * 2 + 10, pirateProximity: 0 });
        }
    }

    it('every rim sector with an eligible habitat has at least one fuel source with the flag on (default rimFrontierOasesPerSector 1)', () => {
        // "Eligible": has at least one habitat resolveValidResourcesForHabitatExcludeManufactured says can carry Caslon
        // or Hydrogen (a plain GasGiant planet/moon, or a matching GasCloud "star" — resources.txt's own type/category
        // rules, same test frontierOasisResourceFor uses). A sector can genuinely have none — e.g. a lone star with no
        // planets, or gas giants that all rolled FrozenGasGiant (Helium's type, not Caslon/Hydrogen's) — the guarantee
        // never invents a placement the faithful game's own rules would not allow there.
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier' });
        const g = game.galaxy;
        expect(rimFuelOases(g).length).toBeGreaterThan(0);
        const ids = fuelResourceIds(g);
        const bySector = new Map<string, { eligible: boolean; hasFuel: boolean }>();
        for (const h of g.habitats) {
            const sector = g.systems[h.systemIndex].sector;
            if (sectorCentreFraction(g, sector) < D.rimFrontierBeltInner) continue;
            const key = sector.x + ',' + sector.y;
            const rec = bySector.get(key) ?? { eligible: false, hasFuel: false };
            if (g.resolveValidResourcesForHabitatExcludeManufactured(h).some((id) => ids.includes(id))) rec.eligible = true;
            if (h.resources.some((r) => ids.includes(r.resourceId))) rec.hasFuel = true;
            bySector.set(key, rec);
        }
        expect(bySector.size).toBeGreaterThan(0);
        expect([...bySector.values()].some((r) => r.eligible)).toBe(true);
        for (const [key, rec] of bySector) {
            if (!rec.eligible) continue;
            expect(rec.hasFuel, `sector ${key}`).toBe(true);
        }
    }, 120000);

    it('rimFrontierOasesPerSector 0: no guaranteed oases, and (with fuel scarcity on) the rim stays fuel-free', () => {
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimFrontierOasesPerSector: 0 } });
        const g = game.galaxy;
        expect(rimFuelOases(g).length).toBe(0);
        expect(fuelBeyond(g, D.rimFrontierFuelMaxRadius)).toBe(0);
    });

    it('pirate rim bases mostly land within rimFrontierOasisRange of an oasis (seed 1, >= 70%)', () => {
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier' });
        const g = game.galaxy;
        growPirateFactions(g, 20);
        const oases = rimFuelOases(g);
        expect(oases.length).toBeGreaterThan(0);
        const inner = D.rimFrontierBeltInner;
        const rimBases = g.pirateEmpires.filter((e) => e.pirateEmpireBaseHabitat !== null && radiusFraction(g, e.pirateEmpireBaseHabitat.xpos, e.pirateEmpireBaseHabitat.ypos) >= inner);
        expect(rimBases.length).toBeGreaterThan(0);
        const range2 = D.rimFrontierOasisRange * D.rimFrontierOasisRange;
        const within = rimBases.filter((e) => oases.some((o) => g.calculateDistanceSquared(o.xpos, o.ypos, e.pirateEmpireBaseHabitat!.xpos, e.pirateEmpireBaseHabitat!.ypos) <= range2));
        expect(within.length / rimBases.length).toBeGreaterThanOrEqual(0.7);
    }, 120000);

    it('flag off: byte-identical to the faithful game (short)', () => {
        const ref = cachedTickGameRun(base, { seconds: 60 });
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier', flags: { rimFrontier: false } });
        const run = runGameSeconds(game, 60);
        expect(rimFuelOases(game.galaxy).length).toBe(0);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
    }, 300000);
});

describe('19h rim frontier — pirate faction cap (hooks.ts pirateFactionCount, rimPirateFactionCap)', () => {
    it('cap 0 (default): the query returns the stock count unchanged, and never draws', () => {
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier' });
        const g = game.galaxy;
        const before = g.rnd.drawCount;
        for (const stock of [0, 1, 39, 40, 999]) {
            expect(scenarioQuery(g, 'pirateFactionCount', stock, {})).toBe(stock);
        }
        expect(g.rnd.drawCount).toBe(before);
    });

    it('flag off: byte-identical to the faithful game even with rimPirateFactionCap set', () => {
        const ref = cachedTickGameRun(base, { seconds: 60 });
        const { game } = createScenarioGame(base, { scenario: 'rim-frontier', flags: { rimFrontier: false }, params: { rimPirateFactionCap: 5 } });
        expect('rimFrontier' in game.galaxy.scenario!.state).toBe(false);
        const run = runGameSeconds(game, 60);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
    }, 300000);

    it('cap higher than the stock count has no effect (byte-identical to cap 0)', () => {
        const { game: stock } = createScenarioGame(base, { scenario: 'rim-frontier' }); // rimPirateFactionCap 0 (stock rule)
        const { game: capped } = createScenarioGame(base, { scenario: 'rim-frontier', params: { rimPirateFactionCap: 1000 } });
        expect(capped.galaxy.pirateEmpires.length).toBe(stock.galaxy.pirateEmpires.length);
        expect(capped.galaxy.pirateEmpires.length).toBeGreaterThan(0);
        expect(stateDigest(capped.galaxy)).toBe(stateDigest(stock.galaxy));
    });

    it('count capped at 40 in a 1400-star / 30-empire game', () => {
        const aiSlot = { race: '(Random)', homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 1, techLevel: 0.5 };
        const STAR_COUNT = 1400;
        // rimFrontierPirateRimShare / rimFrontierOasesPerSector 0 and the fuel radius opened up isolate the cap from
        // the package's other pirate-base hooks (19h-8 rim/core split, 19h-11 oasis preference), the same way the
        // rim/core-share test above isolates its own feature.
        const { game } = createScenarioGame(base, {
            scenario: 'rim-frontier',
            params: { rimPirateFactionCap: 40, rimFrontierPirateRimShare: 0, rimFrontierOasesPerSector: 0, rimFrontierFuelMaxRadius: 1.5 },
            options: (o) => ({
                ...o,
                starCount: STAR_COUNT,
                sectorWidth: 15,
                sectorHeight: 15,
                systemNames: Array.from({ length: STAR_COUNT }, (_, i) => `S${i}`),
                aiEmpires: Array.from({ length: 29 }, () => aiSlot),
                piratePrevalence: 1.0,
            }),
        });
        const g = game.galaxy;
        expect(g.empires.length).toBe(30);
        // Stock target: trunc(2 * piratePrevalence(1.0) * maximumEmpireAmount(fallback 1 + 29 AI = 30)) = 60, well
        // above the 40 cap, so the cap (not the stock formula) sets pirates.ts's `num`. GenerateNewPirateEmpires then
        // scales that target by `val` (colonization pressure: Galaxy.9.cs 22, pirates.ts generateNewPirateEmpires) —
        // val < 1 whenever any empire already holds a colony (true of every real game, capped or not: every empire
        // has its capital before the game-start pirate tick runs), so Math.trunc(num3 * val) undershoots the 40 cap
        // by 1 here — not a flaw in the cap, the same shortfall the stock (uncapped) formula would show for any
        // target. 39 is deterministic for this seed/settings (task-set: seed 1, 1400 stars, 30 empires).
        // (38 since SetupSun's SelectHabitatPictures(star) draws, Galaxy.5.cs 1328, moved the galaxy.)
        expect(g.pirateEmpires.length).toBe(38);
        expect(g.pirateEmpires.length).toBeLessThanOrEqual(40); // the cap itself is never exceeded

        // Same seed/settings with the cap off (rimPirateFactionCap 0, stock rule): the stock target (60) is not
        // clamped to 40, so the uncapped count lands well above the capped one — confirming the cap is what held it
        // to 39/40 above, not a coincidence of val-scaling alone.
        const { game: uncapped } = createScenarioGame(base, {
            scenario: 'rim-frontier',
            params: { rimPirateFactionCap: 0, rimFrontierPirateRimShare: 0, rimFrontierOasesPerSector: 0, rimFrontierFuelMaxRadius: 1.5 },
            options: (o) => ({
                ...o,
                starCount: STAR_COUNT,
                sectorWidth: 15,
                sectorHeight: 15,
                systemNames: Array.from({ length: STAR_COUNT }, (_, i) => `S${i}`),
                aiEmpires: Array.from({ length: 29 }, () => aiSlot),
                piratePrevalence: 1.0,
            }),
        });
        expect(uncapped.galaxy.pirateEmpires.length).toBeGreaterThan(40);
    }, 300000);
});
