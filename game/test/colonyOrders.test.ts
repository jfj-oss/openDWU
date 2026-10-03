// The Colonies window's player commands (player/colonyOrders.ts via player/playerOps.ts): renameColony
// (Main.Part11.cs 4760 txtColonyName_Leave), setColonyAsCapital (Main.Part5.cs 2215 btnColonyMakeCapital_Click +
// BaconMain.OnChangeCapital), setColonyPopulationPolicy / applyPopulationPolicyToAll (Main.Part11.cs 2629 / 2643 /
// 2657), scrapColonyFacility (Main.Part6.cs 3696 btnColonyFacilityScrap_Click, Scrap and Attack) and
// colonyTransferToTransport (Main.Part6.cs 3525 btnColonyTroopTransferTransport_Click). Each: effect, rejection,
// seed + command log replay digest, save/load round trip. Driven from the age-3 harness game (six player colonies,
// troop ships).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { tickGameOptions } from './helpers/tickGame';
import { fullDigest } from './helpers/commandScript';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Habitat } from '../src/sim/types';
import type { BuiltObject } from '../src/sim/builtObject';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { nextFrameMs, runSimFrame, schedulerState } from '../src/sim/tick/scheduler';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { issuePlayerCommand, replayCommandLog, runPlayerCommand, runScheduledUntil, scheduleCommandLog } from '../src/sim/player/playerCommands';
import type { PlayerOpArgs, PlayerOpName } from '../src/sim/player/playerOps';
import { stateDigest } from '../src/sim/tick/digest';
import { ColonyPopulationPolicy } from '../src/sim/data/policies';
import { RaceEventType } from '../src/sim/eventTypes';
import { PlanetaryFacility, planetaryFacilityDefinitionsStatic } from '../src/sim/construction/facilities';
import { PlanetaryFacilityType, facilityType } from '../src/sim/researchSystem';
import { PirateColonyControl } from '../src/sim/pirates/pirateColonyControl';
import { Troop } from '../src/sim/cargo';
import { stellarObjectCharacters } from '../src/sim/characters';
import type { StartGameOptions } from '../src/sim/startGameOptions';

const AGE = 3;
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGame(): Game {
    return cachedTickGame(gameData, { age: AGE });
}

function saveLoad(game: Game): Game {
    const time = new GalaxyTime();
    time.bindGalaxy(game.galaxy);
    return deserializeGame(serializeGame(game, time, {} as StartGameOptions), gameData).game;
}

function frame(game: Game): void {
    runSimFrame(game.galaxy, nextFrameMs(schedulerState(game.galaxy), 1));
}

/** Issue the commands one frame apart (journaled), then check the replay digest and the save/load round trip. */
function replayAndSave(game: Game, steps: (() => void)[], check: (g: Game) => void, setup?: (g: Game) => void): void {
    setup?.(game);
    frame(game);
    for (const s of steps) {
        s();
        frame(game);
    }
    check(game);
    const log = commandLog(game.galaxy) as PlayerLogEntry[];
    expect(log.filter((e) => e.source === 'player').every((e) => e.error === undefined)).toBe(true);
    let replay: Game;
    if (setup === undefined) {
        // Seed + log from a fresh createGame.
        const { seed, ...o } = tickGameOptions(gameData);
        const options = { ...o, galaxyAge: AGE, player: { ...o.player, age: AGE }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: AGE })) };
        replay = replayCommandLog(seed, options, commandLog(game.galaxy), game.galaxy.nowMs);
    } else {
        // The same start state (the harness game + the same setup), then the log.
        replay = newGame();
        setup(replay);
        scheduleCommandLog(replay.galaxy, commandLog(game.galaxy));
        runScheduledUntil(replay.galaxy, game.galaxy.nowMs);
    }
    check(replay);
    expect(fullDigest(replay).digest).toBe(fullDigest(game).digest);
    const loaded = saveLoad(game);
    check(loaded);
    expect(stateDigest(loaded.galaxy)).toBe(stateDigest(game.galaxy));
}

function issue<K extends PlayerOpName>(game: Game, op: K, args: PlayerOpArgs<K>): () => void {
    return () => issuePlayerCommand(game.galaxy, game.playerEmpire, op, args);
}

function colonyAt(game: Game, i: number): Habitat {
    return game.playerEmpire.colonies[i];
}

function foreignColony(game: Game): Habitat {
    const h = game.galaxy.empires.find((e) => e !== game.playerEmpire && e.colonies.length > 0)!.colonies[0];
    expect(h).toBeDefined();
    return h;
}

