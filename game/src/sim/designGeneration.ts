// Empire design generation (task D4). Ports of
//   BaconEmpire.CreateNewDesigns (BaconEmpire.cs 713, via Empire.10.cs 3261)
//   Empire.3.cs ReviewDesignComponentsAvailable (1770)
//   Empire.10.cs CheckDesignComponentsAvailable (1417), CanBuildDesignTech (255),
//     CheckDesignWithinConstructionSize (282), CanBuildDesign (413-450),
//     CheckDesignSubRoleShouldBeUpgraded (3082), ReviewRemoveObsoleteDesignsForSubRole (3266)
//   DesignList.cs FindNewestCanBuild (160) / FindNewestCanBuildFullEvaluate (214)
//   Galaxy.8.cs ResolveLegacySubRole (2232), Galaxy.2.cs ResolveDescription(subRole) (2133)
// Rnd: GenerateDesignName (designNames.ts) and the pirate PictureRef branch below; the
// placement code only draws in SelectPreferredSuperWeapon.
// TODO(port): LoadOptimizedDesignsForEmpire / ResolveOptimizedDesigns (optimized designs
// are loaded from files C# ships per race; none are loaded, so the list is empty and
// Design.CalculateTechLevel is never reached), Design.ReDefine stats, the planet-destroyer
// tail (needs SelectPreferredSuperWeapon(mustBePlanetDestroyer) to find a super weapon,
// which a starting empire never has), minor ship images (ShipImageHelper's own
// clock-seeded Random), CheckDesignInUse (no BuiltObjects yet → never in use).

import { BuiltObjectSubRole } from './builtObjectTypes';
import { ComponentType } from './data/components';
import { BattleTactics, BuiltObjectFleeWhen, BuiltObjectRole, InvasionTactics, type DesignSpecification } from './data/designSpecifications';
import { ComponentCategoryType, resolveTechFocuses } from './data/policies';
import { Design, BuiltObjectStance, findNewest } from './design';
import { generateDesignName } from './designNames';
import { placeComponentsOnDesignSized, selectPreferredSuperWeapon, type DesignPlacementEmpire } from './designPlacement';
import { Empire, raceDesignPictureFamilyIndexPirates } from './empire';
import type { Galaxy } from './galaxy';
import { ShipDesignFocus } from './researchSystem';
import type { Habitat } from './types';

// Galaxy.3.cs 5021 / 5138.
const MINIMUM_DESIGN_REVIEW_INTERVAL_YEARS = 0.5;
const REAL_SECONDS_IN_GALACTIC_YEAR = 600;
// ShipImageHelper.cs 25 / 43.
const SHIP_SET_IMAGE_COUNT = 24;
const STANDARD_SHIP_IMAGE_START_INDEX = 72;

