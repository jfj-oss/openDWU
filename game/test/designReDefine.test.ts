import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Design } from '../src/sim/design';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { ComponentType } from '../src/sim/data/components';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { designStatRows } from '../src/ui/screens/shipDesigns';

// Design.ReDefine (Design.cs 1240-1983) + BaconDesign.Redefine (BaconDesign.cs 138) and
// Empire.ReviewDesignsBuiltObjectsImprovedComponents (Empire.3.cs 2043), checked against values
// hand-worked from components.txt through the C# formulas, on the standard tick game (seed 1, tech 0.5).
let galaxy: Galaxy;
beforeAll(async () => {
    const gameData = await loadGameDataFs();
    galaxy = createGame(tickGameOptions(gameData)).galaxy;
}, 300000);

function allEmpires(g: Galaxy): Empire[] {
    const list = [...g.empires, ...g.pirateEmpires];
    if (g.independentEmpire !== null && !list.includes(g.independentEmpire)) list.push(g.independentEmpire);
    return list;
}

// Component categories/types whose Value1 Design.ReDefine adds to num5 → FirepowerRaw (Design.cs 1440-1531, 1742-1830).
function countsTowardFirepower(design: Design, i: number): boolean {
    const c = design.components[i];
    const C = ComponentCategoryType;
    switch (c.category) {
        case C.WeaponArea: case C.WeaponSuperArea: case C.WeaponBeam: case C.WeaponSuperBeam: case C.WeaponTorpedo: case C.WeaponSuperTorpedo:
            return true;
    }
    switch (c.type) {
        case ComponentType.WeaponGravityBeam: case ComponentType.WeaponAreaGravity: case ComponentType.WeaponIonPulse: case ComponentType.WeaponIonCannon:
            return true;
    }
    return false;
}

