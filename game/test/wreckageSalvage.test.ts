// Scenario 19e-7 "battle wreckage & salvage" (tasks/19-mod-layer-scenarios.md §19e item 7): a destroyed ship leaves a
// wreck in a persistent debris field, decay, a salvage mission (resources + a forced foreign-tech roll), the AI idle
// construction-ship hook, pirate raid weighting near big fields, flags-off = faithful game, save round trip. Short runs.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import { cachedTickGameRun } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { GalaxyLocationType } from '../src/sim/galaxyLocation';
import { scenarioEmit, scenarioQuery, wrecksAt } from '../src/sim/scenario';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime, YEAR_LENGTH } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { inflictDamage } from '../src/sim/combat/damage';
import { clearEmptyDebrisFields } from '../src/sim/events';
import { updateRaidCountdownBuiltObject } from '../src/sim/pirates/pirateAI';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { empireMessages } from '../src/sim/messages';
import { peekWreckageState, salvageJobOf, wreckFieldById, wreckFieldValue, wreckParam, type WreckField } from '../src/sim/scenario/wreckage/common';
import { aiSalvageIdleShip, decayWreckFields, recordWreck, salvageJobsTick } from '../src/sim/scenario/wreckage/wreckage';
import { wreckSalvageMenuItem, wreckSalvageRows, wreckTooltipText } from '../src/ui/scenario/wreckageUi';

const SC = 'wreckage-salvage';
let base: GameData;
let shared: Game;

beforeAll(async () => {
    base = await loadGameDataFs();
    shared = createScenarioGame(base, { scenario: SC }).game;
}, 600000);

function live(g: Galaxy): BuiltObject[] {
    return g.builtObjects.filter((b): b is BuiltObject => b != null && !b.hasBeenDestroyed);
}

/** Destroys `target` through the stock combat path (inflictDamage → explosion → DoExplosions → CompleteTeardown). */
function destroy(g: Galaxy, target: BuiltObject): void {
    const attacker = live(g).find((b) => b !== target && b.empire !== target.empire && b.role !== BuiltObjectRole.Base) ?? live(g).find((b) => b !== target)!;
    target.currentShields = 0;
    expect(inflictDamage(g, attacker, target, null, target.size + 100000, g.nowMs, 50, 0)).toBe(true);
    runGameSeconds(g, 3);
}

/** The field holding the wreck of `bo`. */
function fieldOf(g: Galaxy, bo: BuiltObject): WreckField {
    const f = peekWreckageState(g)!.fields.find((x) => x.wrecks.some((w) => w.builtObjectId === bo.builtObjectID));
    expect(f, 'wreck field').toBeDefined();
    return f!;
}

function salvager(g: Galaxy, empire: Empire, subRole = BuiltObjectSubRole.ConstructionShip): BuiltObject {
    const s = live(g).find((b) => b.actualEmpire === empire && b.subRole === subRole);
    expect(s, 'salvage ship').toBeDefined();
    return s!;
}