// Galaxy.2.cs ResolveDescription(BuiltObjectSubRole) — GameText.txt "Ship SubRole *" values.
const SUBROLE_DESCRIPTION: Partial<Record<BuiltObjectSubRole, string>> = {
    [BuiltObjectSubRole.Carrier]: 'Carrier',
    [BuiltObjectSubRole.CapitalShip]: 'Capital Ship',
    [BuiltObjectSubRole.ColonyShip]: 'Colony Ship',
    [BuiltObjectSubRole.ConstructionShip]: 'Construction Ship',
    [BuiltObjectSubRole.Cruiser]: 'Cruiser',
    [BuiltObjectSubRole.DefensiveBase]: 'Defensive Base',
    [BuiltObjectSubRole.Destroyer]: 'Destroyer',
    [BuiltObjectSubRole.EnergyResearchStation]: 'Energy Research Station',
    [BuiltObjectSubRole.Escort]: 'Escort',
    [BuiltObjectSubRole.ExplorationShip]: 'Exploration Ship',
    [BuiltObjectSubRole.Frigate]: 'Frigate',
    [BuiltObjectSubRole.GasMiningShip]: 'Gas Mining Ship',
    [BuiltObjectSubRole.GasMiningStation]: 'Gas Mining Station',
    [BuiltObjectSubRole.GenericBase]: 'Star Base',
    [BuiltObjectSubRole.HighTechResearchStation]: 'HighTech Research Station',
    [BuiltObjectSubRole.LargeFreighter]: 'Large Freighter',
    [BuiltObjectSubRole.LargeSpacePort]: 'Large Space Port',
    [BuiltObjectSubRole.MediumFreighter]: 'Medium Freighter',
    [BuiltObjectSubRole.MediumSpacePort]: 'Medium Space Port',
    [BuiltObjectSubRole.MiningShip]: 'Mining Ship',
    [BuiltObjectSubRole.MiningStation]: 'Mining Station',
    [BuiltObjectSubRole.MonitoringStation]: 'Monitoring Station',
    [BuiltObjectSubRole.PassengerShip]: 'Passenger Ship',
    [BuiltObjectSubRole.ResortBase]: 'Resort Base',
    [BuiltObjectSubRole.ResupplyShip]: 'Resupply Ship',
    [BuiltObjectSubRole.SmallFreighter]: 'Small Freighter',
    [BuiltObjectSubRole.SmallSpacePort]: 'Small Space Port',
    [BuiltObjectSubRole.TroopTransport]: 'Troop Transport',
    [BuiltObjectSubRole.WeaponsResearchStation]: 'Weapons Research Station',
    [BuiltObjectSubRole.Undefined]: 'None',
};
export function resolveSubRoleDescription(subRole: BuiltObjectSubRole): string {
    return SUBROLE_DESCRIPTION[subRole] ?? BuiltObjectSubRole[subRole];
}

// Galaxy.8.cs ResolveLegacySubRole.
export function resolveLegacySubRole(subRole: BuiltObjectSubRole): BuiltObjectSubRole {
    switch (subRole) {
        case BuiltObjectSubRole.EnergyResearchStation:
        case BuiltObjectSubRole.WeaponsResearchStation:
        case BuiltObjectSubRole.HighTechResearchStation:
        case BuiltObjectSubRole.MonitoringStation:
            return BuiltObjectSubRole.GenericBase;
        case BuiltObjectSubRole.DefensiveBase:
            return BuiltObjectSubRole.MediumSpacePort;
        default:
            return subRole;
    }
}

function standardPictureRef(family: number, subRole: BuiltObjectSubRole): number {
    return STANDARD_SHIP_IMAGE_START_INDEX + family * SHIP_SET_IMAGE_COUNT + (resolveLegacySubRole(subRole) - 1);
}

/** The DesignPlacementEmpire view of an Empire (Race fields renamed to the C# names). */
export function placementView(empire: Empire, galaxy: Galaxy): DesignPlacementEmpire {
    const race = empire.dominantRace;
    return {
        research: empire.research,
        policy: empire.policy,
        dominantRace: race === null ? null : { aggressionLevel: race.aggression, intelligenceLevel: race.intelligence },
        componentDefinitions: galaxy.researchStatic?.componentStatic?.definitions ?? [],
        hasHyperDriveTech: empire.hasHyperDriveTech,
        maximumConstructionSize: (s) => empire.maximumConstructionSize(s),
        maximumConstructionSizeBase: (s) => empire.maximumConstructionSizeBase(s),
        isPirate: empire.pirateEmpireBaseHabitat !== null,
        rnd: galaxy.rnd,
    };
}

