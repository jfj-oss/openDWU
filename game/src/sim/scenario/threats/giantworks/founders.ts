// Giantworks: the seeding of a Great Work at game start (or from the Game Editor): the secret wonder, the three founding
// circles, the pilgrim fallback, the site and the planned dates. Not a port. No galaxy.rnd: every choice draws from the
// add-on's own Random (state.ts ownRandom / nextRandom). Nothing here changes the galaxy except a pilgrim colony (made only
// for a wedge without independents) and the wonder's own onRolled hook.

import type { Galaxy } from '../../../galaxy';
import { HabitatCategoryType, HabitatType, type Habitat, type SystemInfo } from '../../../types';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import type { Race } from '../../../data/races';
import { YEAR_LENGTH, startStarDateForAge } from '../../../galaxyTime';
import { makeHabitatIntoColonyRuntime } from '../../../missions/cmdTroops';
import { Random } from '../../../random';
import { galaxyStarDate } from '../../../tick/simTime';
import { radiusFraction } from '../../hooks';
import { greatWorkKinds } from './registry';
import { gwParam, gwState, logGw, ordinaryEmpires, ownRandom, nextRandom, type GreatWorkRecord, type GreatWorksState } from './state';
import type { GreatWorkKind } from './types';

const TWO_PI = Math.PI * 2;
const WEDGES = 3;

// ---------------------------------------------------------------------------------------------------------------
// Which wonder
// ---------------------------------------------------------------------------------------------------------------

/** Wonders that may be rolled: registered, their per-wonder flag not switched off (an undefined flag is on: a Game Editor spawn). Pure. */
export function enabledKinds(galaxy: Galaxy): GreatWorkKind[] {
    const flags = galaxy.scenario?.flags ?? {};
    return greatWorkKinds().filter((k) => flags[k.flag] !== false);
}

/** The roll weight: the kind's own, the Beacon only with enough empires and likelier in late-age starts. Pure. */
export function kindRollWeight(galaxy: Galaxy, kind: GreatWorkKind): number {
    let w = kind.weight;
    if (kind.id === 'beacon') {
        if (ordinaryEmpires(galaxy).length < gwParam(galaxy, 'giantworksBeaconMinEmpires')) return 0;
        w *= 1 + (galaxy.age * gwParam(galaxy, 'giantworksBeaconLatePct')) / 100;
    }
    return Math.max(0, w);
}

/** The weighted roll among the enabled wonders (null: none can be rolled). */
export function rollKind(galaxy: Galaxy, rnd: Random, forced: string | null = null): GreatWorkKind | null {
    const kinds = enabledKinds(galaxy);
    if (forced !== null) return kinds.find((k) => k.id === forced) ?? greatWorkKinds().find((k) => k.id === forced) ?? null;
    const weights = kinds.map((k) => kindRollWeight(galaxy, k));
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return null;
    let r = rnd.nextDouble() * total;
    for (let i = 0; i < kinds.length; i++) {
        r -= weights[i];
        if (r < 0 && weights[i] > 0) return kinds[i];
    }
    return kinds[kinds.length - 1];
}

// ---------------------------------------------------------------------------------------------------------------
// The founders
// ---------------------------------------------------------------------------------------------------------------

export function capitals(galaxy: Galaxy): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const e of galaxy.empires) if (e !== null && e.active && e.capital !== null && e.capital !== undefined) out.push({ x: e.capital.xpos, y: e.capital.ypos });
    return out;
}

function nearestCapital(galaxy: Galaxy, caps: readonly { x: number; y: number }[], x: number, y: number): number {
    let best = Number.MAX_VALUE;
    for (const c of caps) best = Math.min(best, galaxy.calculateDistance(x, y, c.x, c.y));
    return best;
}

/** True when some empire (not the independents) holds the territory at (x, y). */
export function inForeignTerritory(galaxy: Galaxy, x: number, y: number): boolean {
    const id = galaxy.checkEmpireTerritoryIdAtLocation(x, y);
    return id >= 0 && id !== (galaxy.independentEmpire?.empireId ?? -2);
}

