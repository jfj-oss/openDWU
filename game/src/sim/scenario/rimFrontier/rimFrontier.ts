// Scenario package 19h "rim frontier geography" (tasks/19-mod-layer-scenarios.md §19h): hook registrations, all behind
// the `rimFrontier` flag. Not a port; each hook sits beside the ported code it extends:
//   1 storm belt      after Galaxy.4.cs GenerateNebulae (GalaxyNebulaeGenerator.cs): LightningDamage NebulaCloud
//                     locations on a radius curve — the stock storm rules (CheckInStorm, ApplyLocationEffects, the
//                     survive-storms checks, SetupSun's star-type re-roll) then apply unchanged.
//   2 sparser rim     Galaxy.5.cs SetupSun position loop: candidates past the thinning radius are rejected (re-rolled).
//   3 gravity shoals  NebulaCloud locations with no stock effect; a hyperjump step that enters one ends at its edge
//                     (BuiltObject.2.cs HyperTo in-flight step, cmdMovement.ts) — the BaconBuiltObject.cs 2493
//                     IsOutsideStarGravityWell rule ("no hyperspace inside the well") applied to fixed deep-space points.
//   4 fuel scarcity   resourcePlacement rules for Caslon / Hydrogen (Galaxy.selectResources' scenario filter).
//   5 sensor fog      Empire.9.cs FindShipOutsideSystemWithScanRange: the ship-sensor range toward rim targets.
//   6 map scale       createGame's generation options: sector counts × extent (SectorSize stays 2,000,000), star count.
//   7 keep starts in  the ported home-system search (game.ts player loop / Start.cs method_51 findAiCapital): a stock-
//                     accepted candidate past the belt inner radius is rejected (the C#'s own loop re-rolls). The
//                     Concord (rimTrade's Oranthi, its own homePlacement rule) is exempt.
//   8 pirate share    pirates.ts generateNewPirateEmpires (Galaxy.9.cs): new pirate factions are split rim / core by
//                     creation order (galaxy.pirateEmpires.length), a fixed share of the total.
//   9 herd avoidance  a base-placement candidate (pirate or independent) inside a rim herd's home range (+ a buffer)
//                     is rejected — reads rimFauna's state (peekRimFaunaState), never rimFauna's own draws.
//  10 pirate hunting  not a port (DW:U pirates never hunt fauna): a yearly check per pirate faction sends idle warships
//                     (the Galaxy.9.cs 284 DoSuperPirateTasks ship-gathering filter) to Attack a nearby herd's leader;
//                     a hunt that killed its herd by the next check pays the faction a credits bounty
//                     (treasury.ts performPrivateTransaction — DW:U has no creature-resource commodity to drop).
//  11 fuel oases     (tasks §19h item 9) after the faithful resource placement, guarantee `rimFrontierOasesPerSector`
//                     Caslon/Hydrogen sources per rim sector among its habitats (Galaxy.selectResources' own fields,
//                     resolveValidResourcesForHabitatExcludeManufactured's type/category test) — fuel scarcity (item 4)
//                     can otherwise leave the rim with none; pirate rim bases then prefer a candidate near one (below).
// Rnd: generation draws only from a package-owned Random seeded from the galaxy seed (never galaxy.rnd); a rejected star
// position makes the stock SetupSun loop draw its re-roll from galaxy.rnd, so flag-on games re-pin (flag off: no hook
// runs). The runtime hooks (placement queries) never draw; the yearly pirate-hunting handler does (galaxy.rnd, gated).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { GalaxyLocation, GalaxyLocationEffectType, GalaxyLocationShape, GalaxyLocationType } from '../../galaxyLocation';
import { HabitatType, type Habitat } from '../../types';
import { Random } from '../../random';
import { radiusFraction, registerScenarioGeneration, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import type { GalaxyScenario } from '../state';
import type { ScenarioGenerationSetup } from '../hooks';
import { RIM_RACE } from '../rimTrade/common';
import { creatureAlive, herdMembers, peekRimFaunaState, type RimHerd } from '../rimFauna/common';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { ShipGroup, empireShipGroups, shipGroupAssignMission } from '../../fleets/shipGroup';
import { addShipsToShipGroup } from '../../fleets/shipGroupTasks';
import { FleetPosture } from '../../diplomacyTick';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../missions/mission';
import { performPrivateTransaction } from '../../treasury';
import { galaxyStarDate } from '../../tick/simTime';
import { YEAR_LENGTH } from '../../galaxyTime';
import {
    RIM_FRONTIER_DEFAULTS,
    RIM_FRONTIER_FLAG,
    RIM_FRONTIER_FUELS,
    SHOAL_DIAMETER_FRACTION,
    SHOAL_MAX_RADIUS,
    SHOAL_MIN_RADIUS,
    frontierParam,
    rimFogMultiplier,
    rimFrontierState,
    rimFuelOases,
    shoalStopOnPath,
    type RimFrontierParam,
} from './common';

/** The package's generation Random per galaxy (generation-only: not saved, never used after createGame). */
const generationRnd = new WeakMap<Galaxy, Random>();

function frontierRnd(galaxy: Galaxy): Random {
    let r = generationRnd.get(galaxy);
    if (r === undefined) {
        r = new Random(((galaxy.randomSeed ^ 0x19c0ffee) >>> 1) & 0x7fffffff);
        generationRnd.set(galaxy, r);
    }
    return r;
}

function setupParam(s: GalaxyScenario, name: RimFrontierParam): number {
    const v = s.params[name];
    return typeof v === 'number' ? v : RIM_FRONTIER_DEFAULTS[name];
}

/**
 * 19h-6 map scale + 19h-4 fuel bias: before generation. The extent and star-count params feed the base game's custom
 * galaxy size (the same CreateGameOptions fields the wizard's "Sectors: W × H" / star boxes fill): an extent past the C#
 * 15-sector clamp turns customGalaxyDimensions on (Galaxy.setCustomGalaxyDimensions, up to CUSTOM_MAX_SECTORS).
 */
function frontierSetup(s: GalaxyScenario, resources: readonly { name: string; resourceId: number }[], o: ScenarioGenerationSetup): void {
    const extent = setupParam(s, 'rimFrontierExtent');
    if (extent !== 1.0) {
        o.sectorWidth = Math.round(o.sectorWidth * extent);
        o.sectorHeight = Math.round(o.sectorHeight * extent);
        if (o.sectorWidth > 15 || o.sectorHeight > 15) o.customGalaxyDimensions = true;
    }
    const stars = Math.trunc(setupParam(s, 'rimFrontierStarCount'));
    if (stars > 0) o.starCount = stars;
    const fuelMax = setupParam(s, 'rimFrontierFuelMaxRadius');
    if (fuelMax < 1.5) {
        for (const name of RIM_FRONTIER_FUELS) {
            const res = resources.find((r) => r.name === name);
            if (res === undefined || s.resourceRules.some((r) => r.resourceId === res.resourceId)) continue;
            s.resourceRules.push({ resourceId: res.resourceId, minRadius: 0, maxRadius: fuelMax });
        }
    }
}

const STORM_WORDS = ['Storm', 'Tempest', 'Typhoon', 'Squall', 'Turmoil', 'Maelstrom']; // GalaxyNebulaeGenerator GenerateCloudName

function cloudPictureRef(galaxy: Galaxy, rnd: Random): number {
    const clouds = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.NebulaCloud);
    return clouds.length > 0 ? clouds[rnd.next(0, clouds.length)].pictureRef : 0;
}