// Empire.10.cs CheckDesignComponentsAvailable (1417).
export function checkDesignComponentsAvailable(empire: Empire, role: BuiltObjectRole, subRole: BuiltObjectSubRole): boolean {
    const T = ComponentType;
    const C = ComponentCategoryType;
    const R = BuiltObjectRole;
    const S = BuiltObjectSubRole;
    const researched = empire.research.researchedComponents;
    const list: ComponentType[] = [T.ComputerCommandCenter, T.StorageFuel, T.HabitationLifeSupport, T.HabitationHabModule];
    const list2: ComponentCategoryType[] = [C.Reactor];
    switch (role) {
        case R.Military:
        case R.Exploration:
        case R.Freight:
        case R.Passenger:
        case R.Colony:
        case R.Build:
        case R.Resource:
            list.push(T.EngineMainThrust, T.EngineVectoring);
            break;
        case R.Base:
            list.push(T.StorageDockingBay);
            break;
    }
    switch (role) {
        case R.Build:
            list.push(T.StorageDockingBay, T.StorageCargo, T.ConstructionBuild, T.ManufacturerEnergyPlant, T.ManufacturerHighTechPlant, T.ManufacturerWeaponsPlant);
            break;
        case R.Colony:
            list.push(T.HabitationColonization);
            break;
        case R.Exploration:
            list.push(T.SensorResourceProfileSensor);
            break;
        case R.Passenger:
            list.push(T.StoragePassenger);
            break;
        case R.Freight:
            list.push(T.StorageCargo);
            break;
        case R.Resource:
            list.push(T.StorageCargo);
            list2.push(C.Extractor);
            break;
    }
    switch (subRole) {
        case S.TroopTransport:
            list.push(T.StorageTroop);
            break;
        case S.Carrier:
            list.push(T.FighterBay);
            break;
        case S.ResupplyShip:
            list.push(T.ExtractorGasExtractor, T.StorageCargo, T.StorageDockingBay);
            break;
        case S.GasMiningStation:
            list.push(T.ExtractorGasExtractor, T.ComputerCommerceCenter, T.StorageCargo);
            break;
        case S.MiningStation:
            list.push(T.ExtractorMine, T.ComputerCommerceCenter, T.StorageCargo);
            break;
        case S.SmallSpacePort:
        case S.MediumSpacePort:
        case S.LargeSpacePort:
            list.push(T.ComputerCommerceCenter, T.ConstructionBuild, T.ManufacturerEnergyPlant, T.ManufacturerHighTechPlant, T.ManufacturerWeaponsPlant);
            break;
        case S.EnergyResearchStation:
            list.push(T.LabsEnergyLab);
            break;
        case S.WeaponsResearchStation:
            list.push(T.LabsWeaponsLab);
            break;
        case S.HighTechResearchStation:
            list.push(T.LabsHighTechLab);
            break;
        case S.MonitoringStation:
            list.push(T.SensorLongRange);
            break;
        case S.ResortBase:
            list.push(T.ComputerCommerceCenter, T.HabitationRecreationCenter);
            break;
        case S.GenericBase:
            list.push(T.StorageCargo);
            break;
    }
    for (const cat of list2) if (!researched.some((c) => c.category === cat)) return false;
    for (const type of list) if (!researched.some((c) => c.type === type)) return false;
    switch (subRole) {
        case S.Escort:
        case S.Frigate:
        case S.Destroyer:
        case S.Cruiser:
        case S.CapitalShip:
        case S.DefensiveBase:
            if (
                !researched.some(
                    (c) =>
                        c.category === C.WeaponBeam ||
                        c.category === C.WeaponTorpedo ||
                        c.category === C.WeaponArea ||
                        c.category === C.WeaponIon ||
                        c.category === C.WeaponSuperArea ||
                        c.category === C.WeaponSuperBeam ||
                        c.category === C.WeaponSuperTorpedo ||
                        c.type === T.WeaponAreaGravity ||
                        c.type === T.WeaponGravityBeam,
                )
            )
                return false;
            break;
    }
    return true;
}

