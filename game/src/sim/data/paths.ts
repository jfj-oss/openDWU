// URL resolution for original DW:U data files served from /assets/dwu/.
// No Node/DOM APIs here — pure string building.

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
