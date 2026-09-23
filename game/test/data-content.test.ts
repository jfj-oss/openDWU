import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';

describe('data-content.test.ts', () => {
    let gameData: Awaited<ReturnType<typeof loadGameDataFs>>;

    // Load data once for all tests
    beforeAll(async () => {
        gameData = await loadGameDataFs();
    });

    describe('resources.ts', () => {
        it('parses resources with expected counts', () => {
            const { resources } = gameData;
            console.log(`✓ Resources: ${resources.length}`);
            expect(resources.length).toBeGreaterThan(0);
            expect(resources.length).toBeLessThan(80); // max 80 per comment
            // Roughly 41 expected
            expect(resources.length).toBeGreaterThan(35);
        });

        it('resources have no NaN values in numeric fields', () => {
            const { resources } = gameData;
            for (const res of resources) {
                expect(Number.isNaN(res.resourceId)).toBe(false);
                expect(Number.isNaN(res.pictureRef)).toBe(false);
                expect(Number.isNaN(res.basePrice)).toBe(false);
                expect(Number.isNaN(res.type)).toBe(false);
                expect(Number.isNaN(res.superLuxuryBonusAmount)).toBe(false);
                expect(Number.isNaN(res.colonyGrowthResourceLevel)).toBe(false);
                expect(Number.isNaN(res.colonyManufacturingLevel)).toBe(false);
            }
        });
    });

    describe('components.ts', () => {
        it('parses components with expected counts', () => {
            const { components } = gameData;
            console.log(`✓ Components: ${components.length}`);
            expect(components.length).toBeGreaterThan(0);
            expect(components.length).toBeLessThan(500); // max 500 per comment
            // Roughly 129 expected
            expect(components.length).toBeGreaterThan(100);
        });

        it('components have no NaN values in numeric fields', () => {
            const { components } = gameData;
            for (const comp of components) {
                expect(Number.isNaN(comp.componentId)).toBe(false);
                expect(Number.isNaN(comp.pictureRef)).toBe(false);
                expect(Number.isNaN(comp.type)).toBe(false);
                expect(Number.isNaN(comp.value1)).toBe(false);
                expect(Number.isNaN(comp.value2)).toBe(false);
                expect(Number.isNaN(comp.value3)).toBe(false);
                expect(Number.isNaN(comp.value4)).toBe(false);
                expect(Number.isNaN(comp.value5)).toBe(false);
                expect(Number.isNaN(comp.value6)).toBe(false);
                expect(Number.isNaN(comp.value7)).toBe(false);
            }
        });

        it('component resource requirements reference existing resources', () => {
            const { components, resources } = gameData;
            const resourceIds = new Set(resources.map((r) => r.resourceId));

            for (const comp of components) {
                for (const req of comp.resourceRequirements) {
                    if (!resourceIds.has(req.resourceId)) {
                        console.log(`Component ${comp.componentId} (${comp.name}) references non-existent resource ${req.resourceId}`);
                    }
                    expect(resourceIds.has(req.resourceId)).toBe(true);
                }
            }
        });
    });

    describe('fighters.ts', () => {
        it('parses fighters with expected counts', () => {
            const { fighters } = gameData;
            console.log(`✓ Fighters: ${fighters.length}`);
            expect(fighters.length).toBeGreaterThan(0);
            expect(fighters.length).toBeLessThan(30); // max 30 per comment
            // Roughly 14 expected (mix of interceptors and bombers)
            expect(fighters.length).toBeGreaterThan(10);
        });

        it('fighters have no NaN values in numeric fields', () => {
            const { fighters } = gameData;
            for (const f of fighters) {
                expect(Number.isNaN(f.fighterId)).toBe(false);
                expect(Number.isNaN(f.type)).toBe(false);
                expect(Number.isNaN(f.energyCapacity)).toBe(false);
                expect(Number.isNaN(f.weaponDamage)).toBe(false);
            }
        });
    });

    describe('facilities.txt', () => {
        it('parses facilities with expected counts', () => {
            const { facilities } = gameData;
            console.log(`✓ Facilities: ${facilities.length}`);
            expect(facilities.length).toBeGreaterThan(0);
            expect(facilities.length).toBeLessThan(50); // max 50 per comment
            // Roughly 33 expected
            expect(facilities.length).toBeGreaterThan(30);
        });

        it('facilities have no NaN values in numeric fields', () => {
            const { facilities } = gameData;
            for (const fac of facilities) {
                expect(Number.isNaN(fac.facilityId)).toBe(false);
                expect(Number.isNaN(fac.type)).toBe(false);
                expect(Number.isNaN(fac.buildCost)).toBe(false);
                expect(Number.isNaN(fac.maintenanceCost)).toBe(false);
            }
        });
    });

    describe('plagues.txt', () => {
        it('parses plagues with expected counts', () => {
            const { plagues } = gameData;
            console.log(`✓ Plagues: ${plagues.length}`);
            expect(plagues.length).toBeGreaterThan(0);
            expect(plagues.length).toBeLessThan(50); // max 50 per comment
            // Roughly 4 expected
            expect(plagues.length).toBeGreaterThanOrEqual(4);
        });

        it('plagues have no NaN values in numeric fields', () => {
            const { plagues } = gameData;
            for (const p of plagues) {
                expect(Number.isNaN(p.plagueId)).toBe(false);
                expect(Number.isNaN(p.pictureRef)).toBe(false);
                expect(Number.isNaN(p.mortalityRate)).toBe(false);
                expect(Number.isNaN(p.infectionChance)).toBe(false);
                expect(Number.isNaN(p.duration)).toBe(false);
            }
        });
    });

    describe('research.txt', () => {
        it('parses research nodes with expected counts', () => {
            const { research } = gameData;
            console.log(`✓ Research nodes: ${research.length}`);
            expect(research.length).toBeGreaterThan(0);
            // Roughly 300+ expected
            expect(research.length).toBeGreaterThan(250);
        });

        it('research nodes have no NaN values in numeric fields', () => {
            const { research } = gameData;
            for (const node of research) {
                expect(Number.isNaN(node.projectId)).toBe(false);
                expect(Number.isNaN(node.techLevel)).toBe(false);
                expect(Number.isNaN(node.row)).toBe(false);
                expect(Number.isNaN(node.industry)).toBe(false);
                expect(Number.isNaN(node.category)).toBe(false);
            }
        });

        it('every research node parent/child reference resolves', () => {
            const { research } = gameData;
            const nodeIds = new Set(research.map((n) => n.projectId));

            for (const node of research) {
                for (const parent of node.parents) {
                    expect(nodeIds.has(parent.parentProjectId)).toBe(true);
                }
            }
        });
    });
});
