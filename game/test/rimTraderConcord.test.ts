// Scenario 19a — the Concord's starting colonies (rimTraderStartColonies), the colony cap on every expansion path
// (rimTraderMaxColonies) and the passive posture with anger (flag rimTraderPassive). The 3-year posture soak and the
// flag-off digest check are in test/rimTraderPassiveSoak.test.ts (@slow).
import { beforeAll, describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { CreateGameOptions, Game } from '../src/sim/game';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { declareWar } from '../src/sim/diplomacyTick';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { Blockade } from '../src/sim/fleets/blockades';
import { IntelligenceMissionType } from '../src/sim/espionage';
import { empireMessages } from '../src/sim/messages';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { scenarioEmit, scenarioText } from '../src/sim/scenario';
import {
    isRimTraderAI,
    rareGoodIds,
    rimAngerState,
    rimAngeredAt,
    rimLedgerOpen,
    rimParam,
    rimTradeState,
    rimTraderColonyCapBlocks,
    rimTraderEmpire,
    scenarioWarBlocked,
} from '../src/sim/scenario/rimTrade/common';
import { RIM_START_HIGH_QUALITY, RIM_START_MIN_QUALITY, concordStartColonyCandidates } from '../src/sim/scenario/rimTrade/rimTrader';
import { concordAttacksWithoutWar, concordMissionAllowed, distanceToConcordSpace, inConcordSpace, isStrikeShip, recordRimAggression, rimAngerReview, rimAngerYear, rimCapReview, rimPassiveLeash, rimStrikeReview } from '../src/sim/scenario/rimTrade/passive';
import { treasureFleetTargetSize, treasureState } from '../src/sim/scenario/rimTrade/treasureFleet';
import { concordNavyYear, concordTradeHouseYear, concordWarships, navyGroupOf, rimNavyState } from '../src/sim/scenario/rimTrade/wealth';
import { builtObjectMission } from '../src/sim/missions/mission';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const forceOranthi = (o: CreateGameOptions): CreateGameOptions => ({ ...o, aiEmpires: [{ ...o.aiEmpires[0], race: 'Oranthi' }, ...o.aiEmpires.slice(1)] });

/** The rimTrade game with the Concord created at game start (createEmpireMidGame path) unless `forced`. */
function rimGame(flags: Record<string, boolean> = {}, params: Record<string, number> = {}, forced = false): Game {
    return createScenarioGame(base, { scenario: 'rimTrade', flags, params, options: forced ? forceOranthi : undefined }).game;
}

function others(g: Game['galaxy'], r: Empire): Empire[] {
    return g.empires.filter((e): e is Empire => e !== null && e !== r && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
}

function warship(r: Empire) {
    return r.builtObjects.find((b) => b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military) ?? null;
}

describe('19a Concord — starting colonies', () => {
    it('default: the Concord starts with 3 colonies, the extra ones on high-quality worlds near its capital', () => {
        const g = rimGame().galaxy;
        const r = rimTraderEmpire(g)!;
        expect(rimParam(g, 'rimTraderStartColonies')).toBe(3);
        expect(r.colonies.length).toBe(3);
        const extra = r.colonies.filter((c) => c !== r.capital);
        expect(extra.length).toBe(2);
        for (const c of extra) {
            expect(c.quality).toBeGreaterThanOrEqual(RIM_START_MIN_QUALITY);
            expect(c.population.totalAmount).toBeGreaterThan(0); // MakeHabitatIntoColony: population, cargo, garrison
            expect(c.developmentLevel).toBeGreaterThanOrEqual(0);
            expect(c.cargo!.items.length).toBeGreaterThan(0);
            expect(g.calculateDistance(c.xpos, c.ypos, r.capital!.xpos, r.capital!.ypos)).toBeLessThanOrEqual(g.sectorSize * 3);
        }
        // The best candidates were taken: nothing left beats the worst chosen world's tier (seed 1: all high quality).
        expect(extra.every((c) => c.quality >= RIM_START_HIGH_QUALITY - 1e-6)).toBe(true);
    }, 600000);

    it('the slider: 1 leaves the capital alone; 6 founds five more, best worlds first', () => {
        const one = rimGame({}, { rimTraderStartColonies: 1 }).galaxy;
        expect(rimTraderEmpire(one)!.colonies.length).toBe(1);
        const g = rimGame({}, { rimTraderStartColonies: 6 }).galaxy;
        const r = rimTraderEmpire(g)!;
        expect(r.colonies.length).toBe(6);
        const q = r.colonies.filter((c) => c !== r.capital).map((c) => c.quality);
        for (const x of q) expect(x).toBeGreaterThanOrEqual(RIM_START_MIN_QUALITY);
        // No uncolonized candidate left is of a better tier than the worst chosen one (high before merely good).
        const left = concordStartColonyCandidates(g, r, 50);
        if (q.some((x) => x < RIM_START_HIGH_QUALITY)) {
            expect(left.filter((h) => h.quality >= RIM_START_HIGH_QUALITY && g.calculateDistance(h.xpos, h.ypos, r.capital!.xpos, r.capital!.ypos) <= g.sectorSize * 3).length).toBe(0);
        }
    }, 600000);

    it('a wizard-generated Oranthi AI is topped up to the slider', () => {
        const g = rimGame({}, { rimTraderStartColonies: 4 }, true).galaxy;
        const r = rimTraderEmpire(g)!;
        expect(r.colonies.length).toBeGreaterThanOrEqual(4);
        for (const c of r.colonies) expect(c.population.totalAmount).toBeGreaterThan(0);
    }, 600000);
});

describe('19a Concord — colony cap on every path', () => {
    let game: Game;
    beforeAll(() => {
        // The wizard-generated Oranthi (it starts with warships); the cap is set to its colony count.
        game = rimGame({}, {}, true);
        game.galaxy.scenario!.params['rimTraderMaxColonies'] = rimTraderEmpire(game.galaxy)!.colonies.length;
    }, 600000);

    it('manifest: cap default 10, max 10', () => {
        const g = rimGame().galaxy;
        expect(rimParam(g, 'rimTraderMaxColonies')).toBe(10);
        const m = g.scenario!.manifest!;
        const p = m.params.find((x) => x.name === 'rimTraderMaxColonies')!;
        expect(p.max).toBe(10);
        expect(m.flags.find((f) => f.name === 'rimTraderPassive')!.default).toBe(true);
    }, 600000);

    it('at the cap: no Colonize mission, no troop landing on a foreign colony, no founding', () => {
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        const cap = r.colonies.length;
        const ship = warship(r)!;
        expect(ship).not.toBeNull();
        const target = g.habitats.find((h) => h.empire === null && h.population.totalAmount === 0 && (h.category === 1 || h.category === 2))!;
        const call = (type: number, t: unknown) => concordMissionAllowed(g, true, { builtObject: ship, missionType: type, target: t, x: -2000000001, y: -2000000001 });
        expect(rimTraderColonyCapBlocks(g, r)).toBe(true); // cmdColonize founds nothing (mission cancelled)
        expect(call(BuiltObjectMissionType.Colonize, target)).toBe(false);
        const foreign = others(g, r)[0].colonies[0];
        expect(call(BuiltObjectMissionType.UnloadTroops, foreign)).toBe(false);
        expect(call(BuiltObjectMissionType.UnloadTroops, r.capital)).toBe(true);
        // Under the cap the same missions pass the cap rule (the passive posture still judges the warship's missions).
        g.scenario!.params['rimTraderMaxColonies'] = cap + 1;
        expect(rimTraderColonyCapBlocks(g, r)).toBe(false);
        expect(call(BuiltObjectMissionType.Colonize, r.capital)).toBe(true);
        g.scenario!.params['rimTraderMaxColonies'] = cap;
    });

    it('a colony gained past the cap any other way (lost colony, event, conquest) is released to the independents', () => {
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        const cap = r.colonies.length;
        const ind = g.independentColonies.find((c) => c.empire === g.independentEmpire && !c.hasBeenDestroyed) as Habitat;
        expect(ind).toBeDefined();
        takeOwnershipOfColonyFull(g, r, ind, r, false, false);
        expect(ind.empire).toBe(r);
        expect(r.colonies.length).toBe(cap + 1);
        rimCapReview(g);
        expect(ind.empire).toBe(g.independentEmpire);
        expect(r.colonies.length).toBe(cap);
        expect((g.scenario!.state['rimCap'] as { released: number }).released).toBe(1);
    });
});

describe('19a Concord — passive posture and anger', () => {
    let game: Game;
    beforeAll(() => {
        game = rimGame({}, {}, true); // the wizard-generated Oranthi starts with warships
    }, 600000);

    it('warships: missions inside Concord space only; no attack on the unprovoked; the treasure fleet exempt', () => {
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        expect(isRimTraderAI(g, r)).toBe(true);
        const ship = warship(r)!;
        const x = others(g, r)[0];
        const foreign = x.colonies[0];
        expect(inConcordSpace(g, r, foreign.xpos, foreign.ypos)).toBe(false);
        const call = (type: number, t: unknown) => concordMissionAllowed(g, true, { builtObject: ship, missionType: type, target: t, x: -2000000001, y: -2000000001 });
        expect(call(BuiltObjectMissionType.Patrol, r.capital)).toBe(true);
        expect(call(BuiltObjectMissionType.Move, r.capital)).toBe(true);
        expect(call(BuiltObjectMissionType.Move, foreign)).toBe(false);
        expect(call(BuiltObjectMissionType.Attack, foreign)).toBe(false);
        expect(call(BuiltObjectMissionType.Bombard, foreign)).toBe(false);
        expect(call(BuiltObjectMissionType.Raid, foreign)).toBe(false);
        // Passive off: the stock AI's missions (no posture rule).
        g.scenario!.flags['rimTraderPassive'] = false;
        expect(call(BuiltObjectMissionType.Attack, foreign)).toBe(true);
        g.scenario!.flags['rimTraderPassive'] = true;
    });

    it('no war without an aggressive action; war and retaliation within range after one', () => {
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        const x = others(g, r)[0];
        const ship = warship(r)!;
        const foreign = x.colonies[0];
        obtainDiplomaticRelation(r, x).type = DiplomaticRelationType.None;
        obtainDiplomaticRelation(x, r).type = DiplomaticRelationType.None;
        expect(rimAngeredAt(g, x)).toBe(false);
        declareWar(g, r, x);
        expect(obtainDiplomaticRelation(r, x).type).toBe(DiplomaticRelationType.None);
        // An attack on a Concord ship (Galaxy.7.cs NotifyOfAttack → builtObjectAttacked) angers the Concord.
        scenarioEmit(g, 'builtObjectAttacked', { builtObject: ship, attacker: null, attackingEmpire: x });
        expect(rimAngeredAt(g, x)).toBe(true);
        const entry = rimAngerState(g).byEmpire[x.empireId];
        expect(entry.lastAction).toBe('attackedShip');
        expect(entry.counts.attackedShip).toBe(1);
        const call = (type: number, t: unknown) => concordMissionAllowed(g, true, { builtObject: ship, missionType: type, target: t, x: -2000000001, y: -2000000001 });
        // Retaliation only within range of Concord space.
        g.scenario!.params['rimTraderRetaliationRange'] = 0;
        expect(call(BuiltObjectMissionType.Attack, foreign)).toBe(false);
        g.scenario!.params['rimTraderRetaliationRange'] = 1000;
        expect(call(BuiltObjectMissionType.Attack, foreign)).toBe(true);
        const bystander = others(g, r).find((e) => e !== x && !rimAngeredAt(g, e))!;
        expect(call(BuiltObjectMissionType.Attack, bystander.colonies[0])).toBe(false);
        g.scenario!.params['rimTraderRetaliationRange'] = 2;
        // The war block lifts toward the aggressor only.
        expect(scenarioWarBlocked(g, r, x)).toBe(false);
        expect(scenarioWarBlocked(g, r, bystander)).toBe(true);
        declareWar(g, r, x);
        expect(obtainDiplomaticRelation(r, x).type).toBe(DiplomaticRelationType.War);
        declareWar(g, r, bystander);
        expect(obtainDiplomaticRelation(r, bystander).type).not.toBe(DiplomaticRelationType.War);
        // Passive off: R1 as before (never declares war), anger or not.
        g.scenario!.flags['rimTraderPassive'] = false;
        expect(scenarioWarBlocked(g, r, x)).toBe(true);
        g.scenario!.flags['rimTraderPassive'] = true;
    });

    it('every aggressive action is recorded per empire', () => {
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        const [a, b, c] = others(g, r);
        expect(rimAngeredAt(g, b)).toBe(false); // (a was provoked by the previous test)
        const ship = warship(r)!;
        scenarioEmit(g, 'warDeclared', { empire: a, target: r });
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: ship, destroyer: a });
        scenarioEmit(g, 'habitatAttacked', { habitat: r.capital!, attacker: null, attackingEmpire: a, bombarded: true });
        scenarioEmit(g, 'warDamageInflicted', { inflictor: a, victim: r, builtObject: null, habitat: r.capital!, value: 10 });
        scenarioEmit(g, 'intelMissionExposed', { empire: a, blamed: a, target: r, missionType: IntelligenceMissionType.AssassinateCharacter, outcome: 5 });
        // Espionage that is only spying does not count.
        scenarioEmit(g, 'intelMissionExposed', { empire: b, blamed: b, target: r, missionType: IntelligenceMissionType.StealTechData, outcome: 2 });
        const counts = rimAngerState(g).byEmpire[a.empireId].counts;
        expect(counts).toMatchObject({ declaredWar: 1, destroyedShip: 1, attackedColony: 1, invasion: 1, espionage: 1 });
        expect(rimAngeredAt(g, b)).toBe(false);
        // Blockade (sampled) and standing below the threshold.
        g.blockades.push(new Blockade(r.capital!, b, galaxyStarDate(g)));
        (rimTradeState(g).ledger[c.empireId] ??= { credit: 0, debit: 0 }).debit = 5000;
        rimAngerReview(g);
        g.blockades.pop();
        expect(rimAngerState(g).byEmpire[b.empireId].counts.blockade).toBe(1);
        expect(rimAngerState(g).byEmpire[c.empireId].counts.lowStanding).toBe(1);
        rimTradeState(g).ledger[c.empireId].debit = 0;
    });

    it('anger decays yearly; the provoked and the calmed get a message', () => {
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        const all = others(g, r);
        const y = all[all.length - 1];
        obtainDiplomaticRelation(r, y).type = DiplomaticRelationType.None;
        obtainDiplomaticRelation(y, r).type = DiplomaticRelationType.None;
        delete rimAngerState(g).byEmpire[y.empireId]; // calm again (angered by the previous test)
        const before = empireMessages(y).length;
        recordRimAggression(g, y, 'treasureRaid');
        expect(empireMessages(y).slice(before).some((m) => m.title === scenarioText('Scenario RimTrade Angered Title'))).toBe(true);
        expect(rimAngerState(g).byEmpire[y.empireId].anger).toBe(1);
        rimAngerYear(g);
        expect(rimAngerState(g).byEmpire[y.empireId].anger).toBe(0.5);
        expect(rimAngeredAt(g, y)).toBe(true);
        const mid = empireMessages(y).length;
        rimAngerYear(g);
        expect(rimAngeredAt(g, y)).toBe(false);
        expect(empireMessages(y).slice(mid).some((m) => m.description === scenarioText('Scenario RimTrade Calmed You', r.name))).toBe(true);
        // At war the anger holds.
        recordRimAggression(g, y, 'declaredWar');
        obtainDiplomaticRelation(r, y).type = DiplomaticRelationType.War;
        rimAngerYear(g);
        expect(rimAngerState(g).byEmpire[y.empireId].anger).toBe(1);
        obtainDiplomaticRelation(r, y).type = DiplomaticRelationType.None;
    });
});

