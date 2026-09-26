// Port of DistantWorlds.Types/ShipImageHelper.cs — resolves a Design.PictureRef into the packed ship-picture index
// space that src/render/builtObjectLayer.ts (builtObjectImagePath) turns into an art file: indices 31-58 are the
// four "major sets" (Shakturi / ShakturiAllies / AncientHelpers / FreedomAlliance, k = 0..3 below), 59-63 are the
// FreedomAlliance "aged" variants, and 3-30 are the seven "minor set" families.
//
// _Rnd (ShipImageHelper.cs:15) is `private static Random _Rnd = new Random((int)DateTime.Now.Ticks)`: its OWN
// Random, separate from Galaxy.Rnd, and clock-seeded (so non-deterministic run to run in C#). To keep the TS sim
// deterministic given a seed, `shipImageClockRnd` below is instead a galaxy-seed-derived stream (the same "plan §0"
// convention as galaxy.baconRepairClockRnd / baconCombatClockRnd / etc. — see e.g. construction/repair.ts), lazily
// created on `galaxy.shipImageClockRnd`. Only the functions in this module may draw from it.
//
// IMPORTANT: several call sites in story code already draw `galaxy.rnd.next(0, N)` to pick a *family* (e.g. "family:
// AncientHelpers / ShakturiAllies") before calling resolveMajorShipImageIndex. Those are Galaxy.Rnd draws made by the
// CALLING C# code (Galaxy.3.cs / Galaxy.5.cs / Start.2.cs), not by ShipImageHelper — resolveMajorShipImageIndex itself
// never draws any Random. Do not touch those existing galaxy.rnd draws or route them through this module.

import type { Galaxy } from './galaxy';
import type { Race } from './data/races';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { resolveLegacySubRole } from './designGeneration';
import { raceDesignPictureFamilyIndexPirates } from './empire';
import { Random } from './random';

// ShipImageHelper.cs:17-23.
export const ShakturiFamily = 0;
export const ShakturiAlliesFamily = 1;
export const AncientHelpersFamily = 2;
export const FreedomAllianceFamily = 3;

// ShipImageHelper.cs:25 / :43.
const ShipSetImageCount = 24;
export const StandardShipImageStartIndex = 72;

// ShipImageHelper.cs:29-41.
const MinorFamilyCount = 7;
const MinorBaseCount = 2;
const MinorBaseStartIndex = 1;
const MinorShipStartIndex = 3;
const MajorShipStartIndex = 31;

/** ShipImageHelper.cs:15 `_Rnd`, galaxy-seeded (see module comment). */
function shipImageClockRnd(galaxy: Galaxy): Random {
    if (galaxy.shipImageClockRnd === null) galaxy.shipImageClockRnd = new Random((galaxy.randomSeed ^ 0x53687049) | 0);
    return galaxy.shipImageClockRnd;
}

// ShipImageHelper.cs:170 ResolveMajorFamilyIndex. No Rnd.
function resolveMajorFamilyIndex(majorFamily: number): number {
    return MajorShipStartIndex + majorFamily * 7;
}

// ShipImageHelper.cs:176 ResolveMinorFamilyIndex. No Rnd.
function resolveMinorFamilyIndex(minorFamily: number): number {
    return MinorShipStartIndex + minorFamily * 4;
}

/**
 * ShipImageHelper.cs:130 ResolveMajorShipImageIndex(family, subRole, aged). No Rnd (the "family" is always chosen
 * by the CALLER, drawing on Galaxy.Rnd when it is random — see the module comment).
 */
