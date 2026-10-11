// Scenario 19g-7b "new fauna" (tasks/19-mod-layer-scenarios.md §19g-7b): the variant table, rim-weighted spawning,
// each variant's behaviour in a forced short run (handlers driven directly), herder taming / living freighters, flags
// off = no package code (same run as the overlay without the flag), save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, inlineOverlay, loadScenarioOverlayFs, scenarioGameData, scenarioIndexFs } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Creature } from '../src/sim/creature';
import { CreatureType } from '../src/sim/creature';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { GalaxyLocation, GalaxyLocationShape, GalaxyLocationType } from '../src/sim/galaxyLocation';
import { HabitatCategoryType } from '../src/sim/types';
import { radiusFraction, scenarioEmit, scenarioQuery } from '../src/sim/scenario';
import type { ScenarioOverlay } from '../src/sim/scenario';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { herdMembers, rimFaunaState, type RimHerd } from '../src/sim/scenario/rimFauna/common';
import { rimFaunaHerdTick, rimFaunaYear } from '../src/sim/scenario/rimFauna/rimFauna';
import { herderColonies, rimHerdersState } from '../src/sim/scenario/rimHerders/common';
import {
    FaunaVariant,
    GRAZER_HULL_OFFSET,
    GRAZER_LATCH_DIST,
    creatureTamedByHerders,
    faunaVariantDef,
    faunaVariantName,
    faunaVariantOfCreature,
    faunaVariantTable,
    newFaunaParam,
    newFaunaState,
} from '../src/sim/scenario/newFauna/common';
import {
    broodCarrierTick,
    hullGrazerTick,
    hunterPackTick,
    lanternShoalTick,
    nestMotherTick,
    newFaunaOnBuiltObjectRemoved,
    newFaunaTick,
    newFaunaYear,
    scavengerTick,
    spawnVariantHerd,
    stormDrifterTick,
} from '../src/sim/scenario/newFauna/newFauna';

let base: GameData;
let shared: Game;
const PARAMS = { rimFaunaDensityRim: 1.5, rimFaunaDensityInner: 0.5, rimFaunaMaxHerds: 60, newFaunaDensity: 1.5, newFaunaMaxGroups: 300, rimFaunaMigrationDay: 359, newFaunaWhaleDensity: 0.1, newFaunaWhaleMaxGroups: 100 };

beforeAll(async () => {
    base = await loadGameDataFs();
    shared = createScenarioGame(base, { scenario: 'new-fauna', params: PARAMS }).game;
}, 600000);

function variantHerds(g: Galaxy, v: FaunaVariant): RimHerd[] {
    const st = newFaunaState(g);
    return rimFaunaState(g).herds.filter((h) => st.herds[h.id]?.variant === v);
}

function info(g: Galaxy, herd: RimHerd) {
    return newFaunaState(g).herds[herd.id];
}

/** A rim system with no empire colony. */
function rimSystem(g: Galaxy): number {
    for (let i = 0; i < g.systems.length; i++) {
        const s = g.systems[i].systemStar;
        if (radiusFraction(g, s.xpos, s.ypos) < 0.8) continue;
        if (g.systemHabitatsOf(i).some((h) => h.empire !== null)) continue;
        return i;
    }
    throw new Error('no rim system');
}

function place(c: { xpos: number; ypos: number }, x: number, y: number): void {
    c.xpos = x;
    c.ypos = y;
}

function shipOf(g: Galaxy, pred: (b: BuiltObject) => boolean): BuiltObject {
    const b = g.builtObjects.find((x): x is BuiltObject => x != null && !x.hasBeenDestroyed && x.empire !== null && pred(x));
    if (b === undefined) throw new Error('no such ship');
    return b;
}

