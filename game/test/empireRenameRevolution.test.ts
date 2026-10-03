// Empire Summary player commands: 'empireRename' (Main.Part9.cs:4306 txtEmpireSummaryName_Leave) and
// 'empireChangeGovernment' (Main.Part6.cs:3028 btnEmpireSummaryChangeGovernment_Click → Empire.10.cs:4457
// HaveRevolution). Both are journaled, deterministic and survive save/load and a seed + log replay.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { tickGameOptions } from './helpers/tickGame';
import { fullDigest } from './helpers/commandScript';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Race } from '../src/sim/data/races';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { nextFrameMs, runSimFrame, schedulerState } from '../src/sim/tick/scheduler';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { issuePlayerCommand, replayCommandLog, runPlayerCommand } from '../src/sim/player/playerCommands';
import { applyShipRegistryPrefix, resolveEmpireShipNameStyle, shipRegistryPrefix } from '../src/sim/shipNameStyle';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { haveRevolution } from '../src/sim/treasury';
import { obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { stateDigest } from '../src/sim/tick/digest';
import type { StartGameOptions } from '../src/sim/startGameOptions';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function saveLoad(game: Game): Game {
    const time = new GalaxyTime();
    time.bindGalaxy(game.galaxy);
    return deserializeGame(serializeGame(game, time, {} as StartGameOptions), gameData).game;
}

function otherGovernment(game: Game): number {
    const p = game.playerEmpire;
    const id = p.allowableGovernmentTypes.find((g) => g !== p.governmentId);
    expect(id).toBeDefined();
    return id!;
}

describe('empireRename (txtEmpireSummaryName_Leave)', () => {
    it('renames the player empire; new ship registry prefixes follow, existing ships keep their names', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const shipNames = p.builtObjects.filter((b) => b !== null).map((b) => b.name);
        const others = g.empires.filter((e) => e !== p).map((e) => e.name);

        expect(runPlayerCommand(g, p, 'empireRename', ['   '])).toBe(false);
        expect(runPlayerCommand(g, p, 'empireRename', [''])).toBe(false);
        expect(p.name).not.toBe('');

        expect(runPlayerCommand(g, p, 'empireRename', ['  Zeta Quorum  '])).toBe(true);
        expect(p.name).toBe('Zeta Quorum');
        const style = resolveEmpireShipNameStyle(p);
        if (style !== null) {
            const prefix = shipRegistryPrefix(style, 'Zeta Quorum', BuiltObjectSubRole.Frigate);
            expect(applyShipRegistryPrefix(p, BuiltObjectSubRole.Frigate, 'Valiant')).toBe(prefix === '' ? 'Valiant' : `${prefix} Valiant`);
            if (prefix !== '') expect(prefix).toContain('ZQ');
        }
        expect(p.builtObjects.filter((b) => b !== null).map((b) => b.name)).toEqual(shipNames);
        expect(g.empires.filter((e) => e !== p).map((e) => e.name)).toEqual(others);
        const ops = (commandLog(g) as PlayerLogEntry[]).map((e) => e.op);
        expect(ops).toEqual(['empireRename', 'empireRename', 'empireRename']);
    }, 300000);
});

