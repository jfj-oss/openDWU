// The running game's Galaxy Backdrop choice (render-only view setting; never sim state).
//
// Picked in the new-game wizard ("Galaxy Backdrop" row) and changeable mid-game in Game Options → Advanced Display
// Settings. A save carries it beside the game (GameSaveJSON.galaxyBackdrop, written only when it is not Original, so a
// default save is byte-identical); a save without it — every older save — loads as Original. The Main View listens
// for changes. Every kind but Original is a recipe over the install's own image (deepBackdrop.ts DEEP_RECIPES).

export type GalaxyBackdropKind = 'original' | 'dimmedOriginal' | 'deep' | 'deepAzure' | 'deepEmber' | 'deepViolet';

/** Picker order and labels. Original = the install's galaxy_backdrop.jpg (the default, unchanged). */
export const GALAXY_BACKDROP_OPTIONS: readonly { kind: GalaxyBackdropKind; label: string; description: string }[] = [
    { kind: 'original', label: 'Original', description: 'The original galaxy backdrop image.' },
    { kind: 'dimmedOriginal', label: 'Dimmed Original', description: 'The original image with its own colours, darkened halfway toward Deep, with faint grey dust.' },
    { kind: 'deep', label: 'Deep (DW2-style)', description: 'The original image darkened to near-black, with soft dark rust, brown and teal dust clouds over it.' },
    { kind: 'deepAzure', label: 'Deep Azure', description: 'The original image darkened to near-black, with cold navy and steel-blue dust clouds and teal accents.' },
    { kind: 'deepEmber', label: 'Deep Ember', description: 'The original image darkened to near-black, with dark crimson and ember dust clouds and the odd dull gold.' },
    { kind: 'deepViolet', label: 'Deep Violet', description: 'The original image darkened to near-black, with dark purple and magenta dust clouds and blue accents.' },
];

/** Kinds that were in the picker once (generated from the star layout; removed). Saves / settings with them load as Deep. */
const REMOVED_KINDS: readonly string[] = ['galacticCore', 'goldenSpiral', 'eerie', 'nebula'];

/** `v` as a backdrop kind (a removed kind = Deep; anything else unknown = Original). */
export function parseGalaxyBackdrop(v: unknown): GalaxyBackdropKind {
    if (GALAXY_BACKDROP_OPTIONS.some((o) => o.kind === v)) return v as GalaxyBackdropKind;
    return typeof v === 'string' && REMOVED_KINDS.includes(v) ? 'deep' : 'original';
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

/** Dev / screenshot hook: `?backdropTime=<s>` starts the backdrop animation clock there (e.g. at a glow). */
export function urlGalaxyBackdropTime(): number | null {
    const search = (globalThis as { location?: { search?: string } }).location?.search;
    if (typeof search !== 'string') return null;
    const v = Number(new URLSearchParams(search).get('backdropTime'));
    return Number.isFinite(v) && v > 0 ? v : null;
}

// The 2D galaxy maps (ui/screens/galaxyMapLayers.ts: the Galaxy Map screen, the mini maps) draw the chosen generated
// backdrop as a still picture: the Main View's static canvas of it (mainView.ts, deepBackdrop.ts), which registers
// itself here. No picture (Original, not built, the image could not be read) = the maps draw the Original image.

/** The galaxy facts a picture is matched on. */
export interface BackdropPictureGalaxy {
    randomSeed: number;
    sizeX: number;
    sizeY: number;
}

/** The picture, 'pending' while it is being drawn, or null when there will be none. */
export type BackdropPicture = CanvasImageSource | 'pending' | null;

type BackdropPictureSource = (kind: GalaxyBackdropKind, galaxy: BackdropPictureGalaxy) => BackdropPicture;

let pictureSource: BackdropPictureSource | null = null;
const pictureListeners = new Set<() => void>();

/** Register the Main View's picture source. Returns the unregister function. */
export function setGalaxyBackdropPictureSource(src: BackdropPictureSource): () => void {
    pictureSource = src;
    return () => {
        if (pictureSource === src) pictureSource = null;
    };
}

/** The current generated backdrop as a still picture of `galaxy` (stretched over 0..sizeX × 0..sizeY), 'pending'
 *  while the Main View is still drawing it, or null (Original, no generated backdrop for this galaxy). */
export function galaxyBackdropPicture(galaxy: BackdropPictureGalaxy): BackdropPicture {
    if (current === 'original' || pictureSource === null) return null;
    try {
        return pictureSource(current, galaxy);
    } catch (err) {
        console.warn('galaxy backdrop: no picture for the maps', err);
        return null;
    }
}

/** Called after a new picture becomes available (the static texture finished); returns the unsubscribe function. */
export function onGalaxyBackdropPictureReady(cb: () => void): () => void {
    pictureListeners.add(cb);
    return () => pictureListeners.delete(cb);
}

/** The picture source has a new picture (mainView.ts). */
export function notifyGalaxyBackdropPictureReady(): void {
    for (const cb of [...pictureListeners]) cb();
}