describe('19e-7 wreckage — wrecks and fields', () => {
    it('a destroyed ship leaves a wreck in a persistent debris field (the original DebrisField location)', () => {
        const g = shared.galaxy;
        const pirateShip = live(g).find((b) => b.empire !== null && g.pirateEmpires.includes(b.empire) && b.role !== BuiltObjectRole.Base)!;
        expect(pirateShip).toBeDefined();
        const x = pirateShip.xpos;
        const y = pirateShip.ypos;
        destroy(g, pirateShip);
        expect(g.builtObjects.includes(pirateShip)).toBe(false);
        const hits = wrecksAt(g, x, y, 2000);
        expect(hits.length).toBe(1);
        const w = hits[0].wreck;
        expect(w.builtObjectId).toBe(pirateShip.builtObjectID);
        expect(w.designName).toBe(pirateShip.design.name);
        expect(w.componentIds.length).toBeGreaterThan(0);
        expect(w.resources.length).toBeGreaterThan(0);
        expect(w.value).toBeGreaterThan(0);
        const f = hits[0].field;
        expect(f.location.type).toBe(GalaxyLocationType.DebrisField);
        expect(g.galaxyLocations).toContain(f.location);
        expect(f.name).toMatch(/Debris Field/);
        expect(pirateShip.empire!.visibility.knownGalaxyLocations).toContain(f.location);
        // A second wreck close by joins the same field.
        const near = recordWreck(g, Object.assign(Object.create(Object.getPrototypeOf(pirateShip)), pirateShip, { builtObjectID: 999999, xpos: x + 500, ypos: y }) as BuiltObject);
        expect(near).not.toBeNull();
        expect(f.wrecks.length).toBe(2);
        // The stock ClearEmptyDebrisFields (no abandoned ships inside) keeps it.
        clearEmptyDebrisFields(g);
        expect(g.galaxyLocations).toContain(f.location);
        expect(wreckTooltipText(g, f)).toMatch(/2 wrecks · salvage value/);
    }, 600000);

    it('wrecks decay over wreckDecayYears; an empty field leaves the map', () => {
        const g = shared.galaxy;
        const st = peekWreckageState(g)!;
        const f = st.fields[0];
        const v0 = wreckFieldValue(g, f);
        for (const w of f.wrecks) w.starDate -= YEAR_LENGTH * wreckParam(g, 'wreckDecayYears') * 0.5;
        expect(wreckFieldValue(g, f)).toBeLessThan(v0 * 0.6);
        decayWreckFields(g);
        expect(st.fields).toContain(f);
        f.wrecks[1].starDate -= YEAR_LENGTH * wreckParam(g, 'wreckDecayYears');
        decayWreckFields(g);
        expect(f.wrecks.length).toBe(1);
        f.wrecks[0].starDate -= YEAR_LENGTH * wreckParam(g, 'wreckDecayYears');
        decayWreckFields(g);
        expect(st.fields).not.toContain(f);
        expect(g.galaxyLocations).not.toContain(f.location);
        expect(f.location.showName).toBe(false);
        expect(st.stats.fieldsDecayed).toBe(1);
    }, 600000);
});