/** A system-name prefix borrowed from a stock cloud ("<system name> <word>", GalaxyNebulaeGenerator GenerateCloudName). */
function systemName(galaxy: Galaxy, rnd: Random): string {
    const locs = galaxy.galaxyLocations;
    if (locs.length === 0) return 'Rim';
    const name = locs[rnd.next(0, locs.length)].name;
    const i = name.lastIndexOf(' ');
    return i > 0 ? name.substring(0, i) : name;
}

function addLocation(galaxy: Galaxy, loc: GalaxyLocation): void {
    galaxy.galaxyLocations.push(loc);
    galaxy.addGalaxyLocationIndex(loc);
}

/** A point at radius fraction f and a random angle (the randomPointInRing scale: sizeX / 2). */
function ringPoint(galaxy: Galaxy, rnd: Random, fMin: number, fMax: number): { x: number; y: number } {
    const cx = galaxy.sizeX / 2.0;
    const cy = galaxy.sizeY / 2.0;
    const f = fMin + rnd.nextDouble() * (fMax - fMin);
    const a = rnd.nextDouble() * Math.PI * 2.0;
    return { x: cx + Math.cos(a) * f * cx, y: cy + Math.sin(a) * f * cx };
}

function insideGalaxy(galaxy: Galaxy, x: number, y: number, w: number): boolean {
    return x >= 0 && y >= 0 && x + w <= galaxy.sizeX && y + w <= galaxy.sizeY;
}

