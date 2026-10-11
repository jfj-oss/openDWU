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