describe('Design.ReDefine hand-worked values (seed 1 tick game)', () => {
    it("player Escort 'Javelin'", () => {
        // Components (improved values at the player's starting tech):
        //  2x Maxos Blaster (beam, size 5, V1 5 V2 190)      3x Standard Armor (size 1, V1 10 V2 2)
        //  1x Corvidian Shields (size 10, V1 100 V2 3)       6x Proton Thruster (size 7, V1 1000 V2 5 V3 560 V4 2)
        //  1x Thrust Vector (size 2, V1 6)                   1x Gerax HyperDrive (size 11, V1 12500 V2 78 V3 15)
        //  2x Fission Reactor (size 22, V1 60 V2 105 V3 400) 1x Energy Collector (size 8, V1 24)
        //  2x Standard Fuel Cell (size 6, V1 65)             1x Command Center (size 2, energy 2)
        //  2x Life Support (size 1, energy 1, improved V1 85) 3x Hab Module (size 2, energy 1, V1 60)
        const d = galaxy.empires[0].designs.find((x) => x.name === 'Javelin')!;
        expect(d.subRole).toBe(BuiltObjectSubRole.Escort);
        expect(d.size).toBe(2 * 5 + 3 + 10 + 6 * 7 + 2 + 11 + 2 * 22 + 8 + 2 * 6 + 2 + 2 + 3 * 2); // 152
        expect(d.staticEnergyConsumption).toBe(2 + 2 * 1 + 3 * 1); // 7
        expect(d.reactorPowerOutput).toBe(120);
        expect(d.reactorStorageCapacity).toBe(210);
        expect(d.reactorCycleFuelConsumption).toBe(800);
        expect(d.firepowerRaw).toBe(2 * 5); // num5 += Value1 per beam
        expect(d.weapons.length).toBe(2);
        expect(d.maximumWeaponsRange).toBe(190);
        expect(d.minimumWeaponsRange).toBe(190);
        // num32 = 120 - 7 = 113; num34 = 30/113, num35 = 12/113, num33 = 78/113 are all <= 1 → no speed scaling.
        expect(d.topSpeed).toBe(Math.trunc(6000 / 152)); // 39
        expect(d.cruiseSpeed).toBe(Math.trunc(3360 / 152)); // 22
        expect(d.topSpeedFuelBurn).toBe(30);
        expect(d.cruiseSpeedFuelBurn).toBe(12);
        expect(d.impulseSpeedFuelBurn).toBe(3);
        expect(d.warpSpeed).toBe(12500);
        expect(d.warpSpeedFuelBurn).toBe(78);
        expect(d.hyperjumpInitiate).toBe(15);
        expect(d.shieldsCapacity).toBe(100);
        expect(d.shieldRechargeRate).toBeCloseTo(0.3, 12);
        expect(d.armor).toBe(30);
        expect(d.armorReactive).toBe(2);
        expect(d.fuelCapacity).toBe(130);
        expect(d.population).toBe(Math.min(3 * 60, 2 * 85)); // 170
        expect(d.energyCollection).toBe(24);
        expect(d.isEnergyCollector).toBe(true); // command center + life support + hab module + energy collector
        expect(d.isRefuellingDepot).toBe(false);
        expect(d.turnRate).toBe(0.1 + (6 * 2.0) / 152);
        expect(d.accelerationRate).toBe((39 / 8.0 + 0.5) * Math.min(Math.sqrt(Math.sqrt(113 / 30)), 2.0));
        // The Ship Designs screen shows FirepowerRaw (Main.Part9.cs 5081).
        expect(designStatRows(d).find((r) => r.label === 'Firepower')?.value).toBe('10');
    });

    it("pirate TroopTransport 'Royale'", () => {
        //  2x Maxos Blaster, 25x Standard Armor, 5x Corvidian Shields, 8x Proton Thruster, 1x Thrust Vector,
        //  1x Gerax HyperDrive, 2x Fission Reactor, 1x Energy Collector, 3x Standard Fuel Cell,
        //  3x Standard Troop Compartment (size 8, V1 100), 1x Command Center, 4x Life Support (V1 85),
        //  5x Hab Module, 1x Medical Center (size 4, energy 3, V1 100), 4x Assault Pod (size 8, V1 50 V2 140 V5 20).
        const owner = galaxy.pirateEmpires.find((e) => e.designs.some((x) => x.name === 'Royale'))!;
        const d = owner.designs.find((x) => x.name === 'Royale')!;
        expect(d.subRole).toBe(BuiltObjectSubRole.TroopTransport);
        expect(d.size).toBe(2 * 5 + 25 + 5 * 10 + 8 * 7 + 2 + 11 + 2 * 22 + 8 + 3 * 6 + 3 * 8 + 2 + 4 + 5 * 2 + 4 + 4 * 8); // 300
        expect(d.staticEnergyConsumption).toBe(2 + 4 + 5 + 3); // 14
        // Assault pods are weapons but not firepower (Design.cs 1325-1356 adds them to Weapons only).
        expect(d.firepowerRaw).toBe(10);
        expect(d.weapons.length).toBe(6);
        expect(d.assaultStrength).toBe(200);
        expect(d.assaultRange).toBe(140);
        expect(d.assaultShieldPenetration).toBe(20);
        expect(d.topSpeed).toBe(Math.trunc(8000 / 300)); // 26
        expect(d.cruiseSpeed).toBe(Math.trunc(4480 / 300)); // 14
        expect(d.warpSpeed).toBe(12500);
        expect(d.shieldsCapacity).toBe(500);
        expect(d.shieldRechargeRate).toBeCloseTo(1.5, 12);
        expect(d.armor).toBe(250);
        expect(d.fuelCapacity).toBe(195);
        expect(d.troopCapacity).toBe(300);
        expect(d.medicalCapacity).toBe(100);
        expect(d.population).toBe(Math.min(5 * 60, 4 * 85)); // 300
        expect(d.turnRate).toBe(0.1 + (6 * 2.0) / 300);
        // num37 = (120 - 14) / 40 = 2.65 → 2.65^(1/4).
        expect(d.accelerationRate).toBe((26 / 8.0 + 0.5) * Math.sqrt(Math.sqrt(106 / 40)));
    });
});

