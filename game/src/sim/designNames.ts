// Port of Empire.cs GenerateDesignName (Empire.cs:3208-3589),
// GetNewProperDesignName (Empire.cs:3116-3177), RomanNumeral
// (Empire.cs:3179-3206) and GenerateDesignNamePrefix (Empire.cs:3591-3594).
//
// TextResolver isn't ported anywhere in this codebase (see the
// "TextResolver not ported" comments in galaxy.ts); following that existing
// convention, the localized strings resolved via TextResolver.GetText(...)
// below are inlined as literal English strings, each with a comment giving
// the exact C# text key so a future localization pass can find them.

import type { Galaxy } from './galaxy';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { ComponentCategoryType } from './data/policies';
import { Random } from './random';

// Port of Empire.cs Number (nested struct: Value/Rep pairs used by
// RomanNumeral). Order matters (largest value first).
const ROMAN_NUMBERS: ReadonlyArray<{ value: number; rep: string }> = [
    { value: 1000, rep: 'M' },
    { value: 900, rep: 'CM' },
    { value: 500, rep: 'D' },
    { value: 400, rep: 'CD' },
    { value: 100, rep: 'C' },
    { value: 90, rep: 'XC' },
    { value: 50, rep: 'L' },
    { value: 40, rep: 'XL' },
    { value: 10, rep: 'X' },
    { value: 9, rep: 'IX' },
    { value: 5, rep: 'V' },
    { value: 4, rep: 'IV' },
    { value: 1, rep: 'I' },
];

// Port of Empire.cs RomanNumeral(int number) (Empire.cs:3179-3206).
// Pure/no Rnd draws. The C# ConditionCheckLimit(number > 0, 100, ref
// iterationCount) loop bound (100 iterations) can never actually bind here
// (a valid Roman numeral for number <= 10000 always resolves in far fewer
// steps), so it is omitted; the `number > 10000 || number < 0` guard is kept.
export function romanNumeral(number: number): string {
    if (number > 10000 || number < 0) {
        return '[.]';
    }
    let n = number;
    let idx = 0;
    let result = '';
    while (n > 0) {
        const value = ROMAN_NUMBERS[idx].value;
        if (n >= value) {
            n -= value;
            result += ROMAN_NUMBERS[idx].rep;
        } else {
            idx++;
        }
    }
    return result;
}

// Port of Empire.cs's per-empire design-naming fields (Empire.cs private
// fields near _DesignNamesIndex/_DesignNamesUsage and the per-sub-role
// _XxxPrefix / _XxxCurrentModelNumber / _XxxName fields used by
// GenerateDesignName / GetNewProperDesignName). One instance per Empire.
export class DesignNameState {
    // Port of Empire.cs _DesignNamesUsage (int[36], grown to match the
    // selected family's length the first time GetNewProperDesignName runs
    // for this empire).
    designNamesUsage: number[] = new Array(36).fill(0);

    escortPrefix = '';
    escortCurrentModelNumber = 0;

    frigatePrefix = '';
    frigateCurrentModelNumber = 0;

    destroyerPrefix = '';
    destroyerCurrentModelNumber = 0;

    cruiserPrefix = '';
    cruiserCurrentModelNumber = 0;

    capitalShipPrefix = '';
    capitalShipCurrentModelNumber = 0;

    troopTransportPrefix = '';
    troopTransportCurrentModelNumber = 0;

    carrierCurrentModelNumber = 0;
    resupplyShipCurrentModelNumber = 0;

    smallFreighterPrefix = '';
    smallFreighterName = '';
    smallFreighterCurrentModelNumber = 0;

    mediumFreighterPrefix = '';
    mediumFreighterName = '';
    mediumFreighterCurrentModelNumber = 0;

    largeFreighterPrefix = '';
    largeFreighterName = '';
    largeFreighterCurrentModelNumber = 0;

    gasMiningShipPrefix = '';
    gasMiningShipName = '';
    gasMiningShipCurrentModelNumber = 0;

    miningShipPrefix = '';
    miningShipName = '';
    miningShipCurrentModelNumber = 0;

