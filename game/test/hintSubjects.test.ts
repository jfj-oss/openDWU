// Location hint subjects (an Improvement, sim/player/hintSubjects.ts): what each hint marker says is at its point —
// recorded from the source (trade, pirate information, navigation / story / event sources), looked up for old saves,
// saved only when present, no digest or Rnd effect.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import { galaxyFromJSON, galaxyToJSON } from '../src/sim/save/galaxySave';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyLocation, GalaxyLocationType } from '../src/sim/galaxyLocation';
import { TradeableItem, TradeableItemType, addLocationHint, giveTradeableItem } from '../src/sim/tradeItems';
import { answerConversationReply, galaxyLocationKey } from '../src/sim/player/conversationReplies';
import { builtObjectSubject, hintSource, hintSubject, locationSubject, ruinsSubject, subjectLabel } from '../src/sim/player/hintSubjects';
import { hintSubjectOf, knownLocationTooltip, knownLocations } from '../src/sim/player/knownLocations';
import { expectSameGame, inThread, inWorker } from './helpers/simWorkerSides';
import { mapMarkers } from '../src/render/locationMarkers';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 1_800_000);

function fresh() {
    const game = cachedTickGame(gameData);
    game.playerEmpire.locationHints.length = 0;
    return game;
}

/** This seed has no debris field / planet destroyer: add one (a test fixture; nothing reads it as the sim). */
function addLocation(g: ReturnType<typeof fresh>['galaxy'], type: GalaxyLocationType, x: number, y: number): GalaxyLocation {
    const l = new GalaxyLocation('', type, x, y, 400, 400, 0);
    g.galaxyLocations.push(l);
    return l;
}