describe('empireChangeGovernment (Empire.HaveRevolution)', () => {
    it('rejects what the original rejects: no selection, the current government, a non-allowable one, a race that cannot change', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const before = stateDigest(g);
        expect(runPlayerCommand(g, p, 'empireChangeGovernment', [-1])).toBe(-1);
        expect(runPlayerCommand(g, p, 'empireChangeGovernment', [p.governmentId])).toBe(-1);
        const notAllowed = gameData.governments.findIndex((_, i) => !p.allowableGovernmentTypes.includes(i));
        if (notAllowed >= 0) expect(runPlayerCommand(g, p, 'empireChangeGovernment', [notAllowed])).toBe(-1);
        const race = p.dominantRace as Race;
        const saved = race.canChangeGovernment;
        try {
            race.canChangeGovernment = false;
            expect(runPlayerCommand(g, p, 'empireChangeGovernment', [otherGovernment(game)])).toBe(-1);
        } finally {
            race.canChangeGovernment = saved;
        }
        expect(stateDigest(g)).toBe(before); // no RNG draw, no state change
    }, 300000);

    it('applies HaveRevolution(DominantRace, id, 1.0): colony damage, the switch, AI government-affinity reset', () => {
        const game = cachedTickGame(gameData);
        const ref = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const target = otherGovernment(game);
        const colonies = p.colonies.map((h) => ({ h, dev: h.developmentLevel, pop: h.population.items[0].amount }));
        const aiGovernments = g.empires.filter((e) => e !== p).map((e) => e.governmentId);
        const ais = g.empires.filter((e) => e !== p && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
        for (const ai of ais) {
            const ev = obtainEmpireEvaluation(g, ai, p);
            ev.governmentStyleAffinity = 3;
            ev.governmentStyleAffinityCumulative = 7.5;
        }
        for (const ai of ref.galaxy.empires.filter((e) => e !== ref.playerEmpire && e.active && e !== ref.galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null)) {
            const ev = obtainEmpireEvaluation(ref.galaxy, ai, ref.playerEmpire);
            ev.governmentStyleAffinity = 3;
            ev.governmentStyleAffinityCumulative = 7.5;
        }

        expect(runPlayerCommand(g, p, 'empireChangeGovernment', [target])).toBe(target);
        expect(p.governmentId).toBe(target);
        for (const c of colonies) {
            if (c.h.empire !== p) continue; // LeaveEmpire (LeaderReplacementDisruptionLevel)
            expect(c.h.developmentLevel).toBeLessThanOrEqual(c.dev);
            expect(c.dev - c.h.developmentLevel).toBeLessThan(25);
            expect(c.h.population.items[0].amount).toBeGreaterThanOrEqual(Math.min(c.pop, 10_000_000));
            expect(c.h.population.items[0].amount).toBeLessThanOrEqual(Math.max(c.pop, 10_000_000));
        }
        expect(p.capital?.empire).toBe(p);
        for (const ai of ais) {
            const ev = obtainEmpireEvaluation(g, ai, p);
            expect(ev.governmentStyleAffinity).toBe(0);
            expect(ev.governmentStyleAffinityCumulative).toBe(0);
        }
        expect(g.empires.filter((e) => e !== p).map((e) => e.governmentId)).toEqual(aiGovernments);

        // Exactly the ported Empire.HaveRevolution (same RNG draws, same effects).
        haveRevolution(ref.galaxy, ref.playerEmpire, ref.playerEmpire.dominantRace, target, 1.0);
        expect(stateDigest(g)).toBe(stateDigest(ref.galaxy));
    }, 300000);
});

describe('both commands: command log replay and save/load', () => {
    it('seed + log replays the rename and the revolution; a save keeps the name and government', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const target = otherGovernment(game);
        const frame = (): void => runSimFrame(g, nextFrameMs(schedulerState(g), 1));
        frame();
        issuePlayerCommand(g, p, 'empireRename', ['Zeta Quorum']);
        frame();
        issuePlayerCommand(g, p, 'empireChangeGovernment', [target]);
        frame();
        expect(p.name).toBe('Zeta Quorum');
        expect(p.governmentId).toBe(target);
        const log = commandLog(g) as PlayerLogEntry[];
        expect(log.filter((e) => e.source === 'player').map((e) => [e.op, e.error])).toEqual([
            ['empireRename', undefined],
            ['empireChangeGovernment', undefined],
        ]);

        const { seed, ...options } = tickGameOptions(gameData);
        const replay = replayCommandLog(seed, options, commandLog(g), g.nowMs);
        expect(replay.playerEmpire.name).toBe('Zeta Quorum');
        expect(replay.playerEmpire.governmentId).toBe(target);
        expect(fullDigest(replay).digest).toBe(fullDigest(game).digest);

        const loaded = saveLoad(game);
        expect(loaded.playerEmpire.name).toBe('Zeta Quorum');
        expect(loaded.playerEmpire.governmentId).toBe(target);
        expect((commandLog(loaded.galaxy) as PlayerLogEntry[]).map((e) => e.op)).toEqual(log.map((e) => e.op));
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(g));
    }, 2400000);
});