describe('19a Concord — tit-for-tat strikes without war', () => {
    let game: Game;
    beforeAll(() => {
        game = rimGame({}, {}, true); // the wizard-generated Oranthi starts with warships
    }, 600000);

    it('the ledger accrues from ship, base and colony damage; strikes sail only at the offender, anywhere, never at colonies; the home guard stays', () => {
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        const [x, bystander] = others(g, r);
        meetBoth(r, x);
        meetBoth(r, bystander);
        const ship = warship(r)!;
        expect(rimLedgerOpen(g, x)).toBe(false);
        expect(concordAttacksWithoutWar(g, false, { empire: r, target: x })).toBe(false);
        scenarioEmit(g, 'warDamageInflicted', { inflictor: x, victim: r, builtObject: ship, habitat: null, value: 40 });
        scenarioEmit(g, 'warDamageInflicted', { inflictor: x, victim: r, builtObject: null, habitat: r.capital!, value: 60 });
        const l = rimAngerState(g).byEmpire[x.empireId].ledger!;
        expect(l.taken).toBe(100);
        expect(l.open).toBe(true);
        expect(rimLedgerOpen(g, bystander)).toBe(false);
        // The stock attack AI may engage the offender (not the bystander) without war.
        expect(concordAttacksWithoutWar(g, false, { empire: r, target: x })).toBe(true);
        expect(concordAttacksWithoutWar(g, false, { empire: r, target: bystander })).toBe(false);
        const warshipsBefore = r.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && !treasureState(g).ships.includes(b)).length;
        const atSea = rimStrikeReview(g);
        const fleets = rimAngerState(g).strikes!;
        expect(fleets.length).toBeGreaterThan(0);
        expect(fleets.length).toBeLessThanOrEqual(2);
        expect(atSea).toBeGreaterThan(0);
        expect(atSea).toBeLessThanOrEqual(Math.floor(warshipsBefore / 2)); // rimTraderHomeGuardPct 50
        const range = g.maxSolarSystemSize + rimParam(g, 'rimTraderRetaliationRange') * g.sectorSize;
        let far = false;
        for (const f of fleets) {
            expect(f.targetEmpireId).toBe(x.empireId);
            expect(f.target).not.toBeNull();
            expect(f.target!.actualEmpire).toBe(x); // a ship or base, never a colony
            for (const b of f.ships) {
                // Far off: a Move (hyperjump) to the target's system first; near it: an Attack on the ship / base itself.
                const m = builtObjectMission(b.mission)!;
                if (m.type === BuiltObjectMissionType.Move) expect(m.targetHabitat).toBe(f.target!.nearestSystemStar);
                else {
                    expect(m.type).toBe(BuiltObjectMissionType.Attack);
                    expect(m.targetBuiltObject).toBe(f.target);
                }
                expect(isStrikeShip(g, b)).toBe(true);
            }
            if (distanceToConcordSpace(g, r, f.target!.xpos, f.target!.ypos) > range) far = true;
        }
        // Seed 1: the offender's assets all lie beyond the 2-sector range, and the strike goes anyway.
        expect(far).toBe(true);
        // Strike ships are exempt from the leash.
        const n = rimPassiveLeash(g);
        void n;
        for (const f of fleets) for (const b of f.ships) expect([BuiltObjectMissionType.Move, BuiltObjectMissionType.Attack]).toContain(builtObjectMission(b.mission)!.type);
        for (const f of fleets) for (const b of f.ships) if (builtObjectMission(b.mission)!.type === BuiltObjectMissionType.Move) expect(builtObjectMission(b.mission)!.targetHabitat).toBe(f.target!.nearestSystemStar);
        // The strike declared no war; anger holds while the price is owed.
        expect(obtainDiplomaticRelation(r, x).type).not.toBe(DiplomaticRelationType.War);
        rimAngerYear(g);
        rimAngerYear(g);
        expect(rimAngeredAt(g, x)).toBe(true);
    });

    it('at 2× the damage taken the ledger closes, the fleets go home, the offender is told', () => {
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        const [x] = others(g, r);
        const ships = rimAngerState(g).strikes!.flatMap((f) => f.ships);
        const before = empireMessages(x).length;
        scenarioEmit(g, 'warDamageInflicted', { inflictor: r, victim: x, builtObject: null, habitat: null, value: 150 });
        expect(rimLedgerOpen(g, x)).toBe(true); // 150 < 2 × 100
        scenarioEmit(g, 'warDamageInflicted', { inflictor: r, victim: x, builtObject: null, habitat: null, value: 50 });
        expect(rimLedgerOpen(g, x)).toBe(false);
        expect(rimAngerState(g).strikes!.length).toBe(0);
        expect(rimAngerState(g).stats.exacted).toBe(1);
        for (const b of ships) {
            if (b.hasBeenDestroyed) continue;
            expect(b.isAutoControlled).toBe(true);
            const m = builtObjectMission(b.mission)!;
            expect(m.type).toBe(BuiltObjectMissionType.Move);
            expect(r.colonies.includes(m.targetHabitat!)).toBe(true);
        }
        expect(empireMessages(x).slice(before).some((m) => m.description === scenarioText('Scenario RimTrade Price Exacted You', r.name))).toBe(true);
        expect(concordAttacksWithoutWar(g, false, { empire: r, target: x })).toBe(false);
        expect(obtainDiplomaticRelation(r, x).type).not.toBe(DiplomaticRelationType.War);
        // Nothing more to strike.
        expect(rimStrikeReview(g)).toBe(0);
    });
});