// Empire.3.cs ReviewDesignComponentsAvailable (1770): order of the C# checks.
const COMPONENTS_AVAILABLE_ORDER: [BuiltObjectRole, BuiltObjectSubRole][] = (() => {
    const R = BuiltObjectRole;
    const S = BuiltObjectSubRole;
    return [
        [R.Military, S.CapitalShip], [R.Military, S.Carrier], [R.Colony, S.ColonyShip], [R.Build, S.ConstructionShip],
        [R.Military, S.Cruiser], [R.Base, S.DefensiveBase], [R.Military, S.Destroyer], [R.Base, S.EnergyResearchStation],
        [R.Military, S.Escort], [R.Exploration, S.ExplorationShip], [R.Military, S.Frigate], [R.Resource, S.GasMiningShip],
        [R.Base, S.GasMiningStation], [R.Base, S.GenericBase], [R.Base, S.HighTechResearchStation], [R.Freight, S.LargeFreighter],
        [R.Base, S.LargeSpacePort], [R.Freight, S.MediumFreighter], [R.Base, S.MediumSpacePort], [R.Resource, S.MiningShip],
        [R.Base, S.MiningStation], [R.Base, S.MonitoringStation], [R.Passenger, S.PassengerShip], [R.Base, S.ResortBase],
        [R.Military, S.ResupplyShip], [R.Freight, S.SmallFreighter], [R.Base, S.SmallSpacePort], [R.Military, S.TroopTransport],
        [R.Base, S.WeaponsResearchStation],
    ] as [BuiltObjectRole, BuiltObjectSubRole][];
})();
export function reviewDesignComponentsAvailable(empire: Empire): void {
    for (const [role, subRole] of COMPONENTS_AVAILABLE_ORDER) {
        if (!empire.componentsAvailable[subRole]) empire.componentsAvailable[subRole] = checkDesignComponentsAvailable(empire, role, subRole);
    }
}

// Empire.10.cs CanBuildDesignTech (255).
export function canBuildDesignTech(empire: Empire, design: Design): boolean {
    const seen = new Set<number>();
    for (const c of design.components) {
        if (seen.has(c.componentId)) continue; // GetDistinctComponentList
        seen.add(c.componentId);
        if (!empire.research.checkComponentResearched(c)) return false;
    }
    if (design.subRole === BuiltObjectSubRole.Carrier) return empire.canBuildCarriers;
    if (design.subRole === BuiltObjectSubRole.ResupplyShip) return empire.canBuildResupplyShips;
    return true;
}

// Empire.10.cs CheckDesignWithinConstructionSize(design, colony) (282).
export function checkDesignWithinConstructionSize(empire: Empire, design: Design, colony: Habitat | null): boolean {
    const S = BuiltObjectSubRole;
    let num = 0;
    if (design.role === BuiltObjectRole.Base) {
        const unlimitedBase =
            design.subRole !== S.GasMiningStation &&
            design.subRole !== S.GenericBase &&
            design.subRole !== S.MiningStation &&
            design.subRole !== S.EnergyResearchStation &&
            design.subRole !== S.WeaponsResearchStation &&
            design.subRole !== S.HighTechResearchStation &&
            design.subRole !== S.MonitoringStation &&
            design.subRole !== S.DefensiveBase &&
            design.subRole !== S.ResortBase;
        if (unlimitedBase) num = 2147483647;
        else num = colony === null || colony.empire !== empire || colony.population.totalAmount <= 0 ? empire.maximumConstructionSizeBase(design.subRole) : 2147483647;
    } else if (design.isPlanetDestroyer) {
        num = empire.maximumConstructionSizeBase();
    } else {
        num = empire.maximumConstructionSize(design.subRole);
        if (design.subRole === S.ColonyShip || design.subRole === S.ConstructionShip || design.subRole === S.ResupplyShip) num = empire.maximumConstructionSizeBase(design.subRole);
    }
    return !(design.size > num);
}

// Empire.10.cs CanBuildDesign(design, includeSizeCheck, colony) (430).
export function canBuildDesign(empire: Empire, design: Design, includeSizeCheck = true, colony: Habitat | null = null): boolean {
    if (!canBuildDesignTech(empire, design)) return false;
    if (includeSizeCheck && !checkDesignWithinConstructionSize(empire, design, colony)) return false;
    return true;
}

