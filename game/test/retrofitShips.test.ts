// "Refit selected/all to latest" on the Ships and Bases screen: which ships/designs planRetrofit picks and the
// retrofitShips player command (src/sim/player/fleetOps.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import { planRetrofit } from '../src/sim/player/fleetOps';
import { flushPlayerCommands, issuePlayerCommand } from '../src/sim/player/playerCommands';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { findNewestCanBuildFullEvaluate } from '../src/sim/designGeneration';
import { retrofitConfirmText, retrofitToastText } from '../src/ui/screens/shipsAndBasesList';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('refit to latest', () => {
    it('plans the newest design per subrole, skipping ships already on it / private / no design', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        const ships = p.builtObjects.filter((b) => b !== null);
        const plan = planRetrofit(game.galaxy, p, [...ships, ...ships]);
        expect(plan).toHaveLength(ships.length); // duplicates collapse
        for (const e of plan) {
            if (e.skip === null) {
                expect(e.design).toBe(findNewestCanBuildFullEvaluate(p.designs, e.ship.subRole, e.ship.parentHabitat));
                expect(e.ship.design).not.toBe(e.design);
                expect(e.cost).toBeGreaterThanOrEqual(0);
            }
            if (e.skip === 'already latest design') expect(e.ship.design).toBe(e.design);
        }
        const priv = p.privateBuiltObjects.find((b) => b !== null && b.owner === null && b.role !== BuiltObjectRole.Base);
        if (priv) expect(planRetrofit(game.galaxy, p, [priv])[0].skip).toBe('private ship');
        expect(retrofitConfirmText(plan, 'x')).toContain('credits');
    });

    it('the command is journaled and issues Retrofit missions as player orders', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        const ships = p.builtObjects.filter((b) => b !== null);
        // Force an eligible ship: a mobile state ship that is not on the newest design of its subrole.
        const target = ships.find((b) => b.topSpeed > 0 && b.owner !== null && b.builtAt === null && b.retrofitDesign === null
            && findNewestCanBuildFullEvaluate(p.designs, b.subRole, b.parentHabitat) !== null)!;
        expect(target).toBeDefined();
        target.design = p.designs.find((d) => d !== findNewestCanBuildFullEvaluate(p.designs, target.subRole, target.parentHabitat))!;
        const plan = planRetrofit(game.galaxy, p, ships);
        const eligible = plan.filter((e) => e.skip === null);
        expect(eligible.length).toBeGreaterThan(0);
        let result: { sent: number; skipped: Record<string, number> } | undefined;
        issuePlayerCommand(game.galaxy, p, 'retrofitShips', [ships], (r) => { result = r; });
        flushPlayerCommands(game.galaxy);
        expect(result).toBeDefined();
        const total = result!.sent + Object.values(result!.skipped).reduce((a, b) => a + (b ?? 0), 0);
        expect(total).toBe(ships.length);
        expect(result!.sent).toBeLessThanOrEqual(eligible.length);
        const missions = ships.map((s) => builtObjectMission(s.mission)).filter((m) => m !== null && m.type === BuiltObjectMissionType.Retrofit);
        for (const m of missions) expect(m!.playerOrdered).toBe(true);
        expect(commandLog(game.galaxy).some((e) => e.source === 'player' && (e as PlayerLogEntry).op === 'retrofitShips')).toBe(true);
        expect(retrofitToastText(result!)).toMatch(/ships? sent to refit/);
    });
});
