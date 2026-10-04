// Battle reports (an Improvement inspired by Distant Worlds 2, not in DW:U; src/sim/battleReports/battleReports.ts): a
// scripted harness battle — the player's escort ordered to Attack an unarmed pirate explorer in empty space (the
// combatScenarios.test.ts (1) staging) — gives exactly one report with the right sides, forces and losses, the same in
// the in-thread and worker modes and across a save / load in the middle of the fight; the observer changes nothing the
// digest hashes, draws no Rnd, and a game that never fought saves the same text as before.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { inThread, inWorker, type Side } from './helpers/simWorkerSides';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { runGameSeconds } from '../src/sim/tick/harness';
import { updateIndexesForMovement, updatePosition } from '../src/sim/movement';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { BattleTactics, BuiltObjectFleeWhen } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { createMissionShipActionAt } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { QUIET_MS, battleReportState, battleReports, setBattleReportsEnabled, type BattleReport } from '../src/sim/battleReports/battleReports';
import { MERCENARY, pirateExplorer, pirateFaction, pirateRaider, playerShip } from './helpers/combatCast';
import { ComponentType } from '../src/sim/data/components';
import { assignMission } from '../src/sim/missions/assign';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 180000);

/** A point ≥ 300 000 from every habitat and ship (combatScenarios.test.ts emptySpot). */
function emptySpot(g: Galaxy): { x: number; y: number } {
    for (let x = 200000; x < g.sizeX; x += 100000) {
        for (let y = 200000; y < g.sizeY; y += 100000) {
            if (g.habitats.every((h) => Math.hypot(h.xpos - x, h.ypos - y) > 300000) && g.builtObjects.every((b) => b === null || Math.hypot(b.xpos - x, b.ypos - y) > 300000)) return { x, y };
        }
    }
    throw new Error('no empty spot');
}

function place(g: Galaxy, b: BuiltObject, x: number, y: number): void {
    const ix = Math.trunc(Math.trunc(b.xpos) / 400000);
    const iy = Math.trunc(Math.trunc(b.ypos) / 400000);
    b.parentBuiltObject = null;
    b.parentHabitat = null;
    b.parentOffsetX = -2000000001.0;
    b.parentOffsetY = -2000000001.0;
    b.xpos = x;
    b.ypos = y;
    updateIndexesForMovement(g, b, ix, iy, true);
    updatePosition(g, b);
}

interface Staged {
    game: Game;
    esc: BuiltObject;
    pir: BuiltObject;
    spot: { x: number; y: number };
}

/** The (1) staging: the player's escort 60 from a pirate explorer whose engines are out, ordered to Attack it. */
function stage(): Staged {
    const game = cachedTickGame(gameData);
    const g = game.galaxy;
    const esc = playerShip(g, BuiltObjectSubRole.Escort, 0);
    const pir = pirateExplorer(g, 0);
    const spot = emptySpot(g);
    builtObjectMission(pir.mission)?.clear();
    pir.isAutoControlled = false;
    pir.fleeWhen = BuiltObjectFleeWhen.Never;
    pir.design.fleeWhen = BuiltObjectFleeWhen.Never;
    pir.targetSpeed = 0;
    pir.preferredSpeed = 0;
    pir.currentSpeed = 0;
    for (const c of pir.components.items) if (c.category === ComponentCategoryType.Engine) c.status = ComponentStatus.Damaged;
    pir.reDefine();
    place(g, esc, spot.x, spot.y);
    place(g, pir, spot.x + 60, spot.y);
    esc.currentEnergy = esc.reactorStorageCapacity;
    esc.design.tacticsWeakerShips = BattleTactics.PointBlank;
    esc.design.tacticsStrongerShips = BattleTactics.PointBlank;
    const r = executeShipAction(g, g.playerEmpire!, esc, createMissionShipActionAt(BuiltObjectMissionType.Attack, pir, Math.trunc(pir.xpos), Math.trunc(pir.ypos)), true);
    expect(r.ok).toBe(true);
    return { game, esc, pir, spot };
}

/** Game seconds the staged fight is run for: the kill (< 90 s, combatScenarios (1)) plus the quiet period. */
const FIGHT_S = 90 + QUIET_MS / 1000 + 5;

/** The reports about the staged fight (other fights of the seed-1 game elsewhere are not this test's). */
function stagedReports(g: Galaxy, spot: { x: number; y: number }): BattleReport[] {
    return battleReports(g, true).filter((r) => Math.hypot(r.x - spot.x, r.y - spot.y) < 1000);
}

/** The report as plain data (what the UI reads), for comparing modes. */
const plain = (r: BattleReport | undefined): unknown => JSON.parse(JSON.stringify(r ?? null));

