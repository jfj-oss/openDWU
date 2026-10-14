// Galaxy Backdrop picker thumbnails (new-game wizard, Game Options). UI-only.
//
// Original shows the install's galaxy_backdrop.jpg. The other kinds are Deep recipes over that same image
// (render/deepBackdrop.ts), built small from the loaded image (seeded like the game, so the dust matches) and cached.

import { BACKDROP_URLS } from '../render/assets';
import { buildDeepBackdrop, DEEP_RECIPES, isDeepKind } from '../render/deepBackdrop';
import type { GalaxyBackdropKind } from '../render/galaxyBackdropChoice';

const cache = new Map<string, HTMLCanvasElement>();
let source: HTMLImageElement | null = null;

/** The original image, loading (callers redraw on its load event). */
function originalImage(): HTMLImageElement {
    if (source === null) {
        source = new Image();
        source.src = BACKDROP_URLS[0];
    }
    return source;
}

/** What a thumbnail draws: the kind and the galaxy seed (the wizard's, or the running game's). */
export interface BackdropPreviewSource {
    kind: GalaxyBackdropKind;
    seed: number;
}

/** A picker thumbnail (`size` css px square): call update() with the current choice. */
export function createBackdropThumbnail(size: number, className = ''): { el: HTMLDivElement; update: (src: BackdropPreviewSource) => void } {
    const el = document.createElement('div');
    el.className = `galaxy-backdrop-thumb ${className}`.trim();
    Object.assign(el.style, { width: `${size}px`, height: `${size}px`, background: '#000', border: '1px solid rgba(120,140,170,0.6)', overflow: 'hidden', boxSizing: 'border-box' });
    const img = document.createElement('img');
    img.alt = 'Original';
    Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'none' });
    img.addEventListener('error', () => (img.style.visibility = 'hidden'));
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'none' });
    el.append(img, canvas);
    const px = Math.round(size * Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1)));
    let lastKey = '';
    let latest: BackdropPreviewSource | null = null;
    const update = (src: BackdropPreviewSource): void => {
        latest = src;
        const kind = src.kind;
        if (!isDeepKind(kind)) {
            if (img.getAttribute('src') === null) img.src = BACKDROP_URLS[0];
            img.style.display = 'block';
            canvas.style.display = 'none';
            lastKey = 'original';
            return;
        }
        img.style.display = 'none';
        canvas.style.display = 'block';
        const key = `${kind}|${src.seed | 0}|${px}`;
        if (key === lastKey) return;
        const orig = originalImage();
        if (!orig.complete || orig.naturalWidth < 2) {
            orig.addEventListener('load', () => latest !== null && update(latest), { once: true });
            return;
        }
        lastKey = key;
        let pic = cache.get(key) ?? null;
        if (pic === null) {
            // Cover-crop like the Original thumbnail: build at the short side = px.
            const k = px / Math.min(orig.naturalWidth, orig.naturalHeight);
            const long = Math.ceil(Math.max(orig.naturalWidth, orig.naturalHeight) * k);
            pic = buildDeepBackdrop(orig, orig.naturalWidth, orig.naturalHeight, src.seed | 0, 1, DEEP_RECIPES[kind], long)?.canvas ?? null;
            if (pic !== null) {
                if (cache.size > 24) cache.delete(cache.keys().next().value as string);
                cache.set(key, pic);
            }
        }
        canvas.width = px;
        canvas.height = px;
        const g = canvas.getContext('2d');
        if (g === null) return;
        g.fillStyle = '#000';
        g.fillRect(0, 0, px, px);
        if (pic !== null) g.drawImage(pic, (px - pic.width) / 2, (px - pic.height) / 2);
    };
    return { el, update };
}