export function resolveMajorShipImageIndex(family: number, subRole: BuiltObjectSubRole, aged: boolean): number {
    let num2 = 0;
    switch (subRole) {
        case BuiltObjectSubRole.CapitalShip:
            num2 = 3;
            break;
        case BuiltObjectSubRole.Cruiser:
            num2 = 2;
            break;
        case BuiltObjectSubRole.Destroyer:
            num2 = 1;
            break;
        case BuiltObjectSubRole.Frigate:
            num2 = 0;
            break;
        case BuiltObjectSubRole.TroopTransport:
            num2 = 4;
            break;
        case BuiltObjectSubRole.SmallSpacePort:
        case BuiltObjectSubRole.MediumSpacePort:
            num2 = 6;
            break;
        case BuiltObjectSubRole.GasMiningStation:
        case BuiltObjectSubRole.MiningStation:
        case BuiltObjectSubRole.GenericBase:
            num2 = 5;
            break;
    }
    const num3 = aged && family === FreedomAllianceFamily ? 7 : 0;
    return resolveMajorFamilyIndex(family) + num2 + num3;
}

/**
 * ShipImageHelper.cs:187 ResolveMinorShipImageIndex(family, subRole, largeShips): the family-supplied overload. For
 * the base subroles it can itself draw shipImageClockRnd (Next(0, 2), and on 1 a Next(1, 3) major family instead —
 * ShipImageHelper.cs:197-205).
 */
export function resolveMinorShipImageIndexForFamily(galaxy: Galaxy, family: number, subRole: BuiltObjectSubRole, largeShips: boolean): number {
    let num = -1;
    let num2 = 0;
    switch (subRole) {
        case BuiltObjectSubRole.GasMiningStation:
        case BuiltObjectSubRole.MiningStation:
        case BuiltObjectSubRole.SmallSpacePort:
        case BuiltObjectSubRole.GenericBase:
            if (shipImageClockRnd(galaxy).next(0, 2) === 1) {
                const family2 = shipImageClockRnd(galaxy).next(1, 3);
                num = resolveMajorShipImageIndex(family2, subRole, false);
            } else {
                num = MinorBaseStartIndex + shipImageClockRnd(galaxy).next(0, MinorBaseCount);
            }
            break;
        case BuiltObjectSubRole.Escort:
            num2 = 0;
            break;
        case BuiltObjectSubRole.Frigate:
            num2 = 1;
            break;
        case BuiltObjectSubRole.Destroyer:
            num2 = largeShips ? 0 : 2;
            break;
        case BuiltObjectSubRole.Cruiser:
            num2 = 1;
            break;
        case BuiltObjectSubRole.CapitalShip:
            num2 = 2;
            break;
        case BuiltObjectSubRole.ColonyShip:
            num2 = 3;
            break;
    }
    if (num < 0) num = resolveMinorFamilyIndex(family) + num2;
    return num;
}

/**
 * ShipImageHelper.cs:182 ResolveMinorShipImageIndex(subRole, largeShips): the no-family overload — draws
 * shipImageClockRnd.Next(0, MinorFamilyCount) for the family, then the family-supplied overload above.
 */
export function resolveMinorShipImageIndex(galaxy: Galaxy, subRole: BuiltObjectSubRole, largeShips: boolean): number {
    return resolveMinorShipImageIndexForFamily(galaxy, shipImageClockRnd(galaxy).next(0, MinorFamilyCount), subRole, largeShips);
}

/**
 * ShipImageHelper.cs:80 ResolveNewShipImageIndex(shipSubRole, empireRace, isPirates). No Rnd. (player/designEditor.ts
 * has its own copy taking an Empire directly, for the design editor's player-only call site; this is the general
 * form the story/exploration call sites use.)
 */
export function resolveNewShipImageIndex(shipSubRole: BuiltObjectSubRole, empireRace: Race | null, isPirates: boolean): number {
    const resolvedSubRole = resolveLegacySubRole(shipSubRole);
    let num = 0;
    if (empireRace !== null) {
        num = empireRace.designsPictureFamilyIndex;
        if (isPirates) num = raceDesignPictureFamilyIndexPirates(empireRace);
    }
    return StandardShipImageStartIndex + num * ShipSetImageCount + (resolvedSubRole - 1);
}