describe('battle reports: the staged escort-vs-pirate fight', () => {
    let reference: BattleReport;

    it('in-thread: one report, the pirate explorer destroyed, the escort intact, a victory in deep space', () => {
        const { game, esc, pir, spot } = stage();
        const g = game.galaxy;
        runGameSeconds(g, FIGHT_S);
        expect(pir.hasBeenDestroyed).toBe(true);
        const reports = stagedReports(g, spot);
        expect(reports.length).toBe(1);
        const r = reports[0];
        reference = r;
        expect(r.minor).toBe(false);
        expect(r.deepSpace).toBe(true);
        expect(r.systemIndex).toBe(-1);
        expect(r.locationName).not.toBe('');
        expect(r.result).toBe('victory');
        expect(r.endMs).toBeGreaterThan(r.startMs);
        expect(r.endStarDate).toBeGreaterThan(r.startStarDate);
        // Two sides: the player and the explorer's pirate faction, enemies.
        const player = g.playerEmpire!;
        const pirates = pir.empire!;
        expect(r.sides.map((s) => [s.name, s.kind, s.camp])).toEqual([
            [player.name, 'player', 'player'],
            [pirates.name, 'pirate', 'enemy'],
        ]);
        // The forces: the escort and the explorer, both engaged.
        const unit = (bo: BuiltObject) => r.units.find((u) => u.id === bo.builtObjectID)!;
        expect(r.units.length).toBe(2);
        const e = unit(esc);
        const p = unit(pir);
        expect([e.name, e.kind, e.side, e.engaged, e.subRole]).toEqual([esc.name, 'ship', `e${player.empireId}`, true, BuiltObjectSubRole.Escort]);
        expect([p.name, p.kind, p.side, p.engaged, p.subRole]).toEqual([pir.name, 'ship', `e${pirates.empireId}`, true, BuiltObjectSubRole.ExplorationShip]);
        // Losses: the explorer destroyed (strength → 0), the unarmed explorer never hurt the escort.
        expect(p.fate).toBe('destroyed');
        expect(p.endStrength).toBe(0);
        expect(e.fate).toBe('intact');
        expect(e.withdrew).toBe(false);
        expect(e.startFirepower).toBe(esc.firepowerRaw);
        expect(e.endFirepower).toBe(esc.firepowerRaw);
        const [ps, es] = r.sides;
        expect([ps.units, ps.destroyed, ps.captured, ps.disabled]).toEqual([1, 0, 0, 0]);
        expect([es.units, es.destroyed, es.captured]).toEqual([1, 1, 0]);
        expect(ps.firepowerStart).toBe(esc.firepowerRaw);
        expect(ps.firepowerEnd).toBe(esc.firepowerRaw);
        expect(es.firepowerStart).toBe(0);
        expect(es.strengthEnd).toBe(0);
        expect(es.strengthStart).toBeGreaterThan(0); // the explorer's shields (100 / 20)
        // Nothing still open there.
        expect(battleReportState(g)!.open.filter((b) => Math.hypot(b.x - spot.x, b.y - spot.y) < 1000)).toEqual([]);
    }, 600000);
});

