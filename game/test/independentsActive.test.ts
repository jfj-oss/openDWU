// Scenario 19k items 2-3 "independents as actors" + "independent leagues" (tasks/19-mod-layer-scenarios.md §19k):
// militia (2a), construction ship + stations (2b), freighters (2c), militia refresh (2d), station friction decision,
// league formation under a forced threat, pooled defence, the single extra colony, bloc diplomacy (pull / split),
// dissolution, flags off = no package code, save round trip mid-league. Handlers are driven directly; short runs.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, loadScenarioOverlayFs, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { scenarioEmit, type ScenarioOverlay } from '../src/sim/scenario';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { FleetPosture } from '../src/sim/diplomacyTick';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { answerScenarioDecision, pendingScenarioDecisions } from '../src/sim/scenario/decisions';
import { herderColonyHerds, isTamedCreatureShip, rimHerdersState } from '../src/sim/scenario/rimHerders/common';
import { SECTOR_SIZE, independentsState, leagueOf, registerIndependentStationFriction, type IndependentActor, type IndependentLeague } from '../src/sim/scenario/independents/common';
import {
    answerRaids,
    checkStationFriction,
    formLeague,
    independentsTick,
    independentsYear,
    militiaTarget,
    offerToLeague,
    raiseStationFriction,
    refreshMilitia,
    reviewLeagueFormation,
    runConstruction,
    runLeagueColonyShip,
    stationQuota,
} from '../src/sim/scenario/independents/independents';

const PARAMS = {
    independentActorsStationRadius: 3,
    independentLeaguesRadius: 20,
    independentLeaguesChance: 1,
    independentLeaguesFleetMultiplier: 2,
};

let base: GameData;
let shared: Game;

beforeAll(async () => {
    base = await loadGameDataFs();
    shared = createScenarioGame(base, { scenario: 'independents-active', params: PARAMS }).game;
}, 600000);

function active(g: Galaxy): IndependentActor[] {
    return independentsState(g).actors.filter((a) => a.status === 'active');
}

function isolated(g: Galaxy): IndependentActor[] {
    return active(g).filter((a) => a.leagueId < 0);
}

function aiEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e): e is Empire => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== g.playerEmpire);
}

function warship(e: Empire): BuiltObject {
    const b = e.builtObjects.find((x) => x != null && !x.hasBeenDestroyed && x.role === BuiltObjectRole.Military);
    if (b === undefined) throw new Error('no warship');
    return b;
}

function colonyShips(g: Galaxy): BuiltObject[] {
    return g.builtObjects.filter((b): b is BuiltObject => b != null && !b.hasBeenDestroyed && b.empire === g.independentEmpire && b.subRole === BuiltObjectSubRole.ColonyShip);
}

