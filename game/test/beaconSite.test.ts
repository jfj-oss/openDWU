// The Beacon's site defends itself before the first mega beam (threats/giantworks/beaconSite.ts): the scaffold's shield, the Watchers that appear
// over it when it is attacked and go back afterwards, the Reclaimer fleet a broken shield brings, no war, saves.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH, scenarioEmit } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { spawnGreatWork, greatWorks, completeWork } from '../src/sim/scenario/threats/giantworks/framework';
import { BEACON_KIND, peekBeaconState, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { watchersPeriodic, watcherMayFire } from '../src/sim/scenario/threats/giantworks/beacon';
import { siteDefencePass, SITE_ARRIVAL } from '../src/sim/scenario/threats/giantworks/beaconSite';
import { startWar, strengthOf } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { GalaxyTime } from '../src/sim/galaxyTime';
import type { StartGameOptions } from '../src/sim/startGameOptions';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks'];
const DAY = GAME_DAY_LENGTH;

function setup(): { g: Galaxy; st: BeaconState; game: Game; gameData: GameData; scaffold: BuiltObject; enemy: Empire; ship: BuiltObject } {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
    const g = game.galaxy;
    g.scenario!.flags.gwBeacon = true;
    expect(spawnGreatWork(g, BEACON_KIND)).toBe(true);
    const st = peekBeaconState(g)!;
    const work = greatWorks(g).find((w) => w.wonder === BEACON_KIND)!;
    siteDefencePass(g, st);
    const f = st.faction!;
    const enemy = g.empires.find((e): e is Empire => e !== null && e !== g.independentEmpire && e !== f && e.pirateEmpireBaseHabitat === null && e.active && e.builtObjects.some((b) => b.role === BuiltObjectRole.Military && b.topSpeed > 0))!;
    const ship = enemy.builtObjects.find((b) => b.role === BuiltObjectRole.Military && b.topSpeed > 0)!;
    const star = work.system.systemStar;
    ship.xpos = star.xpos + 3000;
    ship.ypos = star.ypos;
    return { g, st, game, gameData, scaffold: work.base!, enemy, ship };
}

const attack = (g: Galaxy, scaffold: BuiltObject, ship: BuiltObject, enemy: Empire): void => scenarioEmit(g, 'builtObjectAttacked', { builtObject: scaffold, attacker: ship, attackingEmpire: enemy });
const near = (g: Galaxy, a: BuiltObject, b: BuiltObject): number => g.calculateDistance(a.xpos, a.ypos, b.xpos, b.ypos);

describe('the Beacon site\'s own defence', () => {
    it('the scaffold has a strong shield from stage 0', () => {
        const { st, scaffold } = setup();
        expect(st.site!.stage).toBe(0);
        expect(scaffold.shieldsCapacity).toBeGreaterThan(20000);
        expect(scaffold.currentShields).toBeGreaterThan(20000);
    }, 600000);

    it('an attack brings the Watchers within 1,000 units, they fight uncloaked, no war is declared, and they go back afterwards', () => {
        const { g, st, scaffold, enemy, ship } = setup();
        const watchers = st.watchers.filter((w) => !w.dead && w.ship !== null);
        expect(watchers.length).toBeGreaterThan(0);
        for (const w of watchers) expect(w.ship!.cloaked).toBe(true);
        attack(g, scaffold, ship, enemy);
        for (const w of watchers) {
            expect(w.mode).toBe('fight');
            expect(w.ship!.cloaked).toBe(false);
            expect(near(g, w.ship!, scaffold)).toBeLessThanOrEqual(SITE_ARRIVAL);
            expect(watcherMayFire(g, w.ship!, ship)).toBe(true);
        }
        const rel = st.faction!.diplomaticRelations.byEmpire(enemy);
        expect(rel === null || rel.type !== DiplomaticRelationType.War).toBe(true);
        // the attackers are gone and quiet for a month: the Watchers cloak and go back
        ship.xpos = ship.ypos = 1;
        const now = galaxyStarDate(g);
        for (const w of watchers) w.lastHit = w.modeDate = now - 30 * DAY;
        st.defence!.lastAttack = now - 30 * DAY;
        watchersPeriodic(g);
        for (const w of watchers) {
            expect(w.mode).not.toBe('fight');
            expect(w.ship!.cloaked).toBe(true);
        }
        expect(st.defence!.active).toBe(false);
        expect(st.defence!.fleetDate).toBe(0);
    }, 600000);

    it('a broken shield brings a Reclaimer fleet that holds the site until the beam, then joins the guard; saves keep it', () => {
        const { g, st, game, gameData, scaffold, enemy, ship } = setup();
        scaffold.currentShields = 0;
        attack(g, scaffold, ship, enemy);
        const def = st.defence!;
        expect(def.fleetDate).toBeGreaterThan(0);
        expect(def.fleet.length).toBeGreaterThan(0);
        for (const b of def.fleet) {
            expect(b.actualEmpire).toBe(st.faction);
            expect(near(g, b, scaffold)).toBeLessThanOrEqual(SITE_ARRIVAL);
        }
        expect(def.fleet.reduce((s, b) => s + strengthOf(b), 0)).toBeGreaterThan(0);
        const rel = st.faction!.diplomaticRelations.byEmpire(enemy);
        expect(rel === null || rel.type !== DiplomaticRelationType.War).toBe(true);
        expect(watcherMayFire(g, def.fleet[0], ship)).toBe(true);
        // a second break does not bring a second fleet
        const n = def.fleet.length;
        attack(g, scaffold, ship, enemy);
        expect(def.fleet.length).toBe(n);
        // the Great Work finishes, the beam has not fired: the fleet is still the site's
        const work = greatWorks(g).find((w) => w.wonder === BEACON_KIND)!;
        work.progress = 1;
        work.stage = 4;
        completeWork(g, work);
        siteDefencePass(g, st);
        expect(st.phase).toBe('reclamation');
        expect(st.warStarted).toBe(false);
        expect(def.handed).not.toBe(true);
        expect(st.guards.some((b) => def.fleet.includes(b))).toBe(false);
        // save round trip
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const { game: lgame } = deserializeGame(serializeGame(game, time, {} as StartGameOptions), gameData);
        const ls = peekBeaconState(lgame.galaxy)!;
        expect(ls.defence!.fleet.length).toBe(n);
        expect(ls.defence!.fleetDate).toBe(def.fleetDate);
        expect(ls.defence!.fleet.every((b) => !b.hasBeenDestroyed)).toBe(true);
        // the beam fires: war, and the fleet joins the guard
        startWar(g, st);
        siteDefencePass(g, st);
        expect(def.handed).toBe(true);
        expect(def.fleet.every((b) => st.guards.includes(b))).toBe(true);
    }, 600000);
});