describe('battle reports: modes, save / load, determinism', () => {
    /** The staged report on a galaxy (the one fight at the staging spot). */
    function report(g: Galaxy, spot: { x: number; y: number }): BattleReport {
        const list = stagedReports(g, spot);
        expect(list.length).toBe(1);
        return list[0];
    }

    let headless: BattleReport;
    it('headless reference run', () => {
        const { game, spot } = stage();
        runGameSeconds(game.galaxy, FIGHT_S);
        headless = report(game.galaxy, spot);
        expect(headless.result).toBe('victory');
    }, 600000);

    it('worker mode: the replica shows the same report as the authoritative game and the in-thread app loop', () => {
        const a = stage();
        const w = stage();
        const sides: Side[] = [inThread(a.game), inWorker(w.game, gameData)];
        try {
            const ticks = Math.ceil((FIGHT_S * 1000) / FRAME_REAL_MS);
            for (let i = 0; i < ticks; i++) for (const s of sides) s.tick();
            for (const s of sides) s.settle();
            const [inT, inW] = sides;
            expect(inW.digest()).toBe(inT.digest());
            const rT = report(inT.galaxy, a.spot);
            const rReal = report(inW.real, w.spot);
            const rReplica = report(inW.galaxy, w.spot);
            expect(rReplica).not.toBe(rReal); // the replica's own copy
            expect(plain(rReplica)).toEqual(plain(rReal));
            expect(plain(rReplica)).toEqual(plain(rT));
            expect(plain(rT)).toEqual(plain(headless));
            expect(rReplica.units.find((u) => u.id === w.pir.builtObjectID)!.fate).toBe('destroyed');
            // The UI only reads: no main-thread write to the replica.
            expect((inW as ReturnType<typeof inWorker>).replicaWrites()).toEqual([]);
        } finally {
            for (const s of sides) s.dispose();
        }
    }, 900000);

    it('a save / load in the middle of the fight continues to the same report', () => {
        const { game, spot } = stage();
        runGameSeconds(game.galaxy, 20);
        const st = battleReportState(game.galaxy)!;
        expect(st.open.some((b) => Math.hypot(b.x - spot.x, b.y - spot.y) < 1000)).toBe(true);
        const time = new GalaxyTime();
        time.togglePause();
        const start = { ...defaultStartGameOptions(), seed: 1 };
        const text = serializeGame(game, time, start);
        expect(text).toContain('battleReports');
        const loaded = deserializeGame(text, gameData).game;
        runGameSeconds(loaded.galaxy, FIGHT_S - 20);
        expect(plain(report(loaded.galaxy, spot))).toEqual(plain(headless));
        // And the uninterrupted game agrees.
        runGameSeconds(game.galaxy, FIGHT_S - 20);
        expect(plain(report(game.galaxy, spot))).toEqual(plain(headless));
        // The finished reports round-trip as saved.
        const again = deserializeGame(serializeGame(loaded, time, start), gameData).game;
        expect(plain(report(again.galaxy, spot))).toEqual(plain(headless));
    }, 600000);

    it('the observer changes no game state: the same digest and Rnd draws with it off', () => {
        const on = stage();
        const runOn = runGameSeconds(on.game.galaxy, FIGHT_S);
        let digestOff = '';
        let drawsOff = -1;
        setBattleReportsEnabled(false);
        try {
            const off = stage();
            const runOff = runGameSeconds(off.game.galaxy, FIGHT_S);
            digestOff = stateDigest(off.game.galaxy);
            drawsOff = runOff.rndDraws;
            expect(battleReportState(off.game.galaxy)).toBeUndefined();
        } finally {
            setBattleReportsEnabled(true);
        }
        expect(stateDigest(on.game.galaxy)).toBe(digestOff);
        expect(runOn.rndDraws).toBe(drawsOff);
        expect(battleReportState(on.game.galaxy)).toBeDefined();
    }, 600000);

    it('a game that never fought saves no battle-report table (same save text as before the observer)', () => {
        const game = cachedTickGame(gameData);
        expect(battleReportState(game.galaxy)).toBeUndefined();
        const time = new GalaxyTime();
        time.togglePause();
        expect(serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1 })).not.toContain('battleReports');
    }, 300000);
});

describe('battle reports: a boarding capture (combatScenarios (4) staging)', () => {
    it('the player explorer boarded by a Mercenary escort: one report, the explorer captured by the pirates, a defeat', () => {
        const g = cachedTickGame(gameData).galaxy;
        const att = pirateRaider(g, pirateFaction(g, MERCENARY));
        const tgt = playerShip(g, BuiltObjectSubRole.ExplorationShip, 2);
        builtObjectMission(tgt.mission)?.clear();
        tgt.isAutoControlled = false;
        for (const c of tgt.components.items) if (c.category === ComponentCategoryType.Engine) c.status = ComponentStatus.Damaged;
        tgt.reDefine();
        tgt.currentShields = 0;
        const spot = emptySpot(g);
        place(g, tgt, spot.x, spot.y);
        place(g, att, spot.x + 100, spot.y);
        tgt.components.items.find((c) => c.type === ComponentType.HabitationHabModule)!.status = ComponentStatus.Damaged;
        tgt.reDefine();
        assignMission(g, att, BuiltObjectMissionType.Capture, tgt, null, BuiltObjectMissionPriority.High);
        runGameSeconds(g, 40 + QUIET_MS / 1000 + 5);
        expect(tgt.empire).toBe(att.empire);
        const reports = stagedReports(g, spot);
        expect(reports.length).toBe(1);
        const r = reports[0];
        expect(r.minor).toBe(false);
        expect(r.result).toBe('defeat');
        const u = r.units.find((x) => x.id === tgt.builtObjectID)!;
        expect([u.side, u.fate, u.capturedBy, u.endStrength]).toEqual([`e${g.playerEmpire!.empireId}`, 'captured', att.empire!.name, 0]);
        const raider = r.units.find((x) => x.id === att.builtObjectID)!;
        expect([raider.side, raider.engaged, raider.fate === 'destroyed']).toEqual([`e${att.empire!.empireId}`, true, false]);
        const player = r.sides.find((s) => s.kind === 'player')!;
        expect([player.units, player.captured, player.destroyed]).toEqual([1, 1, 0]);
        expect(r.sides.find((s) => s.kind === 'pirate')!.camp).toBe('enemy');
    }, 300000);
});