describe('hint subjects: recorded at the source', () => {
    it('trades: a secret GalaxyLocation, a ruined habitat, an independent colony', () => {
        const game = fresh();
        const g = game.galaxy;
        const p = game.playerEmpire;
        const other = g.empires.find((e) => e !== null && e !== p && e !== g.independentEmpire)!;
        const loc = addLocation(g, GalaxyLocationType.PlanetDestroyer, 20000, 20000);
        giveTradeableItem(g, other, p, new TradeableItem(TradeableItemType.SecretLocation, loc, 0), null);
        const lx = Math.trunc(loc.xpos);
        const ly = Math.trunc(loc.ypos);
        expect(hintSubject(g, lx, ly)).toBe('Planet destroyer');
        expect(hintSource(g, lx, ly)).toBe(`Diplomacy (traded by ${other.name})`);
        p.locationHints.length = 0;
        const ruin = g.ruinsHabitats.find((h) => h != null && h.ruin !== null && h.name !== '')!;
        giveTradeableItem(g, other, p, new TradeableItem(TradeableItemType.SecretLocation, ruin, 0), null);
        expect(hintSubject(g, Math.trunc(ruin.xpos), Math.trunc(ruin.ypos))).toBe(`Ancient ruins: ${ruin.name}`);
        p.locationHints.length = 0;
        const colony = g.independentColonies.find((h) => h != null && h.name !== '')!;
        giveTradeableItem(g, other, p, new TradeableItem(TradeableItemType.IndependentColonyLocation, colony, 0), null);
        expect(hintSubject(g, Math.trunc(colony.xpos), Math.trunc(colony.ypos))).toBe(`Independent colony: ${colony.name}`);
        p.locationHints.length = 0;
        giveTradeableItem(g, other, p, new TradeableItem(TradeableItemType.SecretLocation, ruin, 0), null);
        const list = knownLocations(g, p);
        const ruinHint = list.find((k) => k.kind === 'hint' && k.subject === `Ancient ruins: ${ruin.name}`);
        expect(ruinHint).toBeDefined();
        expect(ruinHint!.name).toBe('Ancient ruins');
        expect(knownLocationTooltip(g, p, ruinHint!)).toContain(`Ancient ruins: ${ruin.name} \u2014 from Diplomacy (traded by ${other.name})`);
    }, 600000);

    it('pirate information (INFO_RUINS / INFO_DEBRISFIELD) records the subject', () => {
        const game = fresh();
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ruin = g.ruinsHabitats.find((h) => h != null && h.ruin !== null && h.name !== '')!;
        answerConversationReply(g, p, g.pirateEmpires[0], 'INFO_RUINS', ruin, 0);
        expect(hintSubject(g, Math.trunc(ruin.xpos), Math.trunc(ruin.ypos))).toBe(ruinsSubject(ruin));
        expect(hintSource(g, Math.trunc(ruin.xpos), Math.trunc(ruin.ypos))).toBe(`Pirates (bought from ${g.pirateEmpires[0].name})`);
        p.locationHints.length = 0;
        const loc = addLocation(g, GalaxyLocationType.DebrisField, 30000, 30000);
        answerConversationReply(g, p, g.pirateEmpires[0], 'INFO_DEBRISFIELD', galaxyLocationKey(loc), 0);
        expect(hintSubject(g, Math.trunc(loc.xpos + loc.width / 2), Math.trunc(loc.ypos + loc.height / 2))).toBe('Debris field');
    }, 600000);

    it('ship / base texts: "Abandoned <subrole>: <name>"; the marker shows only the label', () => {
        const game = fresh();
        const g = game.galaxy;
        const bo = g.abandonedBuiltObjects.find((b) => b != null)!;
        const s = builtObjectSubject(bo, true);
        expect(s.startsWith('Abandoned ')).toBe(true);
        expect(subjectLabel(s)).toBe(subjectLabel(`Abandoned ${s.slice('Abandoned '.length).split(':')[0]}`));
        expect(subjectLabel('Wonder: Grand Spire')).toBe('Wonder');
        expect(subjectLabel('Debris field')).toBe('Debris field');
        expect(locationSubject(addLocation(g, GalaxyLocationType.DebrisField, 30000, 30000))).toBe('Debris field');
        const p = game.playerEmpire;
        addLocationHint(p, { x: Math.trunc(bo.xpos), y: Math.trunc(bo.ypos) }, s);
        const m = mapMarkers(g, p, false, true).find((x) => x.kind === 'hint')!;
        expect(m.name).toBe(`? ${subjectLabel(s)}`);
    }, 600000);

    it('a skipped hint keeps the earlier subject; a hint added without one clears a stale subject', () => {
        const game = fresh();
        const g = game.galaxy;
        const p = game.playerEmpire;
        addLocationHint(p, { x: 5000, y: 5000 }, 'Debris field');
        addLocationHint(p, { x: 5010, y: 5010 }, 'Planet destroyer');
        expect(p.locationHints).toHaveLength(1);
        expect(hintSubject(g, 5000, 5000)).toBe('Debris field');
        expect(hintSubject(g, 5010, 5010)).toBeUndefined();
        p.locationHints.length = 0;
        addLocationHint(p, { x: 5000, y: 5000 });
        expect(hintSubject(g, 5000, 5000)).toBeUndefined();
    }, 600000);
});

describe('hint subjects: the lookup for hints without one', () => {
    it('abandoned ship, ruins, known location, else the nearest system', () => {
        const game = fresh();
        const g = game.galaxy;
        const p = game.playerEmpire;
        const bo = g.abandonedBuiltObjects.find((b) => b != null)!;
        expect(hintSubjectOf(g, Math.trunc(bo.xpos), Math.trunc(bo.ypos))).toMatch(/^Abandoned \S/);
        const ruin = g.ruinsHabitats.find((h) => h != null && h.ruin !== null && h.name !== '')!;
        expect(hintSubjectOf(g, Math.trunc(ruin.xpos), Math.trunc(ruin.ypos))).toBe(`Ruins on ${ruin.name}`);
        // A hint at a listed location says its type.
        const loc = addLocation(g, GalaxyLocationType.DebrisField, 30000, 30000);
        p.visibility.knownGalaxyLocations.push(loc);
        const c = loc.resolveLocationCenter();
        p.locationHints.push({ x: Math.trunc(c.x), y: Math.trunc(c.y) });
        expect(knownLocations(g, p).find((k) => k.kind === 'hint')!.subject).toMatch(/Debris Field/);
        // Nothing else there: generic, near a system, nothing spoiled.
        p.locationHints.length = 0;
        p.locationHints.push({ x: 1, y: 1 });
        const k = knownLocations(g, p).find((x) => x.kind === 'hint')!;
        expect(k.subject).toMatch(/^Point of interest near /);
        expect(k.name).toBe('Point of interest near ' + k.subject!.slice('Point of interest near '.length));
    }, 600000);
});