describe('19k-2 independents as actors', () => {
    it('(a) every independent colony fields a Defend-posture militia from the independent designs; no colony ships', () => {
        const g = shared.galaxy;
        const acts = active(g);
        expect(acts.length).toBeGreaterThan(3);
        for (const a of acts) {
            expect(a.fleet.length).toBe(militiaTarget(g, a));
            expect(a.fleet.length).toBeGreaterThan(0);
            for (const b of a.fleet) {
                expect(b.empire).toBe(g.independentEmpire);
                expect([BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate]).toContain(b.subRole);
                expect(g.independentEmpire!.designs).toContain(b.design);
            }
            expect(a.group).not.toBeNull();
            expect(a.group!.posture).toBe(FleetPosture.Defend);
            expect(a.group!.gatherPoint).toBe(a.colony);
            expect(a.group!.ships.length).toBe(a.fleet.length);
        }
        expect(colonyShips(g)).toEqual([]);
    });

    it('(b) the construction ship flies to a site (home system or unclaimed within the radius) and places a mining station', () => {
        const g = shared.galaxy;
        let placed = 0;
        for (const a of active(g)) {
            if (a.builder === null || stationQuota(g, a) === 0) continue;
            runConstruction(g, a);
            const site = a.jobHabitat;
            if (site === null) continue;
            expect(site.empire).toBeNull();
            expect(site.systemIndex === a.colony.systemIndex || g.calculateDistance(site.xpos, site.ypos, a.colony.xpos, a.colony.ypos) <= 3 * SECTOR_SIZE + 1).toBe(true);
            expect(builtObjectMission(a.builder.mission)?.type).toBe(BuiltObjectMissionType.Move);
            a.builder.xpos = site.xpos;
            a.builder.ypos = site.ypos;
            runConstruction(g, a);
            expect(a.stations.length).toBe(1);
            const st = a.stations[0];
            expect(st.parentHabitat).toBe(site);
            expect(st.empire).toBe(g.independentEmpire);
            expect([BuiltObjectSubRole.MiningStation, BuiltObjectSubRole.GasMiningStation]).toContain(st.subRole);
            expect(site.empire).toBeNull(); // a station, never a colony
            placed++;
            if (placed >= 3) break;
        }
        expect(placed).toBeGreaterThan(0);
        expect(colonyShips(g)).toEqual([]);
    });

    it('(c) the ported freighters are still there; (d) the militia and construction ship are rebuilt when they die', () => {
        const g = shared.galaxy;
        const freighters = g.independentEmpire!.privateBuiltObjects.filter((b) => b != null && b.role === BuiltObjectRole.Freight);
        expect(freighters.length).toBeGreaterThan(0);
        const a = active(g).find((x) => x.fleet.length > 0)!;
        const n = a.fleet.length;
        builtObjectCompleteTeardown(g, a.fleet[0]);
        const st = independentsState(g);
        const before = st.stats.militiaRefreshed;
        expect(refreshMilitia(g, a, true)).toBe(1);
        expect(a.fleet.filter((b) => !b.hasBeenDestroyed).length).toBe(n);
        expect(st.stats.militiaRefreshed).toBe(before + 1);
        // Through the tick: an overdue refresh rebuilds the dead ship.
        builtObjectCompleteTeardown(g, a.fleet[a.fleet.length - 1]);
        st.lastMilitia = -1e12;
        independentsTick(g);
        expect(a.fleet.filter((b) => !b.hasBeenDestroyed).length).toBe(n);
    });

    it('friction: a claimed station raises the hook and a decision (player: buy out; AI: rule)', () => {
        const g = shared.galaxy;
        const seen: string[] = [];
        const off = registerIndependentStationFriction((_g, owner, e, s) => seen.push(`${owner.name}:${e.name}:${s.name}`));
        const withStation = active(g).filter((a) => a.stations.length > 0);
        expect(withStation.length).toBeGreaterThan(0);
        const a = withStation[0];
        const station = a.stations[0];
        const player = g.playerEmpire!;
        player.stateMoney = 1e9;
        const rec = raiseStationFriction(g, a, station, player);
        expect(seen.length).toBe(1);
        const d = pendingScenarioDecisions(g, player).find((x) => x.kind === 'independents.friction')!;
        expect(d.options.map((o) => o.id)).toEqual(['buyout', 'tolerate', 'clear']);
        answerScenarioDecision(g, d.id, 'buyout');
        expect(rec.status).toBe('buyout');
        expect(station.empire).toBe(player);
        // AI: its conquest of an independent colony claims the system of a home-system station → friction, answered at once.
        const home = active(g).find((x) => x.stations.some((s) => s.empire === g.independentEmpire && s.parentHabitat?.systemIndex === x.colony.systemIndex));
        if (home !== undefined) {
            const ai = aiEmpires(g)[0];
            takeOwnershipOfColonyFull(g, g.independentEmpire!, home.colony, ai, false, false);
            const n = checkStationFriction(g);
            expect(n).toBeGreaterThan(0);
            const r = independentsState(g).friction[independentsState(g).friction.length - 1];
            expect(r.empireId).toBe(ai.empireId);
            expect(r.status).not.toBe('pending');
            expect(home.status).toBe('lost');
        }
        off();
    });
});