describe('19g-7b new fauna — variant table and spawning', () => {
    it('eight variants over the ported creature types, each with a look and herd shape', () => {
        const t = faunaVariantTable();
        expect(t.map((d) => d.variant)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(t.map((d) => d.name)).toEqual(['Void Whale', 'Hunter Pack', 'Hull Grazer', 'Storm Drifter', 'Lantern Shoal', 'Nest Mother', 'Scavenger', 'Brood Carrier']);
        expect(new Set(t.map((d) => d.look)).size).toBe(8);
        for (const d of t) {
            expect([CreatureType.Kaltor, CreatureType.RockSpaceSlug, CreatureType.DesertSpaceSlug, CreatureType.Ardilus]).toContain(d.baseType);
            expect(d.groupMin).toBeLessThanOrEqual(d.groupMax);
            expect(d.sizeMin).toBeLessThanOrEqual(d.sizeMax);
        }
        const hunter = faunaVariantDef(FaunaVariant.HunterPack);
        expect([hunter.groupMin, hunter.groupMax]).toEqual([4, 6]);
        expect(faunaVariantDef(FaunaVariant.VoidWhale).sizeMin).toBeGreaterThan(faunaVariantDef(FaunaVariant.HunterPack).sizeMax * 10);
        expect(scenarioIndexFs().find((m) => m.id === 'new-fauna')?.include).toEqual(['rim-fauna']);
    });

    it('spawn density rises with the radius (the 19g-7 density curve); variants respect their inner radius', () => {
        const g = shared.galaxy;
        const st = newFaunaState(g);
        const herds = rimFaunaState(g).herds.filter((h) => st.herds[h.id] !== undefined);
        expect(herds.length).toBeGreaterThan(20);
        const perBand = [0, 0, 0];
        const systemsPerBand = [0, 0, 0];
        const band = (f: number): number => (f < 0.5 ? 0 : f < 0.75 ? 1 : 2);
        g.systems.forEach((s, i) => {
            if (g.systemHabitatsOf(i).some((h) => h.empire !== null && h.empire !== g.independentEmpire)) return;
            systemsPerBand[band(radiusFraction(g, s.systemStar.xpos, s.systemStar.ypos))]++;
        });
        // Void whales are placed galaxy-wide at one flat density (newFaunaWhaleDensity), the others on the rim curve.
        const whalesPerBand = [0, 0, 0];
        for (const h of herds) {
            const s = g.systems[h.birthSystemIndex].systemStar;
            const f = radiusFraction(g, s.xpos, s.ypos);
            if (st.herds[h.id].variant === FaunaVariant.VoidWhale) {
                whalesPerBand[band(f)]++;
                continue;
            }
            perBand[band(f)]++;
            expect(f).toBeGreaterThanOrEqual(faunaVariantDef(st.herds[h.id].variant).minRadius);
        }
        console.log(`[newFauna] void whale groups by radius band <0.5 / 0.5-0.75 / >=0.75: ${whalesPerBand.join(' / ')}`);
        expect(faunaVariantDef(FaunaVariant.VoidWhale).minRadius).toBe(0);
        expect(whalesPerBand[0]).toBeGreaterThan(0);
        const density = perBand.map((n, i) => n / Math.max(1, systemsPerBand[i]));
        console.log(`[newFauna] groups per free system by radius band <0.5 / 0.5-0.75 / >=0.75: ${density.map((d) => d.toFixed(2)).join(' / ')}; by variant ${st.stats.spawned.slice(1).join(',')}`);
        expect(density[0]).toBe(0);
        expect(density[2]).toBeGreaterThan(density[1]);
        expect(new Set(herds.map((h) => st.herds[h.id].variant)).size).toBeGreaterThanOrEqual(6);
        // Names / lookups.
        const whale = variantHerds(g, FaunaVariant.VoidWhale)[0];
        expect(faunaVariantName(g, whale.leader!)).toBe('Void Whale');
        expect(whale.leader!.name.startsWith('Void Whale of ')).toBe(true);
    });
});

describe('19g-7b new fauna — behaviours (forced short runs)', () => {
    it('1 void whale: grazes with the 19g-7 herd tick, spares stations, never starts a fight, big kill haul', () => {
        const g = shared.galaxy;
        const herd = spawnVariantHerd(g, FaunaVariant.VoidWhale, rimSystem(g), 2)!;
        expect(herd.leader!.size).toBeGreaterThanOrEqual(1000);
        rimFaunaHerdTick(g);
        expect(herd.feedSite).not.toBeNull();
        place(herd.leader!, herd.feedSite!.xpos, herd.feedSite!.ypos);
        const before = newFaunaState(g).stats.grazeTicks;
        rimFaunaHerdTick(g);
        newFaunaTick(g);
        expect(herd.feedTicks).toBeGreaterThan(0);
        expect(newFaunaState(g).stats.grazeTicks).toBeGreaterThan(before);
        const warship = shipOf(g, (b) => b.role === BuiltObjectRole.Military);
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: herd.leader!, target: warship })).toBe(true);
        // Kill haul into the killer's hold.
        const hauler = shipOf(g, (b) => b.cargo !== null);
        const fluid = g.resourceSystem.resources.find((r) => r != null && r.name === 'Zentabia Fluid')!.resourceId;
        const had = hauler.cargo!.items.filter((c) => c.commodity.resourceId === fluid).reduce((a, c) => a + c.amount, 0);
        scenarioEmit(g, 'creatureKilled', { creature: herd.followers[0], killer: hauler, empire: hauler.empire });
        const has = hauler.cargo!.items.filter((c) => c.commodity.resourceId === fluid).reduce((a, c) => a + c.amount, 0);
        expect(has - had).toBe(40);
    });

    it('2 hunter pack: stalks a freighter, flees a warship', () => {
        const g = shared.galaxy;
        const sys = rimSystem(g);
        const pack = spawnVariantHerd(g, FaunaVariant.HunterPack, sys)!;
        const members = herdMembers(pack);
        expect(members.length).toBeGreaterThanOrEqual(4);
        expect(members.length).toBeLessThanOrEqual(6);
        const freighter = shipOf(g, (b) => b.role === BuiltObjectRole.Freight);
        const warship = shipOf(g, (b) => b.role === BuiltObjectRole.Military);
        const lx = pack.leader!.xpos;
        const ly = pack.leader!.ypos;
        const [fx, fy] = [freighter.xpos, freighter.ypos];
        const [wx, wy] = [warship.xpos, warship.ypos];
        place(freighter, lx + 5000, ly);
        place(warship, lx + 1e7, ly);
        hunterPackTick(g, pack, info(g, pack));
        for (const c of members) expect(c.currentTarget).toBe(freighter);
        expect(freighter.pursuers!.filter((p) => members.includes(p as Creature)).length).toBe(members.length);
        // Only freighters are prey for the ported target scan.
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: pack.leader!, target: warship })).toBe(true);
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: pack.leader!, target: freighter })).toBe(false);
        // A warship closes in: the pack drops the prey and runs away from it.
        place(warship, lx - 8000, ly);
        hunterPackTick(g, pack, info(g, pack));
        expect(info(g, pack).fleeing).toBe(true);
        for (const c of members) {
            expect(c.currentTarget).toBeNull();
            expect(c.anchorPoint!.x).toBeGreaterThan(lx + 30000);
        }
        expect(freighter.pursuers!.some((p) => members.includes(p as Creature))).toBe(false);
        place(freighter, fx, fy);
        place(warship, wx, wy);
    });

    it('3 hull grazer: a parasite — latches onto a ship or station, rides it, drains hull and fuel, spreads, and is scraped off', () => {
        const g = shared.galaxy;
        const station = shipOf(g, (b) => b.role === BuiltObjectRole.Base && b.components.items.length > 4);
        const sys = station.nearestSystemStar?.systemIndex ?? rimSystem(g);
        // Only the station in range: it latches there.
        g.scenario!.params.newFaunaGrazerRange = 6000;
        const herd = spawnVariantHerd(g, FaunaVariant.HullGrazer, sys, 1, { x: station.xpos + 5000, y: station.ypos })!;
        const inf = info(g, herd);
        hullGrazerTick(g, herd, inf);
        expect(inf.latched).toBeNull(); // still approaching (latches within GRAZER_LATCH_DIST)
        expect(herd.leader!.anchorPoint).not.toBeNull();
        place(herd.leader!, herd.leader!.anchorPoint!.x + GRAZER_LATCH_DIST / 2, herd.leader!.anchorPoint!.y);
        hullGrazerTick(g, herd, inf);
        expect(inf.latched).not.toBeNull();
        const host = inf.latched!;
        host.dockedAt = null; // a docked host is scraped clean (checked below)
        // On the hull: within the host's own weapon range, and it rides along (creatureAttachedHost).
        const at = scenarioQuery(g, 'creatureAttachedHost', null, { creature: herd.leader! })!;
        expect(Math.hypot(at.x - host.xpos, at.y - host.ypos)).toBeLessThanOrEqual(GRAZER_HULL_OFFSET + 1);
        expect(GRAZER_HULL_OFFSET).toBeLessThan(190);
        // Feeding: the hull through full shields, day by day.
        host.currentShields = host.shieldsCapacity;
        const damaged = (): number => host.components.items.filter((c) => c.status === ComponentStatus.Damaged).length;
        const before = damaged();
        const drained = newFaunaState(g).stats.hullDrained;
        for (let i = 0; i < 4; i++) hullGrazerTick(g, herd, inf);
        expect(damaged()).toBeGreaterThan(before);
        expect(newFaunaState(g).stats.hullDrained - drained).toBe(4 * 10);
        // Harmless only means it never starts a fight: the host's empire does not spare it.
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: herd.leader!, target: host })).toBe(true);
        expect(scenarioQuery(g, 'builtObjectSparesCreature', false, { builtObject: host, creature: herd.leader! })).toBe(false);
        // Multiplying: another ship close to the host gets its own grazer (chance 1 here), once per pair.
        const other = shipOf(g, (b) => b !== host && b.role !== BuiltObjectRole.Base && b.topSpeed > 0 && b.empire === host.empire);
        place(other, host.xpos + 500, host.ypos);
        g.scenario!.params.newFaunaGrazerSpreadChance = 1;
        g.scenario!.params.newFaunaGrazerSystemCap = 1000; // the dense test galaxy is above the stock caps
        g.scenario!.params.newFaunaGrazerMaxCount = 1000;
        inf.nextAt = 0;
        const births = newFaunaState(g).stats.grazerBirths ?? 0;
        inf.spreadTried = []; // the feeding ticks above (same day) already tried the neighbours at 20%
        hullGrazerTick(g, herd, inf);
        expect(newFaunaState(g).stats.grazerBirths).toBe(births + 1);
        // The child is the newest grazer herd, latched on one of the host's neighbours.
        const child = variantHerds(g, FaunaVariant.HullGrazer).reduce((a, h) => (h.id > a.id ? h : a));
        const nb = info(g, child).latched!;
        expect(nb).not.toBeNull();
        expect(nb).not.toBe(host);
        expect(Math.hypot(nb.xpos - host.xpos, nb.ypos - host.ypos)).toBeLessThanOrEqual(2000);
        expect(child.leader!.size).toBe(faunaVariantDef(FaunaVariant.HullGrazer).sizeMin);
        hullGrazerTick(g, herd, inf); // cooldown: no second child
        expect(newFaunaState(g).stats.grazerBirths).toBe(births + 1);
        // Fuel siphon on a ship host; docking at a port scrapes it off.
        const cinf = info(g, child);
        nb.dockedAt = null;
        nb.currentFuel = nb.fuelCapacity;
        hullGrazerTick(g, child, cinf);
        if (nb.fuelCapacity > 0) expect(nb.currentFuel).toBeLessThan(nb.fuelCapacity);
        nb.dockedAt = station;
        const scraped = newFaunaState(g).stats.grazersScraped ?? 0;
        hullGrazerTick(g, child, cinf);
        expect(newFaunaState(g).stats.grazersScraped).toBe(scraped + 1);
        expect(cinf.latched).toBeNull();
        nb.dockedAt = null;
        g.scenario!.params.newFaunaGrazerSpreadChance = 0.2;
        delete g.scenario!.params.newFaunaGrazerRange;
    });

    it('4 storm drifter: blinds sensors and misfires jumps inside its cloud (19h queries)', () => {
        const g = shared.galaxy;
        const herd = spawnVariantHerd(g, FaunaVariant.StormDrifter, rimSystem(g), 1)!;
        const d = herd.leader!;
        stormDrifterTick(g, herd, info(g, herd));
        expect(info(g, herd).target).not.toBeNull();
        expect(scenarioQuery(g, 'scanRangeModifier', 1, { x: d.xpos + 1000, y: d.ypos })).toBeCloseTo(0.1, 6);
        expect(scenarioQuery(g, 'scanRangeModifier', 1, { x: d.xpos + 200000, y: d.ypos })).toBe(1);
        const ship = shipOf(g, (b) => b.role === BuiltObjectRole.Freight);
        const stop = scenarioQuery(g, 'hyperjumpStop', null, { ship, fromX: d.xpos - 100000, fromY: d.ypos, toX: d.xpos + 100000, toY: d.ypos, exitX: d.xpos + 500000, exitY: d.ypos });
        expect(stop).not.toBeNull();
        expect(Math.hypot(stop!.x - d.xpos, stop!.y - d.ypos)).toBeLessThan(30000);
        // Deterministic (no Rnd), and a jump that starts inside the cloud is not stopped again.
        expect(scenarioQuery(g, 'hyperjumpStop', null, { ship, fromX: d.xpos - 100000, fromY: d.ypos, toX: d.xpos + 100000, toY: d.ypos, exitX: d.xpos + 500000, exitY: d.ypos })).toEqual(stop);
        expect(scenarioQuery(g, 'hyperjumpStop', null, { ship, fromX: stop!.x, fromY: stop!.y, toX: d.xpos + 100000, toY: d.ypos, exitX: d.xpos + 500000, exitY: d.ypos })).toBeNull();
        d.hasBeenDestroyed = true; // out of the other tests' way
    });

    it('5 lantern shoal: drifts into a gravity shoal; a civilian jump passing it ends there', () => {
        const g = shared.galaxy;
        const herd = spawnVariantHerd(g, FaunaVariant.LanternShoal, rimSystem(g), 1)!;
        const lantern = herd.leader!;
        const r = 20000;
        const shoal = new GalaxyLocation('Test Shoal', GalaxyLocationType.NebulaCloud, lantern.xpos + 90000 - r, lantern.ypos - r, r * 2, r * 2, 0);
        shoal.shape = GalaxyLocationShape.Circular;
        const saved = g.scenario!.state['rimFrontier'];
        g.scenario!.state['rimFrontier'] = { shoals: [shoal], addedStorms: [] };
        lanternShoalTick(g, herd, info(g, herd));
        expect(lantern.anchorPoint).toEqual({ x: Math.trunc(lantern.xpos + 90000), y: Math.trunc(lantern.ypos) });
        const cx = lantern.anchorPoint!.x;
        const cy = lantern.anchorPoint!.y;
        let t = g.currentTimeSeconds;
        const d0 = Math.hypot(lantern.xpos - cx, lantern.ypos - cy);
        for (let i = 0; i < 400 && Math.hypot(lantern.xpos - cx, lantern.ypos - cy) > r; i++) {
            t += 1;
            lantern.doTasks(t);
        }
        const d1 = Math.hypot(lantern.xpos - cx, lantern.ypos - cy);
        console.log(`[newFauna] lantern shoal drift: ${Math.round(d0)} → ${Math.round(d1)} from the shoal centre (radius ${r})`);
        expect(d1).toBeLessThan(r);
        const civ = shipOf(g, (b) => b.role === BuiltObjectRole.Freight);
        const stop = scenarioQuery(g, 'hyperjumpStop', null, { ship: civ, fromX: lantern.xpos - 60000, fromY: lantern.ypos + 10000, toX: lantern.xpos + 60000, toY: lantern.ypos + 10000, exitX: lantern.xpos + 900000, exitY: lantern.ypos + 10000 });
        expect(stop).not.toBeNull();
        expect(Math.hypot(stop!.x - cx, stop!.y - cy)).toBeLessThan(r + 40000);
        const war = shipOf(g, (b) => b.role === BuiltObjectRole.Military);
        expect(scenarioQuery(g, 'hyperjumpStop', null, { ship: war, fromX: lantern.xpos - 60000, fromY: lantern.ypos + 10000, toX: lantern.xpos + 60000, toY: lantern.ypos + 10000, exitX: lantern.xpos + 900000, exitY: lantern.ypos + 10000 })).toBeNull();
        lantern.hasBeenDestroyed = true;
        if (saved === undefined) delete g.scenario!.state['rimFrontier'];
        else g.scenario!.state['rimFrontier'] = saved;
    });

    it('6 nest mother: stationary on her site, spawns young up to the cap', () => {
        const g = shared.galaxy;
        const herd = spawnVariantHerd(g, FaunaVariant.NestMother, rimSystem(g), 1)!;
        const inf = info(g, herd);
        const mother = herd.leader!;
        expect(mother.size).toBeGreaterThanOrEqual(1600);
        for (let i = 0; i < 8; i++) {
            inf.nextAt = 0;
            nestMotherTick(g, herd, inf);
        }
        expect(herd.followers.length).toBe(6);
        for (const y of herd.followers) {
            expect(faunaVariantName(g, y)).toBe('Nest Young');
            expect(y.size).toBeLessThanOrEqual(50);
        }
        expect(mother.anchorPoint).toEqual(inf.target);
        expect(mother.attackRange).toBe(15000);
        expect(mother.movementSpeed).toBe(4);
    });

    it('7 scavenger: eats wreck debris (a destroyed ship) and drops the salvage when killed', () => {
        const g = shared.galaxy;
        const herd = spawnVariantHerd(g, FaunaVariant.Scavenger, rimSystem(g), 1)!;
        const sc = herd.leader!;
        const st = newFaunaState(g);
        const wreck = { xpos: sc.xpos + 1000, ypos: sc.ypos, size: 400, hasBeenDestroyed: true, cargo: null } as unknown as BuiltObject;
        newFaunaOnBuiltObjectRemoved(g, { builtObject: wreck });
        const site = st.wrecks[st.wrecks.length - 1];
        expect(site.salvage[0].amount).toBe(40);
        scavengerTick(g, herd, info(g, herd));
        expect(info(g, herd).salvage[0].amount).toBe(20);
        scavengerTick(g, herd, info(g, herd));
        expect(info(g, herd).salvage[0].amount).toBe(40);
        expect(st.wrecks.includes(site)).toBe(false);
        const killer = shipOf(g, (b) => b.cargo !== null);
        const steel = g.resourceSystem.resources.find((r) => r != null && r.name === 'Steel')!.resourceId;
        const had = killer.cargo!.items.filter((c) => c.commodity.resourceId === steel).reduce((a, c) => a + c.amount, 0);
        scenarioEmit(g, 'creatureKilled', { creature: sc, killer, empire: killer.empire });
        const has = killer.cargo!.items.filter((c) => c.commodity.resourceId === steel).reduce((a, c) => a + c.amount, 0);
        expect(has - had).toBe(40);
    });

    it('8 brood carrier: travels and seeds a hunter pack at a planet it passes', () => {
        const g = shared.galaxy;
        // A system with an unowned planet that has another system within newFaunaBroodRange (where the carrier looks for its
        // next destination): picked by property, the galaxy layout decides which.
        const range = newFaunaParam(g, 'newFaunaBroodRange');
        const free = (i: number) => g.systemHabitatsOf(i).find((h) => h.category === HabitatCategoryType.Planet && h.empire === null);
        const neighbour = (i: number, h: { xpos: number; ypos: number; diameter: number }) => g.systems.some((s, j) => j !== i && g.calculateDistance(s.systemStar.xpos, s.systemStar.ypos, h.xpos + h.diameter + 3000, h.ypos) < range - 1000);
        let sys = -1;
        for (let i = 0; i < g.systems.length && sys < 0; i++) {
            const h = free(i);
            if (h !== undefined && neighbour(i, h)) sys = i;
        }
        expect(sys).toBeGreaterThanOrEqual(0);
        const planet = free(sys)!;
        const herd = spawnVariantHerd(g, FaunaVariant.BroodCarrier, sys, 1, { x: planet.xpos + planet.diameter + 3000, y: planet.ypos })!;
        const inf = info(g, herd);
        g.scenario!.params.newFaunaBroodMaxPacks = 10000;
        const packs = variantHerds(g, FaunaVariant.HunterPack).length;
        broodCarrierTick(g, herd, inf);
        expect(inf.target).not.toBeNull();
        expect(inf.destSystem).not.toBe(sys);
        expect(herd.leader!.hyperSpeed).toBe(8000);
        expect(newFaunaState(g).stats.seeded).toBe(1);
        const all = variantHerds(g, FaunaVariant.HunterPack);
        expect(all.length).toBe(packs + 1);
        const pack = all[all.length - 1];
        expect(Math.hypot(pack.leader!.xpos - planet.xpos, pack.leader!.ypos - planet.ypos)).toBeLessThan(planet.diameter + 3000);
        // Cooldown: no second pack right away.
        broodCarrierTick(g, herd, inf);
        expect(newFaunaState(g).stats.seeded).toBe(1);
    });
});

