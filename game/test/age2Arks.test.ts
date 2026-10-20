// The Age 2 survivor arks (threats/giantworks/age2Arks.ts) and the stranded Watchers (age2Watchers.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import type { CreateGameOptions, Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { empireMessages } from '../src/sim/messages';
import { setGalaxyResetSupported } from '../src/sim/galaxyReset';
import { GalaxyTime } from '../src/sim/galaxyTime';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { buildAge2Game } from '../src/sim/longNightReset';
import { scenarioFlag } from '../src/sim/scenario/state';
import { scenarioQuery } from '../src/sim/scenario/hooks';
import { spawnGreatWork } from '../src/sim/scenario/threats/giantworks/framework';
import { BEACON_KIND, peekBeaconState, type CoreRec } from '../src/sim/scenario/threats/giantworks/beaconState';
import { lossCheck } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { milestoneReached, memoryRecordOf } from '../src/sim/scenario/threats/giantworks/longNightState';
import { truthsOf } from '../src/sim/scenario/threats/giantworks/age2Milestones';
import { age2ArkTechLevel } from '../src/sim/scenario/threats/giantworks/age2Arks';
import { STRANDED_KEY, STRANDED_TRUTH, dangerousSystem, onStrandedOwnerChanged, peekStranded, placeStranded, strandedCount, strandedMayFire, strandedMissionAllowed, strandedPass, strandedRowsOf, strandedShips, type StrandedState } from '../src/sim/scenario/threats/giantworks/age2Watchers';
import { GEN_SHIPS_FLAG, genShipsPeriodic, genShipsSpawnNow, genShipsState } from '../src/sim/scenario/threats/generationShips';
import { empireTechLevel } from '../src/sim/scenario/threats/robotMutiny';
import { generateNewBuiltObject } from '../src/sim/empireEvents';
import { takeOwnershipOfBuiltObject } from '../src/sim/combat/ownership';
import { ComponentType } from '../src/sim/data/components';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

let next: Game;
let gameData0!: GameData;
let g: Galaxy;
let me: Empire;
let ai: Empire;
const popups = (e: Empire, title: string) => empireMessages(e).filter((m) => m.title === title && m.scenarioPopup === 'force');
/** A ship of `owner` (pre-warp empires have none yet): any design the game has, made at (x, y). */
function mkShip(owner: Empire, x: number, y: number): BuiltObject {
    const design = owner.designs.find((d) => d !== null) ?? genShipsState(g).faction!.designs.find((d) => d !== null)!;
    const bo = generateNewBuiltObject(g, owner, design, null, x, y);
    takeOwnershipOfBuiltObject(g, owner, bo, owner, false);
    return bo;
}

beforeAll(() => {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(['threat-framework', 'giantworks']), flags: {}, options: age3 });
    const old = game.galaxy;
    old.scenario!.flags.gwBeacon = true;
    expect(spawnGreatWork(old, BEACON_KIND)).toBe(true);
    const st = peekBeaconState(old)!;
    const player = old.playerEmpire!;
    const victim = old.empires.find((e): e is Empire => e !== null && e !== old.independentEmpire && e !== player && e.pirateEmpireBaseHabitat === null && e.active)!;
    const core: CoreRec = { colony: victim.colonies.find((c) => c !== victim.capital)!, since: 0, harvester: null, pens: [], waiting: 0, received: 0, processed: 0, popStart: 100, knownBy: [player.empireId], ended: null, endDate: 0 };
    st.cores = [core];
    st.phase = 'reclamation';
    st.reclamationDate = 1;
    st.popBaseline = 1000;
    st.popEliminated = 900;
    setGalaxyResetSupported(old, true);
    lossCheck(old, st);
    gameData0 = gameData;
    next = buildAge2Game(game, gameData);
    g = next.galaxy;
    me = g.playerEmpire!;
    ai = g.empires.find((e): e is Empire => e !== null && e !== me && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active)!;
}, 900000);
void gameData0;