describe('19k-3 independent leagues', () => {
    let l1: IndependentLeague;

    it('forms under a forced threat (raids), with a council seat, flag and colour', () => {
        const g = shared.galaxy;
        const pair = isolated(g).slice(0, 2);
        const raider = warship(aiEmpires(g)[0]);
        for (const a of pair) scenarioEmit(g, 'habitatAttacked', { habitat: a.colony, attacker: raider, attackingEmpire: raider.empire, bombarded: false });
        expect(pair.every((a) => a.raids.length > 0)).toBe(true);
        const formed = reviewLeagueFormation(g);
        const l = formed.find((x) => pair.every((a) => x.members.includes(a.colony)));
        expect(l).toBeDefined();
        l1 = l!;
        expect(l1.members).toContain(l1.founder);
        expect(l1.name).toContain(l1.founder.name);
        expect(l1.colour).toBeGreaterThanOrEqual(0);
        for (const m of l1.members) expect(leagueOf(g, m)).toBe(l1);
    });

    it('pooled defence: the fleet cap rises and every member answers a raid on one member', () => {
        const g = shared.galaxy;
        const members = l1.members.map((m) => independentsState(g).actors.find((a) => a.colony === m)!);
        for (const a of members) {
            refreshMilitia(g, a, true);
            expect(militiaTarget(g, a)).toBeGreaterThanOrEqual(2);
            expect(a.fleet.length).toBe(militiaTarget(g, a));
        }
        const raider = warship(aiEmpires(g)[1] ?? aiEmpires(g)[0]);
        for (const a of members) for (const r of a.raids) r.answered = true;
        scenarioEmit(g, 'habitatAttacked', { habitat: members[0].colony, attacker: raider, attackingEmpire: raider.empire, bombarded: false });
        expect(answerRaids(g)).toBe(members.length);
        for (const a of members) {
            expect(a.group!.mission?.type).toBe(BuiltObjectMissionType.Attack);
        }
    });

    it('exactly one extra colony: one colony ship, the world joins the league, never a second ship', () => {
        const g = shared.galaxy;
        independentsTick(g);
        expect(l1.extraSent).toBe(true);
        const ship = l1.colonyShip!;
        expect(ship.subRole).toBe(BuiltObjectSubRole.ColonyShip);
        expect(colonyShips(g)).toEqual([ship]);
        const target = l1.colonyTarget!;
        ship.xpos = target.xpos;
        ship.ypos = target.ypos;
        expect(runLeagueColonyShip(g, l1)).toBe(target);
        expect(target.empire).toBe(g.independentEmpire);
        expect(l1.members).toContain(target);
        expect(l1.extraColony).toBe(target);
        for (let i = 0; i < 3; i++) {
            independentsTick(g);
            independentsYear(g, 0);
        }
        expect(colonyShips(g)).toEqual([]);
        expect(independentsState(g).stats.extraColonies).toBe(1);
    });

    it('dissolution: a conquered member dissolves the league; the extra colony stays independent', () => {
        const g = shared.galaxy;
        const victim = l1.members.find((m) => m !== l1.extraColony && m !== l1.founder) ?? l1.founder;
        takeOwnershipOfColonyFull(g, g.independentEmpire!, victim, aiEmpires(g)[0], false, false);
        expect(l1.status).toBe('dissolved');
        expect(l1.extraColony!.empire).toBe(g.independentEmpire);
        for (const m of l1.members) expect(leagueOf(g, m)).toBeNull();
    });

    it('bloc diplomacy: an accepted protectorate pulls the members along, or splits the league when they refuse', () => {
        const g = shared.galaxy;
        const free = isolated(g);
        expect(free.length).toBeGreaterThanOrEqual(4);
        const e = aiEmpires(g)[0];
        const la = formLeague(g, [free[0].colony, free[1].colony])!;
        const lb = formLeague(g, [free[2].colony, free[3].colony])!;
        // Refused below the acceptance standing.
        expect(offerToLeague(g, la, e, 'protectorate')).toBe('refused');
        la.standing[e.empireId] = 50;
        g.scenario!.params.independentLeaguesPullChance = 1;
        expect(offerToLeague(g, la, e, 'protectorate')).toBe('accepted');
        const prot = free[0].colony.empire!;
        expect(prot).not.toBe(g.independentEmpire);
        expect(free[1].colony.empire).toBe(prot);
        expect(obtainDiplomaticRelation(e, prot).type).toBe(DiplomaticRelationType.Protectorate);
        expect(la.status).toBe('joined');
        // Split: the council joins, the other member refuses and stays independent.
        lb.standing[e.empireId] = 50;
        g.scenario!.params.independentLeaguesPullChance = 0;
        expect(offerToLeague(g, lb, e, 'protectorate')).toBe('split');
        expect(free[2].colony.empire).not.toBe(g.independentEmpire);
        expect(free[3].colony.empire).toBe(g.independentEmpire);
        expect(leagueOf(g, free[3].colony)).toBeNull();
        expect(offerToLeague(g, lb, e, 'trade')).toBe('refused'); // the league is gone
    });
});