describe('19g-7b new fauna — travellers: void whale seasons, nest mother escape', () => {
    it('wild void whales migrate galaxy-wide each season at their slow hyper speed', () => {
        const g = shared.galaxy;
        const st = newFaunaState(g);
        const fs = rimFaunaState(g);
        const wild = variantHerds(g, FaunaVariant.VoidWhale).filter((h) => info(g, h).tamedBy < 0 && h.migration === null && h.docileEmpireIds.length === 0);
        expect(wild.length).toBeGreaterThan(0);
        g.scenario!.params.newFaunaWhaleMigrationChance = 1;
        fs.lastMigrationYear = (st.whaleSeasonYear ?? fs.lastMigrationYear) + 1;
        newFaunaTick(g);
        const moving = wild.filter((h) => h.migration !== null);
        expect(moving.length).toBe(wild.length);
        for (const h of moving) for (const c of herdMembers(h)) expect(c.hyperSpeed).toBe(faunaVariantDef(FaunaVariant.VoidWhale).hyperSpeed);
        expect(st.stats.whaleMigrations).toBeGreaterThanOrEqual(wild.length);
        delete g.scenario!.params.newFaunaWhaleMigrationChance;
    });

    it('a badly wounded nest mother flees to a remote rim system and nests there', () => {
        const g = shared.galaxy;
        const st = newFaunaState(g);
        const herd = spawnVariantHerd(g, FaunaVariant.NestMother, rimSystem(g))!;
        const inf = info(g, herd);
        const mother = herd.leader!;
        nestMotherTick(g, herd, inf);
        expect(inf.destSystem).toBe(-1);
        mother.damage = mother.damageKillThreshold * 0.8;
        nestMotherTick(g, herd, inf);
        expect(inf.destSystem).toBeGreaterThanOrEqual(0);
        expect(st.stats.nestEscapes).toBeGreaterThanOrEqual(1);
        expect(mother.hyperSpeed).toBeGreaterThan(0);
        const to = inf.destSystem;
        expect(radiusFraction(g, g.systems[to].systemStar.xpos, g.systems[to].systemStar.ypos)).toBeGreaterThanOrEqual(0.7);
        // Arrival: the new system is her home.
        place(mother, inf.target!.x, inf.target!.y);
        mother.currentSpeed = 0;
        nestMotherTick(g, herd, inf);
        expect(inf.destSystem).toBe(-1);
        expect(herd.homeSystemIndex).toBe(to);
        expect(mother.hyperSpeed).toBe(0);
    });
});