/** 19h-1 storm belt + 19h-3 shoals: after the faithful nebulae, before star placement (stars avoid clouds 14 in 15). */
function frontierAfterNebulae(galaxy: Galaxy): void {
    const rnd = frontierRnd(galaxy);
    const st = rimFrontierState(galaxy);
    const inner = frontierParam(galaxy, 'rimFrontierBeltInner');
    const density = frontierParam(galaxy, 'rimFrontierStormDensity');
    if (density > 0) {
        // Stock plain clouds in the belt turn into ion storms with probability `density`.
        for (const loc of galaxy.galaxyLocations) {
            if (loc.type !== GalaxyLocationType.NebulaCloud || loc.effect !== GalaxyLocationEffectType.MovementSlowed) continue;
            const c = loc.resolveLocationCenter();
            if (radiusFraction(galaxy, c.x, c.y) < inner) continue;
            if (rnd.nextDouble() >= density) continue;
            loc.effect = GalaxyLocationEffectType.LightningDamage;
            const i = loc.name.lastIndexOf(' ');
            loc.name = (i > 0 ? loc.name.substring(0, i) : loc.name) + ' ' + STORM_WORDS[rnd.next(0, STORM_WORDS.length)];
        }
        // Plus new storm clouds in the belt (3 per sector column at density 1), sized like scattered clouds.
        const count = Math.round(density * 3 * galaxy.sectorWidth);
        const minSize = Math.trunc(galaxy.sizeX / 35);
        const maxSize = Math.trunc(galaxy.sizeX / 15);
        for (let i = 0, tries = 0; i < count && tries < count * 10; tries++) {
            const p = ringPoint(galaxy, rnd, inner, 0.98);
            const size = rnd.next(minSize, maxSize);
            const x = p.x - Math.trunc(size / 2);
            const y = p.y - Math.trunc(size / 2);
            if (!insideGalaxy(galaxy, x, y, size)) continue;
            const loc = new GalaxyLocation(systemName(galaxy, rnd) + ' ' + STORM_WORDS[rnd.next(0, STORM_WORDS.length)], GalaxyLocationType.NebulaCloud, x, y, size, size, cloudPictureRef(galaxy, rnd));
            loc.showName = true;
            loc.effect = GalaxyLocationEffectType.LightningDamage;
            addLocation(galaxy, loc);
            st.addedStorms.push(loc);
            i++;
        }
    }
    const shoals = Math.trunc(frontierParam(galaxy, 'rimFrontierShoalCount'));
    const diameter = Math.trunc(galaxy.sizeX * SHOAL_DIAMETER_FRACTION);
    for (let i = 0, tries = 0; i < shoals && tries < shoals * 20; tries++) {
        const p = ringPoint(galaxy, rnd, SHOAL_MIN_RADIUS, SHOAL_MAX_RADIUS);
        const x = p.x - diameter / 2;
        const y = p.y - diameter / 2;
        if (!insideGalaxy(galaxy, x, y, diameter)) continue;
        if (st.shoals.some((s) => Math.hypot(s.xpos - x, s.ypos - y) < diameter * 3)) continue;
        const loc = new GalaxyLocation(systemName(galaxy, rnd) + ' Shoal', GalaxyLocationType.NebulaCloud, x, y, diameter, diameter, cloudPictureRef(galaxy, rnd));
        loc.showName = true;
        loc.effect = GalaxyLocationEffectType.None;
        loc.shape = GalaxyLocationShape.Circular;
        addLocation(galaxy, loc);
        st.shoals.push(loc);
        i++;
    }
}