describe('19k with the rim herders (19j)', () => {
    it('herder colonies field tamed ships; a herder league pools its herds (shared docile flags)', () => {
        const g = createScenarioGame(base, { scenario: 'independents-active', flags: { rimHerders: true, rimFauna: true }, params: { ...PARAMS, rimHerdersShare: 1 } }).game.galaxy;
        const herders = rimHerdersState(g).colonies.filter((c) => c.status === 'free');
        expect(herders.length).toBeGreaterThan(0);
        const tamed = rimHerdersState(g).tamed;
        for (const hc of herders) {
            const a = independentsState(g).actors.find((x) => x.colony === hc.colony)!;
            for (const b of a.fleet) expect(tamed).toContain(b);
            if (a.builder !== null) expect(isTamedCreatureShip(g, a.builder)).toBe(true);
        }
        const withHerds = herders.filter((hc) => herderColonyHerds(g, hc).length > 0);
        if (withHerds.length >= 2) {
            const h0 = herderColonyHerds(g, withHerds[0])[0];
            h0.docileEmpireIds.push(987654);
            const l = formLeague(g, [withHerds[0].colony, withHerds[1].colony])!;
            expect(l).not.toBeNull();
            for (const h of herderColonyHerds(g, withHerds[1])) expect(h.docileEmpireIds).toContain(987654);
        }
    }, 600000);
});

function saveText(game: Game): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'independents-active', flags: {}, params: PARAMS } });
}

describe('19k independents — flags off, save', () => {
    it('flags off: no package code runs (the same run as the overlay without the flags)', () => {
        const off = createScenarioGame(base, { scenario: 'independents-active', flags: { independentActors: false, independentLeagues: false } }).game;
        const full = loadScenarioOverlayFs('independents-active');
        const noFlag: ScenarioOverlay = { ...full, manifest: { ...full.manifest, flags: full.manifest.flags.filter((f) => f.name !== 'independentActors' && f.name !== 'independentLeagues') } };
        const ref = createScenarioGame(base, { scenario: noFlag }).game;
        runGameSeconds(off.galaxy, 60);
        runGameSeconds(ref.galaxy, 60);
        expect('independents' in off.galaxy.scenario!.state).toBe(false);
        expect(stateDigest(off.galaxy)).toBe(stateDigest(ref.galaxy));
        expect(stateCounts(off.galaxy)).toEqual(stateCounts(ref.galaxy));
        expect(off.galaxy.rnd.drawCount).toBe(ref.galaxy.rnd.drawCount);
    }, 600000);

    it('a save mid-league resumes identically', () => {
        const g = shared.galaxy;
        const free = isolated(g);
        const l = formLeague(g, free.slice(0, 2).map((a) => a.colony))!;
        l.standing[aiEmpires(g)[0].empireId] = 12;
        const text = saveText(shared);
        const loaded = deserializeGame(text, scenarioGameData(base, 'independents-active')).game;
        const summary = (x: Galaxy): string => {
            const st = independentsState(x);
            return JSON.stringify([
                st.stats,
                st.leagues.map((y) => [y.id, y.name, y.status, y.members.map((m) => m.name), y.extraSent, y.standing]),
                st.actors.map((a) => [a.colony.name, a.status, a.leagueId, a.fleet.length, a.stations.length, a.group?.ships.length ?? -1]),
                st.friction.map((f) => [f.station.name, f.status]),
            ]);
        };
        expect(summary(loaded.galaxy)).toBe(summary(g));
        expect(leagueOf(loaded.galaxy, loaded.galaxy.habitats[g.habitats.indexOf(l.members[0])])?.id).toBe(l.id);
        runGameSeconds(g, 60);
        runGameSeconds(loaded.galaxy, 60);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(g));
        expect(summary(loaded.galaxy)).toBe(summary(g));
    }, 600000);
});