/** Wedge index (0..2) of a point around the galaxy centre, the wedges rotated by `offset` radians. Pure. */
export function wedgeOf(galaxy: Galaxy, x: number, y: number, offset: number): number {
    let a = Math.atan2(y - galaxy.sizeY / 2, x - galaxy.sizeX / 2) - offset;
    a = ((a % TWO_PI) + TWO_PI) % TWO_PI;
    return Math.min(WEDGES - 1, Math.floor(a / (TWO_PI / WEDGES)));
}

function isIndependentWorld(galaxy: Galaxy, h: Habitat): boolean {
    return h.empire === galaxy.independentEmpire && !h.hasBeenDestroyed && h.population !== null && h.population !== undefined && h.population.totalAmount > 0;
}

/** The most numerous people of an independent world (null: none). */
function worldRace(h: Habitat): Race | null {
    return (h.population.dominantRace as Race | null) ?? null;
}

const PILGRIM_TYPES: ReadonlySet<HabitatType> = new Set([HabitatType.Continental, HabitatType.Ocean, HabitatType.MarshySwamp, HabitatType.Desert]);

/** A small independent colony ("pilgrim colony") for a wedge that has no independents: the habitable world nearest the wedge's middle. */
function makePilgrimColony(galaxy: Galaxy, wedge: number, offset: number, caps: readonly { x: number; y: number }[], capSectors: number, used: ReadonlySet<Habitat>, make: boolean): Habitat | null {
    const ind = galaxy.independentEmpire;
    if (ind === null) return null;
    const mid = offset + (wedge + 0.5) * (TWO_PI / WEDGES);
    const r = (Math.min(galaxy.sizeX, galaxy.sizeY) / 2) * 0.66;
    const tx = galaxy.sizeX / 2 + Math.cos(mid) * r;
    const ty = galaxy.sizeY / 2 + Math.sin(mid) * r;
    let best: Habitat | null = null;
    let bd = Number.MAX_VALUE;
    for (const h of galaxy.habitats) {
        if (h === null || h.empire !== null || h.hasBeenDestroyed || used.has(h) || h.category !== HabitatCategoryType.Planet || !PILGRIM_TYPES.has(h.type)) continue;
        if (h.population !== null && h.population !== undefined && h.population.items.length > 0) continue;
        if (wedgeOf(galaxy, h.xpos, h.ypos, offset) !== wedge || radiusFraction(galaxy, h.xpos, h.ypos) < 1 / 3) continue;
        if (nearestCapital(galaxy, caps, h.xpos, h.ypos) < capSectors * galaxy.sectorSize || inForeignTerritory(galaxy, h.xpos, h.ypos)) continue;
        const d = galaxy.calculateDistance(h.xpos, h.ypos, tx, ty);
        if (d < bd || (d === bd && best !== null && h.habitatIndex < best.habitatIndex)) {
            bd = d;
            best = h;
        }
    }
    if (best === null) return null;
    const race = pilgrimRace(galaxy);
    if (race === null) return null;
    if (!make) return best;
    makeHabitatIntoColonyRuntime(galaxy, ind, best, ind, race, 5_000_000);
    if (!galaxy.independentColonies.includes(best)) galaxy.independentColonies.push(best);
    return best;
}

/** The people of the biggest independent world (galaxy.independentColonies order on ties), else the first playable race. */
function pilgrimRace(galaxy: Galaxy): Race | null {
    let best: Race | null = null;
    let bp = -1;
    for (const h of galaxy.independentColonies) {
        if (!isIndependentWorld(galaxy, h)) continue;
        const r = worldRace(h);
        if (r !== null && h.population.totalAmount > bp) {
            bp = h.population.totalAmount;
            best = r;
        }
    }
    if (best !== null) return best;
    return (galaxy.races.find((r): r is Race => r !== null && r.playable) as Race | undefined) ?? null;
}

export interface FoundersPick {
    circles: Habitat[][];
    pilgrims: Habitat[];
}