    resortBaseCurrentModelNumber = 0;
    weaponsResearchStationCurrentModelNumber = 0;
    energyResearchStationCurrentModelNumber = 0;
    highTechResearchStationCurrentModelNumber = 0;
    monitoringStationCurrentModelNumber = 0;
    defensiveBaseCurrentModelNumber = 0;
    smallSpacePortCurrentModelNumber = 0;
    mediumSpacePortCurrentModelNumber = 0;
    largeSpacePortCurrentModelNumber = 0;
    miningStationCurrentModelNumber = 0;
    gasMiningStationCurrentModelNumber = 0;
    constructionShipCurrentModelNumber = 0;
    passengerShipCurrentModelNumber = 0;
    explorationShipCurrentModelNumber = 0;
    colonyShipCurrentModelNumber = 0;
}

export interface DesignNameContext {
    // Race.DesignNamesIndex for this empire's dominant race (Empire.cs:3791
    // `_DesignNamesIndex = _DominantRace.DesignNameIndex`). Indexes into
    // `designNames`.
    designNamesIndex: number;
    // Galaxy.DesignNames (Galaxy.cs `_DesignNames`/`DesignNames`), loaded
    // from designNames.txt via parseDesignNames (data/designNames.ts). Not
    // present on the Galaxy class in this codebase yet -- passed explicitly
    // here so this module doesn't need to touch galaxy.ts.
    designNames: string[][];
    // Present for API completeness per the task spec, but NOT used: the C#
    // GetNewProperDesignName does not check name uniqueness against any
    // existing-designs list. It only tracks a per-empire usage-count array
    // (_DesignNamesUsage) so that within one empire's history, names that
    // have been used fewer times are preferred over already-reused ones.
    // Different empires (and even the same empire across a reload) can and
    // do reuse the same design name.
    existingDesigns: { name: string }[];
    // Empire.cs:3219 `Research.EvaluateDesiredComponent(ComponentCategoryType.Reactor,
    // ShipDesignFocus.Balanced).ComponentID`, computed by the caller (this
    // module doesn't depend on the research system to avoid an import
    // cycle). Only read when `previousDesign` is non-null.
    //
    // C# derefs `component.ComponentID` with NO null check, so if
    // EvaluateDesiredComponent ever returned null there C# would throw a
    // NullReferenceException. This port cannot reproduce a crash usefully,
    // so when `latestReactorComponentId` is null and `previousDesign` is
    // non-null, we treat it as "no reactor change detected from this signal"
    // (`flag` stays false from this check) -- i.e. we fail *open* rather
    // than throw. This is a documented deviation from the crash-on-null C#
    // behavior; callers should ensure EvaluateDesiredComponent's result is
    // available before calling for a non-null previousDesign so this path is
    // never actually exercised.
    latestReactorComponentId: number | null;
}

export interface PreviousDesignForNaming {
    components: { componentId: number; category: ComponentCategoryType }[];
}

// Port of Empire.cs GenerateDesignNamePrefix (Empire.cs:3591-3594).
// Draws exactly 2 Rnd.Next calls: two capital letters A-Z.
function generateDesignNamePrefix(galaxy: Galaxy): string {
    const a = galaxy.rnd.next(65, 91);
    const b = galaxy.rnd.next(65, 91);
    return String.fromCharCode(a) + String.fromCharCode(b);
}