describe('19e-7 wreckage — salvage', () => {
    let field: WreckField;

    it('a player salvage order (right-click entry → salvageWreckField command) recovers resources and a forced foreign tech', () => {
        const g = shared.galaxy;
        const player = g.playerEmpire!;
        const ship = salvager(g, player);
        // An enemy ship destroyed next to the player's construction ship.
        const victim = live(g).find((b) => b.empire !== null && b.empire !== player && b.role !== BuiltObjectRole.Base && b.components.count > 5)!;
        const vx = ship.xpos + 1500;
        const vy = ship.ypos;
        victim.xpos = vx;
        victim.ypos = vy;
        destroy(g, victim);
        field = fieldOf(g, victim);
        if (!player.visibility.knownGalaxyLocations.includes(field.location)) player.visibility.knownGalaxyLocations.push(field.location);
        expect(field).toBeDefined();
        // A foreign project the player lacks, used by the wreck (forced: its component is in the wreck).
        const node = player.research.techTree.find((n) => !n.isResearched && n.def.components.length > 0)!;
        field.wrecks[0].componentIds = [node.def.components[0]];

        // The right-click menu entry and the selection-panel row.
        const menu = wreckSalvageMenuItem(g, player, ship, field.x, field.y, 1);
        expect(menu?.item.label).toBe(`Salvage ${field.name}`);
        expect(wreckSalvageRows(g, ship, player)[0].value).toMatch(/right-click it to salvage/);

        expect(runPlayerCommand(g, player, 'salvageWreckField', [ship, field.id])).toBe(true);
        const job = salvageJobOf(g, ship)!;
        expect(job.phase).toBe('travel');
        const m = builtObjectMission(ship.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.MoveAndWait);
        expect(wreckSalvageRows(g, ship, player)[0].value).toMatch(/En route to|Salvaging/);

        // On site: arrival, then wreckSalvageDays later the recovery (tech chance forced to 1).
        ship.xpos = field.x;
        ship.ypos = field.y;
        g.scenario!.params.wreckTechChance = 1;
        salvageJobsTick(g);
        expect(job.arrivedStarDate).toBe(galaxyStarDate(g));
        job.arrivedStarDate -= (wreckParam(g, 'wreckSalvageDays') + 1) * GAME_DAY_LENGTH;
        const cargoBefore = (ship.cargo?.items ?? []).reduce((a, c) => a + c.amount, 0);
        salvageJobsTick(g);
        g.scenario!.params.wreckTechChance = 0.2;
        const cargoAfter = (ship.cargo?.items ?? []).reduce((a, c) => a + c.amount, 0);
        expect(cargoAfter).toBeGreaterThan(cargoBefore);
        expect(node.isResearched).toBe(true);
        expect(wreckFieldById(g, field.id)).toBeNull(); // its only wreck was taken
        expect(empireMessages(player).some((msg) => msg.description.includes('recovered foreign technology'))).toBe(true);
        const st = peekWreckageState(g)!;
        expect(st.stats.techsRecovered).toBe(1);

        // Return leg: delivered to the nearest space port.
        expect(job.phase).toBe('return');
        expect(wreckSalvageRows(g, ship, player)[0].value).toMatch(/Returning salvage to/);
        {
            const port = job.port!;
            const portCargo = (): number => (port.cargo?.items ?? []).filter((c) => c.empire === player).reduce((a, c) => a + c.amount, 0);
            const p0 = portCargo();
            ship.xpos = port.xpos;
            ship.ypos = port.ypos;
            salvageJobsTick(g);
            expect(portCargo()).toBe(p0 + (cargoAfter - cargoBefore));
        }
        expect(salvageJobOf(g, ship)).toBeNull();
    }, 600000);

    it('AI hook: an idle AI construction ship salvages a known field nearby; pirates too', () => {
        const g = shared.galaxy;
        const ai = g.empires.find((e) => e !== null && e !== g.playerEmpire && e !== g.independentEmpire && live(g).some((b) => b.actualEmpire === e && b.subRole === BuiltObjectSubRole.ConstructionShip))!;
        const ship = salvager(g, ai);
        const victim = live(g).find((b) => b.empire !== null && b.empire !== ai && b.role !== BuiltObjectRole.Base && b.components.count > 5)!;
        const vx = ship.xpos + 2000;
        const vy = ship.ypos;
        victim.xpos = vx;
        victim.ypos = vy;
        destroy(g, victim);
        const f = fieldOf(g, victim);
        ship.xpos = f.x + 3000;
        ship.ypos = f.y;
        if (!ai.visibility.knownGalaxyLocations.includes(f.location)) ai.visibility.knownGalaxyLocations.push(f.location);
        builtObjectMission(ship.mission)?.clear();
        scenarioEmit(g, 'constructionShipIdle', { empire: ai, ship });
        const job = salvageJobOf(g, ship)!;
        expect(job).not.toBeNull();
        expect(job.fieldId).toBe(f.id);
        expect(job.manual).toBe(false);
        expect(builtObjectMission(ship.mission)!.type).toBe(BuiltObjectMissionType.MoveAndWait);
        // One salvager per field per empire.
        const other = live(g).find((b) => b.actualEmpire === ai && b.subRole === BuiltObjectSubRole.ConstructionShip && b !== ship);
        if (other !== undefined && salvageJobOf(g, other) === null) {
            aiSalvageIdleShip(g, ai, other);
            expect(salvageJobOf(g, other)?.fieldId ?? -1).not.toBe(f.id);
        }

        const pirate = g.pirateEmpires.find((e) => e !== null && live(g).some((b) => b.actualEmpire === e && b.subRole === BuiltObjectSubRole.ConstructionShip));
        if (pirate !== undefined) {
            const ps = salvager(g, pirate);
            ps.xpos = f.x + 5000;
            ps.ypos = f.y;
            if (!pirate.visibility.knownGalaxyLocations.includes(f.location)) pirate.visibility.knownGalaxyLocations.push(f.location);
            builtObjectMission(ps.mission)?.clear();
            expect(aiSalvageIdleShip(g, pirate, ps)).toBe(true);
            expect(salvageJobOf(g, ps)!.fieldId).toBe(f.id);
        }
    }, 600000);

    it('pirates: raid countdowns recover faster near a big field', () => {
        const g = shared.galaxy;
        const f = peekWreckageState(g)!.fields[0];
        const big = wreckParam(g, 'wreckBigFieldShips');
        expect(scenarioQuery(g, 'raidCountdownRate', 1, { x: f.x, y: f.y })).toBe(1);
        const template = f.wrecks[0];
        while (f.wrecks.length < big) f.wrecks.push({ ...template, id: 100000 + f.wrecks.length });
        expect(scenarioQuery(g, 'raidCountdownRate', 1, { x: f.x + 1000, y: f.y })).toBe(wreckParam(g, 'wreckPirateRaidBoost'));
        expect(scenarioQuery(g, 'raidCountdownRate', 1, { x: f.x + wreckParam(g, 'wreckPirateRaidRange') * 2, y: f.y })).toBe(1);
        const near = live(g).find((b) => b.role === BuiltObjectRole.Base)!;
        const far = live(g).filter((b) => b.role === BuiltObjectRole.Base).sort((a, b) => g.calculateDistance(b.xpos, b.ypos, f.x, f.y) - g.calculateDistance(a.xpos, a.ypos, f.x, f.y))[0];
        const nx = near.xpos;
        const ny = near.ypos;
        near.xpos = f.x;
        near.ypos = f.y;
        near.raidCountdown = 60;
        far.raidCountdown = 60;
        updateRaidCountdownBuiltObject(g, near, 100);
        updateRaidCountdownBuiltObject(g, far, 100);
        near.xpos = nx;
        near.ypos = ny;
        expect(60 - far.raidCountdown).toBe(10);
        expect(60 - near.raidCountdown).toBe(20);
    }, 600000);
});

