// Per-game BaconSettings (ours; data/baconSettings.ts + sim/baconSettings.ts applyBaconSettingsCommand): a game keeps
// the BaconSettings.txt keys it changed (Galaxy.baconSettingsOverrides, only values that differ from the install's file),
// the journaled setBaconSettings command changes them mid-game and re-runs BaconInitialize at its frame boundary, a
// replay of the command log and a save / load give the identical game.
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import {
    baconSettings,
    baconSettingsOverrides,
    defaultBaconSettings,
    mergeBaconSettings,
    parseBaconSettings,
    readBaconSettingsComments,
} from '../src/sim/data/baconSettings';
import { installBaconSettings } from '../src/sim/baconSettings';
import { baconMovementSettings } from '../src/sim/movement';
import { PROCESS_EMPIRE_SCIENCE_SHIPS } from '../src/sim/baconScienceShips';
import { issuePlayerCommand, runScheduledUntil, scheduleCommandLog } from '../src/sim/player/playerCommands';
import { commandLog, type CommandLogEntry, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { runGameSeconds } from '../src/sim/tick/harness';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { GalaxyTime } from '../src/sim/galaxyTime';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { fullDigest } from './helpers/commandScript';
import { cachedTickGame } from './helpers/gameCache';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { Game } from '../src/sim/game';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const f = Math.fround;

/** The overrides the tests apply: a price, the gravity wells (movement statics), the science ships off, the independents' garrison. */
const EDIT = { shipMarkupFactor: 7, useStarGravityWells: true, researchPerLab: 0, troopGarrisonMinimumPerColony: 5, noFuelHyperSpeedMultiplier: 0.05 };

function saveText(game: Game): string {
    const time = new GalaxyTime();
    time.bindGalaxy(game.galaxy);
    return serializeGame(game, time, {} as StartGameOptions);
}

describe('per-game BaconSettings: values, normalization, the file comments', () => {
    it('stores only the keys that differ from the install file, normalized as BaconInitialize parses them', () => {
        const install = parseBaconSettings('shipMarkupFactor=9\nlowStarCount=50\n');
        const stored = baconSettingsOverrides(install, {
            shipMarkupFactor: 9, // same as the file: not stored
            lowStarCount: 500, // clamped to 100 (BaconMain.cs 726)
            infrasetuctureDurability: 2, // clamped to 1f
            spyCaptureChance: 0.3, // float field: Math.fround
            fighterBayLabel: 'FIGHTER', // lower-cased, = the default: not stored
            noFuelCruiseSpeedMultiplier: 0.8,
            noFuelTopSpeedMultiplier: 0.5, // below the cruise multiplier: raised to it (863-870)
            drawWeaponRangeCircles: false,
            hyperJumpThreshhold: 1.5, // not an int: ignored
        } as never);
        expect(stored).toEqual({
            spyCaptureChance: f(0.3),
            lowStarCount: 100,
            infrasetuctureDurability: f(1),
            noFuelCruiseSpeedMultiplier: f(0.8),
            noFuelTopSpeedMultiplier: f(0.8),
            drawWeaponRangeCircles: false,
        });
        expect(mergeBaconSettings(install, stored).minZoomLevelForWeaponsCircles).toBe(5.0);
        expect(baconSettingsOverrides(install, {})).toEqual({});
    });

    it("reads each key's description from the comment block above it", () => {
        const c = gameData.baconSettingsComments!;
        expect(readBaconSettingsComments('// a\n// b\nx=1\ny=2\n\n// header\n\nz=3\n')).toEqual({ x: 'a b', y: 'a b' });
        expect(c.HyperJumpThreshhold).toMatch(/^Minimum distance for a ship to use hyperjump/);
        expect(c.BaseHyperJumpAccuracy).toMatch(/^Inaccuracy of exit point/);
        // Keys under one block share it; the header blocks attach to nothing.
        expect(c.ammoExhaustChanceTorpedo).toBe(c.ammoExhaustChanceMissile);
        expect(Object.values(c).some((d) => d.includes('Lines that start with'))).toBe(false);
        expect(gameData.baconSettingsComments?.saveStats).toMatch(/SaveStatsEmpires\.xml/);
    });
});

describe('per-game BaconSettings: the setBaconSettings command', () => {
    let log: CommandLogEntry[];
    let live: { digest: string; save: string };
    let endMs: number;

    it('applies at the next frame boundary, is journaled, and changes the statics and the game', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        expect(g.baconSettingsOverrides).toBeUndefined();
        expect(saveText(game)).not.toContain('baconSettingsOverrides');
        expect(baconSettings.shipMarkupFactor).toBe(installBaconSettings().shipMarkupFactor);
        runGameSeconds(game, 3);
        let stored: unknown = null;
        issuePlayerCommand(g, game.playerEmpire, 'setBaconSettings', [EDIT], (r) => (stored = r));
        expect(stored).toBeNull(); // queued, not applied yet
        runGameSeconds(game, 1);
        expect(stored).toEqual(g.baconSettingsOverrides);
        expect(g.baconSettingsOverrides).toMatchObject({ shipMarkupFactor: 7, useStarGravityWells: true, researchPerLab: 0, troopGarrisonMinimumPerColony: 5 });
        expect(baconSettings.shipMarkupFactor).toBe(7);
        expect(baconMovementSettings.useStarGravityWells).toBe(true);
        expect(baconMovementSettings.noFuelHyperSpeedMultiplier).toBe(f(0.1)); // clamped like the file key
        expect(g.independentEmpire!.policy!.troopGarrisonMinimumPerColony).toBe(5);
        // The re-run BaconInitialize queues nothing that is already queued.
        expect(g.delayedActions.filter((p) => p.action?.messageTitle === PROCESS_EMPIRE_SCIENCE_SHIPS).length).toBe(1);
        runGameSeconds(game, 8);
        log = commandLog(g).map((e) => JSON.parse(JSON.stringify(e)) as CommandLogEntry);
        const player = log.filter((e): e is PlayerLogEntry => e.source === 'player');
        expect(player.map((e) => e.op)).toContain('setBaconSettings');
        expect(player.every((e) => e.error === undefined)).toBe(true);
        endMs = g.nowMs;
        live = fullDigest(game);
        expect(live.save).toContain('baconSettingsOverrides');
    }, 2400000);

    it('a replay of the command log gives the identical game', () => {
        const game = cachedTickGame(gameData);
        // A fresh copy starts from the file's values (the live run's command changed the process-wide statics).
        expect(baconSettings.shipMarkupFactor).toBe(installBaconSettings().shipMarkupFactor);
        scheduleCommandLog(game.galaxy, log.slice(commandLog(game.galaxy).length));
        runScheduledUntil(game.galaxy, endMs);
        expect(game.galaxy.nowMs).toBe(endMs);
        expect(baconSettings.shipMarkupFactor).toBe(7);
        const r = fullDigest(game);
        expect(r.digest).toBe(live.digest);
        expect(r.save).toBe(live.save);
    }, 2400000);

    it('survives a save round trip (statics restored from the save), and {} restores the file values', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        issuePlayerCommand(g, game.playerEmpire, 'setBaconSettings', [EDIT]);
        runGameSeconds(game, 2);
        const save = saveText(game);
        runGameSeconds(game, 4);
        const expected = fullDigest(game).digest;
        const overrides = { ...g.baconSettingsOverrides };

        // Another game in between puts the statics back to the file's values.
        cachedTickGame(gameData);
        expect(baconSettings.shipMarkupFactor).toBe(installBaconSettings().shipMarkupFactor);

        const loaded = deserializeGame(save, gameData).game;
        expect(loaded.galaxy.baconSettingsOverrides).toEqual(overrides);
        expect(baconSettings.shipMarkupFactor).toBe(7);
        expect(baconMovementSettings.useStarGravityWells).toBe(true);
        runGameSeconds(loaded, 4);
        expect(fullDigest(loaded).digest).toBe(expected);

        issuePlayerCommand(loaded.galaxy, loaded.playerEmpire, 'setBaconSettings', [{}]);
        runGameSeconds(loaded, 0.1);
        expect(loaded.galaxy.baconSettingsOverrides).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(loaded.galaxy, 'baconSettingsOverrides')).toBe(false);
        expect(baconSettings.shipMarkupFactor).toBe(installBaconSettings().shipMarkupFactor);
        expect(baconSettings).toEqual(mergeBaconSettings(gameData.baconSettings ?? defaultBaconSettings(), null));
    }, 2400000);
});
