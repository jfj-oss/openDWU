// The Age 2 world content (threats/giantworks/age2World.ts): the old capitals as stock ruins that hand a dead empire's mega-station parts to the first
// surveyor, and the Reclaimer hulks mixed into the abandoned ships.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Game } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { empireMessages } from '../src/sim/messages';
import { setGalaxyResetSupported } from '../src/sim/galaxyReset';
import { buildAge2Game } from '../src/sim/longNightReset';
import { investigateRuins } from '../src/sim/exploration';
import { investigateAbandonedBuiltObject } from '../src/sim/combat/ownership';
import { RuinType } from '../src/sim/ruins';
import { BuiltObjectEncounterEventType } from '../src/sim/gameStartTail';
import { spawnGreatWork } from '../src/sim/scenario/threats/giantworks/framework';
import { BEACON_KIND, peekBeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { lossCheck } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { AGE2_WORLD_ID, FALLEN_ID, MAX_BATTLE_SYSTEMS, MAX_SIZE_RUINS, WRECKS_MAX, WRECKS_MIN, age2WorldOf, hulkCount, onCapitalDestroyed, type FallenCapitalRec, type OldCapitalRec } from '../src/sim/scenario/threats/giantworks/age2World';
import { memoryRecordOf, peekLongNight } from '../src/sim/scenario/threats/giantworks/longNightState';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

describe('the Age 2 world', () => {
    let old: Game;
    let next: Game;
    let gameData: GameData;
    let injected: OldCapitalRec;
    beforeAll(() => {
        const made = createScenarioGame(base, {
            scenario: comboOverlayFs(['threat-framework', 'giantworks']),
            flags: {},
            options: (o) => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) }),
        });
        old = made.game;
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
        // two capitals fall in the war: one destroyed (recorded by the event), one injected as captured
        const victims = g.empires.filter((e): e is Empire => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.capital !== null);
        onCapitalDestroyed(g, victims[1].capital!);
        setGalaxyResetSupported(g, true);
        lossCheck(g, st);
        // a dead empire that held parts: its capital is the player's old home world for the position; the record is put in by hand
        const cap = g.playerEmpire!.capital!;
        injected = { empire: 'The Fallen', race: 'Ackdarian', name: cap.name, systemName: 'x', x: cap.xpos, y: cap.ypos, size: 0, parts: { beamLens: true, mindFragments: 3 } };
        const mem = peekLongNight(g)!.pending!;
        const c0 = victims[0].capital!;
        (mem.extra[FALLEN_ID] as FallenCapitalRec[]).push({ empire: victims[0].name, name: c0.name, systemName: 'y', x: c0.xpos, y: c0.ypos, date: 5, how: 'captured' });
        (mem.extra[AGE2_WORLD_ID] as OldCapitalRec[]).push(injected);
        next = buildAge2Game(old, gameData);
    }, 900000);

    it('captures the biggest capitals, at most the cap, from the living empires', () => {
        const recs = memoryRecordOf(next.galaxy)!.extra[AGE2_WORLD_ID] as OldCapitalRec[];
        const living = recs.filter((r) => r.size > 0);
        expect(living.length).toBeGreaterThan(0);
        expect(living.length).toBeLessThanOrEqual(MAX_SIZE_RUINS);
        for (let i = 1; i < living.length; i++) expect(living[i - 1].size).toBeGreaterThanOrEqual(living[i].size);
    });

    it('puts a stock ruin for each capital, never in a home system, with money and research to find', () => {
        const g = next.galaxy;
        const w = age2WorldOf(g)!;
        const recs = memoryRecordOf(g)!.extra[AGE2_WORLD_ID] as OldCapitalRec[];
        expect(w.ruins.length).toBe(recs.length);
        const homes = new Set(g.empires.filter((e): e is Empire => e !== null && e.capital !== null).map((e) => e.capital!.systemIndex));
        for (const s of w.ruins) {
            expect(s.habitat.ruin!.type).toBe(RuinType.Standard);
            expect(s.habitat.ruin!.researchBonus).toBeGreaterThan(0);
            expect(s.habitat.ruin!.moneyBonus).toBeGreaterThan(0);
            expect(homes.has(s.habitat.systemIndex)).toBe(false);
            expect(s.habitat.owner).toBeNull();
            expect(g.ruinsHabitats.includes(s.habitat)).toBe(true);
        }
        expect(w.ruins.length).toBe(new Set(w.ruins.map((s) => s.habitat)).size);
    });

    it('the first surveyor gets the dead empire\'s parts, once, and a human is told', () => {
        const g = next.galaxy;
        const me = g.playerEmpire!;
        const site = age2WorldOf(g)!.ruins.find((s) => s.empire === 'The Fallen')!;
        const held = (e: Empire) => peekBeaconState(g)?.parts?.held[String(e.empireId)];
        const before = held(me)?.mindFragments ?? 0;
        investigateRuins(g, me, site.habitat);
        expect(held(me)?.beamLens).toBe(true);
        expect(held(me)?.mindFragments).toBe(before + 3);
        expect(site.parts).toBeNull();
        expect(empireMessages(me).some((m) => m.scenarioPopup === 'force' && m.title.includes('Left Behind'))).toBe(true);
        // a second survey (by anyone) hands over nothing more
        investigateRuins(g, me, site.habitat);
        expect(held(me)?.mindFragments).toBe(before + 3);
        const ai = g.empires.find((e): e is Empire => e !== null && e !== me && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active)!;
        investigateRuins(g, ai, site.habitat);
        expect(held(ai)?.beamLens).not.toBe(true);
    });

    it('mixes in the Reclaimer hulks near the old places: abandoned, damaged, claimable', () => {
        const g = next.galaxy;
        const w = age2WorldOf(g)!;
        expect(w.hulks.length).toBeGreaterThan(0);
        expect(w.hulks.filter((h) => h.encounterEventType !== BuiltObjectEncounterEventType.Explodes).length).toBeLessThanOrEqual(hulkCount(g.starCount));
        expect(w.hulks.length).toBeLessThanOrEqual(hulkCount(g.starCount) + MAX_BATTLE_SYSTEMS * (WRECKS_MAX - 1));
        const mem = memoryRecordOf(g)!;
        const places = [...mem.scars, ...(mem.extra[AGE2_WORLD_ID] as OldCapitalRec[])];
        for (const h of w.hulks) {
            expect(g.abandonedBuiltObjects.includes(h)).toBe(true);
            expect(h.components.items.some((c) => c.status !== 0)).toBe(true);
        }
        expect(places.length).toBeGreaterThan(0);
        // claim one by the stock investigation (an Acquire hulk)
        const me = g.playerEmpire!;
        const hulk = w.hulks.find((h) => h.encounterEventType === BuiltObjectEncounterEventType.Acquire)!;
        investigateAbandonedBuiltObject(g, me, hulk);
        expect(hulk.actualEmpire).toBe(me);
    });

    it('puts wrecks in the systems of the capitals that fell: 2-4 hulks, at most one claimable, the rest broken derelicts', () => {
        const g = next.galaxy;
        const w = age2WorldOf(g)!;
        const fallen = memoryRecordOf(g)!.extra[FALLEN_ID] as FallenCapitalRec[];
        expect(fallen.length).toBe(2);
        expect(fallen.map((f) => f.how).sort()).toEqual(['captured', 'destroyed']);
        const battles = w.battles!;
        expect(battles.length).toBeGreaterThan(0);
        expect(battles.length).toBeLessThanOrEqual(MAX_BATTLE_SYSTEMS);
        for (const b of battles) {
            const all = [...(b.claimable === null ? [] : [b.claimable]), ...b.wrecks];
            expect(all.length).toBeGreaterThanOrEqual(WRECKS_MIN);
            expect(all.length).toBeLessThanOrEqual(WRECKS_MAX);
            for (const o of all) {
                expect(g.abandonedBuiltObjects.includes(o) || o.actualEmpire === g.playerEmpire).toBe(true); // an earlier test claimed one
                expect(w.hulks.includes(o)).toBe(true);
            }
            for (const o of b.wrecks) expect(o.encounterEventType).toBe(BuiltObjectEncounterEventType.Explodes);
            if (b.claimable !== null) expect(b.claimable.encounterEventType).toBe(BuiltObjectEncounterEventType.Acquire);
        }
        // never two claimable hulks in one battlefield system, and the weighted hulks keep out of them
        const sys = battles.map((b) => b.systemIndex);
        expect(new Set(sys).size).toBe(sys.length);
        const claimables = w.hulks.filter((h) => h.encounterEventType === BuiltObjectEncounterEventType.Acquire).length;
        expect(claimables).toBeLessThanOrEqual(hulkCount(g.starCount));
    });

    it('is deterministic and survives a save and load', () => {
        const again = buildAge2Game(old, gameData);
        const a = age2WorldOf(next.galaxy)!;
        const b = age2WorldOf(again.galaxy)!;
        expect(b.ruins.map((s) => [s.habitat.name, s.empire])).toEqual(a.ruins.map((s) => [s.habitat.name, s.empire]));
        expect(b.hulks.map((h) => [h.name, Math.round(h.xpos), Math.round(h.ypos)])).toEqual(a.hulks.map((h) => [h.name, Math.round(h.xpos), Math.round(h.ypos)]));
        const text = serializeGame(again, new GalaxyTime(), {} as StartGameOptions);
        const { game } = deserializeGame(text, gameData);
        const c = age2WorldOf(game.galaxy)!;
        expect(c.ruins.map((s) => [s.habitat.name, s.empire, s.surveyed])).toEqual(b.ruins.map((s) => [s.habitat.name, s.empire, s.surveyed]));
        expect(c.ruins.find((s) => s.empire === 'The Fallen')!.parts).toEqual({ beamLens: true, mindFragments: 3 });
        for (const s of c.ruins) expect(game.galaxy.habitats.includes(s.habitat)).toBe(true);
        expect(c.hulks.length).toBe(b.hulks.length);
        expect(c.battles!.map((x) => [x.systemIndex, x.wrecks.length])).toEqual(b.battles!.map((x) => [x.systemIndex, x.wrecks.length]));
        for (const h of c.hulks) expect(game.galaxy.abandonedBuiltObjects.includes(h)).toBe(true);
    }, 600000);
});
