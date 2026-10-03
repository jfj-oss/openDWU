// The UI's sim writes outside the journaled command queue (docs/sim-worker.md §8): the paths that wrote the game, or drew
// galaxy.rnd, from a UI read now either write nothing (a read-only UI read, sim/readOnlyQuery.ts) or are journaled
// commands (player/playerOps.ts) that seed + log replays.
// - (b) the money panel: Main.Part11.cs 841 CheckAgeVariableIncome is the journaled 'moneyPanel' command, issued when a
//   write is due (treasury.ts moneyPanelWriteDue); the panel's read and the Build Order's cashflow write nothing.
// - (c) the local-model briefs / digests (llm/replicaReads.ts readReplica): side-effect-free, also where the C# getter
//   ThisYearsSpacePortIncome ages a base on every read.
// - (a) the order menus and button pages: the pages that draw galaxy.rnd are commands (test/simWorkerOrders.test.ts
//   replays them and compares them with worker mode); every other page, the hover hint and the right-click's local
//   outcomes write nothing.
// - The records the C# UI's lookups add (Obtain*): requested by the read, added by one journaled 'obtainUiRecords'.
// Each: reading twice leaves the save text (every object, the side tables, galaxy.rnd's state) unchanged, or a replay of
// the log reproduces the game; in worker mode the same script gives the in-thread log and digest.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { empireOn, expectSameGame, inThread, inWorker, normalAis, type Side } from './helpers/simWorkerSides';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import { stateDigest } from '../src/sim/tick/digest';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from '../src/sim/tick/simTime';
import { commandLog, type CommandLogEntry } from '../src/sim/player/commandLog';
import { flushPlayerCommands, issuePlayerCommand, runScheduledUntil, scheduleCommandLog } from '../src/sim/player/playerCommands';
import { moneyPanelIncome, moneyPanelWriteDue, thisYearsSpacePortIncome } from '../src/sim/treasury';
import { isReadOnlyGalaxy, markUiGalaxy } from '../src/sim/readOnlyQuery';
import { readReplica } from '../src/llm/replicaReads';
import { buildAdvisorBrief } from '../src/sim/player/advisorBrief';
import { buildStrategicBrief, listStrategicOptions } from '../src/sim/player/strategicBrief';
import { buildDiplomatBrief } from '../src/sim/player/diplomatBrief';
import { groundDiplomatBrief } from '../src/sim/player/diplomatGrounding';
import { digestFor } from '../src/sim/scenario/llm/digest';
import { legalMoves } from '../src/sim/scenario/llm/strategic';
import { buildOrderMenu } from '../src/sim/scenario/llm/orderMenu';
import { retrieveArchive } from '../src/sim/scenario/llm/archive';
import { listProposals } from '../src/sim/player/diplomacyProposals';
import { calculatePirateProtectionPricePerMonth } from '../src/sim/pirates/pirateRelationsAI';
import { resolveHoverOrder, rightClickOrder, selectionButtons, selectionButtonsDrawRandom } from '../src/sim/player/orderMenu';
import { ShipActionType, createShipAction } from '../src/sim/player/shipAction';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { HabitatCategoryType } from '../src/sim/types';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const saveText = (g: Galaxy): string => JSON.stringify(galaxyToJSON(g));
const playerOps = (g: Galaxy): string[] => commandLog(g).filter((e) => e.source === 'player').map((e) => (e as { op: string }).op);
const copyLog = (g: Galaxy): CommandLogEntry[] => commandLog(g).map((e) => JSON.parse(JSON.stringify(e)) as CommandLogEntry);
const flushUiTask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** `game` (a fresh copy of the harness game at 0 ms) replayed from its own start with `log` up to `untilMs`. */
function replayOnto(game: Game, log: readonly CommandLogEntry[], untilMs: number): Game {
    scheduleCommandLog(game.galaxy, log);
    runScheduledUntil(game.galaxy, untilMs);
    return game;
}