// Port of Empire.cs GetNewProperDesignName(BuiltObjectSubRole subRole)
// (Empire.cs:3116-3177).
//
// Rnd draws: up to 50 calls to galaxy.rnd.next(0, familyLength) in the first
// loop; if none of those 50 draws hit an under-used name (practically never
// happens with any real design-name family, since `num` is set to the
// minimum usage count across all slots, or minimum+1 only if all slots are
// tied), a *second* Random instance seeded from the current time is
// substituted (Galaxy.SetRandom(new Random((int)DateTime.Now.Ticks)) at
// Empire.cs:3159) and up to another 50 draws are made against it. That
// reseed (wall-clock seeded in C#; seeded from the galaxy seed here) mutates the
// *shared* galaxy Rnd stream for everything after it -- this port reproduces
// it faithfully (including the stream-mutating side effect) since the task
// requires matching C# exactly, but note this path should never be
// exercised by any real design-name family (all shipped families have >1
// name and the usage-count logic guarantees some slot is under `num`).
function getNewProperDesignName(
    galaxy: Galaxy,
    state: DesignNameState,
    ctx: DesignNameContext,
    subRole: BuiltObjectSubRole,
): string {
    let text = '';
    const family = ctx.designNames[ctx.designNamesIndex];
    if (state.designNamesUsage.length < family.length) {
        state.designNamesUsage = new Array(family.length).fill(0);
    }
    let num = 0;
    for (const usage of state.designNamesUsage) {
        if (usage > num) {
            num = usage;
        }
    }
    let flag = false;
    for (const usage of state.designNamesUsage) {
        if (usage < num) {
            flag = true;
            break;
        }
    }
    if (!flag) {
        num++;
    }
    let iterations = 0;
    while (text === '' && iterations < 50) {
        const index = galaxy.rnd.next(0, family.length);
        if (state.designNamesUsage[index] < num) {
            text = family[index];
            state.designNamesUsage[index]++;
        }
        iterations++;
    }
    if (text === '') {
        // Empire.cs:3159 `Galaxy.SetRandom(new Random((int)DateTime.Now.Ticks))`.
        // Reseeds and replaces the *shared* galaxy Rnd stream. The clock seed is
        // replaced by one derived from the galaxy seed (project convention for
        // C# clock-seeded Randoms) so games stay reproducible.
        galaxy.rnd = new Random((galaxy.randomSeed ^ 0x3159) | 0);
        iterations = 0;
        while (text === '' && iterations < 50) {
            const index = galaxy.rnd.next(0, family.length);
            if (state.designNamesUsage[index] < num) {
                text = family[index];
                state.designNamesUsage[index]++;
            }
            iterations++;
        }
    }
    if (text === '') {
        // Port of Galaxy.ResolveDescription(subRole) (Galaxy.2.cs:2133),
        // TextResolver not ported (see file header) -- literal strings used.
        text = resolveSubRoleDescription(subRole);
    }
    return text;
}

// Port of Galaxy.2.cs ResolveDescription(BuiltObjectSubRole subRole)
// (Galaxy.2.cs:2133-2166), restricted to the sub-roles GetNewProperDesignName
// can actually be called with (the six that call it from GenerateDesignName).
// TextResolver.GetText("Ship SubRole " + <name>) keys are cited per case.
function resolveSubRoleDescription(subRole: BuiltObjectSubRole): string {
    switch (subRole) {
        case BuiltObjectSubRole.Escort:
            return 'Escort'; // TextResolver.GetText("Ship SubRole Escort")
        case BuiltObjectSubRole.Frigate:
            return 'Frigate'; // TextResolver.GetText("Ship SubRole Frigate")
        case BuiltObjectSubRole.Destroyer:
            return 'Destroyer'; // TextResolver.GetText("Ship SubRole Destroyer")
        case BuiltObjectSubRole.Cruiser:
            return 'Cruiser'; // TextResolver.GetText("Ship SubRole Cruiser")
        case BuiltObjectSubRole.CapitalShip:
            return 'Capital Ship'; // TextResolver.GetText("Ship SubRole CapitalShip")
        case BuiltObjectSubRole.TroopTransport:
            return 'Troop Transport'; // TextResolver.GetText("Ship SubRole TroopTransport")
        default:
            return '';
    }
}

