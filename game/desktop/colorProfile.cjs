// Original art is served with its embedded colour profile removed, so every browser decode path (Pixi textures,
// <img>, CSS backgrounds, canvas composites) gets the raw sample values, as the original does.
//
// The original loads its art with `new Bitmap(path)` (DistantWorlds.Types/GraphicsHelper.cs LoadImageFromFilePath),
// i.e. GDI+ GdipCreateBitmapFromFile without ICM: "embedded color management information (ICC profiles, gamma
// values, chromaticity)" is NOT applied (GDI+ Bitmap(String, Boolean useIcm) docs), so the pixels are drawn as
// stored. Chromium applies the same information (iCCP, sRGB, gAMA + cHRM, cICP for PNG; the APP2 ICC_PROFILE for
// JPEG): most of the 1.9.5 PNGs carry Photoshop's sRGB profile (a no-op), but the grey "Dot Gain 20%" profile on
// the map-star flares, nebulae and supernova clouds brightens them by up to 16 levels. Removing those chunks /
// segments makes the file untagged, which every browser decodes as sRGB with no conversion: raw values.
//
// Used by the Vite dev server (vite.config.ts) and the Electron dwu:// protocol handler (desktop/main.cjs), the
// two places that serve /assets/dwu/. Pure byte surgery: whole chunks / segments are dropped and everything else is
// copied verbatim (CRCs stay valid); a file that does not parse is returned unchanged.

'use strict';

/** PNG chunks that carry colour-space information (PNG 3rd ed. §11.3.2-3 + HDR metadata). */
const PNG_COLOR_CHUNKS = new Set(['iCCP', 'sRGB', 'gAMA', 'cHRM', 'cICP', 'mDCV', 'mDCv', 'cLLI', 'cLLi']);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** File extensions served through stripColorProfile (case-insensitive; content is sniffed, not trusted). */
const IMAGE_EXT = /\.(png|jpe?g)$/i;

function isPng(buf) {
    if (buf.length < 8) return false;
    for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIGNATURE[i]) return false;
    return true;
}

/** PNG without its colour chunks, or `buf` itself when it has none / does not parse. */
function stripPng(buf) {
    const keep = [];
    let o = 8;
    let start = 8; // start of the current run of kept chunks
    let dropped = false;
    while (o < buf.length) {
        if (o + 12 > buf.length) return buf;
        const len = buf.readUInt32BE(o);
        const end = o + 12 + len;
        if (end > buf.length) return buf;
        const type = buf.toString('latin1', o + 4, o + 8);
        if (PNG_COLOR_CHUNKS.has(type)) {
            if (o > start) keep.push(buf.subarray(start, o));
            start = end;
            dropped = true;
        }
        o = end;
        if (type === 'IEND') break;
    }
    if (!dropped) return buf;
    keep.unshift(buf.subarray(0, 8));
    keep.push(buf.subarray(start)); // the remaining chunks (and anything after IEND) verbatim
    return Buffer.concat(keep);
}

/** JPEG without its APP2 ICC_PROFILE segments, or `buf` itself when it has none / does not parse. */
function stripJpeg(buf) {
    const keep = [];
    let o = 2;
    let start = 2;
    let dropped = false;
    while (o + 1 < buf.length) {
        if (buf[o] !== 0xff) return buf;
        const m = buf[o + 1];
        if (m === 0xff) {
            o++; // fill byte
            continue;
        }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
            o += 2; // marker without a length
            continue;
        }
        if (m === 0xda || m === 0xd9) break; // start of scan / end of image: the rest is entropy-coded data
        if (o + 4 > buf.length) return buf;
        const end = o + 2 + buf.readUInt16BE(o + 2);
        if (end > buf.length) return buf;
        if (m === 0xe2 && end - o >= 16 && buf.toString('latin1', o + 4, o + 16) === 'ICC_PROFILE\0') {
            if (o > start) keep.push(buf.subarray(start, o));
            start = end;
            dropped = true;
        }
        o = end;
    }
    if (!dropped) return buf;
    keep.unshift(buf.subarray(0, 2));
    keep.push(buf.subarray(start));
    return Buffer.concat(keep);
}

/**
 * `buf` (a PNG or JPEG file's bytes, whatever its extension says — the install has a JPEG named .png) with every
 * embedded colour profile / colour-space chunk removed; any other content is returned as is.
 */
function stripColorProfile(buf) {
    if (isPng(buf)) return stripPng(buf);
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return stripJpeg(buf);
    return buf;
}

/** Whether a served file path is art that goes through stripColorProfile. */
function isProfiledImagePath(p) {
    return IMAGE_EXT.test(p);
}

module.exports = { stripColorProfile, isProfiledImagePath, PNG_COLOR_CHUNKS };