/** An AI empire with a space port that has earned nothing this year: reading its income ages the base (Empire.cs 2282). */
function agingAi(g: Galaxy): Empire {
    const ai = normalAis(g).find((e) => !e.useAveragedVariableIncome && e.spacePorts.length > 0);
    expect(ai).toBeDefined();
    const year = galaxyStarDate(g) - (galaxyStarDate(g) % (REAL_SECONDS_IN_GALACTIC_YEAR * 1000));
    expect(ai!.spacePorts.some((b) => b.dateOfLastIncome < year)).toBe(true);
    return ai!;
}

describe('(b) the money panel', () => {
    it('in-thread: the read writes nothing; the due ageing is the journaled moneyPanel command; seed + log replays it', async () => {
        const game = cachedTickGame(gameData);
        const a = inThread(game);
        const g = game.galaxy;
        const p = game.playerEmpire;
        expect(isReadOnlyGalaxy(g)).toBe(true); // the UI galaxy, between frames
        // A new game: CheckAgeVariableIncome has not run (UseAveragedVariableIncome off), so a refresh would write.
        expect(p.useAveragedVariableIncome).toBe(false);
        expect(moneyPanelWriteDue(g, p)).toBe(true);
        const s0 = saveText(g);
        const r1 = moneyPanelIncome(g, p);
        const r2 = moneyPanelIncome(g, p);
        expect(r2).toEqual(r1);
        expect(saveText(g) === s0).toBe(true);
        // The HUD's refresh: the command, applied at the next boundary (here: now, between frames, as a save does).
        let shown: unknown = null;
        issuePlayerCommand(g, p, 'moneyPanel', [], (r) => (shown = r));
        flushPlayerCommands(g);
        expect(shown).not.toBeNull();
        expect(p.useAveragedVariableIncome).toBe(true);
        expect(moneyPanelWriteDue(g, p)).toBe(false);
        // Nothing due: the read gives the command's figures and writes nothing.
        const s1 = saveText(g);
        expect(moneyPanelIncome(g, p)).toEqual(shown);
        moneyPanelIncome(g, p);
        expect(saveText(g) === s1).toBe(true);
        for (let i = 0; i < 30; i++) a.tick();
        const log = copyLog(g);
        expect(playerOps(g)).toEqual(['moneyPanel']);
        const replay = replayOnto(cachedTickGame(gameData), log, g.nowMs);
        expect(stateDigest(replay.galaxy)).toBe(stateDigest(g));
        expect(saveText(replay.galaxy) === saveText(g)).toBe(true);
        await flushUiTask();
    }, 600000);

    it('a new galactic year: the ageing is the command again, the replay ages the same; the old unjournaled write drifts', () => {
        const setup = (game: Game): void => {
            // The player's last ageing a year ago (as after a year of play), set the same on every copy before the run.
            const p = game.playerEmpire;
            p.useAveragedVariableIncome = true;
            p.lastVariableIncomeUpdate = galaxyStarDate(game.galaxy) - REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
            p.variableIncome = [1000, 500];
            for (const b of p.spacePorts) b.currentYearsIncome = 777;
        };
        const game = cachedTickGame(gameData);
        setup(game);
        const a = inThread(game);
        const g = game.galaxy;
        const p = game.playerEmpire;
        expect(moneyPanelWriteDue(g, p)).toBe(true);
        const s0 = saveText(g);
        moneyPanelIncome(g, p);
        moneyPanelIncome(g, p);
        expect(saveText(g) === s0).toBe(true);
        for (let i = 0; i < 5; i++) a.tick();
        issuePlayerCommand(g, p, 'moneyPanel', []);
        for (let i = 0; i < 20; i++) a.tick();
        expect(p.variableIncome!.length).toBe(3);
        expect(moneyPanelWriteDue(g, p)).toBe(false);
        const log = copyLog(g);
        const again = cachedTickGame(gameData);
        setup(again);
        replayOnto(again, log, g.nowMs);
        expect(saveText(again.galaxy) === saveText(g)).toBe(true);
        // Sensitivity: the same refresh written directly from a UI timer (an unmarked galaxy, no command) is not in the
        // log, and the replay no longer gives the game.
        const old = cachedTickGame(gameData);
        setup(old);
        const o = inThread(old);
        markUiGalaxy(old.galaxy, false);
        for (let i = 0; i < 5; i++) o.tick();
        moneyPanelIncome(old.galaxy, old.playerEmpire);
        for (let i = 0; i < 20; i++) o.tick();
        const oldReplay = cachedTickGame(gameData);
        setup(oldReplay);
        replayOnto(oldReplay, copyLog(old.galaxy), old.galaxy.nowMs);
        expect(saveText(oldReplay.galaxy) === saveText(old.galaxy)).toBe(false);
    }, 600000);

    it('worker mode: the panel\'s command gives the in-thread log and digest', () => {
        const sides: Side[] = [inThread(cachedTickGame(gameData)), inWorker(cachedTickGame(gameData), gameData)];
        const shown = new Map<Side, unknown>();
        for (const s of sides) {
            s.settle();
            expect(moneyPanelWriteDue(s.galaxy, s.player)).toBe(true);
            issuePlayerCommand(s.galaxy, s.player, 'moneyPanel', [], (r) => shown.set(s, r));
        }
        for (let i = 0; i < 10; i++) for (const s of sides) s.tick();
        expect(shown.get(sides[1])).toEqual(shown.get(sides[0]));
        for (const s of sides) {
            s.settle();
            expect(moneyPanelWriteDue(s.galaxy, s.player)).toBe(false);
        }
        expectSameGame(sides[0], sides[1]);
        expect((sides[1] as ReturnType<typeof inWorker>).replicaWrites()).toEqual([]);
        sides[1].dispose();
    }, 600000);
});

