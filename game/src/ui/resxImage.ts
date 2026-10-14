// Images embedded in the original's WinForms resources (DistantWorlds/Main.resx), read at runtime from the user's
// install through /assets/dwu/ (CLAUDE.md "Art": never copied into the repo). A resx bitmap is a base64 BinaryFormatter
// blob of System.Drawing.Bitmap whose payload is the PNG file; the PNG is cut out of it by its signature and IEND chunk.
// Used for pictures the original draws from its resources rather than from images/ (e.g. picExpansionPlannerImage,
// and Start.resx's new-game pictures: the Playstyle buttons, the timeline and the page images).

const RESX_DIR = '/assets/dwu/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds/';
/** URL of the decompiled Main.resx inside the install (the Customization tree ships with the decompiled source). */
export const MAIN_RESX_URL = `${RESX_DIR}Main.resx`;
/** URL of the decompiled Start.resx (the start screens: main menu, new game, options). */
export const START_RESX_URL = `${RESX_DIR}Start.resx`;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The base64 `<value>` of `<data name="…">` in a resx document, whitespace removed; null when absent. */
export function resxDataBase64(resx: string, name: string): string | null {
    const at = resx.indexOf(`<data name="${name}"`);
    if (at < 0) return null;
    const v0 = resx.indexOf('<value>', at);
    const end = resx.indexOf('</data>', at);
    if (v0 < 0 || (end >= 0 && v0 > end)) return null;
    const v1 = resx.indexOf('</value>', v0);
    if (v1 < 0) return null;
    return resx.slice(v0 + 7, v1).replace(/\s+/g, '');
}

/** The PNG file inside a BinaryFormatter Bitmap blob (from the signature through the IEND chunk); null when none. */
export function pngFromBlob(bytes: Uint8Array): Uint8Array | null {
    let start = -1;
    outer: for (let i = 0; i + PNG_SIGNATURE.length <= bytes.length; i++) {
        for (let k = 0; k < PNG_SIGNATURE.length; k++) if (bytes[i + k] !== PNG_SIGNATURE[k]) continue outer;
        start = i;
        break;
    }
    if (start < 0) return null;
    // Walk the chunks (4-byte big-endian length, 4-byte type, data, 4-byte CRC) to IEND.
    let p = start + 8;
    while (p + 8 <= bytes.length) {
        const len = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
        const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
        p += 12 + len;
        if (type === 'IEND') return p <= bytes.length ? bytes.slice(start, p) : null;
    }
    return null;
}

function decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** The resx pictures the UI uses, bundled under public/art/original-resx/<main|start>/<name>.png (unmodified copies,
 *  scripts/extract-resx-art.mjs; original art used with the publisher's permission): stock installs have no decompiled
 *  Main.resx / Start.resx, so without these the wizard's Playstyle buttons and page pictures, the game menu header, the
 *  system-map zoom buttons and the expansion planner picture were missing on every player's PC. */
export const BUNDLED_RESX_IMAGES: Record<'main' | 'start', readonly string[]> = {
    main: ['btnZoomSelection.Image', 'btnZoomIn.Image', 'btnZoomOut.Image', 'btnZoomColony.Image', 'btnZoomSystem.Image', 'btnZoomSector.Image', 'btnZoomRegion.Image', 'picGameMenuHeader.BackgroundImage', 'picExpansionPlannerImage.Image'],
    start: [
        'btnStartNewGameYourEmpireTypeTheAncientGalaxy.Image',
        'btnStartNewGameYourEmpireTypePirateShadows.Image',
        'btnStartNewGameYourEmpireTypeNormalShadows.Image',
        'btnStartNewGameYourEmpireTypeClassicEra.Image',
        'btnStartNewGameYourEmpireTypeReturnOfTheShakturi.Image',
        'btnStartNewGameYourEmpireTypeLegends.Image',
        'btnStartNewGameYourEmpireTypeNormalClassic.Image',
        'btnStartNewGameYourEmpireTypePirateClassic.Image',
        'picStartNewGameYourEmpireTypeTimeline.Image',
        'picStartNewGameOtherEmpiresImageBottom.Image',
        'picStartNewGameYourRaceImage.Image',
        'picStartNewGameYourEmpireImage.Image',
        'picStartNewGameVictoryConditionsImage.Image',
    ],
};

/** The bundled copy's URL of resource `name` of `resxUrl`, or null when it is not bundled. */
export function bundledResxImageUrl(resxUrl: string, name: string): string | null {
    const file = resxUrl === MAIN_RESX_URL ? 'main' : resxUrl === START_RESX_URL ? 'start' : null;
    return file !== null && BUNDLED_RESX_IMAGES[file].includes(name) ? `/art/original-resx/${file}/${name}.png` : null;
}

const resxTexts = new Map<string, Promise<string | null>>();
const urls = new Map<string, Promise<string | null>>();

/** An object URL of the PNG resource `name` of Main.resx (e.g. 'picExpansionPlannerImage.Image'); null when the
 *  install has no decompiled source or the entry is missing. Cached. */
export function mainResxImageUrl(name: string): Promise<string | null> {
    return resxImageUrl(MAIN_RESX_URL, name);
}

/** The same for a resource of Start.resx (e.g. 'picStartNewGameYourEmpireTypeTimeline.Image'). */
export function startResxImageUrl(name: string): Promise<string | null> {
    return resxImageUrl(START_RESX_URL, name);
}

/** An object URL of the PNG resource `name` of the resx document at `resxUrl`; null when absent. Cached per file. */
export function resxImageUrl(resxUrl: string, name: string): Promise<string | null> {
    const key = `${resxUrl}#${name}`;
    let u = urls.get(key);
    const bundled = bundledResxImageUrl(resxUrl, name);
    if (u === undefined && bundled !== null) {
        // The bundled copy when the build has it (a PNG, not the dev server's SPA fallback), else the install's resx.
        u = fetch(bundled)
            .then((r) => (r.ok && (r.headers.get('content-type') ?? '').startsWith('image/') ? bundled : null))
            .catch(() => null)
            .then((b) => b ?? fromResx(resxUrl, name));
        urls.set(key, u);
    }
    if (u === undefined) {
        u = fromResx(resxUrl, name);
        urls.set(key, u);
    }
    return u;
}

function fromResx(resxUrl: string, name: string): Promise<string | null> {
    let resxText = resxTexts.get(resxUrl);
    if (resxText === undefined) {
        // The dev server answers a missing file with its SPA index.html: only a resx document counts.
        resxText = fetch(resxUrl)
            .then((r) => (r.ok ? r.text() : null))
            .then((t) => (t !== null && t.includes('<data name=') ? t : null))
            .catch(() => null);
        resxTexts.set(resxUrl, resxText);
    }
    return resxText.then((t) => {
        if (t === null) return null;
        const b64 = resxDataBase64(t, name);
        if (b64 === null) return null;
        const png = pngFromBlob(decodeBase64(b64));
        return png === null ? null : URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
    });
}
