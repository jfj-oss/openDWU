// URL resolution for original DW:U data files served from /assets/dwu/.
// No Node/DOM APIs here — pure string building.
import { activeCustomizationSet } from './customization';

// Port of Galaxy.cs LoadRaceBiases (~1967-1978) / InitializeRaceFamilyBiases
// (~2114-2126) path-resolution pattern: the game first looks in
// "<applicationStartupPath>\Customization\<customizationSetName>\<file>"
// (if a non-"default" customization set is active) and falls back to
// "<applicationStartupPath>\<file>" if that customized file doesn't exist.
// Here "applicationStartupPath" is served at "/assets/dwu/".
//
// Returns the candidate URLs in try-order (customized first, base last);
// the caller (fetchData.ts) tries each until one succeeds.
export function resolveDataUrl(file: string, customizationSet?: string): string[] {
    const candidates: string[] = [];
    if (customizationSet && customizationSet.trim() !== '' && customizationSet.trim().toLowerCase() !== 'default') {
        candidates.push(`/assets/dwu/Customization/${customizationSet}/${file}`);
    }
    candidates.push(`/assets/dwu/${file}`);
    return candidates;
}

/**
 * resolveDataUrl for the active theme (sim/data/customization.ts): the theme's copy of `file` when it has one
 * (File.Exists, case-insensitive), else the stock file — the Galaxy.3.cs Initialize* rule. Stock game: the stock file.
 */
export function resolveThemedDataUrl(file: string): string[] {
    const custom = activeCustomizationSet()?.fileUrl(file) ?? null;
    return custom !== null ? [custom] : resolveDataUrl(file);
}

/**
 * Galaxy.4.cs LoadRaces (1176): the race files to read and their URLs — the active theme's races\ folder when it
 * exists (it REPLACES the stock folder), else the stock listing `stockFiles`.
 */
export function themedRaceFiles(stockFiles: readonly string[]): { files: string[]; url: (file: string) => string[] } {
    const set = activeCustomizationSet();
    if (set !== null && set.dirExists('races')) return { files: set.listFiles('races', '.txt'), url: (f) => [set.listedFileUrl('races', f)] };
    return { files: [...stockFiles], url: (f) => resolveDataUrl(`races/${f}`) };
}