describe('(c) the local-model briefs and digests', () => {
    it('readReplica: every brief builder, read twice, leaves the game unchanged (also the income a read would age)', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ai = agingAi(g);
        const s0 = saveText(g);
        const income = readReplica(g, () => thisYearsSpacePortIncome(g, ai));
        for (let round = 0; round < 2; round++) {
            readReplica(g, () => buildAdvisorBrief(g, p, p.capital));
            readReplica(g, () => buildAdvisorBrief(g, p, empireShipGroups(p)[0] ?? null));
            for (const e of normalAis(g)) {
                readReplica(g, () => buildStrategicBrief(g, e));
                readReplica(g, () => listStrategicOptions(g, e));
                readReplica(g, () => legalMoves(g, e));
                readReplica(g, () => digestFor(g, e));
                readReplica(g, () => digestFor(g, e, p));
                readReplica(g, () => groundDiplomatBrief(g, buildDiplomatBrief(g, e, p, { kind: 'proposal', optionId: 'x', label: 'Trade', accepted: false, reply: null, original: 'No.' }), e, p));
            }
            readReplica(g, () => digestFor(g, p));
            readReplica(g, () => buildOrderMenu(g, p, p.capital));
            readReplica(g, () => retrieveArchive(g, p, 'what happened to our space ports?'));
            expect(readReplica(g, () => thisYearsSpacePortIncome(g, ai))).toBe(income);
        }
        expect(saveText(g) === s0).toBe(true);
        // Sensitivity: the same reads outside readReplica (sim code) age the AI's space ports, on every read.
        const years = ai.spacePorts.map((b) => b.consecutiveUnprofitableYears);
        expect(thisYearsSpacePortIncome(g, ai)).toBe(income);
        buildStrategicBrief(g, ai);
        expect(ai.spacePorts.map((b) => b.consecutiveUnprofitableYears)).not.toEqual(years);
    }, 600000);

    it('in worker mode the same reads on the replica write nothing either', () => {
        const w = inWorker(cachedTickGame(gameData), gameData);
        w.settle();
        const g = w.galaxy;
        const p = w.player;
        const ai = agingAi(g);
        readReplica(g, () => buildStrategicBrief(g, ai));
        readReplica(g, () => digestFor(g, ai, p));
        readReplica(g, () => buildAdvisorBrief(g, p, p.capital));
        readReplica(g, () => legalMoves(g, ai));
        expect(w.replicaWrites()).toEqual([]);
        w.dispose();
    }, 600000);
});

