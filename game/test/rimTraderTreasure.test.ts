// Scenario 19a addendum (tasks/19-mod-layer-scenarios.md "19a addendum"): the Concord's creation tech (tech level 4,
// Ship Construction 7), the research cap, the Treasure Ship design, the treasure-fleet convoy (circuit, trade at a
// foreign port, raid penalty) and its beacon (visible to an empire that never met the Concord).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { Cargo, ResourceRef } from '../src/sim/cargo';
import { IndustryType } from '../src/sim/types';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { cargoGetCargo } from '../src/sim/logistics/orders';
import { performResearch } from '../src/sim/researchTick';
import { isObjectVisibleToThisEmpire } from '../src/sim/independentTraders';
import { scenarioEmit } from '../src/sim/scenario';
import { scenarioMapFeatures } from '../src/sim/scenario/mapFeatures';
import { empireMessages } from '../src/sim/messages';
import { rareGoodIds, rimGoodIds, rimTradeState, rimTraderEmpire, rimTraderPort, rimTraderStanding } from '../src/sim/scenario/rimTrade/common';
import {
    concordResearchFrozen,
    constructionLevel,
    generateTreasureShipDesign,
    highestResearchedLevel,
    isConstructionSizeNode,
    treasureFleetTick,
    treasureState,
} from '../src/sim/scenario/rimTrade/treasureFleet';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const forceOranthi = (o: CreateGameOptions): CreateGameOptions => ({ ...o, aiEmpires: [{ ...o.aiEmpires[0], race: 'Oranthi' }, ...o.aiEmpires.slice(1)] });

function rimGame(flags: Record<string, boolean> = {}, params: Record<string, number> = {}): Game {
    return createScenarioGame(base, { scenario: 'rimTrade', flags, params, options: forceOranthi }).game;
}

function meet(a: Empire, b: Empire): void {
    obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.None;
    obtainDiplomaticRelation(b, a).type = DiplomaticRelationType.None;
}

