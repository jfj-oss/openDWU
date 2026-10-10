// The running game's Galaxy Backdrop choice (render-only view setting; never sim state).
//
// Picked in the new-game wizard ("Galaxy Backdrop" row) and changeable mid-game in Game Options → Advanced Display
// Settings. A save carries it beside the game (GameSaveJSON.galaxyBackdrop, written only when it is not Original, so a
// default save is byte-identical); a save without it — every older save — loads as Original. The Main View listens
// for changes (galaxyBackdrop.ts rebuilds its layer).

export type GalaxyBackdropKind = 'original' | 'galacticCore' | 'eerie' | 'nebula';

/** Picker order and labels. Original = the install's galaxy_backdrop.jpg (the default, unchanged). */
export const GALAXY_BACKDROP_OPTIONS: readonly { kind: GalaxyBackdropKind; label: string; description: string }[] = [
    { kind: 'original', label: 'Original', description: 'The original galaxy backdrop image.' },
    { kind: 'galacticCore', label: 'Galactic Core', description: 'A bright, slowly turning core that follows the shape of the galaxy.' },
    { kind: 'eerie', label: 'Eerie', description: 'Near-black, cold and still, with drifting fog and the odd faint pulse.' },
    { kind: 'nebula', label: 'Nebula', description: 'Churning dark green and purple gas, densest along the arms.' },
];

/** `v` as a backdrop kind (anything unknown = Original). */
export function parseGalaxyBackdrop(v: unknown): GalaxyBackdropKind {
    return GALAXY_BACKDROP_OPTIONS.some((o) => o.kind === v) ? (v as GalaxyBackdropKind) : 'original';
}

let current: GalaxyBackdropKind = 'original';
const listeners = new Set<(kind: GalaxyBackdropKind) => void>();

export function getGalaxyBackdrop(): GalaxyBackdropKind {
    return current;
}

/** Set the running game's backdrop (the wizard at start, a load from the save, Game Options mid-game). */
export function setGalaxyBackdrop(kind: GalaxyBackdropKind): void {
    if (kind === current) return;
    current = kind;
    for (const cb of [...listeners]) cb(kind);
}

/** Called after every change; returns the unsubscribe function. */
export function onGalaxyBackdropChange(cb: (kind: GalaxyBackdropKind) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

/** What a save of the running game carries for the backdrop: nothing for Original (old-format identical). */
export function galaxyBackdropSaveExtras(): { galaxyBackdrop?: string } {
    return current === 'original' ? {} : { galaxyBackdrop: current };
}

/** Dev / screenshot hook: `?backdrop=<kind>` in the page URL, or null. */
export function urlGalaxyBackdrop(): GalaxyBackdropKind | null {
    const search = (globalThis as { location?: { search?: string } }).location?.search;
    if (typeof search !== 'string') return null;
    const v = new URLSearchParams(search).get('backdrop');
    return v === null ? null : parseGalaxyBackdrop(v);
}

/** Dev / screenshot hook: `?backdropTime=<s>` starts the backdrop animation clock there (e.g. at a storm flash). */
export function urlGalaxyBackdropTime(): number | null {
    const search = (globalThis as { location?: { search?: string } }).location?.search;
    if (typeof search !== 'string') return null;
    const v = Number(new URLSearchParams(search).get('backdropTime'));
    return Number.isFinite(v) && v > 0 ? v : null;
}
