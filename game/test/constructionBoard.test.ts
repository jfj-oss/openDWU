// The player's construction job board (src/sim/player/constructionBoard.ts): jobs are spread over the construction
// ships by estimated finish time, idle ships pull open jobs, invalid jobs are dropped, the board survives save / load,
// and AI empires never get one.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Design } from '../src/sim/design';
import { HabitatCategoryType, type Habitat } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission, COORD_UNSET_DOUBLE } from '../src/sim/missions/mission';
import { assignQueuedMission, clearPreviousMissionRequirements } from '../src/sim/missions/assign';
import { isAiControlled } from '../src/sim/missions/playerOrder';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { commandLog } from '../src/sim/player/commandLog';
import { addConstructionJob, boardShipEligible, constructionBoardOf, constructionJobRows, jobInvalidReason, processConstructionBoard, type ConstructionJob } from '../src/sim/player/constructionBoard';
import { createMissionShipActionAt } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { runGameSeconds } from '../src/sim/tick/harness';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function constructionShips(game: Game): BuiltObject[] {
    const p = game.playerEmpire;
    return (p.constructionShips as BuiltObject[]).filter((s) => boardShipEligible(p, s));
}

/** Make the ship idle (as if its AI work were done). */
function makeIdle(game: Game, ship: BuiltObject): void {
    clearPreviousMissionRequirements(game.galaxy, ship, true);
    ship.subsequentMissions.length = 0;
    ship.revertMission = null;
}

function miningDesign(game: Game, h: Habitat): Design {
    const sub = h.category === HabitatCategoryType.GasCloud ? BuiltObjectSubRole.GasMiningStation : BuiltObjectSubRole.MiningStation;
    const d = game.playerEmpire.designs.find((x) => x.subRole === sub && !x.isObsolete);
    expect(d).toBeDefined();
    return d!;
}

/** Up to `n` mining sites the player may build at, nearest to (x, y) first. */
function miningSites(game: Game, n: number, x: number, y: number): Habitat[] {
    const g = game.galaxy;
    const p = game.playerEmpire;
    const out: Habitat[] = [];
    const all = g.habitats.filter((h) => h.category !== HabitatCategoryType.Star && h.resources.length > 0);
    all.sort((a, b) => Math.hypot(a.xpos - x, a.ypos - y) - Math.hypot(b.xpos - x, b.ypos - y));
    for (const h of all) {
        const job = { id: 0, design: miningDesign(game, h), habitat: h, x: COORD_UNSET_DOUBLE, y: COORD_UNSET_DOUBLE, ship: null, active: false, basesAtStart: 0, attempts: 0 } as ConstructionJob;
        if (jobInvalidReason(g, p, job) === null && !(p.constructionShips as BuiltObject[]).some((s) => builtObjectMission(s.mission)?.targetHabitat === h)) out.push(h);
        if (out.length >= n) break;
    }
    expect(out.length).toBe(n);
    return out;
}

function addJob(game: Game, h: Habitat): number {
    return runPlayerCommand(game.galaxy, game.playerEmpire, 'constructionJobAdd', [miningDesign(game, h), h, COORD_UNSET_DOUBLE, COORD_UNSET_DOUBLE]);
}