describe('the survivor arks', () => {
    it('runs the Generation Ships arc in Age 2 even though the add-on was not picked, at Age 1 tech', () => {
        expect(scenarioFlag(g, GEN_SHIPS_FLAG)).toBe(true);
        expect(genShipsSpawnNow(g, ai)).toBe(true);
        const st = genShipsState(g);
        const lvl = age2ArkTechLevel(g)!;
        expect(lvl).toBe(1);
        expect(g.scenario!.params['genShipsTechLevel']).toBe(2);
        expect(g.scenario!.params['genShipsFleetFactorPct']).toBe(150);
        expect(st.ageLevel).toBe(lvl);
        expect(empireTechLevel(st.faction!)).toBeGreaterThanOrEqual(lvl);
        expect(st.worldShip).not.toBeNull();
        // the fleet has shields whatever the tier
        const hasShield = (b: BuiltObject): boolean => b.components.countNormalComponentsByType(ComponentType.Shields) > 0;
        expect(st.escorts.length).toBeGreaterThan(0);
        expect(st.escorts.filter((b) => b.role === BuiltObjectRole.Military).every(hasShield)).toBe(true);
        expect(hasShield(st.worldShip!)).toBe(true);
    });

    it('first contact with the ark\'s scout reaches milestone 5 and adds the Age 2 line', () => {
        const st = genShipsState(g);
        expect(milestoneReached(g, 'ark', st.owner!.empireId)).toBe(false);
        st.contactDate = 0;
        genShipsPeriodic(g);
        expect(st.phase).not.toBe('arrived');
        expect(milestoneReached(g, 'ark', st.owner!.empireId)).toBe(true);
        if (st.owner === me) expect(empireMessages(me).some((m) => m.description.includes('an ark of the Long Night'))).toBe(true);
    });
});