/**
 * Three circles, one per wedge: the independent world with the most people in the wedge's outer two thirds, at least
 * `giantworksCapitalSectors` from every capital and outside every empire's territory, plus up to two more independents within
 * `giantworksFounderRangeSectors` of it. A wedge without such a world gets a pilgrim colony (a one-world circle). Worlds in
 * `used` (another Great Work's founders) are skipped. Draws nothing. Pure except for the pilgrim colonies it founds.
 */
export function pickFounders(galaxy: Galaxy, offset: number, used: ReadonlySet<Habitat>, capSectors: number = gwParam(galaxy, 'giantworksCapitalSectors'), make = true): FoundersPick {
    const caps = capitals(galaxy);
    const range = gwParam(galaxy, 'giantworksFounderRangeSectors') * galaxy.sectorSize;
    const eligible = (h: Habitat): boolean =>
        isIndependentWorld(galaxy, h) && !used.has(h) && nearestCapital(galaxy, caps, h.xpos, h.ypos) >= capSectors * galaxy.sectorSize && !inForeignTerritory(galaxy, h.xpos, h.ypos);
    const worlds = galaxy.independentColonies.filter(eligible);
    const circles: Habitat[][] = [];
    const pilgrims: Habitat[] = [];
    const taken = new Set<Habitat>(used);
    for (let w = 0; w < WEDGES; w++) {
        const inWedge = worlds.filter((h) => wedgeOf(galaxy, h.xpos, h.ypos, offset) === w && !taken.has(h));
        const outer = inWedge.filter((h) => radiusFraction(galaxy, h.xpos, h.ypos) >= 1 / 3);
        let main: Habitat | null = null;
        for (const h of outer) if (main === null || h.population.totalAmount > main.population.totalAmount || (h.population.totalAmount === main.population.totalAmount && h.habitatIndex < main.habitatIndex)) main = h;
        if (main === null) {
            const p = makePilgrimColony(galaxy, w, offset, caps, capSectors, taken, make);
            if (p === null) continue;
            pilgrims.push(p);
            taken.add(p);
            circles.push([p]);
            continue;
        }
        const circle: Habitat[] = [main];
        taken.add(main);
        const near = worlds
            .filter((h) => !taken.has(h) && galaxy.calculateDistance(h.xpos, h.ypos, main!.xpos, main!.ypos) <= range)
            .sort((a, b) => galaxy.calculateDistance(a.xpos, a.ypos, main!.xpos, main!.ypos) - galaxy.calculateDistance(b.xpos, b.ypos, main!.xpos, main!.ypos) || a.habitatIndex - b.habitatIndex);
        for (const h of near.slice(0, 2)) {
            circle.push(h);
            taken.add(h);
        }
        circles.push(circle);
    }
    return { circles, pilgrims };
}

// ---------------------------------------------------------------------------------------------------------------
// The site
// ---------------------------------------------------------------------------------------------------------------

/** The system indexes that hold any base (every empire and pirate faction). */
export function systemsWithBases(galaxy: Galaxy): Set<number> {
    const out = new Set<number>();
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires]) {
        if (e === null) continue;
        for (const list of [e.builtObjects, e.privateBuiltObjects]) {
            for (const b of list) if (b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Base && b.nearestSystemStar !== null) out.add(b.nearestSystemStar.systemIndex);
        }
    }
    return out;
}

const BAD_STARS: ReadonlySet<HabitatType> = new Set([HabitatType.BlackHole, HabitatType.SuperNova, HabitatType.Neutron]);

