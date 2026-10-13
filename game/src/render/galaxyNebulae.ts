// The galaxy nebulae image (Main.bitmap_182): the named NebulaCloud locations drawn as smoke clouds over the galaxy
// backdrop at galaxy / sector zoom. Port of the generateImage=true path of GalaxyNebulaeGenerator.GenerateGalaxyNebulae
// (DistantWorlds.Types/GalaxyNebulaeGenerator.cs), called from Main.Part12.cs 3361 (Galaxy.GenerateNebulae with
// bitmap_176 = galaxy_backdrop.jpg and bitmap_205 = Main.LoadNebulae, every images/environment/nebulae/*.png).
//
// What the original does, per NebulaCloud location in list order:
//   - the cloud picture is cloudImages[PictureRef], rotated to face the galaxy centre (OrientNebulaCloudFromGalaxyCenter:
//     DetermineAngle(location centre, galaxy centre) - pi/2, RotateBitmap onto its rotated bounding box);
//   - it is fully tinted (CalculateImageAttributesFullTint: RGB replaced by the tint, alpha kept) with
//     DetermineLocationColor = the mean of a cloud colour ((17,13,20) or (14,13,24)) and the galaxy_backdrop.jpg pixel
//     at the location centre. TintBitmap draws that tinted copy source-over onto `new Bitmap(inputImage)`, a copy of
//     the untinted grey cloud, so where the png is partly transparent some of its own (grey) luminance shows through
//     the tint (colour (T + c (1 - a)) / (2 - a), alpha a (2 - a)): the lighter patches inside the clouds;
//   - it is drawn (source-over) into an image the size of galaxy_backdrop.jpg over ConvertLocationToRectangle: the
//     location rect enlarged 1.4x about its centre, in backdrop pixels (galaxyScaleFactor = SizeX / image width).
// Then FbmNoise(seed).MakeTurbulence(512, 0.4, 2.5) + TileNoise(48) multiplies every coloured pixel's RGB by noise/255
// (ApplyNoiseToImageTransparent). Main.Part12.cs 3366-3371 composites jpg + this image into the galaxy backdrop
// (bitmap_178 → bitmap_177), so the clouds share the backdrop's zoom band and fade.
//
// Two images come out of one pass: `original`, the port above (drawn source-over on the Original backdrop), and `deep`,
// the tinted copy alone without the grey underlay (added over the Deep backdrop, where it reads as faint smoke).
//
// Deviation: SelectCloudColor's _Rnd.Next(0, 2) is drawn from the generator's location stream in the original; the
// sim ports the location path without it, so here the colour choice comes from a render-only Random(RandomSeed) (the
// two colours differ by a few levels). Render-only: reads galaxy locations and sizes, never the sim RNG.

import { Random } from '../sim/random';
import { GalaxyLocationType, type GalaxyLocation } from '../sim/galaxyLocation';
import { CFractal } from './fbmNoise';
import { makeTextureCanvas } from './textureCanvas';

/** Galaxy.4.cs GenerateNebulae: the cloud colour list. */
const CLOUD_COLORS: readonly [number, number, number][] = [
    [17, 13, 20],
    [14, 13, 24],
];

const NOISE_SIZE = 512;

