// Expanded's "Clean Galaxy view" (GameOptions.CleanGalaxyView, chkGameOptionsGalaxyDisplayCleanGalaxyView in the
// Advanced Display Settings, Start.1.cs 2935 / 3001; default off). MainView.2.cs method_250 reads it once per galaxy
// pass (5072-5076: flag) and, while it is set, skips at f > 150:
//   - the sector grid and its A.. / 1.. labels (5155-5225);
//   - the system circles: each owned / independent system's ring (5395-5398) — the gas clouds' cross stays (5390) —
//     and the potential-colony dashed circles (5375);
//   - the system link lines (5237: `... && !flag && ...`);
//   - the system names with their plague / capital / refuel icons and the ruins glyph (5584: `flag26 && !flag`);
//   - the pirate influence marks (5400).
// TODO(port): the galaxy backdrop's baked territory (Main.Part12.cs 3238 ResetGalaxyBackdrops skips method_148) and the
// territory drawn while zooming (MainView.1.cs 3985 / MainView.2.cs 239: `bool_11 && !CleanGalaxyView`) — the port's
// territory is one layer at every zoom; the potential-colony circles and pirate influence marks of method_250 are not
// drawn by the port at all.

/** What method_250 draws, by the Clean Galaxy view option. */
export interface GalaxyViewGates {
    sectorGrid: boolean;
    /** Owned / independent system rings. */
    systemRings: boolean;
    /** The gas-cloud cross (5390-5394): drawn either way. */
    gasCloudCrosses: boolean;
    systemLinks: boolean;
    /** System names and their decorations (capital / refuel icons, ruins glyph). */
    systemNames: boolean;
}

/** method_250's gates for GameOptions.CleanGalaxyView. */
export function galaxyViewGates(cleanGalaxyView: boolean): GalaxyViewGates {
    const on = !cleanGalaxyView;
    return { sectorGrid: on, systemRings: on, gasCloudCrosses: true, systemLinks: on, systemNames: on };
}
