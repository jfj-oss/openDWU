// The texts of the pirate-base destruction bonus events (BuiltObject.2.cs 5022-5100 and the same block in Fighter.cs
// 979-1057): string.Format(TextResolver.GetText("Pirate Base Bonus …"), …), resolved now. Callers: damage.ts and
// fighters.ts (the bonus rolls for a base destroyed by a ship / by a fighter). No Rnd.
import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Race } from '../data/races';
import type { Empire } from '../empire';
import { formatGameTextNow } from '../textResolver';
import { formatNet0 } from '../netNumberFormat';
import { resolveSubRoleDescription } from '../designGeneration';
import { resolveSectorDescription } from '../empireEvents';

export interface PirateBaseBonusText {
    title: string;
    message: string;
}

/** BuiltObject.2.cs 5022-5024: the abandoned ship's sub-role (lower-cased), name, system and sector. */
export function pirateBaseBonusAbandonedShipText(galaxy: Galaxy, pirateBase: BuiltObject, builtObject: BuiltObject, system: Habitat): PirateBaseBonusText {
    const sector = resolveSectorDescription(galaxy, builtObject.xpos, builtObject.ypos);
    return {
        message: formatGameTextNow('Pirate Base Bonus Abandoned Ship', [pirateBase.name, resolveSubRoleDescription(builtObject.subRole).toLowerCase(), builtObject.name, system.name, sector]),
        title: formatGameTextNow('Lost Ship Location Revealed'),
    };
}

/** BuiltObject.2.cs 5042-5043: the treasure (num5.ToString("#0")). */
export function pirateBaseBonusMoneyText(pirateBase: BuiltObject, amount: number): PirateBaseBonusText {
    return { message: formatGameTextNow('Pirate Base Bonus Money', [pirateBase.name, formatNet0(amount)]), title: formatGameTextNow('Valuable Treasure Discovered') };
}

/** BuiltObject.2.cs 5071-5072: the base's faction joins the destroying empire. */
export function pirateBaseBonusFactionJoinsText(pirateBase: BuiltObject, faction: Empire): PirateBaseBonusText {
    return { message: formatGameTextNow('Pirate Base Bonus Targeted Faction Joins', [pirateBase.name, faction.name]), title: formatGameTextNow('Pirate Faction Joins Your Empire') };
}

/** BuiltObject.2.cs 5097-5100: an independent colony's race, system and sector. */
export function pirateBaseBonusExplorationText(galaxy: Galaxy, pirateBase: BuiltObject, colony: Habitat, race: Race): PirateBaseBonusText {
    const system = galaxy.determineHabitatSystemStar(colony);
    const sector = resolveSectorDescription(galaxy, colony.xpos, colony.ypos);
    return {
        message: formatGameTextNow('Pirate Base Bonus Exploration', [pirateBase.name, race.name, system.name, sector]),
        title: formatGameTextNow('Independent Colony of RACE', [race.name]),
    };
}
