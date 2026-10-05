// Smarter AI add-on, parts 3 and 4 (src/sim/scenario/smarterAI/budget.ts, retrofit.ts): in debt an AI empire scraps
// its oldest obsolete state ships and skips low-value builds; above the surplus threshold its build targets rise;
// obsolete idle warships get retrofit missions, current ones do not. (Flags off = the faithful game: smarterAI.test.ts.)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Design } from '../src/sim/design';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { cloneDesign } from '../src/sim/gameStartTail';
import { scenarioQuery } from '../src/sim/scenario/hooks';
import { isSmarterAIEmpire } from '../src/sim/scenario/smarterAI/common';
import { DEFENCE_SURPLUS_FACTOR, SURPLUS_YEARS, isObsoleteBuiltObject, reviewBudget, reviewEconomy, smarterEconomyState } from '../src/sim/scenario/smarterAI/budget';
import { MAX_RETROFITS_IN_FLIGHT, componentGap, reviewFleetRetrofits } from '../src/sim/scenario/smarterAI/retrofit';
import { stateUpkeep } from '../src/sim/scenario/smarterAI/taxes';

const SC = 'smarter-ai';
const WARSHIPS = [BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Carrier];

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const aiEmpires = (g: Galaxy): Empire[] => g.empires.filter((e) => isSmarterAIEmpire(g, e));
const state = (e: Empire): BuiltObject[] => e.builtObjects as BuiltObject[];
const done = (b: BuiltObject): boolean => b.builtAt === null && b.unbuiltComponentCount <= 0 && b.design !== null;

/** A newer copy of `old` (same components) the empire can build: every ship on `old` becomes obsolete. */
function newerDesign(e: Empire, old: Design): Design {
    const d = cloneDesign(old);
    d.dateCreated = Math.max(...e.designs.map((x) => x.dateCreated)) + 1;
    e.designs.push(d);
    return d;
}

function warshipEmpire(g: Galaxy): { e: Empire; ships: BuiltObject[] } {
    for (const e of aiEmpires(g)) {
        if (e.spacePorts.length === 0) continue;
        for (const sr of WARSHIPS) {
            const ships = state(e).filter((b) => b.subRole === sr && done(b) && b.shipGroup === null);
            if (ships.length >= 2) return { e, ships };
        }
    }
    throw new Error('no AI empire with two loose warships of one sub-role and a space port');
}

