// Smarter AI add-on parts 5 and 6 (src/sim/scenario/smarterAI/colonies.ts, independents.ts): flags off = the faithful
// game; a resource-short empire ranks a target with that resource higher; a target next to a known pirate base ranks
// lower; the extra colony ship needs the treasury; a nearby willing independent becomes an annex target (a higher
// colonisation priority) and a nearby weak unwilling one an invade target — never under a pacifist policy.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { identifyColonizationTargets } from '../src/sim/civilianAI';
import { checkColonizationLikeliness } from '../src/sim/tradeItems';
import { determineRequiredTroopStrength } from '../src/sim/fleets/militaryAI';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { isSmarterAIEmpire } from '../src/sim/scenario/smarterAI/common';
import { PIRATE_DANGER_RANGE, colonyPickContext, extraColonyShipAllowed, smarterColonyValue, type ColonyPickContext } from '../src/sim/scenario/smarterAI/colonies';
import { ANNEX_BONUS, NEAR_RANGE, WEAK_TROOP_STRENGTH, distanceToEmpire, independentAction, isPopulatedIndependent, mayInvadeIndependents } from '../src/sim/scenario/smarterAI/independents';

const SC = 'smarter-ai';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

let shared: { game: Game; gameData: GameData } | null = null;
function smartGame(): Galaxy {
    if (shared === null) shared = createScenarioGame(base, { scenario: SC });
    return shared.game.galaxy;
}
const aiEmpires = (g: Galaxy): Empire[] => g.empires.filter((e) => isSmarterAIEmpire(g, e));
const noCtx = (): ColonyPickContext => ({ shortages: new Map(), pirateBases: [], hostileFleets: [] });

describe('flags off = faithful game', () => {
    it('the master switch off (colonies / independents on) runs 600 s byte-identical to the plain seed-1 game', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        const { game } = createScenarioGame(base, { scenario: SC, flags: { smarterAI: false, smarterAIColonies: true, smarterAIIndependents: true } });
        runGameSeconds(game, 600);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
    }, 1200000);
});

describe('5. smarter colony picks', () => {
    /** An AI empire and two explored planets, `a` with a known resource `b` lacks. */
    function pair(g: Galaxy): { e: Empire; a: Habitat; b: Habitat; res: number } {
        for (const e of aiEmpires(g)) {
            const known = g.habitats.filter((h) => h.resources.length > 0 && e.resourceMap.checkResourcesKnown(h));
            for (const a of known) {
                const res = a.resources[0].resourceId;
                const b = known.find((h) => h !== a && !h.resources.some((r) => r.resourceId === res));
                if (b !== undefined) return { e, a, b, res };
            }
        }
        throw new Error('no pair');
    }

    it('a resource-short empire ranks a target with the short resource higher', () => {
        const g = smartGame();
        const { e, a, b, res } = pair(g);
        const v = 10000;
        // No shortage: the same stock value scores the same; short of `res`: `a` outranks `b`.
        expect(smarterColonyValue(g, e, a, v, noCtx())).toBe(v);
        const short: ColonyPickContext = { ...noCtx(), shortages: new Map([[res, 5]]) };
        expect(smarterColonyValue(g, e, a, v, short)).toBeGreaterThan(smarterColonyValue(g, e, b, v, short));
        expect(smarterColonyValue(g, e, b, v, short)).toBe(v);
        // The live context: the empire's top shortages are real resource ids with demand at least the supply.
        for (const [id, ratio] of colonyPickContext(g, e).shortages) {
            expect(g.resourceSystem.resources.some((r) => r.resourceId === id)).toBe(true);
            expect(ratio).toBeGreaterThanOrEqual(1);
        }
    });

    it('a target next to a known pirate base (or a hostile fleet) ranks lower; far ones are untouched', () => {
        const g = smartGame();
        const { e, a } = pair(g);
        const v = 10000;
        const near: ColonyPickContext = { ...noCtx(), pirateBases: [{ x: a.xpos + 30000, y: a.ypos }] };
        const far: ColonyPickContext = { ...noCtx(), pirateBases: [{ x: a.xpos + PIRATE_DANGER_RANGE * 2, y: a.ypos }] };
        expect(smarterColonyValue(g, e, a, v, near)).toBeLessThan(v / 2);
        expect(smarterColonyValue(g, e, a, v, far)).toBe(v);
        expect(smarterColonyValue(g, e, a, v, { ...noCtx(), hostileFleets: [{ x: a.xpos, y: a.ypos }] })).toBeLessThan(v);
    });

    it('one more colony ship past the stock gate only with cash above 3 years of upkeep and none in hand', () => {
        const g = smartGame();
        for (const e of aiEmpires(g)) {
            const money = e.stateMoney;
            e.stateMoney = -1;
            expect(extraColonyShipAllowed(g, e)).toBe(false);
            e.stateMoney = 1e12;
            const hasShip = e.builtObjects.some((x) => x !== null && x.subRole === BuiltObjectSubRole.ColonyShip);
            const good = e.colonizationTargets.some((t) => t.priority >= 500 && t.assignedShip == null);
            if (hasShip || !good) expect(extraColonyShipAllowed(g, e)).toBe(false);
            e.stateMoney = money;
        }
    });
});

describe('6. absorb independent worlds', () => {
    it('a nearby willing independent becomes an annex target: its colonisation priority rises with the flag', () => {
        const g = smartGame();
        const s = g.scenario!;
        let checked = 0;
        for (const e of aiEmpires(g)) {
            for (const h of g.habitats) {
                if (!isPopulatedIndependent(g, h) || distanceToEmpire(g, e, h) > NEAR_RANGE || checkColonizationLikeliness(g, h, e.dominantRace!) <= 0) continue;
                expect(independentAction(g, e, h)).toBe('annex');
                s.flags.smarterAIIndependents = false;
                const off = identifyColonizationTargets(g, e).find((t) => t.habitat === h);
                s.flags.smarterAIIndependents = true;
                const on = identifyColonizationTargets(g, e).find((t) => t.habitat === h);
                if (off === undefined) continue; // out of reach for the stock rules
                expect(on).toBeDefined();
                expect(on!.priority).toBeGreaterThanOrEqual(Math.trunc(off.priority * ANNEX_BONUS) - 1);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(0);
    }, 600000);

    it('a nearby weakly garrisoned unwilling independent becomes an invade target, except under a pacifist policy', () => {
        const g = smartGame();
        let checked = 0;
        for (const e of aiEmpires(g)) {
            for (const h of g.habitats) {
                if (!isPopulatedIndependent(g, h) || distanceToEmpire(g, e, h) > NEAR_RANGE || checkColonizationLikeliness(g, h, e.dominantRace!) >= -3) continue;
                if (determineRequiredTroopStrength(g, e, h) > WEAK_TROOP_STRENGTH || !mayInvadeIndependents(g, e)) continue;
                expect(independentAction(g, e, h)).toBe('invade');
                const pol = e.policy!;
                const saved = pol.warWillingness;
                pol.warWillingness = 0.5; // a pacifist race policy (Quameno / Ketarov / Wekkarus)
                expect(independentAction(g, e, h)).toBe(null);
                pol.warWillingness = saved;
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(0);
    }, 600000);
});

describe('flags on', () => {
    it('the add-on with every flag on runs 120 s (the hooks fire without error)', () => {
        const { game } = createScenarioGame(base, { scenario: SC });
        runGameSeconds(game, 120);
        expect(game.galaxy.nowMs).toBeGreaterThan(0);
    }, 1200000);
});
