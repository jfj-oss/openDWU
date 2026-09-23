import { beforeAll, describe, expect, it } from 'vitest';
import { ComponentType } from '../src/sim/data/components';
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

    // Exact-value tests: every field of the first two records of each file,
    // asserted against the raw data lines (see tasks/04c-fix-loader-alignment.md).
    describe('exact values — first two records', () => {
        describe('components.txt', () => {
            // Raw line: 0, Maxos Blaster, 0, 0, laser.wav, 48, 5, 0, 5, 190, 12, 360, 1, 1240, 0, 1, 2, 4, 4, 14, 3,
            it('first component (Maxos Blaster) matches raw line', () => {
                const c = gameData.components[0];
                expect(c.componentId).toBe(0);
                expect(c.name).toBe('Maxos Blaster');
                expect(c.pictureRef).toBe(0);
                expect(c.specialImageIndex).toBe(0);
                expect(c.soundEffectFilename).toBe('laser.wav');
                // type code 48 -> WeaponBeam
                expect(c.type).toBe(ComponentType.WeaponBeam);
                expect(c.size).toBe(5);
                expect(c.energyUsed).toBe(0);
                expect(c.value1).toBe(5);
                expect(c.value2).toBe(190);
                expect(c.value3).toBe(12);
                expect(c.value4).toBe(360);
                expect(c.value5).toBe(1);
                expect(c.value6).toBe(1240);
                expect(c.value7).toBe(0);
                expect(c.resourceRequirements).toEqual([
                    { resourceId: 1, amount: 2 },
                    { resourceId: 4, amount: 4 },
                    { resourceId: 14, amount: 3 },
                ]);
            });

            // Raw line: 1, Shatterforce Laser, 1, 1, laser2.wav, 48, 4, 0, 7, 320, 20, 310, 1, 1500, 0, 0, 3, 6, 5, 15, 5,
            it('second component (Shatterforce Laser) matches raw line', () => {
                const c = gameData.components[1];
                expect(c.componentId).toBe(1);
                expect(c.name).toBe('Shatterforce Laser');
                expect(c.pictureRef).toBe(1);
                expect(c.specialImageIndex).toBe(1);
                expect(c.soundEffectFilename).toBe('laser2.wav');
                expect(c.type).toBe(ComponentType.WeaponBeam);
                expect(c.size).toBe(4);
                expect(c.energyUsed).toBe(0);
                expect(c.value1).toBe(7);
                expect(c.value2).toBe(320);
                expect(c.value3).toBe(20);
                expect(c.value4).toBe(310);
                expect(c.value5).toBe(1);
                expect(c.value6).toBe(1500);
                expect(c.value7).toBe(0);
                expect(c.resourceRequirements).toEqual([
                    { resourceId: 0, amount: 3 },
                    { resourceId: 6, amount: 5 },
                    { resourceId: 15, amount: 5 },
                ]);
            });
        });

        describe('fighters.txt', () => {
            // Raw line: 0, Standard Fighter, 0, 100000, 30, 8, 105, 10, 36, 0.8, 0, 10, 0.5, 0, 80, 40, 0, 0, 3, 160, 4, 370, 1, 700, laser.wav
            it('first fighter (Standard Fighter) matches raw line', () => {
                const f = gameData.fighters[0];
                expect(f.fighterId).toBe(0);
                expect(f.name).toBe('Standard Fighter');
                expect(f.type).toBe(0);
                expect(f.techLevel).toBe(100000);
                expect(f.energyCapacity).toBe(30);
                expect(f.energyRechargeRate).toBe(8);
                expect(f.topSpeed).toBe(105);
                expect(f.topSpeedEnergyConsumptionRate).toBe(10);
                expect(f.accelerationRate).toBe(36);
                expect(f.turnRate).toBe(0.8);
                expect(f.engineExhaustImageIndex).toBe(0);
                expect(f.shieldsCapacity).toBe(10);
                expect(f.shieldRechargeRate).toBe(0.5);
                expect(f.damageRepairRate).toBe(0);
                expect(f.countermeasureModifier).toBe(80);
                expect(f.targetingModifier).toBe(40);
                expect(f.weaponType).toBe(0);
                expect(f.weaponImageIndex).toBe(0);
                expect(f.weaponDamage).toBe(3);
                expect(f.weaponRange).toBe(160);
                expect(f.weaponEnergyRequired).toBe(4);
                expect(f.weaponSpeed).toBe(370);
                expect(f.weaponDamageLoss).toBe(1);
                expect(f.weaponFireRate).toBe(700);
                expect(f.weaponSoundEffectFilename).toBe('laser.wav');
            });

            // Raw line: 1, Light Interceptor, 0, 200000, 35, 9, 120, 10, 42, 0.87, 1, 15, 0.6, 0, 83, 45, 0, 0, 4, 180, 4, 410, 1, 700, laser.wav
            it('second fighter (Light Interceptor) matches raw line', () => {
                const f = gameData.fighters[1];
                expect(f.fighterId).toBe(1);
                expect(f.name).toBe('Light Interceptor');
                expect(f.type).toBe(0);
                expect(f.techLevel).toBe(200000);
                expect(f.energyCapacity).toBe(35);
                expect(f.energyRechargeRate).toBe(9);
                expect(f.topSpeed).toBe(120);
                expect(f.topSpeedEnergyConsumptionRate).toBe(10);
                expect(f.accelerationRate).toBe(42);
                expect(f.turnRate).toBe(0.87);
                expect(f.engineExhaustImageIndex).toBe(1);
                expect(f.shieldsCapacity).toBe(15);
                expect(f.shieldRechargeRate).toBe(0.6);
                expect(f.damageRepairRate).toBe(0);
                expect(f.countermeasureModifier).toBe(83);
                expect(f.targetingModifier).toBe(45);
                expect(f.weaponType).toBe(0);
                expect(f.weaponImageIndex).toBe(0);
                expect(f.weaponDamage).toBe(4);
                expect(f.weaponRange).toBe(180);
                expect(f.weaponEnergyRequired).toBe(4);
                expect(f.weaponSpeed).toBe(410);
                expect(f.weaponDamageLoss).toBe(1);
                expect(f.weaponFireRate).toBe(700);
                expect(f.weaponSoundEffectFilename).toBe('laser.wav');
            });
        });

        describe('resources.txt', () => {
            // Raw line: 0, Emeros Crystal, 0, 5.0, 0, 0, N, N, 0, 0, 0, 0, 0.102, 0.2, 0.7, 0, 5, 0.25, 0.3, 1.0,
            it('first resource (Emeros Crystal) matches raw line', () => {
                const r = gameData.resources[0];
                expect(r.resourceId).toBe(0);
                expect(r.name).toBe('Emeros Crystal');
                expect(r.pictureRef).toBe(0);
                expect(r.basePrice).toBe(5.0);
                expect(r.type).toBe(0);
                expect(r.superLuxuryBonusAmount).toBe(0);
                expect(r.isFuel).toBe(false);
                expect(r.isImportantPreWarpResource).toBe(false);
                expect(r.colonyGrowthResourceLevel).toBe(0);
                expect(r.colonyManufacturingLevel).toBe(0);
                expect(r.distributions).toEqual([
                    { type: 0, subType: 0, prevalence: 0.102, abundanceMin: 0.2, abundanceMax: 0.7 },
                    { type: 0, subType: 5, prevalence: 0.25, abundanceMin: 0.3, abundanceMax: 1.0 },
                ]);
            });

            // Raw line: 1, Nekros Stone, 1, 5.0, 0, 0, N, Y, 0, 0, 0, 0, 0.136, 0.2, 0.7, 0, 5, 0.408, 0.3, 1.0,
            it('second resource (Nekros Stone) matches raw line', () => {
                const r = gameData.resources[1];
                expect(r.resourceId).toBe(1);
                expect(r.name).toBe('Nekros Stone');
                expect(r.pictureRef).toBe(1);
                expect(r.basePrice).toBe(5.0);
                expect(r.type).toBe(0);
                expect(r.superLuxuryBonusAmount).toBe(0);
                expect(r.isFuel).toBe(false);
                expect(r.isImportantPreWarpResource).toBe(true);
                expect(r.colonyGrowthResourceLevel).toBe(0);
                expect(r.colonyManufacturingLevel).toBe(0);
                expect(r.distributions).toEqual([
                    { type: 0, subType: 0, prevalence: 0.136, abundanceMin: 0.2, abundanceMax: 0.7 },
                    { type: 0, subType: 5, prevalence: 0.408, abundanceMin: 0.3, abundanceMax: 1.0 },
                ]);
            });
        });

        describe('facilities.txt', () => {
            // Raw line: 0, Troop Academy, 0, 0, 0, 10000.0, 2000.0, 0, 0, 0, Allows the training of elite troops at a colony, giving them 50% greater strength than normal
            it('first facility (Troop Academy) matches raw line', () => {
                const f = gameData.facilities[0];
                expect(f.facilityId).toBe(0);
                expect(f.name).toBe('Troop Academy');
                expect(f.type).toBe(0);
                expect(f.wonderType).toBe(0);
                expect(f.pictureRef).toBe(0);
                expect(f.buildCost).toBe(10000.0);
                expect(f.maintenanceCost).toBe(2000.0);
                expect(f.value1).toBe(0);
                expect(f.value2).toBe(0);
                expect(f.value3).toBe(0);
                expect(f.description).toBe(
                    'Allows the training of elite troops at a colony, giving them 50% greater strength than normal'
                );
            });

            // Raw line: 1, Robotic Troop Foundry, 1, 0, 1, 15000.0, 2000.0, 0, 0, 0, Manufactures robotic troops at a colony. Robotic troops are not especially strong, but can be manufactured quickly, and have one quarter the normal maintenance costs
            it('second facility (Robotic Troop Foundry) matches raw line', () => {
                const f = gameData.facilities[1];
                expect(f.facilityId).toBe(1);
                expect(f.name).toBe('Robotic Troop Foundry');
                expect(f.type).toBe(1);
                expect(f.wonderType).toBe(0);
                expect(f.pictureRef).toBe(1);
                expect(f.buildCost).toBe(15000.0);
                expect(f.maintenanceCost).toBe(2000.0);
                expect(f.value1).toBe(0);
                expect(f.value2).toBe(0);
                expect(f.value3).toBe(0);
                expect(f.description).toBe(
                    'Manufactures robotic troops at a colony. Robotic troops are not especially strong, but can be manufactured quickly, and have one quarter the normal maintenance costs'
                );
            });
        });

        describe('plagues.txt', () => {
            // Raw line: 0, Hekretos Fever, 0, 0.06, 30, 150, 3, N, , 0, 0, 0, 0, Hekretos Fever is a deadly infection...
            it('first plague (Hekretos Fever) matches raw line', () => {
                const p = gameData.plagues[0];
                expect(p.plagueId).toBe(0);
                expect(p.name).toBe('Hekretos Fever');
                expect(p.pictureRef).toBe(0);
                expect(p.mortalityRate).toBe(0.06);
                expect(p.infectionChance).toBe(30);
                expect(p.duration).toBe(150);
                expect(p.naturalOccurrenceLevel).toBe(3);
                expect(p.canCompletelyEliminatePopulation).toBe(false);
                expect(p.exceptionRaceName).toBe('');
                expect(p.exceptionMortalityRate).toBe(0);
                expect(p.exceptionInfectionChance).toBe(0);
                expect(p.exceptionDuration).toBe(0);
                expect(p.specialFunctionCode).toBe(0);
                expect(p.description).toBe(
                    'Hekretos Fever is a deadly infection that attacks the internal organs, causing rapid degeneration and death. An outbreak of Hekretos Fever typically lasts about 3 months.'
                );
            });

            // Raw line: 1, Dekara Virus, 1, 0.09, 10, 300, 3, N, , 0, 0, 0, 0, Dekara Virus is a very painful disease...
            it('second plague (Dekara Virus) matches raw line', () => {
                const p = gameData.plagues[1];
                expect(p.plagueId).toBe(1);
                expect(p.name).toBe('Dekara Virus');
                expect(p.pictureRef).toBe(1);
                expect(p.mortalityRate).toBe(0.09);
                expect(p.infectionChance).toBe(10);
                expect(p.duration).toBe(300);
                expect(p.naturalOccurrenceLevel).toBe(3);
                expect(p.canCompletelyEliminatePopulation).toBe(false);
                expect(p.exceptionRaceName).toBe('');
                expect(p.exceptionMortalityRate).toBe(0);
                expect(p.exceptionInfectionChance).toBe(0);
                expect(p.exceptionDuration).toBe(0);
                expect(p.specialFunctionCode).toBe(0);
                expect(p.description).toBe(
                    'Dekara Virus is a very painful disease that slowly cripples the central nervous system of any creature it infects, ultimately leading to death. An outbreak of Dekara Virus typically lasts about 6 months.'
                );
            });
        });

        describe('research.txt', () => {
            // Raw lines:
            //   PROJECT ;0, Wave Weapons, 2, 1, 0, 19, 0, 0.0,   +   COMPONENTS ;4   +   PARENTS ;6, N
            it('first research node (Wave Weapons) matches raw lines', () => {
                const n = gameData.research[0];
                expect(n.projectId).toBe(0);
                expect(n.name).toBe('Wave Weapons');
                expect(n.techLevel).toBe(2);
                expect(n.row).toBe(1);
                expect(n.industry).toBe(0);
                expect(n.category).toBe(19);
                expect(n.specialFunctionCode).toBe(0);
                expect(n.baseCostMultiplierOverride).toBe(0);
                expect(n.components).toEqual([4]);
                expect(n.componentImprovements).toEqual([]);
                expect(n.fighters).toEqual([]);
                expect(n.facilityId).toBeNull();
                expect(n.abilities).toEqual([]);
                expect(n.plagueChange).toBeNull();
                expect(n.allowedRaces).toEqual([]);
                expect(n.parents).toEqual([{ parentProjectId: 6, isRequired: false }]);
            });

            // Raw lines:
            //   PROJECT ;1, Enhanced Wave Weapons, 4, 1, 0, 19, 0, 0.0,   +   COMPONENT IMPROVEMENTS ;4, 4, 17, 380, 24, 400, 3, 1400, 0,   +   PARENTS ;0, N
            it('second research node (Enhanced Wave Weapons) matches raw lines', () => {
                const n = gameData.research[1];
                expect(n.projectId).toBe(1);
                expect(n.name).toBe('Enhanced Wave Weapons');
                expect(n.techLevel).toBe(4);
                expect(n.row).toBe(1);
                expect(n.industry).toBe(0);
                expect(n.category).toBe(19);
                expect(n.specialFunctionCode).toBe(0);
                expect(n.baseCostMultiplierOverride).toBe(0);
                expect(n.components).toEqual([]);
                expect(n.componentImprovements).toEqual([
                    { componentId: 4, techLevel: 4, value1: 17, value2: 380, value3: 24, value4: 400, value5: 3, value6: 1400, value7: 0 },
                ]);
                expect(n.fighters).toEqual([]);
                expect(n.facilityId).toBeNull();
                expect(n.abilities).toEqual([]);
                expect(n.plagueChange).toBeNull();
                expect(n.allowedRaces).toEqual([]);
                expect(n.parents).toEqual([{ parentProjectId: 0, isRequired: false }]);
            });
        });
    });
});
