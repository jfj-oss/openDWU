// War credit in the Galactic Diet (threats/giantworks/beaconWarCredit.ts): the tally from the kill / capture / foundry / refugee hooks, the yearly review (vote
// weight and reputation for the top contributors, a malus for the laggards, the news line), the AI cap factor and the save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { CreateGameOptions, Game } from '../src/sim/game';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH, scenarioEmit, scenarioQuery } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { obtainEmpireEvaluation } from '../src/sim/diplomacy';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/types';
import { beaconComplete, beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { beaconPosition, peekBeaconState, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { designFor, spawnShip, startWar } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { dietLineForTest } from './helpers/beaconWarCreditLine';
import {
    warCreditAiFactor,
    warCreditFoundry,
    warCreditOf,
    warCreditPeople,
    warCreditRanking,
    warCreditRefugees,
    warCreditReview,
    warCreditTotal,
    warCreditVoteFactor,
} from '../src/sim/scenario/threats/giantworks/beaconWarCredit';
import { councilState, type Council } from '../src/sim/scenario/emergent/council';
import { dietOn } from '../src/sim/scenario/charactersVictory/diet/dietState';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks', 'characters-victory'];
const DAY = GAME_DAY_LENGTH;

function war(): { g: Galaxy; st: BeaconState; game: Game; gameData: GameData; me: Empire; others: Empire[] } {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: { charactersVictory: true, cvCouncil: true, galacticCouncil: true }, options: age3 });
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
    const members = g.empires.filter((e): e is Empire => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active && e !== st.faction);
    const cs = councilState(g);
    const c: Council = { id: cs.nextId++, name: 'Interstellar Diet', foundedYear: 0, members: [...members], chair: null, motion: null, results: [], blocs: [], coLosses: {}, losses: {}, sanctions: [], threats: [], recognised: [], condemned: {}, splitFrom: 0 };
    cs.councils.push(c);
    return { g, st, game, gameData, me: g.playerEmpire!, others: members.filter((e) => e !== g.playerEmpire) };
}