describe('construction job board', () => {
    it('spreads jobs near ship A over ships A and B by estimated finish, at most current + next per ship', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const ships = constructionShips(game);
        expect(ships.length).toBeGreaterThanOrEqual(2);
        const [a, b] = ships;
        for (const s of ships) makeIdle(game, s);
        // Ship B starts far from the sites (only the estimates read the position).
        b.xpos += 300000;
        const sites = miningSites(game, 5, a.xpos, a.ypos);
        for (const h of sites) expect(addJob(game, h)).toBeGreaterThan(0);
        // Every add went through the command log, replayably.
        const log = commandLog(g).filter((e) => e.source === 'player' && e.op === 'constructionJobAdd');
        expect(log.length).toBe(5);
        for (const e of log) expect((e as { error?: string }).error).toBeUndefined();
        const board = constructionBoardOf(game.playerEmpire);
        const byShip = (s: BuiltObject): ConstructionJob[] => board.jobs.filter((j) => j.ship === s);
        expect(byShip(a).length).toBeGreaterThan(0);
        expect(byShip(b).length).toBeGreaterThan(0); // not all on the nearest ship
        for (const s of ships) {
            expect(byShip(s).length).toBeLessThanOrEqual(2);
            expect(byShip(s).filter((j) => j.active).length).toBeLessThanOrEqual(1);
        }
        // The first job goes to the near ship and runs now, as a player order that keeps the ship automated.
        expect(board.jobs[0].ship).toBe(a);
        expect(board.jobs[0].active).toBe(true);
        const m = builtObjectMission(a.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.Build);
        expect(m.targetHabitat).toBe(sites[0]);
        expect(m.playerOrdered).toBe(true);
        expect(a.isAutoControlled).toBe(true);
        expect(isAiControlled(a)).toBe(false);
        // With 2 ships and 5 jobs, one stays open; ships never carry board jobs in their own mission queue.
        expect(board.jobs.filter((j) => j.ship === null).length).toBe(Math.max(0, 5 - 2 * ships.length));
        for (const s of ships) expect(s.subsequentMissions.length).toBe(0);
        const rows = constructionJobRows(g, game.playerEmpire);
        expect(rows.length).toBe(5);
        for (const r of rows) if (r.state !== 'open') expect(r.etaMs).not.toBeNull();
    }, 300000);

    it('a ship that finishes pulls its next job, and an idle ship pulls the best open job', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const ships = constructionShips(game);
        for (const s of ships) makeIdle(game, s);
        const [a] = ships;
        const sites = miningSites(game, 5, a.xpos, a.ypos);
        for (const h of sites) addJob(game, h);
        const board = constructionBoardOf(game.playerEmpire);
        const open = board.jobs.find((j) => j.ship === null)!;
        expect(open).toBeDefined();
        const next = board.jobs.find((j) => j.ship === a && !j.active)!;
        expect(next).toBeDefined();
        // A's current job ends (here: abandoned before it built anything): the next one starts at once.
        clearPreviousMissionRequirements(g, a, true);
        expect(assignQueuedMission(g, a)).toBe(true);
        expect(next.active).toBe(true);
        expect(builtObjectMission(a.mission)!.targetHabitat).toBe(next.habitat);
        // The abandoned job went back on the board (nothing was built), and A's free next slot is filled from the open
        // jobs (board order first: that reopened job) at the next frame boundary.
        expect(board.jobs.filter((j) => j.ship === null).length).toBe(2);
        expect(board.jobs.find((j) => j.ship === null)!.attempts).toBe(1);
        processConstructionBoard(g);
        expect(board.jobs.some((j) => j.ship === a && !j.active)).toBe(true);
        expect(board.jobs.filter((j) => j.ship === null).length).toBe(1);
        void open;
        // A brand-new idle ship (here: one emptied of its board work) pulls an open job itself.
        const b = ships[1];
        const bJobs = board.jobs.filter((j) => j.ship === b);
        for (const j of bJobs) board.jobs.splice(board.jobs.indexOf(j), 1);
        makeIdle(game, b);
        const extra = miningSites(game, 1, b.xpos + 1, b.ypos)[0];
        board.jobs.push({ id: board.nextId++, design: miningDesign(game, extra), habitat: extra, x: COORD_UNSET_DOUBLE, y: COORD_UNSET_DOUBLE, ship: null, active: false, basesAtStart: 0, attempts: 0 });
        expect(assignQueuedMission(g, b)).toBe(true);
        expect(board.jobs.some((j) => j.ship === b && j.active)).toBe(true);
    }, 300000);

    it('the board keeps working in the running sim and finishes jobs', () => {
        const game = cachedTickGame(gameData);
        const ships = constructionShips(game);
        for (const s of ships) makeIdle(game, s);
        const sites = miningSites(game, 3, ships[0].xpos, ships[0].ypos);
        for (const h of sites) addJob(game, h);
        const board = constructionBoardOf(game.playerEmpire);
        let t = 0;
        while (t < 900 && board.jobs.length > 0) {
            runGameSeconds(game, 10);
            t += 10;
            // Board ships keep their own automation and are never retasked by the AI mid-job.
            for (const j of board.jobs) {
                if (j.active && j.ship !== null) {
                    expect(j.ship.isAutoControlled).toBe(true);
                    const m = builtObjectMission(j.ship.mission);
                    const r = j.ship.revertMission;
                    expect(m?.type === BuiltObjectMissionType.Build || r?.type === BuiltObjectMissionType.Build).toBe(true);
                }
            }
        }
        expect(board.jobs.length).toBeLessThan(3);
        const built = sites.filter((h) => h.basesAtHabitat.some((b) => b.empire === game.playerEmpire));
        expect(built.length).toBeGreaterThan(0);
    }, 600000);

    it('drops a job whose target became invalid, with a message', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ships = constructionShips(game);
        for (const s of ships) makeIdle(game, s);
        const sites = miningSites(game, 5, ships[0].xpos, ships[0].ypos);
        for (const h of sites) addJob(game, h);
        const board = constructionBoardOf(p);
        const open = board.jobs.find((j) => j.ship === null)!;
        const h = open.habitat!;
        const before = (p.messages as { description: string }[]).length;
        h.hasBeenDestroyed = true;
        board.dirty = true;
        processConstructionBoard(g);
        h.hasBeenDestroyed = false;
        expect(board.jobs.includes(open)).toBe(false);
        const msgs = (p.messages as { description: string }[]).slice(before).map((m) => m.description);
        expect(msgs.some((d) => d.startsWith('Construction job cancelled') && d.includes(h.name))).toBe(true);
        // Cancel and move up are player commands too.
        const last = board.jobs[board.jobs.length - 1];
        expect(runPlayerCommand(g, p, 'constructionJobMoveUp', [last.id])).toBe(true);
        expect(board.jobs[board.jobs.length - 2]).toBe(last);
        expect(runPlayerCommand(g, p, 'constructionJobCancel', [last.id])).toBe(true);
        expect(board.jobs.includes(last)).toBe(false);
    }, 300000);

    it('a shift-queued build for a busy ship becomes its next board job, further ones go to the board', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ships = constructionShips(game);
        const a = ships[0];
        makeIdle(game, a);
        const sites = miningSites(game, 3, a.xpos, a.ypos);
        const order = (h: Habitat, shift: boolean) => {
            const act = createMissionShipActionAt(BuiltObjectMissionType.Build, h, Math.trunc(h.xpos), Math.trunc(h.ypos));
            act.design = miningDesign(game, h);
            act.isSubsequentAction = shift;
            return executeShipAction(g, p, a, act, true);
        };
        expect(order(sites[0], false).ok).toBe(true); // idle ship: takes it directly
        expect(builtObjectMission(a.mission)!.targetHabitat).toBe(sites[0]);
        expect(order(sites[1], true).ok).toBe(true);
        expect(order(sites[2], true).ok).toBe(true);
        expect(a.subsequentMissions.length).toBe(0); // no backlog on the ship
        const board = constructionBoardOf(p);
        expect(board.jobs.find((j) => j.habitat === sites[1])!.ship).toBe(a);
        expect(board.jobs.find((j) => j.habitat === sites[2])!.ship).not.toBe(a);
    }, 300000);

    it('survives save / load (and older saves without a board load empty)', () => {
        const game = cachedTickGame(gameData);
        const ships = constructionShips(game);
        for (const s of ships) makeIdle(game, s);
        const sites = miningSites(game, 4, ships[0].xpos, ships[0].ypos);
        for (const h of sites) addJob(game, h);
        const board = constructionBoardOf(game.playerEmpire);
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(game.galaxy.nowMs);
        const text = serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1 });
        const loaded = deserializeGame(text, gameData).game;
        const b2 = loaded.playerEmpire.constructionBoard!;
        expect(b2).toBeDefined();
        expect(b2.jobs.map((j) => [j.id, j.habitat?.name, j.design.name, j.ship?.name ?? null, j.active])).toEqual(board.jobs.map((j) => [j.id, j.habitat?.name, j.design.name, j.ship?.name ?? null, j.active]));
        expect(b2.jobs[0].habitat).toBe(loaded.galaxy.habitats[sites[0].habitatIndex]);
        expect(loaded.playerEmpire.designs.includes(b2.jobs[0].design)).toBe(true);
        expect((loaded.playerEmpire.constructionShips as BuiltObject[]).includes(b2.jobs[0].ship!)).toBe(true);
        // A game that never used the board has none (old saves: the property is simply absent).
        const fresh = cachedTickGame(gameData);
        expect(fresh.playerEmpire.constructionBoard).toBeUndefined();
        expect(() => processConstructionBoard(fresh.galaxy)).not.toThrow();
    }, 300000);

    it('leaves AI empires alone', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const ai = g.empires.find((e) => e !== game.playerEmpire && e.designs.length > 0 && e.capital !== null)!;
        const h = ai.capital!;
        const d = ai.designs.find((x) => x.subRole === BuiltObjectSubRole.DefensiveBase) ?? ai.designs[0];
        expect(addConstructionJob(g, ai, d, h, COORD_UNSET_DOUBLE, COORD_UNSET_DOUBLE)).toBe(0);
        expect(ai.constructionBoard).toBeUndefined();
        const ships = constructionShips(game);
        for (const s of ships) makeIdle(game, s);
        for (const site of miningSites(game, 2, ships[0].xpos, ships[0].ypos)) addJob(game, site);
        runGameSeconds(game, 20);
        for (const e of g.empires) if (e !== game.playerEmpire) expect(e.constructionBoard).toBeUndefined();
    }, 300000);
});