/** FbmNoise.MakeTurbulence(512, 0.4, 2.5) then TileNoise(noise, 48); noise[x * 512 + y] as the C# noise[x][y]. */
export function galaxyNebulaNoise(seed: number): Uint8Array {
    const n = NOISE_SIZE;
    const out = new Uint8Array(n * n);
    const fractal = new CFractal(seed, 0.4, 2.5);
    for (let i1 = 0; i1 < n; i1++) {
        for (let i2 = 0; i2 < n; i2++) {
            const t = fractal.turbulence(Math.fround(i2 / 100), Math.fround(i1 / 100), 8);
            out[i2 * n + i1] = Math.trunc(Math.max(0, Math.min(255, Math.fround((t + 1) * 128))));
        }
    }
    // TileNoise(noise, 48): blend the last 48 rows / columns towards the first so the noise tiles.
    const edge = 48;
    const clampByte = (v: number): number => Math.min(255, Math.max(0, v));
    for (let a = 0; a < n; a++) {
        let num1 = out[a * n];
        for (let k = 0; k < edge; k++) {
            const b = n - 1 - k;
            const num2 = out[a * n + b];
            out[a * n + b] = clampByte(num2 + Math.trunc((num1 - num2) * Math.pow(0.95, k + 1)));
            num1 = out[a * n + b];
        }
    }
    for (let b = 0; b < n; b++) {
        let num4 = out[b];
        for (let k = 0; k < edge; k++) {
            const a = n - 1 - k;
            const num5 = out[a * n + b];
            out[a * n + b] = clampByte(num5 + Math.trunc((num4 - num5) * Math.pow(0.95, k + 1)));
            num4 = out[a * n + b];
        }
    }
    return out;
}

/** ConvertLocationToRectangle: the location rect enlarged 1.4x about its centre, in image pixels. */
export function nebulaImageRect(loc: GalaxyLocation, galaxyScaleFactor: number): { x: number; y: number; w: number; h: number } {
    const num2 = galaxyScaleFactor / 1.4;
    const num3 = Math.trunc(loc.width / galaxyScaleFactor);
    const num4 = Math.trunc(loc.height / galaxyScaleFactor);
    const w = Math.trunc(loc.width / num2);
    const h = Math.trunc(loc.height / num2);
    const num5 = Math.trunc((w - num3) / 2);
    const num6 = Math.trunc((h - num4) / 2);
    return { x: Math.trunc(loc.xpos / galaxyScaleFactor) - num5, y: Math.trunc(loc.ypos / galaxyScaleFactor) - num6, w, h };
}

export interface GalaxyNebulaeInput {
    randomSeed: number;
    sizeX: number;
    sizeY: number;
    locations: readonly GalaxyLocation[];
    /** galaxy_backdrop.jpg (bitmap_176). */
    backdrop: CanvasImageSource & { width: number; height: number };
    /** images/environment/nebulae/*.png in Directory.GetFiles (sorted) order (bitmap_205). */
    clouds: readonly (CanvasImageSource & { width: number; height: number })[];
}

export interface GalaxyNebulaeImages {
    /** bitmap_182 as the original builds it (TintBitmap over the grey cloud): for the Original backdrop. */
    original: HTMLCanvasElement;
    /** The full-tint clouds alone (no grey underlay): added over the Deep backdrop. */
    deep: HTMLCanvasElement;
}

