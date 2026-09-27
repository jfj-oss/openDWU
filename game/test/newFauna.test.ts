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
import { rimFaunaHerdTick } from '../src/sim/scenario/rimFauna/rimFauna';
import { herderColonies, rimHerdersState } from '../src/sim/scenario/rimHerders/common';
import {
    FaunaVariant,
    GRAZER_LATCH_DIST,
    creatureTamedByHerders,
    faunaVariantDef,
    faunaVariantName,
    faunaVariantOfCreature,
    faunaVariantTable,
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
    scavengerTick,
    spawnVariantHerd,
    stormDrifterTick,
} from '../src/sim/scenario/newFauna/newFauna';

let base: GameData;
let shared: Game;
const PARAMS = { rimFaunaDensityRim: 1.5, rimFaunaDensityInner: 0.5, rimFaunaMaxHerds: 60, newFaunaDensity: 1.5, newFaunaMaxGroups: 300, rimFaunaMigrationDay: 359 };

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
        for (const h of herds) {
            const s = g.systems[h.birthSystemIndex].systemStar;
            const f = radiusFraction(g, s.xpos, s.ypos);
            perBand[band(f)]++;
            expect(f).toBeGreaterThanOrEqual(faunaVariantDef(st.herds[h.id].variant).minRadius);
        }
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

    it('3 hull grazer: latches onto a station and drains its hull through full shields (Creature.cs DamageTarget)', () => {
        const g = shared.galaxy;
        const station = shipOf(g, (b) => b.role === BuiltObjectRole.Base && b.components.items.length > 4);
        const herd = spawnVariantHerd(g, FaunaVariant.HullGrazer, station.nearestSystemStar?.systemIndex ?? rimSystem(g), 1, { x: station.xpos + 5000, y: station.ypos })!;
        const inf = info(g, herd);
        hullGrazerTick(g, herd, inf);
        expect(inf.latched).toBe(station);
        expect(herd.leader!.anchorPoint).toEqual({ x: Math.trunc(station.xpos), y: Math.trunc(station.ypos) });
        place(herd.leader!, station.xpos + GRAZER_LATCH_DIST / 2, station.ypos);
        station.currentShields = station.shieldsCapacity;
        const damaged = (): number => station.components.items.filter((c) => c.status === ComponentStatus.Damaged).length;
        const before = damaged();
        for (let i = 0; i < 4; i++) hullGrazerTick(g, herd, inf);
        expect(damaged()).toBeGreaterThan(before);
        expect(newFaunaState(g).stats.hullDrained).toBe(12);
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: herd.leader!, target: station })).toBe(true);
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
        let sys = -1;
        for (let i = 0; i < g.systems.length && sys < 0; i++) if (g.systemHabitatsOf(i).some((h) => h.category === HabitatCategoryType.Planet && h.empire === null)) sys = i;
        const planet = g.systemHabitatsOf(sys).find((h) => h.category === HabitatCategoryType.Planet && h.empire === null)!;
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
