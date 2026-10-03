import { describe, it, expect } from 'vitest';
import { ResearchSystem, type TechNode } from '../src/sim/researchSystem';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { ComponentType } from '../src/sim/data/components';
import { IndustryType } from '../src/sim/types';
import {
    TREE,
    calculateNodeLocation,
    detectNodeAt,
    determineRanges,
    industryTabStyle,
    nodePath,
    nodeVisual,
    pathStyle,
    projectInfoColumns,
    pulseFactor,
    researchWindowSize,
    resolveCategoryColor,
    treeContentSize,
} from '../src/ui/screens/researchTreeModel';
import {
    checkAncestorsForAbility,
    determineMaximumConstructionSizeForYard,
    formatK,
    formatM,
    formatSignedPercent,
    formatSignedPercentHash,
    formatP2,
    formatOneOptionalDecimal,
    resolveComponentDescriptionDetailed,
    resolveResearchAbilityLines,
} from '../src/ui/screens/researchBenefits';
import { totalDiminishingResearchBonus, crashQuestion } from '../src/ui/screens/researchScreen';
import type { ComponentDefinition } from '../src/sim/componentStatic';

function node(id: number, techLevel: number, row: number, extra: Partial<TechNode> = {}, def: Record<string, unknown> = {}): TechNode {
    return {
        def: { projectId: id, name: `P${id}`, techLevel, row, industry: 0, category: 0, specialFunctionCode: 0, components: [], componentImprovements: [], abilities: [], fighters: [], parents: [], allowedRaces: [], facilityId: null, plagueChange: null, ...def },
        isResearched: false, isEnabled: true, progress: 0, selfResearched: false, cost: 100, isRushing: false,
        parentNodes: [], parentIsRequired: [], sortTag: 0, ...extra,
    } as unknown as TechNode;
}

describe('research tree layout (ResearchTree.cs)', () => {
    it('method_389 window sizes', () => {
        expect(researchWindowSize({ w: 2243, h: 1261 })).toEqual({ w: 1880, h: 1180 });
        expect(researchWindowSize({ w: 1300, h: 1050 })).toEqual({ w: 1260, h: 1000 });
        expect(researchWindowSize({ w: 1100, h: 700 })).toEqual({ w: 1020, h: 767 });
    });
    it('node locations, ranges and content size', () => {
        const a = node(1, 1, 1);
        const b = node(2, 3, 4);
        const r = determineRanges([a, b]);
        expect(r).toEqual({ lowestTechLevel: 1, highestTechLevel: 3, lowestRow: 1, highestRow: 4 });
        // Lowest level 1 → column = TechLevel − 1.
        expect(calculateNodeLocation(a, r)).toEqual({ x: 20, y: 20 });
        expect(calculateNodeLocation(b, r)).toEqual({ x: 20 + 2 * 235, y: 20 + 3 * 72 });
        expect(treeContentSize(r)).toEqual({ w: 20 + 3 * 235, h: 40 + 4 * 72 });
        expect(detectNodeAt([a, b], r, 25, 25)).toBe(a);
        expect(detectNodeAt([a, b], r, 20 + 2 * 235 + 10, 20 + 3 * 72 + 10)).toBe(b);
        expect(detectNodeAt([a, b], r, 20 + 180, 25)).toBeNull(); // in the gap
    });
    it('paths: parent right middle to node left, spread for several parents', () => {
        const p1 = node(1, 0, 1);
        const p2 = node(2, 0, 2);
        const c = node(3, 1, 1, { parentNodes: [], parentIsRequired: [true, false] });
        c.parentNodes = [p1, p2];
        const r = determineRanges([p1, p2, c]);
        expect(nodePath(c, 0, r)).toEqual({ x1: 20 + TREE.nodeWidth, y1: 46, x2: 255, y2: 20 + 15 });
        expect(nodePath(c, 1, r).y2).toBe(20 + 15 + 22);
        expect(pathStyle(c, 0, true)).toEqual({ color: 0x500000, dashed: false });
        expect(pathStyle(c, 1, true)).toEqual({ color: 0x383838, dashed: false });
        c.isResearched = true;
        expect(pathStyle(c, 0, true).color).toBe(0xff0000);
        expect(pathStyle(c, 1, true).color).toBe(0xaaaaaa);
        p1.def.category = 3;
        expect(pathStyle(c, 0, true).dashed).toBe(true);
    });
    it('DrawNode states', () => {
        const rs = new ResearchSystem(null);
        const a = node(1, 0, 1, { isResearched: true });
        const b = node(2, 1, 1, { parentIsRequired: [true] });
        b.parentNodes = [a];
        const c = node(3, 2, 1, { parentIsRequired: [true] });
        c.parentNodes = [b];
        rs.techTree = [a, b, c];
        expect(nodeVisual(rs, a, true, false, false)).toMatchObject({ frame: 'glowing', enabled: true, border: 'none' });
        expect(nodeVisual(rs, b, true, false, false)).toMatchObject({ frame: 'dull', fill: 'solid', enabled: false });
        expect(nodeVisual(rs, b, true, true, false).frame).toBe('glowing');
        expect(nodeVisual(rs, c, true, true, false)).toMatchObject({ frame: 'hatched', fill: 'hatch-dark' });
        expect(nodeVisual(rs, b, false, true, false)).toMatchObject({ frame: 'blocked', fill: 'hatch-wide' });
        rs.researchQueueWeapons.push(b, c);
        b.progress = 50;
        expect(nodeVisual(rs, b, true, false, false)).toMatchObject({ frame: 'glowing', border: 'current', borderPx: 5, title: 'P2 (1)', progress: 0.5, enabled: true });
        expect(nodeVisual(rs, c, true, false, false)).toMatchObject({ border: 'queued', borderPx: 3, title: 'P3 (2)' });
    });
    it('category colours, tab colours, pulse', () => {
        expect(resolveCategoryColor(ComponentCategoryType.WeaponBeam, null)).toEqual({ back: 0x501414, outer: 0x200014, shine: 0xc08094, glow: 0xff5080 });
        expect(resolveCategoryColor(ComponentCategoryType.WeaponBeam, { type: ComponentType.WeaponRailGun, value7: 0, name: 'x' }).outer).toBe(0x001820);
        expect(resolveCategoryColor(ComponentCategoryType.Undefined, null).outer).toBe(0x000014);
        expect(industryTabStyle(IndustryType.Energy).glow).toBe(0x6040ff);
        expect(pulseFactor(0)).toBe(1);
        expect(pulseFactor(1000)).toBe(0);
        expect(pulseFactor(1500)).toBe(0.5);
        expect(pulseFactor(2000)).toBe(1);
    });
    it('hover panel columns', () => {
        expect(projectInfoColumns(1)).toEqual({ columnWidth: 280, valueOffset: 135, width: 280 });
        expect(projectInfoColumns(4).columnWidth).toBe(236);
        expect(projectInfoColumns(5)).toEqual({ columnWidth: 210, valueOffset: 85, width: 1050 });
    });
});