describe('19g-7b new fauna — population recovery', () => {
    it('each species breeds its own young (never a Kaltor calf); a variant below its start count repopulates', () => {
        const g = shared.galaxy;
        const st = newFaunaState(g);
        expect(st.startGroups).toBeDefined();
        g.scenario!.params.newFaunaBreedHunter = 1;
        g.scenario!.params.newFaunaBreedWhale = 1;
        g.scenario!.params.newFaunaRepopChance = 1;
        const packs = variantHerds(g, FaunaVariant.HunterPack).filter((h) => h.leader !== null && h.migration === null && herdMembers(h).length < faunaVariantDef(FaunaVariant.HunterPack).groupMax);
        expect(packs.length).toBeGreaterThan(0);
        const pack = packs[0];
        const n = herdMembers(pack).length;
        // The rim-fauna year leaves variant herds alone (ownsHerd): no Kaltor calf.
        rimFaunaYear(g);
        expect(herdMembers(pack).length).toBe(n);
        newFaunaYear(g);
        expect(herdMembers(pack).length).toBe(n + 1);
        const pup = pack.followers[pack.followers.length - 1];
        const def = faunaVariantDef(FaunaVariant.HunterPack);
        expect(pup.type).toBe(def.baseType);
        expect(pup.size).toBe(def.sizeMin);
        expect(info(g, pack).members).toContain(pup.creatureId);
        expect(pup.movementSpeed).toBe(def.followerSpeed);
        // Repopulation: wipe every wild lantern shoal; the next year brings one back.
        for (const h of variantHerds(g, FaunaVariant.LanternShoal)) if (info(g, h).tamedBy < 0) for (const c of herdMembers(h)) c.completeTeardown();
        rimFaunaHerdTick(g);
        newFaunaTick(g);
        const before = variantHerds(g, FaunaVariant.LanternShoal).filter((h) => h.leader !== null).length;
        newFaunaYear(g);
        expect(variantHerds(g, FaunaVariant.LanternShoal).filter((h) => h.leader !== null).length).toBe(before + 1);
        for (const k of ['newFaunaBreedHunter', 'newFaunaBreedWhale', 'newFaunaRepopChance']) delete g.scenario!.params[k];
    });
});

