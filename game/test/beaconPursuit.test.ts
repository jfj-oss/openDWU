// The Reclaimer capitals' pursuit (threats/giantworks/beaconPursuit.ts): a fleeing enemy is chased by hyperjump and dragged out of warp.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { assignMission } from '../src/sim/missions/assign';
import { comboOverlayFs, createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { beaconComplete, beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { beaconPosition, peekBeaconState, type BeaconState, type StrikeGroup } from '../src/sim/scenario/threats/giantworks/beaconState';
import { designFor, spawnShip, startWar } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { canCatch, defenceAt, isPursuing, pursuitOf, pursuitSummary, pursuitTick, unitHealthPct } from '../src/sim/scenario/threats/giantworks/beaconPursuit';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/types';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks'];
const DAY = GAME_DAY_LENGTH;

interface World {
    game: Game;
    g: Galaxy;
    st: BeaconState;
    f: Empire;
    x: number;
    y: number;
    cap: BuiltObject;
    esc: BuiltObject[];
    enemy: BuiltObject;
    gameData: GameData;
}

/** The Beacon finished and the war begun; a capital with two cruisers in deep space and a warship of an AI empire 20000 units from them. */
function world(escorts = 2, human = false): World {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
    const g = game.galaxy;
    g.scenario!.flags.gwBeacon = true;
    let best = null as (typeof g.systems)[number] | null;
    let bd = Infinity;
    for (const sys of g.systems) {
        const s = sys?.systemStar;
        if (!s || sys.habitats.some((h) => h.empire !== null) || g.checkEmpireTerritoryIdAtLocation(s.xpos, s.ypos) >= 0) continue;
        const d = g.calculateDistance(s.xpos, s.ypos, g.sizeX / 2, g.sizeY / 2);
        if (d < bd) {
            bd = d;
            best = sys;
        }
    }
    const site: GreatWorkSite = { id: 0, system: best!, habitat: null, base: null, progress: 0, stage: 0, wonder: 'beacon', founders: [], startDate: galaxyStarDate(g), completeDate: null, destroyedBy: null };
    beaconRolled(g, site);
    site.progress = 1;
    site.stage = 4;
    site.completeDate = galaxyStarDate(g);
    beaconComplete(g, site);
    const st = peekBeaconState(g)!;
    startWar(g, st);
    const f = st.faction!;
    const owner = human ? g.playerEmpire! : g.empires.find((e): e is Empire => e !== null && e !== g.independentEmpire && e !== f && e.pirateEmpireBaseHabitat === null && e.active && e !== g.playerEmpire)!;
    const enemy = owner.builtObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.warpSpeed > 0 && b.topSpeed > 0)!;
    const pos = beaconPosition(st)!;
    const x = pos.x + 600000;
    const y = pos.y;
    const cap = spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.CapitalShip)!, x, y);
    const esc: BuiltObject[] = [];
    for (let i = 0; i < escorts; i++) esc.push(spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.Cruiser)!, x + 3000, y));
    enemy.xpos = x + 20000;
    enemy.ypos = y;
    return { game, g, st, f, x, y, cap, esc, enemy, gameData };
}

/** Sets a ship into hyperspace by hand (for the tests that drive pursuitTick directly). */
function warp(b: BuiltObject, left = 5e6): void {
    b.hyperjumpPrepare = false;
    b.currentSpeed = b.warpSpeed;
    b.lastHyperDistance = left;
}

/** The enemy fought the capital just now (a contact, as the sampling of the fights notes it). */
function contact(w: World): void {
    pursuitOf(w.st).contacts.push({ victim: w.enemy, by: w.cap, date: galaxyStarDate(w.g) });
}