function saveText(game: Game): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: SC, flags: { wreckage: true }, params: {} } });
}

describe('19e-7 wreckage — faithful path, save', () => {
    it('flag off: the same seed-1 game and run as no scenario', () => {
        const ref = cachedTickGameRun(base, { seconds: 60 });
        const game = createScenarioGame(base, { scenario: SC, flags: { wreckage: false } }).game;
        expect(game.galaxy.scenario).not.toBeNull();
        runGameSeconds(game.galaxy, 60);
        expect('wreckage' in game.galaxy.scenario!.state).toBe(false);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
    }, 600000);

    it('a save with debris fields and a salvage job resumes identically', () => {
        const a = shared;
        const st = peekWreckageState(a.galaxy)!;
        expect(st.fields.length).toBeGreaterThan(0);
        expect(st.jobs.length).toBeGreaterThan(0);
        const text = saveText(a);
        const loaded = deserializeGame(text, scenarioGameData(base, SC)).game;
        const lst = peekWreckageState(loaded.galaxy)!;
        const summary = (g: Galaxy): string => {
            const s = peekWreckageState(g)!;
            return JSON.stringify({
                fields: s.fields.map((f) => [f.id, f.name, f.x, f.y, f.wrecks.map((w) => [w.id, w.builtObjectId, w.value, w.starDate, w.resources])]),
                jobs: s.jobs.map((j) => [j.ship.builtObjectID, j.fieldId, j.phase, j.arrivedStarDate]),
                stats: s.stats,
            });
        };
        expect(summary(loaded.galaxy)).toBe(summary(a.galaxy));
        for (const f of lst.fields) expect(loaded.galaxy.galaxyLocations).toContain(f.location);
        for (const j of lst.jobs) expect(loaded.galaxy.builtObjects).toContain(j.ship);
        runGameSeconds(a.galaxy, 60);
        runGameSeconds(loaded.galaxy, 60);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(a.galaxy));
        expect(summary(loaded.galaxy)).toBe(summary(a.galaxy));
    }, 600000);
});
