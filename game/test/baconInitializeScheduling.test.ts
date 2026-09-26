// BaconMain.cs 551 BaconInitialize: the "SaveStats" (686-697) and "ClearShipsAboutToBeDestroyed" (1069 / 1075
// AddOtherDelayedEvents, Galaxy.Rnd.Next(10, 12)) delayed actions around the science-ship one (700-715), and the
// BaconGalaxy.cs 315-321 SaveStats re-queue interval.
import { beforeAll, describe, expect, it } from 'vitest';
import { setGovernmentsStatic } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { baconSettings } from '../src/sim/data/baconSettings';
import { CLEAR_SHIPS_ABOUT_TO_BE_DESTROYED, SAVE_STATS, addOtherDelayedEvents, baconInitializeSettings } from '../src/sim/baconSettings';
import { PROCESS_EMPIRE_SCIENCE_SHIPS } from '../src/sim/baconScienceShips';
import { baconGalaxyExecuteEventAction } from '../src/sim/story/eventActions';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from '../src/sim/tick/simTime';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

const DAY = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 360);

describe('BaconInitialize delayed actions (BaconMain.cs 686-697, 700-715, 1069-1087)', () => {
    it('createGame queues SaveStats (1 day), the science ships and ClearShipsAboutToBeDestroyed (Next(10, 12) days), in that order', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        expect(baconSettings.saveStats).toBe(true);
        const titles = galaxy.delayedActions.map((p) => p.action?.messageTitle ?? null);
        const iSave = titles.indexOf(SAVE_STATS);
        const iScience = titles.indexOf(PROCESS_EMPIRE_SCIENCE_SHIPS);
        const iClear = titles.indexOf(CLEAR_SHIPS_ABOUT_TO_BE_DESTROYED);
        expect(iSave).toBeGreaterThanOrEqual(0);
        expect(iSave).toBeLessThan(iScience);
        expect(iScience).toBeLessThan(iClear);
        expect(titles.filter((t) => t === SAVE_STATS).length).toBe(1);
        expect(titles.filter((t) => t === CLEAR_SHIPS_ABOUT_TO_BE_DESTROYED).length).toBe(1);
        const save = galaxy.delayedActions[iSave];
        const clear = galaxy.delayedActions[iClear];
        // Both were queued at the same star date as the science-ship action (end of createGame).
        const science = galaxy.delayedActions[iScience].action!;
        const scienceDays = (science.executionDate - save.action!.executionDate + DAY) / DAY;
        expect(Number.isInteger(scienceDays)).toBe(true);
        const clearDays = (clear.action!.executionDate - save.action!.executionDate + DAY) / DAY;
        expect([10, 11]).toContain(clearDays);
        expect(save.triggerEmpire).toBe(galaxy.playerEmpire);
        expect(clear.triggerEmpire).toBe(galaxy.playerEmpire);
    });

    it('a second BaconInitialize (a loaded game) queues nothing new and draws nothing', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const count = galaxy.delayedActions.length;
        const before = galaxy.rnd.getState();
        baconInitializeSettings(galaxy, gameData.baconSettings);
        expect(galaxy.delayedActions.length).toBe(count);
        const probe = galaxy.rnd.next(0, 1 << 30);
        galaxy.rnd.setState(before);
        expect(galaxy.rnd.next(0, 1 << 30)).toBe(probe);
    });

    it('AddOtherDelayedEvents draws exactly one Next(10, 12) for the ClearShipsAboutToBeDestroyed date', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        galaxy.delayedActions = galaxy.delayedActions.filter((p) => p.action?.messageTitle !== CLEAR_SHIPS_ABOUT_TO_BE_DESTROYED);
        const before = galaxy.rnd.getState();
        const expected = galaxy.rnd.next(10, 12);
        const after = galaxy.rnd.getState();
        galaxy.rnd.setState(before);
        addOtherDelayedEvents(galaxy);
        expect(galaxy.rnd.getState()).toEqual(after);
        const queued = galaxy.delayedActions.filter((p) => p.action?.messageTitle === CLEAR_SHIPS_ABOUT_TO_BE_DESTROYED);
        expect(queued.length).toBe(1);
        expect(queued[0].action!.executionDate).toBe(galaxyStarDate(galaxy) + DAY * expected);
    });

    it('SaveStats re-queues itself statSaveIntervalInGameDays later (BaconGalaxy.cs 319)', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const pkg = galaxy.delayedActions.find((p) => p.action?.messageTitle === SAVE_STATS)!;
        galaxy.delayedActions.splice(galaxy.delayedActions.indexOf(pkg), 1);
        const flag = baconGalaxyExecuteEventAction(galaxy, pkg.action!, null, pkg.gameEvent, true);
        expect(flag).toBe(false);
        const requeued = galaxy.delayedActions.filter((p) => p.action?.messageTitle === SAVE_STATS);
        expect(requeued.length).toBe(1);
        expect(requeued[0].action!.executionDate).toBe(galaxyStarDate(galaxy) + DAY * baconSettings.statSaveIntervalInGameDays);
    });
});