/** Why a system cannot hold a Great Work (null: it can). Pure. */
export function siteBlocked(galaxy: Galaxy, sys: SystemInfo, bases: ReadonlySet<number>, caps: readonly { x: number; y: number }[], strict: boolean): string | null {
    const star = sys.systemStar;
    if (star === null || star === undefined || star.hasBeenDestroyed || BAD_STARS.has(star.type) || star.category !== HabitatCategoryType.Star) return 'star';
    if (bases.has(star.systemIndex)) return 'base';
    if ((sys.creatures?.length ?? 0) > 0 || sys.hasRuins === true) return 'special';
    for (const h of galaxy.systemHabitatsOf(star.systemIndex)) {
        if (h.empire !== null || (h.population !== null && h.population !== undefined && h.population.totalAmount > 0)) return 'colony';
    }
    if (nearestCapital(galaxy, caps, star.xpos, star.ypos) < gwParam(galaxy, 'giantworksSiteMinCapitalSectors') * galaxy.sectorSize) return 'capital';
    if (strict && inForeignTerritory(galaxy, star.xpos, star.ypos)) return 'territory';
    return null;
}

/** The barren (else any rocky or icy) planet or moon of the system to build around, or null. Pure. */
export function siteHabitat(galaxy: Galaxy, sys: SystemInfo): Habitat | null {
    let best: Habitat | null = null;
    let bestScore = -1;
    for (const h of galaxy.systemHabitatsOf(sys.systemStar.systemIndex)) {
        if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
        if (h.type === HabitatType.GasGiant || h.type === HabitatType.FrozenGasGiant) continue;
        const score = (h.type === HabitatType.BarrenRock ? 1e9 : 0) + h.diameter;
        if (score > bestScore) {
            bestScore = score;
            best = h;
        }
    }
    return best;
}

/** The nearest star system to (x, y) with nothing in it and no empire's territory over it (territory relaxed when none qualifies). Pure. */
export function pickSite(galaxy: Galaxy, x: number, y: number): SystemInfo | null {
    const bases = systemsWithBases(galaxy);
    const caps = capitals(galaxy);
    for (const strict of [true, false]) {
        let best: SystemInfo | null = null;
        let bd = Number.MAX_VALUE;
        for (const sys of galaxy.systems) {
            if (sys === null || sys === undefined || siteBlocked(galaxy, sys, bases, caps, strict) !== null) continue;
            const d = galaxy.calculateDistance(sys.systemStar.xpos, sys.systemStar.ypos, x, y);
            if (d < bd || (d === bd && best !== null && sys.systemStar.systemIndex < best.systemStar.systemIndex)) {
                bd = d;
                best = sys;
            }
        }
        if (best !== null) return best;
    }
    return null;
}

/** The centroid of the circles' main worlds. Pure. */
export function circlesCentroid(circles: readonly (readonly Habitat[])[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const c of circles) {
        x += c[0].xpos;
        y += c[0].ypos;
    }
    return { x: x / circles.length, y: y / circles.length };
}

// ---------------------------------------------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------------------------------------------

/** The number of Great Works: the option, or 1 (2 in galaxies of more than `giantworksBigGalaxyStars` stars). Pure. */
export function greatWorkCount(galaxy: Galaxy): number {
    const n = Math.trunc(gwParam(galaxy, 'giantworksCount'));
    if (n > 0) return n;
    return galaxy.systems.length > gwParam(galaxy, 'giantworksBigGalaxyStars') ? 2 : 1;
}

function yearsToDate(galaxy: Galaxy, years: number): number {
    return startStarDateForAge(galaxy.age) + years * YEAR_LENGTH;
}

/**
 * Seeds one Great Work: the wonder (secretly), founders, site and planned dates. Returns null when nothing can be built (no
 * wonder enabled, fewer than two circles, no empty system). `forcedKind` picks the wonder (Game Editor); `rnd` is the add-on's stream.
 */