describe('renameColony (txtColonyName_Leave)', () => {
    it('renames an own colony (trimmed); blank, unchanged and foreign colonies are rejected', () => {
        const game = newGame();
        const g = game.galaxy;
        const p = game.playerEmpire;
        const h = colonyAt(game, 1);
        const old = h.name;
        const foreign = foreignColony(game);
        const foreignName = foreign.name;
        expect(runPlayerCommand(g, p, 'renameColony', [h, '   '])).toBe(false);
        expect(runPlayerCommand(g, p, 'renameColony', [h, old])).toBe(false);
        expect(runPlayerCommand(g, p, 'renameColony', [foreign, 'Mine'])).toBe(false);
        expect(h.name).toBe(old);
        expect(foreign.name).toBe(foreignName);
        expect(runPlayerCommand(g, p, 'renameColony', [h, '  New Haven  '])).toBe(true);
        expect(h.name).toBe('New Haven');
    }, 300000);

    it('replays from the log and survives save/load', () => {
        const game = newGame();
        const idx = colonyAt(game, 2).habitatIndex;
        replayAndSave(game, [issue(game, 'renameColony', [colonyAt(game, 2), 'Port Zeta'])], (x) => expect(x.galaxy.habitats[idx].name).toBe('Port Zeta'));
    }, 2400000);
});

describe('setColonyAsCapital (btnColonyMakeCapital_Click)', () => {
    it('moves the capital, recalculates distance factors, carries the capital-held Expanded values; rejects foreign colonies', () => {
        const game = newGame();
        const g = game.galaxy;
        const p = game.playerEmpire;
        const old = p.capital!;
        const next = p.colonies.find((h) => h !== old)!;
        expect(runPlayerCommand(g, p, 'setColonyAsCapital', [foreignColony(game)])).toBe(false);
        expect(p.capital).toBe(old);
        old.baconValues = new Map<string, unknown>([['scientificData', 42], ['capturedSpies', 3], ['other', 1]]);
        expect(runPlayerCommand(g, p, 'setColonyAsCapital', [next])).toBe(true);
        expect(p.capital).toBe(next);
        expect(next.distanceFactor).toBe(0);
        expect(old.distanceFactor).toBeGreaterThan(0);
        expect([...next.baconValues!]).toEqual([['scientificData', 42], ['capturedSpies', 3]]);
        expect([...old.baconValues]).toEqual([['other', 1]]);
        // Survives save/load (capital and the moved values).
        const loaded = saveLoad(game);
        expect(loaded.playerEmpire.capital!.habitatIndex).toBe(next.habitatIndex);
        expect(loaded.galaxy.habitats[next.habitatIndex].baconValues!.get('scientificData')).toBe(42);
    }, 300000);

    it('replays from the log and survives save/load', () => {
        const game = newGame();
        const target = game.playerEmpire.colonies.find((h) => h !== game.playerEmpire.capital)!;
        const idx = target.habitatIndex;
        replayAndSave(game, [issue(game, 'setColonyAsCapital', [target])], (x) => {
            expect(x.playerEmpire.capital!.habitatIndex).toBe(idx);
            expect(x.galaxy.habitats[idx].distanceFactor).toBe(0);
        });
    }, 2400000);
});

