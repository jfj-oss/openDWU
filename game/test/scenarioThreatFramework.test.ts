// 19b §5.A threat framework (src/sim/scenario/threats/framework.ts): the generic parts the 19f threats reuse.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import { createGalaxyScenario, parseScenarioManifest } from '../src/sim/scenario';
import {
    arcMessage,
    arcNews,
    availableThreatActions,
    createThreatFaction,
    flipToFaction,
    invadeFromInside,
    knowledgeLevel,
    makeRobotTroop,
    refitInPlace,
    registerThreatAction,
    registerThreatKnownSites,
    revealTo,
    runThreatAction,
    teardownIfDead,
    threatKnownSites,
    threatState,
    type ThreatSite,
} from '../src/sim/scenario/threats/framework';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { findNewestCanBuild } from '../src/sim/designGeneration';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { threatMarker, THREAT_CONFIRMED_COLOR, THREAT_SUSPECTED_COLOR } from '../src/render/overlayLayer';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

function scenarioOn(g: Galaxy): void {
    g.scenario = createGalaxyScenario(parseScenarioManifest({ id: 'fw', flags: [{ name: 'fw', default: true }] }), {}, base.resources);
}

describe('threat framework', () => {
    it('threatState keeps plain state in galaxy.scenario.state; revealTo only raises knowledge', () => {
        const g = cachedTickGame(base).galaxy;
        scenarioOn(g);
        const st = threatState(g, 'fwTest', () => ({ sites: [] as ThreatSite[] }));
        expect(g.scenario!.state.fwTest).toBe(st);
        const site: ThreatSite = { knowledge: [] };
        const e = g.empires[1];
        expect(knowledgeLevel(site, e)).toBe(0);
        expect(revealTo(g, site, e, 2)).toBe(true);
        expect(revealTo(g, site, e, 1)).toBe(false);
        expect(revealTo(g, site, e, 2)).toBe(false);
        expect(knowledgeLevel(site, e)).toBe(2);
        expect(revealTo(g, site, e, 3)).toBe(true);
        expect(site.knowledge).toHaveLength(1);
        expect(knowledgeLevel(site, g.empires[0])).toBe(0);
    }, 600000);

    it('createThreatFaction: an adopt-only faction at locked war with its enemies, with designs; teardownIfDead', () => {
        const g = cachedTickGame(base).galaxy;
        scenarioOn(g);
        const enemies = g.empires.filter((e) => e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
        const n = g.empires.length;
        const f = createThreatFaction(g, { race: 'Mechanoid', name: 'Test Collective', enemies })!;
        expect(g.empires.length).toBe(n + 1);
        expect(f.name).toBe('Test Collective');
        expect(f.capital).toBeNull();
        expect(f.colonies).toHaveLength(0);
        expect(f.designs.length).toBeGreaterThan(0);
        for (const e of enemies) {
            expect(obtainDiplomaticRelation(f, e).type).toBe(DiplomaticRelationType.War);
            expect(obtainDiplomaticRelation(f, e).locked).toBe(true);
            expect(obtainDiplomaticRelation(e, f).locked).toBe(true);
        }
        expect(teardownIfDead(g, f)).toBe(true);
        expect(f.active).toBe(false);
    }, 600000);

    it('invadeFromInside, makeRobotTroop, flipToFaction, refitInPlace', () => {
        const g = cachedTickGame(base).galaxy;
        scenarioOn(g);
        const host = g.empires[1];
        const f = createThreatFaction(g, { race: 'Mechanoid', name: 'Robots', enemies: [host] })!;
        const colony = host.colonies[0];
        const t = makeRobotTroop(g, f, 70, 'Drone Group');
        expect(t.attackStrength).toBe(70);
        expect(t.readiness).toBe(100);
        expect(t.maintenanceMultiplier).toBe(0);
        invadeFromInside(g, colony, f, [t]);
        expect(colony.invadingTroops!.items).toContain(t);
        expect(t.colony).toBe(colony);
        expect(t.empire).toBe(f);

        const freighter = host.privateBuiltObjects.find((b) => b.subRole === BuiltObjectSubRole.SmallFreighter || b.subRole === BuiltObjectSubRole.MediumFreighter)!;
        expect(freighter).toBeDefined();
        flipToFaction(g, freighter, f);
        expect(freighter.actualEmpire).toBe(f);
        expect(freighter.owner).toBe(f);
        expect(f.builtObjects).toContain(freighter);
        expect(f.privateBuiltObjects).not.toContain(freighter);
        expect(host.privateBuiltObjects).not.toContain(freighter);

        const escort = findNewestCanBuild(f.designs, BuiltObjectSubRole.Escort, f)!;
        refitInPlace(g, freighter, escort);
        expect(freighter.design).toBe(escort);
        expect(freighter.subRole).toBe(BuiltObjectSubRole.Escort);
        expect(freighter.role).toBe(BuiltObjectRole.Military);
        expect(freighter.components.items.length).toBe(escort.components.length);
        expect(freighter.weapons.length).toBeGreaterThan(0);
        expect(freighter.currentFuel).toBe(freighter.fuelCapacity);
    }, 600000);

    it('arcMessage reaches each recipient once per stage; arcNews once', () => {
        const g = cachedTickGame(base).galaxy;
        scenarioOn(g);
        const sent = {};
        const e = g.empires[0];
        const before = empireMessages(e).length;
        const spec = { prefix: 'FwTest', stage: 'Hint', args: ['X'], type: EmpireMessageType.GeneralWarning, subject: e.capital };
        expect(arcMessage(g, sent, [e, e], spec)).toEqual([e]);
        expect(arcMessage(g, sent, [e], spec)).toEqual([]);
        expect(empireMessages(e).length).toBe(before + 1);
        const m = empireMessages(e).at(-1)!;
        expect(m.messageType).toBe(EmpireMessageType.GeneralWarning);
        expect(m.subject).toBe(e.capital);
        expect(arcNews(g, sent, { prefix: 'FwTest', stage: 'News' })).toBe(true);
        expect(arcNews(g, sent, { prefix: 'FwTest', stage: 'News' })).toBe(false);
    }, 600000);

    it('known-site providers feed the UI selector; threat actions are offered and run', () => {
        const g = cachedTickGame(base).galaxy;
        const player = g.playerEmpire!;
        expect(threatKnownSites(g, player)).toEqual([]); // no scenario: nothing
        scenarioOn(g);
        const colony = player.colonies[0];
        registerThreatKnownSites('zzTest', (_g, e) => (e === player ? [{ threat: 'zzTest', kind: 'colony', target: colony, level: 3, label: 'Nest (confirmed)' }, { threat: 'zzTest', kind: 'colony', target: colony, level: 1, label: 'rumour' }] : []));
        const sites = threatKnownSites(g, player).filter((s) => s.threat === 'zzTest');
        expect(sites.map((s) => s.label)).toEqual(['Nest (confirmed)']);
        const ring = threatMarker(sites[0], 1);
        expect(ring.kind).toBe('ring');
        expect(ring.color).toBe(THREAT_CONFIRMED_COLOR);
        expect(threatMarker({ ...sites[0], level: 2 }, 1).color).toBe(THREAT_SUSPECTED_COLOR);
        registerThreatKnownSites('zzTest', () => []);

        let ran = 0;
        registerThreatAction('zzTest.act', { label: () => 'Do it', available: (_g, e, t) => e === player && t === colony, run: () => ++ran > 0 });
        expect(availableThreatActions(g, player, colony)).toContainEqual({ kind: 'zzTest.act', label: 'Do it' });
        expect(availableThreatActions(g, player, g.habitats[0] === colony ? g.habitats[1] : g.habitats[0]).some((a) => a.kind === 'zzTest.act')).toBe(false);
        expect(runThreatAction(g, player, 'zzTest.act', colony)).toBe(true);
        expect(runThreatAction(g, g.empires[1], 'zzTest.act', colony)).toBe(false);
        expect(ran).toBe(1);
        registerThreatAction('zzTest.act', { label: () => '', available: () => false, run: () => false });
    }, 600000);
});