describe('hint subjects: saves and the digest', () => {
    it('round-trips; written only when present; no digest or Rnd effect', () => {
        const game = fresh();
        const g = game.galaxy;
        const p = game.playerEmpire;
        const before = JSON.stringify(galaxyToJSON(g));
        expect(before).not.toContain('"hintSubjects"');
        const digest = stateDigest(g);
        const draws = g.rnd.drawCount;
        addLocationHint(p, { x: 3000, y: 4000 }); // no subject: nothing written
        expect(JSON.stringify(galaxyToJSON(g))).not.toContain('"hintSubjects"');
        const d2 = stateDigest(g);
        addLocationHint(p, { x: 60000, y: 1000 }, 'Wonder: Grand Spire', 'Story clue');
        expect(stateDigest(g)).toBe(d2);
        expect(g.rnd.drawCount).toBe(draws);
        expect(digest).not.toBe('');
        const text = JSON.stringify(galaxyToJSON(g));
        expect(text).toContain('"hintSubjects"');
        const loaded = galaxyFromJSON(JSON.parse(text), gameData);
        expect(hintSubject(loaded, 60000, 1000)).toBe('Wonder: Grand Spire');
        expect(hintSource(loaded, 60000, 1000)).toBe('Story clue');
        const tip = knownLocationTooltip(loaded, loaded.playerEmpire, knownLocations(loaded, loaded.playerEmpire!).find((k) => k.key === 'h:60000,1000')!);
        expect(tip).toContain('Wonder: Grand Spire \u2014 from Story clue');
        const old = knownLocations(loaded, loaded.playerEmpire!).find((k) => k.key === 'h:3000,4000')!;
        expect(knownLocationTooltip(loaded, loaded.playerEmpire, old)).toContain('From: Unknown source');
        expect(hintSubject(loaded, 3000, 4000)).toBeUndefined();
        expect(stateDigest(loaded)).toBe(stateDigest(g));
        // The same game without the subject has the same digest.
        const plain = fresh();
        addLocationHint(plain.playerEmpire, { x: 3000, y: 4000 });
        addLocationHint(plain.playerEmpire, { x: 60000, y: 1000 });
        expect(stateDigest(plain.galaxy)).toBe(stateDigest(g));
    }, 600000);
});

describe('hint subjects: worker mode', () => {
    it('the replica shows the subject recorded in the worker, same game as in-thread', () => {
        const a = inThread(cachedTickGame(gameData));
        const w = inWorker(cachedTickGame(gameData), gameData);
        const sides = [a, w];
        for (const s of sides) s.tick();
        // The worker's own galaxy (w.real) is where the sim runs; the replica (w.galaxy) reads the synced table.
        addLocationHint(a.player, { x: 60000, y: 1000 }, 'Wonder: Grand Spire');
        addLocationHint(w.real.playerEmpire!, { x: 60000, y: 1000 }, 'Wonder: Grand Spire');
        for (let i = 0; i < 4; i++) for (const s of sides) s.tick();
        expect(hintSubject(w.real, 60000, 1000)).toBe('Wonder: Grand Spire');
        expect(hintSubject(w.galaxy, 60000, 1000)).toBe('Wonder: Grand Spire');
        expectSameGame(a, w);
        a.dispose();
        w.dispose();
    }, 900000);
});
