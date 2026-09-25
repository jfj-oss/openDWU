import { describe, it, expect, beforeEach } from 'vitest';
import { ResearchSystem, type TechNode } from '../src/sim/researchSystem';
import { IndustryType } from '../src/sim/types';
import type { Empire } from '../src/sim/empire';
import {
    researchIndustryLabel,
    formatPercent0,
    currentProjectText,
    researchNodeStatus,
    queueResearchProject,
    dequeueResearchProject,
    researchQueueRows,
    researchCounts,
    researchTreeColumns,
    crashResearchOffer,
    crashQuestion,
} from '../src/ui/screens/researchScreen';
import { formatMoney } from '../src/ui/hud';
import { isKeyActionAvailable } from '../src/ui/keyboard';

function node(id: number, industry: number, techLevel: number, row: number, extra: Record<string, unknown> = {}): TechNode {
    return {
        def: { projectId: id, name: `P${id}`, techLevel, row, industry, category: 0, specialFunctionCode: 0, components: [], componentImprovements: [], abilities: [], fighters: [], parents: [], allowedRaces: [] },
        isResearched: false, isEnabled: true, progress: 0, selfResearched: false, cost: 100, isRushing: false,
        parentNodes: [], parentIsRequired: [], sortTag: 0, ...extra,
    } as unknown as TechNode;
}

describe('research screen (task 15b)', () => {
    let rs: ResearchSystem;
    let a: TechNode, b: TechNode, c: TechNode, d: TechNode;

    beforeEach(() => {
        rs = new ResearchSystem(null);
        a = node(1, 0, 0, 0, { isResearched: true });
        b = node(2, 0, 1, 0);
        b.parentNodes = [a];
        b.parentIsRequired = [true];
        c = node(3, 0, 2, 0);
        c.parentNodes = [b];
        c.parentIsRequired = [true];
        d = node(4, 0, 1, 1, { isEnabled: false });
        rs.techTree = [a, b, c, d];
    });

    it('researchIndustryLabel', () => {
        expect(researchIndustryLabel(IndustryType.Weapon)).toBe('Weapons');
        expect(researchIndustryLabel(IndustryType.Energy)).toBe('Energy & Construction');
        expect(researchIndustryLabel(IndustryType.HighTech)).toBe('HighTech & Industrial');
        expect(researchIndustryLabel(IndustryType.Undefined)).toBe('');
    });

    it('formatPercent0', () => {
        expect(formatPercent0(0.425)).toBe('43%');
        expect(formatPercent0(1)).toBe('100%');
        expect(formatPercent0(NaN)).toBe('0%');
    });

    it('currentProjectText', () => {
        expect(currentProjectText(rs, IndustryType.Weapon)).toBe('(No project)');
        a.progress = 25;
        a.cost = 100;
        rs.researchQueueWeapons.push(a);
        expect(currentProjectText(rs, IndustryType.Weapon)).toBe('(P1  25%)');
    });

    it('researchNodeStatus', () => {
        expect(researchNodeStatus(rs, a, null)).toBe('completed');
        expect(researchNodeStatus(rs, b, null)).toBe('available');
        expect(researchNodeStatus(rs, c, null)).toBe('locked');
        expect(researchNodeStatus(rs, d, null)).toBe('disabled');
        expect(queueResearchProject(rs, b, null)).toBe(true);
        expect(researchNodeStatus(rs, b, null)).toBe('researching');
        expect(researchNodeStatus(rs, c, null)).toBe('available');
        expect(queueResearchProject(rs, c, null)).toBe(true);
        expect(researchNodeStatus(rs, c, null)).toBe('queued');
    });

    it('queueResearchProject', () => {
        expect(queueResearchProject(rs, a, null)).toBe(false);
        expect(queueResearchProject(rs, b, null)).toBe(true);
        expect(queueResearchProject(rs, b, null)).toBe(false);
        expect(queueResearchProject(rs, d, null)).toBe(false);
        expect(rs.researchQueueWeapons).toEqual([b]);
    });

    it('dequeueResearchProject', () => {
        rs.researchQueueWeapons.push(b, c);
        b.isRushing = true;
        expect(dequeueResearchProject(rs, b)).toBe(false);
        expect(rs.researchQueueWeapons).toEqual([b, c]);
        b.isRushing = false;
        expect(dequeueResearchProject(rs, d)).toBe(false);
        expect(dequeueResearchProject(rs, b)).toBe(true);
        expect(rs.researchQueueWeapons).toEqual([]);
    });

    it('researchQueueRows', () => {
        b.progress = 50;
        rs.researchQueueWeapons.push(b, c);
        const rows = researchQueueRows(rs, IndustryType.Weapon);
        expect(rows.map((r) => r.label)).toEqual(['P2 (1)', 'P3 (2)']);
        expect(rows.map((r) => r.percent)).toEqual([0.5, 0]);
        const z = node(9, 1, 0, 0, { cost: 0, progress: 5 });
        rs.researchQueueEnergy.push(z);
        expect(researchQueueRows(rs, IndustryType.Energy)[0].percent).toBe(0);
    });

    it('researchCounts', () => {
        let r = researchCounts(rs);
        expect(r.completed).toBe(1);
        expect(r.total).toBe(4);
        expect(r.byIndustry.get(IndustryType.Weapon)).toEqual({ completed: 1, total: 4 });
        rs.techTree.push(node(5, 1, 0, 0));
        r = researchCounts(rs);
        expect(r.total).toBe(5);
        expect(r.byIndustry.get(IndustryType.Energy)).toEqual({ completed: 0, total: 1 });
    });

    it('researchTreeColumns', () => {
        rs.techTree = [node(11, 0, 2, 3), node(12, 0, 1, 5), node(13, 0, 1, 1)];
        const cols = researchTreeColumns(rs, IndustryType.Weapon, null);
        expect(cols.map((col) => col.techLevel)).toEqual([1, 2]);
        expect(cols[0].nodes.map((n) => n.node.def.row)).toEqual([1, 5]);
    });

    it('crashResearchOffer', () => {
        b.progress = 20;
        rs.researchQueueWeapons.push(b, c);
        const empire = { stateMoney: 100, research: rs } as unknown as Empire;
        const offer = crashResearchOffer(empire, b);
        expect(offer).not.toBeNull();
        expect(offer!.cost).toBe(20);
        expect(offer!.affordable).toBe(true);
        empire.stateMoney = 10;
        expect(crashResearchOffer(empire, b)!.affordable).toBe(false);
        expect(crashResearchOffer(empire, c)).toBeNull();
        b.isRushing = true;
        expect(crashResearchOffer(empire, b)).toBeNull();
    });

    it('crashQuestion', () => {
        const q = crashQuestion('Ion Cannon', 1234);
        expect(q).toContain('Ion Cannon');
        expect(q).toContain(formatMoney(1234));
    });

    it('F7 research screen is implemented', () => {
        expect(isKeyActionAvailable('researchScreen')).toBe(true);
    });
});