// Name-pool literals for the sub-roles that pick a random descriptive word
// (Empire.cs:3339-3579). TextResolver.GetText(...) keys cited per entry.
const RESUPPLY_SHIP_NAMES = [
    'Resupply Ship', // TextResolver.GetText("Ship SubRole ResupplyShip")
    'Mothership', // TextResolver.GetText("Mothership")
    'Refuelling Base', // TextResolver.GetText("Refuelling Base")
    'Fleet Supply Ship', // TextResolver.GetText("Fleet Supply Ship")
];
const SMALL_FREIGHTER_NAMES = [
    'Light Transport', 'Light Trader', 'Light Hauler', 'Light Freighter', 'Cargo Shuttle', 'Merchant Freighter',
];
const MEDIUM_FREIGHTER_NAMES = [
    'Medium Transport', 'Cargo Freighter', 'Cargo Hauler', 'Medium Freighter', 'Cargo Ferry', 'Freight Hauler',
];
const LARGE_FREIGHTER_NAMES = [
    'Super Hauler', 'Cargo Carrier', 'Heavy Freighter', 'Cargo Barge', 'Bulk Freighter', 'Heavy Lifter', 'Bulk Transport',
];
const GAS_MINING_SHIP_NAMES = [
    'Gas Prospector', 'Gas Mining Ship', 'Gas Miner', 'Gas Hauler', 'Gas Tanker',
];
const MINING_SHIP_NAMES = [
    'Ore Prospector', 'Ore Hauler', 'Miner', 'Mining Ship', 'Mineral Miner',
];
const CONSTRUCTION_SHIP_NAMES = [
    'Construction Ship', 'Constructor', 'Ship Yard', 'Space Dock',
];
const PASSENGER_SHIP_NAMES = [
    'Passenger Ship', 'Space Liner', 'Commuter', 'Traveller', 'Tourist', 'Migrant',
];
const EXPLORATION_SHIP_NAMES = [
    'Scout', 'Surveyor', 'Pathfinder', 'Explorer', 'Traveller', 'Navigator',
];
const COLONY_SHIP_NAMES = [
    'Colonizer', 'Settler', 'World Founder', 'Colony Ship',
];

