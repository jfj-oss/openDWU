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
import { calculateBuiltObjectLootingValue, empireColonyIncomeFactor, empireLootingFactor } from '../combat/damage';
import { applyCorruptionToIncome } from '../logistics/orders';

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


/**
 * Main.Part3.cs 403 btnBuiltObjectScrapSelected_Click (after the "Scrap selected ships and bases?" confirmation), in the
 * source's order per selected ship / base: take it off the slipway or out of the wait queue of its parent habitat's
 * yards; tear down every ship on its own slipways and in its own wait queue (CompleteTeardown(galaxy, true)) and clear
 * the queue; a pirate player is paid the looting value (× ColonyIncomeFactor × LootingFactor, after corruption,
 * booked as Looting income); then CompleteTeardown(galaxy). Returns how many were scrapped. The source scraps whatever
 * is selected; here only `empire`'s own (or its private) ships and bases, the only ones its lists can select.
 */
export function scrapBuiltObjects(galaxy: Galaxy, empire: Empire, ships: readonly (BuiltObject | null)[]): number {
    let n = 0;
    for (let i = 0; i < ships.length; i++) {
        const builtObject = ships[i];
        if (builtObject == null || builtObject.hasBeenDestroyed) continue;
        if (builtObject.empire !== empire && builtObject.actualEmpire !== empire) continue;
        const parentQueue = builtObject.parentHabitat !== null ? queueOf(builtObject.parentHabitat) : null;
        if (parentQueue !== null) {
            for (const constructionYard of parentQueue.constructionYards ?? []) {
                if (constructionYard != null && constructionYard.shipUnderConstruction === builtObject) constructionYard.shipUnderConstruction = null;
            }
            const wait = parentQueue.constructionWaitQueue;
            if (wait !== null) {
                const k = wait.indexOf(builtObject);
                if (k >= 0) wait.splice(k, 1);
            }
        }
        const ownQueue = queueOf(builtObject);
        if (ownQueue !== null) {
            for (const constructionYard2 of ownQueue.constructionYards ?? []) {
                if (constructionYard2 != null && constructionYard2.shipUnderConstruction !== null) {
                    builtObjectCompleteTeardown(galaxy, constructionYard2.shipUnderConstruction, true);
                    constructionYard2.shipUnderConstruction = null;
                }
            }
            const wait = ownQueue.constructionWaitQueue;
            if (wait !== null) {
                const builtObjectList = wait.slice();
                for (const item of builtObjectList) if (item != null) builtObjectCompleteTeardown(galaxy, item, true);
                wait.length = 0;
            }
        }
        if (empire.pirateEmpireBaseHabitat !== null) {
            let num2 = calculateBuiltObjectLootingValue(builtObject);
            num2 *= empireColonyIncomeFactor(empire);
            num2 *= empireLootingFactor(empire);
            num2 = applyCorruptionToIncome(empire, num2);
            empire.stateMoney += num2;
            empire.pirateEconomy.performIncome(num2, PirateIncomeType.Looting, galaxyStarDate(galaxy));
        }
        builtObjectCompleteTeardown(galaxy, builtObject);
        n++;
    }
    return n;
}