/** 19h-2 sparser rim: SetupSun candidates past the thinning radius survive with probability 1 − factor. */
function frontierAcceptStar(galaxy: Galaxy, x: number, y: number): boolean {
    const factor = frontierParam(galaxy, 'rimFrontierThinFactor');
    if (factor <= 0 || radiusFraction(galaxy, x, y) < frontierParam(galaxy, 'rimFrontierThinRadius')) return true;
    return frontierRnd(galaxy).nextDouble() >= factor;
}

// 19h-11 fuel oases: the resource the mod layer adds at a candidate habitat — gas giants (Habitat.type GasGiant) get
// Caslon (resources.txt id 18: distribution 0/7 GasGiant, matching Galaxy.4.cs CheckPrevalenceValidForHabitat); other
// habitats able to carry either fuel (resources.txt distributions: Hydrogen id 8 also has 2/10 Ammonia and 2/15
// Hydrogen GasCloud entries; Caslon also has 2/16 NitrogenOxygen and 2/17 Oxygen) get Hydrogen, falling back to Caslon.
// resolveValidResourcesForHabitatExcludeManufactured (galaxy.ts, port of ResourceDefinitionList.cs) is the same
// type/category test SelectResources itself uses, so this never picks a habitat the faithful roll could not have.
function frontierOasisResourceFor(galaxy: Galaxy, habitat: Habitat, caslonId: number, hydrogenId: number): number | null {
    const valid = galaxy.resolveValidResourcesForHabitatExcludeManufactured(habitat);
    if (habitat.type === HabitatType.GasGiant && valid.includes(caslonId)) return caslonId;
    if (valid.includes(hydrogenId)) return hydrogenId;
    if (valid.includes(caslonId)) return caslonId;
    return null;
}

/** Picks up to `n` distinct items from `list` with `rnd` (Fisher-Yates-style draw, ResourceSystem.cs GenerateRandomOrderedResources's pattern reused for a scenario draw). */
function pickDistinct<T>(rnd: Random, list: readonly T[], n: number): T[] {
    const pool = list.slice();
    const out: T[] = [];
    while (out.length < n && pool.length > 0) {
        const i = rnd.next(0, pool.length);
        out.push(pool[i]);
        pool.splice(i, 1);
    }
    return out;
}

/**
 * 19h-11 fuel oases: after the faithful resource placement (createGame, right after generateGalaxy — see hooks.ts
 * afterGeneration), guarantee `rimFrontierOasesPerSector` Caslon/Hydrogen sources per rim sector (sector centre
 * radiusFraction ≥ belt inner) among that sector's habitats — skipping a sector that already has one (from the
 * faithful roll, e.g. `rimFrontierFuelMaxRadius` off or wide). Draws only from the package's own Random.
 */