// Port of Empire.cs GenerateDesignName(BuiltObjectSubRole subRole, Design
// previousDesign) (Empire.cs:3208-3589).
//
// Rnd draw counts (galaxy.rnd.next / .nextDouble calls), per call, exactly
// matching C# call order:
//  - Escort/Frigate/Destroyer/Cruiser/CapitalShip/TroopTransport: 0 calls to
//    getNewProperDesignName if the prefix already exists and the reactor
//    hasn't changed (`flag` is false); 1 call if only one of
//    (prefix-was-empty, flag) is true; 2 calls (empty-prefix branch, then
//    flag branch -- the second call's result wins, since it runs after and
//    overwrites the prefix) if BOTH are true. Note previousDesign === null
//    unconditionally sets flag = true (Empire.cs:3213-3216), so the very
//    first call for a sub-role (prefix empty, previousDesign null) always
//    takes this double-call path. Each getNewProperDesignName call itself
//    draws 1-50 (usually 1) `next(0, familyLength)` calls (see that
//    function's doc).
//  - Carrier: 0 draws.
//  - ResupplyShip/ConstructionShip/PassengerShip/ExplorationShip/ColonyShip:
//    1 draw (`next(0, arrayLength)` to pick the descriptive word), always.
//  - SmallFreighter/MediumFreighter/LargeFreighter/GasMiningShip/MiningShip:
//    1 draw for `next(1, 4)` (model-number increment), always; plus, only if
//    the prefix was empty, 2 more draws (generateDesignNamePrefix); plus,
//    only if `flag` is true, 2 draws for a fresh generateDesignNamePrefix and
//    1 draw for the name-array pick (so up to 1+2+2+1 = 6 total).
//  - All station/base sub-roles (ResortBase, WeaponsResearchStation,
//    EnergyResearchStation, HighTechResearchStation, MonitoringStation,
//    DefensiveBase, SmallSpacePort, MediumSpacePort, LargeSpacePort,
//    MiningStation, GasMiningStation, GenericBase): 0 draws.
export function generateDesignName(
    galaxy: Galaxy,
    state: DesignNameState,
    ctx: DesignNameContext,
    subRole: BuiltObjectSubRole,
    previousDesign: PreviousDesignForNaming | null,
): string {
    let text = '';
    let flag = false;
    if (previousDesign === null) {
        flag = true;
    } else {
        // Empire.cs:3219 Research.EvaluateDesiredComponent(Reactor, Balanced)
        // -- computed by the caller and passed in as
        // ctx.latestReactorComponentId (see DesignNameContext doc for the
        // null-handling deviation).
        const reactorComponentId = ctx.latestReactorComponentId;
        if (reactorComponentId !== null) {
            for (const component of previousDesign.components) {
                if (component.category === ComponentCategoryType.Reactor && component.componentId !== reactorComponentId) {
                    flag = true;
                    break;
                }
            }
        }
    }

    switch (subRole) {
        case BuiltObjectSubRole.Escort: {
            if (state.escortPrefix === '') {
                state.escortPrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.Escort);
            }
            state.escortCurrentModelNumber++;
            if (flag) {
                state.escortPrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.Escort);
                state.escortCurrentModelNumber = 1;
            }
            text = state.escortPrefix;
            if (state.escortCurrentModelNumber > 1) {
                text = text + ' ' + romanNumeral(state.escortCurrentModelNumber);
            }
            break;
        }
        case BuiltObjectSubRole.Frigate: {
            if (state.frigatePrefix === '') {
                state.frigatePrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.Frigate);
            }
            state.frigateCurrentModelNumber++;
            if (flag) {
                state.frigatePrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.Frigate);
                state.frigateCurrentModelNumber = 1;
            }
            text = state.frigatePrefix;
            if (state.frigateCurrentModelNumber > 1) {
                text = text + ' ' + romanNumeral(state.frigateCurrentModelNumber);
            }
            break;
        }
        case BuiltObjectSubRole.Destroyer: {
            if (state.destroyerPrefix === '') {
                state.destroyerPrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.Destroyer);
            }
            state.destroyerCurrentModelNumber++;
            if (flag) {
                state.destroyerPrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.Destroyer);
                state.destroyerCurrentModelNumber = 1;
            }
            text = state.destroyerPrefix;
            if (state.destroyerCurrentModelNumber > 1) {
                text = text + ' ' + romanNumeral(state.destroyerCurrentModelNumber);
            }
            break;
        }
        case BuiltObjectSubRole.Cruiser: {
            if (state.cruiserPrefix === '') {
                state.cruiserPrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.Cruiser);
            }
            state.cruiserCurrentModelNumber++;
            if (flag) {
                state.cruiserPrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.Cruiser);
                state.cruiserCurrentModelNumber = 1;
            }
            text = state.cruiserPrefix;
            if (state.cruiserCurrentModelNumber > 1) {
                text = text + ' ' + romanNumeral(state.cruiserCurrentModelNumber);
            }
            break;
        }
        case BuiltObjectSubRole.CapitalShip: {
            if (state.capitalShipPrefix === '') {
                state.capitalShipPrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.CapitalShip);
            }
            state.capitalShipCurrentModelNumber++;
            if (flag) {
                state.capitalShipPrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.CapitalShip);
                state.capitalShipCurrentModelNumber = 1;
            }
            text = state.capitalShipPrefix;
            if (state.capitalShipCurrentModelNumber > 1) {
                text = text + ' ' + romanNumeral(state.capitalShipCurrentModelNumber);
            }
            break;
        }
        case BuiltObjectSubRole.TroopTransport: {
            if (state.troopTransportPrefix === '') {
                state.troopTransportPrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.TroopTransport);
            }
            state.troopTransportCurrentModelNumber++;
            if (flag) {
                state.troopTransportPrefix = getNewProperDesignName(galaxy, state, ctx, BuiltObjectSubRole.TroopTransport);
                state.troopTransportCurrentModelNumber = 1;
            }
            text = state.troopTransportPrefix;
            if (state.troopTransportCurrentModelNumber > 1) {
                text = text + ' ' + romanNumeral(state.troopTransportCurrentModelNumber);
            }
            break;
        }
        case BuiltObjectSubRole.Carrier: {
            state.carrierCurrentModelNumber++;
            text = 'CX-' + state.carrierCurrentModelNumber + ' ' + 'Carrier'; // TextResolver.GetText("Ship SubRole Carrier")
            break;
        }
        case BuiltObjectSubRole.ResupplyShip: {
            const picked = RESUPPLY_SHIP_NAMES[galaxy.rnd.next(0, RESUPPLY_SHIP_NAMES.length)];
            state.resupplyShipCurrentModelNumber++;
            text = 'RS-' + state.resupplyShipCurrentModelNumber + ' ' + picked;
            break;
        }
        case BuiltObjectSubRole.SmallFreighter: {
            if (state.smallFreighterPrefix === '') {
                state.smallFreighterPrefix = generateDesignNamePrefix(galaxy);
            }
            const num = galaxy.rnd.next(1, 4);
            state.smallFreighterCurrentModelNumber += num * 100;
            if (flag) {
                state.smallFreighterPrefix = generateDesignNamePrefix(galaxy);
                state.smallFreighterName = SMALL_FREIGHTER_NAMES[galaxy.rnd.next(0, SMALL_FREIGHTER_NAMES.length)];
                state.smallFreighterCurrentModelNumber = 1000;
            }
            text = state.smallFreighterPrefix + state.smallFreighterCurrentModelNumber + ' ' + state.smallFreighterName;
            break;
        }
        case BuiltObjectSubRole.MediumFreighter: {
            if (state.mediumFreighterPrefix === '') {
                state.mediumFreighterPrefix = generateDesignNamePrefix(galaxy);
            }
            const num = galaxy.rnd.next(1, 4);
            state.mediumFreighterCurrentModelNumber += num * 100;
            if (flag) {
                state.mediumFreighterPrefix = generateDesignNamePrefix(galaxy);
                state.mediumFreighterName = MEDIUM_FREIGHTER_NAMES[galaxy.rnd.next(0, MEDIUM_FREIGHTER_NAMES.length)];
                state.mediumFreighterCurrentModelNumber = 1000;
            }
            text = state.mediumFreighterPrefix + state.mediumFreighterCurrentModelNumber + ' ' + state.mediumFreighterName;
            break;
        }
        case BuiltObjectSubRole.LargeFreighter: {
            if (state.largeFreighterPrefix === '') {
                state.largeFreighterPrefix = generateDesignNamePrefix(galaxy);
            }
            const num = galaxy.rnd.next(1, 4);
            state.largeFreighterCurrentModelNumber += num * 100;
            if (flag) {
                state.largeFreighterPrefix = generateDesignNamePrefix(galaxy);
                state.largeFreighterName = LARGE_FREIGHTER_NAMES[galaxy.rnd.next(0, LARGE_FREIGHTER_NAMES.length)];
                state.largeFreighterCurrentModelNumber = 1000;
            }
            text = state.largeFreighterPrefix + state.largeFreighterCurrentModelNumber + ' ' + state.largeFreighterName;
            break;
        }
        case BuiltObjectSubRole.GasMiningShip: {
            if (state.gasMiningShipPrefix === '') {
                state.gasMiningShipPrefix = generateDesignNamePrefix(galaxy);
            }
            const num = galaxy.rnd.next(1, 4);
            state.gasMiningShipCurrentModelNumber += num * 100;
            if (flag) {
                state.gasMiningShipPrefix = generateDesignNamePrefix(galaxy);
                state.gasMiningShipName = GAS_MINING_SHIP_NAMES[galaxy.rnd.next(0, GAS_MINING_SHIP_NAMES.length)];
                state.gasMiningShipCurrentModelNumber = 1000;
            }
            text = state.gasMiningShipPrefix + state.gasMiningShipCurrentModelNumber + ' ' + state.gasMiningShipName;
            break;
        }
        case BuiltObjectSubRole.MiningShip: {
            if (state.miningShipPrefix === '') {
                state.miningShipPrefix = generateDesignNamePrefix(galaxy);
            }
            const num = galaxy.rnd.next(1, 4);
            state.miningShipCurrentModelNumber += num * 100;
            if (flag) {
                state.miningShipPrefix = generateDesignNamePrefix(galaxy);
                state.miningShipName = MINING_SHIP_NAMES[galaxy.rnd.next(0, MINING_SHIP_NAMES.length)];
                state.miningShipCurrentModelNumber = 1000;
            }
            text = state.miningShipPrefix + state.miningShipCurrentModelNumber + ' ' + state.miningShipName;
            break;
        }
        case BuiltObjectSubRole.ResortBase: {
            state.resortBaseCurrentModelNumber++;
            text = 'RB-' + state.resortBaseCurrentModelNumber;
            break;
        }
        case BuiltObjectSubRole.WeaponsResearchStation: {
            state.weaponsResearchStationCurrentModelNumber++;
            text = 'WRS-' + state.weaponsResearchStationCurrentModelNumber;
            break;
        }
        case BuiltObjectSubRole.EnergyResearchStation: {
            state.energyResearchStationCurrentModelNumber++;
            text = 'ERS-' + state.energyResearchStationCurrentModelNumber;
            break;
        }
        case BuiltObjectSubRole.HighTechResearchStation: {
            state.highTechResearchStationCurrentModelNumber++;
            text = 'HTRS-' + state.highTechResearchStationCurrentModelNumber;
            break;
        }
        case BuiltObjectSubRole.MonitoringStation: {
            state.monitoringStationCurrentModelNumber++;
            text = 'MON-' + state.monitoringStationCurrentModelNumber;
            break;
        }
        case BuiltObjectSubRole.DefensiveBase: {
            state.defensiveBaseCurrentModelNumber++;
            text = 'DFB-' + state.defensiveBaseCurrentModelNumber;
            break;
        }
        case BuiltObjectSubRole.SmallSpacePort: {
            state.smallSpacePortCurrentModelNumber++;
            text = 'SSP-' + state.smallSpacePortCurrentModelNumber;
            break;
        }
        case BuiltObjectSubRole.MediumSpacePort: {
            state.mediumSpacePortCurrentModelNumber++;
            text = 'MSP-' + state.mediumSpacePortCurrentModelNumber;
            break;
        }
        case BuiltObjectSubRole.LargeSpacePort: {
            state.largeSpacePortCurrentModelNumber++;
            text = 'LSP-' + state.largeSpacePortCurrentModelNumber;
            break;
        }
        case BuiltObjectSubRole.MiningStation: {
            state.miningStationCurrentModelNumber++;
            text = 'MS-' + state.miningStationCurrentModelNumber;
            break;
        }
        case BuiltObjectSubRole.GasMiningStation: {
            state.gasMiningStationCurrentModelNumber++;
            text = 'GMS-' + state.gasMiningStationCurrentModelNumber;
            break;
        }
        case BuiltObjectSubRole.ConstructionShip: {
            const picked = CONSTRUCTION_SHIP_NAMES[galaxy.rnd.next(0, CONSTRUCTION_SHIP_NAMES.length)];
            state.constructionShipCurrentModelNumber++;
            text = 'CST-' + state.constructionShipCurrentModelNumber + ' ' + picked;
            break;
        }
        case BuiltObjectSubRole.PassengerShip: {
            const picked = PASSENGER_SHIP_NAMES[galaxy.rnd.next(0, PASSENGER_SHIP_NAMES.length)];
            state.passengerShipCurrentModelNumber++;
            text = 'PS-' + state.passengerShipCurrentModelNumber + ' ' + picked;
            break;
        }
        case BuiltObjectSubRole.ExplorationShip: {
            const picked = EXPLORATION_SHIP_NAMES[galaxy.rnd.next(0, EXPLORATION_SHIP_NAMES.length)];
            state.explorationShipCurrentModelNumber++;
            text = 'EX-' + state.explorationShipCurrentModelNumber + ' ' + picked;
            break;
        }
        case BuiltObjectSubRole.ColonyShip: {
            const picked = COLONY_SHIP_NAMES[galaxy.rnd.next(0, COLONY_SHIP_NAMES.length)];
            state.colonyShipCurrentModelNumber++;
            text = 'CLN-' + state.colonyShipCurrentModelNumber + ' ' + picked;
            break;
        }
        case BuiltObjectSubRole.GenericBase: {
            text = 'Generic Base'; // TextResolver.GetText("Ship SubRole GenericBase")
            break;
        }
        default:
            break;
    }
    return text;
}