describe('war credit in the Galactic Diet', () => {
    it('the tally: warships by strength, capitals, foundries, people freed and refugees saved, to the empire whose ship made the kill', () => {
        const { g, st, me, others } = war();
        expect(dietOn(g)).toBe(true);
        const f = st.faction!;
        const pos = beaconPosition(st)!;
        const cruiser = spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.Cruiser)!, pos.x, pos.y);
        const cap = spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.CapitalShip)!, pos.x, pos.y);
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: cruiser, destroyer: me });
        const rec = warCreditOf(st);
        expect(rec.points[String(me.empireId)].warships).toBeGreaterThan(0);
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: cap, destroyer: others[0] });
        expect(rec.points[String(others[0].empireId)].capitals).toBe(20);
        // no credit for a pirate / the independents / nobody
        const before = JSON.stringify(rec.points);
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.Cruiser)!, pos.x, pos.y), destroyer: null });
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: spawnShip(g, f, designFor(g, f, BuiltObjectSubRole.Cruiser)!, pos.x, pos.y), destroyer: g.independentEmpire });
        expect(JSON.stringify(rec.points)).toBe(before);
        const foundry = st.foundries!.list[0];
        scenarioEmit(g, 'foundryDestroyed', { empire: me, foundry });
        expect(rec.points[String(me.empireId)].foundries).toBe(30);
        warCreditPeople(g, st, me, 4_000_000);
        expect(rec.points[String(me.empireId)].freed).toBeCloseTo(4, 9);
        warCreditRefugees(g, others[1], 6_000_000);
        expect(rec.points[String(others[1].empireId)].refugees).toBeCloseTo(3, 9);
        const rows = warCreditRanking(g, st);
        expect(rows[0].total).toBeGreaterThanOrEqual(rows[1].total);
        expect(rows.reduce((a, r) => a + r.sharePct, 0)).toBeCloseTo(100, 6);
        expect(warCreditTotal(st, me)).toBeGreaterThan(30);
    }, 900000);

    it('nothing is counted before the war, without the Diet, or for the Reclaimers themselves', () => {
        const { g, st, me } = war();
        st.warStarted = false;
        warCreditFoundry(g, st, me);
        expect(st.warCredit).toBeUndefined();
        st.warStarted = true;
        warCreditFoundry(g, st, st.faction);
        expect(warCreditOf(st).points).toEqual({});
        g.scenario!.flags.cvCouncil = false;
        warCreditFoundry(g, st, me);
        expect(warCreditOf(st).points).toEqual({});
    }, 900000);

    it('the yearly review: the top contributors gain vote weight and standing, the laggards lose some, the top is named in the news', () => {
        const { g, st, me, others } = war();
        const rec = warCreditOf(st);
        const [a, b] = [me, others[0]];
        rec.points[String(a.empireId)] = { warships: 100, foundries: 60 };
        rec.points[String(b.empireId)] = { warships: 40 };
        g.scenario!.params.beaconWarCreditSlackMinMilPct = 0;
        // the first pass starts the year; the review comes a year later
        expect(warCreditReview(g, st)).toBe(false);
        expect(rec.lastReview).toBeGreaterThan(0);
        g.nowMs += 200 * DAY;
        expect(warCreditReview(g, st)).toBe(false);
        expect(warCreditVoteFactor(g, a)).toBe(1);
        const evA = obtainEmpireEvaluation(g, b, a).incidentEvaluation;
        g.nowMs += 200 * DAY;
        expect(warCreditReview(g, st)).toBe(true);
        expect(rec.top).toBe(a.empireId);
        expect(rec.effect[String(a.empireId)]).toMatchObject({ why: 'top', rank: 1, votePct: 15 });
        expect(rec.effect[String(b.empireId)]).toMatchObject({ why: 'top', rank: 2, votePct: 10 });
        expect(warCreditVoteFactor(g, a)).toBeCloseTo(1.15, 9);
        expect(scenarioQuery(g, 'dietVoteWeightFactor', 1, { empire: a })).toBeCloseTo(1.15, 9);
        expect(obtainEmpireEvaluation(g, b, a).incidentEvaluation).toBeGreaterThan(evA);
        // laggards: a member with a fleet and no points
        const slackers = Object.entries(rec.effect).filter(([, x]) => x.why === 'slack');
        expect(slackers.length).toBeGreaterThan(0);
        for (const [id, x] of slackers) {
            expect(x.votePct).toBe(-5);
            const e = g.empires.find((y) => y?.empireId === Number(id))!;
            expect(warCreditVoteFactor(g, e)).toBeCloseTo(0.95, 9);
            expect(warCreditAiFactor(g, st, e)).toBeCloseTo(1.25, 9);
            expect(warCreditTotal(st, e)).toBe(0);
        }
        expect(warCreditAiFactor(g, st, a)).toBe(1);
        // the next review replaces the standing (and a year must pass)
        expect(warCreditReview(g, st)).toBe(false);
    }, 900000);

    it('the Diet window line names the leader', () => {
        const { g, st, me } = war();
        expect(dietLineForTest(g)).toMatch(/^No one/);
        warCreditOf(st).points[String(me.empireId)] = { warships: 10 };
        expect(dietLineForTest(g)).toContain(me.name);
    }, 900000);

    it('the record survives a save round trip', () => {
        const { g, st, game, gameData, me } = war();
        const rec = warCreditOf(st);
        rec.points[String(me.empireId)] = { warships: 12.5, cores: 30 };
        rec.effect[String(me.empireId)] = { votePct: 15, why: 'top', rank: 1 };
        rec.lastReview = galaxyStarDate(g);
        rec.top = me.empireId;
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const { game: lgame } = deserializeGame(serializeGame(game, time, {} as StartGameOptions), gameData);
        const lg = lgame.galaxy;
        const lst = peekBeaconState(lg)!;
        expect(lst.warCredit).toEqual(rec);
        expect(warCreditVoteFactor(lg, lg.playerEmpire!)).toBeCloseTo(1.15, 9);
    }, 900000);
});