function frontierFuelOases(galaxy: Galaxy): void {
    const perSector = Math.trunc(frontierParam(galaxy, 'rimFrontierOasesPerSector'));
    if (perSector <= 0) return;
    const caslon = galaxy.resources.find((r) => r.name === 'Caslon');
    const hydrogen = galaxy.resources.find((r) => r.name === 'Hydrogen');
    if (caslon === undefined || hydrogen === undefined) return;
    const inner = frontierParam(galaxy, 'rimFrontierBeltInner');
    const rnd = frontierRnd(galaxy);
    const st = rimFrontierState(galaxy);
    // Group habitats by their system's sector (Galaxy.4.cs 2335-2347 Systems build already stored it).
    const sectors = new Map<string, Habitat[]>();
    for (const sys of galaxy.systems) {
        const { x: sx, y: sy } = sys.sector;
        const cx = (sx + 0.5) * galaxy.sectorSize;
        const cy = (sy + 0.5) * galaxy.sectorSize;
        if (radiusFraction(galaxy, cx, cy) < inner) continue;
        const key = sx + ',' + sy;
        let list = sectors.get(key);
        if (list === undefined) {
            list = [];
            sectors.set(key, list);
        }
        list.push(...sys.habitats);
    }
    for (const habitats of sectors.values()) {
        if (habitats.some((h) => h.resources.some((r) => r.resourceId === caslon.resourceId || r.resourceId === hydrogen.resourceId))) continue;
        const candidates = habitats
            .map((h) => ({ h, resourceId: frontierOasisResourceFor(galaxy, h, caslon.resourceId, hydrogen.resourceId) }))
            .filter((c): c is { h: Habitat; resourceId: number } => c.resourceId !== null);
        for (const { h, resourceId } of pickDistinct(rnd, candidates, perSector)) {
            const range = galaxy.resolveResourceAbundanceRangeForHabitat(h, resourceId);
            if (range === null) continue;
            h.resources.push({ resourceId, abundance: rnd.next(range.min, range.max) });
            st.fuelOases.push(h);
        }
    }
}

registerScenarioGeneration({
    id: 'rimFrontier.generation',
    flag: RIM_FRONTIER_FLAG,
    setup: frontierSetup,
    afterNebulae: frontierAfterNebulae,
    acceptStarPosition: frontierAcceptStar,
    afterGeneration: frontierFuelOases,
});

registerScenarioQuery({ id: 'rimFrontier.fog', flag: RIM_FRONTIER_FLAG, query: 'scanRangeModifier', run: (galaxy, value, a) => value * rimFogMultiplier(galaxy, a.x, a.y) });

registerScenarioQuery({
    id: 'rimFrontier.shoals',
    flag: RIM_FRONTIER_FLAG,
    query: 'hyperjumpStop',
    run: (galaxy, value, a) => {
        if (value !== null || galaxy.scenario === null || !('rimFrontier' in galaxy.scenario.state)) return value;
        const shoals = rimFrontierState(galaxy).shoals;
        return shoals.length === 0 ? null : shoalStopOnPath(shoals, a.fromX, a.fromY, a.toX, a.toY, a.exitX, a.exitY);
    },
});

// 19h-7: keep ordinary player/AI starts out of the rim (game.ts player-capital loop and Start.cs method_51
// findAiCapital, via hooks.ts's acceptHomeHabitat). The Concord (rimTrade's Oranthi) keeps its own homePlacement ring
// regardless — it never reaches this hook when rimTrade is stacked (scenarioFindHomeHabitat picks it first), and this
// handler exempts it by name so a lone rim-frontier game (Oranthi drawn as an ordinary race) still leaves it alone.
registerScenarioQuery({
    id: 'rimFrontier.homeHabitat',
    flag: RIM_FRONTIER_FLAG,
    query: 'acceptHomeHabitat',
    run: (galaxy, value, a) => {
        if (!value) return value;
        if (frontierParam(galaxy, 'rimFrontierKeepStartsOut') <= 0) return value;
        if (a.race.name === RIM_RACE) return value;
        return radiusFraction(galaxy, a.habitat.xpos, a.habitat.ypos) < frontierParam(galaxy, 'rimFrontierBeltInner');
    },
});

