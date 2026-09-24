import { describe, expect, it } from 'vitest';
import { parseResearch } from '../src/sim/data/research';

describe('research.ts parseResearch', () => {
    it('keeps a FACILITY id of 0 instead of dropping it to null', () => {
        // Port of ResearchNodeDefinitionList.cs LoadFromFile: FACILITY ;0 is a
        // valid facility index (id 0), distinct from "no facility" (null).
        const text = [
            "PROJECT ;0, Test Project, 1, 1, 0, 19, 0, 0.0,",
            'FACILITY ;0',
        ].join('\n');
        const [node] = parseResearch(text);
        expect(node.facilityId).toBe(0);
    });

    it('leaves facilityId null when no FACILITY line is present', () => {
        const text = "PROJECT ;1, No Facility Project, 1, 1, 0, 19, 0, 0.0,";
        const [node] = parseResearch(text);
        expect(node.facilityId).toBeNull();
    });

    it('keeps a nonzero facility id (regression check) and the last project in the file', () => {
        const text = [
            "PROJECT ;0, First, 1, 1, 0, 19, 0, 0.0,",
            'FACILITY ;7',
            "PROJECT ;1, Second, 1, 1, 0, 19, 0, 0.0,",
            'FACILITY ;0',
        ].join('\n');
        const nodes = parseResearch(text);
        expect(nodes).toHaveLength(2);
        expect(nodes[0].facilityId).toBe(7);
        expect(nodes[1].facilityId).toBe(0);
    });
});
