// Resources a scenario adds for its own use (resources.txt overlay records with no distributions: never placed on a
// planet). Not a port. galaxy.ts generateRandomOrderedResources leaves them out of its shuffle so galaxy generation
// draws the same as without them (Colony Economy's refined goods, docs/ECONOMY.md §5). Packages register the names at
// module load.

// `var` + lazy creation: packages register at module load, possibly inside an import cycle through galaxy.ts.
// eslint-disable-next-line no-var
var names: Set<string> | undefined;

export function registerScenarioGoods(list: readonly string[]): void {
    names ??= new Set<string>();
    for (const n of list) names.add(n);
}

/** True for a registered scenario good. */
export function isScenarioGood(name: string): boolean {
    return names !== undefined && names.has(name);
}

/** How many goods are registered (0: the stock path). */
export function scenarioGoodCount(): number {
    return names?.size ?? 0;
}

// Contraband (The Voidbloom War): goods kept out of the stock cheapest-first luxury ordering (Empire.4.cs 3186 loop);
// they have their own order slot (extraLuxuryOrders). Inert unless such a good is in the galaxy's data.
// eslint-disable-next-line no-var
var contraband: Set<string> | undefined;

export function registerContraband(list: readonly string[]): void {
    contraband ??= new Set<string>();
    for (const n of list) contraband.add(n);
}

export function isContraband(name: string): boolean {
    return contraband !== undefined && contraband.has(name);
}

export function contrabandCount(): number {
    return contraband?.size ?? 0;
}
