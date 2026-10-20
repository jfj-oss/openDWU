// The Age 2 Precursor holdouts (threats/giantworks/age2Holdouts.ts): placement, no expansion, the core's shield until every colony is gone, the
// rigged colonies (warning, destruction), the core's tech to the conqueror, the Knowledge rows and the save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import { AutomationLevel } from '../src/sim/empire';
import type { Game } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { empireMessages } from '../src/sim/messages';
import { setGalaxyResetSupported } from '../src/sim/galaxyReset';
import { buildAge2Game } from '../src/sim/longNightReset';
import { spawnGreatWork } from '../src/sim/scenario/threats/giantworks/framework';
import { BEACON_KIND, peekBeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { lossCheck } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { runGameSeconds } from '../src/sim/tick/harness';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { declareWar } from '../src/sim/diplomacyTick';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { factionDesign, placeObject } from '../src/sim/scenario/threats/giantworks/lifecycle';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { scenarioQuery } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { empireTechLevel } from '../src/sim/scenario/threats/robotMutiny';
import {
    HOLDOUT_MIN_TECH, COLONIES_MIN, COLONIES_MAX, EVAC_FREIGHTERS, coloniesLeft, coreShielded, holdoutCount, holdoutKnowledgeRows, holdoutsDaily, peekHoldouts, type HoldoutRec,
} from '../src/sim/scenario/threats/giantworks/age2Holdouts';
import { peekLongNight } from '../src/sim/scenario/threats/giantworks/longNightState';

let base: GameData;
let gameData: GameData;
let saved: string;
let built: Game;
beforeAll(async () => {
    base = await loadGameDataFs();
    const made = createScenarioGame(base, {
        scenario: comboOverlayFs(['threat-framework', 'giantworks']),
        flags: {},
        options: (o) => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) }),
    });
    const old = made.game;
    gameData = made.gameData;
    const g = old.galaxy;
    g.scenario!.flags.gwBeacon = true;
    expect(spawnGreatWork(g, BEACON_KIND)).toBe(true);
    const st = peekBeaconState(g)!;
    st.phase = 'reclamation';
    st.reclamationDate = 1;
    st.popBaseline = 1000;
    st.popEliminated = 900;
    st.cores = [{ colony: g.playerEmpire!.capital!, since: 0, harvester: null, pens: [], waiting: 0, received: 0, processed: 0, popStart: 100, knownBy: [], ended: 'broken', endDate: 0 }];
    setGalaxyResetSupported(g, true);
    lossCheck(g, st);
    expect(peekLongNight(g)!.pending).not.toBeNull();
    built = buildAge2Game(old, gameData);
    saved = serializeGame(built, new GalaxyTime(), {} as StartGameOptions);
}, 900000);

/** A fresh copy of the built Age 2 world. */
function world(): Game {
    return deserializeGame(saved, gameData).game;
}

function otherEmpire(g: Game['galaxy'], rec: HoldoutRec): Empire {
    return g.empires.find((e): e is Empire => e !== null && e !== g.independentEmpire && e !== rec.empire && e.pirateEmpireBaseHabitat === null && e.active && !peekHoldouts(g)!.holdouts.some((h) => h.empire === e))!;
}