describe('19g-7b new fauna — herders tame whales and hunter packs', () => {
    it('herder colonies start with tamed whales / packs (docile, in the colony herd list), living freighters, feral drop', () => {
        const both = inlineOverlay({ id: 'new-fauna-herders', include: ['new-fauna', 'rim-herders'] });
        const byId = new Map(scenarioIndexFs().map((m) => [m.id, loadScenarioOverlayFs(m.id)] as const));
        const overlay: ScenarioOverlay = { ...both, includes: [byId.get('new-fauna')!, byId.get('rim-herders')!] };
        const g = createScenarioGame(base, { scenario: overlay, params: { rimHerdersShare: 1 } }).game.galaxy;
        const hcs = herderColonies(g);
        expect(hcs.length).toBeGreaterThan(0);
        const hc = hcs[0];
        const owner = hc.colony.empire!;
        const tamed = rimFaunaState(g).herds.filter((h) => newFaunaState(g).herds[h.id]?.tamedBy === owner.empireId && hc.herdIds.includes(h.id));
        expect(tamed.map((h) => newFaunaState(g).herds[h.id].variant).sort()).toEqual([FaunaVariant.VoidWhale, FaunaVariant.HunterPack]);
        for (const h of tamed) {
            expect(h.docileEmpireIds).toContain(owner.empireId);
            expect(hc.herdIds).toContain(h.id);
            expect(creatureTamedByHerders(g, h.leader!)).toBe(true);
        }
        // Living freighters: a tamed herder freighter walks with a tamed whale.
        const rs = rimHerdersState(g);
        if (rs.tamed.length === 0) {
            const ship = g.independentEmpire!.privateBuiltObjects.find((b) => b.role === BuiltObjectRole.Freight)!;
            rs.tamed.push(ship);
            rs.rev++;
        }
        newFaunaTick(g);
        const cv = newFaunaState(g).caravans;
        expect(cv.length).toBeGreaterThan(0);
        expect(faunaVariantOfCreature(g, cv[0].creature)?.variant).toBe(FaunaVariant.VoidWhale);
        expect(cv[0].creature.anchorPoint!.x).toBe(Math.trunc(cv[0].ship.xpos + 600));
        // Feral: the docile flags cleared (19j conquest) — no longer tamed.
        for (const h of tamed) h.docileEmpireIds.length = 0;
        expect(creatureTamedByHerders(g, tamed[0].leader!)).toBe(false);
        // Without the new-fauna flag the tamed look is off.
        g.scenario!.flags.newFauna = false;
        for (const h of tamed) h.docileEmpireIds.push(owner.empireId);
        expect(creatureTamedByHerders(g, tamed[0].leader!)).toBe(false);
    }, 600000);
});

