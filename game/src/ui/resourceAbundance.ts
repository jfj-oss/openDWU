// Port of InfoPanel.cs:3220 / HoverPanel.cs:372 — HabitatResource.Abundance is stored on a 0..1000 scale
// (Galaxy.4.cs: AbundanceMin/Max * 1000) and shown as ((double)Abundance / 1000.0).ToString("0%").
export function abundancePercentText(abundance: number): string {
    return `${Math.round(abundance / 10)}%`;
}