describe('research benefits (GenerateBenefitDetail)', () => {
    it('.NET formats', () => {
        expect(formatK(120000)).toBe('120K');
        expect(formatK(1499)).toBe('1K');
        expect(formatM(2500000)).toBe('3M');
        expect(formatSignedPercent(0.15)).toBe('+15%');
        expect(formatSignedPercent(-0.2)).toBe('-20%');
        expect(formatSignedPercent(0)).toBe('+0%');
        expect(formatSignedPercentHash(0.1)).toBe('+10%');
        expect(formatP2(0.5)).toBe('50.00 %');
        expect(formatOneOptionalDecimal(2)).toBe('2');
        expect(formatOneOptionalDecimal(2.25)).toBe('2.3');
    });
    it('component detail lines', () => {
        const beam = { name: 'Maxos Blaster', type: ComponentType.WeaponBeam, value1: 8, value2: 260, value3: 10, value4: 510, value5: 1, value6: 1240, value7: 0 } as unknown as ComponentDefinition;
        const col = resolveComponentDescriptionDetailed(null, beam, beam, null);
        expect(col.descriptions.slice(0, 6)).toEqual(['Damage', 'Range', 'Energy Used', 'Speed', 'Damage Loss', 'Fire Rate']);
        expect(col.values.slice(0, 6)).toEqual(['8', '260', '10', '510', '1 per 100 distance', '1.24 secs']);
        const shields = { ...beam, type: ComponentType.Shields, value1: 50, value2: 25 } as ComponentDefinition;
        expect(resolveComponentDescriptionDetailed(null, shields, shields, null).values.slice(0, 2)).toEqual(['50', '2.5']);
    });
    it('construction size from ancestors (CheckAncestorsForAbility)', () => {
        const root = node(1, 0, 1, {}, { abilities: [{ name: 'Size', type: 2, level: 0, value: 300, relatedObjectIndex: 0 }] });
        const child = node(2, 1, 1);
        child.parentNodes = [root];
        expect(checkAncestorsForAbility(child, 1)?.value).toBe(300);
        expect(determineMaximumConstructionSizeForYard(child)).toBe(300);
        expect(determineMaximumConstructionSizeForYard(node(3, 0, 1))).toBe(160);
    });
    it('ability lines', () => {
        const col = resolveResearchAbilityLines({ name: 'Bigger ships', type: 2, level: 0, value: 400, relatedObjectIndex: 0 });
        expect(col.values.slice(1, 3)).toEqual(['400', '1200']);
    });
    it('station scientist bonus and crash question', () => {
        expect(totalDiminishingResearchBonus([10, 20])).toBeCloseTo((20 + 10 / 2) / 100);
        expect(crashQuestion('Ion Cannon', 23164)).toContain('23,164 credits');
    });
});