describe('Design / BuiltObject values carried from game start', () => {
    it('no design carrying a damage-dealing weapon has FirepowerRaw 0; Weapons matches the weapon components', () => {
        let checked = 0;
        for (const empire of allEmpires(galaxy)) {
            for (const d of empire.designs) {
                let expected = 0;
                let weaponComponents = 0;
                for (let i = 0; i < d.components.length; i++) {
                    const c = d.components[i];
                    const ci = empire.research.resolveImprovedComponentValues(c);
                    if (countsTowardFirepower(d, i) && ci.value1 > 0) expected += ci.value1;
                    const cat = c.category;
                    const C = ComponentCategoryType;
                    if (cat === C.WeaponBeam || cat === C.WeaponTorpedo || cat === C.WeaponArea || cat === C.WeaponPointDefense || cat === C.WeaponSuperBeam || cat === C.WeaponSuperArea || cat === C.WeaponSuperTorpedo || (cat === C.AssaultPod && c.type === ComponentType.AssaultPod) || c.type === ComponentType.WeaponTractorBeam || c.type === ComponentType.WeaponGravityBeam || c.type === ComponentType.WeaponAreaGravity || c.type === ComponentType.WeaponIonPulse || c.type === ComponentType.WeaponIonCannon) weaponComponents++;
                }
                expect(d.firepowerRaw, `${empire.name} ${d.name}`).toBe(expected);
                expect(d.weapons.length, `${empire.name} ${d.name}`).toBe(weaponComponents);
                if (expected > 0) checked++;
            }
        }
        expect(checked).toBeGreaterThan(20);
    });

    it('intact built objects carry their design firepower / speeds from game start', () => {
        let checked = 0;
        for (const empire of allEmpires(galaxy)) {
            for (const bo of [...empire.builtObjects, ...empire.privateBuiltObjects]) {
                if (bo.design === null || bo.unbuiltOrDamagedComponentCount !== 0) continue;
                expect(bo.firepowerRaw, bo.name).toBe(bo.design.firepowerRaw);
                expect(bo.topSpeed, bo.name).toBe(bo.design.topSpeed);
                expect(bo.warpSpeed, bo.name).toBe(bo.design.warpSpeed);
                if (bo.firepowerRaw > 0) checked++;
            }
        }
        expect(checked).toBeGreaterThan(0);
    });

    it('Empire.ReviewDesignsBuiltObjectsImprovedComponents re-derives designs and ships, drawing no Rnd', () => {
        const empire = galaxy.empires[0];
        const before = empire.designs.map((d) => [d.firepowerRaw, d.topSpeed, d.warpSpeed, d.shieldsCapacity, d.weapons.length]);
        const ships = [...empire.builtObjects, ...empire.privateBuiltObjects];
        const shipsBefore = ships.map((b) => [b.firepowerRaw, b.topSpeed, b.warpSpeed]);
        for (const d of empire.designs) { d.firepowerRaw = 0; d.topSpeed = 0; d.warpSpeed = 0; d.shieldsCapacity = 0; d.weapons.length = 0; }
        for (const b of ships) { b.firepowerRaw = 0; b.topSpeed = 0; b.warpSpeed = 0; }
        const next = vi.spyOn(galaxy.rnd, 'next');
        const nextDouble = vi.spyOn(galaxy.rnd, 'nextDouble');
        empire.reviewDesignsBuiltObjectsImprovedComponents();
        expect(next).not.toHaveBeenCalled();
        expect(nextDouble).not.toHaveBeenCalled();
        next.mockRestore();
        nextDouble.mockRestore();
        expect(empire.designs.map((d) => [d.firepowerRaw, d.topSpeed, d.warpSpeed, d.shieldsCapacity, d.weapons.length])).toEqual(before);
        expect(ships.map((b) => [b.firepowerRaw, b.topSpeed, b.warpSpeed])).toEqual(shipsBefore);
    });
});
