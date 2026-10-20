// The Reclaimer foundries (threats/giantworks/beaconFoundry.ts): counts, void placement, the cloak, building, capacity, capital boarding defence and the hold-to-reveal,
// the trap, the destroyed hook, intel and the save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { CreateGameOptions, Game } from '../src/sim/game';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH, registerScenarioEvent, scenarioEmit } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { detectHyperDeny } from '../src/sim/movement';
import { calculateBoardingDefenseValue } from '../src/sim/combat/attackAI';
import { takeOwnershipOfBuiltObject } from '../src/sim/combat/ownership';
import { cloakHides, isObjectVisibleToThisEmpire } from '../src/sim/independentTraders';
import { KNOWLEDGE_CONFIRMED, KNOWLEDGE_SUSPECTED, knowledgeLevel, threatKnownSites } from '../src/sim/scenario/threats/framework';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/types';
import { beaconComplete, beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { SYSTEM_RADIUS, beaconPosition, peekBeaconState, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { beginSeason, designFor, spawnShip, startWar } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { driveResponse, responseOf } from '../src/sim/scenario/threats/giantworks/beaconResponse';
import {
    FOUNDRY_KEY,
    capacity,
    capitalAlone,
    foundryBatch,
    foundryCountFor,
    foundryKnownSites,
    foundryPass,
    foundryTechPieces,
    foundriesDestroyedBy,
    liveFoundries,
    resolveFoundryInvestigation,
    starSystemCount,
    trappedAt,
} from '../src/sim/scenario/threats/giantworks/beaconFoundry';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks'];
const DAY = GAME_DAY_LENGTH;

function completed(): { g: Galaxy; st: BeaconState; game: Game; gameData: GameData; me: Empire } {
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
    st.season = null;
    st.seasons = [];
    st.stats.seasons = 1;
    g.scenario!.params.beaconFundingModel = 1;
    return { g, st, game, gameData, me: g.playerEmpire! };
}

const nearestFoundryDist = (st: BeaconState, x: number, y: number): number => Math.min(...liveFoundries(st).map((f) => Math.hypot(f.x - x, f.y - y)));

describe('the Reclaimer foundries', () => {
    it('the count scales with the galaxy: 5 up to 250 stars, 10 at 1,000, 20 at 4,000 (cap 20)', () => {
        expect([0, 100, 250].map(foundryCountFor)).toEqual([5, 5, 5]);
        expect(foundryCountFor(625)).toBe(8); // halfway: 7.5, rounded
        expect(foundryCountFor(1000)).toBe(10);
        expect(foundryCountFor(2500)).toBe(15);
        expect(foundryCountFor(4000)).toBe(20);
        expect(foundryCountFor(9000)).toBe(20);
        let last = 0;
        for (let n = 0; n <= 5000; n += 50) {
            expect(foundryCountFor(n)).toBeGreaterThanOrEqual(last);
            last = foundryCountFor(n);
        }
    });

    it('raised with the Beacon: the count of the galaxy, in the empty void, cloaked and hidden from every empire', () => {
        const { g, st, me } = completed();
        const fs = st.foundries!;
        expect(fs).toBeDefined();
        const stars = starSystemCount(g);
        expect(fs.initial).toBe(foundryCountFor(stars));
        expect(fs.list.length).toBe(fs.initial);
        const starPts = g.systems.filter((s) => s?.systemStar).map((s) => s.systemStar);
        for (const f of fs.list) {
            expect(f.status).toBe('active');
            expect(f.base).not.toBeNull();
            for (const s of starPts) expect(Math.hypot(s.xpos - f.x, s.ypos - f.y)).toBeGreaterThan(SYSTEM_RADIUS);
            // cloaked from sensors entirely: nobody sees it, not even an empire with a ship beside it
            expect(f.base!.cloaked).toBe(true);
            expect(f.base!.cloakSeenBy ?? []).toHaveLength(0);
            for (const e of g.empires) if (e !== null && e !== st.faction) expect(cloakHides(g, e, f.base!)).toBe(true);
            expect(isObjectVisibleToThisEmpire(g, me, f.base!)).toBe(false);
            expect(f.guard.length).toBeGreaterThan(0);
            expect(f.guard.every((b) => b.cloaked === true)).toBe(true);
        }
        const pos = beaconPosition(st)!;
        for (const f of fs.list) expect(Math.hypot(f.x - pos.x, f.y - pos.y)).toBeGreaterThan(SYSTEM_RADIUS);
        expect(threatKnownSites(g, me).some((s) => s.threat === FOUNDRY_KEY)).toBe(false);
    }, 600000);

    it('later seasons\' warships are made at a living foundry (cloaked until clear of it); the first beam\'s stockpile and the time before stay at the Beacon', () => {
        const { g, st, me } = completed();
        const rs = responseOf(st);
        rs.reserveAllow = 1e9;
        rs.patrolAllow = 0;
        g.scenario!.params.beaconPatrolMax = 0;
        const pos = beaconPosition(st)!;
        // season 1: at the Beacon
        driveResponse(g, st, galaxyStarDate(g));
        const early = rs.fleets.flatMap((f) => f.ships);
        expect(early.length).toBeGreaterThan(0);
        for (const b of early) expect(Math.hypot(b.xpos - pos.x, b.ypos - pos.y)).toBeLessThan(15000);
        expect(st.foundries!.fresh.length).toBe(0);
        // season 2 on: at the foundries
        for (const f of rs.fleets) f.ships = [];
        st.stats.seasons = 2;
        g.nowMs += 5 * DAY;
        driveResponse(g, st, galaxyStarDate(g));
        const made = rs.fleets.flatMap((f) => f.ships);
        expect(made.length).toBeGreaterThan(0);
        for (const b of made) {
            expect(nearestFoundryDist(st, b.xpos, b.ypos)).toBeLessThan(15000);
            expect(b.cloaked).toBe(true);
            expect(cloakHides(g, me, b)).toBe(true);
        }
        expect(st.foundries!.fresh.length).toBe(made.length);
        expect(st.foundries!.list.reduce((s, f) => s + f.built, 0)).toBe(made.length);
        // once clear of every foundry they show themselves
        for (const b of made) b.xpos = b.ypos = 5;
        foundryPass(g);
        for (const b of made) expect(b.cloaked).toBe(false);
        expect(st.foundries!.fresh.length).toBe(0);
        // a season-2 wave is made there too
        expect(beginSeason(g, st, 2)).toBe(true);
    }, 600000);

    it('capacity follows the living foundries: all alive = the whole batch, half = half, none = no ships', () => {
        const { g, st } = completed();
        st.stats.seasons = 2;
        const fs = st.foundries!;
        expect(capacity(st)).toBe(1);
        expect(foundryBatch(st, 14)).toBe(14);
        fs.list.slice(0, Math.floor(fs.list.length / 2)).forEach((f) => (f.base!.hasBeenDestroyed = true));
        const cap = liveFoundries(st).length / fs.initial;
        expect(capacity(st)).toBeCloseTo(cap, 6);
        let sum = 0;
        for (let i = 0; i < 10; i++) sum += foundryBatch(st, 14);
        expect(sum).toBeGreaterThanOrEqual(Math.floor(140 * cap) - 1);
        expect(sum).toBeLessThanOrEqual(Math.ceil(140 * cap));
        for (const f of fs.list) f.base!.hasBeenDestroyed = true;
        expect(capacity(st)).toBe(0);
        expect(foundryBatch(st, 14)).toBe(0);
        // before season 2 the stockpile is not limited
        st.stats.seasons = 1;
        expect(foundryBatch(st, 14)).toBe(14);
        void g;
    }, 600000);

    it('a Reclaimer capital is very hard to board (about 2,500); a foundry base all but impossible; a cruiser is not', () => {
        const { g, st } = completed();
        const f = st.faction!;
        const pos = beaconPosition(st)!;
        const cap = spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.CapitalShip)!, pos.x, pos.y);
        const cruiser = spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.Cruiser)!, pos.x, pos.y);
        expect(calculateBoardingDefenseValue(g, cap, g.nowMs).value).toBeGreaterThanOrEqual(2500);
        expect(calculateBoardingDefenseValue(g, cruiser, g.nowMs).value).toBeLessThan(2500);
        expect(calculateBoardingDefenseValue(g, st.foundries!.list[0].base!, g.nowMs).value).toBeGreaterThanOrEqual(30000);
        g.scenario!.params.beaconFoundryCapitalDefence = 400;
        expect(calculateBoardingDefenseValue(g, cap, g.nowMs).value).toBeLessThan(1500);
        // a Watcher is no prize
        g.scenario!.params.beaconFoundryCapitalDefence = 2500;
        const w = st.watchers[0].ship!;
        expect(calculateBoardingDefenseValue(g, w, g.nowMs).value).toBeLessThan(2500);
    }, 600000);

    it('a captured capital held for the days reveals one foundry; retaken or destroyed first, nothing; AI empires can do it too', () => {
        const { g, st, me } = completed();
        const f = st.faction!;
        const pos = beaconPosition(st)!;
        const fs = st.foundries!;
        const mk = (): BuiltObject => spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.CapitalShip)!, pos.x, pos.y);
        // held 5 days: revealed
        const cap = mk();
        takeOwnershipOfBuiltObject(g, me, cap, me, false);
        expect(fs.held.some((h) => h.ship === cap && h.by === me)).toBe(true);
        foundryPass(g);
        expect(fs.list.filter((x) => knowledgeLevel(x, me) >= KNOWLEDGE_SUSPECTED)).toHaveLength(0);
        g.nowMs += 3 * DAY;
        foundryPass(g);
        expect(fs.list.filter((x) => knowledgeLevel(x, me) >= KNOWLEDGE_SUSPECTED)).toHaveLength(0);
        g.nowMs += 3 * DAY;
        foundryPass(g);
        const known = fs.list.filter((x) => knowledgeLevel(x, me) >= KNOWLEDGE_SUSPECTED);
        expect(known).toHaveLength(1);
        expect(fs.held).toHaveLength(0);
        // the cloak lapses for the captor alone
        expect(cloakHides(g, me, known[0].base!)).toBe(false);
        const other = g.empires.find((e): e is Empire => e !== null && e !== me && e !== f && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active)!;
        expect(cloakHides(g, other, known[0].base!)).toBe(true);
        expect(foundryKnownSites(g, me).map((s) => s.target)).toEqual([known[0].base]);
        expect(foundryKnownSites(g, other)).toHaveLength(0);
        // retaken before the days are up: nothing
        const cap2 = mk();
        takeOwnershipOfBuiltObject(g, me, cap2, me, false);
        g.nowMs += 2 * DAY;
        takeOwnershipOfBuiltObject(g, f, cap2, f, false);
        g.nowMs += 6 * DAY;
        foundryPass(g);
        expect(fs.list.filter((x) => knowledgeLevel(x, me) >= KNOWLEDGE_SUSPECTED)).toHaveLength(1);
        // destroyed before: nothing
        const cap3 = mk();
        takeOwnershipOfBuiltObject(g, me, cap3, me, false);
        cap3.hasBeenDestroyed = true;
        g.nowMs += 6 * DAY;
        foundryPass(g);
        expect(fs.list.filter((x) => knowledgeLevel(x, me) >= KNOWLEDGE_SUSPECTED)).toHaveLength(1);
        // an AI empire that holds one learns a foundry as well; a cruiser gives nothing
        const cap4 = mk();
        takeOwnershipOfBuiltObject(g, other, cap4, other, false);
        const cruiser = spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.Cruiser)!, pos.x, pos.y);
        takeOwnershipOfBuiltObject(g, other, cruiser, other, false);
        expect(fs.held.map((h) => h.ship)).toEqual([cap4]);
        g.nowMs += 6 * DAY;
        foundryPass(g);
        expect(fs.list.filter((x) => knowledgeLevel(x, other) >= KNOWLEDGE_SUSPECTED)).toHaveLength(1);
    }, 600000);

    it('a strike group\'s capital never fights without escorts: alone it falls back, with an escort it stays', () => {
        const { g, st } = completed();
        const f = st.faction!;
        const pos = beaconPosition(st)!;
        const cap = spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.CapitalShip)!, pos.x, pos.y);
        const cruiser = spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.Cruiser)!, pos.x, pos.y);
        expect(capitalAlone(g, st, { ships: [cap] })).toBe(true);
        expect(capitalAlone(g, st, { ships: [cap, cruiser] })).toBe(false);
        expect(capitalAlone(g, st, { ships: [cruiser] })).toBe(false);
        g.scenario!.params.beaconFoundryCapitalEscorts = 0;
        expect(capitalAlone(g, st, { ships: [cap] })).toBe(false);
    }, 600000);

    it('the trap: a ship within reach of a living foundry cannot hyperjump away until it is destroyed; the Reclaimers\' ships are free', () => {
        const { g, st, me } = completed();
        const f = st.faction!;
        const fd = st.foundries!.list[0];
        const ship = me.builtObjects.find((b) => !b.hasBeenDestroyed && b.warpSpeed > 0)!;
        expect(detectHyperDeny(g, ship)).toBe(false);
        const ox = ship.xpos;
        const oy = ship.ypos;
        ship.xpos = fd.x + 3000;
        ship.ypos = fd.y;
        expect(trappedAt(g, st, ship)).toBe(fd);
        expect(detectHyperDeny(g, ship)).toBe(true);
        ship.xpos = fd.x + 60000;
        expect(detectHyperDeny(g, ship)).toBe(false);
        // the Reclaimers' own ship made there is not held
        const own = spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.Cruiser)!, fd.x, fd.y);
        expect(detectHyperDeny(g, own)).toBe(false);
        // destroyed: released
        ship.xpos = fd.x + 3000;
        ship.ypos = fd.y;
        expect(detectHyperDeny(g, ship)).toBe(true);
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: fd.base!, destroyer: me });
        fd.base = fd.base;
        expect(fd.status).toBe('destroyed');
        expect(detectHyperDeny(g, ship)).toBe(false);
        ship.xpos = ox;
        ship.ypos = oy;
    }, 600000);

    it('a destroyed foundry credits its destroyer, fires foundryDestroyed once, keeps its place and status, and is never replaced', () => {
        const { g, st, me } = completed();
        const fs = st.foundries!;
        const heard: { empire: Empire | null; id: number }[] = [];
        registerScenarioEvent({ id: 'test.foundryDestroyed', flag: 'gwBeacon', event: 'foundryDestroyed', run: (_g, e) => heard.push({ empire: e.empire, id: e.foundry.id }) });
        const fd = fs.list[1];
        const [x, y] = [fd.x, fd.y];
        const before = fs.list.length;
        fd.base!.hasBeenDestroyed = true;
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: fd.base!, destroyer: me });
        expect(heard).toEqual([{ empire: me, id: fd.id }]);
        expect(foundriesDestroyedBy(g, me)).toBe(1);
        // and it is a void frame toward the mega-station (beaconComponents.ts)
        expect(st.parts?.held[String(me.empireId)]?.voidFrames).toBe(1);
        expect(fd.status).toBe('destroyed');
        expect(fd.destroyedBy).toBe(me.empireId);
        expect([fd.x, fd.y]).toEqual([x, y]);
        // seen again (the teardown signal, the pass): no second credit
        foundryPass(g);
        expect(foundriesDestroyedBy(g, me)).toBe(1);
        expect(heard).toHaveLength(1);
        // a base that fell to no empire counts for nobody
        const other = fs.list[2];
        other.base!.hasBeenDestroyed = true;
        foundryPass(g);
        expect(other.status).toBe('destroyed');
        expect(heard).toHaveLength(2);
        expect(heard[1].empire).toBeNull();
        expect(foundriesDestroyedBy(g, me)).toBe(1);
        expect(fs.list.length).toBe(before);
        expect(liveFoundries(st).length).toBe(before - 2);
        g.nowMs += 400 * DAY;
        foundryPass(g);
        expect(fs.list.length).toBe(before);
    }, 600000);

    it('intel: an investigation reports the strength (level 3) and yields a tech piece (a counter: the tech is undecided)', () => {
        const { g, st, me } = completed();
        const fd = st.foundries!.list[0];
        expect(foundryTechPieces(g, me)).toBe(0);
        const lost = resolveFoundryInvestigation(g, me, fd.base!, { name: 'Agent' }, false);
        expect(lost.good).toBe(false);
        expect(foundryTechPieces(g, me)).toBe(0);
        const found = resolveFoundryInvestigation(g, me, fd.base!, { name: 'Agent' }, true);
        expect(found.good).toBe(true);
        expect(knowledgeLevel(fd, me)).toBe(KNOWLEDGE_CONFIRMED);
        expect(foundryTechPieces(g, me)).toBe(1);
        expect(fd.intel[String(me.empireId)].guard).toBeGreaterThan(0);
        const row = foundryKnownSites(g, me)[0];
        expect(row.level).toBe(KNOWLEDGE_CONFIRMED);
        expect(row.status).toContain('Investigated');
    }, 600000);

    it('the state survives a save round trip (positions, status, knowledge, held capitals, counters)', () => {
        const { g, st, game, gameData, me } = completed();
        const fs = st.foundries!;
        const f = st.faction!;
        const pos = beaconPosition(st)!;
        const cap = spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.CapitalShip)!, pos.x, pos.y);
        takeOwnershipOfBuiltObject(g, me, cap, me, false);
        fs.techPieces[String(me.empireId)] = 2;
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: fs.list[0].base!, destroyer: me });
        const k = fs.list[1];
        k.base!.cloakSeenBy = [];
        g.nowMs += 6 * DAY;
        foundryPass(g);
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const { game: lgame } = deserializeGame(serializeGame(game, time, {} as StartGameOptions), gameData);
        const lg = lgame.galaxy;
        const ls = peekBeaconState(lg)!;
        const lfs = ls.foundries!;
        expect(lfs.initial).toBe(fs.initial);
        expect(lfs.list.map((x) => [x.id, x.x, x.y, x.status, x.built])).toEqual(fs.list.map((x) => [x.id, x.x, x.y, x.status, x.built]));
        expect(lfs.list[0].status).toBe('destroyed');
        expect(lfs.list[0].base).toBeNull();
        expect(lfs.list[1].base!.cloaked).toBe(true);
        expect(lfs.techPieces).toEqual(fs.techPieces);
        expect(lfs.destroyedBy).toEqual(fs.destroyedBy);
        expect(foundriesDestroyedBy(lg, lg.playerEmpire!)).toBe(1);
        expect(lfs.list.map((x) => x.knowledge)).toEqual(fs.list.map((x) => x.knowledge));
        expect(liveFoundries(ls).length).toBe(liveFoundries(st).length);
    }, 600000);
});
