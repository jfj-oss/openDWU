// Pirate protection price display. The original shows only the monthly fee (Main.Part9.cs:604-618 "We accept your
// protection PER MONTH", Pirate Protection Description New "{0} credits per month"); the player also wants the yearly
// amount, so every place that names a protection price shows both (per month, and x12 per year).

import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import { formatThousands } from '../sim/diplomacyTick';
import { calculatePirateProtectionPricePerMonth } from '../sim/pirates/pirateRelationsAI';

/** Months in the year the price is multiplied by (the fee is charged monthly). */
export const MONTHS_PER_YEAR = 12;

/** The yearly amount of a monthly protection fee. */
export function pirateProtectionPricePerYear(perMonth: number): number {
    return perMonth * MONTHS_PER_YEAR;
}

/** "1,234 credits per month (14,808 per year)". */
export function pirateProtectionPriceText(perMonth: number): string {
    return `${formatThousands(perMonth)} credits per month (${formatThousands(pirateProtectionPricePerYear(perMonth))} per year)`;
}

/** " (14,808 per year)" for a priced option's label, '' for a free one. */
export function pirateProtectionYearlySuffix(perMonth: number): string {
    return perMonth > 0 ? ` (${formatThousands(pirateProtectionPricePerYear(perMonth))} per year)` : '';
}

/**
 * The monthly price a pirate offer asks of the player now: CalculatePirateProtectionPricePerMonth (Main.Part9.cs:2077 builds
 * the popup's ConversationOption from it) when the pirate already holds a PirateRelation with the player (so the calculation
 * writes nothing at render time), else the message's own `money` (which the offer senders do not always fill in — extortion
 * and the AI's own offers leave it 0).
 */
export function pirateOfferMonthlyPrice(galaxy: Galaxy | null, pirate: Empire | null, player: Empire, messageMoney: number): number {
    if (galaxy === null || pirate === null || pirate.pirateEmpireBaseHabitat == null) return messageMoney;
    if (pirate.pirateRelations?.getRelationByOtherEmpire(player) == null) return messageMoney;
    return calculatePirateProtectionPricePerMonth(galaxy, pirate, player).price;
}
