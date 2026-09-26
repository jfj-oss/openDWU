// 19d2 Resource crises — the player's fuel-crisis decision (tasks/19d2-resource-crises.md §5). Not a port; the two
// actions reuse ported pieces: the purchase adds cargo at the capital port at the current (crisis) price, the smuggling
// contract is built like the player's "offer smuggling mission" ship action (Main.Part7.cs 971-1019,
// player/executeShipAction.ts GeneratePirateMissionSmuggling).
//
// Replay note: scenario decisions are answered by answerScenarioDecision directly from the message popup
// (ui/messagePopups.ts); that path does not go through the player command queue (player/playerCommands.ts) yet — owned
// by another package. Resolutions here run inside answerScenarioDecision and draw no Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { ScenarioDecision, ScenarioDecisionOption } from '../decisions';
import { Cargo, ResourceRef } from '../../cargo';
import { galaxyResourceCurrentPrices } from '../../design';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../../galaxyTime';
import { OrderType } from '../../logistics/orders';
import { determineSpacePortAtHabitat } from '../../logistics/colonySupply';
import { EmpireActivity, EmpireActivityType } from '../../pirates/empireActivity';
import { calculatePirateSmugglePricePerUnit, createOrderWithExpiry } from '../../pirates/missionsMarket';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioText } from '../messages';

/** Cost of an emergency fuel purchase at the current galaxy price. Pure. */
export function emergencyFuelCost(galaxy: Galaxy, fuelId: number, amount: number): number {
    return amount * galaxyResourceCurrentPrices(galaxy)[fuelId];
}

/**
 * The decision's options. The mod layer's decision options carry no enabled flag, so "Emergency purchase" is left out
 * when the treasury cannot pay (the spec's "disabled without money").
 */
export function fuelDecisionOptions(galaxy: Galaxy, e: Empire, fuelId: number, amount: number): ScenarioDecisionOption[] {
    const out: ScenarioDecisionOption[] = [];
    const cost = emergencyFuelCost(galaxy, fuelId, amount);
    if (amount > 0 && e.capital !== null && e.stateMoney >= cost) out.push({ id: 'buy', label: scenarioText('Emergent Fuel Option Buy COST', Math.round(cost)) });
    if (e.capital !== null) out.push({ id: 'smuggle', label: scenarioText('Emergent Fuel Option Smuggle') });
    out.push({ id: 'wait', label: scenarioText('Emergent Fuel Option Wait') });
    return out;
}

/** "Emergency purchase": state money → fuel cargo at the capital (its space port if it has one). */
export function emergencyFuelPurchase(galaxy: Galaxy, e: Empire, fuelId: number, amount: number): boolean {
    const capital = e.capital;
    if (capital === null || amount <= 0) return false;
    const cost = emergencyFuelCost(galaxy, fuelId, amount);
    if (!(e.stateMoney >= cost)) return false;
    const port = determineSpacePortAtHabitat(capital);
    const cargo = port !== null && port.cargo !== null ? port.cargo : capital.cargo;
    if (cargo === null) return false;
    e.stateMoney -= cost;
    cargo.add(new Cargo(new ResourceRef(fuelId), amount, e));
    return true;
}

/** "Offer smuggling contracts": a Smuggle EmpireActivity for the fuel at the capital (the player ship-action path). */
export function offerFuelSmuggling(galaxy: Galaxy, e: Empire, fuelId: number): boolean {
    const habitat = e.capital;
    if (habitat === null || habitat.empire === null) return false;
    const price = calculatePirateSmugglePricePerUnit(galaxy, e, habitat, fuelId);
    const expiryDate = galaxyStarDate(galaxy) + Math.trunc(3.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    const activity = new EmpireActivity(habitat.empire, e, expiryDate, EmpireActivityType.Smuggle, habitat, price);
    activity.resourceId = fuelId & 0xff;
    if (e.pirateMissions.containsEquivalent(activity)) return false;
    activity.relatedOrder = createOrderWithExpiry(galaxy, habitat, fuelId, 10000, true, OrderType.Standard, expiryDate);
    e.pirateMissions.add(activity);
    if (!galaxy.pirateMissions.containsEquivalent(activity)) galaxy.pirateMissions.add(activity);
    return true;
}

/** Resolves a `crises.fuel` decision. */
export function resolveFuelDecision(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const fuelId = d.context.fuelId as number;
    const amount = d.context.amount as number;
    if (optionId === 'buy') emergencyFuelPurchase(galaxy, d.empire, fuelId, amount);
    else if (optionId === 'smuggle') offerFuelSmuggling(galaxy, d.empire, fuelId);
}