/** The variant herd table without its graph references (latched stations). */
function herdsJson(h: Record<number, { latched: BuiltObject | null }>): string {
    return JSON.stringify(Object.entries(h).map(([k, v]) => [k, { ...v, latched: v.latched?.builtObjectID ?? null }]));
}

function saveText(game: Game): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'new-fauna', flags: { newFauna: true, rimFauna: true }, params: PARAMS } });
}

describe('19g-7b new fauna — faithful path, save', () => {
    it('flag off: no package code runs (the same run as the overlay without the flag)', () => {
        const withFlag = createScenarioGame(base, { scenario: 'new-fauna', flags: { newFauna: false } }).game;
        const full = loadScenarioOverlayFs('new-fauna');
        const noFlag: ScenarioOverlay = { ...full, manifest: { ...full.manifest, flags: full.manifest.flags.filter((f) => f.name !== 'newFauna') } };
        const ref = createScenarioGame(base, { scenario: noFlag }).game;
        runGameSeconds(withFlag.galaxy, 60);
        runGameSeconds(ref.galaxy, 60);
        expect('newFauna' in withFlag.galaxy.scenario!.state).toBe(false);
        expect(stateDigest(withFlag.galaxy)).toBe(stateDigest(ref.galaxy));
        expect(stateCounts(withFlag.galaxy)).toEqual(stateCounts(ref.galaxy));
        expect(withFlag.galaxy.rnd.drawCount).toBe(ref.galaxy.rnd.drawCount);
    }, 600000);

    it('a save with variant herds (wrecks, salvage, young) resumes identically', () => {
        const a = createScenarioGame(base, { scenario: 'new-fauna', params: PARAMS }).game;
        runGameSeconds(a.galaxy, 20);
        const st = newFaunaState(a.galaxy);
        const nest = spawnVariantHerd(a.galaxy, FaunaVariant.NestMother, rimSystem(a.galaxy), 1)!;
        st.herds[nest.id].nextAt = 0;
        nestMotherTick(a.galaxy, nest, st.herds[nest.id]);
        st.wrecks.push({ x: 1, y: 2, salvage: [{ resourceId: 10, amount: 7 }], date: 0 });
        const text = saveText(a);
        const loaded = deserializeGame(text, scenarioGameData(base, 'new-fauna')).game;
        const lst = newFaunaState(loaded.galaxy);
        expect(herdsJson(lst.herds)).toBe(herdsJson(st.herds));
        expect(lst.wrecks).toEqual(st.wrecks);
        const lnest = rimFaunaState(loaded.galaxy).herds.find((h) => h.id === nest.id)!;
        expect(lnest.followers.length).toBe(1);
        expect(faunaVariantName(loaded.galaxy, lnest.followers[0])).toBe('Nest Young');
        runGameSeconds(a.galaxy, 120);
        runGameSeconds(loaded.galaxy, 120);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(a.galaxy));
        const summary = (g: Galaxy): string => JSON.stringify([newFaunaState(g).stats, herdsJson(newFaunaState(g).herds), rimFaunaState(g).herds.map((h) => [h.id, herdMembers(h).map((c) => [c.size, Math.round(c.xpos)])])]);
        expect(summary(loaded.galaxy)).toBe(summary(a.galaxy));
    }, 600000);
});