describe('(a) the order menus and button pages: the pages that do not draw write nothing', () => {
    it('in-thread: the non-drawing pages, the hover hint and the right-click\'s local outcomes, read twice, change nothing', async () => {
        const game = cachedTickGame(gameData);
        inThread(game);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const cap = p.capital!;
        const ships = p.builtObjects.filter((b) => b.builtAt === null).slice(0, 8);
        const fleet = empireShipGroups(p)[0] ?? null;
        const foreign = g.habitats.filter((h) => h.empire !== null && h.empire !== p && h.empire !== g.independentEmpire).slice(0, 5);
        const unowned = g.systems[cap.systemIndex].habitats.filter((h) => h.empire === null && h.category !== HabitatCategoryType.Star);
        const s0 = saveText(g);
        for (let round = 0; round < 2; round++) {
            for (const sel of [cap, ...ships, fleet, ...foreign, ships.slice(0, 3), null]) {
                for (const page of [null, createShipAction(ShipActionType.ColonyBuildWonder, cap), createShipAction(ShipActionType.ColonyBuildOptions, cap), createShipAction(ShipActionType.FighterOptions, sel)]) {
                    if (selectionButtonsDrawRandom({ galaxy: g, empire: p, selected: sel }, page)) continue;
                    selectionButtons({ galaxy: g, empire: p, selected: sel }, page);
                }
            }
            for (const s of [null, ...ships, fleet]) {
                for (const t of [null, cap, ...foreign, ...unowned, ...g.builtObjects.slice(0, 10)]) {
                    const x = Math.trunc(t?.xpos ?? 0);
                    const y = Math.trunc(t?.ypos ?? 0);
                    const hover = resolveHoverOrder({ galaxy: g, empire: p, selected: s, x, y, target: t, shift: false, alt: false, ctrl: false });
                    if (hover.action === null || s === null) rightClickOrder(g, p, s, hover.action, { ctrl: false, alt: false }, 1);
                }
            }
        }
        expect(saveText(g) === s0).toBe(true);
        // The drawing pages are exactly the ones selectionButtonsDrawRandom names: building one directly draws.
        const draws = g.rnd.drawCount;
        selectionButtons({ galaxy: g, empire: p, selected: unowned[0] }, null);
        expect(g.rnd.drawCount).toBeGreaterThan(draws);
        await flushUiTask();
    }, 600000);
});

describe('the records the C# UI\'s lookups add', () => {
    it('a UI read requests them; the obtainUiRecords command adds them; seed + log replays the game', async () => {
        const game = cachedTickGame(gameData);
        const a = inThread(game);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const others = [...normalAis(g), ...g.pirateEmpires.filter((e): e is Empire => e !== null)];
        const s0 = saveText(g);
        for (const o of others) {
            listProposals(g, p, o);
            if (o.pirateEmpireBaseHabitat !== null) calculatePirateProtectionPricePerMonth(g, o, p);
        }
        expect(saveText(g) === s0).toBe(true);
        await flushUiTask();
        expect(playerOps(g)).toEqual([]); // issued, not applied yet
        for (let i = 0; i < 10; i++) a.tick();
        expect(playerOps(g)).toEqual(['obtainUiRecords']);
        expect(saveText(g) === s0).toBe(false);
        const replay = replayOnto(cachedTickGame(gameData), copyLog(g), g.nowMs);
        expect(saveText(replay.galaxy) === saveText(g)).toBe(true);
        // Nothing missing any more: reading again asks for nothing.
        for (const o of others) listProposals(g, p, o);
        await flushUiTask();
        a.tick();
        expect(playerOps(g)).toEqual(['obtainUiRecords']);
    }, 600000);

    it('the same in worker mode: the records are added in the worker by the same command (log and digest = in-thread)', async () => {
        const sides: Side[] = [inThread(cachedTickGame(gameData)), inWorker(cachedTickGame(gameData), gameData)];
        for (const s of sides) {
            s.settle();
            for (const o of [...normalAis(s.galaxy), ...s.galaxy.pirateEmpires.filter((e): e is Empire => e !== null)]) {
                const other = empireOn(s, o);
                listProposals(s.galaxy, s.player, other);
                if (other.pirateEmpireBaseHabitat !== null) calculatePirateProtectionPricePerMonth(s.galaxy, other, s.player);
            }
        }
        await flushUiTask();
        for (let i = 0; i < 10; i++) for (const s of sides) s.tick();
        expectSameGame(sides[0], sides[1]);
        expect((sides[1] as ReturnType<typeof inWorker>).replicaWrites()).toEqual([]);
        sides[1].dispose();
    }, 600000);
});