// DesignList.cs FindNewestCanBuildFullEvaluate (214). Optimized designs are never loaded
// (see header), so only the newest-DateCreated branch can win.
export function findNewestCanBuildFullEvaluate(designs: Design[], subRole: BuiltObjectSubRole, colony: Habitat | null, includePlanetDestroyers = true): Design | null {
    let num1 = 0;
    let design2: Design | null = null;
    for (const d of designs) {
        const owner = d.empire as Empire | null;
        if (d.subRole === subRole && !d.isObsolete && (d.dateCreated > num1 || d.optimizedDesign > 0) && owner !== null && canBuildDesign(owner, d, true, colony) && (includePlanetDestroyers || !d.isPlanetDestroyer)) {
            if (d.optimizedDesign > 0) {
                throw new Error('TODO(port): optimized designs (Design.CalculateTechLevel)');
            }
            num1 = d.dateCreated;
            design2 = d;
        }
    }
    return design2;
}

// DesignList.cs FindNewestCanBuild(subRole, empire, colony, includePlanetDestroyers) (160).
export function findNewestCanBuild(designs: Design[], subRole: BuiltObjectSubRole, empire: Empire | null, colony: Habitat | null = null, includePlanetDestroyers = false): Design | null {
    let design: Design | null = null;
    if (designs.length > 0 && empire !== null) {
        design = (empire.latestDesigns[subRole] as Design | null) ?? null;
        if (design !== null && !checkDesignWithinConstructionSize(empire, design, colony)) design = null;
        if (subRole === BuiltObjectSubRole.Carrier && !empire.canBuildCarriers) design = null;
        else if (subRole === BuiltObjectSubRole.ResupplyShip && !empire.canBuildResupplyShips) design = null;
        if (!includePlanetDestroyers && design !== null && design.isPlanetDestroyer) design = null;
    }
    if (design === null) design = findNewestCanBuildFullEvaluate(designs, subRole, colony);
    return design;
}

// Empire.10.cs CheckDesignSubRoleShouldBeUpgraded (3082).
export function checkDesignSubRoleShouldBeUpgraded(empire: Empire, subRole: BuiltObjectSubRole): boolean {
    const p = empire.policy;
    if (p === null) return true;
    const S = BuiltObjectSubRole;
    switch (subRole) {
        case S.Escort: return p.designUpgradeEscort;
        case S.Frigate: return p.designUpgradeFrigate;
        case S.Destroyer: return p.designUpgradeDestroyer;
        case S.Cruiser: return p.designUpgradeCruiser;
        case S.CapitalShip: return p.designUpgradeCapitalShip;
        case S.TroopTransport: return p.designUpgradeTroopTransport;
        case S.Carrier: return p.designUpgradeCarrier;
        case S.ResupplyShip: return p.designUpgradeResupplyShip;
        case S.ExplorationShip: return p.designUpgradeExplorationShip;
        case S.ColonyShip: return p.designUpgradeColonyShip;
        case S.ConstructionShip: return p.designUpgradeConstructionShip;
        case S.SmallSpacePort: return p.designUpgradeSmallSpacePort;
        case S.MediumSpacePort: return p.designUpgradeMediumSpacePort;
        case S.LargeSpacePort: return p.designUpgradeLargeSpacePort;
        case S.ResortBase: return p.designUpgradeResortBase;
        case S.GenericBase: return p.designUpgradeGenericBase;
        case S.EnergyResearchStation: return p.designUpgradeEnergyResearchStation;
        case S.WeaponsResearchStation: return p.designUpgradeWeaponsResearchStation;
        case S.HighTechResearchStation: return p.designUpgradeHighTechResearchStation;
        case S.MonitoringStation: return p.designUpgradeMonitoringStation;
        case S.DefensiveBase: return p.designUpgradeDefensiveBase;
        case S.SmallFreighter: return p.designUpgradeSmallFreighter;
        case S.MediumFreighter: return p.designUpgradeMediumFreighter;
        case S.LargeFreighter: return p.designUpgradeLargeFreighter;
        case S.PassengerShip: return p.designUpgradePassengerShip;
        case S.GasMiningShip: return p.designUpgradeGasMiningShip;
        case S.MiningShip: return p.designUpgradeMiningShip;
        case S.GasMiningStation: return p.designUpgradeGasMiningStation;
        case S.MiningStation: return p.designUpgradeMiningStation;
        default: return true;
    }
}