describe('setColonyPopulationPolicy / applyPopulationPolicyToAll', () => {
    it('sets either drop-down; rejects bad values, foreign colonies, Assimilate under XenophobiaNoAssimilate, locked colonies', () => {
        const game = newGame();
        const g = game.galaxy;
        const p = game.playerEmpire;
        const h = colonyAt(game, 0);
        h.colonyPopulationPolicy = ColonyPopulationPolicy.Assimilate;
        h.colonyPopulationPolicyRaceFamily = ColonyPopulationPolicy.Assimilate;
        expect(runPlayerCommand(g, p, 'setColonyPopulationPolicy', [h, false, 7])).toBe(false);
        expect(runPlayerCommand(g, p, 'setColonyPopulationPolicy', [h, false, 1.5])).toBe(false);
        expect(runPlayerCommand(g, p, 'setColonyPopulationPolicy', [foreignColony(game), false, ColonyPopulationPolicy.Enslave])).toBe(false);
        expect(runPlayerCommand(g, p, 'setColonyPopulationPolicy', [h, false, ColonyPopulationPolicy.Enslave])).toBe(true);
        expect(h.colonyPopulationPolicy).toBe(ColonyPopulationPolicy.Enslave);
        expect(h.colonyPopulationPolicyRaceFamily).toBe(ColonyPopulationPolicy.Assimilate);
        expect(runPlayerCommand(g, p, 'setColonyPopulationPolicy', [h, true, ColonyPopulationPolicy.Resettle])).toBe(true);
        expect(h.colonyPopulationPolicyRaceFamily).toBe(ColonyPopulationPolicy.Resettle);
        h.raceEventType = RaceEventType.XenophobiaNoAssimilate;
        expect(runPlayerCommand(g, p, 'setColonyPopulationPolicy', [h, false, ColonyPopulationPolicy.Assimilate])).toBe(false);
        expect(runPlayerCommand(g, p, 'setColonyPopulationPolicy', [h, false, ColonyPopulationPolicy.DoNotAccept])).toBe(true);
        h.raceEventType = RaceEventType.AntiXenoRiotsExterminate;
        expect(runPlayerCommand(g, p, 'setColonyPopulationPolicy', [h, false, ColonyPopulationPolicy.Exterminate])).toBe(false);
        expect(h.colonyPopulationPolicy).toBe(ColonyPopulationPolicy.DoNotAccept);

        // Apply to All: every colony, no race event check; bad values rejected.
        expect(runPlayerCommand(g, p, 'applyPopulationPolicyToAll', [9, 0])).toBe(0);
        expect(runPlayerCommand(g, p, 'applyPopulationPolicyToAll', [ColonyPopulationPolicy.Assimilate, ColonyPopulationPolicy.Exterminate])).toBe(p.colonies.length);
        for (const c of p.colonies) {
            expect(c.colonyPopulationPolicyRaceFamily).toBe(ColonyPopulationPolicy.Assimilate);
            expect(c.colonyPopulationPolicy).toBe(ColonyPopulationPolicy.Exterminate);
        }
        const f = foreignColony(game);
        expect(f.colonyPopulationPolicy).not.toBe(99);
    }, 300000);

    it('replays from the log and survives save/load', () => {
        const game = newGame();
        const h = colonyAt(game, 1);
        const idx = h.habitatIndex;
        const others = game.playerEmpire.colonies.map((c) => c.habitatIndex);
        replayAndSave(
            game,
            [issue(game, 'applyPopulationPolicyToAll', [ColonyPopulationPolicy.DoNotAccept, ColonyPopulationPolicy.Resettle]), issue(game, 'setColonyPopulationPolicy', [h, true, ColonyPopulationPolicy.Enslave])],
            (x) => {
                expect(x.galaxy.habitats[idx].colonyPopulationPolicyRaceFamily).toBe(ColonyPopulationPolicy.Enslave);
                for (const i of others) expect(x.galaxy.habitats[i].colonyPopulationPolicy).toBe(ColonyPopulationPolicy.Resettle);
            },
        );
    }, 2400000);
});

describe('scrapColonyFacility (btnColonyFacilityScrap_Click)', () => {
    /** A plain (non-pirate, non-wonder) facility at the first player colony (none is buildable at this tech level). */
    function plain(game: Game): { h: Habitat; def: ReturnType<typeof planetaryFacilityDefinitionsStatic>[number] } {
        const def = planetaryFacilityDefinitionsStatic(game.galaxy).find((d) => ![PlanetaryFacilityType.PirateBase, PlanetaryFacilityType.PirateFortress, PlanetaryFacilityType.PirateCriminalNetwork, PlanetaryFacilityType.Wonder].includes(facilityType(d)))!;
        return { h: colonyAt(game, 0), def };
    }

    function pirateDef(game: Game) {
        return planetaryFacilityDefinitionsStatic(game.galaxy).find((d) => facilityType(d) === PlanetaryFacilityType.PirateBase)!;
    }

    it('scraps the colony owner\'s facility; rejects a stale pick, a foreign colony, a facility it can not attack', () => {
        const game = newGame();
        const g = game.galaxy;
        const p = game.playerEmpire;
        const { h, def } = plain(game);
        h.facilities = [...(h.facilities ?? []), new PlanetaryFacility(def, 1)];
        const i = h.facilities.length - 1;
        expect(runPlayerCommand(g, p, 'scrapColonyFacility', [h, i, def.facilityId + 1])).toBe('rejected');
        expect(runPlayerCommand(g, p, 'scrapColonyFacility', [h, i + 1, def.facilityId])).toBe('rejected');
        const f = foreignColony(game);
        f.facilities = [...(f.facilities ?? []), new PlanetaryFacility(def, 1)];
        expect(runPlayerCommand(g, p, 'scrapColonyFacility', [f, f.facilities.length - 1, def.facilityId])).toBe('rejected');
        expect(runPlayerCommand(g, p, 'scrapColonyFacility', [h, i, def.facilityId])).toBe('scrapped');
        expect(h.facilities.length).toBe(i);

        // A pirate faction's base (facility control) at the colony: "Attack" — rejected without troops, then started.
        const pirate = g.pirateEmpires[0];
        expect(pirate).toBeDefined();
        const pd = pirateDef(game);
        h.facilities.push(new PlanetaryFacility(pd, 1));
        h.pirateColonyControl.add(new PirateColonyControl(pirate.empireId, 0.5, true));
        const j = h.facilities.length - 1;
        const troops = h.troops;
        h.troops = null;
        expect(runPlayerCommand(g, p, 'scrapColonyFacility', [h, j, pd.facilityId])).toBe('rejected');
        h.troops = troops;
        expect(h.troops!.count).toBeGreaterThan(0);
        expect(runPlayerCommand(g, p, 'scrapColonyFacility', [h, j, pd.facilityId])).toBe('attack');
        expect(h.facilities[j]?.def).toBe(pd); // not scrapped
        expect(h.invasionStats).not.toBeNull();
    }, 300000);

    it('replays from the log and survives save/load', () => {
        const game = newGame();
        const idx = colonyAt(game, 0).habitatIndex;
        const add = (x: Game): void => {
            const { h, def } = plain(x);
            h.facilities = [...(h.facilities ?? []), new PlanetaryFacility(def, 1)];
        };
        const { def } = plain(game);
        let before = -1;
        replayAndSave(
            game,
            [
                () => {
                    const h = colonyAt(game, 0);
                    before = h.facilities!.length - 1;
                    issuePlayerCommand(game.galaxy, game.playerEmpire, 'scrapColonyFacility', [h, before, def.facilityId]);
                },
            ],
            (x) => expect(x.galaxy.habitats[idx].facilities!.length).toBe(before),
            add,
        );
    }, 2400000);
});