export function seedOne(galaxy: Galaxy, st: GreatWorksState, rnd: Random, index: number, forcedKind: string | null, forced: boolean): GreatWorkRecord | null {
    const kind = rollKind(galaxy, rnd, forcedKind);
    if (kind === null) {
        logGw(galaxy, galaxyStarDate(galaxy), 'no wonder can be rolled');
        return null;
    }
    const used = new Set<Habitat>();
    for (const w of st.works) for (const h of w.founders) used.add(h);
    const offset = rnd.nextDouble() * (TWO_PI / WEDGES) + index * (Math.PI / 3);
    // A small galaxy cannot keep the founders as far from every capital: relax the distance step by step until two circles of real
    // independent worlds fit (else until two circles fit, pilgrim colonies included).
    const full = gwParam(galaxy, 'giantworksCapitalSectors');
    const steps = [...new Set([full, Math.floor(full * 0.75), Math.floor(full / 2), 1, 0])].filter((x) => x <= full);
    let circles: Habitat[][] = [];
    let pilgrims: Habitat[] = [];
    for (const needReal of [true, false]) {
        for (const capSectors of steps) {
            const dry = pickFounders(galaxy, offset, used, capSectors, false);
            if ((needReal ? dry.circles.length - dry.pilgrims.length : dry.circles.length) < 2) continue;
            ({ circles, pilgrims } = pickFounders(galaxy, offset, used, capSectors, true));
            break;
        }
        if (circles.length >= 2) break;
    }
    if (circles.length < 2) {
        logGw(galaxy, galaxyStarDate(galaxy), `only ${circles.length} founding circle(s)`);
        return null;
    }
    const c = circlesCentroid(circles);
    const system = pickSite(galaxy, c.x, c.y);
    if (system === null) {
        logGw(galaxy, galaxyStarDate(galaxy), 'no empty system for a site');
        return null;
    }
    const rumourYears = gwParam(galaxy, 'giantworksRumourMinYear') + rnd.nextDouble() * Math.max(0, gwParam(galaxy, 'giantworksRumourMaxYear') - gwParam(galaxy, 'giantworksRumourMinYear'));
    const gatherYears = gwParam(galaxy, 'giantworksGatherMinYear') + rnd.nextDouble() * Math.max(0, gwParam(galaxy, 'giantworksGatherMaxYear') - gwParam(galaxy, 'giantworksGatherMinYear'));
    const now = galaxyStarDate(galaxy);
    const rec: GreatWorkRecord = {
        id: st.nextId++,
        system,
        habitat: siteHabitat(galaxy, system),
        base: null,
        progress: 0,
        stage: 0,
        wonder: kind.id,
        founders: circles.flat(),
        startDate: -1,
        completeDate: null,
        destroyedBy: null,
        knowledge: [],
        phase: 'seeded',
        circles,
        pilgrims,
        rumoured: false,
        seenBy: [],
        guards: [],
        rumourDate: forced ? now : yearsToDate(galaxy, rumourYears),
        gatherDate: forced ? now : yearsToDate(galaxy, gatherYears),
        forced,
        suppliers: [],
        perShip: 0,
        nextDeparture: {},
        convoys: [],
        convoySeq: 0,
        delivered: 0,
        deliveredBy: {},
        lost: 0,
        lastDelivery: -1,
        tags: {},
        narrowed: 0,
        anger: {},
        protectDays: {},
        protectors: [],
        holder: null,
        hostile: false,
        sabotage: null,
        attackedBy: null,
        hits: {},
        violations: {},
        exposed: null,
        aiNext: {},
        aiPlan: {},
        scaffoldName: '',
    };
    st.works.push(rec);
    logGw(galaxy, now, `work ${rec.id}: ${kind.id} at ${system.systemStar.name}, founders ${rec.founders.map((h) => h.name).join(', ')}`);
    kind.onRolled?.(galaxy, rec);
    return rec;
}

/** Game start (after the existence lottery said yes): seeds the Great Works. */
export function seedGreatWorks(galaxy: Galaxy): void {
    const st = gwState(galaxy);
    if (st.seeded) return;
    st.seeded = true;
    const rnd = ownRandom(galaxy, 1);
    const n = greatWorkCount(galaxy);
    for (let k = 0; k < n; k++) seedOne(galaxy, st, rnd, k, null, false);
}

/** A Great Work started from the Game Editor now (rumour skipped, the first convoy leaves at once). */
export function seedNow(galaxy: Galaxy, forcedKind: string | null): GreatWorkRecord | null {
    const st = gwState(galaxy);
    return seedOne(galaxy, st, nextRandom(galaxy), st.works.length, forcedKind, true);
}