// Empire.10.cs ReviewRemoveObsoleteDesignsForSubRole (3266). CheckDesignInUse is always
// false until BuiltObjects exist, so every obsoleted design is removed.
export function reviewRemoveObsoleteDesignsForSubRole(empire: Empire, subRole: BuiltObjectSubRole, designToExclude: Design | null, removeManualDesigns: boolean): void {
    const remove: Design[] = [];
    for (const d of empire.designs as Design[]) {
        if (d.subRole !== subRole || (designToExclude !== null && d === designToExclude)) continue;
        const manual = d.isManuallyCreated && d.optimizedDesign === 0;
        if (removeManualDesigns || !manual) {
            d.isObsolete = true;
            remove.push(d); // !CheckDesignInUse(design)
        }
    }
    for (const d of remove) {
        const i = (empire.designs as Design[]).indexOf(d);
        if (i >= 0) empire.designs.splice(i, 1);
    }
}

function applySubRoleBehaviour(empire: Empire, design: Design, spec: DesignSpecification, fleeWhen6: BuiltObjectFleeWhen, militaryFleeWhen: BuiltObjectFleeWhen): void {
    const S = BuiltObjectSubRole;
    const set = (stance: BuiltObjectStance, flee: BuiltObjectFleeWhen, stronger: BattleTactics, weaker: BattleTactics, invasion: InvasionTactics) => {
        design.stance = stance;
        design.fleeWhen = flee;
        design.tacticsStrongerShips = stronger;
        design.tacticsWeakerShips = weaker;
        design.tacticsInvasion = invasion;
    };
    const B = BattleTactics;
    const I = InvasionTactics;
    const F = BuiltObjectFleeWhen;
    const St = BuiltObjectStance;
    switch (spec.subRole) {
        case S.Escort:
        case S.Frigate:
        case S.Destroyer:
        case S.Cruiser:
        case S.CapitalShip:
            set(St.AttackEnemies, militaryFleeWhen, B.Standoff, B.AllWeapons, I.InvadeWhenClear);
            break;
        case S.TroopTransport:
            set(St.AttackEnemies, fleeWhen6, B.Evade, B.AllWeapons, I.InvadeImmediately);
            break;
        case S.Carrier:
            set(St.AttackEnemies, fleeWhen6, B.Evade, B.AllWeapons, I.InvadeWhenClear);
            break;
        case S.ResupplyShip:
            set(St.AttackEnemies, fleeWhen6, B.Evade, B.AllWeapons, I.DoNotInvade);
            break;
        case S.ExplorationShip:
            set(St.AttackIfAttacked, F.EnemyMilitarySighted, B.Evade, B.Evade, I.DoNotInvade);
            break;
        case S.SmallFreighter:
        case S.MediumFreighter:
        case S.LargeFreighter:
            set(design.firepowerRaw > 0 ? St.AttackIfAttacked : St.DoNotAttack, F.EnemyMilitarySighted, B.Evade, B.Evade, I.DoNotInvade);
            break;
        case S.ColonyShip:
        case S.PassengerShip:
        case S.ConstructionShip:
        case S.GasMiningShip:
        case S.MiningShip:
            set(St.DoNotAttack, F.EnemyMilitarySighted, B.Evade, B.Evade, I.DoNotInvade);
            break;
        case S.GasMiningStation:
        case S.MiningStation:
            set(St.AttackIfAttacked, F.Never, B.PointBlank, B.PointBlank, I.DoNotInvade);
            break;
        case S.SmallSpacePort:
        case S.MediumSpacePort:
        case S.LargeSpacePort:
        case S.ResortBase:
        case S.GenericBase:
        case S.EnergyResearchStation:
        case S.WeaponsResearchStation:
        case S.HighTechResearchStation:
        case S.MonitoringStation:
        case S.DefensiveBase:
            set(St.AttackEnemies, F.Never, B.PointBlank, B.PointBlank, I.DoNotInvade);
            break;
        default:
            set(St.DoNotAttack, F.Attacked, B.Standoff, B.AllWeapons, I.DoNotInvade);
            break;
    }
    if (spec.tacticsStronger !== 0) design.tacticsStrongerShips = spec.tacticsStronger;
    if (spec.tacticsWeaker !== 0) design.tacticsWeakerShips = spec.tacticsWeaker;
    if (spec.tacticsInvasion !== 0) design.tacticsInvasion = spec.tacticsInvasion;
    if (spec.fleeWhen !== 0) design.fleeWhen = spec.fleeWhen;
    void empire;
}