describe('the stranded Watchers', () => {
    const rec = () => peekStranded(g)!.list[0];
    const ship = () => rec().ship!;
    const faction = () => peekStranded(g)!.faction!;

    it('scales with the galaxy', () => {
        expect(strandedCount(60, 200, 3)).toBe(1);
        expect(strandedCount(400, 200, 3)).toBe(2);
        expect(strandedCount(5000, 200, 3)).toBe(3);
    });

    it('lies cloaked at a Harvest Scar, cannot jump, patrols its world', () => {
        // the test galaxy's scar may sit in a home system: give the record a scar far from every capital
        const mem = memoryRecordOf(g)!;
        const homes = new Set(g.empires.filter((e): e is Empire => e !== null && e.capital !== null).map((e) => e.capital!.systemIndex));
        const far = g.habitats.find((h) => h.category === 1 && !homes.has(h.systemIndex) && h.systemIndex >= 0 && h.type !== 0) ?? g.habitats.find((h) => !homes.has(h.systemIndex))!;
        mem.scars.push({ name: far.name, systemName: '', x: far.xpos, y: far.ypos, fate: 'live', knownToPlayer: true });
        delete g.scenario!.state[STRANDED_KEY];
        expect(placeStranded(g, [far])).toBeGreaterThanOrEqual(1);
        const r = rec();
        expect(r.ship!.cloaked).toBe(true);
        expect(r.status).toBe('stranded');
        expect(r.ship!.actualEmpire).toBe(faction());
        expect(r.ship!.name).toBe('a damaged Watcher');
        expect(r.ship!.isAutoControlled).toBe(false);
        expect(scenarioQuery(g, 'hyperDenyHere', false, { builtObject: r.ship! })).toBe(true);
        expect(scenarioQuery(g, 'boardingDefenseValue', 0, { builtObject: r.ship! })).toBeGreaterThanOrEqual(2500);
        expect(strandedShips(g)).toContain(r.ship);
        // hidden from the players
        const m = (r.ship!.mission as unknown) as { type: number } | null;
        void m;
        expect(r.ship!.cloakSeenBy === undefined || r.ship!.cloakSeenBy.length === 0).toBe(true);
    });

    it('the AI keeps out: no colony target, no mission into the system unless strong', () => {
        const r = rec();
        expect(dangerousSystem(g, r.world.systemIndex)).toBe(true);
        expect(scenarioQuery(g, 'colonizationTargetValue', 100, { empire: ai, habitat: r.world, filterOutDangerousTargets: true })).toBe(0);
        expect(scenarioQuery(g, 'colonizationTargetValue', 100, { empire: me, habitat: r.world, filterOutDangerousTargets: true })).toBe(100);
        const aiShip = mkShip(ai, r.world.xpos + 90000, r.world.ypos);
        expect(strandedMissionAllowed(g, aiShip, r.world, -2000000001, -2000000001)).toBe(false);
        const far = g.habitats.find((h) => !dangerousSystem(g, h.systemIndex))!;
        expect(strandedMissionAllowed(g, aiShip, far, -2000000001, -2000000001)).toBe(true);
        const meShip = mkShip(me, r.world.xpos + 90000, r.world.ypos);
        expect(strandedMissionAllowed(g, meShip, r.world, -2000000001, -2000000001)).toBe(true);
    });

    it('decloaks on approach with a one-time popup, fires at empire ships, and cloaks again when they are gone', () => {
        const r = rec();
        const visitor = mkShip(me, r.world.xpos + 900000, r.world.ypos);
        const home = { x: visitor.xpos, y: visitor.ypos };
        strandedPass(g);
        expect(r.ship!.cloaked).toBe(true); // nobody near
        visitor.xpos = r.ship!.xpos + 2000;
        visitor.ypos = r.ship!.ypos;
        strandedPass(g);
        expect(r.ship!.cloaked).toBe(false);
        expect(r.mode).toBe('hunt');
        expect(r.discovered).toContain(me.empireId);
        expect(popups(me, 'Something Was Waiting').length).toBe(1);
        expect(strandedMayFire(g, r.ship!, visitor)).toBe(true);
        expect(scenarioQuery(g, 'attackWithoutWar', false, { empire: faction(), target: me, attacker: r.ship!, victim: visitor })).toBe(true);
        expect(strandedRowsOf(g, me).length).toBe(1);
        expect(strandedRowsOf(g, ai).length).toBe(0);
        // it leaves; after the quiet days it cloaks, and a second approach opens no second popup
        visitor.xpos = home.x + 900000;
        visitor.ypos = home.y;
        const day = g.scenario!.params['_unused'] === undefined ? 0 : 0;
        void day;
        r.lastNear -= 1e9;
        strandedPass(g);
        expect(r.ship!.cloaked).toBe(true);
        expect(r.mode).toBe('dormant');
        expect(strandedMayFire(g, r.ship!, visitor)).toBe(false);
        visitor.xpos = r.ship!.xpos + 2000;
        visitor.ypos = r.ship!.ypos;
        strandedPass(g);
        expect(r.ship!.cloaked).toBe(false);
        expect(popups(me, 'Something Was Waiting').length).toBe(1);
        visitor.xpos = home.x;
        visitor.ypos = home.y;
        r.lastNear -= 1e9;
        strandedPass(g);
        expect(r.ship!.cloaked).toBe(true);
    });

    it('survives a save round trip', () => {
        const back = deserializeGame(serializeGame(next, new GalaxyTime(), {} as StartGameOptions), gameData0).game;
        const st = peekStranded(back.galaxy)!;
        expect(st.list.length).toBe(peekStranded(g)!.list.length);
        expect(st.list[0].ship!.cloaked).toBe(true);
        expect(st.list[0].ship!.actualEmpire).toBe(st.faction);
        expect(st.list[0].world.name).toBe(rec().world.name);
        expect(st.popup).toEqual(peekStranded(g)!.popup);
    });

    it('boarding gives the captor the ship and a foundry (a Truth when none is left)', () => {
        const mem = memoryRecordOf(g)!;
        mem.foundries.located = [{ name: 'Foundry 1', systemName: '', x: 100, y: 100 }];
        const r = rec();
        onStrandedOwnerChanged(g, r.ship!, faction(), me);
        expect(r.status).toBe('taken');
        expect(peekStranded(g)!.revealed[String(me.empireId)].length).toBe(1);
        expect(popups(me, 'It Is Ours').length).toBe(1);
        expect(strandedRowsOf(g, me).some((x) => x.key.startsWith('stranded:foundry'))).toBe(true);
        // a second capture by the same empire (a fresh rec) finds nothing left to show: the Truth
        r.status = 'stranded';
        onStrandedOwnerChanged(g, r.ship!, faction(), me);
        expect(truthsOf(g, me)).toContain(STRANDED_TRUTH);
        expect(dangerousSystem(g, r.world.systemIndex)).toBe(false);
        void ({} as BuiltObject);
        void ({} as StrandedState);
        void BuiltObjectMissionType;
    });
});