describe('3. cut costs when broke', () => {
    it('in debt, an obsolete state ship is sent to scrap; current ones are not; low-value builds are skipped', () => {
        const g = createScenarioGame(base, { scenario: SC }).game.galaxy;
        const { e, ships } = warshipEmpire(g);
        const [oldShip, newShip] = ships;
        const newer = newerDesign(e, oldShip.design!);
        for (const b of ships.slice(1)) b.design = newer;
        expect(isObsoleteBuiltObject(e, oldShip)).toBe(true);
        expect(isObsoleteBuiltObject(e, newShip)).toBe(false);
        const before = new Set(state(e));
        const obsolete = new Set(state(e).filter((b) => isObsoleteBuiltObject(e, b)));
        e.stateMoney = -1e9;
        const r = reviewBudget(g, e);
        expect(r.inDebt).toBe(true);
        const retired = [...before].filter((b) => !state(e).includes(b) || b.hasBeenDestroyed || builtObjectMission(b.mission)?.type === BuiltObjectMissionType.Retire);
        expect(retired.length).toBeGreaterThan(0);
        for (const b of retired) expect(obsolete.has(b)).toBe(true);
        expect(retired).not.toContain(newShip);
        expect(smarterEconomyState(g).debt[String(e.empireId)]).toBe(true);
        expect(scenarioQuery(g, 'stateBuildSkipped', false, { empire: e, subRole: BuiltObjectSubRole.ResupplyShip })).toBe(true);
        expect(scenarioQuery(g, 'stateBuildSkipped', false, { empire: e, subRole: BuiltObjectSubRole.Destroyer })).toBe(false);
        // The player is never touched.
        expect(scenarioQuery(g, 'stateBuildSkipped', false, { empire: g.playerEmpire!, subRole: BuiltObjectSubRole.ResupplyShip })).toBe(false);
        // The flag off: nothing skipped.
        g.scenario!.flags.smarterAIBudget = false;
        expect(scenarioQuery(g, 'stateBuildSkipped', false, { empire: e, subRole: BuiltObjectSubRole.ResupplyShip })).toBe(false);
    }, 600000);

    it('above the surplus threshold the colony-ship, defence, research-station and wonder targets rise', () => {
        const g = createScenarioGame(base, { scenario: SC }).game.galaxy;
        const e = aiEmpires(g)[0];
        const ask = () => ({
            colonize: scenarioQuery(g, 'colonizationBuildAllowed', false, { empire: e }),
            defence: scenarioQuery(g, 'aiBuildTarget', 1000, { empire: e, kind: 'defensiveForce' }),
            stations: scenarioQuery(g, 'aiBuildTarget', 2, { empire: e, kind: 'researchStationsPerColony' }),
            wonder: scenarioQuery(g, 'aiBuildTarget', 1.5, { empire: e, kind: 'wonderMoneyDivisor' }),
        });
        e.stateMoney = Math.max(1, stateUpkeep(e)) * (SURPLUS_YEARS - 1) * 0.5;
        expect(reviewEconomy(g, e).surplus).toBe(false);
        expect(ask()).toEqual({ colonize: false, defence: 1000, stations: 2, wonder: 1.5 });
        e.stateMoney = Math.max(1, stateUpkeep(e)) * (SURPLUS_YEARS + 1);
        expect(reviewEconomy(g, e).surplus).toBe(true);
        const up = ask();
        expect(up.colonize).toBe(true);
        expect(up.defence).toBe(Math.trunc(1000 * DEFENCE_SURPLUS_FACTOR));
        expect(up.stations).toBeGreaterThan(2);
        expect(up.wonder).toBeLessThan(1.5);
        expect(up.wonder).toBeGreaterThanOrEqual(1);
        // The player is never raised.
        expect(scenarioQuery(g, 'aiBuildTarget', 1000, { empire: g.playerEmpire!, kind: 'defensiveForce' })).toBe(1000);
    }, 600000);
});

describe('4. keep fleets up to date', () => {
    it('obsolete idle warships get retrofit missions (at most N at a time); current ones do not', () => {
        const g = createScenarioGame(base, { scenario: SC }).game.galaxy;
        const { e, ships } = warshipEmpire(g);
        const [oldShip, newShip] = ships;
        const newer = newerDesign(e, oldShip.design!);
        // A real component gap: the newer design drops one component (retrofit cost stays small).
        newer.components = newer.components.slice(0, -1);
        expect(componentGap(newer, oldShip.design!)).toBe(1);
        newShip.design = newer;
        for (const b of ships) b.mission = null;
        e.stateMoney = 1e9;
        const sent = reviewFleetRetrofits(g, e);
        expect(sent.length).toBeGreaterThan(0);
        expect(sent.length).toBeLessThanOrEqual(MAX_RETROFITS_IN_FLIGHT);
        const refitting = (b: BuiltObject): boolean => b.retrofitDesign !== null || builtObjectMission(b.mission)?.type === BuiltObjectMissionType.Retrofit || (b.shipGroup as { mission: { type: number } | null } | null)?.mission?.type === BuiltObjectMissionType.Retrofit;
        expect(sent.some((u) => u.ship === oldShip)).toBe(true);
        expect(refitting(oldShip)).toBe(true);
        expect(refitting(newShip)).toBe(false);
        expect(sent.every((u) => u.ship !== newShip)).toBe(true);
        // A second review sends nothing past the cap; in debt, nothing at all.
        reviewFleetRetrofits(g, e);
        expect(sent.length).toBeLessThanOrEqual(MAX_RETROFITS_IN_FLIGHT);
        e.stateMoney = -1e9;
        expect(reviewFleetRetrofits(g, e)).toEqual([]);
    }, 600000);
});