/** Build bitmap_182 (the size of the backdrop image, transparent outside the clouds) in both variants. Needs a DOM. */
export function buildGalaxyNebulaeImages(input: GalaxyNebulaeInput): GalaxyNebulaeImages {
    const W = Math.max(1, input.backdrop.width);
    const H = Math.max(1, input.backdrop.height);
    const orig = makeTextureCanvas(W, H);
    const deep = makeTextureCanvas(W, H);
    if (input.clouds.length === 0) return { original: orig.canvas, deep: deep.canvas };
    // SampleColorAtPoint reads the backdrop's pixels.
    const bg = makeTextureCanvas(W, H);
    bg.ctx.drawImage(input.backdrop, 0, 0, W, H);
    const bgPx = bg.ctx.getImageData(0, 0, W, H).data;
    bg.canvas.width = 1;
    const gsf = input.sizeX / W;
    const rnd = new Random(input.randomSeed);
    const tmp = makeTextureCanvas(1, 1);
    const tint = makeTextureCanvas(1, 1);
    orig.ctx.imageSmoothingQuality = 'high';
    deep.ctx.imageSmoothingQuality = 'high';
    for (const loc of input.locations) {
        if (loc.type !== GalaxyLocationType.NebulaCloud) continue;
        const img = input.clouds[((loc.pictureRef % input.clouds.length) + input.clouds.length) % input.clouds.length];
        // OrientNebulaCloudFromGalaxyCenter → RotateBitmap(image, angle): corners rotated by (x cos + y sin,
        // -x sin + y cos) about the centre (canvas rotate(-angle)), onto the (int) bounding box.
        const cx = loc.xpos + loc.width / 2;
        const cy = loc.ypos + loc.height / 2;
        const angle = Math.fround(Math.fround(Math.atan2(input.sizeY / 2 - cy, input.sizeX / 2 - cx)) - 1.57079637);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const hw = img.width / 2;
        const hh = img.height / 2;
        let minX = Infinity;
        let minY = Infinity;
        for (const [px, py] of [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]]) {
            const ix = Math.trunc(px);
            const iy = Math.trunc(py);
            minX = Math.min(minX, Math.trunc(ix * cos + iy * sin));
            minY = Math.min(minY, Math.trunc(-ix * sin + iy * cos));
        }
        const rw = Math.max(1, -2 * minX);
        const rh = Math.max(1, -2 * minY);
        tmp.canvas.width = rw;
        tmp.canvas.height = rh;
        const t = tmp.ctx;
        t.setTransform(1, 0, 0, 1, rw / 2, rh / 2);
        t.rotate(-angle);
        t.imageSmoothingQuality = 'high';
        t.drawImage(img, -hw, -hh);
        t.setTransform(1, 0, 0, 1, 0, 0);
        // DetermineLocationColor + full tint (RGB = tint, alpha kept), on a copy of the rotated cloud.
        const cc = CLOUD_COLORS[rnd.next(0, CLOUD_COLORS.length)];
        const sx = Math.min(W - 1, Math.max(0, Math.trunc(cx / gsf)));
        const sy = Math.min(H - 1, Math.max(0, Math.trunc(cy / gsf)));
        const o = (sy * W + sx) * 4;
        const r = Math.min(255, Math.trunc((bgPx[o] + cc[0]) / 2));
        const g = Math.min(255, Math.trunc((bgPx[o + 1] + cc[1]) / 2));
        const b = Math.min(255, Math.trunc((bgPx[o + 2] + cc[2]) / 2));
        tint.canvas.width = rw;
        tint.canvas.height = rh;
        const tt = tint.ctx;
        tt.drawImage(tmp.canvas, 0, 0);
        tt.globalCompositeOperation = 'source-in';
        tt.fillStyle = `rgb(${r},${g},${b})`;
        tt.fillRect(0, 0, rw, rh);
        tt.globalCompositeOperation = 'source-over';
        // TintBitmap: the tinted copy drawn source-over onto the untinted cloud (new Bitmap(inputImage)).
        t.drawImage(tint.canvas, 0, 0);
        const rect = nebulaImageRect(loc, gsf);
        orig.ctx.drawImage(tmp.canvas, 0, 0, rw, rh, rect.x, rect.y, rect.w, rect.h);
        deep.ctx.drawImage(tint.canvas, 0, 0, rw, rh, rect.x, rect.y, rect.w, rect.h);
    }
    tmp.canvas.width = 1;
    tint.canvas.width = 1;
    // ApplyNoiseToImageTransparent(image, whole image, noise, 255): RGB *= noise[X % 512][Y % 512] / 255 where A > 0.
    const noise = galaxyNebulaNoise(input.randomSeed);
    for (const ctx of [orig.ctx, deep.ctx]) {
        const data = ctx.getImageData(0, 0, W, H);
        const px = data.data;
        for (let y = 0; y < H; y++) {
            const ny = y % NOISE_SIZE;
            for (let x = 0; x < W; x++) {
                const o = (y * W + x) * 4;
                if (px[o + 3] === 0) continue;
                const f = noise[(x % NOISE_SIZE) * NOISE_SIZE + ny] / 255;
                px[o] = Math.trunc(px[o] * f);
                px[o + 1] = Math.trunc(px[o + 1] * f);
                px[o + 2] = Math.trunc(px[o + 2] * f);
            }
        }
        ctx.putImageData(data, 0, 0);
    }
    return { original: orig.canvas, deep: deep.canvas };
}
