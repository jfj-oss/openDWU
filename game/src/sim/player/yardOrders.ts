// The Construction Yards screen's orders (Ships and Bases panel, Construction Yards tab): build a design at one yard,
// remove a waiting ship from the queue, scrap a ship on a slipway. Ports of the original's button handlers; the
// player ops in playerOps.ts call these so they run at a frame boundary and are journaled. Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Design } from '../design';
import type { BuiltObject } from '../builtObject';
import { determineBuiltObjectIsState } from '../builtObject';
import type { Habitat } from '../types';
import type { ConstructionQueue } from '../construction/constructionQueue';
import { newBuiltObjectShouldBeAutomated, purchaseNewBuiltObject } from '../construction/empireConstruction';
import { builtObjectCompleteTeardown } from '../combat/teardown';
import { PirateIncomeType } from '../pirates/pirateEconomy';
import { galaxyStarDate } from '../tick/simTime';

function queueOf(site: BuiltObject | Habitat): ConstructionQueue | null {
    return (site.constructionQueue as ConstructionQueue | null) ?? null;
}

/**
 * ConstructionYardPurchaser.cs btnPurchase_Click (after the automation prompt, which the UI shows): when affordable,
 * Empire.PurchaseNewBuiltObject(design, yard, DetermineBuiltObjectIsState(subRole), NewBuiltObjectShouldBeAutomated(subRole)).
 * Returns the queued ship, or null (unaffordable / refused by the yard).
 */
export function purchaseAtYard(galaxy: Galaxy, empire: Empire, design: Design, site: BuiltObject | Habitat): BuiltObject | null {
    if (queueOf(site) === null) return null;
    if (design.calculateCurrentPurchasePrice(galaxy) > empire.stateMoney) return null;
    const isAutoControlled = newBuiltObjectShouldBeAutomated(empire, design.subRole);
    const isState = determineBuiltObjectIsState(design.subRole);
    return purchaseNewBuiltObject(galaxy, empire, design, site, isState, isAutoControlled);
}

/**
 * Main.Part4.cs 2199 btnBuiltObjectConstructionRemoveFromQueue_Click (after the confirmation): refund half the purchase
 * price (and book it as pirate income), take the ship out of the site's queue, then either cancel its retrofit or tear
 * the unbuilt ship down. A ship with no owner (private / foreign) cannot be removed.
 */
export function removeFromYardQueue(galaxy: Galaxy, site: BuiltObject | Habitat, ship: BuiltObject): boolean {
    const q = queueOf(site);
    if (q === null || ship.owner === null) return false;
    if (!(q.constructionWaitQueue ?? []).includes(ship)) return false;
    const num = ship.purchasePrice * 0.5;
    if (ship.empire !== null) {
        ship.empire.stateMoney += num;
        ship.empire.pirateEconomy.performIncome(num, PirateIncomeType.Undefined, galaxyStarDate(galaxy));
    }
    q.removeBuiltObject(ship);
    if (ship.retrofitDesign !== null) {
        ship.retrofitDesign = null;
        ship.retrofitForNextMission = false;
    } else {
        builtObjectCompleteTeardown(galaxy, ship);
    }
    return true;
}

/**
 * Main.Part4.cs 2168 btnBuiltObjectConstructionScrap_Click (after the confirmation): remove the ship on a slipway from
 * the queue (no refund) and tear it down. A ship with no owner cannot be scrapped.
 */
export function scrapShipUnderConstruction(galaxy: Galaxy, site: BuiltObject | Habitat, ship: BuiltObject): boolean {
    const q = queueOf(site);
    if (q === null || ship.owner === null) return false;
    if (!(q.constructionYards ?? []).some((y) => y !== null && y.shipUnderConstruction === ship)) return false;
    q.removeBuiltObject(ship);
    builtObjectCompleteTeardown(galaxy, ship);
    return true;
}

/** Main.Part11.cs hvhxxedjqS (the Name box of the Ships and Bases panel): rename the selected ship or base. Blank
 *  names are ignored. */
export function renameBuiltObject(ship: BuiltObject, name: string): boolean {
    const n = name.trim();
    if (n === '' || n === ship.name) return false;
    ship.name = n;
    return true;
}
