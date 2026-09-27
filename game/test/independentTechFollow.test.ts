// §19k tech-follow addendum (tasks/19-mod-layer-scenarios.md §19k, "independent tech follow"): the independent
// empire's tech tree, otherwise frozen at its Empire.cs 4146 initializeIndependentCtor start forever, drifts toward
// a share of the galaxy's median regular-empire tech level (independentTechFollowPct, refreshed every
// independentTechRefreshYears game years). Handlers are driven directly (refreshIndependentTech), like the rest of
// the 19k-2/3 test suite — no need to run real game-years of simulation to reach a refresh boundary.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, loadScenarioOverlayFs } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { EmpireMessage } from '../src/sim/messages';
import type { Design } from '../src/sim/design';
import type { ScenarioOverlay } from '../src/sim/scenario';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { independentDesign, refreshIndependentTech } from '../src/sim/scenario/independents/independents';
import { independentsState } from '../src/sim/scenario/independents/common';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 600000);

/** darkFarms.ts hostTechLevel's "highest researched tech-tree level" measure — the same units refreshIndependentTech
 *  (independents.ts) uses internally; duplicated here rather than exported, to keep it a test-only probe. */
function techLevelOf(e: Empire): number {
    let max = 0;
    for (const n of e.research.techTree) if (n.isResearched && n.def.techLevel > max) max = n.def.techLevel;
    return max;
}

/** The highest tech-tree level that introduces or improves any component used by `design` (a "how good is this
 *  design's hardware" probe for the militia-design test). */
function maxComponentTechLevel(g: Galaxy, design: Design): number {
    const ind = g.independentEmpire!;
    let max = 0;
    for (const c of design.components) {
        for (const n of ind.research.techTree) {
            if (n.def.components.includes(c.componentId) && n.def.techLevel > max) max = n.def.techLevel;
        }
    }
    return max;
}

function normalEmpiresOf(g: Galaxy): Empire[] {
    return g.empires.filter((e): e is Empire => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
}

/** Sets `empires`' tech level to an exact integer (no Rnd draw: setTechTreeLevel short-circuits its fractional
 *  per-node roll away for an integer target). */
function setEmpiresTechLevel(g: Galaxy, empires: Empire[], level: number): void {
    for (const e of empires) {
        e.research.setTechTreeLevel(g.rnd, e.dominantRace, level, false);
        e.research.update(e.dominantRace);
    }
}

function caughtUpMessage(g: Galaxy): EmpireMessage | undefined {
    for (const e of g.empires) {
        if (e === null) continue;
        const list = e.messages as unknown as EmpireMessage[];
        const m = list.find((x) => x.description.includes('caught up'));
        if (m !== undefined) return m;
    }
    return undefined;
}

describe('19k addendum — independent tech follow', () => {
    it('flags off: no package code runs, byte-identical (digest + draw count)', () => {
        const off = createScenarioGame(base, { scenario: 'independents-active', flags: { independentActors: false, independentLeagues: false } }).game;
        const full = loadScenarioOverlayFs('independents-active');
        const noFlag: ScenarioOverlay = { ...full, manifest: { ...full.manifest, flags: full.manifest.flags.filter((f) => f.name !== 'independentActors' && f.name !== 'independentLeagues') } };
        const ref = createScenarioGame(base, { scenario: noFlag }).game;
        runGameSeconds(off.galaxy, 60);
        runGameSeconds(ref.galaxy, 60);
        expect('independents' in off.galaxy.scenario!.state).toBe(false);
        expect(stateDigest(off.galaxy)).toBe(stateDigest(ref.galaxy));
        expect(stateCounts(off.galaxy)).toEqual(stateCounts(ref.galaxy));
        expect(off.galaxy.rnd.drawCount).toBe(ref.galaxy.rnd.drawCount);
    }, 600000);

    it('raises the independent tech fraction to the target and never lowers it', () => {
        const g = createScenarioGame(base, { scenario: 'independents-active' }).game.galaxy;
        const ind = g.independentEmpire!;
        // Boost every AI empire (not the player) to Level 5, well above the independent empire's frozen start level;
        // the player empire is left at its game-start level.
        setEmpiresTechLevel(g, normalEmpiresOf(g).filter((e) => e !== g.playerEmpire), 5);
        expect(refreshIndependentTech(g)).toBe(true);
        // median([playerStart(1), 5, 5, 5]) = 5; target = independentTechFollowPct(60%) × 5 = 3.
        expect(techLevelOf(ind)).toBe(3);
        expect(independentsState(g).stats.techRefreshes).toBe(1);
        expect(caughtUpMessage(g)).toBeDefined();

        // No further advance: calling again right away changes nothing and sends no further news.
        expect(refreshIndependentTech(g)).toBe(false);
        expect(techLevelOf(ind)).toBe(3);
        expect(independentsState(g).stats.techRefreshes).toBe(1);

        // Regression: the galaxy median falls back below the independent empire's own level — never lowers it.
        setEmpiresTechLevel(g, normalEmpiresOf(g), 1);
        expect(refreshIndependentTech(g)).toBe(false);
        expect(techLevelOf(ind)).toBe(3);
        expect(independentsState(g).stats.techRefreshes).toBe(1);
    }, 600000);

    it('new militia after a refresh uses a better design than before (component tech level)', () => {
        const g = createScenarioGame(base, { scenario: 'independents-active' }).game.galaxy;
        const before = independentDesign(g, BuiltObjectSubRole.Escort)!;
        const beforeLevel = maxComponentTechLevel(g, before);
        setEmpiresTechLevel(g, normalEmpiresOf(g).filter((e) => e !== g.playerEmpire), 5);
        expect(refreshIndependentTech(g)).toBe(true);
        const after = independentDesign(g, BuiltObjectSubRole.Escort)!;
        expect(after).not.toBe(before); // regenerated: existing ships still reference `before`
        expect(maxComponentTechLevel(g, after)).toBeGreaterThan(beforeLevel);
    }, 600000);

    it('a game where regular empires have not advanced produces no change and no news', () => {
        const g = createScenarioGame(base, { scenario: 'independents-active' }).game.galaxy;
        const ind = g.independentEmpire!;
        const start = techLevelOf(ind);
        // Pull every normal empire down to the independent empire's own level: nothing left to catch up to.
        setEmpiresTechLevel(g, normalEmpiresOf(g), start);
        expect(refreshIndependentTech(g)).toBe(false);
        expect(techLevelOf(ind)).toBe(start);
        expect(independentsState(g).stats.techRefreshes).toBe(0);
        expect(caughtUpMessage(g)).toBeUndefined();
    }, 600000);
});