// 19h-8: split new pirate factions rim / core by their creation order (pirates.ts generateNewPirateEmpires, via
// hooks.ts's acceptPirateBase). No extra state: galaxy.pirateEmpires.length (before this one) and how many of the
// existing ones sit past the belt already fully determine the next slot's target, so the split stays exact
// (round(n × share)) across any number of calls, including after a save/load.
function frontierPirateBaseTargetsRim(galaxy: Galaxy): boolean {
    const inner = frontierParam(galaxy, 'rimFrontierBeltInner');
    const rimCount = galaxy.pirateEmpires.reduce((n, e) => (e.pirateEmpireBaseHabitat !== null && radiusFraction(galaxy, e.pirateEmpireBaseHabitat.xpos, e.pirateEmpireBaseHabitat.ypos) >= inner ? n + 1 : n), 0);
    const n = galaxy.pirateEmpires.length + 1;
    return rimCount < Math.round(n * frontierParam(galaxy, 'rimFrontierPirateRimShare'));
}
registerScenarioQuery({
    id: 'rimFrontier.pirateBase',
    flag: RIM_FRONTIER_FLAG,
    query: 'acceptPirateBase',
    run: (galaxy, value, a) => {
        if (!value || frontierParam(galaxy, 'rimFrontierPirateRimShare') <= 0) return value;
        const inner = frontierParam(galaxy, 'rimFrontierBeltInner');
        const f = radiusFraction(galaxy, a.habitat.xpos, a.habitat.ypos);
        const wantsRim = frontierPirateBaseTargetsRim(galaxy);
        if (wantsRim !== (f >= inner)) return false;
        if (!wantsRim) return true;
        // 19h-11: among rim-side candidates, prefer one within rimFrontierOasisRange of a guaranteed fuel oasis (a
        // contestable chokepoint) — a rejection here is the same "stock-accepted, share-rejected" fallback path
        // pirates.ts's own loop already keeps (no draw-order change), so a galaxy with no oasis nearby (or oases off)
        // still places a rim base at the first share-satisfying candidate.
        const oases = rimFuelOases(galaxy);
        if (oases.length === 0) return true;
        const r2 = frontierParam(galaxy, 'rimFrontierOasisRange') ** 2;
        return oases.some((o) => galaxy.calculateDistanceSquared(o.xpos, o.ypos, a.habitat.xpos, a.habitat.ypos) <= r2);
    },
});

// Pirate faction cap: an explicit ceiling on the game-start pirate-faction count (pirates.ts generateNewPirateEmpires,
// via hooks.ts's pirateFactionCount), independent of 19h-8's rim/core split. min(stock, cap) when the cap is set (> 0);
// stock unchanged at 0 (or with the flag off, since the handler then never runs) — no extra Rnd draws either way.
registerScenarioQuery({
    id: 'rimFrontier.pirateFactionCap',
    flag: RIM_FRONTIER_FLAG,
    query: 'pirateFactionCount',
    run: (galaxy, value) => {
        const cap = frontierParam(galaxy, 'rimPirateFactionCap');
        return cap > 0 ? Math.min(value, cap) : value;
    },
});

// 19h-9: base placement (pirate or independent) rejects a candidate inside a rim herd's home range + a buffer. Reads
// rimFauna's state through the read-only peek accessor (safe with no rimFauna in this game, or rimFauna not yet run).
registerScenarioQuery({
    id: 'rimFrontier.herdAvoid',
    flag: RIM_FRONTIER_FLAG,
    query: 'placementAvoidsHerds',
    run: (galaxy, value, a) => {
        if (value) return value;
        const fauna = peekRimFaunaState(galaxy);
        if (fauna === null) return value;
        const buffer = frontierParam(galaxy, 'rimFrontierNestAvoidRadius');
        for (const herd of fauna.herds) {
            if (herdMembers(herd).length === 0) continue;
            const r = herd.homeRange + buffer;
            if (galaxy.calculateDistanceSquared(a.x, a.y, herd.homeX, herd.homeY) <= r * r) return true;
        }
        return value;
    },
});