describe('19a treasure fleet scaling', () => {
    it('target size = base + per colony × (colonies − 1), capped at 20', () => {
        const g = rimGame().galaxy;
        const r = rimTraderEmpire(g)!;
        const withColonies = (n: number): number => {
            const saved = r.colonies;
            r.colonies = saved.slice(0, 1);
            while (r.colonies.length < n) r.colonies.push(saved[0]);
            const size = treasureFleetTargetSize(g, r);
            r.colonies = saved;
            return size;
        };
        expect(withColonies(1)).toBe(6);
        expect(withColonies(3)).toBe(8);
        expect(withColonies(10)).toBe(15);
        g.scenario!.params['treasureFleetPerColony'] = 3;
        expect(withColonies(10)).toBe(20);
        g.scenario!.params['treasureFleetPerColony'] = 1;
        g.scenario!.params['treasureFleetSize'] = 0;
        expect(withColonies(10)).toBe(0); // base 0: no fleet
    }, 600000);
});

function meetBoth(a: Empire, b: Empire): void {
    obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.None;
    obtainDiplomaticRelation(b, a).type = DiplomaticRelationType.None;
}

describe('19a Concord — wealth and navy', () => {
    it('seed 1 (Concord created at start): 40 warships in the spread, paid from the 5M start treasury, one home fleet per system', () => {
        const g = rimGame().galaxy;
        const r = rimTraderEmpire(g)!;
        const st = rimNavyState(g);
        expect(st.startWarships).toBe(40);
        expect(st.startCost).toBeGreaterThan(0);
        expect(r.stateMoney).toBeCloseTo(5000000 - st.startCost, 0);
        const ships = concordWarships(r);
        expect(ships.length).toBeGreaterThanOrEqual(40);
        const byGroup = [0, 0, 0];
        for (const b of ships) {
            const i = navyGroupOf(b.subRole);
            if (i >= 0) byGroup[i]++;
        }
        expect(byGroup[0]).toBeGreaterThan(0);
        expect(byGroup[1] + byGroup[2]).toBeGreaterThan(0);
        const systems = new Set(r.colonies.map((c) => c.systemIndex));
        const fleets = (r.shipGroups as { ships: unknown[]; name: string | null }[]).filter((f) => f.ships.length > 0);
        expect(fleets.length).toBeGreaterThanOrEqual(systems.size);
        if (process.env.DWU_SOAK_OUT) appendFileSync(process.env.DWU_SOAK_OUT, `start warships ${st.startWarships}, cost ${Math.round(st.startCost)}, treasury ${Math.round(r.stateMoney)}, spread ${byGroup.join('/')}\n`);
    }, 600000);

    it('a wizard-generated Oranthi AI gets the treasury and the warships too', () => {
        const g = rimGame({}, {}, true).galaxy;
        const r = rimTraderEmpire(g)!;
        expect(rimNavyState(g).startWarships).toBe(40);
        expect(r.stateMoney).toBeCloseTo(5000000 - rimNavyState(g).startCost, 0);
    }, 600000);

    it('trade house profits, the rare price factor, and the yearly navy order at the yards', () => {
        const g = rimGame().galaxy;
        const r = rimTraderEmpire(g)!;
        const before = r.stateMoney;
        expect(concordTradeHouseYear(g)).toBe(500000);
        expect(r.stateMoney).toBe(before + 500000);
        expect(empireMessages(r).some((m) => m.title === scenarioText('Scenario RimTrade Trade House Title'))).toBe(true);
        // A stock contract for a rare good: the buyer pays 2× (the factor on top), the standing is spent at 2×.
        const buyer = others(g, r)[0];
        const rare = rareGoodIds(g)[0];
        const bm = buyer.stateMoney;
        const rm = r.stateMoney;
        scenarioEmit(g, 'contractInitiated', { seller: r, buyer, sellingPoint: null, destination: null, resourceId: rare, componentId: -1, amount: 10, value: 1000, isState: true, freighter: null });
        expect(buyer.stateMoney).toBe(bm - 1000);
        expect(r.stateMoney).toBe(rm + 1000);
        expect(rimTradeState(g).ledger[buyer.empireId].debit).toBe(2000);
        // The navy: with money above the reserve, warships are ordered at the shipyards (queued, not spawned).
        r.stateMoney = 20000000;
        const n0 = concordWarships(r).length;
        const ordered = concordNavyYear(g);
        expect(ordered).toBeGreaterThan(0);
        const now = concordWarships(r);
        expect(now.length).toBe(n0 + ordered);
        expect(now.filter((b) => b.builtAt !== null).length).toBeGreaterThanOrEqual(ordered);
        expect(concordWarships(r).length).toBeLessThanOrEqual(rimParam(g, 'rimTraderNavyTarget'));
        // Below the reserve nothing is bought.
        r.stateMoney = 900000;
        expect(concordNavyYear(g)).toBe(0);
    }, 600000);
});