function others(g: Galaxy, r: Empire): Empire[] {
    return g.empires.filter((e): e is Empire => e !== null && e !== r && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
}

describe('19a addendum — Concord tech and stagnation', () => {
    let g: Galaxy;
    let r: Empire;
    beforeAll(() => {
        g = rimGame().galaxy;
        r = rimTraderEmpire(g)!;
    }, 600000);

    it('starts at tech level 4 with Ship Construction 7 (1100-size hulls)', () => {
        // SetTechTreeLevel(4): everything up to level 4 except race-restricted / locked projects.
        const upTo4 = r.research.techTree.filter((n) => n.def.techLevel <= 4 && n.def.specialFunctionCode === 0);
        const missing = upTo4.filter((n) => !n.isResearched);
        for (const n of missing) {
            const allowed = g.researchStatic!.allowedRaces.get(n.def.projectId);
            expect(allowed !== undefined && allowed.size > 0 && !allowed.has('Oranthi')).toBe(true);
        }
        expect(upTo4.length - missing.length).toBeGreaterThan(150);
        for (const i of [IndustryType.Weapon, IndustryType.Energy, IndustryType.HighTech]) expect(highestResearchedLevel(r, i)).toBe(4);
        expect(constructionLevel(r)).toBe(7);
        expect(r.baseMaximumConstructionSize).toBe(1100);
        // A normal AI starts at the wizard's 0.5.
        const other = others(g, r)[0];
        expect(constructionLevel(other)).toBeLessThan(4);
    });

    it('the research cap freezes an industry once it holds a level-5 project (construction line excluded)', () => {
        expect(concordResearchFrozen(g, false, { empire: r, industry: IndustryType.Weapon })).toBe(false);
        // The construction line (levels up to 7) does not count.
        expect(r.research.techTree.some((n) => isConstructionSizeNode(n) && n.isResearched && n.def.techLevel >= 5)).toBe(true);
        for (const i of [IndustryType.Weapon, IndustryType.Energy, IndustryType.HighTech]) {
            const n = r.research.techTree.find((x) => !x.isResearched && x.def.techLevel === 5 && !isConstructionSizeNode(x) && [0, 1, 2][i - 1] === x.def.industry)!;
            expect(n).toBeDefined();
            n.isResearched = true;
            expect(concordResearchFrozen(g, false, { empire: r, industry: i })).toBe(true);
        }
        const researched = (): number => r.research.techTree.filter((n) => n.isResearched).length;
        const before = researched();
        const progress = r.research.techTree.map((n) => n.progress);
        for (let k = 0; k < 20; k++) performResearch(g, r, 3600, false);
        expect(researched()).toBe(before);
        expect(r.research.techTree.map((n) => n.progress)).toEqual(progress);
        // Other empires research as usual.
        expect(concordResearchFrozen(g, false, { empire: others(g, r)[0], industry: IndustryType.Weapon })).toBe(false);
    });
});

describe('19a addendum — treasure fleet', () => {
    let g: Galaxy;
    let r: Empire;
    beforeAll(() => {
        g = rimGame().galaxy;
        r = rimTraderEmpire(g)!;
    }, 600000);

    it('the Treasure Ship design is a ~1100-size freighter hull with cargo, fuel, shields and weapons', () => {
        const d = generateTreasureShipDesign(g, r)!;
        expect(d).not.toBeNull();
        expect(d.subRole).toBe(BuiltObjectSubRole.LargeFreighter);
        expect(d.name).toBe('Treasure Ship');
        expect(d.size).toBeGreaterThanOrEqual(1000);
        expect(d.size).toBeLessThanOrEqual(1100);
        expect(r.designs.includes(d)).toBe(false);
    });

    it('sails its circuit, trades at a foreign port, shows on the map, and a raid costs standing', () => {
        for (const e of others(g, r)) meet(r, e);
        const st = treasureState(g);
        st.contactDone = true;
        treasureFleetTick(g);
        expect(st.sailing).toBe(true);
        // treasureFleetSize 6 + treasureFleetPerColony 1 × (3 colonies − 1) = 8 ships, ⌈8 / 3⌉ = 3 of them treasure ships.
        expect(r.colonies.length).toBe(3);
        expect(st.treasure.length).toBe(3);
        expect(st.ships.length).toBe(8);
        expect(st.circuit.length).toBeGreaterThan(0);
        expect(st.circuit.every((p) => p.actualEmpire !== r && p.isSpacePort)).toBe(true);
        const lead = st.treasure[0];
        const rare = rareGoodIds(g)[0];
        expect(cargoGetCargo(lead.cargo!, rare, r)?.amount ?? 0).toBeGreaterThan(0);
        // Ships head for the first port.
        const port = st.circuit[0];
        const host = port.actualEmpire!;
        const rim = rimGoodIds(g)[0];
        port.cargo!.add(new Cargo(new ResourceRef(rim), 300, host));
        const hostMoney = host.stateMoney;
        const msgs = empireMessages(host).length;
        for (const b of st.ships) {
            b.xpos = port.xpos + 100;
            b.ypos = port.ypos + 100;
        }
        treasureFleetTick(g);
        expect(st.stats.stops).toBe(1);
        expect(st.leg).toBe(1);
        expect(st.stats.rimUnits).toBeGreaterThan(0);
        expect(host.stateMoney).toBeGreaterThan(hostMoney);
        expect(rimTradeState(g).ledger[host.empireId].credit).toBeGreaterThan(0);
        expect(cargoGetCargo(lead.cargo!, rim, r)?.amount ?? 0).toBeGreaterThan(0);
        expect(empireMessages(host).length).toBeGreaterThan(msgs);
        // Map: a marker on the fleet and the circuit route home → ports → home.
        const f = scenarioMapFeatures(g, g.playerEmpire);
        expect(f.markers.length).toBe(1);
        expect(f.routes[0].points.length).toBe(st.circuit.length + 2);
        expect(f.routes[0].activeLeg).toBe(1);
        // Raid: sinking a treasure ship costs the attacker standing.
        const s0 = rimTraderStanding(g, host.empireId);
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: lead, destroyer: host });
        expect(rimTraderStanding(g, host.empireId)).toBe(s0 - 3000);
        expect(rimTraderPort(g)).not.toBeNull();
    });

    it('beacon: an empire that never met the Concord sees the fleet (off with the flag)', () => {
        const g2 = rimGame().galaxy;
        const r2 = rimTraderEmpire(g2)!;
        const st = treasureState(g2);
        st.contactDone = true;
        const e = others(g2, r2)[0];
        meet(r2, e);
        treasureFleetTick(g2);
        const ship = st.treasure[0];
        const stranger = others(g2, r2).find((x) => obtainDiplomaticRelation(r2, x).type === DiplomaticRelationType.NotMet)!;
        expect(stranger).toBeDefined();
        expect(isObjectVisibleToThisEmpire(g2, stranger, ship)).toBe(true);
        const g3 = rimGame({ treasureBeacon: false }).galaxy;
        const r3 = rimTraderEmpire(g3)!;
        const st3 = treasureState(g3);
        st3.contactDone = true;
        meet(r3, others(g3, r3)[0]);
        treasureFleetTick(g3);
        const stranger3 = others(g3, r3).find((x) => obtainDiplomaticRelation(r3, x).type === DiplomaticRelationType.NotMet)!;
        expect(isObjectVisibleToThisEmpire(g3, stranger3, st3.treasure[0])).toBe(false);
        void BuiltObject;
    });
});