describe('colonyTransferToTransport (btnColonyTroopTransferTransport_Click)', () => {
    function transport(game: Game): BuiltObject {
        const b = game.playerEmpire.builtObjects.find((x) => x !== null && x.troopCapacity > 0 && x.troops !== null && x.troopCapacityRemaining > 0)!;
        expect(b).toBeDefined();
        return b;
    }

    it('moves a troop (ungarrisoned) onto the transport; rejects foreign / full / not-at-colony cases', () => {
        const game = newGame();
        const g = game.galaxy;
        const p = game.playerEmpire;
        const h = p.colonies.find((c) => (c.troops?.count ?? 0) > 0)!;
        const b = transport(game);
        const troop = h.troops!.items[0];
        troop.garrisoned = true;
        const foreignShip = g.empires.find((e) => e !== p)!.builtObjects.find((x) => x !== null && x.troops !== null)!;
        if (foreignShip) expect(runPlayerCommand(g, p, 'colonyTransferToTransport', [h, troop, foreignShip])).toBe(false);
        const other = p.colonies.find((c) => c !== h)!;
        expect(runPlayerCommand(g, p, 'colonyTransferToTransport', [other, troop, b])).toBe(false);
        const saved = b.troopCapacity;
        b.troopCapacity = 0;
        expect(runPlayerCommand(g, p, 'colonyTransferToTransport', [h, troop, b])).toBe(false);
        b.troopCapacity = saved;
        expect(h.troops!.contains(troop)).toBe(true);
        expect(runPlayerCommand(g, p, 'colonyTransferToTransport', [h, troop, b])).toBe(true);
        expect(h.troops!.contains(troop)).toBe(false);
        expect(b.troops!.contains(troop)).toBe(true);
        expect(troop.garrisoned).toBe(false);
        expect(troop.atColony).toBe(false);
        expect(troop.builtObject).toBe(b);
        expect(runPlayerCommand(g, p, 'colonyTransferToTransport', [h, troop, b])).toBe(false);
    }, 300000);

    it('moves a character at the colony onto the transport', () => {
        const game = newGame();
        const g = game.galaxy;
        const p = game.playerEmpire;
        const h = p.colonies.find((c) => (stellarObjectCharacters(c) ?? []).some((ch) => ch.empire === p && ch.transferDestination === null))!;
        expect(h).toBeDefined();
        const ch = stellarObjectCharacters(h)!.find((x) => x.empire === p && x.transferDestination === null)!;
        const b = transport(game);
        expect(runPlayerCommand(g, p, 'colonyTransferToTransport', [foreignColony(game), ch, b])).toBe(false);
        expect(runPlayerCommand(g, p, 'colonyTransferToTransport', [h, ch, b])).toBe(true);
        expect(ch.location).toBe(b);
        expect(stellarObjectCharacters(h)!.includes(ch)).toBe(false);
    }, 300000);

    it('replays from the log and survives save/load', () => {
        const game = newGame();
        const h = game.playerEmpire.colonies.find((c) => (c.troops?.count ?? 0) > 0)!;
        const b = transport(game);
        const troop = h.troops!.items[0];
        const id = b.builtObjectID;
        const name = troop.name;
        replayAndSave(game, [issue(game, 'colonyTransferToTransport', [h, troop, b])], (x) => {
            const ship = x.playerEmpire.builtObjects.find((o) => o !== null && o.builtObjectID === id)!;
            expect(ship.troops!.items.some((t) => t instanceof Troop && t.name === name)).toBe(true);
        });
    }, 2400000);
});
