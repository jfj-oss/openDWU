// M4k — research progress (Empire.3.cs PerformResearch / DoResearchBreakthrough / SelectNextResearchProject /
// DoCrashResearch / ReviewResearchStationBonuses; ResearchNodeList helpers). Hand-worked C# expectations.
import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { setGovernmentsStatic } from '../src/sim/empire';
import { generateEmpire } from '../src/sim/empireGeneration';
import {
    getSecondLowestProjectForTypeAny,
    mergeNodes,
    intersectNodes,
    notIntersectNodes,
    nodeIndustry,
    selectRandomLowestProject,
    type TechNode,
} from '../src/sim/researchSystem';
import {
    calculateCrashResearchProgramCost,
    calculateResearchTotal,
    calculateResearchOutputBonuses,
    doCrashResearch,
    doResearchBreakthrough,
    performResearch,
    raceBuildWonderVictoryFacility,
    reviewResearchStationBonuses,
    selectNextResearchProject,
} from '../src/sim/researchTick';
import { ComponentType } from '../src/sim/data/components';
import { EmpireMessageType } from '../src/sim/messages';
import { GalaxyShape, HabitatCategoryType, IndustryType } from '../src/sim/types';
import { Random } from '../src/sim/random';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame, cachedTickGameRun } from './helpers/gameCache';
import { runGameSeconds } from '../src/sim/tick/harness';
import type { GameData } from '../src/sim/data/gameData';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function empireAt(techLevel: number, raceName = 'Human') {
    const g = generateGalaxy({ seed: 2, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`), gameData });
    const race = gameData.races.find((r) => r.name === raceName)!;
    const cap = g.habitats.find((h) => h.category === HabitatCategoryType.Planet && h.type === race.nativeHabitatType)!;
    const r = generateEmpire(g, true, 'P', cap, race, -1, 0, 1.0, 'Normal', 0, techLevel, 1.0);
    r.empire.controlResearch = true;
    // generateEmpire runs the game-start Empire.DoTasks, whose PerformResearch already queued projects: start clean.
    r.empire.research.researchQueueEnergy.length = 0;
    r.empire.research.researchQueueHighTech.length = 0;
    r.empire.research.researchQueueWeapons.length = 0;
    return { g, race, empire: r.empire };
}

describe('M4k tech tree model (ObtainTechTree / UpdateParentNodes / RefreshLatestNextProjects)', () => {
    it('nodes carry the SetResearchCosts cost (float) and file parents', () => {
        const { empire } = empireAt(0.5);
        const tree = empire.research.techTree;
        for (const n of tree) {
            // Galaxy.3.cs SetResearchCosts: 2^(TechLevel-1) × 120000 (256× at level ≥ 100) unless overridden.
            if (n.def.baseCostMultiplierOverride <= 0 && n.def.projectId !== 220 && !(n.def.abilities.some((a) => a.type === 1))) {
                const mult = n.def.techLevel >= 100 ? 256 : Math.pow(2, n.def.techLevel - 1);
                expect(n.cost).toBe(Math.fround(mult * 120000));
            }
            expect(n.parentNodes.length).toBe(n.def.parents.filter((p) => tree.some((t) => t.def.projectId === p.parentProjectId)).length);
            for (let i = 0; i < n.parentNodes.length; i++) expect(n.parentNodes[i].def.projectId).toBe(n.def.parents[i].parentProjectId);
        }
    });

    it('NextProjects = unresearched, enabled, race-allowed nodes whose required parents are done and some parent is done', () => {
        const { empire, race } = empireAt(0.5);
        const rs = empire.research;
        expect(rs.nextProjects).not.toBeNull();
        for (const n of rs.nextProjects!) {
            expect(n.isResearched).toBe(false);
            expect(n.isEnabled).toBe(true);
            for (let i = 0; i < n.parentNodes.length; i++) if (n.parentIsRequired[i]) expect(n.parentNodes[i].isResearched).toBe(true);
            if (n.parentNodes.length > 0) expect(n.parentNodes.some((p) => p.isResearched)).toBe(true);
            if (rs.allowedRacesCount(n) > 0) expect(rs.allowedRacesContains(n, race)).toBe(true);
        }
    });

    it('CanResearchNode counts queued required parents as reachable', () => {
        const { empire } = empireAt(0.5);
        const rs = empire.research;
        const child = rs.techTree.find((n) => !n.isResearched && n.isEnabled && n.parentNodes.length === 1 && !n.parentNodes[0].isResearched && nodeIndustry(n) === nodeIndustry(n.parentNodes[0]))!;
        expect(child).toBeDefined();
        expect(rs.canResearchNode(child)).toBe(false);
        rs.researchQueueFor(nodeIndustry(child))!.push(child.parentNodes[0]);
        expect(rs.canResearchNode(child)).toBe(true);
    });
});

describe('M4k ResearchNodeList helpers', () => {
    const mk = (id: number, techLevel: number): TechNode =>
        ({ def: { projectId: id, techLevel } as TechNode['def'], isResearched: false, isEnabled: true, progress: 0, selfResearched: false, cost: 0, isRushing: false, parentNodes: [], parentIsRequired: [], sortTag: 0 }) as TechNode;
    it('Merge / Intersect / NotIntersect by id, in C# order', () => {
        const a = mk(1, 1), b = mk(2, 1), c = mk(3, 2);
        expect(mergeNodes([a, b], [b, c]).map((n) => n!.def.projectId)).toEqual([1, 2, 3]);
        // Intersect returns the argument's entries whose id is in `this`.
        expect(intersectNodes([a, c], [c, b, a]).map((n) => n.def.projectId)).toEqual([3, 1]);
        expect(notIntersectNodes([a, b, c], [b]).map((n) => n.def.projectId)).toEqual([1, 3]);
    });
    it('SelectRandomLowestProject draws Next(0, count of lowest level)', () => {
        const list = [mk(1, 3), mk(2, 2), mk(3, 2), mk(4, 5)];
        const r1 = new Random(7);
        const r2 = new Random(7);
        const picked = selectRandomLowestProject(r1, list)!;
        expect(picked.def.projectId).toBe([2, 3][r2.next(0, 2)]);
        expect(r1.drawCount).toBe(r2.drawCount);
    });
    it('GetSecondLowestProjectForTypeAny returns the previous lowest seen (verbatim C# semantics)', () => {
        const { empire } = empireAt(0.5);
        const rs = empire.research;
        const hyper = rs.techTree.filter((n) => rs.componentTypesAll(n).includes(ComponentType.HyperDrive));
        // Walk exactly as the C# loop does.
        let num = Number.MAX_VALUE;
        let last: TechNode | null = null;
        let expected: TechNode | null = null;
        for (const n of rs.techTree) {
            if (rs.componentTypesAll(n).includes(ComponentType.HyperDrive) && n.def.techLevel < num) {
                if (last !== null) expected = last;
                last = n;
                num = n.def.techLevel;
            }
        }
        expect(hyper.length).toBeGreaterThan(1);
        expect(getSecondLowestProjectForTypeAny(rs, rs.techTree, ComponentType.HyperDrive)).toBe(expected);
    });
});

describe('M4k PerformResearch', () => {
    it('progress = power × t / 600 × speed × bonuses (float), completion removes the node and messages', () => {
        const { g, empire } = empireAt(0.5);
        const rs = empire.research;
        empire.controlResearch = false;
        const node = rs.nextProjects!.find((n) => nodeIndustry(n) === IndustryType.Energy)!;
        rs.researchQueueEnergy.push(node);
        const totals = calculateResearchTotal(empire);
        const bonus = calculateResearchOutputBonuses(empire, IndustryType.Energy);
        const expected = Math.fround(((totals.researchEnergy * 30) / 600) * 1.0 * bonus);
        const before = g.rnd.drawCount;
        performResearch(g, empire, 30, false);
        // No queue selection (ControlResearch off), no research events (allowResearchEvents false): no Rnd.
        expect(g.rnd.drawCount).toBe(before);
        expect(node.progress).toBe(expected);
        // Force completion.
        node.progress = Math.fround(node.cost - 1);
        const msgs = empire.messages.length;
        performResearch(g, empire, 30, false);
        expect(node.isResearched).toBe(true);
        expect(node.selfResearched).toBe(true);
        expect(node.progress).toBe(node.cost);
        expect(rs.researchQueueEnergy).not.toContain(node);
        expect(rs.recentProjects).toContain(node);
        const m = (empire.messages as { messageType: EmpireMessageType }[]).slice(msgs).map((x) => x.messageType);
        expect(m).toContain(EmpireMessageType.ResearchBreakthrough);
        // Update(race) refreshed NextProjects.
        expect(rs.nextProjects!.includes(node)).toBe(false);
    });

    it('rushing triples the per-tick progress', () => {
        const { g, empire } = empireAt(0.5);
        const rs = empire.research;
        empire.controlResearch = false;
        const node = rs.nextProjects!.find((n) => nodeIndustry(n) === IndustryType.Weapon && n.cost > 1e6)!;
        rs.researchQueueWeapons.push(node);
        node.isRushing = true;
        const totals = calculateResearchTotal(empire);
        const bonus = calculateResearchOutputBonuses(empire, IndustryType.Weapon);
        performResearch(g, empire, 10, false);
        expect(node.progress).toBe(Math.fround(Math.fround(((totals.researchWeapons * 10) / 600) * bonus) * 3));
    });

    it('ControlResearch fills an empty queue from NextProjects of that industry (one Rnd draw per selection)', () => {
        const { g, empire } = empireAt(0.5);
        const rs = empire.research;
        for (const industry of [IndustryType.Weapon, IndustryType.Energy, IndustryType.HighTech]) {
            const q = rs.researchQueueFor(industry)!;
            const before = g.rnd.drawCount;
            selectNextResearchProject(g, empire, industry, q);
            expect(q.length).toBe(1);
            expect(nodeIndustry(q[0])).toBe(industry);
            expect(rs.nextProjects!).toContain(q[0]);
            expect(g.rnd.drawCount - before).toBe(1);
        }
    });

    it('DoResearchBreakthrough of a component project flags design review and refreshes research', () => {
        const { g, empire } = empireAt(0.5);
        const rs = empire.research;
        const node = rs.nextProjects!.find((n) => n.def.components.length > 0)!;
        const comp = rs.definitionFor(node.def.components[0])!;
        expect(rs.checkComponentResearched(comp)).toBe(false);
        doResearchBreakthrough(g, empire, node, false);
        expect(empire.reviewDesignsAndRetrofitFlag).toBe(true);
        expect(node.selfResearched).toBe(false);
        expect(rs.checkComponentResearched(comp)).toBe(true);
    });
});

describe('M4k crash research, station bonuses, race wonder victory', () => {
    it('crash cost = (Cost - Progress) / 4 (float subtraction)', () => {
        const { empire } = empireAt(0.5);
        const n = empire.research.techTree[0];
        n.progress = Math.fround(1000.5);
        expect(calculateCrashResearchProgramCost(empire, n)).toBe(Math.fround(n.cost - n.progress) / 4);
    });

    it('DoCrashResearch: no queued project → no Rnd; the player empire never crashes', () => {
        const { g, empire } = empireAt(0.5);
        const before = g.rnd.drawCount;
        doCrashResearch(g, empire);
        expect(g.rnd.drawCount).toBe(before);
        g.playerEmpire = empire;
        empire.research.researchQueueEnergy.push(empire.research.nextProjects!.find((n) => nodeIndustry(n) === IndustryType.Energy)!);
        doCrashResearch(g, empire);
        expect(g.rnd.drawCount).toBe(before);
    });

    it('DoCrashResearch rushes a project it can afford and pays for it', () => {
        const { g, empire } = empireAt(0.5);
        g.playerEmpire = null;
        const node = empire.research.nextProjects!.find((n) => nodeIndustry(n) === IndustryType.Energy)!;
        empire.research.researchQueueEnergy.push(node);
        empire.stateMoney = 1e9;
        empire.initiateConstruction = true;
        let rushed = false;
        for (let i = 0; i < 40 && !rushed; i++) {
            const money = empire.stateMoney;
            doCrashResearch(g, empire);
            if (node.isRushing) {
                rushed = true;
                expect(empire.stateMoney).toBe(money - calculateCrashResearchProgramCost(empire, node));
            }
        }
        expect(rushed).toBe(true);
    });

    it('ReviewResearchStationBonuses picks the best station per industry from ParentHabitat research bonus', () => {
        const { g, empire } = empireAt(0.5);
        reviewResearchStationBonuses(g, empire);
        // No research base yet in a bare generateEmpire galaxy: all zero / null.
        expect(empire.researchBonusEnergy).toBe(0);
        expect(empire.researchBonusEnergyStation).toBeNull();
    });

    it('race BuildWonder victory condition resolves to its facilities.txt row', () => {
        const { g } = empireAt(0.5);
        const wekkarus = gameData.races.find((r) => r.name === 'Wekkarus')!;
        const f = raceBuildWonderVictoryFacility(g, wekkarus);
        expect(f).not.toBeNull();
        expect(f!.type).toBe(8); // Wonder
        const human = gameData.races.find((r) => r.name === 'Human')!;
        expect(raceBuildWonderVictoryFacility(g, human)).toBeNull();
    });
});

describe('M4k harness milestone', () => {
    it('research completes over runGameSeconds on the tick galaxy', () => {
        // At the base rate (~90k/yr per industry, first projects cost 240k) a project needs ~1400 game-seconds; the old
        // 600 s window only passed because one empire got a research boost in that galaxy. After M4u the tick galaxy's
        // AI races differ, so run in 300 s steps until the first completion (bounded at 1800 s).
        // The first steps come from the test game cache (test/helpers/gameCache.ts): the tick galaxy after 300 s, then
        // after 600 s (runGameSeconds in 300 s steps equals one call: 300 s is a frame boundary).
        const completedOf = (x: Galaxy) => x.empires.reduce((s, e) => s + e.research.recentProjects.length, 0);
        let g = cachedTickGameRun(gameData, { seconds: 300 }).game.galaxy;
        let completed = completedOf(g);
        let t = 300;
        if (completed === 0) {
            g = cachedTickGameRun(gameData, { seconds: 600 }).game.galaxy;
            completed = completedOf(g);
            t = 600;
        }
        for (; t < 1800 && completed === 0; t += 300) {
            runGameSeconds(g, 300);
            completed = completedOf(g);
        }
        expect(completed).toBeGreaterThan(0);
        for (const e of g.empires) {
            // AI empires keep all three queues busy.
            if (e.controlResearch) {
                expect(e.research.researchQueueEnergy.length + e.research.researchQueueHighTech.length + e.research.researchQueueWeapons.length).toBeGreaterThan(0);
            }
            for (const n of e.research.techTree) expect(Number.isFinite(n.progress)).toBe(true);
        }
    }, 1800000);
});