// BaconEmpire.CreateNewDesigns(empire, designDate, forceUpdate, designRoleToChange = -1).
// `currentStarDate` = Galaxy.CurrentStarDate (not tracked on the TS Galaxy yet).
export function createNewDesigns(galaxy: Galaxy, empire: Empire, designDate: number, currentStarDate: number, forceUpdate = false, designRoleToChange = -1): void {
    let num1 = 0;
    let num2 = empire.designSpecifications.length;
    if (designRoleToChange > -1) {
        num1 = designRoleToChange;
        num2 = designRoleToChange + 1;
    }
    let num3 = Math.trunc(MINIMUM_DESIGN_REVIEW_INTERVAL_YEARS * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    if (!empire.initiateConstruction || forceUpdate) num3 = 0;
    empire.research.update();
    reviewDesignComponentsAvailable(empire);
    const militaryFleeWhen = empire.policy?.defaultMilitaryFleeWhen ?? BuiltObjectFleeWhen.Shields20;
    const race = empire.dominantRace!;
    let fleeWhen6 = BuiltObjectFleeWhen.Shields50;
    if (race.caution < 80) fleeWhen6 = BuiltObjectFleeWhen.Shields20;
    const view = placementView(empire, galaxy);
    const componentImprovementList = null; // Galaxy.GenerateOrderedComponentImprovementList(WeaponTorpedo, 1): built inside placement when null
    const designs = empire.designs as Design[];
    // DesignList source1 = empire.Designs.ResolveOptimizedDesigns(): always empty (see header).
    for (let index1 = num1; index1 < num2; ++index1) {
        const spec = empire.designSpecifications[index1]!;
        if (!empire.componentsAvailable[spec.subRole]) continue;
        let flag1 = true;
        if (spec.subRole === BuiltObjectSubRole.Carrier && !empire.canBuildCarriers) flag1 = false;
        else if (spec.subRole === BuiltObjectSubRole.ResupplyShip && !empire.canBuildResupplyShips) flag1 = false;
        if (!flag1 || !checkDesignSubRoleShouldBeUpgraded(empire, spec.subRole)) continue;
        let design1 = empire.pirateEmpireBaseHabitat === null ? findNewestCanBuild(designs, spec.subRole, empire, empire.capital, false) : findNewestCanBuild(designs, spec.subRole, null, null, false);
        const design2: Design | null = null; // optimized-design candidate (none)
        let num5 = 0;
        if (design1 !== null && !design1.isObsolete) {
            num5 = design1.dateCreated + num3;
            empire.latestDesigns[design1.subRole] = design1;
        }
        if (!(currentStarDate >= num5)) continue;
        const name = `${race.name} ${resolveSubRoleDescription(spec.subRole)}`;
        if (spec.subRole === BuiltObjectSubRole.MonitoringStation && empire.research.evaluateDesiredComponent(ComponentType.SensorLongRange, ShipDesignFocus.Balanced) === null) continue;
        if (spec.subRole === BuiltObjectSubRole.Carrier && empire.research.evaluateDesiredComponent(ComponentType.FighterBay, ShipDesignFocus.Balanced) === null) continue;
        const design4 = new Design(name);
        design4.role = spec.role;
        design4.subRole = spec.subRole;
        design4.imageScalingType = spec.imageScalingMode;
        design4.imageScalingFactor = spec.imageScalingFactor;
        const maxShipSize = empire.maximumConstructionSize(design4.subRole);
        const maxBaseSize = empire.maximumConstructionSizeBase(design4.subRole);
        const design5 = placeComponentsOnDesignSized(view, design4, spec, componentImprovementList, maxShipSize, maxBaseSize, design1);
        if (design5 === null) continue;
        applySubRoleBehaviour(empire, design5, spec, fleeWhen6, militaryFleeWhen);
        const design6 = design1;
        if (design1 === null) design1 = findNewest(designs, spec.subRole);
        if (design5.isEquivalent(design1)) continue;
        let flag3 = true;
        void design2;
        if (design6 !== null) {
            design5.size = design5.quickCalculateSize();
            const ok = empire.pirateEmpireBaseHabitat === null ? canBuildDesign(empire, design5, true, empire.capital) : canBuildDesign(empire, design5);
            if (!ok) flag3 = false;
        }
        if (!flag3) continue;
        const reactor = empire.research.evaluateDesiredComponentByCategory(ComponentCategoryType.Reactor, ShipDesignFocus.Balanced);
        design5.name = generateDesignName(
            galaxy,
            empire.designNameState,
            { designNamesIndex: empire.designNamesIndex, designNames: galaxy.designNames, existingDesigns: designs, latestReactorComponentId: reactor?.componentId ?? null },
            spec.subRole,
            design1,
        );
        design5.dateCreated = designDate;
        design5.empire = empire;
        if (empire.pirateEmpireBaseHabitat === null) {
            design5.pictureRef = standardPictureRef(empire.designPictureFamilyIndex, design5.subRole);
        } else {
            const num6 = empire.dominantRace !== null ? raceDesignPictureFamilyIndexPirates(empire.dominantRace) : -1;
            if (num6 >= 0) {
                design5.pictureRef = standardPictureRef(num6, design5.subRole);
            } else {
                const S = BuiltObjectSubRole;
                const minor = [S.Escort, S.Frigate, S.Destroyer, S.Cruiser, S.CapitalShip, S.ColonyShip, S.GasMiningStation, S.MiningStation, S.SmallSpacePort, S.GenericBase];
                if (minor.includes(design5.subRole)) {
                    design5.pictureRef = 0; // TODO(port): ShipImageHelper.ResolveMinorShipImageIndex (own clock-seeded Random)
                } else {
                    // label_77: a random playable race other than the player's (Galaxy.Rnd).
                    const races = galaxy.races.filter((r) => r.playable && r !== galaxy.playerEmpire?.dominantRace);
                    if (races.length > 0) {
                        const r = races[galaxy.rnd.next(0, races.length)];
                        design5.pictureRef = standardPictureRef(r.designsPictureFamilyIndex, design5.subRole);
                    } else design5.pictureRef = 0;
                }
            }
        }
        design5.role = spec.role;
        design5.subRole = spec.subRole;
        design5.reDefine();
        reviewRemoveObsoleteDesignsForSubRole(empire, spec.subRole, null, false);
        designs.push(design5);
        if (!design5.isPlanetDestroyer) empire.latestDesigns[design5.subRole] = design5;
    }
    // Planet destroyers (BaconEmpire.cs ~1040).
    if (!(empire.policy?.buildPlanetDestroyers ?? false) || !checkDesignSubRoleShouldBeUpgraded(empire, BuiltObjectSubRole.CapitalShip)) return;
    const { categories, types } = resolveTechFocuses(empire.policy);
    if (selectPreferredSuperWeapon(view, categories, types, true) !== null) {
        // TODO(port): GenerateDesignFromSpec(PlanetDestroyerDesignSpecification) /
        // Galaxy.GeneratePlanetDestroyerDesign and the replace-if-better logic.
        throw new Error('TODO(port): planet destroyer design generation');
    }
}