describe('the Precursor holdouts', () => {
    it('are placed when the Age 2 galaxy is built: a core and nearby colonies each, clear of the homes, at a higher tech', () => {
        const g = built.galaxy;
        const st = peekHoldouts(g)!;
        expect(st.holdouts.length).toBeGreaterThanOrEqual(2);
        expect(st.holdouts.length).toBeLessThanOrEqual(5);
        expect(holdoutCount(g.starCount)).toBeGreaterThanOrEqual(st.holdouts.length);
        const homes = g.empires.filter((e): e is Empire => e !== null && !st.holdouts.some((h) => h.empire === e) && e !== g.independentEmpire && e.capital !== null && e.pirateEmpireBaseHabitat === null);
        const ordinaryBest = Math.max(...homes.map((e) => empireTechLevel(e)));
        for (const rec of st.holdouts) {
            expect(rec.empire.capital).toBe(rec.core);
            expect(rec.core.empire).toBe(rec.empire);
            expect(rec.colonies.length).toBeGreaterThanOrEqual(1);
            expect(rec.colonies.length).toBeLessThanOrEqual(COLONIES_MAX);
            expect(rec.colonies.length).toBeGreaterThanOrEqual(Math.min(COLONIES_MIN, rec.colonies.length));
            for (const c of rec.colonies) {
                expect(c.habitat.empire).toBe(rec.empire);
                expect(g.calculateDistance(c.habitat.xpos, c.habitat.ypos, rec.core.xpos, rec.core.ypos)).toBeLessThanOrEqual(2.01 * g.sectorSize);
            }
            for (const e of homes) expect(e.capital!.systemIndex).not.toBe(rec.core.systemIndex);
            expect(empireTechLevel(rec.empire)).toBeGreaterThanOrEqual(HOLDOUT_MIN_TECH);
            expect(empireTechLevel(rec.empire)).toBeGreaterThan(ordinaryBest);
            expect(rec.empire.research.techTree.some((n) => n.isResearched && n.def.name.includes('Shield'))).toBe(true);
            expect(coreShielded(rec)).toBe(true);
        }
        // spread out
        for (const a of st.holdouts) for (const b of st.holdouts) if (a !== b) expect(g.calculateDistance(a.core.xpos, a.core.ypos, b.core.xpos, b.core.ypos)).toBeGreaterThanOrEqual(2.9 * g.sectorSize);
    });

    it('never expand: the stock AI runs without colonisation, offence or treaties, and a run adds no colony and no war', () => {
        const game = world();
        const g = game.galaxy;
        const st = peekHoldouts(g)!;
        const before = st.holdouts.map((r) => r.empire.colonies.length);
        for (const rec of st.holdouts) {
            expect(rec.empire.controlColonization).toBe(AutomationLevel.Undefined);
            expect(rec.empire.controlDiplomacyOffense).toBe(AutomationLevel.Undefined);
            expect(rec.empire.controlDiplomacyTreaties).toBe(AutomationLevel.Undefined);
        }
        runGameSeconds(game, 600);
        const after = peekHoldouts(g)!;
        after.holdouts.forEach((r, i) => {
            expect(r.empire.colonies.length).toBeLessThanOrEqual(before[i]);
            for (const e of g.empires) {
                if (e === null || e === r.empire || e === g.independentEmpire) continue;
                const rel = r.empire.diplomaticRelations.byEmpire(e);
                expect(rel === null ? 'x' : String(rel.type)).not.toBe('7'); // never at war
            }
        });
    }, 600000);

    it('shield the core from invasion until every colony is taken; then the shield drops with a message', () => {
        const game = world();
        const g = game.galaxy;
        const me = g.playerEmpire!;
        const rec = peekHoldouts(g)!.holdouts[0];
        expect(scenarioQuery(g, 'invasionBlocked', false, { habitat: rec.core, invader: me })).toBe(true);
        expect(empireMessages(me).some((m) => m.title.includes('cannot be invaded'))).toBe(true);
        // a colony elsewhere is not shielded
        expect(scenarioQuery(g, 'invasionBlocked', false, { habitat: rec.colonies[0].habitat, invader: me })).toBe(false);
        rec.colonies.forEach((c) => (c.rigged = false));
        const n = rec.colonies.length;
        rec.colonies.forEach((c, i) => {
            expect(coreShielded(rec)).toBe(true);
            expect(coloniesLeft(rec)).toBe(n - i);
            takeOwnershipOfColonyFull(g, me, c.habitat, me, false, false);
        });
        expect(coloniesLeft(rec)).toBe(0);
        expect(rec.shield).toBe(false);
        expect(coreShielded(rec)).toBe(false);
        expect(scenarioQuery(g, 'invasionBlocked', false, { habitat: rec.core, invader: me })).toBe(false);
        expect(empireMessages(me).some((m) => m.title.includes('has fallen') && m.scenarioPopup === 'force')).toBe(true);
        for (const c of rec.colonies) expect(c.habitat.hasBeenDestroyed).toBe(false);
    }, 300000);

    it('rig some colonies: taking one destroys it with the planet-destroyer effect a day later; a plain one stands', () => {
        const game = world();
        const g = game.galaxy;
        const me = g.playerEmpire!;
        const rec = peekHoldouts(g)!.holdouts[0];
        expect(rec.colonies.length).toBeGreaterThanOrEqual(1);
        const rigged = rec.colonies[0];
        rigged.rigged = true;
        takeOwnershipOfColonyFull(g, me, rigged.habitat, me, false, false);
        expect(rigged.habitat.hasBeenDestroyed).toBe(false);
        expect(peekHoldouts(g)!.pending.length).toBe(1);
        const st = peekHoldouts(g)!;
        st.pending[0].due = galaxyStarDate(g) - 1;
        holdoutsDaily(g);
        expect(rigged.habitat.hasBeenDestroyed).toBe(true);
        expect(rigged.habitat.explosion).not.toBeNull();
        expect(rigged.fate).toBe('blown');
        expect(peekHoldouts(g)!.pending.length).toBe(0);
        expect(empireMessages(me).some((m) => m.title.includes('has been destroyed'))).toBe(true);
        if (rec.colonies.length > 1) {
            const plain = rec.colonies[1];
            plain.rigged = false;
            takeOwnershipOfColonyFull(g, me, plain.habitat, me, false, false);
            expect(peekHoldouts(g)!.pending.length).toBe(0);
            holdoutsDaily(g);
            expect(plain.habitat.hasBeenDestroyed).toBe(false);
        }
    }, 300000);

    it('warn first: an enemy fleet over a rigged colony sends evacuation freighters out and a message', () => {
        const game = world();
        const g = game.galaxy;
        const me = g.playerEmpire!;
        const rec = peekHoldouts(g)!.holdouts[0];
        const c = rec.colonies[0];
        rec.colonies.forEach((x) => (x.rigged = x === c));
        holdoutsDaily(g);
        expect(c.fled).toBe(false); // nobody at war near it
        declareWar(g, me, rec.empire);
        const design = factionDesign(g, me, BuiltObjectSubRole.Frigate, true)!;
        expect(design).not.toBeNull();
        const ship = placeObject(g, me, design, c.habitat, null, true);
        expect(ship.role).toBe(BuiltObjectRole.Military);
        ship.xpos = c.habitat.xpos + 50;
        ship.ypos = c.habitat.ypos + 50;
        const before = rec.empire.builtObjects.length;
        holdoutsDaily(g);
        expect(c.fled).toBe(true);
        expect(peekHoldouts(g)!.evacuees.length).toBe(EVAC_FREIGHTERS);
        expect(rec.empire.builtObjects.length).toBeGreaterThanOrEqual(before + EVAC_FREIGHTERS);
        expect(empireMessages(me).some((m) => m.title.includes('fleeing') && m.scenarioPopup === 'force')).toBe(true);
        // once only
        holdoutsDaily(g);
        expect(peekHoldouts(g)!.evacuees.length).toBe(EVAC_FREIGHTERS);
    }, 300000);

    it('hand the core\'s tech to whoever conquers it', () => {
        const game = world();
        const g = game.galaxy;
        const me = g.playerEmpire!;
        const rec = peekHoldouts(g)!.holdouts[0];
        rec.colonies.forEach((c) => (c.rigged = false));
        const has = (e: Empire): number => e.research.techTree.filter((n) => n.isResearched).length;
        const holdoutHas = rec.empire.research.techTree.filter((n) => n.isResearched && n.def.techLevel < 100);
        const mine0 = has(me);
        expect(holdoutHas.length).toBeGreaterThan(mine0);
        takeOwnershipOfColonyFull(g, me, rec.core, me, false, false);
        expect(rec.coreFate).toBe('taken');
        expect(rec.techTo).toBe(me.empireId);
        expect(has(me)).toBeGreaterThan(mine0);
        const mine = new Set(me.research.techTree.filter((n) => n.isResearched).map((n) => n.def.projectId));
        const given = holdoutHas.filter((n) => mine.has(n.def.projectId)).length;
        expect(given).toBeGreaterThanOrEqual(Math.floor(holdoutHas.length * 0.9));
        expect(empireMessages(me).some((m) => m.scenarioPopup === 'force' && m.title.includes('is ours'))).toBe(true);
    }, 300000);

    it('list the holdouts the viewer has found on the Knowledge page, with the shield state', () => {
        const game = world();
        const g = game.galaxy;
        const me = g.playerEmpire!;
        const rec = peekHoldouts(g)!.holdouts[0];
        const rows0 = holdoutKnowledgeRows(g, me).filter((r) => r.key.startsWith(`holdout:${rec.id}:`));
        const explored = me.visibility.checkSystemExplored(rec.core.systemIndex);
        expect(rows0.some((r) => r.key.endsWith(':core'))).toBe(explored);
        me.visibility.setSystemVisibility(g.determineHabitatSystemStar(rec.core), SystemVisibilityStatus.Explored);
        const rows = holdoutKnowledgeRows(g, me).filter((r) => r.key.startsWith(`holdout:${rec.id}:`));
        {
            const core = rows.find((r) => r.key.endsWith(':core'))!;
            expect(core.status).toMatch(/shielded/);
            expect(core.goTo).toBe(rec.core);
        }
    });

    it('survive a save and load with their references intact', () => {
        const game = world();
        const a = peekHoldouts(built.galaxy)!;
        const b = peekHoldouts(game.galaxy)!;
        expect(b.holdouts.map((r) => [r.empire.name, r.core.name, r.colonies.map((c) => [c.habitat.name, c.rigged, c.fate])])).toEqual(a.holdouts.map((r) => [r.empire.name, r.core.name, r.colonies.map((c) => [c.habitat.name, c.rigged, c.fate])]));
        for (const r of b.holdouts) {
            expect(game.galaxy.empires.includes(r.empire)).toBe(true);
            expect(game.galaxy.habitats.includes(r.core)).toBe(true);
            expect(r.core.empire).toBe(r.empire);
            expect(coreShielded(r)).toBe(true);
        }
    }, 300000);
});