/** Flight order for the enemy: a Move to a star five sectors away (the stock jump). */
function flee(w: World): void {
    const { g, x, y, enemy } = w;
    const far = g.systems.map((s) => s!.systemStar!).filter((s) => g.calculateDistance(s.xpos, s.ypos, x, y) > 5 * g.sectorSize).sort((a, b) => g.calculateDistance(a.xpos, a.ypos, x, y) - g.calculateDistance(b.xpos, b.ypos, x, y))[0];
    w.cap.currentTarget = enemy; // the fight: sampled as a contact
    enemy.isAutoControlled = false;
    assignMission(g, enemy, BuiltObjectMissionType.Move, far, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
}

function step(g: Galaxy, days: number): void {
    g.nowMs += days * DAY;
}

describe('the Reclaimer capitals\' pursuit', () => {
    it('an enemy that fought the capital and jumps away is chased, pulled out of warp and fought; a human gets a message; orders come back', () => {
        const w = world(2, true);
        const { g, st, cap, esc, enemy } = w;
        const unit = [cap, ...esc];
        expect(cap.warpSpeed).toBeGreaterThan(enemy.warpSpeed);
        flee(w);
        let pulled = false;
        for (let i = 0; i < 70 && !pulled; i++) {
            runGameSeconds(g, 1);
            pulled = (st.pursuit?.stats.caught ?? 0) > 0;
            if (pulled) break;
        }
        const pr = pursuitOf(st);
        expect(pr.stats.started).toBe(1);
        expect(pr.stats.caught).toBe(1);
        expect(pr.stats.pulledShips).toBeGreaterThanOrEqual(1);
        expect(pr.stats.pulledHuman).toBeGreaterThanOrEqual(1);
        expect(pr.msgLast[String(g.playerEmpire!.empireId)]).toBeGreaterThan(0);
        expect(enemy.currentSpeed).toBeLessThanOrEqual(enemy.topSpeed + 1);
        expect(pr.locks.some((l) => l.ship === enemy)).toBe(true);
        expect(unit.every((b) => isPursuing(g, b))).toBe(true);
        // the fight goes on until the enemy is dead or the fight time is over; then the orders are back
        g.scenario!.params.beaconPursuitFightDays = 1;
        runGameSeconds(g, 120);
        expect(pr.chases).toHaveLength(0);
        expect(unit.some((b) => isPursuing(g, b))).toBe(false);
        expect(pr.cooldown.some((c) => c.capital === cap)).toBe(true);
        expect(pursuitSummary(st).stats.started).toBe(1);
    }, 900000);

    it('no pursuit: a faster enemy, a head start, a damaged unit, no escort, a committed group, a cooldown, too far', () => {
        const base0 = (): World => {
            const w = world();
            warp(w.enemy);
            contact(w);
            return w;
        };
        const tick = (w: World): Record<string, number> => {
            pursuitTick(w.g); // samples the contact
            step(w.g, 0.2);
            pursuitTick(w.g);
            return pursuitOf(w.st).stats;
        };
        // control: all fine, it starts
        {
            const w = base0();
            const s = tick(w);
            expect(s.started).toBe(1);
        }
        // the enemy's drive is faster than the pursuers'
        {
            const w = base0();
            w.enemy.warpSpeed = w.cap.warpSpeed * 2;
            w.enemy.currentSpeed = w.enemy.warpSpeed;
            expect(tick(w).refusedSlow).toBe(1);
        }
        // it is nearly out of warp already
        {
            const w = base0();
            w.enemy.lastHyperDistance = 1000;
            expect(tick(w).refusedHeadStart).toBe(1);
        }
        // too far for the limit
        {
            const w = base0();
            w.g.scenario!.params.beaconPursuitMaxSectors = 0.001;
            w.enemy.xpos += 800000;
            const s = tick(w);
            expect(s.refusedFar ?? s.refusedHeadStart).toBeGreaterThanOrEqual(0);
            expect(s.started).toBeUndefined();
        }
        // badly damaged
        {
            const w = base0();
            for (const b of [w.cap, ...w.esc]) b.damagedComponentCount = b.components.items.length;
            expect(unitHealthPct([w.cap, ...w.esc])).toBeLessThan(10);
            expect(tick(w).refusedDamaged).toBe(1);
        }
        // a capital alone does not go
        {
            const w = world(0);
            warp(w.enemy);
            contact(w);
            expect(tick(w).refusedNoEscort).toBe(1);
        }
        // committed: its group is besieging a world
        {
            const w = base0();
            const grp = { id: 1, season: 1, state: 'siege', target: null, staging: 0, ships: [w.cap, ...w.esc], transports: [], lead: w.cap, departDate: 0, arriveDate: 0, siegeStart: 0, landings: 0, fails: 0, committed: true, destroyer: null, targetPop: 0, troopsDone: true, lastReinforce: 0, rolled: false } as StrikeGroup;
            w.st.seasons.push({ n: 1, phase: 'offensive', start: 0, end: 1e18, staging: [], groups: [grp], budget: 0, spawned: 0, departed: 0, departures: [], plannedTravelDays: 0 });
            expect(tick(w).refusedCommitted).toBe(1);
            // the siege over, the same capital goes
            grp.state = 'done';
            step(w.g, 1);
            contact(w);
            expect(tick(w).started).toBe(1);
        }
        // a capital that has just chased rests
        {
            const w = base0();
            expect(tick(w).started).toBe(1);
            const pr = pursuitOf(w.st);
            pr.chases.length = 0;
            pr.cooldown.push({ capital: w.cap, until: galaxyStarDate(w.g) + 50 * DAY });
            pr.contacts.length = 0;
            step(w.g, 1);
            contact(w);
            const s = tick(w);
            expect(s.refusedCooldown).toBe(1);
            expect(s.started).toBe(1); // (only the first chase)
        }
        // switched off
        {
            const w = base0();
            w.g.scenario!.params.beaconPursuitOn = 0;
            expect(tick(w).started).toBeUndefined();
        }
    }, 900000);

    it('canCatch: a faster drive catches an enemy with distance to spare, not one about to come out of warp', () => {
        const w = world();
        warp(w.enemy, 5e6);
        expect(canCatch(w.g, w.cap, w.cap.warpSpeed, w.enemy)).toBe('ok');
        w.enemy.lastHyperDistance = 500;
        expect(canCatch(w.g, w.cap, w.cap.warpSpeed, w.enemy)).toBe('headStart');
        expect(canCatch(w.g, w.cap, w.enemy.warpSpeed / 2, w.enemy)).toBe('slow');
    }, 600000);

    it('the pursuit gives up after its time; a runner still in warp is pulled out even over a strongly defended place', () => {
        // give up
        {
            const w = world();
            for (const b of [w.cap, ...w.esc]) assignMission(w.g, b, BuiltObjectMissionType.Patrol, w.st.site!.system.systemStar!, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
            warp(w.enemy);
            warp(w.cap);
            contact(w);
            w.g.scenario!.params.beaconPursuitPullRange = 1; // never in range
            w.g.scenario!.params.beaconPursuitGiveUpDays = 5;
            pursuitTick(w.g);
            step(w.g, 0.2);
            pursuitTick(w.g);
            const pr = pursuitOf(w.st);
            expect(pr.chases).toHaveLength(1);
            step(w.g, 6);
            pursuitTick(w.g);
            expect(pr.chases).toHaveLength(0);
            expect(pr.stats.end_giveUp).toBe(1);
            // the orders they had are back
            for (const b of [w.cap, ...w.esc]) {
                const m = builtObjectMission(b.mission);
                expect(m?.type).toBe(BuiltObjectMissionType.Patrol);
                expect(m?.targetHabitat).toBe(w.st.site!.system.systemStar);
            }
            expect(isPursuing(w.g, w.cap)).toBe(false);
            expect(pr.cooldown.some((c) => c.capital === w.cap)).toBe(true);
        }
        // too far from where it began: ends, the orders are back
        {
            const w = world();
            for (const b of [w.cap, ...w.esc]) assignMission(w.g, b, BuiltObjectMissionType.Patrol, w.st.site!.system.systemStar!, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
            warp(w.enemy);
            contact(w);
            w.g.scenario!.params.beaconPursuitPullRange = 1;
            pursuitTick(w.g);
            step(w.g, 0.2);
            pursuitTick(w.g);
            const pr = pursuitOf(w.st);
            expect(pr.chases).toHaveLength(1);
            w.cap.xpos += 4.6 * w.g.sectorSize;
            step(w.g, 0.2);
            pursuitTick(w.g);
            expect(pr.stats.end_tooFar).toBe(1);
            expect(pr.stats.maxAwayX100).toBeGreaterThanOrEqual(460);
            expect(builtObjectMission(w.cap.mission)?.type).toBe(BuiltObjectMissionType.Patrol);
        }
        // a defended system: the enemy's whole navy sits at a star and the enemy, still in warp, is over it: it is pulled out short of safety
        {
            const w = world();
            const owner = w.enemy.actualEmpire as Empire;
            const star = w.g.fastFindNearestSystem(w.x, w.y)!;
            const navy = owner.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0);
            for (const b of navy) {
                b.xpos = star.xpos + 1000;
                b.ypos = star.ypos;
            }
            for (const b of [w.cap, ...w.esc]) {
                b.xpos = star.xpos + 15000;
                b.ypos = star.ypos;
            }
            expect(defenceAt(w.g, w.st, star.xpos, star.ypos)).toBeGreaterThan(0);
            w.g.scenario!.params.beaconPursuitDefencePct = 1;
            warp(w.enemy);
            warp(w.cap);
            contact(w);
            pursuitTick(w.g);
            step(w.g, 0.2);
            pursuitTick(w.g);
            step(w.g, 0.2);
            pursuitTick(w.g);
            const pr = pursuitOf(w.st);
            expect(pr.stats.started).toBe(1);
            expect(pr.stats.caught).toBe(1);
            expect(pr.stats.end_defended).toBeUndefined();
        }
    }, 900000);

    it('save and load in the middle of a chase: the state comes back and both runs agree', () => {
        const w = world();
        flee(w);
        for (let i = 0; i < 60 && (w.st.pursuit?.stats.started ?? 0) === 0; i++) runGameSeconds(w.g, 1);
        runGameSeconds(w.g, 2);
        const pr = pursuitOf(w.st);
        expect(pr.stats.started).toBe(1);
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(w.g.nowMs);
        const text = serializeGame(w.game, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'combo', flags: w.g.scenario!.flags, params: {} } });
        const loaded = deserializeGame(text, scenarioGameData(base, comboOverlayFs(ids))).game;
        const st2 = peekBeaconState(loaded.galaxy)!;
        const pr2 = st2.pursuit!;
        expect(pr2.stats).toEqual(pr.stats);
        expect(pr2.chases.length).toBe(pr.chases.length);
        expect(pr2.contacts.length).toBe(pr.contacts.length);
        expect(pr2.cooldown.length).toBe(pr.cooldown.length);
        if (pr.chases.length > 0) {
            expect(pr2.chases[0].capital.builtObjectID).toBe(pr.chases[0].capital.builtObjectID);
            expect(pr2.chases[0].target.builtObjectID).toBe(pr.chases[0].target.builtObjectID);
            expect(pr2.chases[0].escorts.length).toBe(pr.chases[0].escorts.length);
        }
        runGameSeconds(w.g, 30);
        runGameSeconds(loaded.galaxy, 30);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(w.g));
        expect(pursuitOf(st2).stats).toEqual(pursuitOf(w.st).stats);
    }, 900000);
});