// 19h-10: pirate hunting — not a port. A yearly check per pirate faction: resolve last year's hunt (pay a bounty if
// its herd is gone), then maybe start a new one against the nearest live herd within range.
function frontierResolveHunt(galaxy: Galaxy, faction: Empire, fauna: ReturnType<typeof peekRimFaunaState>): void {
    const st = rimFrontierState(galaxy);
    const i = st.pirateHunts.findIndex((h) => h.factionId === faction.empireId);
    if (i < 0) return;
    const hunt = st.pirateHunts[i];
    const stillAlive = fauna !== null && fauna.herds.some((h) => h.id === hunt.herdId);
    if (!stillAlive) {
        st.pirateHunts.splice(i, 1);
        performPrivateTransaction(faction, hunt.size * frontierParam(galaxy, 'rimFrontierHuntBounty'));
    } else if (galaxyStarDate(galaxy) - hunt.startedAt > YEAR_LENGTH * 2) {
        st.pirateHunts.splice(i, 1); // abandoned: no bounty
    }
}

/** Galaxy.9.cs 284 DoSuperPirateTasks's ship-gathering filter (idle, undamaged, non-escort warships), reused here to
 *  form a one-off hunting party rather than the Phantom Fleet. */
function frontierAssignHunt(galaxy: Galaxy, faction: Empire, herd: RimHerd): void {
    if (herd.leader === null || !creatureAlive(galaxy, herd.leader)) return;
    const idle = faction.builtObjects.filter(
        (bo) => bo.role === BuiltObjectRole.Military && bo.builtAt === null && bo.shipGroup === null && bo.topSpeed > 0 && bo.damagedComponentCount === 0 && bo.subRole !== BuiltObjectSubRole.Escort,
    );
    if (idle.length === 0) return;
    const base = faction.pirateEmpireBaseHabitat;
    const shipGroup = new ShipGroup(galaxy);
    shipGroup.empire = faction;
    shipGroup.shipTargetAmount = idle.length;
    shipGroup.troopTargetStrength = 0;
    shipGroup.gatherPoint = base;
    addShipsToShipGroup(galaxy, faction, shipGroup, idle, idle.length, true, base);
    if (shipGroup.ships.length === 0) return;
    shipGroup.name = 'Herd Hunt';
    empireShipGroups(faction).push(shipGroup);
    shipGroup.posture = FleetPosture.Attack;
    shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Attack, herd.leader, null, BuiltObjectMissionPriority.High, false);
    rimFrontierState(galaxy).pirateHunts.push({ factionId: faction.empireId, herdId: herd.id, size: herdMembers(herd).length, startedAt: galaxyStarDate(galaxy) });
}

/** The yearly pirate-hunting check (`rimFrontier.pirateHunt`). Exported for tests. */
export function frontierPirateHunt(galaxy: Galaxy): void {
    const fauna = peekRimFaunaState(galaxy);
    const huntRange = frontierParam(galaxy, 'rimFrontierHuntRange');
    const huntChance = frontierParam(galaxy, 'rimFrontierHuntChance');
    for (const faction of galaxy.pirateEmpires) {
        frontierResolveHunt(galaxy, faction, fauna);
        if (huntChance <= 0 || fauna === null || fauna.herds.length === 0) continue;
        const base = faction.pirateEmpireBaseHabitat;
        if (base === null || rimFrontierState(galaxy).pirateHunts.some((h) => h.factionId === faction.empireId)) continue;
        let target: RimHerd | null = null;
        let bestD = huntRange * huntRange;
        for (const herd of fauna.herds) {
            if (herd.leader === null) continue;
            const d = galaxy.calculateDistanceSquared(base.xpos, base.ypos, herd.homeX, herd.homeY);
            if (d <= bestD) {
                bestD = d;
                target = herd;
            }
        }
        if (target === null || galaxy.rnd.nextDouble() >= huntChance) continue;
        frontierAssignHunt(galaxy, faction, target);
    }
}
registerScenarioYearly({ id: 'rimFrontier.pirateHunt', flag: RIM_FRONTIER_FLAG, run: (galaxy) => frontierPirateHunt(galaxy) });
